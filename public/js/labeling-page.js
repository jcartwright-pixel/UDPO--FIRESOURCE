import { start, requireSignIn, save, escapeHtml, showError, goLiveNote, maySave, watchPerson } from './app.js';
import { doc, onSnapshot } from './firebase.js';
import { plantFor } from './pmaint.js';
import { watchProduction, lineView, fmt, clock } from './production.js';

// Labeling Room (Joe 10/31, mock-up 3, "United Dairy End Zone" in place of RedZone). The half gallon, quart and pint bottles come
// out of their bags in Debag, get their labels here and ride the belt to a filler. One panel for each filler (Line Targets says which
// fillers and the belt): the label going on now (a drop-down), its code date, how many labels are still to put on (what the filler
// has left to run less the bottles already on the belt), the bottles on the belt, what is next at the filler (a drop-down), when to
// switch labels, and "I switched to ... labels", which starts the filler tablet's countdown to the first new bottle. A filler's
// Hold labels (its tablet) turns its panel red. What the filler runs and how many are left come from its line tablet.
const L = window.UDLogic, R = window.UDProduction;
const params = new URLSearchParams(location.search);
let plant = params.get('plant') || '', person = null, app = {}, db = null, data = null, stop = null;
let busy = Promise.resolve();
const canSave = () => maySave(person, L.SAVE_ROLES.concat(['PLANT_EMPLOYEE']), app, 'plant');
const setUrl = () => history.replaceState(null, '', '?plant=' + encodeURIComponent(plant));
const mmss = (sec) => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');

function drawTop() {
  const pl = plantFor(person, plant);
  if (plant !== pl.id) { plant = pl.id; setUrl(); }
  document.getElementById('plant-name').textContent = pl.name;
  const st = L.screenState(app, 'plant');
  goLiveNote(st.live && st.owner !== 'new');
  document.getElementById('mode-text').textContent = st.live ? (st.open ? 'LIVE' : 'VIEW ONLY') : 'TEST COPY';
}

// The code date a product carries today: the shift's day plus the product's shelf life (Products list).
function codeOf(line, product) {
  const t = R.targetsFor(data.products[line.operationId] || []).find(x => R.sameItem(x.name, product));
  return t && data.shift ? R.codeDate(data.shift.date, t.shelfLifeDays) : '';
}
const codeLine = (code) => '<div class="lr-code"><small>Code date</small>' + (code ? '<b>' + escapeHtml(code) + '</b>' : '<em>Set the shelf life on Products</em>') + '</div>';
function pick(line, what, chosen, blank) {
  const names = R.targetsFor(data.products[line.operationId] || []).map(t => t.name);
  if (chosen && !names.some(n => R.sameItem(n, chosen))) names.unshift(chosen);
  return '<select class="lr-dd" data-pick="' + what + '" data-line="' + escapeHtml(line.operationId) + '" aria-label="' + (what === 'labeling' ? 'Labeling now on ' : 'Up next on ') + escapeHtml(line.name) + '"' + (canSave() ? '' : ' disabled') + '>' +
    (blank || !chosen ? '<option value=""></option>' : '') + names.map(n => '<option' + (R.sameItem(n, chosen) ? ' selected' : '') + '>' + escapeHtml(n) + '</option>').join('') + '</select>';
}

function lane(line, t) {
  const v = lineView(data, line, t), info = (data.lineInfo || {})[line.operationId] || {}, x = R.labelView(v, info, t), dis = canSave() ? '' : ' disabled';
  const nx = x.next, red = x.hold, nowMsg = x.switchNow && !x.switched;
  const head = '<h2><span>' + escapeHtml(line.name) + '</span>' + (red ? '<span class="lr-flag r">HOLD</span>' : x.down ? '<span class="lr-flag r">DOWN</span>' : '') + '</h2>';
  const hold = red ? '<div class="lr-sec lr-hold"><div class="lr-say">Filler says: HOLD LABELS</div><div>since ' + escapeHtml(clock(x.hold.at)) + (x.onBelt ? ' · ' + fmt(x.onBelt) + ' bottles waiting on the belt' : '') + '</div></div>' :
    x.down ? '<div class="lr-sec lr-hold"><div class="lr-say">The filler is down</div><div>It has not asked to hold labels.</div></div>' : '';
  const left = x.switched ? '<div class="lr-lbl">Labeling ahead of the filler</div><div class="lr-mid">' + (nx && R.sameItem(nx.product, x.labeling) && nx.qty ? fmt(nx.qty) + ' to label' : 'Switched at ' + escapeHtml(clock(x.labelingAt))) + '</div>' :
    '<div class="lr-lbl">Labels still to put on</div><div class="lr-big' + (x.toLabel === 0 ? ' r' : '') + '">' + (x.toLabel === null ? '—' : fmt(x.toLabel)) + '</div>' +
    (v.runLeft ? '<div class="lr-bar"><i style="width:' + v.runLeft.pct + '%"></i></div>' : '<div class="lr-mut">' + (x.running ? 'The filler has not typed how many to run.' : 'The filler has not picked what it runs.') + '</div>');
  const now = '<div class="lr-sec lr-now"><div class="lr-lbl">Labeling now</div>' + pick(line, 'labeling', x.labeling, false) + codeLine(x.labeling ? codeOf(line, x.labeling) : '') + left + '</div>';
  const belt = '<div class="lr-sec"><div class="lr-lbl">' + (x.switched ? 'Last ' + escapeHtml(x.running) + ' on the belt' : 'On the belt to the filler') + '</div>' +
    '<div class="lr-mid">' + (x.onBelt === null ? '—' : fmt(x.onBelt) + ' bottles') + '</div>' +
    (x.switched && x.arriveAt !== null ? '<div>First ' + escapeHtml(x.labeling) + ' reaches the filler in <b class="lr-count" data-at="' + x.arriveAt + '">' + mmss(x.arriveIn) + '</b></div>' :
      x.beltMin !== null ? '<div>Reach the filler in about <b>' + fmt(x.beltMin) + ' min</b></div>' : '<div class="lr-mut">Set the belt time on Line Targets.</div>') + '</div>';
  const switchTo = nx && !(x.switched && R.sameItem(x.labeling, nx.product));
  const next = '<div class="lr-sec lr-next"><div class="lr-lbl">Up next at this filler</div>' + pick(line, 'next', nx ? nx.product : '', true) +
    (nx ? codeLine(codeOf(line, nx.product)) + '<div>How many: <b>' + (nx.qty ? fmt(nx.qty) : 'not typed') + '</b></div>' : '<div class="lr-mut">Nothing set yet.</div>') +
    (x.switched ? '' : nowMsg ? '<div class="lr-mid r">SWITCH LABELS NOW</div>' : nx && x.toLabel !== null ? '<div class="lr-mid">Switch labels in ' + fmt(x.toLabel) + ' bottles</div>' + (x.switchMin !== null ? '<div>about ' + fmt(x.switchMin) + ' min</div>' : '') : '') +
    (switchTo ? '<button type="button" class="lr-go' + (nowMsg ? ' now' : '') + '" data-switch="' + escapeHtml(line.operationId) + '" data-product="' + escapeHtml(nx.product) + '"' + dis + '>I switched to ' + escapeHtml(nx.product) + ' labels</button>' : '') + '</div>';
  return '<section class="lr-lane' + (red || x.down ? ' red' : nowMsg ? ' due' : '') + '" data-lane="' + escapeHtml(line.operationId) + '">' + head + hold + now + belt + next + '</section>';
}

