/*
 * Joe 11/2: "some of my fuel wasn't recorded ... pull the information directly from the truck on the gallons used for that
 * particular trip ... for all the trucks for the complete whole month of October ... I do not want to retain all this
 * information more than a 6-month period." Then (11/2): "The GPS trip fuel sheet, I would like to have it on our other
 * storage place ... the Firebase storage instead of Google Sheets." So the trips live in the app's own database:
 *
 *   gpsTripFuel/<unit id>_<time it left>   one trip of one truck (from fleettrips.js tripSpan): unit, left and back with
 *                                          address and GPS spot, miles, odometer and fuel counter at both ends, fuel used,
 *                                          MPG, day (New York day it left)
 *   private/gpsTripFuel                    {lastDate: the last day stored, lastTrips, purged, at, error}
 *
 * Every run (every 30 minutes) stores the next days not stored yet, from BACKFILL_FROM (October 2026, as Joe asked) up to
 * yesterday, as many as fit in the run; once caught up it adds each new day the next morning. Then every trip that left
 * more than KEEP_DAYS ago is deleted. Only the server writes these; no screen reads them yet. A trip still out at midnight
 * is cut there and goes on as a new trip the next day ("Already out at the start of the day").
 */
'use strict';

const { tripSpan } = require('./fleettrips');
const { nyDate, addDays } = require('./fleetgps').internals;
const { safeIdPart } = require('./model');

const BACKFILL_FROM = '2026-10-01';
const KEEP_DAYS = 183; // six months
const DAY_BUDGET_MS = 6 * 60000; // a new day is started only with this much of the run left

const tripId = (t) => safeIdPart(String(t.unitId) + '_' + String(t.left).replace(/[^0-9T]/g, '')) || '';
function tripDoc(t, at) {
  const keep = ['tag', 'unitId', 'left', 'leftAddress', 'leftLat', 'leftLon', 'back', 'backAddress', 'backLat', 'backLon', 'miles',
    'odometerStart', 'odometerEnd', 'fuelCounterStart', 'fuelCounterEnd', 'fuelUsed', 'mpg', 'note'];
  const d = { day: nyDate(t.left), savedAt: at };
  keep.forEach(k => { d[k] = t[k] === undefined ? null : t[k]; });
  d.tag = String(d.tag || ''); d.unitId = String(d.unitId || '');
  return d;
}
/** The days still to store: the day after lastDate (or BACKFILL_FROM) through yesterday. */
function daysToStore(lastDate, today) {
  const out = [];
  for (let d = lastDate ? addDays(lastDate, 1) : BACKFILL_FROM; d < today; d = addDays(d, 1)) out.push(d);
  return out;
}

async function writeDocs(db, docs) {
  const ids = Object.keys(docs);
  for (let i = 0; i < ids.length; i += 400) {
    const b = db.batch();
    ids.slice(i, i + 400).forEach(id => b.set(db.collection('gpsTripFuel').doc(id), docs[id]));
    await b.commit();
  }
}
async function purge(db, cutoff) {
  let n = 0;
  for (;;) {
    const snap = await db.collection('gpsTripFuel').where('day', '<', cutoff).limit(400).get();
    if (snap.empty) return n;
    const b = db.batch();
    snap.docs.forEach(x => b.delete(x.ref));
    await b.commit();
    n += snap.size;
  }
}

/** One run. Does nothing without a Fleet login. budgetMs: how long the run may go on starting new days. */
async function dailyTripFuel({ db, now, options, budgetMs }) {
  const began = Date.now(), at = (now || new Date()).toISOString(), today = nyDate(at);
  const login = (await db.collection('private').doc('gpsFleet').get()).data() || {};
  if (!login.fleet || !login.user || !login.password) return { skipped: 'no login' };
  const ref = db.collection('private').doc('gpsTripFuel'), state = (await ref.get()).data() || {};
  const out = { stored: [] };
  try {
    for (const day of daysToStore(state.lastDate, today)) {
      if (Date.now() - began > (budgetMs || 0)) break;
      const r = await tripSpan(db, { from: day, to: day }, options);
      const docs = {};
      r.trips.forEach(t => { const id = tripId(t); if (id) docs[id] = tripDoc(t, at); });
      await writeDocs(db, docs);
      await ref.set({ lastDate: day, lastTrips: Object.keys(docs).length, at, error: '' }, { merge: true });
      out.stored.push(day);
    }
    out.purged = await purge(db, addDays(today, -KEEP_DAYS));
    await ref.set({ purged: out.purged, purgedAt: at }, { merge: true });
    return out;
  } catch (e) {
    const error = String(e && e.message || e).slice(0, 300);
    await ref.set({ error, errorAt: at }, { merge: true });
    return Object.assign(out, { error });
  }
}

module.exports = { BACKFILL_FROM, KEEP_DAYS, DAY_BUDGET_MS, dailyTripFuel, tripDoc, tripId, daysToStore };
