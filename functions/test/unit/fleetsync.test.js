'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planFleetSync, fleetUnits } = require('../../src/fleetsync');

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
