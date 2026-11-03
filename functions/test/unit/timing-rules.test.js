'use strict';
// Joe 11-2-26 / 11-3-26: every timing rule lives in one file, functions/src/timing-rules.js (copied to public/js). These tests
// check the rules themselves, and that no screen or server file keeps its own copy of them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const T = require('../../src/timing-rules');

const ROOT = path.join(__dirname, '../../..');

test('departures: within 30 minutes either side is green, 30 to 60 is yellow, past 60 is red (Joe 11-2-26)', () => {
  const tone = (m, s) => T.departTiming(m, s).tone;
  for (const s of ['plant', 'sales', 'scorecard']) {
    assert.equal(tone(0, s), 'ok');
    assert.equal(tone(30, s), 'ok');
    assert.equal(tone(31, s), 'caution');
    assert.equal(tone(60, s), 'caution');
    assert.equal(tone(61, s), 'late');
  }
  assert.equal(T.departTiming(40, 'sales').words, '40 min late');
  assert.equal(T.departTiming(80, 'sales').words, '1 hr 20 min late');
  assert.equal(T.departTiming(10, 'sales').words, 'On time');
  assert.equal(T.departTiming(null, 'sales'), null);
});

test('leaving early counts for sales and the Scorecard, never for loading on the plant side', () => {
  assert.equal(T.departTiming(-15, 'scorecard').tone, 'ok', '15 minutes early is green');
  assert.equal(T.departTiming(-45, 'sales').tone, 'caution');
  assert.equal(T.departTiming(-45, 'sales').early, true);
  assert.equal(T.departTiming(-90, 'sales').tone, 'late');
  assert.equal(T.departTiming(-90, 'sales').words, '1 hr 30 min early');
  assert.equal(T.departTiming(-90, 'plant').tone, 'ok', 'a load done early is never flagged');
  assert.equal(T.pastOnTime(31, 'plant'), true);
  assert.equal(T.pastOnTime(30, 'plant'), false);
  assert.equal(T.worseTone('caution', 'late'), 'late');
  assert.equal(T.worseTone('late', 'ok'), 'late');
});

test('each source has its own settings in the one file; the Scorecard keeps 30 late / 15 early for coming back', () => {
  assert.deepEqual(T.WINDOWS, { onTime: 30, caution: 60 });
  assert.equal(T.SOURCES.scorecard.backLate, 30);
  assert.equal(T.SOURCES.scorecard.backEarly, 15);
  assert.equal(T.SOURCES.plant.early, false);
  assert.equal(T.SOURCES.sales.early, true);
});

test('lengths of time are written one way: 35 min, 1 hr, 1 hr 12 min, 1 day 2 hr', () => {
  assert.equal(T.spanText(35), '35 min');
  assert.equal(T.spanText(60), '1 hr');
  assert.equal(T.spanText(72), '1 hr 12 min');
  assert.equal(T.spanText(0), '0 min');
  assert.equal(T.spanText(1440 + 120), '1 day 2 hr');
  assert.equal(T.spanText(3 * 1440), '3 days');
  assert.equal(T.spanTextMs(90 * 60000), '1 hr 30 min');
});

test('the one time fixer: whatever is typed comes out as 4:30 PM', () => {
  const fix = (s, was) => T.timeText(T.typedTime(s, was));
  assert.equal(fix('430p'), '4:30 PM');
  assert.equal(fix('4:30 p'), '4:30 PM');
  assert.equal(fix('4:30 p.m.'), '4:30 PM');
  assert.equal(fix('16:30'), '4:30 PM');
  assert.equal(fix('1630'), '4:30 PM');
  assert.equal(fix('5'), '5:00 AM');
  assert.equal(fix('530'), '5:30 AM');
  assert.equal(fix('5a'), '5:00 AM');
  assert.equal(fix('12p'), '12:00 PM');
  assert.equal(fix('12a'), '12:00 AM');
  assert.equal(fix('4:30', 16 * 60), '4:30 PM', 'a box that held a PM time stays PM');
  assert.equal(T.typedTime('banana'), null);
  assert.equal(T.typedTime('25:00'), null);
  assert.equal(T.typedTime('4:75'), null);
  assert.equal(T.hhmmOf('430p'), '16:30', 'times are still saved as 16:30');
  assert.equal(T.hhmmOf('nope'), '');
  assert.equal(T.boxText('16:30'), '4:30 PM');
  assert.equal(T.boxText(''), '');
});

