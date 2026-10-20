'use strict';
// Joe 10/19 (Late Forecast, option t): will the plant be late? Est. Done for every case load still to load, from the pace
// (same weekday's nights + tonight, the slowest past night as a cushion), in loading order; late = after it leaves or after
// the 6 a.m. shift end. Tonight's numbers are the real Monday 10-19-26 loadout read at 7:00 PM.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../src/plant-rules');

const NOW = Date.parse('2026-10-19T23:00:00Z'); // 7:00 PM Monday in New York
const MON = '2026-10-19', TUE = '2026-10-20';
const iso = (d, hm) => d + 'T' + hm + ':00-04:00';
const done = (route, from, to, cases, extra) => Object.assign({ id: route, route, run: '', area: 'CASE', state: 'DONE', loadDate: MON, deliveryDate: TUE, dispatchTime: 240, quantity: cases,
  startedAt: from === null ? '' : iso(MON, from), completedAt: iso(MON, to), prior: false }, extra || {});
const wait = (route, run, cases, dispatch, extra) => Object.assign({ id: route, route, run, area: 'CASE', state: 'WAITING', loadDate: MON, deliveryDate: TUE, departureDate: TUE, dispatchTime: dispatch, quantity: cases, prior: false }, extra || {});
const H = (h, m) => h * 60 + (m || 0);
const tonightDone = [done('849', '05:30', '06:47', 900), done('906', '10:35', '11:22', 863), done('980', '13:49', '13:49', 820), done('848', '13:49', '15:02', 892),
  done('852', '13:29', '16:00', 1150), done('827', '16:40', '17:50', 1017), done('6304', '17:53', '18:57', 887)];
const tonightLeft = [
  wait('845', 'I/W BALTIMORE', 316, H(21), { departureDate: MON, leavesOn: 'Load Day' }), wait('950_1', 'CHARLESTON', 668, H(16), { leavesOn: 'Delivery Day' }),
  wait('971', 'PAINTSVILLE', 812, H(2)), wait('813', 'DSD', 477, H(1, 30)), wait('803', 'DSD', 503, H(4)), wait('812', 'DSD', 450, H(5)), wait('822', 'DSD', 350, H(4, 30)),
  wait('808', 'DSD', 516, H(4)), wait('8303_1', 'WALMART', 996, H(5, 30)), wait('825', 'DSD', 252, H(5)), wait('805', 'DSD', 115, H(5)), wait('901_1', 'PRODUCT 1', 853, H(7), { leavesOn: 'Delivery Day' }),
  wait('909_1', 'MARIETTA LOAD 1', 1067, H(21), { leavesOn: 'Delivery Day' }), wait('907_1', 'FAIRMONT', 1073, H(9), { leavesOn: 'Delivery Day' })];
// A past night where a load of `rate` cases was done an hour after the one before it: `rate` cases an hour.
const night = (date, rate) => ({ date, loads: [{ area: 'CASE', state: 'DONE', quantity: 500, completedAt: date + 'T20:00:00-04:00' }, { area: 'CASE', state: 'DONE', quantity: rate, completedAt: date + 'T21:00:00-04:00' }] });
const up5 = (m) => Math.ceil(m / 5) * 5;

// Joe 10/20: "no way we would be done at midnight"; "1,000 cases takes 1 hour"; a 1- or 5-minute time is a mistake.
test('a night\'s pace: from one load\'s End to the next, against 1,000 cases an hour; long gaps left out', () => {
  // Tonight's Ends: 6:47, 11:22, 1:49, 3:02, 4:00, 5:50, 6:57. The 4 h 35 min before 906 is left out (over 3 hours).
  const p = R.nightPace(tonightDone);
  assert.equal(p.loads, 5);
  assert.equal(p.cases, 820 + 892 + 1150 + 1017 + 887);
  assert.equal(p.rate, Math.round(1000 * (0.06 * p.cases) / (147 + 73 + 58 + 110 + 67)), 'the time between loads counts');
  assert.ok(p.rate < 1000, 'tonight ran slower than 1,000 cases an hour');
  assert.equal(R.nightPace(night('2026-10-12', 1000).loads).rate, 1000);
  assert.equal(R.nightPace([done('1', '01:00', '02:00', 900)]), null, 'one load alone has nothing to measure from');
  assert.equal(R.nightPace([done('1', null, '01:00', 900), done('2', null, '05:00', 900)]), null, 'over 3 hours is left out');
  assert.equal(R.nightPace([done('1', null, '01:00', 900), done('2', null, '02:00', 900, { area: 'TOTES' })]), null, 'case loads only');
});

