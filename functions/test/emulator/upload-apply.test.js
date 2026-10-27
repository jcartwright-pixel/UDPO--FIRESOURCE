'use strict';
// Joe 10/27: "We should have templates to download. They fill out, and then we will upload." A saved Plant Setup Workbook
// fills that plant's own lists in that plant's own database (routes, drivers, days off, lines, machines and the rest), the
// records its screens read. Nothing lands in Uniontown's lists, the same file twice changes nothing, and a row taken off the
// file takes its record off.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear, plantDb } = require('./helpers');
const U = require('../../src/upload-rules');
const { OPS } = require('../../src/uploads');

const CH = 'fac_charleston', ADMIN = 'admin.test@uniteddairy.com', STAMP = '2026-10-27T15:00:00.000Z';
const tab = (key, rows) => {
  const t = U.SPEC.find(x => x.key === key);
  return { name: t.tab, cells: [t.cols.map(c => c.h)].concat(rows.map(r => t.cols.map(c => r[c.key] || ''))) };
};
// A small made-up Charleston workbook.
function book(over) {
  const o = over || {};
  return [
    tab('routes', o.routes || [
      { route: '901', load: 'Load 1', name: 'SAMPLE GROCERY', loadType: 'Case Loadout', runBy: 'United Dairy', owner: 'Charleston', leaves: 'Delivery Day', status: 'Active' },
      { route: '902', load: 'Load 1', name: 'SAMPLE MARKET', runBy: 'Customer Pickup', owner: 'Charleston', status: 'Active' }
    ]),
    tab('routeDays', [{ route: '901', load: 'Load 1', day: 'Mon', runs: 'Yes', time: '4:00 AM', loadOrder: '1', miles: '120', loaded: 'Day before' }]),
    tab('drivers', [{ employeeId: '70001', name: 'Pat Sample', status: 'Active', phone: '3045550100' }]),
    tab('regularWeek', [{ employeeId: '70001', sunWorks: 'Off', monWorks: 'Yes', monRoute: '901 Load 1', tueWorks: 'Off', wedWorks: 'Off', thuWorks: 'Off', friWorks: 'Off', satWorks: 'Off' }]),
    tab('daysOff', [{ employeeId: '70001', start: '11-23-26', end: '11-24-26', type: 'VACATION', status: 'APPROVED' }]),
    tab('lines', [{ name: 'QUART FILLER', area: 'Production', order: '1', counter: 'Typed by operator', active: 'Yes' }]),
    tab('products', [{ line: 'QUART FILLER', name: 'QT CHOC MILK', sku: '330001', mfgType: 'Quart', productGroup: 'Milk' }]),
    tab('machines', o.machines || [{ name: 'BOILER 1', kind: 'Utility', area: 'Boiler Room' }, { name: 'AIR COMPRESSOR', kind: 'Utility' }]),
    tab('pmTasks', [{ machine: 'BOILER 1', task: 'Blow down', every: '1', unit: 'Weeks' }]),
    tab('coolers', [{ name: 'MAIN COOLER', low: '33', high: '40', active: 'Yes' }]),
    tab('extinguishers', [{ tag: 'CH-01', location: 'Dock door 1', type: 'ABC' }]),
    tab('people', [{ name: 'Sam Example', email: 'sam.example@uniteddairy.com', role: 'Plant Employee', plants: 'This plant', active: 'Yes' }]),
    tab('stations', [{ name: 'Front Dock Tablet', kind: 'Case Loadout' }])
  ];
}
const save = (sheets) => OPS.uploadSave(db(), ADMIN, { plant: CH, fileName: 'charleston.xlsx', sheets }, STAMP, {});
const ids = async (d, c) => (await d.collection(c).get()).docs.map(x => x.id).sort();

test.beforeEach(clear);

