/*
 * Links & Codes in the hub (Joe 11-2-26: "managers access, links and codes ... one change all"). Every link and code people use
 * to reach Plant & Distribution: the managers' links and release codes, the Plant Managers App, the Sales App, the Plant,
 * Garage, Maintenance and Driver Room stations and the drivers' phone code. It reads and saves through Operations' own
 * server call (admin: appLinks, routeCodeNew, routeCodeOnOff, releaseCodes, releaseCodeNew, stations, stationAdd,
 * stationCode, stationRemove, noAccountSet), the same saves as Administration, Links & Codes there, so nothing is redone and
 * every code already given out keeps working. The links open Plant & Distribution's own site.
 */
import { callServer, escapeHtml as e, showError, serverText, shortDate, setAdmin } from './shell.js';

const $ = (s) => document.querySelector(s);
const QS = new URLSearchParams(location.search);

// Plant & Distribution's own site: the hub's address without -hub (ud-distribution-sandbox-hub -> ud-distribution-sandbox).
export const opsOrigin = (loc) => /-hub\.(web\.app|firebaseapp\.com)$/.test(loc.hostname) ? loc.protocol + '//' + loc.hostname.replace(/-hub\.(web\.app|firebaseapp\.com)$/, '.$1') : loc.origin;
// Another plant's links name it (?plant=), as Operations does; Uniontown's stay as they were.
export const plantPath = (path, plant) => !plant || plant === 'fac_uniontown' ? path : path + (path.indexOf('?') >= 0 ? '&' : '?') + 'plant=' + encodeURIComponent(plant);

// The links, as Operations' Links & Codes has them (public/js/admin-pages.js APP_LINKS). ud: United Dairy sign-in; code: a code.
const LINKS = {
  company: { title: 'Plant Operations', path: 'index.html', who: 'ud', short: 'The full app on a computer: anyone with a United Dairy account; their role decides what they see.' },
  phone: { title: 'Phone link', path: 'index.html', who: 'ud', short: 'The full app on a phone: anyone with a United Dairy account.' },
  distribution: { title: 'Distribution Manager', path: 'distribution.html', who: 'ud', short: 'Route Distribution (dispatch, routes, trucks and drivers): United Dairy account.' },
  managers: { title: 'Plant Managers App', path: 'walkthrough.html?view=home&app=1', who: 'ud', short: 'The plant managers\' phones and tablets: United Dairy account (Manager or Administrator), then the Plant Managers code once.' },
  sales: { title: 'Sales App', path: 'sales.html', who: 'ud', short: 'Salespeople on their phones: any United Dairy account, no code. It only shows; nothing can be changed from it.' },
  plant: { title: 'Plant Station', path: 'plant-station.html', who: 'ud', short: 'A tablet with a United Dairy account, then the station\'s code once.' },
  public: { title: 'Plant Station with no United Dairy account', path: 'plant-station.html?noaccount=1', who: 'code', short: 'A tablet or phone with only its station\'s code, while it is On.' },
  line: { title: 'Line Tablet', path: 'line.html?tablet=1', who: 'ud', short: 'The tablet at a production line: United Dairy account, then the Line Tablet code once.' },
  garage: { title: 'Garage Station', path: 'garage-station.html', who: 'code', short: 'The garage station\'s code, then each mechanic\'s login ID.' },
  maint: { title: 'Maintenance Station', path: 'maint-station.html', who: 'code', short: 'The Maintenance Station\'s code, then each mechanic\'s name and login ID.' },
  driver: { title: 'Driver Station (the TV and the drivers\' tablet)', path: 'driver-station.html', who: 'ud', short: 'The TV types the Driver\'s Kiosk Station code; the drivers\' tablet types the Driver Room Check-In Station code.' },
  route: { title: 'Drivers\' phones (Route Distribution)', path: 'route.html', who: 'code', short: 'Drivers on their own phones with the Route Distribution code: View Loadout, DVIR, Check-In and My Schedule.' }
};

