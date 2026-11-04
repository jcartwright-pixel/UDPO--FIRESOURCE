'use strict';
// Joe 11/4: GPS Setup's Download driver usernames (fleetgps.js op 'drivers'): every Fleet driver joined to their Fleet
// login, read only, nothing kept. Made-up names only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fleetCall, DRIVER_TEMPLATES } = require('../../src/fleetgps');

const BASE = 'https://united-dairy.api.telogis.com';
const reply = (status, body) => ({ status, text: async () => body });
function fakeDb(docs) {
  const coll = (c) => ({ doc: (id) => ({ get: async () => ({ data: () => docs[c + '/' + id] }), set: async (v, opt) => { docs[c + '/' + id] = opt && opt.merge ? Object.assign({}, docs[c + '/' + id], v) : v; } }), count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }), get: async () => ({ docs: [] }) });
  return { collection: coll };
}

test('Download driver usernames: each driver with their Fleet login, sorted by name; only reports are saved in Fleet', async () => {
  const docs = { 'private/gpsFleet': { fleet: 'united-dairy', user: 'app', password: 'pw' } }, log = [];
  const fetch = async (url, init) => {
    log.push(init.method + ' ' + url.replace(BASE, '').replace(/auth=[^&]+/, 'auth=*'));
    if (url === BASE + '/rest/login') return reply(200, JSON.stringify({ token: 'k1' }));
    if (url.startsWith(BASE + '/templates')) return reply(200, init.method === 'POST' ? '{}' : '[]');
    if (/template=UDPO_DriverList/.test(url)) return reply(200, 'Id,EmployeeNo,Surname,FirstName,MiddleName,Nickname,Depot,UserId,HireDate,LeaveDate\r\n'
      + 'D2,1002,Zee,Amy,,,Uniontown,U2,2024-03-01 00:00:00,\r\nD1,1001,Able,Bob,Q,Bobby,Uniontown,,2020-01-15 00:00:00,2026-05-01 00:00:00\r\nD3,,Cole,Cy,,,,,,\r\n');
    if (/template=UDPO_UserLogins/.test(url)) return reply(200, 'Id,Username,FullName,Disabled,LastLogin,DriverId\r\n'
      + 'U2,united-dairy:azee,Amy Zee,False,2026-11-03 12:00:00,\r\nU1,bable,Bob Able,True,,D1\r\nU9,office,Office Person,False,,\r\n');
    return reply(404, '');
  };
  const r = await fleetCall(fakeDb(docs), 'admin.test@uniteddairy.com', { op: 'drivers' }, { fetch, base: BASE, now: () => new Date('2026-11-04T15:00:00Z') });
  const l = r.driverList;
  assert.equal(l.count, 3);
  assert.equal(l.withUsername, 2);
  assert.deepEqual(l.drivers.map(x => [x.lastName, x.username, x.employeeNo]), [['Able', 'bable', '1001'], ['Cole', '', ''], ['Zee', 'azee', '1002']]);
  assert.equal(l.drivers[0].loginDisabled, true);
  assert.equal(l.drivers[0].hireDate, '2020-01-15');
  assert.equal(l.drivers[0].leaveDate, '2026-05-01');
  assert.equal(l.drivers[2].lastLogin, '2026-11-03T12:00:00.000Z');
  // Nothing about the drivers is kept in the app; only the login key is refreshed.
  assert.deepEqual(Object.keys(docs), ['private/gpsFleet']);
  assert.ok(!JSON.stringify(docs).includes('azee'));
  // Fleet only gets Retrieve reports saved, and the two reports run.
  const posts = log.filter(x => x.startsWith('POST /templates'));
  assert.equal(posts.length, 2);
  assert.ok(Object.values(DRIVER_TEMPLATES).every(t => log.some(x => x.includes('template=' + t.name))));
});

test('Download driver usernames needs the Fleet login saved first', async () => {
  await assert.rejects(fleetCall(fakeDb({}), 'a@b', { op: 'drivers' }, { fetch: async () => reply(500, ''), base: BASE }), /Save the Fleet login first/);
});
