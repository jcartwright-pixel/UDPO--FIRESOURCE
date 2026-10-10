'use strict';
// Joe 10/10: the Driver Room board shows the operating day's LOADOUT (Saturday = the Sunday and Monday deliveries),
// not the loads delivered that day (which were loaded the day before).
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../../src/board-rules');

test('the board shows what is loaded today: Saturday carries Sunday and Monday, not Saturday\'s deliveries', () => {
  const run = (id, route, weekStart, days) => ({ id, weekStart, route, run: 'R' + id, days });
  const runs = [
    run('sat', '801', '2026-10-04', { sat: { runs: true, loadSequence: 1, driver: 'FRIDAY LOADED' } }),            // loaded Friday 10/9
    run('sun', '802', '2026-10-11', { sun: { runs: true, loadSequence: 2, driver: 'SUNDAY RUN' } }),               // loaded Saturday 10/10
    run('mon', '803', '2026-10-11', { mon: { runs: true, loadSequence: 1, loadDayOffset: -2, driver: 'MONDAY RUN' } }) // loaded Saturday 10/10
  ];
  const pickups = [{ runDocId: 'mon', day: 'mon', date: '2026-10-12', item: 'empties', status: 'OPEN' }];
  const rows = B.loadoutBoardRows(runs, pickups, '2026-10-10');
  assert.deepEqual(rows.map(r => [r.route, r.driver, r.deliveryDate]), [['803', 'MONDAY RUN', '2026-10-12'], ['802', 'SUNDAY RUN', '2026-10-11']]);
  assert.equal(rows[0].pickup, true);
  assert.deepEqual(B.loadoutBoardRows(runs, [], '2026-10-09').map(r => r.route), ['801']);
});
