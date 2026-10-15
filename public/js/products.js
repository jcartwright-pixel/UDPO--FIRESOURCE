// Joe 10/10: the products each machine runs, from RedZone (Uniontown), are the product drop-downs on the plant screens. The
// starting list is data/plant-products.json; an area changed on Administration > Products (plantProducts in the
// database) replaces its starting list, so a new SKU goes in without a code change.
// Joe 10/11: products are plant by plant and area by area. A plant's areas are its machines plus the areas it adds itself, and
// it keeps its own group list (productSetup in the database; the starting ones below are the same as functions/src/plant.js).
import { collection, onSnapshot } from './firebase.js';

export const START_AREAS = { fac_uniontown: ['CASES', 'TANKER'] };
export const START_GROUPS = ['Milk', 'Drinks', 'TEA'];
// Joe 10/12: "We have mix, milk, tea, juice." Every plant's group list has these (a plant keeps the groups it added too).
export const JOE_GROUPS = ['Milk', 'Mix', 'Tea', 'Juice'];
const withJoeGroups = (gs) => gs.concat(JOE_GROUPS.filter(g => !gs.some(x => String(x).toUpperCase() === g.toUpperCase())));
// Joe 10/12: Type is a drop-down on the product's Edit panel: these package types plus any a plant's products already use.
export const START_TYPES = ['Gallon', 'Half Gallon', 'Quart', 'Pint', '2.5 Gallon', '5 Gallon', 'TOTE'];
export function typesFrom(products) {
  const out = START_TYPES.slice();
  (products || []).forEach(p => { const t = String((p && p.mfgType) || '').trim(); if (t && !out.some(x => x.toUpperCase() === t.toUpperCase())) out.push(t); });
  return out;
}
export const areaSlug = (facilityId, name) => facilityId + '_area_' + String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
// {areas: [{id, name}], groups: [name], saved}: what the plant saved, else its starting areas and groups.
export function plantSetupOf(saved, facilityId) {
  const d = (saved || []).find(x => x.facilityId === facilityId);
  return { areas: d && Array.isArray(d.areas) ? d.areas : (START_AREAS[facilityId] || []).map(n => ({ id: areaSlug(facilityId, n), name: n })),
    groups: withJoeGroups(d && Array.isArray(d.groups) ? d.groups : START_GROUPS.slice()), saved: d || null };
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
  { k: 'minSpeed', head: 'Lowest Speed', num: true }, { k: 'maxSpeed', head: 'Highest Speed', num: true }, { k: 'shelfLifeDays', head: 'Shelf Life Days', num: true },
  // Joe 10/14: what the product in one package should weigh, in grams (the fill weight check's target; production-rules fillOf).
  { k: 'fillGrams', head: 'Target Fill Weight g', num: true }
];
// The fields an upload never wipes: a file that leaves one blank or out keeps what the product has (Joe 10/11, targets stay put).
export const KEEP_FIELDS = ['upc', 'ratePerMin', 'targetPct', 'minSpeed', 'maxSpeed', 'shelfLifeDays', 'fillGrams'];
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

// Rows of cells with a heading row -> [{heading: value}] by the template's headings (any case); headings a file leaves out are not set.
export function rowsByHeading(rows) {
  if (!rows.length) return { rows: [], has: {} };
  const head = rows[0].map(h => String(h == null ? '' : h).trim().toUpperCase()), at = {}, has = {};
  TEMPLATE.forEach(t => { at[t] = head.indexOf(t.toUpperCase()); has[t] = at[t] >= 0; });
  return { has, rows: rows.slice(1).map(r => { const o = {}; TEMPLATE.forEach(t => { if (at[t] >= 0) o[t] = String(r[at[t]] == null ? '' : r[at[t]]).trim(); }); return o; }) };
}

// Joe 10/13: the Product Sheet is one list of the plant's products, one line each, with a check for every machine it runs on
// (each machine's checked products are still its own list in plantProducts: the Product drop-down on its Quality Check, in the
// machine's order, with its own speeds and Target %). A product checked on no machine is kept in productSheet/{plant}.
// Machine Setup shows the same lists one machine at a time. A product is matched across machines by its name.
export const SHARED_FIELDS = ['name', 'sku', 'upc', 'mfgType', 'productGroup', 'shelfLifeDays', 'fillGrams'];
export const MACHINE_FIELDS = ['ratePerMin', 'targetPct', 'minSpeed', 'maxSpeed'];
export const keyOf = (name) => String(name || '').trim().toUpperCase();
// [{key, p, on: {areaId: product}, loose}] in name order: p is the product's details as first found (machines in their order, then
// the products on no machine).
export function sheetRows(areas, listOf, loose) {
  const by = new Map();
  const add = (p, areaId) => {
    const k = keyOf(p && p.name);
    if (!k) return;
    let r = by.get(k);
    if (!r) { r = { key: k, p: Object.assign({}, p), on: {}, loose: null }; by.set(k, r); }
    // A detail the first copy left blank (a Target Fill Weight g set on another machine's copy) shows from the copy that has it.
    else SHARED_FIELDS.forEach(f => { if (!has(r.p[f]) && has(p[f])) r.p[f] = p[f]; });
    if (areaId) r.on[areaId] = p; else r.loose = p;
  };
  areas.forEach(a => (listOf(a.id) || []).forEach(p => add(p, a.id)));
  (loose || []).forEach(p => add(p, ''));
  return [...by.values()].sort((a, b) => String(a.p.name).localeCompare(String(b.p.name), undefined, { numeric: true, sensitivity: 'base' }));
}
const has = (v) => v !== undefined && v !== null && String(v) !== '';
// A speed or target on each machine the product runs on (in the machines' order); a product on no machine has its own.
export function machineValues(row, k, areas) {
  const ids = areas.map(a => a.id).filter(id => row.on[id]);
  const vals = ids.map(id => row.on[id][k]).filter(has);
  return ids.length ? vals : row.loose && has(row.loose[k]) ? [row.loose[k]] : [];
}
// The number the sheet and the downloaded list show: the first machine's (orange on the sheet when the machines differ).
export function shownValue(row, k, areas) { const v = machineValues(row, k, areas); return v.length ? v[0] : ''; }
export function watchLoose(db, cb, fail) {
  return onSnapshot(collection(db, 'productSheet'), s => cb(s.docs.map(d => d.data())), e => { cb([]); if (fail) fail(e); });
}
// The Download Product List / Upload columns: the product, a column per machine (an X where it runs), then the numbers.
export const SHEET_HEAD = ['Product', 'SKU', 'UPC', 'Type', 'Group'];
export const SHEET_TAIL = ['Full Speed Per Min', 'Target %', 'Lowest Speed', 'Highest Speed', 'Shelf Life Days', 'Target Fill Weight g'];
// A machine cell is checked when it has anything in it but 0, No, False or a dash.
export const isChecked = (v) => { const t = String(v == null ? '' : v).trim().toUpperCase(); return t !== '' && ['0', 'NO', 'N', 'FALSE', '-'].indexOf(t) < 0; };
// Two lists the same once both are as the server keeps them (key order and number form do not count).
export function sameList(a, b) {
  const canon = (p) => { const c = cleanProduct(p), o = {}; Object.keys(c).sort().forEach(k => { o[k] = c[k]; }); return o; };
  return JSON.stringify((a || []).map(canon)) === JSON.stringify((b || []).map(canon));
}
