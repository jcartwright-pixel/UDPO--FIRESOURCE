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
const R = require('./plant-rules');
const { queueMaster } = require('./masterwrite');
const M = require('./model');

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

// PLANT_OPERATIONS_MASTER (the Plant Operations workbook): the production lines (PRODUCTION_AREA) and the temperature
// check locations (TEMPERATURE_CHECK_LOCATION), with their settings (days_json), as udpoV734ProductionAreas_ reads them.
function parseSetup(values) {
  const t = table(values, 'operation_id'), docs = {};
  if (!t.index) return docs;
  t.rows.forEach((row, i) => {
    const c = cellsOf(row, t.index), id = c.operation_id;
    if (!id) return;
    let settings = {};
    try { settings = JSON.parse(c.days_json || '{}') || {}; } catch (e) { settings = {}; }
    docs[docId(id)] = { operationId: id, type: text(c.operation_type).toUpperCase(), name: c.display_name || c.production_area || id, status: text(c.status).toUpperCase(),
      area: c.production_area || '', facilityId: c.facility_id || '', viewSequence: Number(c.view_sequence) || 0, settings, sheetRow: t.start + i, cells: c };
  });
  return docs;
}
// PLANT LINE STATUS (the Live workbook): each production line's last recorded check (udpoProductionLineRecords_).
function parseLineStatus(values) {
  const t = table(values, 'record_key'), docs = {};
  if (!t.index) return docs;
  t.rows.forEach((row, i) => {
    const c = cellsOf(row, t.index), id = c.record_key;
    if (!id) return;
    let payload = {};
    try { payload = JSON.parse(c.payload_json || '{}') || {}; } catch (e) { payload = {}; }
    docs[docId(id)] = { operationId: id, area: c.area || '', status: text(c.status).toUpperCase(), temperature: c.temperature || '', notes: c.notes || '', payload,
      updatedAt: c.updated_at || '', updatedBy: c.updated_by || '', sheetRow: t.start + i, cells: c };
  });
  return docs;
}

const PLANT_LISTS = Object.freeze({
  plantJournal: { collection: 'plantJournal', where: 'live', tab: 'PLANT_OPERATIONS', parse: parseJournal },
  plantWash: { collection: 'plantWash', where: 'live', tab: 'WASH / CLEANING LIVE', parse: (v) => parseQueueTab(v, 'WASH') },
  plantReturns: { collection: 'plantReturns', where: 'live', tab: 'REFUSALS / RETURNS LIVE', parse: (v) => parseQueueTab(v, 'RETURN') },
  pickups: { collection: 'pickups', where: 'pickups', tab: 'LIVE PLANT OPERATIONS', parse: parsePickups }
});
// The production lines and temperature locations (the Plant Operations workbook, beside the pickups) and the lines' last
// checks (the Live workbook), read the same way as the lists above.
const SETUP_LISTS = Object.freeze({
  plantSetup: { collection: 'plantSetup', where: 'pickups', ownTab: true, tab: 'PLANT_OPERATIONS_MASTER', parse: parseSetup },
  plantLineStatus: { collection: 'plantLineStatus', where: 'live', tab: 'PLANT LINE STATUS', parse: parseLineStatus }
});

/*
 * Reads every plant list that can be read. sources.live = the Live workbook (or its copy), read for the plant when
 * sources.live.plant is set; sources.plant.pickups =
 * {spreadsheetId, tab} of the Plant Operations workbook (or its copy). Returns {lists: {name: docs}, skipped: [why]}.
 */
