'use strict';
// Joe 11/1: the Sales app's customers come only from the Customer List app (udcl.js); this app keeps no list of its own
// ("Any changes or ever, it goes through that"). Groups (mock-ups 4 and 5). Made-up customers only.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../src/salescustomers');

const LINES = [
  { day: 'TUE', route: '803', chain: '', account: '1196', name: 'ACORN CORNER MARKET' }, { day: 'FRI', route: '', chain: '', account: '271285', name: 'LAKESIDE SCOOPS' },
  { day: 'THU', route: '805', chain: '498', account: '13590', name: '...DQ BETHEL KNOLL' }, { day: 'MON', route: '808', chain: '990', account: '2603', name: 'WAL-MART #2603 MAPLETON' },
  { day: 'WED', route: '808', chain: '990', account: '1885', name: 'WAL-MART #1885 PINEDALE' }, { day: 'WED', route: '812', chain: '10', account: '48', name: 'BFS FOODS #48 OAKMONT' }
];

test('groups: every DQ name is Dairy Queen, the rest by chain; one customer in a chain is no group', () => {
  assert.equal(S.groupKey(LINES[2]), 'DQ');
  assert.deepEqual(S.groupsOf(LINES).map(g => [g.key, g.name, g.count]), [['chain:990', 'Walmart', 2], ['DQ', 'Dairy Queen', 1]]);
});

// A small stand-in for the database: the Customer List's records, and the old upload this app no longer reads.
function fakeDb(seed) {
  const docs = seed;
  const snap = (k) => ({ exists: k in docs, data: () => docs[k] });
  return { collection: (c) => ({
    doc: (id) => ({ get: async () => snap(c + '/' + id) }),
    where: (f, op, v) => ({ get: async () => ({ docs: Object.keys(docs).filter(k => k.startsWith(c + '/') && docs[k][f] === v).map(snap) }) })
  }) };
}

test('the Sales app reads only the Customer List; the old upload is not read, and a division with none is empty', async () => {
  const P = 'fac_uniontown', seed = {
    ['private/udcl_' + P]: { at: '2026-11-01T12:00:00Z', unrouted: [{ day: 'FRI', account: '271285', name: 'LAKESIDE SCOOPS' }] },
    // The old upload: left in the database, never shown again.
    ['salesCustomers/' + P]: { rows: [{ day: 'MON', route: '999', name: 'OLD UPLOAD ONLY' }], savedAt: 'T0' },
    ['salesCustomers/fac_charleston']: { rows: [{ day: 'MON', route: '999', name: 'OLD UPLOAD ONLY' }], savedAt: 'T0' }
  };
  LINES.filter(l => l.route).forEach(l => { seed['udclCustomers/' + P + '__' + l.account] = { plant: P, key: l.account, account: l.account, chain: l.chain, name: l.name, active: true, updatedAt: '2026-11-01T13:00:00Z' }; });
  const days = {};
  LINES.filter(l => l.route).forEach(l => { const k = l.route + '__' + l.day; (days[k] = days[k] || { plant: P, route: l.route, day: l.day, stops: [] }).stops.push({ key: l.account, name: l.name }); });
  Object.keys(days).forEach(k => { seed['udclRouteDays/' + P + '__' + k] = days[k]; });
  const db = fakeDb(seed);
  const got = await S.forSales(db, P);
  assert.equal(got.savedAt, '2026-11-01T13:00:00Z');
  assert.deepEqual(got.rows.map(r => r.name + ' ' + (r.route || 'no route') + ' = ' + r.group), ['...DQ BETHEL KNOLL 805 = Dairy Queen', 'ACORN CORNER MARKET 803 = Independents', 'BFS FOODS #48 OAKMONT 812 = Independents',
    'LAKESIDE SCOOPS no route = Independents', 'WAL-MART #1885 PINEDALE 808 = Walmart', 'WAL-MART #2603 MAPLETON 808 = Walmart']);
  assert.deepEqual(await S.forSales(db, 'fac_charleston'), { rows: [], savedAt: '' });
});

test('nothing in Operations uploads or changes the customer list any more', () => {
  const admin = require('fs').readFileSync(require.resolve('../../src/admin.js'), 'utf8');
  assert.doesNotMatch(admin, /saveSalesCustomers|renameSalesGroup/);
  assert.equal(S.adminSave, undefined);
});
