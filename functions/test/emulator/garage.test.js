'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const { garageCall, loginHash } = require('../../src/garage');
const F = require('../fixtures/fake-sheets');

// The Garage Station (garage.js): Joe 10/10, mechanics have no email; they tap their name and type their login ID.
const { sheets, SOURCES } = require('../fixtures/garage-demo');
const now = (min) => () => new Date(Date.parse('2026-10-06T14:00:00Z') + (min || 0) * 60000);
let n = 0;
const rid = () => 'garage-request-' + (++n) + '-' + Date.now();

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(sheets()), sources: SOURCES, now: () => new Date('2026-10-06T12:00:00Z') });
});

test('the copy keeps only a hash of each login ID, out of the screens\' reach', async () => {
  const tech = (await db().collection('garageTechs').doc('TECH-JT').get()).data();
  assert.equal(tech.name, 'JELLICK Tom');
  assert.ok(!JSON.stringify(tech).includes('48213'), 'the login ID is not on the readable technician entry');
  const login = (await db().collection('garageLogins').doc('TECH-JT').get()).data();
  assert.equal(login.hash, loginHash('TECH-JT', '48213'));
  assert.ok(!JSON.stringify(login).includes('48213'));
  assert.equal((await db().collection('garageLogins').doc('TECH-SM').get()).exists, false, 'no ID yet, nothing kept');
});

test('sign in with name and login ID: wrong numbers lock after five, two technicians at most', async () => {
  const r = await garageCall(db(), { op: 'read', tokens: [] }, now());
  assert.deepEqual(r.techs.map(t => t.name), ['JELLICK Tom', 'MARTIN Sean', 'MYERS John', 'NARD Jaxon']);
  assert.deepEqual(r.jobs, [], 'no jobs before someone signs in');
  await assert.rejects(garageCall(db(), { op: 'signIn', techId: 'TECH-JT', loginId: '4821' }, now()), /5- or 6-digit login ID/);
  await assert.rejects(garageCall(db(), { op: 'signIn', techId: 'TECH-SM', loginId: '12345' }, now()), /no login ID yet/);
  for (let i = 0; i < 5; i++) await assert.rejects(garageCall(db(), { op: 'signIn', techId: 'TECH-JN', loginId: '99999' }, now()), /Wrong login ID/);
  await assert.rejects(garageCall(db(), { op: 'signIn', techId: 'TECH-JN', loginId: '70001' }, now()), /Too many wrong numbers/);
  const tom = await garageCall(db(), { op: 'signIn', techId: 'TECH-JT', loginId: '48213' }, now());
  assert.equal(tom.name, 'JELLICK Tom');
  const john = await garageCall(db(), { op: 'signIn', techId: 'TECH-JM', loginId: '551902', tokens: [tom.token] }, now());
  await assert.rejects(garageCall(db(), { op: 'signIn', techId: 'TECH-JN', loginId: '70001', tokens: [tom.token, john.token] }, now(6)), /Two technicians are already signed in/);
  const read = await garageCall(db(), { op: 'read', tokens: [tom.token, john.token] }, now(1));
  assert.deepEqual(read.signedIn.map(p => p.name), ['JELLICK Tom', 'MYERS John']);
  // 30 minutes after the last step the sign-in is gone; Sign Out ends it at once.
  assert.deepEqual((await garageCall(db(), { op: 'read', tokens: [tom.token] }, now(40))).signedIn, []);
  await garageCall(db(), { op: 'signOut', tokens: [john.token] }, now(2));
  assert.deepEqual((await garageCall(db(), { op: 'read', tokens: [john.token] }, now(3))).signedIn, []);
});

