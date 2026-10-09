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
