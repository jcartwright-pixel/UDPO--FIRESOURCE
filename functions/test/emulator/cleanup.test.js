'use strict';
// How long data is kept (Joe 10/18): behind-the-scenes logs 90 days, Shift Notes 6 months; everything else is kept.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers'), db = H.db(), clear = H.clear;
const { runCleanup, cutoff, RULES } = require('../../src/cleanup');

const NOW = new Date('2026-10-18T08:00:00Z'), now = () => NOW;
const ago = (days) => new Date(NOW.getTime() - days * 86400000).toISOString();

test.beforeEach(() => clear());

test('the cut-offs are 90 days for logs and 6 months (by plant day) for Shift Notes', () => {
  const rule = (k) => RULES.find(r => r.key === k);
  assert.equal(cutoff(rule('transfers'), NOW), '2026-07-20T08:00:00.000Z');
  assert.equal(cutoff(rule('shiftNotes'), NOW), '2026-04-18');
});

test('old logs and old Shift Notes are deleted; recent ones, waiting saves and other records are kept', async () => {
  const put = (c, id, data) => db.collection(c).doc(id).set(data);
  await Promise.all([
    put('transfers', 'old', { at: ago(91) }), put('transfers', 'new', { at: ago(89) }), put('transfers', 'no-changes', { at: ago(0) }),
    put('outbox', 'sent', { status: 'done', at: ago(100), doneAt: ago(100) }), put('outbox', 'conflict', { status: 'conflict', at: ago(95), doneAt: ago(95) }),
    put('outbox', 'waiting', { status: 'pending', at: ago(200) }), put('outbox', 'recent', { status: 'done', at: ago(5), doneAt: ago(5) }),
    put('masterOutbox', 'sent', { status: 'done', at: ago(120), doneAt: ago(120) }), put('masterOutbox', 'waiting', { status: 'pending', at: ago(120) }),
    put('mailCopies', 'old', { savedAt: ago(91) }), put('mailCopies', 'new', { savedAt: ago(10) }),
    put('mailSeen', 'old', { at: ago(91) }), put('mailSeen', 'new', { at: ago(1) }),
    put('plantJournal', 'SHIFT_REPORT_app_old', { type: 'SHIFT_REPORT', date: '2026-04-17' }), put('plantJournal', 'SHIFT_REPORT_app_new', { type: 'SHIFT_REPORT', date: '2026-04-18' }),
    put('plantJournal', 'TEMP_old', { type: 'PLANT_TEMPERATURE_CHECK', date: '2025-01-01' }),
    put('sentEmails', 'old', { at: ago(400) }), put('textLog', 'old', { at: ago(400) }), put('actions', 'old', { at: ago(400) })
  ]);
  const r = await runCleanup({ db, now });
  const left = async (c) => (await db.collection(c).get()).docs.map(d => d.id).sort();
  assert.deepEqual(await left('transfers'), ['new', 'no-changes']);
  assert.deepEqual(await left('outbox'), ['recent', 'waiting']);
  assert.deepEqual(await left('masterOutbox'), ['waiting']);
  assert.deepEqual(await left('mailCopies'), ['new']);
  assert.deepEqual(await left('mailSeen'), ['new']);
  assert.deepEqual(await left('plantJournal'), ['SHIFT_REPORT_app_new', 'TEMP_old']);
  assert.deepEqual(await left('sentEmails'), ['old']);
  assert.deepEqual(await left('textLog'), ['old']);
  assert.deepEqual(await left('actions'), ['old']);
  assert.equal(r.outbox.deleted, 2);
  assert.equal(r.shiftNotes.deleted, 1);
  const saved = (await db.collection('config').doc('cleanup').get()).data();
  assert.equal(saved.at, NOW.toISOString());
  assert.equal(saved.lists.transfers.deleted, 1);
});

test('a list that fails does not stop the others', async () => {
  await db.collection('transfers').doc('old').set({ at: ago(91) });
  await db.collection('mailSeen').doc('old').set({ at: ago(91) });
  const real = db.collection.bind(db);
  const broken = Object.create(db);
  broken.collection = (name) => { if (name === 'transfers') throw new Error('read failed'); return real(name); };
  broken.batch = () => db.batch();
  const r = await runCleanup({ db: broken, now });
  assert.match(r.transfers.error, /Could not clean Sheet copy log: read failed/);
  assert.equal(r.mailSeen.deleted, 1);
  assert.equal((await db.collection('transfers').doc('old').get()).exists, true);
  assert.equal((await db.collection('mailSeen').doc('old').get()).exists, false);
});
