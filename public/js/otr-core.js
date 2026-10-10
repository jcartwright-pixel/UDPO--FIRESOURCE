/*
 * Over the Road (OTR) counting and report logic, copied unchanged from the current app's 221_V7276_OverTheRoadCore.gs
 * (pure JavaScript, no Apps Script). The screen (otr.html) and the server (actions.js) both load this one file.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UDOtr = factory();
})(typeof self !== 'undefined' ? self : this, function () {
/**
 * 7.0.276 Over the Road (OTR) runs: pure logic (no Apps Script services). Server side in 222_V7276_OverTheRoadServer.gs,
 * screen OverTheRoad.html. Node tests load this file directly (tools/test_otr_core.cjs).
 *
 * Counting rule (Joe, 2026-10-05): every run on a route flagged "Include in over the road report" is one mark for
 * that route's destination on its delivery day; two Save-A-Lot runs on one Sunday = 2. A run turned off for the
 * day does not count.
 */
var OTR_CORE = Object.freeze({
  VERSION: '1.1.0',
  // The By Date columns of Joe's OTR Trips 2026 workbook, in its order.
  DESTINATIONS: Object.freeze(['SAL', 'Jersey', 'Reinhart', 'J&J Snacks', 'Garber', 'Cream-O-Land', 'Lancaster', 'Ferry', 'Peck',
    'CostCo', 'Char', 'I/W Columbus', 'I/W', 'Fairmont', 'OH Processors', 'Totally Cool', 'Ventura Foods', 'CHAR ALDI', 'USDA',
    "Leiby's", 'Sun Valley']),
  // Trip mileage from the Trip Cost Report tab of Joe's OTR Trips workbook (9/1/18-8/31/19). Not confirmed for today:
  // shown as a hint only, never written anywhere. Route Master <day>_miles always wins.
  DRAFT_MILES: Object.freeze({'SAL': 290, 'Jersey': 730, 'Reinhart': 705, 'J&J Snacks': 165, 'Garber': 345, 'Cream-O-Land': 626,
    'Lancaster': 395, 'Ferry': 168, 'Peck': 365, 'CostCo': 450, 'I/W Columbus': 1300, 'I/W': 400, 'Totally Cool': 440,
    'Ventura Foods': 300}),
  // The Recap tab of the OTR Trips workbook, in the accounting package's words.
  FIGURES: Object.freeze([
    {key: 'gallons_sold', label: 'Gallons sold', money: false},
    {key: 'distribution_cost', label: 'Delivery cost', money: true},
    {key: 'employee_cost', label: 'Employee cost', money: true},
    {key: 'fuel_cost', label: 'Fuel cost', money: true},
    {key: 'miles', label: 'Miles', money: false},
    {key: 'fuel_fills', label: 'Fuel fills', money: false},
    {key: 'fuel_used_gal', label: 'Fuel used', money: false}
  ]),
  // P&L Expenses by Dept: DELIVERY = GAR + DM + DIC. Employee cost = these lines; fuel cost = Gasoline + Tires
  // (both checked against the Recap tab: June 2026 fuel 159,767.77 + 7,946.77 = 167,715).
  EMPLOYEE_LINES: Object.freeze(['salaries', 'hourly wages', 'o.t. wages', 'pension', 'workmans comp. ins.', 'group insurance',
    'payroll taxes']),
  FUEL_LINES: Object.freeze(['gasoline', 'tires']),
  DAYS: Object.freeze(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']),
  MONTHS: Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])
});

function otrNum_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var t = String(v).replace(/[$,\s]/g, '');
  if (/^\(.*\)$/.test(t)) t = '-' + t.slice(1, -1);
  if (!t || isNaN(Number(t))) return null;
  return Number(t);
}

function otrFlagOn_(v) {
  if (v === true) return true;
  var t = String(v == null ? '' : v).trim().toUpperCase();
  return t === 'TRUE' || t === 'YES' || t === 'Y' || t === '1' || t === 'X' || t === 'INCLUDE';
}

