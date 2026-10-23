'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../src/logic');

test('dates from the sheets read the same however they are written', () => {
  assert.equal(L.dateKey('2026-10-05'), '2026-10-05');
  assert.equal(L.dateKey('10/5/2026'), '2026-10-05');
  assert.equal(L.dateKey('2026-10-03T08:58:37-04:00'), '2026-10-03');
  assert.equal(L.dateKey(46299), '2026-10-04'); // a Sheets serial day number
  assert.equal(L.dateKey('2/30/2026'), '');
  assert.equal(L.dateKey(''), '');
  assert.equal(L.dateKey('soon'), '');
});

test('weeks run Sunday to Saturday', () => {
  assert.equal(L.weekStart('2026-10-08'), '2026-10-04');
  assert.equal(L.weekStart('2026-10-04'), '2026-10-04');
  assert.equal(L.weekStart('2026-10-10'), '2026-10-04');
  assert.equal(L.dayPrefix('2026-10-05'), 'mon');
});

test('the operating day rolls at 6:00 AM New York time, also across daylight saving', () => {
  assert.equal(L.operatingDay(new Date('2026-10-09T09:59:00Z')), '2026-10-08'); // 5:59 AM EDT
  assert.equal(L.operatingDay(new Date('2026-10-09T10:00:00Z')), '2026-10-09'); // 6:00 AM EDT
  assert.equal(L.operatingDay(new Date('2026-12-09T10:59:00Z')), '2026-12-08'); // 5:59 AM EST
  assert.equal(L.operatingDay(new Date('2026-12-09T11:00:00Z')), '2026-12-09');
});

test('yes/no cells follow the current app', () => {
  ['TRUE', 'true', 'Yes', 'X', 1].forEach(v => assert.equal(L.yes(v), true, String(v)));
  ['FALSE', 'no', 'N', '0', 'OFF', 'Does not run', '', null, 0, false].forEach(v => assert.equal(L.yes(v), false, String(v)));
  assert.equal(L.optionalYes(''), null);
});

test('times read as minutes after midnight', () => {
  assert.equal(L.minutesOfDay('4:00:00 AM'), 240);
  assert.equal(L.minutesOfDay('12:15 AM'), 15);
  assert.equal(L.minutesOfDay('1:30 PM'), 810);
  assert.equal(L.minutesOfDay('16:30'), 990);
  assert.equal(L.minutesOfDay(0.25), 360);
  assert.equal(L.minutesOfDay('later'), null);
  assert.equal(L.timeText(810), '1:30 PM');
});

test('a time typed any way in the Route Editor turns into a real time (Joe 10/20)', () => {
  const t = (x, was) => { const m = L.typedTime(x, was); return m === null ? null : L.timeText(m); };
  [['5', '5:00 AM'], ['530', '5:30 AM'], ['0530', '5:30 AM'], ['5:30', '5:30 AM'], ['5a', '5:00 AM'], ['5p', '5:00 PM'], ['5:30pm', '5:30 PM'],
    ['5:30 p.m.', '5:30 PM'], ['5 PM', '5:00 PM'], ['17:30', '5:30 PM'], ['1730', '5:30 PM'], ['4:00:00 AM', '4:00 AM'], ['12p', '12:00 PM'], ['0', '12:00 AM']]
    .forEach(([typed, want]) => assert.equal(t(typed), want, typed));
  // No AM / PM: a box that held a PM time keeps PM; written as 24 hours (0530, 17:30) it is exact.
  assert.equal(t('5', 900), '5:00 PM');
  assert.equal(t('5:30', 900), '5:30 PM');
  assert.equal(t('0530', 900), '5:30 AM');
  assert.equal(t('5a', 900), '5:00 AM');
  ['', 'later', '2400', '13pm', '5:75', '12345', '5:3'].forEach(x => assert.equal(L.typedTime(x), null, x));
});

function run(id, week, days, extra) {
  return Object.assign({ id, weekStart: week, route: id, run: 'R', routeStatus: 'ACTIVE', active: true, displayDaily: true, displayWeekly: true, days }, extra || {});
}

