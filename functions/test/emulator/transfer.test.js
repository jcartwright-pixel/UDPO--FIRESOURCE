'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');

const NOW = () => new Date('2026-10-09T12:00:00Z');
let clock = 0;
const tick = () => new Date(Date.parse('2026-10-09T12:00:00Z') + (++clock) * 60000);

test.beforeEach(clear);

test('the first transfer copies the three Live weeks and the master lists', async () => {
  const reader = F.fakeReader(F.fakeSheets());
  const out = await runTransfer({ db: db(), reader, sources: F.SOURCES, now: NOW });
  assert.deepEqual(out.liveWeeks, { previous: '2026-09-27', current: '2026-10-04', next: '2026-10-11' });
  assert.equal(out.summary.weeks['2026-10-04'].written, 6);
  const run = (await db().collection('runs').doc('2026-10-04__run_t801').get()).data();
  assert.equal(run.days.mon.driver, 'ADAMS, PAT');
  assert.equal(run.days.tue.driverId, 'drv_test_brook');
  const config = (await db().collection('config').doc('app').get()).data();
  assert.equal(config.mode, 'test');
  assert.deepEqual(config.screenOwners, { dailyDispatch: 'old', weeklyDispatch: 'old' });
  assert.equal((await db().collection('drivers').doc('drv_test_casey').get()).data().name, 'CASEY, LEE');
  assert.deepEqual((await db().collection('users').doc('manager.test@uniteddairy.com').get()).data().roles, ['MANAGER']);
  // One read per spreadsheet: four master lists and one for all three Live tabs. Reads only.
  assert.equal(reader.calls.length, Object.keys(F.SOURCES.masters).length + 1);
  assert.deepEqual(reader.calls[reader.calls.length - 1].ranges, ["'LIVE PREVIOUS WEEK'", "'LIVE CURRENT WEEK'", "'LIVE NEXT WEEK'"]);
});

test('an unchanged sheet writes nothing; one changed cell rewrites one run', async () => {
  const tabs = F.fakeSheets();
  await runTransfer({ db: db(), reader: F.fakeReader(tabs), sources: F.SOURCES, now: tick });
  const again = await runTransfer({ db: db(), reader: F.fakeReader(tabs), sources: F.SOURCES, now: tick });
  Object.values(again.summary.weeks).forEach(w => assert.equal(w.written, 0));
  Object.values(again.summary.masters).forEach(m => assert.equal(m.written, 0));

  const live = tabs["'LIVE CURRENT WEEK'"];
  const col = live[5].indexOf('mon_trailer_id');
  live[6][col] = 'veh_trailer_t_902';
  live[6][live[5].indexOf('mon_trailer')] = 'T-902';
  const third = await runTransfer({ db: db(), reader: F.fakeReader(tabs), sources: F.SOURCES, now: tick });
  assert.equal(third.summary.weeks['2026-10-04'].written, 1);
  assert.equal((await db().collection('runs').doc('2026-10-04__run_t801').get()).data().days.mon.trailer, 'T-902');
});

test('a new copy of the Live workbook replaces every row, even one the app changed without writing it to the sheet', async () => {
  const tabs = F.fakeSheets();
  await runTransfer({ db: db(), reader: F.fakeReader(tabs), sources: F.SOURCES, now: tick });
  // A sandbox test save with the write-back off: the run changes in the app, the sheet never hears of it.
  const ref = db().collection('runs').doc('2026-10-04__run_t801');
  await ref.update({ 'days.mon.driver': 'TEST, SAVE' });
  const same = await runTransfer({ db: db(), reader: F.fakeReader(tabs), sources: F.SOURCES, now: tick });
  assert.equal(same.summary.weeks['2026-10-04'].written, 0);
  assert.equal((await ref.get()).data().days.mon.driver, 'TEST, SAVE', 'the same copy keeps the app value');
  const fresh = Object.assign({}, F.SOURCES, { live: Object.assign({}, F.SOURCES.live, { spreadsheetId: 'fresh-copy' }) });
  const out = await runTransfer({ db: db(), reader: F.fakeReader(tabs), sources: fresh, now: tick });
  assert.equal(out.summary.weeks['2026-10-04'].written, 6);
  assert.equal((await ref.get()).data().days.mon.driver, 'ADAMS, PAT', 'a fresh copy brings the sheet value back');
  assert.equal((await db().collection('config').doc('app').get()).data().liveSourceId, 'fresh-copy');
});

test('sorting the Live tab moves nothing', async () => {
  const tabs = F.fakeSheets();
  await runTransfer({ db: db(), reader: F.fakeReader(tabs), sources: F.SOURCES, now: tick });
  const before = (await db().collection('runs').doc('2026-10-04__run_t802').get()).data();
  const live = tabs["'LIVE CURRENT WEEK'"];
  tabs["'LIVE CURRENT WEEK'"] = live.slice(0, 6).concat(live.slice(6).reverse());
  const out = await runTransfer({ db: db(), reader: F.fakeReader(tabs), sources: F.SOURCES, now: tick });
  assert.equal(out.summary.weeks['2026-10-04'].written, 0);
  const after = (await db().collection('runs').doc('2026-10-04__run_t802').get()).data();
  assert.deepEqual(after.days, before.days);
});

test('a row removed from the sheet is removed from the copy', async () => {
  const tabs = F.fakeSheets();
  await runTransfer({ db: db(), reader: F.fakeReader(tabs), sources: F.SOURCES, now: tick });
  const live = tabs["'LIVE CURRENT WEEK'"];
  tabs["'LIVE CURRENT WEEK'"] = live.filter(r => r[live[5].indexOf('run_id')] !== 'run_t802');
  const out = await runTransfer({ db: db(), reader: F.fakeReader(tabs), sources: F.SOURCES, now: tick });
  assert.equal(out.summary.weeks['2026-10-04'].removed, 1);
  assert.equal((await db().collection('runs').doc('2026-10-04__run_t802').get()).exists, false);
});

test('the transfer refuses to run once a screen belongs to the new app', async () => {
  await db().collection('config').doc('app').set({ mode: 'test', screenOwners: { dailyDispatch: 'new' } });
  await assert.rejects(runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: tick }), /already belongs to the new app/);
});

test('two Live tabs for the same week stop the transfer', async () => {
  const tabs = F.fakeSheets();
  tabs["'LIVE NEXT WEEK'"] = tabs["'LIVE CURRENT WEEK'"];
  await assert.rejects(runTransfer({ db: db(), reader: F.fakeReader(tabs), sources: F.SOURCES, now: tick }), /same week/);
});
