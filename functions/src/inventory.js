/*
 * Receiving products and Inventory (Joe 11/1, mock-up 2 "Suppliers & Products").
 *
 * Joe: "on the receiving, I'd like to be able to create product lists ... let the plant have more control"; "one trailer could have
 * multiple items on it ... associate a PO number"; "anytime on the receiving, if we get anything, it would automatically go into
 * our inventory"; "a nice little module for the inventory ... a manual inventory override, but this would show our projected
 * inventory, what we should have"; "when I'm receiving, I'm going to check in ... the supplier and then everything that's
 * supposed to be on that trailer ... hook it up to a scanner".
 *
 * All of it goes through savePlantSchedule (lane RECEIVING), so whoever may edit the Receiving suppliers may edit the products:
 *   - addProduct / editProduct / removeProduct: receivingItems/{itemId}, the same list the Boxing tablet names barcodes into.
 *     A product belongs to one supplier (supplierId), has a kind, what it is counted in and an optional low mark.
 *   - linkBarcode: a barcode scanned at check-in that the app does not know is tied to the product picked, once.
 *   - receive: Mark Received on a Receiving load. Each product's received count goes into Inventory, once per load.
 *   - count: Inventory's Count (the manual override): what is really on the shelf becomes the new starting point.
 * Every change to stock is one inventoryMoves record (Received, Counted; Used later), so Inventory's History shows them all,
 * and each product keeps countQty, receivedSince and usedSince so "Should have" is read without adding up the history.
 */
'use strict';

const L = require('./logic');
const R = require('./plant-rules');
const S = require('./scan-rules');

const text = (v, max) => String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 120);
// Joe 11-4-26 (mock-ups A to F, "a mix of everything"): use takes stock out (by hand on Inventory, or a scan on the plant tablet's
// TAKE OUT tab); setLow sets a product's LOW AT; setUses keeps what one of our milk products uses; label gives a product its own
// barcode for the Zebra labels; addMilkProducts brings the plant's milk products (its Products list) into Inventory.
// Joe 11-10-26 (the four inventories): setPlace keeps where a product is kept (its area and spot); countMany is the Count Walk,
// every count typed or scanned in one area saved at once, each the same as one Count.
const STOCK_OPS = ['use', 'setLow', 'setUses', 'label', 'addMilkProducts', 'setPlace', 'countMany'];
const PRODUCT_OPS = ['addProduct', 'editProduct', 'removeProduct', 'linkBarcode', 'count'].concat(STOCK_OPS);
const OPS = PRODUCT_OPS.concat(['receive']);
const MAX_QTY = 9999999;
const MAX_MILK_ADD = 450;

function whole(v, label, SaveError, blankOk) {
  const t = text(v, 20).replace(/,/g, '');
  if (!t) { if (blankOk) return null; throw new SaveError('BAD_REQUEST', 'Type ' + label + '.'); }
  const n = Number(t);
  if (!Number.isInteger(n) || n < 0 || n > MAX_QTY) throw new SaveError('BAD_REQUEST', label.charAt(0).toUpperCase() + label.slice(1) + ' must be a whole number.');
  return n;
}

// The product lines typed on a load (Save Load): [{itemId, ordered}].
function validateLines(input, SaveError) {
  if (input === undefined || input === null) return null;
  if (!Array.isArray(input) || input.length > R.MAX_LOAD_LINES) throw new SaveError('BAD_REQUEST', 'A load can have up to ' + R.MAX_LOAD_LINES + ' products.');
  const seen = new Set();
  return input.map(l => {
    const itemId = text(l && l.itemId, 80);
    if (!itemId) throw new SaveError('BAD_REQUEST', 'Pick the product on each line, or remove the line.');
    if (seen.has(itemId)) throw new SaveError('BAD_REQUEST', 'A product is on the load twice. Put its count on one line.');
    seen.add(itemId);
    return { itemId, ordered: whole(l.ordered, 'the amount ordered', SaveError, true) };
  });
}

