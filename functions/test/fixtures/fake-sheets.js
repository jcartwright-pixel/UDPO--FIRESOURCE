/*
 * Made-up sheets for the tests: the real column layout of the Live week tabs and master lists (read from the
 * Uniontown sheets 2026-10-09), with invented drivers, units and routes. It includes the untidy things found in
 * the real sheets: dates written two ways, a driver's name in the driver ID column, a stale Week Start label,
 * one run on two rows.
 */
'use strict';

const BASE = ['week_start_date', 'week_signature', 'facility_id', 'stream_id', 'route_id', 'route', 'route_name', 'run_id', 'run',
  'route_run_type', 'load_type', 'movement_type', 'coverage_type', 'dedicated_type', 'route_status', 'active', 'display_route_master',
  'display_daily_dispatch', 'display_weekly_dispatch', 'display_plant_distribution', 'display_mobile_route', 'route_notes',
  'route_extra_01', 'route_extra_02', 'route_extra_03', 'route_extra_04', 'route_extra_05'];
const DAY = ['runs', 'load_sequence', 'dispatch_id', 'dispatch_date', 'delivery_date', 'delivery_day', 'load_date', 'load_day',
  'load_day_offset', 'departure_date', 'departure_day', 'start_time', 'route_hours', 'calculated_return_time', 'return_day_offset',
  'dispatch_time', 'driver_id', 'driver', 'tractor_id', 'truck', 'trailer_id', 'trailer', 'forklift_id', 'pallet_jack', 'cab_type',
  'sleeper', 'miles', 'driver_notes', 'co', 'po', 'to', 'ld', 'dr', 'checked_by', 'cases_out', 'plant_case_return', 'cases_delivered',
  'driver_case_return', 'complete_time', 'pickup', 'status', 'load_status', 'delivery_status', 'loaded_complete', 'load_temperature',
  'route_override', 'dispatch_time_override', 'start_time_override', 'route_hours_override', 'miles_override', 'load_sequence_override',
  'equipment_override', 'exception_reason', 'dsd_report', 'pre_post_trip', 'thermo_king', 'overage_shortage', 'overage_shortage_store',
  'overage_shortage_details', 'refused_returned', 'refused_returned_source', 'pallet_jack_unit', 'pallet_jack_issues', 'tractor_issues',
  'trailer_issues', 'trailer_needs_cleaned', 'checkin_notes', 'checkin_completed_at', 'issue_status', 'version', 'updated_at',
  'updated_by', 'extension_03', 'extension_04', 'extension_05', 'extension_06', 'extension_07', 'extension_08', 'extension_09'];
const PREFIXES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const LIVE_HEADERS = BASE.concat(...PREFIXES.map(p => DAY.map(c => p + '_' + c)));

