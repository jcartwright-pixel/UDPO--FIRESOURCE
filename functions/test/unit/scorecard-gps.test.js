'use strict';
// Joe 10/13: the Driver Scorecard scores the TRUCK plus the driver Daily Dispatch put in it that day, on Verizon Connect Fleet GPS.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../src/sc-core');

const DAY = '2026-10-14';
const run = (o) => Object.assign({ runId: 'r1', route: '855', run: 'SAL', runs: 'TRUE', driver: 'ADAMS, PAT', driverId: 'd1', casesOut: 500, plantCaseReturn: 500, truck: '223893', startTime: '05:00' }, o);
const checkedIn = (route, run) => ({ eventType: 'ROUTE_CHECKIN', payload: { route, run } });
const dvir = (route, run) => ({ eventType: 'DVIR', payload: { route, run, checks: [] } });

test('GPS starting weights: speeding 2, hard stop 2, hard start 1, idling 1, at most 10 a day; Settings can change each', () => {
  const s = S.scSettings_({});
  assert.deepEqual([s.speeding, s.hardBrake, s.hardAccel, s.idle, s.gpsDayCap], [2, 2, 1, 1, 10]);
  assert.equal(S.scSettings_({ speeding: 5 }).speeding, 5);
  assert.equal(S.scSettings_({ speeding: 'abc' }).speeding, 2, 'a typo falls back to the starting weight');
  ['speeding', 'hardBrake', 'hardAccel', 'idle', 'gpsDayCap'].forEach(k => assert.ok(S.SC_CORE.NUMBER_SETTINGS.includes(k), k + ' saves like the other numbers'));
});

test('alerts go to the driver Daily Dispatch put in that truck, not the driver Fleet shows; a truck with no driver is kept', () => {
  const days = S.scBuildDay_(DAY, [run({}), run({ runId: 'r2', route: '856', run: 'BEL', driver: 'BAKER, LEE', driverId: 'd2', truck: '223 894' })],
    [checkedIn('855', 'SAL'), checkedIn('856', 'BEL'), dvir('855', 'SAL'), dvir('856', 'BEL')], {});
  const alerts = [
    { tag: '223893', at: '2026-10-14T14:10:00Z', type: 'SPEEDING', speedMph: 72, limitMph: 55, driver: 'SOMEBODY ELSE' },
    { tag: '223894', at: '2026-10-14T15:00:00Z', type: 'Harsh Braking' },
    { tag: '223894', at: '2026-10-14T15:30:00Z', type: 'HARSH_ACCEL' },
    { tag: '223894', at: '2026-10-14T16:00:00Z', type: 'IDLE', minutes: 25 },
    { tag: '229999', at: '2026-10-14T13:00:00Z', type: 'SPEEDING', speedMph: 70, limitMph: 55 },
    { tag: '223893', at: '2026-10-14T13:00:00Z', type: 'FAULT_CODE' }
  ];
  const m = S.scMatchGps_(DAY, days, [{ tag: '223893', miles: 182.4, yardOut: '2026-10-14T09:40:00Z', yardIn: '2026-10-14T19:05:00Z', fuelGallons: 26 }], alerts);
  const pat = m.records.find(r => r.driver === 'ADAMS, PAT'), lee = m.records.find(r => r.driver === 'BAKER, LEE');
  assert.deepEqual(pat.alerts, { speeding: 1, hardBrake: 0, hardAccel: 0, idle: 0 }, 'the fault code is not scored');
  assert.deepEqual(lee.alerts, { speeding: 0, hardBrake: 1, hardAccel: 1, idle: 1 }, '"223 894" on Daily Dispatch is Fleet unit 223894');
  assert.equal(pat.gpsMiles, 182.4);
  assert.equal(S.scClock_(pat.yardOut), '5:40 AM', 'yard leave in New York time');
  assert.equal(S.scClock_(pat.yardIn), '3:05 PM');
  assert.deepEqual(m.unassigned.map(u => [u.truck, u.counts.speeding]), [['229999', 1]], 'No driver dispatched: kept for a manager');

  const rows = S.scScoreMonth_(m.records, [], S.scSettings_({}), {});
  const p = rows.find(r => r.driver === 'ADAMS, PAT'), l = rows.find(r => r.driver === 'BAKER, LEE');
  assert.equal(p.score, 98, 'one speeding alert costs 2');
  assert.equal(l.score, 100 - 2 - 1 - 1, 'hard stop 2, hard start 1, idling 1');
  assert.equal(l.idleMinutes, 25, 'idle time from the IDLE alerts\' minutes until Fleet sends a day total');
  assert.equal(p.truck, '223893');
  assert.equal(p.mpg, 7, '182.4 miles on 26 gallons');
  assert.match(p.misses.map(x => x.what).join(' | '), /Speeding \(72 mph in a 55, 10:10 AM, truck 223893\)/);
});

