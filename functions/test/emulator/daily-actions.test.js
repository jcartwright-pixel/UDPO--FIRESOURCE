'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const { runWriteBack } = require('../../src/writeback');
const L = require('../../src/logic');
const F = require('../fixtures/fake-sheets');

const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
const RUN = '2026-10-04__run_t802';
let n = 0;
const rid = () => 'daily-request-' + (++n) + '-' + Date.now();
let clock = 0;
const tick = () => new Date(Date.parse('2026-10-09T12:00:00Z') + (++clock) * 60000);
let tabs;
test.beforeEach(async () => {
  await clear();
  tabs = F.fakeSheets();
  await runTransfer({ db: db(), reader: F.fakeReader(tabs), sources: F.SOURCES, now: tick });
});
const run = async (id) => (await db().collection('runs').doc(id || RUN).get()).data();
const runs = async () => (await db().collection('runs').get()).docs.map(d => Object.assign({ id: d.id }, d.data()));
// The made-up Tuesday 801 loads are marked loaded (COMPLETE); Truck Down leaves a loaded load alone (review item 71), so the
// Down Trucks checks below start from loads not loaded yet.
const notLoaded = async () => { for (const w of ['2026-10-04', '2026-10-11']) await db().collection('runs').doc(w + '__run_t801').update({ 'days.tue.loadStatus': '', 'days.tue.loadedComplete': false, 'days.tue.completeTime': '' }); };

test('RUNS / NO RUN, depart time and jack save as one call each and write the same Live columns', async () => {
  await db().collection('config').doc('app').set({ writeBack: { enabled: true } }, { merge: true });
  await applyAction(db(), DISPATCHER, { action: 'setDispatchTime', requestId: rid(), runDocId: RUN, day: 'tue', time: '4:45 AM' });
  await applyAction(db(), DISPATCHER, { action: 'setJack', requestId: rid(), runDocId: RUN, day: 'tue', jack: 'j-12' });
  await applyAction(db(), DISPATCHER, { action: 'setRuns', requestId: rid(), runDocId: RUN, day: 'tue', runs: false });
  const r = await run();
  assert.equal(r.days.tue.dispatchTime, 285);
  assert.equal(r.days.tue.palletJack, 'J-12');
  assert.equal(r.days.tue.runs, false);
  assert.ok(L.notRunningRows(await runs(), '2026-10-05').some(x => x.route === '802'), '802 is offered under + Add Route / Run');
  await runWriteBack({ db: db(), sheets: F.fakeWritableSheets(tabs), target: { spreadsheetId: 'fake-live' }, now: tick });
  const v = tabs["'LIVE CURRENT WEEK'"], h = v[5], row = v.find((x, i) => i > 5 && x[h.indexOf('run_id')] === 'run_t802');
  assert.equal(row[h.indexOf('tue_dispatch_time')], '4:45 AM');
  assert.equal(row[h.indexOf('tue_pallet_jack')], 'J-12');
  assert.equal(row[h.indexOf('tue_runs')], 'FALSE');
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'setDispatchTime', requestId: rid(), runDocId: RUN, day: 'mon', time: 'later' }), /Depart time/);
  // + Add Route / Run (or RUNS again) turns the day back on; other saves still need a day that runs.
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'setJack', requestId: rid(), runDocId: RUN, day: 'tue', jack: 'J-1' }), /does not run/);
  await applyAction(db(), DISPATCHER, { action: 'setRuns', requestId: rid(), runDocId: RUN, day: 'tue', runs: true });
  assert.equal((await run()).days.tue.runs, true);
});

test('MOVE TO ANOTHER DAY turns the new day on and clears the old one', async () => {
  await applyAction(db(), DISPATCHER, { action: 'moveRun', requestId: rid(), runDocId: '2026-10-04__run_t801', day: 'mon', toDate: '2026-10-08' });
  const r = await run('2026-10-04__run_t801');
  assert.equal(r.days.mon.runs, false);
  assert.equal(r.days.mon.driver, '');
  assert.equal(r.days.thu.runs, true);
  // Into next week's row of the same run.
  await applyAction(db(), DISPATCHER, { action: 'moveRun', requestId: rid(), runDocId: '2026-10-04__run_t801', day: 'tue', toDate: '2026-10-13' });
  assert.equal((await run('2026-10-11__run_t801')).days.tue.runs, true);
});

