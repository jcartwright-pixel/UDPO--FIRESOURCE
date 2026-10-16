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

// Joe 10/16 (RedZone support): POST https://api.rz-ops.com/public/v2/oauth/token with the client ID and secret; the API is under
// https://api.rz-ops.com/public/v2. Only the client ID and secret are typed.
test('RedZone\'s own addresses are filled in; the client ID and secret alone sign in, sent as JSON when the form is refused', async () => {
  await people();
  const fresh = await R.redzoneCall(db(), ADMIN, { op: 'status' });
  assert.deepEqual([fresh.address, fresh.tokenUrl], ['https://api.rz-ops.com/public/v2', 'https://api.rz-ops.com/public/v2/oauth/token']);
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
    ['https://api.rz-ops.com/public/v2/oauth/token', 'application/x-www-form-urlencoded'],
    ['https://api.rz-ops.com/public/v2/oauth/token', 'application/json'],
    ['https://api.rz-ops.com/public/v2/products', '']
  ]);
  assert.equal(calls[2].auth, 'Bearer rz_bearer');
  assert.ok(!JSON.stringify(r).includes(SECRET) && !JSON.stringify(r).includes('rz_bearer'));
  // A wrong secret is a plain FAILED.
  await R.redzoneCall(db(), ADMIN, { op: 'save', clientSecret: 'wrong' });
  const bad = await R.redzoneCall(db(), ADMIN, { op: 'test' }, { fetch });
  assert.equal(bad.result.ok, false);
  assert.match(bad.result.message, /refused the sign-in \(401\)/);
});

// Boomi's RedZone connector names .../public/v3/oauth/token, and puts the organization and enterprise IDs in the address.
test('a 404 at the v2 token address tries v3; {org} and {enterprise} in the products address are filled in', async () => {
  await people();
  await R.redzoneCall(db(), ADMIN, { op: 'save', clientId: 'client-abc', clientSecret: SECRET, orgId: 'org 1', enterpriseId: 'ent-2', productsPath: '/organizations/{org}/enterprises/{enterprise}/products' });
  const urls = [];
  const fetch = async (url, opts) => {
    urls.push(url);
    const reply = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
    if (url === 'https://api.rz-ops.com/public/v3/oauth/token') return reply(200, { access_token: 'v3_token' });
    if (url === 'https://api.rz-ops.com/public/v2/organizations/org%201/enterprises/ent-2/products' && opts.headers.Authorization === 'Bearer v3_token') return reply(200, [{ name: 'UD Wildberry', sku: '3934' }]);
    return reply(404, {});
  };
  const r = await R.redzoneCall(db(), ADMIN, { op: 'test' }, { fetch });
  assert.equal(r.result.ok, true);
  assert.match(r.result.message, /Connected\. RedZone sent 1 product\./);
  assert.deepEqual(urls, ['https://api.rz-ops.com/public/v2/oauth/token', 'https://api.rz-ops.com/public/v3/oauth/token', 'https://api.rz-ops.com/public/v2/organizations/org%201/enterprises/ent-2/products']);
  assert.equal(r.enterpriseId, 'ent-2');
});

