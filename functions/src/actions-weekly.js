/*
 * United Dairy Distribution app: Weekly Dispatch saves (split out of actions.js, review item 81 (Joe 10/13)): the line order, Publish, the week's
 * override reason and Reset Week.
 */
'use strict';

const L = require('./logic');
const M = require('./model');
const { queueMaster } = require('./masterwrite');
const ROLL = require('./weekroll');
const { SaveError, queueSheetCells } = require('./actions-common');

const C = M.COLLECTIONS;

/*
 * Weekly Dispatch order (Joe 10/12, "grab the line and move it"): the routes in their new order get route_week_display
 * 10, 20, 30... in Route Master, and the runs of this week and the weeks after it take the same order at once, so Weekly
 * shows it before the next copy. Runs not in the list keep theirs.
 */
async function reorderWeek(tx, db, req, email, stamp, logRef, mode) {
  const refs = req.runIds.map(id => db.collection(C.routes).doc(M.safeIdPart(id)));
  const [snaps, runSnap] = await Promise.all([Promise.all(refs.map(r => tx.get(r))), tx.get(db.collection(C.runs).where('weekStart', '>=', req.weekStart))]);
  snaps.forEach((s, i) => { if (!s.exists) throw new SaveError('NOT_FOUND', req.runIds[i] + ' is no longer in the Route Master copy'); });
  const before = snaps.map(s => ({ runId: s.id, weekOrder: s.data().weekOrder === undefined ? null : s.data().weekOrder }));
  const order = {};
  refs.forEach((r, i) => {
    order[snaps[i].id] = (i + 1) * 10;
    tx.update(r, { weekOrder: (i + 1) * 10, testEdited: true, editedAt: stamp, editedBy: email });
    queueMaster(tx, db, mode, req.requestId, String(i), r, snaps[i].data().id || req.runIds[i], { weekOrder: (i + 1) * 10 }, false, stamp, email);
  });
  runSnap.docs.forEach(d => {
    // A one-week extra line (Joe 10/23) moves with the run it was added for.
    const id = M.safeIdPart(String(d.data().extraOfRunId || d.data().runId || ''));
    if (order[id] !== undefined && d.data().weekOrder !== order[id]) tx.update(d.ref, { weekOrder: order[id] });
  });
  const result = { ok: true, requestId: req.requestId, runs: [] };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, weekStart: req.weekStart, before, after: req.runIds.map((id, i) => ({ runId: id, weekOrder: (i + 1) * 10 })), result });
  return result;
}

/*
 * Publish to Daily Dispatch. In the new app Weekly and Daily read the same runs, so every Weekly pick is already on
 * Daily. Publishing the Live Next week moves the weeks on (weekroll.js); publishing another week records that it was
 * checked and sent (who and when), which the Weekly header shows.
 */
async function publishWeek(tx, db, req, email, stamp, logRef, mode) {
  // Joe 10/11 (review item 6): publishing the Live Next week moves the weeks on and builds the new Next week, as the current app does.
  const live = ((await tx.get(db.collection(C.config).doc('app'))).data() || {}).liveWeeks || {};
  if (live.next && req.weekStart === live.next) return ROLL.publishRoll(tx, db, req, email, stamp, logRef, mode, live, SaveError);
  // The Live sheet's weeks were just moved (liveroll.js) and the copy from the sheet already brought them here: nothing more to move.
  if (req.sheetRolled && live.current === req.weekStart) {
    const result = { ok: true, requestId: req.requestId, runs: [], previousWeek: live.previous, currentWeek: live.current, nextWeek: live.next, built: 0, filled: 0,
      message: 'Week pushed live. Current is now ' + ROLL.shortDate(live.current) + ' and the Live sheet\'s weeks moved too.' };
    tx.set(db.collection(C.weeks).doc(live.current), { weekStart: live.current, publishedAt: stamp, publishedBy: email }, { merge: true });
    tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, weekStart: req.weekStart, before: { liveWeeks: live }, after: { liveWeeks: live }, result });
    return result;
  }
  const ref = db.collection(C.weeks).doc(req.weekStart);
  const snap = await tx.get(ref);
  if (!snap.exists) throw new SaveError('NOT_FOUND', 'The week of ' + req.weekStart + ' is not one of the copied Live weeks');
  const before = { publishedAt: snap.data().publishedAt || '', publishedBy: snap.data().publishedBy || '' };
  tx.update(ref, { publishedAt: stamp, publishedBy: email });
  const result = { ok: true, requestId: req.requestId, runs: [] };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, weekStart: req.weekStart, before, after: { publishedAt: stamp, publishedBy: email }, result });
  return result;
}