function otrNormDest_(v) {
  var t = String(v == null ? '' : v).trim();
  if (!t) return '';
  var k = t.toUpperCase().replace(/[^A-Z0-9&]/g, '');
  for (var i = 0; i < OTR_CORE.DESTINATIONS.length; i++) {
    if (OTR_CORE.DESTINATIONS[i].toUpperCase().replace(/[^A-Z0-9&]/g, '') === k) return OTR_CORE.DESTINATIONS[i];
  }
  var aliases = {SAVEALOT: 'SAL', COSTCO: 'CostCo', JJ: 'J&J Snacks', 'J&J': 'J&J Snacks', COL: 'Cream-O-Land', CREAMOLAND: 'Cream-O-Land',
    LEIBYS: "Leiby's", LEIBY: "Leiby's", SUNV: 'Sun Valley', IWCOL: 'I/W Columbus', IWCOLUMBUS: 'I/W Columbus', CHARALDI: 'CHAR ALDI',
    OHPROC: 'OH Processors', TCOOL: 'Totally Cool', VENTURA: 'Ventura Foods', MARTINSFERRY: 'Ferry'};
  return aliases[k] || t;
}

function otrDateKey_(y, m, d) {
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
}

function otrParseKey_(key) {
  var m = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error('OTR_BAD_DATE_KEY: ' + key);
  return {y: Number(m[1]), m: Number(m[2]), d: Number(m[3])};
}

