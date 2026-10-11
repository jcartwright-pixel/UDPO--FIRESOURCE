const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQueue } = require('../../src/transfer');

test('Garage work orders: read by work_order_id, status kept, a blank status counts as NEW', () => {
  const { docs, warnings } = parseQueue('workOrders', [
    ['work_order_id', 'unit', 'unit_type', 'problem', 'status', 'can_run'],
    ['WO-1', '223876', 'TRUCK', 'Light out', 'DONE', 'YES'],
    ['WO-2', 'T-888', 'TRAILER', 'Reefer', '', 'NO'],
    ['WO-1', '999', 'TRUCK', 'again', 'NEW', 'YES'],
    ['', 'x', '', '', '', '']
  ]);
  assert.deepEqual(Object.keys(docs).sort(), ['WO-1', 'WO-2']);
  assert.equal(docs['WO-1'].unit, '223876');
  assert.equal(docs['WO-1'].status, 'DONE');
  assert.equal(docs['WO-2'].status, 'NEW');
  assert.equal(docs['WO-2'].kind, 'WORK_ORDER');
  assert.equal(warnings.length, 1);
});
