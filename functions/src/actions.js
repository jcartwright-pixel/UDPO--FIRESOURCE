/*
 * United Dairy Distribution app: saves.
 *
 * Every save is one call and one database transaction: it checks who is saving, checks nobody changed the
 * same run since the screen last showed it, writes the change, and records it in `actions` with before and
 * after. Sending the same request twice (a retry after a dropped connection) saves once.
 *
 * Saves never write Google Sheets directly: with the write-back on, each one queues its sheet cells (writeback.js,
 * masterwrite.js). Which screens may save is the per-screen switch (switch.js).
 */
'use strict';

const L = require('./logic');
const M = require('./model');
const { queueMaster } = require('./masterwrite');
const MAINT = require('./maintenance');
const PLANT = require('./plant');
const PROD = require('./production');
const OTR = require('./otr-core');
const SC = require('./sc-core');
const SAFE = require('./safety');
const PMAINT = require('./plantmaint');
const RECV = require('./receiving');
const GARAGE = require('./garage');
const RIGHTS = require('./rights');
const STATIONS = require('./stations');
// Each screen's saves are in their own file (review item 81, Joe 10/13); this file checks, routes and logs every save.
const { SaveError, text, requireTestMode, queueSheetCells, queueLoadoutHistory } = require('./actions-common');
const { moveRun, setUnitDown, updateIssue, reorder } = require('./actions-daily');
const { editDriver, setDriverPhone, saveDriver, removeDrivers, saveDriverTemplate, saveScorecard, rateTruckClean, addDriverIncident, reviewDriverIncident, excuseScorecardMiss, saveOpsAssignment } = require('./actions-drivers');
const { saveDriverException, saveVacation } = require('./actions-dayoff');
const { ROUTE_FIELDS, ROUTE_DAY_FIELDS, routeValue, saveRoute, routeLiveFollow, reorderRouteDay } = require('./actions-routes');
const { reorderWeek, publishWeek, setWeekReason, resetWeek } = require('./actions-weekly');
const LIVEROLL = require('./liveroll');
const { saveOtr, otrColumnKey } = require('./actions-otr');

const C = M.COLLECTIONS;

const SAVE_ROLES = L.SAVE_ROLES;
const REORDER_ROLES = L.REORDER_ROLES;
const DRIVER_ROLES = L.DRIVER_ROLES;
const SMS = require('./sms');

const ACTIONS = Object.freeze({
  assignDriver: { roles: SAVE_ROLES, screen: 'dailyDispatch' },
  assignTruck: { roles: SAVE_ROLES, screen: 'dailyDispatch' },
  assignTrailer: { roles: SAVE_ROLES, screen: 'dailyDispatch' },
  setDriverNote: { roles: SAVE_ROLES, screen: 'dailyDispatch' },
  setRuns: { roles: SAVE_ROLES, screen: 'dailyDispatch' },
  setDispatchTime: { roles: SAVE_ROLES, screen: 'dailyDispatch' },
  setJack: { roles: SAVE_ROLES, screen: 'dailyDispatch' },
  // Joe 10/19 (800 Specials): the day's load type, so the load goes to the right loadout.
  setLoadType: { roles: SAVE_ROLES, screen: 'dailyDispatch' },
  moveRun: { roles: SAVE_ROLES, screen: 'dailyDispatch' },
  setUnitDown: { roles: SAVE_ROLES, screen: 'dailyDispatch' },
  setUnitUp: { roles: SAVE_ROLES, screen: 'dailyDispatch' },
  reorderLoads: { roles: REORDER_ROLES, screen: 'dailyDispatch' },
  clearConflict: { roles: SAVE_ROLES, screen: 'conflicts' },
  saveCheckIn: { roles: SAVE_ROLES, screen: 'checkIns' },
  setDriverTruck: { roles: DRIVER_ROLES, screen: 'drivers' },
  setDriverAvailable: { roles: DRIVER_ROLES, screen: 'drivers' },
  setDriverRelief: { roles: DRIVER_ROLES, screen: 'drivers' },
  // Joe 10/15: the driver's mobile phone for Schedule Texts (driverPhones, app only).
  setDriverPhone: { roles: DRIVER_ROLES, screen: 'drivers' },
  saveDriver: { roles: DRIVER_ROLES, screen: 'drivers' },
  removeDrivers: { roles: DRIVER_ROLES, screen: 'drivers' },
  saveDriverException: { roles: SAVE_ROLES, screen: 'drivers' },
  saveVacation: { roles: DRIVER_ROLES, screen: 'vacations' },
  publishWeek: { roles: SAVE_ROLES, screen: 'weeklyDispatch' },
  resetWeek: { roles: REORDER_ROLES, screen: 'weeklyDispatch' },
  saveRoute: { roles: REORDER_ROLES, screen: 'routes' },
  reorderRouteDay: { roles: REORDER_ROLES, screen: 'routes' },
  // Joe 10/12: on Weekly Dispatch a manager drags a route's line up or down (saved as Route Master's route_week_display).
  reorderWeek: { roles: REORDER_ROLES, screen: 'weeklyDispatch' },
  updateIssue: { roles: SAVE_ROLES, screen: 'checkIns' },
  setWeekReason: { roles: SAVE_ROLES, screen: 'weeklyDispatch' },
  saveDriverTemplate: { roles: DRIVER_ROLES, screen: 'drivers' },
  saveOtr: { roles: DRIVER_ROLES, screen: 'otr' },
  saveScorecard: { roles: DRIVER_ROLES, screen: 'scorecard' },
  // Joe 10/13: a manager rates a driver's truck cleanliness 1 to 5 on the Driver Scorecard.
  rateTruckClean: { roles: DRIVER_ROLES, screen: 'scorecard' },
  // Joe 10/13: accidents / incidents and complaints (Driver Roster > Edit), reviewed by a manager; an excused GPS miss.
  addDriverIncident: { roles: DRIVER_ROLES, screen: 'scorecard' },
  reviewDriverIncident: { roles: DRIVER_ROLES, screen: 'scorecard' },
  excuseScorecardMiss: { roles: DRIVER_ROLES, screen: 'scorecard' },
  saveOpsAssignment: { roles: DRIVER_ROLES, screen: 'opsAssignments' },
  // The plant side (plant.js): Loadout Center loads and pickups. The Plant Distribution screens are their own switch (Plant Loading).
  savePlantLoad: { roles: PLANT.PLANT_ROLES, screen: 'plantLoading' },
  addPickup: { roles: PLANT.PLANT_ROLES, screen: 'plantLoading' },
  completePickup: { roles: PLANT.PLANT_ROLES, screen: 'plantLoading' },
  // Loadout Center: drag a load to change today's loading order (saved as the day's load_sequence_override).
  reorderPlantLoads: { roles: PLANT.PLANT_ROLES, screen: 'plantLoading' },
  // Unloading & Washing, Product Returns and Truck Washing.
  saveUnloading: { roles: PLANT.PLANT_ROLES, screen: 'plantLoading' },
  completeWash: { roles: PLANT.PLANT_ROLES, screen: 'plantLoading' },
  addReturn: { roles: PLANT.PLANT_ROLES, screen: 'plantLoading' },
  // Plant Operations Scheduler (Shipping and Receiving).
  savePlantSchedule: { roles: PLANT.PLANT_ROLES, screen: 'plant' },
  saveYardCheck: { roles: PLANT.PLANT_ROLES, screen: 'plant' },
  saveQualityCheck: { roles: PLANT.PLANT_ROLES, screen: 'plant' },
  saveShiftNote: { roles: PLANT.PLANT_ROLES, screen: 'plant' },
  saveTemperatureCheck: { roles: PLANT.PLANT_ROLES, screen: 'plant' },
  sendPlantReport: { roles: L.SAVE_ROLES, screen: 'plant' },
  // Administration > Products: each plant's products by area, its own areas and groups, and the template upload.
  saveMachineProducts: { roles: REORDER_ROLES, screen: 'plant' },
  saveProductSetup: { roles: REORDER_ROLES, screen: 'plant' },
  saveProductUpload: { roles: REORDER_ROLES, screen: 'plant' },
  saveProductSheet: { roles: REORDER_ROLES, screen: 'plant' },
  // Administration > Plant Shifts: each plant's shifts (Plant Reports' Shift Comparison).
  savePlantShifts: { roles: REORDER_ROLES, screen: 'plant' },
  // Plant Production (production.js): the line tablet's taps, and how each line is counted (Line Targets).
  saveLineEntry: { roles: PLANT.PLANT_ROLES, screen: 'plant' },
  saveLineCounter: { roles: REORDER_ROLES, screen: 'plant' },
  saveLineSetup: { roles: REORDER_ROLES, screen: 'plant' },
  // Safety Walkthrough (safety.js): the weekly walk and its issues, each extinguisher's monthly check; a manager or
  // administrator keeps the extinguisher list and the plant's checklist.
  saveSafetyWalk: { roles: PLANT.PLANT_ROLES, screen: 'plant' },
  saveSafetyIssue: { roles: PLANT.PLANT_ROLES, screen: 'plant' },
  saveExtinguisherCheck: { roles: PLANT.PLANT_ROLES, screen: 'plant' },
  saveExtinguisher: { roles: REORDER_ROLES, screen: 'plant' },
  saveFireSystemCheck: { roles: PLANT.PLANT_ROLES, screen: 'plant' },
  saveFireSystem: { roles: REORDER_ROLES, screen: 'plant' },
  saveSafetyChecklist: { roles: REORDER_ROLES, screen: 'plant' },
  saveLocationAreas: { roles: REORDER_ROLES, screen: 'plant' },
  // Plant Maintenance (plantmaint.js): the machinery list, and Maintenance Center's Make Work Order (a plant request becomes a work order).
  saveMachine: { roles: REORDER_ROLES, screen: 'plant' },
  makeWorkOrder: { roles: L.SAVE_ROLES, screen: 'plant' },
  savePmTask: { roles: REORDER_ROLES, screen: 'plant' },
  sendPmToMaintenance: { roles: REORDER_ROLES, screen: 'plant' },
  // Receiving scan-in (receiving.js): each scan on a delivery, and the list of what the plant receives.
  saveReceivingScan: { roles: PLANT.PLANT_ROLES, screen: 'plant' },
  saveReceivingItem: { roles: REORDER_ROLES, screen: 'plant' },
  // Fleet Service's Send to Garage: a PM, reefer service or DOT inspection becomes a Garage Station job (garage.js).
  sendToGarage: { roles: REORDER_ROLES, screen: 'checkIns' },
  // Fleet Service's Work Orders: Delete takes a job off the Garage Station (garage.js deleteGarageJob, Joe 10/14).
  deleteGarageJob: { roles: REORDER_ROLES, screen: 'checkIns' },
  // Fleet Service Setup: the service rules, each unit's dates, and the garage technicians (garage.js). App only (logic.js APP_ONLY).
  saveFleetRules: { roles: REORDER_ROLES, screen: 'fleetSetup' },
  saveFleetUnit: { roles: REORDER_ROLES, screen: 'fleetSetup' },
  saveGarageTech: { roles: REORDER_ROLES, screen: 'fleetSetup' }
});

