'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const { runWriteBack, assertSandboxTarget, assertLiveTarget } = require('../../src/writeback');
const F = require('../fixtures/fake-sheets');

const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
const MANAGER = { email: 'manager.test@uniteddairy.com' };
const SANDBOX = { spreadsheetId: 'fake-live' };
let n = 0;
const rid = () => 'wb-request-' + (++n) + '-' + Date.now();
let clock = 0;
const tick = () => new Date(Date.parse('2026-10-09T12:00:00Z') + (++clock) * 60000);

let tabs, sheets;
test.beforeEach(async () => {
  await clear();
  tabs = F.fakeSheets();
  sheets = F.fakeWritableSheets(tabs);
  await runTransfer({ db: db(), reader: sheets, sources: F.SOURCES, now: tick });
  await db().collection('config').doc('app').set({ writeBack: { enabled: true } }, { merge: true });
});

test('with the write-back off, saves queue nothing for the sheet', async () => {
  await db().collection('config').doc('app').set({ writeBack: { enabled: false } }, { merge: true });
  await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: '2026-10-04__run_t802', day: 'tue', driverId: 'drv_test_adams' });
  assert.equal((await db().collection('outbox').get()).size, 0);
});

const CURRENT = "'LIVE CURRENT WEEK'";
function cellOf(runId, column, days) {
  const v = tabs[CURRENT], h = v[5];
  const rows = v.filter((r, i) => i > 5 && r[h.indexOf('run_id')] === runId && (!days || r[h.indexOf(days + '_runs')] === 'TRUE'));
  assert.equal(rows.length, 1, 'one row for ' + runId);
  return rows[0][h.indexOf(column)];
}
function setCell(runId, column, value) {
  const v = tabs[CURRENT], h = v[5];
  v.find((r, i) => i > 5 && r[h.indexOf('run_id')] === runId)[h.indexOf(column)] = value;
}

test('a save is written into its row in the sandbox Live sheet, found by run_id', async () => {
  // Sort the tab after the copy: the write-back must still find the right row.
  tabs[CURRENT] = tabs[CURRENT].slice(0, 6).concat(tabs[CURRENT].slice(6).reverse());
  sheets = F.fakeWritableSheets(tabs);
  await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: '2026-10-04__run_t802', day: 'tue', driverId: 'drv_test_adams' });
  const out = await runWriteBack({ db: db(), sheets, target: SANDBOX, now: tick });
  assert.equal(out.conflicts, 0);
  assert.equal(cellOf('run_t802', 'tue_driver_id'), 'drv_test_adams');
  assert.equal(cellOf('run_t802', 'tue_driver'), 'ADAMS, PAT');
  assert.equal(cellOf('run_t802', 'tue_updated_by'), 'dispatch.test@uniteddairy.com');
  assert.equal(sheets.writes.length, 1, 'one write request for the tab');
  const queued = (await db().collection('outbox').where('status', '==', 'pending').get()).size;
  assert.equal(queued, 0);
  // Running it again writes nothing.
  assert.equal((await runWriteBack({ db: db(), sheets, target: SANDBOX, now: tick })).items, 0);
});

