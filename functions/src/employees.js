/*
 * Employees list (Joe 10/31, mock-ups 1 to 4, "hj"): every plant's employees, brought over from UDMS (United Dairy Management
 * System, its own Firebase project) every 15 minutes. Only name, employee ID, position, hire date and phone come across, with
 * the branch (to pick the plant) and whether the person still works there. UDMS keeps much more on the same record (birthday,
 * address, Social Security number); the read asks the database for the safe fields by name (UDMS_FIELDS), so nothing else
 * ever reaches this server, and pick() keeps only those again.
 *
 *   runEmployeeSync  one pass: read UDMS, then in each plant's own database bring employees/{id} in step, and the plant
 *                    schedule people and drivers who carry the same employee ID (their name, hire date and, on the schedules,
 *                    phone follow UDMS). Writes config/employees: when it last checked, and any problem in plain words.
 *   employeeFor      a save (Add Driver, + Add Person) reads the picked employee from the plant's own list.
 */
'use strict';

const L = require('./logic');
const SMS = require('./sms');

// The only fields read from a UDMS employee record. Never add a private field (dob, address, ssn, masterRow, emergency...).
const UDMS_FIELDS = Object.freeze(['firstName', 'lastName', 'preferredName', 'suffix', 'phone',
  'current.employeeId', 'current.jobTitle', 'current.hireDate', 'current.location', 'current.workStatus', 'current.active', 'current.termDate']);
const PRIVATE = /dob|birth|ssn|social|address|zip|city|emergency|license|drug|master|notes|email|pay/i;

// UDMS Firebase project, and which of its databases each Operations copy reads (practice copy -> UDMS practice database).
const UDMS_PROJECT = 'udms-bfccd';
const udmsDatabase = (project) => (project === 'ud-distribution' ? '(default)' : 'sandbox');

const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
// The same Employee ID with or without leading zeros (as the Upload Center, Joe 10/17).
const idKey = (v) => text(v).replace(/^0+(?=.)/, '').toUpperCase();
const docId = (v) => 'emp_' + idKey(v).replace(/[^A-Z0-9_-]+/g, '_').slice(0, 60);
const isoDay = (v) => {
  if (!v) return '';
  if (typeof v.toDate === 'function') v = v.toDate();
  const k = L.dateKey(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(k || '') ? k : '';
};

// One UDMS record -> the employee line, or null (no Employee ID, or no name). Only the safe fields are read.
function pick(rec) {
  const r = rec || {}, cur = r.current || {};
  const employeeId = text(cur.employeeId);
  const last = text(r.lastName), first = text(r.preferredName) || text(r.firstName);
  if (!employeeId || !(last || first)) return null;
  const status = text(cur.workStatus) || 'Active';
  const active = cur.active === undefined ? /^active$/i.test(status) : cur.active === true;
  return {
    employeeId, name: (last && first ? last + (text(r.suffix) ? ' ' + text(r.suffix) : '') + ', ' + first : last || first).toUpperCase().slice(0, 60),
    position: text(cur.jobTitle).slice(0, 60), hireDate: isoDay(cur.hireDate), phone: SMS.phoneText(r.phone) || '',
    branch: text(cur.location).slice(0, 60), active, status: active ? 'ACTIVE' : 'LEFT', leftDate: active ? '' : isoDay(cur.termDate)
  };
}

// The plant a UDMS branch belongs to: "Uniontown PA Branch" -> Uniontown.
function plantOfBranch(branch) {
  const b = text(branch).toUpperCase();
  const p = (L.PLANTS || []).find(x => b === x.name.toUpperCase() || b.indexOf(x.name.toUpperCase() + ' ') === 0);
  return p ? p.id : '';
}

// Reads UDMS (safe fields only). udmsDb is a Firestore for the UDMS project (tests pass their own).
async function readUdms(udmsDb) {
  const snap = await udmsDb.collection('people').select(...UDMS_FIELDS).get();
  return snap.docs.map(d => pick(d.data())).filter(Boolean);
}

const SAME = ['name', 'position', 'hireDate', 'phone', 'branch', 'active', 'status', 'leftDate'];
const changed = (a, b, keys) => keys.some(k => (a || {})[k] !== (b || {})[k]);

/*
 * One plant: bring its employees/{id} in step with the UDMS list (people who left stay, marked LEFT; nobody is deleted),
 * then the people who carry an employee's ID: on the plant and maintenance schedules their name, phone and hire date; on
 * the Driver Roster their name and hire date (the driver's mobile phone for texts stays the roster's own). Each change is
 * logged in actions like a save.
 */
async function syncPlant(db, facilityId, list, stamp) {
  const mine = list.filter(e => plantOfBranch(e.branch) === facilityId);
  const had = {};
  (await db.collection('employees').get()).docs.forEach(d => { had[d.id] = d.data(); });
  const byKey = {};
  mine.forEach(e => { const k = idKey(e.employeeId); if (!byKey[k] || (e.active && !byKey[k].active)) byKey[k] = e; });
  const writes = [], log = { added: 0, changed: 0, left: 0, linked: 0 };
  Object.keys(byKey).forEach(k => {
    const e = byKey[k], id = docId(k), was = had[id];
    if (was && !changed(was, e, SAME)) return;
    if (!was) log.added++; else if (was.active && !e.active) log.left++; else log.changed++;
    writes.push([db.collection('employees').doc(id), Object.assign({ facilityId, source: 'UDMS', createdAt: (was && was.createdAt) || stamp }, e, { idKey: k, updatedAt: stamp })]);
  });
  // Someone taken off UDMS altogether (not just marked as left) is kept, marked as no longer in UDMS.
  Object.keys(had).forEach(id => {
    const w = had[id];
    if (w.facilityId === facilityId && !byKey[w.idKey] && w.status !== 'GONE') { writes.push([db.collection('employees').doc(id), Object.assign({}, w, { active: false, status: 'GONE', updatedAt: stamp })]); log.left++; }
  });
  // People and drivers who carry an employee's ID follow UDMS.
  const [crew, drivers] = await Promise.all([db.collection('crewPeople').where('facilityId', '==', facilityId).get(), db.collection('drivers').get()]);
  crew.docs.forEach(d => {
    const p = d.data(), e = byKey[idKey(p.employeeId)];
    if (!p.employeeId || !e) return;
    const want = { name: e.name, phone: e.phone, hireDate: e.hireDate };
    if (!changed(p, want, ['name', 'phone', 'hireDate'])) return;
    log.linked++;
    writes.push([d.ref, Object.assign({}, p, want, { updatedAt: stamp, updatedBy: 'UDMS' })]);
  });
  drivers.docs.forEach(d => {
    const p = d.data(), e = byKey[idKey(p.employeeId)];
    if (!p.employeeId || !e || (p.facilityId && p.facilityId !== facilityId)) return;
    const want = { name: e.name, hireDate: e.hireDate };
    if (!changed(p, want, ['name', 'hireDate'])) return;
    log.linked++;
    writes.push([d.ref, Object.assign({}, p, want, { editedAt: stamp, editedBy: 'UDMS' })]);
  });
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    writes.slice(i, i + 400).forEach(([ref, data]) => batch.set(ref, data));
    await batch.commit();
  }
  if (writes.length) await db.collection('actions').add({ action: 'employeesFromUdms', by: 'UDMS', at: stamp, facilityId, result: Object.assign({ ok: true }, log) });
  return Object.assign({ count: Object.keys(byKey).length }, log);
}

