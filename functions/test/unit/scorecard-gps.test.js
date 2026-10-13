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
  assert.deepEqual(pat.alerts, { speeding: 1, hardBrake: 0, hardAccel: 0, idle: 0, seatbelt: 0 }, 'the fault code is not scored');
  assert.deepEqual(lee.alerts, { speeding: 0, hardBrake: 1, hardAccel: 1, idle: 1, seatbelt: 0 }, '"223 894" on Daily Dispatch is Fleet unit 223894');
  assert.equal(pat.gpsMiles, 182.4);
  assert.equal(S.scClock_(pat.yardOut), '5:40 AM', 'yard leave in New York time');
  assert.equal(S.scClock_(pat.yardIn), '3:05 PM');
  assert.deepEqual(m.unassigned.map(u => [u.truck, u.counts.speeding]), [['229999', 1]], 'No driver dispatched: kept for a manager');

  const rows = S.scScoreMonth_(m.records, [], S.scSettings_({}), {});
  const p = rows.find(r => r.driver === 'ADAMS, PAT'), l = rows.find(r => r.driver === 'BAKER, LEE');
  assert.equal(p.areas.speeding.points, -2, 'one speeding alert costs 2');
  assert.deepEqual([p.areas.hardStops.points, p.areas.idling.points], [1, 1], 'a clean day earns 1');
  assert.deepEqual([l.areas.hardStops.points, l.areas.idling.points, l.areas.speeding.points], [-3, -1, 1], 'hard stop 2 + hard start 1, idling 1');
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
  assert.equal(r.areas.speeding.points, -10, '7 x 2 = 14, capped at 10');
  assert.deepEqual(r.misses.filter(x => x.area === 'speeding').map(x => x.points), [2, 2, 2, 2, 2, 0, 0]);
  assert.equal(S.scScoreMonth_(m.records, [], S.scSettings_({ gpsDayCap: 0 }), {})[0].areas.speeding.points, -14, 'cap 0 = no cap');
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
  assert.deepEqual([rows[0].areas.checkin.points, rows[0].areas.cases.points], [-4, -3]);
  assert.equal(rows[0].areas.speeding.score, null, 'no GPS that day: driving is not graded');
  assert.equal(rows[0].speeding, 0);
  assert.equal(rows[0].mpg, null);
});

