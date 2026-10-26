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
 *
 * half-gallon-label-readers-2026-10-15 (Joe 10/15, "b": both half gallon fillers have a UPC label scanner like the Gallon Filler):
 * NEW 1/2 GALLON and OLD 1/2 GALLON are counted by their label reader (Counted by = Label reader on Line Targets, as
 * saveLineCounter sets it), so each scan counts a carton, the UPC picks the product, the code date is checked, a label not on the
 * line shows WRONG LABEL and 3 quiet minutes is a stop. A line already set to anything but Typed by operator keeps its setting.
 * It waits (tries again next run) until both lines are set up. TEST COPY ONLY: on the live app the scanners are not wired to a
 * line PC yet, so it does nothing and leaves no marker until Joe OKs it by name.
 *
 * fleet-service-start-2026-04-01 (Joe 10/19, "no trailers have been serviced ... put in a start date for all of them as 4/1/2026.
 * And then we'll just start that off with the base"): every unit on Uniontown's Fleet Service Due list (the owned trucks and our
 * trailers, as the screen lists them; a unit with Track due dates = No is left out) gets 4-1-26 as its last PM / reefer service
 * date and as its last annual inspection (the next one due by the rule: 4-1-27 at 12 months), written the way Fleet Service
 * Setup's Save writes them (garage.js saveFleetUnit). A date already typed is kept. Truck PM miles stay as they are: the app has
 * no GPS miles from 4-1-26, so a truck with no last PM miles still asks for them. Plates are not touched. The marker lists every
 * unit and field it set, for undoing by hand. TEST COPY ONLY: on the live app it does nothing and leaves no marker until Joe OKs
 * it by name.
 *
 * otr-history-2026-10-18 (Joe 10/18, "this screen is not getting filled out, and I thought it was already done once"): the Over
 * the Road history from his OTR Trips 2026 workbook and the August accounting package (day counts 9-30-16 to 8-31-26, monthly
 * figures, By Date comments) and his OTR runs ticked in OTR Routes Setup were loaded on the test copy only (otr-seed.js), so the
 * live Month Recap, By Date and Recap showed 0. This loads the same two with the same rules: a day count or comment typed by
 * hand is kept, and a run already set in OTR Routes Setup is left as it is. On the test copy both are already there, so it only
 * leaves its marker (otrHistorySandbox loaded both there on 10/11). On the live app (Joe 10/18: "Load the Over the Road history
 * (otr-history-2026-10-18) into the live app.") loadOtrHistory runs. It is about 19,000 day counts, so it runs from the
 * otrHistorySandbox job in index.js (5 minutes, 512MiB) rather than with the loads above.
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

const FLEET_START_ID = 'fleet-service-start-2026-04-01';
const FLEET_START_DATE = '2026-04-01';
async function loadFleetServiceStartOnce(db, opts) {
  const o = opts || {}, now = o.now ? o.now() : new Date(), stamp = now.toISOString();
  if ((o.project || projectId()) !== 'ud-distribution-sandbox') return { skipped: 'test copy only (live needs Joe\'s OK)' };
  const mark = db.collection('dataLoads').doc(FLEET_START_ID);
  return db.runTransaction(async tx => {
    const m = await tx.get(mark);
    if (m.exists && m.data().status === 'DONE') return { skipped: true };
    const [equipment, setup, owned, rulesDoc] = await Promise.all([tx.get(db.collection('equipment')), tx.get(db.collection('fleetSetup')),
      tx.get(db.collection('config').doc('fleetOwnership')), tx.get(db.collection('config').doc('fleetRules'))]);
    const ownership = owned.exists ? owned.data() : null, rules = Object.assign({}, L.FLEET_RULES, rulesDoc.exists ? rulesDoc.data() : {});
    const setupBy = {}; setup.docs.forEach(d => { setupBy[String(d.data().unit || d.id).toUpperCase()] = { ref: d.ref, data: d.data() }; });
    // The units Fleet Service lists at Uniontown (fleet.html units()): owned trucks and our trailers.
    const units = GARAGE.garageUnits(equipment.docs.map(d => d.data()).filter(e => L.fleetOwnedHere(e, 'fac_uniontown', ownership)));
    const set = [], kept = [], notTracked = [];
    units.forEach(u => {
      const have = setupBy[u.unit], s = have ? have.data : {};
      if (String(s.track || '').trim() && !L.yes(s.track)) { notTracked.push(u.unit); return; }
      const fields = {};
      if (blank(s.last_service_date)) fields.last_service_date = FLEET_START_DATE;
      if (blank(s.dot_due)) fields.dot_due = L.addMonths(FLEET_START_DATE, L.fleetRule(rules, u.type, 'dotMonths'));
      if (!Object.keys(fields).length) { kept.push(u.unit); return; }
      const change = Object.assign({}, fields, { updated_at: stamp, updated_by: BY, testEdited: true, editedAt: stamp, dataLoad: FLEET_START_ID });
      if (have) tx.update(have.ref, change);
      else tx.set(db.collection('fleetSetup').doc(docId(u.unit)), Object.assign({ unit: u.unit, unit_type: u.type, facility_id: 'fac_uniontown', createdInApp: true }, change));
      set.push(Object.assign({ unit: u.unit }, fields));
    });
    tx.set(mark, { status: 'DONE', doneAt: stamp, what: 'Fleet Service start date 4-1-26 for PM / reefer service and annual inspection (Joe 10/19)', set, kept, notTracked });
    return { set: set.length, kept: kept.length, notTracked: notTracked.length };
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

const HALF_READERS_ID = 'half-gallon-label-readers-2026-10-15';
const HALF_GALLON = /^(NEW|OLD)12GAL(LON)?$/;
async function loadHalfGallonReadersOnce(db, opts) {
  const o = opts || {}, now = o.now ? o.now() : new Date(), stamp = now.toISOString();
  if ((o.project || projectId()) !== 'ud-distribution-sandbox') return { skipped: 'test copy only (live needs Joe\'s OK)' };
  const mark = db.collection('dataLoads').doc(HALF_READERS_ID);
  return db.runTransaction(async tx => {
    const m = await tx.get(mark);
    if (m.exists && m.data().status === 'DONE') return { skipped: true };
    const lines = (await tx.get(db.collection('plantSetup').where('type', '==', 'PRODUCTION_AREA'))).docs.map(d => d.data())
      .filter(d => String(d.status || '').toUpperCase() === 'ACTIVE' && HALF_GALLON.test(String(d.name || d.area || '').toUpperCase().replace(/[^A-Z0-9]/g, '')));
    if (lines.length < 2) return { waiting: 'both half gallon fillers are not set up yet' };
    const refs = lines.map(d => db.collection('productionLines').doc(docId(d.operationId)));
    const had = [];
    for (const ref of refs) had.push(await tx.get(ref));
    const set = [], kept = [];
    lines.forEach((d, i) => {
      const was = had[i].exists ? had[i].data().counter || 'TABLET' : 'TABLET', name = String(d.name || d.area);
      if (was !== 'TABLET') { kept.push(name + ' ' + was); return; }
      tx.set(refs[i], { operationId: d.operationId, line: name, facilityId: String(d.facilityId || '').trim() || 'fac_uniontown', counter: 'READER', updatedAt: stamp, updatedBy: BY }, { merge: true });
      set.push(name);
    });
    tx.set(mark, { status: 'DONE', doneAt: stamp, what: 'Both half gallon fillers counted by their UPC label scanner (Joe 10/15, "b")', set, kept });
    return { set, kept };
  });
}

const OTR_HISTORY_ID = 'otr-history-2026-10-18';
// The load itself (the live app's, once Joe OKs it): his OTR runs, then the history (about 19,000 day counts).
async function loadOtrHistory(db, opts) {
  const o = opts || {}, OTR = require('./otr-seed');
  const routes = await OTR.seedOtrRoutesOnce(db, o);
  const history = await OTR.seedOtrOnce(db, Object.assign({ testEdited: false }, o));
  // Another run is still writing the history (it holds its marker for 10 minutes): this one tries again next time.
  if (history.skipped && ((await db.collection('otrSeed').doc(OTR.SEED_ID).get()).data() || {}).status !== 'DONE') return { waiting: 'history still loading' };
  return { routes, history };
}
async function loadOtrHistoryOnce(db, opts) {
  const o = opts || {}, now = o.now ? o.now() : new Date(), stamp = now.toISOString();
  const mark = db.collection('dataLoads').doc(OTR_HISTORY_ID);
  const m = await mark.get();
  if (m.exists && m.data().status === 'DONE') return { skipped: true };
  const what = 'Over the Road history and OTR Routes Setup runs from his workbook (Joe 10/18)';
  // The test copy has had both since 10/11 (seedOtrOnce in the same job), so there it only leaves its marker.
  if ((o.project || projectId()) === 'ud-distribution-sandbox') { await mark.set({ status: 'DONE', doneAt: stamp, what, testCopy: 'already loaded by otrHistorySandbox' }); return { marked: true }; }
  // Joe 10/18: "Load the Over the Road history (otr-history-2026-10-18) into the live app."
  const out = await loadOtrHistory(db, o);
  if (out.waiting) return out;
  await mark.set({ status: 'DONE', doneAt: stamp, what, routes: out.routes, history: out.history });
  return out;
}

// Every load, in order. A load that fails is tried again on the next run; the others still run.
async function runDataLoads(db, opts) {
  const out = {};
  for (const [id, fn] of [[RECEIVING_SUPPLIERS_ID, loadReceivingSuppliersOnce], [HTST.id, loadHtstOnce], [GARAGE_TECHS_ID, loadGarageTechsOnce], [FLEET_MILES_ID, loadFleetStartMilesOnce], [FLEET_START_ID, loadFleetServiceStartOnce], [GARAGE_ORDERS_ID, loadGarageOrdersOnce], [MAIL_CHECKINS_ID, loadMailCheckinsOnce], [HALF_READERS_ID, loadHalfGallonReadersOnce]]) {
    try { out[id] = await fn(db, opts); } catch (e) { console.error('Data load ' + id + ' failed: ' + (e && e.message || e)); out[id] = { error: String(e && e.message || e) }; }
  }
  return out;
}

module.exports = { runDataLoads, loadHtstOnce, HTST, loadReceivingSuppliersOnce, RECEIVING_SUPPLIERS_ID, RECEIVING_SUPPLIERS, loadGarageTechsOnce, GARAGE_TECHS_ID, GARAGE_TECHS, loadFleetStartMilesOnce, FLEET_MILES_ID, loadFleetServiceStartOnce, FLEET_START_ID, loadGarageOrdersOnce, GARAGE_ORDERS_ID, loadMailCheckinsOnce, MAIL_CHECKINS_ID, loadHalfGallonReadersOnce, HALF_READERS_ID, loadOtrHistoryOnce, loadOtrHistory, OTR_HISTORY_ID };
