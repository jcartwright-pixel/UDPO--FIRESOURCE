/*
 * United Dairy Distribution app: the plant side (Loadout Center, Unloading, Washing, Returns, Scheduler ...).
 *
 * The same rules as the current app's plant screens (Plant.html and its server files):
 *   - who may load, unload and wash: PLANT_EMPLOYEE plus the dispatch savers (91_V50_RolePermissions.gs);
 *   - a load's Start / End / status (desktopUiSavePlantAreaLoadoutCurrent, 020_V725_RouterGateways.gs): an End time
 *     makes it COMPLETE, a Start time without an End makes it LOADING, clearing the End goes back to LOADING or waiting;
 *   - typed truck and trailer numbers are matched to Equipment Master the way the plant matches them (T-901, 901, 01);
 *   - pickups (product that did not load at loadout) live in the Plant Operations workbook's LIVE PLANT OPERATIONS tab.
 *
 * What the copy reads for the plant is optional: a tab the server cannot read is skipped and the dispatch copy carries
 * on. The sandbox reads only the copies named for it (SOURCES_JSON "plant"); it never falls back to the real sheets.
 */
'use strict';

const L = require('./logic');
const MAINT = require('./maintenance');

// Everyone who may save on Daily Dispatch, plus the plant floor.
const PLANT_ROLES = L.SAVE_ROLES.concat(['PLANT_EMPLOYEE']);

// The four loadout areas and their words (desktopV5063LoadoutTypeToArea_ and the Daily <area> Loadout titles).
const AREAS = Object.freeze({
  CASE: { title: 'Daily Case Loadout', label: 'Cases Out', inLabel: 'Cases In', tile: 'Cases' },
  TOTES: { title: 'Daily Tote Loadout', label: 'Totes Out', inLabel: 'Totes In', tile: 'Totes' },
  BOXING: { title: 'Daily Box Loadout', label: 'Boxes Out', inLabel: 'Boxes In', tile: 'Boxes' },
  TANKER: { title: 'Daily Tanker Loadout', label: 'Quantity Out', inLabel: 'Gallons In', tile: 'Tanker' }
});
function areaOf(loadType) {
  const t = String(loadType || '').trim().toUpperCase();
  if (t === 'CASE LOADOUT' || t === 'CASE') return 'CASE';
  if (t === 'TOTE' || t === 'TOTES' || t === 'TOTE LOADOUT') return 'TOTES';
  if (t === 'BOXING' || t === 'BOX' || t === 'BOXES' || t === 'BOX LOADOUT') return 'BOXING';
  if (t === 'TANKER' || t === 'TANKER LOADOUT') return 'TANKER';
  return '';
}

/* ---------- the copy ---------- */

// The plant journal record types the plant screens read (191_V5063_LiveRuntimeEnforcement.gs).
const JOURNAL_TYPES = ['UNLOADING', 'RETURN', 'WASHING', 'YARD_CHECK', 'SHIFT_REPORT', 'PLANT_TEMPERATURE_CHECK', 'PLANT_SCHEDULE', 'PLANT_RECEIVING', 'PLANT_SUPPLIER', 'PLANT_REPORT_EMAIL'];
const PICKUP_HEADERS = ['pickup_id', 'facility_id', 'service_date', 'route_id', 'run_id', 'route', 'run', 'operation_type', 'item', 'quantity', 'pickup_location', 'notes', 'status', 'manager_acknowledged', 'created_at', 'created_by', 'updated_at', 'updated_by', 'completed_at', 'completed_by'];

const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
const norm = (h) => text(h).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const docId = (id) => String(id).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 200);

function table(values, idColumn) {
  const rows = values || [];
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) if ((rows[i] || []).map(norm).indexOf(idColumn) >= 0) { h = i; break; }
  if (h < 0) return { index: null, rows: [], start: 0 };
  const index = {};
  rows[h].forEach((cell, i) => { const k = norm(cell); if (k && index[k] === undefined) index[k] = i; });
  return { index, rows: rows.slice(h + 1), start: h + 2 };
}
function cellsOf(row, index) {
  const cells = {};
  Object.keys(index).forEach(k => { const t = text(row[index[k]]); if (t) cells[k] = t; });
  return cells;
}