// Route Week Override's reason for the week's changes (the current app keeps it with the week's overrides).
async function setWeekReason(tx, db, req, email, stamp, logRef, mode) {
  const ref = db.collection(C.weeks).doc(req.weekStart);
  const snap = await tx.get(ref);
  if (!snap.exists) throw new SaveError('NOT_FOUND', 'The week of ' + req.weekStart + ' is not one of the copied Live weeks');
  const before = { overrideReason: snap.data().overrideReason || '' }, after = { overrideReason: req.reason, overrideReasonBy: email, overrideReasonAt: stamp };
  tx.update(ref, after);
  const result = { ok: true, requestId: req.requestId, runs: [] };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, weekStart: req.weekStart, before, after, result });
  return result;
}

/*
 * Reset Week (the current Weekly button, udpoV780ResetWeeklyDispatch_): every copied run of the week is rebuilt from
 * Route Master (which days run) and Driver Master (the standard driver for each day), whether or not the week was
 * published. Trucks, trailers and notes stay. A day's route override is cleared. One call, one log entry with every
 * day it changed.
 */
const RESET_FIELDS = ['runs', 'driverId', 'driver', 'intendedDriverId', 'intendedDriver', 'driverExceptionStatus'];
async function resetWeek(tx, db, req, email, stamp, logRef, mode) {
  const runSnaps = (await tx.get(db.collection(C.runs).where('weekStart', '==', req.weekStart))).docs;
  if (!runSnaps.length) throw new SaveError('NOT_FOUND', 'The week of ' + req.weekStart + ' is not one of the copied Live weeks');
  const [routeSnap, driverSnap, exSnap] = await Promise.all([tx.get(db.collection(C.routes)), tx.get(db.collection(C.drivers)),
    tx.get(db.collection(C.exceptions).where('endDate', '>=', req.weekStart))]);
  const routes = {};
  routeSnap.docs.forEach(d => { const r = d.data(); if (r.id) routes[r.id] = r; });
  const slots = L.standardDrivers(driverSnap.docs.map(d => d.data())), exceptions = exSnap.docs.map(d => d.data());
  const result = { ok: true, requestId: req.requestId, runs: [] }, changes = [];
  let part = 0;
  runSnaps.forEach(snap => {
    const run = snap.data(), plan = L.resetWeekPlan(run, routes[run.runId], slots, exceptions);
    // Joe 10/19: a branch's box loads are turned on by hand as they come in, so Reset Week leaves them as they are.
    if (!plan || L.boxLoadRun(routes[run.runId])) return;
    const update = {};
    L.DAYS.forEach(p => {
      const was = (run.days && run.days[p]) || {}, want = plan[p], after = {};
      RESET_FIELDS.forEach(k => { if ((was[k] === undefined ? (k === 'runs' ? false : '') : was[k]) !== want[k] && !(k !== 'runs' && !was[k] && !want[k])) after[k] = want[k]; });
      if (L.yes(was.routeOverride)) after.routeOverride = 'FALSE';
      if (!Object.keys(after).length) return;
      Object.keys(after).forEach(k => { update['days.' + p + '.' + k] = after[k]; });
      update['days.' + p + '.updatedAt'] = stamp;
      update['days.' + p + '.updatedBy'] = email;
      changes.push({ runDocId: snap.id, day: p, before: Object.keys(after).reduce((o, k) => Object.assign(o, { [k]: was[k] === undefined ? null : was[k] }), {}), after });
      if (mode.writeBack) queueSheetCells(tx, db, req.requestId, 'r' + (part++), run, snap.id, p, after, stamp, email);
    });
    if (!Object.keys(update).length) return;
    tx.update(snap.ref, Object.assign(update, { rev: run.rev + 1, testEdited: true, editedAt: stamp }));
    result.runs.push({ runDocId: snap.id, rev: run.rev + 1 });
  });
  result.changedDays = changes.length;
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, weekStart: req.weekStart, changes, result });
  return result;
}

/*
 * Joe 10/23 ("this week I have an extra Ventura, so I actually have two on the same day ... a temporary, one-time thing"): a second
 * line for a run, for this week only, added from the run's name on Weekly Dispatch. It is a run of its own (own run_id), so it gets
 * its own driver on every screen, the double-booking check counts it, and it never picks up the first line's Plant Scheduler
 * loads. It is not in Route Master, so Reset Week, Route Master saves and Publish's new Next week leave it alone and it does not
 * come back the next week. It is kept in Operations only: the Live sheet has no row for it (actions-common.js skips its cells).
 * It starts with every day off (no driver); picking a driver on a day turns that day on. Times and load days come from the run.
 */
