/*
 * Accounting Numbers in the hub (Joe 11-6-26: "a centralized app ... will draw the data in and store it in our Fire Source").
 * The monthly accounting package is read once, by Operations' server (functions/src/accounting.js, Administration steps
 * accountingStatus / accountingSaveSettings / accountingUpload / accountingCheckNow), and kept in accountingMonthly/<yyyy-mm>.
 * Over the Road and the cost analysis app read them from there. The settings save by themselves.
 */
import { callServer, escapeHtml as e, showError, serverText, shortDate, setAdmin } from './shell.js';

const $ = (s) => document.querySelector(s);
const admin = (op, fields, ms) => callServer('admin', Object.assign({ op }, fields || {}), ms);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let got = null, busy = '';

const money = (v) => v == null ? '' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = (v) => v == null ? '' : Number(v).toLocaleString('en-US');
const time = (v) => { const t = new Date(v); return isNaN(t) ? '' : t.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }); };
const when = (v) => v ? shortDate(v) + ' ' + time(v) : '';

function say(text, kind) { const m = $('#msg'); m.hidden = !text; m.textContent = text || ''; m.className = 'list-msg ' + (kind || ''); }

function mailCard() {
  const s = got.settings, last = got.last;
  const pill = s.enabled ? '<span class="pill good">ON</span>' : '<span class="pill">OFF</span>';
  const lastLine = last ? '<p class="' + (last.status === 'FAIL' ? 'acc-bad' : 'muted') + '">Last checked ' + e(when(last.at)) + ': ' + e(last.message || '') + '</p>' : '<p class="muted">Not checked yet.</p>';
  return '<section class="acc-card"><div class="acc-row"><h2>FROM EMAIL</h2>' + pill + '</div>' +
    '<p>' + (s.enabled ? 'Checks <b>' + e(s.mailbox) + '</b> every morning at 6:00 AM for a new zip from accounting.' : 'Not checking email. Type the mailbox and tick Check every morning.') + '</p>' +
    '<div class="acc-row"><label>Mailbox the zip comes to<input id="mailbox" type="email" autocomplete="off" spellcheck="false" value="' + e(s.mailbox) + '" placeholder="name@uniteddairy.com"></label>' +
    '<label>Only from (optional)<input id="sender" type="text" autocomplete="off" spellcheck="false" value="' + e(s.sender) + '" placeholder="accounting address"></label>' +
    '<label class="inline"><input id="enabled" type="checkbox"' + (s.enabled ? ' checked' : '') + '> Check every morning</label></div>' + lastLine +
    '<div class="acc-row"><button type="button" class="primary" id="check"' + (s.mailbox && !busy ? '' : ' disabled title="Type the mailbox first"') + '>' + (busy === 'check' ? 'CHECKING…' : 'CHECK EMAIL NOW') + '</button>' +
    '<button type="button" id="pick"' + (busy ? ' disabled' : '') + '>' + (busy === 'file' ? 'READING THE FILE…' : 'ADD A FILE BY HAND') + '</button><input type="file" id="file" accept=".zip,.xls,.xlsx" hidden></div></section>';
}

function table() {
  if (!got.months.length) return '<p class="hub-empty">No months yet. Press ADD A FILE BY HAND and pick the accounting zip.</p>';
  return '<table class="acc-table"><thead><tr><th>Month</th><th>Gallons sold</th><th>Delivery cost</th><th>Employee cost</th><th>Fuel cost</th><th>Cost per gallon</th><th>From</th></tr></thead><tbody>' +
    got.months.map(m => '<tr><td class="strong">' + MONTHS[m.month - 1] + ' ' + m.year + '</td><td>' + whole(m.gallons_sold) + '</td><td>' + money(m.distribution_cost) + '</td><td>' + money(m.employee_cost) + '</td><td>' + money(m.fuel_cost) + '</td>' +
      '<td class="strong">' + (m.distribution_cost != null && m.gallons_sold ? '$' + (m.distribution_cost / m.gallons_sold).toFixed(3) : '') + '</td>' +
      '<td class="muted">' + e(m.file || '') + (m.savedAt ? '<br><small>' + e((m.source === 'EMAIL' ? 'email ' : 'by hand ') + shortDate(m.savedAt)) + '</small>' : '') + '</td></tr>').join('') + '</tbody></table>';
}

function draw() { $('#mail').innerHTML = mailCard(); $('#months').innerHTML = table(); }

async function run(kind, fn, done) {
  busy = kind; draw(); say('');
  try { got = await fn(); say(done(got), 'good'); } catch (err) { say(serverText(err, 'the accounting numbers'), 'bad'); }
  busy = ''; draw();
}

const fileText = (f) => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = () => bad(new Error('Could not read the file')); r.readAsDataURL(f); });

async function saveSettings() {
  const fields = { mailbox: $('#mailbox').value.trim(), sender: $('#sender').value.trim(), enabled: $('#enabled').checked };
  try { got = await admin('accountingSaveSettings', fields); say(''); } catch (err) { say(serverText(err, 'the accounting numbers'), 'bad'); if (fields.enabled && !fields.mailbox) $('#enabled').checked = false; return; }
  draw();
}

function wire() {
  $('#mail').addEventListener('change', (ev) => {
    if (ev.target.id === 'file') {
      const f = ev.target.files[0];
      if (!f) return;
      run('file', async () => admin('accountingUpload', { fileName: f.name, base64: await fileText(f) }, 120000),
        (d) => d.saved.changed ? d.saved.changed + ' month' + (d.saved.changed === 1 ? '' : 's') + ' read from ' + d.file + ' (newest ' + d.saved.newest + ').' : 'Nothing new in ' + d.file + ': every month already matches.');
      return;
    }
    if (['mailbox', 'sender', 'enabled'].indexOf(ev.target.id) >= 0) saveSettings();
  });
  $('#mail').addEventListener('click', (ev) => {
    if (ev.target.id === 'pick') $('#file').click();
    if (ev.target.id === 'check') run('check', () => admin('accountingCheckNow', {}, 300000), (d) => d.run.message || 'Checked.');
  });
}

export async function start() {
  try {
    // Administrators only: the hub's own check first.
    await callServer('hub', { op: 'appAccess' });
    setAdmin(true);
    got = await admin('accountingStatus');
    draw(); wire();
  } catch (err) { showError(serverText(err, 'the accounting numbers')); }
}
