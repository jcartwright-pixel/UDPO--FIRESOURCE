/*
 * Email & Texts in the hub (Joe 11-3-26, "one change all"). Where Plant & Distribution's email and texts go and who gets them:
 * the Sending switch and the sent email log, the plant report groups, the 6:00 AM sales route email, who email comes from,
 * repair email to the lessors, the driver check-in mailbox, and the drivers' load done texts. It reads and saves through
 * Operations' own server calls (admin: sentLog, setSending, setForecastEmail, reportGroups, saveReportGroup, salesEmail,
 * saveSalesEmail, salesEmailTest, emailSenders, saveEmailSenders, repairEmail, saveRepairEmail, repairEmailSendNow,
 * checkinEmail, saveCheckinEmail, checkinEmailNow; sms: status, setDoneOn, setForward), the same saves as Administration,
 * Email & Texts there, so nothing is moved or set up again. Like there, a box saves when it is left and a list when it is picked.
 */
import { callServer, escapeHtml as e, showError, serverText, shortDate, setAdmin } from './shell.js';
import { opsOrigin } from './links.js';

const $ = (s) => document.querySelector(s);
const admin = (op, fields) => callServer('admin', Object.assign({ op }, fields || {}));

export const PARTS = [
  { key: 'sending', name: 'Sending & Sent Email', note: 'The one switch for all email, and every email sent' },
  { key: 'reports', name: 'Plant Report', note: 'Who gets the plant report at each plant', plants: true },
  { key: 'sales', name: 'Sales Route Email', note: 'The 6:00 AM route email for sales' },
  { key: 'senders', name: 'Who Email Comes From', note: 'The sender for each plant' },
  { key: 'repairs', name: 'Repair Email', note: 'Truck and trailer repairs to Idealease and Penske' },
  { key: 'checkin', name: 'Driver Check-In Email', note: 'The mailbox the check-ins are read from', plants: true },
  { key: 'texts', name: 'Texts to Drivers', note: 'Load done texts and driver replies' }
];
const MODE_TEXT = { SEND: 'Only when someone presses Send', IMMEDIATE: 'Right away (new repairs)', DAILY: 'Once a day (one list)', NONE: 'Never email' };
const STATUS = { SENT: ['Sent', 'good'], BLOCKED: ['Stopped (sending off)', 'bad'], FAILED: ['Failed', 'bad'], HELD: ['Held', 'warn'] };
const hourText = (h) => (h % 12 || 12) + ':00 ' + (h < 12 ? 'AM' : 'PM');
const when = (iso) => iso ? shortDate(iso) + ' ' + new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : '';
const changed = (at, by) => at ? '<small class="muted">Changed ' + e(when(at)) + (by ? ' by ' + e(by) : '') + '</small>' : '';

let part = PARTS.find(p => p.key === new URLSearchParams(location.search).get('part')) || PARTS[0];
let plant = 'fac_uniontown', got = null, saving = Promise.resolve();

function say(text, kind) {
  const m = $('#msg');
  m.hidden = !text; m.textContent = text || ''; m.className = 'list-msg ' + (kind || '');
}
const sendingLine = (on) => on ? '' : '<p class="list-msg bad">Email sending is Off, so nothing goes out. Turn it on in <a href="?part=sending" data-part="sending">Sending &amp; Sent Email</a>.</p>';

/* ---------- Each part ---------- */

