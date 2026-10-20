/*
 * United Dairy Distribution app: Publish moves the Live sheet's weeks (Joe 10/16: "Let Operations' Publish move the weeks in the
 * real Live sheet, the same way the old app's Publish does").
 *
 * The current app's Publish (046_V743_WeeklyLifecycle.gs udpoV743MaintainDriverWeekLifecycle_(true)):
 *   1. the old Previous week is saved to DISPATCH WEEK HISTORY, once per week (215_V7259 udpoV7259ArchiveWeek_);
 *   2. LIVE CURRENT WEEK is copied over LIVE PREVIOUS WEEK, and LIVE NEXT WEEK over LIVE CURRENT WEEK (udpoV743CopyLiveSheetValues_);
 *   3. the new Current week's blank drivers, trucks and trailers are filled;
 *   4. LIVE NEXT WEEK is emptied below its headers and seeded with one row per Route Master run for the new Next week
 *      (udpoV701SeedWeekIfEmpty_ / udpoV701LiveSeedValue_), with the drivers and units from Driver Master and Equipment Master.
 * Here all four go to Google in ONE spreadsheets.batchUpdate, which Google applies all together or not at all, so the copy
 * (transfer.js) and the current app never read a half-moved workbook. The fills and the new Next week's drivers and units are
 * the ones weekroll.planRoll works out, so the sheet and the weeks in Operations match.
 *
 * Before it moves anything: the saves still waiting for the sheet are written first, and the sheet's three tabs must hold the
 * weeks Operations holds. If the sheet already holds the new weeks (someone pressed Publish in the current app), nothing is
 * written and Publish in Operations just catches up.
 */
'use strict';

const L = require('./logic');
const M = require('./model');
const C = M.COLLECTIONS;
const { assertLiveTarget, findRow, weekOf } = require('./writeback');
const ROLL = require('./weekroll');

const TABS = M.LIVE_TABS;
const HISTORY_TAB = 'DISPATCH WEEK HISTORY';
// 215_V7259 UDPO_V7259_HISTORY.HEADERS, in order.
const HISTORY_HEADERS = Object.freeze(['week_start', 'day_prefix', 'load_date', 'delivery_date', 'facility_id', 'route_id', 'run_id', 'stream_id', 'route', 'route_name', 'run', 'run_display',
  'movement_type', 'coverage_type', 'coverage_owner', 'route_status', 'loadout_type', 'scheduled', 'load_sequence', 'driver_id', 'driver', 'truck_id', 'truck', 'trailer_id', 'trailer',
  'pallet_jack', 'departure_date', 'departure_time', 'route_hours', 'calculated_return_time', 'return_day_offset', 'miles', 'driver_notes', 'load_day_offset',
  'show_daily', 'show_weekly', 'weekly_sequence', 'archived_at']);
// The current app ends a week's rows at its first marker row (udpoV743CopyLiveSheetValues_).
const MARKERS = ['DAILY_ROW', 'DAILY_META', 'WEEKLY_ROUTE', 'WEEKLY_META'];
// Identity columns the Live tabs keep as plain text (format @).
const TEXT_COLUMNS = new Set(['facility_id', 'stream_id', 'route_id', 'route', 'route_name', 'run_id', 'run']);
// 006_V7000 UDPO_ROUTE_BASE_FIELDS: taken from Route Master as they are, even blank.
const BASE_FIELDS = new Set(['route_id', 'run_id', 'route', 'route_name', 'run', 'route_run_type', 'load_type', 'movement_type', 'coverage_type', 'dedicated_type', 'route_status', 'active',
  'display_route_master', 'display_daily_dispatch', 'display_weekly_dispatch', 'display_plant_distribution', 'display_mobile_route', 'route_notes',
  'route_extra_01', 'route_extra_02', 'route_extra_03', 'route_extra_04', 'route_extra_05', 'stream_id', 'facility_id']);
const BASE_ALIASES = { route: ['route', 'route_code'], route_name: ['route_name', 'route'], run: ['run', 'run_code', 'load_label'], movement_type: ['movement_type'],
  coverage_type: ['coverage_type'], route_status: ['route_status'], load_type: ['loadout_type'], display_plant_distribution: ['show_in_plant'],
  display_weekly_dispatch: ['show_on_weekly_dispatch'], display_daily_dispatch: ['show_on_daily_dispatch'] };
