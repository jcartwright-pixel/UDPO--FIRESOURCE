'use strict';
// Joe 11-12-26 ("I need to have this screen not change any other until it's time, but like I want to predetermine what the
// holiday week's going to run like. So I need to be able to switch it forward"): Route Week Override plans a week after the
// Live Next week (weekPlans/<week>); nothing else changes until Publish builds that week, with the plan's days.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const { runWriteBack } = require('../../src/writeback');
const L = require('../../src/logic');
const F = require('../fixtures/fake-sheets');

const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
const AT = () => new Date('2026-10-09T12:00:00Z');
let n = 0;
const rid = () => 'week-plan-' + (++n) + '-' + Date.now();
const save = (input, user, deps) => applyAction(db(), user || DISPATCHER, Object.assign({ requestId: rid() }, input), AT, deps);
const plan = async (w) => { const s = await db().collection('weekPlans').doc(w).get(); return s.exists ? s.data() : null; };
const week = async (w) => (await db().collection('runs').where('weekStart', '==', w).get()).docs.map(d => Object.assign({ id: d.id }, d.data()));
const PLANNED = '2026-10-18'; // the week after the Live Next week (10-11-26)

let tabs, sheets;
test.beforeEach(async () => {
  await clear();
  tabs = F.fakeSheets();
  sheets = F.fakeWritableSheets(tabs);
  await runTransfer({ db: db(), reader: sheets, sources: F.SOURCES, now: AT });
  for (const id of ['run_t801', 'run_t802', 'run_t810']) await db().collection('routes').doc(id).update({ displayDaily: true, displayWeekly: true });
});

test('a week after Next is planned on its own: only the plan changes, and a day put back to normal leaves the plan', async () => {
  const before = { runs: await week('2026-10-11'), route: (await db().collection('routes').doc('run_t801').get()).data() };
  await save({ action: 'setWeekPlan', weekStart: PLANNED, runId: 'run_t801', day: 'mon', runs: false });
  await save({ action: 'setWeekPlan', weekStart: PLANNED, runId: 'run_t801', day: 'wed', runs: true });
  await save({ action: 'setWeekPlan', weekStart: PLANNED, reason: 'Thanksgiving' });
  let p = await plan(PLANNED);
  assert.deepEqual(p.days, { run_t801: { mon: false, wed: true } });
  assert.equal(p.overrideReason, 'Thanksgiving');
  assert.equal(p.updatedBy, DISPATCHER.email);
  // Nothing else moved: no runs for the planned week, the Next week and Route Master as they were.
  assert.equal((await week(PLANNED)).length, 0);
  assert.deepEqual(await week('2026-10-11'), before.runs);
  assert.deepEqual((await db().collection('routes').doc('run_t801').get()).data(), before.route);
  // Wednesday back off is Route Master's normal day, so it leaves the plan.
  await save({ action: 'setWeekPlan', weekStart: PLANNED, runId: 'run_t801', day: 'wed', runs: false });
  assert.deepEqual((await plan(PLANNED)).days, { run_t801: { mon: false } });
  // Clear empties the plan.
  await save({ action: 'setWeekPlan', weekStart: PLANNED, clear: true });
  p = await plan(PLANNED);
  assert.deepEqual([p.days, p.overrideReason], [{}, '']);
});

test('only a week after Next can be planned, by someone who may change Route Week Override', async () => {
  await assert.rejects(save({ action: 'setWeekPlan', weekStart: '2026-10-11', runId: 'run_t801', day: 'mon', runs: false }), /already built/);
  await assert.rejects(save({ action: 'setWeekPlan', weekStart: '2027-12-26', runId: 'run_t801', day: 'mon', runs: false }), /year ahead/);
  await assert.rejects(save({ action: 'setWeekPlan', weekStart: '2026-10-19', runId: 'run_t801', day: 'mon', runs: false }), /Sunday/);
  await assert.rejects(save({ action: 'setWeekPlan', weekStart: PLANNED, runId: 'run_nobody', day: 'mon', runs: false }), /Route Master/);
  await assert.rejects(save({ action: 'setWeekPlan', weekStart: PLANNED, runId: 'run_t801', day: 'mon', runs: false }, { email: 'viewer.test@uniteddairy.com' }), /role|allowed/);
  assert.equal(await plan(PLANNED), null);
});

test('Publish builds the planned week with the plan: days as planned and changed by hand, and the reason', async () => {
  await save({ action: 'setWeekPlan', weekStart: PLANNED, runId: 'run_t801', day: 'mon', runs: false });
  await save({ action: 'setWeekPlan', weekStart: PLANNED, runId: 'run_t801', day: 'wed', runs: true });
  await save({ action: 'setWeekPlan', weekStart: PLANNED, reason: 'Holiday week' });
  const out = await save({ action: 'publishWeek', weekStart: '2026-10-11' });
  assert.equal(out.nextWeek, PLANNED);
  const r801 = (await week(PLANNED)).find(r => r.runId === 'run_t801');
  assert.deepEqual(L.DAYS.filter(p => r801.days[p].runs), ['tue', 'wed']);
  assert.deepEqual([r801.days.mon.routeOverride, r801.days.wed.routeOverride, r801.days.tue.routeOverride], ['TRUE', 'TRUE', '']);
  assert.equal(r801.days.mon.driver, '', 'a day planned off has no driver');
  assert.equal(r801.days.wed.dispatchTime, 240, 'a day planned on borrows the run\'s normal start time');
  assert.deepEqual(r801.plannedDays, ['mon', 'wed']);
  const r802 = (await week(PLANNED)).find(r => r.runId === 'run_t802');
  assert.deepEqual(L.DAYS.filter(p => r802.days[p].runs), ['mon', 'tue'], 'a run not in the plan is built as Route Master has it');
  assert.equal((await db().collection('weeks').doc(PLANNED).get()).data().overrideReason, 'Holiday week');
  assert.equal((await plan(PLANNED)).usedBy, DISPATCHER.email);
  // Once built, the week is changed on the week itself.
  await assert.rejects(save({ action: 'setWeekPlan', weekStart: PLANNED, runId: 'run_t801', day: 'mon', runs: true }), /already built/);
});

test('with the write-back on, the new Next week\'s sheet rows carry the planned days, marked changed by hand', async () => {
  await db().collection('config').doc('app').set({ writeBack: { enabled: true } }, { merge: true });
  await save({ action: 'setWeekPlan', weekStart: PLANNED, runId: 'run_t801', day: 'mon', runs: false });
  await save({ action: 'setWeekPlan', weekStart: PLANNED, runId: 'run_t801', day: 'wed', runs: true });
  const deps = { liveRoll: () => ({ sheets, spreadsheetId: 'fake-live', allowRealLive: false, flush: async () => runWriteBack({ db: db(), sheets, target: { spreadsheetId: 'fake-live' }, now: AT }) }) };
  const out = await save({ action: 'publishWeek', weekStart: '2026-10-11' }, DISPATCHER, deps);
  assert.equal(out.nextWeek, PLANNED);
  const v = tabs["'LIVE NEXT WEEK'"], h = v[5], row = v.slice(6).find(r => r[h.indexOf('run_id')] === 'run_t801');
  const col = (c) => row[h.indexOf(c)];
  assert.deepEqual([col('mon_runs'), col('tue_runs'), col('wed_runs')], ['FALSE', 'TRUE', 'TRUE']);
  if (h.indexOf('mon_route_override') >= 0) assert.deepEqual([col('mon_route_override'), col('wed_route_override')], ['TRUE', 'TRUE']);
});
