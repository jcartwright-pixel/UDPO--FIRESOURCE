/*
 * United Dairy Distribution app: saves.
 *
 * Every save is one call and one database transaction: it checks who is saving, checks nobody changed the
 * same run since the screen last showed it, writes the change, and records it in `actions` with before and
 * after. Sending the same request twice (a retry after a dropped connection) saves once.
 *
 * Saves never write Google Sheets directly: with the write-back on, each one queues its sheet cells (writeback.js,
 * masterwrite.js). Which screens may save is the per-screen switch (switch.js).
 */
'use strict';

const L = require('./logic');
const M = require('./model');
const { queueMaster } = require('./masterwrite');
const MAINT = require('./maintenance');
const SWITCH = require('./switch');
const OTR = require('./otr-core');

const C = M.COLLECTIONS;

const SAVE_ROLES = L.SAVE_ROLES;
const REORDER_ROLES = L.REORDER_ROLES;
const DRIVER_ROLES = L.DRIVER_ROLES;

class SaveError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details || null; }
}

const ACTIONS = Object.freeze({
  assignDriver: { roles: SAVE_ROLES, screen: 'dailyDispatch' },
  assignTruck: { roles: SAVE_ROLES, screen: 'dailyDispatch' },
  assignTrailer: { roles: SAVE_ROLES, screen: 'dailyDispatch' },
  setDriverNote: { roles: SAVE_ROLES, screen: 'dailyDispatch' },
  setRuns: { roles: SAVE_ROLES, screen: 'dailyDispatch' },
  setDispatchTime: { roles: SAVE_ROLES, screen: 'dailyDispatch' },
  setJack: { roles: SAVE_ROLES, screen: 'dailyDispatch' },
  moveRun: { roles: SAVE_ROLES, screen: 'dailyDispatch' },
  setUnitDown: { roles: SAVE_ROLES, screen: 'dailyDispatch' },
  setUnitUp: { roles: SAVE_ROLES, screen: 'dailyDispatch' },
  reorderLoads: { roles: REORDER_ROLES, screen: 'dailyDispatch' },
  clearConflict: { roles: SAVE_ROLES, screen: 'dailyDispatch' },
  saveCheckIn: { roles: SAVE_ROLES, screen: 'checkIns' },
  setDriverTruck: { roles: DRIVER_ROLES, screen: 'drivers' },
  setDriverAvailable: { roles: DRIVER_ROLES, screen: 'drivers' },
  setDriverRelief: { roles: DRIVER_ROLES, screen: 'drivers' },
  saveDriver: { roles: DRIVER_ROLES, screen: 'drivers' },
  removeDrivers: { roles: DRIVER_ROLES, screen: 'drivers' },
  saveDriverException: { roles: SAVE_ROLES, screen: 'drivers' },
  saveVacation: { roles: DRIVER_ROLES, screen: 'vacations' },
  publishWeek: { roles: SAVE_ROLES, screen: 'weeklyDispatch' },
  resetWeek: { roles: REORDER_ROLES, screen: 'weeklyDispatch' },
  saveRoute: { roles: REORDER_ROLES, screen: 'routes' },
  reorderRouteDay: { roles: REORDER_ROLES, screen: 'routes' },
  updateIssue: { roles: SAVE_ROLES, screen: 'checkIns' },
  setWeekReason: { roles: SAVE_ROLES, screen: 'weeklyDispatch' },
  saveDriverTemplate: { roles: DRIVER_ROLES, screen: 'drivers' },
  saveOtr: { roles: DRIVER_ROLES, screen: 'otr' }
});

const EXCEPTION_REASONS = ['SICK DAY', 'BEREAVEMENT', 'PERSONAL DAY', 'UNPAID DAY', 'VACATION', 'CALLED OFF', 'OFF', 'OTHER'];
const VACATION_STATUSES = ['APPROVED', 'PENDING', 'DENIED', 'CANCELLED'];

const DRIVER_ACTIONS = ['setDriverTruck', 'setDriverAvailable', 'setDriverRelief'];

function dateOrBlank(v, label) {
  const t = text(v, 40);
  if (!t) return '';
  const key = L.dateKey(t);
  if (!key) throw new SaveError('BAD_REQUEST', label + ' must be a date');
  return key;
}

function count(v, label) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 99999) throw new SaveError('BAD_REQUEST', label + ' must be a whole number from 0 to 99999');
  return n;
}

function text(v, max) { return String(v === null || v === undefined ? '' : v).trim().slice(0, max || 200); }