const DAY_ALIASES = { runs: ['runs', 'active'], load_sequence: ['load_sequence', 'load_order'], departure_time: ['departure_time', 'dispatch_time', 'start_time'],
  dispatch_time: ['dispatch_time', 'start_time'], start_time: ['start_time', 'dispatch_time'], route_hours: ['route_hours', 'expected_route_hours'], miles: ['miles'],
  load_day_offset: ['load_day_offset'], truck: ['truck', 'tractor_default'], trailer: ['trailer', 'trailer_default'], forklift: ['forklift', 'forklift_default'],
  pallet_jack: ['pallet_jack', 'forklift_default'], driver: ['driver'], driver_id: ['driver_id'] };
// The day fields the fills and the new Next week's drivers and units write (model.DAY_FIELDS columns).
const UNIT_COLUMNS = { driverId: 'driver_id', driver: 'driver', truckId: 'tractor_id', truck: 'truck', trailerId: 'trailer_id', trailer: 'trailer' };

class RollError extends Error { constructor(code, message) { super(message); this.code = code; } }

const text = (v) => v === null || v === undefined ? '' : String(v).trim();
const dayName = (key) => L.DAY_NAMES[new Date(key + 'T12:00:00Z').getUTCDay()];

// The rows a copy takes: headers and every row down to the first marker row (or the last row with anything in it).
function usedRows(values) {
  const rows = values || [];
  for (let i = M.LIVE_HEADER_ROW; i < rows.length; i++) if (MARKERS.indexOf(text((rows[i] || [])[0]).toUpperCase()) >= 0) return i;
  return Math.max(M.LIVE_HEADER_ROW, rows.length);
}

// Google's day number for a date (days since 1899-12-30).
function serial(key) { const [y, m, d] = key.split('-').map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; }
const DATE = { type: 'DATE', pattern: 'yyyy-mm-dd' }, TIME = { type: 'TIME', pattern: 'h:mm:ss AM/PM' }, TEXT = { type: 'TEXT', pattern: '@' };
// udpoV7186LooksLikeCode_: a code such as 6301-1, 12-3 or 4/2 stays text instead of becoming a date.
const looksLikeCode = (v) => /^\s*\d+\s*[-/.]\s*\d+(\s*[-/.]\s*\d+)?\s*$/.test(v) && !/^\s*\d{4}-\d{2}-\d{2}\s*$/.test(v) && !/^\s*\d+\.\d+\s*$/.test(v);

/*
 * One cell as the current app's setValues stores it: a date key a date, a time a time of day, TRUE/FALSE a tick value, a plain
 * number a number, a code or an identity column text, anything else as written. Blank clears the cell.
 */
function cellData(column, value) {
  const t = text(value);
  if (!t) return {};
  if (TEXT_COLUMNS.has(column) || looksLikeCode(t)) return { userEnteredValue: { stringValue: t }, userEnteredFormat: { numberFormat: TEXT } };
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return { userEnteredValue: { numberValue: serial(t) }, userEnteredFormat: { numberFormat: DATE } };
  const tm = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/);
  if (tm && /_time$/.test(column)) {
    let h = Number(tm[1]) % (tm[4] ? 12 : 24);
    if (tm[4] && /p/i.test(tm[4])) h += 12;
    return { userEnteredValue: { numberValue: (h * 3600 + Number(tm[2]) * 60 + Number(tm[3] || 0)) / 86400 }, userEnteredFormat: { numberFormat: TIME } };
  }
  if (/^(true|false)$/i.test(t)) return { userEnteredValue: { boolValue: /^true$/i.test(t) } };
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(t)) return { userEnteredValue: { numberValue: Number(t) } };
  return { userEnteredValue: { stringValue: t } };
}
const FIELDS = 'userEnteredValue,userEnteredFormat.numberFormat';
const one = (sheetId, row, col, cell) => ({ updateCells: { start: { sheetId, rowIndex: row, columnIndex: col }, rows: [{ values: [cell] }], fields: FIELDS } });

// udpoV701MasterFirst_: the first of the Route Master columns that is filled.
function masterFirst(cells, names) { for (const n of names) { const v = text(cells[n]); if (v) return v; } return ''; }

/*
 * One Live column of a new Next week row from the run's Route Master row (udpoV701LiveSeedValue_), with the day's driver and
 * units from the run Operations built (Driver Master's standard runs and Equipment Master, as the current app's fill passes).
 */
