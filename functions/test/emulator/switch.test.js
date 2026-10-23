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
  await assert.rejects(setSwitch(db(), ADMIN, { requestId: rid(), writeBack: false }, true), /press Pause writing to the sheets/);
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
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'publishWeek', requestId: rid(), weekStart: '2026-10-04' }, tick), /Weekly Dispatch is view only until it is switched on in Administration > Go-Live Switches/);
  // Audit batch 2: a screen that is on stays on, so its saves are never turned into view only.
  await assert.rejects(setSwitch(db(), ADMIN, { requestId: rid(), screen: 'dailyDispatch', owner: 'old' }, true), /Daily Dispatch stays on so it keeps saving/);
  assert.equal((await config()).screenOwners.dailyDispatch, 'new');
  assert.equal((await applyAction(db(), DISPATCHER, assign('drv_test_brook'), tick)).ok, true);
});

// Audit batch 2 (Joe 10/23): the emergency stop pauses writing to the sheets; every screen keeps saving and the saves wait.
test('Pause writing to the sheets keeps every screen saving; Resume writes the waiting saves in order', async () => {
  await assert.rejects(setSwitch(db(), ADMIN, { requestId: rid(), sheetsPaused: true }, true), /nothing to pause/);
  await setSwitch(db(), ADMIN, { requestId: rid(), allReady: true }, true);
  await assert.rejects(setSwitch(db(), MANAGER, { requestId: rid(), sheetsPaused: true }, true), /Only an administrator/);
  await assert.rejects(setSwitch(db(), ADMIN, { requestId: rid(), sheetsPaused: 'yes' }, true), /sheetsPaused must be true or false/);
  const out = await setSwitch(db(), ADMIN, { requestId: rid(), sheetsPaused: true }, true);
  assert.equal(out.sheetsPaused, true);
  let c = await config();
  assert.equal(c.sheetWrites.paused, true);
  assert.equal(c.sheetWrites.changedBy, ADMIN.email);
  assert.equal(c.writeBack.enabled, true, 'the write-back stays on, so saves keep queuing');
  assert.equal(c.screenOwners.dailyDispatch, 'new', 'no screen is switched off');
  // A save while paused goes ahead and waits in the outbox; the copy keeps the app's answer while it waits.
  assert.equal((await applyAction(db(), DISPATCHER, assign('drv_test_adams'), tick)).ok, true);
  const waiting = await db().collection('outbox').where('status', '==', 'pending').get();
  assert.ok(waiting.size > 0, 'the save waits for the sheet');
  await runTransfer({ db: db(), reader: sheets, sources: F.SOURCES, now: tick, force: true });
  assert.equal((await db().collection('runs').doc('2026-10-04__run_t802').get()).data().days.tue.driverId, 'drv_test_adams');
  assert.equal((await db().collection('actions').where('action', '==', 'pauseSheetWrites').get()).size, 1);
  await setSwitch(db(), ADMIN, { requestId: rid(), sheetsPaused: false }, true);
  c = await config();
  assert.equal(c.sheetWrites.paused, false);
  assert.equal((await db().collection('actions').where('action', '==', 'resumeSheetWrites').get()).size, 1);
  await runWriteBack({ db: db(), sheets, target: SANDBOX, now: tick });
  assert.equal((await db().collection('outbox').where('status', '==', 'pending').get()).size, 0, 'Resume writes the waiting saves');
});

// Joe 10/13 ("I can't select the routes"): Over the Road and Driver Scorecard write no sheet, so they save whatever the switches say.
test('Over the Road and Driver Scorecard are never view only: they write no sheet', async () => {
  await setSwitch(db(), ADMIN, { requestId: rid(), writeBack: true }, true);
  await setSwitch(db(), ADMIN, { requestId: rid(), screen: 'dailyDispatch', owner: 'new' }, true);
  const ok = await applyAction(db(), MANAGER, { action: 'saveOtr', requestId: rid(), op: 'route', runId: 'run_t801', include: true, destination: 'SAL', deliveredBy: 'United Dairy Delivered' }, tick);
  assert.equal(ok.ok, true);
  assert.equal((await db().collection('otrRoutes').doc('run_t801').get()).data().include, true);
  const tabsBefore = JSON.stringify(tabs);
  await runWriteBack({ db: db(), sheets, target: SANDBOX, now: tick });
  assert.equal(JSON.stringify(tabs), tabsBefore, 'nothing goes to the sheet');
});

// Joe 10/13 ("I want everything working"): Fleet Service Setup, Operational Assignments and Sheet Conflicts' Clear write no
// sheet either, so they save with Daily Dispatch on and Driver Check-ins / Drivers still off.
test('Fleet Service Setup, Operational Assignments and Clear on Sheet Conflicts are never view only', async () => {
  await setSwitch(db(), ADMIN, { requestId: rid(), writeBack: true }, true);
  await setSwitch(db(), ADMIN, { requestId: rid(), screen: 'dailyDispatch', owner: 'new' }, true);
  const c = await config();
  assert.equal(c.screenOwners.checkIns || 'old', 'old');
  assert.equal(c.screenOwners.drivers || 'old', 'old');
  assert.equal((await applyAction(db(), MANAGER, { action: 'saveFleetRules', requestId: rid(), rules: { truckMiles: 20000 } }, tick)).ok, true);
  assert.equal((await applyAction(db(), MANAGER, { action: 'saveOpsAssignment', requestId: rid(), assignment: 'Beckley', sequence: 5 }, tick)).ok, true);
  const tabsBefore = JSON.stringify(tabs);
  await runWriteBack({ db: db(), sheets, target: SANDBOX, now: tick });
  assert.equal(JSON.stringify(tabs), tabsBefore, 'nothing goes to the sheet');
  // A save on a screen whose sheet switch is off is still refused.
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'updateIssue', requestId: rid(), recordId: 'any-write-up', step: 'reviewed' }, tick), /Driver Check-ins is view only until it is switched on/);
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

