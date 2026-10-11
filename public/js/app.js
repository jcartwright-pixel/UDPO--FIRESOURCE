/*
 * United Dairy Distribution app: what every screen shares.
 * Sign-in (United Dairy Google accounts only), the database connection, the one-call save, and sizing the
 * screen to the window so nothing ever scrolls.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithPopup, signInWithCredential, signOut, GoogleAuthProvider, connectAuthEmulator
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js';

export const DOMAIN = 'uniteddairy.com';

// The approved header of the current app: logo and name on the left, the screen's buttons on the right.
document.querySelectorAll('.topbar').forEach(bar => {
  if (bar.querySelector('.brand')) return;
  const brand = document.createElement('a');
  brand.className = 'brand';
  brand.href = 'index.html';
  brand.innerHTML = '<img src="img/ud-logo.webp" alt="United Dairy"><span><strong>New Plant Operations</strong><small>UNITED DAIRY &middot; ROUTE DISTRIBUTION</small></span>';
  bar.prepend(brand);
  // Polish 10: one small yellow "Test copy" badge in the header on the sandbox (and a local copy); it comes off by itself at go-live.
  if (/sandbox|^localhost$|^127\.0\.0\.1$/.test(location.hostname)) brand.insertAdjacentHTML('afterend', '<span class="test-copy-badge" title="This is the test copy: changes stay in the new app">Test copy</span>');
});

// Joe 10/10: Administration opens a screen inside its right-hand panel; there the screen shows without its own header and menu.
export const EMBED = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
if (EMBED) document.body.classList.add('embed');

// The menu on the left (Joe, 10/9: "the action buttons ... supposed to be a menu option to the left"), the same on every
// screen. A link marked with the small arrow still opens the current app in a new tab. On a laptop it folds to icons;
// the button at its top opens it.
export const ICON = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  back: '<path d="M15 5l-7 7 7 7"/><path d="M8 12h12"/>',
  day: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M8 14h3v3H8z"/>',
  week: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M7 14h10M7 17h10"/>',
  map: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.6c2.6.2 4.4 1.9 5 5"/>',
  vacation: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M8 15l3 3 5-6"/>',
  truck: '<path d="M2 6h11v10H2zM13 9h5l3 4v3h-8z"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 00-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 005.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  road: '<path d="M8 3L4 21M16 3l4 18M12 4v3M12 10v3M12 16v3"/>',
  check: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 12l3 3 5-6"/>',
  swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  issue: '<path d="M4 20h16"/><path d="M6 20V9l6-5 6 5v11"/><path d="M12 10v4M12 16.5v.5"/>',
  alert: '<path d="M12 3l9 17H3z"/><path d="M12 10v4M12 17v.5"/>',
  factory: '<path d="M3 21V10l6 3V10l6 3V6l6-3v18z"/><path d="M7 17h2M12 17h2M17 17h2"/>',
  load: '<path d="M2 6h11v10H2zM13 9h5l3 4v3h-8z"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/><path d="M5 9h5M5 12h5"/>',
  unload: '<path d="M2 6h11v10H2zM13 9h5l3 4v3h-8z"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/><path d="M10 11H4M6 9l-2 2 2 2"/>',
  wash: '<path d="M12 3s-6 7-6 11a6 6 0 0012 0c0-4-6-11-6-11z"/><path d="M9.5 15a2.5 2.5 0 002.5 2.5"/>',
  returns: '<path d="M4 7h11a5 5 0 010 10H9"/><path d="M8 3L4 7l4 4"/>',
};
export const MENU = [
  ['', [['Home', 'index.html', 'home']]],
  ['Dispatch', [['Daily Dispatch', 'daily.html', 'day'], ['Weekly Dispatch', 'weekly.html', 'week'], ['Driver Assignment Board', 'weekly.html#board', 'people'], ['Route Editor', 'routes.html', 'map'], ['Route Week Override', 'routeweek.html', 'swap']]],
  // Joe 10/10: assigning drivers their routes has a plain link here (it came off the Route Editor); the board is under Dispatch too.
  ['Drivers', [['Driver Roster', 'drivers.html', 'people'], ['Driver Weekly Template (assign routes)', 'template.html', 'week'], ['Driver Assignment Board', 'weekly.html#board', 'people'], ['Vacation Schedule', 'vacations.html', 'vacation']]],
  // Joe 10/10: the maintenance side starts on the Fleet & Maintenance hub and branches out from there, as in the current app.
  // An icon name ending .webp is a picture from the United Dairy icon library (img/library).
  ['Equipment', [['Fleet & Maintenance', 'maint.html', 'maintenance-tractor-v1-560.webp'], ['Equipment', 'equipment.html', 'truck'], ['Equipment Issues', 'issues.html', 'issue'],
    ['Truck Issues', 'issues.html?kind=TRUCK', 'maintenance-tractor-v1-560.webp'], ['Trailer Issues', 'issues.html?kind=TRAILER', 'maintenance-trailer-v1-560.webp'],
    ['Fork Truck / Pallet Jack Issues', 'issues.html?kind=FORK_TRUCK', 'forklift-truck-v1-560.webp'], ['Garage Work Orders', 'garage.html', 'wrench'], ['Fleet Service', 'fleet.html', 'gear'],
    ['Garage Station', 'garage-station.html', 'wrench']]],
  // Joe 10/10: Over the Road and Trucks Today (GPS) are manager reports (he prints Over the Road), so they sit here only.
  // Joe 10/10 evening: GPS / Fleet is not a Fleet & Maintenance section; GPS Setup and Driver Scorecard sit in Manager Reports.
  ['Manager Reports', [['Driver Scorecard', 'scorecard.html', 'star'], ['Over the Road', 'otr.html', 'road'], ['Trucks Today', 'soon.html?what=trucks-today', 'pin'], ['GPS Setup', 'gps.html', 'gear']]],
  ['Overall', [['Driver Check-ins', 'checkins.html', 'check'], ['Driver Station', 'driver-station.html', 'people'], ['Sheet Conflicts', 'conflicts.html', 'alert']]],
  // Joe 10/10: Dispatch Administration has its own Administration section (out of the Dispatch menu).
  ['Administration', [['Dispatch Administration', 'admin.html', 'gear'], ['Operational Assignments', 'ops.html', 'people'], ['Print Layouts', 'print.html', 'day'], ['Dispatch Settings', 'settings.html', 'gear']]],
  // The plant side (Joe 10/10): Plant Operations opens the Manager Center cards; the menu lists the cards in the same order,
  // and a card with more than one area opens its screens beside it. A section with one screen is a plain link.
  ['Send Report', [['Send Current Report', 'manager.html?report=1', 'star']]],
  ['Yard Checks', [['Yard Checks', 'yard.html', 'yard-checks.webp']]],
  ['Plant Operations Scheduler', [['Plant Operations Scheduler', 'scheduler.html', 'week']]],
  ['Plant Distribution Departments', [['Plant Departments', 'plant.html', 'factory'], ['Loadout Center', 'loadout.html', 'load'], ['Unloading & Washing', 'unloading.html', 'unload'], ['Product Returns', 'returns.html', 'returns'], ['Truck Washing', 'washing.html', 'wash'], ['Trailer Assignments', 'trailers.html', 'load']]],
  ['Quality Checks', [['Quality Checks', 'quality.html', 'production.webp']]],
  ['Cooler Temperature', [['Cooler Temperature', 'temps.html', 'temperatures.webp']]],
  ['Shift Notes', [['Shift Notes', 'shiftnotes.html', 'alert']]]
];
// Joe 10/10: Home is the old app's icon launcher, one big picture per side; tapping one opens that side, and the menu then
// lists only that side's screens. A screen listed on two sides stays on the side it was opened from.
export const SIDES = [
  { key: 'distribution', name: 'Route Distribution', home: 'distribution.html', pic: 'distribution-truck-v1-560.webp', note: 'Dispatch, weekly schedule, drivers, reports and administration', sections: ['Dispatch', 'Drivers', 'Manager Reports', 'Overall', 'Administration'] },
  { key: 'plant', name: 'Plant Operations', home: 'manager.html', pic: 'plant-building-v1-560.webp', note: 'Loading, unloading, washing, returns, yard checks, shift notes and reports', sections: ['Send Report', 'Yard Checks', 'Plant Operations Scheduler', 'Plant Distribution Departments', 'Quality Checks', 'Cooler Temperature', 'Shift Notes'] },
  { key: 'fleet', name: 'Fleet & Maintenance', home: 'maint.html', pic: 'maintenance-tractor-v1-560.webp', note: 'Equipment, issues, garage work orders and fleet service', sections: ['Equipment'] }
];
const pageOf = (href) => String(href).split(/[?#]/)[0];
// Pages opened from inside a side (not from its menu) that still belong to it, e.g. Plant Reports from a bookmark or the TV.
const SIDE_PAGES = { plant: ['reports.html'] };
const sideHas = (side, page) => page === side.home || (SIDE_PAGES[side.key] || []).indexOf(page) >= 0 || MENU.some(([g, items]) => side.sections.indexOf(g) >= 0 && items.some(([, href]) => pageOf(href) === page));
export function sideFor(page) {
  // Home, the all-plants overview and the Administration Center sit above the three sides: their menu lists the sides.
  if (!page || ['index.html', 'company.html', 'administration.html'].indexOf(page) >= 0) return null;
  let last = '';
  try { last = sessionStorage.getItem('udSide') || ''; } catch (e) { /* no storage */ }
  const kept = SIDES.find(s => s.key === last);
  const side = (kept && sideHas(kept, page)) ? kept : SIDES.find(s => sideHas(s, page)) || kept || SIDES[0];
  try { sessionStorage.setItem('udSide', side.key); } catch (e) { /* no storage */ }
  return side;
}
// The plants, as on the Operations Overview; someone sees only the plants they may (known once the Users list is read).
const PLANT_LIST = () => (window.UDLogic && window.UDLogic.PLANTS) || [{ id: 'fac_uniontown', name: 'Uniontown', status: 'ACTIVE' }, { id: 'fac_charleston', name: 'Charleston', status: 'PLANNED' }, { id: 'fac_martins_ferry', name: 'Martins Ferry', status: 'PLANNED' }];
function limitPlants() {
  let allowed = null;
  try { allowed = JSON.parse(sessionStorage.getItem('udPlants') || 'null'); } catch (e) { /* no storage */ }
  if (!Array.isArray(allowed)) return;
  document.querySelectorAll('.side-plant[data-plant], .side-flyouts a[data-plant]').forEach(el => { el.hidden = allowed.indexOf(el.dataset.plant) < 0; });
}
function addSideMenu() {
  const screen = document.getElementById('screen'), bar = screen && screen.querySelector('.topbar');
  if (!bar || document.body.classList.contains('phone') || screen.querySelector('.sidemenu')) return;
  const here = (location.pathname.split('/').pop() || 'index.html');
  // Joe 10/10 evening: the menu is words only, on every page (no pictures or icons).
  const svg = () => '';
  const nav = document.createElement('nav');
  nav.className = 'sidemenu';
  nav.setAttribute('aria-label', 'Screens');
  // Joe 10/9: the menu lists only the sections; hovering (or tapping) a section opens its screens beside it.
  // Joe 10/10: the United Dairy icon library wherever a picture fits; line icons where none does.
  const SECTION_ICON = { Dispatch: 'distribution-truck-v1-560.webp', Drivers: 'people', Equipment: 'maintenance-tractor-v1-560.webp', 'Manager Reports': 'star', Overall: 'check', Administration: 'gear', 'Send Report': 'star', 'Yard Checks': 'yard-checks.webp', 'Plant Operations Scheduler': 'week', 'Plant Distribution Departments': 'factory', 'Quality Checks': 'production.webp', 'Cooler Temperature': 'temperatures.webp', 'Shift Notes': 'alert' };
  const link = ([label, href, icon]) => {
    const ext = /^https:/.test(href);
    return '<a href="' + href + '"' + (ext ? ' class="ext" title="' + label + ' (opens the current app in this window)"' : ' title="' + label + '"' + (href === here ? ' class="on" aria-current="page"' : '')) +
      '>' + svg(icon) + '<span>' + label + '</span>' + (ext ? '<i aria-hidden="true">&#8599;</i>' : '') + '</a>';
  };
  const side = sideFor(here), groups = side ? MENU.filter(([g]) => side.sections.indexOf(g) >= 0) : [];
  // Joe 10/10 evening: Back and Home sit in the header, not in the menu. The main screen (the all-plants Operations Overview)
  // lists only the plants; each plant opens its Plant Operations, Route Distribution and Fleet & Maintenance beside it.
  // A plant's home lists its three sides; a side shows its name (back to its first page), then only its own sections.
  // A side with one section lists its screens straight in the menu. Administration is a header button, not a menu item.
  const sideLink = (s, href) => link([s.name, href || s.home, s.pic]).replace('<a ', '<a data-side="' + s.key + '" ');
  const plantSec = (p) => {
    const live = p.status === 'ACTIVE', soon = 'soon.html?what=plant-' + p.id.replace(/^fac_/, '');
    const order = ['plant', 'distribution', 'fleet'].map(k => SIDES.find(s => s.key === k));
    return '<div class="side-sec side-plant" data-plant="' + p.id + '"><button type="button" class="side-sec-btn" aria-haspopup="true" aria-expanded="false" title="' + p.name + '">' +
      svg('plant-building-v1-560.webp') + '<span>' + p.name + '</span><i aria-hidden="true">&#9656;</i></button>' +
      '<div class="flyout" role="menu"><div class="flyout-title">' + p.name + '</div>' +
      order.map(s => sideLink(s, live ? s.home : soon).replace('<a ', '<a data-plant="' + p.id + '" ')).join('') + '</div></div>';
  };
  const top = here === 'company.html' ? PLANT_LIST().map(plantSec).join('') : !side ? SIDES.map(s => sideLink(s)).join('') :
    sideLink(side).replace(/class="on"/, '').replace('<a ', '<a class="side-name' + (here === side.home ? ' on' : '') + '" ');
  nav.innerHTML = '<button type="button" class="side-toggle" aria-label="Fold or open the menu" title="Fold or open the menu">&#9776;</button>' + top +
    (groups.length === 1 ? groups[0][1].filter(([, href]) => href !== side.home).map(link).join('') : groups.map(([group, items]) => !group ? '' : items.length === 1 ? link([group, items[0][1], SECTION_ICON[group] || items[0][2]]) :
      '<div class="side-sec' + (items.some(([, href]) => pageOf(href) === here) ? ' on' : '') + '"><button type="button" class="side-sec-btn" aria-haspopup="true" aria-expanded="false" title="' + group + '">' +
      svg(SECTION_ICON[group] || items[0][2]) + '<span>' + group + '</span><i aria-hidden="true">&#9656;</i></button>' +
      '<div class="flyout" role="menu"><div class="flyout-title">' + group + '</div>' + items.map(link).join('') + '</div></div>').join(''));
  // Joe 10/10: the fly-outs live in their own layer on the page, not inside the menu, so no screen, table or pop-up can draw over them.
  const layer = document.createElement('nav');
  layer.className = 'side-flyouts';
  layer.setAttribute('aria-label', 'Screens in this section');
  document.body.appendChild(layer);
  [nav, layer].forEach(el => el.addEventListener('click', e => {
    const a = e.target.closest('a[data-side]');
    if (!a) return;
    try { sessionStorage.setItem('udSide', a.dataset.side); if (a.dataset.plant) sessionStorage.setItem('udPlant', a.dataset.plant); } catch (x) { /* no storage */ }
  }));
  limitPlants();
  const flyOf = (sec) => sec._fly;
  nav.querySelectorAll('.side-sec').forEach(sec => { sec._fly = sec.querySelector('.flyout'); sec._fly._sec = sec; layer.appendChild(sec._fly); });
  const shut = (x) => { x.classList.remove('open'); flyOf(x).classList.remove('open'); x.querySelector('.side-sec-btn').setAttribute('aria-expanded', 'false'); };
  const close = (except) => nav.querySelectorAll('.side-sec.open').forEach(x => { if (x !== except) shut(x); });
  const openSec = (sec) => {
    close(sec);
    const r = sec.getBoundingClientRect(), fly = flyOf(sec);
    fly.style.left = nav.getBoundingClientRect().right + 'px';
    fly.style.top = Math.max(8, r.top) + 'px';
    sec.classList.add('open');
    fly.classList.add('open');
    sec.querySelector('.side-sec-btn').setAttribute('aria-expanded', 'true');
    const h = fly.offsetHeight;
    if (r.top + h > window.innerHeight - 8) fly.style.top = Math.max(8, window.innerHeight - h - 8) + 'px';
  };
  nav.querySelectorAll('.side-sec').forEach(sec => {
    let timer = null, hoverAt = 0;
    const later = () => { clearTimeout(timer); timer = setTimeout(() => shut(sec), 180); };
    // A tap fires mouseenter just before click: that click keeps the fly-out open instead of closing it.
    sec.addEventListener('mouseenter', () => { clearTimeout(timer); if (!sec.classList.contains('open')) { openSec(sec); hoverAt = Date.now(); } });
    sec.addEventListener('mouseleave', later);
    flyOf(sec).addEventListener('mouseenter', () => clearTimeout(timer));
    flyOf(sec).addEventListener('mouseleave', later);
    sec.querySelector('.side-sec-btn').addEventListener('click', e => { e.stopPropagation(); if (sec.classList.contains('open') && Date.now() - hoverAt > 400) close(); else openSec(sec); });
  });
  document.addEventListener('click', e => { if (!e.target.closest('.side-sec, .side-flyouts')) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  const wrap = document.createElement('div'), main = document.createElement('div');
  wrap.className = 'side-wrap'; main.className = 'side-main';
  [...screen.children].filter(c => c !== bar).forEach(c => main.appendChild(c));
  wrap.append(nav, main);
  screen.appendChild(wrap);
  document.body.classList.add('has-side');
  // Joe 10/10: the menu stays a slim strip of icons until the mouse is over it (or a tablet taps it), then opens over the
  // screen without moving it; leaving it folds it again. A section's screens still open beside it. The menu button pins it
  // open (remembered on this computer) and folds it again.
  let pinned = false, timer = null, tapped = false;
  try { pinned = localStorage.getItem('udSidePinned') === '1'; } catch (e) { /* no storage */ }
  const peek = (open) => { document.body.classList.toggle('side-open', open); document.body.classList.toggle('side-folded', !open); };
  const pin = (p) => { pinned = p; document.body.classList.toggle('side-rail', !p); document.body.classList.toggle('side-pinned', p); peek(p); };
  pin(pinned);
  const inside = () => { clearTimeout(timer); if (!pinned) peek(true); };
  const outside = () => { clearTimeout(timer); if (!pinned) timer = setTimeout(() => { peek(false); close(); }, 250); };
  [nav, layer].forEach(el => { el.addEventListener('mouseenter', inside); el.addEventListener('mouseleave', outside); });
  // A tap on the folded strip opens it first; the next tap picks the screen.
  // (A tap's pointerdown comes before the mouse events a tablet makes up, so the strip is still folded here.)
  nav.addEventListener('pointerdown', e => { tapped = e.pointerType !== 'mouse' && !pinned && !document.body.classList.contains('side-open'); }, true);
  nav.addEventListener('click', e => {
    if (tapped && e.target.closest('a')) { e.preventDefault(); e.stopPropagation(); peek(true); }
    tapped = false;
  }, true);
  nav.querySelector('.side-toggle').onclick = () => {
    pin(!pinned);
    try { localStorage.setItem('udSidePinned', pinned ? '1' : '0'); } catch (e) { /* no storage */ }
    window.dispatchEvent(new Event('resize'));
  };
  main.addEventListener('click', () => { if (!pinned) { peek(false); close(); } });
  // Joe 10/10: a menu click always opens the screen fresh on its first view (first tab, today, this week), even when only the
  // part after # differs from the screen already open.
  [nav, layer].forEach(el => el.addEventListener('click', e => {
    const a = e.defaultPrevented ? null : e.target.closest('a[href]');
    if (!a || a.target || a.origin !== location.origin || a.pathname !== location.pathname || a.search !== location.search) return;
    e.preventDefault();
    location.href = a.href;
    location.reload();
  }));
}
addSideMenu();
// The header's second line names the side the screen is on (just United Dairy above the sides).
(function headerSide() {
  const small = document.querySelector('#screen > .topbar .brand small');
  if (!small || !document.body.classList.contains('has-side')) return;
  const side = sideFor(location.pathname.split('/').pop() || 'index.html');
  small.innerHTML = 'UNITED DAIRY' + (side ? ' &middot; ' + side.name.toUpperCase() : '');
})();
/* Joe 10/10: "move the action buttons all in a line up above". Anything a screen marks data-top (a button, or a whole action or
   filter row, even one the screen fills later) joins one row in the screen's top line: buttons first, all the same size, and
   filters (pickers, chips, search boxes) to their right. A row that belongs to one view shows only while that view does. */
export function buttonsToTop() {
  const head = document.querySelector('#screen .head'), marked = [...document.querySelectorAll('#screen [data-top]')].filter(e => !head || !head.contains(e) || !e.closest('.actions.in-head.top-row'));
  if (!head || !marked.length) return;
  let row = head.querySelector('.actions.in-head.top-row');
  if (!row) { row = document.createElement('div'); row.className = 'actions in-head top-row'; head.appendChild(row); }
  marked.forEach(e => {
    const view = e.parentElement && e.parentElement.closest('.view[id], section[id]');
    if (e.classList.contains('actions') || e.id === 'bar' || e.children.length && e.tagName === 'DIV' && !e.classList.contains('chips')) e.classList.add('top-part');
    row.appendChild(e);
    if (view) { const sync = () => { e.hidden = view.hidden; }; sync(); new MutationObserver(sync).observe(view, { attributes: true, attributeFilter: ['hidden'] }); }
  });
}
buttonsToTop();
/* Polish item 1 (Joe 10/11): the top buttons keep their words on one line. They stay all the same size: every button takes the
   width of the longest one on that screen (measured once the words are drawn, and again when a button or the window changes). */
export function evenTopButtons() {
  const head = document.querySelector('#screen .head');
  if (!head) return;
  const btns = [...head.querySelectorAll('.actions button, .actions a.button')].filter(b => !b.closest('.chips, .seg, .stepper, .tabs') && !/^(prev|next)$/.test(b.id));
  head.style.removeProperty('--top-btn-w');
  const widths = btns.map(b => b.getBoundingClientRect().width).filter(w => w > 0);
  if (!widths.length) return;
  head.style.setProperty('--top-btn-w', Math.ceil(Math.max(...widths)) + 'px');
  // Where the window is too narrow for equal buttons in one row (Weekly on a laptop), each button keeps its own width instead.
  const right = Math.min(head.getBoundingClientRect().right, document.documentElement.clientWidth) + 1;
  const tops = new Set(btns.map(b => Math.round(b.getBoundingClientRect().top)));
  if (tops.size > 1 || btns.some(b => b.getBoundingClientRect().right > right)) head.style.removeProperty('--top-btn-w');
}
(() => {
  const head = document.querySelector('#screen .head');
  if (!head) return;
  let queued = false;
  const again = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; evenTopButtons(); }); };
  again();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(again);
  new MutationObserver(again).observe(head, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class'] });
  window.addEventListener('resize', again);
  // The screen shows only after sign-in; measure again once the top line has a size.
  if (window.ResizeObserver) new ResizeObserver(again).observe(head);
})();