test('An upload fills Charleston\'s own lists, and none of it lands in Uniontown\'s', async () => {
  const done = await save(book());
  assert.equal(done.ok, true);
  assert.match(done.message, /Charleston's screens now show them/);
  const ch = plantDb(CH), ut = db();

  const routes = (await ch.collection('routes').get()).docs.map(x => x.data());
  assert.equal(routes.length, 2, 'both routes are in Charleston\'s Route Master');
  assert.ok(routes.every(r => r.facilityId === CH), 'every route is Charleston\'s');
  const drivers = (await ch.collection('drivers').get()).docs.map(x => x.data());
  assert.deepEqual(drivers.map(x => x.name), ['Pat Sample']);
  assert.equal((await ch.collection('vacations').get()).size, 1, 'the vacation is on Charleston\'s days off');
  assert.ok((await ch.collection('plantSetup').get()).docs.some(x => x.data().name === 'QUART FILLER'), 'the line is on Charleston\'s plant setup');
  assert.deepEqual(await ids(ch, 'plantMachines'), ['charleston_mach_air_compressor', 'charleston_mach_boiler_1']);
  assert.equal((await ch.collection('plantPmTasks').get()).size, 1);
  assert.equal((await ch.collection('tempLocations').get()).size, 1);
  assert.equal((await ch.collection('extinguishers').get()).size, 1);
  const stations = Object.values(((await ch.collection('private').doc('stations').get()).data() || {}).list || {});
  assert.deepEqual(stations.map(s => s.name), ['Front Dock Tablet']);

  for (const c of ['routes', 'drivers', 'vacations', 'plantSetup', 'plantMachines', 'plantPmTasks', 'tempLocations', 'extinguishers']) {
    assert.equal((await ut.collection(c).get()).size, 0, 'nothing in Uniontown\'s ' + c);
  }
  // People are on the company's one Users list with Charleston only.
  const sam = (await ut.collection('users').doc('sam.example@uniteddairy.com').get()).data();
  assert.deepEqual(sam.facilities, [CH]);
  assert.deepEqual(sam.roles, ['PLANT_EMPLOYEE']);
});

test('The same file twice changes nothing; a row taken off takes its record off', async () => {
  await save(book());
  const ch = plantDb(CH);
  const before = (await ch.collection('plantMachines').doc('charleston_mach_boiler_1').get()).data();
  await save(book());
  assert.deepEqual(await ids(ch, 'plantMachines'), ['charleston_mach_air_compressor', 'charleston_mach_boiler_1'], 'no second copy');
  assert.equal((await ch.collection('routes').get()).size, 2);
  assert.deepEqual((await ch.collection('plantMachines').doc('charleston_mach_boiler_1').get()).data().name, before.name);

  await save([tab('machines', [{ name: 'BOILER 1', kind: 'Utility', area: 'Boiler Room' }]),
    tab('routes', [{ route: '901', load: 'Load 1', name: 'SAMPLE GROCERY', runBy: 'United Dairy', owner: 'Charleston', status: 'Active' }])]);
  assert.deepEqual(await ids(ch, 'plantMachines'), ['charleston_mach_boiler_1'], 'the compressor taken off the file is gone');
  assert.equal((await ch.collection('routes').get()).size, 1, 'route 902 taken off the file is gone');
  assert.equal((await ch.collection('drivers').get()).size, 1, 'a tab not in this file keeps its records');
});

test('The rest of the workbook fills Charleston\'s shifts, areas, safety checks, receiving, garage, report groups and email', async () => {
  const done = await save([
    tab('shifts', [{ name: 'Day Shift', start: '6:00 AM', end: '2:30 PM', side: 'Plant Production' }]),
    tab('locationAreas', [{ area: 'Plant', sub: 'Loading Dock' }]),
    tab('safety', [{ area: 'Plant', sub: 'Loading Dock', item: 'Dock plates stored', freq: 'Weekly' }]),
    tab('suppliers', [{ name: 'SAMPLE CAPS CO', short: 'Sample Caps', code: 'SC' }]),
    tab('receivingItems', [{ name: 'QUART CAPS RED' }]),
    tab('garageTechs', [{ name: 'LEE TESTER', active: 'Yes' }]),
    tab('recipients', [{ group: 'Charleston Managers', email: 'managers@example.com' }]),
    tab('plantEmail', [{ fromEmail: 'chplant@uniteddairy.com', fromName: 'United Dairy Charleston', checkinTo: 'checkin@uniteddairy.com' }])
  ]);
  assert.equal(done.ok, true, done.message);
  const ch = plantDb(CH), ut = db();
  for (const k of ['shifts', 'locationAreas', 'safety', 'suppliers', 'receivingItems', 'garageTechs', 'recipients', 'plantEmail']) assert.ok(done.applied[k] >= 1, k + ' filled');
  for (const c of ['receivingItems', 'garageTechs', 'reportGroups', 'plantJournal']) {
    assert.ok((await ch.collection(c).get()).size >= 1, 'Charleston has its ' + c);
    assert.equal((await ut.collection(c).get()).size, 0, 'nothing in Uniontown\'s ' + c);
  }
  const mail = (await ch.collection('private').doc('emailSettings').get()).data();
  assert.equal(mail.senders[CH].address, 'chplant@uniteddairy.com');
  assert.equal((await ch.collection('private').doc('checkinEmail_' + CH).get()).data().enabled, false, 'the check-in mailbox is saved off');
  assert.equal((await ut.collection('private').doc('emailSettings').get()).exists, false);
});
