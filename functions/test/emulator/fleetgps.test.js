'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { gpsCall } = require('../../src/gps');
const { pull, history, purgeReefer } = require('../../src/fleetgps');
const F = require('../fixtures/fake-sheets');

const ADMIN = { email: 'admin.test@uniteddairy.com' };
const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
const BASE = 'https://united-dairy.api.telogis.com';

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES });
});

const reply = (status, body) => ({ status, text: async () => body });
// A stand-in for Verizon Connect Fleet: sub-user "app" / "pw" on fleet united-dairy gets key "k1"; it keeps the templates
// it is sent and answers our two by name with CSV.
function fleet(log, opts) {
  opts = opts || {};
  const saved = [], pending = {};
  const go = async (url, init) => {
    log.push((init.method || 'GET') + ' ' + url.replace(/auth=[^&]+/, 'auth=*'));
    // Verizon's asynchronous mode (GPS points): 202 with a link, then 202 {Status} with no link while it works, then the rows.
    const wait = /^\/result\/(\d+)/.exec(url.slice(BASE.length));
    if (wait) { const p = pending[wait[1]]; if (p.polls++ < 1) return reply(202, JSON.stringify({ Status: 'Retrieving' })); return p.answer; }
    if (/\/execute\?template=UDPO_(UnitDayPoints|TrailerTemps)/.test(url)) {
      assert.match(url, /&PollingMode=Async/, 'GPS points run in asynchronous mode');
      const id = String(Object.keys(pending).length + 1);
      pending[id] = { polls: 0, answer: await answer(url, init) };
      return reply(202, JSON.stringify({ ResultUrl: BASE + '/result/' + id }));
    }
    return answer(url, init);
  };
  const answer = async (url, init) => {
    if (url === BASE + '/rest/login') {
      if (opts.postMissing) return reply(405, '');
      const b = JSON.parse(init.body);
      return b.username === 'united-dairy:app' && b.password === 'pw' ? reply(200, JSON.stringify({ token: 'k1' })) : reply(401, '');
    }
    if (url === BASE + '/rest/login/united-dairy/app/pw') return reply(200, 'k1');
    if (url.indexOf('auth=k1') < 0) return reply(401, '');
    if (url.startsWith(BASE + '/templates')) {
      if (init.method === 'POST') { saved.push(init.body); return reply(200, JSON.stringify({ name: /TemplateName = (\w+)/.exec(init.body)[1], templateId: saved.length })); }
      return reply(200, JSON.stringify(saved.map(t => ({ name: /TemplateName = (\w+)/.exec(t)[1] }))));
    }
    if (url.startsWith(BASE + '/execute?template=UDPO_Alerts')) {
      const q = new URL(url).searchParams;
      log.push('alerts ' + q.get('Since') + ' to ' + q.get('Until'));
      return reply(200, 'AlertId,ConditionId,UnitId,DriverId,Triggered,TimeOn,TimeOff,Address,SpeedMph,LimitMph,TriggerName,TriggerValue\r\n'
        + '901,C1,11,D7,2026-10-13 14:01:00,2026-10-13 14:01:00,2026-10-13 14:02:00,"US|15401|Pennsylvania|Uniontown|Union St",71,55,,\r\n'
        + '902,C2,11,D7,2026-10-13 14:03:00,2026-10-13 14:03:00,,,,,HarshBraking,True\r\n'
        + '903,C3,12,,2026-10-13 13:00:00,2026-10-13 13:00:00,2026-10-13 13:25:00,,,,,\r\n');
    }
    if (url.startsWith(BASE + '/execute?template=UDPO_Conditions')) {
      log.push('conditions ' + new URL(url).searchParams.get('Ids'));
      return reply(200, 'ConditionId,Name,ConditionType\r\nC1,Over 55,PostedSpeedCondition\r\nC2,Hard stop,DiagnosticBooleanCondition\r\nC3,Idling 20 min,IdleCondition\r\n');
    }
    if (url.startsWith(BASE + '/execute?template=UDPO_UnitDayPoints')) {
      const q = new URL(url).searchParams;
      log.push('points ' + q.get('Since') + ' to ' + q.get('Until') + ' ' + q.get('Ids'));
      const pts = (opts.points || {})[q.get('Since').slice(0, 10)] || [];
      return reply(200, 'UnitId,Time,Lat,Lon,Address,MilesDelta\r\n' + pts.map(p => p.join(',')).join('\r\n'));
    }
    // Joe 10/21: every unit's points by time only (on live a list of units always failed), Fleet's "Refrigeration Temperature".
    if (url.startsWith(BASE + '/execute?template=UDPO_TrailerTemps')) {
      const q = new URL(url).searchParams;
      assert.equal(q.get('Ids'), null, 'no unit list');
      log.push('reefer ' + q.get('Since') + ' to ' + q.get('Until'));
      return reply(200, 'UnitId,Time,TempF\r\n' + (opts.reefer || []).map(p => p.join(',')).join('\r\n'));
    }
    if (opts.trailerPlace !== undefined && url.startsWith(BASE + '/execute?template=UDPO_TrucksNow')) {
      return reply(200, 'UnitId,Tag,LastReport,Lat,Lon,Address,Place,SpeedMph,IgnitionOn,OdometerMiles,EngineHours,Driver,Active\r\n'
        + '71,' + (opts.trailerTag || 'T-701') + ',2026-10-13 14:06:00,40.1,-81.3,"Route 8, Akron OH",' + opts.trailerPlace + ',0,False,,,,True\r\n');
    }
    if (url.startsWith(BASE + '/execute?template=UDPO_TrucksNow')) {
      if (opts.many) return reply(200, 'UnitId,Tag,LastReport,Lat,Lon,Address,Place,SpeedMph,IgnitionOn,OdometerMiles,EngineHours,Driver,Active\r\n'
        + Array.from({ length: opts.many }, (_, i) => i + ',' + (i % 3 ? 2000 + i : 'T-' + i) + ',2026-10-13 14:05:00,40,-81,"Akron OH",,0,False,' + (i % 3 ? 1000 + i : '') + ',,,True').join('\r\n'));
      if (opts.broken) throw new TypeError('fetch failed');
      const odo = (opts && opts.odo) || { a: 412345.6, at: '2026-10-13 14:05:00' };
      return reply(200, 'UnitId,Tag,LastReport,Lat,Lon,Address,Place,SpeedMph,IgnitionOn,OdometerMiles,EngineHours,Driver,Active\r\n'
        + '11,223876,' + odo.at + ',39.99,-81.1,"1 Main St, Uniontown OH",Uniontown Yard,0,False,' + odo.a + ',15022.5,Pat Smith,True\r\n'
        + '12,T-635,2026-10-13 14:06:00,40.1,-81.3,"Route 8, Akron OH",,54,True,,,,True\r\n');
    }
    return reply(404, '');
  };
  return go;
}
const NOW = () => new Date('2026-10-13T14:10:00Z');