const DRAW = {
  sending(d) {
    const s = d.settings;
    return '<section class="lc-block"><h3>Sending</h3><div class="lc-code"><span>' + (s.sending ? '<span class="pill good">Sending is On</span> Plant &amp; Distribution sends its email.' : '<span class="pill bad">Sending is Off</span> Nothing is emailed; each try is listed below as stopped.') + '</span><span class="lc-acts">' +
      (s.sending ? '<button type="button" class="warn" data-act="sending-off" data-twice="Press again: no email goes out">Turn Off</button>' : '<button type="button" class="primary" data-act="sending-on" data-twice="Press again to turn on">Turn On</button>') + '</span></div>' + changed(s.changedAt, s.changedBy) +
      '<h3>Forecast in the plant report email</h3><div class="lc-acts em-pick"><button type="button" data-act="forecast-me" class="' + (s.forecastEveryone ? '' : 'primary') + '" aria-pressed="' + !s.forecastEveryone + '">Only me (a test sent to myself)</button>' +
      '<button type="button" data-act="forecast-all" class="' + (s.forecastEveryone ? 'primary' : '') + '" aria-pressed="' + !!s.forecastEveryone + '">Everyone</button></div>' + changed(s.forecastChangedAt, s.forecastChangedBy) + '</section>' +
      '<section class="lc-block"><h3>Sent email</h3><p class="muted">Every email sent, stopped, held or failed, newest first. On the practice copy an email goes only to the person who pressed the button.</p>' +
      '<div class="em-scroll"><table class="em-log"><thead><tr><th>When</th><th>Status</th><th>What</th><th>To</th><th>Subject</th></tr></thead><tbody>' +
      (d.emails.map(m => { const st = STATUS[m.status] || [m.status, ''];
        return '<tr><td>' + e(when(m.at)) + '</td><td><span class="pill ' + st[1] + '">' + e(st[0]) + '</span></td><td><b>' + e(m.label || m.kind) + '</b><small>' + e([m.kind, m.detail, m.by].filter(Boolean).join(' · ')) + '</small></td>' +
          '<td>' + e((m.sentTo && m.sentTo.length ? m.sentTo : m.meantFor || []).join('; ')) + (m.testCopy && m.meantFor && m.meantFor.length ? '<small>meant for ' + e(m.meantFor.join('; ')) + '</small>' : '') + '</td>' +
          '<td>' + e(m.subject) + (m.reason ? '<small>' + e(m.reason) + '</small>' : '') + '</td></tr>'; }).join('') || '<tr><td colspan="5" class="muted">No email has been sent or stopped yet.</td></tr>') +
      '</tbody></table></div></section>';
  },
  reports(d) {
    return sendingLine(d.sending) + '<section class="lc-block"><p class="muted">The Send Current Report card on Plant Distribution emails one of these groups. Type the addresses with commas between them; a group saves when you leave its box.</p>' +
      (d.groups.map(g => '<div class="em-row"><label>' + e(g.name) + '<input data-group="' + e(g.name) + '" data-was="' + e(g.recipients.join(', ')) + '" value="' + e(g.recipients.join(', ')) + '"></label>' + changed(g.updatedAt, g.updatedBy) +
        '<span class="lc-acts"><button type="button" data-remove="' + e(g.name) + '" data-twice="Press again to remove">Remove</button></span></div>').join('') || '<p class="muted">No group yet at this plant. Add one below so the report card has someone to send to.</p>') +
      '<div class="lc-add"><label>New group name<input id="new-name" maxlength="100" placeholder="Like Plant Management"></label><label class="em-wide">Addresses<input id="new-to" placeholder="name@uniteddairy.com, second@uniteddairy.com"></label>' +
      '<button type="button" class="primary" data-act="group-add">+ Add Group</button></div></section>';
  },
  sales(d) {
    return sendingLine(d.sending) + '<section class="lc-block"><div class="lc-code"><span>' + (d.on ? '<span class="pill good">On</span> The sales email goes out at 6:00 AM, Monday through Saturday.' : '<span class="pill bad">Off</span> The sales email is not sent.') + '</span><span class="lc-acts">' +
      (d.on ? '<button type="button" class="warn" data-act="sales-off">Turn Off</button>' : '<button type="button" class="primary" data-act="sales-on" data-twice="Press again to turn on">Turn On</button>') +
      '<button type="button" data-act="sales-test">Send a test to me</button></span></div>' +
      '<p class="muted">One line per route: Route, Run and Status, for the routes delivering that day, as of 6:00 AM. Never on Sunday.</p>' +
      '<label class="em-field">Who gets it<small>Addresses with commas between them. Saves when you leave the box.</small><input id="sales-to" data-was="' + e(d.to.join(', ')) + '" value="' + e(d.to.join(', ')) + '"></label>' + changed(d.changedAt, d.changedBy) + '</section>';
  },
  senders(d) {
    const empty = d.standard ? 'Empty: sends as the standard sender, ' + d.standard : 'Empty: no automatic email goes out for this plant until an address is set';
    return sendingLine(d.sending) + '<section class="lc-block"><h3>Email someone sends</h3><p class="muted">Send Current Report, the Lessor button on a truck write-up, Send now and access links.</p>' +
      '<label class="em-field">Comes from<select id="from-who"><option value="PERSON"' + (d.fromWho === 'PLANT' ? '' : ' selected') + '>The person who presses Send (their own United Dairy email)</option><option value="PLANT"' + (d.fromWho === 'PLANT' ? ' selected' : '') + '>The plant\'s address below</option></select></label></section>' +
      '<section class="lc-block"><h3>Email no one presses</h3><p class="muted">Automatic and once-a-day email comes from each plant\'s address. It must be a United Dairy address.</p>' +
      d.plants.map(p => '<div class="em-row" data-plant="' + e(p.id) + '"><b>' + e(p.plant) + '</b><label>Send email from<input data-addr value="' + e(p.address) + '" maxlength="120"><small>' + (p.address ? '' : e(empty)) + '</small></label>' +
        '<label>Name people see<input data-name value="' + e(p.senderName) + '" maxlength="80"><small>' + (p.senderName ? '' : 'Empty: the standard name') + '</small></label>' + changed(p.changedAt, p.changedBy) + '</div>').join('') + '</section>';
  },
  repairs(d) {
    const s = d.settings, keys = Object.keys(d.labels), o = d.openByLessor;
    const auto = keys.some(k => s.routes[k].mode === 'IMMEDIATE' || s.routes[k].mode === 'DAILY');
    return sendingLine(d.sending.sending) + '<section class="lc-block"><div class="lc-code"><span>Open now: <b>' + o.IDEALEASE + '</b> Idealease, <b>' + o.PENSKE + '</b> Penske, <b>' + o.OWNED + '</b> ours (Garage), <b>' + o.HELD + '</b> held</span>' +
      '<span class="lc-acts"><button type="button" data-act="repair-send">Send now</button></span></div>' +
      '<p class="muted">The Lease column on the Fleet List decides who a truck or trailer belongs to. Owned trucks are never emailed (the Garage button makes a work order). Any other Lease, or a unit not on the Fleet List, is held, never sent to a guessed address.</p>' +
      keys.map(k => '<div class="em-row" data-lessor="' + k + '"><b>' + e(d.labels[k]) + '</b><label>Addresses<input data-emails value="' + e(s.routes[k].emails.join('; ')) + '" placeholder="name@company.com; second@company.com"></label>' +
        '<label>How often<select data-mode>' + d.modes.map(m => '<option value="' + m + '"' + (m === s.routes[k].mode ? ' selected' : '') + '>' + e(MODE_TEXT[m] || m) + '</option>').join('') + '</select></label></div>').join('') +
      '<label class="em-field">Once-a-day time<select id="repair-hour">' + Array.from({ length: 24 }, (x, h) => '<option value="' + h + '"' + (h === s.digestHour ? ' selected' : '') + '>' + hourText(h) + '</option>').join('') + '</select></label>' +
      '<p class="muted">' + e(auto ? 'Automatic sending checks about every ' + d.every + ' minutes.' : 'Nothing is sent by itself: no lessor is set to Right away or Once a day.') + ' Right away and Once a day only send repairs reported after they are switched on.</p>' +
      changed(s.updatedAt, s.updatedBy) + '</section>';
  },
  checkin(d) {
    const s = d.settings, l = d.last;
    return '<section class="lc-block"><p class="muted">The phone check-in service emails each driver check-in. This reads that mailbox (it never changes it) and adds equipment issues, cleaning and returns, and cases delivered and returned.</p>' +
      '<div class="lc-code"><span>' + (s.enabled ? '<span class="pill good">On</span> Checked about every ' + d.every + ' minutes.' : '<span class="pill bad">Off</span> The mailbox is not being checked.') + '</span><span class="lc-acts">' +
      '<button type="button" data-act="checkin-now">Check now</button><button type="button" data-act="checkin-std">Use the standard addresses</button></span></div>' +
      '<label class="em-check"><input type="checkbox" id="ci-on"' + (s.enabled ? ' checked' : '') + '> Check the mailbox</label>' +
      '<label class="em-field">Sent by (the answering service)<input type="email" id="ci-from" value="' + e(s.sender) + '"></label>' +
      '<label class="em-field">Sent to (our mailbox)<input type="email" id="ci-to" value="' + e(s.recipient) + '"></label>' +
      '<label class="em-field">Subject line it looks for<input id="ci-subject" maxlength="120" value="' + e(s.subject) + '"></label>' +
      '<p class="muted">Last good check: ' + e(s.lastSuccessAt ? when(s.lastSuccessAt) : 'never') + (l ? '. Last run: ' + e(String(l.status).toLowerCase()) + ', ' + l.read + ' read, ' + l.added + ' added, ' + l.review + ' need a look' + (l.error ? ': ' + e(l.error) : '') : '') + '.</p></section>';
  },
  texts(d) {
    const keys = d.hasSid && d.hasToken && d.from;
    return '<section class="lc-block">' + (keys ? '' : '<p class="list-msg bad">The Twilio account is not saved yet. Set it up in <a href="keys.html">Keys &amp; Connections</a> first.</p>') +
      (d.live ? '' : '<p class="muted">Practice copy: texts are written to the list in Plant &amp; Distribution only and never sent to anyone.</p>') +
      '<h3>Load done texts</h3><div class="lc-code"><span>' + (d.doneOn ? '<span class="pill good">On</span> Each ticked driver gets a text when the plant finishes their load.' : '<span class="pill bad">Off</span> No load done texts are sent.') + '</span><span class="lc-acts">' +
      (d.doneOn ? '<button type="button" class="warn" data-act="done-off">Turn Off</button>' : '<button type="button" class="primary" data-act="done-on"' + (keys ? '' : ' disabled') + '>Turn On</button>') + '</span></div>' + changed(d.doneSwitchedAt, d.doneSwitchedBy) +
      '<p class="muted">Who gets texts is ticked on the Driver Roster.</p>' +
      '<h3>Driver replies to your cell</h3><label class="em-field">Text each driver\'s reply on to<small>10 digits, like 330-555-1234. Leave it empty to stop. Saves when you leave the box.</small><input id="fwd" type="tel" data-was="' + e(d.forwardTo) + '" value="' + e(d.forwardTo) + '"></label>' +
      '<p class="muted">' + (d.forwardTo ? 'On: every reply since ' + e(when(d.forwardSince)) + ' is texted to ' + e(d.forwardTo) + '.' : 'Off: replies are only listed in Plant &amp; Distribution.') + '</p>' +
      '<h3>Schedule texts</h3><p class="muted">The week\'s schedule texts are sent from Plant &amp; Distribution when the week is posted.</p>' +
      '<div class="lc-acts"><a class="primary" href="' + e(opsOrigin(location) + '/texts.html') + '" target="_blank" rel="noopener">Open Texts in Plant &amp; Distribution <span class="sr">(opens in a new tab)</span></a></div></section>';
  }
};