// Plain words for a failed read.
function problemText(err) {
  const m = String(err && err.message || err || '');
  if (/PERMISSION_DENIED|permission|7 /i.test(m)) return 'Waiting for permission to read UDMS.';
  if (/NOT_FOUND|5 /i.test(m)) return 'The UDMS employee list was not found.';
  return 'Could not reach UDMS. It will try again in 15 minutes.';
}

// One pass for every plant. plantDbs: { facilityId: db }.
async function runEmployeeSync({ udmsDb, plantDbs, now }) {
  const stamp = (now ? now() : new Date()).toISOString();
  let list;
  try { list = await readUdms(udmsDb); } catch (e) {
    const problem = problemText(e);
    await Promise.all(Object.values(plantDbs).map(db => db.collection('config').doc('employees').set({ checkedAt: stamp, ok: false, problem }, { merge: true })));
    return { ok: false, problem, detail: String(e && e.message || e) };
  }
  const out = {};
  for (const [facilityId, db] of Object.entries(plantDbs)) {
    const r = await syncPlant(db, facilityId, list, stamp);
    const status = { checkedAt: stamp, ok: true, problem: '', count: r.count };
    if (r.added + r.changed + r.left + r.linked) status.changedAt = stamp;
    await db.collection('config').doc('employees').set(status, { merge: true });
    out[facilityId] = r;
  }
  return { ok: true, plants: out };
}

// The picked employee, from the plant's own list (a save never trusts the screen's copy of the name or hire date).
async function employeeFor(tx, db, employeeId, facilityId) {
  const snap = await tx.get(db.collection('employees').doc(docId(employeeId)));
  const e = snap.exists ? snap.data() : null;
  if (!e || (facilityId && e.facilityId !== facilityId)) return null;
  return e;
}

module.exports = { UDMS_FIELDS, PRIVATE, UDMS_PROJECT, udmsDatabase, pick, plantOfBranch, readUdms, syncPlant, runEmployeeSync, employeeFor, idKey, docId };