// One look on every screen (Joe 10/10): each screen title starts with its picture from the United Dairy icon library
// (img/library), or with its line icon in the same tile where no picture fits.
const PAGE_ICON = {
  // Joe 10/11: Daily Dispatch has no title picture, so its boxes sit further left; Weekly matches it (polish 21). The other
  // screens use line drawings instead of the truck, tractor and building photos, so every title reads the same way.
  'routes.html': 'road', 'routeweek.html': 'week', 'admin.html': 'gear', 'ops.html': 'swap', 'print.html': 'day', 'settings.html': 'gear', 'soon.html': 'factory', 'otr.html': 'road',
  'gps.html': 'pin', 'scorecard.html': 'star',
  'equipment.html': 'truck', 'maint.html': 'wrench', 'issues.html': 'issue',
  'garage.html': 'wrench', 'fleet.html': 'truck',
  'plant.html': 'factory', 'loadout.html': 'case-v1.webp', 'unloading.html': 'tanker-v1.webp', 'returns.html': 'box-v1.webp', 'washing.html': 'wash', 'scheduler.html': 'week', 'yard.html': 'yard-checks.webp', 'quality.html': 'production.webp', 'products.html': 'production.webp', 'mocreo.html': 'temperatures.webp', 'shiftnotes.html': 'alert', 'temps.html': 'temperatures.webp', 'manager.html': 'star',
  'garage-station.html': 'wrench', 'driver-station.html': 'truck', 'trailers.html': 'truck', 'plant-station.html': 'factory', 'phone-screens.html': 'people',
  'drivers.html': 'people', 'template.html': 'week', 'vacations.html': 'vacation', 'checkins.html': 'check', 'conflicts.html': 'alert'
};
(function addTitleIcon() {
  const here = location.pathname.split('/').pop() || 'index.html', k = PAGE_ICON[here], h1 = document.querySelector('#screen .head .title h1, #screen .head h1');
  if (!k || !h1 || h1.querySelector('.title-pic')) return;
  const box = document.createElement('span');
  box.className = 'title-pic';
  box.setAttribute('aria-hidden', 'true');
  box.innerHTML = /\.webp$/.test(k) ? '<img src="img/library/' + k + '" alt="">' : '<svg viewBox="0 0 24 24">' + ICON[k] + '</svg>';
  h1.prepend(box);
})();

