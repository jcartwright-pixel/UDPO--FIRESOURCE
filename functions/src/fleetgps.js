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
    'Active = Input.IsActive', ''].join('\r\n') },
  // Joe 10/13 (scorecard): the alerts Fleet raised (speeding, harsh braking, idling ... as set up in Fleet) since a time.
  alerts: { name: 'UDPO_Alerts', text: [
    '[Template]', 'TemplateVersion = 1.0', 'TableID = Alert-1.0', 'TemplateName = UDPO_Alerts', 'Intent = Retrieve', '',
    '[User]', 'Since(Timestamp,UTC) = "Since"', 'Until(Timestamp,UTC) = "Until"', '',
    '[Filter]', 'TimeTriggered = Between(Since, Until)', '',
    '[Output]',
    'AlertId = Input.Id',
    'ConditionId = Input.ConditionId',
    'UnitId = Input.UnitId',
    'DriverId = Input.DriverId',
    'Triggered(yyyy-MM-dd HH:mm:ss, UTC) = Input.TimeTriggered',
    'TimeOn(yyyy-MM-dd HH:mm:ss, UTC) = Input.TimeOn',
    'TimeOff(yyyy-MM-dd HH:mm:ss, UTC) = Input.TimeOff',
    'Address = Input.Address',
    'SpeedMph(mph) = Input.Speed',
    'LimitMph(mph) = Input.SpeedLimit',
    'TriggerName = Input.TriggerName',
    'TriggerValue = Input.TriggerValue', ''].join('\r\n') },
  // The names of the alert conditions (what kind of alert each is), asked for once per condition.
  conditions: { name: 'UDPO_Conditions', text: [
    '[Template]', 'TemplateVersion = 1.0', 'TableID = Condition-1.0', 'TemplateName = UDPO_Conditions', 'Intent = Retrieve', '',
    '[User]', 'Ids(Set<Text>) = "Ids"', '',
    '[Filter]', 'Id = In(Ids)', '',
    '[Output]',
    'ConditionId = Input.Id',
    'Name = Input.Name',
    'ConditionType = Input.ConditionType', ''].join('\r\n') },
  // Joe 10/14 ("pull in the history for at least this week"): one day's GPS points for a few units at a time (all 520 units'
  // points at once were too many, 10/13).
  unitPoints: { name: 'UDPO_UnitDayPoints', text: [
    '[Template]', 'TemplateVersion = 1.0', 'TableID = Point-2.0', 'TemplateName = UDPO_UnitDayPoints', 'Intent = Retrieve', '',
    '[User]', 'Since(Timestamp,UTC) = "Since"', 'Until(Timestamp,UTC) = "Until"', 'Ids(Set<Text>) = "Ids"', '',
    '[Filter]', 'Time = Between(Since, Until)', 'UnitId = In(Ids)', '',
    '[Output]',
    'UnitId = Input.UnitId',
    'Time(yyyy-MM-dd HH:mm:ss, UTC) = Input.Time',
    'Lat = Input.Lat',
    'Lon = Input.Lon',
    'Address = Input.Address',
    'MilesDelta(mile) = Input.OdometerDelta', ''].join('\r\n') }
});
// Joe's Fleet places for the Uniontown yard (10/13); 10/14 the Loading Dock, where trucks park, is the yard too (a truck
// driving from the dock through Uniontown Branch on its way out was read as coming back).
const YARD_PLACES = ['UNIONTOWN BRANCH', 'UNIONTOWN PLANT', 'LOADING DOCK'];
const inYard = (t) => YARD_PLACES.indexOf(String(t.place || '').trim().toUpperCase()) >= 0;
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
async function ensureTemplates(d, o, token, list) {
  const base = baseOf(d, o);
  const res = await o.fetch(base + '/templates?auth=' + encodeURIComponent(token), { method: 'GET', headers: { Accept: 'application/json' } });
  if (res.status === 401 || res.status === 403) throw new FleetError('TEMPLATES', 'The login works, but this sub-user may not use Fleet templates (' + res.status + '). Give the sub-user an administrator role in Fleet.');
  if (res.status >= 300) throw new FleetError('TEMPLATES', 'The login works, but Verizon Fleet answered ' + res.status + ' when asked for templates. ' + short(await text(res)));
  let have = [];
  try { have = namesIn(JSON.parse(await text(res))); } catch (e) { have = []; }
  for (const t of list || [TEMPLATES.trucks]) {
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
    // Leaving and coming back to the yard (the Fleet place, read every 5 minutes): the first time today it was seen out after
    // being in the yard, and the last time it was seen back.
    const yard = inYard(t), wasYard = u.yard === undefined ? null : u.yard;
    const yardOut = u.yardOut || (wasYard === true && !yard ? at : ''), yardIn = wasYard === false && yard ? at : (u.yardIn || '');
    const yardChanged = yardOut !== (u.yardOut || '') || yardIn !== (u.yardIn || '');
    if (t.odometerMiles === null) {
      units[k] = Object.assign({}, u, { lr: t.lastReport, yard, yardOut, yardIn });
      if (yardChanged) days[date + '_' + k] = { tag: t.tag, date, yardOut, yardIn, updatedAt: at };
      return;
    }
    const next = { lr: t.lastReport, odo0: u.odo0 == null ? t.odometerMiles : u.odo0, odo: t.odometerMiles, first: u.first || '', last: u.last || '', since: u.since || at, yard, yardOut, yardIn };
    if (u.odo != null && t.odometerMiles - u.odo > 0.2) { next.first = next.first || at; next.last = at; }
    units[k] = next;
    if (fresh || u.odo !== next.odo || !u.lr || yardChanged) {
      days[date + '_' + k] = { tag: t.tag, date, miles: Math.max(0, Math.round((next.odo - next.odo0) * 10) / 10), firstMove: next.first, lastMove: next.last, since: next.since, yardOut, yardIn,
        lastPlace: t.place || t.address || '', updatedAt: at };
    }
  });
  return { seen: { date, units }, changedTrucks, days };
}

