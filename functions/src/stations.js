/*
 * Station codes (Joe 10/12, as the current app's Plant Station kiosk 057_V774 and its App Links): every tablet station has
 * its own code. Typing the code on a tablet opens that station, and the tablet keeps it until a manager types the plant's
 * release code (Administration > Plant Station Codes). Three kinds, each on its own Administration page:
 *
 *   PLANT   Plant Station tablets (plant-station.html): Case Loadout, Case Unloading, Tote, Boxing, Yard Services
 *   GARAGE  Garage Station tablets (garage-station.html)
 *   KIOSK   Driver Room kiosks and TVs (driver-station.html); a plant may have its own kiosk too
 *
 * Kept in private/stations (server only). A code is shown to administrators (like the release codes) and checked by its
 * salted hash; a new code changes the station's version, so every tablet on the old code asks again. Until a kind has a
 * code at a plant, its tablets work as before (the Plant Station picks its station from the list, the Garage Station and
 * the kiosk open straight away), so nothing stops working before the codes are made.
 */
'use strict';

const crypto = require('crypto');
const L = require('./logic');

const DOC = (db) => db.collection('private').doc('stations');
const FAILS = (db) => db.collection('private').doc('stationFails');
const KINDS = Object.freeze({
  PLANT: { label: 'Plant Station', types: { CASE: 'Case Loadout', CASE_UNLOADING: 'Case Unloading', TOTES: 'Tote Loadout', BOXING: 'Boxing Loadout', YARD_SERVICES: 'Yard Services' } },
  GARAGE: { label: 'Garage Station', types: { GARAGE: 'Garage' } },
  KIOSK: { label: 'Kiosk', types: { DRIVER: 'Driver Station (tablet)', TV: 'TV display' } }
});
// What each plant starts with: the current app's five stations, its garage, and the Driver Room tablet and TV.
const STARTERS = [
  ['PLANT', 'CASE', 'Case Loadout'], ['PLANT', 'CASE_UNLOADING', 'Case Unloading'], ['PLANT', 'TOTES', 'Tote Loadout'], ['PLANT', 'BOXING', 'Boxing Loadout'],
  ['PLANT', 'YARD_SERVICES', 'Yard Services'], ['GARAGE', 'GARAGE', 'Garage'], ['KIOSK', 'DRIVER', 'Driver Room kiosk'], ['KIOSK', 'TV', 'Driver Room TV']
];
const MAX_FAILS_PER_MINUTE = 30;