test('a load date reads the day blocks that load on it, including next week deliveries', () => {
  const runs = [
    run('A', '2026-10-04', { tue: { runs: true, loadDayOffset: -1, loadSequence: 20 } }),
    run('B', '2026-10-04', { tue: { runs: true, loadDayOffset: null, loadSequence: 10 } }),   // blank offset = -1
    run('C', '2026-10-04', { wed: { runs: true, loadDayOffset: 0, loadSequence: 5 } }),
    run('D', '2026-10-11', { sun: { runs: true, loadDayOffset: -1, loadSequence: 1 } }),      // loads Saturday 10/10
    run('E', '2026-10-04', { tue: { runs: false, loadDayOffset: -1, loadSequence: 1 } }),
    run('F', '2026-10-04', { tue: { runs: true, loadDayOffset: -1, loadSequence: 1 } }, { displayDaily: false }),
    run('G', '2026-10-04', { tue: { runs: true, loadDayOffset: -1, loadSequence: 1 } }, { routeStatus: 'INACTIVE' })
  ];
  assert.deepEqual(L.dailyRows(runs, '2026-10-05').map(r => r.runDocId), ['B', 'A']);
  assert.deepEqual(L.dailyRows(runs, '2026-10-07').map(r => r.runDocId), ['C']);
  assert.deepEqual(L.dailyRows(runs, '2026-10-10').map(r => r.runDocId), ['D']);
  assert.deepEqual(L.weeksForLoadDate('2026-10-10'), ['2026-10-04', '2026-10-11']);
  assert.deepEqual(L.weeksForLoadDate('2026-10-04'), ['2026-10-04']);
});

test('the load order override wins, then route number', () => {
  const runs = [
    run('810', '2026-10-04', { tue: { runs: true, loadDayOffset: -1, loadSequence: 10 } }),
    run('802', '2026-10-04', { tue: { runs: true, loadDayOffset: -1, loadSequence: 10, loadSequenceOverride: 30 } }),
    run('9', '2026-10-04', { tue: { runs: true, loadDayOffset: -1, loadSequence: 10 } }),
    run('none', '2026-10-04', { tue: { runs: true, loadDayOffset: -1, loadSequence: null } })
  ];
  assert.deepEqual(L.dailyRows(runs, '2026-10-05').map(r => r.runDocId), ['9', '810', '802', 'none']);
});

test('the weekly grid lists one line per run in Route Master week order', () => {
  const runs = [
    run('A', '2026-10-04', { mon: { runs: true, driver: 'X' } }, { weekOrder: 2 }),
    run('B', '2026-10-04', { tue: { runs: true } }, { weekOrder: 1 }),
    run('C', '2026-10-11', { tue: { runs: true } }),
    run('D', '2026-10-04', {}, { displayWeekly: false })
  ];
  const rows = L.weeklyRows(runs, '2026-10-04');
  assert.deepEqual(rows.map(r => r.runDocId), ['B', 'A']);
  assert.equal(rows[1].days.mon.driver, 'X');
  assert.equal(rows[1].days.mon.date, '2026-10-05');
  assert.equal(rows[1].days.tue.runs, false);
});

