/*
 * Administration's email, schedule and diagnostics pages (Joe 10/10: "complete this"), the second half of js/admin-pages.js:
 * Repair Email, Driver Check-In Email, Refresh Rates, Window Test Center, Run Runtime Pre-Flight, Update Live Sheets, Refresh
 * Home Summary Now, Start Plant Fresh From Today, Date Inventory and Date Column Dry Run / Convert. Each opens inside the
 * panel with its buttons on one line at the top, and goes through the server's `admin` call (functions/src/admintools.js).
 */
import { escapeHtml, callServer } from './app.js';
import { when, say, errText, twice, busy } from './admin-pages.js';

const e = escapeHtml;
const call = (op, fields) => callServer('admin', Object.assign({ op }, fields || {}));
const hourText = (h) => ((h % 12) || 12) + ':00 ' + (h < 12 ? 'AM' : 'PM');
const minutesText = (m) => (m < 60 ? m + ' minute' + (m === 1 ? '' : 's') : (m / 60) + ' hour' + (m === 60 ? '' : 's'));
const bar = (left, right) => '<div class="ap-bar">' + left + (right ? '<div class="ap-right">' + right + '</div>' : '') + '</div><div class="ap-msg" hidden></div>';
const chip = (status) => { const c = { PASS: 'good', SUCCESS: 'good', FAIL: 'bad', WARN: 'warn', NEEDS_REVIEW: 'warn', OFF: '' }[status] || ''; return '<span class="ap-chip ' + c + '">' + e(status === 'WARN' ? 'LOOK' : status) + '</span>'; };
// A press-twice button that disarms itself after `ms` (Update Live Sheets: 8 seconds, as the current app).
function twiceTimed(btn, label, ms, run) {
  const out = twice(btn, label, run);
  if (btn.dataset.armed === '1') { clearTimeout(btn._t); btn._t = setTimeout(() => { if (btn.dataset.armed === '1') { btn.dataset.armed = ''; btn.classList.remove('armed'); btn.textContent = btn.dataset.label; } }, ms); }
  return out;
}

/* ---------- Repair Email ---------- */

const MODE_TEXT = { SEND: 'Only when I press Send', IMMEDIATE: 'Immediately (new repairs)', DAILY: 'Once a day (one digest)', NONE: 'Never email' };
const LEASE_HELP = { IDEALEASE: 'Fleet List Lease says "Idealease"', PENSKE: 'Fleet List Lease says "PENSKE"', OWNED: 'Fleet List Lease is blank or "OWN"' };
export async function renderRepairEmail(box, ctx) {
  let data = null;
  box.innerHTML = '<div class="ap">' + bar('<button type="button" class="ap-btn" id="re-send">Send now</button><button type="button" class="ap-btn" id="re-reload">Refresh</button>', '<span id="re-sending"></span>') +
    '<div class="ap-split"><section class="ap-card"><h3>Where Repair Emails Go</h3><p class="ap-note">The Lease column on the Fleet List decides who a truck or trailer belongs to. Each lessor gets its own address.</p><div id="re-where"></div>' +
    '<p class="ap-note">Owned trucks and trailers are never emailed: the Garage button makes a work order for our garage.</p>' +
    '<p class="ap-note">Any other Lease value, or a unit that is not on the Fleet List, is held and flagged. It is never sent to a guessed address.</p><div class="ap-tiles" id="re-open" style="grid-template-columns:repeat(4,1fr)"></div></section>' +
    '<section class="ap-card"><h3>How Often Repair Emails Are Sent</h3><p class="ap-note">Choose the rhythm for each lessor. Nothing is emailed while sending is turned off.</p><div id="re-how"></div>' +
    '<p class="ap-note">Immediately and Once a day only send repairs reported after you switch them on, so old repairs are never swept up. "Only when I press Send" is the Lessor button on each truck write-up (Equipment Issues).</p><div id="re-status" class="ap-list"></div></section></div></div>';
  const $ = (s) => box.querySelector(s);
  // Batch 5 (10/23): no Save button; each box saves when it is left, each drop-down when it is picked.
  function render() {
    const s = data.settings;
    $('#re-where').innerHTML = Object.keys(data.labels).map(k => '<label class="ap-field">' + e(data.labels[k]) + '<small>' + e(LEASE_HELP[k]) + '</small><input data-emails="' + k + '" value="' + e(s.routes[k].emails.join('; ')) + '" placeholder="name@company.com; second@company.com"></label>').join('');
    $('#re-how').innerHTML = '<div class="ap-grid2">' + Object.keys(data.labels).map(k => '<label class="ap-field">' + e(data.labels[k]) + '<select data-mode="' + k + '">' + data.modes.map(m => '<option value="' + m + '"' + (m === s.routes[k].mode ? ' selected' : '') + '>' + e(MODE_TEXT[m]) + '</option>').join('') + '</select></label>').join('') +
      '<label class="ap-field">Daily digest time<small>Used by "Once a day"</small><select id="re-hour">' + Array.from({ length: 24 }, (x, h) => '<option value="' + h + '"' + (h === s.digestHour ? ' selected' : '') + '>' + hourText(h) + '</option>').join('') + '</select></label></div>';
    status();
  }
  // The status lines only, so a save never redraws the boxes being typed in.
  function status() {
    const s = data.settings;
    $('#re-sending').innerHTML = data.sending.sending ? '<span class="ap-chip good">Sending is ON</span>' : '<button type="button" class="ap-btn small" data-goto="sent-log">Sending is OFF: turn it on</button>';
    const auto = Object.keys(s.routes).some(k => s.routes[k].mode === 'IMMEDIATE' || s.routes[k].mode === 'DAILY');
    $('#re-status').innerHTML = [s.updatedAt ? 'Last saved ' + when(s.updatedAt) + ' by ' + s.updatedBy + '.' : 'Not saved yet: these are the standard settings.',
      auto ? 'Automatic sending checks about every ' + data.every + ' minutes (change it in Refresh Rates).' : 'Nothing is sent automatically: no lessor is set to Immediately or Once a day.']
      .concat(Object.keys(data.lastDigest).map(k => data.labels[k] + ' digest last sent ' + data.lastDigest[k] + '.')).map(t => '<div class="ap-help">' + e(t) + '</div>').join('');
    const o = data.openByLessor;
    $('#re-open').innerHTML = [['Idealease', o.IDEALEASE], ['Penske', o.PENSKE], ['ours (Garage)', o.OWNED], ['Held', o.HELD]].map(([k, n]) => '<div><b>' + n + '</b><span>open ' + k + '</span></div>').join('');
  }
  let saving = Promise.resolve();
  async function load() { await saving; try { data = await call('repairEmail'); if (box.isConnected) render(); } catch (err) { say(box, errText(err), 'bad'); } }
  // A change that is refused (an address that is not one, Immediately with no address) shows why in red and stays in the box.
  box.addEventListener('change', ev => {
    if (!data || !ev.target.closest('[data-emails], [data-mode], #re-hour')) return;
    const routes = {};
    Object.keys(data.labels).forEach(k => { routes[k] = { emails: box.querySelector('[data-emails="' + k + '"]').value, mode: box.querySelector('[data-mode="' + k + '"]').value }; });
    const digestHour = Number($('#re-hour').value);
    saving = saving.then(async () => {
      try { data = await call('saveRepairEmail', { routes, digestHour }); say(box, ''); if (box.isConnected) status(); } catch (err) { say(box, errText(err), 'bad'); }
    });
  });
  box.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.goto && ctx) { ctx.open(b.dataset.goto); return; }
    if (b.id === 're-reload') load();
    if (b.id === 're-send') busy(box, b, async () => { await saving; const out = await call('repairEmailSendNow'); await load(); say(box, out.message, out.status === 'DONE' ? 'good' : ''); });
  });
  await load();
}

