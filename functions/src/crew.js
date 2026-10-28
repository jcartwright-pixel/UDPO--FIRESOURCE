/*
 * Plant Vacations & Schedule (Joe 10/25, mock-ups 1 and 3): the plant's crew and Plant Maintenance's mechanics, by team.
 * The rules are crew-rules.js (shared with the screens). Everything here is kept in the app only (no sheet).
 *
 * saveCrewSetup     Setup (also under Administration): an area and its shift times, a job and how many it needs, a person,
 *                   the vacation limits; and, on the test copy only, a made-up starting list (op 'starter'). On the
 *                   Maintenance Schedule, a mechanic's Maintenance Station login ID (op 'login', Joe 10/27; plantmaint.js).
 * saveCrewDay       Schedule Board: one person's job (or Off) on one day of one week; '' puts them back on their usual.
 * saveCrewVacation  Vacations: one person's time off, with the driver Vacation Schedule's rules counted by area and shift.
 */
'use strict';

const R = require('./crew-rules');
const L = require('./logic');

const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
const docId = (id) => String(id).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 200);
const isId = (v) => /^[A-Za-z0-9_-]{1,200}$/.test(text(v));
const projectId = () => process.env.GCLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId;
const TEST_PROJECTS = ['ud-distribution-sandbox', 'demo-ud-distribution'];

