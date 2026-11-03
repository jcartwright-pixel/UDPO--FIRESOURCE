import { start, requireSignIn, save, escapeHtml, dateTimeText, showError, goLiveNote, optionTag, maySave, watchPerson } from './app.js';
import { doc, onSnapshot, collection, query, where } from './firebase.js';
import { plantFor } from './pmaint.js';

// Plant Material Trailers (Joe 10/28, mock-up 2; first called Jug Trailers): the dry box trailers parked in the plant's lot, in Inventory under Shipping & Receiving (Joe 10/31; it was on Debag / Labeling Room). The list on the left
// says how full each one is and what is on it; the trailer picked opens on the right: Empty / Half Full / Loaded, a line for
// each item with how many, its location, notes, Left the Lot and its history.
// Joe 11/1 (mock-up 2, "Trailer Company"): the list starts with the company and the Unit number. Edit Lists adds to and
// deletes from the lists (companies and their units, items, locations); United Dairy is protected, and nothing a trailer in the
// lot uses can be deleted until it leaves (jug-rules.js, shared with the server).
// Joe 11/3 (mock-up 2): the company is the Supplier. Every United Dairy dry box trailer at the plant is always on the list, NOT
// HERE (grey, at the bottom) when it is not in the lot; Edit on any line changes where it is (UPPER LOT, LOWER LOT, DEBAG, HOLD,
// NOT HERE), so a trailer pulling in or leaving is one change. + Add Trailer has the Supplier and Unit side by side; for United
// Dairy the number is typed and our trailers that match come up (014 is T-14). What is on it is a product from Receiving's
// Suppliers & Products with how many in what it is counted in (bundles); + Add Product and the Suppliers & Products button open
// that screen. The All trailers drop-down is gone. Everything shows in capitals.
// Everything is kept on this plant's own lists only (jugtrailers.js), never on the main trailer list or the sheets.
const L = window.UDLogic;
const R = window.UDPlant;
const J = window.UDJug;
const STATUS = [['EMPTY', 'Empty'], ['HALF', 'Half Full'], ['LOADED', 'Loaded']];
const NEW = '__new';
const FLEET = 'fleet_';
const PRODUCTS_URL = 'scheduler.html?lane=receiving&view=products';
const statusName = (s) => (STATUS.find(x => x[0] === s) || [s, s])[1];
const params = new URLSearchParams(location.search);
let plant = params.get('plant') || '', chosen = params.get('trailer') || '', person = null, app = {}, db = null;
let trailers = null, units = [], savedLists = null, supplierDocs = [], products = [], mode = '', stops = [];
// What is being typed on + Add Trailer, kept while the screen redraws; the line whose location is being changed (Edit);
// a Location being typed new on the trailer card.
const NO_ADD = () => ({ company: '', companyNew: '', number: '', equipmentId: '', item: '', count: '' });
let add = NO_ADD(), editing = '', editValue = '', newLocation = false;
let busy = Promise.resolve();
const canSave = () => maySave(person, L.SAVE_ROLES.concat(['PLANT_EMPLOYEE']), app, 'plant');
const setUrl = () => history.replaceState(null, '', '?plant=' + encodeURIComponent(plant) + (chosen ? '&trailer=' + encodeURIComponent(chosen) : ''));
const lists = () => J.lists(savedLists, trailers || []);
const names = () => lists().companies.map(c => c.name);
const parts = (t) => J.parts(t, names());
const nameOf = (p) => p.company + ' ' + p.unit;
const byNumber = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
const sorted = (list) => list.map(t => ({ t, p: parts(t) })).sort((a, b) => J.order(a.p, b.p));
const pickFrom = (list, current, newLabel) => optionTag('', current, '') + list.map(v => optionTag(v, current, v)).join('') + (newLabel ? optionTag(NEW, current, newLabel) : '');
const productsHref = () => PRODUCTS_URL + (plant ? '&plant=' + encodeURIComponent(plant) : '');

