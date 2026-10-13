// Joe 10/12: the Safety Walkthrough is done on an iPad walking the plant, where there is often no secure Wi-Fi. A save made
// with no connection is kept on the iPad (IndexedDB, so closing the page or the iPad loses nothing) and sent, in the order it
// was made, as soon as the connection is back. Each save keeps its own requestId, so one sent twice is only saved once.
// sw.js keeps the screens themselves on the iPad so they open with no signal.
// Joe 10/13: the Plant, Garage and Driver's Kiosk stations use the same: startOffline(pages, { device: 'tablet', ... }) keeps
// the station's screen on the tablet and its saves wait here with the "Saved on this tablet" line.
import { start, saveNow, callServer, friendlyError, showError } from './app.js';

const DB = 'udOfflineSaves', STORE = 'saves', CACHE = 'ud-offline-v1';
const listeners = [];
let flushing = false, failedText = '', device = 'device', sentAt = 0;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode), store = tx.objectStore(STORE);
    let out;
    Promise.resolve(fn(store)).then(v => { out = v; });
    tx.oncomplete = () => { db.close(); resolve(out); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
const all = () => run('readonly', store => new Promise(res => { const r = store.getAll(); r.onsuccess = () => res(r.result || []); }));
const add = (entry) => run('readwrite', store => { store.add(entry); });
const remove = (key) => run('readwrite', store => { store.delete(key); });

const rid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/[^A-Za-z0-9_-]/g, '');
// No connection (as opposed to the server refusing the save, which is shown and not kept).
export function isNoConnection(e) {
  const code = String(e && e.code || '').replace(/^functions\//, ''), msg = String(e && e.message || e || '');
  return !navigator.onLine || code === 'unavailable' || code === 'deadline-exceeded' || /network|Failed to fetch|offline|internal/i.test(code + ' ' + msg) && !/permission|refused/i.test(msg);
}
async function me() {
  const { auth } = await start();
  return String((auth.currentUser && auth.currentUser.email) || '').toLowerCase();
}

// The saves still on this iPad (all of them, or one kind), oldest first.
export async function waiting(action) {
  const list = await all().catch(() => []);
  return list.filter(e => !action || e.action === action).sort((a, b) => a.key - b.key);
}
// A screen hears when the waiting list changes (to redraw what it shows as saved here).
export function onWaitingChange(fn) { listeners.push(fn); }
async function changed() {
  const list = await waiting();
  drawLine(list.length);
  listeners.forEach(fn => { try { fn(list); } catch (e) { /* a screen's own problem */ } });
}

// The warning line (no pop-ups): how many saves are on this iPad and whether there is a connection.
function drawLine(n) {
  const box = document.getElementById('offline-line');
  if (!box) return;
  const text = device === 'tablet'
    ? (n ? (navigator.onLine ? 'Sending what was saved on this tablet: ' + n : 'Saved on this tablet, will send when you have signal. Waiting: ' + n)
      : !navigator.onLine ? 'No signal. What you enter is saved on this tablet and sent when you have signal.'
        : failedText || (Date.now() - sentAt < 8000 ? 'Sent ✓ Everything saved on this tablet has gone through.' : ''))
    : n ? (navigator.onLine ? 'Sending saves made on this device: ' + n : 'Saved on this device, sends when online: ' + n)
      : !navigator.onLine ? 'No internet. Taps, notes and photos are saved on this device and sent when it is back.' : failedText;
  box.textContent = text;
  box.hidden = !text;
  box.classList.toggle('error', !n && navigator.onLine && !!failedText);
  box.classList.toggle('ok', !n && navigator.onLine && !failedText && !!text);
}

// Save now when there is a connection; otherwise (or when the connection drops on the way) keep it on this iPad. Saves made
// while others are still waiting wait behind them, so they reach the server in the order they were made.
export async function offlineSave(action, fields) {
  const entry = { action, fields: Object.assign({ requestId: rid() }, fields), at: Date.now(), email: await me() };
  if (navigator.onLine && !(await waiting()).length) {
    try { return await saveNow(action, entry.fields); } catch (e) { if (!isNoConnection(e)) throw e; }
  }
  await add(entry);
  await changed();
  return { ok: true, queued: true };
}

// Send what is waiting, oldest first; stop at the first save that still has no connection.
export async function flush() {
  if (flushing || !navigator.onLine) return drawLine((await waiting()).length);
  flushing = true;
  let sent = 0;
  try {
    const email = await me();
    for (const e of await waiting()) {
      if (e.email && email && e.email !== email) continue; // someone else's saves wait for them to sign in on this iPad
      try {
        await callServer('save', Object.assign({ action: e.action }, e.fields));
      } catch (err) {
        if (isNoConnection(err)) break;
        failedText = 'A save made on this ' + device + ' was refused when it was sent: ' + friendlyError(err);
        showError(failedText);
        sent--;
      }
      sent++;
      await remove(e.key);
      await changed();
    }
  } finally { flushing = false; }
  if (sent > 0) { sentAt = Date.now(); setTimeout(changed, 8500); }
  await changed();
}

// Keep the screens on this iPad (see sw.js) and send waiting saves when the connection comes back.
// opts (Joe 10/13, the stations): scopes = the sw.js scopes of the screens kept (default the Safety Walkthrough's), device =
// the word on the line ('tablet' for a station), files = what else to keep. Every same-site file the screen has loaded is
// kept too (read from the browser's list of what it loaded), so a station keeps exactly what it needs.
export function startOffline(pages, opts) {
  opts = opts || {};
  device = opts.device || 'device';
  // Only the screens named are kept on the device (default safety*.html and extinguishers.html); every other screen of the
  // app is never touched by sw.js.
  if ('serviceWorker' in navigator) (opts.scopes || ['safety', 'extinguishers']).forEach(scope => navigator.serviceWorker.register('sw.js', { scope }).catch(() => {}));
  const keepAll = () => {
    if (!window.caches || !navigator.onLine) return;
    const loaded = opts.scopes ? performance.getEntriesByType('resource').map(r => r.name).filter(u => { try { const x = new URL(u); return x.origin === location.origin && !/^\/__\/(?!firebase\/init\.json)/.test(x.pathname); } catch (e) { return false; } }).map(u => new URL(u).pathname.replace(/^\//, '')) : [];
    const keep = pages.concat(opts.files || ['css/app.css', 'css/safety.css', 'js/app.js', 'js/logic.js', 'js/safety-rules.js', 'js/safety.js', 'js/offline-saves.js',
      'img/ud-logo.webp', 'img/app-icon/favicon-32.png', 'manifest.webmanifest'], loaded, [
      'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js', 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js',
      'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js', 'https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js'])
      .concat(['localhost', '127.0.0.1'].includes(location.hostname) ? [] : ['/__/firebase/init.json']);
    caches.open(CACHE).then(c => [...new Set(keep)].forEach(u => c.add(u).catch(() => {}))).catch(() => {});
  };
  keepAll();
  if (opts.scopes) { setTimeout(keepAll, 5000); setTimeout(keepAll, 30000); }
  window.addEventListener('online', () => { failedText = ''; flush(); });
  window.addEventListener('offline', () => changed());
  setInterval(() => { if (navigator.onLine) flush(); }, 20000);
  setTimeout(flush, 1500);
  changed();
}
