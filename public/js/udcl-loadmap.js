// Truck Load Map (United Dairy Customer List, Joe 11/1): how the truck is loaded for one route day, the truck on one side and the
// customers in run order on the other. Each spot holds a load sequence number (1 goes on first, at the front; the same number
// has the same colour as the customer's line). An Administrator or Manager picks a number and taps spots to paint it, adds or
// takes off a row, marks the side door, or rebuilds the map from the load sequences; every change saves by itself.
// ?kiosk=1 is the plant's Load Map Kiosk: today's routes as big buttons, nothing to change, and it reads the list again every
// two minutes so a change made in the office shows on the floor.
import { requireSignIn, escapeHtml as e, showError, serverText, shortDate } from './app.js';
import { readList, saveStep, printMenu, printDoc, loadMapPage, truckHtml, sortedRouteDays, routesOf, todayKey, seqColour, U } from './udcl.js';

const params = new URLSearchParams(location.search);
const KIOSK = params.get('kiosk') === '1';
let data = null, route = params.get('route') || '', day = U.dayOf(params.get('day')) || (KIOSK ? todayKey() : '');
let brush = 0, painting = false, pending = null, timer = 0;
const $ = (id) => document.getElementById(id);
const rdOf = (r, d) => (data ? data.routeDays : []).find(x => x.route === r && x.day === d) || null;
const current = () => rdOf(route, day);
const canEdit = () => !KIOSK && data && data.canEdit;

function pickDefaults() {
  if (KIOSK) {
    const today = data.routeDays.filter(x => x.day === day).map(x => x.route).sort(U.byRoute);
    if (!today.includes(route)) route = today[0] || '';
  } else {
    const routes = routesOf(data.routeDays);
    if (!routes.includes(route)) route = routes[0] || '';
    const days = data.routeDays.filter(x => x.route === route).map(x => x.day);
    if (!days.includes(day)) day = days.includes(todayKey()) ? todayKey() : days.sort((a, b) => U.dayIndex(a) - U.dayIndex(b))[0] || '';
  }
  history.replaceState(null, '', '?' + (KIOSK ? 'kiosk=1&' : '') + 'route=' + encodeURIComponent(route) + '&day=' + day);
}

function draw() {
  if (!data) return;
  pickDefaults();
  const rd = current(), map = rd ? (pending || U.cleanMap(rd.map || U.autoMap(rd.stops || []))) : null;
  $('title').textContent = KIOSK ? 'Load Map' + (rd ? ' · Route ' + route : '') : 'Truck Load Map';
  $('route-field').hidden = KIOSK;
  $('route').innerHTML = routesOf(data.routeDays).map(r => '<option value="' + e(r) + '"' + (r === route ? ' selected' : '') + '>Route ' + e(r) + '</option>').join('');
  $('days').innerHTML = U.DAYS.map(d => '<button type="button" data-day="' + d + '" aria-pressed="' + (d === day) + '"' + (KIOSK || rdOf(route, d) ? '' : ' disabled') + '>' + U.DAY_NAMES[d].slice(0, 3) + '</button>').join('');
  if (KIOSK) {
    const list = data.routeDays.filter(x => x.day === day).map(x => x.route).sort(U.byRoute);
    $('kiosk-routes').hidden = false;
    $('kiosk-routes').innerHTML = list.map(r => '<button type="button" data-route="' + e(r) + '" aria-pressed="' + (r === route) + '">' + e(r) + '</button>').join('') || '<span>No routes on ' + U.DAY_NAMES[day] + '.</span>';
  }
  $('truck').innerHTML = rd ? truckHtml(map, { edit: canEdit() }) : '<p>' + (data.routeDays.length ? 'Pick a route and day.' : 'The customer list is empty. An administrator imports it on the Customers screen.') + '</p>';
  const stops = rd ? rd.stops || [] : [];
  $('rows').innerHTML = stops.map((s, i) => { const c = data.customers[s.key] || {}; return '<tr><td><span class="stopno">' + (i + 1) + '</span></td><td><span class="sw" style="background:' + seqColour(s.loadSeq) + '">' + (s.loadSeq || '-') + '</span></td><td class="l"><b>' + e(c.name || s.name) + '</b></td><td class="l">' + e([s.note, c.notes].filter(Boolean).join(' · ')) + '</td></tr>'; }).join('') ||
    '<tr><td colspan="4" class="empty">No stops.</td></tr>';
  $('notes').innerHTML = rd && rd.notes ? '<div class="box" style="margin:8px;white-space:pre-wrap"><b>Instructions</b><br>' + e(rd.notes) + '</div>' : '';
  $('editor').hidden = !canEdit() || !rd;
  if (canEdit() && rd) {
    const seqs = U.seqsOf(stops), counts = U.mapCounts(map);
    if (brush && !seqs.includes(brush)) brush = 0;
    if (!brush && seqs.length) brush = seqs[0];
    $('brush').innerHTML = seqs.map(q => '<button type="button" data-seq="' + q + '" aria-pressed="' + (q === brush) + '" style="background:' + seqColour(q) + '" title="Load ' + q + ': ' + (counts[q] || 0) + ' spots">' + q + '</button>').join('') +
      '<button type="button" data-seq="0" aria-pressed="' + (brush === -1) + '" title="Make spots empty">Empty</button>';
    $('door').innerHTML = '<option value="">No side door</option>' + Array.from({ length: map.rows + 1 }, (x, i) => '<option value="' + i + '"' + (map.door === i ? ' selected' : '') + '>Side door before row ' + (i + 1) + '</option>').join('');
  }
  const missing = stops.filter(s => !s.loadSeq).length;
  $('hint').textContent = KIOSK ? (rd && rd.updatedAt ? 'Last changed ' + shortDate(rd.updatedAt) + '. ' : '') + 'Load 1 goes on first, at the front of the truck.' :
    (canEdit() ? 'Pick a load number, then tap or drag across spots to paint it. Every change saves by itself. ' : 'Load 1 goes on first, at the front. ') + (missing ? missing + ' stop' + (missing === 1 ? ' has' : 's have') + ' no load sequence (set it on Route Sequence).' : '');
}

