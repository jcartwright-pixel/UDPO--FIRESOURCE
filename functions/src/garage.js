/*
 * United Dairy Distribution app: the Garage Station (mechanic tablet), the current app's GarageStation.html and
 * 220_V7276_GarageFleetService.gs rebuilt.
 *
 * Joe's picks (10/8): the technicians' names on the screen, sign in with name + number, a simple job flow (Need Parts /
 * Add a Helper / Done), "What did you fix?", safe to drive + finger signature, and Report a Problem. Mechanics have no
 * United Dairy email (Joe 10/10), so the tablet needs no Google account: a technician taps their name and types their
 * login ID (5 or 6 digits, GARAGE TECHNICIANS column login_id). The IDs are never readable from the screens: the copy
 * keeps only a hash of each, in `garageLogins`, which no browser may read. Wrong numbers: 5 in a row lock that technician
 * for 5 minutes, and the whole station takes at most 30 wrong numbers a minute. A sign-in lasts 30 minutes from the last
 * step; at most two technicians are signed in on a tablet at once.
 *
 * Jobs are the open work orders (`workOrders`, the GARAGE WORK ORDERS tab and the ones made here) plus the open truck and
 * trailer write-ups nobody has started (`maintenance`, TRUCK LIVE / TRAILER LIVE). A leased truck's write-up shows only
 * once the office sent it to the garage (its notes say "Sent to garage"): the lessor repairs the others. Work orders made
 * here stay in the new app (ids WO-...); a safe Done marks the write-up repaired the same way Equipment Issues' Mark
 * Repaired does (queued for the sandbox sheet when the write-back is on) and moves Fleet Service's due dates.
 */
'use strict';

const crypto = require('crypto');
const L = require('./logic');
const M = require('./model');
// actions.js loads this file (Send to Garage), so it is looked up when first used, not at load.
const A = () => require('./actions');
const MAINT = require('./maintenance');
const { queueMaster } = require('./masterwrite');

const C = M.COLLECTIONS;
const SaveErr = (code, message) => new (A().SaveError)(code, message);
const FACILITY = 'fac_uniontown';
const G = Object.freeze({
  CATEGORIES: ['Brakes', 'Lights', 'Tires', 'Engine', 'Reefer', 'Doors / Body', 'Other'],
  FIXES: ['Replaced a part', 'Repaired', 'Oil / PM service', 'Tires', 'Lights', 'Brakes', 'DOT inspection', 'Nothing wrong'],
  SERVICES: { PM: 'PM service', REEFER: 'Reefer service', DOT: 'DOT annual inspection' },
  STATUSES: ['NEW', 'WORKING', 'PARTS', 'DONE'],
  MAX_TECHS: 2, SESSION_MS: 30 * 60000, SIGNATURE_MAX: 30000, TECH_FAILS: 5, TECH_LOCK_MS: 5 * 60000, STATION_FAILS_PER_MINUTE: 30,
  GARAGE_MARK: 'Sent to garage'
});
const WORK_ORDERS = 'workOrders', TECHS = 'garageTechs', LOGINS = 'garageLogins', SESSIONS = 'garageSessions', LOCKS = 'garageLocks';
const SIGN_IN_REQUIRED = 'Tap your name and enter your login ID.';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
// The hash the copy keeps of a login ID (salted with the technician, as the current app hashed the PIN).
function loginHash(techId, loginId) { return sha('UDPO-GARAGE|' + String(techId).trim() + '|' + String(loginId).trim()); }
const yes = (v) => v === true || /^(y|yes|true|1)$/i.test(String(v === undefined || v === null ? '' : v).trim());
const text = (v, max) => String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 200);
const docId = (id) => String(id).replace(/[^A-Za-z0-9_-]+/g, '_');