// Moving between screens feels like one app (Joe 10/9): Chrome gets each screen ready while the pointer rests on its menu
// link, so a click shows it at once. Pages of the current app and the drivers' phone page are left out.
// Standing rule (Joe, 10/9): every link opens in this window; a link that asks for a new tab is opened here instead.
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a[target]');
  if (a && a.target !== '_self') a.removeAttribute('target');
}, true);

// Polish 16: when the tablet or computer loses its connection a yellow bar says so at the top, so nobody thinks a press was
// sent. Saves go to the server, so they wait for the signal; the bar goes away by itself when it is back.
(function connectionBar() {
  if (EMBED) return;
  let bar = null;
  const show = () => {
    if (navigator.onLine) { if (bar) bar.hidden = true; return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'offline-bar'; bar.setAttribute('role', 'status');
      bar.textContent = 'No connection. Changes will not save until it is back; press again once this bar goes away.';
      document.body.prepend(bar);
    }
    bar.hidden = false;
  };
  addEventListener('online', show); addEventListener('offline', show); show();
})();

// Polish 19: a line cut off with "..." shows the whole line when the pointer rests on it.
document.addEventListener('mouseover', e => {
  const el = e.target;
  if (!el || el.nodeType !== 1 || el.title || el.scrollWidth <= el.clientWidth + 1) return;
  if (getComputedStyle(el).textOverflow !== 'ellipsis') return;
  const text = el.textContent.trim();
  if (text) el.title = text;
}, { passive: true });

