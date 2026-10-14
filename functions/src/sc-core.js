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
 * (harsh braking), hard starts (harsh acceleration), hard turns (harsh cornering) and idling each cost points (a day's GPS points are capped); miles, MPG
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
    speeding: 2, hardBrake: 2, hardAccel: 1, hardTurn: 1, idle: 1, gpsDayCap: 10,
    // Joe 10/13 Time grade: leaving the yard more than earlyMinutes before dispatch, or back more than lateMinutes past
    // dispatch plus the route's expected hours, costs leftEarly / backLate points. A day with no GPS yard time is not scored.
    earlyMinutes: 15, lateMinutes: 30, leftEarly: 1, backLate: 1,
    // Joe 10/13 rewards ("the better they do, the better the reward on everything"): every area earns cleanDay points for a
    // clean day and streakBonus for every streakDays clean days in a row; back backEarlyMinutes or more before the expected
    // return (without leaving early) earns backEarly more.
    cleanDay: 1, streakDays: 5, streakBonus: 2, backEarly: 1, backEarlyMinutes: 15,
    // Joe 10/13 truck cleanliness: a manager rates the driver's truck 1 to 5 (about once a month). 5 = +2, 4 = +1, 3 = 0,
    // 2 = -1, 1 = -2 to start (the two "off" numbers are points taken off). cleanOn 1 = on, 0 = off.
    cleanOn: 1, clean5: 2, clean4: 1, clean3: 0, clean2Off: 1, clean1Off: 2,
    // Joe 10/13 sleepers: an idling alert on a sleeper route (Route Master "Sleeper") costs sleeperIdlePct percent of the day-cab
    // points, because a sleeper with a bad APU sometimes has to idle. Seatbelt alerts (when the units report them) cost seatbelt.
    sleeperIdlePct: 25, seatbelt: 3,
    // Joe 10/13 fuel economy: a day's MPG below the truck's own average (or mpgTarget when it is not 0) by more than mpgBelowPct
    // percent costs mpgLow; any other day with fuel data is a perfect day. No fuel data = no grade.
    mpgTarget: 0, mpgBelowPct: 10, mpgLow: 1,
    // Joe 10/13 accidents / incidents: 1st degree (Minor) x accident1, 2nd (Damage) x accident2, 3rd (Total loss) x accident3 of
    // accidentBase points, counted only once a manager marks it "Reviewed - counts". The weight fades by 3-month steps:
    // accidentFade1..4 percent for 0-3, 3-6, 6-9 and 9-12 months, then it is gone.
    accidentBase: 15, accident1: 1, accident2: 2, accident3: 3, accidentFade1: 100, accidentFade2: 75, accidentFade3: 50, accidentFade4: 25,
    // Complaints: Minor complaintMinor, Major complaintMajor, once reviewed as counting; 100% for 0-3 months, 50% for 3-6, then gone.
    complaintMinor: 3, complaintMajor: 10, complaintFade1: 100, complaintFade2: 50,
    // Call-offs fade over 3 months: sickFade1..3 percent in the first, second and third month, then gone.
    sickFade1: 100, sickFade2: 66, sickFade3: 33,
    // Joe 10/13 PDA (Progressive Discipline Action), a manager's decision (no review step): Verbal warning, Written warning,
    // Final written warning, Suspension; 100% for 0-3 months, 66% for 3-6, 33% for 6-9, then gone.
    pdaVerbal: 5, pdaWritten: 10, pdaFinal: 20, pdaSuspension: 30, pdaFade1: 100, pdaFade2: 66, pdaFade3: 33,
    // The Driver's Kiosk Station shows grades only; 1 also shows each driver's reasons.
    kioskReasons: 0
  }),
  NUMBER_SETTINGS: Object.freeze(['checkinMiss', 'lostCase', 'lostCaseDayCap', 'inspectionDefect', 'inspectionMissing', 'callOff',
    'gradeA', 'gradeB', 'gradeC', 'monthMinDays', 'speeding', 'hardBrake', 'hardAccel', 'hardTurn', 'idle', 'gpsDayCap', 'earlyMinutes', 'lateMinutes', 'leftEarly', 'backLate', 'cleanDay', 'streakDays', 'streakBonus', 'backEarly', 'backEarlyMinutes',
    'cleanOn', 'clean5', 'clean4', 'clean3', 'clean2Off', 'clean1Off', 'sleeperIdlePct', 'seatbelt', 'mpgTarget', 'mpgBelowPct', 'mpgLow',
    'accidentBase', 'accident1', 'accident2', 'accident3', 'accidentFade1', 'accidentFade2', 'accidentFade3', 'accidentFade4',
    'complaintMinor', 'complaintMajor', 'complaintFade1', 'complaintFade2', 'sickFade1', 'sickFade2', 'sickFade3', 'kioskReasons',
    'pdaVerbal', 'pdaWritten', 'pdaFinal', 'pdaSuspension', 'pdaFade1', 'pdaFade2', 'pdaFade3']),
  GPS_KINDS: Object.freeze(['speeding', 'hardBrake', 'hardAccel', 'hardTurn', 'idle', 'seatbelt']),
  // Joe 10/13 (later): the board shows one grade per area and the overall score; the details are one click away.
  AREAS: Object.freeze([['checkin', 'Check-in'], ['cases', 'Cases'], ['inspection', 'Inspections'], ['attendance', 'Attendance'],
    ['speeding', 'Speeding'], ['hardStops', 'Hard Stops'], ['idling', 'Idling'], ['seatbelt', 'Seatbelt'], ['fuel', 'Fuel MPG'], ['time', 'Time'],
    ['cleanliness', 'Truck Clean'], ['accidents', 'Accidents'], ['complaints', 'Complaints'], ['pda', 'PDA']]),
  // Accidents, complaints and attendance look back past the period on screen (12, 6 and 3 months), fading as they age.
  ROLLING: Object.freeze(['attendance', 'accidents', 'complaints', 'pda']),
  PDA_STEPS: Object.freeze([['verbal', 'Verbal warning', 'pdaVerbal'], ['written', 'Written warning', 'pdaWritten'], ['final', 'Final written warning', 'pdaFinal'], ['suspension', 'Suspension', 'pdaSuspension']]),
  INCIDENT_AREA: Object.freeze({ accident: 'accidents', complaint: 'complaints', pda: 'pda' }),
  ACCIDENT_CLASSES: Object.freeze([[1, '1st degree', 'Minor'], [2, '2nd degree', 'Damage'], [3, '3rd degree', 'Total loss']]),
  INCIDENT_STATUS: Object.freeze({ review: 'Under review', counts: 'Reviewed \u2013 counts', notCounted: 'Reviewed \u2013 not counted' }),
  GPS_AREA: Object.freeze({ speeding: 'speeding', hardBrake: 'hardStops', hardAccel: 'hardStops', hardTurn: 'hardStops', idle: 'idling', seatbelt: 'seatbelt' }),
  GPS_WORDS: Object.freeze({ speeding: 'Speeding', hardBrake: 'Hard stop', hardAccel: 'Hard start', hardTurn: 'Hard turn', idle: 'Idling', seatbelt: 'Seatbelt' }),
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
  // Joe 10/13: the kiosk shows each driver's overall score; areas ticked here show beside it (none to start).
  var areaKeys = SC_CORE.AREAS.map(function (a) { return a[0]; });
  s.kioskAreas = (Array.isArray(saved.kioskAreas) ? saved.kioskAreas : []).filter(function (k) { return areaKeys.indexOf(k) >= 0; });
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
      truck: String(r.truck == null ? '' : r.truck).trim(), startTime: String(r.startTime == null ? '' : r.startTime).trim(),
      dispatchMinutes: scMinutesOf_(r.dispatchTime), routeHours: scHoursOf_(r.routeHours), sleeper: scTruthy_(r.sleeper)});
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
  // Joe 10/14: harsh cornering (left or right) counts under Hard Stops too.
  if (/CORNER|TURN/.test(t)) return 'hardTurn';
  if (/IDL/.test(t)) return 'idle';
  if (/SEAT.?BELT|BELT/.test(t)) return 'seatbelt';
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
/** A dispatch time as minutes after midnight: 330, "5:30", "05:30 AM" or "5:30 PM" (null when there is none). */
function scMinutesOf_(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return isFinite(v) && v >= 0 && v < 1440 ? Math.round(v) : null;
  var m = String(v).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/);
  if (!m) return null;
  var h = +m[1] % 24, ap = (m[3] || '').toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + +m[2];
}
/** Expected route hours: 9.5 or "9:30" (null when there is none). */
function scHoursOf_(v) {
  if (v === '' || v == null) return null;
  var m = String(v).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (m) return +m[1] + +m[2] / 60;
  var n = scNum_(v);
  return n != null && n > 0 && n < 24 ? n : null;
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
 * back in `unassigned`, never dropped. ours (optional): our Uniontown Equipment Master unit names; when given, `unassigned`
 * keeps only alerts on those units (matched by letters and digits, the way Trucks Today matches them), so another plant's
 * Fleet units never land under No driver dispatched.
 */
function scMatchGps_(dateKey, records, gpsDays, alerts, ours) {
  var byTruck = {}, byDigits = {}, unassigned = [], mine = null;
  if (ours) { mine = {}; ours.forEach(function (u) { var k = scUnitKey_(u); if (k) mine[k] = true; }); }
  (records || []).forEach(function (r) {
    var k = scUnitKey_(r.truck);
    r.alerts = {speeding: 0, hardBrake: 0, hardAccel: 0, hardTurn: 0, idle: 0, seatbelt: 0}; r.alertList = [];
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
      if (mine && !mine[scUnitKey_(a.tag)]) return;
      var key = scUnitKey_(a.tag) || '?', u = lost[key] || (lost[key] = {date: dateKey, truck: String(a.tag || '').trim() || '(no unit name)', alerts: [],
        counts: {speeding: 0, hardBrake: 0, hardAccel: 0, hardTurn: 0, idle: 0, seatbelt: 0}});
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

// ---------- rolling areas, excuses (Joe 10/13) ----------
// Whole calendar months from one date to a later one (0 in the first month).
function scMonthsBetween_(a, b) {
  var x = scParseKey_(a), y = scParseKey_(b);
  if (!x.y || !y.y || String(b) <= String(a)) return 0;
  return (y.y - x.y) * 12 + (y.m - x.m) - (y.d < x.d ? 1 : 0);
}
/** Share of a weight left on asOf: steps are the percents for each `months`-month step (then it is gone). No asOf = all of it. */
function scFade_(date, asOf, months, steps) {
  if (!asOf) return 1;
  var i = Math.floor(scMonthsBetween_(date, asOf) / months);
  return i < steps.length ? steps[i] / 100 : 0;
}
function scRound_(n) { return Math.round(n * 100) / 100; }
/** The key a manager's Excuse is saved under: a GPS alert (date, truck, time, kind) or a Time miss (date, driver, early/late). */
function scMissKey_(kind, date, a, b) { return [kind, date, String(a == null ? '' : a), String(b == null ? '' : b)].join('|'); }
function scAlertKey_(date, a) { return scMissKey_('gps', date, scUnitKey_(a.tag) + '@' + (a.at || ''), a.kind); }
function scSickFade_(date, asOf, s) { return scFade_(date, asOf, 1, [s.sickFade1, s.sickFade2, s.sickFade3]); }
/** What an accident or complaint costs on asOf: class or severity points, faded by its age (0 once it is gone). */
function scPdaStep_(x) { return SC_CORE.PDA_STEPS.filter(function (k) { return k[0] === x.step; })[0] || SC_CORE.PDA_STEPS[0]; }
function scIncidentPoints_(x, s, asOf) {
  if (x.kind === 'pda') return scRound_(s[scPdaStep_(x)[2]] * scFade_(x.date, asOf, 3, [s.pdaFade1, s.pdaFade2, s.pdaFade3]));
  if (x.kind === 'accident') {
    var c = Math.min(3, Math.max(1, Math.round(Number(x.accidentClass)) || 1));
    return scRound_(s.accidentBase * s['accident' + c] * scFade_(x.date, asOf, 3, [s.accidentFade1, s.accidentFade2, s.accidentFade3, s.accidentFade4]));
  }
  return scRound_((String(x.severity).toLowerCase() === 'major' ? s.complaintMajor : s.complaintMinor) * scFade_(x.date, asOf, 3, [s.complaintFade1, s.complaintFade2]));
}
/** An accident or complaint as one line. */
function scIncidentText_(x) {
  if (x.kind === 'pda') return 'PDA: ' + scPdaStep_(x)[1] + (x.reason ? ', ' + x.reason : '') + (x.note ? ' (' + x.note + ')' : '');
  if (x.kind === 'accident') {
    var c = SC_CORE.ACCIDENT_CLASSES.filter(function (k) { return k[0] === (Math.round(Number(x.accidentClass)) || 1); })[0] || SC_CORE.ACCIDENT_CLASSES[0];
    return 'Accident, ' + c[1] + ' (' + c[2] + ')' + (x.type ? ': ' + x.type : '') + (x.truck ? ', truck ' + x.truck : '') + (x.preventable ? ', preventable' : '') + (x.note ? ' (' + x.note + ')' : '');
  }
  return (String(x.source).toLowerCase() === 'other' ? 'Complaint' : 'Customer complaint') + ' (' + (String(x.severity).toLowerCase() === 'major' ? 'Major' : 'Minor') + ')' +
    (x.customer ? ' from ' + x.customer : '') + (x.type ? ': ' + x.type : '') + (x.note ? ' (' + x.note + ')' : '');
}
/** A day's MPG: miles over gallons, else Fleet's MPG (null when the truck sent no fuel data). */
function scDayMpg_(d) {
  if (d.fuelGallons && d.gpsMiles) return d.gpsMiles / d.fuelGallons;
  return scNum_(d.mpg) || null;
}

// ---------- a month ----------
/**
 * days: scBuildDay_ records for the month (through yesterday); callOffs: scCallOffDays_; names: {driverKey: name} (Drivers Master).
 * opts: alertsOn, seatbeltOn, ratings, excuses {key: {reason, by}}, incidents [driverIncidents], accidentsOn, complaintsOn,
 * start (the period's first day: call-offs before it carry over), asOf (the last day counted: what fades is aged to it).
 * Returns rows sorted best first, with the points each miss cost.
 */
function scScoreMonth_(days, callOffs, settings, names, opts) {
  var s = settings, by = {};
  names = names || {};
  opts = opts || {};
  var ex = opts.excuses || {}, asOf = opts.asOf || '', start = opts.start || '';
  // Speeding, hard stops and idling are scored only once Fleet alerts are coming in, so a quiet feed earns no rewards.
  var alertsOn = opts.alertsOn !== false;
  function scored(r, date, area) { (r.scored[date] = r.scored[date] || {})[area] = true; }
  function get(key, name) {
    return by[key] || (by[key] = {driverKey: key, driver: names[key] || name || key, routes: {}, runDays: 0, dates: {}, checkins: 0, missedCheckins: 0,
      casesOut: 0, casesIn: 0, lostCases: 0, lostPoints: 0, inspected: 0, defects: 0, notInspected: 0, callOffs: 0, miles: 0, misses: [],
      trucks: {}, speeding: 0, hardBrakes: 0, hardAccels: 0, hardTurns: 0, idles: 0, seatbelts: 0, idleMinutes: 0, gpsPoints: 0, gpsMiles: 0, gpsDays: 0, fuelGallons: 0, fuelMiles: 0, mpgMiles: 0, leftEarly: 0, backLate: 0,
      mpgSum: 0, yardOuts: [], yardIns: [], yardFromMoves: false, scored: {}, rewards: [], pending: [], lowMpgDays: 0});
  }
  // Fuel: each truck's own average MPG over the period (all its drivers), unless Settings has a target.
  var fuelBy = {};
  (days || []).forEach(function (d) {
    var mpg = scDayMpg_(d), k = scUnitKey_(d.truck);
    if (!mpg || !d.gpsMiles || !k) return;
    var f = fuelBy[k] || (fuelBy[k] = {miles: 0, gallons: 0});
    f.miles += d.gpsMiles; f.gallons += d.gpsMiles / mpg;
  });
  (days || []).forEach(function (d) {
    var r = get(d.driverKey, d.driver);
    r.runDays++; r.dates[d.date] = true; r.miles += d.miles || 0;
    r.routes[d.route] = (r.routes[d.route] || 0) + 1;
    if (d.truck) r.trucks[d.truck] = (r.trucks[d.truck] || 0) + 1;
    scAddGps_(r, d, s, ex);
    ['checkin', 'inspection', 'attendance'].forEach(function (a) { scored(r, d.date, a); });
    if (d.casesOut != null && d.casesIn != null) scored(r, d.date, 'cases');
    var gps = d.gpsMiles != null || (d.alertList || []).length;
    if (alertsOn && gps) ['speeding', 'hardStops', 'idling'].forEach(function (a) { scored(r, d.date, a); });
    // Seatbelt counts only once the units send seatbelt alerts.
    if (alertsOn && opts.seatbeltOn && gps) scored(r, d.date, 'seatbelt');
    if (d.dispatchMinutes != null && (d.yardOut != null || d.yardIn != null)) scored(r, d.date, 'time');
    var mpg = scDayMpg_(d);
    if (mpg) {
      scored(r, d.date, 'fuel');
      var f = fuelBy[scUnitKey_(d.truck)], ref = s.mpgTarget > 0 ? s.mpgTarget : f && f.gallons ? f.miles / f.gallons : mpg;
      if (mpg < ref * (1 - s.mpgBelowPct / 100)) {
        r.lowMpgDays++;
        r.misses.push({date: d.date, what: 'MPG ' + mpg.toFixed(1) + ', below the ' + (s.mpgTarget > 0 ? 'target ' : 'truck\'s average ') + ref.toFixed(1) + (d.truck ? ' (truck ' + d.truck + ')' : ''), points: s.mpgLow, area: 'fuel'});
      }
    }
    if (d.checkedIn) r.checkins++; else { r.missedCheckins++; r.misses.push({date: d.date, what: 'Missed daily check-in (route ' + d.route + ')', points: s.checkinMiss, area: 'checkin'}); }
    if (d.inspected && !d.defect) r.inspected++;
    else if (d.inspected) { r.defects++; r.misses.push({date: d.date, what: 'Inspection found a defect', points: s.inspectionDefect, area: 'inspection'}); }
    // No inspection is never a clean day (no reward), and costs what Settings says (0 to start).
    else { r.notInspected++; r.misses.push({date: d.date, what: 'No inspection done', points: s.inspectionMissing, area: 'inspection'}); }
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
  // Call-offs fade over 3 months; those before the period carry over onto drivers who worked in it.
  var carried = [];
  (callOffs || []).forEach(function (c) {
    var w = scSickFade_(c.date, asOf, s);
    if (!w) return;
    if (start && c.date < start) { carried.push(c); return; }
    var r = get(c.driverKey, names[c.driverKey]);
    r.callOffs++;
    scored(r, c.date, 'attendance');
    r.misses.push({date: c.date, what: 'Call-off (' + c.reason.toLowerCase() + ')' + (w < 1 ? ', ' + Math.round(w * 100) + '% as it ages' : ''), points: scRound_(s.callOff * w), area: 'attendance'});
  });
  carried.forEach(function (c) {
    var r = by[c.driverKey], w = scSickFade_(c.date, asOf, s);
    if (!r) return;
    r.carriedCallOffs = (r.carriedCallOffs || 0) + 1;
    r.misses.push({date: c.date, what: 'Call-off (' + c.reason.toLowerCase() + '), earlier, ' + Math.round(w * 100) + '% as it ages', points: scRound_(s.callOff * w), area: 'attendance', carried: true});
  });
  // Accidents and complaints count once a manager reviews them as counting; under review they show but cost nothing yet.
  var byName = {};
  Object.keys(by).forEach(function (k) { byName[scPersonKey_(by[k].driver)] = by[k]; });
  (opts.incidents || []).forEach(function (x) {
    if (!x || !x.date || (asOf && x.date > asOf)) return;
    var r = by[scPersonKey_(x.driverKey)] || byName[scPersonKey_(x.driver)], area = SC_CORE.INCIDENT_AREA[x.kind] || 'complaints';
    if (!r) return;
    // A PDA is already a manager's decision: it counts from the day it is entered.
    if (x.status === 'counts' || (x.kind === 'pda' && x.status !== 'notCounted')) {
      var pts = scIncidentPoints_(x, s, asOf);
      if (pts > 0) r.misses.push({date: x.date, what: scIncidentText_(x), points: pts, area: area, carried: true, incidentId: x.id || ''});
    } else if (x.status !== 'notCounted') r.pending.push({date: x.date, what: scIncidentText_(x), area: area, incidentId: x.id || ''});
  });
  // Truck cleanliness ratings for the period [{driverKey, date, rating 1-5, truck, note}], when the area is on.
  if (s.cleanOn) (opts.ratings || []).forEach(function (x) {
    var n = Math.round(Number(x.rating));
    if (!x.driverKey || !(n >= 1 && n <= 5) || !by[x.driverKey]) return;
    var r = by[x.driverKey], pts = scCleanPoints_(n, s), what = 'Truck cleanliness ' + n + ' of 5' + (x.truck ? ' (truck ' + x.truck + ')' : '') + (x.note ? ': ' + x.note : '');
    r.cleanRatings = (r.cleanRatings || []).concat([{date: x.date, rating: n, points: pts}]);
    if (pts < 0) r.misses.push({date: x.date, what: what, points: -pts, area: 'cleanliness'});
    else r.rewards.push({date: x.date, what: what, points: pts, area: 'cleanliness'});
  });
  var on = {accidents: !!opts.accidentsOn, complaints: !!opts.complaintsOn, pda: !!opts.pdaOn};
  var rows = Object.keys(by).map(function (k) {
    var r = by[k];
    r.route = Object.keys(r.routes).sort(function (a, b) { return r.routes[b] - r.routes[a] || (a < b ? -1 : 1); })[0] || '';
    r.daysWorked = Object.keys(r.dates).length;
    r.truck = Object.keys(r.trucks).sort(function (a, b) { return r.trucks[b] - r.trucks[a] || (a < b ? -1 : 1); })[0] || '';
    r.truckList = Object.keys(r.trucks).sort();
    scFinishGps_(r);
    r.misses.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    r.areas = scAreas_(r, s, on);
    scOverall_(r, s);
    delete r.routes; delete r.dates; delete r.trucks; delete r.scored;
    return r;
  });
  return scRank_(rows);
}

// One alert's points: Settings per kind; idling on a sleeper route counts sleeperIdlePct percent of it.
function scAlertWeight_(kind, d, s) { var w = s[kind] || 0; return kind === 'idle' && d.sleeper ? scRound_(w * s.sleeperIdlePct / 100) : w; }
// One day's GPS onto a driver's month: points per alert, capped per day. An excused alert costs nothing and is shown as excused.
function scAddGps_(r, d, s, ex) {
  var a = d.alerts || {}, list = d.alertList || [], pts = 0, used = 0;
  ex = ex || {};
  list.forEach(function (x) { if (!ex[scAlertKey_(d.date, x)]) pts += scAlertWeight_(x.kind, d, s); });
  r.speeding += a.speeding || 0; r.hardBrakes += a.hardBrake || 0; r.hardAccels += a.hardAccel || 0; r.hardTurns += a.hardTurn || 0; r.idles += a.idle || 0; r.seatbelts += a.seatbelt || 0;
  var capped = s.gpsDayCap > 0 ? Math.min(pts, s.gpsDayCap) : pts;
  r.gpsPoints = scRound_(r.gpsPoints + capped);
  list.forEach(function (x) {
    var key = scAlertKey_(d.date, x), e = ex[key], miss = {date: d.date, what: scAlertText_(x, d.truck) + (x.kind === 'idle' && d.sleeper ? ', sleeper' : ''), area: SC_CORE.GPS_AREA[x.kind], key: key};
    if (e) { miss.points = 0; miss.excused = {reason: e.reason || '', by: e.by || ''}; r.misses.push(miss); return; }
    // Each alert shows what it cost; past the day's cap the rest show 0.
    var full = scAlertWeight_(x.kind, d, s);
    miss.points = s.gpsDayCap > 0 ? scRound_(Math.max(0, Math.min(full, s.gpsDayCap - used))) : full;
    used += full;
    r.misses.push(miss);
  });
  if (d.gpsMiles != null) { r.gpsMiles += d.gpsMiles; r.gpsDays++; }
  if (d.idleMinutes != null) r.idleMinutes += d.idleMinutes;
  else if (d.alertIdleMinutes) r.idleMinutes += d.alertIdleMinutes;
  if (d.fuelGallons && d.gpsMiles) { r.fuelGallons += d.fuelGallons; r.fuelMiles += d.gpsMiles; }
  else if (d.mpg && d.gpsMiles) { r.mpgMiles += d.gpsMiles; r.mpgSum += d.mpg * d.gpsMiles; }
  scAddTime_(r, d, s, ex);
  if (d.yardOut != null) r.yardOuts.push(d.yardOut);
  if (d.yardIn != null) r.yardIns.push(d.yardIn);
  if (d.yardFromMoves) r.yardFromMoves = true;
}
// Joe 10/13: the Time grade, on the dispatch time and the route's expected hours.
function scAddTime_(r, d, s, ex) {
  if (d.dispatchMinutes == null) return;
  ex = ex || {};
  var miss = function (which, what, points) {
    var key = scMissKey_('time', d.date, r.driverKey, which), e = ex[key];
    r.misses.push(e ? {date: d.date, what: what, points: 0, area: 'time', key: key, excused: {reason: e.reason || '', by: e.by || ''}} : {date: d.date, what: what, points: points, area: 'time', key: key});
    return !e;
  };
  var early = d.yardOut != null && d.dispatchMinutes - d.yardOut > s.earlyMinutes;
  if (early && miss('early', 'Left the yard ' + scClock_(d.yardOut) + ', ' + (d.dispatchMinutes - d.yardOut) + ' min before dispatch ' + scClock_(d.dispatchMinutes), s.leftEarly)) r.leftEarly++;
  // A return before the dispatch time is the next day's (overnight); it is not scored.
  if (d.yardIn != null && d.routeHours && d.yardIn > d.dispatchMinutes) {
    var due = d.dispatchMinutes + Math.round(d.routeHours * 60);
    if (due - d.yardIn >= s.backEarlyMinutes && !early) {
      r.rewards.push({date: d.date, area: 'time', points: s.backEarly, what: 'Back ' + (due - d.yardIn) + ' min before the expected ' + scClock_(due)});
    }
    if (d.yardIn - due > s.lateMinutes && miss('late', 'Back at the yard ' + scClock_(d.yardIn) + ', ' + (d.yardIn - due) + ' min past the expected ' + scClock_(due), s.backLate)) r.backLate++;
  }
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

/*
 * Joe 10/13 rewards and grades. Per area, each day it applies: a clean day earns cleanDay, every streakDays clean days in a
 * row earn streakBonus, a miss costs its points (Settings). The area's score comes from its points per day, so a driver
 * with fewer days is not held back: 80 + 20 x points per day, at most 100 (a clean day every day is 100; a 4-point miss in
 * 10 days is 90). An area with no days to score shows no grade. The overall score is the average of the scored areas.
 * Accidents and complaints are 100 less what the counted ones cost now (after fading); a call-off from before the period
 * (carried over) takes its faded points off Attendance.
 */
function scAreaScore_(points, days) { return days ? Math.max(0, Math.min(100, Math.round(80 + 20 * points / days))) : null; }
function scCleanPoints_(n, s) { return n === 5 ? s.clean5 : n === 4 ? s.clean4 : n === 3 ? s.clean3 : n === 2 ? -s.clean2Off : -s.clean1Off; }
function scAreas_(r, s, on) {
  var out = {}, missBy = {}, carry = {};
  on = on || {};
  // An excused miss costs nothing and does not spoil the perfect day.
  (r.misses || []).forEach(function (m) {
    if (m.excused) return;
    if (m.carried) { carry[m.area] = (carry[m.area] || 0) + (m.points || 0); return; }
    var k = m.area + '|' + m.date; missBy[k] = (missBy[k] || 0) + (m.points || 0);
  });
  var dates = Object.keys(r.scored || {}).sort();
  SC_CORE.AREAS.forEach(function (a) {
    var k = a[0], o = {days: 0, clean: 0, streaks: 0, rewards: 0, lost: 0}, run = 0;
    // Truck cleanliness counts only its ratings: 80 + 10 x points per rating (5 = 100, 4 = 90, 3 = 80, 2 = 70, 1 = 60 to start).
    if (k === 'cleanliness') {
      (r.cleanRatings || []).forEach(function (x) { o.days++; if (x.points >= 0) o.rewards += x.points; else o.lost -= x.points; });
      o.ratings = o.days; o.points = o.rewards - o.lost;
      o.score = o.days ? Math.max(0, Math.min(100, Math.round(80 + 10 * o.points / o.days))) : null;
      o.grade = o.score == null ? '' : scGrade_(o.score, s);
      out[k] = o;
      return;
    }
    if (k === 'accidents' || k === 'complaints' || k === 'pda') {
      o.lost = scRound_(carry[k] || 0); o.points = o.lost ? -o.lost : 0;
      o.days = on[k] && dates.length ? 1 : 0;
      o.score = o.days ? Math.max(0, Math.round(100 - o.lost)) : null;
      o.grade = o.score == null ? '' : scGrade_(o.score, s);
      out[k] = o;
      return;
    }
    dates.forEach(function (d) {
      if (!r.scored[d][k]) return;
      o.days++;
      var miss = missBy[k + '|' + d];
      if (miss != null) { o.lost += miss; run = 0; return; }
      o.clean++; o.rewards += s.cleanDay; run++;
      if (s.streakDays > 0 && run % s.streakDays === 0) { o.streaks++; o.rewards += s.streakBonus; }
    });
    (r.rewards || []).forEach(function (x) { if (x.area === k) { o.rewards += x.points; o.extra = (o.extra || 0) + x.points; } });
    if (carry[k] && o.days) { o.carried = scRound_(carry[k]); o.lost += carry[k]; }
    o.lost = scRound_(o.lost);
    o.points = scRound_(o.rewards - o.lost);
    o.score = scAreaScore_(o.points, o.days);
    o.grade = o.score == null ? '' : scGrade_(o.score, s);
    out[k] = o;
  });
  return out;
}
function scOverall_(r, s) {
  var list = SC_CORE.AREAS.map(function (a) { return r.areas[a[0]]; }).filter(function (o) { return o.score != null; });
  r.points = scRound_(SC_CORE.AREAS.reduce(function (t, a) { return t + r.areas[a[0]].points; }, 0));
  r.score = list.length ? Math.round(list.reduce(function (t, o) { return t + o.score; }, 0) / list.length) : 100;
  r.grade = scGrade_(r.score, s);
}

function scRank_(rows) {
  rows.sort(function (a, b) { return b.score - a.score || a.missedCheckins - b.missedCheckins || (a.driver < b.driver ? -1 : 1); });
  rows.forEach(function (r, i) { r.rank = i + 1; });
  return rows;
}

/** Year: the score is the average of the months he drove; counts are added up. months: [{month, rows}] */
function scScoreYear_(months, settings) {
  var by = {}, sums = ['runDays', 'daysWorked', 'checkins', 'missedCheckins', 'casesOut', 'casesIn', 'lostCases', 'inspected', 'defects',
    'notInspected', 'callOffs', 'miles', 'speeding', 'hardBrakes', 'hardAccels', 'hardTurns', 'idles', 'seatbelts', 'idleMinutes', 'gpsPoints', 'gpsMiles', 'gpsDays', 'fuelGallons', 'leftEarly', 'backLate'];
  (months || []).forEach(function (m) {
    var leader = scLeader_(m.rows, settings);
    m.rows.forEach(function (r) {
      var y = by[r.driverKey] || (by[r.driverKey] = {driverKey: r.driverKey, driver: r.driver, route: r.route, scores: [], monthsWon: 0, misses: []});
      sums.forEach(function (k) { y[k] = (y[k] || 0) + (r[k] || 0); });
      if (r.runDays) y.scores.push(r.score);
      if (r.runDays && r.areas) Object.keys(r.areas).forEach(function (k) { if (r.areas[k].score == null) return; var a = (y.areaScores = y.areaScores || {}); (a[k] = a[k] || []).push(r.areas[k].score); });
      y.points = (y.points || 0) + (r.points || 0);
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
    SC_CORE.AREAS.forEach(function (a) { var l = (y.areaScores || {})[a[0]] || [], sc = l.length ? Math.round(l.reduce(function (t, x) { return t + x; }, 0) / l.length) : null; y.areas[a[0]] = {score: sc, grade: sc == null ? '' : scGrade_(sc, settings)}; });
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

  return { SC_CORE: SC_CORE, scPad_: scPad_, scDateKey_: scDateKey_, scParseKey_: scParseKey_, scAddDays_: scAddDays_, scWeekday_: scWeekday_, scMonthRange_: scMonthRange_, scKeyOf_: scKeyOf_, scNum_: scNum_, scTruthy_: scTruthy_, scPersonKey_: scPersonKey_, scIsDriver_: scIsDriver_, scUnitKey_: scUnitKey_, scWeekRange_: scWeekRange_, scAlertKind_: scAlertKind_, scNyMinutes_: scNyMinutes_, scClock_: scClock_, scMatchGps_: scMatchGps_, scAlertText_: scAlertText_, scAreas_: scAreas_, scCleanPoints_: scCleanPoints_, scAreaScore_: scAreaScore_, scMinutesOf_: scMinutesOf_, scHoursOf_: scHoursOf_, scSettings_: scSettings_, scGrade_: scGrade_, scBuildDay_: scBuildDay_, scCallOffDays_: scCallOffDays_, scScoreMonth_: scScoreMonth_, scRank_: scRank_, scScoreYear_: scScoreYear_, scLeader_: scLeader_, scSummary_: scSummary_, scMonthsBetween_: scMonthsBetween_, scFade_: scFade_, scMissKey_: scMissKey_, scAlertKey_: scAlertKey_, scIncidentPoints_: scIncidentPoints_, scIncidentText_: scIncidentText_, scDayMpg_: scDayMpg_, scAlertWeight_: scAlertWeight_, scPdaStep_: scPdaStep_ };
});
