/*
 * Weekly route report in the hub (Joe 11-6-26: "material for the route cost analysis"), on the Accounting Numbers screen.
 * Vicki's weekly "Weekly Daily Avg Cases by Route By Store" report is read once, by Operations' server
 * (functions/src/routereports.js, Administration steps routeReportStatus / routeReportSaveSettings / routeReportUpload /
 * routeReportCheckNow), and kept in routeWeeks/<week ending>. Route Cost Analysis reads the weeks from there.
 * The settings save by themselves.
 */
import { callServer, escapeHtml as e, serverText, shortDate } from './shell.js';

const $ = (s) => document.querySelector(s);
const admin = (op, fields, ms) => callServer('admin', Object.assign({ op }, fields || {}), ms);
let got = null, busy = '';

const money = (v) => v == null ? '' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = (v) => v == null ? '' : Math.round(Number(v)).toLocaleString('en-US');
const time = (v) => { const t = new Date(v); return isNaN(t) ? '' : t.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }); };
const when = (v) => v ? shortDate(v) + ' ' + time(v) : '';

function say(text, kind) { const m = $('#wk-msg'); m.hidden = !text; m.textContent = text || ''; m.className = 'list-msg ' + (kind || ''); }

const pillHtml = (s) => s.enabled ? '<span class="pill good">ON</span>' : '<span class="pill">OFF</span>';
const lineHtml = (s) => s.enabled ? 'Checks <b>' + e(s.mailbox) + '</b> every day at 2:00 PM for a new report with the label <b>' + e(s.label) + '</b>.' : 'Not checking email. Type the mailbox and tick Check every day.';

function card() {
  const s = got.settings, last = got.last;
  const lastLine = last ? '<p class="' + (last.status === 'FAIL' ? 'acc-bad' : 'muted') + '">Last checked ' + e(when(last.at)) + ': ' + e(last.message || '') + '</p>' : '<p class="muted">Not checked yet.</p>';
  return '<section class="acc-card"><div class="acc-row"><h2>WEEKLY ROUTE REPORT</h2><span id="wk-pill">' + pillHtml(s) + '</span></div>' +
    '<p class="muted">The weekly report of cases and sales by route and stop (Weekly Daily Avg Cases by Route By Store). Route Cost Analysis reads each week from here.</p>' +
    '<p id="wk-line">' + lineHtml(s) + '</p>' +
    '<div class="acc-row"><label>Mailbox the report comes to<input id="wk-mailbox" type="email" autocomplete="off" spellcheck="false" value="' + e(s.mailbox) + '" placeholder="name@uniteddairy.com"></label>' +
    '<label>Gmail label<input id="wk-label" type="text" autocomplete="off" spellcheck="false" value="' + e(s.label) + '"></label>' +
    '<label class="inline"><input id="wk-enabled" type="checkbox"' + (s.enabled ? ' checked' : '') + '> Check every day</label></div>' + lastLine +
    '<div class="acc-row"><button type="button" class="primary" id="wk-check"' + (s.mailbox && !busy ? '' : ' disabled title="Type the mailbox first"') + '>' + (busy === 'check' ? 'CHECKING…' : 'CHECK EMAIL NOW') + '</button>' +
    '<button type="button" id="wk-pick"' + (busy ? ' disabled' : '') + '>' + (busy === 'file' ? 'READING THE FILE…' : 'ADD A REPORT BY HAND') + '</button><input type="file" id="wk-file" accept=".xls,.xlsx" hidden></div>' +
    '<div class="list-msg" id="wk-msg" role="status" hidden></div></section>';
}

function table() {
  if (!got.weeks.length) return '<p class="hub-empty">No weeks yet. Press ADD A REPORT BY HAND and pick the weekly route report.</p>';
  return '<table class="acc-table" id="wk-table"><thead><tr><th>Week ending</th><th>Routes</th><th>Cases</th><th>Sales</th><th>From</th></tr></thead><tbody>' +
    got.weeks.map(w => '<tr><td class="strong">' + e(shortDate(w.week_ending)) + '</td><td>' + whole(w.routes) + '</td><td>' + whole(w.cases) + '</td><td>' + money(w.net_sales) + '</td>' +
      '<td class="muted">' + e(w.file || '') + '<br><small>' + e(String(w.source || '').toLowerCase().startsWith('email') ? 'email ' + shortDate(w.received || w.savedAt) : 'by hand ' + shortDate(w.savedAt)) + '</small></td></tr>').join('') + '</tbody></table>';
}

function draw() { $('#weeks').innerHTML = card() + table(); }

async function run(kind, fn, done) {
  busy = kind; draw();
  let text = '', cls = 'good';
  try { got = await fn(); text = done(got); } catch (err) { text = serverText(err, 'the weekly route report'); cls = 'bad'; }
  busy = ''; draw(); say(text, cls);
}

const fileText = (f) => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = () => bad(new Error('Could not read the file')); r.readAsDataURL(f); });

// One save at a time, each with the boxes as they are when it runs; the boxes are never redrawn by a save.
let saving = Promise.resolve();
function saveSettings() {
  saving = saving.then(async () => {
    const fields = { mailbox: $('#wk-mailbox').value.trim(), label: $('#wk-label').value.trim(), enabled: $('#wk-enabled').checked };
    try { got = await admin('routeReportSaveSettings', fields); say(''); }
    catch (err) { say(serverText(err, 'the weekly route report'), 'bad'); if (fields.enabled && !fields.mailbox) $('#wk-enabled').checked = false; return; }
    $('#wk-pill').innerHTML = pillHtml(got.settings);
    $('#wk-line').innerHTML = lineHtml(got.settings);
    const c = $('#wk-check');
    c.disabled = !got.settings.mailbox || !!busy;
    if (got.settings.mailbox) c.removeAttribute('title'); else c.title = 'Type the mailbox first';
  });
  return saving;
}

function wire() {
  $('#weeks').addEventListener('change', (ev) => {
    if (ev.target.id === 'wk-file') {
      const f = ev.target.files[0];
      if (!f) return;
      run('file', async () => admin('routeReportUpload', { fileName: f.name, base64: await fileText(f) }, 120000),
        (d) => d.saved.changed ? 'Week ending ' + d.saved.weekText + ' read from ' + d.file + ': ' + d.saved.routes + ' routes, ' + d.saved.stops + ' stops.' : 'Nothing new in ' + d.file + ': the week ending ' + d.saved.weekText + ' already matches.');
      return;
    }
    if (['wk-mailbox', 'wk-label', 'wk-enabled'].indexOf(ev.target.id) >= 0) saveSettings();
  });
  $('#weeks').addEventListener('click', (ev) => {
    if (ev.target.id === 'wk-pick') $('#wk-file').click();
    if (ev.target.id === 'wk-check') run('check', () => admin('routeReportCheckNow', {}, 300000), (d) => d.run.message || 'Checked.');
  });
}

/** Called by accounting.js once the administrator check has passed. */
export async function startWeeks() {
  try { got = await admin('routeReportStatus'); draw(); wire(); }
  catch (err) { $('#weeks').innerHTML = '<p class="acc-bad">' + e(serverText(err, 'the weekly route report')) + '</p>'; }
}
