/*
 * The Plant Station's TAKE OUT tab (Joe 11-4-26, Inventory mock-up B, "a mix of everything"): what the plant uses comes out of
 * Inventory as it is taken. Scan each case or bag with the Wasp (or the tablet's camera), or pick the product and type how many.
 * A barcode the app does not know asks once which product it is (the same list Receiving names barcodes into), and after that a
 * scan of it takes one out (a pallet label takes its count). FOR (a production line) is kept for the next scans. The list shows
 * what was taken out today; − puts one back. Each take-out is one Inventory History line (savePlantSchedule op use).
 */
import { save, escapeHtml, showError, shortDate } from './app.js';
import { collection, query, where, onSnapshot } from './firebase.js';
import { scanWithCamera, cameraReads, beep } from './scan-input.js';

const L = window.UDLogic, U = window.UDPlant, S = window.UDScan;
const today = () => L.operatingDay(new Date());
const num = (n) => Number(n || 0).toLocaleString('en-US');

export function mountTakeOut({ db, box, stationName, canSave, onChange }) {
  let items = [], moves = [], lines = [], gotItems = false, date = today();
  let forLine = '', pickId = '', pickQty = '', naming = null, last = '';
  const shown = [];   // take-outs the server does not have yet: { id, itemId, qty, forWhat }
  const changed = () => { if (onChange) onChange(); };
  const fail = () => () => {};
  const unsubs = [
    onSnapshot(query(collection(db, 'receivingItems'), where('status', '==', 'ACTIVE')), s => { items = s.docs.map(d => Object.assign({ id: d.id }, d.data())); gotItems = true; changed(); }, fail()),
    onSnapshot(collection(db, 'productionLines'), s => { lines = [...new Set(s.docs.map(d => String(d.data().name || d.data().line || '').trim()).filter(Boolean))].sort(); changed(); }, () => { lines = []; changed(); })
  ];
  let moveStop = null;
  function watchMoves() {
    if (moveStop) moveStop();
    date = today();
    moveStop = onSnapshot(query(collection(db, 'inventoryMoves'), where('date', '==', date)), s => {
      moves = s.docs.map(d => d.data()).filter(m => m.kind === 'USED' && m.how !== 'PRODUCTION');
      changed();
    }, () => { moves = []; changed(); });
  }
  watchMoves();

  const itemOf = (id) => items.find(i => i.id === id);
  const sorted = () => items.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
  const options = (sel) => '<option value=""></option>' + sorted().map(i => '<option value="' + escapeHtml(i.id) + '"' + (i.id === sel ? ' selected' : '') + '>' +
    escapeHtml(i.name) + (U.isMilk(i) ? ' (milk product)' : '') + '</option>').join('');

  // Today's take-outs by product and FOR, newest first.
  function rows() {
    const by = {};
    moves.concat(shown).forEach(m => {
      const k = m.itemId + '|' + (m.forWhat || '');
      const r = by[k] || (by[k] = { itemId: m.itemId, forWhat: m.forWhat || '', qty: 0, at: '' });
      r.qty += Number(m.qty) || 0;
      if (String(m.at || '~') > r.at) r.at = String(m.at || '~');
    });
    return Object.values(by).filter(r => r.qty).sort((a, b) => b.at.localeCompare(a.at));
  }

  function html() {
    const ok = canSave();
    let h = '<section class="sw-panel to-panel"><div class="sw-panel-head"><h2>Take Out</h2><span>What the plant uses comes out of Inventory · ' + escapeHtml(shortDate(date)) + '</span></div>';
    if (!ok) h += '<p class="sw-note">View only: this account cannot take stock out.</p>';
    h += '<div class="to-for"><label>FOR <select data-to="for" aria-label="What it is for"><option value=""></option>' + lines.map(n => '<option' + (n === forLine ? ' selected' : '') + '>' + escapeHtml(n) + '</option>').join('') +
      '<option' + (forLine === 'OTHER' ? ' selected' : '') + '>OTHER</option></select></label><small>Kept for the next scans.</small></div>';
    if (ok) {
      h += '<div class="rv-scan"><label class="rv-box"><span class="rv-dot" aria-hidden="true"></span><input data-scan-box inputmode="none" autocomplete="off" spellcheck="false" ' +
        'placeholder="Ready: scan each case or bag as you take it out" aria-label="Scan box"></label>' +
        (cameraReads() ? '<button type="button" class="sw-btn rv-cam" data-to="cam">Use camera</button>' : '') + '</div>';
      if (naming) {
        h += '<div class="to-name" role="alert"><b>NEW BARCODE ' + escapeHtml(S.shownCode(naming.p)) + '</b><span>Which product is it? Pick it once and the app knows it from then on.</span>' +
          '<select data-to="name" aria-label="Which product is it?">' + options('') + '</select><button type="button" class="sw-btn" data-to="name-cancel">Cancel</button></div>';
      }
      h += '<div class="to-hand"><span>OR PICK IT</span><select data-to="pick" aria-label="Product">' + options(pickId) + '</select>' +
        '<input data-to="qty" data-k="toqty" data-id="takeout" inputmode="numeric" maxlength="7" placeholder="How many" aria-label="How many" value="' + escapeHtml(pickQty) + '">' +
        '<button type="button" class="sw-btn primary" data-to="take">Take out</button></div>';
    }
    const list = rows();
    if (list.length) {
      h += '<table class="rv-table to-table"><thead><tr><th>Product</th><th class="rv-n">Taken out today</th><th>For</th>' + (ok ? '<th></th>' : '') + '</tr></thead><tbody>' +
        list.map(r => {
          const it = itemOf(r.itemId) || {};
          return '<tr' + (r.itemId + '|' + r.forWhat === last ? ' class="to-last"' : '') + '><td><b>' + escapeHtml(it.name || 'Removed product') + '</b></td><td class="rv-n"><b>' + num(r.qty) + '</b> ' + escapeHtml(String(it.unit || '').toUpperCase()) +
            '</td><td>' + escapeHtml(r.forWhat || '—') + '</td>' + (ok ? '<td class="rv-n"><button type="button" class="rv-step" data-to="back" data-item="' + escapeHtml(r.itemId) + '" data-for="' + escapeHtml(r.forWhat) +
            '" aria-label="Put one back">&minus;</button></td>' : '') + '</tr>';
        }).join('') + '</tbody></table>';
    } else h += '<p class="sw-empty">' + (gotItems ? 'Nothing taken out yet today.' : 'Reading the products&hellip;') + '</p>';
    return h + '</section>';
  }

  let n = 0;
  function takeOut(itemId, qty, how) {
    const it = itemOf(itemId);
    if (!it) { beep(false); showError('That product is no longer on the list.'); return; }
    const id = 'to' + (++n), entry = { id, itemId, qty, forWhat: forLine, at: '~' + n };
    shown.push(entry);
    last = itemId + '|' + forLine;
    changed();
    save('savePlantSchedule', { lane: 'RECEIVING', op: 'use', itemId, qty: String(qty), forWhat: forLine, station: stationName(), how })
      .then(() => { showError(''); })
      .catch(e => { beep(false); showError('Not taken out (' + (e.message || e) + ').'); })
      .finally(() => { const i = shown.indexOf(entry); if (i >= 0) shown.splice(i, 1); changed(); });
  }
  function onScan(raw) {
    if (!canSave()) { beep(false); showError('This tablet cannot take stock out.'); return; }
    const p = S.parseScan(raw), key = S.barcodeKey(p);
    if (!key) { beep(false); showError('That barcode could not be read. Scan it again.'); return; }
    const it = items.find(i => (i.barcodes || []).indexOf(key) >= 0);
    if (!it) { beep(false); naming = { raw, p, key }; changed(); return; }
    beep(true);
    takeOut(it.id, S.scanQuantity(p), 'SCAN');
  }

  box.addEventListener('change', e => {
    const el = e.target.closest('[data-to]');
    if (!el) return;
    if (el.dataset.to === 'for') { forLine = el.value; changed(); }
    if (el.dataset.to === 'pick') { pickId = el.value; }
    if (el.dataset.to === 'name' && el.value && naming) {
      const was = naming, itemId = el.value;
      naming = null;
      changed();
      save('savePlantSchedule', { lane: 'RECEIVING', op: 'linkBarcode', itemId, raw: was.raw })
        .then(() => { const it = itemOf(itemId); if (it) it.barcodes = (it.barcodes || []).concat([was.key]); takeOut(itemId, S.scanQuantity(was.p), 'SCAN'); })
        .catch(err => { beep(false); showError('Not saved (' + (err.message || err) + ').'); });
    }
  });
  box.addEventListener('input', e => { const el = e.target.closest('[data-to="qty"]'); if (el) pickQty = el.value; });
  box.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest && e.target.closest('[data-to="qty"]')) { e.preventDefault(); handTake(); } });
  function handTake() {
    const t = String(pickQty || '').replace(/,/g, '').trim();
    if (!pickId) { showError('Pick the product you are taking out.'); return; }
    if (!/^[0-9]{1,7}$/.test(t) || Number(t) < 1) { showError('Type how many you are taking out, as a whole number.'); return; }
    takeOut(pickId, Number(t), 'HAND');
    pickQty = '';
  }
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-to]');
    if (!b || b.tagName !== 'BUTTON') return;
    const a = b.dataset.to;
    if (a === 'take') handTake();
    if (a === 'name-cancel') { naming = null; changed(); }
    if (a === 'cam') scanWithCamera().then(raw => { if (raw) onScan(raw); }).catch(err => { beep(false); showError(err.message || String(err)); });
    if (a === 'back') {
      const prev = forLine;
      forLine = b.dataset.for || '';
      takeOut(b.dataset.item, -1, 'HAND');
      forLine = prev;
    }
  });

  return {
    html,
    onScan,
    dayChanged() { if (today() !== date) watchMoves(); },
    stop() { unsubs.forEach(u => u()); if (moveStop) moveStop(); }
  };
}
