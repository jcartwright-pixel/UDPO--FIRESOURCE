'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const L = require('../../src/logic');
const F = require('../fixtures/fake-sheets');

const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
const MANAGER = { email: 'manager.test@uniteddairy.com' };
let n = 0;
const rid = () => 'off-request-' + (++n) + '-' + Date.now();
let clock = 0;
const tick = () => new Date(Date.parse('2026-10-09T12:00:00Z') + (++clock) * 60000);

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: tick });
});
const all = async (c) => (await db().collection(c).get()).docs.map(d => Object.assign({ docId: d.id }, d.data()));

test('Driver Exceptions and Driver Vacations are copied, and dates written two ways read the same', async () => {
  const ex = await all('exceptions');
  assert.equal(ex.length, 2);
  assert.equal(L.exceptionLabel(L.exceptionOn(ex, 'drv_test_brook', '2026-10-07')), 'SICK DAY');
  assert.equal(L.exceptionLabel(L.exceptionOn(ex, 'drv_test_adams', '2026-10-14')), 'VACATION');
  assert.equal(L.exceptionOn(ex, 'drv_test_adams', '2026-10-17'), null);
  assert.equal((await all('vacations'))[0].vacationType, 'VACATION');
});

test('a call-off adds a day off; Return Available frees only the days given and keeps both sides', async () => {
  await applyAction(db(), DISPATCHER, { action: 'saveDriverException', requestId: rid(), driverId: 'drv_test_casey', startDate: '2026-10-12', endDate: '2026-10-16', reason: 'Personal Day', status: 'UNAVAILABLE' });
  let ex = await all('exceptions');
  assert.equal(L.exceptionLabel(L.exceptionOn(ex, 'drv_test_casey', '2026-10-14')), 'PERSONAL DAY');
  await applyAction(db(), DISPATCHER, { action: 'saveDriverException', requestId: rid(), driverId: 'drv_test_casey', startDate: '2026-10-14', endDate: '2026-10-14', status: 'AVAILABLE' });
  ex = await all('exceptions');
  assert.equal(L.exceptionOn(ex, 'drv_test_casey', '2026-10-14'), null, 'the cleared day is free');
  assert.ok(L.exceptionOn(ex, 'drv_test_casey', '2026-10-13'), 'the day before stays off');
  assert.ok(L.exceptionOn(ex, 'drv_test_casey', '2026-10-15'), 'the day after stays off');
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'saveDriverException', requestId: rid(), driverId: 'drv_test_casey', startDate: '2026-10-15', endDate: '2026-10-14' }), /cannot be before/);
});

test('Vacation Schedule: an approved entry goes on Dispatch, at most 3 off a day and 2 in a holiday week', async () => {
  const one = await applyAction(db(), MANAGER, { action: 'saveVacation', requestId: rid(), driverId: 'drv_test_brook', startDate: '2026-10-13', endDate: '2026-10-14', type: 'Personal Day', status: 'APPROVED' });
  let ex = await all('exceptions');
  assert.equal(L.exceptionLabel(L.exceptionOn(ex, 'drv_test_brook', '2026-10-13')), 'PERSONAL DAY');
  await applyAction(db(), MANAGER, { action: 'saveVacation', requestId: rid(), driverId: 'drv_test_casey', startDate: '2026-10-14', endDate: '2026-10-14', type: 'VACATION', status: 'APPROVED' });
  // Adams is already off 10/12-10/16 (copied from the sheet), so 10/14 now has 3 off.
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveVacation', requestId: rid(), driverId: 'drv_test_dunn', startDate: '2026-10-14', endDate: '2026-10-14', status: 'APPROVED' }), /FULL/);
  // Thanksgiving week allows 2.
  await applyAction(db(), MANAGER, { action: 'saveVacation', requestId: rid(), driverId: 'drv_test_adams', startDate: '2026-11-23', endDate: '2026-11-23', status: 'APPROVED' });
  await applyAction(db(), MANAGER, { action: 'saveVacation', requestId: rid(), driverId: 'drv_test_brook', startDate: '2026-11-23', endDate: '2026-11-23', status: 'APPROVED' });
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveVacation', requestId: rid(), driverId: 'drv_test_casey', startDate: '2026-11-23', endDate: '2026-11-23', status: 'APPROVED' }), /Thanksgiving week/);
  // A pending entry is not limited and does not take the driver off Dispatch; cancelling the first entry frees its days.
  await applyAction(db(), MANAGER, { action: 'saveVacation', requestId: rid(), driverId: 'drv_test_casey', startDate: '2026-11-23', endDate: '2026-11-23', status: 'PENDING' });
  await applyAction(db(), MANAGER, { action: 'saveVacation', requestId: rid(), vacationId: one.vacationId, driverId: 'drv_test_brook', startDate: '2026-10-13', endDate: '2026-10-14', type: 'Personal Day', status: 'CANCELLED' });
  ex = await all('exceptions');
  assert.equal(L.exceptionOn(ex, 'drv_test_brook', '2026-10-13'), null);
  assert.equal(L.exceptionOn(ex, 'drv_test_casey', '2026-11-23'), null);
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'saveVacation', requestId: rid(), driverId: 'drv_test_casey', startDate: '2026-12-01', status: 'APPROVED' }), /does not have a role/);
});

test('a day off takes the driver off that day\'s runs (Weekly shows who it was for); Return Available puts them back', async () => {
  const run802 = async () => (await db().collection('runs').doc('2026-10-04__run_t802').get()).data();
  await applyAction(db(), DISPATCHER, { action: 'saveDriverException', requestId: rid(), driverId: 'drv_test_casey', startDate: '2026-10-05', endDate: '2026-10-05', reason: 'VACATION', status: 'UNAVAILABLE' });
  let mon = (await run802()).days.mon;
  assert.equal(mon.driver, '');
  assert.equal(mon.intendedDriver, 'CASEY, LEE');
  assert.equal(mon.driverExceptionStatus, 'VACATION');
  assert.equal((await db().collection('runs').doc('2026-10-11__run_t802').get()).data().days.mon.driver, 'CASEY, LEE', 'other weeks are not touched');
  await applyAction(db(), DISPATCHER, { action: 'saveDriverException', requestId: rid(), driverId: 'drv_test_casey', startDate: '2026-10-05', endDate: '2026-10-05', status: 'AVAILABLE' });
  mon = (await run802()).days.mon;
  assert.equal(mon.driver, 'CASEY, LEE');
  assert.equal(mon.driverExceptionStatus, '');
});

test('Weekly: CARRIER and OPEN are saved as words; Publish is recorded and kept by the minute copy', async () => {
  const RUN = '2026-10-04__run_t802';
  await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: RUN, day: 'mon', driverId: '__CARRIER__' });
  assert.equal((await db().collection('runs').doc(RUN).get()).data().days.mon.driver, 'CARRIER');
  await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: RUN, day: 'mon', driverId: '__OPEN__' });
  assert.equal((await db().collection('runs').doc(RUN).get()).data().days.mon.driver, 'OPEN');
  await applyAction(db(), DISPATCHER, { action: 'publishWeek', requestId: rid(), weekStart: '2026-10-04' }, tick);
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'publishWeek', requestId: rid(), weekStart: '2026-10-05' }), /Sunday/);
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: tick });
  const wk = (await db().collection('weeks').doc('2026-10-04').get()).data();
  assert.equal(wk.publishedBy, 'dispatch.test@uniteddairy.com');
  assert.ok(wk.publishedAt);
});