function validate(input, out, SaveError) {
  if (out.lane !== 'RECEIVING') throw new SaveError('BAD_REQUEST', 'Products and Inventory are on Receiving');
  if (out.op === 'receive') {
    out.id = text(input.id, 120); out.date = text(input.date, 10);
    if (!out.id) throw new SaveError('BAD_REQUEST', 'Pick the load');
    if (!L.isDateKey(out.date)) throw new SaveError('BAD_REQUEST', 'Pick the delivery date.');
    if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > R.MAX_LOAD_LINES) throw new SaveError('BAD_REQUEST', 'Put the products on the load before marking it received.');
    const seen = new Set();
    out.lines = input.lines.map(l => {
      const itemId = text(l && l.itemId, 80);
      if (!itemId || seen.has(itemId)) throw new SaveError('BAD_REQUEST', 'Pick each product once.');
      seen.add(itemId);
      return { itemId, received: whole(l.received, 'the amount received', SaveError) };
    });
    return out;
  }
  if (out.op === 'addMilkProducts') return out;
  if (out.op === 'countMany') {
    if (!Array.isArray(input.counts) || !input.counts.length) throw new SaveError('BAD_REQUEST', 'Type or scan at least one count.');
    if (input.counts.length > R.MAX_COUNT_WALK) throw new SaveError('BAD_REQUEST', 'Save up to ' + R.MAX_COUNT_WALK + ' counts at a time.');
    const seen = new Set();
    out.counts = input.counts.map(c => {
      const itemId = text(c && c.itemId, 80);
      if (!itemId || seen.has(itemId)) throw new SaveError('BAD_REQUEST', 'Each product can be counted once.');
      seen.add(itemId);
      return { itemId, qty: whole(c.qty, 'the count', SaveError) };
    });
    out.area = text(input.area, R.MAX_AREA);
    return out;
  }
  if (out.op !== 'addProduct') { out.itemId = text(input.itemId, 80); if (!out.itemId) throw new SaveError('BAD_REQUEST', 'Pick the product.'); }
  if (out.op === 'use') {
    const t = text(input.qty, 20).replace(/,/g, ''), n = Number(t);
    if (!t) throw new SaveError('BAD_REQUEST', 'Type how many were used.');
    if (!Number.isInteger(n) || n === 0 || Math.abs(n) > MAX_QTY) throw new SaveError('BAD_REQUEST', 'How many used must be a whole number.');
    out.qty = n;
    out.forWhat = text(input.forWhat, 60);
    out.station = text(input.station, 60);
    out.how = input.how === 'SCAN' ? 'SCAN' : 'HAND';
    return out;
  }
  if (out.op === 'setLow') { out.low = whole(input.low, 'the low mark', SaveError, true); return out; }
  if (out.op === 'label') return out;
  if (out.op === 'setPlace') { out.area = text(input.area, R.MAX_AREA); out.spot = text(input.spot, R.MAX_SPOT); return out; }
  if (out.op === 'setUses') {
    if (!Array.isArray(input.uses) || input.uses.length > R.MAX_USES) throw new SaveError('BAD_REQUEST', 'A product can use up to ' + R.MAX_USES + ' things.');
    const seen = new Set();
    out.uses = input.uses.map(u => {
      const itemId = text(u && u.itemId, 80), q = Number(text(u && u.qty, 12).replace(/,/g, ''));
      if (!itemId) throw new SaveError('BAD_REQUEST', 'Pick what it uses on each line, or remove the line.');
      if (itemId === out.itemId) throw new SaveError('BAD_REQUEST', 'A product cannot use itself.');
      if (seen.has(itemId)) throw new SaveError('BAD_REQUEST', 'A product is on the list twice. Put its amount on one line.');
      seen.add(itemId);
      if (!isFinite(q) || q <= 0 || q > 10000 || Math.round(q * 1000) / 1000 !== q) throw new SaveError('BAD_REQUEST', 'How many must be a number above 0 (up to 3 places after the point).');
      return { itemId, qty: q };
    });
    return out;
  }
  if (out.op === 'removeProduct') return out;
  if (out.op === 'count') { out.qty = whole(input.qty, 'the count', SaveError); return out; }
  if (out.op === 'linkBarcode') {
    out.raw = String(input.raw === null || input.raw === undefined ? '' : input.raw).slice(0, 200);
    if (!out.raw.trim()) throw new SaveError('BAD_REQUEST', 'Nothing was scanned.');
    return out;
  }
  out.name = text(input.name, 120);
  if (!out.name) throw new SaveError('BAD_REQUEST', 'Type the product name.');
  out.supplierId = text(input.supplierId, 60);
  out.kind = text(input.kind, 20);
  if (out.kind && R.INVENTORY_KINDS.concat([R.MILK_KIND]).indexOf(out.kind) < 0) throw new SaveError('BAD_REQUEST', 'Kind must be ' + R.INVENTORY_KINDS.join(', '));
  out.unit = text(input.unit, 20);
  if (out.unit && R.INVENTORY_UNITS.indexOf(out.unit) < 0) throw new SaveError('BAD_REQUEST', 'Counted in must be ' + R.INVENTORY_UNITS.join(', '));
  out.low = whole(input.low, 'the low mark', SaveError, true);
  // Where it is kept (Joe 11-10-26). Receiving's own form does not send these, so an edit there keeps what the product has.
  if (input.area !== undefined) out.area = text(input.area, R.MAX_AREA);
  if (input.spot !== undefined) out.spot = text(input.spot, R.MAX_SPOT);
  return out;
}

