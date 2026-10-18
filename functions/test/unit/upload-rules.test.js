'use strict';
// The Upload Center's checks (Joe 10/18): one workbook, each row New, Changed, Same or a Problem, a saved row not in the file
// Taken off; no trucks or trailers; never SSN, birth dates or addresses.
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../../src/upload-rules');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ROOT = path.join(__dirname, '..', '..', '..');
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const head = (key) => U.BY_KEY[key].cols.map(c => c.h + (c.req ? ' *' : ''));
const sheet = (key, rows) => ({ name: U.BY_KEY[key].tab, cells: [head(key)].concat(rows) });
const routes = sheet('routes', [
  ['803', 'Load 1', 'DSD MILK', '', '', '', 'Case Loadout', 'United Dairy', '', 'Charleston', 'Delivery Day', 'No', 'No', '51', 'Yes', 'Yes', 'Yes', 'Yes', 'Yes', 'Active', ''],
  ['803', '2', 'DSD', '', '', '', 'case loadout', 'united dairy', '', '', '', '', '', '', 'y', 'yes', 'YES', 'no', '', 'active', '']
]);
const drivers = sheet('drivers', [
  ['00412', 'Pat Adams', 'Active', '(304) 555-0111', 'No', '3/15/19', '', ''],
  ['518', 'Lee Casey', 'Active', '', 'Yes', '10-8-26', '', '']
]);

test('no trucks or trailers anywhere in the workbook (Joe 10/18)', () => {
  const all = U.SPEC.flatMap(t => t.cols.map(c => c.h.toUpperCase()));
  assert.ok(!all.some(h => /TRUCK|TRAILER|TRACTOR/.test(h)), all.filter(h => /TRUCK|TRAILER|TRACTOR/.test(h)).join(', '));
  assert.ok(!U.SPEC.some(t => /TRUCK|TRAILER|UNIT/i.test(t.tab)));
  assert.deepEqual(U.PARTS, ['Routes', 'Drivers', 'Plant', 'People and Email']);
});

test('every example row passes its own tab', () => {
  U.SPEC.forEach(t => {
    t.cols.forEach((c, i) => { const got = U.read(c, t.example[i]); assert.ok(!got.bad, t.tab + ' / ' + c.h + ': ' + got.bad); });
    assert.equal(t.example.length, t.cols.length, t.tab);
    t.examples.forEach((e, n) => {
      assert.equal(e.length, t.cols.length, t.tab + ' example ' + (n + 1));
      t.cols.forEach((c, i) => { const got = U.read(c, e[i]); assert.ok(!got.bad, t.tab + ' example ' + (n + 1) + ' / ' + c.h + ': ' + got.bad); });
    });
  });
});

test('cells are read the plain way: dates, times, yes/no, phones, loads, choices', () => {
  assert.equal(U.dateOf('10-8-26'), '2026-10-08');
  assert.equal(U.dateOf('3/15/2019'), '2019-03-15');
  assert.equal(U.dateOf('2026-02-30'), null);
  assert.equal(U.timeOf('4:00 AM'), '04:00');
  assert.equal(U.timeOf('2:30 PM'), '14:30');
  assert.equal(U.timeOf('4:00:00 AM'), '04:00');
  assert.equal(U.timeOf('12:00 AM'), '00:00');
  assert.equal(U.timeOf('25:00'), null);
  assert.equal(U.loadName('2'), 'Load 2');
  assert.equal(U.loadName('run 3'), 'Run 3');
  assert.equal(U.idKey('00412'), U.idKey('412'));
  const phone = U.BY_KEY.drivers.cols.find(c => c.key === 'phone');
  assert.deepEqual(U.read(phone, '1 (304) 555-0111'), { v: '3045550111' });
  assert.ok(U.read(phone, '555-0111').bad);
  const lt = U.BY_KEY.routes.cols.find(c => c.key === 'loadType');
  assert.deepEqual(U.read(lt, 'case loadout'), { v: 'Case Loadout' });
  assert.match(U.read(lt, 'Pallet').bad, /pick one of/);
});