test('a cell someone changed in the sheet is kept and listed as a conflict, not overwritten', async () => {
  setCell('run_t802', 'tue_trailer_id', 'veh_trailer_t_902');
  setCell('run_t802', 'tue_trailer', 'T-902');
  await applyAction(db(), DISPATCHER, { action: 'assignTrailer', requestId: rid(), runDocId: '2026-10-04__run_t802', day: 'tue', equipmentId: 'veh_trailer_t_901' });
  const out = await runWriteBack({ db: db(), sheets, target: SANDBOX, now: tick });
  assert.equal(out.conflicts, 2);
  assert.equal(cellOf('run_t802', 'tue_trailer'), 'T-902', 'the hand-typed value stays');
  const conflicts = (await db().collection('conflicts').get()).docs.map(d => d.data());
  const c = conflicts.find(x => x.column === 'tue_trailer');
  assert.equal(c.sheetValue, 'T-902');
  assert.equal(c.newValue, 'T-901');
  assert.match(c.problem, /sheet value was kept/);
  assert.equal(c.open, true);
  // A dispatcher checks it and takes it off the open list; a second click changes nothing.
  const id = (await db().collection('conflicts').where('column', '==', 'tue_trailer').get()).docs[0].id;
  await applyAction(db(), DISPATCHER, { action: 'clearConflict', requestId: rid(), conflictId: id });
  await applyAction(db(), DISPATCHER, { action: 'clearConflict', requestId: rid(), conflictId: id });
  const cleared = (await db().collection('conflicts').doc(id).get()).data();
  assert.equal(cleared.open, false);
  assert.equal(cleared.clearedBy, 'dispatch.test@uniteddairy.com');
  await assert.rejects(applyAction(db(), { email: 'viewer.test@uniteddairy.com' }, { action: 'clearConflict', requestId: rid(), conflictId: id }), /does not have a role/);
});

test('two quick saves to the same cell end with the second one', async () => {
  await applyAction(db(), DISPATCHER, { action: 'assignTruck', requestId: rid(), runDocId: '2026-10-04__run_t802', day: 'tue', equipmentId: 'veh_truck_900001' });
  await applyAction(db(), DISPATCHER, { action: 'assignTruck', requestId: rid(), runDocId: '2026-10-04__run_t802', day: 'tue', equipmentId: 'veh_truck_900002' });
  const out = await runWriteBack({ db: db(), sheets, target: SANDBOX, now: tick });
  assert.equal(out.conflicts, 0);
  assert.equal(cellOf('run_t802', 'tue_truck'), '900002');
});

test('a new load order writes the load order numbers', async () => {
  await applyAction(db(), MANAGER, { action: 'reorderLoads', requestId: rid(), loadDate: '2026-10-05', order: [{ runDocId: '2026-10-04__run_t802', day: 'tue' }, { runDocId: '2026-10-04__run_t801', day: 'tue' }] });
  await runWriteBack({ db: db(), sheets, target: SANDBOX, now: tick });
  assert.equal(cellOf('run_t802', 'tue_load_sequence_override'), 20);
  assert.equal(cellOf('run_t801', 'tue_load_sequence_override'), 30);
});

test('a run on two rows is written on the row for that day', async () => {
  await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: '2026-10-04__run_t810__sat', day: 'sat', driverId: 'drv_test_casey' });
  await runWriteBack({ db: db(), sheets, target: SANDBOX, now: tick });
  assert.equal(cellOf('run_t810', 'sat_driver', 'sat'), 'CASEY, LEE');
  assert.equal(cellOf('run_t810', 'sat_driver', 'wed'), '');
});

test('the copy from the sheet waits for a save that is not written yet, then agrees with the sheet', async () => {
  await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: '2026-10-04__run_t802', day: 'tue', driverId: 'drv_test_adams' });
  const held = await runTransfer({ db: db(), reader: sheets, sources: F.SOURCES, now: tick });
  assert.equal(held.summary.weeks['2026-10-04'].waitingForWriteBack, 1);
  assert.equal((await db().collection('runs').doc('2026-10-04__run_t802').get()).data().days.tue.driver, 'ADAMS, PAT');
  await runWriteBack({ db: db(), sheets, target: SANDBOX, now: tick });
  await runTransfer({ db: db(), reader: sheets, sources: F.SOURCES, now: tick });
  const run = (await db().collection('runs').doc('2026-10-04__run_t802').get()).data();
  assert.equal(run.days.tue.driver, 'ADAMS, PAT');
  assert.equal(run.cells.tue_driver_id, 'drv_test_adams');
});