const EXTRA_KEEP = ['loadSequence', 'deliveryDate', 'loadDayOffset', 'loadDate', 'departureDate', 'startTime', 'dispatchTime', 'routeHours', 'miles'];
function extraName(base, n) {
  const name = L.runText(base);
  return /\d$/.test(name) ? name + ' EXTRA' + (n > 2 ? ' ' + (n - 1) : '') : name + ' ' + n;
}
async function addExtraRun(tx, db, req, email, stamp, logRef, mode) {
  const baseRef = db.collection(C.runs).doc(req.runDocId), baseSnap = await tx.get(baseRef);
  if (!baseSnap.exists) throw new SaveError('NOT_FOUND', 'That run is no longer in this week');
  const base = baseSnap.data();
  if (base.extraRun) throw new SaveError('BAD_REQUEST', 'Add the extra line from the run\'s own line');
  const weekSnap = await tx.get(db.collection(C.runs).where('weekStart', '==', base.weekStart));
  const taken = new Set(weekSnap.docs.map(d => d.id)), runIds = new Set(weekSnap.docs.map(d => d.data().runId));
  let n = 2 + weekSnap.docs.filter(d => d.data().extraOf === req.runDocId).length, runId, id;
  for (;; n++) { runId = base.runId + '__extra' + n; id = M.runDocId(base.weekStart, runId); if (!taken.has(id) && !runIds.has(runId)) break; }
  // A day the run does not run has no time or load day of its own: the first day it does run lends them.
  const lend = L.DAYS.map(p => (base.days || {})[p] || {}).find(d => d.runs && (d.dispatchTime !== null && d.dispatchTime !== undefined)) || {};
  const days = {};
  L.DAYS.forEach((p, i) => {
    const was = (base.days || {})[p] || {}, day = {};
    M.DAY_FIELDS.forEach(([f, , kind]) => { day[f] = kind === 'yes' ? false : kind === 'text' ? '' : null; });
    EXTRA_KEEP.forEach(f => { if (was[f] !== undefined && was[f] !== null && was[f] !== '') day[f] = was[f]; });
    ['dispatchTime', 'startTime', 'routeHours', 'miles', 'loadDayOffset'].forEach(f => { if ((day[f] === null || day[f] === undefined) && lend[f] !== undefined) day[f] = lend[f]; });
    day.deliveryDate = day.deliveryDate || L.addDays(base.weekStart, i);
    if (!day.loadDate) day.loadDate = L.addDays(day.deliveryDate, day.loadDayOffset === null || day.loadDayOffset === undefined ? -1 : Number(day.loadDayOffset));
    day.runs = false;
    days[p] = day;
  });
  const run = {};
  M.RUN_FIELDS.forEach(([f]) => { run[f] = base[f] === undefined ? null : base[f]; });
  Object.assign(run, {
    weekStart: base.weekStart, sourceTab: base.sourceTab || '', sheetRow: null, runId, run: extraName(base, n), extraRun: true, extraOf: req.runDocId, extraOfRunId: base.runId || '',
    weekOrder: base.weekOrder === undefined ? null : base.weekOrder, weeklyShowMaster: base.weeklyShowMaster === undefined ? null : base.weeklyShowMaster,
    masterShow: base.masterShow || null, days, cells: {}, rev: Date.parse(stamp), testEdited: true, editedAt: stamp, editedBy: email, addedBy: email, addedAt: stamp
  });
  tx.set(db.collection(C.runs).doc(id), run);
  const result = { ok: true, requestId: req.requestId, runs: [{ runDocId: id, rev: run.rev }], runDocId: id, name: run.run };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, weekStart: base.weekStart, runDocId: id, before: null, after: { extraOf: req.runDocId, run: run.run }, result });
  return result;
}
// Takes a one-week extra line off again, unless a day of it was already loaded.
async function removeExtraRun(tx, db, req, email, stamp, logRef, mode) {
  const ref = db.collection(C.runs).doc(req.runDocId), snap = await tx.get(ref);
  if (!snap.exists) throw new SaveError('NOT_FOUND', 'That line is already gone');
  const run = snap.data();
  if (!run.extraRun) throw new SaveError('NOT_ALLOWED', 'Only a line added for this week can be removed here');
  const loaded = L.DAYS.filter(p => { const d = (run.days || {})[p] || {}; return d.runs && (d.completeTime || d.loadedComplete === true || String(d.loadStatus || '').toUpperCase() === 'COMPLETE'); });
  if (loaded.length) throw new SaveError('NOT_ALLOWED', L.runText(run) + ' was already loaded on ' + loaded.map(p => L.DAY_NAMES[L.DAYS.indexOf(p)]).join(', ') + ', so it stays');
  tx.delete(ref);
  const result = { ok: true, requestId: req.requestId, runs: [] };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, weekStart: run.weekStart, runDocId: req.runDocId, before: { run: run.run, extraOf: run.extraOf || '', days: run.days }, after: null, result });
  return result;
}

module.exports = { reorderWeek, publishWeek, setWeekReason, resetWeek, addExtraRun, removeExtraRun };
