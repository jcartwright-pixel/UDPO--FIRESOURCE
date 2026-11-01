/*
 * The Sales app (Joe 10/31, mock-up 2d): the map stays on top, every route of the division scrolls under it (Route, Driver,
 * Status, Where now), and a tap on a route moves the map to that truck. Read only. Any United Dairy account may use it ("as long
 * as they have a United Dairy account, they can use it. No other access information is needed."), so it is not checked against
 * the Users list. The rows come from the server (functions/src/salesapp.js), the same status words as the 6:00 AM sales email.
 */
import { start, isUnitedDairy, callServer, escapeHtml } from './app.js';
import { onAuthStateChanged, signInWithPopup, signInWithCredential, signOut, GoogleAuthProvider } from './firebase.js';
import { helpHref } from './help.js';

const REFRESH_MS = 2 * 60 * 1000;
const DIVISION_KEY = 'udSalesDivision';
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const $ = (id) => document.getElementById(id);

let picked = '';     // the route on the map (its id)
let rows = {};       // id -> row
let timer = null;
let loading = false;

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
  $('sa-map-title').innerHTML = '<b>' + escapeHtml(r.route + (r.driver ? ' ' + r.driver : '')) + '</b>' + (r.gpsAt ? ', GPS at ' + escapeHtml(r.gpsAt) : '');
  $('sa-map-where').textContent = r.where;
  if (r.lat === null || r.lon === null) {
    frame.hidden = true; none.hidden = false;
    none.textContent = r.by ? 'The GPS has not given a spot for this route yet.' : 'No GPS for this route\'s trailer or truck.';
    return;
  }
  const url = mapUrl(r);
  if (frame.getAttribute('src') !== url) frame.setAttribute('src', url);
  frame.hidden = false; none.hidden = true;
}

function drawList(data) {
  rows = {};
  const list = $('sa-list');
  if (!data.groups.length) { list.innerHTML = '<p class="sa-empty">No routes today or yesterday for this division.</p>'; picked = ''; drawMap(); return; }
  list.innerHTML = data.groups.map(g => '<h2 class="sa-group">' + escapeHtml(g.label) + '</h2>' + g.rows.map(r => {
    rows[r.id] = r;
    return '<button type="button" class="sa-row" data-id="' + escapeHtml(r.id) + '" aria-pressed="false">' +
      '<b class="sa-route">' + escapeHtml(r.route) + '</b>' +
      '<span class="sa-driver">' + escapeHtml(r.driver || 'No driver') + '</span>' +
      '<span><span class="sa-pill ' + escapeHtml(r.tone) + '">' + escapeHtml(r.status) + '</span></span>' +
      '<span class="sa-where">' + escapeHtml(r.where) + '</span></button>';
  }).join('')).join('');
  if (!rows[picked]) picked = '';
  drawMap();
}

async function load() {
  if (loading) return;
  loading = true;
  try {
    const data = await callServer('sales', { division: $('sa-division').value || kept() });
    const sel = $('sa-division');
    sel.innerHTML = data.divisions.map(d => '<option value="' + escapeHtml(d.id) + '"' + (d.id === data.division ? ' selected' : '') + '>' + escapeHtml(d.name) + '</option>').join('');
    sel.value = data.division;
    $('sa-day').textContent = data.todayText;
    $('sa-refreshed').textContent = data.refreshed;
    showError('');
    drawList(data);
  } catch (e) {
    showError('Could not get the routes: ' + (e && e.message || e) + ' The next refresh tries again.');
  } finally { loading = false; }
}

function startRefreshing() {
  clearInterval(timer);
  timer = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
  load();
}

$('sa-list').addEventListener('click', (ev) => {
  const b = ev.target.closest('.sa-row');
  if (!b) return;
  picked = b.dataset.id;
  drawMap();
});
$('sa-division').addEventListener('change', () => { keep($('sa-division').value); picked = ''; $('sa-list').innerHTML = ''; load(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('screen').hidden) load(); });
$('sa-help').href = helpHref();

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
  if (!user) { clearInterval(timer); return; }
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
