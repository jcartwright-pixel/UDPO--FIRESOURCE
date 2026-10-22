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

// Joe 10/22 (7:36 AM "About 8 hr 20 min behind" with nothing loaded): only real loading time counts, Start to End, 10 minutes to 3 hours.
test('a night\'s speed: each load\'s own Start to End, against 1,000 cases an hour; missed or bunched presses left out', () => {
  // Tonight: 849 77 min, 906 47, 980 0 (Start and End pressed together: left out), 848 73, 852 151, 827 70, 6304 64.
  const p = R.nightPace(tonightDone);
  assert.equal(p.loads, 6);
  assert.equal(p.cases, 900 + 863 + 892 + 1150 + 1017 + 887);
  assert.equal(p.rate, Math.round(1000 * (0.06 * p.cases) / (77 + 47 + 73 + 151 + 70 + 64)), 'waits between loads do not count');
  assert.equal(R.cleanMinutes(done('1', '01:00', '01:05', 900)), null, 'a 5-minute load is a bunched press');
  assert.equal(R.cleanMinutes(done('1', '01:00', '04:30', 900)), null, 'over 3 hours is a missed End');
  assert.equal(R.cleanMinutes(done('1', null, '01:00', 900)), null, 'no Start, no time');
  assert.equal(R.cleanMinutes(done('1', '01:00', '02:00', 900, { area: 'TOTES' })), null, 'case loads only');
  assert.equal(R.cleanMinutes(done('1', '01:00', '02:00', 900)), 60);
  assert.equal(R.nightPace([done('1', '01:00', '02:00', 1000)]).rate, 1000);
});

test('the same weekday is compared: Monday nights 1 to 4 weeks back', () => {
  assert.deepEqual(R.forecastNights(MON), ['2026-10-12', '2026-10-05', '2026-09-28', '2026-09-21']);
});

// Joe 10/22 ("some kind of percentage of using past data until it builds up… 80% max… every week, let's increase that").
test('past nights count 10% in the week of Sun 10-18-26, 10% more each week, never over 80%', () => {
  assert.equal(R.historyShare('2026-10-18'), 0.1);
  assert.equal(R.historyShare('2026-10-24'), 0.1, 'Saturday is the same week');
  assert.equal(R.historyShare('2026-10-25'), 0.2);
  assert.equal(R.historyShare('2026-11-29'), 0.7);
  assert.equal(R.historyShare('2026-12-06'), 0.8);
  assert.equal(R.historyShare('2027-03-01'), 0.8, 'never over 80%');
  assert.equal(R.historyShare('2026-10-01'), 0.1);
});