const text = (v, max) => String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 80);
const normCode = (v) => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const hash = (salt, code) => crypto.createHash('sha256').update('UDPO-STATION|' + salt + '|' + code).digest('base64url');
const sameHash = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const newCode = () => Array.from(crypto.randomBytes(6)).map(b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
const plants = () => L.PLANTS.filter(p => p.status === 'ACTIVE');
const plantName = (id) => (L.PLANTS.find(p => p.id === id) || {}).name || id;
class StationError extends Error { constructor(code, message) { super(message); this.code = code; } }
const fail = (code, message) => { throw new StationError(code, message); };

// The stations as stored, with each plant's starters until the list was first changed.
function listOf(d) {
  if (d && d.list) return d.list;
  const list = {};
  plants().forEach(p => STARTERS.forEach(([kind, type, name]) => { const key = (p.id + '_' + kind + '_' + type).toLowerCase(); list[key] = { key, kind, type, name, facilityId: p.id, order: Object.keys(list).length }; }));
  return list;
}
async function read(db) { const s = await DOC(db).get(); return listOf(s.exists ? s.data() : null); }
// What a screen may know about a station (never the salt or hash; the code only for administrators).
function shown(s, admin) {
  const out = { key: s.key, kind: s.kind, type: s.type, typeName: KINDS[s.kind].types[s.type] || s.type, name: s.name, facilityId: s.facilityId, plant: plantName(s.facilityId), set: !!s.hash };
  if (admin) Object.assign(out, { code: s.code || '', changedAt: s.changedAt || '', changedBy: s.changedBy || '' });
  else out.version = s.version || '';
  return out;
}
const sorted = (list, kind) => Object.keys(list).map(k => list[k]).filter(s => !kind || s.kind === kind)
  .sort((a, b) => plantName(a.facilityId).localeCompare(plantName(b.facilityId)) || (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name));

/* ---------- Administration (admin.js checks the Administrator) ---------- */

async function stations(db, email, input) {
  const kind = KINDS[input.kind] ? input.kind : 'PLANT';
  return { kind, stations: sorted(await read(db), kind).map(s => shown(s, true)), types: Object.keys(KINDS[kind].types).map(id => ({ id, name: KINDS[kind].types[id] })), plants: plants().map(p => ({ id: p.id, name: p.name })) };
}

async function change(db, fn) {
  return db.runTransaction(async tx => {
    const snap = await tx.get(DOC(db)), list = Object.assign({}, listOf(snap.exists ? snap.data() : null));
    const out = fn(list);
    tx.set(DOC(db), { list });
    return out;
  });
}

async function stationAdd(db, email, input, stamp) {
  const kind = KINDS[input.kind] ? input.kind : fail('BAD_REQUEST', 'Pick what kind of station.');
  const type = KINDS[kind].types[input.type] ? input.type : fail('BAD_REQUEST', 'Pick the station type.');
  const facilityId = plants().some(p => p.id === input.facilityId) ? input.facilityId : fail('BAD_REQUEST', 'Pick a plant.');
  const name = text(input.name, 60) || fail('BAD_REQUEST', 'Name the station, for example "Case Loadout dock 2".');
  await change(db, list => {
    if (Object.keys(list).some(k => list[k].kind === kind && list[k].facilityId === facilityId && list[k].name.toUpperCase() === name.toUpperCase())) fail('BAD_REQUEST', plantName(facilityId) + ' already has a station named ' + name + '.');
    const key = 'st_' + crypto.randomBytes(5).toString('hex');
    list[key] = { key, kind, type, name, facilityId, order: Object.keys(list).length, createdAt: stamp, createdBy: email };
  });
  return Object.assign({ ok: true, message: name + ' added. Press New code to give it a code.' }, await stations(db, email, { kind }));
}

async function stationCode(db, email, input, stamp) {
  const key = text(input.key, 40);
  const code = newCode(), salt = crypto.randomBytes(12).toString('hex');
  const s = await change(db, list => {
    if (!list[key]) fail('NOT_FOUND', 'That station is gone; press Refresh.');
    list[key] = Object.assign({}, list[key], { salt, hash: hash(salt, code), code, version: crypto.randomUUID(), changedAt: stamp, changedBy: email });
    return list[key];
  });
  return Object.assign({ ok: true, code, message: 'New code for ' + s.name + ': ' + code + '. A tablet on the old code asks for this one.' }, await stations(db, email, { kind: s.kind }));
}

async function stationRemove(db, email, input) {
  const key = text(input.key, 40);
  const s = await change(db, list => { if (!list[key]) fail('NOT_FOUND', 'That station is gone; press Refresh.'); const was = list[key]; delete list[key]; return was; });
  return Object.assign({ ok: true, message: s.name + ' removed. A tablet on its code asks for a new code.' }, await stations(db, email, { kind: s.kind }));
}

/* ---------- The tablets ---------- */

// Whether this kind of station needs a code at the plant (any of them has one).
async function needsCode(db, kind, facilityId) {
  const list = await read(db);
  return Object.keys(list).some(k => list[k].kind === kind && list[k].facilityId === (facilityId || 'fac_uniontown') && list[k].hash);
}

// A typed code: the station it opens, or {ok:false, message}. 30 wrong codes a minute across all tablets, then a wait.
async function enter(db, kind, code, now) {
  const given = normCode(code), minute = new Date(now).toISOString().slice(0, 16);
  const list = await read(db);
  const hit = Object.keys(list).map(k => list[k]).find(s => s.kind === kind && s.hash && given.length >= 6 && sameHash(hash(s.salt, given), s.hash));
  return db.runTransaction(async tx => {
    const f = ((await tx.get(FAILS(db))).data() || {})[kind] || {}, count = f.minute === minute ? f.count || 0 : 0;
    if (count >= MAX_FAILS_PER_MINUTE) return { ok: false, message: 'Too many wrong station codes. Wait a minute and try again.' };
    if (!hit) { tx.set(FAILS(db), { [kind]: { minute, count: count + 1 } }, { merge: true }); return { ok: false, message: 'That station code was not recognized.' }; }
    return { ok: true, station: shown(hit, false) };
  });
}

// A tablet's remembered station: still there, and still on the same code?
async function check(db, kind, key, version) {
  const s = (await read(db))[text(key, 40)];
  if (!s || s.kind !== kind) return { ok: false, message: 'This station was removed. Enter a station code.' };
  if (s.hash && s.version !== String(version || '')) return { ok: false, message: 'This station has a new code. Enter it to open the station again.' };
  return { ok: true, station: shown(s, false) };
}

/*
 * The tablets' call (stationRelease for signed-in tablets, garage for the Garage Station): op 'has' {kind, facilityId},
 * 'enter' {kind, code}, 'check' {kind, key, version}.
 */
async function tabletCall(db, input, now) {
  const kind = KINDS[input.kind] ? input.kind : fail('BAD_REQUEST', 'Unknown station kind');
  const t = (now ? now() : new Date()).getTime();
  if (input.op === 'has') return { required: await needsCode(db, kind, text(input.facilityId, 60)) };
  if (input.op === 'enter') return enter(db, kind, input.code, t);
  if (input.op === 'check') return check(db, kind, input.key, input.version);
  fail('BAD_REQUEST', 'Unknown station step');
}

module.exports = { KINDS, STARTERS, stations, stationAdd, stationCode, stationRemove, needsCode, tabletCall, StationError, MAX_FAILS_PER_MINUTE, read, check };
