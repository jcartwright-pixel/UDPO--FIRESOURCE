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
const FAILS = require('./fails');
const A = require('./actions');
const MAINT = require('./maintenance');
const B = require('./board-rules');
const STATIONS = require('./stations');

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
    tx.set(CODE_REF(db), { codeHash: hashCode(code, salt), salt, enabled: true, setAt: stamp, setBy: String(user.email).toLowerCase(), failedBy: {} });
  });
  return { code, setAt: stamp };
}

// Wrong codes count per device (fails.js): 30 in a minute locks out that phone only.
async function checkCode(db, code, stamp, device) {
  const minute = stamp.slice(0, 16);
  return db.runTransaction(async tx => {
    const snap = await tx.get(CODE_REF(db));
    const c = snap.exists ? snap.data() : null;
    // Where a manager turns it on now (Joe 10/11): Administration > Links & Codes > Driver Station Codes.
    if (!c || !c.codeHash) throw new SaveError('NOT_ALLOWED', 'Phone Check-In is not turned on yet. A manager makes the code in Administration > Links & Codes > Driver Station Codes (Generate Code) and gives it to the drivers.');
    if (c.enabled !== true) throw new SaveError('NOT_ALLOWED', 'Phone Check-In is turned off right now. A manager turns it back on in Administration > Links & Codes > Driver Station Codes (Turn On).');
    const failedBy = FAILS.current(c.failedBy, f => f.minute === minute), failed = (failedBy[device] || {}).count || 0;
    if (failed >= MAX_FAILED_PER_MINUTE) throw new SaveError('NOT_ALLOWED', 'Too many wrong codes; wait a minute and try again');
    const given = Buffer.from(hashCode(code || '', c.salt), 'hex'), want = Buffer.from(c.codeHash, 'hex');
    if (!code || given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
      failedBy[device] = { minute, count: failed + 1 };
      tx.update(snap.ref, { failedBy });
      return false;
    }
    return true;
  });
}

// A Driver Room Check-In station: a Driver Room kiosk (type DRIVER) with a code; a TV's code opens only the TV.
function roomStation(r) {
  if (!r || !r.ok) return r || { ok: false, message: 'That station code was not recognized.' };
  if (r.station.type !== 'DRIVER') return { ok: false, message: 'That is the code of ' + r.station.name + ' (' + r.station.typeName + '). Type the Driver Room Check-In Station\'s code; the Driver\'s Kiosk Station (the TV) keeps the Driver Station link.' };
  if (!r.station.set) return { ok: false, message: 'This station has no code yet. A manager makes one in Administration > Links & Codes > Driver Station Codes.' };
  return r;
}

// Today's operating day and the day before (a driver checking in after the 6 AM roll).
function allowedDates(stamp) { const today = L.operatingDay(new Date(stamp)); return [today, L.addDays(today, -1)]; }

function loadOf(run, runDocId, p) {
  const d = run.days[p];
  return { runDocId, day: p, rev: run.rev || 0, route: run.route, run: run.run, driver: d.driver || coverageName(run), truck: d.truck || '', trailer: d.trailer || '', casesOut: d.casesOut === undefined ? null : d.casesOut,
    casesDelivered: d.casesDelivered === undefined ? null : d.casesDelivered, driverCaseReturn: d.driverCaseReturn === undefined ? null : d.driverCaseReturn,
    refusedReturned: d.refusedReturned || '', refusedReturnedSource: d.refusedReturnedSource || '', tractorIssues: d.tractorIssues || '', trailerIssues: d.trailerIssues || '',
    palletJackIssues: d.palletJackIssues || '', trailerNeedsCleaned: L.yes(d.trailerNeedsCleaned), checkinNotes: d.checkinNotes || '', checkinCompletedAt: d.checkinCompletedAt || '',
    // What the driver said at an earlier check-in: the unit numbers they corrected, drop-and-hook trailers, the jack, over / short.
    palletJack: d.palletJackUnit || d.palletJack || '', checkinTruck: d.checkinTruck || '', checkinTrailer: d.checkinTrailer || '', moreTrailers: Array.isArray(d.moreTrailers) ? d.moreTrailers : [],
    overageShortage: L.yes(d.overageShortage), overageShortageDetails: d.overageShortageDetails || '',
    loadedCorrectly: d.loadedCorrectly || '', loadingProblem: d.loadingProblem || '' };
}

