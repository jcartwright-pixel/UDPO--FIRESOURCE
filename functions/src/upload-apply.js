/*
 * The Upload Center's last step (Joe 10/27: "We should have templates to download. They fill out, and then we will upload."):
 * a saved Plant Setup Workbook fills that plant's own lists, in that plant's own database (plants.js), the same records its
 * screens read. Nothing goes into Uniontown's lists, and the company's one Users list only gains that plant for the people named.
 *
 *   applyUploads(home, pdb, plant, saved, tabs, opts)
 *     home   the company's database (the Users list, the holding store plantUploads)
 *     pdb    the plant's own database
 *     saved  every tab saved for the plant ({tab: rows}, upload-rules.js values), for the names one tab looks up in another
 *     tabs   the tabs this file filled: only their lists are written, so a list changed on screen since is left alone
 *
 * Every record it writes has a fixed id made from the row's key, so the same file twice changes nothing and a changed row
 * changes its record. private/uploadApplied remembers what each tab wrote: a row taken off the file takes its record off
 * (a production line is turned off instead, so old checks still read). Lists the screens keep whole (Location Areas, the
 * Safety checklist, Shifts, products by area) get the file's list through the same save the screen uses.
 */
'use strict';

const crypto = require('crypto');
const L = require('./logic');
const M = require('./model');
const U = require('./upload-rules');
const T = require('./transfer');
const P = require('./production-rules');
const PR = require('./plant-rules');
const PMR = require('./pmaint-rules');
const PLANT = require('./plant');
const SAFE = require('./safety');
const { SaveError } = require('./actions-common');

const BATCH = 400;
const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
const slug = (v) => text(v).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
const hash = (v) => crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 12);
const yes = (v) => v === 'Yes';
const flag = (v, dflt) => (v === 'Yes' ? 'TRUE' : v === 'No' ? 'FALSE' : dflt);
const plantName = (id) => (L.PLANTS.find(p => p.id === id) || {}).name || id;
const short = (plant) => String(plant).replace(/^fac_/, '');

// The ids the plant's records get: the same row always gets the same id.
const ids = {
  run: (plant, route, load) => 'run_' + short(plant) + '_' + slug(route) + '_' + slug(U.loadName(load)),
  route: (plant, route) => 'rte_' + short(plant) + '_' + slug(route),
  driver: (plant, employeeId) => 'drv_' + short(plant) + '_' + slug(U.idKey(employeeId)),
  line: (plant, name) => short(plant) + '_line_' + slug(name),
  machine: (plant, name) => short(plant) + '_mach_' + slug(name),
  pm: (plant, machine, task) => short(plant) + '_pm_' + hash(text(machine).toUpperCase() + '|' + text(task).toUpperCase()),
  temp: (plant, name) => short(plant) + '_temp_' + slug(name),
  area: (name) => slug(name).slice(0, 40) || 'area',
  sub: (area, sub) => (slug(area) + '__' + slug(sub)).slice(0, 40)
};

// A master list as its sheet would have it (headers, then one row per record), so transfer.js builds the records exactly as the
// copy from Uniontown's sheets does.
function table(rows) {
  const headers = [];
  rows.forEach(r => Object.keys(r).forEach(k => { if (headers.indexOf(k) < 0) headers.push(k); }));
  return [headers].concat(rows.map(r => headers.map(h => (r[h] === undefined || r[h] === null ? '' : String(r[h])))));
}
const docsOf = (kind, rows) => (rows.length ? T.parseMaster(kind, table(rows)).docs : {});

/* ---------- Routes and Route Days -> Route Master (routes) ---------- */

