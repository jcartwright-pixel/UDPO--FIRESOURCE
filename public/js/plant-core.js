/*
 * United Dairy Operations: the plant side's shared rules for the screens (Loadout Center, Departments, ...).
 *
 * The same rules as the current app's plant screens:
 *   - a load's area comes from the run's load type (desktopV5063LoadoutTypeToArea_): CASE, TOTES, BOXING or TANKER;
 *   - the Loadout Center shows the day's loads plus yesterday's loads that were not finished, prior-day first, then
 *     load order, then route (udpoV780PlantLoadingRows_ / udpoV780PlantLoadingSort_);
 *   - Done = an End time, a stored COMPLETE / READY / LOADED, or the loaded tick; Loading = a Start time without an End;
 *   - Behind = not done more than 45 minutes after it leaves (Joe 10/11: 45 minutes late is not behind, 46 is);
 *   - a pickup (product that did not load at loadout) is open until it is marked complete, and shows red.
 */
import { shortTime, dateTimeText, hoursMinutesText, escapeHtml } from './app.js';

const L = window.UDLogic;

export const AREAS = ['CASE', 'TOTES', 'BOXING', 'TANKER'];
export const AREA = {
  CASE: { title: 'Daily Case Loadout', tile: 'Cases', label: 'Cases Out', unit: 'cases', color: '#1976d2', inLabel: 'Cases In' },
  TOTES: { title: 'Daily Tote Loadout', tile: 'Totes', label: 'Totes Out', unit: 'totes', color: '#7b35b5', inLabel: 'Totes In' },
  BOXING: { title: 'Daily Box Loadout', tile: 'Boxes', label: 'Boxes Out', unit: 'boxes', color: '#f28a00', inLabel: 'Boxes In' },
  TANKER: { title: 'Daily Tanker Loadout', tile: 'Tanker', label: 'Quantity Out', unit: 'gallons', color: '#159149', inLabel: 'Gallons In' }
};
export const BEHIND_MINUTES = 45;

export function areaOf(loadType) {
  const t = String(loadType || '').trim().toUpperCase();
  if (t === 'CASE LOADOUT' || t === 'CASE') return 'CASE';
  if (t === 'TOTE' || t === 'TOTES' || t === 'TOTE LOADOUT') return 'TOTES';
  if (t === 'BOXING' || t === 'BOX' || t === 'BOXES' || t === 'BOX LOADOUT') return 'BOXING';
  if (t === 'TANKER' || t === 'TANKER LOADOUT') return 'TANKER';
  return '';
}

// The plant loads every run that runs and has a load type, unless the route is retired. "Show in plant"
// (display_plant_distribution) only decides the Plant Operations Scheduler's customer list, never the loadout or
// unloading lists (the current app's rule since 7.0.227, udpoV780DisplayPolicy_ "plant_loadout_all").
// The run must be ACTIVE (a blank status is ACTIVE) and not marked inactive. A blank load type takes Route Master's; "None" stays.
function shownForPlant(run) {
  const status = String(run.routeStatus || 'ACTIVE').trim().toUpperCase();
  return status === 'ACTIVE' && run.active !== false;
}
// Joe 10/19 (800 Specials): a day can have its own load type (Daily Dispatch > Edit > Load type), which wins for that day.
export function runArea(run, prefix) {
  // A Route Editor change to None reaches the week's days as NONE: not loaded at the plant that day.
  const day = prefix && run.days && run.days[prefix], dayRaw = String((day && day.loadType) || '').trim().toUpperCase();
  if (dayRaw === 'NONE') return '';
  if (areaOf(dayRaw)) return areaOf(dayRaw);
  const own = String(run.loadType || '').trim();
  return areaOf(own || (run.masterShow && run.masterShow.loadType) || '');
}

// WAITING / LOADING / DONE (a stored READY counts as done, Joe 7.0.272).
export function loadState(day) {
  const s = String(day.loadStatus || '').trim().toUpperCase();
  if (day.completeTime || day.loadedComplete === true || ['COMPLETE', 'COMPLETED', 'LOADED', 'READY'].indexOf(s) >= 0) return 'DONE';
  if (day.plantStartedAt || s === 'LOADING' || s === 'PAUSED') return 'LOADING';
  return 'WAITING';
}

// The route's Departure Day (Route Master departure_day, copied onto each week's run): LOAD DAY, DELIVERY DAY or blank.
export function leavesOnOf(v) { const s = String(v || '').trim().toUpperCase(); return /LOAD/.test(s) ? 'LOAD DAY' : /DELIVER/.test(s) ? 'DELIVERY DAY' : ''; }

