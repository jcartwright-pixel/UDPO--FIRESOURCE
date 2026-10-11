// Joe 10/10: the products each machine runs, from RedZone (Uniontown), are the product drop-downs on the plant screens. The
// starting list is data/plant-products.json; a machine changed on Administration > Machine Products (plantProducts in the
// database) replaces its starting list, so a new SKU goes in without a code change.
import { collection, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

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