test('the production Live workbook and master sheets are refused', () => {
  assert.throws(() => assertSandboxTarget('11beWtlO848OyZI_Bom9y2WCZn2vnw4mLm24pf-rO1Cg'), /production sheet/);
  assert.throws(() => assertSandboxTarget('1rDZpcOABjGtSqobkIQPPNWyWmanfjyHeidGmTK67PvU'), /production sheet/);
  assert.throws(() => assertSandboxTarget(''), /no sandbox Live workbook/);
});

test('the production server may write the real Uniontown Live workbook, and no other production sheet', () => {
  assert.doesNotThrow(() => assertLiveTarget('11beWtlO848OyZI_Bom9y2WCZn2vnw4mLm24pf-rO1Cg', true));
  assert.throws(() => assertLiveTarget('11beWtlO848OyZI_Bom9y2WCZn2vnw4mLm24pf-rO1Cg', false), /production sheet/);
  assert.throws(() => assertLiveTarget('1rDZpcOABjGtSqobkIQPPNWyWmanfjyHeidGmTK67PvU', true), /production sheet/);
  assert.throws(() => assertLiveTarget('1UrAzrPIe4x6jcNBCjCJUIE8mjvJAniZMoONRGK8GJmw', true), /production sheet/);
  assert.doesNotThrow(() => assertLiveTarget(SANDBOX.spreadsheetId, false));
});

// Joe 10/12: "Let the new app write plant loading to the real Live sheet." A load saved Done at the dock goes to its row (found by
// run_id) with the cells the current app's plant save writes, the hand-typed truck is marked changed by hand, and the load gets
// its LOADOUT HISTORY row (the tab is made the first time); a correction updates the same history row.
test('plant loading: the load, its marks and its LOADOUT HISTORY row are written; a correction updates the same row', async () => {
  delete tabs["'LOADOUT HISTORY'"];
  const RUN = '2026-10-04__run_t802';
  await applyAction(db(), MANAGER, { action: 'savePlantLoad', requestId: rid(), runDocId: RUN, day: 'tue', fields: { status: 'COMPLETE', quantity: 612, temperature: 36, truck: '214', shift: 'FIRST SHIFT', notes: 'Short 2 cases chocolate' } }, tick);
  const out = await runWriteBack({ db: db(), sheets, target: SANDBOX, now: tick });
  assert.equal(out.conflicts, 0);
  assert.equal(cellOf('run_t802', 'tue_load_status'), 'COMPLETE');
  assert.equal(cellOf('run_t802', 'tue_cases_out'), 612);
  assert.equal(cellOf('run_t802', 'tue_load_temperature'), 36);
  assert.match(String(cellOf('run_t802', 'tue_complete_time')), /^2026-10-09T/);
  assert.equal(cellOf('run_t802', 'tue_extension_05'), cellOf('run_t802', 'tue_complete_time'), 'a load marked Done with no Start gets its End time as Start');
  assert.equal(cellOf('run_t802', 'tue_extension_04'), 'FIRST SHIFT');
  assert.equal(cellOf('run_t802', 'tue_extension_03'), 'Short 2 cases chocolate');
  assert.equal(cellOf('run_t802', 'tue_truck'), '214');
  assert.equal(cellOf('run_t802', 'tue_equipment_override'), 'TRUE', 'a truck typed at the dock is marked changed by hand');
  assert.equal(cellOf('run_t802', 'tue_updated_by'), MANAGER.email);
  const hist = tabs["'LOADOUT HISTORY'"];
  assert.deepEqual(hist[0], require('../../src/writeback').HISTORY_HEADERS.slice(), 'the tab is made with the current app\'s headers');
  assert.equal(hist.length, 2);
  const h = hist[0], row = (k) => hist[1][h.indexOf(k)];
  assert.deepEqual([row('route'), row('run_id'), row('load_date'), row('delivery_date'), row('cases_out'), row('load_status'), row('load_temperature'), row('history_key'), row('reason'), row('written_by')],
    ['802', 'run_t802', '2026-10-05', '2026-10-06', '612', 'COMPLETE', '36', 'run_t802|2026-10-05', 'Loadout completed', MANAGER.email]);
  // A correction to the Done load: the week tab and the same history row change; no second history row.
  await applyAction(db(), MANAGER, { action: 'savePlantLoad', requestId: rid(), runDocId: RUN, day: 'tue', fields: { quantity: 610 } }, tick);
  await runWriteBack({ db: db(), sheets, target: SANDBOX, now: tick });
  assert.equal(cellOf('run_t802', 'tue_cases_out'), 610);
  assert.equal(tabs["'LOADOUT HISTORY'"].length, 2, 'one row per run and load day');
  assert.equal(tabs["'LOADOUT HISTORY'"][1][h.indexOf('cases_out')], '610');
  // A load only started (not Done) writes no history.
  await applyAction(db(), MANAGER, { action: 'savePlantLoad', requestId: rid(), runDocId: '2026-10-04__run_t801', day: 'tue', fields: { status: 'LOADING' } }, tick);
  await runWriteBack({ db: db(), sheets, target: SANDBOX, now: tick });
  assert.equal(cellOf('run_t801', 'tue_load_status'), 'LOADING');
  assert.equal(tabs["'LOADOUT HISTORY'"].length, 2);
  assert.equal((await db().collection('outbox').where('status', '==', 'pending').get()).size, 0);
});

