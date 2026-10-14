'use strict';
// Joe 10/14: answering-service check-ins go on the run Dispatch put that driver on, even when the route is said short or wrong.
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickMailRun, digestEntries, takenAt } = require('../../src/admintools');

// Tuesday 10/13 on the real Live sheet, and what the drivers told the answering service that day.
const DAY = [
  { id: '803', route: '803', streamId: '803', driver: 'HOWSARE, CHARLES' }, { id: '808', route: '808', streamId: '808', driver: 'BARROW, ROGIE' },
  { id: '812', route: '812', streamId: '812', driver: 'ALSTON, BRANDON' }, { id: '822', route: '822', streamId: '822', driver: 'JONES, MICHAEL' },
  { id: '6301_1', route: '6301_1', streamId: '6301', driver: 'THOMAS, CARSON' }, { id: '6302', route: '6302', streamId: '6302', driver: 'GREGORY, MICHAEL' },
  { id: 'rugg', route: '5', streamId: '5', driver: 'RUGG, DONALD' }, { id: '892', route: '892', streamId: '892', driver: 'YODER, SCOTT' }];
const pick = (route, driver) => pickMailRun(DAY, route, driver).id;

test('the driver\'s name picks the run: route as typed, its last digits, or wrong', () => {
  assert.equal(pick('803', 'Charles Howsare'), '803');
  assert.equal(pick('8', 'Rogie Barrow'), '808', '"8" for 808');
  assert.equal(pick('12', 'Michael Jones'), '822', 'said 12, Dispatch put him on 822');
  assert.equal(pick('6301', 'Carson Thomas'), '6301_1', 'the route without the run number');
  assert.equal(pick('6302', 'MIKE GREGORY'), '6302', 'a short first name');
  assert.equal(pick('5556', 'Don Rugg'), 'rugg', 'route typed wrong, name still finds him');
  assert.equal(pick('892-901', 'Scott Yoder'), '892', 'two routes in one box');
});

test('with no name match only the route as typed counts; its last digits alone never do', () => {
  assert.equal(pick('812', 'Fill In Driver'), '812');
  assert.equal(pick('8', 'Fill In Driver'), '');
  assert.equal(pick('', ''), '');
});

test('a mistyped last name still finds the driver (Joe 10/14: "MIKE GREGORYT")', () => {
  assert.equal(pick('6502', 'MIKE GREGORYT'), '6302');
  assert.equal(pick('', 'MIKE GREGG'), '', 'two letters off is someone else');
});

// The first email of each day's conversation (10/14 08:26a): every check-in taken the day before.
const LIST = ['===========0000006405=================', 'Wed 14-Oct-26 08:26a', '======================================',
  'Tue 13-Oct-26 07:03p TAKEN', 'Tue 13-Oct-26 07:03p DELIVERED', 'Name +(UT): Don Rugg', 'Tractor Number: 888', 'Route Number: 5556', 'How Many Cases: 1350', 'How Many Returned: 1512', '',
  '======================================', 'Tue 13-Oct-26 06:42p TAKEN', 'Tue 13-Oct-26 06:42p DELIVERED', 'Name +(UT): Rogie Barrow', 'Route #: 8', 'Cases Delivered: 419', 'Cases Returned: 561', '',
  '======================================', 'Tue 13-Oct-26 08:28a TAKEN', 'Tue 13-Oct-26 08:28a DELIVERED', 'Name +(UT): Joel Jacobs', 'Route Number: 880', 'How Many Cases: 14', '',
  '===========0000006405================='].join('\n');

test('the morning list is split into each check-in, each with the time it was taken', () => {
  const e = digestEntries(LIST);
  assert.deepEqual(e.map(c => [c.driver, c.route, c.taken, c.casesDelivered, c.takenAt]), [
    ['Don Rugg', '5556', '2026-10-13', 1350, '2026-10-13T23:03:00.000Z'],
    ['Rogie Barrow', '8', '2026-10-13', 419, '2026-10-13T22:42:00.000Z'],
    ['Joel Jacobs', '880', '2026-10-13', 14, '2026-10-13T12:28:00.000Z']]);
  assert.equal(takenAt('Tue 15-Dec-26 08:00a TAKEN'), '2026-12-15T13:00:00.000Z', 'winter is 5 hours behind');
  assert.equal(takenAt('Name: A'), '');
});