const EXCEPTION_REASONS = ['SICK DAY', 'BEREAVEMENT', 'PERSONAL DAY', 'UNPAID DAY', 'VACATION', 'CALLED OFF', 'OFF', 'OTHER'];
const VACATION_STATUSES = ['APPROVED', 'PENDING', 'DENIED', 'CANCELLED'];

const DRIVER_ACTIONS = ['setDriverTruck', 'setDriverAvailable', 'setDriverRelief'];

function dateOrBlank(v, label) {
  const t = text(v, 40);
  if (!t) return '';
  const key = L.dateKey(t);
  if (!key) throw new SaveError('BAD_REQUEST', label + ' must be a date');
  return key;
}

function count(v, label) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 99999) throw new SaveError('BAD_REQUEST', label + ' must be a whole number from 0 to 99999');
  return n;
}

function validate(input) {
  input = input || {};
  const action = text(input.action, 40);
  if (!ACTIONS[action]) throw new SaveError('BAD_REQUEST', 'Unknown save: ' + (action || '(none)'));
  const requestId = text(input.requestId, 80);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) throw new SaveError('BAD_REQUEST', 'Each save needs a requestId');
  const out = { action, requestId };
  if (action === 'reorderLoads' || action === 'reorderPlantLoads') {
    if (!L.isDateKey(input.loadDate)) throw new SaveError('BAD_REQUEST', 'loadDate must be yyyy-mm-dd');
    if (!Array.isArray(input.order) || !input.order.length || input.order.length > 150) throw new SaveError('BAD_REQUEST', 'order must list the loads');
    out.loadDate = input.loadDate;
    out.order = input.order.map(item => ({ runDocId: text(item && item.runDocId), day: text(item && item.day, 10) }));
    const seen = {};
    out.order.forEach(item => {
      if (!item.runDocId || L.DAYS.indexOf(item.day) < 0) throw new SaveError('BAD_REQUEST', 'Each load needs runDocId and day');
      const k = item.runDocId + '|' + item.day;
      if (seen[k]) throw new SaveError('BAD_REQUEST', 'A load is listed twice');
      seen[k] = true;
    });
    // Joe 10/16: the load a person moved (dragged, or Skip: down one place) is marked with how and who, as the plant sees it.
    if (input.moved && typeof input.moved === 'object') {
      const m = { runDocId: text(input.moved.runDocId), day: text(input.moved.day, 10), how: String(input.moved.how || '').toUpperCase() === 'SKIP' ? 'SKIP' : 'DRAG' };
      if (!seen[m.runDocId + '|' + m.day]) throw new SaveError('BAD_REQUEST', 'The moved load is not in the order');
      out.moved = m;
    }
    if (input.station !== undefined && text(input.station)) out.station = text(input.station).replace(/[^A-Za-z0-9 /&-]/g, '').slice(0, 40);
    return out;
  }
  if (action === 'clearConflict') {
    out.conflictId = text(input.conflictId);
    if (!/^[A-Za-z0-9_-]{8,160}$/.test(out.conflictId)) throw new SaveError('BAD_REQUEST', 'conflictId is required');
    return out;
  }
  if (action === 'saveDriver') {
    out.driverId = text(input.driverId);
    out.name = text(input.name, 120).toUpperCase();
    if (!out.name) throw new SaveError('BAD_REQUEST', 'Enter the driver name');
    out.hireDate = dateOrBlank(input.hireDate, 'Hire date');
    out.seniorityDate = dateOrBlank(input.seniorityDate, 'Seniority date');
    out.truck = text(input.truck, 40).toUpperCase();
    out.relief = input.relief === true;
    return out;
  }
  if (action === 'saveDriverException') {
    out.driverId = text(input.driverId);
    out.startDate = dateOrBlank(input.startDate, 'Start date');
    out.endDate = dateOrBlank(input.endDate || input.startDate, 'End date');
    if (!out.driverId || !out.startDate || !out.endDate) throw new SaveError('BAD_REQUEST', 'Driver, Start Date and End Date are required');
    if (out.endDate < out.startDate) throw new SaveError('BAD_REQUEST', 'End Date cannot be before Start Date');
    const status = text(input.status, 20).toUpperCase();
    // Joe 10/16: BACKUP marks the driver Backup on those days (available, on call to cover a route).
    out.status = status === 'AVAILABLE' || status === 'CLEAR' ? 'AVAILABLE' : status === 'BACKUP' ? 'BACKUP' : 'UNAVAILABLE';
    if (out.status === 'BACKUP' && L.daysBetween(out.startDate, out.endDate) > 62) throw new SaveError('BAD_REQUEST', 'Backup can be set for at most two months at a time');
    out.reason = text(input.reason, 40).toUpperCase() || 'OTHER';
    if (EXCEPTION_REASONS.indexOf(out.reason) < 0) out.reason = 'OTHER';
    out.note = text(input.note, 300);
    return out;
  }
  if (action === 'saveVacation') {
    out.vacationId = text(input.vacationId, 80);
    out.driverId = text(input.driverId);
    out.startDate = dateOrBlank(input.startDate, 'First day');
    out.endDate = dateOrBlank(input.endDate || input.startDate, 'Last day');
    if (!out.driverId || !out.startDate || !out.endDate) throw new SaveError('BAD_REQUEST', 'Driver, First day and Last day are required');
    if (out.endDate < out.startDate) throw new SaveError('BAD_REQUEST', 'Last day cannot be before First day');
    if (L.daysBetween(out.startDate, out.endDate) > 366) throw new SaveError('BAD_REQUEST', 'A vacation entry can be at most a year long');
    out.type = L.vacationType(input.type);
    out.status = text(input.status, 20).toUpperCase() || 'APPROVED';
    if (VACATION_STATUSES.indexOf(out.status) < 0) throw new SaveError('BAD_REQUEST', 'Vacation status is invalid');
    out.notes = text(input.notes, 1000);
    // Kept with the entry like the current form; nothing is sent (outbound email stays off).
    out.email = text(input.email, 200);
    if (out.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email)) throw new SaveError('BAD_REQUEST', 'Notification email does not look like an email address');
    return out;
  }
  if (action === 'saveRoute') {
    out.runId = text(input.runId, 120);
    out.fields = {};
    const f = input.fields || {};
    Object.keys(f).forEach(k => {
      if (!ROUTE_FIELDS[k]) throw new SaveError('BAD_REQUEST', k + ' is not a Route Master field');
      out.fields[k] = routeValue(ROUTE_FIELDS[k], f[k], k);
    });
    out.days = {};
    Object.keys(input.days || {}).forEach(p => {
      if (L.DAYS.indexOf(p) < 0) throw new SaveError('BAD_REQUEST', p + ' is not a day');
      out.days[p] = {};
      Object.keys(input.days[p] || {}).forEach(k => {
        if (!ROUTE_DAY_FIELDS[k]) throw new SaveError('BAD_REQUEST', k + ' is not a Route Master day field');
        out.days[p][k] = routeValue(ROUTE_DAY_FIELDS[k], input.days[p][k], L.DAY_NAMES[L.DAYS.indexOf(p)] + ' ' + k);
      });
    });
    // The screen the save came from: Over the Road's miles box is held on the live app until switched on (actions-routes.js).
    out.from = input.from === 'otr' ? 'otr' : '';
    if (!out.runId && !(out.fields.route && out.fields.run)) throw new SaveError('BAD_REQUEST', 'A new run needs a Route and a Run / Destination');
    return out;
  }
  if (action === 'reorderRouteDay') {
    if (L.DAYS.indexOf(input.day) < 0) throw new SaveError('BAD_REQUEST', 'Pick the day');
    if (!Array.isArray(input.runIds) || !input.runIds.length || input.runIds.length > 300) throw new SaveError('BAD_REQUEST', 'The order is missing');
    out.day = input.day;
    out.runIds = input.runIds.map(id => text(id, 120));
    return out;
  }
  if (action === 'reorderWeek') {
    if (!L.isDateKey(input.weekStart) || L.weekStart(input.weekStart) !== input.weekStart) throw new SaveError('BAD_REQUEST', 'weekStart must be a Sunday (yyyy-mm-dd)');
    if (!Array.isArray(input.runIds) || !input.runIds.length || input.runIds.length > 300) throw new SaveError('BAD_REQUEST', 'The order is missing');
    out.weekStart = input.weekStart;
    out.runIds = [...new Set(input.runIds.map(id => text(id, 120)).filter(Boolean))];
    if (out.runIds.length !== input.runIds.length) throw new SaveError('BAD_REQUEST', 'The order has a run twice or a blank run');
    return out;
  }
  if (action === 'publishWeek' || action === 'resetWeek') {
    if (!L.isDateKey(input.weekStart) || L.weekStart(input.weekStart) !== input.weekStart) throw new SaveError('BAD_REQUEST', 'weekStart must be a Sunday (yyyy-mm-dd)');
    out.weekStart = input.weekStart;
    return out;
  }
  if (action === 'removeDrivers') {
    if (!Array.isArray(input.driverIds) || !input.driverIds.length || input.driverIds.length > 100) throw new SaveError('BAD_REQUEST', 'Pick the drivers to remove');
    out.driverIds = [...new Set(input.driverIds.map(id => text(id)).filter(Boolean))];
    return out;
  }
  if (action === 'saveDriverTemplate') {
    out.driverId = text(input.driverId);
    if (!out.driverId) throw new SaveError('BAD_REQUEST', 'Pick the driver');
    if (L.DAYS.indexOf(input.day) < 0) throw new SaveError('BAD_REQUEST', 'day must be sun..sat');
    out.day = input.day;
    out.status = text(input.status).toUpperCase();
    if (['AVAILABLE', 'OFF', 'ASSIGNMENT'].indexOf(out.status) < 0) throw new SaveError('BAD_REQUEST', 'status must be AVAILABLE, OFF or ASSIGNMENT');
    out.runIds = [...new Set((Array.isArray(input.runIds) ? input.runIds : []).map(id => text(id, 120)).filter(Boolean))].slice(0, 6);
    if (out.status === 'ASSIGNMENT' && !out.runIds.length) throw new SaveError('BAD_REQUEST', 'Pick a run');
    if (out.status !== 'ASSIGNMENT') out.runIds = [];
    return out;
  }
  // Over the Road (the current app's OTR saves, 222_V7276): tick a run for the report, type a month figure, or fix a day's count.
  if (action === 'saveOtr') {
    out.op = text(input.op, 10);
    if (out.op === 'route') {
      out.runId = text(input.runId, 120);
      if (!out.runId) throw new SaveError('BAD_REQUEST', 'Pick the run');
      out.include = input.include === true;
      out.destination = OTR.otrNormDest_(input.destination);
      // Joe 10/10: the run is the destination (OTR Routes Setup sends the run name), so any name is kept; who takes it is Delivered By.
      out.destination = text(out.destination, 60);
      if (out.include && !out.destination) throw new SaveError('BAD_REQUEST', 'Pick where this route goes before including it');
      out.deliveredBy = text(input.deliveredBy, 40);
      if (out.deliveredBy && ['Carrier Pickup', 'United Dairy Delivered', 'Transfer'].indexOf(out.deliveredBy) < 0) throw new SaveError('BAD_REQUEST', 'Delivered By must be Carrier Pickup, United Dairy Delivered or Transfer');
    } else if (out.op === 'figure') {
      out.year = Number(input.year); out.month = Number(input.month); out.key = text(input.key, 40);
      if (!Number.isInteger(out.year) || out.year < 2000 || out.year > 2100 || !Number.isInteger(out.month) || out.month < 1 || out.month > 12) throw new SaveError('BAD_REQUEST', 'Pick a month');
      if (!OTR.OTR_CORE.FIGURES.some(f => f.key === out.key)) throw new SaveError('BAD_REQUEST', 'Unknown figure ' + out.key);
      out.value = input.value === '' || input.value === null || input.value === undefined ? null : OTR.otrNum_(input.value);
      if (out.value === null && !(input.value === '' || input.value === null || input.value === undefined)) throw new SaveError('BAD_REQUEST', input.value + ' is not a number');
    } else if (out.op === 'day') {
      out.date = text(input.date, 10); out.destination = OTR.otrNormDest_(input.destination); out.runs = count(input.runs, 'Runs');
      if (!L.isDateKey(out.date)) throw new SaveError('BAD_REQUEST', 'date must be yyyy-mm-dd');
      // A column added in OTR Routes Setup (otrColumns) is checked when the save runs.
      out.destination = text(out.destination, 60);
      if (!out.destination) throw new SaveError('BAD_REQUEST', 'Pick a destination from the list');
      if (out.runs === null) throw new SaveError('BAD_REQUEST', 'Type the number of runs');
    } else if (out.op === 'column') {
      // Joe 10/13: a By Date column of his own (an outside carrier such as Darden); renamed or removed only while nothing uses it.
      out.verb = text(input.verb, 10); out.name = text(input.name, 40);
      if (['add', 'rename', 'remove'].indexOf(out.verb) < 0) throw new SaveError('BAD_REQUEST', 'Add, rename or remove a column');
      if (!out.name) throw new SaveError('BAD_REQUEST', 'Type the column name');
      if (out.verb === 'rename') { out.newName = text(input.newName, 40); if (!out.newName) throw new SaveError('BAD_REQUEST', 'Type the new column name'); }
      const fixed = n => OTR.OTR_CORE.DESTINATIONS.some(d => otrColumnKey(d) === otrColumnKey(n));
      if (fixed(out.name) && out.verb !== 'add') throw new SaveError('BAD_REQUEST', out.name + ' is one of the workbook\'s own columns and stays');
      const made = out.verb === 'add' ? out.name : out.newName;
      if (made && fixed(made)) throw new SaveError('BAD_REQUEST', made + ' is already a column');
    } else if (out.op === 'comment') {
      // The Comment column of the By Date tab: one note per day ("Lost 5 Walmart Rts"); empty clears it.
      out.date = text(input.date, 10); out.text = text(input.text, 200);
      if (!L.isDateKey(out.date)) throw new SaveError('BAD_REQUEST', 'date must be yyyy-mm-dd');
    } else if (out.op === 'import') {
      // Import From Accounting (the current app's otrImportApply_): the screen reads the Excel files and sends what it found.
      const figs = Array.isArray(input.figures) ? input.figures : [], days = Array.isArray(input.daily) ? input.daily : [];
      const notes = Array.isArray(input.comments) ? input.comments : [];
      if (figs.length > 1000 || days.length > 300 || notes.length > 300) throw new SaveError('BAD_REQUEST', 'Too many numbers in one save');
      const months = {};
      figs.forEach(f => {
        const y = Number(f && f.year), m = Number(f && f.month), key = text(f && f.key, 40), v = OTR.otrNum_(f && f.value);
        if (!Number.isInteger(y) || y < 2000 || y > 2100 || !Number.isInteger(m) || m < 1 || m > 12) throw new SaveError('BAD_REQUEST', 'Pick a month');
        if (!OTR.OTR_CORE.FIGURES.some(x => x.key === key)) throw new SaveError('BAD_REQUEST', 'Unknown figure ' + key);
        if (v === null) throw new SaveError('BAD_REQUEST', 'A figure is not a number');
        (months[y + '-' + m] = months[y + '-' + m] || { year: y, month: m })[key] = v;
      });
      out.months = Object.values(months);
      if (out.months.length > 60) throw new SaveError('BAD_REQUEST', 'Too many months in one save');
      const seen = {};
      out.daily = [];
      days.forEach(d => {
        const date = text(d && d.date, 10), dest = text(OTR.otrNormDest_(d && d.destination), 60), runs = count(d && d.runs, 'Runs');
        if (!L.isDateKey(date)) throw new SaveError('BAD_REQUEST', 'date must be yyyy-mm-dd');
        if (!dest) throw new SaveError('BAD_REQUEST', 'Pick a destination');
        if (runs === null) throw new SaveError('BAD_REQUEST', 'Type the number of runs');
        seen[date + '|' + dest] = { date, destination: dest, runs };
      });
      out.daily = Object.values(seen);
      const said = {};
      notes.forEach(c => {
        const date = text(c && c.date, 10), t = text(c && c.text, 200);
        if (!L.isDateKey(date)) throw new SaveError('BAD_REQUEST', 'date must be yyyy-mm-dd');
        if (t) said[date] = { date, text: t };
      });
      out.comments = Object.values(said);
      if (!out.months.length && !out.daily.length && !out.comments.length) throw new SaveError('BAD_REQUEST', 'Nothing to import');
    } else throw new SaveError('BAD_REQUEST', 'op must be route, figure, day, comment or import');
    return out;
  }
  // Driver Scorecard Settings (the current app's scSaveSettings_): one points or grade number, or the call-off reasons.
  // Operational Assignments (the current app's desktopUiSaveOperationalAssignmentV037): a name, Active and its place in the list.
  if (action === 'saveOpsAssignment') {
    out.assignment = text(input.assignment, 60).replace(/\s+/g, ' ');
    if (!out.assignment) throw new SaveError('BAD_REQUEST', 'Type the assignment name');
    if (out.assignment.startsWith('__')) throw new SaveError('BAD_REQUEST', 'That name cannot be used');
    out.active = input.active !== false;
    out.sequence = Number(input.sequence);
    if (!Number.isInteger(out.sequence) || out.sequence < 1 || out.sequence > 999) throw new SaveError('BAD_REQUEST', 'Order must be a whole number from 1 to 999');
    return out;
  }
  if (action === 'rateTruckClean') {
    out.driverKey = text(input.driverKey, 80).toUpperCase();
    out.driver = text(input.driver, 80);
    out.date = text(input.date);
    out.rating = Number(input.rating);
    out.truck = text(input.truck, 20);
    out.note = text(input.note, 300);
    if (!out.driverKey) throw new SaveError('BAD_REQUEST', 'Pick the driver');
    if (!L.isDateKey(out.date)) throw new SaveError('BAD_REQUEST', 'date must be yyyy-mm-dd');
    if (!Number.isInteger(out.rating) || out.rating < 1 || out.rating > 5) throw new SaveError('BAD_REQUEST', 'Pick a rating from 1 to 5');
    return out;
  }
  if (action === 'addDriverIncident') {
    out.kind = text(input.kind, 20);
    if (['accident', 'complaint', 'pda'].indexOf(out.kind) < 0) throw new SaveError('BAD_REQUEST', 'kind must be accident, complaint or pda');
    out.driverKey = text(input.driverKey, 80).toUpperCase();
    out.driver = text(input.driver, 80);
    out.date = text(input.date);
    out.type = text(input.type, 80);
    out.note = text(input.note, 500);
    if (!out.driverKey) throw new SaveError('BAD_REQUEST', 'Pick the driver');
    if (!L.isDateKey(out.date)) throw new SaveError('BAD_REQUEST', 'Pick the date');
    if (out.kind === 'pda') {
      out.step = text(input.step, 20);
      if (SC.SC_CORE.PDA_STEPS.map(k => k[0]).indexOf(out.step) < 0) throw new SaveError('BAD_REQUEST', 'Pick the PDA step');
      out.reason = text(input.reason, 120);
    } else if (out.kind === 'accident') {
      out.accidentClass = Number(input.accidentClass);
      if ([1, 2, 3].indexOf(out.accidentClass) < 0) throw new SaveError('BAD_REQUEST', 'Pick 1st, 2nd or 3rd degree');
      out.truck = text(input.truck, 20);
      out.preventable = input.preventable === true || input.preventable === 'yes';
    } else {
      out.source = text(input.source, 20) === 'other' ? 'other' : 'customer';
      out.customer = text(input.customer, 80);
      out.severity = text(input.severity, 10).toLowerCase();
      if (['minor', 'major'].indexOf(out.severity) < 0) throw new SaveError('BAD_REQUEST', 'Pick Minor or Major');
    }
    return out;
  }
  if (action === 'reviewDriverIncident') {
    out.incidentId = text(input.incidentId, 120);
    out.status = text(input.status, 20);
    if (!out.incidentId) throw new SaveError('BAD_REQUEST', 'Pick the entry');
    if (['review', 'counts', 'notCounted'].indexOf(out.status) < 0) throw new SaveError('BAD_REQUEST', 'status must be review, counts or notCounted');
    return out;
  }
  if (action === 'excuseScorecardMiss') {
    out.key = text(input.key, 300);
    out.reason = text(input.reason, 300);
    out.undo = input.undo === true;
    out.driverKey = text(input.driverKey, 80).toUpperCase();
    out.what = text(input.what, 300);
    if (!/^(gps|time|att)\|\d{4}-\d{2}-\d{2}\|/.test(out.key)) throw new SaveError('BAD_REQUEST', 'Only a GPS, Time or attendance miss can be excused');
    if (!out.undo && !out.reason) throw new SaveError('BAD_REQUEST', 'Type the reason');
    // Joe 10/16: a call-off is excused for FMLA or Other (Other with a note).
    if (!out.undo && /^att\|/.test(out.key) && !/^(FMLA(: .+)?|Other: .+)$/.test(out.reason)) throw new SaveError('BAD_REQUEST', 'Pick FMLA or Other (with a note)');
    return out;
  }
  if (action === 'saveScorecard') {
    if (Array.isArray(input.kioskAreas)) {
      out.kioskAreas = [...new Set(input.kioskAreas.map(k => text(k, 40)))];
      if (out.kioskAreas.some(k => !SC.SC_CORE.AREAS.some(a => a[0] === k))) throw new SaveError('BAD_REQUEST', 'Unknown scorecard area');
      return out;
    }
    if (Array.isArray(input.callOffReasons)) {
      out.callOffReasons = [...new Set(input.callOffReasons.map(r => text(r, 40).toUpperCase()))];
      if (out.callOffReasons.some(r => SC.SC_CORE.REASONS.indexOf(r) < 0)) throw new SaveError('BAD_REQUEST', 'Unknown call-off reason');
      return out;
    }
    // Joe 10/14: Scorecard counted from (a date).
    if (input.countFrom !== undefined) {
      out.countFrom = text(input.countFrom, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(out.countFrom) || SC.scKeyOf_(out.countFrom) !== out.countFrom) throw new SaveError('BAD_REQUEST', 'Pick a date');
      return out;
    }
    out.key = text(input.key, 40);
    if (SC.SC_CORE.NUMBER_SETTINGS.indexOf(out.key) < 0) throw new SaveError('BAD_REQUEST', 'Unknown setting ' + out.key);
    out.value = Number(String(input.value).trim());
    if (String(input.value).trim() === '' || !isFinite(out.value) || out.value < 0 || out.value > 100) throw new SaveError('BAD_REQUEST', 'Type a number from 0 to 100');
    return out;
  }
  if (action === 'setWeekReason') {
    out.weekStart = text(input.weekStart);
    if (!L.isDateKey(out.weekStart)) throw new SaveError('BAD_REQUEST', 'weekStart must be yyyy-mm-dd');
    out.reason = text(input.reason, 300);
    return out;
  }
  if (action === 'updateIssue') {
    out.recordId = text(input.recordId, 300);
    if (!out.recordId) throw new SaveError('BAD_REQUEST', 'Pick the write-up');
    out.step = text(input.step);
    if (['repaired', 'reviewed', 'remove', 'garage', 'lessor'].indexOf(out.step) < 0) throw new SaveError('BAD_REQUEST', 'step must be repaired, reviewed, remove, garage or lessor');
    out.note = text(input.note, 500);
    return out;
  }
  if (action === 'setUnitDown' || action === 'setUnitUp') {
    out.equipmentId = text(input.equipmentId);
    if (!out.equipmentId) throw new SaveError('BAD_REQUEST', 'Pick the truck or trailer');
    out.reason = text(input.reason, 120);
    // Like the current app, the reason is optional.
    // Review item 71 (Joe 10/13): the screen's "today" is no longer used (a tablet left open since yesterday cleared
    // yesterday's runs); the server's operating day decides. An old screen may still send it; it is checked and ignored.
    if (input.today !== undefined && !L.isDateKey(input.today)) throw new SaveError('BAD_REQUEST', 'today must be yyyy-mm-dd');
    // Joe 10/12: a unit already down can be taken off the loads it is still on (its status and reason stay as they are).
    out.clearOnly = input.clearOnly === true;
    return out;
  }
  if (action === 'addPickup' || action === 'completePickup') return Object.assign(out, PLANT.validatePickup(action, input, SaveError));
  if (action === 'saveUnloading') return Object.assign(out, PLANT.validateUnload(input, SaveError));
  if (action === 'completeWash') return Object.assign(out, PLANT.validateWash(input, SaveError));
  if (action === 'addReturn') return Object.assign(out, PLANT.validateReturn(input, SaveError));
  if (action === 'savePlantSchedule') return Object.assign(out, PLANT.validateSchedule(input, SaveError));
  if (action === 'saveYardCheck') return Object.assign(out, PLANT.validateYard(input, SaveError));
  if (action === 'saveQualityCheck') return Object.assign(out, PLANT.validateQuality(input, SaveError));
  if (action === 'saveShiftNote') return Object.assign(out, PLANT.validateShiftNote(input, SaveError));
  if (action === 'saveTemperatureCheck') return Object.assign(out, PLANT.validateTemperature(input, SaveError));
  if (action === 'sendPlantReport') return Object.assign(out, PLANT.validateReport(input, SaveError));
  if (action === 'saveMachineProducts') return Object.assign(out, PLANT.validateMachineProducts(input, SaveError));
  if (action === 'saveProductSetup') return Object.assign(out, PLANT.validateProductSetup(input, SaveError));
  if (action === 'saveProductUpload') return Object.assign(out, PLANT.validateProductUpload(input, SaveError));
  if (action === 'saveProductSheet') return Object.assign(out, PLANT.validateProductSheet(input, SaveError));
  if (action === 'savePlantShifts') return Object.assign(out, PLANT.validatePlantShifts(input, SaveError));
  if (action === 'saveLineEntry') return Object.assign(out, PROD.validateLineEntry(input, SaveError));
  if (action === 'saveLineCounter') return Object.assign(out, PROD.validateLineCounter(input, SaveError));
  if (action === 'saveLineSetup') return Object.assign(out, PROD.validateLineSetup(input, SaveError));
  if (action === 'saveSafetyWalk') return Object.assign(out, SAFE.validateWalk(input, SaveError));
  if (action === 'saveSafetyIssue') return Object.assign(out, SAFE.validateIssue(input, SaveError));
  if (action === 'saveExtinguisherCheck') return Object.assign(out, SAFE.validateExtCheck(input, SaveError));
  if (action === 'saveExtinguisher') return Object.assign(out, SAFE.validateExtinguisher(input, SaveError));
  if (action === 'saveFireSystemCheck') return Object.assign(out, SAFE.validateFireCheck(input, SaveError));
  if (action === 'saveFireSystem') return Object.assign(out, SAFE.validateFireSystem(input, SaveError));
  if (action === 'saveReceivingScan') return Object.assign(out, RECV.validateReceiving(input, SaveError));
  if (action === 'saveReceivingItem') return Object.assign(out, RECV.validateReceivingItem(input, SaveError));
  if (action === 'saveSafetyChecklist') return Object.assign(out, SAFE.validateChecklist(input, SaveError));
  if (action === 'saveLocationAreas') return Object.assign(out, SAFE.validateLocations(input, SaveError));
  if (action === 'saveMachine') return Object.assign(out, PMAINT.validateMachine(input, SaveError));
  if (action === 'makeWorkOrder') return Object.assign(out, PMAINT.validateSend(input, SaveError));
  if (action === 'savePmTask') return Object.assign(out, PMAINT.validatePmTask(input, SaveError));
  if (action === 'sendPmToMaintenance') return Object.assign(out, PMAINT.validateSendPm(input, SaveError));
  if (action === 'sendToGarage') return GARAGE.validateSend(input, out);
  if (action === 'deleteGarageJob') return GARAGE.validateDelete(input, out);
  if (['saveFleetRules', 'saveFleetUnit', 'saveGarageTech'].indexOf(action) >= 0) return GARAGE.validateFleet(action, input, out);
  if (action === 'setDriverPhone') {
    out.driverId = text(input.driverId);
    if (!out.driverId) throw new SaveError('BAD_REQUEST', 'driverId is required');
    const raw = text(input.phone, 40);
    out.phone = raw ? SMS.phoneE164(raw) : '';
    if (raw && !out.phone) throw new SaveError('BAD_REQUEST', 'Type the mobile phone number as 10 digits, like 330-555-1234.');
    return out;
  }
  if (DRIVER_ACTIONS.indexOf(action) >= 0) {
    out.driverId = text(input.driverId);
    if (!out.driverId) throw new SaveError('BAD_REQUEST', 'driverId is required');
    if (action === 'setDriverTruck') out.equipmentId = text(input.equipmentId);
    if (action === 'setDriverAvailable') { out.available = input.available === true; out.reason = text(input.reason, 200); }
    if (action === 'setDriverRelief') out.relief = input.relief === true;
    return out;
  }
  out.runDocId = text(input.runDocId);
  out.day = text(input.day, 10);
  if (!out.runDocId || L.DAYS.indexOf(out.day) < 0) throw new SaveError('BAD_REQUEST', 'runDocId and day are required');
  if (input.expectedRev !== undefined && input.expectedRev !== null) {
    if (!Number.isFinite(Number(input.expectedRev))) throw new SaveError('BAD_REQUEST', 'expectedRev must be a number');
    out.expectedRev = Number(input.expectedRev);
  }
  if (action === 'assignDriver') out.driverId = text(input.driverId);
  if (action === 'assignTruck' || action === 'assignTrailer') {
    out.equipmentId = text(input.equipmentId);
    // A unit typed on Daily that is not on Equipment Master (the current app took any number): kept as typed, a trailer number as
    // T-### and TBA as TBA (L.trailerNumber).
    const typed = text(input.unit, 20).toUpperCase().replace(/\s+/g, '');
    if (!out.equipmentId && typed) out.unit = action === 'assignTrailer' ? L.trailerNumber(typed) : typed;
  }
  // OVR on Daily: a driver who is off that day, or a unit that is down, may still be picked on purpose.
  if (['assignDriver', 'assignTruck', 'assignTrailer'].indexOf(action) >= 0 && input.override === true) out.override = true;
  if (action === 'setRuns') { out.runs = input.runs === true; if (!out.runs && typeof input.plantLoadOff === 'boolean') out.plantLoadOff = input.plantLoadOff; }
  if (action === 'setDispatchTime') {
    const t = text(input.time, 20);
    out.time = t ? L.minutesOfDay(t) : null;
    if (t && out.time === null) throw new SaveError('BAD_REQUEST', 'Depart time must look like 4:30 AM or 16:30');
  }
  if (action === 'setJack') out.jack = text(input.jack, 40).toUpperCase();
  if (action === 'setLoadType') {
    out.loadType = PLANT.areaOf(input.loadType);
    if (text(input.loadType) && !out.loadType) throw new SaveError('BAD_REQUEST', 'Load type must be Case, Totes, Boxes or Tanker');
  }
  if (action === 'moveRun') {
    if (!L.isDateKey(input.toDate)) throw new SaveError('BAD_REQUEST', 'Pick the day to move to');
    out.toDate = input.toDate;
  }
  if (action === 'setDriverNote') out.note = text(input.note, 500);
  if (action === 'savePlantLoad') out.plant = PLANT.validateLoad(input, SaveError);
  if (action === 'saveCheckIn') {
    out.checkIn = {
      casesDelivered: count(input.casesDelivered, 'Cases delivered'), driverCaseReturn: count(input.driverCaseReturn, 'Cases returned'),
      refusedReturned: text(input.refusedReturned, 200), refusedReturnedSource: text(input.refusedReturnedSource, 200),
      tractorIssues: text(input.tractorIssues, 300), trailerIssues: text(input.trailerIssues, 300), palletJackIssues: text(input.palletJackIssues, 300),
      trailerNeedsCleaned: input.trailerNeedsCleaned === true ? 'TRUE' : '', checkinNotes: text(input.checkinNotes, 500)
    };
    // Joe 10/19: the desktop pop-up shows and fixes the driver's over / short and what was loaded wrong, as the phone sends them.
    if (input.overageShortageDetails !== undefined) {
      out.checkIn.overageShortageDetails = text(input.overageShortageDetails, 300);
      out.checkIn.overageShortage = out.checkIn.overageShortageDetails ? 'TRUE' : '';
    }
    if (input.loadingProblem !== undefined) {
      out.checkIn.loadingProblem = text(input.loadingProblem, 300);
      out.checkIn.loadedCorrectly = out.checkIn.loadingProblem ? 'NO' : String(input.loadedCorrectly || '').toUpperCase() === 'YES' ? 'YES' : '';
    }
  }
  return out;
}

