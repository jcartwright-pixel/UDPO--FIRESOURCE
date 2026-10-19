/*
 * United Dairy Distribution app: the Live weeks move on (Weekly Dispatch's Publish, Joe's review items 6 and 49).
 *
 * Publish, as in the current app (desktopUiAdvanceWeeklyLifecycleCurrent, udpoV743MaintainDriverWeekLifecycle_): publishing
 * the Next week makes the Current week the Previous week and the Next week the Current week, and builds a new Next week from
 * Route Master and Driver Master (logic.js buildWeekRun). The Current week's blank drivers, trucks and trailers are filled the
 * same way; nothing anyone picked is changed. Weeks before Previous stay in the app and open read only. If nobody presses
 * Publish, the minute copy does it once the calendar reaches the Next week (the current app's forgotten-Publish safety net).
 *
 * With the write-back off the weeks move in the new app's storage only (sandbox): the Live sheet and its copies are not written.
 * The three weeks the app shows are config/app liveWeeks; the copy keeps reading the sheet's three tabs, and once the sheet's own
 * weeks catch up (or pass) the app's, the sheet's weeks win again (transfer.js). With the write-back on (Joe 10/16) the Live
 * sheet's three tabs are moved first, the way the current app's Publish moves them (liveroll.js), and then the weeks here.
 *
 * Route Editor and Driver Roster saves reaching the Current and Next weeks are actions.js routeToLive / driverToLive (D6).
 */
'use strict';

const L = require('./logic');
const M = require('./model');
const C = M.COLLECTIONS;

const BUILT_TAB = 'BUILT BY PUBLISH';
// One Firestore transaction holds at most 500 writes.
const TX_WRITES = 490;

// Every Live day column the builder does not decide, blank (as a copied Live row with those cells empty).
function blankDay() {
  const d = {};
  M.DAY_FIELDS.forEach(([field, , kind]) => { d[field] = M.convert(kind, ''); });
  return d;
}

// A whole run document for a week, shaped like one the copy makes from a Live tab.
function runDoc(route, week, ctx, stamp, email, fromDate) {
  const run = L.buildWeekRun(route, week, ctx);
  L.DAYS.forEach((p, i) => {
    // A run added in the middle of a week starts with the days still to load.
    if (fromDate && run.days[p].loadDate < fromDate) Object.assign(run.days[p], { runs: false, driverId: '', driver: '', intendedDriverId: '', intendedDriver: '', driverExceptionStatus: '', truckId: '', truck: '', trailerId: '', trailer: '' });
    run.days[p] = Object.assign(blankDay(), run.days[p]);
  });
  return Object.assign(run, { sourceTab: BUILT_TAB, sheetRow: null, cells: {}, builtInApp: true, builtAt: stamp, builtBy: email, transferredAt: stamp, rev: Date.parse(stamp) });
}

// Route Master, Driver Master, days off from `fromDate` on, Equipment Master and the Scheduler's Plant Route loads from `fromDate`
// on, read inside the transaction.
async function readMasters(tx, db, fromDate) {
  const [r, d, x, e, pl] = await Promise.all([tx.get(db.collection(C.routes)), tx.get(db.collection(C.drivers)),
    tx.get(db.collection(C.exceptions).where('endDate', '>=', fromDate)), tx.get(db.collection(C.equipment)), tx.get(db.collection(C.plantLoads).where('date', '>=', fromDate))]);
  const routes = {};
  r.docs.forEach(s => { const v = s.data(); routes[v.id || s.id] = Object.assign({}, v, { id: v.id || s.id }); });
  return { routes, drivers: d.docs.map(s => s.data()), exceptions: x.docs.map(s => s.data()), equipment: e.docs.map(s => s.data()), plantLoads: pl.docs.map(s => s.data()) };
}
// The Plant Scheduler's loads go in too: a branch box load already scheduled for a day is built running that day (Joe 10/19).
const contextOf = (m) => L.weekBuildContext(m.drivers, m.exceptions, m.equipment, Object.values(m.routes), m.plantLoads);

