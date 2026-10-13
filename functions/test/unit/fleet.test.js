'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../src/logic');
const { parseQueue } = require('../../src/transfer');

const today = '2026-10-10';
const units = [{ unit: '223893', type: 'TRUCK' }, { unit: '223894', type: 'TRUCK' }, { unit: 'T-2893', type: 'TRAILER' }, { unit: 'T-2894', type: 'TRAILER' }];

test('Fleet Service due list: PM by miles, reefer by months or hours, DOT and plates by date, an open job shows At garage', () => {
  const setup = [
    { unit: '223893', last_service_miles: '100,000', last_service_date: '2026-06-01', dot_due: '2026-10-25', plate_expires: '2026-09-30' },
    { unit: '223894', track: 'NO' },
    { unit: 'T-2893', last_service_date: '2026-06-05', last_service_hours: '1000', current_hours: '1900', dot_due: '2027-03-01' }
  ];
  const miles = { 223893: { miles: 114500, date: '2026-10-09' } };
  const { units: rows, items } = L.fleetDue(units, setup, miles, [{ unit: 'T-2893', service_key: 'REEFER', work_order_id: 'WO-7' }], null, today);
  const get = (u, k) => items.find(i => i.unit === u && i.key === k);
  assert.equal(get('223893', 'PM').status, 'DUE_SOON', '500 miles left of 15,000');
  assert.equal(get('223893', 'PM').left, 500);
  assert.equal(get('223893', 'DOT').status, 'DUE_SOON');
  assert.equal(get('223893', 'PLATE').status, 'OVERDUE');
  assert.equal(get('223894', 'PM'), undefined, 'a unit set to not track has no due items');
  assert.equal(rows.find(r => r.unit === '223894').trackSet, 'NO');
  assert.equal(get('T-2893', 'REEFER').status, 'AT_GARAGE');
  assert.equal(get('T-2893', 'REEFER').dueAt, '2026-10-05');
  assert.equal(get('T-2894', 'REEFER').status, 'SET_UP', 'no last service date yet');
  assert.equal(items[0].status, 'OVERDUE', 'overdue first');
  assert.equal(L.addMonths('2026-10-31', 4), '2027-02-28');
});

test('trailers have their own DOT and plate rules once saved (Joe 10/13); until then they follow the trucks\'', () => {
  const setup = [{ unit: '223893', dot_due: '2026-11-01' }, { unit: 'T-2893', dot_due: '2026-11-01', plate_expires: '2026-10-25' }];
  const due = (rules) => { const { items } = L.fleetDue(units.filter(u => u.unit === '223893' || u.unit === 'T-2893'), setup, {}, [], rules, today); return (u, k) => items.find(i => i.unit === u && i.key === k).status; };
  let get = due({ dotWarnDays: 30 });
  assert.deepEqual([get('223893', 'DOT'), get('T-2893', 'DOT')], ['DUE_SOON', 'DUE_SOON'], '22 days out, both warn at 30');
  get = due({ dotWarnDays: 30, trailerDotWarnDays: 7, trailerPlateWarnDays: 10 });
  assert.deepEqual([get('223893', 'DOT'), get('T-2893', 'DOT'), get('T-2893', 'PLATE')], ['DUE_SOON', 'OK', 'OK'], 'the trailer warns later by its own rules');
  assert.equal(L.fleetRule({ dotMonths: 6 }, 'TRAILER', 'dotMonths'), 6);
  assert.equal(L.fleetRule({ dotMonths: 6, trailerDotMonths: 12 }, 'TRAILER', 'dotMonths'), 12);
  assert.equal(L.fleetRule({ dotMonths: 6, trailerDotMonths: 12 }, 'TRUCK', 'dotMonths'), 6);
  assert.equal(L.fleetRule(null, 'TRAILER', 'plateWarnDays'), 30);
});

