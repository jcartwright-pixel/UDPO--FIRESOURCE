/*
 * United Dairy Distribution app: Route Master and Driver Master saves reaching the Current and Next Live weeks (D6), shared by the
 * Route Editor and the driver saves (split out of actions.js, review item 81 (Joe 10/13)).
 */
'use strict';

const L = require('./logic');
const M = require('./model');
const { queueCells, dayCells, TIME_FIELDS } = require('./actions-common');

const C = M.COLLECTIONS;

/*
 * D6: Route Master and Driver Master saves reach the Current and Next Live weeks, as the current app's 7.0.267 does (Joe 10/5: "when i
 * change and add a run on the route change menu it should add to the live sheet and the route master"; udpoV7267RouteMasterToLive_ and
 * udpoV7267DriverMasterToLive_, 207_V780_HybridDataRouters.gs). Only days not loaded yet (load day today or later). A day changed by
 * hand keeps it: route_override keeps RUNS, the time overrides keep the times, route_hours_override the hours, equipment_override the
 * truck and trailer. Reads first (liveRead), then the writes (writeLive), as a transaction needs.
 */
const OVERRIDE_DAY = { route_override: 'routeOverride', equipment_override: 'equipmentOverride', dispatch_time_override: 'dispatchTimeOverride' };
const byHand = (run, p, col) => L.yes(((run.days && run.days[p]) || {})[OVERRIDE_DAY[col]]) || L.yes((run.cells || {})[p + '_' + col]);
const loadDay = (week, p, offset) => L.addDays(week, L.DAYS.indexOf(p) + (Number.isFinite(Number(offset)) && offset !== null && offset !== '' ? Number(offset) : 0));
const LIVE_RUN_COLUMNS = {};
M.RUN_FIELDS.forEach(([field, col]) => { if (M.APP_ONLY_RUN_FIELDS.indexOf(field) < 0) LIVE_RUN_COLUMNS[field] = col; });

// runId given: that run's Live rows; else every run of the two weeks.
async function liveRead(tx, db, runId) {
  const cfg = await tx.get(db.collection(C.config).doc('app'));
  const w = (cfg.exists && cfg.data().liveWeeks) || {};
  const weeks = [w.current, w.next].filter(Boolean);
  const [runSnap, eqSnap] = await Promise.all([weeks.length ? tx.get(runId ? db.collection(C.runs).where('runId', '==', runId) : db.collection(C.runs).where('weekStart', 'in', weeks)) : null,
    tx.get(db.collection(C.equipment))]);
  const units = eqSnap.docs.map(d => d.data());
  const unit = (v, type) => { const k = String(v || '').trim().toUpperCase(); return k ? units.find(e => e.type === type && (String(e.id).toUpperCase() === k || String(e.unit).toUpperCase() === k)) || null : null; };
  // Route names (Joe 10/12) reach the Previous week too, and stream_id / route / route_run_type as well, only once
  // config/app.routeNamesLive.enabled is on (Joe's typed OK for those Live columns and tabs).
  const namesLive = !!(cfg.exists && cfg.data().routeNamesLive && cfg.data().routeNamesLive.enabled === true);
  const previous = runId && namesLive && w.previous && runSnap ? runSnap.docs.filter(s => s.data().weekStart === w.previous && s.data().sourceTab === M.LIVE_TABS.previous) : [];
  return { weeks, runs: runSnap ? runSnap.docs.filter(s => weeks.indexOf(s.data().weekStart) >= 0) : [], previous, namesLive, unit, tabs: { [w.current]: M.LIVE_TABS.current, [w.next]: M.LIVE_TABS.next } };
}