function rowFor(run, block, loadDate, prior) {
  const day = run.days[block.prefix];
  return {
    id: run.id + '|' + block.prefix, runDocId: run.id, day: block.prefix, weekStart: run.weekStart, rev: run.rev || 0,
    route: run.route || '', run: run.run || '', routeName: run.routeName || '', streamId: run.streamId || '', routeRunType: run.routeRunType || '', routeId: run.routeId || '', runId: run.runId || '', area: runArea(run, block.prefix),
    loadDate, deliveryDate: block.deliveryDate, departureDate: day.departureDate || block.deliveryDate, leavesOn: leavesOnOf(run.masterShow && run.masterShow.leavesOn), prior, loadSequence: L.effectiveSequence(day),
    baseSequence: day.loadSequence == null ? null : day.loadSequence,
    driver: day.driver || '', truck: day.truck || '', trailer: day.trailer || '', dispatchTime: day.dispatchTime,
    quantity: day.casesOut, temperature: day.loadTemperature, notes: day.plantNotes || '', shift: day.plantShift || '', updatedAt: day.updatedAt || '', updatedBy: day.updatedBy || '', moveMark: day.moveMark || null,
    startedAt: day.plantStartedAt || '', completedAt: day.completeTime || '', state: loadState(day),
    // Joe 10/12: a paused load is started but not loading now (it does not count toward the loadout's limit).
    paused: loadState(day) === 'LOADING' && String(day.loadStatus || '').trim().toUpperCase() === 'PAUSED',
    pauseMark: day.pauseMark || null
  };
}

// Joe 10/15 ("whenever the route is moved out of the original sequence… shade that row… green"): the loads dragged out of the
// sheet's load_sequence order. Within each load date the loads are taken in today's order; the longest run that still follows
// the sheet's order stays put and every other load counts as moved, so dragging one load marks that load, not the ones it
// passed. A load with no sheet number is never marked.
export function movedIds(rows) {
  const moved = new Set(), byDate = {};
  rows.forEach(r => { if (r.baseSequence != null && r.loadSequence != null) (byDate[r.loadDate] = byDate[r.loadDate] || []).push(r); });
  Object.values(byDate).forEach(list => {
    if (!list.some(r => Number(r.loadSequence) !== Number(r.baseSequence))) return;
    list = list.slice().sort((a, b) => Number(a.loadSequence) - Number(b.loadSequence) || Number(a.baseSequence) - Number(b.baseSequence));
    const len = list.map(() => 1), prev = list.map(() => -1);
    list.forEach((r, i) => { for (let j = 0; j < i; j++) if (Number(list[j].baseSequence) <= Number(r.baseSequence) && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; } });
    let at = len.indexOf(Math.max(...len));
    const keep = new Set();
    while (at >= 0) { keep.add(list[at].id); at = prev[at]; }
    list.forEach(r => { if (!keep.has(r.id)) moved.add(r.id); });
  });
  return moved;
}

// Joe 10/16 ("noted, just like we did manually moving the sequence, that it was moved, and then who did it"): the tag on a load
// moved out of the sheet's order says how (dragged = MOVED, the Skip button = SKIPPED) and who did it, when the app knows.
export function moveNote(r) {
  const m = r && r.moveMark;
  if (!m || typeof m !== 'object') return { word: 'MOVED', who: '', short: '', title: 'Moved out of the sheet\'s loading order' };
  const person = m.name || (/@/.test(String(m.by || '')) ? String(m.by).split('@')[0] : ''), tablet = m.via === 'TABLET' && m.station ? m.station + ' tablet' : '';
  const who = person && tablet ? person + ' on the ' + tablet : person || tablet;
  const at = m.savedAt ? new Date(m.savedAt) : null, when = at && !isNaN(at) ? at.toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const word = m.how === 'SKIP' ? 'SKIPPED' : 'MOVED', parts = String(m.name || '').trim().split(/\s+/).filter(Boolean);
  // On the line, short so the load stays one line high: "Joe C." or the station's name; the full name and time show on hover.
  const short = parts.length > 1 ? parts[0] + ' ' + parts[parts.length - 1][0] + '.' : person || m.station || '';
  // Joe 10/21 ("I want the initials beside whoever is doing this"): the person's initials ("JC" for Joe Cartwright, the first two
  // letters of the email when the app has no name); a Plant Station tablet signed in with its station code knows no person, so
  // it reads TABLET (which tablet shows on hover).
  const named = /@/.test(String(m.name || '')) ? [] : parts, mail = String(m.by || '').split('@')[0].replace(/[^a-z]/gi, '');
  const initials = m.via === 'TABLET' ? 'TABLET' : named.length > 1 ? (named[0][0] + named[named.length - 1][0]).toUpperCase() : named.length ? named[0].slice(0, 2).toUpperCase() : mail.slice(0, 2).toUpperCase();
  return { word, who, short, initials, title: (m.how === 'SKIP' ? 'Skipped down one place' : 'Moved out of the sheet\'s loading order') + (who ? ' by ' + who : '') + (when ? ' at ' + when : '') };
}

