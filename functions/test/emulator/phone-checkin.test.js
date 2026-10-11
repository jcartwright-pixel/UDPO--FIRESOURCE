'use strict';
// Joe 10/11 (review items 18-23): the drivers' phone Check-In as the current app's — over / short, a corrected truck and
// trailer, the pallet jack, drop and hook (up to 4 trailers, one write-up each), and "Who is driving?" with fill-in and
// carrier names, a route instead of a name, and Skip.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { phoneCall, newRouteCode } = require('../../src/phone');
const L = require('../../src/logic');
const F = require('../fixtures/fake-sheets');

const MANAGER = { email: 'manager.test@uniteddairy.com' };
// Tuesday 10/6/2026 at 9 PM New York: the operating day is 10/6.
const at = (min) => () => new Date(Date.parse('2026-10-07T01:00:00Z') + (min || 0) * 60000);
let n = 0;
const rid = () => 'phone-ci-' + (++n) + '-' + Date.now();
const WEEK = '2026-10-04';

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-06T12:00:00Z') });
});

async function maint() { return (await db().collection('maintenance').get()).docs.map(d => d.data()); }
async function day(route, p) { const s = (await db().collection('runs').where('weekStart', '==', WEEK).get()).docs.find(d => d.data().route === route && d.data().days[p] && d.data().days[p].runs); return s.data().days[p]; }

test('over / short, a corrected truck, the jack and two trailers: saved for the reports, write-ups on the units the driver had', async () => {
  const { code } = await newRouteCode(db(), MANAGER);
  const mine = await phoneCall(db(), { code, op: 'loads', driverId: 'drv_test_brook' }, at());
  assert.deepEqual(mine.units, { trucks: ['900001', '900002'], trailers: ['T-901', 'T-902'], jacks: [] });
  const load = mine.loads[0];
  assert.equal(load.truck, '900002');
  await phoneCall(db(), { code, op: 'checkIn', driverId: 'drv_test_brook', runDocId: load.runDocId, day: load.day, requestId: rid(),
    fields: { casesDelivered: '398', overageShortage: true, overageShortageDetails: 'SHORT 2 cs · 2% gallon · Store: Giant Eagle',
      truck: '01', trailer: 't 902', palletJack: 'PJ-7', tractorIssues: 'Check engine light', trailerIssues: 'Door seal',
      moreTrailers: [{ trailer: '901', issues: 'Light out', needsCleaned: true }] } }, at(1));
  const d = await day('801', 'tue');
  assert.equal(d.overageShortage, 'TRUE');
  assert.equal(d.overageShortageDetails, 'SHORT 2 cs · 2% gallon · Store: Giant Eagle');
  assert.equal(d.checkinTruck, '900001', 'a short number finds the truck');
  assert.equal(d.checkinTrailer, '', 'the same trailer as Dispatch is not a correction');
  assert.equal(d.palletJackUnit, 'PJ-7', 'a number with no unit is kept as typed');
  assert.deepEqual(d.moreTrailers, [{ trailer: 'T-901', issues: 'Light out', needsCleaned: true }]);
  assert.equal(d.truck, '900002', 'Dispatch\'s truck stays');
  // The Plant reports count the shortage for the loading shift; Driver Check-ins shows the units and each trailer.
  const runs = (await db().collection('runs').get()).docs.map(x => Object.assign({ id: x.id }, x.data()));
  const row = L.checkinRows(runs, '2026-10-06').find(r => r.route === '801');
  assert.equal(row.truck, '900001');
  assert.equal(row.trailer, 'T-902 / T-901');
  assert.deepEqual(row.issues, ['Truck: Check engine light', 'Trailer 1: Door seal', 'Trailer 2 (T-901): Light out', 'Trailer 2 (T-901) needs cleaned', 'Over/short: SHORT 2 cs · 2% gallon · Store: Giant Eagle']);
  const m = await maint();
  const truck = m.find(r => r.kind === 'TRUCK');
  assert.equal(truck.truck_number, '900001');
  assert.equal(truck.truck_id, 'veh_truck_900001');
  const trailers = m.filter(r => r.kind === 'TRAILER').sort((a, b) => a.record_id.localeCompare(b.record_id));
  assert.deepEqual(trailers.map(r => [r.trailer_number, r.issue_details]), [['T-902', '1st trailer: Door seal'], ['T-901', '2nd trailer: Light out']]);
  assert.deepEqual(m.filter(r => r.kind === 'WASH').map(r => [r.unit_number, r.wash_reason]), [['T-901', '2nd trailer: Trailer cleaning requested']]);
  // A fifth trailer or the same trailer twice is refused with the reason.
  await assert.rejects(phoneCall(db(), { code, op: 'checkIn', driverId: 'drv_test_brook', runDocId: load.runDocId, day: load.day, requestId: rid(),
    fields: { trailer: 'T-1', moreTrailers: [{ trailer: 'T-2' }, { trailer: 'T-3' }, { trailer: 'T-4' }, { trailer: 'T-5' }] } }, at(2)), /at most 4 trailers/);
  await assert.rejects(phoneCall(db(), { code, op: 'checkIn', driverId: 'drv_test_brook', runDocId: load.runDocId, day: load.day, requestId: rid(),
    fields: { trailer: 'T-901', moreTrailers: [{ trailer: '901' }] } }, at(2)), /entered twice/);
  // Unticking over / short clears it.
  await phoneCall(db(), { code, op: 'checkIn', driverId: 'drv_test_brook', runDocId: load.runDocId, day: load.day, requestId: rid(), fields: { overageShortage: false, overageShortageDetails: '' } }, at(3));
  assert.equal((await day('801', 'tue')).overageShortage, '');
});

