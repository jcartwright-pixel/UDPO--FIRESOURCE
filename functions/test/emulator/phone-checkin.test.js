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
  assert.deepEqual(row.issues, ['Truck: Check engine light', 'Trailer 1: Door seal', 'Trailer 2 (T-901): Light out', 'Trailer 2 (T-901) needs cleaned', 'Short: 2 cs · 2% gallon · Store: Giant Eagle']);
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

test('a phone link a manager turned off says where to turn it back on', async () => {
  const { code } = await newRouteCode(db(), MANAGER);
  await db().collection('config').doc('routePhone').update({ enabled: false });
  await assert.rejects(phoneCall(db(), { code, op: 'roster' }, at()), /turned off right now\. A manager turns it back on in Administration > Links & Codes > Driver Station Codes/);
});

// Joe 10/13: "Was your truck loaded correctly?" Yes / No; a No says what was wrong. It stays in the app (no Live sheet
// column), shows on Driver Check-ins as a loading problem, and a No with nothing written, or no answer at all, is refused.
test('"Was your truck loaded correctly?": a No with what was wrong is saved and listed; a bare No or a missing answer is refused', async () => {
  const { code } = await newRouteCode(db(), MANAGER);
  const load = (await phoneCall(db(), { code, op: 'loads', driverId: 'drv_test_brook' }, at())).loads[0];
  const send = (fields) => phoneCall(db(), { code, op: 'checkIn', driverId: 'drv_test_brook', runDocId: load.runDocId, day: load.day, requestId: rid(), fields: Object.assign({ casesDelivered: '398' }, fields) }, at(1));
  await assert.rejects(send({ loadedCorrectly: 'NO', loadingProblem: '  ' }), /Write what was loaded wrong/);
  await assert.rejects(send({ loadedCorrectly: 'MAYBE' }), /Was your truck loaded correctly\? Tap Yes or No/);
  await assert.rejects(send({ loadedCorrectly: 'NO', loadingProblem: '=HYPERLINK("x")' }), /Formula-style text is blocked/);
  await send({ loadedCorrectly: 'no', loadingProblem: '2 cs 2% gallon on the wrong stop' });
  let d = await day('801', 'tue');
  assert.deepEqual([d.loadedCorrectly, d.loadingProblem], ['NO', '2 cs 2% gallon on the wrong stop']);
  const runs = (await db().collection('runs').get()).docs.map(x => Object.assign({ id: x.id }, x.data()));
  assert.deepEqual(L.checkinRows(runs, '2026-10-06').find(r => r.route === '801').issues, ['Loaded wrong: 2 cs 2% gallon on the wrong stop']);
  const again = (await phoneCall(db(), { code, op: 'loads', driverId: 'drv_test_brook' }, at(2))).loads[0];
  assert.deepEqual([again.loadedCorrectly, again.loadingProblem], ['NO', '2 cs 2% gallon on the wrong stop'], 'the phone gets the answer back');
  // Yes clears what was written; a Check-In kept on a phone before the question existed (no answer sent) is still taken.
  await send({ loadedCorrectly: 'YES', loadingProblem: 'left over' });
  d = await day('801', 'tue');
  assert.deepEqual([d.loadedCorrectly, d.loadingProblem], ['YES', '']);
  await send({ casesDelivered: '399' });
  assert.equal((await day('801', 'tue')).loadedCorrectly, 'YES', 'an older Check-In with no answer leaves the last answer');
  // Nothing for the Live sheet: the write-back row has no column for it.
  const out = (await db().collection('outbox').get()).docs.map(x => x.data().cells || {});
  assert.ok(out.every(c => !Object.keys(c).some(k => /loaded|loading_problem/.test(k))));
});

// Joe 10/5 (GPS spec): the DVIR odometer fills from GPS. A load's truck carries its latest Verizon Connect Fleet odometer,
// only when Fleet heard from it in the last 2 days.
test('the DVIR odometer starts at the truck\'s GPS odometer when Fleet has a recent reading', async () => {
  const { code } = await newRouteCode(db(), MANAGER);
  await db().collection('gpsTrucks').doc('900002').set({ tag: '900002', odometerMiles: 412358.6, lastReport: '2026-10-07T00:40:00.000Z' });
  await db().collection('gpsTrucks').doc('900001').set({ tag: '900001', odometerMiles: 98000.2, lastReport: '2026-10-06T22:00:00.000Z' });
  const r = await phoneCall(db(), { code, op: 'loads', driverId: 'drv_test_brook' }, at());
  let load = r.loads[0];
  assert.equal(load.truck, '900002');
  assert.deepEqual(load.gpsOdometer, { miles: 412359, at: '2026-10-07T00:40:00.000Z' });
  // Joe 10/13: "according to what truck is entered": every truck on the list comes with its reading, so a typed truck fills too.
  assert.deepEqual(r.gpsOdometers, { 900001: 98000, 900002: 412359 });
  await db().collection('gpsTrucks').doc('900002').set({ tag: '900002', odometerMiles: 412358.6, lastReport: '2026-10-04T00:40:00.000Z' });
  load = (await phoneCall(db(), { code, op: 'loads', driverId: 'drv_test_brook' }, at())).loads[0];
  assert.equal(load.gpsOdometer, undefined, 'a reading 3 days old is not offered');
});
