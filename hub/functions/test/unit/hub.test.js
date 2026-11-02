'use strict';
// The hub's tiles follow each app's own rule (made-up people only).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('../../src/hub');

function fakeDb(people) {
  return { collection: () => ({ doc: (id) => ({ get: async () => ({ exists: !!people[id], data: () => people[id] }) }) }) };
}
const db = fakeDb({
  'pat.admin@uniteddairy.com': { status: 'ACTIVE', roles: ['Administrator'], name: 'Pat Admin' },
  'sam.sales@uniteddairy.com': { status: 'ACTIVE', roles: ['Sales'] },
  'lee.gone@uniteddairy.com': { status: 'INACTIVE', roles: ['Administrator'] }
});
const keys = (r) => r.tiles.map(t => t.key);

test('an administrator sees all four apps, live addresses on the live project', async () => {
  const r = await H.hubCall(db, { email: 'pat.admin@uniteddairy.com' }, { op: 'home' }, { project: 'ud-distribution' });
  assert.deepEqual(keys(r), ['operations', 'customers', 'fuel', 'udms']);
  assert.equal(r.admin, true);
  assert.equal(r.tiles[0].url, 'https://ud-distribution.web.app/');
  assert.equal(r.tiles[1].url, 'https://ud-distribution-customers.web.app/');
  assert.equal(r.tiles[2].url, 'https://ud-distribution-fuel.web.app/');
  assert.equal(r.tiles[3].url, 'https://udms-bfccd.web.app/');
});

test('the practice copy links to the practice copies', async () => {
  const r = await H.hubCall(db, { email: 'pat.admin@uniteddairy.com' }, {}, { project: 'ud-distribution-sandbox' });
  assert.equal(r.tiles[0].url, 'https://ud-distribution-sandbox.web.app/');
  assert.equal(r.tiles[2].url, 'https://ud-distribution-sandbox-fuel.web.app/');
});

test('someone who is not an administrator sees Operations and the Customer List only', async () => {
  const r = await H.hubCall(db, { email: 'sam.sales@uniteddairy.com' }, { op: 'home' }, { project: 'ud-distribution' });
  assert.deepEqual(keys(r), ['operations', 'customers']);
  assert.equal(r.admin, false);
});

test('an inactive person or someone not on the Users list is turned away in plain words', async () => {
  for (const email of ['lee.gone@uniteddairy.com', 'nobody@uniteddairy.com']) {
    await assert.rejects(H.hubCall(db, { email }, { op: 'home' }, {}), (e) => e instanceof H.HubError && e.code === 'NOT_ALLOWED' && /Users list/.test(e.message));
  }
});

test('an unknown request is refused', async () => {
  await assert.rejects(H.hubCall(db, { email: 'pat.admin@uniteddairy.com' }, { op: 'deleteEverything' }, {}), (e) => e.code === 'BAD_REQUEST');
});

test('Statement Center is not in the hub yet (Joe 11-2-26)', () => {
  assert.ok(!H.apps('ud-distribution').some(a => /statement/i.test(a.key + a.name)));
});

test('every page in public/ has its part in help.md', () => {
  const pub = path.join(__dirname, '..', '..', '..', 'public');
  const md = fs.readFileSync(path.join(pub, 'help.md'), 'utf8');
  const covered = [...md.matchAll(/^screens: (.+)$/gm)].flatMap(m => m[1].split(',').map(s => s.trim()));
  fs.readdirSync(pub).filter(f => f.endsWith('.html')).forEach(f => assert.ok(covered.includes(f), f + ' has no part in help.md'));
});