test('the same weekday is compared: Monday nights 1 to 4 weeks back', () => {
  assert.deepEqual(R.forecastNights(MON), ['2026-10-12', '2026-10-05', '2026-09-28', '2026-09-21']);
});

test('tonight blends with the slowest past night, and counts for more while there are few nights', () => {
  const f = R.loadForecast({ date: MON, loads: tonightDone.concat(tonightLeft), history: [night('2026-10-12', 785), night('2026-10-05', 744)] }, NOW);
  const t = R.nightPace(tonightDone);
  assert.equal(f.from, 'both');
  assert.equal(f.slow, 'Mon 10-5-26');
  const w = 5 / (5 + 1.5 * 2);
  assert.equal(f.rate, Math.round(w * t.rate + (1 - w) * 744));
  assert.ok(w > 0.5, 'tonight weighs more than the past nights while there are only two');
  assert.match(f.paceText, /^Mon 10-5-26, Mon 10-12-26 \+ tonight \(5 loads\), slow-night cushion$/);
  const more = R.loadForecast({ date: MON, loads: tonightDone, history: [1, 2, 3, 4].map(n => night('2026-09-' + (10 + n), 800)) }, NOW);
  assert.ok(more.weight < f.weight, 'more past nights, less weight on tonight');
  assert.equal(R.loadForecast({ date: MON, loads: tonightDone, history: [] }, NOW).from, 'tonight');
  assert.equal(R.loadForecast({ date: MON, loads: tonightLeft, history: [night('2026-10-12', 785)] }, NOW).rate, 785);
  assert.equal(R.loadForecast({ date: MON, loads: tonightLeft, history: [] }, NOW).rate, R.FORECAST.usualRate, 'nothing timed yet: the plant\'s usual pace');
});

test('loads follow each other in loading order; late = after dispatch or after the 6 a.m. shift end', () => {
  const f = R.loadForecast({ date: MON, loads: tonightDone.concat(tonightLeft), history: [night('2026-10-12', 785), night('2026-10-05', 744)] }, NOW);
  assert.deepEqual(f.loads.map(x => x.route), tonightLeft.map(x => x.route), 'loading order');
  const by = Object.fromEntries(f.loads.map(x => [x.route, x]));
  const now = R.wallClock(NOW);
  assert.equal(by['845'].start, now);
  f.loads.slice(1).forEach((x, i) => assert.equal(x.start, f.loads[i].est, x.route + ' starts when the one before is done'));
  // Bigger loads take longer; even a small one takes at least 15 minutes at the standard.
  assert.ok(by['907_1'].minutes > by['805'].minutes && by['805'].minutes >= Math.round(15 * 1000 / f.rate) - 1);
  f.loads.forEach(x => assert.equal(x.est % 5, 0, x.route + ' Est. Done is rounded up to 5 minutes'));
  assert.equal(by['845'].late, false);
  assert.equal(by['950_1'].late, false, 'Charleston leaves Tuesday 4 PM (Delivery Day) and is done tonight');
  const shiftEnd = R.wallClock(Date.parse('2026-10-20T10:00:00Z'));
  assert.equal(by['909_1'].shiftEnd, shiftEnd);
  assert.ok(by['909_1'].est > shiftEnd, 'Marietta is near the end of the line');
  assert.equal(by['909_1'].late, true);
  assert.equal(by['909_1'].reason, 'past the 6:00 AM shift end', 'it leaves Tuesday 9 PM, but the shift stops at 6 a.m.');
  assert.equal(by['909_1'].lateBy, by['909_1'].est - shiftEnd);
  assert.equal(f.late, f.loads.filter(x => x.late).length);
  assert.ok(f.late >= 1);
  // Due by 5:00 AM: the loads leaving by Tuesday 5:00 AM.
  assert.deepEqual(f.loads.filter(x => x.leaves <= f.dueAt).map(x => x.route).sort(), ['803', '805', '808', '812', '813', '822', '825', '845', '971']);
  assert.equal(f.due.loads, 9);
  assert.equal(f.due.cases, 316 + 812 + 477 + 503 + 450 + 350 + 516 + 252 + 115);
  assert.equal(f.dueByText, '5:00 AM');
  assert.equal(f.casesLeft, tonightLeft.reduce((a, x) => a + x.quantity, 0));
  assert.equal(f.allDone, Math.max(...f.loads.map(x => x.est)));
  // Due by 3:00 AM instead.
  assert.equal(R.loadForecast({ date: MON, loads: tonightLeft, dueBy: 180 }, NOW).due.loads, 3);
  // Each dispatch time ahead, with the loads leaving by then.
  const byTime = f.byTime;
  assert.equal(byTime[byTime.length - 1].loads, 14);
  assert.deepEqual(byTime.slice(0, 2).map(t => [t.day, t.time, t.loads]), [['Mon', '9:00 PM', 1], ['Tue', '1:30 AM', 2]]);
});