function seedValue(key, cells, week, built) {
  if (key === 'route' && cells.route_code !== undefined) return text(cells.route_code);
  if (BASE_FIELDS.has(key) && cells[key] !== undefined) return text(cells[key]);
  if (key === 'week_signature' || key === 'week_start' || key === 'week_start_date') return week;
  const direct = text(cells[key]);
  const day = key.match(/^(sun|mon|tue|wed|thu|fri|sat)_(.+)$/);
  if (day && built) {
    const d = (built.days || {})[day[1]] || {}, f = Object.keys(UNIT_COLUMNS).find(k => UNIT_COLUMNS[k] === day[2]);
    if (f && d.runs && text(d[f])) return text(d[f]);
  }
  if (direct) return direct;
  if (BASE_ALIASES[key]) return masterFirst(cells, BASE_ALIASES[key]);
  if (!day) return '';
  const p = day[1], field = day[2], i = L.DAYS.indexOf(p);
  const raw = masterFirst(cells, [p + '_load_day_offset']), n = String(raw).trim() === '' ? 0 : L.dayOffset(raw), offset = n === null ? -1 : n;
  const delivery = L.addDays(week, i), load = L.addDays(delivery, offset);
  if (field === 'delivery_date' || field === 'dispatch_date' || field === 'departure_date') return delivery;
  if (field === 'delivery_day' || field === 'departure_day') return L.DAY_NAMES[i];
  if (field === 'load_date') return load;
  if (field === 'load_day') return dayName(load);
  if (field === 'return_day_offset') return '0';
  if (field === 'load_day_offset') return String(offset);
  if (field === 'load_sequence_override') return masterFirst(cells, [p + '_load_sequence', p + '_load_order']);
  if (DAY_ALIASES[field]) return masterFirst(cells, DAY_ALIASES[field].map(a => p + '_' + a));
  return '';
}

// The old Previous week's rows for DISPATCH WEEK HISTORY: one per run and day, all as text (udpoV7259ArchiveWeek_).
function historyRows(values, week, routes, stamp) {
  const rows = values || [], header = (rows[M.LIVE_HEADER_ROW - 1] || []).map(M.normalizeHeader), out = [];
  const get = (r, c) => { const i = header.indexOf(c); return i < 0 ? '' : text(r[i]); };
  const flag = (v, blankMeans) => { const t = text(v).toUpperCase(); return (t === '' ? blankMeans : t === 'TRUE' || t === '1' || t === 'YES') ? 'TRUE' : 'FALSE'; };
  rows.slice(M.LIVE_HEADER_ROW, usedRows(rows)).forEach(r => {
    const runId = get(r, 'run_id');
    if (!runId) return;
    const m = routes[runId] || null, mc = (m && m.cells) || {};
    const showWeekly = text(mc.display_weekly_dispatch) ? flag(mc.display_weekly_dispatch, true) : flag(get(r, 'display_weekly_dispatch'), true);
    L.DAYS.forEach((p, i) => {
      const d = (c) => get(r, p + '_' + c);
      out.push([week, p, L.dateKey(d('load_date')) || '', L.dateKey(d('delivery_date')) || L.addDays(week, i), get(r, 'facility_id'), get(r, 'route_id'), runId, get(r, 'stream_id'),
        get(r, 'route'), get(r, 'route_name'), get(r, 'run'), (m && m.run) || get(r, 'run'), get(r, 'movement_type'), get(r, 'coverage_type'), get(r, 'coverage_owner'), get(r, 'route_status'),
        get(r, 'load_type'), L.yes(d('runs')) ? 'TRUE' : 'FALSE', d('load_sequence_override') || d('load_sequence'), d('driver_id'), d('driver'), d('tractor_id'), d('truck'), d('trailer_id'), d('trailer'),
        d('pallet_jack'), L.dateKey(d('departure_date')) || '', d('departure_time') || d('dispatch_time') || d('start_time'), d('route_hours'), d('calculated_return_time'), d('return_day_offset'),
        d('miles'), d('driver_notes'), d('load_day_offset'), flag(get(r, 'display_daily_dispatch'), true), showWeekly,
        m && m.weekOrder !== null && m.weekOrder !== undefined ? String(m.weekOrder) : '999999', stamp]);
    });
  });
  return out;
}
const textRow = (row) => ({ values: row.map(v => text(v) ? { userEnteredValue: { stringValue: text(v) }, userEnteredFormat: { numberFormat: TEXT } } : { userEnteredFormat: { numberFormat: TEXT } }) });

/*
 * The requests that move the weeks, from what was read: `values` {previous, current, next, history} (formatted, as the copy reads
 * them), `grid` {tab title: {sheetId, rows, cols}}, `plan` (weekroll.planRoll). Returns {requests, summary}.
 */
