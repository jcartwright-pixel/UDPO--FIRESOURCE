'use strict';
/*
 * Data Joe sent to be loaded, run once on each app (test copy and live) by the dataLoadsOnce job in index.js.
 * Each load has a marker doc dataLoads/<id>: once it says DONE the load never runs again, so a later deploy or a second
 * run changes nothing. A load only adds what is missing; it never edits or deletes what is already there.
 *
 * receiving-suppliers-2026-10-13 (Joe 10/13, "NEEDS ADDED ... THESE ARE PLACES I GET STUFFF"): his 20 Receiving suppliers,
 * added to the Scheduler's Receiving > Suppliers list exactly as New Supplier adds one (plant.js addSupplier): the Supplier
 * name in capitals, his spelling as the Short Name, the next free S code, in his order. A name already on the list is skipped.
 */
const L = require('./logic');
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

// Every load, in order. A load that fails is tried again on the next run; the others still run.
async function runDataLoads(db, opts) {
  const out = {};
  for (const [id, fn] of [[RECEIVING_SUPPLIERS_ID, loadReceivingSuppliersOnce]]) {
    try { out[id] = await fn(db, opts); } catch (e) { console.error('Data load ' + id + ' failed: ' + (e && e.message || e)); out[id] = { error: String(e && e.message || e) }; }
  }
  return out;
}

module.exports = { runDataLoads, loadReceivingSuppliersOnce, RECEIVING_SUPPLIERS_ID, RECEIVING_SUPPLIERS };
