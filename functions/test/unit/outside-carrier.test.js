'use strict';
// Joe 11/2 (shift report email "3 ROUTES LATE" from 878 Darden Load 1-3): "Darden's, GFS, anything … outside carriers don't
// count towards being late … does not count against loadout at all". A load an outside carrier hauls is never late, behind,
// will-miss or loaded late; it stays on the list to load. United Dairy branch routes still count.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../src/plant-rules');

const NOW = Date.parse('2026-11-02T16:28:00Z'); // 11:28 AM Monday in New York
const MON = '2026-11-02';
const load = (id, route, run, area, dispatch, extra) => Object.assign({ id, route, run, routeName: '', area, state: 'WAITING', loadDate: MON, deliveryDate: MON, departureDate: MON,
  leavesOn: 'DELIVERY DAY', dispatchTime: dispatch, quantity: 500, prior: false }, extra || {});

test('who is an outside carrier: Route Master coverage / movement type, not United Dairy or a branch', () => {
  assert.equal(R.outsideCarrier({ coverageType: 'OUTSIDE CARRIER', movementType: 'CARRIER_LOAD' }), true, '878 Darden');
  assert.equal(R.outsideCarrier({ coverageType: 'GORDON FOOD SERVICE' }), true, 'a carrier named on the route');
  assert.equal(R.outsideCarrier({ coverageType: 'CUSTOMER PICKUP', movementType: 'CUSTOMER_PICKUP' }), true, 'a customer pickup');
  assert.equal(R.outsideCarrier({ coverageType: 'UNITED DAIRY', movementType: 'COMPANY_ROUTE' }), false);
  assert.equal(R.outsideCarrier({ coverageType: 'BRANCH', movementType: 'COMPANY_ROUTE' }), false, 'Fairmont, Marietta, Charleston still count');
  assert.equal(R.outsideCarrier({}), false, 'blank = United Dairy');
});

test('a Scheduler load is outside when marked Carrier or its run is an outside carrier\'s', () => {
  const customers = R.scheduleCustomers([
    { runId: 'RUN_878', routeId: 'R878', route: '878', run: 'Darden', routeName: 'Darden', loadType: 'Boxing', displayPlant: true, coverageType: 'OUTSIDE CARRIER', movementType: 'CARRIER_LOAD' },
    { runId: 'RUN_847', routeId: 'R847', route: '847', run: 'PALS SHAKE MIX', loadType: 'Boxing', displayPlant: true, coverageType: 'UNITED DAIRY', movementType: 'COMPANY_ROUTE' }]);
  assert.equal(R.scheduleOutside({ runId: 'RUN_878', scheduleType: 'ROUTE' }, customers), true);
  assert.equal(R.scheduleOutside({ runId: 'RUN_847', scheduleType: 'ROUTE' }, customers), false);
  assert.equal(R.scheduleOutside({ runId: 'RUN_847', scheduleType: 'CARRIER' }, customers), true);
  const rows = R.withScheduleLoads([], [{ id: 'd1', date: MON, runId: 'RUN_878', route: '878', run: 'Darden', scheduleType: 'ROUTE', pickupTime: '08:20', loadNo: 1, work: {} }], customers);
  assert.equal(rows[0].outside, true);
  // A run not shown on the Scheduler's customer list is still known by its run or route number.
  const hidden = R.scheduleCustomers([{ runId: 'RUN_838', route: '838', run: 'GORDON FOOD SERVICE', displayPlant: false, coverageType: 'OUTSIDE CARRIER', movementType: 'CARRIER_LOAD' }]);
  assert.equal(R.scheduleOutside({ runId: 'RUN_838', scheduleType: 'ROUTE' }, hidden), true);
  assert.equal(R.scheduleOutside({ runId: 'OTHER', route: '838', scheduleType: 'ROUTE' }, hidden), true);
});

test('the shift report: Darden and GFS are listed ("we record them") but never marked late', () => {
  const loads = [
    load('d1', '878', 'Darden Load 1', 'BOXING', 8 * 60 + 20, { outside: true, routeName: 'Darden' }),
    load('d2', '878', 'Darden Load 2', 'BOXING', 9 * 60 + 21, { outside: true, routeName: 'Darden' }),
    load('d3', '878', 'Darden Load 3', 'BOXING', 9 * 60 + 46, { outside: true, routeName: 'Darden', state: 'DONE', completedAt: '2026-11-02T11:00:00-05:00' }),
    load('g1', '838', 'GORDON FOOD SERVICE', 'BOXING', 12 * 60 + 46, { outside: true, state: 'DONE', completedAt: '2026-11-02T13:59:00-05:00' }),
    load('j1', '852', 'JERSEY LOAD 1', 'CASE', 8 * 60)];
  const r = R.plantReport({ loads }, NOW);
  assert.deepEqual(r.behind.map(x => x.id), ['j1'], 'only the United Dairy truck is late');
  assert.deepEqual(r.loaded.map(x => x.id).sort(), ['d3', 'g1'], 'recorded as loaded');
  assert.ok(r.loaded.every(x => !x.loadedLate), 'never loaded late');
  assert.deepEqual(r.nextUp.map(x => x.id).sort(), ['d1', 'd2'], 'still to load, not late');
  assert.equal(r.totalLoads, 5, 'counted like any load');
  assert.match(r.subject, /1 route late/);
  const t = R.truckCheck(JSON.parse(JSON.stringify(r)));
  assert.equal(t.lateNow.length, 1);
  assert.equal(t.loadedLate.length, 0);
  assert.ok(t.lateNow.every(x => !/878|838/.test(x.name)));
  const html = R.reportHtml(JSON.parse(JSON.stringify(r)), '');
  assert.match(html, /Darden/, 'listed in the Routes table');
  assert.doesNotMatch(html, /Darden Load 1<\/td>[^]*?LATE/, 'no LATE bar on Darden');
});

test('the forecast: an outside carrier\'s load takes its time but is never late', () => {
  const loads = [load('o1', '888', 'COSTCO', 'CASE', 12 * 60, { outside: true }), load('u1', '852', 'JERSEY', 'CASE', 11 * 60 + 40)];
  const f = R.loadForecast({ date: MON, loads }, NOW);
  const o = f.loads.find(x => x.id === 'o1');
  assert.equal(o.late, false);
  assert.ok(o.minutes > 0);
  assert.equal(f.late, f.loads.filter(x => x.late && !x.outside).length);
});