test('Fleet GPS: managers only, the login never comes back, Test says plainly what works, a pull stores trucks and miles', async () => {
  const log = [], state = { odo: { a: 412345.6, at: '2026-10-13 14:05:00' } }, clock = { now: new Date('2026-10-13T14:10:00Z') };
  const o = { fetch: fleet(log, state), base: BASE, now: () => clock.now, sleep: async () => {} };
  await assert.rejects(gpsCall(db(), DISPATCHER, { kind: 'fleet', op: 'status' }, o), /Only a manager or administrator/);
  let s = await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'test' }, o);
  assert.match(s.result.message, /save the Fleet name/);
  await assert.rejects(gpsCall(db(), ADMIN, { kind: 'fleet', op: 'save', fleet: 'https://bad' }, o), /Fleet name is the first part/);

  // The login as Fleet shows it ("fleet:user") is the same sub-user.
  s = await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'save', fleet: 'United-Dairy', user: 'united-dairy:app', password: 'wrong' }, o);
  assert.deepEqual([s.fleet, s.hasUser, s.hasPassword], ['united-dairy', true, true]);
  assert.equal(JSON.stringify(s).indexOf('wrong'), -1, 'the password never comes back');
  s = await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'test' }, o);
  assert.equal(s.result.ok, false);
  assert.match(s.result.message, /refused the sub-user name or password \(401\)/);

  await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'save', password: 'pw' }, o);
  s = await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'test' }, o);
  assert.equal(s.result.ok, true, s.result.message);
  assert.match(s.result.message, /^Connected\. Verizon Fleet answered with 2 trucks, for example 223876, T-635\./);
  assert.equal(log.filter(l => l.startsWith('POST ' + BASE + '/templates')).length, 1, 'the template is saved once');

  s = await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'pull' }, o);
  assert.deepEqual(s.pulled, { trucks: 2, days: 1, alerts: 3, reefer: 0, temps: 0 });
  // Joe 10/13 (scorecard): Fleet's alerts since New York midnight, each with its unit's tag and kind.
  assert.ok(log.indexOf('alerts 2026-10-13 04:00:00 to 2026-10-13 14:10:00') >= 0, 'the first read starts at New York midnight');
  assert.ok(log.indexOf('conditions C1,C2,C3') >= 0, 'the condition names are asked for once');
  const alert = async (id) => (await db().collection('gpsAlerts').doc(id).get()).data();
  assert.deepEqual((({ date, tag, at, type, speedMph, limitMph, minutes, condition }) => ({ date, tag, at, type, speedMph, limitMph, minutes, condition }))(await alert('A901')),
    { date: '2026-10-13', tag: '223876', at: '2026-10-13T14:01:00.000Z', type: 'SPEEDING', speedMph: 71, limitMph: 55, minutes: 1, condition: 'Over 55' });
  assert.equal((await alert('A902')).type, 'HARSH_BRAKING');
  // GPS Setup shows how many alerts came in today, so Joe can see this login sees the alerts he set up.
  s = await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'status' }, o);
  assert.deepEqual([s.alertsDate, s.alertsToday, s.alertsError], ['2026-10-13', 3, '']);
  assert.deepEqual([(await alert('A903')).type, (await alert('A903')).tag, (await alert('A903')).minutes], ['IDLE', 'T-635', 25]);
  const t = (await db().collection('gpsTrucks').doc('223876').get()).data();
  assert.equal(t.lastReport, '2026-10-13T14:05:00.000Z');
  assert.equal(t.place, 'Uniontown Yard');
  assert.equal(t.address, '1 Main St, Uniontown OH');
  assert.equal(t.odometerMiles, 412345.6);
  assert.equal(t.engineHours, 15022.5);
  assert.equal(t.ignitionOn, false);
  assert.equal(t.driver, 'Pat Smith');
  assert.equal((await db().collection('gpsTrucks').doc('T-635').get()).data().odometerMiles, null, 'a trailer without an odometer');
  let day = (await db().collection('gpsDays').doc('2026-10-13_223876').get()).data();
  assert.deepEqual([day.miles, day.firstMove], [0, '']);

  // Five minutes later the truck has moved 12.4 miles; the saved key is used again and the template is not sent again.
  const before = log.length;
  clock.now = new Date('2026-10-13T14:15:00Z'); state.odo = { a: 412358, at: '2026-10-13 14:14:00' };
  assert.deepEqual(await pull(db(), o), { trucks: 2, days: 1, alerts: 3, reefer: 0 }, 'the all-trailers temperature read waits 15 minutes');
  assert.equal(log.slice(before).filter(l => /rest\/login|\/templates|conditions/.test(l)).length, 0);
  assert.ok(log.indexOf('alerts 2026-10-13 14:00:00 to 2026-10-13 14:15:00') >= 0, 'the next read starts 10 minutes before the last one ended');
  assert.equal((await alert('A901')).updatedAt, '2026-10-13T14:10:00.000Z', 'an alert read again unchanged is not rewritten (Joe 10/18)');
  assert.equal((await alert('A901')).place, 'Uniontown Yard', 'the re-read keeps the place found the first time');
  day = (await db().collection('gpsDays').doc('2026-10-13_223876').get()).data();
  assert.deepEqual([day.miles, day.firstMove, day.lastMove], [12.4, '2026-10-13T14:15:00.000Z', '2026-10-13T14:15:00.000Z']);
  assert.equal(day.since, '2026-10-13T14:10:00.000Z', 'today is counted from the first read, so Trucks Today can say so');
  // No new report: nothing is written.
  assert.deepEqual(await pull(db(), o), { trucks: 2, days: 0, alerts: 3, reefer: 0 }, 'the all-trailers temperature read waits 15 minutes');
  // A new New York day starts again from that day's first reading.
  clock.now = new Date('2026-10-14T11:00:00Z'); state.odo = { a: 412400, at: '2026-10-14 10:59:00' };
  await pull(db(), o);
  assert.equal((await db().collection('gpsDays').doc('2026-10-14_223876').get()).data().miles, 0);

  s = await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'clear' }, o);
  assert.deepEqual([s.fleet, s.hasUser, s.hasPassword], ['united-dairy', false, false]);
  assert.deepEqual(await pull(db(), o), { skipped: 'no login' });
  assert.ok(log.filter(l => /^(GET|POST) /.test(l)).every(l => l.indexOf(BASE) >= 0), 'every call goes to Fleet only');
});