async function readPlant(reader, sources, specs) {
  const lists = {}, skipped = [], all = specs || PLANT_LISTS;
  for (const name of Object.keys(all)) {
    const spec = all[name];
    // The Live workbook's plant tabs are read where the setup says so (live.plant, like live.maintenanceQueues).
    const named = spec.where === 'live' ? (sources.live && sources.live.plant ? sources.live : null) : sources.plant && sources.plant[spec.where];
    const at = named && named.spreadsheetId, tab = spec.where === 'live' || spec.ownTab ? spec.tab : (named && named.tab) || spec.tab;
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

/* ---------- unloading, product returns and washing ---------- */

// saveUnloading: Start, End, the quantity in, the trailer back, notes, and RTA (returns put back in the cooler).
function validateUnload(input, SaveError) {
  const out = { date: text(input.date), route: text(input.route).slice(0, 60), run: text(input.run).slice(0, 120), runDocId: text(input.runDocId).slice(0, 200), day: text(input.day).slice(0, 10) };
  if (!L.isDateKey(out.date)) throw new SaveError('BAD_REQUEST', 'date must be yyyy-mm-dd');
  if (!out.route || !out.run) throw new SaveError('BAD_REQUEST', 'Pick the load');
  if (out.day && L.DAYS.indexOf(out.day) < 0) throw new SaveError('BAD_REQUEST', 'day must be sun to sat');
  const f = input.fields || {}, u = {};
  if (f.start === true) u.start = true;
  if (f.end === true) u.end = true;
  if (u.start && u.end) throw new SaveError('BAD_REQUEST', 'Start and End are two presses');
  if (f.casesIn !== undefined) {
    const t = text(f.casesIn).replace(/,/g, '');
    if (t !== '' && (!/^\d+$/.test(t) || Number(t) > 999999)) throw new SaveError('BAD_REQUEST', 'Enter a whole quantity, including zero if none.');
    u.casesIn = t === '' ? '' : String(Number(t));
  }
  if (f.trailer !== undefined) u.trailer = R.trailerText(f.trailer).slice(0, 60);
  if (f.notes !== undefined) u.notes = text(f.notes).slice(0, 1200);
  if (f.returnIds !== undefined) {
    if (!Array.isArray(f.returnIds) || f.returnIds.length > 30) throw new SaveError('BAD_REQUEST', 'returnIds must be a list');
    u.returnIds = f.returnIds.map(x => text(x).slice(0, 300)).filter(Boolean);
    if (!u.returnIds.length) throw new SaveError('BAD_REQUEST', 'Pick the return');
  }
  if (!Object.keys(u).length) throw new SaveError('BAD_REQUEST', 'Nothing to save');
  out.unload = u;
  return out;
}

const appUnloadId = (key) => docId('UNLOADING_app_' + key);
// A driver check-in that reported product back is a return too (the current app's ROUTE_CHECKIN returns).
const checkinReturnId = (runDocId, day) => 'CHECKIN|' + runDocId + '|' + day;

async function saveUnload(tx, db, req, email, stamp, logRef, mode, SaveError, queueSheetCells) {
  const key = R.unloadKey(req.date, req.route, req.run), u = req.unload;
  const dayDocs = (await tx.get(db.collection('plantJournal').where('date', '==', req.date))).docs.map(d => d.data());
  const runRef = req.runDocId ? db.collection('runs').doc(req.runDocId) : null;
  const runSnap = runRef ? await tx.get(runRef) : null;
  // All reads are done; the rest works out the new record and writes it.
  const all = R.latestUnloads(dayDocs, req.date), prev = all[key] || { removed: [], casesIn: '', startedAt: '', completedAt: '', notes: '' };
  const next = { unloadKey: key, route: req.route, run: req.run, casesIn: prev.casesIn === undefined || prev.casesIn === null ? '' : String(prev.casesIn), startedAt: prev.startedAt || '',
    completedAt: prev.completedAt || '', notes: prev.notes || '', productReturnRemovedIds: prev.removed.slice() };
  if (prev.trailer !== undefined) next.trailer = prev.trailer;
  if (u.returnIds) {
    const known = dayDocs.filter(d => String(d.type).toUpperCase() === 'RETURN' && text((d.payload || {}).route || d.route) === req.route && text((d.payload || {}).run || d.run) === req.run).map(d => d.recordId);
    if (req.runDocId && req.day) known.push(checkinReturnId(req.runDocId, req.day));
    if (u.returnIds.some(id => known.indexOf(id) < 0)) throw new SaveError('CONFLICT', 'That product return no longer matches this run. The list was refreshed; try again.');
    u.returnIds.forEach(id => { if (next.productReturnRemovedIds.indexOf(id) < 0) next.productReturnRemovedIds.push(id); });
    next.productReturnRemovedAt = stamp;
  }
  if (u.trailer !== undefined) next.trailer = u.trailer;
  if (u.notes !== undefined) next.notes = u.notes;
  if (u.casesIn !== undefined) next.casesIn = u.casesIn;
  if (u.start && !next.startedAt) {
    // One unload at a time, as on the current app.
    const active = Object.keys(all).filter(k => k !== key && all[k].startedAt && !all[k].completedAt)[0];
    if (active) throw new SaveError('CONFLICT', 'Stop unloading ' + all[active].route + ' · ' + all[active].run + ' before starting another.');
    next.startedAt = stamp;
  }
  if (u.end) {
    if (!next.startedAt) throw new SaveError('BAD_REQUEST', 'Start unloading before ending.');
    if (next.casesIn === '') throw new SaveError('BAD_REQUEST', 'Enter the quantity before ending unloading.');
    next.completedAt = next.completedAt || stamp;
  }
  const status = next.completedAt ? 'COMPLETE' : next.startedAt ? 'UNLOADING' : 'WAITING';
  const run = runSnap && runSnap.exists ? runSnap.data() : null;
  const doc = { recordId: key, type: 'UNLOADING', date: req.date, status, route: req.route, run: req.run, runId: (run && run.runId) || '', runDocId: req.runDocId || '', day: req.day || '',
    trailer: next.trailer || '', quantity: next.casesIn, startedAt: next.startedAt, completedAt: next.completedAt, notes: next.notes, area: '', payload: next,
    recordedAt: stamp, recordedBy: email, createdInApp: true, testEdited: true, editedAt: stamp };
  tx.set(db.collection('plantJournal').doc(appUnloadId(key)), doc);
  const result = { ok: true, requestId: req.requestId, status, runs: [] };
  // The quantity in also goes on the Live week as the plant's case return, as the current app writes it.
  const day = run && run.days && req.day ? run.days[req.day] : null;
  if (u.casesIn !== undefined && day) {
    const v = next.casesIn === '' ? null : Number(next.casesIn);
    if ((day.plantCaseReturn === undefined ? null : day.plantCaseReturn) !== v) {
      tx.update(runRef, { ['days.' + req.day + '.plantCaseReturn']: v, rev: (run.rev || 0) + 1, testEdited: true, editedAt: stamp });
      if (mode.writeBack) queueSheetCells(tx, db, req.requestId, 'u', run, req.runDocId, req.day, { plantCaseReturn: v }, stamp, email);
      result.runs.push({ runDocId: req.runDocId, rev: (run.rev || 0) + 1 });
    }
  }
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, unloadKey: key, before: prev.key ? { status: prev.status, casesIn: prev.casesIn, trailer: prev.trailer || '' } : null, after: { status, casesIn: next.casesIn, trailer: next.trailer || '', returns: u.returnIds || [] }, result });
  return result;
}

