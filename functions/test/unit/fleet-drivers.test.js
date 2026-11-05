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

// Joe 11-5-26: GPS Setup's Remove drivers from Verizon. Check changes nothing; Delete removes only exact matches. Made-up names.
const { removeNames, removeMatch } = require('../../src/fleetgps');
function removeFleet(docs) {
  const log = [], deleted = new Set();
  const fetch = async (url, init) => {
    log.push({ method: init.method, url: url.replace(BASE, ''), body: init.body });
    if (url === BASE + '/rest/login') return reply(200, JSON.stringify({ token: 'k1' }));
    if (url.startsWith(BASE + '/templates')) return reply(200, init.method === 'POST' ? '{}' : '[]');
    if (/template=UDPO_DriverRemove/.test(url)) { String(init.body).split(/\r\n/).slice(1).filter(Boolean).forEach(id => deleted.add(id)); return reply(200, JSON.stringify({ Failed: 0, Created: 0, Deleted: deleted.size, Updated: 0 })); }
    if (/template=UDPO_DriverList/.test(url)) return reply(200, 'Id,EmployeeNo,Surname,FirstName,MiddleName,Nickname,Depot,UserId,HireDate,LeaveDate\r\n'
      + [['D1', '1001', 'Able', 'Bob', 'U1'], ['D2', '1002', 'Zee', 'Amy', 'U2'], ['D3', '', 'Twin', 'Al', 'U3'], ['D4', '', 'Twin', 'Ann', 'U4']].filter(r => !deleted.has(r[0])).map(r => [r[0], r[1], r[2], r[3], '', '', '', r[4], '', ''].join(',')).join('\r\n') + '\r\n');
    if (/template=UDPO_UserLogins/.test(url)) return reply(200, 'Id,Username,FullName,Disabled,LastLogin,DriverId\r\nU1,united-dairy:bable,,False,,\r\nU2,azee,,False,,\r\nU3,atwin,,False,,\r\nU4,atwin,,False,,\r\n');
    return reply(404, '');
  };
  return { log, deleted, opts: { fetch, base: BASE, now: () => new Date('2026-11-05T15:00:00Z') } };
}

test('Remove drivers: usernames are cleaned, deduplicated and capped', () => {
  assert.deepEqual(removeNames(' BAble\nunited-dairy:azee, bable '), ['bable', 'azee']);
  assert.throws(() => removeNames('  '), /Type the Verizon usernames/);
  assert.throws(() => removeNames(Array.from({ length: 151 }, (_, i) => 'u' + i)), /At most 150/);
  const m = removeMatch(['bable', 'nobody'], [{ id: 'D1', username: 'bable', firstName: 'Bob', lastName: 'Able' }]);
  assert.deepEqual(m.matched.map(x => x.id), ['D1']);
  assert.deepEqual(m.notFound, ['nobody']);
});

test('Remove drivers: Check changes nothing in Verizon or the app', async () => {
  const docs = { 'private/gpsFleet': { fleet: 'united-dairy', user: 'app', password: 'pw' } }, f = removeFleet(docs);
  const r = (await fleetCall(fakeDb(docs), 'admin.test@uniteddairy.com', { op: 'removeDrivers', usernames: 'bable\natwin\nghost' }, f.opts)).removed;
  assert.equal(r.done, false);
  assert.deepEqual(r.matched.map(x => [x.username, x.id, x.name, x.employeeNo]), [['bable', 'D1', 'Bob Able', '1001']]);
  assert.deepEqual(r.several, [{ username: 'atwin', count: 2 }]);
  assert.deepEqual(r.notFound, ['ghost']);
  assert.ok(!f.log.some(x => /UDPO_DriverRemove/.test(x.url)));
  assert.equal(f.deleted.size, 0);
  assert.ok(!docs['private/gpsDriverRemovals']);
});

test('Remove drivers: Delete removes only the exact matches by Fleet Id, checks they are gone and keeps a record', async () => {
  const docs = { 'private/gpsFleet': { fleet: 'united-dairy', user: 'app', password: 'pw' } }, f = removeFleet(docs);
  const r = (await fleetCall(fakeDb(docs), 'admin.test@uniteddairy.com', { op: 'removeDrivers', usernames: 'bable\nazee\natwin\nghost', confirm: true }, f.opts)).removed;
  assert.equal(r.done, true);
  assert.deepEqual([...f.deleted].sort(), ['D1', 'D2']);
  assert.deepEqual(r.deleted.map(x => x.username), ['bable', 'azee']);
  assert.deepEqual(r.notDeleted, []);
  const saved = f.log.find(x => x.method === 'POST' && x.url.startsWith('/templates') && /UDPO_DriverRemove/.test(x.body)).body;
  assert.match(saved, /TableID = Driver-1\.0/);
  assert.match(saved, /Intent = Delete/);
  assert.match(saved, /Id = Input\.Id/);
  assert.equal(f.log.find(x => /template=UDPO_DriverRemove/.test(x.url)).body, 'Id\r\nD1\r\nD2\r\n');
  assert.deepEqual(docs['private/gpsDriverRemovals'].last.deleted.map(x => x.id), ['D1', 'D2']);
  assert.equal(docs['private/gpsDriverRemovals'].last.by, 'admin.test@uniteddairy.com');
});

test('Remove drivers: nothing matched deletes nothing', async () => {
  const docs = { 'private/gpsFleet': { fleet: 'united-dairy', user: 'app', password: 'pw' } }, f = removeFleet(docs);
  await assert.rejects(fleetCall(fakeDb(docs), 'a@b', { op: 'removeDrivers', usernames: 'ghost', confirm: true }, f.opts), /nothing was deleted/);
  assert.equal(f.deleted.size, 0);
});