/** The map changed on the screen: shown at once, saved a moment after the last tap. */
function changed(map) {
  pending = U.cleanMap(map);
  draw();
  clearTimeout(timer);
  timer = setTimeout(flush, 700);
}
async function flush() {
  const rd = current(), map = pending;
  if (!rd || !map) return;
  try {
    const out = await saveStep('saveRouteDay', { route: rd.route, day: rd.day, rev: rd.rev, map });
    data.routeDays[data.routeDays.indexOf(rd)] = out.routeDay;
    if (pending === map) pending = null;
    showError('');
  } catch (err) { pending = null; showError(serverText(err, 'the customer list')); try { data = Object.assign(data, await readList()); } catch (e2) { /* keep */ } }
  draw();
}
const mapNow = () => pending || U.cleanMap(current().map || U.autoMap(current().stops || []));
function paint(cell) {
  if (!cell || !canEdit()) return;
  const m = mapNow(), r = Number(cell.dataset.r), c = Number(cell.dataset.c), v = brush > 0 ? brush : null;
  if (m.cells[r][c] === v) return;
  m.cells[r][c] = v;
  changed(m);
}
const leave = async (fn) => { if (pending) { clearTimeout(timer); await flush(); } fn(); };

$('truck').addEventListener('pointerdown', ev => { const cell = ev.target.closest('.lm-cell.edit'); if (!cell) return; painting = true; paint(cell); ev.preventDefault(); });
$('truck').addEventListener('pointerover', ev => { if (painting) paint(ev.target.closest('.lm-cell.edit')); });
document.addEventListener('pointerup', () => { painting = false; });
$('brush').onclick = (ev) => { const b = ev.target.closest('button[data-seq]'); if (!b) return; brush = Number(b.dataset.seq) || -1; draw(); };
$('row-add').onclick = () => { const m = mapNow(); if (m.rows >= U.MAX_ROWS) return; m.cells.push(m.cells[m.cells.length - 1].map(() => null)); m.rows++; changed(m); };
$('row-cut').onclick = () => { const m = mapNow(); if (m.rows <= 1) return; m.cells.pop(); m.rows--; if (m.door !== null && m.door > m.rows) m.door = m.rows; changed(m); };
$('door').onchange = () => { const m = mapNow(); m.door = $('door').value === '' ? null : Number($('door').value); changed(m); };
$('rebuild').onclick = () => { const rd = current(), m = mapNow(), a = U.autoMap(rd.stops || [], m.rows); a.door = m.door; changed(a); };
$('route').onchange = () => leave(() => { route = $('route').value; day = ''; draw(); });
$('days').onclick = (ev) => { const b = ev.target.closest('button[data-day]'); if (b && !b.disabled) leave(() => { day = b.dataset.day; draw(); }); };
$('kiosk-routes').onclick = (ev) => { const b = ev.target.closest('button[data-route]'); if (b) { route = b.dataset.route; draw(); } };
if (KIOSK) {
  $('full').hidden = false;
  $('full').onclick = () => { const d = document.documentElement; if (document.fullscreenElement) document.exitFullscreen(); else if (d.requestFullscreen) d.requestFullscreen(); };
}

printMenu($('udcl-print-menu'), () => {
  if (!data) return [];
  const rd = current(), pn = data.plantName, sameDay = sortedRouteDays(data.routeDays).filter(x => x.day === day);
  return [
    rd && { label: 'This load map with its customers', note: 'Route ' + route + ' ' + U.DAY_NAMES[day], html: () => printDoc('Load map ' + route, [loadMapPage(rd, data.customers, pn)]) },
    day && { label: 'Every load map for ' + U.DAY_NAMES[day], note: sameDay.length + ' pages', html: () => printDoc('Load maps ' + U.DAY_NAMES[day], sameDay.map(x => loadMapPage(x, data.customers, pn))) },
    { label: 'Every load map of route ' + route, note: 'One page per day', html: () => printDoc('Load maps ' + route, sortedRouteDays(data.routeDays).filter(x => x.route === route).map(x => loadMapPage(x, data.customers, pn))) }
  ];
});

async function read() {
  try { const d = await readList(); if (!pending) { data = d; $('plant-name').textContent = data.plantName || ''; draw(); } showError(''); }
  catch (err) { showError(serverText(err, 'the customer list')); }
}
requireSignIn(async () => {
  await read();
  if (KIOSK) setInterval(() => { if (KIOSK && day !== todayKey() && !params.get('day')) day = todayKey(); read(); }, 120000);
});
