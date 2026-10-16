'use strict';
// RedZone (Joe 10/11): read only. An administrator saves the API sign-in (a token, or a client ID and secret), Test Connection
// reads the products, and Products' Get from RedZone gets this plant's list. Nothing secret reaches the screen or config/redzone.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { safeIdPart } = require('../../src/model');
const R = require('../../src/redzone');

const ADMIN = { email: 'admin.rz@uniteddairy.com' }, MANAGER = { email: 'manager.rz@uniteddairy.com' }, DRIVER = { email: 'driver.rz@uniteddairy.com' };
const TOKEN = 'rz_token_never_shown_1234', SECRET = 'rz_secret_never_shown_9999';
const BASE = 'https://api.redzone.example/v1';
async function people() {
  const put = (u, roles) => db().collection('users').doc(safeIdPart(u.email)).set({ email: u.email, status: 'ACTIVE', roles });
  await put(ADMIN, ['ADMINISTRATOR']); await put(MANAGER, ['MANAGER']); await put(DRIVER, ['DRIVER']);
}
// A stand-in for RedZone: a token address, then two pages of products (the second through a next link).
function fakeRedzone(calls) {
  return async (url, opts) => {
    calls.push({ url, auth: opts.headers.Authorization, body: opts.body || '' });
    const reply = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
    if (url === 'https://auth.redzone.example/oauth/token') return reply(200, { access_token: 'traded_token', expires_in: 3600 });
    if (opts.headers.Authorization !== 'Bearer ' + TOKEN && opts.headers.Authorization !== 'Bearer traded_token') return reply(401, { error: 'bad ' + TOKEN });
    if (url === BASE + '/products') return reply(200, { data: [
      { id: 1, name: 'UD Wildberry', sku: '3934', mfgType: 'Quart', productGroups: [{ name: 'Drinks' }], site: { name: 'Uniontown' } },
      { id: 2, name: 'US OJ PLS QT', sku: '4410', mfgType: { name: 'Quart' }, productGroups: ['Drinks'] }
    ], links: { next: '/products?page=2' } });
    if (url === BASE + '/products?page=2') return reply(200, { data: [
      { id: 3, name: 'Old Product', sku: '1', active: false },
      { id: 4, name: 'Charleston Only', sku: '77', site: 'Charleston' }
    ] });
    return reply(404, {});
  };
}

test.beforeEach(() => clear());

test('only an administrator sets the sign-in; the screen sees the last 4 characters, never the token or secret', async () => {
  await people();
  await assert.rejects(R.redzoneCall(db(), MANAGER, { op: 'status' }), /Only an administrator/);
  await assert.rejects(R.redzoneCall(db(), ADMIN, { op: 'save', address: 'http://plain.example' }), /must start with https/);
  const saved = await R.redzoneCall(db(), ADMIN, { op: 'save', address: BASE + '/', token: TOKEN });
  assert.deepEqual([saved.address, saved.hasToken, saved.tokenEnds, saved.productsPath], [BASE, true, '1234', '/products']);
  const status = await R.redzoneCall(db(), ADMIN, { op: 'status' });
  assert.ok(![saved, status].some(x => JSON.stringify(x).includes(TOKEN)));
  assert.equal((await db().collection('config').doc('redzone').get()).data().configured, false);
});

test('Test Connection follows the next page, and a refused token is said in plain words without the token', async () => {
  await people();
  await R.redzoneCall(db(), ADMIN, { op: 'save', address: BASE, token: TOKEN });
  const calls = [];
  const ok = await R.redzoneCall(db(), ADMIN, { op: 'test' }, { fetch: fakeRedzone(calls) });
  assert.equal(ok.result.ok, true);
  assert.match(ok.result.message, /RedZone sent 4 products \(3 active\)/);
  assert.deepEqual(calls.map(c => c.url), [BASE + '/products', BASE + '/products?page=2']);
  const cfg = (await db().collection('config').doc('redzone').get()).data();
  assert.deepEqual([cfg.configured, cfg.products], [true, 4]);
  await R.redzoneCall(db(), ADMIN, { op: 'save', token: 'wrong_token' });
  const bad = await R.redzoneCall(db(), ADMIN, { op: 'test' }, { fetch: fakeRedzone([]) });
  assert.equal(bad.result.ok, false);
  assert.match(bad.result.message, /refused the sign-in \(401\)/);
  const everything = JSON.stringify(bad) + JSON.stringify((await db().collection('config').doc('redzone').get()).data());
  assert.ok(!everything.includes(TOKEN) && !everything.includes('wrong_token'));
});

