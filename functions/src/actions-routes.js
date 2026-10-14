/*
 * United Dairy Distribution app: Route Editor saves (split out of actions.js, review item 81 (Joe 10/13)): one run's Route Master standards, the
 * Current and Next weeks following it, and the weekday load order.
 */
'use strict';

const L = require('./logic');
const M = require('./model');
const { queueMaster } = require('./masterwrite');
const { SaveError, text, requireTestMode } = require('./actions-common');
const { liveRead, routeToLive } = require('./actions-live');

const C = M.COLLECTIONS;
// The Route Editor's switch (actions.js ACTIONS.saveRoute.screen), for the Live weeks' own step after the save.
const ROUTES_SCREEN = 'routes';

/* ---------- Route Editor (Route Master copy; ROUTES_MASTER itself is not written yet) ---------- */
const ROUTE_FIELDS = { route: 'text', routeName: 'text', run: 'text', streamId: 'text', routeRunType: 'text', routeCode: 'text', loadType: 'text', movementType: 'text', coverageOwner: 'text', coverageType: 'text',
  departureDay: 'text', routeNotes: 'text', weekOrder: 'number', active: 'bool', sleeper: 'bool', dropAndHook: 'bool', displayDaily: 'bool',
  displayWeekly: 'bool', displayPlant: 'bool', displayMobile: 'bool', displayRouteMaster: 'bool', routeStatus: 'text' };
const ROUTE_DAY_FIELDS = { active: 'bool', dispatchTime: 'time', loadOrder: 'number', miles: 'number', hours: 'hours', loadDayOffset: 'offset',
  forklift: 'unit', tractor: 'unit', trailer: 'trailer', notes: 'text' };
function routeValue(kind, v, label) {
  if (kind === 'bool') return v === true;
  const t = text(v, 300);
  if (kind === 'text') return t;
  if (kind === 'unit') return t.toUpperCase();
  if (kind === 'trailer') return !t ? '' : /^T-/i.test(t) ? t.toUpperCase() : 'T-' + t.toUpperCase(); // "T- is added", as on the current screen
  if (t === '') return null;
  if (kind === 'time') { const m = L.minutesOfDay(/^\d{1,2}\s*[AaPp][Mm]$/.test(t) ? t.replace(/\s*([AaPp][Mm])$/, ':00 $1') : t); if (m === null) throw new SaveError('BAD_REQUEST', label + ' must look like 5 AM or 5:30 PM'); return m; }
  if (kind === 'hours') { if (!/^\d{1,2}(:\d{2})?$|^\d+(\.\d+)?$/.test(t)) throw new SaveError('BAD_REQUEST', label + ' must be hours:minutes or a decimal'); return t; }
  const n = Number(t);
  if (!Number.isFinite(n)) throw new SaveError('BAD_REQUEST', label + ' must be a number');
  if (kind === 'offset' && (n > 0 || n < -6 || !Number.isInteger(n))) throw new SaveError('BAD_REQUEST', label + ' must be 0 (same day) to -6');
  return n;
}

// One run's Route Master standards (or a new route / run, created in the new app). One call, one log entry.
// The production server (the same test as Administration's master-sheet check): it reads and writes the real Uniontown sheets.
const isProduction = () => process.env.READ_UNIONTOWN_SHEETS === '1' && !process.env.SOURCES_JSON && process.env.DEMO_DATA !== '1';

