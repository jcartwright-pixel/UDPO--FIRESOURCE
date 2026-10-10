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
 *     ".. LOAD 2") listed once; Receiving's are the five starting suppliers plus the added ones;
 *   - weeks run Sunday to Saturday; the plant's holidays are marked on the calendar. *
 * And Yard Checks' (getDesktopUiPlantYardChecksV5063 / udpoV780LoadedTrailerTemperatureWatch_, 7.0.276):
 *   - a trailer is on the yard from the day it is loaded until its dispatch time (the dispatch nearest after the load was
 *     marked done, or the operating day before the departure date for a load made days ahead), and a "Left Yard" press
 *     takes that load off;
 *   - a checked trailer leaves the Active Yard Queue for 2 hours, then comes back until it leaves;
 *   - fuel is Full, 3/4, 1/2 or Empty; the 24-hour history lists every check and every Left Yard.
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
  var STARTING_SUPPLIERS = [['S01', 'VALLEY FARMS MILK CO-OP', 'Valley Farms'], ['S02', 'HILLSIDE CREAM COMPANY', 'Hillside Cream'], ['S03', 'KEYSTONE CARTON SUPPLY', 'Keystone Carton'],
    ['S04', 'TRI-STATE CAPS AND CLOSURES', 'Tri-State Caps'], ['S05', 'SWEET RIDGE INGREDIENTS', 'Sweet Ridge']];
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
  function scheduleEntries(docs, laneName) {
    var all = newestRecords(docs, [LOAD_TYPE[lane(laneName)]]), out = [];
    Object.keys(all).forEach(function (id) {
      var d = all[id], p = payloadOf(d);
      if (text(d.status).toUpperCase() === 'DELETED' || !d.date) return;
      out.push({ id: id, date: d.date, routeId: d.routeId || '', runId: d.runId || '', route: d.route || '', run: d.run || '', pickupTime: time24(p.pickupTime) || text(p.pickupTime),
        scheduleType: text(p.scheduleType).toUpperCase() === 'CARRIER' || p.carrier === true ? 'CARRIER' : 'ROUTE', loadDate: text(p.loadDate), trailer: text(p.trailer),
        poNumber: text(p.poNumber), cases: text(p.cases), product: text(p.product), notes: text(p.notes || d.notes), status: text(d.status).toUpperCase() || 'SCHEDULED',
        inApp: !!d.createdInApp });
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
      list.push({ routeId: text(r.routeId), runId: text(r.runId), route: route, run: run, name: text(r.routeName) });
    });
    list.sort(function (a, b) { return a.route.localeCompare(b.route, undefined, { numeric: true }) || a.run.localeCompare(b.run); });
    // An as-needed customer (Aldi - Charleston LOAD 1 to 4) is one customer; its first slot names the run.
    var out = [], byKey = {};
    list.forEach(function (r) {
      var m = /^(.*?)[\s-]*LOAD\s*[0-9]+$/i.exec(r.run);
      if (!m || !m[1].trim()) { out.push(r); return; }
      var base = m[1].trim(), baseRoute = r.route.replace(/_[0-9]+$/, ''), key = baseRoute + '|' + base.toUpperCase();
      if (byKey[key]) { byKey[key].slots++; return; }
      byKey[key] = { routeId: r.routeId, runId: r.runId, route: baseRoute, run: base, name: r.name, grouped: true, slots: 1 };
      out.push(byKey[key]);
    });
    return out;
  }

  // Receiving's suppliers: the five starting ones, then the added ones in the order they were added.
  function scheduleSuppliers(docs) {
    var list = STARTING_SUPPLIERS.map(function (x, i) { var id = 'SUP-START-' + (i + 1); return { routeId: id, runId: id, route: x[0], run: x[1], name: x[2] }; });
    var all = newestRecords(docs, [SUPPLIER_TYPE]), added = Object.keys(all).map(function (k) { return all[k]; });
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
  function yardQueue(runs, journal, date, nowMs) {
    var checks = yardChecks(journal, date), departed = {}, latest = {};
    checks.forEach(function (e) {
      var k = yardOf(e), p = payloadOf(e);
      if (yardStatus(e) === 'DEPARTED') { if (k) departed[k + '|' + text(p.run || e.run).toUpperCase()] = true; return; }
      if (k && !latest[k]) latest[k] = e;
    });
    var seen = {}, rows = [], locked = [];
    yardHolds(runs, date).forEach(function (x, index) {
      if (yardDeparted(x, date, nowMs) || seen[x.trailer] || departed[x.trailer + '|' + x.routeRun.toUpperCase()]) return;
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
  // Minutes until a trailer can be checked again (the save's own check: that operating day's newest record of the trailer).
  function yardLockLeft(journal, date, trailer, nowMs) {
    var k = yardTrailer(trailer), last = (journal || []).filter(function (d) { return String(d.type || '').toUpperCase() === 'YARD_CHECK' && d.date === date && yardOf(d) === k; })
      .sort(function (a, b) { return when(b.recordedAt) - when(a.recordedAt); })[0];
    if (!last || !when(last.recordedAt)) return 0;
    var age = Math.max(0, (nowMs - when(last.recordedAt)) / 60000);
    return age < YARD_LOCK_MINUTES ? Math.ceil(YARD_LOCK_MINUTES - age) : 0;
  }

  return { unloadKey: unloadKey, unitKey: unitKey, trailerText: trailerText, latestUnloads: latestUnloads, washesDone: washesDone, washOpen: washOpen, when: when,
    LOAD_TYPE: LOAD_TYPE, SUPPLIER_TYPE: SUPPLIER_TYPE, STARTING_SUPPLIERS: STARTING_SUPPLIERS, lane: lane, newestRecords: newestRecords, time24: time24,
    scheduleEntries: scheduleEntries, scheduleCustomers: scheduleCustomers, scheduleSuppliers: scheduleSuppliers, holidayName: holidayName,
    YARD_LOCK_MINUTES: YARD_LOCK_MINUTES, FUEL_LEVELS: FUEL_LEVELS, yardTrailer: yardTrailer, wallMinutes: wallMinutes, yardHolds: yardHolds, yardDeparted: yardDeparted,
    yardQueue: yardQueue, yardHistory: yardHistory, yardLockLeft: yardLockLeft };
});
