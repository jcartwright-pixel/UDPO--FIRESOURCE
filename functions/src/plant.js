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
const B = require('./board-rules');
const WJ = require('./weightjoin');

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
// PAUSED (the current app's Plant Station Pause, MobilePlant.html saveLoad): needs a reason, which goes on the load's notes.
const STATUSES = ['NOT_STARTED', 'LOADING', 'PAUSED', 'COMPLETE'];
function validateLoad(input, SaveError) {
  const f = input.fields || {}, out = {};
  if (f.status !== undefined) { out.status = text(f.status).toUpperCase(); if (STATUSES.indexOf(out.status) < 0) throw new SaveError('BAD_REQUEST', 'Status must be Waiting, Loading, Paused or Done'); }
  if (out.status === 'PAUSED') { out.pauseReason = text(f.pauseReason).slice(0, 300); if (!out.pauseReason) throw new SaveError('BAD_REQUEST', 'A pause reason is required.'); }
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
  // Trailer Assignments (the current app's Mobile Plant "trailers" view): only the trailer, one unit, never a down one.
  if (input.assign === true) {
    if (Object.keys(out).join() !== 'trailer') throw new SaveError('BAD_REQUEST', 'A trailer assignment changes only the trailer');
    if (out.trailer && !/^[A-Z0-9-]{1,20}$/.test(out.trailer)) throw new SaveError('BAD_REQUEST', 'Enter one trailer number: letters, numbers and dashes only.');
    out.assign = true;
  }
  // The Loadout Center asks to load past the limit; only a manager's save gets it (loadValues).
  if (input.overLimit === true && !out.assign) out.overLimit = true;
  // Loading Rundown (Joe 10/15): a Plant Station tablet signed in with a UD account names its station, so its times show as the tablet's.
  if (input.station !== undefined && text(input.station)) out.station = text(input.station).replace(/[^A-Za-z0-9 /&-]/g, '').slice(0, 40);
  return out;
}

// Joe 10/12: how many loads one loadout may load at the same time. A paused load does not count; starting or resuming one
// past the limit is refused, so two tablets cannot get around it. Joe 10/13: a manager on the Loadout Center may go past it.
const LOADING_LIMIT = Object.freeze({ CASE: 2, BOXING: 3 });
// Joe 10/19 (800 Specials): the day's own load type (Daily Dispatch > Edit) wins for that day.
// A Route Editor change to None reaches the week's days as NONE: not loaded at the plant that day.
const runAreaOf = (run, prefix) => {
  const dayType = text(prefix && run && run.days && run.days[prefix] && run.days[prefix].loadType).toUpperCase();
  if (dayType === 'NONE') return '';
  return areaOf(dayType) || areaOf(text(run && run.loadType) || (run && run.masterShow && run.masterShow.loadType) || '');
};
// A day block is loading now: started (or marked Loading), not paused, not done.
function dayLoadingNow(day) {
  const s = text(day && day.loadStatus).toUpperCase();
  if (!day || day.completeTime || day.loadedComplete === true || ['COMPLETE', 'COMPLETED', 'LOADED', 'READY', 'PAUSED'].indexOf(s) >= 0) return false;
  return !!day.plantStartedAt || s === 'LOADING';
}
// The loads of an area loading now (today's and yesterday's still open; the Scheduler's shipments on Boxing), leaving out
// the one being saved (except = runDocId|day, or a Scheduler record ID).
async function loadingNow(tx, db, area, stamp, except) {
  const today = L.operatingDay(new Date(stamp)), dates = [today, L.addDays(today, -1)];
  const weeks = [...new Set(dates.flatMap(d => L.weeksForLoadDate(d)))];
  const runs = (await tx.get(db.collection('runs').where('weekStart', 'in', weeks))).docs.map(d => Object.assign({}, d.data(), { id: d.id }));
  let n = 0;
  runs.forEach(run => {
    if (text(run.routeStatus || 'ACTIVE').toUpperCase() !== 'ACTIVE' || run.active === false) return;
    dates.forEach(d => L.loadBlocksFor(run, d).forEach(b => { if (runAreaOf(run, b.prefix) === area && run.id + '|' + b.prefix !== except && dayLoadingNow(run.days[b.prefix])) n++; }));
  });
  if (area === 'BOXING') {
    const ships = R.scheduleEntries((await tx.get(db.collection('plantJournal').where('type', '==', R.LOAD_TYPE.SHIPPING))).docs.map(d => d.data()), 'SHIPPING');
    n += ships.filter(x => x.id !== except && x.work.state === 'WORKING' && (x.loadDate || x.date) >= dates[1] && (x.loadDate || x.date) <= today).length;
  }
  return n;
}
function overLimit(area, n, SaveError) {
  const max = LOADING_LIMIT[area];
  if (max && n >= max) throw new SaveError('CONFLICT', n + ' loads are already loading. Finish or pause one first.');
}

