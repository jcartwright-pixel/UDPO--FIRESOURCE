/*
 * The Upload Center's rules (Joe 10/18: "upload centers ... a template ... bring all the data in for Martins Ferry and
 * Charleston whenever they go live"; his pick: one workbook for the whole plant, each person fills their own tabs). Shared by
 * the screen and the server (one file, copied unchanged to public/js/upload-rules.js; a unit test checks the two match).
 *
 *   - SPEC is the workbook: one entry per tab, its columns (heading, must fill, what to type, choices) and an example row.
 *     tools/build-upload-workbook.py builds public/templates/Plant-Setup-Workbook.xlsx from it, so the file and the checks
 *     never disagree;
 *   - no trucks or trailers tab, and no truck or trailer column anywhere (Joe 10/18: the United Dairy Fleet List already has
 *     every truck and trailer, and trucks are assigned in the app just like at Uniontown);
 *   - never Social Security numbers, birth dates or home addresses: a tab with such a column is refused;
 *   - readBook turns the file's tabs (rows of cells) into rows; an empty tab, and a tab left with only the example row, is
 *     skipped (what is saved for it stays);
 *   - check compares each filled tab with what is saved for the plant: every row is New, Changed (with what changed), Same or
 *     a Problem (with why), and a saved row that is not in the file is Taken off. A tab's file rows replace its saved rows;
 *   - references between tabs are checked against the file, or what is saved when that tab is not in the file: a driver's
 *     regular route must be on Routes, a Route Days row's route too, a product's line on Lines, and so on.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UDUpload = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var YN = ['Yes', 'No'];
  var ROLES = ['Viewer', 'Employee', 'Driver', 'Driver Check-In', 'Plant Employee', 'Mechanic', 'Dispatcher', 'Supervisor', 'Manager', 'Administrator'];
  var MAX_ROWS = 3000;

  // [heading, field, must fill, kind, what to type, where it goes, choices]
  function col(h, key, req, kind, what, goes, choices) { return { h: h, key: key, req: !!req, kind: kind || 'text', what: what || '', goes: goes || '', choices: choices || null }; }

  var weekCols = [col('Employee ID', 'employeeId', true, 'id', 'Same ID as the Drivers tab.', 'matches the driver')];
  DAYS.forEach(function (d) {
    var k = d.toLowerCase();
    weekCols.push(col(d + ' Works', k + 'Works', true, 'works', 'Yes, or Off for a regular day off.', 'Driver Master ' + k + '_available', ['Yes', 'Off']));
    weekCols.push(col(d + ' Route', k + 'Route', false, 'routeLoad', 'Route and load, like 803 Load 1. Blank if they float.', 'Driver Master ' + k + '_assignments_json'));
  });

  var SPEC = [
    { key: 'routes', tab: 'Routes', part: 'Routes', who: 'Dispatch', about: 'One row per route and load (803 Load 1 and 803 Load 2 are two rows).', cols: [
      col('Route #', 'route', true, 'code', 'The route number, like 803.', 'Route Master route'),
      col('Load', 'load', true, 'load', 'Load 1, Load 2 ... (or Run 1).', 'Route Master run'),
      col('Customer / Route Name', 'name', true, 'text', 'What the route is called, like DSD or SAVE-A-LOT.', 'Route Master route_name'),
      col('Stream Name', 'stream', false, 'text', 'Name shown on the boards if different, like SAVE-A-LOT 1.', 'Route Master stream_id'),
      col('Run Code', 'code', false, 'code', 'Short code if the plant uses one. Blank = route number.', 'Route Master route_code'),
      col('Load Type', 'loadType', true, 'choice', 'How it is loaded.', 'Route Master load_type', ['Case Loadout', 'Tote', 'Boxing', 'Tanker', 'None']),
      col('Who Runs It', 'runBy', true, 'choice', 'United Dairy driver, a branch, an outside carrier or a customer pickup.', 'Route Master movement_type + coverage_type', ['United Dairy', 'Branch', 'Outside Carrier', 'Customer Pickup']),
      col('Run By', 'owner', false, 'choice', 'Which location covers it.', 'Route Master coverage_owner', ['Charleston', 'Martins Ferry', 'Uniontown', 'Fairmont', 'Marietta', 'Carrier', 'Anyone']),
      col('Leaves On', 'leaves', false, 'choice', 'Delivery Day or Load Day.', 'Route Master departure_day', ['Delivery Day', 'Load Day']),
      col('Drop and Hook', 'dropHook', false, 'yesno', 'Yes if the trailer is dropped.', 'Route Master drop_and_hook', YN),
      col('Sleeper', 'sleeper', false, 'yesno', 'Yes if the run needs a sleeper truck.', 'Route Master sleeper', YN),
      col('Weekly Board Order', 'boardOrder', false, 'number', 'A number; lower shows higher on Weekly Dispatch.', 'Route Master route_week_display'),
      col('Show on Daily', 'showDaily', true, 'yesno', 'Show on Daily Dispatch.', 'display_daily_dispatch', YN),
      col('Show on Weekly', 'showWeekly', true, 'yesno', 'Show on Weekly Dispatch.', 'display_weekly_dispatch', YN),
      col('Show on Plant Loading', 'showPlant', true, 'yesno', 'Show on Loadout and the Scheduler.', 'display_plant_distribution', YN),
      col('Show on Driver Phone', 'showPhone', true, 'yesno', 'Show on the driver phone.', 'display_mobile_route', YN),
      col('Status', 'status', true, 'choice', 'Active or Inactive.', 'Route Master route_status + active', ['Active', 'Inactive']),
      col('Notes', 'notes', false, 'text', 'Anything about the route.', 'Route Master route_notes')
    ], example: ['803', 'Load 1', 'DSD', '', '', 'Case Loadout', 'United Dairy', 'Charleston', 'Delivery Day', 'No', 'No', '51', 'Yes', 'Yes', 'Yes', 'Yes', 'Active', ''] },
    { key: 'routeDays', tab: 'Route Days', part: 'Routes', who: 'Dispatch', about: 'One row per route, load and day it runs. Days it does not run can be left out.', cols: [
      col('Route #', 'route', true, 'code', 'Same as the Routes tab.', 'matches the route'),
      col('Load', 'load', true, 'load', 'Same as the Routes tab.', 'matches the route'),
      col('Day', 'day', true, 'choice', 'Delivery day.', 'Route Master <day>_ columns', DAYS),
      col('Runs', 'runs', true, 'yesno', 'Yes if it runs that day.', '<day>_active', YN),
      col('Dispatch Time', 'time', true, 'time', 'Like 4:00 AM.', '<day>_dispatch_time'),
      col('Load Order', 'loadOrder', false, 'number', 'Number in the loading line-up.', '<day>_load_order'),
      col('Round Trip Miles', 'miles', false, 'number', 'Whole miles.', '<day>_miles'),
      col('Route Hours', 'hours', false, 'hours', 'Like 9:30 or 9.5.', '<day>_expected_route_hours'),
      col('Loaded', 'loaded', true, 'choice', 'Which day it is loaded.', '<day>_load_day_offset (0, -1, -2)', ['Same day', 'Day before', '2 days before']),
      col('Notes', 'notes', false, 'text', 'Note for that day.', '<day>_notes')
    ], example: ['803', 'Load 1', 'Mon', 'Yes', '4:00 AM', '109', '190', '12', 'Day before', ''] },
    { key: 'drivers', tab: 'Drivers', part: 'Drivers', who: 'Dispatch', about: 'One row per driver. Never Social Security numbers, birth dates or home addresses.', cols: [
      col('Employee ID', 'employeeId', true, 'id', 'Payroll / Enterprise ID. Leading zeros are fine.', 'Driver Master employee_id (also the phone sign-in)'),
      col('Driver Name', 'name', true, 'text', 'First and last name, the way dispatch says it.', 'Driver Master name'),
      col('Status', 'status', true, 'choice', 'Active or Inactive.', 'Driver Master status', ['Active', 'Inactive']),
      col('Cell Phone', 'phone', false, 'phone', '10 digits.', 'Driver Roster phone (Schedule Texts)'),
      col('Relief Driver', 'relief', false, 'yesno', 'Yes if the driver fills in on other routes.', 'Driver Master relief_driver', YN),
      col('Hire Date', 'hired', false, 'date', 'Like 10-8-26.', 'Driver Master hire_date'),
      col('Seniority Date', 'seniority', false, 'date', 'Sets the Weekly board order and vacation picks. Blank = hire date.', 'Driver Master seniority_date'),
      col('Board Order', 'boardOrder', false, 'number', 'A number if you want a fixed order on the Weekly board.', 'Driver Master position_order'),
      col('Notes', 'notes', false, 'text', 'Anything dispatch should know (not medical).', 'Driver Master unavailable_reason')
    ], example: ['01234', 'Sample Driver', 'Active', '7245550100', 'No', '3-15-19', '3-15-19', '', ''] },
    { key: 'regularWeek', tab: 'Regular Week', part: 'Drivers', who: 'Dispatch', about: 'One row per driver: the days they work and their regular route each day.', cols: weekCols,
      example: ['01234', 'Off', '', 'Yes', '803 Load 1', 'Yes', '803 Load 1', 'Yes', '803 Load 1', 'Yes', '803 Load 1', 'Yes', '803 Load 1', 'Off', ''] },
    { key: 'daysOff', tab: 'Days Off & Vacations', part: 'Drivers', who: 'Dispatch', about: 'Optional: time off already approved for the coming weeks.', cols: [
      col('Employee ID', 'employeeId', true, 'id', 'Same ID as the Drivers tab.', 'matches the driver'),
      col('Start Date', 'start', true, 'date', 'Like 11-2-26.', 'Vacations / Days Off start_date'),
      col('End Date', 'end', false, 'date', 'Blank = one day.', 'end_date'),
      col('Type', 'type', true, 'choice', 'Vacation, Personal, Sick, Bereavement, Unpaid or Day Off.', 'Vacations vacation_type, or Days Off', ['Vacation', 'Personal', 'Sick', 'Bereavement', 'Unpaid', 'Day Off']),
      col('Status', 'status', false, 'choice', 'Approved or Requested. Blank = Approved.', 'status', ['Approved', 'Requested']),
      col('Notes', 'notes', false, 'text', 'Short note.', 'notes')
    ], example: ['01234', '11-23-26', '11-27-26', 'Vacation', 'Approved', ''] },
    { key: 'lines', tab: 'Lines', part: 'Plant', who: 'Plant manager', about: 'One row per production line or product area (CASES, TANKER).', cols: [
      col('Line Name', 'name', true, 'upper', 'Like GALLON FILLER, HTST #1, BLOW MOLD, BOXING.', 'Plant lines (Quality, line tablet, Line Targets)'),
      col('Kind', 'kind', true, 'choice', 'Decides which boxes Quality and the line tablet show.', 'line type', ['Filler', 'HTST', 'Blow Mold', 'Boxing', 'Totes', 'RAYPAK', 'Product area (no machine)', 'Other']),
      col('Department', 'area', false, 'text', 'Like Production, Processing.', 'production_area'),
      col('Screen Order', 'order', false, 'number', 'A number; lower shows first.', 'view_sequence'),
      col('Counted By', 'counter', false, 'choice', 'How cases or jugs are counted. Blank = Tablet.', 'Line Targets counter', ['Tablet', 'Label reader', 'Sensor', 'Machine controller']),
      col('Changeover Minutes', 'changeoverMin', false, 'number', '', 'Line Targets changeoverMin'),
      col('Wash (CIP) Every Hours', 'cipHours', false, 'number', '', 'cipHours'),
      col('Jug Weight Target (g)', 'jugWeightTarget', false, 'number', 'Fillers only.', 'jugWeightTarget'),
      col('Jug Weight Low (g)', 'jugWeightLow', false, 'number', '', 'jugWeightLow'),
      col('Jug Weight High (g)', 'jugWeightHigh', false, 'number', '', 'jugWeightHigh'),
      col('Empty Jug (g)', 'tareGrams', false, 'number', '', 'tareGrams'),
      col('Cap (g)', 'capGrams', false, 'number', '', 'capGrams'),
      col('Per Box', 'perBox', false, 'number', 'Boxing: units per box.', 'perBox'),
      col('Fed By', 'fedBy', false, 'text', 'Other line names that feed this one, comma between.', 'fedBy')
    ], example: ['GALLON FILLER', 'Filler', 'Production', '10', 'Label reader', '20', '24', '3900', '3880', '3940', '60', '3', '', 'BLOW MOLD'] },
    { key: 'products', tab: 'Products', part: 'Plant', who: 'Plant manager', about: 'One row per product on each line. A product on two lines gets two rows.', cols: [
      col('Line Name', 'line', true, 'upper', 'Same as the Lines tab.', 'Product Sheet machine'),
      col('Product Name', 'name', true, 'upper', 'Like GAL WHOLE MILK.', 'Product Sheet name'),
      col('SKU', 'sku', false, 'text', '', 'sku'),
      col('UPC', 'upc', false, 'upc', '6 to 14 digits (needed for label readers).', 'upc'),
      col('MFG Type', 'mfgType', false, 'text', '', 'mfgType'),
      col('Product Group', 'productGroup', false, 'text', 'Milk, Drinks, Tea, Juice, Mix ...', 'productGroup'),
      col('Rate Per Minute', 'ratePerMin', false, 'number', 'Units per minute at full speed.', 'ratePerMin'),
      col('Target %', 'targetPct', false, 'number', 'Like 85.', 'targetPct'),
      col('Min Speed', 'minSpeed', false, 'number', '', 'minSpeed'),
      col('Max Speed', 'maxSpeed', false, 'number', '', 'maxSpeed'),
      col('Shelf Life Days', 'shelfLifeDays', false, 'number', 'Used to check the code date.', 'shelfLifeDays'),
      col('Fill Weight (g)', 'fillGrams', false, 'number', 'Product weight in grams.', 'fillGrams')
    ], example: ['GALLON FILLER', 'GAL WHOLE MILK', '121001', '070852000013', '', 'Milk', '60', '85', '', '', '17', '3860'] },
    { key: 'machines', tab: 'Machines', part: 'Plant', who: 'Maintenance', about: 'Machines that are not production lines (compressors, boilers, the building).', cols: [
      col('Machine Name', 'name', true, 'upper', '', 'Machinery name'),
      col('Kind', 'kind', true, 'choice', '', 'kind', ['Machine', 'Utility', 'Building', 'Other']),
      col('Department', 'area', false, 'text', '', 'area'), col('Make', 'make', false, 'text', '', 'make'), col('Model', 'model', false, 'text', '', 'model'),
      col('Serial', 'serial', false, 'text', '', 'serial'), col('Location', 'location', false, 'text', '', 'location'),
      col('Installed', 'installed', false, 'date', 'Like 4-1-15.', 'installed'), col('Notes', 'notes', false, 'text', '', 'notes')
    ], example: ['AMMONIA COMPRESSOR 1', 'Utility', 'Engine Room', 'Frick', 'RWB II', '', 'Engine room', '', ''] },
    { key: 'pmTasks', tab: 'PM Tasks', part: 'Plant', who: 'Maintenance', about: 'Planned maintenance for lines and machines.', cols: [
      col('Machine or Line', 'machine', true, 'upper', 'Name from the Lines or Machines tab.', 'PM Schedule machine'),
      col('Task', 'task', true, 'text', 'What to do.', 'task'),
      col('Every', 'every', true, 'number', 'A number.', 'every'),
      col('Unit', 'unit', true, 'choice', '', 'unit', ['Days', 'Weeks', 'Months']),
      col('Last Done', 'lastDone', false, 'date', 'Like 9-1-26.', 'lastDone'),
      col('Notes', 'notes', false, 'text', '', 'notes')
    ], example: ['GALLON FILLER', 'Grease filler valves', '1', 'Months', '9-1-26', ''] },
    { key: 'shifts', tab: 'Shifts', part: 'Plant', who: 'Plant manager', about: 'Optional. Blank = 6:00 AM-2:30 PM, 2:00 PM-10:30 PM, 10:00 PM-5:30 AM.', cols: [
      col('Shift Name', 'name', true, 'text', 'Like 1st Shift.', 'Plant Shifts name'),
      col('Starts', 'start', true, 'time', 'Like 6:00 AM.', 'start'), col('Ends', 'end', true, 'time', 'Like 2:30 PM.', 'end'),
      col('Side', 'side', false, 'choice', '', 'side', ['Production', 'Distribution'])
    ], example: ['1st Shift', '6:00 AM', '2:30 PM', 'Production'] },
    { key: 'coolers', tab: 'Coolers & Temps', part: 'Plant', who: 'Plant manager', about: 'Each spot where a temperature is checked. Pick the MOCREO sensor on the MOCREO page later.', cols: [
      col('Location Name', 'name', true, 'upper', 'Like MAIN COOLER.', 'Temperatures location'),
      col('Area', 'area', false, 'text', '', 'area'),
      col('Low Limit (F)', 'low', false, 'signed', '', 'lowLimit'), col('High Limit (F)', 'high', false, 'signed', '', 'highLimit'),
      col('Screen Order', 'order', false, 'number', '', 'viewSequence')
    ], example: ['MAIN COOLER', 'Cooler', '33', '40', '1'] },
    { key: 'walkAreas', tab: 'Walkthrough Areas', part: 'Plant', who: 'Plant manager', about: 'Areas and sub-areas for the Manager Walkthrough and safety issues.', cols: [
      col('Area', 'area', true, 'text', 'Like Production Floor.', 'Location Areas area'),
      col('Sub-area', 'sub', false, 'text', 'Like Filler Room. One row per sub-area.', 'sub-areas')
    ], example: ['Production Floor', 'Filler Room'] },
    { key: 'safety', tab: 'Safety Checklist', part: 'Plant', who: 'Plant manager', about: 'Items checked on the safety walk.', cols: [
      col('Area', 'area', true, 'text', 'Same names as Walkthrough Areas.', 'Safety checklist area'),
      col('Check Item', 'item', true, 'text', 'Like Exits clear.', 'item'),
      col('How Often', 'freq', true, 'choice', '', 'freq', ['Weekly', 'Monthly'])
    ], example: ['Production Floor', 'Exits clear and lit', 'Weekly'] },
    { key: 'extinguishers', tab: 'Fire Extinguishers', part: 'Plant', who: 'Plant manager', about: 'One row per extinguisher.', cols: [
      col('Tag #', 'tag', true, 'upper', '', 'Extinguishers tag'), col('Location', 'location', true, 'text', '', 'location'),
      col('Type', 'type', false, 'choice', '', 'type', ['ABC', 'BC', 'CO2', 'K (kitchen)', 'Water', 'D (metal)']),
      col('Size', 'size', false, 'text', 'Like 10 lb.', 'size'),
      col('Annual Due', 'annualDue', false, 'date', 'Like 3-1-27.', 'annualDue'), col('6-Year Due', 'sixYearDue', false, 'date', '', 'sixYearDue'), col('Hydro Due', 'hydroDue', false, 'date', '', 'hydroDue')
    ], example: ['FE-01', 'Dock door 1', 'ABC', '10 lb', '3-1-27', '', ''] },
    { key: 'suppliers', tab: 'Receiving Suppliers', part: 'Plant', who: 'Plant manager', about: 'Places the plant gets things from.', cols: [
      col('Supplier Name', 'name', true, 'upper', '', 'Receiving > Suppliers name'), col('Short Name', 'short', false, 'text', '', 'short name')
    ], example: ['DAIRY INGREDIENT', 'Dairy Ingredient'] },
    { key: 'receivingItems', tab: 'Receiving Items', part: 'Plant', who: 'Plant manager', about: 'Optional: items received, with their barcodes.', cols: [
      col('Item Name', 'name', true, 'upper', '', 'Inventory item name'), col('Barcodes', 'barcodes', false, 'text', 'Comma between.', 'barcodes')
    ], example: ['GALLON CAPS WHITE', ''] },
    { key: 'people', tab: 'People', part: 'People and Email', who: 'Office', about: 'One row per person who signs in with a United Dairy email.', cols: [
      col('Name', 'name', true, 'text', '', 'Users Master Display Name'),
      col('Email', 'email', true, 'udEmail', 'Must end in @uniteddairy.com.', 'Users Master Email'),
      col('Role', 'role', true, 'choice', '', 'Users Master Roles JSON', ROLES),
      col('Plants', 'plants', true, 'choice', 'This plant only, or All plants.', 'Users Master Facility IDs JSON', ['This plant', 'All plants']),
      col('Active', 'active', true, 'yesno', '', 'Users Master Status', YN)
    ], example: ['Sample Manager', 'sample.manager@uniteddairy.com', 'Manager', 'This plant', 'Yes'] },
    { key: 'garageTechs', tab: 'Garage Technicians', part: 'People and Email', who: 'Garage', about: 'The garage mechanics. Each one types their own login number on Fleet Service Setup; it is never put in a file.', cols: [
      col('Technician Name', 'name', true, 'upper', 'First and last name.', 'Garage Technicians name'),
      col('Active', 'active', true, 'yesno', 'Yes or No.', 'active', YN)
    ], example: ['Sample Mechanic', 'Yes'] },
    { key: 'recipients', tab: 'Report Recipients', part: 'People and Email', who: 'Office', about: 'Who gets the shift report email. The app sends to the group called Plant Managers.', cols: [
      col('Group', 'group', true, 'text', 'Plant Managers unless you add another group.', 'Report Recipients group'),
      col('Email', 'email', true, 'email', '', 'recipients')
    ], example: ['Plant Managers', 'plantmgmt@uniteddairy.com'] },
    { key: 'stations', tab: 'Stations', part: 'People and Email', who: 'Office', about: 'Tablets and TVs at the plant. Codes are made on Administration > Station Codes, never in a file.', cols: [
      col('Station Name', 'name', true, 'text', 'Like Dock 1 Tablet.', 'Station Codes name'),
      col('Kind', 'kind', true, 'choice', '', 'kind + type', ['Case Loadout', 'Case Unloading', 'Totes', 'Boxing', 'Yard Services', 'Garage', 'Driver Room Check-In', "Driver's Kiosk TV"])
    ], example: ['Dock 1 Tablet', 'Case Loadout'] },
    { key: 'plantEmail', tab: 'Plant Email', part: 'People and Email', who: 'Office', about: 'One row: who the plant\'s emails come from and the driver check-in email.', cols: [
      col('Send From Email', 'fromEmail', false, 'udEmail', 'A real @uniteddairy.com mailbox.', 'Email Senders address'),
      col('Send From Name', 'fromName', false, 'text', '', 'Email Senders name'),
      col('Check-In Email From', 'checkinFrom', false, 'email', 'Who sends the driver check-in email.', 'Driver Check-In Email sender'),
      col('Check-In Email To', 'checkinTo', false, 'email', 'Mailbox it arrives in.', 'recipient'),
      col('Check-In Subject', 'checkinSubject', false, 'text', 'Like CHARLESTON DRIVER CHECK IN.', 'subject')
    ], example: ['plantmgmt@uniteddairy.com', 'United Dairy Charleston', 'callcenter@lauttamus.com', 'drivercheckin@uniteddairy.com', 'CHARLESTON DRIVER CHECK IN'] }
  ];
  var PARTS = ['Routes', 'Drivers', 'Plant', 'People and Email'];
  var BY_KEY = {};
  SPEC.forEach(function (t) { BY_KEY[t.key] = t; });

  function text(v) { return v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim(); }
  function upper(v) { return text(v).toUpperCase(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function heading(h) { return upper(h).replace(/\s*\*\s*$/, '').replace(/\s+/g, ' '); }
  // Words a column heading must never have: this app keeps no Social Security numbers, birth dates or home addresses.
  var PII = /\b(SSN|SOCIAL|SOC SEC|BIRTH|DOB|D\.O\.B|ADDRESS|STREET|ZIP)\b/;

  // The same Employee ID with or without leading zeros (Joe 10/17).
  function idKey(v) { var t = upper(v).replace(/\s+/g, ''); return t.replace(/^0+(?=.)/, ''); }
  function loadName(v) {
    var t = text(v), m = /^(?:(load|run)\s*)?#?\s*(\d+)$/i.exec(t);
    if (m) return (m[1] && m[1].toLowerCase() === 'run' ? 'Run ' : 'Load ') + Number(m[2]);
    return t;
  }
  function routeKey(route, load) { return upper(route) + '|' + upper(loadName(load)).replace(/\s+/g, ''); }
  // "803 Load 1", "803 1", "803-1" -> {route, load}
  function splitRouteLoad(v) {
    var t = text(v), m = /^([A-Za-z0-9]+)[\s\-_]+(.+)$/.exec(t);
    return m ? { route: m[1], load: loadName(m[2]) } : { route: t, load: '' };
  }

  // Each kind's reading of a cell: { v } or { bad: 'why' }. Blank is always { v: '' }.
  function dateOf(t) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t), y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/.exec(t))) { mo = +m[1]; d = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
    else if (/^\d{5}(\.\d+)?$/.test(t)) { var dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86400000); y = dt.getUTCFullYear(); mo = dt.getUTCMonth() + 1; d = dt.getUTCDate(); }
    else return null;
    var check = new Date(Date.UTC(y, mo - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || y < 1950 || y > 2100) return null;
    return y + '-' + pad(mo) + '-' + pad(d);
  }
  function timeOf(t) {
    var m = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([AaPp])\.?\s*[Mm]?\.?$/.exec(t), h, mi;
    if (m) { h = +m[1]; mi = +(m[2] || 0); if (h < 1 || h > 12) return null; h = h % 12 + (/[Pp]/.test(m[3]) ? 12 : 0); }
    else if ((m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t))) { h = +m[1]; mi = +m[2]; }
    else if ((m = /^(\d{2})(\d{2})$/.exec(t))) { h = +m[1]; mi = +m[2]; }
    else if (/^0?\.\d+$/.test(t)) { var mins = Math.round(Number(t) * 1440); h = Math.floor(mins / 60) % 24; mi = mins % 60; }
    else return null;
    if (h > 23 || mi > 59) return null;
    return pad(h) + ':' + pad(mi);
  }
  function choiceOf(t, list) {
    var u = upper(t), hit = null;
    list.forEach(function (c) { if (!hit && upper(c) === u) hit = c; });
    if (!hit) list.forEach(function (c) { if (!hit && upper(c).replace(/[^A-Z0-9]/g, '') === u.replace(/[^A-Z0-9]/g, '')) hit = c; });
    return hit;
  }
  function read(c, raw) {
    var t = text(raw);
    if (!t) return { v: '' };
    switch (c.kind) {
      case 'upper': return { v: upper(t) };
      case 'code': return /^[A-Za-z0-9 _\-#.]{1,20}$/.test(t) ? { v: upper(t) } : { bad: 'use letters and numbers only (up to 20)' };
      case 'id': return /^[A-Za-z0-9\-]{1,20}$/.test(t) ? { v: upper(t) } : { bad: 'use letters and numbers only' };
      case 'load': return { v: loadName(t) };
      case 'yesno': { var y = upper(t); if (/^(YES|Y|TRUE|X|1)$/.test(y)) return { v: 'Yes' }; if (/^(NO|N|FALSE|0)$/.test(y)) return { v: 'No' }; return { bad: 'type Yes or No' }; }
      case 'works': { var w = upper(t); if (/^(YES|Y|TRUE|X|1|WORKS)$/.test(w)) return { v: 'Yes' }; if (/^(OFF|NO|N|FALSE|0)$/.test(w)) return { v: 'Off' }; return { bad: 'type Yes or Off' }; }
      case 'choice': { var ch = choiceOf(t, c.choices || []); return ch ? { v: ch } : { bad: 'pick one of: ' + c.choices.join(', ') }; }
      case 'date': { var d = dateOf(t); return d ? { v: d } : { bad: 'write dates like 10-8-26' }; }
      case 'time': { var tm = timeOf(t); return tm ? { v: tm } : { bad: 'write times like 4:00 AM' }; }
      case 'hours': {
        var hm = /^(\d{1,2}):([0-5]\d)$/.exec(t);
        if (hm) return { v: Number(hm[1]) + ':' + hm[2] };
        return /^\d{1,2}(\.\d+)?$/.test(t) && Number(t) <= 24 ? { v: String(Number(t)) } : { bad: 'write hours like 9:30 or 9.5' };
      }
      case 'number': { var n = t.replace(/,/g, ''); return /^\d+(\.\d+)?$/.test(n) ? { v: String(Number(n)) } : { bad: 'type a number' }; }
      case 'signed': { var s = t.replace(/,/g, ''); return /^-?\d+(\.\d+)?$/.test(s) ? { v: String(Number(s)) } : { bad: 'type a number' }; }
      case 'phone': { var p = t.replace(/\D+/g, '').replace(/^1(?=\d{10}$)/, ''); return p.length === 10 ? { v: p } : { bad: 'type the 10-digit number' }; }
      case 'upc': { var u = t.replace(/\D+/g, ''); return u.length >= 6 && u.length <= 14 ? { v: u } : { bad: 'a UPC is 6 to 14 digits' }; }
      case 'email': return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(t) ? { v: t.toLowerCase() } : { bad: 'not an email address' };
      case 'udEmail': return /^[^\s@]+@uniteddairy\.com$/i.test(t) ? { v: t.toLowerCase() } : { bad: 'must end in @uniteddairy.com' };
      case 'routeLoad': { var rl = splitRouteLoad(t); return rl.load ? { v: rl.route.toUpperCase() + ' ' + rl.load } : { bad: 'write the route and load, like 803 Load 1' }; }
      default: return t.length > 300 ? { bad: 'too long (300 letters at most)' } : { v: t };
    }
  }

  // A row's key in its tab (same key = same row, saved or in the file) and the words that name it on the check screen.
  function keyOf(tab, r) {
    switch (tab) {
      case 'routes': return routeKey(r.route, r.load);
      case 'routeDays': return routeKey(r.route, r.load) + '|' + upper(r.day);
      case 'drivers': case 'regularWeek': return idKey(r.employeeId);
      case 'daysOff': return idKey(r.employeeId) + '|' + r.start + '|' + upper(r.type);
      case 'products': return upper(r.line) + '|' + upper(r.name);
      case 'pmTasks': return upper(r.machine) + '|' + upper(r.task);
      case 'walkAreas': return upper(r.area) + '|' + upper(r.sub);
      case 'safety': return upper(r.area) + '|' + upper(r.item);
      case 'extinguishers': return upper(r.tag);
      case 'people': return text(r.email).toLowerCase();
      case 'recipients': return upper(r.group) + '|' + text(r.email).toLowerCase();
      case 'plantEmail': return 'PLANT';
      default: return upper(r.name);
    }
  }
  function labelOf(tab, r) {
    switch (tab) {
      case 'routes': return r.route + ' ' + r.load + (r.name ? ' · ' + r.name : '');
      case 'routeDays': return r.route + ' ' + r.load + ' · ' + r.day;
      case 'drivers': return r.name + (r.employeeId ? ' (' + r.employeeId + ')' : '');
      case 'regularWeek': return 'Employee ID ' + r.employeeId;
      case 'daysOff': return r.employeeId + ' · ' + r.type + ' ' + r.start;
      case 'products': return r.name + ' on ' + r.line;
      case 'pmTasks': return r.machine + ': ' + r.task;
      case 'walkAreas': return r.area + (r.sub ? ' > ' + r.sub : '');
      case 'safety': return r.area + ': ' + r.item;
      case 'extinguishers': return r.tag + ' · ' + r.location;
      case 'people': return r.name + ' (' + r.email + ')';
      case 'recipients': return r.group + ': ' + r.email;
      case 'plantEmail': return 'Plant email';
      default: return r.name || '';
    }
  }

  // The file's tabs ([{name, cells: rows of cells, first row the headings}]) as {tabs: {key: {...}}, extra: [names]}.
  function readBook(sheets) {
    var out = { tabs: {}, extra: [] }, byName = {};
    SPEC.forEach(function (t) { byName[upper(t.tab)] = t; });
    (sheets || []).forEach(function (s) {
      var t = byName[upper(s.name)];
      if (!t) { if (upper(s.name) !== 'HOW TO FILL') out.extra.push(text(s.name)); return; }
      var cells = (s.cells || []).filter(function (r) { return Array.isArray(r); });
      var head = (cells[0] || []).map(heading), at = {}, missing = [], unknown = [], pii = [];
      head.forEach(function (h, i) { if (h && h !== upper(t.about) && PII.test(h)) pii.push(text(cells[0][i]).replace(/\s*\*\s*$/, '')); });
      t.cols.forEach(function (c) { var i = head.indexOf(upper(c.h)); if (i >= 0) at[c.key] = i; else if (c.req) missing.push(c.h); });
      head.forEach(function (h, i) {
        if (!h || h === upper(t.about) || pii.indexOf(text(cells[0][i]).replace(/\s*\*\s*$/, '')) >= 0) return;
        if (!t.cols.some(function (c) { return upper(c.h) === h; })) unknown.push(text(cells[0][i]));
      });
      var ex = t.example.map(upper).join('|'), rows = [], exampleSkipped = false;
      cells.slice(1).forEach(function (r, i) {
        var raw = {}, any = false;
        t.cols.forEach(function (c) { var v = at[c.key] === undefined ? '' : text(r[at[c.key]]); raw[c.key] = v; if (v) any = true; });
        if (!any) return;
        if (t.cols.map(function (c) { return upper(raw[c.key]); }).join('|') === ex) { exampleSkipped = true; return; }
        rows.push({ n: i + 2, raw: raw });
      });
      // A heading the tab does not have (other than the tab's own note beside the headings) is said on the check screen.
      out.tabs[t.key] = { key: t.key, tab: t.tab, rows: rows, missing: missing, unknown: unknown, pii: pii, exampleSkipped: exampleSkipped };
    });
    return out;
  }

  // book: readBook's result; saved: {tabKey: [saved rows]}. The check screen's rows, counts and the problems.
  function check(book, saved) {
    var sv = saved || {}, res = { tabs: {}, totals: { NEW: 0, CHANGED: 0, SAME: 0, OFF: 0, PROBLEM: 0 }, tabProblems: [], extra: (book && book.extra) || [] };
    var filled = {};
    // First pass: each filled tab's rows read.
    SPEC.forEach(function (t) {
      var b = book && book.tabs[t.key];
      if (!b) return;
      var tp = [];
      if (b.pii.length) tp.push('Take out the ' + b.pii.join(', ') + ' column' + (b.pii.length > 1 ? 's' : '') + '. This app never keeps Social Security numbers, birth dates or home addresses.');
      if (b.missing.length) tp.push('Missing column' + (b.missing.length > 1 ? 's' : '') + ': ' + b.missing.join(', ') + '. Download the workbook again and keep its headings.');
      if (b.rows.length > MAX_ROWS) tp.push('Too many rows (' + b.rows.length + '); ' + MAX_ROWS + ' at most.');
      if (!b.rows.length && !tp.length) return;
      var rows = b.rows.slice(0, MAX_ROWS).map(function (r) {
        var vals = {}, problems = [];
        t.cols.forEach(function (c) {
          var got = read(c, r.raw[c.key]);
          if (got.bad) { problems.push(c.h + ': ' + got.bad + ' ("' + text(r.raw[c.key]).slice(0, 40) + '")'); vals[c.key] = text(r.raw[c.key]); }
          else { vals[c.key] = got.v; if (c.req && !got.v) problems.push(c.h + ' is blank'); }
        });
        return { n: r.n, values: vals, problems: problems };
      });
      filled[t.key] = { t: t, rows: rows, tabProblems: tp, b: b };
    });
    // What each tab holds after this upload: the file's rows when the tab is filled, else what is saved.
    function now(key) { return filled[key] ? filled[key].rows.map(function (r) { return r.values; }) : (sv[key] || []); }
    var routeSet = {}, driverSet = {}, lineSet = {}, machineSet = {}, areaSet = {};
    now('routes').forEach(function (r) { routeSet[routeKey(r.route, r.load)] = 1; });
    now('drivers').forEach(function (r) { driverSet[idKey(r.employeeId)] = 1; });
    now('lines').forEach(function (r) { lineSet[upper(r.name)] = 1; machineSet[upper(r.name)] = 1; });
    now('machines').forEach(function (r) { machineSet[upper(r.name)] = 1; });
    now('walkAreas').forEach(function (r) { areaSet[upper(r.area)] = 1; });
    var anyRoutes = Object.keys(routeSet).length > 0, anyLines = Object.keys(lineSet).length > 0, anyAreas = Object.keys(areaSet).length > 0;

    SPEC.forEach(function (t) {
      var f = filled[t.key];
      if (!f) return;
      var seen = {}, out = [];
      f.rows.forEach(function (r) {
        var v = r.values, p = r.problems.slice(), k = keyOf(t.key, v);
        if (!p.length) {
          if (seen[k]) p.push('Same as row ' + seen[k] + ' (each ' + (t.key === 'drivers' || t.key === 'regularWeek' ? 'Employee ID' : 'row') + ' once)');
          else seen[k] = r.n;
          if (t.key === 'routeDays' && anyRoutes && !routeSet[routeKey(v.route, v.load)]) p.push('Route ' + v.route + ' ' + v.load + ' is not on the Routes tab');
          if (t.key === 'regularWeek') {
            if (!driverSet[idKey(v.employeeId)]) p.push('Employee ID ' + v.employeeId + ' is not on the Drivers tab');
            DAYS.forEach(function (d) {
              var k2 = d.toLowerCase(), rt = v[k2 + 'Route'];
              if (!rt) return;
              if (v[k2 + 'Works'] === 'Off') p.push(d + ': has a route but is Off');
              var s = splitRouteLoad(rt);
              if (!routeSet[routeKey(s.route, s.load)]) p.push(d + ': route ' + rt + ' is not on the Routes tab');
            });
          }
          if (t.key === 'daysOff') {
            if (!driverSet[idKey(v.employeeId)]) p.push('Employee ID ' + v.employeeId + ' is not on the Drivers tab');
            if (v.end && v.start && v.end < v.start) p.push('End Date is before Start Date');
          }
          if (t.key === 'products' && anyLines && !lineSet[upper(v.line)]) p.push('Line ' + v.line + ' is not on the Lines tab');
          if (t.key === 'pmTasks' && !machineSet[upper(v.machine)]) p.push(v.machine + ' is not on the Lines or Machines tab');
          if (t.key === 'pmTasks' && v.every && (Number(v.every) < 1 || Number(v.every) > 999)) p.push('Every: 1 to 999');
          if (t.key === 'safety' && anyAreas && !areaSet[upper(v.area)]) p.push('Area ' + v.area + ' is not on the Walkthrough Areas tab');
          if (t.key === 'coolers' && v.low !== '' && v.high !== '' && Number(v.low) > Number(v.high)) p.push('Low Limit is above High Limit');
          if (t.key === 'lines' && v.jugWeightLow && v.jugWeightHigh && Number(v.jugWeightLow) > Number(v.jugWeightHigh)) p.push('Jug Weight Low is above High');
          if (t.key === 'products' && v.targetPct && Number(v.targetPct) > 100) p.push('Target % is over 100');
          if (t.key === 'plantEmail' && out.length) p.push('Only one row on this tab');
        }
        var before = null;
        (sv[t.key] || []).some(function (s) { if (keyOf(t.key, s) === k) { before = s; return true; } return false; });
        var changes = [];
        if (before) t.cols.forEach(function (c) { if (text(before[c.key]) !== text(v[c.key])) changes.push({ col: c.h, from: text(before[c.key]), to: text(v[c.key]) }); });
        var status = p.length ? 'PROBLEM' : !before ? 'NEW' : changes.length ? 'CHANGED' : 'SAME';
        out.push({ n: r.n, key: k, label: labelOf(t.key, v), status: status, problems: p, changes: changes, values: v });
      });
      var inFile = {};
      out.forEach(function (r) { inFile[r.key] = 1; });
      var off = (sv[t.key] || []).filter(function (s) { return !inFile[keyOf(t.key, s)]; }).map(function (s) { return { key: keyOf(t.key, s), label: labelOf(t.key, s), status: 'OFF', problems: [], changes: [], values: s }; });
      var counts = { NEW: 0, CHANGED: 0, SAME: 0, OFF: off.length, PROBLEM: 0 };
      out.forEach(function (r) { counts[r.status]++; });
      f.tabProblems.forEach(function (msg) { counts.PROBLEM++; res.tabProblems.push({ tab: t.tab, message: msg }); });
      Object.keys(counts).forEach(function (s) { res.totals[s] += counts[s]; });
      res.tabs[t.key] = { key: t.key, tab: t.tab, part: t.part, rows: out, off: off, counts: counts, tabProblems: f.tabProblems, unknown: f.b.unknown, exampleSkipped: f.b.exampleSkipped };
    });
    res.ok = res.totals.PROBLEM === 0 && Object.keys(res.tabs).length > 0;
    return res;
  }

  // What is saved for each filled tab once the check passed: the file's rows, in the file's order.
  function toSave(result) {
    var out = {};
    Object.keys(result.tabs).forEach(function (k) { out[k] = result.tabs[k].rows.map(function (r) { return r.values; }); });
    return out;
  }

  return { SPEC: SPEC, PARTS: PARTS, BY_KEY: BY_KEY, DAYS: DAYS, ROLES: ROLES, MAX_ROWS: MAX_ROWS, read: read, readBook: readBook, check: check, toSave: toSave,
    keyOf: keyOf, labelOf: labelOf, idKey: idKey, routeKey: routeKey, loadName: loadName, splitRouteLoad: splitRouteLoad, dateOf: dateOf, timeOf: timeOf };
});
