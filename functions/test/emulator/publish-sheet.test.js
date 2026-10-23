'use strict';
// Joe 10/16: "Let Operations' Publish move the weeks in the real Live sheet, the same way the old app's Publish does."
// With the write-back on, Publish moves the Live sheet's three tabs (liveroll.js) and then the weeks here; the copy and the
// write-back follow the weeks to their new tabs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const { runWriteBack, weekOf } = require('../../src/writeback');
const LR = require('../../src/liveroll');
const F = require('../fixtures/fake-sheets');

const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
const AT = () => new Date('2026-10-09T12:00:00Z');
let n = 0;
const rid = () => 'publish-sheet-' + (++n) + '-' + Date.now();
const PREV = "'LIVE PREVIOUS WEEK'", CUR = "'LIVE CURRENT WEEK'", NEXT = "'LIVE NEXT WEEK'", HIST = "'DISPATCH WEEK HISTORY'";
const config = async () => (await db().collection('config').doc('app').get()).data();
const week = async (w) => (await db().collection('runs').where('weekStart', '==', w).get()).docs.map(d => Object.assign({ id: d.id }, d.data()));
const copyOf = (v) => JSON.parse(JSON.stringify(v));

let tabs, sheets, flushed;
const deps = () => ({ liveRoll: () => ({ sheets, spreadsheetId: 'fake-live', allowRealLive: false, flush: async () => { flushed++; return runWriteBack({ db: db(), sheets, target: { spreadsheetId: 'fake-live' }, now: AT }); } }) });
function cell(tab, runId, column, days) {
  const v = tabs[tab], h = v[5];
  const rows = v.filter((r, i) => i > 5 && r[h.indexOf('run_id')] === runId && (!days || r[h.indexOf(days + '_runs')] === 'TRUE'));
  assert.equal(rows.length, 1, 'one row for ' + runId + ' on ' + tab);
  return rows[0][h.indexOf(column)];
}

test.beforeEach(async () => {
  await clear();
  tabs = F.fakeSheets();
  sheets = F.fakeWritableSheets(tabs);
  flushed = 0;
  await runTransfer({ db: db(), reader: sheets, sources: F.SOURCES, now: AT });
  for (const id of ['run_t801', 'run_t802', 'run_t810']) await db().collection('routes').doc(id).update({ displayDaily: true, displayWeekly: true });
  await db().collection('config').doc('app').set({ writeBack: { enabled: true } }, { merge: true });
});

