'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const { runWriteBack, assertSandboxTarget } = require('../../src/writeback');
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
