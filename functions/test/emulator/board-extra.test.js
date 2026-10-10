'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const L = require('../../src/logic');
const F = require('../fixtures/fake-sheets');

const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
const RUN = '2026-10-04__run_t802';
const tick = () => new Date('2026-10-09T12:00:00Z');

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: tick });
});

test('Driver Assignment Board: a driver picked by hand marks the day changed (route_override) and the board cell light blue', async () => {
  const board = async () => {
    const runs = (await db().collection('runs').get()).docs.map(d => Object.assign({ id: d.id }, d.data()));
    const drivers = (await db().collection('drivers').get()).docs.map(d => d.data());
    return L.driverBoardRows(drivers, L.weeklyRows(runs, '2026-10-04'), [], '2026-10-04');
  };
  assert.equal((await board()).find(d => d.id === 'drv_test_adams').days.tue.extra, false);
  await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: 'extra-' + Date.now(), runDocId: RUN, day: 'tue', driverId: 'drv_test_adams' });
  const run = (await db().collection('runs').doc(RUN).get()).data();
  assert.equal(run.days.tue.routeOverride, 'TRUE');
  const adams = (await board()).find(d => d.id === 'drv_test_adams');
  assert.equal(adams.days.tue.extra, true);
  assert.equal(adams.days.mon.extra, false);
});
