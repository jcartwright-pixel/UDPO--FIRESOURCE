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
const P = require('./production-rules');

class RedzoneError extends Error { constructor(code, message) { super(message); this.code = code; } }

// RedZone's API reference (read 10/16, /mnt/project-files/redzone-openapi.json): token at .../public/v3/oauth/token, lists under
// .../public/v2/organizations/{organizationId}/enterprises/{enterpriseId}/... Support's .../public/v2/oauth/token also signs in.
const TOKEN_V3 = 'https://api.rz-ops.com/public/v3/oauth/token', TOKEN_V2 = 'https://api.rz-ops.com/public/v2/oauth/token';
const DEFAULTS = { productsPath: '/products', address: 'https://api.rz-ops.com/public/v2', tokenUrl: TOKEN_V3 };
// The v2 token address was the old default the screen saved back, so it counts as not typed; What RedZone Gives Us keeps
// whichever of the two RedZone answered for.
const addressOf = (d) => d.address || DEFAULTS.address, tokenUrlOf = (d) => d.signInAt || (d.tokenUrl && d.tokenUrl !== TOKEN_V2 ? d.tokenUrl : d.foundTokenUrl || DEFAULTS.tokenUrl);
// The organization and enterprise (RedZone site namespace): the ones What RedZone Gives Us found answering, else the ones typed.
const orgOf = (d) => d.foundOrgId || d.orgId || '';
const entOf = (d) => d.foundEnterpriseId || d.enterpriseId || '';
// RedZone's lists are under /organizations/{org}/enterprises/{enterprise}; with both known that is the products address.
// "/products" alone was the old default the screen saved back, so it counts as not typed.
const productsPathOf = (d) => d.productsPath && d.productsPath !== DEFAULTS.productsPath ? d.productsPath
  : orgOf(d) && entOf(d) ? '/organizations/{org}/enterprises/{enterprise}/product-types' : DEFAULTS.productsPath;
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
  if (d.access && d.access.token && d.access.until > now + 60000 && d.access.url === tokenUrl) return d.access.token;
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
  if ((res.status === 404 || res.status === 405) && tokenUrl === TOKEN_V3 && !d.signInAt) res = await ask(TOKEN_V2);
  // The answer is never shown whole: it could echo the secret.
  if (!res.ok) throw new Error('RedZone answered ' + res.status + ' at the token address');
  let json; try { json = JSON.parse(await res.text()); } catch (e) { throw new Error('RedZone\'s token address sent something that is not JSON'); }
  const token = json && (json.access_token || json.accessToken || json.token);
  if (!token) throw new Error('RedZone\'s token address sent no access token');
  const until = now + (Number(json.expires_in || json.expiresIn) || 3600) * 1000;
  if (ref) await ref.set({ access: { token, until, url: tokenUrl } }, { merge: true });
  return token;
}

