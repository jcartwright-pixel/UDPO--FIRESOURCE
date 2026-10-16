/*
 * Station codes (Joe 10/12, as the current app's Plant Station kiosk 057_V774 and its App Links): every tablet station has
 * its own code. Typing the code on a tablet opens that station, and the tablet keeps it until a manager types the plant's
 * release code (Administration > Manager Links). Three kinds, each on its own Administration page:
 *
 *   PLANT   Plant Station tablets (plant-station.html): Case Loadout, Case Unloading, Tote, Boxing, Yard Services
 *   GARAGE  Garage Station tablets (garage-station.html)
 *   KIOSK   Driver Room kiosks and TVs (driver-station.html); a plant may have its own kiosk too
 *
 * Kept in private/stations (server only). A code is shown to administrators (like the release codes) and checked by its
 * salted hash; a new code changes the station's version, so every tablet on the old code asks again. Until a kind has a
 * code at a plant, its tablets work as before (the Plant Station picks its station from the list, the Garage Station and
 * the kiosk open straight away), so nothing stops working before the codes are made.
 *
 * Plant Station with no UD account (Joe 10/12, the old app's public Plant Station): each plant has an On / Off switch
 * (noAccount). While it is On, a tablet with no United Dairy account types a plant station's code and the server signs it
 * in as that station only (signIn below; index.js makes the sign-in token). stationAccess/{plant} mirrors what the database
 * rules need to let such a tablet read the plant screens: the switch and each coded station's version, so Off, New code
 * and Remove shut it out at once. Its saves are only the plant-floor ones (STATION_ACTIONS).
 *
 * Send to TV (Joe 10/16, his Vizio has no browser, only Chromecast built in): a signed-in manager presses Send to TV and
 * picks the TV; the TV opens our own Cast receiver (driver-station.html?tv=1&cast=1) and is signed in as that Driver's
 * Kiosk Station only (tvSend below; index.js makes the token). stationAccess/tv mirrors each TV station's version for the
 * database rules, so New code and Remove shut the TV out at once. castAppId is the Google Cast App ID Joe registers once.
 */
'use strict';

const crypto = require('crypto');
const L = require('./logic');
const F = require('./fails');

const DOC = (db) => db.collection('private').doc('stations');
const FAILS = (db) => db.collection('private').doc('stationFails');
const KINDS = Object.freeze({
  PLANT: { label: 'Plant Station', types: { CASE: 'Case Loadout', CASE_UNLOADING: 'Case Unloading', TOTES: 'Tote Loadout', BOXING: 'Boxing Loadout', YARD_SERVICES: 'Yard Services' } },
  GARAGE: { label: 'Garage Station', types: { GARAGE: 'Garage' } },
  // Joe 10/12: "Driver Room Check-In Station" (the drivers' tablet) and "Driver's Kiosk Station" (the TV: rolling loadout,
  // dispatch and weather).
  KIOSK: { label: 'Kiosk', types: { DRIVER: 'Driver Room Check-In Station', TV: "Driver's Kiosk Station" } }
});
// What each plant starts with: the current app's five stations, its garage, and the Driver Room tablet and TV.
const STARTERS = [
  ['PLANT', 'CASE', 'Case Loadout'], ['PLANT', 'CASE_UNLOADING', 'Case Unloading'], ['PLANT', 'TOTES', 'Tote Loadout'], ['PLANT', 'BOXING', 'Boxing Loadout'],
  ['PLANT', 'YARD_SERVICES', 'Yard Services'], ['GARAGE', 'GARAGE', 'Garage'], ['KIOSK', 'DRIVER', 'Driver Room Check-In Station'], ['KIOSK', 'TV', "Driver's Kiosk Station"]
];
const MAX_FAILS_PER_MINUTE = 30;
// The saves a Plant Station signed in by its code alone may make: loading, pickups, the loading order, unloading, washing
// and returns (the screens the Plant Station opens). Nothing else.
const STATION_ACTIONS = Object.freeze(['savePlantLoad', 'addPickup', 'completePickup', 'reorderPlantLoads', 'saveUnloading', 'completeWash', 'addReturn']);
const ACCESS = (db, facilityId) => db.collection('stationAccess').doc(facilityId);

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
// Joe 10/12: the Driver Room's two starter stations kept their first names in a saved list; they show Joe's names now.
const RENAMED = { 'DRIVER|Driver Room kiosk': 'Driver Room Check-In Station', 'TV|Driver Room TV': "Driver's Kiosk Station" };
function listOf(d) {
  if (d && d.list) { Object.values(d.list).forEach(s => { if (s.kind === 'KIOSK' && RENAMED[s.type + '|' + s.name]) s.name = RENAMED[s.type + '|' + s.name]; }); return d.list; }
  const list = {};
  plants().forEach(p => STARTERS.forEach(([kind, type, name]) => { const key = (p.id + '_' + kind + '_' + type).toLowerCase(); list[key] = { key, kind, type, name, facilityId: p.id, order: Object.keys(list).length }; }));
  return list;
}
async function readAll(db) { const s = await DOC(db).get(), d = s.exists ? s.data() : {}; return { list: listOf(d), noAccount: d.noAccount || {}, castAppId: d.castAppId || '' }; }
async function read(db) { return (await readAll(db)).list; }
// What the database rules read for the no-account Plant Station: the plant's switch and its coded stations' versions.
function access(list, noAccount, facilityId) {
  const keys = {};
  Object.keys(list).forEach(k => { const s = list[k]; if (s.kind === 'PLANT' && s.facilityId === facilityId && s.hash && s.version) keys[k] = s.version; });
  return { on: noAccount[facilityId] === true, keys };
}
// What the database rules read for a TV sent by Send to TV: each Driver's Kiosk Station's version ('open' before its first code).
const TV_ACCESS = (db) => db.collection('stationAccess').doc('tv');
function tvAccess(list) {
  const keys = {};
  Object.keys(list).forEach(k => { const s = list[k]; if (s.kind === 'KIOSK' && s.type === 'TV') keys[k] = s.version || 'open'; });
  return { keys };
}
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
  const all = await readAll(db);
  return { kind, castAppId: all.castAppId, noAccount: plants().map(p => ({ id: p.id, name: p.name, on: all.noAccount[p.id] === true })), stations: sorted(all.list, kind).map(s => shown(s, true)), types: Object.keys(KINDS[kind].types).map(id => ({ id, name: KINDS[kind].types[id] })), plants: plants().map(p => ({ id: p.id, name: p.name })) };
}