// The day fields one savePlantLoad changes. day = the run's day block now; equipment is read only when a unit was typed.
async function loadValues(tx, db, req, day, stamp, SaveError, run) {
  const f = req.plant, after = {};
  // Ended Up Not Running. Joe 10/13: "No route equals no driver": the day's driver, truck and trailer come off it (that day only)
  // and are free for other loads; the notes keep what they were.
  // Joe 10/20 (844 Ohio Processor lost JACOBS, JOEL and showed PLANT LOAD on Weekly): dispatch wins on the driver and truck.
  // Joe 10/21 (856 SAVE-A-LOT 2: "should be allowed to put not running"): the plant can still end a load dispatch has a driver
  // on. The day stops running and its trailer comes off, but the driver and truck stay on it, so Weekly shows the driver marked
  // Not running (never PLANT LOAD) and a click there turns it back on. The copy of the sheet keeps such a day off (transfer.js).
  if (f.runs === false) {
    const keep = !!L.dispatchDriver(day);
    const was = [['driver', keep ? '' : text(day.driver) || text(day.driverId)], ['truck', keep ? '' : text(day.truck) || text(day.truckId)], ['trailer', text(day.trailer) || text(day.trailerId)]].filter(x => x[1]);
    if (!was.length) return { runs: false };
    const at = new Date(stamp).toLocaleString('en-US', { timeZone: L.TIME_ZONE, month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const notes = text(day.plantNotes);
    return Object.assign({ runs: false }, keep ? { trailerId: '', trailer: '' } : L.NOT_RUNNING_CLEARS, { plantNotes: ((notes ? notes + '\n' : '') + 'Ended up not running ' + at + ' (' + was.map(x => x[0] + ' was ' + x[1]).join(', ') + ')').slice(-1200) });
  }
  const wasLoading = dayLoadingNow(day);
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
  } else if (status === 'PAUSED') {
    if (completed) after.completeTime = '';
    if (!started) after.plantStartedAt = stamp;
    const at = new Date(stamp).toLocaleString('en-US', { timeZone: L.TIME_ZONE, month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const notes = f.notes !== undefined ? f.notes : text(day.plantNotes);
    after.plantNotes = ((notes ? notes + '\n' : '') + 'Paused ' + at + ': ' + f.pauseReason).slice(-1200);
  } else if (status === 'NOT_STARTED') {
    if (completed) after.completeTime = '';
    if (started) after.plantStartedAt = '';
  } else if (completed) status = 'COMPLETE';
  else if (f.completedAt !== undefined) status = started ? 'LOADING' : 'NOT_STARTED';
  else if (f.startedAt !== undefined) status = started ? 'LOADING' : 'NOT_STARTED';
  if (status) after.loadStatus = status;
  // Starting or resuming a load (it was not loading and now is): the area's limit.
  const nowLoading = dayLoadingNow(Object.assign({}, day, after));
  const area = runAreaOf(run, req.day);
  if (nowLoading && !wasLoading && LOADING_LIMIT[area] && !(f.overLimit && req.manager)) overLimit(area, await loadingNow(tx, db, area, stamp, run.id + '|' + req.day), SaveError);
  if (f.truck !== undefined || f.trailer !== undefined) {
    const equipment = (await tx.get(db.collection('equipment'))).docs.map(d => Object.assign({ id: d.id }, d.data()));
    [['truck', 'TRUCK', 'truckId'], ['trailer', 'TRAILER', 'trailerId']].forEach(([k, type, idField]) => {
      if (f[k] === undefined) return;
      if (!f[k]) { after[k] = ''; after[idField] = ''; return; }
      // TBA: the trailer is not known yet. Kept as plain TBA, never T-TBA.
      if (/^T\.?B\.?A\.?$/i.test(String(f[k]).trim())) { after[k] = 'TBA'; after[idField] = ''; return; }
      const u = MAINT.resolveUnit(f[k], type, equipment);
      if (f.assign) assignCheck(f[k], u, equipment, run, req.day, stamp, SaveError);
      // A number no unit matches is kept as typed, the same as the current app.
      after[k] = type === 'TRAILER' && !u.resolved && /^\d+$/.test(u.unit) ? 'T-' + u.unit : u.unit;
      after[idField] = u.id;
    });
  }
  if (req.saver) markTimes(day, after, stamp, req.saver);
  return after;
}

/*
 * Loading Rundown (Joe 10/15): who recorded each Start and End time, from where, and every later change. App-only day fields
 * (model.APP_ONLY_DAY_FIELDS), never written to the sheet:
 *   startMark / endMark  the time now on the load: { value, savedAt, by, name, via: 'TABLET' | 'DESK', station }
 *   timeEdits            the last 12 changes to a time already there: { what: 'START' | 'END', from, to, savedAt, by, name, via, station, was }
 *                        (was = who had recorded the time that was changed)
 * saver = { email, name, station }: a Plant Station tablet names its station; any other save is the manager's desk
 * (Daily Case Loadout). A mark whose value no longer matches the load's time was changed outside the app (the sheet).
 */
const TIME_MARKS = [['plantStartedAt', 'startMark', 'START'], ['completeTime', 'endMark', 'END']];
function markTimes(day, after, stamp, saver) {
  const who = { savedAt: stamp, by: text(saver.email), name: text(saver.name), via: saver.station ? 'TABLET' : 'DESK', station: text(saver.station) };
  const edits = Array.isArray(day.timeEdits) ? day.timeEdits.slice() : [], had = edits.length;
  TIME_MARKS.forEach(([field, mark, what]) => {
    if (after[field] === undefined) return;
    const was = text(day[field]), now = text(after[field]);
    if (was === now) return;
    const old = day[mark] && day[mark].value === was ? day[mark] : null;
    if (was) edits.push(Object.assign({ what, from: was, to: now }, who, { was: old ? { name: old.name || old.by || '', via: old.via || '', station: old.station || '', savedAt: old.savedAt || '' } : null }));
    after[mark] = now ? Object.assign({ value: now }, who) : '';
  });
  if (edits.length !== had) after.timeEdits = edits.slice(-12);
}

// Trailer Assignments' checks (udpoV7176ResolveUnitInput_, 220_V7276_DownUnitsOffSchedule.gs): a short number that matches
// more than one trailer must be typed in full, and a down trailer cannot go on a load for today or later.
const DOWN_STATUSES = ['DOWN', 'OUT OF SERVICE', 'OOS', 'REPAIR'];
function assignCheck(typed, u, equipment, run, prefix, stamp, SaveError) {
  const key = text(typed).toUpperCase().replace(/^T\s*-?\s*(?=\d)/, '').replace(/^0+(?=\d)/, '');
  if (!u.resolved && /^\d{1,4}$/.test(key)) {
    const suffix = key.length < 3 ? key.padStart(3, '0') : key;
    const many = (equipment || []).filter(e => e.type === 'TRAILER' && /^\d+$/.test(text(e.unit).replace(/^T-?/i, '')) && text(e.unit).replace(/^T-?/i, '').replace(/^0+(?=\d)/, '').slice(-suffix.length) === suffix);
    if (many.length > 1) throw new SaveError('BAD_REQUEST', 'Trailer ' + text(typed) + ' matches ' + many.slice(0, 6).map(e => e.unit).join(', ') + '. Type the full number.');
  }
  const e = u.resolved ? (equipment || []).find(x => x.id === u.id) : null;
  if (!e || DOWN_STATUSES.indexOf(text(e.status).toUpperCase()) < 0 || !run) return;
  const block = L.DAYS.indexOf(prefix), delivery = L.addDays(run.weekStart, block);
  const offset = run.days && run.days[prefix] && run.days[prefix].loadDayOffset != null ? run.days[prefix].loadDayOffset : -1;
  if (L.addDays(delivery, offset) < L.operatingDay(new Date(stamp))) return;
  const reason = (/DOWN:\s*([^|]+)/i.exec(text(e.notes)) || [])[1];
  throw new SaveError('NOT_ALLOWED', 'Trailer ' + e.unit + ' is down' + (reason ? ' (' + reason.trim() + ')' : '') + '. Pick another trailer, or put it back in service on Down Trucks / Trailers.');
}

// Pickups: "Add Pickup" (Product / Item, Quantity / Cases, Optional Note) and "Pickup Complete".
function validatePickup(action, input, SaveError) {
  // A Plant Station tablet names its station (Case Loadout, ...): the pickup shows it as who added or completed it.
  const out = {}, station = text(input.station).replace(/[^A-Za-z /&-]/g, '').slice(0, 40);
  if (station) out.station = station;
  if (action === 'completePickup') {
    out.pickupId = text(input.pickupId).slice(0, 320);
    if (!out.pickupId) throw new SaveError('BAD_REQUEST', 'Pick the pickup');
    // A pickup a load note asked for (board-rules.js notePickup) is not saved yet: it names its load.
    if (/^note:/.test(out.pickupId)) {
      out.runDocId = text(input.runDocId).slice(0, 200);
      out.day = text(input.day).slice(0, 10);
      out.date = text(input.date);
      if (!out.runDocId || L.DAYS.indexOf(out.day) < 0 || !L.isDateKey(out.date)) throw new SaveError('BAD_REQUEST', 'runDocId, day and date are required');
      if (out.pickupId !== B.notePickupId(out.runDocId, out.day, out.date)) throw new SaveError('BAD_REQUEST', 'That pickup does not match its load');
    }
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

// Who added or completed a pickup, as the Pickups pop-up shows it: the Plant Station's name on a tablet, else the person's name.
async function pickupWho(tx, db, req, email) {
  if (req.station) return req.station;
  const snap = await tx.get(db.collection('users').doc(M.safeIdPart(email)));
  return (snap.exists && text(snap.data().name)) || email;
}

// Joe 10/12 ("turn all 8 sheets on"): a pickup also goes to the Plant Operations workbook's LIVE PLANT OPERATIONS tab, in the
// current app's columns (udpoV7268SavePlantPickup_), when the write-back names a copy of it (WRITEBACK_JSON "plant").
function pickupSheetOn() {
  try { return !!((JSON.parse(process.env.WRITEBACK_JSON || '{}').plant || {}).pickups); } catch (e) { return false; }
}
function pickupRow(p, email, stamp) {
  return { pickup_id: p.pickupId, facility_id: 'fac_uniontown', service_date: p.date, route_id: p.routeId, run_id: p.runId, route: p.route, run: p.run,
    operation_type: 'PICKUP', item: p.item, quantity: String(p.quantity), pickup_location: p.location || '', notes: p.notes || '', status: p.status,
    created_at: p.createdAt, created_by: p.createdBy, updated_at: stamp, updated_by: email, completed_at: p.completedAt || '', completed_by: p.completedBy || '' };
}
function queuePickup(tx, db, mode, req, ref, rowId, cells, create, stamp, email) {
  if (pickupSheetOn()) queueMaster(tx, db, mode, req.requestId, 'pickup', ref, rowId, cells, create, stamp, email, 'pickups');
}

async function savePickup(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const who = await pickupWho(tx, db, req, email);
  if (req.action === 'completePickup' && /^note:/.test(req.pickupId)) {
    // Completing a load note's pickup saves it as a pickup record (the note is the item), complete, so the note's listing goes.
    const runSnap = await tx.get(db.collection('runs').doc(req.runDocId));
    if (!runSnap.exists) throw new SaveError('NOT_FOUND', 'That run is no longer on the Live sheet');
    const run = Object.assign({}, runSnap.data(), { id: req.runDocId });
    const id = 'pu_note_' + docId(req.runDocId + '_' + req.day + '_' + req.date);
    const ref = db.collection('pickups').doc(id), already = await tx.get(ref);
    if (already.exists) return { ok: true, requestId: req.requestId, pickupId: id, already: true };
    const note = B.notePickup(run, req.day, req.date, []);
    if (!note) throw new SaveError('NOT_FOUND', 'The load note no longer asks for a pickup');
    const noteBy = note.createdBy ? await tx.get(db.collection('users').doc(M.safeIdPart(note.createdBy))) : null;
    const p = { pickupId: id, date: req.date, routeId: run.routeId || '', runId: run.runId || '', route: run.route || '', run: run.run || '', runDocId: req.runDocId, day: req.day,
      item: note.item, quantity: 'See note', location: '', notes: 'From the load note', status: 'COMPLETE', createdAt: note.createdAt || stamp, createdBy: note.createdBy || email,
      createdByName: (noteBy && noteBy.exists && text(noteBy.data().name)) || note.createdBy || who, completedAt: stamp, completedBy: email, completedByName: who,
      createdInApp: true, testEdited: true, editedAt: stamp };
    tx.set(ref, p);
    queuePickup(tx, db, mode, req, ref, id, pickupRow(p, email, stamp), true, stamp, email);
    const result = { ok: true, requestId: req.requestId, pickupId: id };
    tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, pickupId: id, fromNote: req.pickupId, after: p, result });
    return result;
  }
  if (req.action === 'completePickup') {
    const ref = db.collection('pickups').doc(docId(req.pickupId));
    const snap = await tx.get(ref);
    if (!snap.exists) throw new SaveError('NOT_FOUND', 'That pickup is no longer on the list');
    const p = snap.data();
    const result = { ok: true, requestId: req.requestId, pickupId: req.pickupId, already: p.status === 'COMPLETE' };
    if (p.status !== 'COMPLETE') {
      tx.update(ref, { status: 'COMPLETE', completedAt: stamp, completedBy: email, completedByName: who, testEdited: true, editedAt: stamp });
      queuePickup(tx, db, mode, req, ref, p.pickupId || req.pickupId, { status: 'COMPLETE', completed_at: stamp, completed_by: email, updated_at: stamp, updated_by: email }, false, stamp, email);
    }
    tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, pickupId: req.pickupId, before: { status: p.status }, after: { status: 'COMPLETE' }, result });
    return result;
  }
  const runSnap = await tx.get(db.collection('runs').doc(req.runDocId));
  if (!runSnap.exists) throw new SaveError('NOT_FOUND', 'That run is no longer on the Live sheet');
  const run = runSnap.data();
  const id = 'pu_' + req.requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 18);
  const p = { pickupId: id, date: req.date, routeId: run.routeId || '', runId: run.runId || '', route: run.route || '', run: run.run || '', runDocId: req.runDocId, day: req.day,
    item: req.item, quantity: String(req.quantity), location: '', notes: req.notes, status: 'PENDING', createdAt: stamp, createdBy: email, createdByName: who, completedAt: '', completedBy: '',
    createdInApp: true, testEdited: true, editedAt: stamp };
  tx.set(db.collection('pickups').doc(id), p);
  queuePickup(tx, db, mode, req, db.collection('pickups').doc(id), id, pickupRow(p, email, stamp), true, stamp, email);
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

// addReturn: a return nobody noted (the current app's Plant Station "Add a return", PlantStation.html:377). The crew picks the
// load it came back on (or Unknown), the product and the cases. It is a RETURN record like the dock's: it shows on Product
// Returns and on that trailer, pending until RTA, and counts in the day's returns and cases.
const UNKNOWN_ROUTE = Object.freeze({ route: 'Unknown', run: 'Route not known' });
function validateReturn(input, SaveError) {
  const out = { date: text(input.date), unknown: input.unknown === true, runDocId: text(input.runDocId).slice(0, 200), day: text(input.day).slice(0, 10) };
  if (!L.isDateKey(out.date)) throw new SaveError('BAD_REQUEST', 'date must be yyyy-mm-dd');
  if (out.unknown) Object.assign(out, UNKNOWN_ROUTE, { runDocId: '', day: '' });
  else {
    out.route = text(input.route).slice(0, 60); out.run = text(input.run).slice(0, 120);
    if (!out.route || !out.run) throw new SaveError('BAD_REQUEST', 'Pick the route the product came back on, or Unknown.');
    if (out.day && L.DAYS.indexOf(out.day) < 0) throw new SaveError('BAD_REQUEST', 'day must be sun to sat');
  }
  out.trailer = R.trailerText(input.trailer).slice(0, 60);
  out.product = text(input.product).slice(0, 200);
  if (!out.product) throw new SaveError('BAD_REQUEST', 'Pick the product returned.');
  out.sku = text(input.sku).slice(0, 40);
  out.cases = count(input.cases, 'Cases', SaveError);
  if (!out.cases || !Number.isInteger(out.cases)) throw new SaveError('BAD_REQUEST', 'Enter the cases returned as a whole number.');
  return out;
}

async function saveReturn(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const runSnap = req.runDocId ? await tx.get(db.collection('runs').doc(req.runDocId)) : null;
  const run = runSnap && runSnap.exists ? runSnap.data() : null;
  const id = 'RETURN_app_' + req.requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 24), recordId = 'RET|' + req.date + '|' + id;
  const payload = { route: req.route, run: req.run, routeId: (run && run.routeId) || '', runId: (run && run.runId) || '', trailer: req.trailer, casesReturned: String(req.cases),
    product: req.product, sku: req.sku, notes: req.product, enteredAt: 'PLANT_STATION', unknownRoute: req.unknown };
  const doc = { recordId, type: 'RETURN', date: req.date, status: 'PENDING', route: req.route, run: req.run, runId: payload.runId, runDocId: req.runDocId, day: req.day,
    trailer: req.trailer, quantity: String(req.cases), notes: req.product, payload, recordedAt: stamp, recordedBy: email, createdInApp: true, testEdited: true, editedAt: stamp };
  tx.set(db.collection('plantJournal').doc(id), doc);
  const result = { ok: true, requestId: req.requestId, recordId, runs: [] };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, after: payload, result });
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
  const SUPPLIER_OPS = ['addSupplier', 'editSupplier', 'removeSupplier'];
  if (['save', 'remove', 'progress'].concat(SUPPLIER_OPS).indexOf(out.op) < 0) throw new SaveError('BAD_REQUEST', 'op must be save, remove, progress, addSupplier, editSupplier or removeSupplier');
  if (SUPPLIER_OPS.indexOf(out.op) >= 0) {
    if (out.lane !== 'RECEIVING') throw new SaveError('BAD_REQUEST', 'Suppliers are on Receiving');
    // Joe 10/13 ("Where do I edit my receivers"): a supplier can be edited or removed, as well as added.
    if (out.op !== 'addSupplier') { out.id = text(input.id).slice(0, 60); if (!out.id) throw new SaveError('BAD_REQUEST', 'Pick the supplier'); }
    if (out.op === 'removeSupplier') return out;
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
  // Joe 10/12 (Boxing station): Shipping / Loadout loads a scheduled load and Receiving receives one. step start, save
  // (the boxes typed so far) or complete; the count, trailer, temperature and notes are the station's boxes.
  if (out.op === 'progress') {
    if (!out.id) throw new SaveError('BAD_REQUEST', 'Pick the load');
    out.step = text(input.step);
    if (['start', 'save', 'pause', 'complete', 'times'].indexOf(out.step) < 0) throw new SaveError('BAD_REQUEST', 'step must be start, save, pause, complete or times');
    if (out.step === 'pause') { out.pauseReason = text(input.pauseReason).slice(0, 300); if (!out.pauseReason) throw new SaveError('BAD_REQUEST', 'A pause reason is required.'); }
    const f = input.fields || {};
    out.work = {};
    // Joe 10/20 ("in case the plant forgot"): Edit Load on Daily Box Loadout types or fixes the Start and End times.
    if (out.step === 'times') {
      const when = (v, name) => { const t = text(v); if (!t) return ''; const ms = Date.parse(t); if (!isFinite(ms)) throw new SaveError('BAD_REQUEST', 'Check the ' + name + '.'); return new Date(ms).toISOString(); };
      out.startedAt = when(f.startedAt, 'Start Time'); out.completedAt = when(f.completedAt, 'End Time');
      if (out.completedAt && !out.startedAt) throw new SaveError('BAD_REQUEST', 'Type the Start Time too.');
      if (out.completedAt && out.completedAt < out.startedAt) throw new SaveError('BAD_REQUEST', 'End Time cannot be before Start Time.');
      return out;
    }
    if (f.count !== undefined) { const c = text(f.count); if (c && !/^[0-9]{1,6}$/.test(c)) throw new SaveError('BAD_REQUEST', (out.lane === 'RECEIVING' ? 'Cases / pallets' : 'Boxes') + ' must be a whole number.'); out.work.count = c; }
    if (f.temperature !== undefined) { const t = text(f.temperature); if (t && !/^-?[0-9]{1,3}(\.[0-9])?$/.test(t)) throw new SaveError('BAD_REQUEST', 'Check the temperature.'); out.work.temperature = t; }
    if (f.notes !== undefined) out.work.notes = text(f.notes).slice(0, 1200);
    if (f.trailer !== undefined) { const t = text(f.trailer).toUpperCase(); if (t.length > 24 || /[^A-Z0-9 _\-/.#]/.test(t)) throw new SaveError('BAD_REQUEST', 'Check the trailer number.'); out.work.trailer = t; }
    return out;
  }
  const f = input.fields || {};
  out.routeId = text(f.routeId).slice(0, 120); out.runId = text(f.runId).slice(0, 120);
  out.route = text(f.route).slice(0, 60); out.run = text(f.run).slice(0, 120);
  if (!out.route || !out.routeId || !out.runId) throw new SaveError('BAD_REQUEST', out.lane === 'RECEIVING' ? 'Pick the supplier.' : 'Pick the route / run.');
  out.pickupTime = R.time24(f.pickupTime);
  if (!out.pickupTime) throw new SaveError('BAD_REQUEST', 'Enter the pickup time.');
  out.scheduleType = text(f.scheduleType || 'ROUTE').toUpperCase();
  if (['ROUTE', 'CARRIER'].indexOf(out.scheduleType) < 0) throw new SaveError('BAD_REQUEST', 'Schedule Type must be Carrier or United Dairy Delivery');
  // Joe 10/14: a Shipping load's Load Type (Case, Totes, Boxes, Tanker); blank takes its run's Route Master type.
  out.loadType = R.loadArea(f.loadType);
  if (text(f.loadType) && !out.loadType) throw new SaveError('BAD_REQUEST', 'Load Type must be Case, Totes, Boxes or Tanker');
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

// A station loading or receiving a scheduled load: the load's work (state, count, temperature, notes, trailer) on the same
// record, so the scheduler and every station see it. A finished load is not changed again.
async function progressSchedule(tx, db, req, had, type, email, stamp, logRef, mode, SaveError) {
  if (!had) throw new SaveError('NOT_FOUND', 'That load is no longer on the schedule.');
  const before = R.scheduleEntries([had], req.lane)[0] || null, was = (had.payload && had.payload.work) || {};
  if (req.step === 'times') return scheduleTimes(tx, db, req, had, before, was, type, email, stamp, logRef, mode, SaveError);
  if (was.state === 'COMPLETE') throw new SaveError('CONFLICT', 'That load is already ' + (req.lane === 'RECEIVING' ? 'received' : 'complete') + '.');
  // Joe 10/12: a Shipping load started or resumed counts toward Boxing's limit (paused ones do not).
  // Joe 10/22 ("whenever the trailers are being entered ... it automatically then starts like it's loading"): a save of what
  // was typed (trailer, count, temperature, notes) keeps the load as it was; only Start, Resume and Complete change it.
  const kept = was.state === 'WORKING' || was.state === 'PAUSED' ? was.state : 'WAITING';
  const state = req.step === 'complete' ? 'COMPLETE' : req.step === 'pause' ? 'PAUSED' : req.step === 'save' ? kept : 'WORKING';
  if (req.lane === 'SHIPPING' && state === 'WORKING' && was.state !== 'WORKING') overLimit('BOXING', await loadingNow(tx, db, 'BOXING', stamp, req.id), SaveError);
  const work = Object.assign({}, was, req.work, { state });
  if (req.step === 'pause') {
    const at = new Date(stamp).toLocaleString('en-US', { timeZone: L.TIME_ZONE, month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    work.notes = ((text(work.notes) ? text(work.notes) + '\n' : '') + 'Paused ' + at + ': ' + req.pauseReason).slice(-1200);
  }
  if (state !== 'WAITING' && (req.step === 'start' || !was.startedAt)) Object.assign(work, { startedAt: was.startedAt || stamp, startedBy: was.startedBy || email });
  if (req.step === 'complete') Object.assign(work, { completedAt: stamp, completedBy: email });
  const payload = Object.assign({}, had.payload || {}, { work });
  if (req.work.trailer !== undefined) payload.trailer = req.work.trailer;
  const rec = Object.assign({}, had, { payload, trailer: payload.trailer || had.trailer || '', recordedAt: stamp, recordedBy: email, createdInApp: true, testEdited: true, editedAt: stamp });
  delete rec.sheetRow; delete rec.cells;
  tx.set(db.collection('plantJournal').doc(appScheduleId(type, req.id)), rec);
  const after = R.scheduleEntries([rec], req.lane)[0];
  const result = { ok: true, requestId: req.requestId, id: req.id, state: work.state, date: rec.date };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, lane: req.lane, op: req.op, step: req.step, scheduleId: req.id, before, after, result });
  return result;
}

// Typed Start and End times (a load already loaded can be fixed too). An End Time marks it loaded, the same as pressing End;
// a Start Time alone marks it loading; both cleared puts it back to waiting. A typed fix does not count toward Boxing's limit.
async function scheduleTimes(tx, db, req, had, before, was, type, email, stamp, logRef, mode, SaveError) {
  const soon = new Date(Date.parse(stamp) + 5 * 60000).toISOString();
  if ((req.startedAt && req.startedAt > soon) || (req.completedAt && req.completedAt > soon)) throw new SaveError('BAD_REQUEST', 'That time has not come yet. Check the time.');
  const state = req.completedAt ? 'COMPLETE' : req.startedAt ? (was.state === 'PAUSED' ? 'PAUSED' : 'WORKING') : 'WAITING';
  // A time left as it was keeps who pressed it.
  const same = (a, b) => !!a && !!b && Date.parse(a) === Date.parse(b);
  const startedAt = same(req.startedAt, was.startedAt) ? was.startedAt : req.startedAt, completedAt = same(req.completedAt, was.completedAt) ? was.completedAt : req.completedAt;
  const work = Object.assign({}, was, { state, startedAt, completedAt,
    startedBy: startedAt ? (startedAt === was.startedAt && was.startedBy) || email : '', completedBy: completedAt ? (completedAt === was.completedAt && was.completedBy) || email : '' });
  const payload = Object.assign({}, had.payload || {}, { work });
  const rec = Object.assign({}, had, { payload, recordedAt: stamp, recordedBy: email, createdInApp: true, testEdited: true, editedAt: stamp });
  delete rec.sheetRow; delete rec.cells;
  tx.set(db.collection('plantJournal').doc(appScheduleId(type, req.id)), rec);
  const after = R.scheduleEntries([rec], req.lane)[0];
  const result = { ok: true, requestId: req.requestId, id: req.id, state, date: rec.date };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, lane: req.lane, op: req.op, step: req.step, scheduleId: req.id, before, after, result });
  return result;
}

// Edit or remove a supplier. The same record is rewritten, so the list keeps its order; loads already
// booked keep the supplier, and the schedule shows its new name.
async function changeSupplier(tx, journal, req, email, stamp, logRef, mode, SaveError) {
  const docs = (await tx.get(journal.where('type', '==', R.SUPPLIER_TYPE))).docs.map(d => d.data());
  const list = R.scheduleSuppliers(docs), cur = list.find(x => x.routeId === req.id);
  if (!cur) throw new SaveError('NOT_FOUND', 'That supplier is no longer on the list. The list was refreshed.');
  const had = R.newestRecords(docs, [R.SUPPLIER_TYPE])[req.id] || null, others = list.filter(x => x !== cur);
  let fields;
  if (req.op === 'removeSupplier') fields = { status: 'DELETED', route: cur.route, run: cur.run, notes: cur.name };
  else {
    const code = req.code || cur.route;
    if (others.some(x => x.run.toUpperCase() === req.name)) throw new SaveError('CONFLICT', req.name + ' is already on the list.');
    if (others.some(x => x.route === code)) throw new SaveError('CONFLICT', 'Code ' + code + ' is already used.');
    fields = { status: 'ACTIVE', route: code, run: req.name, notes: req.label || req.name };
  }
  const sup = Object.assign({ recordId: req.id, type: R.SUPPLIER_TYPE, date: (had && had.date) || L.operatingDay(new Date(stamp)), routeId: req.id, runId: cur.runId, area: 'RECEIVING', payload: {},
    createdAt: had ? had.createdAt || had.recordedAt || '' : stamp }, fields, { recordedAt: stamp, recordedBy: email, createdInApp: true, testEdited: true, editedAt: stamp });
  tx.set(journal.doc(appScheduleId(R.SUPPLIER_TYPE, req.id)), sup);
  const after = req.op === 'removeSupplier' ? null : { routeId: req.id, runId: cur.runId, route: fields.route, run: fields.run, name: fields.notes };
  const result = { ok: true, requestId: req.requestId, supplier: after, removed: req.op === 'removeSupplier' ? req.id : '' };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, lane: req.lane, op: req.op, before: cur, after, result });
  return result;
}