// Routes in Weekly order, so the first run on the board gets a shared default unit first.
function routeOrder(routes) {
  return Object.values(routes).filter(r => r.id && (r.route || r.routeId)).sort((a, b) => {
    const x = a.weekOrder === null || a.weekOrder === undefined ? 999999 : a.weekOrder, y = b.weekOrder === null || b.weekOrder === undefined ? 999999 : b.weekOrder;
    return x - y || String(a.route || '').localeCompare(String(b.route || ''), undefined, { numeric: true }) || String(a.id).localeCompare(String(b.id));
  });
}

// The units already on a week's runs are booked first, so a filled blank never doubles them up.
function bookExisting(ctx, run) {
  L.DAYS.forEach(p => {
    const d = run.days && run.days[p];
    if (!d || !d.runs) return;
    if (d.truckId || d.truck) L.bookUnit(ctx, p, 'TRUCK', d.truckId || d.truck, d.dispatchTime, d.routeHours);
    if (d.trailerId || d.trailer) L.bookUnit(ctx, p, 'TRAILER', d.trailerId || d.trailer, d.dispatchTime, d.routeHours);
  });
}

// A day nobody may change from the masters any more: loaded (or loading) before today, changed by hand, or finished.
function dayLocked(run, p, today) {
  const d = (run.days && run.days[p]) || {}, date = L.addDays(run.weekStart, L.DAYS.indexOf(p));
  const offset = d.loadDayOffset === null || d.loadDayOffset === undefined ? -1 : d.loadDayOffset;
  const load = d.loadDate || L.addDays(date, offset);
  return load < today || L.yes(d.routeOverride) || !!d.completeTime || d.loadedComplete === true;
}

// Fill-only (the Current week at Publish): a running day's blank driver, truck and trailer get the standard ones.
function fillBlanks(run, route, ctx, today) {
  const out = {};
  if (!route) return out;
  L.DAYS.forEach((p, i) => {
    const d = (run.days && run.days[p]) || {};
    if (!d.runs || dayLocked(run, p, today)) return;
    const want = {}, rd = (route.days && route.days[p]) || {}, date = L.addDays(run.weekStart, i);
    let driverId = d.driverId;
    if (!d.driverId && !d.driver && !d.intendedDriver) {
      const s = ctx.slots[run.runId + '|' + p];
      if (s && !L.exceptionOn(ctx.exceptions, s.id, date)) { Object.assign(want, { driverId: s.id, driver: s.name }); driverId = s.id; }
    }
    if (!d.truck && !d.truckId) {
      const own = driverId && ctx.driversById[driverId] ? ctx.findUnit(ctx.driversById[driverId].defaultTruckId, 'TRUCK') : null, t = own || ctx.findUnit(rd.tractor, 'TRUCK');
      if (t && L.bookUnit(ctx, p, 'TRUCK', t.id, d.dispatchTime, d.routeHours)) Object.assign(want, { truckId: t.id, truck: t.unit });
    }
    if (!d.trailer && !d.trailerId) {
      const t = ctx.findUnit(rd.trailer, 'TRAILER');
      if (t && L.bookUnit(ctx, p, 'TRAILER', t.id, d.dispatchTime, d.routeHours)) Object.assign(want, { trailerId: t.id, trailer: t.unit });
    }
    if (Object.keys(want).length) out[p] = want;
  });
  return out;
}

// Writes one run's day changes (with the sheet cells when the write-back is on), as the other saves do.
function applyDays(tx, db, snap, run, days, stamp, email, mode, queue, requestId, tag) {
  const update = {};
  let part = 0;
  Object.keys(days).forEach(p => {
    Object.keys(days[p]).forEach(k => { update['days.' + p + '.' + k] = days[p][k]; });
    update['days.' + p + '.updatedAt'] = stamp;
    update['days.' + p + '.updatedBy'] = email;
    if (mode.writeBack && queue && run.sourceTab !== BUILT_TAB) queue(tx, db, requestId, tag + snap.id.slice(-12).replace(/[^A-Za-z0-9_-]/g, '') + (part++), run, snap.id, p, days[p], stamp, email);
  });
  if (!Object.keys(update).length) return null;
  tx.update(snap.ref, Object.assign(update, { rev: (run.rev || 0) + 1, testEdited: true, editedAt: stamp }));
  return { runDocId: snap.id, rev: (run.rev || 0) + 1 };
}

