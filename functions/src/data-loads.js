'use strict';
/*
 * Data Joe sent to be loaded, run once on each app (test copy and live) by the dataLoadsOnce job in index.js.
 * Each load has a marker doc dataLoads/<id>: once it says DONE the load never runs again, so a later deploy or a second
 * run changes nothing. A load only adds what is missing; it never edits or deletes what is already there (except the HTST
 * load below, which sets the two HTST lists and deletes nothing).
 *
 * receiving-suppliers-2026-10-13 (Joe 10/13, "NEEDS ADDED ... THESE ARE PLACES I GET STUFFF"): his 20 Receiving suppliers,
 * added to the Scheduler's Receiving > Suppliers list exactly as New Supplier adds one (plant.js addSupplier): the Supplier
 * name in capitals, his spelling as the Short Name, the next free S code, in his order. A name already on the list is skipped.
 *
 * uniontown-htst-2026-10-13 (Joe 10/13, his HTST list; "YES GO AHEAD AND DO THAT"): the one load that edits. HTST #1 and HTST #2
 * get exactly his list (src/loads/uniontown-htst-2026-10-13.json: 4 and 60 products, his names and SKUs, his order). A product
 * already on the Product Sheet with the same name keeps its details (his SKU wins when he gave one). A product taken off the
 * HTSTs stays on every other machine it runs on, and one on no other machine stays on the Product Sheet on no machine
 * (productSheet), so nothing is deleted; no other machine's list is written. The marker keeps the HTST lists and the
 * no-machine list from before, for undoing by hand. It waits (tries again next run) until both HTSTs are set up.
 *
 * garage-technicians-2026-10-13 (Joe 10/13, "Copy the garage technicians ... to the live app", option A): the four garage
 * technicians' names, added to Uniontown's Garage Technicians list exactly as Add Technician adds one (garage.js saveGarageTech
 * ADD), turned on, with NO login ID: login IDs are kept only as hashes the screens cannot read, so Joe types each one on
 * Fleet Service Setup (Set login ID). A name already on the list, in any spelling the sheet uses, is skipped.
 *
 * fleet-gps-start-miles-2026-10-13 (Joe 10/13, "input all the mileages in to our units that we have now. So then I can start
 * adjusting those also"): every Uniontown truck on Fleet Service with no "last PM miles" gets its Verizon Fleet GPS odometer as
 * the starting number, and every trailer with no "last reefer service hours" gets its GPS engine hours, written the way Fleet
 * Service Setup's Save writes them (garage.js saveFleetUnit). Joe then changes each to the real last service on Fleet Service
 * Setup. A unit that already has a number keeps it; a unit Fleet has no reading for is left blank. It waits (tries again next
 * run) until a GPS read has brought in odometers. The marker lists every unit and number it set, for undoing by hand.
 *
 * garage-work-orders-2026-10-14 (Joe 10/14, "this says two at the garage, so I should be able to go into the garage and see two
 * work orders"): Truck Issues' Garage button now makes the write-up's work order (garage.js writeUpOrderStep). Every open truck,
 * trailer or fork truck write-up already marked "Sent to garage" before that gets its work order the same way, one per write-up
 * (one already there is kept). TEST COPY ONLY: on the live app it does nothing and leaves no marker until Joe OKs it by name.
 */
const crypto = require('crypto');
const L = require('./logic');
const PLANT = require('./plant');
const GARAGE = require('./garage');
const R = require('./plant-rules');

const docId = (id) => String(id).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 200);

const RECEIVING_SUPPLIERS_ID = 'receiving-suppliers-2026-10-13';
const RECEIVING_SUPPLIERS = ['Charles Stube', 'Dairy Ingredient', 'West Rock', 'Sig', 'Profile Films', 'Crest', 'Danisco', 'Silgan',
  'Dairy House', 'Jogue', 'Virginia Dare', 'Synergy', 'KDV', 'Brenntag', 'Green Spot', 'Robertet Tea', 'Heritage', 'Forbes',
  'Liquid B.I.B', 'U LINE'];
