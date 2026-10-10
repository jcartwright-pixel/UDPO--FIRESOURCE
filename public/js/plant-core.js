/*
 * United Dairy New Plant Operations: the plant side's shared rules for the screens (Loadout Center, Departments, ...).
 *
 * The same rules as the current app's plant screens:
 *   - a load's area comes from the run's load type (desktopV5063LoadoutTypeToArea_): CASE, TOTES, BOXING or TANKER;
 *   - the Loadout Center shows the day's loads plus yesterday's loads that were not finished, prior-day first, then
 *     load order, then route (udpoV780PlantLoadingRows_ / udpoV780PlantLoadingSort_);
 *   - Done = an End time, a stored COMPLETE / READY / LOADED, or the loaded tick; Loading = a Start time without an End;
 *   - Behind = not done 30 minutes after its depart time (217_V7271_PlantCurrentReport.gs BEHIND_MINUTES);
 *   - a pickup (product that did not load at loadout) is open until it is marked complete, and shows red.
 */
const L = window.UDLogic;

export const AREAS = ['CASE', 'TOTES', 'BOXING', 'TANKER'];
export const AREA = {
  CASE: { title: 'Daily Case Loadout', tile: 'Cases', label: 'Cases Out', unit: 'cases', color: '#1976d2', inLabel: 'Cases In' },
  TOTES: { title: 'Daily Tote Loadout', tile: 'Totes', label: 'Totes Out', unit: 'totes', color: '#7b35b5', inLabel: 'Totes In' },
  BOXING: { title: 'Daily Box Loadout', tile: 'Boxes', label: 'Boxes Out', unit: 'boxes', color: '#f28a00', inLabel: 'Boxes In' },
  TANKER: { title: 'Daily Tanker Loadout', tile: 'Tanker', label: 'Quantity Out', unit: 'gallons', color: '#159149', inLabel: 'Gallons In' }
};
export const BEHIND_MINUTES = 30;

export function areaOf(loadType) {
  const t = String(loadType || '').trim().toUpperCase();
  if (t === 'CASE LOADOUT' || t === 'CASE') return 'CASE';
  if (t === 'TOTE' || t === 'TOTES' || t === 'TOTE LOADOUT') return 'TOTES';
  if (t === 'BOXING' || t === 'BOX' || t === 'BOXES' || t === 'BOX LOADOUT') return 'BOXING';
  if (t === 'TANKER' || t === 'TANKER LOADOUT') return 'TANKER';
  return '';
}

// The plant shows a run unless Route Master or the Live row turns it off for the plant, or the route is retired.
function shownForPlant(run) {
  if (String(run.routeStatus || '').toUpperCase() === 'INACTIVE' || run.active === false) return false;
  return run.displayPlant !== false;
}

// WAITING / LOADING / DONE (a stored READY counts as done, Joe 7.0.272).
export function loadState(day) {
  const s = String(day.loadStatus || '').trim().toUpperCase();
  if (day.completeTime || day.loadedComplete === true || ['COMPLETE', 'COMPLETED', 'LOADED', 'READY'].indexOf(s) >= 0) return 'DONE';
  if (day.plantStartedAt || s === 'LOADING' || s === 'PAUSED') return 'LOADING';
  return 'WAITING';
}

function rowFor(run, block, loadDate, prior) {
  const day = run.days[block.prefix];
  return {
    id: run.id + '|' + block.prefix, runDocId: run.id, day: block.prefix, weekStart: run.weekStart, rev: run.rev || 0,
    route: run.route || '', run: run.run || '', routeId: run.routeId || '', runId: run.runId || '', area: areaOf(run.loadType),
    loadDate, deliveryDate: block.deliveryDate, prior, loadSequence: L.effectiveSequence(day),
    driver: day.driver || '', truck: day.truck || '', trailer: day.trailer || '', dispatchTime: day.dispatchTime,
    quantity: day.casesOut, temperature: day.loadTemperature, notes: day.plantNotes || '', shift: day.plantShift || '',
    startedAt: day.plantStartedAt || '', completedAt: day.completeTime || '', state: loadState(day)
  };
}

const byLoad = (a, b) => (Number(b.prior) - Number(a.prior)) || String(a.loadDate).localeCompare(String(b.loadDate)) ||
  (Number(a.loadSequence == null ? 999999 : a.loadSequence) - Number(b.loadSequence == null ? 999999 : b.loadSequence)) ||
  String(a.route).localeCompare(String(b.route), undefined, { numeric: true });

