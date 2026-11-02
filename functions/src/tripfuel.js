/*
 * Joe 11/2: "some of my fuel wasn't recorded ... pull the information directly from the truck on the gallons used for that
 * particular trip ... put it in a spreadsheet for [my fuel import program] to then pull ... I do not want to retain all this
 * information more than a 6-month period." Joe OK'd (11/2, "yes, create GPS trip fuel") a separate Google Sheet,
 * "GPS Trip Fuel", that nothing else in the app reads or writes.
 *
 * Each morning (production only, and never while Pause writing to the sheets is on): every truck's trips for yesterday,
 * from Verizon Fleet (fleettrips.js tripSpan), added under the last row of its Trips tab, one row per trip. Then every row
 * whose trip left the yard more than KEEP_DAYS ago is deleted. State: private/gpsTripFuel {lastDate, lastRows, lastPurged,
 * error}. The sheet must be shared with the server account as Editor.
 */
'use strict';

const { tripSpan } = require('./fleettrips');
const { nyDate, addDays } = require('./fleetgps').internals;

const GPS_TRIP_FUEL = Object.freeze({ spreadsheetId: '17f80qu8x_XQpJ9g3ye_MCU6RUB3NB67vbdQj8zrFslU', tab: 'Trips' });
const KEEP_DAYS = 183; // six months
const HEAD = ['Unit', 'Left yard', 'Left from address', 'Left from lat', 'Left from lon', 'Back in yard', 'Back at address', 'Back at lat', 'Back at lon',
  'Trip miles (GPS)', 'Odometer start', 'Odometer end', 'Fuel counter start (gal)', 'Fuel counter end (gal)', 'Fuel used (gal)', 'Trip MPG', 'Note'];

/** "10-31-26 9:27 AM", New York time. */
function nyText(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' })
    .replace(/\//g, '-').replace(',', '');
}
const cell = (v) => v === null || v === undefined ? '' : v;
function tripRow(t) {
  return [t.tag, nyText(t.left), t.leftAddress, t.leftLat, t.leftLon, nyText(t.back), t.backAddress, t.backLat, t.backLon, t.miles,
    t.odometerStart, t.odometerEnd, t.fuelCounterStart, t.fuelCounterEnd, t.fuelUsed, t.mpg, t.note].map(cell);
}
/** The yyyy-mm-dd day of a "10-31-26 9:27 AM" cell, or ''. */
function rowDay(text) {
  const m = /^(\d{1,2})-(\d{1,2})-(\d{2})\b/.exec(String(text || '').trim());
  return m ? '20' + m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0') : '';
}
/** Sheet row numbers (1-based, heading is row 1) to delete: trips that left before cutoff. column = the Left yard cells from row 2. */
function oldRows(column, cutoff) {
  const out = [];
  (column || []).forEach((r, i) => { const d = rowDay(r && r[0]); if (d && d < cutoff) out.push(i + 2); });
  return out;
}
/** Runs of rows as deleteDimension requests, last first so earlier row numbers stay right. */
function deleteRequests(sheetId, rows) {
  const runs = [];
  rows.slice().sort((a, b) => a - b).forEach(r => { const last = runs[runs.length - 1]; if (last && last[1] === r - 1) last[1] = r; else runs.push([r, r]); });
  return runs.reverse().map(([a, b]) => ({ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: a - 1, endIndex: b } } }));
}

/** One morning. sheets = makeSheetsWriter(). Does nothing for a day already added. */
async function dailyTripFuel({ db, sheets, now, options }) {
  const at = (now || new Date()).toISOString(), day = addDays(nyDate(at), -1);
  const ref = db.collection('private').doc('gpsTripFuel'), state = (await ref.get()).data() || {};
  const target = GPS_TRIP_FUEL, out = { day };
  try {
    if (!state.lastDate || state.lastDate < day) {
      const r = await tripSpan(db, { from: day, to: day }, options);
      const rows = r.trips.slice().sort((a, b) => (a.left < b.left ? -1 : a.left > b.left ? 1 : 0)).map(tripRow);
      if (rows.length) await sheets.append(target.spreadsheetId, target.tab + '!A1', rows);
      out.rows = rows.length;
    }
    const cutoff = addDays(nyDate(at), -KEEP_DAYS);
    const [column] = await sheets.batchGet(target.spreadsheetId, [target.tab + '!B2:B']);
    const old = oldRows(column, cutoff);
    if (old.length) {
      const tab = (await sheets.tabs(target.spreadsheetId)).find(t => t.title === target.tab);
      if (tab) await sheets.structure(target.spreadsheetId, deleteRequests(tab.sheetId, old));
    }
    out.purged = old.length;
    await ref.set({ lastDate: out.rows === undefined ? state.lastDate : day, lastRows: out.rows === undefined ? (state.lastRows || 0) : out.rows, lastPurged: old.length, at, error: '' }, { merge: true });
    return out;
  } catch (e) {
    await ref.set({ error: String(e && e.message || e).slice(0, 300), errorAt: at }, { merge: true });
    return Object.assign(out, { error: String(e && e.message || e).slice(0, 300) });
  }
}

module.exports = { GPS_TRIP_FUEL, KEEP_DAYS, HEAD, dailyTripFuel, tripRow, rowDay, oldRows, deleteRequests, nyText };
