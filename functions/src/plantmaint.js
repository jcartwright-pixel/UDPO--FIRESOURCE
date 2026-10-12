/*
 * Plant Maintenance (Joe 10/12: like the garage work orders, but for the plant's machinery; the plant side and maintenance
 * talk to each other, and everything is kept on record). The rules are pmaint-rules.js.
 *
 * saveMachine        Machinery: add a machine, or change one box of a machine (each box saves when it is left). A production
 *                    line is already a machine; what is saved about it goes on a plantMachines record with the line's id.
 * makeWorkOrder      Maintenance Center: a plant's maintenance request (a Shift Notes entry) becomes a work order (plantWorkOrders),
 *                    once per entry, numbered M-1001 on. Joe 10/12: big breakdowns are fixed on the spot and only recorded; issues
 *                    that can wait are requested.
 * savePmTask         PM Schedule: add a PM task to a machine (what, how often, when last done) or change one box of it.
 * sendPmToMaintenance PM Schedule: a PM task due becomes a work order, once per due day.
 */
'use strict';

const R = require('./pmaint-rules');
const PR = require('./plant-rules');
const L = require('./logic');

const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
const docId = (id) => String(id).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 200);
const slug = (v) => text(v).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50);
const LIMIT = { name: 60, area: 60, kind: 30, make: 60, model: 60, serial: 60, location: 80, installed: 10, notes: 500 };
const plantIds = () => (L.PLANTS || []).map(p => p.id);

function plantOf(v, SaveError) {
  const id = text(v);
  if (plantIds().indexOf(id) < 0) throw new SaveError('BAD_REQUEST', 'Pick a plant.');
  return id;
}

function validateMachine(input, SaveError) {
  const out = { facilityId: plantOf(input.facilityId, SaveError), machineId: text(input.machineId).slice(0, 120), fields: {} };
  if (out.machineId && !/^[A-Za-z0-9_-]+$/.test(out.machineId)) throw new SaveError('BAD_REQUEST', 'Pick a machine.');
  const f = input.fields && typeof input.fields === 'object' ? input.fields : {};
  Object.keys(f).forEach(k => {
    if (R.FIELDS.indexOf(k) < 0) throw new SaveError('BAD_REQUEST', 'Unknown machine box: ' + k);
    out.fields[k] = text(f[k]).slice(0, LIMIT[k]);
  });
  if (f.kind !== undefined && out.fields.kind && R.KINDS.indexOf(out.fields.kind) < 0) throw new SaveError('BAD_REQUEST', 'Pick what kind of machine it is.');
  if (out.fields.installed && !/^\d{4}-\d\d-\d\d$/.test(out.fields.installed)) throw new SaveError('BAD_REQUEST', 'Installed must be a date.');
  const status = text(input.status).toUpperCase();
  if (status && ['ACTIVE', 'RETIRED'].indexOf(status) < 0) throw new SaveError('BAD_REQUEST', 'A machine is in service or retired.');
  out.status = status;
  if (!out.machineId && !out.fields.name) throw new SaveError('BAD_REQUEST', 'Type the machine\'s name.');
  if (out.machineId && f.name !== undefined && !out.fields.name) throw new SaveError('BAD_REQUEST', 'A machine needs a name.');
  if (!Object.keys(out.fields).length && !out.status) throw new SaveError('BAD_REQUEST', 'Nothing to save.');
  return out;
}

// The plant's machines as they stand (lines and added machines, retired too), read inside the save.
async function plantMachines(tx, db, facilityId) {
  const setup = (await tx.get(db.collection('plantSetup').where('type', '==', 'PRODUCTION_AREA'))).docs.map(d => d.data());
  const saved = (await tx.get(db.collection('plantMachines').where('facilityId', '==', facilityId))).docs.map(d => Object.assign({ id: d.id }, d.data()));
  return R.machines(setup, saved, facilityId, true);
}