// Every load for the plant on `date` (all areas), plus yesterday's loads that are not done yet.
export function loadoutRows(runs, date) {
  const out = [], yesterday = L.addDays(date, -1);
  (runs || []).forEach(run => {
    if (!shownForPlant(run) || !areaOf(run.loadType)) return;
    L.loadBlocksFor(run, date).forEach(b => out.push(rowFor(run, b, date, false)));
    L.loadBlocksFor(run, yesterday).forEach(b => { const r = rowFor(run, b, yesterday, true); if (r.state !== 'DONE') out.push(r); });
  });
  return out.sort(byLoad);
}

export function nowMinutes(now) {
  const parts = {};
  new Intl.DateTimeFormat('en-US', { timeZone: L.TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now || new Date()).forEach(p => { parts[p.type] = p.value; });
  return Number(parts.hour) * 60 + Number(parts.minute);
}

// Behind: today's load (or a prior-day load) not done 30 minutes after its depart time.
export function isBehind(row, today, now) {
  if (row.state === 'DONE') return false;
  if (row.prior || row.loadDate < today) return true;
  if (row.loadDate > today || row.dispatchTime === null || row.dispatchTime === undefined) return false;
  return nowMinutes(now) > row.dispatchTime + BEHIND_MINUTES;
}

export function pickupOpen(p) { return ['COMPLETE', 'COMPLETED', 'CLOSED'].indexOf(String(p.status || '').toUpperCase()) < 0; }

// Pickups for a load: same run and the load's date (or the delivery date the current app sometimes stored).
export function pickupsFor(row, pickups) {
  return (pickups || []).filter(p => (p.runDocId ? p.runDocId === row.runDocId && (!p.day || p.day === row.day) : String(p.runId) === String(row.runId)) &&
    (p.date === row.loadDate || p.date === row.deliveryDate));
}

export function counts(rows) {
  const c = { total: rows.length, done: 0, loading: 0, waiting: 0, prior: 0, quantity: 0 };
  rows.forEach(r => {
    c[r.state === 'DONE' ? 'done' : r.state === 'LOADING' ? 'loading' : 'waiting']++;
    if (r.prior) c.prior++;
    const n = Number(String(r.quantity == null ? '' : r.quantity).replace(/,/g, ''));
    if (isFinite(n)) c.quantity += n;
  });
  return c;
}

// "4:30 AM" from minutes of the day; "" when not set.
export function timeOfDay(minutes) { return minutes === null || minutes === undefined ? '' : L.timeText(minutes); }

// A stored time stamp shown as the plant's clock time.
export function clock(stamp) {
  if (!stamp) return '';
  const t = Date.parse(stamp);
  if (!isFinite(t)) return String(stamp);
  return new Intl.DateTimeFormat('en-US', { timeZone: L.TIME_ZONE, hour: 'numeric', minute: '2-digit' }).format(new Date(t));
}

// Minutes between Start and End (or now while loading).
export function minutesTaken(row, now) {
  if (!row.startedAt) return null;
  const a = Date.parse(row.startedAt), b = row.completedAt ? Date.parse(row.completedAt) : (now || new Date()).getTime();
  return isFinite(a) && isFinite(b) && b >= a ? Math.round((b - a) / 60000) : null;
}

// "38 min", or "2 h 05 min" once it runs past two hours.
export function minutesText(m) {
  if (m === null || m === undefined) return '';
  return m < 120 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min';
}

// "yyyy-mm-ddTHH:MM" in plant time from a stamp, for a time box; and back.
export function stampToLocal(stamp) {
  if (!stamp) return '';
  const t = Date.parse(stamp);
  if (!isFinite(t)) return '';
  const parts = {};
  new Intl.DateTimeFormat('en-US', { timeZone: L.TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(t)).forEach(p => { parts[p.type] = p.value; });
  return parts.year + '-' + parts.month + '-' + parts.day + 'T' + parts.hour + ':' + parts.minute;
}
export function localToStamp(local) {
  if (!local) return '';
  // New York is 4 or 5 hours behind UTC; try both and keep the one that reads back the same.
  for (const off of [4, 5]) {
    const guess = new Date(Date.parse(local + ':00Z') + off * 3600000).toISOString();
    if (stampToLocal(guess) === local) return guess;
  }
  return new Date(Date.parse(local + ':00Z') + 5 * 3600000).toISOString();
}

/* ---------- Unloading & Washing, Product Returns, Truck Washing ---------- */
// The shared rules (js/plant-rules.js, the same file the server uses).
const U = window.UDPlant;
export const UNLOAD_UNIT = { CASE: 'Cases', TOTES: 'Totes', BOXING: 'Boxes', TANKER: 'Gallons' };
export const UNLOAD_TILE = { CASE: 'Cases', TOTES: 'Totes', BOXING: 'Boxes', TANKER: 'Tankers' };
const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
const reported = (v) => !!txt(v) && !L.noWriteUp(v);

/*
 * Product returns for one date (getDesktopUiProductReturnsCurrent): the plant journal's RETURN records, plus every driver
 * check-in that reported cases back or refused / returned product. Pending until RTA (put back in the cooler, never dumped).
 */
export function returnsFor(runs, date, journal) {
  const removed = {}, unloads = U.latestUnloads(journal, date), out = [];
  Object.keys(unloads).forEach(k => unloads[k].removed.forEach(id => { removed[id] = true; }));
  (journal || []).forEach(d => {
    if (String(d.type || '').toUpperCase() !== 'RETURN' || d.date !== date) return;
    const p = d.payload || {};
    out.push({ id: d.recordId, source: 'RETURN', route: txt(p.route || d.route), run: txt(p.run || d.run), trailer: txt(p.trailer || d.trailer), cases: txt(p.casesReturned || p.quantity || d.quantity),
      refused: !!p.refusedReturned, detail: txt(p.notes || p.description || d.notes) || 'Returned product reported', recordedAt: d.recordedAt || '' });
  });
  const prefix = L.dayPrefix(date), week = L.weekStart(date);
  (runs || []).forEach(run => {
    const d = run.weekStart === week && run.days && run.days[prefix];
    if (!d || !d.runs) return;
    const cases = Number(String(d.driverCaseReturn == null ? '' : d.driverCaseReturn).replace(/,/g, '')) || 0, refused = reported(d.refusedReturned);
    if (cases <= 0 && !refused) return;
    out.push({ id: 'CHECKIN|' + run.id + '|' + prefix, source: 'DRIVER CHECK-IN', runDocId: run.id, day: prefix, route: txt(run.route), run: txt(run.run), trailer: txt(d.trailer), cases: cases ? String(cases) : '',
      refused, detail: [txt(d.refusedReturned), txt(d.refusedReturnedSource)].filter(Boolean).join(' · ') || txt(d.checkinNotes) || 'Returned product reported at driver check-in', recordedAt: d.checkinCompletedAt || '' });
  });
  out.forEach(x => { x.pending = !removed[x.id]; });
  return out.sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)) || String(a.route).localeCompare(String(b.route), undefined, { numeric: true }));
}