const BY = 'data-load@uniteddairy.com';

async function loadReceivingSuppliersOnce(db, opts) {
  const o = opts || {}, now = o.now ? o.now() : new Date(), stamp = now.toISOString();
  const names = o.names || RECEIVING_SUPPLIERS;
  const mark = db.collection('dataLoads').doc(RECEIVING_SUPPLIERS_ID), journal = db.collection('plantJournal');
  return db.runTransaction(async tx => {
    const m = await tx.get(mark);
    if (m.exists && m.data().status === 'DONE') return { skipped: true };
    const list = R.scheduleSuppliers((await tx.get(journal.where('type', '==', R.SUPPLIER_TYPE))).docs.map(d => d.data()));
    const have = new Set(list.map(x => String(x.run).toUpperCase())), codes = new Set(list.map(x => x.route));
    const added = [], skipped = [];
    let n = list.length + 1;
    names.forEach((label, i) => {
      const name = label.trim().replace(/\s+/g, ' ').toUpperCase();
      if (have.has(name)) { skipped.push(label); return; }
      have.add(name);
      let code;
      do { code = 'S' + String(n).padStart(2, '0'); n++; } while (codes.has(code));
      codes.add(code);
      const id = 'SUP-LOAD-20261013-' + String(i + 1).padStart(2, '0');
      tx.set(journal.doc(docId(R.SUPPLIER_TYPE + '_app_' + id)), {
        recordId: id, type: R.SUPPLIER_TYPE, date: L.operatingDay(now), status: 'ACTIVE', routeId: id, runId: id, route: code, run: name,
        notes: label.slice(0, 40), area: 'RECEIVING', payload: {}, createdAt: stamp, recordedAt: stamp, recordedBy: BY, createdInApp: true,
        testEdited: true, editedAt: stamp, dataLoad: RECEIVING_SUPPLIERS_ID
      });
      added.push(code + ' ' + label);
    });
    tx.set(mark, { status: 'DONE', doneAt: stamp, what: 'Receiving suppliers (Joe 10/13)', added, skipped });
    return { added, skipped };
  });
}

const HTST = require('./loads/uniontown-htst-2026-10-13.json');
const keyOf = (name) => String(name || '').trim().toUpperCase();
const SHARED = ['name', 'sku', 'upc', 'mfgType', 'productGroup', 'shelfLifeDays'];