async function saveRoute(tx, db, req, email, stamp, logRef, mode) {
  // Over the Road's miles box writes Route Master's <day>_miles; on the live app that waits for Joe's OK
  // (config/app.otrMilesToRouteMaster.enabled). The Route Editor's own Mileage view is not held.
  if (req.from === 'otr' && Object.keys(req.days).length && isProduction()) {
    const cfg = (await tx.get(db.collection(C.config).doc('app'))).data() || {};
    if (!(cfg.otrMilesToRouteMaster && cfg.otrMilesToRouteMaster.enabled === true)) {
      throw new SaveError('NOT_ALLOWED', 'Fixing miles from Over the Road is not switched on yet; change them in Route Editor > Mileage');
    }
  }
  const id = req.runId || 'run_app_' + M.safeIdPart(String(req.fields.route) + '_' + String(req.fields.run)).toLowerCase().slice(0, 60) + '_' + req.requestId.slice(-6).toLowerCase();
  const ref = db.collection(C.routes).doc(M.safeIdPart(id));
  const snap = await tx.get(ref);
  if (req.runId && !snap.exists) throw new SaveError('NOT_FOUND', 'That run is no longer in the Route Master copy');
  const before = snap.exists ? snap.data() : null;
  // Show Weekly flipped in the Route Editor: the copied Live runs of this run carry Route Master's answer (weeklyShowMaster,
  // transfer.js), so Weekly follows at once instead of after the next copy. Reads come before any write in a transaction.
  const weeklyRuns = snap.exists && typeof req.fields.displayWeekly === 'boolean'
    ? (await tx.get(db.collection(C.runs).where('runId', '==', before.id || id))).docs : [];
  const update = Object.assign({}, req.fields, { testEdited: true, editedAt: stamp, editedBy: email });
  Object.keys(req.days).forEach(p => Object.keys(req.days[p]).forEach(k => { update['days.' + p + '.' + k] = req.days[p][k]; }));
  if (snap.exists) {
    tx.update(ref, update);
    weeklyRuns.forEach(d => tx.update(d.ref, { weeklyShowMaster: req.fields.displayWeekly }));
    queueMaster(tx, db, mode, req.requestId, '', ref, before.id || id, Object.assign({}, req.fields, { days: req.days }), false, stamp, email);
  } else {
    const days = {};
    L.DAYS.forEach(p => { days[p] = Object.assign({ active: false, dispatchTime: null, loadOrder: null, miles: null, hours: '', loadDayOffset: null, forklift: '', tractor: '', trailer: '', notes: '' }, req.days[p] || {}); });
    const made = Object.assign({ id, routeId: 'rte_app_' + M.safeIdPart(String(req.fields.route)).toLowerCase(), routeStatus: 'ACTIVE', active: true, displayDaily: true, displayWeekly: true,
      displayPlant: true, displayMobile: true, displayRouteMaster: true, createdInApp: true, createdAt: stamp, createdBy: email }, req.fields, { days, testEdited: true, editedAt: stamp, editedBy: email });
    tx.set(ref, made);
    const { createdInApp, createdAt, createdBy, testEdited, editedAt, editedBy, id: madeId, ...sheetFields } = made;
    queueMaster(tx, db, mode, req.requestId, '', ref, id, sheetFields, true, stamp, email);
  }
  // D6: the Current and Next Live weeks follow in their own step once this save is in (routeLiveFollow).
  const result = { ok: true, requestId: req.requestId, runs: [], runId: id, liveWeeks: { updated: 0, added: 0, warnings: [] } };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, runId: id, before: before ? { fields: Object.keys(req.fields).reduce((o, k) => Object.assign(o, { [k]: before[k] === undefined ? null : before[k] }), {}) } : null, after: { fields: req.fields, days: req.days }, result });
  return result;
}

// D6, after a Route Master save is in: the run's Live rows of the Current and Next weeks follow, in their own transaction, so
// several quick Route Editor saves (block fill, paste) never wait on each other's Live rows. It reads the run as saved last.
async function routeLiveFollow(db, req, email, stamp, result) {
  try {
    const live = await db.runTransaction(async (tx) => {
      const mode = await requireTestMode(tx, db, ROUTES_SCREEN);
      const snap = await tx.get(db.collection(C.routes).doc(M.safeIdPart(result.runId)));
      if (!snap.exists) return null;
      const m = Object.assign({ id: result.runId }, snap.data());
      const weeks = await liveRead(tx, db, m.id);
      const out = { runs: [], liveWeeks: { updated: 0, added: 0, warnings: [] } };
      routeToLive(tx, db, mode, req, stamp, email, m, weeks, out);
      return out;
    });
    if (live) { result.runs = result.runs.concat(live.runs); result.liveWeeks = live.liveWeeks; }
  } catch (e) {
    result.liveWeeks.warnings.push('Route Master is saved, but the Current and Next weeks did not update (' + (e.message || e) + '). Save the run again to retry.');
  }
}

// Load Order (drag) for one weekday: the runs in their new order get 10, 20, 30 ...
async function reorderRouteDay(tx, db, req, email, stamp, logRef, mode) {
  const refs = req.runIds.map(id => db.collection(C.routes).doc(M.safeIdPart(id)));
  const snaps = await Promise.all(refs.map(r => tx.get(r)));
  snaps.forEach((s, i) => { if (!s.exists) throw new SaveError('NOT_FOUND', req.runIds[i] + ' is no longer in the Route Master copy'); });
  const before = snaps.map(s => ({ runId: s.id, loadOrder: ((s.data().days || {})[req.day] || {}).loadOrder === undefined ? null : s.data().days[req.day].loadOrder }));
  refs.forEach((r, i) => {
    tx.update(r, { ['days.' + req.day + '.loadOrder']: (i + 1) * 10, testEdited: true, editedAt: stamp, editedBy: email });
    queueMaster(tx, db, mode, req.requestId, String(i), r, snaps[i].data().id || req.runIds[i], { ['days.' + req.day + '.loadOrder']: (i + 1) * 10 }, false, stamp, email);
  });
  const result = { ok: true, requestId: req.requestId, runs: [] };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, day: req.day, before, after: req.runIds.map((id, i) => ({ runId: id, loadOrder: (i + 1) * 10 })), result });
  return result;
}

module.exports = { ROUTE_FIELDS, ROUTE_DAY_FIELDS, routeValue, saveRoute, routeLiveFollow, reorderRouteDay, ROUTES_SCREEN };