test('a load misses dispatch before the shift end', () => {
  const f = R.loadForecast({ date: MON, loads: [wait('1', '', 1200, H(19, 30), { departureDate: MON, leavesOn: 'Load Day' })] }, NOW);
  assert.equal(f.loads[0].late, true);
  assert.equal(f.loads[0].reason, 'misses dispatch');
  assert.match(R.forecastLateText(f)[0], /^1 est\. \d+:\d\d PM, leaves 7:30 PM$/);
});

test('a load being loaded finishes its own time after it started; the line waits for it', () => {
  const loading = wait('2', '', 600, H(4), { state: 'LOADING', startedAt: iso(MON, '18:30') });
  const f = R.loadForecast({ date: MON, loads: [wait('3', '', 600, H(4)), loading], history: [] }, NOW);
  const by = Object.fromEntries(f.loads.map(x => [x.route, x]));
  const start = R.wallClock(Date.parse(iso(MON, '18:30')));
  assert.equal(by['2'].est, up5(Math.max(start + by['2'].minutes, R.wallClock(NOW) + 5)));
  assert.equal(by['3'].start, by['2'].est);
  const stuck = R.loadForecast({ date: MON, loads: [Object.assign({}, loading, { startedAt: iso(MON, '12:00') })] }, NOW);
  assert.equal(stuck.loads[0].est, up5(R.wallClock(NOW) + 5), 'a load running long is done no sooner than 5 minutes from now');
});

test('a load with no cases counted takes the night\'s usual load', () => {
  const f = R.loadForecast({ date: MON, loads: [wait('4', '', '', H(4)), wait('5', '', 400, H(4)), wait('6', '', 800, H(4))] }, NOW);
  assert.equal(f.loads[0].noCases, true);
  assert.equal(f.loads[0].minutes, Math.round(R.FORECAST.perCase * 600 * R.FORECAST.usualRate / f.rate));
});

test('the email and the report carry the forecast', () => {
  const loads = tonightDone.concat(tonightLeft), forecast = R.loadForecast({ date: MON, loads, history: [night('2026-10-12', 785), night('2026-10-05', 744)] }, NOW);
  const r = R.plantReport({ loads, forecast }, NOW);
  assert.equal(r.forecast, forecast);
  const html = R.reportHtml(JSON.parse(JSON.stringify(r)), '');
  assert.match(html, /Forecast at 7:00 PM \(estimated\)/i);
  assert.match(html, new RegExp(forecast.late + ' loads? late'));
  assert.match(html, /Due by 5:00 AM/);
  assert.match(html, /Est\. Done/);
  assert.match(html, /past the 6:00 AM shift end/);
  assert.match(r.text, /^LATE FORECAST \(ESTIMATED\)/m);
  assert.match(r.text, /Due by 5:00 AM: 9 loads/);
  // Joe 10/20: "I don't want everybody to see basically our formula" - no pace, cases an hour or which nights it came from.
  [html, r.text].forEach(t => assert.doesNotMatch(t, /\bpace\b|cases an hour|cases\/hr|cushion|Mon 10-12-26/i));
  const none = R.reportHtml(JSON.parse(JSON.stringify(R.plantReport({ loads }, NOW))), '');
  assert.doesNotMatch(none, /Est\. Done|Forecast at/, 'a report without a forecast reads as before');
});

