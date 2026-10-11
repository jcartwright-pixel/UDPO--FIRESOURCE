/*
 * Roles and rights, as the current app's Administration has them (91_V50_RolePermissions.gs): every right with its label and
 * group, each role's default rights, Role Templates that replace a role's defaults, and each person's Allow / Deny exceptions.
 *
 * A person's rights = the union of their roles' templates (or defaults), plus Allow, minus Deny. An Administrator has every
 * right and takes no exceptions. Administration itself (admin.*, audit.full) is never given by a template or an exception.
 *
 * Saves (actions.js) keep their role check; the rights only change the answer where an administrator changed something:
 * a person's Allow or Deny for that save's right, or a saved Role Template for one of their roles.
 */
'use strict';

const CATALOG = Object.freeze([
  ['dashboard.read', 'Open company Home', 'Home'],
  ['self.checkin.write', 'Submit own driver check-in', 'Employee / Mobile'],
  ['self.assignment.read', 'View assigned work', 'Employee / Mobile'],
  ['self.schedule.read', 'View own schedule', 'Employee / Mobile'],
  ['self.vehicle.read', 'View assigned truck / trailer', 'Employee / Mobile'],
  ['self.issue.create', 'Report equipment issue', 'Employee / Mobile'],
  ['self.calloff.create', 'Report call-off / availability', 'Employee / Mobile'],
  ['self.vacation.read', 'View own vacation', 'Employee / Mobile'],
  ['checkin.any.driver', 'Shared check-in: choose a driver by name', 'Employee / Mobile'],
  ['dispatch.own.read', 'View own dispatch assignment', 'Dispatch'],
  ['dispatch.read', 'View Daily Dispatch', 'Dispatch'],
  ['dispatch.write', 'Edit Daily Dispatch', 'Dispatch'],
  ['dispatch.override', 'Override driver / truck availability', 'Dispatch'],
  ['dispatch.publish', 'Publish weekly dispatch', 'Dispatch'],
  ['drivers.read', 'View driver roster', 'Drivers'],
  ['drivers.write', 'Edit drivers', 'Drivers'],
  ['drivers.status.write', 'Driver call-off / status', 'Drivers'],
  ['vacations.read', 'View vacation schedule', 'Drivers'],
  ['vacations.write', 'Edit vacation records', 'Drivers'],
  ['vacations.approve', 'Approve vacations', 'Drivers'],
  ['issues.read', 'View maintenance issues', 'Maintenance / Mechanic'],
  ['issues.write', 'Edit maintenance issues', 'Maintenance / Mechanic'],
  ['issues.vehicle.read', 'View assigned vehicle issues', 'Maintenance / Mechanic'],
  ['issues.truck.read', 'View truck issues', 'Maintenance / Mechanic'],
  ['issues.truck.write', 'Update truck issues', 'Maintenance / Mechanic'],
  ['issues.trailer.read', 'View trailer issues', 'Maintenance / Mechanic'],
  ['issues.trailer.write', 'Update trailer issues', 'Maintenance / Mechanic'],
  ['issues.pallet.read', 'View forklift / pallet jack issues', 'Maintenance / Mechanic'],
  ['issues.pallet.write', 'Update forklift / pallet jack issues', 'Maintenance / Mechanic'],
  ['issues.close', 'Close / complete repairs', 'Maintenance / Mechanic'],
  ['plant.read', 'Open Plant Operations', 'Plant Operations'],
  ['plant.write', 'Edit general plant operations', 'Plant Operations'],
  ['plant.loading.read', 'View route loading', 'Plant Operations'],
  ['plant.loading.write', 'Update route loading', 'Plant Operations'],
  ['plant.unloading.read', 'View route unloading', 'Plant Operations'],
  ['plant.unloading.write', 'Update route unloading', 'Plant Operations'],
  ['plant.washing.read', 'View truck washing assignments', 'Plant Operations'],
  ['plant.washing.complete', 'Complete truck washing', 'Plant Operations'],
  ['plant.report.read', 'Preview daily plant reports', 'Plant Operations'],
  ['plant.report.send', 'Email daily plant reports', 'Plant Operations'],
  ['plant.settings.write', 'Manage plant report groups and settings', 'Plant Operations'],
  ['routes.read', 'View route setup', 'Routes / Equipment'],
  ['routes.write', 'Edit routes / runs', 'Routes / Equipment'],
  ['fleet.read', 'View equipment', 'Routes / Equipment'],
  ['fleet.write', 'Edit equipment setup', 'Routes / Equipment'],
  ['fleet.status.write', 'Update equipment status', 'Routes / Equipment'],
  ['operations.read', 'View operations schedule', 'Operations'],
  ['operations.write', 'Edit operations schedule', 'Operations'],
  ['customerPickup.read', 'View customer pickups', 'Operations'],
  ['customerPickup.write', 'Edit customer pickups', 'Operations'],
  ['otr.read', 'View over-the-road runs report', 'Operations'],
  ['otr.write', 'Edit over-the-road routes and monthly figures', 'Operations'],
  ['gps.read', 'View Trucks Today (GPS)', 'Operations'],
  ['gps.write', 'Set up Trucks Today rules, truck names and report imports', 'Operations'],
  ['admin.users', 'Manage users / rights', 'Administration'],
  ['admin.uploads', 'Upload / import data', 'Administration'],
  ['admin.locations', 'Add / edit locations', 'Administration'],
  ['admin.system', 'Edit system setup', 'Administration'],
  ['audit.read', 'View audit / diagnostics', 'Administration'],
  ['audit.full', 'Full audit administration', 'Administration']
].map(([code, label, group]) => Object.freeze({ code, label, group })));