// Every product, following next-page links on the same host.
async function fetchProducts(d, o, ref) {
  const token = await accessToken(d, o, ref), out = [], address = withOrg(addressOf(d), orgOf(d), entOf(d));
  if (/\{(enterprise|enterpriseId)\}/i.test(productsPathOf(d)) && !entOf(d)) throw new Error('RedZone\'s lists need the site (enterprise): press Show What RedZone Gives Us first');
  // RedZone's own lists (under /enterprises/) want limit and offset, 100 at most, and are paged by offset.
  const path = withOrg(productsPathOf(d), orgOf(d), entOf(d)), paged = /\/enterprises\//.test(path) && !path.includes('?');
  let url = urlFor(address, path) + (paged ? '?limit=100&offset=0' : ''), offset = 0;
  for (let page = 0; url && page < PAGE_LIMIT && out.length < PRODUCT_LIMIT; page++) {
    if (!sameHost(url, address)) throw new Error('The products address must be https on the same RedZone address');
    const res = await o.fetch(url, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
    if (!res.ok) {
      // RedZone's own words ("invalid organization") say more than the bare number.
      let note = ''; try { note = clean(text(field(JSON.parse(await res.text()) || {}, ['message', 'error', 'detail', 'title'])), 120); } catch (e) { /* no words */ }
      if (note.includes(token) || (d.clientSecret && note.includes(d.clientSecret))) note = '';
      throw new Error('RedZone answered ' + res.status + ' for the products address' + (note ? ': ' + note : ''));
    }
    let body; try { body = JSON.parse(await res.text()); } catch (e) { throw new Error('RedZone sent something that is not JSON for the products address'); }
    const list = listIn(body);
    if (!list) throw new Error('RedZone\'s answer has no product list in it');
    list.forEach(p => { const n = normalize(p); if (n.name) out.push(n); });
    const next = nextIn(body);
    offset += list.length;
    url = next ? urlFor(address, next) : paged && list.length >= 100 ? urlFor(address, path) + '?limit=100&offset=' + offset : '';
  }
  return out;
}
/* ---------- What RedZone gives us (Joe 10/16) ----------
 * "Will you be able to tell me what everything reads ... what sensors we have available": with the sign-in working, read
 * each list RedZone's API reference has (only GETs; nothing is ever written to RedZone) and show how many, the address, the
 * fields each one has and a few examples.
 *
 * Every list is under /organizations/{organizationId}/enterprises/{enterpriseId}. The reference never says what those are and
 * has no call to list sites; its sample script used .../namespaces/{site namespace}/... where enterprises/ is now, so the
 * enterprise is the site's namespace (a short name, not the site's long code). So: the organization is checked alone first at
 * its events address (with a 0-second hold, so RedZone's event queue is left exactly as it was), then the site is found by
 * trying what was typed and the usual namespace spellings of our three plants, Uniontown first. */
const KINDS = [
  ['Lines and areas', 'locations'],
  ['Machines', 'assets'],
  ['Machine types', 'asset-types'],
  ['Sensors', null],
  ['Products', 'product-types'],
  ['Product groups', 'product-groups'],
  ['Manufacturing types', 'manufacturing-types'],
  ['Units', 'unit-of-measures'],
  ['Characteristics (checks and readings)', 'characteristics'],
  ['Check sheets', 'data-sheet-templates'],
  ['Completed check sheets', 'completed-data-sheets'],
  ['Problem types', 'problem-types'],
  ['Runs', 'runs'],
  ['Shift patterns', 'shift-patterns'],
  ['Shift types', 'shift-types'],
  ['Labels', 'labels']
];
// RedZone caps most lists at 100 a page, problem types at 20; offset is required.
const pageOf = (p) => '?limit=' + (p === 'problem-types' ? 20 : 100) + '&offset=0';
// RedZone keeps sensors by line (.../locations/{locationId}/sensor-configurations: a name only, no readings), so they are
// asked line by line, for this many lines at most.
const SENSOR_LINES = 25;
// RedZone's Sites page names them "United Dairy - Uniontown" and so on (Joe 10/16).
const PLANTS = ['Uniontown', 'Charleston', "Martin's Ferry"].flatMap(p => [p, 'United Dairy - ' + p]);
// The usual ways a site namespace is spelled: uniontown, united-dairy-uniontown, martins-ferry, martinsferry...
function namespaces(site, orgs) {
  const words = site.toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
  const base = [words.join('-'), words.join(''), words.join('_')];
  const pre = ['united-dairy', 'uniteddairy', 'ud'].concat(orgs.filter(x => !/^org_/.test(x)));
  return [...new Set(base.concat(pre.flatMap(p => [p + '-' + words.join('-'), p + '-' + words.join('')])).concat([site]))];
}
const SHOW = ['value', 'unit', 'sku', 'type', 'status', 'dataSheetType', 'characteristicType', 'problemCategory', 'locationName', 'modelNumber', 'standardRatePerMin', 'startTime'];
function sample(item) {
  // In this order of preference (field() alone takes whichever comes first in the record).
  const name = ['name', 'displayName', 'title', 'label', 'description', 'code', 'id', 'uuid'].map(k => text(field(item, [k]))).find(Boolean) || '';
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
    if (!/org|enterprise|site|tenant|namespace/i.test(k) || /client|secret|azp/.test(leaf) || leaf === 'sub') return;
    const val = clean(v, 120);
    out.claims.push(clean(k, 60) + ' ' + val);
    // Only ID-looking names are used as IDs (not org_name and the like).
    if (!/(id|uuid|namespace)$|^(org|organization|enterprise|site|tenant)s?$/.test(leaf)) return;
    if (/enterprise|site|namespace/i.test(k)) out.enterprises.push(val);
    else if (/org/i.test(k)) out.orgs.push(val);
  };
  Object.entries(c).forEach(([k, v]) => walk(k, v));
  return out;
}
const idOf = (x) => text(field(x, ['uuid', 'id']));
const nameOf = (x) => text(field(x, ['name', 'displayName', 'title', 'label']));
async function discover(d, o, ref, extra) {
  const address = addressOf(d);
  const urlOf = (path, q) => urlFor(address, path) + (q || '');
  const typed = d.tokenUrl && d.tokenUrl !== TOKEN_V2 ? [d.tokenUrl] : [];
  const signIns = d.token ? [''] : [...new Set(typed.concat([tokenUrlOf(d), TOKEN_V3, TOKEN_V2]))];
  const orgChecks = [], probes = [];
  let base = null, enterprises = [], claims = [];
  for (const signIn of signIns) {
    let token;
    try { token = signIn ? await accessToken(Object.assign({}, d, { signInAt: signIn, access: signIn === tokenUrlOf(d) ? d.access : null }), o, signIn === tokenUrlOf(d) ? ref : null) : await accessToken(d, o, ref); }
    catch (e) { if (signIn === signIns[0]) throw e; continue; }
    const v = /\/v3\//.test(signIn) ? 'v3' : /\/v2\//.test(signIn) ? 'v2' : 'saved';
    const ids = tokenIds(token);
    claims = ids.claims;
    // 1. The organization alone: its events address answers for the right organization ID.
    const orgs = [...new Set([d.orgId].concat(ids.orgs, ['united-dairy']).filter(Boolean))].slice(0, 4);
    const good = [], uuids = [];
    for (const org of orgs) {
      const got = await getList(urlOf('/organizations/' + encodeURIComponent(org) + '/events', '?limit=10&visibility-timeout=0'), token, o);
      orgChecks.push({ sign: v, org, status: got.status, note: got.note || '' });
      // Only a real answer counts: RedZone says 403 "invalid organization" for a wrong one (Joe 10/16, "united-dairy").
      if (got.list) { good.push(org); (got.list || []).forEach(e => { const u = text(field(e, ['enterpriseUUID'])); if (u) uuids.push(u); }); }
    }
    // 2. The site: what was typed, what the sign-in names, then the usual namespaces of our plants.
    // The organizations that answered first, then the saved one, which Test Connection signs in with.
    const tryOrgs = [...new Set(good.concat(orgs))];
    enterprises = [...new Set([d.enterpriseId].concat(ids.enterprises, PLANTS.flatMap(p => namespaces(p, tryOrgs)), uuids).filter(Boolean))];
    // At most 24 site names per organization, so the whole ask stays well inside the server's 2 minutes.
    for (const org of tryOrgs.slice(0, 2)) for (const ent of enterprises.slice(0, 24)) {
      if (base) break;
      const pre = '/organizations/' + encodeURIComponent(org) + '/enterprises/' + encodeURIComponent(ent);
      const got = await getList(urlOf(pre + '/locations', '?limit=1&offset=0'), token, o);
      if (got.status !== 404 || probes.length < 6) probes.push({ sign: v, path: pre + '/locations', status: got.status, note: got.note || '' });
      // A list, or RedZone's 400 about a query value (Joe 10/16: "parameter offset ... missing"), means the organization and
      // site were taken. A 403 does not: a wrong organization answers 403 "invalid organization" (Joe 10/16, "united-dairy").
      if (got.list || (got.status === 400 && /parameter|query/i.test(got.note || ''))) base = { pre, org, enterprise: ent, token, signIn };
    }
    if (base) break;
  }
  if (!base) return { items: [], used: null, orgChecks, probes: probes.slice(0, 30), claims: claims.slice(0, 12), enterprises: enterprises.slice(0, 40) };
  const one = async (kind, p) => {
    const path = base.pre + '/' + p, got = await getList(urlOf(path, pageOf(p)), base.token, o);
    if (!got.list) return { kind, found: false, path, status: got.status, note: got.note || '' };
    const first = got.list.find(x => x && typeof x === 'object') || {};
    return { kind, found: true, path, count: got.total, full: got.list.length >= (p === 'problem-types' ? 20 : 100), fields: Object.keys(first).slice(0, 30), examples: got.list.slice(0, 5).map(sample), list: got.list };
  };
  const items = await Promise.all(KINDS.filter(([, p]) => p).map(([k, p]) => one(k, p)));
  // Sensors, line by line, named with their line.
  const lines = items.find(x => x.kind === 'Lines and areas' && x.found), all = [];
  let best = null, asked = 0;
  for (const l of ((lines && lines.list) || []).filter(x => x && idOf(x)).slice(0, SENSOR_LINES)) {
    asked++;
    const got = await getList(urlOf(base.pre + '/locations/' + encodeURIComponent(idOf(l)) + '/sensor-configurations', pageOf('')), base.token, o);
    if (got.list) got.list.forEach(x => all.push({ line: nameOf(l), x }));
    else if (!best || (got.status === 403 && best.status !== 403)) best = got;
  }
  const spath = base.pre + '/locations/{locationId}/sensor-configurations';
  const sensors = all.length ? { kind: 'Sensors', found: true, path: spath, count: all.length, lines: asked, fields: Object.keys(all[0].x || {}).slice(0, 30), examples: all.slice(0, 8).map(a => (a.line ? a.line + ': ' : '') + sample(a.x)) }
    : { kind: 'Sensors', found: false, path: spath, status: best ? best.status : 200, note: best ? best.note || '' : asked ? 'no sensors on ' + asked + ' lines' : 'no lines to ask' };
  items.splice(KINDS.findIndex(([k]) => k === 'Sensors'), 0, sensors);
  if (extra) {
    const t = clean(extra, 300).replace(/^\/+/, '');
    const got = await getList(urlOf(base.pre + '/' + t, t.includes('?') ? '' : pageOf(t)), base.token, o);
    items.push(got.list ? { kind: 'Address typed', found: true, path: base.pre + '/' + t, count: got.total, fields: Object.keys(got.list[0] || {}).slice(0, 30), examples: got.list.slice(0, 5).map(sample) }
      : { kind: 'Address typed', found: false, path: base.pre + '/' + t, status: got.status, note: got.note || '' });
  }
  const used = { org: base.org, enterprise: base.enterprise, tokenUrl: base.signIn || '' };
  return { items: items.map(({ list, ...x }) => x), used, orgChecks, probes: probes.slice(0, 30), claims: claims.slice(0, 12) };
}

