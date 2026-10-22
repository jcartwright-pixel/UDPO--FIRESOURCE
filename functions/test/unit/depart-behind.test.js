'use strict';
// Behind is measured from when the route leaves, not from the loadout day (Joe 10/11: a Saturday loadout for Monday showed
// "14 routes behind" at 12:27 AM Sunday). The route leaves on its departure date (blank = delivery date) at its dispatch time;
// a load made earlier leaves in the operating day before, since the day rolls at 6 a.m. (Joe 10/19: Tuesday's 1 PM Jersey leaves Monday).
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../src/plant-rules');

const at = (iso) => Date.parse(iso); // New York is UTC-4 in October
const load = (route, time, extra) => Object.assign({ route, run: 'X', area: 'CASE', state: 'WAITING', loadDate: '2026-10-10', deliveryDate: '2026-10-12', dispatchTime: time, prior: false }, extra || {});
const day = (k) => Math.round(Date.UTC(...k.split('-').map((v, i) => i === 1 ? v - 1 : +v)) / 86400000) * 1440;

test('a route leaves at its dispatch time in the operating day before its departure date, never on the load day', () => {
  assert.equal(R.departWall(load('971', 0)), day('2026-10-12'), 'Saturday load for Monday, 12:00 AM = Monday midnight');
  assert.equal(R.departWall(load('844', 1080)), day('2026-10-11') + 1080, 'Saturday load for Monday, 6:00 PM = Sunday evening (the day rolls at 6 a.m.)');
  assert.equal(R.departWall(load('852', 780, { loadDate: '2026-10-19', deliveryDate: '2026-10-20' })), day('2026-10-19') + 780, 'Monday load for Tuesday, 1:00 PM Jersey = Monday 1:00 PM');
  assert.equal(R.departWall(load('827', 60, { loadDate: '2026-10-19', deliveryDate: '2026-10-20' })), day('2026-10-20') + 60, 'Monday load for Tuesday, 1:00 AM = after midnight, Tuesday');
  assert.equal(R.departWall(load('901', 420, { loadDate: '2026-10-20', deliveryDate: '2026-10-20' })), day('2026-10-20') + 420, 'loaded the same day: leaves that day');
  assert.equal(R.departWall(load('880', 120, { departureDate: '2026-10-11' })), day('2026-10-11') + 120, 'the departure date on the sheet wins');
  assert.equal(R.departWall(load('3', null)), null);
});

test('Send Current Report: the Monday routes are not behind on Sunday until they leave', () => {
  const loads = [load('971', 0), load('880', 120), load('844', 1080), load('845', 1260, { state: 'DONE' })];
  assert.equal(R.plantReport({ loads }, at('2026-10-11T04:27:00Z')).behind.length, 0, '12:27 AM Sunday');
  assert.equal(R.plantReport({ loads }, at('2026-10-11T22:45:00Z')).behind.length, 0, '6:45 PM Sunday: 844 is 45 minutes past, not behind');
  assert.deepEqual(R.plantReport({ loads }, at('2026-10-11T23:00:00Z')).behind.map(x => x.route), ['844'], '7:00 PM Sunday: the 6:00 PM leaves Sunday, so it is behind');
  assert.equal(R.plantReport({ loads }, at('2026-10-12T04:45:00Z')).behind.map(x => x.route).join(), '844', '12:45 AM Monday: 971 is 45 minutes past, not behind (844 from Sunday is)');
  const r = R.plantReport({ loads }, at('2026-10-12T04:46:00Z'));
  assert.deepEqual(r.behind.map(x => x.route), ['844', '971'], '12:46 AM Monday: 844 still not loaded, 971 is 46 minutes past');
  assert.equal(r.behind[1].late, '46 min late');
});

