/*
 * Weekly Route Report in the hub (Joe 11-6-26: "it pulls in the dollar amount, but it also gave us cases ... I'm saying to store
 * in there, that way we don't have to continue gathering more data anywhere"). MIS's weekly ROUTE WEEKLY CASE DELIVERY REVIEW
 * BY STORE is read once, by Operations' server (functions/src/routeweekly.js, Administration steps routeWeeklyStatus /
 * routeWeeklySaveSettings / routeWeeklyUpload / routeWeeklyCheckNow), and kept in routeWeekly/<week ending>. Built like Daily
 * BOL (bol.js): the settings save by themselves. No sales are shown here.
 */
import { callServer, escapeHtml as e, showError, serverText, shortDate, setAdmin } from './shell.js';

const $ = (s) => document.querySelector(s);
const admin = (op, fields, ms) => callServer('admin', Object.assign({ op }, fields || {}), ms);
let got = null, busy = '';

const whole = (v) => v == null ? '' : Math.round(Number(v)).toLocaleString('en-US');
const time = (v) => { const t = new Date(v); return isNaN(t) ? '' : t.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }); };
const when = (v) => v ? shortDate(v) + ' ' + time(v) : '';

function say(text, kind) { const m = $('#msg'); m.hidden = !text; m.textContent = text || ''; m.className = 'list-msg ' + (kind || ''); }

const pillHtml = (s) => s.enabled ? '<span class="pill good">ON</span>' : '<span class="pill">OFF</span>';
const lineHtml = (s) => s.enabled ? 'CHECKS <b>' + e(s.mailbox) + '</b>, LABEL <b>' + e(s.label) + '</b>, EVERY MORNING FOR A NEW WEEK.' : 'NOT CHECKING EMAIL. TYPE THE MAILBOX AND TICK CHECK EVERY MORNING.';

function mailCard() {
  const s = got.settings, last = got.last;
  const lastLine = last ? '<p class="' + (last.status === 'FAIL' ? 'acc-bad' : 'muted') + '">LAST CHECKED ' + e(when(last.at)) + ': ' + e(last.message || '') + '</p>' : '<p class="muted">NOT CHECKED YET.</p>';
  return '<section class="acc-card"><div class="acc-row"><h2>FROM EMAIL</h2><span id="mail-pill">' + pillHtml(s) + '</span></div>' +
    '<p id="mail-line">' + lineHtml(s) + '</p>' +
    '<div class="acc-row"><label>MAILBOX THE REPORT COMES TO<input id="mailbox" type="email" autocomplete="off" spellcheck="false" value="' + e(s.mailbox) + '" placeholder="name@uniteddairy.com"></label>' +
    '<label>EMAIL LABEL<input id="label" type="text" autocomplete="off" spellcheck="false" value="' + e(s.label) + '" placeholder="Routes/Sale by Route"></label>' +
    '<label>ONLY FROM (OPTIONAL)<input id="sender" type="text" autocomplete="off" spellcheck="false" value="' + e(s.sender) + '" placeholder="MIS\'s address"></label>' +
    '<label class="inline"><input id="enabled" type="checkbox"' + (s.enabled ? ' checked' : '') + '> CHECK EVERY MORNING</label></div>' + lastLine +
    '<div class="acc-row"><button type="button" class="primary" id="check"' + (s.mailbox && !busy ? '' : ' disabled title="Type the mailbox first"') + '>' + (busy === 'check' ? 'CHECKING…' : 'CHECK EMAIL NOW') + '</button>' +
    '<button type="button" id="pick"' + (busy ? ' disabled' : '') + '>' + (busy === 'file' ? 'READING THE FILE…' : 'ADD A FILE BY HAND') + '</button><input type="file" id="file" accept=".xls,.xlsx,.csv" hidden></div></section>';
}

