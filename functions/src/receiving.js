/*
 * Receiving scan-in (Joe 10/13, mock-up A "Scan list"; office mock-up E "Receiving Log").
 *
 * Receiving brings in packaging and ingredients (cardboard, jugs, anything not made in-house). On the Boxing station's Receiving
 * tab, a delivery on the Scheduler's Receiving list is started, then each case or pallet label is scanned with the Wasp scanner
 * or the tablet's camera. Each scan saves itself:
 *   - receivingScans/{scanId}: one line on the delivery: the item, lot, dates and cases. The tablet makes the scanId, so a scan
 *     made with no signal (offline-saves.js) is the same line when it is sent. The same item and lot scanned again adds a case
 *     to its line (op add), a pallet label is always its own line with its count;
 *   - receivingItems/{itemId}: what the plant receives, each with the barcodes it has been scanned with. A barcode the plant has
 *     never seen asks "Which item is it?" once (op name), and the app knows it from then on.
 * The raw scan is read again here (scan-rules.js), so what is saved never depends on what the tablet made of it.
 */
'use strict';

const S = require('./scan-rules');
const R = require('./plant-rules');

const text = (v, max) => String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 80);
const ID = /^[A-Za-z0-9_-]{8,80}$/;
const OPS = ['scan', 'add', 'count', 'remove', 'name'];
const ITEM_OPS = ['edit', 'remove'];

function wholeNumber(v, min, max, label, SaveError) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new SaveError('BAD_REQUEST', label + ' must be a whole number from ' + min + ' to ' + max);
  return n;
}

function validateReceiving(input, SaveError) {
  const out = { op: text(input.op, 10) };
  if (OPS.indexOf(out.op) < 0) throw new SaveError('BAD_REQUEST', 'op must be ' + OPS.join(', '));
  out.scanId = text(input.scanId, 80);
  if (!ID.test(out.scanId)) throw new SaveError('BAD_REQUEST', 'Each scan needs a scanId');
  if (out.op === 'scan') {
    out.deliveryId = text(input.deliveryId, 80);
    if (!out.deliveryId) throw new SaveError('BAD_REQUEST', 'Start the delivery before scanning.');
    out.raw = String(input.raw === null || input.raw === undefined ? '' : input.raw).slice(0, 200);
    if (!out.raw.trim()) throw new SaveError('BAD_REQUEST', 'Nothing was scanned.');
    out.station = text(input.station, 60);
  }
  if (out.op === 'add') out.delta = wholeNumber(input.delta, -9999, 9999, 'The change', SaveError);
  if (out.op === 'count') out.count = wholeNumber(input.count, 0, 99999, 'Cases', SaveError);
  if (out.op === 'name') {
    out.itemId = text(input.itemId, 80);
    out.newItem = text(input.newItem, 120);
    if (!out.itemId && !out.newItem) throw new SaveError('BAD_REQUEST', 'Pick the item, or type the new item\'s name.');
  }
  return out;
}

function validateReceivingItem(input, SaveError) {
  const out = { op: text(input.op, 10), itemId: text(input.itemId, 80) };
  if (ITEM_OPS.indexOf(out.op) < 0) throw new SaveError('BAD_REQUEST', 'op must be edit or remove');
  if (!out.itemId) throw new SaveError('BAD_REQUEST', 'Pick the item.');
  if (out.op === 'edit') {
    out.name = text(input.name, 120);
    if (!out.name) throw new SaveError('BAD_REQUEST', 'Type the item\'s name.');
  }
  return out;
}

const active = (x) => x && x.status !== 'REMOVED';