(function prerenderOnHover() {
  try {
    if (!(HTMLScriptElement.supports && HTMLScriptElement.supports('speculationrules'))) return;
    const rules = document.createElement('script');
    rules.type = 'speculationrules';
    rules.textContent = JSON.stringify({ prerender: [{ source: 'document', where: { and: [{ href_matches: '/*.html' }, { not: { href_matches: '/route.html' } }] }, eagerness: 'moderate' }] });
    document.head.appendChild(rules);
  } catch (e) { /* not supported */ }
})();

/* Back goes one step: it first closes what is open on this screen (a pop-up, an opened driver,
   a second tab or view); with nothing open, a main screen goes Home and any other page goes to
   the page it was opened from. A screen can add its own step with window.udBack = () => true/false. */
export function goBack() {
  if (typeof window.udBack === 'function' && window.udBack()) return;
  const back = document.getElementById('modal-back');
  if (back && !back.hidden) { back.click(); return; }
  const view = document.getElementById('view-select');
  if (view && view.selectedIndex > 0) { view.selectedIndex = 0; view.dispatchEvent(new Event('change', { bubbles: true })); return; }
  const tabs = [...document.querySelectorAll('#screen [role="tab"]')];
  if (tabs.length && tabs[0].getAttribute('aria-selected') !== 'true') { tabs[0].click(); return; }
  const here = location.pathname.split('/').pop() || 'index.html';
  const main = MENU.some(([, items]) => items.some(([, href]) => href === here));
  let fromHere = false;
  try { fromHere = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch (e) { /* no referrer */ }
  // Up one level: a side's screen goes to that side's first page, and the side's first page goes Home.
  const side = sideFor(here), up = side && here !== side.home ? side.home : here === 'index.html' && multiPlant() ? 'company.html' : 'index.html';
  if ((here === 'company.html' || (!main && side && here !== side.home)) && fromHere && history.length > 1) history.back();
  else location.href = up;
}
// Joe 10/10: every screen has a Back button and a Home button. Joe 10/10 evening: they sit in the header beside the logo,
// never in the menu (built here, once). Every screen's header also has the Administration button (Administrators only).
// Joe 10/10: someone who may see more than one plant (an Administrator, or a plant list of "*") starts on the all-plants
// overview and picks a plant; a plant's home then has Back to the overview. Known once the Users list is read.
function multiPlant() { try { return sessionStorage.getItem('udMulti') === '1'; } catch (e) { return false; } }
function headerButton(id, icon, label, title) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'hdr-btn'; b.id = id; b.title = title;
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[icon] + '</svg><span>' + label + '</span>';
  return b;
}
function backButton() {
  const b = headerButton('go-back', 'back', 'Back', 'Back one screen');
  b.onclick = goBack;
  return b;
}
function plantHomeBack() {
  const here = location.pathname.split('/').pop() || 'index.html', home = document.getElementById('go-home');
  if (here === 'index.html' && home && multiPlant() && !document.getElementById('go-back')) home.before(backButton());
}
function noteAccess(person) {
  const L = window.UDLogic;
  if (!L || !L.plantsFor) return;
  try {
    sessionStorage.setItem('udMulti', L.plantsFor(person).length > 1 ? '1' : '0');
    sessionStorage.setItem('udAdmin', L.isAdmin(person) ? '1' : '0');
    sessionStorage.setItem('udPlants', JSON.stringify(L.plantsFor(person)));
  } catch (e) { /* no storage */ }
  document.body.classList.toggle('is-admin', L.isAdmin(person));
  plantHomeBack();
  limitPlants();
}
// The Administration button shows only to Administrators (the screens check again).
try { if (sessionStorage.getItem('udAdmin') === '1') document.body.classList.add('is-admin'); } catch (e) { /* no storage */ }
(function addBack() {
  const here = location.pathname.split('/').pop() || 'index.html';
  const bar = document.querySelector('#screen > .topbar'), brand = bar && bar.querySelector('.brand');
  if (!brand || !document.body.classList.contains('has-side') || document.getElementById('go-home')) return;
  const nav = document.createElement('div');
  nav.className = 'hdr-nav';
  const h = headerButton('go-home', 'home', 'Home', 'Home');
  h.onclick = () => { location.href = 'index.html'; };
  // The main screen (all plants) and a plant's home are the top: no Back there (a plant's home gets Back to the overview below).
  if (['index.html', 'company.html'].indexOf(here) < 0) nav.append(backButton());
  nav.append(h);
  brand.after(nav);
  if (here === 'index.html') plantHomeBack();
  if (here !== 'administration.html') {
    const adm = headerButton('go-admin', 'gear', 'Administration', 'Administration');
    adm.classList.add('hdr-admin');
    adm.onclick = () => { location.href = 'administration.html'; };
    const who = bar.querySelector('.who, #signout');
    if (who) who.before(adm); else bar.append(adm);
  }
})();
// Joe 10/10: on every screen with cards, clicking anywhere on a card opens that card's screen in its first view, and clicking
// one line or number inside it opens that particular screen. A card carries data-card="page"; a line or number data-open="page"
// (real links and buttons inside keep their own job). Always this window.
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (e.target.closest('a[href], button, input, select, textarea, label')) return;
  const t = e.target.closest('[data-open], [data-card]');
  if (t) location.href = t.dataset.open || t.dataset.card;
});
// The same from the keyboard: cards and their lines can be reached with Tab and opened with Enter.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.target.matches('a[href], button, input, select, textarea')) return;
  const t = e.target.matches('[data-open], [data-card]') ? e.target : null;
  if (t) { e.preventDefault(); location.href = t.dataset.open || t.dataset.card; }
});
let markCards = 0;
const tabCards = () => { markCards = 0; document.querySelectorAll('[data-open]:not([tabindex]), [data-card]:not([tabindex])').forEach(el => { el.tabIndex = 0; if (!el.getAttribute('role')) el.setAttribute('role', 'link'); }); };
new MutationObserver(() => { if (!markCards) markCards = requestAnimationFrame(tabCards); }).observe(document.documentElement, { childList: true, subtree: true });
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