// Administrator only: never given by a template or a person's exception.
const RESTRICTED = (code) => code === '*' || /^admin\./.test(code) || code === 'audit.full';
const ASSIGNABLE = CATALOG.filter(r => !RESTRICTED(r.code)).map(r => r.code);

const ROLES = Object.freeze(['VIEWER', 'EMPLOYEE', 'DRIVER', 'DRIVER_CHECKIN', 'PLANT_EMPLOYEE', 'MECHANIC', 'DISPATCHER', 'SUPERVISOR', 'MANAGER', 'ADMINISTRATOR']);
const ALIAS = { ADMIN: 'ADMINISTRATOR', MAINTENANCE: 'MECHANIC' };
const normRole = (r) => { const k = String(r || '').trim().toUpperCase().replace(/[\s-]+/g, '_'); return ALIAS[k] || k; };

const EMPLOYEE = ['dashboard.read', 'self.assignment.read', 'self.schedule.read', 'self.issue.create', 'self.calloff.create', 'self.vacation.read'];
const BOSS = ['dashboard.read', 'self.assignment.read', 'self.schedule.read', 'dispatch.read', 'dispatch.write', 'dispatch.override', 'dispatch.publish', 'drivers.read',
  'drivers.write', 'drivers.status.write', 'vacations.read', 'vacations.write', 'vacations.approve', 'fleet.read', 'fleet.write', 'fleet.status.write', 'issues.read',
  'issues.write', 'issues.close', 'plant.read', 'plant.write', 'plant.loading.read', 'plant.loading.write', 'plant.unloading.read', 'plant.unloading.write',
  'plant.washing.read', 'plant.washing.complete', 'plant.report.read', 'plant.report.send', 'plant.settings.write', 'operations.read', 'operations.write', 'routes.read',
  'routes.write', 'customerPickup.read', 'customerPickup.write', 'audit.read', 'otr.read', 'otr.write', 'gps.read', 'gps.write'];
const DEFAULTS = Object.freeze({
  VIEWER: ['dashboard.read', 'dispatch.read', 'drivers.read', 'fleet.read', 'routes.read', 'vacations.read', 'issues.read', 'plant.read', 'operations.read', 'customerPickup.read'],
  EMPLOYEE,
  DRIVER: EMPLOYEE.concat(['self.vehicle.read', 'self.checkin.write', 'dispatch.own.read', 'fleet.read', 'issues.vehicle.read']),
  DRIVER_CHECKIN: ['dashboard.read', 'self.checkin.write', 'dispatch.own.read', 'checkin.any.driver', 'fleet.read', 'issues.vehicle.read'],
  PLANT_EMPLOYEE: EMPLOYEE.concat(['plant.read', 'plant.write', 'plant.loading.read', 'plant.loading.write', 'plant.unloading.read', 'plant.unloading.write', 'plant.washing.read',
    'plant.washing.complete', 'fleet.read', 'issues.pallet.read', 'customerPickup.read', 'plant.report.read']),
  MECHANIC: ['dashboard.read', 'self.assignment.read', 'self.schedule.read', 'self.issue.create', 'self.vehicle.read', 'fleet.read', 'fleet.write', 'fleet.status.write',
    'issues.read', 'issues.write', 'issues.close', 'issues.truck.read', 'issues.truck.write', 'issues.trailer.read', 'issues.trailer.write', 'issues.pallet.read', 'issues.pallet.write'],
  DISPATCHER: ['dashboard.read', 'self.assignment.read', 'self.schedule.read', 'dispatch.read', 'dispatch.write', 'drivers.read', 'drivers.status.write', 'fleet.read',
    'fleet.status.write', 'routes.read', 'vacations.read', 'issues.read', 'operations.read', 'operations.write', 'customerPickup.read', 'customerPickup.write', 'plant.read',
    'otr.read', 'gps.read'],
  SUPERVISOR: BOSS,
  MANAGER: BOSS
});

