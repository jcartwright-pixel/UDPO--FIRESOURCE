/*
 * United Dairy Distribution app: shared dispatch rules.
 *
 * One copy of the rules the server and the screens both use: dates, the 6:00 AM operating-day roll, which Live
 * day block a load date reads, the Daily and Weekly row lists and their order. It mirrors the current Apps Script
 * app (032_V740_LiveWeekAdapter.gs, 006_V7000_DispatchSchemaAdapter.gs) so both apps show the same loads.
 *
 * Plain JavaScript with no imports, so it runs in Node (require) and in the browser (window.UDLogic).
 * The browser copy, public/js/logic.js, is written by `npm run sync-logic`; a test fails if the two differ.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UDLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Live week tabs run Sunday to Saturday, with these column prefixes.
  var DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var TIME_ZONE = 'America/New_York';
  var DAY_ROLL_HOUR = 6;

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function isDateKey(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')); }

  // Sheets give dates as 2026-10-05, 10/5/2026, 2026-10-05T08:58:37-04:00 or a serial day number. Returns
  // yyyy-mm-dd, or '' when the cell is blank or not a date.
  function dateKey(value) {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) {
      return isNaN(value.getTime()) ? '' : value.getUTCFullYear() + '-' + pad(value.getUTCMonth() + 1) + '-' + pad(value.getUTCDate());
    }
    if (typeof value === 'number') {
      if (!isFinite(value) || value < 20000 || value > 80000) return '';
      return dateKey(new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000));
    }
    var text = String(value).trim();
    var m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/);
    if (m) return validKey(+m[1], +m[2], +m[3]);
    m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:$|\s)/);
    if (m) return validKey(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
    return '';
  }

  function validKey(y, mo, d) {
    var probe = new Date(Date.UTC(y, mo - 1, d));
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return '';
    return y + '-' + pad(mo) + '-' + pad(d);
  }

  function keyToUtcNoon(key) { var p = key.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12)); }

  function addDays(key, days) {
    var d = keyToUtcNoon(key);
    d.setUTCDate(d.getUTCDate() + days);
    return dateKey(d);
  }

  function dayIndex(key) { return keyToUtcNoon(key).getUTCDay(); }
  function dayPrefix(key) { return DAYS[dayIndex(key)]; }
  function dayName(key) { return DAY_NAMES[dayIndex(key)]; }
  function weekStart(key) { return addDays(key, -dayIndex(key)); }
  function daysBetween(fromKey, toKey) { return Math.round((keyToUtcNoon(toKey) - keyToUtcNoon(fromKey)) / 86400000); }

  // The plant's operating day rolls at 6:00 AM New York time: at 5:59 AM it is still yesterday.
  function operatingDay(now) {
    var parts = {};
    new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(now || new Date()).forEach(function (p) { parts[p.type] = p.value; });
    var key = parts.year + '-' + parts.month + '-' + parts.day;
    return Number(parts.hour) >= DAY_ROLL_HOUR ? key : addDays(key, -1);
  }

  // Same rule as udpoV7000ScheduledValue_: blank, FALSE, NO, N, 0, OFF and DOES NOT RUN mean "no".
  function yes(value) {
    if (value === false || value === 0 || value === null || value === undefined) return false;
    var text = String(value).trim().toUpperCase();
    return !!text && ['FALSE', 'NO', 'N', '0', 'OFF', 'DOES NOT RUN'].indexOf(text) < 0;
  }

  // A cell that is either blank (no setting) or a yes/no. Blank stays null so "not set" is not read as "no".
  function optionalYes(value) {
    return value === null || value === undefined || String(value).trim() === '' ? null : yes(value);
  }

  function number(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    var n = Number(String(value).replace(/,/g, '').trim());
    return isFinite(n) ? n : null;
  }

  // Times come as 4:00:00 AM, 16:30, or a fraction of a day. Returns minutes after midnight, or null.
  function minutesOfDay(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return value > 0 && value < 1 ? Math.round(value * 1440) % 1440 : null;
    var m = String(value).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/);
    if (!m) return null;
    var h = +m[1], min = +m[2], ampm = (m[4] || '').toUpperCase();
    if (min > 59 || h > 23 || (ampm && (h < 1 || h > 12))) return null;
    if (ampm === 'PM' && h < 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return h * 60 + min;
  }

  function timeText(minutes) {
    if (minutes === null || minutes === undefined) return '';
    var h = Math.floor(minutes / 60), m = minutes % 60, ampm = h >= 12 ? 'PM' : 'AM';
    return ((h % 12) || 12) + ':' + pad(m) + ' ' + ampm;
  }

  function routeIsShown(run, flag) {
    var status = String(run.routeStatus || 'ACTIVE').trim().toUpperCase();
    if (status && status !== 'ACTIVE') return false;
    if (run.active === false) return false;
    if (run[flag] === false) return false;
    return true;
  }

  // Which day blocks of a Live row load on loadDate. Day blocks are DELIVERY days; a load goes out
  // loadDayOffset days before (offset -1 = loaded the day before delivery). A blank offset is -1, as today.
  function loadBlocksFor(run, loadDate) {
    var out = [];
    DAYS.forEach(function (prefix) {
      var day = run.days && run.days[prefix];
      if (!day || !day.runs) return;
      var offset = day.loadDayOffset === null || day.loadDayOffset === undefined ? -1 : day.loadDayOffset;
      var deliveryDate = addDays(loadDate, -offset);
      if (dayPrefix(deliveryDate) !== prefix) return;
      // The delivery day must be inside the Live week this row belongs to.
      if (weekStart(deliveryDate) !== run.weekStart) return;
      out.push({ prefix: prefix, deliveryDate: deliveryDate, loadDayOffset: offset });
    });
    return out;
  }

  function effectiveSequence(day) {
    return day.loadSequenceOverride !== null && day.loadSequenceOverride !== undefined ? day.loadSequenceOverride : day.loadSequence;
  }

  function compareRoute(a, b) {
    return String(a.route || '').localeCompare(String(b.route || ''), undefined, { numeric: true, sensitivity: 'base' }) ||
      String(a.run || '').localeCompare(String(b.run || ''));
  }

  // The Daily Dispatch list for one load date, in load order. runs = run documents of every Live week.
  function dailyRows(runs, loadDate) {
    var rows = [];
    (runs || []).forEach(function (run) {
      if (!routeIsShown(run, 'displayDaily')) return;
      loadBlocksFor(run, loadDate).forEach(function (block) {
        var day = run.days[block.prefix];
        rows.push({
          id: run.id + '|' + block.prefix,
          runDocId: run.id,
          day: block.prefix,
          weekStart: run.weekStart,
          routeId: run.routeId, route: run.route, routeName: run.routeName, runId: run.runId, run: run.run,
          loadType: run.loadType, movementType: run.movementType, coverageType: run.coverageType,
          loadDate: loadDate, deliveryDate: block.deliveryDate, deliveryDay: DAY_NAMES[DAYS.indexOf(block.prefix)],
          loadDayOffset: block.loadDayOffset,
          loadSequence: effectiveSequence(day),
          dispatchTime: day.dispatchTime, startTime: day.startTime, routeHours: day.routeHours, miles: day.miles,
          driverId: day.driverId, driver: day.driver,
          truckId: day.truckId, truck: day.truck, trailerId: day.trailerId, trailer: day.trailer,
          forkliftId: day.forkliftId, palletJack: day.palletJack,
          casesOut: day.casesOut, pickup: day.pickup, driverNotes: day.driverNotes,
          plantStatus: day.completeTime ? 'COMPLETE' : day.plantStartedAt ? 'LOADING' : (day.loadStatus || day.status || ''),
          loadedComplete: day.loadedComplete, loadTemperature: day.loadTemperature,
          rev: run.rev || 0
        });
      });
    });
    rows.sort(function (a, b) {
      var x = a.loadSequence === null || a.loadSequence === undefined ? 999999 : a.loadSequence;
      var y = b.loadSequence === null || b.loadSequence === undefined ? 999999 : b.loadSequence;
      // Like the current Daily Dispatch: one block per delivery day (a Saturday loadout shows Sunday, then Monday), load order inside it.
      return String(a.deliveryDate || '').localeCompare(String(b.deliveryDate || '')) || x - y || compareRoute(a, b);
    });
    return rows;
  }

  // Live weeks a load date can read: its own week, plus the next one for loads that deliver next week.
  function weeksForLoadDate(loadDate) {
    var own = weekStart(loadDate), last = weekStart(addDays(loadDate, 6));
    return own === last ? [own] : [own, last];
  }

  // The Weekly Dispatch grid for one week: one line per run, seven day cells.
  function weeklyRows(runs, week) {
    return (runs || []).filter(function (run) {
      return run.weekStart === week && routeIsShown(run, 'displayWeekly');
    }).map(function (run) {
      var days = {};
      DAYS.forEach(function (prefix, i) {
        var d = (run.days && run.days[prefix]) || {};
        days[prefix] = {
          date: addDays(week, i), runs: !!d.runs, loadSequence: effectiveSequence(d),
          driverId: d.driverId || '', driver: d.driver || '', truckId: d.truckId || '', truck: d.truck || '',
          trailerId: d.trailerId || '', trailer: d.trailer || '', dispatchTime: d.dispatchTime,
          intendedDriver: d.intendedDriver || '', driverExceptionStatus: d.driverExceptionStatus || ''
        };
      });
      return { runDocId: run.id, routeId: run.routeId, route: run.route, routeName: run.routeName, runId: run.runId, run: run.run, streamId: run.streamId || (run.cells && run.cells.stream_id) || '', coverageType: run.coverageType, weekOrder: run.weekOrder, days: days, rev: run.rev || 0 };
    }).sort(function (a, b) {
      var x = a.weekOrder === null || a.weekOrder === undefined ? 999999 : a.weekOrder;
      var y = b.weekOrder === null || b.weekOrder === undefined ? 999999 : b.weekOrder;
      return x - y || compareRoute(a, b);
    });
  }

  // Who may save (USERS_MASTER roles). Changing the load order needs a manager, the same rule as the current app
  // (udpoV754CanAdjustLoadSequence_). The screens use these to show the edit controls; the server enforces them.
  var SAVE_ROLES = ['ADMINISTRATOR', 'ADMIN', 'MANAGER', 'SUPERVISOR', 'DISPATCHER'];
  var REORDER_ROLES = ['ADMINISTRATOR', 'ADMIN', 'MANAGER'];
  function hasRole(person, roles) {
    return !!(person && person.status === 'ACTIVE' && (person.roles || []).some(function (r) { return roles.indexOf(r) >= 0; }));
  }

  // Editing the driver list is a manager's job, as on the current Employee Information screen.
  var DRIVER_ROLES = REORDER_ROLES;

  // The per-screen switch (switch.js): which app runs each screen. "old" = the current app (the new app shows a copy),
  // "new" = the new app saves and the write-back puts each save in the sheet. While every screen is "old" the new
  // app is a test copy and every screen may save; once one is "new", only "new" screens save in the new app.
  var SCREENS = { dailyDispatch: 'Daily Dispatch', weeklyDispatch: 'Weekly Dispatch', checkIns: 'Driver Check-ins',
    drivers: 'Drivers', vacations: 'Vacation Schedule', routes: 'Route Editor' };
  function screenOwners(config) {
    var out = {}, set = (config && config.screenOwners) || {};
    Object.keys(SCREENS).forEach(function (k) { out[k] = 'old'; });
    Object.keys(set).forEach(function (k) { out[k] = set[k]; });
    return out;
  }
  // {owner, open, live, why}: open = this screen may save in the new app; why = the reason when it may not.
  function screenState(config, screen) {
    var owners = screenOwners(config), owner = owners[screen] || 'old', name = SCREENS[screen] || screen;
    var writeBack = !!(config && config.writeBack && config.writeBack.enabled === true);
    var anyNew = Object.keys(owners).some(function (k) { return owners[k] === 'new'; });
    if (owner === 'new') return { owner: owner, live: true, open: writeBack, why: writeBack ? '' : name + ' belongs to the new app but the write-back is off; ask an administrator' };
    if (config && config.mode === 'live' && !anyNew) return { owner: owner, live: false, open: false, why: 'The app is marked live but no screen belongs to the new app; saves stay in test mode only' };
    if (anyNew) return { owner: owner, live: true, open: false, why: name + ' is still run from the current app; save it there' };
    return { owner: owner, live: false, open: true, why: '' };
  }

  // Same rule as desktopVacationWeeksV0310_: completed years since hire -> 0, 1, 2, 3, 4 or 5 weeks.
  function vacationWeeks(hireDate, asOf) {
    var h = dateKey(hireDate), a = dateKey(asOf);
    if (!h || !a) return 0;
    var hp = h.split('-').map(Number), ap = a.split('-').map(Number);
    var years = ap[0] - hp[0];
    if (ap[1] < hp[1] || (ap[1] === hp[1] && ap[2] < hp[2])) years--;
    if (years < 1) return 0;
    if (years < 2) return 1;
    if (years < 10) return 2;
    if (years < 16) return 3;
    if (years < 20) return 4;
    return 5;
  }

  // The driver list in seniority order (oldest seniority date first; drivers with no date last), numbered.
  function driverRosterRows(drivers, asOf) {
    var rows = (drivers || []).map(function (d) {
      var seniority = dateKey(d.seniorityDate) || dateKey(d.hireDate);
      return {
        id: d.id, name: d.name || '', status: d.status || '', reliefDriver: !!d.reliefDriver, seniorityDate: seniority,
        hireDate: dateKey(d.hireDate), vacationWeeks: vacationWeeks(d.hireDate, asOf), defaultTruckId: d.defaultTruckId || '',
        unavailableReason: d.unavailableReason || '', active: String(d.status || '').toUpperCase() === 'ACTIVE'
      };
    });
    rows.sort(function (a, b) {
      return (a.seniorityDate || '9999') .localeCompare(b.seniorityDate || '9999') || a.name.localeCompare(b.name);
    });
    rows.forEach(function (r, i) { r.position = i + 1; });
    return rows;
  }

  // A route needs a driver when it has neither a driver nor an outside carrier covering it.
  function needsDriver(row) {
    var coverage = String(row.coverageType || '').trim().toUpperCase();
    return !row.driver && (!coverage || coverage === 'UNITED DAIRY');
  }

  // Driver check-ins for one DELIVERY date: every run delivering that day, in route order, with what the driver
  // reported (the same Live columns the current phone check-in writes).
  function checkinRows(runs, deliveryDate) {
    var prefix = dayPrefix(deliveryDate), week = weekStart(deliveryDate), rows = [];
    (runs || []).forEach(function (run) {
      if (run.weekStart !== week || !routeIsShown(run, 'displayDaily')) return;
      var d = run.days && run.days[prefix];
      if (!d || !d.runs) return;
      var issues = [];
      if (d.tractorIssues) issues.push('Truck: ' + d.tractorIssues);
      if (d.trailerIssues) issues.push('Trailer: ' + d.trailerIssues);
      if (d.palletJackIssues) issues.push('Jack: ' + d.palletJackIssues);
      if (yes(d.trailerNeedsCleaned)) issues.push('Trailer needs cleaned');
      if (d.overageShortageDetails || yes(d.overageShortage)) issues.push('Over/short: ' + (d.overageShortageDetails || 'yes'));
      rows.push({
        id: run.id + '|' + prefix, runDocId: run.id, day: prefix, route: run.route, run: run.run, coverageType: run.coverageType,
        driver: d.driver || '', truck: d.truck || '', trailer: d.trailer || '', casesOut: d.casesOut,
        casesDelivered: d.casesDelivered, driverCaseReturn: d.driverCaseReturn,
        refusedReturned: d.refusedReturned || '', refusedReturnedSource: d.refusedReturnedSource || '',
        checkinNotes: d.checkinNotes || '', checkinCompletedAt: d.checkinCompletedAt || '',
        checkedIn: !!(d.checkinCompletedAt || (d.casesDelivered !== null && d.casesDelivered !== undefined)),
        issues: issues, rev: run.rev || 0
      });
    });
    return rows.sort(compareRoute);
  }

  // The numbers on the Route Distribution home cards. today = the operating day.
  function homeNumbers(runs, drivers, equipment, today) {
    var daily = dailyRows(runs, today);
    var covered = daily.filter(function (r) { return !needsDriver(r); }).length;
    var week = weeklyRows(runs, weekStart(today));
    var checkins = checkinRows(runs, today);
    var active = (drivers || []).filter(function (d) { return String(d.status).toUpperCase() === 'ACTIVE'; });
    var units = (equipment || []).filter(function (e) { return e.status !== 'INACTIVE'; });
    return {
      daily: { loads: daily.length, needsDriver: daily.length - covered, covered: daily.length ? Math.round(covered * 100 / daily.length) : 100 },
      weekly: { runs: week.length, open: week.reduce(function (n, r) { return n + DAYS.filter(function (p) { return r.days[p].runs && !r.days[p].driver; }).length; }, 0) },
      drivers: { active: active.length, relief: active.filter(function (d) { return d.reliefDriver; }).length, inactive: (drivers || []).length - active.length },
      checkins: { deliveries: checkins.length, checkedIn: checkins.filter(function (r) { return r.checkedIn; }).length, issues: checkins.filter(function (r) { return r.issues.length; }).length },
      fleet: { trucks: units.filter(function (e) { return e.type === 'TRUCK'; }).length, trailers: units.filter(function (e) { return e.type === 'TRAILER'; }).length, inactive: (equipment || []).length - units.length }
    };
  }

  // Truck and trailer choices skip these, as the current app does (unless OVR is ticked).
  var UNIT_OFF_STATUSES = ['DOWN', 'INACTIVE', 'OUT', 'OUT OF SERVICE', 'OOS', 'REPAIR', 'DISABLED', 'UNAVAILABLE'];
  function unitOff(unit) { return UNIT_OFF_STATUSES.indexOf(String(unit && unit.status || '').trim().toUpperCase()) >= 0; }

  // Runs that do not run on a load date's delivery day, for + Add Route / Run (blank load-day offset = -1).
  function notRunningRows(runs, loadDate) {
    var rows = [];
    (runs || []).forEach(function (run) {
      if (!routeIsShown(run, 'displayDaily')) return;
      DAYS.forEach(function (prefix) {
        var day = run.days && run.days[prefix];
        if (!day || day.runs) return;
        var offset = day.loadDayOffset === null || day.loadDayOffset === undefined ? -1 : day.loadDayOffset;
        var deliveryDate = addDays(loadDate, -offset);
        if (dayPrefix(deliveryDate) !== prefix || weekStart(deliveryDate) !== run.weekStart) return;
        rows.push({ id: run.id + '|' + prefix, runDocId: run.id, day: prefix, route: run.route, run: run.run, deliveryDate: deliveryDate, rev: run.rev || 0 });
      });
    });
    return rows.sort(compareRoute);
  }

  /* ---------- days off ---------- */

  // Same as udpoV7271VacationType_: PD/PERSONAL, SICK, BEREAVEMENT, UNPAID by name; anything else is VACATION.
  function vacationType(value) {
    var s = String(value || '').trim();
    return /^(PD|PERSONAL)/i.test(s) ? 'PERSONAL' : /^SICK/i.test(s) ? 'SICK' : /^BEREAV/i.test(s) ? 'BEREAVEMENT' : /^UNPAID/i.test(s) ? 'UNPAID' : 'VACATION';
  }
  var VACATION_TYPE_NAMES = { VACATION: 'Vacation Day', PERSONAL: 'Personal Day', SICK: 'Sick Day', BEREAVEMENT: 'Bereavement Day', UNPAID: 'Unpaid Day' };

  // Same as udpoV7271VacationHolidayWeeks_: the Sunday-Saturday week of New Year's Day, Memorial Day, the 4th of July,
  // Labor Day, Thanksgiving and Christmas allow 2 off; Deer Season (two weeks from the Sunday after Thanksgiving) allows 3.
  function holidayWeeks(year) {
    function key(y, m, d) { return new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10); }
    function week(y, m, d) { var dow = new Date(Date.UTC(y, m, d)).getUTCDay(); return [key(y, m, d - dow), key(y, m, d - dow + 6)]; }
    function nth(m, wd, n) { var first = new Date(Date.UTC(year, m, 1)).getUTCDay(); return 1 + ((wd - first + 7) % 7) + (n - 1) * 7; }
    var memorial = 31 - ((new Date(Date.UTC(year, 4, 31)).getUTCDay() + 6) % 7), thanks = nth(10, 4, 4);
    return [[week(year, 0, 1), "New Year's", 2], [week(year, 4, memorial), 'Memorial Day', 2], [week(year, 6, 4), '4th of July', 2],
      [week(year, 8, nth(8, 1, 1)), 'Labor Day', 2], [week(year, 10, thanks), 'Thanksgiving', 2],
      [[key(year, 10, thanks + 3), key(year, 10, thanks + 16)], 'Deer Season', 3], [week(year, 11, 25), 'Christmas', 2], [week(year + 1, 0, 1), "New Year's", 2]]
      .map(function (h) { return { start: h[0][0], end: h[0][1], label: h[1], maxOff: h[2] }; });
  }
  // How many may be off on a day, and why.
  function dayLimit(day) {
    var y = Number(day.slice(0, 4)), best = { maxOff: 3, label: '' };
    [y - 1, y].forEach(function (yr) {
      holidayWeeks(yr).forEach(function (w) { if (day >= w.start && day <= w.end && w.maxOff < best.maxOff) best = { maxOff: w.maxOff, label: w.label }; });
    });
    return best;
  }

  // An exception that takes a driver off a day: in its dates and not cancelled, denied or cleared.
  function exceptionOn(exceptions, driverId, day) {
    var hit = null;
    (exceptions || []).forEach(function (e) {
      if (e.driverId !== driverId || !e.startDate || day < e.startDate || day > (e.endDate || e.startDate)) return;
      if (['CANCELLED', 'DENIED', 'AVAILABLE', 'CLEARED'].indexOf(String(e.status || '').toUpperCase()) >= 0) return;
      hit = e;
    });
    return hit;
  }
  function exceptionLabel(e) {
    if (!e) return '';
    var t = String(e.type || '').toUpperCase();
    return t === 'UNAVAILABLE' ? (e.reasonCode || 'UNAVAILABLE') : t || e.reasonCode || 'OFF';
  }

  // Approved vacation entries that cover a day (one per driver).
  function vacationsOn(vacations, day) {
    var seen = {};
    return (vacations || []).filter(function (v) {
      if (v.status !== 'APPROVED' || !v.startDate || day < v.startDate || day > (v.endDate || v.startDate) || seen[v.driverId]) return false;
      seen[v.driverId] = true;
      return true;
    });
  }


  /* ---------- Weekly Dispatch colours and the Driver Assignment Board ---------- */

  // Same as the current Weekly: a route covered by an owner or outside carrier is locked (BRANCH routes are not).
  function coveredRoute(row) {
    var t = String((row && row.coverageType) || 'UNITED DAIRY').trim().toUpperCase();
    return t !== '' && t !== 'UNITED DAIRY' && t !== 'BRANCH';
  }

  // The legend colour of one Weekly cell: off, coverage, vacation-needs, conflict, needs, carrier, open, booked, relief, assigned.
  function weeklyCellClass(row, prefix, ctx) {
    var d = row.days[prefix], who = String(d.driver || '').trim().toUpperCase();
    // A plant load on the Plant Operations Scheduler for a day the run does not run: it needs a driver (current Weekly).
    if (!d.runs) return plantFor(ctx, row, prefix) && !coveredRoute(row) ? 'plant' : 'off';
    if (coveredRoute(row)) return 'coverage';
    if (!who) return /VACATION/i.test(d.driverExceptionStatus) ? 'vacation-needs' : 'needs';
    if (who === 'CARRIER') return 'carrier';
    if (who === 'OPEN') return 'open';
    if (d.driverId && exceptionOn(ctx.exceptions, d.driverId, d.date)) return 'conflict';
    if ((ctx.dup[prefix + '|' + (d.driverId || who)] || 0) > 1) return 'booked';
    return ctx.relief[d.driverId] ? 'relief' : 'assigned';
  }

  // The Plant Route loads for one run on one day (plant scheduler copy), or null.
  function plantFor(ctx, row, prefix) {
    var list = ctx && ctx.plant ? ctx.plant[row.runId + '|' + row.days[prefix].date] : null;
    return list && list.length ? list : null;
  }
  function plantTitle(list) {
    return 'Plant scheduler: ' + list.map(function (e) {
      return [e.pickupTime ? 'pickup ' + e.pickupTime : '', e.loadDate ? 'load ' + e.loadDate : '', e.trailer || '', e.poNumber ? 'PO ' + e.poNumber : ''].filter(Boolean).join(', ');
    }).join(' / ');
  }

  function weeklyContext(rows, drivers, exceptions, plantLoads) {
    var dup = {}, relief = {};
    (drivers || []).forEach(function (d) { if (d.reliefDriver) relief[d.id] = true; });
    (rows || []).forEach(function (r) {
      if (coveredRoute(r)) return;
      DAYS.forEach(function (p) {
        var d = r.days[p], who = String(d.driver || '').trim().toUpperCase();
        if (!d.runs || !who || who === 'CARRIER' || who === 'OPEN') return;
        var k = p + '|' + (d.driverId || who);
        dup[k] = (dup[k] || 0) + 1;
      });
    });
    var plant = {};
    (plantLoads || []).forEach(function (e) { if (e.runId && e.date) (plant[e.runId + '|' + e.date] = plant[e.runId + '|' + e.date] || []).push(e); });
    return { dup: dup, relief: relief, exceptions: exceptions || [], plant: plant };
  }

  // One line per active driver (relief drivers first, then seniority): each day shows the routes they have, else why
  // they are off, else AVAILABLE. kind = assigned, booked (two or more), vacation, unavailable, available.
  function boardLabel(r) {
    var stream = String(r.streamId || '').trim(), route = String(r.route || '').trim(), run = String(r.run || '').trim();
    return stream || (!run || run.toUpperCase() === route.toUpperCase() ? route : route + ' ' + run);
  }
  function driverBoardRows(drivers, rows, exceptions, week) {
    var list = (drivers || []).filter(function (d) { return String(d.status || '').toUpperCase() === 'ACTIVE'; }).map(function (d) {
      return { id: d.id, name: d.name || '', relief: !!d.reliefDriver, cells: d.cells && Object.keys(d.cells).length ? d.cells : null, seniorityDate: dateKey(d.seniorityDate) || dateKey(d.hireDate) || '9999-12-31', days: {} };
    });
    list.sort(function (a, b) { return (a.relief === b.relief ? 0 : a.relief ? -1 : 1) || a.seniorityDate.localeCompare(b.seniorityDate) || a.name.localeCompare(b.name); });
    list.forEach(function (driver) {
      DAYS.forEach(function (p, i) {
        var date = addDays(week, i), routes = [];
        // Like the current board: the run's stream (SAVE-A-LOT 1, 825), else the route, plus the run when it differs.
        (rows || []).forEach(function (r) { var d = r.days[p]; if (d.runs && d.driverId === driver.id) routes.push(boardLabel(r)); });
        var off = exceptionOn(exceptions, driver.id, date);
        // OFF: Driver Master does not have the driver available that day (<day>_available), as on the current board.
        var dayOff = !!driver.cells && !yes(driver.cells[p + '_available']);
        var kind = routes.length > 1 ? 'booked' : routes.length ? (off ? 'conflict' : 'assigned') : off ? (/VACATION/i.test(off.type + off.reasonCode) ? 'vacation' : 'unavailable') : dayOff ? 'off' : 'available';
        driver.days[p] = { date: date, routes: routes, kind: kind, text: routes.length ? routes.join(' / ') : off ? exceptionLabel(off) : dayOff ? 'OFF' : 'AVAILABLE' };
      });
    });
    return list;
  }

  /*
   * Reset Week (udpoV780ResetWeeklyDispatch_): the plan for one copied run from Route Master and Driver Master.
   * A day runs when Route Master has it active; its driver is the one whose Driver Master <day>_assignments_json lists
   * the run, unless that driver is off that day (then the day needs a driver and shows who it was for). Inactive
   * drivers are skipped. Returns null for a run Route Master no longer has active (it stays as it is, as today).
   */
  var ROUTE_OFF = ['INACTIVE', 'TERMINATED', 'DISABLED'];
  function standardDrivers(drivers) {
    var slot = {};
    (drivers || []).forEach(function (d) {
      if (!d || !d.id || !d.name || ROUTE_OFF.indexOf(String(d.status || 'ACTIVE').toUpperCase()) >= 0 || ROUTE_OFF.indexOf(String(d.employmentStatus || 'ACTIVE').toUpperCase()) >= 0) return;
      DAYS.forEach(function (p) {
        var raw = d.cells && d.cells[p + '_assignments_json'], list = [];
        if (!raw) return;
        try { list = JSON.parse(raw); } catch (e) { return; }
        (Array.isArray(list) ? list : [list]).forEach(function (a) {
          var id = typeof a === 'string' ? a : a && (a.runId || a.run_id);
          if (id) slot[String(id).trim() + '|' + p] = d;
        });
      });
    });
    return slot;
  }
  function resetWeekPlan(run, route, slots, exceptions) {
    if (!route || ROUTE_OFF.indexOf(String(route.routeStatus || 'ACTIVE').toUpperCase()) >= 0 || route.active === false) return null;
    var plan = {};
    DAYS.forEach(function (p, i) {
      var rd = route.days && route.days[p] || {}, runs = !!rd.active, d = runs ? slots[run.runId + '|' + p] : null;
      var off = d ? exceptionOn(exceptions, d.id, addDays(run.weekStart, i)) : null;
      plan[p] = { runs: runs, driverId: d && !off ? d.id : '', driver: d && !off ? d.name : '',
        intendedDriverId: off ? d.id : '', intendedDriver: off ? d.name : '', driverExceptionStatus: off ? (off.reasonCode || exceptionLabel(off)) : '' };
    });
    return plan;
  }

  return {
    plantFor: plantFor, plantTitle: plantTitle, standardDrivers: standardDrivers, resetWeekPlan: resetWeekPlan,
    coveredRoute: coveredRoute, weeklyCellClass: weeklyCellClass, weeklyContext: weeklyContext, driverBoardRows: driverBoardRows,
    UNIT_OFF_STATUSES: UNIT_OFF_STATUSES, unitOff: unitOff, notRunningRows: notRunningRows,
    vacationType: vacationType, VACATION_TYPE_NAMES: VACATION_TYPE_NAMES, holidayWeeks: holidayWeeks, dayLimit: dayLimit,
    exceptionOn: exceptionOn, exceptionLabel: exceptionLabel, vacationsOn: vacationsOn,
    SCREENS: SCREENS, screenOwners: screenOwners, screenState: screenState,
    SAVE_ROLES: SAVE_ROLES, REORDER_ROLES: REORDER_ROLES, DRIVER_ROLES: DRIVER_ROLES, hasRole: hasRole,
    vacationWeeks: vacationWeeks, driverRosterRows: driverRosterRows, needsDriver: needsDriver, checkinRows: checkinRows, homeNumbers: homeNumbers,
    DAYS: DAYS, DAY_NAMES: DAY_NAMES, TIME_ZONE: TIME_ZONE, DAY_ROLL_HOUR: DAY_ROLL_HOUR,
    isDateKey: isDateKey, dateKey: dateKey, addDays: addDays, dayPrefix: dayPrefix, dayName: dayName,
    weekStart: weekStart, daysBetween: daysBetween, operatingDay: operatingDay,
    yes: yes, optionalYes: optionalYes, number: number, minutesOfDay: minutesOfDay, timeText: timeText,
    loadBlocksFor: loadBlocksFor, effectiveSequence: effectiveSequence, dailyRows: dailyRows,
    weeksForLoadDate: weeksForLoadDate, weeklyRows: weeklyRows
  };
});
