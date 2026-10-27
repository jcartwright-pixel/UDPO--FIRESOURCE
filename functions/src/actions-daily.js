/*
 * United Dairy Distribution app: Daily Dispatch saves (split out of actions.js, review item 81 (Joe 10/13)): Move to another day, Down Trucks /
 * Trailers, the Equipment Issues buttons, and the load order (Daily and the Loadout Center).
 */
'use strict';

const L = require('./logic');
const M = require('./model');
const { queueMaster } = require('./masterwrite');
const MAINT = require('./maintenance');
const BOARD = require('./board-rules');
const R = require('./plant-rules');
const { SaveError, queueSheetCells } = require('./actions-common');

const C = M.COLLECTIONS;

/*
 * MOVE TO ANOTHER DAY (Daily edit, udpoV7273MoveDailyRun_): the run is turned on for the new day with nothing
 * assigned, and the old day becomes NO RUN with its driver, truck and trailer cleared. Both in one save.
 */
async function moveRun(tx, db, req, email, stamp, logRef, mode) {
  const fromRef = db.collection(C.runs).doc(req.runDocId);
  const fromSnap = await tx.get(fromRef);
  if (!fromSnap.exists) throw new SaveError('NOT_FOUND', 'That run is no longer in this week\'s loads. Refresh the screen.');
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
  // Joe 10/21: the plant's own Add Load copy of the load moves to the new day with it (read now, written below).
  const plantCopy = await require('./plant').scheduledForRun(tx, db, from.runId, from.days[req.day].deliveryDate || fromDate);
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
  if (plantCopy.length) result.plantMoved = require('./plant').followRun(tx, db, plantCopy, req.toDate, email, stamp);
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
  if (req.clearOnly && !L.unitOff(unit)) throw new SaveError('CHANGED', unit.unit + ' is not on the down list any more');
  // The server's operating day (it rolls at 6 AM), never the tablet's (review item 71).
  const today = L.operatingDay(new Date(stamp));
  const weeks = [L.weekStart(today), L.addDays(L.weekStart(today), 7)];
  const runs = await tx.get(db.collection(C.runs).where('weekStart', 'in', weeks));
  const idKey = unit.type === 'TRAILER' ? 'trailerId' : 'truckId', textKey = unit.type === 'TRAILER' ? 'trailer' : 'truck';
  const removed = [], taken = [], kept = [];
  runs.docs.forEach(r => {
    const run = r.data(), update = {}, cells = {};
    L.DAYS.forEach((p, i) => {
      const d = run.days && run.days[p];
      // A load holding only the unit's number (no ID: typed in the sheet, or Route Master's default) loses it too (Joe 10/23, T-532).
      if (!d || L.unitOnLoad([unit], unit.type === 'TRAILER' ? 'TRAILER' : 'TRUCK', d[idKey], d[textKey]) !== unit || L.addDays(run.weekStart, i) < today) return;
      // A load already loaded keeps its unit: the product is on that trailer (review item 71).
      if (BOARD.boardState(d) === 'LOADED') { kept.push({ route: String(run.route || ''), run: String(run.run || ''), date: L.addDays(run.weekStart, i) }); return; }
      update['days.' + p + '.' + idKey] = ''; update['days.' + p + '.' + textKey] = '';
      cells[p] = true;
      removed.push(run.route + ' ' + L.addDays(run.weekStart, i));
      taken.push({ route: String(run.route || ''), run: String(run.run || ''), date: L.addDays(run.weekStart, i) });
    });
    if (!Object.keys(update).length) return;
    tx.update(r.ref, Object.assign(update, { rev: run.rev + 1, testEdited: true, editedAt: stamp }));
    result.runs.push({ runDocId: r.id, rev: run.rev + 1 });
    // Each part is named by the whole run ID (its week too), so the same run in this week and next never shares one (review item 65).
    if (mode.writeBack) Object.keys(cells).forEach((p, i) => queueSheetCells(tx, db, req.requestId, r.id + '-' + p + i, run, r.id, p, { [idKey]: '', [textKey]: '' }, stamp, email));
  });
  const downNote = req.reason ? 'DOWN: ' + req.reason : 'DOWN';
  if (!req.clearOnly) {
    tx.update(ref, { status: 'DOWN', notes: downNote, downSince: stamp, testEdited: true, editedAt: stamp, editedBy: email });
    queueMaster(tx, db, mode, req.requestId, 'unit', ref, unit.id, { status: 'DOWN', notes: downNote }, false, stamp, email);
  }
  result.removedFrom = removed;
  result.taken = taken.sort((a, b) => a.date.localeCompare(b.date) || a.route.localeCompare(b.route, undefined, { numeric: true }));
  if (kept.length) result.keptOnLoaded = kept;
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, equipmentId: unit.id, before: { status: unit.status, notes: unit.notes || '' },
    after: req.clearOnly ? { status: unit.status, clearOnly: true, removedFrom: removed } : { status: 'DOWN', reason: req.reason, removedFrom: removed }, result });
  return result;
}

