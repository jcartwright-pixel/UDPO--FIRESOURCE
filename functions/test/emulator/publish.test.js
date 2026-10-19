'use strict';
// Joe 10/11, review items 6, 7 and 49: Publish moves the Live weeks on and builds the new Next week; Route Editor and Driver
// Roster saves (actions.js D6) reach the week Publish built; Update Live Sheets adds missing runs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const { setSwitch } = require('../../src/switch');
const A = require('../../src/admin');
const ROLL = require('../../src/weekroll');
const L = require('../../src/logic');
const F = require('../fixtures/fake-sheets');

const ADMIN = { email: 'admin.test@uniteddairy.com' };
const MANAGER = { email: 'manager.test@uniteddairy.com' };
const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
const AT = () => new Date('2026-10-09T12:00:00Z');
let n = 0;
const rid = () => 'publish-request-' + (++n) + '-' + Date.now();
const config = async () => (await db().collection('config').doc('app').get()).data();
const week = async (w) => (await db().collection('runs').where('weekStart', '==', w).get()).docs.map(d => Object.assign({ id: d.id }, d.data()));
const runOf = (runs, runId) => runs.find(r => r.runId === runId);
const copy = (at) => runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date(at || '2026-10-09T12:00:00Z') });

test.beforeEach(async () => { await clear(); await copy(); });

test('Publish of the Next week: Current becomes Previous, Next becomes Current, the new Next is built from the masters', async () => {
  assert.deepEqual((await config()).liveWeeks, { previous: '2026-09-27', current: '2026-10-04', next: '2026-10-11' });
  await assert.rejects(applyAction(db(), { email: 'viewer.test@uniteddairy.com' }, { action: 'publishWeek', requestId: rid(), weekStart: '2026-10-11' }, AT), /role|allowed/);
  // The made-up Route Master leaves the show flags blank (blank is No, as in the current app); the real one has them.
  for (const id of ['run_t801', 'run_t802', 'run_t810']) await db().collection('routes').doc(id).update({ displayDaily: true, displayWeekly: true });
  const out = await applyAction(db(), DISPATCHER, { action: 'publishWeek', requestId: rid(), weekStart: '2026-10-11' }, AT);
  assert.deepEqual([out.previousWeek, out.currentWeek, out.nextWeek], ['2026-10-04', '2026-10-11', '2026-10-18']);
  assert.match(out.message, /^Week pushed live\. Current is now 10\/11/);
  assert.deepEqual((await config()).liveWeeks, { previous: '2026-10-04', current: '2026-10-11', next: '2026-10-18' });

  const built = await week('2026-10-18');
  assert.equal(built.length, 4, 'one run per Route Master run');
  const r801 = runOf(built, 'run_t801');
  assert.equal(r801.id, '2026-10-18__run_t801');
  assert.equal(r801.sourceTab, 'BUILT BY PUBLISH');
  assert.deepEqual(L.DAYS.filter(p => r801.days[p].runs), ['mon', 'tue']);
  assert.deepEqual([r801.days.mon.driver, r801.days.mon.truck, r801.days.mon.trailer, r801.days.mon.dispatchTime], ['ADAMS, PAT', '900001', 'T-901', 240]);
  assert.equal(r801.days.mon.routeHours, 9.5);
  assert.equal(r801.days.mon.loadDate, '2026-10-18');
  assert.equal(r801.days.tue.truck, '', 'Route Master has no default truck for Tuesday');
  const r802 = runOf(built, 'run_t802');
  assert.deepEqual([r802.days.mon.driver, r802.days.tue.driver], ['CASEY, LEE', 'CASEY, LEE']);
  assert.equal(runOf(built, 'run_t810').days.wed.driver, '', 'an inactive driver is never put on');
  // Weekly and Daily read the built week like a copied one.
  assert.deepEqual(L.weeklyRows(built, '2026-10-18').map(r => r.route), ['802', '801', '810']);
  assert.deepEqual(L.dailyRows(built, '2026-10-18').map(r => r.route), ['802', '801']);
  // The new Current week's blank days got the standard driver; nothing anyone picked changed.
  const cur = await week('2026-10-11');
  assert.equal(runOf(cur, 'run_t802').days.tue.driver, 'CASEY, LEE');
  assert.equal(runOf(cur, 'run_t801').days.mon.driver, 'ADAMS, PAT');
  assert.equal((await db().collection('weeks').doc('2026-10-11').get()).data().publishedBy, DISPATCHER.email);

  // The minute copy keeps the published weeks (the sheet still holds 9/27 to 10/11) and keeps the built runs.
  await copy('2026-10-09T12:05:00Z');
  assert.deepEqual((await config()).liveWeeks, { previous: '2026-10-04', current: '2026-10-11', next: '2026-10-18' });
  assert.equal((await week('2026-10-18')).length, 4);
  // Publishing the old Next week again only records it; the new Next week moves on again.
  const again = await applyAction(db(), DISPATCHER, { action: 'publishWeek', requestId: rid(), weekStart: '2026-10-11' }, AT);
  assert.equal(again.nextWeek, undefined);
  const next = await applyAction(db(), DISPATCHER, { action: 'publishWeek', requestId: rid(), weekStart: '2026-10-18' }, AT);
  assert.equal(next.nextWeek, '2026-10-25');
  assert.equal((await week('2026-10-25')).length, 4);
  assert.equal((await week('2026-09-27')).length > 0, true, 'older weeks are kept');
});

