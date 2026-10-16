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
  // Joe 10/15: one column on a phone: the line and its percent on one row, the shortened numbers full width under it.
  assert.match(html, /Line output · 2nd Shift 2 PM-10:30 PM/);
  assert.match(html, /GALLON FILLER.*102%.*6,420 of 6,300 · down 14 min \(Filler jam\) · waste 19 · 1 chg 22 min · eff\. 87%/s);
  assert.doesNotMatch(html, /width="50%"/, 'no two-across tiles');
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

test('Blow Mold bottle check (Joe 10/14): one jug from each of the six heads in grams, flagged outside the range on Line Targets', () => {
  const P = require('../../src/production-rules');
  assert.deepEqual(P.CHECK_FIELDS.BLOWMOLD.map(f => f[1]), ['Head 1 g', 'Head 2 g', 'Head 3 g', 'Head 4 g', 'Head 5 g', 'Head 6 g', 'Top load']);
  const ld = { jugWeightLow: 55, jugWeightHigh: 59 };
  assert.equal(P.weightFlag('head2', '60.2', ld), 'HEAVY');
  assert.equal(P.weightFlag('head5', '54.6', ld), 'LIGHT');
  assert.equal(P.weightFlag('head1', '57.1', ld), '');
  assert.equal(P.weightFlag('head1', '', ld), '', 'an empty box is not flagged');
  assert.equal(P.weightFlag('topLoad', '80', ld), '', 'only the heads are weighed');
  assert.equal(P.weightFlag('head1', '70', {}), '', 'no range, no flag');
});

// Joe 10/14: "we weigh jugs after fill just to check", and the math on how much goes in each jug.
test('Fill weight check: product = filled - empty jug - cap, against the product target; LIGHT and HEAVY by the allowances', () => {
  const f = P.fillOf({ at: '2026-10-14T15:00:00.000Z', product: 'Whole Milk Gallon', tare: 57, cap: 3, target: 3800, under: 5, over: 15, jug1: 3870, jug2: 3852, jug3: 3880, jug4: '', count: 100 });
  assert.deepEqual(f.jugs.slice(0, 4).map(j => [j.net, j.diff, j.flag]), [[3810, 10, ''], [3792, -8, 'LIGHT'], [3820, 20, 'HEAVY'], [null, null, '']]);
  assert.equal(f.filled, 3);
  assert.equal(f.avgNet, 3807.3);
  assert.equal(f.diff, 7.3);
  assert.equal(f.flag, 'LIGHT', 'a light jug flags the check');
  // No target on the Product Sheet: nets still show, nothing is flagged ("set target").
  const n = P.fillOf({ tare: 57, jug1: 3870 });
  assert.deepEqual([n.jugs[0].net, n.jugs[0].diff, n.flag, n.diff], [3813, null, '', null]);
  // No heavy allowance: overfill is shown, not flagged; no light allowance: any jug under target is LIGHT.
  assert.equal(P.fillFlag(3900, 3800, null, null), '');
  assert.equal(P.fillFlag(3799.9, 3800, null, null), 'LIGHT');
});

test('Fill weight check: the Gallon Filler\'s empty jug is the Blow Mold heads average (12 hours), else the weight typed on Line Targets', () => {
  const now = Date.parse('2026-10-14T20:00:00.000Z'), heads = { avg: P.headsAverage({ head1: '57', head2: '58', head3: '', head4: '56.5', head5: '57.5', head6: '57' }), at: '2026-10-14T18:00:00.000Z' };
  assert.equal(heads.avg, 57.2);
  assert.deepEqual(P.tareFor('GALLON FILLER', { tareGrams: 60 }, heads, now), { grams: 57.2, from: 'BLOWMOLD', at: '2026-10-14T18:00:00.000Z' });
  assert.deepEqual(P.tareFor('GALLON FILLER', { tareGrams: 60 }, heads, now + 13 * 3600000), { grams: 60, from: 'TYPED', at: '' }, 'old Blow Mold weights: the typed weight');
  assert.deepEqual(P.tareFor('NEW 1/2 GALLON', { tareGrams: 38 }, heads, now), { grams: 38, from: 'TYPED', at: '' }, 'a half gallon filler\'s jugs are not the Blow Mold\'s');
  assert.equal(P.tareFor('OLD 1/2 GALLON', {}, heads, now), null);
  assert.equal(P.usesBlowMoldJugs('Gallon Filler'), true);
  assert.equal(P.usesBlowMoldJugs('NEW 1/2 GALLON'), false);
});

