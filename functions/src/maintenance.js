/*
 * United Dairy Distribution app: the maintenance queues a check-in feeds.
 *
 * Same as the current app (udpoCheckInIssuesFromApp_ / udpoInboundSaveReport_, 7.0.250): a check-in's truck, trailer
 * and pallet jack problems, "trailer needs cleaned" and refused / returned product each become one record in the
 * matching queue (TRUCK LIVE, TRAILER LIVE, FORK TRUCK LIVE, WASH / CLEANING LIVE, REFUSALS / RETURNS LIVE), with the
 * same record shape, equipment matching and review flag. Answers like "none", "ok" or "no issues" make no record.
 * Records live in `maintenance`; with the write-back on they are added to those tabs of the sandbox Live workbook,
 * where the garage's current screens read them. One record per run, day and kind: fixing a check-in does not add a
 * second record.
 */
'use strict';

const C = require('./model').COLLECTIONS;

const FACILITY = 'fac_uniontown';
const TABS = Object.freeze({ TRUCK: 'TRUCK LIVE', TRAILER: 'TRAILER LIVE', FORK_TRUCK: 'FORK TRUCK LIVE', WASH: 'WASH / CLEANING LIVE', RETURN: 'REFUSALS / RETURNS LIVE' });
// The write-back's list name for each queue (masterwrite.js).
const LISTS = Object.freeze({ TRUCK: 'maintTruck', TRAILER: 'maintTrailer', FORK_TRUCK: 'maintFork', WASH: 'maintWash', RETURN: 'maintReturns' });

function noWriteUp(value) {
  let t = String(value === null || value === undefined ? '' : value).toLowerCase().replace(/[^a-z0-9/+ ]+/g, ' ').replace(/\s+/g, ' ').replace(/^[/+ ]+|[/+ ]+$/g, '');
  if (!t) return true;
  if (/^(?:x+|n|no|nope|none|nil|na|n a|n\/a|negative|nothing|ok|okay|good|fine|working|working fine|all good|all ok|all okay|all clear)$/.test(t)) return true;
  if (/^(?:no|nothing|none)(?: (?:new|known|major|minor|other))? (?:write ?ups?|issues?|defects?|problems?|concerns?|repairs?|damages?|complaints?|comments?|reports?|notes?)(?: (?:to report|reported|noted|found|today|at this time|this trip))?$/.test(t)) return true;
  if (/^(?:nothing|none) (?:to report|wrong|noted|today|needed|at this time)$/.test(t)) return true;
  if (/^(?:n0|it ?s (?:fine|good|ok|okay)|it is (?:fine|good|ok|okay)|its (?:fine|good|ok|okay))$/.test(t)) return true;
  t = t.replace(/[^a-z0-9 ]+/g, ' ').trim();
  return /^(?:y|ye|yes|yep|yeah|ytes|ye s)$/.test(t);
}

// A typed unit ("T-901", "901", "01") to its Equipment Master entry, as udpoInboundResolveUnit_ does.
function resolveUnit(raw, kind, equipment) {
  const norm = (u) => String(u || '').trim().toUpperCase().replace(/^T\s*-?\s*(?=\d)/, '').replace(/^0+(?=\d)/, '');
  const key = norm(raw), wanted = kind === 'WASH' ? 'TRAILER' : kind;
  const eligible = (equipment || []).filter(e => e.type === wanted);
  let matches = key ? eligible.filter(e => norm(e.unit) === key) : [];
  if (!matches.length && /^\d{1,4}$/.test(key)) { const suffix = key.length < 3 ? key.padStart(3, '0') : key; matches = eligible.filter(e => { const n = norm(e.unit); return n.length > suffix.length && n.slice(-suffix.length) === suffix; }); }
  if (matches.length > 1) { const active = matches.filter(e => !e.status || e.status === 'ACTIVE'); if (active.length) matches = active; }
  return matches.length === 1 ? { id: matches[0].id, unit: matches[0].unit, resolved: true } : { id: '', unit: String(raw || '').trim(), resolved: false };
}

/*
 * The records one check-in makes. run = the run doc, day = its prefix, date = yyyy-mm-dd, c = the saved check-in fields
 * merged over the day (truck, trailer, palletJack ...), who = {by, driver}, equipment = Equipment Master copy.
 */