test('once the sheet holds the weeks Publish built, the sheet rows replace the built ones', async () => {
  await applyAction(db(), DISPATCHER, { action: 'publishWeek', requestId: rid(), weekStart: '2026-10-11' }, AT);
  const tabs = F.fakeSheets({
    "'LIVE PREVIOUS WEEK'": F.liveTab('2026-10-04', '2026-10-04', F.weekRoutes('2026-10-04')),
    "'LIVE CURRENT WEEK'": F.liveTab('2026-10-11', '2026-10-11', F.weekRoutes('2026-10-11')),
    "'LIVE NEXT WEEK'": F.liveTab('2026-10-18', '2026-10-18', F.weekRoutes('2026-10-18'))
  });
  await runTransfer({ db: db(), reader: F.fakeReader(tabs), sources: F.SOURCES, now: () => new Date('2026-10-09T12:10:00Z') });
  const w = await week('2026-10-18');
  assert.equal(w.filter(r => r.sourceTab === 'LIVE NEXT WEEK').length, 6);
  assert.equal(w.filter(r => r.sourceTab === 'BUILT BY PUBLISH').length, 0);
  assert.deepEqual((await config()).liveWeeks, { previous: '2026-10-04', current: '2026-10-11', next: '2026-10-18' });
});

test('Publish is refused for a stale week and while the write-back is on; a forgotten Publish happens on its own', async () => {
  await setSwitch(db(), ADMIN, { requestId: rid(), writeBack: true }, true);
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'publishWeek', requestId: rid(), weekStart: '2026-10-11' }, AT), /Live sheet could not be reached/);
  await setSwitch(db(), ADMIN, { requestId: rid(), writeBack: false }, true);
  assert.equal(await ROLL.autoPublish(db(), () => new Date('2026-10-10T12:00:00Z')), null, 'Saturday 10/10 is still before the Next week');
  const auto = await ROLL.autoPublish(db(), () => new Date('2026-10-11T12:00:00Z'));
  assert.equal(auto.currentWeek, '2026-10-11');
  assert.equal(await ROLL.autoPublish(db(), () => new Date('2026-10-11T12:01:00Z')), null, 'once per week');
  assert.deepEqual((await config()).liveWeeks, { previous: '2026-10-04', current: '2026-10-11', next: '2026-10-18' });
  const log = (await db().collection('actions').doc('autopublish-2026-10-11').get()).data();
  assert.equal(log.by, 'automatic publish');
});

