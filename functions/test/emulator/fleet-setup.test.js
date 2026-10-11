'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const { garageCall } = require('../../src/garage');
const F = require('../fixtures/fake-sheets');

// Fleet Service Setup's saves (fleet.js), Joe 10/11 review items 24-26: the rules, one unit's dates, the technicians.
const { sheets, SOURCES } = require('../fixtures/garage-demo');
const MANAGER = { email: 'manager.test@uniteddairy.com' }, DISPATCH = { email: 'dispatch.test@uniteddairy.com' };
let n = 0;
const rid = () => 'fleet-setup-' + (++n) + '-' + Date.now();
const act = (user, action, fields) => applyAction(db(), user, Object.assign({ action, requestId: rid() }, fields));
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(sheets()), sources: SOURCES, now: () => new Date('2026-10-06T12:00:00Z') });
});

test('rules: managers change them, a blank box keeps the rule, nonsense is refused; the garage\'s DOT date follows them', async () => {
  await assert.rejects(act(DISPATCH, 'saveFleetRules', { rules: { dotMonths: 6 } }), /role/);
  await assert.rejects(act(MANAGER, 'saveFleetRules', { rules: { truckMiles: '-5' } }), /number above zero/);
  await assert.rejects(act(MANAGER, 'saveFleetRules', { rules: {} }), /at least one rule/);
  const r = await act(MANAGER, 'saveFleetRules', { rules: { truckMiles: '12,000', dotMonths: '6', plateWarnDays: '' } });
  assert.deepEqual([r.rules.truckMiles, r.rules.dotMonths, r.rules.plateWarnDays, r.rules.trailerMonths], [12000, 6, 30, 4]);
  const saved = (await db().collection('config').doc('fleetRules').get()).data();
  assert.equal(saved.updated_by, 'manager.test@uniteddairy.com');
  // A DOT inspection completed on the Garage Station: the next one is due in 6 months, not 12.
  const sent = await act(MANAGER, 'sendToGarage', { unit: '900002', unitType: 'TRUCK', serviceKey: 'DOT' });
  const at = () => new Date('2026-10-06T14:00:00Z');
  const tom = await garageCall(db(), { op: 'signIn', techId: 'TECH-JT', loginId: '48213', tokens: [] }, at);
  await garageCall(db(), { op: 'step', tokens: [tom.token], step: 'START', id: sent.workOrderId, requestId: rid() }, at);
  await garageCall(db(), { op: 'step', tokens: [tom.token], step: 'DONE', id: sent.workOrderId, fixed: 'DOT inspection', safe: true, signature: SIG, requestId: rid() }, at);
  assert.equal((await db().collection('fleetSetup').doc('900002').get()).data().dot_due, '2027-04-06');
});

test('a unit\'s dates: saved for our own trucks and trailers, dates and numbers checked', async () => {
  await assert.rejects(act(DISPATCH, 'saveFleetUnit', { unit: '900001', dotDue: '2027-01-31' }), /role/);
  await assert.rejects(act(MANAGER, 'saveFleetUnit', { unit: '555', dotDue: '2027-01-31' }), /not one of our trucks/);
  await assert.rejects(act(MANAGER, 'saveFleetUnit', { unit: '900001', dotDue: 'soon' }), /DOT due: enter a date/);
  await assert.rejects(act(MANAGER, 'saveFleetUnit', { unit: '900001', lastServiceMiles: 'lots' }), /Last service miles: enter a number/);
  await act(MANAGER, 'saveFleetUnit', { unit: '900001', track: true, lastServiceDate: '9/1/2026', lastServiceMiles: '400,000', dotDue: '2027-01-31', plateExpires: '2027-03-31', notes: 'New tires 9/1' });
  const u = (await db().collection('fleetSetup').doc('900001').get()).data();
  assert.deepEqual([u.track, u.last_service_date, u.last_service_miles, u.dot_due, u.plate_expires, u.notes, u.unit_type], ['YES', '2026-09-01', '400000', '2027-01-31', '2027-03-31', 'New tires 9/1', 'TRUCK']);
  await act(MANAGER, 'saveFleetUnit', { unit: 't-901', track: false, lastServiceHours: '1100', currentHours: '1180' });
  const t = (await db().collection('fleetSetup').doc('T-901').get()).data();
  assert.deepEqual([t.track, t.last_service_hours, t.current_hours, t.unit_type], ['NO', '1100', '1180', 'TRAILER']);
});

test('technicians: add one with a login ID the Garage Station takes, turn one off, change a login ID; IDs never stored plain', async () => {
  await assert.rejects(act(DISPATCH, 'saveGarageTech', { name: 'NEW Mechanic', loginId: '012345' }), /role/);
  await assert.rejects(act(MANAGER, 'saveGarageTech', { name: 'NEW Mechanic' }), /login ID/);
  await assert.rejects(act(MANAGER, 'saveGarageTech', { name: 'NEW Mechanic', loginId: '12a' }), /5 or 6 numbers/);
  await assert.rejects(act(MANAGER, 'saveGarageTech', { name: 'Jellick tom', loginId: '012345' }), /already on the list/);
  await assert.rejects(act(MANAGER, 'saveGarageTech', { name: 'NEW Mechanic', loginId: '48213' }), /belongs to JELLICK Tom/);
  const added = await act(MANAGER, 'saveGarageTech', { name: 'NEW Mechanic', loginId: '012345' });
  assert.match(added.techId, /^TECH-[0-9A-F]{8}$/);
  const all = await db().collection('garageLogins').get();
  assert.ok(!all.docs.some(d => JSON.stringify(d.data()).includes('012345')), 'only a hash of the login ID is kept');
  assert.ok(!JSON.stringify((await db().collection('actions').get()).docs.map(d => d.data())).includes('012345'), 'the save log never has it either');
  // The leading zero counts: 012345 signs in, 12345 does not.
  await assert.rejects(garageCall(db(), { op: 'signIn', techId: added.techId, loginId: '12345', tokens: [] }), /Wrong login ID/);
  assert.equal((await garageCall(db(), { op: 'signIn', techId: added.techId, loginId: '012345', tokens: [] })).name, 'NEW Mechanic');
  // Martin had no login ID: give him one. Then turn Nard off: he leaves the station's names.
  await act(MANAGER, 'saveGarageTech', { techId: 'TECH-SM', name: 'MARTIN Shaun', loginId: '000777' });
  assert.equal((await garageCall(db(), { op: 'signIn', techId: 'TECH-SM', loginId: '000777', tokens: [] })).name, 'MARTIN Shaun');
  await act(MANAGER, 'saveGarageTech', { techId: 'TECH-JN', name: 'NARD Jaxon', active: false });
  const names = (await garageCall(db(), { op: 'board' })).techs.map(t => t.name);
  assert.deepEqual(names, ['JELLICK Tom', 'MARTIN Shaun', 'MYERS John', 'NEW Mechanic']);
  await assert.rejects(garageCall(db(), { op: 'signIn', techId: 'TECH-JN', loginId: '70001', tokens: [] }), /Tap your name first/);
});
