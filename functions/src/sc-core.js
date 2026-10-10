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
 *   (or not done), a call-off. Personal Day, vacation and Off never count. Route cuts and GPS driving habits are
 *   "later": the columns are there and score nothing until that data exists.
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
    gradeA: 93, gradeB: 85, gradeC: 75, monthMinDays: 15
  }),
  NUMBER_SETTINGS: Object.freeze(['checkinMiss', 'lostCase', 'lostCaseDayCap', 'inspectionDefect', 'inspectionMissing', 'callOff',
    'gradeA', 'gradeB', 'gradeC', 'monthMinDays']),
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
      casesOut: scNum_(r.casesOut), casesIn: casesIn, miles: scNum_((milesByRun || {})[r.runId]) || 0});
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
      casesOut: 0, casesIn: 0, lostCases: 0, lostPoints: 0, inspected: 0, defects: 0, notInspected: 0, callOffs: 0, miles: 0, misses: []});
  }
  (days || []).forEach(function (d) {
    var r = get(d.driverKey, d.driver);
    r.runDays++; r.dates[d.date] = true; r.miles += d.miles || 0;
    r.routes[d.route] = (r.routes[d.route] || 0) + 1;
    if (d.checkedIn) r.checkins++; else { r.missedCheckins++; r.misses.push({date: d.date, what: 'Missed daily check-in (route ' + d.route + ')', points: s.checkinMiss}); }
    if (d.inspected && !d.defect) r.inspected++;
    else if (d.inspected) { r.defects++; r.misses.push({date: d.date, what: 'Inspection found a defect', points: s.inspectionDefect}); }
    else { r.notInspected++; if (s.inspectionMissing) r.misses.push({date: d.date, what: 'No inspection done', points: s.inspectionMissing}); }
    if (d.casesOut != null && d.casesIn != null) {
      r.casesOut += d.casesOut; r.casesIn += d.casesIn;
      var lost = Math.max(0, d.casesOut - d.casesIn);
      if (lost) {
        r.lostCases += lost;
        var pts = Math.min(s.lostCaseDayCap, lost * s.lostCase);
        r.lostPoints += pts;
        r.misses.push({date: d.date, what: lost + ' case' + (lost === 1 ? '' : 's') + ' short (out ' + d.casesOut + ', in ' + d.casesIn + ')', points: pts});
      }
    }
  });
  (callOffs || []).forEach(function (c) {
    var r = get(c.driverKey, names[c.driverKey]);
    r.callOffs++;
    r.misses.push({date: c.date, what: 'Call-off (' + c.reason.toLowerCase() + ')', points: s.callOff});
  });
  var rows = Object.keys(by).map(function (k) {
    var r = by[k];
    r.route = Object.keys(r.routes).sort(function (a, b) { return r.routes[b] - r.routes[a] || (a < b ? -1 : 1); })[0] || '';
    r.daysWorked = Object.keys(r.dates).length;
    var points = r.missedCheckins * s.checkinMiss + r.lostPoints + r.defects * s.inspectionDefect + r.notInspected * s.inspectionMissing + r.callOffs * s.callOff;
    r.score = Math.max(0, Math.round(100 - points));
    r.grade = scGrade_(r.score, s);
    r.misses.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    delete r.routes; delete r.dates;
    return r;
  });
  return scRank_(rows);
}

function scRank_(rows) {
  rows.sort(function (a, b) { return b.score - a.score || a.missedCheckins - b.missedCheckins || (a.driver < b.driver ? -1 : 1); });
  rows.forEach(function (r, i) { r.rank = i + 1; });
  return rows;
}

/** Year: the score is the average of the months he drove; counts are added up. months: [{month, rows}] */
function scScoreYear_(months, settings) {
  var by = {}, sums = ['runDays', 'daysWorked', 'checkins', 'missedCheckins', 'casesOut', 'casesIn', 'lostCases', 'inspected', 'defects',
    'notInspected', 'callOffs', 'miles'];
  (months || []).forEach(function (m) {
    var leader = scLeader_(m.rows, settings);
    m.rows.forEach(function (r) {
      var y = by[r.driverKey] || (by[r.driverKey] = {driverKey: r.driverKey, driver: r.driver, route: r.route, scores: [], monthsWon: 0, misses: []});
      sums.forEach(function (k) { y[k] = (y[k] || 0) + (r[k] || 0); });
      if (r.runDays) y.scores.push(r.score);
      if (leader && leader.driverKey === r.driverKey) y.monthsWon++;
      if (r.runDays) y.route = r.route;
    });
  });
  var rows = Object.keys(by).map(function (k) {
    var y = by[k], n = y.scores.length;
    y.score = n ? Math.round(y.scores.reduce(function (a, b) { return a + b; }, 0) / n) : 100;
    y.grade = scGrade_(y.score, settings);
    y.monthsScored = n;
    delete y.scores;
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
    leader: leader ? leader.driver : ''};
}

  return { SC_CORE: SC_CORE, scPad_: scPad_, scDateKey_: scDateKey_, scParseKey_: scParseKey_, scAddDays_: scAddDays_, scWeekday_: scWeekday_, scMonthRange_: scMonthRange_, scKeyOf_: scKeyOf_, scNum_: scNum_, scTruthy_: scTruthy_, scPersonKey_: scPersonKey_, scIsDriver_: scIsDriver_, scSettings_: scSettings_, scGrade_: scGrade_, scBuildDay_: scBuildDay_, scCallOffDays_: scCallOffDays_, scScoreMonth_: scScoreMonth_, scRank_: scRank_, scScoreYear_: scScoreYear_, scLeader_: scLeader_, scSummary_: scSummary_ };
});