function validate(input) {
  input = input || {};
  const action = text(input.action, 40);
  if (!ACTIONS[action]) throw new SaveError('BAD_REQUEST', 'Unknown save: ' + (action || '(none)'));
  const requestId = text(input.requestId, 80);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) throw new SaveError('BAD_REQUEST', 'Each save needs a requestId');
  const out = { action, requestId };
  if (action === 'reorderLoads') {
    if (!L.isDateKey(input.loadDate)) throw new SaveError('BAD_REQUEST', 'loadDate must be yyyy-mm-dd');
    if (!Array.isArray(input.order) || !input.order.length || input.order.length > 150) throw new SaveError('BAD_REQUEST', 'order must list the loads');
    out.loadDate = input.loadDate;
    out.order = input.order.map(item => ({ runDocId: text(item && item.runDocId), day: text(item && item.day, 10) }));
    const seen = {};
    out.order.forEach(item => {
      if (!item.runDocId || L.DAYS.indexOf(item.day) < 0) throw new SaveError('BAD_REQUEST', 'Each load needs runDocId and day');
      const k = item.runDocId + '|' + item.day;
      if (seen[k]) throw new SaveError('BAD_REQUEST', 'A load is listed twice');
      seen[k] = true;
    });
    return out;
  }
  if (action === 'clearConflict') {
    out.conflictId = text(input.conflictId);
    if (!/^[A-Za-z0-9_-]{8,160}$/.test(out.conflictId)) throw new SaveError('BAD_REQUEST', 'conflictId is required');
    return out;
  }
  if (action === 'saveDriver') {
    out.driverId = text(input.driverId);
    out.name = text(input.name, 120).toUpperCase();
    if (!out.name) throw new SaveError('BAD_REQUEST', 'Enter the driver name');
    out.hireDate = dateOrBlank(input.hireDate, 'Hire date');
    out.seniorityDate = dateOrBlank(input.seniorityDate, 'Seniority date');
    out.truck = text(input.truck, 40).toUpperCase();
    out.relief = input.relief === true;
    return out;
  }
  if (action === 'saveDriverException') {
    out.driverId = text(input.driverId);
    out.startDate = dateOrBlank(input.startDate, 'Start date');
    out.endDate = dateOrBlank(input.endDate || input.startDate, 'End date');
    if (!out.driverId || !out.startDate || !out.endDate) throw new SaveError('BAD_REQUEST', 'Driver, Start Date and End Date are required');
    if (out.endDate < out.startDate) throw new SaveError('BAD_REQUEST', 'End Date cannot be before Start Date');
    out.status = text(input.status, 20).toUpperCase() === 'AVAILABLE' || text(input.status, 20).toUpperCase() === 'CLEAR' ? 'AVAILABLE' : 'UNAVAILABLE';
    out.reason = text(input.reason, 40).toUpperCase() || 'OTHER';
    if (EXCEPTION_REASONS.indexOf(out.reason) < 0) out.reason = 'OTHER';
    out.note = text(input.note, 300);
    return out;
  }
  if (action === 'saveVacation') {
    out.vacationId = text(input.vacationId, 80);
    out.driverId = text(input.driverId);
    out.startDate = dateOrBlank(input.startDate, 'First day');
    out.endDate = dateOrBlank(input.endDate || input.startDate, 'Last day');
    if (!out.driverId || !out.startDate || !out.endDate) throw new SaveError('BAD_REQUEST', 'Driver, First day and Last day are required');
    if (out.endDate < out.startDate) throw new SaveError('BAD_REQUEST', 'Last day cannot be before First day');
    if (L.daysBetween(out.startDate, out.endDate) > 366) throw new SaveError('BAD_REQUEST', 'A vacation entry can be at most a year long');
    out.type = L.vacationType(input.type);
    out.status = text(input.status, 20).toUpperCase() || 'APPROVED';
    if (VACATION_STATUSES.indexOf(out.status) < 0) throw new SaveError('BAD_REQUEST', 'Vacation status is invalid');
    out.notes = text(input.notes, 1000);
    // Kept with the entry like the current form; nothing is sent (outbound email stays off).
    out.email = text(input.email, 200);
    if (out.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email)) throw new SaveError('BAD_REQUEST', 'Notification email does not look like an email address');
    return out;
  }
  if (action === 'saveRoute') {
    out.runId = text(input.runId, 120);
    out.fields = {};
    const f = input.fields || {};
    Object.keys(f).forEach(k => {
      if (!ROUTE_FIELDS[k]) throw new SaveError('BAD_REQUEST', k + ' is not a Route Master field');
      out.fields[k] = routeValue(ROUTE_FIELDS[k], f[k], k);
    });
    out.days = {};
    Object.keys(input.days || {}).forEach(p => {
      if (L.DAYS.indexOf(p) < 0) throw new SaveError('BAD_REQUEST', p + ' is not a day');
      out.days[p] = {};
      Object.keys(input.days[p] || {}).forEach(k => {
        if (!ROUTE_DAY_FIELDS[k]) throw new SaveError('BAD_REQUEST', k + ' is not a Route Master day field');
        out.days[p][k] = routeValue(ROUTE_DAY_FIELDS[k], input.days[p][k], L.DAY_NAMES[L.DAYS.indexOf(p)] + ' ' + k);
      });
    });
    if (!out.runId && !(out.fields.route && out.fields.run)) throw new SaveError('BAD_REQUEST', 'A new run needs a Route and a Run / Destination');
    return out;
  }
  if (action === 'reorderRouteDay') {
    if (L.DAYS.indexOf(input.day) < 0) throw new SaveError('BAD_REQUEST', 'Pick the day');
    if (!Array.isArray(input.runIds) || !input.runIds.length || input.runIds.length > 300) throw new SaveError('BAD_REQUEST', 'The order is missing');
    out.day = input.day;
    out.runIds = input.runIds.map(id => text(id, 120));
    return out;
  }
  if (action === 'publishWeek' || action === 'resetWeek') {
    if (!L.isDateKey(input.weekStart) || L.weekStart(input.weekStart) !== input.weekStart) throw new SaveError('BAD_REQUEST', 'weekStart must be a Sunday (yyyy-mm-dd)');
    out.weekStart = input.weekStart;
    return out;
  }
  if (action === 'removeDrivers') {
    if (!Array.isArray(input.driverIds) || !input.driverIds.length || input.driverIds.length > 100) throw new SaveError('BAD_REQUEST', 'Pick the drivers to remove');
    out.driverIds = [...new Set(input.driverIds.map(id => text(id)).filter(Boolean))];
    return out;
  }
  if (action === 'saveDriverTemplate') {
    out.driverId = text(input.driverId);
    if (!out.driverId) throw new SaveError('BAD_REQUEST', 'Pick the driver');
    if (L.DAYS.indexOf(input.day) < 0) throw new SaveError('BAD_REQUEST', 'day must be sun..sat');
    out.day = input.day;
    out.status = text(input.status).toUpperCase();
    if (['AVAILABLE', 'OFF', 'ASSIGNMENT'].indexOf(out.status) < 0) throw new SaveError('BAD_REQUEST', 'status must be AVAILABLE, OFF or ASSIGNMENT');
    out.runIds = [...new Set((Array.isArray(input.runIds) ? input.runIds : []).map(id => text(id, 120)).filter(Boolean))].slice(0, 6);
    if (out.status === 'ASSIGNMENT' && !out.runIds.length) throw new SaveError('BAD_REQUEST', 'Pick a run');
    if (out.status !== 'ASSIGNMENT') out.runIds = [];
    return out;
  }
  // Over the Road (the current app's OTR saves, 222_V7276): tick a run for the report, type a month figure, or fix a day's count.
  if (action === 'saveOtr') {
    out.op = text(input.op, 10);
    if (out.op === 'route') {
      out.runId = text(input.runId, 120);
      if (!out.runId) throw new SaveError('BAD_REQUEST', 'Pick the run');
      out.include = input.include === true;
      out.destination = OTR.otrNormDest_(input.destination);
      if (out.destination && OTR.OTR_CORE.DESTINATIONS.indexOf(out.destination) < 0) throw new SaveError('BAD_REQUEST', 'Pick a destination from the list');
      if (out.include && !out.destination) throw new SaveError('BAD_REQUEST', 'Pick where this route goes before including it');
    } else if (out.op === 'figure') {
      out.year = Number(input.year); out.month = Number(input.month); out.key = text(input.key, 40);
      if (!Number.isInteger(out.year) || out.year < 2000 || out.year > 2100 || !Number.isInteger(out.month) || out.month < 1 || out.month > 12) throw new SaveError('BAD_REQUEST', 'Pick a month');
      if (!OTR.OTR_CORE.FIGURES.some(f => f.key === out.key)) throw new SaveError('BAD_REQUEST', 'Unknown figure ' + out.key);
      out.value = input.value === '' || input.value === null || input.value === undefined ? null : OTR.otrNum_(input.value);
      if (out.value === null && !(input.value === '' || input.value === null || input.value === undefined)) throw new SaveError('BAD_REQUEST', input.value + ' is not a number');
    } else if (out.op === 'day') {
      out.date = text(input.date, 10); out.destination = OTR.otrNormDest_(input.destination); out.runs = count(input.runs, 'Runs');
      if (!L.isDateKey(out.date)) throw new SaveError('BAD_REQUEST', 'date must be yyyy-mm-dd');
      if (OTR.OTR_CORE.DESTINATIONS.indexOf(out.destination) < 0) throw new SaveError('BAD_REQUEST', 'Pick a destination from the list');
      if (out.runs === null) throw new SaveError('BAD_REQUEST', 'Type the number of runs');
    } else throw new SaveError('BAD_REQUEST', 'op must be route, figure or day');
    return out;
  }
  if (action === 'setWeekReason') {
    out.weekStart = text(input.weekStart);
    if (!L.isDateKey(out.weekStart)) throw new SaveError('BAD_REQUEST', 'weekStart must be yyyy-mm-dd');
    out.reason = text(input.reason, 300);
    return out;
  }
  if (action === 'updateIssue') {
    out.recordId = text(input.recordId, 300);
    if (!out.recordId) throw new SaveError('BAD_REQUEST', 'Pick the write-up');
    out.step = text(input.step);
    if (['repaired', 'reviewed', 'remove', 'garage'].indexOf(out.step) < 0) throw new SaveError('BAD_REQUEST', 'step must be repaired, reviewed, remove or garage');
    out.note = text(input.note, 500);
    return out;
  }
  if (action === 'setUnitDown' || action === 'setUnitUp') {
    out.equipmentId = text(input.equipmentId);
    if (!out.equipmentId) throw new SaveError('BAD_REQUEST', 'Pick the truck or trailer');
    out.reason = text(input.reason, 120);
    if (action === 'setUnitDown' && !out.reason) throw new SaveError('BAD_REQUEST', 'Say why the unit is down');
    if (input.today !== undefined && !L.isDateKey(input.today)) throw new SaveError('BAD_REQUEST', 'today must be yyyy-mm-dd');
    out.today = input.today;
    return out;
  }
  if (DRIVER_ACTIONS.indexOf(action) >= 0) {
    out.driverId = text(input.driverId);
    if (!out.driverId) throw new SaveError('BAD_REQUEST', 'driverId is required');
    if (action === 'setDriverTruck') out.equipmentId = text(input.equipmentId);
    if (action === 'setDriverAvailable') { out.available = input.available === true; out.reason = text(input.reason, 200); }
    if (action === 'setDriverRelief') out.relief = input.relief === true;
    return out;
  }
  out.runDocId = text(input.runDocId);
  out.day = text(input.day, 10);
  if (!out.runDocId || L.DAYS.indexOf(out.day) < 0) throw new SaveError('BAD_REQUEST', 'runDocId and day are required');
  if (input.expectedRev !== undefined && input.expectedRev !== null) {
    if (!Number.isFinite(Number(input.expectedRev))) throw new SaveError('BAD_REQUEST', 'expectedRev must be a number');
    out.expectedRev = Number(input.expectedRev);
  }
  if (action === 'assignDriver') out.driverId = text(input.driverId);
  if (action === 'assignTruck' || action === 'assignTrailer') out.equipmentId = text(input.equipmentId);
  // OVR on Daily: a driver who is off that day, or a unit that is down, may still be picked on purpose.
  if (['assignDriver', 'assignTruck', 'assignTrailer'].indexOf(action) >= 0 && input.override === true) out.override = true;
  if (action === 'setRuns') out.runs = input.runs === true;
  if (action === 'setDispatchTime') {
    const t = text(input.time, 20);
    out.time = t ? L.minutesOfDay(t) : null;
    if (t && out.time === null) throw new SaveError('BAD_REQUEST', 'Depart time must look like 4:30 AM or 16:30');
  }
  if (action === 'setJack') out.jack = text(input.jack, 40).toUpperCase();
  if (action === 'moveRun') {
    if (!L.isDateKey(input.toDate)) throw new SaveError('BAD_REQUEST', 'Pick the day to move to');
    out.toDate = input.toDate;
  }
  if (action === 'setDriverNote') out.note = text(input.note, 500);
  if (action === 'saveCheckIn') {
    out.checkIn = {
      casesDelivered: count(input.casesDelivered, 'Cases delivered'), driverCaseReturn: count(input.driverCaseReturn, 'Cases returned'),
      refusedReturned: text(input.refusedReturned, 200), refusedReturnedSource: text(input.refusedReturnedSource, 200),
      tractorIssues: text(input.tractorIssues, 300), trailerIssues: text(input.trailerIssues, 300), palletJackIssues: text(input.palletJackIssues, 300),
      trailerNeedsCleaned: input.trailerNeedsCleaned === true ? 'TRUE' : '', checkinNotes: text(input.checkinNotes, 500)
    };
  }
  return out;
}

