/*
 * Driver Scorecard scoring, copied unchanged from the current app's 224_V7279_DriverScorecardCore.gs (pure JavaScript).
 * The screen (scorecard.html) and the server (actions.js) both load this one file.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UDScore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
/**
 * 7.0.279 Driver Scorecard: pure logic (no Apps Script services), so Node can test it (tools/test_driver_scorecard_core.cjs).
 * Screen DriverScorecard.html, server 225_V7279_DriverScorecardServer.gs, notes docs/DRIVER_SCORECARD.md. Joe picked screen A on 2026-10-09: one table of every driver for the month.
 *
 * Every driver starts the month at 100 and loses the points set on the Settings screen for each miss:
 *   missed daily check-in, lost cases (cases out at loadout minus cases in at unloading), an inspection with a defect
 *   (or not done), a call-off. Personal Day, vacation and Off never count. Route cuts are "later".
 *
 * Joe 10/13 (GPS): driving habits come from Verizon Connect Fleet (gpsDays and gpsAlerts, read every 5 minutes). What counts is
 * the TRUCK plus the driver Daily Dispatch put in that truck that day, never the driver Fleet shows. Speeding, hard stops
 * (harsh braking), hard starts (harsh acceleration) and idling each cost points (a day's GPS points are capped); miles, MPG
 * and yard leave / return times are shown. An alert on a truck nobody was dispatched in is kept as "No driver dispatched".
 */
