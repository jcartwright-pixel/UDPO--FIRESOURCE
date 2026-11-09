'use strict';
// The route customer list through the Hub (Joe 11-9-26): hubRouteMaster and hubCustomers from the Customer List's records.
// Made-up stores only.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../src/routemaster');

const customers = [
  { key: '1522|10', account: '1522', chain: '10', name: 'MAPLE MARKET', city: 'Brookfield', state: 'PA', zip: '15000', address: '1 Elm St', phone: '555-0100', keys: 'Back door', lat: 39.9, lon: -79.7, updatedAt: '2026-11-08T10:00:00Z' },
  { key: '1522|20', account: '1522', chain: '20', name: 'OAK CORNER', updatedAt: '2026-11-09T09:00:00Z' },
  { key: '51', account: '51', chain: '', name: 'PINE GROCERY', inactive: true, updatedAt: '2026-11-01T00:00:00Z' },
  { key: '77', account: '77', chain: '', name: 'BIRCH SHOP', active: false },
  { key: '88', account: '88', chain: '', name: 'CEDAR STOP' }
];
const routeDays = [
  { route: '844', day: 'TUE', startTime: '4:30 AM', notes: 'Gate code at office', map: { rows: 2, door: null, cells: ['1,1,,,,', '2,,,,,'] }, palletUses: { '1522|10': 'HIGH' }, updatedAt: '2026-11-09T12:00:00Z',
    stops: [{ key: '1522|10', loadSeq: 2 }, { key: '51', loadSeq: 1 }, { key: '1522|20', loadSeq: 1, note: 'Ring bell' }] },
  { route: '803', day: 'MON', stops: [{ key: '77' }] },
  { route: '803', day: 'XYZ', stops: [{ key: '1522|10' }] }
];
const weekly = [
  { id: '2026-10-31', stops: [{ route: '844', customer_no: '1522', tue: 40 }, { route: '844', customer_no: '9', tue: 5 }] },
  { id: '2026-10-24', stops: [{ route: '844', customer_no: '1522', tue: 20 }] },
  { id: '2026-10-17', stops: [{ route: '844', customer_no: '1522', tue: 0 }] }
];
const meta = { unrouted: [{ key: '88', account: '88', name: 'CEDAR STOP', day: 'WED' }, { key: '51', account: '51', name: 'PINE GROCERY', day: 'WED' }] };
const b = R.build('fac_uniontown', 'Uniontown', { customers, routeDays, weekly, meta });

test('every stop in run order, active customers only, each row with its plant and chain', () => {
  const rm = b.routeMaster;
  assert.equal(rm.plant, 'fac_uniontown');
  assert.equal(rm.activeOnly, true);
  assert.deepEqual(rm.rows.map(r => [r.route, r.day, r.stop, r.load, r.account, r.chain, r.customer]),
    [['844', 2, 1, 2, '1522', '10', 'MAPLE MARKET'], ['844', 2, 2, 1, '1522', '20', 'OAK CORNER']]);
  assert.ok(rm.rows.every(r => r.plant === 'fac_uniontown'));
  assert.equal(rm.counts.inactiveLeftOut, 2, 'one inactive, one active === false');
  assert.equal(rm.sourceAt, '2026-11-09T12:00:00Z');
});

test('route days carry start time, notes and load map; empty days and unknown days are left out', () => {
  assert.deepEqual(b.routeMaster.days.map(d => [d.route, d.dayName, d.stops, d.startTime, d.notes]), [['844', 'TUE', 2, '4:30 AM', 'Gate code at office']]);
  assert.deepEqual(b.routeMaster.days[0].map.cells, ['1,1,,,,', '2,,,,,']);
});

test('pallet uses and case columns per stop, from the weekly route report on that route and day', () => {
  const [a, o] = b.routeMaster.rows;
  assert.equal(a.palletUses, 'HIGH');
  assert.equal(o.palletUses, '');
  assert.equal(o.note, 'Ring bell');
  // Both 1522 stores match the report by route and account (the report has no chain).
  assert.deepEqual(a.cases, { low: 20, middle: 30, average: 30, high: 40, last5: 30, deliveries: 2, newest: '2026-10-31' });
  assert.equal(R.caseColumns([]), null);
});

test('hubCustomers: active customers with details and route days; unrouted without inactive ones', () => {
  const c = b.customers;
  assert.deepEqual(c.customers.map(x => x.name), ['CEDAR STOP', 'MAPLE MARKET', 'OAK CORNER']);
  const m = c.customers.find(x => x.name === 'MAPLE MARKET');
  assert.equal(m.address, '1 Elm St, Brookfield, PA 15000');
  assert.deepEqual([m.lat, m.lon, m.keys, m.plant], [39.9, -79.7, 'Back door', 'fac_uniontown']);
  assert.deepEqual(m.routes, [{ route: '844', day: 2, dayName: 'TUE', stop: 1 }]);
  assert.equal(c.customers.find(x => x.name === 'OAK CORNER').lat, null);
  assert.deepEqual(c.unrouted.map(x => x.name), ['CEDAR STOP']);
});

test('a plant too big for one record goes into parts, nothing dropped', () => {
  const rows = Array.from({ length: 6000 }, (_, i) => ({ plant: 'p', route: '8' + i, customer: 'X'.repeat(200) }));
  const p = R.parts('p', { plant: 'p', rows, days: [] }, ['rows', 'days']);
  assert.ok(p.length > 1);
  assert.equal(p[0][0], 'p');
  assert.equal(p[1][0], 'p__2');
  assert.equal(p[0][1].parts, p.length);
  assert.equal(p.reduce((t, x) => t + x[1].rows.length, 0), 6000);
  assert.ok(p.every(x => Buffer.byteLength(JSON.stringify(x[1])) < 1000000));
  assert.equal(R.parts('p', { plant: 'p', rows: [] }, ['rows'])[0][1].parts, 1);
});

test('rebuildPlant reads only the Customer List and writes only the two Hub records', async () => {
  const written = [], read = new Set();
  const docs = { udclCustomers: customers.map(c => Object.assign({ plant: 'fac_uniontown' }, c)), udclRouteDays: routeDays.map(r => Object.assign({ plant: 'fac_uniontown' }, r)), routeWeekly: weekly };
  const snap = (arr) => ({ docs: arr.map(d => ({ id: d.id, data: () => d })) });
  const db = {
    collection: (name) => ({
      where: () => ({ get: async () => { read.add(name); return snap(docs[name] || []); } }),
      get: async () => { read.add(name); return snap(docs[name] || []); },
      doc: (id) => ({ id, col: name, get: async () => { read.add(name); return name === 'private' ? { exists: true, data: () => meta } : { exists: true, data: () => ({ plantName: 'Uniontown' }) }; } })
    }),
    batch: () => ({ set: (ref, r) => written.push([ref.col, ref.id, r]), commit: async () => {} })
  };
  const r = await R.rebuildPlant(db, 'fac_uniontown', '2026-11-09T20:00:00Z');
  assert.equal(r.counts.stops, 2);
  assert.deepEqual(written.map(w => w[0] + '/' + w[1]), ['hubRouteMaster/fac_uniontown', 'hubCustomers/fac_uniontown']);
  assert.equal(written[0][2].builtAt, '2026-11-09T20:00:00Z');
  assert.equal(written[0][2].plantName, 'Uniontown');
  assert.deepEqual([...read].sort(), ['private', 'routeWeekly', 'udclCustomers', 'udclRouteDays', 'udclRouteMaster']);
});
