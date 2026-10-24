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
 *      Daily depart time, Weekly driver, Route Editor start time, Box load times, Yard check, Cooler temperature, Quality check, Shift note.
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
  ['Upload / Data', 'data/'], ['Ops screen', 'ops.html'],
  // 6.54: Case Counters, the Administration pages that now save as each box changes (batch 5), and Fleet Service Setup.
  ['Case Counters', 'administration.html?item=case-counters'], ['Role Templates', 'administration.html?item=role-templates'],
  ['Repair Email', 'administration.html?item=repair-email'], ['Email Senders', 'administration.html?item=email-senders'],
  ['Manager Report Recipients', 'administration.html?item=report-recipients'], ['Driver Check-In Email', 'administration.html?item=checkin-email'],
  ['Refresh Rates', 'administration.html?item=refresh-rates'], ['Go-Live Switches', 'administration.html?item=switch'],
  ['Dispatch Administration (Administration)', 'administration.html?item=dispatch-admin'], ['Fleet Service Setup', 'fleet.html?view=setup'],
  // 6.57: the Blow Mold tablet and its targets.
  ['Blow Mold', 'line.html?line=ut_prod_blow_mold'], ['Blow Mold Targets', 'linetargets.html?line=ut_prod_blow_mold']
].filter((s, i, a) => a.findIndex(x => x[1] === s[1]) === i && s[1] !== 'data/');
const WIDE = ['maint.html', 'scorecard.html', 'walkthrough.html', 'line.html?line=ut_prod_blow_mold', 'index.html', 'distribution.html', 'daily.html', 'weekly.html', 'routes.html', 'loadout.html', 'loadout.html?area=BOXING', 'forecast.html', 'plant.html', 'manager.html', 'yard.html', 'trucks.html', 'issues.html', 'garage.html', 'administration.html'];
const PHONE = ['weekly.html', 'maint.html', 'walkthrough.html', 'route.html', 'yard.html', 'quality.html', 'temps.html', 'index.html', 'loadout.html'];
const TABLET = ['weekly.html', 'plant-station.html', 'loadout.html', 'yard.html', 'washing.html', 'unloading.html', 'driver-room.html'];
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
    // The rows drawn first (a quiet blank page before the app starts drawing once read as no loads).
    await p.waitForSelector('#rows tr[data-row]', { timeout: 20000 }).catch(() => {});
    const sel = await p.evaluate(() => {
      // A load with no Skipped/Moved tag yet, so the new tag (who and when) can be read.
      // The next load must not be one skipped earlier either: skipping past it would only put both back in their own order (no tag).
      // Nor the load just under a skipped one: that skip moved it up, so skipping it only puts it back (no tag, as since 6.47).
      const all = [...document.querySelectorAll('#rows tr[data-row]')];
      const tr = all.find((t, i) => !t.classList.contains('loading') && !t.classList.contains('done') && t.querySelector('button.skip') && !t.querySelector('.moved-tag') && all[i + 1] && !all[i + 1].querySelector('.moved-tag') && !all[i + 1].classList.contains('moved') && !(all[i - 1] && all[i - 1].querySelector('.moved-tag')));
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
    // The rows drawn first (a quiet blank page before the app starts drawing once read as no loads).
    await p.waitForSelector('#rows tr[data-row]', { timeout: 20000 }).catch(() => {});
    const edits = () => p.evaluate(() => [...document.querySelectorAll('#rows tr[data-row] [data-sedit]')].map(b => b.closest('tr').dataset.row));
    let row = (await edits())[0] || '';
    // Joe: never skip a check. A day with no Scheduler box load to edit gets one of its own (+ Add Load), deleted at the end.
    if (!row) {
      const had = await edits();
      await p.click('#add-load');
      await p.waitForSelector('#sched-modal:not([hidden]) #s-route');
      const pick = await p.$$eval('#s-route option', o => (o.find(x => x.value !== '') || {}).value);
      if (pick === undefined) throw new Error('Add Load offers no route / run');
      await p.selectOption('#s-route', pick);
      await p.selectOption('#s-kind', 'BOXING');
      await p.selectOption('#s-type', 'ROUTE');
      if (!(await p.inputValue('#s-time'))) await p.fill('#s-time', '23:30');
      await p.fill('#s-notes', 'Practice copy test load (deleted by the test)');
      await p.click('#s-save');
      await p.waitForSelector('#sched-confirm-modal:not([hidden]) #sc-confirm', { timeout: 8000 });
      await timed(p, rec, 'Add Load', () => p.click('#sc-confirm'), { fn: (n) => document.querySelectorAll('#rows tr[data-row] [data-sedit]').length > n, arg: had.length }, 20000);
      row = (await edits()).find(r => !had.includes(r)) || '';
      if (!row) throw new Error('the added box load did not show');
      rec.added = row;
    }
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
    if (rec.added) {
      // The test's own load comes off again: Delete Load, pressed twice.
      await p.click(sel + ' [data-sedit]');
      await p.waitForSelector('#sched-modal:not([hidden]) #s-delete:not([hidden])');
      await p.click('#s-delete');
      await timed(p, rec, 'Delete Load', () => p.click('#s-delete'), { fn: (s) => !document.querySelector(s), arg: sel });
      const t = Date.now();
      for (let i = 0; i < 40 && !p.w.calls.some(c => c.at >= t - 3000 && c.op === 'savePlantSchedule'); i++) await p.waitForTimeout(250);
    }
    const bad = p.w.calls.filter(c => c.status !== 200 || c.error);
    if (bad.length) throw new Error('a save answered ' + bad[0].status + ' ' + bad[0].error.slice(0, 150));
  });

  // Ended Up Not Running on one load not started (two presses), then what Weekly and the plant show.
  await write('Ended Up Not Running', async (p, rec) => {
    await open(p, 'loadout.html');
    // The rows drawn first (a quiet blank page before the app starts drawing once read as no loads).
    await p.waitForSelector('#rows tr[data-row]', { timeout: 20000 }).catch(() => {});
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
    await p.waitForFunction(() => !/Loading the trailers/.test((document.getElementById('rows') || {}).textContent || ''), null, { timeout: 20000 });
    let t = await p.evaluate(() => { const r = document.querySelector('#rows tr[data-trailer] .yd-temp:not([disabled])'); return r ? r.closest('tr').dataset.trailer : ''; });
    // Joe: never skip a check. With no trailer due, the test loads one itself (practice copy only): a load of today not started
    // gets a test trailer (99 + the minute of the day, so a run within 2 hours of the last one never hits its 2-hour lock), Start and
    // End; the check is made on it; then the load goes back to Not started with its own trailer.
    let made = null;
    const now = new Date(), num = '99' + String(now.getUTCHours() * 60 + now.getUTCMinutes()).padStart(4, '0'), tt = 'T-' + num;
    if (!t) {
      await open(p, 'loadout.html');
      await p.waitForSelector('#rows tr[data-row]', { timeout: 20000 });
      made = await p.evaluate(() => {
        let prior = false;
        const today = [...document.querySelectorAll('#rows tr')].filter(x => { if (x.classList.contains('divider')) { prior = x.classList.contains('prior'); return false; } return !prior && x.dataset.row && !/^sch:/.test(x.dataset.row); });
        const ok = today.filter(x => !x.classList.contains('loading') && !x.classList.contains('done') && x.querySelector('button.clock:not([disabled])') && x.querySelector('input[data-k="trailer"]:not([disabled])'));
        const tr = ok[ok.length - 1];
        return tr ? { row: tr.dataset.row, route: tr.children[0].textContent.trim(), trailer: tr.querySelector('input[data-k="trailer"]').value } : null;
      });
      if (!made) throw new Error('no trailer due, and no load of today to load a trailer on');
      rec.made = made;
      const row = 'tr[data-row="' + made.row + '"]';
      await p.fill(row + ' input[data-k="trailer"]', num);
      await p.press(row + ' input[data-k="trailer"]', 'Enter');
      await p.waitForFunction(([s, a, b]) => { const v = (document.querySelector(s + ' input[data-k="trailer"]') || {}).value; return v === a || v === b; }, [row, tt, num], { timeout: 10000 });
      await p.waitForTimeout(1500);
      await timed(p, rec, 'Start', () => p.click(row + ' button.clock'), { fn: (s) => { const x = document.querySelector(s); return x && x.classList.contains('loading'); }, arg: row });
      await p.waitForSelector(row + ' button.clock.end', { timeout: 10000 });
      await timed(p, rec, 'End', () => p.click(row + ' button.clock'), { fn: (s) => { const x = document.querySelector(s); return x && x.classList.contains('done'); }, arg: row });
      await open(p, 'yard.html');
      await p.waitForSelector('#rows tr[data-trailer="' + tt + '"] .yd-temp:not([disabled])', { timeout: 30000 }).catch(() => {});
      t = (await p.$('#rows tr[data-trailer="' + tt + '"] .yd-temp:not([disabled])')) ? tt : '';
      if (!t) rec.yardShows = await p.evaluate(() => document.getElementById('rows').innerText.replace(/\s+/g, ' ').slice(0, 200));
    }
    let err = '';
    try {
      if (!t) throw new Error('the loaded trailer ' + tt + ' did not come up due on Yard Checks');
      rec.trailer = t;
      const row = '#rows tr[data-trailer="' + t + '"]';
      rec.before = await p.evaluate(() => (document.getElementById('hstats') || {}).textContent || '');
      await p.fill(row + ' .yd-temp', '35');
      const t0 = Date.now();
      await timed(p, rec, 'temperature saved', () => p.keyboard.press('Tab'), { fn: (s) => /\d/.test(((document.querySelector(s + ' .yd-tick') || {}).textContent || '')), arg: row }, 20000);
      for (let i = 0; i < 40 && !p.w.calls.some(c => c.at >= t0 && c.status); i++) await p.waitForTimeout(250);
      const bad = p.w.calls.filter(c => c.at >= t0 && (c.status !== 200 || c.error));
      if (bad.length) throw new Error('the check answered ' + bad[0].status + ' ' + bad[0].error.slice(0, 150));
      if (/Not saved/.test(await p.textContent(row))) throw new Error('the check shows Not saved');
      await p.waitForTimeout(1500);
      rec.after = await p.evaluate(() => (document.getElementById('hstats') || {}).textContent || '');
      await shot(p, 'yard-check');
    } catch (e) { err = e.message; }
    if (made) {
      // Put back: Not started, and the load's own trailer again.
      await open(p, 'loadout.html');
      const row = 'tr[data-row="' + made.row + '"]';
      await p.waitForSelector(row, { timeout: 20000 });
      await p.click(row + ' button.state');
      await timed(p, rec, 'put back Not started', () => p.click('#state-pop [data-s="NOT_STARTED"]'), { fn: (s) => { const x = document.querySelector(s); return x && !x.classList.contains('done') && !x.classList.contains('loading'); }, arg: row });
      await p.fill(row + ' input[data-k="trailer"]', made.trailer);
      await p.press(row + ' input[data-k="trailer"]', 'Enter');
      await p.waitForTimeout(2000);
      await open(p, 'loadout.html');
      await p.waitForSelector(row, { timeout: 20000 });
      rec.putBack = await p.evaluate((s) => ({ trailer: document.querySelector(s + ' input[data-k="trailer"]').value, done: document.querySelector(s).classList.contains('done') }), row);
      if (rec.putBack.done || rec.putBack.trailer.replace(/^T-/, '') !== made.trailer.replace(/^T-/, '')) err = (err ? err + '; ' : '') + 'the load was not put back: ' + JSON.stringify(rec.putBack);
    }
    if (err) throw new Error(err);
  });

  // 6.60: a trailer checked, then reloaded on another load within 2 hours, shows Due and its check saves (the 2-hour lock counts
  // only checks made after its current load was loaded). Practice copy only; both loads go back to Not started with their own trailers.
  await write('Yard check on a reloaded trailer', async (p, rec) => {
    const now = new Date(), num = '98' + String(now.getUTCHours() * 60 + now.getUTCMinutes()).padStart(4, '0'), tt = 'T-' + num;
    rec.trailer = tt;
    await open(p, 'loadout.html');
    await p.waitForSelector('#rows tr[data-row]', { timeout: 20000 });
    const picks = await p.evaluate(() => {
      let prior = false;
      const today = [...document.querySelectorAll('#rows tr')].filter(x => { if (x.classList.contains('divider')) { prior = x.classList.contains('prior'); return false; } return !prior && x.dataset.row && !/^sch:/.test(x.dataset.row); });
      return today.filter(x => !x.classList.contains('loading') && !x.classList.contains('done') && x.querySelector('button.clock:not([disabled])') && x.querySelector('input[data-k="trailer"]:not([disabled])'))
        .slice(-2).map(tr => ({ row: tr.dataset.row, route: tr.children[0].textContent.trim(), trailer: tr.querySelector('input[data-k="trailer"]').value }));
    });
    if (picks.length < 2) throw new Error('need two loads of today not started, found ' + picks.length);
    rec.loads = picks;
    const load = async (x, step) => {
      await open(p, 'loadout.html');
      const row = 'tr[data-row="' + x.row + '"]';
      await p.waitForSelector(row, { timeout: 20000 });
      await p.fill(row + ' input[data-k="trailer"]', num);
      await p.press(row + ' input[data-k="trailer"]', 'Enter');
      await p.waitForTimeout(1500);
      await timed(p, rec, step + ' Start', () => p.click(row + ' button.clock'), { fn: (s) => { const e = document.querySelector(s); return e && e.classList.contains('loading'); }, arg: row });
      await p.waitForSelector(row + ' button.clock.end', { timeout: 10000 });
      await timed(p, rec, step + ' End', () => p.click(row + ' button.clock'), { fn: (s) => { const e = document.querySelector(s); return e && e.classList.contains('done'); }, arg: row });
    };
    const putBack = async (x, step) => {
      await open(p, 'loadout.html');
      const row = 'tr[data-row="' + x.row + '"]';
      await p.waitForSelector(row, { timeout: 20000 });
      await p.click(row + ' button.state');
      await timed(p, rec, step + ' back to Not started', () => p.click('#state-pop [data-s="NOT_STARTED"]'), { fn: (s) => { const e = document.querySelector(s); return e && !e.classList.contains('done') && !e.classList.contains('loading'); }, arg: row });
      await p.fill(row + ' input[data-k="trailer"]', x.trailer);
      await p.press(row + ' input[data-k="trailer"]', 'Enter');
      await p.waitForTimeout(2000);
    };
    const check = async (step, temp) => {
      await open(p, 'yard.html');
      const row = '#rows tr[data-trailer="' + tt + '"]';
      await p.waitForSelector(row + ' .yd-temp:not([disabled])', { timeout: 30000 }).catch(() => {});
      if (!(await p.$(row + ' .yd-temp:not([disabled])'))) throw new Error(step + ': ' + tt + ' did not come up due on Yard Checks');
      await p.fill(row + ' .yd-temp', temp);
      const t0 = Date.now();
      await p.keyboard.press('Tab');
      for (let i = 0; i < 60 && !p.w.calls.some(c => c.at >= t0 && c.op === 'saveYardCheck'); i++) await p.waitForTimeout(250);
      const c = p.w.calls.find(x => x.at >= t0 && x.op === 'saveYardCheck');
      if (!c) throw new Error(step + ': the check was not sent');
      if (c.status !== 200 || c.error) throw new Error(step + ': the check answered ' + c.status + ' ' + c.error.slice(0, 200));
      rec.steps.push({ what: step + ' check saved', ms: Date.now() - t0 });
      await p.waitForTimeout(1500);
      if (/Not saved/.test(await p.textContent(row))) throw new Error(step + ': the check shows Not saved');
    };
    let err = '';
    try {
      await load(picks[0], 'first load');
      await check('first load', '35');
      await putBack(picks[0], 'first load');
      // Load times are kept to the minute: a reload in the same minute as the check cannot be told apart from before it. A real
      // reload is minutes later, so wait into the next minute.
      const checkedAt = Date.now() - 4000;
      while (Math.floor(Date.now() / 60000) <= Math.floor(checkedAt / 60000)) await p.waitForTimeout(1000);
      await p.waitForTimeout(3000);
      await load(picks[1], 'reloaded');
      await check('reloaded', '36');
      await shot(p, 'yard-reloaded');
    } catch (e) { err = e.message; }
    for (const [x, step] of [[picks[0], 'first load'], [picks[1], 'reloaded']]) {
      try { await putBack(x, step); } catch (e) { err = (err ? err + '; ' : '') + step + ' put back: ' + e.message.split('\n')[0]; }
    }
    await open(p, 'loadout.html');
    rec.putBack = await p.evaluate((xs) => xs.map(x => { const tr = document.querySelector('tr[data-row="' + x.row + '"]'); return tr ? { route: x.route, trailer: tr.querySelector('input[data-k="trailer"]').value, was: x.trailer, done: tr.classList.contains('done') || tr.classList.contains('loading') } : { route: x.route, missing: true }; }), picks);
    const wrong = rec.putBack.filter(x => x.missing || x.done || x.trailer.replace(/^T-/, '') !== x.was.replace(/^T-/, ''));
    if (wrong.length) err = (err ? err + '; ' : '') + 'not put back: ' + JSON.stringify(wrong);
    if (err) throw new Error(err);
  });

  // 6.53: Yard Checks > All Trailers in Yard (look only) lists every loaded trailer still on the yard, and Trucks Today opens.
  await write('Yard Checks All Trailers in Yard tab', async (p, rec) => {
    await open(p, 'yard.html');
    await timed(p, rec, 'All Trailers in Yard', () => p.click('[data-pane="all"]'), { fn: () => { const b = document.getElementById('pane-all'), r = document.getElementById('all-rows'); return b && !b.hidden && r && r.children.length && !/Loading the trailers/.test(r.textContent); } });
    rec.rows = await p.evaluate(() => document.querySelectorAll('#all-rows tr[data-trailer]').length);
    rec.activeQueue = await p.evaluate(() => (document.getElementById('hstats') || {}).textContent || '');
    if (!/view=all/.test(p.url())) throw new Error('the tab did not stay picked in the address');
    await shot(p, 'yard-all-trailers');
    await p.click('[data-pane="current"]');
  });
  await write('Trucks Today opens', async (p, rec) => {
    await open(p, 'trucks.html');
    // The drivers table (or its "no GPS data" / "no runs" line) is drawn.
    await p.waitForFunction(() => document.querySelector('table tbody tr, .empty'), null, { timeout: 20000 });
    rec.rows = await p.evaluate(() => document.querySelectorAll('table tbody tr:not(.tt-events)').length);
    await shot(p, 'trucks-today');
  });

  // 6.54 batch 5: a box that saves when it is left or picked must answer, with no Save button. Each is put back after.
  const answered = async (p, t, what) => {
    for (let i = 0; i < 60 && !p.w.calls.some(c => c.at >= t && /^save/i.test(c.op)); i++) await p.waitForTimeout(250);
    const c = p.w.calls.find(x => x.at >= t && /^save/i.test(x.op));
    if (!c) throw new Error(what + ': nothing was saved');
    if (c.status !== 200 || c.error) throw new Error(what + ': the save answered ' + c.status + ' ' + c.error.slice(0, 150));
    return Date.now() - t;
  };
  await write('Fleet Service rule saves when left', async (p, rec) => {
    await open(p, 'fleet.html?view=setup');
    await p.waitForSelector('[data-rule]:not([disabled])', { timeout: 15000 });
    if (await p.$('#rules-save')) throw new Error('a Save Rules button is still there');
    const box = '[data-rule]:not([disabled]) >> nth=0';
    const was = await p.inputValue(box);
    rec.rule = await p.getAttribute(box, 'data-rule'); rec.was = was;
    await p.fill(box, String((Number(was) || 0) + 1000));
    let t = Date.now(); await p.keyboard.press('Tab');
    rec.steps.push({ what: 'rule saved', ms: await answered(p, t, 'rule') });
    await p.waitForTimeout(800);
    await p.fill(box, was);
    t = Date.now(); await p.keyboard.press('Tab');
    rec.steps.push({ what: 'rule put back', ms: await answered(p, t, 'rule put back') });
    const err = await p.evaluate(() => [...document.querySelectorAll('.error, .err, [role=alert]')].map(x => x.textContent.trim()).filter(Boolean).join(' | '));
    if (err) throw new Error('the page shows: ' + err.slice(0, 200));
  });
  await write('Refresh Rates saves when picked', async (p, rec) => {
    await open(p, 'administration.html?item=refresh-rates');
    await p.waitForSelector('#rr2-rows select[data-minutes]', { timeout: 20000 });
    const sel = '#rr2-rows select[data-minutes] >> nth=0';
    const job = await p.getAttribute(sel, 'data-minutes');
    const opts = await p.$$eval('#rr2-rows select[data-minutes]', (s) => [...s[0].options].map(o => o.value));
    const was = await p.inputValue(sel), other = opts.find(v => v !== was);
    rec.job = job; rec.was = was;
    if (!other) { rec.skipped = 'only one choice'; return; }
    let t = Date.now(); await p.selectOption(sel, other);
    rec.steps.push({ what: 'schedule saved', ms: await answered(p, t, 'schedule') });
    await p.waitForFunction((j) => { const x = document.querySelector('#rr2-rows select[data-minutes="' + j + '"]'); return x && !x.disabled; }, job, { timeout: 15000 });
    await p.waitForTimeout(800);
    t = Date.now(); await p.selectOption('#rr2-rows select[data-minutes="' + job + '"]', was);
    rec.steps.push({ what: 'schedule put back', ms: await answered(p, t, 'schedule put back') });
    await p.waitForTimeout(1500);
    rec.now = await p.inputValue('#rr2-rows select[data-minutes="' + job + '"]');
    if (rec.now !== was) throw new Error('the schedule did not go back to ' + was + ' (shows ' + rec.now + ')');
    const bad = await p.evaluate(() => [...document.querySelectorAll('.ap-msg:not([hidden])')].map(x => x.textContent.trim()).filter(Boolean).join(' | '));
    if (bad) throw new Error('the page shows: ' + bad.slice(0, 200));
  });
  // 6.54 case counter: the Counted column shows on Daily Case Loadout and Unloading & Washing only once a counter is set up.
  await write('Case counter columns (look only)', async (p, rec) => {
    await open(p, 'loadout.html?area=CASE');
    rec.loadoutCounted = await p.evaluate(() => [...document.querySelectorAll('thead th')].some(th => /Counted/.test(th.textContent) && th.offsetParent));
    await open(p, 'unloading.html');
    rec.unloadingCounted = await p.evaluate(() => { const h = document.getElementById('counted-head'); return !!(h && !h.hidden); });
    await open(p, 'administration.html?item=case-counters');
    await p.waitForFunction(() => { const l = document.getElementById('cc-list'); return l && l.children.length; }, null, { timeout: 20000 });
    rec.counters = await p.evaluate(() => document.getElementById('cc-list').innerText.replace(/\s+/g, ' ').slice(0, 300));
  });

  // 6.55: Weekly board Day Note (No Route) on a driver's free day, then put back to Available.
  await write('Weekly board Day Note', async (p, rec) => {
    await open(p, 'weekly.html#board');
    await p.waitForSelector('#board-rows td button', { timeout: 20000 });
    if (!/Day Note/.test(await p.textContent('#legend'))) throw new Error('the legend has no Day Note');
    const pick = await p.evaluate(() => {
      for (const tr of document.querySelectorAll('#board-rows tr[data-driver]')) {
        const tds = [...tr.children];
        for (let i = tds.length - 1; i > 0; i--) if (tds[i].textContent.trim() === 'AVAILABLE' && tds[i].querySelector('button')) return { driver: tr.dataset.driver, n: i + 1 };
      }
      return null;
    });
    if (!pick) { rec.skipped = 'no Available day on the board'; return; }
    const cell = '#board-rows tr[data-driver="' + pick.driver + '"] td:nth-child(' + pick.n + ')';
    const count = async () => { let last = await p.textContent('#count'), same = 0; for (let i = 0; i < 40 && same < 4; i++) { await p.waitForTimeout(250); const now = await p.textContent('#count'); same = now === last ? same + 1 : 0; last = now; } return last; };
    rec.countBefore = await count();
    await p.click(cell + ' button');
    await p.selectOption('#avail-reason', 'DAYNOTE');
    if (!(await p.isVisible('#daynote-help'))) throw new Error('the Day Note help line did not show');
    await p.fill('#avail-note', 'Practice test note');
    await timed(p, rec, 'Day Note shows', () => p.click('#avail-save'), { fn: (sel) => { const td = document.querySelector(sel); return td && td.classList.contains('b-daynote') && td.textContent.trim() === 'PRACTICE TEST NOTE'; }, arg: cell });
    rec.countAfter = await count();
    if (rec.countAfter !== rec.countBefore) throw new Error('Needs Driver count changed: ' + rec.countBefore + ' -> ' + rec.countAfter);
    await p.reload();
    await timed(p, rec, 'still there after reload', async () => {}, { fn: (sel) => { const td = document.querySelector(sel); return td && td.classList.contains('b-daynote'); }, arg: cell }, 20000);
    await shot(p, 'weekly-daynote');
    await p.click(cell + ' button');
    await p.selectOption('#avail-reason', 'AVAILABLE');
    await timed(p, rec, 'put back to Available', () => p.click('#avail-save'), { fn: (sel) => { const td = document.querySelector(sel); return td && td.textContent.trim() === 'AVAILABLE'; }, arg: cell });
    for (let i = 0; i < 20 && !p.w.calls.some(c => /dayoff|avail|exception|backup/i.test(c.op) || c.fn === 'save'); i++) await p.waitForTimeout(250);
    const bad = p.w.calls.filter(c => c.status !== 200 || c.error);
    if (bad.length) throw new Error('a save answered ' + bad[0].status + ' ' + bad[0].error.slice(0, 150));
    rec.carrierCells = await p.evaluate(() => [...document.querySelectorAll('#rows td')].filter(td => /CARRIER/.test(td.textContent)).length);
  });

  // 6.56: Driver Station TV (?tv=1) plays its silent keep-awake video behind the board.
  await write('Driver Station TV keep-awake video', async (p, rec) => {
    await open(p, 'driver-station.html?tv=1');
    await timed(p, rec, 'video playing', async () => {}, { fn: () => { const v = document.getElementById('ds-awake'); return v && !v.paused && v.muted && v.loop && v.currentTime > 0.5; } }, 20000);
    rec.board = await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 160));
    rec.videoBehind = await p.evaluate(() => { const v = document.getElementById('ds-awake'), r = v.getBoundingClientRect(), top = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return { w: Math.round(r.width), h: Math.round(r.height), coversBoard: top === v }; });
    if (rec.videoBehind.coversBoard) throw new Error('the video is in front of the board');
  });
  // 6.56: Email Senders keeps addresses typed quickly into several boxes; reload shows them all; then each box is put back.
  await write('Email Senders several boxes quickly', async (p, rec) => {
    const page = 'administration.html?item=email-senders';
    await open(p, page);
    await p.waitForSelector('#es-rows tr[data-plant] [data-addr]', { timeout: 20000 });
    const boxes = await p.$$eval('#es-rows tr[data-plant] [data-addr]', x => x.map(i => ({ plant: i.dataset.addr, was: i.value })));
    rec.plants = boxes.map(b => b.plant);
    const want = Object.fromEntries(boxes.map(b => [b.plant, 'practice.test.' + b.plant.replace(/^fac_/, '').replace(/_/g, '') + '@uniteddairy.com']));
    const fillAll = async (vals) => {
      const t = Date.now();
      for (const b of boxes) { await p.fill('[data-addr="' + b.plant + '"]', vals[b.plant]); await p.press('[data-addr="' + b.plant + '"]', 'Tab'); }
      // Every save answered.
      for (let i = 0; i < 80 && p.w.calls.filter(c => c.at >= t && c.op === 'saveEmailSenders').length < boxes.length; i++) await p.waitForTimeout(250);
      await p.waitForTimeout(2500);
      const bad = p.w.calls.filter(c => c.at >= t && (c.status !== 200 || c.error));
      if (bad.length) throw new Error('a save answered ' + bad[0].status + ' ' + bad[0].error.slice(0, 150));
      return Date.now() - t;
    };
    const check = async (vals, what) => {
      await open(p, page);
      await p.waitForSelector('#es-rows tr[data-plant] [data-addr]', { timeout: 20000 });
      const now = await p.$$eval('#es-rows tr[data-plant] [data-addr]', x => Object.fromEntries(x.map(i => [i.dataset.addr, i.value])));
      const lost = boxes.filter(b => now[b.plant] !== vals[b.plant]);
      if (lost.length) throw new Error(what + ': ' + lost.map(b => b.plant + ' shows "' + now[b.plant] + '"').join(', '));
    };
    rec.steps.push({ what: 'filled ' + boxes.length + ' boxes quickly', ms: await fillAll(want) });
    await check(want, 'after reload, not kept');
    rec.steps.push({ what: 'all kept after reload', ms: 0 });
    const back = Object.fromEntries(boxes.map(b => [b.plant, b.was]));
    rec.steps.push({ what: 'put back', ms: await fillAll(back) });
    await check(back, 'not put back');
  });

  // 6.57: Weekly Dispatch "+ Extra this week" adds a second line for a run (this week only), then Remove takes it off.
  await write('Weekly extra run line', async (p, rec) => {
    await open(p, 'weekly.html');
    await p.waitForSelector('#rows td.run-name.pickable', { timeout: 20000 });
    rec.before = await p.$$eval('#rows tr.extra-run', x => x.length);
    const name = await p.$eval('#rows td.run-name.pickable', td => { td.click(); return td.textContent.trim(); });
    rec.run = name;
    await p.waitForSelector('#rows .xr-plus', { timeout: 8000 });
    await timed(p, rec, 'extra line shows', () => p.click('#rows .xr-plus'), { fn: (n) => document.querySelectorAll('#rows tr.extra-run').length > n, arg: rec.before });
    rec.line = await p.$$eval('#rows tr.extra-run', trs => trs[trs.length - 1].children[1].textContent);
    if (!/THIS WEEK ONLY/.test(rec.line)) throw new Error('the new line does not say THIS WEEK ONLY: ' + rec.line);
    await p.reload();
    await timed(p, rec, 'still there after reload', async () => {}, { fn: (n) => document.querySelectorAll('#rows tr.extra-run').length > n, arg: rec.before }, 20000);
    await shot(p, 'weekly-extra-run');
    await p.$$eval('#rows tr.extra-run td.run-name', tds => tds[tds.length - 1].click());
    await p.waitForSelector('#rows .xr-remove', { timeout: 8000 });
    await p.click('#rows .xr-remove');
    await p.waitForFunction(() => (document.querySelector('#rows .xr-remove') || {}).textContent === 'Click again', null, { timeout: 5000 });
    await timed(p, rec, 'removed', () => p.click('#rows .xr-remove'), { fn: (n) => document.querySelectorAll('#rows tr.extra-run').length === n, arg: rec.before });
    const bad = p.w.calls.filter(c => c.status !== 200 || c.error);
    if (bad.length) throw new Error('a save answered ' + bad[0].status + ' ' + bad[0].error.slice(0, 150));
  });
  // 6.57 look only: down trailers show red DOWN on Daily Dispatch; Fleet tiles, Scorecard and Walkthrough pictures draw.
  await write('Down trailers, Fleet tiles, Scorecard, Walkthrough (look only)', async (p, rec) => {
    await open(p, 'daily.html');
    rec.dailyDown = await p.evaluate(() => [...document.querySelectorAll('#rows td')].filter(td => /\bDOWN\b/.test(td.textContent)).map(td => td.closest('tr').children[0].textContent.trim() + ' ' + td.textContent.trim()).slice(0, 10));
    await open(p, 'maint.html');
    rec.fleetTilesCut = await p.evaluate(() => [...document.querySelectorAll('.tile, .card, .stat, .kpi')].filter(el => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1).map(el => el.innerText.replace(/\s+/g, ' ').slice(0, 60)));
    await open(p, 'scorecard.html');
    rec.scorecard = await p.evaluate(() => document.querySelectorAll('tbody tr').length);
    await open(p, 'walkthrough.html');
    rec.walkPictures = await p.evaluate(() => ({ imgs: document.querySelectorAll('img').length, broken: [...document.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth === 0 && i.src && !/^data:/.test(i.src)).length, captions: document.querySelectorAll('figcaption, .caption, [data-caption]').length }));
    if (rec.walkPictures.broken) throw new Error(rec.walkPictures.broken + ' walkthrough picture(s) did not load');
    if (rec.fleetTilesCut.length) throw new Error('Fleet tiles cut: ' + rec.fleetTilesCut.join(' | '));
  });

  // 6.58: Weekly Dispatch title row: no "Published ..." line, buttons beside the title at 1536 and 1920, nothing cut.
  // 6.59: at 1024 wide or less the driver names stay 16px (long names wrap) and nothing scrolls sideways.
  await write('Weekly names 16px at 390 and 1024 (look only)', async (p, rec) => {
    for (const [w, h] of [[390, 844], [1024, 768]]) {
      await p.setViewportSize({ width: w, height: h });
      await open(p, 'weekly.html');
      await p.waitForSelector('#rows tr td', { timeout: 20000 });
      await p.waitForTimeout(800);
      const r = await p.evaluate(() => {
        const small = [];
        document.querySelectorAll('#rows td, #board-rows td').forEach(td => td.querySelectorAll('*').length === 0 || true);
        const walk = document.createTreeWalker(document.querySelector('main') || document.body, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          const el = n.parentElement, t = n.textContent.trim();
          if (!t || !el.closest('#rows, #board-rows') || !el.offsetParent) continue;
          const px = parseFloat(getComputedStyle(el).fontSize);
          if (px < 16) small.push(px + 'px "' + t.slice(0, 30) + '"');
        }
        return { small: small.slice(0, 12), smallCount: small.length, sideways: document.documentElement.scrollWidth > innerWidth + 1 };
      });
      rec['w' + w] = r;
      if (r.smallCount) throw new Error(w + ': ' + r.smallCount + ' text under 16px, e.g. ' + r.small.slice(0, 4).join(', '));
      if (r.sideways) throw new Error(w + ': the page scrolls sideways');
      await shot(p, 'weekly-names-' + w);
    }
  });
  await write('Weekly title row at 1536 and 1920 (look only)', async (p, rec) => {
    for (const [w, h] of [[1536, 790], [1920, 950]]) {
      await p.setViewportSize({ width: w, height: h });
      await open(p, 'weekly.html');
      await p.waitForSelector('#rows tr', { timeout: 20000 });
      await p.waitForTimeout(800);
      const r = await p.evaluate(() => {
        const t = document.querySelector('.head h1').getBoundingClientRect(), a = document.querySelector('.head .actions.in-head') || document.querySelector('.head .actions');
        const ar = a.getBoundingClientRect(), pub = document.getElementById('published'), btn = document.getElementById('publish');
        const cut = [...a.querySelectorAll('button')].filter(b => b.offsetParent && (b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1)).map(b => b.textContent.trim());
        const board = document.querySelector('#rows').getBoundingClientRect();
        const shown = [...document.querySelectorAll('#rows tr')].filter(tr => { const b = tr.getBoundingClientRect(); return b.height && b.top >= 0 && b.bottom <= innerHeight; }).length;
        return { sameRow: ar.top < t.bottom, publishedLine: pub && !pub.hidden ? pub.textContent : '', hover: btn ? btn.title : '', cut, boardTop: Math.round(board.top), rowsShown: shown };
      });
      rec['w' + w] = r;
      if (!r.sameRow) throw new Error(w + ': the buttons are not on the title row');
      if (r.cut.length) throw new Error(w + ': buttons cut: ' + r.cut.join(', '));
      if (/^Published/.test(r.publishedLine)) throw new Error(w + ': the Published line still shows');
      await shot(p, 'weekly-title-' + w);
    }
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
    for (let i = 0; i < 60 && !p.w.calls.some(c => c.at >= t && c.op === 'saveTemperatureCheck'); i++) await p.waitForTimeout(250);
    const call = p.w.calls.find(c => c.at >= t && c.op === 'saveTemperatureCheck');
    if (!call) throw new Error('the reading was not saved within 15 seconds');
    // 6.52 (Joe 10/22 live): every manual reading failed with "not saved (internal)"; the save must answer 200.
    if (call.status !== 200 || call.error) throw new Error('the reading was not saved: ' + (call.error || call.status));
    rec.steps.push({ what: 'reading saved', ms: Date.now() - t });
    await p.waitForTimeout(1000);
    rec.shown = await p.evaluate(() => (document.querySelector('#rows tr[data-location] .tp-act') || {}).textContent || '');
    if (/not saved/i.test(rec.shown)) throw new Error('the row shows ' + rec.shown);
  });

  // Quality check: a temperature on a line's check (6.52 fixed Quality saves timing out on a busy live day).
  await write('Quality check save', async (p, rec) => {
    await open(p, 'quality.html?line=ut_prod_totes');
    await p.waitForFunction(() => /Quality Check/.test((document.getElementById('form-title') || {}).textContent || ''), null, { timeout: 15000 });
    rec.line = await p.textContent('#form-title');
    const box = await p.$('.prod-temperature');
    if (!box) throw new Error('no temperature box on the Quality check');
    const was = await box.inputValue();
    rec.typed = was === '38' ? '37' : '38';
    await box.fill(rec.typed);
    const t = Date.now();
    await p.keyboard.press('Tab');
    for (let i = 0; i < 60 && !p.w.calls.some(c => c.at >= t && c.op === 'saveQualityCheck'); i++) await p.waitForTimeout(250);
    const call = p.w.calls.find(c => c.at >= t && c.op === 'saveQualityCheck');
    if (!call) throw new Error('the Quality check was not saved within 15 seconds');
    if (call.status !== 200 || call.error) throw new Error('the Quality check was not saved: ' + (call.error || call.status));
    rec.steps.push({ what: 'quality check saved', ms: Date.now() - t });
    await p.waitForTimeout(1000);
    rec.shown = await p.evaluate(() => [...document.querySelectorAll('[data-note]')].map(n => n.textContent).join(' | '));
    if (/not saved/i.test(rec.shown)) throw new Error('the check shows ' + rec.shown);
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
