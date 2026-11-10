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

test('an administrator sees all eight apps, live addresses on the live project', async () => {
  const r = await H.hubCall(db, { email: 'pat.admin@uniteddairy.com' }, { op: 'home' }, { project: 'ud-distribution' });
  assert.deepEqual(keys(r), ['plant', 'distribution', 'customers', 'fuel', 'udms', 'routes', 'routecost', 'statements', 'accident', 'sales', 'inventory']);
  assert.equal(r.admin, true);
  // Plant & Distribution is two cards (11-5-26), each opening its own side of the app.
  assert.equal(r.tiles[0].url, 'https://ud-distribution.web.app/group.html?g=plantops');
  assert.equal(r.tiles[0].name, 'Plant Operations');
  assert.equal(r.tiles[1].url, 'https://ud-distribution.web.app/group.html?g=routeops');
  assert.equal(r.tiles[1].name, 'Route Distribution');
  assert.equal(r.tiles[2].url, 'https://ud-distribution-customers.web.app/');
  assert.equal(r.tiles[3].url, 'https://ud-distribution-fuel.web.app/');
  assert.equal(r.tiles[4].url, 'https://udms-bfccd.web.app/');
  assert.equal(r.tiles[5].url, 'https://ud-distribution-routes.web.app/');
  assert.equal(r.tiles[5].name, 'Route & Trip Costs');
  assert.equal(r.tiles[6].url, 'https://ud-distribution-route-cost.web.app/');
  assert.equal(r.tiles[6].name, 'Route Cost Analysis');
  assert.match(r.tiles[7].url, /^https:\/\/script\.google\.com\/a\/macros\/uniteddairy\.com\/s\/AKfyc[\w-]+\/exec$/);
  assert.equal(r.tiles[7].name, 'Customer Statements');
  assert.equal(r.tiles[8].url, 'https://united-dairy-accident-app.web.app/');
  assert.equal(r.tiles[8].name, 'Accident & Injury Reporting');
  // Joe 11-10-26: a card straight to the salespeople's own app (UD Sales).
  assert.equal(r.tiles[9].url, 'https://ud-distribution.web.app/sales.html');
  assert.equal(r.tiles[9].name, 'Sales App');
  // Joe 11-10-26: a card just for Inventory, under Plant.
  assert.equal(r.tiles[10].url, 'https://ud-distribution.web.app/inventory.html');
  assert.equal(r.tiles[10].name, 'Inventory');
  assert.ok(r.tiles.every(t => t.url.indexOf('sandbox') < 0), 'no live card opens a practice copy');
});

test('the practice copy links to the practice copies', async () => {
  const r = await H.hubCall(db, { email: 'pat.admin@uniteddairy.com' }, {}, { project: 'ud-distribution-sandbox' });
  assert.equal(r.tiles[0].url, 'https://ud-distribution-sandbox.web.app/group.html?g=plantops');
  assert.equal(r.tiles[1].url, 'https://ud-distribution-sandbox.web.app/group.html?g=routeops');
  assert.equal(r.tiles[3].url, 'https://ud-distribution-sandbox-fuel.web.app/');
  assert.equal(r.tiles[2].url, 'https://ud-distribution-sandbox-customers.web.app/');
  // Joe 11-9-26: Employees & Compliance opens UDMS's practice copy (made-up people).
  assert.equal(r.tiles[4].url, 'https://udms-sandbox.web.app/');
  assert.equal(r.tiles[6].url, 'https://ud-distribution-sandbox-route-cost.web.app/');
  // Route & Trip Costs, the Statement Center and the accident app have no practice copy yet: the practice hub opens the
  // live one and says so.
  assert.equal(r.tiles[5].url, 'https://ud-distribution-routes.web.app/');
  assert.equal(r.tiles[7].url, H.STATEMENTS_URL);
  assert.equal(r.tiles[8].url, 'https://united-dairy-accident-app.web.app/');
  assert.equal(r.tiles[9].url, 'https://ud-distribution-sandbox.web.app/sales.html');
  assert.equal(r.tiles[10].url, 'https://ud-distribution-sandbox.web.app/inventory.html');
  for (const i of [5, 7, 8]) assert.match(r.tiles[i].note, /no practice copy yet, so this opens the live one/);
  // Every other practice card opens a practice copy; none opens a live app without saying so.
  for (const t of r.tiles) {
    const practice = /sandbox/.test(t.url);
    assert.ok(practice || /opens the live one/.test(t.note), t.name + ' opens a live app without saying so');
    assert.ok(!practice || !/opens the live one/.test(t.note), t.name + ' says live but opens a practice copy');
  }
});

test('the live hub never says a card opens the live one', async () => {
  const r = await H.hubCall(db, { email: 'pat.admin@uniteddairy.com' }, {}, { project: 'ud-distribution' });
  assert.ok(r.tiles.every(t => !/opens the live one/.test(t.note)));
});

