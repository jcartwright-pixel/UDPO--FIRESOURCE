/*
 * Plant Setup in the hub (Joe 11-3-26, "one change all"). Plant & Distribution's set-up screens for a plant: the Upload Center,
 * Plant Shifts, Location Areas, Menu Setup, the Plant Schedule and the Maintenance set-up. They are large working screens, so
 * the hub does not copy them: pick a plant here and each one opens in Plant & Distribution on that plant (?plant=), saving
 * exactly as it always has. The plant list comes from Operations' own server call (admin emailSenders), for Administrators only.
 */
import { callServer, escapeHtml as e, showError, serverText, setAdmin } from './shell.js';
import { opsOrigin, plantPath } from './links.js';

const $ = (s) => document.querySelector(s);

// The set-up screens, as Administration lists them (public/js/admin-items.js: Plant Setup and Plant Maintenance Setup).
export const SETUP = [
  ['Plant Setup', [
    ['Upload Center', 'uploads.html', 'Bring in a new plant\'s data from one Excel workbook: routes, drivers, the plant, people and email. Every row is checked before anything is saved.'],
    ['Plant Shifts', 'shifts.html', 'Each plant\'s Distribution and Plant Production shifts. Plant Reports compare the shifts by these times.'],
    ['Location Areas', 'location-areas.html', 'The plant\'s areas (Plant, Garage, Office, Yard) and their sub-areas: add, rename, reorder, turn off. The Safety Walkthrough walks them in this order.'],
    ['Menu Setup', 'menu-setup.html', 'The plant\'s menu in its own order: move a section up or down, or to another side.'],
    ['Plant Schedule Setup', 'crew.html?view=setup', 'The plant people schedule: areas with their own shift times, the jobs and how many each needs, the people, and the time-off limits.']
  ]],
  ['Plant Maintenance Setup', [
    ['Maintenance Schedule Setup', 'maint-crew.html?view=setup', 'Plant Maintenance\'s own schedule: its areas and shifts, jobs, mechanics and time-off limits.'],
    ['Maintenance Equipment', 'plant-equipment.html', 'What maintenance looks after besides the production machines: refrigeration, boilers, compressors, the building.']
  ]]
];

let plants = [], plant = 'fac_uniontown';
const url = (path) => opsOrigin(location) + '/' + plantPath(path, plant);

function draw() {
  $('#plant').innerHTML = plants.map(p => '<option value="' + e(p.id) + '"' + (p.id === plant ? ' selected' : '') + '>' + e(p.name) + '</option>').join('');
  $('#plant').disabled = plants.length < 2;
  const name = (plants.find(p => p.id === plant) || {}).name || '';
  $('#setup').innerHTML = SETUP.map(([group, items]) => '<section class="lc-main"><h2>' + e(group) + '</h2><div class="lc-cards">' + items.map(([title, path, what]) =>
    '<article class="lc-card" data-page="' + e(path) + '"><header><h3>' + e(title) + '</h3></header><p>' + e(what) + '</p>' +
    '<div class="lc-acts"><a class="primary" href="' + e(url(path)) + '" target="_blank" rel="noopener">Open for ' + e(name) + ' <span class="sr">(opens in a new tab)</span></a></div></article>').join('') + '</div></section>').join('');
}

export async function load() {
  const d = await callServer('admin', { op: 'emailSenders' });
  plants = d.plants.map(p => ({ id: p.id, name: p.plant }));
  if (!plants.some(p => p.id === plant)) plant = (plants[0] || {}).id || 'fac_uniontown';
  setAdmin(true);
  draw();
}

export function start() {
  $('#practice').hidden = !/sandbox|localhost|127\.0\.0\.1/.test(location.hostname);
  $('#plant').addEventListener('change', () => { plant = $('#plant').value; draw(); });
  return load().catch(err => showError(serverText(err, 'the plant set-up')));
}
