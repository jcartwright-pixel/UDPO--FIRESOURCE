/*
 * United Dairy Distribution app: the drivers' phone Check-In (no United Dairy account needed).
 *
 * Same idea as the current public Route Distribution page (public-route/): the phone asks once for the plant's Route
 * Distribution code, the driver picks their name once, and both stay on the phone. Every call sends the code; the
 * server keeps only a hash of it. Failed codes are capped at 30 a minute. A driver sees and checks in only the loads
 * Dispatch gave them for today or yesterday, and the check-in lands in the same day fields the dispatcher's Driver
 * Check-ins screen uses (same Live columns), with the same write-back. Nothing else can be read or changed here.
 */
'use strict';

const crypto = require('crypto');
const L = require('./logic');
const M = require('./model');
const A = require('./actions');
const MAINT = require('./maintenance');
const B = require('./board-rules');

const C = M.COLLECTIONS;
const { SaveError } = A;
const MAX_FAILED_PER_MINUTE = 30;
const CODE_REF = (db) => db.collection(C.config).doc('routePhone');

function hashCode(code, salt) { return crypto.createHash('sha256').update(salt + ':' + String(code).trim().toUpperCase()).digest('hex'); }

// A new Route Distribution code (managers and administrators): every phone asks for it again. Returned once, never stored.
async function newRouteCode(db, user, now) {
  const stamp = (now ? now() : new Date()).toISOString();
  const code = Array.from(crypto.randomBytes(6)).map(b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
  const salt = crypto.randomBytes(12).toString('hex');
  await db.runTransaction(async tx => {
    const person = await tx.get(db.collection(C.users).doc(M.safeIdPart(String(user.email).toLowerCase())));
    if (!person.exists || person.data().status !== 'ACTIVE' || !L.hasRole(person.data(), L.REORDER_ROLES)) throw new SaveError('NOT_ALLOWED', 'Only a manager or administrator can make a new phone code');
    tx.set(CODE_REF(db), { codeHash: hashCode(code, salt), salt, enabled: true, setAt: stamp, setBy: String(user.email).toLowerCase(), failed: { minute: '', count: 0 } });
  });
  return { code, setAt: stamp };
}

async function checkCode(db, code, stamp) {
  const minute = stamp.slice(0, 16);
  return db.runTransaction(async tx => {
    const snap = await tx.get(CODE_REF(db));
    const c = snap.exists ? snap.data() : null;
    if (!c || c.enabled !== true || !c.codeHash) throw new SaveError('NOT_ALLOWED', 'Phone Check-In is not turned on');
    const failed = c.failed && c.failed.minute === minute ? c.failed.count : 0;
    if (failed >= MAX_FAILED_PER_MINUTE) throw new SaveError('NOT_ALLOWED', 'Too many wrong codes; wait a minute and try again');
    const given = Buffer.from(hashCode(code || '', c.salt), 'hex'), want = Buffer.from(c.codeHash, 'hex');
    if (!code || given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
      tx.update(snap.ref, { failed: { minute, count: failed + 1 } });
      return false;
    }
    return true;
  });
}

// Today's operating day and the day before (a driver checking in after the 6 AM roll).
function allowedDates(stamp) { const today = L.operatingDay(new Date(stamp)); return [today, L.addDays(today, -1)]; }

function loadOf(run, runDocId, p) {
  const d = run.days[p];
  return { runDocId, day: p, rev: run.rev || 0, route: run.route, run: run.run, truck: d.truck || '', trailer: d.trailer || '', casesOut: d.casesOut === undefined ? null : d.casesOut,
    casesDelivered: d.casesDelivered === undefined ? null : d.casesDelivered, driverCaseReturn: d.driverCaseReturn === undefined ? null : d.driverCaseReturn,
    refusedReturned: d.refusedReturned || '', refusedReturnedSource: d.refusedReturnedSource || '', tractorIssues: d.tractorIssues || '', trailerIssues: d.trailerIssues || '',
    palletJackIssues: d.palletJackIssues || '', trailerNeedsCleaned: L.yes(d.trailerNeedsCleaned), checkinNotes: d.checkinNotes || '', checkinCompletedAt: d.checkinCompletedAt || '' };
}

/*
 * One phone call: {code, op, ...}. op 'roster' -> active drivers; 'loads' {driverId, date} -> that driver's loads;
 * 'checkIn' {driverId, runDocId, day, requestId, fields} -> saves one check-in. Throws SaveError.
 */
async function phoneCall(db, input, now) {
  input = input || {};
  const stamp = (now ? now() : new Date()).toISOString();
  if (!(await checkCode(db, String(input.code || '').slice(0, 40), stamp))) throw new SaveError('NOT_ALLOWED', 'That code is not right. Ask Dispatch for the Route Distribution code.');
  const op = String(input.op || '');
  if (op === 'roster') {
    const drivers = (await db.collection(C.drivers).get()).docs.map(d => d.data()).filter(d => d.name && L.driverActive(d));
    return { drivers: drivers.map(d => ({ id: d.id, name: d.name })).sort((a, b) => a.name.localeCompare(b.name)), dates: allowedDates(stamp) };
  }
  // View Loadout (Joe 10/10): the Driver Room board on the phone, read only, today's routes and their pickups.
  if (op === 'board') {
    const date = B.calendarDay(new Date(stamp));
    const runs = (await db.collection(C.runs).where('weekStart', '==', L.weekStart(date)).get()).docs.map(d => Object.assign({}, d.data(), { id: d.id }));
    const pickups = (await db.collection('pickups').where('date', 'in', [date, L.addDays(date, -1), L.addDays(date, -2), L.addDays(date, -3)]).get()).docs.map(d => d.data());
    const rows = B.boardRows(runs, pickups, date).map(r => ({ route: r.streamId || r.route, run: r.streamId ? '' : r.run, trailer: r.trailer, state: r.state, status: r.status, pickup: r.pickup, pickupText: r.pickupText }));
    return { date, rows, remaining: rows.filter(r => r.state !== 'LOADED').length, at: stamp };
  }
  const driverId = String(input.driverId || '').slice(0, 120);
  const driver = driverId ? await db.collection(C.drivers).doc(M.safeIdPart(driverId)).get() : null;
  if (!driver || !driver.exists || (driver.data().status || 'ACTIVE') !== 'ACTIVE') throw new SaveError('NOT_FOUND', 'Pick your name again');
  const dates = allowedDates(stamp);
  if (op === 'loads') {
    const date = dates.indexOf(input.date) >= 0 ? input.date : dates[0], p = L.dayPrefix(date);
    const snap = await db.collection(C.runs).where('weekStart', '==', L.weekStart(date)).get();
    const loads = snap.docs.filter(s => { const d = s.data().days && s.data().days[p]; return d && d.runs && d.driverId === driverId && L.liveFlagShown(s.data(), 'displayMobileRoute', 'mobile'); }).map(s => loadOf(s.data(), s.id, p));
    return { date, dates, driver: driver.data().name, loads };
  }
  if (op === 'dvir') return saveDvir(db, input, driver.data(), dates, stamp);
  if (op !== 'checkIn') throw new SaveError('BAD_REQUEST', 'Unknown request');
  const req = A.validate(Object.assign({}, input.fields || {}, { action: 'saveCheckIn', requestId: input.requestId, runDocId: input.runDocId, day: input.day }));
  return db.runTransaction(async tx => {
    const logRef = db.collection(C.actions).doc(req.requestId);
    const logSnap = await tx.get(logRef);
    if (logSnap.exists) return Object.assign({}, logSnap.data().result, { repeated: true });
    const mode = await A.requireTestMode(tx, db, 'checkIns');
    const runRef = db.collection(C.runs).doc(req.runDocId), runSnap = await tx.get(runRef);
    const run = runSnap.exists ? runSnap.data() : null, d = run && run.days && run.days[req.day];
    const date = run ? L.addDays(run.weekStart, L.DAYS.indexOf(req.day)) : '';
    // Only a load Dispatch gave this driver, for today or yesterday.
    if (!d || !d.runs || d.driverId !== driverId || dates.indexOf(date) < 0) throw new SaveError('NOT_ALLOWED', 'That load is not yours today; ask Dispatch');
    const after = Object.assign({}, req.checkIn, { checkinCompletedAt: stamp });
    const by = 'phone:' + driverId;
    const writeMaint = await MAINT.prepareMaintenance(tx, db, run, req.runDocId, req.day, date, Object.assign({}, d, after), { by: 'PUBLIC ROUTE · ' + driver.data().name, driver: driver.data().name }, stamp);
    const before = {}, update = { rev: run.rev + 1, testEdited: true, editedAt: stamp };
    Object.keys(after).forEach(k => { before[k] = d[k] === undefined ? null : d[k]; update['days.' + req.day + '.' + k] = after[k]; });
    update['days.' + req.day + '.updatedAt'] = stamp;
    update['days.' + req.day + '.updatedBy'] = by;
    tx.update(runRef, update);
    if (mode.writeBack) A.queueSheetCells(tx, db, req.requestId, '', run, req.runDocId, req.day, after, stamp, by);
    const result = { ok: true, requestId: req.requestId, runs: [{ runDocId: req.runDocId, rev: run.rev + 1 }] };
    result.maintenance = writeMaint(A.maintQueue(tx, db, mode, req.requestId, stamp, by));
    tx.set(logRef, { action: 'phoneCheckIn', by, driver: driver.data().name, at: stamp, mode: mode.mode, runDocId: req.runDocId, day: req.day, before, after, result });
    return result;
  });
}

/*
 * The driver's DVIR (pre-trip / post-trip inspection), as the current app's MobileDriver DVIR (udpoMobileSaveInspection_):
 * one record per trailer (drop and hook: up to 4), each with the truck's 7 checks and that trailer's 5, the odometer, the
 * write-ups, notes and the signature (drawn, or the typed name). Truck and trailer write-ups go on TRUCK LIVE / TRAILER LIVE
 * (`maintenance`), the odometer feeds Fleet Service's miles and the inspection the Driver Scorecard. Kept in `dvirs`.
 */
const DVIR = Object.freeze({
  TRUCK_ITEMS: ['Brakes', 'Steering', 'Lights and reflectors', 'Tires and wheels', 'Mirrors and visibility', 'Horn and wipers', 'Emergency equipment'],
  TRAILER_ITEMS: ['Trailer brakes', 'Trailer lights and reflectors', 'Trailer tires and wheels', 'Coupling and connections', 'Doors and body'],
  RESULTS: ['Checked — no defect', 'Defect found', 'Not applicable'], INSPECTIONS: ['Pre-trip', 'Post-trip'], MAX_TRAILERS: 4, SIGNATURE_MAX: 30000
});
const ORDINAL = ['1st', '2nd', '3rd', '4th'];
const clean = (v, max) => String(v === null || v === undefined ? '' : v).trim().slice(0, max);
function dvirTrailer(v) {
  const t = clean(v, 40).toUpperCase().replace(/\s+/g, ' ');
  if (/^(N\/A|NA|TBA|NONE)$/.test(t)) return 'N/A';
  const m = /^(?:T\s*-?\s*)+(\d+)$/.exec(t) || /^(\d+)$/.exec(t);
  return m ? 'T-' + m[1] : t;
}
function validateDvir(input) {
  const bad = (m) => { throw new SaveError('BAD_REQUEST', m); };
  const f = input.fields || {};
  if (!/^[A-Za-z0-9-]{16,64}$/.test(String(input.requestId || ''))) bad('A valid inspection request identifier is required.');
  const out = { requestId: String(input.requestId), runDocId: clean(input.runDocId, 200), day: clean(input.day, 3) };
  if (!out.runDocId || L.DAYS.indexOf(out.day) < 0) bad('Select the assigned route.');
  out.inspection = clean(f.inspection, 20);
  if (DVIR.INSPECTIONS.indexOf(out.inspection) < 0) bad('Select the inspection type.');
  const checks = Array.isArray(f.checks) ? f.checks.map(x => clean(x, 40)) : [];
  if (checks.length !== 12 || checks.some(x => DVIR.RESULTS.indexOf(x) < 0)) bad('Complete every inspection item.');
  out.checks = checks;
  out.truck = clean(f.truck, 60).toUpperCase();
  out.signatureName = clean(f.signatureName, 150);
  if (!out.truck || !out.signatureName) bad('Truck and signed driver name are required.');
  out.odometer = clean(f.odometer, 30).replace(/[,\s]/g, '');
  if (out.odometer && !(isFinite(Number(out.odometer)) && Number(out.odometer) >= 0)) bad('Enter a valid odometer reading.');
  out.tractorIssues = clean(f.tractorIssues, 1500); out.trailerIssues = clean(f.trailerIssues, 1500); out.notes = clean(f.notes, 1500);
  if ((checks.slice(0, 7).indexOf('Defect found') >= 0 && !out.tractorIssues) || (checks.slice(7).indexOf('Defect found') >= 0 && !out.trailerIssues)) bad('Describe the inspection defects.');
  const more = Array.isArray(f.moreTrailers) ? f.moreTrailers : [];
  if (more.length > DVIR.MAX_TRAILERS - 1) bad('A run can have at most 4 trailers.');
  const trailers = [{ trailer: dvirTrailer(f.trailer), checks: checks.slice(7), issues: out.trailerIssues }].concat(more.map(m => ({ trailer: dvirTrailer(m && m.trailer), checks: Array.isArray(m && m.checks) ? m.checks.map(x => clean(x, 40)) : [], issues: clean(m && m.issues, 1500) })));
  const seen = {};
  trailers.forEach((t, i) => {
    const n = i + 1;
    if (i && !t.trailer) bad('Trailer ' + n + ': enter the trailer number, or remove the box.');
    if (!i && !t.trailer && trailers.length > 1) bad('Trailer 1: enter the trailer number before adding another trailer.');
    if (t.trailer && t.trailer !== 'N/A' && !/^[A-Z0-9][A-Z0-9-]{0,19}$/.test(t.trailer)) bad('Trailer ' + n + ': enter one trailer number per box, using letters, numbers and dashes only (no slash, comma, space or other separator). Use Add trailer for another trailer.');
    if (t.trailer && seen[t.trailer]) bad('Trailer ' + t.trailer + ' is entered twice. Enter each trailer once, one per box.');
    seen[t.trailer] = true;
    if (i && (t.checks.length !== 5 || t.checks.some(x => DVIR.RESULTS.indexOf(x) < 0))) bad('Trailer ' + n + ': complete every inspection item.');
    if (i && t.checks.indexOf('Defect found') >= 0 && !t.issues) bad('Trailer ' + n + ': describe the inspection defects.');
  });
  out.trailers = trailers;
  out.signature = String(f.signature || '');
  if (!(out.signature === 'TYPED' || (/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(out.signature) && out.signature.length <= DVIR.SIGNATURE_MAX))) bad('Signature is missing or too large. Use your typed name or draw a shorter signature.');
  [out.truck, out.tractorIssues, out.notes, out.signatureName].concat(trailers.map(t => t.issues)).forEach(v => { if (/^=/.test(v)) bad('Formula-style text is blocked. Enter plain text only.'); });
  return out;
}

async function saveDvir(db, input, driver, dates, stamp) {
  const req = validateDvir(input), by = 'phone:' + driver.id;
  const ids = req.trailers.map((t, i) => 'DVIR_app_' + req.requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 32) + '_' + (i + 1));
  return db.runTransaction(async tx => {
    const refs = ids.map(id => db.collection('dvirs').doc(id)), had = await tx.getAll(...refs);
    if (had.every(s => s.exists)) return { ok: true, duplicate: true, recordId: ids[0], recordIds: ids, trailers: ids.length };
    const mode = await A.requireTestMode(tx, db, 'checkIns');
    const runSnap = await tx.get(db.collection(C.runs).doc(req.runDocId)), run = runSnap.exists ? runSnap.data() : null, d = run && run.days && run.days[req.day];
    const date = run ? L.addDays(run.weekStart, L.DAYS.indexOf(req.day)) : '';
    if (!d || !d.runs || d.driverId !== driver.id || dates.indexOf(date) < 0) throw new SaveError('NOT_ALLOWED', 'This route is not assigned to you for that day; ask Dispatch');
    const equipment = (await tx.get(db.collection(C.equipment))).docs.map(x => x.data());
    // The write-ups: the tractor's with the first trailer, each trailer's with its own record (numbered when there are several).
    const records = [];
    req.trailers.forEach((t, i) => {
      const c = { tractorIssues: i ? '' : req.tractorIssues, truck: req.truck, trailerIssues: t.issues ? (req.trailers.length > 1 ? ORDINAL[i] + ' trailer: ' : '') + t.issues : '', trailer: t.trailer };
      MAINT.recordsFor(run, req.runDocId, req.day, date, c, { by: 'DVIR · ' + req.signatureName, driver: req.signatureName }, equipment, stamp).forEach(r => {
        r.record_id = 'APP|' + ids[i] + '|dvir-' + (r.kind === 'TRUCK' ? 'tractor' : 'trailer');
        r.source_id = ids[i];
        r.notes = r.notes.replace('source: new app check-in', 'source: DVIR ' + ids[i]);
        records.push(r);
      });
    });
    const mRefs = records.map(r => db.collection(C.maintenance).doc(MAINT.docId(r.record_id)));
    const mSnaps = mRefs.length ? await tx.getAll(...mRefs) : [];
    const queue = A.maintQueue(tx, db, mode, req.requestId, stamp, by), made = [];
    records.forEach((r, i) => { if (!mSnaps[i].exists) { tx.set(mRefs[i], Object.assign({ createdInApp: true }, r)); queue(mRefs[i], r); made.push(r.record_id); } });
    const truckChecks = req.checks.slice(0, 7);
    req.trailers.forEach((t, i) => {
      if (had[i].exists) return;
      const checks = truckChecks.concat(t.checks), defect = checks.indexOf('Defect found') >= 0 || !!req.tractorIssues || !!t.issues;
      tx.set(refs[i], { recordId: ids[i], type: 'DVIR', date, status: 'SUBMITTED', facilityId: run.facilityId || 'fac_uniontown', route: run.route || '', run: run.run || '', routeId: run.routeId || '', runId: run.runId || '',
        runDocId: req.runDocId, day: req.day, trailer: t.trailer, notes: req.notes, recordedAt: stamp, recordedBy: by, driverId: driver.id, driver: driver.name,
        payload: { requestId: req.requestId, actor: by, route: run.route || '', run: run.run || '', inspection: req.inspection, odometer: req.odometer, truck: req.truck, tractorIssues: req.tractorIssues,
          notes: req.notes, signatureName: req.signatureName, signature: req.signature, status: 'SUBMITTED', trailer: t.trailer, checks, trailerIssues: t.issues, trailerPosition: i + 1, trailerCount: req.trailers.length },
        defect, createdInApp: true });
      // Driver Scorecard (an inspection, and whether it found a defect) and Fleet Service miles (the odometer).
      tx.set(db.collection('plantEvents').doc(ids[i]), { type: 'DVIR', date, route: String(run.route || '').trim(), run: String(run.run || '').trim(), defect, createdInApp: true });
    });
    if (Number(req.odometer) > 0 && !had[0].exists) tx.set(db.collection('odometers').doc(ids[0]), { unit: req.truck.replace(/\s+/g, ''), miles: Number(req.odometer), date, at: stamp, createdInApp: true });
    const result = { ok: true, recordId: ids[0], recordIds: ids, trailers: ids.length, recordedAt: stamp, status: 'SUBMITTED', maintenance: made };
    tx.set(db.collection(C.actions).doc(req.requestId), { action: 'phoneDvir', by, driver: driver.name, at: stamp, mode: mode.mode, runDocId: req.runDocId, day: req.day, after: { recordIds: ids, truck: req.truck, odometer: req.odometer }, result });
    return result;
  });
}

module.exports = { phoneCall, newRouteCode, hashCode, MAX_FAILED_PER_MINUTE, DVIR, dvirTrailer };
