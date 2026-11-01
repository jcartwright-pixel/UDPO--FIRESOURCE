// Route Sequence (United Dairy Customer List, Joe 11/1): one route on one day, its stops in the order the driver runs them. An
// Administrator or Manager drags a stop to a new place (or uses the arrows), changes its load sequence and note, adds or removes a
// stop, and types the start time and instructions; every change saves by itself. The Print menu prints it for the office, as a
// driver's route book page, or every day of the route / every route of the day.
import { requireSignIn, escapeHtml as e, showError, serverText, shortDate } from './app.js';
import { mountRowDrag } from './row-drag.js';
import { readList, saveStep, printMenu, printDoc, routeDayPage, loadMapPage, truckHtml, sortedRouteDays, routesOf, todayKey, U } from './udcl.js';

const params = new URLSearchParams(location.search);
let data = null, route = params.get('route') || '', day = U.dayOf(params.get('day')) || '';
const $ = (id) => document.getElementById(id);
const rdOf = (r, d) => (data ? data.routeDays : []).find(x => x.route === r && x.day === d) || null;
const current = () => rdOf(route, day);
let saving = Promise.resolve();

function pickDefaults() {
  const routes = routesOf(data.routeDays);
  if (!routes.includes(route)) route = routes[0] || '';
  const days = data.routeDays.filter(x => x.route === route).map(x => x.day);
  if (!days.includes(day)) day = days.includes(todayKey()) ? todayKey() : days.sort((a, b) => U.dayIndex(a) - U.dayIndex(b))[0] || '';
  history.replaceState(null, '', '?route=' + encodeURIComponent(route) + '&day=' + day);
}

function draw() {
  if (!data) return;
  pickDefaults();
  const routes = routesOf(data.routeDays);
  $('route').innerHTML = routes.map(r => '<option value="' + e(r) + '"' + (r === route ? ' selected' : '') + '>Route ' + e(r) + '</option>').join('') || '<option value="">No routes yet</option>';
  $('days').innerHTML = U.DAYS.map(d => '<button type="button" data-day="' + d + '" aria-pressed="' + (d === day) + '"' + (rdOf(route, d) ? '' : ' disabled') + '>' + U.DAY_NAMES[d].slice(0, 3) + '</button>').join('');
  const rd = current(), edit = data.canEdit;
  const stops = rd ? rd.stops || [] : [];
  $('rows').innerHTML = stops.map((s, i) => {
    const c = data.customers[s.key] || {};
    return '<tr data-drag="' + e(s.key) + '"><td><span class="stopno">' + (i + 1) + '</span></td>' +
      '<td>' + (edit ? '<input class="seq" data-i="' + i + '" inputmode="numeric" value="' + (s.loadSeq || '') + '" aria-label="Load sequence for ' + e(c.name || s.name) + '">' : (s.loadSeq || '-')) + '</td>' +
      '<td>' + e(c.account || s.account) + '</td><td class="l"><b>' + e(c.name || s.name) + '</b>' + (c.city ? ' <small>' + e(c.city) + '</small>' : '') + '</td>' +
      '<td class="l">' + (edit ? '<input class="note" data-i="' + i + '" value="' + e(s.note || '') + '" placeholder="Note for this stop">' : e(s.note || '')) + '</td>' +
      '<td>' + (edit ? '<button type="button" class="mv" data-up="' + i + '" title="Move up"' + (i ? '' : ' disabled') + '>&#9650;</button> <button type="button" class="mv" data-down="' + i + '" title="Move down"' + (i < stops.length - 1 ? '' : ' disabled') + '>&#9660;</button> <button type="button" class="rm" data-rm="' + i + '">Remove</button>' : '') + '</td></tr>';
  }).join('') || '<tr><td colspan="6" class="empty">' + (data.routeDays.length ? 'No stops on this route day.' : 'The customer list is empty. An administrator imports it on the Customers screen.') + '</td></tr>';
  $('start').value = rd ? rd.startTime || '' : ''; $('notes').value = rd ? rd.notes || '' : '';
  $('start').disabled = $('notes').disabled = !edit || !rd;
  $('map').innerHTML = rd ? truckHtml(rd.map, { style: '--lm-w:30px;--lm-h:20px;--lm-f:12px' }) : '';
  $('map-link').href = 'load-map.html?route=' + encodeURIComponent(route) + '&day=' + day;
  $('changed').textContent = rd && rd.updatedAt ? 'Last changed ' + shortDate(rd.updatedAt) + ' by ' + (rd.updatedBy || '') : '';
  $('add-box').hidden = !edit || !rd;
  if (edit && rd) {
    const on = new Set(stops.map(s => s.key));
    const others = Object.values(data.customers).filter(c => !on.has(c.key) && c.active !== false).sort((a, b) => a.name.localeCompare(b.name));
    $('add-pick').innerHTML = '<option value="">Pick a customer to add at the end&hellip;</option>' + others.map(c => '<option value="' + e(c.key) + '">' + e(c.name) + (c.account ? ' (' + e(c.account) + ')' : '') + '</option>').join('');
  }
  const missing = stops.filter(s => !s.loadSeq).length;
  $('hint').textContent = (edit ? 'Drag a stop up or down (or use the arrows) to change the run order. Every change saves by itself. ' : 'Only an Administrator or Manager can change the sequence. ') +
    (missing ? missing + ' stop' + (missing === 1 ? ' has' : 's have') + ' no load sequence.' : '');
}

