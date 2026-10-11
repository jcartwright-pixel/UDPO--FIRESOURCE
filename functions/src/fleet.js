/*
 * United Dairy Distribution app: Fleet Service Setup's saves (the current app's FleetService.html Setup, 220_V7276 RULES /
 * UNIT / TECH), managers and administrators only.
 *
 * - Rules (Joe 10/11, review item 24): PM every N miles and the warning, reefer every N months or hours and the warning,
 *   DOT every N months and the warning, plate warning. Kept in config/fleetRules; Fleet Service's due dates and the
 *   Garage Station's DOT date use them. A blank box keeps the rule as it was.
 * - A unit (item 25): track due dates, last service date / miles / hours, reefer hours now, DOT due, plate expiry, notes,
 *   into `fleetSetup` (the FLEET SERVICE SETUP copy). Like every sandbox test save, it stays until that sheet row changes.
 * - A technician (item 26): add one, rename, turn on or off, and set the login ID the Garage Station asks for (5 or 6
 *   numbers, leading zeros kept). Only a hash of the login ID is kept, in `garageLogins`, as the copy does (garage.js).
 */
'use strict';

const crypto = require('crypto');
const L = require('./logic');

const FACILITY = 'fac_uniontown';
const RULE_KEYS = Object.keys(L.FLEET_RULES);
const docId = (id) => String(id).replace(/[^A-Za-z0-9_-]+/g, '_');
const text = (v, max) => String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 200);
const blank = (v) => v === undefined || v === null || String(v).trim() === '';
const number = (v) => { const s = String(v).replace(/[, ]+/g, '').trim(); const n = Number(s); return s !== '' && isFinite(n) ? n : null; };

// The rules in force: the saved ones over the defaults.
function rulesOf(saved) {
  const out = Object.assign({}, L.FLEET_RULES), given = (saved && saved.rules) || {};
  RULE_KEYS.forEach(k => { const n = number(given[k]); if (n !== null && n > 0) out[k] = n; });
  return out;
}

function validateRules(input, out, SaveError) {
  const given = input.rules && typeof input.rules === 'object' ? input.rules : {};
  out.rules = {};
  RULE_KEYS.forEach(k => {
    if (blank(given[k])) return;
    const n = number(given[k]);
    if (n === null || n <= 0 || n > 1000000) throw new SaveError('BAD_REQUEST', 'Enter a number above zero for every rule.');
    out.rules[k] = n;
  });
  if (!Object.keys(out.rules).length) throw new SaveError('BAD_REQUEST', 'Type at least one rule.');
  return out;
}
async function saveRules(tx, db, req, email, stamp, logRef, mode) {
  const ref = db.collection('config').doc('fleetRules'), snap = await tx.get(ref);
  const before = rulesOf(snap.exists ? snap.data() : null), rules = Object.assign({}, before, req.rules);
  tx.set(ref, { rules, updated_at: stamp, updated_by: email });
  const result = { ok: true, requestId: req.requestId, rules, runs: [] };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, before, after: rules, result });
  return result;
}

function validateUnit(input, out, SaveError) {
  out.unit = text(input.unit, 20).toUpperCase();
  if (!out.unit) throw new SaveError('BAD_REQUEST', 'Pick the truck or trailer.');
  out.unitType = text(input.unitType, 10).toUpperCase() === 'TRAILER' ? 'TRAILER' : 'TRUCK';
  out.track = input.track === true ? 'YES' : input.track === false ? 'NO' : '';
  const date = (v, label) => { if (blank(v)) return ''; const k = L.dateKey(v); if (!k) throw new SaveError('BAD_REQUEST', label + ': enter a date like 10/31/2026.'); return k; };
  const num = (v, label) => { if (blank(v)) return ''; const n = number(v); if (n === null || n < 0 || n > 10000000) throw new SaveError('BAD_REQUEST', label + ': enter a number.'); return String(n); };
  out.fields = { track: out.track, last_service_date: date(input.lastServiceDate, 'Last service'), last_service_miles: num(input.lastServiceMiles, 'Last service miles'),
    last_service_hours: num(input.lastServiceHours, 'Last service hours'), current_hours: num(input.currentHours, 'Reefer hours now'), dot_due: date(input.dotDue, 'DOT due'),
    plate_expires: date(input.plateExpires, 'Plate expires'), notes: text(input.notes, 200) };
  return out;
}
async function saveUnit(tx, db, req, email, stamp, logRef, mode, SaveError, garageUnits) {
  const units = garageUnits((await tx.get(db.collection('equipment'))).docs.map(d => d.data()));
  const unit = units.find(u => u.unit.toUpperCase() === req.unit);
  if (!unit) throw new SaveError('NOT_FOUND', req.unit + ' is not one of our trucks or trailers.');
  const ref = db.collection('fleetSetup').doc(docId(unit.unit)), snap = await tx.get(ref);
  const change = Object.assign({}, req.fields, { unit_type: unit.type, updated_at: stamp, updated_by: email });
  const before = {};
  if (snap.exists) { Object.keys(change).forEach(k => { before[k] = snap.data()[k] === undefined ? null : snap.data()[k]; }); tx.update(ref, Object.assign({}, change, { testEdited: true, editedAt: stamp, editedBy: email })); }
  else tx.set(ref, Object.assign({ unit: unit.unit, facility_id: FACILITY, createdInApp: true }, change));
  const result = { ok: true, requestId: req.requestId, unit: unit.unit, saved: req.fields, runs: [] };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, unit: unit.unit, before, after: change, result });
  return result;
}

