'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const F = require('../fixtures/fake-sheets');

const MANAGER = { email: 'manager.test@uniteddairy.com' };
const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
let n = 0;
const rid = () => 'otr-' + (++n) + '-' + Date.now();
const now = () => new Date('2026-10-04T16:00:00Z');

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now });
});

test('Over the Road: a manager ticks a run, types a month figure and fixes a day; a dispatcher cannot', async () => {
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'saveOtr', requestId: rid(), op: 'route', runId: 'run_t801', include: true, destination: 'SAL' }, now), /role/);
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveOtr', requestId: rid(), op: 'route', runId: 'run_t801', include: true, destination: '' }, now), /Pick where this route goes/);
  await applyAction(db(), MANAGER, { action: 'saveOtr', requestId: rid(), op: 'route', runId: 'run_t801', include: true, destination: 'save a lot' }, now);
  const route = (await db().collection('otrRoutes').doc('run_t801').get()).data();
  assert.equal(route.include, true);
  assert.equal(route.destination, 'SAL', 'destination names are matched like the current app');

  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveOtr', requestId: rid(), op: 'figure', year: 2026, month: 9, key: 'gallons_sold', value: 'lots' }, now), /not a number/);
  await applyAction(db(), MANAGER, { action: 'saveOtr', requestId: rid(), op: 'figure', year: 2026, month: 9, key: 'gallons_sold', value: '1,250,000' }, now);
  await applyAction(db(), MANAGER, { action: 'saveOtr', requestId: rid(), op: 'figure', year: 2026, month: 9, key: 'distribution_cost', value: '$400,000' }, now);
  const sept = (await db().collection('otrMonthly').doc('2026-09').get()).data();
  assert.equal(sept.gallons_sold, 1250000);
  assert.equal(sept.distribution_cost, 400000, 'two figures for one month land on the same record');

  await applyAction(db(), MANAGER, { action: 'saveOtr', requestId: rid(), op: 'day', date: '2026-10-04', destination: 'Jersey', runs: 2 }, now);
  const day = (await db().collection('otrDaily').doc('2026-10-04__Jersey').get()).data();
  assert.equal(day.runs, 2);
  assert.equal(day.source, 'MANUAL');
});