test('Weekly colours and the Driver Assignment Board follow the current Weekly legend', () => {
  const day = (o) => Object.assign({ runs: true, driverId: '', driver: '', date: '2026-10-05', driverExceptionStatus: '' }, o);
  const week = (mon) => { const days = {}; L.DAYS.forEach((p, i) => { days[p] = day({ runs: false, date: L.addDays('2026-10-04', i) }); }); days.mon = day(mon); return days; };
  const rows = [
    { route: '801', coverageType: 'UNITED DAIRY', days: week({ driverId: 'a', driver: 'ADAMS' }) },
    { route: '802', coverageType: 'UNITED DAIRY', days: week({ driverId: 'a', driver: 'ADAMS' }) },
    { route: '803', coverageType: '', days: week({ intendedDriver: 'CASEY', driverExceptionStatus: 'VACATION' }) },
    { route: '804', coverageType: 'UNITED DAIRY', days: week({ driver: 'CARRIER' }) },
    { route: '805', coverageType: 'UNITED DAIRY', days: week({ driverId: 'b', driver: 'BROOK' }) },
    { route: '806', coverageType: 'UNITED DAIRY', days: week({ driverId: 'c', driver: 'CASEY' }) },
    { route: '807', coverageType: 'OUTSIDE CARRIER', days: week({}) },
    { route: '808', coverageType: 'BRANCH', days: week({}) }
  ];
  const drivers = [{ id: 'a', name: 'ADAMS', status: 'ACTIVE', seniorityDate: '2010-03-01' }, { id: 'b', name: 'BROOK', status: 'ACTIVE', reliefDriver: true },
    { id: 'c', name: 'CASEY', status: 'ACTIVE', hireDate: '2025-12-01' }, { id: 'd', name: 'DUNN', status: 'INACTIVE' }];
  const exceptions = [{ driverId: 'c', startDate: '2026-10-05', endDate: '2026-10-05', type: 'SICK DAY', status: 'UNAVAILABLE', reasonCode: 'SICK DAY' }];
  const ctx = L.weeklyContext(rows, drivers, exceptions);
  assert.deepEqual(rows.map(r => L.weeklyCellClass(r, 'mon', ctx)), ['booked', 'booked', 'vacation-needs', 'carrier', 'relief', 'conflict', 'coverage', 'needs']);
  assert.equal(L.weeklyCellClass(rows[0], 'tue', ctx), 'off');
  const board = L.driverBoardRows(drivers, rows, exceptions, '2026-10-04');
  assert.deepEqual(board.map(b => b.name), ['BROOK', 'ADAMS', 'CASEY'], 'relief first, then seniority; inactive drivers left out');
  assert.deepEqual([board[1].days.mon.text, board[1].days.mon.kind], ['801 / 802', 'booked']);
  assert.deepEqual([board[2].days.mon.text, board[2].days.mon.kind], ['806', 'conflict']);
  assert.deepEqual([board[2].days.tue.text, board[2].days.tue.kind], ['AVAILABLE', 'available']);
  // Joe 10/16: Backup shows on a day with no route and no day off; a route or a day off wins.
  const backups = [{ driverId: 'c', date: '2026-10-06' }, { driverId: 'c', date: '2026-10-05' }, { driverId: 'a', date: '2026-10-05' }];
  const withBackup = L.driverBoardRows(drivers, rows, exceptions, '2026-10-04', backups);
  assert.deepEqual([withBackup[2].days.tue.text, withBackup[2].days.tue.kind], ['BACKUP', 'backup']);
  assert.deepEqual([withBackup[2].days.mon.text, withBackup[2].days.mon.kind], ['806', 'conflict']);
  assert.deepEqual([withBackup[1].days.mon.text, withBackup[1].days.mon.kind], ['801 / 802', 'booked']);
  assert.equal(withBackup[2].days.wed.kind, 'available');
  assert.equal(L.backupOn(backups, 'c', '2026-10-06'), true);
  assert.equal(L.backupOn(backups, 'c', '2026-10-07'), false);
  // Joe 10/17: made Available on his regular day off (Driver Master <day>_available FALSE), the board shows AVAILABLE, not OFF.
  const offTue = drivers.map(d => d.id === 'c' ? Object.assign({}, d, { cells: { tue_available: 'FALSE', wed_available: 'FALSE' } }) : d);
  const marks = [{ driverId: 'c', date: '2026-10-06', kind: 'AVAILABLE' }];
  assert.deepEqual([L.driverBoardRows(offTue, rows, exceptions, '2026-10-04')[2].days.tue.text], ['OFF']);
  const madeAvailable = L.driverBoardRows(offTue, rows, exceptions, '2026-10-04', marks)[2];
  assert.deepEqual([madeAvailable.days.tue.text, madeAvailable.days.tue.kind], ['AVAILABLE', 'available']);
  assert.equal(madeAvailable.days.wed.text, 'OFF', 'only the day marked');
  assert.equal(L.backupOn(marks, 'c', '2026-10-06'), false, 'Available is not Backup');
  assert.equal(L.availableOn(marks, 'c', '2026-10-06'), true);
});

test('Driver Assignment Board names a repeated run once with its count, one line each', () => {
  const day = (o) => Object.fromEntries(L.DAYS.map((p, i) => [p, Object.assign({ date: '2026-10-' + String(4 + i).padStart(2, '0'), runs: false }, p === 'mon' ? o : {})]));
  const rows = [
    { route: '8303', run: '8303', days: day({ runs: true, driverId: 'a', driver: 'ADAMS' }) },
    { route: '8303', run: '8303', days: day({ runs: true, driverId: 'a', driver: 'ADAMS' }) },
    { route: '801', streamId: 'FERRY PRODUCT', days: day({ runs: true, driverId: 'a', driver: 'ADAMS' }) }
  ];
  const board = L.driverBoardRows([{ id: 'a', name: 'ADAMS', status: 'ACTIVE' }], rows, [], '2026-10-04');
  assert.deepEqual(board[0].days.mon.lines, ['8303 ×2', 'FERRY PRODUCT']);
  assert.equal(board[0].days.mon.text, '8303 ×2 / FERRY PRODUCT');
  assert.equal(board[0].days.mon.kind, 'booked');
});

