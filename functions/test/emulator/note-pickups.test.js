'use strict';
// Completing a pickup that a load note asked for saves it as a pickup record (the note as the item), complete.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const B = require('../../src/board-rules');
const D = require('../../src/demo-sheets');
const PD = require('../fixtures/plant-demo');

const LOADER = { email: 'viewer.test@uniteddairy.com' };
const DATE = PD.PLANT_DATE, RUN = '2026-10-04__run_p811';
let n = 0;
const rid = () => 'note-pickup-' + (++n) + '-' + Date.now();
const complete = (extra) => applyAction(db(), LOADER, Object.assign({ action: 'completePickup', requestId: rid(), pickupId: B.notePickupId(RUN, 'fri', DATE), runDocId: RUN, day: 'fri', date: DATE }, extra || {}));

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: D.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date(DATE + 'T14:00:00Z') });
});

test('a load note asking for a pickup: Pickup Complete saves it complete with the note as the item, once', async () => {
  await assert.rejects(complete(), /no longer asks for a pickup/);
  await applyAction(db(), LOADER, { action: 'savePlantLoad', requestId: rid(), runDocId: RUN, day: 'fri', fields: { notes: 'P/U 10 cases 14.5% mix' } });
  const out = await complete();
  const p = (await db().collection('pickups').doc(out.pickupId).get()).data();
  assert.equal(p.item, 'P/U 10 cases 14.5% mix');
  assert.equal(p.status, 'COMPLETE');
  assert.equal(p.completedBy, LOADER.email);
  assert.equal(p.notes, 'From the load note');
  assert.equal((await complete()).already, true);
  // With the pickup saved, the note no longer lists one.
  const run = Object.assign({ id: RUN }, (await db().collection('runs').doc(RUN).get()).data());
  assert.equal(B.notePickup(run, 'fri', DATE, [p]), null);
  await assert.rejects(complete({ pickupId: B.notePickupId(RUN, 'thu', DATE) }), /does not match its load/);
});
