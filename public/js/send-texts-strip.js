// Joe 10/31 (hx): Send Schedule Texts on the live screens, Weekly Dispatch and Daily Dispatch (never the template, which moves on
// to the next week after a Publish). The strip always names the posted week (config/app liveWeeks.current), and the server sends
// only that week whatever week or day the screen shows. First tap arms the button, a second tap within 5 seconds sends; a week
// already sent needs Send Again. Only administrators see it (the sms call refuses anyone else, and the strip stays hidden).
import { callServer, serverText, dateTimeText } from './app.js';
import { doc, onSnapshot } from './firebase.js';

const addDays = (k, n) => { const [y, m, d] = String(k).split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };
const day = (k) => { const [y, m, d] = String(k).split('-').map(Number); return m + '-' + d + '-' + String(y).slice(2); };
const stamp = (t) => { const d = t ? new Date(t) : null; return d && !isNaN(d) ? dateTimeText(d) : ''; };
const drivers = (n) => n + (n === 1 ? ' driver' : ' drivers');

export function sendTextsStrip(db, el) {
  let s = null, armed = null, busy = false, error = '', week = null;
  el.className = 'send-strip';
  el.hidden = true;
  // The screens size their lists to the window: showing or hiding the strip makes them measure again.
  function show(on) { if (el.hidden === on) { el.hidden = !on; window.dispatchEvent(new Event('resize')); } }
  function render() {
    if (!s || !s.week) { show(false); return; }
    const keys = s.hasSid && s.hasToken && s.from, n = (s.drivers || []).length, l = s.lastSend, done = !!(l && l.week === s.week);
    const words = 'Schedule texts for the posted week, ' + day(s.week) + ' to ' + day(addDays(s.week, 6)) + ': ' +
      (done ? '<b>Sent</b> ' + stamp(l.at) + ' to ' + drivers(l.drivers || 0) + (l.live ? '' : ' (test copy, written to the list only)') + '.'
        : '<b>Not sent</b> (' + drivers(n) + ' ticked on the Driver Roster).') +
      (keys ? '' : ' Save the Twilio account on Administration &gt; Texts first.');
    const label = armed ? 'Tap Again: Text ' + drivers(n) + ' for ' + day(s.week) : (done ? 'Send Again: Week of ' : 'Send Schedule Texts: Week of ') + day(s.week);
    el.classList.toggle('sent', done);
    el.innerHTML = '<span class="send-words">' + words + '</span><button type="button" class="send-button' + (armed ? ' armed' : '') + '"' + (!keys || !n || busy ? ' disabled' : '') + '>' + label + '</button>' +
      (error ? '<span class="send-error">' + error.replace(/</g, '&lt;') + '</span>' : '');
    el.querySelector('button').onclick = press;
    show(true);
  }
  async function load() {
    try { s = await callServer('sms', { op: 'preview' }); error = ''; } catch (e) { s = null; }
    render();
  }
  async function press() {
    if (!armed) { armed = setTimeout(() => { armed = null; render(); }, 5000); render(); return; }
    clearTimeout(armed); armed = null; busy = true; error = ''; render();
    const again = !!(s.lastSend && s.lastSend.week === s.week);
    let failed = '';
    try { await callServer('sms', { op: 'sendSchedule', again }); } catch (e) { failed = serverText(e, 'Texts'); }
    busy = false;
    await load();
    if (failed) { error = failed; render(); }
  }
  // A Publish (here or elsewhere) moves the posted week on: the strip follows it.
  onSnapshot(doc(db, 'config', 'app'), snap => {
    const now = ((snap.data() || {}).liveWeeks || {}).current || '';
    if (now !== week) { week = now; load(); }
  }, () => {});
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !armed && !busy) load(); });
}
