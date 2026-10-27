/*
 * One weight record (Joe 10/14): a weight typed on a line tablet and the same weight on the Quality screen are one check, so
 * nobody weighs twice.
 *   - Blow Mold: the station's Head 1 to 6 (productionRuns checks[slot]) and the Quality screen's Blow Mold check (plantJournal
 *     PRODUCTION_QUALITY weights.head1 to head6). The slot keeps the Quality check's id (qualityId).
 *   - Fillers: the tablet's Fill weight check (productionRuns fills[]) and the Quality screen's Package weight (weights.result,
 *     the filled jugs in grams, "3861, 3863 g"). The fill keeps the Quality check's id. The 5-gallon bag fillers' bags too, where
 *     the Quality screen records a package weight (Boxing; Raypak's Quality check has none, so its bags stay on the tablet).
 * A weight saved on either screen is written to both, in the same save. The Blow Mold's latest head average is kept on its line
 * (productionLines headsLast): the Gallon Filler's empty jug weight (production-rules tareFor).
 * Every read is done before the save writes anything (Firestore transactions read first).
 */
'use strict';

const crypto = require('crypto');
const P = require('./production-rules');
const L = require('./logic');
const READER = require('./reader');
const PR = require('./plant-rules');

const QUALITY_TYPE = 'PRODUCTION_QUALITY';
const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
const docId = (id) => String(id).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 200);
const when = (v) => { const t = Date.parse(v || ''); return isFinite(t) ? t : 0; };
const HEADS = [1, 2, 3, 4, 5, 6].map(n => 'head' + n);
// A check started on the Quality screen this long before a fill weight check started is the same check.
const SAME_CHECK_MIN = 30;
// A fill weight check goes on the Quality screen only where that screen records the package weight (not Raypak's).
const fillToQuality = (lineName) => !PR.qualitySkip(lineName).weight;

// The line's newest Quality check of today and yesterday (operating days): { id, data } or null.
async function latestQuality(get, db, operationId, stamp) {
  const day = L.operatingDay(new Date(stamp));
  // Joe 10/22: only the two days' quality checks, not every plant record of those days (a whole-day read in a save ran past its
  // time on a busy live day: Cooler Temperature's manual readings).
  const snap = await get(db.collection('plantJournal').where('type', '==', QUALITY_TYPE).where('date', 'in', [L.addDays(day, -1), day]));
  const mine = snap.docs.map(d => ({ id: d.id, data: d.data() }))
    .filter(x => text(x.data.type).toUpperCase() === QUALITY_TYPE && text((x.data.payload || {}).operationId) === operationId && !(x.data.payload || {}).undone)
    .sort((a, b) => when(b.data.recordedAt) - when(a.data.recordedAt));
  return mine[0] || null;
}
async function journalDoc(get, db, id) {
  if (!id) return null;
  const s = await get(db.collection('plantJournal').doc(id));
  const d = s.exists ? s.data() : null;
  return d && d.type === QUALITY_TYPE ? { id, data: d } : null;
}
const newId = (key) => 'PRODUCTION_QUALITY_app_L' + crypto.createHash('sha1').update(String(key)).digest('hex').slice(0, 23);

// What the station's save will write to the Quality screen: { id, set } (a new check) or { id, update } (the same check).
// keys = the weight boxes this side owns (HEADS, or ['result']): the check's other weights are kept.
function qualityWrite(plan, line, run, weights, keys, email, stamp) {
  if (plan.into) {
    const old = plan.into.data, payload = Object.assign({}, old.payload || {}), was = Object.assign({}, payload.weights || {});
    keys.forEach(k => { delete was[k]; });
    payload.weights = Object.assign(was, weights);
    return { id: plan.into.id, update: { payload, editedAt: stamp, editedBy: email, testEdited: true } };
  }
  const last = plan.last ? plan.last.data.payload || {} : {}, status = text(last.status).toUpperCase() && text(last.status).toUpperCase() !== 'FINISHED' ? text(last.status).toUpperCase() : 'RUNNING';
  const payload = { operationId: run.operationId, area: line.name, product: text(run.product) || text(last.product), status, remainingOutput: '', qualityCheck: '', tipTest: '', temperature: '',
    cycleTime: '', productSize: text(last.productSize), annealerSpeed: '', weights, notes: '', facilityId: line.facilityId || 'fac_uniontown', fromLine: true };
  return { id: plan.newId, set: { recordId: 'PQ-LINE-' + plan.newId.slice(-12), type: QUALITY_TYPE, date: L.operatingDay(new Date(stamp)), status, area: line.name, temperature: '', notes: '',
    payload, recordedAt: stamp, recordedBy: email, createdInApp: true, testEdited: true, editedAt: stamp } };
}
function writeQuality(tx, db, w) {
  const ref = db.collection('plantJournal').doc(w.id);
  if (w.update) tx.update(ref, w.update); else tx.set(ref, w.set);
}

