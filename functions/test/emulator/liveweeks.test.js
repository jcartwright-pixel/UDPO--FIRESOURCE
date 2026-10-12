'use strict';
// D6: Route Editor and Driver Roster saves reach the Current and Next Live weeks, as the current app's 7.0.267 does
// (udpoV7267RouteMasterToLive_ / udpoV7267DriverMasterToLive_); a day picked by hand on Daily / Weekly keeps its pick.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const { runWriteBack } = require('../../src/writeback');
const F = require('../fixtures/fake-sheets');

const MANAGER = { email: 'manager.test@uniteddairy.com' };
const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
let n = 0;
const rid = () => 'live-weeks-' + (++n) + '-' + Date.now();
// Friday 10/9, 8 AM in New York: the Current week is 10/4, the Next week 10/11; Thursday 10/8 is already loaded.
const NOW = () => new Date('2026-10-09T12:00:00Z');
const save = (user, input) => applyAction(db(), user, Object.assign({ requestId: rid() }, input), NOW);
const run = async (id) => (await db().collection('runs').doc(id).get()).data();
let tabs, sheets;

test.beforeEach(async () => {
  await clear();
  tabs = F.fakeSheets();
  sheets = F.fakeWritableSheets(tabs);
  await runTransfer({ db: db(), reader: sheets, sources: F.SOURCES, now: NOW });
});

test('a Route Editor save reaches the Next week: runs, times, hours and default units; loaded days and hand picks stay', async () => {
  // Dispatchers changed Monday 10/12 by hand: truck 900002 and a 6 AM start; and turned Tuesday 10/13 off.
  await save(DISPATCHER, { action: 'assignTruck', runDocId: '2026-10-11__run_t801', day: 'mon', equipmentId: 'veh_truck_900002' });
  await save(DISPATCHER, { action: 'setDispatchTime', runDocId: '2026-10-11__run_t801', day: 'mon', time: '6:00 AM' });
  await save(DISPATCHER, { action: 'setRuns', runDocId: '2026-10-11__run_t801', day: 'tue', runs: false });
  const out = await save(MANAGER, { action: 'saveRoute', runId: 'run_t801', fields: {}, days: {
    mon: { dispatchTime: '3 AM', tractor: '900001' }, tue: { dispatchTime: '3:30 AM' },
    wed: { active: true, dispatchTime: '5 AM', hours: '8:30', tractor: '900002', trailer: '902' } } });
  assert.ok(out.liveWeeks.updated >= 1);
  const next = await run('2026-10-11__run_t801');
  assert.deepEqual([next.days.wed.runs, next.days.wed.dispatchTime, next.days.wed.startTime, next.days.wed.routeHours, next.days.wed.truckId, next.days.wed.truck, next.days.wed.trailerId, next.days.wed.trailer],
    [true, 300, 300, 8.5, 'veh_truck_900002', '900002', 'veh_trailer_t_902', 'T-902']);
  assert.equal(next.days.mon.truckId, 'veh_truck_900002', 'the truck picked by hand stays');
  assert.equal(next.days.mon.dispatchTime, 360, 'the start time typed by hand stays');
  assert.equal(next.days.tue.runs, false, 'a day turned off by hand stays off');
  assert.equal(next.days.tue.dispatchTime, 210, 'a day not changed by hand takes the new time');
  // The Current week: Wednesday 10/7 is already loaded, so it does not start running.
  assert.equal((await run('2026-10-04__run_t801')).days.wed.runs, false);
  assert.equal((await run('2026-09-27__run_t801')).days.wed.runs, false, 'the Previous week is never touched');
});

test('a run turned off in Route Master stays on for a day that has a driver (Joe 10/10)', async () => {
  await save(MANAGER, { action: 'saveRoute', runId: 'run_t801', fields: {}, days: { mon: { active: false } } });
  assert.equal((await run('2026-10-11__run_t801')).days.mon.runs, true, 'ADAMS still drives Monday');
  await save(MANAGER, { action: 'saveRoute', runId: 'run_t802', fields: {}, days: { tue: { active: false } } });
  assert.equal((await run('2026-10-11__run_t802')).days.tue.runs, false, '802 Tuesday has no driver, so it stops running');
});

