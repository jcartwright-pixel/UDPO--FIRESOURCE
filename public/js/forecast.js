// Joe 10/19 (Late Forecast): the same weekday's earlier nights (last Monday against this Monday, up to 4 weeks back), read once
// for the operating day. Each night is that day's Loadout Center rows, so a past night's times are read the same way as tonight's.
import { collection, query, where, getDocs } from './firebase.js';
import * as P from './plant-core.js';

const L = window.UDLogic, U = window.UDPlant;

export async function readForecastNights(db, date) {
  const nights = U.forecastNights(date), weeks = [...new Set([].concat(...nights.map(d => L.weeksForLoadDate(d))))];
  const snap = await getDocs(query(collection(db, 'runs'), where('weekStart', 'in', weeks)));
  const runs = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
  return nights.map(d => ({ date: d, loads: P.loadoutRows(runs, d, d) }));
}