test('a driver who is off that day or a down unit needs OVR; Down Trucks takes the unit off today and later loads', async () => {
  await notLoaded();
  // Brook is off sick 10/7 (Wednesday).
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: '2026-10-04__run_t810__wed', day: 'wed', driverId: 'drv_test_brook' }), /off on 2026-10-07 \(SICK DAY\)/);
  await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: '2026-10-04__run_t810__wed', day: 'wed', driverId: 'drv_test_brook', override: true });
  const out = await applyAction(db(), DISPATCHER, { action: 'setUnitDown', requestId: rid(), equipmentId: 'veh_truck_900002', reason: 'Brakes' }, () => new Date('2026-10-06T16:00:00Z'));
  assert.deepEqual(out.removedFrom, ['801 2026-10-06', '801 2026-10-13'], 'Tuesday 801 this week and next lost 900002; Monday is in the past');
  const unit = (await db().collection('equipment').doc('veh_truck_900002').get()).data();
  assert.equal(unit.status, 'DOWN');
  assert.equal(unit.notes, 'DOWN: Brakes');
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'assignTruck', requestId: rid(), runDocId: RUN, day: 'tue', equipmentId: 'veh_truck_900002' }), /DOWN/);
  await applyAction(db(), DISPATCHER, { action: 'setUnitUp', requestId: rid(), equipmentId: 'veh_truck_900002' });
  await applyAction(db(), DISPATCHER, { action: 'assignTruck', requestId: rid(), runDocId: RUN, day: 'tue', equipmentId: 'veh_truck_900002' });
});

test('Down Trucks: the reason is optional and the reply lists the routes the unit was taken off (Joe 10/11, review item 9)', async () => {
  await notLoaded();
  const out = await applyAction(db(), DISPATCHER, { action: 'setUnitDown', requestId: rid(), equipmentId: 'veh_truck_900002', reason: '' }, () => new Date('2026-10-06T16:00:00Z'));
  assert.deepEqual(out.taken.map(t => [t.route, t.date]), [['801', '2026-10-06'], ['801', '2026-10-13']]);
  const unit = (await db().collection('equipment').doc('veh_truck_900002').get()).data();
  assert.equal(unit.status, 'DOWN');
  assert.equal(unit.notes, 'DOWN');
});

// Review item 71 (Joe 10/13): a tablet left open since yesterday sent yesterday as "today" and cleared yesterday's runs; the
// server's operating day decides now. And a load already loaded keeps its unit.
test('Truck Down uses the server\'s operating day, not the tablet\'s, and never pulls a unit off a load already loaded', async () => {
  await notLoaded();
  // The tablet says Monday 10/5; the server's day is Tuesday 10/6 (noon in New York). Monday's 801 has the truck too.
  await db().collection('runs').doc('2026-10-04__run_t801').update({ 'days.mon.truckId': 'veh_truck_900002', 'days.mon.truck': '900002' });
  const stale = await applyAction(db(), DISPATCHER, { action: 'setUnitDown', requestId: rid(), equipmentId: 'veh_truck_900002', reason: 'Brakes', today: '2026-10-05' }, () => new Date('2026-10-06T16:00:00Z'));
  assert.deepEqual(stale.taken.map(t => [t.route, t.date]), [['801', '2026-10-06'], ['801', '2026-10-13']], 'Monday (the tablet\'s day) is left alone');
  assert.equal((await run('2026-10-04__run_t801')).days.mon.truckId, 'veh_truck_900002', 'Monday keeps its truck');
  await applyAction(db(), DISPATCHER, { action: 'setUnitUp', requestId: rid(), equipmentId: 'veh_truck_900002' });
  // Before 6 AM the operating day is still the day before (5 AM Wednesday 10/7 is Tuesday's operating day).
  await db().collection('runs').doc('2026-10-04__run_t801').update({ 'days.tue.truckId': 'veh_truck_900002', 'days.tue.truck': '900002' });
  const early = await applyAction(db(), DISPATCHER, { action: 'setUnitDown', requestId: rid(), equipmentId: 'veh_truck_900002', reason: '' }, () => new Date('2026-10-07T09:00:00Z'));
  assert.ok(early.taken.some(t => t.date === '2026-10-06'), 'Tuesday is still today before 6 AM');
  await applyAction(db(), DISPATCHER, { action: 'setUnitUp', requestId: rid(), equipmentId: 'veh_truck_900002' });
  // Tuesday's load is loaded (the loaded tick; then a stored LOADED status): it keeps the truck; next week's load loses it.
  for (const loaded of [{ 'days.tue.loadedComplete': true }, { 'days.tue.loadedComplete': false, 'days.tue.loadStatus': 'LOADED' }]) {
    await db().collection('runs').doc('2026-10-04__run_t801').update(Object.assign({ 'days.tue.truckId': 'veh_truck_900002', 'days.tue.truck': '900002' }, loaded));
    await db().collection('runs').doc('2026-10-11__run_t801').update({ 'days.tue.truckId': 'veh_truck_900002', 'days.tue.truck': '900002' });
    const out = await applyAction(db(), DISPATCHER, { action: 'setUnitDown', requestId: rid(), equipmentId: 'veh_truck_900002', reason: 'Brakes' }, () => new Date('2026-10-06T16:00:00Z'));
    assert.deepEqual(out.taken.map(t => [t.route, t.date]), [['801', '2026-10-13']]);
    assert.deepEqual(out.keptOnLoaded.map(t => [t.route, t.date]), [['801', '2026-10-06']]);
    assert.equal((await run('2026-10-04__run_t801')).days.tue.truckId, 'veh_truck_900002', 'the loaded load keeps its truck');
    assert.equal((await run('2026-10-11__run_t801')).days.tue.truckId, '');
    await applyAction(db(), DISPATCHER, { action: 'setUnitUp', requestId: rid(), equipmentId: 'veh_truck_900002' });
  }
});

