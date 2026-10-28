/*
 * United Dairy Distribution app: what every screen shares.
 * Sign-in (United Dairy Google accounts only), the database connection, the one-call save, and sizing the
 * screen to the window so nothing ever scrolls.
 */
// Firebase comes from js/firebase.js, the one place its version is written (review item 82, Joe 10/13).
import {
  initializeApp,
  getAuth, onAuthStateChanged, signInWithPopup, signInWithCredential, signInWithCustomToken, signOut, GoogleAuthProvider, connectAuthEmulator,
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator, doc, getDoc, onSnapshot,
  getFunctions, httpsCallable, connectFunctionsEmulator
} from './firebase.js';
import { helpHref } from './help.js';

export const DOMAIN = 'uniteddairy.com';

// The approved header of the current app: logo and name on the left, the screen's buttons on the right.
document.querySelectorAll('.topbar').forEach(bar => {
  if (bar.querySelector('.brand')) return;
  const brand = document.createElement('a');
  brand.className = 'brand';
  brand.href = 'index.html';
  brand.innerHTML = '<img src="img/ud-logo.webp" alt="United Dairy"><span><strong>Operations</strong><small>UNITED DAIRY &middot; ROUTE DISTRIBUTION</small></span>';
  bar.prepend(brand);
  // Polish 10: one small yellow "Test copy" badge in the header on the sandbox (and a local copy); it comes off by itself at go-live.
  if (/sandbox|^localhost$|^127\.0\.0\.1$/.test(location.hostname)) brand.insertAdjacentHTML('afterend', '<span class="test-copy-badge" title="This is the test copy: changes stay in Operations">Test copy</span>');
});

// Joe 10/10: Administration opens a screen inside its right-hand panel; there the screen shows without its own header and menu.
export const EMBED = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
if (EMBED) document.body.classList.add('embed');

/*
 * Joe 10/27: "these are just the plant apps for the plant tablets. And they should be able to go no other places than where
 * we designed them to go." Once a station has been opened on a plant tablet, the tablet is a Plant Station tablet: every
 * other screen typed in or followed by a link goes straight back to the Plant Station (its station, or the code screen after
 * Release); "that's the only thing it's allowed". Clearing the browser's data for the app is the only way to free the device.
 */