test('Who is driving: a fill-in name on today\'s dispatch, a route instead of a name, and Skip', async () => {
  const { code } = await newRouteCode(db(), MANAGER);
  const ref = (await db().collection('runs').where('weekStart', '==', WEEK).get()).docs.find(x => x.data().route === '802' && x.data().days.tue && x.data().days.tue.runs).ref;
  await ref.update({ 'days.tue.driver': 'FILLIN, JO', 'days.tue.driverId': '' });
  const roster = await phoneCall(db(), { code, op: 'roster' }, at());
  assert.deepEqual(roster.drivers.map(d => d.name), ['ADAMS, PAT', 'BROOK, SAM', 'CASEY, LEE']);
  assert.deepEqual(roster.others, ['FILLIN, JO']);
  assert.deepEqual(roster.routes.map(r => r.name), ['801 · UT DSD MILK', '802 · UT DSD MILK']);
  // The fill-in driver sees and checks in only their load.
  const fill = await phoneCall(db(), { code, op: 'loads', driverId: 'name:FILLIN, JO' }, at());
  assert.deepEqual(fill.loads.map(l => l.route), ['802']);
  await phoneCall(db(), { code, op: 'checkIn', driverId: 'name:FILLIN, JO', runDocId: fill.loads[0].runDocId, day: 'tue', requestId: rid(), fields: { casesDelivered: '50' } }, at(1));
  assert.equal((await day('802', 'tue')).casesDelivered, 50);
  const log = (await db().collection('actions').where('action', '==', 'phoneCheckIn').get()).docs[0].data();
  assert.equal(log.driver, 'FILLIN, JO');
  const brook = (await phoneCall(db(), { code, op: 'loads', driverId: 'drv_test_brook' }, at())).loads[0];
  await assert.rejects(phoneCall(db(), { code, op: 'checkIn', driverId: 'name:FILLIN, JO', runDocId: brook.runDocId, day: 'tue', requestId: rid(), fields: { casesDelivered: '1' } }, at(2)), /not yours/);
  // A route picked instead of a name: only that load.
  const route = await phoneCall(db(), { code, op: 'loads', driverId: roster.routes[0].id }, at());
  assert.deepEqual(route.loads.map(l => l.route), ['801']);
  assert.equal(route.driver, 'Route 801 · UT DSD MILK');
  // Skip: every load of the day, the driver picks theirs.
  const skip = await phoneCall(db(), { code, op: 'loads', driverId: 'skip' }, at());
  assert.deepEqual(skip.loads.map(l => [l.route, l.driver]), [['801', 'BROOK, SAM'], ['802', 'FILLIN, JO']]);
  await phoneCall(db(), { code, op: 'checkIn', driverId: 'skip', runDocId: brook.runDocId, day: 'tue', requestId: rid(), fields: { casesDelivered: '7' } }, at(3));
  assert.equal((await day('801', 'tue')).casesDelivered, 7);
});
