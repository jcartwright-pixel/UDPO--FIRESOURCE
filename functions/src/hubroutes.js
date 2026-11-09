/*
 * The route customer list, read from the Hub's copy (Joe 11-9-26: "the route customer list goes through the hub only. It
 * comes through to read and it comes through to write ... That way, it's always pointed to the correct updated master").
 * The Customer List keeps the one master copy; the Hub rebuilds two records from it every time it changes (hub/functions/src/
 * routemaster.js), and every other app reads only those:
 *
 *   hubRouteMaster/<plant>   every stop on every route day in run order, active customers only: rows [{ plant, route, day,
 *                            dayName, stop, load, key, account, chain, customer, note, palletUses, cases }] and days
 *                            [{ route, day, dayName, startTime, notes, map }]
 *   hubCustomers/<plant>     each active customer: customers [{ key, account, chain, name, group, address, phone, keys, notes,
 *                            lat, lon, routes }] and unrouted [{ key, account, chain, name, day }]
 *
 * A big plant is split into parts (<plant>, <plant>__2, ...; the first says how many in `parts`); this puts them back
 * together. Operations never writes either record. Until the Hub has written a plant's record the callers keep their
 * old path (Joe 11-2-26: nothing is switched off before its replacement works).
 */
'use strict';

const ROUTE_MASTER = 'hubRouteMaster';
const CUSTOMERS = 'hubCustomers';

/** One plant's Hub record with its parts joined, or null when the Hub has not written it. */
async function readRecord(db, collection, plant, listKeys) {
  const first = await db.collection(collection).doc(plant).get();
  if (!first.exists) return null;
  const rec = Object.assign({}, first.data());
  const n = Number(rec.parts) || 1;
  if (n > 1) {
    const refs = [];
    for (let i = 2; i <= n; i++) refs.push(db.collection(collection).doc(plant + '__' + i));
    const more = await db.getAll(...refs);
    more.forEach(d => { if (!d.exists) return; const p = d.data(); listKeys.forEach(k => { rec[k] = (rec[k] || []).concat(p[k] || []); }); });
  }
  listKeys.forEach(k => { rec[k] = rec[k] || []; });
  return rec;
}

const routeMaster = (db, plant) => readRecord(db, ROUTE_MASTER, plant, ['rows', 'days']);
const customers = (db, plant) => readRecord(db, CUSTOMERS, plant, ['customers', 'unrouted']);

/**
 * The Sales app's lines from the Hub: { rows: [{ day, route, account, chain, name, group }], savedAt, from: 'hub' }, or null
 * when the Hub has no record for the plant yet. Active customers only (the Hub leaves out inactive ones).
 */
async function salesRows(db, plant) {
  const [rm, cu] = await Promise.all([routeMaster(db, plant), customers(db, plant)]);
  if (!rm || !cu) return null;
  const groupOf = {};
  cu.customers.forEach(c => { groupOf[c.key] = c.group || ''; });
  const rows = rm.rows.map(r => ({ day: r.dayName, route: String(r.route || ''), account: r.account || '', chain: r.chain || '', name: r.customer || '', group: groupOf[r.key] || '' }))
    .concat(cu.unrouted.map(x => ({ day: x.day || '', route: '', account: x.account || '', chain: x.chain || '', name: x.name || '', group: groupOf[x.key] || '' })));
  return { rows, savedAt: rm.sourceAt || rm.builtAt || '', from: 'hub' };
}

module.exports = { readRecord, routeMaster, customers, salesRows, ROUTE_MASTER, CUSTOMERS };
