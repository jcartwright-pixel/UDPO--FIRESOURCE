/*
 * Address Check (Joe 11-12-26: "Is there any way we can check the validity of each address?" and "flag each address if
 * something's just not connecting, whether it's serviced out of a location that's nowhere close ... or if it's a PO box").
 * Lists the customers on the Hub's customer list whose address is to check, with the reason (functions/src/addressfill.js and
 * routemaster.js). Read only: addresses are fixed in Customers & Routes. Administrators.
 */
import { callServer, escapeHtml as e, showError, serverText, setAdmin } from './shell.js';

const $ = (s) => document.querySelector(s);
const plantName = (id) => String(id || '').replace(/^fac_/, '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
let data = null, plant = '', plants = new Set();

function draw() {
  const q = $('#find').value.trim().toLowerCase();
  const rows = data.rows.filter(r => !q || [r.name, r.account, r.address].join(' ').toLowerCase().indexOf(q) >= 0);
  const c = data.counts;
  $('#counts').textContent = c.checked ? c.toCheck + ' to check, ' + c.good + ' good, out of ' + c.checked + ' looked at so far (' + c.customers + ' customers).'
    : 'Nothing looked at yet. The check runs every hour, a share at a time.';
  $('#list tbody').innerHTML = rows.length ? rows.map(r => '<tr data-key="' + e(r.key) + '"><td>' + e(r.name) + '</td><td>' + e(r.account) + '</td><td>' + e(r.dcName) + '</td><td>' +
    e(r.address || 'No address') + '</td><td>' + e(r.why) + '</td></tr>').join('') : '<tr><td colspan="5" class="muted">Nothing to check.</td></tr>';
}

export async function load() {
  data = await callServer('hub', { op: 'addressCheck', plant });
  setAdmin(true);
  data.rows.forEach(r => plants.add(r.plant));
  if (plant) plants.add(plant);
  $('#plant').innerHTML = '<option value="">Every plant</option>' + [...plants].sort().map(p => '<option value="' + e(p) + '"' + (p === plant ? ' selected' : '') + '>' + e(plantName(p)) + '</option>').join('');
  draw();
}

export function start() {
  $('#plant').addEventListener('change', () => { plant = $('#plant').value; load().catch(err => showError(serverText(err, 'the address check'))); });
  $('#find').addEventListener('input', () => { if (data) draw(); });
  return load().catch(err => showError(serverText(err, 'the address check')));
}