const MANAGER_ROLES = ['ADMINISTRATOR', 'ADMIN', 'MANAGER', 'SUPERVISOR'];
// The plant a save is for: the plant it names, else Uniontown (the only plant whose data has no plant on it yet).
const savePlant = (req) => { const id = String(req && (req.facilityId || req.plantId) || ''); return L.PLANTS.some(p => p.id === id) ? id : 'fac_uniontown'; };
async function requireSaver(tx, db, user, roles, action, plantId) {
  // A Plant Station signed in by its code alone (index.js checked its station): only the plant-floor saves.
  if (user && user.station) {
    if (STATIONS.STATION_ACTIONS.indexOf(action) < 0) throw new SaveError('NOT_ALLOWED', 'A Plant Station with no UD account cannot make this save. Sign in with a United Dairy account.');
    return { email: user.email, name: user.station.name, status: 'ACTIVE', roles: ['PLANT_EMPLOYEE'] };
  }
  const email = String(user && user.email || '').toLowerCase();
  const snap = await tx.get(db.collection(C.users).doc(M.safeIdPart(email)));
  const person = snap.exists ? snap.data() : null;
  if (!person || person.status !== 'ACTIVE') throw new SaveError('NOT_ALLOWED', email + ' is not an active user in the Users list');
  // Administration's Role Templates and the person's Allow / Deny (rights.js) change the role check only where set.
  const [tpl, ex] = await Promise.all([tx.get(db.collection('private').doc('roleTemplates')), tx.get(db.collection('personRights').doc(M.safeIdPart(email)))]);
  const roleOk = L.hasRole(person, roles);
  if (!RIGHTS.saveAllowed(person, action, roleOk, tpl.exists ? tpl.data().templates : null, ex.exists ? ex.data() : null)) {
    throw new SaveError('NOT_ALLOWED', roleOk ? email + ' is not allowed this save (Administration > People & Roles)' : email + ' does not have a role that can make this save (' + roles.join(', ') + ')');
  }
  // Joe 10/14: the screens ticked for this person in People & Roles (none ticked yet = every screen, as before).
  const plant = plantId || 'fac_uniontown';
  if (!RIGHTS.screenSaveAllowed(person, action, ex.exists ? ex.data() : null, plant)) {
    const name = (L.PLANTS.find(p => p.id === plant) || {}).name || plant;
    throw new SaveError('NOT_ALLOWED', email + ' does not have this screen ticked for ' + name + ' (Administration > People & Roles)');
  }
  return person;
}