async function saveSchedule(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const type = R.LOAD_TYPE[req.lane], journal = db.collection('plantJournal');
  if (req.op === 'editSupplier' || req.op === 'removeSupplier') return changeSupplier(tx, journal, req, email, stamp, logRef, mode, SaveError);
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
  // Joe 10/20: a load deleted on the Scheduler stays deleted. A screen still showing it (a loadout line not yet refreshed) cannot
  // bring it back with Save Load or Start; deleting it again is fine.
  if (had && String(had.status || '').toUpperCase() === 'DELETED' && req.op !== 'remove') throw new SaveError('CONFLICT', 'That load was deleted from the Scheduler. The screen was refreshed.');
  if (req.op === 'progress') return progressSchedule(tx, db, req, had, type, email, stamp, logRef, mode, SaveError);
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
    let pick = choices.filter(r => r.routeId === req.routeId && r.runId === req.runId);
    // A load booked with a supplier since removed can still be edited, keeping that supplier.
    if (!pick.length && req.lane === 'RECEIVING' && had && had.routeId === req.routeId && had.runId === req.runId) pick = [{ routeId: had.routeId, runId: had.runId, route: had.route, run: had.run }];
    if (pick.length !== 1) throw new SaveError('CONFLICT', (req.lane === 'RECEIVING' ? 'That supplier' : 'That route / run') + ' is no longer on the list. The list was refreshed; pick again.');
    if (pick[0].route !== req.route || pick[0].run !== req.run) throw new SaveError('CONFLICT', 'Route Master changed that run. The list was refreshed; pick again.');
    let trailer = req.trailer;
    if (trailer) { const u = MAINT.resolveUnit(trailer, 'TRAILER', equipment); trailer = !u.resolved && /^\d+$/.test(u.unit) ? 'T-' + u.unit : u.unit; }
    const payload = { pickupTime: req.pickupTime, loadDate: req.loadDate, trailer, scheduleType: req.scheduleType, carrier: req.scheduleType === 'CARRIER', poNumber: req.poNumber,
      cases: req.cases, product: req.product, notes: req.notes };
    // Save Load keeps what the station did on the load (its Start, End, count): changing the load's boxes does not start it over.
    if (had && had.payload && had.payload.work) payload.work = had.payload.work;
    if (req.lane === 'SHIPPING' && req.loadType) payload.loadType = req.loadType;
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

// Joe 10/21 ("if I delete something on the distribution side, it should automatically delete it on the plant side"): a load taken
// off (or moved to another day) on Daily or Weekly takes the plant's own Add Load copy of it with it, so the loadout does not
// keep it and Weekly does not show it again as PLANT LOAD. Only a United Dairy Delivery load of that run on that delivery date
// that the plant has not started; a carrier pickup, or a load being loaded or done, stays. Reads first (a transaction reads
// before it writes); the second step writes.
async function scheduledForRun(tx, db, runId, date) {
  if (!runId || !date) return [];
  const type = R.LOAD_TYPE.SHIPPING;
  const docs = (await tx.get(db.collection('plantJournal').where('type', '==', type).where('runId', '==', runId))).docs.map(d => d.data());
  return Object.values(R.newestRecords(docs, [type])).filter(rec => {
    const p = rec.payload || {}, state = String((p.work && p.work.state) || '').toUpperCase();
    return rec.runId === runId && rec.date === date && String(rec.status || '').toUpperCase() !== 'DELETED' &&
      !(p.scheduleType === 'CARRIER' || p.carrier === true) && (!state || state === 'WAITING');
  });
}
function followRun(tx, db, list, toDate, email, stamp) {
  const type = R.LOAD_TYPE.SHIPPING;
  return list.map(had => {
    const rec = Object.assign({}, had, { recordedAt: stamp, recordedBy: email, createdInApp: true, testEdited: true, editedAt: stamp });
    delete rec.sheetRow; delete rec.cells;
    const ref = db.collection(M.COLLECTIONS.plantLoads).doc(M.safeIdPart(had.recordId));
    if (!toDate) {
      rec.status = 'DELETED';
      tx.delete(ref);
    } else {
      const p = rec.payload = Object.assign({}, had.payload || {}), shift = L.daysBetween(had.date, toDate);
      rec.date = toDate;
      if (L.isDateKey(p.loadDate)) p.loadDate = L.addDays(p.loadDate, shift);
      tx.set(ref, { runId: rec.runId, route: rec.route, run: rec.run, date: rec.date, status: 'SCHEDULED', pickupTime: p.pickupTime || '', loadDate: p.loadDate || '', trailer: p.trailer || '',
        poNumber: p.poNumber || '', cases: p.cases || '', product: p.product || '', notes: p.notes || '', facilityId: rec.facilityId || '', createdInApp: true, testEdited: true, editedAt: stamp });
    }
    tx.set(db.collection('plantJournal').doc(appScheduleId(type, had.recordId)), rec);
    return had.recordId;
  });
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
    if (!d || d.type !== 'YARD_CHECK' || p.status !== 'COMPLETE' || R.yardTrailer(p.trailer) !== req.trailer) throw new SaveError('NOT_FOUND', 'That yard check is no longer open. Type the temperature again to start a new check.');
    if (Date.parse(stamp) - R.when(d.recordedAt) >= R.YARD_LOCK_MINUTES * 60000) throw new SaveError('CONFLICT', 'That yard check is more than 2 hours old. Type the temperature again to start a new check.');
    const payload = Object.assign({}, p, { temperature: req.temperature, setPoint: req.setPoint || p.setPoint || '', fuelLevel: req.fuelLevel, notes: req.notes });
    tx.update(ref, { payload, temperature: req.temperature, notes: req.notes, editedAt: stamp, editedBy: email, testEdited: true });
    const result = { ok: true, requestId: req.requestId, trailer: req.trailer, status: 'COMPLETE', checkId: req.checkId, recordedAt: d.recordedAt, message: 'Yard check updated.' };
    tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, trailer: req.trailer, checkId: req.checkId, before: p, after: payload, result });
    return result;
  }
  if (!req.departed) {
    // Joe 10/19 (yard saves slow): only that day's yard checks, not every plant record of the day (the lock reads no others).
    const same = (await tx.get(journal.where('type', '==', 'YARD_CHECK').where('date', '==', req.date))).docs.map(d => d.data());
    const left = R.yardLockLeft(same, req.date, req.trailer, Date.parse(stamp));
    if (left) throw new SaveError('CONFLICT', 'Trailer ' + req.trailer + ' was already checked. It can be checked again in ' + left + ' minutes.');
  }
  // Joe 10/18: a check keeps the trailer's GPS temperature at that time (gpsReefer, while it is recorded), for the 24-Hour History.
  let gps = null;
  if (!req.departed) {
    const g = await tx.get(db.collection('gpsReefer').doc(M.safeIdPart(req.trailer)));
    const r = g.exists ? g.data() : null;
    if (r && r.recording && r.tempF !== null && r.tempF !== undefined && Date.parse(stamp) - R.when(r.readingAt) <= R.REEFER_STALE_MINUTES * 60000) gps = { gpsTempF: r.tempF, gpsAt: r.readingAt };
  }
  const id = 'YARD_CHECK_app_' + req.requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  const payload = req.departed ? { route: req.routeRun, run: req.routeRun, trailer: req.trailer, notes: 'Left the yard', status: 'DEPARTED' }
    : Object.assign({ route: req.routeRun, run: req.routeRun, trailer: req.trailer, temperature: req.temperature, setPoint: req.setPoint, fuelLevel: req.fuelLevel, notes: req.notes, status: 'COMPLETE' }, gps || {});
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
  // Joe 10/10: no Record button. Each box saves as it is left: the first save is the check, later ones fill in the same check.
  // Joe 10/14: Undo on a Run Complete pressed by mistake takes that check off the line (it stays in the change log).
  out.undone = input.undone === true;
  out.checkId = text(input.checkId).slice(0, 150);
  if (out.undone && !out.checkId) throw new SaveError('BAD_REQUEST', 'Undo needs the check to take back');
  if (out.checkId && !/^PRODUCTION_QUALITY_app_[A-Za-z0-9]+$/.test(out.checkId)) throw new SaveError('BAD_REQUEST', 'checkId is not a quality check');
  return out;
}
// A check filled in box by box stays open to its own later boxes for 12 hours.
const FILL_IN_HOURS = 12;

