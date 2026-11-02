/*
 * The Sales app. Joe 11/1 (mock-up 1): it opens on two cards, Where the routes are and Customers by route.
 * Where the routes are (Joe 10/31, mock-up 2d): the map stays on top, every route of the division scrolls under it, and a tap
 * on a route moves the map to that truck. Joe 11/1 (mock-up 3): each route is two lines, route and status, then driver · where now.
 * Customers by route (Joe 11/1, mock-ups 2 and 3): pick a route and a day to see every customer on it, or type a customer to
 * see every day and route it gets a delivery, or (mock-ups 4 and 5) open a group like Dairy Queen to see its customers. From the
 * division's customer list (Administration > Sales App). Read only. Any United Dairy account may use it ("as long
 * as they have a United Dairy account, they can use it. No other access information is needed."), so it is not checked against
 * the Users list. The rows come from the server (functions/src/salesapp.js), the same status words as the 6:00 AM sales email.
 */
import { start, isUnitedDairy, callServer, escapeHtml } from './app.js';
import { onAuthStateChanged, signInWithPopup, signInWithCredential, signOut, GoogleAuthProvider } from './firebase.js';
import { loadHelp, sectionForPage, renderBody } from './help.js';

const REFRESH_MS = 2 * 60 * 1000;
const DIVISION_KEY = 'udSalesDivision';
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const $ = (id) => document.getElementById(id);

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const VIEWS = ['home', 'routes', 'customers', 'help'];
const TITLES = { home: 'UD Sales', routes: 'Route Status', customers: 'Customers', help: 'Help' };

let view = 'home';
let helpFrom = 'home';  // Joe 11/1: the screen the ? was pressed on (Back from Help comes back to it)
let helpPart = '';
let picked = '';     // the route on the map (its id)
let rows = {};       // id -> row
let timer = null;
let loading = false;
let signedIn = false;
// Customers by route: the division's list (read once per division), the tab, the route and day picked.
let cust = null, custDivision = '', custLoading = null, tab = 'route', cuRoute = '', cuDay = '', cuGroup = '', today = '';

const kept = () => { try { return localStorage.getItem(DIVISION_KEY) || ''; } catch (e) { return ''; } };
const keep = (v) => { try { localStorage.setItem(DIVISION_KEY, v); } catch (e) { /* private window */ } };

function showError(text) { const e = $('error'); e.textContent = text || ''; e.hidden = !text; }

function mapUrl(r) { return 'https://maps.google.com/maps?q=' + r.lat + ',' + r.lon + '&z=14&output=embed'; }

