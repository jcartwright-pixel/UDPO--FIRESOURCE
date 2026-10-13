/*
 * Verizon Connect FLEET (the old Telogis) GPS connection. United Dairy is on Fleet, not Reveal (Joe, 10/10), so the
 * Fleetmatics (Reveal) login in gps.js cannot reach its trucks. Verizon (Neal Harriman, 10/13) pointed us at Fleet's
 * TDE templates: https://api.telogis.com/documentation.
 *
 * How it works, all on the server:
 *   1. Log in: POST https://<fleet>.api.telogis.com/rest/login with "<fleet>:<sub-user>" and the password. The answer is a
 *      key ("token") good for 24 hours, kept in private/gpsFleet with the login. If Fleet refuses the POST form, the
 *      GET form Verizon's email shows (/rest/login/<fleet>/<sub-user>/<password>) is tried once.
 *   2. Make sure our read-only template is saved in the Fleet account (GET /templates, else POST /templates):
 *      UDPO_TrucksNow (Unit table: where each truck is now, odometer, engine hours, driver).
 *   3. Run it by name: POST /execute?template=UDPO_TrucksNow&auth=<key>. The answer is CSV.
 * Nothing here writes to Fleet except saving that template, which only reads (Intent = Retrieve). (The first Test, 10/13,
 * also saved UDPO_DayPoints, a day's GPS points; it is no longer run: 520 units' points were too many.)
 *
 * The login lives in private/gpsFleet, which no screen can read (firestore.rules). The screen only learns which parts are
 * saved. What a pull stores (readable by any active user):
 *   gpsTrucks/<truck>        last report time, place, latitude/longitude, speed, ignition, odometer, engine hours, driver
 *   gpsDays/<date>_<truck>   that New York day's miles (odometer now less the day's first reading), first and last movement
 *
 * Joe's Test on the test copy passed 10/13 (520 units), so the login, template list and Unit template work as written.
 */
'use strict';

const { safeIdPart } = require('./model');

const TEMPLATES = Object.freeze({
  trucks: { name: 'UDPO_TrucksNow', text: [
    '[Template]', 'TemplateVersion = 1.0', 'TableID = Unit-1.0', 'TemplateName = UDPO_TrucksNow', 'Intent = Retrieve', '',
    '[Output]',
    'UnitId = Input.Id',
    'Tag = Input.Tag',
    'LastReport(yyyy-MM-dd HH:mm:ss, UTC) = Input.LastReportTime',
    'Lat = Input.LastLocation.Lat',
    'Lon = Input.LastLocation.Lon',
    'Address = Input.LastLocationAddress',
    'Place = Input.LastLocationMarkerName',
    'SpeedMph(mph) = Input.LastLocationSpeed',
    'IgnitionOn = Input.IsIgnitionOn',
    'OdometerMiles(mile) = Input.Odometer',
    'EngineHours = Input.TotalEngineHours',
    'Driver = Input.DriverName',
    'Active = Input.IsActive', ''].join('\r\n') }
});
const TOKEN_HOURS = 23;          // Fleet keys last 24 hours; a fresh one is asked for an hour early.
const ZONE = 'America/New_York';

class FleetError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function cleanFleet(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(s)) throw new FleetError('BAD_REQUEST', 'The Fleet name is the first part of your Fleet address, for example united-dairy.');
  return s;
}
// "united-dairy:jcartwright" (the way Fleet shows a login) and "jcartwright" are the same sub-user.
function cleanUser(user, fleet) {
  const s = String(user || '').trim();
  const i = s.indexOf(':');
  return i > 0 && s.slice(0, i).toLowerCase() === String(fleet || '').toLowerCase() ? s.slice(i + 1) : s;
}
const baseOf = (d, o) => (o && o.base) || 'https://' + d.fleet + '.api.telogis.com';

/** Splits CSV text (quotes, doubled quotes, CRLF) into objects keyed by the header row. */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const clean = rows.filter(r => r.some(x => String(x).trim() !== ''));
  if (!clean.length) return [];
  const head = clean[0].map(h => String(h).trim());
  return clean.slice(1).map(r => { const o = {}; head.forEach((h, j) => { o[h] = String(r[j] == null ? '' : r[j]).trim(); }); return o; });
}