function render(force) {
  drawTop();
  const box = document.getElementById('lanes');
  if (!data) return;
  // A drop-down being picked is not redrawn under the person's finger.
  if (force !== true && box.contains(document.activeElement) && document.activeElement.matches('select')) return;
  const lines = R.labelLines(data.lines, data.lineInfo), t = Date.now();
  box.innerHTML = lines.map(l => lane(l, t)).join('') ||
    '<p class="lr-wait">' + (data.read.setup ? 'No fillers get their bottles from the Labeling Room. Tick them on Line Targets.' : 'Reading the fillers…') + '</p>';
  box.style.setProperty('--lanes', Math.max(1, Math.min(3, lines.length)));
  document.getElementById('note').textContent = lines.length ? 'What each filler runs, how many it has left and what is next come from its line tablet. Labels still to put on = left to run − bottles on the belt (Line Targets).' : '';
}

function send(action, fields, what) {
  const run = busy.then(() => save(action, fields));
  busy = run.catch(() => {});
  return run.then(done => { showError(''); return done; }, err => { showError(what + ' was not saved (' + (err.message || err) + ').'); render(true); return null; });
}
const lineOf = (id) => (data ? data.lines : []).find(l => l.operationId === id);
const box = document.getElementById('lanes');
box.addEventListener('change', e => {
  const el = e.target, line = lineOf(el.dataset.line);
  if (!el.dataset.pick || !line || !canSave()) return;
  if (el.dataset.pick === 'labeling') {
    if (!el.value) return;
    send('saveLabelRoom', { operationId: line.operationId, op: 'labeling', product: el.value }, line.name).then(() => render(true));
  } else {
    // The filler's Up next (the same as Set Next on its tablet); its amount stays when the product stays.
    const was = lineView(data, line, Date.now()).next, s = data.shift;
    const qty = was && R.sameItem(was.product, el.value) && was.qty ? String(was.qty) : '';
    send('saveLineEntry', { operationId: line.operationId, op: 'next', product: el.value, qty, shift: { key: s.key, name: s.name, date: s.date, start: s.start, end: s.end } }, line.name).then(() => render(true));
  }
  el.blur();
});
box.addEventListener('click', e => {
  const b = e.target.closest('[data-switch]'), line = b && lineOf(b.dataset.switch);
  if (!b || b.disabled || !line || !canSave()) return;
  b.disabled = true;
  send('saveLabelRoom', { operationId: line.operationId, op: 'labeling', product: b.dataset.product }, line.name).then(() => render(true));
});
// The countdowns to the first bottle with the new label, every second.
setInterval(() => document.querySelectorAll('.lr-count[data-at]').forEach(el => { el.textContent = mmss(Math.max(0, Math.ceil((Number(el.dataset.at) - Date.now()) / 1000))); }), 1000);

function follow() {
  if (stop) stop();
  data = null;
  render(true);
  stop = watchProduction(db, plant, d => { data = d; render(); }, e => showError('Could not read the fillers (' + e.message + '). Check the network and reload the page.'));
}
requireSignIn(async (user) => {
  ({ db } = await start());
  watchPerson(db, user, p => { person = p; const was = plant; drawTop(); if (!stop || was !== plant) follow(); else render(true); }, { withEmail: true });
  onSnapshot(doc(db, 'config', 'app'), s => { app = s.data() || {}; render(true); });
});
