'use strict';
// Plant Schedule & Vacations (Joe 10/25, mock-ups 1 and 3): the setup (areas with their own shift times, jobs, people), the
// Schedule Board's days, and time off with the driver Vacation Schedule's rules counted by area and shift.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const D = require('../../src/demo-sheets');
const PD = require('../fixtures/plant-demo');
const R = require('../../src/crew-rules');

let n = 0;
const rid = () => 'crew-request-' + (++n) + '-' + Date.now();
const MANAGER = 'manager.test@uniteddairy.com', DISPATCHER = 'dispatch.test@uniteddairy.com', PLANT = 'viewer.test@uniteddairy.com';
const act = (email, action, fields) => applyAction(db(), { email }, Object.assign({ action, requestId: rid(), facilityId: 'fac_uniontown', team: 'plant' }, fields));
const setup = (fields, email) => act(email || MANAGER, 'saveCrewSetup', fields);
const all = async (coll) => (await db().collection(coll).get()).docs.map(d => Object.assign({ id: d.id }, d.data()));

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: D.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
});

test('Setup: a manager adds an area with its own shift times, a job and a person; others may not change the setup', async () => {
  const a = await setup({ op: 'area', fields: { name: 'Fillers', shifts: { 1: { start: '06:00', end: '14:30' } }, days: [1, 2, 3, 4, 5] } });
  assert.equal(a.created, true);
  const j = await setup({ op: 'job', fields: { name: 'Gallon Filler Operator', areaId: a.id, need: { 1: 2, 2: 1, 3: 0 } } });
  const p = await setup({ op: 'person', fields: { name: 'Baker, Sam', areaId: a.id, jobId: j.id, shift: 1, daysOff: [0, 6], employeeId: '9001' } });
  const person = (await db().collection('crewPeople').doc(p.id).get()).data();
  assert.equal(person.name, 'BAKER, SAM');
  assert.deepEqual(person.daysOff, [0, 6]);
  assert.equal(person.team, 'plant');
  await assert.rejects(setup({ op: 'area', fields: { name: 'fillers' } }), /already on the list/);
  await assert.rejects(setup({ op: 'area', fields: { name: 'Loadout', shifts: { 1: { start: '04:00' } } } }), /start and an end/);
  await assert.rejects(setup({ op: 'person', fields: { name: 'X', ssn: '1' } }), /Unknown box/);
  await assert.rejects(setup({ op: 'job', fields: { name: 'Loader', areaId: 'nope' } }), /this list's areas/);
  await assert.rejects(setup({ op: 'area', fields: { name: 'Loadout' } }, DISPATCHER));
  // Maintenance keeps its own list: the plant's area is not one of its areas.
  await assert.rejects(applyAction(db(), { email: MANAGER }, { action: 'saveCrewSetup', requestId: rid(), facilityId: 'fac_uniontown', team: 'maint', op: 'job', fields: { name: 'Mechanic', areaId: a.id } }), /this list's areas/);
});

test('Schedule Board: a supervisor gives a person another job or Off for a day; blank puts the usual back', async () => {
  const a = await setup({ op: 'area', fields: { name: 'Loadout' } });
  const loader = await setup({ op: 'job', fields: { name: 'Loader', areaId: a.id } }), checker = await setup({ op: 'job', fields: { name: 'Checker', areaId: a.id } });
  const p = await setup({ op: 'person', fields: { name: 'Ortiz, Nina', areaId: a.id, jobId: loader.id, shift: 1, daysOff: [0] } });
  await act(DISPATCHER, 'saveCrewDay', { personId: p.id, day: '2026-10-28', value: checker.id });
  await act(DISPATCHER, 'saveCrewDay', { personId: p.id, day: '2026-10-29', value: 'OFF' });
  let week = (await db().collection('crewWeeks').doc(p.id + '__2026-10-25').get()).data();
  assert.deepEqual(week.days, { '2026-10-28': checker.id, '2026-10-29': 'OFF' });
  const person = Object.assign({ id: p.id }, (await db().collection('crewPeople').doc(p.id).get()).data());
  assert.deepEqual(R.cellFor(person, '2026-10-28', week, []), { kind: 'JOB', jobId: checker.id, changed: true });
  assert.equal(R.cellFor(person, '2026-10-25', week, []).kind, 'OFF');
  assert.equal(R.cellFor(person, '2026-10-27', week, []).jobId, loader.id);
  await act(DISPATCHER, 'saveCrewDay', { personId: p.id, day: '2026-10-28', value: '' });
  week = (await db().collection('crewWeeks').doc(p.id + '__2026-10-25').get()).data();
  assert.deepEqual(week.days, { '2026-10-29': 'OFF' });
  await assert.rejects(act(PLANT, 'saveCrewDay', { personId: p.id, day: '2026-10-28', value: 'OFF' }));
});

test('Vacations: the limit counts the same area and shift, lower in a holiday week; a person cannot be off twice', async () => {
  const a = await setup({ op: 'area', fields: { name: 'Fillers' } }), b = await setup({ op: 'area', fields: { name: 'Loadout' } });
  const mk = async (name, area, shift) => (await setup({ op: 'person', fields: { name, areaId: area.id, shift } })).id;
  const p1 = await mk('A, ONE', a, 1), p2 = await mk('B, TWO', a, 1), p3 = await mk('C, THREE', a, 1), p4 = await mk('D, FOUR', b, 1), p5 = await mk('E, FIVE', a, 2);
  const vac = (personId, startDate, endDate, extra) => act(DISPATCHER, 'saveCrewVacation', Object.assign({ personId, startDate, endDate, type: 'VACATION', status: 'APPROVED' }, extra || {}));
  await vac(p1, '2026-11-02', '2026-11-06');
  await vac(p2, '2026-11-04', '2026-11-04');
  await assert.rejects(vac(p3, '2026-11-04', '2026-11-04'), /full/);
  await vac(p4, '2026-11-04', '2026-11-04');
  await vac(p5, '2026-11-04', '2026-11-04');
  await vac(p3, '2026-11-04', '2026-11-04', { status: 'PENDING' });
  await assert.rejects(vac(p1, '2026-11-05', '2026-11-05'), /already off/);
  // Thanksgiving week: 1 off per area and shift.
  await vac(p1, '2026-11-23', '2026-11-23');
  await assert.rejects(vac(p2, '2026-11-23', '2026-11-24'), /Thanksgiving/);
  await setup({ op: 'rules', fields: { maxOff: 2, holidayMaxOff: 2 } });
  await vac(p2, '2026-11-23', '2026-11-24');
  assert.equal((await all('crewVacations')).length, 7);
});

test('The made-up starting list fills an empty list once, on the test copy only', async () => {
  await setup({ op: 'starter' });
  const people = (await all('crewPeople')).filter(p => p.team === 'plant');
  assert.ok(people.length >= 70 && people.length <= 80, people.length + ' people'); // Joe 10/25: about 75 people
  assert.ok(people.every(p => p.madeUp && !('ssn' in p) && !('address' in p) && !('dob' in p)));
  await assert.rejects(setup({ op: 'starter' }), /already has people/);
  const was = process.env.GCLOUD_PROJECT;
  process.env.GCLOUD_PROJECT = 'ud-distribution';
  try { await assert.rejects(setup({ op: 'starter', team: 'maint' }), /test copy only/); } finally { if (was === undefined) delete process.env.GCLOUD_PROJECT; else process.env.GCLOUD_PROJECT = was; }
});