function base(input, SaveError) {
  const facilityId = text(input.facilityId), team = text(input.team);
  if ((L.PLANTS || []).map(p => p.id).indexOf(facilityId) < 0) throw new SaveError('BAD_REQUEST', 'Pick a plant.');
  if (!R.TEAMS[team]) throw new SaveError('BAD_REQUEST', 'Pick the plant crew or maintenance.');
  return { facilityId, team };
}
const count = (v, SaveError, what) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 50) throw new SaveError('BAD_REQUEST', what + ' must be a whole number from 0 to 50.');
  return n;
};
const daysList = (v, SaveError) => {
  if (!Array.isArray(v) || v.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw new SaveError('BAD_REQUEST', 'Pick the days.');
  return [...new Set(v)].sort();
};

function validateSetup(input, SaveError) {
  const out = base(input, SaveError);
  out.op = text(input.op);
  if (['area', 'job', 'person', 'rules', 'starter', 'login'].indexOf(out.op) < 0) throw new SaveError('BAD_REQUEST', 'Unknown setup.');
  out.id = text(input.id);
  if (out.id && !isId(out.id)) throw new SaveError('BAD_REQUEST', 'Pick the line to change.');
  const status = text(input.status).toUpperCase();
  if (status && ['ACTIVE', 'RETIRED'].indexOf(status) < 0) throw new SaveError('BAD_REQUEST', 'A line is in use or taken off.');
  out.status = status;
  const f = input.fields && typeof input.fields === 'object' ? input.fields : {}, o = {};
  if (out.op === 'login') {
    if (out.team !== 'maint') throw new SaveError('BAD_REQUEST', 'Login IDs are for the maintenance mechanics.');
    if (!out.id) throw new SaveError('BAD_REQUEST', 'Pick the mechanic.');
    out.loginId = text(input.loginId);
    if (!/^\d{5,6}$/.test(out.loginId)) throw new SaveError('BAD_REQUEST', 'The login ID is 5 or 6 digits.');
    out.fields = {};
    return out;
  }
  if (out.op === 'area') {
    if (f.name !== undefined) o.name = text(f.name).slice(0, 40);
    if (f.order !== undefined) o.order = count(f.order, SaveError, 'The order');
    if (f.days !== undefined) o.days = daysList(f.days, SaveError);
    if (f.shifts !== undefined) {
      if (!f.shifts || typeof f.shifts !== 'object') throw new SaveError('BAD_REQUEST', 'Type the shift times.');
      o.shifts = {};
      R.SHIFTS.forEach(n => {
        const s = f.shifts[n] || f.shifts[String(n)];
        if (!s || (!text(s.start) && !text(s.end))) return;
        if (!R.isTime(s.start) || !R.isTime(s.end)) throw new SaveError('BAD_REQUEST', 'Each shift needs a start and an end time.');
        o.shifts[n] = { start: text(s.start), end: text(s.end) };
      });
    }
  } else if (out.op === 'job') {
    if (f.name !== undefined) o.name = text(f.name).slice(0, 50);
    if (f.areaId !== undefined) { if (!isId(f.areaId)) throw new SaveError('BAD_REQUEST', 'Pick the area.'); o.areaId = text(f.areaId); }
    if (f.order !== undefined) o.order = count(f.order, SaveError, 'The order');
    if (f.relief !== undefined) o.relief = f.relief === true;
    if (f.need !== undefined) {
      if (!f.need || typeof f.need !== 'object') throw new SaveError('BAD_REQUEST', 'Type how many people the job needs.');
      o.need = {};
      R.SHIFTS.forEach(n => { o.need[n] = count(f.need[n] === undefined ? f.need[String(n)] || 0 : f.need[n], SaveError, 'People needed'); });
    }
  } else if (out.op === 'person') {
    Object.keys(f).forEach(k => { if (R.PERSON_FIELDS.indexOf(k) < 0) throw new SaveError('BAD_REQUEST', 'Unknown box: ' + k); });
    if (f.name !== undefined) o.name = text(f.name).toUpperCase().slice(0, 60);
    if (f.employeeId !== undefined) o.employeeId = text(f.employeeId).slice(0, 20);
    if (f.phone !== undefined) o.phone = text(f.phone).slice(0, 20);
    if (f.areaId !== undefined) { if (f.areaId && !isId(f.areaId)) throw new SaveError('BAD_REQUEST', 'Pick the area.'); o.areaId = text(f.areaId); }
    if (f.jobId !== undefined) { if (f.jobId && !isId(f.jobId)) throw new SaveError('BAD_REQUEST', 'Pick the job.'); o.jobId = text(f.jobId); }
    if (f.shift !== undefined) { const s = Number(f.shift); if (R.SHIFTS.indexOf(s) < 0) throw new SaveError('BAD_REQUEST', 'Pick the shift.'); o.shift = s; }
    if (f.daysOff !== undefined) o.daysOff = daysList(f.daysOff, SaveError);
    if (f.hireDate !== undefined) { if (f.hireDate && !R.isDay(f.hireDate)) throw new SaveError('BAD_REQUEST', 'The hire date must be a date.'); o.hireDate = text(f.hireDate); }
  } else if (out.op === 'rules') {
    if (f.maxOff !== undefined) o.maxOff = count(f.maxOff, SaveError, 'How many may be off');
    if (f.holidayMaxOff !== undefined) o.holidayMaxOff = count(f.holidayMaxOff, SaveError, 'How many may be off in a holiday week');
  }
  out.fields = o;
  if ((out.op === 'area' || out.op === 'job' || out.op === 'person') && !out.id && !o.name) throw new SaveError('BAD_REQUEST', 'Type the name first.');
  if (out.id && o.name !== undefined && !o.name) throw new SaveError('BAD_REQUEST', 'A name cannot be blank.');
  if (out.op === 'job' && !out.id && !o.areaId) throw new SaveError('BAD_REQUEST', 'Pick the area first.');
  if (out.op !== 'starter' && !Object.keys(o).length && !out.status) throw new SaveError('BAD_REQUEST', 'Nothing to save.');
  return out;
}

const COLL = { area: 'crewAreas', job: 'crewJobs', person: 'crewPeople' };
const mineOf = async (tx, db, coll, req) => (await tx.get(db.collection(coll).where('facilityId', '==', req.facilityId))).docs
  .map(d => Object.assign({}, d.data(), { id: d.id })).filter(d => d.team === req.team);

async function saveSetup(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const stampIt = { updatedAt: stamp, updatedBy: email, testEdited: true };
  if (req.op === 'starter') {
    // Joe 10/25: real people are uploaded later; the test copy can start from made-up people.
    if (TEST_PROJECTS.indexOf(projectId()) < 0) throw new SaveError('NOT_ALLOWED', 'The made-up starting list is for the test copy only.');
    const had = await mineOf(tx, db, 'crewPeople', req);
    if (had.length) throw new SaveError('NOT_ALLOWED', 'This list already has people.');
    const s = R.starter(req.facilityId, req.team), own = { facilityId: req.facilityId, team: req.team, status: 'ACTIVE', madeUp: true, createdAt: stamp, createdBy: email };
    s.areas.forEach(a => tx.set(db.collection('crewAreas').doc(docId(a.id)), Object.assign({}, a, own, stampIt)));
    s.jobs.forEach(j => tx.set(db.collection('crewJobs').doc(docId(j.id)), Object.assign({}, j, own, stampIt)));
    s.people.forEach(p => tx.set(db.collection('crewPeople').doc(docId(p.id)), Object.assign({}, p, own, stampIt)));
    const result = { ok: true, requestId: req.requestId, message: 'Made-up starting list added: ' + s.people.length + ' people.' };
    tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, facilityId: req.facilityId, team: req.team, op: 'starter', result });
    return result;
  }
  if (req.op === 'login') {
    const ref = db.collection('crewPeople').doc(docId(req.id)), had = await tx.get(ref), was = had.exists ? had.data() : null;
    if (!was || was.facilityId !== req.facilityId || was.team !== req.team) throw new SaveError('NOT_FOUND', 'That person is not on this list.');
    const write = await require('./plantmaint').setMechanicLogin(tx, db, req.facilityId, req.id, req.loginId, stamp, email);
    write();
    tx.update(ref, Object.assign({ loginSet: true, loginSetAt: stamp }, stampIt));
    const result = { ok: true, requestId: req.requestId, id: req.id, message: was.name + ': login ID saved.' };
    // The login ID itself is never logged.
    tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, facilityId: req.facilityId, team: req.team, op: 'login', id: req.id, result });
    return result;
  }
  if (req.op === 'rules') {
    const ref = db.collection('crewRules').doc(docId(req.facilityId + '_' + req.team)), had = await tx.get(ref), before = had.exists ? had.data() : null;
    const after = Object.assign({ facilityId: req.facilityId, team: req.team }, before || {}, req.fields, stampIt);
    tx.set(ref, after);
    const result = { ok: true, requestId: req.requestId, message: 'Vacation limits saved.' };
    tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, facilityId: req.facilityId, team: req.team, op: 'rules', before, after, result });
    return result;
  }
  const coll = COLL[req.op], all = await mineOf(tx, db, coll, req);
  let id = req.id, was = id ? all.find(x => x.id === id) : null;
  if (id && !was) throw new SaveError('NOT_FOUND', 'That line is no longer on the list.');
  const name = req.fields.name !== undefined ? req.fields.name : was ? was.name : '';
  const twin = req.op !== 'person' && all.find(x => x.id !== id && R.active(x) && text(x.name).toUpperCase() === name.toUpperCase() &&
    (req.op === 'area' || (req.fields.areaId || (was && was.areaId)) === x.areaId));
  if (twin && (!was || req.fields.name !== undefined)) throw new SaveError('BAD_REQUEST', name + ' is already on the list.');
  if (req.op === 'job' || req.op === 'person') {
    const areas = req.op === 'job' || req.fields.areaId ? await mineOf(tx, db, 'crewAreas', req) : [];
    if (req.fields.areaId && !areas.some(a => a.id === req.fields.areaId)) throw new SaveError('BAD_REQUEST', 'Pick one of this list\'s areas.');
    if (req.op === 'person' && req.fields.jobId) {
      const jobs = await mineOf(tx, db, 'crewJobs', req);
      if (!jobs.some(j => j.id === req.fields.jobId)) throw new SaveError('BAD_REQUEST', 'Pick one of this list\'s jobs.');
    }
  }
  if (!id) {
    id = docId(req.facilityId + '_' + req.team + '_' + req.op + '_' + (req.op === 'person' ? req.requestId.slice(-10) : R.slug(name) || req.op));
    if (all.some(x => x.id === id)) id = docId(id + '_' + req.requestId.slice(-6));
  }
  const ref = db.collection(coll).doc(id), had = await tx.get(ref), before = had.exists ? had.data() : null;
  const after = Object.assign({ facilityId: req.facilityId, team: req.team, status: 'ACTIVE', createdAt: stamp, createdBy: email },
    req.op === 'person' ? { shift: 1, daysOff: [0, 6] } : req.op === 'area' ? { shifts: {}, days: [1, 2, 3, 4, 5], order: all.length + 1 } : { need: { 1: 1, 2: 0, 3: 0 }, relief: false, order: all.length + 1 },
    before || {}, req.fields, req.status ? { status: req.status } : {}, stampIt);
  tx.set(ref, after);
  const result = { ok: true, requestId: req.requestId, id, created: !was, message: name + (was ? ' saved.' : ' added.') };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, facilityId: req.facilityId, team: req.team, op: req.op, id, before, after, result });
  return result;
}

