/*
 * RedZone, read only (Joe 10/11: "tap into that right now the API"). RedZone's REST API is "secured with OAuth" and its
 * reference is in the Developer Hub behind a RedZone sign-in, so the exact addresses are not known from outside. This takes
 * either a ready API token, or a client ID and secret traded for a token at RedZone's token address (OAuth client credentials),
 * and reads the products from an address an administrator can change. The answer's shape is read loosely (a list, or a list
 * under data / items / results / products, with a next page link) so it works with whatever the Developer Hub shows.
 *
 * Administration > Connections & Keys > RedZone (redzone.html, through redzoneCall below) saves them in private/redzone, which
 * no screen can read (firestore.rules); the screen only learns the last 4 characters, who saved them and when. Nothing is
 * logged or sent back. config/redzone (readable) says whether the last Test Connection passed, so Products can offer
 * "Get from RedZone". Nothing is ever written to RedZone.
 *
 * Joe 10/16 (RedZone support): the client ID and secret are made in RedZone (Manage Access > Roles, then Organization Settings >
 * Client Applications) and traded for a bearer token at POST https://api.rz-ops.com/public/v2/oauth/token; the API is under
 * https://api.rz-ops.com/public/v2. Those are the defaults, so only the client ID and secret need typing.
 */
'use strict';

const { safeIdPart } = require('./model');
const L = require('./logic');

class RedzoneError extends Error { constructor(code, message) { super(message); this.code = code; } }

const DEFAULTS = { productsPath: '/products', address: 'https://api.rz-ops.com/public/v2', tokenUrl: 'https://api.rz-ops.com/public/v2/oauth/token' };
const TOKEN_V3 = 'https://api.rz-ops.com/public/v3/oauth/token';
const addressOf = (d) => d.address || DEFAULTS.address, tokenUrlOf = (d) => d.tokenUrl || DEFAULTS.tokenUrl;
const PAGE_LIMIT = 40, PRODUCT_LIMIT = 4000;
const flat = (k) => String(k).replace(/[_\-\s]/g, '').toLowerCase();
const clean = (v, n) => String(v === undefined || v === null ? '' : v).trim().slice(0, n);
const ends = (v) => { const t = String(v || ''); return t ? t.slice(-4) : ''; };

// A plain value under one of the names, on the record itself (not deep: "type" is also inside nested objects).
function field(obj, names) {
  if (!obj || typeof obj !== 'object') return undefined;
  const want = names.map(flat);
  for (const [k, v] of Object.entries(obj)) if (want.includes(flat(k)) && v !== null && v !== undefined && v !== '') return v;
  return undefined;
}
const text = (v) => {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join(', ');
  if (typeof v === 'object') return text(field(v, ['name', 'displayName', 'label', 'title', 'description', 'value']));
  return String(v).trim();
};

// The list in an answer: the answer itself, or the first list under a usual name (one level down too: {data: {items: []}}).
function listIn(body) {
  if (Array.isArray(body)) return body;
  for (const holder of [body, body && body.data, body && body.result]) {
    if (Array.isArray(holder)) return holder;
    const v = field(holder, ['data', 'items', 'results', 'products', 'records', 'content', 'rows', 'value']);
    if (Array.isArray(v)) return v;
  }
  return null;
}
function nextIn(body) {
  if (!body || Array.isArray(body)) return '';
  const links = body.links || body._links || body.paging || body.pagination || body.meta || {};
  const n = field(body, ['next', 'nextPage', 'nextLink', 'nextUrl', '@odata.nextLink']) || field(links, ['next', 'nextPage', 'nextLink', 'nextUrl']);
  return typeof n === 'string' ? n : n && typeof n === 'object' ? String(n.href || '') : '';
}

