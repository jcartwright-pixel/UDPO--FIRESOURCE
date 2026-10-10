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
  // Brook is off sick 10/7 (Wednesday).
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: '2026-10-04__run_t810__wed', day: 'wed', driverId: 'drv_test_brook' }), /off on 2026-10-07 \(SICK DAY\)/);
  await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: '2026-10-04__run_t810__wed', day: 'wed', driverId: 'drv_test_brook', override: true });
  const out = await applyAction(db(), DISPATCHER, { action: 'setUnitDown', requestId: rid(), equipmentId: 'veh_truck_900002', reason: 'Brakes', today: '2026-10-06' });
  assert.deepEqual(out.removedFrom, ['801 2026-10-06', '801 2026-10-13'], 'Tuesday 801 this week and next lost 900002; Monday is in the past');
  const unit = (await db().collection('equipment').doc('veh_truck_900002').get()).data();
  assert.equal(unit.status, 'DOWN');
  assert.equal(unit.notes, 'DOWN: Brakes');
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'assignTruck', requestId: rid(), runDocId: RUN, day: 'tue', equipmentId: 'veh_truck_900002' }), /DOWN/);
  await applyAction(db(), DISPATCHER, { action: 'setUnitUp', requestId: rid(), equipmentId: 'veh_truck_900002' });
  await applyAction(db(), DISPATCHER, { action: 'assignTruck', requestId: rid(), runDocId: RUN, day: 'tue', equipmentId: 'veh_truck_900002' });
});
