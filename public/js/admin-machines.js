/*
 * Administration > Machine Connections (Joe 10/26: "I can't have for every machine this kind of setup ... it'll go by location,
 * and then it'll go by machine, and then we can enter the specifics in each machine from there"; he picked mock-up 1 and the
 * name). One item for everything hooked up to a machine: the plant buttons across the top (only the plants the person may
 * see, each plant's own machines), the machines down the left grouped by area with how each is doing, and the picked
 * machine on the right:
 *   - a production line: how it is counted, its machine controller or label reader, and its RedZone line (Line Targets'
 *     own boxes, linetargets.html?hookups=1, so both save the same way);
 *   - the Palletizer and Case Returns counter boxes (admin-counters.js, one counter at a time);
 *   - the coolers' thermometers (mocreo.html?part=thermometers).
 * Joe 10/26 (the plants are completely separate): each plant's machines, counter boxes and thermometers are read from that
 * plant's own database, and every call names the plant.
 * Read only on every machine: nothing is ever changed on a counter box, a controller or RedZone.
 */
import { escapeHtml, callServer, start } from './app.js';
import { doc, onSnapshot, collection } from './firebase.js';
import { watchProduction } from './production.js';
import { renderCaseCounters } from './admin-counters.js';

const e = escapeHtml;
const L = () => window.UDLogic;
const R = () => window.UDProduction;
const HOME_PLANT = 'fac_uniontown';
const AREAS = [['FILLER', 'Fillers'], ['HTST', 'HTST'], ['PACK', 'Boxing & Totes'], ['BLOWMOLD', 'Blow Mold'], ['OTHER', 'Other machines'], ['SHIP', 'Shipping & Returns'], ['COOL', 'Coolers & Freezers']];
const HOW = { SENSOR: 'Sensor', READER: 'Label reader', CONTROLLER: 'Machine controller' };
const CHIP = { ok: ['good', 'Working'], bad: ['bad', 'No answer'], typed: ['blue', 'Typed on tablet'], none: ['', 'Not set up'] };
const chip = (s) => '<span class="ap-chip ' + CHIP[s][0] + '">' + CHIP[s][1] + '</span>';

