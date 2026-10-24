'use strict';
// Joe 10/23 ("this week I have an extra Ventura, so I actually have two on the same day ... a temporary, one-time thing"): Weekly
// Dispatch adds a second line for a run, for that week only. It is its own run (own driver, counted by the double-booking check,
// never the first line's Scheduler loads), stays out of Route Master and the Live sheet, and Reset Week and Publish leave it alone.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const L = require('../../src/logic');
const F = require('../fixtures/fake-sheets');

const MANAGER = { email: 'manager.test@uniteddairy.com' };
const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
const VIEWER = { email: 'viewer.test@uniteddairy.com' };
const AT = () => new Date('2026-10-09T12:00:00Z');
let n = 0;
const rid = () => 'extra-run-' + (++n) + '-' + Date.now();
const week = async (w) => (await db().collection('runs').where('weekStart', '==', w).get()).docs.map(d => Object.assign({ id: d.id }, d.data()));
const copy = () => runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: AT });

test.beforeEach(async () => {
  await clear();
  await copy();
  for (const id of ['run_t801', 'run_t802', 'run_t810']) await db().collection('routes').doc(id).update({ displayDaily: true, displayWeekly: true });
});

test('a second line for this week only: own run, starts off, gets its own driver, sits under its run', async () => {
  const base = (await week('2026-10-04')).find(r => r.runId === 'run_t801');
  await assert.rejects(applyAction(db(), VIEWER, { action: 'addExtraRun', requestId: rid(), runDocId: base.id }, AT), /role|allowed/);
  const out = await applyAction(db(), DISPATCHER, { action: 'addExtraRun', requestId: rid(), runDocId: base.id }, AT);
  const x = (await db().collection('runs').doc(out.runDocId).get()).data();
  assert.equal(x.run, 'UT DSD MILK 2');
  assert.equal(x.route, '801');
  assert.equal(x.extraRun, true);
  assert.equal(x.extraOf, base.id);
  assert.notEqual(x.runId, base.runId, 'its own run, so the Scheduler loads and the sheet row stay with the first line');
  assert.equal(x.sheetRow, null);
  assert.ok(L.DAYS.every(p => x.days[p].runs === false && !x.days[p].driverId), 'every day starts off with no driver');
  assert.equal(x.days.mon.dispatchTime, base.days.mon.dispatchTime, 'the run\'s time on its days');
  assert.equal(x.days.mon.loadDate, base.days.mon.loadDate);
  assert.ok(x.days.thu.dispatchTime !== null, 'a day the run does not run borrows its time');
  // A third one is number 3; one cannot be added from an extra line.
  const third = await applyAction(db(), DISPATCHER, { action: 'addExtraRun', requestId: rid(), runDocId: base.id }, AT);
  assert.equal((await db().collection('runs').doc(third.runDocId).get()).data().run, 'UT DSD MILK 3');
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'addExtraRun', requestId: rid(), runDocId: out.runDocId }, AT), /run's own line/);

  // Picking a driver turns the day on, as on any line.
  await applyAction(db(), DISPATCHER, { action: 'setRuns', requestId: rid(), runDocId: out.runDocId, day: 'thu', runs: true }, AT);
  await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: out.runDocId, day: 'thu', driverId: 'drv_test_casey' }, AT);
  const runs = await week('2026-10-04');
  const rows = L.weeklyRows(runs, '2026-10-04');
  const at = rows.findIndex(r => r.runDocId === base.id);
  assert.equal(rows[at + 1].runDocId, out.runDocId, 'right under its run');
  assert.equal(rows[at + 2].runDocId, third.runDocId);
  assert.equal(rows[at + 1].extraRun, true);
  assert.equal(rows[at + 1].days.thu.driver, 'CASEY, LEE');
  // On the Driver Assignment Board and Daily Dispatch like any run.
  const board = L.driverBoardRows((await db().collection('drivers').get()).docs.map(d => d.data()), rows, [], '2026-10-04', []);
  assert.match(board.find(b => b.id === 'drv_test_casey').days.thu.text, /UT DSD MILK 2/);
  assert.ok(L.dailyRows(runs, '2026-10-07').some(r => r.runDocId === out.runDocId), 'on Daily Dispatch for its load day');
  // Two runs the same day with the same driver show as double booked.
  await applyAction(db(), DISPATCHER, { action: 'setRuns', requestId: rid(), runDocId: out.runDocId, day: 'mon', runs: true }, AT);
  await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: out.runDocId, day: 'mon', driverId: 'drv_test_adams' }, AT);
  const rows2 = L.weeklyRows(await week('2026-10-04'), '2026-10-04');
  const ctx = L.weeklyContext(rows2, (await db().collection('drivers').get()).docs.map(d => d.data()), [], []);
  assert.equal(L.weeklyCellClass(rows2.find(r => r.runDocId === out.runDocId), 'mon', ctx), 'booked');
  assert.equal(L.weeklyCellClass(rows2.find(r => r.runDocId === base.id), 'mon', ctx), 'booked', 'both lines show it');
});

