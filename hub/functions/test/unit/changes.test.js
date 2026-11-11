'use strict';
// The customer list's one door (Joe 11-9-26): apps send, the Hub approves or turns down. Made-up people and stores only.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../../src/hub');

function fakeDb(people) {
  const cols = { users: people, hubCustomerChanges: {}, actions: {} };
  let n = 0;
  const docRef = (col, id) => ({
    id, col,
    get: async () => ({ exists: !!cols[col][id], data: () => cols[col][id] }),
    set: async (v) => { cols[col][id] = JSON.parse(JSON.stringify(v)); }
  });
  const db = {
    cols,
    collection: (col) => {
      cols[col] = cols[col] || {};
      return {
        doc: (id) => docRef(col, id || 'c' + (++n)),
        where: (f, op, vals) => ({ get: async () => ({ docs: Object.keys(cols[col]).filter(k => vals.indexOf(cols[col][k][f]) >= 0).map(k => ({ id: k, data: () => cols[col][k] })) }) })
      };
    },
    runTransaction: async (fn) => fn({
      get: (ref) => ref.get(),
      update: (ref, v) => { Object.assign(cols[ref.col][ref.id], v); },
      set: (ref, v) => { cols[ref.col][ref.id] = v; }
    })
  };
  return db;
}
const people = {
  'pat.admin@uniteddairy.com': { status: 'ACTIVE', roles: ['Administrator'] },
  'sam.loader@uniteddairy.com': { status: 'ACTIVE', roles: ['Supervisor'] },
  'kim.other@uniteddairy.com': { status: 'ACTIVE', roles: ['Sales'] }
};
const pat = { email: 'pat.admin@uniteddairy.com' }, sam = { email: 'sam.loader@uniteddairy.com' }, kim = { email: 'kim.other@uniteddairy.com' };
const send = { op: 'sendChange', plant: 'fac_uniontown', from: 'pallet-builder', kind: 'routeDay', route: '844', day: 'tue',
  input: { op: 'saveRouteDay', route: '844', day: 'TUE', rev: 3, stops: [{ key: '1522|10', loadSeq: 2 }] }, summary: 'Route 844 Tuesday: Maple Market loads second' };

test('an app sends a change: it waits as sent, nothing else is written', async () => {
  const db = fakeDb(people);
  const r = await H.hubCall(db, sam, send);
  assert.equal(r.status, 'sent');
  const c = db.cols.hubCustomerChanges[r.id];
  assert.equal(c.sentBy, 'sam.loader@uniteddairy.com');
  assert.equal(c.day, 'TUE');
  assert.equal(c.input.plant, 'fac_uniontown');
  assert.equal(c.fromName, 'Pallet Builder');
  assert.deepEqual(Object.keys(db.cols).filter(k => Object.keys(db.cols[k]).length).sort(), ['hubCustomerChanges', 'users']);
});

test('a change that does not say what to save, or from an unknown app, is refused in plain words', async () => {
  const db = fakeDb(people);
  await assert.rejects(H.hubCall(db, sam, Object.assign({}, send, { input: { op: 'importMenu' } })), /does not say what to save/);
  await assert.rejects(H.hubCall(db, sam, Object.assign({}, send, { from: 'somewhere' })), /does not know the app/);
  await assert.rejects(H.hubCall(db, sam, Object.assign({}, send, { summary: '' })), /few words/);
  await assert.rejects(H.hubCall(db, sam, Object.assign({}, send, { plant: '' })), /plant/);
});

test('only an administrator sees, approves or turns down; approve logs who and when', async () => {
  const db = fakeDb(people);
  const { id } = await H.hubCall(db, sam, send);
  await assert.rejects(H.hubCall(db, sam, { op: 'customerChanges' }), /Only an administrator/);
  await assert.rejects(H.hubCall(db, sam, { op: 'approveChange', id }), /Only an administrator/);
  const list = await H.hubCall(db, pat, { op: 'customerChanges', plant: 'fac_uniontown' });
  assert.deepEqual(list.open.map(c => [c.id, c.op]), [[id, 'saveRouteDay']]);
  assert.equal(list.open[0].input, undefined, 'the list does not carry the whole change');
  const a = await H.hubCall(db, pat, { op: 'approveChange', id });
  assert.equal(a.status, 'approved');
  assert.equal(db.cols.hubCustomerChanges[id].approvedBy, 'pat.admin@uniteddairy.com');
  assert.equal(Object.values(db.cols.actions)[0].action, 'approveCustomerChange');
  await assert.rejects(H.hubCall(db, pat, { op: 'turnDownChange', id, why: 'late' }), /approved already/);
  assert.equal((await H.hubCall(db, pat, { op: 'customerChanges', plant: 'fac_charleston' })).open.length, 0);
});

test('turning down needs a reason; the sender sees it', async () => {
  const db = fakeDb(people);
  const { id } = await H.hubCall(db, sam, send);
  await assert.rejects(H.hubCall(db, pat, { op: 'turnDownChange', id }), /Say why/);
  await H.hubCall(db, pat, { op: 'turnDownChange', id, why: 'Maple Market moved to 803' });
  const s = await H.hubCall(db, sam, { op: 'changeStatus', id });
  assert.deepEqual([s.status, s.why], ['turnedDown', 'Maple Market moved to 803']);
  assert.equal((await H.hubCall(db, pat, { op: 'customerChanges' })).done.length, 1);
});

test('only the sender takes back a change, and only before it is approved', async () => {
  const db = fakeDb(people);
  const { id } = await H.hubCall(db, sam, send);
  await assert.rejects(H.hubCall(db, kim, { op: 'withdrawChange', id }), /Only the person who sent/);
  assert.equal((await H.hubCall(db, sam, { op: 'withdrawChange', id })).status, 'withdrawn');
  await assert.rejects(H.hubCall(db, pat, { op: 'approveChange', id }), /withdrawn already/);
});
