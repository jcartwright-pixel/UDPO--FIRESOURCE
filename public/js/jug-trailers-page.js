import { start, requireSignIn, save, escapeHtml, dateTimeText, showError, goLiveNote, optionTag, maySave, watchPerson } from './app.js';
import { doc, onSnapshot, collection, query, where } from './firebase.js';
import { plantFor } from './pmaint.js';

// Plant Material Trailers (Joe 10/28, mock-up 2; first called Jug Trailers): the dry box trailers parked in the plant's lot, in Inventory under Shipping & Receiving (Joe 10/31; it was on Debag / Labeling Room). The list on the left
// says how full each one is and what is on it; the trailer picked opens on the right: Empty / Half Full / Loaded, a line for
// each item with its pallets, its location, notes, Left the Lot and its history.
// Joe 11/1 (mock-up 2, "Trailer Company"): the list starts with the Trailer Company and the Unit number. + Add Trailer asks for
// the company first (a drop-down that starts blank), then the unit: United Dairy's from the fleet list (Equipment Master), any
// other company's from the list of its trailers we have had, or a new one typed. What is on it and Location are drop-downs.
// Edit Lists adds to and deletes from the lists (trailer companies and their units, items, locations); United Dairy is
// protected, and nothing a trailer in the lot uses can be deleted until it leaves (jug-rules.js, shared with the server).
// Everything is kept on this plant's own lists only (jugtrailers.js), never on the main trailer list or the sheets.
const L = window.UDLogic;
const J = window.UDJug;
const STATUS = [['EMPTY', 'Empty'], ['HALF', 'Half Full'], ['LOADED', 'Loaded']];
const NEW = '__new';
const statusName = (s) => (STATUS.find(x => x[0] === s) || [s, s])[1];
const params = new URLSearchParams(location.search);
let plant = params.get('plant') || '', chosen = params.get('trailer') || '', show = '', person = null, app = {}, db = null;
let trailers = null, units = [], savedLists = null, mode = '', stops = [];
// What is being typed on + Add Trailer, kept while the screen redraws; the What is on it line or Location being typed new.
let add = { company: '', companyNew: '', unit: '', number: '' }, newItemRow = -1, newLocation = false;
let busy = Promise.resolve();
const canSave = () => maySave(person, L.SAVE_ROLES.concat(['PLANT_EMPLOYEE']), app, 'plant');
const setUrl = () => history.replaceState(null, '', '?plant=' + encodeURIComponent(plant) + (chosen ? '&trailer=' + encodeURIComponent(chosen) : ''));
const trailer = () => (trailers || []).find(t => t.id === chosen) || null;
const lists = () => J.lists(savedLists, trailers || []);
const names = () => lists().companies.map(c => c.name);
const parts = (t) => J.parts(t, names());
const nameOf = (p) => p.unitedDairy ? 'United Dairy ' + p.unit : p.company + ' ' + p.unit;
const whatOn = (p) => p.items.filter(x => x.item).map(x => x.item + (x.pallets ? ', ' + x.pallets + ' pallet' + (x.pallets === '1' ? '' : 's') : '')).join('; ');
const byNumber = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
const sorted = (list) => list.map(t => ({ t, p: parts(t) })).sort((a, b) => J.order(a.p, b.p));
// A drop-down from a list: blank first, the list, and "+ New ..." last to type one that is not on it.
const pickFrom = (list, current, newLabel) => optionTag('', current, '') + list.map(v => optionTag(v, current, v)).join('') + (newLabel ? optionTag(NEW, current, newLabel) : '');

function drawTop() {
  const pl = plantFor(person, plant);
  if (plant !== pl.id) { plant = pl.id; setUrl(); }
  document.getElementById('plant-name').textContent = pl.name;
  document.getElementById('add').disabled = !canSave();
  document.getElementById('edit-lists').disabled = !canSave();
  const st = L.screenState(app, 'plant');
  goLiveNote(st.live && st.owner !== 'new');
  document.getElementById('mode-text').textContent = st.live ? (st.open ? 'LIVE' : 'VIEW ONLY') : 'TEST COPY';
}