test('an organization ID, client ID and secret are traded for a token at the token address', async () => {
  await people();
  await R.redzoneCall(db(), ADMIN, { op: 'save', orgId: 'ud-org-7', address: BASE, clientId: 'client-abc', clientSecret: SECRET, tokenUrl: 'https://auth.redzone.example/oauth/token' });
  const calls = [];
  const ok = await R.redzoneCall(db(), ADMIN, { op: 'test' }, { fetch: fakeRedzone(calls) });
  assert.equal(ok.result.ok, true);
  assert.match(calls[0].body, /grant_type=client_credentials/);
  assert.match(calls[0].body, /organization_id=ud-org-7/, 'the organization ID goes with the client ID and secret');
  assert.equal((await R.redzoneCall(db(), ADMIN, { op: 'status' })).orgId, 'ud-org-7');
  assert.equal(calls[1].auth, 'Bearer traded_token');
  assert.ok(!JSON.stringify(ok).includes(SECRET));
});

test('Get from RedZone: managers only, after a passing test, active products for this plant only', async () => {
  await people();
  await R.redzoneCall(db(), ADMIN, { op: 'save', address: BASE, token: TOKEN });
  await assert.rejects(R.redzoneCall(db(), MANAGER, { op: 'products', facilityId: 'fac_uniontown' }, { fetch: fakeRedzone([]) }), /not connected yet/);
  await R.redzoneCall(db(), ADMIN, { op: 'test' }, { fetch: fakeRedzone([]) });
  await assert.rejects(R.redzoneCall(db(), DRIVER, { op: 'products', facilityId: 'fac_uniontown' }), /manager or administrator/);
  const got = await R.redzoneCall(db(), MANAGER, { op: 'products', facilityId: 'fac_uniontown' }, { fetch: fakeRedzone([]) });
  assert.deepEqual(got.products, [
    { name: 'UD Wildberry', sku: '3934', mfgType: 'Quart', productGroup: 'Drinks' },
    { name: 'US OJ PLS QT', sku: '4410', mfgType: 'Quart', productGroup: 'Drinks' }
  ]);
  assert.equal(got.skipped, 2);
});

// RedZone's API reference (10/16): POST https://api.rz-ops.com/public/v3/oauth/token; support's .../public/v2/oauth/token also
// signs in. The API is under https://api.rz-ops.com/public/v2. Only the client ID and secret are typed.
test('RedZone\'s own addresses are filled in; the client ID and secret alone sign in (v3, then v2), sent as JSON when the form is refused', async () => {
  await people();
  const fresh = await R.redzoneCall(db(), ADMIN, { op: 'status' });
  assert.deepEqual([fresh.address, fresh.tokenUrl], ['https://api.rz-ops.com/public/v2', 'https://api.rz-ops.com/public/v3/oauth/token']);
  await R.redzoneCall(db(), ADMIN, { op: 'save', clientId: 'client-abc', clientSecret: SECRET });
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url, type: opts.headers['Content-Type'] || '', auth: opts.headers.Authorization || '', body: opts.body || '' });
    const reply = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
    if (url === 'https://api.rz-ops.com/public/v2/oauth/token') {
      if (opts.headers['Content-Type'] !== 'application/json') return reply(415, { error: 'json only' });
      const b = JSON.parse(opts.body);
      return b.client_id === 'client-abc' && b.client_secret === SECRET ? reply(200, { access_token: 'rz_bearer', expires_in: 3600 }) : reply(401, {});
    }
    return reply(404, {});
  };
  const r = await R.redzoneCall(db(), ADMIN, { op: 'test' }, { fetch });
  assert.equal(r.result.ok, true);
  assert.match(r.result.message, /Signed in to RedZone: the client ID and secret work\. The product list did not come back yet \(.*404/);
  assert.deepEqual(calls.map(c => [c.url, c.type]), [
    ['https://api.rz-ops.com/public/v3/oauth/token', 'application/x-www-form-urlencoded'],
    ['https://api.rz-ops.com/public/v2/oauth/token', 'application/x-www-form-urlencoded'],
    ['https://api.rz-ops.com/public/v2/oauth/token', 'application/json'],
    ['https://api.rz-ops.com/public/v2/products', '']
  ]);
  assert.equal(calls[3].auth, 'Bearer rz_bearer');
  assert.ok(!JSON.stringify(r).includes(SECRET) && !JSON.stringify(r).includes('rz_bearer'));
  await R.redzoneCall(db(), ADMIN, { op: 'save', clientSecret: 'wrong' });
  const bad = await R.redzoneCall(db(), ADMIN, { op: 'test' }, { fetch });
  assert.equal(bad.result.ok, false);
  assert.match(bad.result.message, /refused the sign-in \(401\)/);
});

