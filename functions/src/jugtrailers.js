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
 *                 op 'list' : Joe 11/1: add to or delete from the plant's lists (jugTrailerLists): trailer companies and their
 *                             unit numbers, what is on it, locations. United Dairy is protected; nothing a trailer in the lot
 *                             uses can be deleted until it leaves. Rules shared with the screen: jug-rules.js.
 * Joe 11/3 (mock-up 2): op 'add' also takes where it is parked (location, UPPER LOT when none) and what is on it (items: a
 * product from Suppliers & Products, how many, and what it is counted in); a trailer that comes in with something on it is
 * Loaded. NOT HERE is not a location: a trailer that is not here has left the lot (op 'left').
 */
'use strict';

const L = require('./logic');
const J = require('./jug-rules');

const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
const docId = (id) => String(id).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 200);
const STATUSES = ['EMPTY', 'HALF', 'LOADED'];
const STATUS_NAME = { EMPTY: 'Empty', HALF: 'Half Full', LOADED: 'Loaded' };
const MAX_LINES = 12;
const MAX_HISTORY = 40;
const plantIds = () => (L.PLANTS || []).map(p => p.id);

// The trailer number as the lot writes it: capitals, no spaces at the ends, inner spaces kept single.
const trailerNumber = (v) => text(v).toUpperCase().replace(/\s+/g, ' ').slice(0, 20);