/* ---------- Read RedZone into Operations (Joe 10/16: "build everything complete") ----------
 * Only GETs, as in What RedZone Gives Us, with the organization and site that answered there. One copy for the plant goes in
 * redzoneData/{plant}: RedZone's lines (locations) with their sensor names and machines, its products with full speed,
 * target and crew, its latest runs, its problem types (the Line Stopped choices) and its check sheets matched to ours.
 * Nothing is ever written to RedZone, and nothing here is a reading: RedZone's API has none. */
const RUN_PAGES = 10, KEEP_RUNS = 400;
// Our screens that do the same job as each RedZone check sheet (by its name).
const OUR_CHECKS = [[/weight/i, 'Fill weight check on the Line Tablet, and Quality Checks package weight'], [/bottle|jug|blow|leak/i, 'Blow Mold bottle check on the Line Tablet'],
  [/label|code date|lot|trac/i, 'Code date check (label reader) and Quality Checks'], [/htst|pasteur|chart|divert/i, 'HTST on the Line Tablet and Quality'],
  [/temp|cooler/i, 'Temperatures (sensors)'], [/change\s*over|mold change/i, 'Changeover checklist on the Line Tablet'], [/cip|wash|sanit|clean/i, 'CIP wash on the Line Tablet'],
  [/5.?why|root cause/i, 'Shift Notes and Breakdowns'], [/gmp|audit|biosecur|walk/i, 'Manager Walkthrough']];
