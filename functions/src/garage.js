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
 *
 * Joe 10/10 evening: the tablet opens straight to the open work orders (`board`, no sign-in), fork truck / pallet jack
 * write-ups included (FORK TRUCK LIVE, the check-in's pallet jack line). A mechanic taps a work order, then their name and
 * login ID, and Starts: each mechanic has their own clock on the job (`labor` on the work order, `garageClocks` per
 * mechanic), a second mechanic joins with Add another mechanic. One mechanic, one job: starting another job stops their
 * clock on the first, which stays open. Need Parts and Complete stop every clock; only Complete (name + login ID, what
 * was fixed, safe to drive, signature) closes the work order and records who completed it and the labour per mechanic.
 */
'use strict';

const crypto = require('crypto');
const L = require('./logic');
const M = require('./model');
const FAILS = require('./fails');
// actions.js loads this file (Send to Garage), so it is looked up when first used, not at load.
const A = () => require('./actions');
const MAINT = require('./maintenance');
const { queueMaster } = require('./masterwrite');
const CLOCK = require('./job-clock');

const C = M.COLLECTIONS;
const SaveErr = (code, message) => new (A().SaveError)(code, message);
const FACILITY = 'fac_uniontown';
const G = Object.freeze({
  CATEGORIES: ['Brakes', 'Lights', 'Tires', 'Engine', 'Reefer', 'Doors / Body', 'Other'],
  FIXES: ['Replaced a part', 'Repaired', 'Oil / PM service', 'Tires', 'Lights', 'Brakes', 'Annual inspection', 'Nothing wrong'],
  SERVICES: { PM: 'PM service', REEFER: 'Reefer service', DOT: 'Annual inspection' },
  STATUSES: ['NEW', 'WORKING', 'PARTS', 'DONE'],
  MAX_TECHS: 2, SESSION_MS: 30 * 60000, SIGNATURE_MAX: 30000, TECH_FAILS: 5, TECH_LOCK_MS: 5 * 60000, STATION_FAILS_PER_MINUTE: 30,
  GARAGE_MARK: 'Sent to garage'
});
const WORK_ORDERS = 'workOrders', TECHS = 'garageTechs', LOGINS = 'garageLogins', SESSIONS = 'garageSessions', LOCKS = 'garageLocks', CLOCKS = 'garageClocks';
// The write-up queues the garage works from, as the job key's first part (Equipment Issues' TRUCK / TRAILER / FORK_TRUCK).
const KIND_KEYS = Object.freeze({ TRUCK: 'trucks', TRAILER: 'trailers', FORK_TRUCK: 'forks' });
const KEY_KINDS = Object.freeze({ trucks: 'TRUCK', trailers: 'TRAILER', forks: 'FORK_TRUCK' });
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
  const unit = text(rawUnit(r)).toUpperCase(), problem = text(r.issue_details || r.notes, 4000), status = text(r.status || 'OPEN').toUpperCase();
  if (!r.record_id || DONE_STATUS.test(status) || /REPAIRED|RESOLVED|COMPLETE|CLOSED|ADDRESSED/.test(status) || yes(r.addressed)) return false;
  if (!unit || /^(REVIEW|UNKNOWN|N\/A|NONE|-+)$/.test(unit)) return false;
  if (!problem || L.noWriteUp(problem) || /^(ISSUE REPORTED|NEEDS DETAIL|NEEDS REVIEW)/i.test(problem) || /^(NO ISSUES?|NONE|N\/A)$/i.test(problem)) return false;
  if (/\b(NO ISSUES|GOOD|OK|OKAY|FIXED|REPAIRED|RESOLVED|COMPLETED?|CLOSED)\b/i.test(problem)) return false;
  if (/\b(reported working|now working|is working|works now)\b/i.test(problem) && !/\b(not working|stops working)\b/i.test(problem)) return false;
  return true;
}
function rawUnit(r) { return r.truck_number || r.truck_id || r.trailer_number || r.trailer_id || r.unit_number || r.equipment_id || ''; }
// Where a write-up came from, for the tablet: the driver's DVIR, the driver's check-in, or Equipment Issues (the sheet).
function writeUpFrom(r) {
  const notes = String(r.notes || '');
  if (/source: DVIR/i.test(notes)) return 'DVIR';
  if (/check-in/i.test(notes) || r.source_type === 'ROUTE_APP') return 'Driver check-in';
  return 'Equipment Issues';
}
const canRunGuess = (s) => !/OUT OF SERVICE|\bOOS\b|CAN.?T RUN|DOWN/i.test(String(s || ''));
const writeUpKey = (r) => (KIND_KEYS[String(r.kind).toUpperCase()] || 'trucks') + '|' + r.record_id;
const unitType = (v) => { const t = String(v || '').toUpperCase(); return t === 'TRAILER' || t === 'FORK_TRUCK' ? t : 'TRUCK'; };
const FROM = { OFFICE: 'Office (Fleet Service)', TECH: 'Garage', WRITE_UP: 'Equipment Issues' };
// A work order's labour: one entry per mechanic per clock (start, end, minutes); an open one has no end yet (job-clock.js).
const { laborOf, joinNames } = CLOCK;