/*
 * Open wash items on a date (udpoInboundWashingRows_ plus the unloading rule): the wash requests on WASH / CLEANING LIVE
 * (the sheet's copy and the ones the app's check-ins made) reported on or before the date and not done, and each trailer
 * unloaded that day with its number typed, until a wash of it is recorded after the unload ended.
 * sheet / app = docs with _list and _id (where they live, so a Wash press can close them).
 */
export function washItems(date, sheet, app, journal) {
  const out = [], byRecord = {};
  (sheet || []).concat(app || []).forEach(w => {
    if (String(w.kind || 'WASH').toUpperCase() !== 'WASH' || !U.washOpen(w.status)) return;
    const on = L.dateKey(w.service_date) || w.date || '';
    if (!on || on > date) return;
    const ref = { list: w._list, id: w._id };
    if (byRecord[w.record_id]) { byRecord[w.record_id].refs.push(ref); return; }
    const item = { id: 'REQ|' + w.record_id, kind: 'REQUEST', trailer: txt(w.unit_number), route: '', run: '', runId: txt(w.run_id), need: txt(w.wash_reason || w.issue_details || w.notes) || 'Cleaning requested',
      reported: w.opened_at || on, refs: [ref] };
    byRecord[w.record_id] = item;
    out.push(item);
  });
  const done = U.washesDone(journal), unloads = U.latestUnloads(journal, date);
  Object.keys(unloads).forEach(k => {
    const u = unloads[k], unit = U.unitKey(u.trailer);
    if (!u.completedAt || !unit) return;
    if (done[unit] && U.when(done[unit].completedAt) >= U.when(u.completedAt)) return;
    out.push({ id: 'UNLOAD|' + k, kind: 'UNLOAD', trailer: txt(u.trailer), route: u.route, run: u.run, need: 'Trailer washing required after unloading', reported: u.completedAt, refs: [] });
  });
  return out;
}