function otrAddDays_(key, n) {
  var p = otrParseKey_(key), t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return otrDateKey_(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function otrWeekday_(key) {
  var p = otrParseKey_(key);
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
}

function otrShortDate_(key) {
  var p = otrParseKey_(key);
  return p.m + '/' + p.d + '/' + p.y;
}

/** Route Master rows -> the OTR route list. rows: [{runId, route, run, include, destination, miles:{sun..sat}}]. */
function otrRouteList_(rows) {
  return (rows || []).map(function (r) {
    var miles = 0;
    OTR_CORE.DAYS.forEach(function (d) { var v = otrNum_(r.miles && r.miles[d]); if (v != null && v > miles) miles = v; });
    var destination = otrNormDest_(r.destination);
    return {
      runId: String(r.runId || ''), route: String(r.route || ''), run: String(r.run || ''),
      include: otrFlagOn_(r.include), destination: destination, miles: miles || null,
      draftMiles: !miles && OTR_CORE.DRAFT_MILES[destination] ? OTR_CORE.DRAFT_MILES[destination] : null
    };
  }).filter(function (r) { return r.runId || r.route; }).sort(function (a, b) {
    if (a.include !== b.include) return a.include ? -1 : 1;
    return String(a.route).localeCompare(String(b.route), undefined, {numeric: true}) || String(a.run).localeCompare(String(b.run));
  });
}

/**
 * Count one delivery day from the dispatch sheet.
 * liveRows: [{runId, route, run, routeStatus, active, runs}] for that day (runs = the day's "<day>_runs" cell).
 * routes: otrRouteList_ output. Returns {date, total, byDestination:{}, runs:[{route, run, destination}]}.
 */
function otrCountDay_(dateKey, liveRows, routes) {
  var flagged = {};
  (routes || []).forEach(function (r) { if (r.include && r.destination) flagged[r.runId || (r.route + '|' + r.run)] = r; });
  var out = {date: dateKey, total: 0, byDestination: {}, runs: []};
  (liveRows || []).forEach(function (row) {
    var status = String(row.routeStatus || 'ACTIVE').trim().toUpperCase();
    if (status && status !== 'ACTIVE') return;
    if (row.active !== '' && row.active != null && !otrScheduled_(row.active)) return;
    if (!otrScheduled_(row.runs)) return;
    var r = flagged[String(row.runId || '')] || flagged[String(row.route || '') + '|' + String(row.run || '')];
    if (!r) return;
    out.total++;
    out.byDestination[r.destination] = (out.byDestination[r.destination] || 0) + 1;
    out.runs.push({route: String(row.route || r.route), run: String(row.run || r.run), destination: r.destination,
      driver: row.driver || '', truck: row.truck || '', dispatchTime: row.dispatchTime || ''});
  });
  return out;
}

// Same rule as udpoV7000ScheduledValue_ in the program.
function otrScheduled_(value) {
  if (value === false || value === 0) return false;
  var text = String(value == null ? '' : value).trim().toUpperCase();
  if (!text) return false;
  return ['FALSE', 'NO', 'N', '0', 'OFF', 'DOES NOT RUN'].indexOf(text) < 0;
}

/**
 * Merge stored daily counts with live counts. stored: [{date, destination, runs, source}] (source 'MANUAL' wins).
 * live: {dateKey: otrCountDay_ result} for days still in the Live weeks. Returns {dateKey: {dest: n}}.
 */
function otrMergeDaily_(stored, live) {
  var byDate = {}, manual = {};
  (stored || []).forEach(function (s) {
    var d = String(s.date || ''), dest = otrNormDest_(s.destination), n = otrNum_(s.runs);
    if (!d || !dest || n == null) return;
    byDate[d] = byDate[d] || {};
    byDate[d][dest] = n;
    if (String(s.source || '').toUpperCase() === 'MANUAL') manual[d + '|' + dest] = true;
  });
  Object.keys(live || {}).forEach(function (d) {
    var day = live[d];
    var fresh = {};
    Object.keys(day.byDestination || {}).forEach(function (dest) { fresh[dest] = day.byDestination[dest]; });
    Object.keys(byDate[d] || {}).forEach(function (dest) { if (manual[d + '|' + dest]) fresh[dest] = byDate[d][dest]; });
    byDate[d] = fresh;
  });
  return byDate;
}

function otrMonthRuns_(daily, monthHistory, year) {
  // runs[dest][monthIndex] for one year: daily counts when the month has any, else imported month totals.
  var runs = {}, hasDaily = {};
  Object.keys(daily || {}).forEach(function (d) {
    var p = otrParseKey_(d);
    if (p.y !== year) return;
    hasDaily[p.m - 1] = true;
    Object.keys(daily[d]).forEach(function (dest) {
      runs[dest] = runs[dest] || new Array(12).fill(null);
      runs[dest][p.m - 1] = (runs[dest][p.m - 1] || 0) + (daily[d][dest] || 0);
    });
  });
  (monthHistory || []).forEach(function (h) {
    if (Number(h.year) !== year) return;
    var mi = Number(h.month) - 1, dest = otrNormDest_(h.destination), n = otrNum_(h.runs);
    if (mi < 0 || mi > 11 || !dest || n == null || hasDaily[mi]) return;
    runs[dest] = runs[dest] || new Array(12).fill(null);
    runs[dest][mi] = (runs[dest][mi] || 0) + n;
  });
  return runs;
}

function otrFigureMap_(figures) {
  var map = {};
  (figures || []).forEach(function (f) {
    var y = Number(f.year), m = Number(f.month);
    if (!y || !m) return;
    var rec = {};
    OTR_CORE.FIGURES.forEach(function (def) { rec[def.key] = otrNum_(f[def.key]); });
    map[y + '-' + m] = rec;
  });
  return map;
}

function otrCostPerGallon_(rec) {
  if (!rec || !rec.gallons_sold || rec.distribution_cost == null) return null;
  return rec.distribution_cost / rec.gallons_sold;
}

function otrSum_(a) { return (a || []).reduce(function (s, v) { return s + (v || 0); }, 0); }

/**
 * The one-page year-over-year report (Joe's pick G).
 * Returns {year, prior, throughMonth, destinations:[{name, prior:[12], current:[12], priorYear, currentYear, change}],
 *          totals:{prior:[12], current:[12]}, recap:{gallons, distribution, cpg each {prior:[12], current:[12], ytdPrior, ytdCurrent}}}
 */
function otrYearReport_(year, todayKey, daily, monthHistory, figures) {
  var prior = year - 1, today = otrParseKey_(todayKey);
  var through = today.y > year ? 12 : today.y < year ? 0 : today.m; // months 1..through are in scope
  var cur = otrMonthRuns_(daily, monthHistory, year), old = otrMonthRuns_(daily, monthHistory, prior);
  var names = OTR_CORE.DESTINATIONS.slice();
  Object.keys(cur).concat(Object.keys(old)).forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });
  var totals = {prior: new Array(12).fill(0), current: new Array(12).fill(null)};
  var destinations = names.map(function (n) {
    var a = old[n] || new Array(12).fill(null), b = cur[n] || new Array(12).fill(null);
    a.forEach(function (v, i) { totals.prior[i] += v || 0; });
    b.forEach(function (v, i) { if (i < through) totals.current[i] = (totals.current[i] || 0) + (v || 0); });
    var priorSame = otrSum_(a.slice(0, through)), currentYear = otrSum_(b.slice(0, through));
    return {name: n, prior: a, current: b.map(function (v, i) { return i < through ? (v || 0) : null; }),
      priorYear: otrSum_(a), currentYear: currentYear, change: currentYear - priorSame};
  });
  var fm = otrFigureMap_(figures);
  function series(y, key) {
    return OTR_CORE.MONTHS.map(function (_, i) { var r = fm[y + '-' + (i + 1)]; return r ? r[key] : null; });
  }
  function cpgSeries(y) {
    return OTR_CORE.MONTHS.map(function (_, i) { return otrCostPerGallon_(fm[y + '-' + (i + 1)]); });
  }
  // Fuel cost per gallon sold, as on the Cost Per Gallon tab of Joe's OTR Trips workbook.
  function fuelSeries(y) {
    return OTR_CORE.MONTHS.map(function (_, i) { var r = fm[y + '-' + (i + 1)]; return r && r.gallons_sold && r.fuel_cost != null ? r.fuel_cost / r.gallons_sold : null; });
  }
  // Year to date counts only months that have figures in BOTH years, so the comparison is like for like.
  var both = OTR_CORE.MONTHS.map(function (_, i) {
    var a = fm[prior + '-' + (i + 1)], b = fm[year + '-' + (i + 1)];
    return !!(a && b && a.gallons_sold && b.gallons_sold && a.distribution_cost != null && b.distribution_cost != null);
  });
  function ytd(y, key) { return otrSum_(series(y, key).map(function (v, i) { return both[i] ? v : 0; })); }
  var gP = ytd(prior, 'gallons_sold'), gC = ytd(year, 'gallons_sold'), dP = ytd(prior, 'distribution_cost'), dC = ytd(year, 'distribution_cost');
  var fuelBoth = both.map(function (b, i) { var a = fm[prior + '-' + (i + 1)], c = fm[year + '-' + (i + 1)]; return b && a.fuel_cost != null && c.fuel_cost != null; });
  function fuelYtd(y) {
    var f = 0, g = 0;
    fuelBoth.forEach(function (b, i) { if (b) { var r = fm[y + '-' + (i + 1)]; f += r.fuel_cost; g += r.gallons_sold; } });
    return g ? f / g : null;
  }
  // Difference row under the totals (this year minus last year), as on the Month Recap tab.
  totals.diff = totals.current.map(function (v, i) { return v == null ? null : v - (totals.prior[i] || 0); });
  return {
    year: year, prior: prior, throughMonth: through, figureMonths: both.filter(Boolean).length,
    destinations: destinations, totals: totals,
    runsYear: {current: otrSum_(totals.current), priorSame: otrSum_(totals.prior.slice(0, through)), prior: otrSum_(totals.prior)},
    recap: {
      gallons: {prior: series(prior, 'gallons_sold'), current: series(year, 'gallons_sold'), ytdPrior: gP || null, ytdCurrent: gC || null},
      distribution: {prior: series(prior, 'distribution_cost'), current: series(year, 'distribution_cost'), ytdPrior: dP || null, ytdCurrent: dC || null},
      cpg: {prior: cpgSeries(prior), current: cpgSeries(year), ytdPrior: gP ? dP / gP : null, ytdCurrent: gC ? dC / gC : null},
      fuelCpg: {prior: fuelSeries(prior), current: fuelSeries(year), ytdPrior: fuelYtd(prior), ytdCurrent: fuelYtd(year)}
    }
  };
}

