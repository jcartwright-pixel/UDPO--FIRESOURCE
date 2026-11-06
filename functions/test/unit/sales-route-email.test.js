'use strict';
// The 6:00 AM route status email for the salespeople (Joe 10/31): Route, Run, Status; the dispatch tractor's GPS first (Joe
// 11-5-26), else the trailer's;
// "On time" once it left, how far late or behind past its dispatch time, Ended Up Not Running left off, no email on Sunday.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../src/salesmail');

// Tuesday 11-3-26 6:00 AM in New York (UTC-5 after 11-1): the email covers Tuesday 11-3's deliveries (loaded Monday 11-2).
const SIX_TUE = Date.parse('2026-11-03T11:00:00Z');
const run = (id, route, run, day) => ({ id, weekStart: '2026-11-01', route, run, routeStatus: 'ACTIVE', masterShow: { daily: true, leavesOn: 'Delivery Day' },
  days: { tue: Object.assign({ runs: true, deliveryDate: '2026-11-03', loadDate: '2026-11-02' }, day) } });
const iso = (local) => new Date(Date.parse(local + '-05:00')).toISOString();

test('statuses: the dispatch tractor\'s GPS first, the trailer when the tractor is not seen leaving, late and behind counted from dispatch', () => {
  const runs = [
    run('a', '802', 'Pittsburgh North', { dispatchTime: 210, trailer: 'T-101', truck: '501', completeTime: iso('2026-11-03T02:00:00') }),
    run('b', '811', 'Washington', { dispatchTime: 270, trailer: 'T-102', truck: '502', completeTime: iso('2026-11-03T03:00:00') }),
    run('c', '809', 'Greensburg', { dispatchTime: 325, trailer: 'T-103', truck: '503', completeTime: iso('2026-11-03T04:00:00') }),
    run('d', '813', 'Cumberland', { dispatchTime: 390, trailer: 'T-104', truck: '504', completeTime: iso('2026-11-03T05:00:00') }),
    run('e', '815', 'Johnstown', { dispatchTime: 420, trailer: 'T-105', truck: '505' }),
    run('f', '817', 'Altoona', { dispatchTime: 320, trailer: 'T-106', truck: '506', plantStartedAt: iso('2026-11-03T05:30:00') }),
    run('g', '820', 'Beaver Falls', { runs: false, dispatchTime: 300 }),
    run('h', '822', 'Clarksburg', { dispatchTime: 60, trailer: 'T-108', truck: '508', completeTime: iso('2026-11-02T23:00:00') })
  ];
  const reefer = {
    'T-101': { id: 'a|tue', unitId: 'U1', out: iso('2026-11-03T03:32:00') },
    // T-102's trailer GPS only saw it out at 6:02; its tractor 502 left at 5:42, and the tractor counts.
    'T-102': { id: 'b|tue', unitId: 'U2', out: iso('2026-11-03T06:02:00') },
    'T-103': { id: 'c|tue', unitId: 'U3', out: '' },
    // T-108 has no GPS unit (no trip): its truck's yard leave counts; the truck's earlier leave (before loading) does not.
  };
  const gpsDays = [
    { tag: '508', date: '2026-11-02', yardOut: iso('2026-11-02T15:00:00') },
    { tag: '508', date: '2026-11-03', yardOut: iso('2026-11-03T01:03:00') },
    { tag: '502', date: '2026-11-03', yardOut: iso('2026-11-03T05:42:00') },
    // Tractor 503 left at 5:00 though trailer T-103's GPS still shows it in the yard: the tractor counts (25 min early, on time).
    { tag: '503', date: '2026-11-03', yardOut: iso('2026-11-03T05:00:00') }
  ];
  const out = S.salesRows({ runs, reefer, gpsDays }, SIX_TUE);
  assert.equal(out.today, '2026-11-03');
  assert.equal(out.groups.length, 1);
  assert.equal(out.groups[0].deliveryDate, '2026-11-03');
  const got = Object.fromEntries(out.groups[0].rows.map(r => [r.route, r.status]));
  assert.deepEqual(got, {
    802: 'On time, left 3:32 AM',
    809: 'On time, left 5:00 AM',
    811: 'Left 5:42 AM, 1 hr 12 min late',
    813: 'Loaded',
    815: 'Not loaded',
    817: 'Not loaded, 40 min behind',
    822: 'On time, left 1:03 AM'
  });
  // Joe 11-2-26 (timing-rules.js): 30 to 60 minutes off is yellow, past 60 red.
  const tone = Object.fromEntries(out.groups[0].rows.map(r => [r.route, r.tone]));
  assert.deepEqual([tone['802'], tone['809'], tone['811'], tone['817']], ['ok', 'ok', 'late', 'caution']);
  assert.deepEqual(out.groups[0].rows.map(r => r.route), ['802', '809', '811', '813', '815', '817', '822'], 'route order; 820 (Ended Up Not Running) left off');
});