// The wash items that belong to an unloading row: its own route and run, or (for a request with no run) the same trailer.
export function washesForRow(row, items) {
  const unit = U.unitKey(row.trailer || row.truck);
  return (items || []).filter(w => (w.route || w.run ? w.route === row.route && w.run === row.run : (w.runId && w.runId === row.runId) || (!!unit && U.unitKey(w.trailer) === unit)));
}

/*
 * Trailers back on `date`: every load delivering that day (Joe: unloading counts all routes delivering today), with the
 * unloading record kept for it, its returns, and the next load that needs the same trailer (loads = loadoutRows of the date).
 */
export function unloadRows(runs, date, journal, returns, loads) {
  const prefix = L.dayPrefix(date), week = L.weekStart(date), unloads = U.latestUnloads(journal, date), done = U.washesDone(journal), rows = [];
  (runs || []).forEach(run => {
    const area = areaOf(run.loadType), d = run.weekStart === week && run.days && run.days[prefix];
    if (!area || !shownForPlant(run) || !d || !d.runs) return;
    const key = U.unloadKey(date, run.route, run.run), u = unloads[key] || {};
    const trailer = u.trailer !== undefined && u.trailer !== '' ? u.trailer : run.dropAndHook ? '' : txt(d.trailer);
    const mine = (returns || []).filter(x => (x.runDocId ? x.runDocId === run.id : x.route === txt(run.route) && x.run === txt(run.run)));
    const unit = U.unitKey(trailer || d.truck), wash = done[unit];
    rows.push({ id: key, key, runDocId: run.id, day: prefix, route: txt(run.route), run: txt(run.run), runId: run.runId || '', area, driver: d.driver || '', truck: txt(d.truck), trailer,
      trailerTyped: u.trailer !== undefined && u.trailer !== '', dropAndHook: !!run.dropAndHook, casesIn: u.casesIn === undefined || u.casesIn === null ? '' : String(u.casesIn),
      startedAt: u.startedAt || '', completedAt: u.completedAt || '', notes: u.notes || '', status: u.status || 'WAITING', returns: mine, pendingReturns: mine.filter(x => x.pending),
      washed: !!(wash && (!u.completedAt || U.when(wash.completedAt) >= U.when(u.completedAt))), checkedIn: !!d.checkinCompletedAt, nextLoad: null, nextRank: 999999 });
  });
  // When each trailer is next needed: the first unfinished load (in loading order) that uses the same unit.
  (loads || []).forEach((l, i) => {
    if (l.state === 'DONE') return;
    const unit = U.unitKey(l.trailer || l.truck);
    if (!unit) return;
    rows.forEach(r => {
      if (r.nextLoad || U.unitKey(r.trailer || (r.dropAndHook ? '' : r.truck)) !== unit || (l.prior && l.runDocId === r.runDocId)) return;
      r.nextLoad = { route: l.route, run: l.run, time: timeOfDay(l.dispatchTime) }; r.nextRank = i;
    });
  });
  const order = { UNLOADING: 0, WAITING: 2, COMPLETE: 3 };
  return rows.sort((a, b) => (order[a.status] - order[b.status]) || a.nextRank - b.nextRank || String(a.route).localeCompare(String(b.route), undefined, { numeric: true }));
}

export function unloadCounts(rows) {
  const c = { total: rows.length, waiting: 0, unloading: 0, complete: 0, qty: 0, mins: [] };
  rows.forEach(r => {
    c[r.status === 'COMPLETE' ? 'complete' : r.status === 'UNLOADING' ? 'unloading' : 'waiting']++;
    if (r.casesIn !== '') c.qty += Number(r.casesIn) || 0;
    const a = Date.parse(r.startedAt), b = Date.parse(r.completedAt);
    if (r.status === 'COMPLETE' && isFinite(a) && isFinite(b) && b >= a) c.mins.push((b - a) / 60000);
  });
  c.avg = c.mins.length ? Math.round(c.mins.reduce((t, m) => t + m, 0) / c.mins.length) : null;
  return c;
}

// "Oct 8, 4:10 AM" for a stamp, "" when not set.
export function shortStamp(stamp) {
  const t = Date.parse(stamp || '');
  if (!isFinite(t)) return txt(stamp);
  return new Intl.DateTimeFormat('en-US', { timeZone: L.TIME_ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(t));
}
