'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const { garageCall, loginHash, engineCodeOrders } = require('../../src/garage');
const F = require('../fixtures/fake-sheets');

// The Garage Station (garage.js): Joe 10/10, mechanics have no email; they tap their name and type their login ID.
const { sheets, SOURCES } = require('../fixtures/garage-demo');
// Joe 10/28: a service's Complete answers its checklist; every line OK (garage-checklists.js).
const ALL_OK = Object.keys(require('../../src/garage-checklists').LISTS).flatMap(n => require('../../src/garage-checklists').items(n)).map(i => Object.assign({ id: i.id, r: 'OK' }, i.tires ? { depth: Object.fromEntries(i.tires.map(t => [t.key, '12'])) } : {}));
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

test('office list and Delete (Joe 10/14): the office sees the station\'s write-ups; a manager deletes a work order or a write-up job, a dispatcher cannot', async () => {
  const MGR = { email: 'manager.test@uniteddairy.com' }, DISP = { email: 'dispatch.test@uniteddairy.com' };
  await assert.rejects(garageCall(db(), { op: 'office' }, now()), /Sign in with your United Dairy account/);
  const office = () => garageCall(db(), { op: 'office' }, now(), { user: MGR });
  assert.deepEqual((await office()).jobs.map(j => j.unit), ['T-901', '900001'], 'the write-ups the station lists with no work order yet');
  const sent = await applyAction(db(), MGR, { action: 'updateIssue', requestId: rid(), recordId: 'TRK-2', step: 'garage' });
  assert.deepEqual((await office()).jobs.map(j => j.unit), ['T-901', '900001'], 'a work order is not repeated as a write-up');
  await assert.rejects(applyAction(db(), DISP, { action: 'deleteGarageJob', requestId: rid(), workOrderId: sent.workOrderId }), /does not have a role/);
  // A mechanic is on it when the manager deletes it: the clock stops, a copy is kept, and the write-up leaves the garage list.
  const tom = await garageCall(db(), { op: 'signIn', techId: 'TECH-JT', loginId: '48213' }, now());
  await garageCall(db(), { op: 'step', tokens: [tom.token], requestId: rid(), step: 'START', id: sent.workOrderId }, now(1));
  const gone = await applyAction(db(), MGR, { action: 'deleteGarageJob', requestId: rid(), workOrderId: sent.workOrderId });
  assert.deepEqual([gone.deleted, gone.writeUpOff], [sent.workOrderId, 'TRK-2']);
  assert.equal((await db().collection('workOrders').doc(sent.workOrderId).get()).exists, false);
  const copy = (await db().collection('workOrdersDeleted').doc(sent.workOrderId).get()).data();
  assert.deepEqual([copy.deleted_by, copy.on_now, !!copy.labor[0].end], [MGR.email, '', true]);
  assert.equal((await db().collection('garageClocks').doc('TECH-JT').get()).exists, false);
  let board = (await garageCall(db(), { op: 'board' }, now(2))).jobs;
  assert.deepEqual(board.map(j => j.unit), ['T-901', '900001'], 'off the Garage Station, not back as a write-up');
  const L = require('../../src/logic'), trk2 = () => db().collection('maintenance').where('record_id', '==', 'TRK-2').get().then(q => q.docs[0].data());
  assert.deepEqual([(await trk2()).status, L.issueRows([await trk2()], 'TRUCK')[0].atGarage], ['OPEN', false], 'still open on Truck Issues, no longer at the garage');
  // Garage on Truck Issues sends it again with a new work order.
  const again = await applyAction(db(), MGR, { action: 'updateIssue', requestId: rid(), recordId: 'TRK-2', step: 'garage' });
  assert.ok(again.workOrderId && again.workOrderId !== sent.workOrderId);
  assert.equal(L.issueRows([await trk2()], 'TRUCK')[0].atGarage, true);
  // A write-up job with no work order: Delete takes it off the station; it stays open.
  const t901 = (await office()).jobs.find(j => j.unit === 'T-901');
  const off = await applyAction(db(), MGR, { action: 'deleteGarageJob', requestId: rid(), writeUp: t901.writeUp });
  assert.equal(off.deleted, undefined);
  board = (await garageCall(db(), { op: 'board' }, now(3))).jobs;
  assert.deepEqual(board.map(j => j.unit).sort(), ['223876', '900001']);
  assert.deepEqual((await office()).jobs.map(j => j.unit), ['900001']);
});