async function saveMachine(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const all = await plantMachines(tx, db, req.facilityId);
  let id = req.machineId, was = id ? all.find(m => m.id === id) : null;
  if (id && !was) throw new SaveError('NOT_FOUND', 'That machine is not on this plant\'s list.');
  if (was && was.line && req.fields.name !== undefined && req.fields.name !== was.name) throw new SaveError('BAD_REQUEST', was.name + ' is a production line; its name comes from Plant Operations.');
  const name = req.fields.name !== undefined ? req.fields.name : was ? was.name : '';
  const twin = all.find(m => m.id !== id && m.status !== 'RETIRED' && m.name.toUpperCase() === name.toUpperCase());
  if (twin && (!was || req.fields.name !== undefined)) throw new SaveError('BAD_REQUEST', name + ' is already on this plant\'s machinery list.');
  if (!id) {
    id = docId(req.facilityId + '_mach_' + (slug(name) || 'machine'));
    if (all.some(m => m.id === id)) id = docId(id + '_' + req.requestId.slice(-6));
  }
  const ref = db.collection('plantMachines').doc(id), had = await tx.get(ref), before = had.exists ? had.data() : null;
  const after = Object.assign({ facilityId: req.facilityId, machineId: id, line: !!(was && was.line), createdAt: stamp, createdBy: email }, before || {}, req.fields,
    req.status ? { status: req.status } : {}, { updatedAt: stamp, updatedBy: email, testEdited: true });
  if (!after.status) after.status = 'ACTIVE';
  if (was && was.line) after.name = was.name;
  if (!after.kind) after.kind = was && was.line ? 'Production line' : 'Machine';
  tx.set(ref, after);
  const result = { ok: true, requestId: req.requestId, machineId: id, created: !was, message: was ? name + ' saved.' : name + ' added to the machinery list.' };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, machineId: id, facilityId: req.facilityId, before, after, result });
  return result;
}

function validateSend(input, SaveError) {
  const entryId = text(input.entryId).slice(0, 80);
  if (!/^[A-Za-z0-9_-]+$/.test(entryId)) throw new SaveError('BAD_REQUEST', 'Pick the request.');
  const lineDown = text(input.lineDown).toUpperCase() || 'NO';
  if (['YES', 'NO'].indexOf(lineDown) < 0) throw new SaveError('BAD_REQUEST', 'Say whether the line is down.');
  return { entryId, lineDown, note: text(input.note).slice(0, 500) };
}

// The shift note's own work order (one per entry), so sending twice never makes two.
const woIdFor = (entryId) => docId('SN_' + entryId);

// The next work order number of the plant (M-1001 on), counted in the same save.
async function nextNumber(tx, db, facilityId) {
  const ref = db.collection('plantMaintCounters').doc(facilityId), counter = await tx.get(ref);
  const n = Math.max(R.FIRST_WO, Number(counter.exists && counter.data().next) || R.FIRST_WO);
  return { n, write: (stamp) => tx.set(ref, { facilityId, next: n + 1, updatedAt: stamp }, { merge: true }) };
}

