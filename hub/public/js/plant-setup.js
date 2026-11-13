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

// Where each plant is (hubPlants, MapMaker 11-12-26): the address and map point for every plant, saved through the hub call.
let places = [];
function placeCard(p, i) {
  const v = (x) => (x === null || x === undefined ? '' : e(String(x)));
  const how = p.id ? (p.source === 'hub' ? 'Saved by ' + e(p.savedBy || 'an administrator') : 'Filled in by the hub from Route & Trip\'s starting points') : 'New plant';
  return '<article class="lc-card" data-place="' + i + '"><header><h3>' + (p.name ? e(p.name) : 'New plant') + '</h3></header>' +
    '<p class="muted">' + how + (p.id && (p.lat === null || p.lat === undefined) ? ' · <span class="bad">No map point yet</span>' : '') + '</p>' +
    '<label>Name <input data-f="name" value="' + v(p.name) + '" maxlength="80"></label>' +
    '<label>Street address <input data-f="address" value="' + v(p.address) + '" maxlength="300" placeholder="47 Main Street, Town, PA"></label>' +
    '<label>Map point, north <input data-f="lat" value="' + v(p.lat) + '" inputmode="decimal"></label>' +
    '<label>Map point, west (minus) <input data-f="lon" value="' + v(p.lon) + '" inputmode="decimal"></label>' +
    '<label class="check"><input type="checkbox" data-f="active"' + (p.active === false ? '' : ' checked') + '> On the map</label>' +
    '<div class="lc-acts"><button type="button" class="primary" data-save-place="' + i + '">Save</button></div></article>';
}
function drawPlaces() { $('#plant-places').innerHTML = places.map(placeCard).join(''); }
async function loadPlaces() { places = (await callServer('hub', { op: 'plantLocations' })).plants; drawPlaces(); }
async function savePlace(i) {
  const card = document.querySelector('[data-place="' + i + '"]'), f = (k) => card.querySelector('[data-f="' + k + '"]');
  const was = places[i], addressChanged = f('address').value.trim() !== (was.address || '');
  const input = { op: 'savePlantLocation', id: was.id || '', name: f('name').value, address: f('address').value, active: f('active').checked,
    // A new address is looked up again unless a map point is typed with it.
    lat: addressChanged && String(f('lat').value) === String(was.lat ?? '') ? '' : f('lat').value,
    lon: addressChanged && String(f('lon').value) === String(was.lon ?? '') ? '' : f('lon').value };
  card.querySelector('button').disabled = true;
  try { await callServer('hub', input); $('#error').hidden = true; await loadPlaces(); }
  catch (err) { showError(serverText(err, 'the plant\'s place')); card.querySelector('button').disabled = false; }
}

export async function load() {
  const d = await callServer('admin', { op: 'emailSenders' });
  plants = d.plants.map(p => ({ id: p.id, name: p.plant }));
  if (!plants.some(p => p.id === plant)) plant = (plants[0] || {}).id || 'fac_uniontown';
  setAdmin(true);
  draw();
  await loadPlaces();
}

export function start() {
  $('#practice').hidden = !/sandbox|localhost|127\.0\.0\.1/.test(location.hostname);
  $('#plant').addEventListener('change', () => { plant = $('#plant').value; draw(); });
  $('#add-plant').addEventListener('click', () => { places.push({ name: '', address: '', lat: null, lon: null, active: true }); drawPlaces(); });
  $('#plant-places').addEventListener('click', (ev) => { const b = ev.target.closest('[data-save-place]'); if (b) savePlace(Number(b.dataset.savePlace)); });
  return load().catch(err => showError(serverText(err, 'the plant set-up')));
}