async function saveQuality(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const line = await tx.get(db.collection('plantSetup').doc(docId(req.operationId)));
  const d = line.exists ? line.data() : null;
  if (!d || d.type !== 'PRODUCTION_AREA' || d.status !== 'ACTIVE') throw new SaveError('NOT_FOUND', 'Production area is not configured for this plant.');
  const record = { operationId: req.operationId, area: d.name, product: req.product, status: req.status, remainingOutput: req.remainingOutput, qualityCheck: req.qualityCheck,
    tipTest: req.tipTest, temperature: req.temperature, cycleTime: req.cycleTime, productSize: req.productSize, annealerSpeed: req.annealerSpeed, weights: req.weights, notes: req.notes,
    facilityId: d.facilityId || 'fac_uniontown' };
  if (req.undone) record.undone = true;
  const id = req.checkId || 'PRODUCTION_QUALITY_app_' + req.requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  if (req.checkId) {
    const ref = db.collection('plantJournal').doc(req.checkId), had = await tx.get(ref), old = had.exists ? had.data() : null;
    if (!old || old.type !== R.QUALITY_TYPE || (old.payload || {}).operationId !== req.operationId) throw new SaveError('NOT_FOUND', 'That quality check is no longer open. Enter it again.');
    if (Date.parse(stamp) - R.when(old.recordedAt) >= FILL_IN_HOURS * 3600000) throw new SaveError('CONFLICT', 'That quality check is too old to change. Enter a new one.');
    if ((old.payload || {}).fromLine) record.fromLine = true;
    // Joe 10/14: one weight record. The Blow Mold's heads and a filler's filled jugs go on the line tablet too (weightjoin.js).
    const mirror = req.undone ? null : await WJ.planFromQuality(tx, db, d, req, id, stamp, email);
    tx.update(ref, { status: req.status, temperature: req.temperature, notes: req.notes, payload: record, editedAt: stamp, editedBy: email, testEdited: true });
    if (mirror) WJ.applyFromQuality(tx, db, mirror, req, email, stamp);
    const result = { ok: true, requestId: req.requestId, operationId: req.operationId, checkId: req.checkId, recordedAt: old.recordedAt, message: d.name + ' quality check saved.' };
    tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, operationId: req.operationId, checkId: req.checkId, before: old.payload || {}, after: record, result });
    return result;
  }
  const mirror = req.undone ? null : await WJ.planFromQuality(tx, db, d, req, id, stamp, email);
  tx.set(db.collection('plantJournal').doc(id), { recordId: 'PQ-' + req.requestId.slice(0, 40), type: R.QUALITY_TYPE, date: L.operatingDay(new Date(stamp)), status: req.status, area: d.name,
    temperature: req.temperature, notes: req.notes, payload: record, recordedAt: stamp, recordedBy: email, createdInApp: true, testEdited: true, editedAt: stamp });
  if (mirror) WJ.applyFromQuality(tx, db, mirror, req, email, stamp);
  const result = { ok: true, requestId: req.requestId, operationId: req.operationId, checkId: id, recordedAt: stamp, message: d.name + ' production status updated; quality observation recorded.' };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, operationId: req.operationId, after: record, result });
  return result;
}

