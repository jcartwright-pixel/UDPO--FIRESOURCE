'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { phoneCall, newRouteCode, MAX_FAILED_PER_MINUTE } = require('../../src/phone');
const L = require('../../src/logic');
const F = require('../fixtures/fake-sheets');

const MANAGER = { email: 'manager.test@uniteddairy.com' };
const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
// Tuesday 10/6/2026 at 9 PM New York: the operating day is 10/6.
const at = (min) => () => new Date(Date.parse('2026-10-07T01:00:00Z') + (min || 0) * 60000);
let n = 0;
const rid = () => 'phone-request-' + (++n) + '-' + Date.now();

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-06T12:00:00Z') });
});

test('only a manager makes the phone code; the server keeps only its hash', async () => {
  await assert.rejects(newRouteCode(db(), DISPATCHER), /manager or administrator/);
  const { code } = await newRouteCode(db(), MANAGER);
  assert.match(code, /^[A-Z2-9]{6}$/);
  const stored = (await db().collection('config').doc('routePhone').get()).data();
  assert.ok(!JSON.stringify(stored).includes(code));
});

test('a driver with the code sees only their own loads and checks one in', async () => {
  await assert.rejects(phoneCall(db(), { code: 'ANY', op: 'roster' }, at()), /not turned on/);
  const { code } = await newRouteCode(db(), MANAGER);
  const roster = await phoneCall(db(), { code, op: 'roster' }, at());
  assert.deepEqual(roster.drivers.map(d => d.name), ['ADAMS, PAT', 'BROOK, SAM', 'CASEY, LEE']);
  assert.deepEqual(roster.dates, ['2026-10-06', '2026-10-05']);
  // Brook has 801 on Tuesday 10/6 (matched by name in the copy).
  const mine = await phoneCall(db(), { code, op: 'loads', driverId: 'drv_test_brook' }, at());
  assert.deepEqual(mine.loads.map(l => l.route), ['801']);
  const load = mine.loads[0];
  await phoneCall(db(), { code, op: 'checkIn', driverId: 'drv_test_brook', runDocId: load.runDocId, day: load.day, requestId: rid(),
    fields: { casesDelivered: '398', driverCaseReturn: '2', trailerIssues: 'Light out', trailerNeedsCleaned: true } }, at(1));
  const runs = (await db().collection('runs').get()).docs.map(d => Object.assign({ id: d.id }, d.data()));
  const row = L.checkinRows(runs, '2026-10-06').find(r => r.route === '801');
  assert.equal(row.casesDelivered, 398);
  assert.deepEqual(row.issues, ['Trailer: Light out', 'Trailer needs cleaned']);
  const log = (await db().collection('actions').where('action', '==', 'phoneCheckIn').get()).docs[0].data();
  assert.equal(log.by, 'phone:drv_test_brook');
  // Someone else's load, or a load from last week, is refused.
  await assert.rejects(phoneCall(db(), { code, op: 'checkIn', driverId: 'drv_test_casey', runDocId: load.runDocId, day: load.day, requestId: rid(), fields: { casesDelivered: '1' } }, at(2)), /not yours/);
  await assert.rejects(phoneCall(db(), { code, op: 'checkIn', driverId: 'drv_test_adams', runDocId: '2026-09-27__run_t801', day: 'mon', requestId: rid(), fields: { casesDelivered: '1' } }, at(2)), /not yours/);
});

test('a wrong code is refused, and after 30 wrong codes in a minute even the right one waits', async () => {
  const { code } = await newRouteCode(db(), MANAGER);
  for (let i = 0; i < MAX_FAILED_PER_MINUTE; i++) await assert.rejects(phoneCall(db(), { code: 'WRONG' + i, op: 'roster' }, at(10)), /not right/);
  await assert.rejects(phoneCall(db(), { code, op: 'roster' }, at(10)), /Too many wrong codes/);
  assert.ok((await phoneCall(db(), { code, op: 'roster' }, at(11))).drivers.length);
  // A new code: the old one stops working.
  await newRouteCode(db(), MANAGER);
  await assert.rejects(phoneCall(db(), { code, op: 'roster' }, at(12)), /not right/);
});