test('a first upload: every row New, the example row skipped, an empty tab left alone', () => {
  const book = U.readBook([{ name: 'How to fill', cells: [['x']] }, routes, drivers, sheet('lines', [U.BY_KEY.lines.example]), sheet('products', [])]);
  assert.equal(book.tabs.lines.exampleSkipped, true);
  const r = U.check(book, {});
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.tabs).sort(), ['drivers', 'routes']);
  assert.equal(r.totals.NEW, 4);
  assert.equal(r.tabs.routes.rows[1].values.load, 'Load 2');
  assert.equal(r.tabs.routes.rows[1].values.loadType, 'Case Loadout');
  assert.equal(r.tabs.drivers.rows[0].values.phone, '3045550111');
  assert.equal(r.tabs.drivers.rows[0].values.hired, '2019-03-15');
  const saved = U.toSave(r);
  assert.equal(saved.routes.length, 2);
});

test('a second upload: Changed with what changed, Same, and a saved row not in the file is Taken off', () => {
  const first = U.toSave(U.check(U.readBook([routes, drivers]), {}));
  const again = sheet('drivers', [['412', 'Pat Adams', 'Active', '3045550199', 'No', '3-15-19', '', '']]);
  const r = U.check(U.readBook([again]), first);
  assert.equal(r.ok, true);
  assert.equal(r.tabs.drivers.rows[0].status, 'CHANGED');
  assert.deepEqual(r.tabs.drivers.rows[0].changes.map(c => [c.col, c.from, c.to]), [['Employee ID', '00412', '412'], ['Cell Phone', '3045550111', '3045550199']]);
  assert.equal(r.tabs.drivers.off.length, 1);
  assert.equal(r.tabs.drivers.off[0].label, 'Lee Casey (518)');
  assert.equal(r.totals.OFF, 1);
  // Routes were not in this file: they stay as saved and are not counted.
  assert.equal(r.tabs.routes, undefined);
  const same = U.check(U.readBook([routes]), first);
  assert.equal(same.totals.SAME, 2);
});

test('problems: blanks, bad cells, repeats and references to other tabs', () => {
  const week = sheet('regularWeek', [
    ['412', 'Off', '', 'Yes', '803 Load 1', 'Yes', '812 Load 1', 'Yes', '', 'Yes', '', 'Yes', '', 'Off', '803 Load 2'],
    ['999', 'Yes', '', 'Yes', '', 'Yes', '', 'Yes', '', 'Yes', '', 'Yes', '', 'Yes', '']
  ]);
  const days = sheet('routeDays', [['803', 'Load 1', 'Mon', 'Yes', '4:00 AM', '', '', '', 'Day before', ''], ['777', 'Load 1', 'Mon', 'Yes', '4 AM', '', '', '', 'Same day', '']]);
  const dup = sheet('drivers', [['00412', 'Pat Adams', 'Active', '', '', '', '', ''], ['412', 'P Adams', 'Active', '', '', '', '', ''], ['', 'No Id', 'Active', '', '', 'June', '', '']]);
  const r = U.check(U.readBook([routes, dup, week, days]), {});
  assert.equal(r.ok, false);
  const p = (k) => r.tabs[k].rows.filter(x => x.status === 'PROBLEM').map(x => x.problems.join(' / '));
  assert.deepEqual(p('drivers'), ['Same as row 2 (each Employee ID once)', 'Employee ID is blank / Hire Date: write dates like 10-8-26 ("June")']);
  assert.deepEqual(p('regularWeek'), ['Tue: route 812 Load 1 is not on the Routes tab / Sat: has a route but is Off', 'Employee ID 999 is not on the Drivers tab']);
  assert.deepEqual(p('routeDays'), ['Route 777 Load 1 is not on the Routes tab']);
});

test('a tab is refused when it has a Social Security, birth date or address column, or misses a must-fill column', () => {
  const bad = { name: 'Drivers', cells: [head('drivers').concat(['SSN', 'Date of Birth', 'Home Address']), ['1', 'A B', 'Active', '', '', '', '', '', '123-45-6789', '1-1-80', '1 Main']] };
  const r = U.check(U.readBook([bad]), {});
  assert.equal(r.ok, false);
  assert.match(r.tabs.drivers.tabProblems[0], /Take out the SSN, Date of Birth, Home Address columns/);
  const short = { name: 'Routes', cells: [['Route #', 'Load'], ['803', '1']] };
  // Load Type is no longer a must-fill column (blank = None, as in the app), so only the route name is missing.
  assert.match(U.check(U.readBook([short]), {}).tabs.routes.tabProblems[0], /Missing column: Customer \/ Route Name\. /);
});

