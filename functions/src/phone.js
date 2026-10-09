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
    const drivers = (await db.collection(C.drivers).get()).docs.map(d => d.data()).filter(d => d.name && (d.status || 'ACTIVE') === 'ACTIVE');
    return { drivers: drivers.map(d => ({ id: d.id, name: d.name })).sort((a, b) => a.name.localeCompare(b.name)), dates: allowedDates(stamp) };
  }
  const driverId = String(input.driverId || '').slice(0, 120);
  const driver = driverId ? await db.collection(C.drivers).doc(M.safeIdPart(driverId)).get() : null;
  if (!driver || !driver.exists || (driver.data().status || 'ACTIVE') !== 'ACTIVE') throw new SaveError('NOT_FOUND', 'Pick your name again');
  const dates = allowedDates(stamp);
  if (op === 'loads') {
    const date = dates.indexOf(input.date) >= 0 ? input.date : dates[0], p = L.dayPrefix(date);
    const snap = await db.collection(C.runs).where('weekStart', '==', L.weekStart(date)).get();
    const loads = snap.docs.filter(s => { const d = s.data().days && s.data().days[p]; return d && d.runs && d.driverId === driverId; }).map(s => loadOf(s.data(), s.id, p));
    return { date, dates, driver: driver.data().name, loads };
  }
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
    const before = {}, update = { rev: run.rev + 1, testEdited: true, editedAt: stamp };
    Object.keys(after).forEach(k => { before[k] = d[k] === undefined ? null : d[k]; update['days.' + req.day + '.' + k] = after[k]; });
    const by = 'phone:' + driverId;
    update['days.' + req.day + '.updatedAt'] = stamp;
    update['days.' + req.day + '.updatedBy'] = by;
    tx.update(runRef, update);
    if (mode.writeBack) A.queueSheetCells(tx, db, req.requestId, '', run, req.runDocId, req.day, after, stamp, by);
    const result = { ok: true, requestId: req.requestId, runs: [{ runDocId: req.runDocId, rev: run.rev + 1 }] };
    tx.set(logRef, { action: 'phoneCheckIn', by, driver: driver.data().name, at: stamp, mode: mode.mode, runDocId: req.runDocId, day: req.day, before, after, result });
    return result;
  });
}

module.exports = { phoneCall, newRouteCode, hashCode, MAX_FAILED_PER_MINUTE };
