'use strict';
/*
 * Full practice-copy test (Joe 10/22: "use Playwright on the sandbox version. Do all your reads and writes. Do the timings.
 * ... after you do the write, look at the screens to see if there's something that just is not adding up").
 * Runs against the deployed practice copy (never live), signed in as the practice test administrator. It measures and takes
 * pictures; it does not pass or fail on what it finds (the findings are read afterwards and written up for Joe).
 *
 *   1. Reads: every screen opened fresh at Joe's window size (1536 x 790), timed until drawn, with its errors, failed server
 *      calls, text under 16px, sideways scrolling, the numbers it shows, and a picture; key screens again at 1920 x 950, and
 *      the phone and tablet screens at 390 and 1024.
 *   2. Writes on today's loads, each timed from the press until the screen shows it, with the server call's own time, and
 *      the related screens captured after each one so they can be compared: Loadout Start / End, Skip, Ended Up Not Running,
 *      Daily depart time, Weekly driver, Route Editor start time, Box load times, Yard check, Cooler temperature, Shift note.
 *      Changes that can be put back are put back (and the screens captured again).
 *
 * Usage: node test/browser/practice-audit.cjs <site> <out dir>
 * Env: KEY = the practice copy's service-account key (signs the test administrator in), AUDIT_EMAIL, LOCAL=1 (emulators:
 * signs in with ?testEmail instead), ONLY = comma list of pages, NO_WRITES=1.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SITE = (process.argv[2] || 'https://ud-distribution-sandbox.web.app').replace(/\/$/, '');
const OUT = process.argv[3] || 'practice-audit-out';
const EMAIL = process.env.AUDIT_EMAIL || 'practice.audit@uniteddairy.com';
const LOCAL = process.env.LOCAL === '1';
const SHOTS = path.join(OUT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
if (/ud-distribution\.web\.app|ud-distribution\.firebaseapp\.com/.test(SITE)) throw new Error('Never run this against live');

const SCREENS = [
  ['Home', 'index.html'], ['Route Distribution', 'distribution.html'], ['Daily Dispatch', 'daily.html'], ['Weekly Dispatch', 'weekly.html'],
  ['Route Editor', 'routes.html'], ['Route Week Override', 'routeweek.html'], ['Driver Roster', 'drivers.html'], ['Driver Weekly Template', 'template.html'],
  ['Vacation Schedule', 'vacations.html'], ['Fleet & Maintenance', 'maint.html'], ['Equipment', 'equipment.html'], ['Equipment Issues', 'issues.html'],
  ['Garage Work Orders', 'garage.html'], ['Fleet Service', 'fleet.html'], ['Driver Scorecard', 'scorecard.html'], ['Over the Road', 'otr.html'],
  ['Trucks Today', 'trucks.html'], ['GPS Setup', 'gps.html'], ['Driver Check-ins', 'checkins.html'], ['Driver Station', 'driver-station.html'],
  ['Sheet Conflicts', 'conflicts.html'], ['Dispatch Administration', 'admin.html'], ['Operational Assignments', 'ops.html'], ['Print Layouts', 'print.html'],
  ['Dispatch Settings', 'settings.html'], ['Administration', 'administration.html'], ['Manager Center', 'manager.html'], ['Plant Departments', 'plant.html'],
  ['Loadout Center', 'loadout.html'], ['Daily Box Loadout', 'loadout.html?area=BOXING'], ['Late Forecast', 'forecast.html'], ['Unloading & Washing', 'unloading.html'],
  ['Product Returns', 'returns.html'], ['Truck Washing', 'washing.html'], ['Trailer Assignments', 'trailers.html'], ['Plant Operations Scheduler', 'scheduler.html'],
  ['Shift Notes', 'shiftnotes.html'], ['Quality Checks', 'quality.html'], ['Cooler Temperature', 'temps.html'], ['Yard Checks', 'yard.html'],
  ['Manager Walkthrough', 'walkthrough.html'], ['Plant Reports', 'reports.html'], ['Shift Reports', 'shiftreports.html'], ['Plant Performance TV', 'plant-kiosk.html'],
  ['Reports', 'reportcenter.html'], ['Safety Walkthrough', 'safety.html'], ['Production Lines', 'production.html'], ['Line Targets', 'linetargets.html'],
  ['Inventory', 'inventory.html'], ['Maintenance Center', 'pmaint.html'], ['Machinery', 'machinery.html'], ['Work Orders (plant)', 'pmworkorders.html'],
  ['PM Schedule', 'pmschedule.html'], ['MOCREO & Sensors', 'mocreo.html'], ['Company Overview', 'company.html'], ['Upload Center', 'uploads.html'],
  ['Driver Assignment Board', 'weekly.html#board'], ['Truck Issues', 'issues.html?kind=TRUCK'], ['Trailer Issues', 'issues.html?kind=TRAILER'],
  ['Fork Truck Issues', 'issues.html?kind=FORK_TRUCK'], ['Send Current Report', 'manager.html?report=1'], ['Loading Rundown', 'reports.html?view=rundown'],
  ['Production TV', 'production.html?tv=1'], ['Line Tablet', 'line.html'], ['Maintenance Station', 'maint-station.html'], ['Garage Station', 'garage-station.html'],
  ['Plant Station', 'plant-station.html'], ['Driver Room TV', 'driver-room.html'], ['Driver Check-In (phone)', 'route.html'], ['Phone Screens', 'phone-screens.html'],
  ['Open Safety Issues', 'safety-issues.html'], ['Fire Extinguishers', 'extinguishers.html'], ['Fire Alarm', 'safety-fire.html?sys=alarm'],
  ['Fire Suppression', 'safety-fire.html?sys=suppression'], ['Escape Plan', 'safety-fire.html?sys=escape'], ['Past Walks', 'safety-walks.html'],
  ['Checklist Setup', 'safety-setup.html'], ['Products', 'products.html'], ['Machine Setup', 'machine-setup.html'], ['Location Areas', 'location-areas.html'],
  ['RedZone', 'redzone.html'], ['Shifts', 'shifts.html'], ['Text Log', 'texts.html'], ['Sent Email Log', 'administration.html#emails'], ['Vacations', 'vacations.html'],
  ['Upload / Data', 'data/'], ['Ops screen', 'ops.html']
].filter((s, i, a) => a.findIndex(x => x[1] === s[1]) === i && s[1] !== 'data/');
const WIDE = ['index.html', 'distribution.html', 'daily.html', 'weekly.html', 'routes.html', 'loadout.html', 'loadout.html?area=BOXING', 'forecast.html', 'plant.html', 'manager.html', 'yard.html', 'trucks.html', 'issues.html', 'garage.html', 'administration.html'];
const PHONE = ['route.html', 'yard.html', 'quality.html', 'temps.html', 'index.html', 'loadout.html'];
const TABLET = ['plant-station.html', 'loadout.html', 'yard.html', 'washing.html', 'unloading.html', 'driver-room.html'];
// Related screens captured after each write.
const AFTER = ['distribution.html', 'daily.html', 'weekly.html', 'loadout.html', 'plant.html', 'forecast.html', 'yard.html', 'trucks.html', 'manager.html', 'driver-station.html', 'reports.html?view=rundown'];

const report = { site: SITE, startedAt: new Date().toISOString(), screens: [], wide: [], phone: [], tablet: [], writes: [], after: [], notes: [] };
const save = () => fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(report, null, 1));
const note = (s) => { report.notes.push(s); console.log('NOTE ' + s); };
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

let TOKEN = '';
async function customToken() {
  const key = JSON.parse(fs.readFileSync(process.env.KEY, 'utf8'));
  const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
  const admin = r('firebase-admin');
  const a = admin.initializeApp({ credential: admin.credential.cert(key), projectId: key.project_id }, 'audit');
  // The sign-in token carries the verified United Dairy address, which the database rules and the server check.
  return r('firebase-admin/auth').getAuth(a).createCustomToken('practice-audit', { email: EMAIL, email_verified: true });
}
const withWho = (url) => LOCAL ? url.replace(/^([^#]*?)(\?[^#]*)?(#.*)?$/, (m, p, q, h) => p + (q ? q + '&' : '?') + 'testEmail=' + EMAIL + (h || '')) : url;

// Every page: its errors, server calls (with their times) and what changes on screen.
function watch(page) {
  const w = { errors: [], console: [], calls: [], failed: [] };
  page.on('pageerror', e => w.errors.push(String(e.message).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error') w.console.push(m.text().slice(0, 300)); });
  page.on('requestfailed', r => { if (!/google-analytics|fonts\.g/.test(r.url())) w.failed.push(r.url().slice(0, 160) + ' ' + ((r.failure() || {}).errorText || '')); });
  page.on('response', async r => {
    const u = r.url();
    const m = u.match(/cloudfunctions\.net\/([A-Za-z]+)|:5001\/[^/]+\/[^/]+\/([A-Za-z]+)/);
    if (!m) return;
    const t = r.request().timing();
    let body = '';
    try { body = (await r.text()).slice(0, 400); } catch (e) { /* closed */ }
    let op = '';
    try { op = (JSON.parse(r.request().postData() || '{}').data || {}).action || (JSON.parse(r.request().postData() || '{}').data || {}).op || ''; } catch (e) { /* not json */ }
    w.calls.push({ fn: m[1] || m[2], op, status: r.status(), ms: Math.round(t.responseEnd > 0 ? t.responseEnd : -1), at: Date.now(), error: /"error"/.test(body) ? body : '' });
  });
  w.ready = page.addInitScript(() => {
    window.__muts = [];
    new MutationObserver(ms => { if (ms.some(m => m.type !== 'attributes' || m.attributeName === 'class')) window.__muts.push(performance.now()); })
      .observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  return w;
}

// Opened until drawn: the page shown (ud-drawing off) and nothing changed for QUIET ms.
const QUIET = 1200, LIMIT = 20000;
async function open(page, url) {
  const t0 = Date.now();
  await page.goto(SITE + '/' + withWho(url), { waitUntil: 'domcontentloaded', timeout: 45000 });
  let shown = -1;
  while (Date.now() - t0 < LIMIT) {
    await page.waitForTimeout(150);
    let s;
    try {
      s = await page.evaluate((q) => {
        const m = window.__muts || [], last = m.length ? m[m.length - 1] : 0;
        return { drawing: document.body && document.body.classList.contains('ud-drawing'), quiet: performance.now() - last > q, origin: performance.timeOrigin, last };
      }, QUIET);
    } catch (e) { continue; }
    if (!s.drawing && shown < 0) shown = Date.now() - t0;
    if (!s.drawing && s.quiet) return { shown, settled: Math.round(s.origin + s.last - t0) };
  }
  return { shown, settled: -1 };
}

// What the screen shows: its numbers, rows, words that say something went wrong, small text and sideways scrolling.
async function look(page) {
  return page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0; };
    const nums = {};
    document.querySelectorAll('[data-n]').forEach(el => { nums[el.dataset.n] = el.textContent.trim(); });
    const tiles = [...document.querySelectorAll('.tile, .card, .stat, .kpi, .sum, .chip')].filter(vis).slice(0, 40).map(el => el.innerText.replace(/\s+/g, ' ').trim().slice(0, 90)).filter(Boolean);
    const rows = {};
    document.querySelectorAll('tbody, #rows, #cards, #work, #list').forEach((tb, i) => { const n = tb.querySelectorAll(':scope > tr, :scope > .sw-card, :scope > .card, :scope > li').length; if (n) rows[(tb.id || tb.tagName.toLowerCase()) + (i ? '#' + i : '')] = n; });
    const small = [];
    document.querySelectorAll('body *').forEach(el => {
      if (small.length >= 12 || !vis(el)) return;
      const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
      if (!own) return;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 15.5) small.push(Math.round(fs * 10) / 10 + 'px "' + own.slice(0, 40) + '"');
    });
    const text = (document.getElementById('screen') || document.querySelector('main') || document.body).innerText;
    const bad = text.split('\n').filter(l => /\b(internal|not saved|permission|failed|error|couldn.t|could not|went wrong|try again)\b/i.test(l) || /\b(undefined|NaN|null)\b|Invalid Date|\[object/.test(l)).slice(0, 8).map(s => s.trim().slice(0, 140));
    const clipped = [...document.querySelectorAll('.tile, .card, button, th')].filter(vis).filter(el => el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'visible').slice(0, 8).map(el => el.innerText.replace(/\s+/g, ' ').trim().slice(0, 50));
    const doc = document.scrollingElement;
    const head = document.querySelector('thead th');
    return {
      signedOut: /Sign in with your United Dairy Google account/.test(document.body.innerText), title: document.title, landed: location.pathname.split('/').pop() + location.search, nums, tiles, rows,
      small, bad, clipped, sideways: doc.scrollWidth > window.innerWidth + 1, tall: doc.scrollHeight > window.innerHeight + 1,
      stickyHead: head ? getComputedStyle(head).position === 'sticky' || getComputedStyle(head.closest('thead')).position === 'sticky' : null,
      saveButtons: [...document.querySelectorAll('button')].filter(vis).filter(b => /^\s*save\b/i.test(b.textContent)).length,
      text: text.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').slice(0, 1500),
      reads: (window.UDReads && window.UDReads.log || []).filter(r => r.ms !== null).sort((a, b) => b.ms - a.ms).slice(0, 5)
    };
  });
}

