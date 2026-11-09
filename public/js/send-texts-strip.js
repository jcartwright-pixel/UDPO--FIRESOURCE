// Joe 10/31 (hx): Send Schedule Texts on the live screens, Weekly Dispatch and Daily Dispatch (never the template, which moves on
// to the next week after a Publish). The strip always names the posted week (config/app liveWeeks.current), and the server sends
// only that week whatever week or day the screen shows. First tap arms the button, a second tap within 5 seconds sends; a week
// already sent needs Send Again. Only administrators see it (the sms call refuses anyone else, and the strip stays hidden).
import { callServer, serverText, dateTimeText } from './app.js';
import { doc, onSnapshot, collection, query, where } from './firebase.js';

const addDays = (k, n) => { const [y, m, d] = String(k).split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };
const day = (k) => window.UDLogic.dateText(k);
const stamp = (t) => { const d = t ? new Date(t) : null; return d && !isNaN(d) ? dateTimeText(d) : ''; };
const drivers = (n) => n + (n === 1 ? ' driver' : ' drivers');

// opts.short (Daily Dispatch, Joe 11/6 mock-up ks): one short line that fits beside the week and the loadout day; the week shown
// there is the posted week, so its dates move to the button's hover. The driver count hides on a laptop (.send-more).
export function sendTextsStrip(db, el, opts) {
  const short = !!(opts && opts.short);
  let s = null, armed = null, busy = false, error = '', week = null, sending = '', runsWeek = '', stopRuns = null, again = null, lastChanged = 0;
  el.className = 'send-strip';
  el.hidden = true;
  // The screens size their lists to the window: showing or hiding the strip makes them measure again.
  function show(on) { if (el.hidden === on) { el.hidden = !on; window.dispatchEvent(new Event('resize')); } }
  function render() {
    if (!s || !s.week) { show(false); return; }
    const keys = s.hasSid && s.hasToken && s.from, n = (s.drivers || []).length, l = s.lastSend, done = !!(l && l.week === s.week);
    const words = short ? 'Texts ' + (done ? '<b>sent</b> ' + stamp(l.at) + '<span class="send-more"> to ' + drivers(l.drivers || 0) + '</span>' + (l.live ? '' : ' (test copy)')
        : '<b>not sent</b><span class="send-more"> (' + drivers(n) + ' ticked)</span>') + (keys ? '' : '. Not set up yet') : 'Schedule texts for the posted week, ' + day(s.week) + ' to ' + day(addDays(s.week, 6)) + ': ' +
      (done ? '<b>Sent</b> ' + stamp(l.at) + (s.check && s.check.total ? '' : ' to ' + drivers(l.drivers || 0)) + (l.live ? '' : ' (test copy, written to the list only)') + '.'
        : '<b>Not sent</b> (' + drivers(n) + ' ticked on the Driver Roster).') +
      (keys ? '' : ' Save the Twilio account on Administration &gt; Texts first.');
    // Joe 11/7: drivers Send will not reach whose week is not their normal week; text them yourself.
    const hand = s.byHand || [], esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const handNames = hand.map(x => esc(x.name) + ' (' + esc(x.days.join(', ')) + ')').join('; ');
    const handWords = !hand.length ? '' : short ? '<span class="send-hand-short" title="Not signed up for texts, and their week changed: ' + handNames + '"><b>' + hand.length + ' to text yourself</b></span>' : '<span class="send-hand"><b>Text ' + (hand.length === 1 ? 'this driver' : 'these ' + hand.length + ' drivers') + ' yourself</b> (not signed up, and their week changed): ' + handNames + '.</span>';
    // Joe 11/7 (li): the fail-safe. Once the week is sent, a count of who has it: green 21 OF 21 SENT, or red 19 OF 21 SENT ·
    // 2 MISSING with each missing driver and why, and the button texts only the missing ones.
    const c = done && s.check && s.check.total ? s.check : null, miss = c ? c.missing || [] : [];
    const badge = !c ? '' : '<span class="send-count ' + (miss.length ? 'bad' : 'good') + '">' + c.sent + ' OF ' + c.total + ' SENT' + (miss.length && !short ? ' · ' + miss.length + ' MISSING' : '') + '</span>';
    const missNames = miss.map(x => esc(x.name) + ' (' + esc(x.why) + ')').join(' · ');
    const missWords = !miss.length || short ? '' : '<span class="send-hand"><b>Missing:</b> ' + missNames + '</span>';
    const fixLabel = short ? 'Text ' + miss.length + ' Missing' : 'Text the ' + (miss.length === 1 ? 'Missing Driver' : miss.length + ' Missing');
    const label = miss.length ? (armed ? 'Tap Again: Text ' + drivers(miss.length) : fixLabel)
      : short ? (armed ? 'Tap Again: Text ' + drivers(n) : done ? 'Send Again' : 'Send Texts') : armed ? 'Tap Again: Text ' + drivers(n) + ' for ' + day(s.week) : (done ? 'Send Again: Week of ' : 'Send Schedule Texts: Week of ') + day(s.week);
    el.classList.toggle('sent', done && !miss.length);
    el.classList.toggle('missing', !!miss.length);
    el.classList.toggle('short', short);
    // Joe 11/9: a driver whose truck, trailer, route, leave time or note changed after their schedule text went out is listed
    // in red with what changed, and Send Updated Schedule texts that one driver their week as it is now. Nothing is sent by
    // itself. Once they have the new week, they drop off the list.
    const changed = s.changed || [];
    el.classList.toggle('changed', !!changed.length);
    const changedWords = !changed.length ? '' : '<div class="send-changed"><b>' + (changed.length === 1 ? '1 DRIVER\'S SCHEDULE CHANGED' : changed.length + ' DRIVERS\' SCHEDULES CHANGED') +
      ' AFTER THEIR TEXT WENT OUT. SEND THEM THE UPDATE:</b>' + changed.map(x => '<div class="send-changed-row"><span><b>' + esc(x.name) + '</b> (texted ' + esc(stamp(x.sentAt)) + '): ' +
        esc(x.changes.join('; ')) + '</span><button type="button" class="send-update" data-log="' + esc(x.logId) + '"' + (!keys || busy || sending ? ' disabled title="' + (!keys ? 'Save the Twilio account on Administration &gt; Texts first' : 'Sending now') + '"' : '') + '>' +
        (sending === x.logId ? 'Sending...' : 'Send Updated Schedule') + '</button></div>').join('') + '</div>';
    el.title = short ? 'Schedule texts for the posted week, ' + day(s.week) + ' to ' + day(addDays(s.week, 6)) + (done ? ', sent to ' + drivers(l.drivers || 0) : ', ' + drivers(n) + ' ticked on the Driver Roster') + (keys ? '' : '. Set up Administration > Texts first') +
      (miss.length ? '. Missing: ' + miss.map(x => x.name + ' (' + x.why + ')').join(', ') : '') : '';
    el.innerHTML = badge + '<span class="send-words">' + words + '</span><button type="button" class="send-button' + (miss.length ? ' fix' : '') + (armed ? ' armed' : '') + '"' + (!keys || !n || busy ? ' disabled' : '') + '>' + label + '</button>' +
      missWords + handWords + changedWords + (error ? '<span class="send-error">' + error.replace(/</g, '&lt;') + '</span>' : '');
    el.querySelector('button').onclick = press;
    el.querySelectorAll('.send-update').forEach(b => { b.onclick = () => update(b.dataset.log); });
    show(true);
    // The warning makes the strip taller: the screens measure again.
    if (changed.length !== lastChanged) { lastChanged = changed.length; window.dispatchEvent(new Event('resize')); }
  }
  async function load() {
    try { s = await callServer('sms', { op: 'preview' }); error = ''; } catch (e) { s = null; }
    render();
    watchRuns();
  }
  // A change on Dispatch to the posted week's runs brings the warning up without a reload (a few seconds after the last edit).
  function watchRuns() {
    const w = s && s.week ? s.week : '';
    if (w === runsWeek) return;
    if (stopRuns) { stopRuns(); stopRuns = null; }
    runsWeek = w;
    if (!w) return;
    let first = true;
    stopRuns = onSnapshot(query(collection(db, 'runs'), where('weekStart', '==', w)), () => {
      if (first) { first = false; return; }
      clearTimeout(again);
      again = setTimeout(() => { if (!armed && !busy && !sending) load(); }, 4000);
    }, () => {});
  }
  // Send Updated Schedule: one driver, their week as it is now (Resend on the last text they got).
  async function update(logId) {
    if (!logId || sending) return;
    sending = logId; error = ''; render();
    let failed = '';
    try {
      const r = await callServer('sms', { op: 'resend', logId });
      if (r && r.resend && r.resend.status !== 'SENT' && r.resend.status !== 'NOT SENT') failed = r.resend.name + ': not sent (' + (r.resend.reason || r.resend.status) + ')';
    } catch (e) { failed = serverText(e, 'Texts'); }
    sending = '';
    await load();
    if (failed) { error = failed; render(); }
  }
  async function press() {
    if (!armed) { armed = setTimeout(() => { armed = null; render(); }, 5000); render(); return; }
    clearTimeout(armed); armed = null; busy = true; error = ''; render();
    const done = !!(s.lastSend && s.lastSend.week === s.week), missing = done && !!(s.check && (s.check.missing || []).length);
    let failed = '';
    // Text the Missing sends only to drivers who do not have it yet; Send Again sends everyone a second time.
    try { await callServer('sms', missing ? { op: 'sendSchedule', missing: true } : { op: 'sendSchedule', again: done }); } catch (e) { failed = serverText(e, 'Texts'); }
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