// One Live run's changes ({run: {field: v}, days: {p: {field: v}}}) as one update and, with the write-back on, one queued row.
function writeLive(tx, db, mode, req, stamp, email, snap, run, ch, result) {
  const ps = Object.keys(ch.days).filter(p => Object.keys(ch.days[p]).length);
  if (!ps.length && !Object.keys(ch.run).length) return;
  const update = { rev: run.rev + 1, testEdited: true, editedAt: stamp }, cells = {};
  Object.keys(ch.run).forEach(k => { const v = ch.run[k]; update[k] = v; if (!LIVE_RUN_COLUMNS[k]) return; cells[LIVE_RUN_COLUMNS[k]] = typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v); });
  ps.forEach(p => {
    Object.keys(ch.days[p]).forEach(k => { update['days.' + p + '.' + k] = ch.days[p][k]; });
    update['days.' + p + '.updatedAt'] = stamp; update['days.' + p + '.updatedBy'] = email;
    Object.assign(cells, dayCells(p, ch.days[p], stamp, email));
  });
  tx.update(snap.ref, update);
  if (mode.writeBack) queueCells(tx, db, req.requestId, 'L' + result.runs.length, run, snap.id, cells, stamp, email);
  result.runs.push({ runDocId: snap.id, rev: run.rev + 1 });
  result.liveWeeks.updated++;
}

const hoursNumber = (h) => { const t = String(h == null ? '' : h).trim(), m = t.match(/^(\d{1,2}):(\d{2})$/); const n = m ? Number(m[1]) + Number(m[2]) / 60 : Number(t); return t && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; };

// One run's Route Master standards into its Live rows of the two weeks; a run with no Live row in a week gets one.
// Route names (Joe 10/12): Route Name and Run follow Route Master into the Live rows; with config/app.routeNamesLive on, so do
// stream_id, route and route_run_type, and the Previous week gets the names too (names only). A name this save set goes
// across even when blank (a Run left empty when Run Type says Load 1); others only when Route Master has one.
const LIVE_NAME_FIELDS = ['routeName', 'run'], LIVE_MORE_NAMES = ['streamId', 'route', 'routeRunType'];
function liveNames(m, run, req, live) {
  const out = {}, set = (req && req.fields) || {};
  LIVE_NAME_FIELDS.concat(live.namesLive ? LIVE_MORE_NAMES : []).forEach(f => {
    const v = String(m[f] == null ? '' : m[f]).trim();
    if ((v || f in set) && String(run[f] == null ? '' : run[f]).trim() !== v) out[f] = v;
  });
  return out;
}
function routeToLive(tx, db, mode, req, stamp, email, m, live, result) {
  const today = L.operatingDay(new Date(stamp));
  (live.previous || []).forEach(s => { const ch = liveNames(m, s.data(), req, live); if (Object.keys(ch).length) writeLive(tx, db, mode, req, stamp, email, s, s.data(), { run: ch, days: {} }, result); });
  live.weeks.forEach(week => {
    const rows = live.runs.filter(s => s.data().weekStart === week);
    if (!rows.length) return addLiveRun(tx, db, mode, req, stamp, email, m, live, week, today, result);
    const changes = rows.map(() => ({ run: {}, days: {} }));
    rows.forEach((s, i) => { const run = s.data();
      // 7.0.272: who runs it follows Route Master too (route name, run, Run By).
      Object.assign(changes[i].run, liveNames(m, run, req, live));
      ['coverageType', 'coverageOwner'].forEach(f => { const v = String(m[f] || '').trim(); if (v && String(run[f] || '').trim() !== v) changes[i].run[f] = v; });
      // Joe 10/12 (907 / 950): Show on Daily Dispatch switched in the Route Editor reaches the Current and Next weeks' rows too,
      // since Daily reads the week's own flag (a FALSE there hides the run whatever Route Master says).
      if (req && req.fields && typeof req.fields.displayDaily === 'boolean' && run.displayDaily !== req.fields.displayDaily) changes[i].run.displayDaily = req.fields.displayDaily;
      // Joe 10/12 (typed OK): the driver Route app switch (phone View Loadout, Driver Room board, check-in) reaches the two weeks' rows too,
      // since those screens read the week's own display_mobile_route first.
      if (req && req.fields && typeof req.fields.displayMobile === 'boolean' && run.displayMobileRoute !== req.fields.displayMobile) changes[i].run.displayMobileRoute = req.fields.displayMobile;
    });
    L.DAYS.forEach(p => {
      // A run on two rows (one per set of days): the day belongs to the row that runs it, else the first row.
      let i = rows.findIndex(s => ((s.data().days || {})[p] || {}).runs);
      if (i < 0) i = 0;
      const run = rows[i].data(), day = (run.days || {})[p] || {}, want = (m.days || {})[p] || {}, ch = {};
      if (loadDay(week, p, day.loadDayOffset) < today) return;
      // Joe 10/10: a day with a driver always runs, so Route Master never turns such a day off.
      if (!byHand(run, p, 'route_override') && !!day.runs !== !!want.active && (want.active || !day.driver)) ch.runs = !!want.active;
      if (want.dispatchTime !== null && want.dispatchTime !== undefined) {
        if (!byHand(run, p, 'dispatch_time_override') && day.dispatchTime !== want.dispatchTime) ch.dispatchTime = want.dispatchTime;
        if (!byHand(run, p, 'start_time_override') && day.startTime !== want.dispatchTime) ch.startTime = want.dispatchTime;
      }
      const hours = hoursNumber(want.hours);
      if (hours !== null && !byHand(run, p, 'route_hours_override') && day.routeHours !== hours) ch.routeHours = hours;
      if (!byHand(run, p, 'equipment_override')) [['tractor', 'TRUCK', 'truckId', 'truck'], ['trailer', 'TRAILER', 'trailerId', 'trailer']].forEach(([f, type, idF, unitF]) => {
        const u = live.unit(want[f], type);
        if (!u || L.unitOff(u) || String(day[idF] || '').toUpperCase() === String(u.id).toUpperCase()) return;
        ch[idF] = u.id; ch[unitF] = u.unit;
      });
      changes[i].days[p] = ch;
    });
    rows.forEach((s, i) => writeLive(tx, db, mode, req, stamp, email, s, s.data(), changes[i], result));
  });
}