async function shot(page, name) {
  const f = path.join(SHOTS, name + '.jpg');
  try { await page.screenshot({ path: f, type: 'jpeg', quality: 70 }); return path.relative(OUT, f); } catch (e) { return ''; }
}

let browser;
// The emulators: Google's Firebase files from the copy in node_modules (as the browser checks do).
async function localSdk(page) {
  const SDK = path.dirname(require.resolve('firebase/package.json'));
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
}

// One signed-in browser per screen size (the sign-in lives in the browser's own storage); every screen opens in a new tab
// with the browser's file cache cleared first, so each open is a first open.
const contexts = {};
async function contextFor(view) {
  const v = view || { viewport: { width: 1536, height: 790 } };
  const k = JSON.stringify(v);
  if (contexts[k]) return contexts[k];
  const ctx = await browser.newContext(Object.assign({ serviceWorkers: 'block', timezoneId: 'America/New_York', locale: 'en-US' }, v));
  if (!LOCAL) {
    // The screens' own check reads the address from the account record, which a token sign-in leaves empty (the deploy key
    // may not edit accounts): the test browser fills it in from the token's verified address.
    await ctx.route(/identitytoolkit\.googleapis\.com\/v1\/accounts:lookup/, async (route) => {
      const res = await route.fetch();
      const body = await res.json().catch(() => null);
      if (body && body.users && body.users[0] && body.users[0].localId === 'practice-audit') Object.assign(body.users[0], { email: EMAIL, emailVerified: true, displayName: 'Practice Test' });
      await route.fulfill({ response: res, json: body || {} });
    });
    const page = await ctx.newPage();
    if (!TOKEN) TOKEN = await customToken();
    await page.goto(SITE + '/index.html', { waitUntil: 'domcontentloaded' });
    const who = await page.evaluate(async (token) => {
      const app = await import('/js/app.js'), fb = await import('/js/firebase.js');
      const { auth } = await app.start();
      const cred = await fb.signInWithCustomToken(auth, token);
      const t = await cred.user.getIdTokenResult();
      return { email: t.claims.email, verified: t.claims.email_verified };
    }, TOKEN);
    console.log('Signed in (' + v.viewport.width + ' wide) as ' + JSON.stringify(who));
    await page.close();
  }
  contexts[k] = ctx;
  return ctx;
}
async function newPage(view) {
  const ctx = await contextFor(view);
  const page = await ctx.newPage();
  page.w = watch(page);
  await page.w.ready;
  if (LOCAL) await localSdk(page);
  try { const cdp = await ctx.newCDPSession(page); await cdp.send('Network.clearBrowserCache'); } catch (e) { /* not chromium */ }
  page.done = () => page.close();
  return page;
}

