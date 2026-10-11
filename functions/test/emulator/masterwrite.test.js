'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const { runMasterWriteBack } = require('../../src/masterwrite');
const F = require('../fixtures/fake-sheets');

const MANAGER = { email: 'manager.test@uniteddairy.com' };
const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
const TARGETS = {
  drivers: { spreadsheetId: 'fake-drivers', tab: 'DRIVERS_MASTER' }, routes: { spreadsheetId: 'fake-routes', tab: 'ROUTES_MASTER' },
  equipment: { spreadsheetId: 'fake-equipment', tab: 'EQUIPMENT_MASTER' }, exceptions: { spreadsheetId: 'fake-exceptions', tab: 'DRIVER_EXCEPTIONS' },
  vacations: { spreadsheetId: 'fake-vacations', tab: 'DRIVER_VACATIONS' }
};
let n = 0;
const rid = () => 'mw-request-' + (++n) + '-' + Date.now();
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

function cell(tab, idColumn, id, column) {
  const v = tabs["'" + tab + "'"], h = v[0];
  const rows = v.filter((r, i) => i > 0 && r[h.indexOf(idColumn)] === id);
  assert.equal(rows.length, 1, 'one row for ' + id + ' in ' + tab);
  return rows[0][h.indexOf(column)];
}

test('master saves reach the sandbox copies by their ID column; new entries become new rows', async () => {
  // Sort Driver Master after the copy: the row is still found by driver_id.
  tabs["'DRIVERS_MASTER'"] = [tabs["'DRIVERS_MASTER'"][0]].concat(tabs["'DRIVERS_MASTER'"].slice(1).reverse());
  sheets = F.fakeWritableSheets(tabs);
  await applyAction(db(), MANAGER, { action: 'saveDriver', requestId: rid(), driverId: 'drv_test_casey', name: 'CASEY, LEE A', hireDate: '2025-12-01', seniorityDate: '2025-12-01', truck: '', relief: true });
  const added = await applyAction(db(), MANAGER, { action: 'saveDriver', requestId: rid(), name: 'EVANS, KIM', hireDate: '2026-10-01', seniorityDate: '2026-10-01', truck: '900002', relief: false });
  await applyAction(db(), DISPATCHER, { action: 'setUnitDown', requestId: rid(), equipmentId: 'veh_truck_900002', reason: 'brakes', today: '2026-10-09' });
  await applyAction(db(), MANAGER, { action: 'saveRoute', requestId: rid(), runId: 'run_t801', fields: { loadType: 'Tote' }, days: { wed: { active: true, dispatchTime: '5 AM', miles: '150' } } });
  await applyAction(db(), MANAGER, { action: 'reorderRouteDay', requestId: rid(), day: 'mon', runIds: ['run_t801', 'run_t802'] });
  const off = await applyAction(db(), DISPATCHER, { action: 'saveDriverException', requestId: rid(), driverId: 'drv_test_casey', status: 'UNAVAILABLE', reason: 'SICK DAY', startDate: '2026-10-20', endDate: '2026-10-20' });
  const vac = await applyAction(db(), MANAGER, { action: 'saveVacation', requestId: rid(), driverId: 'drv_test_brook', startDate: '2026-11-02', endDate: '2026-11-03', type: 'VACATION', status: 'APPROVED' });

  const out = await runMasterWriteBack({ db: db(), sheets, targets: TARGETS, now: tick });
  assert.equal(out.conflicts, 0);
  assert.equal(out.added, 4, 'the new driver, day off, vacation and its Dispatch day off');
  assert.equal(cell('DRIVERS_MASTER', 'driver_id', 'drv_test_casey', 'name'), 'CASEY, LEE A');
  assert.equal(cell('DRIVERS_MASTER', 'driver_id', 'drv_test_casey', 'relief_driver'), 'TRUE');
  assert.equal(cell('DRIVERS_MASTER', 'driver_id', added.driverId, 'name'), 'EVANS, KIM');
  assert.equal(cell('DRIVERS_MASTER', 'driver_id', added.driverId, 'default_tractor_id'), 'veh_truck_900002');
  assert.equal(cell('EQUIPMENT_MASTER', 'equipment_id', 'veh_truck_900002', 'status'), 'DOWN');
  assert.equal(cell('EQUIPMENT_MASTER', 'equipment_id', 'veh_truck_900002', 'notes'), 'DOWN: brakes');
  assert.equal(cell('EQUIPMENT_MASTER', 'equipment_id', 'veh_truck_900002', 'updated_by'), 'dispatch.test@uniteddairy.com');
  assert.equal(cell('ROUTES_MASTER', 'run_id', 'run_t801', 'load_type'), 'Tote');
  assert.deepEqual(['wed_active', 'wed_dispatch_time', 'wed_miles', 'mon_load_order'].map(c => cell('ROUTES_MASTER', 'run_id', 'run_t801', c)), ['TRUE', '5:00 AM', 150, 10]);
  assert.equal(cell('ROUTES_MASTER', 'run_id', 'run_t802', 'mon_load_order'), 20);
  assert.equal(cell('DRIVER_EXCEPTIONS', 'exception_id', off.exceptionId, 'reason_code'), 'SICK DAY');
  assert.equal(cell('DRIVER_VACATIONS', 'id', vac.vacationId, 'status'), 'APPROVED');
  assert.equal(cell('DRIVER_EXCEPTIONS', 'exception_id', 'vsched_' + vac.vacationId, 'exception_type'), 'VACATION');
  assert.equal((await db().collection('masterOutbox').where('status', 'in', ['pending', 'writing']).get()).size, 0);
  // Again: nothing to write; and the next copy reads the rows back without losing anything.
  assert.equal((await runMasterWriteBack({ db: db(), sheets, targets: TARGETS, now: tick })).items, 0);
  await runTransfer({ db: db(), reader: sheets, sources: F.SOURCES, now: tick });
  assert.equal((await db().collection('drivers').doc(added.driverId).get()).data().name, 'EVANS, KIM');
  assert.equal((await db().collection('routes').doc('run_t801').get()).data().days.wed.miles, 150);
});