// PLANT_OPERATIONS: one row per change of a record, the last row is the record now (the payload is kept as written).
function parseJournal(values) {
  const t = table(values, 'record_id'), docs = {};
  if (!t.index) return docs;
  t.rows.forEach((row, i) => {
    const c = cellsOf(row, t.index), id = c.record_id;
    if (!id) return;
    const type = text(c.record_type).toUpperCase();
    const key = docId(type + '|' + id);
    delete docs[key];
    if (JOURNAL_TYPES.indexOf(type) < 0) return;
    let payload = {};
    try { payload = JSON.parse(c.payload_json || '{}') || {}; } catch (e) { payload = {}; }
    docs[key] = { recordId: id, type, date: L.dateKey(c.business_date) || '', status: text(c.status).toUpperCase(), route: c.route || '', run: c.run || '', runId: c.run_id || '',
      routeId: c.route_id || '', trailer: c.trailer || '', quantity: c.quantity || '', temperature: c.temperature || '', startedAt: c.started_at || '', completedAt: c.completed_at || '',
      shift: c.shift || '', area: text(c.area).toUpperCase(), notes: c.notes || '', recordedAt: c.recorded_at || '', recordedBy: c.recorded_by || '', payload, sheetRow: t.start + i, cells: c };
  });
  return docs;
}

// LIVE PLANT OPERATIONS: the pickups (udpoV722PlantPickupRowsAll_), operation_type PICKUP only.
function parsePickups(values) {
  const t = table(values, 'pickup_id'), docs = {};
  if (!t.index) return docs;
  t.rows.forEach((row, i) => {
    const c = cellsOf(row, t.index);
    if (!c.pickup_id || text(c.operation_type).toUpperCase() !== 'PICKUP') return;
    docs[docId(c.pickup_id)] = { pickupId: c.pickup_id, date: L.dateKey(c.service_date) || '', routeId: c.route_id || '', runId: c.run_id || '', route: c.route || '', run: c.run || '',
      item: c.item || '', quantity: c.quantity || '', location: c.pickup_location || '', notes: c.notes || '', status: text(c.status).toUpperCase() || 'PENDING',
      createdAt: c.created_at || '', createdBy: c.created_by || '', completedAt: c.completed_at || '', completedBy: c.completed_by || '', sheetRow: t.start + i, cells: c };
  });
  return docs;
}

// WASH / CLEANING LIVE and REFUSALS / RETURNS LIVE, row for row (the Washing and Returns screens).
function parseQueueTab(values, kind) {
  const t = table(values, 'record_id'), docs = {};
  if (!t.index) return docs;
  t.rows.forEach((row, i) => {
    const c = cellsOf(row, t.index);
    if (!c.record_id) return;
    docs[docId(c.record_id)] = Object.assign({}, c, { kind, status: text(c.status).toUpperCase() || 'OPEN', date: L.dateKey(c.service_date) || '', sheetRow: t.start + i, cells: c });
  });
  return docs;
}

const PLANT_LISTS = Object.freeze({
  plantJournal: { collection: 'plantJournal', where: 'live', tab: 'PLANT_OPERATIONS', parse: parseJournal },
  plantWash: { collection: 'plantWash', where: 'live', tab: 'WASH / CLEANING LIVE', parse: (v) => parseQueueTab(v, 'WASH') },
  plantReturns: { collection: 'plantReturns', where: 'live', tab: 'REFUSALS / RETURNS LIVE', parse: (v) => parseQueueTab(v, 'RETURN') },
  pickups: { collection: 'pickups', where: 'pickups', tab: 'LIVE PLANT OPERATIONS', parse: parsePickups }
});

/*
 * Reads every plant list that can be read. sources.live = the Live workbook (or its copy), read for the plant when
 * sources.live.plant is set; sources.plant.pickups =
 * {spreadsheetId, tab} of the Plant Operations workbook (or its copy). Returns {lists: {name: docs}, skipped: [why]}.
 */
async function readPlant(reader, sources) {
  const lists = {}, skipped = [];
  for (const name of Object.keys(PLANT_LISTS)) {
    const spec = PLANT_LISTS[name];
    // The Live workbook's plant tabs are read where the setup says so (live.plant, like live.maintenanceQueues).
    const named = spec.where === 'live' ? (sources.live && sources.live.plant ? sources.live : null) : sources.plant && sources.plant[spec.where];
    const at = named && named.spreadsheetId, tab = spec.where === 'live' ? spec.tab : (named && named.tab) || spec.tab;
    if (!at) { skipped.push(name + ': no sheet named'); continue; }
    try { lists[name] = spec.parse((await reader.batchGet(at, ["'" + tab + "'"]))[0]); } catch (e) { skipped.push(name + ': ' + String(e && e.message || e).slice(0, 120)); }
  }
  return { lists, skipped };
}

