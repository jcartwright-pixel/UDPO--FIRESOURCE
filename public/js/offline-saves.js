// Joe 10/12: the Safety Walkthrough is done on an iPad walking the plant, where there is often no secure Wi-Fi. A save made
// with no connection is kept on the iPad (IndexedDB, so closing the page or the iPad loses nothing) and sent, in the order it
// was made, as soon as the connection is back. Each save keeps its own requestId, so one sent twice is only saved once.
// sw.js keeps the screens themselves on the iPad so they open with no signal.
// Joe 10/13: the Plant, Garage and Driver's Kiosk stations use the same: startOffline(pages, { device: 'tablet', ... }) keeps
// the station's screen on the tablet and its saves wait here with the "Saved on this tablet" line.
// Review item 77 (Joe 10/13): the queue itself is the shared one (js/save-queue.js, also used by js/phone-queue.js); this file
// says what is the iPad's and the tablet's own: its line, whose saves go, and what happens to one the server will not take.
import { start, saveNow, callServer, friendlyError, showError } from './app.js';
import { makeQueue, HOLD_AFTER, isServerError } from './save-queue.js';
import { FIREBASE_FILES } from './firebase.js';

const CACHE = 'ud-offline-v1';
let failedText = '', device = 'device', heldNow = 0;

const rid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/[^A-Za-z0-9_-]/g, '');
// No connection (as opposed to the server refusing the save, which is shown and not kept).
export function isNoConnection(e) {
  const code = String(e && e.code || '').replace(/^functions\//, ''), msg = String(e && e.message || e || '');
  return !navigator.onLine || code === 'unavailable' || code === 'deadline-exceeded' || /network|Failed to fetch|offline|internal/i.test(code + ' ' + msg) && !/permission|refused/i.test(msg);
}
// Review item 63 (Joe 10/13): with signal, a server error ('internal') looks the same as a dropped connection, so a save
// the server keeps failing used to stop every save behind it, forever, with nothing shown. After HOLD_AFTER tries with
// signal it is held: the error shows, the saves behind it go on, and it stays on the device and is tried again each time.
export { HOLD_AFTER, isServerError };
async function me() {
  const { auth } = await start();
  return String((auth.currentUser && auth.currentUser.email) || '').toLowerCase();
}

// The warning line (no pop-ups): how many saves are on this iPad and whether there is a connection.
function drawLine(list, state) {
  const box = document.getElementById('offline-line');
  if (!box) return;
  const n = list.length, held = list.some(e => e.held);
  const stuck = held && navigator.onLine && !!failedText;
  const text = stuck ? failedText : device === 'tablet'
    ? (n ? (navigator.onLine ? 'Sending what was saved on this tablet: ' + n : 'Saved on this tablet, will send when you have signal. Waiting: ' + n)
      : !navigator.onLine ? 'No signal. What you enter is saved on this tablet and sent when you have signal.'
        : failedText || (Date.now() - state.sentAt < 8000 ? 'Sent ✓ Everything saved on this tablet has gone through.' : ''))
    : n ? (navigator.onLine ? 'Sending saves made on this device: ' + n : 'Saved on this device, sends when online: ' + n)
      : !navigator.onLine ? 'No internet. Taps, notes and photos are saved on this device and sent when it is back.' : failedText;
  box.textContent = text;
  box.hidden = !text;
  box.classList.toggle('error', (stuck || !n) && navigator.onLine && !!failedText);
  box.classList.toggle('ok', !stuck && !n && navigator.onLine && !failedText && !!text);
}

const queue = makeQueue({
  db: 'udOfflineSaves', store: 'saves',
  send: (e) => (e.call ? callServer(e.call, e.fields) : callServer('save', Object.assign({ action: e.action }, e.fields))),
  noSignal: isNoConnection,
  aside: (e) => !!e.held,
  // Who made the save goes with it; someone else's saves wait for them to sign in on this iPad.
  stamp: async (entry) => { entry.email = await me(); },
  prepare: async () => { heldNow = 0; return me(); },
  skip: (e, email) => !!(e.email && email && e.email !== email),
  // Held saves go last, so they never stop the ones behind them.
  order: (list) => list.filter(x => !x.held).concat(list.filter(x => x.held)),
  tooMany: (e, err) => {
    heldNow++;
    failedText = 'A save made on this ' + device + ' could not be sent (' + friendlyError(err) + '). It stays on this ' + device + ' and is tried again.';
    if (!e.held) showError(failedText);
    return { held: true };
  },
  // A save the server refuses is shown and let go.
  refused: (e, err) => {
    failedText = 'A save made on this ' + device + ' was refused when it was sent: ' + friendlyError(err);
    showError(failedText);
    return null;
  },
  roundDone: (list) => { if (!heldNow && list.some(x => x.held)) failedText = ''; },
  draw: drawLine
});

// The saves still on this iPad (all of them, or one kind), oldest first.
export async function waiting(action) {
  return (await queue.waiting()).filter(e => !action || e.action === action);
}
// A screen hears when the waiting list changes (to redraw what it shows as saved here).
export const onWaitingChange = queue.onChange;

// Save now when there is a connection; otherwise (or when the connection drops on the way) keep it on this iPad. Saves made
// while others are still waiting wait behind them, so they reach the server in the order they were made.
export function offlineSave(action, fields) {
  const entry = { action, fields: Object.assign({ requestId: rid() }, fields), at: Date.now() };
  return queue.keep(entry, () => saveNow(action, entry.fields));
}

// Joe 10/13 (Garage Station): the same for another server call (name, e.g. 'garage'): sent now when there is signal and
// nothing waits, otherwise kept on the tablet and sent in order. fields carries its own requestId.
export function offlineCall(name, fields) {
  const entry = { call: name, fields: Object.assign({ requestId: rid() }, fields), at: Date.now() };
  return queue.keep(entry, () => callServer(name, entry.fields));
}

// Send what is waiting, oldest first; stop at the first save that still has no connection.
export const flush = queue.flush;

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
    const keep = pages.concat(opts.files || ['css/app.css', 'css/safety.css', 'js/app.js', 'js/firebase.js', 'js/logic.js', 'js/safety-rules.js', 'js/safety.js', 'js/offline-saves.js', 'js/save-queue.js',
      'img/ud-logo.webp', 'img/app-icon/favicon-32.png', 'manifest.webmanifest'], loaded, FIREBASE_FILES)
      .concat(['localhost', '127.0.0.1'].includes(location.hostname) ? [] : ['/__/firebase/init.json']);
    caches.open(CACHE).then(c => [...new Set(keep)].forEach(u => c.add(u).catch(() => {}))).catch(() => {});
  };
  keepAll();
  if (opts.scopes) { setTimeout(keepAll, 5000); setTimeout(keepAll, 30000); }
  queue.start(() => { failedText = ''; });
}
