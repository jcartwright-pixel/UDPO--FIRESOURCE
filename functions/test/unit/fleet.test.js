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
});