// Joe 11-5-26 (routes 813 and 824 both said "Left 6:02 AM" with different late times): the departure is the dispatch tractor's,
// never a trailer GPS read that first saw two trailers out at the same time. Joe 11-6-26: the trailer only when the tractor is not seen leaving.
test('two trailers first seen out by the same GPS read still get their own tractors\' leave times', () => {
  const runs = [
    run('a', '813', 'Cumberland', { dispatchTime: 90, trailer: 'T-301', truck: '701', completeTime: iso('2026-11-03T00:40:00') }),
    run('b', '824', 'Morgantown', { dispatchTime: 60, trailer: 'T-302', truck: '702', completeTime: iso('2026-11-03T00:20:00') }),
    // Joe 11-6-26: tractor 703 has GPS but is not seen leaving; its trailer's GPS is out, so the trailer's leave counts.
    run('c', '826', 'Fairmont', { dispatchTime: 240, trailer: 'T-303', truck: '703', completeTime: iso('2026-11-03T03:00:00') })
  ];
  const reefer = {
    'T-301': { id: 'a|tue', unitId: 'U1', out: iso('2026-11-03T06:02:00') },
    'T-302': { id: 'b|tue', unitId: 'U2', out: iso('2026-11-03T06:02:00') },
    'T-303': { id: 'c|tue', unitId: 'U3', out: iso('2026-11-03T04:10:00') }
  };
  const gpsDays = [
    { tag: '701', date: '2026-11-03', yardOut: iso('2026-11-03T01:35:00') },
    { tag: '702', date: '2026-11-03', yardOut: iso('2026-11-03T02:40:00') },
    { tag: '703', date: '2026-11-03', miles: 0, yardOut: '' }
  ];
  const got = Object.fromEntries(S.salesRows({ runs, reefer, gpsDays }, SIX_TUE).groups[0].rows.map(r => [r.route, r.status]));
  assert.deepEqual(got, { 813: 'On time, left 1:35 AM', 824: 'Left 2:40 AM, 1 hr 40 min late', 826: 'On time, left 4:10 AM' });
  assert.equal(S.leftAt(Object.assign({ loaded: true, runDocId: 'c', day: 'tue', loadDate: '2026-11-02', completedAt: '' }, { truck: '703', trailer: 'T-303' }), reefer, gpsDays).by, 'TRAILER');
  assert.deepEqual(S.leftAt(Object.assign({ loaded: true, runDocId: 'a', day: 'tue', loadDate: '2026-11-02', completedAt: '' }, { truck: '701', trailer: 'T-301' }), reefer, gpsDays).by, 'TRUCK');
});

// Joe 11-2-26 ("the route can start 1/2 hour before or 1/2 hour after … cautious yellow"): within 30 minutes either side of
// dispatch is on time, 30 to 60 minutes early or late is yellow, more than 60 is red.
test('a leave within 30 minutes either side counts on time; early and late past that are yellow, then red', () => {
  const runs = [run('a', '804', 'Wheeling', { dispatchTime: 240, trailer: 'T-201', truck: '601', completeTime: iso('2026-11-03T02:00:00') })];
  const left = (hm) => S.salesRows({ runs, reefer: { 'T-201': { id: 'a|tue', unitId: 'U', out: iso('2026-11-03T' + hm + ':00') } }, gpsDays: [] }, SIX_TUE).groups[0].rows[0];
  assert.deepEqual([left('04:30').status, left('04:30').tone], ['On time, left 4:30 AM', 'ok']);
  assert.deepEqual([left('03:30').status, left('03:30').tone], ['On time, left 3:30 AM', 'ok']);
  assert.deepEqual([left('04:45').status, left('04:45').tone], ['Left 4:45 AM, 45 min late', 'caution']);
  assert.deepEqual([left('03:15').status, left('03:15').tone], ['Left 3:15 AM, 45 min early', 'caution']);
  assert.deepEqual([left('05:01').status, left('05:01').tone], ['Left 5:01 AM, 1 hr 1 min late', 'late']);
  assert.deepEqual([left('02:50').status, left('02:50').tone], ['Left 2:50 AM, 1 hr 10 min early', 'late']);
});

