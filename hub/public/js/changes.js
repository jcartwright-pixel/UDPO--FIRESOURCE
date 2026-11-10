/*
 * Customer Changes (Joe 11-9-26: "The hub is the only thing allowed to save to the customer list"; apps "keep their changes"
 * until approved). Every change an app sends to the route customer list waits here (hubCustomerChanges, functions/src/changes.js).
 * An administrator approves it, and the Customer List then saves it, or turns it down with a reason the sender sees.
 */
import { callServer, escapeHtml as e, showError, serverText, setAdmin, shortDate } from './shell.js';

const $ = (s) => document.querySelector(s);
const STATUS = { sent: ['Waiting for approval', 'warn'], approved: ['Approved, the customer list saves it next', 'good'], applied: ['Saved to the customer list', 'good'],
  rejected: ['The customer list could not save it', 'bad'], turnedDown: ['Turned down', 'bad'], withdrawn: ['Taken back by the sender', 'muted'] };
const DAYS = { SUN: 'Sunday', MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday' };
let data = null, plant = '';
const plantName = (id) => String(id || '').replace(/^fac_/, '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const time = (v) => v ? shortDate(v) + ' ' + new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(v)) : '';

function card(c, open) {
  const [label, tone] = STATUS[c.status] || [c.status, 'muted'];
  const where = [plantName(c.plant), c.route ? 'Route ' + c.route : '', DAYS[c.day] || ''].filter(Boolean).join(' · ');
  const after = c.status === 'turnedDown' ? 'Turned down by ' + c.turnedDownBy + ' ' + time(c.turnedDownAt) + ': ' + c.why
    : c.status === 'rejected' ? 'The customer list said: ' + (c.why || 'it changed since it was sent')
    : c.approvedAt ? 'Approved by ' + c.approvedBy + ' ' + time(c.approvedAt) : '';
  return '<article class="lc-card" data-change="' + e(c.id) + '"><header><h3>' + e(c.summary) + '</h3><span class="pill ' + tone + '">' + e(label) + '</span></header>' +
    '<p>' + e(c.kindName || c.kind) + '</p><p class="muted">' + e(where) + '</p>' +
    '<p class="muted">Sent from ' + e(c.fromName || c.from) + ' by ' + e(c.sentBy) + ' ' + e(time(c.sentAt)) + '</p>' +
    (after ? '<p>' + e(after) + '</p>' : '') +
    (open && c.status === 'sent' ? '<div class="lc-acts"><button type="button" class="primary" data-approve="' + e(c.id) + '">Approve</button>' +
      '<label class="sr" for="why-' + e(c.id) + '">Why it is turned down</label><input id="why-' + e(c.id) + '" placeholder="Why it is turned down" maxlength="500">' +
      '<button type="button" data-down="' + e(c.id) + '">Turn down</button></div>' : '') + '</article>';
}

function draw() {
  $('#open').innerHTML = data.open.length ? data.open.map(c => card(c, true)).join('') : '<p class="muted">Nothing is waiting.</p>';
  $('#done').innerHTML = data.done.length ? data.done.map(c => card(c, false)).join('') : '<p class="muted">Nothing yet.</p>';
}

export async function load() {
  data = await callServer('hub', { op: 'customerChanges', plant });
  setAdmin(true);
  const seen = new Set(data.open.concat(data.done).map(c => c.plant));
  if (plant) seen.add(plant);
  $('#plant').innerHTML = '<option value="">Every plant</option>' + [...seen].sort().map(p => '<option value="' + e(p) + '"' + (p === plant ? ' selected' : '') + '>' + e(plantName(p)) + '</option>').join('');
  draw();
}

async function act(fields) {
  showError('');
  try { await callServer('hub', fields); await load(); } catch (err) { showError(serverText(err, 'the Hub')); }
}

export function start() {
  $('#plant').addEventListener('change', () => { plant = $('#plant').value; load().catch(err => showError(serverText(err, 'the Hub'))); });
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-approve]'), d = ev.target.closest('[data-down]');
    if (a) act({ op: 'approveChange', id: a.dataset.approve });
    if (d) act({ op: 'turnDownChange', id: d.dataset.down, why: (document.getElementById('why-' + d.dataset.down) || {}).value || '' });
  });
  return load().catch(err => showError(serverText(err, 'the customer changes')));
}