// completeWash: a trailer was washed. Closes the wash requests picked for it (the sheet's and the app's) and records the
// wash, which also clears the "wash after unloading" for that trailer. addWash ("+ Add Wash") is the same press for a
// trailer typed in by hand.
const WASH_LISTS = ['plantWash', 'maintenance'];
function validateWash(input, SaveError) {
  const out = { date: text(input.date), trailer: R.trailerText(input.trailer).slice(0, 60), close: [] };
  if (!L.isDateKey(out.date)) throw new SaveError('BAD_REQUEST', 'date must be yyyy-mm-dd');
  if (!out.trailer) throw new SaveError('BAD_REQUEST', 'Enter the trailer number.');
  const close = input.close === undefined ? [] : input.close;
  if (!Array.isArray(close) || close.length > 20) throw new SaveError('BAD_REQUEST', 'close must be a list');
  close.forEach(c => {
    const list = text(c && c.list), id = text(c && c.id).slice(0, 200);
    if (WASH_LISTS.indexOf(list) < 0 || !id) throw new SaveError('BAD_REQUEST', 'Pick the wash request');
    out.close.push({ list, id });
  });
  return out;
}

async function saveWash(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const refs = req.close.map(c => db.collection(c.list).doc(c.id));
  const snaps = refs.length ? await tx.getAll(...refs) : [];
  const unit = R.unitKey(req.trailer), closed = [];
  const change = { status: 'COMPLETE', wash_status: 'CLEANED', completed_at: stamp, completed_by: email, resolution: 'CLEANED', updated_at: stamp, updated_by: email };
  snaps.forEach((s, i) => {
    if (!s.exists) return;
    const r = s.data();
    if (R.unitKey(r.unit_number) !== unit) throw new SaveError('BAD_REQUEST', 'That wash request is for trailer ' + (r.unit_number || '(none)'));
    if (!R.washOpen(r.status)) return;
    tx.update(refs[i], Object.assign({}, change, { testEdited: true, editedAt: stamp, editedBy: email }));
    // With the write-back on, the sandbox Live workbook's WASH / CLEANING LIVE row is marked done too.
    queueMaster(tx, db, mode, req.requestId, 'w' + i, refs[i], r.record_id, r.createdInApp ? Object.assign({}, r, change) : change, !!r.createdInApp, stamp, email, MAINT.LISTS.WASH);
    closed.push(r.record_id);
  });
  const id = 'WASHING_app_' + req.requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  const payload = { trailer: req.trailer, status: 'COMPLETE', completedAt: stamp, completedBy: email, closed };
  tx.set(db.collection('plantJournal').doc(id), { recordId: 'WASH|' + req.date + '|' + req.trailer, type: 'WASHING', date: req.date, status: 'COMPLETE', trailer: req.trailer, completedAt: stamp,
    payload, recordedAt: stamp, recordedBy: email, createdInApp: true, testEdited: true, editedAt: stamp });
  const result = { ok: true, requestId: req.requestId, trailer: req.trailer, closed, runs: [] };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, trailer: req.trailer, after: payload, result });
  return result;
}

/* ---------- the Plant Operations Scheduler ---------- */

