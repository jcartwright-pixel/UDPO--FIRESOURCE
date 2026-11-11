'use strict';
// Joe 11-6-26: the Hub reads the monthly accounting package once and keeps each month's numbers (accountingMonthly) for
// Over the Road and the cost analysis app. Made-up numbers only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const A = require('../../src/accounting');
const { adminCall } = require('../../src/admin');
const { septemberZip } = require('../fixtures/accounting-zip');

const ADMIN = { email: 'pat.admin@uniteddairy.com' };
const tick = () => new Date('2026-11-06T11:00:00Z');
const admins = async () => {
  await db().collection('users').doc('pat.admin@uniteddairy.com').set({ status: 'ACTIVE', roles: ['Administrator'], name: 'Pat Admin', facilities: ['fac_uniontown'] });
  await db().collection('users').doc('sam.sales@uniteddairy.com').set({ status: 'ACTIVE', roles: ['Sales'], name: 'Sam Sales', facilities: ['fac_uniontown'] });
};

test('Add a file by hand: the four numbers of each month are kept; a second copy changes nothing; only administrators', async () => {
  await clear(); await admins();
  const base64 = (await septemberZip()).toString('base64');
  await assert.rejects(adminCall(db(), { email: 'sam.sales@uniteddairy.com' }, { op: 'accountingUpload', fileName: 'pl.zip', base64 }), /administrator/i);
  const out = await adminCall(db(), ADMIN, { op: 'accountingUpload', fileName: 'plcomparisonsseptember.zip', base64 }, { now: tick });
  assert.deepEqual([out.saved.months, out.saved.changed, out.saved.newest], [2, 2, 'Sep 2026']);
  const sep = (await db().collection('accountingMonthly').doc('2026-09').get()).data();
  assert.deepEqual([sep.gallons_sold, sep.distribution_cost, sep.employee_cost, sep.fuel_cost, sep.source, sep.file, sep.savedBy],
    [2100000, 600000, 325000, 96000, 'BY HAND', 'plcomparisonsseptember.zip', 'pat.admin@uniteddairy.com']);
  assert.deepEqual((await db().collection('accountingMonthly').doc('2026-08').get()).data().gallons_sold, 2000000, 'August gallons from the Gallon Comparison');
  assert.equal(out.months[0].month, 9, 'newest month first');
  const again = await adminCall(db(), ADMIN, { op: 'accountingUpload', fileName: 'plcomparisonsseptember.zip', base64 }, { now: tick });
  assert.equal(again.saved.changed, 0);
  await assert.rejects(adminCall(db(), ADMIN, { op: 'accountingUpload', fileName: 'notes.txt', base64: Buffer.from('hello').toString('base64') }), /accounting zip/);
});

test('From email: a new zip in the mailbox is read once; a corrected one later replaces the numbers; off = not checked', async () => {
  await clear(); await admins();
  await assert.rejects(adminCall(db(), ADMIN, { op: 'accountingSaveSettings', mailbox: '', enabled: true }), /mailbox/);
  await adminCall(db(), ADMIN, { op: 'accountingSaveSettings', mailbox: 'Pat.Sample@uniteddairy.com', sender: 'books@example.com', enabled: false });
  const files = { a: await septemberZip(), b: await septemberZip({ total: 610000 }) };
  let inbox = [{ id: 'm1', internalDate: Date.parse('2026-11-05T15:00:00Z'), subject: 'P&L comparisons', from: 'books@example.com', files: [{ name: 'plcomparisonsseptember.zip', attachmentId: 'a', size: files.a.length }, { name: 'logo.png', attachmentId: 'x', size: 10 }] }];
  const asked = [];
  const deps = { now: tick, readMail: async (q) => { asked.push(q); return inbox; }, readAttachment: async (q) => { assert.equal(q.owner, 'pat.sample@uniteddairy.com'); return files[q.attachmentId]; } };
  assert.deepEqual(await A.morningCheck(db(), deps), { skipped: 'off' });
  await adminCall(db(), ADMIN, { op: 'accountingSaveSettings', mailbox: 'pat.sample@uniteddairy.com', sender: 'books@example.com', enabled: true });
  const run = await A.morningCheck(db(), deps);
  assert.deepEqual([run.status, run.read, run.saved], ['OK', 1, 2]);
  assert.match(asked[0].query, /filename:zip/); assert.match(asked[0].query, /from:books@example\.com/);
  assert.equal((await db().collection('accountingMonthly').doc('2026-09').get()).data().source, 'EMAIL');
  assert.equal((await A.morningCheck(db(), deps)).skipped, 1, 'the same email is not read twice');
  inbox = inbox.concat([{ id: 'm2', internalDate: Date.parse('2026-11-06T10:00:00Z'), files: [{ name: 'corrected.zip', attachmentId: 'b', size: files.b.length }] }]);
  const out = await adminCall(db(), ADMIN, { op: 'accountingCheckNow' }, Object.assign({}, deps));
  assert.deepEqual([out.run.read, out.run.saved], [1, 1], 'only September changed');
  assert.equal((await db().collection('accountingMonthly').doc('2026-09').get()).data().distribution_cost, 610000);
  assert.match(out.last.message, /newest month Sep 2026/);
});