// Joe 10/16: "what everything reads ... what sensors we have available".
test('What RedZone gives us: each kind tried plain and under the organization; counts, fields and examples; only GETs; administrators only', async () => {
  await people();
  await R.redzoneCall(db(), ADMIN, { op: 'save', clientId: 'client-abc', clientSecret: SECRET, orgId: 'org1' });
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push([opts.method || 'GET', url]);
    const reply = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
    if (/oauth\/token$/.test(url)) return reply(200, { access_token: 'rz_bearer' });
    const path = url.replace('https://api.rz-ops.com/public/v2', '').replace(/\?.*$/, '');
    if (path === '/organizations/org1/data-points') return reply(200, { data: [{ id: 7, name: 'Gallon Filler Count', locationName: 'GALLON FILLER', lastValue: 1234, unit: 'jugs' }, { id: 8, name: 'Blow Mold Temp', lastValue: 212, unit: 'F' }], total: 46 });
    if (path === '/locations') return reply(200, [{ name: 'GALLON FILLER', type: 'Line' }]);
    if (path === '/runs') return reply(403, {});
    return reply(404, {});
  };
  await assert.rejects(R.redzoneCall(db(), MANAGER, { op: 'discover' }, { fetch }), /Only an administrator/);
  const r = await R.redzoneCall(db(), ADMIN, { op: 'discover', path: '/my-extra' }, { fetch });
  const by = Object.fromEntries(r.discover.items.map(x => [x.kind, x]));
  assert.deepEqual([by['Sensors and data points'].found, by['Sensors and data points'].count, by['Sensors and data points'].path], [true, 46, '/organizations/org1/data-points']);
  assert.deepEqual(by['Sensors and data points'].fields, ['id', 'name', 'locationName', 'lastValue', 'unit']);
  assert.deepEqual(by['Sensors and data points'].examples, ['Gallon Filler Count (lastValue 1234, unit jugs, locationName GALLON FILLER)', 'Blow Mold Temp (lastValue 212, unit F)']);
  assert.deepEqual([by['Lines and areas'].found, by['Lines and areas'].count, by['Lines and areas'].examples], [true, 1, ['GALLON FILLER (type Line)']]);
  assert.deepEqual([by.Runs.found, by.Runs.status], [false, 403], 'there but not allowed says more than not found');
  assert.deepEqual([by.Shifts.found, by.Shifts.status], [false, 404]);
  assert.equal(by['Address typed'].path, '/my-extra');
  assert.ok(calls.filter(c => !/oauth/.test(c[1])).every(c => c[0] === 'GET'), 'only GETs to RedZone');
  assert.ok(calls.every(c => c[1].startsWith('https://api.rz-ops.com/')));
  const saved = (await db().collection('private').doc('redzone').get()).data().lastDiscover;
  assert.equal(saved.items.length, 10);
  assert.equal((await R.redzoneCall(db(), ADMIN, { op: 'status' })).lastDiscover.items.length, 10, 'the screen shows the last list again');
  assert.ok(!JSON.stringify(r).includes(SECRET) && !JSON.stringify(r).includes('rz_bearer'));
});

// Joe 10/16: RedZone's Organization IDs list the organization and three sites, no enterprise. Enterprise ID stays blank.
test('What RedZone gives us with no Enterprise ID: kinds not found are tried again under Uniontown\'s site from the sites list', async () => {
  await people();
  await R.redzoneCall(db(), ADMIN, { op: 'save', clientId: 'client-abc', clientSecret: SECRET, orgId: 'org_mA7' });
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    const reply = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
    if (/oauth\/token$/.test(url)) return reply(200, { access_token: 'rz_bearer' });
    const path = url.replace('https://api.rz-ops.com/public/v2', '').replace(/\?.*$/, '');
    if (path === '/organizations/org_mA7/sites') return reply(200, { items: [{ id: 'c-332a', name: 'Charleston' }, { id: 'u-f99e', name: 'Uniontown' }] });
    if (path === '/organizations/org_mA7/sites/u-f99e/data-points') return reply(200, [{ name: 'Gallon Filler Count', lastValue: 5, unit: 'jugs' }]);
    return reply(404, {});
  };
  const r = await R.redzoneCall(db(), ADMIN, { op: 'discover' }, { fetch });
  const by = Object.fromEntries(r.discover.items.map(x => [x.kind, x]));
  assert.deepEqual([by.Sites.found, by.Sites.count, by.Sites.examples], [true, 2, ['Charleston', 'Uniontown']]);
  assert.deepEqual([by['Sensors and data points'].found, by['Sensors and data points'].path], [true, '/organizations/org_mA7/sites/u-f99e/data-points']);
  assert.equal(by.Products.found, false);
  assert.deepEqual(urls.filter(u => /enterprises\/[^/?]+\//.test(u)).map(u => u.replace(/\?.*$/, '')), [
    'https://api.rz-ops.com/public/v2/organizations/org_mA7/enterprises/u-f99e/asset-types',
    'https://api.rz-ops.com/public/v2/organizations/org_mA7/enterprises/c-332a/asset-types'
  ], 'each listed site is tried once as the enterprise, Uniontown first; none answered, so the kinds are tried the old ways');
  assert.equal(r.discover.used, null);
  assert.ok(!('list' in by.Sites), 'the raw lists are not kept');
});