// A load someone moved (moveMark) that is still out of the sheet's place: a Skip past one load can leave either of the two
// marked by movedIds, so the one that was moved is always marked too.
export function movedBySomeone(r) {
  return !!(r && r.moveMark && r.baseSequence != null && r.loadSequence != null && Number(r.loadSequence) !== Number(r.baseSequence));
}

// Joe 10/21 ("the skips and moved were from yesterday. They still retain on this"): a SKIPPED or MOVED tag belongs to the
// operating day it was made on. A load moved or skipped on an earlier day (for example on tomorrow's loadout the day before)
// starts its own day with no tag; its loading order is kept.
export function movedEarlier(r) {
  const m = r && r.moveMark, at = m && m.savedAt ? new Date(m.savedAt) : null;
  return !!at && !isNaN(at) && !!r.loadDate && L.operatingDay(at) < r.loadDate;
}

const byLoad = (a, b) => (Number(b.prior) - Number(a.prior)) || String(a.loadDate).localeCompare(String(b.loadDate)) ||
  (Number(a.loadSequence == null ? 999999 : a.loadSequence) - Number(b.loadSequence == null ? 999999 : b.loadSequence)) ||
  String(a.route).localeCompare(String(b.route), undefined, { numeric: true });

// Every load for the plant on `date` (all areas), plus yesterday's loads that are not done yet, unless the plant was started
// fresh after yesterday (Administration > Start Plant Fresh From Today, udpoV780PlantLoadingRows_ UDPO_PLANT_START_DATE).
// Joe 10/20 ("this is the next day, but it is showing that truck is getting loaded"): a day that has not started yet (after
// today's operating day, which rolls at 6 a.m.) carries nothing over: today's open loads are still today's, not left over.
export function loadoutRows(runs, date, plantStart) {
  const out = [], yesterday = L.addDays(date, -1), start = plantStart === undefined ? (typeof window !== 'undefined' && window.UDPlantStart) || '' : plantStart;
  const carry = (!start || yesterday >= start) && date <= L.operatingDay(new Date());
  (runs || []).forEach(run => {
    if (!shownForPlant(run)) return;
    L.loadBlocksFor(run, date).forEach(b => { if (runArea(run, b.prefix)) out.push(rowFor(run, b, date, false)); });
    if (carry) L.loadBlocksFor(run, yesterday).forEach(b => { const r = runArea(run, b.prefix) && rowFor(run, b, yesterday, true); if (r && r.state !== 'DONE') out.push(r); });
  });
  return out.sort(byLoad);
}