async function readPass(list, view, bucket, tag) {
  for (const [name, url] of list) {
    const page = await newPage(view);
    let t, l;
    try { t = await open(page, url); l = await look(page); } catch (e) { t = { shown: -1, settled: -1 }; l = { error: String(e.message).slice(0, 200) }; }
    const row = Object.assign({ name, url, shownMs: t.shown, settledMs: t.settled, errors: page.w.errors, consoleErrors: page.w.console.slice(0, 6), failed: page.w.failed.slice(0, 6), calls: page.w.calls }, l, { shot: await shot(page, tag + '-' + slug(name)) });
    bucket.push(row);
    console.log([tag, name.padEnd(28), String(t.shown).padStart(6), String(t.settled).padStart(6), (row.errors.length + row.consoleErrors.length) ? 'ERR ' + (row.errors[0] || row.consoleErrors[0]).slice(0, 80) : '', (row.bad || []).length ? 'SAYS ' + row.bad[0].slice(0, 60) : '', (row.small || []).length ? 'SMALL ' + row.small.length : '', row.signedOut ? 'SIGNED OUT' : '', row.sideways ? 'SIDEWAYS' : '', row.landed && row.landed.split('?')[0] !== url.split(/[?#]/)[0] ? '-> ' + row.landed : ''].filter(Boolean).join(' '));
    await page.done();
    save();
  }
}

async function captureAfter(label) {
  const page = await newPage();
  const out = { label, screens: [] };
  for (const url of AFTER) {
    try {
      const t = await open(page, url);
      const l = await look(page);
      out.screens.push({ url, settledMs: t.settled, nums: l.nums, tiles: l.tiles, rows: l.rows, bad: l.bad, text: l.text.slice(0, 1200), shot: await shot(page, 'after-' + slug(label) + '-' + slug(url)) });
    } catch (e) { out.screens.push({ url, error: String(e.message).slice(0, 200) }); }
  }
  out.errors = page.w.errors.slice(0, 10);
  report.after.push(out);
  await page.done();
  save();
}

// One write: what was done, how long until the screen showed it, the server calls it made, and the result.
async function write(name, fn) {
  const page = await newPage();
  const rec = { name, ok: false, steps: [] };
  const t0 = Date.now();
  try {
    await fn(page, rec);
    rec.ok = true;
  } catch (e) { rec.error = String(e.message).split('\n')[0].slice(0, 300); }
  rec.totalMs = Date.now() - t0;
  rec.calls = page.w.calls.filter(c => c.fn === 'save' || c.fn === 'phone' || c.fn === 'admin' || c.error);
  rec.errors = page.w.errors.concat(page.w.console).slice(0, 8);
  rec.shot = await shot(page, 'write-' + slug(name));
  report.writes.push(rec);
  console.log('WRITE ' + name + ': ' + (rec.ok ? 'ok' : 'FAILED ' + rec.error) + ' ' + rec.steps.map(s => s.what + ' ' + s.ms + 'ms').join(', '));
  await page.done();
  save();
  return rec;
}
// Times one press until the screen shows it.
async function timed(page, rec, what, act, until, timeout) {
  const t = Date.now();
  await act();
  await page.waitForFunction(until.fn, until.arg, { timeout: timeout || 15000 });
  const ms = Date.now() - t;
  rec.steps.push({ what, ms });
  return ms;
}
const plusMinutes = (text, add) => {
  const m = String(text).match(/(\d{1,2}):(\d{2})\s*([AP])M/i);
  if (!m) return { next: '3:05 PM', back: '' };
  let mins = (Number(m[1]) % 12) * 60 + Number(m[2]) + (/p/i.test(m[3]) ? 720 : 0) + add;
  mins = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(mins / 60), mm = String(mins % 60).padStart(2, '0');
  return { next: ((h % 12) || 12) + ':' + mm + ' ' + (h < 12 ? 'AM' : 'PM'), back: m[0] };
};

async function writes() {
  // Loadout Center: Start, then End, on the first load not started; then put it back to Not started.
  let loadRoute = '';
  await write('Loadout Start and End', async (p, rec) => {
    await open(p, 'loadout.html');
    const sel = await p.evaluate(() => {
      // A load of this day: a left-over from yesterday leaves the list once it is done, so it cannot be put back.
      let prior = false;
      const today = [...document.querySelectorAll('#rows tr')].filter(t => { if (t.classList.contains('divider')) { prior = t.classList.contains('prior'); return false; } return !prior && t.dataset.row; });
      const tr = today.find(t => !t.classList.contains('loading') && !t.classList.contains('done') && t.querySelector('button.clock:not([disabled])'));
      return tr ? { row: tr.dataset.row, route: tr.children[0].textContent.trim() } : null;
    });
    if (!sel) throw new Error('no load to start today');
    loadRoute = sel.route; rec.load = sel;
    const row = 'tr[data-row="' + sel.row + '"]';
    await timed(p, rec, 'Start', () => p.click(row + ' button.clock'), { fn: (s) => { const t = document.querySelector(s); return t && t.classList.contains('loading'); }, arg: row });
    await p.waitForSelector(row + ' button.clock.end', { timeout: 10000 });
    await timed(p, rec, 'End', () => p.click(row + ' button.clock'), { fn: (s) => { const t = document.querySelector(s); return t && t.classList.contains('done'); }, arg: row });
    rec.shown = await p.evaluate(s => document.querySelector(s).innerText.replace(/\s+/g, ' '), row);
  });
  await captureAfter('after Loadout Start and End' + (loadRoute ? ' (route ' + loadRoute + ')' : ''));
  await write('Loadout put back to Not started', async (p, rec) => {
    await open(p, 'loadout.html');
    const r = report.writes[report.writes.length - 1].load;
    if (!r) throw new Error('nothing to put back');
    const row = 'tr[data-row="' + r.row + '"]';
    await p.click(row + ' button.state');
    await timed(p, rec, 'Not started', () => p.click('#state-pop [data-s="NOT_STARTED"]'), { fn: (s) => { const t = document.querySelector(s); return t && !t.classList.contains('done') && !t.classList.contains('loading'); }, arg: row });
  });

  // Skip on the next load not started.
  await write('Loadout Skip', async (p, rec) => {
    await open(p, 'loadout.html');
    const sel = await p.evaluate(() => {
      // A load with no Skipped/Moved tag yet, so the new tag (who and when) can be read.
      // The next load must not be one skipped earlier either: skipping past it would only put both back in their own order (no tag).
      const all = [...document.querySelectorAll('#rows tr[data-row]')];
      const tr = all.find((t, i) => !t.classList.contains('loading') && !t.classList.contains('done') && t.querySelector('button.skip') && !t.querySelector('.moved-tag') && all[i + 1] && !all[i + 1].querySelector('.moved-tag') && !all[i + 1].classList.contains('moved'));
      return tr ? { row: tr.dataset.row, route: tr.children[0].textContent.trim(), order: [...document.querySelectorAll('#rows tr[data-row]')].map(x => x.children[0].textContent.trim()).join(' ') } : null;
    });
    if (!sel) throw new Error('no load to skip');
    rec.load = sel;
    const row = 'tr[data-row="' + sel.row + '"]';
    await timed(p, rec, 'Skip', () => p.click(row + ' button.skip'), { fn: (s) => /SKIPPED/.test((document.querySelector(s + ' .moved-tag') || {}).textContent || ''), arg: row });
    await p.waitForTimeout(3000);
    rec.tag = await p.evaluate(s => { const t = document.querySelector(s + ' .moved-tag'); return t ? t.textContent + ' | ' + t.title : ''; }, row);
    rec.orderAfter = await p.evaluate(() => [...document.querySelectorAll('#rows tr[data-row]')].map(x => x.children[0].textContent.trim()).join(' '));
  });
  await captureAfter('after Loadout Skip');

  // Daily Dispatch: a depart time 5 minutes later, then back.
  for (const [label, add] of [['Daily depart time +5 min', 5], ['Daily depart time put back', -5]]) {
    await write(label, async (p, rec) => {
      await open(p, 'daily.html');
      const prev = report.writes.find(w => w.name === 'Daily depart time +5 min');
      const id = add > 0 ? await p.evaluate(() => { const td = [...document.querySelectorAll('#rows tr[data-id]:not(.off) td[data-edit="time"]')].find(t => /\d:\d\d/.test(t.textContent)); return td ? td.closest('tr').dataset.id : ''; }) : (prev && prev.rowId);
      if (!id) throw new Error('no row with a depart time');
      const cell = 'tr[data-id="' + id + '"] td[data-edit="time"]';
      const before = await p.textContent(cell);
      const { next } = plusMinutes(before, add);
      Object.assign(rec, { rowId: id, route: await p.evaluate(s => document.querySelector(s).closest('tr').children[0].textContent.trim(), cell), before, typed: next });
      await p.dblclick(cell);
      await p.waitForTimeout(150);
      await p.keyboard.press('Control+A');
      await p.keyboard.type(next);
      await timed(p, rec, 'Enter', () => p.keyboard.press('Enter'), { fn: ([s, v]) => (document.querySelector(s) || {}).textContent.replace(/\s+/g, ' ').includes(v.replace(/^0/, '')), arg: [cell, next] });
      rec.after = await p.textContent(cell);
    });
    if (add > 0) await captureAfter('after Daily depart time +5 min');
  }

  // Weekly Dispatch: another driver on a load today, then the first driver back.
  for (const back of [false, true]) {
    await write(back ? 'Weekly driver put back' : 'Weekly driver change', async (p, rec) => {
      await open(p, 'weekly.html');
      const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(Date.now() - 6 * 3600000 - 4 * 3600000).getUTCDay()];
      const prev = report.writes.find(w => w.name === 'Weekly driver change');
      const cellSel = back && prev ? prev.cell : await p.evaluate(d => {
        // A driver on only one load today: a driver booked twice drops out of the list once moved off, so he could not be put back.
        const cells = [...document.querySelectorAll('tr td.day.editable[data-day="' + d + '"]')].filter(t => t.textContent.trim() && !/not running|off|carrier|plant load/i.test(t.textContent));
        const name = (t) => (t.firstChild && t.firstChild.textContent || t.textContent).trim().toUpperCase();
        const td = cells.find(t => cells.filter(x => name(x) === name(t)).length === 1);
        if (!td) return '';
        const tr = td.closest('tr'); tr.dataset.auditRow = '1';
        return tr.dataset.index !== undefined ? 'tr[data-index="' + tr.dataset.index + '"] td[data-day="' + d + '"]' : '';
      }, day);
      if (!cellSel) throw new Error('no driver cell for today found');
      rec.cell = cellSel;
      rec.before = await p.textContent(cellSel);
      await p.click(cellSel);
      await p.waitForSelector('.popover select[data-kind="driver"]', { timeout: 8000 });
      const pick = await p.evaluate(([b, want]) => {
        const s = document.querySelector('.popover select[data-kind="driver"]');
        const opts = [...s.options].filter(o => o.value);
        const o = want ? opts.find(x => x.value === want) : opts.find(x => x.value !== s.value && !/PLANT LOAD|not running/i.test(x.textContent));
        return { now: s.value, value: o ? o.value : '', text: o ? o.textContent.trim() : '' };
      }, [back, back && prev ? prev.was : '']);
      if (!pick.value) throw new Error(back ? 'the first driver is not in the driver list' : 'no other driver to pick');
      if (!back && !pick.now) throw new Error('the driver on this load is not in the driver list');
      Object.assign(rec, { was: pick.now, picked: pick.text });
      await timed(p, rec, 'pick driver', () => p.selectOption('.popover select[data-kind="driver"]', pick.value), { fn: ([s, b]) => (document.querySelector(s) || {}).textContent !== b, arg: [cellSel, rec.before] }, 12000);
      rec.after = await p.textContent(cellSel);
    });
    if (!back) await captureAfter('after Weekly driver change');
  }

  // Route Editor, Start Times: a start time 5 minutes later on the first route today, then back.
  for (const [label, add] of [['Route Editor start time +5 min', 5], ['Route Editor start time put back', -5]]) {
    await write(label, async (p, rec) => {
      await open(p, 'routes.html');
      await p.selectOption('#view-select', 'times');
      await p.waitForTimeout(800);
      const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(Date.now() - 10 * 3600000).getUTCDay()];
      const prev = report.writes.find(w => w.name === 'Route Editor start time +5 min');
      const run = add > 0 ? await p.evaluate(d => { const i = [...document.querySelectorAll('table.routes tbody tr[data-id] input.cell[data-day="' + d + '"]')].find(x => /\d:\d\d/.test(x.value)); return i ? i.closest('tr').dataset.id : ''; }, day) : (prev && prev.run);
      if (!run) throw new Error('no route with a start time today');
      const cell = 'tr[data-id="' + run + '"] input.cell[data-day="' + day + '"]';
      const before = await p.inputValue(cell);
      const { next } = plusMinutes(before, add);
      Object.assign(rec, { run, day, route: await p.evaluate(s => document.querySelector(s).closest('tr').children[0].textContent.trim(), cell), before, typed: next });
      await p.click(cell);
      await p.keyboard.press('Control+A');
      await p.keyboard.type(next);
      const t = Date.now();
      await p.keyboard.press('Tab');
      await p.waitForFunction(() => window.__lastSaveDone !== undefined || true);
      // Auto-save: wait for the save call to answer.
      for (let i = 0; i < 60 && !p.w.calls.some(c => c.fn === 'save' && c.at >= t); i++) await p.waitForTimeout(250);
      rec.steps.push({ what: 'auto-save answered', ms: Date.now() - t });
      rec.after = await p.inputValue(cell);
    });
    if (add > 0) await captureAfter('after Route Editor start time +5 min');
  }

  // Daily Box Loadout: Start / End times on the first box load, then back.
  await write('Box load Start and End times', async (p, rec) => {
    await open(p, 'loadout.html?area=BOXING');
    const row = await p.evaluate(() => { const b = document.querySelector('#rows tr[data-row] [data-sedit]'); return b ? b.closest('tr').dataset.row : ''; });
    if (!row) throw new Error('no box load to edit');
    const sel = 'tr[data-row="' + row + '"]';
    rec.row = row;
    await p.click(sel + ' [data-sedit]');
    await p.waitForSelector('#sched-modal:not([hidden])');
    rec.before = { start: await p.inputValue('#s-start'), end: await p.inputValue('#s-end') };
    // Times already past: the box says "That time has not come yet" for a later one.
    const clock = (ago) => new Date(Date.now() - ago * 60000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
    rec.typed = { start: clock(40), end: clock(5) };
    await p.fill('#s-start', rec.typed.start);
    await p.fill('#s-end', rec.typed.end);
    await timed(p, rec, 'Save times', () => p.click('#s-save'), { fn: (s) => { const m = document.getElementById('sched-modal'); return m && m.hidden && !!document.querySelector(s + ' button.state.done'); }, arg: sel });
    rec.after = await p.evaluate(s => document.querySelector(s).innerText.replace(/\s+/g, ' '), sel);
    // Put back.
    await p.click(sel + ' [data-sedit]');
    await p.waitForSelector('#sched-modal:not([hidden])');
    await p.fill('#s-start', rec.before.start);
    await p.fill('#s-end', rec.before.end);
    await timed(p, rec, 'Put back', () => p.click('#s-save'), { fn: () => { const m = document.getElementById('sched-modal'); return m && m.hidden; } });
  });

  // Ended Up Not Running on one load not started (two presses), then what Weekly and the plant show.
  await write('Ended Up Not Running', async (p, rec) => {
    await open(p, 'loadout.html');
    const sel = await p.evaluate(() => {
      // A dispatch load (Scheduler loads, row ids sch:..., open their own Edit Load box, which has Delete Load instead).
      const trs = [...document.querySelectorAll('#rows tr[data-row]')].filter(t => !/^sch:/.test(t.dataset.row) && !t.classList.contains('loading') && !t.classList.contains('done') && t.querySelector('button.edit-row'));
      const tr = trs[trs.length - 1];
      return tr ? { row: tr.dataset.row, route: tr.children[0].textContent.trim(), text: tr.innerText.replace(/\s+/g, ' ') } : null;
    });
    if (!sel) throw new Error('no load to mark');
    rec.load = sel;
    const row = 'tr[data-row="' + sel.row + '"]';
    await p.click(row + ' button.edit-row');
    await p.waitForSelector('#edit-modal:not([hidden])');
    await p.click('#edit-notrunning');
    await timed(p, rec, 'Ended Up Not Running (second press)', () => p.click('#edit-notrunning'), { fn: (s) => !document.querySelector(s) || document.getElementById('edit-modal').hidden, arg: row });
  });
  await captureAfter('after Ended Up Not Running');

  // Yard check: a temperature on the first trailer in the yard.
  await write('Yard check temperature', async (p, rec) => {
    await open(p, 'yard.html');
    const t = await p.evaluate(() => { const r = document.querySelector('#rows tr[data-trailer]'); return r ? r.dataset.trailer : ''; });
    if (!t) { rec.skipped = 'no trailer due for a yard check right now'; return; }
    rec.trailer = t;
    const row = '#rows tr[data-trailer="' + t + '"]';
    rec.before = await p.evaluate(() => (document.getElementById('hstats') || {}).textContent || '');
    await p.fill(row + ' .yd-temp', '35');
    await timed(p, rec, 'temperature saved', () => p.keyboard.press('Tab'), { fn: (s) => /Saved|\d/.test(((document.querySelector(s + ' .yd-tick') || {}).textContent || '')) || !document.querySelector(s), arg: row });
    await p.waitForTimeout(1500);
    rec.after = await p.evaluate(() => (document.getElementById('hstats') || {}).textContent || '');
  });

  // Cooler temperature: a reading on the first cooler.
  await write('Cooler temperature reading', async (p, rec) => {
    await open(p, 'temps.html');
    const ok = await p.$('.tp-manual');
    if (!ok) throw new Error('no cooler to enter a reading for');
    // A reading different from the one in the box (the same number again saves nothing).
    const was = await p.inputValue('.tp-manual >> nth=0');
    rec.typed = was === '36' ? '37' : '36';
    await p.fill('.tp-manual >> nth=0', rec.typed);
    const t = Date.now();
    await p.keyboard.press('Tab');
    for (let i = 0; i < 40 && !p.w.calls.some(c => c.at >= t); i++) await p.waitForTimeout(250);
    if (!p.w.calls.some(c => c.at >= t)) throw new Error('the reading was not saved within 10 seconds');
    rec.steps.push({ what: 'reading saved', ms: Date.now() - t });
  });

  // Shift note.
  await write('Shift note', async (p, rec) => {
    await open(p, 'shiftnotes.html');
    const box = await p.$('.sn-entry');
    if (!box) throw new Error('no shift note box');
    await box.fill('Practice copy test note');
    const t = Date.now();
    await p.keyboard.press('Tab');
    for (let i = 0; i < 40 && !p.w.calls.some(c => c.at >= t); i++) await p.waitForTimeout(250);
    rec.steps.push({ what: 'note saved', ms: Date.now() - t });
  });
}

(async () => {
  browser = await chromium.launch();
  try {
    const only = (process.env.ONLY || '').split(',').filter(Boolean);
    const pick = (list) => list.filter(([, u]) => !only.length || only.includes(u));
    await captureAfter('before any write');
    await readPass(pick(SCREENS), { viewport: { width: 1536, height: 790 } }, report.screens, 'r1536');
    await readPass(pick(SCREENS.filter(([, u]) => WIDE.includes(u))), { viewport: { width: 1920, height: 950 } }, report.wide, 'r1920');
    await readPass(pick(SCREENS.filter(([, u]) => PHONE.includes(u))), { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, report.phone, 'r390');
    await readPass(pick(SCREENS.filter(([, u]) => TABLET.includes(u))), { viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true }, report.tablet, 'r1024');
    // Second open of the busiest screens, to see the spread (single runs swing by as much as 2x).
    const again = [];
    await readPass(pick(SCREENS.filter(([, u]) => ['distribution.html', 'daily.html', 'weekly.html', 'loadout.html', 'forecast.html', 'manager.html', 'plant.html'].includes(u))), { viewport: { width: 1536, height: 790 } }, again, 'r1536b');
    report.again = again.map(r => ({ url: r.url, shownMs: r.shownMs, settledMs: r.settledMs }));
    if (process.env.NO_WRITES !== '1') await writes();
  } finally {
    report.endedAt = new Date().toISOString();
    save();
    await browser.close();
  }
})().catch(e => { console.error(e); save(); process.exit(1); });