// GARAGE TECHNICIANS rows the station lists: an id, this plant (or none named), active.
function activeTechs(docs) {
  return docs.filter(t => text(t.tech_id) && (!t.facility_id || t.facility_id === FACILITY) && yes(t.active === undefined || t.active === '' ? 'YES' : t.active) && text(t.name))
    .map(t => ({ id: text(t.tech_id), name: text(t.name, 40) })).sort((a, b) => a.name.localeCompare(b.name));
}

// The garage's units (udpoV7276Units_): trucks and trailers of this plant, trailers written T-<number>; leased ones marked.
function unitText(unit, type) {
  const u = String(unit || '').toUpperCase().replace(/\s+/g, '');
  if (type === 'TRAILER') { const m = /^T-?(\d+)$/.exec(u) || /^(\d+)$/.exec(u); return m ? 'T-' + m[1] : u; }
  return u;
}
function garageUnits(equipment) {
  const seen = {};
  return (equipment || []).map(e => ({ e, type: L.fleetKind(e.type) })).filter(({ e, type }) => type && e.unit && (!e.facilityId || e.facilityId === FACILITY) &&
    e.sourcePresent !== false && ['INACTIVE', 'DISABLED', 'RETIRED', 'SOLD'].indexOf(String(e.status || 'ACTIVE').toUpperCase()) < 0)
    .map(({ e, type }) => ({ unit: unitText(e.unit, type), type, leased: L.unitLeased(e) })).filter(u => !seen[u.unit] && (seen[u.unit] = true))
    .sort((a, b) => (a.type === b.type ? 0 : a.type === 'TRUCK' ? -1 : 1) || a.unit.localeCompare(b.unit, undefined, { numeric: true }));
}
const alnum = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// What a technician typed on Report a Problem to one unit: exact, T + typed, or the one unit that ends that way.
function matchUnit(units, typed) {
  const key = alnum(typed);
  if (!key) return { error: 'Type the truck or trailer number.' };
  const exact = units.filter(u => alnum(u.unit) === key || alnum(u.unit) === 'T' + key);
  if (exact.length === 1) return { unit: exact[0] };
  const ends = key.length >= 2 ? units.filter(u => alnum(u.unit).endsWith(key)) : [];
  if (ends.length === 1) return { unit: ends[0] };
  if (exact.length > 1 || ends.length > 1) return { error: text(typed, 12) + ' matches ' + (exact.length > 1 ? exact : ends).slice(0, 4).map(u => u.unit).join(', ') + '. Type the whole number.' };
  return { error: text(typed, 12) + ' is not one of our trucks or trailers.' };
}

// A write-up the garage can work on (desktopUiValidMaintenanceCurrent_): a real unit, a real problem, not already fixed.
const DONE_STATUS = /^(COMPLETE|COMPLETED|CLOSED|RESOLVED|REPAIRED|REMOVED)$/i;
function realWriteUp(r) {
  const unit = text(r.truck_number || r.truck_id || r.trailer_number || r.trailer_id).toUpperCase(), problem = text(r.issue_details || r.notes, 4000), status = text(r.status || 'OPEN').toUpperCase();
  if (!r.record_id || DONE_STATUS.test(status) || /REPAIRED|RESOLVED|COMPLETE|CLOSED|ADDRESSED/.test(status) || yes(r.addressed)) return false;
  if (!unit || /^(REVIEW|UNKNOWN|N\/A|NONE|-+)$/.test(unit)) return false;
  if (!problem || L.noWriteUp(problem) || /^(ISSUE REPORTED|NEEDS DETAIL|NEEDS REVIEW)/i.test(problem) || /^(NO ISSUES?|NONE|N\/A)$/i.test(problem)) return false;
  if (/\b(NO ISSUES|GOOD|OK|OKAY|FIXED|REPAIRED|RESOLVED|COMPLETED?|CLOSED)\b/i.test(problem)) return false;
  if (/\b(reported working|now working|is working|works now)\b/i.test(problem) && !/\b(not working|stops working)\b/i.test(problem)) return false;
  return true;
}
const canRunGuess = (s) => !/OUT OF SERVICE|\bOOS\b|CAN.?T RUN|DOWN/i.test(String(s || ''));
const writeUpKey = (r) => (String(r.kind).toUpperCase() === 'TRAILER' ? 'trailers' : 'trucks') + '|' + r.record_id;

