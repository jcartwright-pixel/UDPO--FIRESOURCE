'use strict';
// MOCREO cooler sensors (Joe 10/10): read only, from the secrets once they exist; until then nothing is read and the
// Temperatures screen stays manual. The key never reaches the database.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const M = require('../../src/mocreo');
const R = require('../../src/plant-rules');

const KEY = 'mok_test_key_never_stored';
// A stand-in for api.mocreo.com: one sensor with its temperature on the list, one only on its own page.
function fakeMocreo(calls) {
  return async (url, opts) => {
    calls.push({ url, key: opts.headers['X-API-Key'] });
    const body = /\/devices$/.test(url)
      ? { success: true, result: [{ id: 'S1', name: 'Cooler North', temperature: 345, battery: 88, online: true, updatedAt: 1791640000 }, { id: 'S2', name: 'Cooler Middle' }] }
      : { success: true, result: { data: { temperature: { value: 1000 }, batteryLevel: 51, online: false } } };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
}

test.beforeEach(() => clear());

test('MOCREO temperatures are hundredths of a degree Celsius', () => {
  assert.equal(M.fahrenheit(345), 38.2);
  assert.equal(M.fahrenheit('1000'), 50);
  assert.equal(M.fahrenheit(''), null);
});

test('no secrets yet: nothing is read and the screen is told it stays manual', async () => {
  const calls = [];
  const out = await M.runMocreoSync({ db: db(), getSecrets: async () => ({ missing: 'MOCREO_API_KEY' }), fetchFn: fakeMocreo(calls) });
  assert.deepEqual([out.waiting, calls.length], [true, 0]);
  const s = (await db().collection('config').doc('mocreo').get()).data();
  assert.equal(s.configured, false);
  assert.match(s.lastError, /No MOCREO key saved yet/);
  assert.equal((await db().collection('sensors').get()).size, 0);
});

test('with the secrets: each sensor is kept in °F, and the key is sent to MOCREO only', async () => {
  const calls = [];
  const out = await M.runMocreoSync({ db: db(), getSecrets: async () => ({ key: KEY, asset: 'A9' }), fetchFn: fakeMocreo(calls), now: () => new Date('2026-10-10T17:00:00Z') });
  assert.deepEqual(out, { ok: true, sensors: 2 });
  assert.deepEqual(calls.map(c => c.url), ['https://api.mocreo.com/v1/assets/A9/devices', 'https://api.mocreo.com/v1/assets/A9/devices/S2']);
  assert.ok(calls.every(c => c.key === KEY));
  const s1 = (await db().collection('sensors').doc('S1').get()).data(), s2 = (await db().collection('sensors').doc('S2').get()).data();
  assert.deepEqual([s1.temperatureF, s1.batteryLevel, s1.online, s2.temperatureF, s2.online], [38.2, 88, true, 50, false]);
  const status = (await db().collection('config').doc('mocreo').get()).data();
  assert.deepEqual([status.configured, status.sensors, status.lastError], [true, 2, '']);
  const everything = JSON.stringify((await db().collection('sensors').get()).docs.map(d => d.data())) + JSON.stringify(status);
  assert.ok(!everything.includes(KEY), 'the key is never written to the database');
});

test('a MOCREO error is kept in plain words without the key, and a sensor that stops answering is marked offline', async () => {
  await M.runMocreoSync({ db: db(), getSecrets: async () => ({ key: KEY, asset: 'A9' }), fetchFn: fakeMocreo([]) });
  const failing = async () => ({ ok: false, status: 401, text: async () => 'bad key ' + KEY });
  const out = await M.runMocreoSync({ db: db(), getSecrets: async () => ({ key: KEY, asset: 'A9' }), fetchFn: failing });
  assert.equal(out.ok, false);
  const status = (await db().collection('config').doc('mocreo').get()).data();
  assert.match(status.lastError, /MOCREO answered 401/);
  assert.ok(!status.lastError.includes(KEY) && !status.lastError.includes('A9'));
  const oneLeft = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ result: [{ id: 'S1', name: 'Cooler North', temperature: 345 }] }) });
  await M.runMocreoSync({ db: db(), getSecrets: async () => ({ key: KEY, asset: 'A9' }), fetchFn: oneLeft });
  const s2 = (await db().collection('sensors').doc('S2').get()).data();
  assert.deepEqual([s2.returned, s2.online], [false, false]);
});

test('Temperatures: a location takes its sensor by ID, else by exactly its name, and shows its status', () => {
  const setup = [
    { type: 'TEMPERATURE_CHECK_LOCATION', operationId: 'ut_temp_n', name: 'Cooler North', settings: { highLimit: 38 } },
    { type: 'TEMPERATURE_CHECK_LOCATION', operationId: 'ut_temp_m', name: 'Cooler Middle', settings: { sensorId: 'S2', lowLimit: 33, highLimit: 41 } },
    { type: 'TEMPERATURE_CHECK_LOCATION', operationId: 'ut_temp_d', name: 'Dock', settings: {} }
  ];
  const now = Date.parse('2026-10-10T17:00:00Z');
  const sensors = [{ sensorId: 'S1', name: 'cooler  north', temperatureF: 38.2, batteryLevel: 88, online: true, lastReadingAt: '2026-10-10T16:55:00Z' },
    { sensorId: 'S2', name: 'Other name', temperatureF: 36, online: true, lastReadingAt: '2026-10-10T15:00:00Z' }];
  const rows = R.tempRows(setup, [], now, sensors);
  assert.deepEqual(rows.map(r => [r.location, r.sensorTemp, r.status]), [['Cooler Middle', 36, 'STALE'], ['Cooler North', 38.2, 'HIGH'], ['Dock', '', 'MANUAL ONLY']]);
  assert.deepEqual(R.tempRows(setup, [], now).map(r => r.status), ['MANUAL ONLY', 'MANUAL ONLY', 'MANUAL ONLY'], 'no sensors: manual, as before');
});

