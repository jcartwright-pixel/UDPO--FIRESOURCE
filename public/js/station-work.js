/*
 * The Plant Station's own work screens (Joe 10/12, of the desktop Daily Case Loadout opened from a station: "This should only
 * be a mobile view. and not be able to see all the information. This is for the employees."). As on the current app's locked
 * Plant Station (PlantStation.html), the station's work shows on the Plant Station page itself: today only, its own work area
 * only, one card per load that a finger can work. No dates, no other areas, no Edit box, no manager numbers, and no link to
 * any manager screen. The saves are the same ones the Loadout Center and Unloading & Washing make.
 */
import { save, escapeHtml, shortDate, showError, allowedSaves, maySave } from './app.js';
import { collection, doc, query, where, onSnapshot } from './firebase.js';
import { watchWashRequests } from './recent-records.js';
import * as P from './plant-core.js';
import { watchProducts, OTHER } from './products.js';
import { listenForScans, scanWithCamera, cameraReads, beep } from './scan-input.js';

const L = window.UDLogic, U = window.UDPlant, S = window.UDScan;
const today = () => L.operatingDay(new Date());
const qty = (v) => (v === null || v === undefined || v === '' ? '' : String(v));
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
// Joe 10/16: SKIP moves a load not yet started down one place in today's loading order (past the next load still to load) and
// saves it like the Loadout Center's drag, marked SKIPPED with this station's name. The last load to load has no SKIP.