// One job as the tablet shows it (udpoV7276Job_).
function jobOf(o) {
  const labor = laborOf(o);
  return { id: o.work_order_id, unit: o.unit || '', type: unitType(o.unit_type), problem: o.problem || '', category: o.category || '',
    canRun: o.can_run === undefined || o.can_run === '' ? true : yes(o.can_run), source: String(o.source || '').toUpperCase(), serviceKey: o.service_key || '', status: String(o.status || 'NEW').toUpperCase(),
    techs: String(o.techs || '').split(/\s*,\s*/).filter(Boolean), startedAt: o.started_at || '', partsAt: o.parts_at || '', completedAt: o.completed_at || '', createdAt: o.created_at || '', createdBy: o.created_by || '',
    fixed: o.fixed || '', fixedNote: o.fixed_note || '', safe: o.safe || '', signedBy: o.signed_by || '', minutes: o.minutes || '',
    from: o.source_from || FROM[String(o.source || '').toUpperCase()] || '', completedBy: o.completed_by || '',
    onNow: labor.filter(s => !s.end).map(s => ({ id: s.tech_id, name: s.name, since: s.start })), labor: labor.filter(s => s.end).map(s => ({ id: s.tech_id, name: s.name, minutes: s.minutes })),
    laborMinutes: labor.reduce((n, s) => n + (s.end ? s.minutes : 0), 0) };
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
    if (!KIND_KEYS[kind] || !realWriteUp(r) || linked[writeUpKey(r)]) return;
    const raw = text(rawUnit(r)), unit = kind === 'FORK_TRUCK' ? null : byUnit[alnum(raw)] || byUnit[alnum(raw).replace(/^T/, '')];
    // A leased unit's write-up goes to the lessor unless the office sent it to our garage.
    if (unit && unit.leased && String(r.notes || '').indexOf(G.GARAGE_MARK) < 0) return;
    const problem = text(r.issue_details || r.notes, 300);
    jobs.push({ id: '', writeUp: writeUpKey(r), unit: unit ? unit.unit : unitText(raw, kind), type: kind, problem, category: '', canRun: canRunGuess(problem + ' ' + (r.priority || '')),
      source: 'WRITE_UP', serviceKey: '', status: 'NEW', techs: [], startedAt: '', createdAt: String(r.opened_at || r.service_date || ''), driver: r.driver || '',
      from: writeUpFrom(r), onNow: [], labor: [], laborMinutes: 0, completedBy: '' });
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
function renew(write, people, nowMs) { people.filter(p => p.ref).forEach(p => write(p.ref, { expiresAt: new Date(nowMs + G.SESSION_MS).toISOString() })); }

// A mechanic's name and login ID, checked inside a save (wrong numbers count towards the 5-minute lock, as at sign-in).
// Returns {tech} or {wrong: true}; the caller lets the transaction finish (so the count is kept) and then refuses.
async function checkLogin(tx, db, techId, loginId, nowMs, device) {
  const stamp = new Date(nowMs).toISOString(), minute = stamp.slice(0, 16);
  const techSnap = techId ? await tx.get(db.collection(TECHS).doc(docId(techId))) : null;
  const tech = techSnap && techSnap.exists ? activeTechs([techSnap.data()])[0] : null;
  if (!tech) throw SaveErr('NOT_FOUND', 'Tap your name first.');
  const lockRef = db.collection(LOCKS).doc(docId(techId)), stationRef = db.collection(LOCKS).doc('_station');
  const [lockSnap, stationSnap, loginSnap] = await tx.getAll(lockRef, stationRef, db.collection(LOGINS).doc(docId(techId)));
  const lock = lockSnap.exists ? lockSnap.data() : {}, station = stationSnap.exists ? stationSnap.data() : {};
  const fails = Date.parse(lock.since || 0) > nowMs - G.TECH_LOCK_MS ? (lock.count || 0) : 0;
  if (fails >= G.TECH_FAILS) throw SaveErr('NOT_ALLOWED', 'Too many wrong numbers. Wait 5 minutes or ask the office.');
  // Counted per device (fails.js), so one tablet typing wrong numbers does not lock every garage tablet.
  const dev = device || 'unknown', byDevice = FAILS.current(station.byDevice, f => f.minute === minute);
  const stationFails = (byDevice[dev] || {}).count || 0;
  if (stationFails >= G.STATION_FAILS_PER_MINUTE) throw SaveErr('NOT_ALLOWED', 'Too many wrong numbers on the garage station. Wait a minute and try again.');
  const login = loginSnap.exists ? loginSnap.data() : null;
  if (!login || !login.hash) throw SaveErr('NOT_FOUND', tech.name + ' has no login ID yet. Ask the office to add it.');
  const given = Buffer.from(loginHash(techId, loginId), 'hex'), want = Buffer.from(login.hash, 'hex');
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    tx.set(lockRef, { count: fails + 1, since: fails ? lock.since : stamp });
    byDevice[dev] = { minute, count: stationFails + 1 };
    tx.set(stationRef, { byDevice });
    return { wrong: true };
  }
  return { tech };
}