test('Fleet GPS: when Fleet will not take the POST login, the address form Verizon sent works', async () => {
  const log = [], o = { fetch: fleet(log, { postMissing: true }), base: BASE, now: NOW, sleep: async () => {} };
  await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'save', fleet: 'united-dairy', user: 'app', password: 'pw' }, o);
  const s = await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'test' }, o);
  assert.equal(s.result.ok, true, s.result.message);
  assert.ok(log.indexOf('GET ' + BASE + '/rest/login/united-dairy/app/pw') >= 0);
});

// Joe 10/13: Pull now on the test copy came back "Could not reach the GPS settings" with Fleet's 520 units.
test('Fleet GPS: Pull now with all 520 Fleet units stores them all, and a failure says what failed instead of blaming the network', async () => {
  const log = [], o = { fetch: fleet(log, { many: 520 }), base: BASE, now: NOW, sleep: async () => {} };
  await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'save', fleet: 'united-dairy', user: 'app', password: 'pw' }, o);
  let s = await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'pull' }, o);
  assert.deepEqual([s.pulled.trucks, s.pulled.days], [520, 346], 'every unit; miles only for units with an odometer');
  assert.equal((await db().collection('gpsTrucks').get()).size, 520);
  assert.equal(s.lastPullTrucks, 520);
  assert.equal(s.lastPullError, '');
  // Fleet cannot be reached part way: the answer is a plain sentence the screen shows, never a thrown "internal".
  const bad = { fetch: fleet([], { broken: true }), base: BASE, now: NOW, sleep: async () => {} };
  s = await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'pull' }, bad);
  assert.match(s.pulled.error, /^The GPS read stopped part way \(fetch failed\)/);
  assert.match(s.lastPullError, /fetch failed/);
});

// The Driver Scorecard thread (10/13): a read where only the yard changes must not wipe the day's miles.
test('Fleet GPS: a day record written in parts keeps its miles when only the yard changes', async () => {
  await db().collection('gpsDays').doc('2026-10-13_T-635').set({ tag: 'T-635', date: '2026-10-13', miles: 12.4, firstMove: '2026-10-13T09:00:00.000Z', idleMinutes: 5 });
  await db().collection('private').doc('gpsFleetSeen').set({ date: '2026-10-13', units: { 'T-635': { lr: 'x', yard: true } } });
  const log = [], o = { fetch: fleet(log), base: BASE, now: NOW, sleep: async () => {} };
  await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'save', fleet: 'united-dairy', user: 'app', password: 'pw' }, o);
  await pull(db(), o);
  const day = (await db().collection('gpsDays').doc('2026-10-13_T-635').get()).data();
  assert.deepEqual([day.miles, day.firstMove, day.idleMinutes, day.yardOut], [12.4, '2026-10-13T09:00:00.000Z', 5, '2026-10-13T14:10:00.000Z']);
});

