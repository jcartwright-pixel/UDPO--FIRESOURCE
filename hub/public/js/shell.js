/*
 * The hub's frame (Joe 11-2-26: "one app that would branch out to everything"): sign-in, the header, the menu and the one
 * server call. Copied from the Customer List's frame so it looks and signs in the same way: the same Firebase project as
 * Operations, so the same United Dairy Google sign-in and the same Users list decide who gets in.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithPopup, signInWithCredential, signOut, GoogleAuthProvider, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js';

const DOMAIN = 'uniteddairy.com';
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const HERE = location.pathname.split('/').pop() || 'index.html';
const QS = new URLSearchParams(location.search);

// The screens, in the menu's order.
export const SCREENS = [
  { href: 'index.html', name: 'Home', note: 'Every United Dairy app you can open' },
  { href: 'people.html', name: 'People & Access', note: 'Administrators: who signs in, their role, plants and apps', admin: true },
  { href: 'roles.html', name: 'Roles & Rights', note: 'Administrators: what each role (Manager, Supervisor, Dispatcher...) may do', admin: true },
  { href: 'links.html', name: 'Links & Codes', note: 'Administrators: the links and codes for managers, stations, tablets and drivers\' phones', admin: true },
  { href: 'email.html', name: 'Email & Texts', note: 'Administrators: who gets each email and text, and who it comes from', admin: true },
  { href: 'keys.html', name: 'Keys & Connections', note: 'Administrators: the Verizon Connect, RedZone, MOCREO and Twilio sign-ins', admin: true },
  { href: 'help.html', name: 'Help', note: 'How the hub works' }
];

let services = null;
async function start() {
  if (services) return services;
  const config = LOCAL ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-ud-distribution', appId: 'demo-app' } : await (await fetch('/__/firebase/init.json')).json();
  const app = initializeApp(config);
  const auth = getAuth(app), functions = getFunctions(app, 'us-east4');
  if (LOCAL) { connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); connectFunctionsEmulator(functions, '127.0.0.1', 5001); }
  services = { app, auth, functions };
  return services;
}

export async function callServer(name, fields) {
  const { functions } = await start();
  const res = await httpsCallable(functions, name, { timeout: 30000 })(fields || {});
  return res.data;
}

export function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function serverText(err, what) {
  const code = String(err && err.code || '').replace(/^functions\//, ''), msg = String(err && err.message || err || '');
  if (code === 'internal' || code === 'unknown' || /^(internal|unknown)\b/i.test(msg) || !msg) return 'Could not reach ' + what + '. Check the network and try again.';
  return msg;
}

export function showError(text) {
  if (text && typeof text === 'object') text = serverText(text, 'the server');
  ['error', 'signin-error'].forEach(id => { const box = document.getElementById(id); if (box) { box.textContent = text || ''; box.hidden = !text; } });
}

// One short date everywhere, like 11-1-26 (Eastern time).
export function shortDate(v) {
  if (v == null || v === '') return '';
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(String(v));
  if (m) return Number(m[2]) + '-' + Number(m[3]) + '-' + m[1].slice(2);
  const t = v instanceof Date ? v : new Date(typeof v === 'number' ? v : String(v));
  if (isNaN(t)) return String(v);
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: '2-digit', month: 'numeric', day: 'numeric' }).formatToParts(t);
  const g = (k) => (p.find(x => x.type === k) || {}).value;
  return g('month') + '-' + g('day') + '-' + g('year');
}

/* ---------- the installed app (its own window and icon, like the other apps) ---------- */
if ('serviceWorker' in navigator && !LOCAL) navigator.serviceWorker.register('sw.js').catch(() => {});
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (ev) => { ev.preventDefault(); installPrompt = ev; document.dispatchEvent(new Event('hub-installable')); });
/** Whether this window is already the installed app. */
export const installed = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
/** Opens the browser's own Install box (Chrome or Edge on a computer); false when the browser has none to give. */
export async function installApp() {
  if (!installPrompt) return false;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null;
  return true;
}
export const canInstall = () => !!installPrompt;

