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
 */
const L = require('./logic');
const PLANT = require('./plant');
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

// Every load, in order. A load that fails is tried again on the next run; the others still run.
async function runDataLoads(db, opts) {
  const out = {};
  for (const [id, fn] of [[RECEIVING_SUPPLIERS_ID, loadReceivingSuppliersOnce], [HTST.id, loadHtstOnce]]) {
    try { out[id] = await fn(db, opts); } catch (e) { console.error('Data load ' + id + ' failed: ' + (e && e.message || e)); out[id] = { error: String(e && e.message || e) }; }
  }
  return out;
}

module.exports = { runDataLoads, loadHtstOnce, HTST, loadReceivingSuppliersOnce, RECEIVING_SUPPLIERS_ID, RECEIVING_SUPPLIERS };