test('Fleet GPS: this week\'s history is read once, a part each run, and today is joined to the live read', async () => {
  const log = [], state = { odo: { a: 412345.6, at: '2026-10-13 14:05:00' }, points: {
    // Monday 10/12: out of the yard at 10:30, back at 20:00 (UTC).
    '2026-10-12': [['11', '2026-10-12 10:00:00', 39.99, -81.1, 'Yard', 0], ['11', '2026-10-12 10:30:00', 40.2, -81.0, 'Akron', 12.5],
      ['11', '2026-10-12 18:00:00', 40.3, -81.2, 'Canton', 20], ['11', '2026-10-12 20:00:00', 39.991, -81.1, 'Yard', 3.1]],
    // Today: 8 miles before the live read began at 14:10, and 5 after it (the live read's own).
    '2026-10-13': [['11', '2026-10-13 11:00:00', 39.99, -81.1, 'Yard', 0], ['11', '2026-10-13 11:30:00', 40.2, -81.0, 'Akron', 8],
      ['11', '2026-10-13 14:30:00', 40.3, -81.0, 'Akron', 5]] } };
  const clock = { now: new Date('2026-10-13T14:10:00Z') };
  const o = { fetch: fleet(log, state), base: BASE, now: () => clock.now, sleep: async () => {} };
  assert.deepEqual(await history(db(), o), { skipped: 'no login' });
  await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'save', fleet: 'united-dairy', user: 'app', password: 'pw' }, o);
  assert.deepEqual(await history(db(), o), { skipped: 'no trucks read yet' });
  await pull(db(), o);
  // Only Uniontown's Equipment Master trucks; the truck stands at a yard place now, which is where the yard is.
  await db().collection('equipment').doc('e1').set({ type: 'TRUCK', unit: '223876', facilityId: 'fac_uniontown', location: 'Uniontown' });
  await db().collection('equipment').doc('e2').set({ type: 'TRUCK', unit: 'T-635', location: 'Marietta' });
  await db().collection('gpsTrucks').doc('223876').set({ place: 'Uniontown Branch' }, { merge: true });

  clock.now = new Date('2026-10-13T14:20:00Z');
  let r = await history(db(), Object.assign({}, o, { budgetMs: 1e9 }));
  assert.deepEqual(r, { steps: 6, done: 6, total: 6, finished: true });
  assert.ok(log.indexOf('alerts 2026-10-11 04:00:00 to 2026-10-12 04:00:00') >= 0, 'Sunday\'s alerts');
  assert.ok(log.indexOf('alerts 2026-10-13 04:00:00 to 2026-10-13 14:20:00') >= 0, 'today\'s alerts up to now');
  assert.ok(log.indexOf('points 2026-10-12 04:00:00 to 2026-10-13 04:00:00 11') >= 0, 'one day\'s points for our trucks only');
  const day = async (id) => (await db().collection('gpsDays').doc(id).get()).data();
  assert.equal(await day('2026-10-11_223876'), undefined, 'no points, no record');
  const mon = await day('2026-10-12_223876');
  assert.deepEqual([mon.miles, mon.firstMove, mon.lastMove, mon.yardOut, mon.yardIn, mon.lastPlace, mon.history],
    [35.6, '2026-10-12T10:30:00.000Z', '2026-10-12T20:00:00.000Z', '2026-10-12T10:30:00.000Z', '2026-10-12T20:00:00.000Z', 'Yard', true]);
  let tue = await day('2026-10-13_223876');
  assert.deepEqual([tue.miles, tue.firstMove, tue.yardOut, tue.since], [8, '2026-10-13T11:30:00.000Z', '2026-10-13T11:30:00.000Z', '2026-10-13T04:00:00.000Z']);
  // The live read carries on from the whole day's total.
  clock.now = new Date('2026-10-13T14:40:00Z'); state.odo = { a: 412350.6, at: '2026-10-13 14:39:00' };
  await pull(db(), o);
  tue = await day('2026-10-13_223876');
  assert.deepEqual([tue.miles, tue.firstMove, tue.since], [13, '2026-10-13T11:30:00.000Z', '2026-10-13T04:00:00.000Z']);
  // Read once: nothing more is asked of Fleet, and GPS Setup says it is done.
  const before = log.length;
  assert.deepEqual(await history(db(), o), { skipped: 'done' });
  assert.equal(log.length, before);
  const s = await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'status' }, o);
  assert.deepEqual([s.history.done, s.history.total, s.history.days, s.history.finishedAt], [6, 6, ['2026-10-11', '2026-10-12', '2026-10-13'], '2026-10-13T14:20:00.000Z']);
  // Joe 10/14: GPS Setup's checklist of what is coming in from Fleet.
  const c = {}; s.coverage.forEach(r => { c[r.key] = r; });
  assert.deepEqual([c.positions.today, c.odometer.today, c.engineHours.today, c.trailerHours.today], [2, 1, 1, 0]);
  assert.deepEqual([c.miles.today, c.miles.last, c.yard.today], [1, '2026-10-13T14:40:00.000Z', 1]);
  assert.deepEqual([c.alert_SPEEDING.today, c.alert_SPEEDING.week, c.alert_HARSH_BRAKING.today, c.alert_IDLE.week, c.alert_SEATBELT.week], [1, 1, 1, 1, 0]);
  assert.deepEqual([c.mpg.notYet, c.fuel.notYet], [true, true]);
});

test('Fleet GPS: the history goes a part at a time and stops after three failures in a row', async () => {
  const log = [], clock = { now: new Date('2026-10-13T14:10:00Z') };
  const o = { fetch: fleet(log, {}), base: BASE, now: () => clock.now, sleep: async () => {} };
  await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'save', fleet: 'united-dairy', user: 'app', password: 'pw' }, o);
  await pull(db(), o);
  await db().collection('equipment').doc('e1').set({ type: 'TRUCK', unit: '223876' });
  // A run with no time left does nothing but set up the list.
  let r = await history(db(), Object.assign({}, o, { budgetMs: -1 }));
  assert.deepEqual(r, { steps: 0, done: 0, total: 6, finished: false });
  const bad = Object.assign({}, o, { fetch: async (url, init) => /UnitDayPoints|UDPO_Alerts/.test(url) ? reply(500, 'boom') : fleet(log, {})(url, init) });
  for (let i = 0; i < 3; i++) assert.match((await history(db(), bad)).error, /answered 500/);
  assert.deepEqual(await history(db(), o), { skipped: 'stopped' });
  const s = await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'status' }, o);
  assert.equal(s.history.stopped, true);
  // Saving the login again gives it another go.
  clock.now = new Date('2026-10-13T15:00:00Z');
  await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'save', password: 'pw' }, o);
  r = await history(db(), Object.assign({}, o, { budgetMs: 1e9 }));
  assert.equal(r.finished, true);
});

