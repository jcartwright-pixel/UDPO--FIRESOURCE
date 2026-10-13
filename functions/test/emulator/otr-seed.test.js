'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { seedOtrOnce, seedOtrRoutesOnce, OTR_ROUTES } = require('../../src/otr-seed');

test.beforeEach(async () => { await clear(); });

test('Over the Road sandbox history: fills months, days and comments once, keeps typed day counts, comments and figures', async () => {
  await db().collection('otrComments').doc('2021-05-25').set({ date: '2021-05-25', text: 'typed here', source: 'MANUAL' });
  await db().collection('otrDaily').doc('2026-08-03__Jersey').set({ date: '2026-08-03', destination: 'Jersey', runs: 5, source: 'MANUAL' });
  await db().collection('otrMonthly').doc('2026-08').set({ year: 2026, month: 8, miles: 1000, source: 'TYPED' });
  const data = { figures: [{ year: 2026, month: 8, key: 'distribution_cost', value: 851110.33 }, { year: 2026, month: 8, key: 'gallons_sold', value: 2506226 }, { year: 2025, month: 8, key: 'gallons_sold', value: 2400000 }],
    daily: [{ date: '2026-08-03', destination: 'Jersey', runs: 2 }, { date: '2026-08-04', destination: 'SAL', runs: 3 }],
    comments: [{ date: '2021-05-25', text: 'Lost 5 Walmart Rts' }, { date: '2021-05-26', text: 'Added 2 walmart rts' }] };
  const first = await seedOtrOnce(db(), { data });
  assert.deepEqual(first, { months: 2, days: 1, comments: 1 });
  assert.equal((await db().collection('otrComments').doc('2021-05-25').get()).data().text, 'typed here');
  assert.equal((await db().collection('otrComments').doc('2021-05-26').get()).data().text, 'Added 2 walmart rts');
  const aug = (await db().collection('otrMonthly').doc('2026-08').get()).data();
  assert.equal(aug.distribution_cost, 851110.33);
  assert.equal(aug.gallons_sold, 2506226);
  assert.equal(aug.miles, 1000);
  assert.equal((await db().collection('otrDaily').doc('2026-08-03__Jersey').get()).data().runs, 5);
  assert.equal((await db().collection('otrDaily').doc('2026-08-04__SAL').get()).data().source, 'IMPORT');
  assert.deepEqual(await seedOtrOnce(db(), { data }), { skipped: true }, 'runs one time');
});

test('Over the Road sandbox history: the bundled file holds 2026 figures', () => {
  const data = require('../../seed/otr-import-2026-10.json');
  const aug = data.figures.filter(f => f.year === 2026 && f.month === 8).map(f => f.key).sort();
  assert.deepEqual(aug, ['distribution_cost', 'employee_cost', 'fuel_cost', 'gallons_sold']);
  assert.equal(data.comments.length, 138, 'the By Date Comment column rides along');
  assert.equal(data.comments.find(c => c.date === '2021-05-25').text, 'Lost 5 Walmart Rts');
});

// Joe 10/13: his OTR runs ticked in OTR Routes Setup from his workbook; a run set by hand stays as it is.
test('OTR Routes Setup fill: ticks his OTR runs with their By Date column once, keeps a run set by hand', async () => {
  await db().collection('otrRoutes').doc('run_4ebab0bd8a1aa00ce0b7').set({ runId: 'run_4ebab0bd8a1aa00ce0b7', include: false, destination: 'Peck', deliveredBy: 'Carrier Pickup' });
  const out = await seedOtrRoutesOnce(db());
  assert.deepEqual(out, { set: OTR_ROUTES.length - 1, kept: 1 });
  const sal = (await db().collection('otrRoutes').doc('run_6b2007de2c62a8ca0018').get()).data();
  assert.deepEqual([sal.include, sal.destination, sal.deliveredBy], [true, 'SAL', 'United Dairy Delivered']);
  assert.equal((await db().collection('otrRoutes').doc('run_4ebab0bd8a1aa00ce0b7').get()).data().deliveredBy, 'Carrier Pickup');
  assert.deepEqual(await seedOtrRoutesOnce(db()), { skipped: true }, 'runs one time');
});

test('OTR Routes Setup fill: every run goes to one of his By Date columns, and each column he counts has a run', () => {
  const O = require('../../src/otr-core');
  OTR_ROUTES.forEach(r => assert.ok(O.OTR_CORE.DESTINATIONS.indexOf(r[1]) >= 0, r[1]));
  assert.equal(new Set(OTR_ROUTES.map(r => r[0])).size, OTR_ROUTES.length);
  ['SAL', 'Jersey', 'Reinhart', 'J&J Snacks', 'Garber', 'Cream-O-Land', 'Lancaster', 'Ferry', 'Peck', 'I/W Columbus', 'I/W', 'OH Processors', 'Ventura Foods', 'USDA', 'Sun Valley']
    .forEach(c => assert.ok(OTR_ROUTES.some(r => r[1] === c), c));
});