test('Equipment: each unit\'s default runs by weekday from Route Master, and the fleet sync text left out of notes', () => {
  const days = (o) => Object.fromEntries(L.DAYS.map(p => [p, Object.assign({ active: false }, o[p] || {})]));
  const routes = [
    { route: '808', streamId: '808', routeStatus: 'ACTIVE', days: days({ mon: { active: true, tractor: '223880', trailer: 'T-946' }, tue: { active: false, tractor: '223880' } }) },
    { route: '901', streamId: 'FERRY JUG', routeStatus: 'ACTIVE', days: days({ mon: { active: true, trailer: 'veh_trailer_t_946' } }) },
    { route: '999', streamId: '999', routeStatus: 'INACTIVE', days: days({ mon: { active: true, tractor: '223880' } }) }
  ];
  const units = [{ id: 'veh_truck_223880', unit: '223880' }, { id: 'veh_trailer_t_946', unit: 'T-946' }];
  const map = L.unitDefaultDays(routes, units);
  assert.deepEqual(map.veh_truck_223880, { mon: ['808'] });
  assert.deepEqual(map.veh_trailer_t_946, { mon: ['808', 'FERRY JUG'] });
  assert.equal(L.cleanUnitNote('Down (10/8/2026 jc@uniteddairy.com) | External Fleet: 2017 | INTL'), 'Down (10/8/2026 jc@uniteddairy.com)');
  assert.equal(L.cleanUnitNote('External Fleet: 2017 | INTERNATIONAL | Prostar'), '');
});

test('truck and trailer lists: a unit on the road on another run at the same time is out, as in the current app', () => {
  const rows = [
    { id: 'a', route: '801', deliveryDate: '2026-10-12', dispatchTime: 240, routeHours: '9:30', truckId: 't1', trailerId: 'r1' },
    { id: 'b', route: '802', deliveryDate: '2026-10-12', dispatchTime: 600, routeHours: 4, truckId: 't2', trailerId: '' },
    { id: 'c', route: '803', deliveryDate: '2026-10-12', dispatchTime: 950, routeHours: '', truckId: 't3' },
    { id: 'd', route: '804', deliveryDate: '2026-10-13', dispatchTime: 600, routeHours: 4, truckId: 't4' },
    { id: 'e', route: '805', deliveryDate: '2026-10-12', dispatchTime: 1260, routeHours: 6, truckId: 't5' },
    { id: 't', route: '900', deliveryDate: '2026-10-12', dispatchTime: 780, routeHours: 3 }
  ];
  const c = L.unitConflicts(rows, rows[5], 'truck', (r) => (r.id === 'c' ? '2' : null));
  assert.equal(c.t1, 'ON ROAD UNTIL 1:30 PM (801)', '4 AM + 9:30 overlaps 1 PM, by more than the 15 minutes leeway');
  assert.equal(c.t2, 'ON ROAD UNTIL 2:00 PM (802)');
  assert.equal(c.t3, undefined, '803 leaves at 3:50 PM (Route Master 2 hours), within the 15 minutes leeway of this one being back at 4 PM');
  assert.equal(c.t4, undefined, 'another delivery day');
  assert.equal(c.t5, undefined, 'leaves after this one is back');
  const c2 = L.unitConflicts(rows, rows[5], 'truck', () => null);
  assert.equal(c2.t3, 'ON ROAD — RETURN UNKNOWN (803)', 'a run with no hours anywhere counts as busy, as in the current app');
  const late = L.unitConflicts([{ id: 'x', route: '806', deliveryDate: 'd', dispatchTime: 1320, routeHours: 4, trailerId: 'r9' }, { id: 'y', route: '807', deliveryDate: 'd', dispatchTime: 1380, routeHours: 1 }], { id: 'y', route: '807', deliveryDate: 'd', dispatchTime: 1380, routeHours: 1 }, 'trailer');
  assert.equal(late.r9, 'ON ROAD UNTIL 2:00 AM (806)', 'past midnight');
  assert.equal(L.hoursMinutes('9.5'), 570);
});

