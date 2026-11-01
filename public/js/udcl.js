/*
 * United Dairy Customer List (Joe 11/1): what the Customers, Route Sequence and Truck Load Map screens share: reading the list
 * from the server, the Print menu every screen has (Joe: "Be able to print anything from any screen on a drop down"), the
 * printed sheets, and the truck load map drawing. The rules (sorting, run order, load maps) are in udcl-rules.js.
 */
import { callServer, escapeHtml as e, printInFrame, shortDate } from './app.js';

const U = window.UDCL;

/** The plant's list: { customers, routeDays, canEdit, canImport, imported, plantName }. */
export async function readList() { return callServer('customers', { op: 'view' }); }
export async function saveStep(op, fields) { return callServer('customers', Object.assign({ op }, fields)); }

/* ---------- load sequence colours (the same number has the same colour everywhere, and in print) ---------- */
const COLOURS = ['#ffd54f', '#81d4fa', '#a5d6a7', '#f48fb1', '#ce93d8', '#ffab91', '#80cbc4', '#e6ee9c', '#b0bec5', '#fff59d', '#90caf9', '#c5e1a5', '#ef9a9a', '#b39ddb', '#ffcc80', '#80deea', '#bcaaa4', '#f8bbd0', '#dce775', '#9fa8da'];
export function seqColour(n) { return n ? COLOURS[(Number(n) - 1) % COLOURS.length] : '#e9eef3'; }
export function seqChip(n) { return '<span class="sw" style="background:' + seqColour(n) + '">' + (n ? e(n) : '-') + '</span>'; }

/** The truck seen from above: FRONT at the top, the back door at the bottom; editable spots carry data-r / data-c. */
export function truckHtml(map, opts) {
  const o = opts || {}, m = U.cleanMap(map || {});
  let h = '<div class="lm-truck"' + (o.style ? ' style="' + o.style + '"' : '') + '><div class="lm-label">Front</div>';
  m.cells.forEach((row, r) => {
    if (m.door === r) h += '<div class="lm-door">SIDE DOOR</div>';
    h += '<div class="lm-row">' + row.map((v, c) => (c === 3 ? '<span class="aisle"></span>' : '') +
      '<span class="lm-cell' + (o.edit ? ' edit' : '') + '" data-r="' + r + '" data-c="' + c + '" style="background:' + seqColour(v) + '">' + (v || '') + '</span>').join('') + '</div>';
  });
  if (m.door === m.rows) h += '<div class="lm-door">SIDE DOOR</div>';
  return h + '<div class="lm-label">Back door</div></div>';
}

/* ---------- the Print menu ---------- */

/**
 * A "Print" button with a drop-down of what this screen can print. items() is asked each time it opens (so it can follow what
 * the screen shows): [{ label, note, html: () => printed page }].
 */
export function printMenu(box, items) {
  box.classList.add('print-menu');
  box.innerHTML = '<button type="button" aria-haspopup="true" aria-expanded="false">Print &#9662;</button><div class="pm-list" role="menu" hidden></div>';
  const button = box.firstChild, list = box.lastChild;
  let shown = [];
  const close = () => { list.hidden = true; button.setAttribute('aria-expanded', 'false'); };
  button.onclick = (ev) => {
    ev.stopPropagation();
    if (!list.hidden) return close();
    shown = items().filter(Boolean);
    list.innerHTML = shown.map((it, i) => '<button type="button" role="menuitem" data-i="' + i + '"' + (it.disabled ? ' disabled' : '') + '>' + e(it.label) + (it.note ? '<small>' + e(it.note) + '</small>' : '') + '</button>').join('');
    list.hidden = false; button.setAttribute('aria-expanded', 'true');
  };
  list.onclick = (ev) => {
    const b = ev.target.closest('button[data-i]');
    if (!b) return;
    const it = shown[Number(b.dataset.i)];
    close();
    if (it && it.html) printInFrame(it.html(), { id: 'udcl-print', wait: 250 });
  };
  document.addEventListener('click', (ev) => { if (!box.contains(ev.target)) close(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); });
}

const PRINT_CSS = `
  @page { size: letter; margin: 0.45in; }
  * { box-sizing: border-box; }
  body { font: 12px/1.25 Arial, Helvetica, sans-serif; color: #000; margin: 0; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .sub { color: #333; margin: 0 0 8px; font-size: 12px; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { border: 1px solid #555; padding: 3px 5px; text-align: left; vertical-align: top; }
  th { background: #dfe7ef; font-size: 11px; text-transform: uppercase; }
  td.c, th.c { text-align: center; }
  tr { page-break-inside: avoid; }
  .grp { background: #eef3f8; font-weight: bold; }
  .notes { border: 1px solid #555; padding: 6px 8px; margin-top: 8px; white-space: pre-wrap; min-height: 40px; }
  .two { display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: start; }
  .sw { display: inline-block; min-width: 26px; text-align: center; border-radius: 3px; font-weight: bold; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .lm-truck { display: inline-grid; gap: 2px; background: #4a5a6a; padding: 5px; border-radius: 10px 10px 4px 4px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .lm-label { color: #fff; font-size: 9px; text-align: center; text-transform: uppercase; letter-spacing: .1em; }
  .lm-row { display: grid; grid-template-columns: repeat(3, 34px) 8px repeat(3, 34px); gap: 2px; }
  .lm-cell { height: 22px; border-radius: 3px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .lm-door { color: #ffd54a; font-size: 9px; font-weight: bold; text-align: center; border-top: 1px dashed #ffd54a; border-bottom: 1px dashed #ffd54a; }
  .foot { margin-top: 6px; font-size: 10px; color: #444; }
  .big td { height: 26px; }
`;