function validateTech(input, out, SaveError) {
  out.techId = text(input.techId, 80);
  out.name = text(input.name, 40);
  if (!out.name) throw new SaveError('BAD_REQUEST', 'Type the technician name.');
  out.active = input.active !== false;
  out.loginId = String(input.loginId === undefined || input.loginId === null ? '' : input.loginId).trim();
  if (out.loginId && !/^\d{5,6}$/.test(out.loginId)) throw new SaveError('BAD_REQUEST', 'The login ID is 5 or 6 numbers.');
  if (!out.techId && !out.loginId) throw new SaveError('BAD_REQUEST', 'Give the new technician a login ID (6 numbers).');
  return out;
}
async function saveTech(tx, db, req, email, stamp, logRef, mode, SaveError, loginHash) {
  const techs = (await tx.get(db.collection('garageTechs'))).docs.map(d => ({ ref: d.ref, data: d.data() }));
  const logins = req.loginId ? (await tx.get(db.collection('garageLogins'))).docs.map(d => d.data()) : [];
  const ours = (t) => !t.facility_id || t.facility_id === FACILITY;
  const on = (t) => L.yes(t.active === undefined || t.active === '' ? 'YES' : t.active);
  let current = null;
  if (req.techId) { current = techs.find(t => String(t.data.tech_id) === req.techId); if (!current) throw new SaveError('NOT_FOUND', 'That technician is not on the list any more.'); }
  const id = current ? req.techId : 'TECH-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  if (req.active && techs.some(t => String(t.data.tech_id) !== id && ours(t.data) && on(t.data) && text(t.data.name).toUpperCase() === req.name.toUpperCase())) throw new SaveError('BAD_REQUEST', req.name + ' is already on the list.');
  // Two mechanics cannot share a login ID (it is kept only as a hash salted with each one's id, so each is checked).
  if (req.loginId) {
    const taken = logins.filter(l => l.techId && l.techId !== id).find(l => l.hash === loginHash(l.techId, req.loginId));
    const owner = taken && techs.find(t => String(t.data.tech_id) === taken.techId);
    if (owner && on(owner.data)) throw new SaveError('BAD_REQUEST', 'That login ID belongs to ' + text(owner.data.name) + '. Pick another.');
  }
  const change = { name: req.name, active: req.active ? 'YES' : 'NO', updated_at: stamp, updated_by: email };
  if (current) tx.update(current.ref, Object.assign({}, change, { testEdited: true, editedAt: stamp, editedBy: email }));
  else tx.set(db.collection('garageTechs').doc(docId(id)), Object.assign({ tech_id: id, facility_id: FACILITY, created_at: stamp, created_by: email, createdInApp: true }, change));
  if (req.loginId) tx.set(db.collection('garageLogins').doc(docId(id)), { techId: id, hash: loginHash(id, req.loginId), updated_at: stamp, updated_by: email, testEdited: true });
  const result = { ok: true, requestId: req.requestId, techId: id, name: req.name, active: req.active, loginSet: !!req.loginId, runs: [] };
  // The login ID itself is never logged.
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, techId: id, before: current ? { name: current.data.name || '', active: current.data.active || '' } : null, after: Object.assign({}, change, { loginId: req.loginId ? '(set)' : '(unchanged)' }), result });
  return result;
}

module.exports = { RULE_KEYS, rulesOf, validateRules, saveRules, validateUnit, saveUnit, validateTech, saveTech };