/* ---------- Driver Check-In Email ---------- */

// Joe 10/11: each location has its own check-in mailbox; the Location drop-down picks which one the page shows and saves.
export async function renderCheckinEmail(box) {
  let data = null, plant = 'fac_uniontown';
  box.innerHTML = '<div class="ap">' + bar('<button type="button" class="ap-btn" id="ce-now">Check now</button><button type="button" class="ap-btn" id="ce-std">Use the standard addresses</button><button type="button" class="ap-btn" id="ce-reload">Refresh</button>',
    '<b style="color:#0b3d6b">Location</b><select id="ce-plant" aria-label="Location">' + window.UDLogic.PLANTS.map(p => '<option value="' + p.id + '">' + e(p.name) + '</option>').join('') + '</select>') +
    '<p class="ap-note">The phone check-in service emails each driver check-in. This check reads that mailbox (read-only), adds equipment issues, cleaning and returns to the maintenance lists and records cases delivered and returned.</p>' +
    '<div class="ap-split"><section class="ap-card"><h3>Mailbox</h3><label class="ap-checks"><label><input type="checkbox" id="ce-on"> Check the mailbox</label></label>' +
    '<label class="ap-field">Sent by (the answering service)<input type="email" id="ce-from"></label><label class="ap-field">Sent to (our mailbox)<input type="email" id="ce-to"></label>' +
    '<label class="ap-field">Subject line it looks for<input id="ce-subject" maxlength="120"></label></section>' +
    '<section class="ap-card"><h3>Status</h3><div class="ap-list" id="ce-status"></div></section></div></div>';
  const $ = (s) => box.querySelector(s);
  function fill(s) { $('#ce-on').checked = s.enabled; $('#ce-from').value = s.sender; $('#ce-to').value = s.recipient; $('#ce-subject').value = s.subject; }
  function render() {
    const s = data.settings, l = data.last;
    const lines = [s.enabled ? '<b>ON</b> &mdash; checks about every ' + data.every + ' minutes (change it in Refresh Rates).' : '<b>OFF</b> &mdash; the mailbox is not being checked.',
      'Last successful check: ' + e(s.lastSuccessAt ? when(s.lastSuccessAt) : 'never') + (l ? ' (' + e(String(l.status).toLowerCase()) + ')' : ''),
      l ? 'Last run: ' + chip(l.status) + ' ' + l.read + ' check-ins read, ' + l.added + ' records added, ' + l.review + ' need review, ' + l.seen + ' already seen' + (l.digestRead ? ', ' + l.digestRead + ' in the morning list (' + (l.digestCredited || 0) + ' newly credited)' : '') + (l.error ? ' &mdash; ' + e(l.error) : '') : 'Last run: none yet.',
      'Mailbox owner: ' + e(s.owner || 'set when the check is turned on (the administrator who saves it)')];
    $('#ce-status').innerHTML = lines.map(t => '<div class="ap-item"><div>' + t + '</div></div>').join('');
  }
  // Batch 5 (10/23): no Save button; the tick saves when it is changed and each box when it is left, for the location shown.
  let saving = Promise.resolve();
  function save() {
    // Joe 10/26: each location's check-in mailbox is kept in that location's own database (udPlant names it).
    const fields = { plant, udPlant: plant, enabled: $('#ce-on').checked, sender: $('#ce-from').value, recipient: $('#ce-to').value, subject: $('#ce-subject').value };
    saving = saving.then(async () => {
      try { const out = await call('saveCheckinEmail', fields); say(box, ''); if (out.plant === plant) { data = out; if (box.isConnected) render(); } } catch (err) { say(box, errText(err), 'bad'); }
    });
    return saving;
  }
  async function load() { await saving; try { data = await call('checkinEmail', { plant, udPlant: plant }); if (box.isConnected) { fill(data.settings); render(); } } catch (err) { say(box, errText(err), 'bad'); } }
  box.addEventListener('change', ev => {
    if (ev.target.id === 'ce-plant') { plant = ev.target.value; say(box, ''); load(); return; }
    if (data && ev.target.closest('#ce-on, #ce-from, #ce-to, #ce-subject')) save();
  });
  box.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'ce-reload') load();
    if (b.id === 'ce-std') { $('#ce-from').value = data.standard.sender; $('#ce-to').value = data.standard.recipient; $('#ce-subject').value = data.standard.subject; save(); }
    if (b.id === 'ce-now') busy(box, b, async () => { await saving; data = await call('checkinEmailNow', { plant, udPlant: plant }); render(); say(box, data.message, data.status === 'FAIL' ? 'bad' : data.status === 'OFF' ? '' : 'good'); });
  });
  await load();
}

