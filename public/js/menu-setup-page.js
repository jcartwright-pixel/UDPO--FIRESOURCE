/*
 * Menu Setup (Joe 10/25, mock-up 7: "every place is different, so everybody has to have the ability to move stuff around"):
 * the plant sides' menus of one plant, side by side. ▲ ▼ move a section up or down; Move to puts it on another side. Each
 * change saves on its own (saveMenuSetup) and that plant's menu changes for everyone there on their next screen. A side's own
 * screens stay at its top. Administrators only; the server checks again.
 */
import { start, requireSignIn, save, escapeHtml, showError, watchPerson, MENU, currentPlant, keepMenuSetup } from './app.js';
import { doc, onSnapshot } from './firebase.js';

const L = window.UDLogic;
const PLANTS = L.PLANTS && L.PLANTS.length ? L.PLANTS : [{ id: 'fac_uniontown', name: 'Uniontown' }];
let plant = new URLSearchParams(location.search).get('plant') || currentPlant(), sides = null, admin = false, db = null, dbOf = null, stop = null, busy = Promise.resolve();
if (!PLANTS.some(p => p.id === plant)) plant = PLANTS[0].id;
const itemsOf = (g) => ((MENU.find(([m]) => m === g) || [])[1] || []).map(i => i[0]);

function draw() {
  document.getElementById('plant-name').textContent = (PLANTS.find(p => p.id === plant) || { name: plant }).name;
  document.getElementById('plant').innerHTML = PLANTS.map(p => '<option value="' + p.id + '"' + (p.id === plant ? ' selected' : '') + '>' + escapeHtml(p.name) + '</option>').join('');
  document.getElementById('reset').disabled = !admin;
  const cols = document.getElementById('cols');
  if (!sides) { cols.innerHTML = '<p class="foot">Reading the menu…</p>'; return; }
  cols.innerHTML = L.MENU_SIDES.map(s => {
    const list = sides[s.key];
    return '<section class="ms-card" data-side="' + s.key + '"><h2>' + escapeHtml(s.name) + '</h2>' + list.map((g, i) => {
      const items = itemsOf(g), sub = items.length > 1 || (items[0] && items[0] !== g) ? items.join(', ') : '';
      const fixed = g === s.first;
      return '<div class="ms-item' + (fixed ? ' fixed' : '') + '" data-g="' + escapeHtml(g) + '"><div><b>' + escapeHtml(g) + '</b>' + (sub ? '<small>' + escapeHtml(sub) + '</small>' : '') + (fixed ? '<small>' + escapeHtml(s.name) + '\'s own screens: always at the top</small>' : '') + '</div>' +
        (fixed || !admin ? '' : '<div class="ms-tools"><button type="button" data-move="-1" title="Move up" aria-label="Move ' + escapeHtml(g) + ' up"' + (i === (s.first ? 1 : 0) ? ' disabled' : '') + '>&#9650;</button>' +
          '<button type="button" data-move="1" title="Move down" aria-label="Move ' + escapeHtml(g) + ' down"' + (i === list.length - 1 ? ' disabled' : '') + '>&#9660;</button>' +
          '<select data-to="1" aria-label="Move ' + escapeHtml(g) + ' to another side"><option value="">Move to</option>' +
          L.MENU_SIDES.filter(o => o.key !== s.key).map(o => '<option value="' + o.key + '">' + escapeHtml(o.name) + (sides[o.key].indexOf(g) >= 0 ? ' (already there)' : '') + '</option>').join('') + '</select></div>') + '</div>';
    }).join('') + '</section>';
  }).join('');
  document.getElementById('foot').textContent = admin ? '▲ ▼ move a section up or down; Move to puts it under another side. Each change saves on its own, and the menu changes for everyone at this plant on their next screen. Nothing is taken out: a section moved to a side that already has it just leaves this side.'
    : 'Menu Setup is for Administrators.';
}

function send(next) {
  const was = sides;
  sides = L.menuArrange(next);
  draw();
  const run = busy.then(() => save('saveMenuSetup', next === null ? { facilityId: plant, reset: true } : { facilityId: plant, sides: next }));
  busy = run.catch(() => {});
  run.then(r => { showError(''); sides = r.sides; if (plant === currentPlant()) keepMenuSetup(plant, next === null ? null : r.sides); draw(); },
    err => { sides = was; draw(); showError('The menu was not saved (' + (err.message || err) + '). Try the change again.'); });
}

document.getElementById('cols').addEventListener('click', e => {
  const b = e.target.closest('[data-move]');
  if (!b || !admin) return;
  const key = b.closest('[data-side]').dataset.side, g = b.closest('[data-g]').dataset.g, list = sides[key].slice(), i = list.indexOf(g), j = i + Number(b.dataset.move);
  if (j < 0 || j >= list.length || list[j] === (L.MENU_SIDES.find(s => s.key === key) || {}).first) return;
  [list[i], list[j]] = [list[j], list[i]];
  send(Object.assign({}, sides, { [key]: list }));
});
document.getElementById('cols').addEventListener('change', e => {
  const t = e.target.closest('[data-to]');
  if (!t || !t.value || !admin) return;
  const from = t.closest('[data-side]').dataset.side, g = t.closest('[data-g]').dataset.g, to = t.value, next = Object.assign({}, sides);
  next[from] = sides[from].filter(x => x !== g);
  if (next[to].indexOf(g) < 0) next[to] = sides[to].concat([g]);
  send(next);
});
const reset = document.getElementById('reset');
reset.addEventListener('click', () => {
  if (!admin) return;
  if (reset.dataset.armed !== '1') { reset.dataset.armed = '1'; reset.classList.add('armed'); reset.textContent = 'Press again to start over'; return; }
  reset.dataset.armed = ''; reset.classList.remove('armed'); reset.textContent = 'Start Over From the Standard Menu';
  send(null);
});
document.getElementById('plant').addEventListener('change', e => { plant = e.target.value; const u = new URL(location.href); u.searchParams.set('plant', plant); history.replaceState(null, '', u); follow(); });

function follow() {
  if (stop) stop();
  sides = null;
  draw();
  // Joe 10/26: each plant's menu is in that plant's own database.
  stop = onSnapshot(doc(dbOf(plant), 'menuSetup', plant), d => { sides = L.menuArrange(d.exists() ? d.data().sides : null); draw(); },
    err => showError('Could not read the menu (' + err.message + '). Check the network and reload the page.'));
}
requireSignIn(async (user) => {
  ({ db, dbOf } = await start());
  watchPerson(db, user, p => { admin = L.isAdmin(p); draw(); });
  follow();
});
