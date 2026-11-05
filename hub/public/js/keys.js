/*
 * Keys & Connections in the hub (Joe: "move that code that has the secrets in it ... I don't want to have to redo everything").
 * The sign-ins Plant & Distribution already uses, kept exactly where they are (Firestore private/gpsFleet, private/redzone,
 * private/mocreo, private/sms) and changed through Operations' own server calls (gps with kind fleet, redzone, mocreo, sms:
 * status, save, clear, test). The PC Miler key (Joe 11-5-26) is kept in private/pcmiler and changed through the Route
 * Estimator's own call (routeEstimator with area key: status, save, clear, test), in the same way. Nothing is moved, copied or set up again. A saved key never comes back to the browser: the calls
 * answer only whether it is saved (and, for some, its last four letters), and a box left empty keeps what is saved.
 */
import { callServer, escapeHtml as e, showError, serverText, shortDate, setAdmin } from './shell.js';

const $ = (s) => document.querySelector(s);

// Each connection: the Operations call, the extra fields that call needs, the boxes (secret ones are password boxes), and
// how its answer says what is saved.
export const KEYS = [
  { key: 'gps', call: 'gps', extra: { kind: 'fleet' }, name: 'Verizon Connect GPS', what: 'Trucks Today, the trip fuel and the reefer temperatures read the trucks from Verizon Connect Fleet with this sign-in.',
    fields: [['fleet', 'Fleet name', false], ['user', 'Sub-user name', false], ['password', 'Password', true]],
    saved: (s) => [['Fleet name', s.fleet || ''], ['Sub-user name', s.hasUser], ['Password', s.hasPassword]] },
  { key: 'redzone', call: 'redzone', name: 'RedZone', what: 'Products and the production lines read from RedZone with this sign-in.',
    fields: [['clientId', 'Client ID', false], ['clientSecret', 'Client secret', true], ['token', 'API token (instead of the client ID and secret)', true], ['orgId', 'Organization ID', false], ['enterpriseId', 'Enterprise ID', false]],
    saved: (s) => [['Client ID', s.hasClient && (s.clientEnds ? 'ends in ' + s.clientEnds : true)], ['Client secret', s.hasSecret], ['API token', s.hasToken && (s.tokenEnds ? 'ends in ' + s.tokenEnds : true)], ['Organization ID', s.orgId || ''], ['Enterprise ID', s.enterpriseId || '']] },
  { key: 'mocreo', call: 'mocreo', name: 'MOCREO thermometers', what: 'The cooler and freezer thermometers are read from MOCREO with this key. Readings start once Test Connection passes.',
    fields: [['apiKey', 'API key', true], ['assetId', 'Asset ID', false]],
    saved: (s) => [['API key', s.hasKey && (s.keyEnds ? 'ends in ' + s.keyEnds : true)], ['Asset ID', s.hasAsset && (s.assetEnds ? 'ends in ' + s.assetEnds : true)]] },
  { key: 'sms', call: 'sms', name: 'Twilio texts', what: 'The drivers\' schedule and load done texts go out through this Twilio account.',
    fields: [['accountSid', 'Account SID (starts with AC)', false], ['authToken', 'Auth token', true], ['fromNumber', 'Twilio phone number', false]],
    saved: (s) => [['Account SID', s.hasSid], ['Auth token', s.hasToken], ['Phone number', s.from || '']] },
  { key: 'pcmiler', call: 'routeEstimator', extra: { area: 'key' }, name: 'PC Miler (Trimble)', what: 'Route & Trip Costs gets truck miles, drive time, tolls and address suggestions from PC Miler with this key. Test Connection looks up the Uniontown plant and routes a truck to Martins Ferry.',
    fields: [['apiKey', 'API key', true]],
    saved: (s) => [['API key', s.hasKey && (s.keyEnds ? 'ends in ' + s.keyEnds : true)]] }
];
let got = {};

function say(text, kind) {
  const m = $('#msg');
  m.hidden = !text; m.textContent = text || ''; m.className = 'list-msg ' + (kind || '');
}
const ask = (k, fields) => callServer(k.call, Object.assign({}, k.extra || {}, fields));
const isSaved = (k, s) => k.saved(s).some(([, v]) => v);

