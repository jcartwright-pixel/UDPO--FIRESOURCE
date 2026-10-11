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
const VIEWER = { email: 'viewer.test@uniteddairy.com' };
const RUN = '2026-10-04__run_t802';
let n = 0;
const rid = () => 'test-request-' + (++n) + '-' + Date.now();
let clock = 0;
const tick = () => new Date(Date.parse('2026-10-09T12:00:00Z') + (++clock) * 60000);

let tabs;
test.beforeEach(async () => {
  await clear();
  tabs = F.fakeSheets();
  await runTransfer({ db: db(), reader: F.fakeReader(tabs), sources: F.SOURCES, now: tick });
});

async function run(id) { return (await db().collection('runs').doc(id || RUN).get()).data(); }

test('assigning a driver is one call: it saves, raises the revision and records before and after', async (t) => {
  const start = await run();
  const requestId = rid();
  const t0 = Date.now();
  const out = await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId, runDocId: RUN, day: 'tue', driverId: 'drv_test_adams', expectedRev: start.rev });
  const ms = Date.now() - t0;
  assert.equal(out.ok, true);
  assert.deepEqual(out.runs, [{ runDocId: RUN, rev: start.rev + 1 }]);
  const after = await run();
  assert.equal(after.days.tue.driverId, 'drv_test_adams');
  assert.equal(after.days.tue.driver, 'ADAMS, PAT');
  assert.equal(after.days.tue.updatedBy, 'dispatch.test@uniteddairy.com');
  assert.equal(after.testEdited, true);
  const log = (await db().collection('actions').doc(requestId).get()).data();
  assert.deepEqual(log.before, { driverId: '', driver: '' });
  assert.deepEqual(log.after, { driverId: 'drv_test_adams', driver: 'ADAMS, PAT' });
  assert.equal(log.mode, 'test');
  t.diagnostic('save took ' + ms + ' ms against the local test database');
});

test('sending the same save twice saves once', async () => {
  const requestId = rid();
  const first = await applyAction(db(), DISPATCHER, { action: 'assignTruck', requestId, runDocId: RUN, day: 'tue', equipmentId: 'veh_truck_900002' });
  const second = await applyAction(db(), DISPATCHER, { action: 'assignTruck', requestId, runDocId: RUN, day: 'tue', equipmentId: 'veh_truck_900002' });
  assert.equal(second.repeated, true);
  assert.deepEqual(second.runs, first.runs);
  assert.equal((await run()).rev, first.runs[0].rev);
});

test('a save on a run someone else just changed is refused, not lost', async () => {
  const start = await run();
  await applyAction(db(), DISPATCHER, { action: 'assignTrailer', requestId: rid(), runDocId: RUN, day: 'tue', equipmentId: 'veh_trailer_t_901', expectedRev: start.rev });
  await assert.rejects(
    applyAction(db(), MANAGER, { action: 'assignTrailer', requestId: rid(), runDocId: RUN, day: 'tue', equipmentId: 'veh_trailer_t_902', expectedRev: start.rev }),
    e => e.code === 'CHANGED');
  assert.equal((await run()).days.tue.trailer, 'T-901');
});

test('only people with a dispatch role may save', async () => {
  await assert.rejects(applyAction(db(), VIEWER, { action: 'assignDriver', requestId: rid(), runDocId: RUN, day: 'tue', driverId: 'drv_test_adams' }), e => e.code === 'NOT_ALLOWED');
  await assert.rejects(applyAction(db(), { email: 'nobody@uniteddairy.com' }, { action: 'assignDriver', requestId: rid(), runDocId: RUN, day: 'tue', driverId: 'drv_test_adams' }), e => e.code === 'NOT_ALLOWED');
});

test('unknown, inactive and wrong-type units and drivers are refused', async () => {
  const base = { requestId: '', runDocId: RUN, day: 'tue' };
  await assert.rejects(applyAction(db(), DISPATCHER, Object.assign({}, base, { action: 'assignDriver', requestId: rid(), driverId: 'drv_test_dunn' })), /INACTIVE/);
  await assert.rejects(applyAction(db(), DISPATCHER, Object.assign({}, base, { action: 'assignDriver', requestId: rid(), driverId: 'drv_nobody' })), /not in Driver Master/);
  await assert.rejects(applyAction(db(), DISPATCHER, Object.assign({}, base, { action: 'assignTruck', requestId: rid(), equipmentId: 'veh_trailer_t_901' })), /is a TRAILER/);
  await assert.rejects(applyAction(db(), DISPATCHER, Object.assign({}, base, { action: 'assignTrailer', requestId: rid(), equipmentId: 'veh_trailer_t_903' })), /INACTIVE/);
  await assert.rejects(applyAction(db(), DISPATCHER, Object.assign({}, base, { action: 'assignDriver', requestId: rid(), day: 'sun', driverId: 'drv_test_adams' })), /does not run on Sunday/);
});

test('clearing a driver saves an empty driver', async () => {
  await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: '2026-10-04__run_t801', day: 'mon', driverId: '' });
  assert.equal((await run('2026-10-04__run_t801')).days.mon.driver, '');
});

test('reordering loads keeps the load-order numbers and needs a manager', async () => {
  const order = [{ runDocId: '2026-10-04__run_t802', day: 'tue' }, { runDocId: '2026-10-04__run_t801', day: 'tue' }];
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'reorderLoads', requestId: rid(), loadDate: '2026-10-05', order }), e => e.code === 'NOT_ALLOWED');
  await applyAction(db(), MANAGER, { action: 'reorderLoads', requestId: rid(), loadDate: '2026-10-05', order });
  const runs = (await db().collection('runs').where('weekStart', 'in', L.weeksForLoadDate('2026-10-05')).get()).docs.map(d => Object.assign({ id: d.id }, d.data()));
  const daily = L.dailyRows(runs, '2026-10-05');
  assert.deepEqual(daily.map(r => r.route + '=' + r.loadSequence), ['802=20', '801=30']);
  await assert.rejects(applyAction(db(), MANAGER, { action: 'reorderLoads', requestId: rid(), loadDate: '2026-10-06', order }), /does not load on 2026-10-06/);
});

test('a test save stays until that run changes in the sheet, then the sheet wins', async () => {
  await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: RUN, day: 'tue', driverId: 'drv_test_adams' });
  await runTransfer({ db: db(), reader: F.fakeReader(tabs), sources: F.SOURCES, now: tick });
  assert.equal((await run()).days.tue.driver, 'ADAMS, PAT');
  const live = tabs["'LIVE CURRENT WEEK'"], h = live[5], row = live.find(r => r[h.indexOf('run_id')] === 'run_t802');
  row[h.indexOf('tue_driver_id')] = 'drv_test_casey'; row[h.indexOf('tue_driver')] = 'CASEY, LEE';
  const before = (await run()).rev;
  await runTransfer({ db: db(), reader: F.fakeReader(tabs), sources: F.SOURCES, now: tick });
  const after = await run();
  assert.equal(after.days.tue.driver, 'CASEY, LEE');
  assert.equal(after.testEdited, undefined);
  assert.ok(after.rev > before, 'the revision only goes up');
});

test('saves stop if the app is ever switched out of test mode before cutover is built', async () => {
  await db().collection('config').doc('app').set({ mode: 'live' }, { merge: true });
  await assert.rejects(applyAction(db(), MANAGER, { action: 'assignDriver', requestId: rid(), runDocId: RUN, day: 'tue', driverId: 'drv_test_adams' }), /test mode only/);
});
