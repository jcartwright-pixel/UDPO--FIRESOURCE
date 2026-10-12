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

// Joe 10/12: a breakdown is recorded with when it was back up and what fixed it; a Maintenance Request says how long it can wait.
test('Shift Notes: a Breakdown keeps Back up at and What fixed it; a Maintenance Request keeps Can it wait', async () => {
  const brk = await act(PLANT, 'saveShiftNote', { values: { Entry: 'Valve 14 blew a seal', Type: 'Breakdown', Equipment: 'GALLON FILLER', UpAt: '10:20', Fix: 'Replaced the seal' }, readingTime: '09:42', followUpStatus: 'RESOLVED' });
  const req = await act(PLANT, 'saveShiftNote', { values: { Entry: 'Water leak under the pasteurizer', Type: 'Maintenance Request', Equipment: 'GALLON FILLER', Urgency: 'This week' }, followUpStatus: 'OPEN' });
  const get = async (r) => (await db().collection('plantJournal').doc(r.checkId).get()).data().payload.values;
  assert.deepEqual(await get(brk), { Entry: 'Valve 14 blew a seal', Type: 'Breakdown', Equipment: 'GALLON FILLER', UpAt: '10:20', Fix: 'Replaced the seal' });
  assert.equal((await get(req)).Urgency, 'This week');
  // Still down, then back up in a review under it.
  const still = await act(PLANT, 'saveShiftNote', { values: { Entry: 'Capper jammed', Type: 'Breakdown', Equipment: 'GALLON FILLER' }, readingTime: '11:00', followUpStatus: 'OPEN' });
  await act(PLANT, 'saveShiftNote', { values: { Entry: 'Back up', Type: 'REVIEW', ParentId: still.entryId, UpAt: '11:25', Fix: 'Cleared the jam' }, followUpStatus: 'RESOLVED' });
  const R = require('../../src/plant-rules');
  const log = R.shiftLog((await db().collection('plantJournal').where('type', '==', R.SHIFT_TYPE).get()).docs.map(d => d.data()), Date.parse('2026-10-08T16:00:00Z'), 24 * 3650);
  const row = log.find(r => r.entryId === still.entryId);
  assert.deepEqual([row.upAt, row.fix], ['11:25', 'Cleared the jam']);
  await assert.rejects(act(PLANT, 'saveShiftNote', { values: { Entry: 'x', Type: 'Breakdown', UpAt: 'soon' }, followUpStatus: 'OPEN' }), /Back up at must be a time/);
  await assert.rejects(act(PLANT, 'saveShiftNote', { values: { Entry: 'x', Type: 'Maintenance Request', Urgency: 'Never' }, followUpStatus: 'OPEN' }), /Can it wait must be/);
});