test('{org} and {enterprise} in the products address are filled in; the old v2 token address counts as not typed', async () => {
  await people();
  await R.redzoneCall(db(), ADMIN, { op: 'save', clientId: 'client-abc', clientSecret: SECRET, orgId: 'org 1', enterpriseId: 'ent-2', tokenUrl: 'https://api.rz-ops.com/public/v2/oauth/token', productsPath: '/organizations/{org}/enterprises/{enterprise}/products' });
  const urls = [];
  const fetch = async (url, opts) => {
    urls.push(url);
    const reply = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
    if (url === 'https://api.rz-ops.com/public/v3/oauth/token') return reply(200, { access_token: 'v3_token' });
    if (url === 'https://api.rz-ops.com/public/v2/organizations/org%201/enterprises/ent-2/products?limit=100&offset=0' && opts.headers.Authorization === 'Bearer v3_token') return reply(200, [{ name: 'UD Wildberry', sku: '3934' }]);
    return reply(404, {});
  };
  const r = await R.redzoneCall(db(), ADMIN, { op: 'test' }, { fetch });
  assert.match(r.result.message, /Connected\. RedZone sent 1 product\./);
  assert.deepEqual(urls, ['https://api.rz-ops.com/public/v3/oauth/token', 'https://api.rz-ops.com/public/v2/organizations/org%201/enterprises/ent-2/products?limit=100&offset=0'], 'RedZone\'s lists want limit and offset');
  assert.equal(r.enterpriseId, 'ent-2');
});

// A stand-in for RedZone as its API reference describes it: lists under /organizations/{org}/enterprises/{site namespace},
// { items: [...] }, the organization's events queue, sensors by line.
function fakeRz(opts) {
  const urls = [];
  const fetch = async (url, o) => {
    urls.push([o.method || 'GET', url]);
    const reply = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
    if (/oauth\/token$/.test(url)) return url === opts.tokenUrl ? reply(200, { access_token: opts.token }) : reply(opts.tokenUrl ? 200 : 404, { access_token: 'other_token' });
    if (o.headers.Authorization !== 'Bearer ' + opts.token) return reply(404, { message: 'Not Found' });
    const u = new URL(url), path = u.pathname.replace('/public/v2', '');
    if (path === '/organizations/' + opts.org + '/events') return reply(200, { items: [] });
    const ut = '/organizations/' + opts.org + '/enterprises/' + opts.site;
    // Joe 10/16 (test copy): RedZone refuses a list without offset.
    if (path.startsWith(ut) && !u.searchParams.has('offset')) return reply(400, { message: 'parameter "offset" in query has an error: value is required but missing' });
    const lists = {
      '/locations': [{ uuid: 'loc-g', name: 'GALLON FILLER' }, { uuid: 'loc-b', name: 'BLOW MOLD' }],
      '/assets': [{ uuid: 'a1', name: 'Gallon Filler', modelNumber: 'GF-9' }],
      '/product-types': [{ uuid: 'p1', name: 'UD Wildberry', sku: '3934' }],
      '/locations/loc-g/sensor-configurations': [{ uuid: 's1', name: 'Filler Count' }],
      '/locations/loc-b/sensor-configurations': [{ uuid: 's2', name: 'Head 1 Count' }, { uuid: 's3', name: 'Reject Count' }]
    };
    if (path.startsWith(ut) && lists[path.slice(ut.length)]) return reply(200, { items: lists[path.slice(ut.length)] });
    if (path === ut + '/characteristics') return reply(403, { message: 'Missing permission' });
    if (path.startsWith(ut)) return reply(200, { items: [] });
    return reply(404, { message: 'Not Found' });
  };
  return { fetch, urls };
}