const activeItem = (x) => x && String(x.status || 'ACTIVE').toUpperCase() !== 'REMOVED';
const moveId = (req, n) => 'MOVE-' + req.requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 24) + '-' + n;

function writeMove(tx, db, id, move) { tx.set(db.collection('inventoryMoves').doc(id), move); }

async function saveProduct(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const items = db.collection('receivingItems'), journal = db.collection('plantJournal');
  const all = (await tx.get(items.where('status', '==', 'ACTIVE'))).docs.map(d => Object.assign({ id: d.id }, d.data()));
  if (STOCK_OPS.indexOf(req.op) >= 0) return stockOp(tx, db, items, all, req, email, stamp, logRef, mode, SaveError);
  const had = req.itemId ? all.find(x => x.id === req.itemId) : null;
  if (req.itemId && !had) throw new SaveError('NOT_FOUND', 'That product is no longer on the list. The list was refreshed.');
  let supplier = null;
  if (req.op === 'addProduct' || req.op === 'editProduct') {
    if (req.supplierId) {
      const sups = R.scheduleSuppliers((await tx.get(journal.where('type', '==', R.SUPPLIER_TYPE))).docs.map(d => d.data()));
      supplier = sups.find(s => s.routeId === req.supplierId) || null;
      if (!supplier && !(had && had.supplierId === req.supplierId)) throw new SaveError('CONFLICT', 'That supplier is no longer on the list. Pick again.');
    }
    if (all.some(x => x.id !== req.itemId && String(x.name || '').toUpperCase() === req.name.toUpperCase())) throw new SaveError('CONFLICT', req.name + ' is already on the list.');
  }
  // All reads are done.
  const was = had ? Object.assign({}, had) : null;
  if (was) delete was.id;
  let id = req.itemId, after, move = null;
  if (req.op === 'addProduct') {
    id = 'ITEM-' + req.requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
    after = { name: req.name, supplierId: req.supplierId, kind: req.kind, unit: req.unit, low: req.low, area: req.area || '', spot: req.spot || '', barcodes: [], status: 'ACTIVE',
      countQty: null, countAt: '', countBy: '', receivedSince: 0, usedSince: 0, createdAt: stamp, createdBy: email, editedAt: stamp, editedBy: email };
  } else if (req.op === 'editProduct') {
    after = Object.assign({}, was, { name: req.name, supplierId: req.supplierId, kind: req.kind, unit: req.unit, low: req.low, editedAt: stamp, editedBy: email });
    if (req.area !== undefined) after.area = req.area;
    if (req.spot !== undefined) after.spot = req.spot;
  } else if (req.op === 'removeProduct') {
    after = Object.assign({}, was, { status: 'REMOVED', editedAt: stamp, editedBy: email });
  } else if (req.op === 'linkBarcode') {
    const p = S.parseScan(req.raw, new Date(stamp)), key = S.barcodeKey(p);
    if (!key) throw new SaveError('BAD_REQUEST', 'That barcode could not be read. Scan it again.');
    const other = all.find(x => x.id !== req.itemId && (x.barcodes || []).indexOf(key) >= 0);
    if (other) throw new SaveError('CONFLICT', 'That barcode is already ' + other.name + '.');
    const barcodes = (was.barcodes || []).slice();
    if (barcodes.indexOf(key) < 0) barcodes.push(key);
    after = Object.assign({}, was, { barcodes, editedAt: stamp, editedBy: email });
  } else {
    // count: what is really there becomes the new starting point.
    const before = R.shouldHave(was);
    after = Object.assign({}, was, { countQty: req.qty, countAt: stamp, countBy: email, receivedSince: 0, madeSince: 0, usedSince: 0, editedAt: stamp, editedBy: email });
    move = { itemId: id, itemName: was.name, kind: 'COUNT', qty: req.qty, change: req.qty - before, before, after: req.qty, date: L.operatingDay(new Date(stamp)), at: stamp, by: email,
      loadId: '', poNumber: '', supplierId: was.supplierId || '', unit: was.unit || '' };
    writeMove(tx, db, moveId(req, 0), move);
  }
  tx.set(items.doc(id), after);
  const result = { ok: true, requestId: req.requestId, itemId: id, status: after.status, name: after.name, shouldHave: R.shouldHave(after) };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, lane: req.lane, op: req.op, itemId: id, before: was, after, move, result });
  return result;
}