function drawList() {
  const all = trailers || [], n = (s) => all.filter(t => t.status === s).length;
  document.getElementById('sum').innerHTML = '<span><b>' + all.length + '</b>trailer' + (all.length === 1 ? '' : 's') + ' in the lot</span>' + STATUS.slice().reverse().map(([k, w]) => '<span><b>' + n(k) + '</b>' + w + '</span>').join('');
  const list = sorted(all.filter(t => !show || t.status === show));
  document.getElementById('rows').innerHTML = list.map(({ t, p }) => '<tr class="pick' + (t.id === chosen && !mode ? ' on' : '') + '" data-id="' + escapeHtml(t.id) + '">' +
    '<td class="nowrap' + (p.unitedDairy ? ' jt-ud' : '') + '"><b>' + escapeHtml(p.company) + '</b></td>' +
    '<td class="nowrap"><span class="jt-phone jt-phone-co">' + escapeHtml(p.company) + '</span><b>' + escapeHtml(p.unit) + '</b><span class="pm-pill jt-' + escapeHtml(t.status) + ' jt-phone">' + escapeHtml(statusName(t.status)) + '</span></td>' +
    '<td class="nowrap"><span class="pm-pill jt-' + escapeHtml(t.status) + '">' + escapeHtml(statusName(t.status)) + '</span></td>' +
    '<td>' + (whatOn(p) ? escapeHtml(whatOn(p)) : '<span class="jt-none">Nothing on it</span>') + '</td>' +
    '<td class="nowrap">' + escapeHtml(p.location) + '</td></tr>').join('') ||
    '<tr><td colspan="5" class="empty">' + (!trailers ? 'Reading the trailers in the lot…' : all.length ? 'No ' + statusName(show) + ' trailers right now.' : 'No trailers in the lot yet. + Add Trailer puts the first one on the list.') + '</td></tr>';
}

// This plant's trailers on the fleet list (United Dairy's), active.
function fleetHere() {
  return units.filter(u => u.status !== 'INACTIVE' && (L.plantOfLocation(u.location) || u.facilityId) === plant && u.unit).sort((a, b) => byNumber(a.unit, b.unit));
}
// United Dairy's trailers on the fleet list for this plant, not already in the lot: dry boxes first, then the rest.
function unitChoices() {
  const here = new Set((trailers || []).map(t => String(t.number).toUpperCase()));
  const mine = fleetHere().filter(u => !here.has(String(u.unit).toUpperCase()));
  const cold = (u) => /refrigerat|reefer|tank/i.test(u.notes || '');
  const group = (label, list) => list.length ? '<optgroup label="' + label + '">' + list.map(u => optionTag(u.id, add.unit, u.unit)).join('') + '</optgroup>' : '';
  return optionTag('', add.unit, '') + group('Dry box trailers', mine.filter(u => !cold(u))) + group('Other United Dairy trailers', mine.filter(cold));
}

function drawAdd(card, dis) {
  const l = lists(), co = l.companies.find(c => J.same(c.name, add.company));
  let h = '<div class="mach-title"><h2>Add a trailer</h2></div><div class="jt-add">' +
    '<label><span class="jt-step"><b>1</b>Trailer Company</span><select class="jt-in" id="add-company"' + dis + '>' +
    optionTag('', add.company, '') + optionTag(J.UD, add.company, J.UD) + l.companies.map(c => optionTag(c.name, add.company, c.name)).join('') + optionTag(NEW, add.company, '+ New trailer company…') + '</select></label>';
  if (add.company === NEW) h += '<label>New trailer company name<input class="jt-in" id="add-company-new" maxlength="40" autocomplete="off" value="' + escapeHtml(add.companyNew) + '"' + dis + '></label>';
  if (add.company) {
    h += '<label><span class="jt-step"><b>2</b>Unit number</span>';
    if (add.company === J.UD) h += '<select class="jt-in" id="add-unit"' + dis + '>' + unitChoices() + '</select>';
    else if (co) {
      const inLot = new Set((trailers || []).map(t => parts(t)).filter(p => J.same(p.company, co.name)).map(p => p.unit.toUpperCase()));
      h += '<select class="jt-in" id="add-pick"' + dis + '>' + pickFrom(co.units.filter(u => !inLot.has(u.toUpperCase())), add.unit, '+ New ' + co.name + ' unit number…') + '</select>';
    }
    h += '</label>';
    if (add.company !== J.UD && (!co || add.unit === NEW)) h += '<label>' + (co ? 'New ' + escapeHtml(co.name) + ' unit number' : 'Unit number') + '<input class="jt-in" id="add-number" maxlength="20" autocomplete="off" value="' + escapeHtml(add.number) + '" placeholder="Type the unit number"' + dis + '></label>';
  }
  h += '</div><div class="jt-row"><button type="button" class="pm-btn pri" id="add-go"' + dis + '>Add to the Lot</button><button type="button" class="pm-btn" id="add-cancel">Cancel</button></div>' +
    '<p class="jt-help">' + (add.company === J.UD ? 'United Dairy unit numbers come from our fleet list. Trailers already in the lot are left off.'
      : add.company ? 'A new company or unit number is saved to its list so the next person can pick it.'
        : 'Pick who the trailer belongs to first, then its unit number. It goes on the list as Empty.') + '</p>';
  card.innerHTML = h;
}

