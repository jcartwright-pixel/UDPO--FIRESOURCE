'use strict';
// Joe 10/13: accidents / incidents and complaints start Under review and count only once a manager reviews them; a manager
// can excuse a GPS miss (a hard stop for a deer) with a reason. Nothing is written to Driver Master.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { applyAction } = require('../../src/actions');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');

const MANAGER = { email: 'manager.test@uniteddairy.com' };
const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
let n = 0;
const rid = () => 'incident-' + (++n) + '-' + Date.now();
const now = () => new Date('2026-10-13T16:00:00Z');

test('accidents and complaints: saved Under review, a manager marks them counted or not; bad entries and dispatchers refused', async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now });
  const who = { driverKey: 'DRV_TEST_ADAMS', driver: 'ADAMS, PAT', date: '2026-10-12' };
  const a = await applyAction(db(), MANAGER, Object.assign({ requestId: rid(), action: 'addDriverIncident', kind: 'accident', accidentClass: 2, type: 'Backed into a pole', truck: '223893', preventable: true }, who), now);
  await applyAction(db(), MANAGER, Object.assign({ requestId: rid(), action: 'addDriverIncident', kind: 'complaint', source: 'customer', customer: 'Kroger 512', severity: 'major', note: 'Late delivery' }, who), now);
  const all = (await db().collection('driverIncidents').get()).docs.map(d => Object.assign({ id: d.id }, d.data()));
  assert.equal(all.length, 2);
  assert.ok(all.every(x => x.status === 'review' && x.enteredBy === MANAGER.email), 'both start Under review');
  const acc = all.find(x => x.kind === 'accident');
  assert.equal(acc.id, a.incidentId);
  assert.deepEqual([acc.accidentClass, acc.truck, acc.preventable], [2, '223893', true]);
  await applyAction(db(), MANAGER, { requestId: rid(), action: 'reviewDriverIncident', incidentId: acc.id, status: 'counts' }, now);
  const after = (await db().collection('driverIncidents').doc(acc.id).get()).data();
  assert.deepEqual([after.status, after.reviewedBy], ['counts', MANAGER.email]);
  await assert.rejects(applyAction(db(), MANAGER, Object.assign({ requestId: rid(), action: 'addDriverIncident', kind: 'accident', accidentClass: 4 }, who), now), /1st, 2nd or 3rd/);
  await assert.rejects(applyAction(db(), MANAGER, Object.assign({ requestId: rid(), action: 'addDriverIncident', kind: 'complaint', severity: 'huge' }, who), now), /Minor or Major/);
  await assert.rejects(applyAction(db(), DISPATCHER, Object.assign({ requestId: rid(), action: 'addDriverIncident', kind: 'accident', accidentClass: 1 }, who), now), /role/);
});

test('Excuse: a manager excuses a GPS miss with a reason, and can take it back', async () => {
  const key = 'gps|2026-10-12|223893@2026-10-12T14:00:00Z|hardBrake';
  await applyAction(db(), MANAGER, { requestId: rid(), action: 'excuseScorecardMiss', key, reason: 'Deer in the road', driverKey: 'DRV_TEST_ADAMS', what: 'Hard stop' }, now);
  let list = (await db().collection('scorecardExcuses').get()).docs.map(d => d.data());
  assert.deepEqual(list.map(x => [x.key, x.reason, x.by]), [[key, 'Deer in the road', MANAGER.email]]);
  await assert.rejects(applyAction(db(), MANAGER, { requestId: rid(), action: 'excuseScorecardMiss', key, reason: '' }, now), /reason/);
  await assert.rejects(applyAction(db(), MANAGER, { requestId: rid(), action: 'excuseScorecardMiss', key: 'cases|2026-10-12|x|y', reason: 'no' }, now), /GPS or Time/);
  await applyAction(db(), MANAGER, { requestId: rid(), action: 'excuseScorecardMiss', key, undo: true }, now);
  list = (await db().collection('scorecardExcuses').get()).docs;
  assert.equal(list.length, 0);
});