/* ---------- Shift Notes ---------- */

// saveShiftNote: a timestamped entry or a review note under one, as desktopUiSavePlantShiftReportV5008 (section handoff).
function validateShiftNote(input, SaveError) {
  const v = input.values && typeof input.values === 'object' ? input.values : {};
  const out = { parentId: text(v.ParentId).slice(0, 80), entry: text(v.Entry).slice(0, 4000), notes: text(input.notes).slice(0, 1500), readingTime: text(input.readingTime).slice(0, 20) };
  out.type = out.parentId ? 'REVIEW' : text(v.Type).slice(0, 40) || 'Handoff';
  if (!out.parentId && R.ENTRY_TYPES.indexOf(out.type) < 0) throw new SaveError('BAD_REQUEST', 'Type must be Breakdown, Maintenance Request, Incident, Safety, Quality, Handoff or Other.');
  out.equipment = out.parentId ? '' : text(v.Equipment).slice(0, 80);
  // Joe 10/12: a breakdown is recorded with when it was back up and what fixed it (on the entry, or later in a review under it);
  // a Maintenance Request says how long it can wait.
  out.upAt = text(v.UpAt).slice(0, 5);
  if (out.upAt && !/^\d{1,2}:\d\d$/.test(out.upAt)) throw new SaveError('BAD_REQUEST', 'Back up at must be a time.');
  out.fix = text(v.Fix).slice(0, 1000);
  out.urgency = out.parentId ? '' : text(v.Urgency).slice(0, 30);
  if (out.urgency && R.URGENCIES.indexOf(out.urgency) < 0) throw new SaveError('BAD_REQUEST', 'Can it wait must be ' + R.URGENCIES.join(', ') + '.');
  out.shift = text(input.shift).toUpperCase();
  // Any of the plant's shifts (Administration > Plant Setup > Plant Shifts can rename them), picked on Shift Notes.
  if (out.shift && R.SHIFTS.indexOf(out.shift) < 0 && !/^[A-Z0-9][A-Z0-9 &'.-]{0,39}$/.test(out.shift)) throw new SaveError('BAD_REQUEST', 'Shift could not be determined.');
  out.followUpStatus = text(input.followUpStatus).toUpperCase() || 'OPEN';
  if (R.FOLLOW_UPS.indexOf(out.followUpStatus) < 0) throw new SaveError('BAD_REQUEST', 'Follow-up must be Open, Monitor or Resolved.');
  if (out.parentId && !out.entry) throw new SaveError('BAD_REQUEST', 'Enter the review note before adding it.');
  if (!out.parentId && !out.entry && !out.notes) throw new SaveError('BAD_REQUEST', 'Enter report information before saving.');
  if (out.parentId) out.entry = out.entry.slice(0, 500);
  // Joe 10/10: no Save button. The entry saves as each box is left; later boxes fill in the same entry.
  out.checkId = out.parentId ? '' : text(input.checkId).slice(0, 150);
  if (out.checkId && !/^SHIFT_REPORT_app_[A-Za-z0-9]+$/.test(out.checkId)) throw new SaveError('BAD_REQUEST', 'checkId is not a shift entry');
  return out;
}

// What an entry keeps: its words, type and equipment, and (when given) back up at, what fixed it and how long it can wait.
function entryValues(req) {
  return Object.assign({ Entry: req.entry, Type: req.type, Equipment: req.equipment }, req.upAt ? { UpAt: req.upAt } : {}, req.fix ? { Fix: req.fix } : {}, req.urgency ? { Urgency: req.urgency } : {});
}
async function saveShiftNote(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const journal = db.collection('plantJournal');
  if (req.parentId) {
    const parent = (await tx.get(journal.where('recordId', '==', req.parentId))).docs.map(d => d.data()).filter(d => d.type === R.SHIFT_TYPE);
    if (!parent.length) throw new SaveError('NOT_FOUND', 'That entry is no longer on the log.');
  }
  if (req.checkId) {
    const ref = journal.doc(req.checkId), had = await tx.get(ref), old = had.exists ? had.data() : null, p = (old && old.payload) || {};
    if (!old || old.type !== R.SHIFT_TYPE || (p.values || {}).ParentId) throw new SaveError('NOT_FOUND', 'That entry is no longer on the log.');
    if (Date.parse(stamp) - R.when(old.recordedAt) >= FILL_IN_HOURS * 3600000) throw new SaveError('CONFLICT', 'That entry is too old to change. Start a new entry.');
    const shift = req.shift || p.shift, payload = Object.assign({}, p, { shift, readingTime: req.readingTime || p.readingTime, values: entryValues(req), notes: req.notes, followUpStatus: req.followUpStatus });
    tx.update(ref, { status: req.followUpStatus, shift, notes: req.notes, payload, editedAt: stamp, editedBy: email, testEdited: true });
    const result = { ok: true, requestId: req.requestId, entryId: p.entryId || old.recordId, checkId: req.checkId, shift, recordedAt: old.recordedAt, message: 'Shift entry saved.' };
    tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, entryId: result.entryId, checkId: req.checkId, before: p, after: payload, result });
    return result;
  }
  const now = new Date(stamp), entryId = 'SHIFT-' + req.requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 30);
  const shift = req.shift || R.shiftAt(now.getTime());
  const values = req.parentId ? Object.assign({ Entry: req.entry, Type: 'REVIEW', ParentId: req.parentId }, req.upAt ? { UpAt: req.upAt } : {}, req.fix ? { Fix: req.fix } : {}) : entryValues(req);
  const payload = { entryId, date: L.operatingDay(now), shift, section: 'HANDOFF', readingTime: req.readingTime, values, notes: req.notes, followUpStatus: req.followUpStatus };
  const docName = R.SHIFT_TYPE + '_app_' + entryId.replace(/[^A-Za-z0-9]/g, '');
  tx.set(journal.doc(docName), { recordId: entryId, type: R.SHIFT_TYPE, date: payload.date, status: req.followUpStatus, shift, area: 'HANDOFF',
    notes: req.notes, payload, recordedAt: stamp, recordedBy: email, createdInApp: true, testEdited: true, editedAt: stamp });
  const result = { ok: true, requestId: req.requestId, entryId, checkId: req.parentId ? '' : docName, shift, recordedAt: stamp, message: req.parentId ? 'Review note added.' : 'Shift entry saved.' };
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
  // Joe 10/10: no Save button. The reading saves as its box is left; the notes box, or a corrected reading, fills in the same
  // reading while the location's 2-hour lock runs.
  out.checkId = text(input.checkId).slice(0, 150);
  if (out.checkId && !/^PLANT_TEMPERATURE_CHECK_app_[A-Za-z0-9]+$/.test(out.checkId)) throw new SaveError('BAD_REQUEST', 'checkId is not a temperature reading');
  return out;
}