test('after Publish, Route Editor and Driver Roster saves reach the new Next week too, and the copy keeps them', async () => {
  for (const id of ['run_t801', 'run_t802', 'run_t810']) await db().collection('routes').doc(id).update({ displayDaily: true, displayWeekly: true });
  await applyAction(db(), DISPATCHER, { action: 'publishWeek', requestId: rid(), weekStart: '2026-10-11' }, AT);
  await applyAction(db(), MANAGER, { action: 'saveRoute', requestId: rid(), runId: 'run_t801', fields: {}, days: { mon: { dispatchTime: '6 AM' } } }, AT);
  assert.equal(runOf(await week('2026-10-18'), 'run_t801').days.mon.dispatchTime, 360);
  const out = await applyAction(db(), MANAGER, { action: 'saveRoute', requestId: rid(), fields: { route: '805', routeName: 'NEW STOP', run: 'MARIETTA', coverageOwner: 'Marietta', active: true }, days: { thu: { active: true, dispatchTime: '3 AM' } } }, AT);
  assert.equal(runOf(await week('2026-10-18'), out.runId).days.thu.runs, true);
  await applyAction(db(), MANAGER, { action: 'setDriverTruck', requestId: rid(), driverId: 'drv_test_casey', equipmentId: 'veh_truck_900002' }, AT);
  assert.equal(runOf(await week('2026-10-18'), 'run_t802').days.mon.truck, '900002');
  await copy('2026-10-09T12:05:00Z');
  const kept = await week('2026-10-18');
  assert.equal(runOf(kept, 'run_t801').days.mon.dispatchTime, 360);
  assert.ok(runOf(kept, out.runId), 'the added run is kept');
});

test('Update Live Sheets adds a Route Master run missing from the Live weeks', async () => {
  await db().collection('routes').doc('run_t806').set(Object.assign({}, (await db().collection('routes').doc('run_t802').get()).data(), { id: 'run_t806', route: '806', routeId: 'rte_t806' }));
  const call = (input) => A.adminCall(db(), ADMIN, input, { now: AT });
  const dry = await call({ op: 'updateLive', apply: false });
  assert.deepEqual(dry.missing.map(m => m.runDocId), ['2026-10-04__run_t806', '2026-10-11__run_t806']);
  assert.match(dry.message, /2 Route Master runs would be added/);
  assert.equal(runOf(await week('2026-10-11'), 'run_t806'), undefined, 'a dry run changes nothing');
  const done = await call({ op: 'updateLive', apply: true });
  assert.equal(done.added, 2);
  assert.equal(runOf(await week('2026-10-11'), 'run_t806').days.mon.runs, true);
});