// A RedZone product -> {name, sku, mfgType, productGroup, site, active}.
function normalize(p) {
  const active = field(p, ['active', 'isActive', 'enabled', 'status']);
  return {
    name: text(field(p, ['name', 'productName', 'displayName', 'description', 'title'])).slice(0, 120),
    sku: text(field(p, ['sku', 'productCode', 'code', 'itemNumber', 'partNumber', 'externalId'])).slice(0, 60),
    mfgType: text(field(p, ['mfgType', 'manufacturingType', 'manufacturingTypeName', 'mfgTypeName'])).slice(0, 60),
    productGroup: text(field(p, ['productGroups', 'productGroup', 'groups', 'group', 'productGroupNames'])).slice(0, 120),
    site: text(field(p, ['site', 'siteName', 'location', 'locationName', 'plant', 'plantName', 'facility'])).slice(0, 80),
    active: active === undefined ? true : !(active === false || /^(false|inactive|archived|disabled|0)$/i.test(String(active)))
  };
}

// RedZone's addresses can carry the organization ID ({org} in an address is replaced with it).
// Boomi's RedZone connector: the organization and enterprise IDs go in the address ({enterprise} is replaced with the enterprise ID).
const withOrg = (v, org, ent) => String(v || '').replace(/\{(org|organizationId|orgId)\}/gi, encodeURIComponent(org || '')).replace(/\{(enterprise|enterpriseId)\}/gi, encodeURIComponent(ent || ''));
function urlFor(address, path) {
  if (/^https:\/\//i.test(path)) return path;
  return String(address).replace(/\/+$/, '') + '/' + String(path || '').replace(/^\/+/, '');
}
// Only https addresses on the saved RedZone host (a "next" link elsewhere is not followed, so the token goes nowhere else).
function sameHost(url, address) { try { return new URL(url).host === new URL(address).host && /^https:$/.test(new URL(url).protocol); } catch (e) { return false; } }

// The bearer token: the saved token, else one traded for the client ID and secret (kept until a minute before it runs out).
async function accessToken(d, o, ref) {
  if (d.token) return d.token;
  if (!d.clientId || !d.clientSecret) throw new RedzoneError('BAD_REQUEST', 'Save the client ID and client secret from RedZone first.');
  const tokenUrl = tokenUrlOf(d);
  const now = o.now().getTime();
  if (d.access && d.access.token && d.access.until > now + 60000) return d.access.token;
  const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: d.clientId, client_secret: d.clientSecret });
  if (d.scope) form.set('scope', d.scope);
  // Joe 10/11 (RedZone's "REST API IDs and Secrets"): a token is made with the organization ID plus the client ID and secret.
  if (d.orgId && !/\{(org|organizationId|orgId)\}/i.test(tokenUrl)) form.set('organization_id', d.orgId);
  const ask = async (url) => {
    let r = await o.fetch(withOrg(url, d.orgId, d.enterpriseId), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json',
      Authorization: 'Basic ' + Buffer.from(d.clientId + ':' + d.clientSecret).toString('base64') }, body: form.toString() });
    // RedZone support: "send your client_id and client_secret". An address that wants them as JSON says 400 or 415 to a form.
    if (r.status === 400 || r.status === 415) {
      const body = { grant_type: 'client_credentials', client_id: d.clientId, client_secret: d.clientSecret };
      if (d.scope) body.scope = d.scope;
      if (d.orgId) body.organization_id = d.orgId;
      r = await o.fetch(withOrg(url, d.orgId, d.enterpriseId), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    }
    return r;
  };
  let res = await ask(tokenUrl);
  // Support named .../public/v2/oauth/token; Boomi's RedZone connector uses .../public/v3/oauth/token. With the default
  // address, a 404 there tries the other one.
  if ((res.status === 404 || res.status === 405) && tokenUrl === DEFAULTS.tokenUrl) res = await ask(TOKEN_V3);
  // The answer is never shown whole: it could echo the secret.
  if (!res.ok) throw new Error('RedZone answered ' + res.status + ' at the token address');
  let json; try { json = JSON.parse(await res.text()); } catch (e) { throw new Error('RedZone\'s token address sent something that is not JSON'); }
  const token = json && (json.access_token || json.accessToken || json.token);
  if (!token) throw new Error('RedZone\'s token address sent no access token');
  const until = now + (Number(json.expires_in || json.expiresIn) || 3600) * 1000;
  if (ref) await ref.set({ access: { token, until } }, { merge: true });
  return token;
}