async function signIn(db, input, nowMs) {
  const techId = text(input.techId, 80), loginId = String(input.loginId || '').trim();
  if (!/^\d{5,6}$/.test(loginId)) throw SaveErr('BAD_REQUEST', 'Enter your 5- or 6-digit login ID.');
  return db.runTransaction(async tx => {
    const stamp = new Date(nowMs).toISOString();
    const checked = await checkLogin(tx, db, techId, loginId, nowMs, FAILS.who(input));
    if (checked.wrong) return checked;
    const tech = checked.tech, lockRef = db.collection(LOCKS).doc(docId(techId));
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
    const records = (await db.collection(C.maintenance).where('kind', 'in', Object.keys(KIND_KEYS)).get()).docs.map(d => d.data());
    jobs = garageJobs(orders, records, units);
  }
  return { techs, signedIn: people.map(p => ({ token: p.token, id: p.id, name: p.name })), jobs, units: units.map(u => u.unit), categories: G.CATEGORIES, fixes: G.FIXES };
}

/*
 * The tablet's first screen (Joe 10/10): every open work order and write-up, with no sign-in, and each mechanic with the
 * job their clock is on. The drivers' names stay off it (anyone can open the page); the steps still need a login ID.
 */
async function board(db, nowMs) {
  const techs = activeTechs((await db.collection(TECHS).get()).docs.map(d => d.data()));
  const units = garageUnits((await db.collection(C.equipment).get()).docs.map(d => d.data()));
  const orders = (await db.collection(WORK_ORDERS).get()).docs.map(d => d.data());
  const records = (await db.collection(C.maintenance).where('kind', 'in', Object.keys(KIND_KEYS)).get()).docs.map(d => d.data());
  const clocks = {};
  (await db.collection(CLOCKS).get()).docs.forEach(d => { const c = d.data(); if (c.techId) clocks[c.techId] = c; });
  const jobs = garageJobs(orders, records, units).map(j => { const c = Object.assign({}, j); delete c.driver; return c; });
  const open = {}; jobs.forEach(j => { if (j.id) open[j.id] = j; });
  return { techs: techs.map(t => { const c = clocks[t.id], j = c && open[c.workOrderId]; return Object.assign({}, t, { on: j ? { id: j.id, unit: j.unit, since: c.since } : null }); }),
    jobs, units: units.map(u => u.unit), categories: G.CATEGORIES, fixes: G.FIXES, now: new Date(nowMs).toISOString() };
}

/* ---------- the job steps ---------- */

const OPS = ['START', 'HELPER', 'PARTS', 'RESUME', 'STOP', 'DONE', 'REPORT'];
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
  // A step on a write-up names the write-up when the tablet had no signal to learn its work order number (Joe 10/13).
  if (!out.id && !/^(trucks|trailers|forks)\|.+/.test(out.writeUp)) throw SaveErr('BAD_REQUEST', 'That job is not on the list any more. Go back to Jobs.');
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

const newOrderId = () => 'WO-' + crypto.randomBytes(4).toString('hex').toUpperCase();

async function step(db, input, nowMs) {
  const req = validateStep(input);
  const stamp = new Date(nowMs).toISOString();
  return db.runTransaction(async tx => {
    const logRef = db.collection(C.actions).doc(req.requestId), logSnap = await tx.get(logRef);
    if (logSnap.exists) return Object.assign({}, logSnap.data().result, { repeated: true });
    let people = await signedInTechs(tx, db, input.tokens, nowMs);
    // Joe 10/13 (Garage Station with no signal): a step kept on the tablet carries the mechanic's name and login ID instead of
    // a sign-in that may have run out by the time it is sent; they are checked here as at sign-in.
    if (!people.length && input.signIn && typeof input.signIn === 'object') {
      const techId = text(input.signIn.techId, 80), loginId = String(input.signIn.loginId || '').trim();
      if (!/^\d{5,6}$/.test(loginId)) throw SaveErr('BAD_REQUEST', 'Enter your 5- or 6-digit login ID.');
      const checked = await checkLogin(tx, db, techId, loginId, nowMs, FAILS.who(input));
      if (checked.wrong) return { wrong: true };
      people = [{ id: techId, name: checked.tech.name, ref: null }];
    }
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
      else if (req.op !== 'START') throw SaveErr('NOT_FOUND', 'That job is not on the list any more. Go back to Jobs.');
      else {
        if (!w.exists || !realWriteUp(w.data())) throw SaveErr('NOT_FOUND', 'That write-up was already fixed or removed.');
        order = Object.assign(writeUpOrder(w.data(), kindName, stamp, by), { version: 0, isNew: true });
        ref = db.collection(WORK_ORDERS).doc(docId(order.work_order_id));
      }
      if (w.exists) writeUp = w.data();
    }
    if (String(order.status || '').toUpperCase() === 'DONE') throw SaveErr('NOT_ALLOWED', 'That job is already finished.');

    // DONE needs the write-up (to mark it repaired), the newest odometer and Fleet Service's row, read before any write.
    let odometer = null, gpsHours = null, setupRef = null, setup = null, rules = fleetRules(null);
    if (req.op === 'DONE' && req.safe) {
      if (order.source_id && !writeUp) { writeUpRef = db.collection(C.maintenance).doc(MAINT.docId(order.source_id)); const w = await tx.get(writeUpRef); writeUp = w.exists ? w.data() : null; }
      // Joe 10/13: the newer of the driver's DVIR odometer and Verizon Connect Fleet's (gpsTrucks); a trailer's GPS hours are its reefer hours.
      const unitKey = String(order.unit).toUpperCase().replace(/\s+/g, ''), gpsId = M.safeIdPart(unitKey);
      const gps = gpsId ? await tx.get(db.collection('gpsTrucks').doc(gpsId)) : null;
      if (unitType(order.unit_type) === 'TRUCK') {
        const odo = (await tx.get(db.collection('odometers').where('unit', '==', unitKey))).docs.map(d => d.data());
        const read = L.latestReadings(odo, gps && gps.exists ? [gps.data()] : [])[unitKey];
        odometer = read && read.miles != null ? read.miles : null;
      } else if (gps && gps.exists) { const read = L.latestReadings([], [gps.data()])[unitKey]; gpsHours = read && read.hours > 0 ? read.hours : null; }
      if (G.SERVICES[order.service_key]) { setupRef = db.collection('fleetSetup').doc(docId(order.unit)); const s = await tx.get(setupRef); setup = s.exists ? s.data() : null; }
      if (order.service_key === 'DOT') { const r = await tx.get(db.collection('config').doc(RULES_DOC)); rules = fleetRules(r.exists ? r.data() : null); }
    }

    // The clocks: each signed-in mechanic's own (one job at a time), and every clock still running on this job (job-clock.js,
    // shared with the Maintenance Station, review item 74).
    const thisId = order.work_order_id, labor = laborOf(order);
    const moved = await CLOCK.moveClocks(tx, db, { clocks: CLOCKS, orders: WORK_ORDERS, docId, op: req.op, finishing: req.op === 'DONE' && req.safe, people, labor, thisId, nowMs, stamp,
      keys: { onNow: 'on_now', laborMinutes: 'labor_minutes' }, clockDoc: (p) => ({ techId: p.id, name: p.name, workOrderId: thisId, unit: order.unit || '', since: stamp }),
      touched: { updated_at: stamp, updated_by: by, testEdited: true, editedAt: stamp }, otherName: (o, id) => String(o.unit || id) });
    if (moved.stoppedOn) result.stoppedOn = moved.stoppedOn;

    const was = String(order.status || 'NEW').toUpperCase(), techs = String(order.techs || '').split(/\s*,\s*/).filter(Boolean);
    const change = Object.assign({ techs: joinNames(techs.concat(names)), started_at: order.started_at || stamp, updated_at: stamp, updated_by: by, version: (Number(order.version) || 0) + 1 }, moved.laborFields(labor),
      CLOCK.stepStatus(req.op, was, 'parts_at', stamp));
    if (req.op === 'DONE') {
      Object.assign(change, { fixed: req.fixed, fixed_note: req.note, safe: req.safe ? 'YES' : 'NO', signed_by: names[0], signature: req.signature });
      if (!req.safe) Object.assign(change, { status: 'WORKING', can_run: 'NO' });
      else {
        Object.assign(change, { status: 'DONE', completed_at: stamp, completed_by: names[0], can_run: 'YES', minutes: moved.minutesFrom(change.started_at) });
        if (odometer) change.odometer = odometer;
      }
    }
    const after = Object.assign({}, order, change);
    delete after.isNew;
    if (order.isNew) tx.set(ref, after); else tx.update(ref, Object.assign({}, change, { testEdited: true, editedAt: stamp }));
    renew((r, d) => tx.update(r, d), people, nowMs);
    CLOCK.applyWrites(tx, moved.writes);

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
        if (order.service_key === 'REEFER') { move.last_service_date = today; if (gpsHours) move.last_service_hours = String(gpsHours); else if (setup && String(setup.current_hours || '').trim()) move.last_service_hours = String(setup.current_hours); }
        if (order.service_key === 'DOT') move.dot_due = L.addMonths(today, L.fleetRule(rules, String(order.unit_type || '').toUpperCase() === 'TRAILER' ? 'TRAILER' : 'TRUCK', 'dotMonths'));
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
  }).then(r => { if (r && r.wrong) throw SaveErr('NOT_ALLOWED', 'Wrong login ID. Try again.'); return r; });
}

