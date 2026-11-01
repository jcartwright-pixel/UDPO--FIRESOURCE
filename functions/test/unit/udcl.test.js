'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../../src/udcl-rules');
const S = require('../../src/udcl');

// Joe 11/1: the United Dairy Customer List. Made-up customers only.

// A small stand-in for the database: collection / doc / get / set / where / transactions / batches.
function fakeDb(seed) {
  const docs = new Map(Object.entries(seed || {}));
  let n = 0;
  const snap = (path) => ({ exists: docs.has(path), id: path.split('/').pop(), data: () => (docs.has(path) ? JSON.parse(JSON.stringify(docs.get(path))) : undefined) });
  const ref = (col, id) => ({ id, path: col + '/' + id, get: async () => snap(col + '/' + id), set: async (v) => { docs.set(col + '/' + id, JSON.parse(JSON.stringify(v))); }, delete: async () => { docs.delete(col + '/' + id); } });
  const collection = (col) => ({
    doc: (id) => ref(col, id === undefined ? 'auto' + (++n) : id),
    add: async (v) => { const r = ref(col, 'auto' + (++n)); await r.set(v); return r; },
    where: (field, op, value) => ({ get: async () => ({ docs: [...docs.keys()].filter(k => k.startsWith(col + '/') && k.split('/').length === 2 && docs.get(k)[field] === value).map(k => snap(k)) }) })
  });
  const db = {
    docs,
    collection,
    getAll: async (...refs) => refs.map(r => snap(r.path)),
    batch: () => { const ops = []; return { set: (r, v) => ops.push(() => r.set(v)), delete: (r) => ops.push(() => r.delete()), commit: async () => { for (const o of ops) await o(); } }; },
    runTransaction: async (fn) => {
      const writes = [];
      const tx = { get: async (r) => snap(r.path), getAll: async (...refs) => refs.map(r => snap(r.path)), set: (r, v) => writes.push([r, v]) };
      const out = await fn(tx);
      for (const [r, v] of writes) await r.set(v);
      return out;
    }
  };
  return db;
}
const PLANT = 'fac_uniontown';
const people = {
  'users/boss@example.com': { status: 'ACTIVE', roles: ['ADMINISTRATOR'], facilities: ['*'] },
  'users/mgr@example.com': { status: 'ACTIVE', roles: ['MANAGER'], facilities: [PLANT] },
  'users/disp@example.com': { status: 'ACTIVE', roles: ['DISPATCHER'], facilities: [PLANT] }
};
const boss = { email: 'boss@example.com' }, mgr = { email: 'mgr@example.com' }, disp = { email: 'disp@example.com' };
const now = { now: () => new Date('2026-11-01T12:00:00Z') };

// The Route Menu's Customer By Route tab, made up: a heading row, then DAY, ROUTE, Chain, Account, Name, two load columns.
const MENU = [
  ['DAY', 'ROUTE', 'Chain', 'Account', 'Name', null, null],
  ['TUE', 900, 0, 5001, 'ACME MARKET', 3, 3],
  ['TUE', 900, 415, 5002, 'BEST FOODS #2', 1, 1],
  ['TUE', 900, 0, 5003.0, 'CORNER STORE *COD*', 7, 0],
  ['FRI', 900, 0, 5001, 'ACME MARKET', 2, 2],
  ['WED', 901, 0, 5004, 'DAIRY DELITE', null, null],
  ['TUE', 900, 0, 5001, 'ACME MARKET', 3, 3],
  ['DAY', 'RT', 'CHAIN', 'ACCOUNT', 'NAME', null, 'LOAD SEQ'],
  ['FRI', null, 0, 5005, 'NO ROUTE YET', 3, 3]
];

test('the Route Menu tab is read: day, route, account, chain, load sequence; repeats once; no route kept apart', () => {
  const m = U.menuStops(MENU);
  assert.equal(m.stops.length, 5);
  assert.deepEqual(m.stops[0], { day: 'TUE', route: '900', account: '5001', chain: '', name: 'ACME MARKET', loadSeq: 3, key: '5001' });
  assert.equal(m.stops[1].chain, '415');
  assert.equal(m.stops[2].account, '5003');
  assert.equal(m.stops[2].loadSeq, 7, 'a 0 typed over the load column falls back to the one before');
  assert.equal(m.stops[4].loadSeq, 0);
  assert.deepEqual(m.unrouted.map(x => x.name), ['NO ROUTE YET']);
  assert.equal(U.menuStops([['nothing here']]), null);
});