const LOAD = {
  sending: () => admin('sentLog'),
  reports: () => admin('reportGroups', { facilityId: plant }),
  sales: () => admin('salesEmail'),
  senders: () => admin('emailSenders'),
  repairs: () => admin('repairEmail'),
  checkin: () => admin('checkinEmail', { plant, udPlant: plant }),
  texts: () => callServer('sms', { op: 'status' })
};

function draw() {
  $('#parts').innerHTML = PARTS.map(p => '<a href="?part=' + p.key + '" data-part="' + p.key + '"' + (p === part ? ' class="on" aria-current="page"' : '') + '><b>' + e(p.name) + '</b><small>' + e(p.note) + '</small></a>').join('');
  const plants = (got && (got.locations || got.plants)) || [];
  $('#plant-pick').hidden = !part.plants;
  if (part.plants) {
    $('#plant').innerHTML = plants.map(p => '<option value="' + e(p.id) + '"' + (p.id === plant ? ' selected' : '') + '>' + e(p.name) + '</option>').join('');
    $('#plant').disabled = plants.length < 2;
  }
  $('#part').innerHTML = '<h2>' + e(part.name) + '</h2>' + (got ? DRAW[part.key](got) : '');
}

async function load() {
  await saving;
  got = null;
  got = await LOAD[part.key]();
  setAdmin(true);
  draw();
}

