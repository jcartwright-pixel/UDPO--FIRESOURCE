/*
 * Route reports in the hub (Joe 11-6-26: "material for the route cost analysis and for the [BOLs]"), on the Accounting Numbers screen.
 * The daily Daily Load By Route PDF (BOL) is read the same way and kept in dailyLoads/<load date> for any app to use.
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
const lineHtml = (s) => s.enabled ? 'Checks <b>' + e(s.mailbox) + '</b> every day at 5:00 PM for new reports with the labels <b>' + e(s.label) + '</b> and <b>' + e(s.bolLabel) + '</b>.' : 'Not checking email. Type the mailbox and tick Check every day.';

function card() {
  const s = got.settings, last = got.last;
  const lastLine = last ? '<p class="' + (last.status === 'FAIL' ? 'acc-bad' : 'muted') + '">Last checked ' + e(when(last.at)) + ': ' + e(last.message || '') + '</p>' : '<p class="muted">Not checked yet.</p>';
  return '<section class="acc-card"><div class="acc-row"><h2>ROUTE REPORTS</h2><span id="wk-pill">' + pillHtml(s) + '</span></div>' +
    '<p class="muted">The weekly report of cases and sales by route and stop (Weekly Daily Avg Cases by Route By Store), and the daily load by route (BOL). Route Cost Analysis and the other apps read them from here.</p>' +
    '<p id="wk-line">' + lineHtml(s) + '</p>' +
    '<div class="acc-row"><label>Mailbox the report comes to<input id="wk-mailbox" type="email" autocomplete="off" spellcheck="false" value="' + e(s.mailbox) + '" placeholder="name@uniteddairy.com"></label>' +
    '<label>Weekly report label<input id="wk-label" type="text" autocomplete="off" spellcheck="false" value="' + e(s.label) + '"></label>' +
    '<label>Daily load (BOL) label<input id="wk-bol" type="text" autocomplete="off" spellcheck="false" value="' + e(s.bolLabel) + '"></label>' +
    '<label class="inline"><input id="wk-enabled" type="checkbox"' + (s.enabled ? ' checked' : '') + '> Check every day</label></div>' + lastLine +
    '<div class="acc-row"><button type="button" class="primary" id="wk-check"' + (s.mailbox && !busy ? '' : ' disabled title="Type the mailbox first"') + '>' + (busy === 'check' ? 'CHECKING…' : 'CHECK EMAIL NOW') + '</button>' +
    '<button type="button" id="wk-pick"' + (busy ? ' disabled' : '') + '>' + (busy === 'file' ? 'READING THE FILE…' : 'ADD A REPORT BY HAND') + '</button><input type="file" id="wk-file" accept=".xls,.xlsx,.pdf" hidden></div>' +
    '<div class="list-msg" id="wk-msg" role="status" hidden></div></section>';
}

function table() {
  if (!got.weeks.length) return '<p class="hub-empty">No weeks yet. Press ADD A REPORT BY HAND and pick the weekly route report.</p>';
  return '<table class="acc-table" id="wk-table"><thead><tr><th>Week ending</th><th>Routes</th><th>Cases</th><th>Sales</th><th>From</th></tr></thead><tbody>' +
    got.weeks.map(w => '<tr><td class="strong">' + e(shortDate(w.week_ending)) + '</td><td>' + whole(w.routes) + '</td><td>' + whole(w.cases) + '</td><td>' + money(w.net_sales) + '</td>' +
      '<td class="muted">' + e(w.file || '') + '<br><small>' + e(String(w.source || '').toLowerCase().startsWith('email') ? 'email ' + shortDate(w.received || w.savedAt) : 'by hand ' + shortDate(w.savedAt)) + '</small></td></tr>').join('') + '</tbody></table>';
}

function dayTable() {
  if (!got.days || !got.days.length) return '<p class="hub-empty">No daily loads yet. They come from the 4:00 PM Daily Load By Route email, or press ADD A REPORT BY HAND and pick the PDF.</p>';
  return '<table class="acc-table" id="day-table"><thead><tr><th>Load date</th><th>Routes</th><th>Stops</th><th>Quantity</th><th>From</th></tr></thead><tbody>' +
    got.days.map(d => '<tr><td class="strong">' + e(shortDate(d.load_date)) + '</td><td>' + whole(d.route_count) + '</td><td>' + whole(d.stops) + '</td><td>' + whole(d.qty) + '</td>' +
      '<td class="muted">' + e(d.file || '') + '<br><small>' + e(String(d.source || '').toLowerCase().startsWith('email') ? 'email ' + shortDate(d.received || d.savedAt) : 'by hand ' + shortDate(d.savedAt)) + '</small></td></tr>').join('') + '</tbody></table>';
}

function draw() { $('#weeks').innerHTML = card() + '<h3 class="acc-sub">Weekly route report</h3>' + table() + '<h3 class="acc-sub">Daily load by route (BOL)</h3>' + dayTable(); }

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
    const fields = { mailbox: $('#wk-mailbox').value.trim(), label: $('#wk-label').value.trim(), bolLabel: $('#wk-bol').value.trim(), enabled: $('#wk-enabled').checked };
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
        (d) => d.saved.kind === 'bol' ? (d.saved.changed ? 'Daily load for ' + d.saved.dateText + ' read from ' + d.file + ': ' + d.saved.routes + ' routes, ' + d.saved.lines + ' lines.' : 'Nothing new in ' + d.file + ': the load for ' + d.saved.dateText + ' already matches.')
          : d.saved.changed ? 'Week ending ' + d.saved.weekText + ' read from ' + d.file + ': ' + d.saved.routes + ' routes, ' + d.saved.stops + ' stops.' : 'Nothing new in ' + d.file + ': the week ending ' + d.saved.weekText + ' already matches.');
      return;
    }
    if (['wk-mailbox', 'wk-label', 'wk-bol', 'wk-enabled'].indexOf(ev.target.id) >= 0) saveSettings();
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