// The map shows the picked route; it stays where it is while the list scrolls.
function drawMap() {
  const r = rows[picked], frame = $('sa-map'), none = $('sa-map-none');
  document.querySelectorAll('.sa-row').forEach(b => { const on = b.dataset.id === picked; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  if (!r) {
    $('sa-map-title').textContent = 'Tap a route to see it on the map.';
    $('sa-map-where').textContent = '';
    frame.hidden = true; none.hidden = false; none.textContent = 'No route picked yet.';
    return;
  }
  $('sa-map-title').innerHTML = '<b>' + escapeHtml(r.route + (r.driver ? ' ' + nameCase(r.driver) : '')) + '</b>' + (r.gpsAt ? ', GPS at ' + escapeHtml(r.gpsAt) : '');
  // Joe 11/1: a dropped Save-A-Lot trailer says where and when it was dropped, and where the driver's truck is now.
  $('sa-map-where').textContent = r.note || r.where;
  if (r.lat === null || r.lon === null) {
    frame.hidden = true; none.hidden = false;
    none.textContent = r.by ? 'The GPS has not given a spot for this route yet.' : 'No GPS for this route\'s trailer or truck.';
    return;
  }
  const url = mapUrl(r);
  // A new frame for each move: changing a frame's address would add a step to the phone's Back (Back would move the map).
  if (frame.getAttribute('src') !== url) {
    const next = frame.cloneNode(false);
    next.setAttribute('src', url);
    frame.replaceWith(next);
    next.hidden = false;
  } else frame.hidden = false;
  none.hidden = true;
}

// "KODRIC JR, THOMAS" reads "Kodric Jr, Thomas" (narrower, so the full name fits). Names typed in mixed case stay as typed.
function nameCase(n) {
  const t = String(n || '').trim();
  if (t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s,'-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
}

function drawList(data) {
  rows = {};
  const list = $('sa-list');
  if (!data.groups.length) { list.innerHTML = '<p class="sa-empty">No routes today or yesterday for this division.</p>'; picked = ''; drawMap(); return; }
  list.innerHTML = data.groups.map(g => '<h2 class="sa-group">' + escapeHtml(g.label) + '</h2>' + g.rows.map(r => {
    rows[r.id] = r;
    // Joe 11/1 (mock-up 3): two lines, never more. The route and its status; under it the driver's full name and where
    // the truck is now. Anything too long ends in "…"; tapping the route shows the whole place over the map.
    return '<button type="button" class="sa-row" data-id="' + escapeHtml(r.id) + '" aria-pressed="false">' +
      '<span class="sa-l1"><b class="sa-route">' + escapeHtml(r.route) + '</b>' +
      '<span class="sa-pill ' + escapeHtml(r.tone) + '">' + escapeHtml(r.status) + '</span></span>' +
      '<span class="sa-l2"><b class="sa-driver">' + escapeHtml(nameCase(r.driver) || 'No driver') + '</b>' +
      ' <span class="sa-dot" aria-hidden="true">&middot;</span> <span class="sa-where">' + escapeHtml(r.where) + '</span></span></button>';
  }).join('')).join('');
  if (!rows[picked]) picked = '';
  drawMap();
}

function drawDivisions(data) {
  const sel = $('sa-division');
  sel.innerHTML = data.divisions.map(d => '<option value="' + escapeHtml(d.id) + '"' + (d.id === data.division ? ' selected' : '') + '>' + escapeHtml(d.name) + '</option>').join('');
  sel.value = data.division;
}

async function load() {
  if (loading || view !== 'routes') return;
  loading = true;
  try {
    const data = await callServer('sales', { division: $('sa-division').value || kept() });
    drawDivisions(data);
    $('sa-day').textContent = data.todayText;
    $('sa-refreshed').textContent = data.refreshed;
    showError('');
    drawList(data);
  } catch (e) {
    showError('Could not get the routes: ' + (e && e.message || e) + ' The next refresh tries again.');
  } finally { loading = false; }
}

/* ---------- Customers by route ---------- */

const dayName = (d) => DAY_NAMES[DAYS.indexOf(d)] || d;
const byNumber = (a, b) => a.localeCompare(b, undefined, { numeric: true });
const todayDay = () => (today ? DAYS[new Date(today + 'T12:00:00').getDay()] : '');

async function loadCustomers() {
  const want = $('sa-division').value || kept();
  if (cust && custDivision === want) { drawCustomers(); return; }
  if (custLoading) return custLoading;
  $('cu-list').innerHTML = '<p class="sa-empty">Getting the customers…</p>';
  custLoading = (async () => {
    try {
      const data = await callServer('sales', { division: want, what: 'customers' });
      drawDivisions(data);
      today = data.today || '';
      $('sa-day').textContent = today ? dayName(todayDay()) + ' ' + today.slice(5, 7) + '-' + today.slice(8, 10) + '-' + today.slice(2, 4) : '';
      cust = data.customers || { rows: [] };
      custDivision = data.division;
      showError('');
      const routes = routeList();
      if (!routes.includes(cuRoute)) { cuRoute = ''; cuDay = ''; }
      drawCustomers();
    } catch (e) {
      $('cu-list').innerHTML = '';
      showError('Could not get the customers: ' + (e && e.message || e));
    } finally { custLoading = null; }
  })();
  return custLoading;
}

function routeList() { return [...new Set((cust ? cust.rows : []).map(r => r.route).filter(Boolean))].sort(byNumber); }

function drawCustomers() {
  const rows = cust ? cust.rows : [];
  document.querySelectorAll('.sa-tabs button').forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
  $('cu-by-route').hidden = tab !== 'route';
  $('cu-by-customer').hidden = tab !== 'customer';
  $('cu-by-group').hidden = tab !== 'group';
  if (!rows.length) {
    $('cu-list').innerHTML = '<p class="sa-empty">The customer list has not been loaded for this division yet. Ask the office to load it on Administration, Sales App.</p>';
    $('cu-foot').textContent = '';
    return;
  }
  $('cu-foot').textContent = 'From the customer list loaded ' + (cust.savedAt ? cust.savedAt.slice(5, 7) + '-' + cust.savedAt.slice(8, 10) + '-' + cust.savedAt.slice(2, 4) : '') + '.';
  if (tab === 'route') drawByRoute(rows); else if (tab === 'group') drawByGroup(rows); else drawByCustomer(rows);
}

function drawByRoute(rows) {
  const sel = $('cu-route');
  sel.innerHTML = '<option value="">Pick a route</option>' + routeList().map(r => '<option value="' + escapeHtml(r) + '">' + escapeHtml(r) + '</option>').join('');
  sel.value = cuRoute;
  const on = rows.filter(r => r.route === cuRoute);
  const runs = new Set(on.map(r => r.day));
  if (cuRoute && !runs.has(cuDay)) cuDay = runs.has(todayDay()) ? todayDay() : DAYS.find(d => runs.has(d)) || '';
  $('cu-days').innerHTML = DAYS.map(d => '<button type="button" class="sa-day' + (runs.has(d) ? ' has' : '') + (d === cuDay ? ' on' : '') + '" data-day="' + d + '"' +
    (runs.has(d) ? '' : ' disabled') + ' aria-pressed="' + (d === cuDay) + '">' + dayName(d).slice(0, 3) + '</button>').join('');
  if (!cuRoute) { $('cu-list').innerHTML = '<p class="sa-empty">Pick a route to see its customers.</p>'; return; }
  const list = on.filter(r => r.day === cuDay).sort((a, b) => a.name.localeCompare(b.name));
  $('cu-list').innerHTML = '<h2 class="sa-group">Route ' + escapeHtml(cuRoute) + ', ' + escapeHtml(dayName(cuDay)) + ': ' + list.length + ' customer' + (list.length === 1 ? '' : 's') + '</h2>' +
    list.map(r => '<div class="cu-row"><span>' + escapeHtml(r.name) + '</span><span class="cu-num">' + (r.account ? '#' + escapeHtml(r.account) : '') + '</span></div>').join('');
}

const SHOW_MOST = 40;
function drawByCustomer(rows) {
  const q = $('cu-find').value.trim().toUpperCase();
  if (q.length < 2) { $('cu-list').innerHTML = '<p class="sa-empty">Type at least 2 letters or numbers.</p>'; return; }
  const found = new Map();
  rows.forEach(r => {
    if (!(r.name.toUpperCase().includes(q) || (r.account && r.account.startsWith(q)))) return;
    const key = r.account || r.name;
    if (!found.has(key)) found.set(key, { name: r.name, account: r.account, days: [] });
    found.get(key).days.push(r);
  });
  const all = [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (!all.length) { $('cu-list').innerHTML = '<p class="sa-empty">No customer matches "' + escapeHtml($('cu-find').value.trim()) + '".</p>'; return; }
  $('cu-list').innerHTML = all.slice(0, SHOW_MOST).map(c => '<div class="cu-res"><h3><span>' + escapeHtml(c.name) + '</span><span class="cu-num">' + (c.account ? '#' + escapeHtml(c.account) : '') + '</span></h3>' +
    '<div class="cu-grid"><b>Delivery day</b><b>Route</b>' + c.days.sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || byNumber(a.route, b.route)).map(r => '<span>' + escapeHtml(dayName(r.day)) + '</span>' +
      (r.route ? '<span><button type="button" class="cu-go" data-route="' + escapeHtml(r.route) + '" data-day="' + r.day + '">' + escapeHtml(r.route) + '</button></span>' : '<span class="sa-light">No route</span>')).join('') + '</div></div>').join('') +
    '<p class="sa-foot">' + all.length + ' customer' + (all.length === 1 ? '' : 's') + ' found' + (all.length > SHOW_MOST ? ', the first ' + SHOW_MOST + ' shown. Type more to narrow it down' : '') + '. Tap a route to see everyone else on it that day.</p>';
}

// Joe 11/1 (mock-ups 4 and 5): the groups (Dairy Queen, Walmart, ...; Independents last), then a group's customers, each on one line
// with its number and group and its delivery days and routes underneath.
const NO_GROUP = 'Independents';
function customersOf(rows) {
  const found = new Map();
  rows.forEach(r => { const k = r.account || r.name; if (!found.has(k)) found.set(k, { name: r.name, account: r.account, group: r.group || NO_GROUP, days: [] }); found.get(k).days.push(r); });
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
function drawByGroup(rows) {
  const all = customersOf(rows), count = {};
  all.forEach(c => { count[c.group] = (count[c.group] || 0) + 1; });
  if (cuGroup && !count[cuGroup]) cuGroup = '';
  $('cu-all-groups').hidden = !cuGroup;
  $('cu-group-say').hidden = !!cuGroup;
  if (!cuGroup) {
    const names = Object.keys(count).sort((a, b) => (a === NO_GROUP) - (b === NO_GROUP) || count[b] - count[a] || a.localeCompare(b));
    $('cu-list').innerHTML = names.map(g => '<button type="button" class="cu-grp" data-group="' + escapeHtml(g) + '"><b>' + escapeHtml(g) + '</b><span>' + count[g] + ' customer' + (count[g] === 1 ? '' : 's') + ' &#8250;</span></button>').join('');
    return;
  }
  const list = all.filter(c => c.group === cuGroup);
  $('cu-list').innerHTML = '<h2 class="sa-group">' + escapeHtml(cuGroup) + ': ' + list.length + ' customer' + (list.length === 1 ? '' : 's') + '</h2>' + list.map(c =>
    '<div class="cu-cust"><div class="cu-top"><b>' + escapeHtml(c.name) + '</b><span class="cu-num">' + (c.account ? '#' + escapeHtml(c.account) : '') + '</span></div><div class="cu-num">' + escapeHtml(c.group) + '</div><div class="cu-chips">' +
    c.days.sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || byNumber(a.route, b.route)).map(r => r.route ?
      '<button type="button" class="cu-go" data-route="' + escapeHtml(r.route) + '" data-day="' + r.day + '">' + escapeHtml(dayName(r.day).slice(0, 3) + ' ' + r.route) + '</button>' :
      '<span class="cu-chip">' + escapeHtml(dayName(r.day).slice(0, 3)) + ', no route</span>').join('') + '</div></div>').join('');
}

/* ---------- Help, inside the app ---------- */

// Joe 11/1: "The sales is not supposed to have any other options than just strictly to this app." The ? used to open the
// Operations Help page, which left the Sales app and showed the rest of Operations. Now Help is a screen of this app: only
// the Sales app's own parts of help.md (the parts whose screens are all sales.html), and Back comes back to the screen.
// Nothing on it links anywhere else.
const partName = (t) => { const n = t.replace(/^Sales app:\s*/i, ''); return n.charAt(0).toUpperCase() + n.slice(1); };
const salesParts = (help) => help.sections.filter(x => x.screens.length && x.screens.every(p => p.split('?')[0] === 'sales.html'));
async function drawHelp() {
  let help;
  try { help = await loadHelp(); } catch (e) { $('sa-help-read').innerHTML = '<p>' + escapeHtml(e.message) + '</p>'; return; }
  const parts = salesParts(help);
  const s = parts.find(x => x.id === helpPart) || sectionForPage(help, 'sales.html', helpFrom === 'home' ? '' : 'view=' + helpFrom) || parts[0];
  if (!s) return;
  helpPart = s.id;
  $('sa-help-read').innerHTML = '<h2>' + escapeHtml(partName(s.title)) + '</h2>' + renderBody(s.body);
  // A link to a part that is not the Sales app's own stays plain words (it would lead out of the app).
  $('sa-help-read').querySelectorAll('a').forEach(a => {
    if (parts.some(x => x.id === a.dataset.helpLink)) { a.removeAttribute('href'); a.setAttribute('role', 'button'); a.tabIndex = 0; return; }
    a.replaceWith(document.createTextNode(a.textContent));
  });
  const others = parts.filter(x => x.id !== s.id);
  $('sa-help-more').innerHTML = others.length ? '<p class="sa-lbl">More help</p>' + others.map(x => '<button type="button" class="sa-helpgo" data-help-link="' + escapeHtml(x.id) + '">' + escapeHtml(partName(x.title)) + '</button>').join('') : '';
}
function helpAddress() { return 'sales.html?view=help' + (helpFrom !== 'home' ? '&for=' + helpFrom : '') + keepTest('&'); }

/* ---------- The views ---------- */

function showView(v, push) {
  view = VIEWS.includes(v) ? v : 'home';
  if (view === 'help') { const f = new URLSearchParams(location.search).get('for'); if (!push && VIEWS.includes(f) && f !== 'help') helpFrom = f; }
  if (push) history.pushState({ view }, '', view === 'home' ? 'sales.html' + keepTest() : view === 'help' ? helpAddress() : 'sales.html?view=' + view + keepTest('&'));
  $('v-home').hidden = view !== 'home';
  $('v-routes').hidden = view !== 'routes';
  $('v-customers').hidden = view !== 'customers';
  $('v-help').hidden = view !== 'help';
  $('sa-top').hidden = view === 'help';
  $('sa-maparea').hidden = view !== 'routes';
  $('sa-ref-line').hidden = view !== 'routes';
  $('sa-back').hidden = view === 'home';
  $('sa-help').hidden = view === 'help' || !signedIn;
  $('sa-title').textContent = TITLES[view];
  window.scrollTo(0, 0);
  if (view === 'help') { drawHelp(); return; }
  if (!signedIn) return;
  if (view === 'routes') load();
  if (view === 'customers') loadCustomers();
  // The home cards still show the date and the division: the customer call brings both (and has the list ready).
  if (view === 'home' && !$('sa-division').options.length) loadCustomers();
}
// Local testing keeps its made-up sign-in in the address.
function keepTest(join) { const t = new URLSearchParams(location.search).get('testEmail'); return t ? (join || '?') + 'testEmail=' + encodeURIComponent(t) : ''; }
// The routes' map sits right under the header, which stays on top.
const fitTop = () => document.documentElement.style.setProperty('--sa-hdr-h', document.querySelector('.sa-hdr').offsetHeight + 'px');
window.addEventListener('resize', fitTop);
fitTop();

function startRefreshing() {
  clearInterval(timer);
  timer = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
  showView(view, false);
}

$('sa-list').addEventListener('click', (ev) => {
  const b = ev.target.closest('.sa-row');
  if (!b) return;
  picked = b.dataset.id;
  drawMap();
});
$('sa-division').addEventListener('change', () => {
  keep($('sa-division').value); picked = ''; $('sa-list').innerHTML = ''; cust = null; cuRoute = ''; cuDay = ''; cuGroup = '';
  if (view === 'routes') load();
  if (view === 'customers') loadCustomers();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('screen').hidden) load(); });
$('v-home').addEventListener('click', (ev) => { const b = ev.target.closest('[data-go]'); if (b) showView(b.dataset.go, true); });
// Back: a group open on Customers closes first (back to the group list); otherwise one screen back, and from Help to the
// screen the ? was pressed on. It never leaves the Sales app.
$('sa-back').addEventListener('click', () => {
  if (view === 'customers' && tab === 'group' && cuGroup) { cuGroup = ''; drawCustomers(); window.scrollTo(0, 0); return; }
  if (history.state && history.state.view) { history.back(); return; }
  const to = view === 'help' ? helpFrom : 'home';
  history.replaceState(null, '', to === 'home' ? 'sales.html' + keepTest() : 'sales.html?view=' + to + keepTest('&'));
  showView(to, false);
});
$('sa-help').addEventListener('click', () => { if (view === 'help') return; helpFrom = view; helpPart = ''; showView('help', true); });
$('v-help').addEventListener('click', (ev) => {
  const a = ev.target.closest('[data-help-link]');
  if (a) { ev.preventDefault(); helpPart = a.dataset.helpLink; drawHelp(); window.scrollTo(0, 0); }
});
$('v-help').addEventListener('keydown', (ev) => { const a = ev.target.closest('a[data-help-link]'); if (a && ev.key === 'Enter') { ev.preventDefault(); a.click(); } });
window.addEventListener('popstate', () => showView(new URLSearchParams(location.search).get('view') || 'home', false));
$('v-customers').addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-tab]');
  if (t) { tab = t.dataset.tab; drawCustomers(); if (tab === 'customer') $('cu-find').focus(); return; }
  const gr = ev.target.closest('.cu-grp');
  if (gr) { cuGroup = gr.dataset.group; drawCustomers(); window.scrollTo(0, 0); return; }
  if (ev.target.closest('#cu-all-groups')) { cuGroup = ''; drawCustomers(); return; }
  const d = ev.target.closest('.sa-day');
  if (d && !d.disabled) { cuDay = d.dataset.day; drawCustomers(); return; }
  const g = ev.target.closest('.cu-go');
  if (g) { tab = 'route'; cuRoute = g.dataset.route; cuDay = g.dataset.day; drawCustomers(); window.scrollTo(0, 0); }
});
$('cu-route').addEventListener('change', () => { cuRoute = $('cu-route').value; cuDay = ''; drawCustomers(); });
$('cu-find').addEventListener('input', () => drawCustomers());
view = VIEWS.includes(new URLSearchParams(location.search).get('view')) ? new URLSearchParams(location.search).get('view') : 'home';
showView(view, false);

