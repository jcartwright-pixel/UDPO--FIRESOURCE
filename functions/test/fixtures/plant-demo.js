'use strict';
/*
 * A busier made-up plant day for the plant screens' tests and pictures: Thursday 10/8/2026 loads Friday's routes in all
 * four areas (cases, totes, boxes, tanker), some done, some loading, one left over from Wednesday, with pickups,
 * unloading records, wash and return requests. Same column layout as the real sheets (demo-sheets.js).
 */
const D = require('../../src/demo-sheets');

const PLANT_DATE = '2026-10-08';
const AREA_TYPE = { CASE: 'Case Loadout', TOTES: 'Totes', BOXING: 'Boxing', TANKER: 'Tanker' };
const DRIVERS = ['CARPENTER, GREGG', 'YODER, SCOTT', 'PRASTER, JEREMY', 'ALESANTRINO, DAVID', 'ALSTON, BRANDON', 'GREGORY, MICHAEL', 'HOWSARE, CHARLES',
  'ZIDEK, MARK', 'CRUZ, STEVEN', 'BARROW, ROGIE', 'JACOBS, JOEL', 'HERMAN, CHAD', 'THOMAS, CARSON', 'BRANCH'];

// [route, run, area, seq, depart, state, cases]  state: W waiting, L loading, D done
const LOADS = [
  ['801', 'UT DSD MILK', 'CASE', 10, '1:00 AM', 'D', 612], ['802', 'UT DSD MILK', 'CASE', 20, '1:00 AM', 'D', 588], ['805', 'UT DSD MILK', 'CASE', 30, '3:00 AM', 'D', 540],
  ['808', 'UT DSD MILK', 'CASE', 40, '4:00 AM', 'L', 0], ['811', 'UT DSD MILK', 'CASE', 50, '4:00 AM', 'W', 0], ['812', 'UT DSD MILK', 'CASE', 60, '5:00 AM', 'W', 0],
  ['815', 'UT DSD MILK', 'CASE', 70, '3:00 AM', 'W', 0], ['6301_1', 'UT WALMART', 'CASE', 80, '5:00 AM', 'W', 0], ['6302', 'UT WALMART', 'CASE', 90, '3:00 AM', 'W', 0],
  ['8302_1', '8302_1', 'CASE', 100, '11:00 PM', 'W', 0], ['8303_1', 'UT WALMART', 'CASE', 110, '5:30 AM', 'W', 0],
  ['901_1', 'FERRY PRODUCT 1', 'TOTES', 10, '7:00 AM', 'D', 120], ['901_2', 'FERRY PRODUCT 2', 'TOTES', 20, '9:00 AM', 'W', 0],
  ['907_1', 'FAIRMONT TRANSFER', 'BOXING', 10, '9:00 AM', 'L', 0], ['849', 'SUN VALLEY', 'BOXING', 20, '1:00 PM', 'W', 0],
  ['892', 'GARBER', 'TANKER', 10, '7:00 AM', 'W', 0]
];

function plantWeek() {
  const routes = LOADS.map(([route, run, area, seq, time, state, cases], i) => ({
    route, routeId: 'rte_p' + route, runId: 'run_p' + route, routeName: run, run,
    // Thursday loads Friday's delivery (offset -1).
    days: { fri: { seq, time, offset: -1, driver: DRIVERS[i % DRIVERS.length], truck: String(223870 + i), trailer: 'T-' + (950 + i),
      casesOut: cases || '', loadStatus: state === 'D' ? 'COMPLETE' : state === 'L' ? 'LOADING' : '' },
    // Thursday's delivery of the same run (loaded Wednesday, done): the trailers coming back to unload on Thursday.
    thu: { seq, time, offset: -1, driver: DRIVERS[i % DRIVERS.length], truck: String(223870 + i), trailer: 'T-' + (950 + i), casesOut: 500 + i, loadStatus: 'COMPLETE' } }
  }));
  // Left over from Wednesday: loaded for Thursday, never finished.
  routes.push({ route: '6303', routeId: 'rte_p6303', runId: 'run_p6303', routeName: 'UT WALMART', run: 'UT WALMART', days: { thu: { seq: 5, time: '6:00 AM', offset: -1, driver: 'GREGORY, MICHAEL', truck: '223873', trailer: 'T-993', loadStatus: 'LOADING' } } });
  const tab = D.liveTab('2026-10-04', '2026-10-04', routes);
  const h = tab[5], col = (name) => h.indexOf(name);
  tab.slice(6).forEach((row, i) => {
    const area = i < LOADS.length ? LOADS[i][2] : 'CASE';
    row[col('load_type')] = AREA_TYPE[area];
    // As on the real Live sheet, the DSD case routes have "show in plant" off; the plant still loads them.
    if (area === 'CASE') row[col('display_plant_distribution')] = 'FALSE';
    const state = i < LOADS.length ? LOADS[i][5] : 'L';
    const p = i < LOADS.length ? 'fri' : 'thu', base = i < LOADS.length ? PLANT_DATE : '2026-10-07';
    // Start / End times (extension_05 = started, complete_time = done) in UTC, morning at the plant.
    const start = new Date(Date.parse(base + 'T05:00:00Z') + i * 9 * 60000).toISOString();
    if (state !== 'W') row[col(p + '_extension_05')] = start;
    if (state === 'D') row[col(p + '_complete_time')] = new Date(Date.parse(start) + 38 * 60000).toISOString();
    if (i < LOADS.length) row[col('thu_complete_time')] = new Date(Date.parse('2026-10-07T05:00:00Z') + i * 9 * 60000).toISOString();
  });
  // 811's driver checked in Thursday with 4 cases back and product refused at a store.
  const r811 = tab.slice(6).find(row => row[col('route')] === '811');
  r811[col('thu_driver_case_return')] = '4'; r811[col('thu_refused_returned')] = '2 gallons 2% refused'; r811[col('thu_refused_returned_source')] = 'Kroger Uniontown';
  r811[col('thu_checkin_completed_at')] = '2026-10-08T17:20:00Z';
  return tab;
}

