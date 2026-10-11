// Joe 10/10: the products each machine runs, from RedZone (Uniontown), are the product drop-downs on the plant screens. The
// starting list is data/plant-products.json; an area changed on Administration > Products (plantProducts in the
// database) replaces its starting list, so a new SKU goes in without a code change.
// Joe 10/11: products are plant by plant and area by area. A plant's areas are its machines plus the areas it adds itself, and
// it keeps its own group list (productSetup in the database; the starting ones below are the same as functions/src/plant.js).
import { collection, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

export const START_AREAS = { fac_uniontown: ['CASES', 'TANKER'] };
export const START_GROUPS = ['Milk', 'Drinks', 'TEA'];
export const areaSlug = (facilityId, name) => facilityId + '_area_' + String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
// {areas: [{id, name}], groups: [name], saved}: what the plant saved, else its starting areas and groups.
export function plantSetupOf(saved, facilityId) {
  const d = (saved || []).find(x => x.facilityId === facilityId);
  return { areas: d && Array.isArray(d.areas) ? d.areas : (START_AREAS[facilityId] || []).map(n => ({ id: areaSlug(facilityId, n), name: n })),
    groups: d && Array.isArray(d.groups) ? d.groups : START_GROUPS.slice(), saved: d || null };
}
export function watchProductSetup(db, cb, fail) {
  return onSnapshot(collection(db, 'productSetup'), s => cb(s.docs.map(d => d.data())), e => { cb([]); if (fail) fail(e); });
}
// A product's groups ("Drinks, TEA" is two).
export const groupsOf = (p) => String((p && p.productGroup) || '').split(',').map(g => g.trim()).filter(Boolean);

// Joe 10/11: one product list holds everything about each product, a tab per plant. The fields, in template order (the same
// names as functions/src/plant.js productRows): speeds are per minute (RedZone's Rate/Min), Target % is RedZone's, and shelf life is
// days from the run date to the code date.
export const FIELDS = [
  { k: 'name', head: 'Product' }, { k: 'sku', head: 'SKU' }, { k: 'upc', head: 'UPC' }, { k: 'mfgType', head: 'Type' }, { k: 'productGroup', head: 'Group' },
  { k: 'ratePerMin', head: 'Full Speed Per Min', num: true }, { k: 'targetPct', head: 'Target %', num: true },
  { k: 'minSpeed', head: 'Lowest Speed', num: true }, { k: 'maxSpeed', head: 'Highest Speed', num: true }, { k: 'shelfLifeDays', head: 'Shelf Life Days', num: true }
];
// The fields an upload never wipes: a file that leaves one blank or out keeps what the product has (Joe 10/11, targets stay put).
export const KEEP_FIELDS = ['upc', 'ratePerMin', 'targetPct', 'minSpeed', 'maxSpeed', 'shelfLifeDays'];
// The template's columns, in order; a file with these headings loads (Joe 10/11: always the same layout). Plant is the tab's name
// in the workbook (or a column in a CSV); a column left out of a file keeps what each product has.
export const TEMPLATE = ['Plant', 'Area'].concat(FIELDS.map(f => f.head));
// A product as the server keeps it: blank fields left off, numbers as numbers (so a saved list matches what was typed).
export function cleanProduct(p) {
  const out = {};
  FIELDS.forEach(f => {
    let v = p && p[f.k] !== undefined && p[f.k] !== null ? String(p[f.k]).trim() : '';
    if (f.k === 'upc') v = v.replace(/[\s-]/g, '');
    if (f.num && v !== '' && isFinite(Number(v.replace(/,/g, '')))) { const n = Number(v.replace(/,/g, '')); out[f.k] = f.k === 'shelfLifeDays' ? Math.round(n) : Math.round(n * 100) / 100; return; }
    if (v !== '' || ['name', 'sku', 'mfgType', 'productGroup'].indexOf(f.k) >= 0) out[f.k] = v;
  });
  return out;
}
const cell = (v) => { const s = String(v == null ? '' : v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export function toCsv(rows) { return [TEMPLATE].concat(rows).map(r => r.map(cell).join(',')).join('\r\n') + '\r\n'; }
// CSV text -> rows of cells (quotes, doubled quotes, commas and line breaks in quotes, a byte-order mark).
export function parseCsv(textIn) {
  const t = String(textIn || '').replace(/^\uFEFF/, ''), rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim()));
}

let start = null;
export function startingList() {
  if (!start) start = fetch('data/plant-products.json').then(r => r.ok ? r.json() : { lines: [] }).catch(() => ({ lines: [] }));
  return start;
}

// cb gets {operationId: [{name, sku, mfgType, productGroup}]} and which machines were changed from the starting list.
export function watchProducts(db, cb, fail) {
  let base = null, saved = null;
  const send = () => {
    if (!base || !saved) return;
    const out = {}, changed = {};
    base.lines.forEach(l => { out[l.operationId] = l.products || []; });
    saved.forEach(d => { if (d.operationId && Array.isArray(d.products)) { out[d.operationId] = d.products; changed[d.operationId] = d; } });
    cb(out, changed);
  };
  startingList().then(b => { base = b; send(); });
  return onSnapshot(collection(db, 'plantProducts'), s => { saved = s.docs.map(d => d.data()); send(); }, e => { saved = []; send(); if (fail) fail(e); });
}

// The package size a RedZone MFG Type means on the Quality check.
export function sizeFor(mfgType) {
  const t = String(mfgType || '').trim().toUpperCase();
  if (t === 'GALLON') return 'Gallon';
  if (t === 'HALF GALLON') return 'Half gallon';
  if (t === 'QUART') return 'Quart';
  if (t === 'PINT') return 'Pint';
  if (/^(5|2\.5) GALLON$/.test(t)) return 'Dispenser';
  return '';
}

export const OTHER = '__other__';

// Joe 10/11: Get from RedZone. The plant's lists as they are, with RedZone's SKU, Type and Group for each product RedZone has by
// the same name, and RedZone's other products in a NEW PRODUCTS area to move where they belong. Nothing is removed. The rows go
// through the same preview as an uploaded template. lists: [{area, products}] in area order; rz: [{name, sku, mfgType, productGroup}].
// Rows come back as {Plant, Area, Product, SKU, ...} (the template headings), with every other field as the product has it.
export const NEW_AREA = 'NEW PRODUCTS';
export function fromRedzone(plantName, lists, rz) {
  const key = (n) => String(n || '').trim().toUpperCase(), by = {}, used = {}, rows = [];
  const row = (area, p) => { const r = { Plant: plantName, Area: area }; FIELDS.forEach(f => { r[f.head] = p[f.k] === undefined || p[f.k] === null ? '' : String(p[f.k]); }); return r; };
  (rz || []).forEach(p => { if (key(p.name) && !by[key(p.name)]) by[key(p.name)] = p; });
  (lists || []).forEach(a => (a.products || []).forEach(p => {
    const r = by[key(p.name)];
    used[key(p.name)] = true;
    rows.push(row(a.area, Object.assign({}, p, r ? { sku: r.sku || p.sku, mfgType: r.mfgType || p.mfgType, productGroup: r.productGroup || p.productGroup } : {})));
  }));
  let added = 0;
  Object.keys(by).forEach(k => { if (used[k]) return; added++; rows.push(row(NEW_AREA, by[k])); });
  return { rows, added };
}
// Rows of cells with a heading row -> [{heading: value}] by the template's headings (any case); headings a file leaves out are not set.
export function rowsByHeading(rows) {
  if (!rows.length) return { rows: [], has: {} };
  const head = rows[0].map(h => String(h == null ? '' : h).trim().toUpperCase()), at = {}, has = {};
  TEMPLATE.forEach(t => { at[t] = head.indexOf(t.toUpperCase()); has[t] = at[t] >= 0; });
  return { has, rows: rows.slice(1).map(r => { const o = {}; TEMPLATE.forEach(t => { if (at[t] >= 0) o[t] = String(r[at[t]] == null ? '' : r[at[t]]).trim(); }); return o; }) };
}