function rollRequests({ values, grid, live, plan, stamp }) {
  const requests = [], summary = { archived: 0, filled: 0, seeded: 0 };
  const ensure = (title, rows, cols) => {
    const g = grid[title];
    if (rows > g.rows) { requests.push({ appendDimension: { sheetId: g.sheetId, dimension: 'ROWS', length: rows - g.rows } }); g.rows = rows; }
    if (cols > g.cols) { requests.push({ appendDimension: { sheetId: g.sheetId, dimension: 'COLUMNS', length: cols - g.cols } }); g.cols = cols; }
  };
  const label = (title, week) => requests.push(one(grid[title].sheetId, 1, 1, cellData('week_start', week)));

  // 1. The week leaving the Live window, saved once.
  if (live.previous && values.previous) {
    const hist = grid[HISTORY_TAB], have = (values.history || []).slice(1).some(r => L.dateKey(text((r || [])[0])) === live.previous);
    const rows = have ? [] : historyRows(values.previous, live.previous, plan.routes, stamp);
    if (rows.length) {
      if (!hist) {
        const sheetId = 1000000000 + Math.floor(Math.random() * 900000000);
        requests.push({ addSheet: { properties: { sheetId, title: HISTORY_TAB, gridProperties: { frozenRowCount: 1, rowCount: 1000, columnCount: HISTORY_HEADERS.length } } } });
        requests.push({ appendCells: { sheetId, rows: [textRow(HISTORY_HEADERS)], fields: FIELDS } });
        grid[HISTORY_TAB] = { sheetId, rows: 1000, cols: HISTORY_HEADERS.length };
      }
      requests.push({ appendCells: { sheetId: grid[HISTORY_TAB].sheetId, rows: rows.map(textRow), fields: FIELDS } });
      summary.archived = rows.length;
    }
  }

  // 2. Current over Previous, Next over Current: values and formats, the rest of the tab emptied.
  const copy = (from, to, src) => {
    const rows = usedRows(src), cols = grid[from].cols;
    ensure(to, rows, cols);
    requests.push({ updateCells: { range: { sheetId: grid[to].sheetId, startRowIndex: 0, endRowIndex: grid[to].rows, startColumnIndex: 0, endColumnIndex: grid[to].cols }, fields: 'userEnteredValue' } });
    requests.push({ copyPaste: { source: { sheetId: grid[from].sheetId, startRowIndex: 0, endRowIndex: rows, startColumnIndex: 0, endColumnIndex: cols },
      destination: { sheetId: grid[to].sheetId, startRowIndex: 0, endRowIndex: rows, startColumnIndex: 0, endColumnIndex: cols }, pasteType: 'PASTE_NORMAL', pasteOrientation: 'NORMAL' } });
  };
  copy(TABS.current, TABS.previous, values.current);
  label(TABS.previous, plan.weeks.previous);
  copy(TABS.next, TABS.current, values.next);
  label(TABS.current, plan.weeks.current);

  // 3. The new Current week's filled blanks, on the rows the Next tab had (the copy keeps every row where it was).
  const nextHeader = (values.next[M.LIVE_HEADER_ROW - 1] || []).map(M.normalizeHeader);
  plan.fills.forEach(([, run, days]) => {
    const found = findRow(values.next, { weekStart: plan.weeks.current, match: { runId: run.runId || '', route: run.route || '', run: run.run || '', days: L.DAYS.filter(p => run.days && run.days[p] && run.days[p].runs) } });
    if (found.rows.length !== 1) return;
    Object.keys(days).forEach(p => Object.keys(days[p]).forEach(f => {
      const col = UNIT_COLUMNS[f] ? nextHeader.indexOf(p + '_' + UNIT_COLUMNS[f]) : -1;
      if (col < 0) return;
      requests.push(one(grid[TABS.current].sheetId, found.rows[0], col, cellData(UNIT_COLUMNS[f], days[p][f])));
      summary.filled++;
    }));
  });

  // 4. The new Next week: emptied below its headers, then one row per Route Master run.
  const g = grid[TABS.next];
  requests.push({ updateCells: { range: { sheetId: g.sheetId, startRowIndex: M.LIVE_HEADER_ROW, endRowIndex: g.rows, startColumnIndex: 0, endColumnIndex: g.cols }, fields: 'userEnteredValue' } });
  label(TABS.next, plan.weeks.next);
  const existing = {};
  plan.nextRuns.docs.forEach(s => { existing[s.data().runId] = s.data(); });
  // In Route Master's order, as the current app seeds them.
  const seed = Object.values(plan.routes).filter(r => text(r.id) && (text((r.cells || {}).route_id) || text(r.routeId)))
    .sort((a, b) => (a.sheetRow || 0) - (b.sheetRow || 0)).map(route => {
    const built = plan.built[M.runDocId(plan.weeks.next, route.id)] || existing[route.id] || null;
    return nextHeader.map(key => key ? seedValue(key, Object.assign({ run_id: route.id }, route.cells || {}), plan.weeks.next, built) : '');
  });
  if (seed.length) {
    ensure(TABS.next, M.LIVE_HEADER_ROW + seed.length, nextHeader.length);
    requests.push({ updateCells: { start: { sheetId: g.sheetId, rowIndex: M.LIVE_HEADER_ROW, columnIndex: 0 }, rows: seed.map(row => ({ values: row.map((v, c) => cellData(nextHeader[c], v)) })), fields: FIELDS } });
  }
  summary.seeded = seed.length;
  return { requests, summary };
}