/** Dashboard (Joe's pick D): today, this week Sun-Sat, month to date, latest month's cost per gallon vs last year. */
function otrDashboard_(todayKey, daily, todayCount, figures) {
  var p = otrParseKey_(todayKey), sunday = otrAddDays_(todayKey, -otrWeekday_(todayKey));
  function dayTotal(k) { var d = daily[k]; return d ? Object.keys(d).reduce(function (s, x) { return s + (d[x] || 0); }, 0) : null; }
  var week = [];
  for (var i = 0; i < 7; i++) {
    var k = otrAddDays_(sunday, i);
    week.push({date: k, day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i], label: Number(k.slice(5, 7)) + '/' + Number(k.slice(8, 10)),
      total: k > todayKey ? null : (dayTotal(k) || 0), today: k === todayKey});
  }
  var mtd = 0;
  Object.keys(daily || {}).forEach(function (k) {
    var q = otrParseKey_(k);
    if (q.y === p.y && q.m === p.m && k <= todayKey) mtd += dayTotal(k) || 0;
  });
  var fm = otrFigureMap_(figures), latest = null;
  for (var back = 0; back < 13 && !latest; back++) {
    var y = p.y, m = p.m - back;
    while (m < 1) { m += 12; y--; }
    var rec = fm[y + '-' + m];
    if (otrCostPerGallon_(rec) != null) {
      var ly = fm[(y - 1) + '-' + m];
      latest = {year: y, month: m, label: OTR_CORE.MONTHS[m - 1] + ' ' + y, cpg: otrCostPerGallon_(rec),
        employeeCpg: rec.employee_cost != null ? rec.employee_cost / rec.gallons_sold : null,
        fuelCpg: rec.fuel_cost != null ? rec.fuel_cost / rec.gallons_sold : null,
        lastYearCpg: otrCostPerGallon_(ly)};
    }
  }
  return {today: todayCount, todayLabel: otrShortDate_(todayKey), week: week, monthToDate: mtd,
    monthLabel: OTR_CORE.MONTHS[p.m - 1] + ' ' + p.y, costPerGallon: latest};
}