async function firebaseConfig() {
  // Firebase Hosting serves the project's own settings here, so no project ID is written into the code.
  if (LOCAL) return { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-ud-distribution', appId: 'demo-app' };
  const res = await fetch('/__/firebase/init.json');
  return res.json();
}

let services;
export async function start() {
  if (services) return services;
  const app = initializeApp(await firebaseConfig());
  const auth = getAuth(app), db = getFirestore(app), functions = getFunctions(app, 'us-east4');
  if (LOCAL) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  }
  services = { app, auth, db, functions };
  return services;
}

export function isUnitedDairy(user) {
  return !!(user && user.emailVerified && String(user.email || '').toLowerCase().endsWith('@' + DOMAIN));
}

// Shows the sign-in card until a United Dairy account is signed in, then calls ready(user).
export async function requireSignIn(ready) {
  // Moving between screens (Joe 10/9): someone already checked in this tab sees the screen at once, not a blank page while
  // the sign-in and the Users list are checked again; the check still runs and signs out anyone no longer active.
  const gate = document.getElementById('signin'), screen = document.getElementById('screen');
  let known = '';
  try { known = sessionStorage.getItem('udActive') || ''; } catch (e) { /* no storage */ }
  if (known) { gate.hidden = true; screen.hidden = false; }
  const { auth } = await start();
  const showWho = (user) => {
    const who = document.getElementById('who');
    if (!who) return;
    const parts = String(user.displayName || '').trim().split(/\s+/).filter(Boolean);
    who.textContent = (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || user.email || '?').slice(0, 2)).toUpperCase();
    who.title = user.email || '';
    who.classList.add('initials');
  };
  const remember = (email) => { try { if (email) sessionStorage.setItem('udActive', email); else sessionStorage.removeItem('udActive'); } catch (e) { /* no storage */ } };
  onAuthStateChanged(auth, async (user) => {
    if (user && !isUnitedDairy(user)) {
      remember('');
      await signOut(auth);
      showError('Only United Dairy Google accounts can use this app. You were signed out.');
      return;
    }
    if (!user) { remember(''); gate.hidden = false; screen.hidden = true; return; }
    const email = String(user.email).toLowerCase();
    const early = known === email;
    // Administration > Start Plant Fresh From Today: loads from before that day stop showing as prior-day work (plant-core.js).
    // Listened to before the screen's own listeners, so the screen draws with it.
    if (!window.UDPlantStartWatch) { window.UDPlantStartWatch = true; start().then(({ db }) => onSnapshot(doc(db, 'config', 'app'), s => { window.UDPlantStart = ((s.data() || {}).plantStart || {}).date || ''; }, () => { window.UDPlantStartWatch = false; })); }
    if (early) { gate.hidden = true; screen.hidden = false; showWho(user); ready(user); }
    // The database shows dispatch data only to people ACTIVE in USERS_MASTER; say so plainly instead of a blank screen.
    const { db } = await start();
    const entry = await getDoc(doc(db, 'users', email)).catch(() => null);
    if (!entry || !entry.exists() || entry.data().status !== 'ACTIVE') {
      remember('');
      screen.hidden = true;
      await signOut(auth);
      showError(user.email + ' is not an active user in the Users list. Ask an administrator to add you.');
      return;
    }
    remember(email);
    noteAccess(Object.assign({ email }, entry.data()));
    if (early) return;
    gate.hidden = true;
    screen.hidden = false;
    showWho(user);
    ready(user);
  });
  document.getElementById('signin-button').addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ hd: DOMAIN, prompt: 'select_account' });
    try { await signInWithPopup(auth, provider); } catch (e) { showError('Sign-in did not finish: ' + (e.message || e)); }
  });
  const out = document.getElementById('signout');
  if (out) out.addEventListener('click', () => signOut(auth));
  // Local testing only: the test database accepts a made-up Google sign-in (?testEmail=someone@uniteddairy.com).
  const testEmail = LOCAL && new URLSearchParams(location.search).get('testEmail');
  if (testEmail && !auth.currentUser) {
    const token = JSON.stringify({ sub: 'test-' + testEmail, email: testEmail, email_verified: true });
    await signInWithCredential(auth, GoogleAuthProvider.credential(token)).catch(e => showError(String(e.message || e)));
  }
}

