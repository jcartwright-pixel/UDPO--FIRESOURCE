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

test('Joe 11/2: a group picked on the Customer List wins over the chain; chain 0 is no group', () => {
  const lines = [
    { day: 'TUE', route: '803', chain: '415', account: '1526', name: 'KUHNS OAK HILL', group: "Kuhn's Market" },
    { day: 'TUE', route: '803', chain: '415', account: '2111', name: 'MAPLE SHOP N SAVE', group: "Shop 'n Save" },
    { day: 'WED', route: '805', chain: '415', account: '2112', name: 'PINE SHOP N SAVE', group: "Shop 'n Save" },
    { day: 'TUE', route: '803', chain: '0', account: '1196', name: 'ACORN CORNER MARKET' },
    { day: 'FRI', route: '803', chain: '0', account: '1984', name: 'QUICK STOP' }
  ];
  assert.equal(S.groupKey(lines[3]), '');
  assert.deepEqual(S.groupsOf(lines).map(g => [g.name, g.count]), [["Shop 'n Save", 2], ["Kuhn's Market", 1]]);
});

// Joe 11-9-26: "the route customer list goes through the hub only." The Sales app reads the Hub's copy (hubRouteMaster,
// hubCustomers), active customers only; the Customer List's own records are read only while the Hub has no record yet.
function hubDb(seed) {
  const db = fakeDb(seed);
  db.getAll = async (...refs) => Promise.all(refs.map(r => r.get()));
  return db;
}
test('Joe 11-9-26: the Sales app reads the Hub\'s copy of the route customer list, parts and all', async () => {
  const P = 'fac_uniontown';
  const seed = {
    // The Customer List's own record says something else: it is not read once the Hub has the plant.
    ['private/udcl_' + P]: { at: '2026-11-01T12:00:00Z' },
    ['udclCustomers/' + P + '__9']: { plant: P, key: '9', account: '9', name: 'NOT FROM THE HUB', active: true },
    ['udclRouteDays/' + P + '__899__MON']: { plant: P, route: '899', day: 'MON', stops: [{ key: '9' }] },
    ['hubRouteMaster/' + P]: { plant: P, parts: 2, sourceAt: '2026-11-09T15:00:00Z', builtAt: '2026-11-09T15:01:00Z',
      rows: [{ plant: P, route: '803', day: 2, dayName: 'TUE', stop: 1, key: '1196', account: '1196', chain: '', customer: 'ACORN CORNER MARKET' }], days: [] },
    ['hubRouteMaster/' + P + '__2']: { plant: P, part: 2,
      rows: [{ plant: P, route: '808', day: 1, dayName: 'MON', stop: 1, key: '2603', account: '2603', chain: '990', customer: 'WAL-MART #2603 MAPLETON' },
        { plant: P, route: '808', day: 3, dayName: 'WED', stop: 1, key: '1885', account: '1885', chain: '990', customer: 'WAL-MART #1885 PINEDALE' }], days: [] },
    ['hubCustomers/' + P]: { plant: P, parts: 1,
      customers: [{ key: '1196', account: '1196', name: 'ACORN CORNER MARKET', group: 'Corner Shops' }, { key: '2603', account: '2603', chain: '990', name: 'WAL-MART #2603 MAPLETON' },
        { key: '1885', account: '1885', chain: '990', name: 'WAL-MART #1885 PINEDALE' }, { key: '271285', account: '271285', name: 'LAKESIDE SCOOPS' }],
      unrouted: [{ key: '271285', account: '271285', chain: '', name: 'LAKESIDE SCOOPS', day: 'FRI' }] }
  };
  const got = await S.forSales(hubDb(seed), P);
  assert.equal(got.from, 'hub');
  assert.equal(got.savedAt, '2026-11-09T15:00:00Z');
  assert.deepEqual(got.rows.map(r => r.day + ' ' + (r.route || 'no route') + ' ' + r.name + ' = ' + r.group), ['TUE 803 ACORN CORNER MARKET = Corner Shops',
    'FRI no route LAKESIDE SCOOPS = Independents', 'WED 808 WAL-MART #1885 PINEDALE = Walmart', 'MON 808 WAL-MART #2603 MAPLETON = Walmart']);
  // Until the Hub writes a plant, that plant still reads the Customer List, and a customer marked inactive is left out.
  const old = { ['private/udcl_' + P]: { at: 'T' }, ['udclCustomers/' + P + '__1']: { plant: P, key: '1', account: '1', name: 'OPEN STORE', active: true },
    ['udclCustomers/' + P + '__2']: { plant: P, key: '2', account: '2', name: 'CLOSED STORE', active: true, inactive: true },
    ['udclRouteDays/' + P + '__801__MON']: { plant: P, route: '801', day: 'MON', stops: [{ key: '1' }, { key: '2' }] } };
  const before = await S.forSales(hubDb(old), P);
  assert.equal(before.from, 'customer-list');
  assert.deepEqual(before.rows.map(r => r.name), ['OPEN STORE']);
});
