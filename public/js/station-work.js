/*
 * The Plant Station's own work screens (Joe 10/12, of the desktop Daily Case Loadout opened from a station: "This should only
 * be a mobile view. and not be able to see all the information. This is for the employees."). As on the current app's locked
 * Plant Station (PlantStation.html), the station's work shows on the Plant Station page itself: today only, its own work area
 * only, one card per load that a finger can work. No dates, no other areas, no Edit box, no manager numbers, and no link to
 * any manager screen. The saves are the same ones the Loadout Center and Unloading & Washing make.
 */
import { save, escapeHtml, shortDate, showError, allowedSaves } from './app.js';
import { collection, doc, query, where, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import * as P from './plant-core.js';
import { watchProducts, OTHER } from './products.js';

const L = window.UDLogic, U = window.UDPlant;
const today = () => L.operatingDay(new Date());
const qty = (v) => (v === null || v === undefined || v === '' ? '' : String(v));
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
// SKIP saves nothing (PlantStation.html:263-269): the load waits at the bottom until it is started. Kept for the day on this tablet.
const SKIP_KEY = 'udLoadoutSkipped';
const readSkips = () => { try { return JSON.parse(sessionStorage.getItem(SKIP_KEY) || '{}') || {}; } catch (e) { return {}; } };

export function mountStationWork({ db, box, person, onDraw }) {
  let station = null, view = '', date = today();
  let runs = [], pickups = [], week = [], queue = [], sheetWash = [], appWash = [], app = {}, products = [];
  // Boxing: the Plant Operations Scheduler's Shipping and Receiving loads (read only while a Boxing station is open).
  const sched = { SHIPPING: [], RECEIVING: [] };
  let routeDocs = [];   // Route Master (coverage_type), for a United Dairy account; a station-code tablet cannot read it
  const got = { runs: false, week: false, SHIPPING: false, RECEIVING: false };
  const pending = {};       // card id -> what is shown before the server has it
  const drafts = {};        // card id -> { field: typed value } until it is saved
  const opened = {}, closed = {}, puForm = {}, pauseForm = {};
  // A refused start (the loading limit) shows on the card that was tapped too, where the finger is.
  const refused = {};
  const refuse = (id, m) => { showError(m); refused[id] = m; render(); setTimeout(() => { if (refused[id] === m) { delete refused[id]; render(); } }, 8000); };
  const refusal = (id) => (refused[id] ? '<p class="sw-refuse" role="alert">' + escapeHtml(refused[id]) + '</p>' : '');
  const returned = {}, washedNow = {};
  const skipped = readSkips();
  const keepSkips = () => { try { sessionStorage.setItem(SKIP_KEY, JSON.stringify(skipped)); } catch (e) { /* private window */ } };
  const isSkipped = (r) => !!(skipped[date] && skipped[date][r.id]) && r.state === 'WAITING';
  let unsubs = [];

  // The role, or what Administration > People & Roles allows this person (asked of the server once per person).
  const VIEW_SAVE = { loading: 'savePlantLoad', unloading: 'saveUnloading', washing: 'completeWash', returns: 'addReturn', receiving: 'savePlantSchedule' };
  let allowed = {}, askedFor = null;
  const askRights = () => {
    const p = person(), key = p ? (p.email || p.name || '') + '|' + (p.roles || []).join(',') : null;
    if (!p || key === askedFor) return;
    askedFor = key;
    allowedSaves(Object.values(VIEW_SAVE).concat(['addPickup', 'completePickup', 'savePlantSchedule'])).then(a => { allowed = a; render(); });
  };
  const canSave = () => (L.hasRole(person(), L.SAVE_ROLES.concat(['PLANT_EMPLOYEE'])) || allowed[VIEW_SAVE[view] || 'savePlantLoad'] === true) && L.screenState(app, view === 'receiving' ? 'plant' : 'plantLoading').open;
  // A scheduled load saves through the Scheduler's save, which follows the Plant Operations switch (not Plant Loading).
  const canSched = () => (L.hasRole(person(), L.SAVE_ROLES.concat(['PLANT_EMPLOYEE'])) || allowed.savePlantSchedule === true) && L.screenState(app, 'plant').open;
  const myName = () => (station && station.name) || '';
  const weekDays = () => { const s = L.weekStart(date), out = []; for (let d = s; d <= date; d = L.addDays(d, 1)) out.push(d); return out; };
  const dayJournal = () => week.filter(d => d.date === date);

  // ---- what each view lists
  const area = () => (station && station.area) || '';
  const inArea = (r) => !area() || r.area === area();
  function loads() {
    return P.loadoutRows(runs, date).filter(inArea).map(r => (pending[r.id] ? Object.assign({}, r, pending[r.id]) : r));
  }
  function returnsList() {
    return P.returnsFor(runs, date, dayJournal(), queue).map(x => (returned[x.id] ? Object.assign({}, x, { pending: false }) : x));
  }
  function unloads() {
    const rets = returnsList();
    return P.unloadRows(runs, date, dayJournal(), rets, P.loadoutRows(runs, date)).filter(inArea).map(r => (pending[r.key] ? Object.assign({}, r, pending[r.key]) : r));
  }
  function washes() {
    const earlier = weekDays().filter(d => d < date).flatMap(d => P.washItems(d, [], [], week).filter(w => w.kind === 'UNLOAD'));
    return P.washItems(date, sheetWash, appWash, week).concat(earlier).filter(w => !washedNow[U.unitKey(w.trailer)]);
  }

  // Boxing (Joe 10/12): the Scheduler's loads for today. Shipping is loaded on its load day (blank = the pickup day);
  // Receiving arrives on its day. A shipment that is also one of the box loads is worked on the box load's card.
  const boxing = () => !!station && station.id === 'BOXING';
  function shipments() {
    if (!boxing()) return [];
    const box = loads();
    return U.scheduleEntries(sched.SHIPPING, 'SHIPPING').filter(x => (x.loadDate || x.date) === date && !box.some(r => sameRun(r, x))).map(withShown);
  }
  // The same customer run: its run ID, or the same route number and run name.
  const up = (v) => String(v || '').trim().toUpperCase();
  const sameRun = (a, b) => (a.runId && a.runId === b.runId) || (!!up(a.route) && up(a.route) === up(b.route) && up(a.run) === up(b.run));
  function deliveries() {
    return boxing() ? U.scheduleEntries(sched.RECEIVING, 'RECEIVING').filter(x => x.date === date).map(withShown) : [];
  }
  const withShown = (x) => { const k = 'sch:' + x.id, p = pending[k]; return p ? Object.assign({}, x, { trailer: p.trailer !== undefined ? p.trailer : x.trailer, work: Object.assign({}, x.work, p.work) }) : x; };
  // Who takes the load (the Scheduler's legend): Carrier on the load itself, otherwise the run's Route Master coverage_type.
  const HAULER = { ut: 'UNIONTOWN', branch: 'BRANCH', carrier: 'CARRIER' };
  function hauler(x, carrier) {
    if (carrier) return 'carrier';
    const route = routeDocs.find(r => x.runId && r.runId === x.runId) || routeDocs.find(r => up(r.routeCode || r.route) === up(x.route)) || {};
    const run = runs.find(r => x.runDocId && r.id === x.runDocId) || runs.find(r => x.runId && r.runId === x.runId) || {};
    const t = up(route.coverageType || run.coverageType);
    return t === 'BRANCH' ? 'branch' : t && t !== 'UNITED DAIRY' ? 'carrier' : 'ut';
  }
  const minutesOf = (hhmm) => { const m = /^(\d{2}):(\d{2})$/.exec(hhmm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const clock = (hhmm) => { const m = minutesOf(hhmm); return m === null ? (hhmm || '') : P.timeOfDay(m); };
  // Joe 10/12: Case Loadout loads at most 2 loads at the same time and Boxing at most 3 (its shipments too). A paused load
  // does not count; to resume one the count must be under the limit. The server checks the same.
  const LIMIT = { CASE: 2, BOXING: 3 };
  function limitMessage(exceptId) {
    const max = LIMIT[area()];
    if (!max || (station && station.id === 'CASE_UNLOADING')) return '';
    const n = loads().filter(r => r.id !== exceptId && r.state === 'LOADING' && !r.paused).length + shipments().filter(x => 'sch:' + x.id !== exceptId && x.work.state === 'WORKING').length;
    return n >= max ? n + ' loads are already loading. Finish or pause one first.' : '';
  }

  // ---- drawing
  const val = (id, k, v) => (drafts[id] && drafts[id][k] !== undefined ? drafts[id][k] : v);
  function field(id, k, label, v, opts) {
    const o = opts || {}, dis = o.disabled ? ' disabled' : '', value = escapeHtml(val(id, k, v));
    const ctl = o.wide ? '<textarea data-k="' + k + '" data-id="' + escapeHtml(id) + '" maxlength="1200"' + dis + '>' + value + '</textarea>'
      : '<input data-k="' + k + '" data-id="' + escapeHtml(id) + '" value="' + value + '"' + (o.mode ? ' inputmode="' + o.mode + '"' : '') + ' autocomplete="off"' + dis + '>';
    return '<label class="sw-field' + (o.wide ? ' wide' : '') + '"><span>' + label + '</span>' + ctl + '</label>';
  }
  const btn = (label, act, id, cls) => '<button type="button" class="sw-btn ' + (cls || '') + '" data-act="' + act + '" data-id="' + escapeHtml(id) + '">' + label + '</button>';
  const badge = (word, cls) => '<span class="sw-badge ' + (cls || '') + '">' + word + '</span>';
  const chev = (isOpen) => '<span class="sw-chev" aria-hidden="true">' + (isOpen ? '&#9650;' : '&#9660;') + '</span>';

  function panel(title, count, body) {
    return '<section class="sw-panel"><div class="sw-panel-head"><h2>' + title + '</h2><span>' + count + ' · ' + escapeHtml(shortDate(date)) + '</span></div>' + body + '</section>';
  }

  function loadingView() {
    const all = loads(), ck = canSave(), unit = P.AREA[area() || 'CASE'];
    const order = (r) => (r.prior ? 0 : 2) + (isSkipped(r) ? 1 : 0);
    const rows = all.map((r, i) => ({ r, i })).sort((a, b) => order(a.r) - order(b.r) || a.i - b.i).map(x => x.r);
    const pk = P.withNotePickups(all, pickups), ships = shipments(), box = boxing();
    // A box load the Scheduler marks Carrier is a carrier's load (the Scheduler's line itself is worked on this card).
    const carried = box ? U.scheduleEntries(sched.SHIPPING, 'SHIPPING').filter(x => (x.loadDate || x.date) === date && x.scheduleType === 'CARRIER') : [];
    // Boxing: each scheduled shipment goes in among today's box loads by its pickup time; the box loads keep their order.
    const list = [];
    let si = 0;
    const ship = ships.slice().sort((a, b) => (minutesOf(a.pickupTime) ?? 9999) - (minutesOf(b.pickupTime) ?? 9999));
    rows.forEach(r => {
      const t = r.prior ? -1 : Number(r.dispatchTime);
      while (!r.prior && isFinite(t) && si < ship.length && minutesOf(ship[si].pickupTime) !== null && minutesOf(ship[si].pickupTime) < t) list.push({ s: ship[si++] });
      list.push({ r });
    });
    while (si < ship.length) list.push({ s: ship[si++] });
    const total = rows.length + ships.length, left = rows.filter(r => r.state !== 'DONE').length + ships.filter(x => x.work.state !== 'COMPLETE').length;
    let html = (box ? LEGEND : '') + '<div class="sw-band start"><b>&#9660; START</b><span>' + (box ? 'Shipping' : 'Loading') + ' today · ' + escapeHtml(L.dayName(date).slice(0, 3) + ', ' + shortDate(date)) + '</span><i>' + left + ' remaining of ' + plural(total, 'load') + '</i></div>';
    html += '<div class="sw-cols" aria-hidden="true"><span>Route</span><span>' + (box ? 'Run / customer' : 'Run') + '</span><span class="truck">' + (box ? 'Truck / pickup' : 'Truck') + '</span><span>Trailer</span><span>Status</span></div>';
    let lastPrior = null;
    list.forEach(({ r, s }) => {
      if (s) { html += shipCard(s); return; }
      if (r.prior && lastPrior !== true) html += '<p class="sw-group prior">Still open from ' + escapeHtml(L.dayName(r.loadDate) + ' ' + shortDate(r.loadDate)) + ': finish these first</p>';
      if (!r.prior && lastPrior === true) html += '<p class="sw-group">Today</p>';
      lastPrior = r.prior;
      const items = P.pickupsFor(r, pk), open = items.filter(P.pickupOpen).length, st = r.state, skip = isSkipped(r);
      const going = st === 'LOADING' && !r.paused, isOpen = going ? !closed[r.id] : !!opened[r.id], done = st === 'DONE';
      const status = done ? badge('COMPLETE', 'done') : r.paused ? badge('PAUSED', 'paused') : st === 'LOADING' ? badge('LOADING', 'going') : badge('WAITING');
      const quick = ck && !isOpen ? (st === 'WAITING' ? '<span class="sw-quick">' + (skip ? '' : btn('SKIP', 'skip', r.id, 'warn')) + btn('START LOADING', 'start', r.id, 'primary') + '</span>'
        : r.paused ? '<span class="sw-quick">' + btn('RESUME', 'resume', r.id, 'primary') + '</span>' : '') : '';
      const by = box ? hauler(r, carried.some(x => sameRun(r, x))) : '';
      html += '<article class="sw-card ' + (done ? 'done' : r.paused ? 'paused' : st === 'LOADING' ? 'run' : '') + (skip ? ' skipped' : '') + (isOpen ? ' open' : '') + (by ? ' by-' + by : '') + '" data-sw="' + escapeHtml(r.id) + '">' +
        '<div class="sw-head" data-toggle="' + escapeHtml(r.id) + '" role="button" tabindex="0" aria-expanded="' + isOpen + '">' +
        '<b class="route">' + escapeHtml(r.route) + '</b><b class="run">' + escapeHtml(r.run) + (by ? who(by) : '') + '</b><span class="truck">' + escapeHtml(r.truck || '—') + '</span><span class="trailer">' + escapeHtml(r.trailer || '—') + '</span>' +
        '<span class="sw-state">' + status + (open ? '<i class="sw-flag pu">' + plural(open, 'PICKUP') + '</i>' : '') + (skip ? '<i class="sw-flag skip">SKIPPED · COME BACK</i>' : '') + '</span>' + quick + chev(isOpen) + '</div>' + refusal(r.id);
      if (isOpen) {
        const dis = !ck || done;
        html += '<div class="sw-body"><div class="sw-fields">' + field(r.id, 'quantity', unit.label, qty(r.quantity), { mode: 'numeric', disabled: dis }) + field(r.id, 'truck', 'Truck', r.truck, { disabled: dis }) +
          field(r.id, 'trailer', 'Trailer', r.trailer, { disabled: dis }) + field(r.id, 'temperature', 'Temperature', qty(r.temperature), { mode: 'decimal', disabled: dis }) + '</div>' +
          field(r.id, 'notes', 'Notes', r.notes, { wide: true, disabled: dis }) + pickupBox(r, items, ck) +
          pauseBox(r.id, ck && !done) +
          (ck ? '<div class="sw-actions">' + btn('+ ADD PICKUP', 'pickup', r.id, 'pick') + (st === 'WAITING' ? (skip ? '' : btn('SKIP', 'skip', r.id, 'warn')) + btn('START LOADING', 'start', r.id, 'primary')
            : r.paused ? btn('SAVE LOADING', 'saveload', r.id, 'primary') + btn('RESUME', 'resume', r.id, 'good')
            : st === 'LOADING' ? btn('SAVE LOADING', 'saveload', r.id, 'primary') + btn('PAUSE', 'pause', r.id, 'warn') + btn('COMPLETE', 'complete', r.id, 'good') : badge('COMPLETE', 'done')) + '</div>' : '') + '</div>';
      }
      html += '</article>';
    });
    if (!list.length) html += '<p class="sw-empty">' + (got.runs ? 'No ' + unit.tile.toLowerCase() + ' loads ' + (box ? 'or shipments ' : '') + 'today.' : 'Reading today\'s loads&hellip;') + '</p>';
    html += '<div class="sw-band end"><b>&#9632; END</b><span>of today\'s ' + (box ? 'shipping' : 'loadout') + '</span></div>';
    return panel(box ? 'Shipping / Loadout' : 'Loading', plural(total, 'item'), '<div class="sw-list">' + html + '</div>');
  }
  const LEGEND = '<div class="sw-legend" aria-label="Who takes the load"><span><i class="ut"></i>Uniontown truck</span><span><i class="branch"></i>Branch</span><span><i class="carrier"></i>Carrier</span></div>';
  const who = (by) => '<span class="sw-who ' + by + '">' + HAULER[by] + '</span>';

  // A scheduled load's card (Shipping on the Shipping / Loadout tab, Receiving on Receiving): start, the boxes typed, complete.
  function schedCard(x, lane) {
    const id = 'sch:' + x.id, st = x.work.state, done = st === 'COMPLETE', going = st === 'WORKING', paused = st === 'PAUSED', ck = canSched(), recv = lane === 'RECEIVING';
    const isOpen = going ? !closed[id] : !!opened[id], by = recv ? '' : hauler(x, x.scheduleType === 'CARRIER');
    const name = x.run || x.route || 'Plant pickup', status = done ? badge(recv ? 'RECEIVED' : 'COMPLETE', 'done') : paused ? badge('PAUSED', 'paused') : going ? badge(recv ? 'RECEIVING' : 'LOADING', 'going') : badge('WAITING');
    const startLabel = recv ? 'START RECEIVING' : 'START LOADING';
    const quick = ck && !isOpen && (st === 'WAITING' || paused) ? '<span class="sw-quick">' + btn(paused ? 'RESUME' : startLabel, 'sstart', id, 'primary') + '</span>' : '';
    const detail = [x.pickupTime ? clock(x.pickupTime) : '', x.poNumber ? 'PO ' + x.poNumber : '', x.trailer || 'Trailer not typed yet', x.product, x.cases ? x.cases + ' cases' : ''].filter(Boolean).join(' · ');
    let html = '<article class="sw-card sched ' + (done ? 'done' : paused ? 'paused' : going ? 'run' : '') + (isOpen ? ' open' : '') + (by ? ' by-' + by : '') + '" data-sw="' + escapeHtml(id) + '">';
    html += recv ? '<div class="sw-head tall" data-toggle="' + escapeHtml(id) + '" role="button" tabindex="0" aria-expanded="' + isOpen + '"><span class="sw-title"><b>' + escapeHtml(x.route + ' · ' + name) + '</b><small>' + escapeHtml(detail) + '</small></span>'
      : '<div class="sw-head" data-toggle="' + escapeHtml(id) + '" role="button" tabindex="0" aria-expanded="' + isOpen + '"><b class="route">' + escapeHtml(x.route) + '</b><b class="run">' + escapeHtml(name) + who(by) + '</b><span class="truck">' + escapeHtml(clock(x.pickupTime) || '—') + '</span><span class="trailer">' + escapeHtml(x.trailer || '—') + '</span>';
    html += '<span class="sw-state">' + status + '</span>' + quick + chev(isOpen) + '</div>' + refusal(id);
    if (isOpen) {
      const dis = !ck || done;
      html += '<div class="sw-body"><div class="sw-fields">' + field(id, 'count', recv ? 'Cases / pallets in' : 'Boxes', x.work.count, { mode: 'numeric', disabled: dis }) + field(id, 'trailer', 'Trailer', x.trailer, { disabled: dis }) +
        field(id, 'temperature', 'Temperature', x.work.temperature, { mode: 'decimal', disabled: dis }) + '<p class="sw-po"><span>PO</span><b>' + escapeHtml(x.poNumber || '—') + '</b></p></div>' +
        field(id, 'notes', 'Notes', x.work.notes || '', { wide: true, disabled: dis }) + pauseBox(id, ck && !done) +
        (ck ? '<div class="sw-actions">' + (st === 'WAITING' ? btn(startLabel, 'sstart', id, 'primary') : paused ? btn(recv ? 'SAVE RECEIVING' : 'SAVE LOADING', 'ssave', id, 'primary') + btn('RESUME', 'sstart', id, 'good')
          : going ? btn(recv ? 'SAVE RECEIVING' : 'SAVE LOADING', 'ssave', id, 'primary') + btn('PAUSE', 'pause', id, 'warn') + btn(recv ? 'RECEIVED' : 'COMPLETE', 'sdone', id, 'good') : badge(recv ? 'RECEIVED' : 'COMPLETE', 'done')) + '</div>' : '') + '</div>';
    }
    return html + '</article>';
  }
  const shipCard = (x) => schedCard(x, 'SHIPPING');

  function receivingView() {
    const list = deliveries(), left = list.filter(x => x.work.state !== 'COMPLETE').length;
    let html = list.map(x => schedCard(x, 'RECEIVING')).join('');
    if (!list.length) html = '<p class="sw-empty">' + (got.RECEIVING ? 'No deliveries on the Receiving schedule today.' : 'Reading today\'s deliveries&hellip;') + '</p>';
    return panel('Receiving', left + ' to receive of ' + plural(list.length, 'delivery').replace('deliverys', 'deliveries'), '<div class="sw-list">' + html + '</div>');
  }

  // Yard Services (Joe 10/12): the plant's own Trailer Assignments and Yard Checks screens, unchanged, inside the station.
  // In a frame each screen hides the app's header and menu by itself (app.js EMBED).
  const FRAME = { trailers: 'trailers.html', yardchecks: 'yard.html' };
  function frameView() {
    const test = new URLSearchParams(location.search).get('testEmail'), src = FRAME[view] + '?inStation=1' + (test ? '&testEmail=' + encodeURIComponent(test) : '');
    const have = box.querySelector('iframe.sw-frame');
    if (have && have.dataset.src === src) return;
    box.innerHTML = '<iframe class="sw-frame" data-src="' + escapeHtml(src) + '" src="' + escapeHtml(src) + '" title="' + (view === 'trailers' ? 'Trailer Assignments' : 'Yard Checks') + '"></iframe>';
  }
  // Pause (the current app's Plant Station): a reason is required; it goes on the load's notes.
  function pauseBox(id, ck) {
    return ck && pauseForm[id] ? '<div class="sw-puform sw-pause">' + field(id, 'pauseReason', 'Reason for pausing (required)', '') + btn('SAVE REASON &amp; PAUSE', 'pausego', id, 'warn') + btn('CANCEL', 'pausecancel', id) + '</div>' : '';
  }
  function pickupBox(r, items, ck) {
    const list = items.map(p => '<div class="sw-pu' + (P.pickupOpen(p) ? '' : ' done') + '"><span><b>' + escapeHtml(p.item) + (p.quantity ? ' · ' + escapeHtml(p.quantity) : '') + '</b>' +
      (p.notes ? '<small>' + escapeHtml(p.notes) + '</small>' : '') + '<small>' + (P.pickupOpen(p) ? 'Not loaded · the driver picks it up before leaving' : 'Picked up') + '</small></span>' +
      (ck && P.pickupOpen(p) ? '<button type="button" class="sw-btn" data-act="pudone" data-id="' + escapeHtml(r.id) + '" data-pu="' + escapeHtml(p.pickupId) + '">PICKUP COMPLETE</button>' : '') + '</div>').join('');
    const form = ck && puForm[r.id] ? '<div class="sw-puform">' + field(r.id, 'puItem', 'Product / item', '') + field(r.id, 'puQty', 'Quantity / cases', '', { mode: 'numeric' }) + field(r.id, 'puNote', 'Note', '') +
      btn('ADD PICKUP', 'puadd', r.id, 'primary') + btn('CANCEL', 'pucancel', r.id) + '</div>' : '';
    return list || form ? '<div class="sw-pickups"><h3>Pickups</h3>' + list + form + '</div>' : '';
  }

  function unloadingView() {
    const rows = unloads(), ck = canSave(), unit = P.UNLOAD_UNIT[area() || 'CASE'], wash = washes();
    const left = rows.filter(r => r.status !== 'COMPLETE').length;
    let html = '';
    rows.forEach(r => {
      const s = r.status, isOpen = s === 'UNLOADING' ? !closed[r.key] : !!opened[r.key], ws = P.washesForRow(r, wash), done = s === 'COMPLETE';
      const chips = [r.casesIn !== '' ? '<i class="ok">' + unit + ' · ' + escapeHtml(r.casesIn) + ' confirmed</i>' : '', r.pendingReturns.length ? '<i class="ret">Product return</i>' : r.returns.length ? '<i class="ok">Returned to the cooler</i>' : '',
        ws.length ? '<i class="wash">Wash required</i>' : r.washed ? '<i class="ok">Washed</i>' : ''].join('');
      const status = done ? badge('COMPLETE', 'done') : s === 'UNLOADING' ? badge('UNLOADING', 'going') : badge('WAITING');
      const quick = ck && s === 'WAITING' && !isOpen ? '<span class="sw-quick">' + btn('START UNLOADING', 'ustart', r.key, 'primary') + '</span>' : '';
      html += '<article class="sw-card ' + (done ? 'done' : s === 'UNLOADING' ? 'run' : '') + (r.pendingReturns.length ? ' ret' : '') + (isOpen ? ' open' : '') + '" data-sw="' + escapeHtml(r.key) + '">' +
        '<div class="sw-head tall" data-toggle="' + escapeHtml(r.key) + '" role="button" tabindex="0" aria-expanded="' + isOpen + '"><span class="sw-title"><b>' + escapeHtml(r.route + ' · ' + r.run) + '</b><small>' + escapeHtml(r.trailer || 'Trailer not typed yet') +
        (r.nextLoad ? ' · next: ' + escapeHtml([r.nextLoad.route, r.nextLoad.run, r.nextLoad.time].filter(Boolean).join(' · ')) : '') + '</small><span class="sw-chips">' + chips + '</span></span>' +
        '<span class="sw-state">' + status + '</span>' + quick + chev(isOpen) + '</div>';
      if (isOpen) {
        const dis = !ck || done;
        html += '<div class="sw-body"><div class="sw-fields two">' + field(r.key, 'casesIn', unit + ' in', r.casesIn, { mode: 'numeric', disabled: dis || s !== 'UNLOADING' }) + field(r.key, 'trailer', 'Trailer', r.trailer, { disabled: dis }) + '</div>' +
          field(r.key, 'notes', 'Notes', r.notes, { wide: true, disabled: dis || s !== 'UNLOADING' }) +
          '<div class="sw-step' + (r.pendingReturns.length ? ' need' : '') + '"><b>2</b><span><strong>Returned product</strong><small>' + escapeHtml(r.pendingReturns.length ? r.pendingReturns.map(x => x.detail).join('; ') : r.returns.length ? 'Back in the cooler' : 'No return assigned') + '</small></span>' +
          (r.pendingReturns.length ? (ck ? btn('BACK IN THE COOLER (RTA)', 'urta', r.key, 'danger') : badge('PENDING', 'ret')) : badge(r.returns.length ? 'DONE' : 'NOT REQUIRED', r.returns.length ? 'done' : '')) + '</div>' +
          '<div class="sw-step' + (ws.length ? ' wash' : '') + '"><b>3</b><span><strong>Washing</strong><small>' + escapeHtml(ws.length ? (r.trailer || 'Trailer') + ' · ' + ws.map(w => w.need).join('; ') : r.washed ? 'Washed' : 'No wash listed') + '</small></span>' +
          (ws.length ? (ck ? btn('CONFIRM WASHED', 'uwash', r.key, 'good') : badge('WASH NEEDED', 'wash')) : badge(r.washed ? 'DONE' : 'NOT REQUIRED', r.washed ? 'done' : '')) + '</div>' +
          (ck ? '<div class="sw-actions">' + (s === 'WAITING' ? btn('START UNLOADING', 'ustart', r.key, 'primary') : s === 'UNLOADING' ? btn('COMPLETE', 'uend', r.key, 'good') : badge('COMPLETE', 'done')) + '</div>' : '') + '</div>';
      }
      html += '</article>';
    });
    if (!rows.length) html = '<p class="sw-empty">' + (got.runs ? 'No trucks are back for unloading today.' : 'Reading today\'s loads&hellip;') + '</p>';
    return panel('Unloading', left + ' to unload of ' + plural(rows.length, 'item'), '<div class="sw-list">' + html + '</div>');
  }

  function washingView() {
    const list = washes(), ck = canSave();
    let html = ck ? '<form class="sw-add" data-form="wash"><h3>Washed a trailer nobody listed</h3>' + field('add-wash', 'trailer', 'Trailer', '') + '<button type="submit" class="sw-btn good">CONFIRM WASHED</button></form>' : '';
    html += list.map(w => '<article class="sw-card wash" data-sw="' + escapeHtml(w.id) + '"><div class="sw-head tall"><span class="sw-title"><b>' + escapeHtml(w.trailer || 'Trailer') + '</b><small>' +
      escapeHtml([[w.route, w.run].filter(Boolean).join(' · '), w.need, P.shortStamp(w.reported)].filter(Boolean).join(' · ')) + '</small></span>' +
      (ck ? btn('CONFIRM WASHED', 'wash', w.id, 'good') : badge('WASH NEEDED', 'wash')) + '</div></article>').join('');
    if (!list.length) html += '<p class="sw-empty">' + (got.week ? 'No trailers waiting to be washed.' : 'Reading the wash list&hellip;') + '</p>';
    return panel('Washing', plural(list.length, 'trailer') + ' to wash', '<div class="sw-list">' + html + '</div>');
  }

  function returnsView() {
    const list = returnsList(), ck = canSave(), pend = list.filter(x => x.pending).length;
    let html = '<p class="sw-rule"><b>Returned product goes back to the cooler.</b> Never dump it. Press RTA once it is in the cooler.</p>';
    if (ck) {
      const loadsBack = P.unloadRows(runs, date, dayJournal(), [], []).filter(inArea).sort((a, b) => String(a.route).localeCompare(String(b.route), undefined, { numeric: true }));
      const pick = val('add-ret', 'load', '');
      html += '<form class="sw-add ret" data-form="ret"><h3>Add a return nobody noted</h3><label class="sw-field"><span>Route</span><select data-k="load" data-id="add-ret"><option value="">Pick the route</option>' +
        loadsBack.map(r => '<option value="' + escapeHtml(r.key) + '"' + (pick === r.key ? ' selected' : '') + '>' + escapeHtml(r.route + ' · ' + r.run + (r.trailer ? ' · ' + r.trailer : '')) + '</option>').join('') +
        '<option value="unknown"' + (pick === 'unknown' ? ' selected' : '') + '>Unknown route</option></select></label>' +
        '<label class="sw-field"><span>Product</span><input data-k="product" data-id="add-ret" list="sw-products" autocomplete="off" value="' + escapeHtml(val('add-ret', 'product', '')) + '"></label>' +
        field('add-ret', 'cases', 'Cases', '', { mode: 'numeric' }) + '<button type="submit" class="sw-btn primary">ADD RETURN</button></form>' +
        '<datalist id="sw-products">' + products.map(p => '<option value="' + escapeHtml(p.name) + '"></option>').join('') + '</datalist>';
    }
    html += list.map(x => '<article class="sw-card ' + (x.pending ? 'ret' : 'done') + '" data-sw="' + escapeHtml(x.id) + '"><div class="sw-head tall"><span class="sw-title"><b>' + escapeHtml((x.route || 'Route') + (x.run ? ' · ' + x.run : '')) + '</b><small>' +
      escapeHtml([x.trailer, (x.refused ? 'Refused / returned · ' : '') + x.detail, x.cases ? x.cases + ' cases' : '', P.shortStamp(x.recordedAt)].filter(Boolean).join(' · ')) + '</small></span>' +
      (x.pending ? (ck && !x.readOnly ? btn('BACK IN THE COOLER (RTA)', 'rta', x.id, 'danger') : badge('PENDING', 'ret')) : badge('RETURNED', 'done')) + '</div></article>').join('');
    if (!list.length) html += '<p class="sw-empty">' + (got.runs && got.week ? 'No product returns today.' : 'Reading the returns&hellip;') + '</p>';
    return panel('Returns', pend + ' pending of ' + plural(list.length, 'return'), '<div class="sw-list">' + html + '</div>');
  }

  function render() {
    askRights();
    if (!station || !view) { box.innerHTML = ''; return; }
    if (FRAME[view]) { frameView(); if (onDraw) onDraw(); return; }
    // Keep the box being typed in (and what is typed) when a change from another screen redraws the list.
    const a = document.activeElement, keep = a && box.contains(a) && a.dataset && a.dataset.k ? [a.dataset.id, a.dataset.k, a.selectionStart] : null;
    const s = L.screenState(app, 'plantLoading');
    // Joe 10/12 photo ("I can't edit", a bare "View only."): say why. Either the screen is not open, or the account signed in
    // on this tablet has no plant role in the Users list.
    const p = person() || {}, who = (p.email || (p.cells && p.cells.email) || '') + (p.name ? ' (' + p.name + ')' : '') || 'This account';
    const why = s.why || (!s.open ? '' : who + ' is not allowed to save this. In Administration > People & Roles give it the Plant Employee role or allow this work, or sign this tablet in with its station code');
    const note = person() && !canSave() ? '<p class="sw-note">View only' + (why ? ': ' + escapeHtml(why) : '') + '.</p>' : '';
    box.innerHTML = note + (view === 'loading' ? loadingView() : view === 'unloading' ? unloadingView() : view === 'washing' ? washingView() : view === 'receiving' ? receivingView() : returnsView());
    held.forEach(h => {
      const card = h.id && box.querySelector('[data-sw="' + CSS.escape(h.id) + '"]'), at = card && (card.querySelector('.sw-head .sw-state') || card.querySelector('.sw-head .sw-title'));
      if (at && !at.querySelector('.sw-flag.wait')) at.insertAdjacentHTML('beforeend', '<i class="sw-flag wait">WAITING TO SEND</i>');
    });
    if (keep) {
      const el = box.querySelector('[data-id="' + CSS.escape(keep[0]) + '"][data-k="' + keep[1] + '"]');
      if (el) { el.focus(); try { if (keep[2] !== null && keep[2] !== undefined) el.setSelectionRange(keep[2], keep[2]); } catch (e) { /* not a text box */ } }
    }
    if (onDraw) onDraw();
  }

  // ---- saving
  let saveNo = 0;
  function show(id, shown) {
    const mine = ++saveNo;
    pending[id] = Object.assign({}, pending[id], shown, { _no: mine });
    render();
    return () => { if (pending[id] && pending[id]._no === mine) delete pending[id]; render(); };
  }
  // Joe 10/13: a tap saved with no signal waits on the tablet (js/offline-saves.js). Its card keeps showing it, marked
  // "WAITING TO SEND", until the tablet has sent everything that waited; then the card follows the database again.
  const held = [];
  const queued = (res) => !!(res && res.queued);
  function hold(id, clear) { held.push({ id, clear }); render(); }
  if (window.UD_STATION_OFFLINE) import('./offline-saves.js').then(o => o.onWaitingChange(list => {
    if (list.length || !held.length) return;
    const sent = held.splice(0);
    render();
    setTimeout(() => { sent.forEach(h => h.clear()); render(); }, 1500);
  })).catch(() => {});
  async function saveLoad(r, fields, shown) {
    const done = show(r.id, shown);
    let res;
    try { res = await save('savePlantLoad', { runDocId: r.runDocId, day: r.day, fields }); showError(''); delete drafts[r.id]; } catch (e) { const m = String(e.message || e); if (/already loading/.test(m)) refuse(r.id, m); else showError(r.route + ' ' + r.run + ': ' + m); }
    if (queued(res)) hold(r.id, done); else done();
  }
  const chain = {};
  async function saveUnload(r, fields, shown) {
    const done = show(r.key, shown);
    if (fields.returnIds) fields.returnIds.forEach(id => { returned[id] = true; });
    const turn = (chain[r.key] || Promise.resolve()).then(() => save('saveUnloading', { date, route: r.route, run: r.run, runDocId: r.runDocId, day: r.day, fields }));
    chain[r.key] = turn.catch(() => {});
    let ok = true, res;
    try { res = await turn; showError(''); } catch (e) { ok = false; showError(r.route + ' ' + r.run + ': ' + (e.message || e)); }
    const back = () => { if (fields.returnIds) fields.returnIds.forEach(id => { delete returned[id]; }); done(); };
    if (queued(res)) hold(r.key, back);
    else { if (fields.returnIds) setTimeout(() => { fields.returnIds.forEach(id => { delete returned[id]; }); render(); }, ok ? 1500 : 0); done(); }
    return ok;
  }
  async function washTrailer(trailer) {
    const unit = U.unitKey(trailer), mine = washes().filter(w => U.unitKey(w.trailer) === unit);
    washedNow[unit] = true;
    render();
    try {
      const res = await save('completeWash', { date, trailer: U.trailerText(trailer), close: mine.flatMap(w => w.refs) });
      showError('');
      if (queued(res)) hold(mine.length ? mine[0].id : '', () => { delete washedNow[unit]; });
      else setTimeout(() => { delete washedNow[unit]; render(); }, 1500);
    } catch (e) {
      delete washedNow[unit];
      showError('Wash ' + trailer + ' not saved (' + (e.message || e) + '). Press Confirm Washed again.');
      render();
    }
  }
  // A scheduled load: start, save what was typed, or complete (the Scheduler's save, op progress).
  async function saveSched(x, lane, step, reason) {
    const id = 'sch:' + x.id, d = drafts[id] || {}, fields = {};
    [['count', x.work.count], ['trailer', x.trailer], ['temperature', x.work.temperature], ['notes', x.work.notes]].forEach(([k, was]) => {
      if (d[k] !== undefined && String(d[k]).trim() !== String(was || '').trim()) fields[k] = k === 'trailer' ? String(d[k]).trim().toUpperCase() : String(d[k]).trim();
    });
    if (fields.count !== undefined) fields.count = fields.count.replace(/,/g, '');
    if (fields.count && !/^\d+$/.test(fields.count)) { showError('Type a whole number for ' + (lane === 'RECEIVING' ? 'cases / pallets in' : 'boxes') + '.'); return; }
    if (step === 'save' && !Object.keys(fields).length) { showError('Nothing changed on ' + x.route + ' ' + (x.run || '') + '.'); return; }
    const work = Object.assign({}, fields, { state: step === 'complete' ? 'COMPLETE' : step === 'pause' || (step === 'save' && x.work.state === 'PAUSED') ? 'PAUSED' : 'WORKING' });
    delete work.trailer;
    const shown = { work };
    if (fields.trailer !== undefined) shown.trailer = fields.trailer;
    if (step === 'start') delete closed[id];
    if (step === 'pause') { delete pauseForm[id]; closed[id] = true; delete opened[id]; }
    if (step === 'complete') delete opened[id];
    const done = show(id, shown);
    // Only what this save sent is cleared: a box typed while it was on its way stays typed.
    const sent = Object.assign({}, d);
    let res;
    try {
      res = await save('savePlantSchedule', Object.assign({ lane, op: 'progress', id: x.id, date: x.date, step, fields }, step === 'pause' ? { pauseReason: reason } : {})); showError('');
      if (step === 'pause') delete pauseForm[id];
      if (drafts[id]) Object.keys(fields).forEach(k => { if (drafts[id][k] === sent[k]) delete drafts[id][k]; });
    } catch (e) { const m = String(e.message || e); if (/already loading/.test(m)) refuse(id, m); else showError(x.route + ' ' + (x.run || '') + ': ' + m); }
    if (queued(res)) hold(id, done); else done();
  }

  // What was typed on a load's card and differs from the load.
  function typedLoad(r) {
    const d = drafts[r.id] || {}, fields = {}, shown = {};
    [['quantity', qty(r.quantity)], ['truck', r.truck], ['trailer', r.trailer], ['temperature', qty(r.temperature)], ['notes', r.notes]].forEach(([k, was]) => {
      if (d[k] === undefined || String(d[k]).trim() === String(was || '').trim()) return;
      fields[k] = String(d[k]).trim();
      shown[k] = k === 'quantity' ? (fields[k] ? Number(fields[k].replace(/,/g, '')) : null) : k === 'truck' || k === 'trailer' ? fields[k].toUpperCase() : fields[k];
    });
    if (fields.quantity && !/^\d[\d,]*$/.test(fields.quantity)) throw new Error('Type a whole number for ' + P.AREA[area() || 'CASE'].label + '.');
    return { fields, shown };
  }

  function act(b) {
    const a = b.dataset.act, id = b.dataset.id, now = new Date().toISOString();
    if (a === 'pause') { pauseForm[id] = true; opened[id] = true; delete closed[id]; render(); const f = box.querySelector('[data-id="' + CSS.escape(id) + '"][data-k="pauseReason"]'); if (f) f.focus(); return; }
    if (a === 'pausecancel') { delete pauseForm[id]; if (drafts[id]) delete drafts[id].pauseReason; render(); return; }
    const reason = String((drafts[id] || {}).pauseReason || '').trim();
    if (a === 'pausego' && !reason) { showError('Type the reason for pausing.'); return; }
    if (['sstart', 'ssave', 'sdone'].indexOf(a) >= 0 || (a === 'pausego' && id.indexOf('sch:') === 0)) {
      const lane = view === 'receiving' ? 'RECEIVING' : 'SHIPPING', x = (lane === 'RECEIVING' ? deliveries() : shipments()).find(y => 'sch:' + y.id === id);
      if (!x) return;
      if (a === 'sdone' && x.work.state !== 'WORKING') { showError(x.work.state === 'PAUSED' ? 'Tap RESUME first.' : 'Tap ' + (lane === 'RECEIVING' ? 'START RECEIVING' : 'START LOADING') + ' first.'); return; }
      if (a === 'sstart' && lane === 'SHIPPING') { const m = limitMessage(id); if (m) { refuse(id, m); return; } }
      delete refused[id];
      if (a === 'pausego' && drafts[id]) delete drafts[id].pauseReason;
      saveSched(x, lane, a === 'sstart' ? 'start' : a === 'ssave' ? 'save' : a === 'pausego' ? 'pause' : 'complete', reason);
      return;
    }
    if (['skip', 'start', 'resume', 'pausego', 'saveload', 'complete', 'pickup', 'puadd', 'pucancel', 'pudone'].indexOf(a) >= 0) {
      const r = loads().find(x => x.id === id);
      if (!r) return;
      if (a === 'skip') { (skipped[date] = skipped[date] || {})[r.id] = true; keepSkips(); delete opened[r.id]; render(); return; }
      if (a === 'pickup') { puForm[r.id] = true; opened[r.id] = true; delete closed[r.id]; render(); const f = box.querySelector('[data-id="' + CSS.escape(r.id) + '"][data-k="puItem"]'); if (f) f.focus(); return; }
      if (a === 'pucancel') { delete puForm[r.id]; if (drafts[r.id]) ['puItem', 'puQty', 'puNote'].forEach(k => delete drafts[r.id][k]); render(); return; }
      if (a === 'puadd') {
        const d = drafts[r.id] || {}, item = String(d.puItem || '').trim(), quantity = String(d.puQty || '').trim(), notes = String(d.puNote || '').trim();
        if (!item || !quantity) { showError('Enter the product and the quantity for the pickup.'); return; }
        const temp = { pickupId: 'new-' + Date.now(), runDocId: r.runDocId, day: r.day, runId: r.runId, date: r.loadDate, item, quantity, notes, status: 'PENDING', createdAt: now, createdByName: myName() };
        pickups = pickups.concat([temp]);
        delete puForm[r.id]; ['puItem', 'puQty', 'puNote'].forEach(k => delete d[k]);
        render();
        save('addPickup', { runDocId: r.runDocId, day: r.day, date: r.loadDate, item, quantity, notes, station: myName() }).then(() => showError(''))
          .catch(err => { pickups = pickups.filter(p => p !== temp); render(); showError('Pickup: ' + (err.message || err)); });
        return;
      }
      if (a === 'pudone') {
        const pid = b.dataset.pu, note = P.withNotePickups(loads(), pickups).find(p => p.pickupId === pid && p.source === 'LOAD_NOTE');
        if (note) {
          const temp = Object.assign({}, note, { source: '', quantity: 'See note', status: 'COMPLETE', completedAt: now, completedByName: myName() });
          pickups = pickups.concat([temp]);
          render();
          save('completePickup', { pickupId: pid, runDocId: note.runDocId, day: note.day, date: note.date, station: myName() }).catch(err => { pickups = pickups.filter(p => p !== temp); render(); showError('Pickup: ' + (err.message || err)); });
          return;
        }
        pickups = pickups.map(p => (p.pickupId === pid ? Object.assign({}, p, { status: 'COMPLETE', completedAt: now, completedByName: myName() }) : p));
        render();
        save('completePickup', { pickupId: pid, station: myName() }).catch(err => showError('Pickup: ' + (err.message || err)));
        return;
      }
      let typed;
      try { typed = typedLoad(r); } catch (e) { showError(e.message); return; }
      if (skipped[date] && skipped[date][r.id]) { delete skipped[date][r.id]; keepSkips(); }
      if (a === 'start' || a === 'resume') { const m = limitMessage(r.id); if (m) { refuse(r.id, m); return; } delete refused[r.id]; }
      if (a === 'start') { delete closed[r.id]; saveLoad(r, Object.assign(typed.fields, { startedAt: now, completedAt: '' }), Object.assign(typed.shown, { startedAt: now, completedAt: '', state: 'LOADING', paused: false })); return; }
      if (a === 'resume') { delete closed[r.id]; saveLoad(r, Object.assign(typed.fields, { status: 'LOADING' }), Object.assign(typed.shown, { state: 'LOADING', paused: false })); return; }
      if (a === 'pausego') {
        delete pauseForm[r.id]; if (drafts[r.id]) delete drafts[r.id].pauseReason; closed[r.id] = true; delete opened[r.id];
        saveLoad(r, Object.assign(typed.fields, { status: 'PAUSED', pauseReason: reason }), Object.assign(typed.shown, { paused: true }));
        return;
      }
      if (a === 'saveload') { if (!Object.keys(typed.fields).length) { showError('Nothing changed on ' + r.route + ' ' + r.run + '.'); return; } saveLoad(r, typed.fields, typed.shown); return; }
      if (a === 'complete') {
        if (r.state !== 'LOADING') { showError('Tap START LOADING before COMPLETE.'); return; }
        if (r.paused) { showError('Tap RESUME before COMPLETE.'); return; }
        delete opened[r.id];
        saveLoad(r, Object.assign(typed.fields, { completedAt: now }), Object.assign(typed.shown, { completedAt: now, state: 'DONE' }));
      }
      return;
    }
    if (['ustart', 'uend', 'urta', 'uwash'].indexOf(a) >= 0) {
      const all = unloads(), r = all.find(x => x.key === id);
      if (!r) return;
      if (a === 'ustart') {
        const busy = all.find(x => x.key !== r.key && x.status === 'UNLOADING');
        if (busy) { showError('Finish unloading ' + busy.route + ' · ' + busy.run + ' before starting another.'); return; }
        delete closed[r.key];
        saveUnload(r, { start: true }, { status: 'UNLOADING', startedAt: now });
      } else if (a === 'uend') {
        const typed = String(val(r.key, 'casesIn', r.casesIn)).trim().replace(/,/g, '');
        if (!/^\d+$/.test(typed)) { showError('Enter the ' + P.UNLOAD_UNIT[area() || 'CASE'].toLowerCase() + ' in before completing (0 if none).'); const f = box.querySelector('[data-id="' + CSS.escape(r.key) + '"][data-k="casesIn"]'); if (f) f.focus(); return; }
        if (r.pendingReturns.length) { showError('Put the returned product back in the cooler (RTA) before completing.'); return; }
        const first = typed !== r.casesIn ? saveUnload(r, { casesIn: String(Number(typed)) }, { casesIn: String(Number(typed)) }) : Promise.resolve(true);
        first.then(ok => { if (!ok) return; delete drafts[r.key]; const x = unloads().find(y => y.key === r.key); if (x) saveUnload(x, { end: true }, { status: 'COMPLETE', completedAt: new Date().toISOString() }); });
      } else if (a === 'urta') saveUnload(r, { returnIds: r.pendingReturns.map(x => x.id) }, {});
      else if (a === 'uwash') { const ws = P.washesForRow(r, washes()); if (ws.length) washTrailer(ws[0].trailer); }
      return;
    }
    if (a === 'wash') { const w = washes().find(x => x.id === id); if (w) washTrailer(w.trailer); return; }
    if (a === 'rta') {
      const x = returnsList().find(r => r.id === id);
      if (!x) return;
      returned[x.id] = true;
      render();
      save('saveUnloading', { date, route: x.route, run: x.run, runDocId: x.runDocId || '', day: x.day || '', fields: { returnIds: [x.id] } })
        .then(res => { showError(''); if (queued(res)) hold(x.id, () => { delete returned[x.id]; }); else setTimeout(() => { delete returned[x.id]; render(); }, 1500); })
        .catch(err => { delete returned[x.id]; render(); showError('RTA for ' + x.route + ' ' + x.run + ' not saved (' + (err.message || err) + '). Press RTA again.'); });
    }
  }

  box.addEventListener('input', e => {
    const el = e.target.closest('[data-k]');
    if (!el) return;
    (drafts[el.dataset.id] = drafts[el.dataset.id] || {})[el.dataset.k] = el.value;
  });
  // Unloading saves each box when it is left (as the current app's Plant Station did); loading waits for SAVE LOADING.
  box.addEventListener('change', e => {
    const el = e.target.closest('[data-k]');
    if (!el || view !== 'unloading') return;
    const r = unloads().find(x => x.key === el.dataset.id), k = el.dataset.k;
    if (!r) return;
    let v = String(el.value || '').trim();
    if (k === 'casesIn') {
      if (!v || v === r.casesIn) return;
      if (!/^\d+$/.test(v.replace(/,/g, ''))) { showError('Enter a whole quantity, including zero if none.'); return; }
      v = String(Number(v.replace(/,/g, '')));
      saveUnload(r, { casesIn: v }, { casesIn: v }).then(ok => { if (ok && drafts[r.key]) delete drafts[r.key].casesIn; });
    } else if (k === 'trailer') {
      v = U.trailerText(v);
      if (!v || v === r.trailer) return;
      saveUnload(r, { trailer: v }, { trailer: v, trailerTyped: true }).then(ok => { if (ok && drafts[r.key]) delete drafts[r.key].trailer; });
    } else if (k === 'notes' && v !== r.notes) {
      saveUnload(r, { notes: v }, { notes: v }).then(ok => { if (ok && drafts[r.key]) delete drafts[r.key].notes; });
    }
  });
  // A button keeps the box being typed in from losing its words to a redraw between pressing and letting go.
  box.addEventListener('mousedown', e => { if (e.target.closest('button[data-act]') && document.activeElement && document.activeElement.dataset && document.activeElement.dataset.k) e.preventDefault(); });
  box.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (b) { act(b); return; }
    const t = e.target.closest('[data-toggle]');
    if (!t || e.target.closest('input, textarea, select')) return;
    toggle(t.dataset.toggle);
  });
  box.addEventListener('keydown', e => {
    const t = e.target.closest && e.target.closest('[data-toggle]');
    if (t && e.target === t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(t.dataset.toggle); return; }
    if (e.key === 'Enter' && e.target.matches && e.target.matches('input[data-k]') && view === 'unloading') { e.preventDefault(); e.target.blur(); }
  });
  function toggle(id) {
    const card = box.querySelector('[data-sw="' + CSS.escape(id) + '"]'), isOpen = card && card.classList.contains('open');
    if (isOpen) { closed[id] = true; delete opened[id]; } else { opened[id] = true; delete closed[id]; }
    render();
  }
  box.addEventListener('submit', e => {
    e.preventDefault();
    const form = e.target.closest('[data-form]');
    if (!form || !canSave()) return;
    if (form.dataset.form === 'wash') {
      const v = U.trailerText(val('add-wash', 'trailer', ''));
      if (!v) { showError('Type the trailer number, then press Confirm Washed.'); return; }
      delete drafts['add-wash'];
      washTrailer(v);
      return;
    }
    const d = drafts['add-ret'] || {}, pick = d.load || '', r = pick === 'unknown' ? null : P.unloadRows(runs, date, dayJournal(), [], []).find(x => x.key === pick);
    const typed = String(d.product || '').trim(), cases = String(d.cases || '').trim(), p = products.find(x => x.name.toLowerCase() === typed.toLowerCase());
    if (!pick || (pick !== 'unknown' && !r)) { showError('Pick the route the product came back on, or Unknown route.'); return; }
    if (!typed || typed === OTHER) { showError('Type the product returned.'); return; }
    if (!/^\d+$/.test(cases) || Number(cases) < 1) { showError('Enter the cases returned.'); return; }
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    save('addReturn', Object.assign({ date, product: p ? p.name : typed, sku: (p && p.sku) || '', cases }, r ? { route: r.route, run: r.run, runDocId: r.runDocId || '', day: r.day || '', trailer: r.trailer || '' } : { unknown: true }))
      .then(() => { showError(''); delete drafts['add-ret']; render(); })
      .catch(err => { button.disabled = false; showError('Return not added (' + (err.message || err) + '). Press Add Return again.'); });
  });

  // ---- reading
  // stop(): the tablet is leaving (turned off, new code, signed out). Every read ends, and a read refused in flight says
  // nothing, so the code screen's own message is the one left showing.
  let stopped = false, always = [], tick = null, schedUnsubs = [];
  function watchSched() {
    const want = boxing() && !stopped;
    if (want === !!schedUnsubs.length) return;
    schedUnsubs.forEach(u => u()); schedUnsubs = [];
    if (!want) return;
    const fail = (what) => (e) => { if (!stopped) showError('Could not read ' + what + ': ' + e.message); };
    schedUnsubs = ['SHIPPING', 'RECEIVING'].map(lane => onSnapshot(query(collection(db, 'plantJournal'), where('type', '==', U.LOAD_TYPE[lane])),
      s => { sched[lane] = s.docs.map(d => d.data()); got[lane] = true; render(); }, fail('the ' + (lane === 'SHIPPING' ? 'Shipping' : 'Receiving') + ' schedule')));
    schedUnsubs.push(onSnapshot(collection(db, 'routes'), s => { routeDocs = s.docs.map(d => Object.assign({ runId: d.id }, d.data())); render(); }, () => { routeDocs = []; }));
  }
  function watch() {
    if (stopped) return;
    unsubs.forEach(u => u());
    date = today();
    const weeks = [...new Set(L.weeksForLoadDate(date).concat(L.weeksForLoadDate(L.addDays(date, -1)), [L.weekStart(date)]))];
    const fail = (what) => (e) => { if (!stopped) showError('Could not read ' + what + ': ' + e.message); };
    unsubs = [
      onSnapshot(query(collection(db, 'runs'), where('weekStart', 'in', weeks)), s => { runs = s.docs.map(d => Object.assign({}, d.data(), { id: d.id })); got.runs = true; render(); }, fail('the loads')),
      onSnapshot(query(collection(db, 'pickups'), where('date', 'in', [-1, 0, 1, 2].map(n => L.addDays(date, n)))), s => { pickups = s.docs.map(d => d.data()); render(); }, fail('the pickups')),
      onSnapshot(query(collection(db, 'plantJournal'), where('date', 'in', weekDays())), s => { week = s.docs.map(d => d.data()); got.week = true; render(); }, fail('the unloading list')),
      // Refusals called in by email: a tablet with no UD account cannot read them; the rest still works.
      onSnapshot(query(collection(db, 'plantReturns'), where('date', '==', date)), s => { queue = s.docs.map(d => d.data()); render(); }, () => { queue = []; render(); })
    ];
  }
  always = [onSnapshot(doc(db, 'config', 'app'), s => { app = s.data() || {}; render(); }, () => {}),
  onSnapshot(collection(db, 'plantWash'), s => { sheetWash = s.docs.map(d => Object.assign({}, d.data(), { _list: 'plantWash', _id: d.id })); render(); }, () => {}),
  onSnapshot(query(collection(db, 'maintenance'), where('kind', '==', 'WASH')), s => { appWash = s.docs.map(d => Object.assign({}, d.data(), { _list: 'maintenance', _id: d.id })); render(); }, () => {}),
  watchProducts(db, lists => {
    const seen = {};
    Object.keys(lists).forEach(k => (lists[k] || []).forEach(x => { const n = String(x.name || '').trim(); if (n && !seen[n]) seen[n] = { name: n, sku: String(x.sku || '').trim() }; }));
    products = Object.values(seen).sort((a, b) => a.name.localeCompare(b.name));
    if (view === 'returns') render();
  }, () => {})];
  watch();
  // The day rolls at 6 AM; a running load's state is drawn again each minute (not while someone is typing).
  tick = setInterval(() => {
    if (today() !== date) { Object.keys(drafts).forEach(k => delete drafts[k]); watch(); }
    const a = document.activeElement;
    if (!(a && box.contains(a) && a.dataset && a.dataset.k)) render();
  }, 60000);

  return {
    set(st, v) { const changed = !station || !st || station.id !== st.id; station = st; view = v; if (changed) Object.keys(drafts).forEach(k => delete drafts[k]); watchSched(); render(); },
    render,
    // The loads left on a tab (for the count under it), or null for a tab with no count.
    count(v) {
      if (!station) return null;
      if (v === 'loading') { const r = loads(), s = shipments(); return { total: r.length + s.length, left: r.filter(x => x.state !== 'DONE').length + s.filter(x => x.work.state !== 'COMPLETE').length }; }
      if (v === 'receiving') { const d = deliveries(); return { total: d.length, left: d.filter(x => x.work.state !== 'COMPLETE').length }; }
      return null;
    },
    stop() { stopped = true; unsubs.concat(always, schedUnsubs).forEach(u => u()); unsubs = []; always = []; schedUnsubs = []; clearInterval(tick); }
  };
}