// A write-up's work order: the unit, what the driver wrote and where it came from, tied to the write-up (source_kind|source_id).
function writeUpOrder(r, kindName, stamp, by) {
  const id = newOrderId(), kind = KEY_KINDS[kindName] || 'TRUCK', problem = text(r.issue_details || r.notes, 300);
  return { work_order_id: id, facility_id: FACILITY, unit: kind === 'FORK_TRUCK' ? text(rawUnit(r), 20).toUpperCase() : unitText(rawUnit(r), kind), unit_type: kind, problem, category: '', source_from: writeUpFrom(r),
    can_run: canRunGuess(problem + ' ' + (r.priority || '')) ? 'YES' : 'NO', source: 'WRITE_UP', source_kind: kindName, source_id: r.record_id, service_key: '', status: 'NEW',
    created_at: String(r.opened_at || r.service_date || stamp), created_by: text(r.driver, 60) || 'Write-up', started_at: '', techs: '', parts_at: '', fixed: '', fixed_note: '', safe: '',
    signed_by: '', signature: '', completed_at: '', minutes: '', odometer: '', updated_at: stamp, updated_by: by, version: 1, createdInApp: true };
}

/*
 * Joe 10/14 ("this says two at the garage, so I should be able to go into the garage and see two work orders"): Truck Issues'
 * Garage button makes the write-up's work order, so it is on the Garage Station, Fleet Service's work orders and the hub's Garage
 * count at once; one per write-up, however many times it is sent or reported. Repaired or Remove on Truck Issues closes it (any
 * mechanic's clock on it stops); a safe Complete on the Garage Station already marks the write-up repaired (step above).
 * Called inside updateIssue's transaction: every read here, then apply(tx) does the writes after the write-up's own read.
 */