async function requireSaver(tx, db, user, roles) {
  const email = String(user && user.email || '').toLowerCase();
  const snap = await tx.get(db.collection(C.users).doc(M.safeIdPart(email)));
  const person = snap.exists ? snap.data() : null;
  if (!person || person.status !== 'ACTIVE') throw new SaveError('NOT_ALLOWED', email + ' is not an active user in the Users list');
  if (!L.hasRole(person, roles)) throw new SaveError('NOT_ALLOWED', email + ' does not have a role that can make this save (' + roles.join(', ') + ')');
  return person;
}

// Whether this screen may save in the new app (switch.js): every screen while it is a test copy, then only
// the screens an administrator moved to the new app.
async function requireTestMode(tx, db, screen) {
  const snap = await tx.get(db.collection(C.config).doc('app'));
  return SWITCH.screenMode(snap.exists ? snap.data() : {}, screen, (code, message) => new SaveError(code, message));
}

async function resolveAssignment(tx, db, req, stamp, run) {
  if (req.action === 'assignDriver') {
    // Picking anyone for a day a driver went off ends the "who it was for" note on it.
    const was = (run.days && run.days[req.day]) || {}, clearOff = {};
    ['intendedDriverId', 'intendedDriver', 'driverExceptionStatus'].forEach(k => { if (was[k]) clearOff[k] = ''; });
    if (!req.driverId) return Object.assign({ driverId: '', driver: '' }, clearOff);
    // Weekly's CARRIER and OPEN choices: a word in the driver column, no Driver Master entry.
    if (req.driverId === '__CARRIER__' || req.driverId === '__OPEN__') return Object.assign({ driverId: '', driver: req.driverId.slice(2, -2) }, clearOff);
    const snap = await tx.get(db.collection(C.drivers).doc(M.safeIdPart(req.driverId)));
    if (!snap.exists) throw new SaveError('NOT_FOUND', 'Driver ' + req.driverId + ' is not in Driver Master');
    const d = snap.data();
    if (!req.override) {
      if (!L.driverActive(d)) throw new SaveError('NOT_ALLOWED', d.name + ' is ' + d.status + ' in Driver Master (tick OVR to use them anyway)');
      const date = L.addDays(run.weekStart, L.DAYS.indexOf(req.day));
      const off = await tx.get(db.collection(C.exceptions).where('driverId', '==', d.id));
      const e = L.exceptionOn(off.docs.map(x => x.data()), d.id, date);
      if (e) throw new SaveError('NOT_ALLOWED', d.name + ' is off on ' + date + ' (' + L.exceptionLabel(e) + '); tick OVR to use them anyway');
    }
    return Object.assign({ driverId: d.id, driver: d.name }, clearOff);
  }
  if (req.action === 'assignTruck' || req.action === 'assignTrailer') {
    const type = req.action === 'assignTruck' ? 'TRUCK' : 'TRAILER';
    const idField = type === 'TRUCK' ? 'truckId' : 'trailerId', unitField = type === 'TRUCK' ? 'truck' : 'trailer';
    if (!req.equipmentId) return { [idField]: '', [unitField]: '' };
    const snap = await tx.get(db.collection(C.equipment).doc(M.safeIdPart(req.equipmentId)));
    if (!snap.exists) throw new SaveError('NOT_FOUND', req.equipmentId + ' is not in Equipment Master');
    const e = snap.data();
    if (e.type !== type) throw new SaveError('BAD_REQUEST', e.unit + ' is a ' + e.type + ', not a ' + type);
    if (!req.override && L.unitOff(e)) throw new SaveError('NOT_ALLOWED', e.unit + ' is ' + e.status + ' in Equipment Master (tick OVR to use it anyway)');
    return { [idField]: e.id, [unitField]: e.unit };
  }
  if (req.action === 'setRuns') return { runs: req.runs };
  if (req.action === 'setDispatchTime') return { dispatchTime: req.time };
  if (req.action === 'setJack') return { palletJack: req.jack };
  if (req.action === 'saveCheckIn') return Object.assign({}, req.checkIn, { checkinCompletedAt: stamp });
  return { driverNotes: req.note };
}

// Sheet column suffix for each day field the saves change (the reverse of model.DAY_FIELDS).
const COLUMN_FOR = {}, TIME_FIELDS = {};
// Kept in the new app only (the Live sheet has no column for them): who a day was for before the driver went off, and why.
const APP_ONLY = { intendedDriverId: true, intendedDriver: true, driverExceptionStatus: true };
M.DAY_FIELDS.forEach(([field, suffix, kind]) => { COLUMN_FOR[field] = suffix; if (kind === 'time') TIME_FIELDS[field] = true; });

/*
 * The write-back queue: each save also adds the sheet cells it changes, in the same transaction, so a save
 * can never be in the database without its sheet update waiting (see writeback.js). Cells are named by
 * column; the row is found by run_id when it is written, never by row number.
 */
function queueSheetCells(tx, db, requestId, part, run, runDocId, day, values, stamp, email) {
  const cells = {};
  Object.keys(values).forEach(field => {
    if (APP_ONLY[field]) return;
    if (!COLUMN_FOR[field]) throw new Error('No sheet column for ' + field);
    let v = values[field];
    if (TIME_FIELDS[field]) v = L.timeText(v);
    if (typeof v === 'boolean') v = v ? 'TRUE' : 'FALSE';
    // Numbers stay numbers so the sheet keeps them as numbers; everything else is written as plain text.
    cells[day + '_' + COLUMN_FOR[field]] = v === null || v === undefined ? '' : typeof v === 'number' ? v : String(v);
  });
  cells[day + '_updated_at'] = stamp;
  cells[day + '_updated_by'] = email;
  const days = L.DAYS.filter(p => run.days && run.days[p] && run.days[p].runs);
  tx.set(db.collection(C.outbox).doc(requestId + (part ? '-' + part : '')), {
    status: 'pending', at: stamp, by: email, requestId, runDocId, tab: run.sourceTab, weekStart: run.weekStart,
    match: { runId: run.runId || '', route: run.route || '', run: run.run || '', days }, cells
  });
}

/*
 * Runs one save. user = the signed-in person ({email}). Returns {ok, requestId, runs:[{runDocId, rev}], repeated}.
 */