async function loadHtstOnce(db, opts) {
  const o = opts || {}, now = o.now ? o.now() : new Date(), stamp = now.toISOString(), load = o.load || HTST;
  const markRef = db.collection('dataLoads').doc(load.id);
  return db.runTransaction(async (tx) => {
    const mark = await tx.get(markRef);
    if (mark.exists && mark.data().status === 'DONE') return { skipped: true };
    const fac = load.facilityId, targets = Object.keys(load.machines);
    // Every machine and area of the plant: its saved list, or its starting list when it has never been saved.
    const setup = await tx.get(db.collection('plantSetup'));
    const lines = setup.docs.map(d => d.data()).filter(d => d.type === 'PRODUCTION_AREA' && d.status !== 'INACTIVE' && (String(d.facilityId || '').trim() || 'fac_uniontown') === fac);
    const missing = targets.filter(id => !lines.some(l => l.operationId === id));
    if (missing.length) throw new Error(missing.join(', ') + ' not set up for ' + fac + ' yet');
    const own = await PLANT.productSetupOf(tx, db, fac);
    const ids = [...new Set(lines.map(l => l.operationId).concat(own.areas.map(a => a.id)))];
    const docs = {};
    for (const id of ids) docs[id] = await tx.get(db.collection('plantProducts').doc(docId(id)));
    const looseRef = db.collection('productSheet').doc(fac), looseDoc = await tx.get(looseRef);
    const listOf = (id) => docs[id] && docs[id].exists ? docs[id].data().products || [] : (load.start[id] || []);
    const loose = looseDoc.exists ? looseDoc.data().products || [] : [];
    // What the sheet already knows about each product (the first machine that has it, then the no-machine list).
    const known = {};
    ids.forEach(id => listOf(id).forEach(p => { if (!known[keyOf(p.name)]) known[keyOf(p.name)] = p; }));
    loose.forEach(p => { if (!known[keyOf(p.name)]) known[keyOf(p.name)] = p; });
    const wanted = new Set(), lists = {};
    targets.forEach(id => {
      const had = {};
      listOf(id).forEach(p => { had[keyOf(p.name)] = p; });
      lists[id] = load.machines[id].map(j => {
        const k = keyOf(j.name), base = had[k] || known[k], p = {};
        wanted.add(k);
        if (base) Object.keys(base).forEach(f => { if (had[k] || SHARED.indexOf(f) >= 0) p[f] = base[f]; });
        p.name = j.name;
        if (j.sku) p.sku = j.sku;
        return p;
      });
    });
    // Off the HTSTs and on no other machine: kept on the Product Sheet on no machine.
    const others = new Set();
    ids.filter(id => targets.indexOf(id) < 0).forEach(id => listOf(id).forEach(p => others.add(keyOf(p.name))));
    const looseOut = loose.filter(p => !wanted.has(keyOf(p.name))), inLoose = new Set(looseOut.map(p => keyOf(p.name))), kept = [];
    targets.forEach(id => listOf(id).forEach(p => {
      const k = keyOf(p.name);
      if (wanted.has(k) || others.has(k) || inLoose.has(k)) return;
      inLoose.add(k); looseOut.push(p); kept.push(p.name);
    }));
    targets.forEach(id => {
      const line = lines.find(l => l.operationId === id);
      tx.set(db.collection('plantProducts').doc(docId(id)), { operationId: id, line: line.name, facilityId: fac, products: lists[id], updatedAt: stamp, updatedBy: BY, testEdited: true });
    });
    if (looseOut.length !== loose.length || looseOut.some((p, i) => p !== loose[i])) tx.set(looseRef, { facilityId: fac, products: looseOut, updatedAt: stamp, updatedBy: BY });
    const counts = {};
    targets.forEach(id => { counts[id] = lists[id].length; });
    tx.set(markRef, { status: 'DONE', doneAt: stamp, what: load.what, facilityId: fac, counts, keptOnNoMachine: kept,
      before: targets.map(id => ({ area: id, products: docs[id] && docs[id].exists ? listOf(id) : null })).concat([{ area: 'loose', products: looseDoc.exists ? loose : null }]) });
    return { counts, keptOnNoMachine: kept };
  });
}

const GARAGE_TECHS_ID = 'garage-technicians-2026-10-13';
const GARAGE_TECHS = ['Tom Jellick', 'John Myers', 'Jaxon Nard', 'Shaun Martin'];

async function loadGarageTechsOnce(db, opts) {
  const o = opts || {}, now = o.now ? o.now() : new Date(), stamp = now.toISOString();
  const names = o.techNames || GARAGE_TECHS;
  const mark = db.collection('dataLoads').doc(GARAGE_TECHS_ID), techs = db.collection('garageTechs');
  return db.runTransaction(async tx => {
    const m = await tx.get(mark);
    if (m.exists && m.data().status === 'DONE') return { skipped: true };
    const words = (n) => String(n || '').toUpperCase().split(/[^A-Z]+/).filter(Boolean);
    const have = (await tx.get(techs)).docs.map(d => words(d.data().name));
    // Already there in any order or spelling the sheet uses ("JELLICK Tom", "MARTIN Sean" for Shaun): the same last name and a
    // word starting with the same letter as the first name.
    const listed = (w) => have.some(h => h.indexOf(w[w.length - 1]) >= 0 && h.some(x => x !== w[w.length - 1] && x[0] === w[0][0]));
    const added = [], skipped = [];
    names.forEach(label => {
      const name = label.replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 40), w = words(name);
      if (listed(w)) { skipped.push(label); return; }
      have.push(w);
      // The same id on every app for the same name, so a second copy of this load could never add the person twice.
      const id = 'TECH-' + crypto.createHash('sha256').update('UDPO-TECH-LOAD|' + name).digest('hex').slice(0, 8).toUpperCase();
      tx.set(techs.doc(docId(id)), { tech_id: id, name, active: 'YES', facility_id: 'fac_uniontown', created_at: stamp, created_by: BY, createdInApp: true, dataLoad: GARAGE_TECHS_ID });
      added.push(name);
    });
    tx.set(mark, { status: 'DONE', doneAt: stamp, what: 'Garage technicians, names only (Joe 10/13)', added, skipped });
    return { added, skipped };
  });
}

