/*
 * Plant Production (Joe 10/11: our own RedZone): the line tablet's entries and each line's counter.
 *
 * saveLineEntry: one tap on a line tablet, for the line's shift (productionRuns/{operationId}__{shiftKey}):
 *   product  the product now running (a new run of the shift starts from now);
 *   count    the total made this shift so far (typed by the operator until a sensor or label reader sends it);
 *   stop     the line stopped (from now);       run     the line is running again (the open stop ends now);
 *   reason   why a stop happened (stopIndex = which stop). Joe 10/14 follow-on: "Maintenance called" also makes the stop a Plant
 *            Maintenance work order (plantWorkOrders, M-1001 on, once per stop), so maintenance sees it on the Maintenance Station.
 * The shift is worked out on the tablet (production-rules.js shiftNow) and sent with the entry; times are the server's.
 * More for every line (Joe 10/14: "all of your picks", mock-ups C to H), on the same shift's record:
 *   changeover  start (to = the new product), to (change the new product) or done; cocheck ticks one changeover checklist line (key);
 *   cip         a CIP wash start or done (result PASS or FAIL); the line's last CIP time is kept on productionLines;
 *   waste       how many were wasted for one reason this shift (the total for that reason, typed);
 *   check       one box of the quality check due now (slot = which check of the shift, field, value);
 *   crew        a name signed on or off the line;  note  the note for the next shift;
 *   divert      the HTST went to divert (with why) or back to forward flow (sub 'forward');
 *   source      the HTST's silo or tank and where it goes;  lot  the Blow Mold's resin lot (typed or scanned);  color  its jugs White or Clear (Joe 10/23: each lot or color
 *               change starts a new run on the tablet's Runs this shift, run.lotLog);  stock  jugs ahead of the filler;
 *   next        what runs next on the line (kept on productionLines, not the shift);
 *   fill        one filled jug's weight in grams on the fill weight check (index = which check; none starts the one due now, with the
 *               empty jug, cap and product target of that moment: production-rules fillOf works out the product in each jug).
 * The Blow Mold's heads (check) and a filler's fill weights are also the Quality screen's check, in the same save (weightjoin.js).
 * saveLineCounter: how a line is counted (TABLET, SENSOR or READER), Line Targets (productionLines/{operationId}).
 * saveLineSetup (also Joe 10/31: a filler's Labeling Room tick, belt minutes and bottles on the belt): the line's changeover standard minutes and hours between CIP washes, the Blow Mold's jug weight target and
 *   range in grams, and a filler's fill weight check setup (how often, empty jug, cap, light and heavy allowances) (Line Targets).
 * The products, their speeds, targets, UPCs and shelf lives are the plant's Products list (plantProducts), not kept here.
 */
'use strict';

const P = require('./production-rules');
const W = require('./weightjoin');

const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
const docId = (id) => String(id).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 200);
const OPS = ['product', 'count', 'stop', 'run', 'reason', 'changeover', 'cocheck', 'cip', 'waste', 'check', 'crew', 'note', 'divert', 'source', 'lot', 'color', 'stock', 'next', 'fill', 'qty'];
const STOP_LIMIT = 300, COUNT_LIMIT = 400, RUN_LIMIT = 100, LOT_LIMIT = 100;

function lineId(v, SaveError) {
  const id = text(v).slice(0, 120);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new SaveError('BAD_REQUEST', 'Pick a line.');
  return id;
}
async function lineOf(tx, db, operationId, SaveError) {
  const s = await tx.get(db.collection('plantSetup').doc(docId(operationId))), d = s.exists ? s.data() : null;
  if (!d || d.type !== 'PRODUCTION_AREA' || d.status !== 'ACTIVE') throw new SaveError('NOT_FOUND', 'That line is not set up for this plant.');
  return { name: text(d.name) || text(d.area) || operationId, facilityId: text(d.facilityId) || 'fac_uniontown' };
}