test('a leave a few minutes after dispatch counts on time; a trailer trip for another load is not this load', () => {
  const runs = [run('a', '804', 'Wheeling', { dispatchTime: 240, trailer: 'T-201', truck: '601', completeTime: iso('2026-11-03T02:00:00') })];
  let r = S.salesRows({ runs, reefer: { 'T-201': { id: 'a|tue', unitId: 'U', out: iso('2026-11-03T04:05:00') } }, gpsDays: [] }, SIX_TUE);
  assert.equal(r.groups[0].rows[0].status, 'On time, left 4:05 AM');
  r = S.salesRows({ runs, reefer: { 'T-201': { id: 'zz|tue', unitId: 'U', out: iso('2026-11-03T04:05:00') } }, gpsDays: [] }, SIX_TUE);
  assert.equal(r.groups[0].rows[0].status, 'Not departed, 2 hr behind');
});

// Joe 11-5-26: "at 6:00 a.m. whatever is supposed to be delivered that particular day shows up on this report".
test('each email covers that day\'s deliveries only; nothing on Sunday', () => {
  assert.deepEqual(S.coveredDates(Date.parse('2026-11-02T11:00:00Z')), ['2026-11-02'], 'Monday 6:00 AM');
  assert.deepEqual(S.coveredDates(Date.parse('2026-11-01T11:00:00Z')), [], 'Sunday 6:00 AM');
  assert.deepEqual(S.coveredDates(SIX_TUE), ['2026-11-03']);
});

// Joe 11-5-26 (852 Jersey Load 1 said "Not departed, 1 day 7 hr behind"): yesterday's deliveries never carry over, and a test
// sent in the evening reads the same as the 6:00 AM email.
test('yesterday\'s deliveries are left off; a test sent later in the day is worked out as of 6:00 AM', () => {
  const day = (id, route, name, deliveryDate, loadDate, d) => ({ id, weekStart: '2026-11-01', route, run: name, routeStatus: 'ACTIVE', masterShow: { daily: true, leavesOn: 'Delivery Day' },
    days: { [deliveryDate === '2026-11-02' ? 'mon' : 'tue']: Object.assign({ runs: true, deliveryDate, loadDate }, d) } });
  const runs = [
    // Delivered Monday, its leave never seen: not on Tuesday's email.
    day('y', '852', 'Jersey Load 1', '2026-11-02', '2026-11-01', { dispatchTime: 780, truck: '801', completeTime: iso('2026-11-01T12:00:00') }),
    day('a', '813', 'Cumberland', '2026-11-03', '2026-11-02', { dispatchTime: 90, truck: '701', completeTime: iso('2026-11-03T00:40:00') }),
    day('b', '824', 'Morgantown', '2026-11-03', '2026-11-02', { dispatchTime: 240, truck: '702', completeTime: iso('2026-11-03T03:00:00') })
  ];
  const gpsDays = [
    { tag: '701', date: '2026-11-03', yardOut: iso('2026-11-03T01:35:00') },
    // Tractor 702 left at 6:40 AM, after the email's 6:00 AM.
    { tag: '702', date: '2026-11-03', yardOut: iso('2026-11-03T06:40:00') }
  ];
  const at = (ms) => Object.fromEntries(S.salesRows({ runs, reefer: {}, gpsDays }, ms).groups[0].rows.map(r => [r.route, r.status]));
  const morning = at(SIX_TUE);
  assert.deepEqual(morning, { 813: 'On time, left 1:35 AM', 824: 'Not departed, 2 hr behind' });
  assert.deepEqual(at(Date.parse('2026-11-04T01:48:00Z')), morning, 'Send a test to me at 8:48 PM');
});