test('plant loading: a LOADOUT HISTORY tab with other headers is never written over; the row goes on the conflicts list', async () => {
  tabs["'LOADOUT HISTORY'"] = [['when', 'what']];
  await applyAction(db(), MANAGER, { action: 'savePlantLoad', requestId: rid(), runDocId: '2026-10-04__run_t802', day: 'tue', fields: { status: 'COMPLETE' } }, tick);
  const out = await runWriteBack({ db: db(), sheets, target: SANDBOX, now: tick });
  assert.equal(out.conflicts, 1);
  assert.deepEqual(tabs["'LOADOUT HISTORY'"], [['when', 'what']]);
  assert.equal(cellOf('run_t802', 'tue_load_status'), 'COMPLETE', 'the load itself still reaches the week tab');
  const c = (await db().collection('conflicts').get()).docs.map(d => d.data());
  assert.match(c[0].problem, /other headers/);
});

// Joe 10/13 (852 JERSEY LOAD 2 on the Loadout Center came back after Ended Up Not Running): the copy reads a day that still holds
// a driver as running, so turning a day off (Loadout Center or Daily) takes the driver off too, and it stays off after the copy.
// Joe 10/20 (844 Ohio Processor): dispatch wins on the driver and truck, so the Loadout Center's press is for a load with no
// driver; a load dispatch has a driver on is refused there (next test) and only Daily turns it off.
for (const [name, save, driver] of [
  ['the Loadout Center\'s Ended Up Not Running', () => ({ action: 'savePlantLoad', fields: { runs: false } }), false],
  ['Daily\'s not running', () => ({ action: 'setRuns', runs: false }), true]
]) {
  test(name + ' stays off after the write-back and the next copy of the sheet', async () => {
    const RUN = '2026-10-04__run_t802';
    if (driver) await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: RUN, day: 'tue', driverId: 'drv_test_adams' }, tick);
    await applyAction(db(), DISPATCHER, { action: 'assignTrailer', requestId: rid(), runDocId: RUN, day: 'tue', equipmentId: 'veh_trailer_t_901' }, tick);
    await runWriteBack({ db: db(), sheets, target: SANDBOX, now: tick });
    await runTransfer({ db: db(), reader: sheets, sources: F.SOURCES, now: tick });
    assert.equal((await db().collection('runs').doc(RUN).get()).data().days.tue.trailer, 'T-901');
    await applyAction(db(), DISPATCHER, Object.assign({ requestId: rid(), runDocId: RUN, day: 'tue' }, save()), tick);
    assert.equal((await runWriteBack({ db: db(), sheets, target: SANDBOX, now: tick })).conflicts, 0);
    assert.equal(cellOf('run_t802', 'tue_runs'), 'FALSE');
    assert.equal(cellOf('run_t802', 'tue_driver'), '');
    ['tue_driver_id', 'tue_truck', 'tue_tractor_id', 'tue_trailer', 'tue_trailer_id'].forEach(c => assert.equal(cellOf('run_t802', c), '', c + ' is cleared'));
    await runTransfer({ db: db(), reader: sheets, sources: F.SOURCES, now: tick });
    const day = (await db().collection('runs').doc(RUN).get()).data().days.tue;
    assert.equal(day.runs, false, 'it does not come back');
    if (save().action === 'savePlantLoad') assert.match(day.plantNotes || '', /Ended up not running .*\((truck was \S+, )?trailer was T-901\)/);
    assert.deepEqual([day.driver, day.truck, day.trailer], ['', '', ''], 'the driver, truck and trailer are free that day');
  });
}