// Receiving's suppliers (Suppliers & Products) and the plant's own trailer companies, for the Supplier drop-down.
function supplierNames() {
  const out = [];
  (R ? R.scheduleSuppliers(supplierDocs) : []).map(s => s.name).concat(names()).forEach(n => { if (n && !J.same(n, J.UD) && !out.some(x => J.same(x, n))) out.push(n); });
  return out.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true }));
}
// The products on Suppliers & Products, by supplier; then the plant's own items that are not products (kept from before 11/3).
function productGroups() {
  const sups = R ? R.scheduleSuppliers(supplierDocs) : [], groups = [];
  const live = products.filter(i => String(i.status || 'ACTIVE').toUpperCase() !== 'REMOVED' && i.name);
  sups.forEach(s => { const list = live.filter(i => String(i.supplierId || '') === s.routeId); if (list.length) groups.push([s.name, list.map(i => [i.name, i.unit || ''])]); });
  const loose = live.filter(i => !sups.some(s => s.routeId === String(i.supplierId || '')));
  if (loose.length) groups.push(['Other products', loose.map(i => [i.name, i.unit || ''])]);
  const seen = (n) => groups.some(g => g[1].some(x => J.same(x[0], n)));
  const own = lists().items.filter(n => !seen(n));
  if (own.length) groups.push(['Other items', own.map(n => [n, ''])]);
  groups.forEach(g => g[1].sort((a, b) => byNumber(a[0], b[0])));
  return groups;
}
// What a product is counted in (Bundles), '' when it is not a product.
const countedIn = (item) => { const p = products.find(i => J.same(i.name, item)); return p ? (p.unit || '') : ''; };
const lineUnit = (x) => countedIn(x.item) || x.unit || 'Pallets';
function productOptions(current) {
  const groups = productGroups();
  let h = optionTag('', current, '');
  groups.forEach(([g, list]) => { h += '<optgroup label="' + escapeHtml(g) + '">' + list.map(([n, u]) => optionTag(n, current, n + (u ? ' (' + u + ')' : ''))).join('') + '</optgroup>'; });
  if (current && !groups.some(g => g[1].some(x => x[0] === current))) h += optionTag(current, current, current);
  return h;
}
const whatOn = (p) => p.items.filter(x => x.item).map(x => x.item + (x.pallets ? ', ' + x.pallets + ' ' + lineUnit(x) : '')).join('; ');

// This plant's trailers on the fleet list (United Dairy's), active.
function fleetHere() {
  return units.filter(u => u.status !== 'INACTIVE' && (L.plantOfLocation(u.location) || u.facilityId) === plant && u.unit).sort((a, b) => byNumber(a.unit, b.unit));
}
// The list: every United Dairy dry box trailer here (in the lot or NOT HERE), then the other suppliers' trailers in the lot.
function model() {
  const lot = sorted(trailers || []), ud = [], used = new Set();
  const inLot = lot.filter(x => x.p.unitedDairy);
  fleetHere().filter(J.dryBox).forEach(eq => {
    const key = J.udUnit(eq.unit), hit = inLot.find(x => J.same(x.p.unit, key));
    if (hit) { used.add(hit.t.id); ud.push({ key: hit.t.id, t: hit.t, p: hit.p, eq, here: true }); }
    else if (!ud.some(r => J.same(r.p.unit, key))) ud.push({ key: FLEET + eq.id, t: null, p: { company: J.UD, unit: key, items: [], location: J.NOT_HERE, unitedDairy: true }, eq, here: false });
  });
  inLot.filter(x => !used.has(x.t.id)).forEach(x => ud.push({ key: x.t.id, t: x.t, p: x.p, eq: null, here: true }));
  ud.sort((a, b) => (a.here ? 0 : 1) - (b.here ? 0 : 1) || byNumber(a.p.unit, b.p.unit));
  const other = lot.filter(x => !x.p.unitedDairy).map(x => ({ key: x.t.id, t: x.t, p: x.p, eq: null, here: true }));
  return { ud, other };
}
const rowOf = (key) => { const m = model(); return m.ud.concat(m.other).find(r => r.key === key) || null; };
const trailer = () => { const r = rowOf(chosen); return r && r.t; };

function drawTop() {
  const pl = plantFor(person, plant);
  if (plant !== pl.id) { plant = pl.id; setUrl(); }
  document.getElementById('plant-name').textContent = pl.name;
  document.getElementById('add').disabled = !canSave();
  document.getElementById('edit-lists').disabled = !canSave();
  document.getElementById('products').href = productsHref();
  const st = L.screenState(app, 'plant');
  goLiveNote(st.live && st.owner !== 'new');
  document.getElementById('mode-text').textContent = st.live ? (st.open ? 'LIVE' : 'VIEW ONLY') : 'TEST COPY';
}