export function mountStationWork({ db, box, person, onDraw }) {
  let station = null, view = '', date = today();
  let runs = [], pickups = [], week = [], queue = [], sheetWash = [], appWash = [], app = {}, products = [], gpsDays = [];
  // Boxing: the Plant Operations Scheduler's Shipping and Receiving loads (read only while a Boxing station is open).
  const sched = { SHIPPING: [], RECEIVING: [] };
  let routeDocs = [];   // Route Master (coverage_type, Drop and Hook); [] until it is read
  const got = { runs: false, week: false, SHIPPING: false, RECEIVING: false };
  const pending = {};       // card id -> what is shown before the server has it
  const drafts = {};        // card id -> { field: typed value } until it is saved
  const opened = {}, closed = {}, puForm = {}, pauseForm = {};
  // A refused start (the loading limit) shows on the card that was tapped too, where the finger is.
  const refused = {};
  const refuse = (id, m) => { showError(m); refused[id] = m; render(); setTimeout(() => { if (refused[id] === m) { delete refused[id]; render(); } }, 8000); };
  const refusal = (id) => (refused[id] ? '<p class="sw-refuse" role="alert">' + escapeHtml(refused[id]) + '</p>' : '');
  const returned = {}, washedNow = {};
  // A Skip's new order shows at once, until the server has it (load ids in their new order for the date).
  let orderShown = null, orderNo = 0, orderChain = Promise.resolve();
  let unsubs = [];
  // Receiving scan-in (Joe 10/13, mock-up A): each scan of a delivery is a line (receivingScans); what the plant receives is
  // receivingItems. recvLocal holds a line as the tablet shows it until the database has the same (a scan made with no signal
  // waits on the tablet like every other save).
  let recvScans = [], recvItems = [], lastRecv = '';
  const recvLocal = {}, recvNaming = {};
  const scanRid = () => 'rs-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2)).replace(/[^A-Za-z0-9_-]/g, '');

  // The role, or what Administration > People & Roles allows this person (asked of the server once per person).
  const VIEW_SAVE = { loading: 'savePlantLoad', unloading: 'saveUnloading', washing: 'completeWash', returns: 'addReturn', receiving: 'savePlantSchedule' };
  let allowed = {}, askedFor = null;
  const askRights = () => {
    const p = person(), key = p ? (p.email || p.name || '') + '|' + (p.roles || []).join(',') : null;
    if (!p || key === askedFor) return;
    askedFor = key;
    allowedSaves(Object.values(VIEW_SAVE).concat(['addPickup', 'completePickup', 'savePlantSchedule'])).then(a => { allowed = a; render(); });
  };
  const canSave = () => maySave(person(), L.SAVE_ROLES.concat(['PLANT_EMPLOYEE']), app, view === 'receiving' ? 'plant' : 'plantLoading', allowed[VIEW_SAVE[view] || 'savePlantLoad']);
  // A scheduled load saves through the Scheduler's save, which follows the Plant Operations switch (not Plant Loading).
  const canSched = () => maySave(person(), L.SAVE_ROLES.concat(['PLANT_EMPLOYEE']), app, 'plant', allowed.savePlantSchedule);
  const myName = () => (station && station.name) || '';
  // The week so far, and always yesterday (on a Sunday, last Saturday: its trailers can carry over to today, Joe 10/27 hd).
  const weekDays = () => { const y = L.addDays(date, -1), s = L.weekStart(date) < y ? L.weekStart(date) : y, out = []; for (let d = s; d <= date; d = L.addDays(d, 1)) out.push(d); return out; };
  const dayJournal = () => week.filter(d => d.date === date);
  const mmdd = (d) => { const p = String(d || '').split('-'); return p.length === 3 ? Number(p[1]) + '-' + Number(p[2]) : ''; };

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
    const y = L.addDays(date, -1), carried = P.carriedUnloads(runs, date, week.filter(d => d.date === y || d.date === date), routeDocs);
    return P.unloadRows(runs, date, dayJournal(), rets, P.loadoutRows(runs, date), routeDocs).concat(carried).filter(inArea).map(r => (pending[r.key] ? Object.assign({}, r, pending[r.key]) : r)).filter(r => !(r.dropped && (r.added || r.prior)));
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
    // Joe 10/14: a customer's loads that day are Load 1, 2, 3 by pickup time, and Load N is Route Master's LOAD N run; only the
    // load whose run is on the box list is worked there, so the other Charleston loads still show (before, all three were hidden).
    // Joe 10/14: only the Scheduler's box loads (Load Type Boxes, or a box run on Route Master).
    const customers = U.scheduleCustomers(slotRoutes());
    return numbered().filter(x => (x.loadDate || x.date) === date && U.scheduleArea(x, customers) === 'BOXING' && (x.overSlots || !box.some(r => sameRun(r, x.slot ? Object.assign({}, x, x.slot) : x)))).map(withShown);
  }
  function numbered() {
    const list = U.scheduleEntries(sched.SHIPPING, 'SHIPPING');
    return U.numberLoads(list, U.scheduleCustomers(slotRoutes()));
  }
  // Route Master's runs; until they are read, the runs on this week's loads.
  function slotRoutes() {
    if (routeDocs.length) return routeDocs;
    const seen = {};
    return runs.filter(r => r.runId && !seen[r.runId] && (seen[r.runId] = true)).map(r => ({ runId: r.runId, routeId: r.routeId || r.runId, route: r.route, run: r.run, routeName: '', displayPlant: true, loadType: r.loadType || (r.masterShow && r.masterShow.loadType) || '' }));
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

  // Prior-day loads still open first, then today's in the loading order (a Skip's new order shows until the server has it).
  function inOrder(all) {
    const at = (r) => (orderShown && orderShown.date === date ? orderShown.ids.indexOf(r.id) : -1);
    return all.map((r, i) => ({ r, i, k: r.prior ? 0 : 2, o: at(r) })).sort((a, b) => a.k - b.k || (a.o >= 0 && b.o >= 0 ? a.o - b.o : a.i - b.i)).map(x => x.r);
  }
  // The loads the order is changed among (as on the Loadout Center): today's, of one loadout, not yet loaded.
  const orderable = (rows, a) => rows.filter(x => !x.prior && x.loadDate === date && x.area === a && x.state !== 'DONE');
  // id -> true for a waiting load of today with a load still to load below it in its loadout (it can be skipped down one);
  // 'limit' when it was already skipped U.SKIP_LIMIT times in a row (Joe 10/27: SKIP shows greyed and says why when tapped).
  function skippable(rows) {
    const out = {};
    P.AREAS.forEach(a => {
      const list = orderable(rows, a), started = rows.filter(x => !x.prior && x.loadDate === date && x.area === a).map(x => x.startedAt);
      list.forEach((x, i) => { if (x.state === 'WAITING' && i < list.length - 1) out[x.id] = U.skipsInARow(x.moveMark, date, started) >= U.SKIP_LIMIT ? 'limit' : true; });
    });
    return out;
  }
  const skipping = {};      // load id -> true while its Skip is on its way to the server (a second tap then does nothing)
  // SKIP: down one place, past the next load still to load; the loads already loaded keep their places. Saved like a drag.
  function skipDown(r) {
    if (skipping[r.id]) return;
    const rows = inOrder(loads()), list = orderable(rows, r.area), i = list.findIndex(x => x.id === r.id);
    if (i < 0 || i >= list.length - 1) { render(); return; }
    const full = rows.filter(x => !x.prior && x.loadDate === date && x.area === r.area), from = full.indexOf(list[i]), to = full.indexOf(list[i + 1]);
    const next = full.slice();
    next.splice(to, 0, next.splice(from, 1)[0]);
    let k = 0;
    const ids = rows.map(x => (full.indexOf(x) >= 0 ? next[k++].id : x.id));
    const mine = ++orderNo;
    orderShown = { date, ids, no: mine };
    skipping[r.id] = true;
    render();
    orderChain = orderChain.then(() => save('reorderPlantLoads', { loadDate: date, order: next.map(x => ({ runDocId: x.runDocId, day: x.day })), moved: { runDocId: r.runDocId, day: r.day, how: 'SKIP' }, station: myName() }))
      .then(() => showError(''), e => refuse(r.id, e.message || String(e)))
      .then(() => { delete skipping[r.id]; if (orderShown && orderShown.no === mine) orderShown = null; render(); });
  }

  function loadingView() {
    const all = loads(), ck = canSave(), unit = P.AREA[area() || 'CASE'];
    const rows = inOrder(all), below = skippable(rows);
    const pk = P.withNotePickups(all, pickups), ships = shipments(), box = boxing();
    // A box load the Scheduler marks Carrier is a carrier's load (the Scheduler's line itself is worked on this card).
    const carried = box ? numbered().filter(x => (x.loadDate || x.date) === date && x.scheduleType === 'CARRIER' && !x.overSlots).map(x => (x.slot ? Object.assign({}, x, x.slot) : x)) : [];
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
      const items = P.pickupsFor(r, pk), open = items.filter(P.pickupOpen).length, st = r.state, skip = below[r.id] === true;
      const skipBtn = skip ? btn('SKIP', 'skip', r.id, 'warn') : below[r.id] === 'limit' ? btn('SKIP', 'skipno', r.id, 'warn off') : '';
      // Joe 10/20: once a skipped load is complete its SKIPPED flag comes off (a MOVED flag stays).
      const note = P.movedBySomeone(r) && !P.movedEarlier(r) ? P.moveNote(r) : null, moved = note && !(st === 'DONE' && note.word === 'SKIPPED') ? note : null;
      const going = st === 'LOADING' && !r.paused, isOpen = going ? !closed[r.id] : !!opened[r.id], done = st === 'DONE';
      const status = done ? badge('COMPLETE', 'done') : r.paused ? badge('PAUSED', 'paused') : st === 'LOADING' ? badge('LOADING', 'going') : badge('WAITING');
      const quick = ck && !isOpen ? (st === 'WAITING' ? '<span class="sw-quick">' + skipBtn + btn('START LOADING', 'start', r.id, 'primary') + '</span>'
        : r.paused ? '<span class="sw-quick">' + btn('RESUME', 'resume', r.id, 'primary') + '</span>' : '') : '';
      const by = box ? hauler(r, carried.some(x => sameRun(r, x))) : '';
      html += '<article class="sw-card ' + (done ? 'done' : r.paused ? 'paused' : st === 'LOADING' ? 'run' : '') + (isOpen ? ' open' : '') + (by ? ' by-' + by : '') + '" data-sw="' + escapeHtml(r.id) + '">' +
        '<div class="sw-head" data-toggle="' + escapeHtml(r.id) + '" role="button" tabindex="0" aria-expanded="' + isOpen + '">' +
        '<b class="route">' + escapeHtml(r.route) + '</b><b class="run">' + escapeHtml(r.run) + (by ? who(by) : '') + '</b><span class="truck">' + escapeHtml(r.truck || '—') + '</span><span class="trailer">' + escapeHtml(r.trailer || '—') + '</span>' +
        '<span class="sw-state">' + status + (open ? '<i class="sw-flag pu">' + plural(open, 'PICKUP') + '</i>' : '') + (moved ? '<i class="sw-flag skip" title="' + escapeHtml(moved.title) + '">' + moved.word + (moved.word === 'SKIPPED' && moved.initials ? ' · ' + escapeHtml(moved.initials) : '') + '</i>' : '') + '</span>' + quick + chev(isOpen) + '</div>' + refusal(r.id);
      if (isOpen) {
        const dis = !ck || done;
        html += '<div class="sw-body"><div class="sw-fields">' + field(r.id, 'quantity', unit.label, qty(r.quantity), { mode: 'numeric', disabled: dis }) + field(r.id, 'truck', 'Truck', r.truck, { disabled: dis }) +
          field(r.id, 'trailer', 'Trailer', r.trailer, { disabled: dis }) + field(r.id, 'temperature', 'Temperature', qty(r.temperature), { mode: 'decimal', disabled: dis }) + '</div>' +
          field(r.id, 'notes', 'Notes', r.notes, { wide: true, disabled: dis }) + pickupBox(r, items, ck) +
          pauseBox(r.id, ck && !done) +
          (ck ? '<div class="sw-actions">' + btn('+ ADD PICKUP', 'pickup', r.id, 'pick') + (st === 'WAITING' ? skipBtn + btn('START LOADING', 'start', r.id, 'primary')
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
    const name = recv ? x.run || x.route || 'Plant pickup' : U.loadNumberName((x.slot && x.slot.run) || x.run || x.route || 'Plant pickup', x.loadNo), status = done ? badge(recv ? 'RECEIVED' : 'COMPLETE', 'done') : paused ? badge('PAUSED', 'paused') : going ? badge(recv ? 'RECEIVING' : 'LOADING', 'going') : badge('WAITING');
    const startLabel = recv ? 'START RECEIVING' : 'START LOADING';
    const quick = ck && !isOpen && (st === 'WAITING' || paused) ? '<span class="sw-quick">' + btn(paused ? 'RESUME' : startLabel, 'sstart', id, 'primary') + '</span>' : '';
    const detail = [x.pickupTime ? clock(x.pickupTime) : '', x.poNumber ? 'PO ' + x.poNumber : '', x.trailer || 'Trailer not typed yet', x.product, x.cases ? x.cases + ' cases' : ''].filter(Boolean).join(' · ');
    let html = '<article class="sw-card sched ' + (done ? 'done' : paused ? 'paused' : going ? 'run' : '') + (isOpen ? ' open' : '') + (by ? ' by-' + by : '') + '" data-sw="' + escapeHtml(id) + '">';
    html += recv ? '<div class="sw-head tall" data-toggle="' + escapeHtml(id) + '" role="button" tabindex="0" aria-expanded="' + isOpen + '"><span class="sw-title"><b>' + escapeHtml(x.route + ' · ' + name) + '</b><small>' + escapeHtml(detail) + '</small></span>'
      : '<div class="sw-head" data-toggle="' + escapeHtml(id) + '" role="button" tabindex="0" aria-expanded="' + isOpen + '"><b class="route">' + escapeHtml(((x.slot && x.slot.route) || x.route || '').replace(/_[0-9]+$/, '')) + '</b><b class="run">' + escapeHtml(name) + who(by) + '</b><span class="truck">' + escapeHtml(clock(x.pickupTime) || '—') + '</span><span class="trailer">' + escapeHtml(x.trailer || '—') + '</span>';
    html += '<span class="sw-state">' + status + '</span>' + quick + chev(isOpen) + '</div>' + refusal(id);
    if (isOpen) {
      const dis = !ck || done;
      html += '<div class="sw-body">' + (recv ? recvBlock(x, id, going, done, ck) : '') + '<div class="sw-fields">' + field(id, 'count', recv ? 'Cases / pallets in' : 'Boxes', x.work.count, { mode: 'numeric', disabled: dis }) + field(id, 'trailer', 'Trailer', x.trailer, { disabled: dis }) +
        field(id, 'temperature', 'Temperature', x.work.temperature, { mode: 'decimal', disabled: dis }) + '<p class="sw-po"><span>PO</span><b>' + escapeHtml(x.poNumber || '—') + '</b></p></div>' +
        field(id, 'notes', 'Notes', x.work.notes || '', { wide: true, disabled: dis }) + pauseBox(id, ck && !done) +
        (ck ? '<div class="sw-actions">' + (st === 'WAITING' ? btn(startLabel, 'sstart', id, 'primary') : paused ? btn(recv ? 'SAVE RECEIVING' : 'SAVE LOADING', 'ssave', id, 'primary') + btn('RESUME', 'sstart', id, 'good')
          : going ? btn(recv ? 'SAVE RECEIVING' : 'SAVE LOADING', 'ssave', id, 'primary') + btn('PAUSE', 'pause', id, 'warn') + btn(recv ? 'RECEIVED' : 'COMPLETE', 'sdone', id, 'good') : badge(recv ? 'RECEIVED' : 'COMPLETE', 'done')) + '</div>' : '') + '</div>';
    }
    return html + '</article>';
  }
  const shipCard = (x) => schedCard(x, 'SHIPPING');

  // ---- Receiving scan-in
  function recvLines(deliveryId) {
    const byId = {}, at = {};
    recvScans.forEach(l => { byId[l.scanId] = l; at[l.scanId] = l.at; });
    Object.keys(recvLocal).forEach(k => { byId[k] = recvLocal[k]; });
    // Newest first by the server's time; a scan the server does not have yet goes on top (the tablet's clock is not the server's).
    return Object.values(byId).filter(l => l.deliveryId === deliveryId && l.status !== 'REMOVED').sort((x, y) => String(at[y.scanId] || '~').localeCompare(String(at[x.scanId] || '~')));
  }
  const recvItemName = (l) => { const it = l.itemId && recvItems.find(i => i.id === l.itemId); return it ? it.name : l.itemName || ''; };
  // The delivery a scan goes on: the open one being received (the one last scanned or tapped when two are open).
  function recvTarget() {
    const open = deliveries().filter(x => x.work.state === 'WORKING' && !closed['sch:' + x.id]);
    return open.find(x => x.id === lastRecv) || (open.length === 1 ? open[0] : null);
  }
  function recvBlock(x, id, going, done, ck) {
    const lines = recvLines(x.id), total = lines.reduce((n, l) => n + (Number(l.count) || 0), 0);
    const kinds = new Set(lines.map(l => l.itemId || l.barcode)).size, live = ck && !done;
    let html = '<div class="rv-block">';
    if (live && going) {
      html += '<div class="rv-scan"><label class="rv-box"><span class="rv-dot" aria-hidden="true"></span><input data-scan-box inputmode="none" autocomplete="off" spellcheck="false" ' +
        'placeholder="Ready: scan a case or pallet label" aria-label="Scan box"></label>' + (cameraReads() ? btn('Use camera', 'rvcam', id, 'rv-cam') : '') + '</div>';
    } else if (live) html += '<p class="rv-hint">Tap ' + (x.work.state === 'PAUSED' ? 'RESUME' : 'START RECEIVING') + ', then scan each case or pallet label.</p>';
    if (lines.length) {
      html += '<table class="rv-table"><thead><tr><th>Item</th><th>Lot</th><th>Best by</th><th class="rv-n">Cases</th></tr></thead><tbody>';
      lines.forEach(l => {
        const name = recvItemName(l), k = l.scanId, typing = recvNaming[k];
        let who;
        if (name) who = '<b>' + escapeHtml(name) + '</b>';
        else {
          who = '<b class="rv-unknown">New barcode ' + escapeHtml(S.shownCode(l)) + '</b><small>Not on the item list yet. Which item is it?</small>';
          if (live) {
            who += typing ? '<input class="rv-name" data-k="rvnew" data-id="' + escapeHtml(k) + '" value="' + escapeHtml(val(k, 'rvnew', '')) + '" placeholder="Type the item\'s name" autocomplete="off">'
              : '<select class="rv-pick" data-rvitem="' + escapeHtml(k) + '" aria-label="Which item is it?"><option value=""></option>' +
                recvItems.slice().sort((a, b) => a.name.localeCompare(b.name)).map(i => '<option value="' + escapeHtml(i.id) + '">' + escapeHtml(i.name) + '</option>').join('') +
                '<option value="__new">New item (type its name)</option></select>';
          }
        }
        const when = l.at ? '<small>' + (l.sscc ? 'Pallet · ' : '') + escapeHtml(new Date(l.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })) + '</small>' : '';
        const n = Number(l.count) || 0;
        const cases = live ? '<span class="rv-qty"><button type="button" class="rv-step" data-act="rvminus" data-id="' + escapeHtml(k) + '" aria-label="One less">&minus;</button><b>' + n +
          '</b><button type="button" class="rv-step" data-act="rvplus" data-id="' + escapeHtml(k) + '" aria-label="One more">+</button></span>' : '<b>' + n + '</b>';
        html += '<tr' + (name ? '' : ' class="rv-new"') + '><td>' + who + (name ? when : '') + '</td><td>' + escapeHtml(l.lot || '—') + '</td><td>' + escapeHtml(S.shortDate(l.bestBy) || '—') +
          '</td><td class="rv-n">' + cases + '</td></tr>';
      });
      html += '</tbody></table><p class="rv-sum">' + plural(total, 'case') + ' · ' + plural(kinds, 'item') + (live ? ' · each scan saves itself' : '') + '</p>';
    }
    return html + '</div>';
  }
  // A line's change goes on the tablet at once and to the server in order (a quick − + − keeps its order).
  const recvChain = {};
  function recvSave(k, fields, undo) {
    const turn = (recvChain[k] || Promise.resolve()).then(() => save('saveReceivingScan', Object.assign({ scanId: k }, fields)));
    recvChain[k] = turn.catch(() => {});
    return turn.then(() => showError('')).catch(e => { undo(); render(); beep(false); showError('Scan not saved: ' + (e.message || e)); });
  }
  function onRecvScan(raw) {
    if (view !== 'receiving') { beep(false); showError('Open the Receiving tab to scan a delivery in.'); return; }
    if (!canSched()) { beep(false); showError('This tablet cannot save Receiving.'); return; }
    const x = recvTarget();
    if (!x) { beep(false); showError(deliveries().some(d => d.work.state === 'WORKING') ? 'Open the delivery you are receiving, then scan again.' : 'Tap START RECEIVING on the delivery, then scan again.'); return; }
    lastRecv = x.id;
    const p = S.parseScan(raw), key = S.barcodeKey(p), now = new Date().toISOString();
    const same = !p.count && !p.sscc && recvLines(x.id).find(l => l.barcode === key && (l.lot || '') === (p.lot || '') && !l.labelCount && !l.sscc);
    if (same) {
      const was = recvLocal[same.scanId];
      recvLocal[same.scanId] = Object.assign({}, same, { count: (Number(same.count) || 0) + 1 });
      recvSave(same.scanId, { op: 'add', delta: 1 }, () => { if (was) recvLocal[same.scanId] = was; else delete recvLocal[same.scanId]; });
    } else {
      const k = scanRid(), item = recvItems.find(i => (i.barcodes || []).indexOf(key) >= 0);
      recvLocal[k] = { scanId: k, deliveryId: x.id, status: 'ACTIVE', kind: p.kind, raw: p.raw, barcode: key, gtin: p.gtin || p.contentGtin || '', lot: p.lot || '',
        bestBy: p.bestBy || p.useBy || p.sellBy || '', sscc: p.sscc || '', labelCount: p.count || null, count: S.scanQuantity(p), itemId: item ? item.id : '', itemName: item ? item.name : '', at: now };
      recvSave(k, { op: 'scan', deliveryId: x.id, raw, station: myName() }, () => { delete recvLocal[k]; });
    }
    beep(true);
    render();
  }
  function recvStep(k, delta) {
    const l = recvLines(lastRecvOf(k)).find(y => y.scanId === k);
    if (!l) return;
    const was = recvLocal[k], count = Math.max(0, (Number(l.count) || 0) + delta);
    recvLocal[k] = Object.assign({}, l, { count, status: count === 0 ? 'REMOVED' : 'ACTIVE' });
    render();
    recvSave(k, { op: 'add', delta }, () => { if (was) recvLocal[k] = was; else delete recvLocal[k]; });
  }
  const lastRecvOf = (k) => { const l = recvLocal[k] || recvScans.find(y => y.scanId === k); return l ? l.deliveryId : ''; };
  function recvName(k, fields) {
    const l = recvLines(lastRecvOf(k)).find(y => y.scanId === k);
    if (!l) return;
    const was = recvLocal[k], item = fields.itemId ? recvItems.find(i => i.id === fields.itemId) : null;
    const name = item ? item.name : fields.newItem;
    // Every line of this barcode on the delivery shows the name at once (the server names them all).
    recvLines(l.deliveryId).filter(y => y.barcode === l.barcode && !y.itemId).forEach(y => { recvLocal[y.scanId] = Object.assign({}, y, { itemId: item ? item.id : 'new', itemName: name }); });
    delete recvNaming[k];
    if (drafts[k]) delete drafts[k].rvnew;
    render();
    recvSave(k, Object.assign({ op: 'name' }, fields), () => { if (was) recvLocal[k] = was; else delete recvLocal[k]; });
  }

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

  // Joe 10/15 (Case Unloading, mock-up A): the trailers in the order the next loads leave, numbered; each card leads with the
  // trailer in big type, then the run (no route, no times). Back (Fleet's yard return or the driver's check-in) or On the road
  // (no Start button on the card; it still opens). A drop-and-hook load with no trailer typed is a Transfer trailer card.
  function unloadingView() {
    const rows = P.unloadOrder(unloads(), gpsDays), ck = canSave(), unit = P.UNLOAD_UNIT[area() || 'CASE'], wash = washes();
    const left = rows.filter(r => r.status !== 'COMPLETE').length;
    const transfers = rows.filter(r => r.transfer && r.status !== 'COMPLETE');
    const places = [...new Set(transfers.map(r => r.name).filter(Boolean))];
    const prior = rows.filter(r => r.prior && r.status !== 'COMPLETE').length;
    // Joe 10/27 (hd, mock-up 2): a trailer that is on no load goes on the list to unload or only to wash, at the top.
    let html = ck ? '<form class="sw-add unl" data-form="unl"><h3>A trailer that is not on the list</h3>' + field('add-unl', 'trailer', 'Trailer', '') +
      '<button type="submit" class="sw-btn primary" data-kind="UNLOAD">UNLOAD IT</button><button type="submit" class="sw-btn wash" data-kind="WASH">WASH ONLY</button></form>' : '';
    rows.forEach(r => {
      const s = r.status, isOpen = s === 'UNLOADING' ? !closed[r.key] : !!opened[r.key], ws = P.washesForRow(r, wash), done = s === 'COMPLETE';
      const from = r.prior ? '<i class="from">From ' + escapeHtml(mmdd(r.date)) + ' · not unloaded</i>' : r.added ? '<i class="add">' + (r.washOnly ? 'Added · wash only' : 'Added') + '</i>' : '';
      const where = done || s === 'UNLOADING' ? '' : r.transfer ? '<i class="tt">Transfer trailer</i>' : r.back ? '<i class="back">&#10003; Back ' + escapeHtml(P.clock(r.back)) + '</i>' : r.road ? '<i class="road">On the road</i>' : '';
      const chips = [from, where, r.casesIn !== '' ? '<i class="ok">' + unit + ' returned · ' + escapeHtml(r.casesIn) + '</i>' : '', r.pendingReturns.length ? '<i class="ret">Product return</i>' : r.returns.length ? '<i class="ok">Returned to the cooler</i>' : '',
        ws.length ? '<i class="wash">Wash required</i>' : r.washed ? '<i class="ok">Washed</i>' : ''].join('');
      const status = done ? badge('COMPLETE', 'done') : s === 'UNLOADING' ? badge('UNLOADING', 'going') : r.transfer ? badge('NEEDS A TRAILER') : badge('WAITING');
      const quick = !ck || s !== 'WAITING' || isOpen ? '' : r.washOnly ? (ws.length ? '<span class="sw-quick">' + btn('CONFIRM WASHED', 'uwash', r.key, 'good') + '</span>' : '') :
        !r.road && !r.transfer ? '<span class="sw-quick">' + btn('START UNLOADING', 'ustart', r.key, 'primary') + '</span>' : '';
      // Joe 10/27: a drop-and-hook load leads with its name (Ferry Product 1, Lancaster Transfer), never a trailer number.
      const title = (r.order ? '<span class="sw-order">' + r.order + '</span>' : '') + (r.dropAndHook ? '<span class="sw-trailer">' + escapeHtml(r.name) + '</span>' :
        (r.trailer ? '<span class="sw-trailer">' + escapeHtml(r.trailer) + '</span>' : '') + escapeHtml(r.added ? r.forRoute : r.run));
      html += '<article class="sw-card ' + (done ? 'done' : s === 'UNLOADING' ? 'run' : '') + (r.prior && !done ? ' prior' : '') + (r.pendingReturns.length ? ' ret' : '') + (r.road ? ' road' : '') + (isOpen ? ' open' : '') + '" data-sw="' + escapeHtml(r.key) + '">' +
        '<div class="sw-head tall" data-toggle="' + escapeHtml(r.key) + '" role="button" tabindex="0" aria-expanded="' + isOpen + '"><span class="sw-title unload"><b>' + title + '</b>' +
        (!r.trailer && !r.dropAndHook ? '<small>Trailer not typed yet</small>' : '') + '<span class="sw-chips">' + chips + '</span></span>' +
        '<span class="sw-state">' + status + '</span>' + quick + chev(isOpen) + '</div>';
      if (isOpen && r.washOnly) {
        html += '<div class="sw-body"><div class="sw-step' + (ws.length ? ' wash' : '') + '"><b>1</b><span><strong>Washing</strong><small>' + escapeHtml((r.trailer || 'Trailer') + ' · only to be washed') + '</small></span>' +
          (ws.length ? (ck ? btn('CONFIRM WASHED', 'uwash', r.key, 'good') : badge('WASH NEEDED', 'wash')) : badge('DONE', 'done')) + '</div>' +
          (ck && !done ? '<div class="sw-actions">' + btn('TAKE OFF THE LIST', 'udrop', r.key) + '</div>' : '') + '</div>';
      } else if (isOpen) {
        const dis = !ck || done;
        // Joe 10/27 (hg): Cases out (from the loadout), Cases returned (typed here) and Lost, as on the office screen.
        const typedIn = String(val(r.key, 'casesIn', r.casesIn)).trim().replace(/,/g, ''), lost = P.lostCases(Object.assign({}, r, { casesIn: /^\d+$/.test(typedIn) ? typedIn : '' }));
        html += '<div class="sw-body"><div class="sw-fields">' + field(r.key + ':out', 'casesOut', unit + ' out', r.casesOut === '' ? '' : Number(r.casesOut).toLocaleString(), { disabled: true }) +
          field(r.key, 'casesIn', unit + ' returned', r.casesIn, { mode: 'numeric', disabled: dis || s !== 'UNLOADING' }) +
          '<label class="sw-field"><span>Lost</span><input value="' + (lost === null ? '' : lost < 0 ? (-lost).toLocaleString() + ' extra' : lost.toLocaleString()) + '" disabled' + (lost > 0 ? ' style="color:#b42332;font-weight:900"' : '') + '></label>' + field(r.key, 'trailer', 'Trailer', r.trailer, { disabled: dis }) + '</div>' +
          field(r.key, 'notes', 'Notes', r.notes, { wide: true, disabled: dis || s !== 'UNLOADING' }) +
          '<div class="sw-step' + (r.pendingReturns.length ? ' need' : '') + '"><b>2</b><span><strong>Returned product</strong><small>' + escapeHtml(r.pendingReturns.length ? r.pendingReturns.map(x => x.detail).join('; ') : r.returns.length ? 'Back in the cooler' : 'No return assigned') + '</small></span>' +
          (r.pendingReturns.length ? (ck ? btn('BACK IN THE COOLER (RTA)', 'urta', r.key, 'danger') : badge('PENDING', 'ret')) : badge(r.returns.length ? 'DONE' : 'NOT REQUIRED', r.returns.length ? 'done' : '')) + '</div>' +
          '<div class="sw-step' + (ws.length ? ' wash' : '') + '"><b>3</b><span><strong>Washing</strong><small>' + escapeHtml(ws.length ? (r.trailer || 'Trailer') + ' · ' + ws.map(w => w.need).join('; ') : r.washed ? 'Washed' : 'No wash listed') + '</small></span>' +
          (ws.length ? (ck ? btn('CONFIRM WASHED', 'uwash', r.key, 'good') : badge('WASH NEEDED', 'wash')) : badge(r.washed ? 'DONE' : 'NOT REQUIRED', r.washed ? 'done' : '')) + '</div>' +
          (ck ? '<div class="sw-actions">' + ((r.added || r.prior) && s === 'WAITING' ? btn('TAKE OFF THE LIST', 'udrop', r.key) : '') + (s === 'WAITING' ? btn('START UNLOADING', 'ustart', r.key, 'primary') : s === 'UNLOADING' ? btn('COMPLETE', 'uend', r.key, 'good') : badge('COMPLETE', 'done')) + '</div>' : '') + '</div>';
      }
      html += '</article>';
    });
    if (!rows.length) html = '<p class="sw-empty">' + (got.runs ? 'No trucks are back for unloading today.' : 'Reading today\'s loads&hellip;') + '</p>';
    const need = (prior ? '<i class="sw-need from">' + plural(prior, 'trailer') + ' from yesterday</i> ' : '') + (transfers.length ? '<i class="sw-need">' + plural(transfers.length, 'transfer trailer') + ' needed' + (places.length ? ' (' + escapeHtml(places.join(', ')) + ')' : '') + '</i> ' : '');
    return panel('Unloading', need + left + ' to unload of ' + plural(rows.length, 'item'), '<div class="sw-list">' + html + '</div>');
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
      const loadsBack = P.unloadRows(runs, date, dayJournal(), [], [], routeDocs).filter(inArea).sort((a, b) => String(a.route).localeCompare(String(b.route), undefined, { numeric: true }));
      const pick = val('add-ret', 'load', '');
      html += '<form class="sw-add ret" data-form="ret"><h3>Add a return nobody noted</h3><label class="sw-field"><span>Route</span><select data-k="load" data-id="add-ret"><option value="">Pick the route</option>' +
        loadsBack.map(r => '<option value="' + escapeHtml(r.key) + '"' + (pick === r.key ? ' selected' : '') + '>' + escapeHtml(r.route + ' · ' + (r.dropAndHook ? r.name : r.run + (r.trailer ? ' · ' + r.trailer : ''))) + '</option>').join('') +
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
  // A saved load stays shown until the runs list has it (a time stamp may differ, so those are not compared), or 10 seconds
  // at most: clearing it sooner showed a load just paused as loading again for a moment, which refused the next Start
  // ("2 loads are already loading"), and a finished load's count blank.
  const same = (a, b) => String(a === undefined || a === null ? '' : a) === String(b === undefined || b === null ? '' : b);
  const loadChain = {};
  function settle(id, shown, done) {
    const until = Date.now() + 10000;
    (function look() {
      const raw = P.loadoutRows(runs, date).find(x => x.id === id);
      if (Date.now() > until || (raw && Object.keys(shown).every(k => /At$/.test(k) || same(raw[k], shown[k])))) return done();
      setTimeout(look, 250);
    })();
  }
  // A save that comes back clears only what it sent: a count typed while an earlier Start was still on its way stays in
  // its box, so the Complete tapped next sends it (it used to be wiped, and the load finished with a blank count).
  function clearSent(id, fields) {
    const d = drafts[id];
    if (!d) return;
    Object.keys(fields).forEach(k => { if (d[k] !== undefined && String(d[k]).trim() === String(fields[k]).trim()) delete d[k]; });
    if (!Object.keys(d).length) delete drafts[id];
  }
  async function saveLoad(r, fields, shown) {
    const done = show(r.id, shown);
    let res, ok = false;
    // One load's saves go one after another: a Complete tapped while its Start was still on its way landed first, and the
    // Start then cleared the finish (the load showed loading again).
    const turn = (loadChain[r.id] || Promise.resolve()).then(() => save('savePlantLoad', { runDocId: r.runDocId, day: r.day, fields, station: myName() }));
    loadChain[r.id] = turn.catch(() => {});
    try { res = await turn; ok = true; showError(''); clearSent(r.id, fields); } catch (e) { const m = String(e.message || e); if (/already loading/.test(m)) refuse(r.id, m); else showError(r.route + ' ' + r.run + ': ' + m); }
    if (queued(res)) hold(r.id, done); else if (ok) settle(r.id, shown, done); else done();
  }
  const chain = {};
  async function saveUnload(r, fields, shown) {
    const done = show(r.key, shown);
    if (fields.returnIds) fields.returnIds.forEach(id => { returned[id] = true; });
    const turn = (chain[r.key] || Promise.resolve()).then(() => save('saveUnloading', { date: r.date || date, route: r.route, run: r.run, runDocId: r.runDocId, day: r.day, fields }));
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
    // A save keeps the load as it was (Joe 10/22: typing a trailer never starts it); Start, Pause and Complete change it.
    const work = Object.assign({}, fields, { state: step === 'complete' ? 'COMPLETE' : step === 'pause' ? 'PAUSED' : step === 'save' ? (x.work.state === 'PAUSED' || x.work.state === 'WORKING' ? x.work.state : 'WAITING') : 'WORKING' });
    delete work.trailer;
    const shown = { work };
    if (fields.trailer !== undefined) shown.trailer = fields.trailer;
    if (step === 'start') delete closed[id];
    if (step === 'pause') { delete pauseForm[id]; closed[id] = true; delete opened[id]; }
    if (step === 'complete') delete opened[id];
    const done = show(id, shown);
    // Only what this save sent is cleared: a box typed while it was on its way stays typed.
    const sent = Object.assign({}, d);
    let res, ok = false;
    try {
      const turn = (loadChain[id] || Promise.resolve()).then(() => save('savePlantSchedule', Object.assign({ lane, op: 'progress', id: x.id, date: x.date, step, fields }, step === 'pause' ? { pauseReason: reason } : {})));
      loadChain[id] = turn.catch(() => {});
      res = await turn; showError('');
      if (step === 'pause') delete pauseForm[id];
      if (drafts[id]) Object.keys(fields).forEach(k => { if (drafts[id][k] === sent[k]) delete drafts[id][k]; });
      ok = true;
    } catch (e) { const m = String(e.message || e); if (/already loading/.test(m)) refuse(id, m); else showError(x.route + ' ' + (x.run || '') + ': ' + m); }
    if (queued(res)) hold(id, done); else if (ok) setTimeout(done, 1500); else done();
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
    if (a === 'rvplus' || a === 'rvminus') { recvStep(id, a === 'rvplus' ? 1 : -1); return; }
    if (a === 'rvcam') {
      lastRecv = id.replace(/^sch:/, '');
      scanWithCamera().then(raw => { if (raw) onRecvScan(raw); }).catch(e => { beep(false); showError(e.message || String(e)); });
      return;
    }
    if (a === 'pause') { pauseForm[id] = true; opened[id] = true; delete closed[id]; render(); const f = box.querySelector('[data-id="' + CSS.escape(id) + '"][data-k="pauseReason"]'); if (f) f.focus(); return; }
    if (a === 'pausecancel') { delete pauseForm[id]; if (drafts[id]) delete drafts[id].pauseReason; render(); return; }
    const reason = String((drafts[id] || {}).pauseReason || '').trim();
    if (a === 'pausego' && !reason) { showError('Type the reason for pausing.'); return; }
    if (['sstart', 'ssave', 'sdone'].indexOf(a) >= 0 || (a === 'pausego' && id.indexOf('sch:') === 0)) {
      const lane = view === 'receiving' ? 'RECEIVING' : 'SHIPPING', x = (lane === 'RECEIVING' ? deliveries() : shipments()).find(y => 'sch:' + y.id === id);
      if (!x) return;
      if (a === 'sdone' && x.work.state !== 'WORKING') { showError(x.work.state === 'PAUSED' ? 'Tap RESUME first.' : 'Tap ' + (lane === 'RECEIVING' ? 'START RECEIVING' : 'START LOADING') + ' first.'); return; }
      if (a === 'sstart' && lane === 'SHIPPING') { const m = limitMessage(id); if (m) { refuse(id, m); return; } }
      if (lane === 'RECEIVING' && a === 'sstart') lastRecv = x.id;
      delete refused[id];
      if (a === 'pausego' && drafts[id]) delete drafts[id].pauseReason;
      saveSched(x, lane, a === 'sstart' ? 'start' : a === 'ssave' ? 'save' : a === 'pausego' ? 'pause' : 'complete', reason);
      return;
    }
    if (['skip', 'skipno', 'start', 'resume', 'pausego', 'saveload', 'complete', 'pickup', 'puadd', 'pucancel', 'pudone'].indexOf(a) >= 0) {
      const r = loads().find(x => x.id === id);
      if (!r) return;
      if (a === 'skip') { delete opened[r.id]; skipDown(r); return; }
      if (a === 'skipno') { refuse(r.id, U.skipWhy('Route ' + L.routeNumber(r.route))); return; }
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
    if (['ustart', 'uend', 'urta', 'uwash', 'udrop'].indexOf(a) >= 0) {
      const all = unloads(), r = all.find(x => x.key === id);
      if (!r) return;
      if (a === 'ustart') {
        const busy = all.find(x => x.key !== r.key && x.status === 'UNLOADING');
        if (busy) { showError('Finish unloading ' + busy.route + ' · ' + busy.run + ' before starting another.'); return; }
        delete closed[r.key];
        saveUnload(r, { start: true }, { status: 'UNLOADING', startedAt: now });
      } else if (a === 'uend') {
        const typed = String(val(r.key, 'casesIn', r.casesIn)).trim().replace(/,/g, '');
        if (!/^\d+$/.test(typed)) { showError('Enter the ' + P.UNLOAD_UNIT[area() || 'CASE'].toLowerCase() + ' returned before completing (0 if none).'); const f = box.querySelector('[data-id="' + CSS.escape(r.key) + '"][data-k="casesIn"]'); if (f) f.focus(); return; }
        if (r.pendingReturns.length) { showError('Put the returned product back in the cooler (RTA) before completing.'); return; }
        const first = typed !== r.casesIn ? saveUnload(r, { casesIn: String(Number(typed)) }, { casesIn: String(Number(typed)) }) : Promise.resolve(true);
        first.then(ok => { if (!ok) return; delete drafts[r.key]; const x = unloads().find(y => y.key === r.key); if (x) saveUnload(x, { end: true }, { status: 'COMPLETE', completedAt: new Date().toISOString() }); });
      } else if (a === 'urta') saveUnload(r, { returnIds: r.pendingReturns.map(x => x.id) }, {});
      else if (a === 'uwash') { const ws = P.washesForRow(r, washes()); if (ws.length) washTrailer(ws[0].trailer); }
      else if (a === 'udrop') { delete opened[r.key]; saveUnload(r, { dropped: true }, { dropped: true }); }
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
  // Receiving: "Which item is it?" saves when picked; a new item's name saves when the box is left (or Enter).
  box.addEventListener('change', e => {
    const sel = e.target.closest('[data-rvitem]');
    if (sel) {
      if (sel.value === '__new') { recvNaming[sel.dataset.rvitem] = true; render(); const f = box.querySelector('[data-k="rvnew"][data-id="' + CSS.escape(sel.dataset.rvitem) + '"]'); if (f) f.focus(); }
      else if (sel.value) recvName(sel.dataset.rvitem, { itemId: sel.value });
      return;
    }
    const nm = e.target.closest('[data-k="rvnew"]');
    if (nm) { const v = String(nm.value || '').trim(); if (v) recvName(nm.dataset.id, { newItem: v }); }
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
    if (e.key === 'Enter' && e.target.matches && e.target.matches('input[data-k]') && (view === 'unloading' || e.target.dataset.k === 'rvnew')) { e.preventDefault(); e.target.blur(); }
  });
  function toggle(id) {
    const card = box.querySelector('[data-sw="' + CSS.escape(id) + '"]'), isOpen = card && card.classList.contains('open');
    if (isOpen) { closed[id] = true; delete opened[id]; } else { opened[id] = true; delete closed[id]; }
    if (!isOpen && id.indexOf('sch:') === 0) lastRecv = id.slice(4);
    render();
  }
  box.addEventListener('submit', e => {
    e.preventDefault();
    const form = e.target.closest('[data-form]');
    if (!form || !canSave()) return;
    if (form.dataset.form === 'unl') {
      const v = U.trailerText(val('add-unl', 'trailer', '')), kind = (e.submitter && e.submitter.dataset.kind) || 'UNLOAD';
      if (!v) { showError('Type the trailer number, then press Unload It or Wash Only.'); return; }
      delete drafts['add-unl'];
      const r = { key: U.unloadKey(date, P.ADDED_ROUTE, P.addedRun(v)), route: P.ADDED_ROUTE, run: P.addedRun(v), runDocId: '', day: '', date };
      saveUnload(r, { added: kind, trailer: v, area: area() || 'CASE' }, {});
      return;
    }
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
    // Review item 73 (Joe 10/13): the schedule's entries of the last 14 days and later (the tablet shows today's), not every one ever made.
    schedUnsubs = ['SHIPPING', 'RECEIVING'].map(lane => onSnapshot(query(collection(db, 'plantJournal'), where('type', '==', U.LOAD_TYPE[lane]), where('date', '>=', L.addDays(today(), -14))),
      s => { sched[lane] = s.docs.map(d => d.data()); got[lane] = true; render(); }, fail('the ' + (lane === 'SHIPPING' ? 'Shipping' : 'Receiving') + ' schedule')));
    schedUnsubs.push(onSnapshot(query(collection(db, 'receivingScans'), where('date', '>=', L.addDays(today(), -14))), s => {
      recvScans = s.docs.map(d => d.data());
      // The tablet's own copy of a line goes once the database shows the same.
      Object.keys(recvLocal).forEach(k => { const d = recvScans.find(y => y.scanId === k), l = recvLocal[k];
        if (d && d.count === l.count && d.status === l.status && (d.itemId === l.itemId || (l.itemId === 'new' && d.itemId))) delete recvLocal[k]; });
      render();
    }, fail('the scans')));
    schedUnsubs.push(onSnapshot(query(collection(db, 'receivingItems'), where('status', '==', 'ACTIVE')), s => { recvItems = s.docs.map(d => Object.assign({ id: d.id }, d.data())); render(); }, fail('the item list')));
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
      onSnapshot(query(collection(db, 'plantReturns'), where('date', '==', date)), s => { queue = s.docs.map(d => d.data()); render(); }, () => { queue = []; render(); }),
      // Fleet's yard leave and return per unit (Case Unloading's Back / On the road). A tablet that cannot read them shows neither.
      onSnapshot(query(collection(db, 'gpsDays'), where('date', 'in', [-1, 0, 1].map(n => L.addDays(date, n)))), s => { gpsDays = s.docs.map(d => d.data()); render(); }, () => { gpsDays = []; render(); }),
      // Route Master's Drop and Hook tick (Case Unloading shows those loads by name; the week's loads do not carry it).
      onSnapshot(collection(db, 'routes'), s => { routeDocs = s.docs.map(d => Object.assign({ runId: d.id }, d.data())); render(); }, () => { routeDocs = []; render(); })
    ];
  }
  always = [onSnapshot(doc(db, 'config', 'app'), s => { app = s.data() || {}; render(); }, () => {}),
  watchWashRequests(db, L.weekStart(today()), r => { sheetWash = r; render(); }, () => {}, 'plantWash'),
  // Joe 10/18 (screen speed): the open wash requests and the week's finished ones, not every one ever made.
  watchWashRequests(db, L.weekStart(today()), r => { appWash = r; render(); }, () => {}),
  watchProducts(db, lists => {
    const seen = {};
    Object.keys(lists).forEach(k => (lists[k] || []).forEach(x => { const n = String(x.name || '').trim(); if (n && !seen[n]) seen[n] = { name: n, sku: String(x.sku || '').trim() }; }));
    products = Object.values(seen).sort((a, b) => a.name.localeCompare(b.name));
    if (view === 'returns') render();
  }, () => {})];
  watch();
  const stopScans = listenForScans({ onScan: raw => { if (!stopped && boxing()) onRecvScan(raw); } });
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
    stop() { stopScans(); stopped = true; unsubs.concat(always, schedUnsubs).forEach(u => u()); unsubs = []; always = []; schedUnsubs = []; clearInterval(tick); }
  };
}
