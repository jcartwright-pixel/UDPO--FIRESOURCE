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
const PRODUCT_OPS = ['addProduct', 'editProduct', 'removeProduct', 'linkBarcode', 'count'];
const OPS = PRODUCT_OPS.concat(['receive']);
const MAX_QTY = 9999999;

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
  if (out.op !== 'addProduct') { out.itemId = text(input.itemId, 80); if (!out.itemId) throw new SaveError('BAD_REQUEST', 'Pick the product.'); }
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
  if (out.kind && R.INVENTORY_KINDS.indexOf(out.kind) < 0) throw new SaveError('BAD_REQUEST', 'Kind must be ' + R.INVENTORY_KINDS.join(', '));
  out.unit = text(input.unit, 20);
  if (out.unit && R.INVENTORY_UNITS.indexOf(out.unit) < 0) throw new SaveError('BAD_REQUEST', 'Counted in must be ' + R.INVENTORY_UNITS.join(', '));
  out.low = whole(input.low, 'the low mark', SaveError, true);
  return out;
}

const activeItem = (x) => x && String(x.status || 'ACTIVE').toUpperCase() !== 'REMOVED';
const moveId = (req, n) => 'MOVE-' + req.requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 24) + '-' + n;

function writeMove(tx, db, id, move) { tx.set(db.collection('inventoryMoves').doc(id), move); }

async function saveProduct(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const items = db.collection('receivingItems'), journal = db.collection('plantJournal');
  const all = (await tx.get(items.where('status', '==', 'ACTIVE'))).docs.map(d => Object.assign({ id: d.id }, d.data()));
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
    after = { name: req.name, supplierId: req.supplierId, kind: req.kind, unit: req.unit, low: req.low, barcodes: [], status: 'ACTIVE',
      countQty: null, countAt: '', countBy: '', receivedSince: 0, usedSince: 0, createdAt: stamp, createdBy: email, editedAt: stamp, editedBy: email };
  } else if (req.op === 'editProduct') {
    after = Object.assign({}, was, { name: req.name, supplierId: req.supplierId, kind: req.kind, unit: req.unit, low: req.low, editedAt: stamp, editedBy: email });
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
    after = Object.assign({}, was, { countQty: req.qty, countAt: stamp, countBy: email, receivedSince: 0, usedSince: 0, editedAt: stamp, editedBy: email });
    move = { itemId: id, itemName: was.name, kind: 'COUNT', qty: req.qty, change: req.qty - before, before, after: req.qty, date: L.operatingDay(new Date(stamp)), at: stamp, by: email,
      loadId: '', poNumber: '', supplierId: was.supplierId || '', unit: was.unit || '' };
    writeMove(tx, db, moveId(req, 0), move);
  }
  tx.set(items.doc(id), after);
  const result = { ok: true, requestId: req.requestId, itemId: id, status: after.status, name: after.name, shouldHave: R.shouldHave(after) };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, lane: req.lane, op: req.op, itemId: id, before: was, after, move, result });
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

// The words a load's products read as on the calendar and in print (and in the older Product and Cases boxes).
function linesText(lines) { return lines.map(l => l.name).filter(Boolean).join(', ').slice(0, 80); }
function linesTotal(lines) { return lines.some(l => l.ordered !== null) ? String(lines.reduce((n, l) => n + (l.ordered || 0), 0)) : ''; }

module.exports = { OPS, PRODUCT_OPS, validate, validateLines, saveProduct, linesForSave, receive, linesText, linesTotal };