// One save at a time, in order, so quick changes never undo each other. A refused save says why and keeps what was typed.
function save(work, done) {
  say('');
  saving = saving.then(async () => {
    try {
      const out = await work();
      if (done) done(out);
      const note = String(out && out.message || '').replace(/^Saved\.\s*/, '');
      say(note || 'Saved.', note ? 'warn' : 'good');
    } catch (err) { say(serverText(err, 'Plant & Distribution'), 'bad'); }
  });
  return saving;
}

// A button that does something now: disabled while it runs, then the part is read again.
async function run(b, work) {
  document.querySelectorAll('#part button').forEach(x => { x.disabled = true; });
  say('');
  let msg = ['Done.', 'good'];
  try {
    await saving;
    const out = await work();
    if (out && out.message) msg = [out.message, out.ok === false || out.status === 'FAIL' ? 'bad' : 'good'];
  } catch (err) { msg = [serverText(err, 'Plant & Distribution'), 'bad']; }
  try { await load(); } catch (err) { draw(); }
  say(msg[0], msg[1]);
}

function repairFields() {
  const routes = {};
  document.querySelectorAll('[data-lessor]').forEach(r => { routes[r.dataset.lessor] = { emails: r.querySelector('[data-emails]').value, mode: r.querySelector('[data-mode]').value }; });
  return { routes, digestHour: Number($('#repair-hour').value) };
}
function checkinFields() {
  return { plant, udPlant: plant, enabled: $('#ci-on').checked, sender: $('#ci-from').value, recipient: $('#ci-to').value, subject: $('#ci-subject').value };
}
function senderFields(row) {
  const senders = {};
  if (row) senders[row.dataset.plant] = { address: row.querySelector('[data-addr]').value, name: row.querySelector('[data-name]').value };
  return { senders, fromWho: $('#from-who').value };
}

