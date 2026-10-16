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
    const id = M.safeIdPart(String(d.data().runId || ''));
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
    if (!plan) return;
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

module.exports = { reorderWeek, publishWeek, setWeekReason, resetWeek };