// A short code of our own for a product's label (letters and digits, starting UD so it never reads as a supplier's item code).
function newLabelCode(seed, taken) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  for (let tries = 0; tries < 5000; tries++) {
    let code = 'UD', x = (h + tries * 7919) >>> 0;
    for (let i = 0; i < 6; i++) { code += A[x % A.length]; x = (Math.floor(x / A.length) ^ Math.imul(x, 31)) >>> 0; }
    if (!taken.has(code)) return code;
  }
  throw new Error('No label code is free.');
}

async function stockOp(tx, db, items, all, req, email, stamp, logRef, mode, SaveError) {
  let result, log = {};
  if (req.op === 'addMilkProducts') {
    // The plant's Products list (what its lines make), by name; one Inventory product each, once.
    const lines = (await tx.get(db.collection('plantProducts'))).docs.map(d => d.data());
    // All reads are done.
    const have = new Set(all.map(x => String(x.name || '').toUpperCase())), add = [];
    lines.forEach(l => (Array.isArray(l.products) ? l.products : []).forEach(p => {
      const name = text(p && p.name, 120), key = name.toUpperCase();
      if (!name || have.has(key) || /^RAW MILK$/i.test(name)) return;
      have.add(key);
      add.push({ name, sku: text(p.sku, 40) });
    }));
    if (!add.length) throw new SaveError('CONFLICT', all.some(R.isMilk) ? 'Every milk product on the Products list is already in Inventory.' : 'The Products list has no milk products yet. Add them on Line Targets first.');
    add.slice(0, MAX_MILK_ADD).forEach((p, i) => {
      tx.set(items.doc('MILK-' + req.requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 20) + '-' + i), { name: p.name, sku: p.sku, supplierId: '', kind: R.MILK_KIND, unit: 'Cases', low: null,
        barcodes: [], uses: [], status: 'ACTIVE', countQty: null, countAt: '', countBy: '', receivedSince: 0, madeSince: 0, usedSince: 0, createdAt: stamp, createdBy: email, editedAt: stamp, editedBy: email });
    });
    result = { ok: true, requestId: req.requestId, added: Math.min(add.length, MAX_MILK_ADD), more: Math.max(0, add.length - MAX_MILK_ADD) };
    log = { added: add.slice(0, MAX_MILK_ADD).map(p => p.name) };
  } else if (req.op === 'countMany') {
    // The Count Walk: each count is what is really on the shelf, the new starting point, the same as one Count.
    const counted = req.counts.map(c => {
      const was = all.find(x => x.id === c.itemId);
      if (!was) throw new SaveError('NOT_FOUND', 'A product counted is no longer on the list. The list was refreshed; count it again.');
      return { c, was };
    });
    const moves = counted.map(({ c, was }, n) => {
      const before = R.shouldHave(was), next = Object.assign({}, was, { countQty: c.qty, countAt: stamp, countBy: email, receivedSince: 0, madeSince: 0, usedSince: 0, editedAt: stamp, editedBy: email });
      delete next.id;
      tx.set(items.doc(c.itemId), next);
      const move = { itemId: c.itemId, itemName: was.name, kind: 'COUNT', qty: c.qty, change: c.qty - before, before, after: c.qty, date: L.operatingDay(new Date(stamp)), at: stamp, by: email,
        how: 'WALK', area: req.area || text(was.area, R.MAX_AREA), loadId: '', poNumber: '', supplierId: was.supplierId || '', unit: was.unit || '' };
      writeMove(tx, db, moveId(req, n), move);
      return move;
    });
    const off = moves.filter(m => m.change !== 0).length;
    result = { ok: true, requestId: req.requestId, counted: moves.length, different: off };
    log = { area: req.area, moves };
  } else {
    const was = all.find(x => x.id === req.itemId);
    if (!was) throw new SaveError('NOT_FOUND', 'That product is no longer on the list. The list was refreshed.');
    const before = Object.assign({}, was); delete before.id;
    let after, move = null;
    if (req.op === 'use') {
      after = Object.assign({}, before, { usedSince: (Number(was.usedSince) || 0) + req.qty, editedAt: stamp, editedBy: email });
      move = { itemId: req.itemId, itemName: was.name, kind: 'USED', qty: req.qty, change: -req.qty, before: R.shouldHave(was), after: R.shouldHave(after), date: L.operatingDay(new Date(stamp)), at: stamp, by: email,
        how: req.how, forWhat: req.forWhat, station: req.station, loadId: '', poNumber: '', supplierId: was.supplierId || '', unit: was.unit || '' };
      writeMove(tx, db, moveId(req, 0), move);
    } else if (req.op === 'setLow') {
      after = Object.assign({}, before, { low: req.low, editedAt: stamp, editedBy: email });
    } else if (req.op === 'setPlace') {
      after = Object.assign({}, before, { area: req.area, spot: req.spot, editedAt: stamp, editedBy: email });
    } else if (req.op === 'setUses') {
      if (!R.isMilk(was)) throw new SaveError('BAD_REQUEST', 'Only our milk products have a list of what they use.');
      const uses = req.uses.map(u => {
        const it = all.find(x => x.id === u.itemId);
        if (!it) throw new SaveError('CONFLICT', 'Something on the list is no longer a product. Pick again.');
        if (R.isMilk(it)) throw new SaveError('BAD_REQUEST', it.name + ' is one of our milk products. Pick what it is made with.');
        return { itemId: u.itemId, name: it.name, unit: text(it.unit, 20), qty: u.qty };
      });
      after = Object.assign({}, before, { uses, editedAt: stamp, editedBy: email });
    } else {
      // label: the product's own code, kept on it and known as one of its barcodes, so a scan of the label finds it.
      let code = text(was.labelCode, 20);
      after = Object.assign({}, before);
      if (!code) {
        const taken = new Set(); all.forEach(x => { if (x.labelCode) taken.add(x.labelCode); (x.barcodes || []).forEach(b => taken.add(String(b).replace(/^TEXT:/, ''))); });
        code = newLabelCode(req.requestId + req.itemId, taken);
        const key = S.barcodeKey(S.parseScan(code, new Date(stamp))), barcodes = (was.barcodes || []).slice();
        if (key && barcodes.indexOf(key) < 0) barcodes.push(key);
        Object.assign(after, { labelCode: code, barcodes, editedAt: stamp, editedBy: email });
      }
    }
    tx.set(items.doc(req.itemId), after);
    result = { ok: true, requestId: req.requestId, itemId: req.itemId, name: after.name, shouldHave: R.shouldHave(after), labelCode: after.labelCode || '' };
    log = { itemId: req.itemId, before, after, move };
  }
  tx.set(logRef, Object.assign({ action: req.action, by: email, at: stamp, mode: mode.mode, lane: req.lane, op: req.op, result }, log));
  return result;
}

