'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const F = require('../fixtures/fake-sheets');

const MANAGER = { email: 'manager.test@uniteddairy.com' };
const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
let n = 0;
const rid = () => 'reset-request-' + (++n) + '-' + Date.now();
const run = async (id) => (await db().collection('runs').doc(id).get()).data();

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
});

test('Reset Week rebuilds the days and standard drivers from Route Master and Driver Master; trucks stay', async () => {
  const week = '2026-10-04';
  const r801 = (await db().collection('runs').where('weekStart', '==', week).where('runId', '==', 'run_t801').get()).docs[0];
  // A dispatcher's picks that Reset puts back: another driver on Tuesday, Wednesday turned on.
  await applyAction(db(), DISPATCHER, { action: 'setRuns', requestId: rid(), runDocId: r801.id, day: 'wed', runs: true });
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'resetWeek', requestId: rid(), weekStart: week }), /does not have a role/);
  const out = await applyAction(db(), MANAGER, { action: 'resetWeek', requestId: rid(), weekStart: week });
  assert.ok(out.changedDays > 0);
  const a = await run(r801.id);
  assert.equal(a.days.tue.driverId, 'drv_test_adams', 'Tuesday back to the standard driver');
  assert.equal(a.days.tue.truck, '900002', 'trucks are not touched');
  assert.equal(a.days.wed.runs, false, 'Route Master does not run 801 on Wednesday');
  const r802 = (await db().collection('runs').where('weekStart', '==', week).where('runId', '==', 'run_t802').get()).docs[0];
  assert.equal((await run(r802.id)).days.tue.driver, 'CASEY, LEE');
  // An inactive driver is never put back on a run.
  const sv = (await db().collection('runs').where('weekStart', '==', week).where('runId', '==', 'run_t810').get()).docs.map(d => d.data()).find(r => r.days.wed && r.days.wed.runs);
  assert.equal(sv.days.wed.driverId || '', '');
  // A run Route Master no longer has stays as it was.
  const gone = (await db().collection('runs').where('weekStart', '==', week).where('runId', '==', 'run_t898').get()).docs[0];
  assert.equal(gone.data().testEdited || false, false);
  // Doing it again changes nothing.
  assert.equal((await applyAction(db(), MANAGER, { action: 'resetWeek', requestId: rid(), weekStart: week })).changedDays, 0);
});

test('Reset Week leaves a driver who is off that day off the run and shows who it was for', async () => {
  const week = '2026-10-11';
  await applyAction(db(), MANAGER, { action: 'resetWeek', requestId: rid(), weekStart: week });
  const r801 = (await db().collection('runs').where('weekStart', '==', week).where('runId', '==', 'run_t801').get()).docs[0].data();
  assert.equal(r801.days.mon.driverId, '');
  assert.equal(r801.days.mon.intendedDriver, 'ADAMS, PAT');
  assert.equal(r801.days.mon.driverExceptionStatus, 'VACATION');
  await assert.rejects(applyAction(db(), MANAGER, { action: 'resetWeek', requestId: rid(), weekStart: '2026-11-01' }), /not one of the copied Live weeks/);
});