// Joe 10/16: "what everything reads ... what sensors we have available".
test('What RedZone gives us: checks the organization, finds the site namespace (Uniontown first), reads every list; only GETs; administrators only', async () => {
  await people();
  await R.redzoneCall(db(), ADMIN, { op: 'save', clientId: 'client-abc', clientSecret: SECRET, orgId: 'org_mA7', enterpriseId: 'f99e6965-uuid', tokenUrl: 'https://api.rz-ops.com/public/v2/oauth/token' });
  const rz = fakeRz({ tokenUrl: 'https://api.rz-ops.com/public/v3/oauth/token', token: 'rz_bearer', org: 'org_mA7', site: 'uniontown' });
  await assert.rejects(R.redzoneCall(db(), MANAGER, { op: 'discover' }, { fetch: rz.fetch }), /Only an administrator/);
  const r = await R.redzoneCall(db(), ADMIN, { op: 'discover', path: 'labels' }, { fetch: rz.fetch });
  assert.deepEqual(r.discover.used, { org: 'org_mA7', enterprise: 'uniontown', tokenUrl: 'https://api.rz-ops.com/public/v3/oauth/token' });
  assert.deepEqual(r.discover.orgChecks.map(c => [c.org, c.status]), [['org_mA7', 200], ['united-dairy', 404]]);
  const events = rz.urls.find(([, u]) => /\/events/.test(u))[1];
  assert.match(events, /visibility-timeout=0/, 'the events queue is left as it was');
  const sitesTried = rz.urls.filter(([, u]) => /\/enterprises\/[^/]+\/locations\?limit=1&/.test(u)).map(([, u]) => decodeURIComponent(u.split('/enterprises/')[1].split('/')[0]));
  assert.deepEqual(sitesTried, ['f99e6965-uuid', 'uniontown'], 'what was typed first, then Uniontown\'s namespace');
  const by = Object.fromEntries(r.discover.items.map(x => [x.kind, x]));
  assert.deepEqual([by['Lines and areas'].count, by.Machines.examples, by.Products.examples], [2, ['Gallon Filler (modelNumber GF-9)'], ['UD Wildberry (sku 3934)']]);
  assert.deepEqual([by.Sensors.found, by.Sensors.count, by.Sensors.lines, by.Sensors.examples], [true, 3, 2, ['GALLON FILLER: Filler Count', 'BLOW MOLD: Head 1 Count', 'BLOW MOLD: Reject Count']]);
  assert.deepEqual([by['Characteristics (checks and readings)'].status, by['Characteristics (checks and readings)'].note], [403, 'Missing permission']);
  assert.equal(by['Address typed'].path, '/organizations/org_mA7/enterprises/uniontown/labels');
  assert.equal(r.discover.items.length, 17);
  assert.ok(rz.urls.filter(([, u]) => !/oauth/.test(u)).every(([m]) => m === 'GET'), 'only GETs to RedZone');
  assert.ok(rz.urls.filter(([, u]) => /problem-types/.test(u)).every(([, u]) => /limit=20&offset=0/.test(u)), 'problem types 20 at a time');
  assert.ok(rz.urls.filter(([, u]) => /\/assets\?/.test(u)).every(([, u]) => /limit=100&offset=0/.test(u)));
  assert.ok(!JSON.stringify(r).includes(SECRET) && !JSON.stringify(r).includes('rz_bearer'));
  // Kept: the organization, site and sign-in that answered; Test Connection then reads the products from them.
  assert.deepEqual([r.foundOrgId, r.foundEnterpriseId, r.tokenUrl, r.productsPath], ['org_mA7', 'uniontown', 'https://api.rz-ops.com/public/v3/oauth/token', '/organizations/{org}/enterprises/{enterprise}/product-types']);
  assert.equal((await R.redzoneCall(db(), ADMIN, { op: 'status' })).lastDiscover.items.length, 17, 'the screen shows the last list again');
  const t = await R.redzoneCall(db(), ADMIN, { op: 'test' }, { fetch: rz.fetch });
  assert.match(t.result.message, /Connected\. RedZone sent 1 product\./);
  assert.equal(rz.urls[rz.urls.length - 1][1], 'https://api.rz-ops.com/public/v2/organizations/org_mA7/enterprises/uniontown/product-types?limit=100&offset=0');
  // A new site typed is looked for again.
  const again = await R.redzoneCall(db(), ADMIN, { op: 'save', enterpriseId: 'ud-uniontown' });
  assert.deepEqual([again.foundEnterpriseId, again.foundOrgId], ['', '']);
});