// A past night where one load of `cases` cases loaded in an hour.
const timedNight = (date, cases, route) => ({ date, loads: [{ area: 'CASE', state: 'DONE', route: route || 'X', run: '', quantity: cases, startedAt: date + 'T20:00:00-04:00', completedAt: date + 'T21:00:00-04:00' }] });
// Joe 10/22 (option az): a fresh start at 6 AM on the 1,000 rule; today's own speed once 3 of today's loads are timed.
test('the 1,000 rule until 3 of today\'s loads are timed, then today\'s speed; past nights blend in by the week\'s share', () => {
  const one = wait('1', '', 1000, H(4));
  const rule = R.loadForecast({ date: MON, loads: [one], history: [] }, NOW);
  assert.equal(rule.from, 'rule');
  assert.equal(rule.rate, 1000);
  assert.equal(rule.share, 0, 'no past nights: nothing to blend');
  assert.equal(rule.loads[0].minutes, 60);
  const two = R.loadForecast({ date: MON, loads: tonightDone.slice(0, 2).concat([one]), history: [] }, NOW);
  assert.equal(two.from, 'rule', 'two timed loads today are not enough');
  const t = R.loadForecast({ date: MON, loads: tonightDone.concat([one]), history: [] }, NOW);
  assert.equal(t.from, 'today');
  assert.equal(t.rate, R.nightPace(tonightDone).rate);
  assert.equal(t.loads[0].minutes, Math.round(60 * 1000 / t.rate));
  // Mon 10-19-26 is in the first week (10%). A past Monday that loaded 500 cases an hour: 1,000 cases = 120 minutes there.
  const h = R.loadForecast({ date: MON, loads: [one], history: [timedNight('2026-10-12', 500)] }, NOW);
  assert.equal(h.share, 0.1);
  assert.equal(h.loads[0].minutes, Math.round(0.9 * 60 + 0.1 * 120));
  const later = R.loadForecast({ date: '2026-12-07', loads: [Object.assign({}, one, { loadDate: '2026-12-07', deliveryDate: '2026-12-08', departureDate: '2026-12-08' })], history: [timedNight('2026-11-30', 500)] }, Date.parse('2026-12-07T23:00:00Z'));
  assert.equal(later.share, 0.8);
  assert.equal(later.loads[0].minutes, Math.round(0.2 * 60 + 0.8 * 120));
  // A past night timed only from End to End (no Start) has nothing clean to give.
  assert.equal(R.loadForecast({ date: MON, loads: [one], history: [{ date: '2026-10-12', loads: [{ area: 'CASE', state: 'DONE', quantity: 500, completedAt: '2026-10-12T20:00:00-04:00' }] }] }, NOW).share, 0);
  assert.doesNotMatch(h.paceText, /cushion/);
  assert.match(h.paceText, /^1,000 cases an hour \+ 10% past nights \(Mon 10-12-26\)$/);
});