async function saveTemperature(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const got = await tx.get(db.collection('plantSetup').doc(docId(req.locationId)));
  // A location changed or added in Administration > MOCREO & Sensors (tempLocations) counts as set up.
  const mine = await tx.get(db.collection('tempLocations').doc(docId(req.locationId)));
  const d = R.withTempLocations(got.exists ? [got.data()] : [], mine.exists ? [mine.data()] : []).find(r => r.type === 'TEMPERATURE_CHECK_LOCATION');
  if (!d || d.status !== 'ACTIVE') throw new SaveError('NOT_FOUND', 'Temperature location is not configured for this plant.');
  const loc = R.tempLocations([d])[0], now = new Date(stamp), day = L.operatingDay(now);
  if (req.checkId) {
    const ref = db.collection('plantJournal').doc(req.checkId), had = await tx.get(ref), old = had.exists ? had.data() : null, p = (old && old.payload) || {};
    if (!old || old.type !== R.TEMP_TYPE || p.locationId !== loc.locationId) throw new SaveError('NOT_FOUND', 'That reading is no longer open. Enter it again.');
    if (now.getTime() - R.when(old.recordedAt) >= R.TEMP_LOCK_MINUTES * 60000) throw new SaveError('CONFLICT', 'That reading is more than 2 hours old. Enter a new one.');
    const status = R.tempStatus(loc, req.manualTemperature), payload = Object.assign({}, p, { manualTemperature: req.manualTemperature, notes: req.notes, status });
    tx.update(ref, { status, temperature: String(req.manualTemperature), notes: req.notes, payload, editedAt: stamp, editedBy: email, testEdited: true });
    const result = { ok: true, requestId: req.requestId, recordId: old.recordId, checkId: req.checkId, locationId: loc.locationId, status, recordedAt: old.recordedAt, message: loc.location + ' reading saved.' };
    tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, locationId: loc.locationId, checkId: req.checkId, before: p, after: payload, result });
    return result;
  }
  const recent = (await tx.get(db.collection('plantJournal').where('date', 'in', [L.addDays(day, -1), day]))).docs.map(x => x.data());
  const left = R.tempLockLeft(recent, loc, now.getTime());
  if (left) throw new SaveError('CONFLICT', loc.location + ' was already checked. It can be checked again in ' + left + ' minutes.');
  const status = R.tempStatus(loc, req.manualTemperature);
  const payload = { locationId: loc.locationId, location: loc.location, manualTemperature: req.manualTemperature, notes: req.notes, status, sensorId: loc.sensorId, sensorTemperature: '', batteryLevel: '', source: 'PLANT TEMPERATURE MANUAL CHECK' };
  const id = R.TEMP_TYPE + '_app_' + req.requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  tx.set(db.collection('plantJournal').doc(id), { recordId: 'TEMP-' + req.requestId.slice(0, 40), type: R.TEMP_TYPE, date: day, status, area: loc.location, temperature: String(req.manualTemperature),
    notes: req.notes, payload, recordedAt: stamp, recordedBy: email, createdInApp: true, testEdited: true, editedAt: stamp });
  const result = { ok: true, requestId: req.requestId, recordId: 'TEMP-' + req.requestId.slice(0, 40), checkId: id, locationId: loc.locationId, status, recordedAt: stamp, message: loc.location + ' temperature recorded. This location is locked for 2 hours.' };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, locationId: loc.locationId, after: payload, result });
  return result;
}

/* ---------- Send Current Report ---------- */

// sendPlantReport: keeps the report as it was sent (subject, text, note, and the report itself for the email's layout).
// With email set up (MAIL_FROM) it is SENDING and reportmail.js emails it straight after the save; without, it is HELD.
// The current app's Send Current Report emails the Plant Managers group through its outbound email policy.
function validateReport(input, SaveError) {
  const out = { subject: text(input.subject).slice(0, 200), body: text(input.text).slice(0, 20000), note: text(input.note).slice(0, 1500), groupName: text(input.groupName).slice(0, 100) || 'Plant Managers', reportJson: '',
    // Joe 10/19: Send Test to Me emails the report only to the person who pressed it, even on the live app.
    testOnly: input.testOnly === true };
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
  const date = L.operatingDay(new Date(stamp));
  // Joe 10/20: the forecast says how much time was made up or lost since the shift's earlier report (the last one sent
  // today with a forecast, kept here with this report so the email and Shift Reports both show it).
  let reportJson = req.reportJson;
  try {
    const r = reportJson ? JSON.parse(reportJson) : null;
    if (r && r.forecast) {
      const earlier = (await tx.get(db.collection('plantReports').where('date', '==', date))).docs.map(x => x.data())
        .filter(x => x.mode === mode.mode && x.reportJson && String(x.at) < stamp).sort((a, b) => String(b.at).localeCompare(String(a.at)));
      for (const x of earlier) {
        let f = null;
        try { f = JSON.parse(x.reportJson).forecast; } catch (e) { f = null; }
        if (f && f.asOf) { r.forecast.before = { asOf: f.asOf, behind: R.forecastBehind(f) }; reportJson = JSON.stringify(r); break; }
      }
    }
  } catch (e) { reportJson = req.reportJson; }
  const record = { subject: req.subject, text: req.body, note: req.note, groupName: req.groupName, reportJson, testOnly: !!req.testOnly, status: mailOn ? 'SENDING' : 'HELD', emailed: false,
    date, at: stamp, by: email, mode: mode.mode };
  tx.set(db.collection('plantReports').doc(id), record);
  const result = { ok: true, requestId: req.requestId, reportId: id, sent: false, sending: mailOn, subject: req.subject,
    message: mailOn ? (req.testOnly ? 'Sending the test to you only…' : 'Report saved. Sending the email…') : 'Report saved. Email is not set up in Operations yet, so it was not emailed' + (req.testOnly ? '.' : ' to ' + req.groupName + '.') };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, reportId: id, result });
  return result;
}

/* ---------- Products ---------- */

