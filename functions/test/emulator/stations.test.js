'use strict';
// Trailer Assignments (savePlantLoad with assign), the drivers' View Loadout board and the DVIR (phone.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const { phoneCall, newRouteCode } = require('../../src/phone');
const D = require('../../src/demo-sheets');
const PD = require('../fixtures/plant-demo');
const F = require('../fixtures/fake-sheets');

const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
const MANAGER = { email: 'manager.test@uniteddairy.com' };
let n = 0;
const rid = () => 'station-request-' + (++n) + '-' + Date.now();

test('Trailer Assignments: a short number becomes the full trailer, two matches must be typed in full, a down trailer is refused', async () => {
  await clear();
  await runTransfer({ db: db(), reader: D.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-07T16:00:00Z') });
  const eq = db().collection('equipment');
  await eq.doc('tr_223893').set({ unit: 'T-223893', type: 'TRAILER', status: 'ACTIVE' });
  await eq.doc('tr_100193').set({ unit: 'T-100193', type: 'TRAILER', status: 'ACTIVE' });
  await eq.doc('tr_200193').set({ unit: 'T-200193', type: 'TRAILER', status: 'ACTIVE' });
  await eq.doc('tr_300777').set({ unit: 'T-300777', type: 'TRAILER', status: 'DOWN', notes: 'DOWN: brakes | 10/6' });
  const runs = (await db().collection('runs').where('weekStart', '==', '2026-10-04').get()).docs.map(d => Object.assign({ id: d.id }, d.data()));
  const run = runs.find(r => r.days && r.days.thu && r.days.thu.runs);
  assert.ok(run, 'a Thursday load to assign');
  const at = () => new Date('2026-10-07T16:00:00Z');
  const assign = (trailer) => applyAction(db(), DISPATCHER, { action: 'savePlantLoad', requestId: rid(), runDocId: run.id, day: 'thu', fields: { trailer }, assign: true }, at);
  await assign('893');
  assert.equal((await db().collection('runs').doc(run.id).get()).data().days.thu.trailer, 'T-223893');
  await assert.rejects(assign('193'), /matches T-100193, T-200193\. Type the full number/);
  await assert.rejects(assign('300777'), /Trailer T-300777 is down \(brakes\)\. Pick another trailer/);
  await assert.rejects(assign('T/1'), /letters, numbers and dashes only/);
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'savePlantLoad', requestId: rid(), runDocId: run.id, day: 'thu', fields: { trailer: '893', notes: 'x' }, assign: true }, at), /changes only the trailer/);
  // A blank clears the trailer.
  await assign('');
  assert.equal((await db().collection('runs').doc(run.id).get()).data().days.thu.trailer, '');
});

test('drivers\' phone: View Loadout lists today\'s loads, and a DVIR with a defect on two trailers files one inspection per trailer', async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-06T12:00:00Z') });
  const at = (min) => () => new Date(Date.parse('2026-10-06T14:00:00Z') + (min || 0) * 60000);
  const { code } = await newRouteCode(db(), MANAGER);
  const board = await phoneCall(db(), { code, op: 'board' }, at());
  assert.equal(board.date, '2026-10-06');
  assert.ok(Array.isArray(board.rows));
  assert.equal(board.remaining, board.rows.filter(r => r.state !== 'LOADED').length);
  const load = (await phoneCall(db(), { code, op: 'loads', driverId: 'drv_test_brook' }, at())).loads[0];
  const ok = 'Checked — no defect', bad = 'Defect found';
  const fields = { inspection: 'Pre-trip', odometer: '123,456', truck: '101', trailer: '977', signatureName: 'Sam Brook', signature: 'TYPED',
    checks: [ok, ok, ok, ok, ok, ok, ok, bad, ok, ok, ok, ok], trailerIssues: 'Marker light out', moreTrailers: [{ trailer: '978', checks: [ok, ok, ok, ok, ok] }] };
  const input = { code, op: 'dvir', driverId: 'drv_test_brook', runDocId: load.runDocId, day: load.day, requestId: rid(), fields };
  await assert.rejects(phoneCall(db(), Object.assign({}, input, { requestId: rid(), fields: Object.assign({}, fields, { trailerIssues: '' }) }), at(1)), /Describe the inspection defects/);
  await assert.rejects(phoneCall(db(), Object.assign({}, input, { requestId: rid(), fields: Object.assign({}, fields, { moreTrailers: [{ trailer: '977', checks: [ok, ok, ok, ok, ok] }] }) }), at(1)), /entered twice/);
  await phoneCall(db(), input, at(2));
  await phoneCall(db(), input, at(3));   // the same request again saves nothing more
  const dvirs = (await db().collection('dvirs').get()).docs.map(d => d.data());
  assert.equal(dvirs.length, 2);
  assert.deepEqual(dvirs.map(d => d.trailer).sort(), ['T-977', 'T-978']);
});
