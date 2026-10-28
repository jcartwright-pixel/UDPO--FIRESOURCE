import { start, requireSignIn, save, escapeHtml, dateTimeText, showError, goLiveNote, optionTag, maySave, watchPerson } from './app.js';
import { doc, onSnapshot, collection, query, where } from './firebase.js';
import { plantFor } from './pmaint.js';

// Jug Trailers (Joe 10/28, mock-up 2): the jug (dry box) trailers parked in the plant's lot, on Debag. The list on the left
// says how full each one is and what is on it; the trailer picked opens on the right: Empty / Half Full / Loaded, a line for
// each item with its pallets, notes, Left the Lot and its history. + Add Trailer picks one of United Dairy's trailers from the
// main trailer list (Equipment Master) or takes a typed number for any other trailer; either way it is kept on this plant's
// own list only (jugtrailers.js), never on the main trailer list or the sheets. Every box saves when it is left.
const L = window.UDLogic;
const STATUS = [['EMPTY', 'Empty'], ['HALF', 'Half Full'], ['LOADED', 'Loaded']];
const statusName = (s) => (STATUS.find(x => x[0] === s) || [s, s])[1];
const params = new URLSearchParams(location.search);
let plant = params.get('plant') || '', chosen = params.get('trailer') || '', show = '', person = null, app = {}, db = null;
let trailers = null, units = [], adding = false, stops = [];
let busy = Promise.resolve();
const canSave = () => maySave(person, L.SAVE_ROLES.concat(['PLANT_EMPLOYEE']), app, 'plant');
const setUrl = () => history.replaceState(null, '', '?plant=' + encodeURIComponent(plant) + (chosen ? '&trailer=' + encodeURIComponent(chosen) : ''));
const trailer = () => (trailers || []).find(t => t.id === chosen) || null;
const whatOn = (t) => (t.items || []).map(x => x.item + (x.pallets ? ', ' + x.pallets + ' pallet' + (x.pallets === '1' ? '' : 's') : '')).join('; ');
const byNumber = (a, b) => String(a.number).localeCompare(String(b.number), 'en', { numeric: true });

function drawTop() {
  const pl = plantFor(person, plant);
  if (plant !== pl.id) { plant = pl.id; setUrl(); }
  document.getElementById('plant-name').textContent = pl.name;
  document.getElementById('add').disabled = !canSave();
  const st = L.screenState(app, 'plant');
  goLiveNote(st.live && st.owner !== 'new');
  document.getElementById('mode-text').textContent = st.live ? (st.open ? 'LIVE' : 'VIEW ONLY') : 'TEST COPY';
}

function drawList() {
  const all = trailers || [], n = (s) => all.filter(t => t.status === s).length;
  document.getElementById('sum').innerHTML = '<span><b>' + all.length + '</b>trailer' + (all.length === 1 ? '' : 's') + ' in the lot</span>' + STATUS.slice().reverse().map(([k, w]) => '<span><b>' + n(k) + '</b>' + w + '</span>').join('');
  const list = all.filter(t => !show || t.status === show);
  document.getElementById('rows').innerHTML = list.map(t => '<tr class="pick' + (t.id === chosen && !adding ? ' on' : '') + '" data-id="' + escapeHtml(t.id) + '"><td class="nowrap"><b>' + escapeHtml(t.number) + '</b><span class="pm-pill jt-' + escapeHtml(t.status) + ' jt-phone">' + escapeHtml(statusName(t.status)) + '</span></td>' +
    '<td class="nowrap"><span class="pm-pill jt-' + escapeHtml(t.status) + '">' + escapeHtml(statusName(t.status)) + '</span></td>' +
    '<td>' + (whatOn(t) ? escapeHtml(whatOn(t)) : '<span class="jt-none">Nothing on it</span>') + '</td></tr>').join('') ||
    '<tr><td colspan="3" class="empty">' + (!trailers ? 'Reading the trailers in the lot…' : all.length ? 'No ' + statusName(show) + ' trailers right now.' : 'No trailers in the lot yet. + Add Trailer puts the first one on the list.') + '</td></tr>';
}

// United Dairy's trailers on the main trailer list for this plant, not already in the lot: dry boxes first, then the rest.
function unitChoices() {
  const here = new Set((trailers || []).map(t => String(t.number).toUpperCase()));
  const mine = units.filter(u => u.status !== 'INACTIVE' && (L.plantOfLocation(u.location) || u.facilityId) === plant && u.unit && !here.has(String(u.unit).toUpperCase())).sort((a, b) => byNumber({ number: a.unit }, { number: b.unit }));
  const cold = (u) => /refrigerat|reefer|tank/i.test(u.notes || '');
  const group = (label, list) => list.length ? '<optgroup label="' + label + '">' + list.map(u => optionTag(u.id, '', u.unit)).join('') + '</optgroup>' : '';
  return optionTag('', '', '') + group('Dry box trailers', mine.filter(u => !cold(u))) + group('Other United Dairy trailers', mine.filter(cold));
}