/* ---------- Refresh Rates ---------- */

export async function renderRefreshRates(box) {
  let data = null;
  box.innerHTML = '<div class="ap">' + bar('<button type="button" class="ap-btn" id="rr2-reload">Reload schedules</button><button type="button" class="ap-btn" id="rr2-archive">Archive now</button>', '<span class="ap-help" id="rr2-tz"></span>') +
    '<p class="ap-note">A job\'s schedule saves as soon as it is picked; it does not run the job now. Each screen also updates by itself the moment the data changes.</p>' +
    '<div class="ap-scroll"><table class="ap-t rr2-t"><thead><tr><th style="width:19%">Job</th><th style="width:28%">What it does</th><th style="width:22%">How often</th><th style="width:16%">Last run</th></tr></thead><tbody id="rr2-rows"></tbody></table></div></div>';
  const $ = (s) => box.querySelector(s);
  function control(j) {
    if (j.kind === 'interval') return '<select data-minutes="' + j.key + '">' + data.minutes.filter(m => m >= j.base).map(m => '<option value="' + m + '"' + (m === j.minutes ? ' selected' : '') + '>Every ' + minutesText(m) + '</option>').join('') + '</select>' + (j.warnOver && j.minutes > j.warnOver ? '<small class="ap-chip warn">Readings older than ' + j.warnOver + ' minutes</small>' : '');
    if (j.kind === 'weekly') return '<select data-day="' + j.key + '">' + data.weekdays.map(d => '<option' + (d === j.day ? ' selected' : '') + '>' + d + '</option>').join('') + '</select> <select data-hour="' + j.key + '">' + Array.from({ length: 24 }, (x, h) => '<option value="' + h + '"' + (h === j.hour ? ' selected' : '') + '>' + String(h).padStart(2, '0') + ':00</option>').join('') + '</select>';
    if (j.kind === 'retired') return '<span class="ap-chip">Retired</span>';
    return '<span class="ap-chip blue">' + e(j.every) + '</span>';
  }
  function render() {
    $('#rr2-tz').textContent = 'Times are ' + data.timeZone + '.';
    $('#rr2-rows').innerHTML = data.jobs.map(j => '<tr><td><b>' + e(j.label) + '</b>' + (j.updatedAt ? '<small>Saved ' + e(when(j.updatedAt)) + ' by ' + e(j.updatedBy) + '</small>' : j.kind === 'interval' || j.kind === 'weekly' ? '<small>Standard setting</small>' : '') + '</td>' +
      '<td>' + e(j.what) + '</td><td>' + control(j) + '</td><td>' + e(j.lastRun ? when(j.lastRun) : '') + '</td></tr>').join('');
  }
  // Batch 5 (10/23): no Save rate button; a schedule saves when its drop-down is picked. A refused one goes back to what is saved.
  let saving = Promise.resolve();
  async function load() { await saving; try { data = await call('refreshRates'); if (box.isConnected) render(); } catch (err) { say(box, errText(err), 'bad'); } }
  box.addEventListener('change', ev => {
    const key = ev.target.dataset.minutes || ev.target.dataset.day || ev.target.dataset.hour;
    const j = key && data && data.jobs.find(x => x.key === key);
    if (!j) return;
    const q = (a) => box.querySelector('[' + a + '="' + j.key + '"]');
    const fields = j.kind === 'interval' ? { minutes: Number(q('data-minutes').value) } : { day: q('data-day').value, hour: Number(q('data-hour').value) };
    saving = saving.then(async () => {
      const now = data.jobs.find(x => x.key === key);
      try { data = await call('saveRefreshRate', Object.assign({ job: key, revision: now.revision }, fields)); say(box, ''); } catch (err) { say(box, errText(err), 'bad'); }
      if (box.isConnected) render();
    });
  });
  box.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'rr2-reload') load();
    if (b.id === 'rr2-archive') twice(b, 'Press again to archive', () => busy(box, b, async () => { const out = await call('archiveNow'); await load(); say(box, out.message, out.ok ? 'good' : 'bad'); }));
  });
  await load();
}

