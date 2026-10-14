/*
 * United Dairy Distribution app: days off (split out of actions.js, review item 81 (Joe 10/13)): Driver Call-Off / availability and the Vacation Schedule.
 */
'use strict';

const L = require('./logic');
const M = require('./model');
const { queueMaster } = require('./masterwrite');
const { SaveError, queueSheetCells } = require('./actions-common');

const C = M.COLLECTIONS;

async function requireDriver(tx, db, driverId) {
  const snap = await tx.get(db.collection(C.drivers).doc(M.safeIdPart(driverId)));
  if (!snap.exists) throw new SaveError('NOT_FOUND', 'Driver ' + driverId + ' is not in Driver Master');
  return snap.data();
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
    // Each part is named by the whole run ID (its week too), so the same run in this week and next never shares one (review item 65).
    if (mode.writeBack) Object.keys(cells).forEach((p, i) => queueSheetCells(tx, db, req.requestId, r.id + '-' + p + i, run, r.id, p, cells[p], stamp, email));
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
const usDay = (key) => { const [y, m, d] = String(key).split('-'); return Number(m) + '/' + Number(d) + '/' + y; };
const VACATION_EXCEPTION = { VACATION: ['VACATION', 'VACATION'], SICK: ['SICK DAY', 'SICK DAY'], BEREAVEMENT: ['BEREAVEMENT', 'BEREAVEMENT'], UNPAID: ['UNPAID DAY', 'UNPAID DAY'], PERSONAL: ['UNAVAILABLE', 'PERSONAL DAY'] };
async function saveVacation(tx, db, req, email, stamp, logRef, mode) {
  const driver = await requireDriver(tx, db, req.driverId);
  const id = req.vacationId || 'vac_' + req.requestId.slice(-16).toLowerCase();
  const ref = db.collection(C.vacations).doc(M.safeIdPart(id));
  const existing = await tx.get(ref);
  if (req.vacationId && !existing.exists) throw new SaveError('NOT_FOUND', 'That vacation entry no longer exists');
  const vsRef = db.collection(C.exceptions).doc(M.safeIdPart('vsched_' + id));
  const vsSnap = await tx.get(vsRef);
  // The same driver cannot be off twice for the same day (the current app refuses it: "X is already off ... Edit that entry instead").
  if (req.status !== 'CANCELLED' && req.status !== 'DENIED') {
    const mine = await tx.get(db.collection(C.vacations).where('driverId', '==', driver.id));
    const clash = mine.docs.map(d => Object.assign({ docId: d.id }, d.data())).find(v => v.docId !== ref.id && v.status !== 'CANCELLED' && v.status !== 'DENIED' && v.startDate && v.startDate <= req.endDate && (v.endDate || v.startDate) >= req.startDate);
    if (clash) throw new SaveError('NOT_ALLOWED', (driver.name || driver.id) + ' is already off ' + usDay(clash.startDate) + (clash.endDate && clash.endDate !== clash.startDate ? ' – ' + usDay(clash.endDate) : '') + '. Edit that entry instead.');
  }
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

module.exports = { saveDriverException, saveVacation };