var SC_CORE = Object.freeze({
  DAYS: Object.freeze(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']),
  MONTHS: Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']),
  // Driver Off / Weekly availability reasons. Only the ticked ones count as a call-off.
  REASONS: Object.freeze(['CALLED OFF', 'SICK DAY', 'UNPAID DAY', 'OTHER', 'BEREAVEMENT']),
  NEVER_COUNT: Object.freeze(['VACATION', 'PERSONAL DAY', 'OFF', 'AVAILABLE']),
  DEFAULTS: Object.freeze({
    checkinMiss: 4, lostCase: 1, lostCaseDayCap: 10, inspectionDefect: 2, inspectionMissing: 0, callOff: 3,
    callOffReasons: ['CALLED OFF', 'SICK DAY', 'UNPAID DAY', 'OTHER'],
    gradeA: 93, gradeB: 85, gradeC: 75, monthMinDays: 15,
    // Joe 10/13 GPS starting weights (he adjusts them on Settings): points per alert, at most gpsDayCap a day (0 = no cap).
    speeding: 2, hardBrake: 2, hardAccel: 1, idle: 1, gpsDayCap: 10
  }),
  NUMBER_SETTINGS: Object.freeze(['checkinMiss', 'lostCase', 'lostCaseDayCap', 'inspectionDefect', 'inspectionMissing', 'callOff',
    'gradeA', 'gradeB', 'gradeC', 'monthMinDays', 'speeding', 'hardBrake', 'hardAccel', 'idle', 'gpsDayCap']),
  GPS_KINDS: Object.freeze(['speeding', 'hardBrake', 'hardAccel', 'idle']),
  // Joe 10/13 (later): the board shows one grade per area and the overall score; the details are one click away.
  AREAS: Object.freeze([['checkin', 'Check-in'], ['cases', 'Cases'], ['inspection', 'Inspections'], ['attendance', 'Attendance'],
    ['speeding', 'Speeding'], ['hardStops', 'Hard Stops'], ['idling', 'Idling']]),
  GPS_AREA: Object.freeze({ speeding: 'speeding', hardBrake: 'hardStops', hardAccel: 'hardStops', idle: 'idling' }),
  GPS_WORDS: Object.freeze({ speeding: 'Speeding', hardBrake: 'Hard stop', hardAccel: 'Hard start', idle: 'Idling' }),
  NOT_A_DRIVER: /^(|open|tba|tbd|none|n\/a|na|needs driver|.*needs driver.*|vacation.*|off)$/i
});

// ---------- dates ----------
function scPad_(n) { return (n < 10 ? '0' : '') + n; }
function scDateKey_(y, m, d) { return y + '-' + scPad_(m) + '-' + scPad_(d); }
function scParseKey_(key) { var p = String(key).split('-').map(Number); return {y: p[0], m: p[1], d: p[2]}; }
function scAddDays_(key, n) {
  var p = scParseKey_(key), t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return scDateKey_(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
function scWeekday_(key) { var p = scParseKey_(key); return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); }
/** The Sunday-to-Saturday week holding the day. */
function scWeekRange_(key) { var start = scAddDays_(key, -scWeekday_(key)); return {start: start, end: scAddDays_(start, 6)}; }
function scMonthRange_(y, m) { return {start: scDateKey_(y, m, 1), end: scAddDays_(scDateKey_(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1), -1)}; }
function scKeyOf_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? '' : scDateKey_(v.getFullYear(), v.getMonth() + 1, v.getDate());
  var s = String(v == null ? '' : v).trim(), m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return scDateKey_(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) return scDateKey_(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  return '';
}

// ---------- small helpers ----------
function scNum_(v) {
  if (v === '' || v == null) return null;
  var n = Number(String(v).replace(/,/g, '').trim());
  return isFinite(n) ? n : null;
}
function scTruthy_(v) { return v === true || /^(true|yes|y|1|x|on|runs)$/i.test(String(v == null ? '' : v).trim()); }
function scPersonKey_(v) { return String(v == null ? '' : v).trim().replace(/\s+/g, ' ').toUpperCase(); }
function scIsDriver_(name) { return !SC_CORE.NOT_A_DRIVER.test(String(name == null ? '' : name).trim()); }
// Fleet names a truck "223876" and a trailer "T-635"; Daily Dispatch may type "223 876" or "t635". Letters and digits only.
function scUnitKey_(v) { return String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, ''); }

/** Settings saved by Joe merged over the defaults; numbers are checked so a typo cannot break the board. */
function scSettings_(saved) {
  var s = {}, d = SC_CORE.DEFAULTS;
  saved = saved || {};
  SC_CORE.NUMBER_SETTINGS.forEach(function (k) {
    var n = scNum_(saved[k]);
    s[k] = n == null || n < 0 || n > 1000 ? d[k] : n;
  });
  var reasons = Array.isArray(saved.callOffReasons) ? saved.callOffReasons : d.callOffReasons;
  s.callOffReasons = SC_CORE.REASONS.filter(function (r) { return reasons.map(scPersonKey_).indexOf(r) >= 0; });
  if (!(s.gradeA > s.gradeB && s.gradeB > s.gradeC)) { s.gradeA = d.gradeA; s.gradeB = d.gradeB; s.gradeC = d.gradeC; }
  return s;
}

function scGrade_(score, s) { return score >= s.gradeA ? 'A' : score >= s.gradeB ? 'B' : score >= s.gradeC ? 'C' : 'D'; }

// ---------- one day ----------
/**
 * One record per run a driver drove that day.
 * liveRows: [{runId, route, run, runs, driver, driverId, casesOut, plantCaseReturn, driverCaseReturn}] (that day's columns of the Live week).
 * events: that day's PLANT_OPERATIONS events [{eventType, payload:{route, run, checks}}].
 * milesByRun: {runId: miles} from Route Master for that weekday.
 */
function scBuildDay_(dateKey, liveRows, events, milesByRun) {
  var checkins = {}, inspections = {};
  (events || []).forEach(function (e) {
    var p = e && e.payload || {}, k = String(p.route || '').trim() + '|' + String(p.run || '').trim();
    if (e.eventType === 'ROUTE_CHECKIN') checkins[k] = true;
    if (e.eventType === 'DVIR') {
      var i = inspections[k] || (inspections[k] = {done: true, defect: false});
      if ((p.checks || []).indexOf('Defect found') >= 0 || String(p.tractorIssues || '').trim() || String(p.trailerIssues || '').trim()) i.defect = true;
    }
  });
  var out = [];
  (liveRows || []).forEach(function (r) {
    if (!scTruthy_(r.runs) || !scIsDriver_(r.driver)) return;
    var k = String(r.route || '').trim() + '|' + String(r.run || '').trim(), insp = inspections[k] || {done: false, defect: false};
    var casesIn = scNum_(r.plantCaseReturn);
    if (casesIn == null) casesIn = scNum_(r.driverCaseReturn);
    out.push({date: dateKey, driverKey: scPersonKey_(r.driverId || r.driver), driver: String(r.driver).trim(), route: String(r.route || '').trim(),
      run: String(r.run || '').trim(), runId: String(r.runId || '').trim(), checkedIn: !!checkins[k], inspected: insp.done, defect: insp.defect,
      casesOut: scNum_(r.casesOut), casesIn: casesIn, miles: scNum_((milesByRun || {})[r.runId]) || 0,
      truck: String(r.truck == null ? '' : r.truck).trim(), startTime: String(r.startTime == null ? '' : r.startTime).trim()});
  });
  return out;
}

/** Call-off days in [start, end] from DRIVER_EXCEPTIONS rows {driver_id, start_date, end_date, exception_type, reason_code, status}. */
function scCallOffDays_(exceptions, start, end, settings) {
  var out = [], seen = {}, counted = settings.callOffReasons;
  (exceptions || []).forEach(function (x) {
    var status = scPersonKey_(x.status), reason = scPersonKey_(x.reason_code || x.exception_type);
    if (!x.driver_id || ['CANCELLED', 'CLEAR', 'AVAILABLE', 'DENIED'].indexOf(status) >= 0) return;
    if (SC_CORE.NEVER_COUNT.indexOf(reason) >= 0 || counted.indexOf(reason) < 0) return;
    var a = scKeyOf_(x.start_date), z = scKeyOf_(x.end_date) || a;
    if (!a) return;
    for (var d = a < start ? start : a; d <= z && d <= end; d = scAddDays_(d, 1)) {
      var k = scPersonKey_(x.driver_id) + '|' + d;
      if (seen[k]) continue;
      seen[k] = true;
      out.push({date: d, driverKey: scPersonKey_(x.driver_id), reason: reason});
    }
  });
  return out;
}

// ---------- GPS (Joe 10/13) ----------
/** Fleet alert type text to the scorecard's kind ('' = not scored, like fault codes). */
function scAlertKind_(type) {
  var t = String(type == null ? '' : type).toUpperCase();
  if (/SPEED/.test(t)) return 'speeding';
  if (/BRAK|HARD.?STOP/.test(t)) return 'hardBrake';
  if (/ACCEL|HARD.?START/.test(t)) return 'hardAccel';
  if (/IDL/.test(t)) return 'idle';
  return '';
}
/** Minutes after midnight, New York time, of an ISO time (null when there is none). */
function scNyMinutes_(iso) {
  var d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return null;
  try {
    var p = new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(d), h = 0, m = 0;
    p.forEach(function (x) { if (x.type === 'hour') h = +x.value % 24; if (x.type === 'minute') m = +x.value; });
    return h * 60 + m;
  } catch (e) { return d.getHours() * 60 + d.getMinutes(); }
}
function scClockMinutes_(hhmm) { var m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; }
/** 345 -> "5:45 AM". */
function scClock_(min) {
  if (min == null || !isFinite(min)) return '';
  min = Math.round(min) % 1440;
  var h = Math.floor(min / 60), m = min % 60;
  return (h % 12 || 12) + ':' + scPad_(m) + ' ' + (h < 12 ? 'AM' : 'PM');
}

/**
 * Puts one day's GPS on the drivers Daily Dispatch put in each truck (scBuildDay_ records, which carry the truck).
 * gpsDays: that day's gpsDays docs [{tag, miles, firstMove, lastMove, yardOut, yardIn, idleMinutes, fuelGallons, mpg}].
 * alerts: that day's gpsAlerts [{tag, at, type, speedMph, limitMph, minutes, place}].
 * A truck that ran two dispatched runs that day gives each alert to the run that had started by then (the earliest run
 * before any had started), and its miles and yard times to its first run. Alerts on a truck no driver was dispatched in come
 * back in `unassigned`, never dropped.
 */
function scMatchGps_(dateKey, records, gpsDays, alerts) {
  var byTruck = {}, byDigits = {}, unassigned = [];
  (records || []).forEach(function (r) {
    var k = scUnitKey_(r.truck);
    r.alerts = {speeding: 0, hardBrake: 0, hardAccel: 0, idle: 0}; r.alertList = [];
    if (!k) return;
    (byTruck[k] = byTruck[k] || []).push(r);
    var dg = k.replace(/\D/g, '');
    if (dg && dg === k) (byDigits[dg] = byDigits[dg] || []).push(r);
  });
  Object.keys(byTruck).forEach(function (k) {
    byTruck[k].sort(function (a, b) { return (scClockMinutes_(a.startTime) || 0) - (scClockMinutes_(b.startTime) || 0); });
  });
  function runsFor(tag) {
    var k = scUnitKey_(tag);
    if (!k) return null;
    if (byTruck[k]) return byTruck[k];
    var dg = k.replace(/\D/g, '');
    return dg && /^\d+$/.test(k) && byDigits[dg] ? byDigits[dg] : null;
  }
  (gpsDays || []).forEach(function (g) {
    var list = runsFor(g.tag);
    if (!list) return;
    var r = list[0], fuel = scNum_(g.fuelGallons);
    r.gpsMiles = (r.gpsMiles || 0) + (scNum_(g.miles) || 0);
    if (fuel) r.fuelGallons = (r.fuelGallons || 0) + fuel;
    if (scNum_(g.mpg)) r.mpg = scNum_(g.mpg);
    if (scNum_(g.idleMinutes) != null) r.idleMinutes = scNum_(g.idleMinutes);
    var out = g.yardOut || g.firstMove || '', back = g.yardIn || g.lastMove || '';
    r.yardOut = scNyMinutes_(out); r.yardIn = scNyMinutes_(back);
    r.yardFromMoves = !(g.yardOut || g.yardIn) && !!(out || back);
  });
  var lost = {};
  (alerts || []).forEach(function (a) {
    var kind = scAlertKind_(a.type);
    if (!kind) return;
    var item = {kind: kind, at: a.at || '', minutes: scNyMinutes_(a.at), speedMph: scNum_(a.speedMph), limitMph: scNum_(a.limitMph), idleMinutes: scNum_(a.minutes),
      place: String(a.place || ''), tag: String(a.tag || '')};
    var list = runsFor(a.tag);
    if (!list) {
      var key = scUnitKey_(a.tag) || '?', u = lost[key] || (lost[key] = {date: dateKey, truck: String(a.tag || '').trim() || '(no unit name)', alerts: [],
        counts: {speeding: 0, hardBrake: 0, hardAccel: 0, idle: 0}});
      u.alerts.push(item); u.counts[kind]++;
      return;
    }
    var r = list[0];
    if (list.length > 1 && item.minutes != null) list.forEach(function (x) { var st = scClockMinutes_(x.startTime); if (st != null && st <= item.minutes) r = x; });
    r.alerts[kind]++; r.alertList.push(item);
    // Until Fleet's day idle time is read, idling is the sum of the IDLE alerts' minutes.
    if (kind === 'idle' && item.idleMinutes) r.alertIdleMinutes = (r.alertIdleMinutes || 0) + item.idleMinutes;
  });
  Object.keys(lost).sort().forEach(function (k) { unassigned.push(lost[k]); });
  return {records: records || [], unassigned: unassigned};
}

/** What one alert reads like on a driver's list of misses. */
function scAlertText_(a, truck) {
  var w = SC_CORE.GPS_WORDS[a.kind] || a.kind, bits = [];
  if (a.kind === 'speeding' && a.speedMph != null) bits.push(Math.round(a.speedMph) + ' mph' + (a.limitMph != null ? ' in a ' + Math.round(a.limitMph) : ''));
  if (a.kind === 'idle' && a.idleMinutes != null) bits.push(Math.round(a.idleMinutes) + ' min');
  if (a.minutes != null) bits.push(scClock_(a.minutes));
  if (truck) bits.push('truck ' + truck);
  if (a.place) bits.push(a.place);
  return w + (bits.length ? ' (' + bits.join(', ') + ')' : '');
}

// ---------- a month ----------
/**
 * days: scBuildDay_ records for the month (through yesterday); callOffs: scCallOffDays_; names: {driverKey: name} (Drivers Master).
 * Returns rows sorted best first, with the points each miss cost.
 */
function scScoreMonth_(days, callOffs, settings, names) {
  var s = settings, by = {};
  names = names || {};
  function get(key, name) {
    return by[key] || (by[key] = {driverKey: key, driver: names[key] || name || key, routes: {}, runDays: 0, dates: {}, checkins: 0, missedCheckins: 0,
      casesOut: 0, casesIn: 0, lostCases: 0, lostPoints: 0, inspected: 0, defects: 0, notInspected: 0, callOffs: 0, miles: 0, misses: [],
      trucks: {}, speeding: 0, hardBrakes: 0, hardAccels: 0, idles: 0, idleMinutes: 0, gpsPoints: 0, gpsMiles: 0, gpsDays: 0, fuelGallons: 0, fuelMiles: 0, mpgMiles: 0,
      mpgSum: 0, yardOuts: [], yardIns: [], yardFromMoves: false});
  }
  (days || []).forEach(function (d) {
    var r = get(d.driverKey, d.driver);
    r.runDays++; r.dates[d.date] = true; r.miles += d.miles || 0;
    r.routes[d.route] = (r.routes[d.route] || 0) + 1;
    if (d.truck) r.trucks[d.truck] = (r.trucks[d.truck] || 0) + 1;
    scAddGps_(r, d, s);
    if (d.checkedIn) r.checkins++; else { r.missedCheckins++; r.misses.push({date: d.date, what: 'Missed daily check-in (route ' + d.route + ')', points: s.checkinMiss, area: 'checkin'}); }
    if (d.inspected && !d.defect) r.inspected++;
    else if (d.inspected) { r.defects++; r.misses.push({date: d.date, what: 'Inspection found a defect', points: s.inspectionDefect, area: 'inspection'}); }
    else { r.notInspected++; if (s.inspectionMissing) r.misses.push({date: d.date, what: 'No inspection done', points: s.inspectionMissing, area: 'inspection'}); }
    if (d.casesOut != null && d.casesIn != null) {
      r.casesOut += d.casesOut; r.casesIn += d.casesIn;
      var lost = Math.max(0, d.casesOut - d.casesIn);
      if (lost) {
        r.lostCases += lost;
        var pts = Math.min(s.lostCaseDayCap, lost * s.lostCase);
        r.lostPoints += pts;
        r.misses.push({date: d.date, what: lost + ' case' + (lost === 1 ? '' : 's') + ' short (out ' + d.casesOut + ', in ' + d.casesIn + ')', points: pts, area: 'cases'});
      }
    }
  });
  (callOffs || []).forEach(function (c) {
    var r = get(c.driverKey, names[c.driverKey]);
    r.callOffs++;
    r.misses.push({date: c.date, what: 'Call-off (' + c.reason.toLowerCase() + ')', points: s.callOff, area: 'attendance'});
  });
  var rows = Object.keys(by).map(function (k) {
    var r = by[k];
    r.route = Object.keys(r.routes).sort(function (a, b) { return r.routes[b] - r.routes[a] || (a < b ? -1 : 1); })[0] || '';
    r.daysWorked = Object.keys(r.dates).length;
    r.truck = Object.keys(r.trucks).sort(function (a, b) { return r.trucks[b] - r.trucks[a] || (a < b ? -1 : 1); })[0] || '';
    r.truckList = Object.keys(r.trucks).sort();
    scFinishGps_(r);
    var points = r.missedCheckins * s.checkinMiss + r.lostPoints + r.defects * s.inspectionDefect + r.notInspected * s.inspectionMissing + r.callOffs * s.callOff + r.gpsPoints;
    r.score = Math.max(0, Math.round(100 - points));
    r.grade = scGrade_(r.score, s);
    r.areas = scAreas_(r.misses, s);
    r.misses.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    delete r.routes; delete r.dates; delete r.trucks;
    return r;
  });
  return scRank_(rows);
}

// One day's GPS onto a driver's month: points per alert, capped per day.
function scAddGps_(r, d, s) {
  var a = d.alerts || {}, pts = 0;
  SC_CORE.GPS_KINDS.forEach(function (k) { pts += (a[k] || 0) * s[k]; });
  r.speeding += a.speeding || 0; r.hardBrakes += a.hardBrake || 0; r.hardAccels += a.hardAccel || 0; r.idles += a.idle || 0;
  var capped = s.gpsDayCap > 0 ? Math.min(pts, s.gpsDayCap) : pts;
  r.gpsPoints += capped;
  (d.alertList || []).forEach(function (x, i) {
    // Each alert shows what it cost; past the day's cap the rest show 0.
    var used = (d.alertList || []).slice(0, i).reduce(function (t, y) { return t + s[y.kind]; }, 0), full = s[x.kind];
    var p = s.gpsDayCap > 0 ? Math.max(0, Math.min(full, s.gpsDayCap - used)) : full;
    r.misses.push({date: d.date, what: scAlertText_(x, d.truck), points: p, area: SC_CORE.GPS_AREA[x.kind]});
  });
  if (d.gpsMiles != null) { r.gpsMiles += d.gpsMiles; r.gpsDays++; }
  if (d.idleMinutes != null) r.idleMinutes += d.idleMinutes;
  else if (d.alertIdleMinutes) r.idleMinutes += d.alertIdleMinutes;
  if (d.fuelGallons && d.gpsMiles) { r.fuelGallons += d.fuelGallons; r.fuelMiles += d.gpsMiles; }
  else if (d.mpg && d.gpsMiles) { r.mpgMiles += d.gpsMiles; r.mpgSum += d.mpg * d.gpsMiles; }
  if (d.yardOut != null) r.yardOuts.push(d.yardOut);
  if (d.yardIn != null) r.yardIns.push(d.yardIn);
  if (d.yardFromMoves) r.yardFromMoves = true;
}
// Averages: MPG from miles and gallons (or Fleet's MPG weighted by miles), the usual yard leave and return times.
function scFinishGps_(r) {
  var avg = function (l) { return l.length ? Math.round(l.reduce(function (t, x) { return t + x; }, 0) / l.length) : null; };
  var gallons = r.fuelGallons + (r.mpgSum ? r.mpgMiles * r.mpgMiles / r.mpgSum : 0);
  r.mpg = gallons > 0 ? Math.round((r.fuelMiles + r.mpgMiles) / gallons * 10) / 10 : null;
  r.gpsMiles = Math.round(r.gpsMiles * 10) / 10;
  r.yardOut = avg(r.yardOuts); r.yardIn = avg(r.yardIns);
  delete r.yardOuts; delete r.yardIns; delete r.mpgMiles; delete r.mpgSum; delete r.fuelMiles;
}

/** Each area's grade: 100 less the points that area cost, graded like the overall score. */
function scAreas_(misses, s) {
  var out = {};
  SC_CORE.AREAS.forEach(function (a) { out[a[0]] = {points: 0}; });
  (misses || []).forEach(function (m) { if (out[m.area]) out[m.area].points += m.points || 0; });
  Object.keys(out).forEach(function (k) { var sc = Math.max(0, Math.round(100 - out[k].points)); out[k].score = sc; out[k].grade = scGrade_(sc, s); });
  return out;
}

function scRank_(rows) {
  rows.sort(function (a, b) { return b.score - a.score || a.missedCheckins - b.missedCheckins || (a.driver < b.driver ? -1 : 1); });
  rows.forEach(function (r, i) { r.rank = i + 1; });
  return rows;
}

/** Year: the score is the average of the months he drove; counts are added up. months: [{month, rows}] */
function scScoreYear_(months, settings) {
  var by = {}, sums = ['runDays', 'daysWorked', 'checkins', 'missedCheckins', 'casesOut', 'casesIn', 'lostCases', 'inspected', 'defects',
    'notInspected', 'callOffs', 'miles', 'speeding', 'hardBrakes', 'hardAccels', 'idles', 'idleMinutes', 'gpsPoints', 'gpsMiles', 'gpsDays', 'fuelGallons'];
  (months || []).forEach(function (m) {
    var leader = scLeader_(m.rows, settings);
    m.rows.forEach(function (r) {
      var y = by[r.driverKey] || (by[r.driverKey] = {driverKey: r.driverKey, driver: r.driver, route: r.route, scores: [], monthsWon: 0, misses: []});
      sums.forEach(function (k) { y[k] = (y[k] || 0) + (r[k] || 0); });
      if (r.runDays) y.scores.push(r.score);
      if (r.runDays && r.areas) Object.keys(r.areas).forEach(function (k) { var a = (y.areaScores = y.areaScores || {}); (a[k] = a[k] || []).push(r.areas[k].score); });
      if (leader && leader.driverKey === r.driverKey) y.monthsWon++;
      if (r.runDays) { y.route = r.route; y.truck = r.truck || y.truck || ''; }
      if (r.mpg && r.gpsMiles) { y.mpgMiles = (y.mpgMiles || 0) + r.gpsMiles; y.mpgGallons = (y.mpgGallons || 0) + r.gpsMiles / r.mpg; }
      ['yardOut', 'yardIn'].forEach(function (k) { if (r[k] != null) (y[k + 's'] = y[k + 's'] || []).push(r[k]); });
    });
  });
  var rows = Object.keys(by).map(function (k) {
    var y = by[k], n = y.scores.length;
    y.score = n ? Math.round(y.scores.reduce(function (a, b) { return a + b; }, 0) / n) : 100;
    y.grade = scGrade_(y.score, settings);
    y.monthsScored = n;
    y.mpg = y.mpgGallons ? Math.round(y.mpgMiles / y.mpgGallons * 10) / 10 : null;
    ['yardOut', 'yardIn'].forEach(function (k) { var l = y[k + 's'] || []; y[k] = l.length ? Math.round(l.reduce(function (t, x) { return t + x; }, 0) / l.length) : null; delete y[k + 's']; });
    y.areas = {};
    SC_CORE.AREAS.forEach(function (a) { var l = (y.areaScores || {})[a[0]] || [], sc = l.length ? Math.round(l.reduce(function (t, x) { return t + x; }, 0) / l.length) : 100; y.areas[a[0]] = {score: sc, grade: scGrade_(sc, settings)}; });
    delete y.areaScores;
    delete y.scores; delete y.mpgMiles; delete y.mpgGallons;
    return y;
  });
  return scRank_(rows);
}

/** Driver of the Month (or Year) so far: best score among drivers with enough days worked. */
function scLeader_(rows, settings, minDays) {
  var need = minDays == null ? settings.monthMinDays : minDays;
  for (var i = 0; i < (rows || []).length; i++) if ((rows[i].daysWorked || 0) >= need) return rows[i];
  return null;
}

function scSummary_(rows, settings, minDays) {
  var graded = rows.filter(function (r) { return r.runDays; }), leader = scLeader_(rows, settings, minDays);
  return {drivers: graded.length,
    average: graded.length ? Math.round(graded.reduce(function (a, r) { return a + r.score; }, 0) / graded.length) : null,
    missedCheckins: rows.reduce(function (a, r) { return a + r.missedCheckins; }, 0),
    lostCases: rows.reduce(function (a, r) { return a + r.lostCases; }, 0),
    callOffs: rows.reduce(function (a, r) { return a + r.callOffs; }, 0),
    speeding: rows.reduce(function (a, r) { return a + (r.speeding || 0); }, 0),
    hardBrakes: rows.reduce(function (a, r) { return a + (r.hardBrakes || 0); }, 0),
    leader: leader ? leader.driver : ''};
}

  return { SC_CORE: SC_CORE, scPad_: scPad_, scDateKey_: scDateKey_, scParseKey_: scParseKey_, scAddDays_: scAddDays_, scWeekday_: scWeekday_, scMonthRange_: scMonthRange_, scKeyOf_: scKeyOf_, scNum_: scNum_, scTruthy_: scTruthy_, scPersonKey_: scPersonKey_, scIsDriver_: scIsDriver_, scUnitKey_: scUnitKey_, scWeekRange_: scWeekRange_, scAlertKind_: scAlertKind_, scNyMinutes_: scNyMinutes_, scClock_: scClock_, scMatchGps_: scMatchGps_, scAlertText_: scAlertText_, scAreas_: scAreas_, scSettings_: scSettings_, scGrade_: scGrade_, scBuildDay_: scBuildDay_, scCallOffDays_: scCallOffDays_, scScoreMonth_: scScoreMonth_, scRank_: scRank_, scScoreYear_: scScoreYear_, scLeader_: scLeader_, scSummary_: scSummary_ };
});
