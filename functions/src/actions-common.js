/*
 * United Dairy Distribution app: what every save file shares (split out of actions.js, review item 81 (Joe 10/13)).
 * The save error, the per-screen switch check and the write-back queue: each save also queues the sheet cells it changes.
 */
'use strict';

const L = require('./logic');
const M = require('./model');
const SWITCH = require('./switch');

const C = M.COLLECTIONS;

class SaveError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details || null; }
}

function text(v, max) { return String(v === null || v === undefined ? '' : v).trim().slice(0, max || 200); }

// Whether this screen may save in Operations (switch.js): every screen while it is a test copy, then only
// the screens an administrator moved to the new app.
async function requireTestMode(tx, db, screen) {
  const snap = await tx.get(db.collection(C.config).doc('app'));
  return SWITCH.screenMode(snap.exists ? snap.data() : {}, screen, (code, message) => new SaveError(code, message));
}

// Sheet column suffix for each day field the saves change (the reverse of model.DAY_FIELDS).
const COLUMN_FOR = {}, TIME_FIELDS = {};
// Kept in the new app only (the Live sheet has no column for them): who a day was for before the driver went off, and why.
// checkinTruck / checkinTrailer / moreTrailers: the units the driver corrected on the phone and the drop-and-hook trailers (no Live column).
const APP_ONLY = {};
M.APP_ONLY_DAY_FIELDS.forEach(f => { APP_ONLY[f] = true; });
M.DAY_FIELDS.forEach(([field, suffix, kind]) => { COLUMN_FOR[field] = suffix; if (kind === 'time') TIME_FIELDS[field] = true; });
// A day's "changed by hand" marks (the current app's <day>_equipment_override / _dispatch_time_override): a Route Master or
// Driver Master save that reaches the Live weeks leaves those cells alone (D6).
COLUMN_FOR.equipmentOverride = 'equipment_override';
COLUMN_FOR.dispatchTimeOverride = 'dispatch_time_override';

/*
 * The write-back queue: each save also adds the sheet cells it changes, in the same transaction, so a save
 * can never be in the database without its sheet update waiting (see writeback.js). Cells are named by
 * column; the row is found by run_id when it is written, never by row number.
 */
function queueSheetCells(tx, db, requestId, part, run, runDocId, day, values, stamp, email) {
  queueCells(tx, db, requestId, part, run, runDocId, dayCells(day, values, stamp, email), stamp, email);
}
// One queued row: `cells` may hold several days and the run's own columns; extra.append = a run new to the Live tab.
function queueCells(tx, db, requestId, part, run, runDocId, cells, stamp, email, extra) {
  // A one-week extra line (actions-weekly.js addExtraRun) has no Live sheet row: its saves stay in Operations.
  if (run && run.extraRun) return;
  const days = L.DAYS.filter(p => run.days && run.days[p] && run.days[p].runs);
  tx.set(db.collection(C.outbox).doc(requestId + (part ? '-' + part : '')), Object.assign({
    status: 'pending', at: stamp, by: email, requestId, runDocId, tab: run.sourceTab, weekStart: run.weekStart,
    match: { runId: run.runId || '', route: run.route || '', run: run.run || '', days }, cells
  }, extra || {}));
}
/*
 * LOADOUT HISTORY (the current app's udpoV7197RecordLoadoutHistory_): when a load is saved Done, or a Done load is corrected,
 * one row per run_id|load_date in that tab of the Live workbook, so the week tab's loading cells can be cleared later without
 * losing when the route was loaded. Written by writeback.js (the row found by history_key, else added under the last).
 */
const HISTORY_FIELDS = ['completeTime', 'loadStatus', 'casesOut', 'loadTemperature', 'plantStartedAt'];
function queueLoadoutHistory(tx, db, req, run, d, after, stamp, email) {
  if (run && run.extraRun) return;
  const t = (v) => v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v);
  const complete = t(d.completeTime), status = t(d.loadStatus).toUpperCase();
  if (!complete && status !== 'COMPLETE') return;
  if (!HISTORY_FIELDS.some(k => after[k] !== undefined)) return;
  const delivery = L.addDays(run.weekStart, L.DAYS.indexOf(req.day));
  const offset = d.loadDayOffset === null || d.loadDayOffset === undefined || d.loadDayOffset === '' ? -1 : Number(d.loadDayOffset);
  const loadDate = L.dateKey(d.loadDate) || L.addDays(delivery, offset), key = (run.runId || '') + '|' + loadDate;
  tx.set(db.collection(C.outbox).doc(req.requestId + '-h'), {
    status: 'pending', at: stamp, by: email, requestId: req.requestId, history: true, key, runDocId: req.runDocId,
    row: { archived_at: stamp, reason: 'Loadout completed', live_tab: run.sourceTab || '', live_row: t(run.sheetRow), route: t(run.route), run_id: t(run.runId), run: t(run.run),
      load_date: loadDate, delivery_date: L.dateKey(d.deliveryDate) || delivery, cases_out: t(d.casesOut), complete_time: complete, load_status: status, loaded_complete: t(d.loadedComplete),
      load_temperature: t(d.loadTemperature), written_by: email, source_note: '', source_written_at: '', history_key: key, started_at: t(d.plantStartedAt) }
  });
}
function dayCells(day, values, stamp, email) {
  const cells = {};
  Object.keys(values).forEach(field => {
    if (APP_ONLY[field]) return;
    if (!COLUMN_FOR[field]) throw new Error('No sheet column for ' + field);
    let v = values[field];
    if (TIME_FIELDS[field]) v = L.timeText(v);
    if (typeof v === 'boolean') v = v ? 'TRUE' : 'FALSE';
    // Numbers stay numbers so the sheet keeps them as numbers; everything else is written as plain text.
    cells[day + '_' + COLUMN_FOR[field]] = v === null || v === undefined ? '' : typeof v === 'number' ? v : String(v);
  });
  cells[day + '_updated_at'] = stamp;
  cells[day + '_updated_by'] = email;
  return cells;
}

module.exports = { SaveError, text, requireTestMode, queueSheetCells, queueCells, queueLoadoutHistory, dayCells, TIME_FIELDS };