// savePlantSchedule: Save Load (add or edit), Delete Load, and New Supplier on Receiving, as the current app's
// desktopUiSavePlantScheduleV778. The loads stay in the new app (plantJournal); Shipping's Plant Route loads also go on
// plantLoads, which Weekly Dispatch reads to show a load that needs a driver.
const appScheduleId = (type, id) => docId(type + '_app_' + id);
function validateSchedule(input, SaveError) {
  const out = { lane: R.lane(input.lane), op: text(input.op) || 'save' };
  if (['save', 'remove', 'addSupplier'].indexOf(out.op) < 0) throw new SaveError('BAD_REQUEST', 'op must be save, remove or addSupplier');
  if (out.op === 'addSupplier') {
    if (out.lane !== 'RECEIVING') throw new SaveError('BAD_REQUEST', 'Suppliers are on Receiving');
    out.name = text(input.name).replace(/\s+/g, ' ').toUpperCase();
    out.label = text(input.label).replace(/\s+/g, ' ').slice(0, 40);
    out.code = text(input.code).toUpperCase();
    if (!out.name) throw new SaveError('BAD_REQUEST', 'Type the supplier name.');
    if (out.name.length > 60) throw new SaveError('BAD_REQUEST', 'The supplier name can be up to 60 letters.');
    if (out.code && !/^[A-Z0-9_-]{1,8}$/.test(out.code)) throw new SaveError('BAD_REQUEST', 'The code can be up to 8 letters or numbers.');
    return out;
  }
  out.id = text(input.id).slice(0, 120);
  out.date = text(input.date);
  if (!L.isDateKey(out.date)) throw new SaveError('BAD_REQUEST', 'Pick the delivery date.');
  if (out.op === 'remove') {
    if (!out.id) throw new SaveError('BAD_REQUEST', 'Pick the load to delete');
    return out;
  }
  const f = input.fields || {};
  out.routeId = text(f.routeId).slice(0, 120); out.runId = text(f.runId).slice(0, 120);
  out.route = text(f.route).slice(0, 60); out.run = text(f.run).slice(0, 120);
  if (!out.route || !out.routeId || !out.runId) throw new SaveError('BAD_REQUEST', out.lane === 'RECEIVING' ? 'Pick the supplier.' : 'Pick the route / run.');
  out.pickupTime = R.time24(f.pickupTime);
  if (!out.pickupTime) throw new SaveError('BAD_REQUEST', 'Enter the pickup time.');
  out.scheduleType = text(f.scheduleType || 'ROUTE').toUpperCase();
  if (['ROUTE', 'CARRIER'].indexOf(out.scheduleType) < 0) throw new SaveError('BAD_REQUEST', 'Schedule Type must be Plant Route or Carrier');
  out.poNumber = text(f.poNumber).slice(0, 40);
  if (out.scheduleType === 'CARRIER' && !out.poNumber) throw new SaveError('BAD_REQUEST', 'A carrier load needs its PO number.');
  out.cases = text(f.cases);
  if (out.cases && !/^[0-9]{1,6}$/.test(out.cases)) throw new SaveError('BAD_REQUEST', 'Cases must be a whole number.');
  out.product = text(f.product).slice(0, 80);
  out.notes = text(f.notes).slice(0, 1200);
  out.loadDate = text(f.loadDate);
  if (out.loadDate && !L.isDateKey(out.loadDate)) throw new SaveError('BAD_REQUEST', 'The load date must be a date.');
  if (out.loadDate && out.loadDate > out.date) throw new SaveError('BAD_REQUEST', 'The load date cannot be after the delivery date.');
  out.trailer = text(f.trailer).toUpperCase();
  if (out.trailer.length > 24 || /[^A-Z0-9 _\-/.#]/.test(out.trailer)) throw new SaveError('BAD_REQUEST', 'Check the trailer number.');
  return out;
}

async function saveSchedule(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const type = R.LOAD_TYPE[req.lane], journal = db.collection('plantJournal');
  if (req.op === 'addSupplier') {
    const docs = (await tx.get(journal.where('type', '==', R.SUPPLIER_TYPE))).docs.map(d => d.data());
    const list = R.scheduleSuppliers(docs);
    if (list.some(x => x.run.toUpperCase() === req.name)) throw new SaveError('CONFLICT', req.name + ' is already on the list.');
    let code = req.code;
    if (!code) { let n = list.length + 1; do { code = 'S' + String(n).padStart(2, '0'); n++; } while (list.some(x => x.route === code)); }
    else if (list.some(x => x.route === code)) throw new SaveError('CONFLICT', 'Code ' + code + ' is already used.');
    const id = 'SUP-' + req.requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
    const sup = { recordId: id, type: R.SUPPLIER_TYPE, date: L.operatingDay(new Date(stamp)), status: 'ACTIVE', routeId: id, runId: id, route: code, run: req.name, notes: req.label || req.name,
      area: 'RECEIVING', payload: {}, createdAt: stamp, recordedAt: stamp, recordedBy: email, createdInApp: true, testEdited: true, editedAt: stamp };
    tx.set(journal.doc(appScheduleId(R.SUPPLIER_TYPE, id)), sup);
    const result = { ok: true, requestId: req.requestId, supplier: { routeId: id, runId: id, route: code, run: req.name, name: sup.notes } };
    tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, lane: req.lane, after: result.supplier, result });
    return result;
  }
  // Reads: the record now (an edit or delete), the customer or supplier list, and the trailers when one was typed.
  const had = req.id ? R.newestRecords((await tx.get(journal.where('recordId', '==', req.id))).docs.map(d => d.data()), [type])[req.id] : null;
  if (req.id && (!had || (had.type !== type))) throw new SaveError('NOT_FOUND', 'That load is no longer on the ' + (req.lane === 'RECEIVING' ? 'Receiving' : 'Shipping') + ' schedule.');
  let choices = [], equipment = [];
  if (req.op === 'save') {
    if (req.lane === 'RECEIVING') choices = R.scheduleSuppliers((await tx.get(journal.where('type', '==', R.SUPPLIER_TYPE))).docs.map(d => d.data()));
    else choices = R.scheduleCustomers((await tx.get(db.collection('routes'))).docs.map(d => Object.assign({ runId: d.id }, d.data())));
    if (req.trailer) equipment = (await tx.get(db.collection('equipment'))).docs.map(d => Object.assign({ id: d.id }, d.data()));
  }
  // All reads are done.
  const id = req.id || ('SCHED-' + req.requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 24));
  const before = had ? R.scheduleEntries([had], req.lane)[0] || null : null;
  let rec;
  if (req.op === 'remove') {
    rec = Object.assign({}, had, { status: 'DELETED', date: had.date || req.date });
  } else {
    const pick = choices.filter(r => r.routeId === req.routeId && r.runId === req.runId);
    if (pick.length !== 1) throw new SaveError('CONFLICT', (req.lane === 'RECEIVING' ? 'That supplier' : 'That route / run') + ' is no longer on the list. The list was refreshed; pick again.');
    if (pick[0].route !== req.route || pick[0].run !== req.run) throw new SaveError('CONFLICT', 'Route Master changed that run. The list was refreshed; pick again.');
    let trailer = req.trailer;
    if (trailer) { const u = MAINT.resolveUnit(trailer, 'TRAILER', equipment); trailer = !u.resolved && /^\d+$/.test(u.unit) ? 'T-' + u.unit : u.unit; }
    const payload = { pickupTime: req.pickupTime, loadDate: req.loadDate, trailer, scheduleType: req.scheduleType, carrier: req.scheduleType === 'CARRIER', poNumber: req.poNumber,
      cases: req.cases, product: req.product, notes: req.notes };
    rec = { recordId: id, type, date: req.date, status: 'SCHEDULED', routeId: req.routeId, runId: req.runId, route: req.route, run: req.run, trailer, notes: req.notes,
      area: req.lane === 'RECEIVING' ? 'RECEIVING' : 'SCHEDULER', payload, facilityId: (had && had.facilityId) || 'fac_uniontown' };
  }
  delete rec.sheetRow; delete rec.cells;
  Object.assign(rec, { recordedAt: stamp, recordedBy: email, createdInApp: true, testEdited: true, editedAt: stamp });
  tx.set(journal.doc(appScheduleId(type, id)), rec);
  // Weekly Dispatch shows a Shipping Plant Route load (not a carrier's) as needing a driver (transfer.js plantLoads).
  if (req.lane === 'SHIPPING') {
    const ref = db.collection(M.COLLECTIONS.plantLoads).doc(M.safeIdPart(id)), p = rec.payload || {};
    if (rec.status === 'DELETED' || p.scheduleType === 'CARRIER' || p.carrier === true || !rec.runId) tx.delete(ref);
    else tx.set(ref, { runId: rec.runId, route: rec.route, run: rec.run, date: rec.date, status: 'SCHEDULED', pickupTime: p.pickupTime || '', loadDate: p.loadDate || '', trailer: p.trailer || '',
      poNumber: p.poNumber || '', cases: p.cases || '', product: p.product || '', notes: p.notes || '', facilityId: rec.facilityId || '', createdInApp: true, testEdited: true, editedAt: stamp });
  }
  const after = req.op === 'remove' ? null : R.scheduleEntries([rec], req.lane)[0];
  const result = { ok: true, requestId: req.requestId, id, status: rec.status, date: rec.date };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, lane: req.lane, op: req.op, scheduleId: id, before, after, result });
  return result;
}