// The product lines a Save Load keeps: each line's name and unit as they are now, what was ordered, and (once received) what came in.
async function linesForSave(tx, db, req, had, SaveError) {
  const hadLines = R.loadLines(had && had.payload);
  if (had && had.payload && had.payload.received) return hadLines;   // a received load keeps what came in
  if (!req.lines) return hadLines;
  if (!req.lines.length) return [];
  const snaps = await tx.getAll(...req.lines.map(l => db.collection('receivingItems').doc(l.itemId)));
  return req.lines.map((l, i) => {
    const it = snaps[i].exists ? snaps[i].data() : null, old = hadLines.find(h => h.itemId === l.itemId);
    if (!activeItem(it) && !old) throw new SaveError('CONFLICT', 'A product on the load is no longer on the list. Pick again.');
    return { itemId: l.itemId, name: it ? it.name : old.name, unit: it ? text(it.unit, 20) : old.unit, ordered: l.ordered, received: null };
  });
}

// Mark Received: the counts go on the load and into Inventory, once.
async function receive(tx, db, req, had, type, email, stamp, logRef, mode, SaveError, appScheduleId) {
  if (!had) throw new SaveError('NOT_FOUND', 'That load is no longer on the Receiving schedule.');
  const p = had.payload || {};
  if (p.received && p.received.at) throw new SaveError('CONFLICT', 'That load is already received. Its products are in Inventory.');
  const refs = req.lines.map(l => db.collection('receivingItems').doc(l.itemId));
  const snaps = await tx.getAll(...refs);
  // All reads are done.
  const hadLines = R.loadLines(p), lines = [], moves = [];
  req.lines.forEach((l, i) => {
    const it = snaps[i].exists ? snaps[i].data() : null, old = hadLines.find(h => h.itemId === l.itemId);
    if (!it) throw new SaveError('CONFLICT', 'A product on the load is no longer on the list.');
    lines.push({ itemId: l.itemId, name: it.name, unit: text(it.unit, 20), ordered: old ? old.ordered : null, received: l.received });
    if (!l.received) return;
    const before = R.shouldHave(it), next = Object.assign({}, it, { receivedSince: (Number(it.receivedSince) || 0) + l.received, editedAt: stamp, editedBy: email });
    tx.set(refs[i], next);
    const move = { itemId: l.itemId, itemName: it.name, kind: 'RECEIVED', qty: l.received, change: l.received, before, after: R.shouldHave(next), date: had.date || req.date, at: stamp, by: email,
      loadId: req.id, poNumber: text(p.poNumber, 40), supplierId: had.routeId || '', supplier: text(had.run, 120), unit: text(it.unit, 20) };
    writeMove(tx, db, moveId(req, i), move);
    moves.push(move);
  });
  const total = lines.reduce((n, l) => n + (l.received || 0), 0);
  const payload = Object.assign({}, p, { lines, received: { at: stamp, by: email }, cases: String(total) });
  const rec = Object.assign({}, had, { payload, recordedAt: stamp, recordedBy: email, createdInApp: true, testEdited: true, editedAt: stamp });
  delete rec.sheetRow; delete rec.cells;
  tx.set(db.collection('plantJournal').doc(appScheduleId(type, req.id)), rec);
  const result = { ok: true, requestId: req.requestId, id: req.id, received: lines.length, total };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, lane: req.lane, op: req.op, scheduleId: req.id, lines, moves: moves.length, result });
  return result;
}

