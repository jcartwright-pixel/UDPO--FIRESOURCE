'use strict';
// Route Distribution home (review item 16): drivers available today, counted as the current app's Dispatch Center does.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../src/logic');

test('available drivers: active, not off that day, not marked off that weekday on Driver Master', () => {
  const drivers = [
    { id: 'D1', name: 'A', status: 'ACTIVE', cells: { thu_available: 'TRUE' } },
    { id: 'D2', name: 'B', status: 'ACTIVE', cells: { thu_available: 'FALSE' } },
    { id: 'D3', name: 'C', status: 'ACTIVE', cells: { thu_available: '' } },
    { id: 'D4', name: 'D', status: 'INACTIVE', cells: {} },
    { id: 'D5', name: 'E', status: 'ACTIVE' }
  ];
  const exceptions = [{ driverId: 'D5', startDate: '2026-10-08', endDate: '2026-10-08', status: 'APPROVED', type: 'VACATION' }];
  assert.deepEqual(L.availableDrivers(drivers, exceptions, '2026-10-08').map(d => d.id), ['D1', 'D3']);
  assert.deepEqual(L.availableDrivers(drivers, [], '2026-10-08').map(d => d.id), ['D1', 'D3', 'D5']);
  assert.equal(L.homeNumbers([], drivers, [], '2026-10-08', exceptions).drivers.available, 2);
});