function validateDay(input, SaveError) {
  const out = base(input, SaveError);
  out.personId = text(input.personId);
  if (!isId(out.personId)) throw new SaveError('BAD_REQUEST', 'Pick the person.');
  out.day = text(input.day);
  if (!R.isDay(out.day)) throw new SaveError('BAD_REQUEST', 'Pick the day.');
  out.value = text(input.value);
  if (out.value && out.value !== R.OFF && !isId(out.value)) throw new SaveError('BAD_REQUEST', 'Pick the job.');
  return out;
}

async function saveDay(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const pRef = db.collection('crewPeople').doc(req.personId), p = await tx.get(pRef);
  if (!p.exists || p.data().facilityId !== req.facilityId || p.data().team !== req.team) throw new SaveError('NOT_FOUND', 'That person is not on this list.');
  if (req.value && req.value !== R.OFF) {
    const j = await tx.get(db.collection('crewJobs').doc(req.value));
    if (!j.exists || j.data().facilityId !== req.facilityId || j.data().team !== req.team) throw new SaveError('BAD_REQUEST', 'Pick one of this list\'s jobs.');
  }
  const start = R.weekStart(req.day), ref = db.collection('crewWeeks').doc(docId(R.weekId(req.personId, start))), had = await tx.get(ref);
  const before = had.exists ? had.data() : null, days = Object.assign({}, (before && before.days) || {});
  if (req.value) days[req.day] = req.value; else delete days[req.day];
  const after = { facilityId: req.facilityId, team: req.team, personId: req.personId, weekStart: start, days, updatedAt: stamp, updatedBy: email, testEdited: true };
  tx.set(ref, after);
  const result = { ok: true, requestId: req.requestId, message: 'Saved.' };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, facilityId: req.facilityId, team: req.team, personId: req.personId, day: req.day, before, after, result });
  return result;
}