test('Fill weight check: due at the start and each product change, then every so many minutes or jugs (Line Targets)', () => {
  const t0 = Date.parse('2026-10-14T10:00:00.000Z'), iso = (m) => new Date(t0 + m * 60000).toISOString();
  const run = { shiftStart: iso(-240), runs: [{ product: 'Whole', from: iso(0) }], count: 500, fills: [] };
  assert.equal(P.fillDue({ shiftStart: iso(0), runs: [] }, {}, t0).why, 'product', 'nothing running yet');
  let d = P.fillDue(run, {}, t0 + 60000);
  assert.deepEqual([d.due, d.why, d.index], [true, 'start', null]);
  run.fills.push({ at: iso(5), count: 600, jug1: 3850 });
  d = P.fillDue(run, {}, t0 + 30 * 60000);
  assert.deepEqual([d.due, d.index, d.nextAt], [false, 0, iso(5 + P.FILL_DEFAULT_MIN)], 'empty setting: every 2 hours');
  // Joe 10/15: once all five weights are in, the check is recorded: the boxes empty for the next one, the result read-only.
  Object.assign(run.fills[0], { jug2: 3851, jug3: 3852, jug4: 3853, jug5: 3854 });
  d = P.fillDue(run, {}, t0 + 30 * 60000);
  assert.deepEqual([d.due, d.index, d.current, d.last.filled, d.nextAt], [false, null, null, 5, iso(5 + P.FILL_DEFAULT_MIN)]);
  run.fills[0] = { at: iso(5), count: 600, jug1: 3850 };
  assert.equal(P.fillDue(run, {}, t0 + 126 * 60000).why, 'time');
  assert.deepEqual([P.fillDue(run, { fillEvery: 'MINUTES', fillEveryN: 30 }, t0 + 36 * 60000).due, P.fillDue(run, { fillEvery: 'MINUTES', fillEveryN: 30 }, t0 + 34 * 60000).due], [true, false]);
  run.count = 1500;
  d = P.fillDue(run, { fillEvery: 'JUGS', fillEveryN: 1000 }, t0 + 40 * 60000);
  assert.deepEqual([d.due, d.jugsLeft], [false, 100]);
  run.count = 1600;
  assert.equal(P.fillDue(run, { fillEvery: 'JUGS', fillEveryN: 1000 }, t0 + 40 * 60000).why, 'jugs');
  d = P.fillDue(run, { fillEvery: 'CHANGE' }, t0 + 600 * 60000);
  assert.deepEqual([d.due, d.nextAt, d.jugsLeft], [false, '', null], 'start and product change only');
  run.runs.push({ product: '2%', from: iso(50) });
  assert.equal(P.fillDue(run, { fillEvery: 'CHANGE' }, t0 + 51 * 60000).why, 'change');
});

test('Fill weight check: the shift\'s giveaway is the average over target on every jug made', () => {
  const run = { fills: [{ tare: 57, cap: 3, target: 3800, jug1: 3870, jug2: 3870 }, { tare: 57, cap: 3, target: 3800, jug1: 3866 }] };
  const t = P.fillTotals(run, 10000);
  assert.deepEqual([t.checks, t.avgDiff, t.giveawayG, t.giveawayLb, t.light], [2, 8, 80000, 176.4, 0]);
  assert.equal(P.fillTotals({ fills: [{ tare: 57, cap: 3, target: 3800, jug1: 3850 }] }, 10000).giveawayG, 0, 'under target gives nothing away');
  assert.equal(P.fillTotals({ fills: [{ tare: 57, jug1: 3850 }] }, 100).noTarget, true);
});

test('Gallon Filler add-on sensors (Joe 10/14, B): a filler reads its motor switch and infeed eye; the Blow Mold keeps its three', () => {
  assert.deepEqual(P.readingsFor('BLOWMOLD', 'CONTROLLER'), ['count', 'speed', 'temp']);
  assert.deepEqual(P.readingsFor('FILLER', 'READER'), ['running', 'infeed']);
  assert.deepEqual(P.readingsFor('FILLER', 'CONTROLLER'), ['count', 'speed', 'temp', 'running', 'infeed']);
  assert.ok(P.tagOk('MODBUS', '10001') && P.tagOk('MODBUS', 'DI 0') && P.tagOk('S7', 'I0.3') && P.tagOk('S7', 'DB10.DBX4.0'));
  assert.deepEqual(P.controllerField('runningTag', '10001', 'MODBUS'), { value: '10001' });
  const m = P.machineNow({ count: 1000, infeed: 1030, infeedBase: 0, machine: { at: '2026-10-14T10:00:00.000Z', running: false, runningSince: '2026-10-14T09:58:00.000Z', speed: null, temp: null, counter: null } }, {}, Date.parse('2026-10-14T10:00:30.000Z'), 'FILLER');
  assert.deepEqual([m.running, m.runningSince, m.infeed, m.rejects], [false, '2026-10-14T09:58:00.000Z', 1030, 30]);
});