// One job as the tablet shows it (udpoV7276Job_).
function jobOf(o) {
  return { id: o.work_order_id, unit: o.unit || '', type: String(o.unit_type || '').toUpperCase() === 'TRAILER' ? 'TRAILER' : 'TRUCK', problem: o.problem || '', category: o.category || '',
    canRun: o.can_run === undefined || o.can_run === '' ? true : yes(o.can_run), source: String(o.source || '').toUpperCase(), serviceKey: o.service_key || '', status: String(o.status || 'NEW').toUpperCase(),
    techs: String(o.techs || '').split(/\s*,\s*/).filter(Boolean), startedAt: o.started_at || '', partsAt: o.parts_at || '', completedAt: o.completed_at || '', createdAt: o.created_at || '', createdBy: o.created_by || '',
    fixed: o.fixed || '', fixedNote: o.fixed_note || '', safe: o.safe || '', signedBy: o.signed_by || '', minutes: o.minutes || '' };
}

// The hub list (udpoV7276GarageList_ + udpoV7276OrderJobs_): open work orders, then write-ups with no work order yet.
function garageJobs(orders, records, units) {
  const mine = (orders || []).filter(o => o.work_order_id && (!o.facility_id || o.facility_id === FACILITY));
  const linked = {};
  mine.forEach(o => { if (o.source_kind && o.source_id) linked[o.source_kind + '|' + o.source_id] = true; });
  const byUnit = {};
  (units || []).forEach(u => { byUnit[alnum(u.unit)] = u; byUnit[alnum(u.unit).replace(/^T/, '')] = byUnit[alnum(u.unit).replace(/^T/, '')] || u; });
  const jobs = mine.filter(o => String(o.status || '').toUpperCase() !== 'DONE').map(jobOf);
  (records || []).forEach(r => {
    const kind = String(r.kind || '').toUpperCase();
    if ((kind !== 'TRUCK' && kind !== 'TRAILER') || !realWriteUp(r) || linked[writeUpKey(r)]) return;
    const raw = text(r.truck_number || r.truck_id || r.trailer_number || r.trailer_id), unit = byUnit[alnum(raw)] || byUnit[alnum(raw).replace(/^T/, '')];
    // A leased unit's write-up goes to the lessor unless the office sent it to our garage.
    if (unit && unit.leased && String(r.notes || '').indexOf(G.GARAGE_MARK) < 0) return;
    const problem = text(r.issue_details || r.notes, 300);
    jobs.push({ id: '', writeUp: writeUpKey(r), unit: unit ? unit.unit : unitText(raw, kind), type: kind, problem, category: '', canRun: canRunGuess(problem + ' ' + (r.priority || '')),
      source: 'WRITE_UP', serviceKey: '', status: 'NEW', techs: [], startedAt: '', createdAt: String(r.opened_at || r.service_date || ''), driver: r.driver || '' });
  });
  const rank = (j) => j.status === 'PARTS' ? 4 : !j.canRun ? 0 : j.status === 'WORKING' ? 1 : j.source === 'OFFICE' ? 3 : 2;
  return jobs.sort((a, b) => rank(a) - rank(b) || String(a.createdAt).localeCompare(String(b.createdAt)));
}

/* ---------- sign-in ---------- */

