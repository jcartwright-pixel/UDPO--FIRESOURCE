/*
 * Administration > Case Counters (Joe 10/22, the case counter hookup guide): where each counter box is on the plant network
 * and where it keeps its running case total, the counter's key for the plant PC, and a Test read. The plant PC reads the box
 * READ-ONLY (tools/device-bridge --controller) and the server puts the cases on the load being loaded (Palletizer) or the
 * trailer being unloaded (Case Returns), beside the Cases Out or Cases In typed (src/casecounter.js). Each box saves as it is
 * left. Administrators only, through the lineReader call (src/reader.js).
 */
import { escapeHtml, callServer, dateTimeText } from './app.js';
import { say, errText } from './admin-pages.js';

const e = escapeHtml;
const P = () => window.UDProduction;
const call = (fields) => callServer('lineReader', fields);
const readsAddress = () => 'https://us-east4-' + (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'demo-ud-distribution' : location.hostname.split('.')[0]) + '.cloudfunctions.net/deviceReads';
const fmt = (n) => Number(n).toLocaleString('en-US');

// Joe 10/26 (Machine Connections, mock-up 1): each counter also opens on its own, as that machine's page there (only = its id).
export async function renderCaseCounters(box, ctx, only) {
  let data = null, shownKey = null, timer = null;
  box.innerHTML = '<div class="ap"><div class="ap-msg" hidden></div><div class="ap-scroll" id="cc-list" style="padding:10px;display:flex;flex-direction:column;gap:12px"></div></div>';
  const list = box.querySelector('#cc-list');
  const val = (c, k) => (c[k] === null || c[k] === undefined ? '' : String(c[k]));
  const opt = (v, cur, label) => '<option value="' + e(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + e(label) + '</option>';

  function testText(c) {
    const ask = c.testAsk, res = c.testResult;
    if (res && (!ask || res.askAt === ask.at)) return res.error ? '<span class="ap-chip bad">' + e(res.error) + '</span>' : '<span class="ap-chip good">The case total read <b>' + e(fmt(res.value)) + '</b> · ' + e(dateTimeText(res.at)) + '</span>';
    if (ask) return Date.now() - Date.parse(ask.at) < 30000 ? '<span class="ap-chip blue">Asking the plant PC…</span>' : '<span class="ap-chip bad">No answer from the plant PC. Check that the program is running on it.</span>';
    return '';
  }
  function section(k) {
    const x = data.counters.find(c => c.id === k), c = x.controller || {}, brand = c.brand || '', modbus = brand === 'MODBUS', port = (P().CONTROLLER_PORTS || {})[brand];
    const inp = (f, label) => '<label class="ap-field">' + e(label) + '<input data-cc="' + k + '" data-f="' + f + '" value="' + e(val(c, f)) + '"' + (f === 'countTag' && !brand ? ' disabled' : '') + '></label>';
    const sel = (f, label, opts) => '<label class="ap-field">' + e(label) + '<select data-cc="' + k + '" data-f="' + f + '"><option value=""></option>' + opts.map(o => opt(o[0], val(c, f), o[1])).join('') + '</select></label>';
    const heard = x.heardAt ? 'The plant PC last sent ' + dateTimeText(x.heardAt) + (x.last ? '; the case total read ' + fmt(x.last.value) : '') + '.' : 'The plant PC has not sent anything yet.';
    const noLoad = x.noLoad && x.noLoad.date === data.today && x.noLoad.cases ? ' ' + fmt(x.noLoad.cases) + ' case' + (x.noLoad.cases === 1 ? '' : 's') + ' counted today with nothing ' + (x.kind === 'LOAD' ? 'loading' : 'unloading') + '.' : '';
    const key = shownKey && shownKey.counter === k ? '<p class="ap-note">Counter key (copy it now, it is not shown again): <b class="cc-mono" id="cc-key-' + k + '">' + e(shownKey.key) + '</b></p>' +
      '<p class="ap-note">On the plant PC: <b class="cc-mono">node bridge.cjs --address ' + e(readsAddress()) + ' --device ' + e(k) + ' --key ' + e(shownKey.key) + ' --controller</b></p>' : '';
    return '<div class="ap-section" data-counter="' + k + '"><h3>' + e(x.name) + '</h3><p class="ap-note">' + e(x.where) + ' It only reads the counter box: the app never changes anything on it.</p>' +
      '<div class="cc-grid">' + sel('brand', 'Brand', P().CONTROLLER_BRANDS) + inp('ip', 'IP address') + inp('port', 'Port' + (port ? ' (empty = ' + port + ')' : '')) +
        (modbus ? inp('unit', 'Unit id (empty = 1)') + sel('wordOrder', 'Word order (empty = high first)', [['HIGH_FIRST', 'High word first'], ['LOW_FIRST', 'Low word first']]) : '') +
        inp('countTag', 'Where the case total is') + (modbus ? sel('countSize', 'Size (empty = 32 bits)', [['16', '16 bits'], ['32', '32 bits']]) : '') + '</div>' +
      '<p class="ap-note">' + (brand ? 'Where the case total is: ' + e((P().TAG_HELP || {})[brand] || '') + '. ' : 'Pick the brand first (the CLICK PLC in the guide is Modbus TCP). ') + 'The counter box keeps one running total of the cases it has counted; the app works out the new cases from it.</p>' +
      '<div class="cc-row"><button type="button" class="ap-btn" data-test="' + k + '"' + (c.ip && c.countTag ? '' : ' disabled') + '>Test read</button>' + testText(c) + '</div>' +
      '<p class="ap-note' + (x.error ? ' cc-bad' : '') + '">' + e(heard) + (x.error ? ' Last read problem: ' + e(x.error) : '') + e(noLoad) + '</p>' +
      '<p class="ap-note">The plant PC sends to <b class="cc-mono">' + e(readsAddress()) + '</b> with this counter\'s key. ' + (x.keyAt ? 'Key made ' + e(dateTimeText(x.keyAt)) + '.' : 'No key yet.') + '</p>' + key +
      '<div class="cc-row"><button type="button" class="ap-btn" data-key="' + k + '">' + (x.keyAt ? 'Replace Counter Key' : 'Make Counter Key') + '</button></div></div>';
  }
  function render() {
    if (!data || !box.isConnected) return;
    if (list.contains(document.activeElement) && document.activeElement.matches('input, select')) return;
    list.innerHTML = data.counters.filter(c => !only || c.id === only).map(c => section(c.id)).join('');
  }
  async function load() {
    try { data = await call({ op: 'counters' }); render(); } catch (err) { say(box, errText(err), 'bad'); }
    clearTimeout(timer);
    if (box.isConnected) timer = setTimeout(load, 5000);
  }
  async function op(fields) {
    try {
      const r = await call(fields);
      if (r.key) shownKey = { counter: fields.counter, key: r.key };
      say(box, r.message || '', r.message ? 'good' : '');
      document.activeElement && list.contains(document.activeElement) && document.activeElement.blur();
      await load();
    } catch (err) { say(box, errText(err), 'bad'); document.activeElement && document.activeElement.blur(); await load(); }
  }
  list.addEventListener('change', ev => {
    const f = ev.target.closest('[data-f]');
    if (f) op({ counter: f.dataset.cc, op: 'saveCounter', field: f.dataset.f, value: f.value.trim() });
  });
  list.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.test) op({ counter: b.dataset.test, op: 'testRead' });
    if (b.dataset.key) op({ counter: b.dataset.key, op: 'makeKey' });
  });
  await load();
}
