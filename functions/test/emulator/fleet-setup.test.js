'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const { garageCall, fleetRules } = require('../../src/garage');
const F = require('../fixtures/fake-sheets');

// Fleet Service Setup (the current app's FleetService.html Setup tab): rules, each unit's dates, and the garage technicians.
const { sheets, SOURCES } = require('../fixtures/garage-demo');
const now = () => new Date('2026-10-06T14:00:00Z');
const MANAGER = { email: 'manager.test@uniteddairy.com' }, DISPATCH = { email: 'dispatch.test@uniteddairy.com' };
let n = 0;
const rid = () => 'fleet-setup-' + (++n) + '-' + Date.now();

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(sheets()), sources: SOURCES, now: () => new Date('2026-10-06T12:00:00Z') });
});

test('rules: managers save them over the current app\'s defaults; bad numbers and dispatchers are refused', async () => {
  await assert.rejects(applyAction(db(), DISPATCH, { action: 'saveFleetRules', requestId: rid(), rules: { truckMiles: 20000 } }), /role/);
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveFleetRules', requestId: rid(), rules: { truckMiles: 12.5 } }), /whole number/);
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveFleetRules', requestId: rid(), rules: { truckWarnMiles: 16000 } }), /fewer miles/);
  const r = await applyAction(db(), MANAGER, { action: 'saveFleetRules', requestId: rid(), rules: { truckMiles: 20000, dotMonths: 6 } });
  assert.equal(r.rules.truckMiles, 20000);
  assert.equal(r.rules.trailerMonths, 4, 'rules not sent keep the default');
  const saved = (await db().collection('config').doc('fleetRules').get()).data();
  assert.deepEqual([saved.truckMiles, saved.dotMonths, saved.updatedBy], [20000, 6, MANAGER.email]);
  assert.equal(fleetRules(saved).plateWarnDays, 30);
});

test('unit edit: dates and miles saved on the unit\'s Fleet Service row; a bad date is refused', async () => {
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveFleetUnit', requestId: rid(), unit: '900002', fields: { dot_due: 'soon' } }), /DOT due must be a date/);
  await applyAction(db(), MANAGER, { action: 'saveFleetUnit', requestId: rid(), unit: '900002', unitType: 'TRUCK',
    fields: { track: 'yes', last_service_date: '2026-09-01', last_service_miles: '91,500', dot_due: '2027-03-31', plate_expires: '2027-01-31', notes: 'New tires' } });
  const row = (await db().collection('fleetSetup').doc('900002').get()).data();
  assert.deepEqual([row.track, row.last_service_date, row.last_service_miles, row.dot_due, row.plate_expires, row.notes, row.updated_by],
    ['YES', '2026-09-01', '91500', '2027-03-31', '2027-01-31', 'New tires', MANAGER.email]);
  await applyAction(db(), MANAGER, { action: 'saveFleetUnit', requestId: rid(), unit: 'T-902', unitType: 'TRAILER', fields: { current_hours: '1300', track: '' } });
  const t = (await db().collection('fleetSetup').doc('T-902').get()).data();
  assert.deepEqual([t.current_hours, t.track, t.unit_type], ['1300', '', 'TRAILER']);
});

test('technicians: add with a login ID, sign in with it, reset it, turn off; no two share a login ID', async () => {
  const added = await applyAction(db(), MANAGER, { action: 'saveGarageTech', requestId: rid(), op: 'ADD', name: 'Smith Pat', loginId: '24680' });
  const tech = (await db().collection('garageTechs').doc(added.techId).get()).data();
  assert.deepEqual([tech.name, tech.active], ['SMITH PAT', 'YES']);
  assert.ok(!JSON.stringify(tech).includes('24680'), 'the login ID is not on the readable entry');
  const log = (await db().collection('actions').where('techId', '==', added.techId).get()).docs.map(d => JSON.stringify(d.data())).join('');
  assert.ok(!log.includes('24680'), 'the login ID is not in the save log');
  const pat = await garageCall(db(), { op: 'signIn', techId: added.techId, loginId: '24680' }, now);
  assert.equal(pat.name, 'SMITH PAT');
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveGarageTech', requestId: rid(), op: 'ADD', name: 'smith pat' }), /already on the list/);
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveGarageTech', requestId: rid(), op: 'LOGIN', techId: 'TECH-SM', loginId: '24680' }), /Another technician/);
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveGarageTech', requestId: rid(), op: 'LOGIN', techId: 'TECH-SM', loginId: '12' }), /5 or 6 digits/);
  // A technician with no ID yet (Sean) gets one and can sign in.
  await applyAction(db(), MANAGER, { action: 'saveGarageTech', requestId: rid(), op: 'LOGIN', techId: 'TECH-SM', loginId: '13579' });
  assert.equal((await garageCall(db(), { op: 'signIn', techId: 'TECH-SM', loginId: '13579' }, now)).name, 'MARTIN Sean');
  // Reset Pat's ID: the old one stops working and is free for someone else.
  await applyAction(db(), MANAGER, { action: 'saveGarageTech', requestId: rid(), op: 'LOGIN', techId: added.techId, loginId: '97531' });
  await assert.rejects(garageCall(db(), { op: 'signIn', techId: added.techId, loginId: '24680' }, now), /Wrong login ID/);
  await applyAction(db(), MANAGER, { action: 'saveGarageTech', requestId: rid(), op: 'ACTIVE', techId: added.techId, active: false });
  const list = await garageCall(db(), { op: 'read', tokens: [] }, now);
  assert.ok(!list.techs.some(t => t.id === added.techId), 'a technician turned off leaves the Garage Station');
});