// Joe 10/18: trailer temperatures from the GPS for Yard Checks, from the time the load is complete until back in the yard.
test('Fleet GPS: a loaded trailer\'s temperature is read every run until it is back in the yard', async () => {
  const L = require('../../src/logic');
  const log = [], state = { trailerPlace: 'Loading Dock', reefer: [] }, clock = { now: new Date('2026-10-13T14:10:00Z') };
  const o = { fetch: fleet(log, state), base: BASE, now: () => clock.now, sleep: async () => {} };
  const date = L.operatingDay(clock.now), d = db();
  await d.collection('runs').doc(L.weekStart(date) + '__reefer').set({ weekStart: L.weekStart(date), sheetRow: 950, route: '849', run: 'SUN VALLEY', active: true,
    days: { [L.dayPrefix(L.addDays(date, 1))]: { runs: true, loadDate: date, deliveryDate: L.addDays(date, 1), dispatchTime: 600, trailer: '701', loadStatus: 'COMPLETE' } } });
  await gpsCall(d, ADMIN, { kind: 'fleet', op: 'save', fleet: 'united-dairy', user: 'app', password: 'pw' }, o);
  state.reefer = [['71', '2026-10-13 14:02:00', '35.44'], ['71', '2026-10-13 14:07:00', '36.06'], ['71', '2026-10-13 14:08:00', '']];
  let r = await pull(d, o);
  assert.equal(r.reefer, 1, r.reeferError);
  assert.deepEqual(log.filter(l => l.startsWith('reefer ')), ['reefer 2026-10-13 11:10:00 to 2026-10-13 14:10:00'], 'the first read looks back 3 hours (trailers report seldom), every unit by time, once for both uses');
  let g = (await d.collection('gpsReefer').doc('T-701').get()).data();
  assert.deepEqual([g.recording, g.tempF, g.readingAt, g.routeRun, g.out], [true, 36.1, '2026-10-13T14:07:00.000Z', 'SUN VALLEY', '']);
  // Out on the road: still recorded.
  clock.now = new Date('2026-10-13T16:00:00Z'); state.trailerPlace = ''; state.reefer = [['71', '2026-10-13 15:58:00', '37.5']];
  r = await pull(d, o);
  assert.equal(log.filter(l => l.startsWith('reefer ')).pop(), 'reefer 2026-10-13 14:00:00 to 2026-10-13 16:00:00', 'carries on from the last read');
  g = (await d.collection('gpsReefer').doc('T-701').get()).data();
  assert.deepEqual([g.recording, g.tempF, g.out], [true, 37.5, '2026-10-13T16:00:00.000Z']);
  assert.equal((await d.collection('gpsReeferReadings').where('trailer', '==', 'T-701').get()).size, 2, 'one reading kept per read');
  // Back in the yard: recording stops and Fleet is not asked again.
  clock.now = new Date('2026-10-13T22:00:00Z'); state.trailerPlace = 'Uniontown Plant'; state.reefer = [['71', '2026-10-13 21:58:00', '39']];
  const before = log.length;
  r = await pull(d, o);
  g = (await d.collection('gpsReefer').doc('T-701').get()).data();
  assert.deepEqual([g.recording, g.stopReason, g.tempF], [false, 'BACK_IN_YARD', 37.5]);
  // Joe 10/20: the one read left is the every-15-minutes temperature of every trailer (Trucks Today), not this recording.
  assert.equal(log.slice(before).filter(l => l.startsWith('reefer ')).length, 1, 'nothing is read for the recording once it is back');
  const s = await gpsCall(d, ADMIN, { kind: 'fleet', op: 'status' }, o);
  assert.equal(s.coverage.find(c => c.key === 'reefer').label, 'Trailer temperatures (GPS)');
  // Joe 10/18: kept at most 6 months, then deleted, by the nightly cleanup (its own schedule, not the GPS read).
  await d.collection('gpsReeferReadings').doc('T-701_20260401120000').set({ trailer: 'T-701', at: '2026-04-01T12:00:00.000Z', tempF: 35 });
  const purged = await purgeReefer(d, '2026-10-14T12:00:00.000Z');
  assert.deepEqual(purged, { deleted: 1, done: true });
  const left = (await d.collection('gpsReeferReadings').get()).docs.map(x => x.id).sort();
  assert.equal(left.indexOf('T-701_20260401120000'), -1, 'a reading over 6 months old is deleted');
  assert.equal(left.length, 2, 'this month\'s readings stay');
});

test('Fleet GPS: the 6-month cleanup runs with no GPS login at all, and goes a page at a time until nothing old is left', async () => {
  const d = db();
  assert.equal((await d.collection('config').doc('fleetGps').get()).exists, false, 'no GPS login saved');
  const b = d.batch();
  for (let i = 0; i < 25; i++) b.set(d.collection('gpsReeferReadings').doc('T-9_old' + i), { trailer: 'T-9', at: '2026-03-0' + (1 + i % 9) + 'T12:00:00.000Z', tempF: 34 });
  b.set(d.collection('gpsReeferReadings').doc('T-9_new'), { trailer: 'T-9', at: '2026-10-01T12:00:00.000Z', tempF: 34 });
  await b.commit();
  assert.deepEqual(await purgeReefer(d, '2026-10-14T12:00:00.000Z', { page: 10 }), { deleted: 25, done: true }, 'three pages, not one');
  assert.deepEqual((await d.collection('gpsReeferReadings').get()).docs.map(x => x.id), ['T-9_new']);
  const f = (await d.collection('private').doc('gpsFleet').get()).data();
  assert.deepEqual([f.reeferPurgedOn, f.reeferPurged, f.reeferPurgeDone], ['2026-10-14', 25, true]);
});

