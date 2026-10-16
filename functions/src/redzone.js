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
// The enterprise (RedZone site): the one typed, else the one What RedZone Gives Us found answering.
const entOf = (d) => d.enterpriseId || d.foundEnterpriseId || '';
// RedZone's lists are under /organizations/{org}/enterprises/{enterprise}; with both known that is the products address.
// "/products" alone was the old default the screen saved back, so it counts as not typed.
const productsPathOf = (d) => d.productsPath && d.productsPath !== DEFAULTS.productsPath ? d.productsPath
  : d.foundProductsPath ? d.foundProductsPath
  : d.orgId && entOf(d) ? '/organizations/{org}/enterprises/{enterprise}/product-types' : DEFAULTS.productsPath;
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
  if (/\{(enterprise|enterpriseId)\}/i.test(productsPathOf(d)) && !entOf(d)) throw new Error('RedZone\'s lists need the site (enterprise): press Show What RedZone Gives Us first');
  let url = urlFor(address, withOrg(productsPathOf(d), d.orgId, entOf(d)));
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
// Names from RedZone's API reference menu (Joe 10/16): Assets, Characteristics, Data Sheets, Locations, Manufacturing Types,
// Problems, Product Groups, Product Types (RedZone's word for a product, a SKU), Labels; the older guesses stay behind them.
const KINDS = [
  ['Lines and areas', ['locations', 'location-types', 'areas', 'lines']],
  ['Machines', ['assets', 'asset-types', 'machines', 'equipment']],
  ['Sensors', ['sensor-configurations', 'sensors', 'data-points', 'tags']],
  ['Characteristics (checks and readings)', ['characteristics']],
  ['Data sheets', ['data-sheet-templates', 'data-sheets', 'completed-data-sheets']],
  ['Products', ['product-types', 'products']],
  ['Product groups', ['product-groups']],
  ['Manufacturing types', ['manufacturing-types']],
  ['Problems and downtime', ['problems', 'problem-types', 'losses', 'downtime']],
  ['Labels', ['labels']],
  ['Runs', ['runs', 'production-runs', 'production-schedules']],
  ['Shifts', ['shifts', 'shift-types']],
  ['Sites', ['sites', 'enterprises']]
];
// RedZone's sensors are kept by line (List Sensor Configurations: .../locations/{locationId}/sensor-configurations), so
// they are asked line by line, for this many lines at most.
const SENSOR_LINES = 25;
// Joe 10/16 (RedZone's API reference, List Asset Types): https://api.rz-ops.com/public/v2/organizations/{organizationId}/
// enterprises/{enterpriseId}/asset-types. Every list is under the organization and an enterprise (RedZone's sites).
const NEST = '/organizations/{org}/enterprises/{enterprise}';
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
  let body; try { body = JSON.parse(await res.text()); } catch (e) { return { status: res.status, note: res.ok ? 'not JSON' : '' }; }
  // RedZone's own words on a refusal ("Organization not found" says more than a bare 404).
  if (!res.ok) return { status: res.status, note: clean(text(field(body || {}, ['message', 'error', 'detail', 'title'])), 120) };
  const list = listIn(body);
  return list ? { status: res.status, list, total: Number(field(body, ['total', 'totalCount', 'count'])) || list.length } : { status: res.status, note: 'no list in the answer' };
}
// The organization and site IDs the sign-in itself carries (a token is often a JWT naming them). Only those names are kept:
// never the client, the subject or the token itself.
function tokenIds(token) {
  const out = { orgs: [], enterprises: [], claims: [] };
  const part = String(token || '').split('.')[1];
  if (!part) return out;
  let c; try { c = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch (e) { return out; }
  if (!c || typeof c !== 'object') return out;
  const walk = (k, v) => {
    if (Array.isArray(v)) return v.forEach(x => walk(k, x));
    if (v && typeof v === 'object') return Object.entries(v).forEach(([k2, v2]) => walk(k + '.' + k2, v2));
    if (typeof v !== 'string' && typeof v !== 'number') return;
    const leaf = k.split('.').pop().replace(/[_\-\s]/g, '').toLowerCase();
    if (!/org|enterprise|site|tenant/i.test(k) || /client|secret|azp/.test(leaf) || leaf === 'sub') return;
    const val = clean(v, 120);
    out.claims.push(clean(k, 60) + ' ' + val);
    // Only ID-looking names are used as IDs (not org_name and the like).
    if (!/(id|uuid)$|^(org|organization|enterprise|site|tenant)s?$/.test(leaf)) return;
    if (/enterprise|site/i.test(k)) out.enterprises.push({ id: val, name: '', from: 'sign-in' });
    else if (/org/i.test(k)) out.orgs.push(val);
  };
  Object.entries(c).forEach(([k, v]) => walk(k, v));
  return out;
}
const idOf = (x) => text(field(x, ['id', 'enterpriseId', 'siteId', 'uuid']));
const nameOf = (x) => text(field(x, ['name', 'displayName', 'title', 'label']));
async function discover(d, o, ref, extra) {
  const token = await accessToken(d, o, ref), address = withOrg(addressOf(d), d.orgId, d.enterpriseId);
  const urlOf = (path) => urlFor(address, path) + (path.includes('?') ? '&' : '?') + 'limit=50';
  // Which organization and enterprise: the saved ones, the ones the sign-in names, and RedZone's own enterprise list.
  const ids = tokenIds(token);
  const orgs = [...new Set([d.orgId].concat(ids.orgs).filter(Boolean))].slice(0, 3);
  const ents = [];
  const addEnt = (e) => { if (e.id && !ents.some(x => x.id === e.id)) ents.push(e); else if (e.name) { const x = ents.find(y => y.id === e.id); if (x && !x.name) x.name = e.name; } };
  if (d.enterpriseId) addEnt({ id: d.enterpriseId, name: '', from: 'saved' });
  ids.enterprises.forEach(addEnt);
  let entList = null;
  for (const org of orgs) {
    for (const p of ['/organizations/' + encodeURIComponent(org) + '/enterprises', '/organizations/' + encodeURIComponent(org) + '/sites']) {
      const got = await getList(urlOf(p), token, o);
      if (got.list) { entList = { path: p, list: got.list, total: got.total }; got.list.forEach(x => addEnt({ id: idOf(x), name: nameOf(x), from: 'list' })); break; }
    }
    if (entList) break;
  }
  // Uniontown first (Joe's plant), then the rest.
  ents.sort((a, b) => (/uniontown/i.test(b.name) ? 1 : 0) - (/uniontown/i.test(a.name) ? 1 : 0));
  // The first organization and enterprise pair RedZone answers for (a list, or 403: there but not allowed) is used for every kind.
  let base = null;
  for (const org of orgs) for (const e of ents.slice(0, 4)) {
    if (base) break;
    const pre = '/organizations/' + encodeURIComponent(org) + '/enterprises/' + encodeURIComponent(e.id);
    const got = await getList(urlOf(pre + '/asset-types'), token, o);
    if (got.list || got.status === 403) base = { pre, org, enterprise: e };
  }
  const prefixes = base ? [base.pre] : [''].concat(d.orgId ? ['/organizations/{org}'] : []).concat(d.orgId && d.enterpriseId ? [NEST] : []);
  const one = async (kind, paths, pres) => {
    let best = null;
    for (const p of paths) for (const pre of p.startsWith('/') ? [''] : (pres || prefixes)) {
      const path = withOrg(pre + '/' + p.replace(/^\/+/, ''), d.orgId, d.enterpriseId), url = urlOf(path);
      if (!sameHost(url, address)) continue;
      const got = await getList(url, token, o);
      if (got.list) {
        const first = got.list.find(x => x && typeof x === 'object') || {};
        return { kind, found: true, path, count: got.total, fields: Object.keys(first).slice(0, 30), examples: got.list.slice(0, 5).map(sample), list: got.list };
      }
      // 403 (there but not allowed) says more than 404 (not there).
      if (!best || (got.status === 403 && best.status !== 403)) best = { kind, found: false, path, status: got.status, note: got.note || '' };
    }
    return best;
  };
  const kinds = KINDS.map(([k, p]) => k === 'Sites' && entList
    ? Promise.resolve({ kind: k, found: true, path: entList.path, count: entList.total, fields: Object.keys(entList.list.find(x => x && typeof x === 'object') || {}).slice(0, 30), examples: entList.list.slice(0, 5).map(sample), list: entList.list })
    : one(k, p));
  if (extra) {
    const typed = clean(extra, 300).startsWith('/') ? clean(extra, 300) : '/' + clean(extra, 300);
    kinds.push(one('Address typed', [typed]).then(x => x && x.found || !base ? x : one('Address typed', [typed.replace(/^\/+/, '')])));
  }
  const items = (await Promise.all(kinds)).filter(Boolean);
  const lines = items.find(x => x.kind === 'Lines and areas' && x.found && /\/locations$/.test(x.path));
  const si = items.findIndex(x => x.kind === 'Sensors');
  if (lines && si >= 0 && !items[si].found) {
    const pre = lines.path.replace(/\/locations$/, ''), all = [];
    let best = null, asked = 0;
    for (const l of (lines.list || []).filter(x => x && idOf(x)).slice(0, SENSOR_LINES)) {
      asked++;
      const got = await getList(urlOf(pre + '/locations/' + encodeURIComponent(idOf(l)) + '/sensor-configurations'), token, o);
      if (got.list) got.list.forEach(x => all.push({ line: nameOf(l), x }));
      else if (!best || (got.status === 403 && best.status !== 403)) best = got;
    }
    const path = pre + '/locations/{locationId}/sensor-configurations';
    if (all.length) {
      const first = all.map(a => a.x).find(x => x && typeof x === 'object') || {};
      items[si] = { kind: 'Sensors', found: true, path, count: all.length, lines: asked, fields: Object.keys(first).slice(0, 30), examples: all.slice(0, 8).map(a => (a.line ? a.line + ': ' : '') + sample(a.x)) };
    } else if (asked) items[si] = { kind: 'Sensors', found: false, path, status: best ? best.status : 200, note: best ? best.note || '' : 'no sensors on ' + asked + ' lines' };
  }
  // Joe 10/16: RedZone's Organization IDs list sites (Uniontown, Charleston, Martin's Ferry), no enterprise. When the sites
  // list came back, a kind not found yet is tried once more under Uniontown's site, so nobody types the long site ID.
  const sites = !base && items.find(x => x.kind === 'Sites' && x.found);
  const ut = sites && (sites.list || []).find(x => /uniontown/i.test(nameOf(x) || ''));
  const siteId = ut && idOf(ut);
  if (siteId) {
    const pres = ['/sites/' + encodeURIComponent(siteId)].concat(d.orgId ? ['/organizations/{org}/sites/' + encodeURIComponent(siteId)] : []);
    await Promise.all(items.map(async (x, i) => {
      if (x.found || x.kind === 'Sites' || x.kind === 'Address typed') return;
      const k = KINDS.find(([n]) => n === x.kind), again = await one(x.kind, k[1], pres);
      if (again && (again.found || (again.status === 403 && x.status !== 403))) items[i] = again;
    }));
  }
  const used = base ? { org: base.org, enterprise: base.enterprise.id, name: base.enterprise.name || '' } : null;
  const prod = items.find(x => x.kind === 'Products' && x.found);
  if (used && prod) used.productsPath = prod.path.replace(base.pre, '/organizations/{org}/enterprises/{enterprise}');
  return { items: items.map(({ list, ...x }) => x), used, claims: ids.claims.slice(0, 12), enterprises: ents.slice(0, 10) };
}

const plain = (e) => /answered 40[13]/.test(e.message) ? 'RedZone refused the sign-in (' + e.message.replace(/^RedZone answered (\d+).*/, '$1') + '). Check the client ID and secret, and that the role has the read permissions on.'
  : /answered 404/.test(e.message) ? 'RedZone has no page at that address (404). Check the API address and products address from the Developer Hub.'
  : 'Could not read RedZone: ' + e.message;

const view = (d) => ({ orgId: d.orgId || '', enterpriseId: d.enterpriseId || '', foundEnterpriseId: d.foundEnterpriseId || '', foundEnterpriseName: d.foundEnterpriseName || '',
  address: addressOf(d), tokenUrl: tokenUrlOf(d), productsPath: productsPathOf(d), scope: d.scope || '',
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
    let got;
    try { got = await discover(d, o, ref, input.path); } catch (e) { throw new RedzoneError('FAILED', e instanceof RedzoneError ? e.message : plain(e)); }
    const lastDiscover = Object.assign({ at, by: email }, got);
    // The enterprise RedZone answered for is kept, so the products address works without anyone typing it.
    const keep = { lastDiscover };
    if (got.used && got.used.enterprise !== d.enterpriseId) Object.assign(keep, { foundEnterpriseId: got.used.enterprise, foundEnterpriseName: got.used.name });
    // The products address RedZone answered (Product Types is RedZone's word for products).
    if (got.used && got.used.productsPath) keep.foundProductsPath = got.used.productsPath;
    await ref.set(keep, { merge: true });
    return Object.assign(view(Object.assign({}, d, keep)), { discover: lastDiscover });
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