async function applyAction(db, user, input, now) {
  const req = validate(input);
  const spec = ACTIONS[req.action];
  const stamp = (now ? now() : new Date()).toISOString();
  const email = String(user && user.email || '').toLowerCase();
  return db.runTransaction(async (tx) => {
    const logRef = db.collection(C.actions).doc(req.requestId);
    const logSnap = await tx.get(logRef);
    if (logSnap.exists) {
      const prior = logSnap.data();
      if (prior.by !== email || prior.action !== req.action) throw new SaveError('BAD_REQUEST', 'requestId was already used for a different save');
      return Object.assign({}, prior.result, { repeated: true });
    }
    const mode = await requireTestMode(tx, db, spec.screen);
    await requireSaver(tx, db, user, spec.roles);

    if (req.action === 'reorderLoads') return reorder(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'moveRun') return moveRun(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'setUnitDown' || req.action === 'setUnitUp') return setUnitDown(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'updateIssue') return updateIssue(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'clearConflict') return clearConflict(tx, db, req, email, stamp, logRef, mode);
    if (DRIVER_ACTIONS.indexOf(req.action) >= 0) return editDriver(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'saveDriver') return saveDriver(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'removeDrivers') return removeDrivers(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'saveDriverException') return saveDriverException(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'saveVacation') return saveVacation(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'saveDriverTemplate') return saveDriverTemplate(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'setWeekReason') return setWeekReason(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'saveOtr') return saveOtr(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'publishWeek') return publishWeek(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'resetWeek') return resetWeek(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'saveRoute') return saveRoute(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'reorderRouteDay') return reorderRouteDay(tx, db, req, email, stamp, logRef, mode);

    const runRef = db.collection(C.runs).doc(req.runDocId);
    const runSnap = await tx.get(runRef);
    if (!runSnap.exists) throw new SaveError('NOT_FOUND', 'That run is no longer on the Live sheet');
    const run = runSnap.data();
    const day = run.days && run.days[req.day];
    // RUNS / Add Route / Run may turn a day back on; every other save needs a day that runs.
    if (!day || (!day.runs && req.action !== 'setRuns')) throw new SaveError('NOT_FOUND', run.route + ' ' + run.run + ' does not run on ' + L.DAY_NAMES[L.DAYS.indexOf(req.day)]);
    if (req.expectedRev !== undefined && req.expectedRev !== run.rev) {
      throw new SaveError('CHANGED', run.route + ' ' + run.run + ' was changed by someone else; the screen now shows the latest', { rev: run.rev });
    }
    const after = await resolveAssignment(tx, db, req, stamp, run);
    // A check-in's problems also go to the maintenance queues (read now; written below with the check-in).
    const writeMaint = req.action === 'saveCheckIn'
      ? await MAINT.prepareMaintenance(tx, db, run, req.runDocId, req.day, L.addDays(run.weekStart, L.DAYS.indexOf(req.day)), Object.assign({}, day, after), { by: email, driver: day.driver || '' }, stamp) : null;
    const before = {};
    Object.keys(after).forEach(k => { before[k] = day[k] === undefined ? null : day[k]; });
    const update = { rev: run.rev + 1, testEdited: true, editedAt: stamp };
    Object.keys(after).forEach(k => { update['days.' + req.day + '.' + k] = after[k]; });
    // Any driver change marks the day as changed by hand (<day>_route_override), as the current app's driver saves do;
    // the Driver Assignment Board shows those days light blue.
    const marks = req.action === 'assignDriver' || req.action === 'setRuns' ? { routeOverride: 'TRUE' } : {};
    Object.keys(marks).forEach(k => { update['days.' + req.day + '.' + k] = marks[k]; });
    update['days.' + req.day + '.updatedAt'] = stamp;
    update['days.' + req.day + '.updatedBy'] = email;
    tx.update(runRef, update);
    if (mode.writeBack) queueSheetCells(tx, db, req.requestId, '', run, req.runDocId, req.day, Object.assign({}, after, marks), stamp, email);
    const result = { ok: true, requestId: req.requestId, runs: [{ runDocId: req.runDocId, rev: run.rev + 1 }] };
    if (writeMaint) result.maintenance = writeMaint(maintQueue(tx, db, mode, req.requestId, stamp, email));
    tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, runDocId: req.runDocId, day: req.day, before, after, result });
    return result;
  });
}

// Each new maintenance record also goes to its tab of the sandbox Live workbook when the write-back is on.
function maintQueue(tx, db, mode, requestId, stamp, email) {
  return (ref, r) => queueMaster(tx, db, mode, requestId, 'm' + r.kind, ref, r.record_id, r, true, stamp, email, MAINT.LISTS[r.kind]);
}

/*
 * MOVE TO ANOTHER DAY (Daily edit, udpoV7273MoveDailyRun_): the run is turned on for the new day with nothing
 * assigned, and the old day becomes NO RUN with its driver, truck and trailer cleared. Both in one save.
 */
async function moveRun(tx, db, req, email, stamp, logRef, mode) {
  const fromRef = db.collection(C.runs).doc(req.runDocId);
  const fromSnap = await tx.get(fromRef);
  if (!fromSnap.exists) throw new SaveError('NOT_FOUND', 'That run is no longer on the Live sheet');
  const from = fromSnap.data();
  if (!from.days || !from.days[req.day] || !from.days[req.day].runs) throw new SaveError('NOT_FOUND', from.route + ' ' + from.run + ' does not run that day');
  if (req.expectedRev !== undefined && req.expectedRev !== from.rev) throw new SaveError('CHANGED', from.route + ' ' + from.run + ' was changed by someone else; the screen now shows the latest', { rev: from.rev });
  const fromDate = L.addDays(from.weekStart, L.DAYS.indexOf(req.day));
  if (req.toDate === fromDate) throw new SaveError('BAD_REQUEST', 'Pick a different day');
  const toWeek = L.weekStart(req.toDate), toDay = L.dayPrefix(req.toDate);
  let toRef = fromRef, to = from;
  if (toWeek !== from.weekStart) {
    const found = await tx.get(db.collection(C.runs).where('weekStart', '==', toWeek).where('runId', '==', from.runId).limit(5));
    if (found.empty) throw new SaveError('NOT_FOUND', 'The week of ' + toWeek + ' is not one of the Live weeks, or ' + from.route + ' is not on it');
    toRef = found.docs[0].ref; to = found.docs[0].data();
  }
  const cleared = { runs: false, driverId: '', driver: '', truckId: '', truck: '', trailerId: '', trailer: '' };
  const fromUpdate = { rev: from.rev + 1, testEdited: true, editedAt: stamp };
  Object.keys(cleared).forEach(k => { fromUpdate['days.' + req.day + '.' + k] = cleared[k]; });
  const turnedOn = { runs: true };
  const result = { ok: true, requestId: req.requestId, runs: [] };
  if (toRef === fromRef) {
    fromUpdate['days.' + toDay + '.runs'] = true;
    tx.update(fromRef, fromUpdate);
    result.runs.push({ runDocId: req.runDocId, rev: from.rev + 1 });
  } else {
    tx.update(fromRef, fromUpdate);
    tx.update(toRef, { rev: to.rev + 1, testEdited: true, editedAt: stamp, ['days.' + toDay + '.runs']: true });
    result.runs.push({ runDocId: req.runDocId, rev: from.rev + 1 }, { runDocId: toRef.id, rev: to.rev + 1 });
  }
  if (mode.writeBack) {
    queueSheetCells(tx, db, req.requestId, '001', from, req.runDocId, req.day, cleared, stamp, email);
    queueSheetCells(tx, db, req.requestId, '002', to, toRef.id, toDay, turnedOn, stamp, email);
  }
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, runDocId: req.runDocId, day: req.day, before: { date: fromDate }, after: { date: req.toDate, runDocId: toRef.id }, result });
  return result;
}

/*
 * Down Trucks / Trailers (Daily, 216_V7267_DownTrucks.gs): the unit is marked DOWN with the reason and taken off
 * every load from today on in the copied Live weeks. Back in service puts it back to ACTIVE. Equipment Master is
 * not written yet (test copy).
 */