function validateVacation(input, SaveError) {
  const out = base(input, SaveError);
  out.vacationId = text(input.vacationId);
  if (out.vacationId && !isId(out.vacationId)) throw new SaveError('BAD_REQUEST', 'Pick the time off to change.');
  out.personId = text(input.personId);
  if (!isId(out.personId)) throw new SaveError('BAD_REQUEST', 'Pick the person.');
  out.startDate = text(input.startDate); out.endDate = text(input.endDate) || out.startDate;
  if (!R.isDay(out.startDate) || !R.isDay(out.endDate)) throw new SaveError('BAD_REQUEST', 'Pick the first and last day.');
  if (out.endDate < out.startDate) throw new SaveError('BAD_REQUEST', 'The last day is before the first day.');
  if (R.vacationDays(out) > 60) throw new SaveError('BAD_REQUEST', 'Time off is at most 60 days at a time.');
  out.type = text(input.type).toUpperCase() || 'VACATION';
  if (R.VAC_TYPES.indexOf(out.type) < 0) throw new SaveError('BAD_REQUEST', 'Pick the kind of day off.');
  out.status = text(input.status).toUpperCase() || 'APPROVED';
  if (R.VAC_STATUSES.indexOf(out.status) < 0) throw new SaveError('BAD_REQUEST', 'Pick the status.');
  out.notes = text(input.notes).slice(0, 300);
  return out;
}