/** "2026-10-13 14:05:00" (UTC, as our templates ask) or any other date text Fleet sends: an ISO time, or ''. */
function utcIso(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  let d = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s) ? new Date(s.replace(' ', 'T') + 'Z') : new Date(s);
  if (isNaN(d)) d = new Date(s + ' UTC');
  return isNaN(d) ? '' : d.toISOString();
}
function nyDate(iso) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return p; // yyyy-mm-dd
}
const num = (v) => { const n = Number(String(v == null ? '' : v).replace(/[^0-9.-]/g, '')); return String(v).trim() !== '' && isFinite(n) ? n : null; };
const yes = (v) => /^(true|yes|1|on)$/i.test(String(v || '').trim());
const truckKey = (tag) => safeIdPart(String(tag || '').trim().toUpperCase().replace(/\s+/g, '')) || '';

async function text(res) { try { return String(await res.text() || ''); } catch (e) { return ''; } }
const short = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 200);

/** Logs in and returns a key. Throws a FleetError with a plain sentence. */
async function login(d, o) {
  const base = baseOf(d, o), user = cleanUser(d.user, d.fleet);
  let res;
  try {
    res = await o.fetch(base + '/rest/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain' },
      body: JSON.stringify({ username: d.fleet + ':' + user, password: d.password }) });
    // Verizon's email: the documentation says POST, but GET with the login in the address works too.
    if (res.status === 404 || res.status === 405) {
      res = await o.fetch(base + '/rest/login/' + encodeURIComponent(d.fleet) + '/' + encodeURIComponent(user) + '/' + encodeURIComponent(d.password),
        { method: 'GET', headers: { Accept: 'application/json, text/plain' } });
    }
  } catch (e) {
    throw new FleetError('LOGIN', 'Could not reach Verizon Fleet at ' + d.fleet + '.api.telogis.com. Check the Fleet name.');
  }
  if (res.status === 401 || res.status === 403) throw new FleetError('LOGIN', 'Verizon Fleet refused the sub-user name or password (' + res.status + '). Check them and that the sub-user may use the API.');
  if (res.status >= 300) throw new FleetError('LOGIN', 'Verizon Fleet answered ' + res.status + ' to the login. ' + short(await text(res)));
  const body = (await text(res)).trim();
  let token = '';
  try { const j = JSON.parse(body); token = typeof j === 'string' ? j : (j.token || j.Token || j.auth || j.authToken || ''); } catch (e) { token = body.replace(/^"|"$/g, ''); }
  if (!token || /\s/.test(token)) throw new FleetError('LOGIN', 'Verizon Fleet accepted the login but sent no key back.');
  return token;
}

/** The saved key while it is fresh, else a new one (saved). */
async function key(ref, d, o, fresh) {
  if (!fresh && d.token && d.tokenUntil && Date.parse(d.tokenUntil) > o.now().getTime()) return d.token;
  const token = await login(d, o);
  d.token = token; d.tokenUntil = new Date(o.now().getTime() + TOKEN_HOURS * 3600000).toISOString();
  await ref.set({ token: d.token, tokenUntil: d.tokenUntil }, { merge: true });
  return token;
}

function namesIn(list) {
  const arr = Array.isArray(list) ? list : (list && (list.templates || list.Templates || list.items || list.Items)) || [];
  return arr.map(t => String(typeof t === 'string' ? t : (t.name || t.Name || t.templateName || t.TemplateName || '')).toLowerCase());
}

/** Saves our two read-only templates in the Fleet account when they are not there yet. */
async function ensureTemplates(d, o, token) {
  const base = baseOf(d, o);
  const res = await o.fetch(base + '/templates?auth=' + encodeURIComponent(token), { method: 'GET', headers: { Accept: 'application/json' } });
  if (res.status === 401 || res.status === 403) throw new FleetError('TEMPLATES', 'The login works, but this sub-user may not use Fleet templates (' + res.status + '). Give the sub-user an administrator role in Fleet.');
  if (res.status >= 300) throw new FleetError('TEMPLATES', 'The login works, but Verizon Fleet answered ' + res.status + ' when asked for templates. ' + short(await text(res)));
  let have = [];
  try { have = namesIn(JSON.parse(await text(res))); } catch (e) { have = []; }
  for (const t of [TEMPLATES.trucks]) {
    if (have.indexOf(t.name.toLowerCase()) >= 0) continue;
    const up = await o.fetch(base + '/templates?auth=' + encodeURIComponent(token), { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: t.text });
    if (up.status >= 300) throw new FleetError('TEMPLATES', 'The login works, but Verizon Fleet would not save our ' + t.name + ' template (' + up.status + '). ' + short(await text(up)));
  }
}