const FLEET_MILES_ID = 'fleet-gps-start-miles-2026-10-13';
const projectId = () => process.env.GCLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId;
const blank = (v) => v === undefined || v === null || String(v).trim() === '';
async function loadFleetStartMilesOnce(db, opts) {
  const o = opts || {}, now = o.now ? o.now() : new Date(), stamp = now.toISOString();
  // Joe's OK for the live app has to name this load, so it runs by itself on the test copy only.
  if ((o.project || projectId()) !== 'ud-distribution-sandbox') return { skipped: 'test copy only (live needs Joe\'s OK)' };
  const mark = db.collection('dataLoads').doc(FLEET_MILES_ID);
  return db.runTransaction(async tx => {
    const m = await tx.get(mark);
    if (m.exists && m.data().status === 'DONE') return { skipped: true };
    const [equipment, gps, setup] = await Promise.all([tx.get(db.collection('equipment')), tx.get(db.collection('gpsTrucks')), tx.get(db.collection('fleetSetup'))]);
    // Fleet names a truck "223876" and a trailer "T-635"; ours are the same letters and digits (trailers T- plus number).
    const key = (u) => String(u || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), byKey = {}, byDigits = {};
    gps.docs.map(d => d.data()).forEach(t => { const k = key(t.tag); if (!k) return; byKey[k] = t; if (/^\d+$/.test(k)) byDigits[k] = t; });
    if (!gps.docs.some(d => Number(d.data().odometerMiles) > 0)) return { waiting: 'no GPS odometers read yet' };
    const setupBy = {}; setup.docs.forEach(d => { setupBy[String(d.data().unit || d.id).toUpperCase()] = { ref: d.ref, data: d.data() }; });
    const set = [], kept = [], noReading = [];
    GARAGE.garageUnits(equipment.docs.map(d => d.data())).filter(u => !u.leased).forEach(u => {
      const t = byKey[key(u.unit)] || (/^\d+$/.test(key(u.unit)) ? byDigits[key(u.unit)] : null);
      const field = u.type === 'TRUCK' ? 'last_service_miles' : 'last_service_hours';
      const value = t ? Math.round(Number(u.type === 'TRUCK' ? t.odometerMiles : t.engineHours)) : 0;
      const have = setupBy[u.unit];
      if (have && !blank(have.data[field])) { kept.push(u.unit); return; }
      if (!(value > 0)) { noReading.push(u.unit); return; }
      const change = { [field]: String(value), updated_at: stamp, updated_by: BY, testEdited: true, editedAt: stamp, dataLoad: FLEET_MILES_ID };
      if (have) tx.update(have.ref, change);
      else tx.set(db.collection('fleetSetup').doc(docId(u.unit)), Object.assign({ unit: u.unit, unit_type: u.type, facility_id: 'fac_uniontown', createdInApp: true }, change));
      set.push({ unit: u.unit, field, value });
    });
    tx.set(mark, { status: 'DONE', doneAt: stamp, what: 'Fleet Service starting miles and reefer hours from Verizon Fleet GPS (Joe 10/13)', set, kept, noReading });
    return { set: set.length, kept: kept.length, noReading: noReading.length };
  });
}