/** A whole printed document from pages of HTML. */
export function printDoc(title, pages) {
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + e(title) + '</title><style>' + PRINT_CSS + '</style></head><body>' +
    pages.map(p => '<div class="page">' + p + '</div>').join('') + '</body></html>';
}
const printedOn = (by) => 'Printed ' + shortDate(new Date()) + ' ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + (by ? ' · ' + e(by) : '');
const changed = (rd) => rd && rd.updatedAt ? 'Last changed ' + shortDate(rd.updatedAt) + (rd.updatedBy ? ' by ' + e(rd.updatedBy) : '') : '';

/**
 * One route day on paper. kind: 'office' (the office's copy: stop, load sequence, account, customer, address, stop note) or
 * 'driver' (the route book page: also keys or door code, Time In and Time Out boxes to fill in, the instructions and the load map).
 */
export function routeDayPage(rd, customers, kind, plantName) {
  const stops = rd.stops || [], driver = kind === 'driver';
  const rows = stops.map((s, i) => {
    const c = customers[s.key] || {};
    const note = [s.note, driver ? c.notes : ''].filter(Boolean).join(' · ');
    return '<tr' + (driver ? ' class="big"' : '') + '><td class="c"><b>' + (i + 1) + '</b></td><td class="c"><span class="sw" style="background:' + seqColour(s.loadSeq) + '">' + (s.loadSeq || '') + '</span></td>' +
      '<td>' + e(c.account || s.account || '') + '</td><td><b>' + e(c.name || s.name || '') + '</b>' + (c.chain ? ' <small>(' + e(c.chain) + ')</small>' : '') + '</td>' +
      '<td>' + e(U.addressLine(c)) + '</td>' + (driver ? '<td>' + e(c.keys || '') + '</td><td></td><td></td>' : '') + '<td>' + e(note) + '</td></tr>';
  }).join('');
  const head = '<tr><th class="c">Stop</th><th class="c">Load</th><th>Account</th><th>Customer</th><th>Address</th>' + (driver ? '<th>Keys / door code</th><th>Time in</th><th>Time out</th>' : '') + '<th>Notes</th></tr>';
  const title = 'Route ' + e(rd.route) + ' · ' + e(U.DAY_NAMES[rd.day] || rd.day) + (rd.startTime ? ' · Start ' + e(rd.startTime) : '');
  const table = '<table>' + head + rows + '</table>';
  const notes = rd.notes ? '<div class="notes"><b>Instructions</b>\n' + e(rd.notes) + '</div>' : '';
  const body = driver ? '<div class="two"><div>' + table + notes + '</div><div>' + truckHtml(rd.map) + '</div></div>' : table + notes;
  return '<h1>' + title + '</h1><p class="sub">' + e(plantName || '') + ' · ' + (driver ? 'Route book' : 'Route sequence') + ' · ' + stops.length + ' stops · ' + changed(rd) + '</p>' + body +
    '<p class="foot">' + printedOn() + '</p>';
}

/** The load map with the customer list beside it (what the kiosk shows). */
export function loadMapPage(rd, customers, plantName) {
  const rows = (rd.stops || []).map((s, i) => { const c = customers[s.key] || {}; return '<tr><td class="c">' + (i + 1) + '</td><td class="c"><span class="sw" style="background:' + seqColour(s.loadSeq) + '">' + (s.loadSeq || '') + '</span></td><td><b>' + e(c.name || s.name) + '</b></td><td>' + e(s.note || '') + '</td></tr>'; }).join('');
  return '<h1>Truck load map · Route ' + e(rd.route) + ' · ' + e(U.DAY_NAMES[rd.day] || rd.day) + '</h1><p class="sub">' + e(plantName || '') + ' · Load 1 goes on first, at the front · ' + changed(rd) + '</p>' +
    '<div class="two" style="grid-template-columns:auto 1fr"><div>' + truckHtml(rd.map) + '</div><div><table><tr><th class="c">Stop</th><th class="c">Load</th><th>Customer</th><th>Notes</th></tr>' + rows + '</table>' +
    (rd.notes ? '<div class="notes"><b>Instructions</b>\n' + e(rd.notes) + '</div>' : '') + '</div></div><p class="foot">' + printedOn() + '</p>';
}

/** Any list of lines as a printed table: cols = [[heading, (line) => text, 'c' to centre]]; group = (line) => heading or ''. */
export function tablePage(title, sub, list, cols, group) {
  let last = null, body = '';
  list.forEach(x => {
    const g = group ? group(x) : '';
    if (group && g !== last) { body += '<tr class="grp"><td colspan="' + cols.length + '">' + e(g) + '</td></tr>'; last = g; }
    body += '<tr>' + cols.map(c => '<td' + (c[2] ? ' class="c"' : '') + '>' + e(c[1](x)) + '</td>').join('') + '</tr>';
  });
  return '<h1>' + e(title) + '</h1><p class="sub">' + e(sub) + ' · ' + list.length + ' lines · ' + printedOn() + '</p><table><tr>' + cols.map(c => '<th' + (c[2] ? ' class="c"' : '') + '>' + e(c[0]) + '</th>').join('') + '</tr>' + body + '</table>';
}

/** The route days in route, then day order. */
export function sortedRouteDays(list) { return list.slice().sort((a, b) => U.byRoute(a.route, b.route) || U.dayIndex(a.day) - U.dayIndex(b.day)); }
export function routesOf(list) { return [...new Set(list.map(r => r.route))].sort(U.byRoute); }
/** Today's delivery day name key (SUN..SAT) in plant time. */
export function todayKey() { return U.DAYS[new Date().getDay()]; }
export { U };