test('unitLessor: the lease company from the fleet text, a short number when one unit ends that way, owned trucks go to our garage', () => {
  const units = [{ unit: '223876', notes: 'External Fleet: 2023 | FREIGHTLINER | x | Lease: Idealease' }, { unit: '493', notes: 'External Fleet: 2015 | INTERNATIONAL | DuraStar 4300' },
    { unit: '123876', notes: 'External Fleet: Lease: PENSKE' }, { unit: '224981', notes: 'External Fleet: Lease: Idealease' }];
  assert.equal(L.unitLessor(units, '223876').lessor, 'Idealease');
  assert.equal(L.unitLessor(units, '4981').lessor, 'Idealease');
  assert.equal(L.unitLessor(units, '4981').unit, '224981');
  assert.equal(L.unitLessor(units, '493').lessor, '');
  assert.match(L.unitLessor(units, '493').why, /Owned/);
  assert.match(L.unitLessor(units, '876').why, /matches 223876, 123876/);
  assert.match(L.unitLessor(units, '999').why, /not on the fleet list/);
});

test('Daily and the phone follow the Live flag, and a blank Live flag falls back to Route Master like the current app', () => {
  const show = (run) => L.liveFlagShown(run, 'displayDaily', 'daily');
  assert.equal(show({ displayDaily: true, masterShow: { daily: false } }), true);
  assert.equal(show({ displayDaily: false, masterShow: { daily: true } }), false);
  assert.equal(show({ masterShow: { daily: true } }), true);
  assert.equal(show({ masterShow: { daily: false } }), false);
  assert.equal(show({ masterShow: { daily: null } }), false);
  assert.equal(show({ displayDaily: true, routeStatus: 'INACTIVE' }), false);
  assert.equal(show({ displayDaily: true, active: false }), false);
  assert.equal(show({}), true);
});

test('Joe 10/11: a driver off on a day he normally works is red whatever the reason, and his run shows it needs cover', () => {
  const cells = (runs) => Object.fromEntries(L.DAYS.flatMap(p => [[p + '_available', p === 'sun' ? 'NO' : 'YES'], [p + '_assignments_json', JSON.stringify(runs)]]));
  const drivers = [{ id: 'j', name: 'JONES, MICHAEL', status: 'ACTIVE', cells: cells(['812']) }, { id: 'a', name: 'ALSTON, BRANDON', status: 'ACTIVE', cells: cells(['815']) }];
  const exceptions = [
    { driverId: 'j', startDate: '2026-10-12', endDate: '2026-10-12', type: 'UNPAID DAY', status: 'UNAVAILABLE', reasonCode: 'UNPAID DAY' },
    { driverId: 'a', startDate: '2026-10-11', endDate: '2026-10-11', type: 'SICK DAY', status: 'UNAVAILABLE', reasonCode: 'SICK DAY' }
  ];
  const day = (o) => Object.assign({ runs: true, driverId: '', driver: '', driverExceptionStatus: '' }, o);
  const days = (mon) => Object.fromEntries(L.DAYS.map((p, i) => [p, p === 'mon' ? day(Object.assign({ date: '2026-10-12' }, mon)) : day({ runs: false, date: L.addDays('2026-10-11', i) })]));
  const rows = [
    { route: '812', runId: '812', coverageType: 'UNITED DAIRY', days: days({}) },
    { route: '815', runId: '815', coverageType: 'UNITED DAIRY', days: days({}) },
    { route: '812', runId: '812', coverageType: 'UNITED DAIRY', days: days({ driverId: 'r', driver: 'RELIEF' }) }
  ];
  const ctx = L.weeklyContext(rows, drivers, exceptions);
  assert.deepEqual(rows.map(r => L.weeklyCellClass(r, 'mon', ctx)), ['vacation-needs', 'needs', 'assigned'], 'only the run whose regular driver is off is red; a covered run is not');
  assert.deepEqual(L.offCover(rows[0], 'mon', '2026-10-12', ctx), { name: 'JONES, MICHAEL', reason: 'UNPAID DAY' });
  const board = L.driverBoardRows(drivers, [], exceptions, '2026-10-11');
  const jones = board.find(b => b.id === 'j'), alston = board.find(b => b.id === 'a');
  assert.equal(jones.days.mon.kind, 'vacation', 'unpaid on a working day is red');
  assert.equal(alston.days.sun.kind, 'unavailable', 'off on his regular day off stays as before');
});

