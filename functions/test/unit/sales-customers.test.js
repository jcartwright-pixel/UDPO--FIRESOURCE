'use strict';
// Joe 11/1 (mock-ups 1-5): the Sales app's customer list, from the Route Menu's Customer By Route tab. Made-up customers only.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../src/salescustomers');

const LINES = [
  { day: 'TUE', route: 803, chain: 0, account: 1196, name: 'ACORN CORNER MARKET' }, { day: 'tue', route: '803.0', chain: '0', account: '1196.0', name: 'ACORN  CORNER MARKET' },
  { day: 'FRI', route: '', chain: 0, account: 271285, name: 'LAKESIDE SCOOPS' }, { day: 'XYZ', route: 803, name: 'NOT A DAY' }, { day: 'MON', route: 803, name: '' },
  { day: 'THU', route: 805, chain: 498, account: 13590, name: '...DQ BETHEL KNOLL' }, { day: 'MON', route: 808, chain: 990, account: 2603, name: 'WAL-MART #2603 MAPLETON' },
  { day: 'WED', route: 808, chain: 990, account: 1885, name: 'WAL-MART #1885 PINEDALE' }, { day: 'WED', route: 812, chain: 10, account: 48, name: 'BFS FOODS #48 OAKMONT' }
];

test('lines are cleaned: numbers as plain words, chain 0 = none, no day or name = left out, the same line once', () => {
  const rows = S.cleanRows(LINES);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows[0], { day: 'TUE', route: '803', account: '1196', chain: '', name: 'ACORN CORNER MARKET' });
  assert.deepEqual(rows[1], { day: 'FRI', route: '', account: '271285', chain: '', name: 'LAKESIDE SCOOPS' });
  assert.deepEqual(S.summary(rows), { count: 6, customers: 6, routes: 4, noRoute: 1 });
  assert.throws(() => S.cleanRows([]), /No customer lines/);
  assert.throws(() => S.cleanRows([{ day: 'MON', name: '' }]), /No customer lines/);
});

test('groups: every DQ name is Dairy Queen, the rest by chain; one customer in a chain is no group; a rename wins', () => {
  const rows = S.cleanRows(LINES);
  assert.equal(S.groupKey(rows.find(r => r.name.includes('BETHEL'))), 'DQ');
  assert.deepEqual(S.groupsOf(rows, {}).map(g => [g.key, g.name, g.count]), [['chain:990', 'Walmart', 2], ['DQ', 'Dairy Queen', 1]]);
  assert.deepEqual(S.groupsOf(rows, { 'chain:990': 'Big Box Stores' }).map(g => [g.name, g.guess]), [['Big Box Stores', 'Walmart'], ['Dairy Queen', 'Dairy Queen']]);
});

function fakeDb() {
  const docs = {};
  const merge = (a, b) => { const o = Object.assign({}, a); Object.keys(b).forEach(k => { o[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) ? merge(o[k] || {}, b[k]) : b[k]; }); return o; };
  return { docs, collection: (c) => ({ doc: (id) => ({
    get: async () => ({ exists: !!docs[c + '/' + id], data: () => docs[c + '/' + id] }),
    set: async (v, opt) => { docs[c + '/' + id] = opt && opt.merge ? merge(docs[c + '/' + id] || {}, v) : v; }
  }) }) };
}

test('Administration saves a division\'s list, a rename stays through the next upload, and the app gets each line\'s group', async () => {
  const db = fakeDb(), plants = [{ id: 'fac_uniontown', name: 'Uniontown' }];
  await assert.rejects(S.adminSave(db, plants, 'a@uniteddairy.com', { plant: 'nowhere', rows: LINES }, 'T1'), /Pick the division/);
  const out = await S.adminSave(db, plants, 'a@uniteddairy.com', { plant: 'fac_uniontown', fileName: 'Route Menu.xlsb', rows: LINES }, '2026-11-01T14:00:00.000Z');
  assert.equal(out.message, 'Saved 6 customers on 4 routes for Uniontown.');
  assert.equal(out.plants[0].noRoute, 1);
  await S.adminRename(db, plants, 'a@uniteddairy.com', { plant: 'fac_uniontown', key: 'chain:990', name: ' Big  Box Stores ' }, 'T2');
  await assert.rejects(S.adminRename(db, plants, 'a@uniteddairy.com', { plant: 'fac_uniontown', key: 'rows', name: 'x' }, 'T2'), /not on the customer list/);
  await S.adminSave(db, plants, 'a@uniteddairy.com', { plant: 'fac_uniontown', fileName: 'Route Menu 2.xlsb', rows: LINES }, 'T3');
  const got = await S.forSales(db, 'fac_uniontown');
  assert.equal(got.savedAt, 'T3');
  assert.deepEqual(got.rows.map(r => r.name + ' = ' + r.group), ['...DQ BETHEL KNOLL = Dairy Queen', 'ACORN CORNER MARKET = Independents', 'BFS FOODS #48 OAKMONT = Independents',
    'LAKESIDE SCOOPS = Independents', 'WAL-MART #1885 PINEDALE = Big Box Stores', 'WAL-MART #2603 MAPLETON = Big Box Stores']);
  assert.deepEqual(await S.forSales(db, 'fac_charleston'), { rows: [], savedAt: '' });
});