// Every save is one call. A fresh requestId makes a retry safe: the server saves it once.
// "Saving... / Saved" beside the screen's title (Daily's sign), on every screen that saves (polish 15). Screens that use
// edit.js show it from there instead, around their own saves.
let pillTimer = null, saving = 0, saveFailed = false;
export function savePill(state) {
  let pill = document.getElementById('save-pill');
  if (!pill) {
    const title = document.querySelector('.head .title h1');
    if (!title) return;
    pill = document.createElement('span');
    pill.id = 'save-pill';
    pill.setAttribute('role', 'status');
    pill.style.cssText = 'display:inline-block;margin-left:12px;padding:2px 12px;border-radius:999px;font:800 16px/1.25 Arial,sans-serif;letter-spacing:0;vertical-align:middle;white-space:nowrap';
    title.appendChild(pill); // on the title's line, without changing the header's height
  }
  const look = { saving: ['Saving\u2026', '#fff4d6', '#8a5a00'], saved: ['Saved \u2713', '#dff4e6', '#126334'], failed: ['Not saved', '#fde8e6', '#b3261e'] }[state];
  pill.textContent = look[0];
  pill.style.background = look[1];
  pill.style.color = look[2];
  pill.hidden = false;
  clearTimeout(pillTimer);
  if (state === 'saved') pillTimer = setTimeout(() => { pill.hidden = true; }, 4000);
}
export async function save(action, fields) {
  if (window.UD_EDIT_PILL) return callServer('save', Object.assign({ action }, fields));
  if (!saving) saveFailed = false;
  saving++; savePill('saving');
  try {
    const out = await callServer('save', Object.assign({ action }, fields));
    saving--; if (!saving) savePill(saveFailed ? 'failed' : 'saved');
    return out;
  } catch (e) {
    saving--; saveFailed = true; savePill(saving ? 'saving' : 'failed');
    throw e;
  }
}

