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
const MANAGER = { email: 'manager.test@uniteddairy.com' };
const RUN = '2026-10-04__run_t802';
let n = 0;
const rid = () => 'ci-request-' + (++n) + '-' + Date.now();
let clock = 0;
const tick = () => new Date(Date.parse('2026-10-09T12:00:00Z') + (++clock) * 60000);

let tabs;
test.beforeEach(async () => {
  await clear();
  tabs = F.fakeSheets();
  await runTransfer({ db: db(), reader: F.fakeReader(tabs), sources: F.SOURCES, now: tick });
});

const runs = async () => (await db().collection('runs').get()).docs.map(d => Object.assign({ id: d.id }, d.data()));

test('a dispatcher enters a check-in for a driver: one call, shown on the check-in list', async () => {
  const before = await runs();
  assert.equal(L.checkinRows(before, '2026-10-06').find(r => r.route === '802').checkedIn, false);
  await applyAction(db(), DISPATCHER, { action: 'saveCheckIn', requestId: rid(), runDocId: RUN, day: 'tue', casesDelivered: 412, driverCaseReturn: 3,
    refusedReturned: '2 cs 2% gal', refusedReturnedSource: 'Store 14', trailerIssues: 'Left door seal torn', trailerNeedsCleaned: true });
  const row = L.checkinRows(await runs(), '2026-10-06').find(r => r.route === '802');
  assert.equal(row.checkedIn, true);
  assert.equal(row.casesDelivered, 412);
  assert.equal(row.driverCaseReturn, 3);
  assert.deepEqual(row.issues, ['Trailer: Left door seal torn', 'Trailer needs cleaned']);
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'saveCheckIn', requestId: rid(), runDocId: RUN, day: 'tue', casesDelivered: -4 }), /whole number/);
});

test('with the write-back on, a check-in reaches the same Live columns the phone check-in writes today', async () => {
  await db().collection('config').doc('app').set({ writeBack: { enabled: true } }, { merge: true });
  await applyAction(db(), DISPATCHER, { action: 'saveCheckIn', requestId: rid(), runDocId: RUN, day: 'tue', casesDelivered: 400, driverCaseReturn: 0, refusedReturned: '1 cs', refusedReturnedSource: 'Store 9' });
  const sheets = F.fakeWritableSheets(tabs);
  const out = await runWriteBack({ db: db(), sheets, target: { spreadsheetId: 'fake-live' }, now: tick });
  assert.equal(out.conflicts, 0);
  const v = tabs["'LIVE CURRENT WEEK'"], h = v[5], row = v.find((r, i) => i > 5 && r[h.indexOf('run_id')] === 'run_t802');
  assert.equal(row[h.indexOf('tue_cases_delivered')], 400);
  assert.equal(row[h.indexOf('tue_driver_case_return')], 0);
  assert.equal(row[h.indexOf('tue_refused_returned')], '1 cs');
  assert.equal(row[h.indexOf('tue_refused_returned_source')], 'Store 9');
  assert.ok(row[h.indexOf('tue_checkin_completed_at')]);
});

test('the driver list: seniority order, vacation weeks, and manager-only edits', async () => {
  const drivers = (await db().collection('drivers').get()).docs.map(d => d.data());
  const rows = L.driverRosterRows(drivers, '2026-10-09');
  assert.deepEqual(rows.slice(0, 3).map(r => [r.position, r.name, r.vacationWeeks]), [[1, 'ADAMS, PAT', 4], [2, 'BROOK, SAM', 2], [3, 'CASEY, LEE', 0]]);
  assert.equal(rows.find(r => r.name === 'BROOK, SAM').reliefDriver, true);

  await applyAction(db(), MANAGER, { action: 'setDriverTruck', requestId: rid(), driverId: 'drv_test_casey', equipmentId: 'veh_truck_900002' });
  await applyAction(db(), MANAGER, { action: 'setDriverAvailable', requestId: rid(), driverId: 'drv_test_casey', available: false, reason: 'Out on leave' });
  await applyAction(db(), MANAGER, { action: 'setDriverRelief', requestId: rid(), driverId: 'drv_test_casey', relief: true });
  const casey = (await db().collection('drivers').doc('drv_test_casey').get()).data();
  assert.equal(casey.defaultTruckId, 'veh_truck_900002');
  assert.equal(casey.status, 'INACTIVE');
  assert.equal(casey.unavailableReason, 'Out on leave');
  assert.equal(casey.reliefDriver, true);

  await assert.rejects(applyAction(db(), MANAGER, { action: 'setDriverTruck', requestId: rid(), driverId: 'drv_test_casey', equipmentId: 'veh_trailer_t_901' }), /not a TRUCK/);
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'setDriverRelief', requestId: rid(), driverId: 'drv_test_adams', relief: true }), /does not have a role/);
  // The minute copy leaves the edit alone while that driver's row is unchanged in DRIVERS_MASTER.
  await runTransfer({ db: db(), reader: F.fakeReader(tabs), sources: F.SOURCES, now: tick });
  assert.equal((await db().collection('drivers').doc('drv_test_casey').get()).data().status, 'INACTIVE');
});

