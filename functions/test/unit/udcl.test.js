'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../../src/udcl-rules');
const S = require('../../src/udcl');

// Joe 11/1: the bridge to the United Dairy Customer List (its own app). Operations only reads its records. Made-up customers only.

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
const seed = {
  ['private/udcl_' + PLANT]: { at: '2026-11-01T12:00:00Z', unrouted: [{ day: 'FRI', account: '5005', name: 'NO ROUTE YET' }] },
  ['udclCustomers/' + PLANT + '__5001']: { plant: PLANT, key: '5001', account: '5001', name: 'ACME MARKET', dc: '30', address: '1 MAIN ST', city: 'TOWN', state: 'PA', zip: '15401', keys: '', notes: 'Back door', active: true },
  ['udclCustomers/' + PLANT + '__5002']: { plant: PLANT, key: '5002', account: '5002', name: 'BEST FOODS #2', chain: '415', dc: '30', keys: 'Ring 4', active: true },
  ['udclCustomers/' + PLANT + '__5003']: { plant: PLANT, key: '5003', account: '5003', name: 'OLD STORE', active: false },
  ['udclRouteDays/' + PLANT + '__900__TUE']: { plant: PLANT, route: '900', day: 'TUE', startTime: '4:00 AM', notes: 'Call first', map: U.packMap(U.autoMap([{ key: '5002', loadSeq: 1 }, { key: '5001', loadSeq: 3 }])),
    stops: [{ key: '5002', account: '5002', name: 'BEST FOODS #2', loadSeq: 1 }, { key: '5001', account: '5001', name: 'ACME MARKET', loadSeq: 3, note: 'Two cases' }, { key: '5003', name: 'OLD STORE', loadSeq: 2 }] },
  ['udclRouteDays/' + PLANT + '__900__FRI']: { plant: PLANT, route: '900', day: 'FRI', stops: [{ key: '5001', account: '5001', name: 'ACME MARKET', loadSeq: 2 }] }
};

test('the Sales app reads its lines from the Customer List; a plant with none keeps its own upload', async () => {
  const db = fakeDb(seed);
  const sales = await S.salesRows(db, PLANT);
  assert.equal(sales.rows.filter(r => r.route).length, 3, 'a customer no longer active is left out');
  assert.ok(sales.rows.some(r => r.name === 'NO ROUTE YET' && !r.route));
  assert.equal(await S.salesRows(db, 'fac_charleston'), null);
});

test('the drivers\' phone gets the Route Book: stops in run order with address, keys, notes and the load map', async () => {
  const db = fakeDb(seed);
  const book = await S.routeBook(db, PLANT, '900_2', 'tue');
  assert.equal(book.found, true);
  assert.equal(book.startTime, '4:00 AM');
  assert.equal(book.notes, 'Call first');
  assert.deepEqual(book.stops.map(x => x.name), ['BEST FOODS #2', 'ACME MARKET', 'OLD STORE']);
  assert.equal(book.stops[0].keys, 'Ring 4');
  assert.equal(book.stops[1].address, '1 MAIN ST, TOWN, PA 15401');
  assert.equal(book.stops[1].note, 'Two cases');
  assert.ok(Array.isArray(book.map.cells[0]), 'the map comes back as rows of numbers');
  assert.equal((await S.routeBook(db, PLANT, '900 TOWN', 'TUE')).found, true, 'a route named with words around its number');
  assert.equal((await S.routeBook(db, PLANT, '999', 'TUE')).found, false);
});

test('the Customer List\'s distribution center codes', () => {
  assert.equal(U.dcName('30'), '30 Uniontown');
  assert.equal(U.dcOf('030'), '30');
  assert.equal(U.dcOf('8'), '');
});