async function writeUpOrderStep(tx, db, r, issueStep, email, stamp) {
  const kindName = KIND_KEYS[String(r.kind || '').toUpperCase()];
  if (!kindName || !r.record_id || ['garage', 'repaired', 'remove'].indexOf(issueStep) < 0) return null;
  const linked = (await tx.get(db.collection(WORK_ORDERS).where('source_id', '==', r.record_id))).docs.filter(d => d.data().source_kind === kindName);
  const open = linked.filter(d => String(d.data().status || 'NEW').toUpperCase() !== 'DONE');
  if (issueStep === 'garage') {
    if (linked.length) return { workOrderId: linked[0].data().work_order_id, apply: () => {} };
    const order = Object.assign(writeUpOrder(r, kindName, stamp, email), { sent_by: email, sent_at: stamp });
    return { workOrderId: order.work_order_id, created: true, apply: (t) => t.set(db.collection(WORK_ORDERS).doc(docId(order.work_order_id)), order) };
  }
  if (!open.length) return null;
  const how = issueStep === 'repaired' ? 'Marked repaired on Truck Issues' : 'Write-up removed on Truck Issues';
  const plans = [];
  for (const d of open) {
    const o = d.data(), labor = laborOf(o);
    const moved = await CLOCK.moveClocks(tx, db, { clocks: CLOCKS, orders: WORK_ORDERS, docId, op: 'DONE', finishing: true, people: [], labor, thisId: o.work_order_id, nowMs: Date.parse(stamp), stamp,
      keys: { onNow: 'on_now', laborMinutes: 'labor_minutes' }, clockDoc: () => ({}), touched: {}, otherName: () => '' });
    plans.push({ ref: d.ref, id: o.work_order_id, moved, labor });
  }
  return { workOrderId: plans.map(p => p.id).join(', '), closed: plans.map(p => p.id), apply: (t) => plans.forEach(p => {
    t.update(p.ref, Object.assign({ status: 'DONE', completed_at: stamp, completed_by: email, fixed_note: how, can_run: 'YES', updated_at: stamp, updated_by: email, testEdited: true, editedAt: stamp }, p.moved.laborFields(p.labor)));
    CLOCK.applyWrites(t, p.moved.writes);
  }) };
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
  if (!G.SERVICES[out.serviceKey]) throw SaveErr('BAD_REQUEST', 'Only a PM, reefer service or annual inspection goes to the garage');
  return out;
}