test('Fleet Service setup and garage technicians copy read only; a PIN is never copied', () => {
  const techs = parseQueue('garageTechs', [['tech_id', 'name', 'pin_hash', 'active'], ['t1', 'MIKE', 'abc123', 'TRUE']]);
  assert.equal(techs.docs.t1.name, 'MIKE');
  assert.equal(techs.docs.t1.pin_hash, undefined);
  assert.equal(techs.docs.t1.cells.pin_hash, undefined);
  const setup = parseQueue('fleetSetup', [['unit', 'unit_type', 'dot_due'], ['T-2893', 'TRAILER', '2027-03-01']]);
  assert.equal(setup.docs['T-2893'].dot_due, '2027-03-01');
});

test('Over the Road logic: the screen and the server load the same file', () => {
  const fs = require('fs'), path = require('path');
  assert.equal(fs.readFileSync(path.join(__dirname, '../../src/otr-core.js'), 'utf8'), fs.readFileSync(path.join(__dirname, '../../../public/js/otr-core.js'), 'utf8'));
  const O = require('../../src/otr-core');
  const routes = O.otrRouteList_([{ runId: 'r1', route: '855', run: 'SAL 1', include: 'TRUE', destination: 'save a lot' }]);
  const day = O.otrCountDay_('2026-10-04', [{ runId: 'r1', route: '855', run: 'SAL 1', runs: 'TRUE' }, { runId: 'r1', route: '855', run: 'SAL 1', runs: 'TRUE' }], routes);
  assert.equal(day.byDestination.SAL, 2, 'two runs on one day count 2');
  // Review item 17 (Joe 10/13): Over the Road dates read 10-8-26, and the week's days 10-4-26.
  assert.equal(O.otrShortDate_('2026-10-08'), '10-8-26');
  assert.deepEqual(O.otrDashboard_('2026-10-08', {}, { total: 0 }, []).week.map(d => d.label)[0], '10-4-26');
});

test('Driver Scorecard logic: the screen and the server load the same file; a missed check-in and lost cases cost points', () => {
  const fs = require('fs'), path = require('path');
  assert.equal(fs.readFileSync(path.join(__dirname, '../../src/sc-core.js'), 'utf8'), fs.readFileSync(path.join(__dirname, '../../../public/js/sc-core.js'), 'utf8'));
  const S = require('../../src/sc-core');
  const s = S.scSettings_({});
  const days = S.scBuildDay_('2026-10-05', [{ runId: 'r1', route: '855', run: 'SAL', runs: 'TRUE', driver: 'ADAMS, PAT', driverId: 'd1', casesOut: 500, plantCaseReturn: 497 }], [], {});
  const rows = S.scScoreMonth_(days, [], s, { D1: 'ADAMS, PAT' });
  assert.equal(rows[0].score, 100 - 4 - 3, 'check-in 4 points, 3 lost cases 3 points');
  assert.equal(rows[0].driver, 'ADAMS, PAT');
});

test('an off unit says why in words: its status, or for an ACTIVE truck or trailer, not on the fleet list (Joe 10/12, T-10308)', () => {
  assert.equal(L.unitOffWhy({ unit: 'T-10308', type: 'TRAILER', status: 'ACTIVE', sourcePresent: false }), 'NOT ON THE FLEET LIST');
  assert.equal(L.unitOffWhy({ unit: '537', type: 'TRUCK', status: 'DOWN', sourcePresent: true }), 'DOWN');
  assert.equal(L.unitOffWhy({ unit: '670', type: 'TRUCK', status: 'OUT_OF_SERVICE' }), 'OUT OF SERVICE');
  assert.equal(L.unitOffWhy({ unit: '123891', type: 'TRUCK', status: 'ACTIVE', sourcePresent: true }), '');
  const runs = [{ id: 'w1', weekStart: '2026-10-11', route: '909_1', days: { tue: { runs: true, trailerId: 'veh_trailer_t_10308' } } }];
  const off = L.offUnitLoads(runs, [{ id: 'veh_trailer_t_10308', unit: 'T-10308', type: 'TRAILER', status: 'ACTIVE', sourcePresent: false }], '2026-10-11');
  assert.deepEqual(off.map(x => [x.unit, x.why, x.route]), [['T-10308', 'NOT ON THE FLEET LIST', '909_1']]);
});