test('Down Trucks: a unit already down but still on loads (the current app put it back) is taken off them, its reason kept (Joe 10/12)', async () => {
  await notLoaded();
  // The unit is down in Equipment Master, yet Tuesday 801 this week and next still carry it.
  await db().collection('equipment').doc('veh_truck_900002').update({ status: 'DOWN', notes: 'DOWN: Brakes' });
  const equipment = (await db().collection('equipment').get()).docs.map(s => s.data());
  assert.deepEqual(L.offUnitLoads(await runs(), equipment, '2026-10-06').filter(x => x.unitId === 'veh_truck_900002').map(x => [x.route, x.date]), [['801', '2026-10-06'], ['801', '2026-10-13']]);
  const out = await applyAction(db(), DISPATCHER, { action: 'setUnitDown', requestId: rid(), equipmentId: 'veh_truck_900002', clearOnly: true }, () => new Date('2026-10-06T16:00:00Z'));
  assert.deepEqual(out.taken.map(t => [t.route, t.date]), [['801', '2026-10-06'], ['801', '2026-10-13']]);
  const unit = (await db().collection('equipment').doc('veh_truck_900002').get()).data();
  assert.equal(unit.status, 'DOWN');
  assert.equal(unit.notes, 'DOWN: Brakes', 'the reason stays');
  assert.equal((await run('2026-10-04__run_t801')).days.tue.truckId, '');
  // A unit that is back in service is not taken off anything.
  await applyAction(db(), DISPATCHER, { action: 'setUnitUp', requestId: rid(), equipmentId: 'veh_truck_900002' });
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'setUnitDown', requestId: rid(), equipmentId: 'veh_truck_900002', clearOnly: true }, () => new Date('2026-10-06T16:00:00Z')), /not on the down list/);
});

test("a driver put on a day takes his own truck, also when his other load that day has it; another driver's truck or a down one stays (Joe 10/12, Joel Jacobs)", async () => {
  await db().collection('config').doc('app').set({ writeBack: { enabled: true } }, { merge: true });
  const T1 = '2026-10-04__run_t801';
  await db().collection('drivers').doc('drv_test_adams').update({ defaultTruckId: 'veh_truck_900001' });
  // His own other load that day already has the truck (880 VENTURA at 2 AM with 223879, as Joel had).
  await db().collection('runs').doc(T1).update({ 'days.tue.runs': true, 'days.tue.driverId': 'drv_test_adams', 'days.tue.driver': 'ADAMS', 'days.tue.truckId': 'veh_truck_900001', 'days.tue.truck': '900001' });
  await db().collection('runs').doc(RUN).update({ 'days.tue.runs': true, 'days.tue.truckId': '', 'days.tue.truck': '' });
  const out = await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: RUN, day: 'tue', driverId: 'drv_test_adams' });
  assert.equal(out.warnings, undefined);
  assert.deepEqual([(await run()).days.tue.truckId, (await run()).days.tue.truck], ['veh_truck_900001', '900001']);
  // Another driver has it that day: the route's truck stays and the save says why.
  await db().collection('runs').doc(T1).update({ 'days.wed.runs': true, 'days.wed.driverId': 'drv_test_brook', 'days.wed.driver': 'BROOK', 'days.wed.truckId': 'veh_truck_900001', 'days.wed.truck': '900001' });
  await db().collection('runs').doc(RUN).update({ 'days.wed.runs': true, 'days.wed.truckId': 'veh_truck_900002', 'days.wed.truck': '900002' });
  const kept = await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: RUN, day: 'wed', driverId: 'drv_test_adams' });
  assert.match(kept.warnings.join(' '), /truck 900001 is already on route 801/);
  assert.equal((await run()).days.wed.truckId, 'veh_truck_900002');
  // A down truck stays off.
  await db().collection('equipment').doc('veh_truck_900001').update({ status: 'DOWN' });
  await db().collection('runs').doc(T1).update({ 'days.thu.runs': false });
  await db().collection('runs').doc(RUN).update({ 'days.thu.runs': true, 'days.thu.truckId': '', 'days.thu.truck': '' });
  const down = await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: RUN, day: 'thu', driverId: 'drv_test_adams' });
  assert.match(down.warnings.join(' '), /900001 is DOWN; the route's truck was kept/);
  assert.equal((await run()).days.thu.truckId, '');
});