test('a new run gets a Live row in both weeks, and the write-back adds it to the sandbox Live tab', async () => {
  await db().collection('config').doc('app').set({ writeBack: { enabled: true } }, { merge: true });
  const out = await save(MANAGER, { action: 'saveRoute', fields: { route: '805', routeName: 'NEW STOP', run: 'MARIETTA', coverageOwner: 'Marietta' }, days: { thu: { active: true, dispatchTime: '7 AM' }, sat: { active: true } } });
  assert.equal(out.liveWeeks.added, 2);
  const cur = await run('2026-10-04__' + out.runId), next = await run('2026-10-11__' + out.runId);
  assert.equal(cur.route, '805');
  assert.equal(cur.days.thu.runs, false, 'Thursday 10/8 is already loaded');
  assert.equal(cur.days.sat.runs, true, 'Saturday 10/10 is still to come');
  assert.deepEqual([next.days.thu.runs, next.days.thu.dispatchTime, next.days.mon.runs], [true, 420, false]);
  await runWriteBack({ db: db(), sheets, target: { spreadsheetId: 'fake-live' }, now: NOW });
  const v = tabs["'LIVE NEXT WEEK'"], h = v[5], row = v.find((r, i) => i > 5 && r[h.indexOf('run_id')] === out.runId);
  assert.ok(row, 'the new run is a new row of LIVE NEXT WEEK');
  assert.deepEqual(['route', 'run', 'week_start_date', 'thu_runs', 'thu_dispatch_time', 'mon_runs'].map(c => row[h.indexOf(c)]), ['805', 'MARIETTA', '2026-10-11', 'TRUE', '7:00 AM', 'FALSE']);
  // The next copy reads the row back and keeps the run.
  await runTransfer({ db: db(), reader: sheets, sources: F.SOURCES, now: NOW });
  assert.equal((await run('2026-10-11__' + out.runId)).days.thu.runs, true);
});

test("a driver's assigned truck follows him onto the days he drives; a hand-picked or busy truck stays", async () => {
  const out = await save(MANAGER, { action: 'setDriverTruck', driverId: 'drv_test_casey', equipmentId: 'veh_truck_900002' });
  assert.equal((await run('2026-10-11__run_t802')).days.mon.truckId, 'veh_truck_900002', 'CASEY drives 802 Monday 10/12');
  assert.equal((await run('2026-10-11__run_t802')).days.mon.truck, '900002');
  assert.equal((await run('2026-10-04__run_t802')).days.mon.truckId, '', 'Monday 10/5 is already loaded');
  assert.equal(out.liveWeeks.warnings.length, 0);
  // 900001 is ADAMS's truck on 801 that Monday: kept there, with a warning.
  const busy = await save(MANAGER, { action: 'setDriverTruck', driverId: 'drv_test_casey', equipmentId: 'veh_truck_900001' });
  assert.equal((await run('2026-10-11__run_t802')).days.mon.truckId, 'veh_truck_900002');
  assert.match(busy.liveWeeks.warnings.join(' '), /900001 is already on route 801/);
});

test('a truck picked by hand on Daily is not replaced by the driver roster', async () => {
  await save(DISPATCHER, { action: 'assignTruck', runDocId: '2026-10-11__run_t802', day: 'mon', equipmentId: '' });
  await save(MANAGER, { action: 'setDriverTruck', driverId: 'drv_test_casey', equipmentId: 'veh_truck_900002' });
  assert.equal((await run('2026-10-11__run_t802')).days.mon.truckId, '');
});

test('Driver Roster Save Driver: the new name and truck reach the Live weeks, and the write-back writes them', async () => {
  await db().collection('config').doc('app').set({ writeBack: { enabled: true } }, { merge: true });
  await save(MANAGER, { action: 'saveDriver', driverId: 'drv_test_casey', name: 'Casey, Leigh', hireDate: '2025-12-01', seniorityDate: '2025-12-01', truck: '900002', relief: false });
  const next = await run('2026-10-11__run_t802');
  assert.deepEqual([next.days.mon.driver, next.days.mon.truckId], ['CASEY, LEIGH', 'veh_truck_900002']);
  assert.equal((await run('2026-10-04__run_t802')).days.mon.driver, 'CASEY, LEE', 'a loaded day keeps the name it went out with');
  await runWriteBack({ db: db(), sheets, target: { spreadsheetId: 'fake-live' }, now: NOW });
  const v = tabs["'LIVE NEXT WEEK'"], h = v[5], row = v.find((r, i) => i > 5 && r[h.indexOf('run_id')] === 'run_t802');
  assert.deepEqual(['mon_driver', 'mon_tractor_id', 'mon_truck'].map(c => row[h.indexOf(c)]), ['CASEY, LEIGH', 'veh_truck_900002', '900002']);
  assert.equal((await db().collection('conflicts').get()).size, 0);
});