// Joe 10/19: loaded trailers showed no GPS temperature on live. Fleet's trailer tags aren't always "T-701", and a trailer's
// unit can go well over 30 minutes between reports.
// Joe 10/22: exactly 32°F is the reefer's "no reading" value, so the trip keeps when an unbroken run of 32s started; Fleet's
// "not available" ends of the RefrigerationTemp range are not readings at all.
test('Fleet GPS: a run of exactly 32°F readings is timed from its first, cleared by any other reading; a "not available" value is dropped', async () => {
  const L = require('../../src/logic');
  const log = [], state = { trailerPlace: 'Loading Dock', reefer: [] }, clock = { now: new Date('2026-10-13T14:10:00Z') };
  const o = { fetch: fleet(log, state), base: BASE, now: () => clock.now, sleep: async () => {} };
  const date = L.operatingDay(clock.now), d = db();
  await d.collection('runs').doc(L.weekStart(date) + '__reefer').set({ weekStart: L.weekStart(date), sheetRow: 950, route: '849', run: 'SUN VALLEY', active: true,
    days: { [L.dayPrefix(L.addDays(date, 1))]: { runs: true, loadDate: date, deliveryDate: L.addDays(date, 1), dispatchTime: 600, trailer: '701', loadStatus: 'COMPLETE' } } });
  await gpsCall(d, ADMIN, { kind: 'fleet', op: 'save', fleet: 'united-dairy', user: 'app', password: 'pw' }, o);
  const trip = async () => (await d.collection('gpsReefer').doc('T-701').get()).data();
  state.reefer = [['71', '2026-10-13 13:00:00', '36'], ['71', '2026-10-13 14:00:00', '32'], ['71', '2026-10-13 14:05:00', '32']];
  await pull(d, o);
  let g = await trip();
  assert.deepEqual([g.tempF, g.flatSince], [32, '2026-10-13T14:00:00.000Z'], 'the run of 32s starts at its first reading');
  clock.now = new Date('2026-10-13T16:10:00Z'); state.reefer = [['71', '2026-10-13 16:05:00', '32']];
  await pull(d, o);
  g = await trip();
  assert.deepEqual([g.tempF, g.flatSince], [32, '2026-10-13T14:00:00.000Z'], 'still 32: the run keeps its start');
  clock.now = new Date('2026-10-13T16:20:00Z'); state.reefer = [['71', '2026-10-13 16:15:00', '-5866.2']];
  await pull(d, o);
  g = await trip();
  assert.deepEqual([g.tempF, g.readingAt], [32, '2026-10-13T16:05:00.000Z'], 'Fleet\'s "not available" value is not a reading');
  clock.now = new Date('2026-10-13T16:30:00Z'); state.reefer = [['71', '2026-10-13 16:25:00', '35.5']];
  await pull(d, o);
  g = await trip();
  assert.deepEqual([g.tempF, g.flatSince], [35.5, ''], 'a real reading ends the run');
});

test('Fleet GPS: a trailer tagged "TRL 701" in Fleet is matched, a reading 2 hours old is shown, and GPS Setup says which trailers get none', async () => {
  const L = require('../../src/logic');
  const log = [], state = { trailerPlace: 'Loading Dock', trailerTag: 'TRL 701', reefer: [['71', '2026-10-13 12:15:00', '34.2']] };
  const o = { fetch: fleet(log, state), base: BASE, now: NOW, sleep: async () => {} };
  const date = L.operatingDay(NOW()), d = db(), p = L.dayPrefix(L.addDays(date, 1));
  const day = (trailer) => ({ [p]: { runs: true, loadDate: date, deliveryDate: L.addDays(date, 1), dispatchTime: 600, trailer, loadStatus: 'COMPLETE' } });
  await d.collection('runs').doc(L.weekStart(date) + '__r701').set({ weekStart: L.weekStart(date), sheetRow: 950, route: '849', run: 'SUN VALLEY', active: true, days: day('701') });
  await d.collection('runs').doc(L.weekStart(date) + '__r777').set({ weekStart: L.weekStart(date), sheetRow: 951, route: '850', run: 'HILLTOP', active: true, days: day('777') });
  await gpsCall(d, ADMIN, { kind: 'fleet', op: 'save', fleet: 'united-dairy', user: 'app', password: 'pw' }, o);
  const r = await pull(d, o);
  assert.equal(r.reefer, 1, r.reeferError);
  const g = (await d.collection('gpsReefer').doc('T-701').get()).data();
  assert.deepEqual([g.unitId, g.tag, g.tempF, g.readingAt], ['71', 'TRL 701', 34.2, '2026-10-13T12:15:00.000Z']);
  const s = await gpsCall(d, ADMIN, { kind: 'fleet', op: 'status' }, o);
  assert.ok(s.reeferNoUnit.includes('T-777') && !s.reeferNoUnit.includes('T-701'), 'T-777 has no unit in Fleet: ' + s.reeferNoUnit);
  assert.deepEqual(s.reeferNoTemp, [], 'T-701 sent a temperature');
});

test('Fleet GPS temps (Joe 10/20): every trailer\'s newest cargo temperature in one record, asked for in Verizon\'s asynchronous mode; a Verizon error leads with its reference', async () => {
  const log = [], o = { fetch: fleet(log, { reefer: [['12', '2026-10-13 13:50:00', '35.04'], ['12', '2026-10-13 14:05:00', '36.2'], ['11', '2026-10-13 14:05:00', '50']] }), base: BASE, now: NOW, sleep: async () => {} };
  await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'save', fleet: 'united-dairy', user: 'app', password: 'pw' }, o);
  const r = await pull(db(), o);
  assert.equal(r.temps, 1, r.tempsError);
  assert.deepEqual(log.filter(l => l.startsWith('reefer ')), ['reefer 2026-10-13 11:10:00 to 2026-10-13 14:10:00'], 'every unit by time, 3 hours back; trailers picked out here');
  assert.ok(log.some(l => l.startsWith('GET ' + BASE + '/result/')), 'waits on the asynchronous answer');
  assert.deepEqual((await db().collection('gpsTemps').doc('now').get()).data().units, { 'T-635': { tempF: 36.2, at: '2026-10-13T14:05:00.000Z' } });

  const VERIZON_500 = '{ "errorInfo":[{ "errorCode":"5","errorText":"Internal server error.","errorParameters":[{ "parameter":"ExecutionId","value":"bb05c771-3dc1-4c32-93e0-e2a428e00000"}]}]}';
  const later = () => new Date('2026-10-13T14:40:00Z');
  const bad = Object.assign({}, o, { now: later, fetch: async (url, init) => /TrailerTemps/.test(url) ? reply(500, VERIZON_500) : fleet([], {})(url, init) });
  const b = await pull(db(), bad);
  assert.match(b.tempsError, /^Verizon Fleet answered 500 when running UDPO_TrailerTemps \(Verizon reference bb05c771-3dc1-4c32-93e0-e2a428e00000\)/);
  const s = await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'status' }, bad);
  assert.match(s.tempsError, /Verizon reference bb05c771/);
  assert.equal((await db().collection('gpsTemps').doc('now').get()).data().units['T-635'].tempF, 36.2, 'an error keeps the last reading');
});