function drawList() {
  const all = trailers || [], n = (s) => all.filter(t => t.status === s).length;
  const m = model(), away = m.ud.filter(r => !r.here).length, dis = canSave() ? '' : ' disabled';
  document.getElementById('sum').innerHTML = '<span><b>' + all.length + '</b>trailer' + (all.length === 1 ? '' : 's') + ' in the lot</span>' + STATUS.slice().reverse().map(([k, w]) => '<span><b>' + n(k) + '</b>' + w + '</span>').join('') +
    (away ? '<span><b>' + away + '</b>United Dairy not here</span>' : '');
  const where = (r) => {
    if (r.key !== editing) return escapeHtml(r.here ? r.p.location : J.NOT_HERE);
    const cur = editValue || (r.here ? r.p.location : J.NOT_HERE), locs = lists().locations;
    return '<select class="jt-in jt-loc" data-loc="' + escapeHtml(r.key) + '" aria-label="Where it is"' + dis + '>' + (cur && !locs.concat([J.NOT_HERE]).some(x => J.same(x, cur)) ? optionTag(cur, cur, cur) : '') +
      locs.map(v => optionTag(v, cur, v)).join('') + optionTag(J.NOT_HERE, cur, J.NOT_HERE) + '</select>';
  };
  const line = (r) => '<tr class="pick' + (r.here ? '' : ' jt-out') + (r.key === chosen && !mode ? ' on' : '') + (r.key === editing ? ' jt-editing' : '') + '" data-id="' + escapeHtml(r.key) + '">' +
    '<td class="nowrap' + (r.p.unitedDairy ? ' jt-ud' : '') + '"><b>' + escapeHtml(r.p.company) + '</b></td>' +
    '<td class="nowrap"><span class="jt-phone jt-phone-co">' + escapeHtml(r.p.company) + '</span><b>' + escapeHtml(r.p.unit) + '</b>' + (r.t ? '<span class="pm-pill jt-' + escapeHtml(r.t.status) + ' jt-phone">' + escapeHtml(statusName(r.t.status)) + '</span>' + (whatOn(r.p) ? '<span class="jt-phone jt-phone-what">' + escapeHtml(whatOn(r.p)) + '</span>' : '') : '') + '</td>' +
    '<td class="nowrap">' + (r.t ? '<span class="pm-pill jt-' + escapeHtml(r.t.status) + '">' + escapeHtml(statusName(r.t.status)) + '</span>' : '') + '</td>' +
    '<td>' + (!r.t ? '' : whatOn(r.p) ? escapeHtml(whatOn(r.p)) : '<span class="jt-none">Nothing on it</span>') + '</td>' +
    '<td class="nowrap">' + where(r) + '</td>' +
    '<td class="nowrap jt-editcell">' + (r.key === editing ? '<button type="button" class="jt-edit save" data-save="' + escapeHtml(r.key) + '"' + dis + '>Save</button>' : '<button type="button" class="jt-edit" data-edit="' + escapeHtml(r.key) + '"' + dis + '>Edit</button>') + '</td></tr>';
  let h = '';
  if (m.ud.length) h += '<tr class="jt-grp"><td colspan="6">United Dairy trailers · ' + m.ud.filter(r => r.here).length + ' here · ' + away + ' not here</td></tr>' + m.ud.map(line).join('');
  if (m.other.length) h += '<tr class="jt-grp"><td colspan="6">Other suppliers · ' + m.other.length + ' in the lot</td></tr>' + m.other.map(line).join('');
  document.getElementById('rows').innerHTML = h ||
    '<tr><td colspan="6" class="empty">' + (!trailers ? 'Reading the trailers in the lot…' : 'No trailers in the lot yet. + Add Trailer puts the first one on the list.') + '</td></tr>';
}

