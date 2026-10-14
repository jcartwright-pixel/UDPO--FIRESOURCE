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

test('Joe 10/14 follow-on: stop reasons for each kind of line, twelve each; the fillers keep theirs', () => {
  assert.deepEqual(P.stopReasons('FILLER'), P.REASONS);
  ['FILLER', 'PACK', 'HTST', 'BLOWMOLD'].forEach(k => {
    const r = P.stopReasons(k);
    assert.equal(r.length, 12, k);
    assert.equal(new Set(r).size, 12, k + ' has no repeats');
    assert.ok(r.indexOf('Maintenance called') >= 0 && r.indexOf('Other') >= 0 && r.some(x => /break|lunch/i.test(x)), k + ' has a break reason (not counted against efficiency) and Maintenance called');
  });
  assert.ok(P.stopReasons('HTST').indexOf('Divert / low temp') >= 0);
  assert.ok(P.stopReasons('BLOWMOLD').indexOf('Leak tester down') >= 0);
});

test('Joe 10/14 follow-on: the Current Report carries each line\'s shift (made, stopped and why, waste, changeovers, efficiency)', () => {
  const U = require('../../src/plant-rules');
  const out = U.lineOutput([
    { line: 'GALLON FILLER', product: 'GV 2% Gallon', made: 6420, soFar: 6300, pct: 102, downMin: 14, stops: 2, topReason: 'Filler jam', wasteTotal: 19, changeovers: 1, changeoverMin: 22, oee: 87, state: 'RUNNING' },
    { line: 'TOTES', made: 0, soFar: 0, pct: null, downMin: 0, stops: 0, wasteTotal: 0, state: 'IDLE' }]);
  assert.equal(out.length, 1, 'a line with nothing this shift is left out');
  assert.equal(U.outputText(out[0]), '6,420 of 6,300 (102%) · stopped 14 min (Filler jam) · waste 19 · 1 changeover 22 min · efficiency 87%');
  const r = U.plantReport({ loads: [], pickups: [], shiftLog: [], lines: [], temps: [], roundStart: '', output: out, outputShift: 'Second Shift 2:00 PM to 10:30 PM' }, Date.parse('2026-10-14T21:00:00Z'));
  assert.match(r.text, /LINE OUTPUT · Second Shift 2:00 PM to 10:30 PM\n  GALLON FILLER  GV 2% Gallon  6,420 of 6,300 \(102%\)/);
  const html = U.reportHtml(r, '');
  assert.match(html, /Line output · Second Shift/);
  assert.match(html, /GALLON FILLER.*6,420 of 6,300 · stopped 14 min \(Filler jam\).*102%/s);
  assert.doesNotMatch(U.reportHtml(U.plantReport({ loads: [], lines: [], temps: [] }, Date.now()), ''), /Line output/, 'no section without line output');
});

test('Joe 10/14 follow-on: the weekly line scorecard adds up each line\'s shifts and ranks the biggest losses', () => {
  const t = { L1: P.targetsFor([{ name: 'A', ratePerMin: 60, targetPct: 100 }]) };
  const shift = (key, day, extra) => Object.assign({ operationId: 'L1', shiftKey: key, date: day, shiftStart: day + 'T10:00:00Z', shiftEnd: day + 'T12:00:00Z', product: 'A', count: 6000, runs: [{ product: 'A', from: day + 'T10:00:00Z' }], counts: [{ at: day + 'T12:00:00Z', count: 6000 }], stops: [] }, extra);
  const runs = [
    shift('a', '2026-10-11', { stops: [{ start: '2026-10-11T10:30:00Z', end: '2026-10-11T10:50:00Z', reason: 'Filler jam' }], waste: { Leaker: 10 }, changeovers: [{ start: '2026-10-11T11:00:00Z', end: '2026-10-11T11:30:00Z', from: 'A', to: 'A' }] }),
    shift('b', '2026-10-12', { stops: [{ start: '2026-10-12T10:30:00Z', end: '2026-10-12T10:40:00Z', reason: 'Cap feed' }, { start: '2026-10-12T11:00:00Z', end: '2026-10-12T11:15:00Z', reason: 'Filler jam' }], waste: { Leaker: 5 }, changeovers: [{ start: '2026-10-12T11:30:00Z', end: '2026-10-12T11:40:00Z' }] }),
    { operationId: 'L2', date: '2026-10-12', runs: [], stops: [] },
    { operationId: 'NOT_A_LINE', date: '2026-10-12', runs: [{ product: 'A', from: '2026-10-12T10:00:00Z' }] }];
  const W = P.weekScore(runs, [{ operationId: 'L1', name: 'GALLON FILLER' }, { operationId: 'L2', name: 'TOTES' }], id => t[id] || [], { L1: { changeoverMin: 20 } }, Date.parse('2026-10-14T00:00:00Z'));
  const g = W.lines.find(x => x.operationId === 'L1');
  assert.deepEqual([g.shifts, g.made, g.soFar, g.pct, g.downMin, g.stops, g.wasteTotal], [2, 12000, 14400, 83, 45, 3, 15]);
  assert.deepEqual([g.changeovers, g.changeoverAvg, g.overStd, g.changeoverStd], [2, 20, 1, 20]);
  assert.deepEqual(g.topReasons, [{ reason: 'Filler jam', minutes: 35 }, { reason: 'Cap feed', minutes: 10 }]);
  assert.ok(g.oee > 0 && g.oee <= 100);
  assert.deepEqual(W.lines.find(x => x.operationId === 'L2').shifts, 0, 'a shift with nothing entered is not counted');
  assert.deepEqual(W.topLosses.map(r => r.reason), ['Filler jam', 'Cap feed']);
});