test('addresses by account, GPS addresses by name, and the Route Book with its truck drawing', () => {
  const a = U.addressList([[null], [1, 0, 5001, 'ACME MARKET', '1 MAIN ST', '1 MAIN ST', 'TOWN,', 'pa', 15401]]);
  assert.deepEqual(a['5001'], { address: '1 MAIN ST', address2: '', city: 'TOWN', state: 'PA', zip: '15401' });
  const g = U.gpsAddresses([['Name', 'Address', 'City', 'State', 'Route', 'Lat', 'Lon'], ["Kelly`s Cones", '2 Oak Rd', 'Elm', 'PA', 901, 39.9, -79.7]]);
  assert.equal(g[U.nameKey("KELLYS CONES")].lat, 39.9);
  const row = (n) => { const r = new Array(26).fill(null); [13, 15, 17, 21, 23, 25].forEach(c => { r[c] = n; }); return r; };
  const sheet = [
    ['Tuesday', null, null, null, null, null, null, 'Start Time 4:00 AM'],
    ['Chain', 'Account', 'Name', 'Run Order', 'Load SEQ'],
    [0, 5002, 'BEST FOODS #2', 1, 1, null, null, null, 'Key on ring'],
    [0, 5001, 'ACME MARKET', 2, 3],
    Object.assign(row(1), { 0: null }), [], Object.assign(new Array(26).fill(null), { 13: 'Side Door' }), row(3), [],
    ['Instructions'], ['Call before you get there']
  ];
  const b = U.routeBook({ 'Rt 900': sheet, 'Sheet1': [] });
  assert.deepEqual(Object.keys(b), ['900|TUE']);
  assert.equal(b['900|TUE'].startTime, '4:00 AM');
  assert.deepEqual(b['900|TUE'].stops.map(s => [s.account, s.run, s.keys]), [['5002', 1, 'Key on ring'], ['5001', 2, '']]);
  assert.deepEqual(b['900|TUE'].instructions, ['Call before you get there']);
  assert.equal(b['900|TUE'].grid.length, 2);
  assert.equal(b['900|TUE'].door, 1);
});

test('run order: the Route Book where it fits, else from the back door in; a saved order is kept and new stops slot in by load', () => {
  const stops = U.menuStops(MENU).stops.filter(s => s.route === '900' && s.day === 'TUE');
  assert.deepEqual(U.runOrder(stops, null, null).map(s => s.key), ['5003', '5001', '5002'], 'highest load number comes off first');
  const book = { stops: [{ account: '5002', name: 'BEST FOODS #2', run: 1 }, { account: '5001', name: 'ACME MARKET', run: 2 }] };
  assert.deepEqual(U.runOrder(stops, null, book).map(s => s.key), ['5002', '5001', '5003']);
  assert.deepEqual(U.runOrder(stops, ['5002', '5001'], null).map(s => s.key), ['5003', '5002', '5001'], 'a new stop with load 7 goes before the ones with lower loads');
});

test('load maps: rows shared out front first, the Route Book drawing only when its numbers still match, saved maps cleaned', () => {
  const stops = [{ loadSeq: 1 }, { loadSeq: 1 }, { loadSeq: 2 }, { loadSeq: 0 }];
  const m = U.autoMap(stops);
  assert.equal(m.rows, 12);
  assert.deepEqual(m.cells[0], [1, 1, 1, 1, 1, 1]);
  assert.deepEqual(m.cells[11], [2, 2, 2, 2, 2, 2]);
  assert.equal(U.mapCounts(m)[1], 48);
  assert.equal(U.bookMap({ grid: [[1, 1, 1, 2, 2, 2]], door: null }, stops).rows, 1);
  assert.equal(U.bookMap({ grid: [[9, 9, 9, 9, 9, 9]] }, stops), null);
  const c = U.cleanMap({ rows: 99, door: 'x', cells: [['3', 'a', -1]] });
  assert.equal(c.rows, U.MAX_ROWS);
  assert.deepEqual(c.cells[0], [3, null, null, null, null, null]);
  assert.equal(c.door, null);
  // The database holds no list inside a list: each row is kept as words, and read back the same.
  const packed = U.packMap(m);
  assert.equal(packed.cells[0], '1,1,1,1,1,1');
  assert.ok(packed.cells.every(r => typeof r === 'string'));
  assert.deepEqual(U.cleanMap(packed), m);
});

