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