/* ---------- Window Test Center ---------- */

// Every screen of the new app, and the sheet copies it reads (View Sources).
export const WINDOWS = [
  ['Home', 'index.html', 'Every sheet copy (summary numbers)'], ['Company Locations', 'company.html', 'Live weeks, PLANT_OPERATIONS'],
  ['Route Distribution', 'distribution.html', 'Live weeks'], ['Daily Dispatch', 'daily.html', 'Live weeks, DRIVERS_MASTER, EQUIPMENT_MASTER'],
  ['Weekly Dispatch', 'weekly.html', 'Live weeks, DRIVERS_MASTER, DRIVER_EXCEPTIONS, DRIVER_VACATIONS'], ['Route Week Override', 'routeweek.html', 'Live weeks, ROUTES_MASTER'],
  ['Driver Check-Ins', 'checkins.html', 'Live weeks'], ['Equipment Issues', 'issues.html', 'TRUCK / TRAILER / FORK TRUCK LIVE'],
  ['Fleet & Maintenance', 'maint.html', 'TRUCK / TRAILER / FORK TRUCK LIVE, EQUIPMENT_MASTER'], ['Equipment', 'equipment.html', 'EQUIPMENT_MASTER'],
  ['Fleet Service', 'fleet.html', 'FLEET SERVICE SETUP, EQUIPMENT_MASTER'], ['Garage', 'garage.html', 'GARAGE WORK ORDERS'],
  ['Distribution Management', 'admin.html', 'Live weeks'], ['Route Management', 'routes.html', 'ROUTES_MASTER'],
  ['Drivers', 'drivers.html', 'DRIVERS_MASTER'], ['Driver Schedule', 'template.html', 'DRIVERS_MASTER'], ['Vacation Schedule', 'vacations.html', 'DRIVER_VACATIONS'],
  ['Operational Assignments', 'ops.html', 'App'], ['Over the Road', 'otr.html', 'App (Over the Road Trips)'], ['Driver Scorecard', 'scorecard.html', 'App, DVIRs'],
  ['Sheet Conflicts', 'conflicts.html', 'Write-back'], ['Plant Operations', 'plant.html', 'Live weeks, PLANT_OPERATIONS'],
  ['Driver Loadout & Pickup', 'loadout.html', 'Live weeks, pickups'], ['Unloading', 'unloading.html', 'Live weeks, PLANT_OPERATIONS'],
  ['Trailer Assignments', 'trailers.html', 'Live weeks'], ['Washing', 'washing.html', 'WASH / CLEANING LIVE'], ['Returns', 'returns.html', 'REFUSALS / RETURNS LIVE'],
  ['Scheduler', 'scheduler.html', 'Live weeks'], ['Quality Checks', 'quality.html', 'Plant setup'], ['Temperatures', 'temps.html', 'MOCREO sensors'],
  ['Yard Check', 'yard.html', 'YARD CHECK'], ['Shift Notes', 'shiftnotes.html', 'App'], ['Manager Center', 'manager.html', 'Live weeks, PLANT_OPERATIONS'],
  ['Print Layouts', 'print.html', 'Live weeks'], ['Dispatch Settings', 'settings.html', 'App'], ['Product Sheet', 'products.html', 'App'], ['Machine Setup', 'machine-setup.html', 'App'],
  ['MOCREO & Sensors', 'mocreo.html', 'App'], ['RedZone', 'redzone.html', 'App'], ['GPS Setup', 'gps.html', 'App'], ['Texts', 'texts.html', 'App'], ['Upload Center', 'uploads.html', 'App'],
  ['Driver Station', 'driver-station.html', 'Live weeks'], ['Plant Station', 'plant-station.html', 'Live weeks'], ['Garage Station', 'garage-station.html', 'GARAGE TECHNICIANS'],
  ['Plant Reports', 'reports.html', 'Live weeks, PLANT_OPERATIONS'], ['Plant Performance Kiosk', 'plant-kiosk.html', 'Live weeks, PLANT_OPERATIONS'],
  ['Mobile Route (phone)', 'route.html', 'Live weeks']
];
const SIZES = [[1920, 1080, 'Desktop 1920 x 1080'], [1366, 768, 'Laptop 1366 x 768'], [412, 915, 'Phone 412 x 915']];

