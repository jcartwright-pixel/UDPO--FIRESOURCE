'use strict';
// Missing addresses and map points (Joe 11-12-26): made-up customers, a made-up key, no call leaves the test.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../../src/addressfill');
const R = require('../../src/routemaster');

function fakeDb(start) {
  const docs = JSON.parse(JSON.stringify(start || {}));
  const col = (c) => (docs[c] = docs[c] || {});
  const snap = (c, pred) => ({ docs: Object.entries(col(c)).filter(([, v]) => !pred || pred(v)).map(([id, v]) => ({ id, data: () => v })) });
  return {
    docs,
    collection: (c) => ({
      get: async () => snap(c),
      where: (f, op, val) => ({ get: async () => snap(c, v => v[f] === val) }),
      add: async (v) => { col(c)['log' + Object.keys(col(c)).length] = v; },
      doc: (id) => ({ get: async () => ({ exists: id in col(c), data: () => col(c)[id] }), set: async (v) => { col(c)[id] = JSON.parse(JSON.stringify(v)); } })
    })
  };
}
function fakeFetch() {
  const seen = [];
  const f = async (url) => {
    const u = new URL(url); seen.push(u.hostname);
    if (u.hostname.startsWith('revgeocode')) {
      const at = u.searchParams.get('at');
      return { ok: true, status: 200, json: async () => (at === '40.1,-79.9' ? { items: [{ distance: 12, address: { houseNumber: '12', street: 'Made-Up Rd', city: 'Sampletown', stateCode: 'PA', postalCode: '15401-1234', label: '12 Made-Up Rd, Sampletown, PA 15401' } }] } : { items: [] }) };
    }
    return { ok: true, status: 200, json: async () => ({ items: [{ address: { label: '5 Sample Ave, Othertown, OH' }, position: { lat: 39.5, lng: -80.5 }, scoring: { queryScore: 0.9 } }] }) };
  };
  f.seen = seen;
  return f;
}
const base = (o) => Object.assign({ plant: 'fac_uniontown', chain: '', address: '', address2: '', city: '', state: '', zip: '', lat: null, lon: null, active: true }, o);
const start = () => ({
  private: { here: { apiKey: 'made-up-key-1234' } },
  udclRouteMaster: { fac_uniontown: {} },
  udclCustomers: {
    a: base({ key: 'fac_uniontown__101', account: '101', name: 'SAMPLE DAIRY BAR', lat: 40.1, lon: -79.9 }),
    b: base({ key: 'fac_uniontown__102', account: '102', name: 'MADE-UP MARKET', address: '5 Sample Ave', city: 'Othertown', state: 'OH' }),
    c: base({ key: 'fac_uniontown__103', account: '103', name: 'NOWHERE STOP', lat: 41, lon: -81 }),
    d: base({ key: 'fac_uniontown__104', account: '104', name: 'ALL SET STORE', address: '1 Done St', city: 'Sampletown', lat: 40, lon: -80 }),
    e: base({ key: 'fac_uniontown__105', account: '105', name: 'GONE STORE', lat: 40.2, lon: -79.8, active: false })
  }
});

test('a map point with no address gets the address there; an address with no map point gets its map point; each once', async () => {
  const db = fakeDb(start()), f = fakeFetch();
  const r = await F.fill(db, { fetchFn: f, noRebuild: true, now: new Date('2026-11-12T23:40:00Z') });
  assert.deepEqual([r.plants[0].looked, r.plants[0].found, r.plants[0].notFound], [3, 2, 1]);
  const fill = db.docs.hubAddressFill;
  assert.deepEqual([fill.fac_uniontown__101.address, fill.fac_uniontown__101.city, fill.fac_uniontown__101.zip, fill.fac_uniontown__101.from], ['12 Made-Up Rd', 'Sampletown', '15401', 'map point']);
  assert.deepEqual([fill.fac_uniontown__102.lat, fill.fac_uniontown__102.lon, fill.fac_uniontown__102.from], [39.5, -80.5, 'address']);
  assert.equal(fill.fac_uniontown__103.notFound, true);
  assert.ok(!fill.fac_uniontown__104 && !fill.fac_uniontown__105, 'a complete or inactive customer is not looked up');
  assert.equal(Object.values(db.docs.hubPorterLog)[0].count, 3);
  // Nothing new: nothing is looked up again.
  const again = await F.fill(db, { fetchFn: f, noRebuild: true });
  assert.equal(again.plants[0].looked, 0);
  assert.equal(f.seen.length, 3);
  // A moved map point is looked up again.
  db.docs.udclCustomers.a.lat = 40.3;
  assert.equal((await F.fill(db, { fetchFn: f, noRebuild: true })).plants[0].looked, 1);
});

test('a share at a time: the rest waits for the next run', async () => {
  const db = fakeDb(start());
  const r = await F.fill(db, { fetchFn: fakeFetch(), noRebuild: true, perRun: 2 });
  assert.deepEqual([r.plants[0].looked, r.plants[0].left], [2, 1]);
});

test('no HERE key: nothing is looked up and it says so', async () => {
  const s = start(); delete s.private;
  const r = await F.fill(fakeDb(s), { fetchFn: fakeFetch(), noRebuild: true });
  assert.match(r.stopped, /HERE key/);
});

test('the Hub customer list shows a found value only where the Customer List has none, and marks it', () => {
  const customers = [
    { key: 'k1', account: '101', name: 'SAMPLE DAIRY BAR', lat: 40.1, lon: -79.9, address: '' },
    { key: 'k2', account: '102', name: 'MADE-UP MARKET', address: '5 Sample Ave', city: 'Othertown', state: 'OH' },
    { key: 'k3', account: '103', name: 'OWN ADDRESS', address: '7 Own St', city: 'Sampletown', lat: 40, lon: -80 }
  ];
  const fills = {
    k1: { from: 'map point', address: '12 Made-Up Rd', city: 'Sampletown', state: 'PA', zip: '15401' },
    k2: { from: 'address', lat: 39.5, lon: -80.5 },
    k3: { from: 'map point', address: 'WRONG', lat: 1, lon: 1 }
  };
  const b = R.build('fac_uniontown', 'Uniontown', { customers, routeDays: [], weekly: [], meta: null, fills });
  const by = (n) => b.customers.customers.find(x => x.name === n);
  assert.deepEqual([by('SAMPLE DAIRY BAR').address, by('SAMPLE DAIRY BAR').addressFrom, by('SAMPLE DAIRY BAR').lat], ['12 Made-Up Rd, Sampletown, PA 15401', 'map point', 40.1]);
  assert.deepEqual([by('MADE-UP MARKET').lat, by('MADE-UP MARKET').lon, by('MADE-UP MARKET').pointFrom], [39.5, -80.5, 'address lookup']);
  assert.deepEqual([by('OWN ADDRESS').address, by('OWN ADDRESS').lat, by('OWN ADDRESS').addressFrom], ['7 Own St, Sampletown', 40, undefined]);
});