/*
 * Fleet Service Setup (the current app's FleetService.html Setup tab, 220_V7276 udpoV7276SaveRules_ / SaveUnit_ / SaveTech_),
 * managers and administrators:
 *   saveFleetRules  config/fleetRules: PM miles and warning, reefer months / hours / warning days, DOT months / warning, plate warning.
 *   saveFleetUnit   fleetSetup/<unit>: track due dates (YES / NO / blank = default), last service date / miles / hours, reefer
 *                   hours now, DOT due, plate expires, notes.
 *   saveGarageTech  garageTechs/<id>: add a technician, rename, turn on or off, and set or reset the login ID (5 or 6 digits, kept
 *                   only as a hash in garageLogins, never readable; two technicians cannot share one).
 * These stay in the new app (like the work orders made here): a later change to the same row in the sheet copy replaces them.
 * Joe 10/13: each plant has its own (facilityId, a known plant, Uniontown when not sent): Uniontown's rules stay in
 * config/fleetRules, another plant's in config/fleetRules_<plant>; a technician or unit row added here carries its plant.
 */
const RULES_DOC = 'fleetRules';
const rulesDocFor = (facilityId) => !facilityId || facilityId === FACILITY ? RULES_DOC : RULES_DOC + '_' + facilityId;
const RULE_LIMITS = { truckMiles: [1000, 100000], truckWarnMiles: [0, 20000], trailerMonths: [1, 24], trailerHours: [50, 10000], trailerWarnDays: [0, 120],
  dotMonths: [1, 24], dotWarnDays: [0, 180], plateWarnDays: [0, 180],
  // Trailers' own DOT and plate rules (Joe 10/13); blank = the trucks'.
  trailerDotMonths: [1, 24], trailerDotWarnDays: [0, 180], trailerPlateWarnDays: [0, 180] };
// The rules in force: the saved ones over the current app's defaults (L.FLEET_RULES).
function fleetRules(saved) {
  const out = Object.assign({}, L.FLEET_RULES);
  Object.keys(RULE_LIMITS).forEach(k => { const n = Number(saved && saved[k]); if (saved && saved[k] !== '' && saved[k] != null && Number.isFinite(n)) out[k] = n; });
  return out;
}
const loginKey = (loginId) => sha('UDPO-GARAGE-ID|' + String(loginId).trim());
const ymdOrBlank = (v, label) => {
  const t = text(v, 40); if (!t) return '';
  const k = L.dateKey(t); if (!k) throw SaveErr('BAD_REQUEST', label + ' must be a date'); return k;
};
const numOrBlank = (v, label, max) => {
  const t = String(v === null || v === undefined ? '' : v).replace(/[, ]+/g, '').trim(); if (!t) return '';
  const n = Number(t); if (!Number.isFinite(n) || n < 0 || n > max) throw SaveErr('BAD_REQUEST', label + ' must be a number from 0 to ' + max.toLocaleString());
  return String(n);
};

function validateFleet(action, input, out) {
  input = input || {};
  out.facilityId = text(input.facilityId, 60) || FACILITY;
  if (!(L.PLANTS || []).some(p => p.id === out.facilityId)) throw SaveErr('BAD_REQUEST', 'Unknown plant');
  if (action === 'saveFleetRules') {
    out.rules = {};
    Object.keys(RULE_LIMITS).forEach(k => {
      if (input.rules == null || input.rules[k] === undefined) return;
      const n = Number(input.rules[k]), [lo, hi] = RULE_LIMITS[k];
      if (!Number.isInteger(n) || n < lo || n > hi) throw SaveErr('BAD_REQUEST', 'Each rule must be a whole number (' + k + ': ' + lo + ' to ' + hi + ')');
      out.rules[k] = n;
    });
    if (!Object.keys(out.rules).length) throw SaveErr('BAD_REQUEST', 'Nothing to save');
    if (out.rules.truckWarnMiles !== undefined && out.rules.truckMiles !== undefined && out.rules.truckWarnMiles >= out.rules.truckMiles) throw SaveErr('BAD_REQUEST', 'The PM warning must be fewer miles than the PM interval');
    return out;
  }
  if (action === 'saveFleetUnit') {
    out.unit = text(input.unit, 20).toUpperCase();
    if (!out.unit) throw SaveErr('BAD_REQUEST', 'Pick the unit');
    out.unitType = text(input.unitType, 10).toUpperCase() === 'TRAILER' ? 'TRAILER' : 'TRUCK';
    const f = input.fields || {}, t = text(f.track, 10).toUpperCase();
    out.fields = {};
    if (f.track !== undefined) out.fields.track = t === 'YES' || t === 'NO' ? t : '';
    [['last_service_date', 'Last service date'], ['dot_due', 'Annual inspection due'], ['plate_expires', 'Plate expires']].forEach(([k, l]) => { if (f[k] !== undefined) out.fields[k] = ymdOrBlank(f[k], l); });
    [['last_service_miles', 'Last service miles', 3000000], ['last_service_hours', 'Last service hours', 200000], ['current_hours', 'Reefer hours now', 200000]].forEach(([k, l, m]) => { if (f[k] !== undefined) out.fields[k] = numOrBlank(f[k], l, m); });
    if (f.notes !== undefined) out.fields.notes = text(f.notes, 300);
    if (!Object.keys(out.fields).length) throw SaveErr('BAD_REQUEST', 'Nothing to save');
    return out;
  }
  // saveGarageTech
  out.op = text(input.op, 10).toUpperCase();
  if (['ADD', 'NAME', 'ACTIVE', 'LOGIN'].indexOf(out.op) < 0) throw SaveErr('BAD_REQUEST', 'Unknown technician change');
  out.techId = text(input.techId, 80);
  if (out.op !== 'ADD' && !out.techId) throw SaveErr('BAD_REQUEST', 'Pick the technician');
  if (out.op === 'ADD' || out.op === 'NAME') { out.name = text(input.name, 40).toUpperCase(); if (!out.name) throw SaveErr('BAD_REQUEST', 'Type the technician\'s name'); }
  if (out.op === 'ACTIVE') out.active = input.active === true;
  if (out.op === 'ADD' || out.op === 'LOGIN') {
    out.loginId = String(input.loginId == null ? '' : input.loginId).trim();
    if (out.op === 'LOGIN' || out.loginId) { if (!/^\d{5,6}$/.test(out.loginId)) throw SaveErr('BAD_REQUEST', 'The login ID is 5 or 6 digits'); }
  }
  return out;
}