// Mock-up E: the Maintenance Station works the plant's work orders like the Garage Station (same technicians and login IDs).
test('Maintenance Station: start, a helper, need parts, complete a PM (Last done moves on); report a problem; record a breakdown', async () => {
  const GA = require('../../src/garage');
  const at = (min) => () => new Date(Date.parse('2026-10-08T14:00:00Z') + (min || 0) * 60000);
  for (const [id, name, pin] of [['TECH-JT', 'JELLICK Tom', '48213'], ['TECH-JN', 'NARD Jaxon', '551902']]) {
    await db().collection('garageTechs').doc(id).set({ tech_id: id, name, active: 'YES', facility_id: 'fac_uniontown' });
    await db().collection('garageLogins').doc(id).set({ hash: GA.loginHash(id, pin) });
  }
  const LOGIN = { TOM: ['TECH-JT', '48213'], JAX: ['TECH-JN', '551902'] };
  const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const call = (fields, min) => GA.garageCall(db(), Object.assign({ facilityId: 'fac_uniontown' }, fields), at(min));
  const as = async (who, fields, min) => { const s = await call({ op: 'signIn', techId: LOGIN[who][0], loginId: LOGIN[who][1], tokens: [] }, min); return call(Object.assign({ op: 'pmStep', tokens: [s.token], requestId: rid() }, fields), min); };

  const made = await act(MANAGER, 'savePmTask', { facilityId: 'fac_uniontown', fields: { machineId: 'ut_prod_gallon_filler', task: 'Grease bearings', every: 1, unit: 'MONTHS', lastDone: '2026-09-01' } });
  const sent = await act(MANAGER, 'sendPmToMaintenance', { taskId: made.taskId });
  let b = await call({ op: 'pmBoard' });
  assert.deepEqual(b.jobs.map(j => [j.woNumber, j.unit, j.from, j.pm]), [['M-1001', 'GALLON FILLER', 'PM', true]]);
  assert.ok(b.machines.some(m => m.name === 'GALLON FILLER'));
  assert.deepEqual(b.techs.map(t => [t.name, t.on]), [['JELLICK Tom', null], ['NARD Jaxon', null]]);
  await assert.rejects(call({ op: 'pmStep', tokens: [], step: 'START', id: sent.workOrderId, requestId: rid() }), /GARAGE_SIGN_IN_REQUIRED/);

  await as('TOM', { step: 'START', id: sent.workOrderId }, 0);
  let r = await as('JAX', { step: 'HELPER', id: sent.workOrderId }, 10);
  assert.deepEqual(r.job.onNow.map(p => p.name), ['JELLICK Tom', 'NARD Jaxon']);
  b = await call({ op: 'pmBoard' }, 11);
  assert.deepEqual(b.techs.filter(t => t.on).map(t => t.on.unit), ['M-1001 GALLON FILLER', 'M-1001 GALLON FILLER']);
  r = await as('TOM', { step: 'PARTS', id: sent.workOrderId }, 30);
  assert.deepEqual([r.job.status, r.job.onNow, r.job.laborMinutes], ['PARTS', [], 50]);
  await as('TOM', { step: 'RESUME', id: sent.workOrderId }, 60);
  await assert.rejects(as('TOM', { step: 'DONE', id: sent.workOrderId, fixed: 'Fixed it', safe: true, signature: SIG }, 70), /Tap what you fixed/);
  r = await as('TOM', { step: 'DONE', id: sent.workOrderId, fixed: 'PM done', note: 'All 6 bearings', safe: true, signature: SIG }, 90);
  assert.equal(r.job.status, 'DONE');
  assert.deepEqual([r.pm.lastDone, r.pm.nextDue], ['2026-10-08', '2026-11-08']);
  const wo = (await db().collection('plantWorkOrders').doc(sent.workOrderId).get()).data();
  assert.deepEqual([wo.status, wo.completedBy, wo.fixedNote, wo.onNow, wo.laborMinutes], ['DONE', 'JELLICK Tom', 'PM done: All 6 bearings', '', 80]);
  const task = (await db().collection('plantPmTasks').doc(made.taskId).get()).data();
  assert.deepEqual([task.lastDone, task.nextDue, task.sentWorkOrderId], ['2026-10-08', '2026-11-08', '']);
  assert.deepEqual((await call({ op: 'pmBoard' }, 91)).jobs, [], 'a finished work order leaves the tablet');

  // + Report a Problem: the next number, from maintenance.
  r = await as('JAX', { step: 'REPORT', machineId: 'ut_prod_gallon_filler', problem: 'Guard rail loose', lineDown: false }, 100);
  assert.match(r.message, /^M-1002 GALLON FILLER/);
  await assert.rejects(as('JAX', { step: 'REPORT', machineId: 'ut_prod_gallon_filler', problem: '', lineDown: false }, 101), /Type what's wrong/);
  // Not safe to run: stays open and the line is down.
  r = await as('JAX', { step: 'DONE', id: r.job.id, fixed: 'Adjusted', safe: false, signature: SIG }, 110);
  assert.deepEqual([r.job.status, r.job.canRun], ['WORKING', false]);

  // Record a Breakdown: on the shift log as a Breakdown on that machine, back up and fixed.
  r = await as('TOM', { step: 'BREAKDOWN', machineId: 'ut_prod_gallon_filler', downAt: '09:42', upAt: '10:20', cause: 'Valve 14 blew a seal', fix: 'Replaced the seal' }, 120);
  const entry = (await db().collection('plantJournal').where('recordId', '==', r.entryId).get()).docs[0].data();
  assert.deepEqual([entry.type, entry.status, entry.payload.readingTime, entry.payload.values], ['SHIFT_REPORT', 'RESOLVED', '09:42',
    { Entry: 'Valve 14 blew a seal', Type: 'Breakdown', Equipment: 'GALLON FILLER', UpAt: '10:20', Fix: 'Replaced the seal' }]);
  await assert.rejects(as('TOM', { step: 'BREAKDOWN', machineId: 'ut_prod_gallon_filler', downAt: '', cause: 'x' }, 121), /when it went down/);
});
