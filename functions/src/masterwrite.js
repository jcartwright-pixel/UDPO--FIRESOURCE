/*
 * United Dairy Distribution app: writing master-list saves back to the sheets (sandbox copies only).
 *
 * The Driver, Route and Equipment Master saves, day offs (DRIVER_EXCEPTIONS) and the Vacation Schedule
 * (DRIVER_VACATIONS) queue their changed columns in `masterOutbox`, in the same transaction as the save, the same way
 * Live saves use `outbox` (see writeback.js). This writes them into each list's tab, oldest first. The row is found by
 * the list's ID column (driver_id, run_id, equipment_id, exception_id, id), never by row number; an entry made in the
 * new app is added as a new row at the bottom.
 *
 * Same conflict rule as the Live write-back: a cell is written only if the sheet still holds what the new app last
 * read for it (or already holds the new value); anything else goes on the Sheet Conflicts list with both values.
 * Only sandbox copies can be written: every production spreadsheet is refused here, whatever the settings say.
 */
'use strict';

const L = require('./logic');
const M = require('./model');
const { assertSandboxTarget, columnLetter } = require('./writeback');

const C = M.COLLECTIONS;
const BATCH = 50;

// App field -> [sheet column, value kind], per list (the reverse of transfer.js MASTER_KINDS).
const COLUMNS = Object.freeze({
  drivers: { idColumn: 'driver_id', fields: {
    name: ['name', 'text'], employeeId: ['employee_id', 'text'], status: ['status', 'text'], employmentStatus: ['employment_status', 'text'],
    reliefDriver: ['relief_driver', 'bool'], positionOrder: ['position_order', 'number'], defaultTruckId: ['default_tractor_id', 'text'],
    defaultTrailerId: ['default_trailer_id', 'text'], facilityId: ['facility_id', 'text'], hireDate: ['hire_date', 'date'],
    seniorityDate: ['seniority_date', 'date'], unavailableReason: ['unavailable_reason', 'text'] } },
  equipment: { idColumn: 'equipment_id', fields: {
    type: ['equipment_type', 'text'], unit: ['unit_id', 'text'], status: ['status', 'text'], location: ['location', 'text'],
    facilityId: ['facility_id', 'text'], notes: ['notes', 'text'], assignmentClass: ['assignment_class', 'text'] } },
  routes: { idColumn: 'run_id', fields: {
    routeId: ['route_id', 'text'], route: ['route', 'text'], routeName: ['route_name', 'text'], run: ['run', 'text'], routeStatus: ['route_status', 'text'],
    active: ['active', 'bool'], weekOrder: ['route_week_display', 'number'], routeCode: ['route_code', 'text'], facilityId: ['facility_id', 'text'],
    streamId: ['stream_id', 'text'], routeRunType: ['route_run_type', 'text'], loadType: ['load_type', 'text'], movementType: ['movement_type', 'text'],
    coverageType: ['coverage_type', 'text'], coverageOwner: ['coverage_owner', 'text'], dedicatedType: ['dedicated_type', 'text'],
    displayRouteMaster: ['display_route_master', 'bool'], displayDaily: ['display_daily_dispatch', 'bool'], displayWeekly: ['display_weekly_dispatch', 'bool'],
    displayPlant: ['display_plant_distribution', 'bool'], displayMobile: ['display_mobile_route', 'bool'], routeNotes: ['route_notes', 'text'],
    departureDay: ['departure_day', 'text'], dropAndHook: ['drop_and_hook', 'bool'], sleeper: ['sleeper', 'bool'] },
    days: { active: ['active', 'bool'], dispatchTime: ['dispatch_time', 'time'], loadOrder: ['load_order', 'number'], miles: ['miles', 'number'],
      hours: ['expected_route_hours', 'text'], loadDayOffset: ['load_day_offset', 'number'], forklift: ['forklift_default', 'text'],
      tractor: ['tractor_default', 'text'], trailer: ['trailer_default', 'text'], notes: ['notes', 'text'] } },
  exceptions: { idColumn: 'exception_id', fields: {
    driverId: ['driver_id', 'text'], startDate: ['start_date', 'date'], endDate: ['end_date', 'date'], type: ['exception_type', 'text'],
    status: ['status', 'text'], reasonCode: ['reason_code', 'text'], notes: ['notes', 'text'], decisionNotes: ['decision_notes', 'text'], facilityId: ['facility_id', 'text'] } },
  vacations: { idColumn: 'id', fields: {
    driverId: ['driver_id', 'text'], startDate: ['start_date', 'date'], endDate: ['end_date', 'date'], status: ['status', 'text'],
    vacationType: ['vacation_type', 'text'], notes: ['notes', 'text'], facilityId: ['facility_id', 'text'] } }
});
const KIND_OF = { [C.drivers]: 'drivers', [C.equipment]: 'equipment', [C.routes]: 'routes', [C.exceptions]: 'exceptions', [C.vacations]: 'vacations' };