// Edit Lists (Joe 11/1): add to and delete from the lists. United Dairy is protected; anything a trailer in the lot uses
// shows why it cannot be deleted yet instead of a Delete button.
function drawLists(card, dis) {
  const l = lists(), lot = trailers || [], nm = names();
  const del = (list, value, company, label) => {
    const why = J.deleteBlock(list, value, company, lot, nm);
    return why ? '<span class="jt-lock" title="' + escapeHtml(why) + '">In the lot</span>'
      : '<button type="button" class="jt-del" data-list="' + list + '" data-value="' + escapeHtml(value) + '" data-company="' + escapeHtml(company || '') + '"' + dis + '>' + escapeHtml(label || 'Delete') + '</button>';
  };
  const chips = (list, values, company) => values.map(v => '<span class="jt-chip">' + escapeHtml(v) + del(list, v, company) + '</span>').join('') || '<span class="pm-muted">None yet</span>';
  const addBox = (list, company, placeholder) => '<span class="jt-addbox"><input class="jt-in" data-add-list="' + list + '" data-company="' + escapeHtml(company || '') + '" maxlength="' + (list === 'item' ? 80 : 40) + '" autocomplete="off" placeholder="' + placeholder + '"' + dis + '><button type="button" class="pm-btn" data-add-go="' + list + '"' + dis + '>Add</button></span>';
  let h = '<div class="mach-title"><h2>Edit Lists</h2></div><p class="jt-help">Add to or delete from the drop-down lists. United Dairy is protected: its unit numbers come from the fleet list. Anything on a trailer in the lot can be deleted after that trailer leaves the lot.</p>' +
    '<h3>Trailer companies</h3><div class="jt-lists">' +
    '<div class="jt-co"><b>United Dairy</b><span class="jt-units"><span class="pm-muted">Fleet list · ' + fleetHere().length + ' trailers</span></span><span class="jt-lock">Protected</span></div>';
  h += l.companies.map(c => '<div class="jt-co"><b>' + escapeHtml(c.name) + '</b><span class="jt-units">' + chips('unit', c.units, c.name) + addBox('unit', c.name, 'Add a unit number') + '</span>' + del('company', c.name, '', 'Delete ' + c.name) + '</div>').join('');
  h += '</div>' + addBox('company', '', 'Add a trailer company') +
    '<h3>What is on it</h3><div class="jt-units">' + chips('item', l.items) + '</div>' + addBox('item', '', 'Add an item') +
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
  const t = trailer();
  if (!t) { card.innerHTML = '<p class="pm-muted">' + (trailers && trailers.length ? 'Pick a trailer on the list to change how full it is and what is on it.' : '+ Add Trailer puts a trailer on the list.') + '</p>'; return; }
  const p = parts(t), l = lists();
  const items = p.items.filter(x => x.item || x.pallets).concat([{ item: '', pallets: '' }]);
  card.innerHTML = '<div class="mach-title"><h2>' + escapeHtml(nameOf(p)) + '</h2><span class="pm-pill jt-' + escapeHtml(t.status) + '">' + escapeHtml(statusName(t.status)) + '</span></div>' +
    '<div class="mach-from">Trailer Company: ' + escapeHtml(p.company) + ' · Unit: ' + escapeHtml(p.unit) + (t.arrivedAt ? ' · in the lot since ' + escapeHtml(dateTimeText(t.arrivedAt)) : '') + '</div>' +
    '<div class="jt-big">' + STATUS.map(([k, w]) => '<button type="button" data-status="' + k + '"' + (t.status === k ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + dis + '>' + w + '</button>').join('') + '</div>' +
    '<h3>What is on it</h3><div class="jt-lines" id="lines"><span class="h">Item</span><span class="h">Pallets</span>' +
    items.map((x, i) => (i === newItemRow
      ? '<input class="jt-in" data-line="item" data-new="1" maxlength="80" autocomplete="off" placeholder="Type the new item"' + dis + '>'
      : '<select class="jt-in" data-line="item" aria-label="Item"' + dis + '>' + pickFrom(l.items, x.item, '+ New item…') + '</select>') +
      '<input class="jt-in" data-line="pallets" value="' + escapeHtml(x.pallets) + '" inputmode="numeric" maxlength="4" aria-label="Pallets"' + dis + '>').join('') + '</div>' +
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
  for (let i = 0; i < box.length; i += 2) out.push({ item: box[i].value === NEW ? '' : box[i].value.trim(), pallets: box[i + 1].value.trim() });
  return out.filter(x => x.item || x.pallets);
};
const saveLines = (t) => {
  const items = lines();
  t.items = items;
  newItemRow = -1;
  return send({ op: 'edit', trailerId: t.id, fields: { items } }, nameOf(parts(t))).then(() => render(true));
};
const saveLocation = (t, value) => {
  t.location = value;
  newLocation = false;
  return send({ op: 'edit', trailerId: t.id, fields: { location: value } }, nameOf(parts(t))).then(() => render(true));
};
const listChange = (list, change, value, company) => send({ op: 'list', list, change, value, company }, value).then(() => render(true));

function addGo(b) {
  const company = add.company === NEW ? add.companyNew.trim() : add.company;
  if (!company) { showError('Pick the trailer company first.'); return; }
  let req;
  if (add.company === J.UD) {
    if (!add.unit) { showError('Pick the United Dairy unit number.'); return; }
    req = { op: 'add', equipmentId: add.unit };
  } else {
    const unit = add.company === NEW || add.unit === NEW || !lists().companies.some(c => J.same(c.name, company)) ? add.number.trim() : add.unit;
    if (!unit) { showError('Pick or type the unit number.'); return; }
    req = { op: 'add', company, unit };
  }
  b.disabled = true;
  send(req, 'The trailer').then(done => {
    if (done && done.trailerId) { mode = ''; add = { company: '', companyNew: '', unit: '', number: '' }; chosen = done.trailerId; setUrl(); }
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
    send({ op: 'left', trailerId: t.id }, nameOf(parts(t))).then(done => { if (done) { chosen = ''; setUrl(); render(true); } });
  }
});
card.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'add-company-new') add.companyNew = el.value;
  if (el.id === 'add-number') add.number = el.value;
});
card.addEventListener('change', e => {
  const t = trailer(), el = e.target;
  if (mode === 'add') {
    if (el.id === 'add-company') { add = { company: el.value, companyNew: '', unit: '', number: '' }; render(true); const n = document.getElementById(el.value === NEW ? 'add-company-new' : el.value === J.UD ? 'add-unit' : 'add-pick'); if (n) n.focus(); else { const m = document.getElementById('add-number'); if (m) m.focus(); } }
    if (el.id === 'add-unit' || el.id === 'add-pick') { add.unit = el.value; if (el.value === NEW) { render(true); document.getElementById('add-number').focus(); } }
    return;
  }
  if (mode || !t || !canSave()) return;
  if (el.dataset.line === 'item' && el.value === NEW) {
    newItemRow = [...document.querySelectorAll('#lines [data-line="item"]')].indexOf(el);
    render(true);
    document.querySelector('#lines [data-new]').focus();
  } else if (el.dataset.line) {
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
  if (e.target.id === 'add-number' || e.target.id === 'add-company-new') { e.preventDefault(); document.getElementById('add-go').click(); return; }
  e.target.blur();
});
document.getElementById('rows').addEventListener('click', e => { const r = e.target.closest('[data-id]'); if (!r) return; mode = ''; newItemRow = -1; newLocation = false; chosen = r.dataset.id; setUrl(); render(true); });
document.getElementById('add').addEventListener('click', () => { if (!canSave()) return; mode = 'add'; add = { company: '', companyNew: '', unit: '', number: '' }; render(true); const u = document.getElementById('add-company'); if (u) u.focus(); });
document.getElementById('edit-lists').addEventListener('click', () => { if (!canSave()) return; mode = 'lists'; render(true); });
document.getElementById('show').addEventListener('change', e => { show = e.target.value; render(); });
window.udBack = () => { if (mode) { mode = ''; render(true); return true; } return false; };

function follow() {
  stops.forEach(u => u());
  trailers = null;
  savedLists = null;
  render(true);
  const fail = (e) => showError('Could not read the trailers in the lot (' + e.message + '). Check the network and reload the page.');
  stops = [
    onSnapshot(query(collection(db, 'jugTrailers'), where('facilityId', '==', plant), where('inLot', '==', true)), s => {
      trailers = s.docs.map(d => Object.assign({ id: d.id }, d.data())).sort(byNumber);
      if (!mode && (!chosen || !trailer()) && trailers.length && !params.get('trailer')) { chosen = sorted(trailers)[0].t.id; setUrl(); }
      render();
    }, fail),
    onSnapshot(query(collection(db, 'equipment'), where('type', '==', 'TRAILER')), s => { units = s.docs.map(d => Object.assign({ id: d.id }, d.data())); if (mode) render(); }, () => {}),
    onSnapshot(doc(db, 'jugTrailerLists', plant), s => { savedLists = s.exists() ? s.data() : null; render(); }, () => {})
  ];
}
requireSignIn(async (user) => {
  ({ db } = await start());
  watchPerson(db, user, p => { person = p; const was = plant; drawTop(); if (!stops.length || was !== plant) follow(); else render(true); }, { withEmail: true });
  onSnapshot(doc(db, 'config', 'app'), s => { app = s.data() || {}; render(true); });
});
