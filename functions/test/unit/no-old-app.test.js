'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const L = require('../../src/logic');

// Joe 10/10: tapping Print Layouts took him into the old program, and Back left him on its main screen. No screen or link in
// the new app may open the old program (script.google.com); a screen not built yet opens soon.html inside the new app.
const PUB = path.join(__dirname, '../../../public');
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === 'img' ? [] : files(path.join(dir, e.name)))
  : /\.(html|js)$/.test(e.name) ? [path.join(dir, e.name)] : []);

test('no screen or link opens the old program', () => {
  const bad = [];
  files(PUB).forEach(f => {
    const text = fs.readFileSync(f, 'utf8');
    [/script\.google\.com/i, /CURRENT_APP/, /[?&]workspace=/].forEach(re => { if (re.test(text)) bad.push(path.relative(PUB, f) + ': ' + re); });
  });
  assert.deepEqual(bad, []);
});

test('every page a link points to exists in the new app', () => {
  const pages = new Set(fs.readdirSync(PUB).filter(f => f.endsWith('.html'))), bad = [];
  files(PUB).forEach(f => {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/(?:href=["']|['"])([a-z][a-z0-9-]*\.html)(?=[?#"'])/g)) if (!pages.has(m[1])) bad.push(path.relative(PUB, f) + ' -> ' + m[1]);
  });
  assert.deepEqual([...new Set(bad)], []);
});

test('Operational Assignments start with the current app\'s four, in order, and a saved change wins', () => {
  assert.deepEqual(L.opsAssignments([]).map(x => x.assignment), ['Carrier', 'Fairmont', 'Marietta', 'Martins Ferry']);
  const rows = L.opsAssignments([{ assignment: 'Beckley', active: true, sequence: 2 }, { assignment: 'marietta', active: false, sequence: 9 }]);
  assert.deepEqual(rows.map(x => x.assignment), ['Carrier', 'Beckley', 'Fairmont', 'Martins Ferry', 'marietta']);
  assert.equal(rows[4].active, false);
  assert.equal(L.opsKey('  martins   ferry '), 'MARTINS FERRY');
});
