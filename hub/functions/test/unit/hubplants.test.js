'use strict';
// The plants' own map points (MapMaker 11-12-26): made-up addresses and a made-up key only. No call leaves the test.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../src/hubplants');

function fakeDb(start) {
  const docs = JSON.parse(JSON.stringify(start || {}));
  const col = (c) => (docs[c] = docs[c] || {});
  return {
    docs,
    collection: (c) => ({
      get: async () => ({ docs: Object.entries(col(c)).map(([id, v]) => ({ id, data: () => v })) }),
      listDocuments: async () => Object.keys(col(c)).map(id => ({ id })),
      doc: (id) => ({
        get: async () => ({ exists: id in col(c), data: () => col(c)[id] }),
        set: async (v) => { col(c)[id] = JSON.parse(JSON.stringify(v)); }
      })
    })
  };
}
function fakeFetch(found) {
  const seen = [];
  const f = async (url) => { const u = new URL(url); seen.push(u.searchParams.get('q'));
    const hit = found(u.searchParams.get('q'));
    return { ok: true, status: 200, json: async () => ({ items: hit ? [{ address: { label: hit.label }, position: { lat: hit.lat, lng: hit.lon } }] : [] }) }; };
  f.seen = seen;
  return f;
}
const KEY = { private: { here: { apiKey: 'made-up-key-1234' } } };
const now = new Date('2026-11-12T20:00:00Z');

test('the fill adds every plant, takes the address from Route & Trip and the map point from the lookup', async () => {
  const db = fakeDb(Object.assign({}, KEY, {
    routeEstimator: { locations: { list: [{ name: 'United Dairy Uniontown', address: '1 Made-Up St, Sampletown, PA' }, { name: 'Sample Depot', address: '2 Made-Up Rd, Othertown, OH' }] } },
    hubCustomers: { fac_uniontown: {}, fac_uniontown__2: {}, fac_sample_valley: {} }
  }));
  const f = fakeFetch((q) => (/Sampletown/.test(q) ? { lat: 39.9, lon: -79.7, label: '1 Made-Up St, Sampletown, PA 15401' } : null));
  const r = await L.fill(db, { fetchFn: f, now });
  assert.deepEqual(r.added.sort(), ['fac_charleston', 'fac_martins_ferry', 'fac_sample_depot', 'fac_sample_valley', 'fac_uniontown']);
  assert.equal(db.docs.hubPlants.fac_sample_depot.address, '2 Made-Up Rd, Othertown, OH', 'a Route & Trip starting point that is not a plant is kept, for the DC check');
  const u = db.docs.hubPlants.fac_uniontown;
  assert.equal(u.name, 'Uniontown');
  assert.equal(u.address, '1 Made-Up St, Sampletown, PA');
  assert.deepEqual([u.lat, u.lon, u.active, u.source], [39.9, -79.7, true, 'auto']);
  // A plant with no address is kept with its name, so its customers still show; an administrator adds the address.
  assert.deepEqual([db.docs.hubPlants.fac_sample_valley.name, db.docs.hubPlants.fac_sample_valley.lat], ['Sample Valley', null]);
  assert.equal(f.seen.length, 2, 'only addresses are looked up');
  // Nothing changed: nothing is written or looked up again.
  const again = await L.fill(db, { fetchFn: f, now });
  assert.equal(again.added.length + again.filled.length, 0);
  assert.equal(f.seen.length, 3);
});

test('a plant an administrator saved is never changed by the fill', async () => {
  const db = fakeDb(Object.assign({}, KEY, { hubPlants: { fac_uniontown: { plant: 'fac_uniontown', name: 'Uniontown Plant', address: '9 Made-Up Ave, Sampletown, PA', lat: 40, lon: -80, source: 'hub' } } }));
  const r = await L.fill(db, { fetchFn: fakeFetch(() => ({ lat: 1, lon: 1, label: 'x' })), now });
  assert.ok(r.kept.indexOf('fac_uniontown') >= 0);
  assert.equal(db.docs.hubPlants.fac_uniontown.name, 'Uniontown Plant');
});

test('with no HERE key the plants are still added, without a map point', async () => {
  const db = fakeDb({ hubCustomers: { fac_uniontown: {} } });
  await L.fill(db, { fetchFn: fakeFetch(() => { throw new Error('should not ask'); }), now });
  assert.equal(db.docs.hubPlants.fac_uniontown.lat, null);
  assert.ok(db.docs.hubPlants.fac_uniontown.address, 'Route & Trip\'s own starting list gives the address');
});

test('saving a plant: typed map point, looked-up address, plain refusals', async () => {
  const db = fakeDb(KEY);
  const f = fakeFetch((q) => (/Made-Up/.test(q) ? { lat: 38.35, lon: -81.63, label: '5 Made-Up Blvd, Sampleton, WV' } : null));
  const a = await L.save(db, 'pat.admin@uniteddairy.com', { name: 'Sample River', address: '5 Made-Up Blvd, Sampleton, WV' }, { fetchFn: f, now });
  assert.equal(a.id, 'fac_sample_river');
  assert.deepEqual([a.lat, a.lon, a.source, a.savedBy], [38.35, -81.63, 'hub', 'pat.admin@uniteddairy.com']);
  const b = await L.save(db, 'pat.admin@uniteddairy.com', { id: 'fac_uniontown', name: 'Uniontown', address: '', lat: '39.9', lon: '-79.7', active: false }, { fetchFn: f, now });
  assert.deepEqual([b.lat, b.lon, b.active], [39.9, -79.7, false]);
  assert.equal(f.seen.length, 1, 'a typed map point is not looked up');
  await assert.rejects(L.save(db, 'x', { name: '' }, { fetchFn: f }), /Give the plant a name/);
  await assert.rejects(L.save(db, 'x', { name: 'A', lat: 'abc', lon: '1' }, { fetchFn: f }), /map point could not be read/);
  await assert.rejects(L.save(db, 'x', { name: 'A', address: '1 Nowhere' }, { fetchFn: f }), (e) => e.code === 'NOT_FOUND');
  const list = await L.read(db);
  assert.deepEqual(list.plants.map(p => p.name), ['Sample River', 'Uniontown']);
});

test('the hub call: anyone active reads the plants, only administrators save', async () => {
  const H = require('../../src/hub');
  const db = fakeDb(Object.assign({}, KEY, {
    users: { 'pat.admin@uniteddairy.com': { status: 'ACTIVE', roles: ['Administrator'] }, 'sam.sales@uniteddairy.com': { status: 'ACTIVE', roles: ['Sales'] } },
    hubPlants: { fac_uniontown: { plant: 'fac_uniontown', name: 'Uniontown', address: '1 Made-Up St', lat: 39.9, lon: -79.7, source: 'auto' } }
  }));
  const r = await H.hubCall(db, { email: 'sam.sales@uniteddairy.com' }, { op: 'plantLocations' }, {});
  assert.equal(r.plants[0].name, 'Uniontown');
  await assert.rejects(H.hubCall(db, { email: 'sam.sales@uniteddairy.com' }, { op: 'savePlantLocation', name: 'X', lat: 1, lon: 1 }, {}), /Only an administrator/);
  const s = await H.hubCall(db, { email: 'pat.admin@uniteddairy.com' }, { op: 'savePlantLocation', id: 'fac_uniontown', name: 'Uniontown', address: '1 Made-Up St', lat: 39.91, lon: -79.71 }, {});
  assert.equal(s.lat, 39.91);
});
