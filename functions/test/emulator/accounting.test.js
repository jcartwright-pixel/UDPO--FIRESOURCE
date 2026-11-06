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