/* ---------- Yard Checks ---------- */

// saveYardCheck: Record (temperature, fuel, notes) or Left Yard for a loaded trailer, as desktopUiSavePlantYardCheckV5063.
// A trailer checked less than 2 hours ago that operating day is refused; Left Yard is always taken.
function validateYard(input, SaveError) {
  const out = { date: text(input.date), trailer: R.yardTrailer(input.trailer).slice(0, 30), departed: input.departed === true, routeRun: text(input.routeRun).slice(0, 120) };
  if (!L.isDateKey(out.date)) throw new SaveError('BAD_REQUEST', 'date must be yyyy-mm-dd');
  if (!out.trailer) throw new SaveError('BAD_REQUEST', 'Trailer is required.');
  out.temperature = text(input.temperature).slice(0, 30);
  out.setPoint = text(input.setPoint).slice(0, 30);
  out.fuelLevel = text(input.fuelLevel).toUpperCase();
  if (out.fuelLevel && R.FUEL_LEVELS.indexOf(out.fuelLevel) < 0) throw new SaveError('BAD_REQUEST', 'Fuel level must be Full, 3/4, 1/2, or Empty.');
  out.notes = text(input.notes).slice(0, 800);
  // The phone saves each box as it is left: the first save is the check, later ones fill in the same check.
  out.checkId = text(input.checkId).slice(0, 150);
  if (out.checkId && !/^YARD_CHECK_app_[A-Za-z0-9]+$/.test(out.checkId)) throw new SaveError('BAD_REQUEST', 'checkId is not a yard check');
  return out;
}