// Our dry box trailers that are not in the lot and whose number starts with what was typed (98 finds T-980, T-985...).
function matches(typed) {
  const t = J.udUnit(typed), digits = t.indexOf('T-') === 0 ? t.slice(2) : '';
  if (!digits) return [];
  return model().ud.filter(r => !r.here && r.eq && r.p.unit.slice(2).startsWith(digits)).map(r => r.eq);
}
// The trailer typed: the one picked, else the one whose number is exactly what was typed.
function addTrailer() {
  const typed = J.udUnit(add.number), list = matches(add.number);
  return list.find(u => u.id === add.equipmentId && J.same(J.udUnit(u.unit), typed)) || list.find(u => J.same(J.udUnit(u.unit), typed)) || null;
}
function matchHtml() {
  if (add.company !== J.UD || !add.number.trim()) return '';
  const list = matches(add.number), pick = addTrailer();
  if (!list.length) {
    const here = model().ud.find(r => r.here && J.same(r.p.unit, J.udUnit(add.number)));
    return '<span class="jt-help">' + escapeHtml(here ? here.p.unit + ' is already in the lot.' : J.udUnit(add.number) + ' is not one of our ' + (plantFor(person, plant).name || '') + ' dry box trailers. Check the number on the trailer.') + '</span>';
  }
  return list.slice(0, 12).map(u => '<button type="button" class="jt-matchbtn' + (pick && pick.id === u.id ? ' on' : '') + '" data-match="' + escapeHtml(u.id) + '">' + escapeHtml(J.udUnit(u.unit)) + '</button>').join('') +
    (list.length > 12 ? '<span class="jt-help">and ' + (list.length - 12) + ' more: type more of the number</span>' : '');
}

function drawAdd(card, dis) {
  const sups = supplierNames(), co = lists().companies.find(c => J.same(c.name, add.company));
  const unitWord = countedIn(add.item);
  let h = '<div class="mach-title"><h2>Add a trailer</h2></div><div class="jt-pair">' +
    '<label><span class="jt-step"><b>1</b>Supplier</span><select class="jt-in" id="add-company"' + dis + '>' +
    optionTag('', add.company, '') + optionTag(J.UD, add.company, J.UD) + sups.map(n => optionTag(n, add.company, n)).join('') + optionTag(NEW, add.company, '+ New supplier…') + '</select></label>' +
    '<label><span class="jt-step"><b>2</b>Unit number</span><input class="jt-in jt-bignum" id="add-number" maxlength="20" autocomplete="off" inputmode="' + (add.company === J.UD ? 'numeric' : 'text') + '"' +
    (co ? ' list="add-units"' : '') + ' value="' + escapeHtml(add.number) + '" placeholder="Type the number"' + (add.company ? '' : ' disabled') + dis + '>' +
    (co ? '<datalist id="add-units">' + co.units.map(u => '<option value="' + escapeHtml(u) + '">').join('') + '</datalist>' : '') + '</label></div>';
  if (add.company === NEW) h += '<div class="jt-add"><label>New supplier name<input class="jt-in" id="add-company-new" maxlength="40" autocomplete="off" value="' + escapeHtml(add.companyNew) + '"' + dis + '></label></div>';
  h += '<div class="jt-match" id="add-match">' + matchHtml() + '</div>' +
    '<div class="jt-prod"><label><span class="jt-step"><b>3</b>What is on it</span><select class="jt-in" id="add-item"' + dis + '>' + productOptions(add.item) + '</select></label>' +
    '<label><span class="jt-step"><b>4</b>How many' + (unitWord ? ' ' + escapeHtml(unitWord) : '') + '</span><input class="jt-in jt-bignum" id="add-count" inputmode="numeric" maxlength="5" autocomplete="off" value="' + escapeHtml(add.count) + '"' + dis + '></label>' +
    '<a class="pm-btn jt-addprod" href="' + escapeHtml(productsHref()) + '">+ Add Product</a></div>' +
    '<div class="jt-row"><button type="button" class="pm-btn pri" id="add-go"' + dis + '>Add to the Lot</button><button type="button" class="pm-btn" id="add-cancel">Cancel</button></div>' +
    '<p class="jt-help">' + (add.company === J.UD ? 'United Dairy: type the number; the T- goes on by itself. Only our dry box trailers that are not in the lot come up. Tap the one you mean.'
      : add.company ? 'Type the unit number. A new supplier or unit number is saved so the next person can pick it.'
        : 'Pick the supplier first, then the unit number. What is on it comes from Suppliers & Products; + Add Product opens it to add a new one.') +
    ' It goes in at ' + escapeHtml(J.LOCATIONS[0]) + '; Edit on its line moves it.</p>';
  card.innerHTML = h;
}

