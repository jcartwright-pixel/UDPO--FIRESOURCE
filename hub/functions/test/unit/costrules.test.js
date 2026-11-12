'use strict';
// The shared cost rules through the Hub (Joe 11-12-26): one record Route Cost and Route & Trip both read. Made-up people only.
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../../src/costrules');
const H = require('../../src/hub');

const rates = { month: '2026-11', basisFrom: '2025-11', basisTo: '2026-10', basisMonths: 12, savedAt: '2026-11-12T01:00:00Z',
  driverBaseWeek: 1400, truckBaseWeek: 975, driverHour: 25.6, driverMile: 0.59, perDiemNight: 45, tiresMile: 0.05, garageMile: 0.66,
  tollMile: 0.02, leaseMile: 0.08, fuelMile: 0.9, mpg: 5, fuelPrice: 4.5 };
const quotes = [{ date: '2026-10-03', b2: 4.0 }, { date: '2026-10-20', b2: 4.4 }, { date: '2026-11-02', b2: 9.9 }, { date: '2026-10-05', b2: 99 }];
const trips = [{ day: '2026-10-04', miles: 600, fuelUsed: 100 }, { day: '2026-10-09', miles: 400, fuelUsed: 100 },
  { day: '2026-10-10', miles: 100, fuelUsed: 1 }, { day: '2026-11-03', miles: 900, fuelUsed: 100 }];

test('diesel and miles a gallon come from the month before, with where they came from', () => {
  const b = K.build({ rates, quotes, trips }, '2026-11');
  assert.equal(b.amounts.fuelPrice.value, 4.2, 'October average, the 99 quote left out, November not used yet');
  assert.match(b.amounts.fuelPrice.from, /10-26, 2 quotes/);
  assert.equal(b.amounts.mpg.value, 5, 'October trips (1000 miles ÷ 200 gallons), the 100 mpg reading left out');
  assert.match(b.amounts.mpg.from, /10-26, 2 trips/);
  assert.equal(b.amounts.fuelMile.value, 0.84);
  assert.equal(b.amounts.fuelTiresMile.value, 0.89);
});

test('stand-ins when there is no fuel or trips, one month further back otherwise', () => {
  const none = K.build({ rates }, '2026-11');
  assert.equal(none.amounts.fuelPrice.value, 4.87); assert.equal(none.amounts.mpg.value, 6.2);
  assert.match(none.amounts.mpg.from, /stand-in/);
  const back = K.build({ rates, quotes: [{ date: '2026-09-10', b2: 4.1 }] }, '2026-11');
  assert.equal(back.amounts.fuelPrice.value, 4.1);
});

test('P&L amounts say which months they come from; the day costs follow the rule set', () => {
  const b = K.build({ rates, routeRules: { driverDaysWeek: 4, dayCabDaysWeek: 5, sleeperRunsWeek: 2, sleeperDayRunsWeek: 1, savedAt: 'x' } }, '2026-11');
  assert.match(b.amounts.driverBaseWeek.from, /12 months 11-25 to 10-26/);
  assert.equal(b.ruleSource, 'routeCost');
  assert.equal(b.each.driverDay.value, 350);
  assert.equal(b.each.dayCabDay.value, 195);
  assert.equal(b.each.sleeperRun.value, 325);
  assert.deepEqual([b.mileRun.firstHours, b.mileRun.perStopHours], [1, 1]);
});

test('a short run pays thirds of a day in every app (Joe 11-12-26); a Hub save wins over Route Cost\'s', () => {
  assert.equal(K.dayShare(0), 0);
  assert.equal(K.dayShare(2), 1 / 3); assert.equal(K.dayShare(4), 1 / 3);
  assert.equal(K.dayShare(4.5), 2 / 3); assert.equal(K.dayShare(8), 2 / 3);
  assert.equal(K.dayShare(8.25), 1); assert.equal(K.dayShare(14), 1);
  const b = K.build({ rates }, '2026-11');
  assert.equal(b.shortRun.steps.length, 3);
  const saved = K.build({ rates, routeRules: { driverDaysWeek: 4 }, saved: { driverDaysWeek: 3 } }, '2026-11');
  assert.equal(saved.ruleSource, 'hub'); assert.equal(saved.rules.driverDaysWeek, 3);
  assert.equal(K.cleanRules({ driverDaysWeek: 99 }).driverDaysWeek, 5);
  assert.equal(K.cleanRules({ hoursDay: '' }).hoursDay, 12);
});

function fakeDb(cols) {
  const docRef = (col, id) => ({ get: async () => ({ exists: !!(cols[col] || {})[id], data: () => cols[col][id] }),
    set: async (v) => { (cols[col] = cols[col] || {})[id] = JSON.parse(JSON.stringify(v)); } });
  return { cols, collection: (col) => ({ doc: (id) => docRef(col, id),
    get: async () => ({ docs: Object.values(cols[col] || {}).map(v => ({ data: () => v })) }),
    select: () => ({ get: async () => ({ docs: Object.values(cols[col] || {}).map(v => ({ data: () => v })) }) }) }) };
}

test('anyone active reads it; only an administrator saves the rule set, and the record is rebuilt at once', async () => {
  const db = fakeDb({ users: { 'pat.admin@uniteddairy.com': { status: 'ACTIVE', roles: ['Administrator'] }, 'sam.driver@uniteddairy.com': { status: 'ACTIVE', roles: ['Driver'] } },
    routeCostRates: { current: rates }, routeCostRules: { current: { driverDaysWeek: 5 } } });
  const read = await H.hubCall(db, { email: 'sam.driver@uniteddairy.com' }, { op: 'costRules' }, {});
  assert.equal(read.ruleSource, 'routeCost');
  await assert.rejects(H.hubCall(db, { email: 'sam.driver@uniteddairy.com' }, { op: 'saveCostRules', rules: { driverDaysWeek: 4 } }, {}), (e) => e.code === 'NOT_ALLOWED');
  await assert.rejects(H.hubCall(db, { email: 'pat.admin@uniteddairy.com' }, { op: 'saveCostRules' }, {}), (e) => e.code === 'BAD_REQUEST');
  const r = await H.hubCall(db, { email: 'pat.admin@uniteddairy.com' }, { op: 'saveCostRules', rules: { driverDaysWeek: 4 }, from: 'route-cost' }, {});
  assert.equal(r.rules.savedBy, 'pat.admin@uniteddairy.com');
  assert.equal(db.cols.hubCostRules.current.ruleSource, 'hub');
  assert.equal(db.cols.hubCostRules.current.each.driverDay.value, 350);
});