test('the lists by customer, route and day, filtered and sorted', () => {
  const customers = { a: { key: 'a', name: 'ZED MART', account: '2', city: 'ELM' }, b: { key: 'b', name: 'ALPHA', account: '1', city: 'OAK' } };
  const rds = [{ route: '901', day: 'MON', stops: [{ key: 'a', loadSeq: 2 }, { key: 'b', loadSeq: 1 }] }, { route: '900', day: 'FRI', stops: [{ key: 'a', loadSeq: 1 }] }];
  const lines = U.lines(customers, rds);
  assert.deepEqual(U.pick(lines, { sort: 'route' }).map(l => l.route + l.day + l.stop), ['900FRI1', '901MON1', '901MON2']);
  assert.deepEqual(U.pick(lines, { sort: 'customer' }).map(l => l.name), ['ALPHA', 'ZED MART', 'ZED MART']);
  assert.deepEqual(U.pick(lines, { q: 'oak' }).map(l => l.key), ['b']);
  assert.deepEqual(U.pick(lines, { day: 'FRI' }).map(l => l.key), ['a']);
  const rows = U.customerRows(customers, lines);
  assert.deepEqual(rows.find(r => r.key === 'a').days, ['MON', 'FRI']);
  assert.equal(U.dayLetters(['MON', 'FRI']), '- M - - - F -');
  assert.equal(U.addressLine({ address: '1 Main', city: 'Elm', state: 'PA', zip: '15401' }), '1 Main, Elm, PA 15401');
});

async function imported() {
  const db = fakeDb(people);
  const m = U.menuStops(MENU);
  const out = await S.udclCall(db, boss, PLANT, { op: 'importMenu', stops: m.stops, unrouted: m.unrouted, addresses: { 5001: { address: '1 MAIN ST', city: 'TOWN', state: 'PA', zip: '15401' } }, gps: {},
    book: { '900|TUE': { startTime: '4:00 AM', instructions: ['Call first'], stops: [{ account: '5002', name: 'BEST FOODS #2', run: 1, keys: 'Ring 4' }], grid: [] } }, fileName: 'menu.xlsb' }, now);
  return { db, out };
}

test('an import makes the customers and route days; the Route Book fills only what is blank', async () => {
  const { db, out } = await imported();
  assert.equal(out.counts.customers, 5);
  assert.equal(out.counts.routeDays, 3);
  assert.equal(out.counts.noLoadSeq, 1);
  const v = await S.udclCall(db, disp, PLANT, { op: 'view' });
  assert.equal(v.canEdit, false);
  assert.equal(v.customers['5001'].address, '1 MAIN ST');
  assert.equal(v.customers['5002'].keys, 'Ring 4');
  const tue = v.routeDays.find(r => r.route === '900' && r.day === 'TUE');
  assert.equal(tue.startTime, '4:00 AM');
  assert.equal(tue.notes, 'Call first');
  assert.equal(tue.map.rows, 12);
  assert.ok([...db.docs.values()].every(d => !d.map || d.map.cells.every(r => typeof r === 'string')), 'no list inside a list is saved');
  assert.equal(v.imported.fileName, 'menu.xlsb');
  assert.equal(v.customers['5001'].dc, U.PLANT_DC[PLANT], 'a plant\'s customers start with its distribution center code');
});

test('distribution center codes: only ours are kept, written the one way', () => {
  assert.equal(U.dcOf('030'), '30');
  assert.equal(U.dcOf(50), '50');
  assert.equal(U.dcOf('8'), '');
  assert.equal(U.dcName('1'), '1 Martins Ferry');
  assert.equal(U.dcName(''), '');
  assert.deepEqual(U.cleanCustomer({ dc: '7', name: 'X' }), { name: 'X', dc: '7' });
  assert.equal(U.PLANT_DC.fac_uniontown, '30');
});

