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

// Joe 10/30: at the 6 a.m. roll the Driver Room board keeps yesterday's loads that are not loaded yet, first, until they are
// loaded or Ended Up Not Running; the Load done texts read today's loads only (no carry).
test('the Driver Room board keeps yesterday\'s unfinished loads after the 6 a.m. roll', () => {
  const run = (id, route, weekStart, days) => ({ id, weekStart, route, run: 'R' + id, days });
  const runs = [
    run('a', '901', '2026-10-25', { fri: { runs: true, loadSequence: 1, driver: 'LEFT OVER' } }),                         // loaded Thu 10/29, waiting
    run('b', '902', '2026-10-25', { fri: { runs: true, loadSequence: 2, driver: 'STARTED', plantStartedAt: '2026-10-30T09:00:00Z' } }),
    run('c', '903', '2026-10-25', { fri: { runs: true, loadSequence: 3, driver: 'DONE', completeTime: '2026-10-30T08:00:00Z' } }),
    run('d', '904', '2026-10-25', { fri: { runs: false, loadSequence: 4, driver: 'NOT RUNNING' } }),
    run('e', '855', '2026-10-25', { thu: { runs: true, loadSequence: 5, loadDayOffset: 0, driver: 'SAME DAY' } }),        // loaded and leaving Thu 10/29
    run('f', '905', '2026-10-25', { sat: { runs: true, loadSequence: 1, driver: 'TODAY' } })                               // loaded Fri 10/30
  ];
  const rows = B.loadoutBoardRows(runs, [], '2026-10-30', { carry: true });
  assert.deepEqual(rows.map(r => [r.route, r.prior, r.state]), [['901', true, 'WAITING'], ['902', true, 'LOADING'], ['855', true, 'WAITING'], ['905', false, 'WAITING']]);
  assert.deepEqual(B.loadoutBoardRows(runs, [], '2026-10-30').map(r => r.route), ['905']);
});
