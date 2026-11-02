'use strict';
// Joe 11/2 ("I think it should be all moved off of Google Drive"): a Google sheet's list moves into Operations, one at a time
// (logic.js OFF_SHEETS, Administration > Go-Live Switches). Once moved, the app stops copying that sheet and stops writing it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { setSwitch } = require('../../src/switch');
const { runMasterWriteBack } = require('../../src/masterwrite');
const A = require('../../src/admin');
const L = require('../../src/logic');
const F = require('../fixtures/fake-sheets');

const ADMIN = { email: 'admin.test@uniteddairy.com' };
const MANAGER = { email: 'manager.test@uniteddairy.com' };
let n = 0, clock = 0;
const rid = () => 'offsheet-request-' + (++n) + '-' + Date.now();
const tick = () => new Date(Date.parse('2026-11-02T12:00:00Z') + (++clock) * 60000);
const config = async () => (await db().collection('config').doc('app').get()).data() || {};

let tabs, sheets;
test.beforeEach(async () => {
  await clear();
  tabs = F.fakeSheets();
  sheets = F.fakeWritableSheets(tabs);
  await runTransfer({ db: db(), reader: sheets, sources: F.SOURCES, now: tick });
});

test('only an administrator moves a sheet, only a ready one, and a moved sheet stays moved', async () => {
  await assert.rejects(setSwitch(db(), MANAGER, { requestId: rid(), offSheet: 'users' }, true), /Only an administrator/);
  await assert.rejects(setSwitch(db(), ADMIN, { requestId: rid(), offSheet: 'nope' }, true), /Unknown sheet/);
  const notReady = L.OFF_SHEETS.find(s => !s.ready);
  await assert.rejects(setSwitch(db(), ADMIN, { requestId: rid(), offSheet: notReady.list }, true), /not ready to move/);
  const out = await setSwitch(db(), ADMIN, { requestId: rid(), offSheet: 'users' }, true);
  assert.deepEqual([out.ok, out.offSheet, out.already], [true, 'users', false]);
  const c = await config();
  assert.equal(L.offSheet(c, 'users'), true);
  assert.equal(c.offSheets.users.by, ADMIN.email);
  const again = await setSwitch(db(), ADMIN, { requestId: rid(), offSheet: 'users' }, true);
  assert.equal(again.already, true);
  assert.equal((await config()).offSheets.users.at, c.offSheets.users.at);
  const log = await db().collection('actions').where('action', '==', 'moveOffSheet').get();
  assert.equal(log.size, 2);
});

test('after the People list moves, the copy no longer reads the Users sheet', async () => {
  const ref = db().collection('users').doc('manager.test@uniteddairy.com');
  await setSwitch(db(), ADMIN, { requestId: rid(), offSheet: 'users' }, true);
  // Someone changes the old sheet: the app keeps its own list.
  const users = tabs["'USERS_MASTER'"], nameCol = users[0].indexOf('Display Name');
  const row = users.findIndex(r => String(r[users[0].indexOf('Email')]).toLowerCase() === 'manager.test@uniteddairy.com');
  assert.ok(row > 0 && nameCol >= 0);
  const before = (await ref.get()).data().name;
  users[row][nameCol] = 'Typed In The Old Sheet';
  await runTransfer({ db: db(), reader: sheets, sources: F.SOURCES, now: tick, force: true });
  assert.equal((await ref.get()).data().name, before);
  // The other lists are still copied as before.
  assert.ok((await db().collection('drivers').get()).size > 0);
});

test('after the People list moves, a save waiting for the Users sheet is closed and the sheet is not written', async () => {
  await db().collection('config').doc('app').set({ writeBack: { enabled: true } }, { merge: true });
  await setSwitch(db(), ADMIN, { requestId: rid(), offSheet: 'users' }, true);
  await db().collection('masterOutbox').doc('usr-1').set({ status: 'pending', at: '2026-11-02T12:00:00Z', requestId: 'usr-1', list: 'users', collection: 'users',
    docId: 'manager.test@uniteddairy.com', rowId: 'manager.test@uniteddairy.com', idColumn: 'email', cells: { display_name: 'Should Not Reach The Sheet' } });
  const was = JSON.stringify(tabs["'USERS_MASTER'"]);
  const out = await runMasterWriteBack({ db: db(), sheets, targets: { users: F.SOURCES.masters.users }, now: tick });
  assert.equal(out.written, 0);
  assert.equal((await db().collection('masterOutbox').doc('usr-1').get()).data().status, 'offSheet');
  assert.equal(JSON.stringify(tabs["'USERS_MASTER'"]), was);
});

test('after the People list moves, People saves with the write-back off and queues nothing for the sheet', async () => {
  await db().collection('config').doc('app').set({ writeBack: { enabled: false } }, { merge: true });
  await db().collection('users').doc('boss@uniteddairy.com').set({ name: 'Boss', status: 'ACTIVE', roles: ['ADMINISTRATOR'], facilities: ['*'], cells: { id: 'usr_boss', version: '1' } });
  const call = (input) => A.adminCall(db(), { email: 'boss@uniteddairy.com' }, input);
  const newRev = (await call({ op: 'people' })).newRevision;
  const add = { op: 'savePerson', email: 'new.person@uniteddairy.com', name: 'New Person', roles: ['PLANT_EMPLOYEE'], status: 'ACTIVE', facilities: ['fac_uniontown'], isNew: true, revision: newRev };
  await assert.rejects(call(add), /write-back on/);
  await setSwitch(db(), ADMIN, { requestId: rid(), offSheet: 'users' }, true);
  const out = await call(add);
  assert.equal(out.ok, true);
  assert.equal((await db().collection('users').doc('new.person@uniteddairy.com').get()).data().name, 'New Person');
  assert.equal((await db().collection('masterOutbox').where('list', '==', 'users').get()).size, 0);
});