/** Runs a saved template by name and returns its CSV rows. A slow answer (202) is asked for again a few times. */
async function execute(d, o, token, name, params) {
  const base = baseOf(d, o);
  const q = Object.keys(params || {}).map(k => '&' + k + '=' + encodeURIComponent(params[k])).join('');
  let res = await o.fetch(base + '/execute?template=' + encodeURIComponent(name) + '&auth=' + encodeURIComponent(token) + q, { method: 'POST', headers: { Accept: 'text/csv, text/plain' } });
  for (let i = 0; res.status === 202 && i < 10; i++) {
    let next = '';
    try { const j = JSON.parse(await text(res)); next = j.ResultUrl || j.resultUrl || ''; } catch (e) { next = ''; }
    if (!next) break;
    await o.sleep(3000);
    res = await o.fetch(next + (next.indexOf('auth=') >= 0 ? '' : (next.indexOf('?') >= 0 ? '&' : '?') + 'auth=' + encodeURIComponent(token)), { method: 'GET' });
  }
  if (res.status === 401 || res.status === 403) throw new FleetError('RUN', 'Verizon Fleet refused to run ' + name + ' (' + res.status + ').');
  if (res.status >= 300) throw new FleetError('RUN', 'Verizon Fleet answered ' + res.status + ' when running ' + name + '. ' + short(await text(res)));
  return parseCsv(await text(res));
}

function truckRow(r, at) {
  return {
    tag: r.Tag || '', unitId: r.UnitId || '', lastReport: utcIso(r.LastReport), lat: num(r.Lat), lon: num(r.Lon),
    address: r.Address || '', place: r.Place || '', speedMph: num(r.SpeedMph), ignitionOn: yes(r.IgnitionOn),
    odometerMiles: num(r.OdometerMiles), engineHours: num(r.EngineHours), driver: r.Driver || '',
    active: r.Active === '' || r.Active == null ? true : yes(r.Active), updatedAt: at
  };
}

/*
 * Today's miles from the odometer (10/13: the day's GPS points for all 520 Fleet units were too many to read in one go).
 * seen = private/gpsFleetSeen {date, units: {truck: {lr, odo0, odo, first, last, since}}}: the first odometer read each New York
 * day, the latest one, and the first and last read at which it went up. Only units whose report changed are written.
 */
function advanceDays(seen, trucks, at) {
  const date = nyDate(at), fresh = seen.date !== date, units = fresh ? {} : Object.assign({}, seen.units || {});
  const changedTrucks = {}, days = {};
  Object.keys(trucks).forEach(k => {
    const t = trucks[k], u = units[k] || {}, prev = (seen.units || {})[k] || {};
    if (prev.lr !== t.lastReport || fresh) changedTrucks[k] = t;
    if (t.odometerMiles === null) { units[k] = Object.assign(u, { lr: t.lastReport }); return; }
    const next = { lr: t.lastReport, odo0: u.odo0 == null ? t.odometerMiles : u.odo0, odo: t.odometerMiles, first: u.first || '', last: u.last || '', since: u.since || at };
    if (u.odo != null && t.odometerMiles - u.odo > 0.2) { next.first = next.first || at; next.last = at; }
    units[k] = next;
    if (fresh || u.odo !== next.odo || !u.lr) {
      days[date + '_' + k] = { tag: t.tag, date, miles: Math.max(0, Math.round((next.odo - next.odo0) * 10) / 10), firstMove: next.first, lastMove: next.last, since: next.since,
        lastPlace: t.place || t.address || '', updatedAt: at };
    }
  });
  return { seen: { date, units }, changedTrucks, days };
}

async function writeAll(db, coll, docs) {
  const ids = Object.keys(docs);
  for (let i = 0; i < ids.length; i += 400) {
    const b = db.batch();
    ids.slice(i, i + 400).forEach(id => b.set(db.collection(coll).doc(id), docs[id]));
    await b.commit();
  }
}