test('an engine code work order the office deleted is not made again from the same alerts', async () => {
  const f = (id, at) => ({ alertId: id, tag: '900001', code: '791:2', fmiText: '', at });
  await engineCodeOrders(db(), [f('B1', '2026-10-06T13:00:00Z')], '2026-10-06T13:05:00Z');
  const wo = (await db().collection('workOrders').where('source', '==', 'FLEET').get()).docs[0].id;
  await applyAction(db(), { email: 'manager.test@uniteddairy.com' }, { action: 'deleteGarageJob', requestId: rid(), workOrderId: wo });
  assert.deepEqual(await engineCodeOrders(db(), [f('B1', '2026-10-06T13:00:00Z')], '2026-10-06T13:15:00Z'), { made: 0, counted: 0 });
  assert.deepEqual(await engineCodeOrders(db(), [f('B1', '2026-10-06T13:00:00Z'), f('B2', '2026-10-07T09:00:00Z')], '2026-10-07T09:05:00Z'), { made: 1, counted: 0 }, 'a new alert makes a new one');
});

const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('engine codes from Verizon Fleet: one work order per truck and code, counted once per alert, a new one after it is completed', async () => {
  const f = (id, tag, code, at) => ({ alertId: id, tag, code, fmiText: 'Erratic or wrong data', at });
  let r = await engineCodeOrders(db(), [f('A1', '900001', '791:2', '2026-10-06T13:00:00Z'), f('A2', '900001', '791:2', '2026-10-06T13:20:00Z'),
    f('A3', '223876', '791:2', '2026-10-06T13:00:00Z'), f('A4', 'T-901', '100:1', '2026-10-06T13:00:00Z'), f('A5', '555555', '100:1', '2026-10-06T13:00:00Z')], '2026-10-06T13:30:00Z');
  assert.deepEqual(r, { made: 1, counted: 0 }, 'a leased truck, a trailer and a unit not ours make none');
  const tom = await garageCall(db(), { op: 'signIn', techId: 'TECH-JT', loginId: '48213' }, now());
  let job = (await garageCall(db(), { op: 'read', tokens: [tom.token] }, now())).jobs.find(j => j.source === 'FLEET');
  assert.deepEqual([job.unit, job.problem, job.from, job.category, job.canRun], ['900001', 'Engine code 791:2 · Erratic or wrong data · came on 2 times', 'Verizon Fleet', 'Engine', true]);
  // Read again (the next read starts 10 minutes back), plus one new alert: counted on the same work order.
  r = await engineCodeOrders(db(), [f('A2', '900001', '791:2', '2026-10-06T13:20:00Z'), f('A6', '900001', '791:2', '2026-10-06T13:40:00Z')], '2026-10-06T13:45:00Z');
  assert.deepEqual(r, { made: 0, counted: 1 });
  job = (await garageCall(db(), { op: 'read', tokens: [tom.token] }, now())).jobs.find(j => j.source === 'FLEET');
  assert.equal(job.problem, 'Engine code 791:2 · Erratic or wrong data · came on 3 times');
  // Completed on the Garage Station; the code coming on again makes a new work order.
  const step = (fields) => garageCall(db(), Object.assign({ op: 'step', tokens: [tom.token], requestId: rid() }, fields), now(5));
  await step({ step: 'START', id: job.id });
  await step({ step: 'DONE', id: job.id, fixed: 'Repaired', safe: true, signature: SIG });
  assert.equal((await db().collection('workOrders').doc(job.id).get()).data().status, 'DONE');
  r = await engineCodeOrders(db(), [f('A6', '900001', '791:2', '2026-10-06T13:40:00Z'), f('A7', '900001', '791:2', '2026-10-07T08:00:00Z')], '2026-10-07T08:05:00Z');
  assert.deepEqual(r, { made: 1, counted: 0 });
});


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
  await step({ step: 'DONE', id: sent.workOrderId, fixed: 'Oil / PM service', safe: true, signature: SIG, checklist: ALL_OK, hours: '8200' }, 25);
  const setup = (await db().collection('fleetSetup').doc('900002').get()).data();
  assert.deepEqual([setup.last_service_date, setup.last_service_miles, setup.track], ['2026-10-06', '98000', 'YES']);
});

