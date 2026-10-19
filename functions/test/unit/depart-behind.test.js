'use strict';
// Behind is measured from when the route leaves, not from the loadout day (Joe 10/11: a Saturday loadout for Monday showed
// "14 routes behind" at 12:27 AM Sunday). The route leaves on its departure date (blank = delivery date) at its dispatch time;
// a load made earlier leaves in the operating day before, since the day rolls at 6 a.m. (Joe 10/19: Tuesday's 1 PM Jersey leaves Monday).
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../src/plant-rules');

const at = (iso) => Date.parse(iso); // New York is UTC-4 in October
const load = (route, time, extra) => Object.assign({ route, run: 'X', area: 'CASE', state: 'WAITING', loadDate: '2026-10-10', deliveryDate: '2026-10-12', dispatchTime: time, prior: false }, extra || {});
const day = (k) => Math.round(Date.UTC(...k.split('-').map((v, i) => i === 1 ? v - 1 : +v)) / 86400000) * 1440;

test('a route leaves at its dispatch time in the operating day before its departure date, never on the load day', () => {
  assert.equal(R.departWall(load('971', 0)), day('2026-10-12'), 'Saturday load for Monday, 12:00 AM = Monday midnight');
  assert.equal(R.departWall(load('844', 1080)), day('2026-10-11') + 1080, 'Saturday load for Monday, 6:00 PM = Sunday evening (the day rolls at 6 a.m.)');
  assert.equal(R.departWall(load('852', 780, { loadDate: '2026-10-19', deliveryDate: '2026-10-20' })), day('2026-10-19') + 780, 'Monday load for Tuesday, 1:00 PM Jersey = Monday 1:00 PM');
  assert.equal(R.departWall(load('827', 60, { loadDate: '2026-10-19', deliveryDate: '2026-10-20' })), day('2026-10-20') + 60, 'Monday load for Tuesday, 1:00 AM = after midnight, Tuesday');
  assert.equal(R.departWall(load('901', 420, { loadDate: '2026-10-20', deliveryDate: '2026-10-20' })), day('2026-10-20') + 420, 'loaded the same day: leaves that day');
  assert.equal(R.departWall(load('880', 120, { departureDate: '2026-10-11' })), day('2026-10-11') + 120, 'the departure date on the sheet wins');
  assert.equal(R.departWall(load('3', null)), null);
});

test('Send Current Report: the Monday routes are not behind on Sunday until they leave', () => {
  const loads = [load('971', 0), load('880', 120), load('844', 1080), load('845', 1260, { state: 'DONE' })];
  assert.equal(R.plantReport({ loads }, at('2026-10-11T04:27:00Z')).behind.length, 0, '12:27 AM Sunday');
  assert.equal(R.plantReport({ loads }, at('2026-10-11T22:45:00Z')).behind.length, 0, '6:45 PM Sunday: 844 is 45 minutes past, not behind');
  assert.deepEqual(R.plantReport({ loads }, at('2026-10-11T23:00:00Z')).behind.map(x => x.route), ['844'], '7:00 PM Sunday: the 6:00 PM leaves Sunday, so it is behind');
  assert.equal(R.plantReport({ loads }, at('2026-10-12T04:45:00Z')).behind.map(x => x.route).join(), '844', '12:45 AM Monday: 971 is 45 minutes past, not behind (844 from Sunday is)');
  const r = R.plantReport({ loads }, at('2026-10-12T04:46:00Z'));
  assert.deepEqual(r.behind.map(x => x.route), ['844', '971'], '12:46 AM Monday: 844 still not loaded, 971 is 46 minutes past');
  assert.equal(r.behind[1].late, '46 min late');
});
