'use strict';
// Joe 10/14: answering-service check-ins go on the run Dispatch put that driver on, even when the route is said short or wrong.
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickMailRun } = require('../../src/admintools');

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
