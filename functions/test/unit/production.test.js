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

// Joe 10/14 ("all of your picks", mock-ups A to H): the kind of line, changeovers, CIP, waste, checks, efficiency, each hour and the timeline.
test('Joe 10/14: each line has a kind that picks its waste reasons, checklist and quality check', () => {
  assert.deepEqual(['HTST #1', 'HTST #2', 'BLOW MOLD', 'Boxing', 'RAYPAK', 'Totes', 'GALLON FILLER', 'Old 1/2 Gallon'].map(P.lineKind), ['HTST', 'HTST', 'BLOWMOLD', 'PACK', 'PACK', 'PACK', 'FILLER', 'FILLER']);
  ['FILLER', 'PACK', 'HTST', 'BLOWMOLD'].forEach(k => {
    assert.ok(P.WASTE_REASONS[k].length && P.CHANGEOVER_CHECKS[k].length && P.CHECK_FIELDS[k].length && P.CHECK_EVERY[k], k);
    P.CHANGEOVER_CHECKS[k].forEach(c => assert.match(c[0], /^[a-z]+$/, 'the server takes only lower-case checklist keys'));
    P.CHECK_FIELDS[k].forEach(f => assert.match(f[0], /^[A-Za-z0-9]+$/));
  });
  assert.equal(P.CHECK_EVERY.HTST, 1, 'the HTST chart check is every hour');
});

test('Joe 10/14: a changeover or CIP wash is its own state, not stopped; a stop still wins', () => {
  const t = P.targetsFor([{ name: 'A', ratePerMin: 60, targetPct: 100 }]), now = Date.parse('2026-10-11T12:00:00Z');
  const base = { shiftStart: '2026-10-11T10:00:00Z', shiftEnd: '2026-10-11T18:30:00Z', product: 'A', runs: [{ product: 'A', from: '2026-10-11T10:00:00Z' }], counts: [{ at: '2026-10-11T11:50:00Z', count: 6000 }], stops: [] };
  const co = P.lineMore(Object.assign({}, base, { changeovers: [{ start: '2026-10-11T11:48:00Z', end: null, from: 'A', to: 'B', checks: { purge: { by: 'x' } } }] }), t, now, 'FILLER', { changeoverMin: 20 });
  assert.deepEqual([co.state, co.color, co.changeover.minutes, co.changeover.to, co.changeoverStd], ['CHANGEOVER', 'b', 12, 'B', 20]);
  const cip = P.lineMore(Object.assign({}, base, { cips: [{ start: '2026-10-11T11:30:00Z', end: null }] }), t, now, 'HTST', { lastCipAt: '2026-10-11T01:30:00Z', cipHours: 10 });
  assert.deepEqual([cip.state, cip.color, cip.cip.minutes, cip.sinceCipHours], ['CIP', 'b', 30, null]);
  const since = P.lineMore(base, t, now, 'HTST', { lastCipAt: '2026-10-11T05:30:00Z', cipHours: 10 });
  assert.equal(since.sinceCipHours, 6.5);
  const stopped = P.lineMore(Object.assign({}, base, { stops: [{ start: '2026-10-11T11:55:00Z', end: null }], changeovers: [{ start: '2026-10-11T11:48:00Z', end: null }] }), t, now, 'FILLER', {});
  assert.equal(stopped.state, 'STOPPED');
});

test('Joe 10/14: line efficiency is running time x speed x good product; CIP and breaks are not counted against it', () => {
  const t = P.targetsFor([{ name: 'A', ratePerMin: 100, targetPct: 100 }]), now = Date.parse('2026-10-11T12:00:00Z');
  // 120 minutes from the first product: 20 of CIP and 10 of lunch are not planned; 9 stopped and 9 of changeover are lost.
  const run = { shiftStart: '2026-10-11T10:00:00Z', shiftEnd: '2026-10-11T18:30:00Z', product: 'A', runs: [{ product: 'A', from: '2026-10-11T10:00:00Z' }], count: 7200,
    counts: [{ at: '2026-10-11T12:00:00Z', count: 7200 }],
    stops: [{ start: '2026-10-11T10:30:00Z', end: '2026-10-11T10:39:00Z', reason: 'Filler jam' }, { start: '2026-10-11T11:00:00Z', end: '2026-10-11T11:10:00Z', reason: 'Break / lunch' }],
    cips: [{ start: '2026-10-11T11:20:00Z', end: '2026-10-11T11:40:00Z', result: 'PASS' }], changeovers: [{ start: '2026-10-11T11:40:00Z', end: '2026-10-11T11:49:00Z' }],
    waste: { Leaker: 72 } };
  const e = P.lineMore(run, t, now, 'FILLER', {}).efficiency;
  assert.equal(e.plannedMin, 90);
  assert.equal(e.runningMin, 72);
  assert.equal(e.running, 80);
  assert.equal(e.speed, 100, '7,200 made against 100 a minute for 72 running minutes');
  assert.equal(e.good, 99);
  assert.equal(e.oee, 79);
  const x = P.lineMore(run, t, now, 'FILLER', {});
  assert.deepEqual([x.wasteTotal, x.topReason, x.topReasonMin], [72, 'Break / lunch', 10]);
  assert.equal(P.lineMore(null, t, now, 'FILLER', {}).efficiency, null, 'nothing before the first product');
});

test('Joe 10/14: the quality check due now, each hour made vs target, and the shift timeline', () => {
  const t = P.targetsFor([{ name: 'A', ratePerMin: 60, targetPct: 100 }]);
  const run = { shiftStart: '2026-10-11T10:00:00Z', shiftEnd: '2026-10-11T14:00:00Z', runs: [{ product: 'A', from: '2026-10-11T10:00:00Z' }],
    counts: [{ at: '2026-10-11T11:00:00Z', count: 3700 }, { at: '2026-10-11T12:00:00Z', count: 6900 }],
    stops: [{ start: '2026-10-11T11:30:00Z', end: '2026-10-11T11:40:00Z', reason: 'Filler jam' }],
    checks: { 1: { recorder: '163.4', indicating: '163.2', pen: 'ON TIME', flow: '118' } } };
  const due = P.checkDue(run, 'HTST', Date.parse('2026-10-11T11:30:00Z'));
  assert.deepEqual([due.slot, due.done, due.filled, due.of, due.at], [1, true, 4, 4, '2026-10-11T11:00:00.000Z']);
  const filler = P.checkDue(run, 'FILLER', Date.parse('2026-10-11T12:30:00Z'));
  assert.deepEqual([filler.slot, filler.done, filler.next], [1, false, '2026-10-11T14:00:00.000Z']);
  const h = P.hourly(run, t, Date.parse('2026-10-11T12:30:00Z'));
  assert.equal(h.length, 4);
  assert.deepEqual(h.slice(0, 2).map(x => [x.made, x.target, x.pct, x.stopped]), [[3700, 3600, 103, 0], [3200, 3600, 89, 10]]);
  assert.deepEqual([h[2].now, h[3].past], [true, false]);
  const tl = P.timeline(run, Date.parse('2026-10-11T12:00:00Z'));
  assert.deepEqual(tl.map(x => [x.kind, x.minutes]), [['run', 90], ['stop', 10], ['run', 20], ['left', 120]]);
});
