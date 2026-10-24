'use strict';
// Joe 10/23 (T-532 on 815, T-537 on 824, both on the down list): a down trailer held on a load as its number only (no
// trailer_id) was shown on Daily Dispatch as if usable, and Publish wrote Route Master's default number for a down trailer.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../src/logic');
const LR = require('../../src/liveroll');

const fleet = [
  { id: 'veh_trailer_t_532', type: 'TRAILER', unit: 'T-532', status: 'DOWN', notes: 'DOWN: Down' },
  { id: 'veh_trailer_t_533', type: 'TRAILER', unit: 'T-533', status: 'ACTIVE' },
  { id: 'veh_truck_224981', type: 'TRUCK', unit: '224981', status: 'ACTIVE' }
];

test('a unit on a load is found by its ID, or by its number when the load has no ID', () => {
  assert.equal(L.unitOnLoad(fleet, 'TRAILER', 'veh_trailer_t_532', 'T-532').unit, 'T-532');
  assert.equal(L.unitOnLoad(fleet, 'TRAILER', '', 'T-532').id, 'veh_trailer_t_532');
  assert.equal(L.unitOnLoad(fleet, 'TRAILER', '', '532').id, 'veh_trailer_t_532');
  assert.equal(L.unitOnLoad(fleet, 'TRAILER', '', 't 532').id, 'veh_trailer_t_532');
  assert.equal(L.unitOnLoad(fleet, 'TRUCK', '', '224981').id, 'veh_truck_224981');
  // A load whose ID is another unit is that unit, never the number's.
  assert.equal(L.unitOnLoad(fleet, 'TRAILER', 'veh_trailer_t_533', 'T-532').unit, 'T-533');
  assert.equal(L.unitOnLoad(fleet, 'TRAILER', '', 'TBA'), null);
  assert.equal(L.unitOnLoad(fleet, 'TRAILER', '', ''), null);
  assert.equal(L.unitOnLoad(fleet, 'TRUCK', '', 'T-532'), null);
});

test('a down trailer held only as its number is listed as still on a load', () => {
  const runs = [{ id: 'r815', weekStart: '2026-10-25', route: '815', run: 'DSD', days: {
    mon: { runs: true, trailerId: '', trailer: 'T-532' }, tue: { runs: true, trailerId: '', trailer: 'T-533' } } }];
  const out = L.offUnitLoads(runs, fleet, '2026-10-24');
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].unit, out[0].route, out[0].date, out[0].why], ['T-532', '815', '2026-10-26', 'DOWN']);
});

test('Publish never seeds Route Master\'s default trailer when Operations left a down one off', () => {
  const cells = { route_id: 'rte_815', run_id: 'run_815', route: '815', mon_active: 'TRUE', mon_trailer_default: 'T-532', mon_tractor_default: '224981' };
  const built = { days: { mon: { runs: true, truckId: 'veh_truck_224981', truck: '224981', trailerId: '', trailer: '' } } };
  assert.equal(LR.seedValue('mon_trailer', cells, '2026-10-25', built), '');
  assert.equal(LR.seedValue('mon_trailer_id', cells, '2026-10-25', built), '');
  assert.equal(LR.seedValue('mon_truck', cells, '2026-10-25', built), '224981');
  assert.equal(LR.seedValue('mon_tractor_id', cells, '2026-10-25', built), 'veh_truck_224981');
  // A usable trailer Operations put on is still written.
  built.days.mon.trailerId = 'veh_trailer_t_533'; built.days.mon.trailer = 'T-533';
  assert.equal(LR.seedValue('mon_trailer', cells, '2026-10-25', built), 'T-533');
});