async function signedInTechs(tx, db, tokens, nowMs) {
  const list = (Array.isArray(tokens) ? tokens : []).map(t => text(t, 80)).filter(t => /^[A-Za-z0-9_-]{20,80}$/.test(t)).slice(0, G.MAX_TECHS);
  if (!list.length) return [];
  const refs = list.map(t => db.collection(SESSIONS).doc(sha(t)));
  const snaps = await (tx ? tx.getAll(...refs) : db.getAll(...refs));
  const seen = {}, out = [];
  snaps.forEach((s, i) => {
    const d = s.exists ? s.data() : null;
    if (!d || Date.parse(d.expiresAt) <= nowMs || seen[d.techId]) return;
    seen[d.techId] = true;
    out.push({ token: list[i], ref: refs[i], id: d.techId, name: d.name });
  });
  return out;
}
function renew(write, people, nowMs) { people.forEach(p => write(p.ref, { expiresAt: new Date(nowMs + G.SESSION_MS).toISOString() })); }

async function signIn(db, input, nowMs) {
  const techId = text(input.techId, 80), loginId = String(input.loginId || '').trim();
  if (!/^\d{5,6}$/.test(loginId)) throw SaveErr('BAD_REQUEST', 'Enter your 5- or 6-digit login ID.');
  return db.runTransaction(async tx => {
    const stamp = new Date(nowMs).toISOString(), minute = stamp.slice(0, 16);
    const techSnap = techId ? await tx.get(db.collection(TECHS).doc(docId(techId))) : null;
    const tech = techSnap && techSnap.exists ? activeTechs([techSnap.data()])[0] : null;
    if (!tech) throw SaveErr('NOT_FOUND', 'Tap your name first.');
    const lockRef = db.collection(LOCKS).doc(docId(techId)), stationRef = db.collection(LOCKS).doc('_station');
    const [lockSnap, stationSnap, loginSnap] = await tx.getAll(lockRef, stationRef, db.collection(LOGINS).doc(docId(techId)));
    const lock = lockSnap.exists ? lockSnap.data() : {}, station = stationSnap.exists ? stationSnap.data() : {};
    const fails = Date.parse(lock.since || 0) > nowMs - G.TECH_LOCK_MS ? (lock.count || 0) : 0;
    if (fails >= G.TECH_FAILS) throw SaveErr('NOT_ALLOWED', 'Too many wrong numbers. Wait 5 minutes or ask the office.');
    const stationFails = station.minute === minute ? (station.count || 0) : 0;
    if (stationFails >= G.STATION_FAILS_PER_MINUTE) throw SaveErr('NOT_ALLOWED', 'Too many wrong numbers on the garage station. Wait a minute and try again.');
    const login = loginSnap.exists ? loginSnap.data() : null;
    if (!login || !login.hash) throw SaveErr('NOT_FOUND', tech.name + ' has no login ID yet. Ask the office to add it.');
    const given = Buffer.from(loginHash(techId, loginId), 'hex'), want = Buffer.from(login.hash, 'hex');
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
      tx.set(lockRef, { count: fails + 1, since: fails ? lock.since : stamp });
      tx.set(stationRef, { minute, count: stationFails + 1 });
      return { wrong: true };
    }
    const others = (await signedInTechs(tx, db, input.tokens, nowMs)).filter(p => p.id !== techId);
    if (others.length >= G.MAX_TECHS) throw SaveErr('NOT_ALLOWED', 'Two technicians are already signed in. Sign one out first.');
    const token = crypto.randomBytes(24).toString('base64url');
    tx.delete(lockRef);
    tx.set(db.collection(SESSIONS).doc(sha(token)), { techId, name: tech.name, at: stamp, expiresAt: new Date(nowMs + G.SESSION_MS).toISOString() });
    renew((ref, data) => tx.update(ref, data), others, nowMs);
    return { token, id: techId, name: tech.name };
  }).then(r => { if (r.wrong) throw SaveErr('NOT_ALLOWED', 'Wrong login ID. Try again.'); return r; });
}

/* ---------- reading ---------- */

