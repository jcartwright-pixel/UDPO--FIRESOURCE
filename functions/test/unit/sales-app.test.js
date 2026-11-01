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
  assert.deepEqual([yday[0].status, yday[0].where, yday[0].by, yday[0].lat, yday[0].gpsAt], ['On time, left 3:32 AM', 'On the road: I-79 N, Cranberry, PA', 'TRAILER', 40.6, '10:41 AM']);
  // T-102 has no GPS unit: the truck's.
  assert.deepEqual([yday[1].status, yday[1].where, yday[1].by], ['Left 5:42 AM, 1h 12m late', 'At Giant Eagle 44', 'TRUCK']);
});

test('where now in words', () => {
  assert.equal(A.whereOf(null, [], false), 'No GPS');
  assert.equal(A.whereOf({ place: 'Uniontown Plant' }, [], false), 'At the plant');
  assert.equal(A.whereOf({ place: 'Uniontown Branch' }, [], true), 'Back at the plant');
  assert.equal(A.whereOf({ address: 'US-19, Canonsburg, PA', speedMph: 45 }, [], true), 'On the road: US-19, Canonsburg, PA');
  assert.equal(A.whereOf({ address: '12 Main St, Wheeling, WV', speedMph: 0 }, [], true), 'Stopped: 12 Main St, Wheeling, WV');
  // Joe 10/31: a place marked in Fleet shows by its name instead of the address.
  assert.equal(A.whereOf({ place: 'Walmart 2291', address: '100 Mall Rd, Morgantown, WV', speedMph: 0 }, [], true), 'At Walmart 2291');
});