function validateLineEntry(input, SaveError) {
  const op = text(input.op).toLowerCase();
  if (OPS.indexOf(op) < 0) throw new SaveError('BAD_REQUEST', 'Unknown line tablet entry.');
  const shift = input.shift && typeof input.shift === 'object' ? input.shift : {};
  const out = { operationId: lineId(input.operationId, SaveError), op, shift: { key: text(shift.key).slice(0, 80), name: text(shift.name).slice(0, 40), date: text(shift.date), start: text(shift.start), end: text(shift.end) } };
  if (!/^\d{4}-\d\d-\d\d_[a-z0-9_]*$/.test(out.shift.key) || !/^\d{4}-\d\d-\d\d$/.test(out.shift.date) || !Date.parse(out.shift.start) || !Date.parse(out.shift.end)) throw new SaveError('BAD_REQUEST', 'The tablet did not send the shift. Reload the page.');
  if (op === 'product') {
    out.product = text(input.product).slice(0, 120);
    out.sku = text(input.sku).slice(0, 40);
    if (!out.product) throw new SaveError('BAD_REQUEST', 'Pick the product running.');
  }
  if (op === 'count') {
    const n = Number(input.count);
    if (text(input.count) === '' || !Number.isInteger(n) || n < 0 || n > 9999999) throw new SaveError('BAD_REQUEST', 'Type the number made this shift (a whole number).');
    out.count = n;
  }
  if (op === 'reason') {
    out.reason = text(input.reason).slice(0, 60);
    out.stopIndex = Number(input.stopIndex);
    if (!out.reason) throw new SaveError('BAD_REQUEST', 'Pick why the line stopped.');
    if (!Number.isInteger(out.stopIndex) || out.stopIndex < 0) throw new SaveError('BAD_REQUEST', 'Pick which stop.');
  }
  const sub = text(input.sub).toLowerCase();
  if (op === 'changeover') {
    out.sub = sub === 'done' || sub === 'to' ? sub : 'start';
    out.to = text(input.to).slice(0, 120);
  }
  if (op === 'cocheck') {
    out.key = text(input.key).slice(0, 20);
    if (!/^[a-z]+$/.test(out.key)) throw new SaveError('BAD_REQUEST', 'Pick a checklist line.');
    out.done = input.done !== false;
  }
  if (op === 'cip') {
    out.sub = sub === 'done' ? 'done' : 'start';
    out.result = text(input.result).toUpperCase() === 'FAIL' ? 'FAIL' : 'PASS';
  }
  if (op === 'waste') {
    out.reason = text(input.reason).slice(0, 60);
    const n = Number(input.qty);
    if (!out.reason) throw new SaveError('BAD_REQUEST', 'Pick why it was wasted.');
    if (text(input.qty) === '' || !Number.isInteger(n) || n < 0 || n > P.LIMITS.WASTE) throw new SaveError('BAD_REQUEST', 'Type how many, a whole number.');
    out.qty = n;
  }
  if (op === 'check') {
    out.slot = Number(input.slot);
    out.field = text(input.field).slice(0, 20);
    out.value = text(input.value).slice(0, 20);
    if (!Number.isInteger(out.slot) || out.slot < 0 || out.slot >= P.LIMITS.CHECK_SLOTS) throw new SaveError('BAD_REQUEST', 'Pick which check.');
    if (!/^[A-Za-z0-9]+$/.test(out.field)) throw new SaveError('BAD_REQUEST', 'Pick which box of the check.');
    if (out.value && !/^(OK|NOT OK|ON TIME|LATE|-?\d+(\.\d+)?)$/i.test(out.value)) throw new SaveError('BAD_REQUEST', 'Type a number, or pick OK or Not OK.');
  }
  if (op === 'fill') {
    out.field = text(input.field);
    if (!new RegExp('^jug[1-' + P.FILL_MAX + ']$').test(out.field)) throw new SaveError('BAD_REQUEST', 'Pick which jug.');
    const v = text(input.value), n = Number(v);
    if (v !== '' && (!isFinite(n) || n <= 0 || n > P.LIMITS.GRAMS)) throw new SaveError('BAD_REQUEST', 'Type the filled jug\'s weight in grams.');
    out.value = v === '' ? null : Math.round(n * 10) / 10;
    out.index = input.index === null || input.index === undefined || input.index === '' ? null : Number(input.index);
    if (out.index !== null && (!Number.isInteger(out.index) || out.index < 0)) throw new SaveError('BAD_REQUEST', 'Pick which fill weight check.');
  }
  if (op === 'crew') {
    out.name = text(input.name).replace(/\s+/g, ' ').slice(0, 40);
    out.on = input.on !== false;
    if (!out.name) throw new SaveError('BAD_REQUEST', 'Type the name.');
  }
  if (op === 'note') out.text = text(input.text).slice(0, P.LIMITS.NOTE);
  if (op === 'divert') {
    out.sub = sub === 'forward' ? 'forward' : 'start';
    out.reason = text(input.reason).slice(0, 60);
  }
  if (op === 'source') { out.from = text(input.from).slice(0, 60); out.to = text(input.to).slice(0, 120); }
  if (op === 'lot') {
    out.lot = text(input.lot).replace(/\s+/g, ' ').slice(0, 40);
    if (!out.lot) throw new SaveError('BAD_REQUEST', 'Scan or type the resin lot.');
  }
  if (op === 'color') {
    out.color = text(input.color).toUpperCase();
    if (!P.colorName(out.color)) throw new SaveError('BAD_REQUEST', 'Pick White or Clear.');
  }
  if (op === 'stock') {
    const n = Number(input.count);
    if (text(input.count) === '' || !Number.isInteger(n) || n < 0 || n > 9999999) throw new SaveError('BAD_REQUEST', 'Type how many jugs, a whole number.');
    out.count = n;
  }
  if (op === 'qty') {
    // Joe 10/26: how many to run of the product running now (blank = no countdown).
    const n = Number(input.qty);
    out.qty = text(input.qty) === '' ? null : n;
    if (out.qty !== null && (!Number.isInteger(n) || n < 0 || n > 9999999)) throw new SaveError('BAD_REQUEST', 'Type how many to run, a whole number.');
  }
  if (op === 'next') {
    out.product = text(input.product).slice(0, 120);
    const n = Number(input.qty);
    out.qty = text(input.qty) === '' ? null : n;
    if (out.qty !== null && (!Number.isInteger(n) || n < 0 || n > 9999999)) throw new SaveError('BAD_REQUEST', 'Type how many to make, a whole number.');
  }
  return out;
}
// A stop with "Maintenance called" becomes the line's work order (Joe 10/14 follow-on), the same as Plant Maintenance's own.
// Its reads come before any write of the save.
const MAINT_REASON = 'Maintenance called';
async function stopWorkOrder(tx, db, req, line, run, stop, email, stamp) {
  const PM = require('./plantmaint'), MR = require('./pmaint-rules');
  const ref = db.collection('plantWorkOrders').doc(docId('LS_' + P.runId(req.operationId, req.shift.key) + '_' + req.stopIndex));
  const had = await tx.get(ref);
  if (had.exists) return { id: ref.id, woNumber: had.data().woNumber, write: () => {} };
  const all = await PM.plantMachines(tx, db, line.facilityId), m = MR.findMachine(all, line.name);
  const num = await PM.nextNumber(tx, db, line.facilityId);
  const wo = { woNumber: MR.woNumber(num.n), facilityId: line.facilityId, machineId: m ? m.id : '', machine: m ? m.name : line.name, area: m ? m.area || '' : '',
    problem: line.name + ' stopped at ' + new Date(stop.start).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + (run.product ? ' running ' + run.product : '') + '. Maintenance called from the line tablet.', notes: '', lineDown: stop.end ? 'NO' : 'YES',
    type: 'Maintenance Request', urgency: stop.end ? '' : 'HIGH', source: 'LINE_TABLET', sourceRunId: P.runId(req.operationId, req.shift.key), sourceStop: req.stopIndex, sourceShift: req.shift.name || '', sourceAt: stop.start,
    sourceBy: email, status: 'NEW', labor: [], createdAt: stamp, createdBy: email, updatedAt: stamp, updatedBy: email, testEdited: true };
  num.write(stamp);
  tx.set(ref, wo);
  return { id: ref.id, woNumber: wo.woNumber };
}
// A Blow Mold shift starts on the line's one product (the plant's Products list gives it only Gallon Jug).
async function onlyProduct(tx, db, operationId, line, run, stamp) {
  if (P.lineKind(line.name) !== 'BLOWMOLD' || run.product) return;
  const snap = await tx.get(db.collection('plantProducts').doc(docId(operationId)));
  const targets = P.targetsFor(snap.exists ? snap.data().products : []);
  if (targets.length !== 1) return;
  run.product = targets[0].name; run.sku = text(targets[0].sku);
  run.runs.push({ product: run.product, sku: run.sku, from: stamp, by: 'only product' });
}
async function saveLineEntry(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const line = await lineOf(tx, db, req.operationId, SaveError);
  const ref = db.collection('productionRuns').doc(docId(P.runId(req.operationId, req.shift.key))), had = await tx.get(ref);
  const before = had.exists ? had.data() : null;
  const run = before ? JSON.parse(JSON.stringify(before)) : { operationId: req.operationId, line: line.name, facilityId: line.facilityId, shiftKey: req.shift.key, shiftName: req.shift.name,
    date: req.shift.date, shiftStart: req.shift.start, shiftEnd: req.shift.end, product: '', sku: '', count: 0, counts: [], runs: [], stops: [], createdAt: stamp, createdBy: email };
  ['counts', 'runs', 'stops', 'changeovers', 'cips', 'crew', 'diverts'].forEach(k => { if (!Array.isArray(run[k])) run[k] = []; });
  // Joe 10/14: the Blow Mold makes only gallon jugs, so its one product runs from the shift's first entry without a pick.
  if (!before && req.op !== 'product') await onlyProduct(tx, db, req.operationId, line, run, stamp);
  if (!run.waste || typeof run.waste !== 'object') run.waste = {};
  if (!run.checks || typeof run.checks !== 'object') run.checks = {};
  const lineRef = db.collection('productionLines').doc(docId(req.operationId));
  let lineSet = null;
  // Joe 10/14: one weight record. The Blow Mold's heads and a filler's filled jugs are also the Quality screen's check (weightjoin.js);
  // what that needs is read here, before anything is written.
  const get = (r) => tx.get(r), kind = P.lineKind(line.name);
  if (!Array.isArray(run.fills)) run.fills = [];
  let headPlan = null, fillPlan = null, fillCtx = null;
  // The line's last lot and color, kept on the run at its first scan or pick: the run the shift started on (production-rules lotRuns).
  const lotLine = req.op === 'lot' || req.op === 'color' ? ((await tx.get(lineRef)).data() || {}) : null;
  // Joe 10/26: starting the Up next product brings its amount along as how many to run (the countdown), and Up next empties.
  const nextLine = req.op === 'product' || (req.op === 'changeover' && req.sub === 'done') ? ((await tx.get(lineRef)).data() || {}) : null;
  // The Up next amount when the product starting is the Up next product (and Up next empties); otherwise nothing.
  const fromNext = (product) => {
    const nx = nextLine && nextLine.next && typeof nextLine.next === 'object' ? nextLine.next : null;
    if (!nx || text(nx.product).toUpperCase() !== text(product).toUpperCase()) return {};
    lineSet = Object.assign(lineSet || {}, { next: null });
    return Number.isInteger(nx.qty) ? { qty: nx.qty } : {};
  };
  if (req.op === 'check' && kind === 'BLOWMOLD' && W.HEADS.indexOf(req.field) >= 0) headPlan = await W.planHeads(get, db, run, req.slot, stamp);
  if (req.op === 'fill') {
    if (!P.hasFill(line.name)) throw new SaveError('BAD_REQUEST', line.name + ' has no fill weight check.');
    if (req.index !== null && !run.fills[req.index]) throw new SaveError('NOT_FOUND', 'That fill weight check is not on this shift.');
    if (req.index !== null && Date.parse(stamp) - Date.parse(run.fills[req.index].at) >= 12 * 3600000) throw new SaveError('CONFLICT', 'That fill weight check is too old to change. Start a new one.');
    if (req.index === null) {
      if (run.fills.length >= P.LIMITS.FILLS) throw new SaveError('BAD_REQUEST', 'This shift has too many fill weight checks to keep.');
      fillCtx = await W.fillContext(get, db, line, req.operationId, run.product, Date.parse(stamp));
    }
    if (W.fillToQuality(line.name)) fillPlan = await W.planFill(get, db, run, req.index === null ? null : run.fills[req.index], req.index === null ? run.fills.length : req.index, stamp);
  }
  const open = run.stops.filter(s => !s.end)[0] || null;
  let message = line.name + ' saved.';
  if (req.op === 'product') {
    if (run.runs.length >= RUN_LIMIT) throw new SaveError('BAD_REQUEST', 'This shift has too many product changes to keep.');
    run.product = req.product; run.sku = req.sku;
    run.runs.push(Object.assign({ product: req.product, sku: req.sku, from: stamp, by: email }, fromNext(req.product)));
    message = line.name + ' is running ' + req.product + '.';
  } else if (req.op === 'qty') {
    const cur = run.runs.slice().sort((a, b) => Date.parse(a.from) - Date.parse(b.from)).pop();
    if (!cur) throw new SaveError('BAD_REQUEST', 'Pick the product running first.');
    cur.qty = req.qty; cur.qtyBy = email; cur.qtyAt = stamp;
    message = line.name + (req.qty === null ? ': no amount to run.' : ': run ' + req.qty.toLocaleString('en-US') + ' of ' + cur.product + '.');
  } else if (req.op === 'count') {
    run.count = req.count; run.countAt = stamp; run.countBy = email;
    run.counts.push({ at: stamp, count: req.count });
    if (run.counts.length > COUNT_LIMIT) run.counts = run.counts.slice(-COUNT_LIMIT);
    message = line.name + ': ' + req.count.toLocaleString('en-US') + ' made this shift.';
  } else if (req.op === 'stop') {
    if (open) throw new SaveError('CONFLICT', line.name + ' is already stopped.');
    if (run.stops.length >= STOP_LIMIT) throw new SaveError('BAD_REQUEST', 'This shift has too many stops to keep.');
    run.stops.push({ start: stamp, end: null, reason: '', by: email });
    message = line.name + ' stopped.';
  } else if (req.op === 'run') {
    if (!open) throw new SaveError('CONFLICT', line.name + ' is already running.');
    open.end = stamp; open.endBy = email;
    message = line.name + ' is running again.';
  } else if (req.op === 'changeover') {
    const co = run.changeovers.filter(x => !x.end)[0];
    if (req.sub === 'start') {
      if (co) throw new SaveError('CONFLICT', line.name + ' is already in a changeover.');
      if (run.changeovers.length >= P.LIMITS.CHANGEOVERS) throw new SaveError('BAD_REQUEST', 'This shift has too many changeovers to keep.');
      run.changeovers.push({ start: stamp, end: null, from: run.product || '', to: req.to, checks: {}, by: email });
      message = line.name + ': changeover started.';
    } else if (req.sub === 'to') {
      if (!co) throw new SaveError('CONFLICT', line.name + ' is not in a changeover.');
      co.to = req.to;
      message = line.name + ': changeover to ' + (req.to || 'no product picked') + '.';
    } else {
      if (!co) throw new SaveError('CONFLICT', line.name + ' is not in a changeover.');
      co.end = stamp; co.endBy = email;
      if (co.to && co.to !== run.product) { run.product = co.to; run.runs.push(Object.assign({ product: co.to, sku: '', from: stamp, by: email }, fromNext(co.to))); }
      message = line.name + ': changeover done.';
    }
  } else if (req.op === 'cocheck') {
    const co = run.changeovers.filter(x => !x.end)[0];
    if (!co) throw new SaveError('CONFLICT', line.name + ' is not in a changeover.');
    co.checks = co.checks || {};
    if (req.done) co.checks[req.key] = { by: email, at: stamp }; else delete co.checks[req.key];
    message = line.name + ': checklist saved.';
  } else if (req.op === 'cip') {
    const c = run.cips.filter(x => !x.end)[0];
    if (req.sub === 'start') {
      if (c) throw new SaveError('CONFLICT', line.name + ' is already washing.');
      if (run.cips.length >= P.LIMITS.CIPS) throw new SaveError('BAD_REQUEST', 'This shift has too many CIP washes to keep.');
      run.cips.push({ start: stamp, end: null, result: '', by: email });
      message = line.name + ': CIP wash started.';
    } else {
      if (!c) throw new SaveError('CONFLICT', line.name + ' is not washing.');
      c.end = stamp; c.endBy = email; c.result = req.result;
      if (req.result === 'PASS') lineSet = { lastCipAt: stamp };
      message = line.name + ': CIP wash done (' + (req.result === 'PASS' ? 'passed' : 'failed') + ').';
    }
  } else if (req.op === 'waste') {
    if (req.qty) run.waste[req.reason] = req.qty; else delete run.waste[req.reason];
    message = line.name + ': ' + req.qty + ' ' + req.reason + '.';
  } else if (req.op === 'check') {
    const k = String(req.slot), got = run.checks[k] || {};
    if (req.value) got[req.field] = req.value; else delete got[req.field];
    got.by = email; got.at = stamp;
    run.checks[k] = got;
    message = line.name + ': check saved.';
    if (headPlan) {
      const heads = W.headsOf(got), q = W.qualityWrite(headPlan, line, run, heads, W.HEADS, email, stamp);
      W.writeQuality(tx, db, q);
      got.qualityId = q.id;
      lineSet = { headsLast: W.headsLast(heads, stamp) };
    }
  } else if (req.op === 'fill') {
    let f = req.index === null ? null : run.fills[req.index];
    if (!f) { f = W.newFill(fillCtx, run, email, stamp); run.fills.push(f); }
    if (req.value === null) delete f[req.field]; else f[req.field] = req.value;
    f.editedAt = stamp; f.editedBy = email;
    if (fillPlan) {
      const q = W.qualityWrite(fillPlan, line, run, { result: W.jugsText(f) }, ['result'], email, stamp);
      W.writeQuality(tx, db, q);
      f.qualityId = q.id;
    }
    const o = P.fillOf(f), j = o.jugs[Number(req.field.slice(3)) - 1];
    message = line.name + ': ' + P.fillWords(line.name).one + ' ' + req.field.slice(3) + (req.value === null ? ' cleared.' : ' ' + req.value + ' g' + (j.net !== null ? ', ' + j.net + ' g of product' : '') + (j.flag ? ' (' + j.flag + ')' : '') + '.');
  } else if (req.op === 'crew') {
    const c = run.crew.filter(x => x.name.toUpperCase() === req.name.toUpperCase())[0];
    if (c) { c.on = req.on; c.at = stamp; c.by = email; } else {
      if (run.crew.length >= P.LIMITS.CREW) throw new SaveError('BAD_REQUEST', 'This line has too many names this shift.');
      run.crew.push({ name: req.name, on: req.on, at: stamp, by: email });
    }
    message = req.name + (req.on ? ' signed on ' : ' off ') + line.name + '.';
  } else if (req.op === 'note') {
    run.note = req.text; run.noteBy = email; run.noteAt = stamp;
    message = line.name + ': note saved.';
  } else if (req.op === 'divert') {
    const d = run.diverts.filter(x => !x.end)[0];
    if (req.sub === 'start') {
      if (d) throw new SaveError('CONFLICT', line.name + ' is already in divert.');
      if (run.diverts.length >= P.LIMITS.DIVERTS) throw new SaveError('BAD_REQUEST', 'This shift has too many diverts to keep.');
      run.diverts.push({ start: stamp, end: null, reason: req.reason, by: email });
      lineSet = { lastDivertAt: stamp };
      message = line.name + ': divert.';
    } else {
      if (!d) throw new SaveError('CONFLICT', line.name + ' is already in forward flow.');
      d.end = stamp; d.endBy = email;
      message = line.name + ': forward flow.';
    }
  } else if (req.op === 'source') {
    run.source = { from: req.from, to: req.to };
    message = line.name + ': silo and tanks saved.';
  } else if (req.op === 'lot' || req.op === 'color') {
    if (!Array.isArray(run.lotLog)) run.lotLog = [];
    const lot = req.op === 'lot' ? req.lot : text(run.lot) || text(lotLine.lot), color = req.op === 'color' ? req.color : text(run.color) || text(lotLine.color);
    const same = lot === (text(run.lot) || text(lotLine.lot)) && color === (text(run.color) || text(lotLine.color));
    if (!run.lotLog.length && !run.lotFrom) run.lotFrom = { lot: text(lotLine.lot), color: text(lotLine.color) };
    // Scanning the same lot again (or picking the same color) does not start a new run.
    if (!same) {
      if (run.lotLog.length >= LOT_LIMIT) throw new SaveError('BAD_REQUEST', 'This shift has too many resin lot changes to keep.');
      run.lotLog.push({ at: stamp, lot, color, count: Number(run.count) || 0, shots: Number(run.shots) || 0, by: email });
    }
    run.lot = lot; run.color = color; run.lotAt = stamp;
    lineSet = { lot, color };
    message = req.op === 'lot' ? line.name + ': resin lot ' + lot + '.' : line.name + ': ' + P.colorName(color) + ' jugs.';
  } else if (req.op === 'stock') {
    run.stock = req.count; run.stockAt = stamp;
    message = line.name + ': ' + req.count.toLocaleString('en-US') + ' jugs ahead of the filler.';
  } else if (req.op === 'next') {
    lineSet = { next: req.product ? { product: req.product, qty: req.qty, by: email, at: stamp } : null };
    message = line.name + (req.product ? ': next is ' + req.product + '.' : ': nothing next.');
  } else {
    const s = run.stops[req.stopIndex];
    if (!s) throw new SaveError('NOT_FOUND', 'That stop is not on this shift.');
    s.reason = req.reason; s.reasonBy = email;
    message = line.name + ' stop: ' + req.reason + '.';
    if (req.reason === MAINT_REASON && !s.workOrderId) {
      const wo = await stopWorkOrder(tx, db, req, line, run, s, email, stamp);
      s.workOrderId = wo.id; s.woNumber = wo.woNumber;
      message = line.name + ': work order ' + wo.woNumber + ' sent to maintenance.';
    }
  }
  if (lineSet) tx.set(lineRef, Object.assign({ operationId: req.operationId, line: line.name, facilityId: line.facilityId, updatedAt: stamp, updatedBy: email }, lineSet), { merge: true });
  if (req.op === 'next') {
    const result = { ok: true, requestId: req.requestId, operationId: req.operationId, op: req.op, message };
    tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, operationId: req.operationId, op: req.op, after: lineSet, result });
    return result;
  }
  run.updatedAt = stamp; run.updatedBy = email;
  tx.set(ref, run);
  const result = { ok: true, requestId: req.requestId, operationId: req.operationId, shiftKey: req.shift.key, op: req.op, message };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, operationId: req.operationId, shiftKey: req.shift.key, op: req.op, before: before ? { product: before.product, count: before.count, stops: (before.stops || []).length } : null,
    after: { product: run.product, count: run.count, stops: run.stops.length }, result });
  return result;
}