export async function renderWindowTest(box) {
  const testEmail = new URLSearchParams(location.search).get('testEmail');
  const src = (page) => page + (testEmail ? (page.indexOf('?') >= 0 ? '&' : '?') + 'testEmail=' + encodeURIComponent(testEmail) : '');
  box.innerHTML = '<div class="ap">' + bar('<button type="button" class="ap-btn" id="wt-open">Open Window</button><button type="button" class="ap-btn main" id="wt-run">Run Debug Test</button><button type="button" class="ap-btn" id="wt-all">Test every screen</button>',
    '<select id="wt-screen" aria-label="Screen">' + WINDOWS.map((w, i) => '<option value="' + i + '">' + e(w[0]) + ' — ' + e(w[1]) + '</option>').join('') + '</select><select id="wt-size" aria-label="Window size">' + SIZES.map((s, i) => '<option value="' + i + '">' + s[2] + '</option>').join('') + '</select>') +
    '<p class="ap-note">Read-only: opens a screen at a window size and checks it loads, shows no error, and fits with no sideways scroll. It presses no buttons and saves nothing on the screen. Sources: <b id="wt-src"></b></p>' +
    '<div class="ap-split" style="grid-template-columns:minmax(420px,1.2fr) minmax(420px,1fr)"><section class="ap-card" style="padding:8px"><div id="wt-stage" style="flex:1;min-height:0;overflow:hidden;position:relative;background:#eef2f6;border-radius:8px"></div></section>' +
    '<section class="ap-card" style="padding:0"><div class="ap-scroll" style="border:0"><table class="ap-t"><thead><tr><th>Screen</th><th>Size</th><th>Result</th><th>Time</th></tr></thead><tbody id="wt-rows"></tbody></table></div></section></div></div>';
  const $ = (s) => box.querySelector(s);
  const pick = () => WINDOWS[Number($('#wt-screen').value)], size = () => SIZES[Number($('#wt-size').value)];
  const showSrc = () => { $('#wt-src').textContent = pick()[2]; };
  showSrc();
  $('#wt-screen').addEventListener('change', showSrc);
  // The screen drawn at its real size, scaled down to fit the box.
  function frame(w, h) {
    const stage = $('#wt-stage');
    stage.innerHTML = '';
    const f = document.createElement('iframe');
    f.title = 'Window test';
    f.style.cssText = 'position:absolute;left:0;top:0;border:0;background:#fff;transform-origin:0 0;width:' + w + 'px;height:' + h + 'px';
    const scale = Math.min(stage.clientWidth / w, stage.clientHeight / h, 1);
    f.style.transform = 'scale(' + scale + ')';
    stage.appendChild(f);
    return f;
  }
  function test(win, sz) {
    return new Promise(resolve => {
      const f = frame(sz[0], sz[1]), t0 = performance.now();
      let done = false;
      // ms = until the screen finished drawing its data.
      const finish = (problems, ms) => { if (done) return; done = true; resolve({ screen: win[0], page: win[1], width: sz[0], ms: ms || Math.round(performance.now() - t0), status: problems.length ? 'FAIL' : 'PASS', problems }); };
      f.addEventListener('load', () => {
        const w = f.contentWindow, d = f.contentDocument, errors = [];
        try { w.addEventListener('error', ev => errors.push(String(ev.message || 'script error'))); } catch (x) { /* other origin */ }
        // Ready = no "Loading" left on the screen and nothing redrawn for 0.8 seconds (the data has arrived), or 12 seconds.
        const started = performance.now();
        let lastChange = performance.now();
        try { new w.MutationObserver(() => { lastChange = performance.now(); }).observe(d.documentElement, { childList: true, subtree: true, characterData: true }); } catch (x) { /* none */ }
        const poll = () => {
          let loading = false;
          try { loading = !d.body || /Loading\u2026|Loading\.\.\./.test(d.body.innerText.slice(0, 4000)) || performance.now() - lastChange < 800; } catch (x) { loading = false; }
          if (loading && performance.now() - started < 12000) { setTimeout(poll, 150); return; }
          // A screen with a clock keeps changing: only a "Loading" still showing counts against it.
          let stillLoading = false;
          try { stillLoading = /Loading\u2026|Loading\.\.\./.test(d.body.innerText.slice(0, 4000)); } catch (x) { /* none */ }
          const ready = Math.round(Math.min(lastChange, performance.now()) - t0);
          const problems = errors.slice();
          try {
            const box2 = d.getElementById('error');
            if (box2 && !box2.hidden && box2.textContent.trim()) problems.push('Error shown: ' + box2.textContent.trim().slice(0, 160));
            if (d.scrollingElement && d.scrollingElement.scrollWidth > w.innerWidth + 1) problems.push('Scrolls sideways (' + d.scrollingElement.scrollWidth + ' px wide in a ' + w.innerWidth + ' px window)');
            if (/Being built in Operations/.test(d.body.innerText)) problems.push('Says "Being built"');
          } catch (x) { problems.push('Could not read the screen'); }
          if (stillLoading) problems.push('Still loading after 12 seconds');
          finish(problems, ready);
        };
        poll();
      });
      setTimeout(() => finish(['Did not open within 20 seconds']), 20000);
      f.src = src(win[1]);
    });
  }
  const rows = [];
  function draw() {
    $('#wt-rows').innerHTML = rows.map(r => '<tr><td><b>' + e(r.screen) + '</b><small>' + e(r.page) + '</small>' + (r.problems.length ? '<small style="color:#b42318">' + r.problems.map(e).join('<br>') + '</small>' : '') + '</td><td>' + r.width + '</td><td>' + chip(r.status) + '</td><td>' + r.ms + ' ms</td></tr>').join('') ||
      '<tr><td colspan="4" class="ap-empty">Pick a screen and a size, then Run Debug Test; or Test every screen.</td></tr>';
  }
  draw();
  async function record(results) { try { await call('windowTestLog', { results }); } catch (err) { /* the screen result still shows */ } }
  box.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'wt-open') { const sz = size(); frame(sz[0], sz[1]).src = src(pick()[1]); say(box, 'Opened ' + pick()[0] + ' at ' + sz[2] + '.'); }
    if (b.id === 'wt-run') busy(box, b, async () => {
      const r = await test(pick(), size()); rows.unshift(r); draw(); await record([r]);
      say(box, (r.status === 'PASS' ? 'READ RESPONSE CONFIRMED' : 'READ CHECK FAILED') + ' · ' + r.screen + ' · ' + r.ms + ' ms. Diagnostic record saved.', r.status === 'PASS' ? 'good' : 'bad');
    });
    if (b.id === 'wt-all') busy(box, b, async () => {
      const sz = size(), batch = [];
      for (let i = 0; i < WINDOWS.length; i++) {
        say(box, 'Testing ' + (i + 1) + ' / ' + WINDOWS.length + ': ' + WINDOWS[i][0] + '…');
        const r = await test(WINDOWS[i], sz); batch.push(r); rows.unshift(r); draw();
      }
      await record(batch);
      const bad = batch.filter(r => r.status !== 'PASS').length;
      say(box, batch.length + ' screens at ' + sz[2] + ': ' + (batch.length - bad) + ' passed, ' + bad + ' failed. Diagnostic record saved.', bad ? 'bad' : 'good');
    });
  });
}