// The driver's own truck on a day he is put on (current app 7.0.267, udpoV7267DriverOwnTruck_). after gets truckId / truck when it
// goes on; warnings says why it did not. Joe 10/19 (Kemp's 223882 on 845 with Peffer, Yoder's 123891 left on 901 with no driver):
// his own truck follows him off another load that day unless someone picked it there by hand. That load gets its own driver's truck
// when that is free, otherwise its truck is left blank so it shows as needing one. Returns the other loads' changes, written after
// every read (a transaction reads first).
async function ownTruckFor(tx, db, run, runDocId, p, day, after, warnings) {
  const d = await tx.get(db.collection(C.drivers).doc(M.safeIdPart(after.driverId)));
  const own = d.exists && d.data().defaultTruckId;
  if (!own || String(day.truckId || '').toUpperCase() === String(own).toUpperCase()) return [];
  const name = d.data().name || after.driver;
  const unit = await tx.get(db.collection(C.equipment).doc(M.safeIdPart(own)));
  if (!unit.exists) { warnings.push(name + "'s truck " + own + ' is not in Equipment Master; the route\'s truck was kept.'); return []; }
  const truck = unit.data();
  if (L.unitOff(truck)) { warnings.push(name + "'s truck " + truck.unit + ' is ' + L.unitOffWhy(truck) + '; the route\'s truck was kept.'); return []; }
  const moves = await takeOwnTruck(tx, db, run, runDocId, p, after.driverId, truck);
  if (!moves) return [];
  if (moves.held) { warnings.push(name + "'s truck " + truck.unit + ' was picked by hand for route ' + moves.held.route + ' ' + (moves.held.run || '') + ' that day; the route\'s truck was kept.'); return []; }
  after.truckId = truck.id; after.truck = truck.unit;
  return moves;
}