function addDays(key, n) { const d = new Date(key + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function us(key) { const [y, m, d] = key.split('-').map(Number); return m + '/' + d + '/' + y; }

// route: {route, run, runId, routeId, days: {mon: {seq, offset, driverId, driver, truckId, truck, trailerId, trailer, time}}}
function liveTab(weekStart, label, routes, options) {
  options = options || {};
  const rows = [['Facility', 'Uniontown'], ['Week Start', label], ['Purpose', 'LIVE'], ['', '', 'DIRECT DISPATCH + CHECK-IN COLUMNS V3'],
    ['Record Type', 'Record Key'], LIVE_HEADERS.slice()];
  routes.forEach((r, n) => {
    const row = LIVE_HEADERS.map(() => '');
    const set = (col, v) => { const i = LIVE_HEADERS.indexOf(col); if (i < 0) throw new Error('no column ' + col); row[i] = v === undefined ? '' : String(v); };
    set('week_start_date', weekStart); set('facility_id', 'fac_uniontown'); set('route_id', r.routeId); set('route', r.route);
    set('route_name', r.routeName || 'UT DSD MILK'); set('run_id', r.runId); set('run', r.run || r.routeName || 'UT DSD MILK');
    set('load_type', 'Case Loadout'); set('movement_type', 'COMPANY_ROUTE'); set('coverage_type', 'UNITED DAIRY');
    set('route_status', r.status || 'ACTIVE'); set('active', r.active === undefined ? 'TRUE' : r.active);
    set('display_daily_dispatch', r.showDaily === undefined ? 'TRUE' : r.showDaily); set('display_weekly_dispatch', 'TRUE');
    PREFIXES.forEach((p, i) => {
      const d = (r.days || {})[p];
      const delivery = addDays(weekStart, i);
      const fmt = (options.usDates && n % 2) ? us : (k) => k;
      set(p + '_runs', d ? 'TRUE' : 'FALSE');
      set(p + '_load_sequence', d ? d.seq : r.baseSeq || '');
      set(p + '_delivery_date', fmt(delivery));
      set(p + '_delivery_day', ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i]);
      if (!d) return;
      const offset = d.offset === undefined ? -1 : d.offset;
      if (offset !== null) set(p + '_load_day_offset', offset);
      set(p + '_load_date', fmt(addDays(delivery, offset === null ? -1 : offset)));
      set(p + '_dispatch_time', d.time || '4:00:00 AM'); set(p + '_start_time', d.time || '4:00:00 AM');
      set(p + '_route_hours', d.hours || '10');
      set(p + '_driver_id', d.driverId); set(p + '_driver', d.driver);
      set(p + '_tractor_id', d.truckId); set(p + '_truck', d.truck);
      set(p + '_trailer_id', d.trailerId); set(p + '_trailer', d.trailer);
      set(p + '_load_sequence_override', d.override);
      set(p + '_cases_out', d.casesOut);
      set(p + '_load_status', d.loadStatus);
    });
    rows.push(row);
  });
  return rows;
}

const DRIVER_HEADERS = ['driver_id', 'employee_id', 'name', 'status', 'phone', 'email', 'facility_id', 'hire_date', 'seniority_date', 'relief_driver',
  'home_base', 'employment_status', 'unavailable_reason', 'position_order', 'eligible_route_ids_json', 'default_tractor_id', 'default_trailer_id', 'default_forklift_id']
  .concat(...['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map(p => [p + '_available', p + '_assignments_json']));
const EQUIPMENT_HEADERS = ['equipment_id', 'equipment_type', 'unit_id', 'facility_id', 'location', 'status', 'assignment_class', 'source_present',
  'last_source_sync_at', 'notes', 'version', 'created_at', 'created_by', 'updated_at', 'updated_by'];
const ROUTE_HEADERS = ['route_id', 'run_id', 'route_code', 'facility_id', 'stream_id', 'route', 'route_name', 'run', 'route_run_type', 'load_type',
  'movement_type', 'coverage_type', 'dedicated_type', 'route_status', 'active', 'display_route_master', 'display_daily_dispatch',
  'display_weekly_dispatch', 'display_plant_distribution', 'display_mobile_route', 'route_week_display', 'coverage_owner', 'route_notes']
  .concat(...['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(p => ['active', 'dispatch_time', 'load_order', 'miles', 'expected_route_hours', 'load_day_offset',
    'forklift_default', 'tractor_default', 'trailer_default', 'notes'].map(c => p + '_' + c)), ['departure_day', 'drop_and_hook', 'sleeper']);
const USER_HEADERS = ['ID', 'Email', 'Display Name', 'Status', 'Roles JSON', 'Version', 'Created At', 'Created By', 'Updated At', 'Updated By', 'Facility IDs JSON'];

function table(headers, rows) {
  return [headers.slice()].concat(rows.map(r => headers.map(h => (r[h] === undefined ? '' : String(r[h])))));
}

const DRIVERS = [
  { driver_id: 'drv_test_adams', name: 'ADAMS, PAT', status: 'ACTIVE', position_order: 1, hire_date: '3/1/2010', seniority_date: '3/1/2010', phone: '555-0101',
    mon_assignments_json: '[{"runId":"run_t801"}]', tue_assignments_json: '[{"runId":"run_t801"}]' },
  { driver_id: 'drv_test_brook', name: 'BROOK, SAM', status: 'ACTIVE', position_order: 2, hire_date: '2024-06-15', seniority_date: '2024-06-15', relief_driver: 'TRUE' },
  { driver_id: 'drv_test_casey', name: 'CASEY, LEE', status: 'ACTIVE', position_order: 3, hire_date: '2025-12-01',
    mon_assignments_json: '["run_t802"]', tue_assignments_json: '[{"run_id":"run_t802"}]' },
  { driver_id: 'drv_test_dunn', name: 'DUNN, ROBIN', status: 'INACTIVE', position_order: 4, wed_assignments_json: '[{"runId":"run_t810"}]' }
];
const EQUIPMENT = [
  { equipment_id: 'veh_truck_900001', equipment_type: 'TRUCK', unit_id: '900001', status: 'ACTIVE', location: 'UNIONTOWN' },
  { equipment_id: 'veh_truck_900002', equipment_type: 'TRUCK', unit_id: '900002', status: 'ACTIVE', location: 'UNIONTOWN' },
  { equipment_id: 'veh_trailer_t_901', equipment_type: 'TRAILER', unit_id: 'T-901', status: 'ACTIVE', location: 'UNIONTOWN' },
  { equipment_id: 'veh_trailer_t_902', equipment_type: 'TRAILER', unit_id: 'T-902', status: 'ACTIVE', location: 'UNIONTOWN' },
  { equipment_id: 'veh_trailer_t_903', equipment_type: 'TRAILER', unit_id: 'T-903', status: 'INACTIVE', location: 'FAIRMONT WV BRANCH' }
];
const ROUTES = [
  { route_id: 'rte_t801', run_id: 'run_t801', route: '801', route_name: 'UT DSD MILK', run: 'UT DSD MILK', route_status: 'ACTIVE', active: 'TRUE', route_week_display: 2,
    load_type: 'Case Loadout', coverage_owner: 'Uniontown', mon_active: 'TRUE', mon_dispatch_time: '4:00 AM', mon_load_order: 20, mon_miles: 140, mon_expected_route_hours: '9:30',
    mon_load_day_offset: -1, mon_tractor_default: '900001', mon_trailer_default: 'T-901', tue_active: 'TRUE', tue_dispatch_time: '4:00 AM', tue_load_order: 20, tue_miles: 140, departure_day: 'Delivery Day' },
  { route_id: 'rte_t802', run_id: 'run_t802', route: '802', route_name: 'UT DSD MILK', run: 'UT DSD MILK', route_status: 'ACTIVE', active: 'TRUE', route_week_display: 1,
    load_type: 'Case Loadout', coverage_owner: 'Uniontown', mon_active: 'TRUE', mon_dispatch_time: '5:30 AM', mon_load_order: 10, mon_miles: 96, tue_active: 'TRUE', tue_dispatch_time: '5:30 AM', tue_load_order: 10, tue_miles: 96 },
  { route_id: 'rte_t810', run_id: 'run_t810', route: '810', route_name: 'SUN VALLEY', run: 'SUN VALLEY', route_status: 'ACTIVE', active: 'TRUE', route_week_display: 3,
    coverage_owner: 'Uniontown', wed_active: 'TRUE', wed_miles: 620, sat_active: 'TRUE', sat_miles: 620, sleeper: 'TRUE', drop_and_hook: 'TRUE' },
  { route_id: 'rte_t899', run_id: 'run_t899', route: '899', route_name: 'HIDDEN', run: 'HIDDEN', route_status: 'ACTIVE', active: 'TRUE' }
];
const USERS = [
  { ID: 'usr_1', Email: 'Manager.Test@uniteddairy.com', 'Display Name': 'Test Manager', Status: 'ACTIVE', 'Roles JSON': '["MANAGER"]' },
  { ID: 'usr_2', Email: 'dispatch.test@uniteddairy.com', 'Display Name': 'Test Dispatcher', Status: 'ACTIVE', 'Roles JSON': '["DISPATCHER"]' },
  { ID: 'usr_3', Email: 'viewer.test@uniteddairy.com', 'Display Name': 'Test Viewer', Status: 'ACTIVE', 'Roles JSON': '["PLANT_EMPLOYEE"]' },
  { ID: 'usr_4', Email: 'admin.test@uniteddairy.com', 'Display Name': 'Test Admin', Status: 'ACTIVE', 'Roles JSON': '["ADMINISTRATOR"]' }
];

// Headers from V50MAP_02_V1_Schema.gs (the real DRIVER_EXCEPTIONS / DRIVER_VACATIONS tabs were not readable from here).
const EXCEPTION_HEADERS = ['exception_id', 'driver_id', 'start_date', 'end_date', 'exception_type', 'status', 'reason_code', 'notes', 'requested_at', 'requested_by',
  'reviewed_at', 'reviewed_by', 'decision_notes', 'facility_id', 'version', 'created_at', 'created_by', 'updated_at', 'updated_by'];
const EXCEPTIONS = [
  { exception_id: 'dav_test_1', driver_id: 'drv_test_brook', start_date: '2026-10-07', end_date: '2026-10-07', exception_type: 'SICK DAY', status: 'UNAVAILABLE', reason_code: 'SICK DAY', facility_id: 'fac_uniontown' },
  { exception_id: 'vsched_vac_test_1', driver_id: 'drv_test_adams', start_date: '10/12/2026', end_date: '10/16/2026', exception_type: 'VACATION', status: 'APPROVED', reason_code: 'VACATION', facility_id: 'fac_uniontown' }
];
const VACATION_HEADERS = ['id', 'driver_id', 'start_date', 'end_date', 'status', 'vacation_type', 'notes', 'requested_at', 'requested_by', 'updated_at', 'updated_by', 'facility_id', 'version', 'created_at', 'created_by'];
const VACATIONS = [
  { id: 'vac_test_1', driver_id: 'drv_test_adams', start_date: '2026-10-12', end_date: '2026-10-16', status: 'APPROVED', vacation_type: 'VACATION', facility_id: 'fac_uniontown' }
];

// The Plant Operations Scheduler journal (PLANT_OPERATIONS, in the Live workbook): 801 on Thursday 10/8 is a plant
// load (801 does not run Thursdays), 802 Saturday 10/10 is a Carrier pickup, a changed record keeps its last row.
const PLANT_HEADERS = ['record_id', 'record_type', 'business_date', 'facility_id', 'route_id', 'run_id', 'route', 'run', 'status', 'notes', 'payload_json', 'recorded_at', 'recorded_by'];
const PLANT = [
  { record_id: 'pls_1', record_type: 'PLANT_SCHEDULE', business_date: '2026-10-08', run_id: 'run_t801', route: '801', run: 'UT DSD MILK', status: 'SCHEDULED', payload_json: '{"pickupTime":"6:00 AM","trailer":"T-901","scheduleType":"ROUTE"}', recorded_at: '2026-10-01T10:00:00Z' },
  { record_id: 'pls_1', record_type: 'PLANT_SCHEDULE', business_date: '2026-10-08', run_id: 'run_t801', route: '801', run: 'UT DSD MILK', status: 'SCHEDULED', payload_json: '{"pickupTime":"7:00 AM","trailer":"T-902","scheduleType":"ROUTE","poNumber":"4411"}', recorded_at: '2026-10-02T10:00:00Z' },
  { record_id: 'pls_2', record_type: 'PLANT_SCHEDULE', business_date: '2026-10-10', run_id: 'run_t802', route: '802', run: 'UT DSD MILK', status: 'SCHEDULED', payload_json: '{"scheduleType":"CARRIER","poNumber":"88"}' },
  { record_id: 'pls_3', record_type: 'PLANT_SCHEDULE', business_date: '2026-10-09', run_id: 'run_t802', route: '802', run: 'UT DSD MILK', status: 'DELETED', payload_json: '{}' },
  { record_id: 'wash_1', record_type: 'WASH', business_date: '2026-10-08', run_id: 'run_t801', status: 'DONE' }
];

const MAINT_HEADERS = ['record_id', 'facility_id', 'service_date', 'source_type', 'source_id', 'status', 'priority', 'opened_at', 'opened_by', 'updated_at', 'updated_by',
  'driver', 'issue_type', 'issue_details', 'route_id', 'run_id', 'notes'];

// Weeks: previous 2026-09-27, current 2026-10-04, next 2026-10-11.
function weekRoutes(week) {
  return [
    { route: '801', routeId: 'rte_t801', runId: 'run_t801', days: {
      mon: { seq: 20, driverId: 'drv_test_adams', driver: 'ADAMS, PAT', truckId: 'veh_truck_900001', truck: '900001', trailerId: 'veh_trailer_t_901', trailer: 'T-901' },
      tue: { seq: 20, driverId: 'BROOK SAM', driver: 'BROOK, SAM', truckId: 'veh_truck_900002', truck: '900002', trailerId: 'veh_trailer_t_902', trailer: 'T-902', loadStatus: 'COMPLETE' } } },
    { route: '802', routeId: 'rte_t802', runId: 'run_t802', days: {
      mon: { seq: 10, driverId: 'drv_test_casey', driver: 'CASEY, LEE' },
      tue: { seq: 10, override: 30, time: '5:30:00 AM' } } },
    // One run on two rows: Monday-Wednesday on one, Saturday (loaded two days early) on another.
    { route: '810', routeId: 'rte_t810', runId: 'run_t810', routeName: 'SUN VALLEY', days: { wed: { seq: 40, offset: 0 } } },
    { route: '810', routeId: 'rte_t810', runId: 'run_t810', routeName: 'SUN VALLEY', days: { sat: { seq: 40, offset: -2 } } },
    { route: '899', routeId: 'rte_t899', runId: 'run_t899', routeName: 'HIDDEN', showDaily: 'FALSE', days: { mon: { seq: 5 } } },
    { route: '898', routeId: 'rte_t898', runId: 'run_t898', routeName: 'RETIRED', status: 'INACTIVE', days: { mon: { seq: 6 } } }
  ];
}

function fakeSheets(overrides) {
  overrides = overrides || {};
  const tabs = {
    "'LIVE PREVIOUS WEEK'": liveTab('2026-09-27', '2026-09-27', weekRoutes('2026-09-27')),
    "'LIVE CURRENT WEEK'": liveTab('2026-10-04', '2026-09-27', weekRoutes('2026-10-04'), { usDates: true }),
    "'LIVE NEXT WEEK'": liveTab('2026-10-11', '2026-10-11', weekRoutes('2026-10-11')),
    "'DRIVERS_MASTER'": table(DRIVER_HEADERS, DRIVERS),
    "'EQUIPMENT_MASTER'": table(EQUIPMENT_HEADERS, EQUIPMENT),
    "'ROUTES_MASTER'": table(ROUTE_HEADERS, ROUTES),
    "'USERS_MASTER'": table(USER_HEADERS, USERS),
    "'DRIVER_EXCEPTIONS'": table(EXCEPTION_HEADERS, EXCEPTIONS),
    "'DRIVER_VACATIONS'": table(VACATION_HEADERS, VACATIONS),
    "'PLANT_OPERATIONS'": table(PLANT_HEADERS, PLANT),
    // The maintenance queues (the garage's tabs in the Live workbook), empty; the Trailer tab has no wash columns.
    "'TRUCK LIVE'": table(MAINT_HEADERS.concat(['truck_number', 'truck_id']), []),
    "'TRAILER LIVE'": table(MAINT_HEADERS.concat(['trailer_number', 'trailer_id']), []),
    "'FORK TRUCK LIVE'": table(MAINT_HEADERS.concat(['unit_number', 'equipment_id', 'equipment_type']), []),
    "'WASH / CLEANING LIVE'": table(MAINT_HEADERS.concat(['unit_number', 'equipment_id', 'equipment_type', 'wash_reason', 'wash_status', 'wash_type', 'completed_at']), []),
    "'REFUSALS / RETURNS LIVE'": table(MAINT_HEADERS.concat(['reason_details', 'return_source', 'disposition']), [])
  };
  Object.assign(tabs, overrides);
  return tabs;
}

const SOURCES = {
  live: { spreadsheetId: 'fake-live' },
  masters: {
    routes: { spreadsheetId: 'fake-routes', tab: 'ROUTES_MASTER' },
    drivers: { spreadsheetId: 'fake-drivers', tab: 'DRIVERS_MASTER' },
    equipment: { spreadsheetId: 'fake-equipment', tab: 'EQUIPMENT_MASTER' },
    users: { spreadsheetId: 'fake-users', tab: 'USERS_MASTER' },
    exceptions: { spreadsheetId: 'fake-exceptions', tab: 'DRIVER_EXCEPTIONS' },
    vacations: { spreadsheetId: 'fake-vacations', tab: 'DRIVER_VACATIONS' },
    plantLoads: { spreadsheetId: 'fake-live', tab: 'PLANT_OPERATIONS' }
  }
};

// A reader that records every request, so tests can prove the transfer only reads.
function fakeReader(tabs) {
  const calls = [];
  return {
    calls,
    async batchGet(spreadsheetId, ranges) {
      calls.push({ spreadsheetId, ranges });
      return ranges.map(r => { if (!tabs[r]) throw new Error('no fake tab ' + r); return JSON.parse(JSON.stringify(tabs[r])); });
    }
  };
}

// A sandbox copy of the Live workbook that can be written: batchUpdate applies 'TAB'!A1 cells in memory.
function fakeWritableSheets(tabs) {
  const reader = fakeReader(tabs);
  const writes = [];
  const colIndex = (letters) => letters.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return {
    calls: reader.calls, writes, tabs,
    batchGet: reader.batchGet,
    async batchUpdate(spreadsheetId, data) {
      writes.push({ spreadsheetId, data });
      data.forEach(({ range, values }) => {
        const m = range.match(/^('.*')!([A-Z]+)(\d+)$/);
        if (!m) throw new Error('bad range ' + range);
        const rows = tabs[m[1]], r = Number(m[3]) - 1, c = colIndex(m[2]);
        while (rows.length <= r) rows.push([]);
        while (rows[r].length <= c) rows[r].push('');
        rows[r][c] = values[0][0];
      });
    }
  };
}

module.exports = { fakeWritableSheets, LIVE_HEADERS, liveTab, table, fakeSheets, fakeReader, weekRoutes, SOURCES, DRIVERS, EQUIPMENT, ROUTES, USERS, EXCEPTIONS, VACATIONS };