const shortDate = (k) => { const [, m, d] = String(k).split('-').map(Number); return m + '/' + d; };

/*
 * What Publish changes, read through `tx` (a transaction, or { get: q => q.get() } for liveroll.js's look ahead): the weeks after
 * it, the new Next week's runs built from the masters, and the new Current week's blank drivers, trucks and trailers filled.
 */
async function planRoll(tx, db, live, stamp, email) {
  const weeks = { previous: live.current, current: live.next, next: L.addDays(live.next, 7) };
  const today = L.operatingDay(new Date(stamp));
  const [nextRuns, curRuns, nextWeekSnap] = await Promise.all([tx.get(db.collection(C.runs).where('weekStart', '==', weeks.next)),
    tx.get(db.collection(C.runs).where('weekStart', '==', weeks.current)), tx.get(db.collection(C.weeks).doc(weeks.next))]);
  const m = await readMasters(tx, db, weeks.current);

  // The new Next week: every Route Master run not already there (a week the sheet already holds keeps its rows).
  const have = new Set(nextRuns.docs.map(s => s.data().runId)), nextCtx = contextOf(m), built = {};
  nextRuns.docs.forEach(s => bookExisting(nextCtx, s.data()));
  routeOrder(m.routes).forEach(route => { if (!have.has(route.id)) built[M.runDocId(weeks.next, route.id)] = runDoc(route, weeks.next, nextCtx, stamp, email); });

  // The new Current week: blank drivers, trucks and trailers filled (the current app's fill-only pass).
  const curCtx = contextOf(m), fills = [];
  curRuns.docs.forEach(s => bookExisting(curCtx, s.data()));
  curRuns.docs.forEach(s => { const run = s.data(), days = fillBlanks(run, m.routes[run.runId], curCtx, today); if (Object.keys(days).length) fills.push([s, run, days]); });
  return { weeks, built, fills, have, nextWeekSnap, routes: m.routes, nextRuns };
}

/*
 * Publish of the Live Next week (actions.publishWeek sends it here). `live` is config/app liveWeeks.
 * Returns {previousWeek, currentWeek, nextWeek, built, filled, message}.
 */
async function publishRoll(tx, db, req, email, stamp, logRef, mode, live, SaveError) {
  // Joe 10/16 ("Let Operations' Publish move the weeks in the real Live sheet, the same way the old app's Publish does"): with
  // the write-back on, actions.js first moves the Live sheet's weeks (liveroll.js) and marks the request sheetRolled.
  if (mode.writeBack && !req.sheetRolled) throw new SaveError('NOT_ALLOWED', 'The Live sheet could not be reached from here, so the weeks were not moved. Press Publish again in a minute; if it still says this, ask the administrator.');
  if (!live.current || !live.next || L.addDays(live.current, 7) !== live.next) throw new SaveError('CHANGED', 'The Live weeks are not in order (Current ' + (live.current || '?') + ', Next ' + (live.next || '?') + '). Refresh Weekly Dispatch before publishing.');
  const { weeks, built, fills, have, nextWeekSnap } = await planRoll(tx, db, live, stamp, email);
  if (Object.keys(built).length + fills.length + 4 > TX_WRITES) throw new SaveError('NOT_ALLOWED', 'Publish would change more than ' + TX_WRITES + ' runs at once; ask the administrator.');

  Object.keys(built).forEach(id => tx.set(db.collection(C.runs).doc(id), built[id]));
  const runs = [];
  fills.forEach(([s, run, days]) => { const r = applyDays(tx, db, s, run, days, stamp, email, mode, null); if (r) runs.push(r); });
  const nextWeek = nextWeekSnap.exists ? nextWeekSnap.data() : null, hashes = {};
  Object.keys(built).forEach(id => { hashes[id] = 'built'; });
  // "built" is never a sheet row's fingerprint, so when the sheet holds this week the copy replaces these runs with its own rows.
  // A week the sheet copy already holds keeps its own record (the added runs stay beside its rows).
  const sheetWeek = !!nextWeek && nextWeek.sourceTab && nextWeek.sourceTab !== BUILT_TAB;
  tx.set(db.collection(C.weeks).doc(weeks.next), sheetWeek ? { builtAt: stamp, builtBy: email } : Object.assign({ weekStart: weeks.next, sourceTab: BUILT_TAB, rowHashes: hashes, rows: have.size + Object.keys(built).length, builtAt: stamp, builtBy: email },
    nextWeek ? {} : { publishedAt: '', publishedBy: '' }), { merge: true });
  tx.set(db.collection(C.weeks).doc(weeks.current), { weekStart: weeks.current, publishedAt: stamp, publishedBy: email }, { merge: true });
  tx.set(db.collection(C.config).doc('app'), { liveWeeks: weeks, weekRoll: Object.assign({}, weeks, { at: stamp, by: email, before: live }) }, { merge: true });
  const filled = fills.reduce((n, f) => n + Object.keys(f[2]).length, 0);
  const message = 'Week pushed live. Current is now ' + shortDate(weeks.current) + ' and the new Next week (' + shortDate(weeks.next) + ') was built from Route Master and Driver Master' +
    (Object.keys(built).length ? ' (' + Object.keys(built).length + ' runs)' : '') + '.' + (filled ? ' ' + filled + ' blank day' + (filled === 1 ? '' : 's') + ' in ' + shortDate(weeks.current) + ' got the standard driver or units.' : '') +
    (req.sheetRolled ? ' The Live sheet\'s weeks moved too.' : '');
  const result = { ok: true, requestId: req.requestId, runs, previousWeek: weeks.previous, currentWeek: weeks.current, nextWeek: weeks.next, built: Object.keys(built).length, filled, message };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, weekStart: req.weekStart, before: { liveWeeks: live }, after: { liveWeeks: weeks }, built: Object.keys(built), filled: fills.map(f => ({ runDocId: f[0].id, days: f[2] })), result });
  return result;
}