async function saveVacation(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const people = await mineOf(tx, db, 'crewPeople', req), person = people.find(p => p.id === req.personId);
  if (!person) throw new SaveError('NOT_FOUND', 'That person is not on this list.');
  const vacs = await mineOf(tx, db, 'crewVacations', req);
  const id = req.vacationId || docId(req.facilityId + '_' + req.team + '_vac_' + req.requestId.slice(-12));
  const was = vacs.find(v => v.id === id) || null;
  if (req.vacationId && !was) throw new SaveError('NOT_FOUND', 'That time off is no longer on the list.');
  const others = vacs.filter(v => v.id !== id);
  if (req.status !== 'CANCELLED' && req.status !== 'DENIED') {
    const clash = others.find(v => v.personId === person.id && v.status !== 'CANCELLED' && v.status !== 'DENIED' && v.startDate <= req.endDate && (v.endDate || v.startDate) >= req.startDate);
    if (clash) throw new SaveError('NOT_ALLOWED', person.name + ' is already off ' + clash.startDate + (clash.endDate !== clash.startDate ? ' to ' + clash.endDate : '') + '. Change that one instead.');
  }
  if (req.status === 'APPROVED') {
    const rulesSnap = await tx.get(db.collection('crewRules').doc(docId(req.facilityId + '_' + req.team))), rules = rulesSnap.exists ? rulesSnap.data() : R.RULES;
    for (let day = req.startDate; day <= req.endDate; day = R.addDays(day, 1)) {
      const holiday = L.dayLimit(day).label, limit = R.offLimit(rules, holiday), off = R.offCount(others, people, person, day);
      if (off >= limit) throw new SaveError('NOT_ALLOWED', day + ' is full for ' + person.name + '\'s area and shift' + (holiday ? ' (' + holiday + ' week)' : '') + ': ' + off + ' already off, the limit is ' + limit + '.');
    }
  }
  const ref = db.collection('crewVacations').doc(id), before = was ? Object.assign({}, was) : null;
  if (before) delete before.id;
  const after = Object.assign({ facilityId: req.facilityId, team: req.team, createdAt: stamp, createdBy: email }, before || {},
    { personId: person.id, startDate: req.startDate, endDate: req.endDate, type: req.type, status: req.status, notes: req.notes, updatedAt: stamp, updatedBy: email, testEdited: true });
  tx.set(ref, after);
  const result = { ok: true, requestId: req.requestId, vacationId: id, message: 'Time off saved.' };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, facilityId: req.facilityId, team: req.team, vacationId: id, before, after, result });
  return result;
}

// Joe 10/28 (gz): Case Unloading's "Unloaded By" suggests the plant's people (names only; no ID or phone leaves the server).
// The list is written LAST, FIRST; the tablet shows First Last. Plant Maintenance's mechanics and lines taken off are left out.
const nice = (w) => (w === w.toUpperCase() ? w.toLowerCase().replace(/(^|[\s'-])\S/g, c => c.toUpperCase()) : w);
function shownName(name) {
  const t = text(name).replace(/\s+/g, ' ');
  const m = /^([^,]+),\s*(.+)$/.exec(t);
  return nice(m ? m[2] + ' ' + m[1] : t);
}
async function plantNames(db, facilityId) {
  const people = (await db.collection('crewPeople').where('facilityId', '==', facilityId).get()).docs.map(d => d.data());
  const names = people.filter(p => p.team !== 'maint' && text(p.status).toUpperCase() !== 'RETIRED' && text(p.name)).map(p => shownName(p.name).slice(0, 60));
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

module.exports = { validateSetup, saveSetup, validateDay, saveDay, validateVacation, saveVacation, plantNames, shownName };