function validateLineCounter(input, SaveError) {
  const counter = text(input.counter).toUpperCase();
  if (P.COUNTERS.indexOf(counter) < 0) throw new SaveError('BAD_REQUEST', 'Pick how this line is counted.');
  return { operationId: lineId(input.operationId, SaveError), counter };
}
async function saveLineCounter(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const line = await lineOf(tx, db, req.operationId, SaveError);
  const ref = db.collection('productionLines').doc(docId(req.operationId)), had = await tx.get(ref);
  tx.set(ref, { operationId: req.operationId, line: line.name, facilityId: line.facilityId, counter: req.counter, updatedAt: stamp, updatedBy: email }, { merge: true });
  const result = { ok: true, requestId: req.requestId, operationId: req.operationId, counter: req.counter, message: line.name + ': ' + P.COUNTER_LABEL[req.counter] + '.' };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, operationId: req.operationId, before: had.exists ? had.data().counter || null : null, after: req.counter, result });
  return result;
}

// Line Targets' setup boxes (Joe 10/14): changeover standard, hours between CIP washes, and the Blow Mold's jug weight range.
// Joe 10/14: and each filler's fill weight check: how often (fillEvery MINUTES / JUGS / CHANGE, fillEveryN), the empty jug and cap
// in grams, and how far under or over the product's target fill weight is flagged.
// Joe 10/14: and a packing line's feeders (fedBy, the lines whose jugs it boxes) and how many jugs go in each box (perBox).
const SETUP_KEYS = ['changeoverMin', 'cipHours', 'jugWeightTarget', 'jugWeightLow', 'jugWeightHigh', 'fillEvery', 'fillEveryN', 'tareGrams', 'capGrams', 'fillUnder', 'fillOver', 'fedBy', 'perBox', 'redzoneLocation', 'labelRoom', 'beltMin', 'beltHolds'];
function validateLineSetup(input, SaveError) {
  const out = { operationId: lineId(input.operationId, SaveError) };
  [['changeoverMin', 'Changeover standard minutes', 600], ['cipHours', 'Hours between CIP washes', 72], ['jugWeightTarget', 'Jug weight target grams', 500], ['jugWeightLow', 'Lowest jug weight grams', 500], ['jugWeightHigh', 'Highest jug weight grams', 500],
    ['fillEveryN', 'How often', 100000], ['tareGrams', 'Empty jug weight grams', 2000], ['capGrams', 'Cap weight grams', 200], ['fillUnder', 'Light below target by grams', 1000], ['fillOver', 'Heavy above target by grams', 1000], ['perBox', 'Jugs in each box', 1000],
    // Joe 10/31: the Labeling Room: minutes on the belt from the Labeling Room to this filler, and how many bottles the belt holds.
    ['beltMin', 'Belt time minutes', 120], ['beltHolds', 'Bottles on the belt', 100000]].forEach(([k, label, max]) => {
    if (!(k in input)) return;
    const v = text(input[k]), n = Number(v);
    if (v !== '' && (!isFinite(n) || n < 0 || n > max)) throw new SaveError('BAD_REQUEST', label + ' must be a number from 0 to ' + max + '.');
    out[k] = v === '' ? null : n;
  });
  if ('fillEvery' in input) {
    const v = text(input.fillEvery).toUpperCase();
    if (v && !P.FILL_MODES.some(m => m[0] === v)) throw new SaveError('BAD_REQUEST', 'Pick how often the fill weight check is due.');
    out.fillEvery = v || null;
  }
  if ('fedBy' in input) {
    if (!Array.isArray(input.fedBy) || input.fedBy.length > 12) throw new SaveError('BAD_REQUEST', 'Pick up to 12 lines that feed this line.');
    const ids = input.fedBy.map(v => lineId(v, SaveError));
    if (ids.indexOf(out.operationId) >= 0) throw new SaveError('BAD_REQUEST', 'A line cannot feed itself.');
    out.fedBy = ids.filter((v, i) => ids.indexOf(v) === i);
  }
  // Joe 10/16: which RedZone line (its location's uuid) goes with this line; NONE for none, empty for the match by name.
  if ('redzoneLocation' in input) {
    const v = text(input.redzoneLocation);
    if (v && v !== 'NONE' && !/^[A-Za-z0-9-]{1,60}$/.test(v)) throw new SaveError('BAD_REQUEST', 'Pick a RedZone line.');
    out.redzoneLocation = v || null;
  }
  // Joe 10/31: whether this filler gets its bottles from the Labeling Room (ticked on Line Targets).
  if ('labelRoom' in input) {
    if (typeof input.labelRoom !== 'boolean') throw new SaveError('BAD_REQUEST', 'Tick or untick the Labeling Room box.');
    out.labelRoom = input.labelRoom;
  }
  if (Object.keys(out).length < 2) throw new SaveError('BAD_REQUEST', 'Nothing to save.');
  return out;
}
async function saveLineSetup(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const line = await lineOf(tx, db, req.operationId, SaveError);
  const ref = db.collection('productionLines').doc(docId(req.operationId)), had = await tx.get(ref), before = had.exists ? had.data() : {};
  const set = { operationId: req.operationId, line: line.name, facilityId: line.facilityId, updatedAt: stamp, updatedBy: email };
  SETUP_KEYS.forEach(k => { if (k in req) set[k] = req[k]; });
  tx.set(ref, set, { merge: true });
  const result = { ok: true, requestId: req.requestId, operationId: req.operationId, message: line.name + ' saved.' };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, operationId: req.operationId, before: Object.fromEntries(SETUP_KEYS.filter(k => k in req).map(k => [k, before[k] === undefined ? null : before[k]])), after: set, result });
  return result;
}

module.exports = { onlyProduct, validateLineEntry, saveLineEntry, validateLineCounter, saveLineCounter, validateLineSetup, saveLineSetup };
