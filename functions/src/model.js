/*
 * United Dairy Distribution app: the data model.
 *
 * Firestore collections (all written only by the server; screens read them):
 *   config/app                 mode ("test" until cutover), which app owns each screen, the three Live weeks, last transfer
 *   weeks/{weekStart}          one per Live week: tab it came from, row fingerprints used to skip unchanged rows
 *   runs/{weekStart}__{key}    one per Live week row (a route run): route facts plus seven day blocks
 *   drivers/{driver_id}        Driver Master
 *   equipment/{equipment_id}   Equipment Master (trucks, trailers, fork trucks)
 *   routes/{run_id}            Route Master
 *   users/{email}              USERS_MASTER: who may save what
 *   actions/{requestId}        every save made in the new app, with who, when, before and after
 *   transfers/{id}             every transfer run, with counts and anything it could not read cleanly
 *   outbox/{requestId}         sheet cells each save changed, waiting to be written back to the Live sheet
 *   conflicts/{id}             a cell the write-back did not write because someone changed it in the sheet
 *
 * A run's ID is its week plus the sheet's run_id, never a row number, so sorting or inserting rows in the
 * Live tab does not move data to the wrong run.
 */
'use strict';

const L = require('./logic');

const COLLECTIONS = Object.freeze({
  config: 'config', weeks: 'weeks', runs: 'runs', drivers: 'drivers', equipment: 'equipment',
  routes: 'routes', users: 'users', actions: 'actions', transfers: 'transfers',
  outbox: 'outbox', conflicts: 'conflicts', exceptions: 'exceptions', vacations: 'vacations',
  plantLoads: 'plantLoads', masterOutbox: 'masterOutbox'
});

const LIVE_TABS = Object.freeze({ previous: 'LIVE PREVIOUS WEEK', current: 'LIVE CURRENT WEEK', next: 'LIVE NEXT WEEK' });
const LIVE_HEADER_ROW = 6;          // row 6 holds the column names, data starts on row 7 (as in the current app)
const MASTER_HEADER_ROW = 1;

// Route facts on each Live row. [new field, sheet column, kind]
const RUN_FIELDS = Object.freeze([
  ['facilityId', 'facility_id', 'text'], ['streamId', 'stream_id', 'text'],
  ['routeId', 'route_id', 'text'], ['route', 'route', 'text'], ['routeName', 'route_name', 'text'],
  ['runId', 'run_id', 'text'], ['run', 'run', 'text'], ['routeRunType', 'route_run_type', 'text'],
  ['loadType', 'load_type', 'text'], ['movementType', 'movement_type', 'text'],
  ['coverageType', 'coverage_type', 'text'], ['coverageOwner', 'coverage_owner', 'text'],
  ['dedicatedType', 'dedicated_type', 'text'], ['routeStatus', 'route_status', 'text'],
  ['active', 'active', 'flag'], ['displayDaily', 'display_daily_dispatch', 'flag'],
  ['displayWeekly', 'display_weekly_dispatch', 'flag'], ['displayPlant', 'display_plant_distribution', 'flag'],
  ['displayMobileRoute', 'display_mobile_route', 'flag']
]);

// One day block (sun_..., mon_..., ...). [new field, column suffix, kind]. Columns not listed here are still
// kept, word for word, in the run's `cells` map, so nothing in the sheet is lost.
const DAY_FIELDS = Object.freeze([
  ['runs', 'runs', 'yes'], ['loadSequence', 'load_sequence', 'number'],
  ['loadSequenceOverride', 'load_sequence_override', 'number'],
  ['dispatchId', 'dispatch_id', 'text'], ['dispatchDate', 'dispatch_date', 'date'],
  ['deliveryDate', 'delivery_date', 'date'], ['loadDate', 'load_date', 'date'],
  ['loadDayOffset', 'load_day_offset', 'number'], ['departureDate', 'departure_date', 'date'],
  ['startTime', 'start_time', 'time'], ['routeHours', 'route_hours', 'number'],
  ['dispatchTime', 'dispatch_time', 'time'],
  ['driverId', 'driver_id', 'text'], ['driver', 'driver', 'text'],
  ['truckId', 'tractor_id', 'text'], ['truck', 'truck', 'text'],
  ['trailerId', 'trailer_id', 'text'], ['trailer', 'trailer', 'text'],
  ['forkliftId', 'forklift_id', 'text'], ['palletJack', 'pallet_jack', 'text'],
  ['miles', 'miles', 'number'], ['driverNotes', 'driver_notes', 'text'],
  ['casesOut', 'cases_out', 'number'], ['plantCaseReturn', 'plant_case_return', 'number'],
  ['casesDelivered', 'cases_delivered', 'number'], ['driverCaseReturn', 'driver_case_return', 'number'],
  ['completeTime', 'complete_time', 'text'], ['pickup', 'pickup', 'text'],
  ['status', 'status', 'text'], ['loadStatus', 'load_status', 'text'], ['deliveryStatus', 'delivery_status', 'text'],
  ['loadedComplete', 'loaded_complete', 'yes'], ['loadTemperature', 'load_temperature', 'number'],
  ['routeOverride', 'route_override', 'text'], ['exceptionReason', 'exception_reason', 'text'],
  ['overageShortage', 'overage_shortage', 'text'], ['overageShortageDetails', 'overage_shortage_details', 'text'],
  ['refusedReturned', 'refused_returned', 'text'], ['refusedReturnedSource', 'refused_returned_source', 'text'],
  ['palletJackUnit', 'pallet_jack_unit', 'text'], ['palletJackIssues', 'pallet_jack_issues', 'text'],
  ['tractorIssues', 'tractor_issues', 'text'], ['trailerIssues', 'trailer_issues', 'text'],
  ['trailerNeedsCleaned', 'trailer_needs_cleaned', 'text'], ['checkinNotes', 'checkin_notes', 'text'],
  ['checkinCompletedAt', 'checkin_completed_at', 'text'],
  ['plantNotes', 'extension_03', 'text'], ['plantShift', 'extension_04', 'text'], ['plantStartedAt', 'extension_05', 'text'],
  ['updatedAt', 'updated_at', 'text'], ['updatedBy', 'updated_by', 'text']
]);

function normalizeHeader(value) {
  return String(value === null || value === undefined ? '' : value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function convert(kind, raw) {
  const text = raw === null || raw === undefined ? '' : String(raw).trim();
  switch (kind) {
    case 'yes': return L.yes(raw);
    case 'flag': return L.optionalYes(raw);
    case 'number': return L.number(raw);
    case 'date': return L.dateKey(raw) || null;
    case 'time': return L.minutesOfDay(raw);
    default: return text;
  }
}

// Firestore IDs cannot contain "/" and should stay short and readable.
function safeIdPart(value) {
  return String(value || '').trim().replace(/[\/\s]+/g, '_').replace(/[^A-Za-z0-9_.@\-|]/g, '').slice(0, 200);
}

function runDocId(weekStart, rowKey) { return weekStart + '__' + safeIdPart(rowKey); }

module.exports = {
  COLLECTIONS, LIVE_TABS, LIVE_HEADER_ROW, MASTER_HEADER_ROW, RUN_FIELDS, DAY_FIELDS,
  normalizeHeader, convert, safeIdPart, runDocId
};