// The parts of the page, one at a time (links.html?part=...).
export const PARTS = [
  { key: 'managers', name: 'Manager links', note: 'The full app, the phone link, the Distribution Manager, and each plant\'s manager release code', links: ['company', 'phone', 'distribution'], release: true },
  { key: 'plant-managers', name: 'Plant Managers App', note: 'The managers\' phone app and its code', links: ['managers'], kinds: ['MANAGER'] },
  { key: 'sales', name: 'Sales App', note: 'The salespeople\'s phone app', links: ['sales'] },
  { key: 'plant', name: 'Plant Stations', note: 'The plant tablets, their codes, and the line tablets', links: ['plant', 'public', 'line'], kinds: ['PLANT', 'LINE'] },
  { key: 'garage', name: 'Garage & Maintenance', note: 'The garage and maintenance tablets and their codes', links: ['garage', 'maint'], kinds: ['GARAGE', 'MAINT'] },
  { key: 'drivers', name: 'Driver Room & phones', note: 'The TV, the drivers\' tablet, and the drivers\' phone code', links: ['driver', 'route'], kinds: ['KIOSK'] }
];
const KIND_NAME = { MANAGER: 'Plant Managers code', PLANT: 'Plant Stations', LINE: 'Line Tablets', GARAGE: 'Garage Stations', MAINT: 'Maintenance Station', KIOSK: 'Driver Room stations' };
const KIND_EXAMPLE = { MANAGER: 'Plant Managers', PLANT: 'Case Loadout dock 2', LINE: 'Filler line tablets', GARAGE: 'Garage bay 2', MAINT: 'Maintenance shop', KIOSK: 'Driver Room TV' };

let part = PARTS.find(p => p.key === QS.get('part')) || PARTS[0];
let plants = [], plant = '', got = {};
const url = (k) => opsOrigin(location) + '/' + plantPath(LINKS[k].path, plant);
const when = (iso) => iso ? shortDate(iso) : '';

function say(text, kind) {
  const m = $('#msg');
  m.hidden = !text; m.textContent = text || ''; m.className = 'list-msg ' + (kind || '');
}

/* ---------- Drawing ---------- */

function drawNav() {
  $('#parts').innerHTML = PARTS.map(p => '<a href="?part=' + p.key + '" data-part="' + p.key + '"' + (p === part ? ' class="on" aria-current="page"' : '') + '><b>' + e(p.name) + '</b><small>' + e(p.note) + '</small></a>').join('');
}

function routeRow() {
  const c = (got.appLinks || {}).routeCode;
  if (!c) return '';
  const state = c.state === 'ACTIVE' ? '<span class="pill good">On</span>' : c.state === 'DISABLED' ? '<span class="pill bad">Off</span>' : '<span class="pill">No code yet</span>';
  return '<div class="lc-code"><span><b>Code:</b> ' + (c.code ? '<code>' + e(c.code) + '</code>' : c.state === 'NOT SET' ? 'none yet' : 'make a new code to show it here') + ' ' + state +
    (c.setAt ? ' <small>changed ' + e(when(c.setAt)) + '</small>' : '') + '</span><span class="lc-acts">' +
    (c.code ? '<button type="button" data-copy-text="' + e(c.code) + '">Copy Code</button>' : '') +
    '<button type="button" class="' + (c.state === 'NOT SET' ? 'primary' : 'warn') + '" data-route="new"' + (c.state === 'NOT SET' ? '' : ' data-twice="Press again: every phone asks for the new code"') + '>' + (c.state === 'NOT SET' ? 'Make a code' : 'New code') + '</button>' +
    (c.state === 'ACTIVE' ? '<button type="button" data-route="off" data-twice="Press again to turn off">Turn Off</button>' : c.state === 'DISABLED' ? '<button type="button" class="primary" data-route="on">Turn On</button>' : '') + '</span></div>';
}

function noAccountRow() {
  const n = ((got.PLANT || {}).noAccount || []).find(x => x.id === plant);
  if (!n) return '';
  return '<div class="lc-code"><span><b>' + e(n.name) + ':</b> ' + (n.on ? '<span class="pill good">On</span>' : '<span class="pill bad">Off</span>') + '</span><span class="lc-acts">' +
    (n.on ? '<button type="button" data-noaccount="off" data-twice="Press again: every no-account tablet stops">Turn Off</button>' : '<button type="button" class="primary" data-noaccount="on">Turn On</button>') + '</span></div>';
}

function linkCard(k) {
  const l = LINKS[k], ud = l.who === 'ud';
  return '<article class="lc-card" data-link="' + k + '"><header><h3>' + e(l.title) + '</h3><span class="chip ' + (ud ? 'blue' : 'orange') + '">' + (ud ? 'United Dairy sign-in' : 'Code, no account') + '</span></header>' +
    '<p>' + e(l.short) + '</p><p class="lc-url">' + e(url(k)) + '</p><div class="lc-acts"><button type="button" data-copy="' + k + '">Copy Link</button><button type="button" data-qr="' + k + '">Print QR</button>' +
    '<a class="primary" href="' + e(url(k)) + '" target="_blank" rel="noopener">Open <span class="sr">(opens in a new tab)</span></a></div>' +
    (k === 'route' ? routeRow() : '') + (k === 'public' ? noAccountRow() : '') + '</article>';
}