/** Text for the Copy Daily Count button. */
function otrDailyCountText_(day) {
  var parts = Object.keys(day.byDestination || {}).sort(function (a, b) {
    return OTR_CORE.DESTINATIONS.indexOf(a) - OTR_CORE.DESTINATIONS.indexOf(b);
  }).map(function (d) { return d + ' ' + day.byDestination[d]; });
  return 'OTR runs ' + otrShortDate_(day.date) + ': ' + day.total + (parts.length ? ' (' + parts.join(', ') + ')' : '');
}

/**
 * Import: read one tab's values and find what it holds. Recognised, in this order:
 * 1) BY_DATE  - the OTR Trips "By Date" tab: a header row naming 3+ destinations, a date in column A -> daily runs.
 * 2) EXPENSES - an accounting "P&L Expenses by Dept" month tab: a header row with DELIVERY and GAR/DM/DIC, the month in
 *               the title (e.g. "AUGUST  26") -> delivery cost (TOTALS), employee cost and fuel cost for that month.
 *    (A Dept Comparison Delivery month tab gives the same three numbers, rounded; used only where Expenses has none.)
 * 3) GALLONS  - an accounting "Gallon Comparison" tab: Sales/Transfers/Total under two year labels, Jan.-Dec. rows ->
 *               gallons sold = Total (sales + transfers). The prior-year column is kept only as a fallback ("weak").
 * 4) RECAP    - the OTR Trips "Recap" tab (or any table with a Month column and figure columns) -> monthly figures.
 * Anything else (Gross Margin, P&L Comparison, Plant tabs) is left alone.
 * tabName helps find the month of an EXPENSES tab; yearHint is used when nothing else carries a year.
 * Returns {kind, daily:[{date,destination,runs}], figures:[{year,month,key,value,weak?}]}.
 */