async function setUnitDown(tx, db, req, email, stamp, logRef, mode) {
  const ref = db.collection(C.equipment).doc(M.safeIdPart(req.equipmentId));
  const snap = await tx.get(ref);
  if (!snap.exists) throw new SaveError('NOT_FOUND', req.equipmentId + ' is not in Equipment Master');
  const unit = snap.data();
  const result = { ok: true, requestId: req.requestId, runs: [] };
  if (req.action === 'setUnitUp') {
    tx.update(ref, { status: 'ACTIVE', notes: '', downSince: '', testEdited: true, editedAt: stamp, editedBy: email });
    queueMaster(tx, db, mode, req.requestId, 'unit', ref, unit.id, { status: 'ACTIVE', notes: '' }, false, stamp, email);
    tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, equipmentId: unit.id, before: { status: unit.status, notes: unit.notes || '' }, after: { status: 'ACTIVE' }, result });
    return result;
  }
  const today = req.today || L.operatingDay(new Date(stamp));
  const weeks = [L.weekStart(today), L.addDays(L.weekStart(today), 7)];
  const runs = await tx.get(db.collection(C.runs).where('weekStart', 'in', weeks));
  const idKey = unit.type === 'TRAILER' ? 'trailerId' : 'truckId', textKey = unit.type === 'TRAILER' ? 'trailer' : 'truck';
  const removed = [];
  runs.docs.forEach(r => {
    const run = r.data(), update = {}, cells = {};
    L.DAYS.forEach((p, i) => {
      const d = run.days && run.days[p];
      if (!d || d[idKey] !== unit.id || L.addDays(run.weekStart, i) < today) return;
      update['days.' + p + '.' + idKey] = ''; update['days.' + p + '.' + textKey] = '';
      cells[p] = true;
      removed.push(run.route + ' ' + L.addDays(run.weekStart, i));
    });
    if (!Object.keys(update).length) return;
    tx.update(r.ref, Object.assign(update, { rev: run.rev + 1, testEdited: true, editedAt: stamp }));
    result.runs.push({ runDocId: r.id, rev: run.rev + 1 });
    if (mode.writeBack) Object.keys(cells).forEach((p, i) => queueSheetCells(tx, db, req.requestId, r.id.slice(-6) + p + i, run, r.id, p, { [idKey]: '', [textKey]: '' }, stamp, email));
  });
  tx.update(ref, { status: 'DOWN', notes: 'DOWN: ' + req.reason, downSince: stamp, testEdited: true, editedAt: stamp, editedBy: email });
  queueMaster(tx, db, mode, req.requestId, 'unit', ref, unit.id, { status: 'DOWN', notes: 'DOWN: ' + req.reason }, false, stamp, email);
  result.removedFrom = removed;
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, equipmentId: unit.id, before: { status: unit.status, notes: unit.notes || '' }, after: { status: 'DOWN', reason: req.reason, removedFrom: removed }, result });
  return result;
}

/*
 * Equipment Issues buttons (036_V740_MaintenanceRepositoryService.gs): Repaired, Reviewed, Remove and To garage, each one save on
 * the write-up. Repaired: COMPLETE, available, not out of service, completed at / by. Remove keeps the row as REMOVED with who and
 * when (never deleted). To garage adds one note, once. Reviewed only moves a NEEDS_REVIEW write-up that has text to OPEN.
 */
async function updateIssue(tx, db, req, email, stamp, logRef, mode) {
  const ref = db.collection(C.maintenance).doc(MAINT.docId(req.recordId));
  const snap = await tx.get(ref);
  if (!snap.exists) throw new SaveError('NOT_FOUND', 'That write-up is no longer on the list');
  const r = snap.data(), notes = String(r.notes || '').trim(), add = (line) => (notes ? notes + '\n' : '') + line;
  let change;
  if (req.step === 'repaired') change = { status: 'COMPLETE', available: 'TRUE', out_of_service: 'FALSE', completed_at: stamp, completed_by: email, resolution: 'COMPLETED', resolution_notes: req.note || '' };
  else if (req.step === 'remove') change = { status: 'REMOVED', resolution: 'REMOVED', resolution_notes: req.note || 'Removed: not a real unit or not a write-up', notes: add('Removed by ' + email + ' at ' + stamp) };
  else if (req.step === 'garage') {
    if (notes.indexOf('Sent to garage') >= 0) return { ok: true, requestId: req.requestId, runs: [], message: 'Already sent to the garage.' };
    change = { notes: add('Sent to garage ' + stamp + ' by ' + email) };
  } else {
    if (String(r.status || '').toUpperCase() !== 'NEEDS_REVIEW') throw new SaveError('NOT_ALLOWED', 'Only a write-up that needs review can be marked reviewed');
    if (L.noWriteUp(r.issue_details)) throw new SaveError('NOT_ALLOWED', 'Add what is wrong before marking it reviewed');
    change = { status: 'OPEN', notes: add('Reviewed by ' + email + ' at ' + stamp) };
  }
  Object.assign(change, { updated_at: stamp, updated_by: email });
  tx.update(ref, Object.assign({}, change, { testEdited: true, editedAt: stamp, editedBy: email }));
  const list = MAINT.LISTS[String(r.kind || '').toUpperCase()];
  if (list) queueMaster(tx, db, mode, req.requestId, 'issue', ref, r.record_id, r.createdInApp ? Object.assign({}, r, change) : change, !!r.createdInApp, stamp, email, list);
  const result = { ok: true, requestId: req.requestId, runs: [] };
  const before = {}; Object.keys(change).forEach(k => { before[k] = r[k] === undefined ? null : r[k]; });
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, recordId: r.record_id, before, after: change, result });
  return result;
}

// Same rule as udpoV754SaveDailyLoadSequence_: the new order reuses the load-order numbers the loads already
// had (smallest first); if those are missing or repeated, the loads are numbered 5, 10, 15, ...
async function reorder(tx, db, req, email, stamp, logRef, mode) {
  const refs = {}, runs = {};
  req.order.forEach(item => { refs[item.runDocId] = db.collection(C.runs).doc(item.runDocId); });
  const ids = Object.keys(refs);
  const snaps = await tx.getAll(...ids.map(id => refs[id]));
  snaps.forEach((snap, i) => {
    if (!snap.exists) throw new SaveError('NOT_FOUND', 'A load in the list is no longer on the Live sheet');
    runs[ids[i]] = snap.data();
  });
  const targets = req.order.map(item => {
    const run = runs[item.runDocId], day = run.days && run.days[item.day];
    if (!day || !day.runs || !L.loadBlocksFor(Object.assign({}, run, { id: item.runDocId }), req.loadDate).some(b => b.prefix === item.day)) {
      throw new SaveError('NOT_FOUND', run.route + ' ' + run.run + ' does not load on ' + req.loadDate);
    }
    return { item, run, seq: L.effectiveSequence(day) };
  });
  let slots = targets.map(t => t.seq).filter(v => v !== null && v !== undefined).sort((a, b) => a - b);
  slots = slots.filter((v, i) => slots.indexOf(v) === i);
  if (slots.length !== targets.length) slots = targets.map((_, i) => (i + 1) * 5);
  const updates = {}, before = [], after = [];
  targets.forEach((t, i) => {
    if (mode.writeBack) queueSheetCells(tx, db, req.requestId, String(i + 1).padStart(3, '0'), t.run, t.item.runDocId, t.item.day, { loadSequenceOverride: slots[i] }, stamp, email);
    const u = updates[t.item.runDocId] = updates[t.item.runDocId] || {};
    u['days.' + t.item.day + '.loadSequenceOverride'] = slots[i];
    u['days.' + t.item.day + '.updatedAt'] = stamp;
    u['days.' + t.item.day + '.updatedBy'] = email;
    before.push({ runDocId: t.item.runDocId, day: t.item.day, loadSequence: t.seq });
    after.push({ runDocId: t.item.runDocId, day: t.item.day, loadSequence: slots[i] });
  });
  const result = { ok: true, requestId: req.requestId, runs: [] };
  Object.keys(updates).forEach(id => {
    const rev = runs[id].rev + 1;
    tx.update(refs[id], Object.assign(updates[id], { rev, testEdited: true, editedAt: stamp }));
    result.runs.push({ runDocId: id, rev });
  });
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, loadDate: req.loadDate, before, after, result });
  return result;
}

/*
 * Driver list edits (the Employee Information screen): assigned truck, available, relief. With the write-back on they
 * also go to the sandbox copy of DRIVERS_MASTER (masterwrite.js); as with runs, the sheet wins again the next time
 * that driver's row changes in DRIVERS_MASTER.
 */