/*
 * Equipment Issues buttons (036_V740_MaintenanceRepositoryService.gs): Repaired, Reviewed, Remove and To garage, each one save on
 * the write-up. Repaired: COMPLETE, available, not out of service, completed at / by. Remove keeps the row as REMOVED with who and
 * when (never deleted). To garage adds one note, once, and makes the write-up's Garage work order (Joe 10/14). Reviewed only moves a NEEDS_REVIEW write-up that has text to OPEN.
 */
async function updateIssue(tx, db, req, email, stamp, logRef, mode) {
  const ref = db.collection(C.maintenance).doc(MAINT.docId(req.recordId));
  const snap = await tx.get(ref);
  if (!snap.exists) throw new SaveError('NOT_FOUND', 'That write-up is no longer on the list');
  const r = snap.data(), notes = String(r.notes || '').trim(), add = (line) => (notes ? notes + '\n' : '') + line;
  // Joe 10/14: Garage makes the write-up's work order; Repaired and Remove close it (garage.js writeUpOrderStep, reads first).
  const order = await require('./garage').writeUpOrderStep(tx, db, r, req.step, email, stamp);
  let change;
  if (req.step === 'repaired') change = { status: 'COMPLETE', available: 'TRUE', out_of_service: 'FALSE', completed_at: stamp, completed_by: email, resolution: 'COMPLETED', resolution_notes: req.note || '' };
  else if (req.step === 'remove') change = { status: 'REMOVED', resolution: 'REMOVED', resolution_notes: req.note || 'Removed: not a real unit or not a write-up', notes: add('Removed by ' + email + ' at ' + stamp) };
  else if (req.step === 'garage') {
    if (L.garageSent(notes)) {
      // Sent before Garage made work orders: the work order is made now, once.
      if (order && order.created) {
        order.apply(tx);
        const made = { ok: true, requestId: req.requestId, runs: [], workOrderId: order.workOrderId, message: 'Already sent to the garage. Work order ' + order.workOrderId + ' made.' };
        tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, recordId: r.record_id, before: {}, after: { workOrderId: order.workOrderId }, result: made });
        return made;
      }
      return Object.assign({ ok: true, requestId: req.requestId, runs: [], message: 'Already sent to the garage.' }, order ? { workOrderId: order.workOrderId } : {});
    }
    change = { notes: add('Sent to garage ' + stamp + ' by ' + email) };
  } else if (req.step === 'lessor') {
    // Joe 10/10: a truck write-up goes to our garage or to the company that leases the truck. This marks it sent to the lessor
    // (named in the note) once; the email itself goes out after the save (admintools.afterSave, Administration > Repair Email).
    if (String(r.kind || '').toUpperCase() !== 'TRUCK') throw new SaveError('NOT_ALLOWED', 'Only a truck write-up goes to a lessor');
    const lessor = String(req.note || '').replace(/[\n|]+/g, ' ').trim().slice(0, 40);
    if (!lessor) throw new SaveError('BAD_REQUEST', 'Say which lessor');
    // Joe 10/25 ("the 876 email didn't get sent ... How can I send it now?"): pressing Lessor again on one whose email never
    // went sends the email again (afterSave); once the email went, it is already sent. One sent with a blank body (before the
    // 6.62 fix, L.repairEmailSent) counts as never sent.
    if (notes.indexOf('Sent to lessor') >= 0) return { ok: true, requestId: req.requestId, runs: [], message: L.repairEmailSent(notes) || /Repair email queued/.test(notes) ? 'Already sent to the lessor.' : 'Emailing the lessor again.' };
    change = { notes: add('Sent to lessor ' + lessor + ' ' + stamp + ' by ' + email) };
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
  if (order) {
    order.apply(tx);
    result.workOrderId = order.workOrderId;
    if (order.closed) result.workOrdersClosed = order.closed;
  }
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
    if (!snap.exists) throw new SaveError('NOT_FOUND', 'A load in the list is no longer in this week\'s loads. Refresh the screen.');
    runs[ids[i]] = snap.data();
  });
  const targets = req.order.map(item => {
    const run = runs[item.runDocId], day = run.days && run.days[item.day];
    if (!day || !day.runs || !L.loadBlocksFor(Object.assign({}, run, { id: item.runDocId }), req.loadDate).some(b => b.prefix === item.day)) {
      throw new SaveError('NOT_FOUND', run.route + ' ' + run.run + ' does not load on ' + req.loadDate);
    }
    return { item, run, seq: L.effectiveSequence(day) };
  });
  // Joe 10/27 (Skip went "clear down to the bottom of the list"): a Skip is worked out here from the order the loads have now,
  // whatever order the screen sent: the load goes down one place, past the next load not loaded yet, and at most
  // R.SKIP_LIMIT times in a row.
  let skips = 0;
  if (req.action === 'reorderPlantLoads' && req.moved && req.moved.how === 'SKIP') {
    const dayOf = (t) => t.run.days[t.item.day];
    const isDone = (d) => !!d.completeTime || d.loadedComplete === true || ['COMPLETE', 'COMPLETED', 'LOADED', 'READY'].indexOf(String(d.loadStatus || '').trim().toUpperCase()) >= 0;
    const now = targets.slice().sort((a, b) => (a.seq == null ? 999999 : Number(a.seq)) - (b.seq == null ? 999999 : Number(b.seq)) ||
      String(a.run.route).localeCompare(String(b.run.route), undefined, { numeric: true }));
    const from = now.findIndex(t => t.item.runDocId === req.moved.runDocId && t.item.day === req.moved.day), me = now[from], d = dayOf(me);
    const label = 'Route ' + L.routeNumber(me.run.route);
    if (isDone(d) || d.plantStartedAt || ['LOADING', 'PAUSED'].indexOf(String(d.loadStatus || '').trim().toUpperCase()) >= 0) throw new SaveError('NOT_ALLOWED', label + ' is already loading, so it cannot be skipped');
    let to = from + 1;
    while (to < now.length && isDone(dayOf(now[to]))) to++;
    if (to >= now.length) throw new SaveError('NOT_ALLOWED', label + ' is the last load still to load, so it cannot be skipped');
    skips = R.skipsInARow(d.moveMark, req.loadDate, now.map(t => dayOf(t).plantStartedAt));
    if (skips >= R.SKIP_LIMIT) throw new SaveError('NOT_ALLOWED', R.skipWhy(label));
    skips += 1;
    now.splice(to, 0, now.splice(from, 1)[0]);
    targets.splice(0, targets.length, ...now);
  }
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
    // Joe 10/16 ("noted, just like manually moving the sequence, that it was moved, and then who did it"): app-only, never on the sheet.
    if (req.moved && req.saver && req.moved.runDocId === t.item.runDocId && req.moved.day === t.item.day) {
      u['days.' + t.item.day + '.moveMark'] = Object.assign({ how: req.moved.how, savedAt: stamp, by: email, name: req.saver.name || '', via: req.saver.station ? 'TABLET' : 'DESK', station: req.saver.station || '' }, skips ? { skips } : {});
    }
    before.push({ runDocId: t.item.runDocId, day: t.item.day, loadSequence: t.seq });
    after.push({ runDocId: t.item.runDocId, day: t.item.day, loadSequence: slots[i] });
  });
  const result = { ok: true, requestId: req.requestId, runs: [] };
  Object.keys(updates).forEach(id => {
    const rev = runs[id].rev + 1;
    tx.update(refs[id], Object.assign(updates[id], { rev, testEdited: true, editedAt: stamp }));
    result.runs.push({ runDocId: id, rev });
  });
  tx.set(logRef, Object.assign({ action: req.action, by: email, at: stamp, mode: mode.mode, loadDate: req.loadDate, before, after, result }, req.moved ? { moved: req.moved } : {}));
  return result;
}

module.exports = { moveRun, setUnitDown, updateIssue, reorder };