// Joe 10/19 ("look into the route setup"): the Route Editor's Departure Day decides the day. Load Day = the delivery date plus
// the day's load-day offset (Jersey, -1: Monday), Delivery Day = the delivery date, at the dispatch time either way.
test('Departure Day from the route setup decides the day a load leaves', () => {
  const tue = (route, time, leavesOn) => load(route, time, { loadDate: '2026-10-19', deliveryDate: '2026-10-20', departureDate: '2026-10-20', leavesOn });
  assert.equal(R.departWall(tue('852', 780, 'Load Day')), day('2026-10-19') + 780, 'Jersey, Load Day: Monday 1:00 PM');
  assert.equal(R.departWall(tue('844', 1260, 'Load Day')), day('2026-10-19') + 1260, 'Ohio Processor, Load Day: Monday 9:00 PM');
  assert.equal(R.departWall(tue('901', 420, 'Delivery Day')), day('2026-10-20') + 420, '901, Delivery Day: Tuesday 7:00 AM');
  assert.equal(R.departWall(tue('907', 540, 'Delivery Day')), day('2026-10-20') + 540, '907, Delivery Day: Tuesday 9:00 AM');
  assert.equal(R.departWall(tue('827', 60, 'Delivery Day')), day('2026-10-20') + 60, '827, Delivery Day: Tuesday 1:00 AM');
  // Joe 10/21 (Sun Valley 849, Load Day at 4:00 AM, showed 12 h 55 min late all day): a Load Day time before the 6 a.m. roll is
  // the end of the load day's shift, the next morning; it cannot leave before the shift that loads it starts.
  assert.equal(R.departWall(tue('849', 240, 'Load Day')), day('2026-10-20') + 240, 'Sun Valley, Load Day 4:00 AM: Tuesday 4:00 AM');
  assert.equal(R.departWall(tue('849', 360, 'Load Day')), day('2026-10-19') + 360, 'Load Day 6:00 AM: the load date');
  assert.equal(R.departWall(tue('901', 420, '')), day('2026-10-19') + 420, 'no Departure Day: the 6 a.m. guess');
  const loads = [tue('852', 780, 'Load Day'), tue('901', 420, 'Delivery Day'), tue('907', 540, 'Delivery Day'), tue('827', 60, 'Delivery Day')];
  assert.deepEqual(R.plantReport({ loads }, at('2026-10-19T18:57:00Z')).behind.map(x => x.route), ['852'], 'Monday 2:57 PM: only Jersey is behind');
});

// Audit batch 1 (Joe 10/22, "ah"): every screen agrees on when a load leaves. The Loadout Center's Behind (plant-core.js) asks
// plant-rules.js, so it has the 10/21 next-morning rule too, and Yard Checks follows the route's Departure Day.
test('Yard Checks: a load with a Departure Day stays on the yard until it leaves by the same rule as the Late Forecast', () => {
  const week = '2026-10-18';
  const run = (id, route, leavesOn, tue) => ({ id, weekStart: week, route, run: route, masterShow: leavesOn ? { leavesOn } : undefined,
    days: { tue: Object.assign({ loadDate: '2026-10-19', deliveryDate: '2026-10-20', departureDate: '2026-10-20', loadStatus: 'COMPLETE', completeTime: '2026-10-20T00:30:00Z' }, tue) } });
  const runs = [run('a', '950', 'Delivery Day', { dispatchTime: '10:00 PM', trailer: 'T-950' }), run('b', '852', 'Load Day', { dispatchTime: '9:00 PM', trailer: 'T-852' }),
    run('c', '849', 'Load Day', { dispatchTime: '4:00 AM', trailer: 'T-849' })];
  const queue = (iso, date) => R.yardQueue(runs, [], date, at(iso)).rows.map(x => x.trailer).sort();
  // Monday 11:00 PM: Jersey (Load Day, 9 PM Monday) has left; Charleston Transfer (Delivery Day) leaves Tuesday 10 PM and Sun
  // Valley (Load Day, 4 AM) leaves Tuesday 4 AM, so both are still on the yard.
  assert.deepEqual(queue('2026-10-20T03:00:00Z', '2026-10-19'), ['T-849', 'T-950']);
  // Tuesday 4:30 AM (still Monday's operating day): Sun Valley has left.
  assert.deepEqual(queue('2026-10-20T08:30:00Z', '2026-10-19'), ['T-950']);
  // Tuesday 9:59 PM: Charleston Transfer is still there; at 10:00 PM it has left.
  assert.deepEqual(queue('2026-10-21T01:59:00Z', '2026-10-20'), ['T-950']);
  assert.deepEqual(queue('2026-10-21T02:00:00Z', '2026-10-20'), []);
});

test('the Loadout Center and the other plant screens use the Late Forecast\'s leave rule, not a copy of their own', () => {
  const fs = require('fs'), path = require('path'), pub = path.join(__dirname, '../../../public');
  const core = fs.readFileSync(path.join(pub, 'js/plant-core.js'), 'utf8');
  assert.match(core, /export function departWall\(row\) \{\s*return window\.UDPlant\.departWall\(/);
  // Every page that can reach it (directly or through the plant screens' shared files) loads plant-rules.js first. Daily
  // Dispatch takes only runArea from plant-core.js.
  const users = /js\/(plant-core|plant-dept|plant-reports|station-work|forecast)\.js/;
  fs.readdirSync(pub).filter(f => f.endsWith('.html') && f !== 'daily.html').forEach(f => {
    const html = fs.readFileSync(path.join(pub, f), 'utf8');
    if (users.test(html)) assert.match(html, /<script src="js\/plant-rules\.js"><\/script>/, f + ' loads plant-rules.js');
  });
});
