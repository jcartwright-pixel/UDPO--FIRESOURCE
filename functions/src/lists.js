/*
 * The index of every list the app keeps in the Firebase database (Joe 10/30: "does all of our reads and writes go through a
 * router? That way, everything goes to the same place at all times"). One file, shared by the server and the screens (copied
 * unchanged to public/js/lists.js by tools/sync-logic.cjs; a unit test checks the two match).
 *
 *   - Screens: js/firebase.js is the one door to the database, and it refuses a read of any list not named here.
 *   - Server: src/list-guard.js checks every read and save the same way (the tests stop on a stray name; the live server
 *     notes it in the log and carries on, so a missed name never stops work).
 *   - functions/test/unit/lists.test.js fails if any screen or server file spells a list that is not here, or if a screen
 *     reads a list the database rules do not allow.
 *
 * A new list: add its name here (in order) and run npm run sync-logic. employees (Joe 10/30): the Employees list the
 * server fills from UDMS in each plant's own database.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UDLists = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const NAMES = Object.freeze([
    'actions', 'caseCounters', 'caseCounts', 'config', 'conflicts', 'crewAreas', 'crewJobs',
    'crewPeople', 'crewRules', 'crewVacations', 'crewWeeks', 'dataLoads', 'dateBackups', 'driverBackups',
    'driverIncidents', 'driverPhones', 'drivers', 'dvirs', 'employees', 'equipment', 'exceptions',
    'extinguishers', 'fireSystems', 'fleetSetup', 'garageClocks', 'garageLocks', 'garageLogins', 'garageSessions',
    'garageSignatures', 'garageTechs', 'gpsAlerts', 'gpsDays', 'gpsReefer', 'gpsReeferReadings', 'gpsTemps', 'gpsTripFuel',
    'gpsTrucks', 'inventoryMoves', 'jugTrailerLists', 'jugTrailers', 'locationAreas', 'mailCopies', 'mailSeen', 'maintenance', 'masterOutbox',
    'menuSetup', 'meta', 'odometers', 'opsAssignments', 'otrColumns', 'otrComments', 'otrDaily',
    'otrMonthRuns', 'otrMonthly', 'otrRoutes', 'otrSeed', 'outbox', 'personAccess', 'personRights',
    'pickups', 'plantAccess', 'plantEvents', 'plantJournal', 'plantLineStatus', 'plantLoads', 'plantMachines',
    'plantMaintClocks', 'plantMaintCounters', 'plantMaintLocks', 'plantMaintLogins', 'plantPmTasks', 'plantProducts', 'plantReports',
    'plantReturns', 'plantSetup', 'plantShifts', 'plantUploadLog', 'plantUploads', 'plantWash', 'plantWorkOrders',
    'private', 'productSetup', 'productSheet', 'productionLines', 'productionRuns', 'receivingItems', 'receivingScans',
    'redzoneChecks', 'redzoneData', 'redzoneRuns', 'repairItems', 'reportGroups', 'routes', 'runDays',
    'runs', 'safetyIssues', 'safetyPhotos', 'safetySetup', 'safetyWalks', 'scorecard', 'scorecardExcuses',
    'scorecardRatings', 'sensors', 'sentEmails', 'stationAccess', 'tempLocations', 'textLog', 'transfers',
    'udclCustomers', 'udclLog', 'udclRouteDays', 'users', 'vacations', 'walkPhotoData', 'walkPhotos', 'weeks', 'windowTests', 'workOrders',
    'workOrdersDeleted'
  ]);
  const KNOWN = new Set(NAMES);
  const known = (name) => KNOWN.has(String(name));
  // The list names in a path: its 1st, 3rd, 5th ... parts from the database or a record, its 2nd, 4th ... from a list.
  const listsIn = (path, fromList) => String(path || '').split('/').filter(Boolean).filter((p, i) => i % 2 === (fromList ? 1 : 0));
  const unlisted = (path, fromList) => listsIn(path, fromList).filter(n => !known(n));
  return { NAMES, known, listsIn, unlisted };
});
