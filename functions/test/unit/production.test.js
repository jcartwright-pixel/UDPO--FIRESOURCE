'use strict';
// Plant Production (Joe 10/11): targets, shifts, speed range and code dates shared by the line tablet, the TV and the server.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const P = require('../../src/production-rules');

test('the screens use the same production rules as the server', () => {
  assert.equal(fs.readFileSync(path.join(__dirname, '../../src/production-rules.js'), 'utf8'), fs.readFileSync(path.join(__dirname, '../../../public/js/production-rules.js'), 'utf8'));
});

test('target per hour is full speed x 60 x Target % (RedZone Broughton 2% Gallon: 74 a minute at 57.3% = 2,544)', () => {
  assert.equal(P.targetPerHour({ ratePerMin: 74, targetPct: 57.3 }), 2544);
  assert.equal(P.targetPerHour({ ratePerMin: 74 }), 0);
  const [t] = P.targetsFor([{ name: 'GV 2% Gallon', sku: '280305', ratePerMin: '74', targetPct: '64.37', minSpeed: '60', maxSpeed: 80, upc: ' 0123 ', shelfLifeDays: 14 }, { name: '' }]);
  assert.deepEqual([t.perHour, t.minSpeed, t.maxSpeed, t.upc, t.shelfLifeDays], [2858, 60, 80, '0123', 14]);
});

test('the shift is the Plant Production shift running now; no Production shifts means the Distribution ones, then Uniontown\'s', () => {
  const at = (h, m) => new Date(2026, 9, 11, h, m).getTime();
  assert.equal(P.shiftNow([], at(11, 40)).name, 'First Shift');
  assert.equal(P.shiftNow([], at(14, 10)).name, 'Second Shift', 'the newer of two overlapping shifts');
  const night = P.shiftNow([], at(2, 0));
  assert.equal(night.name, 'Third Shift');
  assert.equal(night.date, '2026-10-10', 'a night shift belongs to the day it started');
  const saved = [{ name: 'Days', start: '07:00', end: '15:30', side: 'PRODUCTION' }, { name: 'First Shift', start: '06:00', end: '14:30', side: 'DISTRIBUTION' }];
  assert.equal(P.shiftNow(saved, at(6, 30)).name, 'Today', 'only Production shifts count once there are some');
  assert.equal(P.shiftNow(saved, at(8, 0)).key, '2026-10-11_days');
  assert.equal(P.shiftHours(saved), 8.5);
});

test('target so far follows each product run; made vs target picks the color; stops add up', () => {
  const t = P.targetsFor([{ name: 'A', ratePerMin: 60, targetPct: 50 }, { name: 'B', ratePerMin: 120, targetPct: 50 }]);
  const run = { date: '2026-10-11', shiftEnd: '2026-10-11T18:30:00Z', product: 'B', count: 5000,
    runs: [{ product: 'A', from: '2026-10-11T10:00:00Z' }, { product: 'B', from: '2026-10-11T11:00:00Z' }],
    stops: [{ start: '2026-10-11T10:30:00Z', end: '2026-10-11T10:40:00Z', reason: '' }],
    counts: [{ at: '2026-10-11T11:00:00Z', count: 1000 }, { at: '2026-10-11T11:30:00Z', count: 2800 }, { at: '2026-10-11T11:30:30Z', count: 2810 }] };
  const now = Date.parse('2026-10-11T12:00:00Z'), x = P.lineNow(run, t, now);
  assert.equal(x.soFar, 1800 + 3600);
  assert.equal(x.pct, 93);
  assert.equal(x.color, 'a');
  assert.equal(x.downMin, 10);
  assert.deepEqual(x.needReason.map(s => s.index), [0]);
  assert.equal(x.speed, 59, 'per minute from the last count back to one a minute or more before it (1,810 in 30.5 minutes)');
  const stopped = P.lineNow(Object.assign({}, run, { stops: [{ start: '2026-10-11T11:54:00Z', end: null }] }), t, now);
  assert.deepEqual([stopped.state, stopped.color, stopped.stoppedMin, stopped.speed], ['STOPPED', 'r', 6, 0]);
  assert.equal(P.lineNow(null, t, now).color, 'x');
});

test('Joe 10/11: speed flashes over or under the product\'s range; the code date is the day plus shelf life', () => {
  const r = { minSpeed: 60, maxSpeed: 80 };
  assert.equal(P.speedFlag(85, r), 'OVER');
  assert.equal(P.speedFlag(50, r), 'UNDER');
  assert.equal(P.speedFlag(70, r), 'OK');
  assert.equal(P.speedFlag(70, {}), '');
  assert.equal(P.speedFlag(null, r), '');
  assert.equal(P.codeDate('2026-10-11', 14), 'OCT 25');
  assert.equal(P.codeDate('2026-12-25', 10), 'JAN 04');
  assert.equal(P.codeDate('2026-10-11', ''), '');
});