async function editDriver(tx, db, req, email, stamp, logRef, mode) {
  const ref = db.collection(C.drivers).doc(M.safeIdPart(req.driverId));
  const snap = await tx.get(ref);
  if (!snap.exists) throw new SaveError('NOT_FOUND', 'Driver ' + req.driverId + ' is not in Driver Master');
  const d = snap.data();
  let after;
  if (req.action === 'setDriverTruck') {
    if (!req.equipmentId) after = { defaultTruckId: '' };
    else {
      const unit = await tx.get(db.collection(C.equipment).doc(M.safeIdPart(req.equipmentId)));
      if (!unit.exists) throw new SaveError('NOT_FOUND', req.equipmentId + ' is not in Equipment Master');
      const e = unit.data();
      if (e.type !== 'TRUCK') throw new SaveError('BAD_REQUEST', e.unit + ' is a ' + e.type + ', not a TRUCK');
      if (e.status === 'INACTIVE') throw new SaveError('NOT_ALLOWED', e.unit + ' is INACTIVE in Equipment Master');
      after = { defaultTruckId: e.id };
    }
  } else if (req.action === 'setDriverAvailable') {
    after = { status: req.available ? 'ACTIVE' : 'INACTIVE', unavailableReason: req.available ? '' : (req.reason || 'Not available') };
  } else {
    after = { reliefDriver: req.relief };
  }
  const before = {};
  Object.keys(after).forEach(k => { before[k] = d[k] === undefined ? null : d[k]; });
  tx.update(ref, Object.assign({}, after, { testEdited: true, editedAt: stamp, editedBy: email }));
  queueMaster(tx, db, mode, req.requestId, '', ref, d.id, after, false, stamp, email);
  const result = { ok: true, requestId: req.requestId, runs: [] };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, driverId: d.id, before, after, result });
  return result;
}

// The truck typed on the driver list ("900001") is the unit number of an active truck in Equipment Master.
async function truckByUnit(tx, db, unit) {
  if (!unit) return '';
  const snap = await tx.get(db.collection(C.equipment).where('unit', '==', unit).limit(5));
  const truck = snap.docs.map(d => d.data()).find(e => e.type === 'TRUCK');
  if (!truck) throw new SaveError('NOT_FOUND', unit + ' is not a truck in Equipment Master');
  if (truck.status === 'INACTIVE') throw new SaveError('NOT_ALLOWED', unit + ' is INACTIVE in Equipment Master');
  return truck.id;
}

// The Edit / Add Driver panel: name, hire date, seniority date, assigned truck, relief. Same rules as
// udpoV780DriverRosterSave_; a new driver starts ACTIVE. Test copy only: DRIVERS_MASTER is not written yet.
async function saveDriver(tx, db, req, email, stamp, logRef, mode) {
  let ref, existing = null;
  if (req.driverId) {
    ref = db.collection(C.drivers).doc(M.safeIdPart(req.driverId));
    const snap = await tx.get(ref);
    if (!snap.exists) throw new SaveError('NOT_FOUND', 'Driver ' + req.driverId + ' is not in Driver Master');
    existing = snap.data();
  }
  const truckId = await truckByUnit(tx, db, req.truck);
  const after = { name: req.name, hireDate: req.hireDate, seniorityDate: req.seniorityDate, defaultTruckId: truckId, reliefDriver: req.relief };
  const result = { ok: true, requestId: req.requestId, runs: [] };
  if (existing) {
    const before = {};
    Object.keys(after).forEach(k => { before[k] = existing[k] === undefined ? null : existing[k]; });
    tx.update(ref, Object.assign({}, after, { testEdited: true, editedAt: stamp, editedBy: email }));
    queueMaster(tx, db, mode, req.requestId, '', ref, existing.id, after, false, stamp, email);
    result.driverId = existing.id;
    tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, driverId: existing.id, before, after, result });
    return result;
  }
  const id = 'drv_' + req.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) + '_' + req.requestId.slice(-6).toLowerCase();
  ref = db.collection(C.drivers).doc(M.safeIdPart(id));
  const created = Object.assign({ id, status: 'ACTIVE', employmentStatus: 'ACTIVE', unavailableReason: '', createdInApp: true, testEdited: true, createdAt: stamp, createdBy: email }, after);
  tx.set(ref, created);
  queueMaster(tx, db, mode, req.requestId, '', ref, id, Object.assign({ status: 'ACTIVE', employmentStatus: 'ACTIVE' }, after), true, stamp, email);
  result.driverId = id;
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, driverId: id, before: null, after: created, result });
  return result;
}

// Remove Selected: the drivers stay in the list as INACTIVE, never deleted (same as udpoV780DriverRosterRemove_).
async function removeDrivers(tx, db, req, email, stamp, logRef, mode) {
  const refs = req.driverIds.map(id => db.collection(C.drivers).doc(M.safeIdPart(id)));
  const snaps = await tx.getAll(...refs);
  const before = [];
  snaps.forEach((snap, i) => {
    if (!snap.exists) throw new SaveError('NOT_FOUND', 'Driver ' + req.driverIds[i] + ' is not in Driver Master');
    before.push({ driverId: req.driverIds[i], status: snap.data().status || '' });
  });
  refs.forEach((ref, i) => {
    tx.update(ref, { status: 'INACTIVE', unavailableReason: 'Removed from operational roster', testEdited: true, editedAt: stamp, editedBy: email });
    queueMaster(tx, db, mode, req.requestId, String(i), ref, snaps[i].data().id || req.driverIds[i], { status: 'INACTIVE', unavailableReason: 'Removed from operational roster' }, false, stamp, email);
  });
  const result = { ok: true, requestId: req.requestId, runs: [] };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, before, after: { status: 'INACTIVE' }, result });
  return result;
}

async function requireDriver(tx, db, driverId) {
  const snap = await tx.get(db.collection(C.drivers).doc(M.safeIdPart(driverId)));
  if (!snap.exists) throw new SaveError('NOT_FOUND', 'Driver ' + driverId + ' is not in Driver Master');
  return snap.data();
}

/* ---------- Route Editor (Route Master copy; ROUTES_MASTER itself is not written yet) ---------- */
const ROUTE_FIELDS = { route: 'text', routeName: 'text', run: 'text', loadType: 'text', movementType: 'text', coverageOwner: 'text', coverageType: 'text',
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
async function saveRoute(tx, db, req, email, stamp, logRef, mode) {
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
  const result = { ok: true, requestId: req.requestId, runs: [], runId: id };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, runId: id, before: before ? { fields: Object.keys(req.fields).reduce((o, k) => Object.assign(o, { [k]: before[k] === undefined ? null : before[k] }), {}) } : null, after: { fields: req.fields, days: req.days }, result });
  return result;
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

/*
 * Publish to Daily Dispatch. In the new app Weekly and Daily read the same runs, so every Weekly pick is already on
 * Daily; Publish records that the week was checked and sent (who and when), which the Weekly header shows.
 */
async function publishWeek(tx, db, req, email, stamp, logRef, mode) {
  const ref = db.collection(C.weeks).doc(req.weekStart);
  const snap = await tx.get(ref);
  if (!snap.exists) throw new SaveError('NOT_FOUND', 'The week of ' + req.weekStart + ' is not one of the copied Live weeks');
  const before = { publishedAt: snap.data().publishedAt || '', publishedBy: snap.data().publishedBy || '' };
  tx.update(ref, { publishedAt: stamp, publishedBy: email });
  const result = { ok: true, requestId: req.requestId, runs: [] };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, weekStart: req.weekStart, before, after: { publishedAt: stamp, publishedBy: email }, result });
  return result;
}

/*
 * Driver Weekly Template (udpoV780DriverWeeklyTemplateSave_): one driver's normal day in Driver Master: Available, Off, or the
 * runs they drive (more than one allowed). A run must be active in Route Master and run that day, and belongs to one driver a day.
 * Then, like the current save (udpoV7267DriverMasterToLive_), the copied Live weeks from this week on take the new driver on
 * those days, except days someone changed by hand (route_override).
 */