const { auth } = await start();
$('signin-button').addEventListener('click', async () => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ hd: 'uniteddairy.com', prompt: 'select_account' });
  try { await signInWithPopup(auth, provider); } catch (e) { showError('Sign-in did not finish: ' + (e.message || e)); }
});
$('signout').addEventListener('click', () => signOut(auth));
onAuthStateChanged(auth, async (user) => {
  if (user && !isUnitedDairy(user)) {
    await signOut(auth);
    showError('Only United Dairy Google accounts can use this app. You were signed out.');
    return;
  }
  $('signin').hidden = !!user;
  $('screen').hidden = !user;
  signedIn = !!user;
  if (!user) { clearInterval(timer); $('sa-help').hidden = true; return; }
  showError('');
  $('who').textContent = user.email || '';
  startRefreshing();
});
// Local testing only: the test database accepts a made-up Google sign-in (?testEmail=someone@uniteddairy.com).
const testEmail = LOCAL && new URLSearchParams(location.search).get('testEmail');
if (testEmail) {
  await auth.authStateReady();
  if (!auth.currentUser) {
    const token = JSON.stringify({ sub: 'test-' + testEmail, email: testEmail, email_verified: true });
    await signInWithCredential(auth, GoogleAuthProvider.credential(token)).catch(e => showError(String(e.message || e)));
  }
}