/* ---------- saves ---------- */

function count(v, label, SaveError) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < 0 || n > 999999) throw new SaveError('BAD_REQUEST', label + ' must be a number from 0 to 999999');
  return n;
}
function stampOrBlank(v, label, SaveError) {
  const t = text(v);
  if (!t) return '';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t) || !Number.isFinite(Date.parse(t))) throw new SaveError('BAD_REQUEST', label + ' must be a date and time');
  return new Date(Date.parse(t)).toISOString();
}

// savePlantLoad's fields: what the Loadout Center, its Edit box and the tablet change on one load.
const STATUSES = ['NOT_STARTED', 'LOADING', 'COMPLETE'];
function validateLoad(input, SaveError) {
  const f = input.fields || {}, out = {};
  if (f.status !== undefined) { out.status = text(f.status).toUpperCase(); if (STATUSES.indexOf(out.status) < 0) throw new SaveError('BAD_REQUEST', 'Status must be Waiting, Loading or Done'); }
  if (f.startedAt !== undefined) out.startedAt = stampOrBlank(f.startedAt, 'Start Time', SaveError);
  if (f.completedAt !== undefined) out.completedAt = stampOrBlank(f.completedAt, 'End Time', SaveError);
  if (out.startedAt && out.completedAt && out.completedAt < out.startedAt) throw new SaveError('BAD_REQUEST', 'End Time cannot be before Start Time');
  if (f.quantity !== undefined) out.quantity = count(f.quantity, 'Quantity', SaveError);
  if (f.temperature !== undefined) {
    const t = text(f.temperature);
    out.temperature = t === '' ? null : Number(t);
    if (t !== '' && (!Number.isFinite(out.temperature) || out.temperature < -40 || out.temperature > 120)) throw new SaveError('BAD_REQUEST', 'Temperature must be a number of degrees');
  }
  if (f.notes !== undefined) out.notes = text(f.notes).slice(0, 1200);
  if (f.shift !== undefined) out.shift = text(f.shift).slice(0, 40);
  if (f.truck !== undefined) out.truck = text(f.truck).toUpperCase().slice(0, 40);
  if (f.trailer !== undefined) out.trailer = text(f.trailer).toUpperCase().slice(0, 60);
  if (f.runs !== undefined) { if (f.runs !== false) throw new SaveError('BAD_REQUEST', 'A load can only be marked as not running here'); out.runs = false; }
  if (!Object.keys(out).length) throw new SaveError('BAD_REQUEST', 'Nothing to save');
  return out;
}

// The day fields one savePlantLoad changes. day = the run's day block now; equipment is read only when a unit was typed.
async function loadValues(tx, db, req, day, stamp, SaveError) {
  const f = req.plant, after = {};
  if (f.runs === false) return { runs: false };
  if (f.quantity !== undefined) after.casesOut = f.quantity;
  if (f.temperature !== undefined) after.loadTemperature = f.temperature;
  if (f.notes !== undefined) after.plantNotes = f.notes;
  if (f.shift !== undefined) after.plantShift = f.shift;
  let started = day.plantStartedAt || '', completed = day.completeTime || '';
  if (f.startedAt !== undefined) { started = f.startedAt; after.plantStartedAt = started; }
  if (f.completedAt !== undefined) { completed = f.completedAt; after.completeTime = completed; }
  let status = f.status;
  if (status === 'COMPLETE') {
    // Done from the picker: the load keeps its times and gets an End time now if it had none.
    if (!completed) { completed = stamp; after.completeTime = stamp; }
    if (!started) { started = completed; after.plantStartedAt = completed; }
  } else if (status === 'LOADING') {
    if (completed) after.completeTime = '';
    if (!started) after.plantStartedAt = stamp;
  } else if (status === 'NOT_STARTED') {
    if (completed) after.completeTime = '';
    if (started) after.plantStartedAt = '';
  } else if (completed) status = 'COMPLETE';
  else if (f.completedAt !== undefined) status = started ? 'LOADING' : 'NOT_STARTED';
  else if (f.startedAt !== undefined) status = started ? 'LOADING' : 'NOT_STARTED';
  if (status) after.loadStatus = status;
  if (f.truck !== undefined || f.trailer !== undefined) {
    const equipment = (await tx.get(db.collection('equipment'))).docs.map(d => Object.assign({ id: d.id }, d.data()));
    [['truck', 'TRUCK', 'truckId'], ['trailer', 'TRAILER', 'trailerId']].forEach(([k, type, idField]) => {
      if (f[k] === undefined) return;
      if (!f[k]) { after[k] = ''; after[idField] = ''; return; }
      const u = MAINT.resolveUnit(f[k], type, equipment);
      // A number no unit matches is kept as typed, the same as the current app.
      after[k] = type === 'TRAILER' && !u.resolved && /^\d+$/.test(u.unit) ? 'T-' + u.unit : u.unit;
      after[idField] = u.id;
    });
  }
  return after;
}