test('a cell changed in the sheet meanwhile is kept and listed as a conflict; a waiting save is not undone by the copy', async () => {
  await applyAction(db(), DISPATCHER, { action: 'setUnitDown', requestId: rid(), equipmentId: 'veh_trailer_t_902', reason: 'flat tire', today: '2026-10-09' });
  // Before the write-back runs, the copy runs: the app keeps its waiting save.
  await runTransfer({ db: db(), reader: sheets, sources: F.SOURCES, now: tick });
  assert.equal((await db().collection('equipment').doc('veh_trailer_t_902').get()).data().status, 'DOWN');
  // Someone types in the sheet.
  const v = tabs["'EQUIPMENT_MASTER'"], h = v[0];
  v.find(r => r[h.indexOf('equipment_id')] === 'veh_trailer_t_902')[h.indexOf('status')] = 'SHOP';
  const out = await runMasterWriteBack({ db: db(), sheets, targets: TARGETS, now: tick });
  assert.equal(out.conflicts, 1);
  assert.equal(cell('EQUIPMENT_MASTER', 'equipment_id', 'veh_trailer_t_902', 'status'), 'SHOP');
  assert.equal(cell('EQUIPMENT_MASTER', 'equipment_id', 'veh_trailer_t_902', 'notes'), 'DOWN: flat tire');
  const c = (await db().collection('conflicts').where('column', '==', 'status').get()).docs[0].data();
  assert.deepEqual([c.sheetValue, c.newValue, c.list], ['SHOP', 'DOWN', 'equipment']);
});

test('production master sheets are refused', async () => {
  await assert.rejects(runMasterWriteBack({ db: db(), sheets, targets: { drivers: { spreadsheetId: '1rDZpcOABjGtSqobkIQPPNWyWmanfjyHeidGmTK67PvU', tab: 'DRIVERS_MASTER' } }, now: tick }), /production sheet/);
});

test('with the write-back off, master saves queue nothing', async () => {
  await db().collection('config').doc('app').set({ writeBack: { enabled: false } }, { merge: true });
  await applyAction(db(), MANAGER, { action: 'saveDriver', requestId: rid(), driverId: 'drv_test_casey', name: 'CASEY, LEE B', hireDate: '2025-12-01', seniorityDate: '2025-12-01', truck: '', relief: false });
  assert.equal((await db().collection('masterOutbox').get()).size, 0);
});
