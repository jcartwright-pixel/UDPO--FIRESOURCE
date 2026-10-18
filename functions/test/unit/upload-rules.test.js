'use strict';
// The Upload Center's checks (Joe 10/18): one workbook, each row New, Changed, Same or a Problem, a saved row not in the file
// Taken off; no trucks or trailers; never SSN, birth dates or addresses.
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../../src/upload-rules');

const head = (key) => U.BY_KEY[key].cols.map(c => c.h + (c.req ? ' *' : ''));
const sheet = (key, rows) => ({ name: U.BY_KEY[key].tab, cells: [head(key)].concat(rows) });
const routes = sheet('routes', [
  ['803', 'Load 1', 'DSD MILK', '', '', 'Case Loadout', 'United Dairy', 'Charleston', 'Delivery Day', 'No', 'No', '51', 'Yes', 'Yes', 'Yes', 'Yes', 'Active', ''],
  ['803', '2', 'DSD', '', '', 'case loadout', 'united dairy', '', '', '', '', '', 'y', 'yes', 'YES', 'no', 'active', '']
]);
const drivers = sheet('drivers', [
  ['00412', 'Pat Adams', 'Active', '(304) 555-0111', 'No', '3/15/19', '', '', ''],
  ['518', 'Lee Casey', 'Active', '', 'Yes', '10-8-26', '', '', '']
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
  const again = sheet('drivers', [['412', 'Pat Adams', 'Active', '3045550199', 'No', '3-15-19', '', '', '']]);
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
  const dup = sheet('drivers', [['00412', 'Pat Adams', 'Active', '', '', '', '', '', ''], ['412', 'P Adams', 'Active', '', '', '', '', '', ''], ['', 'No Id', 'Active', '', '', 'June', '', '', '']]);
  const r = U.check(U.readBook([routes, dup, week, days]), {});
  assert.equal(r.ok, false);
  const p = (k) => r.tabs[k].rows.filter(x => x.status === 'PROBLEM').map(x => x.problems.join(' / '));
  assert.deepEqual(p('drivers'), ['Same as row 2 (each Employee ID once)', 'Employee ID is blank / Hire Date: write dates like 10-8-26 ("June")']);
  assert.deepEqual(p('regularWeek'), ['Tue: route 812 Load 1 is not on the Routes tab / Sat: has a route but is Off', 'Employee ID 999 is not on the Drivers tab']);
  assert.deepEqual(p('routeDays'), ['Route 777 Load 1 is not on the Routes tab']);
});

test('a tab is refused when it has a Social Security, birth date or address column, or misses a must-fill column', () => {
  const bad = { name: 'Drivers', cells: [head('drivers').concat(['SSN', 'Date of Birth', 'Home Address']), ['1', 'A B', 'Active', '', '', '', '', '', '', '123-45-6789', '1-1-80', '1 Main']] };
  const r = U.check(U.readBook([bad]), {});
  assert.equal(r.ok, false);
  assert.match(r.tabs.drivers.tabProblems[0], /Take out the SSN, Date of Birth, Home Address columns/);
  const short = { name: 'Routes', cells: [['Route #', 'Load'], ['803', '1']] };
  assert.match(U.check(U.readBook([short]), {}).tabs.routes.tabProblems[0], /Missing columns: Customer \/ Route Name, Load Type/);
});

test('people need a United Dairy email and a role from the list', () => {
  const r = U.check(U.readBook([sheet('people', [['Sam', 'sam@gmail.com', 'Boss', 'This plant', 'Yes']])]), {});
  assert.deepEqual(r.tabs.people.rows[0].problems, ['Email: must end in @uniteddairy.com ("sam@gmail.com")', 'Role: pick one of: ' + U.ROLES.join(', ') + ' ("Boss")']);
});
