'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const L = require('../../src/logic');
const F = require('../fixtures/fake-sheets');

const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
const RUN = '2026-10-04__run_t801';
let n = 0;
const rid = () => 'lessor-request-' + (++n) + '-' + Date.now();
const tick = () => new Date('2026-10-09T12:00:00Z');
const records = async () => (await db().collection('maintenance').get()).docs.map(d => Object.assign({ id: d.id }, d.data()));

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: tick });
});

test('Truck Issues: Lessor marks a truck write-up sent to its lessor once; it is not for fork trucks and needs the lessor named', async () => {
  await applyAction(db(), DISPATCHER, { action: 'saveCheckIn', requestId: rid(), runDocId: RUN, day: 'mon', casesDelivered: 400,
    tractorIssues: 'Air leak', palletJackIssues: 'wheel squeaks' });
  const truck = L.issueRows(await records(), 'TRUCK')[0], jack = L.issueRows(await records(), 'FORK_TRUCK')[0];
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'updateIssue', requestId: rid(), recordId: truck.recordId, step: 'lessor', note: '' }), /which lessor/);
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'updateIssue', requestId: rid(), recordId: jack.recordId, step: 'lessor', note: 'Idealease' }), /Only a truck/);
  await applyAction(db(), DISPATCHER, { action: 'updateIssue', requestId: rid(), recordId: truck.recordId, step: 'lessor', note: 'Idealease' });
  // Joe 10/25: pressed again while its email never went, it emails again (the note is not added twice); once emailed, it is already sent.
  const twice = await applyAction(db(), DISPATCHER, { action: 'updateIssue', requestId: rid(), recordId: truck.recordId, step: 'lessor', note: 'Idealease' });
  assert.match(twice.message, /Emailing the lessor again/);
  assert.equal(((await records()).find(r => r.record_id === truck.recordId).notes.match(/Sent to lessor/g) || []).length, 1);
  const doc = (await db().collection('maintenance').get()).docs.find(d => d.data().record_id === truck.recordId);
  // Joe 10/25 (223877): an email sent before the blank-body fix (its time ends in Z) went out blank, so Lessor sends it again.
  await doc.ref.update({ notes: doc.data().notes + '\nRepair email sent 2026-10-09T12:00:00Z to repairs@idealease.test' });
  const blank = await applyAction(db(), DISPATCHER, { action: 'updateIssue', requestId: rid(), recordId: truck.recordId, step: 'lessor', note: 'Idealease' });
  assert.match(blank.message, /Emailing the lessor again/);
  await doc.ref.update({ notes: (await doc.ref.get()).data().notes + '\nRepair email sent 2026-10-26T08:00:00-04:00 to repairs@idealease.test' });
  const third = await applyAction(db(), DISPATCHER, { action: 'updateIssue', requestId: rid(), recordId: truck.recordId, step: 'lessor', note: 'Idealease' });
  assert.match(third.message, /Already sent/);
  const after = L.issueRows(await records(), 'TRUCK')[0];
  assert.equal(after.toLessor, true);
  assert.equal(after.lessor, 'Idealease');
  assert.equal(after.lessorBy, DISPATCHER.email);
  assert.equal(after.atGarage, false);
});
