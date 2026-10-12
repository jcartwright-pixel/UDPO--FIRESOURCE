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

/* ---------- Maintenance Station (mock-up E): the tablet, like the Garage Station ---------- */
/*
 * Joe 10/12: the mechanics work the plant's work orders the way they work the garage's: the open work orders come up first with
 * no sign-in; a mechanic taps one, then their name and login ID (the same technicians and login IDs as the Garage Station), and
 * Starts their own clock. Need Parts, Add another mechanic, Stop, and Complete (what was fixed, safe to run, finger signature).
 * A PM work order completed moves the PM task's Last done to that day. + Report a Problem makes a work order; Record a Breakdown
 * puts a big one fixed on the spot (machine, down, back up, cause and fix) on the shift log, the same as Shift Notes does.
 */
const GA = () => require('./garage');
const A = () => require('./actions');
const SaveErr = (code, message) => new (A().SaveError)(code, message);
const CLOCKS = 'plantMaintClocks';
const FIXES = ['Replaced a part', 'Repaired', 'Adjusted', 'Cleaned', 'Lubricated', 'PM done', 'Nothing wrong'];
const STATION_OPS = ['START', 'HELPER', 'PARTS', 'RESUME', 'STOP', 'DONE', 'REPORT', 'BREAKDOWN'];
const SIGNATURE_MAX = 30000;
const short = (v, max) => text(v).replace(/\s+/g, ' ').slice(0, max);
const nyDay = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const laborOf = (o) => (Array.isArray(o.labor) ? o.labor : []).filter(s => s && s.tech_id).map(s => ({ tech_id: String(s.tech_id), name: String(s.name || ''), start: String(s.start || ''), end: String(s.end || ''), minutes: Number(s.minutes) || 0 }));
const joinNames = (list) => list.filter((n, i) => n && list.indexOf(n) === i).join(', ');
const FROM_WORD = { SHIFT_NOTES: 'Request from the plant', PM: 'PM', MAINTENANCE: 'Reported by maintenance' };

// A work order as the tablet shows it.
function stationJob(o) {
  const labor = laborOf(o);
  return { id: o.id, woNumber: text(o.woNumber), unit: text(o.machine) || 'Plant', area: text(o.area), problem: text(o.problem), source: text(o.source), from: FROM_WORD[o.source] || 'Work order',
    urgency: text(o.urgency), createdAt: text(o.createdAt), canRun: text(o.lineDown).toUpperCase() !== 'YES', status: text(o.status).toUpperCase() || 'NEW', pm: !!o.pmTaskId,
    onNow: labor.filter(s => !s.end).map(s => ({ id: s.tech_id, name: s.name, since: s.start })), labor: labor.filter(s => s.end).map(s => ({ name: s.name, minutes: s.minutes })),
    laborMinutes: labor.reduce((n, s) => n + (s.end ? s.minutes : 0), 0) };
}

async function stationBoard(db, input, nowMs) {
  const facilityId = plantOf(input.facilityId || 'fac_uniontown', A().SaveError);
  const techs = GA().activeTechs((await db.collection('garageTechs').get()).docs.map(d => d.data()));
  const setup = (await db.collection('plantSetup').where('type', '==', 'PRODUCTION_AREA').get()).docs.map(d => d.data());
  const saved = (await db.collection('plantMachines').where('facilityId', '==', facilityId).get()).docs.map(d => Object.assign({ id: d.id }, d.data()));
  const orders = (await db.collection('plantWorkOrders').where('facilityId', '==', facilityId).get()).docs.map(d => Object.assign({}, d.data(), { id: d.id }));
  const clocks = {};
  (await db.collection(CLOCKS).get()).docs.forEach(d => { const c = d.data(); if (c.techId && c.facilityId === facilityId) clocks[c.techId] = c; });
  const rank = (j) => (j.canRun ? 1 : 0) + (j.status === 'PARTS' ? 2 : 0);
  const jobs = orders.filter(o => R.isOpen(o)).map(stationJob).sort((a, b) => rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt));
  const open = {}; jobs.forEach(j => { open[j.id] = j; });
  const today = nyDay(nowMs);
  return { techs: techs.map(t => { const c = clocks[t.id], j = c && open[c.workOrderId]; return Object.assign({}, t, { on: j ? { id: j.id, unit: j.woNumber + ' ' + j.unit, since: c.since } : null }); }),
    jobs, doneToday: orders.filter(o => text(o.status).toUpperCase() === 'DONE' && o.completedAt && nyDay(Date.parse(o.completedAt)) === today).length,
    machines: R.machines(setup, saved, facilityId, false).map(m => ({ id: m.id, name: m.name, area: m.area })), fixes: FIXES, now: new Date(nowMs).toISOString() };
}