// Joe 11-4-26 (mock-up D): RECEIVED on the Boxing tablet puts what was scanned on that delivery into Inventory, once, the same as
// Mark Received on Receiving. Reads first (a transaction reads before it writes): the delivery's scans and their products.
async function tabletReceivePlan(tx, db, deliveryId) {
  const scans = (await tx.get(db.collection('receivingScans').where('deliveryId', '==', deliveryId))).docs.map(d => d.data())
    .filter(x => x && x.status !== 'REMOVED' && (Number(x.count) || 0) > 0);
  const byItem = {}, unnamed = scans.filter(x => !x.itemId).length;
  scans.filter(x => x.itemId).forEach(x => { byItem[x.itemId] = (byItem[x.itemId] || 0) + (Number(x.count) || 0); });
  const ids = Object.keys(byItem), refs = ids.map(id => db.collection('receivingItems').doc(id));
  const snaps = refs.length ? await tx.getAll(...refs) : [];
  return { ids, refs, snaps, byItem, unnamed };
}
// The writes: each product's received count, one History line each, and the delivery's lines and received mark (on payload).
function applyTabletReceive(tx, db, plan, had, payload, req, email, stamp) {
  const p = had.payload || {}, hadLines = R.loadLines(p), lines = [], moves = [];
  plan.ids.forEach((id, i) => {
    const it = plan.snaps[i] && plan.snaps[i].exists ? plan.snaps[i].data() : null, qty = plan.byItem[id], old = hadLines.find(h => h.itemId === id);
    if (!it || !activeItem(it)) return;
    lines.push({ itemId: id, name: it.name, unit: text(it.unit, 20), ordered: old ? old.ordered : null, received: qty });
    const next = Object.assign({}, it, { receivedSince: (Number(it.receivedSince) || 0) + qty, editedAt: stamp, editedBy: email });
    tx.set(plan.refs[i], next);
    const move = { itemId: id, itemName: it.name, kind: 'RECEIVED', qty, change: qty, before: R.shouldHave(it), after: R.shouldHave(next), date: had.date, at: stamp, by: email, how: 'TABLET',
      loadId: req.id, poNumber: text(p.poNumber, 40), supplierId: had.routeId || '', supplier: text(had.run, 120), unit: text(it.unit, 20) };
    writeMove(tx, db, moveId(req, i), move);
    moves.push(move);
  });
  // Products ordered on the load that were not scanned came in as 0.
  hadLines.filter(h => !lines.some(l => l.itemId === h.itemId)).forEach(h => lines.push(Object.assign({}, h, { received: 0 })));
  const total = lines.reduce((n, l) => n + (l.received || 0), 0);
  Object.assign(payload, { lines, received: { at: stamp, by: email, from: 'TABLET', unnamed: plan.unnamed }, cases: String(total) });
  if (lines.length) payload.product = linesText(lines);
  return { moves: moves.length, total, unnamed: plan.unnamed };
}