test('people need a United Dairy email and a role from the list', () => {
  const r = U.check(U.readBook([sheet('people', [['Sam', 'sam@gmail.com', 'Boss', 'This plant', 'Yes']])]), {});
  assert.deepEqual(r.tabs.people.rows[0].problems, ['Email: must end in @uniteddairy.com ("sam@gmail.com")', 'Role: pick one of: ' + U.ROLES.join(', ') + ' ("Boss")']);
});

// The committed workbook (public/templates/Plant-Setup-Workbook.xlsx), unzipped with Node's own zlib: no new package.
function unzip(file) {
  const b = fs.readFileSync(file), out = {};
  let e = b.length - 22;
  while (e >= 0 && b.readUInt32LE(e) !== 0x06054b50) e--;
  assert.ok(e >= 0, 'not a zip file');
  let at = b.readUInt32LE(e + 16);
  for (let n = b.readUInt16LE(e + 10); n > 0; n--) {
    assert.equal(b.readUInt32LE(at), 0x02014b50);
    const method = b.readUInt16LE(at + 10), size = b.readUInt32LE(at + 20), nameLen = b.readUInt16LE(at + 28), extra = b.readUInt16LE(at + 30), note = b.readUInt16LE(at + 32), local = b.readUInt32LE(at + 42);
    const name = b.toString('utf8', at + 46, at + 46 + nameLen);
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28), data = b.subarray(start, start + size);
    out[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    at += 46 + nameLen + extra + note;
  }
  return out;
}
const unxml = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function readXlsx(file) {
  const z = unzip(file);
  const shared = [...(z['xl/sharedStrings.xml'] || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')));
  const rels = {};
  [...z['xl/_rels/workbook.xml.rels'].matchAll(/<Relationship\b[^>]*>/g)].forEach(m => { const id = /Id="([^"]+)"/.exec(m[0])[1], target = /Target="([^"]+)"/.exec(m[0])[1]; rels[id] = target.replace(/^\/?(xl\/)?/, 'xl/'); });
  return [...z['xl/workbook.xml'].matchAll(/<sheet\b[^>]*>/g)].map(m => {
    const name = unxml(/name="([^"]*)"/.exec(m[0])[1]), xml = z[rels[/r:id="([^"]+)"/.exec(m[0])[1]]];
    const rowOf = (r) => {
      const row = (new RegExp('<row[^>]*\\br="' + r + '"[^>]*>([\\s\\S]*?)</row>').exec(xml) || [, ''])[1], cells = [];
      [...row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].forEach(c => {
        const ref = /r="([A-Z]+)\d+"/.exec(c[1])[1], col = [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1, type = (/t="([^"]+)"/.exec(c[1]) || [])[1], body = c[2] || '';
        const v = (/<v>([\s\S]*?)<\/v>/.exec(body) || [])[1], is = (/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(body) || [])[1];
        cells[col] = type === 's' ? shared[Number(v)] : type === 'inlineStr' ? unxml(is || '') : v === undefined ? '' : unxml(v);
      });
      return Array.from(cells, x => x === undefined ? '' : x);
    };
    // Each <col>'s style's number format (49 is Text, "@"), by column number.
    const xfs = [...((/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(z['xl/styles.xml']) || [])[1] || '').matchAll(/<xf\b[^>]*>/g)].map(x => Number((/numFmtId="(\d+)"/.exec(x[0]) || [, 0])[1]));
    const colFormat = {};
    [...xml.matchAll(/<col\b[^>]*>/g)].forEach(c => { const st = /style="(\d+)"/.exec(c[0]); for (let n = Number(/min="(\d+)"/.exec(c[0])[1]); n <= Number(/max="(\d+)"/.exec(c[0])[1]); n++) colFormat[n] = st ? xfs[Number(st[1])] : 0; });
    const validations = [...xml.matchAll(/<dataValidation\b[^>]*sqref="([^"]+)"/g)].map(m => m[1]);
    return { name, rowOf, colFormat, validations };
  });
}

test('the committed workbook: every tab name and row-1 heading is the rules\' own (with * on must-fill), and its example rows', () => {
  const book = readXlsx(path.join(ROOT, 'public', 'templates', 'Plant-Setup-Workbook.xlsx'));
  assert.deepEqual(book.map(s => s.name), ['How to fill'].concat(U.SPEC.map(t => t.tab)));
  assert.equal(U.SPEC.length, 21);
  U.SPEC.forEach((t, i) => {
    const s = book[i + 1], h = s.rowOf(1);
    assert.deepEqual(h.slice(0, t.cols.length), head(t.key), t.tab);
    assert.equal(h[t.cols.length] || '', '', t.tab + ': nothing right after the headings');
    assert.equal(h[t.cols.length + 1], t.about, t.tab + ': the tab note');
    t.examples.forEach((e, n) => assert.deepEqual(t.cols.map((c, j) => s.rowOf(n + 2)[j] || ''), e, t.tab + ' example row ' + (n + 2)));
    // Every column is Text as a whole (a column style, so the file stays small and leading zeros keep on every row).
    t.cols.forEach((c, j) => assert.equal(s.colFormat[j + 1], 49, t.tab + ' / ' + c.h + ' is a Text column'));
    // Drop-downs on rows 2 to MAX_ROWS + 1.
    assert.deepEqual(s.validations, t.cols.map((c, j) => [c, j]).filter(([c]) => c.choices).map(([, j]) => { const L = String.fromCharCode(65 + j); return L + '2:' + L + (U.MAX_ROWS + 1); }), t.tab);
  });
  assert.ok(fs.statSync(path.join(ROOT, 'public', 'templates', 'Plant-Setup-Workbook.xlsx')).size < 300000, 'the workbook stays small');
  // The How to fill tab lists every column of every tab.
  const how = book[0], listed = [];
  for (let r = 1; r < 400; r++) { const row = how.rowOf(r); if (row[0] && row[2]) listed.push(row[0] + ' / ' + row[2]); }
  assert.deepEqual(listed.slice(1), U.SPEC.flatMap(t => t.cols.map(c => t.tab + ' / ' + c.h)));
});

test('every tab\'s example rows pass the rules together (cross-tab references too), and are skipped when left in a file', () => {
  const tabs = {};
  U.SPEC.forEach(t => { tabs[t.key] = { key: t.key, tab: t.tab, rows: t.examples.map((e, n) => ({ n: n + 2, raw: Object.fromEntries(t.cols.map((c, j) => [c.key, e[j]])) })), missing: [], unknown: [], pii: [], exampleSkipped: false }; });
  const r = U.check({ tabs, extra: [] }, {});
  const problems = Object.values(r.tabs).flatMap(t => t.rows.filter(x => x.problems.length).map(x => t.tab + ': ' + x.problems.join(' / ')));
  assert.deepEqual(problems, []);
  assert.equal(r.ok, true);
  assert.equal(r.totals.NEW, U.SPEC.reduce((n, t) => n + t.examples.length, 0));
  const left = U.readBook(U.SPEC.map(t => sheet(t.key, t.examples)));
  U.SPEC.forEach(t => { assert.equal(left.tabs[t.key].exampleSkipped, true, t.tab); assert.equal(left.tabs[t.key].rows.length, 0, t.tab); });
});

test('the drop-downs are the app\'s own lists: stations, days off, shifts, lines, routes', () => {
  const choices = (key, h) => U.BY_KEY[key].cols.find(c => c.h === h).choices;
  const S = require('../../src/stations');
  assert.deepEqual(choices('stations', 'Kind'), Object.values(S.KINDS).flatMap(k => Object.values(k.types)));
  const actions = src('functions/src/actions.js'), list = (name) => JSON.parse(new RegExp('const ' + name + ' = (\\[[^\\]]*\\]);').exec(actions)[1].replace(/'/g, '"'));
  assert.deepEqual(choices('daysOff', 'Type'), list('EXCEPTION_REASONS'));
  assert.deepEqual(choices('daysOff', 'Status'), list('VACATION_STATUSES'));
  // plant-reports.js SHIFT_SIDES ([value, label]) and plant.js savePlantShifts' own values.
  const sides = JSON.parse(/export const SHIFT_SIDES = Object\.freeze\((\[[\s\S]*?\]\])\);/.exec(src('public/js/plant-reports.js'))[1].replace(/'/g, '"'));
  assert.deepEqual(U.SHIFT_SIDES, sides);
  assert.deepEqual(choices('shifts', 'Side'), sides.map(x => x[1]));
  assert.deepEqual(sides.map(x => x[0]), JSON.parse(/SHIFT_SIDES = (\[[^\]]*\])/.exec(src('functions/src/plant.js'))[1].replace(/'/g, '"')));
  const P = require('../../src/production-rules');
  assert.deepEqual(choices('lines', 'Counted By'), P.COUNTERS.map(c => P.COUNTER_LABEL[c].replace(/\s*\(.*\)$/, '')));
  assert.equal(choices('lines', 'Counted By')[0], P.COUNTER_LABEL.TABLET);
  assert.deepEqual(choices('lines', 'Fill Check Due'), P.FILL_MODES.map(m => m[1]));
  ['GALLON FILLER', 'HTST #1', 'htst 2', 'BLOW MOLD', 'Blow-Mold', 'BOXING', 'RAYPAK', 'TOTES', 'CASES', 'TANKER', 'HALF GALLON FILLER'].forEach(n => {
    assert.equal(U.lineKind(n), P.lineKind(n), n); assert.equal(U.hasFill(n), P.hasFill(n), n);
  });
  assert.ok(!U.BY_KEY.lines.cols.some(c => c.h === 'Kind'), 'the kind of line comes from its name, as in the app');
  const routes = src('public/routes.html'), arr = (name) => JSON.parse(new RegExp('const ' + name + ' = (\\[[^\\]]*\\]);').exec(routes)[1].replace(/'/g, '"'));
  assert.deepEqual(choices('routes', 'Load Type'), arr('LOADOUT'));
  assert.deepEqual(choices('routes', 'Run By'), arr('RUN_BY'));
  assert.ok(arr('RUN_BY').indexOf('Martins Ferry') >= 0);
  const products = src('public/js/products.js'), plain = (name) => JSON.parse(new RegExp('export const ' + name + ' = (\\[[^\\]]*\\]);').exec(products)[1].replace(/'/g, '"'));
  assert.deepEqual(choices('products', 'Type'), plain('START_TYPES'));
  const groups = plain('START_GROUPS').concat(plain('JOE_GROUPS').filter(g => !plain('START_GROUPS').some(x => x.toUpperCase() === g.toUpperCase())));
  assert.deepEqual(choices('products', 'Group'), groups);
});

test('the Products tab has the Product Sheet template\'s own headings (products.js TEMPLATE, the plant picked on screen)', () => {
  const products = src('public/js/products.js');
  const fields = /export const FIELDS = \[([\s\S]*?)\n\];/.exec(products)[1], heads = [...fields.matchAll(/head: '([^']+)'/g)].map(m => m[1]);
  assert.ok(/export const TEMPLATE = \['Plant', 'Area'\]\.concat\(FIELDS\.map\(f => f\.head\)\);/.test(products), 'products.js TEMPLATE is Plant, Area, then the FIELDS headings');
  assert.deepEqual(U.BY_KEY.products.cols.map(c => c.h), ['Area'].concat(heads));
  assert.deepEqual(U.BY_KEY.products.cols.slice(1).map(c => c.key), [...fields.matchAll(/k: '([^']+)'/g)].map(m => m[1]));
  assert.ok(head('products').slice(0, 2).every(h => / \*$/.test(h)), 'Area and Product must be filled');
});

test('the app\'s rules on each tab: run days, relief drivers, several runs a day, lines, products, shifts, safety, limits', () => {
  const rows = (key, list) => sheet(key, list);
  const R = (cells) => { const r = U.BY_KEY.routes.cols.map(() => ''); Object.keys(cells).forEach(h => { r[U.BY_KEY.routes.cols.findIndex(c => c.h === h)] = cells[h]; }); return r; };
  const routesTab = rows('routes', [R({ 'Route #': '803', Load: '1', 'Customer / Route Name': 'DSD' }), R({ 'Route #': '812', Load: '2', 'Customer / Route Name': 'KROGER', 'Carrier Name': 'ACME' }),
    R({ 'Route #': '900', Load: '1', 'Customer / Route Name': 'OTR', 'Who Runs It': 'Outside Carrier', 'Carrier Name': 'acme freight' })]);
  const days = rows('routeDays', [['803', '1', 'Mon', 'Yes', '', '', '', '', '', ''], ['803', '1', 'Tue', 'No', '', '', '', '', '', ''], ['803', '1', 'Wed', 'Yes', '4 AM', '', '', '', '-2', ''],
    ['803', '1', 'Thu', 'Yes', '4 AM', '', '', '', '-7', ''], ['803', '1', 'Fri', 'Yes', '4 AM', '', '', '', '6 days before', '']]);
  const drivers = rows('drivers', [['1', 'A One', 'Active', '', 'No', '', '', ''], ['2', 'B Two', 'Active', '', 'Yes', '', '', '']]);
  const week = rows('regularWeek', [['1', '', '', 'Yes', '803 Load 1; 812 Load 2', 'Yes', '', 'Yes', '', 'Yes', '', 'Yes', '', 'Off', ''],
    ['2', '', '', '', '812 Load 2', '', '', '', '', '', '', '', '', '', '']]);
  const r = U.check(U.readBook([routesTab, days, drivers, week]), {});
  const p = (k) => r.tabs[k].rows.map(x => x.problems.join(' / '));
  assert.deepEqual(p('routes'), ['', 'Carrier Name is only for Who Runs It = Outside Carrier', '']);
  assert.equal(r.tabs.routes.rows[0].values.load, 'Load 1');
  assert.equal(r.tabs.routes.rows[2].values.carrier, 'ACME FREIGHT');
  assert.deepEqual(p('routeDays'), ['Dispatch Time is blank (it runs that day) / Loaded is blank (it runs that day)', '', '', 'Loaded: pick one of: ' + U.LOADED.join(', ') + ' (or 0 to -6) ("-7")', '']);
  assert.equal(r.tabs.routeDays.rows[2].values.loaded, '2 days before');
  assert.equal(r.tabs.routeDays.rows[4].values.loaded, '6 days before');
  assert.deepEqual(p('regularWeek'), ['Sun Works is blank (Yes or Off; only a Relief Driver may leave it blank)', 'Mon: 812 Load 2 is already Employee ID 1\'s run (one driver a day)']);
  assert.equal(r.tabs.regularWeek.rows[0].values.monRoute, '803 Load 1; 812 Load 2');
  assert.match(U.read(U.BY_KEY.regularWeek.cols[2], '803 Load 1; 803 1').bad, /twice/);
  // Days off: the app's own words; blank Status is APPROVED in the app.
  const off = U.check(U.readBook([drivers, rows('daysOff', [['1', '11-2-26', '', 'sick day', '', ''], ['1', '11-3-26', '', 'Sick', '', ''], ['2', '1-1-26', '3-1-27', 'VACATION', 'pending', '']])]), {});
  assert.deepEqual(off.tabs.daysOff.rows.map(x => x.problems.join(' / ')), ['', 'Type: pick one of: ' + U.EXCEPTION_REASONS.join(', ') + ' ("Sick")', 'At most a year from Start Date to End Date']);
  assert.equal(off.tabs.daysOff.rows[0].values.type, 'SICK DAY');
  // Lines: each box only on its kind of line, the app's highest numbers, Fed By a filler on the tab.
  const L = (cells) => { const row = U.BY_KEY.lines.cols.map(() => ''); Object.keys(cells).forEach(h => { const i = U.BY_KEY.lines.cols.findIndex(c => c.h === h); assert.ok(i >= 0, h); row[i] = cells[h]; }); return row; };
  const lines = U.check(U.readBook([rows('lines', [L({ 'Line Name': 'GALLON FILLER', 'Jug Weight Target (g)': '60', 'Per Box': '4' }), L({ 'Line Name': 'BLOW MOLD', 'Jug Weight Low (g)': '62', 'Jug Weight High (g)': '58', 'Empty Jug (g)': '60' }),
    L({ 'Line Name': 'BOXING', 'Fed By': 'GALLON FILLER, BLOW MOLD, NOPE', 'Per Box': '4', 'Fill Check Every': '30' }), L({ 'Line Name': 'HTST 1', 'Changeover Minutes': '601', 'Wash (CIP) Every Hours': '73' }),
    L({ 'Line Name': 'QUART FILLER', 'Empty Jug (g)': '2001', 'Cap (g)': '201', 'Light When Under By (g)': '1001', 'Jug Weight High (g)': '501' }), L({ 'Line Name': 'TOTES', 'Per Box': '1001', 'Counted By': 'Tablet' })])]), {});
  assert.deepEqual(lines.tabs.lines.rows.map(x => x.problems.join(' / ')), [
    'Jug Weight Target (g): BLOW MOLD only (GALLON FILLER is Fillers) / Per Box: BOXING, RAYPAK and TOTES only (GALLON FILLER is Fillers)',
    'Empty Jug (g): fillers and the RAYPAK / BOXING bag fillers only (BLOW MOLD is Blow Mold) / Jug Weight Low is above High',
    'Fill Check Every needs Fill Check Due of Every so many minutes or jugs / Fed By: BLOW MOLD is not a filler / Fed By: NOPE is not on the Lines tab',
    'Changeover Minutes: type a number from 0 to 600 ("601") / Wash (CIP) Every Hours: type a number from 0 to 72 ("73")',
    'Jug Weight High (g): type a number from 0 to 500 ("501") / Empty Jug (g): type a number from 0 to 2000 ("2001") / Cap (g): type a number from 0 to 200 ("201") / Light When Under By (g): type a number from 0 to 1000 ("1001")',
    'Counted By: pick one of: ' + U.COUNTED_BY.join(', ') + ' ("Tablet") / Per Box: type a number from 0 to 1000 ("1001")']);
  assert.equal(lines.tabs.lines.rows[0].label, 'GALLON FILLER · Fillers');
  // Products: Lowest not above Highest, the app's lists, several groups.
  const prod = U.check(U.readBook([rows('products', [['CASES', 'GAL MILK', '', '', 'gallon', 'drinks, tea', '60', '85', '70', '50', '', ''], ['CASES', 'QT MILK', '', '', 'Jug', 'Soda', '', '101', '', '', '', '']])]), {});
  assert.deepEqual(prod.tabs.products.rows.map(x => x.problems.join(' / ')), ['Lowest Speed is above Highest Speed',
    'Type: pick one of: ' + U.PRODUCT_TYPES.join(', ') + ' ("Jug") / Group: pick from: ' + U.PRODUCT_GROUPS.join(', ') + ', comma between ("Soda") / Target %: type a number from 0 to 100 ("101")']);
  assert.equal(prod.tabs.products.rows[0].values.productGroup, 'Drinks, TEA');
  assert.equal(prod.tabs.products.rows[0].values.mfgType, 'Gallon');
  // PM Tasks: Every is a whole number from 1 to 999.
  const every = U.BY_KEY.pmTasks.cols.find(c => c.key === 'every');
  assert.ok(U.read(every, '1.5').bad); assert.ok(U.read(every, '0').bad); assert.ok(U.read(every, '1000').bad); assert.deepEqual(U.read(every, '999'), { v: '999' });
  // Shifts: one name once on each side (blank = Distribution), start not the end.
  const sh = U.check(U.readBook([rows('shifts', [['1st Shift', '6 AM', '2:30 PM', ''], ['1st Shift', '6 AM', '2:30 PM', 'Plant Production'], ['1st shift', '7 AM', '3 PM', 'distribution'], ['Night', '10 PM', '10:00 PM', '']])]), {});
  assert.deepEqual(sh.tabs.shifts.rows.map(x => x.problems.join(' / ')), ['', '', 'Same as row 2 (each row once)', 'Starts and Ends are the same time']);
  assert.equal(sh.tabs.shifts.rows[1].label, '1st Shift (Plant Production)');
  // Safety Checklist: each item in an area and sub-area on Location Areas.
  const areas = rows('locationAreas', [['Plant', 'Processing & Filler Rooms'], ['Office', '']]);
  const safe = U.check(U.readBook([areas, rows('safety', [['Plant', 'Processing & Filler Rooms', 'Exits clear', 'Weekly'], ['Plant', 'Coolers', 'Doors open', 'Weekly'], ['Garage', 'Bay', 'Lights', 'Monthly'], ['Plant', 'Processing & Filler Rooms', 'Exits clear', 'Monthly'], ['Plant', 'Processing & Filler Rooms', 'x'.repeat(161), 'Weekly']])]), {});
  assert.deepEqual(safe.tabs.safety.rows.map(x => x.problems.join(' / ')), ['', 'Sub-area Coolers is not under Plant on the Location Areas tab', 'Area Garage is not on the Location Areas tab',
    'Same as row 2 (each row once)', 'Check Item: too long (160 letters at most) ("' + 'x'.repeat(40) + '")']);
  assert.equal(U.keyOf('safety', { area: 'Plant', sub: 'Coolers', item: 'Doors' }), 'PLANT|COOLERS|DOORS');
  // Fire extinguishers, suppliers, coolers and the text limits the app has.
  const col = (key, h) => U.BY_KEY[key].cols.find(c => c.h === h);
  assert.deepEqual(U.read(col('extinguishers', 'Tag #'), 'fe-01'), { v: 'FE-01' });
  assert.ok(U.read(col('extinguishers', 'Tag #'), 'FE 01').bad); assert.ok(U.read(col('extinguishers', 'Tag #'), 'A'.repeat(13)).bad);
  assert.ok(U.read(col('extinguishers', 'Location'), 'x'.repeat(81)).bad); assert.ok(U.read(col('extinguishers', 'Size'), 'x'.repeat(21)).bad);
  assert.deepEqual(U.read(col('suppliers', 'Code'), 'di_1'), { v: 'DI_1' }); assert.ok(U.read(col('suppliers', 'Code'), 'ABCDEFGHI').bad); assert.ok(U.read(col('suppliers', 'Code'), 'A B').bad);
  assert.ok(U.read(col('coolers', 'Stale Minutes'), '0').bad); assert.ok(U.read(col('coolers', 'Stale Minutes'), '2.5').bad); assert.deepEqual(U.read(col('coolers', 'Stale Minutes'), '45'), { v: '45' });
  [['machines', 'Machine Name', 60], ['machines', 'Notes', 500], ['suppliers', 'Supplier Name', 60], ['suppliers', 'Short Name', 40], ['garageTechs', 'Technician Name', 40], ['shifts', 'Shift Name', 40],
    ['products', 'Product', 120], ['products', 'SKU', 40], ['stations', 'Station Name', 60], ['safety', 'Check Item', 160], ['pmTasks', 'Task', 120], ['drivers', 'Driver Name', 120]].forEach(([k, h, max]) => {
    assert.equal(col(k, h).max, max, k + ' / ' + h);
    assert.ok(!U.read(col(k, h), 'x'.repeat(max)).bad, h); assert.match(U.read(col(k, h), 'x'.repeat(max + 1)).bad, new RegExp('too long \\(' + max + ' letters'), h);
  });
  // Drivers: no Notes column (the app keeps no driver note); one Cell Phone, the Driver Roster's.
  assert.deepEqual(U.BY_KEY.drivers.cols.map(c => c.key), ['employeeId', 'name', 'status', 'phone', 'relief', 'hired', 'seniority', 'boardOrder']);
  assert.match(col('drivers', 'Cell Phone').goes, /Driver Roster/);
  assert.ok(U.BY_KEY.locationAreas && !U.SPEC.some(t => /Walkthrough Areas/.test(t.tab)));
});
