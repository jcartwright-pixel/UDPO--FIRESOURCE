/*
 * Move Stops for This Week (Joe 11-13-26, mock-up ll): "after I make the schedule ... can I hit that button and it will
 * automatically move the stops to those days or eliminate stops that do not justify a delivery that week? If they're like
 * getting 3, cut it down to 2, getting 2, cut it down to 1, only by volumes that we set up. I don't want to cut customers
 * short, and then spit out the changes so I can print." And: "there might be Dairy Queens or seasonal that is no longer
 * buying at the time. So the previous 3 weeks, if extremely low volume or no volumes, then we can go ahead and just eliminate
 * them for that week." And: "Ability to change it to a different route in a different day by reviewing before we print."
 *
 * Shared by the server (actions-weekly.js checks a saved list) and Route Week Override (the preview). Copied to public/js by
 * npm run sync-logic. One week only: the Customer List and Route Master are never changed.
 *
 *   stops   every delivery in the normal week, from the Hub's route customer list: [{ route, day ('mon'), stop, account,
 *           customer, chain, weeks: [cases on that day in each of the last 3 report weeks, newest first] }]
 *   runsOn  (route, day) => true when that route runs that day this week (Route Week Override's grid)
 *   rules   { skipUnder, cutTo2Under, cutTo1Under, maxPerDelivery }: cases a week (the last 3 weeks' average); 0 turns a rule off
 *
 * plan() gives one line per normal delivery that changes: { route, account, customer, chain, fromDay, toRoute, toDay, kind, why,
 * cases, weeks } where toDay '' means no delivery this week (kind 'skip'), and kind is 'move' (to a day the customer does not
 * get), 'join' (its cases ride on a delivery the customer already gets) or 'cut' (a join because the week's cases are low).
 * Every case still goes out: a delivery that is joined or cut adds its cases to the one it joins.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./logic'));
  else root.UDHolidayStops = factory(root.UDLogic);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (L) {
  'use strict';
  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const WEEKS = 3;
  // Starting numbers, until Joe sets his own on Holiday Stop Rules (cases a week, average of the last 3 weeks).
  const DEFAULT_RULES = Object.freeze({ skipUnder: 3, cutTo2Under: 60, cutTo1Under: 30, maxPerDelivery: 80 });
  const RULE_KEYS = Object.keys(DEFAULT_RULES);

  const num = (v) => { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; };
  const r1 = (n) => Math.round(n * 10) / 10;
  const routeKey = (r) => L.routeNumber(r);
  /** Joe's numbers, each a whole number from 0 to 9999; anything missing is the starting number. */
  function rules(saved) {
    const out = {};
    RULE_KEYS.forEach(k => {
      const v = saved && saved[k] !== undefined && saved[k] !== null && saved[k] !== '' ? Number(saved[k]) : DEFAULT_RULES[k];
      out[k] = isFinite(v) && v >= 0 ? Math.min(9999, Math.round(v)) : DEFAULT_RULES[k];
    });
    return out;
  }
  /** The average of the last 3 weeks for one delivery; a week with no sale counts as 0. */
  function average(weeks) {
    const w = (weeks || []).slice(0, WEEKS).map(num);
    while (w.length < WEEKS) w.push(0);
    return r1(w.reduce((a, b) => a + b, 0) / WEEKS);
  }
  // The days of the week nearest to `day`, the day before first (the load is there before it is needed).
  function nearest(day) {
    const i = DAYS.indexOf(day), out = [];
    for (let k = 1; k < 7; k++) { if (i - k >= 0) out.push(DAYS[i - k]); if (i + k < 7) out.push(DAYS[i + k]); }
    return out;
  }
  const dayName = (p) => ({ sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' })[p] || p;

  /** One customer on one route: its normal deliveries, what each carries, and where each goes this week. */
  function planOne(list, runsOn, R) {
    const route = list[0].route, days = list.slice().sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day));
    const avg = {}; days.forEach(s => { avg[s.day] = average(s.weeks); });
    const week = r1(days.reduce((a, s) => a + avg[s.day], 0)), n = days.length;
    const base = (s) => ({ route, account: s.account, customer: s.customer, chain: s.chain || '', fromDay: s.day, cases: avg[s.day], weeks: (s.weeks || []).slice(0, WEEKS) });
    // Seasonal or stopped buying: nothing goes this week.
    if (R.skipUnder && week < R.skipUnder) {
      return days.map(s => Object.assign(base(s), { toRoute: '', toDay: '', kind: 'skip', why: week ? 'Only ' + week + ' cases a week in the last 3 weeks' : 'No cases in the last 3 weeks' }));
    }
    // How many deliveries this customer needs this week: one fewer only when the week's cases are under Joe's number.
    let want = n;
    if (n >= 3 && R.cutTo2Under && week < R.cutTo2Under) want = n - 1;
    else if (n === 2 && R.cutTo1Under && week < R.cutTo1Under) want = 1;
    const load = {}, goes = {};   // load: cases on each delivery day this week; goes: fromDay -> { toDay, kind, why }
    days.forEach(s => { if (runsOn(route, s.day)) load[s.day] = avg[s.day]; });
    const cap = R.maxPerDelivery || Infinity;
    const count = () => Object.keys(load).length;
    // A normal day the route does not run this week: join a delivery the customer still gets when it needs fewer this week and
    // the load fits, else move to the nearest day the route runs that the customer does not get, else join anyway (named).
    days.filter(s => !runsOn(route, s.day)).forEach(s => {
      const c = avg[s.day], order = nearest(s.day);
      const join = order.find(p => load[p] !== undefined && load[p] + c <= cap);
      const free = order.find(p => load[p] === undefined && runsOn(route, p));
      if (join && count() + 1 > want) { load[join] = r1(load[join] + c); goes[s.day] = { toDay: join, kind: 'join', why: dayName(s.day) + ' does not run; rides on ' + dayName(join) }; }
      else if (free) { load[free] = c; goes[s.day] = { toDay: free, kind: 'move', why: dayName(s.day) + ' does not run' }; }
      else {
        const any = order.find(p => load[p] !== undefined) || '';
        if (any) { load[any] = r1(load[any] + c); goes[s.day] = { toDay: any, kind: 'join', why: dayName(s.day) + ' does not run; rides on ' + dayName(any) + (load[any] > cap ? '. Over ' + cap + ' cases: check it' : '') }; }
        else goes[s.day] = { toDay: '', kind: 'skip', why: 'The route does not run any day this customer gets. Pick a route and day' };
      }
    });
    // Still more deliveries than it needs: the smallest delivery rides on the nearest other one, while it fits.
    while (count() > want && count() > 1) {
      const pick = Object.keys(load).sort((a, b) => load[a] - load[b] || DAYS.indexOf(b) - DAYS.indexOf(a))
        .map(p => ({ p, to: nearest(p).find(q => load[q] !== undefined && load[q] + load[p] <= cap) })).find(x => x.to);
      if (!pick) break;
      load[pick.to] = r1(load[pick.to] + load[pick.p]);
      // Whatever had moved onto the day that is cut goes along with it.
      const why = n + ' deliveries down to ' + want + ': ' + week + ' cases a week';
      Object.keys(goes).forEach(f => { if (goes[f].toDay === pick.p) goes[f] = { toDay: pick.to, kind: 'cut', why: goes[f].why + '. ' + why }; });
      if (avg[pick.p] !== undefined && !goes[pick.p]) goes[pick.p] = { toDay: pick.to, kind: 'cut', why };
      delete load[pick.p];
    }
    return days.filter(s => goes[s.day]).map(s => Object.assign(base(s), { toRoute: goes[s.day].toDay ? route : '', toDay: goes[s.day].toDay, kind: goes[s.day].kind, why: goes[s.day].why }));
  }

  /** Every change for the week, by route, then customer, then day. */
  function plan(stops, runsOn, saved) {
    const R = rules(saved), by = {};
    (stops || []).forEach(s => {
      if (!s || DAYS.indexOf(s.day) < 0 || !String(s.account || '').trim()) return;
      const k = routeKey(s.route) + '|' + String(s.account).trim();
      (by[k] = by[k] || []).push(Object.assign({}, s, { route: routeKey(s.route), account: String(s.account).trim() }));
    });
    const out = [];
    Object.keys(by).forEach(k => {
      // A customer twice on the same route day counts once.
      const seen = {}, list = by[k].filter(s => !seen[s.day] && (seen[s.day] = true));
      planOne(list, (r, p) => !!runsOn(r, p), R).forEach(x => out.push(x));
    });
    return out.sort(order);
  }
  function order(a, b) {
    return String(a.route).localeCompare(String(b.route), undefined, { numeric: true }) || String(a.customer).localeCompare(String(b.customer)) || DAYS.indexOf(a.fromDay) - DAYS.indexOf(b.fromDay);
  }

  /**
   * The week as it will be delivered: each route day's customers with what they carry this week, after the changes (a change
   * picked by hand included). Used for the cases-on-the-new-day column and the printout.
   */
  function deliveries(stops, changes) {
    const moved = {}, out = {};
    (changes || []).forEach(c => { moved[routeKey(c.route) + '|' + c.account + '|' + c.fromDay] = c; });
    (stops || []).forEach(s => {
      const route = routeKey(s.route), account = String(s.account || '').trim(), c = moved[route + '|' + account + '|' + s.day];
      const to = c ? (c.toDay ? routeKey(c.toRoute) + '|' + c.toDay : '') : route + '|' + s.day;
      if (!to) return;
      const k = to + '|' + account;
      out[k] = out[k] || { route: to.split('|')[0], day: to.split('|')[1], account, customer: s.customer, cases: 0 };
      out[k].cases = r1(out[k].cases + average(s.weeks));
    });
    return out;
  }

  /** A change list as saved: checked, at most 3000 lines, plain text only. */
  function cleanChanges(list) {
    if (!Array.isArray(list)) return null;
    const t = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
    const out = [];
    for (const c of list.slice(0, 3000)) {
      if (!c || DAYS.indexOf(c.fromDay) < 0) return null;
      const toDay = c.toDay ? String(c.toDay) : '';
      if (toDay && DAYS.indexOf(toDay) < 0) return null;
      const kind = ['move', 'join', 'cut', 'skip', 'hand'].indexOf(c.kind) >= 0 ? c.kind : 'hand';
      const x = { route: routeKey(t(c.route, 20)), account: t(c.account, 30), customer: t(c.customer, 80), chain: t(c.chain, 30), fromDay: c.fromDay,
        toRoute: toDay ? routeKey(t(c.toRoute, 20)) : '', toDay, kind: toDay ? kind : 'skip', why: t(c.why, 160), cases: r1(num(c.cases)),
        weeks: (Array.isArray(c.weeks) ? c.weeks : []).slice(0, WEEKS).map(v => r1(num(v))) };
      if (!x.route || !x.account || (toDay && !x.toRoute)) return null;
      out.push(x);
    }
    return out;
  }

  /** Joe's notes, one per customer on its own route (route|account): plain text, at most 300 letters each, 3000 notes. */
  function cleanNotes(notes) {
    const out = {};
    if (!notes || typeof notes !== 'object' || Array.isArray(notes)) return out;
    Object.keys(notes).slice(0, 3000).forEach(k => {
      const key = String(k).replace(/[\u0000-\u001f/.]/g, ' ').trim().slice(0, 60), v = String(notes[k] == null ? '' : notes[k]).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300);
      if (key && v) out[key] = v;
    });
    return out;
  }
  /** The routes ticked to be in the plan, or null for every route. */
  function cleanRoutes(list) {
    if (!Array.isArray(list)) return null;
    const seen = {};
    return list.slice(0, 500).map(r => routeKey(String(r == null ? '' : r).trim().slice(0, 20))).filter(r => r && !seen[r] && (seen[r] = true));
  }

  return { DAYS, WEEKS, DEFAULT_RULES, RULE_KEYS, rules, average, plan, deliveries, cleanChanges, cleanNotes, cleanRoutes, routeKey };
});