async function saveYard(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const journal = db.collection('plantJournal');
  if (req.checkId && !req.departed) {
    const ref = journal.doc(req.checkId), had = await tx.get(ref), d = had.exists ? had.data() : null, p = (d && d.payload) || {};
    if (!d || d.type !== 'YARD_CHECK' || p.status !== 'COMPLETE' || R.yardTrailer(p.trailer) !== req.trailer) throw new SaveError('NOT_FOUND', 'That yard check is no longer open. Record the trailer again.');
    if (Date.parse(stamp) - R.when(d.recordedAt) >= R.YARD_LOCK_MINUTES * 60000) throw new SaveError('CONFLICT', 'That yard check is more than 2 hours old. Record the trailer again.');
    const payload = Object.assign({}, p, { temperature: req.temperature, setPoint: req.setPoint || p.setPoint || '', fuelLevel: req.fuelLevel, notes: req.notes });
    tx.update(ref, { payload, temperature: req.temperature, notes: req.notes, editedAt: stamp, editedBy: email, testEdited: true });
    const result = { ok: true, requestId: req.requestId, trailer: req.trailer, status: 'COMPLETE', checkId: req.checkId, recordedAt: d.recordedAt, message: 'Yard check updated.' };
    tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, trailer: req.trailer, checkId: req.checkId, before: p, after: payload, result });
    return result;
  }
  if (!req.departed) {
    const same = (await tx.get(journal.where('date', '==', req.date))).docs.map(d => d.data());
    const left = R.yardLockLeft(same, req.date, req.trailer, Date.parse(stamp));
    if (left) throw new SaveError('CONFLICT', 'Trailer ' + req.trailer + ' was already checked. It can be checked again in ' + left + ' minutes.');
  }
  const id = 'YARD_CHECK_app_' + req.requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  const payload = req.departed ? { route: req.routeRun, run: req.routeRun, trailer: req.trailer, notes: 'Left the yard', status: 'DEPARTED' }
    : { route: req.routeRun, run: req.routeRun, trailer: req.trailer, temperature: req.temperature, setPoint: req.setPoint, fuelLevel: req.fuelLevel, notes: req.notes, status: 'COMPLETE' };
  tx.set(journal.doc(id), { recordId: 'YARD-' + req.requestId.slice(0, 40), type: 'YARD_CHECK', date: req.date, status: payload.status, route: req.routeRun, run: req.routeRun, trailer: req.trailer,
    temperature: payload.temperature || '', notes: payload.notes, payload, recordedAt: stamp, recordedBy: email, createdInApp: true, testEdited: true, editedAt: stamp });
  const result = { ok: true, requestId: req.requestId, trailer: req.trailer, status: payload.status, recordedAt: stamp, checkId: id,
    message: req.departed ? 'Trailer ' + req.trailer + ' marked as left the yard.' : 'Yard check recorded. Trailer is locked for 2 hours.' };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, trailer: req.trailer, after: payload, result });
  return result;
}

/* ---------- Production Line Status & Quality ---------- */

// saveQualityCheck: Record Quality Check for one production line, as desktopUiSavePlantProductionQualityGuardedV748_.
// The check stays in the new app (plantJournal PRODUCTION_QUALITY); it is the line's status now and goes on the history.
function validateQuality(input, SaveError) {
  const out = { operationId: text(input.operationId).slice(0, 120) };
  if (!out.operationId) throw new SaveError('BAD_REQUEST', 'Production area is not configured for this plant.');
  out.status = text(input.status).toUpperCase();
  if (out.status && R.LINE_STATUSES.indexOf(out.status) < 0) throw new SaveError('BAD_REQUEST', 'Status must be Running, Review, Changeover, Down, or Finished.');
  out.product = text(input.product).slice(0, 120);
  out.remainingOutput = text(input.remainingOutput).slice(0, 80);
  out.qualityCheck = text(input.qualityCheck).toUpperCase().slice(0, 40);
  out.tipTest = text(input.tipTest).toUpperCase().slice(0, 40);
  ['temperature', 'cycleTime', 'productSize', 'annealerSpeed'].forEach(k => { out[k] = text(input[k]).slice(0, 80); });
  out.notes = text(input.notes).slice(0, 1000);
  const w = input.weights && typeof input.weights === 'object' && !Array.isArray(input.weights) ? input.weights : {};
  out.weights = {};
  Object.keys(w).forEach(k => { if (/^(result|head[1-6])$/.test(k)) out.weights[k] = text(w[k]).slice(0, 80); });
  return out;
}