const oursFor = (name) => (OUR_CHECKS.find(([re]) => re.test(name)) || [null, ''])[1];
async function readForOps(d, o, ref) {
  const org = orgOf(d), ent = entOf(d);
  if (!org || !ent) throw new RedzoneError('BAD_REQUEST', 'Press Show What RedZone Gives Us first, so the organization and site are found.');
  const token = await accessToken(d, o, ref), address = addressOf(d);
  const pre = '/organizations/' + encodeURIComponent(org) + '/enterprises/' + encodeURIComponent(ent);
  const all = async (p, pages) => {
    const per = p === 'problem-types' ? 20 : 100, out = [];
    for (let i = 0; i < (pages || PAGE_LIMIT); i++) {
      const got = await getList(urlFor(address, pre + '/' + p) + '?limit=' + per + '&offset=' + out.length, token, o);
      if (!got.list) { if (i === 0) return { failed: got.status + (got.note ? ' ' + got.note : '') }; break; }
      out.push(...got.list.filter(x => x && typeof x === 'object'));
      if (got.list.length < per) break;
    }
    return { list: out };
  };
  const [locs, assets, types, prods, runs, probs, sheets] = await Promise.all([all('locations'), all('assets'), all('asset-types'), all('product-types'), all('runs', RUN_PAGES),
    all('problem-types'), all('data-sheet-templates')]);
  if (locs.failed) throw new Error('RedZone answered ' + locs.failed + ' for its lines');
  const t = (x, k) => text(field(x, [k])), n = (x, k) => { const v = Number(field(x, [k])); return isFinite(v) && field(x, [k]) !== '' && field(x, [k]) !== null ? v : null; };
  const locations = [];
  for (const l of locs.list.slice(0, 60)) {
    const got = await getList(urlFor(address, pre + '/locations/' + encodeURIComponent(idOf(l)) + '/sensor-configurations') + '?limit=100&offset=0', token, o);
    locations.push({ uuid: idOf(l), name: nameOf(l), sensors: (got.list || []).map(nameOf).filter(Boolean).slice(0, 20) });
  }
  const typeName = {};
  (types.list || []).forEach(x => { typeName[idOf(x)] = nameOf(x); });
  const out = {
    locations,
    assets: (assets.list || []).filter(a => a.deactivated !== true).slice(0, 300).map(a => ({ uuid: idOf(a), name: nameOf(a), locationUUID: t(a, 'locationUUID'), assetTypeUUID: t(a, 'assetTypeUUID'), type: typeName[t(a, 'assetTypeUUID')] || '', model: t(a, 'modelNumber') })),
    products: (prods.list || []).slice(0, 1500).map(p => ({ uuid: idOf(p), name: nameOf(p), sku: t(p, 'externalId'), ratePerMin: n(p, 'standardRatePerMin'), target: n(p, 'target'), crew: n(p, 'targetCrewSize'), perManHour: n(p, 'standardRatePerManHour') })),
    runs: (runs.list || []).map(r => ({ locationUUID: t(r, 'locationUUID'), productTypeUUID: t(r, 'productTypeUUID'), startTime: t(r, 'startTime'), endTime: t(r, 'endTime'), plannedQuantity: n(r, 'plannedQuantity'),
      ratePerMin: n(r, 'standardRatePerMin'), crew: n(r, 'crewSize') })).sort((a, b) => (Date.parse(b.startTime) || 0) - (Date.parse(a.startTime) || 0)).slice(0, KEEP_RUNS),
    problems: (probs.list || []).slice(0, 300).map(p => ({ name: nameOf(p), category: t(p, 'problemCategory'), assetTypeUUID: t(p, 'assetTypeUUID'), planned: field(p, ['planned']) === true, breakdown: field(p, ['breakdown']) === true })),
    checkSheets: (sheets.list || []).slice(0, 200).map(x => ({ name: nameOf(x), type: t(x, 'dataSheetType'), ours: oursFor(nameOf(x)) })),
    failed: Object.entries({ machines: assets, 'machine types': types, products: prods, runs, 'problem types': probs, 'check sheets': sheets }).filter(([, v]) => v.failed).map(([k, v]) => k + ' (' + v.failed + ')')
  };
  return out;
}

