/*
 * United Dairy New Plant Operations: Plant Reports (Joe 10/10, the Reports button on Manager Center).
 *
 * Every number comes from what the plant screens already record:
 *   - loads: the Loadout Center's rows for a load date (its runs), with their Start and End times and depart time;
 *   - On time = loaded (End time) no later than 30 minutes after the depart time, the same 30 minutes as "Behind";
 *     Late = loaded after that; Not loaded = never marked done and its depart time + 30 minutes has passed;
 *     a load marked done with no End time counts as loaded, but not in the on-time share;
 *   - a depart time before 6 AM belongs to the next calendar morning (the operating day rolls at 6 AM);
 *   - pickups (product that did not load), breakdowns (Shift Notes), temperatures out of range and quality fails of the day.
 * Weeks run Sunday to Saturday.
 */
import * as P from './plant-core.js';

const L = window.UDLogic, U = window.UDPlant;
export const ON_TIME_MINUTES = P.BEHIND_MINUTES;
export const AREA_ORDER = ['CASE', 'TOTES', 'BOXING', 'TANKER'];
export const AREA_NAME = { CASE: 'Cases', TOTES: 'Totes', BOXING: 'Boxing', TANKER: 'Tanker' };
const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
function dayNum(key) { const p = String(key || '').split('-').map(Number); return p.length === 3 && p.every(isFinite) && p[0] ? Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000) : null; }
// "9:00 PM", "21:00" or minutes of the day, as minutes of the day.
export function departMinutes(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v >= 0 && v < 1 ? Math.round(v * 1440) : v;
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const ap = String(m[3] || '').toUpperCase();
  if (ap) { if (h === 12) h = 0; if (ap === 'PM') h += 12; }
  return h * 60 + Number(m[2]);
}
// The plant's wall clock (New York) as minutes counted from 1/1/1970, for now.
export function wallNow(ms) {
  const parts = {};
  new Intl.DateTimeFormat('en-US', { timeZone: L.TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).forEach(p => { parts[p.type] = p.value; });
  return dayNum(parts.year + '-' + parts.month + '-' + parts.day) * 1440 + Number(parts.hour) % 24 * 60 + Number(parts.minute);
}
// When the load leaves, on the wall clock: the route's departure moment (plant-rules departWall), not the load day.
export function departAt(row) {
  return U.departWall({ departureDate: row.departureDate, deliveryDate: row.deliveryDate, loadDate: row.loadDate, dispatchTime: departMinutes(row.dispatchTime) });
}
export function clockText(wall) { return wall === null || wall === undefined ? '' : L.timeText(((wall % 1440) + 1440) % 1440); }
export function minutesText(m) {
  if (m === null || m === undefined || !isFinite(m)) return '';
  m = Math.round(m);
  return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min';
}

// One load's result: ON TIME, LATE, NOT LOADED, LOADED (done with no End time) or TO COME (its time has not come yet).
export function loadOutcome(row, nowWall) {
  const depart = departAt(row), done = U.wallMinutes(row.completedAt), started = U.wallMinutes(row.startedAt);
  const out = { route: text(row.route), run: text(row.run), area: row.area, depart, done, started, late: null, taken: done !== null && started !== null && done >= started ? done - started : null,
    truck: text(row.truck), trailer: text(row.trailer), runDocId: row.runDocId, day: row.day, runId: row.runId, loadDate: row.loadDate, deliveryDate: row.deliveryDate };
  if (row.state === 'DONE') {
    if (done === null || depart === null) out.result = 'LOADED';
    else { out.late = done - depart; out.result = out.late <= ON_TIME_MINUTES ? 'ON TIME' : 'LATE'; }
  } else if (depart !== null && nowWall > depart + ON_TIME_MINUTES) out.result = 'NOT LOADED';
  else if (depart === null && nowWall >= (dayNum(row.loadDate) + 1) * 1440 + 360) out.result = 'NOT LOADED';
  else out.result = 'TO COME';
  return out;
}

const quality = (d) => text(d.type).toUpperCase() === U.QUALITY_TYPE;
function qualityFail(d) {
  const p = d.payload || {};
  return text(p.status).toUpperCase() === 'DOWN' || text(p.qualityCheck).toUpperCase() === 'FAIL' || /^(FAIL|REVIEW)$/i.test(text(p.tipTest));
}

/* ---------- Plant shifts (Administration > Plant Shifts) ---------- */
// Joe 10/10: Uniontown runs three shifts; they overlap by 30 minutes. Administration can change them per plant.
export const DEFAULT_SHIFTS = Object.freeze({
  fac_uniontown: [{ name: 'First Shift', start: '06:00', end: '14:30' }, { name: 'Second Shift', start: '14:00', end: '22:30' }, { name: 'Third Shift', start: '22:00', end: '05:30' }]
});
const hhmm = (v) => { const m = String(v || '').match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
// Joe 10/11: each plant has Distribution shifts and Plant Production shifts. A shift saved before the Side column is Distribution.
export const SHIFT_SIDES = Object.freeze([['DISTRIBUTION', 'Distribution'], ['PRODUCTION', 'Plant Production']]);
export const shiftSide = (x) => (text(x && x.side).toUpperCase() === 'PRODUCTION' ? 'PRODUCTION' : 'DISTRIBUTION');
// The plant's shifts on one side (Distribution unless asked; side 'ALL' = every shift): the saved list (plantShifts/<facility>)
// or the starting list. Loads, Shift Notes and Shift Reports go by the Distribution shifts.
export function shiftsFor(saved, facilityId, side) {
  const id = facilityId || 'fac_uniontown', want = side || 'DISTRIBUTION', starting = DEFAULT_SHIFTS[id] || DEFAULT_SHIFTS.fac_uniontown;
  let list = saved && Array.isArray(saved.shifts) && saved.shifts.length ? saved.shifts : starting;
  if (want !== 'ALL') { list = list.filter(x => shiftSide(x) === want); if (!list.length && want === 'DISTRIBUTION') list = starting; }
  return list.map(x => ({ name: text(x.name), start: text(x.start), end: text(x.end), side: shiftSide(x), from: hhmm(x.start), to: hhmm(x.end) })).filter(x => x.name && x.from !== null && x.to !== null);
}
/*
 * The shift a time of day (minutes) belongs to. Inside an overlap the earlier shift keeps it (the one that started longer
 * ago); a time no shift covers (5:30 to 6:00 AM) belongs to the shift that just ended.
 */
export function shiftAt(minute, shifts) {
  if (minute === null || minute === undefined || !shifts || !shifts.length) return '';
  const t = ((minute % 1440) + 1440) % 1440;
  const inside = shifts.filter(x => { const len = (x.to - x.from + 1440) % 1440 || 1440; return (t - x.from + 1440) % 1440 < len; });
  if (inside.length) return inside.sort((a, b) => ((t - b.from + 1440) % 1440) - ((t - a.from + 1440) % 1440))[0].name;
  return shifts.slice().sort((a, b) => ((t - a.to + 1440) % 1440) - ((t - b.to + 1440) % 1440))[0].name;
}
// A stamp's time of day on the plant clock, as minutes.
const stampMinute = (v) => { const w = U.wallMinutes(v); return w === null ? null : ((w % 1440) + 1440) % 1440; };

/*
 * One day of the plant. runs = run documents of the weeks around the date; pickups = pickup rows; journal = plantJournal docs
 * (any dates: only the date's own are used). nowMs decides what has come due. shifts = shiftsFor(...): each load counts for the
 * shift it started loading in (its End time when it has no Start; its depart time when it never loaded).
 */
export function daySummary(date, runs, pickups, journal, nowMs, shifts) {
  const nowWall = wallNow(nowMs), rows = P.loadoutRows(runs, date, date), byId = {};
  (runs || []).forEach(r => { byId[r.id] = r; });
  shifts = shifts || shiftsFor(null);
  const loads = rows.map(r => {
    const x = loadOutcome(r, nowWall), run = byId[r.runDocId], d = run && run.days && run.days[r.day] || {};
    const at = x.started !== null ? x.started : x.done !== null ? x.done : x.depart;
    x.shift = shiftAt(at === null ? null : at % 1440, shifts);
    // What the driver reported at check-in for this load (Daily Dispatch's check-in columns).
    x.shortage = text(d.overageShortageDetails) || (L.yes(d.overageShortage) ? 'Over / short' : '');
    x.refused = L.yes(d.refusedReturned);
    return x;
  });
  const c = { date, weekday: L.dayName(date).toUpperCase(), loads: loads.length, onTime: 0, late: 0, notLoaded: 0, noTime: 0, toCome: 0, lateMinutes: 0, takenMinutes: 0, taken: 0, areas: {} };
  AREA_ORDER.forEach(a => { c.areas[a] = { area: a, loads: 0, onTime: 0, late: 0, notLoaded: 0, judged: 0 }; });
  let first = null, last = null;
  loads.forEach(x => {
    const a = c.areas[x.area] || (c.areas[x.area] = { area: x.area, loads: 0, onTime: 0, late: 0, notLoaded: 0, judged: 0 });
    a.loads++;
    if (x.result === 'ON TIME') { c.onTime++; a.onTime++; a.judged++; }
    else if (x.result === 'LATE') { c.late++; a.late++; a.judged++; c.lateMinutes += x.late; }
    else if (x.result === 'NOT LOADED') { c.notLoaded++; a.notLoaded++; a.judged++; }
    else if (x.result === 'LOADED') c.noTime++;
    else c.toCome++;
    if (x.taken !== null) { c.taken++; c.takenMinutes += x.taken; }
    if (x.started !== null && (first === null || x.started < first)) first = x.started;
    if (x.done !== null && (last === null || x.done > last)) last = x.done;
  });
  c.judged = c.onTime + c.late + c.notLoaded;
  c.onTimePct = c.judged ? Math.round(c.onTime / c.judged * 100) : null;
  c.avgLate = c.late ? Math.round(c.lateMinutes / c.late) : null;
  c.avgTaken = c.taken ? Math.round(c.takenMinutes / c.taken) : null;
  c.firstStart = first; c.lastFinish = last;
  c.problems = loads.filter(x => x.result === 'LATE' || x.result === 'NOT LOADED')
    .sort((a, b) => (a.result === 'NOT LOADED') - (b.result === 'NOT LOADED') || (b.late || 0) - (a.late || 0) || String(a.route).localeCompare(String(b.route), undefined, { numeric: true }));
  c.loadList = loads;
  c.shortages = loads.filter(x => x.shortage || x.refused).map(x => ({ route: x.route, run: x.run, shift: x.shift, what: [x.shortage, x.refused ? 'Refused / returned' : ''].filter(Boolean).join(' · ') }));
  // Pickups: product that did not load on one of the day's loads (or written for the day); each goes to its load's shift.
  const seen = {};
  c.pickups = P.withNotePickups(rows, pickups || []).filter(p => text(p.status).toUpperCase() !== 'DELETED').map(p => {
    const i = rows.findIndex(r => P.pickupsFor(r, [p]).length);
    if (i < 0 && !(!p.runDocId && !p.runId && p.date === date)) return null;
    const k = p.pickupId || JSON.stringify(p);
    if (seen[k]) return null;
    seen[k] = true;
    return { route: text(p.route), run: text(p.run), product: text(p.item || p.product), quantity: text(p.quantity), open: P.pickupOpen(p), shift: i >= 0 ? loads[i].shift : shiftAt(stampMinute(p.createdAt), shifts) };
  }).filter(Boolean);
  const own = (journal || []).filter(d => d.date === date);
  c.breakdowns = U.shiftLog(own, nowMs, 24 * 3650).filter(r => text(r.type).toUpperCase() === 'BREAKDOWN')
    .map(r => ({ equipment: r.equipment || 'Plant equipment', entry: r.entry, status: r.status || 'OPEN', at: r.recordedAt, shift: shiftAt(stampMinute(r.recordedAt), shifts) }));
  c.tempsOut = U.tempReadings(own).filter(r => r.status === 'HIGH' || r.status === 'LOW')
    .map(r => ({ location: r.location || r.locationId, reading: r.manualTemperature !== '' ? r.manualTemperature : r.sensorTemperature, status: r.status, at: r.recordedAt, shift: shiftAt(stampMinute(r.recordedAt), shifts) }));
  c.qualityFails = own.filter(d => quality(d) && qualityFail(d)).map(d => { const p = d.payload || {}; return { line: text(p.line || p.area || p.operationId), product: text(p.product), what: [text(p.status), text(p.qualityCheck), text(p.tipTest) ? 'tip test ' + text(p.tipTest) : ''].filter(Boolean).join(' · '), at: d.recordedAt, shift: shiftAt(stampMinute(d.recordedAt), shifts) }; });
  return c;
}

/*
 * Shift Comparison (Joe 10/10): per shift over the days, the loads it loaded, on time, late, not loaded, minutes per load,
 * and the problems tied back to it: pickups, driver check-in shortages and refusals, breakdowns, temperatures out, quality fails.
 * Rates are per 100 loads, so a shift that loads more is not counted worse for it.
 */
export function shiftComparison(days, shifts) {
  const rows = shifts.map(sh => {
    const loads = [].concat(...days.map(d => d.loadList.filter(x => x.shift === sh.name)));
    const r = { shift: sh.name, start: sh.start, end: sh.end, loads: loads.length, onTime: 0, late: 0, notLoaded: 0, lateMinutes: 0, taken: 0, takenMinutes: 0 };
    loads.forEach(x => {
      if (x.result === 'ON TIME') r.onTime++; else if (x.result === 'LATE') { r.late++; r.lateMinutes += x.late; } else if (x.result === 'NOT LOADED') r.notLoaded++;
      if (x.taken !== null) { r.taken++; r.takenMinutes += x.taken; }
    });
    const mine = (list) => [].concat(...days.map(d => (d[list] || []).filter(x => x.shift === sh.name))).length;
    r.pickups = mine('pickups'); r.shortages = mine('shortages'); r.breakdowns = mine('breakdowns'); r.tempsOut = mine('tempsOut'); r.qualityFails = mine('qualityFails');
    r.judged = r.onTime + r.late + r.notLoaded;
    r.onTimePct = r.judged ? Math.round(r.onTime / r.judged * 100) : null;
    r.avgLate = r.late ? Math.round(r.lateMinutes / r.late) : null;
    r.avgTaken = r.taken ? Math.round(r.takenMinutes / r.taken) : null;
    r.problems = r.pickups + r.shortages + r.late + r.notLoaded;
    r.per100 = r.loads ? Math.round(r.problems / r.loads * 1000) / 10 : null;
    return r;
  });
  const notes = [], used = rows.filter(r => r.loads >= 3);
  if (used.length >= 2) {
    const worst = used.slice().sort((a, b) => b.per100 - a.per100)[0], best = used.slice().sort((a, b) => a.per100 - b.per100)[0];
    if (worst !== best && worst.per100 > 0 && worst.per100 >= best.per100 + 5)
      notes.push(worst.shift + ' has the most problems: ' + worst.per100 + ' for every 100 loads (late, not loaded, pickups and check-in shortages) against ' + best.per100 + ' on ' + best.shift + '.');
    const judged = used.filter(r => r.onTimePct !== null), slow = judged.slice().sort((a, b) => a.onTimePct - b.onTimePct)[0], fast = judged.slice().sort((a, b) => b.onTimePct - a.onTimePct)[0];
    if (slow && fast && fast.onTimePct - slow.onTimePct >= 5) notes.push(slow.shift + ' loads on time least: ' + slow.onTimePct + '% against ' + fast.onTimePct + '% on ' + fast.shift + '.');
  }
  return { rows, notes };
}

// Sunday to Saturday of the week holding `date`.
export function weekDates(date) { const s = L.weekStart(date); return [0, 1, 2, 3, 4, 5, 6].map(i => L.addDays(s, i)); }

// Totals over several days (a week): sums, and the shares worked out from the sums.
export function totals(days) {
  const t = { loads: 0, onTime: 0, late: 0, notLoaded: 0, noTime: 0, toCome: 0, lateMinutes: 0, takenMinutes: 0, taken: 0, pickups: 0, breakdowns: 0, tempsOut: 0, qualityFails: 0, shortages: 0 };
  days.forEach(d => {
    ['loads', 'onTime', 'late', 'notLoaded', 'noTime', 'toCome', 'lateMinutes', 'takenMinutes', 'taken'].forEach(k => { t[k] += d[k]; });
    t.pickups += d.pickups.length; t.breakdowns += d.breakdowns.length; t.tempsOut += d.tempsOut.length; t.qualityFails += d.qualityFails.length; t.shortages += (d.shortages || []).length;
  });
  t.judged = t.onTime + t.late + t.notLoaded;
  t.onTimePct = t.judged ? Math.round(t.onTime / t.judged * 100) : null;
  t.avgLate = t.late ? Math.round(t.lateMinutes / t.late) : null;
  t.avgTaken = t.taken ? Math.round(t.takenMinutes / t.taken) : null;
  return t;
}

/*
 * Day-of-week trends over finished days (days with loads that are all judged or past): per weekday, the on-time share,
 * the average minutes late and how many pickups, breakdowns, temperatures out and loads not loaded a day; then what stands out.
 */
export function weekdayTrends(days) {
  const used = days.filter(d => d.loads > 0 && d.judged > 0);
  const rows = WEEKDAYS.map((name, i) => {
    const mine = used.filter(d => String(L.dayName(d.date)).toUpperCase() === name), t = totals(mine), n = mine.length;
    const per = (v) => n ? Math.round(v / n * 10) / 10 : null;
    return { weekday: name, index: i, days: n, loads: n ? Math.round(t.loads / n) : null, onTimePct: t.onTimePct, avgLate: t.avgLate,
      pickups: per(t.pickups), breakdowns: per(t.breakdowns), tempsOut: per(t.tempsOut), notLoaded: per(t.notLoaded) };
  });
  const all = totals(used), counted = rows.filter(r => r.days > 0), notes = [];
  const avg = (key, list) => { const v = list.map(r => r[key]).filter(x => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const title = (r) => r.weekday.charAt(0) + r.weekday.slice(1).toLowerCase() + 's';
  if (counted.length >= 2) {
    const judged = counted.filter(r => r.onTimePct !== null), worst = judged.slice().sort((a, b) => a.onTimePct - b.onTimePct)[0];
    if (worst) {
      const others = avg('onTimePct', judged.filter(r => r !== worst));
      if (others !== null && others - worst.onTimePct >= 5) notes.push(title(worst) + ' run late most often: ' + worst.onTimePct + '% on time against ' + Math.round(others) + '% the other days.');
    }
    const most = counted.slice().sort((a, b) => (b.pickups || 0) - (a.pickups || 0))[0], pa = avg('pickups', counted.filter(r => r !== most));
    if (most && most.pickups > 0 && (pa === null || most.pickups >= pa * 1.3)) notes.push(title(most) + ' have the most pickups (product that did not load): ' + most.pickups + ' a day' + (pa !== null ? ' against ' + (Math.round(pa * 10) / 10) + ' the other days' : '') + '.');
    const brk = counted.slice().sort((a, b) => (b.breakdowns || 0) - (a.breakdowns || 0))[0], ba = avg('breakdowns', counted.filter(r => r !== brk));
    if (brk && brk.breakdowns > 0 && (ba === null || brk.breakdowns >= ba * 1.5)) notes.push(title(brk) + ' have the most breakdowns: ' + brk.breakdowns + ' a day.');
  }
  return { rows, days: used.length, all, notes, first: used.length ? used.map(d => d.date).sort()[0] : '' };
}

// The weeks (Sundays) whose run documents a set of load dates needs: a load date reads its own week and the next one.
export function weeksFor(from, to) {
  const out = [];
  for (let w = L.weekStart(from); w <= L.weekStart(L.addDays(to, 6)); w = L.addDays(w, 7)) out.push(w);
  return out;
}
export function datesBetween(from, to) { const out = []; for (let d = from; d <= to; d = L.addDays(d, 1)) out.push(d); return out; }
