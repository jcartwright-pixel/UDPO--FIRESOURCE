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
  assert.deepEqual((await admin({ op: 'stations', kind: 'KIOSK' })).stations.map(s => s.typeName), ['Driver Room Check-In Station', "Driver's Kiosk Station"]);
  assert.deepEqual(await tablet({ op: 'has', kind: 'PLANT', facilityId: 'fac_uniontown' }), { required: false });
  await assert.rejects(A.adminCall(db(), TABLET, { op: 'stations', kind: 'PLANT' }), /Only an administrator/);
});

// Joe 10/12: the Driver Room's two stations are "Driver Room Check-In Station" and "Driver's Kiosk Station"; a list saved under
// their first names (Driver Room kiosk, Driver Room TV) shows the new names, and a station a manager named stays as named.
test('the Driver Room stations show Joe\'s names, also in a list saved under the first names', async () => {
  assert.deepEqual((await admin({ op: 'stations', kind: 'KIOSK' })).stations.map(s => s.name), ['Driver Room Check-In Station', "Driver's Kiosk Station"]);
  const list = {
    a: { key: 'a', kind: 'KIOSK', type: 'DRIVER', name: 'Driver Room kiosk', facilityId: 'fac_uniontown', order: 0 },
    b: { key: 'b', kind: 'KIOSK', type: 'TV', name: 'Driver Room TV', facilityId: 'fac_uniontown', order: 1 },
    c: { key: 'c', kind: 'KIOSK', type: 'TV', name: 'Break Room TV', facilityId: 'fac_uniontown', order: 2 }
  };
  await db().collection('private').doc('stations').set({ list });
  assert.deepEqual((await admin({ op: 'stations', kind: 'KIOSK' })).stations.map(s => s.name), ['Driver Room Check-In Station', "Driver's Kiosk Station", 'Break Room TV']);
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

// Review item 62 (Joe 10/13): one tablet typing wrong codes locks only that tablet, never every station in the company.
test('wrong station codes lock only the tablet that typed them', async () => {
  const key = (await admin({ op: 'stations', kind: 'PLANT' })).stations[0].key, { code } = await admin({ op: 'stationCode', key });
  const at = new Date('2026-10-12T12:00:10Z'), one = 'a1a1a1a1a1a1a1a1', two = 'b2b2b2b2b2b2b2b2';
  for (let i = 0; i < ST.MAX_FAILS_PER_MINUTE; i++) await ST.tabletCall(db(), { op: 'enter', kind: 'PLANT', code: 'WRONG' + i, who: one }, () => at);
  assert.match((await ST.tabletCall(db(), { op: 'enter', kind: 'PLANT', code, who: one }, () => at)).message, /Too many/);
  assert.equal((await ST.tabletCall(db(), { op: 'enter', kind: 'PLANT', code, who: two }, () => at)).ok, true, 'another tablet still gets in');
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
  // Release uses the plant's manager release code.
  assert.deepEqual(await garageCall(db(), { op: 'release', step: 'status' }), { required: false });
  const rel = (await admin({ op: 'releaseCodeNew', facilityId: 'fac_uniontown' })).code;
  assert.equal((await garageCall(db(), { op: 'release', step: 'release', code: 'WRONG123' })).ok, false);
  assert.equal((await garageCall(db(), { op: 'release', step: 'release', code: rel })).ok, true);
});

// Joe 10/12: the Plant Station with no UD account, with an On / Off switch per plant (Off: nobody gets in on a code alone).
test('no-account Plant Station: Off refuses every code; On opens only a plant station\'s code; Off, New code and Remove shut it out', async () => {
  const code = (await admin({ op: 'stationCode', key: 'fac_uniontown_plant_case' })).code;
  const kiosk = (await admin({ op: 'stationCode', key: 'fac_uniontown_kiosk_driver' })).code;
  let r = await ST.signIn(db(), { op: 'enter', code });
  assert.equal(r.ok, false);
  assert.equal(r.off, true, 'Off by default');
  const on = await admin({ op: 'noAccountSet', facilityId: 'fac_uniontown', on: true });
  assert.deepEqual(on.noAccount, [{ id: 'fac_uniontown', name: 'Uniontown', on: true }]);
  r = await ST.signIn(db(), { op: 'enter', code: code.toLowerCase() });
  assert.equal(r.ok, true);
  assert.equal(r.station.name, 'Case Loadout');
  assert.equal(r.station.code, undefined, 'the code never goes back to the tablet');
  assert.equal((await ST.signIn(db(), { op: 'enter', code: kiosk })).ok, false, 'a kiosk code does not open a plant station');
  // The database rules' copy follows the switch and the code's version.
  let access = (await db().collection('stationAccess').doc('fac_uniontown').get()).data();
  assert.equal(access.on, true);
  assert.equal(access.keys.fac_uniontown_plant_case, r.station.version);
  const claims = { udStation: r.station.key, udVersion: r.station.version, udPlant: 'fac_uniontown' };
  assert.equal((await ST.stationSaver(db(), claims)).name, 'Case Loadout');
  assert.equal((await ST.signIn(db(), { op: 'check', key: r.station.key, version: r.station.version })).ok, true);
  // Off: the saver check, the tablet check and the rules' copy all refuse it.
  await admin({ op: 'noAccountSet', facilityId: 'fac_uniontown', on: false });
  assert.equal(await ST.stationSaver(db(), claims), null);
  assert.equal((await ST.signIn(db(), { op: 'check', key: r.station.key, version: r.station.version })).off, true);
  assert.equal((await db().collection('stationAccess').doc('fac_uniontown').get()).data().on, false);
  // On again, then a new code: the old token is refused.
  await admin({ op: 'noAccountSet', facilityId: 'fac_uniontown', on: true });
  assert.ok(await ST.stationSaver(db(), claims));
  await admin({ op: 'stationCode', key: 'fac_uniontown_plant_case' });
  assert.equal(await ST.stationSaver(db(), claims), null);
  access = (await db().collection('stationAccess').doc('fac_uniontown').get()).data();
  assert.notEqual(access.keys.fac_uniontown_plant_case, r.station.version);
  // Remove: gone from the rules' copy.
  await admin({ op: 'stationRemove', key: 'fac_uniontown_plant_case' });
  assert.equal((await db().collection('stationAccess').doc('fac_uniontown').get()).data().keys.fac_uniontown_plant_case, undefined);
  await assert.rejects(A.adminCall(db(), TABLET, { op: 'noAccountSet', facilityId: 'fac_uniontown', on: true }), /Only an administrator/);
});

test('a no-account Plant Station may make only the plant-floor saves', async () => {
  const { applyAction } = require('../../src/actions');
  const station = { uid: 'station-x', email: 'station:x', station: { key: 'x', name: 'Case Loadout', facilityId: 'fac_uniontown' } };
  // Any other save is refused before it looks at anything else.
  await assert.rejects(applyAction(db(), station, { action: 'publishWeek', requestId: 'r-station-1', weekStart: '2026-10-04' }), /no UD account cannot make this save/);
  // A plant-floor save goes through, recorded as the station.
  const out = await applyAction(db(), station, { action: 'completeWash', requestId: 'r-station-2', date: '2026-10-09', trailer: 'T-993' });
  assert.equal(out.ok, true);
  assert.equal((await db().collection('actions').doc('r-station-2').get()).data().by, 'station:x');
  assert.deepEqual(ST.STATION_ACTIONS, ['savePlantLoad', 'addPickup', 'completePickup', 'reorderPlantLoads', 'saveUnloading', 'completeWash', 'addReturn']);
});