async function makeWorkOrder(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const found = (await tx.get(db.collection('plantJournal').where('recordId', '==', req.entryId))).docs.map(d => d.data()).filter(d => text(d.type).toUpperCase() === PR.SHIFT_TYPE);
  const note = found[0], p = (note && note.payload) || {}, v = p.values || {};
  if (!note || v.ParentId || text(v.Type).toUpperCase() === 'REVIEW') throw new SaveError('NOT_FOUND', 'That entry is no longer on the log.');
  const ref = db.collection('plantWorkOrders').doc(woIdFor(req.entryId)), had = await tx.get(ref);
  if (had.exists) {
    const wo = had.data();
    return { ok: true, requestId: req.requestId, workOrderId: ref.id, woNumber: wo.woNumber, already: true, message: 'Already work order ' + wo.woNumber + '.' };
  }
  const facilityId = text(note.facilityId || p.facilityId) || 'fac_uniontown';
  const all = await plantMachines(tx, db, facilityId);
  const num = await nextNumber(tx, db, facilityId), n = num.n;
  const words = text(v.Equipment), m = R.findMachine(all, words);
  const wo = { woNumber: R.woNumber(n), facilityId, machineId: m ? m.id : '', machine: m ? m.name : words, area: m ? m.area : '', problem: text(v.Entry) || text(p.notes || note.notes),
    notes: req.note, lineDown: req.lineDown, type: text(v.Type) || 'Maintenance Request', urgency: text(v.Urgency), source: 'SHIFT_NOTES', sourceEntryId: req.entryId, sourceShift: text(p.shift || note.shift), sourceAt: text(note.recordedAt),
    sourceBy: text(note.recordedBy), status: 'NEW', labor: [], createdAt: stamp, createdBy: email, updatedAt: stamp, updatedBy: email, testEdited: true };
  num.write(stamp);
  tx.set(ref, wo);
  const result = { ok: true, requestId: req.requestId, workOrderId: ref.id, woNumber: wo.woNumber, machineId: wo.machineId, message: 'Work order ' + wo.woNumber + (wo.machine ? ' for ' + wo.machine : '') + ' made.' };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, entryId: req.entryId, workOrderId: ref.id, before: null, after: wo, result });
  return result;
}

/* ---------- PM Schedule ---------- */

const PM_LIMIT = { task: 120, notes: 500 };
function validatePmTask(input, SaveError) {
  const out = { facilityId: plantOf(input.facilityId, SaveError), taskId: text(input.taskId).slice(0, 120), fields: {} };
  if (out.taskId && !/^[A-Za-z0-9_-]+$/.test(out.taskId)) throw new SaveError('BAD_REQUEST', 'Pick a PM task.');
  const f = input.fields && typeof input.fields === 'object' ? input.fields : {};
  Object.keys(f).forEach(k => {
    if (['machineId', 'task', 'every', 'unit', 'lastDone', 'notes'].indexOf(k) < 0) throw new SaveError('BAD_REQUEST', 'Unknown PM box: ' + k);
  });
  if (f.machineId !== undefined) { out.fields.machineId = text(f.machineId).slice(0, 120); if (!/^[A-Za-z0-9_-]+$/.test(out.fields.machineId)) throw new SaveError('BAD_REQUEST', 'Pick the machine.'); }
  if (f.task !== undefined) { out.fields.task = text(f.task).slice(0, PM_LIMIT.task); if (!out.fields.task) throw new SaveError('BAD_REQUEST', 'Type what the PM is.'); }
  if (f.notes !== undefined) out.fields.notes = text(f.notes).slice(0, PM_LIMIT.notes);
  if (f.every !== undefined) { const n = Number(f.every); if (!Number.isInteger(n) || n < 1 || n > 999) throw new SaveError('BAD_REQUEST', 'How often must be a whole number from 1 to 999.'); out.fields.every = n; }
  if (f.unit !== undefined) { out.fields.unit = text(f.unit).toUpperCase(); if (R.UNITS.indexOf(out.fields.unit) < 0) throw new SaveError('BAD_REQUEST', 'Pick days, weeks or months.'); }
  if (f.lastDone !== undefined) { out.fields.lastDone = text(f.lastDone); if (out.fields.lastDone && !/^\d{4}-\d\d-\d\d$/.test(out.fields.lastDone)) throw new SaveError('BAD_REQUEST', 'Last done must be a date.'); }
  const status = text(input.status).toUpperCase();
  if (status && ['ACTIVE', 'REMOVED'].indexOf(status) < 0) throw new SaveError('BAD_REQUEST', 'A PM task is kept or removed.');
  out.status = status;
  if (!out.taskId && (!out.fields.machineId || !out.fields.task)) throw new SaveError('BAD_REQUEST', 'Pick the machine and type what the PM is.');
  if (!Object.keys(out.fields).length && !out.status) throw new SaveError('BAD_REQUEST', 'Nothing to save.');
  return out;
}
async function savePmTask(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const all = await plantMachines(tx, db, req.facilityId);
  const id = req.taskId || docId(req.facilityId + '_pm_' + req.requestId.replace(/[^A-Za-z0-9]/g, '').slice(-16));
  const ref = db.collection('plantPmTasks').doc(id), had = await tx.get(ref), before = had.exists ? had.data() : null;
  if (req.taskId && (!before || before.facilityId !== req.facilityId)) throw new SaveError('NOT_FOUND', 'That PM task is not on this plant\'s schedule.');
  const machineId = req.fields.machineId !== undefined ? req.fields.machineId : before.machineId, m = all.find(x => x.id === machineId);
  if (!m) throw new SaveError('NOT_FOUND', 'That machine is not on this plant\'s list.');
  const after = Object.assign({ facilityId: req.facilityId, taskId: id, every: 1, unit: 'MONTHS', lastDone: '', status: 'ACTIVE', createdAt: stamp, createdBy: email }, before || {}, req.fields,
    req.status ? { status: req.status } : {}, { machine: m.name, updatedAt: stamp, updatedBy: email, testEdited: true });
  after.nextDue = R.nextDue(after.lastDone, after.every, after.unit);
  tx.set(ref, after);
  const result = { ok: true, requestId: req.requestId, taskId: id, created: !before, nextDue: after.nextDue, message: m.name + ': ' + after.task + (before ? ' saved.' : ' added to the PM schedule.') };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, taskId: id, facilityId: req.facilityId, before, after, result });
  return result;
}