async function saveQuality(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const line = await tx.get(db.collection('plantSetup').doc(docId(req.operationId)));
  const d = line.exists ? line.data() : null;
  if (!d || d.type !== 'PRODUCTION_AREA' || d.status !== 'ACTIVE') throw new SaveError('NOT_FOUND', 'Production area is not configured for this plant.');
  const record = { operationId: req.operationId, area: d.name, product: req.product, status: req.status, remainingOutput: req.remainingOutput, qualityCheck: req.qualityCheck,
    tipTest: req.tipTest, temperature: req.temperature, cycleTime: req.cycleTime, productSize: req.productSize, annealerSpeed: req.annealerSpeed, weights: req.weights, notes: req.notes,
    facilityId: d.facilityId || 'fac_uniontown' };
  const id = 'PRODUCTION_QUALITY_app_' + req.requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  tx.set(db.collection('plantJournal').doc(id), { recordId: 'PQ-' + req.requestId.slice(0, 40), type: R.QUALITY_TYPE, date: L.operatingDay(new Date(stamp)), status: req.status, area: d.name,
    temperature: req.temperature, notes: req.notes, payload: record, recordedAt: stamp, recordedBy: email, createdInApp: true, testEdited: true, editedAt: stamp });
  const result = { ok: true, requestId: req.requestId, operationId: req.operationId, recordedAt: stamp, message: d.name + ' production status updated; quality observation recorded.' };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, operationId: req.operationId, after: record, result });
  return result;
}

/* ---------- Shift Notes (Incident & Breakdown Log) ---------- */

// saveShiftNote: a timestamped entry or a review note under one, as desktopUiSavePlantShiftReportV5008 (section handoff).
function validateShiftNote(input, SaveError) {
  const v = input.values && typeof input.values === 'object' ? input.values : {};
  const out = { parentId: text(v.ParentId).slice(0, 80), entry: text(v.Entry).slice(0, 4000), notes: text(input.notes).slice(0, 1500), readingTime: text(input.readingTime).slice(0, 20) };
  out.type = out.parentId ? 'REVIEW' : text(v.Type).slice(0, 40) || 'Handoff';
  if (!out.parentId && R.ENTRY_TYPES.indexOf(out.type) < 0) throw new SaveError('BAD_REQUEST', 'Type must be Breakdown, Incident, Safety, Quality, Handoff or Other.');
  out.equipment = out.parentId ? '' : text(v.Equipment).slice(0, 80);
  out.shift = text(input.shift).toUpperCase();
  if (out.shift && R.SHIFTS.indexOf(out.shift) < 0) throw new SaveError('BAD_REQUEST', 'Shift could not be determined.');
  out.followUpStatus = text(input.followUpStatus).toUpperCase() || 'OPEN';
  if (R.FOLLOW_UPS.indexOf(out.followUpStatus) < 0) throw new SaveError('BAD_REQUEST', 'Follow-up must be Open, Monitor or Resolved.');
  if (out.parentId && !out.entry) throw new SaveError('BAD_REQUEST', 'Enter the review note before adding it.');
  if (!out.parentId && !out.entry && !out.notes) throw new SaveError('BAD_REQUEST', 'Enter report information before saving.');
  if (out.parentId) out.entry = out.entry.slice(0, 500);
  return out;
}

async function saveShiftNote(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const journal = db.collection('plantJournal');
  if (req.parentId) {
    const parent = (await tx.get(journal.where('recordId', '==', req.parentId))).docs.map(d => d.data()).filter(d => d.type === R.SHIFT_TYPE);
    if (!parent.length) throw new SaveError('NOT_FOUND', 'That entry is no longer on the log.');
  }
  const now = new Date(stamp), entryId = 'SHIFT-' + req.requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 30);
  const shift = req.shift || R.shiftAt(now.getTime());
  const values = req.parentId ? { Entry: req.entry, Type: 'REVIEW', ParentId: req.parentId } : { Entry: req.entry, Type: req.type, Equipment: req.equipment };
  const payload = { entryId, date: L.operatingDay(now), shift, section: 'HANDOFF', readingTime: req.readingTime, values, notes: req.notes, followUpStatus: req.followUpStatus };
  tx.set(journal.doc(R.SHIFT_TYPE + '_app_' + entryId.replace(/[^A-Za-z0-9]/g, '')), { recordId: entryId, type: R.SHIFT_TYPE, date: payload.date, status: req.followUpStatus, shift, area: 'HANDOFF',
    notes: req.notes, payload, recordedAt: stamp, recordedBy: email, createdInApp: true, testEdited: true, editedAt: stamp });
  const result = { ok: true, requestId: req.requestId, entryId, shift, recordedAt: stamp, message: req.parentId ? 'Review note added.' : 'Shift entry saved.' };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, entryId, after: payload, result });
  return result;
}

/* ---------- Cooler Temperatures ---------- */