/* ---------- Run Runtime Pre-Flight ---------- */

export async function renderPreflight(box) {
  box.innerHTML = '<div class="ap">' + bar('<button type="button" class="ap-btn main" id="pf-run">Run Runtime Pre-Flight</button>', '<span class="ap-chip" id="pf-sum">Not run yet</span>') +
    '<p class="ap-note">The app\'s health check: the sheet copy, the Live weeks, today\'s runs, the master lists, users, the write-back, maintenance, plant, sensors, email, codes and the fleet sync. Read only; it changes nothing.</p>' +
    '<div class="ap-scroll"><table class="ap-t"><thead><tr><th>Check</th><th>Result</th><th>Detail</th><th>Time</th></tr></thead><tbody id="pf-rows"><tr><td colspan="4" class="ap-empty">Press Run Runtime Pre-Flight.</td></tr></tbody></table></div></div>';
  const $ = (s) => box.querySelector(s);
  box.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b || b.id !== 'pf-run') return;
    say(box, 'Running the checks…');
    busy(box, b, async () => {
      const out = await call('preflight');
      $('#pf-sum').textContent = out.summary;
      $('#pf-sum').className = 'ap-chip ' + (/^PASS/.test(out.summary) ? 'good' : 'bad');
      $('#pf-rows').innerHTML = out.checks.map(c => '<tr><td><b>' + e(c.name) + '</b></td><td>' + chip(c.status) + '</td><td>' + e(c.detail) + '</td><td>' + c.ms + ' ms</td></tr>').join('');
      say(box, out.summary + ' · ' + when(out.at), /^PASS/.test(out.summary) ? 'good' : 'bad');
    });
  });
}

/* ---------- Update Live Sheets ---------- */