test('a truck picked by hand marks equipment_override in the Live sheet, as the current app does', async () => {
  await db().collection('config').doc('app').set({ writeBack: { enabled: true } }, { merge: true });
  await save(DISPATCHER, { action: 'assignTruck', runDocId: '2026-10-11__run_t802', day: 'mon', equipmentId: 'veh_truck_900002' });
  await runWriteBack({ db: db(), sheets, target: { spreadsheetId: 'fake-live' }, now: NOW });
  const v = tabs["'LIVE NEXT WEEK'"], h = v[5], row = v.find((r, i) => i > 5 && r[h.indexOf('run_id')] === 'run_t802');
  assert.deepEqual(['mon_tractor_id', 'mon_equipment_override'].map(c => row[h.indexOf(c)]), ['veh_truck_900002', 'TRUE']);
});

test('Show on Daily Dispatch switched in the Route Editor reaches the Current and Next weeks, and the write-back writes it (Joe 10/12, 907 / 950)', async () => {
  await db().collection('config').doc('app').set({ writeBack: { enabled: true } }, { merge: true });
  // The Live rows were copied while the run was off Daily (as 907_1 and 950_1 were on 10/12).
  for (const id of ['2026-09-27__run_t801', '2026-10-04__run_t801', '2026-10-11__run_t801']) await db().collection('runs').doc(id).update({ displayDaily: false });
  await save(MANAGER, { action: 'saveRoute', runId: 'run_t801', fields: { displayDaily: true }, days: {} });
  assert.equal((await run('2026-10-04__run_t801')).displayDaily, true, 'the Current week shows it on Daily');
  assert.equal((await run('2026-10-11__run_t801')).displayDaily, true, 'the Next week shows it on Daily');
  assert.equal((await run('2026-09-27__run_t801')).displayDaily, false, 'the Previous week is never touched');
  await runWriteBack({ db: db(), sheets, target: { spreadsheetId: 'fake-live' }, now: NOW });
  for (const tab of ["'LIVE CURRENT WEEK'", "'LIVE NEXT WEEK'"]) {
    const v = tabs[tab], h = v[5], row = v.find((r, i) => i > 5 && r[h.indexOf('run_id')] === 'run_t801');
    assert.equal(row[h.indexOf('display_daily_dispatch')], 'TRUE', tab + ' says TRUE');
  }
  // Switched off again: both weeks follow. A save that does not touch the switch leaves the weeks' flags alone.
  await save(MANAGER, { action: 'saveRoute', runId: 'run_t801', fields: { displayDaily: false }, days: {} });
  assert.equal((await run('2026-10-11__run_t801')).displayDaily, false);
  await db().collection('runs').doc('2026-10-11__run_t801').update({ displayDaily: true });
  await save(MANAGER, { action: 'saveRoute', runId: 'run_t801', fields: { routeNotes: 'note' }, days: {} });
  assert.equal((await run('2026-10-11__run_t801')).displayDaily, true);
});

