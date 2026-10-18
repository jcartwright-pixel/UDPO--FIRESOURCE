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
  // The app's own lists, copied exactly (functions/test/unit/upload-rules.test.js checks each against the app's file):
  // actions.js EXCEPTION_REASONS and VACATION_STATUSES; stations.js KINDS (every station type's name); plant-reports.js
  // SHIFT_SIDES; production-rules.js COUNTER_LABEL (the words before any bracket) and FILL_MODES; products.js START_TYPES and
  // its group list (START_GROUPS with JOE_GROUPS added); routes.html LOADOUT and RUN_BY.
  var EXCEPTION_REASONS = ['SICK DAY', 'BEREAVEMENT', 'PERSONAL DAY', 'UNPAID DAY', 'VACATION', 'CALLED OFF', 'OFF', 'OTHER'];
  var VACATION_STATUSES = ['APPROVED', 'PENDING', 'DENIED', 'CANCELLED'];
  var STATION_KINDS = ['Case Loadout', 'Case Unloading', 'Tote Loadout', 'Boxing Loadout', 'Yard Services', 'Garage', 'Driver Room Check-In Station', "Driver's Kiosk Station", 'Plant Managers'];
  var SHIFT_SIDES = [['DISTRIBUTION', 'Distribution'], ['PRODUCTION', 'Plant Production']];
  var COUNTED_BY = ['Typed by operator', 'Sensor', 'Label reader', 'Machine controller'];
  var FILL_MODES = ['Every so many minutes', 'Every so many jugs', 'Only at the start and after each product change'];
  var PRODUCT_TYPES = ['Gallon', 'Half Gallon', 'Quart', 'Pint', '2.5 Gallon', '5 Gallon', 'TOTE'];
  var PRODUCT_GROUPS = ['Milk', 'Drinks', 'TEA', 'Mix', 'Juice'];
  var LOAD_TYPES = ['None', 'Case Loadout', 'Tote', 'Boxing', 'Tanker'];
  var RUN_BY = ['Uniontown', 'Fairmont', 'Marietta', 'Charleston', 'Martins Ferry', 'Carrier', 'Anyone'];
  // Route Days' Loaded: the app's load day offset, 0 (same day) to -6 (Route Master <day>_load_day_offset; actions-routes.js).
  var LOADED = ['Same day', 'Day before', '2 days before', '3 days before', '4 days before', '5 days before', '6 days before'];

  // [heading, field, must fill, kind, what to type, where it goes, choices, more]. more (all optional): max (text: most letters),
  // upTo / lo (numbers: highest and lowest), whole (whole numbers only), when (must fill only then, in words, checked in check),
  // pattern + patternWhy (the cell must match), multi (choices: several, comma between).
  function col(h, key, req, kind, what, goes, choices, more) {
    var o = more || {}, c = { h: h, key: key, req: !!req, kind: kind || 'text', what: what || '', goes: goes || '', choices: choices || null };
    ['max', 'upTo', 'lo', 'whole', 'when', 'pattern', 'patternWhy', 'multi'].forEach(function (k) { if (o[k] !== undefined) c[k] = o[k]; });
    return c;
  }

  var weekCols = [col('Employee ID', 'employeeId', true, 'id', 'Same ID as the Drivers tab.', 'matches the driver')];
  DAYS.forEach(function (d) {
    var k = d.toLowerCase();
    weekCols.push(col(d + ' Works', k + 'Works', false, 'works', 'Yes, or Off for a regular day off. A Relief Driver may leave it blank.', 'Driver Master ' + k + '_available', ['Yes', 'Off'], { when: 'Unless Relief Driver is Yes' }));
    weekCols.push(col(d + ' Route', k + 'Route', false, 'routeLoads', 'Route and load, like 803 Load 1. Two or more runs that day: put ; between (803 Load 1; 812 Load 2). Blank if they float.', 'Driver Master ' + k + '_assignments_json (one or more runs)'));
  });

  var SPEC = [
    { key: 'routes', tab: 'Routes', part: 'Routes', who: 'Dispatch', about: 'One row per route and load (803 Load 1 and 803 Load 2 are two rows).', cols: [
      col('Route #', 'route', true, 'code', 'The route number, like 803.', 'Route Master route'),
      col('Load', 'load', true, 'load', 'Load 1, Load 2 ... (or Run 1). The app calls it the Run Type.', 'Route Master route_run_type (Run Type)', null, { max: 40 }),
      col('Customer / Route Name', 'name', true, 'text', 'What the route is called, like DSD or SAVE-A-LOT.', 'Route Master route_name', null, { max: 80 }),
      col('Run / Destination', 'run', false, 'text', 'This run\'s own name or destination, like Product. Blank = the route name shows.', 'Route Master run (Run / Destination)', null, { max: 80 }),
      col('Stream ID', 'stream', false, 'text', 'Name on the Driver Room board and driver schedule if different, like SAVE-A-LOT 1.', 'Route Master stream_id', null, { max: 80 }),
      col('Run Code', 'code', false, 'code', 'Which run of the route, e.g. 6301_1. Blank = made by the app.', 'Route Master route_code'),
      col('Load Type', 'loadType', false, 'choice', 'How it is loaded. Blank = None.', 'Route Master load_type', LOAD_TYPES),
      col('Who Runs It', 'runBy', false, 'choice', 'United Dairy driver, a branch, an outside carrier or a customer pickup. Blank = United Dairy (UNITED DAIRY).', 'Route Master movement_type + coverage_type', ['United Dairy', 'Branch', 'Outside Carrier', 'Customer Pickup']),
      col('Carrier Name', 'carrier', false, 'upper', 'Outside Carrier only: the carrier\'s name.', 'Route Master coverage_type (the carrier)', null, { max: 80 }),
      col('Run By', 'owner', false, 'choice', 'Which location covers it.', 'Route Master coverage_owner', RUN_BY),
      col('Leaves On', 'leaves', false, 'choice', 'Delivery Day or Load Day.', 'Route Master departure_day', ['Delivery Day', 'Load Day']),
      col('Drop and Hook', 'dropHook', false, 'yesno', 'Yes if the trailer is dropped.', 'Route Master drop_and_hook', YN),
      col('Sleeper', 'sleeper', false, 'yesno', 'Yes if the run needs a sleeper truck.', 'Route Master sleeper', YN),
      col('Weekly Board Order', 'boardOrder', false, 'number', 'A number; lower shows higher on Weekly Dispatch.', 'Route Master route_week_display'),
      col('Show on Daily', 'showDaily', false, 'yesno', 'Show on Daily Dispatch. Blank = Yes.', 'display_daily_dispatch', YN),
      col('Show on Weekly', 'showWeekly', false, 'yesno', 'Show on Weekly Dispatch. Blank = Yes.', 'display_weekly_dispatch', YN),
      col('Show on Plant Loading', 'showPlant', false, 'yesno', 'Show on Loadout and the Scheduler. Blank = Yes.', 'display_plant_distribution', YN),
      col('Show on Driver Phone', 'showPhone', false, 'yesno', 'Show on the driver phone. Blank = Yes.', 'display_mobile_route', YN),
      col('Show in Route List', 'showList', false, 'yesno', 'Show in the Route Editor\'s route list. Blank = Yes.', 'display_route_master', YN),
      col('Status', 'status', false, 'choice', 'Active or Inactive. Blank = Active (ACTIVE).', 'Route Master route_status + active', ['Active', 'Inactive']),
      col('Notes', 'notes', false, 'text', 'Anything about the route.', 'Route Master route_notes')
    ], example: ['803', 'Load 1', 'DSD', '', '', '', 'Case Loadout', 'United Dairy', '', 'Charleston', 'Delivery Day', 'No', 'No', '51', 'Yes', 'Yes', 'Yes', 'Yes', 'Yes', 'Active', ''] },
    { key: 'routeDays', tab: 'Route Days', part: 'Routes', who: 'Dispatch', about: 'One row per route, load and day it runs. Days it does not run can be left out.', cols: [
      col('Route #', 'route', true, 'code', 'Same as the Routes tab.', 'matches the route'),
      col('Load', 'load', true, 'load', 'Same as the Routes tab.', 'matches the route'),
      col('Day', 'day', true, 'choice', 'Delivery day.', 'Route Master <day>_ columns', DAYS),
      col('Runs', 'runs', true, 'yesno', 'Yes if it runs that day.', '<day>_active', YN),
      col('Dispatch Time', 'time', false, 'time', 'Like 4:00 AM. Must fill when Runs is Yes.', '<day>_dispatch_time', null, { when: 'When Runs is Yes' }),
      col('Load Order', 'loadOrder', false, 'number', 'Number in the loading line-up.', '<day>_load_order'),
      col('Round Trip Miles', 'miles', false, 'number', 'Whole miles.', '<day>_miles'),
      col('Route Hours', 'hours', false, 'hours', 'Like 9:30 or 9.5.', '<day>_expected_route_hours'),
      col('Loaded', 'loaded', false, 'offset', 'Which day it is loaded: Same day (0), Day before (-1), up to 6 days before (-6). You can type 0 to -6. Must fill when Runs is Yes.', '<day>_load_day_offset (0 to -6)', LOADED, { when: 'When Runs is Yes' }),
      col('Notes', 'notes', false, 'text', 'Note for that day.', '<day>_notes')
    ], example: ['803', 'Load 1', 'Mon', 'Yes', '4:00 AM', '109', '190', '12', 'Day before', ''] },
    { key: 'drivers', tab: 'Drivers', part: 'Drivers', who: 'Dispatch', about: 'One row per driver. Never Social Security numbers, birth dates or home addresses.', cols: [
      col('Employee ID', 'employeeId', true, 'id', 'Payroll / Enterprise ID. Leading zeros are fine.', 'Driver Master employee_id (also the phone sign-in)'),
      col('Driver Name', 'name', true, 'text', 'First and last name, the way dispatch says it.', 'Driver Master name', null, { max: 120 }),
      col('Status', 'status', true, 'choice', 'Active or Inactive.', 'Driver Master status', ['Active', 'Inactive']),
      col('Cell Phone', 'phone', false, 'phone', '10 digits. One number per driver: the mobile Schedule Texts go to.', 'Driver Roster mobile phone (driverPhones, Schedule Texts)'),
      col('Relief Driver', 'relief', false, 'yesno', 'Yes if the driver fills in on other routes.', 'Driver Master relief_driver', YN),
      col('Hire Date', 'hired', false, 'date', 'Like 10-8-26.', 'Driver Master hire_date'),
      col('Seniority Date', 'seniority', false, 'date', 'Sets the Weekly board order and vacation picks. Blank = hire date.', 'Driver Master seniority_date'),
      col('Board Order', 'boardOrder', false, 'number', 'A number if you want a fixed order on the Weekly board.', 'Driver Master position_order')
    ], example: ['01234', 'Sample Driver', 'Active', '7245550100', 'No', '3-15-19', '3-15-19', ''] },
    { key: 'regularWeek', tab: 'Regular Week', part: 'Drivers', who: 'Dispatch', about: 'One row per driver: the days they work and their regular runs each day.', cols: weekCols,
      example: ['01234', 'Off', '', 'Yes', '803 Load 1', 'Yes', '803 Load 1', 'Yes', '803 Load 1', 'Yes', '803 Load 1', 'Yes', '803 Load 1', 'Off', ''] },
    { key: 'daysOff', tab: 'Days Off & Vacations', part: 'Drivers', who: 'Dispatch', about: 'Optional: time off already approved for the coming weeks.', cols: [
      col('Employee ID', 'employeeId', true, 'id', 'Same ID as the Drivers tab.', 'matches the driver'),
      col('Start Date', 'start', true, 'date', 'Like 11-2-26.', 'Vacations / Days Off start_date'),
      col('End Date', 'end', false, 'date', 'Blank = one day. At most a year after the start.', 'end_date'),
      col('Type', 'type', true, 'choice', 'The app\'s reasons. VACATION goes on the Vacation Schedule; the others are days off.', 'Days Off reason (VACATION: Vacations)', EXCEPTION_REASONS),
      col('Status', 'status', false, 'choice', 'Blank = APPROVED.', 'Vacations status', VACATION_STATUSES),
      col('Notes', 'notes', false, 'text', 'Short note.', 'notes')
    ], example: ['01234', '11-23-26', '11-27-26', 'VACATION', 'APPROVED', ''] },
    { key: 'lines', tab: 'Lines', part: 'Plant', who: 'Plant manager', about: 'One row per production line or product area (CASES, TANKER). The app knows the kind of line from its name: HTST..., BLOW MOLD, BOXING / RAYPAK / TOTES, and any other name is a filler.', cols: [
      col('Line Name', 'name', true, 'upper', 'Like GALLON FILLER, HTST #1, BLOW MOLD, BOXING. The name decides which boxes Quality and the line tablet show.', 'Plant lines (Quality, line tablet, Line Targets)', null, { max: 60 }),
      col('Department', 'area', false, 'text', 'Like Production, Processing.', 'production_area', null, { max: 60 }),
      col('Screen Order', 'order', false, 'number', 'A number; lower shows first.', 'view_sequence'),
      col('Counted By', 'counter', false, 'choice', 'How cases or jugs are counted. Blank = Typed by operator.', 'Line Targets counter', COUNTED_BY),
      col('Changeover Minutes', 'changeoverMin', false, 'number', 'The changeover standard, 0 to 600.', 'Line Targets changeoverMin', null, { upTo: 600 }),
      col('Wash (CIP) Every Hours', 'cipHours', false, 'number', 'Hours between CIP washes, 0 to 72.', 'cipHours', null, { upTo: 72 }),
      col('Jug Weight Target (g)', 'jugWeightTarget', false, 'number', 'BLOW MOLD only: the empty jug it makes, 0 to 500 g.', 'jugWeightTarget (Blow Mold)', null, { upTo: 500 }),
      col('Jug Weight Low (g)', 'jugWeightLow', false, 'number', 'BLOW MOLD only: lightest jug, 0 to 500 g.', 'jugWeightLow (Blow Mold)', null, { upTo: 500 }),
      col('Jug Weight High (g)', 'jugWeightHigh', false, 'number', 'BLOW MOLD only: heaviest jug, 0 to 500 g.', 'jugWeightHigh (Blow Mold)', null, { upTo: 500 }),
      col('Fill Check Due', 'fillEvery', false, 'choice', 'Fillers (and RAYPAK / BOXING bags): when the fill weight check is due. Blank = every 2 hours.', 'Line Targets fillEvery', FILL_MODES),
      col('Fill Check Every', 'fillEveryN', false, 'number', 'With Every so many minutes or jugs: how many, 0 to 100000.', 'fillEveryN', null, { upTo: 100000 }),
      col('Empty Jug (g)', 'tareGrams', false, 'number', 'Fillers: the empty jug (or bag), 0 to 2000 g.', 'tareGrams', null, { upTo: 2000 }),
      col('Cap (g)', 'capGrams', false, 'number', 'Fillers: the cap (or fitment), 0 to 200 g.', 'capGrams', null, { upTo: 200 }),
      col('Light When Under By (g)', 'fillUnder', false, 'number', 'Fillers: flag LIGHT when under the product\'s target by this, 0 to 1000 g.', 'fillUnder', null, { upTo: 1000 }),
      col('Heavy When Over By (g)', 'fillOver', false, 'number', 'Fillers: flag HEAVY when over the product\'s target by this, 0 to 1000 g.', 'fillOver', null, { upTo: 1000 }),
      col('Per Box', 'perBox', false, 'number', 'BOXING / RAYPAK / TOTES: jugs in each box, 0 to 1000.', 'perBox', null, { upTo: 1000 }),
      col('Fed By', 'fedBy', false, 'text', 'BOXING / RAYPAK / TOTES: the filler lines whose jugs it boxes, comma between.', 'fedBy'),
      col('Active', 'active', false, 'yesno', 'Blank = Yes.', 'status (ACTIVE)', YN)
    ], examples: [
      ['GALLON FILLER', 'Production', '10', 'Label reader', '20', '24', '', '', '', 'Every so many minutes', '60', '60', '3', '10', '20', '', '', 'Yes'],
      ['BLOW MOLD', 'Production', '20', 'Typed by operator', '45', '72', '60', '58', '62', '', '', '', '', '', '', '', '', 'Yes']
    ] },
    { key: 'products', tab: 'Products', part: 'Plant', who: 'Plant manager', about: 'One row per product in each area (line). A product on two lines gets two rows. The same headings as the Product Sheet\'s own template (the plant is picked on screen).', cols: [
      col('Area', 'line', true, 'upper', 'The line or area, same as the Lines tab.', 'Product Sheet Area (the machine)', null, { max: 60 }),
      col('Product', 'name', true, 'upper', 'Like GAL WHOLE MILK.', 'Product Sheet Product', null, { max: 120 }),
      col('SKU', 'sku', false, 'text', '', 'SKU', null, { max: 40 }),
      col('UPC', 'upc', false, 'upc', '6 to 14 digits (needed for label readers).', 'UPC'),
      col('Type', 'mfgType', false, 'choice', 'The package.', 'Type', PRODUCT_TYPES),
      col('Group', 'productGroup', false, 'choice', 'Pick one; two or more with a comma between (Drinks, TEA).', 'Group', PRODUCT_GROUPS, { multi: true }),
      col('Full Speed Per Min', 'ratePerMin', false, 'number', 'Units per minute at full speed.', 'Full Speed Per Min', null, { upTo: 100000 }),
      col('Target %', 'targetPct', false, 'number', 'Like 85.', 'Target %', null, { upTo: 100 }),
      col('Lowest Speed', 'minSpeed', false, 'number', 'Per minute. Not above Highest Speed.', 'Lowest Speed', null, { upTo: 100000 }),
      col('Highest Speed', 'maxSpeed', false, 'number', 'Per minute.', 'Highest Speed', null, { upTo: 100000 }),
      col('Shelf Life Days', 'shelfLifeDays', false, 'number', 'Used to check the code date.', 'Shelf Life Days', null, { upTo: 3650 }),
      col('Target Fill Weight g', 'fillGrams', false, 'number', 'Product weight in grams.', 'Target Fill Weight g', null, { upTo: 20000 })
    ], example: ['GALLON FILLER', 'GAL WHOLE MILK', '121001', '070852000013', 'Gallon', 'Milk', '60', '85', '', '', '17', '3860'] },
    { key: 'machines', tab: 'Machines', part: 'Plant', who: 'Maintenance', about: 'Machines that are not production lines (compressors, boilers, the building).', cols: [
      col('Machine Name', 'name', true, 'upper', '', 'Machinery name', null, { max: 60 }),
      col('Kind', 'kind', true, 'choice', '', 'kind', ['Machine', 'Utility', 'Building', 'Other']),
      col('Department', 'area', false, 'text', '', 'area', null, { max: 60 }), col('Make', 'make', false, 'text', '', 'make', null, { max: 60 }), col('Model', 'model', false, 'text', '', 'model', null, { max: 60 }),
      col('Serial', 'serial', false, 'text', '', 'serial', null, { max: 60 }), col('Location', 'location', false, 'text', '', 'location', null, { max: 80 }),
      col('Installed', 'installed', false, 'date', 'Like 4-1-15.', 'installed'), col('Notes', 'notes', false, 'text', '', 'notes', null, { max: 500 })
    ], example: ['AMMONIA COMPRESSOR 1', 'Utility', 'Engine Room', 'Frick', 'RWB II', '', 'Engine room', '', ''] },
    { key: 'pmTasks', tab: 'PM Tasks', part: 'Plant', who: 'Maintenance', about: 'Planned maintenance for lines and machines.', cols: [
      col('Machine or Line', 'machine', true, 'upper', 'Name from the Lines or Machines tab.', 'PM Schedule machine'),
      col('Task', 'task', true, 'text', 'What to do.', 'task', null, { max: 120 }),
      col('Every', 'every', true, 'number', 'A whole number, 1 to 999.', 'every', null, { whole: true, lo: 1, upTo: 999 }),
      col('Unit', 'unit', true, 'choice', '', 'unit', ['Days', 'Weeks', 'Months']),
      col('Last Done', 'lastDone', false, 'date', 'Like 9-1-26.', 'lastDone'),
      col('Notes', 'notes', false, 'text', '', 'notes', null, { max: 500 })
    ], example: ['GALLON FILLER', 'Grease filler valves', '1', 'Months', '9-1-26', ''] },
    { key: 'shifts', tab: 'Shifts', part: 'Plant', who: 'Plant manager', about: 'Optional. Blank = 6:00 AM-2:30 PM, 2:00 PM-10:30 PM, 10:00 PM-5:30 AM. One name once on each side.', cols: [
      col('Shift Name', 'name', true, 'text', 'Like 1st Shift.', 'Plant Shifts name', null, { max: 40 }),
      col('Starts', 'start', true, 'time', 'Like 6:00 AM.', 'start'), col('Ends', 'end', true, 'time', 'Like 2:30 PM. Not the same as Starts.', 'end'),
      col('Side', 'side', false, 'choice', 'Blank = Distribution (the loading shifts).', 'side', SHIFT_SIDES.map(function (s) { return s[1]; }))
    ], example: ['1st Shift', '6:00 AM', '2:30 PM', 'Plant Production'] },
    { key: 'coolers', tab: 'Coolers & Temps', part: 'Plant', who: 'Plant manager', about: 'Each spot where a temperature is checked. Pick the MOCREO sensor on the MOCREO page later.', cols: [
      col('Location Name', 'name', true, 'upper', 'Like MAIN COOLER.', 'Temperatures location', null, { max: 80 }),
      col('Area', 'area', false, 'text', '', 'area', null, { max: 80 }),
      col('Low Limit (F)', 'low', false, 'signed', '', 'lowLimit'), col('High Limit (F)', 'high', false, 'signed', '', 'highLimit'),
      col('Screen Order', 'order', false, 'number', '', 'viewSequence'),
      col('Stale Minutes', 'staleMinutes', false, 'number', 'Minutes with no sensor reading before it shows STALE. Blank = 30.', 'staleMinutes', null, { whole: true, lo: 1 }),
      col('Active', 'active', false, 'yesno', 'Blank = Yes.', 'active', YN)
    ], example: ['MAIN COOLER', 'Cooler', '33', '40', '1', '', 'Yes'] },
    { key: 'locationAreas', tab: 'Location Areas', part: 'Plant', who: 'Plant manager', about: 'The plant\'s areas (Plant, Garage, Office, Yard) and their sub-areas in walking order. This feeds the Safety Walkthrough.', cols: [
      col('Area', 'area', true, 'text', 'Like Plant, Garage, Office or Yard.', 'Location Areas area', null, { max: 40 }),
      col('Sub-area', 'sub', false, 'text', 'Like Receiving & Docks. One row per sub-area.', 'Location Areas sub-areas', null, { max: 60 })
    ], example: ['Plant', 'Receiving & Docks'] },
    { key: 'safety', tab: 'Safety Checklist', part: 'Plant', who: 'Plant manager', about: 'Items checked on the Safety Walkthrough, by area and sub-area.', cols: [
      col('Area', 'area', true, 'text', 'Same names as the Location Areas tab.', 'Safety checklist place', null, { max: 40 }),
      col('Sub-area', 'sub', true, 'text', 'Same names as the Location Areas tab.', 'Safety checklist sub-area', null, { max: 60 }),
      col('Check Item', 'item', true, 'text', 'Like Exits clear.', 'item', null, { max: 160 }),
      col('How Often', 'freq', true, 'choice', '', 'freq', ['Weekly', 'Monthly'])
    ], example: ['Plant', 'Receiving & Docks', 'Exits clear and lit', 'Weekly'] },
    { key: 'extinguishers', tab: 'Fire Extinguishers', part: 'Plant', who: 'Plant manager', about: 'One row per extinguisher.', cols: [
      col('Tag #', 'tag', true, 'pattern', 'Letters, numbers or -, up to 12.', 'Extinguishers tag', null, { pattern: '^[A-Za-z0-9-]{1,12}$', patternWhy: 'letters, numbers or - only (up to 12)' }),
      col('Location', 'location', true, 'text', 'Where it hangs.', 'location', null, { max: 80 }),
      col('Type', 'type', false, 'choice', '', 'type', ['ABC', 'BC', 'CO2', 'K (kitchen)', 'Water', 'D (metal)']),
      col('Size', 'size', false, 'text', 'Like 10 lb.', 'size', null, { max: 20 }),
      col('Annual Due', 'annualDue', false, 'date', 'Like 3-1-27.', 'annualDue'), col('6-Year Due', 'sixYearDue', false, 'date', '', 'sixYearDue'), col('Hydro Due', 'hydroDue', false, 'date', '', 'hydroDue')
    ], example: ['FE-01', 'Dock door 1', 'ABC', '10 lb', '3-1-27', '', ''] },
    { key: 'suppliers', tab: 'Receiving Suppliers', part: 'Plant', who: 'Plant manager', about: 'Places the plant gets things from.', cols: [
      col('Supplier Name', 'name', true, 'upper', '', 'Receiving > Suppliers name', null, { max: 60 }),
      col('Short Name', 'short', false, 'text', '', 'short name', null, { max: 40 }),
      col('Code', 'code', false, 'pattern', 'Optional: up to 8 letters or numbers (_ and - too).', 'code', null, { pattern: '^[A-Za-z0-9_-]{1,8}$', patternWhy: 'up to 8 letters or numbers (_ and - too)' })
    ], example: ['DAIRY INGREDIENT', 'Dairy Ingredient', 'DI'] },
    { key: 'receivingItems', tab: 'Receiving Items', part: 'Plant', who: 'Plant manager', about: 'Optional: items received, with their barcodes.', cols: [
      col('Item Name', 'name', true, 'upper', '', 'Inventory item name', null, { max: 120 }), col('Barcodes', 'barcodes', false, 'text', 'Comma between.', 'barcodes')
    ], example: ['GALLON CAPS WHITE', ''] },
    { key: 'people', tab: 'People', part: 'People and Email', who: 'Office', about: 'One row per person who signs in with a United Dairy email.', cols: [
      col('Name', 'name', true, 'text', '', 'Users Master Display Name'),
      col('Email', 'email', true, 'udEmail', 'Must end in @uniteddairy.com.', 'Users Master Email'),
      col('Role', 'role', true, 'choice', '', 'Users Master Roles JSON', ROLES),
      col('Plants', 'plants', true, 'choice', 'This plant only, or All plants.', 'Users Master Facility IDs JSON', ['This plant', 'All plants']),
      col('Active', 'active', true, 'yesno', '', 'Users Master Status', YN)
    ], example: ['Sample Manager', 'sample.manager@uniteddairy.com', 'Manager', 'This plant', 'Yes'] },
    { key: 'garageTechs', tab: 'Garage Technicians', part: 'People and Email', who: 'Garage', about: 'The garage mechanics. Each one types their own login number on Fleet Service Setup; it is never put in a file.', cols: [
      col('Technician Name', 'name', true, 'upper', 'First and last name.', 'Garage Technicians name', null, { max: 40 }),
      col('Active', 'active', true, 'yesno', 'Yes or No.', 'active', YN)
    ], example: ['Sample Mechanic', 'Yes'] },
    { key: 'recipients', tab: 'Report Recipients', part: 'People and Email', who: 'Office', about: 'Who gets the shift report email. The app sends to the group called Plant Managers.', cols: [
      col('Group', 'group', true, 'text', 'Plant Managers unless you add another group.', 'Report Recipients group', null, { max: 100 }),
      col('Email', 'email', true, 'email', '', 'recipients')
    ], example: ['Plant Managers', 'plantmgmt@uniteddairy.com'] },
    { key: 'stations', tab: 'Stations', part: 'People and Email', who: 'Office', about: 'Tablets and TVs at the plant. Codes are made on Administration > Station Codes, never in a file.', cols: [
      col('Station Name', 'name', true, 'text', 'Like Dock 1 Tablet.', 'Station Codes name', null, { max: 60 }),
      col('Kind', 'kind', true, 'choice', 'The station kinds on Station Codes.', 'kind + type', STATION_KINDS)
    ], example: ['Dock 1 Tablet', 'Case Loadout'] },
    { key: 'plantEmail', tab: 'Plant Email', part: 'People and Email', who: 'Office', about: 'One row: who the plant\'s emails come from and the driver check-in email.', cols: [
      col('Send From Email', 'fromEmail', false, 'udEmail', 'A real @uniteddairy.com mailbox.', 'Email Senders address'),
      col('Send From Name', 'fromName', false, 'text', '', 'Email Senders name'),
      col('Check-In Email From', 'checkinFrom', false, 'email', 'Who sends the driver check-in email.', 'Driver Check-In Email sender'),
      col('Check-In Email To', 'checkinTo', false, 'email', 'Mailbox it arrives in.', 'recipient'),
      col('Check-In Subject', 'checkinSubject', false, 'text', 'Like CHARLESTON DRIVER CHECK IN.', 'subject', null, { max: 120 })
    ], example: ['plantmgmt@uniteddairy.com', 'United Dairy Charleston', 'callcenter@lauttamus.com', 'drivercheckin@uniteddairy.com', 'CHARLESTON DRIVER CHECK IN'] }
  ];
  var PARTS = ['Routes', 'Drivers', 'Plant', 'People and Email'];
  var BY_KEY = {};
  // Every tab has example (its first example row) and examples (every example row; Lines has two).
  SPEC.forEach(function (t) { t.examples = t.examples || [t.example]; t.example = t.examples[0]; BY_KEY[t.key] = t; });

  // The kind of line from its name, the same as production-rules.js lineKind (Quality, the line tablet and Line Targets go by it).
  function lineKind(name) {
    var k = String(name == null ? '' : name).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (/^HTST/.test(k)) return 'HTST';
    if (k === 'BLOWMOLD') return 'BLOWMOLD';
    if (k === 'BOXING' || k === 'RAYPAK' || k === 'TOTES') return 'PACK';
    return 'FILLER';
  }
  var KIND_LABEL = { FILLER: 'Fillers', HTST: 'HTST', PACK: 'Boxing & Totes', BLOWMOLD: 'Blow Mold' };
  // production-rules.js hasFill: fillers, and the RAYPAK and BOXING bag fillers.
  function hasFill(name) { var k = String(name == null ? '' : name).toUpperCase().replace(/[^A-Z0-9]/g, ''); return lineKind(name) === 'FILLER' || k === 'RAYPAK' || k === 'BOXING'; }

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
  // One run on Regular Week: "803 Load 1" -> "803 Load 1", or null.
  function oneRun(v) { var rl = splitRouteLoad(v); return rl.load ? rl.route.toUpperCase() + ' ' + rl.load : null; }
  function readKind(c, t) {
    switch (c.kind) {
      case 'upper': return { v: upper(t) };
      case 'code': return /^[A-Za-z0-9 _\-#.]{1,20}$/.test(t) ? { v: upper(t) } : { bad: 'use letters and numbers only (up to 20)' };
      case 'id': return /^[A-Za-z0-9\-]{1,20}$/.test(t) ? { v: upper(t) } : { bad: 'use letters and numbers only' };
      case 'load': return { v: loadName(t) };
      case 'yesno': { var y = upper(t); if (/^(YES|Y|TRUE|X|1)$/.test(y)) return { v: 'Yes' }; if (/^(NO|N|FALSE|0)$/.test(y)) return { v: 'No' }; return { bad: 'type Yes or No' }; }
      case 'works': { var w = upper(t); if (/^(YES|Y|TRUE|X|1|WORKS)$/.test(w)) return { v: 'Yes' }; if (/^(OFF|NO|N|FALSE|0)$/.test(w)) return { v: 'Off' }; return { bad: 'type Yes or Off' }; }
      case 'choice': {
        if (c.multi) {
          var parts = t.split(',').map(text).filter(Boolean), got = [], miss = [];
          parts.forEach(function (x) { var hit = choiceOf(x, c.choices || []); if (!hit) miss.push(x); else if (got.indexOf(hit) < 0) got.push(hit); });
          return miss.length ? { bad: 'pick from: ' + c.choices.join(', ') + ', comma between' } : { v: got.join(', ') };
        }
        var ch = choiceOf(t, c.choices || []); return ch ? { v: ch } : { bad: 'pick one of: ' + c.choices.join(', ') };
      }
      case 'offset': {
        var om = /^(-?)\s*([0-6])$/.exec(t);
        if (om && (om[1] || om[2] === '0')) return { v: LOADED[Number(om[2])] };
        var oc = choiceOf(t, LOADED); return oc ? { v: oc } : { bad: 'pick one of: ' + LOADED.join(', ') + ' (or 0 to -6)' };
      }
      case 'pattern': return new RegExp(c.pattern).test(t) ? { v: upper(t) } : { bad: c.patternWhy || 'not the right form' };
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
      case 'routeLoads': {
        var runs = t.split(';').map(text).filter(Boolean), out = [];
        for (var i = 0; i < runs.length; i++) {
          var one = oneRun(runs[i]);
          if (!one) return { bad: 'write the route and load, like 803 Load 1 (; between two runs)' };
          if (out.some(function (x) { return routeKey(splitRouteLoad(x).route, splitRouteLoad(x).load) === routeKey(splitRouteLoad(one).route, splitRouteLoad(one).load); })) return { bad: one + ' is in the cell twice' };
          out.push(one);
        }
        return { v: out.join('; ') };
      }
      default: return { v: t };
    }
  }
  function read(c, raw) {
    var t = text(raw);
    if (!t) return { v: '' };
    var max = c.max || 300;
    if (['text', 'upper'].indexOf(c.kind) >= 0 || c.max) { if (t.length > max) return { bad: 'too long (' + max + ' letters at most)' }; }
    var got = readKind(c, t);
    if (got.bad || (c.kind !== 'number' && c.kind !== 'signed')) return got;
    var n = Number(got.v), lo = c.lo === undefined ? (c.kind === 'number' ? 0 : null) : c.lo;
    if (c.whole && !/^-?\d+$/.test(got.v)) return { bad: 'type a whole number' };
    if ((c.upTo !== undefined && n > c.upTo) || (lo !== null && n < lo)) return { bad: c.upTo !== undefined ? 'type a number from ' + lo + ' to ' + c.upTo : 'type a number of ' + lo + ' or more' };
    return got;
  }
  // The cells of a Regular Week day ("803 Load 1; 812 Load 2") as [{route, load}].
  function runsOf(v) { return text(v).split(';').map(text).filter(Boolean).map(splitRouteLoad); }

  // A row's key in its tab (same key = same row, saved or in the file) and the words that name it on the check screen.
  function sideOf(v) { var hit = SHIFT_SIDES.filter(function (x) { return upper(x[1]) === upper(v) || x[0] === upper(v); })[0]; return hit ? hit[0] : 'DISTRIBUTION'; }
  function keyOf(tab, r) {
    switch (tab) {
      case 'routes': return routeKey(r.route, r.load);
      case 'routeDays': return routeKey(r.route, r.load) + '|' + upper(r.day);
      case 'drivers': case 'regularWeek': return idKey(r.employeeId);
      case 'daysOff': return idKey(r.employeeId) + '|' + r.start + '|' + upper(r.type);
      case 'products': return upper(r.line) + '|' + upper(r.name);
      case 'pmTasks': return upper(r.machine) + '|' + upper(r.task);
      case 'locationAreas': return upper(r.area) + '|' + upper(r.sub);
      case 'safety': return upper(r.area) + '|' + upper(r.sub) + '|' + upper(r.item);
      // plant.js savePlantShifts: one name once on each side (a blank side is Distribution).
      case 'shifts': return sideOf(r.side) + '|' + upper(r.name);
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
      case 'locationAreas': return r.area + (r.sub ? ' > ' + r.sub : '');
      case 'safety': return r.area + ' > ' + r.sub + ': ' + r.item;
      case 'lines': return r.name + (r.name ? ' · ' + KIND_LABEL[lineKind(r.name)] : '');
      case 'shifts': return r.name + ' (' + (SHIFT_SIDES.filter(function (x) { return x[0] === sideOf(r.side); })[0] || SHIFT_SIDES[0])[1] + ')';
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
      var ex = t.examples.map(function (e) { return e.map(upper).join('|'); }), rows = [], exampleSkipped = false;
      cells.slice(1).forEach(function (r, i) {
        var raw = {}, any = false;
        t.cols.forEach(function (c) { var v = at[c.key] === undefined ? '' : text(r[at[c.key]]); raw[c.key] = v; if (v) any = true; });
        if (!any) return;
        if (ex.indexOf(t.cols.map(function (c) { return upper(raw[c.key]); }).join('|')) >= 0) { exampleSkipped = true; return; }
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
    var routeSet = {}, driverSet = {}, reliefSet = {}, lineSet = {}, machineSet = {}, areaSet = {}, subSet = {}, anySubs = false;
    now('routes').forEach(function (r) { routeSet[routeKey(r.route, r.load)] = 1; });
    now('drivers').forEach(function (r) { driverSet[idKey(r.employeeId)] = 1; if (r.relief === 'Yes') reliefSet[idKey(r.employeeId)] = 1; });
    now('lines').forEach(function (r) { lineSet[upper(r.name)] = 1; machineSet[upper(r.name)] = 1; });
    now('machines').forEach(function (r) { machineSet[upper(r.name)] = 1; });
    // Location Areas (safety.js saveLocations): areas, each with its sub-areas; the Safety Checklist's items sit in a sub-area.
    now('locationAreas').forEach(function (r) { areaSet[upper(r.area)] = 1; if (text(r.sub)) { subSet[upper(r.area) + '|' + upper(r.sub)] = 1; anySubs = true; } });
    var anyRoutes = Object.keys(routeSet).length > 0, anyLines = Object.keys(lineSet).length > 0, anyAreas = Object.keys(areaSet).length > 0;
    // Regular Week: a run belongs to one driver a day (actions-drivers.js saveDriverTemplate).
    var dayRuns = {};

    SPEC.forEach(function (t) {
      var f = filled[t.key];
      if (!f) return;
      var seen = {}, out = [];
      f.rows.forEach(function (r) {
        var v = r.values, p = r.problems.slice(), k = keyOf(t.key, v);
        if (!p.length) {
          if (seen[k]) p.push('Same as row ' + seen[k] + ' (each ' + (t.key === 'drivers' || t.key === 'regularWeek' ? 'Employee ID' : 'row') + ' once)');
          else seen[k] = r.n;
          if (t.key === 'routes' && v.carrier && v.runBy !== 'Outside Carrier') p.push('Carrier Name is only for Who Runs It = Outside Carrier');
          if (t.key === 'routeDays') {
            if (anyRoutes && !routeSet[routeKey(v.route, v.load)]) p.push('Route ' + v.route + ' ' + v.load + ' is not on the Routes tab');
            if (v.runs === 'Yes' && !v.time) p.push('Dispatch Time is blank (it runs that day)');
            if (v.runs === 'Yes' && !v.loaded) p.push('Loaded is blank (it runs that day)');
          }
          if (t.key === 'regularWeek') {
            if (!driverSet[idKey(v.employeeId)]) p.push('Employee ID ' + v.employeeId + ' is not on the Drivers tab');
            DAYS.forEach(function (d) {
              var k2 = d.toLowerCase(), rt = v[k2 + 'Route'];
              if (!v[k2 + 'Works'] && !reliefSet[idKey(v.employeeId)]) p.push(d + ' Works is blank (Yes or Off; only a Relief Driver may leave it blank)');
              if (!rt) return;
              if (v[k2 + 'Works'] === 'Off') p.push(d + ': has a route but is Off');
              runsOf(rt).forEach(function (s) {
                var name = s.route.toUpperCase() + ' ' + s.load, rk = d + '|' + routeKey(s.route, s.load);
                if (!routeSet[routeKey(s.route, s.load)]) p.push(d + ': route ' + name + ' is not on the Routes tab');
                else if (dayRuns[rk] && dayRuns[rk] !== idKey(v.employeeId)) p.push(d + ': ' + name + ' is already Employee ID ' + dayRuns[rk] + '\'s run (one driver a day)');
                else dayRuns[rk] = idKey(v.employeeId);
              });
            });
          }
          if (t.key === 'daysOff') {
            if (!driverSet[idKey(v.employeeId)]) p.push('Employee ID ' + v.employeeId + ' is not on the Drivers tab');
            if (v.end && v.start && v.end < v.start) p.push('End Date is before Start Date');
            else if (v.end && v.start && (Date.parse(v.end) - Date.parse(v.start)) / 86400000 > 366) p.push('At most a year from Start Date to End Date');
          }
          if (t.key === 'products') {
            if (anyLines && !lineSet[upper(v.line)]) p.push('Area ' + v.line + ' is not on the Lines tab');
            if (v.minSpeed !== '' && v.maxSpeed !== '' && Number(v.minSpeed) > Number(v.maxSpeed)) p.push('Lowest Speed is above Highest Speed');
          }
          if (t.key === 'pmTasks' && !machineSet[upper(v.machine)]) p.push(v.machine + ' is not on the Lines or Machines tab');
          if (t.key === 'safety' && anyAreas) {
            if (!areaSet[upper(v.area)]) p.push('Area ' + v.area + ' is not on the Location Areas tab');
            else if (anySubs && !subSet[upper(v.area) + '|' + upper(v.sub)]) p.push('Sub-area ' + v.sub + ' is not under ' + v.area + ' on the Location Areas tab');
          }
          if (t.key === 'coolers' && v.low !== '' && v.high !== '' && Number(v.low) > Number(v.high)) p.push('Low Limit is above High Limit');
          if (t.key === 'shifts' && v.start && v.start === v.end) p.push('Starts and Ends are the same time');
          if (t.key === 'lines') {
            // Line Targets shows each box only on its kind of line (linetargets.html), so a number on another kind would be lost.
            var lk = lineKind(v.name), only = function (keys, ok, words) {
              var hit = t.cols.filter(function (c) { return keys.indexOf(c.key) >= 0 && v[c.key] !== ''; }).map(function (c) { return c.h; });
              if (hit.length && !ok) p.push(hit.join(', ') + ': ' + words + ' only (' + v.name + ' is ' + KIND_LABEL[lk] + ')');
            };
            only(['jugWeightTarget', 'jugWeightLow', 'jugWeightHigh'], lk === 'BLOWMOLD', 'BLOW MOLD');
            only(['fillEvery', 'fillEveryN', 'tareGrams', 'capGrams', 'fillUnder', 'fillOver'], hasFill(v.name), 'fillers and the RAYPAK / BOXING bag fillers');
            only(['perBox', 'fedBy'], lk === 'PACK', 'BOXING, RAYPAK and TOTES');
            if (v.jugWeightLow !== '' && v.jugWeightHigh !== '' && Number(v.jugWeightLow) > Number(v.jugWeightHigh)) p.push('Jug Weight Low is above High');
            if (v.fillEveryN !== '' && ['Every so many minutes', 'Every so many jugs'].indexOf(v.fillEvery) < 0) p.push('Fill Check Every needs Fill Check Due of Every so many minutes or jugs');
            if (lk === 'PACK' && v.fedBy) v.fedBy.split(',').map(upper).filter(Boolean).forEach(function (n) {
              if (n === upper(v.name)) p.push('Fed By: a line cannot feed itself');
              else if (!lineSet[n]) p.push('Fed By: ' + n + ' is not on the Lines tab');
              else if (lineKind(n) !== 'FILLER') p.push('Fed By: ' + n + ' is not a filler');
            });
          }
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

  return { SPEC: SPEC, PARTS: PARTS, BY_KEY: BY_KEY, DAYS: DAYS, ROLES: ROLES, MAX_ROWS: MAX_ROWS, EXCEPTION_REASONS: EXCEPTION_REASONS, VACATION_STATUSES: VACATION_STATUSES,
    STATION_KINDS: STATION_KINDS, SHIFT_SIDES: SHIFT_SIDES, COUNTED_BY: COUNTED_BY, FILL_MODES: FILL_MODES, PRODUCT_TYPES: PRODUCT_TYPES, PRODUCT_GROUPS: PRODUCT_GROUPS,
    LOAD_TYPES: LOAD_TYPES, RUN_BY: RUN_BY, LOADED: LOADED, lineKind: lineKind, hasFill: hasFill, runsOf: runsOf, read: read, readBook: readBook, check: check, toSave: toSave,
    keyOf: keyOf, labelOf: labelOf, idKey: idKey, routeKey: routeKey, loadName: loadName, splitRouteLoad: splitRouteLoad, dateOf: dateOf, timeOf: timeOf };
});