test('a DOT finished at the garage moves the DOT due date by the saved rule', async () => {
  await applyAction(db(), MANAGER, { action: 'saveFleetRules', requestId: rid(), rules: { dotMonths: 6 } });
  const sent = await applyAction(db(), MANAGER, { action: 'sendToGarage', requestId: rid(), unit: '900002', unitType: 'TRUCK', serviceKey: 'DOT' });
  const tom = await garageCall(db(), { op: 'signIn', techId: 'TECH-JT', loginId: '48213' }, now);
  const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  await garageCall(db(), { op: 'step', tokens: [tom.token], requestId: rid(), step: 'START', id: sent.workOrderId }, now);
  await garageCall(db(), { op: 'step', tokens: [tom.token], requestId: rid(), step: 'DONE', id: sent.workOrderId, fixed: 'DOT inspection', safe: true, signature: SIG }, now);
  assert.equal((await db().collection('fleetSetup').doc('900002').get()).data().dot_due, '2027-04-06');
});

test('each plant keeps its own rules and technicians (Joe 10/13); Uniontown stays as it was', async () => {
  await applyAction(db(), MANAGER, { action: 'saveFleetRules', requestId: rid(), rules: { truckMiles: 18000 } });
  await applyAction(db(), MANAGER, { action: 'saveFleetRules', requestId: rid(), facilityId: 'fac_charleston', rules: { truckMiles: 25000 } });
  assert.equal((await db().collection('config').doc('fleetRules').get()).data().truckMiles, 18000, 'Uniontown keeps config/fleetRules');
  assert.equal((await db().collection('config').doc('fleetRules_fac_charleston').get()).data().truckMiles, 25000);
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveFleetRules', requestId: rid(), facilityId: 'fac_nowhere', rules: { truckMiles: 25000 } }), /Unknown plant/);
  const added = await applyAction(db(), MANAGER, { action: 'saveGarageTech', requestId: rid(), op: 'ADD', name: 'Branch Bob', loginId: '86420', facilityId: 'fac_charleston' });
  assert.equal((await db().collection('garageTechs').doc(added.techId).get()).data().facility_id, 'fac_charleston');
  const list = await garageCall(db(), { op: 'read', tokens: [] }, now);
  assert.ok(!list.techs.some(t => t.id === added.techId), 'a Charleston technician is not on the Uniontown Garage Station');
  const home = await applyAction(db(), MANAGER, { action: 'saveGarageTech', requestId: rid(), op: 'ADD', name: 'Home Hal' });
  assert.equal((await db().collection('garageTechs').doc(home.techId).get()).data().facility_id, 'fac_uniontown', 'no plant sent = Uniontown');
});

test('a trailer\'s DOT finished at the garage moves by the trailers\' own DOT rule (Joe 10/13)', async () => {
  await applyAction(db(), MANAGER, { action: 'saveFleetRules', requestId: rid(), rules: { dotMonths: 6, trailerDotMonths: 12 } });
  const saved = (await db().collection('config').doc('fleetRules').get()).data();
  assert.deepEqual([saved.dotMonths, saved.trailerDotMonths], [6, 12]);
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveFleetRules', requestId: rid(), rules: { trailerDotMonths: 40 } }), /whole number/);
  const sent = await applyAction(db(), MANAGER, { action: 'sendToGarage', requestId: rid(), unit: 'T-902', unitType: 'TRAILER', serviceKey: 'DOT' });
  const tom = await garageCall(db(), { op: 'signIn', techId: 'TECH-JT', loginId: '48213' }, now);
  const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  await garageCall(db(), { op: 'step', tokens: [tom.token], requestId: rid(), step: 'START', id: sent.workOrderId }, now);
  await garageCall(db(), { op: 'step', tokens: [tom.token], requestId: rid(), step: 'DONE', id: sent.workOrderId, fixed: 'DOT inspection', safe: true, signature: SIG }, now);
  assert.equal((await db().collection('fleetSetup').doc('T-902').get()).data().dot_due, '2027-10-06');
});

test('the Ours tick: unticking a unit takes it off the due list, ticking puts it back (Joe 10/13)', async () => {
  await applyAction(db(), MANAGER, { action: 'saveFleetUnit', requestId: rid(), unit: '900002', unitType: 'TRUCK', fields: { track: 'NO' } });
  assert.equal((await db().collection('fleetSetup').doc('900002').get()).data().track, 'NO');
  await applyAction(db(), MANAGER, { action: 'saveFleetUnit', requestId: rid(), unit: '900002', unitType: 'TRUCK', fields: { track: 'YES' } });
  assert.equal((await db().collection('fleetSetup').doc('900002').get()).data().track, 'YES');
});