function weeksTable() {
  if (!got.weeks.length) return '<p class="hub-empty">NO WEEKS YET. PRESS CHECK EMAIL NOW, OR ADD A FILE BY HAND AND PICK THE WEEKLY DAILY AVG CASES BY ROUTE FILE.</p>';
  const cur = got.open && got.open.week;
  return '<section class="bol-part"><h2>WEEKS KEPT (' + got.weeks.length + ')</h2><table class="acc-table bol-days"><thead><tr><th>WEEK ENDING</th><th>ROUTES</th><th>STORES</th><th>CASES</th><th class="from">FROM</th></tr></thead><tbody>' +
    got.weeks.map(w => '<tr class="' + (w.week === cur ? 'on' : '') + '"><td class="strong"><button type="button" class="bol-day" data-week="' + e(w.week) + '">' + e(shortDate(w.week)) + '</button></td>' +
      '<td>' + whole(w.routes) + '</td><td>' + whole(w.stores) + '</td><td>' + whole(w.cases) + '</td>' +
      '<td class="muted">' + e(w.file) + '<br><small>' + e((w.source === 'EMAIL' ? 'EMAIL ' : 'BY HAND ') + when(w.received)) + '</small></td></tr>').join('') + '</tbody></table></section>';
}

function routesTable() {
  const o = got.open;
  if (!o) return '';
  return '<section class="bol-part"><h2>ROUTES, WEEK ENDING ' + e(shortDate(o.week)) + '</h2>' +
    '<p class="muted">' + whole(o.routes.length) + ' ROUTES · ' + whole(o.stores) + ' STORES · ' + whole(o.cases) + ' CASES.</p>' +
    '<table class="acc-table bol-routes"><thead><tr><th>ROUTE</th><th>STORES</th><th>DELIVERIES</th><th>CASES</th></tr></thead><tbody>' +
    o.routes.map(r => '<tr><td class="strong">' + e(r.route) + '</td><td>' + whole(r.stores) + '</td><td>' + whole(r.deliveries) + '</td><td>' + whole(r.cases) + '</td></tr>').join('') +
    '</tbody></table></section>';
}

function draw() { $('#mail').innerHTML = mailCard(); drawWeeks(); }
function drawWeeks() { $('#days').innerHTML = '<div class="bol-grid">' + weeksTable() + routesTable() + '</div>'; }

async function run(kind, fn, done) {
  busy = kind; draw(); say('');
  try { got = await fn(); say(done(got), got.run && got.run.status === 'FAIL' ? 'bad' : 'good'); } catch (err) { say(serverText(err, 'the weekly route report'), 'bad'); }
  busy = ''; draw();
}

const fileText = (f) => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = () => bad(new Error('Could not read the file')); r.readAsDataURL(f); });

let saving = Promise.resolve();
function saveSettings() {
  saving = saving.then(async () => {
    const fields = { mailbox: $('#mailbox').value.trim(), label: $('#label').value.trim(), sender: $('#sender').value.trim(), enabled: $('#enabled').checked };
    try { const d = await admin('routeWeeklySaveSettings', fields); got.settings = d.settings; got.last = d.last; say(''); }
    catch (err) { say(serverText(err, 'the weekly route report'), 'bad'); if (fields.enabled && !fields.mailbox) $('#enabled').checked = false; return; }
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
      run('file', async () => admin('routeWeeklyUpload', { fileName: f.name, base64: await fileText(f) }, 120000),
        (d) => d.saved.map(s => 'WEEK ENDING ' + s.label + ': ' + s.routes + ' ROUTES, ' + s.stops + ' STORES').join('. ') + ' READ FROM ' + d.file + '.');
      ev.target.value = '';
      return;
    }
    if (['mailbox', 'label', 'sender', 'enabled'].indexOf(ev.target.id) >= 0) saveSettings();
  });
  $('#mail').addEventListener('click', (ev) => {
    if (ev.target.id === 'pick') $('#file').click();
    if (ev.target.id === 'check') run('check', () => admin('routeWeeklyCheckNow', {}, 300000), (d) => d.run.message || 'CHECKED.');
  });
  $('#days').addEventListener('click', async (ev) => {
    const wk = ev.target.closest('.bol-day');
    if (!wk) return;
    try { const d = await admin('routeWeeklyStatus', { week: wk.dataset.week }); got.open = d.open; got.weeks = d.weeks; drawWeeks(); }
    catch (err) { say(serverText(err, 'the weekly route report'), 'bad'); }
  });
}

export async function start() {
  try {
    await callServer('hub', { op: 'appAccess' });
    setAdmin(true);
    got = await admin('routeWeeklyStatus');
    draw(); wire();
  } catch (err) { showError(serverText(err, 'the weekly route report')); }
}
