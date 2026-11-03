'use strict';
// Rules audit lines 15 and 16 (Joe 11/3: "a centralized area where the format date is going to be exact"; "everything should
// start on Sunday"): one way to write a date, like 10-8-26, in logic.js (dateText), used by every screen, email, text, printout
// and message. This checks the rule and fails when a new copy is written anywhere else.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const L = require('../../src/logic');

test('one date format: 10-8-26 from a day key, a sheet date or a time', () => {
  assert.equal(L.dateText('2026-10-08'), '10-8-26');
  assert.equal(L.dateText('2026-11-30'), '11-30-26');
  assert.equal(L.dateText('10/08/2026'), '10-8-26');
  assert.equal(L.dateText('1/2/27'), '1-2-27');
  // A time is read on the plant's clock: 1:30 AM UTC on 10-11 is still 10-10 in Uniontown.
  assert.equal(L.dateText('2026-10-11T01:30:00Z'), '10-10-26');
  assert.equal(L.dateText(Date.parse('2026-10-11T16:00:00Z')), '10-11-26');
  assert.equal(L.dateText(''), '');
  assert.equal(L.dateText(null), '');
  assert.equal(L.dateText('not a date'), 'not a date');
});

test('weeks start on Sunday', () => {
  assert.equal(L.weekStart('2026-11-04'), '2026-11-01');
  assert.equal(L.weekStart('2026-11-01'), '2026-11-01');
  assert.equal(L.weekStart('2026-11-07'), '2026-11-01');
  assert.equal(L.weekText('2026-11-04'), 'Sun 11-1-26 to Sat 11-7-26');
});

test('the Daily Dispatch print heading names the Sunday the week begins', () => {
  // Daily's load week starts on the Saturday that loads for Sunday, so the week it names is the next day, the Sunday.
  const html = fs.readFileSync(path.join(__dirname, '../../../public/daily.html'), 'utf8');
  assert.ok(html.includes("Week Beginning Sunday ' + escapeHtml(usDate(L.addDays(weekBegin(loadDate), 1)))"), 'the heading is the Sunday');
});

// Any of these written outside logic.js is a new copy of the date format.
const COPIES = [
  /Number\(\w+\[\d\]\) \+ '-' \+ Number\(\w+\[\d\]\) \+ '-' \+/,
  /\+ '-' \+ (String\(\w+(\.\w+\(\))?\)|\w+(\[\d\])?)\.slice\(-?2\)/,
  /\+ '\/' \+ \w+(\[\d\])? \+ '\/' \+ \w+/,
  /getMonth\(\) \+ 1\) \+ '[-\/]' \+ \w+\.getDate/,
  /\.slice\(5, 7\) \+ '[-\/]' \+/
];
// Not dates written for people: Google Sheets values and barcode or text parsing.
const ALLOWED = [/demo-sheets\.js/, /vendor\//];
test('no copies of the date format outside logic.js', () => {
  const root = path.join(__dirname, '../../..'), found = [];
  const walk = (dir, keep) => fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'vendor') walk(p, keep); return; }
    if (!keep(e.name) || ALLOWED.some(a => a.test(p))) return;
    fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => { if (COPIES.some(c => c.test(line)) && !/wallMinutes\(/.test(line)) found.push(path.relative(root, p) + ':' + (i + 1) + '  ' + line.trim().slice(0, 140)); });
  });
  walk(path.join(root, 'functions', 'src'), n => n.endsWith('.js') && n !== 'logic.js');
  walk(path.join(root, 'public', 'js'), n => n.endsWith('.js') && n !== 'logic.js');
  walk(path.join(root, 'public'), n => n.endsWith('.html'));
  assert.deepEqual(found, [], 'These write a date their own way; call dateText in logic.js instead:\n' + found.join('\n'));
});
