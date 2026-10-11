/*
 * Plant Production's rules (Joe 10/11: our own RedZone), shared by the screens and the server (one file, copied unchanged
 * to public/js/production-rules.js; a unit test checks the two match).
 *
 *   - the lines are the plant's production machines (PRODUCTION_AREA in Plant Operations); each line has its products
 *     (Administration > Products, one list per plant) and, on that same list, each product's UPC, shelf life, full speed per minute, Target %
 *     and allowed speed range (lowest and highest per minute). The starting speeds and Target % are RedZone's;
 *   - target per hour = full speed per minute x 60 x Target %;
 *   - a line's shift is the plant's Plant Production shift running now (Plant Shifts), else its Distribution shift, else
 *     Uniontown's 6:00 AM-2:30 PM, 2:00 PM-10:30 PM and 10:00 PM-5:30 AM; where two overlap, the newer one is the shift;
 *   - the line tablet records the product running (each change starts a new run), the count made this shift, when the line
 *     stopped and started again, and why it stopped; target so far adds up each product's target per hour for the time it ran;
 *   - speed is jugs per minute between the last two counts; it flashes when it is outside the product's allowed range;
 *   - a line is green at or ahead of target, yellow up to 10% behind, red more than 10% behind or stopped;
 *   - the code date a product should carry is the shift's day plus its shelf life (OCT 25).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UDProduction = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var COUNTERS = ['TABLET', 'SENSOR', 'READER'];
  var COUNTER_LABEL = { TABLET: 'Typed by operator', SENSOR: 'Sensor (counts only)', READER: 'Label reader (counts, product and date)' };
  // The reasons a line stops (Joe picked the big-button tablet, 10/11).
  var REASONS = ['Changeover', 'Waiting on product', 'Filler jam', 'Caser jam', 'Labeler / coder', 'Cap feed', 'Out of cases or crates', 'Sanitation / CIP', 'Break or lunch', 'Maintenance called', 'No orders', 'Other'];
  var START_SHIFTS = [{ name: 'First Shift', start: '06:00', end: '14:30' }, { name: 'Second Shift', start: '14:00', end: '22:30' }, { name: 'Third Shift', start: '22:00', end: '05:30' }];
  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function num(v) { if (v === null || v === undefined || text(v) === '') return null; var n = Number(v); return isFinite(n) ? n : null; }
  function when(v) { var t = Date.parse(v || ''); return isFinite(t) ? t : 0; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function slug(v) { return text(v).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40); }

  function targetPerHour(t) {
    var rate = num(t && t.ratePerMin), pct = num(t && t.targetPct);
    return rate && pct ? Math.round(rate * 60 * pct / 100) : 0;
  }

  // The shifts this plant's production runs on (saved = the plantShifts doc's shifts).
  function productionShifts(saved) {
    var list = Array.isArray(saved) ? saved : [];
    var prod = list.filter(function (s) { return text(s.side).toUpperCase() === 'PRODUCTION'; });
    if (prod.length) return prod;
    var dist = list.filter(function (s) { return text(s.side).toUpperCase() !== 'PRODUCTION'; });
    return dist.length ? dist : START_SHIFTS;
  }
  function minutesOf(hhmm) { var m = /^(\d\d):(\d\d)$/.exec(text(hhmm)); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
  // The shift running at nowMs (the tablet's own clock): {name, key, date, start, end (ISO), hours}. Of two that overlap, the
  // one that started last. No shift running: the whole day.
  function shiftNow(saved, nowMs) {
    var now = new Date(nowMs), best = null;
    productionShifts(saved).forEach(function (s) {
      var a = minutesOf(s.start), b = minutesOf(s.end);
      if (a === null || b === null) return;
      [-1, 0].forEach(function (back) {
        var st = new Date(now.getFullYear(), now.getMonth(), now.getDate() + back, Math.floor(a / 60), a % 60);
        var en = new Date(st.getFullYear(), st.getMonth(), st.getDate() + (b <= a ? 1 : 0), Math.floor(b / 60), b % 60);
        if (st.getTime() <= nowMs && nowMs < en.getTime() && (!best || st.getTime() > best.st.getTime())) best = { s: s, st: st, en: en };
      });
    });
    if (!best) {
      var d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()), d1 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      best = { s: { name: 'Today' }, st: d0, en: d1 };
    }
    var date = dayKey(best.st);
    return { name: text(best.s.name), key: date + '_' + slug(best.s.name), date: date, start: best.st.toISOString(), end: best.en.toISOString(), hours: (best.en - best.st) / 3600000 };
  }
  function shiftHours(saved) {
    var s = productionShifts(saved)[0], a = minutesOf(s && s.start), b = minutesOf(s && s.end);
    if (a === null || b === null) return 8;
    return ((b - a + 1440) % 1440 || 1440) / 60;
  }
  function runId(operationId, shiftKey) { return text(operationId) + '__' + text(shiftKey); }

  // The target fields each product keeps on its plant's Products list (Joe 10/11: one product list, everything about a product
  // on it), as Line Targets and the template name them.
  var TARGET_FIELDS = ['upc', 'shelfLifeDays', 'ratePerMin', 'targetPct', 'minSpeed', 'maxSpeed'];
  // A line's products (its Products list rows) with their numbers and target per hour.
  function targetsFor(products) {
    return (products || []).filter(function (p) { return text(p && p.name); }).map(function (p) {
      var t = { name: text(p.name), sku: text(p.sku), mfgType: text(p.mfgType), productGroup: text(p.productGroup) };
      TARGET_FIELDS.forEach(function (k) { t[k] = k === 'upc' ? text(p[k]) : num(p[k]); });
      t.perHour = targetPerHour(t);
      return t;
    });
  }

  // Minutes the line was stopped (stops = [{start, end, reason}]; an open stop runs to nowMs).
  function stopMinutes(stops, nowMs) {
    return Math.round((stops || []).reduce(function (n, s) { var a = when(s.start), b = s.end ? when(s.end) : nowMs; return n + Math.max(0, b - a); }, 0) / 60000);
  }
  // Jugs per minute between the last two counts at least a minute apart (counts = [{at, count}]).
  function speedOf(counts) {
    var c = (counts || []).filter(function (x) { return when(x.at) && num(x.count) !== null; });
    if (c.length < 2) return null;
    var last = c[c.length - 1];
    for (var i = c.length - 2; i >= 0; i--) {
      var mins = (when(last.at) - when(c[i].at)) / 60000;
      if (mins >= 1) return Math.max(0, Math.round((num(last.count) - num(c[i].count)) / mins));
    }
    return null;
  }
  function speedFlag(speed, t) {
    if (speed === null || speed === undefined || !t) return '';
    var lo = num(t.minSpeed), hi = num(t.maxSpeed);
    if (hi !== null && speed > hi) return 'OVER';
    if (lo !== null && speed < lo) return 'UNDER';
    return lo === null && hi === null ? '' : 'OK';
  }
  // The code date a product should carry: the shift's day plus its shelf life ('OCT 25').
  function codeDate(dateKey, days) {
    var n = num(days), m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(text(dateKey));
    if (n === null || !m) return '';
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n);
    return MONTHS[d.getMonth()] + ' ' + pad(d.getDate());
  }

  // Everything the tablet and the TV show for one line this shift. run = the productionRuns doc (or null); targets = targetsFor().
  function lineNow(run, targets, nowMs) {
    var r = run || {}, byName = {};
    (targets || []).forEach(function (t) { byName[t.name.toUpperCase()] = t; });
    var product = text(r.product), t = byName[product.toUpperCase()] || null;
    var end = Math.min(nowMs, when(r.shiftEnd) || nowMs);
    // Target so far: each product's target per hour for the time it ran (from its change until the next one).
    var runs = (r.runs || []).slice().sort(function (a, b) { return when(a.from) - when(b.from); }), so = 0;
    runs.forEach(function (x, i) {
      var a = when(x.from), b = i + 1 < runs.length ? when(runs[i + 1].from) : end, tt = byName[text(x.product).toUpperCase()];
      if (tt && b > a) so += tt.perHour * (b - a) / 3600000;
    });
    so = Math.round(so);
    var made = num(r.count) || 0, open = (r.stops || []).filter(function (s) { return !s.end; })[0] || null;
    var needs = (r.stops || []).map(function (s, i) { return { s: s, i: i }; }).filter(function (x) { return x.s.end && !text(x.s.reason); });
    var pct = so ? Math.round(made / so * 100) : null;
    var speed = open ? 0 : speedOf(r.counts);
    var state = !run ? 'IDLE' : open ? 'STOPPED' : 'RUNNING';
    var color = state === 'IDLE' ? 'x' : open ? 'r' : pct === null ? 'g' : pct >= 100 ? 'g' : pct >= 90 ? 'a' : 'r';
    return { product: product, sku: text(r.sku), target: t, perHour: t ? t.perHour : 0, made: made, soFar: so, pct: pct, behind: Math.max(0, so - made), state: state, color: color,
      stoppedAt: open ? open.start : '', stoppedMin: open ? Math.round((nowMs - when(open.start)) / 60000) : 0, stopIndex: open ? (r.stops || []).indexOf(open) : -1, openReason: open ? text(open.reason) : '',
      downMin: stopMinutes(r.stops, nowMs), stops: (r.stops || []).length, needReason: needs.map(function (x) { return { index: x.i, start: x.s.start, minutes: Math.round((when(x.s.end) - when(x.s.start)) / 60000) }; }),
      speed: speed, speedFlag: open ? '' : speedFlag(speed, t), expectedCode: t ? codeDate(r.date, t.shelfLifeDays) : '',
      // The label reader's feed (when one is on the line): what it read on the last jug and the shift's tallies.
      reader: r.reader && typeof r.reader === 'object' ? r.reader : null };
  }

  return { COUNTERS: COUNTERS, COUNTER_LABEL: COUNTER_LABEL, REASONS: REASONS, START_SHIFTS: START_SHIFTS, targetPerHour: targetPerHour, productionShifts: productionShifts,
    shiftNow: shiftNow, shiftHours: shiftHours, runId: runId, TARGET_FIELDS: TARGET_FIELDS, targetsFor: targetsFor, stopMinutes: stopMinutes, speedOf: speedOf, speedFlag: speedFlag, codeDate: codeDate, lineNow: lineNow };
});