/* ---------- Blow Mold heads ---------- */

// Station side, read first: which Quality check the slot's heads go to (its own, else the line's open check of this slot, else new).
async function planHeads(get, db, run, slot, stamp) {
  const got = (run.checks || {})[String(slot)] || {}, linked = await journalDoc(get, db, text(got.qualityId));
  if (linked) return { into: linked };
  const last = await latestQuality(get, db, run.operationId, stamp), start = when(run.shiftStart) + slot * (P.CHECK_EVERY.BLOWMOLD || 2) * 3600000;
  const open = last && when(last.data.recordedAt) >= start && text((last.data.payload || {}).status).toUpperCase() !== 'FINISHED' ? last : null;
  return { into: open, last, newId: newId(run.operationId + '|' + run.shiftKey + '|' + slot) };
}
const headsOf = (c) => { const h = {}; HEADS.forEach(k => { if (text(c[k]) !== '') h[k] = text(c[k]); }); return h; };
// The Blow Mold's latest heads for the Gallon Filler's empty jug: { avg, at, heads } or null when no head is weighed.
function headsLast(heads, stamp) { const avg = P.headsAverage(heads); return avg === null ? null : { avg, at: stamp, heads }; }

/* ---------- Fillers ---------- */

// The numbers the fill math needs when a fill weight check starts: the empty jug, the cap, the product's target and the line's
// allowances (production-rules fillOf works out each jug from these).
async function fillContext(get, db, line, operationId, product, nowMs) {
  const ld = (await get(db.collection('productionLines').doc(docId(operationId)))).data() || {};
  let blow = null;
  if (P.usesBlowMoldJugs(line.name)) {
    const lines = await get(db.collection('productionLines').where('facilityId', '==', line.facilityId || 'fac_uniontown'));
    lines.docs.map(d => d.data()).forEach(d => { if (P.lineKind(d.line) === 'BLOWMOLD' && d.headsLast && (!blow || when(d.headsLast.at) > when(blow.at))) blow = d.headsLast; });
  }
  const tare = P.tareFor(line.name, Object.assign({ line: line.name }, ld), blow, nowMs);
  const ps = await get(db.collection('plantProducts').doc(docId(operationId)));
  const t = P.targetsFor(ps.exists ? ps.data().products : []).filter(x => x.name.toUpperCase() === text(product).toUpperCase())[0];
  const n = (v) => (v === null || v === undefined || v === '' || !isFinite(Number(v)) ? null : Number(v));
  return { tare: tare ? tare.grams : null, tareFrom: tare ? tare.from : '', tareAt: tare ? tare.at : '', cap: n(ld.capGrams), target: t ? n(t.fillGrams) : null, under: n(ld.fillUnder), over: n(ld.fillOver) };
}
function newFill(ctx, run, email, stamp) {
  return Object.assign({ at: stamp, by: email, product: text(run.product), count: Number(run.count) || 0 }, ctx);
}
const jugsText = (f) => { const g = []; for (let i = 1; i <= P.FILL_MAX; i++) if (text(f['jug' + i]) !== '') g.push(text(f['jug' + i])); return g.length ? g.join(', ') + ' g' : ''; };
// The filled jugs typed on the Quality screen's Package weight, when they are grams (1 to 5 numbers of 100 g or more): [g, ...] or null.
function jugsFrom(result) {
  const nums = (text(result).replace(/,(?=\d{3}\b)/g, '').match(/\d+(\.\d+)?/g) || []).map(Number);
  return nums.length >= 1 && nums.length <= P.FILL_MAX && nums.every(n => n >= 100 && n <= P.LIMITS.GRAMS) ? nums : null;
}
// Station side, read first: the Quality check a fill weight check goes to (its own, else one started on the Quality screen just
// before with no weight yet, else new).
async function planFill(get, db, run, fill, index, stamp) {
  const linked = await journalDoc(get, db, text(fill && fill.qualityId));
  if (linked) return { into: linked };
  const last = await latestQuality(get, db, run.operationId, stamp), start = when(fill ? fill.at : stamp);
  const w = last ? (last.data.payload || {}).weights || {} : {};
  const open = last && when(last.data.recordedAt) >= start - SAME_CHECK_MIN * 60000 && !text(w.result) && text((last.data.payload || {}).status).toUpperCase() !== 'FINISHED' ? last : null;
  return { into: open, last, newId: newId(run.operationId + '|' + run.shiftKey + '|fill|' + index + '|' + start) };
}