// Joe 11/1 (two-line mock-up 3): the GPS's "US|21795|Mary Rd [MD-63]" reads "Mary Rd (MD-63), 21795"; the status is short.
test('where now and status, short for two lines', () => {
  assert.equal(A.cleanAddress('US|21795|Mary Rd [MD-63]'), 'Mary Rd (MD-63), 21795');
  assert.equal(A.cleanAddress('12 Main St, Wheeling, WV'), '12 Main St, Wheeling, WV');
  assert.equal(A.whereOf({ address: 'US|21795|Mary Rd [MD-63]', speedMph: 0 }, [], true), 'Stopped: Mary Rd (MD-63), 21795');
  assert.equal(A.shortStatus('Left 10:12 AM, 2 hr 12 min late'), 'Left 10:12 AM, 2h 12m late');
  assert.equal(A.shortStatus('Not departed, 1 hr behind'), 'Not departed, 1h behind');
  assert.equal(A.shortStatus('Not loaded, 35 min behind'), 'Not loaded, 35m behind');
  assert.equal(A.shortStatus('On time, left 10:32 AM'), 'On time, left 10:32 AM');
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

// Joe 11/1: a Save-A-Lot drop and hook. Once its trailer is at the Save-A-Lot place in Fleet, the status says when it was dropped
// and Where now follows the driver's truck (home, or on its next trip), not the trailer left at the store.
test('Save-A-Lot drop and hook: dropped time, then the truck', () => {
  const runs = [
    run('s1', '855', { prefix: 'tue', fields: { dispatchTime: 480, driver: 'Pat Doyle', trailer: 'T-201', truck: '601', completeTime: iso('2026-11-03T06:00:00') } },
      { runId: 'run_s1', routeName: 'Save-A-Lot 1', streamId: 'SAVE-A-LOT 1' }),
    run('s2', '856', { prefix: 'tue', fields: { dispatchTime: 540, driver: 'Lee Shaw', trailer: 'T-202', truck: '602', completeTime: iso('2026-11-03T06:30:00') } },
      { runId: 'run_s2', routeName: 'Save-A-Lot 2', streamId: 'SAVE-A-LOT 2' }),
    run('c1', '870', { prefix: 'tue', fields: { dispatchTime: 300, driver: 'Kim Rhodes', trailer: 'T-203', truck: '603', completeTime: iso('2026-11-03T04:00:00') } },
      { runId: 'run_c1', routeName: 'COSTCO - NEW JERSEY', streamId: 'COSTCO NJ' })
  ];
  const routes = [{ id: 'run_s1', dropAndHook: true }, { id: 'run_s2', dropAndHook: true }, { id: 'run_c1', dropAndHook: true }];
  const reefer = {
    'T-201': { id: 's1|tue', unitId: 'U21', out: iso('2026-11-03T10:12:00'), place: 'SAL Williamsport', placeSince: iso('2026-11-03T15:05:00'), where: 'SAL Williamsport' },
    // 856's trailer is still on the road with the truck: nothing changes.
    'T-202': { id: 's2|tue', unitId: 'U22', out: iso('2026-11-03T09:10:00'), place: '', where: 'I-80 E' },
    'T-203': { id: 'c1|tue', unitId: 'U23', out: iso('2026-11-03T05:00:00'), place: 'SAL Williamsport', placeSince: iso('2026-11-03T09:00:00') }
  };
  const units = {
    'T-201': { tag: 'T-201', unitId: 'U21', lat: 41.2, lon: -77.0, place: 'SAL Williamsport', speedMph: 0, lastReport: iso('2026-11-03T17:00:00') },
    'T-202': { tag: 'T-202', unitId: 'U22', lat: 41.0, lon: -78.0, place: '', address: 'I-80 E', speedMph: 60, lastReport: iso('2026-11-03T17:00:00') },
    'T-203': { tag: 'T-203', unitId: 'U23', lat: 41.2, lon: -77.0, place: 'SAL Williamsport', speedMph: 0, lastReport: iso('2026-11-03T17:00:00') },
    601: { tag: '601', unitId: 'U61', lat: 39.9, lon: -79.7, place: 'Uniontown Plant', speedMph: 0, lastReport: iso('2026-11-03T20:00:00') },
    602: { tag: '602', unitId: 'U62', lat: 41.0, lon: -78.0, place: '', address: 'I-80 E', speedMph: 60, lastReport: iso('2026-11-03T17:00:00') }
  };
  const late = Date.parse('2026-11-04T01:30:00Z'); // 8:30 PM Tuesday
  const out = A.salesScreen({ runs, reefer, gpsDays: [], routes, units }, late);
  const by = {}; out.groups[0].rows.forEach(r => { by[r.route] = r; });
  assert.equal(by['855'].status, 'Dropped 3:05 PM, left 2h 12m late');
  assert.equal(by['855'].where, 'Back at the plant');
  assert.equal(by['855'].by, 'TRUCK');
  assert.equal(by['855'].lat, 39.9);
  assert.equal(by['855'].note, 'Trailer dropped at SAL Williamsport at 3:05 PM. Truck: Back at the plant.');
  assert.equal(by['856'].status, 'Left 9:10 AM, 10m late');
  assert.equal(by['856'].where, 'On the road: I-80 E');
  assert.equal(by['856'].by, 'TRAILER');
  // Only Save-A-Lot: another drop-and-hook route at the same place reads as before.
  assert.equal(by['870'].where, 'At SAL Williamsport');
  assert.equal(by['870'].note, '');
  // Without the Drop and Hook tick, a Save-A-Lot route reads as before too.
  const plain = A.salesScreen({ runs, reefer, gpsDays: [], routes: [], units }, late).groups[0].rows.find(r => r.route === '855');
  assert.equal(plain.where, 'At SAL Williamsport');
});

test('Save-A-Lot drop and hook: the truck\'s next route', () => {
  const runs = [
    run('s1', '855', { prefix: 'tue', fields: { dispatchTime: 480, driver: 'Pat Doyle', trailer: 'T-201', truck: '601', completeTime: iso('2026-11-03T06:00:00') } },
      { runId: 'run_s1', routeName: 'Save-A-Lot 1', dropAndHook: true }),
    run('d1', '812', { prefix: 'tue', fields: { dispatchTime: 1200, driver: 'Pat Doyle', trailer: 'T-300', truck: '601' } })
  ];
  const reefer = { 'T-201': { id: 's1|tue', unitId: 'U21', out: iso('2026-11-03T08:05:00'), place: 'SAL Williamsport', placeSince: iso('2026-11-03T13:05:00') } };
  const units = { 601: { tag: '601', unitId: 'U61', lat: 40.5, lon: -79.0, place: '', address: 'US-22 W', speedMph: 55, lastReport: iso('2026-11-03T17:00:00') } };
  const r = A.salesScreen({ runs, reefer, gpsDays: [], units }, Date.parse('2026-11-03T22:30:00Z')).groups[0].rows.find(x => x.route === '855');
  assert.equal(r.status, 'Dropped 1:05 PM, left on time');
  assert.equal(r.where, 'On the road: US-22 W');
  assert.equal(r.note, 'Trailer dropped at SAL Williamsport at 1:05 PM. Truck: On the road: US-22 W. Next route for this truck: 812.');
});
