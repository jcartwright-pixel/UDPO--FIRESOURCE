'use strict';
// The Hub's porter (Joe 11-10-26): HERE for the MapMaker, with a made-up key and made-up places only. No call leaves the test.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../src/porter');

const KEY = 'made-up-key-1234';
function fakeDb(key) {
  const logs = [];
  return {
    logs,
    collection: (c) => ({
      doc: (id) => ({ get: async () => ({ data: () => (c === 'private' && id === 'here' && key ? { apiKey: key } : undefined) }), set: async (v) => logs.push({ c, id, v }) }),
      add: async (v) => logs.push({ c, v })
    })
  };
}
function fakeFetch(handler) {
  const seen = [];
  const f = async (url) => {
    const u = new URL(url); seen.push(u);
    const r = handler(u);
    if (r.status && r.status >= 400) return { ok: false, status: r.status, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, json: async () => r, arrayBuffer: async () => new Uint8Array(Buffer.from(r.bytes || 'png')).buffer };
  };
  f.seen = seen;
  return f;
}
const yes = async () => true, no = async () => false;
const call = (db, input, fetchFn, may) => P.porterCall(db, 'pat.admin@uniteddairy.com', input, may || yes, { fetchFn, log: true });

test('a map picture comes back as base64 and the key never leaves the server', async () => {
  P.TILE_CACHE.clear();
  const db = fakeDb(KEY), f = fakeFetch(() => ({ bytes: 'PNGDATA' }));
  const r = await call(db, { service: 'here', op: 'mapTile', z: 8, x: 70, y: 96, style: 'normal' }, f);
  assert.equal(Buffer.from(r.png, 'base64').toString(), 'PNGDATA');
  assert.ok(!JSON.stringify(r).includes(KEY));
  assert.match(f.seen[0].pathname, /\/v3\/base\/mc\/8\/70\/96\/png$/);
  assert.equal(f.seen[0].searchParams.get('style'), 'explore.day');
  // Asked again: from memory, HERE is not asked twice.
  await call(db, { service: 'here', op: 'mapTile', z: 8, x: 70, y: 96 }, f);
  assert.equal(f.seen.length, 1);
  // Counted per person and day, not a log line per picture.
  assert.equal(db.logs.length, 1);
  assert.equal(db.logs[0].c, 'hubPorterDaily');
  assert.match(db.logs[0].id, /__here__mapTile__pat\.admin@uniteddairy\.com$/);
});

test('a map picture outside the map or in an unknown style is refused', async () => {
  const db = fakeDb(KEY), f = fakeFetch(() => ({}));
  await assert.rejects(call(db, { service: 'here', op: 'mapTile', z: 3, x: 8, y: 0 }, f), (e) => e.code === 'BAD_REQUEST');
  await assert.rejects(call(db, { service: 'here', op: 'mapTile', z: 3, x: 1, y: 1, style: 'neon' }, f), (e) => e.code === 'BAD_REQUEST');
  assert.equal(f.seen.length, 0);
});

test('address lookup: found rows with their map point, empty or unknown rows not found, one log line for the list', async () => {
  const db = fakeDb(KEY);
  const f = fakeFetch((u) => (/Nowhere/.test(u.searchParams.get('q')) ? { items: [] }
    : { items: [{ title: '12 Made-Up Rd', address: { label: '12 Made-Up Rd, Sampletown, PA 15401' }, position: { lat: 39.9, lng: -79.7 }, scoring: { queryScore: 0.96 } }] }));
  const r = await call(db, { service: 'here', op: 'geocode', rows: [{ id: 'a', address: '12 Made-Up Rd, Sampletown, PA' }, { id: 'b', address: '1 Nowhere' }, { id: 'c', address: '' }] }, f);
  assert.deepEqual(r.results[0], { id: 'a', lat: 39.9, lon: -79.7, matched: '12 Made-Up Rd, Sampletown, PA 15401', score: 0.96 });
  assert.deepEqual(r.results[1], { id: 'b', notFound: true });
  assert.deepEqual(r.results[2], { id: 'c', notFound: true });
  assert.equal(f.seen.length, 2, 'the empty row is not sent to HERE');
  assert.equal(f.seen[0].searchParams.get('in'), 'countryCode:USA');
  assert.equal(db.logs.length, 1);
  assert.equal(db.logs[0].c, 'hubPorterLog');
  assert.equal(db.logs[0].v.count, 3);
  assert.equal(db.logs[0].v.ok, true);
});

test('more than 100 addresses at once is refused in plain words', async () => {
  const rows = Array.from({ length: 101 }, (_, i) => ({ id: String(i), address: i + ' Made-Up St' }));
  await assert.rejects(call(fakeDb(KEY), { service: 'here', op: 'geocode', rows }, fakeFetch(() => ({}))), /Up to 100 addresses/);
});

