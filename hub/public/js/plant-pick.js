/*
 * The plant pop-up (Joe 11-10-26: "when I click on plant, it should be able to direct me to like a pop-up to ask me which one,
 * but right beside it, maybe a recap of all the plants"). The Plant Operations and Route Distribution cards ask which plant
 * when a person works in more than one, with each plant's day beside it, and open the app on that plant (?plant=, which
 * Operations already takes, Uniontown's too, so a new tab never guesses). Someone with one plant goes straight in.
 * The recap comes from the hub call (op plants, functions/src/plants.js), read when the pop-up opens.
 */
import { callServer, escapeHtml as e, serverText } from './shell.js';

// The cards that ask. The other apps join once they take the plant from their address too.
export const PICKS_PLANT = ['plant', 'distribution'];

let plants = [], card = null;
// The app's address on one plant.
export const onPlant = (url, plant) => url + (url.indexOf('?') >= 0 ? '&' : '?') + 'plant=' + encodeURIComponent(plant);
const $ = (id) => document.getElementById(id);

// Each plant's line of numbers, in plain words.
export function recapText(p) {
  if (p.unread) return p.live ? 'Its numbers could not be read just now' : 'Not running in the app yet';
  const l = p.loads || { total: 0, done: 0, loading: 0, waiting: 0 };
  if (!l.total && !p.live) return 'Not running in the app yet';
  const parts = [l.total ? l.done + ' of ' + l.total + ' loads out' : 'No loads today'];
  if (l.loading) parts.push(l.loading + ' loading now');
  if (l.waiting) parts.push(l.waiting + ' waiting');
  if (p.units) parts.push(p.units + (p.units === 1 ? ' truck or trailer' : ' trucks or trailers') + ' with a problem');
  return parts.join(' · ');
}

function show(on) {
  $('plant-box').hidden = !on; $('plant-back').hidden = !on;
  if (on) $('plant-close').focus({ preventScroll: true });
}

function draw(recap) {
  const by = {};
  ((recap && recap.plants) || []).forEach(p => { by[p.id] = p; });
  $('plant-list').innerHTML = plants.map(p => {
    const r = by[p.id];
    const line = r ? recapText(r) : 'Getting today\'s numbers…';
    return '<div class="plant-row">' +
      '<div class="plant-row-text"><b>' + e(p.name) + '</b><span class="plant-recap">' + e(line) + '</span></div>' +
      '<a class="plant-open" href="' + e(onPlant(card.url, p.id)) + '" target="_blank" rel="noopener" data-plant="' + e(p.id) + '">Open ' + e(p.name) + '</a></div>';
  }).join('');
}

async function open(tile) {
  card = tile;
  $('plant-title').innerHTML = 'Which plant? <small>' + e(tile.name) + '</small>';
  $('plant-error').hidden = true;
  draw(null);
  show(true);
  try { draw(await callServer('hub', { op: 'plants' })); } catch (err) {
    draw({ plants: [] });
    $('plant-list').querySelectorAll('.plant-recap').forEach(s => { s.textContent = ''; });
    $('plant-error').textContent = 'Today\'s numbers could not be read (' + serverText(err, 'the hub') + '). You can still open a plant.';
    $('plant-error').hidden = false;
  }
}

/** Call once Home's cards are drawn: tiles from the hub call, mine = this person's plants ({id, name}). */
export function plantPicker(tiles, mine) {
  plants = mine || [];
  const asks = plants.length > 1;
  tiles.filter(t => PICKS_PLANT.indexOf(t.key) >= 0).forEach(t => {
    const a = document.querySelector('#tiles a[data-app="' + t.key + '"]');
    if (!a) return;
    // One plant: the card opens that plant straight away.
    if (!asks) { if (plants[0]) a.href = onPlant(t.url, plants[0].id); return; }
    a.querySelector('.app-open').innerHTML = 'Pick a plant <span aria-hidden="true">&rarr;</span>';
    a.addEventListener('click', (ev) => { if (ev.ctrlKey || ev.metaKey || ev.shiftKey) return; ev.preventDefault(); open(t); });
  });
  $('plant-close').onclick = () => show(false);
  $('plant-back').onclick = () => show(false);
  // The pop-up closes once a plant is opened in its own tab, so Home is ready for the next one.
  $('plant-list').addEventListener('click', (ev) => { if (ev.target.closest('a.plant-open')) setTimeout(() => show(false), 0); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') show(false); });
}
