// Joe 10/12: "if the driver doesn't have cell service and types in his stuff, then comes in": a Check-In or DVIR sent with no
// signal is kept on the phone (IndexedDB, so closing the app or the phone loses nothing) and sent, oldest first, as soon as
// the signal is back. Each one keeps its own requestId, so one sent twice is saved only once (the server checks it). The
// last roster, loads and board read are kept too, so the screens still open with no signal. sw.js keeps the page itself.
// Used by route.html: the drivers' phones and the Driver Room Check-In Station (?room=1).
// Review item 77 (Joe 10/13): the queue itself is the shared one (js/save-queue.js, also used by js/offline-saves.js); this
// file says what is the phone's own: its line, and that an entry the server will not take stays on the phone, shown.
import { makeQueue } from './save-queue.js';
import { FIREBASE_FILES } from './firebase.js';

const READS = 'udPhoneRead.', CACHE = 'ud-offline-v1';
let sender = null;

// No signal (as opposed to the server refusing the entry, which the driver is shown).
export function isNoSignal(e) {
  const code = String(e && e.code || '').replace(/^functions\//, ''), msg = String(e && e.message || e || '');
  return !navigator.onLine || /^(internal|unavailable|deadline-exceeded)$/.test(code) || /^internal$|failed to fetch|network|load failed|offline|no signal/i.test(msg);
}

// The line under the header (no pop-ups): what is waiting on this phone and whether there is signal.
function drawLine(list, state) {
  const box = document.getElementById('offline-line');
  if (!box) return;
  const wait = list.filter(e => !e.refused), refused = list.filter(e => e.refused);
  let text = '', tone = '';
  if (wait.length) { text = (navigator.onLine ? 'Sending what was saved on this phone: ' : 'Saved on this phone, will send when you have signal. Waiting: ') + wait.length; tone = 'wait'; }
  else if (!navigator.onLine) { text = 'No signal. What you enter is saved on this phone and sent when you have signal.'; tone = 'wait'; }
  else if (Date.now() - state.sentAt < 8000) { text = 'Sent ✓ Everything saved on this phone has gone to Dispatch.'; tone = 'ok'; }
  if (refused.length) { text = (text ? text + ' ' : '') + refused.map(e => (e.label || 'An entry') + ' was not accepted: ' + e.refused).join(' '); tone = 'error'; }
  box.textContent = text;
  box.hidden = !text;
  box.className = 'offline-line ' + tone;
}

// One the server refuses stays on the phone with the reason shown (Dispatch can be told), and the rest carry on. Review item
// 63: with signal, a server error ('internal') looks like no signal; after 3 tries it is shown as not accepted the same way
// (kept on the phone with the reason) so the entries behind it still go.
const notAccepted = (e, err) => ({ refused: String(err.message || err).replace(/\s*\[\d{3}\]\s*$/, '') });
const queue = makeQueue({
  db: 'udPhoneQueue', store: 'sends',
  send: (e) => sender(e.op, e.input),
  noSignal: isNoSignal,
  aside: (e) => !!e.refused,
  skip: (e) => !!e.refused,
  tooMany: notAccepted,
  refused: notAccepted,
  draw: drawLine
});
const remove = queue.forget, changed = queue.changed;

// The entries still on this phone, oldest first (refused ones too: they are never thrown away without the driver seeing them).
export const waiting = queue.waiting;
export const onChange = queue.onChange;

// Send now when there is signal; with no signal (or when it drops on the way) keep it on this phone. Entries made while others
// are still waiting go behind them, so they reach Dispatch in the order they were made.
export function send(op, input, label) {
  return queue.keep({ op, input, label: label || '', at: Date.now() }, () => sender(op, input));
}

// Send what is waiting, oldest first; stop at the first one that still has no signal.
export const flush = queue.flush;
// The driver closes a refused entry's message after reading it.
export async function forgetRefused() { for (const e of await waiting()) if (e.refused) await remove(e.key); await changed(); }

// The last answer of a read (roster, loads, board), kept on the phone for when there is no signal.
export function keepRead(key, value) { try { localStorage.setItem(READS + key, JSON.stringify({ at: Date.now(), value })); } catch (e) { /* full or private */ } }
export function lastRead(key) { try { const r = JSON.parse(localStorage.getItem(READS + key) || 'null'); return r && r.value ? Object.assign({}, r.value, { offlineAt: r.at }) : null; } catch (e) { return null; } }

// Start: who sends (the page's phone call), keep the page on the phone (sw.js), and send what waits when the signal is back.
export function startQueue(send) {
  sender = send;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: 'route' }).catch(() => {});
  if (window.caches && navigator.onLine) {
    const local = ['localhost', '127.0.0.1'].includes(location.hostname);
    const keep = ['route.html', 'css/app.css', 'css/stations.css', 'css/driver-room.css', 'js/app.js', 'js/firebase.js', 'js/speak.js', 'js/station-code.js', 'js/phone-queue.js', 'js/save-queue.js', 'js/full-screen.js',
      'route.webmanifest', 'driver-station.webmanifest', 'img/app-icon/favicon-32.png', 'img/app-icon/apple-touch-icon.png']
      .concat(FIREBASE_FILES, local ? [] : ['/__/firebase/init.json']);
    caches.open(CACHE).then(c => keep.forEach(u => c.add(u).catch(() => {}))).catch(() => {});
  }
  queue.start();
}