test('Fleet GPS "Ask Verizon for everything" (Joe 10/20, 10/21): every field Verizon offers, every reading field for one unit asked by time only, in batches that carry on at the next press', async () => {
  const log = [], base = fleet(log, {}), saved = {};
  let shift = 0;
  const VERIZON_500 = '{ "errorInfo":[{ "errorCode":"5","errorText":"Internal server error.","errorParameters":[{ "parameter":"ExecutionId","value":"aaaa1111-0000-0000-0000-000000000001"}]}]}';
  // Fleet numbers its tables, data types and measurement units (Joe 10/21: "0 for GPS points and units" when we looked for the word).
  const diags = ['CargoAirTemp,Air temperature inside the cargo container,5', 'ReeferTemp,Refrigeration Temperature,5', 'Altitude,Height above sea level,8']
    .concat(Array.from({ length: 82 }, (x, i) => 'Diag' + String(i + 1).padStart(3, '0') + ',,7'));
  const columns = 'TableId,Name,Description,DataType,IsDiagnostic,IsReadable\r\n' + diags.map(x => '27,' + x + ',True,True').join('\r\n') +
    '\r\n27,WriteOnly,,7,True,False\r\n27,Lat,,6,False,True\r\n41,Custom.ReeferTemp,,7,False,True\r\n41,Tag,,7,False,True\r\n';
  const fetch = async (url, init) => {
    const path = url.slice(BASE.length).replace(/[?&]auth=[^&]+/, '');
    // Fleet's own template list: a name saved twice is an update of the same report (POST /templates/<id>), never a second copy.
    if (/^\/templates/.test(path) && /Probe/.test(String(init.body || ''))) {
      const name = /TemplateName = (\w+)/.exec(init.body)[1], id = /^\/templates\/(\d+)/.exec(path);
      assert.ok(!saved[name] || (id && id[1] === saved[name].id), 'an existing report is updated, not saved again: ' + name);
      saved[name] = { id: saved[name] ? saved[name].id : String(100 + Object.keys(saved).length), text: init.body };
      return reply(200, JSON.stringify({ name, templateId: saved[name].id }));
    }
    if (path === '/templates' && (init.method || 'GET') === 'GET') {
      const r = await base(url, init), list = JSON.parse(await r.text());
      return reply(200, JSON.stringify({ templates: list.concat(Object.keys(saved).map(n => ({ name: n, templateId: Number(saved[n].id) }))) }));
    }
    if (/template=UDPO_ProbeTables/.test(url)) return reply(200, 'Id,Name\r\n27,Point-2.0\r\n41,Unit-1.0\r\n');
    if (/template=UDPO_ProbeTypes/.test(url)) return reply(200, 'Id,Name,IsMeasurement,UnitId\r\n5,Temperature,True,3\r\n6,Angle,True,4\r\n7,Number,False,\r\n8,Distance,True,9\r\n');
    if (/template=UDPO_ProbeUnits/.test(url)) return reply(200, 'Id,Name,Abbreviation\r\n3,Kelvin,K\r\n4,Degrees,deg\r\n9,Meters,m\r\n');
    if (/template=UDPO_ProbeColumns/.test(url)) return reply(200, columns);
    if (/template=UDPO_ProbeAttributes/.test(url)) return reply(200, 'Id,Name,Type,IsGlobal\r\n1,Reefer Temp,Number,False\r\n2,Door,Boolean,False\r\n');
    // As on live 6.39 (Joe 10/21, T-965): anything sent with a unit list fails; the plain reads answer.
    if (/[?&]Ids=/.test(url)) { log.push('list ' + /template=(\w+)/.exec(url)[1]); return reply(500, VERIZON_500); }
    if (/template=UDPO_ProbeUnit&/.test(url)) return reply(200, 'UnitId,Tag,LastReport,LastDiagnostic,EngineHours,AssetType,DeviceType\r\n11,223876,2026-10-13 14:05:00,,15022.5,Truck,\r\n12,T-635,2026-10-13 14:06:00,2026-10-13 14:06:00,812,Trailer,TrailerTracker\r\n');
    if (/template=UDPO_ProbePoints/.test(url)) { assert.match(url, /PollingMode=Async/); const q = new URL(url).searchParams; log.push('points ' + q.get('Since') + ' to ' + q.get('Until')); return reply(200, 'UnitId,Time,Tag,Address\r\n11,2026-10-13 14:02:00,223876,Main St\r\n12,2026-10-13 14:05:00,T-635,Route 8\r\n'); }
    if (/template=UDPO_ProbeTemps/.test(url)) {
      // Each batch takes Verizon 45 seconds here, so the third waits for the next press.
      const q = new URL(url).searchParams, outs = saved.UDPO_ProbeTemps.text.split('\r\n').filter(l => /^F_/.test(l)).map(l => /^(F_\w+)/.exec(l)[1]);
      log.push('temps ' + q.get('Since') + ' to ' + q.get('Until') + ' ' + outs[0] + ' x' + outs.length);
      shift += 45000;
      if (outs.indexOf('F_Diag040') >= 0) return reply(500, VERIZON_500);
      const val = { F_CargoAirTemp: '2.5', F_ReeferTemp: '3.1', F_Altitude: '200', F_Diag080: '7' };
      const row = (u, t) => [u, t].concat(outs.map(k => u === '12' && t === '2026-10-13 14:05:00' ? val[k] || '' : u === '11' && k !== 'F_ReeferTemp' ? val[k] || '' : '')).join(',');
      return reply(200, ['UnitId,Time'].concat(outs).join(',') + '\r\n' + [row('11', '2026-10-13 13:58:00'), row('12', '2026-10-13 14:00:00'), row('12', '2026-10-13 14:05:00')].join('\r\n') + '\r\n');
    }
    return base(url, init);
  };
  const o = { fetch, base: BASE, now: () => new Date(NOW().getTime() + shift), sleep: async () => {} };
  await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'save', fleet: 'united-dairy', user: 'app', password: 'pw' }, o);
  await pull(db(), o);
  await assert.rejects(gpsCall(db(), DISPATCHER, { kind: 'fleet', op: 'probe', tag: 'T-635' }, o), /Only a manager or administrator/);
  const from = log.length, s = await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'probe', tag: 't 635' }, o), p = s.probe;
  assert.equal(p.tag, 't 635');
  // 1. Every field, with Fleet's own table and type names, the temperature ones first.
  assert.equal(p.steps[0].label, 'Every field Verizon offers (search the list below)');
  assert.equal(p.steps[0].note, '89 fields in all, 3 with temperature, refrigeration, reefer, cargo or sensor in the name or description (listed first).');
  assert.deepEqual(p.steps[0].fields.slice(0, 3), [{ table: 'Point-2.0', name: 'CargoAirTemp', type: 'Temperature', description: 'Air temperature inside the cargo container', reading: true },
    { table: 'Point-2.0', name: 'ReeferTemp', type: 'Temperature', description: 'Refrigeration Temperature', reading: true }, { table: 'Unit-1.0', name: 'Custom.ReeferTemp', type: 'Number', description: '', reading: false }], 'Joe 10/21: Fleet shows it as "Refrigeration Temperature"');
  assert.equal(p.steps[0].fields.length, 89, 'all of them, not only the matches');
  assert.deepEqual(p.steps[1].rows.map(r => r.Name), ['Reefer Temp'], 'Joe\'s "Reefer Temp"');
  assert.equal(p.steps[2].note, '2 units; T-635 is one of them.');
  assert.deepEqual(p.steps[2].rows.map(r => r.Tag), ['T-635'], 'all units asked, this one picked out');
  assert.doesNotMatch(saved.UDPO_ProbeUnit.text, /\[Filter\]/, 'the unit record is asked the way the working 5-minute read asks');
  assert.match(p.steps[3].note, /answered 500 when running UDPO_ProbeUnitList \(Verizon reference aaaa1111-0000-0000-0000-000000000001\)/, 'the same unit asked with a list, to compare');
  assert.ok(log.indexOf('points 2026-10-13 14:00:00 to 2026-10-13 14:10:00') >= 0, 'every unit\'s points for 10 minutes');
  assert.equal(p.steps[4].note, '2 GPS points from 2 units; 1 from T-635.');
  assert.doesNotMatch(saved.UDPO_ProbePoints.text, /UnitId = In\(|Ids/);
  // 2. Every readable reading field of the GPS points, 40 at a time, by time only; write-only and non-reading fields are not asked.
  assert.deepEqual(log.slice(from).filter(l => l.startsWith('temps ')), ['temps 2026-10-13 13:55:00 to 2026-10-13 14:10:00 F_CargoAirTemp x40', 'temps 2026-10-13 13:55:00 to 2026-10-13 14:10:00 F_Diag038 x40']);
  assert.deepEqual(log.slice(from).filter(l => l.startsWith('list ')), ['list UDPO_ProbeUnitList'], 'only the comparison sends a unit list');
  assert.match(saved.UDPO_ProbeTemps.text, /TableID = Point-2\.0/);
  assert.doesNotMatch(saved.UDPO_ProbeTemps.text, /UnitId = In\(|Ids|WriteOnly|Lat/);
  assert.deepEqual(p.steps.slice(5, 7).map(x => [x.ok, !!x.quiet]), [[true, true], [false, false]]);
  assert.equal(p.steps[5].note, '3 GPS points; 3 of these 40 fields have a value.');
  assert.match(p.steps[6].note, /Verizon reference aaaa1111/, 'a batch Verizon refuses shows its reference');
  const sum = p.steps[7];
  assert.ok(sum.summary);
  assert.equal(sum.note, '3 of 85 reading fields have a value from some unit; 3 from T-635. Not read (Verizon error): 40 fields. 5 fields not asked yet: press Ask Verizon again to carry on.');
  assert.deepEqual(sum.rows[0], { Field: 'CargoAirTemp', Description: 'Air temperature inside the cargo container', 'Latest from T-635': '2.5 C', At: '2026-10-13 14:05:00', 'Units sending it': '2' });
  assert.deepEqual(sum.rows.map(r => r.Field), ['CargoAirTemp', 'Altitude', 'ReeferTemp']);
  assert.equal(sum.rows[1]['Latest from T-635'], '200 Meters', 'each field asked in the unit Verizon keeps it in');
  assert.match(saved.UDPO_ProbeTemps.text, /F_Diag038 = Input\.Diag038/);
  // 3. The next press with the same unit carries on with the rest; nothing already asked is asked again.
  const at = log.length, q = (await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'probe', tag: 'T-635' }, o)).probe;
  assert.deepEqual(log.slice(at).filter(l => /^(temps|points|list) /.test(l)), ['temps 2026-10-13 13:56:30 to 2026-10-13 14:11:30 F_Diag078 x5']);
  assert.equal(q.steps.filter(x => x.summary).length, 1);
  assert.equal(q.steps[0].fields.length, 89, 'the field list is still there');
  assert.equal(q.steps[q.steps.length - 1].note, '4 of 85 reading fields have a value from some unit; 4 from T-635. Not read (Verizon error): 40 fields.');
  assert.equal(q.next, undefined);
  assert.equal((await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'status' }, o)).probe.steps.length, 9);
  // Once finished, the next press starts over.
  const again = log.length;
  await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'probe', tag: 'T-635' }, o);
  assert.ok(log.slice(again).some(l => l.startsWith('points ')));
  await assert.rejects(gpsCall(db(), ADMIN, { kind: 'fleet', op: 'probe', tag: '' }, o), /Type a Fleet unit number/);
  const none = await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'probe', tag: 'T-999' }, o);
  assert.match(none.probe.steps[2].note, /has no unit T-999/);
});
