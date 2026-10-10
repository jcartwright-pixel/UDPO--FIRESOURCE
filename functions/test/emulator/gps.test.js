'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { gpsCall } = require('../../src/gps');
const F = require('../fixtures/fake-sheets');

const ADMIN = { email: 'admin.test@uniteddairy.com' };
const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES });
});

// A stand-in for Fleetmatics: user "api" / "pw" gets a key; App ID "app1" may ask about vehicle 223876.
function fleetmatics(calls) {
  return async (url, init) => {
    calls.push(url);
    const auth = init.headers.Authorization;
    if (url.endsWith('/token') && auth === 'Basic ' + Buffer.from('reveal:pw').toString('base64')) return { status: 400, text: async () => '' };
    if (url.endsWith('/token')) return auth === 'Basic ' + Buffer.from('api:pw').toString('base64') ? { status: 200, text: async () => '"key123"' } : { status: 401, text: async () => '' };
    if (!/atmosphere_app_id=app1, Bearer key123/.test(auth)) return { status: 401, text: async () => '' };
    return /\/vehicles\/223876\/location$/.test(url) ? { status: 200, text: async () => '{}' } : { status: 404, text: async () => '' };
  };
}

test('GPS Setup: only a manager or administrator; the login is never sent back; Test says plainly what works', async () => {
  const calls = [], o = { fetch: fleetmatics(calls) };
  await assert.rejects(gpsCall(db(), DISPATCHER, { op: 'status' }, o), /Only a manager or administrator/);
  let s = await gpsCall(db(), ADMIN, { op: 'test' }, o);
  assert.equal(s.result.ok, false);
  assert.match(s.result.message, /save the API user/);
  await assert.rejects(gpsCall(db(), ADMIN, { op: 'save', baseUrl: 'https://example.com' }, o), /must look like/);

  await gpsCall(db(), ADMIN, { op: 'save', user: 'reveal', password: 'pw', appId: 'app1' }, o);
  s = await gpsCall(db(), ADMIN, { op: 'test' }, o);
  assert.match(s.result.message, /not accept this as an API login \(400\)/);

  s = await gpsCall(db(), ADMIN, { op: 'save', user: 'api', password: 'wrong', appId: 'app1' }, o);
  assert.deepEqual([s.hasUser, s.hasPassword, s.hasAppId], [true, true, true]);
  assert.equal(JSON.stringify(s).indexOf('wrong'), -1, 'the password never comes back');
  s = await gpsCall(db(), ADMIN, { op: 'test' }, o);
  assert.match(s.result.message, /refused the login \(401\)/);

  await gpsCall(db(), ADMIN, { op: 'save', password: 'pw' }, o);
  s = await gpsCall(db(), ADMIN, { op: 'test' }, o);
  assert.equal(s.result.ok, true);
  assert.match(s.result.message, /Login works/);
  s = await gpsCall(db(), ADMIN, { op: 'test', vehicle: '999' }, o);
  assert.match(s.result.message, /does not know vehicle 999/);
  s = await gpsCall(db(), ADMIN, { op: 'test', vehicle: '223876' }, o);
  assert.equal(s.result.ok, true);
  assert.match(s.result.message, /^Connected/);
  assert.equal(s.lastTest.ok, true);

  await gpsCall(db(), ADMIN, { op: 'save', appId: 'bad' }, o);
  s = await gpsCall(db(), ADMIN, { op: 'test', vehicle: '223876' }, o);
  assert.match(s.result.message, /refused the App ID/);

  s = await gpsCall(db(), ADMIN, { op: 'clear' }, o);
  assert.deepEqual([s.hasUser, s.hasPassword, s.hasAppId], [false, false, false]);
  assert.ok(calls.every(u => u.startsWith('https://fim.api.us.fleetmatics.com/')));
});
