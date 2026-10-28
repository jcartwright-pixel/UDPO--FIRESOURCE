/*
 * Jug Trailers (Joe 10/28, mock-up 2): the 10 to 20 jug (dry box) trailers parked in the plant's lot, on Debag's screen.
 * Each trailer is one jugTrailers record in the plant's own database: how full it is (Empty, Half Full, Loaded), what is on
 * it (typed lines: item and pallets; a drop-down comes later), notes, and a short history of what changed and who changed it.
 *
 * saveJugTrailer  op 'add'  : a trailer comes into the lot: a United Dairy trailer picked from the main trailer list
 *                             (equipmentId) or a number typed for any other trailer. It is kept here only; the main trailer
 *                             list and the sheets are never changed. A trailer that left the lot earlier comes back on.
 *                 op 'edit' : change its status, what is on it or its notes (each box saves when it is left).
 *                 op 'left' : the trailer left the lot; it goes off the list (its record stays, with its history).
 */
'use strict';

const L = require('./logic');

const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
const docId = (id) => String(id).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 200);
const STATUSES = ['EMPTY', 'HALF', 'LOADED'];
const STATUS_NAME = { EMPTY: 'Empty', HALF: 'Half Full', LOADED: 'Loaded' };
const MAX_LINES = 12;
const MAX_HISTORY = 40;
const plantIds = () => (L.PLANTS || []).map(p => p.id);

// The trailer number as the lot writes it: capitals, no spaces at the ends, inner spaces kept single.
const trailerNumber = (v) => text(v).toUpperCase().replace(/\s+/g, ' ').slice(0, 20);

function validateJugTrailer(input, SaveError) {
  const facilityId = text(input.facilityId);
  if (plantIds().indexOf(facilityId) < 0) throw new SaveError('BAD_REQUEST', 'Pick a plant.');
  const op = text(input.op).toLowerCase();
  if (['add', 'edit', 'left'].indexOf(op) < 0) throw new SaveError('BAD_REQUEST', 'Add a trailer, change one, or say it left the lot.');
  const out = { facilityId, op, fields: {} };
  if (op === 'add') {
    out.number = trailerNumber(input.number);
    out.equipmentId = text(input.equipmentId).slice(0, 120);
    if (!out.number && !out.equipmentId) throw new SaveError('BAD_REQUEST', 'Pick a United Dairy trailer or type the trailer number.');
    if (out.number && !/^[A-Z0-9 -]+$/.test(out.number)) throw new SaveError('BAD_REQUEST', 'A trailer number has only letters, numbers and dashes.');
    return out;
  }
  out.trailerId = text(input.trailerId).slice(0, 200);
  if (!/^[A-Za-z0-9_-]+$/.test(out.trailerId)) throw new SaveError('BAD_REQUEST', 'Pick a trailer.');
  if (op === 'left') return out;
  const f = input.fields && typeof input.fields === 'object' ? input.fields : {};
  Object.keys(f).forEach(k => { if (['status', 'items', 'notes'].indexOf(k) < 0) throw new SaveError('BAD_REQUEST', 'Unknown trailer box: ' + k); });
  if (f.status !== undefined) {
    out.fields.status = text(f.status).toUpperCase();
    if (STATUSES.indexOf(out.fields.status) < 0) throw new SaveError('BAD_REQUEST', 'Pick Empty, Half Full or Loaded.');
  }
  if (f.items !== undefined) {
    if (!Array.isArray(f.items)) throw new SaveError('BAD_REQUEST', 'Send what is on the trailer as a list.');
    out.fields.items = f.items.map(x => ({ item: text(x && x.item).slice(0, 80), pallets: text(x && x.pallets).slice(0, 10) })).filter(x => x.item || x.pallets);
    if (out.fields.items.length > MAX_LINES) throw new SaveError('BAD_REQUEST', 'A trailer holds at most ' + MAX_LINES + ' lines.');
    if (out.fields.items.some(x => x.pallets && !/^\d{1,4}$/.test(x.pallets))) throw new SaveError('BAD_REQUEST', 'Pallets is a whole number.');
  }
  if (f.notes !== undefined) out.fields.notes = text(f.notes).slice(0, 500);
  if (!Object.keys(out.fields).length) throw new SaveError('BAD_REQUEST', 'Nothing to save.');
  return out;
}

// A new line on top of the history. Typing several items is one change: the same person changing what is on it again within
// half an hour moves that line's time instead of adding another.
function said(history, at, by, what) {
  const list = Array.isArray(history) ? history : [], top = list[0];
  if (top && top.by === by && top.what === what && what === 'What is on it changed' && Date.parse(at) - Date.parse(top.at) < 30 * 60000) return [{ at, by, what }].concat(list.slice(1));
  return [{ at, by, what }].concat(list).slice(0, MAX_HISTORY);
}

async function saveJugTrailer(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const by = text(req.saverName) || email;
  let ref, before = null, after;
  if (req.op === 'add') {
    // A United Dairy trailer must still be on the main trailer list; its number comes from there.
    let number = req.number, equipmentId = '';
    if (req.equipmentId) {
      const unit = await tx.get(db.collection('equipment').doc(docId(req.equipmentId)));
      if (!unit.exists || text(unit.data().type).toUpperCase() !== 'TRAILER') throw new SaveError('NOT_FOUND', 'That trailer is not on the main trailer list.');
      equipmentId = unit.id;
      number = trailerNumber(unit.data().unit) || number;
    }
    ref = db.collection('jugTrailers').doc(docId(req.facilityId + '_' + number));
    const had = await tx.get(ref);
    before = had.exists ? had.data() : null;
    if (before && before.inLot) throw new SaveError('CONFLICT', 'Trailer ' + number + ' is already on the list.');
    after = Object.assign({ facilityId: req.facilityId, number, createdAt: stamp, createdBy: email }, before || {}, {
      equipmentId, unitedDairy: !!equipmentId, inLot: true, status: 'EMPTY', items: [], notes: '', arrivedAt: stamp,
      history: said(before && before.history, stamp, by, 'Came into the lot'), updatedAt: stamp, updatedBy: email, testEdited: true
    });
  } else {
    ref = db.collection('jugTrailers').doc(req.trailerId);
    const had = await tx.get(ref);
    if (!had.exists || had.data().facilityId !== req.facilityId || !had.data().inLot) throw new SaveError('NOT_FOUND', 'That trailer is no longer on the list.');
    before = had.data();
    after = Object.assign({}, before, { updatedAt: stamp, updatedBy: email, testEdited: true });
    if (req.op === 'left') {
      after.inLot = false;
      after.leftAt = stamp;
      after.history = said(before.history, stamp, by, 'Left the lot');
    } else {
      Object.assign(after, req.fields);
      if (req.fields.status && req.fields.status !== before.status) after.history = said(before.history, stamp, by, STATUS_NAME[req.fields.status]);
      else if (req.fields.items !== undefined && JSON.stringify(req.fields.items) !== JSON.stringify(before.items || [])) after.history = said(before.history, stamp, by, 'What is on it changed');
    }
  }
  tx.set(ref, after);
  const result = { ok: true, requestId: req.requestId, trailerId: ref.id, number: after.number, inLot: after.inLot };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, op: req.op, trailerId: ref.id, facilityId: req.facilityId, before, after, result });
  return result;
}

module.exports = { validateJugTrailer, saveJugTrailer, STATUSES, STATUS_NAME, trailerNumber };
