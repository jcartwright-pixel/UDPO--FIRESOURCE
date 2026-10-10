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
  assert.match(s.lastError, /MOCREO_API_KEY is not in Secret Manager yet/);
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