async function saveDriverTemplate(tx, db, req, email, stamp, logRef, mode) {
  const ref = db.collection(C.drivers).doc(M.safeIdPart(req.driverId));
  const snap = await tx.get(ref);
  if (!snap.exists) throw new SaveError('NOT_FOUND', 'Driver ' + req.driverId + ' is not in Driver Master');
  const d = snap.data(), p = req.day, today = L.operatingDay(new Date(stamp));
  const [routeSnap, driverSnap, runSnap] = await Promise.all([tx.get(db.collection(C.routes)), tx.get(db.collection(C.drivers)),
    tx.get(db.collection(C.runs).where('weekStart', '>=', L.weekStart(today)))]);
  const routes = {};
  routeSnap.docs.forEach(s => { const r = s.data(); routes[r.id || s.id] = r; });
  const assignments = req.runIds.map((runId, i) => {
    const r = routes[runId];
    if (!r || !L.masterActive(r)) throw new SaveError('NOT_FOUND', 'Run ' + runId + ' is not an active run in Route Master');
    if (!(r.days && r.days[p] && r.days[p].active)) throw new SaveError('NOT_ALLOWED', r.route + ' ' + (r.run || '') + ' does not run on ' + L.DAY_NAMES[L.DAYS.indexOf(p)]);
    driverSnap.docs.forEach(o => {
      const other = o.data();
      if (other.id === d.id) return;
      let list = [];
      try { list = JSON.parse((other.cells && other.cells[p + '_assignments_json']) || '[]'); } catch (e) { list = []; }
      if ((Array.isArray(list) ? list : [list]).some(a => (typeof a === 'string' ? a : a && (a.runId || a.run_id)) === runId)) throw new SaveError('CHANGED', r.route + ' on ' + L.DAY_NAMES[L.DAYS.indexOf(p)] + ' is already ' + other.name + "'s run");
    });
    return { slot: i + 1, runId, routeId: r.routeId || '', status: 'ASSIGNMENT' };
  });
  const cells = { [p + '_available']: req.status === 'OFF' ? 'FALSE' : 'TRUE', [p + '_assignments_json']: JSON.stringify(assignments), [p + '_default_route_id']: assignments.length ? assignments[0].routeId : '' };
  const before = {}, update = { testEdited: true, editedAt: stamp, editedBy: email }, fields = {};
  Object.keys(cells).forEach(k => { before[k] = d.cells && d.cells[k] !== undefined ? d.cells[k] : null; update['cells.' + k] = cells[k]; fields['cells.' + k] = cells[k]; });
  tx.update(ref, update);
  queueMaster(tx, db, mode, req.requestId, '', ref, d.id, fields, false, stamp, email);
  // The copied Live weeks from today on take the template on that day, unless the day was changed by hand.
  const result = { ok: true, requestId: req.requestId, runs: [] }, mine = new Set(req.runIds), live = [];
  runSnap.docs.forEach(s => {
    const run = s.data(), day = run.days && run.days[p], date = L.addDays(run.weekStart, L.DAYS.indexOf(p));
    if (!day || date < today || L.yes(day.routeOverride)) return;
    let after = null;
    if (mine.has(run.runId) && day.runs && day.driverId !== d.id) after = { driverId: d.id, driver: d.name };
    else if (!mine.has(run.runId) && day.driverId === d.id) after = { driverId: '', driver: '' };
    if (!after) return;
    tx.update(s.ref, { ['days.' + p + '.driverId']: after.driverId, ['days.' + p + '.driver']: after.driver, rev: run.rev + 1, testEdited: true, editedAt: stamp });
    if (mode.writeBack) queueSheetCells(tx, db, req.requestId, 't' + result.runs.length, run, s.id, p, after, stamp, email);
    result.runs.push({ runDocId: s.id, rev: run.rev + 1 });
    live.push(run.route + ' ' + date);
  });
  result.liveDays = live;
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, driverId: d.id, day: p, before, after: cells, liveDays: live, result });
  return result;
}

/*
 * Over the Road: the module's own records (the current app keeps them in its "UDPO OTR Report" workbook, never in Route Master):
 * otrRoutes (which runs count and where they go), otrMonthly (a month's figures), otrDaily (a day's count typed by hand, which wins
 * over the count from the dispatch sheet).
 */
async function saveOtr(tx, db, req, email, stamp, logRef, mode) {
  let ref, data;
  if (req.op === 'route') { ref = db.collection('otrRoutes').doc(M.safeIdPart(req.runId)); data = { runId: req.runId, include: req.include, destination: req.destination }; }
  else if (req.op === 'figure') { ref = db.collection('otrMonthly').doc(req.year + '-' + String(req.month).padStart(2, '0')); data = { year: req.year, month: req.month, [req.key]: req.value, source: 'TYPED' }; }
  else { ref = db.collection('otrDaily').doc(req.date + '__' + M.safeIdPart(req.destination)); data = { date: req.date, destination: req.destination, runs: req.runs, source: 'MANUAL' }; }
  const snap = await tx.get(ref), before = snap.exists ? snap.data() : null;
  tx.set(ref, Object.assign({}, data, { updatedAt: stamp, updatedBy: email, testEdited: mode.mode === 'test' }), { merge: true });
  const result = { ok: true, requestId: req.requestId, runs: [] };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, op: req.op, doc: ref.path, before, after: data, result });
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

// The copied Live weeks a day-off range touches (none for a range longer than ten weeks: runs exist for three weeks only).
async function runsForDays(tx, db, startDate, endDate) {
  const weeks = [];
  for (let w = L.weekStart(startDate); w <= endDate && weeks.length < 10; w = L.addDays(w, 7)) weeks.push(w);
  if (!weeks.length || L.weekStart(endDate) > weeks[weeks.length - 1]) return [];
  return (await tx.get(db.collection(C.runs).where('weekStart', 'in', weeks))).docs;
}

/*
 * The same as the current Weekly board and Daily Call-Off: a driver who is off comes off the runs they had on those
 * days, and the day shows who it was for (intendedDriver) and why (driverExceptionStatus, e.g. VACATION, so Weekly
 * shows "Vacation - Needs Driver"). Return Available puts them back where nobody was picked in the meantime.
 */
function freeRunsForDayOff(tx, db, req, runSnaps, driver, reasonCode, stamp, email, mode, result) {
  runSnaps.forEach(r => {
    const run = r.data(), update = {}, cells = {};
    L.DAYS.forEach((p, i) => {
      const d = run.days && run.days[p], date = L.addDays(run.weekStart, i);
      if (!d || !d.runs || date < req.startDate || date > req.endDate) return;
      if (reasonCode && d.driverId === driver.id) {
        Object.assign(update, { ['days.' + p + '.driverId']: '', ['days.' + p + '.driver']: '', ['days.' + p + '.intendedDriverId']: driver.id,
          ['days.' + p + '.intendedDriver']: driver.name, ['days.' + p + '.driverExceptionStatus']: reasonCode });
        cells[p] = { driverId: '', driver: '' };
      } else if (!reasonCode && d.intendedDriverId === driver.id && !d.driverId) {
        Object.assign(update, { ['days.' + p + '.driverId']: driver.id, ['days.' + p + '.driver']: driver.name, ['days.' + p + '.intendedDriverId']: '',
          ['days.' + p + '.intendedDriver']: '', ['days.' + p + '.driverExceptionStatus']: '' });
        cells[p] = { driverId: driver.id, driver: driver.name };
      }
    });
    if (!Object.keys(update).length) return;
    tx.update(r.ref, Object.assign(update, { rev: run.rev + 1, testEdited: true, editedAt: stamp }));
    result.runs.push({ runDocId: r.id, rev: run.rev + 1 });
    if (mode.writeBack) Object.keys(cells).forEach((p, i) => queueSheetCells(tx, db, req.requestId, r.id.slice(-6) + p + i, run, r.id, p, cells[p], stamp, email));
  });
}

// Exception type and reason for a day off, as Daily Dispatch > Driver Call-Off stores them (desktopUiSaveDriverExceptionGuardedV768_).
function exceptionValues(reason) {
  if (reason === 'VACATION') return { type: 'VACATION', status: 'APPROVED', reasonCode: 'VACATION' };
  if (['SICK DAY', 'BEREAVEMENT', 'UNPAID DAY'].indexOf(reason) >= 0) return { type: reason, status: 'UNAVAILABLE', reasonCode: reason };
  return { type: 'UNAVAILABLE', status: 'UNAVAILABLE', reasonCode: reason };
}

/*
 * Driver Call-Off (Daily) and Driver availability (Weekly board). UNAVAILABLE adds a day-off entry. AVAILABLE
 * ("Return Available") frees only the days given: an entry inside them is cancelled, one that starts before keeps
 * its earlier days, one that ends after keeps its later days, one around them keeps both sides. Test copy only.
 */