// saveTemperatureCheck: a manual reading for one location, as desktopUiSavePlantTemperatureCheckCurrentRoutedV787_.
function validateTemperature(input, SaveError) {
  const out = { locationId: text(input.locationId).slice(0, 120), notes: text(input.notes).slice(0, 800) };
  if (!out.locationId) throw new SaveError('BAD_REQUEST', 'Temperature location is not configured for this plant.');
  const manual = text(input.manualTemperature);
  if (manual === '' || !isFinite(Number(manual))) throw new SaveError('BAD_REQUEST', 'Enter a valid manual temperature before saving.');
  out.manualTemperature = Number(manual);
  return out;
}

async function saveTemperature(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const got = await tx.get(db.collection('plantSetup').doc(docId(req.locationId)));
  const d = got.exists ? got.data() : null;
  if (!d || d.type !== 'TEMPERATURE_CHECK_LOCATION' || d.status !== 'ACTIVE') throw new SaveError('NOT_FOUND', 'Temperature location is not configured for this plant.');
  const loc = R.tempLocations([d])[0], now = new Date(stamp), day = L.operatingDay(now);
  const recent = (await tx.get(db.collection('plantJournal').where('date', 'in', [L.addDays(day, -1), day]))).docs.map(x => x.data());
  const left = R.tempLockLeft(recent, loc, now.getTime());
  if (left) throw new SaveError('CONFLICT', loc.location + ' was already checked. It can be checked again in ' + left + ' minutes.');
  const status = R.tempStatus(loc, req.manualTemperature);
  const payload = { locationId: loc.locationId, location: loc.location, manualTemperature: req.manualTemperature, notes: req.notes, status, sensorId: loc.sensorId, sensorTemperature: '', batteryLevel: '', source: 'PLANT TEMPERATURE MANUAL CHECK' };
  const id = R.TEMP_TYPE + '_app_' + req.requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  tx.set(db.collection('plantJournal').doc(id), { recordId: 'TEMP-' + req.requestId.slice(0, 40), type: R.TEMP_TYPE, date: day, status, area: loc.location, temperature: String(req.manualTemperature),
    notes: req.notes, payload, recordedAt: stamp, recordedBy: email, createdInApp: true, testEdited: true, editedAt: stamp });
  const result = { ok: true, requestId: req.requestId, recordId: 'TEMP-' + req.requestId.slice(0, 40), locationId: loc.locationId, status, recordedAt: stamp, message: loc.location + ' temperature recorded. This location is locked for 2 hours.' };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, locationId: loc.locationId, after: payload, result });
  return result;
}

/* ---------- Send Current Report ---------- */

// sendPlantReport: keeps the report as it was sent (subject, text, note, and the report itself for the email's layout).
// With email set up (MAIL_FROM) it is SENDING and reportmail.js emails it straight after the save; without, it is HELD.
// The current app's Send Current Report emails the Plant Managers group through its outbound email policy.
function validateReport(input, SaveError) {
  const out = { subject: text(input.subject).slice(0, 200), body: text(input.text).slice(0, 20000), note: text(input.note).slice(0, 1500), groupName: text(input.groupName).slice(0, 100) || 'Plant Managers', reportJson: '' };
  if (!out.subject || !out.body) throw new SaveError('BAD_REQUEST', 'The report is still loading. Try again in a moment.');
  if (input.report && typeof input.report === 'object' && !Array.isArray(input.report)) {
    const json = JSON.stringify(input.report);
    if (json.length <= 200000) out.reportJson = json;
  }
  return out;
}

async function sendReport(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const id = 'REPORT_' + req.requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 30);
  const mailOn = !!String(process.env.MAIL_FROM || '').trim();
  const record = { subject: req.subject, text: req.body, note: req.note, groupName: req.groupName, reportJson: req.reportJson, status: mailOn ? 'SENDING' : 'HELD', emailed: false,
    date: L.operatingDay(new Date(stamp)), at: stamp, by: email, mode: mode.mode };
  tx.set(db.collection('plantReports').doc(id), record);
  const result = { ok: true, requestId: req.requestId, reportId: id, sent: false, sending: mailOn, subject: req.subject,
    message: mailOn ? 'Report saved. Sending the email…' : 'Report saved. Email is not set up in the new app yet, so it was not emailed to ' + req.groupName + '.' };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, reportId: id, result });
  return result;
}

module.exports = { validateReport, sendReport, validateTemperature, saveTemperature, validateShiftNote, saveShiftNote, validateQuality, saveQuality, parseSetup, parseLineStatus, validateYard, saveYard, PLANT_ROLES, AREAS, areaOf, JOURNAL_TYPES, PICKUP_HEADERS, PLANT_LISTS, SETUP_LISTS, parseJournal, parsePickups, parseQueueTab, readPlant,
  validateLoad, loadValues, validatePickup, savePickup, validateUnload, saveUnload, validateWash, saveWash, checkinReturnId, appUnloadId,
  validateSchedule, saveSchedule, appScheduleId };