const NAME_OK = /^[A-Za-z0-9][A-Za-z0-9 &.,'\/()#-]*$/;
function listText(v, what, max, SaveError) {
  const t = J.text(v).slice(0, max);
  if (!t) throw new SaveError('BAD_REQUEST', 'Type the ' + what + '.');
  if (!NAME_OK.test(t)) throw new SaveError('BAD_REQUEST', 'The ' + what + ' has only letters, numbers, spaces and . , & / - \'.');
  return t;
}

// What is on a trailer: each line's item, how many (kept as pallets, its name before 11/3) and what it is counted in.
function itemLines(list, SaveError) {
  if (!Array.isArray(list)) throw new SaveError('BAD_REQUEST', 'Send what is on the trailer as a list.');
  const out = list.map(x => {
    const line = { item: J.text(x && x.item).slice(0, 80), pallets: text(x && x.pallets).slice(0, 10) }, unit = J.text(x && x.unit).slice(0, 20);
    if (unit) line.unit = unit;
    return line;
  }).filter(x => x.item || x.pallets);
  if (out.length > MAX_LINES) throw new SaveError('BAD_REQUEST', 'A trailer holds at most ' + MAX_LINES + ' lines.');
  if (out.some(x => x.pallets && !/^\d{1,5}$/.test(x.pallets))) throw new SaveError('BAD_REQUEST', 'How many is a whole number.');
  if (out.some(x => x.item && !NAME_OK.test(x.item))) throw new SaveError('BAD_REQUEST', 'An item has only letters, numbers, spaces and . , & / - \' ( ) #.');
  if (out.some(x => x.unit && !/^[A-Za-z ]+$/.test(x.unit))) throw new SaveError('BAD_REQUEST', 'What it is counted in has only letters.');
  return out;
}
function locationOf(v, SaveError) {
  if (!J.text(v)) return '';
  if (J.same(v, J.NOT_HERE)) throw new SaveError('BAD_REQUEST', 'A trailer that is not here has left the lot: press Left the Lot.');
  return listText(v, 'location', 40, SaveError);
}

function validateJugTrailer(input, SaveError) {
  const facilityId = text(input.facilityId);
  if (plantIds().indexOf(facilityId) < 0) throw new SaveError('BAD_REQUEST', 'Pick a plant.');
  const op = text(input.op).toLowerCase();
  if (['add', 'edit', 'left', 'list'].indexOf(op) < 0) throw new SaveError('BAD_REQUEST', 'Add a trailer, change one, say it left the lot, or change a list.');
  const out = { facilityId, op, fields: {} };
  if (op === 'add') {
    // Joe 11/1: the Trailer Company first, then the Unit number. United Dairy's units are picked from the fleet list
    // (equipmentId); any other company's unit is picked or typed (a number typed on its own is still taken, as before 11/1).
    out.location = input.location !== undefined ? locationOf(input.location, SaveError) : '';
    out.items = input.items !== undefined ? itemLines(input.items, SaveError) : [];
    out.equipmentId = text(input.equipmentId).slice(0, 120);
    if (out.equipmentId) return out;
    out.company = text(input.company) ? listText(input.company, 'supplier', 40, SaveError) : '';
    if (out.company && J.same(out.company, J.UD)) throw new SaveError('BAD_REQUEST', 'Pick the United Dairy unit number from the fleet list.');
    out.unit = trailerNumber(input.unit !== undefined ? input.unit : input.number);
    if (!out.unit) throw new SaveError('BAD_REQUEST', out.company ? 'Type the unit number.' : 'Pick the supplier, then the unit number.');
    if (!/^[A-Z0-9 -]+$/.test(out.unit)) throw new SaveError('BAD_REQUEST', 'A unit number has only letters, numbers and dashes.');
    return out;
  }
  if (op === 'list') {
    // Joe 11/1: people add to and delete from the lists (trailer companies and their unit numbers, what is on it, locations).
    out.list = text(input.list).toLowerCase();
    if (['company', 'unit', 'item', 'location'].indexOf(out.list) < 0) throw new SaveError('BAD_REQUEST', 'Pick a list.');
    out.change = text(input.change).toLowerCase();
    if (['add', 'delete'].indexOf(out.change) < 0) throw new SaveError('BAD_REQUEST', 'Add or delete.');
    const what = { company: 'supplier', unit: 'unit number', item: 'item', location: 'location' }[out.list];
    out.value = out.list === 'unit' ? trailerNumber(input.value) : listText(input.value, what, out.list === 'item' ? 80 : 40, SaveError);
    if (out.list === 'unit') {
      if (!out.value) throw new SaveError('BAD_REQUEST', 'Type the unit number.');
      if (!/^[A-Z0-9 -]+$/.test(out.value)) throw new SaveError('BAD_REQUEST', 'A unit number has only letters, numbers and dashes.');
      out.company = listText(input.company, 'supplier', 40, SaveError);
    }
    if ((out.list === 'company' || out.list === 'unit') && J.same(out.list === 'company' ? out.value : out.company, J.UD)) throw new SaveError('BAD_REQUEST', 'United Dairy is protected; its unit numbers come from the fleet list.');
    return out;
  }
  out.trailerId = text(input.trailerId).slice(0, 200);
  if (!/^[A-Za-z0-9_-]+$/.test(out.trailerId)) throw new SaveError('BAD_REQUEST', 'Pick a trailer.');
  if (op === 'left') return out;
  const f = input.fields && typeof input.fields === 'object' ? input.fields : {};
  Object.keys(f).forEach(k => { if (['status', 'items', 'notes', 'location'].indexOf(k) < 0) throw new SaveError('BAD_REQUEST', 'Unknown trailer box: ' + k); });
  if (f.status !== undefined) {
    out.fields.status = text(f.status).toUpperCase();
    if (STATUSES.indexOf(out.fields.status) < 0) throw new SaveError('BAD_REQUEST', 'Pick Empty, Half Full or Loaded.');
  }
  if (f.items !== undefined) out.fields.items = itemLines(f.items, SaveError);
  if (f.location !== undefined) out.fields.location = locationOf(f.location, SaveError);
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

// The plant's lists as they are now (saved, or the starting lists) with what the trailers in the lot use.
function listsRecord(l) {
  return { companies: l.companies.map(c => ({ name: c.name, units: c.units.slice() })), items: l.items.slice(), locations: l.locations.slice() };
}
function addTo(list, v) { if (v && !list.some(x => J.same(x, v))) list.push(v); }

async function saveJugTrailer(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const by = text(req.saverName) || email;
  // Everything is read first: the plant's lists and the trailers in its lot (a delete waits until nothing in the lot uses it).
  const listRef = db.collection('jugTrailerLists').doc(req.facilityId);
  const listDoc = await tx.get(listRef);
  const lot = (await tx.get(db.collection('jugTrailers').where('facilityId', '==', req.facilityId).where('inLot', '==', true))).docs.map(d => Object.assign({ id: d.id }, d.data()));
  const savedLists = listDoc.exists ? listDoc.data() : null;
  const lists = listsRecord(J.lists(savedLists, lot));
  const names = () => lists.companies.map(c => c.name);
  const companyIn = (name) => { let c = lists.companies.find(x => J.same(x.name, name)); if (!c) { c = { name: J.companyName(name), units: [] }; lists.companies.push(c); } return c; };
  let ref = null, before = null, after = null;
  if (req.op === 'list') {
    const one = { company: 'supplier', unit: 'unit number', item: 'item', location: 'location' }[req.list];
    if (req.change === 'delete') {
      const why = J.deleteBlock(req.list, req.value, req.company, lot, names());
      if (why) throw new SaveError('CONFLICT', why);
      if (req.list === 'company') lists.companies = lists.companies.filter(c => !J.same(c.name, req.value));
      else if (req.list === 'unit') { const c = lists.companies.find(x => J.same(x.name, req.company)); if (c) c.units = c.units.filter(u => !J.same(u, req.value)); }
      else if (req.list === 'item') lists.items = lists.items.filter(x => !J.same(x, req.value));
      else lists.locations = lists.locations.filter(x => !J.same(x, req.value));
    } else {
      const there = req.list === 'company' ? lists.companies.some(c => J.same(c.name, req.value))
        : req.list === 'unit' ? !!(lists.companies.find(c => J.same(c.name, req.company)) || { units: [] }).units.some(u => J.same(u, req.value))
        : (req.list === 'item' ? lists.items : lists.locations).some(x => J.same(x, req.value));
      if (there) throw new SaveError('CONFLICT', req.value + ' is already on the ' + one + ' list.');
      if (req.list === 'company') companyIn(req.value);
      else if (req.list === 'unit') companyIn(req.company).units.push(req.value);
      else (req.list === 'item' ? lists.items : lists.locations).push(req.value);
    }
  } else if (req.op === 'add') {
    // A United Dairy trailer must still be on the main trailer list; its number comes from there.
    let company, unit, equipmentId = '';
    if (req.equipmentId) {
      // Joe 11/3: our trailers are matched by number the one way (T-822 is the trailer saved as 822 before).
      const fleet = await tx.get(db.collection('equipment').doc(docId(req.equipmentId)));
      if (!fleet.exists || text(fleet.data().type).toUpperCase() !== 'TRAILER') throw new SaveError('NOT_FOUND', 'That trailer is not on the main trailer list.');
      equipmentId = fleet.id;
      company = J.UD;
      unit = J.udUnit(fleet.data().unit);
    } else if (req.company) {
      const c = companyIn(req.company);
      company = c.name;
      unit = req.unit;
      addTo(c.units, unit);
    } else {
      // A number typed on its own (before 11/1): read the way old trailers are read ("METRO 4579" = Metro 4579).
      const p = J.parts({ number: req.unit }, names());
      company = p.company; unit = p.unit;
      if (!p.unitedDairy) addTo(companyIn(company).units, unit);
    }
    const number = J.number(company, unit);
    ref = db.collection('jugTrailers').doc(docId(req.facilityId + '_' + number));
    const had = await tx.get(ref);
    before = had.exists ? had.data() : null;
    const twin = J.same(company, J.UD) && lot.find(x => x.id !== ref.id && J.parts(x, names()).unitedDairy && J.same(J.parts(x, names()).unit, unit));
    if (twin) throw new SaveError('CONFLICT', 'Trailer ' + unit + ' is already on the list.');
    if (before && before.inLot) throw new SaveError('CONFLICT', 'Trailer ' + (J.same(company, J.UD) ? '' : company + ' ') + unit + ' is already on the list.');
    after = Object.assign({ facilityId: req.facilityId, createdAt: stamp, createdBy: email }, before || {}, {
      number, company, unit, equipmentId, unitedDairy: !!equipmentId || J.same(company, J.UD), inLot: true, status: req.items && req.items.length ? 'LOADED' : 'EMPTY', items: req.items || [], notes: '', location: req.location || 'UPPER LOT', arrivedAt: stamp,
      history: said(before && before.history, stamp, by, 'Came into the lot' + (req.location ? ' at ' + req.location : '')), updatedAt: stamp, updatedBy: email, testEdited: true
    });
  } else {
    ref = db.collection('jugTrailers').doc(req.trailerId);
    const had = await tx.get(ref);
    if (!had.exists || had.data().facilityId !== req.facilityId || !had.data().inLot) throw new SaveError('NOT_FOUND', 'That trailer is no longer on the list.');
    before = had.data();
    // A trailer saved before 11/1 is written the new way the first time it changes: company, unit, "IN DOCK" as its location.
    const p = J.parts(before, names());
    after = Object.assign({}, before, { company: p.company, unit: p.unit, items: p.items, location: p.location, updatedAt: stamp, updatedBy: email, testEdited: true });
    if (req.op === 'left') {
      after.inLot = false;
      after.leftAt = stamp;
      after.history = said(before.history, stamp, by, 'Left the lot');
    } else {
      Object.assign(after, req.fields);
      // A new location typed on a trailer goes on its list for the next person. Joe 11/3: new items are added on Suppliers &
      // Products, so what is on a trailer is not copied to the plant's own list.
      addTo(lists.locations, req.fields.location);
      if (req.fields.status && req.fields.status !== before.status) after.history = said(before.history, stamp, by, STATUS_NAME[req.fields.status]);
      else if (req.fields.items !== undefined && JSON.stringify(req.fields.items) !== JSON.stringify(p.items)) after.history = said(before.history, stamp, by, 'What is on it changed');
      else if (req.fields.location !== undefined && req.fields.location !== p.location) after.history = said(before.history, stamp, by, req.fields.location ? 'Moved to ' + req.fields.location : 'Location cleared');
    }
  }
  const listsAfter = listsRecord(J.lists(lists, []));
  const listsChanged = JSON.stringify(listsAfter) !== JSON.stringify(savedLists ? listsRecord(J.lists(savedLists, [])) : null);
  if (listsChanged) tx.set(listRef, Object.assign({ facilityId: req.facilityId }, listsAfter, { updatedAt: stamp, updatedBy: email, testEdited: true }));
  if (ref) tx.set(ref, after);
  const result = { ok: true, requestId: req.requestId, trailerId: ref ? ref.id : '', number: after ? after.number : '', inLot: after ? after.inLot : false };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, op: req.op, trailerId: ref ? ref.id : '', facilityId: req.facilityId, before, after,
    lists: listsChanged ? { before: savedLists, after: listsAfter } : null, result });
  return result;
}

module.exports = { validateJugTrailer, saveJugTrailer, STATUSES, STATUS_NAME, trailerNumber };