// Joe 10/19: "I would just like to be able to send it in the live version to see before I put it to everybody."
test('Send Test to Me goes only to the sender on live; the forecast box reaches the groups only once switched to everyone', async () => {
  const RM = require('../../src/reportmail');
  const loads = tonightDone.concat(tonightLeft), forecast = R.loadForecast({ date: MON, loads }, NOW), r = R.plantReport({ loads, forecast }, NOW);
  const base = { status: 'SENDING', mode: 'live', by: 'joe@uniteddairy.com', subject: r.subject, text: r.text, note: '', reportJson: JSON.stringify(r), groupName: 'Plant Managers' };
  const env = { MAIL_FROM: 'joe@uniteddairy.com', REPORT_TO: 'a@uniteddairy.com,b@uniteddairy.com' };
  const run = async (report, settings) => { const ref = { updates: [], update(x) { this.updates.push(x); } }; let sent = null;
    await RM.mailReport(ref, report, { env, settings, sendMail: async (m) => { sent = m; return { id: 'g', to: m.to }; } }); return { sent, ref }; };
  const test1 = await run(Object.assign({}, base, { testOnly: true }));
  assert.deepEqual(test1.sent.to, ['joe@uniteddairy.com'], 'only the person who pressed it');
  assert.equal(test1.ref.updates[0].testCopy, true);
  assert.match(test1.sent.html, /Forecast at/, 'the test carries the forecast box');
  const group = await run(base);
  assert.deepEqual(group.sent.to, ['a@uniteddairy.com', 'b@uniteddairy.com']);
  assert.doesNotMatch(group.sent.html, /Forecast at|Est\. Done/, 'the groups do not get the box until it is switched on');
  assert.doesNotMatch(group.sent.text, /LATE FORECAST|est\. done/);
  const everyone = await run(base, { forecastEveryone: true });
  assert.match(everyone.sent.html, /Forecast at/);
  assert.match(everyone.sent.text, /LATE FORECAST/);
  assert.equal(RM.recipients(Object.assign({}, base, { testOnly: true }), env).copy, true);
});

// Joe 10/20 (6:08 AM): "we still have leftover from last night before we even start today... we got to just have a
// continuation of the plant status."
test('after the 6 a.m. roll, last night\'s open loads are behind and are loaded first; a paused load waits its turn', () => {
  const at = Date.parse('2026-10-20T10:10:00Z'), WED = '2026-10-21';
  const left = (route, cases, dispatch, extra) => Object.assign(wait(route, '', cases, dispatch, { leavesOn: 'Delivery Day', prior: true }), extra || {});
  const today = (route, cases, dispatch, extra) => Object.assign({ id: route, route, run: '', area: 'CASE', state: 'WAITING', loadDate: TUE, deliveryDate: WED, departureDate: WED, dispatchTime: dispatch, quantity: cases, leavesOn: 'Delivery Day', prior: false }, extra || {});
  const loads = [today('855', 600, H(8), { deliveryDate: TUE, departureDate: TUE, leavesOn: 'Load Day' }), left('971', 812, H(2)),
    left('901', 853, H(7), { state: 'LOADING', paused: true, startedAt: '2026-10-20T08:39:00Z' }), left('909', 1067, H(6)), today('852', 1150, H(13), { leavesOn: 'Load Day' })];
  const r = R.plantReport({ loads }, at);
  assert.deepEqual(r.behind.map(x => x.route).sort(), ['901', '909', '971']);
  assert.equal(r.behind.find(x => x.route === '909').late, 'left over from Mon 10-19-26', 'not yet past its dispatch, but left over');
  assert.match(r.behind.find(x => x.route === '971').late, /h \d+ min late$/, 'past its dispatch: how late');
  assert.deepEqual(r.nextUp.map(x => x.route), ['855', '852']);
  const ahead = R.plantReport({ loads: [left('950', 668, H(16), { deliveryDate: WED, departureDate: WED })] }, at);
  assert.deepEqual([ahead.behind.length, ahead.nextUp.length], [0, 1], 'left over but leaving after this shift (a Saturday loadout for Monday): not behind yet');
  const f = R.loadForecast({ date: TUE, loads }, at);
  assert.deepEqual(f.loads.map(x => x.route), ['971', '901', '909', '855', '852'], 'left-over loads first, in their order, then today\'s');
  assert.equal(f.loads[1].start, f.loads[0].est, 'the paused load is not loading: it follows the one before it');
  assert.ok(f.loads[3].start >= f.loads[2].est, 'today\'s first load starts after the last left-over one');
  assert.equal(f.loads[3].late, true);
  assert.equal(f.loads[3].reason, 'misses dispatch');
});
