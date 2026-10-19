/*
 * The plant's unloading, returns and washing rules, shared by the screens and the server (one file, copied unchanged to
 * public/js/plant-rules.js; a unit test checks the two match).
 *
 * The same rules as the current app (udpoV740MobilePlantWorkspace_ and desktopUiSaveMobileUnloadingGuardedV748_):
 *   - a trailer back from its route is one unloading record per date, route and run (its "unload key"); every save
 *     adds a newer record and the newest one is the unloading now; the returns put back in the cooler add up over all;
 *   - Waiting until Start, Unloading until End, then Done; End needs the quantity in (zero counts);
 *   - every unloaded trailer needs washing until a wash of that trailer is recorded after the unload ended;
 *   - a trailer number typed as digits only is stored as T- and the number.
 *
 * And the Plant Operations Scheduler's (203_V5078_OperationsRepair.gs):
 *   - Shipping loads are PLANT_SCHEDULE records, Receiving loads PLANT_RECEIVING, added suppliers PLANT_SUPPLIER; a record's
 *     newest copy is the record now (the app's own copy is always the newest) and a DELETED one is off the schedule;
 *   - Shipping's customers are the active Route Master runs shown to the plant, an as-needed customer (".. LOAD 1",
 *     ".. LOAD 2") listed once; Receiving's are the suppliers the plant added;
 *   - weeks run Sunday to Saturday; the plant's holidays are marked on the calendar. *
 * And Yard Checks' (getDesktopUiPlantYardChecksV5063 / udpoV780LoadedTrailerTemperatureWatch_, 7.0.276):
 *   - a trailer is on the yard from the day it is loaded until its dispatch time (the dispatch nearest after the load was
 *     marked done, or the operating day before the departure date for a load made days ahead), and a "Left Yard" press
 *     takes that load off;
 *   - a checked trailer leaves the Active Yard Queue for 2 hours, then comes back until it leaves;
 *   - fuel is Full, 3/4, 1/2 or Empty; the 24-hour history lists every check and every Left Yard.
 *
 * And Production Line Status & Quality's (027_V734_ProductionQuality.gs, Plant.html desktopQualityMarkupV780):
 *   - the lines are the active PRODUCTION_AREA rows of PLANT_OPERATIONS_MASTER, in view order;
 *   - a line's form starts from its last check (product, tip test, label / date code, overall result, notes, weights);
 *   - Boxing records no cycle time; Raypak no cycle time or weight; Totes and HTST #1 and #2 no cycle time, weight or tip test;
 *   - the overall result is Pass (RUNNING), Review, Fail (DOWN) or Finished; the 24-hour history lists every line's checks.
 *
 * And Shift Notes' (the Shift Report Log page, the Incident & Breakdown Log until Joe 10/12; desktopUiSavePlantShiftReportV5008 / handoffLogHtmlV7250):
 *   - an entry has a type, equipment / area, shift, reading time, what happened, next steps and a follow-up status;
 *   - a review note hangs under its entry and the entry's status is its newest review's; the log shows the last 24 hours;
 *   - the shift by the hour: 6 AM to 2:59 PM first, 3 PM to 11:59 PM second, midnight to 5:59 AM third.
 *
 * And Cooler Temperatures' (Plant Temperatures & Coolers, 025_V730_PlantTemperatureChecks.gs):
 *   - the locations are the active TEMPERATURE_CHECK_LOCATION rows of PLANT_OPERATIONS_MASTER, in view order, with the
 *     sensor id and low / high limits from days_json;
 *   - a manual reading is HIGH above the high limit, LOW below the low limit, else RECORDED; a location is locked for
 *     2 hours after its last manual reading; a location with no sensor reading shows MANUAL ONLY; a MOCREO sensor (sensors/*)
 *     shows its °F, battery and IN RANGE / HIGH / LOW / STALE / OFFLINE / SENSOR ERROR;
 *   - the 24-hour history lists every reading, newest first.
 *
 * And Manager Center's (218_V7275_ManagerCenterCounts.gs) and Send Current Report's (217_V7271_PlantCurrentReport.gs):
 *   - every mini-card number comes from the same rules as the screen it opens;
 *   - Scheduler: this month, this week (Sunday to Saturday), today, and loads from today to Saturday with no trailer (carriers bring their own);
 *   - Quality: lines, lines down (DOWN or a FAIL label check), tip tests and fails in 24 hours, the last weight, checks in 24 hours;
 *   - Shift Notes: handoff entries, other issues, entries not resolved, all entries in 24 hours;
 *   - the report: a load not done whose depart time is 30 minutes away or past is behind; breakdowns are Breakdown entries of the
 *     Shift Notes not resolved; the subject is "Plant Update <time>: N routes behind" or "All routes on time".
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UDPlant = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var DONE_WASH = /^(COMPLETE|COMPLETED|CLEANED|CLOSED|RESOLVED|WASHED|DONE|REMOVED)$/i;

  function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function unloadKey(date, route, run) { return date + '|' + text(route) + '|' + text(run); }
  // "T-901", "901" and "t 901" are the same trailer.
  function unitKey(v) { return text(v).toUpperCase().replace(/^T\s*-?\s*(?=\d)/, '').replace(/\s+/g, ''); }
  function trailerText(v) { var t = text(v).toUpperCase().replace(/\s+/g, ''); return /^\d+$/.test(t) ? 'T-' + t : t; }
  function when(v) { var t = Date.parse(v || ''); return isFinite(t) ? t : 0; }

  function payloadOf(doc) { return (doc && doc.payload) || {}; }

  // The newest unloading record per unload key for one date, with the returns removed by any of them.
  // docs = plantJournal docs of the date (the sheet's and the app's). The app's own record is always the newest.
  function latestUnloads(docs, date) {
    var list = (docs || []).filter(function (d) { return String(d.type || '').toUpperCase() === 'UNLOADING' && (!date || d.date === date); });
    list.sort(function (a, b) { return (a.createdInApp ? 1 : 0) - (b.createdInApp ? 1 : 0) || when(a.recordedAt) - when(b.recordedAt); });
    var out = {};
    list.forEach(function (d) {
      var p = payloadOf(d), key = p.unloadKey || unloadKey(d.date, p.route || d.route, p.run || d.run);
      var had = out[key], removed = had ? had.removed.slice() : [];
      (p.productReturnRemovedIds || []).forEach(function (id) { if (removed.indexOf(id) < 0) removed.push(id); });
      out[key] = { key: key, casesIn: p.casesIn === undefined || p.casesIn === null ? (d.quantity || '') : p.casesIn, startedAt: p.startedAt || d.startedAt || '',
        completedAt: p.completedAt || d.completedAt || '', trailer: Object.prototype.hasOwnProperty.call(p, 'trailer') ? p.trailer : (d.trailer || undefined),
        notes: p.notes || d.notes || '', removed: removed, recordedAt: d.recordedAt || '', route: p.route || d.route || '', run: p.run || d.run || '' };
      out[key].status = out[key].completedAt ? 'COMPLETE' : out[key].startedAt ? 'UNLOADING' : 'WAITING';
    });
    return out;
  }

  // Washes recorded per trailer (the newest one), from WASHING records marked COMPLETE.
  function washesDone(docs) {
    var out = {};
    (docs || []).forEach(function (d) {
      if (String(d.type || '').toUpperCase() !== 'WASHING') return;
      var p = payloadOf(d), unit = unitKey(p.trailer || d.trailer), st = text(p.status || d.status).toUpperCase();
      if (!unit || st !== 'COMPLETE') return;
      var at = p.completedAt || d.completedAt || d.recordedAt || '';
      if (!out[unit] || when(at) > when(out[unit].completedAt)) out[unit] = { completedAt: at, by: p.completedBy || d.recordedBy || '' };
    });
    return out;
  }
  function washOpen(status) { return !DONE_WASH.test(text(status)); }

  /* ---------- the Plant Operations Scheduler ---------- */

  var LOAD_TYPE = { SHIPPING: 'PLANT_SCHEDULE', RECEIVING: 'PLANT_RECEIVING' };
  var SUPPLIER_TYPE = 'PLANT_SUPPLIER';
  // Joe 10/13 ("the ones in there I don't want to have"): no sample suppliers; the list is only the ones the plant adds.
  var STARTING_SUPPLIERS = [];
  function lane(v) { return text(v).toUpperCase() === 'RECEIVING' ? 'RECEIVING' : 'SHIPPING'; }

  // The record now per record ID, of the given types: the app's copy over the sheet's, then the newest.
  function newestRecords(docs, types) {
    var list = (docs || []).filter(function (d) { return types.indexOf(String(d.type || '').toUpperCase()) >= 0 && text(d.recordId); });
    list.sort(function (a, b) { return (a.createdInApp ? 1 : 0) - (b.createdInApp ? 1 : 0) || when(a.recordedAt) - when(b.recordedAt); });
    var out = {};
    list.forEach(function (d) { out[text(d.recordId)] = d; });
    return out;
  }

  // "6:00 AM", "6:00" and "06:00" are the same pickup time: 06:00.
  function time24(v) {
    var m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])?\.?[Mm]?\.?$/.exec(text(v));
    if (!m) return '';
    var h = Number(m[1]), min = Number(m[2]);
    if (m[3]) { if (h < 1 || h > 12) return ''; h = h % 12 + (/p/i.test(m[3]) ? 12 : 0); }
    if (h > 23 || min > 59) return '';
    return (h < 10 ? '0' : '') + h + ':' + m[2];
  }

  // The loads on the schedule (not deleted), as the current app lists them.
  // A scheduled load's station work (Boxing: Shipping / Loadout and Receiving): WAITING until a station starts it.
  function workOf(w) {
    w = w || {};
    var st = text(w.state).toUpperCase();
    return { state: st === 'COMPLETE' ? 'COMPLETE' : st === 'WORKING' || st === 'PAUSED' ? st : 'WAITING', count: text(w.count), temperature: text(w.temperature), notes: text(w.notes),
      startedAt: text(w.startedAt), startedBy: text(w.startedBy), completedAt: text(w.completedAt), completedBy: text(w.completedBy) };
  }

  function scheduleEntries(docs, laneName) {
    var all = newestRecords(docs, [LOAD_TYPE[lane(laneName)]]), out = [];
    Object.keys(all).forEach(function (id) {
      var d = all[id], p = payloadOf(d);
      if (text(d.status).toUpperCase() === 'DELETED' || !d.date) return;
      out.push({ id: id, date: d.date, routeId: d.routeId || '', runId: d.runId || '', route: d.route || '', run: d.run || '', pickupTime: time24(p.pickupTime) || text(p.pickupTime),
        scheduleType: text(p.scheduleType).toUpperCase() === 'CARRIER' || p.carrier === true ? 'CARRIER' : 'ROUTE', loadDate: text(p.loadDate), trailer: text(p.trailer),
        poNumber: text(p.poNumber), cases: text(p.cases), product: text(p.product), notes: text(p.notes || d.notes), status: text(d.status).toUpperCase() || 'SCHEDULED',
        loadType: loadArea(p.loadType), inApp: !!d.createdInApp, work: workOf(p.work) });
    });
    return out.sort(function (a, b) { return a.date.localeCompare(b.date) || (a.pickupTime || '99:99').localeCompare(b.pickupTime || '99:99'); });
  }

  // Shipping's customers: Route Master runs that are active and shown to the plant (routes = route docs with runId).
  function scheduleCustomers(routes) {
    var list = [];
    (routes || []).forEach(function (r) {
      var status = text(r.routeStatus).toUpperCase();
      if ((status && status !== 'ACTIVE') || r.active === false || r.displayPlant !== true) return;
      var route = text(r.routeCode || r.route), run = text(r.run);
      if (!route && !run) return;
      list.push({ routeId: text(r.routeId), runId: text(r.runId), route: route, run: run, name: text(r.routeName), loadType: loadArea(r.loadType) });
    });
    list.sort(function (a, b) { return a.route.localeCompare(b.route, undefined, { numeric: true }) || a.run.localeCompare(b.run); });
    // An as-needed customer (Aldi - Charleston LOAD 1 to 4) is one customer; its first slot names the run, and its runs are
    // its slots in load-number order (numberLoads puts the day's Load 2 on LOAD 2).
    var out = [], byKey = {};
    list.forEach(function (r) {
      var m = /^(.*?)[\s-]*LOAD\s*([0-9]+)$/i.exec(r.run);
      if (!m || !m[1].trim()) { out.push(r); return; }
      var base = m[1].trim(), baseRoute = r.route.replace(/_[0-9]+$/, ''), key = baseRoute + '|' + base.toUpperCase();
      var slot = { routeId: r.routeId, runId: r.runId, route: r.route, run: r.run, n: Number(m[2]), loadType: r.loadType };
      if (byKey[key]) { byKey[key].slots.push(slot); return; }
      byKey[key] = { routeId: r.routeId, runId: r.runId, route: baseRoute, run: base, name: r.name, loadType: r.loadType, grouped: true, slots: [slot] };
      out.push(byKey[key]);
    });
    out.forEach(function (c) {
      if (!c.grouped) return;
      c.slots.sort(function (a, b) { return a.n - b.n; });
      c.routeId = c.slots[0].routeId; c.runId = c.slots[0].runId; c.loadType = c.slots[0].loadType || c.loadType;
    });
    return out;
  }

  /* Joe 10/14 ("It should only show box loads ... always put the default in and then let the user change it"): a Shipping load
     has a Load Type (Case, Totes, Boxes, Tanker), filled in from Route Master's load_type for the picked run and changeable on
     Add / Edit Load. Each Daily Loadout shows the Scheduler loads of its own type. A load saved before it had one takes its run's
     Route Master type; a run with no type there is a box load (as before). */
  var LOAD_TYPES = [['CASE', 'Case'], ['TOTES', 'Totes'], ['BOXING', 'Boxes'], ['TANKER', 'Tanker']];
  function loadArea(t) {
    t = text(t).toUpperCase();
    if (t === 'CASE LOADOUT' || t === 'CASE') return 'CASE';
    if (t === 'TOTE' || t === 'TOTES' || t === 'TOTE LOADOUT') return 'TOTES';
    if (t === 'BOXING' || t === 'BOX' || t === 'BOXES' || t === 'BOX LOADOUT') return 'BOXING';
    if (t === 'TANKER' || t === 'TANKER LOADOUT') return 'TANKER';
    return '';
  }
  // The Route Master type of a customer's run (a LOAD N run's own type, else its customer's), or Boxes.
  function routeLoadType(customers, runId) {
    var hit = '';
    (customers || []).some(function (c) {
      return (c.slots || [c]).some(function (s) { if (runId && s.runId === runId) { hit = s.loadType || c.loadType || ''; return true; } return false; });
    });
    return hit || 'BOXING';
  }
  // A numbered load's type: its own, else its LOAD N run's on Route Master.
  function scheduleArea(x, customers) { return x.loadType || routeLoadType(customers, (x.slot && x.slot.runId) || x.runId); }

  // Joe 10/14: a customer's loads on one delivery day are numbered by pickup time (Load 1, Load 2, Load 3; one load is Load 1).
  // An as-needed customer's Load N goes on its LOAD N run (slot), so each load has its own line for a driver, truck and cases;
  // more loads than runs share the last run (overSlots: add a run on Route Master). `customers` is scheduleCustomers (or the
  // suppliers); a load whose run is not on the list is numbered with the other loads of the same run.
  function loadNumberName(name, n) { name = text(name).replace(/[\s-]*LOAD\s*[0-9]+$/i, ''); return n ? name + ' Load ' + n : name; }
  function numberLoads(entries, customers) {
    var byRun = {}, groups = {}, out = {};
    (customers || []).forEach(function (c, i) { (c.slots || [c]).forEach(function (s) { if (s.runId && !(s.runId in byRun)) byRun[s.runId] = i; }); });
    (entries || []).forEach(function (x) {
      var c = byRun[x.runId], who = c === undefined ? 'r:' + (x.runId || text(x.route) + '|' + text(x.run).toUpperCase()) : 'c:' + c;
      (groups[who + '|' + x.date] = groups[who + '|' + x.date] || []).push(x);
    });
    Object.keys(groups).forEach(function (k) {
      var list = groups[k].slice().sort(function (a, b) { return (a.pickupTime || '99:99').localeCompare(b.pickupTime || '99:99') || text(a.id).localeCompare(text(b.id)); });
      var c = byRun[list[0].runId] === undefined ? null : customers[byRun[list[0].runId]], slots = c && c.slots && c.slots.length ? c.slots : null;
      list.forEach(function (x, i) {
        var s = slots ? slots[Math.min(i, slots.length - 1)] : null;
        out[x.id] = { loadNo: i + 1, slot: s ? { routeId: s.routeId, runId: s.runId, route: s.route, run: s.run } : null, overSlots: !!slots && i >= slots.length };
      });
    });
    return (entries || []).map(function (x) { return Object.assign({}, x, out[x.id] || { loadNo: 1, slot: null, overSlots: false }); });
  }

  // Receiving's suppliers, in the order they were added. Joe 10/13: each can be edited or removed (the same record, rewritten).
  function scheduleSuppliers(docs) {
    var all = newestRecords(docs, [SUPPLIER_TYPE]), added = Object.keys(all).map(function (k) { return all[k]; }), list = [];
    added.sort(function (a, b) { return when(a.createdAt || a.recordedAt) - when(b.createdAt || b.recordedAt); });
    added.forEach(function (d) {
      var id = text(d.routeId) || text(d.recordId);
      if (text(d.status).toUpperCase() === 'DELETED' || !id) return;
      list.push({ routeId: id, runId: text(d.runId) || id, route: text(d.route), run: text(d.run), name: text(d.notes) || text(d.run) });
    });
    return list;
  }

  // The plant's holidays (the scheduler's calendar marks them).
  var holidayCache = {};
  function dateKeyOf(d) { return d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate(); }
  function holidays(year) {
    function nth(month, weekday, n) { var d = new Date(year, month, 1), off = (weekday - d.getDay() + 7) % 7; return new Date(year, month, 1 + off + (n - 1) * 7); }
    function last(month, weekday) { var d = new Date(year, month + 1, 0); return new Date(year, month, d.getDate() - ((d.getDay() - weekday + 7) % 7)); }
    var thanks = nth(10, 4, 4), out = {};
    [[new Date(year, 0, 1), "New Year's Day"], [last(4, 1), 'Memorial Day'], [new Date(year, 5, 19), 'Juneteenth'], [new Date(year, 6, 4), 'Independence Day'],
      [nth(8, 1, 1), 'Labor Day'], [thanks, 'Thanksgiving'], [new Date(year, thanks.getMonth(), thanks.getDate() + 1), 'Day after Thanksgiving'],
      [new Date(year, 11, 24), 'Christmas Eve'], [new Date(year, 11, 25), 'Christmas Day'], [new Date(year, 11, 31), "New Year's Eve"]].forEach(function (h) { out[dateKeyOf(h[0])] = h[1]; });
    return out;
  }
  function holidayName(key) {
    var y = Number(String(key).slice(0, 4));
    if (!y) return '';
    return (holidayCache[y] || (holidayCache[y] = holidays(y)))[key] || '';
  }


  /* ---------- Yard Checks ---------- */
  var YARD_LOCK_MINUTES = 120, FUEL_LEVELS = ['FULL', '3/4', '1/2', 'EMPTY'], YARD_ZONE = 'America/New_York', YARD_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  // Trailer numbers as the current app writes them on a yard check (desktopV5069TrailerText_).
  function yardTrailer(v) {
    var t = text(v).toUpperCase(), c = t.replace(/\s+/g, '');
    if (!t) return '';
    if (c === 'N/A' || c === 'NA') return 'N/A';
    if (c === 'TBA') return 'TBA';
    if (/^\d+$/.test(c)) return 'T-' + c;
    var m = c.match(/^T-?(\d+)$/);
    return m ? 'T-' + m[1] : t;
  }
  function dayNum(key) { var p = String(key || '').split('-').map(Number); return p.length === 3 && p.every(isFinite) && p[0] ? Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000) : null; }
  function dayKey(n) { return new Date(n * 86400000).toISOString().slice(0, 10); }
  // The plant's wall clock (New York) as minutes counted from 1/1/1970.
  function wallClock(ms) {
    var parts = {};
    new Intl.DateTimeFormat('en-US', { timeZone: YARD_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ms)).forEach(function (p) { parts[p.type] = p.value; });
    return dayNum(parts.year + '-' + parts.month + '-' + parts.day) * 1440 + Number(parts.hour) * 60 + Number(parts.minute);
  }
  // When a load was marked done, on the plant's wall clock. The app writes UTC stamps; the sheet writes plant time.
  function wallMinutes(v) {
    var s = text(v), m, d, h;
    if (!s) return null;
    if (/(Z|[+-]\d{2}:?\d{2})$/i.test(s) && /\d{4}-\d{2}-\d{2}T/.test(s)) { var t = Date.parse(s); return isFinite(t) ? wallClock(t) : null; }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/);
    if (m) { d = dayNum(m[1] + '-' + m[2] + '-' + m[3]); h = Number(m[4]); return d === null ? null : d * 1440 + h * 60 + Number(m[5]); }
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)?/i);
    if (!m) return null;
    d = dayNum(m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2)); h = Number(m[4]);
    var ap = String(m[6] || '').toUpperCase();
    if (ap) { if (h === 12) h = 0; if (ap === 'PM') h += 12; }
    return d === null ? null : d * 1440 + h * 60 + Number(m[5]);
  }
  function clockMinutes(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return v >= 0 && v < 1 ? Math.round(v * 1440) : v;
    var m = String(v).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)?$/i);
    if (!m) return null;
    var h = Number(m[1]), ap = String(m[3] || '').toUpperCase();
    if (ap) { if (h === 12) h = 0; if (ap === 'PM') h += 12; }
    return h * 60 + Number(m[2]);
  }
  function yardLoaded(day) {
    var loaded = text(day.loadedComplete).toUpperCase();
    return !!text(day.completeTime) || text(day.loadStatus).toUpperCase() === 'COMPLETE' || day.loadedComplete === true || ['TRUE', 'YES', 'Y', '1', 'LOADED', 'COMPLETE'].indexOf(loaded) >= 0;
  }
  // Loaded trailers on the yard for the operating day `date` (udpoV780LoadedTrailerHolds_): every day of the weeks given,
  // loaded, with a load date, a departure (or delivery) date and a trailer, and date between the load and delivery dates.
  function yardHolds(runs, date) {
    var weeks = {}, order = [], out = [];
    (runs || []).forEach(function (r) { var w = text(r.weekStart); if (!weeks[w]) { weeks[w] = []; order.push(w); } weeks[w].push(r); });
    order.sort();
    order.forEach(function (w) {
      var rows = weeks[w].slice().sort(function (a, b) { return (Number(a.sheetRow) || 0) - (Number(b.sheetRow) || 0); });
      YARD_DAYS.forEach(function (p) {
        rows.forEach(function (run) {
          var d = run.days && run.days[p];
          if (!d) return;
          var delivery = text(d.deliveryDate), load = text(d.loadDate), departure = text(d.departureDate) || delivery, trailer = yardTrailer(d.trailer || d.trailerId);
          if (!load || !departure || !trailer || !yardLoaded(d)) return;
          if (date < load || date > (delivery || departure)) return;
          var t = clockMinutes(d.dispatchTime);
          out.push({ runDocId: run.id || '', day: p, trailer: trailer, route: text(run.route), run: text(run.run), routeRun: text(run.run) || text(run.route), loadDate: load,
            departureDate: departure, departureTime: t === null ? clockMinutes(d.startTime) : t, deliveryDate: delivery || departure, completedAt: text(d.completeTime),
            setPoint: '' });
        });
      });
    });
    return out;
  }
  // The trailer left at its dispatch time (trailerHasDeparted, 7.0.276).
  // When a route leaves, on the plant's wall clock (the current app's Send Current Report, 217_V7271): its departure date on the
  // Live sheet (blank = the delivery date) at its dispatch time, never the load day. Saturday's loadout for Monday leaves Monday.
  function departWall(x) {
    var departDay = dayNum(x.departureDate || x.deliveryDate || x.loadDate), t = x.departureTime !== undefined ? x.departureTime : x.dispatchTime;
    if (departDay === null || t === null || t === undefined || t === '' || !isFinite(Number(t))) return null;
    return departDay * 1440 + Number(t);
  }
  function yardDeparted(x, date, nowMs) {
    var departDay = dayNum(x.departureDate), opDay = dayNum(date);
    if (departDay === null) return false;
    if (opDay !== null && departDay < opDay) return true;
    var t = x.departureTime;
    if (t === null || t === undefined || opDay === null) return false;
    var load = dayNum(x.loadDate), done = wallMinutes(x.completedAt), departAt;
    if (done !== null) departAt = Math.ceil((done - 360 - t) / 1440) * 1440 + t;
    // An early load (made days ahead) waits on the yard until the operating day before its departure date.
    if (done === null || departAt < (departDay - 1) * 1440 + 360) departAt = load !== null && load < departDay ? (departDay - 1) * 1440 + t + (t < 360 ? 1440 : 0) : departDay * 1440 + t;
    return wallClock(nowMs) >= departAt;
  }
  function yardChecks(journal, date) {
    var prior = dayKey(dayNum(date) - 1);
    return (journal || []).filter(function (d) { return String(d.type || '').toUpperCase() === 'YARD_CHECK' && (d.date === date || d.date === prior); })
      .sort(function (a, b) { return when(b.recordedAt) - when(a.recordedAt) || (b.createdInApp ? 1 : 0) - (a.createdInApp ? 1 : 0); });
  }
  function yardStatus(d) { return text(payloadOf(d).status || d.status).toUpperCase(); }
  function yardOf(d) { return yardTrailer(payloadOf(d).trailer || d.trailer); }
  // The Active Yard Queue (rows: due now or never checked) and the trailers checked in the last 2 hours (locked).
  // Joe 10/18: gps (gpsReefer by trailer, optional) says when a trailer has left: once the GPS sees this load's trailer out of
  // the yard it is off the list. Only when the trailer has no GPS signal (no unit, or no report in REEFER_SIGNAL_MINUTES) does
  // it go by its dispatch time, as before.
  function yardGone(x, g, date, nowMs) {
    var trip = !!g && text(g.id) === text(x.runDocId) + '|' + text(x.day);
    if (trip && text(g.out)) return true;
    var seen = g ? when(g.seenAt) : 0, signal = trip && !!text(g.unitId) && !!seen && nowMs - seen <= REEFER_SIGNAL_MINUTES * 60000;
    return !signal && yardDeparted(x, date, nowMs);
  }
  function yardQueue(runs, journal, date, nowMs, gps) {
    var checks = yardChecks(journal, date), departed = {}, latest = {};
    checks.forEach(function (e) {
      var k = yardOf(e), p = payloadOf(e);
      if (yardStatus(e) === 'DEPARTED') { if (k) departed[k + '|' + text(p.run || e.run).toUpperCase()] = true; return; }
      if (k && !latest[k]) latest[k] = e;
    });
    var seen = {}, rows = [], locked = [];
    yardHolds(runs, date).forEach(function (x, index) {
      if (yardGone(x, gps && gps[x.trailer], date, nowMs) || seen[x.trailer] || departed[x.trailer + '|' + x.routeRun.toUpperCase()]) return;
      seen[x.trailer] = true;
      var e = latest[x.trailer], p = payloadOf(e), at = e ? when(e.recordedAt) : 0, age = at ? Math.max(0, (nowMs - at) / 60000) : Infinity;
      var item = Object.assign({}, x, { checkId: e ? text(e.recordId) : '', recordedAt: e ? text(e.recordedAt) : '', recordedBy: e ? text(e.recordedBy) : '', temperature: text(p.temperature),
        setPoint: text(p.setPoint) || x.setPoint, fuelLevel: text(p.fuelLevel).toUpperCase(), notes: text(p.notes), minutesSinceCheck: isFinite(age) ? Math.floor(age) : null,
        minutesUntilDue: isFinite(age) && age < YARD_LOCK_MINUTES ? Math.ceil(YARD_LOCK_MINUTES - age) : 0, locked: isFinite(age) && age < YARD_LOCK_MINUTES, index: index });
      (item.locked ? locked : rows).push(item);
    });
    rows.sort(function (a, b) {
      var ta = a.departureTime === null ? 99999 : a.departureTime, tb = b.departureTime === null ? 99999 : b.departureTime;
      return a.departureDate.localeCompare(b.departureDate) || ta - tb || a.index - b.index;
    });
    locked.sort(function (a, b) { return when(b.recordedAt) - when(a.recordedAt); });
    return { rows: rows, locked: locked };
  }
  // Every yard check and Left Yard of the last 24 hours, newest first.
  function yardHistory(journal, date, nowMs) {
    return yardChecks(journal, date).filter(function (e) { var t = when(e.recordedAt); return !t || t >= nowMs - 86400000; }).map(function (e) {
      var p = payloadOf(e);
      return { recordId: text(e.recordId), recordedAt: text(e.recordedAt), trailer: yardOf(e), temperature: text(p.temperature), setPoint: text(p.setPoint), fuelLevel: text(p.fuelLevel).toUpperCase(),
        notes: text(p.notes), status: yardStatus(e) || 'RECORDED', recordedBy: text(e.recordedBy), inApp: !!e.createdInApp };
    });
  }
  // Joe 10/18: the trailer's temperature from the GPS (Verizon Fleet, gpsReefer/<trailer>, read every 5 minutes from the time
  // the load is complete until the trailer is back in the yard), beside the yard check's typed temperature, set point and fuel.
  // Red when it is more than REEFER_OFF_BY degrees from the set point; a reading older than REEFER_STALE_MINUTES is shown as old.
  var REEFER_OFF_BY = 5, REEFER_STALE_MINUTES = 60, REEFER_STOP_MINUTES = 5, REEFER_SIGNAL_MINUTES = 60;
  function yardGps(r, setPoint, nowMs) {
    if (!r || r.tempF === null || r.tempF === undefined || r.tempF === '') return { has: false, recording: !!(r && r.recording), noUnit: !!(r && r.recording && !r.unitId) };
    var t = Number(r.tempF), at = when(r.readingAt), age = at ? Math.max(0, Math.round((nowMs - at) / 60000)) : null, sp = text(setPoint), off = null;
    if (sp !== '' && isFinite(Number(sp))) off = Math.round((t - Number(sp)) * 10) / 10;
    return { has: true, tempF: t, readingAt: text(r.readingAt), minutesOld: age,
      stale: age !== null && age > REEFER_STALE_MINUTES, off: off, flag: off !== null && Math.abs(off) > REEFER_OFF_BY, recording: !!r.recording };
  }
  // Joe 10/18: once a loaded trailer has left the yard it keeps reporting until it is back: "Moving" while it moves, and
  // where it stopped (the Fleet place name, such as a store, or else the address) once it has stood still REEFER_STOP_MINUTES.
  // A short stop (a light, a turn) still reads Moving. null for a trailer that is not out on a GPS trip.
  function yardOut(r, nowMs) {
    if (!r || !r.recording || !r.out) return null;
    var still = when(r.stillSince), mins = still ? Math.max(0, Math.round((nowMs - still) / 60000)) : 0;
    var known = r.speedMph !== null && r.speedMph !== undefined && r.speedMph !== '';
    var stopped = !!still && mins >= REEFER_STOP_MINUTES;
    return { moving: known && !stopped, stopped: stopped, unknown: !known && !still, where: text(r.where), stopMinutes: stopped ? mins : 0,
      since: stopped ? text(r.stillSince) : '', text: stopped ? 'Stopped at ' + (text(r.where) || 'an unknown place') : known || still ? 'Moving' : 'Out of the yard' };
  }
  // Minutes until a trailer can be checked again (the save's own check: that operating day's newest record of the trailer).
  function yardLockLeft(journal, date, trailer, nowMs) {
    var k = yardTrailer(trailer), last = (journal || []).filter(function (d) { return String(d.type || '').toUpperCase() === 'YARD_CHECK' && d.date === date && yardOf(d) === k; })
      .sort(function (a, b) { return when(b.recordedAt) - when(a.recordedAt); })[0];
    if (!last || !when(last.recordedAt)) return 0;
    var age = Math.max(0, (nowMs - when(last.recordedAt)) / 60000);
    return age < YARD_LOCK_MINUTES ? Math.ceil(YARD_LOCK_MINUTES - age) : 0;
  }


  /* ---------- Production Line Status & Quality ---------- */
  var QUALITY_TYPE = 'PRODUCTION_QUALITY', LINE_STATUSES = ['RUNNING', 'REVIEW', 'CHANGEOVER', 'DOWN', 'FINISHED'];
  function lineKey(v) { return text(v).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function qualitySkip(line) {
    var k = lineKey(line);
    if (k === 'BOXING') return { cycle: true };
    // Joe 10/10: Totes have no tip test.
    if (k === 'TOTES') return { cycle: true, weight: true, tip: true };
    if (k === 'RAYPAK') return { cycle: true, weight: true };
    if (k === 'HTST1' || k === 'HTST2') return { cycle: true, weight: true, tip: true };
    return {};
  }
  function isBlowMold(line) { return lineKey(line) === 'BLOWMOLD'; }
  // HTST #1 and #2 (the pasteurizers) also record Changeover as their status and the Remaining output of the run (old Plant.html 1057-1063).
  function isHtst(line) { var k = lineKey(line); return k === 'HTST1' || k === 'HTST2'; }
  // The active production lines of the plant (setup = plantSetup docs), in view order.
  function productionLines(setup) {
    return (setup || []).filter(function (d) { return text(d.type).toUpperCase() === 'PRODUCTION_AREA' && text(d.status).toUpperCase() === 'ACTIVE'; })
      .map(function (d) { return { operationId: text(d.operationId), name: text(d.name) || text(d.area), viewSequence: Number(d.viewSequence) || 0 }; })
      .sort(function (a, b) { return a.viewSequence - b.viewSequence || a.name.localeCompare(b.name); });
  }
  // Every quality check: the app's records (plantJournal PRODUCTION_QUALITY) and each line's last check on the sheet (PLANT LINE STATUS).
  function qualityChecks(journal, lineStatus) {
    var out = [];
    (lineStatus || []).forEach(function (d) {
      var p = payloadOf(d);
      out.push(Object.assign({}, p, { operationId: text(d.operationId || p.operationId), area: text(p.area || d.area), status: text(p.status || d.status).toUpperCase(),
        recordedAt: text(d.updatedAt), recordedBy: text(d.updatedBy), fromSheet: true }));
    });
    (journal || []).forEach(function (d) {
      if (text(d.type).toUpperCase() !== QUALITY_TYPE) return;
      var p = payloadOf(d);
      if (p.undone) return; // a Run Complete pressed by mistake and undone

      out.push(Object.assign({}, p, { operationId: text(p.operationId), area: text(p.area), status: text(p.status).toUpperCase(), recordedAt: text(d.recordedAt), recordedBy: text(d.recordedBy), inApp: true, docId: text(d._id) }));
    });
    return out.sort(function (a, b) { return when(b.recordedAt) - when(a.recordedAt); });
  }
  // Joe 10/14 (Run Complete, A): a line whose last check is Finished is done; Start Next Run opens it again.
  // Joe 10/15: a run finished tonight stays Run Complete, with its time and its checks, until 6 a.m. when the next day starts
  // (it no longer clears at the shift change), so nobody has to type it back in without knowing when the line shut down.
  function opDayAt(ms) { return Math.floor((wallClock(ms) - 360) / 1440); }
  function lineDone(last, nowMs) {
    var t = when((last || {}).recordedAt);
    return !!t && text(last.status).toUpperCase() === 'FINISHED' && t <= nowMs + 60000 && opDayAt(t) === opDayAt(nowMs);
  }
  // Each line with its last check and the number of checks in the last 24 hours.
  function qualityLines(setup, journal, lineStatus, nowMs) {
    var checks = qualityChecks(journal, lineStatus);
    return productionLines(setup).map(function (l) {
      var mine = checks.filter(function (c) { return c.operationId === l.operationId; }), last = mine[0] || {};
      return Object.assign({}, l, { last: last, today: mine.filter(function (c) { return when(c.recordedAt) >= nowMs - 86400000; }).length });
    });
  }
  function qualityHistory(journal, lineStatus, nowMs) {
    return qualityChecks(journal, lineStatus).filter(function (c) { var t = when(c.recordedAt); return t && t >= nowMs - 86400000; });
  }
  // What a weight reads as on the history: "3990, 3992" or the six blow mold heads.
  function weightText(w) {
    w = w || {};
    if (w.result !== undefined) return text(w.result);
    return [1, 2, 3, 4, 5, 6].map(function (n) { return text(w['head' + n]); }).some(Boolean) ? [1, 2, 3, 4, 5, 6].map(function (n) { return 'H' + n + ' ' + (text(w['head' + n]) || '—'); }).join(' · ') : '';
  }


  /* ---------- Shift Notes ---------- */
  var SHIFT_TYPE = 'SHIFT_REPORT', SHIFTS = ['FIRST SHIFT', 'SECOND SHIFT', 'THIRD SHIFT'], ENTRY_TYPES = ['Breakdown', 'Maintenance Request', 'Incident', 'Safety', 'Quality', 'Handoff', 'Other'],
    FOLLOW_UPS = ['OPEN', 'MONITOR', 'RESOLVED'];
  // Joe 10/12: a big breakdown is fixed on the spot (maintenance called in person) and only recorded: the machine, when it went down
  // (the entry's time), when it was back up and what fixed it. An issue that can wait is a Maintenance Request, which goes on
  // maintenance's list; how long it can wait is one of URGENCIES.
  var URGENCIES = ['This shift', 'This week', 'When you can'];
  function shiftAt(ms) { var h = Math.floor(((wallClock(ms) % 1440) + 1440) % 1440 / 60); return h >= 6 && h <= 14 ? 'FIRST SHIFT' : h >= 15 ? 'SECOND SHIFT' : 'THIRD SHIFT'; }
  function followLabel(v) { v = text(v).toUpperCase() || 'OPEN'; return v === 'RESOLVED' ? 'Resolved' : v === 'MONITOR' ? 'Monitor' : 'Needs attention'; }
  // One shift report record, whether the sheet's journal wrote it or the app did.
  function shiftRecord(d) {
    var p = payloadOf(d), v = p.values || {};
    return { entryId: text(p.entryId || d.recordId), section: text(p.section || d.area).toUpperCase(), shift: text(p.shift || d.shift).toUpperCase(), readingTime: text(p.readingTime),
      type: text(v.Type), equipment: text(v.Equipment), entry: text(v.Entry), parentId: text(v.ParentId), notes: text(p.notes !== undefined ? p.notes : d.notes),
      followUpStatus: text(p.followUpStatus || 'OPEN').toUpperCase(), recordedAt: text(d.recordedAt), recordedBy: text(d.recordedBy), inApp: !!d.createdInApp,
      upAt: text(v.UpAt), fix: text(v.Fix), urgency: text(v.Urgency), editedAt: text(d.editedAt) };
  }
  // A breakdown's down span on the plant's wall clock: {start, end, open} in minutes, or null without a down time. It went down
  // at its down time (the entry's time) on the day it was recorded, or the day before when that time is more than an hour after
  // it was recorded (logged after midnight). It is down until back up (same day, or the next if earlier); Joe 10/18: marked
  // Resolved with no back up time, it stops at the time it was marked resolved instead of counting on; otherwise until nowMs.
  function minutesOfDay(hhmm) { var m = /^(\d{1,2}):(\d\d)$/.exec(text(hhmm)); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
  function downSpan(r, nowMs) {
    var down = minutesOfDay(r && r.readingTime);
    if (down === null) return null;
    var at = when(r.recordedAt);
    if (!at && !nowMs) return null;
    var atWall = wallClock(at || nowMs), start = atWall - atWall % 1440 + down;
    if (start > atWall + 60) start -= 1440;
    var up = minutesOfDay(r.upAt);
    if (up !== null) return { start: start, end: start + (up - down + 1440) % 1440, open: false };
    if (text(r.status || r.followUpStatus).toUpperCase() === 'RESOLVED') {
      var fixed = when(r.resolvedAt || r.editedAt || r.recordedAt);
      return fixed ? { start: start, end: Math.max(start, wallClock(fixed)), open: false, noUpTime: true } : null;
    }
    return nowMs ? { start: start, end: Math.max(start, wallClock(nowMs)), open: true } : null;
  }
  // Minutes a breakdown was down (or has been so far). null without a down time.
  function downMinutes(r, nowMs) { var s = downSpan(r, nowMs); return s ? s.end - s.start : null; }
  // The minutes of it in today's plant day (from 6 a.m., when the day rolls, to nowMs).
  function downToday(r, nowMs) {
    var s = downSpan(r, nowMs);
    if (!s || !nowMs) return 0;
    var from = opDayAt(nowMs) * 1440 + 360, to = wallClock(nowMs);
    return Math.max(0, Math.min(s.end, to) - Math.max(s.start, from));
  }
  // The log of the last 24 hours, newest first; each entry with its reviews (oldest first) and its status now.
  // hours: how far back (24 by default); Shift Notes and the report look back further for open items carried over.
  function shiftLog(journal, nowMs, hours) {
    var back = (hours || 24) * 3600000;
    var all = (journal || []).filter(function (d) { return text(d.type).toUpperCase() === SHIFT_TYPE; }).map(shiftRecord)
      .filter(function (r) { return !r.section || r.section === 'HANDOFF'; })
      .filter(function (r) { var t = when(r.recordedAt); return !t || t >= nowMs - back; })
      .sort(function (a, b) { return when(b.recordedAt) - when(a.recordedAt); });
    var ids = {}, kids = {}, parents = [];
    all.forEach(function (r) { if (r.entryId) ids[r.entryId] = true; });
    all.forEach(function (r) { if (r.parentId && ids[r.parentId]) (kids[r.parentId] = kids[r.parentId] || []).push(r); else parents.push(r); });
    return parents.map(function (r) {
      var reviews = (kids[r.entryId] || []).slice().reverse();
      // A review that says when the machine was back up (and what fixed it) closes the breakdown's down time.
      var up = reviews.filter(function (x) { return x.upAt; }).pop(), last = reviews.length ? reviews[reviews.length - 1] : r;
      // When it was marked Resolved: by the last review that resolved it, else the entry's own last save.
      var done = reviews.filter(function (x) { return x.followUpStatus === 'RESOLVED'; }).pop();
      var resolvedAt = last.followUpStatus !== 'RESOLVED' ? '' : done ? done.recordedAt : (r.editedAt || r.recordedAt);
      return Object.assign({}, r, { reviews: reviews, status: last.followUpStatus, upAt: up ? up.upAt : r.upAt, fix: up && up.fix ? up.fix : r.fix, resolvedAt: resolvedAt });
    });
  }

  // Shift Notes option A (Joe 10/10) in the report: open breakdowns every time until resolved (carried over when logged before
  // the last report), the breakdowns fixed since the last report, the shift handoff and the other entries since then.
  var OTHER_TYPES = ['MAINTENANCE REQUEST', 'INCIDENT', 'SAFETY', 'QUALITY', 'OTHER'];
  function shiftReport(log, roundStart) {
    var since = when(roundStart) || 0, fresh = function (at) { return !since || when(at) > since; };
    var kind = function (r) { return text(r.type).toUpperCase(); };
    var lastReview = function (r) { var v = r.reviews || []; return v.length ? v[v.length - 1] : null; };
    var item = function (r) { var rv = lastReview(r); return { equipment: r.equipment, type: r.type, entry: r.entry, notes: r.notes, shift: r.shift, status: r.status || 'OPEN', at: r.recordedAt ? clockOf(r.recordedAt) : '',
      carried: !fresh(r.recordedAt), review: rv ? rv.entry : '', reviewAt: rv && rv.recordedAt ? clockOf(rv.recordedAt) : '' }; };
    var all = log || [];
    return {
      down: all.filter(function (r) { return kind(r) === 'BREAKDOWN' && r.status !== 'RESOLVED'; }).map(item),
      fixed: all.filter(function (r) { var rv = lastReview(r); return kind(r) === 'BREAKDOWN' && r.status === 'RESOLVED' && fresh(rv ? rv.recordedAt : r.recordedAt); }).map(item),
      handoff: all.filter(function (r) { return kind(r) === 'HANDOFF' && fresh(r.recordedAt); }).map(item),
      others: all.filter(function (r) { return OTHER_TYPES.indexOf(kind(r)) >= 0 && fresh(r.recordedAt); }).map(item)
    };
  }

  /* ---------- Cooler Temperatures ---------- */
  var TEMP_TYPE = 'PLANT_TEMPERATURE_CHECK', TEMP_LOCK_MINUTES = 120;
  function limit(v) { return v === '' || v === null || v === undefined || !isFinite(Number(v)) ? '' : Number(v); }
  function tempLocations(setup) {
    return (setup || []).filter(function (r) { return r.type === 'TEMPERATURE_CHECK_LOCATION' && (r.status || 'ACTIVE') === 'ACTIVE'; }).map(function (r) {
      var s = r.settings || {};
      return { locationId: r.operationId, location: text(r.name), area: text(s.area), viewSequence: Number(r.viewSequence) || 999999, sensorId: text(s.sensorId || s.mocreoSensorId), sensorName: text(s.sensorName),
        lowLimit: limit(s.lowLimit), highLimit: limit(s.highLimit), staleMinutes: Number(s.staleMinutes) || 30 };
    }).sort(function (a, b) { return a.viewSequence - b.viewSequence || a.location.localeCompare(b.location); });
  }
  // Joe 10/10: the thermometer locations are changed in Administration > MOCREO & Sensors (tempLocations/*). A change there
  // replaces the sheet's row for that location; a location added there is added; one removed or turned off is left out.
  function withTempLocations(setup, appLocs) {
    var mine = {};
    (appLocs || []).forEach(function (a) { if (a && a.locationId) mine[tempKey(a.locationId)] = a; });
    var row = function (a, base) {
      var b = base || { type: 'TEMPERATURE_CHECK_LOCATION', operationId: a.locationId, settings: {} }, s = Object.assign({}, b.settings || {});
      ['sensorId', 'sensorName', 'area', 'lowLimit', 'highLimit'].forEach(function (k) { if (a[k] !== undefined) s[k] = a[k]; });
      return Object.assign({}, b, { type: 'TEMPERATURE_CHECK_LOCATION', operationId: b.operationId || a.locationId, name: a.location !== undefined ? a.location : b.name,
        viewSequence: a.viewSequence !== undefined ? a.viewSequence : b.viewSequence, removed: !!a.removed, status: a.removed || a.active === false ? 'INACTIVE' : a.active === true ? 'ACTIVE' : (b.status || 'ACTIVE'), settings: s });
    };
    var seen = {}, out = (setup || []).map(function (r) {
      if (r.type !== 'TEMPERATURE_CHECK_LOCATION') return r;
      var a = mine[tempKey(r.operationId)];
      if (!a) return r;
      seen[tempKey(r.operationId)] = true;
      return row(a, r);
    });
    Object.keys(mine).forEach(function (k) { if (!seen[k]) out.push(row(mine[k], null)); });
    return out;
  }
  function tempStatus(loc, reading) {
    var t = Number(reading);
    if (!isFinite(t)) return '';
    return loc.highLimit !== '' && t > loc.highLimit ? 'HIGH' : loc.lowLimit !== '' && t < loc.lowLimit ? 'LOW' : 'RECORDED';
  }
  function tempReadings(journal) {
    return (journal || []).filter(function (d) { return text(d.type).toUpperCase() === TEMP_TYPE; }).map(function (d) {
      var p = payloadOf(d);
      return { recordId: text(d.recordId), locationId: text(p.locationId), location: text(p.location), manualTemperature: p.manualTemperature === undefined || p.manualTemperature === null ? '' : p.manualTemperature,
        sensorTemperature: p.sensorTemperature === undefined || p.sensorTemperature === null ? '' : p.sensorTemperature, batteryLevel: p.batteryLevel === undefined || p.batteryLevel === null ? '' : p.batteryLevel,
        status: text(p.status || d.status).toUpperCase(), notes: text(p.notes !== undefined ? p.notes : d.notes), recordedAt: text(d.recordedAt), recordedBy: text(d.recordedBy), docId: text(d._id) };
    }).sort(function (a, b) { return when(b.recordedAt) - when(a.recordedAt); });
  }
  function tempKey(v) { return text(v).toUpperCase(); }
  // Minutes left on a location's 2-hour lock (0 = it can be read again).
  function tempLockLeft(journal, loc, nowMs) {
    var last = tempReadings(journal).filter(function (r) { return r.manualTemperature !== '' && (tempKey(r.locationId) === tempKey(loc.locationId) || (!r.locationId && tempKey(r.location) === tempKey(loc.location))); })[0];
    if (!last) return 0;
    var age = (nowMs - when(last.recordedAt)) / 60000;
    return age < TEMP_LOCK_MINUTES ? Math.ceil(TEMP_LOCK_MINUTES - age) : 0;
  }
  // A location's MOCREO sensor (sensors/*, read by the server): its sensor ID, else a sensor with exactly the location's name,
  // as the current app; never a guess.
  function nameKey(v) { return text(v).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim(); }
  function sensorFor(loc, sensors) {
    var list = sensors || [], id = tempKey(loc.sensorId);
    return (id && list.filter(function (s) { return tempKey(s.sensorId) === id; })[0]) || list.filter(function (s) { return nameKey(s.name) && nameKey(s.name) === nameKey(loc.location); })[0] || null;
  }
  function sensorStatus(s, loc, nowMs) {
    if (s.error) return 'SENSOR ERROR';
    if (s.returned === false || s.online === false) return 'OFFLINE';
    var t = s.lastReadingAt ? when(s.lastReadingAt) : 0;
    if (t && (nowMs - t) / 60000 > (loc.staleMinutes || 30)) return 'STALE';
    var f = s.temperatureF;
    if (f === null || f === undefined || !isFinite(Number(f))) return 'SENSOR ERROR';
    return loc.highLimit !== '' && Number(f) > loc.highLimit ? 'HIGH' : loc.lowLimit !== '' && Number(f) < loc.lowLimit ? 'LOW' : 'IN RANGE';
  }
  // Joe 10/17: "I named the sensors ... on the MOCREO website and we need to match them up." The words that tell one place from
  // another, so "Main North" goes with "Cooler North" and "Main Center" with "Cooler Middle".
  var NAME_FILLER = { MAIN: 1, COOLER: 1, SENSOR: 1, TEMP: 1, TEMPERATURE: 1, HUMIDITY: 1, THE: 1, AREA: 1, ROOM: 1 };
  function placeWords(v) {
    return nameKey(v).split(' ').filter(function (w) { return w && !NAME_FILLER[w]; }).map(function (w) { return w === 'CENTER' || w === 'CENTRE' ? 'MIDDLE' : w.replace(/S$/, ''); }).sort();
  }
  function sameWords(a, b) { return a.length > 0 && a.length === b.length && a.every(function (w, i) { return w === b[i]; }); }
  function someWords(a, b) { return a.length > 0 && a.every(function (w) { return b.indexOf(w) >= 0; }); }
  // Each thermometer paired with the MOCREO sensor named for the same place: the same words first, then (only when there is
  // exactly one either way) one name's words all inside the other's. locations = tempLocations() rows (with active),
  // sensors = sensors/*. Returns {changes: [{locationId, location, from, fromName, to, toName, why}], unmatched sensors}.
  // A thermometer with no match keeps its sensor when that sensor's name fits no other place, else goes to Manual only.
  function matchSensors(locations, sensors) {
    var locs = (locations || []).filter(function (l) { return l && l.locationId; }), list = (sensors || []).filter(function (x) { return x && x.sensorId && x.returned !== false; });
    var words = {}, pick = {}, taken = {};
    list.forEach(function (x) { words[x.sensorId] = placeWords(x.name); });
    locs.forEach(function (l) {
      var w = placeWords(l.location), same = list.filter(function (x) { return !taken[x.sensorId] && sameWords(words[x.sensorId], w); });
      if (same.length === 1) { pick[l.locationId] = same[0]; taken[same[0].sensorId] = true; }
    });
    locs.forEach(function (l) {
      if (pick[l.locationId]) return;
      var w = placeWords(l.location), near = list.filter(function (x) { return !taken[x.sensorId] && (someWords(words[x.sensorId], w) || someWords(w, words[x.sensorId])); });
      if (near.length !== 1) return;
      var x = near[0], rivals = locs.filter(function (o) { return !pick[o.locationId] && o !== l; }).filter(function (o) { var ow = placeWords(o.location); return someWords(words[x.sensorId], ow) || someWords(ow, words[x.sensorId]); });
      if (rivals.length) return;
      pick[l.locationId] = x; taken[x.sensorId] = true;
    });
    var byId = {};
    list.forEach(function (x) { byId[tempKey(x.sensorId)] = x; });
    var changes = [];
    locs.forEach(function (l) {
      var cur = byId[tempKey(l.sensorId)] || null, to = pick[l.locationId] || null, why = 'matched';
      if (!to) {
        // No match: its sensor stays unless another thermometer took it or its MOCREO name is for somewhere else.
        if (!cur) return;
        var w = placeWords(l.location), cw = words[cur.sensorId];
        if (!taken[cur.sensorId] && (!cw.length || someWords(cw, w) || someWords(w, cw))) return;
        why = 'pick';
      }
      var toId = to ? text(to.sensorId) : '';
      if (tempKey(toId) === tempKey(l.sensorId)) return;
      changes.push({ locationId: l.locationId, location: l.location, from: text(l.sensorId), fromName: cur ? text(cur.name) : '', to: toId, toName: to ? text(to.name) : '', why: why });
    });
    var used = {};
    locs.forEach(function (l) { var c = changes.filter(function (x) { return x.locationId === l.locationId; })[0]; var id = c ? c.to : l.sensorId; if (id) used[tempKey(id)] = true; });
    return { changes: changes, unmatched: list.filter(function (x) { return !used[tempKey(x.sensorId)]; }).map(function (x) { return { sensorId: text(x.sensorId), name: text(x.name) }; }) };
  }
  // The Current table: one row per location with its sensor (when MOCREO is connected), its last manual reading and lock.
  function tempRows(setup, journal, nowMs, sensors) {
    var readings = tempReadings(journal);
    return tempLocations(setup).map(function (loc) {
      var last = readings.filter(function (r) { return r.manualTemperature !== '' && (tempKey(r.locationId) === tempKey(loc.locationId) || (!r.locationId && tempKey(r.location) === tempKey(loc.location))); })[0] || null;
      var left = tempLockLeft(journal, loc, nowMs), s = sensorFor(loc, sensors);
      var sensor = s ? { sensorId: loc.sensorId || text(s.sensorId), sensorName: loc.sensorName || text(s.name), sensorTemp: s.temperatureF === null || s.temperatureF === undefined ? '' : s.temperatureF,
        batteryLevel: s.batteryLevel === null || s.batteryLevel === undefined ? '' : s.batteryLevel, sensorLastReadingAt: text(s.lastReadingAt), status: sensorStatus(s, loc, nowMs) }
        : { sensorTemp: '', batteryLevel: '', sensorLastReadingAt: '', status: 'MANUAL ONLY' };
      return Object.assign({}, loc, sensor, { lastCheckedAt: last ? last.recordedAt : '', lastCheckedBy: last ? last.recordedBy : '',
        lastManualTemperature: last ? last.manualTemperature : '', lastStatus: last ? last.status : '', lastNotes: last ? last.notes : '', lastDocId: last ? last.docId : '', locked: left > 0, minutesUntilDue: left });
    });
  }
  // Joe 10/19: a location whose sensor reads in range needs no manual check; it counts as checked by the sensor. Low, High,
  // Offline, Stale and Manual only locations stay due until someone enters a manual reading (which locks it for 2 hours).
  function tempChecked(r) { return !!(r && (r.locked || r.status === 'IN RANGE')); }
  function tempHistory(journal, nowMs) {
    return tempReadings(journal).filter(function (r) { var t = when(r.recordedAt); return !t || t >= nowMs - 86400000; });
  }

  /* ---------- Manager Center ---------- */
  function weekOf(key) { var n = dayNum(key); if (n === null) return null; var start = n - ((n + 4) % 7); return { start: dayKey(start), end: dayKey(start + 6) }; }
  function managerSchedule(entries, date) {
    var wk = weekOf(date), month = String(date).slice(0, 7), list = (entries || []).filter(function (e) { return e.status !== 'DELETED'; });
    var today = list.filter(function (e) { return e.date === date; }), times = today.map(function (e) { return e.pickupTime; }).filter(Boolean).sort();
    return { month: list.filter(function (e) { return String(e.date).slice(0, 7) === month; }).length, monthKey: month,
      week: wk ? list.filter(function (e) { return e.date >= wk.start && e.date <= wk.end; }).length : 0, today: today.length, next: times[0] || '',
      needTrailer: wk ? list.filter(function (e) { return e.date >= date && e.date <= wk.end && e.scheduleType !== 'CARRIER' && !text(e.trailer); }).length : 0 };
  }
  function managerQuality(lines, history) {
    var tips = (history || []).filter(function (h) { return text(h.tipTest) !== ''; });
    var weighed = (history || []).filter(function (h) { var w = h.weights || {}; return Object.keys(w).some(function (k) { return text(w[k]) !== ''; }); })[0];
    return { lines: (lines || []).length, down: (lines || []).filter(function (l) { var x = l.last || {}; return text(x.status).toUpperCase() === 'DOWN' || text(x.qualityCheck).toUpperCase() === 'FAIL'; }).length,
      tipTests: tips.length, tipFails: tips.filter(function (h) { return /^(FAIL|REVIEW)$/i.test(text(h.tipTest)); }).length, lastWeight: weighed ? weighed.recordedAt : '', history: (history || []).length };
  }
  function tempAlert(r) { return ['HIGH', 'LOW', 'STALE', 'SENSOR ERROR'].indexOf(r.status) >= 0 || r.lastStatus === 'HIGH' || r.lastStatus === 'LOW'; }
  function managerTemps(rows, history) {
    var last = (rows || []).map(function (r) { return r.lastCheckedAt; }).filter(Boolean).sort().pop() || '';
    return { sensors: (rows || []).filter(function (r) { return r.sensorId; }).length, offline: (rows || []).filter(function (r) { return r.status === 'OFFLINE'; }).length,
      alerts: (rows || []).filter(tempAlert).length, lastManual: last, history: (history || []).length };
  }
  // Joe 10/15 (Manager Walkthrough, option 2): what the manager's walk still has to check, in walking order: Yard, Coolers,
  // Production (the production line checks). Joe 10/15 (later): each area also lists what is in it, problems first
  // (items: name, detail, kind bad / warn / ok). yard = yardQueue(), temps = tempRows(), lines = qualityLines().
  // Joe 10/18: every area is checked every 2 to 3 hours: green when done, yellow (due) from 2 hours, red (past due) from 3 hours.
  // Production needs no check when no line is running (every line finished today, or not started today) and the Yard none
  // when there are no trucks on it: those read done automatically. Each area shows who did its newest check and when.
  var WALK_LATE_MINUTES = 60, WALK_CYCLE_MINUTES = 120;
  function managerWalk(yard, temps, lines, nowMs) {
    var cycle = WALK_CYCLE_MINUTES, late = function (at) { var t = when(at); return !t || (nowMs - t) / 60000 >= cycle + WALK_LATE_MINUTES; };
    var last = function (at) { return when(at) ? 'last ' + clockOf(at) : 'never checked'; };
    var rank = { bad: 0, warn: 1, ok: 2 }, sorted = function (a) { return a.map(function (x, i) { return [x, i]; }).sort(function (p, q) { return rank[p[0].kind] - rank[q[0].kind] || p[1] - q[1]; }).map(function (p) { return p[0]; }); };
    var newest = function (list) { return list.filter(function (c) { return when(c.at); }).sort(function (a, b) { return when(b.at) - when(a.at); })[0] || null; };
    var yardDue = ((yard || {}).rows || []), yardDone = ((yard || {}).locked || []), tempDue = (temps || []).filter(function (r) { return !tempChecked(r); });
    // A line is running when it has a check today that is not Finished.
    var running = function (l) { var x = l.last || {}, t = when(x.recordedAt); return !!t && !lineDone(x, nowMs) && opDayAt(t) === opDayAt(nowMs); };
    var isDue = function (l) { var x = l.last || {}, t = when(x.recordedAt); return running(l) && (!t || (nowMs - t) / 60000 >= cycle); };
    var lineDue = (lines || []).filter(isDue);
    var yardChecks = yardDue.concat(yardDone).filter(function (x) { return x.recordedAt; }).map(function (x) { return { at: x.recordedAt, by: x.recordedBy }; });
    var tempChecks = (temps || []).filter(function (r) { return r.lastCheckedAt; }).map(function (r) { return { at: r.lastCheckedAt, by: r.lastCheckedBy }; });
    var lineChecks = (lines || []).filter(function (l) { var x = l.last || {}; return x.recordedAt && x.inApp; }).map(function (l) { return { at: l.last.recordedAt, by: l.last.recordedBy }; });
    var route = function (x) { return x.route ? 'Route ' + x.route : text(x.routeRun); };
    var yardItems = yardDue.map(function (x) { var l = late(x.recordedAt); return { name: 'Trailer ' + x.trailer, detail: [route(x), l ? 'PAST DUE' : 'DUE', last(x.recordedAt)].filter(Boolean).join(' · '), kind: l ? 'bad' : 'warn' }; })
      .concat(yardDone.map(function (x) { return { name: 'Trailer ' + x.trailer, detail: [route(x), (x.temperature !== '' ? x.temperature + '°F · ' : '') + 'checked ' + clockOf(x.recordedAt)].filter(Boolean).join(' · '), kind: 'ok' }; }));
    var coolerItems = (temps || []).map(function (r) {
      var reading = r.sensorTemp !== '' && r.sensorTemp !== undefined ? r.sensorTemp : r.lastManualTemperature, read = reading !== '' && reading !== undefined && reading !== null ? reading + '°F' : '';
      var sensorBad = ['HIGH', 'LOW', 'OFFLINE', 'STALE', 'SENSOR ERROR'].indexOf(r.status) >= 0, manualBad = r.lastStatus === 'HIGH' || r.lastStatus === 'LOW';
      var word = sensorBad ? r.status : manualBad ? r.lastStatus : !tempChecked(r) ? (late(r.lastCheckedAt) ? 'PAST DUE' : 'DUE') : 'OK';
      return { name: r.location, detail: [read, word].filter(Boolean).join(' · '), kind: sensorBad || manualBad || word === 'PAST DUE' ? 'bad' : word === 'DUE' ? 'warn' : 'ok' };
    });
    var qualityItems = (lines || []).map(function (l) {
      var x = l.last || {}, st = text(x.status).toUpperCase();
      if (lineDone(x, nowMs)) return { name: l.name, detail: 'RUN COMPLETE', kind: 'ok' };
      if (!running(l)) return { name: l.name, detail: 'NOT RUNNING', kind: 'ok' };
      var down = st === 'DOWN' || text(x.qualityCheck).toUpperCase() === 'FAIL';
      if (isDue(l)) { var lt = late(x.recordedAt); return { name: l.name, detail: (down ? 'DOWN · ' : '') + (lt ? 'PAST DUE' : 'DUE') + ' · ' + last(x.recordedAt), kind: lt || down ? 'bad' : 'warn' }; }
      return { name: l.name, detail: (down ? 'DOWN' : 'OK') + ' · checked ' + clockOf(x.recordedAt), kind: down ? 'bad' : 'ok' };
    });
    var area = function (o, checks, auto) {
      o.state = o.late ? 'late' : o.due ? 'due' : 'ok';
      o.auto = o.state === 'ok' ? auto || '' : '';
      o.lastCheck = newest(checks);
      return o;
    };
    var lateYard = yardDue.filter(function (x) { return late(x.recordedAt); }).length, lateLines = lineDue.filter(function (l) { return late((l.last || {}).recordedAt); }).length;
    return {
      yard: area({ due: yardDue.length, late: lateYard, total: yardDue.length + yardDone.length, items: sorted(yardItems) }, yardChecks, yardDue.length + yardDone.length ? '' : 'No trucks in the yard'),
      coolers: area({ due: tempDue.length, late: tempDue.filter(function (r) { return late(r.lastCheckedAt); }).length, out: (temps || []).filter(tempAlert).length, total: (temps || []).length, items: sorted(coolerItems) }, tempChecks, ''),
      quality: area({ due: lineDue.length, late: lateLines, total: (lines || []).length, running: (lines || []).filter(running).length, items: sorted(qualityItems) }, lineChecks,
        (lines || []).some(running) ? '' : (lines || []).some(function (l) { return lineDone(l.last, nowMs); }) ? 'Production finished' : 'No lines running'),
      last: newest(yardChecks.concat(tempChecks, lineChecks)) };
  }
  function managerNotes(log) {
    var type = function (r) { return text(r.type).toUpperCase(); };
    return { handoff: (log || []).filter(function (r) { return type(r) === 'HANDOFF'; }).length, issues: (log || []).filter(function (r) { return type(r) !== 'HANDOFF'; }).length,
      open: (log || []).filter(function (r) { return r.status !== 'RESOLVED'; }).length, history: (log || []).length };
  }

  /* ---------- Send Current Report ---------- */
  var REPORT_BEHIND = 45, REPORT_AREAS = ['CASE', 'TOTES', 'BOXING', 'TANKER'];
  function zoned(ms, opts) { return new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: YARD_ZONE }, opts)).format(new Date(ms)); }
  function clockOf(v) { var t = typeof v === 'number' ? v : Date.parse(v || ''); return isFinite(t) && t ? zoned(t, { hour: 'numeric', minute: '2-digit' }) : text(v); }
  function minutesText12(m) { if (m === null || m === undefined || m === '') return ''; var h = Math.floor(m / 60) % 24, mm = m % 60; return (h % 12 || 12) + ':' + (mm < 10 ? '0' : '') + mm + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function lateText(minutes) { var m = Math.abs(minutes), h = Math.floor(m / 60), t = h ? h + ' h ' + (m % 60) + ' min' : m + ' min'; return minutes <= 0 ? t + ' late' : 'departs in ' + t; }
  function statusWord(s) { return s === 'WAITING' ? 'NOT LOADED' : s === 'DONE' ? 'COMPLETE' : s; }
  // Every part of the report from what the screens already show: loads (the Loadout Center's rows), open pickups, the shift log,
  // the production lines with their last checks, the temperature rows.
  function plantReport(input, nowMs) {
    var now = wallClock(nowMs), out = { behind: [], nextUp: [], loaded: [], leftToLoad: 0, total: 0 }, areas = {};
    REPORT_AREAS.forEach(function (a) { areas[a] = { area: a, left: 0, total: 0 }; });
    (input.loads || []).forEach(function (r) {
      if (!areas[r.area]) return;
      var leaves = departWall({ departureDate: r.departureDate, deliveryDate: r.deliveryDate, loadDate: r.loadDate, dispatchTime: clockMinutes(r.dispatchTime) }), until = leaves === null ? null : leaves - now;
      var item = { route: text(r.route), run: text(r.run), routeName: text(r.routeName), deliveryDate: text(r.deliveryDate || r.departureDate || r.loadDate), area: r.area, status: r.state, depart: minutesText12(clockMinutes(r.dispatchTime)), minutesUntil: until, truck: text(r.truck), trailer: text(r.trailer),
        startedAt: r.startedAt ? clockOf(r.startedAt) : '', doneAt: r.completedAt ? clockOf(r.completedAt) : '', doneMs: r.completedAt ? when(r.completedAt) || 0 : 0, priorDay: !!r.prior, loadSequence: r.loadSequence === null || r.loadSequence === undefined ? 999999 : Number(r.loadSequence) };
      areas[r.area].total++; out.total++;
      if (r.state === 'DONE') { out.loaded.push(item); return; }
      areas[r.area].left++; out.leftToLoad++;
      if (until !== null && until < -REPORT_BEHIND) { item.late = lateText(until); out.behind.push(item); } else out.nextUp.push(item);
    });
    var byDepart = function (a, b) { var x = a.minutesUntil === null ? 1e9 : a.minutesUntil, y = b.minutesUntil === null ? 1e9 : b.minutesUntil; return x - y || a.route.localeCompare(b.route, undefined, { numeric: true }); };
    out.behind.sort(byDepart);
    out.nextUp.sort(function (a, b) { return Number(a.priorDay) - Number(b.priorDay) || a.loadSequence - b.loadSequence || byDepart(a, b); });
    out.loaded.sort(function (a, b) { return byDepart(b, a); });
    var shift = shiftReport(input.shiftLog, input.roundStart), down = shift.down;
    var pickups = (input.pickups || []).filter(function (p) { return ['COMPLETE', 'COMPLETED', 'CLOSED'].indexOf(text(p.status).toUpperCase()) < 0; })
      .map(function (p) { return { route: text(p.route), run: text(p.run), product: text(p.item || p.product), quantity: text(p.quantity) }; });
    // Joe 10/10: a report takes only what was checked since the last report was sent (input.roundStart); anything older is
    // "Not checked", with when it was last checked, so no leftover reading goes out as if it were new.
    var since = when(input.roundStart) || 0, stale = function (at) { return !!since && (!at || when(at) <= since); };
    var lines = (input.lines || []).map(function (l) {
      var x = l.last || {}, status = text(x.status).toUpperCase(), check = text(x.qualityCheck).toUpperCase();
      if (lineDone(x, nowMs)) return { line: l.name, status: 'RUN COMPLETE', product: text(x.product), qualityCheck: '', lastCheckedAt: clockOf(x.recordedAt), notes: '', flag: false, runComplete: true };
      if (stale(x.recordedAt)) return { line: l.name, status: 'NOT CHECKED', product: '', qualityCheck: '', lastCheckedAt: x.recordedAt ? clockOf(x.recordedAt) : '', notes: '', flag: false, notChecked: true };
      return { line: l.name, status: status, product: text(x.product), qualityCheck: check, lastCheckedAt: x.recordedAt ? clockOf(x.recordedAt) : '', notes: text(x.notes), flag: status === 'DOWN' || check === 'FAIL' };
    });
    var temps = (input.temps || []).map(function (t) {
      if (t.status === 'MANUAL ONLY' && stale(t.lastCheckedAt)) return { location: t.location, reading: '', status: 'NOT CHECKED', limit: '', lastCheckedAt: t.lastCheckedAt ? clockOf(t.lastCheckedAt) : '', due: false, flag: false, notChecked: true };
      var status = t.status === 'MANUAL ONLY' ? (t.lastManualTemperature === '' ? 'NO CHECK' : t.lastStatus === 'RECORDED' ? 'OK' : t.lastStatus) : t.status === 'IN RANGE' ? 'OK' : t.status;
      var lim = t.lowLimit !== '' && t.highLimit !== '' ? t.lowLimit + '–' + t.highLimit : t.highLimit !== '' ? '≤ ' + t.highLimit : t.lowLimit !== '' ? '≥ ' + t.lowLimit : '';
      return { location: t.location, reading: t.sensorTemp !== '' ? String(t.sensorTemp) : String(t.lastManualTemperature), status: status, limit: lim, lastCheckedAt: t.lastCheckedAt ? clockOf(t.lastCheckedAt) : '',
        due: t.status === 'MANUAL ONLY' && !t.locked, flag: ['HIGH', 'LOW', 'OFFLINE', 'STALE', 'SENSOR ERROR'].indexOf(status) >= 0 };
    });
    var r = { timeLabel: zoned(nowMs, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(',', ''),
      dayLabel: zoned(nowMs, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + ' · ' + zoned(nowMs, { hour: 'numeric', minute: '2-digit' }),
      behindMinutes: REPORT_BEHIND, behind: out.behind, nextUp: out.nextUp, loaded: out.loaded, leftToLoad: out.leftToLoad, totalLoads: out.total,
      areas: REPORT_AREAS.map(function (a) { return areas[a]; }).filter(function (a) { return a.total > 0; }), down: down, fixed: shift.fixed, handoff: shift.handoff, others: shift.others, pickups: pickups, lines: lines, temperatures: temps,
      output: lineOutput(input.output), outputShift: text(input.outputShift) };
    r.counts = { behind: r.behind.length, leftToLoad: r.leftToLoad, pickups: pickups.length, down: down.length, linesDown: lines.filter(function (l) { return l.flag; }).length, tempsOut: temps.filter(function (t) { return t.flag; }).length };
    r.subject = 'Plant Update ' + r.timeLabel + ': ' + (r.behind.length ? r.behind.length + ' route' + (r.behind.length === 1 ? '' : 's') + ' behind' : 'All routes on time');
    r.smooth = !r.counts.behind && !r.counts.down && !r.counts.linesDown && !r.counts.tempsOut;
    r.text = reportText(r);
    return r;
  }
  // Joe 10/14 follow-on (end-of-shift production report): each line's shift from the line tablets (production.js lineView):
  // made against target, stopped minutes and the biggest reason, waste, changeovers and line efficiency. Lines with nothing
  // entered this shift are left out.
  function lineOutput(list) {
    var n = function (v) { var x = Number(v); return isFinite(x) ? x : 0; };
    return (list || []).filter(function (o) { return o && (n(o.made) || n(o.stops) || n(o.wasteTotal) || (o.state && o.state !== 'IDLE')); }).map(function (o) {
      return { line: text(o.line), product: text(o.product), made: n(o.made), soFar: n(o.soFar), pct: o.pct === null || o.pct === undefined || o.pct === '' ? null : n(o.pct), downMin: n(o.downMin), stops: n(o.stops),
        topReason: text(o.topReason), wasteTotal: n(o.wasteTotal), changeovers: n(o.changeovers), changeoverMin: n(o.changeoverMin), oee: o.oee === null || o.oee === undefined || o.oee === '' ? null : n(o.oee), state: text(o.state) };
    });
  }
  function outputText(o) {
    return o.made.toLocaleString('en-US') + ' of ' + o.soFar.toLocaleString('en-US') + (o.pct === null ? '' : ' (' + o.pct + '%)') + ' · stopped ' + o.downMin + ' min' + (o.topReason && o.downMin ? ' (' + o.topReason + ')' : '') +
      (o.wasteTotal ? ' · waste ' + o.wasteTotal.toLocaleString('en-US') : '') + (o.changeovers ? ' · ' + o.changeovers + ' changeover' + (o.changeovers === 1 ? '' : 's') + ' ' + o.changeoverMin + ' min' : '') + (o.oee === null ? '' : ' · efficiency ' + o.oee + '%');
  }
  function reportName(x) { return x.route + (x.run && x.run !== x.route ? ' ' + x.run : ''); }
  // Joe 10/14: the report's route tiles show the route number and a short run name ("845 DSD", "906 Lancaster", "6304 Walmart"),
  // not LOADED / NOT LOADED (green is loaded, red is not). The plant's two-letter code (UT) and the word MILK are left off, words
  // with no vowel or a known short name stay capitals (DSD, KTI), the rest are written as names, and at most two words are kept (three when the third is a load number: "Marietta Load 1").
  var ACRONYMS = ['KTI', 'SAX', 'IGA', 'OTR', 'UDF'];
  function routeNumber(route) { return text(route).replace(/_\d+$/, ''); }
  // Joe 10/17: a run with no name in the sheet (844, 8302) uses the route's name instead.
  function shortRun(x) {
    var run = text(x.run);
    if ((!run || routeNumber(run) === routeNumber(x.route)) && text(x.routeName) && routeNumber(x.routeName) !== routeNumber(x.route)) run = text(x.routeName);
    var w = run.toUpperCase().split(/[\s_\-·]+/).filter(Boolean);
    if (!run || routeNumber(run) === routeNumber(x.route)) return '';
    if (w.length > 1 && /^[A-Z]{2}$/.test(w[0])) w.shift();
    w = w.filter(function (t) { return t !== 'MILK'; });
    return w.slice(0, /^\d+$/.test(w[2] || '') ? 3 : 2).map(function (t) { return t.length <= 2 || /\d/.test(t) || !/[AEIOUY]/.test(t) || ACRONYMS.indexOf(t) >= 0 ? t : t.charAt(0) + t.slice(1).toLowerCase(); }).join(' ');
  }
  function reportText(r) {
    var L = [];
    L.push('ROUTES BEHIND (' + r.behind.length + ')' + (r.behind.length ? '' : ': no route is more than ' + r.behindMinutes + ' minutes past its depart time'));
    r.behind.forEach(function (x) { L.push('  ' + reportName(x) + '  depart ' + (x.depart || '-') + '  ' + statusWord(x.status) + (x.startedAt ? ' since ' + x.startedAt : '') + '  ' + x.late + ((x.truck || x.trailer) ? '  ' + [x.truck, x.trailer].filter(Boolean).join(' / ') : '')); });
    L.push('');
    L.push('PLANT BREAKDOWNS (' + r.down.length + ')' + (r.down.length ? '' : ': none open in Shift Notes'));
    r.down.forEach(function (d) { L.push('  ' + (d.equipment || 'Plant equipment') + '  ' + (d.entry || '') + (d.at ? '  logged ' + d.at : '') + (d.shift ? ' ' + d.shift.toLowerCase() : '') + '  ' + d.status + (d.carried ? '  (carried over)' : '') + (d.review ? '  review ' + d.reviewAt + ': ' + d.review : '')); });
    if ((r.fixed || []).length) { L.push(''); L.push('FIXED SINCE LAST REPORT (' + r.fixed.length + ')'); r.fixed.forEach(function (d) { L.push('  ' + (d.equipment || 'Plant equipment') + '  ' + (d.entry || '') + '  RESOLVED' + (d.reviewAt ? ' ' + d.reviewAt : '') + (d.review ? ': ' + d.review : '')); }); }
    if ((r.handoff || []).length) { L.push(''); L.push('SHIFT HANDOFF (' + r.handoff.length + ')'); r.handoff.forEach(function (d) { L.push('  ' + (d.shift ? d.shift.toLowerCase() + ' ' : '') + (d.at || '') + ': ' + [d.entry, d.notes].filter(Boolean).join(' · ')); }); }
    if ((r.others || []).length) { L.push(''); L.push('INCIDENTS · SAFETY · QUALITY (' + r.others.length + ')'); r.others.forEach(function (d) { L.push('  ' + (d.equipment || d.type) + '  ' + d.type + '  ' + (d.entry || '') + '  ' + d.status); }); }
    L.push('');
    L.push('PICKUPS OPEN (' + r.pickups.length + ')');
    r.pickups.forEach(function (p) { L.push('  ' + [p.route, p.run].filter(Boolean).join(' ') + '  ' + [p.quantity, p.product].filter(Boolean).join(' ')); });
    L.push('');
    L.push('STILL TO LOAD: ' + r.leftToLoad + ' of ' + r.totalLoads + (r.areas.length ? '   ' + r.areas.map(function (a) { return a.area.charAt(0) + a.area.slice(1).toLowerCase() + ' ' + a.left + ' of ' + a.total; }).join(' · ') : ''));
    r.behind.concat(r.nextUp).forEach(function (x, i) { L.push('  ' + (i + 1) + '. ' + reportName(x) + '  depart ' + (x.depart || '-') + '  ' + statusWord(x.status) + (x.late ? '  ' + x.late : '') + ((x.truck || x.trailer) ? '  ' + [x.truck, x.trailer].filter(Boolean).join(' / ') : '') + (x.priorDay ? '  (from yesterday)' : '')); });
    L.push('');
    L.push('PRODUCTION');
    if (!r.lines.length) L.push('  No production lines set up');
    r.lines.forEach(function (l) { if (l.runComplete) { L.push('  ' + l.line + '  RUN COMPLETE ' + l.lastCheckedAt); return; } L.push('  ' + l.line + '  ' + (l.status || 'no status') + (l.product ? '  ' + l.product : '') + (l.lastCheckedAt ? (l.notChecked ? '  last check ' : '  quality check ') + l.lastCheckedAt + (l.qualityCheck ? ' ' + l.qualityCheck : '') : '') + (l.flag && l.notes ? '  (' + l.notes + ')' : '')); });
    if ((r.output || []).length) {
      L.push('');
      L.push('LINE OUTPUT' + (r.outputShift ? ' · ' + r.outputShift : ''));
      r.output.forEach(function (o) { L.push('  ' + o.line + (o.product ? '  ' + o.product : '') + '  ' + outputText(o)); });
    }
    L.push('');
    L.push('TEMPERATURES');
    if (!r.temperatures.length) L.push('  No temperature locations set up');
    r.temperatures.forEach(function (t) { L.push('  ' + t.location + '  ' + (t.reading !== '' ? t.reading + '°F' : '-') + '  ' + t.status + (t.notChecked && t.lastCheckedAt ? ' (last ' + t.lastCheckedAt + ')' : '') + (t.limit ? ' (limit ' + t.limit + ')' : '') + (t.due ? '  check due' : '')); });
    return L.join('\n');
  }

  // The email as the current app sends it (udpoV7275ReportHtml_): one phone-width column, loaded routes in green then not loaded
  // in red, pickups, breakdowns, production and temperatures; tables and inline styles so Gmail and phone mail keep the layout.
  function followWord(v) { v = text(v).toUpperCase(); return v === 'RESOLVED' ? 'RESOLVED' : v === 'MONITOR' ? 'MONITOR' : 'NEEDS ATTENTION'; }
  function reportHtml(r, note) {
    function e(v) { return String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    var F = 'font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;', RED = '#b42318', GREEN = '#1f7a4d', GREY = '#5b6775', INK = '#1c2733';
    function head(title, count, color) { return '<tr><td style="' + F + 'padding:16px 14px 6px;font-size:13px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:' + (color || GREY) + '">' + e(title) + (count !== null && count !== undefined ? '<span style="float:right;color:' + (color || INK) + '">' + e(count) + '</span>' : '') + '</td></tr>'; }
    function pill(t, bg, fg) { return '<span style="display:inline-block;font-size:12px;font-weight:800;padding:2px 7px;border-radius:10px;background:' + bg + ';color:' + fg + '">' + e(t) + '</span>'; }
    // Joe 10/15: one column on a phone. Each item is one full-width row: its name on the left and its one status on the right,
    // with any detail on a full-width line under it (never a narrow second column).
    function rows(list) { return '<tr><td style="padding:0 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">' + list.map(function (x) {
      var line = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="' + F + 'font-size:16px;font-weight:700;color:' + INK + '">' + e(x[0]) + '</td><td align="right" style="' + F + 'font-size:14px;color:' + GREY + ';white-space:nowrap">' + (x[1] || '') + '</td></tr></table>';
      return '<tr><td style="' + F + 'padding:8px 0;border-bottom:1px solid #edf0f3">' + line + (x[2] ? '<div style="' + F + 'font-size:14px;color:' + GREY + ';margin-top:3px">' + x[2] + '</div>' : '') + '</td></tr>'; }).join('') + '</table></td></tr>'; }
    function plain(t) { return '<tr><td style="' + F + 'padding:0 14px 4px;font-size:15px;color:' + GREY + '">' + e(t) + '</td></tr>'; }
    // Joe 10/16: each route is one row: route number, a very short run name, when it was loaded (Done) and its dispatch time,
    // under one small heading row. Run names longer than 12 letters are cut so the row fits a phone.
    var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    function deliversLabel(day) { var n = dayNum(day); if (n === null) return 'Delivery day not set'; var p = String(day).split('-'); return 'Delivers ' + WEEKDAYS[new Date(n * 86400000).getUTCDay()] + ' ' + Number(p[1]) + '-' + Number(p[2]) + '-' + String(p[0]).slice(2); }
    // A cut that leaves under 4 letters of the last word drops that word ("Zanesville D" reads "Zanesville").
    function brief(v) { v = text(v); if (v.length <= 12) return v; v = v.replace(/\bLoad (\d+)$/, 'L$1'); if (v.length <= 12) return v;
      var cut = v.slice(0, 12), sp = cut.lastIndexOf(' '); return (sp > 0 && cut.length - sp - 1 < 4 ? cut.slice(0, sp) : cut).trim(); }
    function grid(list) {
      var th = function (t, al) { return '<td' + (al ? ' align="right"' : '') + ' style="' + F + 'padding:0 8px 3px;font-size:11px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:' + GREY + '">' + t + '</td>'; };
      var td = function (x, t, al, w) { return '<td' + (al ? ' align="right"' : '') + ' style="' + F + 'padding:8px;font-size:' + (w ? '16px' : '15px') + ';font-weight:' + (w ? 800 : 600) + ';color:' + x.fg + ';background:' + x.bg + ';white-space:nowrap;border-bottom:3px solid #ffffff">' + t + '</td>'; };
      var last = null;
      return '<tr><td style="padding:2px 14px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>' + th('Route') + th('Run') + th('Done', 1) + th('Dispatch', 1) + '</tr>' + list.map(function (x) {
        var sep = '';
        if (splitDays && x.day !== last) { last = x.day; sep = '<tr><td colspan="4" style="' + F + 'padding:8px 8px 4px;font-size:14px;font-weight:800;color:' + INK + ';border-bottom:2px solid ' + INK + '">' + e(deliversLabel(x.day)) + '</td></tr>'; }
        return sep + '<tr>' + td(x, e(x.route), 0, 1) + td(x, e(brief(x.name)) || '&nbsp;') + td(x, x.word ? '<b style="font-size:12px">' + e(x.word) + '</b>' : e(x.done || '–'), 1) + td(x, e(x.depart || '–'), 1) + '</tr>';
      }).join('') + '</table></td></tr>';
    }
    // Short words so a name or heading fits one row on a phone: "HALF GALLON FILLER 1" -> "HALF GAL FILLER 1",
    // "Second Shift 2:00 PM to 10:30 PM" -> "2nd Shift 2 PM-10:30 PM".
    function shortName(v) { v = text(v); return v.length > 16 ? v.replace(/\bGALLON\b/g, 'GAL').replace(/\bGallon\b/g, 'Gal') : v; }
    function shortShift(v) { return text(v).replace(/^First\b/i, '1st').replace(/^Second\b/i, '2nd').replace(/^Third\b/i, '3rd').replace(/:00\b/g, '').replace(/ to /g, '-'); }
    var behind = (r.behind || []).length, total = Number(r.totalLoads) || 0, loadedCount = total - (Number(r.leftToLoad) || 0);
    // Joe 10/17: loaded routes in the order they finished loading; not loaded routes by when they leave. Both are split by
    // delivery day ("Delivers Sunday", "Delivers Monday") when the report holds more than one, so a Saturday report shows which
    // loads go out Sunday and which (Jersey) not until Monday. Late is already counted from each load's own departure day.
    // Joe 10/19: the loads are grouped Case, then Box, then Tote, then Tanker (each list keeps the order below).
    var GROUP_NAME = { CASE: 'Case', BOXING: 'Box', TOTES: 'Tote', TANKER: 'Tanker' }, GROUP_ORDER = ['CASE', 'BOXING', 'TOTES', 'TANKER'];
    var byGroup = function (a, b) { var x = GROUP_ORDER.indexOf(a.area), y = GROUP_ORDER.indexOf(b.area); return (x < 0 ? 9 : x) - (y < 0 ? 9 : y); };
    var dayOf = function (x) { return dayNum(x.deliveryDate); }, byDay = function (a, b) { var x = dayOf(a), y = dayOf(b); return (x === null ? 1e9 : x) - (y === null ? 1e9 : y); };
    var untilOf = function (x) { return x.minutesUntil === null || x.minutesUntil === undefined ? 1e9 : x.minutesUntil; };
    var loaded = (r.loaded || []).slice().sort(function (a, b) { return byGroup(a, b) || byDay(a, b) || (a.doneMs || 9e15) - (b.doneMs || 9e15) || String(a.route).localeCompare(String(b.route), undefined, { numeric: true }); })
      .map(function (x) { return { area: x.area, day: x.deliveryDate, route: routeNumber(x.route), name: shortRun(x), done: x.doneAt, depart: x.depart, word: '', bg: '#e2f4ea', fg: GREEN }; });
    var notLoaded = (r.behind || []).map(function (x) { return Object.assign({ late: true }, x); }).concat(r.nextUp || []).sort(function (a, b) { return byGroup(a, b) || byDay(a, b) || untilOf(a) - untilOf(b) || String(a.route).localeCompare(String(b.route), undefined, { numeric: true }); })
      .map(function (x) { return x.late ? { area: x.area, day: x.deliveryDate, route: routeNumber(x.route), name: shortRun(x), depart: x.depart, word: 'BEHIND', bg: RED, fg: '#ffffff' } : { area: x.area, day: x.deliveryDate, route: routeNumber(x.route), name: shortRun(x), depart: x.depart, word: '', bg: '#fde8e6', fg: RED }; });
    var days = {}; loaded.concat(notLoaded).forEach(function (x) { if (dayNum(x.day) !== null) days[x.day] = 1; });
    var splitDays = Object.keys(days).length > 1;
    var H = [];
    H.push('<tr><td style="' + F + 'padding:16px 14px;background:' + (behind ? RED : GREEN) + ';color:#ffffff"><div style="font-size:24px;font-weight:800">' + (behind ? '&#9888; ' + behind + ' ROUTE' + (behind === 1 ? '' : 'S') + ' BEHIND' : '&#10003; ALL ROUTES ON TIME') + '</div><div style="font-size:14px;margin-top:3px">' + e(r.dayLabel) + ' &middot; ' + loadedCount + ' of ' + total + ' loaded</div></td></tr>');
    if (note) H.push('<tr><td style="padding:12px 14px 0"><div style="' + F + 'background:#fff7e0;border-left:4px solid #d08700;padding:8px 10px;font-size:15px;color:' + INK + '"><b>Note:</b> ' + e(note) + '</div></td></tr>');
    H.push(head('Routes', loadedCount + ' of ' + total + ' loaded'));
    // Joe 10/19: one group per load type (Case, Box, Tote, Tanker), each with its own Loaded then Not loaded list and a dark
    // line between types. A type with no loads, or a list with none, is left out.
    var firstGroup = true;
    GROUP_ORDER.concat(['']).forEach(function (g) {
      var inGroup = function (x) { return g ? x.area === g : !GROUP_NAME[x.area]; }, ld = loaded.filter(inGroup), nl = notLoaded.filter(inGroup);
      if (!ld.length && !nl.length) return;
      if (g) H.push('<tr><td style="padding:' + (firstGroup ? '8px' : '18px') + ' 14px 0">' + (firstGroup ? '' : '<div style="height:3px;line-height:3px;font-size:1px;background:' + INK + '">&nbsp;</div>') +
        '<div style="' + F + 'padding:10px 0 0;font-size:18px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:' + INK + '">' + e(GROUP_NAME[g]) + ' (' + (ld.length + nl.length) + ')</div></td></tr>');
      firstGroup = false;
      if (ld.length) { H.push(head('Loaded (' + ld.length + ')', null, GREEN)); H.push(grid(ld)); }
      if (nl.length) { H.push(head('Not loaded (' + nl.length + ')', null, RED)); H.push(grid(nl)); }
    });
    if (!loaded.length && !notLoaded.length) H.push(plain('No loads on the dispatch sheet for this day.'));
    var pickups = r.pickups || [], down = r.down || [], lines = r.lines || [], temps = r.temperatures || [];
    H.push(head('Pickups open', pickups.length, pickups.length ? RED : null));
    if (!pickups.length) H.push(plain('None open.'));
    pickups.forEach(function (p) { H.push('<tr><td style="padding:0 14px 6px"><div style="' + F + 'border-left:4px solid ' + RED + ';background:#fff6f5;padding:7px 10px;font-size:15px;color:' + INK + '"><b style="color:' + RED + '">PICKUP ' + e([p.route, p.run].filter(Boolean).join(' ')) + '</b> ' + e([p.quantity, p.product].filter(Boolean).join(' ')) + '</div></td></tr>'); });
    H.push(head('Plant breakdowns', down.length, down.length ? RED : null));
    if (!down.length) H.push(plain('None open.'));
    else H.push(rows(down.map(function (d) { return [d.equipment || 'Plant equipment', pill(followWord(d.status), d.status === 'MONITOR' ? '#fff1d6' : '#fde8e6', d.status === 'MONITOR' ? '#9a5b00' : RED), e([d.entry, d.at ? 'logged ' + d.at : '', d.review ? 'review ' + d.reviewAt + ': ' + d.review : ''].filter(Boolean).join(' · ')) + (d.carried ? ' ' + pill('CARRIED OVER', '#fff1d6', '#9a5b00') : '')]; })));
    var fixed = r.fixed || [], handoff = r.handoff || [], others = r.others || [];
    if (fixed.length) { H.push(head('Fixed since last report', fixed.length, GREEN)); H.push(rows(fixed.map(function (d) { return [d.equipment || 'Plant equipment', pill('RESOLVED', '#e2f4ea', GREEN), e([d.review || d.entry, d.reviewAt].filter(Boolean).join(' · '))]; }))); }
    if (handoff.length) { H.push(head('Shift handoff')); handoff.forEach(function (d) { H.push('<tr><td style="padding:0 14px 6px"><div style="' + F + 'border-left:4px solid #0b4f8a;background:#f0f5fb;padding:8px 10px;font-size:15px;color:' + INK + '"><b>' + e((d.shift ? d.shift.charAt(0) + d.shift.slice(1).toLowerCase() : 'Handoff') + (d.at ? ' (' + d.at + ')' : '')) + ':</b> ' + e([d.entry, d.notes].filter(Boolean).join(' · ')) + '</div></td></tr>'); }); }
    if (others.length) { H.push(head('Incidents · Safety · Quality', others.length)); H.push(rows(others.map(function (d) { return [d.equipment || d.type, pill(followWord(d.status), d.status === 'RESOLVED' ? '#e2f4ea' : d.status === 'MONITOR' ? '#fff1d6' : '#fde8e6', d.status === 'RESOLVED' ? GREEN : d.status === 'MONITOR' ? '#9a5b00' : RED), e([d.entry, d.type].filter(Boolean).join(' · '))]; }))); }
    H.push(head('Production'));
    if (!lines.length) H.push(plain('No production lines set up.'));
    else H.push(rows(lines.map(function (l) { if (l.runComplete) return [shortName(l.line), pill('RUN COMPLETE ' + l.lastCheckedAt, '#eef1f4', GREY)]; return [shortName(l.line), l.notChecked ? pill('NOT CHECKED', '#fff1d6', '#9a5b00') : l.status ? pill(l.status, l.flag ? '#fde8e6' : '#eef1f4', l.flag ? RED : GREY) : 'no status',
      [l.product ? e(l.product) : '', l.qualityCheck ? pill('QC ' + l.qualityCheck, l.qualityCheck === 'FAIL' ? '#fde8e6' : '#e2f4ea', l.qualityCheck === 'FAIL' ? RED : GREEN) : ''].filter(Boolean).join(' ')]; })));
    var output = r.output || [];
    if (output.length) {
      H.push(head('Line output' + (r.outputShift ? ' · ' + shortShift(r.outputShift) : '')));
      H.push(rows(output.map(function (o) { var k = o.pct === null ? null : o.pct >= 100 ? 'g' : o.pct >= 90 ? 'a' : 'r';
        return [shortName(o.line), k ? pill(o.pct + '%', k === 'g' ? '#e2f4ea' : k === 'a' ? '#fff1d6' : '#fde8e6', k === 'g' ? GREEN : k === 'a' ? '#9a5b00' : RED) : '',
          e(outputText(o).replace(/ \(\d+%\)/, '').replace(' · stopped ', ' · down ').replace(/ changeovers? /, ' chg ').replace(' · efficiency ', ' · eff. '))]; })));
    }
    H.push(head('Temperatures'));
    if (!temps.length) H.push(plain('No temperature locations set up.'));
    else H.push(rows(temps.map(function (t) { var ok = t.status === 'OK', due = t.due || t.status === 'NO CHECK'; if (t.notChecked) return [t.location, pill('NOT CHECKED', '#fff1d6', '#9a5b00')]; return [t.location, (t.reading !== '' && t.reading !== undefined ? e(t.reading) + '&deg;F ' : '&ndash; ') + (t.flag ? pill(t.status, '#fde8e6', RED) : due ? pill(t.status === 'NO CHECK' ? 'CHECK DUE' : t.status + ' · CHECK DUE', '#fff1d6', '#9a5b00') : pill(t.status || '-', ok ? '#e2f4ea' : '#eef1f4', ok ? GREEN : GREY))]; })));
    H.push('<tr><td style="' + F + 'padding:16px 14px;font-size:12px;color:#8a95a3;text-align:center">United Dairy Plant Operations</td></tr>');
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#ffffff">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff">' + H.join('') + '</table></body></html>';
  }

  return { unloadKey: unloadKey, unitKey: unitKey, trailerText: trailerText, latestUnloads: latestUnloads, washesDone: washesDone, washOpen: washOpen, when: when,
    LOAD_TYPE: LOAD_TYPE, SUPPLIER_TYPE: SUPPLIER_TYPE, numberLoads: numberLoads, loadNumberName: loadNumberName, STARTING_SUPPLIERS: STARTING_SUPPLIERS, lane: lane, newestRecords: newestRecords, time24: time24,
    scheduleEntries: scheduleEntries, scheduleCustomers: scheduleCustomers, LOAD_TYPES: LOAD_TYPES, loadArea: loadArea, routeLoadType: routeLoadType, scheduleArea: scheduleArea, scheduleSuppliers: scheduleSuppliers, holidayName: holidayName,
    YARD_LOCK_MINUTES: YARD_LOCK_MINUTES, FUEL_LEVELS: FUEL_LEVELS, yardTrailer: yardTrailer, wallMinutes: wallMinutes, wallClock: wallClock, departWall: departWall, yardHolds: yardHolds, yardDeparted: yardDeparted,
    yardQueue: yardQueue, yardHistory: yardHistory, yardLockLeft: yardLockLeft, REEFER_OFF_BY: REEFER_OFF_BY, REEFER_STALE_MINUTES: REEFER_STALE_MINUTES, yardGps: yardGps, REEFER_STOP_MINUTES: REEFER_STOP_MINUTES, REEFER_SIGNAL_MINUTES: REEFER_SIGNAL_MINUTES, yardOut: yardOut, yardGone: yardGone,
    shiftReport: shiftReport, QUALITY_TYPE: QUALITY_TYPE, LINE_STATUSES: LINE_STATUSES, qualitySkip: qualitySkip, isBlowMold: isBlowMold, isHtst: isHtst, productionLines: productionLines, qualityLines: qualityLines,
    qualityHistory: qualityHistory, weightText: weightText,
    SHIFT_TYPE: SHIFT_TYPE, SHIFTS: SHIFTS, ENTRY_TYPES: ENTRY_TYPES, URGENCIES: URGENCIES, downMinutes: downMinutes, downSpan: downSpan, downToday: downToday, FOLLOW_UPS: FOLLOW_UPS, shiftAt: shiftAt, lineDone: lineDone, opDayAt: opDayAt, followLabel: followLabel, shiftLog: shiftLog,
    TEMP_TYPE: TEMP_TYPE, TEMP_LOCK_MINUTES: TEMP_LOCK_MINUTES, tempLocations: tempLocations, withTempLocations: withTempLocations, tempStatus: tempStatus, tempReadings: tempReadings, tempLockLeft: tempLockLeft, tempRows: tempRows, tempChecked: tempChecked, tempHistory: tempHistory, matchSensors: matchSensors, placeWords: placeWords,
    weekOf: weekOf, managerSchedule: managerSchedule, managerQuality: managerQuality, tempAlert: tempAlert, managerTemps: managerTemps, managerNotes: managerNotes, WALK_LATE_MINUTES: WALK_LATE_MINUTES, managerWalk: managerWalk,
    REPORT_BEHIND: REPORT_BEHIND, plantReport: plantReport, lineOutput: lineOutput, outputText: outputText, statusWord: statusWord, reportName: reportName, shortRun: shortRun, routeNumber: routeNumber, reportText: reportText, reportHtml: reportHtml };
});
