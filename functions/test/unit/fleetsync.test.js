'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planFleetSync, fleetUnits, unitKey } = require('../../src/fleetsync');

const FLEET = [
  ['United Dairy fleet list'],
  ['UD UNIT', 'YEAR', 'MAKE', 'MODEL', 'ASSET TYPE', 'LOCATION', 'PLATE', 'IN SERVICE'],
  ['901', '2022', 'Freightliner', 'Cascadia', 'Tractor', 'Uniontown', 'AB1', 'Y'],
  ['T-901', '2019', 'Utility', 'Reefer', 'Trailer', 'Uniontown', '', 'Y'],
  ['902', '2018', 'Mack', 'Pinnacle', 'Tractor', 'Uniontown OOS', '', ''],
  ['903', '2020', 'Volvo', 'VNL', 'Tractor', 'Uniontown', '', ''],
  ['688', '2015', 'Kalmar', 'Ottawa', 'Yard Truck', 'Uniontown', '', ''],
  ['9715', '2016', 'Capacity', 'TJ5000 Yard Spotter', 'Tractor', 'Uniontown', '', ''],
  ['T-95', '2024', 'Wabash', 'Reefer', 'Trailer', 'Charleston', '', ''],
  ['777', '2024', 'Ford', 'F150', 'Pickup', 'Uniontown', '', ''],
  ['5000', '2024', 'Mack', 'Anthem', 'Tractor', 'Columbus', '', '']
];
const H = ['equipment_id', 'equipment_type', 'unit_id', 'facility_id', 'location', 'status', 'assignment_class', 'source_present', 'last_source_sync_at', 'notes', 'version', 'created_at', 'created_by', 'updated_at', 'updated_by'];
const row = (o) => H.map(k => o[k] || '');
const MASTER = [H,
  row({ equipment_id: 'eq_truck_901', equipment_type: 'TRUCK', unit_id: '901', facility_id: 'fac_uniontown', location: 'Uniontown', status: 'ACTIVE', source_present: 'TRUE', notes: 'External Fleet: 2022 | Freightliner | Cascadia | AB1' }),
  row({ equipment_id: 'eq_trailer_T_901', equipment_type: 'TRAILER', unit_id: 'T-901', facility_id: 'fac_uniontown', location: 'Uniontown', status: 'DOWN', source_present: 'TRUE', notes: 'DOWN: brakes' }),
  row({ equipment_id: 'eq_truck_903', equipment_type: 'TRUCK', unit_id: '903', facility_id: 'fac_uniontown', location: '', status: 'INACTIVE', source_present: 'FALSE' }),
  row({ equipment_id: 'eq_truck_237', equipment_type: 'TRUCK', unit_id: '237', facility_id: 'fac_uniontown', location: 'Uniontown', status: 'ACTIVE', source_present: 'TRUE' }),
  row({ equipment_id: 'eq_truck_239', equipment_type: 'TRUCK', unit_id: '239', facility_id: 'fac_uniontown', location: 'Uniontown', status: 'DOWN', source_present: 'TRUE', notes: 'DOWN: engine' }),
  row({ equipment_id: 'eq_truck_688', equipment_type: 'TRUCK', unit_id: '688', facility_id: 'fac_uniontown', location: 'Uniontown', status: 'ACTIVE', source_present: 'TRUE' })
];
const AT = '2026-10-11T06:00:00.000Z';

function apply(master, cells) {
  const v = master.map(r => r.slice());
  cells.forEach(c => { while (v.length <= c.row) v.push(H.map(() => '')); v[c.row][c.column] = c.value; });
  return v;
}
const get = (v, unit, k) => v.find(r => r[2] === unit)[H.indexOf(k)];

test('fleet list: trucks and trailers at our plants only; yard trucks, pickups and other places are left out', () => {
  const { units, yard } = fleetUnits(FLEET);
  assert.deepEqual(units.map(u => u.unit), ['901', 'T-901', '902', '903', 'T-95']);
  assert.deepEqual(yard, ['688', '9715']);
  assert.equal(units.find(u => u.unit === '902').outOfService, true);
});

test('fleet sync: adds new units, brings back listed ones, keeps DOWN units and their reasons, sets units off the list INACTIVE', () => {
  const { cells, summary } = planFleetSync(FLEET, MASTER, AT);
  const v = apply(MASTER, cells);
  assert.deepEqual(summary.added.sort(), ['902', 'T-95']);
  assert.equal(get(v, '902', 'status'), 'OUT_OF_SERVICE');
  assert.equal(get(v, '902', 'equipment_id'), 'eq_truck_902');
  assert.equal(get(v, 'T-95', 'facility_id'), 'fac_charleston');
  assert.deepEqual(summary.back, ['903']);
  assert.equal(get(v, '903', 'status'), 'ACTIVE');
  assert.equal(get(v, 'T-901', 'status'), 'DOWN', 'a down unit stays down');
  assert.equal(get(v, 'T-901', 'notes'), 'DOWN: brakes', 'with its reason');
  assert.equal(get(v, '237', 'status'), 'INACTIVE');
  assert.equal(get(v, '237', 'source_present'), 'FALSE');
  assert.equal(get(v, '688', 'status'), 'INACTIVE', 'a yard truck comes off');
  assert.equal(get(v, '239', 'status'), 'DOWN', 'a down unit off the list keeps its down history');
  assert.equal(get(v, '239', 'notes'), 'DOWN: engine');
  assert.equal(get(v, '901', 'updated_at'), '', 'an unchanged unit is not written');
  assert.ok(cells.every(c => c.row !== 1), 'row of 901 untouched');
  // A second pass over the result changes nothing.
  assert.equal(planFleetSync(FLEET, v, AT).cells.length, 0);
});

