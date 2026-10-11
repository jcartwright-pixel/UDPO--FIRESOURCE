'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('../../src/actions');
const { unitedDairyUser } = require('../../src/auth');

test('a save must name a known action, a request ID, the run and the day', () => {
  assert.throws(() => validate({ action: 'deleteEverything', requestId: 'abcdefgh1' }), /Unknown save/);
  assert.throws(() => validate({ action: 'assignDriver', runDocId: 'x', day: 'mon' }), /requestId/);
  assert.throws(() => validate({ action: 'assignDriver', requestId: 'abcdefgh1', runDocId: 'x', day: 'monday' }), /runDocId and day/);
  assert.deepEqual(validate({ action: 'assignDriver', requestId: 'abcdefgh1', runDocId: 'x', day: 'mon', driverId: ' d1 ', expectedRev: '3' }),
    { action: 'assignDriver', requestId: 'abcdefgh1', runDocId: 'x', day: 'mon', driverId: 'd1', expectedRev: 3 });
  assert.throws(() => validate({ action: 'reorderLoads', requestId: 'abcdefgh1', loadDate: '2026-10-05', order: [{ runDocId: 'a', day: 'tue' }, { runDocId: 'a', day: 'tue' }] }), /listed twice/);
});

test('only verified United Dairy Google accounts get in', () => {
  const t = (token) => unitedDairyUser({ uid: 'u', token });
  assert.deepEqual(t({ email: 'Joe@UnitedDairy.com', email_verified: true, hd: 'uniteddairy.com' }), { uid: 'u', email: 'joe@uniteddairy.com' });
  assert.equal(t({ email: 'joe@uniteddairy.com', email_verified: false }), null);
  assert.equal(t({ email: 'joe@gmail.com', email_verified: true }), null);
  assert.equal(t({ email: 'joe@uniteddairy.com.evil.com', email_verified: true }), null);
  assert.equal(t({ email: 'joe@uniteddairy.com', email_verified: true, hd: 'other.com' }), null);
  assert.equal(unitedDairyUser(null), null);
});