function releaseBlock() {
  const p = ((got.releaseCodes || {}).plants || []).find(x => x.id === plant);
  if (!p) return '';
  return '<section class="lc-block"><h3>Manager release code</h3><p class="muted">A tablet keeps its station. To move it, a manager taps Release in the bottom-right corner of the tablet and types this code. Five wrong codes lock it for ten minutes.</p>' +
    '<div class="lc-row"><div><b>' + e(p.name) + '</b><small>' + (p.changedAt ? 'Changed ' + e(when(p.changedAt)) + ' by ' + e(p.changedBy) : 'Manager release code') + '</small></div>' +
    (p.code ? '<code>' + e(p.code) + '</code><button type="button" data-copy-text="' + e(p.code) + '">Copy Code</button>' : '<span class="pill">' + (p.set ? 'Code is set' : 'No code yet') + '</span>') +
    '<button type="button" class="' + (p.set ? 'warn' : 'primary') + '" data-release="' + e(p.id) + '"' + (p.set ? ' data-twice="Press again to replace"' : '') + '>' + (p.set ? 'New code' : 'Make a code') + '</button></div></section>';
}

function stationBlock(kind) {
  const d = got[kind];
  if (!d) return '';
  const rows = d.stations.filter(s => s.facilityId === plant);
  return '<section class="lc-block" data-kind="' + kind + '"><h3>' + e(KIND_NAME[kind]) + '</h3>' +
    (rows.map(s => '<div class="lc-row"><div><b>' + e(s.name) + '</b><small>' + e(s.typeName) + (s.changedAt ? ' &middot; code changed ' + e(when(s.changedAt)) + ' by ' + e(s.changedBy) : '') + '</small></div>' +
      (s.code ? '<code>' + e(s.code) + '</code><button type="button" data-copy-text="' + e(s.code) + '">Copy Code</button>' : '<span class="pill">' + (s.set ? 'Code is set' : 'No code yet') + '</span>') +
      '<button type="button" class="' + (s.set ? 'warn' : 'primary') + '" data-code="' + e(s.key) + '"' + (s.set ? ' data-twice="Press again to replace"' : '') + '>' + (s.set ? 'New code' : 'Make a code') + '</button>' +
      '<button type="button" data-remove="' + e(s.key) + '" data-twice="Press again to remove">Remove</button></div>').join('') || '<p class="muted">None yet at this plant. Add one below.</p>') +
    '<div class="lc-add"><label>New name<input data-new-name maxlength="60" placeholder="Like ' + e(KIND_EXAMPLE[kind]) + '"></label>' +
    (d.types.length > 1 ? '<label>Type<select data-new-type>' + d.types.map(t => '<option value="' + e(t.id) + '">' + e(t.name) + '</option>').join('') + '</select></label>' : '') +
    '<button type="button" class="primary" data-add="' + kind + '">+ Add</button></div></section>';
}

function draw() {
  drawNav();
  $('#plant').innerHTML = plants.map(p => '<option value="' + e(p.id) + '"' + (p.id === plant ? ' selected' : '') + '>' + e(p.name) + '</option>').join('');
  $('#plant').disabled = plants.length < 2;
  const links = part.links.filter(k => k !== 'route');
  $('#part').innerHTML = '<h2>' + e(part.name) + '</h2><div class="lc-cards">' + links.map(linkCard).join('') + '</div>' + (part.release ? releaseBlock() : '') +
    (part.kinds || []).map(stationBlock).join('') + (part.links.indexOf('route') >= 0 ? '<div class="lc-cards">' + linkCard('route') + '</div>' : '');
}

/* ---------- Loading and saving ---------- */

async function load() {
  const asks = [['releaseCodes', { op: 'releaseCodes' }]];
  if (part.links.indexOf('route') >= 0) asks.push(['appLinks', { op: 'appLinks' }]);
  (part.kinds || []).concat(part.links.indexOf('public') >= 0 ? ['PLANT'] : []).forEach(k => { if (!asks.some(a => a[0] === k)) asks.push([k, { op: 'stations', kind: k }]); });
  const out = await Promise.all(asks.map(a => callServer('admin', a[1])));
  asks.forEach((a, i) => { got[a[0]] = out[i]; });
  plants = got.releaseCodes.plants.map(p => ({ id: p.id, name: p.name }));
  if (!plants.some(p => p.id === plant)) plant = (plants[0] || {}).id || 'fac_uniontown';
  setAdmin(true);
  draw();
}

async function run(btn, work) {
  document.querySelectorAll('#part button').forEach(b => { b.disabled = true; });
  say('');
  try {
    const r = await work();
    if (r && r.stations) got[r.kind] = r;
    await load();
    say(r && r.message || 'Saved.', 'good');
  } catch (err) {
    say(serverText(err, 'Plant & Distribution'), 'bad');
    draw();
  }
}