async function read(db, input, nowMs) {
  const people = await signedInTechs(null, db, input.tokens, nowMs);
  const techs = activeTechs((await db.collection(TECHS).get()).docs.map(d => d.data()));
  const equipment = (await db.collection(C.equipment).get()).docs.map(d => d.data());
  const units = garageUnits(equipment);
  let jobs = [];
  if (people.length) {
    const batch = db.batch();
    renew((ref, data) => batch.update(ref, data), people, nowMs);
    await batch.commit();
    const orders = (await db.collection(WORK_ORDERS).get()).docs.map(d => d.data());
    const records = (await db.collection(C.maintenance).where('kind', 'in', ['TRUCK', 'TRAILER']).get()).docs.map(d => d.data());
    jobs = garageJobs(orders, records, units);
  }
  return { techs, signedIn: people.map(p => ({ token: p.token, id: p.id, name: p.name })), jobs, units: units.map(u => u.unit), categories: G.CATEGORIES, fixes: G.FIXES };
}

/* ---------- the job steps ---------- */

const OPS = ['START', 'HELPER', 'PARTS', 'RESUME', 'DONE', 'REPORT'];
function validateStep(input) {
  const op = text(input.step, 10).toUpperCase();
  if (OPS.indexOf(op) < 0) throw SaveErr('BAD_REQUEST', 'Garage: unknown step ' + (op || '(none)') + '.');
  const requestId = text(input.requestId, 80);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) throw SaveErr('BAD_REQUEST', 'Each step needs a requestId');
  const out = { op, requestId, id: text(input.id, 40), writeUp: text(input.writeUp, 320) };
  if (op === 'REPORT') {
    out.unit = text(input.unit, 12);
    out.category = text(input.category, 40);
    if (G.CATEGORIES.indexOf(out.category) < 0) throw SaveErr('BAD_REQUEST', 'Tap what\'s wrong.');
    if (typeof input.canRun !== 'boolean') throw SaveErr('BAD_REQUEST', 'Tap Yes or No for "Can it run?".');
    out.canRun = input.canRun;
    out.problem = text(input.problem, 300);
    return out;
  }
  if (!out.id && !(op === 'START' && /^(trucks|trailers)\|.+/.test(out.writeUp))) throw SaveErr('BAD_REQUEST', 'That job is not on the list any more. Go back to Jobs.');
  if (op === 'DONE') {
    out.fixed = text(input.fixed, 40);
    if (G.FIXES.indexOf(out.fixed) < 0) throw SaveErr('BAD_REQUEST', 'Tap what you fixed.');
    if (typeof input.safe !== 'boolean') throw SaveErr('BAD_REQUEST', 'Tap Yes or No for "Safe to drive?".');
    out.safe = input.safe;
    out.note = text(input.note, 300);
    out.signature = String(input.signature || '');
    if (out.signature.length > G.SIGNATURE_MAX || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(out.signature)) throw SaveErr('BAD_REQUEST', 'Sign with your finger in the box.');
  }
  return out;
}

const joinNames = (list) => list.filter((n, i) => n && list.indexOf(n) === i).join(', ');
const newOrderId = () => 'WO-' + crypto.randomBytes(4).toString('hex').toUpperCase();