// Who is checking in (Joe 10/11, as the old "Who is driving?"): a roster driver (their id), a fill-in or carrier name that is on
// today's dispatch but not the roster ("name:NAME"), one route picked instead of a name ("route:runDocId|day"), or Skip ("skip":
// every route of the day, the driver picks theirs). The phone keeps it like the name.
const nameKey = (v) => String(v === null || v === undefined ? '' : v).toUpperCase().replace(/\b(JR|SR|II|III|IV)\b/g, ' ').replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const coverageName = (run) => { const t = String(run.coverageType || '').trim().toUpperCase(); return t && t !== 'UNITED DAIRY' ? t : ''; };
async function whoFor(db, raw) {
  raw = String(raw || '').slice(0, 200);
  if (raw === 'skip') return { kind: 'skip', id: '', name: '', by: 'skip', mine: () => true };
  if (/^name:/.test(raw)) {
    const name = raw.slice(5).trim().toUpperCase().slice(0, 120), k = nameKey(name);
    if (!k) throw new SaveError('NOT_FOUND', 'Pick your name again');
    return { kind: 'name', id: '', name, by: 'name:' + name, mine: (run, id, p, d) => nameKey(d.driver) === k || (!d.driver && nameKey(coverageName(run)) === k) };
  }
  if (/^route:/.test(raw)) {
    const [runDocId, day] = raw.slice(6).split('|');
    if (!runDocId || L.DAYS.indexOf(day) < 0) throw new SaveError('NOT_FOUND', 'Pick your name again');
    return { kind: 'route', id: '', name: '', by: 'route:' + runDocId + '|' + day, mine: (run, id, p) => id === runDocId && p === day };
  }
  const driver = raw ? await db.collection(C.drivers).doc(M.safeIdPart(raw)).get() : null;
  if (!driver || !driver.exists || (driver.data().status || 'ACTIVE') !== 'ACTIVE') throw new SaveError('NOT_FOUND', 'Pick your name again');
  return { kind: 'driver', id: raw, name: driver.data().name, by: raw, mine: (run, id, p, d) => d.driverId === raw };
}

// The day's loads the phone may show (the Daily's runs that the Live sheet shows on the phone).
async function dayLoads(db, date) {
  const p = L.dayPrefix(date), snap = await db.collection(C.runs).where('weekStart', '==', L.weekStart(date)).get();
  return snap.docs.filter(s => { const d = s.data().days && s.data().days[p]; return d && d.runs && L.liveFlagShown(s.data(), 'displayMobileRoute', 'mobile'); }).map(s => ({ run: s.data(), id: s.id, p, d: s.data().days[p] }));
}
const byRoute = (a, b) => String(a.route).localeCompare(String(b.route), undefined, { numeric: true }) || String(a.run).localeCompare(String(b.run), undefined, { numeric: true });

// The unit lists the Check-In boxes offer (a short number finds the unit; any number is still taken).
// Joe 10/5 (GPS spec) and 10/13 ("according to what truck is entered"): the DVIR odometer fills from GPS. Each load's truck
// and every truck on the list get their latest Verizon Connect Fleet odometer (gpsTrucks, read every 5 minutes) when Fleet
// heard from it in the last 2 days, so the number follows whatever truck the driver types; the driver can still change it.
async function gpsOdometers(db, loads, trucks, nowMs) {
  const id = (u) => M.safeIdPart(String(u || '').trim().toUpperCase().replace(/\s+/g, ''));
  const ids = [...new Set(loads.map(l => id(l.truck)).concat((trucks || []).map(id)).filter(Boolean))];
  const by = {};
  if (!ids.length) return by;
  const docs = await db.getAll(...ids.map(x => db.collection('gpsTrucks').doc(x)));
  docs.forEach(d => { const t = d.exists ? d.data() : null; if (t && t.odometerMiles > 0 && nowMs - Date.parse(t.lastReport) < 2 * 86400000) by[d.id] = { miles: Math.round(t.odometerMiles), at: t.lastReport }; });
  loads.forEach(l => { const g = by[id(l.truck)]; if (g) l.gpsOdometer = g; });
  return by;
}