/*
 * The copy's forgotten-Publish safety net: once the operating day reaches the Live Next week, publish it (one week per run).
 * Only in test mode with the write-back off (the sandbox); returns the result or null.
 */
async function autoPublish(db, now) {
  const SWITCH = require('./switch');
  const stamp = (now ? now() : new Date()).toISOString(), today = L.operatingDay(new Date(stamp));
  const cfg = (await db.collection(C.config).doc('app').get()).data() || {}, live = cfg.liveWeeks || {};
  if (!live.next || today < live.next) return null;
  const requestId = 'autopublish-' + live.next;
  const email = 'automatic publish';
  class AutoError extends Error { constructor(code, message) { super(message); this.code = code; } }
  try {
    return await db.runTransaction(async tx => {
      const logRef = db.collection(C.actions).doc(requestId);
      if ((await tx.get(logRef)).exists) return null;
      const c = (await tx.get(db.collection(C.config).doc('app'))).data() || {};
      const mode = SWITCH.screenMode(c, 'weeklyDispatch', (code, message) => new AutoError(code, message));
      if (mode.mode !== 'test' || mode.writeBack || !c.liveWeeks || c.liveWeeks.next !== live.next) return null;
      return publishRoll(tx, db, { action: 'publishWeek', requestId, weekStart: live.next }, email, stamp, logRef, mode, c.liveWeeks, AutoError);
    });
  } catch (e) {
    if (e instanceof AutoError) return null;
    throw e;
  }
}

/*
 * Administration > Update Live Sheets adds the Route Master runs missing from the Current and Next weeks
 * (admintools.updateLive does the day-by-day part). Returns the run documents to add, by ID.
 */
function missingRuns(routes, runsByWeek, ctxFor, stamp, email, today) {
  const add = {};
  Object.keys(runsByWeek).forEach(w => {
    const have = new Set(runsByWeek[w].map(r => r.runId)), ctx = ctxFor(w);
    routeOrder(routes).forEach(route => {
      if (have.has(route.id) || !L.masterActive(route) || !L.DAYS.some(p => route.days && route.days[p] && route.days[p].active)) return;
      add[M.runDocId(w, route.id)] = runDoc(route, w, ctx, stamp, email, today);
    });
  });
  return add;
}

module.exports = { BUILT_TAB, shortDate, planRoll, routeOrder, runDoc, readMasters, contextOf, bookExisting, fillBlanks, publishRoll, autoPublish, missingRuns, dayLocked };