function otrParseImport_(values, yearHint, tabName) {
  values = values || [];
  var out = {kind: 'UNKNOWN', daily: [], figures: []};
  var top = Math.min(values.length, 15);
  function cell(r, c) { var row = values[r] || []; return row[c]; }
  function text(r, c) { return String(cell(r, c) == null ? '' : cell(r, c)).trim(); }

  // 1) By Date
  for (var h = 0; h < top; h++) {
    var cols = {};
    (values[h] || []).forEach(function (c, i) { var d = otrNormDest_(c); if (i > 0 && OTR_CORE.DESTINATIONS.indexOf(d) >= 0) cols[i] = d; });
    if (Object.keys(cols).length >= 3) {
      out.kind = 'BY_DATE';
      for (var r = h + 1; r < values.length; r++) {
        var key = otrCellDateKey_(cell(r, 0), yearHint);
        if (!key) continue;
        Object.keys(cols).forEach(function (i) {
          var n = otrNum_(cell(r, Number(i)));
          if (n != null && n > 0) out.daily.push({date: key, destination: cols[i], runs: n});
        });
      }
      return out;
    }
  }

  // 2) P&L Expenses by Dept
  for (var eh = 0; eh < top; eh++) {
    var heads = (values[eh] || []).map(function (c) { return String(c == null ? '' : c).trim().toUpperCase(); });
    var del = heads.indexOf('DELIVERY');
    if (del < 0 || !(heads.indexOf('GAR') >= 0 || heads.indexOf('DM') >= 0 || heads.indexOf('DIC') >= 0)) continue;
    var when = null;
    for (var t = 0; t <= eh && !when; t++) when = otrTitleMonth_(text(t, 0));
    if (!when) when = otrTitleMonth_(tabName);
    if (!when) return out;
    var lines = {};
    for (var lr = eh + 1; lr < values.length; lr++) {
      var lab = text(lr, 0).toLowerCase().replace(/\s+/g, ' ');
      if (lab && !(lab in lines)) lines[lab] = otrNum_(cell(lr, del));
      if (lab === 'totals') break;
    }
    if (lines.totals == null) return out;
    var emp = 0, fuel = 0;
    OTR_CORE.EMPLOYEE_LINES.forEach(function (l) { emp += lines[l] || 0; });
    OTR_CORE.FUEL_LINES.forEach(function (l) { fuel += lines[l] || 0; });
    out.kind = 'EXPENSES';
    out.figures.push({year: when.y, month: when.m, key: 'distribution_cost', value: otrRound2_(lines.totals)});
    out.figures.push({year: when.y, month: when.m, key: 'employee_cost', value: otrRound2_(emp)});
    out.figures.push({year: when.y, month: when.m, key: 'fuel_cost', value: otrRound2_(fuel)});
    return out;
  }

  // 2b) Dept Comparison Delivery month tab: last year vs this year columns; rounded copies of the Expenses tabs, so weak.
  // Only the dated month tabs ("August 26"); the old undated ones ("December", "Jan vs. Feb") are years-old copies.
  if (/delivery comparison/i.test(text(0, 0) + ' ' + text(1, 0)) && !/ytd/i.test(String(tabName || '')) && otrTitleMonth_(tabName)) {
    for (var dh = 2; dh < top; dh++) {
      var dcols = {};
      (values[dh] || []).forEach(function (c, i) { var mk3 = i > 0 && c instanceof Date ? otrCellMonth_(c) : null; if (mk3) dcols[i] = mk3; });
      if (!Object.keys(dcols).length) continue;
      var want = {distribution_cost: /^totals$/i, employee_cost: /^total\s*employee\s*cost$/i, fuel_cost: /^gas,?\s*oil,?\s*tires$/i};
      for (var dr = dh + 1; dr < values.length; dr++) {
        var dl = text(dr, 0);
        Object.keys(want).forEach(function (k) {
          if (!want[k].test(dl)) return;
          Object.keys(dcols).forEach(function (i) {
            var v = otrNum_(cell(dr, Number(i)));
            if (v != null && v !== 0) out.figures.push({year: dcols[i].y, month: dcols[i].m, key: k, value: v, weak: true});
          });
        });
      }
      if (out.figures.length) out.kind = 'DEPT_COMPARISON';
      return out;
    }
    return out;
  }

  // 3) Gallon Comparison (first block only: Milk & Soft Serve)
  for (var gh = 1; gh < Math.min(values.length, 20); gh++) {
    var gl = (values[gh] || []).map(function (c) { return String(c == null ? '' : c).trim().toLowerCase(); });
    if (gl.indexOf('sales') < 0 || gl.indexOf('transfers') < 0 || gl.indexOf('total') < 0) continue;
    var yearRow = null;
    for (var yr = gh - 1; yr >= 0 && yearRow == null; yr--) {
      if ((values[yr] || []).filter(function (c) { return /^(19|20)\d{2}$/.test(String(c == null ? '' : c).trim()); }).length >= 2) yearRow = yr;
    }
    if (yearRow == null) continue;
    var totals = [];
    gl.forEach(function (c, i) {
      if (c !== 'total') return;
      for (var k = i; k >= 0; k--) {
        var yv = String(cell(yearRow, k) == null ? '' : cell(yearRow, k)).trim();
        if (/^(19|20)\d{2}$/.test(yv)) { totals.push({col: i, year: Number(yv)}); return; }
      }
    });
    totals = totals.slice(0, 2);
    if (totals.length < 1) continue;
    var seen = 0;
    for (var gr = gh + 1; gr < values.length && seen < 12; gr++) {
      var gm = otrMonthName_(text(gr, 0));
      if (!gm) { if (seen) break; continue; }
      seen++;
      totals.forEach(function (tc, ti) {
        var v = otrNum_(cell(gr, tc.col));
        if (v != null && v > 0) out.figures.push({year: tc.year, month: gm, key: 'gallons_sold', value: v, weak: ti > 0});
      });
    }
    if (out.figures.length) { out.kind = 'GALLONS'; return out; }
  }

  // 4) Recap: a Month column and figure columns, one row per month
  var colRx = {
    gallons_sold: /^gallons?\s*sold$|^gallons$/i, distribution_cost: /^del(ivery)?\.?\s*cost$|^dist(ribution)?\.?\s*cost$/i,
    employee_cost: /^employee\s*cost$|^labor\s*cost$/i, fuel_cost: /^fuel\s*cost$/i, fuel_used_gal: /^fuel\s*used/i,
    fuel_fills: /^(fuel|tank)\s*fills?$/i, miles: /^miles(\s*driven)?$/i
  };
  for (var rh = 0; rh < top; rh++) {
    if (!/^month$/i.test(text(rh, 0))) continue;
    var fc = {};
    (values[rh] || []).forEach(function (c, i) {
      var lab2 = String(c == null ? '' : c).trim();
      Object.keys(colRx).some(function (k) { if (colRx[k].test(lab2) && !(k in fc)) { fc[k] = i; return true; } return false; });
    });
    if (Object.keys(fc).length < 2) continue;
    var started = false;
    for (var mr = rh + 1; mr < values.length; mr++) {
      var mk = otrCellMonth_(cell(mr, 0), yearHint);
      if (!mk) { if (started) break; continue; } // the month list ends at the first row that is not a month
      started = true;
      Object.keys(fc).forEach(function (k) {
        var v = otrNum_(cell(mr, fc[k]));
        if (v != null && v !== 0) out.figures.push({year: mk.y, month: mk.m, key: k, value: v});
      });
    }
    if (out.figures.length) { out.kind = 'RECAP'; return out; }
  }

  return out;
}