const COVERAGE = { 'United Dairy': ['', 'UNITED DAIRY'], Branch: ['', 'BRANCH'], 'Customer Pickup': ['CUSTOMER_PICKUP', 'CUSTOMER PICKUP'] };
function routeDocs(plant, saved) {
  const days = {};
  (saved.routeDays || []).forEach(d => { (days[U.routeKey(d.route, d.load)] = days[U.routeKey(d.route, d.load)] || []).push(d); });
  return docsOf('routes', (saved.routes || []).map(r => {
    const who = r.runBy === 'Outside Carrier' ? ['', text(r.carrier) || 'CARRIER'] : COVERAGE[r.runBy] || COVERAGE['United Dairy'];
    const loadNo = (/(\d+)$/.exec(U.loadName(r.load)) || [])[1] || '1';
    const row = {
      route_id: ids.route(plant, r.route), run_id: ids.run(plant, r.route, r.load), route_code: r.code || r.route + '_' + loadNo, facility_id: plant,
      stream_id: r.stream, route: r.route, route_name: r.name, run: r.run || r.name, route_run_type: U.loadName(r.load), load_type: r.loadType === 'None' ? '' : r.loadType,
      movement_type: who[0], coverage_type: who[1], coverage_owner: r.owner || plantName(plant), departure_day: r.leaves,
      drop_and_hook: flag(r.dropHook, 'FALSE'), sleeper: flag(r.sleeper, 'FALSE'), route_week_display: r.boardOrder,
      display_daily_dispatch: flag(r.showDaily, 'TRUE'), display_weekly_dispatch: flag(r.showWeekly, 'TRUE'), display_plant_distribution: flag(r.showPlant, 'TRUE'),
      display_mobile_route: flag(r.showPhone, 'TRUE'), display_route_master: flag(r.showList, 'TRUE'),
      route_status: r.status === 'Inactive' ? 'INACTIVE' : 'ACTIVE', active: r.status === 'Inactive' ? 'FALSE' : 'TRUE', route_notes: r.notes
    };
    (days[U.routeKey(r.route, r.load)] || []).forEach(d => {
      const p = text(d.day).toLowerCase().slice(0, 3);
      if (L.DAYS.indexOf(p) < 0) return;
      const offset = U.LOADED.indexOf(d.loaded);
      Object.assign(row, { [p + '_active']: yes(d.runs) ? 'TRUE' : 'FALSE', [p + '_dispatch_time']: d.time, [p + '_load_order']: d.loadOrder, [p + '_miles']: d.miles,
        [p + '_expected_route_hours']: d.hours, [p + '_load_day_offset']: offset > 0 ? -offset : offset === 0 ? '0' : '', [p + '_notes']: d.notes });
    });
    return row;
  }));
}

/* ---------- Drivers and Regular Week -> Driver Master (drivers, driverPhones) ---------- */

function driverDocs(plant, saved) {
  const runIds = {};
  (saved.routes || []).forEach(r => { runIds[U.routeKey(r.route, r.load)] = ids.run(plant, r.route, r.load); });
  const week = {};
  (saved.regularWeek || []).forEach(w => { week[U.idKey(w.employeeId)] = w; });
  return docsOf('drivers', (saved.drivers || []).map(d => {
    const row = { driver_id: ids.driver(plant, d.employeeId), employee_id: d.employeeId, name: d.name, status: d.status === 'Inactive' ? 'INACTIVE' : 'ACTIVE', phone: d.phone,
      facility_id: plant, hire_date: d.hired, seniority_date: d.seniority || d.hired, relief_driver: flag(d.relief, 'FALSE'), position_order: d.boardOrder };
    const w = week[U.idKey(d.employeeId)];
    if (w) {
      U.DAYS.forEach(day => {
        const p = day.toLowerCase(), works = w[p + 'Works'];
        if (works) row[p + '_available'] = works === 'Yes' ? 'TRUE' : 'FALSE';
        const runs = U.runsOf(w[p + 'Route']).map(x => runIds[U.routeKey(x.route, x.load)]).filter(Boolean);
        if (runs.length) row[p + '_assignments_json'] = JSON.stringify(runs.map(runId => ({ runId })));
      });
    }
    return row;
  }));
}

/* ---------- Days Off & Vacations -> vacations, exceptions ---------- */