const GARAGE_ORDERS_ID = 'garage-work-orders-2026-10-14';
const CLOSED = /^(COMPLETE|COMPLETED|CLOSED|RESOLVED|REPAIRED|REMOVED)$/i;
async function loadGarageOrdersOnce(db, opts) {
  const o = opts || {}, now = o.now ? o.now() : new Date(), stamp = now.toISOString();
  if ((o.project || projectId()) !== 'ud-distribution-sandbox') return { skipped: 'test copy only (live needs Joe\'s OK)' };
  const mark = db.collection('dataLoads').doc(GARAGE_ORDERS_ID);
  return db.runTransaction(async tx => {
    const m = await tx.get(mark);
    if (m.exists && m.data().status === 'DONE') return { skipped: true };
    const sent = (await tx.get(db.collection('maintenance').where('kind', 'in', ['TRUCK', 'TRAILER', 'FORK_TRUCK']))).docs.map(d => d.data())
      .filter(r => r.record_id && L.garageSent(r.notes) && !CLOSED.test(String(r.status || '').trim()));
    const steps = [];
    for (const r of sent) steps.push({ r, step: await GARAGE.writeUpOrderStep(tx, db, r, 'garage', BY, stamp) });
    const made = [], kept = [];
    steps.forEach(({ r, step }) => {
      if (!step) return;
      if (step.created) { step.apply(tx); made.push(step.workOrderId + ' ' + r.record_id); } else kept.push(step.workOrderId + ' ' + r.record_id);
    });
    tx.set(mark, { status: 'DONE', doneAt: stamp, what: 'Garage work orders for write-ups already sent to the garage (Joe 10/14)', made, kept });
    return { made: made.length, kept: kept.length };
  });
}

const MAIL_CHECKINS_ID = 'mail-checkin-credit-2026-10-14';
// Joe 10/14: answering-service check-ins that found no run (the route said "8" for 808, or wrong) get their credit now that the
// driver's name picks the run (admintools.recreditMailCheckins). Test copy only until Joe names it for live.
async function loadMailCheckinsOnce(db, opts) {
  const o = opts || {}, now = o.now ? o.now() : new Date(), stamp = now.toISOString();
  if ((o.project || projectId()) !== 'ud-distribution-sandbox') return { skipped: 'test copy only (live needs Joe\'s OK)' };
  const mark = db.collection('dataLoads').doc(MAIL_CHECKINS_ID);
  const m = await mark.get();
  if (m.exists && m.data().status === 'DONE') return { skipped: true };
  const out = await require('./admintools').recreditMailCheckins(db, { now: () => now });
  await mark.set({ status: 'DONE', doneAt: stamp, what: 'Check-in credit for answering-service emails that found no run (Joe 10/14)', credited: out.credited, still: out.still });
  return { credited: out.credited.length, still: out.still.length };
}

// Every load, in order. A load that fails is tried again on the next run; the others still run.
async function runDataLoads(db, opts) {
  const out = {};
  for (const [id, fn] of [[RECEIVING_SUPPLIERS_ID, loadReceivingSuppliersOnce], [HTST.id, loadHtstOnce], [GARAGE_TECHS_ID, loadGarageTechsOnce], [FLEET_MILES_ID, loadFleetStartMilesOnce], [GARAGE_ORDERS_ID, loadGarageOrdersOnce], [MAIL_CHECKINS_ID, loadMailCheckinsOnce]]) {
    try { out[id] = await fn(db, opts); } catch (e) { console.error('Data load ' + id + ' failed: ' + (e && e.message || e)); out[id] = { error: String(e && e.message || e) }; }
  }
  return out;
}

module.exports = { runDataLoads, loadHtstOnce, HTST, loadReceivingSuppliersOnce, RECEIVING_SUPPLIERS_ID, RECEIVING_SUPPLIERS, loadGarageTechsOnce, GARAGE_TECHS_ID, GARAGE_TECHS, loadFleetStartMilesOnce, FLEET_MILES_ID, loadGarageOrdersOnce, GARAGE_ORDERS_ID, loadMailCheckinsOnce, MAIL_CHECKINS_ID };