test('loads follow each other in loading order; late = done after its own dispatch', () => {
  const f = R.loadForecast({ date: MON, loads: tonightLeft, history: [] }, NOW);
  assert.deepEqual(f.loads.map(x => x.route), tonightLeft.map(x => x.route), 'loading order');
  const by = Object.fromEntries(f.loads.map(x => [x.route, x]));
  const now = R.wallClock(NOW);
  assert.equal(by['845'].start, now);
  f.loads.slice(1).forEach((x, i) => assert.equal(x.start, f.loads[i].est, x.route + ' starts when the one before is done'));
  // Bigger loads take longer; even a small one takes at least 15 minutes at the standard.
  assert.ok(by['907_1'].minutes > by['805'].minutes && by['805'].minutes === 15, 'a small load takes 15 minutes at 1,000 an hour');
  f.loads.forEach(x => assert.equal(x.est % 5, 0, x.route + ' Est. Done is rounded up to 5 minutes'));
  assert.equal(by['845'].late, false);
  assert.equal(by['950_1'].late, false, 'Charleston leaves Tuesday 4 PM (Delivery Day) and is done tonight');
  const shiftEnd = R.wallClock(Date.parse('2026-10-20T10:00:00Z'));
  assert.equal(by['909_1'].shiftEnd, shiftEnd);
  assert.equal(f.late, f.loads.filter(x => x.late).length);
  f.loads.forEach(x => assert.equal(x.late, x.est > x.leaves, x.route + ' is late only when done after its own dispatch'));
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

// Joe 10/22 ("Route 8302 being late, but the dispatch time is 9 a.m., so that's not late"): done after 6 AM but before its own
// dispatch is on time; the 6:00 AM shift end counts only for a load with no dispatch time.
test('a load done after 6 AM but before its own dispatch is not late; one with no dispatch time is late after 6 AM', () => {
  const at = Date.parse('2026-10-20T09:30:00Z'); // Tue 5:30 AM, Monday's operating day
  const f = R.loadForecast({ date: MON, loads: [wait('8302', 'WALMART', 900, H(9), { leavesOn: 'Delivery Day' }), wait('x', '', 900, null)] }, at);
  const by = Object.fromEntries(f.loads.map(x => [x.route, x]));
  assert.ok(by['8302'].est > by['8302'].shiftEnd, '8302 is done after 6 AM');
  assert.equal(by['8302'].late, false, 'but it leaves at 9:00 AM');
  assert.equal(by['x'].leaves, null);
  assert.equal(by['x'].late, true);
  assert.equal(by['x'].reason, 'past the 6:00 AM shift end');
  assert.equal(f.late, 1);
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
  // 6304 leaves at 9:00 PM tonight on its load day and cannot be done by then.
  const loads = tonightDone.concat([wait('6304_2', 'WALMART', 1200, H(19, 30), { departureDate: MON, leavesOn: 'Load Day' })], tonightLeft), forecast = R.loadForecast({ date: MON, loads, history: [] }, NOW);
  const r = R.plantReport({ loads, forecast }, NOW);
  assert.equal(r.forecast, forecast);
  const html = R.reportHtml(JSON.parse(JSON.stringify(r)), '');
  assert.match(html, /Forecast at 7:00 PM \(estimated\)/i);
  assert.match(html, new RegExp(forecast.late + ' loads? potentially late'));
  // Joe 10/20: "I don't need this great big long recap up here": how far behind, not a line for every late load.
  assert.ok(forecast.behind > 0 && forecast.behind % 5 === 0);
  assert.match(html, new RegExp('About ' + R.forecastSummary(forecast).behindText.replace(/^About /, '')));
  assert.doesNotMatch(html, /est\. [0-9:]+ [AP]M, (leaves|past the)/);
  assert.match(r.text, /About .* behind/);
  // Joe 10/22 (option az): every time has its day.
  assert.match(html, /Due by Tue 5:00 AM: \d+ loads, [\d,]+ cases.*est\. Tue \d+:\d\d [AP]M/);
  assert.match(html, /All loads done.*est\. (Mon|Tue) \d+:\d\d [AP]M/);
  assert.match(html, /Est\. Done/);
  assert.match(html, /misses dispatch/);
  assert.match(r.text, /^LATE FORECAST \(ESTIMATED\)/m);
  assert.match(r.text, /Due by Tue 5:00 AM: 10 loads, [\d,]+ cases, est\. done Tue \d+:\d\d [AP]M/);
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

// Joe 10/20: "on the next report, made up, you know, so many hours" - compared with the shift's earlier report.
test('the forecast says how far behind it is and what was made up or lost since the earlier report', () => {
  const f = { asOf: '10:42 AM', late: 2, loads: [{ late: true, lateBy: 61 }, { late: true, lateBy: 778 }, { late: false, lateBy: 0 }] };
  assert.equal(R.forecastBehind(f), 780);
  assert.equal(R.forecastSummary(f).behindText, 'About 13 hr behind');
  assert.equal(R.forecastSummary(f).changeText, '', 'the first report of the shift has nothing to compare with');
  assert.equal(R.forecastSummary(Object.assign({}, f, { before: { asOf: '8:42 AM', behind: 860 } })).changeText, 'Made up 1 hr 20 min since the 8:42 AM report');
  assert.equal(R.forecastSummary(Object.assign({}, f, { before: { asOf: '8:42 AM', behind: 740 } })).changeText, 'Lost 40 min since the 8:42 AM report');
  assert.equal(R.forecastSummary(Object.assign({}, f, { before: { asOf: '8:42 AM', behind: 780 } })).changeText, 'No change since the 8:42 AM report');
  const caught = { asOf: '2:00 PM', late: 0, loads: [], before: { asOf: '12:00 PM', behind: 45 } };
  assert.equal(R.forecastSummary(caught).behindText, '');
  assert.equal(R.forecastSummary(caught).changeText, 'Made up 45 min since the 12:00 PM report');
  const html = R.reportHtml({ dayLabel: 'Tue', behind: [], loaded: [], nextUp: [], pickups: [], down: [], lines: [], temperatures: [], areas: [], totalLoads: 0, leftToLoad: 0,
    forecast: Object.assign({ due: { loads: 0, cases: 0, late: 0 }, dueByText: '5:00 AM', allDoneText: '', casesLeft: 0, byTime: [] }, f, { before: { asOf: '8:42 AM', behind: 860 } }) }, '');
  assert.match(html, /2 loads potentially late/);
  assert.match(html, /About 13 hr behind/);
  assert.match(html, /Made up 1 hr 20 min since the 8:42 AM report/);
});

// Joe 10/20 (10:42 AM report: every load 1 hr 40 min): a load with no case count yet is sized from its own route's past
// nights, not from the few big loads counted so far tonight.
test('a load with no case count is sized from its own route, and "1,150" reads as 1,150 cases', () => {
  const at = (h, m) => new Date(Date.UTC(2026, 9, 13, h + 4, m)).toISOString();
  const past = { date: '2026-10-13', loads: [
    { id: 'p1', area: 'CASE', route: '808', run: 'DSD', quantity: '400', state: 'DONE', completedAt: at(20, 0) },
    { id: 'p2', area: 'CASE', route: '907_1', run: 'FAIRMONT TRANSFER', quantity: '1,200', state: 'DONE', completedAt: at(21, 0) },
    { id: 'p3', area: 'CASE', route: '822', run: 'DSD', quantity: 380, state: 'DONE', completedAt: at(22, 0) }] };
  const now = Date.UTC(2026, 9, 20, 14, 42);
  const loads = [
    { id: 't1', area: 'CASE', route: '907_1', run: 'FAIRMONT TRANSFER', quantity: '1,200', state: 'NOT_STARTED', loadDate: '2026-10-20', deliveryDate: '2026-10-21', dispatchTime: '8:00 PM' },
    { id: 't2', area: 'CASE', route: '808', run: 'DSD', quantity: '', state: 'NOT_STARTED', loadDate: '2026-10-20', deliveryDate: '2026-10-21', dispatchTime: '4:00 AM' }];
  const f = R.loadForecast({ date: '2026-10-20', loads, history: [past] }, now);
  const t1 = f.loads.find(x => x.id === 't1'), t2 = f.loads.find(x => x.id === 't2');
  assert.equal(t1.cases, 1200);
  assert.equal(t2.cases, 0);
  assert.ok(t2.minutes < t1.minutes / 2, '808 is sized as its usual 400 cases, not as tonight\'s 1,200-case transfer');
});

// Joe 10/21: "We'll know exactly how long each route takes to load", and the right pane red only where loads are late.
test('a run with past nights takes its own time, and a due-by time is red only for the late loads leaving then', () => {
  const at = (d, h, m) => new Date(Date.UTC(2026, 9, d, h + 4, m)).toISOString();
  const past = (d) => ({ date: '2026-10-' + d, loads: [
    { id: 'a' + d, area: 'CASE', route: '808', run: 'DSD', quantity: '400', state: 'DONE', startedAt: at(d, 19, 40), completedAt: at(d, 20, 0) },
    { id: 'b' + d, area: 'CASE', route: '812', run: 'DSD', quantity: '400', state: 'DONE', startedAt: at(d, 20, 0), completedAt: at(d, 20, 20) },
    { id: 'c' + d, area: 'CASE', route: '822', run: 'DSD', quantity: '400', state: 'DONE', startedAt: at(d, 20, 20), completedAt: at(d, 21, 50) }] });
  const now = Date.UTC(2026, 9, 21, 22, 0);
  const L = (route, disp) => ({ id: 't' + route, area: 'CASE', route, run: 'DSD', quantity: '400', state: 'NOT_STARTED', loadDate: '2026-10-21', deliveryDate: '2026-10-22', dispatchTime: disp });
  const f = R.loadForecast({ date: '2026-10-21', loads: [L('812', '18:20'), L('822', '04:00')], history: [past(14), past(7)] }, now);
  const by = Object.fromEntries(f.loads.map(x => [x.route, x]));
  assert.ok(by['812'].minutes < by['822'].minutes, '812 has loaded in 20 minutes, 822 in 90: each takes its own time');
  const t7 = f.byTime.find(t => t.time === '6:20 PM'), t4 = f.byTime.find(t => t.time === '4:00 AM');
  assert.equal(t7.lateHere, 1, '812 leaves at 6:20 PM and is late');
  assert.equal(t4.late, 1, 'by 4:00 AM one load is late in all');
  assert.equal(t4.lateHere, 0, 'but nothing leaving at 4:00 AM is late, so that time is not red');
});

// Joe 10/21 (7:46 AM email "About 12 hr 50 min behind"): "whenever it shifts over, just add the length of that remaining route".
test('a load left over from last night is behind only by the loading it still has to do', () => {
  const now = Date.UTC(2026, 9, 21, 11, 46);
  const loads = [
    { id: 'p', area: 'CASE', route: '907_1', run: 'FAIRMONT TRANSFER', quantity: '828', state: 'NOT_STARTED', loadDate: '2026-10-20', deliveryDate: '2026-10-21', dispatchTime: '8:00 AM', leavesOn: 'Delivery Day', prior: true },
    { id: 't', area: 'CASE', route: '856', run: 'SAVE-A-LOT 2', quantity: '900', state: 'NOT_STARTED', loadDate: '2026-10-21', deliveryDate: '2026-10-22', dispatchTime: '3:00 PM', leavesOn: 'Load Day' }];
  const f = R.loadForecast({ date: '2026-10-21', loads }, now);
  const p = f.loads.find(x => x.id === 'p');
  assert.equal(p.late, true, 'done after its 8:00 AM dispatch');
  assert.equal(p.reason, 'misses dispatch');
  assert.ok(p.est - p.shiftEnd > p.minutes, 'it finishes more than its own loading time after 6 a.m.');
  assert.equal(p.lateBy, Math.min(p.est - p.leaves, p.est - Math.max(p.start, f.now)), 'behind by no more than its own loading time');
  assert.ok(p.lateBy <= p.est - Math.max(p.start, f.now));
  assert.equal(f.behind, Math.ceil(p.lateBy / 5) * 5);
});

// Joe 10/22 (7:36 AM, 0 of 29 loaded, "About 8 hr 20 min behind"; option az): a fresh start at 6 AM. Last night's left-over
// loads go first with their own times on their own line; today's loads go at 1,000 cases an hour, so a morning with nothing
// loaded yet is not hours behind. Past nights timed End to End (waits counted as loading) no longer slow it down.
test('the morning after a slow night: left-over loads on their own line, today on time', () => {
  const at = Date.parse('2026-10-22T11:36:00Z'), WED = '2026-10-21', THU = '2026-10-22', FRI = '2026-10-23';
  const row = (id, route, run, cases, dispatch, extra) => Object.assign({ id, route, run, area: 'CASE', state: 'WAITING', loadDate: THU, deliveryDate: FRI, departureDate: FRI, leavesOn: 'Delivery Day', dispatchTime: dispatch, quantity: cases, prior: false }, extra || {});
  const left = (id, route, run, cases, dispatch) => row(id, route, run, cases, dispatch, { loadDate: WED, deliveryDate: THU, departureDate: THU, prior: true });
  const today = [['813', 1, 30], ['824', 1], ['6303', 1], ['854', 2], ['880', 2], ['6302', 3], ['6304', 3], ['808', 3, 45], ['8301', 4], ['803', 4, 30], ['812', 5], ['6301_1', 5], ['822', 5, 15], ['825', 5, 30],
    ['901_1', 7], ['980', 7], ['907', 8], ['971', 8], ['909_1', 6], ['8302_1', 9], ['6301_2', 9], ['901_2', 11]].map(([r, h, m]) => row('t' + r, r, '', 300, H(h, m)));
  // A past Thursday where every load waited an hour on product before the next: End to End it read about 300 cases an hour.
  const past = { date: '2026-10-15', loads: [0, 1, 2, 3].map(i => ({ id: 'h' + i, area: 'CASE', route: '6302', run: '', quantity: 300, state: 'DONE', completedAt: '2026-10-15T' + (20 + i) + ':00:00-04:00' })) };
  const loads = [left('p901', '901_1', 'PRODUCT 1', 850, H(7)), left('p907', '907', 'FAIRMONT TRANSFER', 850, H(8))].concat(today);
  const f = R.loadForecast({ date: THU, loads, history: [past] }, at);
  assert.equal(f.rate, 1000);
  assert.equal(f.share, 0, 'the past night has no Start times: nothing clean to blend in');
  assert.equal(f.todayLate, 0, 'today\'s loads are on time');
  assert.deepEqual([f.prior.loads, f.prior.cases, f.prior.from], [2, 1700, 'Wed 10-21-26']);
  assert.match(f.prior.doneWhen, /^Thu \d+:\d\d AM$/);
  assert.ok(f.behind <= 120, 'behind by the left-over loading only, not 8 hours: ' + f.behind);
  assert.match(f.allDoneWhen, /^Thu /);
  const r = R.plantReport({ loads, forecast: f }, at), html = R.reportHtml(JSON.parse(JSON.stringify(r)), '');
  assert.match(html, /Left over from Wed 10-21-26: 2 loads, 1,700 cases/);
  assert.match(html, /Today&#39;s loads|Today's loads/);
  assert.match(html, /On time/);
  assert.match(r.text, /Left over from Wed 10-21-26: 2 loads, 1,700 cases, est\. done Thu \d+:\d\d AM/);
  assert.match(r.text, /Today's loads: on time/);
});

// Joe 10/22 ("When these are paused, you're showing time like total time. That shouldn't count as loading time"): paused
// minutes never count as loading time, on Total Time or in the forecast's past speed.
test('paused minutes are not loading time: Total Time, the clean loading time and a pause from an older note', () => {
  const at = (hm) => Date.parse(iso(MON, hm));
  // Started 2:00 PM, paused 2:30 PM, still paused at 7:00 PM: 4 h 30 min of it paused.
  const paused = { startedAt: iso(MON, '14:00'), paused: true, pauseMark: { at: iso(MON, '14:30'), minutes: 0 } };
  assert.equal(R.pausedMinutes(paused, NOW), 270);
  // A load paused before pauses were timed: its last "Paused" note says when.
  assert.equal(R.pausedMinutes({ startedAt: iso(MON, '10:00'), paused: true, notes: 'Paused 10/19, 11:37 AM: No buttermilk\nPaused 10/19, 2:43 PM: No skim', pauseMark: null }, NOW), 257);
  assert.equal(R.pausedMinutes({ startedAt: iso(MON, '10:00'), paused: true, notes: 'Not started yet' }, NOW), 0, 'no note: nothing known to take off');
  // Pause, resume, pause again, resume: both pauses add up; a new pause starts its own clock.
  let m = R.nextPauseMark({ startedAt: iso(MON, '14:00'), paused: false }, true, false, new Date(at('14:30')).toISOString());
  m = R.nextPauseMark({ startedAt: iso(MON, '14:00'), paused: true, pauseMark: m }, false, false, new Date(at('15:00')).toISOString());
  assert.deepEqual(m, { at: '', minutes: 30 });
  m = R.nextPauseMark({ startedAt: iso(MON, '14:00'), paused: false, pauseMark: m }, true, false, new Date(at('16:00')).toISOString());
  m = R.nextPauseMark({ startedAt: iso(MON, '14:00'), paused: true, pauseMark: m }, false, false, new Date(at('16:20')).toISOString());
  assert.deepEqual(m, { at: '', minutes: 50 });
  assert.deepEqual(R.nextPauseMark({ paused: false, pauseMark: m }, false, true, iso(MON, '17:00')), { at: '', minutes: 0 }, 'back to waiting starts over');
  // Start 2:00 PM to End 4:20 PM with 50 paused minutes: 90 minutes of loading for the forecast's past speed.
  assert.equal(R.cleanMinutes(done('852', '14:00', '16:20', 1150, { pauseMark: m })), 90);
  assert.equal(R.cleanMinutes(done('852', '14:00', '16:20', 1150)), 140);
});
