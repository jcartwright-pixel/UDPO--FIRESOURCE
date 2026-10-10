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