export const DEVICE_KEY = 'udStationDevice';
const HERE_PAGE = location.pathname.split('/').pop() || 'index.html';
const HERE_QS = new URLSearchParams(location.search);
// The screens each locked device may open: its own page, and the plant's own screens only inside the station's frame.
export const DEVICE_PAGES = Object.freeze({ PLANT: { home: 'plant-station.html', pages: ['plant-station.html'], frames: ['trailers.html', 'yard.html'] } });
export const STATION_DEVICE = (() => { try { const d = localStorage.getItem(DEVICE_KEY) || ''; return DEVICE_PAGES[d] ? d : ''; } catch (e) { return ''; } })();
export function lockDevice(kind) { try { if (kind) localStorage.setItem(DEVICE_KEY, kind); else localStorage.removeItem(DEVICE_KEY); } catch (e) { /* private window: not remembered */ } }
// Joe 10/27 "I don't want to see the whole darn program": the Plant Managers app (walkthrough.html?view=home&app=1) is the
// managers' phone screens only: the walkthrough and its Yard, Coolers and Production, Loading and Unloading. No menu, no Home
// into the full app; anything else goes back to the Plant Managers start.
export const MANAGER_APP_HOME = 'walkthrough.html?view=home&app=1';
// Unloading's own Returns and Washing count as Unloading.
export const MANAGER_APP_PAGES = Object.freeze(['walkthrough.html', 'yard.html', 'temps.html', 'quality.html', 'loadout.html', 'unloading.html', 'returns.html', 'washing.html']);
try { if (HERE_PAGE === 'walkthrough.html' && HERE_QS.get('app') === '1') sessionStorage.setItem('udPlantManagers', '1'); } catch (e) { /* private window */ }
export const MANAGER_APP = !STATION_DEVICE && !EMBED && (() => { try { return sessionStorage.getItem('udPlantManagers') === '1'; } catch (e) { return HERE_QS.get('app') === '1'; } })();
// Opens the device's own screen instead; this screen stops before any of it runs (below: the page's own script never starts).
let leaving = false;
function leaveFor(page) {
  leaving = true;
  document.documentElement.style.visibility = 'hidden';
  try { (EMBED ? window.top : window).location.replace(page); } catch (e) { location.replace(page); }
}
if (STATION_DEVICE) {
  const d = DEVICE_PAGES[STATION_DEVICE];
  const inFrame = EMBED && HERE_QS.get('inStation') === '1' && d.frames.indexOf(HERE_PAGE) >= 0;
  if (d.pages.indexOf(HERE_PAGE) < 0 && !inFrame) leaveFor(d.home);
} else if (MANAGER_APP) {
  if (MANAGER_APP_PAGES.indexOf(HERE_PAGE) < 0) leaveFor(MANAGER_APP_HOME);
  else document.body.classList.add('pm-app');
}
// A screen that is not this device's waits here for ever (no error), so nothing of it runs while the device's screen opens.
if (leaving) await new Promise(() => {});

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
  chart: '<path d="M3 21h18"/><rect x="5" y="12" width="3" height="6"/><rect x="10.5" y="8" width="3" height="10"/><rect x="16" y="4" width="3" height="14"/>',
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
  // Joe 10/12: Safety Walkthrough, a clipboard with checks.
  safety: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 4h6v2.5H9z"/><path d="M8 11.5l1.5 1.5 3-3M8 17l1.5 1.5 3-3"/><path d="M15 12h1.5M15 17.5h1.5"/>',
};
export const MENU = [
  ['', [['Home', 'index.html', 'home']]],
  ['Dispatch', [['Daily Dispatch', 'daily.html', 'day'], ['Weekly Dispatch', 'weekly.html', 'week'], ['Driver Assignment Board', 'weekly.html#board', 'people'], ['Route Editor', 'routes.html', 'map'], ['Route Week Override', 'routeweek.html', 'swap']]],
  // Joe 10/10: assigning drivers their routes has a plain link here (it came off the Route Editor); the board is under Dispatch too.
  ['Drivers', [['Driver Roster', 'drivers.html', 'people'], ['Driver Weekly Template (assign routes)', 'template.html', 'week'], ['Driver Assignment Board', 'weekly.html#board', 'people'], ['Vacation Schedule', 'vacations.html', 'vacation']]],
  // Joe 10/10: the maintenance side starts on the Fleet & Maintenance hub and branches out from there, as in the current app.
  // An icon name ending .webp is a picture from the United Dairy icon library (img/library).
  // Audit batch 8 (10/23, mock-up 2): the same lines under three headings (a 4th field starts a heading); nothing removed.
  ['Equipment', [['Fleet & Maintenance', 'maint.html', 'maintenance-tractor-v1-560.webp'], ['Equipment', 'equipment.html', 'truck', 'Fleet'], ['Fleet Service', 'fleet.html', 'gear'],
    ['Equipment Issues', 'issues.html', 'issue', 'Issues'], ['Truck Issues', 'issues.html?kind=TRUCK', 'maintenance-tractor-v1-560.webp'], ['Trailer Issues', 'issues.html?kind=TRAILER', 'maintenance-trailer-v1-560.webp'],
    ['Fork Truck / Pallet Jack Issues', 'issues.html?kind=FORK_TRUCK', 'forklift-truck-v1-560.webp'], ['Garage Work Orders', 'garage.html', 'wrench', 'Garage'],
    ['Garage Station', 'garage-station.html', 'wrench']]],
  // Joe 10/26 (1E): the Garage is its own department under Route Distribution (its screens stay in the Fleet & Maintenance menu too).
  ['Garage', [['Garage Work Orders', 'garage.html', 'wrench'], ['Garage Station', 'garage-station.html', 'wrench']]],
  // Joe 10/10: Over the Road and Trucks Today (GPS) are manager reports (he prints Over the Road), so they sit here only.
  // Joe 10/10 evening: GPS / Fleet is not a Fleet & Maintenance section; GPS Setup and Driver Scorecard sit in Manager Reports.
  ['Manager Reports', [['Driver Scorecard', 'scorecard.html', 'star'], ['Over the Road', 'otr.html', 'road'], ['Trucks Today', 'trucks.html', 'pin'], ['GPS Setup', 'gps.html', 'gear']]],
  ['Overall', [['Driver Check-ins', 'checkins.html', 'check'], ['Driver Station', 'driver-station.html', 'people'], ['Sheet Conflicts', 'conflicts.html', 'alert']]],
  // Joe 10/10: Dispatch Administration has its own Administration section (out of the Dispatch menu).
  ['Administration', [['Dispatch Administration', 'admin.html', 'gear'], ['Operational Assignments', 'ops.html', 'people'], ['Print Layouts', 'print.html', 'day'], ['Dispatch Settings', 'settings.html', 'gear']]],
  // The plant side (Joe 10/10): Plant Distribution opens the Manager Center cards; the menu lists the cards in the same order,
  // and a card with more than one area opens its screens beside it. A section with one screen is a plain link.
  ['Send Report', [['Send Current Report', 'manager.html?report=1', 'star']]],
  // Joe 10/11: production first, then shift notes and quality, then temperatures and yard (as the Manager Center cards).
  // Joe 10/26: one pop-out for the departments, each loading and unloading by its own name (Case, Tote, Box and Tanker), so the
  // menu itself stays short: Send Report, this, Shift Notes, Yard Checks and the Scheduler.
  ['Plant Distribution Departments', [['Plant Departments', 'plant.html', 'factory'],
    ['Case Loading', 'loadout.html?area=CASE', 'load', 'Loading'], ['Tote Loading', 'loadout.html?area=TOTES', 'load'], ['Box Loading', 'loadout.html?area=BOXING', 'load'], ['Tanker Loading', 'loadout.html?area=TANKER', 'load'], ['Late Forecast', 'forecast.html', 'week'],
    ['Case Unloading', 'unloading.html?area=CASE', 'unload', 'Unloading'], ['Tote Unloading', 'unloading.html?area=TOTES', 'unload'], ['Box Unloading', 'unloading.html?area=BOXING', 'unload'], ['Tanker Unloading', 'unloading.html?area=TANKER', 'unload'],
    ['Truck Washing', 'washing.html', 'wash', 'Washing & Returns'], ['Product Returns', 'returns.html', 'returns'], ['Trailer Assignments', 'trailers.html', 'load']]],
  // Joe 10/25: renamed Plant Distribution Scheduler (the shipping and receiving load calendar).
  // Joe 10/26 (ej): the Plant Distribution Scheduler is its own department, Shipping & Receiving, with Inventory beside it.
  ['Shipping', [['Shipping Schedule', 'scheduler.html', 'week']]],
  ['Receiving', [['Receiving Schedule', 'scheduler.html?lane=receiving', 'day']]],
  ['Shift Notes', [['Shift Notes', 'shiftnotes.html', 'alert']]],
  ['Quality Checks', [['Quality Checks', 'quality.html', 'production.webp']]],
  ['Cooler Temperature', [['Cooler Temperature', 'temps.html', 'temperatures.webp']]],
  ['Yard Checks', [['Yard Checks', 'yard.html', 'yard-checks.webp']]],
  // Joe 10/11: Reports is its own module with every report in one place. The plant's reports moved here from Plant
  // Operations; the Route Distribution and Fleet reports are listed here too and stay on their own sides as well.
  ['Plant Reports', [['Plant Reports', 'reports.html', 'star'], ['Loading Rundown', 'reports.html?view=rundown', 'day'], ['Shift Reports', 'shiftreports.html', 'day'], ['Plant Performance TV', 'plant-kiosk.html', 'star']]],
  // Joe 10/26: the reports sorted Walkthrough, Driver, Plant and Garage (were Distribution Reports and Fleet Reports).
  ['Walkthrough Reports', [['Past Safety Walks', 'safety-walks.html', 'day']]],
  ['Driver Reports', [['Driver Scorecard', 'scorecard.html', 'star'], ['Over the Road', 'otr.html', 'road'], ['Trucks Today', 'trucks.html', 'pin']]],
  ['Garage Reports', [['Fleet Service Report', 'fleet.html', 'truck']]],
  // Joe 10/12: the Safety Walkthrough, a card of its own next to Reports: the weekly walk, its open issues, the extinguishers.
  ['Safety Walkthrough', [['Weekly Walk', 'safety.html', 'safety'], ['Open Issues', 'safety-issues.html', 'alert'], ['Fire Extinguishers', 'extinguishers.html', 'safety'], ['Fire Alarm', 'safety-fire.html?sys=alarm', 'safety'], ['Fire Suppression', 'safety-fire.html?sys=suppression', 'safety'], ['Escape Plan', 'safety-fire.html?sys=escape', 'safety'], ['Past Walks', 'safety-walks.html', 'day'], ['Checklist Setup', 'safety-setup.html', 'gear']]],
  // Joe 10/11: Plant Production, our own RedZone: every line this shift, the line tablet, each product's targets and the TV.
  ['Production Lines', [['Production Lines', 'production.html', 'production.webp'], ['Line Tablet', 'line.html', 'production.webp'], ['Line Targets', 'linetargets.html', 'production.webp'], ['Production TV', 'production.html?tv=1', 'production.webp']]],
  // Joe 10/12: Plant Maintenance, like the garage work orders but for the plant's machinery: requests from the plant, work orders,
  // the PM schedule and the mechanics' tablet.
  // Joe 10/13: Inventory, starting with Receiving scan-in (scanned on the Boxing station's Receiving tab; mock-up E is the office log).
  ['Inventory', [['Receiving Log', 'inventory.html', 'day']]],
  ['Plant Maintenance', [['Maintenance Center', 'pmaint.html', 'wrench'], ['Equipment', 'plant-equipment.html', 'gear'], ['Machinery', 'machinery.html', 'gear'], ['Work Orders', 'pmworkorders.html', 'wrench'], ['PM Schedule', 'pmschedule.html', 'day'], ['Maintenance Station', 'maint-station.html', 'wrench']]],
  // Joe 10/25 (mock-ups 1 and 3): the plant's crew (loadout and production on one schedule) and, apart, maintenance's mechanics.
  ['Plant Vacations & Schedule', [['Schedule Board', 'crew.html', 'week'], ['Vacations', 'crew.html?view=vacations', 'vacation'], ['Setup', 'crew.html?view=setup', 'gear']]],
  ['Maintenance Schedule', [['Schedule Board', 'maint-crew.html', 'week'], ['Vacations', 'maint-crew.html?view=vacations', 'vacation'], ['Setup', 'maint-crew.html?view=setup', 'gear']]]
];
// Joe 10/10: Home is the old app's icon launcher, one big picture per side; tapping one opens that side, and the menu then
// lists only that side's screens. A screen listed on two sides stays on the side it was opened from.
// Joe 10/11: six cards after picking a plant: the plant's own three (Distribution, Production, Maintenance), then Route
// Distribution, Fleet & Maintenance and Reports. Plant Production and Plant Maintenance are under construction.
// Joe 10/12: the plant side is Plant Distribution (it was Plant Operations, which covers all three plant sides).
export const SIDES = [
  // Joe 10/26 (1E): each side belongs to a group card on the home (group) and shows its main screens under its button there (quick).
  { key: 'plant', group: 'plantops', name: 'Plant Distribution', home: 'manager.html', pic: 'plant-building-v1-560.webp', note: 'Loading, unloading, washing, returns, yard checks and shift notes', sections: ['Send Report', 'Plant Distribution Departments', 'Shift Notes', 'Yard Checks'],
    quick: [['Case Loading', 'loadout.html?area=CASE'], ['Case Unloading', 'unloading.html?area=CASE']] },
  // Joe 10/11: still Under Construction, so its screens open only for administrators (the shared buildingSideFor / mayOpenBuilding check below).
  { key: 'production', group: 'plantops', quick: [['Production Lines', 'production.html'], ['Quality Checks', 'quality.html']], name: 'Plant Production', home: 'production-home.html', pic: 'plant-production-construction-560.webp', note: 'Production lines, runs and output', sections: ['Production Lines', 'Quality Checks', 'Cooler Temperature', 'Shift Notes'], openSections: ['Quality Checks', 'Cooler Temperature', 'Shift Notes'], flatFirst: true, building: true, bannerInPic: true },
  // Joe 10/25 (mock-up 1): Plant Vacations & Schedule sits in the menu under the plant's own sides, with no card on the plant home (menuOnly).
  { key: 'crew', group: 'plantops', menuOnly: true, short: 'Plant Vacations & Schedule', name: 'Plant Vacations & Schedule', home: 'crew.html', note: 'Who works which job each shift, vacations and setup', sections: ['Plant Vacations & Schedule'], flatFirst: true },
  { key: 'pmaint', group: 'plantops', quick: [['Work Orders', 'pmworkorders.html'], ['PM Schedule', 'pmschedule.html']], name: 'Plant Maintenance', home: 'pmaint.html', pic: 'plant-maintenance-construction-560.webp', note: 'Plant equipment, repairs and preventive maintenance', sections: ['Plant Maintenance', 'Maintenance Schedule', 'Shift Notes'], openSections: ['Shift Notes'], flatFirst: true, building: true, bannerInPic: true },
  // Joe 10/26 (ej): Shipping & Receiving, its own department: outgoing product loads, receiving and inventory (the old Plant
  // Distribution Scheduler and the Inventory card). Inventory is still being built, so it opens only for administrators (buildingSections).
  { key: 'shipping', group: 'plantops', name: 'Shipping & Receiving', home: 'scheduler.html', pic: 'forklift-truck-v1-560.webp', note: 'Outgoing product loads, receiving and inventory', sections: ['Shipping', 'Receiving', 'Inventory', 'Shift Notes'], buildingSections: ['Inventory'],
    quick: [['Shipping', 'scheduler.html'], ['Receiving', 'scheduler.html?lane=receiving'], ['Inventory', 'inventory.html']] },
  // Joe 10/25: a line in the menu between the plant's own sides above and Route Distribution and the rest below (sepBefore).
  { key: 'distribution', group: 'routeops', quick: [['Daily Dispatch', 'daily.html'], ['Weekly Dispatch', 'weekly.html']], sepBefore: true, name: 'Route Distribution', home: 'distribution.html', pic: 'distribution-truck-v1-560.webp', note: 'Dispatch, weekly schedule, drivers, reports and administration', sections: ['Dispatch', 'Drivers', 'Manager Reports', 'Overall', 'Administration'] },
  { key: 'fleet', group: 'routeops', quick: [['Tractors & Trucks', 'equipment.html?filter=TRUCK'], ['Trailers', 'equipment.html?filter=TRAILER']], name: 'Fleet & Maintenance', home: 'maint.html', pic: 'maintenance-tractor-v1-560.webp', note: 'Equipment, issues, garage work orders and fleet service', sections: ['Equipment'] },
  { key: 'garage', group: 'routeops', quick: [['Work Orders', 'garage.html']], name: 'Garage', home: 'garage.html', pic: 'maintenance-trailer-v1-560.webp', note: 'Garage work orders and the garage station', sections: ['Garage'] },
  { key: 'reports', name: 'Reports', home: 'reportcenter.html', icon: 'chart', note: 'Every report in one place: plant, shift, drivers, over the road and fleet', sections: ['Walkthrough Reports', 'Driver Reports', 'Plant Reports', 'Garage Reports'],
    quick: [['Walkthrough Reports', 'reportcenter.html?group=walkthrough'], ['Driver Reports', 'reportcenter.html?group=driver'], ['Plant Reports', 'reportcenter.html?group=plant'], ['Garage Reports', 'reportcenter.html?group=garage']] },
  // Joe 10/12: a Safety Walkthrough card next to Reports (mock-up A). Under Construction (administrators only) while it is built.
  { key: 'safety', name: 'Safety Walkthrough', short: 'Safety Walkthrough', home: 'safety.html', icon: 'safety', note: 'Weekly walk, open issues and fire extinguisher checks', sections: ['Safety Walkthrough'], building: true,
    quick: [['Weekly Walk', 'safety.html'], ['Open Issues', 'safety-issues.html'], ['Past Walks', 'safety-walks.html']] },
];
// Joe 10/26 (1E): the home groups its departments under two cards; each opens its own page (group.html) with their cards.
export const GROUPS = [
  { key: 'plantops', name: 'Plant Operations', home: 'group.html?g=plantops', pic: 'plant-building-v1-560.webp' },
  { key: 'routeops', name: 'Route Distribution', home: 'group.html?g=routeops', pic: 'distribution-truck-v1-560.webp' }
];
export const groupSides = (key) => SIDES.filter(s => s.group === key);
const pageOf = (href) => String(href).split(/[?#]/)[0];
// Joe 10/25 (mock-up 7): each plant's own menu order from Administration > Menu Setup (logic.js menuArrange), kept on this
// computer so the menu draws at once; it is read again after sign-in and a change shows on the next screen opened.
// baseSections is where the app puts each section, which decides what is Under Construction wherever a plant moves it.
SIDES.forEach(s => { s.baseSections = s.sections.slice(); });
const menuKey = (plant) => 'udMenu_' + plant;
export function keepMenuSetup(plant, sides) {
  try { if (sides) localStorage.setItem(menuKey(plant), JSON.stringify(sides)); else localStorage.removeItem(menuKey(plant)); } catch (e) { /* no storage */ }
}
function useMenuSetup() {
  const L = window.UDLogic;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(menuKey(currentPlant())) || 'null'); } catch (e) { /* no storage */ }
  if (!L || !L.menuArrange || !saved) return;
  const got = L.menuArrange(saved);
  SIDES.forEach(s => { if (got[s.key]) s.sections = got[s.key]; });
}
// Pages opened from inside a side (not from its menu) that still belong to it, e.g. Plant Reports from a bookmark or the TV.
// Joe 10/19: the Late Forecast opens from its tile on Manager Center.
const SIDE_PAGES = { plant: ['forecast.html'] };
// A side's own first page; Plant Production and Plant Maintenance start on the being-built page with their own name.
const isHome = (side, page) => page === pageOf(side.home) && (side.home.indexOf('?') < 0 || location.search.indexOf(side.home.split('?')[1]) >= 0);
const sideHas = (side, page) => isHome(side, page) || (SIDE_PAGES[side.key] || []).indexOf(page) >= 0 || MENU.some(([g, items]) => side.sections.indexOf(g) >= 0 && items.some(([, href]) => pageOf(href) === page));
// Joe 10/11: a module Under Construction (building: true) opens only for Administrators, so Joe can watch it being built;
// everyone else sees its card with the banner but cannot open it. requireSignIn refuses every screen of such a module to
// anyone else, so a bookmark or typed address is refused too, not just the card. Any new module marked building uses this.
// Joe 10/25: Quality Checks, Cooler Temperature and Shift Notes moved into Plant Production (and Shift Notes into Plant Maintenance
// too) stay open to everyone while those sides are being built (openSections).
const builtHas = (side, page) => sideHas(Object.assign({}, side, { sections: side.baseSections.filter(g => (side.openSections || []).indexOf(g) < 0) }), page);
// Joe 10/26: a side can hold one section still being built (Inventory inside Shipping & Receiving): only its screens are refused.
const inBuildingSection = (side, page) => (side.buildingSections || []).some(g => MENU.some(([m, items]) => m === g && items.some(([, href]) => pageOf(href) === page)));
export const buildingSideFor = (page) => SIDES.find(s => s.building && builtHas(s, page)) || SIDES.find(s => inBuildingSection(s, page)) || null;
export const mayOpenBuilding = (person) => !!(person && window.UDLogic && window.UDLogic.isAdmin(person));
function refuseBuilding(side) {
  if (document.getElementById('uc-refused')) return;
  const box = document.createElement('section');
  box.id = 'uc-refused';
  box.className = 'uc-refused';
  box.setAttribute('role', 'alert');
  box.innerHTML = '<h1></h1><p></p><a class="button" href="index.html">Plant home</a>';
  box.querySelector('h1').textContent = side.name + ' is under construction';
  box.querySelector('p').textContent = 'Only Administrators can open ' + side.name + ' while it is being built. It opens for everyone once it is ready.';
  // The header (Home, Back, Sign out) stays; everything else on the screen is hidden and the screen never loads its data.
  const screen = document.getElementById('screen'), bar = screen && screen.querySelector('.topbar');
  document.body.classList.add('uc-locked');
  if (bar) bar.after(box); else (screen || document.body).appendChild(box);
}
// Joe 10/14 (People & Roles, mock-up A): the screens ticked for this person, per plant (logic.js SCREEN_AREAS), known once
// the Users list is read and kept for this tab. Nothing ticked yet (null) = every screen, as before; Administrators see all.
function readJson(key) { try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (e) { return null; } }
function signedPerson() {
  let admin = false;
  try { admin = sessionStorage.getItem('udAdmin') === '1'; } catch (e) { /* no storage */ }
  const plants = readJson('udPlants');
  return { status: 'ACTIVE', roles: admin ? ['ADMINISTRATOR'] : [], facilities: Array.isArray(plants) ? plants : [] };
}
// The plant this tab is working in: the one picked on the overview or a plant's home, else the person's first plant.
// Joe 10/26: a link can name its plant (?plant=fac_charleston), as a plant's tablets and phones do.
const knownPlant = (id) => !!(window.UDLogic && window.UDLogic.plantDb && window.UDLogic.plantDb(id));
try { const named = new URLSearchParams(location.search).get('plant'); if (knownPlant(named)) sessionStorage.setItem('udPlant', named); } catch (e) { /* no storage */ }
export function currentPlant() {
  const plants = readJson('udPlants');
  let picked = '';
  try { picked = sessionStorage.getItem('udPlant') || ''; } catch (e) { /* no storage */ }
  if (Array.isArray(plants) && plants.length) return plants.indexOf(picked) >= 0 ? picked : plants[0];
  return knownPlant(picked) ? picked : 'fac_uniontown';
}
export function plantName(id) {
  return ((window.UDLogic && window.UDLogic.PLANTS || []).find(p => p.id === (id || currentPlant())) || {}).name || '';
}
export function mayOpenPage(href, plantId) {
  const L = window.UDLogic;
  return !L || !L.pageAllowed || L.pageAllowed(signedPerson(), readJson('udScreens'), plantId || currentPlant(), href);
}
function mayOpenArea(key, plantId) {
  const L = window.UDLogic;
  return !L || !L.areaAllowed || L.areaAllowed(signedPerson(), readJson('udScreens'), plantId || currentPlant(), key);
}
// Home cards, menu links and any link or card on a screen that leads to a screen not ticked are hidden (the screen itself
// is refused too, below, so a bookmark or a typed address does not open it either).
let screensLimited = 0;
function limitScreens() {
  screensLimited = 0;
  const L = window.UDLogic;
  if (!L || !L.screenLimited || !L.screenLimited(signedPerson(), readJson('udScreens'))) {
    document.querySelectorAll('[data-screen-off]').forEach(el => { el.hidden = false; el.removeAttribute('data-screen-off'); });
    return;
  }
  const off = (el, hide) => {
    if (hide) { if (!el.hidden) { el.hidden = true; el.setAttribute('data-screen-off', '1'); } } else if (el.hasAttribute('data-screen-off')) { el.hidden = false; el.removeAttribute('data-screen-off'); }
  };
  document.querySelectorAll('a[data-side]').forEach(el => off(el, !mayOpenArea(el.dataset.side, el.dataset.plant)));
  document.querySelectorAll('.sidemenu a[href]:not([data-side]), .side-flyouts a[href]:not([data-side]), #screen .side-main a[href]:not([data-side]), #screen [data-card], #screen [data-open]').forEach(el => {
    // A card named by a word (Manager Center's data-card="sched") goes by the screen its bar opens (data-href).
    const card = el.dataset.card && /\.html/.test(el.dataset.card) ? el.dataset.card : el.dataset.href || '';
    const href = el.getAttribute('href') || el.dataset.open || card;
    if (/^(https?:|#|mailto:|tel:|javascript:)/.test(href)) return;
    off(el, !mayOpenPage(href));
  });
  // A group on the Reports page with no report left goes too.
  document.querySelectorAll('#screen .rc-group').forEach(g => off(g, ![...g.querySelectorAll('a[href]')].some(a => !a.hidden)));
  // A menu section whose screens are all hidden goes too.
  document.querySelectorAll('.sidemenu .side-sec:not(.side-plant)').forEach(sec => {
    const fly = sec._fly || sec.querySelector('.flyout');
    off(sec, !!fly && ![...fly.querySelectorAll('a[href]')].some(a => !a.hidden));
  });
}
new MutationObserver(() => { if (!screensLimited) screensLimited = requestAnimationFrame(limitScreens); }).observe(document.documentElement, { childList: true, subtree: true });
function refuseScreen() {
  if (document.getElementById('uc-refused')) return;
  const box = document.createElement('section');
  box.id = 'uc-refused';
  box.className = 'uc-refused screen-refused';
  box.setAttribute('role', 'alert');
  box.innerHTML = '<h1>You don\'t have access to this screen</h1><p>Ask an administrator to tick it for you in Administration &gt; People &amp; Roles.</p><a class="button" href="index.html">Home</a>';
  const screen = document.getElementById('screen'), bar = screen && screen.querySelector('.topbar');
  document.body.classList.add('uc-locked');
  if (bar) bar.after(box); else (screen || document.body).appendChild(box);
}
// Joe 10/11: "how can I tell what version this is? And if this is sandbox or not." version.json is written by the deploy
// (tools/stamp-version.cjs) and read fresh, never from a cache, so the line always names what is really on screen.
let versionAsk = null;
export function appVersion() {
  if (!versionAsk) versionAsk = fetch('version.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
  return versionAsk;
}
function showVersion() {
  appVersion().then(v => {
    if (!v || !v.label) return;
    document.querySelectorAll('.side-version, #app-version').forEach(el => {
      // In the narrow menu the release goes on one line and the date and copy on the next.
      const parts = v.label.split(' · ');
      if (el.classList.contains('side-version') && parts.length > 1) el.innerHTML = '<b>' + escapeHtml(parts[0]) + '</b> <span>' + escapeHtml(parts.slice(1).join(' · ')) + '</span>';
      else el.textContent = v.label;
      if (v.commit) el.title = v.label + ' (' + v.commit + ')';
    });
  });
}
// Joe 10/15: "Anytime we do an update and somebody has not refreshed ... a banner." The version this page opened with is
// checked against the one now published every few minutes and whenever the screen comes back into view. A newer one shows
// a yellow line under the header with a big Refresh button; nothing reloads by itself, so typing and unsaved boxes are safe.
const UPDATE_CHECK_MS = 3 * 60000;
let updateTimer = 0, updateShown = false;
function updateBanner() {
  if (updateShown || EMBED) return;
  updateShown = true;
  const box = document.createElement('div');
  box.id = 'update-ready';
  box.className = 'update-ready';
  box.setAttribute('role', 'status');
  box.innerHTML = '<span><b>Update ready.</b> A new version of Operations is out. Press Refresh to get it.</span><button type="button" id="update-refresh">Refresh</button>';
  const head = document.querySelector('.topbar, .phone-top');
  if (head && head.parentNode) head.after(box); else document.body.prepend(box);
  box.querySelector('button').addEventListener('click', () => {
    const btn = box.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Refreshing…';
    // Leaving a box saves it (blur); wait for every save on the screen to finish before the page reloads.
    const started = Date.now();
    const go = () => (saving > 0 && Date.now() - started < 15000) ? setTimeout(go, 250) : location.reload();
    setTimeout(go, 300);
  });
}
async function checkForUpdate() {
  const first = await appVersion();
  if (!first || !first.commit || updateShown) return;
  const now = await fetch('version.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
  if (now && now.commit && now.commit !== first.commit) updateBanner();
}
export function watchForUpdates() {
  if (updateTimer || EMBED) return;
  updateTimer = setInterval(checkForUpdate, UPDATE_CHECK_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
  window.addEventListener('focus', checkForUpdate);
  window.addEventListener('online', checkForUpdate);
}
window.UD_checkForUpdate = checkForUpdate;
appVersion();
watchForUpdates();
export function sideFor(page) {
  // Home, the all-plants overview and the Administration Center sit above the three sides: their menu lists the sides.
  if (!page || ['index.html', 'company.html', 'administration.html', 'group.html'].indexOf(page) >= 0) return null;
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
  if (!bar || document.body.classList.contains('phone') || MANAGER_APP || screen.querySelector('.sidemenu')) return;
  const here = (location.pathname.split('/').pop() || 'index.html');
  // Joe 10/10 evening: the menu is words only, on every page (no pictures or icons).
  // Review item 57 (Joe 10/13): no ▸ beside a section and no ↗ beside a link to the current app either.
  const svg = () => '';
  const nav = document.createElement('nav');
  nav.className = 'sidemenu';
  nav.setAttribute('aria-label', 'Screens');
  // Joe 10/9: the menu lists only the sections; hovering (or tapping) a section opens its screens beside it.
  // Joe 10/10: the United Dairy icon library wherever a picture fits; line icons where none does.
  const SECTION_ICON = { Dispatch: 'distribution-truck-v1-560.webp', Drivers: 'people', Equipment: 'maintenance-tractor-v1-560.webp', 'Manager Reports': 'star', Overall: 'check', Administration: 'gear', 'Send Report': 'star', 'Yard Checks': 'yard-checks.webp', 'Shipping': 'distribution-truck-v1-560.webp', 'Receiving': 'forklift-truck-v1-560.webp', 'Inventory': 'box-v1.webp', 'Plant Distribution Departments': 'factory', 'Quality Checks': 'production.webp', 'Cooler Temperature': 'temperatures.webp', 'Shift Notes': 'alert' };
  // Joe 10/26: two links to one page (Shipping Schedule, Receiving Schedule) light the one whose ?settings this page has.
  const qs = new URLSearchParams(location.search), fits = (href) => pageOf(href) === here && [...new URLSearchParams(href.split('?')[1] || '')].every(([k, v]) => qs.get(k) === v);
  const best = MENU.reduce((b, [, items]) => items.reduce((b2, [, h]) => fits(h) && (b2 === null || h.length > b2.length) ? h : b2, b), null);
  const link = ([label, href, icon]) => {
    const ext = /^https:/.test(href);
    return '<a href="' + href + '"' + (ext ? ' class="ext" title="' + label + ' (opens the current app in this window)"' : ' title="' + label + '"' + (href === here && (best === null || best === here) ? ' class="on" aria-current="page"' : href !== here && href === best ? ' class="on" aria-current="page"' : '')) +
      '>' + svg(icon) + '<span>' + label + '</span>' + '</a>';
  };
  const headed = (it) => (it[3] ? '<div class="side-group">' + it[3] + '</div>' : '') + link(it);
  // A side's sections in its own order. Joe 10/25: Plant Production and Plant Maintenance keep their own screens straight in the
  // menu (the first section, flatFirst) with the sections moved in (Quality Checks, Cooler Temperature, Shift Notes, Maintenance
  // Schedule) under them.
  const side = sideFor(here), groups = side ? side.sections.map(g => MENU.find(([m]) => m === g)).filter(Boolean) : [];
  const section = ([group, items]) => !group ? '' : items.length === 1 ? link([group, items[0][1], SECTION_ICON[group] || items[0][2]]) :
      '<div class="side-sec' + (items.some(([, href]) => pageOf(href) === here) ? ' on' : '') + '"><button type="button" class="side-sec-btn" aria-haspopup="true" aria-expanded="false" title="' + group + '">' +
      svg(SECTION_ICON[group] || items[0][2]) + '<span>' + group + '</span></button>' +
      '<div class="flyout" role="menu"><div class="flyout-title">' + group + '</div>' + items.map(headed).join('') + '</div></div>';
  // Joe 10/10 evening: Back and Home sit in the header, not in the menu. The main screen (the all-plants Operations Overview)
  // lists only the plants; each plant opens its Plant Distribution, Route Distribution and Fleet & Maintenance beside it.
  // A plant's home lists its three sides; a side shows its name (back to its first page), then only its own sections.
  // A side with one section lists its screens straight in the menu. Administration is a header button, not a menu item.
  const sideLink = (s, href) => link([s.name, href || s.home, s.pic]).replace('<a ', '<a data-side="' + s.key + '"' + (s.building ? ' data-building="1"' : '') + ' ');
  const sep = (s) => s.sepBefore ? '<div class="side-sep" role="separator"></div>' : '';
  const plantSec = (p) => {
    const live = p.status === 'ACTIVE', soon = 'soon.html?what=plant-' + p.id.replace(/^fac_/, '');
    // Joe 10/12: clicking the plant's name (a second tap on a tablet) opens that plant's home; hovering shows its sides.
    return '<div class="side-sec side-plant" data-plant="' + p.id + '" data-home="' + (live ? 'index.html' : soon) + '"><button type="button" class="side-sec-btn" aria-haspopup="true" aria-expanded="false" title="' + p.name + '">' +
      svg('plant-building-v1-560.webp') + '<span>' + p.name + '</span></button>' +
      '<div class="flyout" role="menu"><div class="flyout-title">' + p.name + '</div>' +
      SIDES.map(s => sep(s) + sideLink(s, live ? s.home : soon).replace('<a ', '<a data-plant="' + p.id + '" ')).join('') + '</div></div>';
  };
  // Joe 10/26 (1E): the plant home's menu lists the two groups (each pops out its departments), a line, then Reports and Safety
  // Walkthrough; a group's own page lists its name and its departments.
  const grp = here === 'group.html' ? GROUPS.find(g => g.key === new URLSearchParams(location.search).get('g')) : null;
  const groupSec = (g) => '<div class="side-sec side-group-sec" data-group="' + g.key + '"><button type="button" class="side-sec-btn" aria-haspopup="true" aria-expanded="false" title="' + g.name + '">' +
    svg(g.pic) + '<span>' + g.name + '</span></button><div class="flyout" role="menu"><div class="flyout-title">' + g.name + '</div>' +
    '<a href="' + g.home + '" title="' + g.name + '"><span>All ' + g.name + '</span></a>' + groupSides(g.key).map(s => sideLink(s)).join('') + '</div></div>';
  const homeTop = () => GROUPS.map(groupSec).join('') + '<div class="side-sep" role="separator"></div>' + SIDES.filter(s => !s.group).map(s => sideLink(s)).join('');
  const top = here === 'company.html' ? PLANT_LIST().map(plantSec).join('') :
    grp ? '<a class="side-name on" href="' + grp.home + '" title="' + grp.name + '"><span>' + grp.name + '</span></a>' + groupSides(grp.key).map(s => sideLink(s)).join('') :
    !side ? homeTop() :
    sideLink(side).replace(/class="on"/, '').replace('<a ', '<a class="side-name' + (isHome(side, here) ? ' on' : '') + '" ');
  nav.innerHTML = '<button type="button" class="side-toggle" aria-label="Fold or open the menu" title="Fold or open the menu">&#9776;</button>' + top +
    (groups.length === 1 || (side && side.flatFirst) ? groups[0][1].filter(([, href]) => href !== side.home).map(headed).join('') + groups.slice(1).map(section).join('') : groups.map(section).join(''));
  // Joe 10/11: which version this is and whether it is the test copy, at the bottom of the menu (stamped by the deploy).
  nav.insertAdjacentHTML('beforeend', '<div class="side-version" title="The version of the app on this screen"></div>');
  showVersion();
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
  limitScreens();
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
    sec.querySelector('.side-sec-btn').addEventListener('click', e => {
      e.stopPropagation();
      if (sec.classList.contains('open') && Date.now() - hoverAt > 400) {
        if (!sec.dataset.home) { close(); return; }
        try { sessionStorage.setItem('udPlant', sec.dataset.plant); } catch (x) { /* no storage */ }
        location.href = sec.dataset.home;
      } else openSec(sec);
    });
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
  // A menu a tap opened stays open until a tap on the screen beside it (or a real mouse leaves it): with no mouse, Chrome can
  // send a made-up "mouse left" when the page under the finger changes (a screen finishing drawing), which folded the menu
  // just before the second tap picked a screen.
  let touching = false;
  document.addEventListener('pointerdown', e => { touching = e.pointerType !== 'mouse'; }, true);
  document.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') touching = false; }, true);
  const inside = () => { clearTimeout(timer); if (!pinned) peek(true); };
  const outside = () => { clearTimeout(timer); if (!pinned && !touching) timer = setTimeout(() => { peek(false); close(); }, 250); };
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
useMenuSetup();
addSideMenu();
// The Plant Managers app's header: the logo and one button back to the Plant Managers start (no Home, Help or Administration
// into the full app).
(function managerAppHeader() {
  if (!MANAGER_APP) return;
  const bar = document.querySelector('#screen > .topbar'), brand = bar && bar.querySelector('.brand');
  if (brand) {
    brand.href = MANAGER_APP_HOME;
    const name = brand.querySelector('strong'), small = brand.querySelector('small');
    if (name) name.textContent = 'Plant Managers';
    if (small) small.textContent = 'UNITED DAIRY';
  }
  if (!bar || bar.querySelector('#pm-home') || (HERE_PAGE === 'walkthrough.html' && HERE_QS.get('view') === 'home')) return;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'hdr-btn pm-home'; b.id = 'pm-home'; b.title = 'Back to the Plant Managers start';
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON.back + '</svg><span>Plant Managers</span>';
  b.onclick = () => { location.href = MANAGER_APP_HOME; };
  if (brand) brand.after(b); else bar.prepend(b);
})();
// The header's second line names the side the screen is on (just United Dairy above the sides).
(function headerSide() {
  const small = document.querySelector('#screen > .topbar .brand small');
  if (!small || !document.body.classList.contains('has-side')) return;
  const here = location.pathname.split('/').pop() || 'index.html', side = sideFor(here);
  const grp = here === 'group.html' ? GROUPS.find(g => g.key === new URLSearchParams(location.search).get('g')) : null;
  small.innerHTML = 'UNITED DAIRY' + (grp ? ' &middot; ' + grp.name.toUpperCase() : side ? ' &middot; ' + (side.key === 'crew' ? side.short : side.name).toUpperCase() : '');
})();
// Joe 10/26 (picture 2): every screen of a plant names that plant in the header, in yellow, where "UNITED DAIRY" was, so no one
// mistakes one plant's screen for another's. The all-plants overview keeps "UNITED DAIRY".
(function headerPlant() {
  const small = document.querySelector('#screen > .topbar .brand small'), here = location.pathname.split('/').pop() || 'index.html';
  if (!small || here === 'company.html') return;
  const name = plantName(currentPlant());
  if (name) small.innerHTML = small.innerHTML.replace(/^UNITED DAIRY/, '<b class="plant-name">' + escapeHtml(name.toUpperCase()) + '</b>');
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
  // The filters after the buttons count too: a drop-down pushed off the right edge (Products at 1536) also means own widths.
  const row = [...head.querySelectorAll('.actions > *, :scope > *')].filter(el => el.getBoundingClientRect().width > 0);
  if (tops.size > 1 || btns.concat(row).some(b => b.getBoundingClientRect().right > right)) head.style.removeProperty('--top-btn-w');
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
  'gps.html': 'pin', 'trucks.html': 'pin', 'scorecard.html': 'star', 'reportcenter.html': 'chart',
  'equipment.html': 'truck', 'maint.html': 'wrench', 'issues.html': 'issue',
  'garage.html': 'wrench', 'fleet.html': 'truck',
  'plant.html': 'factory', 'loadout.html': 'case-v1.webp', 'unloading.html': 'case-unloading-v1-560.webp', 'returns.html': 'returns-to-cooler-v1-560.webp', 'washing.html': 'wash', 'scheduler.html': 'week', 'yard.html': 'yard-checks.webp', 'quality.html': 'production.webp', 'products.html': 'production.webp', 'redzone.html': 'production.webp', 'machine-setup.html': 'production.webp', 'production.html': 'production.webp', 'production-home.html': 'production.webp', 'linetargets.html': 'production.webp', 'mocreo.html': 'temperatures.webp', 'shiftnotes.html': 'alert', 'shiftreports.html': 'day', 'temps.html': 'temperatures.webp', 'manager.html': 'star', 'forecast.html': 'week',
  'garage-station.html': 'wrench', 'driver-station.html': 'truck', 'trailers.html': 'truck', 'plant-station.html': 'factory', 'phone-screens.html': 'people',
  'safety.html': 'safety', 'safety-issues.html': 'alert', 'extinguishers.html': 'safety', 'safety-fire.html': 'safety', 'safety-walks.html': 'day', 'safety-setup.html': 'gear', 'location-areas.html': 'map',
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

/* Joe 10/21 ("the older screens are loading and then it's refreshing on the new ones"): a screen shows its header and menu at
   once, and the rest of it once, when its first data is drawn, instead of empty boxes, dashes and greyed buttons first and the
   numbers a moment later. js/firebase.js counts the reads a screen starts until each has its first answer; the screen shows
   when none is waiting and nothing on it has changed for a moment (at most 2.5 seconds after it opened, so a slow line never
   leaves it blank). An error shows at once. What the screen looks like once drawn is not changed. */
let drawingSince = 0, drawTimer = 0, readyAt = 0, readsAtStart = 0, lastChange = 0;
const DRAW_QUIET = 80, DRAW_WAIT_NO_READS = 400, DRAW_CAP = 2500;
function drawn() {
  if (!drawingSince) return;
  drawingSince = 0;
  clearInterval(drawTimer);
  document.body.classList.remove('ud-drawing');
}
function readyNow() { if (!readyAt) readyAt = performance.now(); }
function holdUntilDrawn() {
  const R = window.UDReads;
  if (drawingSince || !R) return;
  drawingSince = lastChange = performance.now();
  readsAtStart = R.started;
  document.body.classList.add('ud-drawing');
  drawTimer = setInterval(() => {
    const now = performance.now(), quiet = now - Math.max(lastChange, R.last);
    if (now - drawingSince >= DRAW_CAP) { drawn(); return; }
    if (R.waiting > 0 || quiet < DRAW_QUIET) return;
    // Reads started and all answered; or none started yet: the screen gets a moment to start them before it shows bare.
    if (R.started > readsAtStart || quiet >= DRAW_WAIT_NO_READS || (readyAt && now - readyAt >= DRAW_WAIT_NO_READS)) requestAnimationFrame(drawn);
  }, 20);
}
(function drawOnce() {
  const screen = document.getElementById('screen');
  if (!screen) return;
  new MutationObserver(() => { lastChange = performance.now(); }).observe(screen, { childList: true, subtree: true, characterData: true });
  const watch = () => { if (!screen.hidden) holdUntilDrawn(); };
  new MutationObserver(watch).observe(screen, { attributes: true, attributeFilter: ['hidden'] });
  watch();
})();

// Joe 10/21: Chrome no longer opens screens in the background while the pointer rests on a link (it did from 10/9). Each one
// started its own reads and drew while another screen was in use, and showed what it had drawn then when it was clicked.
// Standing rule (Joe, 10/9): every link opens in this window; a link that asks for a new tab is opened here instead.
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a[target]');
  if (a && a.target !== '_self') a.removeAttribute('target');
}, true);

// Polish 16: when the tablet or computer loses its connection a yellow bar says so at the top, so nobody thinks a press was
// sent. Saves go to the server, so they wait for the signal; the bar goes away by itself when it is back.
(function connectionBar() {
  // Screens that keep saves on the device with no signal (window.UD_OFFLINE, and the drivers' Route page with
  // window.UD_PHONE_QUEUE, Joe 10/12) show their own line instead.
  if (EMBED || window.UD_OFFLINE || window.UD_PHONE_QUEUE) return;
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
  const side = sideFor(here), up = side && !isHome(side, here) ? side.home : here === 'index.html' && multiPlant() ? 'company.html' : 'index.html';
  if ((here === 'company.html' || (!main && side && !isHome(side, here))) && fromHere && history.length > 1) history.back();
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
function noteAccess(person, screens) {
  const L = window.UDLogic;
  if (!L || !L.plantsFor) return;
  try {
    sessionStorage.setItem('udMulti', L.plantsFor(person).length > 1 ? '1' : '0');
    sessionStorage.setItem('udAdmin', L.isAdmin(person) ? '1' : '0');
    sessionStorage.setItem('udPlants', JSON.stringify(L.plantsFor(person)));
    if (screens !== undefined) sessionStorage.setItem('udScreens', JSON.stringify(screens));
  } catch (e) { /* no storage */ }
  // Joe 10/26: the screen opened before the person's plants were known, on another plant's database: open it again on theirs.
  if (services && services.plant !== currentPlant()) { location.reload(); return; }
  document.body.classList.toggle('is-admin', L.isAdmin(person));
  plantHomeBack();
  limitPlants();
  limitScreens();
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
  // Joe 10/11: someone who sees several plants goes Home to the all-plants overview directly (no plant page first).
  h.onclick = () => { location.href = multiPlant() ? 'company.html' : 'index.html'; };
  // The main screen (all plants) and a plant's home are the top: no Back there (a plant's home gets Back to the overview below).
  if (['index.html', 'company.html'].indexOf(here) < 0) nav.append(backButton());
  nav.append(h);
  brand.after(nav);
  if (here === 'index.html') plantHomeBack();
  // Joe 10/26 (picked mock-up 2): a "? Help" button on the right, just before Administration, on every screen. It opens the
  // Help guide on this screen's part, in this window (no pop-up over the screen); Back on the guide comes straight back here.
  // The words are in help.md (js/help.js).
  if (here !== 'help.html') {
    const q = document.createElement('a');
    q.className = 'hdr-btn hdr-help'; q.id = 'go-help';
    q.innerHTML = '<b class="hdr-q" aria-hidden="true">?</b><span>Help</span>';
    q.title = 'Help for this screen'; q.setAttribute('aria-label', 'Help for this screen');
    q.href = helpHref();
    q.addEventListener('click', () => { q.href = helpHref(); });
    const who = bar.querySelector('.who, #signout');
    if (who) who.before(q); else bar.append(q);
  }
  if (here !== 'administration.html') {
    const adm = headerButton('go-admin', 'gear', 'Administration', 'Administration');
    adm.classList.add('hdr-admin');
    adm.onclick = () => { location.href = 'administration.html'; };
    const who = bar.querySelector('.who, #signout');
    if (who) who.before(adm); else bar.append(adm);
  }
})();
// Joe 10/22: "in the upper banner is where I want the version and the last time it was updated." Every screen's header
// shows "Version 6.48 · Updated 10-22-26 1:30 PM" (stamped by the deploy), just before Administration, the initials and
// Sign out. The line at the bottom of the menu stays as it is.
(function headerVersion() {
  if (EMBED) return;
  const bars = [...document.querySelectorAll('.topbar, .phone-top')].filter(bar => !bar.querySelector('.hdr-version'));
  if (!bars.length) return;
  const boxes = bars.map(bar => {
    const box = document.createElement('div');
    box.className = 'hdr-version';
    box.title = 'The version of the app on this screen and when it was last updated';
    const right = [...bar.children].find(el => el.matches('.hdr-help, .hdr-admin, .who, #who, #signout, #change'));
    if (right) right.before(box); else bar.append(box);
    return box;
  });
  appVersion().then(v => {
    if (!v || !(v.banner || v.label)) return;
    const parts = (v.banner || v.label).split(' · ');
    boxes.forEach(box => {
      box.innerHTML = '<b>' + escapeHtml(parts[0]) + '</b>' + (parts.length > 1 ? ' <small>' + escapeHtml(parts.slice(1).join(' · ')) + '</small>' : '');
      if (v.commit) box.title = (v.banner || v.label) + ' (' + v.commit + ')';
    });
  });
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
// Joe 10/26: "All three locations have completely separate". Each plant keeps everything in its own database (logic.js
// PLANTS[].db; Uniontown's is the first one, as always). A screen reads the plant it is open at (db); the Users list, the one
// list for the company, is in Uniontown's (homeDb); the Home overview reads each plant's with dbOf(plant).
const plantDbs = new Map();
function openDb(app, plant) {
  const id = (window.UDLogic && window.UDLogic.plantDb && window.UDLogic.plantDb(plant)) || '(default)';
  if (plantDbs.has(id)) return plantDbs.get(id);
  // Joe 10/12: screens carried round the plant on an iPad (window.UD_OFFLINE, the Safety Walkthrough) keep what they read on
  // the iPad, so they open and show the last data with no signal; every other screen reads live as before.
  let db;
  if (window.UD_OFFLINE) {
    try { db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }, id); } catch (e) { db = getFirestore(app, id); }
  } else db = getFirestore(app, id);
  if (LOCAL) connectFirestoreEmulator(db, '127.0.0.1', 8080);
  plantDbs.set(id, db);
  return db;
}
export async function start() {
  if (services) return services;
  const app = initializeApp(await firebaseConfig());
  const plant = currentPlant(), db = openDb(app, plant), homeDb = openDb(app, 'fac_uniontown');
  const auth = getAuth(app), functions = getFunctions(app, 'us-east4');
  if (LOCAL) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  }
  services = { app, auth, db, homeDb, plant, dbOf: (p) => openDb(app, p), functions };
  return services;
}

export function isUnitedDairy(user) {
  return !!(user && user.emailVerified && String(user.email || '').toLowerCase().endsWith('@' + DOMAIN));
}

// The screens a Plant Station signed in by its code alone may open: only the Plant Station, whose tabs hold the station's work.
// Joe 10/12: the manager screens (Loadout Center, Unloading & Washing, Washing, Returns) are not for the employees' tablets.
export const STATION_PAGES = ['plant-station.html'];
// Joe 10/16 (Fire Stick): a Driver's Kiosk Station TV signed in by its code opens only the Driver Station board.
export const TV_PAGES = ['driver-station.html'];
const TV_KEY = 'udSignedTv';
async function stationOf(user) {
  try {
    const c = (await user.getIdTokenResult()).claims || {};
    if (c.udTv) {
      const tv = { tv: true, key: c.udTv, version: c.udTvVersion || '', type: 'TV', facilityId: c.udPlant || '', name: c.udName || 'Driver\'s Kiosk Station', plant: ((window.UDLogic && window.UDLogic.PLANTS || []).find(p => p.id === c.udPlant) || {}).name || String(c.udPlant || ''), uid: user.uid };
      try { localStorage.setItem(TV_KEY, JSON.stringify(tv)); } catch (e) { /* no storage */ }
      return tv;
    }
    return c.udStation ? { key: c.udStation, version: c.udVersion || '', type: c.udType || '', facilityId: c.udPlant || '', name: c.udName || 'Plant Station', plant: ((window.UDLogic && window.UDLogic.PLANTS || []).find(p => p.id === c.udPlant) || {}).name || String(c.udPlant || '') } : null;
  } catch (e) {
    // A TV that starts with no signal after a power loss cannot renew its sign-in yet: it stays the TV station it was (Joe
    // 10/16), and the board reloads once the signal is back.
    try { const tv = JSON.parse(localStorage.getItem(TV_KEY) || 'null'); if (tv && tv.uid === user.uid) return tv; } catch (e2) { /* none kept */ }
    return null;
  }
}
// The person a screen shows buttons for: the Users list entry, or a code-signed Plant Station as a plant employee.
// Review item 76 (Joe 10/13): every screen watches the signed-in person here. opts.withEmail puts the sign-in email on the
// entry; opts.onError is called when the Users list cannot be read.
export function watchPerson(db, user, done, opts) {
  const o = opts || {};
  if (user.station) { done({ status: 'ACTIVE', roles: ['PLANT_EMPLOYEE'], name: user.station.name, email: '' }); return () => {}; }
  // The one Users list (Uniontown's database), whichever plant the screen is open at.
  return onSnapshot(doc(services ? services.homeDb : db, 'users', String(user.email).toLowerCase()), s => done(s.exists() ? (o.withEmail ? Object.assign({ email: user.email }, s.data()) : s.data()) : null), o.onError);
}
// Review item 76 (Joe 10/13): may this person save on this screen? One of the roles (or that one save given to them in
// Administration, allowedSave === true), and the screen switched on in Go-Live Switches (app = config/app, screen = its key).
export function maySave(person, roles, app, screen, allowedSave) {
  const L = window.UDLogic;
  return (L.hasRole(person, roles) || allowedSave === true) && L.screenState(app, screen).open;
}
// The Plant Station with no UD account: the station code signs this tablet in as that station only.
export async function stationCodeSignIn(code) {
  const { auth } = await start();
  const out = await callServer('stationSignIn', { op: 'enter', code });
  if (!out.ok) return out;
  await signInWithCustomToken(auth, out.token);
  return out;
}
// The Driver's Kiosk Station TV with no UD account (Joe 10/16): the TV's code signs it in as that TV station only.
export async function tvCodeSignIn(code) {
  const { auth } = await start();
  const out = await callServer('stationSignIn', { op: 'enter', tv: true, code });
  if (!out.ok) return out;
  await signInWithCustomToken(auth, out.token);
  return out;
}
export async function signOutHere() { const { auth } = await start(); await signOut(auth); }

// Shows the sign-in card until a United Dairy account is signed in, then calls ready(user).
// Joe 10/26: a person's Home screen (Administration > People & Roles) opens when they open the app, instead of the Home
// cards. Only once per tab: after that the Home button goes to the normal Home, and a bookmark to another screen stays put.
function goHomeScreen(page, person) {
  let gone = false;
  try { gone = sessionStorage.getItem('udHomeScreenGone') === '1'; sessionStorage.setItem('udHomeScreenGone', '1'); } catch (e) { gone = true; }
  const here = location.pathname.split('/').pop() || 'index.html';
  if (gone || !page || page === here || ['index.html', 'company.html'].indexOf(here) < 0 || !mayOpenPage(page)) return false;
  if (buildingSideFor(page) && !mayOpenBuilding(person)) return false;
  location.replace(page);
  return true;
}
export async function requireSignIn(ready) {
  // Moving between screens (Joe 10/9): someone already checked in this tab sees the screen at once, not a blank page while
  // the sign-in and the Users list are checked again; the check still runs and signs out anyone no longer active.
  const gate = document.getElementById('signin'), screen = document.getElementById('screen');
  let known = '';
  try { known = sessionStorage.getItem('udActive') || ''; } catch (e) { /* no storage */ }
  const building = buildingSideFor(location.pathname.split('/').pop() || 'index.html');
  let knownAdmin = false;
  try { knownAdmin = sessionStorage.getItem('udAdmin') === '1'; } catch (e) { /* no storage */ }
  if (building && !knownAdmin) known = '';
  const here = location.pathname.split('/').pop() || 'index.html';
  if (!mayOpenPage(here)) known = '';
  if (known) {
    gate.hidden = true; screen.hidden = false;
    // Joe 10/21: the initials circle shows with the header, so the header's buttons do not move over when the sign-in is checked.
    let was = null;
    try { was = JSON.parse(sessionStorage.getItem('udWho') || 'null'); } catch (e) { /* no storage */ }
    const who = document.getElementById('who');
    if (who && was && was.email === known && !who.textContent) { who.textContent = was.initials; who.title = was.email; who.classList.add('initials'); }
  }
  const { auth } = await start();
  const showWho = (user) => {
    const who = document.getElementById('who');
    if (!who) return;
    const parts = String(user.displayName || '').trim().split(/\s+/).filter(Boolean);
    who.textContent = (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || user.email || '?').slice(0, 2)).toUpperCase();
    who.title = user.email || '';
    who.classList.add('initials');
    // Joe 10/12 ("tapping does nothing"): a tap on the circle shows the signed-in account for a few seconds.
    who.dataset.initials = who.textContent; who.dataset.email = user.email || '';
    try { sessionStorage.setItem('udWho', JSON.stringify({ email: String(user.email || '').toLowerCase(), initials: who.textContent })); } catch (e) { /* no storage */ }
    who.setAttribute('role', 'button'); who.tabIndex = 0;
    if (!who.dataset.tap) {
      who.dataset.tap = '1';
      let back = null;
      const show = () => {
        if (!who.dataset.email || !who.classList.contains('initials')) return;
        who.textContent = who.dataset.email; who.classList.add('open');
        clearTimeout(back); back = setTimeout(() => { who.textContent = who.dataset.initials; who.classList.remove('open'); }, 6000);
      };
      who.addEventListener('click', show);
      who.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); } });
    }
  };
  // Signed out: the next person to sign in on this tab goes to their own Home screen (goHomeScreen).
  const remember = (email) => { try { if (email) sessionStorage.setItem('udActive', email); else { sessionStorage.removeItem('udActive'); sessionStorage.removeItem('udHomeScreenGone'); } } catch (e) { /* no storage */ } };
  onAuthStateChanged(auth, async (user) => {
    // A Plant Station signed in by its code alone (stationSignIn): only the screens a Plant Station opens.
    const station = user && !isUnitedDairy(user) ? await stationOf(user) : null;
    if (station) {
      remember('');
      user.station = station;
      // Joe 10/26: a tablet signed in for a plant works in that plant's database only.
      if (station.facilityId && knownPlant(station.facilityId)) {
        try { sessionStorage.setItem('udPlant', station.facilityId); } catch (e) { /* no storage */ }
        if (services && services.plant !== station.facilityId && currentPlant() === station.facilityId) { location.reload(); return; }
      }
      gate.hidden = true;
      screen.hidden = false;
      // It leaves only through the Plant Station's Release (and the manager release code), not Sign out.
      const out = document.getElementById('signout');
      if (out) out.hidden = true;
      const who = document.getElementById('who');
      if (who) { who.textContent = station.name; who.title = station.name + ' · ' + station.plant + ' (no UD account)'; }
      // Joe 10/27: the Plant Station's own Trailer Assignments and Yard Checks frames open for it too (they showed a Google
      // sign-in inside the station before).
      const here = location.pathname.split('/').pop() || 'index.html', framed = !station.tv && EMBED && HERE_QS.get('inStation') === '1' && DEVICE_PAGES.PLANT.frames.indexOf(here) >= 0;
      if ((station.tv ? TV_PAGES : STATION_PAGES).indexOf(here) < 0 && !framed) {
        screen.hidden = true;
        gate.hidden = false;
        showError(station.tv ? 'This TV is signed in as the ' + station.name + ' (no UD account). Only the Driver Station board opens on it.'
          : 'This tablet is signed in as the ' + station.name + ' Plant Station (no UD account). Only the Plant Station screens open on it; sign in with a United Dairy account for this screen.');
        return;
      }
      if (!window.UDPlantStartWatch) { window.UDPlantStartWatch = true; start().then(({ db }) => onSnapshot(doc(db, 'config', 'app'), s => { window.UDPlantStart = ((s.data() || {}).plantStart || {}).date || ''; }, () => { window.UDPlantStartWatch = false; })); }
      readyNow();
      ready(user);
      return;
    }
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
    if (early) { gate.hidden = true; screen.hidden = false; showWho(user); readyNow(); ready(user); }
    // The database shows dispatch data only to people ACTIVE in USERS_MASTER; say so plainly instead of a blank screen.
    // The Users list and People & Roles' ticks are the company's, in Uniontown's database (homeDb).
    const { db: plantDb, homeDb: db } = await start();
    // A read that fails (the connection dropped, "the client is offline") is tried again and never signs anyone out: signing
    // out here signs out every screen in the browser, so only a Users list that says "not active" does that.
    let entry = null;
    for (let tries = 0; !entry && tries < 6; tries++) {
      entry = await getDoc(doc(db, 'users', email)).catch(() => null);
      if (!entry) await new Promise(r => setTimeout(r, 500 * (tries + 1)));
    }
    if (!entry) {
      if (!early) screen.hidden = true;
      showError('Could not reach the Users list to check your sign-in. Check the connection and reload the page.');
      return;
    }
    if (!entry.exists() || entry.data().status !== 'ACTIVE') {
      remember('');
      screen.hidden = true;
      await signOut(auth);
      showError(user.email + ' is not an active user in the Users list. Ask an administrator to add you.');
      return;
    }
    remember(email);
    // Joe 10/14: the screens ticked for this person (People & Roles). A read that fails keeps what this tab already knew;
    // the server still refuses saves on a screen not ticked.
    const mine = await getDoc(doc(db, 'personRights', email)).then(d => d.exists() ? d.data() : {}).catch(() => undefined);
    const ticks = mine === undefined ? undefined : mine.screenAccess || null;
    noteAccess(Object.assign({ email }, entry.data()), ticks);
    if (mine && goHomeScreen(mine.homeScreen, Object.assign({ email }, entry.data()))) return;
    { const plant = currentPlant(); getDoc(doc(plantDb, 'menuSetup', plant)).then(d => keepMenuSetup(plant, d.exists() ? d.data().sides || null : null)).catch(() => {}); }
    if (!mayOpenPage(here)) {
      gate.hidden = true;
      screen.hidden = false;
      showWho(user);
      refuseScreen();
      return;
    }
    if (building && !mayOpenBuilding(Object.assign({ email }, entry.data()))) {
      gate.hidden = true;
      screen.hidden = false;
      showWho(user);
      refuseBuilding(building);
      return;
    }
    if (early) return;
    gate.hidden = true;
    screen.hidden = false;
    showWho(user);
    readyNow();
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
  if (testEmail) await auth.authStateReady(); // signed in already (also with no signal): kept, not signed in again
  if (testEmail && !auth.currentUser) {
    const token = JSON.stringify({ sub: 'test-' + testEmail, email: testEmail, email_verified: true });
    await signInWithCredential(auth, GoogleAuthProvider.credential(token)).catch(e => showError(String(e.message || e)));
  }
}

// Every save is one call. A fresh requestId makes a retry safe: the server saves it once.
// "Saving... / Saved" beside the screen's title (Daily's sign), on every screen that saves (polish 15). Screens that use
// edit.js show it from there instead, around their own saves.
let pillTimer = null, saving = 0, saveFailed = false;
// Joe 10/22 (practice test; his standing rule: no save messages anywhere): no screen shows "Saving…" or "Saved"; only a save
// that failed says "Not saved", and the next save that works takes it away.
export function savePill(state) {
  if (state !== 'failed') { const p = document.getElementById('save-pill'); if (p) p.hidden = true; return; }
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
// Joe 10/13: a station screen (window.UD_STATION_OFFLINE: the Plant Station) keeps a save made with no signal on the tablet
// and sends it once when the signal is back (js/offline-saves.js); saveNow always sends at once.
export async function save(action, fields) {
  if (window.UD_STATION_OFFLINE) {
    const out = await (await import('./offline-saves.js')).offlineSave(action, fields);
    if (out && out.queued) savePill('saved');
    return out;
  }
  return saveNow(action, fields);
}
export async function saveNow(action, fields) {
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
// Review item 55 (Joe 10/13): a server call that fails with no message written for people (the bare "internal [0]") says so
// in a plain sentence, naming what could not be reached; a message the server wrote for people (a check) shows as it is.
export function serverText(e, what) {
  const code = String(e && e.code || '').replace(/^functions\/|^firestore\//, ''), msg = String(e && e.message || e || '');
  if (code === 'internal' || code === 'unknown' || /^(internal|unknown)\b/i.test(msg) || !msg) return 'Could not reach ' + what + '. Check the network and try again.';
  return friendlyError(e);
}

// Any other server call that changes something (the per-screen switch): also one call with its own requestId.
// Which saves the signed-in person may make, as the server decides (role, Role Templates and the person's Allow / Deny in
// Administration > People & Roles). Joe 10/12: a screen that checked the role alone showed View only to someone allowed.
// Nothing is saved; an answer that cannot be had counts as not allowed (the role check still stands).
export async function allowedSaves(actions) {
  try { return (await callServer('save', { checkSaves: actions })).allowed || {}; } catch (e) { return {}; }
}
// Joe 10/28 (gz): the plant's people's names (First Last), for Case Unloading's "Unloaded By"; [] when they cannot be read.
export async function plantNames() {
  try { return (await callServer('save', { plantNames: true })).names || []; } catch (e) { return []; }
}

// Review item 69 (Joe 10/13): a call that failed with no clear answer (timed out, no connection, a server error) may still
// have saved. Trying the same thing again reuses that try's requestId, so the server saves it once (a retry after a time-out
// added pickups, returns and work orders twice). Any answer from the server, or 15 minutes, ends the hold.
const IN_DOUBT_MS = 15 * 60000;
const inDoubt = new Map(); // the call (name + fields) -> {requestId, at}
const newRequestId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/[^A-Za-z0-9_-]/g, '');
function mayHaveSaved(e) {
  const code = String(e && e.code || '').replace(/^functions\//, '');
  return ['deadline-exceeded', 'unavailable', 'internal', 'unknown', 'cancelled'].indexOf(code) >= 0 || /network|Failed to fetch|offline|timed? ?out/i.test(String(e && e.message || ''));
}
export async function callServer(name, fields) {
  const { functions } = await start();
  // A screen that sends its own requestId keeps it; otherwise the same call after a doubtful failure gets the same one.
  let key = '';
  if (!(fields && fields.requestId)) { try { key = name + '|' + JSON.stringify(fields || {}); } catch (e) { key = ''; } }
  const held = key && inDoubt.get(key), fresh = held && Date.now() - held.at < IN_DOUBT_MS;
  const requestId = fresh ? held.requestId : newRequestId();
  try {
    // Joe 10/26: every call names the plant it is for, so the server works in that plant's database only: the plant a
    // screen's own plant box picked (facilityId), else the plant the screen is open at.
    const f = fields || {};
    const udPlant = f.udPlant || (knownPlant(f.facilityId) ? f.facilityId : currentPlant());
    const result = await httpsCallable(functions, name)(Object.assign({ requestId, udPlant }, fields));
    if (key) inDoubt.delete(key);
    return result.data;
  } catch (e) {
    if (key) { if (mayHaveSaved(e)) inDoubt.set(key, { requestId, at: fresh ? held.at : Date.now() }); else inDoubt.delete(key); }
    throw e;
  }
}

// Errors are the only messages the screens show (no status bars).
export function showError(text) {
  if (text && typeof text === 'object') text = friendlyError(text);
  if (text) drawn();
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
  // Joe 10/16: a save redraws the table; the table and the page stay where they were scrolled instead of jumping.
  const box = sheet.closest('.side-main') || document.scrollingElement;
  const keepSheet = sheet.scrollTop, keepBox = box.scrollTop;
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
  const over = () => box.scrollHeight > box.clientHeight + 1 || document.scrollingElement.scrollHeight > window.innerHeight;
  while (row > FIT_ROW_MIN && over()) apply(--row);
  if (over()) {
    // Still too many lines at the smallest readable size: the table scrolls, its header stays put.
    sheet.classList.add('fit-scroll');
    sheet.style.maxHeight = Math.max(160, Math.min(window.innerHeight, box.getBoundingClientRect().bottom || window.innerHeight) - top - footerH - 8) + 'px';
  }
  if (sheet.scrollTop !== keepSheet) sheet.scrollTop = keepSheet;
  if (box.scrollTop !== keepBox) box.scrollTop = keepBox;
}
const FIT_ROW_MIN = 32, FIT_FONT_MIN = 16;

// Joe 10/12: a screen not switched on in Administration > Go-Live Switches says so on the screen itself, in one short line
// under the title (the cards carry no tags, and the TEST COPY box is hidden). show = false takes the line away.
export function goLiveNote(show) {
  let el = document.getElementById('golive-note');
  if (!show) { if (el) el.hidden = true; return; }
  if (!el) {
    const badge = document.getElementById('mode-text');
    const after = badge && badge.closest('.badge-test') ? badge.closest('.badge-test').parentElement : document.querySelector('main > *');
    if (!after) return;
    el = document.createElement('div');
    el.id = 'golive-note';
    el.className = 'golive-note';
    el.textContent = 'View only until switched on in Go-Live Switches.';
    after.insertAdjacentElement('afterend', el);
  }
  el.hidden = false;
}

export function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Review item 76 (Joe 10/13): one drop-down choice, picked when it is the current value. opts.loose matches as text (a number
// or a blank current still picks it).
export function optionTag(value, current, label, opts) {
  const on = opts && opts.loose ? String(value) === String(current || '') : value === current;
  return '<option value="' + escapeHtml(value) + '"' + (on ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
}

// Review item 76 (Joe 10/13): minutes as hours and minutes, blank for no number. Each screen keeps its own look: unit is the
// word after the minutes ('min', or 'm'), short the word under an hour (the unit when left out), pad writes the minutes past
// the hour with two digits (1 h 05), hoursFrom is where hours start (60 minutes when left out).
export function hoursMinutesText(m, opts) {
  const o = opts || {}, unit = o.unit || 'min';
  if (m === null || m === undefined) return '';
  return m >= (o.hoursFrom || 60) ? Math.floor(m / 60) + ' h ' + (o.pad ? String(m % 60).padStart(2, '0') : m % 60) + ' ' + unit : m + ' ' + (o.short || unit);
}

// Review item 76 (Joe 10/13): prints a page of HTML from a hidden frame, so the screen stays where it is. opts.id names the
// frame (one left from an earlier print is taken away first), opts.wait is the pause before printing (150 ms when left out)
// and opts.removeAfter takes the frame away that long after printing.
export function printInFrame(html, opts) {
  const o = opts || {};
  const old = o.id && document.getElementById(o.id);
  if (old) old.remove();
  const f = document.createElement('iframe');
  if (o.id) f.id = o.id;
  f.setAttribute('aria-hidden', 'true');
  f.tabIndex = -1;
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  const d = f.contentWindow.document;
  d.open(); d.write(html); d.close();
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); if (o.removeAfter) setTimeout(() => f.remove(), o.removeAfter); }, o.wait || 150);
  return f;
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

// A cell marked .no-fit is left as it is (Joe 10/26: a machine's product names stay on one line; the table scrolls instead).
// Shrink to fit (Joe, 10/9): a table cell whose text is too long for it gets a little smaller print, so names and values are
// never cut off. Joe's later rule (10/10) is never to shrink table text to fit: it stops at 16px (review item 56, Joe 10/13), and a cell that still does
// not fit wraps onto a second line (.fit-wrap) instead. Headers keep their size. Runs after every redraw and on resize.
const FIT_MIN = 16;
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
// Joe 10/13 (review item 3): Weekly Dispatch shrinks a driver's name to fit its day box (down to 12px) so the whole week shows
// with every name on one line; only a name that still does not fit wraps.
const WEEKLY_FIT_MIN = 12;
// Joe's 16px rule: on phones and tablets (1024 wide or less) the names never shrink below 16px; a long one wraps instead.
const weeklyFitMin = () => window.innerWidth <= 1024 ? 16 : WEEKLY_FIT_MIN;
// Joe 10/20: a day whose driver is off (NEEDS DRIVER on red) keeps 16px print and wraps instead.
function fitMin(td) { return td.classList.contains('day') && !td.classList.contains('c-vacation-needs') && td.closest('.weekly-page .sheet.week') ? weeklyFitMin() : FIT_MIN; }
function fitCells() {
  fitQueued = false;
  const cells = [...document.querySelectorAll('tbody td')].filter(td => td.offsetParent && td.textContent.trim() && !td.querySelector('input, textarea, select, table') && !td.classList.contains('details-cell') && !td.classList.contains('no-fit') && td.colSpan === 1);
  cells.forEach(td => { if (td.dataset.fit) { td.style.fontSize = ''; delete td.dataset.fit; } td.classList.remove('fit-wrap'); });
  let over = cells.filter(tooWide);
  const wrap = [];
  for (let pass = 0; over.length && pass < 8; pass++) {
    const sizes = over.map(td => parseFloat(getComputedStyle(td).fontSize));
    over = over.filter((td, i) => { const min = fitMin(td); if (sizes[i] <= min) { wrap.push(td); return false; } td.style.fontSize = Math.max(min, sizes[i] - 1) + 'px'; td.dataset.fit = '1'; return true; });
    over = over.filter(tooWide);
  }
  wrap.concat(over).forEach(td => td.classList.add('fit-wrap'));
}
function queueFit() { if (!fitQueued) { fitQueued = true; requestAnimationFrame(fitCells); } }
// Joe 10/21: a screen that redraws on a save fits its cells at once, so rows already have their final height when it puts the
// scroll place back (otherwise a row that wraps a frame later makes the grid jump).
export function fitNow() { fitCells(); }
// Joe 10/21 (screens slow): only a change in a table sets the fitting off again, not a clock or a number elsewhere on the screen.
const inTable = (m) => {
  const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
  return !!(t && t.closest('table')) || [...m.addedNodes].some(n => n.nodeType === 1 && (/^(TABLE|TBODY|TR|TD)$/.test(n.tagName) || n.querySelector('tbody')));
};
new MutationObserver(ms => { if (!fitQueued && ms.some(inTable)) queueFit(); }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
window.addEventListener('resize', queueFit);

// Review item 2 (Joe 10/13): every date box reads 10-8-26 like the rest of the app, not the browser's 10/08/2026. The browser's
// own box stays underneath (its calendar, typing and value are unchanged); the short date is drawn over it, and while the box
// is being typed in the browser's own text shows.
const DATE_VALUE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
function dressDate(input) {
  if (input.dataset.shortDate) return;
  input.dataset.shortDate = '1';
  const parent = input.parentElement;
  if (!parent) return;
  if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
  const face = document.createElement('span');
  face.className = 'ud-date-face';
  face.setAttribute('aria-hidden', 'true');
  input.after(face);
  let typing = false;
  const draw = () => {
    const v = DATE_VALUE.get.call(input), show = !!v && !typing && !!input.offsetParent;
    input.classList.toggle('ud-date-dressed', show);
    face.hidden = !show;
    if (!show) return;
    const cs = getComputedStyle(input);
    face.textContent = shortDay(v);
    face.style.left = (input.offsetLeft + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft)) + 'px';
    face.style.top = input.offsetTop + 'px';
    face.style.height = input.offsetHeight + 'px';
    face.style.width = Math.max(0, input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 24) + 'px';
    face.style.justifyContent = cs.textAlign === 'center' ? 'center' : cs.textAlign === 'right' || cs.textAlign === 'end' ? 'flex-end' : 'flex-start';
    ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing'].forEach(k => { face.style[k] = cs[k]; });
    face.style.color = cs.color;
  };
  // A screen that sets the box's value in code redraws it too.
  Object.defineProperty(input, 'value', { configurable: true, get() { return DATE_VALUE.get.call(this); }, set(v) { DATE_VALUE.set.call(this, v); draw(); } });
  input.addEventListener('input', draw);
  input.addEventListener('change', draw);
  input.addEventListener('focus', () => { typing = true; draw(); });
  input.addEventListener('blur', () => { typing = false; draw(); });
  if (window.ResizeObserver) new ResizeObserver(draw).observe(input);
  draw();
}
function dressDates() { document.querySelectorAll('input[type="date"]:not([data-short-date])').forEach(dressDate); }
new MutationObserver(dressDates).observe(document.documentElement, { childList: true, subtree: true });
dressDates();
