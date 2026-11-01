/*
 * United Dairy Customer List (UDCL, Joe 11/1): the one customer list for every app. Shared by the screens and the server (one
 * file, copied unchanged to public/js/udcl-rules.js by npm run sync-logic; a unit test checks the two match).
 *
 * Joe 11/1: "This customer list is going to be a full customer base ... I want to be able to have route maps. Basically a map of
 * how I want the truck loaded ... see it by customer, by route, by day ... sequence the routes whenever I want to change it ...
 * print anything from any screen ... just Uniontown for now. But eventually be company-wide."
 * Joe 11/1 (the route files): "My Uniontown route menu is updated the best that I know. So the route menu in the sequence change
 * may not be accurate, so they'll have to be rebuilt ... off the current Uniontown route menu." So the Route Menu workbook is
 * where the customers, their routes, days and load sequence come from; the 2024 Route Book only fills in what the Route Menu does
 * not have (start times, run order, keys or door codes, instructions, the truck load drawing), and only where it still fits.
 *
 * Words used here:
 *   - a customer: one account (the Route Menu's Account number), with its name, chain and address;
 *   - a route day: one route on one day of the week (803 on Tuesday), with its stops in run order (the order the driver
 *     delivers), each stop's load sequence (where its product sits on the truck; 1 = loaded first, at the front), the start time,
 *     the route's instructions and its load map;
 *   - a load map: the truck seen from above, front at the top, the back door at the bottom: rows of 6 spots (3 on the left side,
 *     3 on the right, as the Route Book draws it), each holding a load sequence number; one row can be the side door.
 *
 * Everything is kept per plant (Uniontown now; every plant later), so the same list works company-wide.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UDCL = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  var DAY_NAMES = { SUN: 'Sunday', MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday' };
  var SPOTS = 6;           // spots across one row of the load map (3 left, 3 right)
  var MAP_ROWS = 12;       // rows on a new load map
  var MAX_ROWS = 30;
  var MAX_STOPS = 60;      // stops on one route day
  var MAX_LINES = 5000;    // lines in one Route Menu upload
  var LIMITS = { name: 80, account: 20, chain: 12, route: 12, address: 120, city: 60, state: 4, zip: 12, phone: 40, contact: 80, keys: 120, note: 500, notes: 2000, startTime: 20 };

  function text(v, max) {
    var t = v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim();
    return max ? t.slice(0, max) : t;
  }
  // Excel gives numbers (803, 1196.0): keep them as plain words ("803", "1196").
  function numText(v, max) { var t = text(v, max); return /^-?\d+\.0+$/.test(t) ? t.replace(/\.0+$/, '') : t; }
  function dayOf(v) {
    var t = text(v).toUpperCase();
    if (t === 'THUR' || t === 'THURS') return 'THU';
    if (t === 'TUES') return 'TUE';
    t = t.slice(0, 3);
    return DAYS.indexOf(t) >= 0 ? t : '';
  }
  function dayFromName(v) {
    var t = text(v).toLowerCase();
    for (var k in DAY_NAMES) if (DAY_NAMES[k].toLowerCase() === t) return k;
    return '';
  }
  function seqOf(v) { var n = Number(v); return isFinite(n) && n > 0 && n < 1000 ? Math.round(n) : 0; }
  // A customer's key: the account number; a customer with none goes by its name.
  function custKey(account, name) {
    var a = numText(account, LIMITS.account);
    if (a && a !== '0') return a.replace(/[^A-Za-z0-9-]/g, '');
    return 'N-' + text(name).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  }
  function routeDayId(plant, route, day) { return safe(plant) + '__' + safe(route) + '__' + day; }
  function customerId(plant, key) { return safe(plant) + '__' + safe(key); }
  function safe(v) { return String(v || '').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 60); }
  function byRoute(a, b) { return String(a).localeCompare(String(b), undefined, { numeric: true }); }
  function dayIndex(d) { var i = DAYS.indexOf(d); return i < 0 ? 9 : i; }

  /* ---------- reading the workbooks (rows = arrays of cell values, as SheetJS sheet_to_json(header: 1) gives) ---------- */

  function findHeading(rows, words, from) {
    for (var r = from || 0; r < Math.min(rows.length, 40 + (from || 0)); r++) {
      var row = (rows[r] || []).map(function (c) { return text(c).toUpperCase(); });
      var cols = words.map(function (w) { return row.indexOf(w); });
      if (cols.every(function (c) { return c >= 0; })) return { row: r, cols: cols, cells: row };
    }
    return null;
  }

  /**
   * The Route Menu's "Customer By Route" tab: DAY, ROUTE, Chain, Account, Name, then the load sequence (the LOAD SEQ column, or the
   * column after Name when it has no heading). One line per customer per delivery day. Lines with no route are kept apart
   * (unrouted): they are not on any route day yet.
   */
  function menuStops(rows) {
    var h = findHeading(rows, ['DAY', 'ROUTE', 'NAME']) || findHeading(rows, ['DAY', 'RT', 'NAME']);
    if (!h) return null;
    var cells = h.cells, at = function (w) { return cells.indexOf(w); };
    var cDay = h.cols[0], cRoute = h.cols[1], cName = h.cols[2], cChain = at('CHAIN'), cAcct = at('ACCOUNT');
    var cSeq = at('LOAD SEQ');
    var seen = {}, out = [], unrouted = [];
    for (var r = h.row + 1; r < rows.length && out.length + unrouted.length < MAX_LINES; r++) {
      var row = rows[r] || [];
      var day = dayOf(row[cDay]), name = text(row[cName], LIMITS.name);
      if (!day || !name) continue;
      var route = numText(row[cRoute], LIMITS.route), account = numText(row[cAcct], LIMITS.account), chain = numText(row[cChain], LIMITS.chain);
      // The tab's load sequence sits in LOAD SEQ, or in the two columns after Name (the second is the one typed over).
      var seq = cSeq >= 0 ? seqOf(row[cSeq]) : (seqOf(row[cName + 2]) || seqOf(row[cName + 1]));
      var x = { day: day, route: route, account: account === '0' ? '' : account, chain: chain === '0' ? '' : chain, name: name, loadSeq: seq };
      x.key = custKey(x.account, x.name);
      var k = [x.day, x.route, x.key].join('|');
      if (seen[k]) continue;
      seen[k] = true;
      (route ? out : unrouted).push(x);
    }
    return { stops: out, unrouted: unrouted };
  }

  /** The Route Menu's "Address List" tab (no headings): account in the 3rd column, then name, street, street 2, city, state, zip. */
  function addressList(rows) {
    var out = {};
    (rows || []).forEach(function (row) {
      if (!row) return;
      var account = numText(row[2], LIMITS.account);
      if (!/^\d+$/.test(account) || account === '0') return;
      var street = text(row[4], LIMITS.address), street2 = text(row[5], LIMITS.address);
      out[account] = { address: street, address2: street2 && street2 !== street ? street2 : '', city: text(row[6], LIMITS.city).replace(/,$/, ''),
        state: text(row[7], LIMITS.state).toUpperCase(), zip: numText(row[8], LIMITS.zip) };
    });
    return out;
  }

  function nameKey(n) { return text(n).toUpperCase().replace(/[`'’.]/g, '').replace(/[^A-Z0-9#]+/g, ' ').trim(); }

  /** The Route Menu's "GPS Address" tab: Name, Address, City, State, Route, Lat, Lon, found by the customer's name. */
  function gpsAddresses(rows) {
    var h = findHeading(rows, ['NAME', 'ADDRESS', 'CITY']);
    if (!h) return {};
    var c = h.cells, out = {};
    for (var r = h.row + 1; r < rows.length; r++) {
      var row = rows[r] || [], name = nameKey(row[c.indexOf('NAME')]);
      if (!name) continue;
      var lat = Number(row[c.indexOf('LAT')]), lon = Number(row[c.indexOf('LON')]);
      out[name] = { address: text(row[c.indexOf('ADDRESS')], LIMITS.address), city: text(row[c.indexOf('CITY')], LIMITS.city).replace(/,$/, ''),
        state: text(row[c.indexOf('STATE')], LIMITS.state).toUpperCase(), lat: isFinite(lat) && lat ? lat : null, lon: isFinite(lon) && lon ? lon : null };
    }
    return out;
  }

  /**
   * One "Rt 803" tab of the Route Book: a block per day (the day's name in the first column), its Start Time, a line per stop
   * (Chain, Account, Name, Run Order, Load SEQ, Time IN, Time Out, Keys or Door Code), "Instructions" and the lines under it, and on
   * the right the truck drawing (Front at the top; 6 spots across, every other row; a words cell marks the side door).
   */
  function bookSheet(rows) {
    var out = {}, starts = [];
    rows.forEach(function (row, r) { if (dayFromName(row && row[0])) starts.push(r); });
    starts.forEach(function (r0, i) {
      var day = dayFromName(rows[r0][0]), end = i + 1 < starts.length ? starts[i + 1] : rows.length;
      var b = { startTime: text(String(rows[r0][7] || '').replace(/start time/i, ''), LIMITS.startTime), stops: [], instructions: [], grid: [], door: null };
      var mode = 'stops';
      for (var r = r0 + 2; r < end; r++) {
        var row = rows[r] || [];
        if (text(row[0]).toLowerCase() === 'instructions') { mode = 'notes'; continue; }
        if (mode === 'stops' && text(row[2])) b.stops.push({ account: numText(row[1], LIMITS.account), name: text(row[2], LIMITS.name), run: seqOf(row[3]), keys: text(row[8], LIMITS.keys) });
        else if (mode === 'notes') {
          var line = row.slice(0, 12).map(function (c) { return text(c); }).filter(Boolean).join(' ');
          if (line) b.instructions.push(line);
        }
        var spots = [13, 15, 17, 21, 23, 25].map(function (c) { return row[c]; });
        if (typeof spots[0] === 'string' && text(spots[0]) && !/^front$/i.test(text(spots[0]))) { if (b.door === null) b.door = b.grid.length; continue; }
        if (spots.some(function (s) { return typeof s === 'number'; })) b.grid.push(spots.map(function (s) { return seqOf(s) || null; }));
      }
      if (b.stops.length || b.grid.length || b.instructions.length || b.startTime) out[day] = b;
    });
    return out;
  }

  /** Every "Rt <route>" tab of the Route Book: { '803|TUE': {...} }. sheets = { tabName: rows }. */
  function routeBook(sheets) {
    var out = {};
    Object.keys(sheets || {}).forEach(function (name) {
      var m = /^\s*rt\s*(\d+)\s*$/i.exec(name);
      if (!m) return;
      var days = bookSheet(sheets[name]);
      Object.keys(days).forEach(function (d) { out[m[1] + '|' + d] = days[d]; });
    });
    return out;
  }

  /* ---------- run order and load maps ---------- */

  /**
   * The stops of one route day in run order. The first time (no saved order): the Route Book's run order where the customer is
   * still on that route day there; else the load sequence from the back door in (the highest number comes off first), then the
   * name. A saved order is kept; customers new to the route day go after the stop with the next higher load sequence.
   */
  function runOrder(stops, saved, book) {
    var list = stops.slice();
    if (saved && saved.length) {
      var at = {};
      saved.forEach(function (k, i) { at[k] = i; });
      var kept = list.filter(function (s) { return at[s.key] !== undefined; }).sort(function (a, b) { return at[a.key] - at[b.key]; });
      list.filter(function (s) { return at[s.key] === undefined; }).sort(function (a, b) { return b.loadSeq - a.loadSeq || a.name.localeCompare(b.name); }).forEach(function (s) {
        var i = 0;
        while (i < kept.length && kept[i].loadSeq >= s.loadSeq) i++;
        kept.splice(i, 0, s);
      });
      return kept;
    }
    var run = {};
    ((book && book.stops) || []).forEach(function (b) { if (b.run) run[custKey(b.account, b.name)] = b.run; });
    var hasRun = list.filter(function (s) { return run[s.key]; }).length;
    return list.sort(function (a, b) {
      if (hasRun * 2 >= list.length) {
        var ra = run[a.key] || 999, rb = run[b.key] || 999;
        if (ra !== rb) return ra - rb;
      }
      return b.loadSeq - a.loadSeq || a.name.localeCompare(b.name);
    });
  }

  /** The load sequence numbers on a route day, smallest first. */
  function seqsOf(stops) {
    var s = {};
    stops.forEach(function (x) { if (x.loadSeq) s[x.loadSeq] = true; });
    return Object.keys(s).map(Number).sort(function (a, b) { return a - b; });
  }

  /**
   * A new load map for a route day: the truck's rows shared out between the load sequence numbers, front first, by how many stops
   * each has (at least one row each).
   */
  function autoMap(stops, rows) {
    var seqs = seqsOf(stops), n = Math.max(rows || MAP_ROWS, seqs.length, 1);
    var cells = [];
    if (!seqs.length) { for (var e = 0; e < n; e++) cells.push(blankRow()); return { rows: n, door: null, cells: cells }; }
    var count = seqs.map(function (q) { return stops.filter(function (s) { return s.loadSeq === q; }).length || 1; });
    var total = count.reduce(function (a, b) { return a + b; }, 0), share = count.map(function () { return 1; }), left = n - seqs.length;
    // The rows left over go one at a time to the number furthest below its fair share.
    while (left > 0) {
      var best = 0, gap = -1e9;
      share.forEach(function (sh, i) { var g = count[i] / total * n - sh; if (g > gap) { gap = g; best = i; } });
      share[best]++; left--;
    }
    seqs.forEach(function (q, i) { for (var k = 0; k < share[i]; k++) cells.push(fillRow(q)); });
    return { rows: n, door: null, cells: cells };
  }
  function blankRow() { var r = []; for (var i = 0; i < SPOTS; i++) r.push(null); return r; }
  function fillRow(q) { var r = []; for (var i = 0; i < SPOTS; i++) r.push(q); return r; }

  /** The Route Book's drawing, if every number on it is still one of the route day's load sequence numbers. */
  function bookMap(book, stops) {
    if (!book || !book.grid || !book.grid.length) return null;
    var seqs = seqsOf(stops || []), used = {};
    book.grid.forEach(function (r) { r.forEach(function (c) { if (c) used[c] = true; }); });
    if (!Object.keys(used).every(function (k) { return seqs.indexOf(Number(k)) >= 0; })) return null;
    return cleanMap({ rows: book.grid.length, door: book.door, cells: book.grid });
  }

  /** A load map as saved: rows 1-30, 6 spots each, each spot a load sequence number or blank; the side door row or none. */
  function cleanMap(m) {
    m = m || {};
    var rows = Math.max(1, Math.min(MAX_ROWS, Math.round(Number(m.rows) || (m.cells && m.cells.length) || MAP_ROWS)));
    var cells = [];
    for (var r = 0; r < rows; r++) {
      var src = (m.cells && m.cells[r]) || [], row = [];
      if (typeof src === 'string') src = src.split(',');
      for (var c = 0; c < SPOTS; c++) row.push(seqOf(src[c]) || null);
      cells.push(row);
    }
    var door = m.door === null || m.door === undefined || m.door === '' ? null : Math.round(Number(m.door));
    return { rows: rows, door: isFinite(door) && door >= 0 && door <= rows ? door : null, cells: cells };
  }

  /** A map as the database keeps it: each row as words ("1,1,1,,2,2"), since the database holds no list inside a list. */
  function packMap(m) {
    if (!m) return null;
    var c = cleanMap(m);
    return { rows: c.rows, door: c.door, cells: c.cells.map(function (r) { return r.map(function (v) { return v || ''; }).join(','); }) };
  }

  /** How many spots each load sequence number has on a map. */
  function mapCounts(map) {
    var n = {};
    ((map && map.cells) || []).forEach(function (r) { r.forEach(function (c) { if (c) n[c] = (n[c] || 0) + 1; }); });
    return n;
  }

  /* ---------- the lists the screens show ---------- */

  /**
   * Every delivery line: one per customer per route day, with its run order (stop number) and load sequence.
   * customers = { key: customer }, routeDays = [route day].
   */
  function lines(customers, routeDays) {
    var out = [];
    (routeDays || []).forEach(function (rd) {
      (rd.stops || []).forEach(function (s, i) {
        var c = customers[s.key] || {};
        out.push({ key: s.key, account: c.account || s.account || '', name: c.name || s.name || '', chain: c.chain || s.chain || '', route: rd.route, day: rd.day,
          stop: i + 1, loadSeq: s.loadSeq || 0, note: s.note || '', city: c.city || '', address: c.address || '', state: c.state || '', zip: c.zip || '',
          keys: c.keys || '', phone: c.phone || '', active: c.active !== false });
      });
    });
    return out;
  }

  var SORTS = {
    customer: function (a, b) { return a.name.localeCompare(b.name) || dayIndex(a.day) - dayIndex(b.day) || byRoute(a.route, b.route); },
    route: function (a, b) { return byRoute(a.route, b.route) || dayIndex(a.day) - dayIndex(b.day) || a.stop - b.stop; },
    day: function (a, b) { return dayIndex(a.day) - dayIndex(b.day) || byRoute(a.route, b.route) || a.stop - b.stop; },
    account: function (a, b) { return byRoute(a.account, b.account) || dayIndex(a.day) - dayIndex(b.day); },
    city: function (a, b) { return a.city.localeCompare(b.city) || a.name.localeCompare(b.name) || dayIndex(a.day) - dayIndex(b.day); },
    chain: function (a, b) { return byRoute(a.chain || 'zz', b.chain || 'zz') || a.name.localeCompare(b.name) || dayIndex(a.day) - dayIndex(b.day); }
  };

  /** The lines picked by the screen's boxes: f = { q (any words), route, day, chain, sort }. */
  function pick(list, f) {
    f = f || {};
    var words = text(f.q).toUpperCase().split(' ').filter(Boolean);
    var out = list.filter(function (x) {
      if (f.route && x.route !== f.route) return false;
      if (f.day && x.day !== f.day) return false;
      if (f.chain && x.chain !== f.chain) return false;
      if (!words.length) return true;
      var hay = [x.name, x.account, x.chain, x.city, x.address, x.route, DAY_NAMES[x.day] || ''].join(' ').toUpperCase();
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
    return out.sort(SORTS[f.sort] || SORTS.customer);
  }

  /** One customer per row, with every day and route it gets a delivery ("TUE 803, FRI 803"). */
  function customerRows(customers, allLines) {
    var by = {};
    allLines.forEach(function (l) { (by[l.key] = by[l.key] || []).push(l); });
    return Object.keys(customers).map(function (k) {
      var c = customers[k], ls = (by[k] || []).sort(SORTS.day);
      return Object.assign({}, c, { key: k, deliveries: ls.map(function (l) { return { day: l.day, route: l.route, stop: l.stop, loadSeq: l.loadSeq }; }),
        days: ls.map(function (l) { return l.day; }).filter(function (d, i, a) { return a.indexOf(d) === i; }) });
    }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  }

  /** "S M T W H F S" with the delivery days filled in, as the Route Menu writes it. */
  function dayLetters(days) {
    var L = ['S', 'M', 'T', 'W', 'H', 'F', 'S'];
    return DAYS.map(function (d, i) { return days.indexOf(d) >= 0 ? L[i] : '-'; }).join(' ');
  }

  /* ---------- checking a save ---------- */

  /** A route day's stops as saved from the Route Sequence screen: in run order, each its customer key, load sequence and note. */
  function cleanStops(stops) {
    if (!Array.isArray(stops)) return null;
    var seen = {}, out = [];
    stops.slice(0, MAX_STOPS).forEach(function (s) {
      var key = text(s && s.key, 60);
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push({ key: key, loadSeq: seqOf(s.loadSeq), note: text(s.note, LIMITS.note) });
    });
    return out;
  }

  // Joe 11/1: every place has a distribution center code (DC). A customer belongs to one; a plant's own customers start with its code.
  var DCS = [{ code: '1', name: 'Martins Ferry' }, { code: '6', name: 'Lancaster' }, { code: '7', name: 'Fairmont' }, { code: '9', name: 'Marietta' }, { code: '30', name: 'Uniontown' }, { code: '50', name: 'Charleston' }];
  var PLANT_DC = { fac_martins_ferry: '1', fac_uniontown: '30', fac_charleston: '50' };
  /** The DC code when it is one of ours ('030' and 30 are '30'), else ''. */
  function dcOf(v) { var t = numText(v, 4).replace(/^0+(?=\d)/, ''); return DCS.some(function (d) { return d.code === t; }) ? t : ''; }
  /** "30 Uniontown" for a DC code, '' when it has none. */
  function dcName(v) { var t = dcOf(v), d = DCS.filter(function (x) { return x.code === t; })[0]; return d ? d.code + ' ' + d.name : ''; }
  var CUSTOMER_FIELDS = ['name', 'chain', 'dc', 'address', 'address2', 'city', 'state', 'zip', 'phone', 'contact', 'keys', 'notes'];
  function cleanCustomer(c) {
    var out = {};
    CUSTOMER_FIELDS.forEach(function (k) {
      if (c && c[k] !== undefined) out[k] = k === 'notes' ? String(c[k] || '').trim().slice(0, LIMITS.notes) : k === 'dc' ? dcOf(c[k]) : (k === 'chain' || k === 'zip' ? numText(c[k], LIMITS[k]) : text(c[k], LIMITS[k === 'address2' ? 'address' : k]));
    });
    if (out.state) out.state = out.state.toUpperCase();
    if (c && c.lat !== undefined) { var la = Number(c.lat); out.lat = isFinite(la) && la ? la : null; }
    if (c && c.lon !== undefined) { var lo = Number(c.lon); out.lon = isFinite(lo) && lo ? lo : null; }
    if (c && c.active !== undefined) out.active = c.active !== false;
    return out;
  }

  /** One line of the customer's address, for lists and print. */
  function addressLine(c) {
    c = c || {};
    var cityLine = [text(c.city), [text(c.state), text(c.zip)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return [text(c.address), text(c.address2), cityLine].filter(Boolean).join(', ');
  }

  return { DAYS: DAYS, DAY_NAMES: DAY_NAMES, SPOTS: SPOTS, MAP_ROWS: MAP_ROWS, MAX_ROWS: MAX_ROWS, MAX_STOPS: MAX_STOPS, MAX_LINES: MAX_LINES, LIMITS: LIMITS,
    CUSTOMER_FIELDS: CUSTOMER_FIELDS, DCS: DCS, PLANT_DC: PLANT_DC, dcOf: dcOf, dcName: dcName, text: text, numText: numText, dayOf: dayOf, dayFromName: dayFromName, seqOf: seqOf, custKey: custKey, nameKey: nameKey,
    routeDayId: routeDayId, customerId: customerId, byRoute: byRoute, dayIndex: dayIndex,
    menuStops: menuStops, addressList: addressList, gpsAddresses: gpsAddresses, bookSheet: bookSheet, routeBook: routeBook,
    runOrder: runOrder, seqsOf: seqsOf, autoMap: autoMap, bookMap: bookMap, cleanMap: cleanMap, packMap: packMap, mapCounts: mapCounts,
    lines: lines, SORTS: SORTS, pick: pick, customerRows: customerRows, dayLetters: dayLetters, cleanStops: cleanStops, cleanCustomer: cleanCustomer, addressLine: addressLine };
});
