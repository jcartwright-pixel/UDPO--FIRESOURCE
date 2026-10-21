// Joe 10/19 (Late Forecast): the same weekday's earlier nights (last Monday against this Monday, up to 4 weeks back), read once
// for the operating day. Each night is that day's Loadout Center rows, so a past night's times are read the same way as tonight's.
import { collection, query, where, getDocsLater } from './firebase.js';
import * as P from './plant-core.js';

const L = window.UDLogic, U = window.UDPlant;

// Joe 10/21 (Plant Distribution slow again): those weeks are several whole weeks of runs, so the nights worked out from them
// are kept on this computer for the operating day; Manager Center reads them once a day, not on every open, and never waits
// for them (the tile fills in when they come).
const KEEP = 'udForecastNights';
export async function readForecastNights(db, date) {
  try { const kept = JSON.parse(localStorage.getItem(KEEP) || 'null'); if (kept && kept.date === date && Array.isArray(kept.nights)) return kept.nights; } catch (e) { /* no storage */ }
  const nights = U.forecastNights(date), weeks = [...new Set([].concat(...nights.map(d => L.weeksForLoadDate(d))))];
  const snap = await getDocsLater(query(collection(db, 'runs'), where('weekStart', 'in', weeks)));
  const runs = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
  const out = nights.map(d => ({ date: d, loads: P.loadoutRows(runs, d, d) }));
  try { localStorage.setItem(KEEP, JSON.stringify({ date, nights: out })); } catch (e) { /* no storage, or full */ }
  return out;
}
