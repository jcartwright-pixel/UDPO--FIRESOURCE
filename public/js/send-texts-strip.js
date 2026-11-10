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
  let s = null, armed = null, busy = false, error = '', week = null, sending = '', runsWeek = '', stopRuns = null, again = null;
  el.className = 'send-strip';
  el.hidden = true;
  // The screens size their lists to the window: showing or hiding the strip makes them measure again.
  function show(on) { if (el.hidden === on) { el.hidden = !on; window.dispatchEvent(new Event('resize')); } }
  function render() {
    if (!s || !s.week) { show(false); popOpen = false; if (pop) drawPop(); return; }
    const keys = s.hasSid && s.hasToken && s.from, n = (s.drivers || []).length, l = s.lastSend, done = !!(l && l.week === s.week);
    const words = short ? 'Texts ' + (done ? '<b>sent</b> ' + stamp(l.at) + '<span class="send-more"> to ' + drivers(l.drivers || 0) + '</span>' + (l.live ? '' : ' (test copy)')
        : '<b>not sent</b><span class="send-more"> (' + drivers(n) + ' ticked)</span>') + (keys ? '' : '. Not set up yet') : 'Schedule texts for the posted week, ' + day(s.week) + ' to ' + day(addDays(s.week, 6)) + ': ' +
      (done ? '<b>Sent</b> ' + stamp(l.at) + (s.check && s.check.total ? '' : ' to ' + drivers(l.drivers || 0)) + (l.live ? '' : ' (test copy, written to the list only)') + '.'
        : '<b>Not sent</b> (' + drivers(n) + ' ticked on the Driver Roster).') +
      (keys ? '' : ' Save the Twilio account on Administration &gt; Texts first.');
    // Joe 11/9 ("I don't like any of those warnings up there like that. It just takes too much room up ... just have pop-ups"):
    // the strip stays one line. Each warning is a small red button on it, and the warnings open in a pop-up by themselves
    // when something new needs you. Close puts it away until the warnings change; the red buttons open it again.
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    // Joe 11/7: drivers Send will not reach whose week is not their normal week; text them yourself.
    const hand = s.byHand || [];
    // Joe 11/7 (li): the fail-safe. Once the week is sent, a count of who has it: green 21 OF 21 SENT, or red 19 OF 21 SENT ·
    // 2 MISSING, and the button texts only the missing ones.
    const c = done && s.check && s.check.total ? s.check : null, miss = c ? c.missing || [] : [];
    // Joe 11/9: a driver whose truck, trailer, route, leave time or note changed after their schedule text went out, with what
    // changed, and Send Updated Schedule texts that one driver their week as it is now. Nothing is sent by itself.
    const changed = s.changed || [];
    const badge = !c ? '' : '<span class="send-count ' + (miss.length ? 'bad' : 'good') + '"' + (miss.length ? ' data-pop title="Who is missing"' : '') + '>' + c.sent + ' OF ' + c.total + ' SENT' + (miss.length && !short ? ' · ' + miss.length + ' MISSING' : '') + '</span>';
    const fixLabel = short ? 'Text ' + miss.length + ' Missing' : 'Text the ' + (miss.length === 1 ? 'Missing Driver' : miss.length + ' Missing');
    const label = miss.length ? (armed ? 'Tap Again: Text ' + drivers(miss.length) : fixLabel)
      : short ? (armed ? 'Tap Again: Text ' + drivers(n) : done ? 'Send Again' : 'Send Texts') : armed ? 'Tap Again: Text ' + drivers(n) + ' for ' + day(s.week) : (done ? 'Send Again: Week of ' : 'Send Schedule Texts: Week of ') + day(s.week);
    el.classList.toggle('sent', done && !miss.length && !changed.length);
    el.classList.toggle('missing', !!(miss.length || changed.length));
    el.classList.toggle('short', short);
    // Daily (Joe 11-9-26 picture: the line ran over the Loadout day): once the sent check shows (25 OF 25 SENT), the when and
    // to how many move to its hover and the words go, and the red buttons say only the count.
    const shortSent = short && !!c;
    el.title = short ? 'Schedule texts for the posted week, ' + day(s.week) + ' to ' + day(addDays(s.week, 6)) + (done ? ', sent to ' + drivers(l.drivers || 0) : ', ' + drivers(n) + ' ticked on the Driver Roster') + (keys ? '' : '. Set up Administration > Texts first') : '';
    const chips = (changed.length ? '<button type="button" class="send-chip" data-pop>' + changed.length + (short ? ' CHANGED' : ' SCHEDULE' + (changed.length === 1 ? '' : 'S') + ' CHANGED') + '</button>' : '') +
      (hand.length ? '<button type="button" class="send-chip" data-pop>' + hand.length + ' TO TEXT YOURSELF</button>' : '');
    const disabled = !keys || !n || busy;
    const sentWhen = shortSent ? ' title="Sent ' + stamp(l.at) + ' to ' + drivers(l.drivers || 0) + (l.live ? '' : ' (test copy)') + '"' : '';
    el.innerHTML = (sentWhen ? badge.replace('<span class="send-count', '<span' + sentWhen + ' class="send-count') : badge) + (shortSent ? '' : '<span class="send-words">' + words + '</span>') + '<button type="button" class="send-button' + (miss.length ? ' fix' : '') + (armed ? ' armed' : '') + '"' + (disabled ? ' disabled' : '') + '>' + label + '</button>' +
      chips + (error ? '<span class="send-error">' + error.replace(/</g, '&lt;') + '</span>' : '');
    el.querySelector('.send-button').onclick = press;
    el.querySelectorAll('[data-pop]').forEach(b => { b.onclick = () => { popOpen = true; drawPop(); }; });
    show(true);
    // The pop-up: what needs you, with the buttons to fix it.
    const parts = [];
    if (changed.length) parts.push('<h3>' + (changed.length === 1 ? '1 DRIVER\'S SCHEDULE CHANGED' : changed.length + ' DRIVERS\' SCHEDULES CHANGED') + ' AFTER THEIR TEXT WENT OUT</h3>' +
      changed.map(x => '<div class="send-pop-row"><span><b>' + esc(x.name) + '</b> (texted ' + esc(stamp(x.sentAt)) + ')<br>' + x.changes.map(esc).join('<br>') + '</span><button type="button" class="send-update" data-log="' + esc(x.logId) + '"' +
        (!keys || busy || sending ? ' disabled title="' + (!keys ? 'Save the Twilio account on Administration &gt; Texts first' : 'Sending now') + '"' : '') + '>' + (sending === x.logId ? 'Sending...' : 'Send Updated Schedule') + '</button>' +
        // Joe 11-10-26: one click opens a text to this driver with what changed filled in; he adds his words and sends it.
        '<button type="button" class="send-note" data-driver="' + esc(x.driverId) + '"' + (!keys || busy || sending ? ' disabled title="' + (!keys ? 'Save the Twilio account on Administration &gt; Texts first' : 'Sending now') + '"' : '') + '>Text Driver</button></div>').join(''));
    if (miss.length) parts.push('<h3>' + (miss.length === 1 ? '1 DRIVER DOES NOT HAVE THIS WEEK\'S TEXT' : miss.length + ' DRIVERS DO NOT HAVE THIS WEEK\'S TEXT') + '</h3>' +
      miss.map(x => '<div class="send-pop-row"><span><b>' + esc(x.name) + '</b> (' + esc(x.why) + ')</span></div>').join('') +
      '<div class="send-pop-row"><span>Fix what it says on the Driver Roster, then text only them.</span><button type="button" class="send-pop-fix' + (armed ? ' armed' : '') + '"' + (disabled ? ' disabled' : '') + '>' + label + '</button></div>');
    if (hand.length) parts.push('<h3>TEXT ' + (hand.length === 1 ? 'THIS DRIVER' : 'THESE ' + hand.length + ' DRIVERS') + ' YOURSELF</h3><p>Not signed up for texts, and their week is not their normal week.</p>' +
      hand.map(x => '<div class="send-pop-row"><span><b>' + esc(x.name) + '</b> (' + esc(x.days.join(', ')) + ')</span></div>').join(''));
    popHtml = parts.join('');
    // It comes up by itself only for a warning not shown before (a new change, a new missing driver), not again for one closed.
    // Joe 11-10-26 ("It should only pop up if there's added a route or removed the route"): a changed truck, trailer, leave time
    // or note shows only on the red button; a route or run added or taken off brings the pop-up up.
    const ckey = (x) => 'c' + s.week + x.driverId + x.changes.join('|');
    const loud = [].concat(changed.filter(x => x.big).map(ckey), miss.map(x => 'm' + s.week + x.name + x.why), hand.map(x => 'h' + s.week + x.name + x.days.join()));
    const quiet = changed.filter(x => !x.big).map(ckey);
    const was = seenList(), fresh = loud.filter(k => !was.includes(k)), freshQuiet = quiet.filter(k => !was.includes(k));
    if (!popHtml) popOpen = false;
    else if (fresh.length) popOpen = true;
    if (fresh.length || freshQuiet.length) setSeen(was.concat(fresh, freshQuiet).slice(-200));
    drawPop();
  }
  const SEEN = 'udSendTextsPop' + (short ? 'Daily' : 'Weekly');
  function seenList() { try { return JSON.parse(sessionStorage.getItem(SEEN) || '[]'); } catch (e) { return seen; } }
  function setSeen(k) { seen = k; try { sessionStorage.setItem(SEEN, JSON.stringify(k)); } catch (e) { /* kept in memory */ } }
  let seen = [], popHtml = '', popOpen = false, pop = null, back = null;
  function drawPop() {
    if (!pop) {
      back = document.createElement('div'); back.className = 'modal-back send-pop-back'; back.hidden = true;
      pop = document.createElement('section'); pop.className = 'modal wide-modal send-pop'; pop.id = 'send-texts-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Schedule texts'); pop.hidden = true;
      document.body.append(back, pop);
      // Clicking outside it or pressing Esc closes it too.
      back.onclick = () => { popOpen = false; drawPop(); };
      document.addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (note) { note = null; drawNote(); } else if (popOpen) { popOpen = false; drawPop(); } });
    }
    const on = popOpen && !!popHtml;
    back.hidden = pop.hidden = !on;
    if (!on) return;
    pop.innerHTML = '<h2>Schedule Texts: Week of ' + day(s.week) + '</h2>' + popHtml + (error ? '<p class="send-error">' + error.replace(/</g, '&lt;') + '</p>' : '') +
      '<div class="modal-actions"><button type="button" class="send-pop-close">Close</button></div>';
    pop.querySelector('.send-pop-close').onclick = () => { popOpen = false; drawPop(); };
    pop.querySelectorAll('.send-update').forEach(b => { b.onclick = () => update(b.dataset.log); });
    pop.querySelectorAll('.send-note').forEach(b => { b.onclick = () => openNote(b.dataset.driver); });
    const fix = pop.querySelector('.send-pop-fix');
    if (fix) fix.onclick = press;
  }
  // Text Driver (Joe 11-10-26): a box over the warning, filled in with the driver's changes, for Joe's own words. Send texts
  // that one driver; Cancel keeps nothing.
  let note = null;
  function openNote(driverId) {
    const x = ((s && s.changed) || []).find(r => r.driverId === driverId);
    if (!x) return;
    note = { driverId, name: x.name, text: 'SCHEDULE UPDATE, WEEK OF ' + day(s.week) + ':\n' + x.changes.join('\n') + '\n\n', error: '', busy: false };
    drawNote();
  }
  let noteBack = null, notePop = null;
  function drawNote() {
    if (!notePop) {
      noteBack = document.createElement('div'); noteBack.className = 'modal-back send-note-back'; noteBack.hidden = true;
      notePop = document.createElement('section'); notePop.className = 'modal send-note-pop'; notePop.id = 'send-note-pop'; notePop.setAttribute('role', 'dialog'); notePop.setAttribute('aria-label', 'Text a driver'); notePop.hidden = true;
      document.body.append(noteBack, notePop);
    }
    noteBack.hidden = notePop.hidden = !note;
    if (!note) return;
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    notePop.innerHTML = '<h2>Text ' + esc(note.name) + '</h2><p>What changed is filled in. Add your words, then Send.</p>' +
      '<textarea class="send-note-text" rows="9" maxlength="1500" aria-label="Text to the driver">' + esc(note.text) + '</textarea>' +
      (note.error ? '<p class="send-error">' + esc(note.error) + '</p>' : '') +
      '<div class="modal-actions"><button type="button" class="send-note-cancel">Cancel</button><button type="button" class="send-note-send"' + (note.busy ? ' disabled' : '') + '>' + (note.busy ? 'Sending...' : 'Send') + '</button></div>';
    const box = notePop.querySelector('.send-note-text');
    box.oninput = () => { note.text = box.value; };
    if (!note.busy) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
    notePop.querySelector('.send-note-cancel').onclick = () => { note = null; drawNote(); };
    notePop.querySelector('.send-note-send').onclick = sendNote;
  }
  async function sendNote() {
    if (!note || note.busy) return;
    if (!note.text.trim()) { note.error = 'Type the text first.'; drawNote(); return; }
    note.busy = true; note.error = ''; drawNote();
    try {
      const r = await callServer('sms', { op: 'textUpdate', driverId: note.driverId, body: note.text });
      if (r && r.update && r.update.status !== 'SENT' && r.update.status !== 'NOT SENT') { note.busy = false; note.error = r.update.name + ': not sent (' + (r.update.reason || r.update.status) + ')'; drawNote(); return; }
    } catch (e) { note.busy = false; note.error = serverText(e, 'Texts'); drawNote(); return; }
    note = null; drawNote();
    await load();
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