test('weeks the current app archived (DISPATCH WEEK HISTORY) are copied in read only, for Weekly and the Driver Scorecard', async () => {
  const H = ['week_start', 'day_prefix', 'load_date', 'delivery_date', 'facility_id', 'route_id', 'run_id', 'stream_id', 'route', 'route_name', 'run', 'run_display',
    'movement_type', 'coverage_type', 'coverage_owner', 'route_status', 'loadout_type', 'scheduled', 'load_sequence', 'driver_id', 'driver', 'truck_id', 'truck', 'trailer_id', 'trailer',
    'pallet_jack', 'departure_date', 'departure_time', 'route_hours', 'calculated_return_time', 'return_day_offset', 'miles', 'driver_notes', 'load_day_offset',
    'show_daily', 'show_weekly', 'weekly_sequence', 'archived_at'];
  const row = (week, p, delivery, scheduled, driver) => H.map(h => ({ week_start: week, day_prefix: p, load_date: L.addDays(delivery, -1), delivery_date: delivery, route_id: 'rte_t801', run_id: 'run_t801',
    route: '801', route_name: 'UT DSD MILK', run: 'UT DSD MILK', route_status: 'ACTIVE', scheduled, load_sequence: '20', driver_id: driver ? 'drv_test_adams' : '', driver: driver || '',
    truck: '900001', departure_time: '4:00 AM', route_hours: '9.5', miles: '140', load_day_offset: '-1', show_daily: 'TRUE', show_weekly: 'TRUE', weekly_sequence: '2' }[h] || ''));
  const tabs = F.fakeSheets({ "'DISPATCH WEEK HISTORY'": [H, row('2026-09-20', 'mon', '2026-09-21', 'TRUE', 'ADAMS, PAT'), row('2026-09-20', 'tue', '2026-09-22', 'FALSE', ''),
    row('2026-09-27', 'mon', '2026-09-28', 'TRUE', 'SOMEONE ELSE')] });
  const sources = Object.assign({}, F.SOURCES, { live: Object.assign({}, F.SOURCES.live, { weekHistory: true }) });
  const out = await runTransfer({ db: db(), reader: F.fakeReader(tabs), sources, now: () => new Date('2026-10-09T12:05:00Z') });
  assert.deepEqual(Object.keys(out.summary.history), ['2026-09-20'], 'the week the Live tabs hold is left alone');
  const old = await week('2026-09-20');
  assert.equal(old.length, 1);
  assert.deepEqual([old[0].days.mon.runs, old[0].days.mon.driver, old[0].days.mon.dispatchTime, old[0].days.tue.runs], [true, 'ADAMS, PAT', 240, false]);
  assert.deepEqual(L.weeklyRows(old, '2026-09-20').map(r => r.days.mon.driver), ['ADAMS, PAT']);
  assert.equal(runOf(await week('2026-09-27'), 'run_t801').days.mon.driver, 'ADAMS, PAT', 'the copied Previous week keeps its own driver');
  // Unchanged on the next copy.
  const again = await runTransfer({ db: db(), reader: F.fakeReader(tabs), sources, now: () => new Date('2026-10-09T12:06:00Z') });
  assert.equal(again.summary.history['2026-09-20'].written, 0);
});

test('Joe 10/19: Publish builds a branch box load with every day not running; the dispatcher adds it as it comes in', async () => {
  await db().collection('routes').doc('run_t801').update({ loadType: 'Boxing', coverageType: 'BRANCH', displayDaily: true, displayWeekly: true });
  await db().collection('routes').doc('run_t802').update({ loadType: 'Boxing', coverageType: 'BRANCH', displayDaily: true, displayWeekly: true });
  // Joe 10/19: "if it is put on the plant schedule, that it is running": 802 is already on the Scheduler for Tuesday 10-20.
  await db().collection('plantLoads').doc('SCHED-box-802').set({ runId: 'run_t802', route: '802', date: '2026-10-20', status: 'SCHEDULED', pickupTime: '05:30' });
  await applyAction(db(), DISPATCHER, { action: 'publishWeek', requestId: rid(), weekStart: '2026-10-11' }, AT);
  const built = await week('2026-10-18'), box = runOf(built, 'run_t801');
  assert.deepEqual(L.DAYS.filter(p => box.days[p].runs), [], 'Route Master runs it Monday and Tuesday; it starts as not running');
  assert.deepEqual(L.DAYS.filter(p => runOf(built, 'run_t802').days[p].runs), ['tue'], 'the box load on the Scheduler runs that day');
  assert.equal(runOf(built, 'run_t802').days.tue.driver, 'CASEY, LEE', 'and gets its standard driver');
  assert.deepEqual([box.days.mon.driver, box.days.mon.truck, box.days.mon.trailer], ['', '', '']);
  assert.deepEqual(L.DAYS.filter(p => runOf(built, 'run_t810').days[p].runs).length > 0, true, 'other runs keep their Route Master days');
  const on = await applyAction(db(), DISPATCHER, { action: 'setRuns', requestId: rid(), runDocId: box.id, day: 'mon', runs: true }, AT);
  assert.equal(on.ok, true);
  assert.equal(runOf(await week('2026-10-18'), 'run_t801').days.mon.runs, true);
});