async function copy(btn, value) {
  try { await navigator.clipboard.writeText(value); } catch (err) {
    const t = document.createElement('textarea'); t.value = value; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (x) { /* none */ } t.remove();
  }
  const was = btn.textContent;
  btn.textContent = 'Copied';
  setTimeout(() => { if (btn.isConnected) btn.textContent = was; }, 1400);
}

// One QR sheet, printed from a hidden frame in this window (no new tab, no pop-up). The QR is drawn here, never by an outside service.
function printQr(k) {
  const l = LINKS[k], link = url(k), q = window.qrcode(0, 'M');
  q.addData(link); q.make();
  const c = k === 'route' && got.appLinks && got.appLinks.routeCode.code ? 'Code: <b>' + e(got.appLinks.routeCode.code) + '</b>' : l.who === 'code' ? 'Type the code your manager gives you.' : 'Sign in with your United Dairy Google account.';
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><title>' + e(l.title) + '</title><style>body{font-family:Segoe UI,Arial,sans-serif;text-align:center;padding:40px}h1{color:#0b3d6b;font-size:30px;margin:0 0 6px}' +
    '.qr{width:360px;height:360px;margin:10px auto}.qr svg{width:100%;height:100%}p{font-size:18px}.url{font-size:12px;color:#5a6b7d;word-break:break-all}</style></head><body><h1>United Dairy ' + e(l.title) + '</h1><p>Scan to open.</p>' +
    '<div class="qr">' + q.createSvgTag({ cellSize: 4, margin: 4, scalable: true }) + '</div><p>' + c + '</p><p class="url">' + e(link) + '</p>' +
    (/sandbox/.test(link) ? '<p style="color:#b42318;font-weight:800">PRACTICE COPY: TEST ONLY</p>' : '') + '</body></html>';
  frame.onload = () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (err) { /* printing refused */ } setTimeout(() => frame.remove(), 60000); };
}

function click(ev) {
  const b = ev.target.closest('button');
  // Any other press puts a waiting "Press again" button back.
  document.querySelectorAll('#part button.armed').forEach(x => { if (x !== b) { x.classList.remove('armed'); x.textContent = x.dataset.label; } });
  if (!b) return;
  if (b.dataset.twice && !b.classList.contains('armed')) { b.dataset.label = b.textContent; b.classList.add('armed'); b.textContent = b.dataset.twice; return; }
  const d = b.dataset;
  if (d.copy) return copy(b, url(d.copy));
  if (d.copyText) return copy(b, d.copyText);
  if (d.qr) return printQr(d.qr);
  if (d.route === 'new') return run(b, () => callServer('admin', { op: 'routeCodeNew' }));
  if (d.route) return run(b, () => callServer('admin', { op: 'routeCodeOnOff', open: d.route === 'on' }));
  if (d.noaccount) return run(b, () => callServer('admin', { op: 'noAccountSet', facilityId: plant, on: d.noaccount === 'on' }));
  if (d.release) return run(b, () => callServer('admin', { op: 'releaseCodeNew', facilityId: d.release }));
  if (d.code) return run(b, () => callServer('admin', { op: 'stationCode', key: d.code }));
  if (d.remove) return run(b, () => callServer('admin', { op: 'stationRemove', key: d.remove }));
  if (d.add) {
    const sec = b.closest('[data-kind]'), name = sec.querySelector('[data-new-name]').value.trim(), type = sec.querySelector('[data-new-type]');
    if (!name) { say('Type the new name first.', 'bad'); sec.querySelector('[data-new-name]').focus(); return; }
    return run(b, () => callServer('admin', { op: 'stationAdd', kind: d.add, type: type ? type.value : got[d.add].types[0].id, facilityId: plant, name }));
  }
}

export function start() {
  $('#practice').hidden = !/sandbox|localhost|127\.0\.0\.1/.test(location.hostname);
  $('#part').addEventListener('click', click);
  $('#plant').addEventListener('change', () => { plant = $('#plant').value; say(''); draw(); });
  // A part opens without leaving the page; its address is kept so Help and Back find it.
  $('#parts').addEventListener('click', (ev) => {
    const a = ev.target.closest('a[data-part]');
    if (!a) return;
    ev.preventDefault();
    part = PARTS.find(p => p.key === a.dataset.part);
    history.pushState(null, '', '?part=' + part.key);
    say('');
    load().catch(err => showError(serverText(err, 'the links and codes')));
  });
  window.addEventListener('popstate', () => { part = PARTS.find(p => p.key === new URLSearchParams(location.search).get('part')) || PARTS[0]; load().catch(() => {}); });
  return load().catch(err => showError(serverText(err, 'the links and codes')));
}
