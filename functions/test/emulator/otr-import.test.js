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
const rid = () => 'otr-imp-' + (++n) + '-' + Date.now();
const now = () => new Date('2026-10-04T16:00:00Z');

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now });
});

test('Over the Road import: the accounting numbers fill their months, a typed day count is kept, a dispatcher cannot', async () => {
  const figures = [{ year: 2026, month: 8, key: 'distribution_cost', value: 150000 }, { year: 2026, month: 8, key: 'employee_cost', value: 60000 },
    { year: 2026, month: 1, key: 'gallons_sold', value: 950000 }];
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'saveOtr', requestId: rid(), op: 'import', figures, daily: [] }, now), /role/);
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveOtr', requestId: rid(), op: 'import', figures: [], daily: [] }, now), /Nothing to import/);
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveOtr', requestId: rid(), op: 'import', figures: [{ year: 2026, month: 8, key: 'nope', value: 1 }] }, now), /Unknown figure/);

  await applyAction(db(), MANAGER, { action: 'saveOtr', requestId: rid(), op: 'figure', year: 2026, month: 8, key: 'miles', value: '1,000' }, now);
  await applyAction(db(), MANAGER, { action: 'saveOtr', requestId: rid(), op: 'day', date: '2026-08-03', destination: 'Jersey', runs: 5 }, now);
  const res = await applyAction(db(), MANAGER, { action: 'saveOtr', requestId: rid(), op: 'import', figures,
    daily: [{ date: '2026-08-03', destination: 'Jersey', runs: 2 }, { date: '2026-08-04', destination: 'save a lot', runs: 3 }] }, now);
  assert.equal(res.months, 2);
  assert.equal(res.keptTyped, 1);

  const aug = (await db().collection('otrMonthly').doc('2026-08').get()).data();
  assert.equal(aug.distribution_cost, 150000);
  assert.equal(aug.employee_cost, 60000);
  assert.equal(aug.miles, 1000, 'a typed figure the file does not carry stays');
  assert.equal((await db().collection('otrMonthly').doc('2026-01').get()).data().gallons_sold, 950000);
  assert.equal((await db().collection('otrDaily').doc('2026-08-03__Jersey').get()).data().runs, 5, 'a typed day count wins over the import');
  const sal = (await db().collection('otrDaily').doc('2026-08-04__SAL').get()).data();
  assert.equal(sal.runs, 3);
  assert.equal(sal.source, 'IMPORT');
});