export async function renderMachineConnections(box, ctx) {
  const params = new URLSearchParams(location.search), testEmail = params.get('testEmail');
  const withTest = (href) => testEmail ? href + '&testEmail=' + encodeURIComponent(testEmail) : href;
  const person = ctx.person || {}, { dbOf } = await start();
  const allowed = L().plantsFor(person), plants = L().PLANTS.filter(p => allowed.indexOf(p.id) >= 0);
  let came = params.get('plant') || '';
  if (!came) { try { came = sessionStorage.getItem('udPlant') || ''; } catch (err) { /* no storage */ } }
  let plant = (plants.find(p => p.id === came) || plants[0] || { id: HOME_PLANT }).id, chosen = params.get('machine') || '', find = '', shown = '';
  let prod = null, rz = null, counters = null, sensors = [], stops = [], timer = null;

  box.innerHTML = '<div class="ap mx"><div class="mx-top"><span class="mx-lbl">Plant</span><div class="mx-plants" id="mx-plants"></div>' +
    '<input type="search" id="mx-find" placeholder="Find a machine" aria-label="Find a machine"></div>' +
    '<div class="mx-split"><nav class="mx-list" id="mx-list" aria-label="Machines"></nav><section class="mx-det" id="mx-det"></section></div></div>';
  const $ = (id) => box.querySelector('#' + id);

  // Every machine at the plant: [key, area, name, what is hooked up, how it is doing].
  function machines() {
    const out = [];
    (prod ? prod.lines : []).forEach(l => {
      const info = prod.lineInfo[l.operationId] || {}, how = prod.counters[l.operationId] || 'TABLET';
      const kind = R().lineKind(l.name), area = AREAS.some(a => a[0] === kind) ? kind : 'OTHER';
      const onRz = !!(rz && (rz.locations || []).length && R().rzLocationFor(l.name, info, rz));
      const what = [HOW[how] || 'Line tablet'].concat(onRz ? ['RedZone'] : []).join(', ');
      out.push(['line:' + l.operationId, area, l.name, what, how === 'TABLET' ? 'typed' : 'ok']);
    });
    // Until the lines are read, nothing shows (so a plant's list does not jump).
    if (!prod) return out;
    (counters || []).forEach(c => {
      const set = !!(c.controller && c.controller.ip), fresh = c.heardAt && Date.now() - Date.parse(c.heardAt) < 10 * 60000 && !c.error;
      out.push(['counter:' + c.id, 'SHIP', c.name, set ? 'Case counter box' : 'Nothing hooked up', !set ? 'none' : fresh ? 'ok' : 'bad']);
    });
    const n = sensors.length;
    out.push(['temps', 'COOL', 'Thermometers', n ? n + ' MOCREO sensor' + (n === 1 ? '' : 's') : 'No MOCREO sensors yet', n ? (sensors.some(s => s.online !== false) ? 'ok' : 'bad') : 'none']);
    return out;
  }

  function drawPlants() {
    $('mx-plants').innerHTML = plants.map(p => '<button type="button" class="ap-btn' + (p.id === plant ? ' main' : '') + '" data-plant="' + e(p.id) + '"' + (p.id === plant ? ' aria-pressed="true"' : '') + '>' + e(p.name) + '</button>').join('');
  }
  function drawList() {
    const all = machines(), q = find.trim().toLowerCase();
    if (!chosen || !all.some(m => m[0] === chosen)) chosen = all.length ? all[0][0] : '';
    const list = all.filter(m => !q || (m[2] + ' ' + m[3]).toLowerCase().indexOf(q) >= 0);
    const name = (plants.find(p => p.id === plant) || { name: '' }).name;
    $('mx-list').innerHTML = AREAS.map(([k, label]) => {
      const ms = list.filter(m => m[1] === k);
      return ms.length ? '<h4>' + e(label) + '</h4>' + ms.map(m => '<button type="button" class="mx-m' + (m[0] === chosen ? ' on' : '') + '" data-m="' + e(m[0]) + '"' + (m[0] === chosen ? ' aria-current="true"' : '') + '>' +
        '<b>' + e(m[2]) + '</b>' + chip(m[4]) + '<span>' + e(m[3]) + '</span></button>').join('') : '';
    }).join('') || '<p class="ap-note mx-none">' + (q ? 'No machine matches. Try another word.' : !prod ? 'Reading the machines…' : 'No machines are set up for ' + e(name) + ' yet. A plant\'s machines are its production lines in Plant Operations.') + '</p>';
  }
  function drawDetail() {
    const det = $('mx-det');
    if (shown === plant + '|' + chosen) return;
    shown = plant + '|' + chosen;
    const m = machines().find(x => x[0] === chosen);
    if (!m) { det.innerHTML = ''; return; }
    const head = '<header class="mx-head"><h3>' + e(m[2]) + '</h3><p class="ap-note">' + e((plants.find(p => p.id === plant) || { name: '' }).name) + ' &middot; Everything hooked up to this machine, in one place. Each box saves as you leave it.</p></header>';
    if (m[0].indexOf('line:') === 0) {
      det.innerHTML = head + '<iframe class="mx-frame" title="' + e(m[2]) + ' hookups" src="' + e(withTest('linetargets.html?hookups=1&plant=' + encodeURIComponent(plant) + '&line=' + encodeURIComponent(m[0].slice(5)))) + '"></iframe>';
    } else if (m[0] === 'temps') {
      det.innerHTML = head + '<iframe class="mx-frame" title="Thermometers" src="' + e(withTest('mocreo.html?part=thermometers&plant=' + encodeURIComponent(plant))) + '"></iframe>';
    } else {
      det.innerHTML = head + '<div class="mx-cc" id="mx-cc"></div>';
      renderCaseCounters($('mx-cc'), ctx, m[0].slice(8), plant);
    }
  }
  function draw() {
    if (!box.isConnected) { stops.forEach(f => f()); clearTimeout(timer); return; }
    drawList();
    drawDetail();
    const u = new URLSearchParams(location.search);
    u.set('plant', plant);
    if (chosen) u.set('machine', chosen);
    history.replaceState(null, '', '?' + u.toString());
  }

  async function readCounters() {
    clearTimeout(timer);
    if (!box.isConnected) return;
    const at = plant;
    try { const r = (await callServer('lineReader', { op: 'counters', udPlant: at })).counters || []; if (at === plant) counters = r; } catch (err) { counters = counters || []; }
    draw();
    timer = setTimeout(readCounters, 15000);
  }
  function follow() {
    stops.forEach(f => f());
    prod = null; rz = null; counters = null; sensors = [];
    const db = dbOf(plant);
    stops = [
      watchProduction(db, plant, d => { prod = d; draw(); }, () => { prod = { lines: [], counters: {}, lineInfo: {} }; draw(); }),
      onSnapshot(doc(db, 'redzoneData', plant), s => { rz = s.exists() ? s.data() : null; draw(); }, () => {}),
      onSnapshot(collection(db, 'sensors'), s => { sensors = s.docs.map(d => d.data()).filter(x => !x.removed); draw(); }, () => {})
    ];
    drawPlants();
    draw();
    readCounters();
  }

  $('mx-plants').addEventListener('click', ev => {
    const b = ev.target.closest('[data-plant]');
    if (!b || b.dataset.plant === plant) return;
    plant = b.dataset.plant; chosen = ''; shown = '';
    try { sessionStorage.setItem('udPlant', plant); } catch (err) { /* no storage */ }
    follow();
  });
  $('mx-list').addEventListener('click', ev => {
    const b = ev.target.closest('[data-m]');
    if (!b || b.dataset.m === chosen) return;
    chosen = b.dataset.m;
    draw();
  });
  $('mx-find').addEventListener('input', ev => { find = ev.target.value; drawList(); });
  follow();
}
