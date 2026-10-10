/*
 * United Dairy Distribution app: what every screen shares.
 * Sign-in (United Dairy Google accounts only), the database connection, the one-call save, and sizing the
 * screen to the window so nothing ever scrolls.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithPopup, signInWithCredential, signOut, GoogleAuthProvider, connectAuthEmulator
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator, doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
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
});

// The menu on the left (Joe, 10/9: "the action buttons ... supposed to be a menu option to the left"), the same on every
// screen. A link marked with the small arrow still opens the current app in a new tab. On a laptop it folds to icons;
// the button at its top opens it.
const ICON = {
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
  ['Drivers', [['Drivers', 'drivers.html', 'people'], ['Driver Weekly Template (assign routes)', 'template.html', 'week'], ['Driver Assignment Board', 'weekly.html#board', 'people'], ['Vacation Schedule', 'vacations.html', 'vacation']]],
  // Joe 10/10: the maintenance side starts on the Fleet & Maintenance hub and branches out from there, as in the current app.
  // An icon name ending .webp is a picture from the United Dairy icon library (img/library).
  ['Equipment', [['Fleet & Maintenance', 'maint.html', 'maintenance-tractor-v1-560.webp'], ['Equipment', 'equipment.html', 'truck'], ['Equipment Issues', 'issues.html', 'issue'],
    ['Truck Issues', 'issues.html?kind=TRUCK', 'maintenance-tractor-v1-560.webp'], ['Trailer Issues', 'issues.html?kind=TRAILER', 'maintenance-trailer-v1-560.webp'],
    ['Fork Truck / Pallet Jack Issues', 'issues.html?kind=FORK_TRUCK', 'forklift-truck-v1-560.webp'], ['Garage Work Orders', 'garage.html', 'wrench'], ['Fleet Service', 'fleet.html', 'gear'],
    ['Garage Station', 'soon.html?what=garage-station', 'wrench'], ['Over the Road', 'otr.html', 'distribution-truck-v1-560.webp'], ['Trucks Today', 'soon.html?what=trucks-today', 'pin']]],
  ['GPS / Fleet', [['GPS Setup', 'gps.html', 'gear'], ['Trucks Today', 'soon.html?what=trucks-today', 'pin'], ['Driver Scorecard', 'scorecard.html', 'star']]],
  ['Reports', [['Driver Scorecard', 'scorecard.html', 'star'], ['Over the Road', 'otr.html', 'road']]],
  ['Overall', [['Driver Check-ins', 'checkins.html', 'check'], ['Sheet Conflicts', 'conflicts.html', 'alert']]],
  // Joe 10/10: Dispatch Administration has its own Administration section (out of the Dispatch menu).
  ['Administration', [['Dispatch Administration', 'admin.html', 'gear'], ['Operational Assignments', 'ops.html', 'people'], ['Print Layouts', 'print.html', 'day'], ['Dispatch Settings', 'settings.html', 'gear']]],
  // The plant side (Joe 10/10): sections like the Distribution side, each with its screens in the fly-out, as the current
  // app's Manager Menu groups them; no menu inside the screens.
  ['Departments', [['Plant Departments', 'plant.html', 'factory'], ['Loadout Center', 'loadout.html', 'load'], ['Unloading & Washing', 'unloading.html', 'unload'], ['Product Returns', 'returns.html', 'returns'], ['Truck Washing', 'washing.html', 'wash']]],
  ['Scheduler', [['Shipping', 'scheduler.html?lane=SHIPPING', 'week'], ['Receiving', 'scheduler.html?lane=RECEIVING', 'week']]],
  ['Yard Checks', [['Active Yard Queue', 'yard.html', 'yard-checks.webp'], ['24-Hour History', 'yard.html?view=history', 'yard-checks.webp']]],
  ['Quality', [['Production Line Status & Quality', 'quality.html', 'production.webp'], ['Quality History', 'quality.html?view=history', 'production.webp']]],
  ['Coolers', [['Manual Read', 'temps.html', 'temperatures.webp'], ['Status / Alerts', 'temps.html?view=alerts', 'temperatures.webp'], ['24-Hour History', 'temps.html?view=history', 'temperatures.webp']]],
  ['Shift Notes', [['Shift Handoff', 'shiftnotes.html', 'alert'], ['24-Hour History', 'shiftnotes.html?view=history', 'alert']]],
  ['Manager Center', [['Manager Center', 'manager.html', 'star'], ['Send Current Report', 'manager.html?report=1', 'star']]]
];
// Joe 10/10: Home is the old app's icon launcher, one big picture per side; tapping one opens that side, and the menu then
// lists only that side's screens. A screen listed on two sides stays on the side it was opened from.
export const SIDES = [
  { key: 'distribution', name: 'Route Distribution', home: 'distribution.html', pic: 'distribution-truck-v1-560.webp', note: 'Dispatch, weekly schedule, drivers, reports and administration', sections: ['Dispatch', 'Drivers', 'Reports', 'Overall', 'Administration'] },
  { key: 'plant', name: 'Plant Operations', home: 'plant.html', pic: 'plant-building-v1-560.webp', note: 'Loading, unloading, washing, returns, yard checks, shift notes and reports', sections: ['Departments', 'Scheduler', 'Yard Checks', 'Quality', 'Coolers', 'Shift Notes', 'Manager Center'] },
  { key: 'fleet', name: 'Fleet & Maintenance', home: 'maint.html', pic: 'maintenance-tractor-v1-560.webp', note: 'Equipment, issues, garage work orders, fleet service and GPS', sections: ['Equipment', 'GPS / Fleet'] }
];
const pageOf = (href) => String(href).split(/[?#]/)[0];
const sideHas = (side, page) => page === side.home || MENU.some(([g, items]) => side.sections.indexOf(g) >= 0 && items.some(([, href]) => pageOf(href) === page));
export function sideFor(page) {
  if (!page || page === 'index.html') return null;
  let last = '';
  try { last = sessionStorage.getItem('udSide') || ''; } catch (e) { /* no storage */ }
  const kept = SIDES.find(s => s.key === last);
  const side = (kept && sideHas(kept, page)) ? kept : SIDES.find(s => sideHas(s, page)) || kept || SIDES[0];
  try { sessionStorage.setItem('udSide', side.key); } catch (e) { /* no storage */ }
  return side;
}
function addSideMenu() {
  const screen = document.getElementById('screen'), bar = screen && screen.querySelector('.topbar');
  if (!bar || document.body.classList.contains('phone') || screen.querySelector('.sidemenu')) return;
  const here = (location.pathname.split('/').pop() || 'index.html');
  const svg = (k) => /\.webp$/.test(k) ? '<img class="lib-icon" src="img/library/' + k + '" alt="">' : '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[k] + '</svg>';
  const nav = document.createElement('nav');
  nav.className = 'sidemenu';
  nav.setAttribute('aria-label', 'Screens');
  // Joe 10/9: the menu lists only the sections; hovering (or tapping) a section opens its screens beside it.
  // Joe 10/10: the United Dairy icon library wherever a picture fits; line icons where none does.
  const SECTION_ICON = { 'GPS / Fleet': 'pin', Dispatch: 'distribution-truck-v1-560.webp', Drivers: 'people', Equipment: 'maintenance-tractor-v1-560.webp', Reports: 'star', Overall: 'check', Administration: 'gear', Departments: 'factory', Scheduler: 'week', 'Yard Checks': 'yard-checks.webp', Quality: 'production.webp', Coolers: 'temperatures.webp', 'Shift Notes': 'alert', 'Manager Center': 'star' };
  const link = ([label, href, icon]) => {
    const ext = /^https:/.test(href);
    return '<a href="' + href + '"' + (ext ? ' class="ext" title="' + label + ' (opens the current app in this window)"' : ' title="' + label + '"' + (href === here ? ' class="on" aria-current="page"' : '')) +
      '>' + svg(icon) + '<span>' + label + '</span>' + (ext ? '<i aria-hidden="true">&#8599;</i>' : '') + '</a>';
  };
  const side = sideFor(here), groups = side ? MENU.filter(([g]) => side.sections.indexOf(g) >= 0) : [];
  // Home lists the three sides; a side shows its name (back to its first page), then only its own sections. A side with one
  // section lists its screens straight in the menu.
  const top = link(MENU[0][1][0]) + (!side ? SIDES.map(s => link([s.name, s.home, s.pic]).replace('<a ', '<a data-side="' + s.key + '" ')).join('') :
    link([side.name, side.home, side.pic]).replace('<a ', '<a data-side="' + side.key + '" ').replace(/class="on"/, '').replace('<a ', '<a class="side-name' + (here === side.home ? ' on' : '') + '" '));
  nav.innerHTML = '<button type="button" class="side-toggle" aria-label="Fold or open the menu" title="Fold or open the menu">&#9776;</button>' + top +
    (groups.length === 1 ? groups[0][1].filter(([, href]) => href !== side.home).map(link).join('') : groups.map(([group, items]) => !group ? items.map(link).join('') :
      '<div class="side-sec' + (items.some(([, href]) => pageOf(href) === here) ? ' on' : '') + '"><button type="button" class="side-sec-btn" aria-haspopup="true" aria-expanded="false" title="' + group + '">' +
      svg(SECTION_ICON[group] || items[0][2]) + '<span>' + group + '</span><i aria-hidden="true">&#9656;</i></button>' +
      '<div class="flyout" role="menu"><div class="flyout-title">' + group + '</div>' + items.map(link).join('') + '</div></div>').join(''));
  nav.addEventListener('click', e => { const a = e.target.closest('a[data-side]'); if (a) try { sessionStorage.setItem('udSide', a.dataset.side); } catch (x) { /* no storage */ } });
  // Joe 10/10: the fly-outs live in their own layer on the page, not inside the menu, so no screen, table or pop-up can draw over them.
  const layer = document.createElement('nav');
  layer.className = 'side-flyouts';
  layer.setAttribute('aria-label', 'Screens in this section');
  document.body.appendChild(layer);
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
  // Wide screens fold the menu to icons and open it again; the choice is remembered on this computer.
  // Narrow screens keep it folded and open it over the page.
  const wide = () => window.matchMedia('(min-width: 1501px)').matches;
  try { if (localStorage.getItem('udSideFolded') === '1') document.body.classList.add('side-folded'); } catch (e) { /* no storage */ }
  nav.querySelector('.side-toggle').onclick = () => {
    if (!wide()) { document.body.classList.toggle('side-open'); return; }
    const folded = document.body.classList.toggle('side-folded');
    try { localStorage.setItem('udSideFolded', folded ? '1' : '0'); } catch (e) { /* no storage */ }
    window.dispatchEvent(new Event('resize'));
  };
  main.addEventListener('click', () => document.body.classList.remove('side-open'));
}
addSideMenu();
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