function card(k) {
  const s = got[k.key];
  if (s && s.failed) return '<article class="key-card" data-key="' + k.key + '"><header><h2>' + e(k.name) + '</h2></header><p class="muted">' + e(s.failed) + '</p></article>';
  const t = s.lastTest, saved = isSaved(k, s);
  const test = k.key === 'sms' ? (s.test ? '<p class="key-test ' + (s.test.status === 'SENT' ? 'good' : 'bad') + '">Test text to ' + e(s.test.to) + ': ' + e(s.test.status === 'SENT' ? 'sent' : s.test.reason || s.test.status) + '</p>' : '')
    : t ? '<p class="key-test ' + (t.ok ? 'good' : 'bad') + '"><b>' + (t.ok ? 'Test passed' : 'Test failed') + '</b> ' + e(shortDate(t.at)) + ': ' + e(t.message || '') + '</p>' : saved ? '<p class="key-test">Not tested since it was saved.</p>' : '';
  return '<article class="key-card" data-key="' + k.key + '"><header><h2>' + e(k.name) + '</h2>' + (saved ? '<span class="pill good">Saved</span>' : '<span class="pill">Not set up</span>') + '</header>' +
    '<p>' + e(k.what) + '</p><dl class="key-saved">' + k.saved(s).map(([n, v]) => '<dt>' + e(n) + '</dt><dd>' + (v ? (v === true ? 'Saved' : e(String(v))) : '<span class="muted">none</span>') + '</dd>').join('') + '</dl>' +
    (s.savedAt ? '<p class="muted small">Last changed ' + e(shortDate(s.savedAt)) + (s.savedBy ? ' by ' + e(s.savedBy) : '') + '</p>' : '') + test +
    '<details class="key-change"><summary>' + (saved ? 'Replace' : 'Set up') + '</summary><p class="muted small">Fill only what changes; an empty box keeps what is saved.</p>' +
    k.fields.map(([f, label, secret]) => '<label>' + e(label) + '<input data-field="' + f + '" type="' + (secret ? 'password' : 'text') + '" autocomplete="off" spellcheck="false"></label>').join('') +
    '<div class="key-acts"><button type="button" class="primary" data-act="save">Save</button></div></details>' +
    '<div class="key-acts">' + (k.key === 'sms' ? '<label class="inline">Send a test text to<input data-field="phone" type="tel" placeholder="330-555-0100"></label><button type="button" data-act="test">Send test text</button>'
      : '<button type="button" data-act="test"' + (saved ? '' : ' disabled') + '>Test Connection</button>') +
    (saved ? '<button type="button" class="warn" data-act="clear" data-twice="Press again to remove the key">Remove key</button>' : '') + '</div></article>';
}

function draw() { $('#cards').innerHTML = KEYS.map(card).join(''); }

async function loadOne(k) {
  try { got[k.key] = await ask(k, { op: 'status' }); } catch (err) { got[k.key] = { failed: serverText(err, k.name) }; }
}

async function act(b) {
  const box = b.closest('[data-key]'), k = KEYS.find(x => x.key === box.dataset.key), a = b.dataset.act;
  const fields = {};
  box.querySelectorAll('[data-field]').forEach(i => { if (i.value.trim()) fields[i.dataset.field] = i.value.trim(); });
  if (a === 'save' && !Object.keys(fields).filter(f => f !== 'phone').length) { say('Type the new ' + k.name + ' sign-in first.', 'bad'); return; }
  box.querySelectorAll('button').forEach(x => { x.disabled = true; });
  say('');
  let msg;
  try {
    if (a === 'save') { delete fields.phone; got[k.key] = await ask(k, Object.assign({ op: 'save' }, fields)); msg = [k.name + ' saved. Press Test Connection to check it.', 'good']; }
    if (a === 'clear') { got[k.key] = await ask(k, { op: 'clear' }); msg = [k.name + ' key removed.', 'good']; }
    if (a === 'test') {
      const out = await ask(k, k.key === 'sms' ? { op: 'test', phone: fields.phone || '' } : { op: 'test' });
      got[k.key] = out;
      const r = out.result || (out.test ? { ok: out.test.status === 'SENT', message: 'Test text to ' + out.test.to + ': ' + (out.test.status === 'SENT' ? 'sent.' : out.test.reason || out.test.status) } : { ok: false, message: 'No answer.' });
      msg = [k.name + ': ' + r.message, r.ok ? 'good' : 'bad'];
    }
  } catch (err) { msg = [k.name + ': ' + serverText(err, k.name), 'bad']; }
  draw();
  say(msg[0], msg[1]);
}

function click(ev) {
  const b = ev.target.closest('button[data-act]');
  document.querySelectorAll('#cards button.armed').forEach(x => { if (x !== b) { x.classList.remove('armed'); x.textContent = x.dataset.label; } });
  if (!b) return;
  if (b.dataset.twice && !b.classList.contains('armed')) { b.dataset.label = b.textContent; b.classList.add('armed'); b.textContent = b.dataset.twice; return; }
  act(b);
}

export async function load() {
  // Administrators only: the hub's own check first, so nobody else is shown even which keys are saved.
  await callServer('hub', { op: 'appAccess' });
  setAdmin(true);
  await Promise.all(KEYS.map(loadOne));
  draw();
}

export function start() {
  $('#cards').addEventListener('click', click);
  return load().catch(err => showError(serverText(err, 'the keys')));
}
