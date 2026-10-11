'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { garageCall } = require('../../src/garage');
const F = require('../fixtures/fake-sheets');

// Joe 10/10 evening: the Garage Station opens on the open work orders (no sign-in), fork trucks included; each mechanic
// signs in on a job and runs their own clock; one job at a time; only Complete closes it.
const { sheets, SOURCES } = require('../fixtures/garage-demo');
const FORK = ['record_id', 'facility_id', 'status', 'opened_at', 'driver', 'issue_details', 'notes', 'source_type', 'unit_number', 'equipment_id', 'equipment_type'];
const now = (min) => () => new Date(Date.parse('2026-10-06T14:00:00Z') + (min || 0) * 60000);
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
let n = 0;
const rid = () => 'garage-clock-' + (++n) + '-' + Date.now();
const signIn = (techId, loginId, at) => garageCall(db(), { op: 'signIn', techId, loginId, tokens: [] }, now(at));
const step = (who, fields, at) => garageCall(db(), Object.assign({ op: 'step', tokens: [who.token], requestId: rid() }, fields), now(at));
// The tablet asks for the name and login ID on each step, as here.
const LOGIN = { TOM: ['TECH-JT', '48213'], JOHN: ['TECH-JM', '551902'] };
const as = async (who, fields, at) => step(await signIn(LOGIN[who][0], LOGIN[who][1], at), fields, at);
const board = (at) => garageCall(db(), { op: 'board' }, now(at));

test.beforeEach(async () => {
  await clear();
  const extra = { "'FORK TRUCK LIVE'": F.table(FORK, [
    { record_id: 'FRK-1', status: 'OPEN', opened_at: '2026-10-05T08:00:00Z', driver: 'ADAMS, PAT', issue_details: 'Pallet jack wheel broken', notes: 'Reported route: 101; source: new app check-in', unit_number: 'PJ-7', equipment_type: 'FORK_TRUCK' },
    { record_id: 'FRK-2', status: 'COMPLETE', opened_at: '2026-10-04T08:00:00Z', issue_details: 'Horn out', unit_number: 'FT-2' }]) };
  await runTransfer({ db: db(), reader: F.fakeReader(sheets(extra)), sources: SOURCES, now: () => new Date('2026-10-06T12:00:00Z') });
});

test('the board needs no sign-in: open work orders and write-ups, fork trucks too, where each came from, no driver names', async () => {
  const b = await board();
  assert.deepEqual(b.jobs.map(j => [j.unit, j.type, j.from]), [['T-901', 'TRAILER', 'Equipment Issues'], ['PJ-7', 'FORK_TRUCK', 'Driver check-in'], ['900001', 'TRUCK', 'Equipment Issues']]);
  assert.ok(!JSON.stringify(b).includes('ADAMS'), 'the drivers\' names are not on the open board');
  assert.deepEqual(b.techs.map(t => [t.name, t.on]), [['JELLICK Tom', null], ['MARTIN Sean', null], ['MYERS John', null], ['NARD Jaxon', null]]);
  await assert.rejects(garageCall(db(), { op: 'step', tokens: [], step: 'START', writeUp: b.jobs[0].writeUp, requestId: rid() }, now()), /GARAGE_SIGN_IN_REQUIRED/);
});

test('two mechanics on one job, each with a clock; one job at a time; Need Parts stops the clocks; Complete closes it', async () => {
  const jobs = (await board()).jobs, trailer = jobs.find(j => j.unit === 'T-901'), fork = jobs.find(j => j.unit === 'PJ-7');
  const id = (await as('TOM', { step: 'START', writeUp: trailer.writeUp })).job.id;
  let r = await as('JOHN', { step: 'HELPER', id }, 10);
  assert.deepEqual(r.job.onNow.map(p => p.name), ['JELLICK Tom', 'MYERS John']);
  let b = await board(11);
  assert.deepEqual(b.techs.filter(t => t.on).map(t => [t.name, t.on.unit]), [['JELLICK Tom', 'T-901'], ['MYERS John', 'T-901']]);
  assert.deepEqual(b.jobs.find(j => j.id === id).onNow.map(p => p.name), ['JELLICK Tom', 'MYERS John']);

  // John moves to the pallet jack: his clock on T-901 stops (25 minutes), T-901 stays open with Tom on it.
  r = await as('JOHN', { step: 'START', writeUp: fork.writeUp }, 35);
  assert.deepEqual(r.stoppedOn, ['T-901']);
  const forkId = r.job.id;
  assert.equal(r.job.type, 'FORK_TRUCK');
  let wo = (await db().collection('workOrders').doc(id).get()).data();
  assert.deepEqual([wo.status, wo.on_now, wo.labor_minutes], ['WORKING', 'JELLICK Tom', 25]);
  // John stops on the pallet jack: it stays open, nobody on it.
  r = await as('JOHN', { step: 'STOP', id: forkId }, 50);
  assert.deepEqual([r.job.status, r.job.onNow, r.job.laborMinutes], ['WORKING', [], 15]);
  assert.ok((await board(51)).jobs.some(j => j.id === forkId), 'stopped is still open');

  // Need Parts stops Tom's clock; Parts are here starts it again for whoever pressed it.
  r = await as('TOM', { step: 'PARTS', id }, 60);
  assert.deepEqual([r.job.status, r.job.onNow, r.job.laborMinutes], ['PARTS', [], 85]);
  assert.equal((await db().collection('garageClocks').doc('TECH-JT').get()).exists, false);
  r = await as('TOM', { step: 'RESUME', id }, 120);
  assert.deepEqual(r.job.onNow.map(p => p.name), ['JELLICK Tom']);

  // Complete: name + login ID again, then what was fixed, safe, signature. Every clock stops; who completed it is kept.
  const done = await as('JOHN', { step: 'DONE', id, fixed: 'Repaired', safe: true, signature: SIG }, 150);
  assert.equal(done.job.status, 'DONE');
  wo = (await db().collection('workOrders').doc(id).get()).data();
  assert.deepEqual([wo.completed_by, wo.signed_by, wo.on_now, wo.labor_minutes], ['MYERS John', 'MYERS John', '', 115]);
  assert.deepEqual(wo.labor.map(s => [s.name, s.minutes]), [['JELLICK Tom', 60], ['MYERS John', 25], ['JELLICK Tom', 30]]);
  assert.equal((await db().collection('maintenance').doc('TRL-1').get()).data().status, 'COMPLETE');
  b = await board(151);
  assert.ok(!b.jobs.some(j => j.unit === 'T-901'), 'a completed job leaves the list');
  assert.deepEqual(b.techs.filter(t => t.on), [], 'nobody is on the clock');

  // The pallet jack completed: its FORK TRUCK LIVE write-up is repaired too.
  await as('TOM', { step: 'DONE', id: forkId, fixed: 'Replaced a part', safe: true, signature: SIG }, 160);
  assert.equal((await db().collection('maintenance').doc('FRK-1').get()).data().status, 'COMPLETE');
});
