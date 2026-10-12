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

// Joe 10/12 ("Let the new app write Route Master, Driver Master, Equipment Master, Users, Exceptions and Vacations to the real
// sheets"): a real master sheet is written only when its list is named in allowReal and the ID is that list's own real sheet.
test('allowReal lets a named list write its own real sheet, and nothing else', async () => {
  const REAL_DRIVERS = { drivers: { spreadsheetId: '1rDZpcOABjGtSqobkIQPPNWyWmanfjyHeidGmTK67PvU', tab: 'DRIVERS_MASTER' } };
  await applyAction(db(), MANAGER, { action: 'saveDriver', requestId: rid(), driverId: 'drv_test_casey', name: 'CASEY, LEE R', hireDate: '2025-12-01', seniorityDate: '2025-12-01', truck: '', relief: false });
  const out = await runMasterWriteBack({ db: db(), sheets, targets: REAL_DRIVERS, now: tick, only: true, allowReal: ['drivers'] });
  assert.equal(out.items, 1);
  assert.equal(cell('DRIVERS_MASTER', 'driver_id', 'drv_test_casey', 'name'), 'CASEY, LEE R');
  // Not named in allowReal, a list pointed at another list's real sheet, or the real Live sheet: still refused.
  await assert.rejects(runMasterWriteBack({ db: db(), sheets, targets: REAL_DRIVERS, now: tick, allowReal: ['routes'] }), /production sheet/);
  await assert.rejects(runMasterWriteBack({ db: db(), sheets, targets: { routes: REAL_DRIVERS.drivers }, now: tick, allowReal: ['routes', 'drivers'] }), /production sheet/);
  await assert.rejects(runMasterWriteBack({ db: db(), sheets, targets: { drivers: { spreadsheetId: '11beWtlO848OyZI_Bom9y2WCZn2vnw4mLm24pf-rO1Cg', tab: 'DRIVERS_MASTER' } }, now: tick, allowReal: ['drivers'] }), /production sheet/);
});

// Joe 10/12 ("Let the new app write Driver Check-in problems to the Live sheet's TRUCK LIVE, TRAILER LIVE, FORK TRUCK LIVE,
// WASH / CLEANING LIVE and REFUSALS / RETURNS LIVE tabs"): those lists may write the real Live workbook, and nothing else real.
test('allowReal lets the check-in problem lists write the real Live workbook only', async () => {
  const LIVE = '11beWtlO848OyZI_Bom9y2WCZn2vnw4mLm24pf-rO1Cg', ALL = ['maintTruck', 'maintTrailer', 'maintFork', 'maintWash', 'maintReturns'];
  const out = await runMasterWriteBack({ db: db(), sheets, targets: { maintTruck: { spreadsheetId: LIVE, tab: 'TRUCK LIVE' } }, now: tick, only: true, allowReal: ALL });
  assert.equal(out.items, 0);
  await assert.rejects(runMasterWriteBack({ db: db(), sheets, targets: { maintTruck: { spreadsheetId: LIVE, tab: 'TRUCK LIVE' } }, now: tick }), /production sheet/);
  await assert.rejects(runMasterWriteBack({ db: db(), sheets, targets: { maintTruck: { spreadsheetId: '1eqZxqZNQs5gwuaRmQgPRbNvSmy7gOnwwwyoqFS3Djb4', tab: 'TRUCK LIVE' } }, now: tick, allowReal: ALL }), /production sheet/);
  await assert.rejects(runMasterWriteBack({ db: db(), sheets, targets: { drivers: { spreadsheetId: LIVE, tab: 'DRIVERS_MASTER' } }, now: tick, allowReal: ALL.concat(['drivers']) }), /production sheet/);
});

test('saves queued before the real sheets were turned on are held, not written', async () => {
  await applyAction(db(), MANAGER, { action: 'saveDriver', requestId: rid(), driverId: 'drv_test_casey', name: 'CASEY, OLD', hireDate: '2025-12-01', seniorityDate: '2025-12-01', truck: '', relief: false }, tick);
  const since = tick().toISOString();
  await applyAction(db(), MANAGER, { action: 'saveDriver', requestId: rid(), driverId: 'drv_test_brook', name: 'BROOK, NEW', hireDate: '2025-12-01', seniorityDate: '2025-12-01', truck: '', relief: false }, tick);
  const out = await runMasterWriteBack({ db: db(), sheets, targets: TARGETS, now: tick, since });
  assert.equal(out.items, 1);
  assert.equal(cell('DRIVERS_MASTER', 'driver_id', 'drv_test_brook', 'name'), 'BROOK, NEW');
  assert.notEqual(cell('DRIVERS_MASTER', 'driver_id', 'drv_test_casey', 'name'), 'CASEY, OLD');
  const held = (await db().collection('masterOutbox').where('status', '==', 'held').get()).docs.map(d => d.data());
  assert.equal(held.length, 1);
  assert.equal(held[0].docId, 'drv_test_casey');
});

// Joe 10/12: on Weekly Dispatch a manager drags a route's line; the order goes to Route Master (route_week_display) and the
// runs of that week on take it at once.
test('Weekly Dispatch drag order: Route Master route_week_display and the runs of the week on', async () => {
  await applyAction(db(), MANAGER, { action: 'reorderWeek', requestId: rid(), weekStart: '2026-10-04', runIds: ['run_t802', 'run_t801'] }, tick);
  assert.deepEqual(await Promise.all(['run_t802', 'run_t801'].map(async id => (await db().collection('routes').doc(id).get()).data().weekOrder)), [10, 20]);
  const runs = (await db().collection('runs').where('weekStart', '>=', '2026-10-04').get()).docs.map(d => d.data()).filter(r => r.runId === 'run_t801' || r.runId === 'run_t802');
  assert.ok(runs.length >= 2);
  runs.forEach(r => assert.equal(r.weekOrder, r.runId === 'run_t802' ? 10 : 20, r.weekStart + ' ' + r.runId));
  await runMasterWriteBack({ db: db(), sheets, targets: TARGETS, now: tick });
  assert.equal(cell('ROUTES_MASTER', 'run_id', 'run_t802', 'route_week_display'), 10);
  assert.equal(cell('ROUTES_MASTER', 'run_id', 'run_t801', 'route_week_display'), 20);
  // A dispatcher cannot change the order, and a run named twice is refused.
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'reorderWeek', requestId: rid(), weekStart: '2026-10-04', runIds: ['run_t801', 'run_t802'] }, tick));
  await assert.rejects(applyAction(db(), MANAGER, { action: 'reorderWeek', requestId: rid(), weekStart: '2026-10-04', runIds: ['run_t801', 'run_t801'] }, tick), /twice/);
});

test('with the write-back off, master saves queue nothing', async () => {
  await db().collection('config').doc('app').set({ writeBack: { enabled: false } }, { merge: true });
  await applyAction(db(), MANAGER, { action: 'saveDriver', requestId: rid(), driverId: 'drv_test_casey', name: 'CASEY, LEE B', hireDate: '2025-12-01', seniorityDate: '2025-12-01', truck: '', relief: false });
  assert.equal((await db().collection('masterOutbox').get()).size, 0);
});
