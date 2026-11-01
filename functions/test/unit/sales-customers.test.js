'use strict';
// Joe 11/1 (mock-ups 1-5): the Sales app's customer list, from the Route Menu's Customer By Route tab. Made-up customers only.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../src/salescustomers');


const ROWS = [
  { day: 'TUE', route: '803', account: '1196', chain: '', name: 'ACORN CORNER MARKET' }, { day: 'FRI', route: '', account: '271285', chain: '', name: 'LAKESIDE SCOOPS' },
  { day: 'THU', route: '805', chain: '498', account: '13590', name: '...DQ BETHEL KNOLL' }, { day: 'MON', route: '808', chain: '990', account: '2603', name: 'WAL-MART #2603 MAPLETON' },
  { day: 'WED', route: '808', chain: '990', account: '1885', name: 'WAL-MART #1885 PINEDALE' }, { day: 'WED', route: '812', chain: '10', account: '48', name: 'BFS FOODS #48 OAKMONT' }
];

test('groups: every DQ name is Dairy Queen, the rest by chain; one customer in a chain is no group; a rename wins', () => {
  const rows = ROWS;
  assert.equal(S.groupKey(rows.find(r => r.name.includes('BETHEL'))), 'DQ');
  assert.deepEqual(S.groupsOf(rows, {}).map(g => [g.key, g.name, g.count]), [['chain:990', 'Walmart', 2], ['DQ', 'Dairy Queen', 1]]);
  assert.deepEqual(S.groupsOf(rows, { 'chain:990': 'Big Box Stores' }).map(g => [g.name, g.guess]), [['Big Box Stores', 'Walmart'], ['Dairy Queen', 'Dairy Queen']]);
});

// The Customer List's records (udcl.js reads them), made up: one import, its route days and customers.
function fakeDb() {
  const docs = {};
  const merge = (a, b) => { const o = Object.assign({}, a); Object.keys(b).forEach(k => { o[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) ? merge(o[k] || {}, b[k]) : b[k]; }); return o; };
  const snap = (k) => ({ exists: !!docs[k], data: () => docs[k] });
  return { docs, collection: (c) => ({
    doc: (id) => ({ get: async () => snap(c + '/' + id), set: async (v, opt) => { docs[c + '/' + id] = opt && opt.merge ? merge(docs[c + '/' + id] || {}, v) : v; } }),
    where: (f, op, v) => ({ get: async () => ({ docs: Object.keys(docs).filter(k => k.startsWith(c + '/') && docs[k][f] === v).map(snap) }) })
  }) };
}
function seedUdcl(db, plant) {
  const routed = ROWS.filter(r => r.route), days = {};
  routed.forEach(r => { const k = r.route + '__' + r.day; (days[k] = days[k] || { plant, route: r.route, day: r.day, stops: [], updatedAt: '2026-11-01T14:00:00.000Z' }).stops.push({ key: r.account, account: r.account, name: r.name, chain: r.chain }); });
  Object.keys(days).forEach(k => { db.docs['udclRouteDays/' + plant + '__' + k] = days[k]; });
  routed.forEach(r => { db.docs['udclCustomers/' + plant + '__' + r.account] = { plant, key: r.account, account: r.account, name: r.name, chain: r.chain, active: true }; });
  db.docs['private/udcl_' + plant] = { plant, at: '2026-11-01T14:00:00.000Z', by: 'a@uniteddairy.com', fileName: 'Route Menu.xlsb', unrouted: ROWS.filter(r => !r.route) };
}

test('Joe 11/1: the Sales app and Administration read the Customer List; a rename is kept; a division not imported there has none', async () => {
  const db = fakeDb(), plants = [{ id: 'fac_uniontown', name: 'Uniontown' }, { id: 'fac_charleston', name: 'Charleston' }];
  seedUdcl(db, 'fac_uniontown');
  // An old upload's rows in Operations are not read any more.
  db.docs['salesCustomers/fac_charleston'] = { rows: [{ day: 'MON', route: '1', account: '9', chain: '', name: 'OLD UPLOAD' }] };
  const v = await S.adminView(db, plants);
  assert.deepEqual(v.plants.map(p => [p.name, p.customers, p.routes, p.count, p.noRoute, p.fileName]), [['Uniontown', 6, 4, 6, 1, 'Route Menu.xlsb'], ['Charleston', 0, 0, 0, 0, '']]);
  await S.adminRename(db, plants, 'a@uniteddairy.com', { plant: 'fac_uniontown', key: 'chain:990', name: ' Big  Box Stores ' }, 'T2');
  await assert.rejects(S.adminRename(db, plants, 'a@uniteddairy.com', { plant: 'fac_uniontown', key: 'rows', name: 'x' }, 'T2'), /not on the customer list/);
  const got = await S.forSales(db, 'fac_uniontown');
  assert.equal(got.savedAt, '2026-11-01T14:00:00.000Z');
  assert.deepEqual(got.rows.map(r => r.name + ' = ' + r.group), ['...DQ BETHEL KNOLL = Dairy Queen', 'ACORN CORNER MARKET = Independents', 'BFS FOODS #48 OAKMONT = Independents',
    'LAKESIDE SCOOPS = Independents', 'WAL-MART #1885 PINEDALE = Big Box Stores', 'WAL-MART #2603 MAPLETON = Big Box Stores']);
  assert.deepEqual(await S.forSales(db, 'fac_charleston'), { rows: [], savedAt: '' });
});