// merge: a day's record is written in parts (a yard-only change carries no miles), so it never wipes what it doesn't carry.
async function writeAll(db, coll, docs, merge) {
  const ids = Object.keys(docs);
  for (let i = 0; i < ids.length; i += 400) {
    const b = db.batch();
    ids.slice(i, i + 400).forEach(id => b.set(db.collection(coll).doc(id), docs[id], { merge: !!merge }));
    await b.commit();
  }
}

/*
 * Fleet alerts for the Driver Scorecard (Joe 10/13): every alert raised since the last read (the first read starts at New
 * York midnight), kept as gpsAlerts/A<alert id> {date, tag, at, type, speedMph, limitMph, minutes, place, address, condition,
 * fleetDriverId}. type comes from the alert's condition in Fleet (names asked for once, kept in private/gpsFleetConditions):
 * SPEEDING, HARSH_BRAKING, HARSH_ACCEL, HARSH_TURN, IDLE, FAULT, SEATBELT or OTHER. The scorecard counts an alert against the
 * driver Daily Dispatch put on that truck that day, not the driver Fleet shows.
 */
function alertType(c, r) {
  const s = (String(c && c.name || '') + ' ' + String(c && c.type || '') + ' ' + String(r.TriggerName || '')).toUpperCase().replace(/[\s_-]+/g, '');
  if (/HARSHBRAK|HARDBRAK|DECEL|HARDSTOP/.test(s)) return 'HARSH_BRAKING';
  if (/HARSHACCEL|HARDACCEL|ACCELVIOL|RAPIDACCEL/.test(s)) return 'HARSH_ACCEL';
  if (/CORNER|HARDTURN|HARSHTURN/.test(s)) return 'HARSH_TURN';
  if (/SEATBELT/.test(s)) return 'SEATBELT';
  if (/IDL/.test(s)) return 'IDLE';
  if (/SPEED/.test(s) || (num(r.LimitMph) > 0 && num(r.SpeedMph) > num(r.LimitMph))) return 'SPEEDING';
  if (/DTC|FAULT|CHECKENGINE|ENGINECODE|TROUBLECODE|MIL\b/.test(s)) return 'FAULT';
  if (/DVIR|INSPECTIONFAIL/.test(s)) return 'DVIR_FAILED';
  if (/HOS(WARN|VIOL)|HOURSOFSERVICE/.test(s)) return 'HOS';
  return 'OTHER';
}
// J1939 failure mode (FMI), the standard meanings, short.
const FMI = ['Too high', 'Too low', 'Erratic or wrong data', 'Voltage too high', 'Voltage too low', 'Current too low or open circuit', 'Current too high or short',
  'Not responding right', 'Wrong frequency or pulse', 'Updating too slowly', 'Changing too fast', 'Cause not known', 'Bad part or device', 'Out of calibration',
  'Special instructions', 'Slightly too high', 'Too high', 'Slightly too low', 'Too low', 'Network data error', 'Drifted high', 'Drifted low'];
