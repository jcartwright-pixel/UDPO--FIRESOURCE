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
  const saved = [];
  return async (url, init) => {
    log.push((init.method || 'GET') + ' ' + url.replace(/auth=[^&]+/, 'auth=*'));
    if (url === BASE + '/rest/login') {
      if (opts && opts.postMissing) return reply(405, '');
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
      return reply(200, 'UnitId,Tag,LastReport,Lat,Lon,Address,Place,SpeedMph,IgnitionOn,OdometerMiles,EngineHours,Driver,Active\r\n'
        + '11,223876,2026-10-13 14:05:00,39.99,-81.1,"1 Main St, Uniontown OH",Uniontown Yard,0,False,412345.6,15022.5,Pat Smith,True\r\n'
        + '12,223877,2026-10-13 14:06:00,40.1,-81.3,"Route 8, Akron OH",,54,True,300100,9000,,True\r\n');
    }
    if (url.startsWith(BASE + '/execute?template=UDPO_DayPoints')) {
      assert.match(url, /ReportStart=2026-10-13&ReportEnd=2026-10-15/);
      return reply(200, 'UnitId,Tag,Time,Lat,Lon,Address,MilesDelta\n'
        + '11,223876,2026-10-13 03:30:00,0,0,Yard,5\n'      // 11:30 p.m. on 10/12 in New York: not today
        + '11,223876,2026-10-13 10:00:00,0,0,Yard,0\n'
        + '11,223876,2026-10-13 10:15:00,0,0,Road,12.4\n'
        + '11,223876,2026-10-13 13:40:00,0,0,Store,30.2\n'
        + '12,223877,2026-10-13 11:00:00,0,0,Akron,0\n');
    }
    return reply(404, '');
  };
}
const NOW = () => new Date('2026-10-13T14:10:00Z');

test('Fleet GPS: managers only, the login never comes back, Test says plainly what works, a pull stores trucks and miles', async () => {
  const log = [], o = { fetch: fleet(log), base: BASE, now: NOW, sleep: async () => {} };
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
  assert.match(s.result.message, /^Connected\. Verizon Fleet answered with 2 trucks, for example 223876, 223877\./);
  assert.equal(log.filter(l => l.startsWith('POST ' + BASE + '/templates')).length, 2, 'both templates saved once');

  s = await gpsCall(db(), ADMIN, { kind: 'fleet', op: 'pull' }, o);
  assert.deepEqual(s.pulled, { trucks: 2, days: 2 });
  const t = (await db().collection('gpsTrucks').doc('223876').get()).data();
  assert.equal(t.lastReport, '2026-10-13T14:05:00.000Z');
  assert.equal(t.place, 'Uniontown Yard');
  assert.equal(t.address, '1 Main St, Uniontown OH');
  assert.equal(t.odometerMiles, 412345.6);
  assert.equal(t.engineHours, 15022.5);
  assert.equal(t.ignitionOn, false);
  assert.equal(t.driver, 'Pat Smith');
  const day = (await db().collection('gpsDays').doc('2026-10-13_223876').get()).data();
  assert.equal(day.miles, 42.6, 'only today\'s New York points count');
  assert.equal(day.firstMove, '2026-10-13T10:15:00.000Z');
  assert.equal(day.lastMove, '2026-10-13T13:40:00.000Z');
  assert.equal(day.lastPlace, 'Store');

  // The saved key is used again, and the templates are not sent again.
  const before = log.length;
  await pull(db(), o);
  assert.equal(log.slice(before).filter(l => /rest\/login|\/templates/.test(l)).length, 0);

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