const sameUnit = (od, truck) => String(od.truckId || '').toUpperCase() === String(truck.id).toUpperCase() || (!!truck.unit && od.truck === truck.unit);

// Takes a driver's own truck off the other loads that day that hold it (his own other loads keep it). { held: run } when one of them
// had it picked by hand; otherwise the list of { snap, run, change } to write, each load getting its own driver's truck when free.
async function takeOwnTruck(tx, db, run, runDocId, p, driverId, truck) {
  const week = await tx.get(db.collection(C.runs).where('weekStart', '==', run.weekStart));
  const holders = week.docs.filter(s => {
    if (s.id === runDocId) return false;
    const od = (s.data().days || {})[p] || {};
    return od.runs && od.driverId !== driverId && sameUnit(od, truck);
  });
  const held = holders.find(s => L.yes(((s.data().days || {})[p] || {}).equipmentOverride));
  if (held) return { held: held.data() };
  const taken = new Set([String(truck.id).toUpperCase()]), moves = [];
  for (const s of holders) {
    const od = s.data().days[p], change = { truckId: '', truck: '' };
    if (od.driverId) {
      const ds = await tx.get(db.collection(C.drivers).doc(M.safeIdPart(od.driverId)));
      const theirs = ds.exists && ds.data().defaultTruckId;
      const us = theirs ? await tx.get(db.collection(C.equipment).doc(M.safeIdPart(theirs))) : null;
      const t = us && us.exists ? us.data() : null;
      const busy = t && (taken.has(String(t.id).toUpperCase()) || week.docs.some(o => {
        if (o.id === s.id || o.id === runDocId) return false;
        const x = (o.data().days || {})[p] || {};
        return x.runs && x.driverId !== od.driverId && sameUnit(x, t);
      }));
      if (t && !L.unitOff(t) && !busy) { change.truckId = t.id; change.truck = t.unit; taken.add(String(t.id).toUpperCase()); }
    }
    moves.push({ snap: s, run: s.data(), change });
  }
  return moves;
}