// A run Route Master has but the Live week does not: a new Live row from Route Master; days already loaded do not run.
function addLiveRun(tx, db, mode, req, stamp, email, m, live, week, today, result) {
  if (!L.masterActive(m) || !m.id) return;
  // A run with no day left to run that week (a new run with no days ticked yet) gets its Live row from the save that ticks one.
  if (!L.DAYS.some(p => { const want = (m.days || {})[p] || {}; return want.active && loadDay(week, p, Number.isFinite(want.loadDayOffset) ? want.loadDayOffset : null) >= today; })) return;
  const run = { weekStart: week, sourceTab: live.tabs[week], sheetRow: null, addedFromRouteMaster: true, weekOrder: m.weekOrder === undefined ? null : m.weekOrder,
    weeklyShowMaster: typeof m.displayWeekly === 'boolean' ? m.displayWeekly : null, masterShow: { daily: m.displayDaily === undefined ? null : m.displayDaily, mobile: m.displayMobile === undefined ? null : m.displayMobile, loadType: m.loadType || '', leavesOn: m.departureDay || '' },
    days: {}, cells: {}, rev: Date.parse(stamp), testEdited: true, editedAt: stamp };
  M.RUN_FIELDS.forEach(([f, , kind]) => { run[f] = kind === 'flag' ? null : ''; });
  Object.assign(run, { facilityId: m.facilityId || '', streamId: m.streamId || '', routeId: m.routeId || '', route: m.route || '', routeName: m.routeName || '', runId: m.id, run: m.run || '',
    routeRunType: m.routeRunType || '', loadType: m.loadType || '', movementType: m.movementType || '', coverageType: m.coverageType || '', coverageOwner: m.coverageOwner || '',
    dedicatedType: m.dedicatedType || '', routeStatus: 'ACTIVE', active: true, displayDaily: m.displayDaily === undefined ? null : m.displayDaily,
    displayWeekly: m.displayWeekly === undefined ? null : m.displayWeekly, displayPlant: m.displayPlant === undefined ? null : m.displayPlant, displayMobileRoute: m.displayMobile === undefined ? null : m.displayMobile });
  const cells = { week_start_date: week };
  Object.keys(LIVE_RUN_COLUMNS).forEach(f => { if (run[f] !== null && run[f] !== '') cells[LIVE_RUN_COLUMNS[f]] = typeof run[f] === 'boolean' ? (run[f] ? 'TRUE' : 'FALSE') : String(run[f]); });
  L.DAYS.forEach(p => {
    const want = (m.days || {})[p] || {}, day = {};
    M.DAY_FIELDS.forEach(([f, , kind]) => { day[f] = kind === 'yes' ? false : kind === 'text' ? '' : null; });
    const truck = live.unit(want.tractor, 'TRUCK'), trailer = live.unit(want.trailer, 'TRAILER'), offset = Number.isFinite(want.loadDayOffset) ? want.loadDayOffset : null;
    Object.assign(day, { runs: !!want.active && loadDay(week, p, offset) >= today, loadSequence: want.loadOrder == null ? null : want.loadOrder, deliveryDate: L.addDays(week, L.DAYS.indexOf(p)),
      loadDayOffset: offset, loadDate: loadDay(week, p, offset), dispatchTime: want.dispatchTime == null ? null : want.dispatchTime, startTime: want.dispatchTime == null ? null : want.dispatchTime,
      routeHours: hoursNumber(want.hours), miles: want.miles == null ? null : want.miles,
      truckId: truck ? truck.id : '', truck: truck ? truck.unit : '', trailerId: trailer ? trailer.id : '', trailer: trailer ? trailer.unit : '' });
    run.days[p] = day;
    M.DAY_FIELDS.forEach(([f, suffix]) => { const v = day[f]; if (v === null || v === '' || (v === false && f !== 'runs')) return; cells[p + '_' + suffix] = typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : TIME_FIELDS[f] ? L.timeText(v) : v; });
  });
  const id = M.runDocId(week, m.id);
  tx.set(db.collection(C.runs).doc(id), run);
  if (mode.writeBack) queueCells(tx, db, req.requestId, 'A' + week, Object.assign({}, run, { days: {} }), id, cells, stamp, email, { append: true });
  result.runs.push({ runDocId: id, rev: run.rev });
  result.liveWeeks.added++;
}

