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
  var TARGET_FIELDS = ['upc', 'shelfLifeDays', 'ratePerMin', 'targetPct', 'minSpeed', 'maxSpeed', 'fillGrams'];
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
    // Joe 10/14: the fillers' five jug weights moved to their own Fill weight check (fillDue, in grams, as often as Line Targets
    // says); OLD_CHECK_FIELDS still shows the pounds an earlier check saved.
    FILLER: [['capSeal', 'Cap and seal', 'ok'], ['codeOk', 'Code date readable', 'ok'], ['temp', 'Product temp °F', 'num']],
    PACK: [['capSeal', 'Seal', 'ok'], ['codeOk', 'Code date readable', 'ok'], ['temp', 'Product temp °F', 'num']],
    HTST: [['recorder', 'Recorder °F', 'num'], ['indicating', 'Indicating °F', 'num'], ['pen', 'Pen on time', 'ok'], ['flow', 'Flow GPM', 'num']],
    // Joe 10/14: a six-head blow mold, so every check weighs a jug from each of heads 1 to 6 in grams (the Blow Mold quality
    // check's same six: head1 to head6).
    BLOWMOLD: [['head1', 'Head 1 g', 'num'], ['head2', 'Head 2 g', 'num'], ['head3', 'Head 3 g', 'num'], ['head4', 'Head 4 g', 'num'], ['head5', 'Head 5 g', 'num'], ['head6', 'Head 6 g', 'num'], ['topLoad', 'Top load', 'ok']]
  };
  var OLD_CHECK_FIELDS = { FILLER: [['w1', 'Jug 1 lb', 'num'], ['w2', 'Jug 2 lb', 'num'], ['w3', 'Jug 3 lb', 'num'], ['w4', 'Jug 4 lb', 'num'], ['w5', 'Jug 5 lb', 'num']] };
  // Joe 10/23: the Blow Mold's bottle weights are checked every hour of running.
  var CHECK_EVERY = { FILLER: 2, PACK: 2, HTST: 1, BLOWMOLD: 1 };
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
  // Joe 10/14 (Gallon Filler add-on sensors, B): a filler can also read a motor current switch (on = running) and a second photo-eye
  // on the infeed (jugs in: jugs in less jugs counted out are the rejects and spills), on a small I/O module the line PC reads the
  // same way. The Blow Mold keeps only its three.
  // Joe 10/23 (Blow Mold, mock-up 2): a shot counter on the lever (each shot makes a set of jugs, 6 here), the jug count is the
  // eye on the Alpine after the annealer (no eye at the kicker), and the annealer belt's speed is COUNTED: a switch at the drive shaft sends its turns and the
  // app works out the RPM ("I'd rather have the RPMs counted" than read the speed control). The annealer's own temperature stays.
  var READINGS = [['count', 'Jug count'], ['speed', 'Speed'], ['temp', 'Temperature'], ['running', 'Motor running (current switch)'], ['infeed', 'Jugs in (infeed eye)'],
    ['shots', 'Shots (lever switch)'], ['turns', 'Belt turns (shaft switch)']];
  // The readings Line Targets shows for a line: a filler counted another way (its label reader) shows only its add-on sensors.
  // The Blow Mold's speed control reading shows only when one was already set up (its belt is counted by turns now).
  function readingsFor(kind, counter, cfg) {
    if (kind === 'BLOWMOLD') return text((cfg || {}).speedTag) ? ['count', 'shots', 'turns', 'speed', 'temp'] : ['count', 'shots', 'turns', 'temp'];
    if (kind !== 'FILLER') return ['count', 'speed', 'temp'];
    return counter === 'CONTROLLER' ? ['count', 'speed', 'temp', 'running', 'infeed'] : ['running', 'infeed'];
  }
  var TAG_HELP = { AB: 'the tag name as it shows in the controller program, like Jug_Count or Counter1.ACC', AB_MICRO: 'the tag name as it shows in the controller program, like Jug_Count',
    MODBUS: 'the register number, like 40001, 30001 or HR 100 (an on/off input like the motor switch: 10001 or DI 0)', S7: 'the address, like DB10.DBD4 (4 bytes) or DB10.DBW2 (2 bytes), or an on/off bit like I0.3 or DB10.DBX4.0' };
  var CONTROLLER_FIELDS = ['brand', 'ip', 'port', 'slot', 'rack', 'unit', 'wordOrder', 'countTag', 'countSize', 'speedName', 'speedTag', 'speedSize', 'speedDivide', 'speedLow', 'speedHigh', 'tempTag', 'tempSize', 'tempDivide', 'tempLow', 'tempHigh', 'runningTag', 'infeedTag', 'infeedSize',
    'shotsTag', 'shotsSize', 'jugsPerShot', 'turnsTag', 'turnsSize', 'pulsesPerTurn', 'kickHigh', 'roomSensor', 'roomLow', 'roomHigh'];
  var JUGS_PER_SHOT = 6, KICK_HIGH = 2;
  function tagOk(brand, tag) {
    var t = text(tag);
    if (brand === 'MODBUS') return /^(HR|IR|DI|COIL)\s*:?\s*\d{1,5}$/i.test(t) || /^[0134]\d{4,5}$/.test(t) || /^\d{1,5}$/.test(t);
    if (brand === 'S7') { var u = t.replace(/\s+/g, ''); return /^DB\d{1,5}\.DB[DW]\d{1,5}$/i.test(u) || /^M[DW]\d{1,5}$/i.test(u) || /^DB\d{1,5}\.DBX\d{1,5}\.[0-7]$/i.test(u) || /^[MIE]\d{1,5}\.[0-7]$/i.test(u); }
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
    if (field === 'jugsPerShot') return whole(1, 24, 'Jugs each shot');
    if (field === 'pulsesPerTurn') return whole(1, 1000, 'Pulses each turn');
    if (field === 'roomSensor') return v.length <= 120 && v.indexOf('/') < 0 ? { value: v || null } : { error: 'Pick the room\'s sensor.' };
    if (field === 'kickHigh') return v === '' ? { value: null } : isFinite(n) && n >= 0 && n <= 100 ? { value: n } : { error: 'Type the kick-out percent, like 2.' };
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
  // The average of the Blow Mold heads weighed (head1 to head6, grams), one decimal; null when none is.
  function headsAverage(h) {
    var v = [1, 2, 3, 4, 5, 6].map(function (n) { return num((h || {})['head' + n]); }).filter(function (x) { return x !== null && x > 0; });
    return v.length ? round1(v.reduce(function (a, b) { return a + b; }, 0) / v.length) : null;
  }
  function round1(n) { return Math.round(n * 10) / 10; }

  // ---------- Fill weight check (Joe 10/14: "we weigh jugs after fill just to check", and the math on what goes in each jug) ----------
  // Each filler weighs FILL_JUGS filled jugs in grams (the filler's quality check weighed five), as often as Line Targets says
  // (lineDoc.fillEvery MINUTES / JUGS / CHANGE with fillEveryN; blank = every FILL_DEFAULT_MIN minutes), and always at the start
  // and after each product change. The product in a jug is net = filled - empty jug (tare) - cap, against the product's Target
  // fill weight (g) on the Product Sheet. The Gallon Filler's empty jug is the average of the Blow Mold's latest Head 1 to 6
  // weights (its jugs come from the Blow Mold) for TARE_HOURS; otherwise, and on the other fillers, the empty weight typed on
  // Line Targets (tareGrams). LIGHT below target less fillUnder (blank = 0), HEAVY above target plus fillOver (blank = not flagged).
  // Joe 10/26: one jug a check, every so many minutes, with a countdown on the tablet (FILL_JUGS). A check can still hold up to
  // FILL_MAX jugs: the earlier five-jug checks, and the weights a Quality screen check copies over.
  var FILL_JUGS = 1, FILL_MAX = 5, TARE_HOURS = 12, FILL_DEFAULT_MIN = 120, GRAMS_PER_LB = 453.592;
  var FILL_MODES = [['MINUTES', 'Every so many minutes'], ['JUGS', 'Every so many jugs'], ['CHANGE', 'Only at the start and after each product change']];
  // Joe 10/14: the 5-gallon bag filler (Raypak, "the dispenser") weighs filled bags the same way: the empty bag and fitment
  // typed on Line Targets, against the product's Target Fill Weight g. Joe 10/26: Boxing has no fill weight check (the product
  // was weighed before it gets there; Boxing only puts it in the box).
  var BAG_LINES = ['RAYPAK'];
  // Joe 10/26: the new bag filler works like the Raypak (a 5-gallon bag filler), whatever its line is named with "Bag Filler".
  function isBagFiller(lineName) { var k = text(lineName).toUpperCase().replace(/[^A-Z0-9]/g, ''); return BAG_LINES.indexOf(k) >= 0 || /BAGFILLER/.test(k); }
  function hasFill(lineName) { return lineKind(lineName) === 'FILLER' || isBagFiller(lineName); }
  // The words for what a line's fill weight check weighs: jugs and caps, or bags and fitments.
  function fillWords(lineName) {
    return isBagFiller(lineName) ? { one: 'bag', many: 'bags', One: 'Bag', empty: 'empty bag', Empty: 'Empty bag', cap: 'fitment', Cap: 'Fitment' }
      : { one: 'jug', many: 'jugs', One: 'Jug', empty: 'empty jug', Empty: 'Empty jug', cap: 'cap', Cap: 'Cap' };
  }
  // Joe 10/26: Boxing has no CIP / sanitation (no CIP button on its tablet); it does have changeovers.
  function hasCip(lineName) { return text(lineName).toUpperCase().replace(/[^A-Z0-9]/g, '') !== 'BOXING'; }
  // Joe 10/26: the countdown for the product running now. qty = how many to run (typed on the tablet, or the Up next amount
  // when that product is started); made = counted since the product started this shift; left = what is still to run.
  function runLeft(run, nowMs) {
    var r = run || {}, runs = (r.runs || []).slice().sort(function (a, b) { return when(a.from) - when(b.from); }), cur = runs[runs.length - 1];
    if (!cur || num(cur.qty) === null) return null;
    var made = Math.max(0, (num(r.count) || 0) - countAt(r.counts, when(cur.from) - 1)), qty = num(cur.qty);
    return { qty: qty, made: made, left: Math.max(0, qty - made), over: Math.max(0, made - qty), pct: qty ? Math.min(100, Math.round(made / qty * 100)) : 100 };
  }
  function usesBlowMoldJugs(lineName) { return text(lineName).toUpperCase().replace(/[^A-Z0-9]/g, '') === 'GALLONFILLER'; }
  // The empty jug weight for a line now: { grams, from: 'BLOWMOLD' | 'TYPED', at } or null. blowHeads = the Blow Mold's headsLast.
  function tareFor(lineName, lineDoc, blowHeads, nowMs) {
    var b = blowHeads || {}, at = when(b.at);
    if (usesBlowMoldJugs(lineName) && num(b.avg) !== null && at && nowMs - at < TARE_HOURS * 3600000) return { grams: num(b.avg), from: 'BLOWMOLD', at: text(b.at) };
    var t = num((lineDoc || {}).tareGrams);
    return t !== null ? { grams: t, from: 'TYPED', at: '' } : null;
  }
  function fillFlag(net, target, under, over) {
    var n = num(net), t = num(target), o = num(over);
    if (n === null || t === null) return '';
    if (n < t - (num(under) || 0)) return 'LIGHT';
    if (o !== null && n > t + o) return 'HEAVY';
    return '';
  }
  // One fill weight check (a run.fills entry) worked out: each jug's net and difference from target, their average and flags.
  function fillOf(f) {
    var x = f || {}, tare = num(x.tare), cap = num(x.cap) || 0, target = num(x.target), jugs = [];
    for (var i = 1; i <= FILL_MAX; i++) {
      var g = num(x['jug' + i]), net = g !== null && tare !== null ? round1(g - tare - cap) : null;
      jugs.push({ gross: g, net: net, diff: net !== null && target !== null ? round1(net - target) : null, flag: fillFlag(net, target, x.under, x.over) });
    }
    var nets = jugs.map(function (j) { return j.net; }).filter(function (n) { return n !== null; }), avg = nets.length ? round1(nets.reduce(function (a, b) { return a + b; }, 0) / nets.length) : null;
    var light = jugs.filter(function (j) { return j.flag === 'LIGHT'; }).length, heavy = jugs.filter(function (j) { return j.flag === 'HEAVY'; }).length;
    return { at: text(x.at), by: text(x.by), product: text(x.product), tare: tare, tareFrom: text(x.tareFrom), cap: num(x.cap), target: target, under: num(x.under), over: num(x.over), jugs: jugs,
      avgNet: avg, diff: avg !== null && target !== null ? round1(avg - target) : null, light: light, heavy: heavy, flag: light ? 'LIGHT' : heavy ? 'HEAVY' : '',
      filled: jugs.filter(function (j) { return j.gross !== null; }).length };
  }
  // When the line's next fill weight check is due. index = the check being filled in now (null = the next save starts one).
  // Joe 10/15: once all FILL_JUGS weights of a check are in, it is recorded: the boxes empty for the next check (index null), so
  // nobody copies or guesses from the last numbers; last = the latest check worked out, for a read-only line.
  function fillDue(run, lineDoc, nowMs) {
    var r = run || {}, ld = lineDoc || {}, mode = text(ld.fillEvery).toUpperCase(), n = num(ld.fillEveryN);
    if (['MINUTES', 'JUGS', 'CHANGE'].indexOf(mode) < 0 || (mode !== 'CHANGE' && !(n > 0))) { mode = ''; n = null; }
    var fills = Array.isArray(r.fills) ? r.fills : [], last = fills.length ? fills[fills.length - 1] : null, lastAt = last ? when(last.at) : 0;
    var runs = (r.runs || []).slice().sort(function (a, b) { return when(a.from) - when(b.from); }), change = runs.length ? when(runs[runs.length - 1].from) : 0;
    var o = { mode: mode, every: n, count: fills.length, due: false, why: '', dueAt: '', nextAt: '', jugsLeft: null, index: null, current: null, last: last ? fillOf(last) : null };
    if (!change) { o.why = 'product'; return o; }
    var minutes = mode === 'MINUTES' ? n : mode === '' ? FILL_DEFAULT_MIN : null, made = num(r.count) || 0;
    if (!last || lastAt < change) { o.due = true; o.why = last ? 'change' : 'start'; o.dueAt = new Date(change).toISOString(); return o; }
    if (minutes !== null && nowMs >= lastAt + minutes * 60000) { o.due = true; o.why = 'time'; o.dueAt = new Date(lastAt + minutes * 60000).toISOString(); return o; }
    if (mode === 'JUGS' && made - (num(last.count) || 0) >= n) { o.due = true; o.why = 'jugs'; return o; }
    if (o.last.filled < FILL_JUGS) { o.index = fills.length - 1; o.current = o.last; }
    if (minutes !== null) o.nextAt = new Date(lastAt + minutes * 60000).toISOString();
    if (mode === 'JUGS') o.jugsLeft = Math.max(0, n - (made - (num(last.count) || 0)));
    return o;
  }
  // The shift's fill weight checks added up: the average over or under target and the product given away (overfill) on every
  // jug made, in grams and pounds (made x the average over target, when the line ran over).
  function fillTotals(run, made) {
    var list = ((run || {}).fills || []).map(fillOf).filter(function (f) { return f.avgNet !== null; }), withT = list.filter(function (f) { return f.diff !== null; });
    var avgDiff = withT.length ? round1(withT.reduce(function (a, f) { return a + f.diff; }, 0) / withT.length) : null, give = avgDiff !== null && avgDiff > 0 ? Math.round(avgDiff * (num(made) || 0)) : 0;
    return { checks: list.length, light: list.filter(function (f) { return f.flag === 'LIGHT'; }).length, heavy: list.filter(function (f) { return f.flag === 'HEAVY'; }).length,
      avgDiff: avgDiff, giveawayG: give, giveawayLb: round1(give / GRAMS_PER_LB), noTarget: list.length > 0 && !withT.length };
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
  function r0(run) { return run || {}; }
  function speedNameFor(kind, c) { return text((c || {}).speedName) || (kind === 'BLOWMOLD' ? (text((c || {}).turnsTag) ? 'Annealer belt speed' : 'Annealer speed') : 'Speed'); }
  // Joe 10/16: "we run it right around 1,000 and 1,350 degrees" on the Blow Mold. Low and High on Line Targets change it.
  var DEFAULT_RANGES = { BLOWMOLD: { temp: [1000, 1350] } };
  function machineRange(kind, c, k) {
    var lo = num((c || {})[k + 'Low']), hi = num((c || {})[k + 'High']), d = (DEFAULT_RANGES[kind] || {})[k];
    return lo === null && hi === null && d ? [d[0], d[1]] : [lo, hi];
  }
  function machineNow(run, lineDoc, nowMs, kind) {
    var m = (run || {}).machine, c = ((lineDoc || {}).controller) || {};
    if (!m || typeof m !== 'object') return null;
    var sr = machineRange(kind, c, 'speed'), tr = machineRange(kind, c, 'temp');
    var at = when(m.at), o = { at: text(m.at), stale: !at || nowMs - at > 120000, counter: num(m.counter), speed: num(m.speed), temp: num(m.temp),
      speedName: speedNameFor(kind, c), speedLow: sr[0], speedHigh: sr[1], tempLow: tr[0], tempHigh: tr[1], speedOutSince: text(m.speedOutSince), tempOutSince: text(m.tempOutSince), lastMoveAt: text(m.lastMoveAt) };
    // The filler's add-on sensors: the motor switch (running true / false, since when) and jugs in on the infeed this shift, with
    // the rejects (jugs in less jugs counted out since the infeed eye started counting this shift).
    o.running = m.running === true ? true : m.running === false ? false : null;
    o.runningSince = text(m.runningSince);
    o.infeed = num(r0(run).infeed);
    o.rejects = o.infeed === null ? null : Math.max(0, o.infeed - Math.max(0, (num(r0(run).count) || 0) - (num(r0(run).infeedBase) || 0)));
    o.speedFlag = machineFlag(o.speed, o.speedLow, o.speedHigh);
    o.tempFlag = machineFlag(o.temp, o.tempLow, o.tempHigh);
    // Joe 10/23 (Blow Mold): the belt speed counted from the shaft's turns is RPM; jugs molded = shots x jugs each shot, the jug
    // count is the jugs through the leak tester since the shot counter started, and the difference is the tester's kick-outs.
    o.rpm = text(m.speedFrom) === 'TURNS';
    o.perShot = num(c.jugsPerShot) || JUGS_PER_SHOT;
    o.shots = num(r0(run).shots);
    o.molded = o.shots === null ? null : o.shots * o.perShot;
    o.through = o.shots === null ? null : Math.max(0, (num(r0(run).count) || 0) - (num(r0(run).shotsBase) || 0));
    o.kicked = o.molded === null ? null : Math.max(0, o.molded - o.through);
    o.kickPct = o.molded ? Math.round(o.kicked / o.molded * 1000) / 10 : null;
    o.kickHigh = num(c.kickHigh) === null ? KICK_HIGH : num(c.kickHigh);
    o.kickFlag = o.kickPct !== null && o.kickPct > o.kickHigh ? 'HIGH' : '';
    // The room's temperature (a MOCREO sensor picked on Line Targets), logged with the machine's readings each minute.
    o.room = num(m.room); o.roomAt = text(m.roomAt); o.roomLow = num(c.roomLow); o.roomHigh = num(c.roomHigh);
    o.roomFlag = machineFlag(o.room, o.roomLow, o.roomHigh);
    var log = Array.isArray(run.machineLog) ? run.machineLog : [];
    ['speed', 'temp', 'room'].forEach(function (k) {
      var vals = log.map(function (x) { return num(x && x[k]); }).filter(function (x) { return x !== null; });
      o[k + 'Min'] = vals.length ? Math.min.apply(null, vals) : null;
      o[k + 'Max'] = vals.length ? Math.max.apply(null, vals) : null;
      o[k + 'OutMin'] = log.filter(function (x) { return machineFlag(x && x[k], o[k + 'Low'], o[k + 'High']); }).length;
    });
    return o;
  }

  // Joe 10/23 (Blow Mold, mock-up 2): a run for each resin lot and color. A new run starts each time a lot is scanned or the
  // color changes (run.lotLog: { at, lot, color, count, shots } with the counts at that moment). A shift that starts with no
  // scan carries the line's last lot and color from its start. Each run: jugs molded, through the
  // tester and kicked out, and the annealer temperature, belt speed and room temperature, lowest to highest, from the minute log.
  var COLORS = [['WHITE', 'White'], ['CLEAR', 'Clear']];
  function colorName(c) { var f = COLORS.filter(function (x) { return x[0] === text(c).toUpperCase(); })[0]; return f ? f[1] : ''; }
  function lotRuns(run, lineDoc, nowMs) {
    var r = run || {}, ld = lineDoc || {}, c = ld.controller || {}, per = num(c.jugsPerShot) || JUGS_PER_SHOT;
    var log = (Array.isArray(r.lotLog) ? r.lotLog : []).filter(function (x) { return x && when(x.at); }).slice().sort(function (a, b) { return when(a.at) - when(b.at); });
    var start = when(r.shiftStart), segs = [];
    // The lot and color the shift started on: kept on the run at its first scan (run.lotFrom), else the line's last ones.
    var from = r.lotFrom && typeof r.lotFrom === 'object' ? r.lotFrom : { lot: text(ld.lot) || text(r.lot), color: text(ld.color) || text(r.color) };
    if ((!log.length || when(log[0].at) > start) && (text(from.lot) || text(from.color)) && start) {
      segs.push({ at: r.shiftStart, lot: text(from.lot), color: text(from.color), count: 0, shots: 0, carried: true });
    }
    log.forEach(function (x) { segs.push({ at: x.at, lot: text(x.lot), color: text(x.color), count: num(x.count) || 0, shots: num(x.shots) || 0, carried: false }); });
    var hasShots = num(r.shots) !== null, mlog = Array.isArray(r.machineLog) ? r.machineLog : [], end = Math.min(nowMs, when(r.shiftEnd) || nowMs);
    var range = function (k, a, b) {
      var vals = mlog.filter(function (x) { var t = when(x && x.at); return t >= a && t < b && num(x[k]) !== null; }).map(function (x) { return num(x[k]); });
      return vals.length ? [Math.min.apply(null, vals), Math.max.apply(null, vals)] : null;
    };
    return segs.map(function (s, i) {
      var nx = segs[i + 1], a = when(s.at), b = nx ? when(nx.at) : end;
      var cEnd = nx ? nx.count : num(r.count) || 0, sEnd = nx ? nx.shots : num(r.shots) || 0;
      var through = Math.max(0, cEnd - s.count), molded = hasShots ? Math.max(0, sEnd - s.shots) * per : null;
      var kicked = molded === null ? null : Math.max(0, molded - through);
      return { at: s.at, lot: s.lot, color: s.color, colorName: colorName(s.color), carried: s.carried, now: !nx, molded: molded, through: through, kicked: kicked,
        kickPct: molded ? Math.round(kicked / molded * 1000) / 10 : null, temp: range('temp', a, b), speed: range('speed', a, b), room: range('room', a, b) };
    });
  }

  // The Blow Mold's hour by hour (Joe 10/25, desk mock-up 2): each hour of hourly() with the jugs molded (the shots logged that
  // hour × jugs a shot), the jugs on the Alpine (the hour's count), the kick-outs, the annealer temperature, belt RPM and room
  // ranges, and the resin lots and colors run in it.
  function blowHours(run, lineDoc, targets, nowMs) {
    var r = run || {}, c = (lineDoc || {}).controller || {}, per = num(c.jugsPerShot) || JUGS_PER_SHOT, hasShots = num(r.shots) !== null;
    var mlog = (Array.isArray(r.machineLog) ? r.machineLog : []).filter(function (x) { return x && when(x.at); });
    var shotsAt = function (t) { var n = 0; mlog.forEach(function (x) { if (when(x.at) <= t && num(x.shots) !== null) n = num(x.shots); }); return n; };
    var range = function (k, a, b) {
      var vals = mlog.filter(function (x) { var t = when(x.at); return t >= a && t < b && num(x[k]) !== null; }).map(function (x) { return num(x[k]); });
      return vals.length ? [Math.min.apply(null, vals), Math.max.apply(null, vals)] : null;
    };
    var segs = lotRuns(r, lineDoc, nowMs), shiftEnd = Math.min(nowMs, when(r.shiftEnd) || nowMs);
    return hourly(r, targets, nowMs).filter(function (h) { return h.past; }).map(function (h) {
      var a = when(h.from), b = Math.min(when(h.to), nowMs);
      var molded = hasShots ? Math.max(0, (b >= shiftEnd && num(r.shots) !== null ? num(r.shots) : shotsAt(b)) - shotsAt(a)) * per : null;
      var kicked = molded === null ? null : Math.max(0, molded - h.made);
      var lots = segs.filter(function (s, i) { var sa = when(s.at), sb = i + 1 < segs.length ? when(segs[i + 1].at) : shiftEnd; return overlap(sa, sb, a, b) > 0 || (sa >= a && sa < b); })
        .map(function (s) { return [s.lot, s.colorName].filter(Boolean).join(' · '); }).filter(Boolean);
      return Object.assign({}, h, { through: h.made, molded: molded, kicked: kicked, kickPct: molded ? Math.round(kicked / molded * 1000) / 10 : null,
        tempRange: range('temp', a, b), speedRange: range('speed', a, b), roomRange: range('room', a, b), lots: lots.filter(function (x, i) { return lots.indexOf(x) === i; }) });
    });
  }

  var LIMITS = { WASTE: 999999, CREW: 30, NOTE: 1000, DIVERTS: 200, CHANGEOVERS: 60, CIPS: 20, CHECK_SLOTS: 30, FILLS: 120, GRAMS: 30000 };

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
  // Joe 10/14: a packing line's box count against the fillers that feed it ("Fed by" on Line Targets: lineDoc.fedBy, the feeding
  // lines' ids, and perBox, the jugs in each box). feeders = [{ operationId, name, made }] this shift. Jugs in = what the feeding
  // lines made; jugs boxed = boxes x perBox; the difference is jugs not boxed (on the conveyor, rejected or spilled), or, below
  // zero, more boxed than the fillers counted. null when the line has no feeders set.
  function boxingOf(lineDoc, made, feeders) {
    var ids = Array.isArray((lineDoc || {}).fedBy) ? lineDoc.fedBy : [];
    if (!ids.length) return null;
    var fed = (feeders || []).filter(function (f) { return ids.indexOf(f.operationId) >= 0; }), per = num(lineDoc.perBox);
    var jugsIn = fed.reduce(function (a, f) { return a + (num(f.made) || 0); }, 0), boxes = num(made) || 0, boxed = per ? boxes * per : null;
    return { perBox: per, boxes: boxes, jugsIn: jugsIn, boxed: boxed, diff: boxed === null ? null : jugsIn - boxed,
      feeders: fed.map(function (f) { return { operationId: f.operationId, name: text(f.name), made: num(f.made) || 0 }; }) };
  }
  // plant = { blowHeads, lineName, feeders }: the Blow Mold's latest head weights (productionLines headsLast), for the Gallon
  // Filler's empty jug; the line's name; and the lines feeding a packing line (boxingOf).
  function lineMore(run, targets, nowMs, kind, lineDoc, plant) {
    var r = run || {}, ld = lineDoc || {}, base = lineNow(run, targets, nowMs), lname = text((plant || {}).lineName) || text(ld.line) || text(r.line);
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
      fill: kind === 'FILLER' || isBagFiller(lname) ? { due: fillDue(r, ld, nowMs), tare: tareFor(ld.line || r.line, ld, (plant || {}).blowHeads, nowMs), cap: num(ld.capGrams),
        target: base.target ? num(base.target.fillGrams) : null, under: num(ld.fillUnder), over: num(ld.fillOver), totals: fillTotals(r, base.made),
        checks: (r.fills || []).map(fillOf), words: fillWords(lname) } : null,
      boxing: boxingOf(ld, base.made, (plant || {}).feeders), runLeft: runLeft(r, nowMs), hasCip: hasCip(lname),
      lot: text(r.lot) || text(ld.lot), jugColor: text(r.color) || text(ld.color), lotAt: text(r.lotAt), lotCarried: !text(r.lot) && !!text(ld.lot),
      lotRuns: kind === 'BLOWMOLD' ? lotRuns(r, ld, nowMs) : [], stock: num(r.stock), note: text(r.note), next: ld.next && typeof ld.next === 'object' && text(ld.next.product) ? { product: text(ld.next.product), qty: num(ld.next.qty) } : null
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

  /* ---------- RedZone's lines (Joe 10/16) ----------
   * RedZone's own lines are its locations, each with its sensor names ("Blow Mold: Default"). Each of our lines is matched to
   * one by name, and Line Targets can change the match (lineDoc.redzoneLocation: a location's uuid, or NONE).
   * Joe 10/16: "The Dairy Queen machines are my Raypak machines ... I have a Raypak and then the new one." The new one is the
   * 5-gallon dispenser filler that feeds the box, our BOXING line (Joe 10/14), so Dairy Queen Manual goes with BOXING. */
  var RZ_MATCH = [[/^blow\s*mold/i, 'BLOW MOLD'], [/^gallon/i, 'GALLON FILLER'], [/^half\s*gallon/i, 'NEW 1/2 GALLON'], [/^half,?\s*quart/i, 'OLD 1/2 GALLON'],
    [/^dairy\s*queen$/i, 'RAYPAK'], [/^dairy\s*queen\s*manual$/i, 'BOXING'], [/^totes?$/i, 'TOTES'], [/^htst\s*#?\s*1$/i, 'HTST #1'], [/^htst\s*#?\s*2$/i, 'HTST #2']];
  function rzKey(v) { return text(v).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function rzGuess(lineName, locations) {
    var k = rzKey(lineName);
    return (locations || []).filter(function (l) {
      return RZ_MATCH.some(function (m) { return m[0].test(text(l.name)) && rzKey(m[1]) === k; }) || rzKey(l.name) === k;
    })[0] || null;
  }
  // The RedZone location for one of our lines: the one picked on Line Targets, else the match by name. null = none.
  function rzLocationFor(lineName, lineDoc, rz) {
    var locs = (rz && rz.locations) || [], saved = text((lineDoc || {}).redzoneLocation);
    if (saved === 'NONE') return null;
    if (saved) return locs.filter(function (l) { return l.uuid === saved; })[0] || null;
    return rzGuess(lineName, locs);
  }
  // RedZone's problem types for a location: the ones for a machine type at that location, and the ones for every machine.
  function rzProblemsFor(rz, loc) {
    if (!rz || !loc) return [];
    var types = {};
    (rz.assets || []).forEach(function (a) { if (a.locationUUID === loc.uuid && a.assetTypeUUID) types[a.assetTypeUUID] = 1; });
    var seen = {};
    return (rz.problems || []).filter(function (p) { return !p.assetTypeUUID || types[p.assetTypeUUID]; }).map(function (p) { return text(p.name); })
      .filter(function (n) { var k = n.toUpperCase(); if (!n || seen[k]) return false; seen[k] = 1; return true; });
  }
  // The Line Stopped choices: RedZone's problem types for the line first, then the line's own until there are ten (nothing of
  // ours is dropped while there is room), then Maintenance called (it opens a work order) and Other: twelve, the tablet's rows.
  function rzStopReasons(kind, rzNames) {
    var own = stopReasons(kind), seen = {}, keep = [];
    (rzNames || []).concat(own).forEach(function (n) {
      var k = text(n).toUpperCase();
      if (!k || seen[k] || k === 'MAINTENANCE CALLED' || k === 'OTHER' || keep.length >= 10) return;
      seen[k] = 1; keep.push(text(n));
    });
    return (rzNames || []).length ? keep.concat(['Maintenance called', 'Other']) : own;
  }
  // What RedZone ran on a location: its products (newest run first) with RedZone's numbers, and the latest runs.
  function rzRunsFor(rz, loc) {
    if (!rz || !loc) return { products: [], runs: [] };
    var byId = {};
    (rz.products || []).forEach(function (p) { byId[p.uuid] = p; });
    var runs = (rz.runs || []).filter(function (r) { return r.locationUUID === loc.uuid; }).sort(function (a, b) { return (when(b.startTime) || 0) - (when(a.startTime) || 0); });
    var seen = {}, products = [];
    runs.forEach(function (r) { var p = byId[r.productTypeUUID]; if (p && !seen[p.uuid]) { seen[p.uuid] = 1; products.push(p); } });
    return { products: products, runs: runs.map(function (r) { return Object.assign({ product: (byId[r.productTypeUUID] || {}).name || '' }, r); }) };
  }
  // Joe 10/16: a run's efficiency from RedZone's count feed: the count against the standard speed for the minutes it has run
  // (start to its end, or to the newest count). null when RedZone has not given all three.
  function rzEfficiency(run) {
    var start = num(run && run.startTime), upTo = num(run && (run.endTime || run.countAt)), rate = num(run && run.ratePerMin), count = num(run && run.count);
    if (start === null || upTo === null || !(rate > 0) || count === null || upTo <= start) return null;
    var minutes = (upTo - start) / 60000, expected = rate * minutes;
    return { minutes: Math.round(minutes), expected: Math.round(expected), pct: Math.round(count / expected * 100) };
  }
  // Fill empty Full speed and Target % boxes from RedZone (matched by SKU, then name). Boxes with a number stay as they are.
  function rzFill(list, rzProducts) {
    var bySku = {}, byName = {}, changed = [];
    (rzProducts || []).forEach(function (p) { if (text(p.sku)) bySku[text(p.sku)] = bySku[text(p.sku)] || p; byName[rzKey(p.name)] = byName[rzKey(p.name)] || p; });
    var out = (list || []).map(function (row) {
      var p = (text(row.sku) && bySku[text(row.sku)]) || byName[rzKey(row.name)], r = Object.assign({}, row), did = [];
      if (!p) return r;
      if (num(r.ratePerMin) === null && num(p.ratePerMin) > 0) { r.ratePerMin = num(p.ratePerMin); did.push('full speed ' + r.ratePerMin); }
      if (num(r.targetPct) === null && num(p.target) > 0 && num(p.target) <= 100) { r.targetPct = num(p.target); did.push('Target % ' + r.targetPct); }
      if (did.length) changed.push(text(r.name) + ': ' + did.join(', '));
      return r;
    });
    return { list: out, changed: changed };
  }

  return { COUNTERS: COUNTERS, machineRange: machineRange, DEFAULT_RANGES: DEFAULT_RANGES, RZ_MATCH: RZ_MATCH, rzGuess: rzGuess, rzLocationFor: rzLocationFor, rzProblemsFor: rzProblemsFor, rzStopReasons: rzStopReasons, rzRunsFor: rzRunsFor, rzFill: rzFill, rzEfficiency: rzEfficiency, COUNTER_LABEL: COUNTER_LABEL, REASONS: REASONS, START_SHIFTS: START_SHIFTS, targetPerHour: targetPerHour, productionShifts: productionShifts,
    shiftNow: shiftNow, shiftHours: shiftHours, runId: runId, TARGET_FIELDS: TARGET_FIELDS, targetsFor: targetsFor, stopMinutes: stopMinutes, speedOf: speedOf, speedFlag: speedFlag, codeDate: codeDate, lineNow: lineNow,
    lineKind: lineKind, KIND_LABEL: KIND_LABEL, WASTE_REASONS: WASTE_REASONS, CHANGEOVER_CHECKS: CHANGEOVER_CHECKS, CHECK_FIELDS: CHECK_FIELDS, CHECK_EVERY: CHECK_EVERY, DIVERT_REASONS: DIVERT_REASONS, STOP_REASONS: STOP_REASONS, stopReasons: stopReasons, LIMITS: LIMITS,
    CONTROLLER_BRANDS: CONTROLLER_BRANDS, CONTROLLER_PORTS: CONTROLLER_PORTS, READINGS: READINGS, readingsFor: readingsFor, JUGS_PER_SHOT: JUGS_PER_SHOT, KICK_HIGH: KICK_HIGH, COLORS: COLORS, colorName: colorName, lotRuns: lotRuns, blowHours: blowHours, TAG_HELP: TAG_HELP, CONTROLLER_FIELDS: CONTROLLER_FIELDS, tagOk: tagOk, controllerField: controllerField, machineFlag: machineFlag, machineNow: machineNow, speedNameFor: speedNameFor, weightFlag: weightFlag,
    OLD_CHECK_FIELDS: OLD_CHECK_FIELDS, headsAverage: headsAverage, FILL_JUGS: FILL_JUGS, FILL_MAX: FILL_MAX, FILL_MODES: FILL_MODES, FILL_DEFAULT_MIN: FILL_DEFAULT_MIN, TARE_HOURS: TARE_HOURS, GRAMS_PER_LB: GRAMS_PER_LB,
    usesBlowMoldJugs: usesBlowMoldJugs, isBagFiller: isBagFiller, hasCip: hasCip, runLeft: runLeft, hasFill: hasFill, fillWords: fillWords, boxingOf: boxingOf, tareFor: tareFor, fillFlag: fillFlag, fillOf: fillOf, fillDue: fillDue, fillTotals: fillTotals,
    countAt: countAt, checkDue: checkDue, weekScore: weekScore, lineMore: lineMore, hourly: hourly, timeline: timeline };
});