test('fleet sync keeps the lessor with the fleet text, so Fleet Service can leave leased units out', () => {
  const L = require('../../src/logic');
  const fleet = [['UD UNIT', 'ASSET TYPE', 'LOCATION', 'MAKE', 'LEASE'], ['123885', 'Tractor', 'Uniontown PA Branch', 'Freightliner', 'Idealease'], ['493', 'Straight Truck', 'Uniontown PA Branch', 'Isuzu', 'OWN']];
  const { units } = fleetUnits(fleet);
  assert.equal(units[0].notes, 'External Fleet: Freightliner | Lease: Idealease');
  assert.equal(units[1].notes, 'External Fleet: Isuzu');
  assert.equal(L.unitLeased({ notes: units[0].notes }), true);
  assert.equal(L.unitLeased({ notes: units[1].notes }), false);
  assert.equal(L.unitLeased({ notes: 'DOWN: Lease: return' }), false, 'only the fleet text counts');
  assert.equal(L.cleanUnitNote(units[0].notes), '', 'the screens never show it');
});

// Joe 10/12: the fleet list's T-95 is Equipment Master's T-095. They are one unit, so the sync brings T-095 back instead of
// adding a second T-95 row and leaving T-095 INACTIVE.
test('fleet sync matches unit numbers with or without leading zeros', () => {
  assert.deepEqual(['T-95', 'T-095', 't 095', '0670', '123891'].map(unitKey), ['T-95', 'T-95', 'T-95', '670', '123891']);
  const master = MASTER.concat([row({ equipment_id: 'veh_trailer_t_095', equipment_type: 'TRAILER', unit_id: 'T-095', facility_id: 'fac_uniontown', location: 'UNKNOWN', status: 'INACTIVE', source_present: 'FALSE' })]);
  const { cells, summary } = planFleetSync(FLEET, master, AT);
  const v = apply(master, cells);
  assert.deepEqual(summary.added.sort(), ['902'], 'no second row for T-95');
  assert.equal(v.filter(r => /^T-0?95$/.test(r[2])).length, 1);
  assert.deepEqual(['status', 'facility_id', 'source_present'].map(k => get(v, 'T-095', k)), ['ACTIVE', 'fac_charleston', 'TRUE']);
});

// Joe 10/12 ("Yes, preview first"): the preview lists every shown cell it would change, by unit and plant, in plain words.
test('fleet sync preview lists each change with its unit, plant, sheet row, now and would be', () => {
  const { changes } = planFleetSync(FLEET, MASTER, AT);
  const c237 = changes.find(c => c.unit === '237' && c.field === 'Status');
  assert.deepEqual(c237, { unit: '237', plant: 'Uniontown', row: 5, field: 'Status', from: 'ACTIVE', to: 'INACTIVE', kind: 'inactive', why: 'Not on the fleet list' });
  assert.equal(changes.find(c => c.unit === '688' && c.field === 'Status').why, 'Yard truck on the fleet list');
  const away = planFleetSync(FLEET.concat([['237', '', '', '', 'Tractor', 'Marietta OH Branch', '', '']]), MASTER, AT).changes.find(c => c.unit === '237' && c.field === 'Status');
  assert.equal(away.why, 'Fleet list: Marietta OH Branch');
  const t95 = changes.find(c => c.unit === 'T-95' && c.field === 'Plant');
  assert.deepEqual([t95.to, t95.kind, t95.plant, t95.why], ['Charleston', 'added', 'Charleston', '']);
  assert.ok(!changes.some(c => /updated|sync|version|created/i.test(c.field)), 'bookkeeping columns are written but not listed');
});

// Review item 67 (Joe 10/13): the fleet list holds only trucks and trailers; other kinds are never set INACTIVE.
test('fleet sync never sets fork trucks, pallet jacks or other kinds INACTIVE', () => {
  const master = MASTER.concat([
    row({ equipment_id: 'eq_fork_3', equipment_type: 'FORK_TRUCK', unit_id: 'FT-3', facility_id: 'fac_uniontown', status: 'ACTIVE', source_present: 'TRUE' }),
    row({ equipment_id: 'eq_pj_12', equipment_type: 'PALLET_JACK', unit_id: 'PJ-12', facility_id: 'fac_uniontown', status: 'ACTIVE', source_present: 'TRUE' }),
    row({ equipment_id: 'eq_x_9', equipment_type: '', unit_id: 'X-9', facility_id: 'fac_uniontown', status: 'ACTIVE', source_present: 'TRUE' })]);
  const { cells, summary } = planFleetSync(FLEET, master, AT);
  const v = apply(master, cells);
  ['FT-3', 'PJ-12', 'X-9'].forEach(u => assert.equal(get(v, u, 'status'), 'ACTIVE', u));
  assert.deepEqual(summary.inactive.sort(), ['237', '688'], 'only trucks and trailers come off');
});

