// Joe 10/19 (Late Forecast): the same weekday's earlier nights (last Monday against this Monday, up to 4 weeks back), read once
// for the operating day. Each night is that day's Loadout Center rows, so a past night's times are read the same way as tonight's.
import { collection, query, where, getDocsLater } from './firebase.js';
import * as P from './plant-core.js';

const L = window.UDLogic, U = window.UDPlant;

// Joe 10/21 (Plant Distribution slow again): those weeks are several whole weeks of runs, so the nights worked out from them
// are kept on this computer for the operating day; Manager Center reads them once a day, not on every open, and never waits
// for them (the tile fills in when they come).
const KEEP = 'udForecastNights';
// Joe 11-7-26 (option lf, "this is every day"): the same weeks hold every night of the last 4 weeks, so those nights come too
// (allNights), kept small: only their finished case loads' counts and times, for the speed by hour of the night. The list
// handed back is the same weekday's nights, with allNights on it.
const DONE_FIELDS = ['area', 'state', 'quantity', 'startedAt', 'completedAt', 'pauseMark'];
const slim = (rows) => rows.filter(r => r.area === 'CASE' && r.state === 'DONE').map(r => { const o = {}; DONE_FIELDS.forEach(k => { if (r[k] !== undefined) o[k] = r[k]; }); return o; });
const withAll = (nights, allNights) => Object.assign(nights, { allNights });
export async function readForecastNights(db, date) {
  try { const kept = JSON.parse(localStorage.getItem(KEEP) || 'null'); if (kept && kept.date === date && Array.isArray(kept.nights) && Array.isArray(kept.allNights)) return withAll(kept.nights, kept.allNights); } catch (e) { /* no storage */ }
  const nights = U.forecastNights(date), weeks = [...new Set([].concat(...nights.map(d => L.weeksForLoadDate(d))))];
  const snap = await getDocsLater(query(collection(db, 'runs'), where('weekStart', 'in', weeks)));
  const runs = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
  const out = nights.map(d => ({ date: d, loads: P.loadoutRows(runs, d, d) }));
  const days = []; for (let i = 1; i <= 7 * U.FORECAST.weeksBack; i++) days.push(L.addDays(date, -i));
  const allNights = days.map(d => ({ date: d, loads: slim(P.loadoutRows(runs, d, d)) })).filter(n => n.loads.length);
  try { localStorage.setItem(KEEP, JSON.stringify({ date, nights: out, allNights })); } catch (e) { /* no storage, or full */ }
  return withAll(out, allNights);
}
