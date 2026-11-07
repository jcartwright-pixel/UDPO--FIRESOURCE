/*
 * Daily BOL in the hub (Joe 11-6-26: "it needs to come through the centralized hub app ... it'll be in my folder under the
 * label routes, and then sub folder is BOL"). The office's Daily Load By Route is read once, by Operations' server
 * (functions/src/bol.js, Administration steps bolStatus / bolSaveSettings / bolUpload / bolCheckNow), and kept in
 * bolDays/<yyyy-mm-dd>. Built like Accounting Numbers (accounting.js): the settings save by themselves.
 */
import { callServer, escapeHtml as e, showError, serverText, shortDate, setAdmin } from './shell.js';

const $ = (s) => document.querySelector(s);
const admin = (op, fields, ms) => callServer('admin', Object.assign({ op }, fields || {}), ms);
let got = null, busy = '', openRoute = '';

const whole = (v) => v == null ? '' : Number(v).toLocaleString('en-US');
const time = (v) => { const t = new Date(v); return isNaN(t) ? '' : t.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }); };
const when = (v) => v ? shortDate(v) + ' ' + time(v) : '';
const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const dayName = (id) => { const [y, m, d] = id.split('-').map(Number); return DAYS[new Date(y, m - 1, d).getDay()]; };

function say(text, kind) { const m = $('#msg'); m.hidden = !text; m.textContent = text || ''; m.className = 'list-msg ' + (kind || ''); }

const pillHtml = (s) => s.enabled ? '<span class="pill good">ON</span>' : '<span class="pill">OFF</span>';
const lineHtml = (s) => s.enabled ? 'CHECKS <b>' + e(s.mailbox) + '</b>, LABEL <b>' + e(s.label) + '</b>, EVERY HOUR FOR A NEW BOL.' : 'NOT CHECKING EMAIL. TYPE THE MAILBOX AND TICK CHECK EVERY HOUR.';

function mailCard() {
  const s = got.settings, last = got.last;
  const lastLine = last ? '<p class="' + (last.status === 'FAIL' ? 'acc-bad' : 'muted') + '">LAST CHECKED ' + e(when(last.at)) + ': ' + e(last.message || '') + '</p>' : '<p class="muted">NOT CHECKED YET.</p>';
  return '<section class="acc-card"><div class="acc-row"><h2>FROM EMAIL</h2><span id="mail-pill">' + pillHtml(s) + '</span></div>' +
    '<p id="mail-line">' + lineHtml(s) + '</p>' +
    '<div class="acc-row"><label>MAILBOX THE BOL COMES TO<input id="mailbox" type="email" autocomplete="off" spellcheck="false" value="' + e(s.mailbox) + '" placeholder="name@uniteddairy.com"></label>' +
    '<label>EMAIL LABEL<input id="label" type="text" autocomplete="off" spellcheck="false" value="' + e(s.label) + '" placeholder="ROUTES/BOL"></label>' +
    '<label>ONLY FROM (OPTIONAL)<input id="sender" type="text" autocomplete="off" spellcheck="false" value="' + e(s.sender) + '" placeholder="the office\'s address"></label>' +
    '<label class="inline"><input id="enabled" type="checkbox"' + (s.enabled ? ' checked' : '') + '> CHECK EVERY HOUR</label></div>' + lastLine +
    '<div class="acc-row"><button type="button" class="primary" id="check"' + (s.mailbox && !busy ? '' : ' disabled title="Type the mailbox first"') + '>' + (busy === 'check' ? 'CHECKING…' : 'CHECK EMAIL NOW') + '</button>' +
    '<button type="button" id="pick"' + (busy ? ' disabled' : '') + '>' + (busy === 'file' ? 'READING THE FILE…' : 'ADD A FILE BY HAND') + '</button><input type="file" id="file" accept=".pdf,.xlsx,.xls,.csv" hidden></div></section>';
}

function daysTable() {
  if (!got.days.length) return '<p class="hub-empty">NO BOL YET. PRESS ADD A FILE BY HAND AND PICK THE DAILY LOAD BY ROUTE.</p>';
  const cur = got.open && got.open.date;
  return '<section class="bol-part"><h2>LOAD DAYS</h2><table class="acc-table bol-days"><thead><tr><th>LOAD DAY</th><th>ROUTES</th><th>CUSTOMERS</th><th>QUANTITY</th><th class="from">FROM</th></tr></thead><tbody>' +
    got.days.map(d => '<tr data-date="' + e(d.date) + '" class="' + (d.date === cur ? 'on' : '') + '"><td class="strong"><button type="button" class="bol-day" data-date="' + e(d.date) + '">' + dayName(d.date) + ' ' + e(shortDate(d.date)) + '</button></td>' +
      '<td>' + whole(d.totals.routes) + '</td><td>' + whole(d.totals.stops) + '</td><td>' + whole(d.totals.qty) + '</td>' +
      '<td class="muted">' + e(d.file) + '<br><small>' + e((d.source === 'EMAIL' ? 'EMAIL ' : 'BY HAND ') + when(d.received)) + '</small></td></tr>').join('') + '</tbody></table></section>';
}