test('the home numbers count loads, drivers, check-ins and units', async () => {
  const drivers = (await db().collection('drivers').get()).docs.map(d => d.data());
  const equipment = (await db().collection('equipment').get()).docs.map(d => d.data());
  const h = L.homeNumbers(await runs(), drivers, equipment, '2026-10-05');
  assert.equal(h.daily.loads, 2);
  assert.equal(h.drivers.active, 3);
  assert.equal(h.drivers.relief, 1);
  assert.equal(h.drivers.inactive, 1);
  assert.equal(h.fleet.trucks, 2);
  assert.equal(h.fleet.trailers, 2);
  assert.equal(h.checkins.deliveries, 2, 'Monday 10/5 deliveries');
});

test('a manager adds a driver, renames one, edits dates, and removes drivers (kept as INACTIVE)', async () => {
  const added = await applyAction(db(), MANAGER, { action: 'saveDriver', requestId: rid(), name: 'Evans, Kim', hireDate: '2019-04-01', seniorityDate: '4/1/2019', truck: '900001', relief: true });
  const kim = (await db().collection('drivers').doc(added.driverId).get()).data();
  assert.equal(kim.name, 'EVANS, KIM');
  assert.equal(kim.status, 'ACTIVE');
  assert.equal(kim.seniorityDate, '2019-04-01');
  assert.equal(kim.defaultTruckId, 'veh_truck_900001');
  assert.equal(kim.reliefDriver, true);

  await applyAction(db(), MANAGER, { action: 'saveDriver', requestId: rid(), driverId: 'drv_test_casey', name: 'Casey, Leigh', hireDate: '2025-12-01', seniorityDate: '2025-11-15', truck: '', relief: false });
  const casey = (await db().collection('drivers').doc('drv_test_casey').get()).data();
  assert.equal(casey.name, 'CASEY, LEIGH');
  assert.equal(casey.seniorityDate, '2025-11-15');

  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveDriver', requestId: rid(), name: 'X', truck: 'T-901' }), /not a truck/);
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveDriver', requestId: rid(), name: '' }), /Enter the driver name/);
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveDriver', requestId: rid(), name: 'Y', hireDate: 'soon' }), /must be a date/);

  await applyAction(db(), MANAGER, { action: 'removeDrivers', requestId: rid(), driverIds: [added.driverId, 'drv_test_brook'] });
  for (const id of [added.driverId, 'drv_test_brook']) {
    const d = (await db().collection('drivers').doc(id).get()).data();
    assert.equal(d.status, 'INACTIVE');
    assert.equal(d.unavailableReason, 'Removed from operational roster');
  }
  // The minute copy keeps a driver added in the app (it is not in DRIVERS_MASTER yet).
  await runTransfer({ db: db(), reader: F.fakeReader(tabs), sources: F.SOURCES, now: tick });
  assert.ok((await db().collection('drivers').doc(added.driverId).get()).exists);
});

// Joe 11/2: Delete on the Driver Roster. The record stays (marked DELETED) so old loads keep the name; the driver is off every
// list, cannot be put on a run, gets no texts, nothing goes to the Driver Master sheet, and the sheet copy keeps them deleted.
test('a manager deletes a driver: kept as DELETED, out of every list, and still deleted after the sheet is copied again', async () => {
  await applyAction(db(), MANAGER, { action: 'setDriverText', requestId: rid(), driverId: 'drv_test_brook', kind: 'SCHEDULE', on: true });
  const outboxBefore = (await db().collection('masterOutbox').get()).size;
  await applyAction(db(), MANAGER, { action: 'deleteDriver', requestId: rid(), driverId: 'drv_test_brook' });
  const d = (await db().collection('drivers').doc('drv_test_brook').get()).data();
  assert.equal(d.status, 'DELETED');
  assert.equal(d.deleted, true);
  assert.ok(d.name, 'the name is kept for old loads');
  assert.equal(L.driverActive(d), false);
  assert.equal(L.driverRosterRows([d], '2026-10-09')[0].deleted, true);
  assert.equal((await db().collection('driverPhones').doc('drv_test_brook').get()).data().scheduleText, false);
  assert.equal((await db().collection('masterOutbox').get()).size, outboxBefore, 'Delete writes nothing to the Driver Master sheet');
  assert.equal((await db().collection('deletedDrivers').doc('drv_test_brook').get()).data().by, MANAGER.email);
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: RUN, day: 'tue', driverId: 'drv_test_brook', override: true }), /deleted on the Driver Roster/);
  // The sheet's row for the driver changes and is copied again: still deleted.
  const sheet = tabs["'DRIVERS_MASTER'"], nameCol = sheet[0].indexOf('name'), row = sheet.find(r => r.includes('drv_test_brook'));
  row[nameCol] = 'BROOK, SAMUEL';
  await runTransfer({ db: db(), reader: F.fakeReader(tabs), sources: F.SOURCES, now: tick });
  const again = (await db().collection('drivers').doc('drv_test_brook').get()).data();
  assert.equal(again.status, 'DELETED');
  assert.equal(again.name, 'BROOK, SAMUEL', 'the row was copied again');
  await assert.rejects(applyAction(db(), MANAGER, { action: 'deleteDriver', requestId: rid(), driverId: 'drv_nobody' }), /not on the Driver Roster/);
});