async function step(db, input, nowMs) {
  const req = validateStep(input);
  const stamp = new Date(nowMs).toISOString();
  return db.runTransaction(async tx => {
    const logRef = db.collection(C.actions).doc(req.requestId), logSnap = await tx.get(logRef);
    if (logSnap.exists) return Object.assign({}, logSnap.data().result, { repeated: true });
    const people = await signedInTechs(tx, db, input.tokens, nowMs);
    if (!people.length) throw SaveErr('NOT_ALLOWED', 'GARAGE_SIGN_IN_REQUIRED: ' + SIGN_IN_REQUIRED);
    const names = people.map(p => p.name), by = 'garage:' + names.join('+');
    const mode = await A().requireTestMode(tx, db, 'checkIns');
    const result = { ok: true, requestId: req.requestId };
    let ref, order, writeUp = null, writeUpRef = null;

    if (req.op === 'REPORT') {
      const units = garageUnits((await tx.get(db.collection(C.equipment))).docs.map(d => d.data()));
      const m = matchUnit(units, req.unit);
      if (m.error) throw SaveErr('BAD_REQUEST', m.error);
      const id = newOrderId();
      order = { work_order_id: id, facility_id: FACILITY, unit: m.unit.unit, unit_type: m.unit.type, problem: req.problem ? req.category + ': ' + req.problem : req.category, category: req.category,
        can_run: req.canRun ? 'YES' : 'NO', source: 'TECH', source_kind: '', source_id: '', service_key: '', status: 'NEW', created_at: stamp, created_by: joinNames(names), started_at: '', techs: '',
        parts_at: '', fixed: '', fixed_note: '', safe: '', signed_by: '', signature: '', completed_at: '', minutes: '', odometer: '', updated_at: stamp, updated_by: by, version: 1, createdInApp: true };
      renew((r, d) => tx.update(r, d), people, nowMs);
      tx.set(db.collection(WORK_ORDERS).doc(docId(id)), order);
      result.job = jobOf(order);
      tx.set(logRef, { action: 'garageReport', by, at: stamp, mode: mode.mode, workOrderId: id, after: order, result });
      return result;
    }

    if (req.id) {
      ref = db.collection(WORK_ORDERS).doc(docId(req.id));
      const snap = await tx.get(ref);
      if (!snap.exists) throw SaveErr('NOT_FOUND', 'That job is not on the list any more. Go back to Jobs.');
      order = snap.data();
    } else {
      // START on a write-up: one work order per write-up, made the first time someone starts it.
      const [kindName, recordId] = [req.writeUp.split('|')[0], req.writeUp.slice(req.writeUp.indexOf('|') + 1)];
      const existing = await tx.get(db.collection(WORK_ORDERS).where('source_id', '==', recordId));
      const hit = existing.docs.find(d => d.data().source_kind === kindName);
      writeUpRef = db.collection(C.maintenance).doc(MAINT.docId(recordId));
      const w = await tx.get(writeUpRef);
      if (hit) { ref = hit.ref; order = hit.data(); }
      else {
        if (!w.exists || !realWriteUp(w.data())) throw SaveErr('NOT_FOUND', 'That write-up was already fixed or removed.');
        const r = w.data(), id = newOrderId(), kind = kindName === 'trailers' ? 'TRAILER' : 'TRUCK', problem = text(r.issue_details || r.notes, 300);
        ref = db.collection(WORK_ORDERS).doc(docId(id));
        order = { work_order_id: id, facility_id: FACILITY, unit: unitText(r.truck_number || r.truck_id || r.trailer_number || r.trailer_id, kind), unit_type: kind, problem, category: '',
          can_run: canRunGuess(problem + ' ' + (r.priority || '')) ? 'YES' : 'NO', source: 'WRITE_UP', source_kind: kindName, source_id: recordId, service_key: '', status: 'NEW',
          created_at: String(r.opened_at || r.service_date || stamp), created_by: text(r.driver, 60) || 'Write-up', started_at: '', techs: '', parts_at: '', fixed: '', fixed_note: '', safe: '',
          signed_by: '', signature: '', completed_at: '', minutes: '', odometer: '', updated_at: stamp, updated_by: by, version: 0, createdInApp: true, isNew: true };
      }
      if (w.exists) writeUp = w.data();
    }
    if (String(order.status || '').toUpperCase() === 'DONE') throw SaveErr('NOT_ALLOWED', 'That job is already finished.');

    // DONE needs the write-up (to mark it repaired), the newest odometer and Fleet Service's row, read before any write.
    let odometer = null, setupRef = null, setup = null;
    if (req.op === 'DONE' && req.safe) {
      if (order.source_id && !writeUp) { writeUpRef = db.collection(C.maintenance).doc(MAINT.docId(order.source_id)); const w = await tx.get(writeUpRef); writeUp = w.exists ? w.data() : null; }
      if (String(order.unit_type).toUpperCase() !== 'TRAILER') {
        const odo = (await tx.get(db.collection('odometers').where('unit', '==', String(order.unit).toUpperCase().replace(/\s+/g, '')))).docs.map(d => d.data());
        odo.sort((a, b) => String(b.at || b.date).localeCompare(String(a.at || a.date)));
        odometer = odo.length ? odo[0].miles : null;
      }
      if (G.SERVICES[order.service_key]) { setupRef = db.collection('fleetSetup').doc(docId(order.unit)); const s = await tx.get(setupRef); setup = s.exists ? s.data() : null; }
    }

    const was = String(order.status || 'NEW').toUpperCase(), techs = String(order.techs || '').split(/\s*,\s*/).filter(Boolean);
    const change = { techs: joinNames(techs.concat(names)), started_at: order.started_at || stamp, updated_at: stamp, updated_by: by, version: (Number(order.version) || 0) + 1 };
    if (req.op === 'START' || req.op === 'HELPER') change.status = was === 'PARTS' ? 'PARTS' : 'WORKING';
    if (req.op === 'PARTS') Object.assign(change, { status: 'PARTS', parts_at: stamp });
    if (req.op === 'RESUME') change.status = 'WORKING';
    if (req.op === 'DONE') {
      Object.assign(change, { fixed: req.fixed, fixed_note: req.note, safe: req.safe ? 'YES' : 'NO', signed_by: names[0], signature: req.signature });
      if (!req.safe) Object.assign(change, { status: 'WORKING', can_run: 'NO' });
      else {
        Object.assign(change, { status: 'DONE', completed_at: stamp, can_run: 'YES', minutes: Math.max(0, Math.round((nowMs - Date.parse(change.started_at)) / 60000)) || 0 });
        if (odometer) change.odometer = odometer;
      }
    }
    const after = Object.assign({}, order, change);
    delete after.isNew;
    if (order.isNew) tx.set(ref, after); else tx.update(ref, Object.assign({}, change, { testEdited: true, editedAt: stamp }));
    renew((r, d) => tx.update(r, d), people, nowMs);

    if (req.op === 'DONE' && req.safe) {
      // The write-up is repaired (Equipment Issues' Mark Repaired), and Fleet Service's dates move on.
      if (writeUp && writeUpRef && !DONE_STATUS.test(String(writeUp.status || ''))) {
        const close = { status: 'COMPLETE', available: 'TRUE', out_of_service: 'FALSE', completed_at: stamp, completed_by: by, resolution: 'COMPLETED', resolution_notes: req.fixed + (req.note ? ': ' + req.note : '') + ' (Garage Station ' + after.work_order_id + ')', updated_at: stamp, updated_by: by };
        tx.update(writeUpRef, Object.assign({}, close, { testEdited: true, editedAt: stamp, editedBy: by }));
        const list = MAINT.LISTS[String(writeUp.kind || '').toUpperCase()];
        if (list) queueMaster(tx, db, mode, req.requestId, 'issue', writeUpRef, writeUp.record_id, writeUp.createdInApp ? Object.assign({}, writeUp, close) : close, !!writeUp.createdInApp, stamp, by, list);
        result.writeUpClosed = true;
      }
      if (setupRef) {
        const today = L.operatingDay(new Date(nowMs)), move = { updated_at: stamp, updated_by: by };
        if (order.service_key === 'PM') { move.last_service_date = today; if (odometer) move.last_service_miles = String(odometer); }
        if (order.service_key === 'REEFER') { move.last_service_date = today; if (setup && String(setup.current_hours || '').trim()) move.last_service_hours = String(setup.current_hours); }
        if (order.service_key === 'DOT') move.dot_due = L.addMonths(today, L.FLEET_RULES.dotMonths);
        if (setup) tx.update(setupRef, Object.assign({}, move, { testEdited: true, editedAt: stamp }));
        else tx.set(setupRef, Object.assign({ unit: order.unit, unit_type: order.unit_type, facility_id: FACILITY, track: 'YES', createdInApp: true }, move));
        result.service = move;
      }
    }
    result.job = jobOf(after);
    const before = {}; Object.keys(change).forEach(k => { before[k] = order[k] === undefined ? null : order[k]; });
    const logged = Object.assign({}, change); if (logged.signature) logged.signature = '(signature, ' + logged.signature.length + ' characters)';
    tx.set(logRef, { action: 'garage' + req.op, by, at: stamp, mode: mode.mode, workOrderId: after.work_order_id, before, after: logged, result });
    return result;
  });
}

