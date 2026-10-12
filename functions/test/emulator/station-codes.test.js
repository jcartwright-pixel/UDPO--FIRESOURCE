'use strict';
// Station codes (src/stations.js, Joe 10/12): Administration adds stations and gives each its own code; a tablet types the
// code once and opens that station; a new code or a removed station sends the tablet back to the code screen.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const A = require('../../src/admin');
const ST = require('../../src/stations');
const { garageCall } = require('../../src/garage');

const ADMIN = { email: 'boss@uniteddairy.com' }, TABLET = { email: 'tablet@uniteddairy.com' };
const admin = (input) => A.adminCall(db(), ADMIN, input);
const tablet = (input) => A.stationRelease(db(), TABLET, input);
test.beforeEach(async () => {
  await clear();
  const u = db().collection('users');
  await u.doc('boss@uniteddairy.com').set({ name: 'Boss', status: 'ACTIVE', roles: ['ADMINISTRATOR'], facilities: ['*'], cells: { id: 'usr_boss', version: '1' } });
  await u.doc('tablet@uniteddairy.com').set({ name: 'Case tablet', status: 'ACTIVE', roles: ['PLANT_STAFF'], facilities: ['fac_uniontown'], cells: { id: 'usr_tab', version: '1' } });
});

test('each kind starts with the current app\'s stations, none with a code', async () => {
  const plant = await admin({ op: 'stations', kind: 'PLANT' });
  assert.deepEqual(plant.stations.map(s => s.name), ['Case Loadout', 'Case Unloading', 'Tote Loadout', 'Boxing Loadout', 'Yard Services']);
  assert.ok(plant.stations.every(s => !s.set && s.plant === 'Uniontown'));
  assert.deepEqual((await admin({ op: 'stations', kind: 'GARAGE' })).stations.map(s => s.name), ['Garage']);
  assert.deepEqual((await admin({ op: 'stations', kind: 'KIOSK' })).stations.map(s => s.typeName), ['Driver Station (tablet)', 'TV display']);
  assert.deepEqual(await tablet({ op: 'has', kind: 'PLANT', facilityId: 'fac_uniontown' }), { required: false });
  await assert.rejects(A.adminCall(db(), TABLET, { op: 'stations', kind: 'PLANT' }), /Only an administrator/);
});

test('add a station, give it a code, the tablet types it and opens that station', async () => {
  const added = await admin({ op: 'stationAdd', kind: 'PLANT', type: 'CASE', facilityId: 'fac_uniontown', name: 'Case Loadout dock 2' });
  const dock = added.stations.find(s => s.name === 'Case Loadout dock 2');
  assert.equal(dock.typeName, 'Case Loadout');
  await assert.rejects(admin({ op: 'stationAdd', kind: 'PLANT', type: 'CASE', facilityId: 'fac_uniontown', name: 'case loadout DOCK 2' }), /already has a station named/);
  const { code } = await admin({ op: 'stationCode', key: dock.key });
  assert.match(code, /^[A-Z2-9]{6}$/);
  assert.equal((await admin({ op: 'stations', kind: 'PLANT' })).stations.find(s => s.key === dock.key).code, code);
  assert.deepEqual(await tablet({ op: 'has', kind: 'PLANT', facilityId: 'fac_uniontown' }), { required: true });
  // The code opens this station only for its own kind; the tablet gets no code, salt or hash.
  const got = await tablet({ op: 'enter', kind: 'PLANT', code: code.toLowerCase() });
  assert.equal(got.ok, true);
  assert.deepEqual([got.station.key, got.station.name, got.station.type], [dock.key, 'Case Loadout dock 2', 'CASE']);
  assert.equal(got.station.code, undefined);
  assert.equal((await tablet({ op: 'enter', kind: 'GARAGE', code })).ok, false);
  assert.match((await tablet({ op: 'enter', kind: 'PLANT', code: 'ZZZZZZ' })).message, /not recognized/);
  // Still good, then a new code sends the tablet back; Remove does too.
  assert.equal((await tablet({ op: 'check', kind: 'PLANT', key: dock.key, version: got.station.version })).ok, true);
  await admin({ op: 'stationCode', key: dock.key });
  assert.match((await tablet({ op: 'check', kind: 'PLANT', key: dock.key, version: got.station.version })).message, /new code/);
  await admin({ op: 'stationRemove', key: dock.key });
  assert.match((await tablet({ op: 'check', kind: 'PLANT', key: dock.key, version: got.station.version })).message, /removed/);
  assert.ok(!(await admin({ op: 'stations', kind: 'PLANT' })).stations.some(s => s.key === dock.key));
});

test('a plant can have more than one kiosk, each with its own code', async () => {
  const out = await admin({ op: 'stationAdd', kind: 'KIOSK', type: 'DRIVER', facilityId: 'fac_uniontown', name: 'Plant kiosk' });
  const keys = out.stations.map(s => s.key);
  assert.equal(keys.length, 3);
  const a = (await admin({ op: 'stationCode', key: keys[0] })).code, b = (await admin({ op: 'stationCode', key: keys[2] })).code;
  assert.notEqual(a, b);
  assert.equal((await tablet({ op: 'enter', kind: 'KIOSK', code: b })).station.name, 'Plant kiosk');
});

test('wrong station codes: 30 a minute, then a wait', async () => {
  const key = (await admin({ op: 'stations', kind: 'PLANT' })).stations[0].key, { code } = await admin({ op: 'stationCode', key });
  const at = new Date('2026-10-12T12:00:10Z');
  for (let i = 0; i < ST.MAX_FAILS_PER_MINUTE; i++) assert.equal((await ST.tabletCall(db(), { op: 'enter', kind: 'PLANT', code: 'WRONG' + i }, () => at)).ok, false);
  assert.match((await ST.tabletCall(db(), { op: 'enter', kind: 'PLANT', code }, () => at)).message, /Too many/);
  assert.equal((await ST.tabletCall(db(), { op: 'enter', kind: 'PLANT', code }, () => new Date('2026-10-12T12:01:10Z'))).ok, true);
});

test('Garage Station: once the garage has a code, every call carries the station it opened', async () => {
  assert.ok(Array.isArray((await garageCall(db(), { op: 'board' })).jobs));
  const key = (await admin({ op: 'stations', kind: 'GARAGE' })).stations[0].key, { code } = await admin({ op: 'stationCode', key });
  assert.deepEqual(await garageCall(db(), { op: 'station', step: 'has', facilityId: 'fac_uniontown' }), { required: true });
  await assert.rejects(garageCall(db(), { op: 'board' }), /STATION_CODE: This garage tablet was removed\. Enter the garage station code\./);
  const st = (await garageCall(db(), { op: 'station', step: 'enter', code })).station;
  assert.ok(Array.isArray((await garageCall(db(), { op: 'board', station: { key: st.key, version: st.version } })).jobs));
  await admin({ op: 'stationCode', key });
  await assert.rejects(garageCall(db(), { op: 'board', station: { key: st.key, version: st.version } }), /STATION_CODE: This garage tablet has a new code/);
  // Change Station uses the plant's manager release code.
  assert.deepEqual(await garageCall(db(), { op: 'release', step: 'status' }), { required: false });
  const rel = (await admin({ op: 'releaseCodeNew', facilityId: 'fac_uniontown' })).code;
  assert.equal((await garageCall(db(), { op: 'release', step: 'release', code: 'WRONG123' })).ok, false);
  assert.equal((await garageCall(db(), { op: 'release', step: 'release', code: rel })).ok, true);
});