function cellValue(kind, v) {
  if (v === null || v === undefined) return '';
  if (kind === 'bool') return v === true ? 'TRUE' : v === false ? 'FALSE' : String(v);
  if (kind === 'time') return typeof v === 'number' ? L.timeText(v) : String(v);
  if (kind === 'number') return typeof v === 'number' ? v : String(v);
  return String(v);
}

// The sheet cells for one save's changed fields (flat fields, and Route Master days as "days.mon.miles" or {days:{mon:{...}}}).
function masterCells(list, fields) {
  const spec = COLUMNS[list], cells = {};
  Object.keys(fields || {}).forEach(k => {
    const m = /^days\.([a-z]{3})\.(\w+)$/.exec(k);
    if (m && spec.days && spec.days[m[2]]) { cells[m[1] + '_' + spec.days[m[2]][0]] = cellValue(spec.days[m[2]][1], fields[k]); return; }
    if (k === 'days' && spec.days && fields.days && typeof fields.days === 'object') {
      Object.keys(fields.days).forEach(p => Object.keys(fields.days[p] || {}).forEach(f => { if (spec.days[f]) cells[p + '_' + spec.days[f][0]] = cellValue(spec.days[f][1], fields.days[p][f]); }));
      return;
    }
    if (spec.fields[k]) cells[spec.fields[k][0]] = cellValue(spec.fields[k][1], fields[k]);
  });
  return cells;
}

/*
 * Called inside a save's transaction next to the master write. ref = the master doc, rowId = the sheet ID cell,
 * fields = what changed (app field names), create = an entry made in the new app (a new row in the sheet).
 */
function queueMaster(tx, db, mode, requestId, part, ref, rowId, fields, create, stamp, email) {
  if (!mode.writeBack) return;
  const list = KIND_OF[ref.parent.id];
  if (!list) throw new Error('No master list for ' + ref.parent.id);
  const cells = masterCells(list, fields);
  if (!Object.keys(cells).length) return;
  cells.updated_at = stamp;
  cells.updated_by = email;
  tx.set(db.collection(C.masterOutbox).doc(requestId + (part ? '-' + part : '')), {
    status: 'pending', at: stamp, by: email, requestId, list, docId: ref.id, rowId: String(rowId), idColumn: COLUMNS[list].idColumn, create: !!create, cells
  });
}

/*
 * One pass. sheets = { batchGet, batchUpdate }. targets = { drivers: {spreadsheetId, tab}, ... }: the sandbox copies of
 * the master lists (the same the copy reads). Returns counts.
 */