// Every product, following next-page links on the same host.
async function fetchProducts(d, o, ref) {
  const token = await accessToken(d, o, ref), out = [], address = withOrg(addressOf(d), d.orgId, d.enterpriseId);
  let url = urlFor(address, withOrg(d.productsPath || DEFAULTS.productsPath, d.orgId, d.enterpriseId));
  for (let page = 0; url && page < PAGE_LIMIT && out.length < PRODUCT_LIMIT; page++) {
    if (!sameHost(url, address)) throw new Error('The products address must be https on the same RedZone address');
    const res = await o.fetch(url, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
    if (!res.ok) throw new Error('RedZone answered ' + res.status + ' for the products address');
    let body; try { body = JSON.parse(await res.text()); } catch (e) { throw new Error('RedZone sent something that is not JSON for the products address'); }
    const list = listIn(body);
    if (!list) throw new Error('RedZone\'s answer has no product list in it');
    list.forEach(p => { const n = normalize(p); if (n.name) out.push(n); });
    const next = nextIn(body);
    url = next ? urlFor(address, next) : '';
  }
  return out;
}
/* ---------- What RedZone gives us (Joe 10/16) ----------
 * "Will you be able to tell me what everything reads ... what sensors we have available": with the sign-in working, ask
 * RedZone's API for each kind of thing it may hold and list what comes back: how many, the address, the fields each one has
 * and a few examples (name, latest value and unit where RedZone sends them). Only GETs; nothing is ever written to RedZone.
 * RedZone's own address list is in its Developer Hub (not reachable from outside), so the usual names are tried, plain and
 * under the organization (and enterprise) the way Boomi's RedZone connector builds its addresses; an administrator can also
 * type one address to try. */
const KINDS = [
  ['Lines and areas', ['locations', 'areas', 'lines', 'production-lines', 'places']],
  ['Machines', ['assets', 'machines', 'equipment']],
  ['Sensors and data points', ['data-points', 'datapoints', 'sensors', 'tags', 'signals', 'counters']],
  ['Products', ['products']],
  ['Runs', ['runs', 'production-runs']],
  ['Downtime', ['losses', 'downtime', 'downtime-events', 'problem-types']],
  ['Shifts', ['shifts', 'shift-types']],
  ['Sites', ['sites', 'enterprises']]
];
const SHOW = ['value', 'lastValue', 'latestValue', 'currentValue', 'unit', 'units', 'uom', 'type', 'status', 'location', 'locationName', 'asset', 'assetName'];
function sample(item) {
  // In this order of preference (field() alone takes whichever comes first in the record).
  const name = ['name', 'displayName', 'title', 'label', 'description', 'code', 'id'].map(k => text(field(item, [k]))).find(Boolean) || '';
  const more = SHOW.map(k => [k, field(item, [k])]).filter(([, v]) => v !== undefined && typeof v !== 'object').map(([k, v]) => k + ' ' + clean(v, 40));
  return clean(name, 80) + (more.length ? ' (' + more.join(', ') + ')' : '');
}
async function getList(url, token, o) {
  let res;
  try { res = await o.fetch(url, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } }); } catch (e) { return { status: 0 }; }
  if (!res.ok) return { status: res.status };
  let body; try { body = JSON.parse(await res.text()); } catch (e) { return { status: res.status, note: 'not JSON' }; }
  const list = listIn(body);
  return list ? { status: res.status, list, total: Number(field(body, ['total', 'totalCount', 'count'])) || list.length } : { status: res.status, note: 'no list in the answer' };
}
async function discover(d, o, ref, extra) {
  const token = await accessToken(d, o, ref), address = withOrg(addressOf(d), d.orgId, d.enterpriseId);
  const prefixes = [''].concat(d.orgId ? ['/organizations/{org}'] : []).concat(d.orgId && d.enterpriseId ? ['/organizations/{org}/enterprises/{enterprise}'] : []);
  const one = async (kind, paths) => {
    let best = null;
    for (const p of paths) for (const pre of p.startsWith('/') ? [''] : prefixes) {
      const path = withOrg(pre + '/' + p.replace(/^\/+/, ''), d.orgId, d.enterpriseId), url = urlFor(address, path) + (path.includes('?') ? '&' : '?') + 'limit=50';
      if (!sameHost(url, address)) continue;
      const got = await getList(url, token, o);
      if (got.list) {
        const first = got.list.find(x => x && typeof x === 'object') || {};
        return { kind, found: true, path, count: got.total, fields: Object.keys(first).slice(0, 30), examples: got.list.slice(0, 5).map(sample) };
      }
      // 403 (there but not allowed) says more than 404 (not there).
      if (!best || (got.status === 403 && best.status !== 403)) best = { kind, found: false, path, status: got.status, note: got.note || '' };
    }
    return best;
  };
  const kinds = KINDS.map(([k, p]) => one(k, p));
  if (extra) kinds.push(one('Address typed', [clean(extra, 300).startsWith('/') ? clean(extra, 300) : '/' + clean(extra, 300)]));
  return (await Promise.all(kinds)).filter(Boolean);
}