function routesTable() {
  const o = got.open;
  if (!o) return '';
  return '<section class="bol-part"><h2>ROUTES ON ' + dayName(o.date) + ' ' + e(shortDate(o.date)) + '</h2>' +
    '<p class="muted">' + whole(o.totals.routes) + ' ROUTES · ' + whole(o.totals.stops) + ' CUSTOMERS · ' + whole(o.totals.lines) + ' ORDER LINES · ' + whole(o.totals.qty) + ' QUANTITY. PRESS A ROUTE TO SEE ITS CUSTOMERS.</p>' +
    '<table class="acc-table bol-routes"><thead><tr><th>ROUTE</th><th>CUSTOMERS</th><th>ORDER LINES</th><th>QUANTITY</th></tr></thead><tbody>' +
    o.routes.map(r => '<tr class="' + (r.route === openRoute ? 'on' : '') + '"><td class="strong"><button type="button" class="bol-route" data-route="' + e(r.route) + '">' + (r.route === openRoute ? '▾ ' : '▸ ') + e(r.route) + '</button></td><td>' + r.stops.length + '</td><td>' + whole(r.lines) + '</td><td>' + whole(r.qty) + '</td></tr>' +
      (r.route === openRoute ? '<tr class="bol-stops"><td colspan="4"><table><thead><tr><th>LOAD SEQ</th><th>CUSTOMER</th><th>NUMBER</th><th>ORDER LINES</th><th>QUANTITY</th></tr></thead><tbody>' +
        r.stops.map(st => '<tr><td>' + e(st.seq == null ? '' : st.seq) + '</td><td>' + e(st.name) + '</td><td>' + e(st.custNo) + '</td><td>' + whole(st.lines) + '</td><td>' + whole(st.qty) + '</td></tr>').join('') +
        '</tbody></table></td></tr>' : '')).join('') + '</tbody></table></section>';
}

function draw() { $('#mail').innerHTML = mailCard(); drawDays(); }
function drawDays() { $('#days').innerHTML = '<div class="bol-grid">' + daysTable() + routesTable() + '</div>'; }

async function run(kind, fn, done) {
  busy = kind; draw(); say('');
  try { got = await fn(); openRoute = ''; say(done(got), got.run && got.run.status === 'FAIL' ? 'bad' : 'good'); } catch (err) { say(serverText(err, 'the BOL'), 'bad'); }
  busy = ''; draw();
}

const fileText = (f) => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = () => bad(new Error('Could not read the file')); r.readAsDataURL(f); });

// Saves one at a time, each with the boxes as they are when it runs, and never redraws the boxes.
let saving = Promise.resolve();
function saveSettings() {
  saving = saving.then(async () => {
    const fields = { mailbox: $('#mailbox').value.trim(), label: $('#label').value.trim(), sender: $('#sender').value.trim(), enabled: $('#enabled').checked };
    try { const d = await admin('bolSaveSettings', fields); got.settings = d.settings; got.last = d.last; say(''); }
    catch (err) { say(serverText(err, 'the BOL'), 'bad'); if (fields.enabled && !fields.mailbox) $('#enabled').checked = false; return; }
    $('#mail-pill').innerHTML = pillHtml(got.settings);
    $('#mail-line').innerHTML = lineHtml(got.settings);
    const c = $('#check');
    c.disabled = !got.settings.mailbox || !!busy;
    if (got.settings.mailbox) c.removeAttribute('title'); else c.title = 'Type the mailbox first';
  });
  return saving;
}

function wire() {
  $('#mail').addEventListener('change', (ev) => {
    if (ev.target.id === 'file') {
      const f = ev.target.files[0];
      if (!f) return;
      run('file', async () => admin('bolUpload', { fileName: f.name, base64: await fileText(f) }, 120000),
        (d) => d.saved.map(s => 'LOAD DAY ' + s.label + ': ' + s.routes + ' ROUTES, ' + s.stops + ' CUSTOMERS').join('. ') + ' READ FROM ' + d.file + '.');
      ev.target.value = '';
      return;
    }
    if (['mailbox', 'label', 'sender', 'enabled'].indexOf(ev.target.id) >= 0) saveSettings();
  });
  $('#mail').addEventListener('click', (ev) => {
    if (ev.target.id === 'pick') $('#file').click();
    if (ev.target.id === 'check') run('check', () => admin('bolCheckNow', {}, 300000), (d) => d.run.message || 'CHECKED.');
  });
  $('#days').addEventListener('click', async (ev) => {
    const day = ev.target.closest('.bol-day'), rt = ev.target.closest('.bol-route');
    if (rt) { openRoute = openRoute === rt.dataset.route ? '' : rt.dataset.route; drawDays(); return; }
    if (day) {
      try { const d = await admin('bolStatus', { date: day.dataset.date }); got.open = d.open; got.days = d.days; openRoute = ''; drawDays(); }
      catch (err) { say(serverText(err, 'the BOL'), 'bad'); }
    }
  });
}

export async function start() {
  try {
    // Administrators only: the hub's own check first.
    await callServer('hub', { op: 'appAccess' });
    setAdmin(true);
    got = await admin('bolStatus');
    draw(); wire();
  } catch (err) { showError(serverText(err, 'the BOL')); }
}