test('Publish moves the Live sheet: Current over Previous, Next over Current, a new Next from Route Master, the old Previous archived', async () => {
  const before = { current: copyOf(tabs[CUR]), next: copyOf(tabs[NEXT]) };
  const out = await applyAction(db(), DISPATCHER, { action: 'publishWeek', requestId: rid(), weekStart: '2026-10-11' }, AT, deps());
  assert.deepEqual([out.previousWeek, out.currentWeek, out.nextWeek], ['2026-10-04', '2026-10-11', '2026-10-18']);
  assert.match(out.message, /^Week pushed live\. Current is now 10\/11.*The Live sheet's weeks moved too\.$/);
  assert.deepEqual((await config()).liveWeeks, { previous: '2026-10-04', current: '2026-10-11', next: '2026-10-18' });
  assert.equal(sheets.writes.filter(w => w.requests).length, 1, 'the whole move is one request, applied all together or not at all');

  // The tabs hold the new weeks, and their Week Start labels say so.
  assert.deepEqual([weekOf(tabs[PREV]), weekOf(tabs[CUR]), weekOf(tabs[NEXT])], ['2026-10-04', '2026-10-11', '2026-10-18']);
  assert.deepEqual([tabs[PREV][1][1], tabs[CUR][1][1], tabs[NEXT][1][1]], ['2026-10-04', '2026-10-11', '2026-10-18']);
  // Previous is the old Current, row for row (the label aside).
  const label = (v) => v.map((r, i) => (i === 1 ? [r[0]] : r.map(x => x === undefined ? '' : x)));
  assert.deepEqual(label(tabs[PREV]).slice(0, before.current.length), label(before.current));
  // Current is the old Next, with the blank Tuesday on 802 given its standard driver (the current app's fill-only pass).
  assert.equal(before.next[8][before.next[5].indexOf('tue_driver')], '');
  assert.equal(cell(CUR, 'run_t802', 'tue_driver'), 'CASEY, LEE');
  assert.equal(cell(CUR, 'run_t802', 'tue_driver_id'), 'drv_test_casey');
  assert.equal(cell(CUR, 'run_t801', 'mon_driver'), 'ADAMS, PAT', 'what was picked is kept');

  // Next: one row per Route Master run, seeded as the current app seeds it, with the drivers and units Operations built.
  const nextRows = tabs[NEXT].slice(6).filter(r => r.some(v => v));
  assert.deepEqual(nextRows.map(r => r[tabs[NEXT][5].indexOf('run_id')]), ['run_t801', 'run_t802', 'run_t810', 'run_t899']);
  assert.equal(cell(NEXT, 'run_t801', 'week_start_date'), '2026-10-18');
  assert.equal(cell(NEXT, 'run_t801', 'route'), '801');
  assert.equal(cell(NEXT, 'run_t801', 'mon_runs'), 'TRUE');
  assert.equal(cell(NEXT, 'run_t801', 'wed_runs'), '', 'blank in Route Master, as the current app seeds it');
  assert.equal(cell(NEXT, 'run_t801', 'mon_delivery_date'), '2026-10-19');
  assert.equal(cell(NEXT, 'run_t801', 'mon_delivery_day'), 'Monday');
  assert.equal(cell(NEXT, 'run_t801', 'mon_load_date'), '2026-10-18');
  assert.equal(cell(NEXT, 'run_t801', 'mon_load_day_offset'), '-1');
  assert.equal(cell(NEXT, 'run_t801', 'mon_load_sequence'), '20');
  assert.equal(cell(NEXT, 'run_t801', 'mon_dispatch_time'), '4:00:00 AM');
  assert.equal(cell(NEXT, 'run_t801', 'mon_miles'), '140');
  assert.equal(cell(NEXT, 'run_t801', 'mon_driver'), 'ADAMS, PAT');
  assert.equal(cell(NEXT, 'run_t801', 'mon_driver_id'), 'drv_test_adams');
  assert.equal(cell(NEXT, 'run_t801', 'mon_truck'), '900001');
  assert.equal(cell(NEXT, 'run_t801', 'mon_trailer'), 'T-901');
  assert.equal(cell(NEXT, 'run_t802', 'tue_driver'), 'CASEY, LEE');
  assert.equal(cell(NEXT, 'run_t810', 'wed_driver'), '', 'an inactive driver is never put on');

  // DISPATCH WEEK HISTORY: the old Previous week (9/27), one row per run and day.
  const hist = tabs[HIST];
  assert.deepEqual(hist[0], LR.HISTORY_HEADERS.slice());
  assert.equal(hist.length - 1, 6 * 7);
  const h = (row, c) => row[LR.HISTORY_HEADERS.indexOf(c)];
  const mon801 = hist.find(r => h(r, 'run_id') === 'run_t801' && h(r, 'day_prefix') === 'mon');
  assert.deepEqual([h(mon801, 'week_start'), h(mon801, 'scheduled'), h(mon801, 'driver'), h(mon801, 'delivery_date')], ['2026-09-27', 'TRUE', 'ADAMS, PAT', '2026-09-28']);

  // The minute copy reads the moved sheet: the built runs give way to the sheet's rows, and each week names its new tab.
  await runTransfer({ db: db(), reader: sheets, sources: F.SOURCES, now: () => new Date('2026-10-09T12:02:00Z') });
  assert.deepEqual((await config()).liveWeeks, { previous: '2026-10-04', current: '2026-10-11', next: '2026-10-18' });
  const next = await week('2026-10-18');
  assert.equal(next.length, 4);
  assert.ok(next.every(r => r.sourceTab === 'LIVE NEXT WEEK'), 'the sheet rows replaced the built ones');
  assert.equal(next.find(r => r.runId === 'run_t801').days.mon.driver, 'ADAMS, PAT');
  assert.ok((await week('2026-10-11')).every(r => r.sourceTab === 'LIVE CURRENT WEEK'), 'the old Next week now names the Current tab');
  assert.ok((await week('2026-10-04')).every(r => r.sourceTab === 'LIVE PREVIOUS WEEK'));
  // The copy found the archived week too (read only), and nothing in the sheet was flagged.
  assert.equal((await db().collection('conflicts').get()).size, 0);
});

test('a save queued for the old tab after Publish goes to the tab that holds its week now', async () => {
  await applyAction(db(), DISPATCHER, { action: 'publishWeek', requestId: rid(), weekStart: '2026-10-11' }, AT, deps());
  // Before the copy catches up, run_t802's 10/11 run still names LIVE NEXT WEEK.
  assert.equal((await db().collection('runs').doc('2026-10-11__run_t802').get()).data().sourceTab, 'LIVE NEXT WEEK');
  await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: '2026-10-11__run_t802', day: 'mon', driverId: 'drv_test_brook' }, AT);
  const out = await runWriteBack({ db: db(), sheets, target: { spreadsheetId: 'fake-live' }, now: () => new Date('2026-10-09T12:01:00Z') });
  assert.equal(out.conflicts, 0);
  assert.equal(cell(CUR, 'run_t802', 'mon_driver'), 'BROOK, SAM');
});