/* ---------- the header and the menu ---------- */
const hereHref = () => HERE;
// Administration shows at once for whoever was an administrator last time; the server checks again on every call.
export function setAdmin(on) {
  document.body.classList.toggle('is-admin', !!on);
  try { localStorage.setItem('hub.admin', on ? '1' : '0'); } catch (e) { /* no storage */ }
}
function drawFrame() {
  try { document.body.classList.toggle('is-admin', localStorage.getItem('hub.admin') === '1'); } catch (e) { /* no storage */ }
  const bar = document.querySelector('#screen > .topbar');
  if (bar && !bar.querySelector('.brand')) {
    const brand = document.createElement('a');
    brand.className = 'brand'; brand.href = 'index.html';
    brand.innerHTML = '<img src="img/ud-logo.webp" alt="United Dairy"><span><strong>United Dairy Hub</strong><small>Every app in one place</small></span>';
    bar.prepend(brand);
    const help = document.createElement('a');
    help.href = 'help.html#' + (document.body.dataset.help || 'home'); help.textContent = '? Help'; help.className = 'help-link';
    bar.insertBefore(help, document.getElementById('who'));
  }
  const screen = document.getElementById('screen');
  if (screen && !document.getElementById('hub-nav') && document.body.dataset.nav !== 'none') {
    const nav = document.createElement('nav');
    nav.id = 'hub-nav'; nav.className = 'hub-nav'; nav.setAttribute('aria-label', 'Hub screens');
    nav.innerHTML = SCREENS.filter(s => s.href !== 'help.html').map(s => '<a href="' + s.href + '"' + (s.admin ? ' class="admin-only"' : '') + (s.href === hereHref() ? ' aria-current="page"' : '') + '>' + escapeHtml(s.name) + '</a>').join('');
    bar.insertAdjacentElement('afterend', nav);
  }
  if (screen && !document.getElementById('screen-loading')) {
    const wait = document.createElement('div');
    wait.id = 'screen-loading'; wait.className = 'screen-loading'; wait.setAttribute('role', 'status'); wait.textContent = 'Reading your apps…';
    screen.appendChild(wait);
  }
}

/** Shows the screen once someone with a United Dairy account is signed in; ready(user) then reads the list. */
export async function requireSignIn(ready) {
  document.body.classList.add('waiting');
  drawFrame();
  const gate = document.getElementById('signin'), screen = document.getElementById('screen');
  const { auth } = await start();
  onAuthStateChanged(auth, async (user) => {
    if (!user) { gate.hidden = false; screen.hidden = true; return; }
    const email = String(user.email || '').toLowerCase();
    if (!user.emailVerified || !email.endsWith('@' + DOMAIN)) {
      await signOut(auth);
      showError('Only United Dairy Google accounts can use the hub. You were signed out.');
      return;
    }
    gate.hidden = true; screen.hidden = false;
    const who = document.getElementById('who');
    if (who) {
      const parts = String(user.displayName || '').trim().split(/\s+/).filter(Boolean);
      who.textContent = (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || email).slice(0, 2)).toUpperCase();
      who.title = email; who.classList.add('initials');
    }
    try { await ready(user); } finally { document.body.classList.remove('waiting'); }
  });
  const btn = document.getElementById('signin-button');
  if (btn) btn.addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ hd: DOMAIN, prompt: 'select_account' });
    try { await signInWithPopup(auth, provider); } catch (e) { showError('Sign-in did not finish: ' + (e.message || e)); }
  });
  const out = document.getElementById('signout');
  if (out) out.addEventListener('click', () => signOut(auth));
  // Local testing only: the emulator takes a made-up Google sign-in (?testEmail=someone@uniteddairy.com).
  const testEmail = LOCAL && QS.get('testEmail');
  if (testEmail) {
    await auth.authStateReady();
    if (!auth.currentUser || auth.currentUser.email !== testEmail) {
      const token = JSON.stringify({ sub: 'test-' + testEmail, email: testEmail, email_verified: true });
      await signInWithCredential(auth, GoogleAuthProvider.credential(token)).catch(e => showError(String(e.message || e)));
    }
  }
}

/* ---------- Update ready: the same yellow line as the other apps. version.json (written by the deploy, tools/stamp-version.cjs)
   is read again every 3 minutes and whenever the window comes back; a newer one shows the banner with a Refresh button. ---------- */
const UPDATE_CHECK_MS = 3 * 60000;
const readVersion = () => fetch('version.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
let firstVersion = null, updateShown = false;
function updateBanner() {
  if (updateShown) return;
  updateShown = true;
  const box = document.createElement('div');
  box.id = 'update-ready'; box.className = 'update-ready'; box.setAttribute('role', 'status');
  box.innerHTML = '<span><b>Update ready.</b> A new version of the hub is out. Press Refresh to get it.</span><button type="button" id="update-refresh">Refresh</button>';
  const head = document.querySelector('#screen > .topbar') || document.querySelector('.topbar');
  if (head && head.parentNode) head.after(box); else document.body.prepend(box);
  box.querySelector('button').addEventListener('click', () => {
    const btn = box.querySelector('button');
    btn.disabled = true; btn.textContent = 'Refreshing…';
    location.reload();
  });
}
async function checkForUpdate() {
  if (updateShown) return;
  if (!firstVersion) { firstVersion = await readVersion(); return; }
  if (!firstVersion.commit) return;
  const now = await readVersion();
  if (now && now.commit && now.commit !== firstVersion.commit) updateBanner();
}
if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || QS.get('updatetest') === '1') {
  checkForUpdate();
  setInterval(checkForUpdate, UPDATE_CHECK_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
  window.addEventListener('focus', checkForUpdate);
  window.addEventListener('online', checkForUpdate);
}
window.HUB_checkForUpdate = checkForUpdate;

/** The signed-in person's email (lower case), or '' before sign-in. */
export const myEmail = () => String(services && services.auth.currentUser && services.auth.currentUser.email || '').toLowerCase();
