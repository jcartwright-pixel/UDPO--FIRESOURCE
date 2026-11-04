'use strict';
// Rules audit line 14 (Joe 11/3: "Yes to the color set"): one red, one green and one yellow for status, named once in logic.js
// (COLORS) and app.css (--red, --green ...), the same values as the timing rule. This fails when one of the old reds or greens
// (five reds and five greens used to mean the same thing) comes back, or one of the greens and oranges the 6.85 practice
// test found on Reports, the Plant Station and the Manager Center.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const L = require('../../src/logic');

test('the color set matches the timing rule', () => {
  assert.equal(L.COLORS.red, '#b42318');
  assert.equal(L.COLORS.green, '#1f7a4d');
  assert.equal(L.COLORS.yellow, '#f5c518');
  const css = fs.readFileSync(path.join(__dirname, '../../../public/css/app.css'), 'utf8');
  [['--green', 'green'], ['--red', 'red'], ['--yellow', 'yellow'], ['--amber', 'amber'], ['--blue', 'blue'], ['--gray', 'gray']].forEach(([v, k]) =>
    assert.ok(css.includes(v + ': ' + L.COLORS[k] + ';'), v + ' is ' + L.COLORS[k]));
});

const OLD = /#(c62828|b3261e|c0392b|b42332|9b1c1c|1d7a3e|1c7c4a|1c6b3a|1d6b37|1b7a3a|16813b|2e8a5a|177242|b36200|d27b00)\b/i;
test('no old reds or greens anywhere', () => {
  const root = path.join(__dirname, '../../..'), found = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', 'vendor', 'legacy'].includes(e.name)) walk(p); return; }
    if (!/\.(js|cjs|html|css)$/.test(e.name)) return;
    fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => { if (OLD.test(line)) found.push(path.relative(root, p) + ':' + (i + 1)); });
  });
  walk(path.join(root, 'public'));
  walk(path.join(root, 'functions', 'src'));
  assert.deepEqual(found, [], 'Use the one red (#b42318) or green (#1f7a4d), or var(--red) / var(--green):\n' + found.join('\n'));
});