/* ---------- The Quality screen's side ---------- */

// Read first, when the Quality screen saves a Blow Mold or filler check with weights: the line's shift (and what the fill math
// needs). Returns null when there is nothing to copy to the line tablet.
async function planFromQuality(tx, db, d, req, checkId, stamp, email) {
  const kind = P.lineKind(d.name), w = req.weights || {}, get = (ref) => tx.get(ref);
  const heads = kind === 'BLOWMOLD' ? headsOf(w) : null, jugs = P.hasFill(d.name) && fillToQuality(d.name) ? jugsFrom(w.result) : null;
  if (!(heads && Object.keys(heads).length) && !jugs) return null;
  const line = { name: d.name, facilityId: d.facilityId || 'fac_uniontown' }, ms = Date.parse(stamp);
  const shifts = await tx.get(db.collection('plantShifts').doc(docId(line.facilityId)));
  const shift = READER.plantShift(shifts.exists ? shifts.data().shifts : null, ms);
  const ref = db.collection('productionRuns').doc(docId(P.runId(req.operationId, shift.key))), had = await tx.get(ref);
  const run = had.exists ? JSON.parse(JSON.stringify(had.data())) : { operationId: req.operationId, line: line.name, facilityId: line.facilityId, shiftKey: shift.key, shiftName: shift.name,
    date: shift.date, shiftStart: shift.start, shiftEnd: shift.end, product: '', sku: '', count: 0, counts: [], runs: [], stops: [], createdAt: stamp, createdBy: email };
  const plan = { ref, run, kind, line, heads, jugs, checkId };
  if (jugs) {
    run.fills = Array.isArray(run.fills) ? run.fills : [];
    plan.index = run.fills.findIndex(f => f && f.qualityId === checkId);
    if (plan.index < 0) plan.ctx = await fillContext(get, db, line, req.operationId, text(run.product) || req.product, ms);
  }
  return plan;
}
function applyFromQuality(tx, db, plan, req, email, stamp) {
  const run = plan.run;
  if (plan.heads) {
    run.checks = run.checks && typeof run.checks === 'object' ? run.checks : {};
    let slot = Object.keys(run.checks).filter(k => run.checks[k] && run.checks[k].qualityId === plan.checkId)[0];
    if (slot === undefined) { const due = P.checkDue(run, 'BLOWMOLD', Date.parse(stamp)); slot = String(due ? due.slot : 0); }
    const got = run.checks[slot] || {};
    HEADS.forEach(k => { if (k in plan.heads) got[k] = plan.heads[k]; else if (text((req.weights || {})[k]) === '' && k in got && got.qualityId === plan.checkId) delete got[k]; });
    got.qualityId = plan.checkId; got.by = email; got.at = stamp;
    run.checks[slot] = got;
    const hl = headsLast(headsOf(got), stamp);
    if (hl) tx.set(db.collection('productionLines').doc(docId(req.operationId)), { operationId: req.operationId, line: plan.line.name, facilityId: plan.line.facilityId, headsLast: hl, updatedAt: stamp, updatedBy: email }, { merge: true });
  }
  if (plan.jugs) {
    let f = plan.index >= 0 ? run.fills[plan.index] : null;
    if (!f) { if (run.fills.length >= P.LIMITS.FILLS) return; f = newFill(plan.ctx, Object.assign({}, run, { product: text(run.product) || req.product }), email, stamp); f.qualityId = plan.checkId; run.fills.push(f); }
    for (let i = 1; i <= P.FILL_MAX; i++) { if (i <= plan.jugs.length) f['jug' + i] = plan.jugs[i - 1]; else delete f['jug' + i]; }
    f.editedAt = stamp; f.editedBy = email;
  }
  run.updatedAt = stamp; run.updatedBy = email;
  tx.set(plan.ref, run);
}

module.exports = { QUALITY_TYPE, HEADS, fillToQuality, latestQuality, qualityWrite, writeQuality, planHeads, headsOf, headsLast, fillContext, newFill, jugsText, jugsFrom, planFill, planFromQuality, applyFromQuality };