async function runMasterWriteBack({ db, sheets, targets, now }) {
  Object.keys(targets || {}).forEach(k => assertSandboxTarget(targets[k] && targets[k].spreadsheetId));
  const stamp = (now ? now() : new Date()).toISOString();
  // Claim the oldest waiting saves first, so two passes at once (the save trigger and the minute pass) never both add
  // the same new row. A claim older than five minutes (a pass that died) is taken over.
  const claim = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), stale = new Date(Date.parse(stamp) - 5 * 60000).toISOString();
  const items = await db.runTransaction(async tx => {
    const q = await tx.get(db.collection(C.masterOutbox).where('status', 'in', ['pending', 'writing']).orderBy('at').orderBy('requestId').limit(BATCH));
    const mine = q.docs.filter(d => d.data().status === 'pending' || String(d.data().claimedAt || '') < stale);
    mine.forEach(d => tx.update(d.ref, { status: 'writing', claim, claimedAt: stamp }));
    return mine.map(d => Object.assign({ id: d.id, ref: d.ref }, d.data()));
  });
  if (!items.length) return { written: 0, conflicts: 0, items: 0, added: 0 };
  const lists = [...new Set(items.map(i => i.list))];
  const sheet = {}, header = {};
  for (const list of lists) {
    const t = targets[list];
    if (!t) throw new Error('Write-back stopped: no sandbox copy is set for ' + list);
    sheet[list] = (await sheets.batchGet(t.spreadsheetId, ["'" + t.tab + "'"]))[0] || [];
    header[list] = (sheet[list][M.MASTER_HEADER_ROW - 1] || []).map(M.normalizeHeader);
  }
  // What the new app last read for each row (the copy's cells), kept up to date as cells are written.
  const docRefs = items.map(i => db.collection(C[i.list]).doc(i.docId));
  const docSnaps = await db.getAll(...docRefs);
  const known = {};
  items.forEach((i, n) => { known[i.list + '/' + i.docId] = Object.assign({}, docSnaps[n].exists ? docSnaps[n].data().cells || {} : {}); });

  const updates = {}, ops = [];
  let written = 0, conflicts = 0, added = 0;
  const conflict = (item, column, data) => ops.push({ ref: db.collection(C.conflicts).doc(item.id + '-' + (column || 'row')), data: Object.assign({
    open: true, at: stamp, requestId: item.requestId, by: item.by, tab: targets[item.list].tab, list: item.list, rowId: item.rowId, column: column || '' }, data) });
  items.forEach(item => {
    const values = sheet[item.list], head = header[item.list], idCol = head.indexOf(item.idColumn), k = known[item.list + '/' + item.docId];
    const tab = targets[item.list].tab, put = (r, c, v) => (updates[item.list] = updates[item.list] || []).push({ range: "'" + tab + "'!" + columnLetter(c) + (r + 1), values: [[v]] });
    const rows = [];
    for (let r = M.MASTER_HEADER_ROW; r < values.length; r++) if (String((values[r] || [])[idCol] || '').trim() === item.rowId) rows.push(r);
    if (idCol < 0 || rows.length > 1 || (!rows.length && !item.create)) {
      conflicts++;
      conflict(item, '', { problem: idCol < 0 ? 'the sheet has no ' + item.idColumn + ' column' : rows.length ? item.rowId + ' is on more than one row; nothing was written' : item.rowId + ' is no longer on the sheet; nothing was written', cells: item.cells });
      ops.push({ ref: item.ref, update: { status: 'conflict', doneAt: stamp } });
      return;
    }
    let r = rows[0], itemConflicts = 0;
    if (r === undefined) {
      // A new entry: the next empty row, with its ID.
      r = values.length;
      values[r] = [];
      values[r][idCol] = item.rowId;
      put(r, idCol, item.rowId);
      added++;
    }
    const row = values[r];
    Object.keys(item.cells).forEach(column => {
      const c = head.indexOf(column), want = item.cells[column], stampColumn = column === 'updated_at' || column === 'updated_by';
      if (c < 0) { if (!stampColumn) { itemConflicts++; conflict(item, column, { newValue: want, problem: 'the sheet has no column ' + column }); } return; }
      const inSheet = String(row[c] === undefined || row[c] === null ? '' : row[c]).trim(), expected = String(k[column] || '').trim();
      if (!stampColumn && rows.length && inSheet !== expected && inSheet !== String(want).trim()) {
        itemConflicts++;
        conflict(item, column, { sheetValue: inSheet, appExpected: expected, newValue: want, problem: 'changed in the sheet since the app last saw it; the sheet value was kept' });
        return;
      }
      if (inSheet !== String(want).trim()) { put(r, c, want); row[c] = want; }
      k[column] = String(want);
      written++;
    });
    conflicts += itemConflicts;
    ops.push({ ref: item.ref, update: { status: itemConflicts ? 'conflict' : 'done', doneAt: stamp, sheetRow: r + 1 } });
  });

  // Sheet first, then mark the queue: if a sheet write fails nothing is marked and the next pass retries.
  for (const list of Object.keys(updates)) await sheets.batchUpdate(targets[list].spreadsheetId, updates[list]);
  const batch = db.batch();
  ops.forEach(op => (op.update ? batch.update(op.ref, op.update) : batch.set(op.ref, op.data)));
  items.forEach((i, n) => { if (docSnaps[n].exists) batch.update(docRefs[n], { cells: known[i.list + '/' + i.docId] }); });
  await batch.commit();
  return { written, conflicts, items: items.length, added };
}

module.exports = { COLUMNS, masterCells, queueMaster, runMasterWriteBack };