function validateStation(input) {
  const op = short(input.step, 12).toUpperCase();
  if (STATION_OPS.indexOf(op) < 0) throw SaveErr('BAD_REQUEST', 'Maintenance: unknown step ' + (op || '(none)') + '.');
  const requestId = short(input.requestId, 80);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) throw SaveErr('BAD_REQUEST', 'Each step needs a requestId');
  const out = { op, requestId, facilityId: plantOf(input.facilityId || 'fac_uniontown', A().SaveError), id: short(input.id, 120) };
  if (op === 'REPORT' || op === 'BREAKDOWN') {
    out.machineId = short(input.machineId, 120);
    if (!/^[A-Za-z0-9_-]+$/.test(out.machineId)) throw SaveErr('BAD_REQUEST', 'Tap the machine.');
  }
  if (op === 'REPORT') {
    out.problem = short(input.problem, 300);
    if (!out.problem) throw SaveErr('BAD_REQUEST', 'Type what\'s wrong.');
    if (typeof input.lineDown !== 'boolean') throw SaveErr('BAD_REQUEST', 'Tap Yes or No for "Is the line down?".');
    out.lineDown = input.lineDown;
    return out;
  }
  if (op === 'BREAKDOWN') {
    out.downAt = short(input.downAt, 5); out.upAt = short(input.upAt, 5);
    if (!/^\d{1,2}:\d\d$/.test(out.downAt)) throw SaveErr('BAD_REQUEST', 'Enter when it went down.');
    if (out.upAt && !/^\d{1,2}:\d\d$/.test(out.upAt)) throw SaveErr('BAD_REQUEST', 'Back up at must be a time.');
    out.cause = short(input.cause, 1000); out.fix = short(input.fix, 1000);
    if (!out.cause) throw SaveErr('BAD_REQUEST', 'Type what happened.');
    return out;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(out.id)) throw SaveErr('BAD_REQUEST', 'That work order is not on the list any more. Go back to Work Orders.');
  if (op === 'DONE') {
    out.fixed = short(input.fixed, 40);
    if (FIXES.indexOf(out.fixed) < 0) throw SaveErr('BAD_REQUEST', 'Tap what you fixed.');
    if (typeof input.safe !== 'boolean') throw SaveErr('BAD_REQUEST', 'Tap Yes or No for "Safe to run?".');
    out.safe = input.safe;
    out.note = short(input.note, 300);
    out.signature = String(input.signature || '');
    if (out.signature.length > SIGNATURE_MAX || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(out.signature)) throw SaveErr('BAD_REQUEST', 'Sign with your finger in the box.');
  }
  return out;
}