/** A fault code from Fleet's trigger value (": 791:2(126)" = SPN 791, FMI 2, from controller 126), or nothing. */
function dtc(v) {
  const m = /(\d+)\s*:\s*(\d+)(?:\s*\(\s*(\d+)\s*\))?/.exec(String(v || ''));
  if (!m) return {};
  const fmi = Number(m[2]);
  return { spn: Number(m[1]), fmi, source: m[3] ? Number(m[3]) : null, code: m[1] + ':' + m[2], fmiText: fmi === 31 ? 'Condition is present' : FMI[fmi] || '' };
}
const fleetTime = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

async function pullAlerts(db, d, o, token, trucks, at) {
  const ref = db.collection('private').doc('gpsFleet');
  const now = new Date(at), midnight = nyMidnight(now);
  // Each read starts 10 minutes before the last one ended (an alert can arrive late); never before today's New York midnight
  // on the first read.
  const since = d.alertsUntil ? new Date(Math.max(Date.parse(d.alertsUntil) - 10 * 60000, Date.parse(midnight) - 0)) : new Date(midnight);
  if (!d.alertTemplatesReady) { await ensureTemplates(d, o, token, [TEMPLATES.alerts, TEMPLATES.conditions]); await ref.set({ alertTemplatesReady: true }, { merge: true }); }
  const n = await readAlerts(db, d, o, token, trucks, since, now, at);
  // How many alerts today so far, for GPS Setup (a quick check that this login sees the alerts set up in Fleet).
  const today = nyDate(at), alertsToday = (await db.collection('gpsAlerts').where('date', '==', today).count().get()).data().count;
  await ref.set({ alertsUntil: at, alertsError: '', lastAlerts: n, alertsDate: today, alertsToday }, { merge: true });
  return n;
}