/** Saves the route day (the whole stop list in its new order, or the start time / instructions) and shows what the server kept. */
function save(fields) {
  const first = current();
  if (!first) return;
  const r = first.route, d = first.day;
  saving = saving.then(async () => {
    // The newest copy (an earlier save in the queue may have moved its rev on).
    const rd = rdOf(r, d) || first;
    try {
      const out = await saveStep('saveRouteDay', Object.assign({ route: r, day: d, rev: rd.rev }, fields));
      const i = data.routeDays.indexOf(rd);
      if (i >= 0) data.routeDays[i] = out.routeDay;
      showError('');
    } catch (err) {
      showError(serverText(err, 'the customer list'));
      try { data = Object.assign(data, await readList()); } catch (e2) { /* keep what is shown */ }
    }
    draw();
  });
  return saving;
}
const stopsNow = () => (current().stops || []).map(s => ({ key: s.key, loadSeq: s.loadSeq, note: s.note || '' }));
function moveStop(from, to) {
  const list = stopsNow();
  if (to < 0 || to >= list.length || from === to) return;
  const [s] = list.splice(from, 1);
  list.splice(to, 0, s);
  // Shown at once, saved behind.
  const rd = current(), old = rd.stops.slice(), [o] = old.splice(from, 1);
  old.splice(to, 0, o); rd.stops = old; draw();
  save({ stops: list });
}

$('route').onchange = () => { route = $('route').value; day = ''; draw(); };
$('days').onclick = (ev) => { const b = ev.target.closest('button[data-day]'); if (b && !b.disabled) { day = b.dataset.day; draw(); } };
$('rows').addEventListener('click', ev => {
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.up !== undefined) moveStop(Number(b.dataset.up), Number(b.dataset.up) - 1);
  else if (b.dataset.down !== undefined) moveStop(Number(b.dataset.down), Number(b.dataset.down) + 1);
  else if (b.dataset.rm !== undefined) { const list = stopsNow(); list.splice(Number(b.dataset.rm), 1); save({ stops: list }); }
});
$('rows').addEventListener('change', ev => {
  const el = ev.target, i = Number(el.dataset.i);
  if (!el.matches('input.seq, input.note')) return;
  const list = stopsNow();
  if (el.matches('.seq')) list[i].loadSeq = U.seqOf(el.value); else list[i].note = el.value;
  save({ stops: list });
});
$('add-pick').onchange = () => { const k = $('add-pick').value; if (!k) return; const list = stopsNow(); list.push({ key: k, loadSeq: 0, note: '' }); save({ stops: list }); };
$('start').onchange = () => save({ startTime: $('start').value });
$('notes').onchange = () => save({ notes: $('notes').value });
mountRowDrag({ box: $('rows'), canDrag: () => !!(data && data.canEdit), onMove: (key, to) => { const from = (current().stops || []).findIndex(s => s.key === key); moveStop(from, to); } });

printMenu($('udcl-print-menu'), () => {
  if (!data) return [];
  const rd = current(), pn = data.plantName, all = sortedRouteDays(data.routeDays);
  const sameRoute = all.filter(x => x.route === route), sameDay = all.filter(x => x.day === day);
  return [
    rd && { label: 'Route ' + route + ' ' + U.DAY_NAMES[day] + ' for the office', note: 'Stops in order with load sequence, address and notes', html: () => printDoc('Route ' + route, [routeDayPage(rd, data.customers, 'office', pn)]) },
    rd && { label: 'Route ' + route + ' ' + U.DAY_NAMES[day] + ' driver route book page', note: 'With keys, time in / out, instructions and the load map', html: () => printDoc('Route book ' + route, [routeDayPage(rd, data.customers, 'driver', pn)]) },
    rd && { label: 'Route ' + route + ' ' + U.DAY_NAMES[day] + ' load map', note: 'The truck drawing and the customers beside it', html: () => printDoc('Load map ' + route, [loadMapPage(rd, data.customers, pn)]) },
    { label: 'Every day of route ' + route + ' (route book)', note: sameRoute.length + ' pages', html: () => printDoc('Route book ' + route, sameRoute.map(x => routeDayPage(x, data.customers, 'driver', pn))) },
    day && { label: 'Every route on ' + U.DAY_NAMES[day] + ' for the office', note: sameDay.length + ' pages', html: () => printDoc(U.DAY_NAMES[day], sameDay.map(x => routeDayPage(x, data.customers, 'office', pn))) },
    { label: 'The whole route book (every route, every day)', note: all.length + ' pages', html: () => printDoc('Route book', all.map(x => routeDayPage(x, data.customers, 'driver', pn))) }
  ];
});

requireSignIn(async () => {
  try { data = await readList(); $('plant-name').textContent = data.plantName || ''; draw(); showError(''); }
  catch (err) { showError(serverText(err, 'the customer list')); }
});
