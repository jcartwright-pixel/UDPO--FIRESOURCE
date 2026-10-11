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

test('Over the Road import: a 188-month accounting file saves every month in batches the server accepts', async () => {
  const O = require('../../src/otr-core');
  const figures = [];
  for (let i = 0; i < 188; i++) {
    const year = 2011 + Math.floor(i / 12), month = (i % 12) + 1;
    figures.push({ year, month, key: 'gallons_sold', value: 2000000 + i });
    if (year >= 2024) ['distribution_cost', 'employee_cost', 'fuel_cost'].forEach(key => figures.push({ year, month, key, value: 1000 + i }));
  }
  await db().collection('otrDaily').doc('2026-08-03__Jersey').set({ date: '2026-08-03', destination: 'Jersey', runs: 5, source: 'MANUAL' });
  const daily = [];
  for (let d = 1; d <= 400; d++) daily.push({ date: '2025-' + String(Math.ceil(d / 31) % 12 + 1).padStart(2, '0') + '-' + String((d % 28) + 1).padStart(2, '0'), destination: d % 2 ? 'SAL' : 'Jersey', runs: 1 });
  daily.push({ date: '2026-08-03', destination: 'Jersey', runs: 2 });
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveOtr', requestId: rid(), op: 'import', figures, daily: [] }, now), /Too many months/, 'one save of 188 months is still refused');
  const batches = O.otrImportBatches_({ figures, daily });
  assert.ok(batches.length >= 5);
  for (const b of batches) await applyAction(db(), MANAGER, Object.assign({ action: 'saveOtr', requestId: rid(), op: 'import' }, b), now);
  const months = await db().collection('otrMonthly').get();
  assert.equal(months.size, 188);
  assert.equal((await db().collection('otrMonthly').doc('2011-01').get()).data().gallons_sold, 2000000);
  assert.equal((await db().collection('otrMonthly').doc('2026-08').get()).data().fuel_cost, 1187);
  assert.equal((await db().collection('otrDaily').doc('2026-08-03__Jersey').get()).data().runs, 5, 'a typed day count is never replaced');
});

test('Over the Road By Date comments: typed on a day, imported from the workbook, a typed one is kept', async () => {
  await applyAction(db(), MANAGER, { action: 'saveOtr', requestId: rid(), op: 'comment', date: '2021-05-25', text: 'Lost 5 Walmart routes' }, now);
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveOtr', requestId: rid(), op: 'comment', date: '5/25/21', text: 'x' }, now), /yyyy-mm-dd/);
  const res = await applyAction(db(), MANAGER, { action: 'saveOtr', requestId: rid(), op: 'import', figures: [], daily: [],
    comments: [{ date: '2021-05-25', text: 'Lost 5 Walmart Rts' }, { date: '2021-05-26', text: 'Added 2 walmart rts' }] }, now);
  assert.equal(res.comments, 1);
  assert.equal((await db().collection('otrComments').doc('2021-05-25').get()).data().text, 'Lost 5 Walmart routes', 'a typed comment wins');
  const d = (await db().collection('otrComments').doc('2021-05-26').get()).data();
  assert.equal(d.text, 'Added 2 walmart rts');
  assert.equal(d.source, 'IMPORT');
  await applyAction(db(), MANAGER, { action: 'saveOtr', requestId: rid(), op: 'comment', date: '2021-05-26', text: '' }, now);
  assert.equal((await db().collection('otrComments').doc('2021-05-26').get()).data().text, '', 'an empty box clears it');
});