// Joe 11-5-26: two loads on one tractor (852 Load 1 and Load 2) each get their own leave, the one nearest their dispatch time.
test('two loads on one tractor each take the leave nearest their own dispatch time', () => {
  const runs = [
    run('a', '852', 'Jersey Load 1', { dispatchTime: 60, truck: '801', completeTime: iso('2026-11-02T22:00:00') }),
    run('b', '852', 'Jersey Load 2', { dispatchTime: 300, truck: '801', completeTime: iso('2026-11-02T23:00:00') })
  ];
  const gpsDays = [{ tag: '801', date: '2026-11-03', yardOut: iso('2026-11-03T01:10:00'), yardOuts: [iso('2026-11-03T01:10:00'), iso('2026-11-03T05:20:00')] }];
  const got = S.salesRows({ runs, reefer: {}, gpsDays }, SIX_TUE).groups[0].rows.map(r => r.run + ': ' + r.status);
  assert.deepEqual(got, ['Jersey Load 1: On time, left 1:10 AM', 'Jersey Load 2: On time, left 5:20 AM']);
});

test('the email: subject with the date, Route number only, plain words', () => {
  const m = S.salesEmail({ today: '2026-11-03', groups: [{ deliveryDate: '2026-11-03', rows: [{ route: '802', run: 'Pittsburgh North', status: 'On time, left 3:32 AM', tone: 'ok' }] }] });
  assert.equal(m.subject, 'Route status for 11-3-26 (6:00 AM)');
  assert.match(m.text, /Tuesday 11-3-26/);
  assert.match(m.html, /<td[^>]*>802<\/td>/);
  assert.match(m.html, /On time, left 3:32 AM/);
  assert.equal(S.howLong(72), '1 hr 12 min');
  assert.equal(S.howLong(60), '1 hr');
});

test('nothing goes out until it is switched on with an address', async () => {
  const doc = {};
  const db = { collection: () => ({ doc: () => ({ get: async () => ({ data: () => doc }) }) }) };
  let sent = 0;
  const deps = { now: () => SIX_TUE, appMail: async () => { sent++; return { status: 'SENT' }; } };
  assert.equal((await S.sendMorning(db, deps)).status, 'SKIPPED');
  doc.on = true;
  assert.equal((await S.sendMorning(db, deps)).status, 'SKIPPED', 'on, but no one on the list');
  assert.equal(sent, 0);
  assert.equal((await S.sendMorning(db, { now: () => Date.parse('2026-11-01T11:00:00Z'), appMail: deps.appMail })).status, 'SKIPPED', 'Sunday');
});

test('Administration: Off with no one on it to start; addresses checked; On saved', async () => {
  const store = {};
  const ref = (c, id) => ({ get: async () => ({ data: () => store[c + '/' + id], exists: !!store[c + '/' + id] }), set: async (v, o) => { store[c + '/' + id] = Object.assign({}, o && o.merge ? store[c + '/' + id] : {}, v); } });
  const db = { collection: (c) => ({ doc: (id) => ref(c, id) }) };
  let v = await S.adminView(db);
  assert.equal(v.on, false);
  assert.deepEqual(v.to, []);
  await assert.rejects(S.adminSave(db, 'boss@uniteddairy.com', { to: 'pat@example.com, not-an-address' }, '2026-10-31T18:00:00Z'), /Not an email address: not-an-address/);
  v = await S.adminSave(db, 'boss@uniteddairy.com', { on: true }, '2026-10-31T18:00:00Z');
  assert.equal(v.on, true);
  assert.match(v.message, /Add at least one address/);
  v = await S.adminSave(db, 'boss@uniteddairy.com', { to: 'Pat@Example.com; lee@example.com' }, '2026-10-31T18:01:00Z');
  assert.deepEqual(v.to, ['pat@example.com', 'lee@example.com']);
  assert.equal(v.on, true);
  assert.equal(v.changedBy, 'boss@uniteddairy.com');
});