// The right each save needs (actions.js action name -> right).
const ACTION_RIGHT = Object.freeze({
  assignDriver: 'dispatch.write', assignTruck: 'dispatch.write', assignTrailer: 'dispatch.write', setDriverNote: 'dispatch.write', setRuns: 'dispatch.write',
  setDispatchTime: 'dispatch.write', setJack: 'dispatch.write', moveRun: 'dispatch.write', setUnitDown: 'fleet.status.write', setUnitUp: 'fleet.status.write',
  reorderLoads: 'dispatch.override', clearConflict: 'dispatch.write', saveCheckIn: 'dispatch.write', setDriverTruck: 'drivers.write', setDriverAvailable: 'drivers.status.write',
  setDriverRelief: 'drivers.write', saveDriver: 'drivers.write', removeDrivers: 'drivers.write', saveDriverException: 'drivers.status.write', saveVacation: 'vacations.write',
  publishWeek: 'dispatch.publish', resetWeek: 'dispatch.publish', saveRoute: 'routes.write', reorderRouteDay: 'routes.write', updateIssue: 'issues.write',
  setWeekReason: 'dispatch.write', saveDriverTemplate: 'drivers.write', saveOtr: 'otr.write', saveScorecard: 'drivers.write', saveOpsAssignment: 'drivers.write',
  savePlantLoad: 'plant.loading.write', addPickup: 'customerPickup.write', completePickup: 'customerPickup.write', saveUnloading: 'plant.unloading.write',
  completeWash: 'plant.washing.complete', savePlantSchedule: 'operations.write', saveYardCheck: 'plant.write', saveQualityCheck: 'plant.write', saveShiftNote: 'plant.write',
  saveTemperatureCheck: 'plant.write', sendPlantReport: 'plant.report.send', saveMachineProducts: 'plant.settings.write', savePlantShifts: 'plant.settings.write', sendToGarage: 'issues.write'
});

// templates: { ROLE: [codes] } saved in Role Templates (a role not there keeps its defaults).
function templateFor(role, templates) {
  const r = normRole(role);
  const saved = templates && Array.isArray(templates[r]) ? templates[r] : null;
  return (saved || DEFAULTS[r] || []).filter(c => ASSIGNABLE.indexOf(c) >= 0 || c === 'audit.read');
}

const isAdminPerson = (person) => (person && person.roles || []).some(r => normRole(r) === 'ADMINISTRATOR');

// Every right a person has: ['*'] for an Administrator, [] for anyone not active.
function effectiveRights(person, templates, exceptions) {
  if (!person || person.status !== 'ACTIVE') return [];
  if (isAdminPerson(person)) return ['*'];
  const set = new Set();
  (person.roles || []).forEach(r => templateFor(r, templates).forEach(c => set.add(c)));
  const ex = exceptions || {};
  (ex.grants || []).forEach(c => { if (!RESTRICTED(c)) set.add(c); });
  (ex.denials || []).forEach(c => set.delete(c));
  return CATALOG.map(r => r.code).filter(c => set.has(c));
}

/*
 * Whether a save goes ahead. roleOk = the save's own role check. Only a change an administrator made decides otherwise:
 * the person's Allow or Deny for this right, then a saved Role Template for one of their roles.
 */
function saveAllowed(person, action, roleOk, templates, exceptions) {
  const right = ACTION_RIGHT[action];
  if (!right || !person || person.status !== 'ACTIVE') return roleOk;
  if (isAdminPerson(person)) return true;
  const ex = exceptions || {};
  if ((ex.denials || []).indexOf(right) >= 0) return false;
  if ((ex.grants || []).indexOf(right) >= 0) return true;
  // A template decides only where it differs from that role's defaults: a right added lets the save through, a right
  // taken away (from every role the person has) stops it.
  const roles = (person.roles || []).map(normRole);
  if (roles.some(r => templateFor(r, templates).indexOf(right) >= 0 && (DEFAULTS[r] || []).indexOf(right) < 0)) return true;
  const changed = roles.filter(r => templates && Array.isArray(templates[r]));
  if (changed.length && roles.every(r => templateFor(r, templates).indexOf(right) < 0) && changed.some(r => (DEFAULTS[r] || []).indexOf(right) >= 0)) return false;
  return roleOk;
}

module.exports = { CATALOG, RESTRICTED, ASSIGNABLE, ROLES, DEFAULTS, ACTION_RIGHT, normRole, templateFor, effectiveRights, saveAllowed, isAdminPerson };