// One look on every screen (Joe 10/10): each screen title starts with its picture from the United Dairy icon library
// (img/library), or with its line icon in the same tile where no picture fits.
const PAGE_ICON = {
  'daily.html': 'distribution-truck-v1-560.webp', 'weekly.html': 'distribution-truck-v1-560.webp', 'routes.html': 'distribution-truck-v1-560.webp',
  'routeweek.html': 'distribution-truck-v1-560.webp', 'admin.html': 'distribution-truck-v1-560.webp', 'ops.html': 'distribution-truck-v1-560.webp', 'print.html': 'distribution-truck-v1-560.webp', 'settings.html': 'distribution-truck-v1-560.webp', 'soon.html': 'plant-building-v1-560.webp', 'otr.html': 'distribution-truck-v1-560.webp',
  'gps.html': 'distribution-truck-v1-560.webp', 'scorecard.html': 'distribution-truck-v1-560.webp',
  'equipment.html': 'maintenance-tractor-v1-560.webp', 'maint.html': 'maintenance-tractor-v1-560.webp', 'issues.html': 'maintenance-tractor-v1-560.webp',
  'garage.html': 'maintenance-tractor-v1-560.webp', 'fleet.html': 'maintenance-trailer-v1-560.webp',
  'plant.html': 'plant-building-v1-560.webp', 'loadout.html': 'case-v1.webp', 'unloading.html': 'tanker-v1.webp', 'returns.html': 'box-v1.webp', 'washing.html': 'wash', 'scheduler.html': 'distribution-truck-v1-560.webp', 'yard.html': 'yard-checks.webp', 'quality.html': 'production.webp', 'shiftnotes.html': 'alert', 'temps.html': 'temperatures.webp', 'manager.html': 'star',
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
  const side = sideFor(here), up = side && here !== side.home ? side.home : 'index.html';
  if (!main && side && here !== side.home && fromHere && history.length > 1) history.back();
  else location.href = up;
}
// Joe 10/10: every screen has a Back button and a Home button, in the same place at the top of the menu (built here, once).
(function addBack() {
  const here = location.pathname.split('/').pop() || 'index.html';
  const home = document.querySelector('.sidemenu a[href="index.html"]');
  if (!home) return;
  home.id = 'go-home';
  if (here === 'index.html') return;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'side-back'; b.id = 'go-back'; b.title = 'Back one screen';
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON.back + '</svg><span>Back</span>';
  b.onclick = goBack;
  const h = document.createElement('button');
  h.type = 'button'; h.className = 'side-back side-home'; h.id = 'go-home'; h.title = 'Home';
  h.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON.home + '</svg><span>Home</span>';
  h.onclick = () => { location.href = 'index.html'; };
  home.replaceWith(b, h);
})();
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
export async function save(action, fields) {
  return callServer('save', Object.assign({ action }, fields));
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
  const top = sheet.getBoundingClientRect().top;
  const footer = document.querySelector('.footer');
  // gap: space between rows (Daily's card rows), taken from the room first.
  const room = window.innerHeight - top - (footer ? footer.offsetHeight : 0) - 8 - (gap || 0) * (Math.max(lineCount, 1) + 2);
  const lines = Math.max(lineCount, 1) + 1.25; // the header row is a little taller than a line
  const apply = (row) => {
    document.documentElement.style.setProperty('--row', row + 'px');
    document.documentElement.style.setProperty('--font', Math.max(9, Math.min(16, Math.round(row * 0.5))) + 'px');
    // Tall enough rows show a second line (the Weekly grid puts truck / trailer under the driver).
    document.body.classList.toggle('roomy', row >= 34);
  };
  let row = Math.max(10, Math.min(44, Math.floor(room / lines)));
  apply(row);
  // Borders and the RUNS tags add a little to each line; step down until the page truly fits.
  const root = document.scrollingElement;
  while (row > 10 && root.scrollHeight > window.innerHeight) apply(--row);
}

