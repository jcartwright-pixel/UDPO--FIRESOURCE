/*
 * The Driver Room TV's Driver Scorecard (Joe 10/27: the board's right-hand box takes turns, 30 seconds of live weather and
 * 30 seconds of the Driver Scorecard). The TV signs in with its own station code, which may not read the scorecard's lists
 * (loads, GPS, accidents, ...), so every 15 minutes the server builds the month's board the same way the Driver Scorecard
 * screen does (sc-core.js scBoard_) and keeps only what the TV shows in scorecard/kiosk: each driver's overall score and
 * grade, best first, and the grades of the areas ticked on Settings > Areas shown on kiosk.
 */
'use strict';

const L = require('./logic');
const S = require('./sc-core');
const { findLiveWeather } = require('./live-weather');

const HOME_FACILITY = 'fac_uniontown';
const all = async (q) => (await q.get()).docs.map(d => Object.assign({ id: d.id }, d.data()));

// view: {mode, year, month, weekStart, today}; the month so far unless a check asks for another.
async function buildKioskScores({ db, now = new Date(), view = null }) {
  const today = L.operatingDay(now);
  const v = view || { mode: 'month', year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)), today };
  v.today = v.today || today;
  const p = v.mode === 'week' ? S.scWeekRange_(v.weekStart) : S.scMonthRange_(v.year, v.month);
  // The same days the screen reads: a run's GPS is the day it leaves, so 2 days either side of the period.
  const from = S.scAddDays_(p.start, -2), to = S.scAddDays_(p.end, 2);
  const range = (name) => db.collection(name).where('date', '>=', p.start).where('date', '<=', p.end);
  const [settingsDoc, runs, events, gpsDays, gpsAlerts, anyAlert, drivers, exceptions, ratings, incidents, excuses, routes, equipment] = await Promise.all([
    db.collection('scorecard').doc('settings').get(),
    all(db.collection('runs').where('weekStart', '>=', L.weekStart(from)).where('weekStart', '<=', to)),
    all(db.collection('plantEvents').where('date', '>=', from).where('date', '<=', to)),
    all(range('gpsDays')), all(range('gpsAlerts')), db.collection('gpsAlerts').limit(1).get(),
    all(db.collection('drivers')), all(db.collection('exceptions')), all(db.collection('scorecardRatings')),
    all(db.collection('driverIncidents')), all(db.collection('scorecardExcuses')), all(db.collection('routes')), all(db.collection('equipment'))
  ]);
  const s = S.scSettings_(settingsDoc.exists ? settingsDoc.data() : {});
  // Only Uniontown's units can wait under No driver dispatched (the screen's Equipment Master list).
  const units = equipment.filter(e => (!e.facilityId || e.facilityId === HOME_FACILITY) && (e.type === 'TRUCK' || e.type === 'TRAILER')).map(e => e.unit);
  const board = S.scBoard_(L, { runs, events, gpsDays, gpsAlerts, drivers, exceptions, ratings, incidents, excuses, routes, units, alertsEver: !anyAlert.empty }, s, v);
  const label = v.mode === 'week' ? 'Week of ' + v.weekStart : S.SC_CORE.MONTHS[v.month - 1].slice(0, 3) + ' ' + String(v.year).slice(-2);
  return { label, through: board.through, areas: (s.kioskAreas || []).slice(), rows: S.scKioskRows_(board, s) };
}

// The FOX Weather video the TV plays (live-weather.js) goes with the scores, in the one document the TV may read.
async function writeKioskScores({ db, now = new Date(), findLive = findLiveWeather }) {
  const [k, live] = await Promise.all([buildKioskScores({ db, now }), findLive({ now })]);
  await db.collection('scorecard').doc('kiosk').set(Object.assign(k, { live, at: now.toISOString() }));
  return k;
}

module.exports = { buildKioskScores, writeKioskScores };