/*
 * Fleet Service's Send to Garage (office, managers and administrators): a PM, reefer service or DOT inspection becomes a
 * job on the Garage Station. One open job per unit and service; sending again returns the one already there.
 */
async function sendToGarage(tx, db, req, email, stamp, logRef, mode) {
  const open = (await tx.get(db.collection(WORK_ORDERS).where('unit', '==', req.unit))).docs.map(d => d.data())
    .find(o => o.service_key === req.serviceKey && String(o.status || '').toUpperCase() !== 'DONE');
  if (open) return { ok: true, requestId: req.requestId, already: true, workOrderId: open.work_order_id, runs: [] };
  const id = newOrderId();
  const order = { work_order_id: id, facility_id: FACILITY, unit: req.unit, unit_type: req.unitType, problem: G.SERVICES[req.serviceKey] + (req.note ? ': ' + req.note : ''), category: '', can_run: 'YES',
    source: 'OFFICE', source_kind: '', source_id: '', service_key: req.serviceKey, status: 'NEW', created_at: stamp, created_by: email, started_at: '', techs: '', parts_at: '', fixed: '', fixed_note: '',
    safe: '', signed_by: '', signature: '', completed_at: '', minutes: '', odometer: '', updated_at: stamp, updated_by: email, version: 1, createdInApp: true };
  tx.set(db.collection(WORK_ORDERS).doc(docId(id)), order);
  const result = { ok: true, requestId: req.requestId, workOrderId: id, runs: [] };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, workOrderId: id, after: order, result });
  return result;
}
function validateSend(input, out) {
  out.unit = text(input.unit, 20).toUpperCase();
  out.serviceKey = text(input.serviceKey, 10).toUpperCase();
  out.unitType = text(input.unitType, 10).toUpperCase() === 'TRAILER' ? 'TRAILER' : 'TRUCK';
  out.note = text(input.note, 200);
  if (!out.unit) throw SaveErr('BAD_REQUEST', 'Pick the unit');
  if (!G.SERVICES[out.serviceKey]) throw SaveErr('BAD_REQUEST', 'Only a PM, reefer service or DOT inspection goes to the garage');
  return out;
}

/* One Garage Station call: {op: 'read' | 'signIn' | 'signOut' | 'step', tokens, ...}. Throws SaveError. */
async function garageCall(db, input, now) {
  input = input || {};
  const nowMs = (now ? now() : new Date()).getTime(), op = String(input.op || '');
  if (op === 'read') return read(db, input, nowMs);
  if (op === 'signIn') return signIn(db, input, nowMs);
  if (op === 'signOut') {
    // Sign Out ends the sign-in on the server too (the current app left it alive until it ran out).
    const people = await signedInTechs(null, db, input.tokens, nowMs), only = text(input.techId, 80);
    const batch = db.batch();
    people.filter(p => !only || p.id === only).forEach(p => batch.delete(p.ref));
    await batch.commit();
    return { ok: true };
  }
  if (op === 'step') return step(db, input, nowMs);
  throw SaveErr('BAD_REQUEST', 'Unknown request');
}

module.exports = { G, garageCall, loginHash, activeTechs, garageUnits, garageJobs, matchUnit, realWriteUp, unitText, jobOf, sendToGarage, validateSend, LOGINS };