test('someone who is not an administrator sees Operations, the Customer List and Accident Reporting only', async () => {
  const r = await H.hubCall(db, { email: 'sam.sales@uniteddairy.com' }, { op: 'home' }, { project: 'ud-distribution' });
  assert.deepEqual(keys(r), ['plant', 'distribution', 'customers', 'accident', 'sales', 'inventory']);
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

// Joe 11-7-26: "Let's add it in now." One address on the live and practice hubs.
test('Customer Statements (the Statement Center) is on the hub for administrators, one address everywhere', () => {
  const a = H.apps('ud-distribution').find(x => x.key === 'statements'), b = H.apps('ud-distribution-sandbox').find(x => x.key === 'statements');
  assert.equal(a.url, H.STATEMENTS_URL);
  assert.equal(b.url, H.STATEMENTS_URL);
  assert.equal(a.may({ status: 'ACTIVE', roles: ['Administrator'] }), true);
  assert.equal(a.may({ status: 'ACTIVE', roles: ['Sales'] }), false);
});

test('ticks saved before Customer Statements joined still give administrators its card, until saved again', async () => {
  const admin = { status: 'ACTIVE', roles: ['Administrator'] }, sales = { status: 'ACTIVE', roles: ['Sales'] };
  const old = { apps: ['operations', 'customers', 'fuel', 'udms', 'routes', 'routecost', 'accident'], updatedAt: '2026-11-04T12:00:00.000Z' };
  assert.deepEqual(H.withAdded(admin, old), ['operations', 'customers', 'fuel', 'udms', 'routes', 'routecost', 'statements', 'accident']);
  assert.deepEqual(H.withAdded(sales, old), old.apps, 'someone who is not an administrator does not get it from the old ticks');
  const unticked = { apps: old.apps, updatedAt: '2026-11-07T15:00:00.000Z' };
  assert.deepEqual(H.withAdded(admin, unticked), old.apps, 'once unticked and saved, it stays off');
  assert.equal(H.withAdded(admin, null), null);
  const docs = { users: { 'pat.admin@uniteddairy.com': admin }, appAccess: { 'pat.admin@uniteddairy.com': old } };
  const mem = { collection: (c) => ({ doc: (id) => ({ get: async () => ({ exists: !!docs[c][id], data: () => docs[c][id] }) }),
    get: async () => ({ docs: Object.keys(docs[c]).map(id => ({ id, data: () => docs[c][id] })) }) }) };
  const pat = { email: 'pat.admin@uniteddairy.com' };
  assert.ok(keys(await H.hubCall(mem, pat, { op: 'home' })).includes('statements'), 'Home shows the card');
  assert.ok((await H.hubCall(mem, pat, { op: 'appAccess' })).saved['pat.admin@uniteddairy.com'].includes('statements'), 'People & Access shows it ticked');
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
    for (const ticks of [null, [], ['fuel'], ['customers', 'udms'], ['routes'], ['operations', 'customers', 'fuel', 'udms', 'routes', 'routecost'], ['statements']]) {
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
  assert.deepEqual(keys(await H.hubCall(mem, sam, { op: 'home' })), ['plant', 'distribution', 'customers', 'accident', 'sales', 'inventory']);
  await H.hubCall(mem, pat, { op: 'setApps', email: 'sam.sales@uniteddairy.com', apps: ['fuel'] });
  assert.deepEqual(docs.appAccess['sam.sales@uniteddairy.com'].apps, ['operations', 'fuel']);
  assert.deepEqual(keys(await H.hubCall(mem, sam, { op: 'home' })), ['plant', 'distribution', 'fuel', 'sales', 'inventory']);
  assert.deepEqual((await H.hubCall(mem, pat, { op: 'appAccess' })).saved, { 'sam.sales@uniteddairy.com': ['operations', 'fuel'] });
  await assert.rejects(H.hubCall(mem, sam, { op: 'setApps', email: 'sam.sales@uniteddairy.com', apps: ['udms'] }), /Only an administrator/);
  await assert.rejects(H.hubCall(mem, pat, { op: 'setApps', email: 'pat.admin@uniteddairy.com', apps: ['fuel'] }), /from yourself/);
  await assert.rejects(H.hubCall(mem, pat, { op: 'setApps', email: 'sam.sales@uniteddairy.com', apps: ['bookkeeping'] }), /could not be read/);
  assert.equal(Object.values(docs.actions).length, 1, 'each change is logged');
});

// Joe 11-6-26: Home's All app links, grouped, links only (no codes), on the live or practice site the hub runs on.
test('All app links: every group has links, they point at this hub\'s Operations site, and the accident app is under Everyone', async () => {
  const { linkGroups, ACCIDENT_URL, APPLY_URL } = await import('../../../public/js/apps.js');
  const g = linkGroups('https://ud-distribution.web.app');
  assert.deepEqual(g.map(x => x.name), ['Everyone', 'Managers', 'Sales', 'Drivers', 'Plant floor', 'Garage & Maintenance', 'Hiring']);
  g.forEach(x => assert.ok(x.links.length > 0, x.name));
  const urls = g.flatMap(x => x.links.map(l => l.url));
  assert.ok(urls.includes('https://ud-distribution.web.app/route.html'));
  assert.ok(urls.includes('https://ud-distribution.web.app/garage-station.html'));
  assert.ok(g[0].links.some(l => l.url === ACCIDENT_URL));
  assert.ok(urls.includes(APPLY_URL));
  urls.filter(u => u !== ACCIDENT_URL && u !== APPLY_URL).forEach(u => assert.ok(u.startsWith('https://ud-distribution.web.app/'), u));
  assert.ok(linkGroups('https://ud-distribution-sandbox.web.app/')[3].links[0].url.startsWith('https://ud-distribution-sandbox.web.app/route.html'));
});
