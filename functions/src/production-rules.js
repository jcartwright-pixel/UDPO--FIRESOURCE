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
  var COUNTERS = ['TABLET', 'SENSOR', 'READER', 'CONTROLLER'];
  var COUNTER_LABEL = { TABLET: 'Typed by operator', SENSOR: 'Sensor (counts only)', READER: 'Label reader (counts, product and date)', CONTROLLER: 'Machine controller (read-only)' };
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

  // ---------- More for every line (Joe 10/14: "all of your picks", mock-ups A to H) ----------
  // The kind of line decides its tablet, waste reasons, changeover checklist and quality check (plant-rules lineKey names).
  function lineKind(name) {
    var k = text(name).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (/^HTST/.test(k)) return 'HTST';
    if (k === 'BLOWMOLD') return 'BLOWMOLD';
    if (k === 'BOXING' || k === 'RAYPAK' || k === 'TOTES') return 'PACK';
    return 'FILLER';
  }
  var KIND_LABEL = { FILLER: 'Fillers', HTST: 'HTST', PACK: 'Boxing & Totes', BLOWMOLD: 'Blow Mold' };
  var WASTE_REASONS = {
    FILLER: ['Underfill (scale)', 'Leaker', 'Bad cap', 'Bad label', 'Bad code date', 'Changeover purge', 'Dropped / damaged', 'Other'],
    PACK: ['Leaker', 'Bad seal', 'Bad label', 'Bad code date', 'Changeover purge', 'Damaged', 'Other'],
    HTST: ['Startup / flush (gal)', 'Divert (gal)', 'Changeover purge (gal)', 'Other (gal)'],
    BLOWMOLD: ['Leak tester', 'Thin wall / short shot', 'Bad trim', 'Contaminated', 'Startup', 'Other']
  };
  // The changeover checklist (mock-up D); Blow Mold's changeover is its mold change.
  var CHANGEOVER_CHECKS = {
    FILLER: [['purge', 'Product line purged', ''], ['labels', 'Labels changed to the new product', ''], ['caps', 'Caps changed (color)', ''], ['code', 'Code date set and read', ''], ['first', 'First jugs checked (fill, cap, label)', 'tap when 5 are good'], ['flush', 'Allergen / flavor flush done', 'only for chocolate to white']],
    PACK: [['purge', 'Product line purged', ''], ['labels', 'Labels or box changed to the new product', ''], ['code', 'Code date set and read', ''], ['first', 'First units checked (seal, label)', ''], ['flush', 'Allergen / flavor flush done', 'only for chocolate to white']],
    HTST: [['flush', 'Product flushed (water push)', ''], ['valves', 'Valves set to the new product\'s tanks', ''], ['allergen', 'Allergen / flavor flush done', 'only for chocolate to white'], ['first', 'First product checked (temp, taste, look)', '']],
    BLOWMOLD: [['mold', 'Mold changed', ''], ['weight', 'Bottle weight checked', ''], ['leak', 'Leak tester checked', '']]
  };
  // The quality check each kind records (mock-ups E, G, H): every 2 hours, the HTST chart check every hour.
  var CHECK_FIELDS = {
    FILLER: [['w1', 'Jug 1 lb', 'num'], ['w2', 'Jug 2 lb', 'num'], ['w3', 'Jug 3 lb', 'num'], ['w4', 'Jug 4 lb', 'num'], ['w5', 'Jug 5 lb', 'num'], ['capSeal', 'Cap and seal', 'ok'], ['codeOk', 'Code date readable', 'ok'], ['temp', 'Product temp °F', 'num']],
    PACK: [['capSeal', 'Seal', 'ok'], ['codeOk', 'Code date readable', 'ok'], ['temp', 'Product temp °F', 'num']],
    HTST: [['recorder', 'Recorder °F', 'num'], ['indicating', 'Indicating °F', 'num'], ['pen', 'Pen on time', 'ok'], ['flow', 'Flow GPM', 'num']],
    // Joe 10/14: a six-head blow mold, so every check weighs a jug from each of heads 1 to 6 in grams (the Blow Mold quality
    // check's same six: head1 to head6).
    BLOWMOLD: [['head1', 'Head 1 g', 'num'], ['head2', 'Head 2 g', 'num'], ['head3', 'Head 3 g', 'num'], ['head4', 'Head 4 g', 'num'], ['head5', 'Head 5 g', 'num'], ['head6', 'Head 6 g', 'num'], ['topLoad', 'Top load', 'ok']]
  };
  var CHECK_EVERY = { FILLER: 2, PACK: 2, HTST: 1, BLOWMOLD: 2 };
  // Why a line stopped, for each kind of line (Joe 10/14 follow-on: "stop reasons for each kind of line"). The fillers keep the
  // first twelve (REASONS); each list is twelve, the tablet's four rows of three.
  var STOP_REASONS = {
    FILLER: REASONS,
    PACK: ['Waiting on product', 'Box or tote jam', 'Sealer / glue', 'Labeler / coder', 'Out of boxes or film', 'Out of totes or crates', 'Changeover', 'Sanitation / CIP', 'Break or lunch', 'Maintenance called', 'No orders', 'Other'],
    HTST: ['Divert / low temp', 'Pump or flow problem', 'Waiting on silo / raw milk', 'Tanks full (no room)', 'Changeover / flush', 'Sanitation / CIP', 'Seal or test (inspector)', 'Air, steam or water', 'Break or lunch', 'Maintenance called', 'No orders', 'Other'],
    BLOWMOLD: ['Mold change', 'Resin feed', 'Leak tester down', 'Trimmer jam', 'Conveyor / bottle jam', 'Heater / temperature', 'Compressed air', 'Filler backed up (jugs full)', 'Cleaning', 'Break or lunch', 'Maintenance called', 'Other']
  };
  function stopReasons(kind) { return STOP_REASONS[kind] || REASONS; }
  var DIVERT_REASONS = ['Low temperature', 'Flow too high', 'Startup', 'Power or air', 'Test', 'Other'];
  // A machine's own controller (Joe 10/14, the Blow Mold): READ-ONLY, and only the three readings Joe named: the jug count,
  // the speed and the temperature. The line PC (tools/device-bridge) reads them; Line Targets keeps the setup in
  // productionLines/{id}.controller, one box at a time (controllerField checks each box).
  var CONTROLLER_BRANDS = [['AB', 'Allen-Bradley ControlLogix / CompactLogix'], ['AB_MICRO', 'Allen-Bradley Micro800'], ['MODBUS', 'Modbus TCP (many brands)'], ['S7', 'Siemens S7']];
  var CONTROLLER_PORTS = { AB: 44818, AB_MICRO: 44818, MODBUS: 502, S7: 102 };
  var READINGS = [['count', 'Jug count'], ['speed', 'Speed'], ['temp', 'Temperature']];
  var TAG_HELP = { AB: 'the tag name as it shows in the controller program, like Jug_Count or Counter1.ACC', AB_MICRO: 'the tag name as it shows in the controller program, like Jug_Count',
    MODBUS: 'the register number, like 40001, 30001 or HR 100', S7: 'the address, like DB10.DBD4 (4 bytes) or DB10.DBW2 (2 bytes)' };
  var CONTROLLER_FIELDS = ['brand', 'ip', 'port', 'slot', 'rack', 'unit', 'wordOrder', 'countTag', 'countSize', 'speedName', 'speedTag', 'speedSize', 'speedDivide', 'speedLow', 'speedHigh', 'tempTag', 'tempSize', 'tempDivide', 'tempLow', 'tempHigh'];
  function tagOk(brand, tag) {
    var t = text(tag);
    if (brand === 'MODBUS') return /^(HR|IR)\s*:?\s*\d{1,5}$/i.test(t) || /^[34]\d{4,5}$/.test(t) || /^\d{1,5}$/.test(t);
    if (brand === 'S7') return /^DB\d{1,5}\.DB[DW]\d{1,5}$/i.test(t.replace(/\s+/g, '')) || /^M[DW]\d{1,5}$/i.test(t.replace(/\s+/g, ''));
    return t.length <= 200 && /^(Program:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*(\[\d+\])*(\.[A-Za-z_][A-Za-z0-9_]*(\[\d+\])*)*$/.test(t);
  }
  // One box of the controller setup: { value } to keep (null = empty) or { error } in plain words.
  function controllerField(field, value, brand) {
    var v = text(value), n = Number(v), whole = function (lo, hi, what) { return v === '' ? { value: null } : /^\d+$/.test(v) && n >= lo && n <= hi ? { value: n } : { error: what + ' must be a whole number from ' + lo + ' to ' + hi + '.' }; };
    if (CONTROLLER_FIELDS.indexOf(field) < 0) return { error: 'Unknown controller box.' };
    if (field === 'brand') return v === '' || CONTROLLER_BRANDS.some(function (b) { return b[0] === v; }) ? { value: v || null } : { error: 'Pick the controller\'s brand.' };
    if (field === 'ip') {
      if (v === '') return { value: null };
      var parts = v.split('.');
      return parts.length === 4 && parts.every(function (x) { return /^\d{1,3}$/.test(x) && Number(x) <= 255; }) ? { value: v } : { error: 'Type the controller\'s IP address like 192.168.1.20.' };
    }
    if (field === 'port') return whole(1, 65535, 'The port');
    if (field === 'slot') return whole(0, 31, 'The slot');
    if (field === 'rack') return whole(0, 7, 'The rack');
    if (field === 'unit') return whole(0, 255, 'The unit id');
    if (field === 'speedName') return v.length <= 30 ? { value: v || null } : { error: 'Keep the speed\'s name to 30 letters, like Annealer speed.' };
    if (field === 'wordOrder') return v === '' || v === 'HIGH_FIRST' || v === 'LOW_FIRST' ? { value: v || null } : { error: 'Pick the word order.' };
    if (/Size$/.test(field)) return v === '' || v === '16' || v === '32' ? { value: v ? Number(v) : null } : { error: 'Pick 16 or 32 bits.' };
    if (/Tag$/.test(field)) {
      if (v === '') return { value: null };
      if (!brand) return { error: 'Pick the controller\'s brand first.' };
      return tagOk(brand, v) ? { value: v } : { error: 'Type ' + TAG_HELP[brand] + '.' };
    }
    if (v === '') return { value: null };
    if (!isFinite(n) || v.length > 12) return { error: 'Type a number.' };
    if (/Divide$/.test(field)) return n > 0 && n <= 100000 ? { value: n } : { error: 'Divide by must be a number above 0, like 10 when the controller sends 4312 for 431.2.' };
    return Math.abs(n) <= 100000 ? { value: n } : { error: 'Type a number.' };
  }
  // A Blow Mold head's jug weight against the line's range on Line Targets (lineDoc.jugWeightLow / jugWeightHigh): 'HEAVY',
  // 'LIGHT' or ''. Only the head boxes are weighed.
  function weightFlag(field, value, lineDoc) {
    if (!/^head\d$/.test(field)) return '';
    var f = machineFlag(value, (lineDoc || {}).jugWeightLow, (lineDoc || {}).jugWeightHigh);
    return f === 'HIGH' ? 'HEAVY' : f === 'LOW' ? 'LIGHT' : '';
  }
  // A reading outside its range: 'HIGH', 'LOW' or ''.
  function machineFlag(value, low, high) {
    var v = num(value), lo = num(low), hi = num(high);
    if (v === null) return '';
    if (lo !== null && v < lo) return 'LOW';
    if (hi !== null && v > hi) return 'HIGH';
    return '';
  }
  // What the controller last sent this shift (run.machine), with the line's ranges (lineDoc.controller). Stale after 2 minutes.
  // Joe 10/14: on the Blow Mold the speed is the annealer speed (like 70), unless Line Targets names it otherwise.
  function speedNameFor(kind, c) { return text((c || {}).speedName) || (kind === 'BLOWMOLD' ? 'Annealer speed' : 'Speed'); }
  function machineNow(run, lineDoc, nowMs, kind) {
    var m = (run || {}).machine, c = ((lineDoc || {}).controller) || {};
    if (!m || typeof m !== 'object') return null;
    var at = when(m.at), o = { at: text(m.at), stale: !at || nowMs - at > 120000, counter: num(m.counter), speed: num(m.speed), temp: num(m.temp),
      speedName: speedNameFor(kind, c), speedLow: num(c.speedLow), speedHigh: num(c.speedHigh), tempLow: num(c.tempLow), tempHigh: num(c.tempHigh), speedOutSince: text(m.speedOutSince), tempOutSince: text(m.tempOutSince), lastMoveAt: text(m.lastMoveAt) };
    o.speedFlag = machineFlag(o.speed, o.speedLow, o.speedHigh);
    o.tempFlag = machineFlag(o.temp, o.tempLow, o.tempHigh);
    var log = Array.isArray(run.machineLog) ? run.machineLog : [];
    ['speed', 'temp'].forEach(function (k) {
      var vals = log.map(function (x) { return num(x && x[k]); }).filter(function (x) { return x !== null; });
      o[k + 'Min'] = vals.length ? Math.min.apply(null, vals) : null;
      o[k + 'Max'] = vals.length ? Math.max.apply(null, vals) : null;
      o[k + 'OutMin'] = log.filter(function (x) { return machineFlag(x && x[k], o[k + 'Low'], o[k + 'High']); }).length;
    });
    return o;
  }

  var LIMITS = { WASTE: 999999, CREW: 30, NOTE: 1000, DIVERTS: 200, CHANGEOVERS: 60, CIPS: 20, CHECK_SLOTS: 30 };

  function overlap(a, b, c, d) { return Math.max(0, Math.min(b, d) - Math.max(a, c)); }
  function openOf(list) { return (list || []).filter(function (x) { return x && x.start && !x.end; })[0] || null; }
  function spanMinutes(list, nowMs, a, b) {
    return Math.round((list || []).reduce(function (n, x) { var s = when(x.start), e = x.end ? when(x.end) : nowMs; return n + (a === undefined ? Math.max(0, e - s) : overlap(s, e, a, b)); }, 0) / 60000);
  }
  // The count made at time t (the last count at or before it; 0 before the first).
  function countAt(counts, t) {
    var n = 0;
    (counts || []).forEach(function (c) { if (when(c.at) <= t && num(c.count) !== null) n = num(c.count); });
    return n;
  }
  // Which check of the shift is now due (every CHECK_EVERY hours from the shift's start), and whether it is done.
  function checkDue(run, kind, nowMs) {
    var r = run || {}, start = when(r.shiftStart), every = (CHECK_EVERY[kind] || 2) * 3600000, fields = CHECK_FIELDS[kind] || [];
    if (!start || nowMs < start) return null;
    var slot = Math.floor((nowMs - start) / every), at = start + slot * every, got = (r.checks || {})[String(slot)] || {};
    var done = fields.every(function (f) { return text(got[f[0]]) !== ''; });
    return { slot: slot, at: new Date(at).toISOString(), next: new Date(at + every).toISOString(), done: done, values: got, filled: fields.filter(function (f) { return text(got[f[0]]) !== ''; }).length, of: fields.length };
  }

  // Everything mock-ups A to H add for one line this shift (run = productionRuns doc, line = productionLines doc).
  function lineMore(run, targets, nowMs, kind, lineDoc) {
    var r = run || {}, ld = lineDoc || {}, base = lineNow(run, targets, nowMs);
    var co = openOf(r.changeovers), cip = openOf(r.cips), dv = openOf(r.diverts);
    var waste = r.waste && typeof r.waste === 'object' ? r.waste : {}, wasteTotal = 0;
    Object.keys(waste).forEach(function (k) { wasteTotal += num(waste[k]) || 0; });
    // The reason that cost the most minutes this shift.
    var byReason = {};
    (r.stops || []).forEach(function (x) { var k = text(x.reason) || 'No reason yet', m = (x.end ? when(x.end) : nowMs) - when(x.start); byReason[k] = (byReason[k] || 0) + Math.max(0, m); });
    var top = Object.keys(byReason).sort(function (a, b) { return byReason[b] - byReason[a]; })[0] || '';
    var crewOn = (r.crew || []).filter(function (c) { return c && c.on; });
    // Line efficiency (OEE): running time x speed x good product, from the line's first product of the shift until now.
    var runs = (r.runs || []).slice().sort(function (a, b) { return when(a.from) - when(b.from); });
    var end = Math.min(nowMs, when(r.shiftEnd) || nowMs), first = runs.length ? when(runs[0].from) : 0, eff = null;
    if (first && end > first) {
      var cipMin = spanMinutes(r.cips, nowMs, first, end), brk = 0, down = 0;
      (r.stops || []).forEach(function (x) { var m = overlap(when(x.start), x.end ? when(x.end) : nowMs, first, end) / 60000; if (/break|lunch/i.test(text(x.reason))) brk += m; else down += m; });
      var planned = (end - first) / 60000 - cipMin - brk, coMin = spanMinutes(r.changeovers, nowMs, first, end), running = Math.max(0, planned - down - coMin);
      var byName = {}, ideal = 0;
      (targets || []).forEach(function (t) { byName[t.name.toUpperCase()] = t; });
      runs.forEach(function (x, i) {
        var a = when(x.from), b = i + 1 < runs.length ? when(runs[i + 1].from) : end, t = byName[text(x.product).toUpperCase()];
        if (t && num(t.ratePerMin) && b > a && planned > 0) ideal += num(t.ratePerMin) * ((b - a) / 60000) * (running / Math.max(1, (end - first) / 60000));
      });
      var made = base.made, w = Math.min(wasteTotal, made);
      var avail = planned > 0 ? running / planned : null, perf = ideal > 0 ? made / ideal : null, quality = made > 0 ? (made - w) / made : null;
      var pct = function (v) { return v === null ? null : Math.round(v * 100); };
      eff = { running: pct(avail), speed: pct(perf), good: pct(quality), oee: avail === null || perf === null || quality === null ? null : Math.round(avail * Math.min(1, perf) * quality * 100), runningMin: Math.round(running), plannedMin: Math.round(planned) };
    }
    var state = base.state, color = base.color;
    if (state !== 'STOPPED' && cip) { state = 'CIP'; color = 'b'; } else if (state !== 'STOPPED' && co) { state = 'CHANGEOVER'; color = 'b'; }
    var lastCip = when(cip ? '' : ld.lastCipAt), sinceCip = lastCip ? Math.round((nowMs - lastCip) / 360000) / 10 : null;
    return Object.assign(base, {
      kind: kind, state: state, color: color,
      changeover: co ? { start: co.start, from: text(co.from), to: text(co.to), minutes: Math.round((nowMs - when(co.start)) / 60000), index: (r.changeovers || []).indexOf(co), checks: co.checks || {} } : null,
      changeovers: (r.changeovers || []).map(function (x) { return { start: x.start, end: x.end || null, from: text(x.from), to: text(x.to), minutes: Math.round(((x.end ? when(x.end) : nowMs) - when(x.start)) / 60000), by: text(x.by) }; }),
      changeoverStd: num(ld.changeoverMin),
      cip: cip ? { start: cip.start, minutes: Math.round((nowMs - when(cip.start)) / 60000) } : null,
      cips: (r.cips || []).map(function (x) { return { start: x.start, end: x.end || null, result: text(x.result), minutes: Math.round(((x.end ? when(x.end) : nowMs) - when(x.start)) / 60000) }; }),
      sinceCipHours: sinceCip, cipHours: num(ld.cipHours), lastCipAt: text(ld.lastCipAt),
      waste: waste, wasteTotal: wasteTotal, topReason: top, topReasonMin: top ? Math.round(byReason[top] / 60000) : 0,
      crew: (r.crew || []).map(function (c) { return { name: text(c.name), on: !!c.on, at: c.at }; }), crewOn: crewOn.map(function (c) { return text(c.name); }),
      efficiency: eff, check: checkDue(run, kind, nowMs),
      diverting: dv ? { start: dv.start, reason: text(dv.reason), minutes: Math.round((nowMs - when(dv.start)) / 60000) } : null,
      diverts: (r.diverts || []).length, lastDivertAt: (r.diverts || []).length ? r.diverts[r.diverts.length - 1].start : text(ld.lastDivertAt),
      source: r.source && typeof r.source === 'object' ? { from: text(r.source.from), to: text(r.source.to) } : { from: '', to: '' },
      machine: machineNow(r, ld, nowMs, kind),
      jugWeight: { target: num(ld.jugWeightTarget), low: num(ld.jugWeightLow), high: num(ld.jugWeightHigh) },
      lot: text(r.lot), stock: num(r.stock), note: text(r.note), next: ld.next && typeof ld.next === 'object' && text(ld.next.product) ? { product: text(ld.next.product), qty: num(ld.next.qty) } : null
    });
  }

  // Hour by hour from the shift's start (mock-ups B and C): made, target, % and stopped minutes for each hour up to now.
  function hourly(run, targets, nowMs) {
    var r = run || {}, start = when(r.shiftStart), stop = when(r.shiftEnd), out = [];
    if (!start || !stop) return out;
    var byName = {};
    (targets || []).forEach(function (t) { byName[t.name.toUpperCase()] = t; });
    var runs = (r.runs || []).slice().sort(function (a, b) { return when(a.from) - when(b.from); });
    for (var a = start; a < stop; a += 3600000) {
      var b = Math.min(a + 3600000, stop), past = a < nowMs, end = Math.min(b, nowMs), target = 0, names = [];
      runs.forEach(function (x, i) {
        var s = when(x.from), e = i + 1 < runs.length ? when(runs[i + 1].from) : stop, t = byName[text(x.product).toUpperCase()], o = overlap(s, e, a, end);
        if (o > 0) { if (names.indexOf(text(x.product)) < 0) names.push(text(x.product)); if (t) target += t.perHour * o / 3600000; }
      });
      var made = past ? Math.max(0, countAt(r.counts, end) - countAt(r.counts, a)) : 0;
      target = Math.round(target);
      // The machine's speed and temperature (a controller line), the hour's average of its minute readings.
      var avg = function (k) { var vals = (r.machineLog || []).filter(function (x) { var t = when(x && x.at); return t >= a && t < end; }).map(function (x) { return num(x[k]); }).filter(function (x) { return x !== null; });
        return vals.length ? Math.round(vals.reduce(function (n, x) { return n + x; }, 0) / vals.length * 10) / 10 : null; };
      out.push({ from: new Date(a).toISOString(), to: new Date(b).toISOString(), past: past, now: a <= nowMs && nowMs < b, products: names, made: made, target: target, pct: target ? Math.round(made / target * 100) : null,
        speed: past ? avg('speed') : null, temp: past ? avg('temp') : null,
        stopped: past ? Math.round((r.stops || []).reduce(function (n, x) { return n + overlap(when(x.start), x.end ? when(x.end) : nowMs, a, end); }, 0) / 60000) : 0 });
    }
    return out;
  }

  // The shift as coloured pieces (mock-up B): run, stop, brk (break), co (changeover), cip, idle (before the first product), left (still to come).
  function timeline(run, nowMs) {
    var r = run || {}, start = when(r.shiftStart), stop = when(r.shiftEnd), out = [];
    if (!start || !stop) return out;
    var runs = (r.runs || []).slice().sort(function (a, b) { return when(a.from) - when(b.from); }), first = runs.length ? when(runs[0].from) : Infinity;
    var inAny = function (list, t) { return (list || []).filter(function (x) { return when(x.start) <= t && t < (x.end ? when(x.end) : nowMs); })[0] || null; };
    for (var t = start; t < stop; t += 60000) {
      var k;
      if (t >= nowMs) k = 'left';
      else if (inAny(r.cips, t)) k = 'cip';
      else if (inAny(r.changeovers, t)) k = 'co';
      else { var st = inAny(r.stops, t); k = st ? (/break|lunch/i.test(text(st.reason)) ? 'brk' : 'stop') : t < first ? 'idle' : 'run'; }
      var last = out[out.length - 1];
      if (last && last.kind === k) last.minutes++; else out.push({ kind: k, from: new Date(t).toISOString(), minutes: 1 });
    }
    return out;
  }

  // The weekly line scorecard (Joe 10/14 follow-on): each line's shifts of the week added up (runs = productionRuns docs for the
  // week, lines = [{ operationId, name }], targetsOf(operationId) = that line's targets, lineDocs = productionLines by id).
  // Efficiency is weighted by each shift's planned minutes; stop reasons are ranked by minutes lost, across the plant too.
  function weekScore(runs, lines, targetsOf, lineDocs, nowMs) {
    var byLine = {}, plantReasons = {};
    (lines || []).forEach(function (l) { byLine[l.operationId] = { operationId: l.operationId, line: l.name, kind: lineKind(l.name), shifts: 0, made: 0, soFar: 0, downMin: 0, stops: 0, wasteTotal: 0, changeovers: 0, changeoverMin: 0, overStd: 0, cips: 0, reasons: {}, effMin: 0, effSum: 0 }; });
    (runs || []).forEach(function (r) {
      var o = byLine[r.operationId];
      if (!o) return;
      var end = Math.min(nowMs, when(r.shiftEnd) || nowMs), ld = (lineDocs || {})[r.operationId] || {}, v = lineMore(r, targetsOf(r.operationId), end, o.kind, ld);
      if (!v.made && !v.stops && !v.wasteTotal && !(r.runs || []).length) return;
      o.shifts++; o.made += v.made; o.soFar += v.soFar; o.downMin += v.downMin; o.stops += v.stops; o.wasteTotal += v.wasteTotal; o.cips += v.cips.length;
      v.changeovers.forEach(function (c) { o.changeovers++; o.changeoverMin += c.minutes; if (v.changeoverStd && c.minutes > v.changeoverStd) o.overStd++; });
      (r.stops || []).forEach(function (x) {
        var k = text(x.reason) || 'No reason given', m = Math.max(0, Math.round(((x.end ? when(x.end) : end) - when(x.start)) / 60000));
        o.reasons[k] = (o.reasons[k] || 0) + m; plantReasons[k] = (plantReasons[k] || 0) + m;
      });
      if (v.efficiency && v.efficiency.oee !== null && v.efficiency.plannedMin > 0) { o.effMin += v.efficiency.plannedMin; o.effSum += v.efficiency.oee * v.efficiency.plannedMin; }
    });
    var rank = function (m) { return Object.keys(m).filter(function (k) { return m[k] > 0; }).sort(function (a, b) { return m[b] - m[a] || a.localeCompare(b); }).map(function (k) { return { reason: k, minutes: m[k] }; }); };
    var out = Object.keys(byLine).map(function (k) {
      var o = byLine[k];
      return { operationId: o.operationId, line: o.line, kind: o.kind, shifts: o.shifts, made: o.made, soFar: o.soFar, pct: o.soFar ? Math.round(o.made / o.soFar * 100) : null, downMin: o.downMin, stops: o.stops, wasteTotal: o.wasteTotal,
        changeovers: o.changeovers, changeoverAvg: o.changeovers ? Math.round(o.changeoverMin / o.changeovers) : null, overStd: o.overStd, changeoverStd: num(((lineDocs || {})[k] || {}).changeoverMin), cips: o.cips,
        topReasons: rank(o.reasons).slice(0, 3), oee: o.effMin ? Math.round(o.effSum / o.effMin) : null };
    });
    return { lines: out, topLosses: rank(plantReasons).slice(0, 5) };
  }

  return { COUNTERS: COUNTERS, COUNTER_LABEL: COUNTER_LABEL, REASONS: REASONS, START_SHIFTS: START_SHIFTS, targetPerHour: targetPerHour, productionShifts: productionShifts,
    shiftNow: shiftNow, shiftHours: shiftHours, runId: runId, TARGET_FIELDS: TARGET_FIELDS, targetsFor: targetsFor, stopMinutes: stopMinutes, speedOf: speedOf, speedFlag: speedFlag, codeDate: codeDate, lineNow: lineNow,
    lineKind: lineKind, KIND_LABEL: KIND_LABEL, WASTE_REASONS: WASTE_REASONS, CHANGEOVER_CHECKS: CHANGEOVER_CHECKS, CHECK_FIELDS: CHECK_FIELDS, CHECK_EVERY: CHECK_EVERY, DIVERT_REASONS: DIVERT_REASONS, STOP_REASONS: STOP_REASONS, stopReasons: stopReasons, LIMITS: LIMITS,
    CONTROLLER_BRANDS: CONTROLLER_BRANDS, CONTROLLER_PORTS: CONTROLLER_PORTS, READINGS: READINGS, TAG_HELP: TAG_HELP, CONTROLLER_FIELDS: CONTROLLER_FIELDS, tagOk: tagOk, controllerField: controllerField, machineFlag: machineFlag, machineNow: machineNow, speedNameFor: speedNameFor, weightFlag: weightFlag,
    countAt: countAt, checkDue: checkDue, weekScore: weekScore, lineMore: lineMore, hourly: hourly, timeline: timeline };
});