// Joe 10/12: the plant email showed "Plant employee" in People & Roles but the tablet stayed View only. A role written
// with a space, a dash or in lower case is the same role, as People & Roles and rights.js already read it.
test('hasRole reads a role however the Users sheet spells it', () => {
  const plant = (roles, status) => ({ status: status || 'ACTIVE', roles });
  const PLANT = L.SAVE_ROLES.concat(['PLANT_EMPLOYEE']);
  for (const r of ['PLANT_EMPLOYEE', 'Plant Employee', 'plant employee', 'plant-employee', ' PLANT_EMPLOYEE ']) assert.equal(L.hasRole(plant([r]), PLANT), true, r);
  assert.equal(L.hasRole(plant(['Plant Employee'], 'Active'), PLANT), true, 'status Active');
  assert.equal(L.hasRole(plant(['MECHANIC']), PLANT), false);
  assert.equal(L.hasRole(plant(['Plant Employee'], 'INACTIVE'), PLANT), false);
  assert.equal(L.hasRole(null, PLANT), false);
});

test('route names read as Route, Route Name and Run Name, never 6301_1 (Joe 10/12)', () => {
  assert.equal(L.routeNumber('901_3'), '901');
  assert.equal(L.routeNumber('6301'), '6301');
  assert.equal(L.runLabel('Martins Ferry', 'Product Load 1'), 'Martins Ferry Product Load 1');
  assert.equal(L.runLabel('Walmart', 'Load 2'), 'Walmart Load 2');
  assert.equal(L.runLabel('UT WALMART', '6301_1'), 'UT WALMART Load 1');
  assert.equal(L.runLabel('Jersey', 'JERSEY LOAD 1'), 'JERSEY LOAD 1');
  assert.equal(L.runLabel('UT DSD MILK', 'UT DSD MILK'), 'UT DSD MILK');
  assert.equal(L.runLabel('CreamOLand', ''), 'CreamOLand');
  assert.equal(L.runLabel('', 'PECK'), 'PECK');
  // Run Type (route_run_type) tells Load 1 from Load 2.
  assert.equal(L.runLabel('Martins Ferry', 'Product', 'Load 1'), 'Martins Ferry Product Load 1');
  assert.equal(L.runLabel('Walmart', '', 'Load 2'), 'Walmart Load 2');
  assert.equal(L.runLabel('Jersey', 'JERSEY LOAD 1', 'Load 1'), 'JERSEY LOAD 1');
});

test('Weekly: a plant load marked Not running (plantLoadOff) is off; without the mark it needs a driver (Joe 10/13, 836 PECK)', () => {
  const row = { runId: 'run_836', coverageType: 'UNITED DAIRY', days: { wed: { runs: false, date: '2026-10-14' } } };
  const ctx = { plant: { 'run_836|2026-10-14': [{ runId: 'run_836' }] }, dup: {}, relief: {}, exceptions: [] };
  assert.equal(L.weeklyCellClass(row, 'wed', ctx), 'plant');
  row.days.wed.plantLoadOff = true;
  assert.equal(L.weeklyCellClass(row, 'wed', ctx), 'off');
  // Weekly's rows keep the mark, so the screen shows it.
  const shown = L.weeklyRows([{ id: 'w', weekStart: '2026-10-11', runId: 'run_836', days: { wed: { runs: false, plantLoadOff: true } } }], '2026-10-11')[0];
  assert.equal(L.weeklyCellClass(shown, 'wed', ctx), 'off');
});

