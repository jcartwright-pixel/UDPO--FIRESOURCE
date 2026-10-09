/*
 * United Dairy Distribution app: the one-way transfer.
 *
 * Copies the three Live week tabs and the Route, Driver, Equipment and Users master lists from the Google
 * Sheets into the new app's database. It only READS the sheets (read-only Google permission); it can never
 * change them. A row is rewritten only when it changed in the sheet since the last transfer, which keeps the
 * database bill small and lets a test save in the new app stay until that run changes in the sheet.
 */
'use strict';

const crypto = require('crypto');
const L = require('./logic');
const M = require('./model');

const C = M.COLLECTIONS;
const META = 'meta';
const BATCH_LIMIT = 400;

function fingerprint(value) { return crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 20); }

function cellText(v) { return v === null || v === undefined ? '' : String(v).trim(); }

function headerIndex(headerRow) {
  const index = {};
  (headerRow || []).forEach((h, i) => { const k = M.normalizeHeader(h); if (k && index[k] === undefined) index[k] = i; });
  return index;
}

function nameKey(name) { return String(name || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').sort().join(' '); }

// Every non-blank cell, word for word, under its column name. Firestore field names cannot be blank.
function cellsOf(row, index) {
  const cells = {};
  Object.keys(index).forEach(k => { const t = cellText(row[index[k]]); if (t) cells[k] = t; });
  return cells;
}

/* ---------- master lists ---------- */

const MASTER_KINDS = Object.freeze({
  drivers: {
    collection: C.drivers, idColumn: 'driver_id',
    build: (get) => ({
      name: get('name'), employeeId: get('employee_id'), status: get('status').toUpperCase(),
      employmentStatus: get('employment_status'), reliefDriver: L.yes(get('relief_driver')),
      positionOrder: L.number(get('position_order')), defaultTruckId: get('default_tractor_id'),
      defaultTrailerId: get('default_trailer_id'), facilityId: get('facility_id'),
      hireDate: L.dateKey(get('hire_date')), seniorityDate: L.dateKey(get('seniority_date')), unavailableReason: get('unavailable_reason')
    })
  },
  equipment: {
    collection: C.equipment, idColumn: 'equipment_id',
    build: (get) => ({
      type: get('equipment_type').toUpperCase(), unit: get('unit_id'), status: get('status').toUpperCase(),
      location: get('location'), facilityId: get('facility_id'), notes: get('notes'), assignmentClass: get('assignment_class')
    })
  },
  routes: {
    collection: C.routes, idColumn: 'run_id',
    // Every ROUTES_MASTER column the Route Editor shows (V50MAP_02 canonical headers), and the seven days' standards.
    build: (get) => {
      const days = {};
      L.DAYS.forEach(p => {
        days[p] = {
          active: L.yes(get(p + '_active')), dispatchTime: L.minutesOfDay(get(p + '_dispatch_time')), loadOrder: L.number(get(p + '_load_order')),
          miles: L.number(get(p + '_miles')), hours: get(p + '_expected_route_hours'), loadDayOffset: L.number(get(p + '_load_day_offset')),
          forklift: get(p + '_forklift_default'), tractor: get(p + '_tractor_default'), trailer: get(p + '_trailer_default'), notes: get(p + '_notes')
        };
      });
      return {
        routeId: get('route_id'), route: get('route'), routeName: get('route_name'), run: get('run'),
        routeStatus: get('route_status').toUpperCase(), active: L.optionalYes(get('active')),
        weekOrder: L.number(get('route_week_display')),
        routeCode: get('route_code'), facilityId: get('facility_id'), streamId: get('stream_id'), routeRunType: get('route_run_type'),
        loadType: get('load_type'), movementType: get('movement_type'), coverageType: get('coverage_type'), coverageOwner: get('coverage_owner'),
        dedicatedType: get('dedicated_type'), displayRouteMaster: L.optionalYes(get('display_route_master')), displayDaily: L.optionalYes(get('display_daily_dispatch')),
        displayWeekly: L.optionalYes(get('display_weekly_dispatch')), displayPlant: L.optionalYes(get('display_plant_distribution')),
        displayMobile: L.optionalYes(get('display_mobile_route')), routeNotes: get('route_notes'), departureDay: get('departure_day'),
        dropAndHook: L.yes(get('drop_and_hook')), sleeper: L.yes(get('sleeper')), days
      };
    }
  },
  // Days a driver is off or unavailable (Daily call-off, Weekly availability, and the Vacation Schedule's mirror).
  exceptions: {
    collection: C.exceptions, idColumn: 'exception_id',
    build: (get) => ({
      driverId: get('driver_id'), startDate: L.dateKey(get('start_date')), endDate: L.dateKey(get('end_date')) || L.dateKey(get('start_date')),
      type: get('exception_type').toUpperCase(), status: get('status').toUpperCase(), reasonCode: get('reason_code').toUpperCase(),
      notes: get('notes'), facilityId: get('facility_id')
    })
  },
  vacations: {
    collection: C.vacations, idColumn: 'id',
    build: (get) => ({
      driverId: get('driver_id'), startDate: L.dateKey(get('start_date')), endDate: L.dateKey(get('end_date')) || L.dateKey(get('start_date')),
      status: get('status').toUpperCase() || 'APPROVED', vacationType: L.vacationType(get('vacation_type')), notes: get('notes'), facilityId: get('facility_id')
    })
  },
  /*
   * Plant Route loads on the Plant Operations Scheduler (udpoV7277PlantRouteLoads_): record_type PLANT_SCHEDULE, not
   * deleted, with a run and a date. Carrier loads (picked up by the customer) need no driver and are left out, as are
   * the journal's other rows.
   */
  plantLoads: {
    collection: C.plantLoads, idColumn: 'record_id', journal: true,
    keep: (get) => {
      if (get('record_type').toUpperCase() !== 'PLANT_SCHEDULE' || get('status').toUpperCase() === 'DELETED' || !get('run_id') || !L.dateKey(get('business_date'))) return false;
      let d = {};
      try { d = JSON.parse(get('payload_json') || '{}') || {}; } catch (e) { d = {}; }
      return String(d.scheduleType || 'ROUTE').trim().toUpperCase() !== 'CARRIER' && d.carrier !== true;
    },
    build: (get) => {
      let d = {};
      try { d = JSON.parse(get('payload_json') || '{}') || {}; } catch (e) { d = {}; }
      return { runId: get('run_id'), route: get('route'), run: get('run'), date: L.dateKey(get('business_date')), status: get('status').toUpperCase() || 'SCHEDULED',
        pickupTime: String(d.pickupTime || ''), loadDate: L.dateKey(d.loadDate) || '', trailer: String(d.trailer || ''), poNumber: String(d.poNumber || ''),
        cases: String(d.cases || ''), product: String(d.product || ''), notes: String(d.notes || get('notes') || ''), facilityId: get('facility_id') };
    }
  },
  users: {
    collection: C.users, idColumn: 'email',
    build: (get, warn) => {
      let roles = [];
      const raw = get('roles_json');
      if (raw) {
        try { roles = JSON.parse(raw); } catch (e) { warn('roles not readable'); }
        if (!Array.isArray(roles)) roles = [];
      }
      return { name: get('display_name'), status: get('status').toUpperCase(), roles: roles.map(r => String(r).trim().toUpperCase()).filter(Boolean) };
    }
  }
});

function parseMaster(kind, values) {
  const spec = MASTER_KINDS[kind];
  if (!spec) throw new Error('Unknown master list: ' + kind);
  const rows = values || [];
  const index = headerIndex(rows[M.MASTER_HEADER_ROW - 1]);
  const warnings = [];
  if (index[spec.idColumn] === undefined) throw new Error(kind + ': column ' + spec.idColumn + ' is missing from the header row');
  const docs = {};
  rows.slice(M.MASTER_HEADER_ROW).forEach((row, i) => {
    const rowNumber = M.MASTER_HEADER_ROW + 1 + i;
    let id = cellText(row[index[spec.idColumn]]);
    if (!id) return;
    if (kind === 'users') id = id.toLowerCase();
    const docId = M.safeIdPart(id);
    const get = (col) => (index[col] === undefined ? '' : cellText(row[index[col]]));
    // A journal (the plant scheduler) adds a row for each change of a record: the last one is the record now.
    if (spec.journal) { delete docs[docId]; if (spec.keep && !spec.keep(get)) return; }
    if (docs[docId]) { warnings.push({ list: kind, row: rowNumber, id, problem: 'same ID appears twice; the first row is used' }); return; }
    if (spec.keep && !spec.keep(get)) return;
    const doc = spec.build(get, (problem) => warnings.push({ list: kind, row: rowNumber, id, problem }));
    doc.id = id;
    doc.sheetRow = rowNumber;
    doc.cells = cellsOf(row, index);
    docs[docId] = doc;
  });
  return { kind, collection: spec.collection, docs, warnings };
}

function lookupsFrom(masters) {
  const driversById = {}, driversByName = {}, equipmentById = {}, routesByRunId = {};
  const drivers = masters.drivers ? masters.drivers.docs : {};
  Object.keys(drivers).forEach(k => {
    const d = drivers[k];
    driversById[d.id] = d;
    const key = nameKey(d.name);
    if (key) driversByName[key] = driversByName[key] === undefined ? d : null; // null = two drivers share the name
  });
  const equipment = masters.equipment ? masters.equipment.docs : {};
  Object.keys(equipment).forEach(k => { equipmentById[equipment[k].id] = equipment[k]; });
  const routes = masters.routes ? masters.routes.docs : {};
  Object.keys(routes).forEach(k => { routesByRunId[routes[k].id] = routes[k]; });
  return { driversById, driversByName, equipmentById, routesByRunId };
}

/* ---------- Live week tabs ---------- */

function majority(list) {
  const counts = {};
  let best = '', n = 0;
  list.forEach(v => { if (!v) return; counts[v] = (counts[v] || 0) + 1; if (counts[v] > n) { n = counts[v]; best = v; } });
  return best;
}

function parseLiveTab(tabName, values, lookups) {
  lookups = lookups || lookupsFrom({});
  const rows = values || [];
  const index = headerIndex(rows[M.LIVE_HEADER_ROW - 1]);
  const warnings = [];
  const warn = (row, problem, extra) => warnings.push(Object.assign({ tab: tabName, row, problem }, extra || {}));
  ['route_id', 'run_id', 'route'].forEach(col => { if (index[col] === undefined) throw new Error(tabName + ': column ' + col + ' is missing from row ' + M.LIVE_HEADER_ROW); });

  const get = (row, col) => (index[col] === undefined ? '' : cellText(row[index[col]]));
  const dataRows = [];
  rows.slice(M.LIVE_HEADER_ROW).forEach((row, i) => {
    const rowNumber = M.LIVE_HEADER_ROW + 1 + i;
    if (!get(row, 'route_id') && !get(row, 'run_id') && !get(row, 'route')) return; // blank line
    dataRows.push({ row, rowNumber });
  });

  // The week comes from the rows themselves; the label at the top of the tab is only checked against it.
  const fromRows = majority(dataRows.map(r => L.dateKey(get(r.row, 'week_start_date'))).map(k => (k ? L.weekStart(k) : '')));
  const label = L.dateKey(cellText((rows[1] || [])[1]));
  const weekStart = fromRows || (label ? L.weekStart(label) : '');
  if (!weekStart) throw new Error(tabName + ': no week start date found');
  if (label && L.weekStart(label) !== weekStart) warn(2, 'the Week Start label says ' + label + ' but the rows are for the week of ' + weekStart + '; the rows are used');

  // Row keys: the sheet's run_id. A run listed on two rows (different days) gets the days it runs added,
  // which also does not depend on row order.
  const baseKey = (r) => get(r.row, 'run_id') || (get(r.row, 'route') + '|' + get(r.row, 'run'));
  const daysRun = (r) => L.DAYS.filter(p => L.yes(get(r.row, p + '_runs'))).join('-') || 'none';
  const counts = {};
  dataRows.forEach(r => { const k = baseKey(r); counts[k] = (counts[k] || 0) + 1; });
  const used = {};

  const runs = {};
  dataRows.forEach(r => {
    let key = baseKey(r);
    if (!get(r.row, 'run_id')) warn(r.rowNumber, 'run_id is blank; route and run are used to identify the row');
    if (counts[key] > 1) key = key + '__' + daysRun(r);
    if (used[key]) {
      used[key] += 1;
      warn(r.rowNumber, 'run ' + baseKey(r) + ' is on more than one row with the same days; this row cannot be matched safely if rows are sorted', { runId: baseKey(r) });
      key = key + '__' + used[key];
    } else used[key] = 1;

    const run = { weekStart, sourceTab: tabName, sheetRow: r.rowNumber };
    M.RUN_FIELDS.forEach(([field, col, kind]) => { run[field] = M.convert(kind, get(r.row, col)); });
    const routeMaster = lookups.routesByRunId[run.runId];
    run.weekOrder = routeMaster && routeMaster.weekOrder !== undefined ? routeMaster.weekOrder : null;
    run.days = {};
    L.DAYS.forEach(prefix => {
      const day = {};
      M.DAY_FIELDS.forEach(([field, suffix, kind]) => {
        const raw = get(r.row, prefix + '_' + suffix);
        const value = M.convert(kind, raw);
        if (raw && value === null) warn(r.rowNumber, prefix + '_' + suffix + ' "' + raw + '" is not a readable ' + kind, { runId: run.runId });
        day[field] = value;
      });
      fixDriver(day, prefix, r.rowNumber, run, lookups, warn);
      fixEquipment(day, prefix, r.rowNumber, run, lookups, warn);
      run.days[prefix] = day;
    });
    run.cells = cellsOf(r.row, index);
    run.fingerprint = fingerprint(r.row.map(cellText));
    runs[M.runDocId(weekStart, key)] = run;
  });
  return { tab: tabName, weekStart, runs, warnings };
}

// Some Live rows hold a driver's name where the driver ID belongs (for example "RAMSEY KEYSHAWN").
// When the name matches exactly one driver, the real ID is used and the fix is listed.
function fixDriver(day, prefix, rowNumber, run, lookups, warn) {
  if (!day.driverId || lookups.driversById[day.driverId] || !Object.keys(lookups.driversById).length) return;
  const byName = lookups.driversByName[nameKey(day.driverId)] || lookups.driversByName[nameKey(day.driver)];
  if (byName) {
    warn(rowNumber, prefix + '_driver_id holds "' + day.driverId + '", not an ID; matched to ' + byName.name, { runId: run.runId, fixed: true });
    day.driverIdInSheet = day.driverId;
    day.driverId = byName.id;
    if (!day.driver) day.driver = byName.name;
  } else {
    warn(rowNumber, prefix + '_driver_id "' + day.driverId + '" is not in Driver Master', { runId: run.runId });
  }
}

function fixEquipment(day, prefix, rowNumber, run, lookups, warn) {
  if (!Object.keys(lookups.equipmentById).length) return;
  [['truckId', 'truck', 'TRUCK'], ['trailerId', 'trailer', 'TRAILER']].forEach(([idField, unitField, type]) => {
    const id = day[idField];
    if (!id) return;
    const unit = lookups.equipmentById[id];
    if (!unit) { warn(rowNumber, prefix + ' ' + unitField + ' "' + id + '" is not in Equipment Master', { runId: run.runId }); return; }
    if (unit.type && unit.type !== type) warn(rowNumber, prefix + ' ' + unitField + ' "' + id + '" is a ' + unit.type + ' in Equipment Master', { runId: run.runId });
    if (!day[unitField]) day[unitField] = unit.unit;
  });
}

/* ---------- writing ---------- */

async function commitInBatches(db, ops) {
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    ops.slice(i, i + BATCH_LIMIT).forEach(op => (op.del ? batch.delete(op.ref) : batch.set(op.ref, op.data)));
    await batch.commit();
  }
}

// Writes only what changed. `previous` is the stored fingerprint map; returns the new one and the counts.
function diffOps(db, collection, docs, previous, force, extra, rev, hold) {
  const ops = [], hashes = {};
  let written = 0, unchanged = 0, removed = 0, held = 0;
  hold = hold || {};
  Object.keys(docs).forEach(id => {
    const doc = docs[id];
    const hash = doc.fingerprint || fingerprint(doc.cells);
    // A run with a save still waiting to be written to the sheet keeps the app's value until it is written.
    if (hold[id]) { if (previous[id]) hashes[id] = previous[id]; held++; return; }
    hashes[id] = hash;
    if (!force && previous[id] === hash) { unchanged++; return; }
    const data = Object.assign({}, doc, extra || {}, { fingerprint: hash, rev });
    ops.push({ ref: db.collection(collection).doc(id), data });
    written++;
  });
  Object.keys(previous).forEach(id => { if (!(id in docs) && !hold[id]) { ops.push({ ref: db.collection(collection).doc(id), del: true }); removed++; } });
  return { ops, hashes, written, unchanged, removed, held };
}

/*
 * One transfer. reader.batchGet(spreadsheetId, [ranges]) returns one 2-D array of cell texts per range.
 * sources: { live: {spreadsheetId}, masters: {drivers: {spreadsheetId, tab}, ...} }.
 */
async function runTransfer({ db, reader, sources, now, force, admin }) {
  const started = now ? now() : new Date();
  const configRef = db.collection(C.config).doc('app');
  const configSnap = await configRef.get();
  const config = configSnap.exists ? configSnap.data() : {};
  const owners = config.screenOwners || {};
  // Phase 1 safety: the transfer overwrites the new app's copy. Once any screen belongs to the new app the
  // new app's saves are the real record, and this copy must not run (cutover is a later, separate step).
  const moved = Object.keys(owners).filter(k => owners[k] === 'new');
  if (moved.length) throw new Error('Transfer stopped: ' + moved.join(', ') + ' already belongs to the new app');

  // 1. Master lists.
  // Read side by side: each master list is its own spreadsheet.
  const masters = {};
  const kinds = Object.keys(sources.masters || {});
  const reads = await Promise.all(kinds.map(kind => reader.batchGet(sources.masters[kind].spreadsheetId, ["'" + sources.masters[kind].tab + "'"])));
  kinds.forEach((kind, i) => { masters[kind] = parseMaster(kind, reads[i][0]); });
  const lookups = lookupsFrom(masters);

  // 2. Live week tabs, one read for all three.
  const tabKeys = Object.keys(M.LIVE_TABS);
  const tabValues = await reader.batchGet(sources.live.spreadsheetId, tabKeys.map(k => "'" + M.LIVE_TABS[k] + "'"));
  const live = {};
  tabKeys.forEach((k, i) => { live[k] = parseLiveTab(M.LIVE_TABS[k], tabValues[i], lookups); });
  const weekStarts = tabKeys.map(k => live[k].weekStart);
  if (new Set(weekStarts).size !== weekStarts.length) throw new Error('Transfer stopped: two Live tabs are for the same week (' + weekStarts.join(', ') + ')');

  // 3. Write what changed.
  const stamp = started.toISOString();
  // A run's revision only ever goes up: a rewrite from the sheet takes the transfer time, a save adds one.
  const revBase = started.getTime();
  const ops = [];
  const summary = { masters: {}, weeks: {} };
  for (const kind of Object.keys(masters)) {
    const metaRef = db.collection(META).doc(kind);
    const prev = (await metaRef.get()).data() || {};
    const d = diffOps(db, masters[kind].collection, masters[kind].docs, prev.hashes || {}, force, { transferredAt: stamp }, revBase);
    ops.push(...d.ops, { ref: metaRef, data: { hashes: d.hashes, transferredAt: stamp } });
    summary.masters[kind] = { rows: Object.keys(masters[kind].docs).length, written: d.written, unchanged: d.unchanged, removed: d.removed };
  }
  const waiting = await db.collection(C.outbox).where('status', '==', 'pending').get();
  const hold = {};
  waiting.docs.forEach(d => { hold[d.data().runDocId] = true; });
  for (const k of tabKeys) {
    const tab = live[k];
    const weekRef = db.collection(C.weeks).doc(tab.weekStart);
    const prev = (await weekRef.get()).data() || {};
    const d = diffOps(db, C.runs, tab.runs, prev.rowHashes || {}, force, { transferredAt: stamp }, revBase, hold);
    ops.push(...d.ops, { ref: weekRef, data: { weekStart: tab.weekStart, sourceTab: tab.tab, rowHashes: d.hashes, rows: Object.keys(tab.runs).length, transferredAt: stamp,
      // Weekly's Publish record is kept by the copy.
      publishedAt: prev.publishedAt || '', publishedBy: prev.publishedBy || '' } });
    summary.weeks[tab.weekStart] = { tab: tab.tab, rows: Object.keys(tab.runs).length, written: d.written, unchanged: d.unchanged, removed: d.removed, waitingForWriteBack: d.held };
  }
  const warnings = [].concat(...Object.keys(masters).map(k => masters[k].warnings), ...tabKeys.map(k => live[k].warnings));
  const liveWeeks = {};
  tabKeys.forEach(k => { liveWeeks[k] = live[k].weekStart; });
  const transferRef = db.collection(C.transfers).doc(stamp.replace(/[:.]/g, '-'));
  ops.push({ ref: transferRef, data: { at: stamp, force: !!force, summary, warningCount: warnings.length, warnings: warnings.slice(0, 200) } });
  await commitInBatches(db, ops);
  const lastTransfer = { at: stamp, id: transferRef.id, warningCount: warnings.length };
  await configRef.set({ mode: config.mode || 'test', screenOwners: Object.assign({ dailyDispatch: 'old', weeklyDispatch: 'old' }, owners), liveWeeks, lastTransfer }, { merge: true });
  return { at: stamp, liveWeeks, summary, warnings };
}

module.exports = { parseMaster, parseLiveTab, lookupsFrom, runTransfer, fingerprint, nameKey, MASTER_KINDS, META };
