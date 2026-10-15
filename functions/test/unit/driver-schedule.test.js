'use strict';
// Joe 10/15: My Schedule on the drivers' phone: the week Sunday to Saturday; from Saturday 6 AM the coming week.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../src/logic');
const { scheduleWeek, scheduleDays, employeeKey } = require('../../src/phone');

test('the week shown: this week until Saturday, then the coming Sunday to Saturday', () => {
  assert.equal(scheduleWeek('2026-10-11'), '2026-10-11'); // Sunday
  assert.equal(scheduleWeek('2026-10-16'), '2026-10-11'); // Friday
  assert.equal(scheduleWeek('2026-10-17'), '2026-10-18'); // Saturday (operating day, from 6 AM)
  // Friday 11 PM and Saturday 5:59 AM are still Friday's operating day; 6 AM Saturday switches.
  assert.equal(scheduleWeek(L.operatingDay(new Date('2026-10-17T09:59:00Z'))), '2026-10-11');
  assert.equal(scheduleWeek(L.operatingDay(new Date('2026-10-17T10:00:00Z'))), '2026-10-18');
});

test('employee numbers match with or without leading zeros and spaces', () => {
  assert.equal(employeeKey(' 09959 '), '9959');
  assert.equal(employeeKey('Ramsey  Keyshawn'), 'RAMSEY KEYSHAWN');
  assert.equal(employeeKey(''), '');
});

test('each day: his routes, else why he is off, else Off from Driver Master, else Not scheduled', () => {
  const week = '2026-10-18';
  const driver = { id: 'drv_a', name: 'ALPHA, AL', cells: { sun_available: 'FALSE', mon_available: 'TRUE', tue_available: 'TRUE', wed_available: 'TRUE', thu_available: 'TRUE', fri_available: 'TRUE', sat_available: 'FALSE' } };
  const run = (route, runName, days) => ({ id: week + '__' + route, weekStart: week, route, run: runName, runId: 'run_' + route, days });
  const runs = [
    run('905_1', 'UT DSD MILK', { mon: { runs: true, driverId: 'drv_a', driver: 'ALPHA, AL', truck: '537', trailer: 'T-905', dispatchTime: 210 }, tue: { runs: true, driverId: 'drv_a', driver: 'ALPHA, AL' }, wed: { runs: true, driverId: 'drv_b' } }),
    run('836', 'PECK', { tue: { runs: true, driverId: 'drv_a', driver: 'ALPHA, AL' } })
  ];
  const exceptions = [{ driverId: 'drv_a', startDate: '2026-10-22', endDate: '2026-10-22', type: 'VACATION', status: 'APPROVED' }];
  const days = scheduleDays(driver, L.weeklyRows(runs, week), exceptions, week);
  assert.deepEqual(days.map(d => d.date), ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
  assert.equal(days[0].status, 'Off');
  assert.deepEqual(days[1].runs, [{ route: '905', run: 'UT DSD MILK', truck: '537', trailer: 'T-905', leaves: '3:30 AM' }]);
  assert.equal(days[1].status, '');
  assert.deepEqual(days[2].runs.map(r => r.route).sort(), ['836', '905']);
  assert.equal(days[3].status, 'Not scheduled', 'another driver\'s run is not his');
  assert.equal(days[4].status, 'Off: Vacation');
  assert.equal(days[5].status, 'Not scheduled');
  assert.equal(days[6].status, 'Off');
  days.forEach(d => assert.ok(d.runs.length || d.status, 'never blank: ' + d.day));
});

test('the phone page has My Schedule with the employee number box', () => {
  const route = require('fs').readFileSync(require('path').join(__dirname, '../../../public/route.html'), 'utf8');
  assert.match(route, /id="m-schedule"[^>]*><b>My Schedule<\/b>/);
  assert.match(route, /<label for="emp-id">Your employee number<\/label>/);
});