// Edit Lists (Joe 11/1): add to and delete from the lists. United Dairy is protected; anything a trailer in the lot uses
// shows why it cannot be deleted yet instead of a Delete button.
function drawLists(card, dis) {
  const l = lists(), lot = trailers || [], nm = names();
  const del = (list, value, company, label) => {
    const why = J.deleteBlock(list, value, company, lot, nm);
    return why ? '<span class="jt-lock" title="' + escapeHtml(why) + '">' + (list === 'location' && J.LOCATIONS.some(x => J.same(x, value)) ? 'Kept' : 'In the lot') + '</span>'
      : '<button type="button" class="jt-del" data-list="' + list + '" data-value="' + escapeHtml(value) + '" data-company="' + escapeHtml(company || '') + '"' + dis + '>' + escapeHtml(label || 'Delete') + '</button>';
  };
  const chips = (list, values, company) => values.map(v => '<span class="jt-chip">' + escapeHtml(v) + del(list, v, company) + '</span>').join('') || '<span class="pm-muted">None yet</span>';
  const addBox = (list, company, placeholder) => '<span class="jt-addbox"><input class="jt-in" data-add-list="' + list + '" data-company="' + escapeHtml(company || '') + '" maxlength="' + (list === 'item' ? 80 : 40) + '" autocomplete="off" placeholder="' + placeholder + '"' + dis + '><button type="button" class="pm-btn" data-add-go="' + list + '"' + dis + '>Add</button></span>';
  let h = '<div class="mach-title"><h2>Edit Lists</h2></div><p class="jt-help">Add to or delete from the drop-down lists. United Dairy is protected: its unit numbers come from the fleet list. Anything on a trailer in the lot can be deleted after that trailer leaves the lot. New products are added on <a href="' + escapeHtml(productsHref()) + '">Suppliers &amp; Products</a>.</p>' +
    '<h3>Suppliers</h3><div class="jt-lists">' +
    '<div class="jt-co"><b>United Dairy</b><span class="jt-units"><span class="pm-muted">Fleet list · ' + fleetHere().filter(J.dryBox).length + ' dry box trailers</span></span><span class="jt-lock">Protected</span></div>';
  h += l.companies.map(c => '<div class="jt-co"><b>' + escapeHtml(c.name) + '</b><span class="jt-units">' + chips('unit', c.units, c.name) + addBox('unit', c.name, 'Add a unit number') + '</span>' + del('company', c.name, '', 'Delete ' + c.name) + '</div>').join('');
  h += '</div>' + addBox('company', '', 'Add a supplier') +
    '<h3>Other items (not on Suppliers &amp; Products)</h3><div class="jt-units">' + chips('item', l.items) + '</div>' + addBox('item', '', 'Add an item') +
    '<h3>Locations</h3><div class="jt-units">' + chips('location', l.locations) + '</div>' + addBox('location', '', 'Add a location') +
    '<div class="jt-row"><button type="button" class="pm-btn pri" id="lists-done">Done</button></div>';
  card.innerHTML = h;
}

