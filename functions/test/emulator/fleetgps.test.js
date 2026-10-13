'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { gpsCall } = require('../../src/gps');
const { pull } = require('../../src/fleetgps');
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
  const saved = [];
  return async (url, init) => {
    log.push((init.method || 'GET') + ' ' + url.replace(/auth=[^&]+/, 'auth=*'));
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
    if (url.startsWith(BASE + '/execute?template=UDPO_TrucksNow')) {
      const odo = (opts && opts.odo) || { a: 412345.6, at: '2026-10-13 14:05:00' };
      return reply(200, 'UnitId,Tag,LastReport,Lat,Lon,Address,Place,SpeedMph,IgnitionOn,OdometerMiles,EngineHours,Driver,Active\r\n'
        + '11,223876,' + odo.at + ',39.99,-81.1,"1 Main St, Uniontown OH",Uniontown Yard,0,False,' + odo.a + ',15022.5,Pat Smith,True\r\n'
        + '12,T-635,2026-10-13 14:06:00,40.1,-81.3,"Route 8, Akron OH",,54,True,,,,True\r\n');
    }
    return reply(404, '');
  };
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
  assert.deepEqual(s.pulled, { trucks: 2, days: 1 });
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
  assert.deepEqual(await pull(db(), o), { trucks: 2, days: 1 });
  assert.equal(log.slice(before).filter(l => /rest\/login|\/templates/.test(l)).length, 0);
  day = (await db().collection('gpsDays').doc('2026-10-13_223876').get()).data();
  assert.deepEqual([day.miles, day.firstMove, day.lastMove], [12.4, '2026-10-13T14:15:00.000Z', '2026-10-13T14:15:00.000Z']);
  // No new report: nothing is written.
  assert.deepEqual(await pull(db(), o), { trucks: 2, days: 0 });
  // A new New York day starts again from that day's first reading.
  clock.now = new Date('2026-10-14T11:00:00Z'); state.odo = { a: 412400, at: '2026-10-14 10:59:00' };
  await pull(db(), o);
  assert.equal((await db().collection('gpsDays').doc('2026-10-14_223876').get()).data().miles, 0);

  s = await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'clear' }, o);
  assert.deepEqual([s.fleet, s.hasUser, s.hasPassword], ['united-dairy', false, false]);
  assert.deepEqual(await pull(db(), o), { skipped: 'no login' });
  assert.ok(log.every(l => l.indexOf(BASE) >= 0));
});

test('Fleet GPS: when Fleet will not take the POST login, the address form Verizon sent works', async () => {
  const log = [], o = { fetch: fleet(log, { postMissing: true }), base: BASE, now: NOW, sleep: async () => {} };
  await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'save', fleet: 'united-dairy', user: 'app', password: 'pw' }, o);
  const s = await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'test' }, o);
  assert.equal(s.result.ok, true, s.result.message);
  assert.ok(log.indexOf('GET ' + BASE + '/rest/login/united-dairy/app/pw') >= 0);
});