const plain = (e) => /answered 40[13]/.test(e.message) ? 'RedZone refused the sign-in (' + e.message.replace(/^RedZone answered (\d+).*/, '$1') + '). Check the client ID and secret, and that the role has the read permissions on.'
  : /answered 404/.test(e.message) ? 'RedZone has no page at that address (404). Check the API address and products address from the Developer Hub.'
  : 'Could not read RedZone: ' + e.message;

const view = (d) => ({ orgId: d.orgId || '', enterpriseId: d.enterpriseId || '', address: addressOf(d), tokenUrl: tokenUrlOf(d), productsPath: d.productsPath || DEFAULTS.productsPath, scope: d.scope || '',
  hasToken: !!d.token, tokenEnds: ends(d.token), hasClient: !!d.clientId, clientEnds: ends(d.clientId), hasSecret: !!d.clientSecret,
  savedAt: d.savedAt || '', savedBy: d.savedBy || '', lastTest: d.lastTest || null, lastDiscover: d.lastDiscover || null });

/* input.op: status | discover {path} | save {orgId, enterpriseId, address, tokenUrl, productsPath, scope, token, clientId, clientSecret} | clear | test | products {facilityId} */
async function redzoneCall(db, user, input, options) {
  input = input || {};
  const o = Object.assign({ fetch: (...a) => fetch(...a), now: () => new Date() }, options || {});
  const email = String(user && user.email || '').toLowerCase();
  const person = (await db.collection('users').doc(safeIdPart(email)).get()).data();
  const op = String(input.op || 'status');
  if (!person || person.status !== 'ACTIVE') throw new RedzoneError('NOT_ALLOWED', 'Sign in with an active account first');
  // Get from RedZone on Products is for whoever changes the product lists; the connection itself is administrators only.
  if (op === 'products' ? !L.hasRole(person, L.REORDER_ROLES) : !L.isAdmin(person)) throw new RedzoneError('NOT_ALLOWED', op === 'products' ? 'Only a manager or administrator can load products from RedZone' : 'Only an administrator can change the RedZone connection');
  const ref = db.collection('private').doc('redzone'), status = db.collection('config').doc('redzone');
  const d = (await ref.get()).data() || {}, at = o.now().toISOString();
  if (op === 'status') return view(d);
  if (op === 'save') {
    const next = Object.assign({}, d);
    const address = clean(input.address, 300), tokenUrl = clean(input.tokenUrl, 300);
    [['address', address], ['tokenUrl', tokenUrl]].forEach(([k, v]) => { if (v && !/^https:\/\/[^\s/]+/i.test(v)) throw new RedzoneError('BAD_REQUEST', 'The ' + (k === 'address' ? 'API address' : 'token address') + ' must start with https://'); });
    if (address) next.address = address.replace(/\/+$/, '');
    if (tokenUrl) next.tokenUrl = tokenUrl;
    if (input.productsPath !== undefined && clean(input.productsPath, 300)) next.productsPath = clean(input.productsPath, 300);
    if (input.scope !== undefined) next.scope = clean(input.scope, 200);
    const org = clean(input.orgId, 120), ent = clean(input.enterpriseId, 120);
    if (org) next.orgId = org;
    if (ent) next.enterpriseId = ent;
    const token = clean(input.token, 4000), id = clean(input.clientId, 300), secret = clean(input.clientSecret, 600);
    if (token) next.token = token;
    if (id) next.clientId = id;
    if (secret) next.clientSecret = secret;
    if (![address, tokenUrl, token, id, secret, org, ent, clean(input.productsPath, 300)].some(Boolean) && input.scope === undefined) throw new RedzoneError('BAD_REQUEST', 'Type something to save first.');
    delete next.access;
    Object.assign(next, { savedAt: at, savedBy: email, lastTest: null });
    await ref.set(next);
    await status.set({ configured: false, message: 'New settings saved; press Test Connection.', at }, { merge: true });
    return view(next);
  }
  if (op === 'clear') {
    const next = { orgId: d.orgId || '', enterpriseId: d.enterpriseId || '', address: d.address || '', tokenUrl: d.tokenUrl || '', productsPath: d.productsPath || '', scope: d.scope || '', savedAt: at, savedBy: email, lastTest: null };
    await ref.set(next);
    await status.set({ configured: false, message: 'No RedZone sign-in saved.', at }, { merge: true });
    return view(next);
  }
  if (op === 'test') {
    let result;
    try {
      // The sign-in first: a client ID and secret RedZone takes are a pass even before the products address is right.
      const signedIn = !d.token && !!(await accessToken(d, o, ref)), fresh = (await ref.get()).data() || d;
      try {
        const list = await fetchProducts(fresh, o, ref), active = list.filter(p => p.active);
        result = { ok: true, message: 'Connected. RedZone sent ' + list.length + ' product' + (list.length === 1 ? '' : 's') + (active.length !== list.length ? ' (' + active.length + ' active)' : '') + '.', products: list.length,
          sample: active.slice(0, 3).map(p => p.name + (p.sku ? ' (' + p.sku + ')' : '')) };
      } catch (e) {
        if (!signedIn || /answered 40[13]/.test(e.message)) throw e;
        result = { ok: true, signedIn: true, message: 'Signed in to RedZone: the client ID and secret work. The product list did not come back yet (' + plain(e).replace(/^Could not read RedZone: /, '') + ').', products: 0 };
      }
    } catch (e) { result = { ok: false, message: e instanceof RedzoneError ? 'Not tested: ' + e.message : plain(e) }; }
    const lastTest = Object.assign({ at, by: email }, result);
    await ref.set({ lastTest }, { merge: true });
    await status.set({ configured: result.ok, message: result.message, at, products: result.products || 0 }, { merge: true });
    return Object.assign(view(Object.assign({}, d, { lastTest })), { result });
  }
  if (op === 'discover') {
    let items;
    try { items = await discover(d, o, ref, input.path); } catch (e) { throw new RedzoneError('FAILED', e instanceof RedzoneError ? e.message : plain(e)); }
    const lastDiscover = { at, by: email, items };
    await ref.set({ lastDiscover }, { merge: true });
    return Object.assign(view(Object.assign({}, d, { lastDiscover })), { discover: lastDiscover });
  }
  if (op === 'products') {
    if (!(d.lastTest && d.lastTest.ok)) throw new RedzoneError('FAILED', 'RedZone is not connected yet: Administration > Connections & Keys > RedZone, then Test Connection.');
    const plant = (L.PLANTS || []).find(p => p.id === String(input.facilityId || '')) || null;
    let list;
    try { list = await fetchProducts(d, o, ref); } catch (e) { throw new RedzoneError('FAILED', plain(e)); }
    // A product RedZone keeps for another site is left out; a product with no site is everyone's.
    const mine = list.filter(p => p.active && (!p.site || !plant || p.site.toUpperCase().includes(plant.name.toUpperCase())));
    return { ok: true, at, products: mine.map(({ name, sku, mfgType, productGroup }) => ({ name, sku, mfgType, productGroup })), skipped: list.length - mine.length };
  }
  throw new RedzoneError('BAD_REQUEST', 'Unknown RedZone step ' + op.slice(0, 30));
}

module.exports = { discover, redzoneCall, RedzoneError, fetchProducts, normalize, listIn, nextIn, accessToken };