test('Weekly: a carrier pickup on the Scheduler for a day the run does not run shows CARRIER (Joe 10/23, 849 Sun Valley Friday)', () => {
  const row = { runId: 'run_849', coverageType: 'UNITED DAIRY', days: { fri: { runs: false, date: '2026-10-30' } } };
  const ctx = { plant: { 'run_849|2026-10-30': [{ runId: 'run_849', carrier: true, poNumber: '46020' }] }, dup: {}, relief: {}, exceptions: [] };
  assert.equal(L.weeklyCellClass(row, 'fri', ctx), 'carrier', 'not black, and not counted as needing a driver');
  assert.equal(L.plantCarrier(ctx.plant['run_849|2026-10-30']), true);
  assert.equal(L.carrierLoad({ scheduleType: 'CARRIER' }), true);
  // A United Dairy load on the same day still needs a driver.
  ctx.plant['run_849|2026-10-30'].push({ runId: 'run_849' });
  assert.equal(L.weeklyCellClass(row, 'fri', ctx), 'plant');
  assert.equal(L.plantCarrier([]), false);
  // Marked Not running on Weekly, it is off like any other plant load.
  ctx.plant['run_849|2026-10-30'].pop();
  row.days.fri.plantLoadOff = true;
  assert.equal(L.weeklyCellClass(row, 'fri', ctx), 'off');
  // Joe 10/23 ("no matter who is running it"): a United Dairy load on a run an outside carrier covers shows too, as the carrier's.
  row.days.fri.plantLoadOff = false;
  ctx.plant['run_849|2026-10-30'] = [{ runId: 'run_849' }];
  assert.equal(L.weeklyCellClass(Object.assign({}, row, { coverageType: 'SUN VALLEY TRUCKING' }), 'fri', ctx), 'carrier');
});

test('Weekly: a day dispatch has a driver on never shows PLANT LOAD (Joe 10/20, 844 Ohio Processor)', () => {
  const row = { runId: 'run_844', coverageType: 'UNITED DAIRY', days: { wed: { runs: false, date: '2026-10-21', driverId: 'drv_jacobs', driver: 'JACOBS, JOEL' } } };
  const ctx = { plant: { 'run_844|2026-10-21': [{ runId: 'run_844' }] }, dup: {}, relief: {}, exceptions: [] };
  assert.equal(L.weeklyCellClass(row, 'wed', ctx), 'off', 'the driver shows, marked Not running, never PLANT LOAD');
  row.days.wed.runs = true;
  assert.equal(L.weeklyCellClass(row, 'wed', ctx), 'assigned');
  assert.equal(L.dispatchDriver({ driver: 'JACOBS, JOEL' }), 'JACOBS, JOEL');
  assert.equal(L.dispatchDriver({ driver: 'CARRIER' }), 'CARRIER');
  assert.equal(L.dispatchDriver({ driver: 'OPEN' }), '');
  assert.equal(L.dispatchDriver({ driver: '' }), '');
});

test('Daily: the trailer the plant put on a run\'s Scheduler load that day (Joe 10/20, Garber, Ventura, Ohio Processor)', () => {
  const rows = [{ runId: 'run_844', route: '844', run: '' }];
  const plant = L.plantByRun(rows, [{ runId: 'run_844', date: '2026-10-21', pickupTime: '16:00', trailer: '' }, { runId: 'run_844', date: '2026-10-21', pickupTime: '17:00', trailer: 't-10295' }]);
  assert.equal(L.plantTrailer(plant['run_844|2026-10-21']), 'T-10295');
  assert.equal(L.plantTrailer(plant['run_844|2026-10-22']), '');
  assert.equal(L.plantTrailer([{ trailer: ' ' }]), '');
});

test('weekly: an as-needed customer\'s Scheduler loads go on its LOAD 1, LOAD 2 runs by pickup time (Joe 10/14)', () => {
  const days = () => Object.fromEntries(L.DAYS.map(p => [p, { runs: false }]));
  const rows = [1, 2].map(n => ({ runId: 'c905_' + n, route: '905_' + n, run: 'ALDI - CHARLESTON LOAD ' + n, days: days() })).concat([{ runId: 'g892', route: '892', run: 'GARBER', days: days() }]);
  const pl = (id, pickupTime, runId) => ({ id, runId: runId || 'c905_1', date: '2026-10-15', pickupTime });
  const ctx = L.weeklyContext(rows, [], [], [pl('a', '09:00'), pl('b', '05:30'), pl('c', '08:05'), pl('g', '07:00', 'g892')]);
  assert.deepEqual(ctx.plant['c905_1|2026-10-15'].map(e => e.id), ['b']);
  assert.deepEqual(ctx.plant['c905_2|2026-10-15'].map(e => e.id), ['c', 'a'], 'more loads than LOAD runs share the last one');
  assert.deepEqual(ctx.plant['g892|2026-10-15'].map(e => e.id), ['g']);
});