// A Driver Master save: the Live name follows Driver Master, and the driver's own truck goes on the days he drives, unless the day's
// equipment was picked by hand, the truck is down, or it is already on another run that day (udpoV7267DriverOwnTruck_).
function driverToLive(tx, db, mode, req, stamp, email, d, truckId, live, result) {
  const today = L.operatingDay(new Date(stamp)), truck = truckId ? live.unit(truckId, 'TRUCK') : null, warn = (t) => { if (result.liveWeeks.warnings.indexOf(t) < 0) result.liveWeeks.warnings.push(t); };
  const rows = live.runs.map(s => ({ s, run: s.data(), ch: { run: {}, days: {} } }));
  rows.forEach(x => L.DAYS.forEach(p => {
    const day = (x.run.days || {})[p] || {};
    if (day.driverId !== d.id || loadDay(x.run.weekStart, p, day.loadDayOffset) < today) return;
    const ch = {};
    if (d.name && day.driver !== d.name) ch.driver = d.name;
    if (truckId && day.runs && !byHand(x.run, p, 'equipment_override') && day.truckId !== truckId) {
      if (!truck) warn(d.name + "'s truck " + truckId + ' is not in Equipment Master; the route\'s truck was kept.');
      else if (L.unitOff(truck)) warn(d.name + "'s truck " + truck.unit + ' is ' + L.unitOffWhy(truck) + '; the route\'s truck was kept.');
      else {
        const on = (o) => { const od = Object.assign({}, (o.run.days || {})[p], o.ch.days[p]); return od.runs && (od.truckId === truck.id || (!!truck.unit && od.truck === truck.unit)); };
        const other = rows.find(o => o !== x && o.run.weekStart === x.run.weekStart && on(o));
        if (other) warn(d.name + "'s truck " + truck.unit + ' is already on route ' + other.run.route + ' ' + (other.run.run || '') + ' on ' + L.addDays(x.run.weekStart, L.DAYS.indexOf(p)) + '; the route\'s truck was kept.');
        else { ch.truckId = truck.id; ch.truck = truck.unit; }
      }
    }
    if (Object.keys(ch).length) x.ch.days[p] = ch;
  }));
  rows.forEach(x => writeLive(tx, db, mode, req, stamp, email, x.s, x.run, x.ch, result));
}

module.exports = { liveRead, routeToLive, driverToLive };
