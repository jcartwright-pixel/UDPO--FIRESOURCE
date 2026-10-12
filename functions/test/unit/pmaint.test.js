'use strict';
// Plant Maintenance (Joe 10/12): the machinery list (the plant's production lines plus machines added), the machine a Shift
// Notes breakdown names, work order numbers and the PM schedule's due days.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const R = require('../../src/pmaint-rules');

test('the screens use the same Plant Maintenance rules as the server', () => {
  assert.equal(fs.readFileSync(path.join(__dirname, '../../src/pmaint-rules.js'), 'utf8'), fs.readFileSync(path.join(__dirname, '../../../public/js/pmaint-rules.js'), 'utf8'));
});

const SETUP = [
  { operationId: 'ut_prod_gallon_filler', type: 'PRODUCTION_AREA', name: 'GALLON FILLER', status: 'ACTIVE', facilityId: 'fac_uniontown', viewSequence: 80 },
  { operationId: 'ut_prod_boxing', type: 'PRODUCTION_AREA', name: 'BOXING', status: 'ACTIVE', facilityId: 'fac_uniontown', viewSequence: 10 },
  { operationId: 'ut_prod_retired', type: 'PRODUCTION_AREA', name: 'OLD FILLER', status: 'INACTIVE', facilityId: 'fac_uniontown' },
  { operationId: 'ut_temp_cooler', type: 'TEMPERATURE_CHECK_LOCATION', name: 'Cooler', status: 'ACTIVE', facilityId: 'fac_uniontown' },
  { operationId: 'ch_prod_filler', type: 'PRODUCTION_AREA', name: 'CH FILLER', status: 'ACTIVE', facilityId: 'fac_charleston' }
];

test('a plant\'s machinery is its active production lines plus the machines added; retired ones only when asked', () => {
  const saved = [{ id: 'ut_prod_gallon_filler', facilityId: 'fac_uniontown', make: 'Federal', area: 'Filling', name: 'renamed?' },
    { id: 'fac_uniontown_mach_boiler', facilityId: 'fac_uniontown', name: 'Boiler', kind: 'Utility', area: 'Utilities' },
    { id: 'fac_uniontown_mach_old', facilityId: 'fac_uniontown', name: 'Old Press', status: 'RETIRED' },
    { id: 'fac_charleston_mach_x', facilityId: 'fac_charleston', name: 'Other plant' }];
  const list = R.machines(SETUP, saved, 'fac_uniontown');
  assert.deepEqual(list.map(m => m.name), ['GALLON FILLER', 'Boiler', 'BOXING']);
  const filler = list[0];
  assert.deepEqual([filler.line, filler.make, filler.kind, filler.status], [true, 'Federal', 'Production line', 'ACTIVE'], 'a line keeps its Plant Operations name');
  assert.equal(R.machines(SETUP, saved, 'fac_uniontown', true).length, 4);
  assert.deepEqual(R.machines(SETUP, [], 'fac_charleston').map(m => m.name), ['CH FILLER']);
});

test('a breakdown\'s Equipment box finds its machine by name, any case and spacing', () => {
  const list = R.machines(SETUP, [], 'fac_uniontown');
  assert.equal(R.findMachine(list, ' gallon  filler ').id, 'ut_prod_gallon_filler');
  assert.equal(R.findMachine(list, 'Dock 3 door'), null);
  assert.equal(R.findMachine(list, ''), null);
});

test('work orders are M-1001 on; NEW, WORKING and PARTS are open', () => {
  assert.equal(R.woNumber(R.FIRST_WO), 'M-1001');
  assert.equal(R.isOpen({ status: 'parts' }), true);
  assert.equal(R.isOpen({}), true);
  assert.equal(R.isOpen({ status: 'DONE' }), false);
  assert.equal(R.statusWord('WORKING'), 'Being worked');
});

test('PM tasks: next due from the day last done; late, this week (Sun-Sat), within 30 days, later', () => {
  assert.equal(R.nextDue('2026-09-24', 2, 'WEEKS'), '2026-10-08');
  assert.equal(R.nextDue('2026-10-01', 10, 'days'), '2026-10-11');
  assert.equal(R.nextDue('2026-01-31', 1, 'MONTHS'), '2026-02-28', 'a month on from the 31st is the month\'s last day');
  assert.equal(R.nextDue('2026-05-02', 6, 'MONTHS'), '2026-11-02');
  assert.equal(R.nextDue('', 1, 'MONTHS'), '');
  assert.equal(R.nextDue('2026-05-02', 0, 'MONTHS'), '');
  assert.equal(R.everyText(1, 'MONTHS'), 'Every month');
  assert.equal(R.everyText(2, 'WEEKS'), 'Every 2 weeks');
  const today = '2026-10-12';
  assert.deepEqual(R.weekOf(today), { start: '2026-10-11', end: '2026-10-17' });
  assert.equal(R.pmState('2026-10-08', today), 'LATE');
  assert.equal(R.daysLate('2026-10-08', today), 4);
  assert.equal(R.pmState('2026-10-12', today), 'WEEK');
  assert.equal(R.pmState('2026-10-17', today), 'WEEK');
  assert.equal(R.pmState('2026-10-18', today), 'SOON');
  assert.equal(R.pmState('2026-11-11', today), 'SOON');
  assert.equal(R.pmState('2026-11-12', today), 'LATER');
});