test('Run / Destination text: 6301_1 reads Load 1, a blank run reads the route name (Joe 10/16)', () => {
  assert.equal(L.runText({ route: '6301_1', run: '6301_1', routeName: 'WALMART' }), 'Load 1');
  assert.equal(L.runText({ route: '8302_2', run: '8302_2' }), 'Load 2');
  assert.equal(L.runText({ route: '6301_1', run: '6301_1', routeRunType: 'Load 1 AM' }), 'Load 1 AM');
  assert.equal(L.runText({ route: '844', run: '', routeName: 'Ohio Processor', streamId: 'OH PROCESSORS' }), 'Ohio Processor');
  assert.equal(L.runText({ route: '877', run: '', streamId: 'COSTCO MD' }), 'COSTCO MD');
  assert.equal(L.runText({ route: '970', run: '970', routeName: 'ALDI' }), 'ALDI');
  assert.equal(L.runText({ route: '901_1', run: 'PRODUCT 1', routeName: 'MF' }), 'PRODUCT 1');
});

test('Joe 10/19: a branch box load starts the week as not running; every other run keeps Route Master days', () => {
  const days = { mon: { active: true, dispatchTime: 1260, tractor: '900001', trailer: 'T-901' }, tue: { active: true, dispatchTime: 1260 }, wed: { active: false } };
  const box = { id: 'run_950_2', route: '950', run: 'ALDI - CHARLESTON LOAD 1', loadType: 'Boxing', coverageType: 'BRANCH', days };
  const ctx = L.weekBuildContext([], [], [{ id: 'veh_900001', unit: '900001', type: 'TRUCK', status: 'ACTIVE' }, { id: 'veh_t_901', unit: 'T-901', type: 'TRAILER', status: 'ACTIVE' }]);
  assert.equal(L.boxLoadRun(box), true);
  const built = L.buildWeekRun(box, '2026-10-18', ctx);
  assert.deepEqual(L.DAYS.filter(p => built.days[p].runs), [], 'none of its days run until the dispatcher adds it');
  assert.equal(built.days.mon.dispatchTime, 1260, 'its depart time is kept for when it is turned on');
  assert.equal(built.days.mon.truck, '', 'no truck is booked for a day it does not run');
  // A box load that is not a branch's (Costco, USDA, an outside carrier) and a branch's case transfer keep their days.
  [{ loadType: 'Boxing', coverageType: 'UNITED DAIRY' }, { loadType: 'Boxing', coverageType: 'OUTSIDE CARRIER' }, { loadType: 'Case Loadout', coverageType: 'BRANCH' }].forEach(f => {
    const r = Object.assign({ id: 'run_x', route: '9', days }, f);
    assert.equal(L.boxLoadRun(r), false);
    assert.deepEqual(L.DAYS.filter(p => L.buildWeekRun(r, '2026-10-18', L.weekBuildContext([], [], [])).days[p].runs), ['mon', 'tue']);
  });
  assert.equal(L.boxLoadRun({ loadType: ' box loadout ', coverageType: 'branch' }), true);
  // Joe 10/19: "doesn't run" is only the default; a box load already on the Plant Scheduler for a day is built running that day.
  // Three Charleston loads on Tuesday 10-20 booked on Load 1 are Load 1, 2 and 3 (plantByRun), so Loads 2 and 3 run that day too.
  const loads = [1, 2, 3].map(n => ({ id: 'run_950_' + (n + 1), route: '950', run: 'ALDI - CHARLESTON LOAD ' + n, loadType: 'Boxing', coverageType: 'BRANCH', days }));
  const plan = [{ runId: 'run_950_2', date: '2026-10-20', pickupTime: '05:30' }, { runId: 'run_950_2', date: '2026-10-20', pickupTime: '08:00' }, { runId: 'run_950_2', date: '2026-10-19', pickupTime: '06:00' }];
  const pctx = L.weekBuildContext([], [], [], loads, plan);
  const ran = loads.map(r => L.DAYS.filter(p => L.buildWeekRun(r, '2026-10-18', pctx).days[p].runs));
  assert.deepEqual(ran, [['mon', 'tue'], ['tue'], []]);
});