/** Fleet's alerts raised between two times, written to gpsAlerts (an alert read twice is the same document). */
async function readAlerts(db, d, o, token, trucks, since, until, at) {
  const rows = (await execute(d, o, token, TEMPLATES.alerts.name, { Since: fleetTime(since), Until: fleetTime(until) })).filter(r => r.AlertId);
  const condRef = db.collection('private').doc('gpsFleetConditions'), known = ((await condRef.get()).data() || {}).list || {};
  const missing = [...new Set(rows.map(r => r.ConditionId).filter(id => id && !known[id]))];
  if (missing.length) {
    try {
      (await execute(d, o, token, TEMPLATES.conditions.name, { Ids: missing.join(',') })).forEach(c => { if (c.ConditionId) known[c.ConditionId] = { name: c.Name || '', type: c.ConditionType || '' }; });
    } catch (e) { if (!(e instanceof FleetError)) throw e; }
    missing.forEach(id => { if (!known[id]) known[id] = { name: '', type: '' }; });
    await condRef.set({ list: known });
  }
  const tagOf = {};
  Object.keys(trucks).forEach(k => { if (trucks[k].unitId) tagOf[trucks[k].unitId] = trucks[k]; });
  const docs = {};
  rows.forEach(r => {
    const when = utcIso(r.Triggered) || utcIso(r.TimeOn), t = tagOf[r.UnitId], c = known[r.ConditionId] || {};
    if (!when) return;
    const on = Date.parse(utcIso(r.TimeOn) || when), off = Date.parse(utcIso(r.TimeOff));
    const type = alertType(c, r);
    docs[safeIdPart('A' + r.AlertId)] = {
      date: nyDate(when), tag: t ? t.tag : '', unitId: r.UnitId || '', at: when, type,
      speedMph: num(r.SpeedMph), limitMph: num(r.LimitMph), minutes: isFinite(off) && off > on ? Math.round((off - on) / 60000) : null,
      place: t && t.lastReport && Math.abs(Date.parse(t.lastReport) - Date.parse(when)) < 10 * 60000 ? t.place || '' : '',
      address: r.Address || '', condition: c.name || c.type || r.TriggerName || '', fleetDriverId: r.DriverId || '', updatedAt: at };
    // Joe 10/13: engine fault codes for the garage. Fleet's DTC alert sends the code as its trigger value, ": 791:2(126)".
    if (type === 'FAULT') Object.assign(docs[safeIdPart('A' + r.AlertId)], dtc(r.TriggerValue), { triggerValue: String(r.TriggerValue || '').trim() });
  });
  await writeAll(db, 'gpsAlerts', docs);
  // Joe 10/14 (mock-up A): each engine code from the last two days goes on the garage list as a work order (garage.js).
  const recent = Date.parse(at) - 2 * 86400000;
  const faults = Object.keys(docs).map(id => Object.assign({ alertId: id }, docs[id])).filter(a => a.type === 'FAULT' && a.code && Date.parse(a.at) >= recent);
  if (faults.length) {
    try { await require('./garage').engineCodeOrders(db, faults, at); } catch (e) { console.error('fleetGps engine codes', e); }
  }
  return Object.keys(docs).length;
}
function nyMidnight(now) {
  const date = nyDate(now.toISOString());
  // New York is 4 or 5 hours behind UTC; whichever of the two is that day's midnight there.
  for (const h of [4, 5]) { const t = new Date(date + 'T' + String(h).padStart(2, '0') + ':00:00Z'); if (nyDate(t.toISOString()) === date && nyDate(new Date(t - 3600000).toISOString()) !== date) return t.toISOString(); }
  return new Date(date + 'T05:00:00Z').toISOString();
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
    if (!d.templatesReady) { await ensureTemplates(d, o, token, [TEMPLATES.trucks]); await ref.set({ templatesReady: true }, { merge: true }); }
    const trucks = {};
    (await execute(d, o, token, TEMPLATES.trucks.name)).forEach(r => { const k = truckKey(r.Tag); if (k) trucks[k] = truckRow(r, at); });
    const seenRef = db.collection('private').doc('gpsFleetSeen');
    const step = advanceDays((await seenRef.get()).data() || {}, trucks, at);
    await writeAll(db, 'gpsTrucks', step.changedTrucks);
    await writeAll(db, 'gpsDays', step.days, true);
    await seenRef.set(step.seen);
    out.trucks = Object.keys(trucks).length; out.days = Object.keys(step.days).length;
    // The alerts are read after the trucks; a problem with them never stops the trucks' read.
    try { out.alerts = await pullAlerts(db, d, o, token, trucks, at); }
    catch (e) { if (!(e instanceof FleetError)) console.error('fleetGps alerts', e); await ref.set({ alertsError: short(e.message), alertsErrorAt: at }, { merge: true }); out.alertsError = short(e.message); }
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

/*
 * Joe 10/14: "pull in the history for at least this week ... that way we know it works." A one-time read, a little each
 * 5-minute run (after the live read), of this week from Sunday:
 *   1. Fleet's alerts for each day (into gpsAlerts, the same documents the live read writes).
 *   2. Each Uniontown Equipment Master truck's GPS points, one day and HISTORY_UNITS trucks per Fleet call, turned into that
 *      day's gpsDays record: miles, first and last movement, yard leave and return times, last place.
 * Days before today are written whole. Today is joined to the live read: the miles and first move from before the live read
 * started are added to it (private/gpsFleetSeen), so the live read carries on from the whole day's total.
 * Progress is kept in private/gpsFleetHistory {days, alertDays, queue, total, done, error, finishedAt}; GPS Setup shows it.
 * The yard is where the trucks Fleet now shows at Uniontown Branch / Uniontown Plant / Loading Dock stand (points carry no place name),
 * within YARD_MILES of them.
 */
const HISTORY_UNITS = 5, YARD_MILES = 0.25, HISTORY_TRIES = 3;
const addDays = (date, n) => { const t = new Date(date + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
function weekDays(at) {
  const today = nyDate(at), dow = new Date(today + 'T12:00:00Z').getUTCDay(), start = addDays(today, -(dow || 7));
  const out = []; for (let x = start; x <= today; x = addDays(x, 1)) out.push(x);
  return out;
}
function milesApart(a, b) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** One unit's points for part of a day (sorted by time) as that day's record. */
function daySummary(points, yards) {
  let miles = 0, first = '', last = '', wasYard = null, yardOut = '', yardIn = '';
  points.forEach(p => {
    const dm = num(p.MilesDelta) || 0;
    if (dm > 0 && dm < 200) miles += dm;
    if (dm >= 0.05) { first = first || p.at; last = p.at; }
    const lat = num(p.Lat), lon = num(p.Lon);
    if (lat === null || lon === null || !yards.length) return;
    const yard = yards.some(y => milesApart(y, { lat, lon }) <= YARD_MILES);
    if (wasYard === true && !yard && !yardOut) yardOut = p.at;
    if (wasYard === false && yard) yardIn = p.at;
    wasYard = yard;
  });
  const lastPoint = points[points.length - 1] || {};
  return { miles: Math.round(miles * 10) / 10, firstMove: first, lastMove: last, yardOut, yardIn, lastPlace: lastPoint.Address || '' };
}

async function startHistory(db, at) {
  const trucks = (await db.collection('gpsTrucks').get()).docs.map(x => x.data());
  if (!trucks.length) return null;
  const byKey = {}; trucks.forEach(t => { if (t.unitId) byKey[truckKey(t.tag)] = t; });
  // Uniontown's trucks, as the Equipment screen lists them (edit.js: facility Uniontown or blank, location Uniontown or blank).
  const units = (await db.collection('equipment').get()).docs.map(x => x.data())
    .filter(e => e.type === 'TRUCK' && (!e.facilityId || e.facilityId === 'fac_uniontown') && (!e.location || /UNIONTOWN/i.test(e.location)))
    .map(e => byKey[truckKey(e.unit)]).filter(Boolean);
  const ids = [...new Set(units.map(t => t.unitId))].sort();
  const yards = trucks.filter(t => inYard(t) && t.lat !== null && t.lon !== null && t.lat !== undefined).map(t => ({ lat: t.lat, lon: t.lon }));
  const days = weekDays(at), queue = [];
  days.forEach(date => { for (let i = 0; i < ids.length; i += HISTORY_UNITS) queue.push({ date, ids: ids.slice(i, i + HISTORY_UNITS) }); });
  return { startedAt: at, days, alertDays: days.slice(), queue, total: days.length + queue.length, done: 0, units: ids.length, yards: yards.slice(0, 40),
    error: '', tries: 0, finishedAt: '' };
}

async function history(db, options) {
  const o = withDefaults(options), began = o.now().getTime(), budget = o.budgetMs || 150000;
  const ref = db.collection('private').doc('gpsFleet'), hRef = db.collection('private').doc('gpsFleetHistory');
  const d = (await ref.get()).data() || {};
  if (!d.fleet || !d.user || !d.password) return { skipped: 'no login' };
  let h = (await hRef.get()).data();
  if (!h) { h = await startHistory(db, o.now().toISOString()); if (!h) return { skipped: 'no trucks read yet' }; await hRef.set(h); }
  // A login saved after the history stopped gets another go.
  if (h.tries >= HISTORY_TRIES && d.savedAt && h.errorAt && d.savedAt > h.errorAt) h.tries = 0;
  if (h.finishedAt || h.tries >= HISTORY_TRIES) return { skipped: h.finishedAt ? 'done' : 'stopped' };
  const tagOf = {}; (await db.collection('gpsTrucks').get()).docs.forEach(x => { const t = x.data(); if (t.unitId) tagOf[t.unitId] = t; });
  const trucksById = {}; Object.keys(tagOf).forEach(id => { trucksById[truckKey(tagOf[id].tag)] = tagOf[id]; });
  let steps = 0;
  try {
    const token = await key(ref, d, o, false);
    if (!d.historyTemplatesReady) {
      await ensureTemplates(d, o, token, [TEMPLATES.alerts, TEMPLATES.conditions, TEMPLATES.unitPoints]);
      await ref.set({ historyTemplatesReady: true, alertTemplatesReady: true }, { merge: true });
    }
    while ((h.alertDays.length || h.queue.length) && o.now().getTime() - began < budget) {
      const at = o.now().toISOString(), now = new Date(at);
      if (h.alertDays.length) {
        const date = h.alertDays[0], from = new Date(nyMidnight(new Date(date + 'T16:00:00Z'))), to = new Date(nyMidnight(new Date(addDays(date, 1) + 'T16:00:00Z')));
        await readAlerts(db, d, o, token, trucksById, from, to < now ? to : now, at);
        h.alertDays.shift();
      } else {
        const item = h.queue[0];
        await historyDay(db, d, o, token, item, tagOf, h.yards || [], at);
        h.queue.shift();
      }
      h.done++; h.tries = 0; h.error = ''; steps++;
      if (!h.alertDays.length && !h.queue.length) h.finishedAt = at;
      await hRef.set(h);
    }
    return { steps, done: h.done, total: h.total, finished: !!h.finishedAt };
  } catch (e) {
    if (!(e instanceof FleetError)) console.error('fleetGps history', e);
    await hRef.set({ error: short(e.message), tries: (h.tries || 0) + 1, errorAt: o.now().toISOString() }, { merge: true });
    return { steps, error: short(e.message) };
  }
}

/** One queue item: one day's points for a few trucks, into gpsDays (today: joined to the live read). */
async function historyDay(db, d, o, token, item, tagOf, yards, at) {
  const now = new Date(at), from = new Date(nyMidnight(new Date(item.date + 'T16:00:00Z'))), next = new Date(nyMidnight(new Date(addDays(item.date, 1) + 'T16:00:00Z')));
  const to = next < now ? next : now;
  const rows = await execute(d, o, token, TEMPLATES.unitPoints.name, { Since: fleetTime(from), Until: fleetTime(to), Ids: item.ids.join(',') });
  const byUnit = {};
  rows.forEach(r => { const t = utcIso(r.Time); if (t && r.UnitId) (byUnit[r.UnitId] = byUnit[r.UnitId] || []).push(Object.assign({ at: t }, r)); });
  const seenRef = db.collection('private').doc('gpsFleetSeen'), seen = (await seenRef.get()).data() || {};
  const live = seen.date === item.date, units = Object.assign({}, seen.units || {}), docs = {};
  item.ids.forEach(id => {
    const t = tagOf[id]; if (!t || !byUnit[id]) return;
    const k = truckKey(t.tag), u = units[k];
    let pts = byUnit[id].sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
    if (live && u && u.history) return;
    if (live && u && u.since) {
      // Today: only the part before the live read began, added to what the live read keeps.
      pts = pts.filter(p => p.at < u.since);
      const s = daySummary(pts, yards);
      const v = Object.assign({}, u, { since: from.toISOString(), first: s.firstMove || u.first || '', last: u.last || s.lastMove || '', yardOut: s.yardOut || u.yardOut || '', history: true });
      if (v.odo0 != null) v.odo0 = Math.round((v.odo0 - s.miles) * 10) / 10;
      units[k] = v;
      docs[item.date + '_' + k] = { tag: t.tag, date: item.date, since: v.since, firstMove: v.first, lastMove: v.last, yardOut: v.yardOut, yardIn: v.yardIn || '', history: true, updatedAt: at,
        miles: v.odo != null && v.odo0 != null ? Math.max(0, Math.round((v.odo - v.odo0) * 10) / 10) : s.miles };
      return;
    }
    const s = daySummary(pts, yards);
    docs[item.date + '_' + k] = Object.assign({ tag: t.tag, date: item.date, since: from.toISOString(), history: true, updatedAt: at }, s);
  });
  if (live) await seenRef.set(Object.assign({}, seen, { units }));
  await writeAll(db, 'gpsDays', docs, true);
}

/*
 * Joe 10/14: "how can I tell if we're pulling all the data we want from Verizon?" GPS Setup's checklist: for each kind of
 * data, how many came in today and when one was last seen (this week for the alerts, which do not happen every day).
 */
const ALERT_KINDS = [['SPEEDING', 'Speeding alerts'], ['IDLE', 'Idling alerts'], ['HARSH_BRAKING', 'Harsh braking alerts'], ['HARSH_ACCEL', 'Harsh acceleration alerts'],
  ['HARSH_TURN', 'Harsh cornering alerts'], ['SEATBELT', 'Seatbelt alerts'], ['FAULT', 'Engine code alerts']];
async function coverage(db, now) {
  const at = now.toISOString(), today = nyDate(at), week = weekDays(at)[0];
  const trucks = (await db.collection('gpsTrucks').get()).docs.map(x => x.data());
  const days = (await db.collection('gpsDays').where('date', '==', today).get()).docs.map(x => x.data());
  const alerts = (await db.collection('gpsAlerts').where('date', '>=', week).get()).docs.map(x => x.data());
  const newest = (list, f) => list.reduce((m, x) => { const v = f(x) || ''; return v > m ? v : m; }, '');
  const isToday = (t) => !!t && nyDate(t) === today;
  const trailer = (t) => /^T-/i.test(String(t.tag || ''));
  const row = (key, label, list, when) => ({ key, label, today: list.filter(x => isToday(when(x))).length, last: newest(list, when) });
  const reported = trucks.filter(t => t.lastReport);
  const out = [
    row('positions', 'Truck and trailer positions', reported, t => t.lastReport),
    row('odometer', 'Odometer', reported.filter(t => num(t.odometerMiles) > 0), t => t.lastReport),
    row('engineHours', 'Engine hours (trucks)', reported.filter(t => !trailer(t) && num(t.engineHours) > 0), t => t.lastReport),
    row('trailerHours', 'Trailer hours (T- units)', reported.filter(t => trailer(t) && num(t.engineHours) > 0), t => t.lastReport),
    Object.assign(row('miles', 'Miles today', days.filter(x => num(x.miles) > 0), x => x.lastMove || x.updatedAt), { scope: 'trucks' }),
    Object.assign(row('yard', 'Yard leave and return times', days.filter(x => x.yardOut || x.yardIn), x => x.yardIn > x.yardOut ? x.yardIn : x.yardOut), { scope: 'trucks' })
  ];
  ALERT_KINDS.forEach(([type, label]) => out.push(Object.assign(row('alert_' + type, label, alerts.filter(a => a.type === type), a => a.at),
    { alert: true, week: alerts.filter(a => a.type === type).length })));
  out.push({ key: 'mpg', label: 'MPG', notYet: true }, { key: 'fuel', label: 'Fuel purchases', notYet: true });
  return out;
}

function withDefaults(options) {
  return Object.assign({ fetch: (...a) => fetch(...a), now: () => new Date(), sleep: (ms) => new Promise(r => setTimeout(r, ms)), base: '' }, options || {});
}

const status = (d, h) => ({ history: h ? { done: h.done || 0, total: h.total || 0, days: h.days || [], finishedAt: h.finishedAt || '', error: h.error || '', stopped: (h.tries || 0) >= HISTORY_TRIES } : null, kind: 'fleet', fleet: d.fleet || '', hasUser: !!d.user, hasPassword: !!d.password, lastTest: d.lastTest || null,
  savedAt: d.savedAt || '', savedBy: d.savedBy || '', lastPull: d.lastPull || '', lastPullError: d.lastPullError || '', lastPullTrucks: d.lastPullTrucks || 0,
  alertsDate: d.alertsDate || '', alertsToday: d.alertsToday || 0, alertsError: d.alertsError || '' });

/* The GPS Setup screen's Fleet box. input.op: status | save {fleet, user, password} | clear | test | pull. The caller has
 * already checked the person is a manager or administrator. */
async function fleetCall(db, email, input, options) {
  const o = withDefaults(options);
  const ref = db.collection('private').doc('gpsFleet');
  const d = (await ref.get()).data() || {};
  const op = String(input.op || 'status');
  const hist = async () => (await db.collection('private').doc('gpsFleetHistory').get()).data();
  if (op === 'status') return Object.assign(status(d, await hist()), { coverage: await coverage(db, o.now()) });
  if (op === 'save') {
    const next = Object.assign({}, d);
    if (String(input.fleet || '').trim()) next.fleet = cleanFleet(input.fleet);
    if (String(input.user || '').trim()) next.user = String(input.user).trim().slice(0, 200);
    if (String(input.password || '')) next.password = String(input.password).slice(0, 200);
    Object.assign(next, { savedAt: o.now().toISOString(), savedBy: email, lastTest: null, token: '', tokenUntil: '', templatesReady: false, alertTemplatesReady: false, historyTemplatesReady: false });
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
    return Object.assign(status(fresh, await hist()), { pulled: r, coverage: await coverage(db, o.now()) });
  }
  throw new FleetError('BAD_REQUEST', 'Unknown Fleet GPS step ' + op.slice(0, 30));
}

module.exports = { fleetCall, pull, history, dtc, daySummary, weekDays, parseCsv, advanceDays, alertType, utcIso, cleanUser, FleetError, TEMPLATES };
