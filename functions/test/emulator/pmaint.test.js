'use strict';
// Plant Maintenance (Joe 10/12): the machinery list per plant (the production lines come in by themselves, more can be added)
// and Make Work Order, which turns a plant's maintenance request into one work order so the plant and maintenance share one record.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const D = require('../../src/demo-sheets');
const PD = require('../fixtures/plant-demo');

let n = 0;
const rid = () => 'pmaint-request-' + (++n) + '-' + Date.now();
const MANAGER = 'manager.test@uniteddairy.com', DISPATCHER = 'dispatch.test@uniteddairy.com', PLANT = 'viewer.test@uniteddairy.com';
const act = (email, action, fields) => applyAction(db(), { email }, Object.assign({ action, requestId: rid() }, fields));
const machine = (fields, email) => act(email || MANAGER, 'saveMachine', Object.assign({ facilityId: 'fac_uniontown' }, fields));

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: D.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
});

test('Machinery: a manager adds a machine and fills in a line\'s boxes one at a time; names stay unique', async () => {
  const added = await machine({ fields: { name: 'Boiler', kind: 'Utility', area: 'Utilities' } });
  assert.equal(added.machineId, 'fac_uniontown_mach_boiler');
  assert.equal(added.created, true);
  await machine({ machineId: added.machineId, fields: { make: 'Cleaver-Brooks' } });
  await machine({ machineId: 'ut_prod_gallon_filler', fields: { serial: 'FD-40-11872' } });
  await machine({ machineId: 'ut_prod_gallon_filler', fields: { installed: '2011-06-14' } });
  const boiler = (await db().collection('plantMachines').doc(added.machineId).get()).data();
  assert.deepEqual([boiler.name, boiler.kind, boiler.area, boiler.make, boiler.status], ['Boiler', 'Utility', 'Utilities', 'Cleaver-Brooks', 'ACTIVE']);
  const filler = (await db().collection('plantMachines').doc('ut_prod_gallon_filler').get()).data();
  assert.deepEqual([filler.name, filler.line, filler.kind, filler.serial, filler.installed], ['GALLON FILLER', true, 'Production line', 'FD-40-11872', '2011-06-14']);
  await assert.rejects(machine({ fields: { name: 'boiler' } }), /already on this plant's machinery list/);
  await assert.rejects(machine({ fields: { name: 'Gallon Filler' } }), /already on this plant's machinery list/);
  await assert.rejects(machine({ machineId: 'ut_prod_gallon_filler', fields: { name: 'FILLER 2' } }), /production line; its name comes from Plant Operations/);
  await assert.rejects(machine({ machineId: 'nope', fields: { make: 'x' } }), /not on this plant's list/);
  await assert.rejects(machine({ machineId: added.machineId, fields: { installed: 'last year' } }), /must be a date/);
  await assert.rejects(machine({ fields: { name: 'Press' } }, DISPATCHER), /does not have a role that can make this save/);
  // Retired: off the list, history kept; the name can be used again.
  await machine({ machineId: added.machineId, status: 'RETIRED' });
  const again = await machine({ fields: { name: 'Boiler' } });
  assert.notEqual(again.machineId, added.machineId);
});

test('Make Work Order: a plant request becomes work order M-1001 for its machine, once; the next one is M-1002', async () => {
  const note = await act(PLANT, 'saveShiftNote', { values: { Entry: 'Filler valve 14 leaking', Type: 'Other', Equipment: 'gallon filler' }, followUpStatus: 'OPEN', shift: 'FIRST SHIFT' });
  const sent = await act(DISPATCHER, 'makeWorkOrder', { entryId: note.entryId, lineDown: 'YES' });
  assert.equal(sent.woNumber, 'M-1001');
  const wo = (await db().collection('plantWorkOrders').doc(sent.workOrderId).get()).data();
  assert.deepEqual([wo.machineId, wo.machine, wo.problem, wo.lineDown, wo.status, wo.source, wo.sourceEntryId, wo.sourceShift, wo.sourceBy],
    ['ut_prod_gallon_filler', 'GALLON FILLER', 'Filler valve 14 leaking', 'YES', 'NEW', 'SHIFT_NOTES', note.entryId, 'FIRST SHIFT', PLANT]);
  const twice = await act(MANAGER, 'makeWorkOrder', { entryId: note.entryId });
  await assert.rejects(act(PLANT, 'makeWorkOrder', { entryId: note.entryId }), /does not have a role that can make this save/);
  assert.deepEqual([twice.already, twice.woNumber], [true, 'M-1001']);
  const other = await act(PLANT, 'saveShiftNote', { values: { Entry: 'Door will not close', Type: 'Other', Equipment: 'Dock 3 door' }, followUpStatus: 'OPEN' });
  const second = await act(DISPATCHER, 'makeWorkOrder', { entryId: other.entryId });
  assert.equal(second.woNumber, 'M-1002');
  const wo2 = (await db().collection('plantWorkOrders').doc(second.workOrderId).get()).data();
  assert.deepEqual([wo2.machineId, wo2.machine], ['', 'Dock 3 door'], 'no machine of that name: the words typed are kept');
  assert.equal((await db().collection('plantWorkOrders').get()).size, 2);
  // A review note under an entry is not a breakdown to send; nor is an entry not on the log.
  const rev = await act(PLANT, 'saveShiftNote', { values: { Entry: 'Wiped down', Type: 'REVIEW', ParentId: note.entryId }, followUpStatus: 'MONITOR' });
  await assert.rejects(act(MANAGER, 'makeWorkOrder', { entryId: rev.entryId }), /no longer on the log/);
  await assert.rejects(act(MANAGER, 'makeWorkOrder', { entryId: 'SHIFT-nope' }), /no longer on the log/);
  await assert.rejects(act(MANAGER, 'makeWorkOrder', { entryId: note.entryId, lineDown: 'maybe' }), /whether the line is down/);
});

test('PM Schedule: a manager adds a PM to a machine, its due day follows; Send to Maintenance makes one work order for that due day', async () => {
  const pm = (fields, extra, email) => act(email || MANAGER, 'savePmTask', Object.assign({ facilityId: 'fac_uniontown', fields }, extra || {}));
  const made = await pm({ machineId: 'ut_prod_gallon_filler', task: 'Grease filler bowl bearings', every: 2, unit: 'WEEKS', lastDone: '2026-09-24' });
  assert.equal(made.nextDue, '2026-10-08');
  const changed = await pm({ every: 1 }, { taskId: made.taskId });
  assert.equal(changed.nextDue, '2026-10-01');
  const task = (await db().collection('plantPmTasks').doc(made.taskId).get()).data();
  assert.deepEqual([task.machine, task.task, task.every, task.unit, task.status], ['GALLON FILLER', 'Grease filler bowl bearings', 1, 'WEEKS', 'ACTIVE']);
  await assert.rejects(pm({ machineId: 'nope', task: 'x' }), /not on this plant's list/);
  await assert.rejects(pm({ machineId: 'ut_prod_gallon_filler' }), /type what the PM is/);
  await assert.rejects(pm({ every: 0 }, { taskId: made.taskId }), /whole number from 1 to 999/);
  await assert.rejects(pm({ unit: 'HOURS' }, { taskId: made.taskId }), /days, weeks or months/);
  await assert.rejects(pm({ machineId: 'ut_prod_gallon_filler', task: 'x' }, null, DISPATCHER), /does not have a role that can make this save/);
  const sent = await act(MANAGER, 'sendPmToMaintenance', { taskId: made.taskId });
  assert.equal(sent.woNumber, 'M-1001');
  const wo = (await db().collection('plantWorkOrders').doc(sent.workOrderId).get()).data();
  assert.deepEqual([wo.source, wo.type, wo.machine, wo.problem, wo.pmTaskId, wo.pmDue, wo.lineDown], ['PM', 'PM', 'GALLON FILLER', 'PM: Grease filler bowl bearings', made.taskId, '2026-10-01', 'NO']);
  assert.equal((await act(MANAGER, 'sendPmToMaintenance', { taskId: made.taskId })).already, true);
  assert.equal(((await db().collection('plantPmTasks').doc(made.taskId).get()).data()).sentWoNumber, 'M-1001');
  await pm({}, { taskId: made.taskId, status: 'REMOVED' });
  await assert.rejects(act(MANAGER, 'sendPmToMaintenance', { taskId: made.taskId }), /no longer on the schedule/);
});