test('Joe 10/13: one grade per area and the overall score; each area is 100 less what it cost', () => {
  const days = S.scBuildDay_(DAY, [run({ casesOut: 500, plantCaseReturn: 497 })], [dvir('855', 'SAL')], {});
  const m = S.scMatchGps_(DAY, days, [], [{ tag: '223893', at: '2026-10-14T12:00:00Z', type: 'SPEEDING' }, { tag: '223893', at: '2026-10-14T13:00:00Z', type: 'HARSH_ACCEL' }]);
  const r = S.scScoreMonth_(m.records, [], S.scSettings_({}), {})[0];
  assert.deepEqual(S.SC_CORE.AREAS.map(a => a[0]), ['checkin', 'cases', 'inspection', 'attendance', 'speeding', 'hardStops', 'idling', 'seatbelt', 'fuel', 'time', 'cleanliness', 'accidents', 'complaints', 'pda']);
  assert.deepEqual(Object.fromEntries(Object.entries(r.areas).map(([k, v]) => [k, v.points])),
    { checkin: -4, cases: -3, inspection: 1, attendance: 1, speeding: -2, hardStops: -1, idling: 1, seatbelt: 0, fuel: 0, time: 0, cleanliness: 0, accidents: 0, complaints: 0, pda: 0 });
  assert.equal(r.areas.time.score, null, 'no dispatch time: Time is not graded');
  assert.equal(r.points, -7, 'the day\'s points add up');
  // One day: 80 + 20 x points per day, at most 100.
  assert.deepEqual([r.areas.checkin.score, r.areas.inspection.score, r.areas.speeding.score], [0, 100, 40]);
  assert.equal(r.score, Math.round((0 + 20 + 100 + 100 + 40 + 60 + 100) / 7), 'overall = the average of the graded areas');
  const year = S.scScoreYear_([{ month: 10, rows: [r] }], S.scSettings_({}));
  assert.equal(year[0].areas.speeding.score, 40);
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
  assert.deepEqual([r.leftEarly, r.backLate, r.areas.time.points], [1, 1, -2]);
  assert.match(r.misses.map(m => m.what).join(' | '), /Left the yard 5:30 AM, 30 min before dispatch 6:00 AM \| Back at the yard 3:00 PM, 60 min past the expected 2:00 PM/);
  // Out 5:50 (10 early) and back 2:20 PM (20 late): inside the grace, nothing.
  r = S.scScoreMonth_(day('06:00', 8, '2026-10-14T09:50:00Z', '2026-10-14T18:20:00Z'), [], S.scSettings_({}), {})[0];
  assert.deepEqual([r.leftEarly, r.backLate, r.areas.time.points], [0, 0, 1], 'a clean Time day earns 1');
  // No GPS yard time, or no dispatch time: not scored, not held against the driver.
  r = S.scScoreMonth_(day('06:00', 8, '', ''), [], S.scSettings_({}), {})[0];
  assert.deepEqual([r.areas.time.days, r.areas.time.score], [0, null]);
  r = S.scScoreMonth_(day('', 8, '2026-10-14T08:00:00Z', '2026-10-14T23:00:00Z'), [], S.scSettings_({}), {})[0];
  assert.deepEqual([r.areas.time.days, r.areas.time.score], [0, null]);
  // The minutes and points come from Settings.
  r = S.scScoreMonth_(day('06:00', 8, '2026-10-14T09:30:00Z', '2026-10-14T19:00:00Z'), [], S.scSettings_({ earlyMinutes: 45, lateMinutes: 30, backLate: 3 }), {})[0];
  assert.deepEqual([r.leftEarly, r.backLate, r.areas.time.points], [0, 1, -3]);
});

test('Joe 10/13 rewards: clean days earn 1, five in a row earn 2 more; back early (not out early) earns 1; grades go by points per day', () => {
  const s = S.scSettings_({});
  assert.deepEqual([s.cleanDay, s.streakDays, s.streakBonus, s.backEarly, s.backEarlyMinutes], [1, 5, 2, 1, 15]);
  const dates = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'];
  let recs = [];
  dates.forEach((date, i) => {
    const d = S.scBuildDay_(date, [run({ dispatchTime: '06:00', routeHours: 8 })], [i === 5 ? { eventType: 'X', payload: {} } : checkedIn('855', 'SAL'), dvir('855', 'SAL')], {});
    // Out 5:55, back 1:30 PM: 30 min before the expected 2:00 PM.
    recs = recs.concat(S.scMatchGps_(date, d, [{ tag: '223893', miles: 100, yardOut: date + 'T09:55:00Z', yardIn: date + 'T17:30:00Z' }], []).records);
  });
  const r = S.scScoreMonth_(recs, [], s, {})[0];
  assert.deepEqual([r.areas.checkin.clean, r.areas.checkin.streaks, r.areas.checkin.points], [5, 1, 5 + 2 - 4], 'five clean check-ins, a streak, then a miss');
  assert.deepEqual([r.areas.time.points, r.areas.time.extra], [6 + 2 + 6, 6], '6 clean days, a streak, and 6 early returns');
  assert.equal(r.areas.speeding.score, 100, 'clean every day is 100');
  assert.equal(r.areas.checkin.score, Math.round(80 + 20 * 3 / 6), 'points per day, not total');
  // Not rewarded for coming back early when they also left early.
  const early = S.scMatchGps_(DAY, S.scBuildDay_(DAY, [run({ dispatchTime: '06:00', routeHours: 8 })], [], {}),
    [{ tag: '223893', miles: 100, yardOut: DAY + 'T09:00:00Z', yardIn: DAY + 'T17:00:00Z' }], []).records;
  const e = S.scScoreMonth_(early, [], s, {})[0];
  assert.deepEqual([e.leftEarly, e.areas.time.extra || 0, e.areas.time.points], [1, 0, -1]);
  // Until Fleet alerts come in, driving areas are not graded (no free rewards).
  assert.equal(S.scScoreMonth_(recs, [], s, {}, { alertsOn: false })[0].areas.speeding.score, null);
});