export function nowMinutes(now) {
  const parts = {};
  new Intl.DateTimeFormat('en-US', { timeZone: L.TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now || new Date()).forEach(p => { parts[p.type] = p.value; });
  return Number(parts.hour) * 60 + Number(parts.minute);
}

// Behind: a load not done more than 45 minutes after its route leaves (departure date + dispatch time, not the load day), so a
// Saturday loadout for Monday is not behind until Monday (Joe 10/11). Joe 10/20: a load left over from last night (still open
// after the 6 a.m. roll) that leaves before this shift ends missed its shift, so it is behind before its dispatch time too.
export function isBehind(row, today, now) {
  if (row.state === 'DONE') return false;
  const leaves = departWall(row), n = wallNowMinutes(now);
  if (row.prior && (leaves === null || leaves <= shiftEndAfter(n))) return true;
  if (leaves === null) return false;
  return n > leaves + BEHIND_MINUTES;
}
// Minutes since 1/1/1970 on the plant's wall clock (New York). When a load leaves (departWall) is plant-rules.js's own rule, the one
// the Late Forecast and the report use (audit batch 1, Joe 10/22: every screen agrees); every page that loads this file loads it.
const dayNumber = (key) => { const p = String(key || '').split('-').map(Number); return p.length === 3 && p.every(isFinite) && p[0] ? Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000) : null; };
// The end of the shift running at wall minute n: 6 a.m. after the operating day that n falls in.
export const shiftEndAfter = (n) => (Math.floor((n - 360) / 1440) + 1) * 1440 + 360;
export function wallNowMinutes(now) {
  const parts = {};
  new Intl.DateTimeFormat('en-US', { timeZone: L.TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now || new Date()).forEach(p => { parts[p.type] = p.value; });
  return dayNumber(parts.year + '-' + parts.month + '-' + parts.day) * 1440 + Number(parts.hour) % 24 * 60 + Number(parts.minute);
}
export function departWall(row) {
  return window.UDPlant.departWall({ departureDate: row.departureDate, deliveryDate: row.deliveryDate, loadDate: row.loadDate, leavesOn: row.leavesOn, dispatchTime: row.dispatchTime });
}

export function pickupOpen(p) { return ['COMPLETE', 'COMPLETED', 'CLOSED'].indexOf(String(p.status || '').toUpperCase()) < 0; }

// Pickups for a load: same run and the load's date (or the delivery date the current app sometimes stored).
export function pickupsFor(row, pickups) {
  return (pickups || []).filter(p => (p.runDocId ? p.runDocId === row.runDocId && (!p.day || p.day === row.day) : String(p.runId) === String(row.runId)) &&
    (p.date === row.loadDate || p.date === row.deliveryDate));
}

// Pickups plus the open pickups that load notes ask for ("pickup", "P/U", "PU"): a load whose note asks for a pickup and that has
// no pickup entered gets one listed, red like the others, until it is completed (board-rules.js notePickup, as the old app's
// 019_V722 udpoV7268NotePickupRows_). rows = loadoutRows; pages that use it load js/board-rules.js.
export function withNotePickups(rows, pickups) {
  const B = typeof window !== 'undefined' && window.UDBoard;
  if (!B) return pickups || [];
  const out = (pickups || []).slice(), seen = {};
  (rows || []).forEach(r => {
    if (seen[r.id + '|' + r.loadDate]) return;
    seen[r.id + '|' + r.loadDate] = true;
    const note = B.notePickup({ id: r.runDocId, runId: r.runId, route: r.route, run: r.run, days: { [r.day]: { plantNotes: r.notes, updatedAt: r.updatedAt, updatedBy: r.updatedBy } } },
      r.day, r.loadDate, pickupsFor(r, pickups));
    if (note) out.push(Object.assign(note, { deliveryDate: r.deliveryDate }));
  });
  return out;
}

export function counts(rows) {
  const c = { total: rows.length, done: 0, loading: 0, waiting: 0, paused: 0, prior: 0, quantity: 0 };
  rows.forEach(r => {
    // A paused load is started but not loading now (Joe 10/12).
    c[r.state === 'DONE' ? 'done' : r.state === 'LOADING' ? (r.paused ? 'paused' : 'loading') : 'waiting']++;
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
  return shortTime(t);
}

// Minutes between Start and End (or now while loading).
export function minutesTaken(row, now) {
  if (!row.startedAt) return null;
  const a = Date.parse(row.startedAt), b = row.completedAt ? Date.parse(row.completedAt) : (now || new Date()).getTime();
  if (!(isFinite(a) && isFinite(b) && b >= a)) return null;
  // Joe 10/22: paused minutes are not loading time (plant-rules pausedMinutes).
  const paused = typeof window !== 'undefined' && window.UDPlant ? window.UDPlant.pausedMinutes(row, now ? now.getTime() : undefined) : 0;
  return Math.max(0, Math.round((b - a) / 60000 - paused));
}

// "38 min", or "2 h 05 min" once it runs past two hours.
export function minutesText(m) { return hoursMinutesText(m, { pad: true, hoursFrom: 120 }); }

// Polish item 5 (Joe 10/11): a load or unload still running after 12 hours shows when it started instead of a huge clock
// ("Started Wed 5:13 AM · forgot End?"); otherwise the plain minutes text.
export const LONG_RUN_MINUTES = 720;
export function runningText(startedAt, m) {
  if (m === null || m === undefined) return '';
  if (m < LONG_RUN_MINUTES || !startedAt || !isFinite(Date.parse(startedAt))) return minutesText(m);
  const when = new Intl.DateTimeFormat('en-US', { timeZone: L.TIME_ZONE, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(startedAt));
  return 'Started ' + when.replace(',', '') + ' · forgot End?';
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
// A count from the sheet or the app: a whole number, or '' when blank or not a number.
const num = (v) => { const t = txt(v).replace(/,/g, ''); return t !== '' && isFinite(Number(t)) ? Number(t) : ''; };
const reported = (v) => !!txt(v) && !L.noWriteUp(v);

/*
 * Product returns for one date (getDesktopUiProductReturnsCurrent): the plant journal's RETURN records, every driver check-in
 * that reported refused / returned product, and the refusals drivers called in (REFUSALS / RETURNS LIVE, queue = the
 * plantReturns docs). Pending until RTA (put back in the cooler, never dumped).
 * Joe 10/12: a check-in's "Cases Returned" / "How Many Returned" is the EMPTY cases the driver brought back, never product,
 * so it no longer makes a return on its own. Each return carries its write-up (info) for the details box.
 */
const QUEUE_DONE = /CLOSED|DONE|COMPLETE|RESOLVED|CANCEL|RTA|RETURNED/;
export function returnsFor(runs, date, journal, queue) {
  const removed = {}, unloads = U.latestUnloads(journal, date), out = [];
  Object.keys(unloads).forEach(k => unloads[k].removed.forEach(id => { removed[id] = true; }));
  (journal || []).forEach(d => {
    if (String(d.type || '').toUpperCase() !== 'RETURN' || d.date !== date) return;
    const p = d.payload || {}, added = p.enteredAt === 'PLANT_STATION';
    out.push({ id: d.recordId, source: 'RETURN', route: txt(p.route || d.route), run: txt(p.run || d.run), trailer: txt(p.trailer || d.trailer), cases: txt(p.casesReturned || p.quantity || d.quantity),
      refused: !!p.refusedReturned, detail: txt(p.notes || p.description || d.notes) || 'Returned product reported', recordedAt: d.recordedAt || '', added,
      info: { from: added ? 'Added at the plant (+ Add Return)' : 'Unloading (dock)', by: txt(d.recordedBy), at: d.recordedAt || '', product: txt(p.product), sku: txt(p.sku),
        cases: txt(p.casesReturned || p.quantity || d.quantity), notes: txt(p.notes || p.description || d.notes), store: txt(p.refusedReturnedSource), unknownRoute: !!p.unknownRoute } });
  });
  const prefix = L.dayPrefix(date), week = L.weekStart(date), shown = {};
  (runs || []).forEach(run => {
    const d = run.weekStart === week && run.days && run.days[prefix];
    if (!d || !d.runs || !reported(d.refusedReturned)) return;
    shown[run.id] = true;
    out.push({ id: 'CHECKIN|' + run.id + '|' + prefix, source: 'DRIVER CHECK-IN', runDocId: run.id, day: prefix, route: txt(run.route), run: txt(run.run), trailer: txt(d.trailer), cases: '',
      refused: true, detail: [txt(d.refusedReturned), txt(d.refusedReturnedSource)].filter(Boolean).join(' · '), recordedAt: d.checkinCompletedAt || '',
      info: { from: /^EMAIL/i.test(txt(d.updatedBy)) ? 'Driver check-in (call-in email)' : 'Driver check-in', by: txt(d.updatedBy), at: d.checkinCompletedAt || '', driver: txt(d.driver), truck: txt(d.truck),
        reported: txt(d.refusedReturned), store: txt(d.refusedReturnedSource), notes: txt(d.checkinNotes), casesDelivered: txt(d.casesDelivered), emptyCases: txt(d.driverCaseReturn) } });
  });
  // Refusals called in to the answering service (the old app's email reader), on the day they were reported. The new app's
  // own check-ins (ROUTE_APP / APP|...) are already shown from the run above.
  (queue || []).forEach(q => {
    if (String(q.kind || 'RETURN').toUpperCase() !== 'RETURN' || q.date !== date) return;
    const rid = txt(q.record_id);
    if (!rid || /^APP\|/.test(rid) || String(q.source_type || '').toUpperCase() === 'ROUTE_APP') return;
    const want = [txt(q.run_id), txt(q.route_id)].filter(Boolean), run = (runs || []).find(r => r.weekStart === week && (want.indexOf(txt(r.runId)) >= 0 || (!txt(q.run_id) && want.some(w => w === txt(r.routeId) || w === txt(r.route)))));
    if (run && shown[run.id]) return;
    const d = (run && run.days && run.days[prefix]) || {}, what = txt(q.reason_details || q.issue_details || q.notes) || 'Refused / returned product reported';
    out.push({ id: 'QUEUE|' + rid, source: 'CALL-IN', readOnly: true, route: run ? txt(run.route) : txt(q.route_id).replace(/^rte_.*/, '') || 'Route?', run: run ? txt(run.run) : '', trailer: txt(d.trailer),
      cases: '', refused: true, detail: what, recordedAt: q.opened_at || '', queueStatus: txt(q.status).toUpperCase(),
      info: { from: 'Driver check-in (call-in email)', by: txt(q.opened_by), at: q.opened_at || '', driver: txt(q.driver) || txt(d.driver), truck: txt(d.truck), reported: what,
        store: txt(q.store_name || q.store_id), notes: txt(q.disposition) ? 'Sheet status: ' + [txt(q.status), txt(q.disposition)].filter(Boolean).join(' · ') : '', email: txt(q.source_id) } });
  });
  out.forEach(x => { x.pending = x.source === 'CALL-IN' ? !QUEUE_DONE.test(x.queueStatus || '') : !removed[x.id]; });
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
    // Joe 10/27 (hd): a trailer added on Case Unloading only to be washed, until it is washed.
    if (u.added === 'WASH' && !u.dropped && unit) {
      if (!(done[unit] && U.when(done[unit].completedAt) >= U.when(u.addedAt))) out.push({ id: 'ADDED|' + k, kind: 'UNLOAD', trailer: txt(u.trailer), route: u.route, run: u.run, need: 'Wash only (added on Case Unloading)', reported: u.addedAt, refs: [] });
      return;
    }
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
/*
 * Joe 10/27: a drop-and-hook load (Route Master's Drop and Hook tick, set in the Route Editor) shows its name on Case
 * Unloading, never a trailer number: "Ferry Product 1", "Lancaster Transfer", "Fairmont Transfer". The name is the route's
 * stream (FERRY PRODUCT, LANCASTER TRANSFER), plus the run's number when the stream has none (PRODUCT 1 > Ferry Product 1).
 */
export function dropHookName(run) {
  const stream = txt(run && (run.streamId || run.routeName || run.route)), r = txt(run && run.run), n = /(\d+)\s*$/.exec(r);
  const name = stream && n && !/\d\s*$/.test(stream) ? stream + ' ' + n[1] : stream || r;
  return name.toLowerCase().replace(/(^|[\s/(-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
}

// routes: the Route Master docs (id = run id), for the Drop and Hook tick the week's loads do not carry.
export function unloadRows(runs, date, journal, returns, loads, routes) {
  const prefix = L.dayPrefix(date), week = L.weekStart(date), unloads = U.latestUnloads(journal, date), done = U.washesDone(journal), rows = [];
  const master = {};
  (routes || []).forEach(m => { const id = m && (m.runId || m.id); if (id) master[id] = m; });
  (runs || []).forEach(run => {
    const m = master[run.runId] || {}, dropAndHook = !!(run.dropAndHook || m.dropAndHook);
    const area = runArea(run, run.weekStart === week ? prefix : ''), d = run.weekStart === week && run.days && run.days[prefix];
    if (!area || !shownForPlant(run) || !d || !d.runs) return;
    const key = U.unloadKey(date, run.route, run.run), u = unloads[key] || {};
    const trailer = u.trailer !== undefined && u.trailer !== '' ? u.trailer : dropAndHook ? '' : txt(d.trailer);
    const mine = (returns || []).filter(x => (x.runDocId ? x.runDocId === run.id : x.route === txt(run.route) && x.run === txt(run.run)));
    const unit = U.unitKey(trailer || d.truck), wash = done[unit];
    rows.push({ id: key, key, runDocId: run.id, day: prefix, route: txt(run.route), run: txt(run.run), runId: run.runId || '', area, driver: d.driver || '', truck: txt(d.truck), trailer,
      // Joe 10/27 (hg): Cases Out from the loadout and the empty cases the driver said at check-in, beside Cases Returned.
      casesOut: num(d.casesOut), driverSaid: num(d.driverCaseReturn),
      trailerTyped: u.trailer !== undefined && u.trailer !== '', dropped: !!u.dropped, dropAndHook, name: dropAndHook ? dropHookName(Object.assign({}, m, run, { streamId: run.streamId || m.streamId })) : '', casesIn: u.casesIn === undefined || u.casesIn === null ? '' : String(u.casesIn),
      startedAt: u.startedAt || '', completedAt: u.completedAt || '', notes: u.notes || '', status: u.status || 'WAITING', returns: mine, pendingReturns: mine.filter(x => x.pending),
      washed: !!(wash && (!u.completedAt || U.when(wash.completedAt) >= U.when(u.completedAt))), checkedIn: !!d.checkinCompletedAt, checkinAt: d.checkinCompletedAt || '', nextLoad: null, nextRank: 999999 });
  });
  // Joe 10/27 (hd): a trailer added by hand (+ Add a Trailer) to unload or only to wash. A wash-only trailer is done once washed.
  Object.keys(unloads).forEach(k => {
    const u = unloads[k];
    if (!u.added || u.dropped || u.route !== ADDED_ROUTE) return;
    const trailer = txt(u.trailer), wash = done[U.unitKey(trailer)], washOnly = u.added === 'WASH';
    const washed = !!(wash && U.when(wash.completedAt) >= U.when(washOnly || !u.completedAt ? u.addedAt : u.completedAt));
    rows.push({ id: k, key: k, runDocId: '', day: '', route: u.route, run: u.run, runId: '', area: u.area || 'CASE', driver: '', truck: '', trailer, casesOut: '', driverSaid: '',
      trailerTyped: true, dropAndHook: false, name: '', casesIn: u.casesIn === undefined || u.casesIn === null ? '' : String(u.casesIn), startedAt: u.startedAt || '', completedAt: u.completedAt || '',
      notes: u.notes || '', status: washOnly ? (washed ? 'COMPLETE' : 'WAITING') : u.status || 'WAITING', returns: [], pendingReturns: [], washed, checkedIn: false, checkinAt: '',
      nextLoad: null, nextRank: 999999, added: u.added, washOnly, forRoute: u.forRoute || '', addedAt: u.addedAt || '' });
  });
  // When each trailer is next needed: the first unfinished load (in loading order) that uses the same unit.
  (loads || []).forEach((l, i) => {
    if (l.state === 'DONE') return;
    const unit = U.unitKey(l.trailer || l.truck);
    if (!unit) return;
    rows.forEach(r => {
      if (r.nextLoad || U.unitKey(r.trailer || (r.dropAndHook ? '' : r.truck)) !== unit || (l.prior && l.runDocId === r.runDocId)) return;
      r.nextLoad = { route: l.route, run: l.run, time: timeOfDay(l.dispatchTime), depart: departWall(l) }; r.nextRank = i;
    });
  });
  const order = { UNLOADING: 0, WAITING: 2, COMPLETE: 3 };
  return rows.sort((a, b) => (order[a.status] - order[b.status]) || a.nextRank - b.nextRank || String(a.route).localeCompare(String(b.route), undefined, { numeric: true }));
}

// Joe 10/27 (hd): + Add a Trailer's rows are route ADDED, run = the trailer (the server checks the same).
export const ADDED_ROUTE = 'ADDED';
export const addedRun = (trailer) => U.unitKey(trailer);

/*
 * Joe 10/27 (hd): yesterday's trailers nobody pressed End on come over to today's list by themselves, in red at the top,
 * each saved on its own day. Not when the plant was started fresh after yesterday (as the loadout's carry-over), not for a
 * day that has not started yet, and not a transfer trailer still out (drop and hook with no trailer back).
 * journal = the plant journal of yesterday and today (today's washes count for yesterday's wash-only trailers).
 */
export function carriedUnloads(runs, date, journal, routes, plantStart) {
  const y = L.addDays(date, -1), start = plantStart === undefined ? (typeof window !== 'undefined' && window.UDPlantStart) || '' : plantStart;
  if ((start && y < start) || date > L.operatingDay(new Date())) return [];
  return unloadRows(runs, y, journal, [], [], routes).filter(r => r.status !== 'COMPLETE' && !r.dropped && !(r.dropAndHook && !r.trailer))
    .map(r => Object.assign(r, { prior: true, date: y }));
}

/*
 * Joe 10/27 ("not matching the trailers that I need to load today for tomorrow"): every trailer on today's loadout is on
 * the list, not only the ones that delivered today. A trailer a load needs today that is on none of today's rows (it came
 * back on an earlier day, or it is a spare) gets its own row, in the order its load leaves, named for that load. Not when
 * yesterday's unloading of it was finished, and not once it was taken off the list today. Nothing is saved until Start
 * (or Take Off the List): it is then saved as a trailer added for that load (route ADDED, as + Add a Trailer).
 * rows = today's rows (with yesterday's carried over and the added ones); loads = loadoutRows of the date;
 * journal = the plant journal of yesterday and today.
 */
export function neededUnloads(runs, date, journal, routes, rows, loads) {
  const have = {}, y = L.addDays(date, -1), today = U.latestUnloads(journal, date), out = [];
  (rows || []).forEach(r => { const u = U.unitKey(r.trailer || (r.dropAndHook ? '' : r.truck)); if (u) have[u] = true; });
  unloadRows(runs, y, journal, [], [], routes).forEach(r => { const u = U.unitKey(r.trailer); if (u && r.status === 'COMPLETE') have[u] = true; });
  (loads || []).forEach((l, i) => {
    const unit = U.unitKey(l.trailer), key = U.unloadKey(date, ADDED_ROUTE, unit);
    if (!unit || l.state === 'DONE' || have[unit] || today[key]) return;
    have[unit] = true;
    out.push({ id: key, key, runDocId: '', day: '', route: ADDED_ROUTE, run: unit, runId: '', area: l.area || 'CASE', driver: '', truck: '', trailer: txt(l.trailer),
      casesOut: '', driverSaid: '', trailerTyped: true, dropped: false, dropAndHook: false, name: '', casesIn: '', startedAt: '', completedAt: '', notes: '', status: 'WAITING',
      returns: [], pendingReturns: [], washed: false, checkedIn: false, checkinAt: '', date, needed: true, forRoute: txt(l.run) || txt(l.route),
      nextLoad: { route: l.route, run: l.run, time: timeOfDay(l.dispatchTime), depart: departWall(l) }, nextRank: i });
  });
  return out;
}

/*
 * Case Unloading's order on the Plant Station (Joe 10/15, mock-up A): the trailers in the order the next loads leave (the
 * first unfinished load that needs the same trailer, by departure), with no times or routes shown. Each card says whether
 * the trailer is back: Verizon Connect Fleet's yard return (gpsDays yardIn after yardOut, the trailer's unit first, else its
 * truck), else the driver's check-in. A trailer Fleet shows out of the yard is "On the road" and goes below the ones that
 * are back. A drop-and-hook load (Route Master drop and hook, e.g. Marietta) with no trailer typed is a transfer trailer
 * still needed. Joe 10/27: the trailers today's loadout needs come first (by when their load leaves), then the ones not
 * needed today; a trailer that is here goes ahead of one still on the road. Order: yesterday's and added trailers (hd);
 * unloading now; here and needed; here and not needed (all numbered 1, 2, 3...); on the road and needed; on the road and not needed; transfer trailers; done.
 * A trailer today's loadout needs that did not deliver today is on the list too (neededUnloads).
 * gpsDays: the gpsDays docs of the days around `date` ([] when the tablet cannot read them: then no one is On the road).
 */
export function unloadOrder(rows, gpsDays) {
  const byUnit = {};
  (gpsDays || []).forEach(g => { const k = U.unitKey(g.tag); if (k) (byUnit[k] = byUnit[k] || []).push(g); });
  const yard = (unit) => {
    const docs = byUnit[U.unitKey(unit)] || [];
    const out = docs.map(g => g.yardOut).filter(Boolean).sort().pop() || '', back = docs.map(g => g.yardIn).filter(Boolean).sort().pop() || '';
    if (back && (!out || back > out)) return { back };
    return out ? { road: true } : null;
  };
  // Yesterday's trailers and the ones added by hand go to the top, above the one unloading now (Joe 10/27, hd, mock-up 2).
  const rank = (r) => r.status === 'COMPLETE' ? 7 : r.prior || r.added ? 0 : r.status === 'UNLOADING' ? 1 : r.transfer ? 6 : (r.road ? 4 : 2) + (r.nextLoad ? 0 : 1);
  const out = (rows || []).map(r => {
    const transfer = r.dropAndHook && !r.trailer;
    const y = transfer ? null : r.trailer && yard(r.trailer) || yard(r.truck);
    const back = y && y.back ? y.back : !(y && y.road) && r.checkinAt ? r.checkinAt : '';
    const road = !!(y && y.road) && !r.checkedIn && r.status === 'WAITING';
    return Object.assign({}, r, { transfer, back, road, order: 0 });
  });
  const firstIn = (r) => (r.prior ? 0 : 1);
  const dep = (r) => (r.nextLoad && r.nextLoad.depart !== null && r.nextLoad.depart !== undefined ? r.nextLoad.depart : 1e12);
  out.sort((a, b) => rank(a) - rank(b) || firstIn(a) - firstIn(b) || dep(a) - dep(b) || a.nextRank - b.nextRank || String(a.route).localeCompare(String(b.route), undefined, { numeric: true }) || String(a.run).localeCompare(String(b.run)));
  let n = 0;
  out.forEach(r => { if (rank(r) <= 3) r.order = ++n; });
  return out;
}

// Joe 10/27 (hg): the empty cases lost on a load = Cases Out (loadout) less Cases Returned (unloaders); null until both are known.
export function lostCases(r) {
  if (!r || r.casesOut === '' || r.casesIn === '' || r.casesIn === undefined) return null;
  return Number(r.casesOut) - Number(r.casesIn);
}

export function unloadCounts(rows) {
  const c = { total: rows.length, waiting: 0, unloading: 0, complete: 0, qty: 0, out: 0, lost: 0, mins: [] };
  rows.forEach(r => {
    const lost = lostCases(r);
    if (lost !== null) { c.out += Number(r.casesOut); c.lost += lost; }
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
  return dateTimeText(t);
}

// Joe 10/20: the "Confirm this load" box the Scheduler and Daily Box Loadout show before a new load (or a load whose dates
// changed) is saved. c = R.scheduleCheck; f = what was typed. Nothing is saved until Confirm is pressed.
export const SCHED_CONFIRM_TITLE = 'Confirm this load';
export function scheduleConfirmBody(c, f) {
  const clock = (t) => { const m = /^(\d{2}):(\d{2})$/.exec(t || ''); if (!m) return t || ''; const h = Number(m[1]); return (h % 12 || 12) + ':' + m[2] + (h < 12 ? ' AM' : ' PM'); };
  const kind = f.lane === 'RECEIVING' ? 'Receiving (coming in)' : f.scheduleType === 'CARRIER' ? 'Carrier pickup' : 'United Dairy Delivery';
  const row = (k, v, cls) => '<dt>' + k + '</dt><dd' + (cls ? ' class="' + cls + '"' : '') + '>' + escapeHtml(v || '—') + '</dd>';
  return '<dl class="sched-confirm">' + row(f.lane === 'RECEIVING' ? 'Supplier' : 'Route / Run', f.who, 'big') + row('Type', kind) + row('Load Date', c.loadText, 'big') +
    row('Delivery Date', c.deliveryText, 'big') + row('Pickup Time', clock(f.pickupTime)) + row('PO Number', f.poNumber) + row('Cases', f.cases) + '</dl>' +
    c.warnings.map(w => '<p class="sched-warn" role="alert">&#9888; ' + escapeHtml(w) + '</p>').join('') +
    '<p class="modal-context">Check the dates. Nothing is saved until you press Confirm.</p>';
}