test('a day\'s GPS points stop at the cap; each alert past it shows 0 points', () => {
  const days = S.scBuildDay_(DAY, [run({})], [checkedIn('855', 'SAL'), dvir('855', 'SAL')], {});
  const alerts = Array.from({ length: 7 }, (_, i) => ({ tag: '223893', at: '2026-10-14T1' + i + ':00:00Z', type: 'SPEEDING' }));
  const m = S.scMatchGps_(DAY, days, [], alerts);
  const r = S.scScoreMonth_(m.records, [], S.scSettings_({}), {})[0];
  assert.equal(r.speeding, 7);
  assert.equal(r.score, 90, '7 x 2 = 14, capped at 10');
  assert.deepEqual(r.misses.map(x => x.points), [2, 2, 2, 2, 2, 0, 0]);
  assert.equal(S.scScoreMonth_(m.records, [], S.scSettings_({ gpsDayCap: 0 }), {})[0].score, 86, 'cap 0 = no cap');
});

test('one truck, two dispatched runs: each alert goes to the run that had started; miles to the first run', () => {
  const days = S.scBuildDay_(DAY, [run({ startTime: '13:00', runId: 'r2', route: '857', run: 'PM', driver: 'BAKER, LEE', driverId: 'd2' }), run({})], [], {});
  const m = S.scMatchGps_(DAY, days, [{ tag: '223893', miles: 300 }], [
    { tag: '223893', at: '2026-10-14T12:00:00Z', type: 'SPEEDING' },   // 8:00 AM: the 5:00 run
    { tag: '223893', at: '2026-10-14T18:00:00Z', type: 'SPEEDING' }]); // 2:00 PM: the 1:00 PM run
  const pat = m.records.find(r => r.driver === 'ADAMS, PAT'), lee = m.records.find(r => r.driver === 'BAKER, LEE');
  assert.equal(pat.alerts.speeding, 1);
  assert.equal(lee.alerts.speeding, 1);
  assert.equal(pat.gpsMiles, 300);
  assert.equal(lee.gpsMiles, undefined);
});

test('before yard places are sent, the first and last move stand in for yard leave and return', () => {
  const days = S.scBuildDay_(DAY, [run({})], [], {});
  const m = S.scMatchGps_(DAY, days, [{ tag: '223893', miles: 10, firstMove: '2026-10-14T10:00:00Z', lastMove: '2026-10-14T20:30:00Z' }], []);
  assert.equal(S.scClock_(m.records[0].yardOut), '6:00 AM');
  assert.equal(m.records[0].yardFromMoves, true);
  const r = S.scScoreMonth_(m.records, [], S.scSettings_({}), {})[0];
  assert.equal(S.scClock_(r.yardIn), '4:30 PM');
  assert.equal(r.mpg, null, 'no fuel yet, no MPG');
});

test('weeks run Sunday to Saturday; the year adds up GPS counts', () => {
  assert.deepEqual(S.scWeekRange_('2026-10-14'), { start: '2026-10-11', end: '2026-10-17' });
  assert.deepEqual(S.scWeekRange_('2026-10-11'), { start: '2026-10-11', end: '2026-10-17' });
  const days = S.scBuildDay_(DAY, [run({})], [], {});
  const m = S.scMatchGps_(DAY, days, [{ tag: '223893', miles: 100, mpg: 8 }], [{ tag: '223893', at: '2026-10-14T12:00:00Z', type: 'SPEEDING' }]);
  const s = S.scSettings_({}), month = S.scScoreMonth_(m.records, [], s, {});
  const year = S.scScoreYear_([{ month: 10, rows: month }, { month: 11, rows: month }], s);
  assert.equal(year[0].speeding, 2);
  assert.equal(year[0].gpsMiles, 200);
  assert.equal(year[0].mpg, 8);
});

test('no GPS at all leaves the old scoring exactly as it was', () => {
  const days = S.scBuildDay_('2026-10-05', [run({ casesOut: 500, plantCaseReturn: 497, truck: '' })], [], {});
  const rows = S.scScoreMonth_(days, [], S.scSettings_({}), {});
  assert.equal(rows[0].score, 100 - 4 - 3);
  assert.equal(rows[0].speeding, 0);
  assert.equal(rows[0].mpg, null);
});