function change(ev) {
  const t = ev.target;
  if (t.id === 'plant') { plant = t.value; say(''); load().catch(err => say(serverText(err, 'Plant & Distribution'), 'bad')); return; }
  if (t.dataset.group !== undefined) {
    if (t.value.trim() === t.dataset.was) return;
    save(() => admin('saveReportGroup', { facilityId: plant, name: t.dataset.group, recipients: t.value }), () => { t.dataset.was = t.value.trim(); });
  }
  if (t.id === 'sales-to' && t.value.trim() !== t.dataset.was) save(() => admin('saveSalesEmail', { to: t.value }), (d) => { t.dataset.was = d.to.join(', '); got = d; });
  if (t.id === 'from-who' || t.closest('[data-plant]')) save(() => admin('saveEmailSenders', senderFields(t.closest('[data-plant]'))), (d) => { got = d; });
  if (t.closest('[data-lessor]') || t.id === 'repair-hour') save(() => admin('saveRepairEmail', repairFields()), (d) => { got = d; });
  if (['ci-on', 'ci-from', 'ci-to', 'ci-subject'].indexOf(t.id) >= 0) save(() => admin('saveCheckinEmail', checkinFields()), (d) => { if (d.plant === plant) { got = d; if (t.id === 'ci-on') draw(); } });
  if (t.id === 'fwd' && t.value.trim() !== t.dataset.was) save(() => callServer('sms', { op: 'setForward', phone: t.value }), (d) => { got = d; draw(); });
}