const plain = (e) => /answered 403 for the products address/.test(e.message) ? 'Signed in, but RedZone said no to the product list (' + e.message.replace(/^RedZone answered 403 for the products address:? ?/, '403 ').trim()
    + '). Press Show What RedZone Gives Us, then Test Connection again.'
  : /answered 40[13]/.test(e.message) ? 'RedZone refused the sign-in (' + e.message.replace(/^RedZone answered (\d+).*/, '$1') + '). Check the client ID and secret, and that the role has the read permissions on.'
  : /answered 404/.test(e.message) ? 'RedZone has no page at that address (404). Check the API address and products address from the Developer Hub.'
  : 'Could not read RedZone: ' + e.message;

const view = (d) => ({ orgId: d.orgId || '', enterpriseId: d.enterpriseId || '', foundOrgId: d.foundOrgId || '', foundEnterpriseId: d.foundEnterpriseId || '',
  address: addressOf(d), tokenUrl: tokenUrlOf(d), productsPath: productsPathOf(d), scope: d.scope || '',
  hasToken: !!d.token, tokenEnds: ends(d.token), hasClient: !!d.clientId, clientEnds: ends(d.clientId), hasSecret: !!d.clientSecret,
  savedAt: d.savedAt || '', savedBy: d.savedBy || '', lastTest: d.lastTest || null, lastDiscover: d.lastDiscover || null, lastSync: d.lastSync || null });

