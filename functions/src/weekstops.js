/*
 * Move Stops for This Week (Joe 11-13-26, mock-up ll; rules in holiday-stops.js): what Route Week Override needs to work out
 * the week's stop changes. Asking, not saving.
 *
 *   stops      every delivery in the normal week, from the Hub's route customer list (hubRouteMaster, active customers only;
 *              Joe 11-9-26: the route customer list is read only through the Hub), each with its cases on that day in the last
 *              3 weekly route reports (routeWeekly, newest first; a week with no sale is 0)
 *   weeks      those 3 report weeks (week ending), newest first
 *   rules      Joe's case limits (config/holidayStopRules, else the starting numbers)
 *   saved      the week's changes as last used (weekStopMoves/<week>), or null
 *   hub        false when the Hub has not written this plant's route customer list yet
 */
'use strict';

const H = require('./holiday-stops');
const DAY = { SUN: 'sun', MON: 'mon', TUE: 'tue', WED: 'wed', THU: 'thu', FRI: 'fri', SAT: 'sat' };
const text = (v) => String(v == null ? '' : v).trim();

/** The newest report weeks that ended before the week being planned. */
function lastWeeks(docs, weekStart, n) {
  return docs.filter(d => text(d.week_ending) && text(d.week_ending) < weekStart).sort((a, b) => (a.week_ending < b.week_ending ? 1 : -1)).slice(0, n);
}

/** Pure: the stops with their last 3 weeks, from the Hub's rows and the report weeks (newest first). */
function stopsWithWeeks(rows, weeks) {
  const by = weeks.map(w => { const m = {}; (w.stops || []).forEach(s => { m[text(s.route) + '|' + text(s.customer_no)] = s; }); return m; });
  return (rows || []).map(r => {
    const day = DAY[text(r.dayName).toUpperCase()] || H.DAYS[Number(r.day)] || '';
    const k = H.routeKey(r.route) + '|' + text(r.account);
    return { route: H.routeKey(r.route), day, stop: Number(r.stop) || 0, account: text(r.account), customer: text(r.customer), chain: text(r.chain),
      weeks: by.map(m => { const s = m[k]; return s && day ? Math.round((Number(s[day]) || 0) * 10) / 10 : 0; }) };
  }).filter(s => s.day && s.account);
}

async function weekStops(db, cdb, plant, weekStart) {
  const HR = require('./hubroutes');
  const [rm, report, rulesSnap, savedSnap] = await Promise.all([HR.routeMaster(cdb, plant),
    cdb.collection('routeWeekly').where('week_ending', '<', weekStart).orderBy('week_ending', 'desc').limit(H.WEEKS).get(), db.collection('config').doc('holidayStopRules').get(), db.collection('weekStopMoves').doc(weekStart).get()]);
  const weeks = lastWeeks(report.docs.map(d => d.data()), weekStart, H.WEEKS);
  return { stops: rm ? stopsWithWeeks(rm.rows, weeks) : [], weeks: weeks.map(w => w.week_ending), hub: !!rm,
    rules: H.rules(rulesSnap.exists ? rulesSnap.data() : null), saved: savedSnap.exists ? savedSnap.data() : null };
}

module.exports = { weekStops, stopsWithWeeks, lastWeeks };
