'use strict';
// Safety Walkthrough's shared rules (Joe 10/12): the checklist, monthly items on the month's first walk only, how long an
// issue has been open, an extinguisher's month and its service dates.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('../../src/safety-rules');

test('The screens and the server use the same Safety Walkthrough rules', () => {
  assert.equal(fs.readFileSync(path.join(__dirname, '../../src/safety-rules.js'), 'utf8'), fs.readFileSync(path.join(__dirname, '../../../public/js/safety-rules.js'), 'utf8'));
});

test('The starting checklist covers the researched areas, and monthly items are on the month\'s first walk only', () => {
  const names = S.checklist(null).map(a => a.name);
  assert.deepEqual(names, ['Fire & Exits', 'Eyewash & First Aid', 'Ammonia Room', 'Forklifts & Docks', 'Lockout & Guarding', 'Chemicals & Cylinders', 'Electrical', 'Housekeeping & Floors', 'PPE', 'Coolers & Yard']);
  const ids = S.checklist(null).flatMap(a => a.items.map(i => i.id));
  assert.equal(new Set(ids).size, ids.length, 'every item has its own id');
  const all = S.walkList(null, true).flatMap(a => a.items.map(i => i.id)), weekly = S.walkList(null, false).flatMap(a => a.items.map(i => i.id));
  assert.ok(all.indexOf('ext_monthly') >= 0 && weekly.indexOf('ext_monthly') < 0, 'the extinguisher item is monthly');
  assert.ok(weekly.indexOf('eyewash_run') >= 0, 'eyewash is weekly (ANSI Z358.1)');
  assert.equal(all.length - weekly.length, 5, "extinguishers, emergency lights, first aid, AED and SCBA");
});

test('A plant\'s own checklist: items turned off are left off the walk but still found for old walks', () => {
  const setup = { areas: [{ key: 'fire', name: 'Fire & Exits', items: [{ id: 'exit_routes', text: 'Exits clear', freq: 'WEEKLY' }, { id: 'exit_signs', text: 'Exit signs lit', freq: 'WEEKLY', off: true }] }] };
  assert.deepEqual(S.walkList(setup, false).flatMap(a => a.items.map(i => i.id)), ['exit_routes']);
  assert.equal(S.findItem(setup, 'exit_signs').text, 'Exit signs lit');
  assert.equal(S.findItem(setup, 'nope'), null);
});

test('Counts on a walk, days open and repeats', () => {
  const list = S.walkList(null, false);
  const c = S.walkCounts({ items: { exit_routes: { status: 'GOOD' }, exit_signs: { status: 'NOT_GOOD' }, alarm_valves: { status: '' } } }, list);
  assert.deepEqual([c.good, c.notGood], [1, 1]);
  assert.equal(c.notChecked, c.total - 2);
  assert.equal(S.daysOpen({ foundOn: '2026-10-05', status: 'OPEN' }, '2026-10-12'), 7);
  assert.equal(S.daysOpen({ foundOn: '2026-09-07', status: 'FIXED', fixedOn: '2026-09-10' }, '2026-10-12'), 3);
  assert.equal(S.isRepeat({ walks: ['a', 'b'] }), true);
  assert.equal(S.isRepeat({ walks: ['a'] }), false);
});

test('An extinguisher\'s month and its service dates', () => {
  const items = Object.fromEntries(S.EXT_ITEMS.map(i => [i[0], 'GOOD']));
  assert.equal(S.extMonth({ checks: { '2026-10': { items } } }, '2026-10').state, 'GOOD');
  assert.equal(S.extMonth({ checks: { '2026-10': { items: { gauge: 'GOOD' } } } }, '2026-10').state, 'DUE');
  const bad = S.extMonth({ checks: { '2026-10': { items: Object.assign({}, items, { gauge: 'NOT_GOOD' }) } } }, '2026-10');
  assert.deepEqual([bad.state, bad.bad], ['NOT_GOOD', ['Gauge needle in the green']]);
  assert.equal(S.extMonth({}, '2026-10').state, 'DUE');
  assert.equal(S.dueState('2026-10-11', '2026-10-12'), 'PAST');
  assert.equal(S.dueState('2026-11-10', '2026-10-12'), 'SOON');
  assert.equal(S.dueState('2027-03-15', '2026-10-12'), 'OK');
  assert.equal(S.dueState('', '2026-10-12'), '');
  assert.equal(S.extId('fac_uniontown', '04'), 'fac_uniontown__04');
});