test('a blank Load Day is 1 day before delivery; offsets run 0 to -6', () => {
  assert.equal(T.loadDayOffset(''), -1);
  assert.equal(T.loadDayOffset(null), -1);
  assert.equal(T.loadDayOffset('x'), -1);
  assert.equal(T.loadDayOffset(0), 0);
  assert.equal(T.loadDayOffset(-2), -2);
  assert.equal(T.loadDayOffset(-9), -6);
  assert.equal(T.loadDayOffset(3), 0);
});

test('the day changes at 6 AM New York time; the calendar day does not', () => {
  const at = (iso) => Date.parse(iso);
  // 11-3-26 5:59 AM New York (EST, UTC-5) is still 11-2; 6:00 AM is 11-3.
  assert.equal(T.operatingDay(at('2026-11-03T10:59:00Z')), '2026-11-02');
  assert.equal(T.operatingDay(at('2026-11-03T11:00:00Z')), '2026-11-03');
  assert.equal(T.calendarDay(at('2026-11-03T10:59:00Z')), '2026-11-03');
  assert.equal(T.clockOf('2026-11-03T21:30:00Z'), '4:30 PM');
  assert.equal(T.clockOf(''), '');
  assert.equal(T.DAY_ROLL, 360);
});

// ---------- No copies outside the one file ----------

function files(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules|vendor|lib$/.test(e.name)) files(p, out); }
    else if (/\.(js|html)$/.test(e.name) && !/\.min\.js$/.test(e.name) && e.name !== 'timing-rules.js') out.push(p);
  }
  return out;
}
const ALL = [...files(path.join(ROOT, 'public')), ...files(path.join(ROOT, 'functions/src'))];

// Each pattern is an old copy of a timing rule. The fix is to use timing-rules.js (window.UDTiming on screens).
const COPIES = [
  [/type=["']time["']/, 'a type="time" box (use a text box with data-time; the one fixer turns "430p" into 4:30 PM)'],
  [/toLocaleTimeString\(/, 'its own clock-time writer (use UDTiming.clockOf)'],
  [/- 360\) \/ 1440/, 'its own 6 AM day change (use UDTiming.opDayOfWall / operatingDay)'],
  [/\* 1440 \+ 360/, 'its own 6 AM day start (use UDTiming.dayStartWall)'],
  [/loadDayOffset[^\n]{0,80}\? -1 :/, 'its own "blank Load Day = -1" (use loadDayOffset)'],
  [/' h ' \+/, 'its own length-of-time words (use UDTiming.spanText)'],
  [/' h ago'|Math\.floor\(\w+ \/ 60\) \+ ' h'/, 'its own length-of-time words (use UDTiming.spanText)'],
  [/\b(BEHIND_MINUTES|REPORT_BEHIND|ON_TIME_MINUTES) = \d/, 'its own late number (use UDTiming.SOURCES)'],
  [/\bLATE_GRACE\b/, 'its own late number (use UDTiming.SOURCES.sales)'],
  [/hourCycle: 'h23' \}\)\.formatToParts\(new Date\(\)\)/, 'its own New York clock (use UDTiming.wallClock / operatingDay)']
];

test('no screen or server file keeps its own copy of a timing rule (they all use timing-rules.js)', () => {
  const found = [];
  for (const f of ALL) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const [re, why] of COPIES) if (re.test(line)) found.push(path.relative(ROOT, f) + ':' + (i + 1) + ' has ' + why);
    });
  }
  assert.deepEqual(found, []);
});

// The screens, and the sandbox-only pages the practice deploy copies in (sandbox-only/diagnostics.html).
const PAGES = ['public', 'sandbox-only'].flatMap(d => fs.readdirSync(path.join(ROOT, d)).filter(n => n.endsWith('.html')).map(n => d + '/' + n));

test('every page that loads the dispatch rules loads the timing rules first', () => {
  const missing = [];
  for (const f of PAGES) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const logic = s.indexOf('src="js/logic.js"');
    if (logic < 0) continue;
    const timing = s.indexOf('src="js/timing-rules.js"');
    if (timing < 0 || timing > logic) missing.push(f);
  }
  assert.deepEqual(missing, []);
});

test('screens that use UDTiming load it', () => {
  const missing = [];
  for (const f of PAGES) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (/UDTiming/.test(s) && !/src="js\/timing-rules\.js"/.test(s)) missing.push(f);
  }
  assert.deepEqual(missing, []);
});