// Joe 11-4-26 (mock-up C, and "internal inventory on all my milk products"): what the Production Lines make goes into Inventory by
// itself. Each shift's record (productionRuns) is read after every change; what each product made since the last look goes in as
// MADE on that milk product, and what it uses (its uses list) comes out of the supplies as USED. inventoryProduction/{run} keeps
// what was already put in, so a run is never counted twice, and a lower count (a typing fix) takes the difference back out.
async function bookProduction(db, runDocId, nowIso) {
  return db.runTransaction(async (tx) => {
    const runRef = db.collection('productionRuns').doc(runDocId), bookRef = db.collection('inventoryProduction').doc(runDocId);
    const [rs, bs] = await tx.getAll(runRef, bookRef);
    if (!rs.exists) return null;
    const run = rs.data(), made = R.madeByProduct(run), booked = (bs.exists && bs.data().made) || {};
    const keys = [...new Set(Object.keys(made).concat(Object.keys(booked)))].filter(k => (made[k] || 0) !== (booked[k] || 0));
    if (!keys.length) return null;
    const all = (await tx.get(db.collection('receivingItems').where('status', '==', 'ACTIVE'))).docs.map(d => Object.assign({ id: d.id }, d.data()));
    // All reads are done.
    const stamp = nowIso || new Date().toISOString(), date = run.date || L.operatingDay(new Date(stamp)), next = {}, moves = [];
    const keep = {};   // what is in Inventory now for each product (a product not in Inventory yet is left for later)
    Object.keys(booked).forEach(k => { keep[k] = booked[k]; });
    const change = (it, field, qty, move) => {
      const cur = next[it.id] || Object.assign({}, it);
      const before = R.shouldHave(cur);
      cur[field] = Math.round(((Number(cur[field]) || 0) + qty) * 1000) / 1000;
      next[it.id] = cur;
      moves.push(Object.assign({ itemId: it.id, itemName: it.name, qty, before, after: R.shouldHave(cur), date, at: stamp, by: 'production',
        line: text(run.line, 60), shift: text(run.shiftName, 40), runId: runDocId, loadId: '', poNumber: '', supplierId: it.supplierId || '', unit: text(it.unit, 20) }, move));
    };
    keys.forEach(k => {
      const diff = (made[k] || 0) - (booked[k] || 0);
      const milk = all.find(x => R.isMilk(x) && String(x.name || '').toUpperCase() === k);
      if (!milk) return;
      keep[k] = made[k] || 0;
      change(milk, 'madeSince', diff, { kind: 'MADE', change: diff, how: 'PRODUCTION', product: milk.name });
      (Array.isArray(milk.uses) ? milk.uses : []).forEach(u => {
        const it = all.find(x => x.id === u.itemId);
        if (!it) return;
        const qty = Math.round(diff * (Number(u.qty) || 0) * 1000) / 1000;
        if (qty) change(it, 'usedSince', qty, { kind: 'USED', change: -qty, how: 'PRODUCTION', forWhat: milk.name, product: milk.name });
      });
    });
    Object.keys(next).forEach(id => { const d = Object.assign({}, next[id]); delete d.id; tx.set(db.collection('receivingItems').doc(id), Object.assign(d, { editedAt: stamp, editedBy: 'production' })); });
    moves.forEach((m, i) => writeMove(tx, db, 'MOVE-PROD-' + String(runDocId).replace(/[^A-Za-z0-9_]/g, '').slice(0, 60) + '-' + Date.parse(stamp) + '-' + i, m));
    tx.set(bookRef, { runId: runDocId, line: text(run.line, 60), date, made: keep, at: stamp });
    return { moves: moves.length };
  });
}

// The words a load's products read as on the calendar and in print (and in the older Product and Cases boxes).
function linesText(lines) { return lines.map(l => l.name).filter(Boolean).join(', ').slice(0, 80); }
function linesTotal(lines) { return lines.some(l => l.ordered !== null) ? String(lines.reduce((n, l) => n + (l.ordered || 0), 0)) : ''; }

module.exports = {
  newLabelCode, OPS, PRODUCT_OPS, STOCK_OPS, validate, tabletReceivePlan, applyTabletReceive, bookProduction, validateLines, saveProduct, linesForSave, receive, linesText, linesTotal };
