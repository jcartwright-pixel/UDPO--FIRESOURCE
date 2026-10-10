'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const { setSwitch } = require('../../src/switch');
const { runWriteBack } = require('../../src/writeback');
const F = require('../fixtures/fake-sheets');

const ADMIN = { email: 'admin.test@uniteddairy.com' };
const MANAGER = { email: 'manager.test@uniteddairy.com' };
const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
const SANDBOX = { spreadsheetId: 'fake-live' };
let n = 0, clock = 0;
const rid = () => 'switch-request-' + (++n) + '-' + Date.now();
const tick = () => new Date(Date.parse('2026-10-09T12:00:00Z') + (++clock) * 60000);
const assign = (driverId) => ({ action: 'assignDriver', requestId: rid(), runDocId: '2026-10-04__run_t802', day: 'tue', driverId });
const config = async () => (await db().collection('config').doc('app').get()).data();

let tabs, sheets;
test.beforeEach(async () => {
  await clear();
  tabs = F.fakeSheets();
  sheets = F.fakeWritableSheets(tabs);
  await runTransfer({ db: db(), reader: sheets, sources: F.SOURCES, now: tick });
});

test('every screen starts on the current app and the copy says so', async () => {
  const c = await config();
  assert.equal(c.mode, 'test');
  assert.ok(Object.values(c.screenOwners).every(o => o === 'old'));
});

test('only an administrator flips the switch, and a screen needs the write-back on first', async () => {
  await assert.rejects(setSwitch(db(), MANAGER, { requestId: rid(), writeBack: true }, true), /Only an administrator/);
  await assert.rejects(setSwitch(db(), ADMIN, { requestId: rid(), screen: 'dailyDispatch', owner: 'new' }, true), /write-back on first/);
  await assert.rejects(setSwitch(db(), ADMIN, { requestId: rid(), writeBack: true }, false), /no sandbox sheet/);
  await assert.rejects(setSwitch(db(), ADMIN, { requestId: rid(), screen: 'nope', owner: 'new' }, true), /Unknown screen/);
  await setSwitch(db(), ADMIN, { requestId: rid(), writeBack: true }, true);
  const out = await setSwitch(db(), ADMIN, { requestId: rid(), screen: 'dailyDispatch', owner: 'new' }, true);
  assert.equal(out.screenOwners.dailyDispatch, 'new');
  assert.equal((await config()).writeBack.enabled, true);
  // The write-back stays on while any screen belongs to the new app.
  await assert.rejects(setSwitch(db(), ADMIN, { requestId: rid(), writeBack: false }, true), /back to the current app/);
  const log = await db().collection('actions').where('action', '==', 'switchScreen').get();
  assert.equal(log.size, 1);
  assert.equal(log.docs[0].data().before.screenOwners.dailyDispatch, 'old');
});

test('once a screen is on the new app, only that screen saves there; the others are view only', async () => {
  await setSwitch(db(), ADMIN, { requestId: rid(), writeBack: true }, true);
  await setSwitch(db(), ADMIN, { requestId: rid(), screen: 'dailyDispatch', owner: 'new' }, true);
  const ok = await applyAction(db(), DISPATCHER, assign('drv_test_adams'), tick);
  assert.equal(ok.ok, true);
  assert.equal((await db().collection('actions').doc(ok.requestId).get()).data().mode, 'live');
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'publishWeek', requestId: rid(), weekStart: '2026-10-04' }, tick), /Weekly Dispatch is still run from the current app/);
  // Moving it back makes every screen a test copy again.
  await setSwitch(db(), ADMIN, { requestId: rid(), screen: 'dailyDispatch', owner: 'old' }, true);
  await applyAction(db(), DISPATCHER, { action: 'publishWeek', requestId: rid(), weekStart: '2026-10-04' }, tick);
});

test('with a screen on the new app the copy keeps running, and does not undo a save the sheet does not show yet', async () => {
  await setSwitch(db(), ADMIN, { requestId: rid(), writeBack: true }, true);
  await setSwitch(db(), ADMIN, { requestId: rid(), screen: 'dailyDispatch', owner: 'new' }, true);
  const before = JSON.parse(JSON.stringify(tabs));
  const readStarted = tick();
  await applyAction(db(), DISPATCHER, assign('drv_test_adams'), tick);
  await runWriteBack({ db: db(), sheets, target: SANDBOX, now: tick });
  // A copy that read the sheet just before the write-back wrote it.
  await runTransfer({ db: db(), reader: F.fakeReader(before), sources: F.SOURCES, now: () => readStarted, force: true });
  const run = (await db().collection('runs').doc('2026-10-04__run_t802').get()).data();
  assert.equal(run.days.tue.driverId, 'drv_test_adams');
  assert.equal((await config()).mode, 'live');
  // The next copy reads the written sheet and agrees.
  await runTransfer({ db: db(), reader: sheets, sources: F.SOURCES, now: tick });
  assert.equal((await db().collection('runs').doc('2026-10-04__run_t802').get()).data().days.tue.driverId, 'drv_test_adams');
});

test('with the write-back off the copy still refuses to run over a screen on the new app', async () => {
  await db().collection('config').doc('app').set({ screenOwners: { dailyDispatch: 'new' }, writeBack: { enabled: false } }, { merge: true });
  await assert.rejects(runTransfer({ db: db(), reader: sheets, sources: F.SOURCES, now: tick }), /write-back is off/);
  await assert.rejects(applyAction(db(), DISPATCHER, assign('drv_test_adams'), tick), /write-back is off/);
});
