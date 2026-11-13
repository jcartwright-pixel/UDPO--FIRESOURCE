// Joe 11-13-26 (mock-up ll): Move Stops for This Week on Route Week Override. Made-up customers only.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../../src/holiday-stops');
const { stopsWithWeeks, lastWeeks } = require('../../src/weekstops');

const S = (route, account, customer, day, weeks) => ({ route, account, customer, day, weeks });
const runsFrom = (map) => (r, p) => (map[r] || []).indexOf(p) >= 0;
const one = (list, account, day) => list.find(c => c.account === account && c.fromDay === day);

test('a stop on a day its route does not run moves to the nearest day the route runs, the day before first', () => {
  const stops = [S('901', '11', 'SAMPLE GROCERY', 'mon', [90, 90, 90]), S('901', '11', 'SAMPLE GROCERY', 'thu', [90, 90, 90])];
  const out = H.plan(stops, runsFrom({ 901: ['mon', 'wed', 'fri'] }), {});
  assert.equal(out.length, 1);
  assert.deepEqual([one(out, '11', 'thu').kind, one(out, '11', 'thu').toRoute, one(out, '11', 'thu').toDay], ['move', '901', 'wed']);
});

test('3 deliveries go down to 2 only under Joe\'s number, and the cut day\'s cases ride on the nearest delivery', () => {
  const low = [S('902', '21', 'SAMPLE MART', 'mon', [10, 10, 10]), S('902', '21', 'SAMPLE MART', 'wed', [5, 5, 5]), S('902', '21', 'SAMPLE MART', 'fri', [10, 10, 10])];
  const out = H.plan(low, runsFrom({ 902: ['mon', 'wed', 'fri'] }), { cutTo2Under: 60 });
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].fromDay, out[0].kind, out[0].toDay], ['wed', 'cut', 'mon']);
  assert.equal(H.deliveries(low, out)['902|mon|21'].cases, 15);
  // Over the number: all 3 stay.
  assert.deepEqual(H.plan(low, runsFrom({ 902: ['mon', 'wed', 'fri'] }), { cutTo2Under: 20 }), []);
});

test('2 deliveries go down to 1 under the second number; never past the most on one delivery', () => {
  const two = [S('903', '31', 'SAMPLE FOODS', 'tue', [12, 12, 12]), S('903', '31', 'SAMPLE FOODS', 'fri', [10, 10, 10])];
  const runs = runsFrom({ 903: ['tue', 'fri'] });
  assert.deepEqual(H.plan(two, runs, { cutTo1Under: 30 }).map(c => [c.fromDay, c.toDay]), [['fri', 'tue']]);
  assert.deepEqual(H.plan(two, runs, { cutTo1Under: 30, maxPerDelivery: 20 }), []);
});

test('no cases or very few in the last 3 weeks: no delivery this week (a seasonal stop)', () => {
  const stops = [S('904', '41', 'SAMPLE CONE SHOP', 'mon', [0, 0, 1]), S('904', '41', 'SAMPLE CONE SHOP', 'thu', [])];
  const out = H.plan(stops, runsFrom({ 904: ['mon', 'thu'] }), { skipUnder: 3 });
  assert.deepEqual(out.map(c => [c.fromDay, c.kind, c.toDay]), [['mon', 'skip', ''], ['thu', 'skip', '']]);
  assert.equal(H.plan(stops, runsFrom({ 904: ['mon', 'thu'] }), { skipUnder: 0, cutTo1Under: 0 }).length, 0);
});

test('every case still goes out: a lost day joins when no free day runs', () => {
  const stops = [S('905', '51', 'SAMPLE DELI', 'mon', [40, 40, 40]), S('905', '51', 'SAMPLE DELI', 'thu', [30, 30, 30])];
  const out = H.plan(stops, runsFrom({ 905: ['mon'] }), { maxPerDelivery: 50, cutTo1Under: 0, cutTo2Under: 0 });
  assert.deepEqual([out[0].fromDay, out[0].kind, out[0].toDay], ['thu', 'join', 'mon']);
  assert.match(out[0].why, /Over 50 cases/);
  const total = (d) => Object.keys(d).reduce((a, k) => a + d[k].cases, 0);
  assert.equal(total(H.deliveries(stops, out)), total(H.deliveries(stops, [])));
});

test('the rules: starting numbers, and a saved change list is checked', () => {
  assert.deepEqual(H.rules({ skipUnder: '5', cutTo2Under: -1 }), { skipUnder: 5, cutTo2Under: H.DEFAULT_RULES.cutTo2Under, cutTo1Under: H.DEFAULT_RULES.cutTo1Under, maxPerDelivery: H.DEFAULT_RULES.maxPerDelivery });
  assert.equal(H.cleanChanges([{ route: '901', account: '1', fromDay: 'xyz' }]), null);
  assert.equal(H.cleanChanges([{ route: '901', account: '1', fromDay: 'mon', toDay: 'tue' }]), null);
  assert.deepEqual(H.cleanChanges([{ route: '901_1', account: '1', customer: 'X', fromDay: 'mon', toRoute: '907', toDay: 'tue', kind: 'hand' }]).map(c => [c.route, c.toRoute, c.toDay, c.kind]), [['901', '907', 'tue', 'hand']]);
});

test('the server joins the Hub\'s stops to the last 3 weekly route reports, newest first', () => {
  const weeks = lastWeeks([{ week_ending: '2026-11-07', stops: [{ route: 901, customer_no: 11, mon: 7, thu: 3 }] }, { week_ending: '2026-10-31', stops: [{ route: 901, customer_no: 11, mon: 5 }] },
    { week_ending: '2026-10-24', stops: [] }, { week_ending: '2026-10-17', stops: [] }, { week_ending: '2026-11-28', stops: [] }], '2026-11-22', 3);
  assert.deepEqual(weeks.map(w => w.week_ending), ['2026-11-07', '2026-10-31', '2026-10-24']);
  const out = stopsWithWeeks([{ route: '901', dayName: 'MON', day: 1, stop: 1, account: '11', customer: 'SAMPLE GROCERY' }, { route: '901', dayName: 'THU', day: 4, stop: 2, account: '11', customer: 'SAMPLE GROCERY' }], weeks);
  assert.deepEqual(out.map(s => [s.day, s.weeks]), [['mon', [7, 5, 0]], ['thu', [3, 0, 0]]]);
});