// The same type and status a Daily call-off or a Vacation Schedule entry gets (actions-dayoff.js).
function exceptionValues(reason) {
  if (reason === 'VACATION') return { type: 'VACATION', status: 'APPROVED', reasonCode: 'VACATION' };
  if (['SICK DAY', 'BEREAVEMENT', 'UNPAID DAY'].indexOf(reason) >= 0) return { type: reason, status: 'UNAVAILABLE', reasonCode: reason };
  return { type: 'UNAVAILABLE', status: 'UNAVAILABLE', reasonCode: reason };
}
function dayOffDocs(plant, saved) {
  const vac = [], exc = [];
  (saved.daysOff || []).forEach(o => {
    const driverId = ids.driver(plant, o.employeeId), key = hash(plant + '|' + U.keyOf('daysOff', o)), status = o.status || 'APPROVED', end = o.end || o.start;
    const off = status === 'CANCELLED' || status === 'DENIED';
    if (o.type === 'VACATION') {
      const id = 'vac_up_' + key;
      vac.push({ id, driver_id: driverId, start_date: o.start, end_date: end, status, vacation_type: 'VACATION', notes: o.notes, facility_id: plant });
      // The Vacation Schedule's entry also puts the days off on Dispatch (its vsched_ exception).
      exc.push({ exception_id: 'vsched_' + id, driver_id: driverId, start_date: o.start, end_date: end, exception_type: 'VACATION', status: status === 'APPROVED' ? 'APPROVED' : 'CANCELLED',
        reason_code: 'VACATION', notes: 'Vacation Schedule' + (o.notes ? ': ' + o.notes : ''), facility_id: plant });
    } else {
      const v = exceptionValues(o.type);
      exc.push({ exception_id: 'dav_up_' + key, driver_id: driverId, start_date: o.start, end_date: end, exception_type: v.type, status: off ? 'CANCELLED' : v.status,
        reason_code: v.reasonCode, notes: o.notes, facility_id: plant });
    }
  });
  return { vacations: docsOf('vacations', vac), exceptions: docsOf('exceptions', exc) };
}

/* ---------- the plant's lists ---------- */

