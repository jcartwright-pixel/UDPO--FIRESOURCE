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
