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
  brand.innerHTML = '<img src="img/ud-logo.webp" alt="United Dairy"><span><strong>United Dairy Operations</strong><small>ROUTE DISTRIBUTION &middot; NEW APP</small></span>';
  bar.prepend(brand);
});
// The left-hand menu on every desktop screen: every screen by name, the one you are on lit in gold.
const RAIL = [
  ['index.html', 'Home', '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>'],
  ['daily.html', 'Daily Dispatch', '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>'],
  ['weekly.html', 'Weekly Dispatch', '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'],
  ['drivers.html', 'Drivers', '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.6c2.6.2 4.4 1.9 5 5"/>'],
  ['checkins.html', 'Driver Check-ins', '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 12l3 3 5-6"/>'],
  ['vacations.html', 'Vacation Schedule', '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'],
  ['equipment.html', 'Equipment', '<path d="M2 6h11v10H2zM13 9h5l3 4v3h-8z"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>'],
  ['routes.html', 'Route Editor', '<path d="M6 19a2 2 0 1 0 0-.01M18 5a2 2 0 1 0 0-.01"/><path d="M6 17V9a4 4 0 0 1 4-4h6M18 7v8a4 4 0 0 1-4 4H8"/>'],
  ['conflicts.html', 'Sheet Conflicts', '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>']
];
const here = (location.pathname.split('/').pop() || 'index.html');
const screenBox = document.getElementById('screen');
if (screenBox && here !== 'index.html' && !document.body.classList.contains('phone') && !screenBox.querySelector('.rail')) {
  const rail = document.createElement('nav');
  rail.className = 'rail';
  rail.setAttribute('aria-label', 'Screens');
  rail.innerHTML = RAIL.map(([href, name, icon]) => '<a href="' + href + '"' + (href === here ? ' class="here" aria-current="page"' : '') + ' title="' + name + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + icon + '</svg><span>' + name + '</span></a>').join('');
  const bar = screenBox.querySelector('.topbar');
  if (bar) bar.after(rail); else screenBox.prepend(rail);
  document.body.classList.add('with-rail');
  const place = () => document.documentElement.style.setProperty('--bar-h', (bar ? bar.offsetHeight : 0) + 'px');
  new ResizeObserver(place).observe(bar || document.body);
}
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
  const { auth } = await start();
  const gate = document.getElementById('signin');
  onAuthStateChanged(auth, async (user) => {
    if (user && !isUnitedDairy(user)) {
      await signOut(auth);
      showError('Only United Dairy Google accounts can use this app. You were signed out.');
      return;
    }
    if (!user) { gate.hidden = false; document.getElementById('screen').hidden = true; return; }
    // The database shows dispatch data only to people ACTIVE in USERS_MASTER; say so plainly instead of a blank screen.
    const { db } = await start();
    const entry = await getDoc(doc(db, 'users', String(user.email).toLowerCase())).catch(() => null);
    if (!entry || !entry.exists() || entry.data().status !== 'ACTIVE') {
      await signOut(auth);
      showError(user.email + ' is not an active user in the Users list. Ask an administrator to add you.');
      return;
    }
    gate.hidden = true;
    document.getElementById('screen').hidden = false;
    const who = document.getElementById('who');
    if (who) who.textContent = user.email;
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
export function fitToWindow(lineCount) {
  const sheet = document.querySelector('.sheet');
  if (!sheet) return;
  const top = sheet.getBoundingClientRect().top;
  const footer = document.querySelector('.footer');
  const room = window.innerHeight - top - (footer ? footer.offsetHeight : 0) - 8;
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
