'use strict';
/*
 * Joe 10/28 (Garage Station rebuilt for the garage): trailers always come to the garage, a unit's 2 write-ups are one line and one
 * work order, the mechanics' notes and Waiting on Parts' list go on the work order, a service is completed with its checklist,
 * and a PM / reefer service / Annual Inspection that Fleet Service shows due comes onto the station by itself.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { garageCall, serviceOrders } = require('../../src/garage');
const CHECK = require('../../src/garage-checklists');
const F = require('../fixtures/fake-sheets');
const { sheets, SOURCES } = require('../fixtures/garage-demo');

const now = (min) => () => new Date(Date.parse('2026-10-06T14:00:00Z') + (min || 0) * 60000);
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
let n = 0;
const rid = () => 'garage-redesign-' + (++n) + '-' + Date.now();
const board = async () => (await garageCall(db(), { op: 'board' }, now())).jobs;
async function tom() { return garageCall(db(), { op: 'signIn', techId: 'TECH-JT', loginId: '48213' }, now()); }

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(sheets()), sources: SOURCES, now: () => new Date('2026-10-06T12:00:00Z') });
});

test('a trailer\'s write-up always comes to the garage, even a leased trailer; a leased truck\'s does not', async () => {
  const eq = (await db().collection('equipment').get()).docs.find(d => d.data().unit === 'T-901' || d.data().unit === '901');
  await eq.ref.update({ notes: 'External Fleet: Year 2020 | Lease: PENSKE' });
  const units = (await board()).map(j => j.unit);
  assert.ok(units.indexOf('T-901') >= 0, 'the leased trailer is on the list');
  assert.ok(units.indexOf('223876') < 0, 'the leased truck goes to the lessor');
});

test('a unit\'s 2 write-ups are one line; Start makes one work order for both and Complete repairs both', async () => {
  const first = (await db().collection('maintenance').doc('TRK-1').get()).data();
  await db().collection('maintenance').doc('TRK-9').set(Object.assign({}, first, { record_id: 'TRK-9', opened_at: '2026-10-04T15:00:00Z', issue_details: 'Brake light out' }));
  let jobs = (await board()).filter(j => j.unit === '900001');
  assert.equal(jobs.length, 1, 'one line for 900001');
  assert.deepEqual([jobs[0].problem, jobs[0].more, jobs[0].writeUps.length], ['Brake light out', ['Air leak at the left brake chamber'], 2], 'the first write-up, the later one under it');
  const t = await tom();
  const step = (f, at) => garageCall(db(), Object.assign({ op: 'step', tokens: [t.token], requestId: rid() }, f), now(at));
  const started = await step({ step: 'START', writeUp: jobs[0].writeUp, also: jobs[0].writeUps.slice(1) });
  assert.deepEqual(started.job.more, ['Air leak at the left brake chamber']);
  jobs = (await board()).filter(j => j.unit === '900001');
  assert.deepEqual(jobs.map(j => j.id), [started.job.id], 'the second write-up does not come back as its own line');
  await step({ step: 'DONE', id: started.job.id, fixed: 'Brakes', safe: true, signature: SIG }, 20);
  for (const id of ['TRK-1', 'TRK-9']) assert.equal((await db().collection('maintenance').doc(id).get()).data().status, 'COMPLETE', id + ' repaired');
});

test('notes and the parts put on go on the work order with the mechanic\'s name; Waiting on Parts keeps its list', async () => {
  const t = await tom();
  const step = (f, at) => garageCall(db(), Object.assign({ op: 'step', tokens: [t.token], requestId: rid() }, f), now(at));
  const job = (await board()).find(j => j.unit === '900001');
  const s = await step({ step: 'START', writeUp: job.writeUp });
  await step({ step: 'STOP', id: s.job.id, did: 'Found the leak at the chamber', used: '' }, 10);
  const r = await step({ step: 'PARTS', id: s.job.id, partsNeeded: 'Brake chamber, 2 hose clamps' }, 11);
  assert.equal(r.job.partsNeeded, 'Brake chamber, 2 hose clamps');
  assert.deepEqual(r.job.notesLog.map(e => [e.by, e.did || '', e.parts || '']), [['JELLICK Tom', 'Found the leak at the chamber', ''], ['JELLICK Tom', '', 'Brake chamber, 2 hose clamps']]);
  await step({ step: 'RESUME', id: s.job.id }, 30);
  const done = await step({ step: 'DONE', id: s.job.id, fixed: 'Replaced a part', note: 'New chamber in', used: 'Brake chamber', safe: true, signature: SIG }, 45);
  const wo = (await db().collection('workOrders').doc(done.job.id).get()).data();
  assert.deepEqual([wo.fixed_note, wo.parts_used, wo.notes_log.length], ['New chamber in', 'Brake chamber', 3]);
});

test('a service is completed with its checklist: every line answered, the Needs work lines kept on the work order', async () => {
  await db().collection('workOrders').doc('WO-SVC1').set({ work_order_id: 'WO-SVC1', facility_id: 'fac_uniontown', unit: '900002', unit_type: 'TRUCK', problem: 'PM service due', source: 'SERVICE',
    service_key: 'PM', status: 'NEW', can_run: 'YES', created_at: '2026-10-06T10:00:00Z', version: 1 });
  const job = (await board()).find(j => j.id === 'WO-SVC1');
  assert.equal(job.checklist, 'PM_TRUCK');
  const t = await tom();
  const step = (f, at) => garageCall(db(), Object.assign({ op: 'step', tokens: [t.token], requestId: rid() }, f), now(at));
  await step({ step: 'START', id: 'WO-SVC1' });
  const items = CHECK.items('PM_TRUCK');
  await assert.rejects(step({ step: 'DONE', id: 'WO-SVC1', fixed: 'Oil / PM service', safe: true, signature: SIG, checklist: items.slice(1).map(i => ({ id: i.id, r: 'OK' })) }, 10), /Answer every line of the checklist \(1 left\)/);
  const answers = items.map(i => ({ id: i.id, r: i.id === 'tires' ? 'FIX' : i.id === 'twospeed' ? 'NA' : 'OK' }));
  await step({ step: 'DONE', id: 'WO-SVC1', fixed: 'Oil / PM service', safe: true, signature: SIG, checklist: answers }, 20);
  const wo = (await db().collection('workOrders').doc('WO-SVC1').get()).data();
  assert.equal(wo.status, 'DONE');
  assert.equal(wo.checklist.length, items.length);
  assert.match(wo.fixed_note, /^Needs work: Tire condition and air pressure/);
});

test('a PM or Annual Inspection Fleet Service shows due becomes a work order by itself, once; one the office deleted is not made again', async () => {
  await db().collection('fleetSetup').doc('900002').set({ unit: '900002', unit_type: 'TRUCK', last_service_date: '2026-04-01', last_service_miles: '50000', dot_due: '2026-10-01', track: 'YES' });
  await db().collection('odometers').doc('o9').set({ unit: '900002', miles: 98000, date: '2026-10-06', at: '2026-10-06T08:00:00Z' });
  const first = await serviceOrders(db(), Date.parse('2026-10-06T14:00:00Z'));
  assert.equal(first.made, 2);
  const made = (await db().collection('workOrders').where('unit', '==', '900002').get()).docs.map(d => d.data());
  assert.deepEqual(made.map(o => o.service_key).sort(), ['DOT', 'PM']);
  assert.ok(made.every(o => o.source === 'SERVICE' && o.status === 'NEW'));
  const jobs = (await board()).filter(j => j.unit === '900002');
  assert.deepEqual(jobs.map(j => j.checklist).sort(), ['DOT_TRUCK', 'PM_TRUCK']);
  assert.equal((await serviceOrders(db(), Date.parse('2026-10-06T14:30:00Z'))).made, 0, 'not made twice');
  // The office deletes the Annual Inspection one: it stays off for this due date.
  const dot = made.find(o => o.service_key === 'DOT');
  await db().collection('workOrdersDeleted').doc(dot.work_order_id).set(dot);
  await db().collection('workOrders').doc(dot.work_order_id).delete();
  assert.equal((await serviceOrders(db(), Date.parse('2026-10-06T15:00:00Z'))).made, 0);
});