async function saveFleet(tx, db, req, email, stamp, logRef, mode) {
  const result = { ok: true, requestId: req.requestId, runs: [] };
  if (req.action === 'saveFleetRules') {
    const ref = db.collection('config').doc(rulesDocFor(req.facilityId)), snap = await tx.get(ref), before = snap.exists ? snap.data() : null;
    const merged = fleetRules(Object.assign({}, before || {}, req.rules));
    if (merged.truckWarnMiles >= merged.truckMiles) throw SaveErr('BAD_REQUEST', 'The PM warning must be fewer miles than the PM interval');
    tx.set(ref, Object.assign({}, req.rules, { updatedAt: stamp, updatedBy: email }), { merge: true });
    result.rules = merged;
    tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, facilityId: req.facilityId, before, after: req.rules, result });
    return result;
  }
  if (req.action === 'saveFleetUnit') {
    const ref = db.collection('fleetSetup').doc(docId(req.unit)), snap = await tx.get(ref), before = snap.exists ? snap.data() : null;
    const change = Object.assign({}, req.fields, { updated_at: stamp, updated_by: email, testEdited: true, editedAt: stamp });
    if (before) tx.update(ref, change);
    else tx.set(ref, Object.assign({ unit: req.unit, unit_type: req.unitType, facility_id: req.facilityId || FACILITY, createdInApp: true }, change));
    tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, unit: req.unit, before, after: req.fields, result });
    return result;
  }
  // saveGarageTech
  let id = req.techId, ref, before = null;
  if (req.op === 'ADD') {
    const all = (await tx.get(db.collection(TECHS))).docs.map(d => d.data());
    if (all.some(t => text(t.name).toUpperCase() === req.name)) throw SaveErr('BAD_REQUEST', req.name + ' is already on the list');
    id = 'TECH-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    ref = db.collection(TECHS).doc(docId(id));
  } else {
    ref = db.collection(TECHS).doc(docId(id));
    const snap = await tx.get(ref); if (!snap.exists) throw SaveErr('NOT_FOUND', 'That technician is not on the list');
    before = snap.data();
  }
  let keyRef = null, oldKeyRef = null;
  if (req.loginId) {
    keyRef = db.collection(LOGINS).doc('id_' + loginKey(req.loginId));
    const [taken, mine] = await tx.getAll(keyRef, db.collection(LOGINS).doc(docId(id)));
    if (taken.exists && taken.data().techId !== id) throw SaveErr('BAD_REQUEST', 'Another technician already uses that login ID. Pick a different number.');
    if (mine.exists && mine.data().key && mine.data().key !== keyRef.id) oldKeyRef = db.collection(LOGINS).doc(mine.data().key);
  }
  if (req.op === 'ADD') tx.set(ref, { tech_id: id, name: req.name, active: 'YES', facility_id: req.facilityId || FACILITY, created_at: stamp, created_by: email, createdInApp: true });
  if (req.op === 'NAME') tx.update(ref, { name: req.name, updated_at: stamp, updated_by: email, testEdited: true });
  if (req.op === 'ACTIVE') tx.update(ref, { active: req.active ? 'YES' : 'NO', updated_at: stamp, updated_by: email, testEdited: true });
  if (keyRef) {
    // The hash the Garage Station checks (loginHash, salted with the technician), and a marker so no one else picks the same number.
    tx.set(db.collection(LOGINS).doc(docId(id)), { techId: id, hash: loginHash(id, req.loginId), key: keyRef.id, setAt: stamp, setBy: email });
    tx.set(keyRef, { techId: id, setAt: stamp });
    if (oldKeyRef) tx.delete(oldKeyRef);
    tx.delete(db.collection(LOCKS).doc(docId(id)));
  }
  result.techId = id; result.loginSet = !!keyRef;
  // The login ID itself is never logged.
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, techId: id, op: req.op, before, after: { name: req.name || null, active: req.op === 'ACTIVE' ? req.active : null, loginSet: !!keyRef }, result });
  return result;
}