/*
 * The whole move. deps = {sheets ({tabs, batchGet, structure}), spreadsheetId, allowRealLive, flush (writes the waiting saves)}.
 * `live` is config/app liveWeeks, already checked to have req.weekStart as its Next week. Returns {already} or {summary}.
 */
async function rollLiveSheet(db, deps, live, stamp, email) {
  assertLiveTarget(deps.spreadsheetId, deps.allowRealLive);
  // One Publish at a time (two people pressing it together).
  const lock = db.collection('private').doc('publishLock');
  const got = await db.runTransaction(async tx => { const l = (await tx.get(lock)).data(); if (l && l.until > stamp) return false; tx.set(lock, { until: new Date(Date.parse(stamp) + 3 * 60000).toISOString(), by: email, week: live.next }); return true; });
  if (!got) throw new RollError('CHANGED', 'Someone else is publishing right now. Wait a minute, then open Weekly Dispatch again.');
  try {
    // Saves still on their way to the sheet go first, so none lands on the wrong week's tab.
    const waiting = () => db.collection(C.outbox).where('status', 'in', ['pending', 'writing']).limit(1).get();
    for (let i = 0; i < 8 && !(await waiting()).empty; i++) {
      try { await deps.flush(); } catch (e) { /* tried again below */ }
      if (!(await waiting()).empty) await new Promise(r => setTimeout(r, 1500));
    }
    if (!(await waiting()).empty) throw new RollError('NOT_ALLOWED', 'Some saves are still going to the Live sheet, so the weeks were not moved. Press Publish again in a minute.');

    const tabs = await deps.sheets.tabs(deps.spreadsheetId), grid = {};
    tabs.forEach(t => { grid[t.title] = { sheetId: t.sheetId, rows: t.rows, cols: t.cols }; });
    [TABS.previous, TABS.current, TABS.next].forEach(t => { if (!grid[t]) throw new RollError('NOT_ALLOWED', 'The Live sheet has no ' + t + ' tab, so the weeks were not moved. Ask the administrator.'); });
    const ranges = [TABS.previous, TABS.current, TABS.next].map(t => "'" + t + "'").concat(grid[HISTORY_TAB] ? ["'" + HISTORY_TAB + "'!A:A"] : []);
    const read = await deps.sheets.batchGet(deps.spreadsheetId, ranges);
    const values = { previous: read[0], current: read[1], next: read[2], history: read[3] || [] };
    const weeks = { previous: weekOf(values.previous), current: weekOf(values.current), next: weekOf(values.next) };
    if (weeks.current === live.next && weeks.next === L.addDays(live.next, 7)) return { already: true, sheetWeeks: weeks };
    if (weeks.current !== live.current || weeks.next !== live.next) {
      throw new RollError('CHANGED', 'The Live sheet holds the weeks of ' + [weeks.previous, weeks.current, weeks.next].map(k => k ? shortDate(k) : '?').join(', ') + ', not the weeks shown here. Nothing was moved. Wait a minute for Operations to catch up with the sheet, then open Weekly Dispatch again.');
    }
    const plan = await ROLL.planRoll({ get: (q) => q.get() }, db, live, stamp, email);
    const { requests, summary } = rollRequests({ values, grid, live, plan, stamp });
    await deps.sheets.structure(deps.spreadsheetId, requests);
    return { summary, sheetWeeks: plan.weeks };
  } finally {
    await lock.delete().catch(() => {});
  }
}

function shortDate(k) { const [y, m, d] = String(k).split('-').map(Number); return m + '-' + d + '-' + String(y).slice(2); }

module.exports = { rollLiveSheet, rollRequests, seedValue, cellData, historyRows, weekOf, usedRows, serial, RollError, HISTORY_TAB, HISTORY_HEADERS };