/* input.op: status | discover {path} | sync {facilityId} | save {orgId, enterpriseId, address, tokenUrl, productsPath, scope, token, clientId, clientSecret} | clear | test | products {facilityId} */
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
    // A new sign-in, organization or site is looked for again by What RedZone Gives Us.
    if ([address, tokenUrl, token, id, secret, org, ent].some(Boolean)) ['foundOrgId', 'foundEnterpriseId', 'foundTokenUrl'].forEach(k => delete next[k]);
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
      // Joe 10/16: the organization and site found earlier can be stale (a wrong one was kept once). The ones typed on this
      // screen are tried too, and whichever answers is kept.
      const typed = Object.assign({}, fresh, { foundOrgId: '', foundEnterpriseId: '' });
      const tries = fresh.orgId && fresh.enterpriseId && (orgOf(typed) !== orgOf(fresh) || entOf(typed) !== entOf(fresh)) ? [fresh, typed] : [fresh];
      try {
        let list;
        for (let i = 0; i < tries.length; i++) {
          try { list = await fetchProducts(tries[i], o, ref); } catch (e) { if (i === tries.length - 1 || !/for the products address/.test(e.message)) throw e; continue; }
          if (i > 0) await ref.set({ foundOrgId: orgOf(typed), foundEnterpriseId: entOf(typed) }, { merge: true });
          break;
        }
        const active = list.filter(p => p.active);
        result = { ok: true, message: 'Connected. RedZone sent ' + list.length + ' product' + (list.length === 1 ? '' : 's') + (active.length !== list.length ? ' (' + active.length + ' active)' : '') + '.', products: list.length,
          sample: active.slice(0, 3).map(p => p.name + (p.sku ? ' (' + p.sku + ')' : '')) };
      } catch (e) {
        if (!signedIn || /answered 40[13]/.test(e.message) || e instanceof RedzoneError) throw e;
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
    if (got.used) Object.assign(keep, { foundOrgId: got.used.org, foundEnterpriseId: got.used.enterprise, foundTokenUrl: got.used.tokenUrl || '' },
      got.used.tokenUrl && got.used.tokenUrl !== tokenUrlOf(d) ? { access: null } : {});
    await ref.set(keep, { merge: true });
    return Object.assign(view(Object.assign({}, d, keep)), { discover: lastDiscover });
  }
  if (op === 'sync') {
    let got;
    try { got = await readForOps(d, o, ref); } catch (e) { throw new RedzoneError('FAILED', e instanceof RedzoneError ? e.message : plain(e)); }
    const fac = L.PLANTS && L.PLANTS.some(p => p.id === input.facilityId) ? input.facilityId : 'fac_uniontown';
    const doc = Object.assign({ facilityId: fac, at, by: email }, got);
    await db.collection('redzoneData').doc(fac).set(doc);
    // Which of our lines each RedZone line goes with (Line Targets can change it).
    const ours = (await db.collection('plantSetup').where('type', '==', 'PRODUCTION_AREA').get()).docs.map(x => x.data())
      .filter(x => x.status === 'ACTIVE' && (text(x.facilityId) || 'fac_uniontown') === fac);
    const docs = {};
    (await db.collection('productionLines').get()).docs.forEach(x => { docs[x.data().operationId || x.id] = x.data(); });
    const matches = got.locations.map(l => {
      const line = ours.find(x => { const m = P.rzLocationFor(text(x.name) || text(x.area), docs[x.operationId] || {}, got); return m && m.uuid === l.uuid; });
      return { redzone: l.name, sensors: l.sensors, line: line ? text(line.name) || text(line.area) : '' };
    });
    const summary = { at, by: email, matches, lines: got.locations.length, sensors: got.locations.reduce((a, l) => a + l.sensors.length, 0), machines: got.assets.length, products: got.products.length,
      runs: got.runs.length, problems: got.problems.length, checkSheets: got.checkSheets.length, failed: got.failed };
    await ref.set({ lastSync: summary }, { merge: true });
    return Object.assign(view(Object.assign({}, d, { lastSync: summary })), { sync: summary });
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