/* ---------- Administration > MOCREO & Sensors ---------- */
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const D = require('../../src/demo-sheets');
const PD = require('../fixtures/plant-demo');
const ADMIN = { email: 'admin.test@uniteddairy.com' }, MANAGER = { email: 'manager.test@uniteddairy.com' };
const plant = () => runTransfer({ db: db(), reader: D.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T16:00:00Z') });

test('only an administrator may set the key; the screen gets the last 4 characters, never the key', async () => {
  await plant();
  await assert.rejects(M.mocreoCall(db(), MANAGER, { op: 'status' }), /Only an administrator/);
  const saved = await M.mocreoCall(db(), ADMIN, { op: 'save', apiKey: KEY, assetId: 'asset-12345' });
  assert.deepEqual([saved.hasKey, saved.keyEnds, saved.hasAsset, saved.assetEnds, saved.savedBy], [true, KEY.slice(-4), true, '2345', 'admin.test@uniteddairy.com']);
  assert.ok(!JSON.stringify(saved).includes(KEY) && !JSON.stringify(await M.mocreoCall(db(), ADMIN, { op: 'status' })).includes(KEY));
  // Saved but not tested: the sync waits, readings stay manual.
  const calls = [];
  const waiting = await M.runMocreoSync({ db: db(), getSecrets: () => M.appSecrets(db()), fetchFn: fakeMocreo(calls) });
  assert.deepEqual([waiting.waiting, calls.length], [true, 0]);
  // Test Connection reads MOCREO with the saved key and fills the sensors at once.
  const tested = await M.mocreoCall(db(), ADMIN, { op: 'test' }, { fetch: fakeMocreo(calls) });
  assert.deepEqual([tested.result.ok, tested.result.sensors, tested.lastTest.ok], [true, 2, true]);
  assert.ok(!JSON.stringify(tested).includes(KEY));
  assert.equal((await db().collection('sensors').get()).size, 2);
  assert.deepEqual(await M.appSecrets(db()), { key: KEY, asset: 'asset-12345' });
  // Replace Key: a new key waits for its own test.
  await M.mocreoCall(db(), ADMIN, { op: 'save', apiKey: 'mok_new_key_9876' });
  assert.deepEqual(await M.appSecrets(db()), { untested: true });
  const refused = await M.mocreoCall(db(), ADMIN, { op: 'test' }, { fetch: async () => ({ ok: false, status: 401, text: async () => 'no' }) });
  assert.equal(refused.result.ok, false);
  assert.match(refused.result.message, /MOCREO refused the key \(401\)/);
});

test('thermometers: add, rename, limits and off in Administration; Cooler Temperatures and its saves follow', async () => {
  await plant();
  const setup = (await db().collection('plantSetup').get()).docs.map(d => d.data());
  const added = await M.mocreoCall(db(), ADMIN, { op: 'location', location: 'Freezer 2', area: 'Dock freezer', sensorId: 'S9', lowLimit: '-10', highLimit: '5' });
  await M.mocreoCall(db(), ADMIN, { op: 'location', locationId: 'ut_temp_cooler_north', location: 'Cooler North (milk)', lowLimit: '33', highLimit: '40' });
  await M.mocreoCall(db(), ADMIN, { op: 'location', locationId: 'ut_temp_cooler_middle', location: 'Cooler Middle', active: false });
  await assert.rejects(M.mocreoCall(db(), ADMIN, { op: 'location', location: 'Bad', lowLimit: '50', highLimit: '40' }), /low limit is above/);
  const mine = () => db().collection('tempLocations').get().then(s => s.docs.map(d => d.data()));
  let locs = R.tempLocations(R.withTempLocations(setup, await mine()));
  assert.deepEqual(locs.map(l => [l.location, l.lowLimit, l.highLimit]), [['Cooler North (milk)', 33, 40], ['Freezer 2', -10, 5]]);
  assert.equal(locs[1].area, 'Dock freezer');
  // A reading on the new thermometer saves like any other.
  const r = await applyAction(db(), { email: 'dispatch.test@uniteddairy.com' }, { action: 'saveTemperatureCheck', requestId: 'mocreo-t-' + Date.now(), locationId: added.location.locationId, manualTemperature: '9' });
  assert.equal(r.status, 'HIGH');
  await M.mocreoCall(db(), ADMIN, { op: 'removeLocation', locationId: added.location.locationId });
  locs = R.tempLocations(R.withTempLocations(setup, await mine()));
  assert.deepEqual(locs.map(l => l.location), ['Cooler North (milk)']);
  await assert.rejects(applyAction(db(), { email: 'dispatch.test@uniteddairy.com' }, { action: 'saveTemperatureCheck', requestId: 'mocreo-t2-' + Date.now(), locationId: 'ut_temp_cooler_middle', manualTemperature: '38' }), /not configured/);
});