// Every change rewrites the list and keeps stationAccess (the rules' copy) in step, in one transaction.
async function change(db, fn) {
  return db.runTransaction(async tx => {
    const snap = await tx.get(DOC(db)), d = snap.exists ? snap.data() : {}, list = Object.assign({}, listOf(d)), noAccount = Object.assign({}, d.noAccount || {});
    const out = fn(list, noAccount);
    tx.set(DOC(db), Object.assign({}, d, { list, noAccount }));
    plants().forEach(p => tx.set(ACCESS(db, p.id), access(list, noAccount, p.id)));
    tx.set(TV_ACCESS(db), tvAccess(list));
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

// The no-account Plant Station's On / Off switch for one plant (Off: nobody gets in on a code alone).
async function noAccountSet(db, email, input, stamp) {
  const facilityId = plants().some(p => p.id === input.facilityId) ? input.facilityId : fail('BAD_REQUEST', 'Pick a plant.');
  const on = input.on === true;
  await change(db, (list, noAccount) => { noAccount[facilityId] = on; });
  return Object.assign({ ok: true, message: plantName(facilityId) + ' Plant Station with no UD account is ' + (on ? 'On' : 'Off') + '.' }, await stations(db, email, { kind: 'PLANT' }));
}

// The Google Cast App ID for Send to TV (Joe registers the receiver once at cast.google.com/publish; 8 letters and numbers).
async function castAppSet(db, email, input, stamp) {
  const id = String(input.castAppId || '').trim().toUpperCase();
  if (id && !/^[0-9A-F]{8}$/.test(id)) fail('BAD_REQUEST', 'The Cast App ID is 8 letters and numbers, like 1A2B3C4D.');
  await DOC(db).set({ castAppId: id, castAppSetAt: stamp, castAppSetBy: email }, { merge: true });
  return Object.assign({ ok: true, message: id ? 'Cast App ID saved. Send to TV is ready.' : 'Cast App ID cleared.' }, await stations(db, email, { kind: 'KIOSK' }));
}

/* ---------- Send to TV (any active signed-in person; index.js makes the TV's token) ---------- */

// 'tvList': the Cast App ID and the Driver's Kiosk Stations a manager can send to.
// 'tvSend' {key}: that TV station, its version for the token, and stationAccess/tv brought up to date.
async function tvCall(db, input) {
  const all = await readAll(db);
  const tvs = sorted(all.list, 'KIOSK').filter(s => s.type === 'TV');
  if (input.op === 'tvList') return { castAppId: all.castAppId, tvs: tvs.map(s => ({ key: s.key, name: s.name, facilityId: s.facilityId, plant: plantName(s.facilityId) })) };
  if (input.op !== 'tvSend') fail('BAD_REQUEST', 'Unknown Send to TV step');
  const s = tvs.find(t => t.key === text(input.key, 40));
  if (!s) return { ok: false, message: 'That Driver\'s Kiosk Station is gone. Refresh and pick the TV again.' };
  await TV_ACCESS(db).set(tvAccess(all.list));
  return { ok: true, station: { key: s.key, name: s.name, type: s.type, facilityId: s.facilityId, plant: plantName(s.facilityId), version: s.version || 'open' } };
}

/* ---------- The tablets ---------- */

// Whether this kind of station needs a code at the plant (any of them has one).
async function needsCode(db, kind, facilityId) {
  const list = await read(db);
  return Object.keys(list).some(k => list[k].kind === kind && list[k].facilityId === (facilityId || 'fac_uniontown') && list[k].hash);
}

// A typed code: the station it opens, or {ok:false, message}. 30 wrong codes a minute from one tablet (fails.js), then that
// tablet waits; the others are not held up.
async function enter(db, kind, code, now, device) {
  const given = normCode(code), minute = new Date(now).toISOString().slice(0, 16);
  const list = await read(db);
  const hit = Object.keys(list).map(k => list[k]).find(s => s.kind === kind && s.hash && given.length >= 6 && sameHash(hash(s.salt, given), s.hash));
  return db.runTransaction(async tx => {
    const byDevice = F.current(((await tx.get(FAILS(db))).data() || {})[kind], f => f.minute === minute), count = (byDevice[device] || {}).count || 0;
    if (count >= MAX_FAILS_PER_MINUTE) return { ok: false, message: 'Too many wrong station codes. Wait a minute and try again.' };
    if (!hit) { byDevice[device] = { minute, count: count + 1 }; tx.set(FAILS(db), { [kind]: byDevice }, { mergeFields: [kind] }); return { ok: false, message: 'That station code was not recognized.' }; }
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
  if (input.op === 'enter') return enter(db, kind, input.code, t, F.who(input));
  if (input.op === 'check') return check(db, kind, input.key, input.version);
  fail('BAD_REQUEST', 'Unknown station step');
}

/*
 * The no-account Plant Station (the stationSignIn call, open to tablets with no sign-in):
 *   'enter' {code}: the plant station that code opens, only while its plant's switch is On (index.js then signs it in);
 *   'check' {key, version}: is this tablet's station still there, on the same code, with the switch On?
 *   'status' / 'release' {facilityId, code}: the plant's manager release code, to move the tablet (admin.js releaseCheck).
 */
async function signIn(db, input, now) {
  const all = await readAll(db);
  if (input.op === 'check') {
    const r = await check(db, 'PLANT', input.key, input.version);
    if (r.ok && all.noAccount[r.station.facilityId] !== true) return { ok: false, off: true, message: 'The Plant Station with no UD account is turned off. Sign in with a United Dairy account.' };
    return r;
  }
  if (input.op !== 'enter') fail('BAD_REQUEST', 'Unknown station step');
  // With every plant's switch Off, no code is even looked at.
  if (!plants().some(p => all.noAccount[p.id] === true)) return { ok: false, off: true, message: 'The Plant Station with no UD account is turned off. Sign in with a United Dairy account.' };
  const r = await enter(db, 'PLANT', input.code, (now ? now() : new Date()).getTime(), F.who(input));
  if (r.ok && all.noAccount[r.station.facilityId] !== true) return { ok: false, off: true, message: r.station.plant + '\'s Plant Station with no UD account is turned off. Sign in with a United Dairy account.' };
  return r;
}

// The server's check of a tablet signed in by its code alone (its token's claims): the station it is, or null.
async function stationSaver(db, claims) {
  if (!claims || typeof claims.udStation !== 'string') return null;
  const all = await readAll(db), s = all.list[claims.udStation];
  if (!s || s.kind !== 'PLANT' || !s.hash || s.version !== claims.udVersion || all.noAccount[s.facilityId] !== true) return null;
  return { key: s.key, name: s.name, type: s.type, facilityId: s.facilityId, plant: plantName(s.facilityId) };
}

module.exports = { KINDS, STARTERS, STATION_ACTIONS, stations, stationAdd, stationCode, stationRemove, noAccountSet, castAppSet, tvCall, tvAccess, needsCode, tabletCall, signIn, stationSaver, StationError, MAX_FAILS_PER_MINUTE, read, check };
