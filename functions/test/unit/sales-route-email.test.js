'use strict';
// The 6:00 AM route status email for the salespeople (Joe 10/31): Route, Run, Status; the trailer's GPS first, else the truck's;
// "On time" once it left, how far late or behind past its dispatch time, Ended Up Not Running left off, no email on Sunday.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../src/salesmail');

// Tuesday 11-3-26 6:00 AM in New York (UTC-5 after 11-1): the email covers Monday 11-2's loads (Tuesday deliveries).
const SIX_TUE = Date.parse('2026-11-03T11:00:00Z');
const run = (id, route, run, day) => ({ id, weekStart: '2026-11-01', route, run, routeStatus: 'ACTIVE', masterShow: { daily: true, leavesOn: 'Delivery Day' },
  days: { tue: Object.assign({ runs: true, deliveryDate: '2026-11-03', loadDate: '2026-11-02' }, day) } });
const iso = (local) => new Date(Date.parse(local + '-05:00')).toISOString();

test('statuses: trailer GPS first, the truck only when the trailer has none, late and behind counted from dispatch', () => {
  const runs = [
    run('a', '802', 'Pittsburgh North', { dispatchTime: 210, trailer: 'T-101', truck: '501', completeTime: iso('2026-11-03T02:00:00') }),
    run('b', '811', 'Washington', { dispatchTime: 270, trailer: 'T-102', truck: '502', completeTime: iso('2026-11-03T03:00:00') }),
    run('c', '809', 'Greensburg', { dispatchTime: 325, trailer: 'T-103', truck: '503', completeTime: iso('2026-11-03T04:00:00') }),
    run('d', '813', 'Cumberland', { dispatchTime: 390, trailer: 'T-104', truck: '504', completeTime: iso('2026-11-03T05:00:00') }),
    run('e', '815', 'Johnstown', { dispatchTime: 420, trailer: 'T-105', truck: '505' }),
    run('f', '817', 'Altoona', { dispatchTime: 340, trailer: 'T-106', truck: '506', plantStartedAt: iso('2026-11-03T05:30:00') }),
    run('g', '820', 'Beaver Falls', { runs: false, dispatchTime: 300 }),
    run('h', '822', 'Clarksburg', { dispatchTime: 60, trailer: 'T-108', truck: '508', completeTime: iso('2026-11-02T23:00:00') })
  ];
  const reefer = {
    'T-101': { id: 'a|tue', unitId: 'U1', out: iso('2026-11-03T03:32:00') },
    'T-102': { id: 'b|tue', unitId: 'U2', out: iso('2026-11-03T05:42:00') },
    'T-103': { id: 'c|tue', unitId: 'U3', out: '' },
    // T-108 has no GPS unit (no trip), so its truck's yard leave counts; the truck's earlier leave (before loading) does not.
  };
  const gpsDays = [
    { tag: '508', date: '2026-11-02', yardOut: iso('2026-11-02T15:00:00') },
    { tag: '508', date: '2026-11-03', yardOut: iso('2026-11-03T01:03:00') },
    // Truck 503's GPS left, but trailer T-103 has GPS and is still in the yard: Not departed.
    { tag: '503', date: '2026-11-03', yardOut: iso('2026-11-03T05:00:00') }
  ];
  const out = S.salesRows({ runs, reefer, gpsDays }, SIX_TUE);
  assert.equal(out.today, '2026-11-03');
  assert.equal(out.groups.length, 1);
  assert.equal(out.groups[0].loadDate, '2026-11-02');
  const got = Object.fromEntries(out.groups[0].rows.map(r => [r.route, r.status]));
  assert.deepEqual(got, {
    802: 'On time, left 3:32 AM',
    809: 'Not departed, 35 min behind',
    811: 'Left 5:42 AM, 1 hr 12 min late',
    813: 'Loaded',
    815: 'Not loaded',
    817: 'Not loaded, 20 min behind',
    822: 'On time, left 1:03 AM'
  });
  assert.deepEqual(out.groups[0].rows.map(r => r.route), ['802', '809', '811', '813', '815', '817', '822'], 'route order; 820 (Ended Up Not Running) left off');
});

test('a leave inside the 5-minute GPS read counts on time; a trailer trip for another load is not this load', () => {
  const runs = [run('a', '804', 'Wheeling', { dispatchTime: 240, trailer: 'T-201', truck: '601', completeTime: iso('2026-11-03T02:00:00') })];
  let r = S.salesRows({ runs, reefer: { 'T-201': { id: 'a|tue', unitId: 'U', out: iso('2026-11-03T04:05:00') } }, gpsDays: [] }, SIX_TUE);
  assert.equal(r.groups[0].rows[0].status, 'On time, left 4:05 AM');
  r = S.salesRows({ runs, reefer: { 'T-201': { id: 'zz|tue', unitId: 'U', out: iso('2026-11-03T04:05:00') } }, gpsDays: [] }, SIX_TUE);
  assert.equal(r.groups[0].rows[0].status, 'Not departed, 2 hr behind');
});

test('Monday covers Saturday and Sunday loads; nothing on Sunday', () => {
  assert.deepEqual(S.coveredDates(Date.parse('2026-11-02T11:00:00Z')), ['2026-10-31', '2026-11-01'], 'Monday 6:00 AM');
  assert.deepEqual(S.coveredDates(Date.parse('2026-11-01T11:00:00Z')), [], 'Sunday 6:00 AM');
  assert.deepEqual(S.coveredDates(SIX_TUE), ['2026-11-02']);
});

test('the email: subject with the date, Route number only, plain words', () => {
  const m = S.salesEmail({ today: '2026-11-03', groups: [{ loadDate: '2026-11-02', rows: [{ route: '802', run: 'Pittsburgh North', status: 'On time, left 3:32 AM', tone: 'ok' }] }] });
  assert.equal(m.subject, 'Route status for 11-3-26 (6:00 AM)');
  assert.match(m.text, /Tuesday 11-3-26/);
  assert.match(m.html, /<td[^>]*>802<\/td>/);
  assert.match(m.html, /On time, left 3:32 AM/);
  const two = S.salesEmail({ today: '2026-11-02', groups: [{ loadDate: '2026-10-31', rows: [{ route: '802', run: 'X', status: 'Loaded', tone: 'loaded' }] }, { loadDate: '2026-11-01', rows: [] }] });
  assert.match(two.html, /Loaded Saturday 10-31-26/);
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