test('What RedZone gives us: the organization name and the v2 sign-in are tried too; when nothing answers, every answer is shown', async () => {
  await people();
  await R.redzoneCall(db(), ADMIN, { op: 'save', clientId: 'client-abc', clientSecret: SECRET, orgId: 'org_mA7' });
  const rz = fakeRz({ tokenUrl: 'https://api.rz-ops.com/public/v2/oauth/token', token: 'v2_token', org: 'united-dairy', site: 'united-dairy-uniontown' });
  const r = await R.redzoneCall(db(), ADMIN, { op: 'discover' }, { fetch: rz.fetch });
  assert.deepEqual(r.discover.used, { org: 'united-dairy', enterprise: 'united-dairy-uniontown', tokenUrl: 'https://api.rz-ops.com/public/v2/oauth/token' });
  assert.deepEqual(r.discover.orgChecks.map(c => [c.sign, c.org, c.status]), [['v3', 'org_mA7', 404], ['v3', 'united-dairy', 404], ['v2', 'org_mA7', 404], ['v2', 'united-dairy', 200]]);
  assert.equal(r.discover.items.find(x => x.kind === 'Machines').found, true);
  const nothing = fakeRz({ tokenUrl: 'https://api.rz-ops.com/public/v3/oauth/token', token: 't', org: 'nobody', site: 'nowhere' });
  await R.redzoneCall(db(), ADMIN, { op: 'save', orgId: 'org_mA7' });
  const none = await R.redzoneCall(db(), ADMIN, { op: 'discover' }, { fetch: nothing.fetch });
  assert.deepEqual([none.discover.used, none.discover.items.length], [null, 0]);
  assert.ok(none.discover.probes.length >= 6 && none.discover.probes.every(p => p.status === 404 && p.note === 'Not Found'));
  assert.ok(none.discover.enterprises.includes('uniontown') && none.discover.enterprises.includes('united-dairy-uniontown') && none.discover.enterprises.includes('martinsferry') && none.discover.enterprises.includes('uniteddairyuniontown'));
});

// Joe 10/16 11:44 PM (test copy): the list used "united-dairy" because RedZone answered it 403 "invalid organization", while
// Test Connection had just read 154 products with the saved organization ID. A 403 never picks the organization or site.
test('What RedZone gives us: a 403 "invalid organization" never picks the organization; the saved one is used, as in Test Connection', async () => {
  await people();
  await R.redzoneCall(db(), ADMIN, { op: 'save', clientId: 'client-abc', clientSecret: SECRET, orgId: 'org_mA7', enterpriseId: 'f99e6965' });
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    const reply = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
    if (/oauth\/token$/.test(url)) return reply(200, { access_token: 'v3_token' });
    const u = new URL(url), path = u.pathname.replace('/public/v2', '');
    if (path.startsWith('/organizations/united-dairy/')) return reply(403, { message: 'security requirements failed: invalid organization' });
    if (path === '/organizations/org_mA7/events') return reply(400, { message: 'parameter "visibility-timeout" in query has an error' });
    if (path.startsWith('/organizations/org_mA7/enterprises/f99e6965/')) return u.searchParams.has('offset') ? reply(200, { items: [{ uuid: 'x1', name: 'GALLON FILLER' }] }) : reply(400, { message: 'parameter "offset" in query has an error' });
    return reply(404, { message: 'Not Found' });
  };
  const r = await R.redzoneCall(db(), ADMIN, { op: 'discover' }, { fetch });
  assert.deepEqual([r.discover.used.org, r.discover.used.enterprise], ['org_mA7', 'f99e6965']);
  assert.equal(r.discover.items.find(x => x.kind === 'Lines and areas').count, 1);
  assert.ok(!urls.some(u => /united-dairy\/enterprises/.test(u)), 'the saved organization answered first, so the name is never tried as one');
  assert.equal(r.foundOrgId, 'org_mA7');
});