function drawCard(force) {
  const card = document.getElementById('card');
  if (force !== true && card.contains(document.activeElement) && document.activeElement.matches('input, textarea, select')) return;
  const ck = canSave(), dis = ck ? '' : ' disabled';
  if (adding) {
    card.innerHTML = '<div class="mach-title"><h2>Add a trailer</h2></div>' +
      '<div class="jt-add"><label>United Dairy trailer<select class="jt-in" id="add-unit"' + dis + '>' + unitChoices() + '</select></label>' +
      '<div class="jt-or">or</div><label>Trailer number (any other trailer)<input class="jt-in" id="add-number" maxlength="20" autocomplete="off"' + dis + '></label></div>' +
      '<div class="jt-row"><button type="button" class="pm-btn pri" id="add-go"' + dis + '>Add to the Lot</button><button type="button" class="pm-btn" id="add-cancel">Cancel</button></div>' +
      '<p class="jt-help">The trailer goes on this plant\'s jug trailer list as Empty. A typed number is kept here only; it is not added to the main trailer list.</p>';
    return;
  }
  const t = trailer();
  if (!t) { card.innerHTML = '<p class="pm-muted">' + (trailers && trailers.length ? 'Pick a trailer on the list to change how full it is and what is on it.' : '+ Add Trailer puts a trailer on the list.') + '</p>'; return; }
  const items = (t.items || []).concat([{ item: '', pallets: '' }]);
  card.innerHTML = '<div class="mach-title"><h2>Trailer ' + escapeHtml(t.number) + '</h2><span class="pm-pill jt-' + escapeHtml(t.status) + '">' + escapeHtml(statusName(t.status)) + '</span></div>' +
    '<div class="mach-from">' + (t.unitedDairy ? 'United Dairy trailer' : 'Added by number') + (t.arrivedAt ? ' · in the lot since ' + escapeHtml(dateTimeText(t.arrivedAt)) : '') + '</div>' +
    '<div class="jt-big">' + STATUS.map(([k, w]) => '<button type="button" data-status="' + k + '"' + (t.status === k ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + dis + '>' + w + '</button>').join('') + '</div>' +
    '<h3>What is on it</h3><div class="jt-lines" id="lines"><span class="h">Item</span><span class="h">Pallets</span>' +
    items.map(x => '<input class="jt-in" data-line="item" value="' + escapeHtml(x.item) + '" maxlength="80" placeholder="' + (x.item ? '' : 'Type an item') + '"' + dis + '>' +
      '<input class="jt-in" data-line="pallets" value="' + escapeHtml(x.pallets) + '" inputmode="numeric" maxlength="4" aria-label="Pallets"' + dis + '>').join('') + '</div>' +
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
  for (let i = 0; i < box.length; i += 2) out.push({ item: box[i].value.trim(), pallets: box[i + 1].value.trim() });
  return out.filter(x => x.item || x.pallets);
};

const card = document.getElementById('card');
card.addEventListener('click', e => {
  const t = trailer();
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  if (b.id === 'add-cancel') { adding = false; render(true); return; }
  if (b.id === 'add-go') {
    const unit = document.getElementById('add-unit').value, number = document.getElementById('add-number').value.trim();
    if (!unit && !number) { showError('Pick a United Dairy trailer or type the trailer number.'); return; }
    if (unit && number) { showError('Pick a United Dairy trailer or type a number, not both.'); return; }
    b.disabled = true;
    send(Object.assign({ op: 'add' }, unit ? { equipmentId: unit } : { number }), 'The trailer').then(done => {
      if (done && done.trailerId) { adding = false; chosen = done.trailerId; setUrl(); }
      render(true);
    });
    return;
  }
  if (!t || !canSave()) return;
  if (b.dataset.status && b.dataset.status !== t.status) {
    // Shown at once; the list follows when the save comes back.
    t.status = b.dataset.status;
    render(true);
    send({ op: 'edit', trailerId: t.id, fields: { status: b.dataset.status } }, 'Trailer ' + t.number);
  }
  if (b.id === 'left') {
    send({ op: 'left', trailerId: t.id }, 'Trailer ' + t.number).then(done => { if (done) { chosen = ''; setUrl(); render(true); } });
  }
});
card.addEventListener('change', e => {
  const t = trailer(), el = e.target;
  if (!t || !canSave()) return;
  if (el.dataset.line) {
    const items = lines();
    t.items = items;
    send({ op: 'edit', trailerId: t.id, fields: { items } }, 'Trailer ' + t.number).then(() => render(true));
  } else if (el.dataset.notes) {
    t.notes = el.value.trim();
    send({ op: 'edit', trailerId: t.id, fields: { notes: t.notes } }, 'Trailer ' + t.number);
  }
});
card.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input')) e.target.blur(); });
document.getElementById('rows').addEventListener('click', e => { const r = e.target.closest('[data-id]'); if (!r) return; adding = false; chosen = r.dataset.id; setUrl(); render(true); });
document.getElementById('add').addEventListener('click', () => { if (!canSave()) return; adding = true; render(true); const u = document.getElementById('add-unit'); if (u) u.focus(); });
document.getElementById('show').addEventListener('change', e => { show = e.target.value; render(); });
window.udBack = () => { if (adding) { adding = false; render(true); return true; } return false; };

function follow() {
  stops.forEach(u => u());
  trailers = null;
  render(true);
  const fail = (e) => showError('Could not read the trailers in the lot (' + e.message + '). Check the network and reload the page.');
  stops = [
    onSnapshot(query(collection(db, 'jugTrailers'), where('facilityId', '==', plant), where('inLot', '==', true)), s => {
      trailers = s.docs.map(d => Object.assign({ id: d.id }, d.data())).sort(byNumber);
      if (!adding && (!chosen || !trailer()) && trailers.length && !params.get('trailer')) { chosen = trailers[0].id; setUrl(); }
      render();
    }, fail),
    onSnapshot(query(collection(db, 'equipment'), where('type', '==', 'TRAILER')), s => { units = s.docs.map(d => Object.assign({ id: d.id }, d.data())); if (adding) render(); }, () => {})
  ];
}
requireSignIn(async (user) => {
  ({ db } = await start());
  watchPerson(db, user, p => { person = p; const was = plant; drawTop(); if (!stops.length || was !== plant) follow(); else render(true); }, { withEmail: true });
  onSnapshot(doc(db, 'config', 'app'), s => { app = s.data() || {}; render(true); });
});