async function stationStep(db, input, nowMs) {
  const req = validateStation(input);
  const stamp = new Date(nowMs).toISOString();
  return db.runTransaction(async tx => {
    const logRef = db.collection('actions').doc(req.requestId), logSnap = await tx.get(logRef);
    if (logSnap.exists) return Object.assign({}, logSnap.data().result, { repeated: true });
    const people = await GA().signedInTechs(tx, db, input.tokens, nowMs);
    if (!people.length) throw SaveErr('NOT_ALLOWED', 'GARAGE_SIGN_IN_REQUIRED: Tap your name and enter your login ID.');
    const names = people.map(p => p.name), by = 'maintenance:' + names.join('+');
    const mode = await A().requireTestMode(tx, db, 'plant');
    const renewAll = () => GA().renew((r, d) => tx.update(r, d), people, nowMs);
    const result = { ok: true, requestId: req.requestId };

    if (req.op === 'REPORT' || req.op === 'BREAKDOWN') {
      const all = await plantMachines(tx, db, req.facilityId), m = all.find(x => x.id === req.machineId && x.status !== 'RETIRED');
      if (!m) throw SaveErr('NOT_FOUND', 'That machine is not on this plant\'s list.');
      if (req.op === 'REPORT') {
        const num = await nextNumber(tx, db, req.facilityId), ref = db.collection('plantWorkOrders').doc(docId('MT_' + req.requestId));
        const wo = { woNumber: R.woNumber(num.n), facilityId: req.facilityId, machineId: m.id, machine: m.name, area: m.area || '', problem: req.problem, notes: '', lineDown: req.lineDown ? 'YES' : 'NO',
          type: 'Maintenance', urgency: '', source: 'MAINTENANCE', status: 'NEW', labor: [], createdAt: stamp, createdBy: by, updatedAt: stamp, updatedBy: by, testEdited: true };
        num.write(stamp);
        renewAll();
        tx.set(ref, wo);
        result.job = stationJob(Object.assign({ id: ref.id }, wo));
        result.message = wo.woNumber + ' ' + m.name + ' is on the work orders.';
        tx.set(logRef, { action: 'maintReport', by, at: stamp, mode: mode.mode, workOrderId: ref.id, after: wo, result });
        return result;
      }
      // Record a Breakdown: the same entry Shift Notes makes, so it shows on Shift Notes, the machine's history and down time.
      const now = new Date(stamp), entryId = 'SHIFT-' + req.requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 30);
      const values = Object.assign({ Entry: req.cause, Type: 'Breakdown', Equipment: m.name }, req.upAt ? { UpAt: req.upAt } : {}, req.fix ? { Fix: req.fix } : {});
      const status = req.upAt ? 'RESOLVED' : 'OPEN', shift = PR.shiftAt(now.getTime());
      const payload = { entryId, date: L.operatingDay(now), shift, section: 'HANDOFF', readingTime: req.downAt, values, notes: '', followUpStatus: status, facilityId: req.facilityId };
      const docName = PR.SHIFT_TYPE + '_app_' + entryId.replace(/[^A-Za-z0-9]/g, '');
      renewAll();
      tx.set(db.collection('plantJournal').doc(docName), { recordId: entryId, type: PR.SHIFT_TYPE, date: payload.date, status, shift, area: 'HANDOFF', notes: '', payload, facilityId: req.facilityId,
        recordedAt: stamp, recordedBy: by, createdInApp: true, testEdited: true, editedAt: stamp });
      result.entryId = entryId;
      result.message = 'Breakdown on ' + m.name + ' recorded.';
      tx.set(logRef, { action: 'maintBreakdown', by, at: stamp, mode: mode.mode, entryId, after: payload, result });
      return result;
    }

    const ref = db.collection('plantWorkOrders').doc(req.id), snap = await tx.get(ref);
    if (!snap.exists || text(snap.data().facilityId) !== req.facilityId) throw SaveErr('NOT_FOUND', 'That work order is not on the list any more. Go back to Work Orders.');
    const order = Object.assign({}, snap.data(), { id: ref.id });
    if (!R.isOpen(order)) throw SaveErr('NOT_ALLOWED', 'That work order is already finished.');
    const finishing = req.op === 'DONE' && req.safe;
    let taskRef = null, task = null;
    if (finishing && order.pmTaskId) { taskRef = db.collection('plantPmTasks').doc(docId(order.pmTaskId)); const t = await tx.get(taskRef); task = t.exists ? t.data() : null; }

    // The clocks: each signed-in mechanic's own (one plant job at a time), and every clock still running on this job.
    const labor = laborOf(order);
    const clockIds = people.map(p => p.id).concat(labor.filter(s => !s.end).map(s => s.tech_id)).filter((v, i, a) => a.indexOf(v) === i);
    const clockRefs = clockIds.map(id => db.collection(CLOCKS).doc(docId(id)));
    const clockSnaps = clockRefs.length ? await tx.getAll(...clockRefs) : [];
    const clocks = {}; clockSnaps.forEach((s, i) => { clocks[clockIds[i]] = { ref: clockRefs[i], data: s.exists ? s.data() : null }; });
    const starting = ['START', 'HELPER', 'RESUME'].indexOf(req.op) >= 0;
    const elsewhere = starting ? people.map(p => clocks[p.id].data).filter(c => c && c.workOrderId && c.workOrderId !== ref.id) : [];
    const otherIds = elsewhere.map(c => c.workOrderId).filter((v, i, a) => a.indexOf(v) === i);
    const otherRefs = otherIds.map(id => db.collection('plantWorkOrders').doc(docId(id)));
    const otherSnaps = otherRefs.length ? await tx.getAll(...otherRefs) : [];

    const minutesFrom = (iso) => Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60000)) || 0;
    const closeClock = (list, techId) => list.forEach(s => { if (s.tech_id === techId && !s.end) { s.end = stamp; s.minutes = minutesFrom(s.start); } });
    const laborFields = (list) => ({ labor: list, onNow: joinNames(list.filter(s => !s.end).map(s => s.name)), laborMinutes: list.reduce((n, s) => n + (s.end ? s.minutes : 0), 0) });
    const writes = [];
    if (starting) {
      people.forEach(p => {
        if (labor.some(s => s.tech_id === p.id && !s.end)) return;
        labor.push({ tech_id: p.id, name: p.name, start: stamp, end: '', minutes: 0 });
        writes.push(['set', clocks[p.id].ref, { techId: p.id, name: p.name, facilityId: req.facilityId, workOrderId: ref.id, machine: text(order.machine), since: stamp }]);
      });
      otherSnaps.forEach((s, i) => {
        if (!s.exists) return;
        const list = laborOf(s.data()), moving = people.filter(p => clocks[p.id].data && clocks[p.id].data.workOrderId === otherIds[i]);
        moving.forEach(p => closeClock(list, p.id));
        writes.push(['update', otherRefs[i], Object.assign(laborFields(list), { updatedAt: stamp, updatedBy: by, testEdited: true })]);
        result.stoppedOn = (result.stoppedOn || []).concat(text(s.data().woNumber) || otherIds[i]);
      });
    } else if (req.op === 'STOP' || req.op === 'PARTS' || finishing) {
      const who = req.op === 'STOP' ? people.map(p => p.id) : labor.filter(s => !s.end).map(s => s.tech_id);
      who.forEach(id => {
        closeClock(labor, id);
        const c = clocks[id] && clocks[id].data;
        if (c && c.workOrderId === ref.id) writes.push(['delete', clocks[id].ref]);
      });
    }

    const was = text(order.status).toUpperCase() || 'NEW', techs = text(order.techs).split(/\s*,\s*/).filter(Boolean);
    const change = Object.assign({ techs: joinNames(techs.concat(names)), startedAt: order.startedAt || stamp, updatedAt: stamp, updatedBy: by, testEdited: true }, laborFields(labor));
    if (req.op === 'STOP' && was === 'NEW') change.status = 'WORKING';
    if (req.op === 'START' || req.op === 'HELPER') change.status = was === 'PARTS' ? 'PARTS' : 'WORKING';
    if (req.op === 'PARTS') Object.assign(change, { status: 'PARTS', partsAt: stamp });
    if (req.op === 'RESUME') change.status = 'WORKING';
    if (req.op === 'DONE') {
      Object.assign(change, { fixed: req.fixed, fixedNote: req.note ? req.fixed + ': ' + req.note : req.fixed, safe: req.safe ? 'YES' : 'NO', signedBy: names[0], signature: req.signature });
      if (!req.safe) Object.assign(change, { status: 'WORKING', lineDown: 'YES' });
      else Object.assign(change, { status: 'DONE', lineDown: 'NO', completedAt: stamp, completedBy: names[0], minutes: minutesFrom(change.startedAt) });
    }
    tx.update(ref, change);
    renewAll();
    writes.forEach(([kind, r, d]) => { if (kind === 'delete') tx.delete(r); else if (kind === 'set') tx.set(r, d); else tx.update(r, d); });
    if (taskRef && task && task.status !== 'REMOVED') {
      // A PM done: Last done is today, and the next one is counted from it.
      const today = nyDay(nowMs);
      const move = { lastDone: today, nextDue: R.nextDue(today, task.every, task.unit), lastWorkOrderId: ref.id, sentWorkOrderId: '', sentWoNumber: '', updatedAt: stamp, updatedBy: by, testEdited: true };
      tx.update(taskRef, move);
      result.pm = move;
    }
    result.job = stationJob(Object.assign({}, order, change));
    const logged = Object.assign({}, change); if (logged.signature) logged.signature = '(signature, ' + logged.signature.length + ' characters)';
    tx.set(logRef, { action: 'maint' + req.op, by, at: stamp, mode: mode.mode, workOrderId: ref.id, after: logged, result });
    return result;
  });
}

module.exports = { stationBoard, stationStep, FIXES, validateMachine, saveMachine, validateSend, makeWorkOrder, woIdFor, validatePmTask, savePmTask, validateSendPm, sendPmToMaintenance };
