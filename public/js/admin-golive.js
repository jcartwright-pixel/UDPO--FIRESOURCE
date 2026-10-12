/*
 * Administration > Go-Live Switches (Joe 10/12, mock-up A): the one place to see and change which screens are switched on
 * (Joe 10/12 later: the cards carry no tags at all). One row per screen: On / Off / Fully live, whether it is ready and why,
 * Switch on / Switch off, and Mark fully live.
 * "Turn on everything that is ready" turns the write-back on and moves every ready screen. Every button is pressed twice.
 * The server (functions/src/switch.js) checks the same rules (logic.js GO_LIVE).
 */
import { escapeHtml, callServer, start } from './app.js';
import { say, errText, twice } from './admin-pages.js';
import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const L = window.UDLogic;
const e = escapeHtml;
const rid = () => 'gl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export async function renderGoLive(box) {
  box.innerHTML = '<div class="ap gl">' +
    '<div class="ap-bar"><button type="button" class="ap-btn gl-all" id="gl-all">Turn on everything that is ready</button><span class="gl-sum" id="gl-sum"></span>' +
    '<div class="ap-right"><span class="gl-wb" id="gl-wb"></span><button type="button" class="ap-btn" id="gl-wb-btn"></button></div></div><div class="ap-msg" hidden></div>' +
    '<div class="ap-scroll gl-scroll"><table class="gl-t"><thead><tr><th class="gl-c-name">Screen</th><th class="gl-c-own">Switched on?</th><th class="gl-c-ready">Ready?</th><th>Why</th><th class="gl-c-acts">Change (press twice)</th></tr></thead><tbody id="gl-rows"></tbody></table></div>' +
    '<p class="ap-note">Every button here is pressed twice. A screen that is not switched on is view only and says so on the screen. Switch off still works from here in an emergency.</p></div>';
  const $ = (s) => box.querySelector(s);
  let config = null;

  function render() {
    if (!config) return;
    const owners = L.screenOwners(config), wb = !!(config.writeBack && config.writeBack.enabled === true);
    const keys = Object.keys(L.GO_LIVE);
    const ready = keys.filter(k => L.GO_LIVE[k].ready), readyOn = ready.filter(k => owners[k] === 'new');
    $('#gl-sum').innerHTML = '<b>' + ready.length + ' of ' + (keys.length + L.GO_LIVE_LATER.length) + '</b> ready' + (ready.length && readyOn.length === ready.length ? ', ' + (ready.length === 2 ? 'both' : 'all') + ' on' : ', ' + readyOn.length + ' on');
    $('#gl-all').disabled = wb && readyOn.length === ready.length;
    $('#gl-wb').textContent = 'Write-back to the Live sheet: ' + (wb ? 'On' : 'Off');
    $('#gl-wb').classList.toggle('off', !wb);
    $('#gl-wb-btn').textContent = wb ? 'Turn write-back off' : 'Turn write-back on';
    $('#gl-wb-btn').dataset.armed = '';
    $('#gl-wb-btn').disabled = false;
    let area = '';
    const rows = keys.map(k => Object.assign({ key: k, name: L.SCREENS[k] }, L.GO_LIVE[k])).concat(L.GO_LIVE_LATER.map(x => Object.assign({ key: '', ready: false }, x)));
    $('#gl-rows').innerHTML = rows.map(r => {
      const own = r.key && owners[r.key] === 'new' ? (L.fullyLive(config, r.key) ? 'live' : 'new') : 'old';
      const chip = own === 'live' ? '<span class="gl-chip live">Fully live</span>' : own === 'new' ? '<span class="gl-chip new">On</span>' : '<span class="gl-chip old">Off</span>';
      const b = (act, label, main, off) => '<button type="button" class="ap-btn small' + (main ? ' main' : '') + '" data-act="' + act + '" data-key="' + r.key + '"' + (off ? ' disabled' : '') + '>' + label + '</button>';
      const acts = !r.ready ? b('new', 'Switch on', false, true) + b('live', 'Mark fully live', false, true)
        : own === 'live' ? b('old', 'Switch off') + b('unlive', 'Undo fully live')
        : own === 'new' ? b('old', 'Switch off') + b('live', 'Mark fully live', true)
        : b('new', 'Switch on', true) + b('live', 'Mark fully live', false, true);
      const head = r.area !== area ? '<tr class="gl-grp"><td colspan="5">' + e(area = r.area) + '</td></tr>' : '';
      return head + '<tr data-row="' + e(r.key || r.name) + '"><td class="gl-name">' + e(r.name) + '</td><td>' + chip + '</td><td>' + (r.ready ? '<span class="gl-chip ready">Ready</span>' : '<span class="gl-chip not">Not ready</span>') +
        '</td><td class="gl-why">' + e(r.why) + '</td><td><div class="gl-acts">' + acts + '</div></td></tr>';
    }).join('');
  }

  async function send(btn, fields, armed) {
    await twice(btn, armed, async () => {
      btn.textContent = 'Working...';
      box.querySelectorAll('button').forEach(x => { x.disabled = true; });
      try { say(box, ''); await callServer('setSwitch', Object.assign({ requestId: rid() }, fields)); say(box, 'Done.', 'good'); } catch (err) { say(box, errText(err), 'bad'); }
      render();
    });
  }

  box.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn || btn.disabled || !config) return;
    const wb = !!(config.writeBack && config.writeBack.enabled === true);
    if (btn.id === 'gl-all') return send(btn, { allReady: true }, 'Press again to turn them on');
    if (btn.id === 'gl-wb-btn') return send(btn, { writeBack: !wb }, 'Press again');
    const key = btn.dataset.key, act = btn.dataset.act;
    if (!key) return;
    if (act === 'new') return send(btn, { screen: key, owner: 'new' }, 'Press again');
    if (act === 'old') return send(btn, { screen: key, owner: 'old' }, 'Press again');
    if (act === 'live') return send(btn, { screen: key, fullyLive: true }, 'Press again');
    if (act === 'unlive') return send(btn, { screen: key, fullyLive: false }, 'Press again');
  });

  const { db } = await start();
  const stop = onSnapshot(doc(db, 'config', 'app'), (snap) => {
    if (!box.isConnected) { stop(); return; }
    config = snap.data() || {};
    if (!box.querySelector('[data-armed="1"]')) render();
  }, (err) => say(box, 'Could not read the switch: ' + errText(err), 'bad'));
}