test('Show on the driver Route app switched in the Route Editor reaches the Current and Next weeks, and the write-back writes it (Joe 10/12, View Loadout)', async () => {
  await db().collection('config').doc('app').set({ writeBack: { enabled: true } }, { merge: true });
  const L = require('../../src/logic');
  // The Live rows say TRUE (as every LIVE CURRENT WEEK row did on 10/12), so the phone, the Driver Room board and check-in show the run.
  for (const id of ['2026-09-27__run_t801', '2026-10-04__run_t801', '2026-10-11__run_t801']) await db().collection('runs').doc(id).update({ displayMobileRoute: true });
  await save(MANAGER, { action: 'saveRoute', runId: 'run_t801', fields: { displayMobile: false }, days: {} });
  for (const id of ['2026-10-04__run_t801', '2026-10-11__run_t801']) {
    const r = await run(id);
    assert.equal(r.displayMobileRoute, false, id + ' is off the driver Route app');
    assert.equal(L.liveFlagShown(r, 'displayMobileRoute', 'mobile'), false, id + ' leaves View Loadout and the Driver Room board');
  }
  assert.equal((await run('2026-09-27__run_t801')).displayMobileRoute, true, 'the Previous week is never touched');
  await runWriteBack({ db: db(), sheets, target: { spreadsheetId: 'fake-live' }, now: NOW });
  for (const tab of ["'LIVE CURRENT WEEK'", "'LIVE NEXT WEEK'"]) {
    const v = tabs[tab], h = v[5], row = v.find((r, i) => i > 5 && r[h.indexOf('run_id')] === 'run_t801');
    assert.equal(row[h.indexOf('display_mobile_route')], 'FALSE', tab + ' says FALSE');
  }
  // Switched back on: both weeks follow. A save that does not touch the switch leaves the weeks' flags alone.
  await save(MANAGER, { action: 'saveRoute', runId: 'run_t801', fields: { displayMobile: true }, days: {} });
  assert.equal((await run('2026-10-11__run_t801')).displayMobileRoute, true);
  await db().collection('runs').doc('2026-10-11__run_t801').update({ displayMobileRoute: false });
  await save(MANAGER, { action: 'saveRoute', runId: 'run_t801', fields: { routeNotes: 'note' }, days: {} });
  assert.equal((await run('2026-10-11__run_t801')).displayMobileRoute, false);
});

test('Route names (Joe 10/12): Route Name and Run reach the Current and Next weeks; with routeNamesLive on, stream_id, route and route_run_type too, and the Previous week', async () => {
  await db().collection('config').doc('app').set({ writeBack: { enabled: true } }, { merge: true });
  await save(MANAGER, { action: 'saveRoute', runId: 'run_t801', fields: { routeName: 'DSD', run: 'Milk', routeRunType: 'Load 1', streamId: 'DSD 801' }, days: {} });
  for (const id of ['2026-10-04__run_t801', '2026-10-11__run_t801']) {
    const r = await run(id);
    assert.deepEqual([r.routeName, r.run], ['DSD', 'Milk'], id + ' takes the names');
    assert.notEqual(r.routeRunType, 'Load 1', 'Run Type waits for the switch');
    assert.notEqual(r.streamId, 'DSD 801', 'Stream ID waits for the switch');
  }
  assert.notEqual((await run('2026-09-27__run_t801')).run, 'Milk', 'the Previous week waits for the switch');
  // Joe's OK given: the switch is on. A blank Run typed in the Route Editor goes across blank.
  await db().collection('config').doc('app').set({ routeNamesLive: { enabled: true } }, { merge: true });
  await save(MANAGER, { action: 'saveRoute', runId: 'run_t801', fields: { run: '', routeRunType: 'Load 2' }, days: {} });
  for (const id of ['2026-09-27__run_t801', '2026-10-04__run_t801', '2026-10-11__run_t801']) {
    const r = await run(id);
    assert.deepEqual([r.routeName, r.run, r.routeRunType, r.streamId], ['DSD', '', 'Load 2', 'DSD 801'], id + ' has every name');
  }
  await runWriteBack({ db: db(), sheets, target: { spreadsheetId: 'fake-live' }, now: NOW });
  for (const tab of ["'LIVE PREVIOUS WEEK'", "'LIVE CURRENT WEEK'", "'LIVE NEXT WEEK'"]) {
    const v = tabs[tab], h = v[5], row = v.find((r, i) => i > 5 && r[h.indexOf('run_id')] === 'run_t801');
    assert.deepEqual(['stream_id', 'route_name', 'run', 'route_run_type'].map(c => row[h.indexOf(c)]), ['DSD 801', 'DSD', '', 'Load 2'], tab);
  }
  // The Previous week gets names only: its days are never changed.
  await save(MANAGER, { action: 'saveRoute', runId: 'run_t801', fields: {}, days: { wed: { active: true } } });
  assert.equal((await run('2026-09-27__run_t801')).days.wed.runs, false, 'the Previous week days are never touched');
});
