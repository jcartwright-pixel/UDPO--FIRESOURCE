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

  // The New York calendar day of a saved time ("2026-10-11T01:30:00Z" is 10/10 at 9:30 PM), or a plain yyyy-mm-dd as it is.
  // Screens count "this week" and "this month" by this day, not by the UTC date the time is stored in.
  function localDay(value) {
    var s = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var t = Date.parse(s);
    if (!s || !isFinite(t)) return '';
    var parts = {};
    new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(t)).forEach(function (p) { parts[p.type] = p.value; });
    return parts.year + '-' + parts.month + '-' + parts.day;
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

  // Daily Dispatch and the drivers' phone, as the current app reads a Live row (udpoV780VisibleBase_): the run must be ACTIVE, the
  // Live row's flag decides, a blank flag takes Route Master's, and blank in both is hidden. A run copied before Route Master's
  // flags were kept on it (no masterShow) keeps the old reading: only a FALSE hides it.
  function liveFlagShown(run, field, masterField) {
    if (!routeIsShown(run, field)) return false;
    if (run[field] === true) return true;
    if (!run.masterShow) return true;
    return run.masterShow[masterField] === true;
  }

  function routeIsShown(run, flag) {
    var status = String(run.routeStatus || 'ACTIVE').trim().toUpperCase();
    if (status && status !== 'ACTIVE') return false;
    if (run.active === false) return false;
    if (run[flag] === false) return false;
    return true;
  }

  // Route Master's own yes / no rules, exactly as the current app's Route Editor reads a row (desktopRouteConfigParseCanonicalRowV5054_):
  // a run is active only when route_status is ACTIVE (a blank status is ACTIVE) AND its active cell says yes; a blank active cell
  // is NOT active (Rhino 834). Each show flag is yes only when its cell says yes; a blank show cell is NO. A field the record does
  // not carry at all (an older copy without that column) stays yes, as the current app does when the column is missing.
  function masterActive(r) {
    if (!r) return false;
    var status = String(r.routeStatus || 'ACTIVE').trim().toUpperCase();
    if (status !== 'ACTIVE') return false;
    return r.active === undefined ? true : r.active === true;
  }
  function masterFlag(r, field) {
    if (!r) return false;
    if (r[field] === undefined) return field === 'displayDaily' ? String(r.movementType || '').toUpperCase() !== 'CUSTOMER_PICKUP' : true;
    return r[field] === true;
  }

  // A driver is active unless Driver Master says INACTIVE, TERMINATED or DISABLED (udpoV7000DriverIsActive_; a blank status is active).
  function driverActive(d) {
    if (!d) return false;
    if (['INACTIVE', 'TERMINATED', 'DISABLED'].indexOf(String(d.status || '').trim().toUpperCase()) >= 0) return false;
    return d.active === undefined || d.active === null || d.active === '' ? true : d.active === true;
  }
  // A truck, trailer or pallet jack can be put on a run only when its status is AVAILABLE, ACTIVE, IN SERVICE or READY and,
  // for trucks and trailers, it is still on the United Dairy fleet list import (source_present), as udpoV7000EquipmentIsActive_.
  var UNIT_ON_STATUSES = ['AVAILABLE', 'ACTIVE', 'IN SERVICE', 'READY'];
  function unitUsable(unit) {
    if (!unit) return false;
    if (UNIT_ON_STATUSES.indexOf(String(unit.status || '').trim().toUpperCase()) < 0) return false;
    var type = String(unit.type || '').toUpperCase();
    if ((type === 'TRUCK' || type === 'TRACTOR' || type === 'TRAILER') && unit.sourcePresent === false) return false;
    return true;
  }

  // Equipment Issues (the current app's Maintenance screen, udpoV740MaintenanceRowsFromTable_): the write-ups on TRUCK LIVE,
  // TRAILER LIVE and FORK TRUCK LIVE. Removed rows and text that says nothing is wrong are left out; Occurrences counts the reports
  // on that unit in the 90 days up to and including this one (repaired ones too); the open list leaves out repaired rows.
  var ISSUE_DONE = /^(COMPLETE|COMPLETED|CLOSED|RESOLVED|REPAIRED)$/i;
  function issueUnitKey(unit) { return String(unit || '').trim().toUpperCase().replace(/^T\s*-?\s*(?=\d)/, '').replace(/^0+(?=\d)/, ''); }
  function issueRows(records, kind, nowMs) {
    var DAY = 86400000;
    var written = (records || []).filter(function (r) { return r && String(r.kind || '').toUpperCase() === kind; }).map(function (r) {
      var notes = String(r.notes || ''), status = String(r.status || 'OPEN').trim().toUpperCase();
      var unit = String(r.truck_number || r.trailer_number || r.unit_number || '').trim(), text = String(r.issue_details || '').trim();
      var sent = /Repair email sent (\S+) to ([^\n(]*)/.exec(notes), garageAt = notes.lastIndexOf('Sent to garage');
      var garage = garageAt >= 0 ? /^ (\S+) by ([^\n]*)/.exec(notes.slice(garageAt + 'Sent to garage'.length)) : null;
      var reviewed = /Reviewed by (\S+) at (\S+)/.exec(notes), lessor = /Sent to lessor (.*?) ?(\d{4}-\d\d-\d\dT\S+) by ([^\n]*)/.exec(notes);
      var opened = Date.parse(r.opened_at || r.service_date || ''), done = Date.parse(r.completed_at || '');
      return { id: r.id || r.record_id, recordId: r.record_id, unit: unit, unitKey: issueUnitKey(unit), driver: r.driver || '', route: r.route_id || '',
        reported: String(r.opened_at || r.service_date || ''), openedMs: isFinite(opened) ? opened : 0, completedMs: isFinite(done) ? done : 0,
        text: text, status: status, needsReview: status === 'NEEDS_REVIEW' || !text, reviewed: !!reviewed, reviewedBy: reviewed ? reviewed[1] : '',
        emailed: !!sent, emailedAt: sent ? sent[1] : '', atGarage: !!garage, garageAt: garage ? garage[1] : '', garageBy: garage ? garage[2].trim() : '',
        toLessor: !!lessor, lessor: lessor ? lessor[1].trim() : '', lessorAt: lessor ? lessor[2] : '', lessorBy: lessor ? lessor[3].trim() : '',
        done: ISSUE_DONE.test(status), occurrences: 1,
        // From the answering-service email (Driver Check-In Email): the message id opens the stored email (mailCopies).
        fromEmail: String(r.source_type || '').toUpperCase() === 'GMAIL', emailId: String(r.source_type || '').toUpperCase() === 'GMAIL' ? String(r.source_id || '') : '' };
    }).filter(function (r) { return r.recordId && r.status !== 'REMOVED' && !noWriteUp(r.text); });
    var seen = {};
    written.slice().sort(function (a, b) { return a.openedMs - b.openedMs; }).forEach(function (r) {
      if (!r.unitKey) return;
      var list = seen[r.unitKey] = seen[r.unitKey] || [];
      r.occurrences = list.filter(function (t) { return t && (!r.openedMs || r.openedMs - t <= 90 * DAY); }).length + 1;
      list.push(r.openedMs);
    });
    var open = written.filter(function (r) { return !r.done; }).sort(function (a, b) { return b.openedMs - a.openedMs; });
    var now = nowMs || Date.now();
    open.repairedLast30 = written.filter(function (r) { return r.done && r.completedMs && now - r.completedMs <= 30 * DAY; }).length;
    return open;
  }
  // The hub numbers for one kind's open list.
  function issueNumbers(open, nowMs) {
    var DAY = 86400000, now = nowMs || Date.now(), ages = open.filter(function (r) { return r.openedMs; }).map(function (r) { return (now - r.openedMs) / DAY; });
    return { open: open.length, needReview: open.filter(function (r) { return r.needsReview; }).length,
      repeat: open.filter(function (r) { return r.occurrences > 1; }).length, atGarage: open.filter(function (r) { return r.atGarage; }).length,
      newWeek: open.filter(function (r) { return r.openedMs && now - r.openedMs <= 7 * DAY; }).length,
      oldestDays: ages.length ? Math.floor(Math.max.apply(null, ages)) : 0, averageDays: ages.length ? Math.round(ages.reduce(function (a, b) { return a + b; }, 0) / ages.length) : 0,
      emailed: open.filter(function (r) { return r.emailed; }).length, notEmailed: open.filter(function (r) { return !r.emailed; }).length,
      repaired30: open.repairedLast30 || 0 };
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
      if (!liveFlagShown(run, 'displayDaily', 'daily')) return;
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
          driverId: day.driverId, driver: day.driver, intendedDriverId: day.intendedDriverId || '', intendedDriver: day.intendedDriver || '', driverExceptionStatus: day.driverExceptionStatus || '',
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

  // Which runs Weekly shows, like the current app (udpoV780LiveWeeklyView_): Route Master's display_weekly_dispatch when it is set,
  // else the Live row's. A blank is missing setup, never a yes, so a run with both blank is left off (a flag never read stays shown).
  function weeklyShown(run) {
    if (!routeIsShown(run, 'displayWeekly')) return false;
    if (run.weeklyShowMaster === true || run.weeklyShowMaster === false) return run.weeklyShowMaster;
    return run.displayWeekly !== null;
  }

  // The Weekly Dispatch grid for one week: one line per run, seven day cells.
  function weeklyRows(runs, week) {
    return (runs || []).filter(function (run) {
      return run.weekStart === week && weeklyShown(run);
    }).map(function (run) {
      var days = {};
      DAYS.forEach(function (prefix, i) {
        var d = (run.days && run.days[prefix]) || {};
        days[prefix] = {
          date: addDays(week, i), runs: !!d.runs, loadSequence: effectiveSequence(d),
          driverId: d.driverId || '', driver: d.driver || '', truckId: d.truckId || '', truck: d.truck || '',
          trailerId: d.trailerId || '', trailer: d.trailer || '', dispatchTime: d.dispatchTime,
          intendedDriver: d.intendedDriver || '', driverExceptionStatus: d.driverExceptionStatus || '', routeOverride: yes(d.routeOverride)
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
  // Joe 10/12: People & Roles reads "Plant Employee", "plant-employee" and PLANT_EMPLOYEE as the same role (rights.js);
  // so does every role check here.
  function roleKey(r) { return String(r || '').trim().toUpperCase().replace(/[\s-]+/g, '_'); }
  function hasRole(person, roles) {
    var want = (roles || []).map(roleKey);
    return !!(person && String(person.status || '').trim().toUpperCase() === 'ACTIVE' && (person.roles || []).some(function (r) { return want.indexOf(roleKey(r)) >= 0; }));
  }

  // Joe 10/10: the plants (the current app's facility list) and who sees which. A person's plant list (USERS_MASTER
  // facility_ids_json) decides: ["*"] is every plant, otherwise the plants named. With no list, an Administrator sees
  // every plant and anyone else sees Uniontown. Someone who sees more than one plant lands on the all-plants overview.
  var PLANTS = [
    { id: 'fac_uniontown', name: 'Uniontown', status: 'ACTIVE' },
    { id: 'fac_charleston', name: 'Charleston', status: 'PLANNED' },
    { id: 'fac_martins_ferry', name: 'Martins Ferry', status: 'PLANNED' }
  ];
  var PRIMARY_ADMINS = ['jcartwright@uniteddairy.com'];
  var ADMIN_ROLES = ['ADMINISTRATOR', 'ADMIN'];
  function isAdmin(person) { return hasRole(person, ADMIN_ROLES); }
  function plantsFor(person) {
    if (!person || person.status !== 'ACTIVE') return [];
    var list = (person.facilities || []).map(String);
    if (list.indexOf('*') >= 0 || (!list.length && isAdmin(person))) return PLANTS.map(function (p) { return p.id; });
    var known = PLANTS.map(function (p) { return p.id; }).filter(function (id) { return list.indexOf(id) >= 0; });
    return known.length ? known : ['fac_uniontown'];
  }

  // Editing the driver list is a manager's job, as on the current Employee Information screen.
  var DRIVER_ROLES = REORDER_ROLES;

  // The per-screen switch (switch.js): which app runs each screen. "old" = the current app (the new app shows a copy),
  // "new" = the new app saves and the write-back puts each save in the sheet. While every screen is "old" the new
  // app is a test copy and every screen may save; once one is "new", only "new" screens save in the new app.
  var SCREENS = { dailyDispatch: 'Daily Dispatch', weeklyDispatch: 'Weekly Dispatch', checkIns: 'Driver Check-ins',
    drivers: 'Drivers', vacations: 'Vacation Schedule', routes: 'Route Editor',
    // Joe 10/12: "Let the new app write plant loading to the real Live sheet." The Plant Distribution screens (Loadout Center,
    // Trailer Assignments, Unloading, Truck Washing, Product Returns): a load, its order and its case returns go to the Live week tabs.
    plantLoading: 'Plant Loading' };
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

  // Administration > Go-Live Switches (Joe 10/12): which screens may move to the new app. A screen is ready only when the
  // sheet it writes is built and Joe has OK'd writing it; "Turn on everything that is ready" moves only these. The rest show
  // "Not ready" with the reason, and the server refuses to move them.
  var DISPATCH_OK = 'Writes the Live sheet week tabs. You OK\'d it 10/12.';
  var GO_LIVE = {
    dailyDispatch: { area: 'Route Distribution', ready: true, why: DISPATCH_OK },
    weeklyDispatch: { area: 'Route Distribution', ready: true, why: DISPATCH_OK },
    checkIns: { area: 'Route Distribution', ready: false, why: 'Truck problems it files cannot reach the current app yet.' },
    // Joe 10/12: "Let the new app write Route Master, Driver Master, Equipment Master, Users, Exceptions and Vacations to the real sheets."
    drivers: { area: 'Route Distribution', ready: true, why: 'Writes Driver Master, and days off to the Exceptions sheet. You OK\'d it 10/12.' },
    vacations: { area: 'Route Distribution', ready: true, why: 'Writes the Vacations sheet. You OK\'d it 10/12.' },
    routes: { area: 'Route Distribution', ready: true, why: 'Writes Route Master. You OK\'d it 10/12.' },
    plantLoading: { area: 'Plant Distribution', ready: true, why: 'Writes loads, loading order and case returns to the Live sheet week tabs, and Loadout History when a load is Done. You OK\'d it 10/12.' }
  };
  // Shown on Go-Live Switches but not a switch yet. (Plant Loading became a switch on 10/12.)
  var GO_LIVE_LATER = [];
  // "Fully live": the screen is on the new app for good, so its tag comes off the cards. Moving it back clears it.
  function fullyLive(config, screen) {
    return screenOwners(config)[screen] === 'new' && !!(config && config.fullyLive && config.fullyLive[screen] === true);
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
  /*
   * Fleet Service due list (the current app's udpoV7276DueItems_). units: [{unit, type TRUCK|TRAILER}]; setup: FLEET SERVICE SETUP rows;
   * miles: {unit: {miles, date}} from the daily inspections; openJobs: open work orders [{unit, service_key, work_order_id}].
   * Trucks: PM every truckMiles. Trailers: reefer every trailerMonths or trailerHours. Everyone: DOT yearly, plate expiry.
   */
  var FLEET_RULES = { truckMiles: 15000, truckWarnMiles: 1000, trailerMonths: 4, trailerHours: 1200, trailerWarnDays: 14, dotMonths: 12, dotWarnDays: 30, plateWarnDays: 30 };
  function fleetNumber(v) { var s = String(v == null ? '' : v).replace(/[, ]+/g, '').trim(); if (s === '') return null; var n = Number(s); return isFinite(n) ? n : null; }
  function addMonths(key, months) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || '')); if (!m) return '';
    var y = Number(m[1]), mo = Number(m[2]) - 1 + Number(months || 0), day = Number(m[3]);
    var out = new Date(Date.UTC(y, mo, 1)), last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
    out.setUTCDate(Math.min(day, last));
    return out.toISOString().slice(0, 10);
  }
  /*
   * Equipment screen (Joe 10/10): what each truck and trailer is set to run by default on each weekday, from Route Master's
   * <day>_tractor_default / <day>_trailer_default on active runs (a value may be the unit number or the equipment id).
   * Returns {equipmentId: {sun: ['808', ...], ...}}.
   */
  function unitDefaultDays(routes, units) {
    var byKey = {}, out = {};
    (units || []).forEach(function (e) {
      [e.id, e.unit].forEach(function (k) { k = String(k || '').trim().toUpperCase(); if (k) byKey[k] = e.id; });
    });
    (routes || []).forEach(function (r) {
      if (!r || (r.routeStatus && r.routeStatus !== 'ACTIVE') || r.active === false) return;
      var label = String(r.streamId || '').trim() || String(r.route || '').trim();
      DAYS.forEach(function (p) {
        var d = r.days && r.days[p];
        if (!d || !d.active) return;
        [d.tractor, d.trailer].forEach(function (v) {
          var id = byKey[String(v || '').trim().toUpperCase()];
          if (!id) return;
          var days = out[id] = out[id] || {};
          var list = days[p] = days[p] || [];
          if (list.indexOf(label) < 0) list.push(label);
        });
      });
    });
    return out;
  }
  // The Equipment Master notes without the fleet sync's text (" | External Fleet: ...", "Route Day ...").
  function cleanUnitNote(text) {
    // Everything from "External Fleet:" on is the fleet list's own text (year | make | model | VIN | yard | state).
    return String(text || '').replace(/\|?\s*External Fleet:[\s\S]*$/i, '').split('|').map(function (s) { return s.trim(); })
      .filter(function (s) { return s && !/^Route Day\b/i.test(s); }).join(' | ');
  }

  // Route hours as typed (12, 9.5, 9:30) to minutes, or null.
  function hoursMinutes(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return isFinite(value) && value > 0 ? Math.round(value * 60) : null;
    var s = String(value).trim(), m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (m) return +m[1] * 60 + +m[2] || null;
    var n = Number(s);
    return isFinite(n) && n > 0 ? Math.round(n * 60) : null;
  }
  // One run's time on the road that day: start = its dispatch time, end = start + route hours (+1 day past midnight).
  function runWindow(row, hoursFor) {
    var start = row.dispatchTime !== null && row.dispatchTime !== undefined ? row.dispatchTime : row.startTime;
    start = typeof start === 'number' ? start : minutesOfDay(start);
    var hours = hoursMinutes(row.routeHours);
    if (hours === null && hoursFor) hours = hoursMinutes(hoursFor(row));
    var end = start !== null && start !== undefined && hours !== null ? start + hours : null;
    if (start === undefined) start = null;
    if (end !== null && end <= start) end += 1440;
    return { start: start, end: end };
  }
  /*
   * Joe 10/10: the truck and trailer lists follow the current app's availability rule (039_V740 udpoV740ResourceBusy_,
   * 047_V744 optionsFor): a unit is left out when another run that delivery day has it and their times on the road
   * overlap (15 minutes' leeway at the turn), or when that run's return is not known. Returns {unitId: reason} for one
   * row, e.g. "ON ROAD UNTIL 2:00 PM (802)". kind: 'truck' | 'trailer'. hoursFor(row) gives Route Master hours when the
   * Live row has none.
   */
  function unitConflicts(rows, target, kind, hoursFor) {
    var key = kind === 'truck' ? 'truckId' : 'trailerId', out = {}, mine = runWindow(target, hoursFor), tol = 15;
    rows.forEach(function (r) {
      if (r === target || r.off || r.deliveryDate !== target.deliveryDate || !r[key] || out[r[key]]) return;
      var w = runWindow(r, hoursFor), busy;
      if (w.start === null || w.end === null) busy = w.start === null || mine.end === null || mine.end > w.start;
      else busy = mine.start !== null && mine.end !== null && w.start < mine.end - tol && mine.start < w.end - tol;
      if (busy) out[r[key]] = 'ON ROAD' + (w.end !== null ? ' UNTIL ' + timeText(w.end % 1440) : ' \u2014 RETURN UNKNOWN') + ' (' + r.route + ')';
    });
    return out;
  }

  // A leased unit (the fleet sync writes "Lease: Idealease" into the External Fleet text): not on Fleet Service (Joe 10/10).
  function unitLeased(unit) {
    return /External Fleet:[\s\S]*\bLease:\s*\S/i.test(String(unit && unit.notes || ''));
  }
  // Who leases a truck (the fleet list's LEASE column, kept in the unit's notes), or '' for one we own. A driver's short
  // number is the end of one unit's number (876 = 223876) when exactly one unit ends that way, as the current app's lessor routing.
  // Operational Assignments (the current app's DESKTOP DISPATCH OPERATIONAL ASSIGNMENTS): non-driver coverage offered under
  // "Other CVG / Carriers" in the driver lists. The current app's four start the list until someone changes them.
  var OPS_DEFAULTS = ['Carrier', 'Fairmont', 'Marietta', 'Martins Ferry'];
  function opsKey(name) { return String(name || '').trim().replace(/\s+/g, ' ').toUpperCase(); }
  function opsAssignments(docs) {
    var by = {};
    (docs || []).forEach(function (d) { var k = opsKey(d && d.assignment); if (k) by[k] = d; });
    OPS_DEFAULTS.forEach(function (n, i) { var k = opsKey(n); if (!by[k]) by[k] = { assignment: n, active: true, sequence: i + 1, builtIn: true }; });
    return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) {
      return (Number(a.sequence) || 9999) - (Number(b.sequence) || 9999) || String(a.assignment).localeCompare(String(b.assignment));
    });
  }

  function unitLessor(units, unitText) {
    var key = issueUnitKey(unitText), list = units || [];
    var hit = list.filter(function (u) { return issueUnitKey(u.unit) === key; });
    if (!hit.length && /^\d{2,5}$/.test(key)) {
      hit = list.filter(function (u) { var d = String(u.unit || '').replace(/\D/g, ''); return d.length > key.length && d.slice(-key.length) === key; });
      if (hit.length > 1) return { unit: '', lessor: '', why: 'Truck ' + unitText + ' matches ' + hit.map(function (u) { return u.unit; }).join(', ') };
    }
    if (!hit.length) return { unit: '', lessor: '', why: 'Truck ' + unitText + ' is not on the fleet list' };
    var m = /\bLease:\s*([^|\n]+)/i.exec(String(hit[0].notes || ''));
    return { unit: hit[0].unit, lessor: m ? m[1].trim() : '', why: m ? '' : 'Owned truck: our garage fixes it' };
  }

  function fleetKind(type) {
    var t = String(type || '').trim().toUpperCase().replace(/_/g, ' ');
    if (['TRUCK', 'TRACTOR', 'POWER UNIT', 'TRACTOR TRUCK', 'STRAIGHT TRUCK', 'BOX TRUCK'].indexOf(t) >= 0) return 'TRUCK';
    return t === 'TRAILER' ? 'TRAILER' : '';
  }
  function fleetDue(units, setup, miles, openJobs, rules, today) {
    rules = Object.assign({}, FLEET_RULES, rules || {});
    var setupBy = {}, openBy = {}, items = [], out = [];
    (setup || []).forEach(function (r) { setupBy[String(r.unit || '').trim().toUpperCase()] = r; });
    (openJobs || []).forEach(function (j) { if (j.service_key) openBy[String(j.unit).toUpperCase() + '|' + j.service_key] = j; });
    (units || []).forEach(function (u) {
      var s = setupBy[String(u.unit).toUpperCase()] || {}, trackRaw = String(s.track || '').trim(), tracked = trackRaw ? yes(trackRaw) : true;
      var odo = u.type === 'TRUCK' ? (miles || {})[String(u.unit).toUpperCase()] : null;
      var row = { unit: u.unit, type: u.type, tracked: tracked, trackSet: trackRaw ? (yes(trackRaw) ? 'YES' : 'NO') : '', miles: odo ? odo.miles : null, milesDate: odo ? odo.date : '',
        lastServiceDate: dateKey(s.last_service_date), lastServiceMiles: fleetNumber(s.last_service_miles), lastServiceHours: fleetNumber(s.last_service_hours),
        currentHours: fleetNumber(s.current_hours), dotDue: dateKey(s.dot_due), plateExpires: dateKey(s.plate_expires), notes: String(s.notes || '') };
      out.push(row);
      if (!tracked) return;
      function push(key, what, dueAt, now, left, status, last) {
        var job = openBy[String(u.unit).toUpperCase() + '|' + key];
        items.push({ unit: u.unit, type: u.type, key: key, what: what, dueAt: dueAt, now: now, left: left, status: job ? 'AT_GARAGE' : status, last: last || '', jobId: job ? job.work_order_id : '' });
      }
      if (u.type === 'TRUCK') {
        if (row.lastServiceMiles == null) push('PM', 'PM service', '', row.miles != null ? row.miles : '', '', 'SET_UP', row.lastServiceDate);
        else {
          var dueMiles = row.lastServiceMiles + rules.truckMiles, leftMiles = row.miles == null ? null : dueMiles - row.miles;
          push('PM', 'PM service', dueMiles, row.miles == null ? '' : row.miles, leftMiles == null ? '' : leftMiles,
            leftMiles == null ? 'NO_MILES' : leftMiles < 0 ? 'OVERDUE' : leftMiles <= rules.truckWarnMiles ? 'DUE_SOON' : 'OK', row.lastServiceDate);
        }
      } else {
        if (!row.lastServiceDate) push('REEFER', 'Reefer service', '', row.currentHours == null ? '' : row.currentHours, '', 'SET_UP', '');
        else {
          var dueDate = addMonths(row.lastServiceDate, rules.trailerMonths), daysLeft = daysBetween(today, dueDate);
          var hoursLeft = row.currentHours != null && row.lastServiceHours != null ? row.lastServiceHours + rules.trailerHours - row.currentHours : null;
          var late = daysLeft < 0 || (hoursLeft != null && hoursLeft < 0), soon = daysLeft <= rules.trailerWarnDays || (hoursLeft != null && hoursLeft <= 50);
          push('REEFER', 'Reefer service', dueDate, row.currentHours == null ? '' : row.currentHours, hoursLeft != null && hoursLeft < daysLeft * 10 ? hoursLeft + ' hrs' : daysLeft + ' days',
            late ? 'OVERDUE' : soon ? 'DUE_SOON' : 'OK', row.lastServiceDate);
        }
      }
      if (!row.dotDue) push('DOT', 'DOT annual inspection', '', '', '', 'SET_UP', '');
      else { var d = daysBetween(today, row.dotDue); push('DOT', 'DOT annual inspection', row.dotDue, '', d + ' days', d < 0 ? 'OVERDUE' : d <= rules.dotWarnDays ? 'DUE_SOON' : 'OK', ''); }
      if (row.plateExpires) { var p = daysBetween(today, row.plateExpires); push('PLATE', 'Plate / registration', row.plateExpires, '', p + ' days', p < 0 ? 'OVERDUE' : p <= rules.plateWarnDays ? 'DUE_SOON' : 'OK', ''); }
    });
    var rank = { OVERDUE: 0, AT_GARAGE: 1, DUE_SOON: 2, NO_MILES: 3, SET_UP: 4, OK: 5 };
    items.sort(function (a, b) { return rank[a.status] - rank[b.status] || String(a.unit).localeCompare(String(b.unit), undefined, { numeric: true }); });
    return { units: out, items: items };
  }

  function driverRosterRows(drivers, asOf) {
    var rows = (drivers || []).map(function (d) {
      var seniority = dateKey(d.seniorityDate) || dateKey(d.hireDate);
      return {
        id: d.id, name: d.name || '', status: d.status || '', reliefDriver: !!d.reliefDriver, seniorityDate: seniority,
        hireDate: dateKey(d.hireDate), vacationWeeks: vacationWeeks(d.hireDate, asOf), defaultTruckId: d.defaultTruckId || '',
        unavailableReason: d.unavailableReason || '', active: driverActive(d)
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
      if (run.weekStart !== week || !liveFlagShown(run, 'displayDaily', 'daily')) return;
      var d = run.days && run.days[prefix];
      if (!d || !d.runs) return;
      var issues = [];
      if (d.tractorIssues) issues.push('Truck: ' + d.tractorIssues);
      var more = Array.isArray(d.moreTrailers) ? d.moreTrailers : [];
      if (d.trailerIssues) issues.push('Trailer' + (more.length ? ' 1' : '') + ': ' + d.trailerIssues);
      more.forEach(function (m, i) { if (m && m.issues) issues.push('Trailer ' + (i + 2) + ' (' + m.trailer + '): ' + m.issues); if (m && m.needsCleaned) issues.push('Trailer ' + (i + 2) + ' (' + m.trailer + ') needs cleaned'); });
      if (d.palletJackIssues) issues.push('Jack: ' + d.palletJackIssues);
      if (yes(d.trailerNeedsCleaned)) issues.push('Trailer needs cleaned');
      if (d.overageShortageDetails || yes(d.overageShortage)) issues.push('Over/short: ' + (d.overageShortageDetails || 'yes'));
      rows.push({
        id: run.id + '|' + prefix, runDocId: run.id, day: prefix, route: run.route, run: run.run, coverageType: run.coverageType,
        // The units the driver checked in with (a corrected truck or trailer, drop-and-hook trailers), else Dispatch's.
        driver: d.driver || '', truck: d.checkinTruck || d.truck || '', trailer: [d.checkinTrailer || d.trailer || ''].concat(more.map(function (m) { return m && m.trailer; })).filter(Boolean).join(' / '), casesOut: d.casesOut,
        casesDelivered: d.casesDelivered, driverCaseReturn: d.driverCaseReturn,
        refusedReturned: d.refusedReturned || '', refusedReturnedSource: d.refusedReturnedSource || '',
        checkinNotes: d.checkinNotes || '', checkinCompletedAt: d.checkinCompletedAt || '',
        checkedIn: !!(d.checkinCompletedAt || (d.casesDelivered !== null && d.casesDelivered !== undefined)),
        issues: issues, rev: run.rev || 0
      });
    });
    return rows.sort(compareRoute);
  }

  // Drivers available on a day, as the current app's Dispatch Center counts them (udpoV740DriverOptions_): active, no day off
  // or exception that day, and not marked off that weekday on Driver Master (<day>_available; blank means available).
  function availableDrivers(drivers, exceptions, day) {
    var p = dayPrefix(day);
    return (drivers || []).filter(function (d) {
      if (!driverActive(d) || exceptionOn(exceptions, d.id, day)) return false;
      var cells = d.cells && Object.keys(d.cells).length ? d.cells : null;
      var flag = cells ? cells[p + '_available'] : '';
      return flag === undefined || flag === null || String(flag).trim() === '' || yes(flag);
    });
  }

  // The numbers on the Route Distribution home cards. today = the operating day; exceptions = days off (optional).
  function homeNumbers(runs, drivers, equipment, today, exceptions) {
    var daily = dailyRows(runs, today);
    var covered = daily.filter(function (r) { return !needsDriver(r); }).length;
    var week = weeklyRows(runs, weekStart(today));
    var checkins = checkinRows(runs, today);
    var active = (drivers || []).filter(driverActive);
    var units = (equipment || []).filter(function (e) { return e.status !== 'INACTIVE'; });
    return {
      daily: { loads: daily.length, needsDriver: daily.length - covered, covered: daily.length ? Math.round(covered * 100 / daily.length) : 100 },
      weekly: { runs: week.length, open: week.reduce(function (n, r) { return n + DAYS.filter(function (p) { return r.days[p].runs && !r.days[p].driver; }).length; }, 0) },
      drivers: { active: active.length, relief: active.filter(function (d) { return d.reliefDriver; }).length, inactive: (drivers || []).length - active.length, available: availableDrivers(drivers, exceptions, today).length },
      checkins: { deliveries: checkins.length, checkedIn: checkins.filter(function (r) { return r.checkedIn; }).length, issues: checkins.filter(function (r) { return r.issues.length; }).length },
      fleet: { trucks: units.filter(function (e) { return e.type === 'TRUCK'; }).length, trailers: units.filter(function (e) { return e.type === 'TRAILER'; }).length, inactive: (equipment || []).length - units.length }
    };
  }

  // Truck and trailer choices skip these, as the current app does (unless OVR is ticked).
  var UNIT_OFF_STATUSES = ['DOWN', 'INACTIVE', 'OUT', 'OUT OF SERVICE', 'OOS', 'REPAIR', 'DISABLED', 'UNAVAILABLE'];
  // Off = not usable by the current app's rule (unitUsable below): a status outside AVAILABLE / ACTIVE / IN SERVICE / READY, or a truck
  // or trailer no longer on the fleet list import.
  function unitOff(unit) { return !unitUsable(unit); }
  // Joe 10/12 ("537 is on the list being down but shows on dispatch"): running loads from fromDate on that still carry a down,
  // inactive or out-of-service truck or trailer (the current app's week roll can put a down unit back on a route).
  function offUnitLoads(runs, equipment, fromDate) {
    var byId = {}, out = [];
    (equipment || []).forEach(function (e) { if (e && e.id) byId[String(e.id).toUpperCase()] = e; });
    (runs || []).forEach(function (run) {
      DAYS.forEach(function (p, i) {
        var d = run.days && run.days[p], date = addDays(run.weekStart, i);
        if (!d || !d.runs || (fromDate && date < fromDate)) return;
        [['truckId', 'truck'], ['trailerId', 'trailer']].forEach(function (k) {
          var e = d[k[0]] && byId[String(d[k[0]]).toUpperCase()];
          if (e && unitOff(e)) out.push({ unitId: e.id, unit: e.unit, type: e.type, status: String(e.status || ''), notes: String(e.notes || ''), route: String(run.route || ''), run: String(run.run || ''), date: date, runDocId: run.id, day: p });
        });
      });
    });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.route.localeCompare(b.route, undefined, { numeric: true }); });
  }

  // Runs that do not run on a load date's delivery day, for + Add Route / Run (blank load-day offset = -1).
  function notRunningRows(runs, loadDate) {
    var rows = [];
    (runs || []).forEach(function (run) {
      if (!liveFlagShown(run, 'displayDaily', 'daily')) return;
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
    // Joe 10/11: a run with no driver because its regular driver is off that day (any reason) is red, so the cover shows.
    if (!who) return offCover(row, prefix, d.date, ctx) ? 'vacation-needs' : 'needs';
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
    return Object.assign(offCoverContext(drivers, exceptions), { dup: dup, relief: relief, plant: plant });
  }

  /*
   * Joe 10/11: a driver off on a day he normally works (vacation, sick, personal, bereavement, unpaid or any other exception)
   * leaves his regular run needing cover. The run knows it when Reset Week or the sheet wrote who it was for (intendedDriver,
   * driverExceptionStatus); otherwise Driver Master's <day>_assignments_json names its regular driver, who has an exception
   * that day. offCover returns { name, reason } for such a run day, else null.
   */
  function offCoverContext(drivers, exceptions) {
    var normal = {}, names = {};
    (drivers || []).forEach(function (d) {
      if (!d || !d.id || !driverActive(d) || !d.cells) return;
      names[d.id] = d.name || '';
      DAYS.forEach(function (p) {
        if (!((p + '_available') in d.cells) || !yes(d.cells[p + '_available'])) return;
        normalRuns(d.cells[p + '_assignments_json']).forEach(function (id) { (normal[p + '|' + id] = normal[p + '|' + id] || []).push(d.id); });
      });
    });
    return { exceptions: exceptions || [], normal: normal, names: names };
  }
  function offCover(row, prefix, date, ctx) {
    var d = row.days ? row.days[prefix] : row;
    if (d.intendedDriver || d.driverExceptionStatus) return { name: d.intendedDriver || '', reason: d.driverExceptionStatus || 'OFF' };
    if (!ctx || !ctx.normal) return null;
    var ids = ctx.normal[prefix + '|' + String(row.runId || '').trim()] || [];
    for (var i = 0; i < ids.length; i++) {
      var off = exceptionOn(ctx.exceptions, ids[i], date);
      if (off) return { name: ctx.names[ids[i]] || '', reason: exceptionLabel(off) };
    }
    return null;
  }

  // One line per active driver (relief drivers first, then seniority): each day shows the routes they have, else why
  // they are off, else AVAILABLE. kind = assigned, booked (two or more), vacation, unavailable, available.
  function boardLabel(r) {
    var stream = String(r.streamId || '').trim(), route = String(r.route || '').trim(), run = String(r.run || '').trim();
    return stream || (!run || run.toUpperCase() === route.toUpperCase() ? route : route + ' ' + run);
  }
  // The run ids a Driver Master <day>_assignments_json lists (strings or { runId } objects).
  function normalRuns(raw) {
    var list = [];
    try { list = raw ? JSON.parse(raw) : []; } catch (e) { list = []; }
    return (Array.isArray(list) ? list : [list]).map(function (a) { return String(typeof a === 'string' ? a : a && (a.runId || a.run_id) || '').trim(); }).filter(Boolean);
  }
  function driverBoardRows(drivers, rows, exceptions, week) {
    var list = (drivers || []).filter(driverActive).map(function (d) {
      return { id: d.id, name: d.name || '', relief: !!d.reliefDriver, cells: d.cells && Object.keys(d.cells).length ? d.cells : null, seniorityDate: dateKey(d.seniorityDate) || dateKey(d.hireDate) || '9999-12-31', days: {} };
    });
    list.sort(function (a, b) { return (a.relief === b.relief ? 0 : a.relief ? -1 : 1) || a.seniorityDate.localeCompare(b.seniorityDate) || a.name.localeCompare(b.name); });
    list.forEach(function (driver) {
      DAYS.forEach(function (p, i) {
        var date = addDays(week, i), routes = [], extra = false;
        // Like the current board: the run's stream (SAVE-A-LOT 1, 825), else the route, plus the run when it differs.
        var runIds = [];
        (rows || []).forEach(function (r) { var d = r.days[p]; if (d.runs && d.driverId === driver.id) { routes.push(boardLabel(r)); runIds.push(String(r.runId || '').trim()); if (d.routeOverride) extra = true; } });
        var off = exceptionOn(exceptions, driver.id, date);
        // OFF: Driver Master does not have the driver available that day (<day>_available), as on the current board.
        var dayOff = !!driver.cells && !yes(driver.cells[p + '_available']);
        // Joe 10/11: off on a day he normally works is red whatever the reason (vacation, sick, unpaid...); off on his regular day
        // off stays as before (red only for vacation).
        var scheduled = !!driver.cells && (p + '_available') in driver.cells && !dayOff;
        var kind = routes.length > 1 ? 'booked' : routes.length ? (off ? 'conflict' : 'assigned') : off ? (scheduled || /VACATION/i.test(off.type + off.reasonCode) ? 'vacation' : 'unavailable') : dayOff ? 'off' : 'available';
        // extra: a day someone changed by hand (the run's route_override), light blue on the board as in the current app.
        // Joe 10/10: one run name once (8303 twice reads 8303 ×2), each on its own line, so nothing is cut or left with a stray slash.
        // Joe 10/11: a run that is not part of the driver's normal week that day is "added" (yellow on the board): his Driver
        // Master <day>_assignments_json does not list it, or he is normally off that day. Relief drivers have no normal week.
        var added = false;
        if (routes.length && !driver.relief && driver.cells) {
          if ((p + '_available') in driver.cells && dayOff) added = true;
          else if ((p + '_assignments_json') in driver.cells) {
            var normal = normalRuns(driver.cells[p + '_assignments_json']);
            added = runIds.some(function (id) { return normal.indexOf(id) < 0; });
          }
        }
        var lines = [], seen = {};
        routes.forEach(function (n) { if (seen[n]) seen[n].n++; else { seen[n] = { name: n, n: 1 }; lines.push(seen[n]); } });
        lines = lines.map(function (x) { return x.n > 1 ? x.name + ' \u00d7' + x.n : x.name; });
        driver.days[p] = { date: date, routes: routes, lines: lines, kind: kind, extra: extra && routes.length > 0, added: added, text: routes.length ? lines.join(' / ') : off ? exceptionLabel(off) : dayOff ? 'OFF' : 'AVAILABLE' };
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
    if (!route || ROUTE_OFF.indexOf(String(route.routeStatus || 'ACTIVE').toUpperCase()) >= 0 || !masterActive(route)) return null;
    var plan = {};
    DAYS.forEach(function (p, i) {
      var rd = route.days && route.days[p] || {}, runs = !!rd.active, d = runs ? slots[run.runId + '|' + p] : null;
      var off = d ? exceptionOn(exceptions, d.id, addDays(run.weekStart, i)) : null;
      plan[p] = { runs: runs, driverId: d && !off ? d.id : '', driver: d && !off ? d.name : '',
        intendedDriverId: off ? d.id : '', intendedDriver: off ? d.name : '', driverExceptionStatus: off ? (off.reasonCode || exceptionLabel(off)) : '' };
    });
    return plan;
  }

  /*
   * Publish Week builds the new Next week from the masters, as the current app's Publish does (udpoV743SeedLiveWeek_, then
   * udpoV779MaterializeRouteWeek_, udpoV743MaterializeDriverWeek_ and udpoV744MaterializeEquipmentWeek_ on LIVE NEXT WEEK):
   * one run per Route Master run, each day running when Route Master has it active, with its depart time, hours, miles, load
   * order and load day; the driver whose Driver Master template lists the run that day (left as "who it was for" when that
   * driver is off); the driver's own truck, else the run's default truck; the run's default trailer. A unit that is down, or
   * already on another run whose hours overlap that day, is left blank. Weekly also uses this to preview weeks past Next.
   */
  // Route Master hours are "9:30" or "9.5".
  function routeHours(v) {
    var t = String(v === null || v === undefined ? '' : v).trim(), m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (m) return Number(m[1]) + Number(m[2]) / 60;
    return number(t);
  }
  // Finds a usable truck or trailer by its ID or unit number ("T-901", "901" for a trailer); null when unknown or down.
  function unitFinder(equipment) {
    var list = equipment || [], bare = function (v) { return String(v || '').trim().toUpperCase().replace(/^T\s*-?\s*(?=\d)/, ''); };
    return function (value, type) {
      var v = String(value || '').trim(), k = bare(v);
      if (!v) return null;
      var hit = null;
      for (var i = 0; i < list.length && !hit; i++) {
        var e = list[i];
        if (type && String(e.type || '').toUpperCase() !== type) continue;
        if (String(e.id || '').toUpperCase() === v.toUpperCase() || (k && bare(e.unit) === k)) hit = e;
      }
      return hit && unitUsable(hit) ? { id: hit.id, unit: hit.unit } : null;
    };
  }
  // ctx: { slots: standardDrivers(drivers), exceptions, driversById, findUnit: unitFinder(equipment), booked: {} shared by every run of the week }
  function weekBuildContext(drivers, exceptions, equipment) {
    var byId = {};
    (drivers || []).forEach(function (d) { if (d && d.id) byId[d.id] = d; });
    return { slots: standardDrivers(drivers), exceptions: exceptions || [], driversById: byId, findUnit: unitFinder(equipment), booked: {} };
  }
  // A unit is free that day when every other run it is on that day ends before this one starts (or starts after it ends).
  function bookUnit(ctx, prefix, kind, unitId, start, hours) {
    var key = prefix + '|' + kind + '|' + unitId, list = ctx.booked[key] = ctx.booked[key] || [];
    var end = start !== null && start !== undefined && hours > 0 ? start + hours * 60 : null;
    var clash = list.some(function (w) { return w.start === null || w.end === null || start === null || start === undefined || end === null || (w.start < end && start < w.end); });
    if (clash) return false;
    list.push({ start: start === undefined ? null : start, end: end });
    return true;
  }
  // The days of one run for one week (only the fields the masters decide; the server adds the Live sheet's other columns blank).
  function buildRunDays(route, week, ctx) {
    var days = {};
    DAYS.forEach(function (p, i) {
      var rd = (route.days && route.days[p]) || {}, date = addDays(week, i);
      var offset = rd.loadDayOffset === null || rd.loadDayOffset === undefined || rd.loadDayOffset === '' ? -1 : Number(rd.loadDayOffset);
      var day = { runs: !!rd.active, loadSequence: rd.loadOrder === undefined ? null : rd.loadOrder, loadSequenceOverride: null, loadDayOffset: offset,
        deliveryDate: date, dispatchDate: date, departureDate: date, loadDate: addDays(date, offset),
        dispatchTime: rd.dispatchTime === undefined ? null : rd.dispatchTime, startTime: rd.dispatchTime === undefined ? null : rd.dispatchTime,
        routeHours: routeHours(rd.hours), miles: rd.miles === undefined ? null : rd.miles,
        driverId: '', driver: '', intendedDriverId: '', intendedDriver: '', driverExceptionStatus: '', truckId: '', truck: '', trailerId: '', trailer: '' };
      if (day.runs) {
        var d = ctx.slots[route.id + '|' + p], off = d ? exceptionOn(ctx.exceptions, d.id, date) : null;
        if (d && !off) { day.driverId = d.id; day.driver = d.name; }
        if (d && off) { day.intendedDriverId = d.id; day.intendedDriver = d.name; day.driverExceptionStatus = off.reasonCode || exceptionLabel(off); }
        var own = day.driverId && ctx.driversById[day.driverId] ? ctx.findUnit(ctx.driversById[day.driverId].defaultTruckId, 'TRUCK') : null;
        var truck = own || ctx.findUnit(rd.tractor, 'TRUCK'), trailer = ctx.findUnit(rd.trailer, 'TRAILER');
        if (truck && bookUnit(ctx, p, 'TRUCK', truck.id, day.dispatchTime, day.routeHours)) { day.truckId = truck.id; day.truck = truck.unit; }
        if (trailer && bookUnit(ctx, p, 'TRAILER', trailer.id, day.dispatchTime, day.routeHours)) { day.trailerId = trailer.id; day.trailer = trailer.unit; }
      }
      days[p] = day;
    });
    return days;
  }
  // One whole run for one week, shaped like a run copied from a Live tab.
  function buildWeekRun(route, week, ctx) {
    var flag = function (v) { return v === true || v === false ? v : null; };
    return {
      weekStart: week, facilityId: route.facilityId || '', streamId: route.streamId || '', routeId: route.routeId || '', route: route.route || '',
      routeName: route.routeName || '', runId: route.id, run: route.run || '', routeRunType: route.routeRunType || '', loadType: route.loadType || '',
      movementType: route.movementType || '', coverageType: route.coverageType || '', coverageOwner: route.coverageOwner || '', dedicatedType: route.dedicatedType || '',
      routeStatus: route.routeStatus || '', active: flag(route.active), displayDaily: flag(route.displayDaily), displayWeekly: flag(route.displayWeekly),
      displayPlant: flag(route.displayPlant), displayMobileRoute: flag(route.displayMobile),
      weekOrder: route.weekOrder === undefined ? null : route.weekOrder, weeklyShowMaster: flag(route.displayWeekly),
      masterShow: { daily: route.displayDaily === undefined ? null : route.displayDaily, mobile: route.displayMobile === undefined ? null : route.displayMobile, loadType: route.loadType || '' },
      days: buildRunDays(route, week, ctx)
    };
  }

  // A check-in or write-up answer that says nothing is wrong ("none", "ok", "no issues", "Y"): no write-up (udpoMaintenanceNoWriteUp_).
  function noWriteUp(value) {
    var t = String(value === null || value === undefined ? '' : value).toLowerCase().replace(/[^a-z0-9/+ ]+/g, ' ').replace(/\s+/g, ' ').replace(/^[/+ ]+|[/+ ]+$/g, '');
    if (!t) return true;
    if (/^(?:x+|n|no|nope|none|nil|na|n a|n\/a|negative|nothing|ok|okay|good|fine|working|working fine|all good|all ok|all okay|all clear)$/.test(t)) return true;
    if (/^(?:no|nothing|none)(?: (?:new|known|major|minor|other))? (?:write ?ups?|issues?|defects?|problems?|concerns?|repairs?|damages?|complaints?|comments?|reports?|notes?)(?: (?:to report|reported|noted|found|today|at this time|this trip))?$/.test(t)) return true;
    if (/^(?:nothing|none) (?:to report|wrong|noted|today|needed|at this time)$/.test(t)) return true;
    if (/^(?:n0|it ?s (?:fine|good|ok|okay)|it is (?:fine|good|ok|okay)|its (?:fine|good|ok|okay))$/.test(t)) return true;
    t = t.replace(/[^a-z0-9 ]+/g, ' ').trim();
    return /^(?:y|ye|yes|yep|yeah|ytes|ye s)$/.test(t);
  }

  return {
    noWriteUp: noWriteUp,
    plantFor: plantFor, plantTitle: plantTitle, standardDrivers: standardDrivers, resetWeekPlan: resetWeekPlan,
    routeHours: routeHours, unitFinder: unitFinder, weekBuildContext: weekBuildContext, bookUnit: bookUnit, buildRunDays: buildRunDays, buildWeekRun: buildWeekRun,
    coveredRoute: coveredRoute, weeklyCellClass: weeklyCellClass, weeklyContext: weeklyContext, driverBoardRows: driverBoardRows,
    UNIT_OFF_STATUSES: UNIT_OFF_STATUSES, unitOff: unitOff, offUnitLoads: offUnitLoads, unitUsable: unitUsable, driverActive: driverActive, notRunningRows: notRunningRows,
    vacationType: vacationType, VACATION_TYPE_NAMES: VACATION_TYPE_NAMES, holidayWeeks: holidayWeeks, dayLimit: dayLimit,
    exceptionOn: exceptionOn, exceptionLabel: exceptionLabel, vacationsOn: vacationsOn,
    SCREENS: SCREENS, screenOwners: screenOwners, screenState: screenState, GO_LIVE: GO_LIVE, GO_LIVE_LATER: GO_LIVE_LATER, fullyLive: fullyLive,
    SAVE_ROLES: SAVE_ROLES, REORDER_ROLES: REORDER_ROLES, DRIVER_ROLES: DRIVER_ROLES, hasRole: hasRole,
    PLANTS: PLANTS, PRIMARY_ADMINS: PRIMARY_ADMINS, ADMIN_ROLES: ADMIN_ROLES, isAdmin: isAdmin, plantsFor: plantsFor,
    vacationWeeks: vacationWeeks, driverRosterRows: driverRosterRows, needsDriver: needsDriver, checkinRows: checkinRows, homeNumbers: homeNumbers, availableDrivers: availableDrivers,
    unitDefaultDays: unitDefaultDays, cleanUnitNote: cleanUnitNote, hoursMinutes: hoursMinutes, unitLeased: unitLeased, unitLessor: unitLessor, opsAssignments: opsAssignments, opsKey: opsKey, OPS_DEFAULTS: OPS_DEFAULTS, runWindow: runWindow, unitConflicts: unitConflicts,
    fleetDue: fleetDue, fleetKind: fleetKind, addMonths: addMonths, FLEET_RULES: FLEET_RULES,
    DAYS: DAYS, DAY_NAMES: DAY_NAMES, TIME_ZONE: TIME_ZONE, DAY_ROLL_HOUR: DAY_ROLL_HOUR, localDay: localDay,
    isDateKey: isDateKey, dateKey: dateKey, addDays: addDays, dayPrefix: dayPrefix, dayName: dayName,
    liveFlagShown: liveFlagShown, weekStart: weekStart, daysBetween: daysBetween, operatingDay: operatingDay,
    yes: yes, optionalYes: optionalYes, masterActive: masterActive, masterFlag: masterFlag, issueRows: issueRows, issueNumbers: issueNumbers, number: number, minutesOfDay: minutesOfDay, timeText: timeText,
    loadBlocksFor: loadBlocksFor, effectiveSequence: effectiveSequence, dailyRows: dailyRows, offCover: offCover, offCoverContext: offCoverContext,
    weeksForLoadDate: weeksForLoadDate, weeklyRows: weeklyRows
  };
});