// Joe 10/18: Fleet Service lists only United Dairy owned units at the plant ("no leased vehicles, basically").
test('the fleet list gives each unit its owner and branch for Fleet Service', () => {
  const { fleetOwnership } = require('../../src/fleetsync');
  const list = fleetOwnership([['United Dairy fleet list'], ['UD Unit', 'Asset Type', 'Location', 'LEASE'],
    ['123885', 'Tractor', 'Uniontown PA Branch', 'Idealease'], ['688', 'Yard Truck', 'Uniontown PA Branch', 'OWN'],
    ['T-95', 'Trailer', 'Uniontown PA Branch', 'OWN'], ['221810', 'Tractor', 'Uniontown PA Branch', ''],
    ['T-10318', 'Trailer', 'Uniontown PA Branch', 'First'], ['T-10308', 'Trailer', 'Marietta OH Branch', 'First'], ['', 'Trailer', 'Uniontown', 'OWN']]);
  assert.deepEqual(list['123885'], { own: false, lease: 'Idealease', facilityId: 'fac_uniontown' });
  assert.deepEqual(list['688'], { own: true, lease: 'OWN', facilityId: 'fac_uniontown' });
  assert.equal(list['T-95'].own, true, 'T-95 kept as the screens key it (T-095 is the same unit)');
  assert.equal(list['221810'].own, true, 'a blank LEASE is ours, as the nightly sync reads it');
  assert.equal(list['T-10318'].own, false);
  assert.equal(list['T-10308'].facilityId, '');
  assert.equal(Object.keys(list).length, 6);
  assert.throws(() => fleetOwnership([['UD UNIT', 'LOCATION']]), /LEASE/);
});

test('Fleet Service keeps owned trucks and every trailer at this plant, and drops leased trucks and other branches', () => {
  const L = require('../../src/logic');
  const own = { units: { '223876': { own: false, facilityId: 'fac_uniontown' }, 'T-95': { own: true, facilityId: 'fac_uniontown' },
    'T-10318': { own: false, facilityId: 'fac_uniontown' }, 'T-10308': { own: false, facilityId: '' }, 'T-555': { own: true, facilityId: '' }, '688': { own: true, facilityId: 'fac_uniontown' },
    '221810': { own: true, facilityId: 'fac_uniontown' }, '222860': { own: false, facilityId: 'fac_martins_ferry' } } };
  const here = (u) => L.fleetOwnedHere(u, 'fac_uniontown', own);
  assert.equal(here({ unit: '223876', type: 'TRUCK' }), false, 'a leased tractor');
  assert.equal(here({ unit: 'T-10318', type: 'TRAILER' }), true, 'a leased trailer stays: Uniontown services it (Joe 10/18)');
  assert.equal(here({ unit: 'T-555', type: 'TRAILER' }), false, 'the fleet list has it at another branch');
  assert.equal(here({ unit: 'T-10308', type: 'TRAILER' }), true, 'Joe 10/19: ours, though the fleet list says Marietta');
  assert.equal(L.fleetOwnedHere({ unit: 'T-10308', type: 'TRAILER' }, 'fac_charleston', own), false, 'and only at Uniontown');
  assert.equal(here({ unit: 'T-095', type: 'TRAILER' }), true, 'owned, matched without the leading zero');
  assert.equal(here({ unit: '688', type: 'TRUCK' }), true, 'the yard trucks stay');
  assert.equal(here({ unit: '221810', type: 'TRUCK' }), false, 'out of service, no longer ours (Joe 10/18)');
  // Not on the fleet list: its Equipment Master plant decides (T-999 is Uniontown's, Joe 10/18), unless its notes say leased.
  assert.equal(here({ unit: 'T-999', type: 'TRAILER', location: 'Martins Ferry OH Branch' }), true);
  assert.equal(here({ unit: '900009', type: 'TRUCK', notes: 'External Fleet: 2022 | Lease: PENSKE' }), false);
  assert.equal(here({ unit: 'T-900', type: 'TRAILER', notes: 'External Fleet: 2022 | Lease: First' }), true);
  // Before the fleet list has been read.
  assert.equal(L.fleetOwnedHere({ unit: '223876', type: 'TRUCK' }, 'fac_uniontown', null), true);
  assert.equal(L.fleetUnitKey('t 095'), 'T-95');
  assert.equal(L.fleetUnitKey('R639'), 'R-639');
  assert.equal(L.fleetUnitKey('00688'), '688');
});
