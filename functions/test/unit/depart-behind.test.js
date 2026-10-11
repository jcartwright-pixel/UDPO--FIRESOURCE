'use strict';
// Behind is measured from when the route leaves, not from the loadout day (Joe 10/11: a Saturday loadout for Monday showed
// "14 routes behind" at 12:27 AM Sunday).
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../src/plant-rules');

const at = (iso) => Date.parse(iso); // New York is UTC-4 in October
const load = (route, time, extra) => Object.assign({ route, run: 'X', area: 'CASE', state: 'WAITING', loadDate: '2026-10-10', deliveryDate: '2026-10-12', dispatchTime: time, prior: false }, extra || {});

test('a Saturday loadout for Monday leaves Sunday evening or early Monday', () => {
  const mins = (h, m) => h * 60 + (m || 0);
  const day = (k) => Math.round(Date.UTC(...k.split('-').map((v, i) => i === 1 ? v - 1 : +v)) / 86400000) * 1440;
  assert.equal(R.departWall(load('971', mins(0))), day('2026-10-12'), '12:00 AM = Monday midnight');
  assert.equal(R.departWall(load('844', mins(18))), day('2026-10-11') + mins(18), '6:00 PM = Sunday evening');
  assert.equal(R.departWall(load('880', mins(2), { departureDate: '2026-10-11' })), day('2026-10-11') + mins(2), 'a departure date on the sheet wins');
  // A weekday load (Thursday for Friday): 9 PM Thursday, 3 AM Friday.
  assert.equal(R.departWall(load('1', mins(21), { loadDate: '2026-10-08', deliveryDate: '2026-10-09' })), day('2026-10-08') + mins(21));
  assert.equal(R.departWall(load('2', mins(3), { loadDate: '2026-10-08', deliveryDate: '2026-10-09' })), day('2026-10-09') + mins(3));
  assert.equal(R.departWall(load('3', null)), null);
});

test('Send Current Report: none of the Monday routes is behind at 12:27 AM Sunday; they are once their time passes', () => {
  const loads = [load('971', 0), load('880', 120), load('844', 1080), load('845', 1260, { state: 'DONE' })];
  const early = R.plantReport({ loads }, at('2026-10-11T04:27:00Z'));
  assert.equal(early.behind.length, 0, early.behind.map(x => x.route + ' ' + x.late).join(', '));
  assert.equal(early.nextUp.length, 3);
  const sunday = R.plantReport({ loads }, at('2026-10-11T22:40:00Z')); // 6:40 PM Sunday
  assert.deepEqual(sunday.behind.map(x => x.route), ['844']);
  assert.match(sunday.behind[0].late, /^40 min late$/);
});