test('Joe 10/13: one grade per area and the overall score; each area is 100 less what it cost', () => {
  const days = S.scBuildDay_(DAY, [run({ casesOut: 500, plantCaseReturn: 497 })], [dvir('855', 'SAL')], {});
  const m = S.scMatchGps_(DAY, days, [], [{ tag: '223893', at: '2026-10-14T12:00:00Z', type: 'SPEEDING' }, { tag: '223893', at: '2026-10-14T13:00:00Z', type: 'HARSH_ACCEL' }]);
  const r = S.scScoreMonth_(m.records, [], S.scSettings_({}), {})[0];
  assert.deepEqual(S.SC_CORE.AREAS.map(a => a[0]), ['checkin', 'cases', 'inspection', 'attendance', 'speeding', 'hardStops', 'idling', 'time']);
  assert.deepEqual(Object.fromEntries(Object.entries(r.areas).map(([k, v]) => [k, v.score])),
    { checkin: 96, cases: 97, inspection: 100, attendance: 100, speeding: 98, hardStops: 99, idling: 100, time: 100 });
  assert.equal(r.score, 100 - 4 - 3 - 2 - 1, 'the overall adds up every area');
  assert.equal(r.areas.checkin.grade, 'A');
  const year = S.scScoreYear_([{ month: 10, rows: [r] }], S.scSettings_({}));
  assert.equal(year[0].areas.speeding.score, 98);
});

test('Joe 10/13 Time grade: out more than 15 min before dispatch, or back more than 30 min past dispatch + route hours, costs 1 each', () => {
  assert.deepEqual([S.scMinutesOf_('06:00'), S.scMinutesOf_('5:30 PM'), S.scMinutesOf_(330), S.scMinutesOf_('')], [360, 1050, 330, null]);
  assert.deepEqual([S.scHoursOf_('9:30'), S.scHoursOf_('8'), S.scHoursOf_('')], [9.5, 8, null]);
  const day = (dispatchTime, routeHours, yardOut, yardIn) => {
    const days = S.scBuildDay_(DAY, [run({ dispatchTime, routeHours })], [checkedIn('855', 'SAL'), dvir('855', 'SAL')], {});
    return S.scMatchGps_(DAY, days, [{ tag: '223893', miles: 100, yardOut, yardIn }], []).records;
  };
  // Dispatch 6:00 AM, 8 hours: due back 2:00 PM. Out 5:30 AM (30 early), back 3:00 PM (60 late).
  let r = S.scScoreMonth_(day('06:00', 8, '2026-10-14T09:30:00Z', '2026-10-14T19:00:00Z'), [], S.scSettings_({}), {})[0];
  assert.deepEqual([r.leftEarly, r.backLate, r.areas.time.score, r.score], [1, 1, 98, 98]);
  assert.match(r.misses.map(m => m.what).join(' | '), /Left the yard 5:30 AM, 30 min before dispatch 6:00 AM \| Back at the yard 3:00 PM, 60 min past the expected 2:00 PM/);
  // Out 5:50 (10 early) and back 2:20 PM (20 late): inside the grace, nothing.
  r = S.scScoreMonth_(day('06:00', 8, '2026-10-14T09:50:00Z', '2026-10-14T18:20:00Z'), [], S.scSettings_({}), {})[0];
  assert.deepEqual([r.leftEarly, r.backLate, r.areas.time.score], [0, 0, 100]);
  // No GPS yard time, or no dispatch time: not scored, not held against the driver.
  r = S.scScoreMonth_(day('06:00', 8, '', ''), [], S.scSettings_({}), {})[0];
  assert.equal(r.areas.time.score, 100);
  r = S.scScoreMonth_(day('', 8, '2026-10-14T08:00:00Z', '2026-10-14T23:00:00Z'), [], S.scSettings_({}), {})[0];
  assert.equal(r.areas.time.score, 100);
  // The minutes and points come from Settings.
  r = S.scScoreMonth_(day('06:00', 8, '2026-10-14T09:30:00Z', '2026-10-14T19:00:00Z'), [], S.scSettings_({ earlyMinutes: 45, lateMinutes: 30, backLate: 3 }), {})[0];
  assert.deepEqual([r.leftEarly, r.backLate, r.score], [0, 1, 97]);
});