// A failed call in plain words with the next step; the server's own messages (already plain) are kept.
export function friendlyError(e) {
  const code = String(e && e.code || '').replace(/^functions\/|^firestore\//, ''), msg = String(e && e.message || e || '');
  if (code === 'unavailable' || /network|Failed to fetch|offline/i.test(msg)) return 'No connection to the server. Check the network and try again; nothing was saved.';
  if (code === 'deadline-exceeded') return 'The server took too long to answer. Try again; if it did save, the screen will show it in a moment.';
  if (code === 'unauthenticated') return 'You are signed out. Sign in again and try once more.';
  if (code === 'permission-denied' && /insufficient permissions/i.test(msg)) return 'You do not have access to this. Ask an administrator to add it to your role.';
  if (code === 'internal' && /^internal$/i.test(msg)) return 'Something went wrong on the server. Try again; if it keeps happening, tell an administrator.';
  return msg;
}

// Any other server call that changes something (the per-screen switch): also one call with its own requestId.
export async function callServer(name, fields) {
  const { functions } = await start();
  const requestId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/[^A-Za-z0-9_-]/g, '');
  const result = await httpsCallable(functions, name)(Object.assign({ requestId }, fields));
  return result.data;
}

// Errors are the only messages the screens show (no status bars).
export function showError(text) {
  if (text && typeof text === 'object') text = friendlyError(text);
  ['error', 'signin-error'].forEach(id => {
    const box = document.getElementById(id);
    if (!box) return;
    box.textContent = text;
    box.hidden = !text;
  });
}