function drawCard(force) {
  const card = document.getElementById('card');
  if (force !== true && card.contains(document.activeElement) && document.activeElement.matches('input, textarea, select')) return;
  const ck = canSave(), dis = ck ? '' : ' disabled';
  if (mode === 'add') return drawAdd(card, dis);
  if (mode === 'lists') return drawLists(card, dis);
  const r = rowOf(chosen);
  if (!r) { card.innerHTML = '<p class="pm-muted">' + (trailers && trailers.length ? 'Pick a trailer on the list to change how full it is and what is on it.' : '+ Add Trailer puts a trailer on the list.') + '</p>'; return; }
  if (!r.t) {
    // Joe 11/3: one of our trailers that is not here. Picking where it is parked brings it into the lot.
    card.innerHTML = '<div class="mach-title"><h2>' + escapeHtml(nameOf(r.p)) + '</h2><span class="pm-pill jt-EMPTY">' + escapeHtml(J.NOT_HERE) + '</span></div>' +
      '<p class="jt-help">Not in the lot. When it pulls in, pick where it is parked; it goes on the list as Empty.</p>' +
      '<h3>Where is it parked?</h3><select class="jt-in" id="bring" aria-label="Where it is parked"' + dis + '>' + optionTag('', '', '') + lists().locations.map(v => optionTag(v, '', v)).join('') + '</select>';
    return;
  }
  const t = r.t, p = r.p, l = lists();
  const items = p.items.filter(x => x.item || x.pallets).concat([{ item: '', pallets: '' }]);
  card.innerHTML = '<div class="mach-title"><h2>' + escapeHtml(nameOf(p)) + '</h2><span class="pm-pill jt-' + escapeHtml(t.status) + '">' + escapeHtml(statusName(t.status)) + '</span></div>' +
    '<div class="mach-from">Supplier: ' + escapeHtml(p.company) + ' · Unit: ' + escapeHtml(p.unit) + (t.arrivedAt ? ' · in the lot since ' + escapeHtml(dateTimeText(t.arrivedAt)) : '') + '</div>' +
    '<div class="jt-big">' + STATUS.map(([k, w]) => '<button type="button" data-status="' + k + '"' + (t.status === k ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + dis + '>' + w + '</button>').join('') + '</div>' +
    '<h3>What is on it</h3><div class="jt-lines" id="lines"><span class="h">Item</span><span class="h">How many</span><span class="h">Counted in</span>' +
    items.map(x => '<select class="jt-in" data-line="item" aria-label="Item"' + dis + '>' + productOptions(x.item) + '</select>' +
      '<input class="jt-in" data-line="pallets" value="' + escapeHtml(x.pallets) + '" inputmode="numeric" maxlength="5" aria-label="How many"' + dis + '>' +
      '<span class="jt-unit">' + escapeHtml(x.item ? lineUnit(x) : '') + '</span>').join('') + '</div>' +
    '<div class="jt-row"><a class="pm-btn" href="' + escapeHtml(productsHref()) + '">+ Add Product</a></div>' +
    '<h3>Location</h3>' + (newLocation
      ? '<input class="jt-in" id="loc-new" maxlength="40" autocomplete="off" placeholder="Type the new location"' + dis + '>'
      : '<select class="jt-in" id="loc" aria-label="Location"' + dis + '>' + pickFrom(l.locations, p.location, '+ New location…') + '</select>') +
    '<h3>Notes</h3><input class="jt-in" data-notes="1" value="' + escapeHtml(t.notes || '') + '" maxlength="500" placeholder="Anything the plant should know"' + dis + '>' +
    '<div class="jt-row"><button type="button" class="pm-btn" id="left"' + dis + '>Left the Lot</button></div>' +
    '<h3>History</h3><ul class="jt-hist">' + (t.history || []).map(h => '<li>' + escapeHtml(dateTimeText(h.at)) + ' · ' + escapeHtml(h.what) + ' · ' + escapeHtml(h.by) + '</li>').join('') + '</ul>';
}

function render(force) { drawTop(); drawList(); drawCard(force); }

function send(fields, what) {
  const run = busy.then(() => save('saveJugTrailer', Object.assign({ facilityId: plant }, fields)));
  busy = run.catch(() => {});
  return run.then(done => { showError(''); return done; }, err => { showError(what + ' was not saved (' + (err.message || err) + ').'); render(true); return null; });
}
const lines = () => {
  const box = [...document.querySelectorAll('#lines [data-line]')], out = [];
  for (let i = 0; i < box.length; i += 2) {
    const item = box[i].value.trim(), line = { item, pallets: box[i + 1].value.trim() }, u = countedIn(item);
    if (u) line.unit = u;
    out.push(line);
  }
  return out.filter(x => x.item || x.pallets);
};
const saveLines = (t) => {
  const items = lines();
  t.items = items;
  return send({ op: 'edit', trailerId: t.id, fields: { items } }, nameOf(parts(t))).then(() => render(true));
};
const saveLocation = (t, value) => {
  t.location = value;
  newLocation = false;
  return send({ op: 'edit', trailerId: t.id, fields: { location: value } }, nameOf(parts(t))).then(() => render(true));
};
const listChange = (list, change, value, company) => send({ op: 'list', list, change, value, company }, value).then(() => render(true));
// One of our trailers comes in at a place, or a trailer in the lot moves or leaves (Joe 11/3: Edit on its line).
function placeRow(r, value) {
  editing = ''; editValue = '';
  if (!r || !value) { render(true); return; }
  if (!r.t) {
    if (J.same(value, J.NOT_HERE)) { render(true); return; }
    send({ op: 'add', equipmentId: r.eq.id, location: value }, nameOf(r.p)).then(done => { if (done && done.trailerId) { chosen = done.trailerId; setUrl(); } render(true); });
    render(true);
    return;
  }
  if (J.same(value, J.NOT_HERE)) {
    send({ op: 'left', trailerId: r.t.id }, nameOf(r.p)).then(() => render(true));
    if (r.p.unitedDairy && r.eq) { chosen = FLEET + r.eq.id; setUrl(); }
  } else if (!J.same(value, r.p.location)) {
    r.t.location = value;
    send({ op: 'edit', trailerId: r.t.id, fields: { location: value } }, nameOf(r.p)).then(() => render(true));
  }
  render(true);
}

function addGo(b) {
  const company = add.company === NEW ? add.companyNew.trim() : add.company;
  if (!company) { showError('Pick the supplier first.'); return; }
  const item = add.item, count = add.count.trim();
  if (count && !/^\d{1,5}$/.test(count)) { showError('How many is a whole number.'); return; }
  const extra = { location: J.LOCATIONS[0], items: item ? [Object.assign({ item, pallets: count }, countedIn(item) ? { unit: countedIn(item) } : {})] : [] };
  let req;
  if (company === J.UD) {
    const u = addTrailer();
    if (!u) { showError(add.number.trim() ? 'Tap the United Dairy trailer you mean.' : 'Type the United Dairy unit number.'); return; }
    req = Object.assign({ op: 'add', equipmentId: u.id }, extra);
  } else {
    if (!add.number.trim()) { showError('Type the unit number.'); return; }
    req = Object.assign({ op: 'add', company, unit: add.number.trim() }, extra);
  }
  b.disabled = true;
  send(req, 'The trailer').then(done => {
    if (done && done.trailerId) { mode = ''; add = NO_ADD(); chosen = done.trailerId; setUrl(); }
    render(true);
  });
}

const card = document.getElementById('card');
card.addEventListener('click', e => {
  const t = trailer();
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  if (b.id === 'add-cancel' || b.id === 'lists-done') { mode = ''; render(true); return; }
  if (b.id === 'add-go') { addGo(b); return; }
  if (b.dataset.match) {
    const u = units.find(x => x.id === b.dataset.match);
    if (u) { add.equipmentId = u.id; add.number = J.udUnit(u.unit); render(true); }
    return;
  }
  if (b.dataset.list) { listChange(b.dataset.list, 'delete', b.dataset.value, b.dataset.company); return; }
  if (b.dataset.addGo) {
    const box = b.parentElement.querySelector('[data-add-list]');
    if (!box.value.trim()) { showError('Type what to add first.'); return; }
    listChange(box.dataset.addList, 'add', box.value.trim(), box.dataset.company);
    return;
  }
  if (!t || !canSave()) return;
  if (b.dataset.status && b.dataset.status !== t.status) {
    // Shown at once; the list follows when the save comes back.
    t.status = b.dataset.status;
    render(true);
    send({ op: 'edit', trailerId: t.id, fields: { status: b.dataset.status } }, nameOf(parts(t)));
  }
  if (b.id === 'left') {
    const r = rowOf(chosen);
    send({ op: 'left', trailerId: t.id }, nameOf(parts(t))).then(done => { if (done) { chosen = r && r.eq ? FLEET + r.eq.id : ''; setUrl(); render(true); } });
  }
});
card.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'add-company-new') add.companyNew = el.value;
  if (el.id === 'add-count') add.count = el.value;
  if (el.id === 'add-number') {
    add.number = el.value;
    add.equipmentId = '';
    const m = document.getElementById('add-match');
    if (m) m.innerHTML = matchHtml();
  }
});
card.addEventListener('change', e => {
  const t = trailer(), el = e.target;
  if (mode === 'add') {
    if (el.id === 'add-company') {
      add = Object.assign(NO_ADD(), { company: el.value, item: add.item, count: add.count });
      render(true);
      const n = document.getElementById(el.value === NEW ? 'add-company-new' : 'add-number');
      if (n) n.focus();
    }
    if (el.id === 'add-item') { add.item = el.value; render(true); const c = document.getElementById('add-count'); if (c && el.value) c.focus(); }
    return;
  }
  if (mode || !canSave()) return;
  if (el.id === 'bring') { placeRow(rowOf(chosen), el.value); return; }
  if (!t) return;
  if (el.dataset.line) {
    saveLines(t);
  } else if (el.id === 'loc') {
    if (el.value === NEW) { newLocation = true; render(true); document.getElementById('loc-new').focus(); } else saveLocation(t, el.value);
  } else if (el.id === 'loc-new') {
    saveLocation(t, el.value.trim());
  } else if (el.dataset.notes) {
    t.notes = el.value.trim();
    send({ op: 'edit', trailerId: t.id, fields: { notes: t.notes } }, nameOf(parts(t)));
  }
});
card.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.matches('input')) return;
  if (e.target.dataset.addList) { e.preventDefault(); e.target.parentElement.querySelector('[data-add-go]').click(); return; }
  if (e.target.id === 'add-number' && add.company === J.UD) {
    // Enter takes the only match.
    e.preventDefault();
    const list = matches(add.number);
    if (!addTrailer() && list.length === 1) { add.equipmentId = list[0].id; add.number = J.udUnit(list[0].unit); render(true); document.getElementById('add-number').focus(); }
    return;
  }
  if (['add-number', 'add-company-new', 'add-count'].indexOf(e.target.id) >= 0) { e.preventDefault(); document.getElementById('add-go').click(); return; }
  e.target.blur();
});
const rows = document.getElementById('rows');
rows.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) {
    if (b.disabled || !canSave()) return;
    if (b.dataset.edit) { editing = b.dataset.edit; editValue = ''; render(true); const s = rows.querySelector('select[data-loc]'); if (s) s.focus(); }
    else if (b.dataset.save) { const s = rows.querySelector('select[data-loc]'); placeRow(rowOf(b.dataset.save), s ? s.value : ''); }
    return;
  }
  if (e.target.closest('select')) return;
  const r = e.target.closest('[data-id]');
  if (!r) return;
  mode = ''; newLocation = false; chosen = r.dataset.id; setUrl(); render(true);
});
rows.addEventListener('change', e => { if (e.target.dataset.loc) editValue = e.target.value; });
rows.addEventListener('keydown', e => {
  if (!e.target.dataset.loc) return;
  if (e.key === 'Escape') { editing = ''; editValue = ''; render(true); }
  if (e.key === 'Enter') { e.preventDefault(); placeRow(rowOf(e.target.dataset.loc), e.target.value); }
});
document.getElementById('add').addEventListener('click', () => { if (!canSave()) return; mode = 'add'; add = NO_ADD(); render(true); const u = document.getElementById('add-company'); if (u) u.focus(); });
document.getElementById('edit-lists').addEventListener('click', () => { if (!canSave()) return; mode = 'lists'; render(true); });
window.udBack = () => { if (editing) { editing = ''; editValue = ''; render(true); return true; } if (mode) { mode = ''; render(true); return true; } return false; };