async function resolveAssignment(tx, db, req, stamp, run) {
  if (req.action === 'assignDriver') {
    // Picking anyone for a day a driver went off ends the "who it was for" note on it.
    const was = (run.days && run.days[req.day]) || {}, clearOff = {};
    ['intendedDriverId', 'intendedDriver', 'driverExceptionStatus'].forEach(k => { if (was[k]) clearOff[k] = ''; });
    if (!req.driverId) return Object.assign({ driverId: '', driver: '' }, clearOff);
    // Weekly's CARRIER and OPEN choices: a word in the driver column, no Driver Master entry.
    if (req.driverId === '__CARRIER__' || req.driverId === '__OPEN__') return Object.assign({ driverId: '', driver: req.driverId.slice(2, -2) }, clearOff);
    // Other CVG / Carriers (Operational Assignments): the name in the driver column, as the current app writes it.
    if (req.driverId.startsWith('__CVG__:')) {
      const name = req.driverId.slice(8).trim(), key = L.opsKey(name);
      const op = key ? await tx.get(db.collection('opsAssignments').doc(M.safeIdPart(key))) : null;
      const row = op && op.exists ? op.data() : L.OPS_DEFAULTS.map(n => ({ assignment: n, active: true })).find(x => L.opsKey(x.assignment) === key);
      if (!row || row.active === false) throw new SaveError('NOT_ALLOWED', (name || 'That name') + ' is not an active Operational Assignment');
      return Object.assign({ driverId: '', driver: row.assignment }, clearOff);
    }
    const snap = await tx.get(db.collection(C.drivers).doc(M.safeIdPart(req.driverId)));
    if (!snap.exists) throw new SaveError('NOT_FOUND', 'Driver ' + req.driverId + ' is not in Driver Master');
    const d = snap.data();
    if (!req.override) {
      if (!L.driverActive(d)) throw new SaveError('NOT_ALLOWED', d.name + ' is ' + d.status + ' in Driver Master (tick OVR to use them anyway)');
      const date = L.addDays(run.weekStart, L.DAYS.indexOf(req.day));
      const off = await tx.get(db.collection(C.exceptions).where('driverId', '==', d.id));
      const e = L.exceptionOn(off.docs.map(x => x.data()), d.id, date);
      if (e) throw new SaveError('NOT_ALLOWED', d.name + ' is off on ' + date + ' (' + L.exceptionLabel(e) + '); tick OVR to use them anyway');
    }
    return Object.assign({ driverId: d.id, driver: d.name }, clearOff);
  }
  if (req.action === 'assignTruck' || req.action === 'assignTrailer') {
    const type = req.action === 'assignTruck' ? 'TRUCK' : 'TRAILER';
    const idField = type === 'TRUCK' ? 'truckId' : 'trailerId', unitField = type === 'TRUCK' ? 'truck' : 'trailer';
    let snap = null;
    if (!req.equipmentId && req.unit) {
      // A typed unit that is on Equipment Master after all is used as that unit (same checks); otherwise it is kept as typed.
      const hit = await tx.get(db.collection(C.equipment).where('unit', '==', req.unit));
      snap = hit.docs.find(d => d.data().type === type) || null;
      if (!snap) return { [idField]: '', [unitField]: req.unit };
    }
    if (!req.equipmentId && !snap) return { [idField]: '', [unitField]: '' };
    snap = snap || await tx.get(db.collection(C.equipment).doc(M.safeIdPart(req.equipmentId)));
    if (!snap.exists) throw new SaveError('NOT_FOUND', req.equipmentId + ' is not in Equipment Master');
    const e = snap.data();
    if (e.type !== type) throw new SaveError('BAD_REQUEST', e.unit + ' is a ' + e.type + ', not a ' + type);
    if (!req.override && L.unitOff(e)) throw new SaveError('NOT_ALLOWED', e.unit + ' is ' + L.unitOffWhy(e) + ' in Equipment Master (tick OVR to use it anyway)');
    return { [idField]: e.id, [unitField]: e.unit };
  }
  // Joe 10/13 ("No route equals no driver"): a day turned off loses its driver, truck and trailer (that day only), so they are free.
  // Joe 10/13 (836 PECK): Weekly marks a plant load Not running (plantLoadOff) or back to needing a driver; a day turned on ends the mark.
  if (req.action === 'setRuns') {
    const was = (run.days && run.days[req.day]) || {};
    if (req.runs) return was.plantLoadOff ? { runs: true, plantLoadOff: false } : { runs: true };
    return Object.assign({ runs: false }, L.NOT_RUNNING_CLEARS, typeof req.plantLoadOff === 'boolean' ? { plantLoadOff: req.plantLoadOff } : {});
  }
  if (req.action === 'setDispatchTime') return { dispatchTime: req.time };
  if (req.action === 'setJack') return { palletJack: req.jack };
  // Blank goes back to the route's own type (Route Editor's Loadout Type).
  if (req.action === 'setLoadType') return { loadType: req.loadType, loadTypeByHand: !!req.loadType };
  if (req.action === 'saveCheckIn') return Object.assign({}, req.checkIn, { checkinCompletedAt: stamp });
  if (req.action === 'savePlantLoad') return PLANT.loadValues(tx, db, req, (run.days && run.days[req.day]) || {}, stamp, SaveError, run);
  return { driverNotes: req.note };
}