// Sizes rows and type to the window so the whole list fits on one page with no scrolling.
export function fitToWindow(lineCount, gap) {
  const sheet = document.querySelector('.sheet');
  if (!sheet) return;
  // Joe 10/10: rows never shrink below readable print (16px text). A busy day scrolls inside the table instead.
  sheet.classList.remove('fit-scroll');
  sheet.style.maxHeight = '';
  const top = sheet.getBoundingClientRect().top;
  const footer = document.querySelector('.footer');
  const footerH = footer ? footer.offsetHeight : 0;
  // gap: space between rows (Daily's card rows), taken from the room first.
  const room = window.innerHeight - top - footerH - 8 - (gap || 0) * (Math.max(lineCount, 1) + 2);
  const lines = Math.max(lineCount, 1) + 1.25; // the header row is a little taller than a line
  const apply = (row) => {
    document.documentElement.style.setProperty('--row', row + 'px');
    document.documentElement.style.setProperty('--font', Math.max(FIT_FONT_MIN, Math.min(16, Math.round(row * 0.5))) + 'px');
    // Tall enough rows show a second line (the Weekly grid puts truck / trailer under the driver).
    document.body.classList.toggle('roomy', row >= 34);
  };
  let row = Math.max(FIT_ROW_MIN, Math.min(44, Math.floor(room / lines)));
  apply(row);
  // Borders and the RUNS tags add a little to each line; step down until the page truly fits.
  // The page scrolls in the side-menu shell's content box when there is one, else the window.
  const box = sheet.closest('.side-main') || document.scrollingElement;
  const over = () => box.scrollHeight > box.clientHeight + 1 || document.scrollingElement.scrollHeight > window.innerHeight;
  while (row > FIT_ROW_MIN && over()) apply(--row);
  if (over()) {
    // Still too many lines at the smallest readable size: the table scrolls, its header stays put.
    sheet.classList.add('fit-scroll');
    sheet.style.maxHeight = Math.max(160, Math.min(window.innerHeight, box.getBoundingClientRect().bottom || window.innerHeight) - top - footerH - 8) + 'px';
  }
}
const FIT_ROW_MIN = 32, FIT_FONT_MIN = 16;

export function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Joe 10/11 (polish 6): one short date everywhere, like 10-8-26 (month-day-two-digit year, no leading zeros, no time).
// Takes a day key (2026-10-08), a time (ISO text, a number or a Date, read in plant time) or a sheet date (10/08/2026).
export function shortDay(v) {
  if (v == null || v === '') return '';
  let m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(String(v));
  if (m) return Number(m[2]) + '-' + Number(m[3]) + '-' + m[1].slice(2);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(v).trim());
  if (m) return Number(m[1]) + '-' + Number(m[2]) + '-' + m[3].slice(-2);
  const t = v instanceof Date ? v : new Date(typeof v === 'number' ? v : String(v));
  if (isNaN(t)) return String(v);
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: '2-digit', month: 'numeric', day: 'numeric' }).formatToParts(t);
  const g = (k) => (p.find(x => x.type === k) || {}).value;
  return g('month') + '-' + g('day') + '-' + g('year');
}
export function shortDate(key) { return shortDay(key); }
// A date with its time, like 10-8-26 1:20 PM, for stamps where the time matters (when a check or a change was made).
export function dateTimeText(v) { const d = shortDay(v instanceof Date || typeof v === 'number' ? v : new Date(v)), t = shortTime(v); return t ? d + ' ' + t : d; }
// The time alone, like 1:20 PM, in plant time.
export function shortTime(v) {
  const t = v instanceof Date ? v : new Date(v);
  return isNaN(t) ? '' : t.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
}

// Shrink to fit (Joe, 10/9): a table cell whose text is too long for it gets a little smaller print, so names and values are
// never cut off. Joe's later rule (10/10) is never to shrink table text to fit: it stops at 15px, and a cell that still does
// not fit wraps onto a second line (.fit-wrap) instead. Headers keep their size. Runs after every redraw and on resize.
const FIT_MIN = 15;
let fitQueued = false;
function tooWide(td) {
  // The text's laid-out width against the room inside the padding (a day cell keeps its padding for the arrow).
  const cs = getComputedStyle(td), room = td.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const r = document.createRange();
  r.selectNodeContents(td);
  if (r.getBoundingClientRect().width > room + 0.5 || td.scrollWidth > td.clientWidth + 1) return true;
  // A name cut short with "..." inside the cell (Weekly day cells) counts too.
  return [...td.children].some(el => {
    if (getComputedStyle(el).textOverflow !== 'ellipsis') return false;
    const inner = document.createRange();
    inner.selectNodeContents(el);
    return inner.getBoundingClientRect().width > el.getBoundingClientRect().width + 0.1;
  });
}
function fitCells() {
  fitQueued = false;
  const cells = [...document.querySelectorAll('tbody td')].filter(td => td.offsetParent && td.textContent.trim() && !td.querySelector('input, textarea, select, table') && !td.classList.contains('details-cell') && td.colSpan === 1);
  cells.forEach(td => { if (td.dataset.fit) { td.style.fontSize = ''; delete td.dataset.fit; } td.classList.remove('fit-wrap'); });
  let over = cells.filter(tooWide);
  const wrap = [];
  for (let pass = 0; over.length && pass < 8; pass++) {
    const sizes = over.map(td => parseFloat(getComputedStyle(td).fontSize));
    over = over.filter((td, i) => { if (sizes[i] <= FIT_MIN) { wrap.push(td); return false; } td.style.fontSize = Math.max(FIT_MIN, sizes[i] - 1) + 'px'; td.dataset.fit = '1'; return true; });
    over = over.filter(tooWide);
  }
  wrap.concat(over).forEach(td => td.classList.add('fit-wrap'));
}
function queueFit() { if (!fitQueued) { fitQueued = true; requestAnimationFrame(fitCells); } }
new MutationObserver(queueFit).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
window.addEventListener('resize', queueFit);
