/*
 * United Dairy Distribution app: driver saves (split out of actions.js, review item 81 (Joe 10/13)): the Employee Information list, Edit / Add Driver,
 * Remove Selected, the Driver Weekly Template, Driver Scorecard settings and Operational Assignments.
 */
'use strict';

const L = require('./logic');
const M = require('./model');
const { queueMaster } = require('./masterwrite');
const { SaveError, queueSheetCells } = require('./actions-common');
const { liveRead, driverToLive } = require('./actions-live');

const C = M.COLLECTIONS;

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
  // D6: a new assigned truck follows the driver onto the Current and Next Live weeks (driverToLive).
  const live = req.action === 'setDriverTruck' && after.defaultTruckId ? await liveRead(tx, db, '') : null;
  const before = {};
  Object.keys(after).forEach(k => { before[k] = d[k] === undefined ? null : d[k]; });
  tx.update(ref, Object.assign({}, after, { testEdited: true, editedAt: stamp, editedBy: email }));
  queueMaster(tx, db, mode, req.requestId, '', ref, d.id, after, false, stamp, email);
  const result = { ok: true, requestId: req.requestId, runs: [] };
  if (live) { result.liveWeeks = { updated: 0, added: 0, warnings: [] }; driverToLive(tx, db, mode, req, stamp, email, { id: d.id, name: '' }, after.defaultTruckId, live, result); }
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
  // D6: an existing driver's name and own truck reach the Current and Next Live weeks (driverToLive).
  const live = existing ? await liveRead(tx, db, '') : null;
  const after = { name: req.name, hireDate: req.hireDate, seniorityDate: req.seniorityDate, defaultTruckId: truckId, reliefDriver: req.relief };
  const result = { ok: true, requestId: req.requestId, runs: [] };
  if (existing) {
    result.liveWeeks = { updated: 0, added: 0, warnings: [] };
    driverToLive(tx, db, mode, req, stamp, email, { id: existing.id, name: req.name }, truckId, live, result);
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

// Driver Scorecard settings: scorecard/settings, read by the screen with the current app's defaults under it (scSettings_).
async function saveScorecard(tx, db, req, email, stamp, logRef, mode) {
  const ref = db.collection('scorecard').doc('settings'), snap = await tx.get(ref), before = snap.exists ? snap.data() : null;
  const data = req.callOffReasons ? { callOffReasons: req.callOffReasons } : req.kioskAreas ? { kioskAreas: req.kioskAreas } : req.countFrom ? { countFrom: req.countFrom } : { [req.key]: req.value };
  tx.set(ref, Object.assign({}, data, { updatedAt: stamp, updatedBy: email }), { merge: true });
  const result = { ok: true, requestId: req.requestId, runs: [] };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, before, after: data, result });
  return result;
}

// Truck cleanliness ratings: scorecardRatings/<driver>_<date> (one a day per driver; a second rating that day replaces it).
async function rateTruckClean(tx, db, req, email, stamp, logRef, mode) {
  const ref = db.collection('scorecardRatings').doc(M.safeIdPart(req.driverKey + '_' + req.date)), snap = await tx.get(ref), before = snap.exists ? snap.data() : null;
  const data = { kind: 'cleanliness', driverKey: req.driverKey, driver: req.driver, date: req.date, rating: req.rating, truck: req.truck, note: req.note };
  tx.set(ref, Object.assign({}, data, { ratedAt: stamp, ratedBy: email, testEdited: mode.mode === 'test' }));
  const result = { ok: true, requestId: req.requestId, runs: [] };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, before, after: data, result });
  return result;
}

// Joe 10/13: an accident / incident or a complaint, one record each (driverIncidents). It starts Under review and counts nothing
// until a manager marks it Reviewed - counts (or Reviewed - not counted). Nothing is written to Driver Master.
async function addDriverIncident(tx, db, req, email, stamp, logRef, mode) {
  const ref = db.collection('driverIncidents').doc(M.safeIdPart(req.driverKey + '_' + req.kind + '_' + req.date + '_' + String(req.requestId || Date.now()).slice(-12)));
  // A PDA is a manager's decision already: it is saved as counting, with who decided it.
  const data = { kind: req.kind, driverKey: req.driverKey, driver: req.driver, date: req.date, type: req.type, note: req.note, status: req.kind === 'pda' ? 'counts' : 'review' };
  if (req.kind === 'pda') Object.assign(data, { step: req.step, reason: req.reason, reviewedBy: email, reviewedAt: stamp });
  else if (req.kind === 'accident') Object.assign(data, { accidentClass: req.accidentClass, truck: req.truck, preventable: req.preventable });
  else Object.assign(data, { source: req.source, customer: req.customer, severity: req.severity });
  tx.set(ref, Object.assign({}, data, { enteredAt: stamp, enteredBy: email, testEdited: mode.mode === 'test' }));
  const result = { ok: true, requestId: req.requestId, runs: [], incidentId: ref.id };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, before: null, after: data, result });
  return result;
}
async function reviewDriverIncident(tx, db, req, email, stamp, logRef, mode) {
  const ref = db.collection('driverIncidents').doc(req.incidentId), snap = await tx.get(ref);
  if (!snap.exists) throw new SaveError('NOT_FOUND', 'That entry is not on the list any more');
  const before = { status: snap.data().status }, after = req.status === 'review' ? { status: 'review', reviewedBy: '', reviewedAt: '' } : { status: req.status, reviewedBy: email, reviewedAt: stamp };
  tx.update(ref, after);
  const result = { ok: true, requestId: req.requestId, runs: [] };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, before, after, result });
  return result;
}
// An excused GPS or Time miss (a hard stop for a deer): scorecardExcuses/<miss key>, with the reason and who excused it.
async function excuseScorecardMiss(tx, db, req, email, stamp, logRef, mode) {
  const ref = db.collection('scorecardExcuses').doc(M.safeIdPart(req.key)), snap = await tx.get(ref), before = snap.exists ? snap.data() : null;
  const data = req.undo ? null : { key: req.key, reason: req.reason, driverKey: req.driverKey, what: req.what };
  if (req.undo) tx.delete(ref);
  else tx.set(ref, Object.assign({}, data, { by: email, at: stamp, testEdited: mode.mode === 'test' }));
  const result = { ok: true, requestId: req.requestId, runs: [] };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, before, after: data, result });
  return result;
}

// Operational Assignments: opsAssignments/{NAME}, read by the screen and the driver lists with the current app's four under it.
async function saveOpsAssignment(tx, db, req, email, stamp, logRef, mode) {
  const ref = db.collection('opsAssignments').doc(M.safeIdPart(L.opsKey(req.assignment))), snap = await tx.get(ref), before = snap.exists ? snap.data() : null;
  const data = { assignment: req.assignment, active: req.active, sequence: req.sequence };
  tx.set(ref, Object.assign({}, data, { updatedAt: stamp, updatedBy: email, testEdited: mode.mode === 'test' }));
  const result = { ok: true, requestId: req.requestId, runs: [] };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, before, after: data, result });
  return result;
}

module.exports = { editDriver, saveDriver, removeDrivers, saveDriverTemplate, saveScorecard, rateTruckClean, addDriverIncident, reviewDriverIncident, excuseScorecardMiss, saveOpsAssignment };