// Joe 10/16 (RedZone's API reference): GET https://api.rz-ops.com/public/v2/organizations/{organizationId}/enterprises/{enterpriseId}/asset-types.
// The sites RedZone lists are its enterprises; the first one that answers is used for every kind and kept for the products.
test('What RedZone gives us finds the site (enterprise) by itself, lists every kind under it, and Products then reads from it', async () => {
  await people();
  await R.redzoneCall(db(), ADMIN, { op: 'save', clientId: 'client-abc', clientSecret: SECRET, orgId: 'org_mA7', productsPath: '/products' });
  const b64 = (x) => Buffer.from(JSON.stringify(x)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = b64({ alg: 'none' }) + '.' + b64({ sub: 'client-abc@clients', azp: 'client-abc', org_id: 'org_mA7', org_name: 'united-dairy' }) + '.sig';
  const urls = [];
  const fetch = async (url, opts) => {
    urls.push([opts.method || 'GET', url]);
    const reply = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
    if (/oauth\/token$/.test(url)) return reply(200, { access_token: jwt });
    if (opts.headers.Authorization !== 'Bearer ' + jwt) return reply(401, {});
    const path = url.replace('https://api.rz-ops.com/public/v2', '').replace(/\?.*$/, '');
    const UT = '/organizations/org_mA7/enterprises/f99e6965';
    if (path === '/organizations/org_mA7/enterprises') return reply(200, { data: [{ id: '332a2f5f', name: 'Charleston' }, { id: 'f99e6965', name: 'Uniontown' }, { id: '81f6e61a', name: "Martin's Ferry" }] });
    if (path === UT + '/asset-types') return reply(200, { data: [{ id: 'at1', name: 'Filler' }] });
    if (path === UT + '/assets') return reply(200, { data: [{ id: 'a1', name: 'Gallon Filler', status: 'Running' }, { id: 'a2', name: 'Blow Mold' }], total: 12 });
    if (path === UT + '/locations') return reply(200, [{ name: 'GALLON FILLER', type: 'Line' }]);
    if (path === UT + '/products') return reply(200, { data: [{ name: 'UD Wildberry', sku: '3934' }] });
    if (path === UT + '/characteristics') return reply(403, { message: 'Missing permission' });
    return reply(404, { message: 'Not Found' });
  };
  const r = await R.redzoneCall(db(), ADMIN, { op: 'discover' }, { fetch });
  assert.deepEqual(r.discover.used, { org: 'org_mA7', enterprise: 'f99e6965', name: 'Uniontown' }, 'Uniontown first');
  const by = Object.fromEntries(r.discover.items.map(x => [x.kind, x]));
  assert.deepEqual([by.Machines.found, by.Machines.count, by.Machines.path, by.Machines.examples], [true, 12, '/organizations/org_mA7/enterprises/f99e6965/assets', ['Gallon Filler (status Running)', 'Blow Mold']]);
  assert.deepEqual([by['Lines and areas'].found, by.Products.found, by.Sites.count], [true, true, 3]);
  assert.deepEqual([by['Sensors and data points'].status, by['Sensors and data points'].note], [403, 'Missing permission'], 'RedZone\'s own words on a refusal');
  assert.deepEqual([by.Shifts.found, by.Shifts.path], [false, '/organizations/org_mA7/enterprises/f99e6965/shifts']);
  assert.ok(urls.every(([m, u]) => m === 'GET' || /oauth\/token$/.test(u)), 'only GETs');
  assert.ok(!urls.some(([, u]) => /enterprises\/(332a2f5f|81f6e61a)/.test(u)), 'the other sites are not asked once Uniontown answers');
  assert.deepEqual(r.discover.claims, ['org_id org_mA7', 'org_name united-dairy'], 'the sign-in\'s organization names, never the client');
  assert.ok(!JSON.stringify(r).includes(jwt) && !JSON.stringify(r).includes('client-abc') && !JSON.stringify(r).includes(SECRET));
  // The site that answered is kept: the products address is now under it, with nothing typed.
  assert.deepEqual([r.foundEnterpriseId, r.foundEnterpriseName, r.productsPath], ['f99e6965', 'Uniontown', '/organizations/{org}/enterprises/{enterprise}/products']);
  const t = await R.redzoneCall(db(), ADMIN, { op: 'test' }, { fetch });
  assert.match(t.result.message, /Connected\. RedZone sent 1 product\./);
  assert.equal(urls[urls.length - 1][1], 'https://api.rz-ops.com/public/v2/organizations/org_mA7/enterprises/f99e6965/products');
});
