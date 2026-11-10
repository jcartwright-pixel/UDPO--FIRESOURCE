'use strict';
// Joe 11-9-26: the route customer list is read only through the Hub (hubRouteMaster, hubCustomers). The drivers' Route Book
// reads the Hub's copy; until the Hub has written a plant, the phone keeps the Customer List's own records. Made-up stores only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('../../src/hubroutes');
const U = require('../../src/udcl-rules');

function fakeDb(docs) {
  const snap = (k) => ({ exists: k in docs, data: () => docs[k] });
  const db = { collection: (c) => ({ doc: (id) => ({ get: async () => snap(c + '/' + id) }) }) };
  db.getAll = async (...refs) => Promise.all(refs.map(r => r.get()));
  return db;
}

const P = 'fac_uniontown';
const MAP = U.packMap(U.autoMap([{ key: '5002', loadSeq: 1 }, { key: '5001', loadSeq: 3 }]));
const SEED = {
  ['hubRouteMaster/' + P]: { plant: P, parts: 2, sourceAt: '2026-11-09T15:00:00Z',
    rows: [{ plant: P, route: '900', day: 2, dayName: 'TUE', stop: 2, load: 3, key: '5001', account: '5001', customer: 'ACME MARKET', note: 'Two cases' }],
    days: [{ plant: P, route: '900', day: 2, dayName: 'TUE', stops: 2, startTime: '4:00 AM', notes: 'Call first', map: MAP }] },
  ['hubRouteMaster/' + P + '__2']: { plant: P, part: 2,
    rows: [{ plant: P, route: '900', day: 2, dayName: 'TUE', stop: 1, load: 1, key: '5002', account: '5002', customer: 'BEST FOODS #2' },
      { plant: P, route: '900', day: 5, dayName: 'FRI', stop: 1, load: 2, key: '5001', account: '5001', customer: 'ACME MARKET' }],
    days: [{ plant: P, route: '900', day: 5, dayName: 'FRI', stops: 1 }] },
  ['hubCustomers/' + P]: { plant: P, parts: 1, unrouted: [], customers: [
    { key: '5001', account: '5001', name: 'ACME MARKET', address: '1 MAIN ST, TOWN, PA 15401', phone: '555-0100', keys: '', notes: 'Back door', lat: 39.9, lon: -79.7 },
    { key: '5002', account: '5002', name: 'BEST FOODS #2', address: '', keys: 'Ring 4', lat: null, lon: null }] }
};

test('the drivers\' Route Book from the Hub: stops in run order with address, keys, notes and the load map', async () => {
  const book = await H.routeBook(fakeDb(SEED), P, '900_2', 'tue');
  assert.equal(book.found, true);
  assert.equal(book.from, 'hub');
  assert.equal(book.dayName, U.DAY_NAMES.TUE);
  assert.equal(book.startTime, '4:00 AM');
  assert.equal(book.notes, 'Call first');
  assert.deepEqual(book.stops.map(x => x.stop + ' ' + x.name + ' load ' + x.loadSeq), ['1 BEST FOODS #2 load 1', '2 ACME MARKET load 3']);
  assert.equal(book.stops[0].keys, 'Ring 4');
  assert.equal(book.stops[1].address, '1 MAIN ST, TOWN, PA 15401');
  assert.equal(book.stops[1].note, 'Two cases');
  assert.equal(book.stops[1].notes, 'Back door');
  assert.equal(book.stops[1].lat, 39.9);
  assert.ok(Array.isArray(book.map.cells[0]), 'the map comes back as rows of numbers');
  assert.equal(book.updatedAt, '2026-11-09T15:00:00Z');
  assert.equal((await H.routeBook(fakeDb(SEED), P, '900 TOWN', 'TUE')).found, true, 'a route named with words around its number');
  assert.equal((await H.routeBook(fakeDb(SEED), P, '999', 'TUE')).found, false);
  assert.equal((await H.routeBook(fakeDb(SEED), P, '900', 'FRI')).stops.length, 1, 'the other day of the same route');
});

test('until the Hub has written a plant, the Route Book answers null so the phone keeps the Customer List', async () => {
  assert.equal(await H.routeBook(fakeDb({}), P, '900', 'TUE'), null);
  const src = fs.readFileSync(path.join(__dirname, '../../src/phone.js'), 'utf8');
  assert.match(src, /require\('\.\/hubroutes'\)\.routeBook\([^)]*\)\) \|\| require\('\.\/udcl'\)\.routeBook/, 'phone.js asks the Hub first, then the Customer List');
});