// Pickups: "Add Pickup" (Product / Item, Quantity / Cases, Optional Note) and "Pickup Complete".
function validatePickup(action, input, SaveError) {
  const out = {};
  if (action === 'completePickup') {
    out.pickupId = text(input.pickupId).slice(0, 120);
    if (!out.pickupId) throw new SaveError('BAD_REQUEST', 'Pick the pickup');
    return out;
  }
  out.runDocId = text(input.runDocId).slice(0, 200);
  out.day = text(input.day).slice(0, 10);
  if (!out.runDocId || L.DAYS.indexOf(out.day) < 0) throw new SaveError('BAD_REQUEST', 'runDocId and day are required');
  out.date = text(input.date);
  if (!L.isDateKey(out.date)) throw new SaveError('BAD_REQUEST', 'date must be yyyy-mm-dd');
  out.item = text(input.item).slice(0, 200);
  if (!out.item) throw new SaveError('BAD_REQUEST', 'Enter the product or item');
  out.quantity = count(input.quantity, 'Quantity', SaveError);
  if (out.quantity === null) throw new SaveError('BAD_REQUEST', 'Enter the quantity');
  out.notes = text(input.notes).slice(0, 500);
  return out;
}

async function savePickup(tx, db, req, email, stamp, logRef, mode, SaveError) {
  if (req.action === 'completePickup') {
    const ref = db.collection('pickups').doc(docId(req.pickupId));
    const snap = await tx.get(ref);
    if (!snap.exists) throw new SaveError('NOT_FOUND', 'That pickup is no longer on the list');
    const p = snap.data();
    const result = { ok: true, requestId: req.requestId, pickupId: req.pickupId, already: p.status === 'COMPLETE' };
    if (p.status !== 'COMPLETE') tx.update(ref, { status: 'COMPLETE', completedAt: stamp, completedBy: email, testEdited: true, editedAt: stamp });
    tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, pickupId: req.pickupId, before: { status: p.status }, after: { status: 'COMPLETE' }, result });
    return result;
  }
  const runSnap = await tx.get(db.collection('runs').doc(req.runDocId));
  if (!runSnap.exists) throw new SaveError('NOT_FOUND', 'That run is no longer on the Live sheet');
  const run = runSnap.data();
  const id = 'pu_' + req.requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 18);
  const p = { pickupId: id, date: req.date, routeId: run.routeId || '', runId: run.runId || '', route: run.route || '', run: run.run || '', runDocId: req.runDocId, day: req.day,
    item: req.item, quantity: String(req.quantity), location: '', notes: req.notes, status: 'PENDING', createdAt: stamp, createdBy: email, completedAt: '', completedBy: '',
    createdInApp: true, testEdited: true, editedAt: stamp };
  tx.set(db.collection('pickups').doc(id), p);
  const result = { ok: true, requestId: req.requestId, pickupId: id };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, runDocId: req.runDocId, day: req.day, after: p, result });
  return result;
}

module.exports = { PLANT_ROLES, AREAS, areaOf, JOURNAL_TYPES, PICKUP_HEADERS, PLANT_LISTS, parseJournal, parsePickups, parseQueueTab, readPlant,
  validateLoad, loadValues, validatePickup, savePickup };