// Joe 10/16 (test copy): "Why did the test connection fail this time and gave me an error code?" A wrong organization kept
// from an earlier list made Test Connection say RedZone "refused the sign-in (403)". The typed IDs are tried too, and a
// refused list is said as a refused list, with RedZone's own words.
test('Test Connection: a stale organization found earlier falls back to the typed one and is fixed; a refused list is not called a refused sign-in', async () => {
  await people();
  await R.redzoneCall(db(), ADMIN, { op: 'save', clientId: 'client-abc', clientSecret: SECRET, orgId: 'org_mA7', enterpriseId: 'f99e6965' });
  await db().collection('private').doc('redzone').set({ foundOrgId: 'united-dairy', foundEnterpriseId: 'f99e6965', foundTokenUrl: 'https://api.rz-ops.com/public/v3/oauth/token' }, { merge: true });
  const make = (good) => async (url) => {
    const reply = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
    if (/oauth\/token$/.test(url)) return reply(200, { access_token: 'v3_token' });
    const path = new URL(url).pathname.replace('/public/v2', '');
    if (good && path === '/organizations/org_mA7/enterprises/f99e6965/product-types') return reply(200, { items: [{ uuid: 'p1', name: '36% Cream', sku: '294' }] });
    return reply(403, { message: 'security requirements failed: invalid organization' });
  };
  const bad = await R.redzoneCall(db(), ADMIN, { op: 'test' }, { fetch: make(false) });
  assert.equal(bad.result.ok, false);
  assert.match(bad.result.message, /^Signed in, but RedZone said no to the product list \(403 security requirements failed: invalid organization\)\. Press Show What RedZone Gives Us/);
  assert.doesNotMatch(bad.result.message, /refused the sign-in/);
  const ok = await R.redzoneCall(db(), ADMIN, { op: 'test' }, { fetch: make(true) });
  assert.match(ok.result.message, /Connected\. RedZone sent 1 product\./);
  assert.equal((await R.redzoneCall(db(), ADMIN, { op: 'status' })).foundOrgId, 'org_mA7', 'the organization that answered is kept');
});