function validateSendPm(input, SaveError) {
  const taskId = text(input.taskId).slice(0, 120);
  if (!/^[A-Za-z0-9_-]+$/.test(taskId)) throw new SaveError('BAD_REQUEST', 'Pick the PM task to send.');
  return { taskId };
}
async function sendPmToMaintenance(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const t = await tx.get(db.collection('plantPmTasks').doc(req.taskId)), task = t.exists ? t.data() : null;
  if (!task || task.status === 'REMOVED') throw new SaveError('NOT_FOUND', 'That PM task is no longer on the schedule.');
  const due = task.nextDue || task.lastDone || stamp.slice(0, 10);
  const ref = db.collection('plantWorkOrders').doc(docId('PM_' + req.taskId + '_' + (task.nextDue || 'first'))), had = await tx.get(ref);
  if (had.exists && R.isOpen(had.data())) return { ok: true, requestId: req.requestId, workOrderId: ref.id, woNumber: had.data().woNumber, already: true, message: 'Already sent to maintenance as ' + had.data().woNumber + '.' };
  if (had.exists) throw new SaveError('CONFLICT', 'This PM was already done for ' + due + '.');
  const all = await plantMachines(tx, db, task.facilityId), m = all.find(x => x.id === task.machineId) || { id: task.machineId, name: task.machine, area: '' };
  const num = await nextNumber(tx, db, task.facilityId);
  const wo = { woNumber: R.woNumber(num.n), facilityId: task.facilityId, machineId: m.id, machine: m.name, area: m.area || '', problem: 'PM: ' + task.task, notes: text(task.notes), lineDown: 'NO', type: 'PM',
    source: 'PM', pmTaskId: req.taskId, pmDue: task.nextDue || '', status: 'NEW', labor: [], createdAt: stamp, createdBy: email, updatedAt: stamp, updatedBy: email, testEdited: true };
  num.write(stamp);
  tx.set(ref, wo);
  tx.update(t.ref, { sentWorkOrderId: ref.id, sentWoNumber: wo.woNumber, sentAt: stamp, sentBy: email });
  const result = { ok: true, requestId: req.requestId, workOrderId: ref.id, woNumber: wo.woNumber, message: m.name + ' PM sent to maintenance as ' + wo.woNumber + '.' };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, taskId: req.taskId, workOrderId: ref.id, before: null, after: wo, result });
  return result;
}

module.exports = { validateMachine, saveMachine, validateSend, makeWorkOrder, woIdFor, validatePmTask, savePmTask, validateSendPm, sendPmToMaintenance };