const PICKUPS = [
  { pickup_id: 'pu_demo_1', facility_id: 'fac_uniontown', service_date: PLANT_DATE, route_id: 'rte_p805', run_id: 'run_p805', route: '805', run: 'UT DSD MILK', operation_type: 'PICKUP', item: '12 Gallon whole', quantity: '12', status: 'PENDING', created_at: '2026-10-08T06:10:00Z', created_by: 'loader@uniteddairy.com' },
  { pickup_id: 'pu_demo_2', facility_id: 'fac_uniontown', service_date: PLANT_DATE, route_id: 'rte_p801', run_id: 'run_p801', route: '801', run: 'UT DSD MILK', operation_type: 'PICKUP', item: 'Half gallon 2%', quantity: '6', status: 'COMPLETE', created_at: '2026-10-08T05:30:00Z', completed_at: '2026-10-08T06:00:00Z' }
];
const JOURNAL_HEADERS = ['record_id', 'facility_id', 'business_date', 'record_type', 'route_id', 'run_id', 'route', 'run', 'trailer', 'quantity', 'temperature', 'status', 'started_at', 'completed_at', 'shift', 'area', 'notes', 'payload_json', 'recorded_at', 'recorded_by', 'version'];
const JOURNAL = [
  // Thursday's trailers back: 6303 delivered today and is unloaded.
  { record_id: PLANT_DATE + '|6303|UT WALMART', business_date: PLANT_DATE, record_type: 'UNLOADING', run_id: 'run_p6303', route: '6303', run: 'UT WALMART', status: 'COMPLETE', quantity: '40',
    recorded_at: '2026-10-08T16:40:00Z', payload_json: JSON.stringify({ unloadKey: PLANT_DATE + '|6303|UT WALMART', route: '6303', run: 'UT WALMART', casesIn: '40', trailer: 'T-993', startedAt: '2026-10-08T16:10:00Z', completedAt: '2026-10-08T16:38:00Z' }) },
  // 802 is unloaded; 805 is being unloaded; 805 brought back product to put in the cooler.
  { record_id: 'u802', business_date: PLANT_DATE, record_type: 'UNLOADING', route: '802', run: 'UT DSD MILK', status: 'COMPLETE', recorded_at: '2026-10-08T15:30:00Z',
    payload_json: JSON.stringify({ unloadKey: PLANT_DATE + '|802|UT DSD MILK', route: '802', run: 'UT DSD MILK', casesIn: '12', startedAt: '2026-10-08T15:05:00Z', completedAt: '2026-10-08T15:28:00Z' }) },
  { record_id: 'u805', business_date: PLANT_DATE, record_type: 'UNLOADING', route: '805', run: 'UT DSD MILK', status: 'UNLOADING', recorded_at: '2026-10-08T15:50:00Z',
    payload_json: JSON.stringify({ unloadKey: PLANT_DATE + '|805|UT DSD MILK', route: '805', run: 'UT DSD MILK', startedAt: '2026-10-08T15:45:00Z' }) },
  { record_id: 'ret805', business_date: PLANT_DATE, record_type: 'RETURN', route: '805', run: 'UT DSD MILK', recorded_at: '2026-10-08T15:20:00Z',
    payload_json: JSON.stringify({ route: '805', run: 'UT DSD MILK', casesReturned: '3', notes: '3 cases chocolate milk refused at the store' }) },
  { record_id: '2026-10-07|802|UT DSD MILK', business_date: '2026-10-07', record_type: 'UNLOADING', run_id: 'run_p802', route: '802', run: 'UT DSD MILK', status: 'COMPLETE' }
];
// The Plant Operations Scheduler: Route Master's plant customers and a week of Shipping and Receiving loads.
const CUSTOMER_HEADERS = ['route_id', 'run_id', 'route_code', 'facility_id', 'route', 'route_name', 'run', 'route_status', 'active', 'display_plant_distribution'];
const CUSTOMERS = [
  { route_id: 'rte_c892', run_id: 'run_c892', route: '892', route_name: 'Garber Farms', run: 'GARBER', route_status: 'ACTIVE', active: 'TRUE', display_plant_distribution: 'TRUE' },
  { route_id: 'rte_c849', run_id: 'run_c849', route: '849', route_name: 'Sun Valley', run: 'SUN VALLEY', route_status: 'ACTIVE', active: 'TRUE', display_plant_distribution: 'TRUE' },
  { route_id: 'rte_c6302', run_id: 'run_c6302', route: '6302', route_name: 'Walmart DC', run: 'UT WALMART', route_status: 'ACTIVE', active: 'TRUE', display_plant_distribution: 'TRUE' },
  { route_id: 'rte_c905', run_id: 'run_c905_1', route: '905_1', route_name: 'Aldi Charleston', run: 'ALDI - CHARLESTON LOAD 1', route_status: 'ACTIVE', active: 'TRUE', display_plant_distribution: 'TRUE' },
  { route_id: 'rte_c905', run_id: 'run_c905_2', route: '905_2', route_name: 'Aldi Charleston', run: 'ALDI - CHARLESTON LOAD 2', route_status: 'ACTIVE', active: 'TRUE', display_plant_distribution: 'TRUE' },
  { route_id: 'rte_c907', run_id: 'run_c907_1', route: '907_1', route_name: 'Fairmont', run: 'FAIRMONT TRANSFER', route_status: 'ACTIVE', active: 'TRUE', display_plant_distribution: 'TRUE' },
  { route_id: 'rte_c950', run_id: 'run_c950', route: '950', route_name: 'Retired Customer', run: 'RETIRED', route_status: 'INACTIVE', active: 'FALSE', display_plant_distribution: 'TRUE' },
  { route_id: 'rte_c951', run_id: 'run_c951', route: '951', route_name: 'Not For Plant', run: 'NOT PLANT', route_status: 'ACTIVE', active: 'TRUE', display_plant_distribution: 'FALSE' }
];
const sched = (id, type, date, c, p, extra) => Object.assign({ record_id: id, facility_id: 'fac_uniontown', business_date: date, record_type: type, route_id: c[0], run_id: c[1], route: c[2], run: c[3],
  status: 'SCHEDULED', area: type === 'PLANT_RECEIVING' ? 'RECEIVING' : 'SCHEDULER', notes: p.notes || '', payload_json: JSON.stringify(p), recorded_at: '2026-10-05T14:00:00Z', recorded_by: 'manager@uniteddairy.com' }, extra || {});