// Administration > Go-Live Switches (Joe 10/12).
test('Turn on everything that is ready turns the write-back on and moves only the ready screens', async () => {
  const out = await setSwitch(db(), ADMIN, { requestId: rid(), allReady: true }, true);
  assert.equal(out.writeBack, true);
  assert.equal(out.screenOwners.dailyDispatch, 'new');
  assert.equal(out.screenOwners.weeklyDispatch, 'new');
  assert.equal(out.screenOwners.plantLoading, 'new', 'Plant Loading is ready (Joe 10/12)');
  // Joe 10/12 ("Let the new app write Route Master, Driver Master, ... and Vacations to the real sheets."): Drivers, Vacation
  // Schedule and Route Editor are ready too; Driver Check-ins is not.
  // Joe 10/12 ("... and make Driver Check-ins ready"): Driver Check-ins too, so every screen moves.
  ['drivers', 'vacations', 'routes', 'checkIns'].forEach(k => assert.equal(out.screenOwners[k], 'new', k + ' is ready (Joe 10/12)'));
  assert.equal(out.screenOwners.plant, 'new', 'Plant Operations is ready (Joe 10/12, "turn all 8 sheets on")');
  const c = await config();
  assert.equal(c.mode, 'live');
  assert.equal(c.writeBack.enabled, true);
  assert.equal((await db().collection('actions').where('action', '==', 'turnOnAllReady').get()).size, 1);
});

// Every screen is ready now (Joe 10/12), so the refusal is checked with Driver Check-ins marked not ready in this test only.
test('a screen that is not ready cannot move to the new app', async () => {
  const L = require('../../src/logic'), kept = L.GO_LIVE.checkIns;
  L.GO_LIVE.checkIns = Object.assign({}, kept, { ready: false, why: 'Not built yet.' });
  try {
    await setSwitch(db(), ADMIN, { requestId: rid(), writeBack: true }, true);
    await assert.rejects(setSwitch(db(), ADMIN, { requestId: rid(), screen: 'checkIns', owner: 'new' }, true), /Driver Check-ins is not ready/);
    assert.equal((await config()).screenOwners.checkIns, 'old');
    const all = await setSwitch(db(), ADMIN, { requestId: rid(), allReady: true }, true);
    assert.equal(all.screenOwners.checkIns, 'old', 'Turn on everything that is ready leaves a screen that is not ready');
  } finally { L.GO_LIVE.checkIns = kept; }
});

test('Fully live needs the new app, and Undo fully live clears it', async () => {
  await setSwitch(db(), ADMIN, { requestId: rid(), writeBack: true }, true);
  await assert.rejects(setSwitch(db(), ADMIN, { requestId: rid(), screen: 'dailyDispatch', fullyLive: true }, true), /before marking it fully live/);
  await setSwitch(db(), ADMIN, { requestId: rid(), screen: 'dailyDispatch', owner: 'new' }, true);
  await setSwitch(db(), ADMIN, { requestId: rid(), screen: 'dailyDispatch', fullyLive: true }, true);
  assert.deepEqual((await config()).fullyLive, { dailyDispatch: true });
  await setSwitch(db(), ADMIN, { requestId: rid(), screen: 'dailyDispatch', fullyLive: false }, true);
  assert.deepEqual((await config()).fullyLive, {});
  assert.equal((await config()).writeBack.enabled, true, 'the rest of the write-back setting is kept');
});

// Joe 10/12: Plant Loading is its own switch. With dispatch on the new app and Plant Loading still on the current app, the dock's
// saves are refused in the new app (the current app runs them); moved to the new app, they save and go to the Live sheet.
test('Plant Loading moves on its own: refused while on the current app, saved and queued for the sheet once moved', async () => {
  await setSwitch(db(), ADMIN, { requestId: rid(), writeBack: true }, true);
  await setSwitch(db(), ADMIN, { requestId: rid(), screen: 'dailyDispatch', owner: 'new' }, true);
  const load = () => ({ action: 'savePlantLoad', requestId: rid(), runDocId: '2026-10-04__run_t802', day: 'tue', fields: { status: 'LOADING' } });
  await assert.rejects(applyAction(db(), MANAGER, load(), tick), /Plant Loading is view only until it is switched on/);
  await setSwitch(db(), ADMIN, { requestId: rid(), screen: 'plantLoading', owner: 'new' }, true);
  await applyAction(db(), MANAGER, load(), tick);
  await runWriteBack({ db: db(), sheets, target: SANDBOX, now: tick });
  const v = tabs["'LIVE CURRENT WEEK'"], h = v[5];
  assert.equal(v.find((r, i) => i > 5 && r[h.indexOf('run_id')] === 'run_t802')[h.indexOf('tue_load_status')], 'LOADING');
  // The write-back cannot be turned off while Plant Loading is on the new app.
  await assert.rejects(setSwitch(db(), ADMIN, { requestId: rid(), writeBack: false }, true), /press Pause writing to the sheets/);
});