// Joe 10/13 (Garage Station with no signal): a step kept on the tablet carries the mechanic's name and login ID, checked when
// it is sent, and names the write-up instead of a work order number the tablet never learned.
test('a step kept on the tablet: checked by name and login ID when sent, and found by its write-up', async () => {
  const job = (await garageCall(db(), { op: 'read', tokens: [] }, now())).jobs;
  const tom = await garageCall(db(), { op: 'signIn', techId: 'TECH-JT', loginId: '48213' }, now());
  const writeUp = (await garageCall(db(), { op: 'read', tokens: [tom.token] }, now())).jobs.find(j => j.unit === '900001').writeUp;
  assert.deepEqual(job, []);
  const kept = (signIn, fields, at, requestId) => garageCall(db(), Object.assign({ op: 'step', tokens: [], signIn, requestId: requestId || rid() }, fields), now(at));
  await assert.rejects(kept({ techId: 'TECH-JT', loginId: '11111' }, { step: 'START', writeUp }), /Wrong login ID/);
  assert.equal((await db().collection('garageLocks').doc('TECH-JT').get()).data().count, 1, 'a wrong number counts towards the lock');
  await assert.rejects(kept({ techId: 'TECH-JT', loginId: '48213' }, { step: 'PARTS', writeUp }), /not on the list any more/, 'only Start makes the work order');
  const startId = rid();
  const started = await kept({ techId: 'TECH-JT', loginId: '48213' }, { step: 'START', writeUp }, 1, startId);
  assert.deepEqual([started.job.status, started.job.techs], ['WORKING', ['JELLICK Tom']]);
  assert.equal((await kept({ techId: 'TECH-JT', loginId: '48213' }, { step: 'START', writeUp }, 1, startId)).repeated, true, 'sent twice, saved once');
  const done = await kept({ techId: 'TECH-JT', loginId: '48213' }, { step: 'DONE', writeUp, fixed: 'Brakes', safe: true, signature: SIG }, 30);
  assert.equal(done.job.id, started.job.id, 'the write-up finds the work order its Start made');
  const wo = (await db().collection('workOrders').doc(started.job.id).get()).data();
  assert.deepEqual([wo.status, wo.signed_by, wo.minutes], ['DONE', 'JELLICK Tom', 29]);
});

// Joe 10/13: Fleet Service's miles and reefer hours also come from GPS. A PM done safe records the newer of the DVIR and GPS
// odometers; a reefer service records the trailer's GPS hours.
test('a PM or reefer service done safe records the GPS miles or hours when they are the newest', async () => {
  const tom = await garageCall(db(), { op: 'signIn', techId: 'TECH-JT', loginId: '48213' }, now());
  const step = (fields, at) => garageCall(db(), Object.assign({ op: 'step', tokens: [tom.token], requestId: rid() }, fields), now(at));
  const mgr = { email: 'manager.test@uniteddairy.com' };
  await db().collection('odometers').doc('o3').set({ unit: '900002', miles: 98000, date: '2026-10-06', at: '2026-10-06T08:00:00Z' });
  await db().collection('gpsTrucks').doc('900002').set({ tag: '900002', odometerMiles: 98123.4, engineHours: 9000, lastReport: '2026-10-06T13:55:00.000Z' });
  await db().collection('gpsTrucks').doc('T-902').set({ tag: 'T-902', odometerMiles: null, engineHours: 5123.2, lastReport: '2026-10-06T13:50:00.000Z' });
  const pm = await applyAction(db(), mgr, { action: 'sendToGarage', requestId: rid(), unit: '900002', unitType: 'TRUCK', serviceKey: 'PM' });
  const reefer = await applyAction(db(), mgr, { action: 'sendToGarage', requestId: rid(), unit: 'T-902', unitType: 'TRAILER', serviceKey: 'REEFER' });
  for (const id of [pm.workOrderId, reefer.workOrderId]) {
    await step({ step: 'START', id });
    await step({ step: 'DONE', id, fixed: id === pm.workOrderId ? 'Oil / PM service' : 'Repaired', safe: true, signature: SIG, checklist: ALL_OK }, 25);
  }
  assert.equal((await db().collection('fleetSetup').doc('900002').get()).data().last_service_miles, '98123');
  assert.equal((await db().collection('workOrders').doc(pm.workOrderId).get()).data().odometer, 98123);
  assert.equal((await db().collection('fleetSetup').doc('T-902').get()).data().last_service_hours, '5123');
});