/**
 * Put several tabs' (or files') findings together: one value per month and figure, one count per day and destination.
 * A value read from a "this year" column beats a prior-year ("weak") copy of the same month from a newer tab.
 */
function otrMergeImport_(parts) {
  var daily = {}, figs = {}, tabs = [];
  (parts || []).forEach(function (p) {
    tabs.push({tab: p.tab, kind: p.kind, rows: (p.daily || []).length + (p.figures || []).length});
    (p.daily || []).forEach(function (d) { daily[d.date + '|' + d.destination] = d; });
    (p.figures || []).forEach(function (f) {
      var k = f.year + '-' + f.month + '|' + f.key, old = figs[k];
      if (!old || old.weak || !f.weak) figs[k] = f;
    });
  });
  var figures = Object.keys(figs).map(function (k) { var f = figs[k]; return {year: f.year, month: f.month, key: f.key, value: f.value}; });
  figures.sort(function (a, b) { return a.year - b.year || a.month - b.month || OTR_CORE.FIGURES.map(function (x) { return x.key; }).indexOf(a.key) - OTR_CORE.FIGURES.map(function (x) { return x.key; }).indexOf(b.key); });
  var list = Object.keys(daily).map(function (k) { return daily[k]; });
  list.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : OTR_CORE.DESTINATIONS.indexOf(a.destination) - OTR_CORE.DESTINATIONS.indexOf(b.destination); });
  return {daily: list, figures: figures, tabs: tabs};
}

/**
 * What the preview shows: one line per kind of number, with how many months (or days) and from when to when.
 * Compares with what is saved now (savedFigures: [{year,month,<keys>}]) so changed numbers stand out.
 */
function otrImportSummary_(merged, savedFigures) {
  var saved = otrFigureMap_(savedFigures), lines = [];
  function label(y, m) { return OTR_CORE.MONTHS[m - 1] + ' ' + y; }
  if (merged.daily.length) {
    var first = merged.daily[0].date, last = merged.daily[merged.daily.length - 1].date, runs = 0, days = {};
    merged.daily.forEach(function (d) { runs += d.runs; days[d.date] = 1; });
    lines.push({what: 'OTR runs (By Date)', count: Object.keys(days).length + ' days', from: otrShortDate_(first), to: otrShortDate_(last),
      total: runs, changed: null});
  }
  OTR_CORE.FIGURES.forEach(function (def) {
    var list = merged.figures.filter(function (f) { return f.key === def.key; });
    if (!list.length) return;
    var changed = list.filter(function (f) {
      var s = saved[f.year + '-' + f.month];
      return s && s[def.key] != null && Math.abs(s[def.key] - f.value) >= 1;
    }).length;
    lines.push({what: def.label, key: def.key, count: list.length + ' months', from: label(list[0].year, list[0].month),
      to: label(list[list.length - 1].year, list[list.length - 1].month), changed: changed});
  });
  return lines;
}

function otrRound2_(v) { return v == null ? null : Math.round(v * 100) / 100; }

function otrMonthName_(t) {
  var m = String(t == null ? '' : t).trim().match(/^([A-Za-z]{3})[a-z]*\.?$/);
  if (!m) return null;
  var i = OTR_CORE.MONTHS.map(function (x) { return x.toLowerCase(); }).indexOf(m[1].toLowerCase());
  return i < 0 ? null : i + 1;
}