const FIELD_TEXT = { runs: 'Runs', dispatchTime: 'Depart', driver: 'Driver', truck: 'Truck', trailer: 'Trailer' };
const shown = (k, v) => (k === 'runs' ? (v ? 'Yes' : 'No') : k === 'dispatchTime' ? (v === null || v === undefined ? '' : window.UDLogic.timeText(v)) : String(v === null || v === undefined ? '' : v));
export async function renderUpdateLive(box) {
  box.innerHTML = '<div class="ap">' + bar('<button type="button" class="ap-btn" id="ul-dry">Dry Run</button><button type="button" class="ap-btn main" id="ul-go">Update Live Sheets</button>') +
    '<p class="ap-note">Copies Route Master and the drivers\' standard runs (Driver Schedule) into the Current and Next Live weeks. Only days loading today or later; days already loaded and days changed by hand on Daily or Weekly (route override) are kept. A day with a driver, truck or trailer keeps it; only empty ones are filled. A Route Master run missing from either week is added to it. Weekly\'s Publish to Daily Dispatch does the same when it builds the new Next week. Dry Run shows every change first.</p>' +
    '<div class="ap-scroll"><table class="ap-t"><thead><tr><th>Week</th><th>Day</th><th>Route</th><th>Run</th><th>Change</th></tr></thead><tbody id="ul-rows"><tr><td colspan="5" class="ap-empty">Press Dry Run to see what would change.</td></tr></tbody></table><div id="ul-missing"></div></div></div>';
  const $ = (s) => box.querySelector(s);
  function draw(out) {
    $('#ul-rows').innerHTML = out.changes.map(c => '<tr><td>' + e(c.week) + '</td><td>' + e(window.UDLogic.dayName ? window.UDLogic.dayName(c.date) : c.day) + ' ' + e(c.date.slice(5)) + '</td><td><b>' + e(c.route) + '</b></td><td>' + e(c.run) + '</td><td>' +
      Object.keys(c.after).filter(k => FIELD_TEXT[k]).map(k => e(FIELD_TEXT[k]) + ': <s>' + e(shown(k, c.before[k])) + '</s> &rarr; <b>' + e(shown(k, c.after[k])) + '</b>').join(' &middot; ') + '</td></tr>').join('') ||
      '<tr><td colspan="5" class="ap-empty">Nothing to change: the Live weeks already match Route Master.</td></tr>';
    $('#ul-missing').innerHTML = out.missing.length ? '<div class="ap-section" style="margin:10px"><h3>' + (out.applied && out.added ? 'Route Master runs added to the Live weeks' : out.applied ? 'Route Master runs not on the Live weeks' : 'Route Master runs to add to the Live weeks') + '</h3>' + out.missing.map(m => '<div>' + (m.week ? e(m.week) + ' &middot; ' : '') + e(m.route) + ' ' + e(m.run) + ' <small>(' + e(m.runId) + ')</small></div>').join('') + '</div>' : '';
  }
  box.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'ul-dry') busy(box, b, async () => { const out = await call('updateLive', { apply: false }); draw(out); say(box, out.message, 'good'); });
    if (b.id === 'ul-go') {
      if (b.dataset.armed !== '1') say(box, 'This writes Route Master and the drivers\' standard runs into the Current and Next Live weeks (not days already loaded or changed on Daily / Weekly). Press again within 8 seconds.');
      twiceTimed(b, 'Click Again to Update Live', 8000, () => busy(box, b, async () => { const out = await call('updateLive', { apply: true }); draw(out); say(box, out.message, 'good'); }));
    }
  });
}

/* ---------- Refresh Home Summary Now ---------- */

export async function renderRefreshHome(box) {
  box.innerHTML = '<div class="ap">' + bar('<button type="button" class="ap-btn main" id="rh-go">Refresh Home Summary Now</button>') +
    '<p class="ap-note">Copies the sheets right now instead of waiting for the next copy (every minute), so Home and every screen show the latest numbers at once. Use it after changing a sheet by hand.</p><div id="rh-out"></div></div>';
  box.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b || b.id !== 'rh-go') return;
    busy(box, b, async () => { const out = await call('refreshHome'); say(box, out.message, 'good'); });
  });
}

/* ---------- Start Plant Fresh From Today ---------- */

export async function renderPlantFresh(box) {
  box.innerHTML = '<div class="ap">' + bar('<button type="button" class="ap-btn warn" id="pfr-go">Start Plant Fresh From Today</button>', '<span class="ap-chip" id="pfr-now"></span>') +
    '<p class="ap-note">Loads from before today stop showing as prior-day work on the Loadout Center, the plant departments, Plant Station and the Manager Center. Nothing is deleted; carry-over works normally from today on.</p></div>';
  const $ = (s) => box.querySelector(s);
  const show = (p) => { $('#pfr-now').textContent = p ? 'Started fresh from ' + p.date + ' by ' + p.by : 'Never started fresh'; };
  try { show((await call('plantFresh')).plantStart); } catch (err) { say(box, errText(err), 'bad'); }
  box.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b || b.id !== 'pfr-go') return;
    twice(b, 'Click Again to Confirm', () => busy(box, b, async () => { const out = await call('plantFreshSet'); show(out.plantStart); say(box, out.message, 'good'); }));
  });
}

/* ---------- Date Inventory ---------- */