test('find by name near a plant: nearest first, with miles', async () => {
  const f = fakeFetch(() => ({ items: [
    { title: 'Sample Market', address: { label: '9 Far Rd' }, position: { lat: 40.5, lng: -80.5 }, distance: 80467 },
    { title: 'Sample Market', address: { label: '2 Near St' }, position: { lat: 40.0, lng: -79.8 }, distance: 3219 }
  ] }));
  const r = await call(fakeDb(KEY), { service: 'here', op: 'findPlace', name: 'Sample Market', near: { lat: 39.9, lon: -79.7 }, town: '', limit: 5 }, f);
  assert.deepEqual(r.results.map(x => [x.address, x.miles]), [['2 Near St', 2], ['9 Far Rd', 50]]);
  assert.equal(f.seen[0].hostname, 'discover.search.hereapi.com');
  assert.equal(f.seen[0].searchParams.get('at'), '39.9,-79.7');
});

test('find by name near a town looks the town up first', async () => {
  const f = fakeFetch((u) => (u.hostname.startsWith('geocode') ? { items: [{ position: { lat: 40.1, lng: -80.7 } }] } : { items: [] }));
  const r = await call(fakeDb(KEY), { service: 'here', op: 'findPlace', name: 'Sample Market', near: null, town: 'Sampletown, OH' }, f);
  assert.deepEqual(r.results, []);
  assert.equal(f.seen[1].searchParams.get('at'), '40.1,-80.7');
});

test('suggestions while typing', async () => {
  const f = fakeFetch(() => ({ items: [{ address: { label: '12 Made-Up Rd, Sampletown, PA' } }, { address: { label: '12 Made-Up Rd, Sampletown, PA' } }] }));
  const r = await call(fakeDb(KEY), { service: 'here', op: 'suggest', text: '12 Made', near: { lat: 39.9, lon: -79.7 } }, f);
  assert.deepEqual(r.results, [{ address: '12 Made-Up Rd, Sampletown, PA' }]);
  assert.deepEqual(await call(fakeDb(KEY), { service: 'here', op: 'suggest', text: '12' }, f), { results: [] });
});

test('someone without the MapMaker tick is turned away before HERE is asked', async () => {
  const f = fakeFetch(() => ({}));
  await assert.rejects(call(fakeDb(KEY), { service: 'here', op: 'geocode', rows: [{ id: 'a', address: 'x' }] }, f, no), (e) => e.code === 'NOT_ALLOWED' && /People & Access/.test(e.message));
  assert.equal(f.seen.length, 0);
});

test('unknown services and requests, no key saved, and a turned-down key all say so plainly and are logged', async () => {
  await assert.rejects(call(fakeDb(KEY), { service: 'nope', op: 'x' }, fakeFetch(() => ({}))), /unknown service/);
  await assert.rejects(call(fakeDb(KEY), { service: 'here', op: 'deleteEverything' }, fakeFetch(() => ({}))), /unknown op/);
  const empty = fakeDb('');
  await assert.rejects(call(empty, { service: 'here', op: 'geocode', rows: [{ id: 'a', address: '1 Made-Up St' }] }, fakeFetch(() => ({}))), (e) => e.code === 'NO_KEY' && /Keys & Connections/.test(e.message));
  assert.equal(empty.logs[0].v.ok, false);
  const db = fakeDb(KEY);
  await assert.rejects(call(db, { service: 'here', op: 'geocode', rows: [{ id: 'a', address: '1 Made-Up St' }] }, fakeFetch(() => ({ status: 401 }))), /turned down the key/);
  assert.ok(!JSON.stringify(db.logs).includes(KEY), 'the key is never written to the log');
});

test('who may use the porter for the map: the MapMaker tick, or administrators while no ticks are saved', async () => {
  const H = require('../../src/hub');
  const docs = {
    users: { 'pat.admin@uniteddairy.com': { status: 'ACTIVE', roles: ['Administrator'] }, 'sam.sales@uniteddairy.com': { status: 'ACTIVE', roles: ['Sales'] },
      'kim.ticked@uniteddairy.com': { status: 'ACTIVE', roles: ['Sales'] }, 'lee.gone@uniteddairy.com': { status: 'INACTIVE', roles: ['Administrator'] } },
    appAccess: { 'kim.ticked@uniteddairy.com': { apps: ['operations', 'mapmaker'], updatedAt: '2026-11-12T13:00:00Z' } }
  };
  const db = { collection: (c) => ({ doc: (id) => ({ get: async () => ({ exists: !!(docs[c] || {})[id], data: () => (docs[c] || {})[id] }) }) }) };
  assert.equal(await H.mayUseApp(db, 'pat.admin@uniteddairy.com', 'mapmaker'), true);
  assert.equal(await H.mayUseApp(db, 'sam.sales@uniteddairy.com', 'mapmaker'), false);
  assert.equal(await H.mayUseApp(db, 'kim.ticked@uniteddairy.com', 'mapmaker'), true);
  await assert.rejects(H.mayUseApp(db, 'lee.gone@uniteddairy.com', 'mapmaker'), /Users list/);
});