/*
 * Runs one save. user = the signed-in person ({email}). Returns {ok, requestId, runs:[{runDocId, rev}], repeated}.
 */
// Which of these saves this person may make (Administration > People & Roles counts, not only the role), without saving
// anything. Joe 10/12: a tablet account with "Update route loading: Allowed" still showed View only, because the screen
// checked the role alone. Only names in ACTIONS are answered.
async function checkSaves(db, user, actions, facilityId) {
  const out = {}, plantId = savePlant({ facilityId });
  for (const action of (Array.isArray(actions) ? actions : []).slice(0, 20)) {
    if (!ACTIONS[action]) continue;
    try { await db.runTransaction(tx => requireSaver(tx, db, user, ACTIONS[action].roles, action, plantId)); out[action] = true; } catch (e) { out[action] = false; }
  }
  return out;
}

async function applyAction(db, user, input, now, deps) {
  const req = validate(input);
  const spec = ACTIONS[req.action];
  const stamp = (now ? now() : new Date()).toISOString();
  const email = String(user && user.email || '').toLowerCase();
  // Joe 10/16: with the write-back on, Publish of the Next week first moves the Live sheet's weeks (liveroll.js), once the
  // person is known to be allowed to publish; the weeks here move in the transaction below.
  if (req.action === 'publishWeek' && deps && deps.liveRoll) {
    const live = await db.runTransaction(async (tx) => {
      if ((await tx.get(db.collection(C.actions).doc(req.requestId))).exists) return null;
      const mode = await requireTestMode(tx, db, spec.screen);
      await requireSaver(tx, db, user, spec.roles, req.action, savePlant(input));
      const weeks = ((await tx.get(db.collection(C.config).doc('app'))).data() || {}).liveWeeks || {};
      return mode.writeBack && weeks.next && weeks.next === req.weekStart ? weeks : null;
    });
    if (live) {
      try {
        const rolled = await LIVEROLL.rollLiveSheet(db, deps.liveRoll(), live, stamp, email);
        req.sheetRolled = true;
        req.sheetAlready = !!rolled.already;
      } catch (e) {
        if (e instanceof LIVEROLL.RollError) throw new SaveError(e.code, e.message);
        throw e;
      }
    }
  }
  const out = await db.runTransaction(async (tx) => {
    const logRef = db.collection(C.actions).doc(req.requestId);
    const logSnap = await tx.get(logRef);
    if (logSnap.exists) {
      const prior = logSnap.data();
      if (prior.by !== email || prior.action !== req.action) throw new SaveError('BAD_REQUEST', 'requestId was already used for a different save');
      return Object.assign({}, prior.result, { repeated: true });
    }
    const mode = await requireTestMode(tx, db, spec.screen);
    const person = await requireSaver(tx, db, user, spec.roles, req.action, savePlant(input));
    // Joe 10/13: managers may load past the loadout's limit from the Loadout Center; a Plant Station tablet never can.
    req.manager = !(user && user.station) && L.hasRole(person, MANAGER_ROLES);
    // Loading Rundown (Joe 10/15): who saved a load's Start / End, and whether from a Plant Station tablet (plant.js markTimes).
    if (req.action === 'savePlantLoad' || req.action === 'reorderPlantLoads') req.saver = { email, name: (person && person.name) || '', station: (user && user.station && user.station.name) || (req.plant && req.plant.station) || req.station || '' };

    if (req.action === 'reorderLoads') return reorder(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'reorderPlantLoads') {
      // The plant changes the order of today's loads and of coming days' (Joe 10/11: the handle is on every loadout); a day
      // already past stays as it was loaded (the operating day rolls at 6 AM).
      const today = L.operatingDay(now ? now() : new Date());
      if (req.loadDate < today) throw new SaveError('NOT_ALLOWED', 'The loading order can only be changed for today or a coming day');
      return reorder(tx, db, req, email, stamp, logRef, mode);
    }
    if (req.action === 'moveRun') return moveRun(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'setUnitDown' || req.action === 'setUnitUp') return setUnitDown(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'updateIssue') return updateIssue(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'sendToGarage') return GARAGE.sendToGarage(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'deleteGarageJob') return GARAGE.deleteGarageJob(tx, db, req, email, stamp, logRef, mode);
    if (['saveFleetRules', 'saveFleetUnit', 'saveGarageTech'].indexOf(req.action) >= 0) return GARAGE.saveFleet(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'clearConflict') return clearConflict(tx, db, req, email, stamp, logRef, mode);
    if (DRIVER_ACTIONS.indexOf(req.action) >= 0) return editDriver(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'setDriverPhone') return setDriverPhone(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'saveDriver') return saveDriver(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'removeDrivers') return removeDrivers(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'saveDriverException') return saveDriverException(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'saveVacation') return saveVacation(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'saveDriverTemplate') return saveDriverTemplate(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'setWeekReason') return setWeekReason(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'saveOtr') return saveOtr(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'saveScorecard') return saveScorecard(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'rateTruckClean') return rateTruckClean(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'addDriverIncident') return addDriverIncident(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'reviewDriverIncident') return reviewDriverIncident(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'excuseScorecardMiss') return excuseScorecardMiss(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'saveOpsAssignment') return saveOpsAssignment(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'publishWeek') return publishWeek(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'resetWeek') return resetWeek(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'saveRoute') return saveRoute(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'reorderRouteDay') return reorderRouteDay(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'reorderWeek') return reorderWeek(tx, db, req, email, stamp, logRef, mode);
    if (req.action === 'addPickup' || req.action === 'completePickup') return PLANT.savePickup(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'saveUnloading') return PLANT.saveUnload(tx, db, req, email, stamp, logRef, mode, SaveError, queueSheetCells);
    if (req.action === 'completeWash') return PLANT.saveWash(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'addReturn') return PLANT.saveReturn(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'savePlantSchedule') return PLANT.saveSchedule(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'saveYardCheck') return PLANT.saveYard(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'saveQualityCheck') return PLANT.saveQuality(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'saveShiftNote') return PLANT.saveShiftNote(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'saveTemperatureCheck') return PLANT.saveTemperature(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'sendPlantReport') return PLANT.sendReport(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'saveMachineProducts') return PLANT.saveMachineProducts(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'saveProductSetup') return PLANT.saveProductSetup(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'saveProductUpload') return PLANT.saveProductUpload(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'saveProductSheet') return PLANT.saveProductSheet(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'savePlantShifts') return PLANT.savePlantShifts(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'saveLineEntry') return PROD.saveLineEntry(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'saveLineCounter') return PROD.saveLineCounter(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'saveLineSetup') return PROD.saveLineSetup(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'saveSafetyWalk') return SAFE.saveWalk(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'saveSafetyIssue') return SAFE.saveIssue(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'saveExtinguisherCheck') return SAFE.saveExtCheck(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'saveExtinguisher') return SAFE.saveExtinguisher(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'saveFireSystemCheck') return SAFE.saveFireCheck(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'saveFireSystem') return SAFE.saveFireSystem(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'saveSafetyChecklist') return SAFE.saveChecklist(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'saveLocationAreas') return SAFE.saveLocations(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'saveMachine') return PMAINT.saveMachine(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'makeWorkOrder') return PMAINT.makeWorkOrder(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'savePmTask') return PMAINT.savePmTask(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'sendPmToMaintenance') return PMAINT.sendPmToMaintenance(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'saveReceivingScan') return RECV.saveReceiving(tx, db, req, email, stamp, logRef, mode, SaveError);
    if (req.action === 'saveReceivingItem') return RECV.saveReceivingItem(tx, db, req, email, stamp, logRef, mode, SaveError);

    const runRef = db.collection(C.runs).doc(req.runDocId);
    const runSnap = await tx.get(runRef);
    if (!runSnap.exists) throw new SaveError('NOT_FOUND', 'That run is no longer on the Live sheet');
    const run = runSnap.data();
    const day = run.days && run.days[req.day];
    // RUNS / Add Route / Run may turn a day back on; every other save needs a day that runs.
    if (!day || (!day.runs && req.action !== 'setRuns')) throw new SaveError('NOT_FOUND', run.route + ' ' + run.run + ' does not run on ' + L.DAY_NAMES[L.DAYS.indexOf(req.day)]);
    if (req.expectedRev !== undefined && req.expectedRev !== run.rev) {
      throw new SaveError('CHANGED', run.route + ' ' + run.run + ' was changed by someone else; the screen now shows the latest', { rev: run.rev });
    }
    const after = await resolveAssignment(tx, db, req, stamp, run);
    // Joe 10/21: a load taken off on Daily or Weekly takes the plant's own Add Load copy of it off too (read now, written below).
    const plantGone = req.action === 'setRuns' && day.runs && after.runs === false ? await PLANT.scheduledForRun(tx, db, run.runId, day.deliveryDate || L.addDays(run.weekStart, L.DAYS.indexOf(req.day))) : [];
    // Joe 10/12 (Joel Jacobs on 901_1 with no truck): a driver put on a day, from Daily or Weekly, takes his own truck (Driver Master's
    // assigned truck) unless it is not usable or another driver has it that day; his own other loads that day keep it too.
    const warnings = [];
    let moves = [];
    if (req.action === 'assignDriver' && day.runs) {
      // Joe 10/19 (Yoder taken off 901, his 123891 left there): a driver taken off a load takes his own truck off it too, unless it
      // was picked there by hand; the new driver's own truck goes on in its place when he has one.
      if (after.driverId) moves = await ownTruckFor(tx, db, run, req.runDocId, req.day, day, after, warnings);
      if (after.truckId === undefined && day.driverId && day.driverId !== after.driverId && day.truckId && !L.yes(day.equipmentOverride)) {
        const ownOf = async (id) => { const s = id ? await tx.get(db.collection(C.drivers).doc(M.safeIdPart(id))) : null; return s && s.exists ? String(s.data().defaultTruckId || '').toUpperCase() : ''; };
        const truck = String(day.truckId).toUpperCase();
        if (await ownOf(day.driverId) === truck && await ownOf(after.driverId) !== truck) { after.truckId = ''; after.truck = ''; }
      }
    }
    // Joe 10/19 (891 typed on 800 said "ON 901"): the driver's own truck picked by hand comes off the other loads holding it that day.
    if (req.action === 'assignTruck' && day.runs && day.driverId && after.truckId) {
      const ds = await tx.get(db.collection(C.drivers).doc(M.safeIdPart(day.driverId)));
      if (ds.exists && String(ds.data().defaultTruckId || '').toUpperCase() === String(after.truckId).toUpperCase()) {
        const m = await takeOwnTruck(tx, db, run, req.runDocId, req.day, day.driverId, { id: after.truckId, unit: after.truck });
        if (m && !m.held) moves = m;
      }
    }
    // A check-in's problems also go to the maintenance queues (read now; written below with the check-in).
    const writeMaint = req.action === 'saveCheckIn'
      ? await MAINT.prepareMaintenance(tx, db, run, req.runDocId, req.day, L.addDays(run.weekStart, L.DAYS.indexOf(req.day)), Object.assign({}, day, after), { by: email, driver: day.driver || '' }, stamp) : null;
    const before = {};
    Object.keys(after).forEach(k => { before[k] = day[k] === undefined ? null : day[k]; });
    const update = { rev: run.rev + 1, testEdited: true, editedAt: stamp };
    Object.keys(after).forEach(k => { update['days.' + req.day + '.' + k] = after[k]; });
    // Any driver change marks the day as changed by hand (<day>_route_override), as the current app's driver saves do;
    // the Driver Assignment Board shows those days light blue.
    // A truck or trailer picked by hand marks <day>_equipment_override, as the current app's Live save does (034_V740 line 115), and a
    // depart time typed by hand marks <day>_dispatch_time_override: Route Master and Driver Master saves then leave that day's pick alone (D6).
    // A truck or trailer typed at the dock (savePlantLoad) marks it too, as the current app's plant save does (034_V740 line 115).
    const plantUnit = req.action === 'savePlantLoad' && (after.truck !== undefined || after.trailer !== undefined);
    const marks = req.action === 'assignDriver' || req.action === 'setRuns' ? { routeOverride: 'TRUE' }
      : req.action === 'assignTruck' || req.action === 'assignTrailer' || plantUnit ? { equipmentOverride: 'TRUE' } : req.action === 'setDispatchTime' ? { dispatchTimeOverride: 'TRUE' } : {};
    Object.keys(marks).forEach(k => { update['days.' + req.day + '.' + k] = marks[k]; });
    update['days.' + req.day + '.updatedAt'] = stamp;
    update['days.' + req.day + '.updatedBy'] = email;
    tx.update(runRef, update);
    if (mode.writeBack) queueSheetCells(tx, db, req.requestId, '', run, req.runDocId, req.day, Object.assign({}, after, marks), stamp, email);
    moves.forEach((m, i) => {
      const u = { rev: (m.run.rev || 0) + 1, testEdited: true, editedAt: stamp };
      Object.keys(m.change).forEach(k => { u['days.' + req.day + '.' + k] = m.change[k]; });
      u['days.' + req.day + '.updatedAt'] = stamp;
      u['days.' + req.day + '.updatedBy'] = email;
      tx.update(m.snap.ref, u);
      if (mode.writeBack) queueSheetCells(tx, db, req.requestId, 'own' + i, m.run, m.snap.id, req.day, m.change, stamp, email);
    });
    if (mode.writeBack && req.action === 'savePlantLoad') queueLoadoutHistory(tx, db, req, run, Object.assign({}, day, after), after, stamp, email);
    const result = { ok: true, requestId: req.requestId, runs: [{ runDocId: req.runDocId, rev: run.rev + 1 }].concat(moves.map(m => ({ runDocId: m.snap.id, rev: (m.run.rev || 0) + 1 }))) };
    if (plantGone.length) result.plantRemoved = PLANT.followRun(tx, db, plantGone, '', email, stamp);
    if (warnings.length) result.warnings = warnings;
    if (writeMaint) result.maintenance = writeMaint(maintQueue(tx, db, mode, req.requestId, stamp, email));
    tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, runDocId: req.runDocId, day: req.day, before, after, result });
    return result;
  });
  if (req.action === 'saveRoute' && !out.repeated) await routeLiveFollow(db, req, email, stamp, out);
  return out;
}

// Each new maintenance record also goes to its tab of the sandbox Live workbook when the write-back is on.
function maintQueue(tx, db, mode, requestId, stamp, email) {
  return (ref, r) => queueMaster(tx, db, mode, requestId, 'm' + r.kind, ref, r.record_id, r, true, stamp, email, MAINT.LISTS[r.kind]);
}

// Someone checked a sheet conflict (and fixed the sheet or the app by hand): it leaves the open list, kept for the record.
async function clearConflict(tx, db, req, email, stamp, logRef, mode) {
  const ref = db.collection(C.conflicts).doc(req.conflictId);
  const snap = await tx.get(ref);
  if (!snap.exists) throw new SaveError('NOT_FOUND', 'That conflict is no longer on the list');
  const result = { ok: true, requestId: req.requestId, runs: [] };
  if (snap.data().open === false) return result;
  tx.update(ref, { open: false, clearedAt: stamp, clearedBy: email });
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, conflictId: req.conflictId, before: { open: true }, after: { open: false }, result });
  return result;
}

module.exports = { applyAction, checkSaves, validate, requireTestMode, queueSheetCells, maintQueue, SaveError, ACTIONS, SAVE_ROLES, REORDER_ROLES, DRIVER_ROLES };
