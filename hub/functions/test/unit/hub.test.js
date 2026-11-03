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

test('People & Access shows the same apps as the tiles', async () => {
  const { appsFor } = await import('../../../public/js/apps.js');
  const people = [
    { status: 'ACTIVE', roles: ['Administrator'] }, { status: 'ACTIVE', roles: ['admin'] }, { status: 'ACTIVE', roles: ['MANAGER'] },
    { status: 'ACTIVE', roles: ['Driver'] }, { status: 'INACTIVE', roles: ['ADMINISTRATOR'] }, { status: 'active', roles: [] }
  ];
  const names = Object.fromEntries(H.apps('ud-distribution').map(a => [a.key, a.name]));
  for (const p of people) {
    const tiles = H.apps('ud-distribution').filter(a => a.may(p)).map(a => a.name);
    assert.deepEqual(appsFor(p), tiles, JSON.stringify(p));
    for (const ticks of [null, [], ['fuel'], ['customers', 'udms'], ['operations', 'customers', 'fuel', 'udms']]) {
      assert.deepEqual(appsFor(p, ticks), H.appsOf(p, ticks).map(k => names[k]), JSON.stringify([p, ticks]));
    }
  }
  assert.ok(names.operations);
});

// People & Access works out screens, Home screen choices and rights the same way Operations does (made-up people only).
test('People & Access follows Operations\' own screen, Home screen and rights rules', async () => {
  const A = await import('../../../public/js/access.js');
  const L = require('../../../../functions/src/logic');
  const R = require('../../../../functions/src/rights');
  const areas = L.SCREEN_AREAS, plants = L.PLANTS;
  assert.deepEqual(A.screenKeys(areas), L.SCREEN_KEYS);
  const people = [
    { status: 'ACTIVE', roles: ['MANAGER'], facilities: ['fac_uniontown'] },
    { status: 'ACTIVE', roles: ['DISPATCHER'], facilities: [] },
    { status: 'ACTIVE', roles: ['ADMINISTRATOR'], facilities: [] },
    { status: 'ACTIVE', roles: ['SUPERVISOR'], facilities: ['*'] },
    { status: 'INACTIVE', roles: ['MANAGER'], facilities: ['fac_uniontown'] }
  ];
  const accesses = [null, { fac_uniontown: ['daily', 'weekly', 'garage'] }, { fac_uniontown: [], fac_charleston: ['pmCenter'] }];
  people.forEach(p => {
    assert.deepEqual(A.plantsFor(p, plants), L.plantsFor(p), JSON.stringify(p));
    accesses.forEach(a => {
      assert.deepEqual(A.homeChoices(p, a, areas, plants), L.homeChoices(p, a), JSON.stringify([p, a]));
      plants.forEach(pl => assert.deepEqual(A.screensFor(p, a, pl.id, areas, plants), L.screensFor(p, a, pl.id)));
    });
    const ex = { grants: ['fleet.write', 'dispatch.write'], denials: ['dispatch.write', 'drivers.read'] };
    const want = R.effectiveRights(p, {}, ex);
    R.CATALOG.forEach(r => assert.equal(A.rightAllowed(Object.assign({}, p, ex), r.code, {}, R.DEFAULTS), want.indexOf(r.code) >= 0 || want.indexOf('*') >= 0,
      r.code + ' ' + JSON.stringify(p)));
  });
});

// Joe 11-3-26: each person's apps ticked in People & Access; Plant & Distribution always stays on.
test('saved app ticks decide the tiles; only administrators change them, never their own', async () => {
  const docs = { users: { 'pat.admin@uniteddairy.com': { status: 'ACTIVE', roles: ['Administrator'] }, 'sam.sales@uniteddairy.com': { status: 'ACTIVE', roles: ['Sales'] } }, appAccess: {}, actions: {} };
  const ref = (c, id) => ({ c, id, get: async () => ({ exists: !!docs[c][id], data: () => docs[c][id] }) });
  const mem = {
    collection: (c) => ({ doc: (id) => ref(c, id), get: async () => ({ docs: Object.keys(docs[c]).map(id => ({ id, data: () => docs[c][id] })) }) }),
    runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (r, v) => { docs[r.c][r.id] = v; } })
  };
  const pat = { email: 'pat.admin@uniteddairy.com' }, sam = { email: 'sam.sales@uniteddairy.com' };
  assert.deepEqual(keys(await H.hubCall(mem, sam, { op: 'home' })), ['operations', 'customers']);
  await H.hubCall(mem, pat, { op: 'setApps', email: 'sam.sales@uniteddairy.com', apps: ['fuel'] });
  assert.deepEqual(docs.appAccess['sam.sales@uniteddairy.com'].apps, ['operations', 'fuel']);
  assert.deepEqual(keys(await H.hubCall(mem, sam, { op: 'home' })), ['operations', 'fuel']);
  assert.deepEqual((await H.hubCall(mem, pat, { op: 'appAccess' })).saved, { 'sam.sales@uniteddairy.com': ['operations', 'fuel'] });
  await assert.rejects(H.hubCall(mem, sam, { op: 'setApps', email: 'sam.sales@uniteddairy.com', apps: ['udms'] }), /Only an administrator/);
  await assert.rejects(H.hubCall(mem, pat, { op: 'setApps', email: 'pat.admin@uniteddairy.com', apps: ['fuel'] }), /from yourself/);
  await assert.rejects(H.hubCall(mem, pat, { op: 'setApps', email: 'sam.sales@uniteddairy.com', apps: ['statements'] }), /could not be read/);
  assert.equal(Object.values(docs.actions).length, 1, 'each change is logged');
});