const COUNTER_OF = { 'Typed by operator': 'TABLET', Sensor: 'SENSOR', 'Label reader': 'READER', 'Machine controller': 'CONTROLLER' };
const FILL_OF = {};
P.FILL_MODES.forEach(m => { FILL_OF[m[1]] = m[0]; });
const num = (v) => (text(v) === '' ? null : Number(v));
// Lines: each a production line (plantSetup PRODUCTION_AREA, as the Plant Operations workbook's rows are) with its Line Targets
// (productionLines: how it is counted and its setup boxes, as saveLineCounter and saveLineSetup write them).
function lineDocs(plant, saved, stamp, email) {
  const setup = {}, targets = {}, byName = {};
  (saved.lines || []).forEach(l => { byName[text(l.name).toUpperCase()] = ids.line(plant, l.name); });
  (saved.lines || []).forEach(l => {
    const id = ids.line(plant, l.name);
    setup[id] = { operationId: id, type: 'PRODUCTION_AREA', name: l.name, status: l.active === 'No' ? 'INACTIVE' : 'ACTIVE', area: l.area || '', facilityId: plant,
      viewSequence: Number(l.order) || 0, settings: {}, cells: {} };
    const t = { operationId: id, line: l.name, facilityId: plant, counter: COUNTER_OF[l.counter] || 'TABLET', updatedAt: stamp, updatedBy: email };
    ['changeoverMin', 'cipHours', 'jugWeightTarget', 'jugWeightLow', 'jugWeightHigh', 'fillEveryN', 'tareGrams', 'capGrams', 'fillUnder', 'fillOver', 'perBox']
      .forEach(k => { if (text(l[k]) !== '') t[k] = num(l[k]); });
    if (l.fillEvery) t.fillEvery = FILL_OF[l.fillEvery] || null;
    if (l.fedBy) t.fedBy = text(l.fedBy).split(',').map(n => byName[text(n).toUpperCase()]).filter(x => x && x !== id).filter((x, i, a) => a.indexOf(x) === i);
    targets[id] = t;
  });
  return { setup, targets };
}
function machineDocs(plant, saved, stamp, email) {
  const out = {};
  (saved.machines || []).forEach(m => {
    const id = ids.machine(plant, m.name);
    out[id] = { facilityId: plant, machineId: id, line: false, name: m.name, kind: m.kind, area: m.area || '', make: m.make || '', model: m.model || '', serial: m.serial || '',
      location: m.location || '', installed: m.installed || '', notes: m.notes || '', group: 'MACHINERY', status: 'ACTIVE', createdAt: stamp, createdBy: email, updatedAt: stamp, updatedBy: email };
  });
  return out;
}
function pmDocs(plant, saved, stamp, email) {
  // The machine a PM is for: a line (its production line id) or a machine from the Machines tab, by name.
  const by = {};
  (saved.lines || []).forEach(l => { by[text(l.name).toUpperCase()] = { id: ids.line(plant, l.name), name: l.name }; });
  (saved.machines || []).forEach(m => { by[text(m.name).toUpperCase()] = { id: ids.machine(plant, m.name), name: m.name }; });
  const out = {}, missing = [];
  (saved.pmTasks || []).forEach(t => {
    const m = by[text(t.machine).toUpperCase()];
    if (!m) { missing.push(t.machine + ': ' + t.task); return; }
    const id = ids.pm(plant, t.machine, t.task), unit = text(t.unit).toUpperCase(), every = Number(t.every) || 1;
    out[id] = { facilityId: plant, taskId: id, machineId: m.id, machine: m.name, task: t.task, every, unit, lastDone: t.lastDone || '', notes: t.notes || '', status: 'ACTIVE',
      nextDue: PMR.nextDue(t.lastDone || '', every, unit), createdAt: stamp, createdBy: email, updatedAt: stamp, updatedBy: email };
  });
  return { docs: out, missing };
}
function tempDocs(plant, saved, stamp, email) {
  const out = {};
  (saved.coolers || []).forEach(c => {
    const id = ids.temp(plant, c.name);
    out[id] = { locationId: id, location: c.name, area: c.area || '', sensorId: '', sensorName: '', lowLimit: text(c.low) === '' ? '' : Number(c.low), highLimit: text(c.high) === '' ? '' : Number(c.high),
      viewSequence: Number(c.order) || 0, staleMinutes: Number(c.staleMinutes) || 30, active: c.active !== 'No', removed: false, facilityId: plant, updatedAt: stamp, updatedBy: email };
  });
  return out;
}
const EXT_TYPE = { 'K (kitchen)': 'K' , 'D (metal)': 'D' };
function extinguisherDocs(plant, saved, stamp, email) {
  const S = require('./safety-rules'), out = {};
  (saved.extinguishers || []).forEach(e => {
    const type = EXT_TYPE[e.type] || e.type || '';
    out[M.safeIdPart(S.extId(plant, e.tag))] = { facilityId: plant, tag: e.tag, location: e.location, type: S.EXT_TYPES.indexOf(type) >= 0 ? type : '', size: e.size || '',
      annualDue: e.annualDue || '', sixYearDue: e.sixYearDue || '', hydroDue: e.hydroDue || '', status: 'ACTIVE', checks: {}, createdAt: stamp, createdBy: email, updatedAt: stamp, updatedBy: email };
  });
  return out;
}
function supplierDocs(plant, saved, stamp, email) {
  const out = {};
  (saved.suppliers || []).forEach((s, i) => {
    const rid = 'SUP-UP-' + short(plant).toUpperCase() + '-' + hash(text(s.name).toUpperCase());
    out[M.safeIdPart(PR.SUPPLIER_TYPE + '_app_' + rid)] = { recordId: rid, type: PR.SUPPLIER_TYPE, date: L.operatingDay(new Date(stamp)), status: 'ACTIVE', routeId: rid, runId: rid,
      route: s.code || 'S' + String(i + 1).padStart(2, '0'), run: s.name, notes: text(s.short || s.name).slice(0, 40), area: 'RECEIVING', payload: {}, facilityId: plant,
      createdAt: stamp, recordedAt: stamp, recordedBy: email, createdInApp: true, testEdited: true, editedAt: stamp };
  });
  return out;
}
function receivingDocs(plant, saved, stamp, email) {
  const out = {};
  (saved.receivingItems || []).forEach(r => {
    const id = 'ITEM-UP-' + short(plant).toUpperCase() + '-' + hash(text(r.name).toUpperCase());
    out[id] = { name: r.name, barcodes: text(r.barcodes).split(',').map(text).filter(Boolean), status: 'ACTIVE', facilityId: plant, createdAt: stamp, createdBy: email };
  });
  return out;
}
function techDocs(plant, saved, stamp, email) {
  const out = {};
  (saved.garageTechs || []).forEach(t => {
    const id = 'TECH-' + short(plant).toUpperCase() + '-' + hash(text(t.name).toUpperCase()).toUpperCase().slice(0, 8);
    out[M.safeIdPart(id)] = { tech_id: id, name: text(t.name).toUpperCase().slice(0, 40), active: t.active === 'No' ? 'NO' : 'YES', facility_id: plant, created_at: stamp, created_by: email, createdInApp: true };
  });
  return out;
}
function recipientDocs(plant, saved, stamp, email) {
  const groups = {};
  (saved.recipients || []).forEach(r => { const g = groups[text(r.group).toUpperCase()] = groups[text(r.group).toUpperCase()] || { name: r.group, recipients: [] }; if (g.recipients.indexOf(r.email) < 0) g.recipients.push(r.email); });
  const out = {};
  Object.keys(groups).forEach(k => {
    const g = groups[k], id = M.safeIdPart(plant + '__' + text(g.name).toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    out[id] = { facilityId: plant, name: g.name, recipients: g.recipients, active: true, fromName: 'United Dairy Plant Distribution', version: 1, createdAt: stamp, createdBy: email, updatedAt: stamp, updatedBy: email };
  });
  return out;
}
const STATION_OF = { 'Case Loadout': ['PLANT', 'CASE'], 'Case Unloading': ['PLANT', 'CASE_UNLOADING'], 'Tote Loadout': ['PLANT', 'TOTES'], 'Boxing Loadout': ['PLANT', 'BOXING'],
  'Yard Services': ['PLANT', 'YARD_SERVICES'], Garage: ['GARAGE', 'GARAGE'], 'Driver Room Check-In Station': ['KIOSK', 'DRIVER'], "Driver's Kiosk Station": ['KIOSK', 'TV'], 'Plant Managers': ['MANAGER', 'MANAGERS'], 'Maintenance Station': ['MAINT', 'MAINT'], 'Line Tablet': ['LINE', 'LINE'] };
const ROLE_OF = (label) => (label === 'Driver Check-In' ? 'DRIVER_CHECKIN' : text(label).toUpperCase().replace(/[^A-Z]+/g, '_'));

/* ---------- writing ---------- */

async function commit(db, ops) {
  for (let i = 0; i < ops.length; i += BATCH) {
    const b = db.batch();
    ops.slice(i, i + BATCH).forEach(o => (o.del ? b.delete(o.ref) : b.set(o.ref, o.data, o.merge ? { merge: true } : {})));
    await b.commit();
  }
}
// One collection's records from one tab: each written whole (marked as from the upload), and the ones the tab wrote last time
// but no longer has taken off (or, for production lines, turned off).
function listOps(pdb, collection, docs, before, stamp, offInstead) {
  const ops = [], now = Object.keys(docs);
  now.forEach(id => ops.push({ ref: pdb.collection(collection).doc(id), data: Object.assign({}, docs[id], { fromUpload: true, uploadedAt: stamp }) }));
  (before || []).filter(id => now.indexOf(id) < 0).forEach(id => ops.push(offInstead ? { ref: pdb.collection(collection).doc(id), data: { status: 'INACTIVE', uploadedAt: stamp }, merge: true } : { ref: pdb.collection(collection).doc(id), del: true }));
  return { ops, ids: now };
}
// A save the screen uses, run here with the file's list (its own checks and records, logged in actions like any save).
async function screenSave(pdb, fn, req, email, stamp) {
  const logRef = pdb.collection('actions').doc(req.requestId);
  return pdb.runTransaction(tx => fn(tx, pdb, req, email, stamp, logRef, { mode: 'upload' }, SaveError));
}

/*
 * Fills the plant's own lists from the tabs this file filled. Returns {written: {tab: count}, notes: [words]} for the screen.
 */
async function applyUploads(home, pdb, plant, saved, tabs, opts) {
  const o = opts || {}, stamp = o.stamp || new Date().toISOString(), email = o.email || 'upload@uniteddairy.com';
  const has = (k) => tabs.indexOf(k) >= 0;
  const markRef = pdb.collection('private').doc('uploadApplied'), mark = (await markRef.get()).data() || {}, was = mark.lists || {}, lists = Object.assign({}, was);
  const written = {}, notes = [], ops = [];
  const list = (key, collection, docs, offInstead) => {
    const r = listOps(pdb, collection, docs, was[key], stamp, offInstead);
    ops.push(...r.ops);
    lists[key] = r.ids;
    written[key] = r.ids.length;
  };
  const rid = (tab) => 'upload_' + plant + '_' + tab + '_' + stamp.replace(/[^0-9]/g, '');

  // Dispatch: Route Master, Driver Master, days off.
  if (has('routes') || has('routeDays')) list('routes', M.COLLECTIONS.routes, routeDocs(plant, saved));
  if (has('drivers') || has('regularWeek') || (has('routes') && (saved.regularWeek || []).length)) {
    const drivers = driverDocs(plant, saved);
    list('drivers', M.COLLECTIONS.drivers, drivers);
    const phones = {};
    Object.keys(drivers).forEach(id => { if (drivers[id].phone) phones[id] = { driverId: drivers[id].id, phone: drivers[id].phone, updatedAt: stamp, updatedBy: email }; });
    list('driverPhones', 'driverPhones', phones);
  }
  if (has('daysOff')) {
    const d = dayOffDocs(plant, saved);
    list('vacations', M.COLLECTIONS.vacations, d.vacations);
    list('exceptions', M.COLLECTIONS.exceptions, d.exceptions);
  }
  // The plant: lines first (products, PMs and Line Targets name them).
  if (has('lines')) {
    const l = lineDocs(plant, saved, stamp, email);
    list('lines', 'plantSetup', l.setup, true);
    Object.keys(l.targets).forEach(id => ops.push({ ref: pdb.collection('productionLines').doc(id), data: l.targets[id], merge: true }));
  }
  if (has('machines')) list('machines', 'plantMachines', machineDocs(plant, saved, stamp, email));
  if (has('pmTasks')) {
    const p = pmDocs(plant, saved, stamp, email);
    list('pmTasks', 'plantPmTasks', p.docs);
    if (p.missing.length) notes.push('PM tasks for a machine or line not in the file were left out: ' + p.missing.slice(0, 5).join('; ') + (p.missing.length > 5 ? ' …' : '') + '.');
  }
  if (has('coolers')) list('coolers', 'tempLocations', tempDocs(plant, saved, stamp, email));
  if (has('extinguishers')) list('extinguishers', 'extinguishers', extinguisherDocs(plant, saved, stamp, email));
  if (has('suppliers')) list('suppliers', 'plantJournal', supplierDocs(plant, saved, stamp, email));
  if (has('receivingItems')) list('receivingItems', 'receivingItems', receivingDocs(plant, saved, stamp, email));
  if (has('garageTechs')) list('garageTechs', 'garageTechs', techDocs(plant, saved, stamp, email));
  if (has('recipients')) list('recipients', 'reportGroups', recipientDocs(plant, saved, stamp, email));
  await commit(pdb, ops);

  // Lists kept whole, through the screen's own save.
  if (has('products') && (saved.products || []).length) {
    const areas = {}, order = [];
    saved.products.forEach(p => {
      const k = text(p.line).toUpperCase();
      if (!areas[k]) { areas[k] = { name: p.line, products: [] }; order.push(k); }
      areas[k].products.push({ name: p.name, sku: p.sku, upc: p.upc, mfgType: p.mfgType, productGroup: p.productGroup, ratePerMin: p.ratePerMin, targetPct: p.targetPct,
        minSpeed: p.minSpeed, maxSpeed: p.maxSpeed, shelfLifeDays: p.shelfLifeDays, fillGrams: p.fillGrams });
    });
    const req = Object.assign({ action: 'saveProductUpload', requestId: rid('products') }, PLANT.validateProductUpload({ facilityId: plant, areas: order.map(k => areas[k]) }, SaveError));
    const r = await screenSave(pdb, PLANT.saveProductUpload, req, email, stamp);
    written.products = r.count;
  }
  if (has('shifts') && (saved.shifts || []).length) {
    const req = Object.assign({ action: 'savePlantShifts', requestId: rid('shifts') }, PLANT.validatePlantShifts({ facilityId: plant,
      shifts: saved.shifts.map(s => ({ name: s.name, start: s.start, end: s.end, side: (U.SHIFT_SIDES.find(x => x[1] === s.side) || U.SHIFT_SIDES[0])[0] })) }, SaveError));
    await screenSave(pdb, PLANT.savePlantShifts, req, email, stamp);
    written.shifts = req.shifts.length;
  }
  if (has('locationAreas') && (saved.locationAreas || []).length) {
    const areas = [], byKey = {};
    saved.locationAreas.forEach(r => {
      const key = ids.area(r.area);
      if (!byKey[key]) { byKey[key] = { key, name: r.area, subs: [] }; areas.push(byKey[key]); }
      if (r.sub && !byKey[key].subs.some(s => s.name.toUpperCase() === text(r.sub).toUpperCase())) byKey[key].subs.push({ key: ids.sub(r.area, r.sub), name: r.sub });
    });
    const req = Object.assign({ action: 'saveLocationAreas', requestId: rid('locationAreas') }, SAFE.validateLocations({ facilityId: plant, areas }, SaveError));
    await screenSave(pdb, SAFE.saveLocations, req, email, stamp);
    written.locationAreas = saved.locationAreas.length;
  }
  if (has('safety') && (saved.safety || []).length) {
    const areas = [], byKey = {};
    saved.safety.forEach(r => {
      const key = ids.sub(r.area, r.sub);
      if (!byKey[key]) { byKey[key] = { place: r.area, key, name: r.sub, items: [] }; areas.push(byKey[key]); }
      byKey[key].items.push({ id: 'up_' + hash(key + '|' + text(r.item).toUpperCase()), text: r.item, freq: text(r.freq).toUpperCase() });
    });
    const req = Object.assign({ action: 'saveSafetyChecklist', requestId: rid('safety') }, SAFE.validateChecklist({ facilityId: plant, areas }, SaveError));
    await screenSave(pdb, SAFE.saveChecklist, req, email, stamp);
    written.safety = saved.safety.length;
  }
  // Stations: their names (codes are made on Administration > Station Codes, never in a file).
  if (has('stations')) {
    const ref = pdb.collection('private').doc('stations');
    await pdb.runTransaction(async tx => {
      const d = (await tx.get(ref)).data() || {}, all = Object.assign({}, d.list || {}), before = was.stations || [], now = [];
      (saved.stations || []).forEach(s => {
        const kt = STATION_OF[s.kind];
        if (!kt) return;
        const key = 'st_up_' + hash(plant + '|' + kt.join('|') + '|' + text(s.name).toUpperCase());
        now.push(key);
        all[key] = Object.assign({ order: Object.keys(all).length, createdAt: stamp, createdBy: email }, all[key] || {}, { key, kind: kt[0], type: kt[1], name: s.name, facilityId: plant, fromUpload: true });
      });
      before.filter(k => now.indexOf(k) < 0).forEach(k => { delete all[k]; });
      tx.set(ref, Object.assign({}, d, { list: all }));
      lists.stations = now;
      written.stations = now.length;
    });
  }
  // Plant Email: the plant's sender (Email Senders) and its driver check-in mailbox, in the plant's own database.
  if (has('plantEmail') && (saved.plantEmail || []).length) {
    const e = saved.plantEmail[0], set = [];
    if (e.fromEmail) set.push(pdb.collection('private').doc('emailSettings').set({ senders: { [plant]: { address: e.fromEmail, name: e.fromName || '', changedAt: stamp, changedBy: email } } }, { merge: true }));
    if (e.checkinFrom || e.checkinTo || e.checkinSubject) {
      // Saved off: an administrator turns the check on in Driver Check-In Email (the mailbox is read as whoever turns it on).
      set.push(pdb.collection('private').doc('checkinEmail' + (plant === L.HOME_PLANT ? '' : '_' + plant)).set({ enabled: false, sender: e.checkinFrom || '', recipient: e.checkinTo || '',
        subject: text(e.checkinSubject).replace(/[\r\n"]+/g, ' '), updatedAt: stamp, updatedBy: email }, { merge: true }));
    }
    await Promise.all(set);
    written.plantEmail = 1;
  }
  // People: the company's one Users list. Someone new is added with this plant; someone already there keeps their role and
  // plants and only gains this plant. The server then copies them into the plant's database (plants.js).
  if (has('people')) {
    let added = 0, gained = 0;
    for (const p of saved.people || []) {
      const ref = home.collection('users').doc(M.safeIdPart(text(p.email).toLowerCase()));
      await home.runTransaction(async tx => {
        const s = await tx.get(ref);
        if (!s.exists) {
          tx.set(ref, { name: p.name, status: p.active === 'No' ? 'INACTIVE' : 'ACTIVE', roles: [ROLE_OF(p.role)], facilities: p.plants === 'All plants' ? ['*'] : [plant], createdAt: stamp, createdBy: email, fromUpload: plant });
          added++;
          return;
        }
        const f = Array.isArray(s.data().facilities) ? s.data().facilities : [];
        if (f.indexOf('*') >= 0 || f.indexOf(plant) >= 0) return;
        tx.update(ref, { facilities: f.concat([plant]), updatedAt: stamp, updatedBy: email });
        gained++;
      });
    }
    written.people = added + gained;
    if (gained) notes.push(gained + ' person' + (gained === 1 ? ' already on' : 's already on') + ' the Users list kept their role and gained ' + plantName(plant) + '.');
  }
  await markRef.set({ lists, at: stamp, by: email });
  return { written, notes };
}

module.exports = { applyUploads, ids, routeDocs, driverDocs, dayOffDocs, lineDocs };