const GARBER = ['rte_c892', 'run_c892', '892', 'GARBER'], SUNV = ['rte_c849', 'run_c849', '849', 'SUN VALLEY'], WALMART = ['rte_c6302', 'run_c6302', '6302', 'UT WALMART'], ALDI = ['rte_c905', 'run_c905_1', '905', 'ALDI - CHARLESTON'];
const VALLEY = ['SUP-START-1', 'SUP-START-1', 'S01', 'VALLEY FARMS MILK CO-OP'], KEYSTONE = ['SUP-START-3', 'SUP-START-3', 'S03', 'KEYSTONE CARTON SUPPLY'];
const SCHEDULE = [
  sched('SCHED-g1', 'PLANT_SCHEDULE', '2026-10-08', GARBER, { pickupTime: '07:00', loadDate: '2026-10-07', trailer: 'T-955', scheduleType: 'ROUTE', cases: '', product: 'Raw milk' }),
  sched('SCHED-s1', 'PLANT_SCHEDULE', '2026-10-08', SUNV, { pickupTime: '13:00', loadDate: '2026-10-08', scheduleType: 'CARRIER', carrier: true, poNumber: '4471', cases: '860', product: 'Half gallons' }),
  // Edited once: the second row is the load now (6:30 AM).
  sched('SCHED-w1', 'PLANT_SCHEDULE', '2026-10-08', WALMART, { pickupTime: '06:00', loadDate: '2026-10-07', scheduleType: 'ROUTE' }),
  sched('SCHED-w1', 'PLANT_SCHEDULE', '2026-10-08', WALMART, { pickupTime: '06:30', loadDate: '2026-10-07', trailer: 'T-960', scheduleType: 'ROUTE', notes: 'Dock 3' }, { recorded_at: '2026-10-06T09:00:00Z' }),
  sched('SCHED-a1', 'PLANT_SCHEDULE', '2026-10-09', ALDI, { pickupTime: '05:30', loadDate: '2026-10-08', trailer: 'T-961', scheduleType: 'ROUTE', cases: '1200', product: 'Gallons 2%' }),
  sched('SCHED-w2', 'PLANT_SCHEDULE', '2026-10-06', WALMART, { pickupTime: '04:00', loadDate: '2026-10-05', scheduleType: 'ROUTE' }),
  sched('SCHED-g2', 'PLANT_SCHEDULE', '2026-10-13', GARBER, { pickupTime: '07:00', loadDate: '2026-10-12', scheduleType: 'ROUTE' }),
  sched('SCHED-x1', 'PLANT_SCHEDULE', '2026-10-08', GARBER, { pickupTime: '09:00', scheduleType: 'ROUTE' }, { status: 'DELETED' }),
  sched('RECV-v1', 'PLANT_RECEIVING', '2026-10-08', VALLEY, { pickupTime: '08:00', scheduleType: 'ROUTE', cases: '', product: 'Raw milk, 2 tankers' }),
  sched('RECV-k1', 'PLANT_RECEIVING', '2026-10-09', KEYSTONE, { pickupTime: '10:00', scheduleType: 'CARRIER', carrier: true, poNumber: 'K-2290', cases: '40', product: 'Gallon cartons' }),
  { record_id: 'SUP-m1', facility_id: 'fac_uniontown', business_date: '2026-10-02', record_type: 'PLANT_SUPPLIER', route_id: 'SUP-m1', run_id: 'SUP-m1', route: 'S06', run: 'MOUNTAIN STATE SUGAR', status: 'ACTIVE',
    area: 'RECEIVING', notes: 'Mountain Sugar', payload_json: '{}', recorded_at: '2026-10-02T12:00:00Z' }
];