test('Reset Week, the copy from the sheet and Publish leave it alone; it never reaches the Live sheet; Remove takes it off', async () => {
  await db().collection('config').doc('app').set({ writeBack: { enabled: true } }, { merge: true });
  const base = (await week('2026-10-11')).find(r => r.runId === 'run_t801');
  const out = await applyAction(db(), DISPATCHER, { action: 'addExtraRun', requestId: rid(), runDocId: base.id }, AT);
  await applyAction(db(), DISPATCHER, { action: 'setRuns', requestId: rid(), runDocId: out.runDocId, day: 'wed', runs: true }, AT);
  await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: out.runDocId, day: 'wed', driverId: 'drv_test_casey' }, AT);
  const queued = (await db().collection('outbox').get()).docs.map(d => d.data()).filter(o => o.runDocId === out.runDocId);
  assert.deepEqual(queued, [], 'nothing for the Live sheet');
  await applyAction(db(), DISPATCHER, { action: 'setRuns', requestId: rid(), runDocId: base.id, day: 'wed', runs: true }, AT);
  assert.ok((await db().collection('outbox').get()).docs.some(d => d.data().runDocId === base.id), 'the run\'s own line still goes to the sheet');
  await applyAction(db(), DISPATCHER, { action: 'setRuns', requestId: rid(), runDocId: base.id, day: 'wed', runs: false }, AT);
  await db().collection('config').doc('app').set({ writeBack: { enabled: false } }, { merge: true });

  await applyAction(db(), MANAGER, { action: 'resetWeek', requestId: rid(), weekStart: '2026-10-11' }, AT);
  let x = (await db().collection('runs').doc(out.runDocId).get()).data();
  assert.equal(x.days.wed.driverId, 'drv_test_casey', 'Reset Week leaves it as it was');
  await copy();
  assert.ok((await db().collection('runs').doc(out.runDocId).get()).exists, 'the copy from the sheet keeps it');

  // Publish: the new Next week is built from Route Master, without it.
  await applyAction(db(), DISPATCHER, { action: 'publishWeek', requestId: rid(), weekStart: '2026-10-11' }, AT);
  const next = await week('2026-10-18');
  assert.ok(next.length > 0);
  assert.ok(!next.some(r => r.extraRun), 'it does not come back the next week');
  assert.ok((await db().collection('runs').doc(out.runDocId).get()).exists, 'its own week keeps it');

  // Remove: refused on a run's own line and once a day was loaded, otherwise gone.
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'removeExtraRun', requestId: rid(), runDocId: base.id }, AT), /Only a line added for this week/);
  await db().collection('runs').doc(out.runDocId).update({ 'days.wed.completeTime': '05:10' });
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'removeExtraRun', requestId: rid(), runDocId: out.runDocId }, AT), /already loaded on Wednesday/);
  await db().collection('runs').doc(out.runDocId).update({ 'days.wed.completeTime': '' });
  await applyAction(db(), DISPATCHER, { action: 'removeExtraRun', requestId: rid(), runDocId: out.runDocId }, AT);
  x = await db().collection('runs').doc(out.runDocId).get();
  assert.equal(x.exists, false);
});