test('Joe 10/13 truck cleanliness: rated 1 to 5 about once a month; counts only when rated; has an On/Off switch', () => {
  const s = S.scSettings_({});
  assert.deepEqual([s.cleanOn, s.clean5, s.clean4, s.clean3, s.clean2Off, s.clean1Off], [1, 2, 1, 0, 1, 2]);
  const recs = S.scBuildDay_(DAY, [run({})], [checkedIn('855', 'SAL'), dvir('855', 'SAL')], {});
  const none = S.scScoreMonth_(recs, [], s, {})[0];
  assert.equal(none.areas.cleanliness.score, null, 'no rating this period: no grade, the overall is not touched');
  const rated = (rating, settings) => S.scScoreMonth_(recs, [], settings || s, {}, { ratings: [{ driverKey: 'D1', date: DAY, rating, truck: '223893', note: 'cab full of trash' }] })[0];
  assert.deepEqual([5, 4, 3, 2, 1].map(n => rated(n).areas.cleanliness.score), [100, 90, 80, 70, 60]);
  assert.deepEqual([rated(5).areas.cleanliness.points, rated(1).areas.cleanliness.points], [2, -2]);
  assert.match(rated(1).misses.map(m => m.what).join(' | '), /Truck cleanliness 1 of 5 \(truck 223893\): cab full of trash/);
  assert.notEqual(rated(1).score, none.score, 'a rating moves the overall');
  assert.equal(rated(1, S.scSettings_({ cleanOn: 0 })).areas.cleanliness.score, null, 'switched off: not graded');
});

test('Joe 10/13 sleepers: an idling alert on a sleeper route costs a quarter of the day-cab points (Settings); seatbelt counts once reported', () => {
  const s = S.scSettings_({});
  assert.deepEqual([s.sleeperIdlePct, s.seatbelt], [25, 3]);
  const one = (sleeper, extra) => {
    const d = S.scBuildDay_(DAY, [run({ sleeper: sleeper ? 'TRUE' : '' })], [checkedIn('855', 'SAL'), dvir('855', 'SAL')], {});
    return S.scMatchGps_(DAY, d, [{ tag: '223893', miles: 300 }], [{ tag: '223893', at: DAY + 'T14:00:00Z', type: 'IDLE', minutes: 40 }].concat(extra || [])).records;
  };
  const cab = S.scScoreMonth_(one(false), [], s, {})[0], sl = S.scScoreMonth_(one(true), [], s, {})[0];
  assert.deepEqual([cab.areas.idling.points, sl.areas.idling.points], [-1, -0.25]);
  assert.match(sl.misses.find(m => m.area === 'idling').what, /sleeper/);
  assert.equal(S.scScoreMonth_(one(true), [], S.scSettings_({ sleeperIdlePct: 50 }), {})[0].areas.idling.points, -0.5);
  // Seatbelt: not graded until seatbelt alerts arrive.
  assert.equal(S.scAlertKind_('SEATBELT'), 'seatbelt');
  const belt = one(false, [{ tag: '223893', at: DAY + 'T15:00:00Z', type: 'SEATBELT' }]);
  assert.equal(S.scScoreMonth_(belt, [], s, {})[0].areas.seatbelt.score, null);
  const b = S.scScoreMonth_(belt, [], s, {}, { seatbeltOn: true })[0];
  assert.deepEqual([b.seatbelts, b.areas.seatbelt.points], [1, -3]);
});