test('Bag fillers and Fed by (Joe 10/14): Raypak and Boxing weigh bags; a packing line\'s boxes against its fillers\' jugs', () => {
  assert.deepEqual(['RAYPAK', 'BOXING', 'GALLON FILLER', 'NEW 1/2 GALLON', 'TOTES', 'HTST #1', 'BLOW MOLD'].map(P.hasFill), [true, true, true, true, false, false, false]);
  assert.equal(P.fillWords('RAYPAK').cap, 'fitment');
  assert.equal(P.fillWords('GALLON FILLER').one, 'jug');
  const raypak = P.lineMore(null, [], Date.parse('2026-10-08T15:00:00Z'), 'PACK', {}, { lineName: 'RAYPAK' });
  assert.equal(raypak.fill.words.many, 'bags');
  assert.equal(P.lineMore(null, [], Date.parse('2026-10-08T15:00:00Z'), 'PACK', {}, { lineName: 'TOTES' }).fill, null);
  assert.equal(P.boxingOf({}, 10, []), null, 'no feeders set: nothing to compare');
  const feeders = [{ operationId: 'a', name: 'GALLON FILLER', made: 300 }, { operationId: 'b', name: 'NEW 1/2 GALLON', made: 150 }, { operationId: 'c', name: 'OTHER', made: 99 }];
  assert.deepEqual(P.boxingOf({ fedBy: ['a', 'b'], perBox: 4 }, 100, feeders), { perBox: 4, boxes: 100, jugsIn: 450, boxed: 400, diff: 50,
    feeders: [{ operationId: 'a', name: 'GALLON FILLER', made: 300 }, { operationId: 'b', name: 'NEW 1/2 GALLON', made: 150 }] });
  assert.equal(P.boxingOf({ fedBy: ['a'] }, 100, feeders).diff, null, 'no jugs per box yet');
  assert.equal(P.boxingOf({ fedBy: ['a'], perBox: 4 }, 100, feeders).diff, -100, 'more boxed than filled');
});

// Joe 10/16: "we run it right around 1,000 and 1,350 degrees"; "the Dairy Queen machines are my Raypak machines";
// "You already have the sensors already labeled that goes to the blow mold".
test('the Blow Mold temperature range is 1,000 to 1,350°F until Line Targets sets one', () => {
  assert.deepEqual(P.machineRange('BLOWMOLD', {}, 'temp'), [1000, 1350]);
  assert.deepEqual(P.machineRange('BLOWMOLD', { tempLow: 395, tempHigh: 425 }, 'temp'), [395, 425]);
  assert.deepEqual(P.machineRange('BLOWMOLD', {}, 'speed'), [null, null]);
  assert.deepEqual(P.machineRange('FILLER', {}, 'temp'), [null, null]);
  const m = P.machineNow({ machine: { at: '2026-10-16T05:00:00Z', temp: 1400 } }, {}, Date.parse('2026-10-16T05:00:10Z'), 'BLOWMOLD');
  assert.deepEqual([m.tempLow, m.tempHigh, m.tempFlag], [1000, 1350, 'HIGH']);
});

test('RedZone lines go with ours by name (Dairy Queen is the RAYPAK, Dairy Queen Manual the 5-gallon filler that feeds BOXING); Line Targets can pick another or none', () => {
  const rz = { locations: [{ uuid: 'bm', name: 'Blow Mold', sensors: ['Default'] }, { uuid: 'dq', name: 'Dairy Queen', sensors: ['Default'] }, { uuid: 'dqm', name: 'Dairy Queen Manual', sensors: ['In=out', 'Box'] },
    { uuid: 'g', name: 'Gallon' }, { uuid: 'h', name: 'Half Gallon' }, { uuid: 'hqp', name: 'Half, Quart, and Pint' }, { uuid: 'bx', name: 'Box Maker' }, { uuid: 'bxm', name: 'Box Maker Manuel' }] };
  const of = (name, doc) => (P.rzLocationFor(name, doc || {}, rz) || {}).name || null;
  assert.deepEqual(['BLOW MOLD', 'RAYPAK', 'GALLON FILLER', 'NEW 1/2 GALLON', 'OLD 1/2 GALLON', 'BOXING', 'TOTES', 'HTST #1'].map(n => of(n)),
    ['Blow Mold', 'Dairy Queen', 'Gallon', 'Half Gallon', 'Half, Quart, and Pint', 'Dairy Queen Manual', null, null]);
  assert.equal(of('BOXING', { redzoneLocation: 'bx' }), 'Box Maker');
  assert.equal(of('BLOW MOLD', { redzoneLocation: 'NONE' }), null);
});