function follow() {
  stops.forEach(u => u());
  trailers = null;
  savedLists = null;
  render(true);
  const fail = (e) => showError('Could not read the trailers in the lot (' + e.message + '). Check the network and reload the page.');
  // While a location is being changed (Edit), the list waits to redraw so the drop-down stays open.
  const redraw = () => { if (!editing) render(); else drawCard(); };
  stops = [
    onSnapshot(query(collection(db, 'jugTrailers'), where('facilityId', '==', plant), where('inLot', '==', true)), s => {
      trailers = s.docs.map(d => Object.assign({ id: d.id }, d.data())).sort(byNumber);
      if (!mode && (!chosen || !rowOf(chosen)) && trailers.length && !params.get('trailer')) { chosen = sorted(trailers)[0].t.id; setUrl(); }
      redraw();
    }, fail),
    onSnapshot(query(collection(db, 'equipment'), where('type', '==', 'TRAILER')), s => { units = s.docs.map(d => Object.assign({ id: d.id }, d.data())); redraw(); }, () => {}),
    onSnapshot(doc(db, 'jugTrailerLists', plant), s => { savedLists = s.exists() ? s.data() : null; redraw(); }, () => {}),
    onSnapshot(query(collection(db, 'plantJournal'), where('type', '==', R.SUPPLIER_TYPE)), s => { supplierDocs = s.docs.map(d => d.data()); redraw(); }, () => {}),
    onSnapshot(query(collection(db, 'receivingItems'), where('status', '==', 'ACTIVE')), s => { products = s.docs.map(d => Object.assign({ id: d.id }, d.data())); redraw(); }, () => {})
  ];
}
requireSignIn(async (user) => {
  ({ db } = await start());
  watchPerson(db, user, p => { person = p; const was = plant; drawTop(); if (!stops.length || was !== plant) follow(); else render(true); }, { withEmail: true });
  onSnapshot(doc(db, 'config', 'app'), s => { app = s.data() || {}; render(true); });
});