const WASH_HEADERS = ['record_id', 'facility_id', 'service_date', 'source_type', 'status', 'unit_number', 'equipment_type', 'wash_reason', 'notes', 'opened_at', 'completed_at'];
const WASH = [
  { record_id: 'wash_d1', service_date: PLANT_DATE, status: 'OPEN', unit_number: 'T-951', equipment_type: 'TRAILER', wash_reason: 'Trailer cleaning requested' },
  { record_id: 'wash_d2', service_date: PLANT_DATE, status: 'OPEN', unit_number: 'T-960', equipment_type: 'TRAILER', wash_reason: 'Spilled milk' },
  { record_id: 'wash_d3', service_date: PLANT_DATE, status: 'COMPLETE', unit_number: 'T-955', equipment_type: 'TRAILER', completed_at: PLANT_DATE + 'T15:00:00Z' }
];
const RETURN_HEADERS = ['record_id', 'facility_id', 'service_date', 'status', 'route_id', 'run_id', 'reason_details', 'return_source', 'disposition'];
const RETURNS = [{ record_id: 'ret_d1', service_date: PLANT_DATE, status: 'OPEN', run_id: 'run_p802', reason_details: '3 cases chocolate refused', return_source: 'DRIVER_CHECKIN', disposition: 'PENDING_REVIEW' }];

