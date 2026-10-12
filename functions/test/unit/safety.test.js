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

test('The starting checklist: Plant, Garage, Office and Yard with their sub-areas in walking order; monthly items on the month\'s first walk only', () => {
  // Joe 10/12 (mock-up A): places, then sub-areas; the researched items keep their ids.
  const P = S.places(S.checklist(null));
  // Joe 10/12 (Location Areas): the outside walk moved from Plant to its own Yard area.
  assert.deepEqual(P.map(p => p.name), ['Plant', 'Garage', 'Office', 'Yard']);
  assert.deepEqual(P[0].areas.map(a => a.name), ['Receiving & Docks', 'Processing & Filler Rooms', 'Ammonia Room', 'Chemical Room', 'Coolers', 'Forklifts & Charging', 'Electrical Rooms', 'Stairs, Aisles & PPE', 'Exits & Fire']);
  assert.deepEqual(P[1].areas.map(a => a.name), ['Repair Bays', 'Fuel Island', 'Wash Bay', 'Parts & Tires', 'Garage Exits & Eyewash']);
  assert.deepEqual(P[2].areas.map(a => a.name), ['Front Office', 'Break Room', 'Locker Rooms', 'Stairs & Exits']);
  assert.deepEqual(P[3].areas.map(a => a.name), ['Parking Lot & Walkways'], 'yard sub-areas with no items stay off the walk');
  assert.equal(S.findItem(null, 'floors').area, 'Plant \u203a Processing & Filler Rooms');
  assert.equal(S.checklist({ areas: [{ key: 'x', name: 'Old area', items: [{ id: 'a', text: 'A' }] }] })[0].place, 'Plant', 'a checklist saved before places is under Plant');
  const ids = S.checklist(null).flatMap(a => a.items.map(i => i.id));
  assert.equal(new Set(ids).size, ids.length, 'every item has its own id');
  const all = S.walkList(null, true).flatMap(a => a.items.map(i => i.id)), weekly = S.walkList(null, false).flatMap(a => a.items.map(i => i.id));
  assert.ok(all.indexOf('ext_monthly') >= 0 && weekly.indexOf('ext_monthly') < 0, 'the extinguisher item is monthly');
  assert.ok(weekly.indexOf('eyewash_run') >= 0, 'eyewash is weekly (ANSI Z358.1)');
  assert.equal(all.length - weekly.length, 8, 'extinguishers, emergency lights, first aid, AED and SCBA; office first aid, emergency light and evacuation map');
});

test('Location Areas: the starting list, and the walk follows its order, names and what is turned off', () => {
  const L = S.locations(null);
  assert.deepEqual(L.map(a => a.name), ['Plant', 'Garage', 'Office', 'Yard']);
  assert.deepEqual(L[3].subs.map(x => x.name), ['Parking Lot & Walkways', 'Truck Yard', 'Outside Storage']);
  assert.equal(S.checklist(null, true).length, 21, 'setup screens show every sub-area, empty ones too');
  // Rename a sub-area, turn one off, turn the Garage off, put Office first.
  const locs = S.locations(null);
  locs[0].subs[0].name = 'Docks';
  locs[0].subs[2].off = true;
  locs[1].off = true;
  const saved = [locs[2], locs[0], locs[1], locs[3]];
  const P = S.places(S.checklist({ locations: { areas: saved } }));
  assert.deepEqual(P.map(p => p.name), ['Office', 'Plant', 'Yard']);
  assert.equal(P[1].areas[0].name, 'Docks');
  assert.ok(!P[1].areas.some(a => a.key === 'ammonia'), 'a sub-area turned off is left off the walk');
  assert.equal(S.findItem({ locations: { areas: saved } }, 'g_lifts').area, 'Garage \u203a Repair Bays', 'items under a turned-off area are still found for old walks');
  // Items Checklist Setup moved to a yard sub-area put it on the walk.
  const setup = { locations: { areas: saved }, areas: [{ key: 'yard_truck', items: [{ id: 'yt', text: 'Trailers chocked', freq: 'WEEKLY' }] }] };
  assert.equal(S.findItem(setup, 'yt').area, 'Yard \u203a Truck Yard');
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
