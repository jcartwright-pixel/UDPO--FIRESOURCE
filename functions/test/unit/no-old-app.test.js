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

// Joe 10/10: "My window should have a back button or a return to home button." Every screen (the drivers' public phone page
// aside) loads the shared shell, which puts Back and Home at the top of the menu. The Driver Room Check-In tablet (Joe 10/12) is
// the drivers' page on a shared tablet with no account: it leaves only by Release and the manager release code.
test('every screen loads the shared shell that gives it Back and Home', () => {
  const bad = fs.readdirSync(PUB).filter(f => f.endsWith('.html') && f !== 'route.html' && f !== 'driver-room.html').filter(f => {
    const text = fs.readFileSync(path.join(PUB, f), 'utf8');
    return !/js\/app\.js/.test(text) || !/id="screen"/.test(text) || !/class="topbar"/.test(text);
  });
  assert.deepEqual(bad, []);
});

// Joe 10/30 ("check to see if our router ... the reads and writes transferred over to our new Firebase system"): every screen
// reads from the Firebase database and saves through the server; no screen talks to Google Sheets or the old program itself.
// The sheets are reached only by the server (the copy in, the write-back and the other syncs Joe turned on).
test('no screen reads or writes Google Sheets or the old program directly', () => {
  const bad = [];
  files(PUB).filter(f => !f.includes(path.sep + 'vendor' + path.sep)).forEach(f => {
    const text = fs.readFileSync(f, 'utf8');
    [/sheets\.googleapis\.com/i, /docs\.google\.com\/spreadsheets/i, /google\.script\.run/, /macros\/s\//].forEach(re => { if (re.test(text)) bad.push(path.relative(PUB, f) + ': ' + re); });
  });
  assert.deepEqual(bad, []);
});

test('the database lets no screen write; every save goes through the server', () => {
  const rules = fs.readFileSync(path.join(__dirname, '../../../firestore.rules'), 'utf8');
  // The one write rule is the catch-all at the bottom, and it says no (if false).
  const writes = rules.split('\n').filter(l => /allow\s+[^:;]*\b(write|create|update|delete)\b/.test(l));
  assert.deepEqual(writes.filter(l => !/:\s*if false;/.test(l)), []);
});

// Joe 10/30: Pause writing to the sheets is the emergency stop for every sheet write, the fleet list sync's too.
test('the fleet list sync waits while writing to the sheets is paused', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../index.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function fleetSyncWrite()'), src.indexOf('exports.fleetSyncNightly'));
  assert.match(fn, /sheetsPaused\(/);
  assert.match(src, /if \(!run \|\| run\.paused\) return;/);
  assert.match(src, /run && run\.paused\) throw new HttpsError/);
});