test('saves waiting for the sheet are written before the weeks move', async () => {
  await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: '2026-10-11__run_t802', day: 'mon', driverId: 'drv_test_brook' }, AT);
  assert.equal(cell(NEXT, 'run_t802', 'mon_driver'), 'CASEY, LEE');
  await applyAction(db(), DISPATCHER, { action: 'publishWeek', requestId: rid(), weekStart: '2026-10-11' }, AT, deps());
  assert.equal(flushed, 1);
  assert.equal(cell(CUR, 'run_t802', 'mon_driver'), 'BROOK, SAM', 'the save reached the week before it moved to the Current tab');
});

test('when the old app already published the week, the sheet is not written and Operations catches up', async () => {
  const moved = F.fakeSheets({ [PREV]: F.liveTab('2026-10-04', '2026-10-04', F.weekRoutes('2026-10-04')), [CUR]: F.liveTab('2026-10-11', '2026-10-11', F.weekRoutes('2026-10-11')),
    [NEXT]: F.liveTab('2026-10-18', '2026-10-18', F.weekRoutes('2026-10-18')) });
  Object.keys(tabs).forEach(k => delete tabs[k]);
  Object.assign(tabs, moved);
  const out = await applyAction(db(), DISPATCHER, { action: 'publishWeek', requestId: rid(), weekStart: '2026-10-11' }, AT, deps());
  assert.equal(out.currentWeek, '2026-10-11');
  assert.equal(sheets.writes.filter(w => w.requests).length, 0, 'nothing written to the sheet');
  assert.deepEqual((await config()).liveWeeks, { previous: '2026-10-04', current: '2026-10-11', next: '2026-10-18' });
});

test('a sheet holding other weeks is never moved', async () => {
  tabs[CUR] = F.liveTab('2026-09-20', '2026-09-20', F.weekRoutes('2026-09-20'));
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'publishWeek', requestId: rid(), weekStart: '2026-10-11' }, AT, deps()), /Nothing was moved/);
  assert.equal(sheets.writes.filter(w => w.requests).length, 0);
  assert.deepEqual((await config()).liveWeeks, { previous: '2026-09-27', current: '2026-10-04', next: '2026-10-11' });
  // Someone who may not publish never reaches the sheet.
  await assert.rejects(applyAction(db(), { email: 'viewer.test@uniteddairy.com' }, { action: 'publishWeek', requestId: rid(), weekStart: '2026-10-11' }, AT, deps()), /role|allowed/);
});

test('the cells keep the types the current app writes', () => {
  assert.deepEqual(LR.cellData('mon_delivery_date', '2026-10-19'), { userEnteredValue: { numberValue: 46314 }, userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } });
  assert.equal(LR.cellData('mon_dispatch_time', '4:30 PM').userEnteredValue.numberValue, (16 * 60 + 30) / 1440);
  assert.deepEqual(LR.cellData('mon_runs', 'TRUE'), { userEnteredValue: { boolValue: true } });
  assert.deepEqual(LR.cellData('mon_miles', '140'), { userEnteredValue: { numberValue: 140 } });
  assert.deepEqual(LR.cellData('run', '6301-1'), { userEnteredValue: { stringValue: '6301-1' }, userEnteredFormat: { numberFormat: { type: 'TEXT', pattern: '@' } } });
  assert.deepEqual(LR.cellData('route', '800'), { userEnteredValue: { stringValue: '800' }, userEnteredFormat: { numberFormat: { type: 'TEXT', pattern: '@' } } });
  assert.deepEqual(LR.cellData('mon_truck', ''), {});
});

// Audit batch 2: Publish moves the Live sheet's weeks, so it waits while writing to the sheets is paused.
test('Publish waits while writing to the sheets is paused, and moves nothing', async () => {
  await db().collection('config').doc('app').set({ sheetWrites: { paused: true } }, { merge: true });
  const before = copyOf(tabs);
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'publishWeek', requestId: rid(), weekStart: '2026-10-11' }, AT, deps()), /Writing to the sheets is paused/);
  assert.deepEqual(tabs, before, 'the Live sheet is not touched');
  assert.equal(flushed, 0);
  assert.deepEqual((await config()).liveWeeks, { previous: '2026-09-27', current: '2026-10-04', next: '2026-10-11' });
});
