'use strict';
// The Sales app (Joe 10/31): each route of a division, its driver, the 6 AM email's status and where it is now: the trailer's GPS
// unit first, else the truck's. Today's loads and the day before's (still out). Ended Up Not Running left off.
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../../src/salesapp');

// Tuesday 11-3-26 10:42 AM in New York (UTC-5): today's loads are Tuesday 11-3's, yesterday's are Monday 11-2's.
const NOW = Date.parse('2026-11-03T15:42:00Z');
const iso = (local) => new Date(Date.parse(local + '-05:00')).toISOString();
const run = (id, route, day, extra) => Object.assign({ id, weekStart: '2026-11-01', route, run: 'Run ' + route, routeStatus: 'ACTIVE', masterShow: { daily: true, leavesOn: 'Delivery Day' },
  days: { [day.prefix]: Object.assign({ runs: true }, day.fields) } }, extra || {});

test('rows: driver, status, where now from the trailer first, else the truck; today first', () => {
  const runs = [
    run('a', '802', { prefix: 'tue', fields: { dispatchTime: 210, driver: 'Sam Porter', trailer: 'T-101', truck: '501', completeTime: iso('2026-11-03T02:00:00') } }),
    run('b', '811', { prefix: 'tue', fields: { dispatchTime: 270, driver: 'Dana Whitfield', trailer: 'T-102', truck: '502', completeTime: iso('2026-11-03T03:00:00') } }),
    run('c', '815', { prefix: 'wed', fields: { dispatchTime: 420, driver: 'Tina Moss', trailer: 'T-105', truck: '505' } }),
    run('g', '820', { prefix: 'tue', fields: { runs: false, dispatchTime: 300, driver: 'Nobody Here' } })
  ];
  const reefer = { 'T-101': { id: 'a|tue', unitId: 'U1', out: iso('2026-11-03T03:32:00') } };
  const units = {
    'T-101': { tag: 'T-101', unitId: 'U1', lat: 40.6, lon: -80.1, place: '', address: 'I-79 N, Cranberry, PA', speedMph: 62, lastReport: iso('2026-11-03T10:41:00') },
    502: { tag: '502', unitId: 'U9', lat: 40.2, lon: -80.2, place: 'Giant Eagle 44', address: '', speedMph: 0, lastReport: iso('2026-11-03T10:40:00') },
    YARD: { tag: '900', unitId: 'U0', lat: 39.9, lon: -79.7, place: 'Uniontown Plant', speedMph: 0, lastReport: iso('2026-11-03T10:40:00') },
    505: { tag: '505', unitId: 'U5', lat: 39.9, lon: -79.7, place: 'Uniontown Branch', speedMph: 0, lastReport: iso('2026-11-02T22:10:00') }
  };
  const out = A.salesScreen({ runs, reefer, gpsDays: [{ tag: '502', date: '2026-11-03', yardOut: iso('2026-11-03T05:42:00') }], units }, NOW);
  assert.equal(out.todayText, 'Tuesday 11-3-26');
  assert.deepEqual(out.groups.map(g => g.label), ['Today, Tuesday 11-3-26', 'Loaded Monday 11-2-26']);
  const today = out.groups[0].rows, yday = out.groups[1].rows;
  assert.deepEqual(today.map(r => [r.route, r.driver, r.status, r.where, r.by, r.gpsAt]), [['815', 'Tina Moss', 'Not loaded', 'At the plant', 'TRUCK', '10:10 PM 11-2-26']]);
  assert.deepEqual(yday.map(r => r.route), ['802', '811'], '820 (Ended Up Not Running) left off');
  assert.deepEqual([yday[0].status, yday[0].where, yday[0].by, yday[0].lat, yday[0].gpsAt], ['On time, left 3:32 AM', 'On the road near I-79 N, Cranberry, PA', 'TRAILER', 40.6, '10:41 AM']);
  // T-102 has no GPS unit: the truck's.
  assert.deepEqual([yday[1].status, yday[1].where, yday[1].by], ['Left 5:42 AM, 1 hr 12 min late', 'At Giant Eagle 44', 'TRUCK']);
});

test('where now in words', () => {
  assert.equal(A.whereOf(null, [], false), 'No GPS');
  assert.equal(A.whereOf({ place: 'Uniontown Plant' }, [], false), 'At the plant');
  assert.equal(A.whereOf({ place: 'Uniontown Branch' }, [], true), 'Back at the plant');
  assert.equal(A.whereOf({ address: 'US-19, Canonsburg, PA', speedMph: 45 }, [], true), 'On the road near US-19, Canonsburg, PA');
  assert.equal(A.whereOf({ address: '12 Main St, Wheeling, WV', speedMph: 0 }, [], true), 'Stopped at 12 Main St, Wheeling, WV');
  // Joe 10/31: a place marked in Fleet shows by its name instead of the address.
  assert.equal(A.whereOf({ place: 'Walmart 2291', address: '100 Mall Rd, Morgantown, WV', speedMph: 0 }, [], true), 'At Walmart 2291');
});

test('the call: picks the division asked for, else the first; nothing written', async () => {
  const fakeDb = { collection: () => ({ where: () => ({ where: () => ({ get: async () => ({ docs: [] }) }), get: async () => ({ docs: [] }) }), get: async () => ({ docs: [] }), doc: () => ({}) }), getAll: async () => [] };
  const divisions = [{ id: 'fac_uniontown', name: 'Uniontown' }, { id: 'fac_charleston', name: 'Charleston' }];
  const asked = [];
  const out = await A.salesCall(divisions, (id) => { asked.push(id); return fakeDb; }, { division: 'fac_charleston' }, { now: () => NOW });
  assert.equal(out.division, 'fac_charleston');
  assert.deepEqual(asked, ['fac_charleston']);
  assert.equal(out.refreshed, '10:42 AM');
  const other = await A.salesCall(divisions, () => fakeDb, { division: 'nope' }, { now: () => NOW });
  assert.equal(other.division, 'fac_uniontown');
});