test('the Loadout Center cannot end a load dispatch has a driver on: the driver, truck and day stay (Joe 10/20, 844)', async () => {
  const RUN = '2026-10-04__run_t802';
  await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: RUN, day: 'tue', driverId: 'drv_test_adams' }, tick);
  const before = (await db().collection('runs').doc(RUN).get()).data().days.tue;
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'savePlantLoad', requestId: rid(), runDocId: RUN, day: 'tue', fields: { runs: false } }, tick), /Dispatch has ADAMS, PAT on this load/);
  const day = (await db().collection('runs').doc(RUN).get()).data().days.tue;
  assert.deepEqual([day.runs, day.driver, day.driverId, day.truck], [before.runs, 'ADAMS, PAT', 'drv_test_adams', before.truck]);
});

// Review item 64 (Joe 10/13): the on-save pass and the every-minute pass can run at the same time.
test('two write-back passes at once: each save is claimed by one pass only and written once', async () => {
  await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: '2026-10-04__run_t802', day: 'tue', driverId: 'drv_test_adams' });
  const slow = Object.assign({}, sheets, { batchGet: async (...a) => { await new Promise(r => setTimeout(r, 300)); return sheets.batchGet(...a); } });
  const [a, b] = await Promise.all([runWriteBack({ db: db(), sheets: slow, target: SANDBOX, now: tick }), runWriteBack({ db: db(), sheets: slow, target: SANDBOX, now: tick })]);
  assert.equal(a.items + b.items, 1, 'one pass took the save, the other found nothing to do');
  assert.equal(sheets.writes.length, 1);
  assert.equal(cellOf('run_t802', 'tue_driver'), 'ADAMS, PAT');
  const left = (await db().collection('outbox').get()).docs.map(d => d.data().status);
  assert.deepEqual(left, ['done']);
});

test('a sheet write that fails puts the claimed saves back to wait for the next pass', async () => {
  await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: '2026-10-04__run_t802', day: 'tue', driverId: 'drv_test_adams' });
  const broken = Object.assign({}, sheets, { batchUpdate: async () => { throw new Error('quota'); } });
  await assert.rejects(runWriteBack({ db: db(), sheets: broken, target: SANDBOX, now: tick }), /quota/);
  const item = (await db().collection('outbox').get()).docs[0].data();
  assert.equal(item.status, 'pending');
  assert.match(item.lastError, /quota/);
  assert.equal((await runWriteBack({ db: db(), sheets, target: SANDBOX, now: tick })).items, 1);
  assert.equal(cellOf('run_t802', 'tue_driver'), 'ADAMS, PAT');
});