async function saveReceiving(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const scans = db.collection('receivingScans'), items = db.collection('receivingItems');
  const ref = scans.doc(req.scanId), had = await tx.get(ref), was = had.exists ? had.data() : null;
  let after;
  if (req.op === 'scan') {
    if (was) throw new SaveError('CONFLICT', 'That scan is already saved.');
    const recs = (await tx.get(db.collection('plantJournal').where('recordId', '==', req.deliveryId))).docs.map(d => d.data());
    const delivery = R.newestRecords(recs, [R.LOAD_TYPE.RECEIVING])[req.deliveryId];
    if (!delivery || delivery.status === 'DELETED') throw new SaveError('NOT_FOUND', 'That delivery is no longer on the Receiving schedule.');
    const known = (await tx.get(items.where('status', '==', 'ACTIVE'))).docs.map(d => Object.assign({ id: d.id }, d.data()));
    const p = S.parseScan(req.raw, new Date(stamp)), key = S.barcodeKey(p);
    const item = known.find(x => (x.barcodes || []).indexOf(key) >= 0) || null;
    const payload = delivery.payload || {};
    after = {
      scanId: req.scanId, status: 'ACTIVE', facilityId: delivery.facilityId || 'fac_uniontown', deliveryId: req.deliveryId, date: delivery.date,
      supplier: text(delivery.run, 120), supplierCode: text(delivery.route, 20), po: text(payload.poNumber, 40) || text(p.po, 40),
      kind: p.kind, raw: text(p.raw, 200), barcode: key, gtin: p.gtin || p.contentGtin || '', lot: text(p.lot, 40), made: p.made || p.packed || '',
      bestBy: p.bestBy || p.useBy || p.sellBy || '', sscc: p.sscc || '', labelCount: p.count || null, count: S.scanQuantity(p),
      itemId: item ? item.id : '', itemName: item ? item.name : '', at: stamp, by: email, station: req.station, editedAt: stamp, editedBy: email
    };
    tx.set(ref, after);
  } else {
    if (!active(was)) throw new SaveError('NOT_FOUND', 'That scan was removed.');
    if (req.op === 'name') {
      const all = (await tx.get(items.where('status', '==', 'ACTIVE'))).docs.map(d => Object.assign({ id: d.id }, d.data()));
      const same = (await tx.get(scans.where('deliveryId', '==', was.deliveryId))).docs.map(d => Object.assign({ _ref: d.ref }, d.data()));
      let item;
      if (req.itemId) {
        item = all.find(x => x.id === req.itemId);
        if (!item) throw new SaveError('NOT_FOUND', 'That item is no longer on the list. Pick again.');
      } else {
        item = all.find(x => x.name.toUpperCase() === req.newItem.toUpperCase());
        if (!item) {
          const id = 'ITEM-' + req.requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
          item = { id, name: req.newItem, barcodes: [], status: 'ACTIVE', facilityId: was.facilityId, createdAt: stamp, createdBy: email };
        }
      }
      // All reads are done.
      const barcodes = (item.barcodes || []).slice();
      if (was.barcode && barcodes.indexOf(was.barcode) < 0) barcodes.push(was.barcode);
      const saved = Object.assign({}, item, { barcodes, editedAt: stamp, editedBy: email });
      delete saved.id;
      tx.set(items.doc(item.id), saved);
      // The same barcode on this delivery takes the item too.
      same.filter(s => active(s) && s.scanId !== req.scanId && !s.itemId && s.barcode && s.barcode === was.barcode)
        .forEach(s => tx.set(s._ref, { itemId: item.id, itemName: item.name, editedAt: stamp, editedBy: email }, { merge: true }));
      after = Object.assign({}, was, { itemId: item.id, itemName: item.name, editedAt: stamp, editedBy: email });
    } else {
      const count = req.op === 'remove' ? was.count : req.op === 'count' ? req.count : Math.min(99999, Math.max(0, (Number(was.count) || 0) + req.delta));
      after = Object.assign({}, was, { count, status: req.op === 'remove' || count === 0 ? 'REMOVED' : 'ACTIVE', editedAt: stamp, editedBy: email });
    }
    tx.set(ref, after);
  }
  const result = { ok: true, requestId: req.requestId, scanId: req.scanId, status: after.status, count: after.count, itemId: after.itemId, itemName: after.itemName, kind: after.kind };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, op: req.op, scanId: req.scanId, before: was, after, result });
  return result;
}

async function saveReceivingItem(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const items = db.collection('receivingItems'), ref = items.doc(req.itemId), had = await tx.get(ref);
  if (!had.exists || had.data().status === 'REMOVED') throw new SaveError('NOT_FOUND', 'That item is no longer on the list.');
  const was = had.data();
  if (req.op === 'edit') {
    const all = (await tx.get(items.where('status', '==', 'ACTIVE'))).docs;
    if (all.some(d => d.id !== req.itemId && String(d.data().name || '').toUpperCase() === req.name.toUpperCase())) throw new SaveError('CONFLICT', req.name + ' is already on the list.');
  }
  const after = Object.assign({}, was, req.op === 'edit' ? { name: req.name } : { status: 'REMOVED' }, { editedAt: stamp, editedBy: email });
  tx.set(ref, after);
  const result = { ok: true, requestId: req.requestId, itemId: req.itemId, status: after.status, name: after.name };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, op: req.op, itemId: req.itemId, before: was, after, result });
  return result;
}

module.exports = { validateReceiving, saveReceiving, validateReceivingItem, saveReceivingItem };