test('jobs: real write-ups of our own units, down ones first; a leased truck only once sent to the garage', async () => {
  const tom = await garageCall(db(), { op: 'signIn', techId: 'TECH-JT', loginId: '48213' }, now());
  let r = await garageCall(db(), { op: 'read', tokens: [tom.token] }, now());
  assert.deepEqual(r.jobs.map(j => [j.unit, j.canRun, j.source]), [['T-901', false, 'WRITE_UP'], ['900001', true, 'WRITE_UP']]);
  assert.ok(r.units.indexOf('223876') >= 0 && r.units.indexOf('T-902') >= 0);
  await applyAction(db(), { email: 'manager.test@uniteddairy.com' }, { action: 'updateIssue', requestId: rid(), recordId: 'TRK-2', step: 'garage' });
  r = await garageCall(db(), { op: 'read', tokens: [tom.token] }, now());
  assert.deepEqual(r.jobs.map(j => j.unit), ['T-901', '900001', '223876']);
});

const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('Start, Need Parts, a helper, Done with a signature: the write-up is repaired and the job keeps who and what', async () => {
  await db().collection('odometers').doc('o1').set({ unit: '900001', miles: 412000, date: '2026-10-05', at: '2026-10-05T09:00:00Z' });
  await db().collection('odometers').doc('o2').set({ unit: '900001', miles: 412480, date: '2026-10-06', at: '2026-10-06T09:00:00Z' });
  const tom = await garageCall(db(), { op: 'signIn', techId: 'TECH-JT', loginId: '48213' }, now());
  const job = (await garageCall(db(), { op: 'read', tokens: [tom.token] }, now())).jobs.find(j => j.unit === '900001');
  const step = (tokens, fields, at) => garageCall(db(), Object.assign({ op: 'step', tokens, requestId: rid() }, fields), now(at));
  await assert.rejects(step([], { step: 'START', writeUp: job.writeUp }), /GARAGE_SIGN_IN_REQUIRED/);
  await assert.rejects(step([tom.token], { step: 'FIX', id: 'x' }), /unknown step FIX/);
  const started = await step([tom.token], { step: 'START', writeUp: job.writeUp });
  const id = started.job.id;
  assert.match(id, /^WO-[0-9A-F]{8}$/);
  assert.deepEqual([started.job.status, started.job.techs, started.job.source], ['WORKING', ['JELLICK Tom'], 'WRITE_UP']);
  // Starting the same write-up again (the other tablet) finds the same work order.
  assert.equal((await step([tom.token], { step: 'START', writeUp: job.writeUp })).job.id, id);
  assert.equal((await step([tom.token], { step: 'PARTS', id }, 5)).job.status, 'PARTS');
  let list = (await garageCall(db(), { op: 'read', tokens: [tom.token] }, now(6))).jobs;
  assert.equal(list[list.length - 1].id, id, 'waiting on parts goes last');
  assert.equal(list.filter(j => j.unit === '900001').length, 1, 'the write-up is not listed twice');
  assert.equal((await step([tom.token], { step: 'RESUME', id }, 30)).job.status, 'WORKING');
  const john = await garageCall(db(), { op: 'signIn', techId: 'TECH-JM', loginId: '551902', tokens: [tom.token] }, now(31));
  assert.deepEqual((await step([tom.token, john.token], { step: 'HELPER', id }, 32)).job.techs, ['JELLICK Tom', 'MYERS John']);
  await assert.rejects(step([tom.token], { step: 'DONE', id, fixed: 'Fixed it', safe: true, signature: SIG }), /Tap what you fixed/);
  await assert.rejects(step([tom.token], { step: 'DONE', id, fixed: 'Repaired', safe: true, signature: 'nope' }), /Sign with your finger/);
  const notSafe = await step([tom.token, john.token], { step: 'DONE', id, fixed: 'Brakes', safe: false, signature: SIG }, 40);
  assert.deepEqual([notSafe.job.status, notSafe.job.canRun], ['WORKING', false]);
  assert.equal((await db().collection('maintenance').doc('TRK-1').get()).data().status, 'OPEN', 'not safe: the write-up stays open');
  const done = await step([tom.token, john.token], { step: 'DONE', id, fixed: 'Brakes', note: 'New chamber', safe: true, signature: SIG }, 62);
  assert.equal(done.writeUpClosed, true);
  const wo = (await db().collection('workOrders').doc(id).get()).data();
  assert.deepEqual([wo.status, wo.fixed, wo.fixed_note, wo.safe, wo.signed_by, wo.can_run, wo.minutes, wo.odometer, wo.techs], ['DONE', 'Brakes', 'New chamber', 'YES', 'JELLICK Tom', 'YES', 62, 412480, 'JELLICK Tom, MYERS John']);
  assert.equal(wo.signature, SIG);
  const w = (await db().collection('maintenance').doc('TRK-1').get()).data();
  assert.equal(w.status, 'COMPLETE');
  assert.match(w.resolution_notes, /Brakes: New chamber \(Garage Station WO-/);
  list = (await garageCall(db(), { op: 'read', tokens: [tom.token] }, now(63))).jobs;
  assert.ok(!list.some(j => j.unit === '900001'), 'a finished job and its write-up leave the list');
  await assert.rejects(step([tom.token], { step: 'PARTS', id }, 64), /already finished/);
});

test('Report a Problem and the office\'s Send to Garage: a PM done safe moves Fleet Service\'s dates', async () => {
  const tom = await garageCall(db(), { op: 'signIn', techId: 'TECH-JT', loginId: '48213' }, now());
  const step = (fields, at) => garageCall(db(), Object.assign({ op: 'step', tokens: [tom.token], requestId: rid() }, fields), now(at));
  await assert.rejects(step({ step: 'REPORT', unit: '01', category: 'Lights', canRun: true }), /matches 900001, T-901/);
  await assert.rejects(step({ step: 'REPORT', unit: '555', category: 'Lights', canRun: true }), /not one of our trucks/);
  await assert.rejects(step({ step: 'REPORT', unit: '902', category: 'Paint', canRun: true }), /Tap what's wrong/);
  const rep = await step({ step: 'REPORT', unit: '902', category: 'Lights', canRun: false, problem: 'Left marker out' });
  assert.deepEqual([rep.job.unit, rep.job.problem, rep.job.source, rep.job.status, rep.job.canRun, rep.job.createdBy], ['T-902', 'Lights: Left marker out', 'TECH', 'NEW', false, 'JELLICK Tom']);
  await assert.rejects(applyAction(db(), { email: 'dispatch.test@uniteddairy.com' }, { action: 'sendToGarage', requestId: rid(), unit: '900002', serviceKey: 'PM' }), /role/);
  const sent = await applyAction(db(), { email: 'manager.test@uniteddairy.com' }, { action: 'sendToGarage', requestId: rid(), unit: '900002', unitType: 'TRUCK', serviceKey: 'PM' });
  const again = await applyAction(db(), { email: 'manager.test@uniteddairy.com' }, { action: 'sendToGarage', requestId: rid(), unit: '900002', unitType: 'TRUCK', serviceKey: 'PM' });
  assert.equal(again.already, true);
  assert.equal(again.workOrderId, sent.workOrderId);
  const jobs = (await garageCall(db(), { op: 'read', tokens: [tom.token] }, now())).jobs;
  assert.deepEqual(jobs.map(j => [j.unit, j.source]), [['T-901', 'WRITE_UP'], ['T-902', 'TECH'], ['900001', 'WRITE_UP'], ['900002', 'OFFICE']]);
  await db().collection('odometers').doc('o3').set({ unit: '900002', miles: 98000, date: '2026-10-06', at: '2026-10-06T08:00:00Z' });
  await step({ step: 'START', id: sent.workOrderId });
  await step({ step: 'DONE', id: sent.workOrderId, fixed: 'Oil / PM service', safe: true, signature: SIG }, 25);
  const setup = (await db().collection('fleetSetup').doc('900002').get()).data();
  assert.deepEqual([setup.last_service_date, setup.last_service_miles, setup.track], ['2026-10-06', '98000', 'YES']);
});
