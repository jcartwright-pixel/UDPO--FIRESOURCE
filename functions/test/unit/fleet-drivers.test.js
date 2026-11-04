'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { driverList, DRIVER_NEVER } = require('../../src/fleetgps');

// Joe 11-4-26: the hub's Download Verizon drivers button. Made-up drivers only.
function fakeFleet() {
  const posted = [];
  const csv = {
    UDPO_ProbeTables: 'Id,Name\n1,Driver\n2,User\n',
    UDPO_DriversColumns: 'TableId,Name,IsReadable\n1,Id,true\n1,Name,true\n1,UserId,true\n1,Tag,true\n1,Phone,true\n1,LicenseNumber,true\n1,Address,true\n2,Id,true\n2,Username,true\n2,Password,true\n2,Email,true\n',
    UDPO_DriversDriver: 'F_Id,F_Name,F_UserId,F_Tag\n10,Sam Sample,77,D100\n11,Pat Example,,D101\n',
    UDPO_DriversUser: 'F_Id,F_Username\n77,ssample\n'
  };
  const res = (status, body) => ({ status, text: async () => body });
  const fetch = async (url, init) => {
    if (/\/templates/.test(url)) { if (init.method === 'POST') posted.push(init.body); return res(200, '[]'); }
    const m = /template=([^&]+)/.exec(url);
    return res(200, csv[decodeURIComponent(m[1])] || '');
  };
  return { posted, o: { fetch, now: () => new Date('2026-11-04T12:00:00Z'), sleep: async () => {}, ref: { set: async () => {} } } };
}

test('Verizon drivers: names joined to their Fleet login; phones, addresses, licenses and passwords never asked for', async () => {
  const f = fakeFleet();
  const d = { fleet: 'sample', user: 'u', password: 'p', token: 't', tokenUntil: '2026-11-05T00:00:00Z' };
  const out = await driverList(d, f.o);
  assert.equal(out.count, 2);
  assert.deepEqual(out.rows.map(r => [r.name, r.username, r.number]), [['Sam Sample', 'ssample', 'D100'], ['Pat Example', '', 'D101']]);
  assert.deepEqual(out.driverColumns, ['Id', 'Name', 'UserId', 'Tag']);
  assert.deepEqual(out.userColumns, ['Id', 'Username']);
  const asked = f.posted.filter(b => /UDPO_Drivers(Driver|User)/.test(b)).join('\n');
  assert.ok(asked && !/Input\.(Phone|LicenseNumber|Address|Password|Email)/.test(asked));
  ['Password', 'PIN', 'MobilePhone', 'LicenseNumber', 'Email', 'BirthDate'].forEach(c => assert.ok(DRIVER_NEVER.test(c), c));
});

test('Verizon drivers: no Fleet login saved says so', async () => {
  await assert.rejects(driverList({}, fakeFleet().o), /Save the Fleet login first/);
});