test('only an Administrator or Manager changes the order, the rev stops two people saving over each other, and the import keeps it', async () => {
  const { db } = await imported();
  const tue = () => S.udclCall(db, mgr, PLANT, { op: 'view' }).then(v => v.routeDays.find(r => r.route === '900' && r.day === 'TUE'));
  const before = await tue();
  await assert.rejects(S.udclCall(db, disp, PLANT, { op: 'saveRouteDay', route: '900', day: 'TUE', stops: [] }), /Administrator or Manager/);
  const order = before.stops.map(s => ({ key: s.key, loadSeq: s.loadSeq, note: '' })).reverse();
  order[0].note = 'Back door only';
  const saved = await S.udclCall(db, mgr, PLANT, { op: 'saveRouteDay', route: '900', day: 'TUE', rev: before.rev, stops: order, startTime: '3:30 AM' }, now);
  assert.equal(saved.routeDay.rev, before.rev + 1);
  assert.equal(saved.routeDay.updatedBy, 'mgr@example.com');
  await assert.rejects(S.udclCall(db, mgr, PLANT, { op: 'saveRouteDay', route: '900', day: 'TUE', rev: before.rev, stops: order }), /Someone else changed/);
  await assert.rejects(S.udclCall(db, mgr, PLANT, { op: 'saveRouteDay', route: '900', day: 'TUE', stops: [{ key: 'nobody' }] }), /not on the customer list/);
  // Importing again keeps the order, the note and the start time.
  const m = U.menuStops(MENU);
  await S.udclCall(db, boss, PLANT, { op: 'importMenu', stops: m.stops, unrouted: m.unrouted }, now);
  const after = await tue();
  assert.deepEqual(after.stops.map(s => s.key), order.map(s => s.key));
  assert.equal(after.stops[0].note, 'Back door only');
  assert.equal(after.startTime, '3:30 AM');
  // A dispatcher may not import.
  await assert.rejects(S.udclCall(db, mgr, PLANT, { op: 'importMenu', stops: m.stops }), /Only an administrator/);
});

test('a route day off the Route Menu is removed and its customer no longer active; customers are added and changed', async () => {
  const { db } = await imported();
  const m = U.menuStops(MENU.filter(r => r[1] !== 901));
  const out = await S.udclCall(db, boss, PLANT, { op: 'importMenu', stops: m.stops, unrouted: m.unrouted }, now);
  assert.equal(out.counts.removedDays, 1);
  assert.equal(out.counts.inactive, 1);
  const v = await S.udclCall(db, mgr, PLANT, { op: 'view' });
  assert.equal(v.customers['5004'].active, false);
  const add = await S.udclCall(db, mgr, PLANT, { op: 'saveCustomer', add: true, account: '6000', fields: { name: 'New Shop', city: 'Elm' } }, now);
  assert.equal(add.customer.key, '6000');
  await assert.rejects(S.udclCall(db, mgr, PLANT, { op: 'saveCustomer', add: true, account: '6000', fields: { name: 'Again' } }), /already on the list/);
  const ch = await S.udclCall(db, mgr, PLANT, { op: 'saveCustomer', key: '6000', fields: { phone: '555-0100', state: 'pa' } }, now);
  assert.equal(ch.customer.phone, '555-0100');
  assert.equal(ch.customer.state, 'PA');
  assert.equal(ch.customer.city, 'Elm');
});

test('the bridges: the Sales app reads its lines from the Customer List, and the phone gets the route book', async () => {
  const { db } = await imported();
  const sales = await S.salesRows(db, PLANT);
  assert.equal(sales.rows.filter(r => r.route).length, 5);
  assert.ok(sales.rows.some(r => r.name === 'NO ROUTE YET' && !r.route));
  assert.equal(await S.salesRows(db, 'fac_charleston'), null, 'a plant with no Customer List keeps the Sales app upload');
  const book = await S.routeBook(db, PLANT, '900_2', 'tue');
  assert.equal(book.found, true);
  assert.equal(book.startTime, '4:00 AM');
  assert.equal(book.stops[0].stop, 1);
  assert.ok(book.stops.some(s => s.address === '1 MAIN ST, TOWN, PA 15401'));
  assert.equal((await S.routeBook(db, PLANT, '900 TOWN', 'TUE')).found, true, 'a route named with words around its number');
  assert.equal((await S.routeBook(db, PLANT, '999', 'TUE')).found, false);
});

test('someone not on the Users list, or not at the plant, is refused', async () => {
  const db = fakeDb(people);
  await assert.rejects(S.udclCall(db, { email: 'stranger@example.com' }, PLANT, { op: 'view' }), /not on the Users list/);
  await assert.rejects(S.udclCall(db, mgr, 'fac_charleston', { op: 'view' }), /not set up for/);
});