async function unitLists(db) {
  const all = (await db.collection(C.equipment).get()).docs.map(d => d.data()).filter(e => e.unit && (!e.status || e.status === 'ACTIVE'));
  const of = (t) => [...new Set(all.filter(e => e.type === t).map(e => String(e.unit).trim().toUpperCase()))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return { trucks: of('TRUCK'), trailers: of('TRAILER'), jacks: of('FORK_TRUCK') };
}

// The units a driver typed at check-in: a short number becomes the unit it finds, anything else is kept as typed.
const unitText = (v, max) => String(v === null || v === undefined ? '' : v).trim().toUpperCase().replace(/\s+/g, ' ').slice(0, max || 40);
function checkinExtras(f, d, equipment) {
  const bad = (m) => { throw new SaveError('BAD_REQUEST', m); };
  const out = {};
  if (f.overageShortage !== undefined || f.overageShortageDetails !== undefined) {
    out.overageShortageDetails = String(f.overageShortageDetails || '').trim().slice(0, 300);
    out.overageShortage = f.overageShortage === true || !!out.overageShortageDetails ? 'TRUE' : '';
    if (!out.overageShortage) out.overageShortageDetails = '';
  }
  // Joe 10/13: "Was your truck loaded correctly?" YES or NO; a NO says what was wrong. (A Check-In kept on a phone before
  // the question existed has neither and is still taken.)
  if (f.loadedCorrectly !== undefined || f.loadingProblem !== undefined) {
    const v = String(f.loadedCorrectly || '').trim().toUpperCase();
    if (v !== 'YES' && v !== 'NO') bad('Answer: Was your truck loaded correctly? Tap Yes or No.');
    out.loadedCorrectly = v;
    out.loadingProblem = v === 'NO' ? String(f.loadingProblem || '').trim().slice(0, 300) : '';
    if (v === 'NO' && !out.loadingProblem) bad('Write what was loaded wrong.');
  }
  const find = (raw, kind) => { const t = unitText(raw); if (!t || /^(N\/A|NA|TBA|NONE)$/.test(t)) return t === 'NA' ? 'N/A' : t; const u = MAINT.resolveUnit(t, kind, equipment); return u.resolved ? String(u.unit).trim().toUpperCase() : t; };
  if (f.palletJack !== undefined) out.palletJackUnit = find(f.palletJack, 'FORK_TRUCK');
  if (f.truck !== undefined) { const t = find(f.truck, 'TRUCK'); out.checkinTruck = t && t !== unitText(d.truck) ? t : ''; }
  if (f.trailer !== undefined || f.moreTrailers !== undefined) {
    const more = Array.isArray(f.moreTrailers) ? f.moreTrailers : [];
    if (more.length > DVIR.MAX_TRAILERS - 1) bad('A run can have at most 4 trailers.');
    const list = [dvirTrailer(f.trailer)].concat(more.map(m => dvirTrailer(m && m.trailer))), seen = {};
    list.forEach((t, i) => {
      if (i && !t) bad('Trailer ' + (i + 1) + ': enter the trailer number, or remove the box.');
      if (!i && !t && list.length > 1) bad('Trailer 1: enter the trailer number before adding another trailer.');
      if (t && t !== 'N/A' && !/^[A-Z0-9][A-Z0-9-]{0,19}$/.test(t)) bad('Trailer ' + (i + 1) + ': enter one trailer number per box (letters, numbers and dashes). Use Add trailer for another trailer.');
      if (t && seen[t]) bad('Trailer ' + t + ' is entered twice. Enter each trailer once, one per box.');
      seen[t] = true;
    });
    const named = list.map((t, i) => t && t !== 'N/A' ? find(t, 'TRAILER') : t);
    out.checkinTrailer = named[0] && named[0] !== unitText(d.trailer) ? named[0] : '';
    out.moreTrailers = more.map((m, i) => ({ trailer: named[i + 1], issues: String(m.issues || '').trim().slice(0, 300), needsCleaned: m.needsCleaned === true }));
  }
  [out.overageShortageDetails, out.loadingProblem].concat((out.moreTrailers || []).map(m => m.issues)).forEach(v => { if (/^=/.test(v || '')) bad('Formula-style text is blocked. Enter plain text only.'); });
  return out;
}

/*
 * One phone call: {code, op, ...}. op 'roster' -> active drivers; 'loads' {driverId, date} -> that driver's loads;
 * 'checkIn' {driverId, runDocId, day, requestId, fields} -> saves one check-in. Throws SaveError.
 */
/*
 * My Schedule (Joe 10/15): a driver types his employee number (Driver Master employee_id) and sees his week, Sunday to
 * Saturday. From Saturday's 6 AM roll the phone shows the coming week; before that, the current one. Each day comes from the
 * dispatch week (the Weekly's runs, as on its Driver board): his routes, else why he is off (Day Off exceptions), else OFF
 * from Driver Master (<day>_available), else Not scheduled.
 */
function scheduleWeek(today) { const week = L.weekStart(today); return L.dayPrefix(today) === 'sat' ? L.addDays(week, 7) : week; }
// Joe 10/17: zeros in front never matter, on either side: typed 009980 or 9980 finds 9980 or 009980 on Driver Master. Done as
// text, so a long number is never rounded.
const employeeKey = (v) => { const t = String(v === null || v === undefined ? '' : v).trim().toUpperCase().replace(/\s+/g, ' '); return /^\d+$/.test(t) ? t.replace(/^0+(?=\d)/, '') : t; };
const titleWord = (t) => String(t || '').toLowerCase().replace(/(^|[\s/-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
function scheduleDays(driver, rows, exceptions, week, backups) {
  const board = L.driverBoardRows([driver], rows, exceptions, week, backups)[0];
  return L.DAYS.map((p, i) => {
    const date = L.addDays(week, i), c = board ? board.days[p] : null;
    const runs = rows.filter(r => r.days[p].runs && r.days[p].driverId === driver.id).map(r => {
      const d = r.days[p], leaves = d.dispatchTime === null || d.dispatchTime === undefined || d.dispatchTime === '' ? '' : L.timeText(Number(d.dispatchTime));
      return { route: String(r.streamId || r.route || '').trim().replace(/_\d+$/, ''), run: r.streamId ? '' : String(r.run || '').trim(), truck: d.truck || '', trailer: d.trailer || '', leaves };
    });
    // Off on a day with a run (the exception wins on the board too): the run still shows, marked off.
    const off = c && (c.kind === 'vacation' || c.kind === 'unavailable' || c.kind === 'conflict') ? titleWord(L.exceptionLabel(L.exceptionOn(exceptions, driver.id, date)) || 'Off') : '';
    // Joe 10/16: a Backup day reads Backup (on call to cover a route).
    // Joe 10/23: a Day Note day reads the note, as Dispatch typed it.
    const note = c && c.note && !off ? c.note : '';
    const status = runs.length ? (off ? 'Off: ' + off : note) : off ? 'Off: ' + off : note || (c && c.kind === 'backup' ? 'Backup' : c && c.kind === 'off' ? 'Off' : 'Not scheduled');
    return { day: p, date, runs, status, kind: runs.length ? (off ? 'conflict' : 'work') : note ? 'daynote' : c && (c.kind === 'available' || c.kind === 'backup') || !c ? 'none' : 'off' };
  });
}
async function mySchedule(db, input, stamp) {
  const key = employeeKey(String(input.employeeId || '').slice(0, 40));
  if (!key) throw new SaveError('BAD_REQUEST', 'Type your employee number.');
  const drivers = (await db.collection(C.drivers).get()).docs.map(d => Object.assign({ id: d.id }, d.data())).filter(d => d.name && L.driverActive(d));
  const driver = drivers.find(d => employeeKey(d.employeeId) === key) || drivers.find(d => employeeKey(d.id) === key);
  if (!driver) throw new SaveError('NOT_FOUND', 'That employee number is not on the driver list. Check it, or ask Dispatch.');
  const today = L.operatingDay(new Date(stamp)), week = scheduleWeek(today);
  const runs = (await db.collection(C.runs).where('weekStart', '==', week).get()).docs.map(d => Object.assign({}, d.data(), { id: d.id }));
  const exceptions = (await db.collection(C.exceptions).where('driverId', '==', driver.id).get()).docs.map(d => d.data());
  const backups = (await db.collection(C.backups).where('driverId', '==', driver.id).get()).docs.map(d => d.data());
  const rows = L.weeklyRows(runs, week);
  // Posted: Weekly Publish has made the week the Live Current week (or it is already behind it); before that Dispatch may still change it.
  const live = ((await db.collection(C.config).doc('app').get()).data() || {}).liveWeeks || {};
  const posted = rows.length > 0 && (!live.current || week <= live.current);
  return { driverId: driver.id, name: driver.name, employeeId: String(driver.employeeId || '').trim(), week, end: L.addDays(week, 6), today, posted, built: rows.length > 0,
    days: scheduleDays(driver, rows, exceptions, week, backups), at: stamp };
}

async function phoneCall(db, input, now) {
  input = input || {};
  const stamp = (now ? now() : new Date()).toISOString();
  const op = String(input.op || '');
  // Joe 10/12: the Driver Room Check-In tablet types its own station code (Driver Station Codes, a Driver Room kiosk station),
  // not the phones' Route Distribution code. A TV's code is refused here: the TV keeps its own link.
  if (op === 'roomEnter') return roomStation(await STATIONS.tabletCall(db, { kind: 'KIOSK', op: 'enter', code: input.code }, now));
  if (op === 'roomCheck') return roomStation(await STATIONS.check(db, 'KIOSK', input.station && input.station.key, input.station && input.station.version));
  if (input.station) {
    const r = roomStation(await STATIONS.check(db, 'KIOSK', input.station.key, input.station.version));
    if (!r.ok) throw new SaveError('NOT_ALLOWED', r.message + ' (station code)');
  } else if (!(await checkCode(db, String(input.code || '').slice(0, 40), stamp, FAILS.who(input)))) throw new SaveError('NOT_ALLOWED', 'That code is not right. Ask Dispatch for the Route Distribution code.');
  if (op === 'roster') {
    const drivers = (await db.collection(C.drivers).get()).docs.map(d => d.data()).filter(d => d.name && L.driverActive(d));
    // Also the fill-in and carrier names on today's or yesterday's dispatch that are not on the roster, and the routes to pick instead of a name.
    const dates = allowedDates(stamp), roster = {}, others = {}, routes = [];
    drivers.forEach(d => { roster[nameKey(d.name)] = true; });
    for (const date of dates) {
      (await dayLoads(db, date)).forEach(x => {
        const name = String(x.d.driver || coverageName(x.run)).trim().toUpperCase();
        if (name && !roster[nameKey(name)] && !(x.d.driverId && drivers.some(d => d.id === x.d.driverId))) others[nameKey(name)] = name;
        if (date === dates[0]) routes.push({ id: 'route:' + x.id + '|' + x.p, route: x.run.route, run: x.run.run });
      });
    }
    return { drivers: drivers.map(d => ({ id: d.id, name: d.name, relief: !!d.reliefDriver })).sort((a, b) => a.name.localeCompare(b.name)), dates,
      others: Object.keys(others).map(k => others[k]).sort(), routes: routes.sort(byRoute).map(r => ({ id: r.id, name: String(r.route).replace(/_\d+$/, '') + ' · ' + r.run })) };
  }
  // View Loadout (Joe 10/10): the Driver Room board on the phone, read only, today's routes and their pickups.
  if (op === 'board') {
    // The loads the plant loads on this operating day (Saturday = the Sunday and Monday deliveries), as on the Driver Room board.
    const date = L.operatingDay(new Date(stamp)), week = L.weekStart(date);
    // Joe 10/30: yesterday's loads not loaded yet stay on, first, until they are loaded (last week's runs for Saturday's).
    const runs = (await db.collection(C.runs).where('weekStart', 'in', [L.addDays(week, -7), week, L.addDays(week, 7)]).get()).docs.map(d => Object.assign({}, d.data(), { id: d.id }));
    const pickups = (await db.collection('pickups').where('date', 'in', [L.addDays(date, -1), date, L.addDays(date, 1), L.addDays(date, 2), L.addDays(date, 3)]).get()).docs.map(d => d.data());
    const rows = B.loadoutBoardRows(runs, pickups, date, { carry: true }).map(r => ({ route: r.streamId || r.route, run: r.streamId ? '' : r.run, driver: r.driver, cases: r.cases, trailer: r.trailer, state: r.state, status: r.status, pickup: r.pickup, pickupText: r.pickupText }));
    return { date, rows, remaining: rows.filter(r => r.state !== 'LOADED').length, at: stamp };
  }
  if (op === 'schedule') return mySchedule(db, input, stamp);
  const who = await whoFor(db, input.driverId);
  const dates = allowedDates(stamp);
  if (op === 'loads') {
    const date = dates.indexOf(input.date) >= 0 ? input.date : dates[0];
    const loads = (await dayLoads(db, date)).filter(x => who.mine(x.run, x.id, x.p, x.d)).map(x => loadOf(x.run, x.id, x.p)).sort(byRoute);
    const units = await unitLists(db), odometers = await gpsOdometers(db, loads, units.trucks, Date.parse(stamp) || Date.now());
    const label = who.kind === 'route' ? (loads[0] ? 'Route ' + String(loads[0].route).replace(/_\d+$/, '') + ' · ' + loads[0].run : 'Your route') : who.kind === 'skip' ? 'Driver not chosen' : who.name;
    return { date, dates, driver: label, loads, units, gpsOdometers: Object.fromEntries(Object.entries(odometers).map(([k, v]) => [k, v.miles])) };
  }
  if (op === 'dvir') return saveDvir(db, input, who, dates, stamp);
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
    if (!d || !d.runs || !who.mine(run, req.runDocId, req.day, d) || dates.indexOf(date) < 0) throw new SaveError('NOT_ALLOWED', 'That load is not yours today; ask Dispatch');
    const equipment = (await tx.get(db.collection(C.equipment))).docs.map(x => x.data());
    const after = Object.assign({}, req.checkIn, checkinExtras(input.fields || {}, d, equipment), { checkinCompletedAt: stamp, checkinVia: 'PHONE' });
    const by = 'phone:' + who.by, name = who.name || d.driver || coverageName(run);
    // The write-ups go on the units the driver says they had (a corrected truck or trailer, the jack, each drop-and-hook trailer).
    const units = Object.assign({}, d, after);
    if (after.checkinTruck) Object.assign(units, { truck: after.checkinTruck, truckId: '' });
    if (after.checkinTrailer) Object.assign(units, { trailer: after.checkinTrailer, trailerId: '' });
    if (after.palletJackUnit) units.palletJack = after.palletJackUnit;
    const writeMaint = await MAINT.prepareMaintenance(tx, db, run, req.runDocId, req.day, date, units, { by: 'PUBLIC ROUTE · ' + name, driver: name }, stamp);
    const before = {}, update = { rev: run.rev + 1, testEdited: true, editedAt: stamp };
    Object.keys(after).forEach(k => { before[k] = d[k] === undefined ? null : d[k]; update['days.' + req.day + '.' + k] = after[k]; });
    update['days.' + req.day + '.updatedAt'] = stamp;
    update['days.' + req.day + '.updatedBy'] = by;
    tx.update(runRef, update);
    if (mode.writeBack) A.queueSheetCells(tx, db, req.requestId, '', run, req.runDocId, req.day, after, stamp, by);
    const result = { ok: true, requestId: req.requestId, runs: [{ runDocId: req.runDocId, rev: run.rev + 1 }] };
    result.maintenance = writeMaint(A.maintQueue(tx, db, mode, req.requestId, stamp, by));
    tx.set(logRef, { action: 'phoneCheckIn', by, driver: name, at: stamp, mode: mode.mode, runDocId: req.runDocId, day: req.day, before, after, result });
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

async function saveDvir(db, input, who, dates, stamp) {
  const req = validateDvir(input), by = 'phone:' + who.by, driver = { id: who.id, name: who.name || req.signatureName };
  const ids = req.trailers.map((t, i) => 'DVIR_app_' + req.requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 32) + '_' + (i + 1));
  return db.runTransaction(async tx => {
    const refs = ids.map(id => db.collection('dvirs').doc(id)), had = await tx.getAll(...refs);
    if (had.every(s => s.exists)) return { ok: true, duplicate: true, recordId: ids[0], recordIds: ids, trailers: ids.length };
    const mode = await A.requireTestMode(tx, db, 'checkIns');
    const runSnap = await tx.get(db.collection(C.runs).doc(req.runDocId)), run = runSnap.exists ? runSnap.data() : null, d = run && run.days && run.days[req.day];
    const date = run ? L.addDays(run.weekStart, L.DAYS.indexOf(req.day)) : '';
    if (!d || !d.runs || !who.mine(run, req.runDocId, req.day, d) || dates.indexOf(date) < 0) throw new SaveError('NOT_ALLOWED', 'This route is not assigned to you for that day; ask Dispatch');
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

module.exports = { phoneCall, scheduleWeek, scheduleDays, employeeKey, newRouteCode, hashCode, MAX_FAILED_PER_MINUTE, DVIR, dvirTrailer };