// Products (Joe 10/10, plant areas and upload 10/11): each plant's products, by area. A plant's areas are its machines
// (PLANT_OPERATIONS_MASTER production areas, whose lists are the Product drop-down on Quality Checks) and the areas the plant
// adds itself (Uniontown starts with CASES and TANKER); each plant keeps its own group list (Milk, Drinks, TEA) too.
// An area's list replaces its starting list (public/data/plant-products.json), so a new SKU goes in without a code change.
const PRODUCT_LIMIT = 400, AREA_LIMIT = 40, GROUP_LIMIT = 40;
// The same starting areas and groups as public/js/products.js.
const START_AREAS = { fac_uniontown: ['CASES', 'TANKER'] };
const START_GROUPS = ['Milk', 'Drinks', 'TEA'];
const plantIds = () => (L.PLANTS || []).map(p => p.id);
const areaSlug = (facilityId, name) => facilityId + '_area_' + text(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
// A plant's own areas and groups: what was saved, else the starting ones.
async function productSetupOf(tx, db, facilityId) {
  const ref = db.collection('productSetup').doc(facilityId), had = await tx.get(ref), d = had.exists ? had.data() : null;
  return { ref, had: d, areas: d && Array.isArray(d.areas) ? d.areas : (START_AREAS[facilityId] || []).map(n => ({ id: areaSlug(facilityId, n), name: n })),
    groups: d && Array.isArray(d.groups) ? d.groups : START_GROUPS.slice() };
}
const machinePlant = (d) => text(d.facilityId) || 'fac_uniontown';
function validFacility(v, SaveError) {
  const facilityId = text(v);
  if (plantIds().indexOf(facilityId) < 0) throw new SaveError('BAD_REQUEST', 'Pick a plant.');
  return facilityId;
}
// Joe 10/11: one product list holds everything about each product: UPC, full speed per minute (RedZone's Rate/Min), Target %
// (RedZone's), the allowed speed range per minute, and shelf life (days from the run date to the code date). The same names are in
// public/js/products.js (FIELDS) and are read by the Line Targets, line tablet and TV screens; blank ones are left off.
const PRODUCT_NUMBERS = [['ratePerMin', 'Full Speed Per Min', 100000], ['targetPct', 'Target %', 100], ['minSpeed', 'Lowest Speed', 100000], ['maxSpeed', 'Highest Speed', 100000], ['shelfLifeDays', 'Shelf Life Days', 3650], ['fillGrams', 'Target Fill Weight g', 20000]];
// An upload never wipes these: a file that leaves one blank or out keeps what the product has.
const PRODUCT_KEEP = ['upc'].concat(PRODUCT_NUMBERS.map(x => x[0]));
function productRows(list, SaveError) {
  if (!Array.isArray(list) || list.length > PRODUCT_LIMIT) throw new SaveError('BAD_REQUEST', 'An area holds up to ' + PRODUCT_LIMIT + ' products.');
  const seen = {}, products = [];
  list.forEach(p => {
    const x = p && typeof p === 'object' ? p : {};
    const row = { name: text(x.name).slice(0, 120), sku: text(x.sku).slice(0, 40), mfgType: text(x.mfgType).slice(0, 40), productGroup: text(x.productGroup).slice(0, 60) };
    if (!row.name) return;
    const upc = text(x.upc).replace(/[\s-]/g, '');
    if (upc) { if (!/^\d{6,14}$/.test(upc)) throw new SaveError('BAD_REQUEST', row.name + ': the UPC is 6 to 14 digits.'); row.upc = upc; }
    PRODUCT_NUMBERS.forEach(([k, label, max]) => {
      const t = text(x[k]);
      if (t === '') return;
      const n = Number(t.replace(/,/g, ''));
      if (!isFinite(n) || n < 0 || n > max) throw new SaveError('BAD_REQUEST', row.name + ': ' + label + ' must be a number from 0 to ' + max + '.');
      row[k] = k === 'shelfLifeDays' ? Math.round(n) : Math.round(n * 100) / 100;
    });
    if (row.minSpeed !== undefined && row.maxSpeed !== undefined && row.minSpeed > row.maxSpeed) throw new SaveError('BAD_REQUEST', row.name + ': Lowest Speed is above Highest Speed.');
    const key = row.name.toUpperCase();
    if (seen[key]) throw new SaveError('BAD_REQUEST', row.name + ' is on the list twice. Each product needs its own name.');
    seen[key] = true;
    products.push(row);
  });
  return products;
}
// saveMachineProducts: one area's whole list (operationId = the area: a machine's operation id or a plant's own area id).
function validateMachineProducts(input, SaveError) {
  const operationId = text(input.areaId || input.operationId).slice(0, 120);
  if (!/^[A-Za-z0-9_-]+$/.test(operationId)) throw new SaveError('BAD_REQUEST', 'Pick an area.');
  return { operationId, products: productRows(input.products, SaveError) };
}
// The area an id names: {name, facilityId} or null.
async function areaOf_(tx, db, id) {
  const line = await tx.get(db.collection('plantSetup').doc(docId(id)));
  const d = line.exists ? line.data() : null;
  if (d && d.type === 'PRODUCTION_AREA') return { name: d.name, facilityId: machinePlant(d), machine: true };
  const m = /^(fac_[a-z0-9_]+?)_area_/.exec(id);
  if (!m || plantIds().indexOf(m[1]) < 0) return null;
  const own = await productSetupOf(tx, db, m[1]), a = own.areas.find(x => x.id === id);
  return a ? { name: a.name, facilityId: m[1], machine: false } : null;
}
async function saveMachineProducts(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const area = await areaOf_(tx, db, req.operationId);
  if (!area) throw new SaveError('NOT_FOUND', 'That area is not set up for this plant.');
  const ref = db.collection('plantProducts').doc(docId(req.operationId)), had = await tx.get(ref);
  const after = { operationId: req.operationId, line: area.name, facilityId: area.facilityId, products: req.products, updatedAt: stamp, updatedBy: email, testEdited: true };
  tx.set(ref, after);
  const result = { ok: true, requestId: req.requestId, operationId: req.operationId, count: req.products.length, message: area.name + ': ' + req.products.length + ' product' + (req.products.length === 1 ? '' : 's') + ' saved.' };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, operationId: req.operationId, before: had.exists ? had.data().products || [] : null, after: req.products, result });
  return result;
}
// saveProductSetup: a plant's own areas (machines are not in it; they come from Plant Operations) and its groups.
function cleanNames(list, limit, what, SaveError) {
  if (!Array.isArray(list) || list.length > limit) throw new SaveError('BAD_REQUEST', 'A plant holds up to ' + limit + ' ' + what + '.');
  const seen = {};
  return list.map(x => text(x && typeof x === 'object' ? x.name : x).slice(0, 60)).filter(n => {
    if (!n) return false;
    if (seen[n.toUpperCase()]) throw new SaveError('BAD_REQUEST', n + ' is on the list twice.');
    return (seen[n.toUpperCase()] = true);
  });
}
function validateProductSetup(input, SaveError) {
  const facilityId = validFacility(input.facilityId, SaveError);
  const areas = (Array.isArray(input.areas) ? input.areas : []).map(a => ({ id: text(a && a.id).slice(0, 120), name: text(a && a.name).slice(0, 60) }));
  cleanNames(areas, AREA_LIMIT, 'areas', SaveError);
  return { facilityId, areas: areas.filter(a => a.name), groups: cleanNames(input.groups, GROUP_LIMIT, 'groups', SaveError) };
}
async function saveProductSetup(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const own = await productSetupOf(tx, db, req.facilityId);
  const machines = (await tx.get(db.collection('plantSetup').where('type', '==', 'PRODUCTION_AREA'))).docs.map(d => d.data()).filter(d => machinePlant(d) === req.facilityId);
  const used = new Set(machines.map(m => text(m.name).toUpperCase()));
  const areas = req.areas.map(a => {
    if (used.has(a.name.toUpperCase())) throw new SaveError('BAD_REQUEST', a.name + ' is already a machine at this plant.');
    const was = own.areas.find(x => x.id === a.id);
    return { id: was ? was.id : areaSlug(req.facilityId, a.name), name: a.name };
  });
  if (new Set(areas.map(a => a.id)).size !== areas.length) throw new SaveError('BAD_REQUEST', 'Two areas have the same name.');
  // An area that still has products is not removed, so no list is lost.
  for (const gone of own.areas.filter(x => !areas.some(a => a.id === x.id))) {
    const p = await tx.get(db.collection('plantProducts').doc(docId(gone.id)));
    if (p.exists && (p.data().products || []).length) throw new SaveError('BAD_REQUEST', gone.name + ' still has ' + p.data().products.length + ' products. Remove them first.');
  }
  const after = { facilityId: req.facilityId, areas, groups: req.groups, updatedAt: stamp, updatedBy: email };
  tx.set(own.ref, after);
  const result = { ok: true, requestId: req.requestId, facilityId: req.facilityId, areas: areas.length, groups: req.groups.length, message: 'Areas and groups saved.' };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, facilityId: req.facilityId, before: own.had, after, result });
  return result;
}
// saveProductUpload: the filled-in template. Each area in the file gets the file's list (areas not in the file stay as they
// are); an area or group the plant does not have yet is added.
function validateProductUpload(input, SaveError) {
  const facilityId = validFacility(input.facilityId, SaveError);
  if (!Array.isArray(input.areas) || !input.areas.length || input.areas.length > AREA_LIMIT) throw new SaveError('BAD_REQUEST', 'The file has no areas to load.');
  const seen = {};
  const areas = input.areas.map(a => {
    const x = a && typeof a === 'object' ? a : {}, name = text(x.name).slice(0, 60), id = text(x.areaId).slice(0, 120);
    if (!name) throw new SaveError('BAD_REQUEST', 'Every row needs an Area.');
    if (seen[name.toUpperCase()]) throw new SaveError('BAD_REQUEST', name + ' is in the upload twice.');
    seen[name.toUpperCase()] = true;
    return { areaId: /^[A-Za-z0-9_-]*$/.test(id) ? id : '', name, products: productRows(x.products, SaveError).map(p => Object.assign(p, {})) };
  });
  return { facilityId, areas };
}
async function saveProductUpload(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const own = await productSetupOf(tx, db, req.facilityId);
  const machines = (await tx.get(db.collection('plantSetup').where('type', '==', 'PRODUCTION_AREA'))).docs.map(d => d.data()).filter(d => machinePlant(d) === req.facilityId);
  const ownAreas = own.areas.slice(), groups = own.groups.slice(), addedAreas = [], addedGroups = [];
  const targets = req.areas.map(a => {
    const k = a.name.toUpperCase(), m = machines.find(x => text(x.name).toUpperCase() === k), o = ownAreas.find(x => x.name.toUpperCase() === k);
    if (m) return { id: m.operationId, name: m.name, products: a.products };
    if (o) return { id: o.id, name: o.name, products: a.products };
    if (ownAreas.length >= AREA_LIMIT) throw new SaveError('BAD_REQUEST', 'A plant holds up to ' + AREA_LIMIT + ' areas.');
    const add = { id: areaSlug(req.facilityId, a.name), name: a.name };
    ownAreas.push(add); addedAreas.push(add.name);
    return { id: add.id, name: add.name, products: a.products };
  });
  targets.forEach(t => t.products.forEach(p => String(p.productGroup || '').split(',').map(g => g.trim()).filter(Boolean).forEach(g => {
    if (!groups.some(x => x.toUpperCase() === g.toUpperCase())) { groups.push(g); addedGroups.push(g); }
  })));
  if (groups.length > GROUP_LIMIT) throw new SaveError('BAD_REQUEST', 'A plant holds up to ' + GROUP_LIMIT + ' groups.');
  const refs = targets.map(t => db.collection('plantProducts').doc(docId(t.id))), had = [];
  for (const r of refs) had.push(await tx.get(r));
  // UPC, speeds, Target % and shelf life the file leaves blank or out keep what the same product has in that area.
  targets.forEach((t, i) => {
    const was = {};
    (had[i].exists ? had[i].data().products || [] : []).forEach(p => { if (p && p.name) was[text(p.name).toUpperCase()] = p; });
    t.products = t.products.map(p => { const w = was[p.name.toUpperCase()], out = Object.assign({}, p); if (w) PRODUCT_KEEP.forEach(k => { if (out[k] === undefined && w[k] !== undefined && w[k] !== '') out[k] = w[k]; }); return out; });
  });
  if (addedAreas.length || addedGroups.length) tx.set(own.ref, { facilityId: req.facilityId, areas: ownAreas, groups, updatedAt: stamp, updatedBy: email });
  targets.forEach((t, i) => tx.set(refs[i], { operationId: t.id, line: t.name, facilityId: req.facilityId, products: t.products, updatedAt: stamp, updatedBy: email, testEdited: true, uploaded: true }));
  const count = targets.reduce((n, t) => n + t.products.length, 0);
  const result = { ok: true, requestId: req.requestId, facilityId: req.facilityId, areas: targets.length, count, addedAreas, addedGroups,
    message: count + ' product' + (count === 1 ? '' : 's') + ' loaded in ' + targets.length + ' area' + (targets.length === 1 ? '' : 's') + '.' };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, facilityId: req.facilityId, before: targets.map((t, i) => ({ area: t.id, products: had[i].exists ? had[i].data().products || [] : null })), after: targets.map(t => ({ area: t.id, products: t.products })), result });
  return result;
}