// PLANT_OPERATIONS_MASTER (the Plant Operations workbook): the production lines and temperature locations, as on the real sheet.
const SETUP_HEADERS = ['operation_id', 'operation_type', 'display_name', 'status', 'production_area', 'days_json', 'view_sequence', 'facility_id'];
const LINES = [['ut_prod_boxing', 'BOXING', 10], ['ut_prod_totes', 'TOTES', 20], ['ut_prod_htst_1', 'HTST #1', 40], ['ut_prod_gallon_filler', 'GALLON FILLER', 80], ['ut_prod_blow_mold', 'BLOW MOLD', 90]];
const SETUP = LINES.map(([id, name, seq]) => ({ operation_id: id, operation_type: 'PRODUCTION_AREA', display_name: name, status: 'ACTIVE', production_area: name, days_json: '{}', view_sequence: String(seq), facility_id: 'fac_uniontown' }))
  .concat([{ operation_id: 'ut_prod_retired', operation_type: 'PRODUCTION_AREA', display_name: 'OLD FILLER', status: 'INACTIVE', production_area: 'OLD FILLER', view_sequence: '5', facility_id: 'fac_uniontown' },
    { operation_id: 'ut_temp_cooler_north', operation_type: 'TEMPERATURE_CHECK_LOCATION', display_name: 'Cooler North', status: 'ACTIVE', production_area: 'Cooler North', view_sequence: '140', facility_id: 'fac_uniontown',
      days_json: JSON.stringify({ sensorId: '69834842f8b4d991033d30d1', sensorName: 'Temperature Humidity Sensor', lowLimit: 33, highLimit: 41 }) },
    { operation_id: 'ut_temp_cooler_middle', operation_type: 'TEMPERATURE_CHECK_LOCATION', display_name: 'Cooler Middle', status: 'ACTIVE', production_area: 'Cooler Middle', view_sequence: '180', facility_id: 'fac_uniontown', days_json: '{"sensorId":""}' }]);
// PLANT LINE STATUS (the Live workbook): each line's last check.
const LINE_STATUS_HEADERS = ['Record Key', 'Area', 'Status', 'Temperature', 'Notes', 'Payload JSON', 'Updated At', 'Updated By'];
const LINE_STATUS = [
  { 'Record Key': 'ut_prod_boxing', Area: 'BOXING', Status: 'RUNNING', 'Updated At': '2026-10-08T14:03:33-04:00', 'Updated By': 'bbircher@uniteddairy.com',
    'Payload JSON': JSON.stringify({ operationId: 'ut_prod_boxing', area: 'BOXING', product: '1% Chocolate milk', status: 'RUNNING', qualityCheck: 'PASS', tipTest: 'PASS', weights: { result: '' }, notes: '' }) },
  { 'Record Key': 'ut_prod_blow_mold', Area: 'BLOW MOLD', Status: 'REVIEW', Temperature: '1130', 'Updated At': '2026-10-08T14:16:55-04:00', 'Updated By': 'bbircher@uniteddairy.com',
    'Payload JSON': JSON.stringify({ operationId: 'ut_prod_blow_mold', area: 'BLOW MOLD', product: 'Gallon', status: 'REVIEW', temperature: '1130', cycleTime: '7.8', annealerSpeed: '70',
      weights: { head1: '55.3', head2: '58.5', head3: '57.2', head4: '55.7', head5: '57.1', head6: '55.9' }, notes: 'Head 2 heavy' }) }
];

function plantSheets() {
  return D.fakeSheets({
    "'LIVE CURRENT WEEK'": plantWeek(),
    "'LIVE PLANT OPERATIONS'": D.table(['pickup_id', 'facility_id', 'service_date', 'route_id', 'run_id', 'route', 'run', 'operation_type', 'item', 'quantity', 'pickup_location', 'notes', 'status',
      'manager_acknowledged', 'created_at', 'created_by', 'updated_at', 'updated_by', 'completed_at', 'completed_by'], PICKUPS),
    "'PLANT_OPERATIONS'": D.table(JOURNAL_HEADERS, JOURNAL.concat(SCHEDULE)),
    "'ROUTES_MASTER'": D.table([...new Set(D.ROUTES.concat(CUSTOMERS).flatMap(r => Object.keys(r)).concat(CUSTOMER_HEADERS))], D.ROUTES.concat(CUSTOMERS)),
    "'WASH / CLEANING LIVE'": D.table(WASH_HEADERS, WASH),
    "'REFUSALS / RETURNS LIVE'": D.table(RETURN_HEADERS, RETURNS),
    "'PLANT_OPERATIONS_MASTER'": D.table(SETUP_HEADERS, SETUP),
    "'PLANT LINE STATUS'": D.table(LINE_STATUS_HEADERS, LINE_STATUS)
  });
}
const PLANT_SOURCES = Object.assign({}, D.SOURCES, { live: Object.assign({}, D.SOURCES.live, { plant: true }), plant: { pickups: { spreadsheetId: 'fake-plant', tab: 'LIVE PLANT OPERATIONS' } } });

module.exports = { PLANT_DATE, LOADS, plantSheets, PLANT_SOURCES, CUSTOMERS, SCHEDULE };