function recordsFor(run, runDocId, day, date, c, who, equipment, stamp) {
  const issues = [];
  const add = (kind, key, text, unit) => { if (!noWriteUp(text)) issues.push({ kind, key, text: String(text).trim().slice(0, 4000), unit }); };
  add('FORK_TRUCK', 'pallet', c.palletJackIssues, c.palletJack);
  if (c.trailerNeedsCleaned === true || /^(y|yes|true)$/i.test(String(c.trailerNeedsCleaned || ''))) issues.push({ kind: 'WASH', key: 'cleaning', text: 'Trailer cleaning requested', unit: c.trailer });
  add('TRUCK', 'tractor', c.tractorIssues, c.truck);
  add('TRAILER', 'trailer', c.trailerIssues, c.trailer);
  if (String(c.refusedReturned || '').trim()) issues.push({ kind: 'RETURN', key: 'refusedreturned', text: String(c.refusedReturnedSource || c.refusedReturned).trim() || 'Refused or returned product reported', unit: '', source: String(c.refusedReturnedSource || '').trim() });
  return issues.map(issue => {
    const unit = issue.kind === 'RETURN' ? { id: '', unit: '', resolved: true }
      : issue.kind === 'TRUCK' && c.truckId ? { id: c.truckId, unit: c.truck, resolved: true }
      : (issue.kind === 'TRAILER' || issue.kind === 'WASH') && c.trailerId ? { id: c.trailerId, unit: c.trailer, resolved: true }
      : resolveUnit(issue.unit, issue.kind, equipment);
    const review = !unit.resolved;
    const id = 'APP|' + runDocId + '|' + day + '|' + issue.key;
    const r = { record_id: id, kind: issue.kind, facility_id: FACILITY, service_date: date, source_type: 'ROUTE_APP', source_id: runDocId + '|' + day,
      status: review ? 'NEEDS_REVIEW' : 'OPEN', priority: '', opened_at: stamp, opened_by: who.by, updated_at: stamp, updated_by: 'ROUTE_APP',
      driver: who.driver || '', issue_type: 'DRIVER_REPORT', issue_details: issue.text, route_id: run.routeId || '', run_id: run.runId || '',
      notes: 'Reported route: ' + run.route + '; driver: ' + (who.driver || '') + '; source: new app check-in' + (review ? '; REVIEW: confirm equipment/classification or missing detail.' : '') };
    if (issue.kind === 'RETURN') Object.assign(r, { reason_details: issue.text, return_source: issue.source || 'DRIVER_CHECKIN', disposition: 'PENDING_REVIEW' });
    if (issue.kind === 'TRUCK') Object.assign(r, { truck_number: unit.unit, truck_id: unit.id });
    if (issue.kind === 'TRAILER') Object.assign(r, { trailer_number: unit.unit, trailer_id: unit.id });
    if (issue.kind === 'FORK_TRUCK' || issue.kind === 'WASH') Object.assign(r, { unit_number: unit.unit, equipment_id: unit.id, equipment_type: issue.kind === 'WASH' ? 'TRAILER' : 'FORK_TRUCK' });
    if (issue.kind === 'WASH') Object.assign(r, { wash_reason: issue.text, wash_status: review ? 'NEEDS_REVIEW' : 'REQUESTED', wash_type: 'TRAILER' });
    return r;
  });
}

const docId = (recordId) => recordId.replace(/[^A-Za-z0-9_-]+/g, '_');

/*
 * Inside a check-in's transaction. Reads first (the equipment list and the records it may make), then returns a
 * function that does the writes, because a Firestore transaction reads everything before it writes.
 */
async function prepareMaintenance(tx, db, run, runDocId, day, date, c, who, stamp) {
  const equipment = (await tx.get(db.collection(C.equipment))).docs.map(d => d.data());
  const records = recordsFor(run, runDocId, day, date, c, who, equipment, stamp);
  const refs = records.map(r => db.collection(C.maintenance).doc(docId(r.record_id)));
  const snaps = refs.length ? await tx.getAll(...refs) : [];
  return (queue) => {
    const made = [];
    records.forEach((r, i) => {
      if (snaps[i].exists) return; // already on the queue from an earlier save of this check-in
      tx.set(refs[i], Object.assign({ createdInApp: true }, r));
      if (queue) queue(refs[i], r);
      made.push(r.record_id);
    });
    return made;
  };
}

module.exports = { TABS, LISTS, FACILITY, noWriteUp, resolveUnit, recordsFor, prepareMaintenance, docId };