test('a write-back pass saves only the cells it wrote on the run, never an older copy of the rest', async () => {
  await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: '2026-10-04__run_t802', day: 'tue', driverId: 'drv_test_adams' });
  const ref = db().collection('runs').doc('2026-10-04__run_t802');
  // A copy from the sheet lands while the pass is writing the sheet.
  const during = Object.assign({}, sheets, { batchUpdate: async (...a) => { await sheets.batchUpdate(...a); await ref.update({ 'cells.wed_driver_notes': 'from the sheet copy' }); } });
  await runWriteBack({ db: db(), sheets: during, target: SANDBOX, now: tick });
  const cells = (await ref.get()).data().cells;
  assert.equal(cells.wed_driver_notes, 'from the sheet copy', 'the newer copy is kept');
  assert.equal(cells.tue_driver, 'ADAMS, PAT');
});

// Review item 65 (Joe 10/13): a unit down on the same run in this week and next week.
test('Truck Down on the same run in both weeks queues a sheet change for each week', async () => {
  const weeks = ['2026-10-04', '2026-10-11'];
  for (const w of weeks) {
    const ref = db().collection('runs').doc(w + '__run_t802');
    if (!(await ref.get()).exists) continue;
    await ref.update({ 'days.tue.truckId': 'veh_truck_900002', 'days.tue.truck': '900002' });
  }
  const present = (await Promise.all(weeks.map(w => db().collection('runs').doc(w + '__run_t802').get()))).filter(s => s.exists).length;
  assert.equal(present, 2, 'the fixture has the run in both weeks');
  const requestId = rid();
  await applyAction(db(), DISPATCHER, { action: 'setUnitDown', requestId, equipmentId: 'veh_truck_900002', reason: 'Brakes' }, () => new Date('2026-10-06T16:00:00Z'));
  const queued = (await db().collection('outbox').get()).docs.map(d => d.data()).filter(d => d.requestId === requestId && /run_t802/.test(d.runDocId));
  assert.deepEqual(queued.map(d => d.runDocId).sort(), weeks.map(w => w + '__run_t802'));
});

// Review item 66 (Joe 10/13): a renamed or deleted tab used to stop every save, because all tabs were read in one request.
test('a save for a tab the workbook no longer has goes on the conflicts list; saves for the other tabs are still written', async () => {
  await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: '2026-10-04__run_t802', day: 'tue', driverId: 'drv_test_adams' });
  const badRequest = rid();
  await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: badRequest, runDocId: '2026-10-04__run_t801', day: 'mon', driverId: 'drv_test_adams' });
  // The second save's tab was renamed in the sheet after it was queued.
  const bad = (await db().collection('outbox').where('requestId', '==', badRequest).get()).docs;
  assert.ok(bad.length >= 1);
  for (const d of bad) await d.ref.update({ tab: 'LIVE WEEK RENAMED' });
  const out = await runWriteBack({ db: db(), sheets, target: SANDBOX, now: tick });
  assert.equal(cellOf('run_t802', 'tue_driver'), 'ADAMS, PAT', 'the good tab is written');
  assert.ok(out.conflicts >= 1);
  const left = (await db().collection('outbox').get()).docs.map(d => d.data());
  left.filter(d => d.requestId === badRequest).forEach(d => assert.equal(d.status, 'conflict'));
  left.filter(d => d.requestId !== badRequest).forEach(d => assert.equal(d.status, 'done'));
  const c = (await db().collection('conflicts').get()).docs.map(d => d.data()).find(x => x.requestId === badRequest);
  assert.match(c.problem, /no tab named LIVE WEEK RENAMED/);
  assert.equal(c.open, true);
});

test('a sheet read that fails for another reason still puts every claimed save back to wait', async () => {
  await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: '2026-10-04__run_t802', day: 'tue', driverId: 'drv_test_adams' });
  const broken = Object.assign({}, sheets, { batchGet: async () => { throw new Error('quota'); } });
  await assert.rejects(runWriteBack({ db: db(), sheets: broken, target: SANDBOX, now: tick }), /quota/);
  assert.equal((await db().collection('outbox').get()).docs[0].data().status, 'pending');
});
