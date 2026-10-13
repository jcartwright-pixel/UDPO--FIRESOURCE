'use strict';
// Review item 61 (Joe 10/13): a run line rewritten from the sheet keeps the day fields only the app holds.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');

let clock = 0;
const tick = () => new Date(Date.parse('2026-10-09T12:00:00Z') + (++clock) * 60000);
const KEEP = { intendedDriverId: 'drv_test_adams', intendedDriver: 'ADAMS, PAT', driverExceptionStatus: 'VACATION', checkinTruck: '900002', checkinTrailer: 'T-902', moreTrailers: ['T-901'] };

async function markFirstRun() {
  const snap = (await db().collection('runs').get()).docs.find(d => Object.keys(d.data().days || {}).length);
  const p = Object.keys(snap.data().days)[0];
  const update = {};
  Object.keys(KEEP).forEach(k => { update['days.' + p + '.' + k] = KEEP[k]; });
  await snap.ref.update(update);
  return { ref: snap.ref, p };
}

test('a run rewritten from the sheet keeps the vacation marks and the phone\'s units', async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: tick });
  const { ref, p } = await markFirstRun();
  // force rewrites every run from the sheet, as a changed line does.
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: tick, force: true });
  const day = (await ref.get()).data().days[p];
  Object.keys(KEEP).forEach(k => assert.deepEqual(day[k], KEEP[k], k + ' kept'));
  assert.ok(day.driver !== undefined, 'the sheet\'s own fields are still copied');
});

test('a copy from another workbook starts clean (nothing app-only carried over)', async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: tick });
  const { ref, p } = await markFirstRun();
  const other = Object.assign({}, F.SOURCES, { live: Object.assign({}, F.SOURCES.live, { spreadsheetId: 'another-live' }) });
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: other, now: tick });
  const day = (await ref.get()).data().days[p];
  assert.equal(day.intendedDriver, undefined);
  assert.equal(day.moreTrailers, undefined);
});
