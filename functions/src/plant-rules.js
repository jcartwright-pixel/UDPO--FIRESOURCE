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
 *   - weeks run Sunday to Saturday; the plant's holidays are marked on the calendar.
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

  return { unloadKey: unloadKey, unitKey: unitKey, trailerText: trailerText, latestUnloads: latestUnloads, washesDone: washesDone, washOpen: washOpen, when: when,
    LOAD_TYPE: LOAD_TYPE, SUPPLIER_TYPE: SUPPLIER_TYPE, STARTING_SUPPLIERS: STARTING_SUPPLIERS, lane: lane, newestRecords: newestRecords, time24: time24,
    scheduleEntries: scheduleEntries, scheduleCustomers: scheduleCustomers, scheduleSuppliers: scheduleSuppliers, holidayName: holidayName };
});