// saveProductSheet (Joe 10/13): the Product Sheet is one list for the plant with a check for each machine a product runs on, and
// Machine Setup sets one machine's products. Both send the machine lists they change (each is that machine's Quality Check
// drop-down, kept as before in plantProducts) and, when it changes, the plant's products that run on no machine yet (productSheet).
function validateProductSheet(input, SaveError) {
  const facilityId = validFacility(input.facilityId, SaveError);
  const list = Array.isArray(input.areas) ? input.areas : [];
  if (list.length > AREA_LIMIT) throw new SaveError('BAD_REQUEST', 'A plant holds up to ' + AREA_LIMIT + ' areas.');
  const seen = {};
  const areas = list.map(a => {
    const x = a && typeof a === 'object' ? a : {}, areaId = text(x.areaId).slice(0, 120);
    if (!/^[A-Za-z0-9_-]+$/.test(areaId)) throw new SaveError('BAD_REQUEST', 'Pick a machine.');
    if (seen[areaId]) throw new SaveError('BAD_REQUEST', 'A machine is in the save twice.');
    seen[areaId] = true;
    return { areaId, products: productRows(x.products, SaveError) };
  });
  const out = { facilityId, areas };
  if (input.loose !== undefined) out.loose = productRows(input.loose, SaveError);
  if (!areas.length && !out.loose) throw new SaveError('BAD_REQUEST', 'Nothing to save.');
  return out;
}
async function saveProductSheet(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const found = [];
  for (const a of req.areas) {
    const area = await areaOf_(tx, db, a.areaId);
    if (!area || area.facilityId !== req.facilityId) throw new SaveError('NOT_FOUND', 'That machine is not set up for this plant.');
    found.push(area);
  }
  const refs = req.areas.map(a => db.collection('plantProducts').doc(docId(a.areaId))), had = [];
  for (const r of refs) had.push(await tx.get(r));
  const looseRef = db.collection('productSheet').doc(req.facilityId), looseHad = req.loose ? await tx.get(looseRef) : null;
  // A group typed on a product (or in an uploaded file) that the plant does not have yet is added to its groups.
  const own = await productSetupOf(tx, db, req.facilityId), groups = own.groups.slice(), addedGroups = [];
  req.areas.map(a => a.products).concat([req.loose || []]).forEach(list => list.forEach(p => String(p.productGroup || '').split(',').map(g => g.trim()).filter(Boolean).forEach(g => {
    if (!groups.some(x => x.toUpperCase() === g.toUpperCase())) { groups.push(g); addedGroups.push(g); }
  })));
  if (groups.length > GROUP_LIMIT) throw new SaveError('BAD_REQUEST', 'A plant holds up to ' + GROUP_LIMIT + ' groups.');
  if (addedGroups.length) tx.set(own.ref, { facilityId: req.facilityId, areas: own.areas, groups, updatedAt: stamp, updatedBy: email });
  req.areas.forEach((a, i) => tx.set(refs[i], { operationId: a.areaId, line: found[i].name, facilityId: req.facilityId, products: a.products, updatedAt: stamp, updatedBy: email, testEdited: true }));
  if (req.loose) tx.set(looseRef, { facilityId: req.facilityId, products: req.loose, updatedAt: stamp, updatedBy: email });
  const result = { ok: true, requestId: req.requestId, facilityId: req.facilityId, areas: req.areas.length, addedGroups, message: req.areas.length === 1 && !req.loose ? found[0].name + ': ' + req.areas[0].products.length + ' product' + (req.areas[0].products.length === 1 ? '' : 's') + ' saved.' : 'Product Sheet saved.' };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, facilityId: req.facilityId,
    before: req.areas.map((a, i) => ({ area: a.areaId, products: had[i].exists ? had[i].data().products || [] : null })).concat(req.loose ? [{ area: 'loose', products: looseHad.exists ? looseHad.data().products || [] : null }] : []),
    after: req.areas.map(a => ({ area: a.areaId, products: a.products })).concat(req.loose ? [{ area: 'loose', products: req.loose }] : []), result });
  return result;
}

/* ---------- Plant Shifts ---------- */

// savePlantShifts (Joe 10/10): a plant's shifts, Administration > Plant Shifts. Plant Reports count each load for the shift it
// started loading in. Uniontown starts with 6:00 AM-2:30 PM, 2:00 PM-10:30 PM and 10:00 PM-5:30 AM (public/js/plant-reports.js).
// Joe 10/11: each shift is on the Distribution side or the Plant Production side (a shift with no side is Distribution).
const SHIFT_LIMIT = 12, SHIFT_SIDES = ['DISTRIBUTION', 'PRODUCTION'];
function validatePlantShifts(input, SaveError) {
  const facilityId = text(input.facilityId);
  if (!/^fac_[a-z0-9_]+$/.test(facilityId)) throw new SaveError('BAD_REQUEST', 'Pick a plant.');
  if (!Array.isArray(input.shifts) || !input.shifts.length || input.shifts.length > SHIFT_LIMIT) throw new SaveError('BAD_REQUEST', 'A plant needs 1 to ' + SHIFT_LIMIT + ' shifts.');
  const seen = {}, shifts = input.shifts.map(x => {
    const s = x && typeof x === 'object' ? x : {}, name = text(s.name).slice(0, 40), start = text(s.start), end = text(s.end), side = text(s.side).toUpperCase() || 'DISTRIBUTION';
    if (!name) throw new SaveError('BAD_REQUEST', 'Every shift needs a name.');
    if (SHIFT_SIDES.indexOf(side) < 0) throw new SaveError('BAD_REQUEST', name + ': pick Distribution or Plant Production.');
    const key = side + '|' + name.toUpperCase();
    if (seen[key]) throw new SaveError('BAD_REQUEST', name + ' is on the list twice (' + (side === 'PRODUCTION' ? 'Plant Production' : 'Distribution') + ').');
    seen[key] = true;
    const ok = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
    if (!ok(start) || !ok(end)) throw new SaveError('BAD_REQUEST', name + ': enter the start and end times.');
    if (start === end) throw new SaveError('BAD_REQUEST', name + ': the start and end cannot be the same time.');
    return { name, start, end, side };
  });
  return { facilityId, shifts };
}
async function savePlantShifts(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const ref = db.collection('plantShifts').doc(req.facilityId), had = await tx.get(ref);
  tx.set(ref, { facilityId: req.facilityId, shifts: req.shifts, updatedAt: stamp, updatedBy: email });
  const result = { ok: true, requestId: req.requestId, facilityId: req.facilityId, count: req.shifts.length, message: req.shifts.length + ' shift' + (req.shifts.length === 1 ? '' : 's') + ' saved.' };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, facilityId: req.facilityId, before: had.exists ? had.data().shifts || [] : null, after: req.shifts, result });
  return result;
}

module.exports = { scheduledForRun, followRun, productSetupOf, validatePlantShifts, savePlantShifts, validateMachineProducts, saveMachineProducts, validateProductSetup, saveProductSetup, validateProductUpload, saveProductUpload, validateProductSheet, saveProductSheet, validateReport, sendReport, validateTemperature, saveTemperature, validateShiftNote, saveShiftNote, validateQuality, saveQuality, parseSetup, parseLineStatus, validateYard, saveYard, PLANT_ROLES, AREAS, areaOf, JOURNAL_TYPES, PICKUP_HEADERS, PLANT_LISTS, SETUP_LISTS, parseJournal, parsePickups, parseQueueTab, readPlant,
  validateLoad, loadValues, validatePickup, savePickup, validateUnload, saveUnload, validateReturn, saveReturn, UNKNOWN_ROUTE, validateWash, saveWash, checkinReturnId, appUnloadId,
  validateSchedule, saveSchedule, appScheduleId };