test('From email: Google Workspace not set up yet says so in plain words, and the email is tried again next time', async () => {
  await clear(); await admins();
  await adminCall(db(), ADMIN, { op: 'accountingSaveSettings', mailbox: 'pat.sample@uniteddairy.com', enabled: true });
  const err = Object.assign(new Error('unauthorized_client'), { code: 'NOT_DELEGATED' });
  const run = await A.morningCheck(db(), { now: tick, readMail: async () => { throw err; } });
  assert.equal(run.status, 'FAIL');
  assert.match(run.message, /Google Workspace has not yet let the app read this mailbox/);
  const broken = await A.morningCheck(db(), { now: tick, readMail: async () => [{ id: 'm9', internalDate: 1, files: [{ name: 'p.zip', attachmentId: 'z', size: 5 }] }], readAttachment: async () => { throw new Error('Gmail did not answer (500)'); } });
  assert.equal(broken.status, 'FAIL');
  assert.equal((await db().collection('accountingMail').doc('m9').get()).exists, false, 'tried again next time');
});

test('The reader finds the month tab and the Gallon Comparison in the zip and leaves the rest', async () => {
  const read = await A.readPackage(await septemberZip(), 'pl.zip', 2026);
  assert.deepEqual(read.months.map(m => m.month), [8, 9]);
  assert.ok(read.tabs.some(t => /SEPT 2026/.test(t)));
});

// Joe 11-7-26: the route cost app needs more of the P&L than three numbers. The extra lines ride on the same month document.
test('The extra P&L lines are kept with each month: delivery and garage lines, net sales, material, sales and transfer gallons', async () => {
  await clear(); await admins();
  await adminCall(db(), ADMIN, { op: 'accountingUpload', fileName: 'pl.zip', base64: (await septemberZip()).toString('base64') }, { now: tick });
  const sep = (await db().collection('accountingMonthly').doc('2026-09').get()).data();
  assert.equal(sep.delivery_lines['Hourly Wages'], 150000);
  assert.equal(sep.delivery_lines['Truck Rental'], 80000);
  assert.equal(sep.delivery_lines['Repairs & Maint.'], 15000, 'names trimmed');
  assert.equal(Object.values(sep.delivery_lines).reduce((a, b) => a + b, 0), 516000, 'every line not 0, and no heading or TOTALS');
  assert.deepEqual(sep.garage_lines, { 'Hourly Wages': 14000, 'Repairs & Maint.': 2000 });
  assert.equal(sep.delivery_garage_cost, 16000);
  assert.deepEqual([sep.net_sales, sep.material_cost], [6200000.5, 4100000]);
  assert.deepEqual([sep.gallons_sales, sep.gallons_transfers, sep.gallons_sold], [1470000, 630000, 2100000]);
  assert.deepEqual([sep.distribution_cost, sep.employee_cost, sep.fuel_cost], [600000, 325000, 96000], 'the four numbers as before');
  const aug = (await db().collection('accountingMonthly').doc('2026-08').get()).data();
  assert.deepEqual([aug.net_sales, aug.gallons_sales, aug.delivery_lines], [6400000.25, 1400000, undefined], 'August sales from the September tab\'s last-month column');
  // A corrected file: a line that is gone leaves the map, a changed sales number replaces the old one.
  const out = await adminCall(db(), ADMIN, { op: 'accountingUpload', fileName: 'fixed.zip', base64: (await septemberZip({ noRepairs: true, sales: 6210000 })).toString('base64') }, { now: tick });
  assert.equal(out.saved.changed, 1);
  const fixed = (await db().collection('accountingMonthly').doc('2026-09').get()).data();
  assert.equal(fixed.delivery_lines['Repairs & Maint.'], undefined);
  assert.deepEqual(fixed.garage_lines, { 'Hourly Wages': 14000 });
  assert.deepEqual([fixed.net_sales, fixed.file, fixed.delivery_garage_cost], [6210000, 'fixed.zip', 14000]);
});

test('Months saved before the extra lines get them: an old copy (only four numbers) is filled in by the same file by hand', async () => {
  await clear(); await admins();
  await db().collection('accountingMonthly').doc('2026-09').set({ year: 2026, month: 9, gallons_sold: 2100000, distribution_cost: 600000, employee_cost: 325000, fuel_cost: 96000, file: 'old.zip', source: 'EMAIL' });
  const out = await adminCall(db(), ADMIN, { op: 'accountingUpload', fileName: 'pl.zip', base64: (await septemberZip()).toString('base64') }, { now: tick });
  assert.ok(out.saved.changedMonths.includes('Sep 2026'));
  assert.equal((await db().collection('accountingMonthly').doc('2026-09').get()).data().delivery_garage_cost, 16000);
});

test('From email: a zip read before the extra lines is read once more, then skipped as before', async () => {
  await clear(); await admins();
  await adminCall(db(), ADMIN, { op: 'accountingSaveSettings', mailbox: 'pat.sample@uniteddairy.com', enabled: true });
  await db().collection('accountingMonthly').doc('2026-09').set({ year: 2026, month: 9, gallons_sold: 2100000, distribution_cost: 600000, employee_cost: 325000, fuel_cost: 96000 });
  await db().collection('accountingMail').doc('m1').set({ at: '2026-11-06T11:00:00Z', files: [{ name: 'p.zip', months: 2 }] }); // no reader: read before 11-7-26
  const zip = await septemberZip();
  const deps = { now: tick, readMail: async () => [{ id: 'm1', internalDate: 1, files: [{ name: 'p.zip', attachmentId: 'a', size: zip.length }] }], readAttachment: async () => zip };
  const run = await A.morningCheck(db(), deps);
  assert.deepEqual([run.status, run.read], ['OK', 1]);
  assert.equal((await db().collection('accountingMonthly').doc('2026-09').get()).data().net_sales, 6200000.5);
  assert.equal((await db().collection('accountingMail').doc('m1').get()).data().reader, A.READER);
  assert.equal((await A.morningCheck(db(), deps)).skipped, 1);
});
