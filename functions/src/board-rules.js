/*
 * The Driver Room board's rules (the drivers' View Loadout on the phone, the Driver Room board and its TV), shared by the
 * screens and the server (one file, copied unchanged to public/js/board-rules.js; a unit test checks the two match).
 *
 * The same rules as the current app (udpoV749DriverBoardLoadoutForFacility_, udpoV7201DriverBoardState_, 052_V749):
 *   - the board is today's routes (the calendar day in New York) shown on the drivers' Check-In (display_mobile_route);
 *   - LOADED: the loaded tick, an End time, or a stored COMPLETE / COMPLETED / LOADED / READY; LOADING: a Start time without
 *     an End (or a stored LOADING / PAUSED); anything else WAITING;
 *   - a load with an open pickup (product that did not load) shows a red PICKUP line, "<qty> <item> - <notes>" joined by "; ";
 *   - sorted by load order, then route, then run; a trailing "_2" load number is not shown on the route;
 *   - the weekly schedule is Sunday to Saturday, one row per driver with a route that week: relief drivers first, then
 *     seniority date, then position order, then name.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./logic'));
  else root.UDBoard = factory(root.UDLogic);
})(typeof self !== 'undefined' ? self : this, function (L) {
  function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function routeNumber(route) { return text(route).replace(/_\d+$/, ''); }
  function trailerText(v) { var t = text(v).toUpperCase(); var m = /^T?\s*-?\s*(\d+)$/.exec(t.replace(/\s+/g, '')); return m ? 'T-' + m[1] : t; }

  // Today's calendar day in New York (the board's day; the check-in and DVIR use the 6 AM operating day).
  function calendarDay(now) {
    var parts = {};
    new Intl.DateTimeFormat('en-US', { timeZone: L.TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now || new Date()).forEach(function (p) { parts[p.type] = p.value; });
    return parts.year + '-' + parts.month + '-' + parts.day;
  }

  function boardState(day) {
    var s = text(day.loadStatus).toUpperCase();
    if (day.completeTime || day.loadedComplete === true || ['COMPLETE', 'COMPLETED', 'LOADED', 'READY'].indexOf(s) >= 0) return 'LOADED';
    if (day.plantStartedAt || s === 'LOADING' || s === 'PAUSED') return 'LOADING';
    return 'WAITING';
  }
  var STATE_TEXT = { LOADED: 'Loaded', LOADING: 'Loading', WAITING: 'Waiting' };

  function pickupOpen(p) { return ['COMPLETE', 'COMPLETED', 'CLOSED'].indexOf(text(p.status).toUpperCase()) < 0; }
  function pickupLine(p) { var what = [text(p.quantity), text(p.item)].filter(Boolean).join(' '); return (what + (text(p.notes) ? (what ? ' - ' : '') + text(p.notes) : '')) || 'Pickup'; }

  // The board for one day. runs = run documents (each with its id), pickups = the pickups list.
  function boardRows(runs, pickups, date) {
    var p = L.dayPrefix(date), week = L.weekStart(date), rows = [];
    (runs || []).forEach(function (run) {
      var day = run.days && run.days[p];
      if (run.weekStart !== week || !day || !day.runs || !L.liveFlagShown(run, 'displayMobileRoute', 'mobile')) return;
      var offset = day.loadDayOffset === null || day.loadDayOffset === undefined ? -1 : day.loadDayOffset, loadDate = L.addDays(date, offset);
      var mine = (pickups || []).filter(function (x) {
        if (!pickupOpen(x)) return false;
        var same = x.runDocId ? x.runDocId === run.id && (!x.day || x.day === p) : (x.runId && text(x.runId) === text(run.runId)) || (!x.runId && text(x.route) === text(run.route) && text(x.run) === text(run.run));
        return same && (x.date === date || x.date === loadDate);
      });
      var state = boardState(day);
      rows.push({ runDocId: run.id, day: p, route: routeNumber(run.route), run: text(run.run), streamId: text(run.streamId), driver: text(day.driver), truck: text(day.truck),
        trailer: trailerText(day.trailer), cases: day.casesOut === null || day.casesOut === undefined ? '' : day.casesOut, notes: text(day.driverNotes), sequence: L.effectiveSequence(day),
        state: state, status: STATE_TEXT[state], pickup: mine.length > 0, pickupText: mine.map(pickupLine).join('; ') });
    });
    return rows.sort(function (a, b) {
      return (Number(a.sequence == null || a.sequence === '' ? 999999 : a.sequence) - Number(b.sequence == null || b.sequence === '' ? 999999 : b.sequence)) ||
        a.route.localeCompare(b.route, undefined, { numeric: true }) || a.run.localeCompare(b.run, undefined, { numeric: true });
    });
  }

  function remaining(rows) { return rows.filter(function (r) { return r.state !== 'LOADED'; }).length; }

  // The weekly driver schedule (Sunday to Saturday) for the week holding `date`: one row per driver, a cell per day.
  function weeklySchedule(runs, drivers, date) {
    var week = L.weekStart(date), dates = L.DAYS.map(function (x, i) { return L.addDays(week, i); }), by = {};
    (runs || []).forEach(function (run) {
      if (!L.weeklyRows([run], week).length) return;
      L.DAYS.forEach(function (p, i) {
        var day = run.days && run.days[p], name = day && text(day.driver);
        if (!day || !day.runs || !name || /^(UNASSIGNED|OPEN)$/i.test(name)) return;
        var key = day.driverId || name.toUpperCase(), row = by[key] = by[key] || { driverId: day.driverId || '', driver: name, cells: L.DAYS.map(function () { return []; }) };
        row.cells[i].push(text(run.streamId) || routeNumber(run.route) + (text(run.run) ? ' · ' + text(run.run) : ''));
      });
    });
    var info = {};
    (drivers || []).forEach(function (d) { info[d.id] = d; });
    var list = Object.keys(by).map(function (k) { return by[k]; });
    list.forEach(function (r) {
      var d = info[r.driverId] || {};
      r.relief = !!d.reliefDriver; r.seniority = L.dateKey(d.hireDate) || L.dateKey(d.seniorityDate) || ''; r.position = Number(d.positionOrder) || 9999;
    });
    list.sort(function (a, b) {
      return (Number(b.relief) - Number(a.relief)) || (a.seniority || '9999').localeCompare(b.seniority || '9999') || a.position - b.position || a.driver.localeCompare(b.driver);
    });
    return { weekStart: week, dates: dates, rows: list };
  }

  return { calendarDay: calendarDay, boardState: boardState, STATE_TEXT: STATE_TEXT, boardRows: boardRows, remaining: remaining, weeklySchedule: weeklySchedule,
    routeNumber: routeNumber, trailerText: trailerText, pickupOpen: pickupOpen, pickupLine: pickupLine };
});