/** Where every truck is now and today's miles, each run. Does nothing until a login is saved. */
async function pull(db, options) {
  const o = withDefaults(options);
  const ref = db.collection('private').doc('gpsFleet');
  const d = (await ref.get()).data() || {};
  if (!d.fleet || !d.user || !d.password) return { skipped: 'no login' };
  const at = o.now().toISOString(), out = { trucks: 0, days: 0 };
  try {
    const token = await key(ref, d, o, false);
    if (!d.templatesReady) { await ensureTemplates(d, o, token); await ref.set({ templatesReady: true }, { merge: true }); }
    const trucks = {};
    (await execute(d, o, token, TEMPLATES.trucks.name)).forEach(r => { const k = truckKey(r.Tag); if (k) trucks[k] = truckRow(r, at); });
    const seenRef = db.collection('private').doc('gpsFleetSeen');
    const step = advanceDays((await seenRef.get()).data() || {}, trucks, at);
    await writeAll(db, 'gpsTrucks', step.changedTrucks);
    await writeAll(db, 'gpsDays', step.days);
    await seenRef.set(step.seen);
    out.trucks = Object.keys(trucks).length; out.days = Object.keys(step.days).length;
    await ref.set({ lastPull: at, lastPullError: '', lastPullTrucks: out.trucks }, { merge: true });
    return out;
  } catch (e) {
    // A refused key is dropped so the next run logs in again.
    await ref.set({ lastPullError: short(e.message), lastPullErrorAt: at, token: e.code === 'RUN' ? '' : (d.token || '') }, { merge: true });
    if (e instanceof FleetError) return Object.assign(out, { error: e.message });
    console.error('fleetGps pull', e);
    return Object.assign(out, { error: 'The GPS read stopped part way (' + short(e.message) + '). It tries again in 5 minutes.' });
  }
}

function withDefaults(options) {
  return Object.assign({ fetch: (...a) => fetch(...a), now: () => new Date(), sleep: (ms) => new Promise(r => setTimeout(r, ms)), base: '' }, options || {});
}

const status = (d) => ({ kind: 'fleet', fleet: d.fleet || '', hasUser: !!d.user, hasPassword: !!d.password, lastTest: d.lastTest || null,
  savedAt: d.savedAt || '', savedBy: d.savedBy || '', lastPull: d.lastPull || '', lastPullError: d.lastPullError || '', lastPullTrucks: d.lastPullTrucks || 0 });

/* The GPS Setup screen's Fleet box. input.op: status | save {fleet, user, password} | clear | test | pull. The caller has
 * already checked the person is a manager or administrator. */
async function fleetCall(db, email, input, options) {
  const o = withDefaults(options);
  const ref = db.collection('private').doc('gpsFleet');
  const d = (await ref.get()).data() || {};
  const op = String(input.op || 'status');
  if (op === 'status') return status(d);
  if (op === 'save') {
    const next = Object.assign({}, d);
    if (String(input.fleet || '').trim()) next.fleet = cleanFleet(input.fleet);
    if (String(input.user || '').trim()) next.user = String(input.user).trim().slice(0, 200);
    if (String(input.password || '')) next.password = String(input.password).slice(0, 200);
    Object.assign(next, { savedAt: o.now().toISOString(), savedBy: email, lastTest: null, token: '', tokenUntil: '', templatesReady: false });
    await ref.set(next);
    return status(next);
  }
  if (op === 'clear') {
    const next = { fleet: d.fleet || '', savedAt: o.now().toISOString(), savedBy: email, lastTest: null };
    await ref.set(next);
    return status(next);
  }
  if (op === 'test') {
    let result;
    if (!d.fleet || !d.user || !d.password) result = { ok: false, step: 'login', message: 'Not tested: save the Fleet name, sub-user name and password first.' };
    else {
      try {
        const token = await key(ref, d, o, true);
        await ensureTemplates(d, o, token);
        await ref.set({ templatesReady: true }, { merge: true });
        const rows = (await execute(d, o, token, TEMPLATES.trucks.name)).filter(r => r.Tag);
        const names = rows.slice(0, 3).map(r => r.Tag).join(', ');
        result = rows.length ? { ok: true, step: 'trucks', message: 'Connected. Verizon Fleet answered with ' + rows.length + ' trucks, for example ' + names + '.' }
          : { ok: false, step: 'trucks', message: 'The login works, but Verizon Fleet sent no trucks. Check that this sub-user can see the Uniontown fleet.' };
      } catch (e) {
        if (!(e instanceof FleetError)) throw e;
        result = { ok: false, step: e.code.toLowerCase(), message: e.message };
      }
    }
    const lastTest = Object.assign({ at: o.now().toISOString(), by: email }, result);
    await ref.set({ lastTest }, { merge: true });
    return Object.assign(status(Object.assign({}, d, { lastTest })), { result });
  }
  if (op === 'pull') {
    const r = await pull(db, options);
    const fresh = (await ref.get()).data() || {};
    return Object.assign(status(fresh), { pulled: r });
  }
  throw new FleetError('BAD_REQUEST', 'Unknown Fleet GPS step ' + op.slice(0, 30));
}

module.exports = { fleetCall, pull, parseCsv, advanceDays, utcIso, cleanUser, FleetError, TEMPLATES };