async function saveDriverException(tx, db, req, email, stamp, logRef, mode) {
  const driver = await requireDriver(tx, db, req.driverId);
  const result = { ok: true, requestId: req.requestId, runs: [] };
  const mine = await tx.get(db.collection(C.exceptions).where('driverId', '==', driver.id));
  const runSnaps = await runsForDays(tx, db, req.startDate, req.endDate);
  freeRunsForDayOff(tx, db, req, runSnaps, driver, req.status === 'UNAVAILABLE' ? exceptionValues(req.reason).reasonCode : '', stamp, email, mode, result);
  if (req.status === 'UNAVAILABLE') {
    const id = 'dav_' + req.requestId.slice(-12).toLowerCase();
    const v = exceptionValues(req.reason);
    const doc = { id, driverId: driver.id, startDate: req.startDate, endDate: req.endDate, type: v.type, status: v.status, reasonCode: v.reasonCode,
      notes: req.note, createdInApp: true, createdAt: stamp, createdBy: email, updatedAt: stamp, updatedBy: email };
    const exRef = db.collection(C.exceptions).doc(id);
    tx.set(exRef, doc);
    queueMaster(tx, db, mode, req.requestId, 'ex', exRef, id, { driverId: doc.driverId, startDate: doc.startDate, endDate: doc.endDate, type: doc.type, status: doc.status, reasonCode: doc.reasonCode, notes: doc.notes }, true, stamp, email);
    result.exceptionId = id;
    tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, driverId: driver.id, before: null, after: doc, result });
    return result;
  }
  const changed = [];
  const note = 'Available ' + req.startDate + (req.endDate !== req.startDate ? ' - ' + req.endDate : '') + ' from Dispatch';
  mine.docs.forEach((snap, n) => {
    const e = snap.data(), a = e.startDate, z = e.endDate || e.startDate;
    if (!a || z < req.startDate || a > req.endDate || ['CANCELLED', 'CLEARED', 'DENIED'].indexOf(String(e.status).toUpperCase()) >= 0) return;
    const base = { updatedAt: stamp, updatedBy: email, testEdited: true };
    if (a >= req.startDate && z <= req.endDate) {
      tx.update(snap.ref, Object.assign(base, { status: 'CANCELLED', decisionNotes: 'Returned available from Dispatch' }));
      queueMaster(tx, db, mode, req.requestId, 'ex' + n, snap.ref, e.id || snap.id, { status: 'CANCELLED', decisionNotes: 'Returned available from Dispatch' }, false, stamp, email);
    } else {
      const kept = Object.assign({ decisionNotes: note }, a < req.startDate ? { endDate: L.addDays(req.startDate, -1) } : { startDate: L.addDays(req.endDate, 1) });
      tx.update(snap.ref, Object.assign(base, kept));
      queueMaster(tx, db, mode, req.requestId, 'ex' + n, snap.ref, e.id || snap.id, kept, false, stamp, email);
      if (a < req.startDate && z > req.endDate) {
        const id = String(snap.id) + '_' + req.requestId.slice(-8).toLowerCase(), later = db.collection(C.exceptions).doc(id);
        const split = Object.assign({}, e, base, { id, startDate: L.addDays(req.endDate, 1), endDate: z, decisionNotes: note, createdInApp: true });
        tx.set(later, split);
        queueMaster(tx, db, mode, req.requestId, 'exs' + n, later, id, { driverId: split.driverId, startDate: split.startDate, endDate: split.endDate, type: split.type, status: split.status,
          reasonCode: split.reasonCode, notes: split.notes, decisionNotes: note, facilityId: split.facilityId }, true, stamp, email);
      }
    }
    changed.push({ id: snap.id, startDate: a, endDate: z, status: e.status });
  });
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, driverId: driver.id, before: changed, after: { available: [req.startDate, req.endDate] }, result });
  return result;
}

/*
 * Vacation Schedule entry (same rules as udpoV780VacationSave_): at most 3 drivers off a day, 2 in a holiday week;
 * a driver's own other entries do not count against them. An approved entry also puts the days off on Dispatch
 * (the vsched_ exception, as udpoV7277MirrorVacationToExceptions_ does); any other status cancels that.
 */
const VACATION_EXCEPTION = { VACATION: ['VACATION', 'VACATION'], SICK: ['SICK DAY', 'SICK DAY'], BEREAVEMENT: ['BEREAVEMENT', 'BEREAVEMENT'], UNPAID: ['UNPAID DAY', 'UNPAID DAY'], PERSONAL: ['UNAVAILABLE', 'PERSONAL DAY'] };
async function saveVacation(tx, db, req, email, stamp, logRef, mode) {
  const driver = await requireDriver(tx, db, req.driverId);
  const id = req.vacationId || 'vac_' + req.requestId.slice(-16).toLowerCase();
  const ref = db.collection(C.vacations).doc(M.safeIdPart(id));
  const existing = await tx.get(ref);
  if (req.vacationId && !existing.exists) throw new SaveError('NOT_FOUND', 'That vacation entry no longer exists');
  const vsRef = db.collection(C.exceptions).doc(M.safeIdPart('vsched_' + id));
  const vsSnap = await tx.get(vsRef);
  if (req.status === 'APPROVED') {
    const approved = await tx.get(db.collection(C.vacations).where('status', '==', 'APPROVED'));
    const others = approved.docs.map(d => Object.assign({ docId: d.id }, d.data())).filter(v => v.docId !== ref.id && v.driverId !== driver.id && v.startDate && (v.endDate || v.startDate) >= req.startDate && v.startDate <= req.endDate);
    for (let day = req.startDate; day <= req.endDate; day = L.addDays(day, 1)) {
      const off = L.vacationsOn(others, day).length, limit = L.dayLimit(day);
      if (off >= limit.maxOff) {
        throw new SaveError('NOT_ALLOWED', 'Vacation date ' + day + ' is FULL' + (limit.label ? ' during ' + limit.label + ' week. ' + off + ' employees are already scheduled off and the holiday limit is ' + limit.maxOff : '. ' + off + ' employees are already scheduled off') + '; no additional vacation can be added.');
      }
    }
  }
  const before = existing.exists ? existing.data() : null;
  const doc = { id, driverId: driver.id, startDate: req.startDate, endDate: req.endDate, status: req.status, vacationType: req.type, notes: req.notes, notificationEmail: req.email, updatedAt: stamp, updatedBy: email, testEdited: true };
  if (!existing.exists) Object.assign(doc, { createdInApp: true, createdAt: stamp, createdBy: email });
  tx.set(ref, doc, { merge: true });
  queueMaster(tx, db, mode, req.requestId, 'vac', ref, id, { driverId: doc.driverId, startDate: doc.startDate, endDate: doc.endDate, status: doc.status, vacationType: doc.vacationType, notes: doc.notes }, !existing.exists, stamp, email);
  const pair = VACATION_EXCEPTION[req.type], approved = req.status === 'APPROVED';
  const mirror = { id: 'vsched_' + id, driverId: driver.id, startDate: req.startDate, endDate: req.endDate, type: pair[0], reasonCode: pair[1],
    status: !approved ? 'CANCELLED' : pair[0] === 'VACATION' ? 'APPROVED' : 'UNAVAILABLE', notes: 'Vacation Schedule' + (req.notes ? ': ' + req.notes : '') };
  tx.set(vsRef, Object.assign({}, mirror, { updatedAt: stamp, updatedBy: email, testEdited: true }), { merge: true });
  const { id: mirrorId, ...mirrorFields } = mirror;
  queueMaster(tx, db, mode, req.requestId, 'vsched', vsRef, mirrorId, mirrorFields, !vsSnap.exists, stamp, email);
  const result = { ok: true, requestId: req.requestId, runs: [], vacationId: id };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, driverId: driver.id, before, after: doc, result });
  return result;
}

// Someone checked a sheet conflict (and fixed the sheet or the app by hand): it leaves the open list, kept for the record.
async function clearConflict(tx, db, req, email, stamp, logRef, mode) {
  const ref = db.collection(C.conflicts).doc(req.conflictId);
  const snap = await tx.get(ref);
  if (!snap.exists) throw new SaveError('NOT_FOUND', 'That conflict is no longer on the list');
  const result = { ok: true, requestId: req.requestId, runs: [] };
  if (snap.data().open === false) return result;
  tx.update(ref, { open: false, clearedAt: stamp, clearedBy: email });
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, conflictId: req.conflictId, before: { open: true }, after: { open: false }, result });
  return result;
}

module.exports = { applyAction, validate, requireTestMode, queueSheetCells, maintQueue, SaveError, ACTIONS, SAVE_ROLES, REORDER_ROLES, DRIVER_ROLES };