/*
 * Review item 68 (Joe 10/13): the Maintenance Station board (technician names, the plant's open work orders and machines)
 * needs a signed-in United Dairy account or a valid station code, like the other station reads. caller (index.js) is
 * {user, claims}: user from unitedDairyUser, claims the token's claims (a Plant Station signed in by its code alone).
 */
async function maintBoardAllowed(db, input, caller) {
  if (caller && caller.user) return;
  const ST = require('./stations'), facilityId = text(input.facilityId, 60) || FACILITY;
  const plantStation = await ST.stationSaver(db, caller && caller.claims);
  if (plantStation && plantStation.facilityId === facilityId) return;
  const st = input.station || {};
  if (st.key) {
    const ok = await ST.check(db, 'GARAGE', st.key, st.version);
    if (ok.ok && ok.station.set && ok.station.facilityId === facilityId) return;
  }
  throw SaveErr('NOT_ALLOWED', 'Sign in with a United Dairy account, or enter the station code, to open the Maintenance Station.');
}

/*
 * One Garage Station call: {op: 'read' | 'signIn' | 'signOut' | 'step', tokens, ...}. Throws SaveError. caller: who is
 * calling, as index.js knows it from the sign-in ({user, claims}); only the Maintenance Station board looks at it.
 */
async function garageCall(db, input, now, caller) {
  input = input || {};
  const nowMs = (now ? now() : new Date()).getTime(), op = String(input.op || '');
  // Garage station codes (Joe 10/12, stations.js): once the garage has a code, the tablet types it once and sends the
  // station it opened with every call; Change needs the plant's manager release code.
  const ST = require('./stations'), asSave = (e) => { if (e instanceof ST.StationError || e instanceof require('./admin').AdminError) throw SaveErr(e.code, e.message); throw e; };
  if (op === 'station') return ST.tabletCall(db, { op: input.step, kind: 'GARAGE', code: input.code, key: input.key, version: input.version, facilityId: FACILITY, who: input.who }, () => new Date(nowMs)).catch(asSave);
  // Review item 49 (Joe 10/13): the Maintenance Station (maint: true) locks too; its Release checks its own plant's manager release code.
  const releaseFac = input.maint === true && /^fac_[a-z_]{1,40}$/.test(String(input.facilityId || '')) ? input.facilityId : FACILITY;
  if (op === 'release') return require('./admin').releaseCheck(db, { op: input.step === 'status' ? 'status' : 'release', facilityId: releaseFac, code: input.code, who: input.who }, () => new Date(nowMs)).catch(asSave);
  // Plant Maintenance's Maintenance Station (Joe 10/12): the same technicians and sign-in, the plant's work orders. It is not
  // the garage tablet, so the garage's station code does not lock it; every step still needs a mechanic's login ID.
  if (op === 'pmBoard') { await maintBoardAllowed(db, input, caller); return require('./plantmaint').stationBoard(db, input, nowMs); }
  if (op === 'pmStep') return require('./plantmaint').stationStep(db, input, nowMs);
  const maintSignIn = input.maint === true && (op === 'signIn' || op === 'signOut');
  if (!maintSignIn && await ST.needsCode(db, 'GARAGE', FACILITY)) {
    const st = input.station || {}, ok = await ST.check(db, 'GARAGE', st.key, st.version);
    if (!ok.ok) throw SaveErr('NOT_ALLOWED', 'STATION_CODE: ' + ok.message.replace('This station', 'This garage tablet').replace(/Enter a station code\.|Enter it.*$/, 'Enter the garage station code.'));
  }
  if (op === 'read') return read(db, input, nowMs);
  if (op === 'board') return board(db, nowMs);
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

module.exports = { G, signedInTechs, renew, fleetRules, validateFleet, saveFleet, RULES_DOC, rulesDocFor, garageCall, loginHash, activeTechs, garageUnits, garageJobs, matchUnit, realWriteUp, unitText, jobOf, sendToGarage, validateSend, writeUpOrderStep, LOGINS };