const KINDS = ['DATE_VALUE', 'NUMBER', 'TEXT_DATE', 'TEXT_TIME', 'TEXT_TIMESTAMP', 'TEXT_OTHER', 'BOOLEAN', 'BLANK'];
const STATUS_CHIP = { SERIAL_OK: 'good', MIXED: 'bad', SINGLE_TEXT_KIND: 'warn', EMPTY: '' };
export async function renderDateInventory(box) {
  let last = null;
  box.innerHTML = '<div class="ap">' + bar('<button type="button" class="ap-btn main" id="di-run">Run Date Inventory</button><button type="button" class="ap-btn" id="di-csv" disabled>Download CSV</button>', '<span class="ap-chip" id="di-sum">Not run yet</span>') +
    '<p class="ap-note">Lists every date/time column in the sheets the app reads and how its values are stored. Changes nothing.</p>' +
    '<div class="ap-scroll"><table class="ap-t"><thead><tr><th>Sheet</th><th>Column</th><th>Status</th><th>Filled</th><th>How it is stored</th><th>Samples</th></tr></thead><tbody id="di-rows"><tr><td colspan="6" class="ap-empty">Press Run Date Inventory.</td></tr></tbody></table></div></div>';
  const $ = (s) => box.querySelector(s);
  box.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'di-run') busy(box, b, async () => {
      last = await call('dateInventory');
      $('#di-sum').textContent = last.summary;
      $('#di-rows').innerHTML = last.columns.map(c => '<tr><td><b>' + e(c.sheet) + '</b><small>header row ' + c.headerRow + '</small></td><td>' + e(c.header) + '<small>column ' + c.column + '</small></td><td><span class="ap-chip ' + (STATUS_CHIP[c.status] || '') + '">' + e(c.status) + '</span></td><td>' + c.filled + '</td>' +
        '<td>' + KINDS.filter(k => c.counts[k] && k !== 'BLANK').map(k => e(k.toLowerCase().replace('_', ' ')) + ' ' + c.counts[k]).join(' &middot; ') + '</td><td>' + c.samples.map(e).join('<br>') + '</td></tr>').join('') +
        (last.errors.length ? '<tr><td colspan="6" class="ap-msg bad">' + last.errors.map(e).join('<br>') + '</td></tr>' : '');
      $('#di-csv').disabled = false;
      say(box, last.summary, 'good');
    });
    if (b.id === 'di-csv' && last) {
      const q = (v) => '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"';
      const head = ['Sheet', 'Header Row', 'Column', 'Header', 'Named Date', 'Filled', 'Status', 'Dominant'].concat(KINDS, ['Samples']);
      const csv = [head.map(q).join(',')].concat(last.columns.map(c => [c.sheet, c.headerRow, c.column, c.header, c.named, c.filled, c.status, c.dominant].concat(KINDS.map(k => c.counts[k] || 0), [c.samples.join(' | ')]).map(q).join(','))).join('\r\n');
      const a = document.createElement('a');
      const d = new Date(), p = (n) => String(n).padStart(2, '0');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = 'DATE_INVENTORY_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.csv';
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
  });
}

/* ---------- Date Column Dry Run / Convert ---------- */

export async function renderDateConvert(box) {
  box.innerHTML = '<div class="ap">' + bar('<button type="button" class="ap-btn" id="dc-dry">Dry Run</button><button type="button" class="ap-btn main" id="dc-go" disabled>Convert Column</button>') +
    '<p class="ap-note">Dry run first. Convert keeps a backup of the column in the app, rewrites the column as real dates with a readable format and checks every cell; if any cell does not read back, the old values are put back. Only the sandbox copies of the sheets can be converted.</p>' +
    '<div class="ap-form" style="grid-template-columns:2fr 2fr 1fr"><label class="ap-field">Sheet<select id="dc-sheet"></select></label><label class="ap-field">Column<input id="dc-col" placeholder="hire_date"></label>' +
    '<label class="ap-field">Kind<select id="dc-kind"><option>DATE</option><option>TIME</option><option>DATETIME</option></select></label></div>' +
    '<div class="ap-section"><h3>Converted columns</h3><div id="dc-done" class="ap-list"></div></div></div>';
  const $ = (s) => box.querySelector(s);
  async function load() {
    try {
      const out = await call('dateSheets');
      $('#dc-sheet').innerHTML = out.sheets.map(s => '<option value="' + e(s.alias) + '"' + (s.sandbox ? '' : ' disabled') + '>' + e(s.alias) + (s.sandbox ? '' : ' (production: read only)') + '</option>').join('') || '<option value="">No sheets are set up here</option>';
      const keys = Object.keys(out.converted);
      $('#dc-done').innerHTML = keys.map(k => { const c = out.converted[k]; return '<div class="ap-item"><div><b>' + e(k.replace('|', ' · ')) + '</b><small>' + e(c.kind) + ' · ' + c.rows + ' cells · ' + e(when(c.convertedAt)) + ' by ' + e(c.convertedBy) + '</small></div></div>'; }).join('') || '<div class="ap-empty">None yet.</div>';
    } catch (err) { say(box, errText(err), 'bad'); }
  }
  const input = () => ({ sheet: $('#dc-sheet').value, column: $('#dc-col').value, kind: $('#dc-kind').value });
  // Any change to the sheet, column or kind needs a new dry run.
  box.addEventListener('input', () => { $('#dc-go').disabled = true; });
  box.addEventListener('change', () => { $('#dc-go').disabled = true; });
  box.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'dc-dry') busy(box, b, async () => { const out = await call('dateDryRun', input()); say(box, out.message, out.canConvert ? 'good' : 'bad'); $('#dc-go').dataset.ok = out.canConvert ? '1' : ''; }).then(() => { $('#dc-go').disabled = $('#dc-go').dataset.ok !== '1'; });
    if (b.id === 'dc-go') twice(b, 'Press again to convert', () => busy(box, b, async () => { const out = await call('dateConvert', input()); say(box, out.message, 'good'); $('#dc-go').dataset.ok = ''; await load(); }).then(() => { $('#dc-go').disabled = true; }));
  });
  await load();
}

export const TOOL_PAGES = {
  'repair-email': renderRepairEmail,
  'checkin-email': renderCheckinEmail,
  'refresh-rates': renderRefreshRates,
  'window-test': renderWindowTest,
  preflight: renderPreflight,
  'update-live': renderUpdateLive,
  'refresh-home': renderRefreshHome,
  'plant-fresh': renderPlantFresh,
  'date-inventory': renderDateInventory,
  'date-convert': renderDateConvert
};