test('RedZone problem types are the Line Stopped choices for that line; its products fill empty speeds only', () => {
  const rz = { locations: [{ uuid: 'bm', name: 'Blow Mold' }], assets: [{ locationUUID: 'bm', assetTypeUUID: 'blow' }],
    problems: [{ name: 'Blow mold is down', assetTypeUUID: 'blow' }, { name: 'Bag Not Sealing', assetTypeUUID: 'bag' }, { name: 'Adjusting weights', assetTypeUUID: '' }, { name: 'Other', assetTypeUUID: '' }],
    products: [{ uuid: 'p1', name: 'Gallon Jug', sku: '9001', ratePerMin: 50, target: 85 }, { uuid: 'p2', name: 'Cream', sku: '294', ratePerMin: 100, target: 1200 }],
    runs: [{ locationUUID: 'bm', productTypeUUID: 'p1', startTime: '2026-10-15T10:00:00Z' }, { locationUUID: 'x', productTypeUUID: 'p2', startTime: '2026-10-15T11:00:00Z' }] };
  const loc = rz.locations[0], names = P.rzProblemsFor(rz, loc);
  assert.deepEqual(names, ['Blow mold is down', 'Adjusting weights', 'Other']);
  assert.deepEqual(P.rzStopReasons('BLOWMOLD', names), ['Blow mold is down', 'Adjusting weights', 'Mold change', 'Resin feed', 'Leak tester down', 'Trimmer jam', 'Conveyor / bottle jam',
    'Heater / temperature', 'Compressed air', 'Filler backed up (jugs full)', 'Maintenance called', 'Other'], 'RedZone\'s first, then ours while there is room');
  assert.deepEqual(P.rzStopReasons('BLOWMOLD', []), P.stopReasons('BLOWMOLD'), 'not read in: the line\'s own list');
  assert.equal(P.rzStopReasons('FILLER', Array.from({ length: 15 }, (_, i) => 'P' + i)).length, 12, 'the tablet\'s four rows of three');
  const ran = P.rzRunsFor(rz, loc);
  assert.deepEqual([ran.products.map(p => p.name), ran.runs[0].product], [['Gallon Jug'], 'Gallon Jug']);
  const f = P.rzFill([{ name: 'GALLON JUG', sku: '', ratePerMin: '' }, { name: 'Cream', sku: '294', ratePerMin: 90 }, { name: 'Not in RedZone' }], rz.products);
  assert.deepEqual(f.list.map(r => [r.ratePerMin, r.targetPct]), [[50, 85], [90, undefined], [undefined, undefined]]);
  assert.deepEqual(f.changed, ['GALLON JUG: full speed 50, Target % 85'], 'a typed speed stays; a target over 100 is not a Target %');
});

test('rzEfficiency: a RedZone run\'s count against its standard speed for the minutes run', () => {
  const t0 = Date.parse('2026-10-16T08:00:00Z');
  assert.deepEqual(P.rzEfficiency({ startTime: t0, endTime: t0 + 3600000, ratePerMin: 20, count: 1080 }), { minutes: 60, expected: 1200, pct: 90 });
  assert.deepEqual(P.rzEfficiency({ startTime: t0, countAt: t0 + 1800000, ratePerMin: 20, count: 600 }), { minutes: 30, expected: 600, pct: 100 });
  assert.equal(P.rzEfficiency({ startTime: t0, countAt: t0 + 1800000, ratePerMin: 0, count: 600 }), null, 'no standard speed');
  assert.equal(P.rzEfficiency({ startTime: t0, ratePerMin: 20, count: 600 }), null, 'no end or count time');
  assert.equal(P.rzEfficiency({ startTime: t0, countAt: t0 + 60000, ratePerMin: 20 }), null, 'no count');
});