export function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function shortDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return m + '/' + d + '/' + y;
}

// Shrink to fit (Joe, 10/9): a table cell whose text is too long for it gets smaller print until it fits (down to 11px),
// so names and values are never cut off. Headers keep their size. Runs after every redraw and on resize.
const FIT_MIN = 11;
let fitQueued = false;
function tooWide(td) {
  // The text's laid-out width against the room inside the padding (a day cell keeps its padding for the arrow).
  const cs = getComputedStyle(td), room = td.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const r = document.createRange();
  r.selectNodeContents(td);
  return r.getBoundingClientRect().width > room + 0.5 || td.scrollWidth > td.clientWidth + 1;
}
function fitCells() {
  fitQueued = false;
  const cells = [...document.querySelectorAll('tbody td')].filter(td => td.offsetParent && td.textContent.trim() && !td.querySelector('input, textarea, select, table') && !td.classList.contains('details-cell') && td.colSpan === 1);
  cells.forEach(td => { if (td.dataset.fit) { td.style.fontSize = ''; delete td.dataset.fit; } });
  let over = cells.filter(tooWide);
  for (let pass = 0; over.length && pass < 8; pass++) {
    const sizes = over.map(td => parseFloat(getComputedStyle(td).fontSize));
    over = over.filter((td, i) => { if (sizes[i] <= FIT_MIN) return false; td.style.fontSize = Math.max(FIT_MIN, sizes[i] - 1) + 'px'; td.dataset.fit = '1'; return true; });
    over = over.filter(tooWide);
  }
}
function queueFit() { if (!fitQueued) { fitQueued = true; requestAnimationFrame(fitCells); } }
new MutationObserver(queueFit).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
window.addEventListener('resize', queueFit);