/** "AUGUST  26", "JAN 2025 ", "JUNE 2025  (2)" -> {y, m}. */
function otrTitleMonth_(t) {
  var m = String(t == null ? '' : t).trim().match(/^([A-Za-z]{3,9})\.?\s+'?(\d{2}|\d{4})\b/);
  if (!m) return null;
  var i = OTR_CORE.MONTHS.map(function (x) { return x.toLowerCase(); }).indexOf(m[1].slice(0, 3).toLowerCase());
  if (i < 0) return null;
  var y = Number(m[2]);
  return {y: y < 100 ? y + 2000 : y, m: i + 1};
}

function otrCellDateKey_(v, yearHint) {
  if (v instanceof Date && !isNaN(v)) return otrDateKey_(v.getFullYear(), v.getMonth() + 1, v.getDate());
  var t = String(v == null ? '' : v).trim(), m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (m) {
    var y = m[3] ? Number(m[3]) : Number(yearHint);
    if (y < 100) y += 2000;
    return y ? otrDateKey_(y, Number(m[1]), Number(m[2])) : null;
  }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
}

function otrCellMonth_(v, yearHint) {
  if (v instanceof Date && !isNaN(v)) return {y: v.getFullYear(), m: v.getMonth() + 1};
  var t = String(v == null ? '' : v).trim();
  var m = t.match(/^([A-Za-z]{3})[a-z]*\.?\s*'?(\d{2}|\d{4})?$/);
  if (!m) return null;
  var mi = OTR_CORE.MONTHS.map(function (x) { return x.toLowerCase(); }).indexOf(m[1].toLowerCase());
  if (mi < 0) return null;
  var y = m[2] ? Number(m[2]) : Number(yearHint);
  if (y && y < 100) y += 2000;
  return y ? {y: y, m: mi + 1} : null;
}

/**
 * Sheets API rowData -> the rectangular grid Range.getValues() gives: numbers, text, true/false, '' for empty, and a
 * local-midnight Date for cells formatted as a date (the serial number counts days from 12/30/1899). Error cells keep
 * their shown text (#N/A).
 */
function otrGridValues_(rowData) {
  var rows = (rowData || []).map(function (row) {
    return ((row && row.values) || []).map(function (c) {
      var v = c && c.effectiveValue, type = c && c.effectiveFormat && c.effectiveFormat.numberFormat && c.effectiveFormat.numberFormat.type;
      if (!v) return '';
      if (v.errorValue) return c.formattedValue || '';
      if (v.boolValue != null) return v.boolValue;
      if (v.stringValue != null) return v.stringValue;
      if (v.numberValue == null) return '';
      if (type === 'DATE' || type === 'DATE_TIME') {
        var ms = Math.round((v.numberValue - 25569) * 86400000), u = new Date(ms);
        return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds());
      }
      return v.numberValue;
    });
  });
  var width = rows.reduce(function (w, r) { return Math.max(w, r.length); }, 0);
  while (rows.length && rows[rows.length - 1].every(function (x) { return x === ''; })) rows.pop();
  return rows.map(function (r) { while (r.length < width) r.push(''); return r; });
}

  return { OTR_CORE: OTR_CORE, otrNum_: otrNum_, otrFlagOn_: otrFlagOn_, otrNormDest_: otrNormDest_, otrDateKey_: otrDateKey_, otrParseKey_: otrParseKey_, otrAddDays_: otrAddDays_, otrWeekday_: otrWeekday_, otrShortDate_: otrShortDate_, otrRouteList_: otrRouteList_, otrCountDay_: otrCountDay_, otrScheduled_: otrScheduled_, otrMergeDaily_: otrMergeDaily_, otrMonthRuns_: otrMonthRuns_, otrFigureMap_: otrFigureMap_, otrCostPerGallon_: otrCostPerGallon_, otrSum_: otrSum_, otrYearReport_: otrYearReport_, otrDashboard_: otrDashboard_, otrDailyCountText_: otrDailyCountText_, otrParseImport_: otrParseImport_, otrMergeImport_: otrMergeImport_, otrImportSummary_: otrImportSummary_, otrRound2_: otrRound2_, otrMonthName_: otrMonthName_, otrTitleMonth_: otrTitleMonth_, otrCellDateKey_: otrCellDateKey_, otrCellMonth_: otrCellMonth_, otrGridValues_: otrGridValues_ };
});