// Joe 10/16: "build everything complete". Read RedZone into Operations: its lines with their sensor names, machines,
// products, latest runs, problem types (paged 20 at a time) and check sheets go to redzoneData; only GETs.
test('Read RedZone into Operations: lines, sensors, products, runs, problem types and check sheets, matched to our lines; only GETs', async () => {
  await people();
  await R.redzoneCall(db(), ADMIN, { op: 'save', clientId: 'client-abc', clientSecret: SECRET, orgId: 'org_mA7', enterpriseId: 'f99e' });
  const setup = (id, name) => db().collection('plantSetup').doc(id).set({ operationId: id, type: 'PRODUCTION_AREA', status: 'ACTIVE', name, facilityId: 'fac_uniontown' });
  await setup('ut_prod_blow_mold', 'BLOW MOLD'); await setup('ut_prod_raypak', 'RAYPAK'); await setup('ut_prod_gallon_filler', 'GALLON FILLER'); await setup('ut_prod_boxing', 'BOXING');
  // Line Targets picked no RedZone line for the Gallon Filler.
  await db().collection('productionLines').doc('ut_prod_gallon_filler').set({ operationId: 'ut_prod_gallon_filler', redzoneLocation: 'NONE' });
  const pre = '/organizations/org_mA7/enterprises/f99e', urls = [];
  const problems = Array.from({ length: 25 }, (_, i) => ({ uuid: 'pr' + i, name: 'Problem ' + i, problemCategory: 'AVAILABILITY', assetTypeUUID: i < 3 ? 'at-blow' : i < 5 ? 'at-bag' : '' }));
  const lists = {
    '/locations': [{ uuid: 'loc-bm', name: 'Blow Mold' }, { uuid: 'loc-dq', name: 'Dairy Queen' }, { uuid: 'loc-dqm', name: 'Dairy Queen Manual' }, { uuid: 'loc-g', name: 'Gallon' }],
    '/locations/loc-bm/sensor-configurations': [{ uuid: 's1', name: 'Default' }],
    '/locations/loc-dqm/sensor-configurations': [{ uuid: 's2', name: 'In=out' }, { uuid: 's3', name: 'Box' }],
    '/assets': [{ uuid: 'a1', name: 'Blow Molder', locationUUID: 'loc-bm', assetTypeUUID: 'at-blow' }, { uuid: 'a2', name: 'Bag Sealer', locationUUID: 'loc-dq', assetTypeUUID: 'at-bag' }],
    '/asset-types': [{ uuid: 'at-blow', name: 'Depositer /Extruder' }, { uuid: 'at-bag', name: 'Bag Sealer' }],
    '/product-types': [{ uuid: 'p1', name: 'Gallon Jug', externalId: '9001', standardRatePerMin: 50, target: 85, targetCrewSize: 2 }, { uuid: 'p2', name: '5 Gal Bag Mix', externalId: '777', standardRatePerMin: 8, target: 90, targetCrewSize: 1 }],
    '/runs': [{ uuid: 'r1', locationUUID: 'loc-bm', productTypeUUID: 'p1', startTime: '2026-10-15T10:39:24Z', endTime: '', plannedQuantity: 20000, standardRatePerMin: 50, crewSize: 2 },
      { uuid: 'r2', locationUUID: 'loc-dq', productTypeUUID: 'p2', startTime: '2026-10-15T23:42:21Z', endTime: '2026-10-16T01:00:00Z', plannedQuantity: 400, standardRatePerMin: 8, crewSize: 1 }],
    '/data-sheet-templates': [{ uuid: 'd1', name: 'OPS - Weight Sheet', dataSheetType: 'QUALITY_CHECK' }, { uuid: 'd2', name: 'GMP Audit', dataSheetType: 'AUDIT' }, { uuid: 'd3', name: 'Something New', dataSheetType: 'PRODUCTION_CHECK' }]
  };
  const fetch = async (url, opts) => {
    urls.push([opts.method || 'GET', url]);
    const reply = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
    if (/oauth\/token$/.test(url)) return reply(200, { access_token: 'v3_token' });
    const u = new URL(url), path = u.pathname.replace('/public/v2', '');
    if (!path.startsWith(pre)) return reply(403, { message: 'security requirements failed: invalid organization' });
    if (!u.searchParams.has('offset')) return reply(400, { message: 'parameter "offset" in query has an error' });
    const rest = path.slice(pre.length), off = Number(u.searchParams.get('offset')), lim = Number(u.searchParams.get('limit'));
    if (rest === '/problem-types') return lim > 20 ? reply(400, { message: 'limit too big' }) : reply(200, { items: problems.slice(off, off + lim) });
    if (rest === '/shift-types') return reply(500, {});
    return reply(200, { items: (lists[rest] || []).slice(off, off + lim) });
  };
  await assert.rejects(R.redzoneCall(db(), MANAGER, { op: 'sync' }, { fetch }), /Only an administrator/);
  const r = await R.redzoneCall(db(), ADMIN, { op: 'sync' }, { fetch });
  assert.deepEqual([r.sync.lines, r.sync.sensors, r.sync.machines, r.sync.products, r.sync.runs, r.sync.problems, r.sync.checkSheets, r.sync.failed], [4, 3, 2, 2, 2, 25, 3, []]);
  assert.deepEqual(r.sync.matches.map(m => [m.redzone, m.sensors.join('/'), m.line]), [['Blow Mold', 'Default', 'BLOW MOLD'], ['Dairy Queen', '', 'RAYPAK'], ['Dairy Queen Manual', 'In=out/Box', 'BOXING'], ['Gallon', '', '']]);
  const saved = (await db().collection('redzoneData').doc('fac_uniontown').get()).data();
  assert.deepEqual(saved.products[0], { uuid: 'p1', name: 'Gallon Jug', sku: '9001', ratePerMin: 50, target: 85, crew: 2, perManHour: null });
  assert.equal(saved.runs[0].productTypeUUID, 'p2', 'newest run first');
  assert.deepEqual(saved.checkSheets.map(c => [c.name, c.ours]), [['OPS - Weight Sheet', 'Fill weight check on the Line Tablet, and Quality Checks package weight'], ['GMP Audit', 'Manager Walkthrough'], ['Something New', '']]);
  assert.ok(urls.filter(([, u]) => /problem-types/.test(u)).every(([, u]) => /limit=20&/.test(u)), 'problem types 20 at a time');
  assert.ok(urls.filter(([, u]) => !/oauth/.test(u)).every(([m]) => m === 'GET'), 'only GETs to RedZone');
  assert.ok(!JSON.stringify(saved).includes('v3_token') && !JSON.stringify(r).includes(SECRET));
  assert.equal((await R.redzoneCall(db(), ADMIN, { op: 'status' })).lastSync.products, 2);
  // Without the organization and site, it says what to press first.
  await R.redzoneCall(db(), ADMIN, { op: 'save', clientId: 'client-abc', clientSecret: SECRET });
  await db().collection('private').doc('redzone').update({ orgId: '', enterpriseId: '' });
  await assert.rejects(R.redzoneCall(db(), ADMIN, { op: 'sync' }, { fetch }), /Show What RedZone Gives Us first/);
});