test('Joe 10/13 fuel economy: graded against the truck\'s own average (or a target) once fuel data comes in', () => {
  const s = S.scSettings_({});
  const day = (date, driver, mpg) => S.scMatchGps_(date, S.scBuildDay_(date, [run({ driver, driverId: driver })], [checkedIn('855', 'SAL'), dvir('855', 'SAL')], {}), [{ tag: '223893', miles: 300, mpg }], []).records;
  const recs = day('2026-10-05', 'A', 7).concat(day('2026-10-06', 'A', 7), day('2026-10-07', 'B', 5));
  const rows = S.scScoreMonth_(recs, [], s, {}), a = rows.find(r => r.driver === 'A'), b = rows.find(r => r.driver === 'B');
  assert.deepEqual([a.areas.fuel.days, a.areas.fuel.lost, b.areas.fuel.lost], [2, 0, 1], 'the truck averages 6.2; 5.0 is more than 10% under');
  assert.match(b.misses.find(m => m.area === 'fuel').what, /MPG 5\.0, below the truck's average 6\.2/);
  assert.equal(S.scScoreMonth_(recs, [], S.scSettings_({ mpgTarget: 8 }), {}).find(r => r.driver === 'A').areas.fuel.lost, 2, 'a target of 8');
  assert.equal(S.scScoreMonth_(day(DAY, 'A', null), [], s, {})[0].areas.fuel.score, null, 'no fuel data: no grade');
});

test('Joe 10/13 accidents and complaints: count only once reviewed as counting; class x 15 and complaints fade with age', () => {
  const s = S.scSettings_({});
  assert.deepEqual([s.accidentBase, s.accident1, s.accident2, s.accident3, s.complaintMinor, s.complaintMajor], [15, 1, 2, 3, 3, 10]);
  const recs = S.scBuildDay_(DAY, [run({})], [checkedIn('855', 'SAL'), dvir('855', 'SAL')], {});
  const acc = (o) => Object.assign({ kind: 'accident', driverKey: 'D1', driver: 'ADAMS, PAT', date: '2026-10-01', accidentClass: 2, status: 'counts' }, o);
  const score = (incidents, on) => S.scScoreMonth_(recs, [], s, {}, Object.assign({ incidents, asOf: DAY, accidentsOn: true, complaintsOn: true }, on))[0];
  assert.deepEqual([score([acc({})]).areas.accidents.lost, score([acc({})]).areas.accidents.score], [30, 70], '2nd degree = 15 x 2');
  assert.equal(score([acc({ accidentClass: 3, date: '2026-06-01' })]).areas.accidents.lost, 33.75, '3rd degree, 4 months old: 45 x 75%');
  assert.equal(score([acc({ date: '2025-09-01' })]).areas.accidents.lost, 0, 'over a year old: gone');
  const pending = score([acc({ status: 'review' })]);
  assert.deepEqual([pending.areas.accidents.lost, pending.pending.length], [0, 1], 'Under review counts nothing but shows');
  assert.equal(score([acc({ status: 'notCounted' })]).pending.length, 0);
  assert.equal(score([acc({})], { accidentsOn: false }).areas.accidents.score, null, 'no entries at all yet: not graded');
  const comp = { kind: 'complaint', driverKey: 'D1', date: '2026-06-20', severity: 'major', status: 'counts', source: 'customer', customer: 'Kroger 512' };
  assert.equal(score([comp]).areas.complaints.lost, 5, 'major, 3-6 months old: 10 x 50%');
  assert.match(score([comp]).misses.find(m => m.area === 'complaints').what, /Customer complaint \(Major\) from Kroger 512/);
});

test('Joe 10/13 call-offs fade over 3 months; earlier ones carry over onto the period', () => {
  const s = S.scSettings_({});
  const recs = S.scBuildDay_(DAY, [run({})], [checkedIn('855', 'SAL'), dvir('855', 'SAL')], {});
  const offs = [{ date: '2026-08-20', driverKey: 'D1', reason: 'SICK DAY' }, { date: '2026-10-02', driverKey: 'D1', reason: 'SICK DAY' }, { date: '2026-06-01', driverKey: 'D1', reason: 'SICK DAY' }];
  const r = S.scScoreMonth_(recs, offs, s, {}, { start: '2026-10-01', asOf: DAY })[0];
  assert.deepEqual(r.misses.filter(m => m.area === 'attendance').map(m => m.points), [1.98, 3], 'August is in its 2nd month (66%); June is gone');
  assert.equal(r.callOffs, 1, 'only October\'s is in the month');
  assert.equal(r.areas.attendance.carried, 1.98);
});

test('Joe 10/13 Excuse: an excused GPS or Time miss costs nothing and keeps the perfect day', () => {
  const s = S.scSettings_({});
  const recs = S.scMatchGps_(DAY, S.scBuildDay_(DAY, [run({})], [checkedIn('855', 'SAL'), dvir('855', 'SAL')], {}), [{ tag: '223893', miles: 300 }],
    [{ tag: '223893', at: DAY + 'T14:00:00Z', type: 'HARSH_BRAKING' }]).records;
  const plain = S.scScoreMonth_(recs, [], s, {})[0], miss = plain.misses.find(m => m.area === 'hardStops');
  assert.equal(miss.key, S.scAlertKey_(DAY, { tag: '223893', at: DAY + 'T14:00:00Z', kind: 'hardBrake' }));
  const ex = S.scScoreMonth_(recs, [], s, {}, { excuses: { [miss.key]: { reason: 'Deer', by: 'manager@uniteddairy.com' } } })[0];
  const m2 = ex.misses.find(m => m.area === 'hardStops');
  assert.deepEqual([m2.points, m2.excused.reason, ex.areas.hardStops.points, ex.hardBrakes], [0, 'Deer', 1, 1]);
});

test('Joe 10/13 PDA: a manager\'s decision (no review); Verbal 5, Written 10, Final 20, Suspension 30; fades 100/66/33 over 9 months', () => {
  const s = S.scSettings_({});
  assert.deepEqual([s.pdaVerbal, s.pdaWritten, s.pdaFinal, s.pdaSuspension, s.pdaFade1, s.pdaFade2, s.pdaFade3], [5, 10, 20, 30, 100, 66, 33]);
  const recs = S.scBuildDay_(DAY, [run({})], [checkedIn('855', 'SAL'), dvir('855', 'SAL')], {});
  const pda = (o) => Object.assign({ kind: 'pda', driverKey: 'D1', driver: 'ADAMS, PAT', date: '2026-10-01', step: 'written', reason: 'Attendance' }, o);
  const score = (list, on) => S.scScoreMonth_(recs, [], s, {}, Object.assign({ incidents: list, asOf: DAY, pdaOn: true }, on))[0];
  assert.deepEqual([score([pda({})]).areas.pda.lost, score([pda({})]).areas.pda.score], [10, 90], 'counts with no review step');
  assert.equal(score([pda({ step: 'suspension', date: '2026-03-01' })]).areas.pda.lost, 9.9, 'suspension, 7 months old: 30 x 33%');
  assert.equal(score([pda({ step: 'final', date: '2026-06-20' })]).areas.pda.lost, 13.2, 'final written, 3-6 months old: 20 x 66%');
  assert.equal(score([pda({ date: '2025-12-01' })]).areas.pda.lost, 0, 'over 9 months old: gone');
  assert.equal(score([pda({})], { pdaOn: false }).areas.pda.score, null, 'no PDAs entered yet: not graded');
  assert.match(score([pda({ note: 'third late start' })]).misses.find(m => m.area === 'pda').what, /PDA: Written warning, Attendance \(third late start\)/);
});