function click(ev) {
  const a = ev.target.closest('a[data-part]');
  if (a) { ev.preventDefault(); return open(a.dataset.part); }
  const b = ev.target.closest('button');
  document.querySelectorAll('#part button.armed').forEach(x => { if (x !== b) { x.classList.remove('armed'); x.textContent = x.dataset.label; } });
  if (!b) return;
  if (b.dataset.twice && !b.classList.contains('armed')) { b.dataset.label = b.textContent; b.classList.add('armed'); b.textContent = b.dataset.twice; return; }
  const act = b.dataset.act;
  if (b.dataset.remove) {
    const g = got.groups.find(x => x.name === b.dataset.remove);
    return run(b, () => admin('saveReportGroup', { facilityId: plant, name: g.name, recipients: g.recipients.join(','), active: false }));
  }
  if (act === 'group-add') {
    const name = $('#new-name').value.trim(), to = $('#new-to').value.trim();
    if (!name || !to) { say('A new group needs a name and at least one address.', 'bad'); return; }
    return run(b, () => admin('saveReportGroup', { facilityId: plant, name, recipients: to }));
  }
  const ACTS = {
    'sending-on': () => admin('setSending', { on: true }), 'sending-off': () => admin('setSending', { on: false }),
    'forecast-me': () => admin('setForecastEmail', { everyone: false }), 'forecast-all': () => admin('setForecastEmail', { everyone: true }),
    'sales-on': () => admin('saveSalesEmail', { on: true }).then(d => Object.assign({ message: d.message || 'The sales email is on.' }, d)),
    'sales-off': () => admin('saveSalesEmail', { on: false }).then(d => Object.assign({ message: 'The sales email is off.' }, d)),
    'sales-test': () => admin('salesEmailTest'),
    'repair-send': () => admin('repairEmailSendNow'),
    'checkin-now': () => admin('checkinEmailNow', { plant, udPlant: plant }),
    'checkin-std': () => { $('#ci-from').value = got.standard.sender; $('#ci-to').value = got.standard.recipient; $('#ci-subject').value = got.standard.subject; return admin('saveCheckinEmail', checkinFields()).then(d => Object.assign({ message: 'The standard addresses are saved.' }, d)); },
    'done-on': () => callServer('sms', { op: 'setDoneOn', on: true }).then(() => ({ message: 'Load done texts are on.' })),
    'done-off': () => callServer('sms', { op: 'setDoneOn', on: false }).then(() => ({ message: 'Load done texts are off.' }))
  };
  if (ACTS[act]) return run(b, ACTS[act]);
}

function open(key) {
  part = PARTS.find(p => p.key === key) || PARTS[0];
  history.pushState(null, '', '?part=' + part.key);
  say('');
  got = null;
  draw();
  load().catch(err => say(serverText(err, 'Plant & Distribution'), 'bad'));
}

export function start() {
  $('#practice').hidden = !/sandbox|localhost|127\.0\.0\.1/.test(location.hostname);
  $('#part').addEventListener('change', change);
  $('#plant').addEventListener('change', change);
  document.addEventListener('click', (ev) => { if (ev.target.closest('#parts, #part')) click(ev); });
  window.addEventListener('popstate', () => { part = PARTS.find(p => p.key === new URLSearchParams(location.search).get('part')) || PARTS[0]; got = null; load().catch(() => {}); });
  return load().catch(err => showError(serverText(err, 'the email settings')));
}
