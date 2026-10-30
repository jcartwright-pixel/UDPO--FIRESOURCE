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
  ['Production TV', 'production.html?tv=1'], ['Line Tablet', 'line.html'], ['Jug Trailers', 'jug-trailers.html'], ['Maintenance Station', 'maint-station.html'], ['Garage Station', 'garage-station.html'],
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
  ['Blow Mold', 'line.html?line=ut_prod_blow_mold'], ['Blow Mold Targets', 'linetargets.html?line=ut_prod_blow_mold'],
  // 6.61: the Blow Mold page on Plant Production.
  ['Blow Mold (Plant Production)', 'production.html?line=ut_prod_blow_mold'],
  // 6.63: the plant reorg pages and People & Roles.
  ['Plant Operations', 'group.html?g=plantops'], ['Route Distribution (group)', 'group.html?g=routeops'], ['Plant Production home', 'production-home.html'],
  ['Plant Equipment', 'plant-equipment.html'], ['Maintenance Crew', 'maint-crew.html'], ['Menu Setup', 'menu-setup.html'], ['People & Roles', 'administration.html?item=people'],
  // 6.64: the Help guide.
  ['Help', 'help.html'],
  // 6.66: Machine Connections.
  ['Machine Connections', 'administration.html?item=machine-connections']
].filter((s, i, a) => a.findIndex(x => x[1] === s[1]) === i && s[1] !== 'data/');
const WIDE = ['help.html', 'group.html?g=plantops', 'production-home.html', 'administration.html?item=people', 'production.html', 'production.html?line=ut_prod_blow_mold', 'maint.html', 'scorecard.html', 'walkthrough.html', 'line.html?line=ut_prod_blow_mold', 'index.html', 'distribution.html', 'daily.html', 'weekly.html', 'routes.html', 'loadout.html', 'loadout.html?area=BOXING', 'forecast.html', 'plant.html', 'manager.html', 'yard.html', 'trucks.html', 'issues.html', 'garage.html', 'administration.html'];
const PHONE = ['help.html', 'group.html?g=plantops', 'weekly.html', 'maint.html', 'walkthrough.html', 'route.html', 'yard.html', 'quality.html', 'temps.html', 'index.html', 'loadout.html'];
const TABLET = ['production.html?line=ut_prod_blow_mold', 'line.html?line=ut_prod_blow_mold', 'weekly.html', 'plant-station.html', 'loadout.html', 'yard.html', 'washing.html', 'unloading.html', 'driver-room.html'];
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
    if (r.status() === 403 && !report.first403) { report.first403 = { fn: m[1] || m[2], op, at: new Date().toISOString(), page: page.url().slice(0, 160), body: body.slice(0, 300) }; note('first refused call: ' + JSON.stringify(report.first403)); }
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
  // signedOut: a browser with no United Dairy account at all (a TV or tablet that only ever typed its station code).
  const opts = Object.assign({}, v), signedOut = !!opts.signedOut;
  delete opts.signedOut;
  // keepAwakeLook only gives the keep-awake look its own browser.
  Object.keys(opts).filter(k => /Look$/.test(k)).forEach(k => delete opts[k]);
  const ctx = await browser.newContext(Object.assign({ serviceWorkers: 'block', timezoneId: 'America/New_York', locale: 'en-US' }, opts));
  if (!LOCAL && !signedOut) {
    // The screens' own check reads the address from the account record, which a token sign-in leaves empty (the deploy key
    // may not edit accounts): the test browser fills it in from the token's verified address.
    await ctx.route(/identitytoolkit\.googleapis\.com\/v1\/accounts:lookup/, async (route) => {
      // A failed look-up (a 503 once) answered with no email made the app sign the whole test browser out ("Only United Dairy
      // Google accounts"), and every later step failed. Ask again a few times; never answer a failed one as an empty account.
      let res = null, body = null;
      for (let i = 0; i < 5; i++) {
        res = await route.fetch().catch(() => null);
        body = res && res.ok() ? await res.json().catch(() => null) : null;
        if (body && body.users) break;
        report.notes.push('sign-in look-up answered ' + (res ? res.status() : 'no answer') + ' at ' + new Date().toISOString() + (i < 4 ? ', asking again' : ''));
        await new Promise(r => setTimeout(r, 2000 * (i + 1)));
      }
      if (!body || !body.users) { await route.abort(); return; }
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
// A quick look (functions/test/browser/audit-only.txt on the branch, one step name a line): only those steps, no screen passes.
const ONLY_STEPS = (() => { try { return fs.readFileSync(path.join(__dirname, 'audit-only.txt'), 'utf8').split('\n').map(x => x.trim()).filter(Boolean); } catch (e) { return []; } })();
async function write(name, fn) {
  if (ONLY_STEPS.length && !ONLY_STEPS.includes(name)) return { name, skipped: true };
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

// Loads of today not started whose depart time is still ahead (a load already gone is off the yard), latest last.
// Today's loads not started that can take a trailer, the likeliest to still be on the yard first: those leaving 30+ minutes from
// now (latest first), then those for a later delivery day (a Delivery Day route leaves on that day), then the rest.
const laterLoads = (p, minutesAhead) => p.evaluate((ahead) => {
  const head = [...document.querySelectorAll('#head-row th')].map(th => th.textContent.trim().toUpperCase());
  const di = head.indexOf('DEPART');
  const nowEt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })), nowMin = nowEt.getHours() * 60 + nowEt.getMinutes();
  const mins = (t) => { const m = String(t).match(/(\d{1,2}):(\d{2})\s*([AP])M/i); return m ? (Number(m[1]) % 12) * 60 + Number(m[2]) + (/p/i.test(m[3]) ? 720 : 0) : -1; };
  // The day the loadout shows (an earlier day's left-overs are loaded from that day's own page): its weekday, and whether it is today.
  const opDay = new Date(nowEt.getTime() - 6 * 3600000), opKey = opDay.getFullYear() + '-' + String(opDay.getMonth() + 1).padStart(2, '0') + '-' + String(opDay.getDate()).padStart(2, '0');
  const date = (document.getElementById('load-date') || {}).value || opKey, isToday = date === opKey;
  const todayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(date + 'T12:00:00Z').getUTCDay()];
  let prior = false;
  const today = [...document.querySelectorAll('#rows tr')].filter(x => { if (x.classList.contains('divider')) { prior = x.classList.contains('prior'); return false; } return !prior && x.dataset.row && !/^sch:/.test(x.dataset.row); });
  return today.filter(x => !x.classList.contains('loading') && !x.classList.contains('done') && x.querySelector('button.clock:not([disabled])') && x.querySelector('input[data-k="trailer"]:not([disabled])'))
    .map(tr => { const depart = di >= 0 ? tr.children[di].textContent.trim() : '', m = mins(depart), later = (tr.dataset.row.split('|')[1] || '') !== todayKey;
      return { row: tr.dataset.row, date, route: tr.children[0].textContent.trim(), trailer: tr.querySelector('input[data-k="trailer"]').value, depart, rank: isToday && m >= nowMin + ahead ? 3e6 + m : later ? 2e6 + m : 1e6 + m }; })
    .sort((a, b) => b.rank - a.rank);
}, minutesAhead);
// Loads to put a test trailer on for Yard Checks: today's, then yesterday's left-overs not yet loaded (late on a Sunday every load of
// the day has left; a left-over for a later delivery day is still on the yard once loaded).
const yardCandidates = async (p) => {
  await open(p, 'loadout.html');
  await p.waitForSelector('#rows tr[data-row]', { timeout: 20000 }).catch(() => {});
  const today = await laterLoads(p, 30), d = new Date(operatingDay() + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  await open(p, 'loadout.html?date=' + d.toISOString().slice(0, 10));
  await p.waitForSelector('#rows tr[data-row]', { timeout: 20000 }).catch(() => {});
  const yesterday = await laterLoads(p, 30);
  const all = today.concat(yesterday);
  // When each one really leaves (the dispatch rule: Load Day = the load date, a time before 6 a.m. the next morning; Delivery Day =
  // the delivery date), from its runDays copy: a load already gone is never on the yard, so only those leaving 30+ minutes from
  // now, latest first. Late in the evening every load of the day can have left while next day's loads still wait.
  try {
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const dn = (k) => k ? Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)) / 86400000 : null;
    const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }).replace(/,/, ''));
    const nowWall = dn(et.getFullYear() + '-' + String(et.getMonth() + 1).padStart(2, '0') + '-' + String(et.getDate()).padStart(2, '0')) * 1440 + et.getHours() * 60 + et.getMinutes();
    for (const x of all) {
      const [rid, day] = x.row.split('|');
      const d = (await db.collection('runDays').where('runDocId', '==', rid).get()).docs.map(q => q.data()).find(q => q.day === day);
      const v = d ? Object.assign({}, d, (d.days || {})[day] || {}) : null;
      if (!v) continue;
      const t = Number(v.dispatchTime !== undefined && v.dispatchTime !== null && v.dispatchTime !== '' ? v.dispatchTime : v.startTime), on = String((d.masterShow || {}).leavesOn || '').toUpperCase();
      if (!isFinite(t)) continue;
      const leaves = /LOAD/.test(on) ? (dn(v.loadDate) + (t < 360 ? 1 : 0)) * 1440 + t : (dn(v.departureDate || v.deliveryDate) - (!/DELIVER/.test(on) && dn(v.loadDate) < dn(v.departureDate || v.deliveryDate) && t >= 360 ? 1 : 0)) * 1440 + t;
      x.leavesIn = leaves - nowWall;
    }
    const known = all.filter(x => x.leavesIn !== undefined);
    if (known.length) return known.filter(x => x.leavesIn >= 30).sort((a, b) => b.leavesIn - a.leavesIn).concat(all.filter(x => x.leavesIn === undefined));
  } catch (e) { /* fall back to the order the loadout gives */ }
  return all.sort((a, b) => b.rank - a.rank);
};
// The load the yard check step found still on the yard (the reloaded-trailer step loads it again).
let yardLoad = null;

// Turns a load marked Ended Up Not Running back on, with the same save Daily Dispatch's RUNS button and Weekly send (setRuns). Daily
// stops listing a day once it is off, so the test sends it from a signed-in page. date = the load date; then checks the load is
// back on that day's loadout.
const turnBackOn = async (p, date, rowId) => {
  await open(p, 'loadout.html?date=' + date);
  const row = 'tr[data-row="' + rowId + '"]';
  if (await p.$(row)) return 'already on';
  const [runDocId, day] = rowId.split('|');
  const out = await p.evaluate(async ([id, d]) => { try { const m = await import('./js/app.js'); const r = await m.save('setRuns', { runDocId: id, day: d, runs: true }); return r && r.ok ? 'ok' : JSON.stringify(r).slice(0, 200); } catch (e) { return 'error: ' + (e.message || e); } }, [runDocId, day]);
  if (out !== 'ok') throw new Error('turning ' + rowId + ' back on answered ' + out);
  // The loadout can take a little while to list it again: up to three fresh looks.
  for (let i = 0; i < 3; i++) {
    await open(p, 'loadout.html?date=' + date);
    if (await p.waitForSelector(row, { timeout: 20000 }).then(() => true, () => false)) return 'turned back on';
  }
  throw new Error(rowId + ' was turned back on but is not on the ' + date + ' loadout after a minute');
};
// 6.71 (#537): an Administrator's own account is never locked to a station. Whether the test account is one decides what its
// station tablets must do (an Administrator: freed, with the Operations button; anyone else: kept on the station).
let AUDIT_ADMIN = null;
const auditIsAdmin = async () => {
  if (AUDIT_ADMIN !== null) return AUDIT_ADMIN;
  const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
  const d = await r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit')).collection('users').doc(EMAIL).get();
  AUDIT_ADMIN = !!(d.exists && d.data().status === 'ACTIVE' && require(path.join(__dirname, '..', '..', 'src', 'logic.js')).isAdmin(d.data()));
  return AUDIT_ADMIN;
};
// 6.76 (#552): what the Driver Room board, its TV and View Loadout should list after the 6 a.m. roll: the operating day's loads,
// with yesterday's loads that are not loaded yet first. Worked out from the practice copy's loads with the board's own rules
// (functions/src/board-rules.js); key = what the board shows as route and run.
const carryExpected = async () => {
  const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
  const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
  const L = require(path.join(__dirname, '..', '..', 'src', 'logic.js')), B = require(path.join(__dirname, '..', '..', 'src', 'board-rules.js'));
  const date = operatingDay(), week = L.weekStart(date);
  const runs = (await db.collection('runs').where('weekStart', 'in', [L.addDays(week, -7), week, L.addDays(week, 7)]).get()).docs.map(d => Object.assign({}, d.data(), { id: d.id }));
  const pickups = (await db.collection('pickups').where('date', 'in', [L.addDays(date, -1), date, L.addDays(date, 1), L.addDays(date, 2), L.addDays(date, 3)]).get()).docs.map(d => d.data());
  const rows = B.loadoutBoardRows(runs, pickups, date, { carry: true }).map(x => ({ key: x.streamId ? x.streamId + '|' : x.route + '|' + x.run, prior: !!x.prior, state: x.state, delivers: x.deliveryDate }));
  return { date, rows, prior: rows.filter(x => x.prior) };
};
// Board rows (keys in order) against what is expected: yesterday's unfinished loads, first.
const carryCompare = (exp, shown) => {
  const want = exp.prior.map(x => x.key), first = shown.slice(0, want.length), bad = [];
  const missing = want.filter(k => !shown.includes(k)), notFirst = want.filter(k => shown.includes(k) && !first.includes(k));
  if (missing.length) bad.push('yesterday\'s unfinished loads missing: ' + missing.slice(0, 6).join(', '));
  if (notFirst.length) bad.push('yesterday\'s unfinished loads not at the top: ' + notFirst.slice(0, 6).join(', '));
  return { expectedPrior: want, shownFirst: first, shownCount: shown.length, expectedCount: exp.rows.length, bad };
};
// The operating day (rolls at 6 a.m. Eastern) as 2026-10-25.
const operatingDay = () => { const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }).replace(/,/, '')); d.setHours(d.getHours() - 6); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

async function writes() {
  // Every run first: anything an earlier run left (a run stopped part way can skip its own put back). The test's Box loads (by
  // their note), its T-99.. added trailers on Case Unloading, and its test station come off; depart and start times last changed
  // by the test account are listed so a person can look.
  await write('Clean up after an earlier stopped run', async (p, rec) => {
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const save = (action, f) => p.evaluate(([a, x]) => import('./js/app.js').then(m => m.save(a, x)), [action, f]);
    // A load the last run marked Ended Up Not Running and could not turn back on (its results are kept next to this run's): on again.
    try {
      const parent = path.dirname(path.resolve(OUT)), runs = fs.readdirSync(parent).filter(n => /^\d{8}-\d{4}$/.test(n) && path.join(parent, n) !== path.resolve(OUT)).sort();
      const last = runs.length ? JSON.parse(fs.readFileSync(path.join(parent, runs[runs.length - 1], 'results.json'), 'utf8')) : null;
      const off = last && (last.writes || []).find(x => x.name === 'Ended Up Not Running' && x.ok && x.load), back = last && (last.writes || []).find(x => x.name === 'Ended Up Not Running put back');
      if (off && !(back && back.ok)) rec.turnedBackOn = off.load.route + ' ' + off.load.date + ': ' + (await turnBackOn(p, off.load.date, off.load.row));
    } catch (e) { rec.turnedBackOn = 'could not: ' + String(e.message || e).slice(0, 200); }
    await open(p, 'loadout.html?area=BOXING');
    const boxes = (await db.collection('plantJournal').where('notes', '==', 'Practice copy test load (deleted by the test)').get()).docs
      .map(d => Object.assign({ doc: d.id }, d.data())).filter(x => String(x.status || '').toUpperCase() !== 'DELETED');
    rec.boxLoads = boxes.map(x => x.route + ' ' + x.date);
    for (const x of boxes) await save('savePlantSchedule', { lane: 'SHIPPING', op: 'remove', id: x.recordId || x.doc, date: x.date }).catch(e => { rec.boxError = String(e.message).slice(0, 120); });
    const left = (await db.collection('plantJournal').where('notes', '==', 'Practice copy test load (deleted by the test)').get()).docs.filter(d => String(d.data().status || '').toUpperCase() !== 'DELETED').length;
    await open(p, 'unloading.html?area=CASE');
    await p.waitForSelector('#rows tr', { timeout: 30000 }).catch(() => {});
    rec.trailers = [];
    for (let n = 0; n < 6; n++) {
      const key = await p.evaluate(() => { const t = [...document.querySelectorAll('#rows tr[data-key*="ADDED|99"]')][0]; return t ? t.dataset.key : ''; });
      if (!key) break;
      rec.trailers.push(key.split('|').pop());
      await p.click('#rows tr[data-key="' + key + '"] button[data-do="edit"]');
      await p.waitForSelector('#rows button[data-do="drop"]', { timeout: 8000 });
      await p.click('#rows button[data-do="drop"]');
      await p.waitForFunction(k => !document.querySelector('#rows tr[data-key="' + k + '"]'), key, { timeout: 15000 });
    }
    const adm = (op, f) => p.evaluate(([o, x]) => import('./js/app.js').then(m => m.callServer('admin', Object.assign({ op: o }, x))), [op, f]);
    // Jug Trailers the test added (typed PT-99..) still in the lot: Left the Lot.
    const jugs = (await db.collection('jugTrailers').where('inLot', '==', true).get()).docs.map(d => Object.assign({ id: d.id }, d.data())).filter(t => /^PT-99\d\d$/.test(String(t.number || '')));
    for (const t of jugs) await save('saveJugTrailer', { facilityId: t.facilityId, op: 'left', trailerId: t.id });
    rec.jugTrailers = jugs.map(t => t.number);
    const svc = (await db.collection('workOrders').where('source_id', '==', 'PRACTICE-TEST|PM').get()).docs;
    for (const d of svc) await d.ref.delete();
    rec.serviceOrders = svc.length;
    // 6.76: the PM the test sends to the garage (Send to Garage), if a run stopped before deleting it.
    const sentPm = (await db.collection('workOrders').where('source', '==', 'OFFICE').get()).docs.filter(d => /Practice test \(deleted by the test\)/.test(String(d.data().problem || '')));
    for (const d of sentPm) await d.ref.delete();
    rec.sentToGarage = sentPm.length;
    const st = [];
    for (const [kind, name] of [['PLANT', 'Practice test Case Unloading'], ['GARAGE', 'Practice test Garage'], ['KIOSK', 'Practice test TV']]) st.push(...((await adm('stations', { kind })).stations || []).filter(x => x.name === name));
    for (const o of st) await adm('stationRemove', { key: o.key });
    rec.stations = st.length;
    // Not changed here: listed for a person to check.
    const FP = r('firebase-admin/firestore').FieldPath, od = new Date(operatingDay() + 'T12:00:00Z');
    od.setUTCDate(od.getUTCDate() - od.getUTCDay());
    const ws = od.toISOString().slice(0, 10);
    const week = (await db.collection('runs').where(FP.documentId(), '>=', ws).where(FP.documentId(), '<', ws + '\uf8ff').get().catch(() => ({ docs: [] }))).docs;
    rec.lastChangedByTest = week.flatMap(d => Object.keys(d.data().days || {}).filter(k => (d.data().days[k] || {}).updatedBy === EMAIL).map(k => d.data().route + ' ' + k)).slice(0, 20);
    if (left) throw new Error(left + ' test Box load(s) could not be removed');
  });
  // One time (10-27 / 10-28): the 6.67 Skip runs left the 852 Jersey loads (10-26 loads, day wed) swapped and their Skip marks
  // on; and the 855 / 856 loads (day tue) with the test's Skip marks. Put the order numbers back to what the saves' log says they
  // were before the test (JERSEY LOAD 1 15, JERSEY LOAD 2 20) and take off the marks only this test account made.
  if (operatingDay() <= '2026-10-28') {
    await write('Put back 852 Jersey order and test Skip marks (10-27 only)', async (p, rec) => {
      const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
      const fs2 = r('firebase-admin/firestore'), db = fs2.getFirestore(r('firebase-admin').app('audit'));
      const fix = [['2026-10-25__run_74ae54278592ceab2fba', 'wed', 15], ['2026-10-25__run_0a6507d00b3fdcbefa24', 'wed', 20], ['2026-10-25__run_6b2007de2c62a8ca0018', 'tue', null], ['2026-10-25__run_b33d03ac982e86561416', 'tue', null]];
      rec.done = [];
      for (const [id, day, seq] of fix) {
        const ref = db.collection('runs').doc(id), d = (await ref.get()).data();
        if (!d || !d.days || !d.days[day]) { rec.done.push(id.slice(-6) + ' missing'); continue; }
        const u = {}, x = d.days[day];
        if (seq !== null && x.loadSequenceOverride !== seq) u['days.' + day + '.loadSequenceOverride'] = seq;
        if (x.moveMark && x.moveMark.by === EMAIL) u['days.' + day + '.moveMark'] = fs2.FieldValue.delete();
        if (Object.keys(u).length) await ref.update(u);
        rec.done.push(id.slice(-6) + '|' + day + ' ' + (Object.keys(u).join(',') || 'already right'));
      }
      await open(p, 'loadout.html');
      await p.waitForSelector('#rows tr[data-row]', { timeout: 20000 });
      const order = await p.evaluate(() => [...document.querySelectorAll('#rows tr[data-row]')].map(t => t.dataset.row));
      const a = order.findIndex(x => /ceab2fba\|wed$/.test(x)), b = order.findIndex(x => /dcbefa24\|wed$/.test(x));
      rec.screen = [a, b];
      if (a >= 0 && b >= 0 && a > b) throw new Error('JERSEY LOAD 1 is still below JERSEY LOAD 2');
    });
  }
  // One time (10-25 / 10-26): a failed run left its test trailer on 825 DSD (10-24 load, own trailer T-543).
  if (operatingDay() <= '2026-10-26') {
    await write('Put back 825 trailer (10-25 only)', async (p, rec) => {
      const row = 'tr[data-row="2026-10-25__run_7d4173938f7589d1eded|mon"]';
      await open(p, 'loadout.html?date=2026-10-24');
      await p.waitForSelector(row, { timeout: 20000 }).catch(() => {});
      if (!(await p.$(row))) { rec.back = 'not listed'; return; }
      const v = await p.inputValue(row + ' input[data-k="trailer"]');
      rec.was = v;
      if (!/^T-9[89]\d{4}$/.test(v)) { rec.back = 'already its own'; return; }
      await p.fill(row + ' input[data-k="trailer"]', 'T-543');
      await p.press(row + ' input[data-k="trailer"]', 'Enter');
      await p.waitForTimeout(2000);
      await open(p, 'loadout.html?date=2026-10-24');
      await p.waitForSelector(row, { timeout: 20000 });
      rec.back = await p.inputValue(row + ' input[data-k="trailer"]');
      if (rec.back !== 'T-543') throw new Error('825 trailer is ' + rec.back);
    });
  }
  // One time (10-25): the Ended Up Not Running step did not put its load back before, so this morning's runs turned 857, 856 and
  // 855 off on the practice copy. They go back on here.
  if (operatingDay() === '2026-10-25') {
    await write('Put back loads earlier tests ended (10-25 only)', async (p, rec) => {
      rec.back = [];
      for (const id of ['2026-10-25__run_5dce9546e1d7f4bdc9d7|sun', '2026-10-25__run_b33d03ac982e86561416|sun', '2026-10-25__run_6b2007de2c62a8ca0018|sun']) rec.back.push(id.slice(-8) + ' ' + await turnBackOn(p, '2026-10-25', id));
      // The 13:56 run left its test trailer T-990848 on 857 (it had none).
      const row = 'tr[data-row="2026-10-25__run_5dce9546e1d7f4bdc9d7|sun"]';
      await open(p, 'loadout.html?date=2026-10-25');
      await p.waitForSelector(row, { timeout: 20000 });
      if (/^T-99\d{4}$/.test(await p.inputValue(row + ' input[data-k="trailer"]'))) {
        await p.fill(row + ' input[data-k="trailer"]', '');
        await p.press(row + ' input[data-k="trailer"]', 'Enter');
        await p.waitForTimeout(2000);
        await open(p, 'loadout.html?date=2026-10-25');
        await p.waitForSelector(row, { timeout: 20000 });
        const v = await p.inputValue(row + ' input[data-k="trailer"]');
        if (v) throw new Error('857 still has trailer ' + v);
        rec.back.push('857 test trailer cleared');
      }
    });
  }
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
    // Then today's loadout (the loadout day kept in this browser goes back to today).
    await open(p, 'loadout.html');
    await p.waitForSelector('#rows tr[data-row]', { timeout: 20000 }).catch(() => {});
    if (await p.isVisible('#go-today')) { await p.click('#go-today'); await p.waitForTimeout(2500); }
    const order = () => p.evaluate(() => [...document.querySelectorAll('#rows tr[data-row]')].map(x => x.dataset.row));
    // A load with no tag and an untagged load below it. A load an earlier skip moved up shows no tag; skipping it only puts it
    // back in its place (no tag, since 6.47). Then the next load is tried, so the tag read is always this Skip's.
    const tried = [];
    let sel = null;
    for (let n = 0; n < 6 && !sel; n++) {
      const c = await p.evaluate((skipIds) => {
        let prior = false;
        const all = [...document.querySelectorAll('#rows tr')].filter(t => { if (t.classList.contains('divider')) { prior = t.classList.contains('prior'); return false; } return !prior && t.dataset.row; });
        const tagged = (t) => t && (t.querySelector('.moved-tag') || t.classList.contains('moved'));
        const tr = all.find((t, i) => !skipIds.includes(t.dataset.row) && !t.classList.contains('loading') && !t.classList.contains('done') && t.querySelector('button.skip:not(.off)') && !tagged(t) && all[i + 1] && !tagged(all[i + 1]) && all[i + 1].querySelector('button.skip:not(.off)'));
        return tr ? { row: tr.dataset.row, route: tr.children[0].textContent.trim() } : null;
      }, tried);
      if (!c) break;
      const before = await order(), row = 'tr[data-row="' + c.row + '"]';
      await p.click(row + ' button.skip');
      await p.waitForFunction(([s, i]) => [...document.querySelectorAll('#rows tr[data-row]')].map(x => x.dataset.row).indexOf(s) !== i, [c.row, before.indexOf(c.row)], { timeout: 15000 });
      await p.waitForTimeout(2500);
      const tag = await p.evaluate(s => { const t = document.querySelector(s + ' .moved-tag'); return t ? t.textContent + ' | ' + t.title : ''; }, row);
      if (/SKIPPED/.test(tag)) { sel = c; rec.tag = tag; rec.before = before; const now = await order(); rec.moved = now.indexOf(c.row) - before.indexOf(c.row); }
      else tried.push(c.row);
    }
    rec.putBackFirst = tried.length;
    if (!sel) throw new Error('Skip moved ' + tried.length + ' load(s) but no SKIPPED tag showed');
    rec.load = sel;
    // 6.67 (#512): Skip moves a load down one place only.
    const oneErr = rec.moved !== 1 ? 'Skip moved the load ' + rec.moved + ' places, not one' : '';
    // Put back: Skip on the load now just above it moves that one back down; both are in their own places again (no tags).
    const after = await order(), above = after[after.indexOf(sel.row) - 1];
    await timed(p, rec, 'put back', () => p.click('tr[data-row="' + above + '"] button.skip'), { fn: ([s, a]) => { const ids = [...document.querySelectorAll('#rows tr[data-row]')].map(x => x.dataset.row); return ids.indexOf(s) < ids.indexOf(a) && !document.querySelector('tr[data-row="' + s + '"] .moved-tag'); }, arg: [sel.row, above] });
    // 6.67 (#513): after the put back neither load keeps a SKIPPED tag.
    await p.waitForTimeout(2500);
    const tags = await p.evaluate(([s, a]) => [s, a].map(id => { const t = document.querySelector('tr[data-row="' + id + '"] .moved-tag'); return t ? t.textContent.trim() : ''; }), [sel.row, above]);
    rec.tagsAfter = tags;
    if (tags.some(Boolean)) throw new Error('after the put back a load still shows ' + tags.filter(Boolean).join(', '));
    const bad = p.w.calls.filter(c => c.status !== 200 || c.error);
    if (bad.length) throw new Error('a save answered ' + bad[0].status + ' ' + bad[0].error.slice(0, 150));
    if (oneErr) throw new Error(oneErr);
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
      // Today's column first; a day with no driver on a load (a Sunday has few) uses another day of the week.
      const days = [day].concat(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].filter(x => x !== day));
      let cellSel = back && prev ? prev.cell : '';
      for (const d0 of (back && prev ? [] : days)) {
        cellSel = await p.evaluate(d => {
        // A driver on only one load today: a driver booked twice drops out of the list once moved off, so he could not be put back.
        const cells = [...document.querySelectorAll('tr td.day.editable[data-day="' + d + '"]')].filter(t => t.textContent.trim() && !/not running|off|carrier|plant load/i.test(t.textContent));
        const name = (t) => (t.firstChild && t.firstChild.textContent || t.textContent).trim().toUpperCase();
        const td = cells.find(t => cells.filter(x => name(x) === name(t)).length === 1);
        if (!td) return '';
        const tr = td.closest('tr'); tr.dataset.auditRow = '1';
        return tr.dataset.index !== undefined ? 'tr[data-index="' + tr.dataset.index + '"] td[data-day="' + d + '"]' : '';
      }, d0);
        if (cellSel) { rec.day = d0; break; }
      }
      if (!cellSel) throw new Error('no driver cell on any day of this week');
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
    // Add Load fills its Route / Run list from the routes read when it opens (it does not fill in later): opened before the
    // screen has read them, it is empty; then Cancel and open it again, as a person would.
    for (let i = 0; i < 6 && !(await p.evaluate(() => [...document.querySelectorAll('#s-route option')].some(o => o.value !== ''))); i++) {
      rec.addLoadReopened = (rec.addLoadReopened || 0) + 1;
      await p.click('#sched-modal [data-close]');
      await p.waitForTimeout(3000);
      await p.click('#add-load');
      await p.waitForSelector('#sched-modal:not([hidden]) #s-route');
    }
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
      // This day's own loads (a left-over from an earlier day is turned back on from its own day).
      let prior = false;
      const trs = [...document.querySelectorAll('#rows tr')].filter(t => { if (t.classList.contains('divider')) { prior = t.classList.contains('prior'); return false; } return !prior && t.dataset.row; }).filter(t => !/^sch:/.test(t.dataset.row) && !t.classList.contains('loading') && !t.classList.contains('done') && t.querySelector('button.edit-row'));
      const tr = trs[trs.length - 1];
      const tt = tr && tr.querySelector('input[data-k="trailer"]');
      return tr ? { row: tr.dataset.row, route: tr.children[0].textContent.trim(), trailer: tt ? tt.value : '', date: (document.getElementById('load-date') || {}).value || '', text: tr.innerText.replace(/\s+/g, ' ') } : null;
    });
    if (!sel) throw new Error('no load to mark');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sel.date)) sel.date = operatingDay();
    rec.load = sel;
    const row = 'tr[data-row="' + sel.row + '"]';
    await p.click(row + ' button.edit-row');
    await p.waitForSelector('#edit-modal:not([hidden])');
    await p.click('#edit-notrunning');
    await timed(p, rec, 'Ended Up Not Running (second press)', () => p.click('#edit-notrunning'), { fn: (s) => !document.querySelector(s) || document.getElementById('edit-modal').hidden, arg: row });
  });
  await captureAfter('after Ended Up Not Running');
  // Put back: Daily Dispatch turns the load back on, and it gets its own trailer again (Ended Up Not Running took it off).
  await write('Ended Up Not Running put back', async (p, rec) => {
    const r = report.writes.find(x => x.name === 'Ended Up Not Running');
    if (!r || !r.load) throw new Error('nothing to put back');
    rec.back = await turnBackOn(p, r.load.date, r.load.row);
    await open(p, 'loadout.html?date=' + r.load.date);
    const row = 'tr[data-row="' + r.load.row + '"]';
    await p.waitForSelector(row, { timeout: 20000 });
    if (r.load.trailer && (await p.inputValue(row + ' input[data-k="trailer"]')).replace(/^T-/, '') !== r.load.trailer.replace(/^T-/, '')) {
      await p.fill(row + ' input[data-k="trailer"]', r.load.trailer);
      await p.press(row + ' input[data-k="trailer"]', 'Enter');
      await p.waitForTimeout(2000);
      await open(p, 'loadout.html?date=' + r.load.date);
      await p.waitForSelector(row, { timeout: 20000 });
    }
    rec.after = await p.evaluate((s) => document.querySelector(s).innerText.replace(/\s+/g, ' '), row);
  });

  // Put a test-loaded load back: Not started, and its own trailer again. Gives '' or what is wrong.
  const putBackMade = async (p, rec, made) => {
    await open(p, 'loadout.html?date=' + made.date);
    const row = 'tr[data-row="' + made.row + '"]';
    await p.waitForSelector(row, { timeout: 20000 });
    await p.click(row + ' button.state');
    const t0 = Date.now();
    await timed(p, rec, 'put back Not started', () => p.click('#state-pop [data-s="NOT_STARTED"]'), { fn: (s) => { const x = document.querySelector(s); return x && !x.classList.contains('done') && !x.classList.contains('loading'); }, arg: row });
    // Its answer first, as a person would (typing the trailer the same second once left the load Done).
    for (let i = 0; i < 40 && !p.w.calls.some(c => c.at >= t0 && c.status); i++) await p.waitForTimeout(250);
    await p.waitForTimeout(1000);
    await p.fill(row + ' input[data-k="trailer"]', made.trailer);
    await p.press(row + ' input[data-k="trailer"]', 'Enter');
    await p.waitForTimeout(2000);
    await open(p, 'loadout.html?date=' + made.date);
    await p.waitForSelector(row, { timeout: 20000 });
    rec.putBack = await p.evaluate((s) => ({ trailer: document.querySelector(s + ' input[data-k="trailer"]').value, done: document.querySelector(s).classList.contains('done') }), row);
    return rec.putBack.done || rec.putBack.trailer.replace(/^T-/, '') !== made.trailer.replace(/^T-/, '') ? 'the load ' + made.route + ' was not put back: ' + JSON.stringify(rec.putBack) : '';
  };
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
      const picks = (await yardCandidates(p)).slice(0, 5);
      if (!picks.length) throw new Error('no trailer due, and no load of today or yesterday not started to load a trailer on');
      rec.tried = [];
      for (const x of picks) {
        made = x; rec.made = x;
        const row = 'tr[data-row="' + x.row + '"]';
        await open(p, 'loadout.html?date=' + x.date);
        await p.waitForSelector(row, { timeout: 20000 });
        await p.fill(row + ' input[data-k="trailer"]', num);
        await p.press(row + ' input[data-k="trailer"]', 'Enter');
        await p.waitForFunction(([s, a, b]) => { const v = (document.querySelector(s + ' input[data-k="trailer"]') || {}).value; return v === a || v === b; }, [row, tt, num], { timeout: 10000 });
        await p.waitForTimeout(1500);
        await timed(p, rec, 'Start', () => p.click(row + ' button.clock'), { fn: (s) => { const e = document.querySelector(s); return e && e.classList.contains('loading'); }, arg: row });
        await p.waitForSelector(row + ' button.clock.end', { timeout: 10000 });
        await timed(p, rec, 'End', () => p.click(row + ' button.clock'), { fn: (s) => { const e = document.querySelector(s); return e && e.classList.contains('done'); }, arg: row });
        await open(p, 'yard.html');
        await p.waitForSelector('#rows tr[data-trailer="' + tt + '"] .yd-temp:not([disabled])', { timeout: 30000 }).catch(() => {});
        t = (await p.$('#rows tr[data-trailer="' + tt + '"] .yd-temp:not([disabled])')) ? tt : '';
        if (!t) {
          // Once more on a fresh page before giving up on this load (the yard may not have the loading yet).
          await p.waitForTimeout(15000);
          await open(p, 'yard.html');
          await p.waitForSelector('#rows tr[data-trailer="' + tt + '"] .yd-temp:not([disabled])', { timeout: 30000 }).catch(() => {});
          t = (await p.$('#rows tr[data-trailer="' + tt + '"] .yd-temp:not([disabled])')) ? tt : '';
        }
        if (t) { yardLoad = x; break; }
        // Not on the yard (already past its leaving time): what the yard shows, then put it back and load the next one.
        const shows = await p.evaluate((n) => { const r = document.querySelector('#rows tr[data-trailer="' + n + '"]'); return r ? r.innerText.replace(/\s+/g, ' ').slice(0, 160) : 'not listed'; }, tt);
        rec.tried.push(x.route + ' ' + x.depart + ': ' + shows);
        // What the yard reads for this load (runDays), to tell why it is not on the yard.
        try {
          const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
          const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
          const [rid, day] = x.row.split('|');
          const qs = await db.collection('runDays').where('runDocId', '==', rid).get();
          rec.yardWhy = (rec.yardWhy || []).concat(qs.docs.map(d => d.data()).filter(d => d.day === day).map(d => { const v = d.days ? d.days[day] || {} : d; const pick = (o) => ({ dates: d.dates, loadDate: o.loadDate, deliveryDate: o.deliveryDate, departureDate: o.departureDate, dispatchTime: o.dispatchTime, startTime: o.startTime, completeTime: o.completeTime, loadStatus: o.loadStatus, trailer: o.trailer || o.trailerId, leavesOn: (d.masterShow || {}).leavesOn, keys: Object.keys(d).slice(0, 40) });
            return Object.assign({ route: x.route }, pick(Object.assign({}, d, v))); }));
        } catch (e) { rec.yardWhy = (rec.yardWhy || []).concat([{ error: String(e.message || e).slice(0, 200) }]); }
        const e = await putBackMade(p, rec, x);
        if (e) throw new Error(e);
        made = null;
      }
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
    if (made) { const e = await putBackMade(p, rec, made); if (e) err = (err ? err + '; ' : '') + e; }
    if (err) throw new Error(err);
  });

  // 6.60: a trailer checked, then reloaded on another load within 2 hours, shows Due and its check saves (the 2-hour lock counts
  // only checks made after its current load was loaded). Practice copy only; both loads go back to Not started with their own trailers.
  await write('Yard check on a reloaded trailer', async (p, rec) => {
    const now = new Date(), num = '98' + String(now.getUTCHours() * 60 + now.getUTCMinutes()).padStart(4, '0'), tt = 'T-' + num;
    rec.trailer = tt;
    // Two loads still to leave; with only one (a Sunday), the same load is loaded again later (a new loading all the same).
    // The load the yard check step found still on the yard, loaded twice (a new loading all the same); else the likeliest one.
    const first = yardLoad || (await yardCandidates(p))[0];
    if (!first) throw new Error('no load of today or yesterday not started');
    const picks = [first, first];
    rec.loads = picks;
    const load = async (x, step) => {
      await open(p, 'loadout.html?date=' + x.date);
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
      await open(p, 'loadout.html?date=' + x.date);
      const row = 'tr[data-row="' + x.row + '"]';
      await p.waitForSelector(row, { timeout: 20000 });
      await p.click(row + ' button.state');
      const t0 = Date.now();
      await timed(p, rec, step + ' back to Not started', () => p.click('#state-pop [data-s="NOT_STARTED"]'), { fn: (s) => { const e = document.querySelector(s); return e && !e.classList.contains('done') && !e.classList.contains('loading'); }, arg: row });
      for (let i = 0; i < 40 && !p.w.calls.some(c => c.at >= t0 && c.status); i++) await p.waitForTimeout(250);
      await p.waitForTimeout(1000);
      await p.fill(row + ' input[data-k="trailer"]', x.trailer);
      await p.press(row + ' input[data-k="trailer"]', 'Enter');
      await p.waitForTimeout(2000);
      // Its own trailer again, checked on a fresh page (once more if the test trailer is still on it).
      await open(p, 'loadout.html?date=' + x.date);
      await p.waitForSelector(row, { timeout: 20000 });
      if ((await p.inputValue(row + ' input[data-k="trailer"]')).replace(/^T-/, '') !== x.trailer.replace(/^T-/, '')) {
        await p.fill(row + ' input[data-k="trailer"]', x.trailer);
        await p.press(row + ' input[data-k="trailer"]', 'Enter');
        await p.waitForTimeout(2000);
      }
    };
    const check = async (step, temp) => {
      await open(p, 'yard.html');
      const row = '#rows tr[data-trailer="' + tt + '"]';
      await p.waitForSelector(row + ' .yd-temp:not([disabled])', { timeout: 30000 }).catch(() => {});
      if (!(await p.$(row + ' .yd-temp:not([disabled])'))) {
        // Once more on a fresh page, then say what the yard shows for it.
        await p.waitForTimeout(15000);
        await open(p, 'yard.html');
        await p.waitForSelector(row + ' .yd-temp:not([disabled])', { timeout: 30000 }).catch(() => {});
        if (!(await p.$(row + ' .yd-temp:not([disabled])'))) {
          const shows = await p.evaluate((s) => { const r = document.querySelector(s); return r ? r.innerText.replace(/\s+/g, ' ').slice(0, 200) : 'not listed'; }, row);
          throw new Error(step + ': ' + tt + ' did not come up due on Yard Checks (it shows: ' + shows + ')');
        }
      }
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
    await open(p, 'loadout.html?date=' + picks[0].date);
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
    // Extra lines an earlier run of this test added and could not remove (practice copy only) come off first.
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const old = (await db.collection('runs').where('addedBy', '==', EMAIL).get()).docs.filter(d => d.data().extraRun === true);
    for (const d of old) await d.ref.delete();
    rec.cleared = old.map(d => d.id);
    await open(p, 'weekly.html');
    await p.waitForSelector('#rows td.run-name.pickable', { timeout: 20000 });
    rec.before = await p.$$eval('#rows tr.extra-run', x => x.length);
    const name = await p.$eval('#rows td.run-name.pickable', td => { td.click(); return td.textContent.trim(); });
    rec.run = name;
    await p.waitForSelector('#rows .xr-plus', { timeout: 8000 });
    const t0 = Date.now();
    try {
      await timed(p, rec, 'extra line shows', () => p.click('#rows .xr-plus'), { fn: (n) => document.querySelectorAll('#rows tr.extra-run').length > n, arg: rec.before });
    } catch (e) {
      const c = p.w.calls.find(x => x.at >= t0 && x.op === 'addExtraRun');
      // Saved but not shown: does it show after a reload (the screen did not redraw) or not at all? Then take the line off again
      // (practice copy) and say so.
      rec.shot = await shot(p, 'weekly-extra-not-shown').catch(() => '');
      await p.reload();
      await p.waitForSelector('#rows td.run-name', { timeout: 20000 }).catch(() => {});
      await p.waitForTimeout(3000);
      rec.afterReload = await p.$$eval('#rows tr.extra-run', x => x.length);
      const made = (await db.collection('runs').where('addedBy', '==', EMAIL).get()).docs.filter(d => d.data().extraRun === true);
      for (const d of made) await d.ref.delete();
      throw new Error(c && c.status === 200 ? 'BUG: + Extra this week on ' + name + ' saved, but the new line does not show on Weekly (' + made.map(d => d.id + ' weeklyShowMaster=' + d.data().weeklyShowMaster + ' displayWeekly=' + d.data().displayWeekly).join(', ') + '; after a reload ' + (rec.afterReload > rec.before ? 'it shows, so the screen did not redraw' : 'it still does not show') + '); removed again' : e.message);
    }
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

  // 6.61: Plant Production's machine menu is grouped (Fillers, HTST, Boxing & Totes, Blow Mold) and opens the Blow Mold page.
  await write('Plant Production machine menu and Blow Mold page', async (p, rec) => {
    await open(p, 'production.html');
    await p.waitForFunction(() => (document.getElementById('menu') || {}).children && document.querySelectorAll('#menu h3').length, null, { timeout: 20000 });
    rec.groups = await p.$$eval('#menu h3', h => h.map(x => x.textContent.trim()));
    if (!rec.groups.includes('Blow Mold')) throw new Error('the machine menu has no Blow Mold group: ' + rec.groups.join(', '));
    const item = await p.evaluate(() => { const h = [...document.querySelectorAll('#menu h3')].find(x => x.textContent.trim() === 'Blow Mold'); let n = h.nextElementSibling; while (n && n.tagName !== 'H3') { const a = n.matches('a,button') ? n : n.querySelector('a,button'); if (a) { a.setAttribute('data-test-pick', '1'); return a.textContent.trim(); } n = n.nextElementSibling; } return ''; });
    if (!item) throw new Error('nothing under Blow Mold in the machine menu');
    rec.item = item;
    await timed(p, rec, 'Blow Mold page', () => p.click('[data-test-pick]'), { fn: () => /BLOW MOLD/i.test((document.getElementById('page-title') || {}).textContent || '') && /line=ut_prod_blow_mold/.test(location.href) }, 20000);
    rec.boxes = await p.$$eval('#detail h2, #detail h3', h => h.map(x => x.textContent.trim()).slice(0, 12));
    const links = await p.$$eval('#detail .pd-bm-links a', a => a.map(x => x.textContent.trim()));
    if (!links.includes('Line Tablet') || !links.includes('Targets and Sensors')) throw new Error('Making now box links: ' + links.join(', '));
    await shot(p, 'production-blow-mold');
    await open(p, 'line.html?line=ut_prod_blow_mold');
    rec.waitingCards = await p.evaluate(() => (document.body.innerText.match(/WAITING FOR SENSOR/g) || []).length);
  });
  // 6.61: the shift report email lists Box loads (Scheduler loads included). The test adds its own Box load, finds it in the
  // report (Send Current Report opens it, nothing is sent), then deletes the load.
  // 6.61 (#474, look only): on Truck Issues an Idealease truck (the fleet list's LEASE column) can go to the lessor and its open
  // write-up says Leased from Idealease; every open write-up shows a route number, never the route's inside code (rte_...).
  await write('Truck Issues Idealease leased and route number (look only)', async (p, rec) => {
    await open(p, 'issues.html?kind=TRUCK');
    await p.waitForSelector('#rows tr[data-id]', { timeout: 20000 });
    await p.waitForTimeout(2500);
    const rows = await p.evaluate(() => [...document.querySelectorAll('#rows tr[data-id]')].map(tr => { const b = tr.querySelector('[data-step="lessor"]'); return { id: tr.dataset.id, unit: tr.children[0].textContent.trim(), lessorOn: !!b && !b.disabled, title: b ? b.title : '', garage: tr.children[7] ? tr.children[7].textContent.trim() : '' }; }));
    rec.rows = rows.length;
    const leased = rows.filter(r => /Idealease/i.test(r.title) || /Idealease/i.test(r.garage));
    rec.idealease = leased.map(r => r.unit);
    if (!leased.length) throw new Error('no open truck write-up shows Idealease as its lessor; lessor buttons: ' + JSON.stringify(rows.slice(0, 8).map(r => r.unit + ' ' + (r.lessorOn ? 'on' : 'off') + ' ' + r.title.slice(0, 50))));
    const open1 = async (id) => {
      const sel = 'tr[data-id="' + id + '"] [data-open]';
      if (!(await p.$(sel))) return '';
      await p.click(sel);
      await p.waitForSelector('tr.issue-more', { timeout: 5000 });
      const t = (await p.textContent('tr.issue-more')).replace(/\s+/g, ' ');
      await p.click(sel);
      return t;
    };
    const lt = await open1(leased[0].id);
    rec.leasedText = lt.slice(0, 200);
    if (!/Leased from Idealease/i.test(lt)) throw new Error(leased[0].unit + ' open write-up does not say Leased from Idealease: ' + lt.slice(0, 200));
    rec.steps.push({ what: 'Idealease truck ' + leased[0].unit + ' says Leased from Idealease', ms: 0 });
    // Up to 12 open write-ups: none shows the route's inside code; those with a route show a number.
    rec.routes = [];
    for (const r of rows.slice(0, 12)) {
      const t = await open1(r.id);
      if (/rte_/i.test(t)) throw new Error(r.unit + ' open write-up shows the route code: ' + t.slice(0, 200));
      const m = t.match(/route ([^·]+)·/);
      if (m) { rec.routes.push(r.unit + ' route ' + m[1].trim()); if (!/^\d+[A-Z]?(\s|$)/i.test(m[1].trim())) throw new Error(r.unit + ' shows route "' + m[1].trim() + '", not a number'); }
    }
    rec.steps.push({ what: 'routes shown as numbers (' + rec.routes.length + ' with a route)', ms: 0 });
    await shot(p, 'truck-issues-leased');
  });

  // 6.62 (#477): a write-up sent to the lessor shows the lessor whole under Emailed (green once the email went, red while not) and
  // a dash under Garage, at 1536, 1920 and on a phone. Pressing Lessor would email Idealease and cannot be undone, so the test
  // (6.62 #480: a sent time ending in Z is a blank email from before the fix, so it counts as not sent.)
  // writes two test write-ups of its own on the practice copy (an Idealease truck, already marked sent), looks, and deletes them.
  await write('Truck Issues lessor under Emailed', async (p, rec) => {
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const unit = (report.writes.find(w => w.name === 'Truck Issues Idealease leased and route number (look only)') || {}).idealease || [];
    if (!unit.length) throw new Error('no Idealease truck found to use');
    const at = new Date(Date.now() - 1800000).toISOString(), ids = ['PRACTICE_TEST_lessor_sent', 'PRACTICE_TEST_lessor_unsent'];
    const doc = (id, text, emailed) => ({ record_id: 'MAIL|' + id + '|tractor', kind: 'TRUCK', truck_number: unit[0], driver: 'PRACTICE TEST', route_id: '', issue_details: text,
      status: 'OPEN', opened_at: at, source_type: 'PRACTICE_TEST', source_id: id,
      notes: 'Sent to lessor Idealease ' + at + ' by practice.audit@uniteddairy.com' + (emailed ? '\nRepair email sent ' + at.replace(/\.\d+Z$/, '-00:00') + ' to practice-test (not sent)' : '') });
    let err = '';
    try {
      // Two Idealease trucks (one write-up each), as write-ups on one truck the same day are one row.
      if (unit.length < 2) unit.push(unit[0]);
      await db.collection('maintenance').doc(ids[0]).set(doc(ids[0], 'Practice test: sent to lessor, emailed', true));
      await db.collection('maintenance').doc(ids[1]).set(Object.assign(doc(ids[1], 'Practice test: sent to lessor, not emailed', false), { truck_number: [...new Set(unit)][1] || unit[0] }));
      for (const [w, h] of [[1536, 790], [1920, 950], [390, 844]]) {
        await p.setViewportSize({ width: w, height: h });
        await open(p, 'issues.html?kind=TRUCK');
        await p.waitForFunction(() => [...document.querySelectorAll('#rows tr[data-id] td.wrong')].filter(td => /Practice test: sent to lessor/.test(td.textContent)).length >= 2, null, { timeout: 20000 });
        await p.waitForTimeout(800);
        const cells = await p.evaluate((xs) => xs.map(id => {
          const want = id.endsWith('_unsent') ? /not emailed/ : /lessor, emailed/;
          const tr = [...document.querySelectorAll('#rows tr[data-id]')].find(t => { const w = t.querySelector('td.wrong'); return w && want.test(w.textContent); }), head = [...document.querySelectorAll('#head th')].map(t => t.textContent.trim());
          const ei = head.indexOf('Emailed'), gi = head.indexOf('Garage'), td = tr.children[ei], pill = td && td.querySelector('.pill');
          const b = td ? td.getBoundingClientRect() : null, pr = pill ? pill.getBoundingClientRect() : null;
          return { id, emailed: td ? td.textContent.trim() : '', cls: pill ? pill.className : '', garage: tr.children[gi] ? tr.children[gi].textContent.trim() : '',
            whole: !!pr && pr.width > 0 && pr.left >= b.left - 1 && pr.right <= b.right + 1 && pill.scrollWidth <= pill.clientWidth + 1, shown: !!pr && pr.width > 0 };
        }), ids);
        rec['w' + w] = cells;
        await p.evaluate(() => { const td = [...document.querySelectorAll('#rows td.wrong')].find(t => /Practice test: sent to lessor/.test(t.textContent)); if (td) td.scrollIntoView({ block: 'center', inline: 'center' }); });
        await shot(p, 'truck-issues-emailed-' + w);
        // Every column heading whole (none cut, like REVIEWED).
        const cutHeads = await p.evaluate(() => [...document.querySelectorAll('#head th')].filter(th => th.scrollWidth > th.clientWidth + 1).map(th => th.textContent.trim()));
        if (w !== 390 && cutHeads.length) throw new Error(w + ': column headings cut: ' + cutHeads.join(', '));
        // The page itself never slides sideways (on a phone only the list's own box does).
        const pageWide = await p.evaluate(() => ({ page: document.documentElement.scrollWidth, view: innerWidth }));
        rec['page' + w] = pageWide;
        if (pageWide.page > pageWide.view + 1) throw new Error(w + ': the page scrolls sideways (' + pageWide.page + ' wide in ' + pageWide.view + ')');
        const want = [['pill yes'], ['pill bad']];
        cells.forEach((c, i) => {
          if (c.emailed !== 'Idealease') throw new Error(w + ': ' + c.id + ' Emailed shows "' + c.emailed + '"');
          if (c.cls !== want[i][0]) throw new Error(w + ': ' + c.id + ' is ' + c.cls + ', not ' + want[i][0]);
          if (!/^(\u2014|-|)$/.test(c.garage)) throw new Error(w + ': ' + c.id + ' Garage shows "' + c.garage + '"');
          if (!c.whole) throw new Error(w + ': ' + c.id + ' Idealease is cut or outside its column');
        });
        rec.steps.push({ what: 'lessor whole under Emailed at ' + w, ms: 0 });
      }
    } catch (e) { err = e.message; }
    await p.setViewportSize({ width: 1536, height: 790 }).catch(() => {});
    for (const id of ids) await db.collection('maintenance').doc(id).delete().catch(e => { err = (err ? err + '; ' : '') + 'delete ' + id + ': ' + e.message; });
    const left = await Promise.all(ids.map(id => db.collection('maintenance').doc(id).get().then(d => d.exists)));
    if (left.some(Boolean)) err = (err ? err + '; ' : '') + 'test write-ups not deleted';
    else rec.steps.push({ what: 'test write-ups deleted', ms: 0 });
    if (err) throw new Error(err);
  });

  // 6.63 (#483, look only): the Plant Scheduler week cards show only the load's name and its time, both whole, at 1536, 1920 and a
  // tablet. A week with no loads looks at the next week.
  await write('Scheduler week cards name and time only (look only)', async (p, rec) => {
    for (const [w, h] of [[1536, 790], [1920, 950], [1024, 768]]) {
      await p.setViewportSize({ width: w, height: h });
      let cards = null;
      for (const add of [0, 7, 14]) {
        const d = new Date(operatingDay() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + add);
        await open(p, 'scheduler.html?view=week&date=' + d.toISOString().slice(0, 10));
        await p.waitForSelector('.sc-weekgrid', { timeout: 20000 });
        await p.waitForTimeout(1500);
        cards = await p.evaluate(() => [...document.querySelectorAll('.sc-weekgrid .sc-load')].map(b => {
          const kids = [...b.children], col = b.closest('.sc-col').getBoundingClientRect(), r = b.getBoundingClientRect();
          return { parts: kids.map(c => c.tagName + ':' + c.textContent.trim()), cut: kids.filter(c => c.scrollWidth > c.clientWidth + 1).map(c => c.textContent.trim()),
            inside: r.left >= col.left - 1 && r.right <= col.right + 1 };
        }));
        if (cards.length) { rec['week' + w] = d.toISOString().slice(0, 10); break; }
      }
      if (!cards.length) throw new Error(w + ': no loads on the Scheduler this week or the next two');
      rec['w' + w] = cards.length + ' cards';
      for (const c of cards) {
        if (c.parts.length !== 2 || !/^STRONG:\S/.test(c.parts[0]) || !/^SPAN:(\d{1,2}:\d\d [AP]M)?$/.test(c.parts[1])) throw new Error(w + ': a card shows more than the name and time: ' + JSON.stringify(c.parts));
        if (c.cut.length) throw new Error(w + ': card words cut: ' + c.cut.join(', '));
        if (!c.inside) throw new Error(w + ': a card sticks out of its day: ' + c.parts.join(' '));
      }
      rec.steps.push({ what: cards.length + ' cards name and time only at ' + w, ms: 0 });
      await shot(p, 'scheduler-week-' + w);
    }
    await p.setViewportSize({ width: 1536, height: 790 });
  });

  // 6.63 (#482): Home has the four group cards; the Plant Operations page has the plant's department cards and each opens.
  await write('Plant reorg Home and Plant Operations cards (look only)', async (p, rec) => {
    await open(p, 'index.html');
    // An administrator lands on the Operations Overview first: Uniontown opens its own Home.
    const plant = '.co-plant[data-plant="fac_uniontown"] header strong';
    await p.waitForSelector('.hq-card, ' + plant, { timeout: 20000 });
    if (!(await p.$('.hq-card'))) { await p.click(plant); await p.waitForSelector('.hq-card', { timeout: 20000 }); }
    rec.home = await p.$$eval('.hq-card > strong', c => c.map(x => x.textContent.trim()));
    for (const want of ['Plant Operations', 'Route Distribution', 'Reports']) if (!rec.home.includes(want)) throw new Error('Home has no ' + want + ' card: ' + rec.home.join(', '));
    const cut = await p.$$eval('.hq-main, .hq-sub, .hq-card a.open-text', a => a.filter(x => x.offsetParent && x.scrollWidth > x.clientWidth + 1).map(x => x.textContent.trim()));
    if (cut.length) throw new Error('Home buttons cut: ' + cut.join(', '));
    await open(p, 'group.html?g=plantops');
    await p.waitForSelector('.launch-card', { timeout: 20000 });
    rec.plantops = await p.$$eval('.launch-card', c => c.map(x => x.dataset.side));
    for (const want of ['plant', 'production', 'pmaint', 'shipping']) if (!rec.plantops.includes(want)) throw new Error('Plant Operations has no ' + want + ' card: ' + rec.plantops.join(', '));
    await shot(p, 'plant-operations');
    rec.opened = [];
    for (const side of rec.plantops) {
      await open(p, 'group.html?g=plantops');
      await p.waitForSelector('.launch-card[data-side="' + side + '"]', { timeout: 20000 });
      await p.click('.launch-card[data-side="' + side + '"]');
      await p.waitForTimeout(2500);
      const errs = p.w.errors.length;
      rec.opened.push(side + ' -> ' + p.url().replace(/^.*\//, '').slice(0, 60));
      if (errs) throw new Error('opening ' + side + ' gave a page error: ' + p.w.errors[0]);
    }
    rec.steps.push({ what: 'cards ' + rec.plantops.join(', ') + ' open', ms: 0 });
  });
  // 6.63 (#485): a grade on the Driver Scorecard opens that driver's report for that area, and Back returns to the board.
  await write('Scorecard grade opens its report', async (p, rec) => {
    await open(p, 'scorecard.html');
    await p.waitForSelector('.sc-go', { timeout: 20000 }).catch(() => {});
    if (!(await p.$('.sc-go'))) throw new Error('no grade to click on the Driver Scorecard');
    rec.grade = await p.$eval('.sc-go', b => b.title);
    await timed(p, rec, 'report opens', () => p.click('.sc-go >> nth=0'), { fn: () => !!document.querySelector('.sc-report h2') });
    rec.report = await p.textContent('.sc-report h2');
    rec.rows = await p.$$eval('.sc-report-table tbody tr', r => r.length);
    const cut = await p.$$eval('.sc-report th, .sc-report-tiles span, .sc-report-tiles b', a => a.filter(x => x.scrollWidth > x.clientWidth + 1).map(x => x.textContent.trim()));
    if (cut.length) throw new Error('report words cut: ' + cut.join(', '));
    await shot(p, 'scorecard-report');
    await timed(p, rec, 'back to the scorecard', () => p.click('.sc-report-back'), { fn: () => !document.querySelector('.sc-report') && !!document.querySelector('.sc-go') });
  });
  // 6.63 (#488): People & Roles has a Home screen drop-down per person that saves when picked; the test picks one for its own
  // practice account, then puts it back.
  await write('People & Roles Home screen saves when picked', async (p, rec) => {
    await open(p, 'administration.html?item=people');
    const sel = 'select.hs-pick[data-home-for="' + EMAIL + '"]';
    await p.waitForSelector('select.hs-pick', { timeout: 20000 });
    const head = await p.$$eval('.people-table th', t => t.map(x => ({ t: x.textContent.trim(), cut: x.scrollWidth > x.clientWidth + 1 })));
    if (!head.some(h => h.t === 'Home screen')) throw new Error('no Home screen column');
    if (head.some(h => h.cut)) throw new Error('headings cut: ' + head.filter(h => h.cut).map(h => h.t).join(', '));
    if (!(await p.$(sel))) {
      await p.fill('input[type=search], #ap-search, .ap-search input', 'practice.audit').catch(() => {});
      await p.waitForSelector(sel, { timeout: 8000 }).catch(() => {});
    }
    if (!(await p.$(sel))) throw new Error('the practice account has no Home screen drop-down');
    const was = await p.inputValue(sel);
    const pick = await p.$eval(sel, (s, w) => { const o = [...s.options].find(x => x.value && x.value !== w); return o ? o.value : ''; }, was);
    if (!pick) throw new Error('no Home screen choices');
    Object.assign(rec, { was, pick });
    let t = Date.now();
    await p.selectOption(sel, pick);
    for (let i = 0; i < 60 && !p.w.calls.some(c => c.at >= t && c.op === 'setHomeScreen' && c.status); i++) await p.waitForTimeout(250);
    let c = p.w.calls.find(x => x.at >= t && x.op === 'setHomeScreen');
    if (!c || c.status !== 200 || c.error) throw new Error('the Home screen did not save: ' + JSON.stringify(c || 'no call'));
    rec.steps.push({ what: 'Home screen saved', ms: Date.now() - t });
    await open(p, 'administration.html?item=people');
    await p.waitForSelector(sel, { timeout: 20000 });
    if ((await p.inputValue(sel)) !== pick) throw new Error('the Home screen did not stay after a reload');
    t = Date.now();
    await p.selectOption(sel, was);
    for (let i = 0; i < 60 && !p.w.calls.some(x => x.at >= t && x.op === 'setHomeScreen' && x.status); i++) await p.waitForTimeout(250);
    c = p.w.calls.find(x => x.at >= t && x.op === 'setHomeScreen');
    if (!c || c.status !== 200 || c.error) throw new Error('the Home screen was not put back: ' + JSON.stringify(c || 'no call'));
    rec.steps.push({ what: 'put back', ms: Date.now() - t });
  });

  // 6.64 (#490, look only): the shift report email lists each delivery day once per load type (left over first), and its headings
  // count loaded and not loaded. Shift Reports shows each sent report as the email reads, drawn by today's code.
  // 6.64 (#491): every machine but the Blow Mold has one machine page with its areas on tabs up beside its name. The test opens
  // each machine from the menu and each of its tabs (look only), at 1536 and 1920, and on a tablet for the first machine.
  await write('Plant Production machine page tabs (look only)', async (p, rec) => {
    await open(p, 'production.html');
    await p.waitForFunction(() => document.querySelectorAll('#menu button[data-tab]').length > 1, null, { timeout: 30000 });
    const ids = await p.$$eval('#menu button[data-tab]', b => b.map(x => ({ id: x.dataset.tab, name: (x.querySelector('b') || x).firstChild.textContent.trim() })));
    const machines = ids.filter(m => m.id && m.id !== 'ALL' && !/^all machines$/i.test(m.name));
    rec.machines = machines.map(m => m.name);
    const blow = machines.filter(m => /blow mold/i.test(m.name)), others = machines.filter(m => !/blow mold/i.test(m.name));
    if (!others.length) throw new Error('no machines but the Blow Mold in the menu: ' + rec.machines.join(', '));
    const bad = [];
    rec.seen = {};
    const sizes = [[1536, 790], [1920, 1080], [1024, 768]];
    for (const [w, h] of sizes) {
      await p.setViewportSize({ width: w, height: h });
      for (const m of (w === 1024 ? others.slice(0, 1) : others)) {
        await open(p, 'production.html?line=' + encodeURIComponent(m.id));
        await p.waitForSelector('#detail:not([hidden]) .pm-tabbody', { timeout: 30000 }).catch(() => {});
        if (!(await p.$('#detail:not([hidden]) .pm-tabbody'))) { bad.push(w + ' ' + m.name + ': no machine page'); continue; }
        const title = (await p.textContent('#page-title')).trim();
        if (title.toUpperCase() !== m.name.toUpperCase()) bad.push(w + ' ' + m.name + ': title says ' + title);
        if (await p.isHidden('#pmtabs')) { bad.push(w + ' ' + m.name + ': no tabs beside the name'); continue; }
        const tabs = await p.$$eval('#pmtabs [data-pmtab]', b => b.map(x => ({ id: x.dataset.pmtab, t: x.firstChild.textContent.trim() })));
        if (w === 1536) rec.seen[m.name] = tabs.map(t => t.t);
        for (const need of ['Made vs target', 'Each product', 'Stops & waste', 'Changeovers', 'Crew & notes']) if (!tabs.some(t => t.t === need)) bad.push(w + ' ' + m.name + ': no ' + need + ' tab');
        for (const t of tabs) {
          await p.click('#pmtabs [data-pmtab="' + t.id + '"]');
          const shown = await p.waitForSelector('#detail .pm-tabbody[data-tab="' + t.id + '"]', { timeout: 15000 }).then(() => true).catch(() => false);
          if (!shown) { bad.push(w + ' ' + m.name + ' / ' + t.t + ': tab did not open'); continue; }
          if (!new RegExp('tab=' + t.id).test(p.url())) bad.push(w + ' ' + m.name + ' / ' + t.t + ': address does not keep the tab');
          const look = await p.evaluate(() => {
            const body = document.querySelector('#detail .pm-tabbody');
            const cut = [...document.querySelectorAll('#pmtabs [data-pmtab], #detail .pm-tabbody th, #detail .pm-tabbody h3, #detail .pm-now span, #detail .pm-now b')].filter(x => x.offsetParent && x.scrollWidth > x.clientWidth + 1).map(x => x.textContent.trim().slice(0, 40));
            return { cut, side: document.documentElement.scrollWidth > innerWidth + 1, empty: !body.textContent.trim() };
          });
          if (look.cut.length) bad.push(w + ' ' + m.name + ' / ' + t.t + ': words cut: ' + look.cut.join(', '));
          if (look.side) {
            // Name what sticks out past the right edge, so the fix knows where to look.
            const wide = await p.evaluate(() => [...document.querySelectorAll('body *')].filter(x => x.offsetParent && x.getBoundingClientRect().right > innerWidth + 1 && !(x.parentElement && x.parentElement.getBoundingClientRect().right > innerWidth + 1)).slice(0, 3).map(x => x.tagName.toLowerCase() + (x.id ? '#' + x.id : '') + (x.className && typeof x.className === 'string' ? '.' + x.className.trim().split(/\s+/).join('.') : '') + ' right ' + Math.round(x.getBoundingClientRect().right) + 'px wide ' + Math.round(x.getBoundingClientRect().width) + 'px "' + (x.textContent || '').trim().slice(0, 40) + '"'));
            bad.push(w + ' ' + m.name + ' / ' + t.t + ': page scrolls sideways (' + wide.join(', ') + ')');
          }
          if (look.empty) bad.push(w + ' ' + m.name + ' / ' + t.t + ': tab is blank');
        }
        if (w !== 1920) await shot(p, 'machine-' + slug(m.name) + '-' + w);
      }
    }
    // The Blow Mold keeps its own page, with no tabs.
    await p.setViewportSize({ width: 1536, height: 790 });
    for (const m of blow) {
      await open(p, 'production.html?line=' + encodeURIComponent(m.id));
      await p.waitForSelector('#detail:not([hidden]) .pd-bm-links', { timeout: 30000 }).catch(() => {});
      if (!(await p.$('#detail:not([hidden]) .pd-bm-links'))) bad.push(m.name + ': its own page did not show');
      if (!(await p.isHidden('#pmtabs'))) bad.push(m.name + ': shows machine tabs, it should keep its own page');
    }
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    if (bad.length) throw new Error(bad.slice(0, 8).join('; '));
  });
  // 6.64 (#493): the "? Help" button on the right before Administration opens the Help guide in the same window on that screen's
  // part; Back comes straight back; search works; every topic opens and its Open this screen goes to a real page (look only).
  await write('Help guide (look only)', async (p, rec) => {
    const bad = [];
    for (const [w, h] of [[1536, 790], [1920, 1080], [390, 844]]) {
      await p.setViewportSize({ width: w, height: h });
      for (const [screen, want] of [['daily.html', /^Daily Dispatch$/], ['loadout.html?area=CASE', /^Loading/], ['administration.html?item=people', /^People & Roles$/], ['production.html', /Production/]]) {
        if (w !== 1536 && screen !== 'daily.html') continue;
        await open(p, screen);
        await p.waitForSelector('#go-help', { timeout: 20000 }).catch(() => {});
        if (!(await p.$('#go-help'))) { bad.push(w + ' ' + screen + ': no ? Help button'); continue; }
        if (w >= 1536) {
          const next = await p.$eval('#go-help', b => b.nextElementSibling && b.nextElementSibling.id);
          if (screen !== 'administration.html?item=people' && next !== 'go-admin') bad.push(w + ' ' + screen + ': ? Help is not just before Administration');
          if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) bad.push(w + ' ' + screen + ': header scrolls sideways');
        }
        const pages = p.context().pages().length;
        await p.click('#go-help');
        const ok = await p.waitForSelector('#help-read .help-title', { timeout: 20000 }).then(() => true).catch(() => false);
        if (!ok) { bad.push(w + ' ' + screen + ': Help did not open'); continue; }
        if (p.context().pages().length !== pages) bad.push(w + ' ' + screen + ': Help opened a new window');
        if (!/\/help\.html/.test(p.url())) bad.push(w + ' ' + screen + ': not on the Help page');
        const t = (await p.textContent('#help-read .help-title')).trim();
        rec[w + ' ' + screen] = t;
        if (!want.test(t)) bad.push(w + ' ' + screen + ': Help opened on ' + t);
        if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) bad.push(w + ' Help page scrolls sideways');
        await shot(p, 'help-' + slug(screen) + '-' + w);
        await p.click('#go-back');
        const back = await p.waitForURL(u => !/help\.html/.test(String(u)), { timeout: 15000 }).then(() => true).catch(() => false);
        if (!back) bad.push(w + ' ' + screen + ': Back did not come back');
      }
    }
    await p.setViewportSize({ width: 1536, height: 790 });
    await open(p, 'help.html');
    await p.waitForSelector('#help-list .help-item', { timeout: 20000 });
    const items = await p.$$eval('#help-list .help-item', a => a.map(x => ({ id: x.dataset.id, t: x.textContent.trim() })));
    rec.topics = items.length;
    if (items.length < 20) bad.push('only ' + items.length + ' help topics');
    const links = new Set();
    for (const it of items) {
      await p.click('#help-list .help-item[data-id="' + it.id + '"]');
      const t = await p.waitForFunction(id => { const h = document.querySelector('#help-read .help-title'), on = document.querySelector('#help-list .help-item.on'); return h && on && on.dataset.id === id && h.textContent.trim(); }, it.id, { timeout: 8000 }).then(r => r.jsonValue()).catch(() => '');
      if (!t) { bad.push('topic ' + it.t + ' did not open'); continue; }
      const text = (await p.textContent('#help-read .help-text')).trim();
      if (text.length < 20) bad.push('topic ' + it.t + ' is blank');
      const go = await p.$eval('#help-read', r => { const a = r.querySelector('.help-go'); return a ? a.getAttribute('href') : ''; });
      if (go) links.add(go.split('?')[0].split('#')[0]);
    }
    rec.screens = [...links];
    for (const l of links) {
      const r = await p.request.get(new URL(l, SITE + '/').href).catch(e => ({ status: () => String(e.message).slice(0, 60) }));
      if (r.status() !== 200) bad.push('Open this screen ' + l + ' gives ' + r.status());
    }
    await p.fill('#help-q', 'extinguisher');
    await p.waitForTimeout(800);
    const found = await p.$$eval('#help-list .help-item', a => a.map(x => x.textContent.trim()));
    rec.search = found.slice(0, 6);
    if (!found.length || found.length >= items.length) bad.push('search did not narrow the topics (' + found.length + ')');
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    if (bad.length) throw new Error(bad.slice(0, 8).join('; '));
  });
  await write('Shift report each delivery day once (look only)', async (p, rec) => {
    await open(p, 'shiftreports.html');
    await p.waitForSelector('#rows tr[data-id]', { timeout: 30000 }).catch(() => {});
    const ids = (await p.$$eval('#rows tr[data-id]', t => t.map(x => x.dataset.id))).slice(0, 6);
    if (!ids.length) throw new Error('no sent shift reports to look at');
    rec.looked = [];
    for (const id of ids) {
      await p.click('#rows tr[data-id="' + id + '"]');
      await p.waitForTimeout(1200);
      const r = await p.evaluate(() => {
        const d = document.getElementById('frame').contentDocument;
        if (!d || !d.body) return null;
        const inner = [...d.querySelectorAll('table')].filter(t => !t.querySelector('table'));
        const lists = inner.map(t => [...t.querySelectorAll('td[colspan="4"]')].map(td => td.textContent.trim()).filter(Boolean)).filter(x => x.length);
        const text = d.body.innerText;
        return { lists, counts: (text.match(/\d+ (not )?loaded/gi) || []).slice(0, 8), grid: inner.length, pre: !!d.querySelector('pre') };
      });
      if (!r || r.pre || !r.grid) { rec.looked.push(id + ': plain text'); continue; }
      rec.looked.push(id + ': ' + r.lists.map(l => l.join(' / ')).join(' | ') + ' · ' + r.counts.join(', '));
      r.lists.forEach(hs => {
        const dup = hs.filter((h, j) => hs.indexOf(h) !== j);
        if (dup.length) throw new Error('report ' + id + ' lists a day twice: ' + dup.join(', ') + ' (' + hs.join(' | ') + ')');
        if (hs.findIndex(h => /^Left over/.test(h)) > 0) throw new Error('report ' + id + ': Left over is not first: ' + hs.join(' | '));
      });
    }
    if (rec.looked.every(x => /plain text$/.test(x))) throw new Error('no sent report has the email layout to look at');
    rec.steps.push({ what: rec.looked.length + ' sent reports drawn, each day once', ms: 0 });
    await shot(p, 'shift-report-days');
  });

  await write('Shift report shows Box loads', async (p, rec) => {
    await open(p, 'loadout.html?area=BOXING');
    await p.waitForSelector('#rows tr', { timeout: 20000 });
    const had = await p.evaluate(() => [...document.querySelectorAll('#rows tr[data-row] [data-sedit]')].map(b => b.closest('tr').dataset.row));
    await p.click('#add-load');
    await p.waitForSelector('#sched-modal:not([hidden]) #s-route');
    // Add Load fills its Route / Run list from the routes read when it opens (it does not fill in later): opened before the
    // screen has read them, it is empty; then Cancel and open it again, as a person would.
    for (let i = 0; i < 6 && !(await p.evaluate(() => [...document.querySelectorAll('#s-route option')].some(o => o.value !== ''))); i++) {
      rec.addLoadReopened = (rec.addLoadReopened || 0) + 1;
      await p.click('#sched-modal [data-close]');
      await p.waitForTimeout(3000);
      await p.click('#add-load');
      await p.waitForSelector('#sched-modal:not([hidden]) #s-route');
    }
    const pick = await p.$$eval('#s-route option', o => { const x = o.find(v => v.value !== ''); return x ? { v: x.value, t: x.textContent } : null; });
    if (!pick) throw new Error('Add Load offers no route / run');
    await p.selectOption('#s-route', pick.v);
    await p.selectOption('#s-kind', 'BOXING');
    await p.selectOption('#s-type', 'ROUTE');
    if (!(await p.inputValue('#s-time'))) await p.fill('#s-time', '23:30');
    await p.fill('#s-notes', 'Practice copy test load (deleted by the test)');
    await p.click('#s-save');
    await p.waitForSelector('#sched-confirm-modal:not([hidden]) #sc-confirm', { timeout: 8000 });
    await timed(p, rec, 'Add Load', () => p.click('#sc-confirm'), { fn: (n) => document.querySelectorAll('#rows tr[data-row] [data-sedit]').length > n, arg: had.length }, 20000);
    const row = (await p.evaluate(() => [...document.querySelectorAll('#rows tr[data-row] [data-sedit]')].map(b => b.closest('tr').dataset.row))).find(r => !had.includes(r));
    if (!row) throw new Error('the added Box load did not show');
    const sel = 'tr[data-row="' + row + '"]';
    rec.route = await p.$eval(sel, tr => tr.children[0].textContent.trim());
    let err = '';
    try {
      await open(p, 'manager.html?report=1');
      await p.waitForFunction(() => /\d/.test((document.getElementById('rp-body') || {}).textContent || ''), null, { timeout: 30000 });
      await p.waitForTimeout(1500);
      rec.report = await p.evaluate(() => document.getElementById('rp-body').innerText.replace(/\s+/g, ' ').slice(0, 600));
      rec.inReport = await p.evaluate((rt) => [...document.querySelectorAll('#rp-body span b, #rp-body li b')].some(b => b.textContent.trim().split(/\s/)[0] === rt), rec.route);
      if (!rec.inReport) throw new Error('the added Box load (route ' + rec.route + ') is not in the report');
      await shot(p, 'report-box-load');
    } catch (e) { err = e.message; }
    // Delete the test's load.
    await open(p, 'loadout.html?area=BOXING');
    await p.waitForSelector(sel, { timeout: 20000 });
    await p.click(sel + ' [data-sedit]');
    await p.waitForSelector('#sched-modal:not([hidden]) #s-delete:not([hidden])');
    await p.click('#s-delete');
    await timed(p, rec, 'Delete Load', () => p.click('#s-delete'), { fn: (s) => !document.querySelector(s), arg: sel });
    await p.waitForTimeout(2000);
    const bad = p.w.calls.filter(c => c.status !== 200 || c.error);
    if (bad.length) err = (err ? err + '; ' : '') + 'a save answered ' + bad[0].status + ' ' + bad[0].error.slice(0, 150);
    if (err) throw new Error(err);
  });

  // 6.65 (#498): a Scheduler load leaves on its delivery day, not its load day. The test adds its own Box load that loads today
  // for a pickup three days out at 12:30 AM (long past on today's clock), checks the shift report does not call it BEHIND, then
  // deletes the load.
  // 6.68 (#520, look only): the shift report's banner is red with routes BEHIND, yellow "N LOADS POTENTIALLY LATE" when no route is
  // behind but the late forecast has late loads, and green only when all is on time. Nothing is sent (no Send button is pressed).
  await write('Shift report Potentially Late banner (look only)', async (p, rec) => {
    await p.setViewportSize({ width: 1536, height: 790 });
    await open(p, 'manager.html?report=1');
    await p.waitForFunction(() => /\d/.test((document.getElementById('rp-body') || {}).textContent || ''), null, { timeout: 30000 });
    await p.waitForTimeout(1500);
    const t0 = Date.now();
    const r = await p.evaluate(() => {
      const b = document.querySelector('#rp-body .mc-banner'), fc = [...document.querySelectorAll('#rp-body section h3')].find(h => /Late forecast/i.test(h.textContent));
      const m = fc ? /(\d+) potentially late/i.exec(fc.textContent) : null;
      return { cls: b ? b.className : '', text: b ? b.querySelector('b').textContent.trim() : '', bg: b ? getComputedStyle(b).backgroundColor : '', forecast: fc ? fc.textContent.trim().slice(0, 80) : '', late: m ? Number(m[1]) : 0,
        behind: document.querySelectorAll('#rp-body span.behind').length };
    });
    Object.assign(rec, r);
    await shot(p, 'report-banner');
    const bad = [];
    if (!r.cls) bad.push('no banner on the report');
    else if (r.behind) { if (!/\bbad\b/.test(r.cls) || !/BEHIND/.test(r.text)) bad.push('routes BEHIND but the banner is ' + r.text); }
    else if (r.late) {
      if (!/\bwarn\b/.test(r.cls) || !new RegExp('^\\W*' + r.late + ' LOADS? POTENTIALLY LATE$').test(r.text)) bad.push('forecast has ' + r.late + ' potentially late but the banner is "' + r.text + '"');
      if (r.bg !== 'rgb(245, 197, 24)') bad.push('Potentially Late banner is not yellow (' + r.bg + ')');
    } else if (!/\bgood\b/.test(r.cls) || !/ON TIME/.test(r.text)) bad.push('nothing late or behind but the banner is "' + r.text + '"');
    // Also the Manager Center card's preview.
    await open(p, 'manager.html');
    await p.waitForTimeout(4000);
    rec.card = await p.evaluate(() => { const b = document.querySelector('.mc-banner'); return b ? b.className + ' · ' + b.textContent.trim().slice(0, 80) : ''; });
    if (p.w.calls.some(c => c.at >= t0 && /send|mail|report/i.test(c.op || c.fn || ''))) bad.push('a send call went out: ' + JSON.stringify(p.w.calls.filter(c => c.at >= t0).map(c => c.fn + ':' + c.op)));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  await write('Shift report: later-day Scheduler load not BEHIND', async (p, rec) => {
    const behindOf = async (rt) => {
      await open(p, 'manager.html?report=1');
      await p.waitForFunction(() => /\d/.test((document.getElementById('rp-body') || {}).textContent || ''), null, { timeout: 30000 });
      await p.waitForTimeout(1500);
      return p.evaluate((r) => ({
        behind: [...document.querySelectorAll('#rp-body span.behind b')].filter(b => b.textContent.trim().split(/\s/)[0] === r).length,
        any: [...document.querySelectorAll('#rp-body span b, #rp-body li b')].filter(b => b.textContent.trim().split(/\s/)[0] === r).length
      }), rt);
    };
    await open(p, 'loadout.html?area=BOXING');
    await p.waitForSelector('#rows tr', { timeout: 20000 });
    const had = await p.evaluate(() => [...document.querySelectorAll('#rows tr[data-row] [data-sedit]')].map(b => b.closest('tr').dataset.row));
    await p.click('#add-load');
    await p.waitForSelector('#sched-modal:not([hidden]) #s-route');
    // Add Load fills its Route / Run list from the routes read when it opens (it does not fill in later): opened before the
    // screen has read them, it is empty; then Cancel and open it again, as a person would.
    for (let i = 0; i < 6 && !(await p.evaluate(() => [...document.querySelectorAll('#s-route option')].some(o => o.value !== ''))); i++) {
      rec.addLoadReopened = (rec.addLoadReopened || 0) + 1;
      await p.click('#sched-modal [data-close]');
      await p.waitForTimeout(3000);
      await p.click('#add-load');
      await p.waitForSelector('#sched-modal:not([hidden]) #s-route');
    }
    const pick = await p.$$eval('#s-route option', o => { const x = o.find(v => v.value !== ''); return x ? { v: x.value, t: x.textContent } : null; });
    if (!pick) throw new Error('Add Load offers no route / run');
    const today = operatingDay(), d = new Date(today + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + 3);
    const later = d.toISOString().slice(0, 10);
    await p.selectOption('#s-route', pick.v);
    await p.selectOption('#s-kind', 'BOXING');
    await p.selectOption('#s-type', 'ROUTE');
    await p.fill('#s-load', today);
    await p.fill('#s-date', later);
    await p.fill('#s-time', '00:30');
    await p.fill('#s-notes', 'Practice copy test load (deleted by the test)');
    Object.assign(rec, { today, later });
    await p.click('#s-save');
    await p.waitForSelector('#sched-confirm-modal:not([hidden]) #sc-confirm', { timeout: 8000 });
    await timed(p, rec, 'Add Load', () => p.click('#sc-confirm'), { fn: (n) => document.querySelectorAll('#rows tr[data-row] [data-sedit]').length > n, arg: had.length }, 20000);
    const row = (await p.evaluate(() => [...document.querySelectorAll('#rows tr[data-row] [data-sedit]')].map(b => b.closest('tr').dataset.row))).find(r => !had.includes(r));
    if (!row) throw new Error('the added Box load did not show');
    const sel = 'tr[data-row="' + row + '"]';
    rec.route = await p.$eval(sel, tr => tr.children[0].textContent.trim());
    let err = '';
    try {
      // The same route's other loads may be behind on their own: only a new BEHIND for the route counts.
      const after = await behindOf(rec.route);
      rec.after = after;
      await shot(p, 'report-later-day-load');
      if (!after.any) throw new Error('the added load (route ' + rec.route + ', pickup ' + later + ') is not in the report');
      // Delete first, then look again: the BEHIND count with the load gone is the route's own.
      rec.deleted = true;
    } catch (e) { err = e.message; }
    await open(p, 'loadout.html?area=BOXING');
    await p.waitForSelector(sel, { timeout: 20000 });
    await p.click(sel + ' [data-sedit]');
    await p.waitForSelector('#sched-modal:not([hidden]) #s-delete:not([hidden])');
    await p.click('#s-delete');
    await timed(p, rec, 'Delete Load', () => p.click('#s-delete'), { fn: (s) => !document.querySelector(s), arg: sel });
    await p.waitForTimeout(2000);
    if (!err) {
      const without = await behindOf(rec.route);
      rec.without = without;
      if (rec.after.behind > without.behind) err = 'the load picked up on ' + later + ' shows BEHIND today (route ' + rec.route + ')';
    }
    const bad = p.w.calls.filter(c => c.status !== 200 || c.error);
    if (bad.length) err = (err ? err + '; ' : '') + 'a save answered ' + bad[0].status + ' ' + String(bad[0].error).slice(0, 150);
    if (err) throw new Error(err);
  });
  // 6.65 (#497, look only): the Line Tablet for every line: tabs up top, the Running / Changeover / Down bar, and each tab opens,
  // at tablet and phone widths. Only tabs are pressed (they open a pane); nothing is saved.
  await write('Line Tablet each line and tab (look only)', async (p, rec) => {
    await open(p, 'production.html');
    await p.waitForFunction(() => document.querySelectorAll('#menu button[data-tab]').length > 1, null, { timeout: 30000 });
    const lines = (await p.$$eval('#menu button[data-tab]', b => b.map(x => ({ id: x.dataset.tab, name: (x.querySelector('b') || x).firstChild.textContent.trim() })))).filter(m => m.id && m.id !== 'ALL' && !/^all machines$/i.test(m.name));
    rec.lines = lines.map(m => m.name);
    if (!lines.length) throw new Error('no lines');
    const bad = [];
    rec.tabs = {};
    for (const [w, h] of [[1024, 768], [768, 1024], [390, 844]]) {
      await p.setViewportSize({ width: w, height: h });
      for (const m of lines) {
        await p.evaluate(() => { try { localStorage.removeItem('udProductionLine'); } catch (e) { /* none */ } });
        await open(p, 'line.html?line=' + encodeURIComponent(m.id));
        const up = await p.waitForFunction(() => { const s = document.getElementById('state-name'); return s && s.offsetParent && s.textContent.trim() && document.querySelectorAll('#actions button').length; }, null, { timeout: 30000 }).then(() => true).catch(() => false);
        if (!up) { bad.push(w + ' ' + m.name + ': the tablet did not show its bar and tabs'); continue; }
        const tabs = await p.$$eval('#actions button', b => b.map(x => ({ act: x.dataset.act, t: x.firstChild.textContent.trim() })));
        if (w === 1024) rec.tabs[m.name] = tabs.map(t => t.t);
        if (!tabs.length || tabs[0].t !== 'Line') bad.push(w + ' ' + m.name + ': first tab is ' + (tabs[0] || {}).t);
        const btns = await p.$$eval('#state-btns [data-go]', b => b.map(x => x.dataset.go));
        for (const g of ['run', 'down']) if (!btns.includes(g)) bad.push(w + ' ' + m.name + ': no ' + g + ' button on the bar');
        for (const t of tabs) {
          await p.click('#actions button[data-act="' + t.act + '"]');
          const ok = await p.waitForFunction((a) => { const b = document.querySelector('#actions button[data-act="' + a + '"]'); if (!b || !b.classList.contains('cur')) return false; if (a === 'board') return !document.getElementById('board').hidden; const mp = document.getElementById('mp-body'); return mp && mp.offsetParent && mp.textContent.trim().length > 5; }, t.act, { timeout: 10000 }).then(() => true).catch(() => false);
          if (!ok) { bad.push(w + ' ' + m.name + ' / ' + t.t + ': tab did not open'); continue; }
          const look = await p.evaluate(() => ({
            side: document.documentElement.scrollWidth > innerWidth + 1,
            cut: [...document.querySelectorAll('#actions button, #state-btns button, #state-name, #line-name, .lb-card .eyebrow, #mp-body h3, #mp-body th')].filter(x => x.offsetParent && x.scrollWidth > x.clientWidth + 1).map(x => x.textContent.trim().slice(0, 40))
          }));
          if (look.side) {
            // Name what sticks out past the right edge, so the fix knows where to look.
            const wide = await p.evaluate(() => [...document.querySelectorAll('body *')].filter(x => x.offsetParent && x.getBoundingClientRect().right > innerWidth + 1 && !(x.parentElement && x.parentElement.getBoundingClientRect().right > innerWidth + 1)).slice(0, 3).map(x => x.tagName.toLowerCase() + (x.id ? '#' + x.id : '') + (x.className && typeof x.className === 'string' ? '.' + x.className.trim().split(/\s+/).join('.') : '') + ' right ' + Math.round(x.getBoundingClientRect().right) + 'px wide ' + Math.round(x.getBoundingClientRect().width) + 'px "' + (x.textContent || '').trim().slice(0, 40) + '"'));
            bad.push(w + ' ' + m.name + ' / ' + t.t + ': page scrolls sideways (' + wide.join(', ') + ')');
          }
          if (look.cut.length) bad.push(w + ' ' + m.name + ' / ' + t.t + ': words cut: ' + look.cut.slice(0, 3).join(', '));
        }
        await p.click('#actions button[data-act="board"]').catch(() => {});
        await shot(p, 'tablet-' + slug(m.name) + '-' + w);
      }
    }
    await p.evaluate(() => { try { localStorage.removeItem('udProductionLine'); } catch (e) { /* none */ } });
    const saves = p.w.calls.filter(c => c.fn === 'save');
    rec.saves = saves.map(c => c.op || c.fn);
    rec.bad = bad;
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    if (bad.length) throw new Error(bad.slice(0, 8).join('; '));
  });
  // 6.66 (#502, look only): the plant Maintenance Station lists the plant's own mechanics (Maintenance Schedule Setup, People),
  // never the garage's (Fleet Service Setup, Garage Technicians), at 1536, 1024 and 390.
  await write('Maintenance Station plant mechanics only (look only)', async (p, rec) => {
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const plant = (await db.collection('crewPeople').where('team', '==', 'maint').where('facilityId', '==', 'fac_uniontown').get()).docs
      .filter(d => d.data().status !== 'RETIRED' && String(d.data().name || '').trim()).map(d => ({ id: d.id, name: String(d.data().name).trim() }));
    const garage = (await db.collection('garageTechs').get()).docs.map(d => ({ id: d.id, name: String(d.data().name || '').trim() })).filter(g => g.name);
    rec.plant = plant.length; rec.garage = garage.length;
    const plantIds = new Set(plant.map(x => x.id)), plantNames = new Set(plant.map(x => x.name.toUpperCase()));
    const garageOnly = garage.filter(g => !plantNames.has(g.name.toUpperCase()));
    const bad = [];
    for (const [w, h] of [[1536, 790], [1024, 768], [390, 844]]) {
      await p.setViewportSize({ width: w, height: h });
      await open(p, 'maint-station.html');
      const up = await p.waitForFunction(() => { const s = document.getElementById('strip'); return s && s.textContent.trim(); }, null, { timeout: 30000 }).then(() => true).catch(() => false);
      if (!up) { bad.push(w + ': the mechanics line did not show'); continue; }
      const look = await p.evaluate(() => {
        const s = document.getElementById('strip');
        return { ids: [...s.querySelectorAll('[data-tech]')].map(b => b.dataset.tech), names: [...s.querySelectorAll('[data-tech]')].map(b => b.firstChild ? b.firstChild.textContent.trim() : b.textContent.trim()),
          text: s.innerText.replace(/\s+/g, ' ').trim(), body: document.body.innerText,
          side: document.documentElement.scrollWidth > innerWidth + 1,
          cut: [...s.querySelectorAll('*')].concat([s]).filter(x => x.offsetParent && x.scrollWidth > x.clientWidth + 1).map(x => x.textContent.trim().slice(0, 40)) };
      });
      rec['shown' + w] = look.names.length ? look.names : look.text.slice(0, 120);
      const strangers = look.ids.filter(id => !plantIds.has(id));
      if (strangers.length) bad.push(w + ': not plant mechanics on the line: ' + strangers.join(', '));
      const fromGarage = garageOnly.filter(g => look.body.toUpperCase().includes(g.name.toUpperCase()) && g.name.length > 3).map(g => g.name);
      if (fromGarage.length) bad.push(w + ': garage mechanics shown: ' + fromGarage.slice(0, 4).join(', '));
      if (plant.length && look.ids.length !== plant.length) bad.push(w + ': shows ' + look.ids.length + ' mechanics, the plant has ' + plant.length);
      if (!plant.length && !/No plant mechanics yet/.test(look.text)) bad.push(w + ': no plant mechanics, but the line says: ' + look.text.slice(0, 100));
      if (look.side) bad.push(w + ': page scrolls sideways');
      if (look.cut.length) bad.push(w + ': words cut: ' + look.cut.slice(0, 3).join(', '));
      await shot(p, 'maint-station-' + w);
    }
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.slice(0, 6).join('; '));
  });
  // 6.66 (look only): Plant Production front page (#500), Machine Connections (#504), Upload Center (#505, nothing saved), Case
  // Unloading (#506), Texts (#496, both switches stay Off) and the Driver Roster's Texts ticks, at 1536, 1024 and 390.
  await write('6.66 screens at 1536, 1024 and 390 (look only)', async (p, rec) => {
    const bad = [];
    const pages = [
      ['Plant Production', 'production-home.html', async (w) => {
        await p.waitForFunction(() => { const d = document.querySelector('[data-card="dept"]'); return d && /Fillers/.test(d.textContent); }, null, { timeout: 30000 }).catch(() => {});
        const t = await p.evaluate(() => { const d = document.querySelector('[data-card="dept"]'); return d ? d.innerText : ''; });
        for (const k of ['Fillers', 'HTST', 'Boxing', 'Totes']) if (!new RegExp('\\b' + k + '\\b').test(t)) bad.push(w + ' Plant Production: no ' + k + ' card');
        if (/Blow Mold/i.test(t)) bad.push(w + ' Plant Production: the Blow Mold card is still there');
        if (/Boxing & Totes/.test(t)) bad.push(w + ' Plant Production: Boxing & Totes still one card');
        if (w === 1536 && await p.evaluate(() => document.scrollingElement.scrollHeight > innerHeight + 1)) bad.push('1536x790 Plant Production: does not fit without scrolling');
      }],
      ['Machine Connections', 'administration.html?item=machine-connections', async (w) => {
        await p.waitForFunction(() => /Case Counter|Palletizer|counter box/i.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
        const t = await p.evaluate(() => document.body.innerText);
        if (!/Case Counter|Palletizer|counter box/i.test(t)) bad.push(w + ' Machine Connections: no Case Counters in it');
        if (w === 1536) {
          await open(p, 'administration.html');
          const a = await p.evaluate(() => document.body.innerText);
          for (const n of ['Machine Connections', 'MOCREO Key', 'RedZone Sign-In']) if (!a.includes(n)) bad.push('Administration has no ' + n);
        }
      }],
      ['Upload Center', 'uploads.html', null],
      ['Case Unloading', 'unloading.html', async (w) => {
        if (w !== 1536) return;
        const t = await p.evaluate(() => [...document.querySelectorAll('.trl, .sw-trailer')].map(x => x.textContent.trim()));
        rec.unloadingTrailers = t.slice(0, 12);
      }],
      ['Texts', 'texts.html', async (w) => {
        await p.waitForFunction(() => (document.getElementById('state-text') || {}).textContent && (document.getElementById('done-state-text') || {}).textContent, null, { timeout: 30000 }).catch(() => {});
        const s = await p.evaluate(() => [(document.getElementById('state-text') || {}).textContent || '', (document.getElementById('done-state-text') || {}).textContent || '']);
        rec['texts' + w] = s;
        if (!/^Off/.test(s[0])) bad.push(w + ' Texts: schedule texts not Off: ' + s[0].slice(0, 60));
        if (!/^Off/.test(s[1])) bad.push(w + ' Texts: load done texts not Off: ' + s[1].slice(0, 60));
      }],
      ['Driver Roster', 'drivers.html', async (w) => {
        await p.waitForSelector('input[data-text="LOAD"]', { timeout: 30000 }).catch(() => {});
        const k = await p.evaluate(() => ({ s: document.querySelectorAll('input[data-text="SCHEDULE"]').length, l: document.querySelectorAll('input[data-text="LOAD"]').length, th: [...document.querySelectorAll('th')].some(x => x.textContent.trim() === 'Texts') }));
        if (!k.th || !k.s || !k.l) bad.push(w + ' Driver Roster: Texts ticks missing ' + JSON.stringify(k));
      }]
    ];
    for (const [w, h] of [[1536, 790], [1024, 768], [390, 844]]) {
      await p.setViewportSize({ width: w, height: h });
      for (const [name, url, extra] of pages) {
        await open(p, url);
        await p.waitForTimeout(1500);
        if (extra) await extra(w);
        if (extra && url.startsWith('administration') && w === 1536) await open(p, url);
        const look = await p.evaluate((narrow) => ({
          side: document.documentElement.scrollWidth > innerWidth + 1 ? [...document.querySelectorAll('body *')].filter(x => x.offsetParent && x.getBoundingClientRect().right > innerWidth + 1 && !(x.parentElement && x.parentElement.getBoundingClientRect().right > innerWidth + 1)).slice(0, 3).map(x => x.tagName.toLowerCase() + (x.id ? '#' + x.id : '') + (typeof x.className === 'string' && x.className.trim() ? '.' + x.className.trim().split(/\s+/).join('.') : '') + ' "' + (x.textContent || '').trim().slice(0, 30) + '"') : null,
          cut: [...document.querySelectorAll('h1, h2, h3, button, .hdr-btn' + (narrow ? '' : ', th'))].filter(x => x.offsetParent && x.textContent.trim() && x.scrollWidth > x.clientWidth + 1 && getComputedStyle(x).overflowX !== 'visible').map(x => x.textContent.trim().slice(0, 40))
        }), w < 1024);
        if (look.side) bad.push(w + ' ' + name + ': page scrolls sideways (' + look.side.join(', ') + ')');
        if (look.cut.length) bad.push(w + ' ' + name + ': words cut: ' + look.cut.slice(0, 3).join(', '));
        await shot(p, 'look-' + slug(name) + '-' + w);
      }
    }
    const saves = p.w.calls.filter(c => c.fn === 'save');
    if (saves.length) bad.push('a look-only step saved: ' + saves.map(c => c.op || c.fn).join(', '));
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.slice(0, 6).join('; '));
  });
  // 6.67 (#511): Case Unloading, office and station tablet: Cases Out / Driver Said / Cases Returned / Lost, yesterday's
  // unfinished trailers first (in red), and + Add a Trailer. The test adds its own Wash only trailer, checks it, then takes it off
  // the list (Take Off the List).
  await write('Case Unloading columns, order and Add a Trailer', async (p, rec) => {
    const bad = [];
    for (const [w, h] of [[1536, 790], [1024, 768], [390, 844]]) {
      await p.setViewportSize({ width: w, height: h });
      await open(p, 'unloading.html?area=CASE');
      await p.waitForSelector('#rows tr', { timeout: 30000 }).catch(() => {});
      const look = await p.evaluate(() => {
        const heads = [...document.querySelectorAll('table thead th')].filter(x => !x.hidden).map(x => x.textContent.trim());
        const rows = [...document.querySelectorAll('#rows tr[data-key]')];
        const firstPlain = rows.findIndex(r => !r.classList.contains('prior'));
        const lateRed = firstPlain >= 0 ? rows.slice(firstPlain).filter(r => r.classList.contains('prior')).length : 0;
        return { heads, rows: rows.length, prior: rows.filter(r => r.classList.contains('prior')).length, lateRed, banner: ((document.getElementById('banner') || {}).textContent || '').trim(),
          side: document.documentElement.scrollWidth > innerWidth + 1, add: !!document.getElementById('add-open') };
      });
      rec['office' + w] = { rows: look.rows, prior: look.prior, banner: look.banner.slice(0, 80) };
      if (w === 1536) for (const c of ['Cases Out', 'Driver Said', 'Cases Returned', 'Lost']) if (!look.heads.includes(c)) bad.push('office: no ' + c + ' column (' + look.heads.join(', ') + ')');
      if (!look.add) bad.push(w + ' office: no + Add a Trailer');
      if (look.side) bad.push(w + ' office: page scrolls sideways');
      await shot(p, 'unloading-office-' + w);
    }
    // 6.67 (#514, look only): the Case Loadout's trailer box is green once that trailer is unloaded, red while it still waits on
    // the Unloading list; Case Unloading follows today's loadout order (yesterday's left-overs still on top).
    await open(p, 'loadout.html');
    await p.waitForSelector('#rows tr[data-row]', { timeout: 20000 });
    await p.waitForTimeout(3000);
    const tr = await p.evaluate(() => { const ins = [...document.querySelectorAll('#rows tr[data-row] input[data-k="trailer"]')].filter(i => i.value.trim()); return { list: [...new Set(ins.map(i => i.value.trim().toUpperCase()))], typed: ins.length, ok: ins.filter(i => i.classList.contains('unl-ok')).length, no: ins.filter(i => i.classList.contains('unl-no')).length,
      okColor: (ins.find(i => i.classList.contains('unl-ok')) ? getComputedStyle(ins.find(i => i.classList.contains('unl-ok'))).backgroundColor : ''), noColor: (ins.find(i => i.classList.contains('unl-no')) ? getComputedStyle(ins.find(i => i.classList.contains('unl-no'))).backgroundColor : '') }; });
    rec.loadoutTrailers = tr;
    if (tr.typed && !(tr.ok + tr.no)) bad.push('Case Loadout: ' + tr.typed + ' typed trailers, none green or red');
    await shot(p, 'loadout-trailer-colors');
    rec.loadoutOrder = await p.evaluate(() => [...document.querySelectorAll('#rows tr[data-row]')].slice(0, 12).map(t => t.children[0].textContent.trim()));
    // Details for each typed trailer on the loadout (place, row words, red or green), so the Unloading order can be judged by hand.
    const loRows = await p.evaluate(() => { const heads = [...document.querySelectorAll('#head-row th')].map(x => x.textContent.trim()); return [...document.querySelectorAll('#rows tr[data-row]')].map((t, i) => { const inp = t.querySelector('input[data-k="trailer"]'); const v = inp ? inp.value.trim().toUpperCase() : ''; if (!v) return null;
      const cells = {}; [...t.children].forEach((c, j) => { const tx = (c.querySelector('input,select') ? '' : c.textContent.trim().replace(/\s+/g, ' ')); if (tx && heads[j]) cells[heads[j]] = tx.slice(0, 40); });
      let pr = false; for (let x = t.previousElementSibling; x; x = x.previousElementSibling) if (x.classList.contains('divider')) { pr = x.classList.contains('prior'); break; }
      return { place: i + 1, trailer: v, done: t.classList.contains('done'), leftover: pr, route: (t.children[0] || {}).textContent.trim(), colour: inp.classList.contains('unl-ok') ? 'green' : inp.classList.contains('unl-no') ? 'red' : 'none', title: (inp.title || '').slice(0, 80), cells }; }).filter(Boolean); });
    await open(p, 'unloading.html?area=CASE');
    await p.waitForSelector('#rows tr[data-key]', { timeout: 20000 }).catch(() => {});
    rec.unloadingOrder = await p.evaluate(() => [...document.querySelectorAll('#rows tr[data-key]')].slice(0, 16).map(t => (t.classList.contains('prior') ? '*' : '') + t.children[0].textContent.trim().slice(0, 14)));
    // 6.67 (#514, Joe 10/27): after the trailer being unloaded, the trailers loaded today come in Case Loadout's loading order
    // (yesterday's ones where their load falls); added and other trailers after them.
    const unl = await p.evaluate(() => [...document.querySelectorAll('#rows tr[data-key]')].map(t => ({ trl: ((t.querySelector('.trl') || {}).textContent || '').trim().toUpperCase(), busy: /Unloading/i.test((t.children[2] || {}).textContent || '') })));
    // Joe 10/27 rule: 1) being unloaded at the top; 2) every trailer a not-done load on Case Loadout needs, in Case Loadout's
    // order (leftover loads first, as Case Loadout lists them), each once at its first not-done load; 3) the rest after them.
    // #517: each card on its own. A card's place comes from its trailer's first not-done Case Loadout load, skipping the load that
    // is that card's own trip (a leftover load whose route matches a card delivered today). A card no load needs is in the rest.
    const cards = await p.evaluate(() => [...document.querySelectorAll('#rows tr[data-key]')].map(t => { const k = t.dataset.key.split('|'); return { trl: ((t.querySelector('.trl') || {}).textContent || '').trim().toUpperCase(), date: k[0], route: k[1],
      busy: /Unloading/i.test((t.children[2] || {}).textContent || '') }; }));
    const opDay = operatingDay();
    const ranked = cards.filter(c => !c.busy && c.trl).map(c => { const l = loRows.find(l => !l.done && l.trailer === c.trl && !(l.leftover && c.date === opDay && c.route.split('_')[0] === l.route)); return Object.assign({}, c, { rank: l ? l.place : null }); });
    const need = ranked.filter(c => c.rank !== null).map(c => c.trl + ' ' + c.route + ' -> ' + c.rank);
    // 6.71 (#536): a trailer is on Case Unloading once: yesterday's card leaves the list (as Not recorded) when the trailer also
    // has a card today. Two of today's own trips on one trailer are each their own unloading, so they are noted, not failed.
    const tcards = cards.filter(c => c.trl && /^T-/.test(c.trl));
    rec.twice = [...new Set(tcards.filter(c => c.date < opDay && tcards.some(o => o !== c && o.trl === c.trl)).map(c => c.trl))];
    if (rec.twice.length) bad.push('Case Unloading lists ' + rec.twice.length + ' trailers from yesterday and again today (' + rec.twice.slice(0, 6).join(', ') + ')');
    rec.sameDayTwice = [...new Set(tcards.filter(c => c.date >= opDay && tcards.some(o => o !== c && o.trl === c.trl && o.date >= opDay)).map(c => c.trl + ' ' + tcards.filter(o => o.trl === c.trl).map(o => o.route).join('+')))];
    if (rec.sameDayTwice.length) note('Case Unloading: one trailer on two of today\'s trips: ' + rec.sameDayTwice.join(', '));
    const lastNeeded = ranked.reduce((m, c, i) => c.rank !== null ? i : m, -1);
    const notNeededBefore = ranked.slice(0, lastNeeded + 1).filter(c => c.rank === null).map(c => c.trl + ' ' + c.route);
    const idx = ranked.filter(c => c.rank !== null);
    const wrong = idx.filter((c, i) => i && c.rank < idx[i - 1].rank).map(c => c.trl + ' ' + c.route);
    const busyLow = unl.findIndex(u => !u.busy) >= 0 ? unl.slice(unl.findIndex(u => !u.busy)).filter(u => u.busy).map(u => u.trl) : [];
    const inv = wrong.length;
    rec.unloadOrderCheck = { needed: need, matched: idx.length, outOfOrder: wrong, notNeededAboveNeeded: notNeededBefore, unloadingNotOnTop: busyLow };
    if (notNeededBefore.length) bad.push('Case Unloading: ' + notNeededBefore.length + ' trailers no loadout load needs sit above needed ones (' + notNeededBefore.join(', ') + ')');
    if (busyLow.length) bad.push('Case Unloading: trailers being unloaded are not at the top (' + busyLow.join(', ') + ')');
    rec.unloadTrailers = unl.map(u => (u.busy ? '>' : '') + u.trl).slice(0, 30);
    const unRows = await p.evaluate(() => [...document.querySelectorAll('#rows tr[data-key]')].map((t, i) => ({ place: i + 1, trailer: ((t.querySelector('.trl') || {}).textContent || '').trim().toUpperCase(), prior: t.classList.contains('prior'),
      route: (t.children[0] || {}).textContent.trim().replace(/\s+/g, ' ').slice(0, 40), status: ((t.children[2] || {}).textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) })));
    rec.orderDetail = loRows.map(l => { const u = unRows.find(x => x.trailer === l.trailer); return { trailer: l.trailer, loadoutPlace: l.place, loadoutRoute: l.route, loadoutDone: l.done, leftoverLoad: l.leftover, loadoutColour: l.colour, loadoutTitle: l.title, loadoutRow: l.cells, unloadingPlace: u ? u.place : null, unloadingRoute: u ? u.route : '', unloadingStatus: u ? u.status : 'not on the Unloading list', fromYesterday: u ? u.prior : false }; });
    rec.unloadingRows = unRows.slice(0, 45);
    if (inv) bad.push('Case Unloading: ' + inv + ' needed trailers are out of Case Loadout order (' + wrong.join(', ') + ')');
    // + Add a Trailer: Wash only, then Take Off the List.
    await p.setViewportSize({ width: 1536, height: 790 });
    await open(p, 'unloading.html?area=CASE');
    await p.waitForSelector('#add-open', { timeout: 30000 });
    const trailer = 'T-99' + String(Math.floor(Math.random() * 90) + 10), unit = trailer.replace(/^T-/, '');
    rec.trailer = trailer;
    await p.click('#add-open');
    if ((await p.$eval('#add-kind', s => s.value)) !== '') bad.push('What it needs does not start blank');
    await p.fill('#add-trailer', trailer);
    await p.selectOption('#add-kind', 'WASH');
    const sel = '#rows tr[data-key$="ADDED|' + unit + '"]';
    await timed(p, rec, 'Add a Trailer', () => p.click('#add-save'), { fn: (s) => !!document.querySelector(s), arg: sel }, 20000).catch(e => bad.push('the added trailer did not show: ' + String(e.message).slice(0, 80)));
    if (await p.$(sel)) {
      const r = await p.$eval(sel, tr => ({ text: tr.textContent, wash: !!tr.querySelector('button[data-do="wash"]'), start: !!tr.querySelector('button[data-do="start"]'), idx: [...document.querySelectorAll('#rows tr[data-key]')].indexOf(tr), prior: document.querySelectorAll('#rows tr.prior[data-key]').length }));
      rec.added = { idx: r.idx, prior: r.prior };
      if (!/Wash only/.test(r.text)) bad.push('the added trailer does not say Wash only');
      if (!r.wash || r.start) bad.push('the added Wash only trailer: Wash button ' + r.wash + ', Start button ' + r.start);
      await shot(p, 'unloading-added');
      // Put back: Edit > Take Off the List.
      await p.click(sel + ' button[data-do="edit"]');
      await p.waitForSelector('#rows button[data-do="drop"]', { timeout: 8000 });
      await timed(p, rec, 'Take Off the List', () => p.click('#rows button[data-do="drop"]'), { fn: (s) => !document.querySelector(s), arg: sel }, 20000)
        .catch(e => bad.push('the added trailer did not come off the list: ' + String(e.message).slice(0, 80)));
    }
    // The station tablet: the same numbers on each card. The plant's tablets need a station code, so the test adds its own
    // Case Unloading station with a new code (never written down anywhere), opens the tablet on it, then removes that station.
    const adm = (op, f) => p.evaluate(([o, x]) => import('./js/app.js').then(m => m.callServer('admin', Object.assign({ op: o }, x))), [op, f]);
    const stName = 'Practice test Case Unloading';
    const old = ((await adm('stations', { kind: 'PLANT' })).stations || []).filter(x => x.name === stName);
    for (const o of old) await adm('stationRemove', { key: o.key });
    const added = await adm('stationAdd', { kind: 'PLANT', type: 'CASE_UNLOADING', facilityId: 'fac_uniontown', name: stName });
    const st = (added.stations || []).find(x => x.name === stName);
    if (!st) throw new Error('could not add the test station');
    // Its own browser (#516: a device that opens the Plant Station stays on it), so no other step's screens are locked.
    const t = await newPage({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    try {
      const code = (await adm('stationCode', { key: st.key })).code;
      await open(t, 'plant-station.html');
      await t.waitForSelector('#code-box input[name="code"]', { timeout: 30000 });
      await t.fill('#code-box input[name="code"]', code);
      await t.click('#code-box button[type="submit"]');
      // 6.67 (#516): the Case Unloading tablet opens on the choice of Case Unloading or Trailer Assignments.
      const choice = await t.waitForSelector('#tabs [data-part="unload"]', { timeout: 20000 }).then(() => true).catch(() => false);
      rec.choice = choice ? await t.$$eval('#tabs [data-part] b', b => b.map(x => x.textContent.trim())) : [];
      if (!choice) bad.push('tablet: no Case Unloading / Trailer Assignments choice');
      else await t.click('#tabs [data-part="unload"]');
      const up = await t.waitForSelector('#work .sw-card[data-sw]', { timeout: 30000 }).then(() => true).catch(() => false);
      if (!up) bad.push('tablet: no Case Unloading cards');
      else {
        // Open the first card to unload (opening a card only shows it; nothing is saved) to see its numbers.
        const head = await t.evaluate(() => { const h = [...document.querySelectorAll('#work .sw-card[data-sw] .sw-head[data-toggle]')].find(x => !/Wash only/i.test(x.closest('.sw-card').textContent)); if (!h) return ''; h.setAttribute('data-test-open', '1'); return h.dataset.toggle; });
        if (head) { await t.click('[data-test-open="1"]'); await t.waitForSelector('#work .sw-body .sw-fields', { timeout: 10000 }).catch(() => {}); }
        const c = await t.evaluate(() => {
          const cards = [...document.querySelectorAll('#work .sw-card[data-sw]')];
          const firstPlain = cards.findIndex(x => !x.classList.contains('prior'));
          return { n: cards.length, prior: cards.filter(x => x.classList.contains('prior')).length, lateRed: firstPlain >= 0 ? cards.slice(firstPlain).filter(x => x.classList.contains('prior')).length : 0,
            labels: [...new Set([...document.querySelectorAll('#work .sw-body .sw-field > span')].map(x => x.textContent.trim()))], side: document.documentElement.scrollWidth > innerWidth + 1 };
        });
        rec.tablet = { cards: c.n, prior: c.prior, labels: c.labels.slice(0, 12) };
        // 6.67 (#517, Joe 10/28): a blind count. The open card has returned, Trailer and Unloaded by; no Cases Out, Lost or Driver Said.
        if (!c.labels.some(l => / returned$/.test(l))) bad.push('tablet: no returned box on the open card (' + c.labels.join(', ') + ')');
        if (!c.labels.includes('Unloaded by')) bad.push('tablet: no Unloaded by on the open card (' + c.labels.join(', ') + ')');
        const hint = c.labels.filter(l => / out$/.test(l) || l === 'Lost' || /Driver Said/i.test(l));
        if (hint.length) bad.push('tablet: the blind count shows ' + hint.join(', '));
        if (c.side) bad.push('tablet: page scrolls sideways');
      }
      await shot(t, 'unloading-tablet-1024');
      // 6.67 (#516): the tablet now stays on its station: another screen's address brings it back to the Plant Station.
      await t.goto(SITE + '/loadout.html', { waitUntil: 'domcontentloaded' });
      await t.waitForTimeout(4000);
      rec.lockedTo = t.url().replace(SITE, '');
      rec.auditAdmin = await auditIsAdmin();
      if (rec.auditAdmin) {
        // #537: the test account is an Administrator: the tablet is freed (Case Loadout opens) and the station had Operations.
        if (!/loadout\.html/.test(t.url())) bad.push('tablet: an Administrator was kept on the station (Case Loadout went to ' + rec.lockedTo + ')');
        await open(t, 'plant-station.html');
        rec.adminHome = await t.waitForSelector('#admin-home', { timeout: 15000 }).then(() => true).catch(() => false);
        if (!rec.adminHome) bad.push('tablet: no Operations button for an Administrator on the Plant Station');
      } else if (!/plant-station\.html/.test(t.url())) bad.push('tablet: not kept on its station (Case Loadout opened at ' + rec.lockedTo + ')');
      await t.evaluate(k => { try { localStorage.removeItem(k); } catch (e) { /* none */ } }, 'udStationDevice');
      if (t.w.errors.length) bad.push('tablet page errors: ' + t.w.errors.slice(0, 2).join(' | '));
    } finally {
      await t.done();
      await adm('stationRemove', { key: st.key }).catch(e => bad.push('the test station was not removed: ' + String(e.message).slice(0, 80)));
    }
    const failed = p.w.calls.filter(c => c.status !== 200 || c.error);
    if (failed.length) bad.push('a save answered ' + failed[0].status + ' ' + String(failed[0].error).slice(0, 150));
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.slice(0, 6).join('; '));
  });
  // 6.67 (#509, look only): the Plant Managers phone start screen at 390 is just Manager Walkthrough, Loading and Unloading, and
  // each of those screens moves with a finger.
  await write('Plant Managers phone start screen (look only)', async (p, rec) => {
    const bad = [];
    const m = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    try {
      await open(m, 'walkthrough.html?view=home&app=1');
      await m.waitForSelector('.wk-choice, #not-manager:not([hidden])', { timeout: 30000 }).catch(() => {});
      if (await m.isVisible('#not-manager')) bad.push('the practice account is told the phone screens are for managers');
      const choices = await m.$$eval('.wk-choice .wk-t b', b => b.map(x => x.textContent.trim()));
      rec.choices = choices;
      if (choices.join('|') !== 'Manager Walkthrough|Loading|Unloading') bad.push('start screen shows: ' + choices.join(', '));
      await shot(m, 'plant-managers-390');
      for (const url of ['walkthrough.html?view=home&app=1', 'walkthrough.html', 'loadout.html', 'unloading.html']) {
        await open(m, url);
        await m.waitForTimeout(1500);
        const room = await m.evaluate(() => document.scrollingElement.scrollHeight - innerHeight);
        if (await m.evaluate(() => document.scrollingElement.scrollWidth > innerWidth + 1)) bad.push(url + ': scrolls sideways at 390');
        if (room < 40) continue;
        const cdp = await m.context().newCDPSession(m);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 630 }] });
        for (let i = 1; i <= 12; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y: Math.round(630 - 340 * i / 12) }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await m.waitForTimeout(600);
        const moved = await m.evaluate(() => [document.documentElement, ...document.querySelectorAll('*')].reduce((a, e) => a + e.scrollTop, 0));
        await shot(m, 'plant-managers-swiped-' + slug(url));
        rec[url] = moved;
        if (moved < 40) bad.push(url + ': does not move with a finger at 390');
      }
      if (m.w.errors.length) bad.push('page errors: ' + m.w.errors.slice(0, 2).join(' | '));
    } finally { await m.done(); }
    rec.bad = bad;
    if (bad.length) throw new Error(bad.slice(0, 6).join('; '));
  });
  // 6.67 (#515, look only): the Driver Room TV (?tv=1) at 1920x1080: fits the screen, nothing cut, no page errors, and it turns
  // to the weather / Scorecard without freezing (still drawing after a minute).
  await write('Driver Room TV at 1920 (look only)', async (p, rec) => {
    await p.setViewportSize({ width: 1920, height: 1080 });
    // The TV needs a Driver's Kiosk Station code: the test adds its own TV station with a new code (never written down), then
    // removes it at the end.
    await open(p, 'driver-station.html?tv=1');
    const adm = (op, f) => p.evaluate(([o, x]) => import('./js/app.js').then(m => m.callServer('admin', Object.assign({ op: o }, x))), [op, f]);
    const tvName = 'Practice test TV';
    for (const o of ((await adm('stations', { kind: 'KIOSK' })).stations || []).filter(x => x.name === tvName)) await adm('stationRemove', { key: o.key });
    const st = ((await adm('stationAdd', { kind: 'KIOSK', type: 'TV', facilityId: 'fac_uniontown', name: tvName })).stations || []).find(x => x.name === tvName);
    if (!st) throw new Error('could not add the test TV station');
    // What the server last wrote about FOX Weather's live video (scorecard/kiosk live), read first so it is kept even when the TV fails.
    {
      const rq = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
      const k = await rq('firebase-admin/firestore').getFirestore(rq('firebase-admin').app('audit')).collection('scorecard').doc('kiosk').get();
      const live = (k.exists && k.data().live) || {};
      rec.liveFirst = { video: live.video || '', channel: live.channel || '', live: live.live, embed: live.embed, at: live.at || '', page: live.page || '', problem: live.problem || '' };
    }
    // The TV itself: a browser with no United Dairy account, signed in by its code alone, as the TV in the Driver Room.
    let tvp = await newPage({ viewport: { width: 1920, height: 1080 }, signedOut: true }), tvAdmin = false;
    try {
    const code = (await adm('stationCode', { key: st.key })).code;
    await open(tvp, 'driver-station.html?tv=1');
    // With no account the TV link shows its own code box (#tvacct, "OPEN THE BOARD"); signed in, the station code screen.
    await tvp.waitForSelector('#tvacct:not([hidden]) #tvacct-code, #code-box:not([hidden]) input[name="code"]', { timeout: 30000 }).catch(() => {});
    rec.codeBox = (await tvp.$('#tvacct:not([hidden]) #tvacct-code')) ? 'tvacct' : (await tvp.$('#code-box:not([hidden]) input[name="code"]')) ? 'code-box' : '';
    if (rec.codeBox === 'tvacct') { await tvp.fill('#tvacct-code', code); await tvp.click('#tvacct button[type="submit"]').catch(e => { rec.clickError = String(e.message).slice(0, 600); }); }
    else if (rec.codeBox) { await tvp.fill('#code-box input[name="code"]', code); await tvp.click('#code-box button[type="submit"]').catch(e => { rec.clickError = String(e.message).slice(0, 600); }); }
    let on = await tvp.waitForSelector('#ds-grid:not([hidden])', { timeout: 30000 }).then(() => true).catch(() => false);
    // 6.71 (#541): on the practice copy the server account may not make station sign-ins (no Token Creator); the TV then says so
    // in plain words (known, practice copy only), and the board is looked at on a United Dairy account's browser instead.
    if (!on && rec.codeBox === 'tvacct') {
      const m = await tvp.evaluate(() => (document.getElementById('tvacct-msg') || {}).textContent || '').catch(() => '');
      if (/server could not sign this screen in/i.test(m)) {
        rec.signedOutKnown = m.trim();
        // 6.72: Joe gave the practice copy's server account Token Creator, so the TV's code alone must open it now. Still a
        // failure; the board is then looked at on a signed-in browser so the rest is checked too.
        rec.signedOutFailed = 'the TV with no account could not sign in on its code: ' + rec.signedOutKnown;
        await shot(tvp, 'tv-signed-out-message');
        await tvp.evaluate(() => { try { localStorage.clear(); } catch (e) { /* none */ } }).catch(() => {});
        await tvp.done();
        tvp = await newPage({ viewport: { width: 1920, height: 1080 }, timezoneId: 'America/New_York' });
        tvAdmin = true;
        await open(tvp, 'driver-station.html?tv=1');
        await tvp.waitForSelector('#code-box:not([hidden]) input[name="code"]', { timeout: 30000 }).catch(() => {});
        rec.codeBox = (await tvp.$('#code-box:not([hidden]) input[name="code"]')) ? 'code-box (signed in)' : '';
        if (rec.codeBox) { await tvp.fill('#code-box input[name="code"]', code); await tvp.click('#code-box button[type="submit"]').catch(e => { rec.clickError = String(e.message).slice(0, 600); }); }
        on = await tvp.waitForSelector('#ds-grid:not([hidden])', { timeout: 30000 }).then(() => true).catch(() => false);
      }
    }
    if (!on) {
      rec.codeMsg = await tvp.evaluate(() => [...document.querySelectorAll('#tvacct-msg, #code-box .st-code-msg, #signin-error')].map(m => m.textContent.trim()).filter(Boolean).join(' / ')).catch(() => '');
      rec.tvUrl = tvp.url(); rec.tvCalls = tvp.w.calls.slice(-6); rec.tvErrors = tvp.w.errors.slice(0, 4);
      await shot(tvp, 'tv-did-not-open');
      throw new Error('the TV did not open on its code' + (rec.codeBox ? '' : ' (no code box)') + (rec.clickError ? ' (' + rec.clickError.split('\n')[0] + ')' : '') + (rec.codeMsg ? ': ' + rec.codeMsg : ''));
    }
    await tvp.waitForTimeout(5000);
    const look = () => tvp.evaluate(() => ({ side: document.documentElement.scrollWidth > innerWidth + 1, tall: document.scrollingElement.scrollHeight > innerHeight + 1, text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 160),
      cut: [...document.querySelectorAll('h1, h2, h3, th, td, b')].filter(x => x.offsetParent && x.textContent.trim() && x.scrollWidth > x.clientWidth + 1 && getComputedStyle(x).overflowX !== 'visible').map(x => x.textContent.trim().slice(0, 30)).slice(0, 4) }));
    const a = await look();
    const liveNow = () => tvp.evaluate(() => { const f = document.getElementById('live-frame'), n = document.getElementById('live-note'), c = document.querySelector('#turn-live .ds-live-cap');
      const r = document.getElementById('live-radar'), t = document.querySelector('#turn-live .ds-live-tag');
      return { frame: f ? f.src.slice(0, 200) : '', note: n && !n.hidden ? n.textContent : '', cap: c ? c.textContent : '', tag: t ? t.textContent : '',
        radar: r ? { loaded: r.complete && r.naturalWidth > 0, size: r.naturalWidth + 'x' + r.naturalHeight, src: r.src.replace(/\?t=\d+$/, '') } : null }; });
    rec.liveA = await liveNow();
    await shot(tvp, 'tv-1920-a');
    // 6.74 (#548): the right-hand box shows only the weather (live video, radar loop or local weather), never the Driver
    // Scorecard, also past its 30-second turns: looked at every 2 seconds for the minute.
    rec.boxSeen = {};
    for (let i = 0; i < 30; i++) {
      const k = await tvp.evaluate(() => ['turn-live', 'turn-weather', 'turn-score'].filter(id => { const e = document.getElementById(id); return e && !e.hidden; }).join('+') || 'none').catch(() => 'gone');
      rec.boxSeen[k] = (rec.boxSeen[k] || 0) + 1;
      await tvp.waitForTimeout(2000);
    }
    const b = await look();
    rec.liveB = await liveNow();
    await shot(tvp, 'tv-1920-b');
    // The radar or video on the screen itself (the box takes 30-second turns with the Scorecard).
    rec.liveShown = await tvp.waitForFunction(() => !document.getElementById('turn-live').hidden, null, { timeout: 35000 }).then(() => true).catch(() => false);
    if (rec.liveShown) await shot(tvp, 'tv-1920-live-box');
    rec.first = a.text; rec.later = b.text;
    const bad = [];
    for (const [w, l] of [['first', a], ['a minute later', b]]) {
      if (l.side) bad.push(w + ': scrolls sideways');
      if (l.tall) bad.push(w + ': taller than the TV');
      if (l.cut.length) bad.push(w + ': words cut: ' + l.cut.join(', '));
    }
    if (/Enter this station's code/.test(b.text)) bad.push('the TV went back to asking for its code');
    const notWeather = Object.keys(rec.boxSeen).filter(k => k !== 'turn-live' && k !== 'turn-weather');
    if (notWeather.length) bad.push('the right-hand box was not only the weather over a minute (' + JSON.stringify(rec.boxSeen) + ')');
    // 6.70 (#529): the TV plays the FOX Weather video the server found live (scorecard/kiosk live); with none, the local weather.
    {
      const rq = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
      const k = await rq('firebase-admin/firestore').getFirestore(rq('firebase-admin').app('audit')).collection('scorecard').doc('kiosk').get();
      const live = (k.exists && k.data().live) || {};
      rec.live = { video: live.video || '', channel: live.channel || '', live: live.live, embed: live.embed, at: live.at || '', page: live.page || '', problem: live.problem || '' };
      // 6.71 (#540): first FOX Weather's live video when the server found one that plays on other sites, else FOX Weather's
      // channel live stream (the server's channel number, or FOX Weather's own), then AccuWeather NOW, then the local weather
      // with one line saying why.
      const want = live.video && live.live !== false && live.embed !== false ? '/embed/' + encodeURIComponent(String(live.video)) + '?'
        : '/embed/live_stream?channel=' + encodeURIComponent(/^UC[\w-]{22}$/.test(live.channel || '') ? live.channel : 'UC1FbPiXx59_ltnFVx7IxWow') + '&';
      rec.wantFirst = want;
      // A browser YouTube will not play in (the test's) goes down the list at once; the line saying why must then name FOX
      // Weather first, so the order is still seen.
      rec.liveTriedFirst = rec.liveA.frame.includes(want) ? 'playing' : /^Live weather not showing: FOX Weather /.test(rec.liveA.note) ? 'tried, refused' : '';
      if (!rec.liveTriedFirst) bad.push('the TV did not start on FOX Weather (' + want + '): it had ' + (rec.liveA.frame || 'no video') + (rec.liveA.note ? ' / ' + rec.liveA.note : ''));
      if (!rec.liveB.frame && !rec.liveB.note) bad.push('a minute later: no live picture and no line saying why');
      // 6.73 (#546): with no live video the box shows the National Weather Service's Pittsburgh radar loop.
      if (!rec.liveB.frame && !(rec.liveB.radar && rec.liveB.radar.loaded && rec.liveB.tag === 'RADAR')) bad.push('no live video and no radar loop a minute later (' + JSON.stringify({ radar: rec.liveB.radar, tag: rec.liveB.tag }) + ')');
      if (rec.liveB.note && !/^Live weather not showing: /.test(rec.liveB.note)) bad.push('the no-live-weather line reads: ' + rec.liveB.note);
    }
    // 6.76 (#552): yesterday's loads not loaded yet stay on the TV after the 6 a.m. roll, first.
    {
      const shownKeys = () => tvp.evaluate(() => { const rows = [...document.querySelectorAll('#ds-grid .ds-row')].filter(r => r.querySelector('.rt'));
        return rows.map(r => { const rt = r.querySelector('.rt'); return rt && rt.classList.contains('span2') ? rt.textContent.trim() + '|' : (rt ? rt.textContent.trim() : '') + '|' + ((rt && rt.nextElementSibling) ? rt.nextElementSibling.textContent.trim() : ''); }); });
      let exp = await carryExpected(), shown = await shownKeys();
      // The list rolls with a second copy: only the first copy counts.
      shown = shown.slice(0, exp.rows.length);
      let c = carryCompare(exp, shown);
      if (c.bad.length) { await tvp.waitForTimeout(5000); exp = await carryExpected(); shown = (await shownKeys()).slice(0, exp.rows.length); c = carryCompare(exp, shown); }
      rec.carry = { date: exp.date, expectedPrior: c.expectedPrior, shownFirst: c.shownFirst, expectedCount: c.expectedCount, shownCount: c.shownCount };
      c.bad.forEach(b => bad.push('TV: ' + b));
      if (!exp.prior.length) note('Driver Room carry-over: no load from yesterday is still unfinished on the practice copy right now');
    }
    // 6.76 (#553): the weather box keeps its words inside it and lies over nothing (at 1920 and on a 1536 x 790 office window).
    for (const [w, h] of [[1920, 1080], [1536, 790]]) {
      await tvp.setViewportSize({ width: w, height: h });
      await tvp.waitForTimeout(1500);
      const f = await tvp.evaluate(() => { const box = document.getElementById('weather'); if (!box || !box.offsetParent) return { shown: false };
        const b = box.getBoundingClientRect(), inside = (r) => r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1;
        const words = [...box.querySelectorAll('h3, p, b, span, img')].filter(x => x.offsetParent && x.getBoundingClientRect().height > 0);
        const out = words.filter(x => !inside(x.getBoundingClientRect())).map(x => (x.textContent || x.alt || '').trim().slice(0, 30));
        const over = [...document.querySelectorAll('button, a')].filter(x => x.offsetParent && !box.contains(x)).filter(x => { const r = x.getBoundingClientRect(); return r.width && r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top; }).map(x => x.textContent.trim().slice(0, 20));
        return { shown: true, box: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)], out, over, sideways: document.documentElement.scrollWidth > innerWidth + 1 }; });
      rec['weather' + w] = f;
      if (f.shown && f.out.length) bad.push(w + ': weather box words outside it: ' + f.out.join(', '));
      if (f.shown && f.over.length) bad.push(w + ': weather box lies over ' + f.over.join(', '));
      if (f.sideways) bad.push(w + ': the TV scrolls sideways');
      await shot(tvp, 'tv-weather-' + w);
    }
    await tvp.setViewportSize({ width: 1920, height: 1080 });
    // 6.69 (#522): the weekly schedule is bigger on the TV, and a new version reloads the board by itself (the same version does not).
    rec.week = await tvp.evaluate(() => { const t = document.querySelector('.ds-week-table'), h = document.querySelector('.ds-week-title'), td = t && t.querySelector('td');
      return { table: !!t, tableFont: t ? parseFloat(getComputedStyle(t).fontSize) : 0, tdFont: td ? parseFloat(getComputedStyle(td).fontSize) : 0, titleFont: h ? parseFloat(getComputedStyle(h).fontSize) : 0, check: typeof window.udTvVersionCheck === 'function' }; });
    if (!rec.week.table) bad.push('no weekly schedule on the TV');
    else if (rec.week.tdFont < 20 || rec.week.titleFont < 19) bad.push('weekly schedule not bigger (table ' + rec.week.tdFont + 'px, title ' + rec.week.titleFont + 'px)');
    if (!rec.week.check) bad.push('the TV has no new-version check');
    else {
      await tvp.evaluate(() => { window.__udSame = 1; });
      await tvp.evaluate(() => window.udTvVersionCheck()).catch(() => {});
      await tvp.waitForTimeout(3000);
      rec.sameVersionKept = await tvp.evaluate(() => window.__udSame === 1).catch(() => false);
      if (!rec.sameVersionKept) bad.push('the TV reloaded with no new version');
    }
    if (tvp.w.errors.length) bad.push('page errors: ' + tvp.w.errors.slice(0, 3).join(' | '));
    // 6.67 (#518): once its code opened it, the TV is locked like the Plant Station: another screen's address brings it back.
    await tvp.goto(SITE + '/loadout.html', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await tvp.waitForTimeout(4000);
    rec.lockedTo = new URL(tvp.url()).pathname;
    // An Administrator's browser is never kept on a station (#537); the TV on its code alone is.
    if (tvAdmin && (await auditIsAdmin())) { if (rec.lockedTo !== '/loadout.html') bad.push('an Administrator was kept on the TV (loadout.html went to ' + rec.lockedTo + ')'); }
    else if (rec.lockedTo !== '/driver-station.html') bad.push('the TV is not locked: loadout.html stayed on ' + rec.lockedTo);
    // 6.72 (#544): the TV keeps its screen on (the browser's keep-the-screen-on, or a tiny silent video playing).
    rec.awake = await tvp.evaluate(() => { const v = document.getElementById('ds-awake') || document.getElementById('keep-awake'); return { how: document.documentElement.dataset.awake || '', video: v ? (v.paused ? 'paused' : 'playing') : '' }; });
    if (!(rec.awake.how === 'lock' || (rec.awake.how === 'video' && rec.awake.video === 'playing'))) bad.push('the TV does not keep its screen on (' + JSON.stringify(rec.awake) + ')');
    if (rec.signedOutFailed) bad.unshift(rec.signedOutFailed);
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
    } finally {
      await tvp.evaluate(() => { try { localStorage.clear(); } catch (e) { /* none */ } }).catch(() => {});
      await tvp.done();
      await adm('stationRemove', { key: st.key }).catch(() => {});
    }
  });
  // 6.69 (#523, look only): the Garage Station on its own tablet code: three cards (Trucks, Trailers, Fork trucks) with their
  // pictures, a card opens its work orders and comes back; no page sideways at 1024 or 390; the tablet is then kept on the
  // Garage Station (another address brings it back). The test adds its own Garage station and code, then removes it.
  // 6.76 (#552, look only): the Driver Room tablet's View Loadout (the same list the drivers' phones get from the server) keeps
  // yesterday's loads not loaded yet, first, after the 6 a.m. roll. The test adds its own Driver Room station and code, then
  // removes it.
  await write('Driver Room View Loadout keeps yesterday\'s unfinished loads (look only)', async (p, rec) => {
    const bad = [], name = 'Practice test Room';
    await open(p, 'administration.html');
    const adm = (op, f) => p.evaluate(([o, x]) => import('./js/app.js').then(m => m.callServer('admin', Object.assign({ op: o }, x))), [op, f]);
    for (const o of ((await adm('stations', { kind: 'KIOSK' })).stations || []).filter(x => x.name === name)) await adm('stationRemove', { key: o.key });
    const st = ((await adm('stationAdd', { kind: 'KIOSK', type: 'DRIVER', facilityId: 'fac_uniontown', name })).stations || []).find(x => x.name === name);
    if (!st) throw new Error('could not add the test Driver Room station');
    const t = await newPage({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1.5, roomLook: true });
    try {
      const code = (await adm('stationCode', { key: st.key })).code;
      await open(t, 'driver-station.html?for=room');
      await t.waitForSelector('#code-box:not([hidden]) input[name="code"]', { timeout: 30000 });
      await t.fill('#code-box input[name="code"]', code);
      await t.click('#code-box button[type="submit"]');
      await t.waitForURL(/route\.html\?room=1/, { timeout: 30000 });
      await t.waitForSelector('#m-board', { timeout: 30000 });
      await t.click('#m-board');
      await t.waitForSelector('#board-track .drv-row', { timeout: 30000 });
      await t.waitForTimeout(1500);
      const shownKeys = () => t.evaluate(() => [...document.querySelectorAll('#board-track > div:first-child .drv-row .rt b')].map(b => { const m = b.textContent.trim().split(' · '); return m[0] + '|' + (m.slice(1).join(' · ')); }));
      let exp = await carryExpected(), c = carryCompare(exp, await shownKeys());
      if (c.bad.length) { await t.waitForTimeout(5000); exp = await carryExpected(); c = carryCompare(exp, await shownKeys()); }
      rec.carry = { date: exp.date, expectedPrior: c.expectedPrior, shownFirst: c.shownFirst, expectedCount: c.expectedCount, shownCount: c.shownCount };
      rec.band = await t.evaluate(() => ((document.querySelector('#board-track .drv-band.start') || {}).textContent || '').trim());
      c.bad.forEach(b => bad.push('View Loadout: ' + b));
      if (c.shownCount !== c.expectedCount) bad.push('View Loadout lists ' + c.shownCount + ' loads, the board rules give ' + c.expectedCount);
      await shot(t, 'room-view-loadout');
      if (t.w.errors.length) bad.push('page errors: ' + t.w.errors.slice(0, 3).join(' | '));
    } finally {
      await t.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* none */ } }).catch(() => {});
      await t.done();
      await adm('stationRemove', { key: st.key }).catch(e => bad.push('the test station was not removed: ' + String(e.message).slice(0, 80)));
    }
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.76 (#554, look only): every screen opened on a tablet keeps its screen on (not only the stations), with a silent video
  // that fills the screen behind everything when the browser has no keep-the-screen-on. A phone and a computer are left alone.
  await write('Tablet screens keep the screen on (look only)', async (p, rec) => {
    const bad = [];
    const read = (pg) => pg.evaluate(() => { const v = document.getElementById('keep-awake') || document.getElementById('ds-awake'), r = v ? v.getBoundingClientRect() : null;
      return { how: document.documentElement.dataset.awake || '', video: v ? (v.paused ? 'paused' : 'playing') : '', full: r ? r.width >= innerWidth - 1 && r.height >= innerHeight - 1 : null, taps: v ? getComputedStyle(v).pointerEvents : '' }; });
    const t = await newPage({ viewport: { width: 1024, height: 768 }, screen: { width: 1024, height: 768 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1.5, awakeTabLook: true });
    try {
      for (const url of ['index.html', 'daily.html', 'loadout.html', 'unloading.html', 'yard.html', 'washing.html', 'plant.html', 'maint.html']) {
        await open(t, url);
        await t.waitForFunction(() => !!document.documentElement.dataset.awake, null, { timeout: 15000 }).catch(() => {});
        await t.waitForTimeout(1500);
        const r = await read(t);
        rec[url] = r;
        if (!(r.how === 'lock' || (r.how === 'video' && r.video === 'playing'))) bad.push('tablet ' + url + ' does not keep the screen on (' + JSON.stringify(r) + ')');
        else if (r.how === 'video' && (!r.full || r.taps !== 'none')) bad.push('tablet ' + url + ': the keep-awake video is not full screen behind everything (' + JSON.stringify(r) + ')');
      }
      if (t.w.errors.length) bad.push('tablet page errors: ' + t.w.errors.slice(0, 3).join(' | '));
    } finally { await t.done(); }
    // A phone and a computer: left alone.
    for (const [label, view] of [['phone 390', { viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, awakePhoneLook: true }], ['computer 1536', { viewport: { width: 1536, height: 790 }, awakePcLook: true }]]) {
      const q = await newPage(view);
      try {
        await open(q, 'daily.html');
        await q.waitForTimeout(3000);
        const r = await read(q);
        rec[label] = r;
        if (r.how) bad.push(label + ': keeps the screen on, but should be left alone (' + JSON.stringify(r) + ')');
      } finally { await q.done(); }
    }
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.76 (#553, look only): one Daily Dispatch red-cell rule: a load whose regular driver is off reads NEEDS DRIVER in bold
  // white on solid red with who is off and why under it, 16px (Joe 10/20), as before.
  await write('Daily Dispatch red cells (look only)', async (p, rec) => {
    const bad = [];
    await open(p, 'daily.html');
    await p.waitForSelector('table.daily tbody tr', { timeout: 30000 });
    await p.waitForTimeout(2000);
    // A day with a driver off: today, else the next loadout days (the day arrow), up to a week.
    rec.daysLooked = 0;
    for (let i = 0; i < 7 && !(await p.$('table.daily td.missing.offcover:not(.unit-down)')); i++) {
      if (!(await p.click('#next', { timeout: 5000 }).then(() => true).catch(() => false))) break;
      await p.waitForTimeout(2500);
      rec.daysLooked++;
    }
    // A down truck or trailer says "T-532 DOWN" only, no NEEDS DRIVER (Joe 10/23): looked at on its own.
    rec.down = await p.evaluate(() => [...document.querySelectorAll('table.daily td.missing.offcover.unit-down')].filter(td => td.offsetParent).map(td => ({ text: td.textContent.trim(), bg: getComputedStyle(td).backgroundColor, before: getComputedStyle(td, '::before').content })));
    for (const x of rec.down) if (!/DOWN|NOT USABLE|OUT OF SERVICE/i.test(x.text) || x.bg !== 'rgb(200, 30, 30)' || x.before !== 'none') bad.push('down unit cell: ' + JSON.stringify(x));
    rec.cells = await p.evaluate(() => [...document.querySelectorAll('table.daily td.missing.offcover:not(.unit-down)')].filter(td => td.offsetParent).slice(0, 12).map(td => {
      const c = getComputedStyle(td), b = getComputedStyle(td, '::before'), a = getComputedStyle(td, '::after');
      return { bg: c.backgroundColor, color: c.color, weight: c.fontWeight, before: b.content, beforeSize: b.fontSize, beforeWeight: b.fontWeight, beforeColor: b.color, after: a.content.slice(0, 60), afterSize: a.fontSize,
        who: td.dataset.offWho || '', why: td.dataset.offWhy || '', w: Math.round(td.getBoundingClientRect().width), cut: td.scrollWidth > td.clientWidth + 1 };
    }));
    rec.count = rec.cells.length;
    for (const x of rec.cells) {
      const why = [];
      if (x.bg !== 'rgb(200, 30, 30)') why.push('background ' + x.bg);
      if (x.color !== 'rgb(255, 255, 255)' || x.beforeColor !== 'rgb(255, 255, 255)') why.push('words ' + x.color + '/' + x.beforeColor);
      if (x.before !== '"NEEDS DRIVER"') why.push('says ' + x.before);
      if (parseFloat(x.beforeSize) < 16 || parseFloat(x.afterSize) < 16) why.push('text ' + x.beforeSize + '/' + x.afterSize);
      if (Number(x.beforeWeight) < 700) why.push('NEEDS DRIVER not bold (' + x.beforeWeight + ')');
      if (!x.who) why.push('no who is off');
      if (why.length) bad.push((x.who || 'a cell') + ': ' + why.join(', '));
    }
    if (!rec.count) note('Daily Dispatch red cells: no driver-off cell on the practice copy today to look at');
    await shot(p, 'daily-red-cells');
    rec.bad = bad;
    if (bad.length) throw new Error(bad.slice(0, 4).join('; '));
  });
  // 6.72 (#544, look only): every station, line tablet, Driver Room tablet and TV screen keeps the tablet's screen on: the
  // browser's keep-the-screen-on (data-awake="lock"), or a tiny silent video that is playing (data-awake="video"). Opened on
  // their code screens only (no code typed, so this browser is not kept on any of them).
  await write('Station screens keep the screen on (look only)', async (p, rec) => {
    const bad = [], t = await newPage({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1.5, keepAwakeLook: true });
    try {
      for (const url of ['plant-station.html', 'garage-station.html', 'maint-station.html', 'driver-station.html', 'driver-station.html?tv=1', 'plant-kiosk.html?tv=1', 'line.html?tablet=1', 'route.html?room=1']) {
        await open(t, url);
        await t.waitForFunction(() => !!document.documentElement.dataset.awake, null, { timeout: 15000 }).catch(() => {});
        await t.waitForTimeout(2000);
        const r = await t.evaluate(() => { const v = document.getElementById('ds-awake') || document.getElementById('keep-awake');
          return { at: location.pathname + location.search, how: document.documentElement.dataset.awake || '', video: v ? (v.paused ? 'paused' : 'playing') : '' }; });
        rec[url] = r;
        if (!(r.how === 'lock' || (r.how === 'video' && r.video === 'playing'))) bad.push(url + ' does not keep the screen on (' + (r.how || 'nothing') + (r.video ? ', video ' + r.video : '') + ', at ' + r.at + ')');
      }
      if (t.w.errors.length) bad.push('page errors: ' + t.w.errors.slice(0, 3).join(' | '));
    } finally {
      await t.evaluate(() => { try { localStorage.clear(); } catch (e) { /* none */ } }).catch(() => {});
      await t.done();
    }
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  await write('Garage Station on its tablet code (look only)', async (p, rec) => {
    const bad = [];
    const adm = (op, f) => p.evaluate(([o, x]) => import('./js/app.js').then(m => m.callServer('admin', Object.assign({ op: o }, x))), [op, f]);
    const name = 'Practice test Garage';
    await open(p, 'administration.html');
    for (const o of ((await adm('stations', { kind: 'GARAGE' })).stations || []).filter(x => x.name === name)) await adm('stationRemove', { key: o.key });
    const st = ((await adm('stationAdd', { kind: 'GARAGE', type: 'GARAGE', facilityId: 'fac_uniontown', name })).stations || []).find(x => x.name === name);
    if (!st) throw new Error('could not add the test Garage station');
    // 6.70 (#528): a service work order with its checklist to look at. Fleet Service makes them when a service comes due; with
    // none open on the practice copy, the test makes one PM on one of Uniontown's trucks (practice copy only) and deletes it after.
    const rq = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const fdb = rq('firebase-admin/firestore').getFirestore(rq('firebase-admin').app('audit'));
    // 6.76 (#553): every new work order starts from one blank record. The test makes one the way the office does (Fleet Service >
    // Send to Garage, a PM) on a Uniontown truck with nothing open, reads what was saved, and deletes it after (practice copy only).
    let madeSvc = '';
    {
      const busyUnits = new Set((await fdb.collection('workOrders').get()).docs.map(d => d.data()).filter(o => String(o.status || '').toUpperCase() !== 'DONE').map(o => String(o.unit || '').toUpperCase()));
      const truck = (await fdb.collection('equipment').where('type', '==', 'TRUCK').get()).docs.map(d => d.data()).find(e => e.unit && e.facilityId === 'fac_uniontown' && String(e.status || 'ACTIVE').toUpperCase() === 'ACTIVE' && e.sourcePresent !== false && !busyUnits.has(String(e.unit).toUpperCase()));
      if (!truck) bad.push('no Uniontown truck without an open work order to send to the garage');
      else {
        const sent = await p.evaluate(x => import('./js/app.js').then(m => m.save('sendToGarage', x)), { unit: String(truck.unit).toUpperCase(), unitType: 'TRUCK', serviceKey: 'PM', note: 'Practice test (deleted by the test)' }).catch(e => ({ error: String(e.message || e) }));
        rec.sent = sent;
        const doc = sent && sent.workOrderId ? (await fdb.collection('workOrders').where('work_order_id', '==', sent.workOrderId).get()).docs[0] : null;
        if (!doc) bad.push('Send to Garage made no work order (' + JSON.stringify(sent).slice(0, 160) + ')');
        else {
          madeSvc = doc.id; rec.madeService = String(truck.unit).toUpperCase();
          const o = doc.data(), want = { facility_id: 'fac_uniontown', category: '', source_kind: '', source_id: '', status: 'NEW', started_at: '', techs: '', parts_at: '', fixed: '', fixed_note: '', safe: '',
            signed_by: '', signature: '', completed_at: '', minutes: '', odometer: '', version: 1, createdInApp: true, source: 'OFFICE', service_key: 'PM', unit: rec.madeService, unit_type: 'TRUCK', can_run: 'YES', created_by: EMAIL, updated_by: EMAIL };
          rec.blankOrder = Object.keys(want).filter(k => o[k] !== want[k]).map(k => k + '=' + JSON.stringify(o[k]) + ' (want ' + JSON.stringify(want[k]) + ')');
          if (!o.work_order_id || !o.created_at || !o.updated_at || !/^PM/i.test(String(o.problem || '')) && !/Practice test/.test(String(o.problem || ''))) rec.blankOrder.push('id/times/problem: ' + JSON.stringify({ id: o.work_order_id, created: o.created_at, updated: o.updated_at, problem: o.problem }));
          if (rec.blankOrder.length) bad.push('the new work order is not the blank record: ' + rec.blankOrder.join(', '));
        }
      }
    }
    // Its own browser: a tablet that opens the Garage Station stays on it (#518).
    const g = await newPage({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1.5 });
    try {
      const code = (await adm('stationCode', { key: st.key })).code;
      await open(g, 'garage-station.html');
      await g.waitForSelector('#view-code input[name="code"]', { timeout: 30000 });
      await g.fill('#view-code input[name="code"]', code);
      await g.click('#view-code button[type="submit"]', { timeout: 15000 }).catch(async e => {
        rec.clickError = String(e.message).slice(0, 900);
        await shot(g, 'garage-code-click');
        throw new Error('the code screen Open button could not be pressed: ' + rec.clickError.split('\n').filter(l => /intercepts|visible|stable|enabled|detached|waiting/i.test(l)).slice(-2).join(' / '));
      });
      const up = await g.waitForSelector('#cards .gs-bigcard', { timeout: 30000 }).then(() => true).catch(() => false);
      if (!up) throw new Error('the Garage Station did not open on its code');
      for (const [w, h] of [[1024, 768], [390, 844]]) {
        await g.setViewportSize({ width: w, height: h });
        await g.waitForTimeout(1500);
        const look = await g.evaluate(() => ({ cards: [...document.querySelectorAll('#cards .gs-bigcard')].map(c => (c.querySelector('span') || {}).textContent + ' ' + (c.querySelector('b') || {}).textContent),
          pics: [...document.querySelectorAll('#cards .gs-bigcard img')].filter(i => !(i.complete && i.naturalWidth > 0)).length, side: document.documentElement.scrollWidth > innerWidth + 1,
          title: (document.getElementById('title') || {}).textContent, release: !!document.querySelector('#gs-change:not([hidden])'),
          nav: [...document.querySelectorAll('header button, header a')].filter(x => x.offsetParent && /^(Back|Home|Sign out)$/i.test(x.textContent.trim())).map(x => x.textContent.trim()) }));
        rec['look' + w] = look;
        if (look.cards.length !== 3) bad.push(w + ': ' + look.cards.length + ' cards (' + look.cards.join(', ') + ')');
        if (look.pics) bad.push(w + ': ' + look.pics + ' card pictures did not load');
        if (look.side) bad.push(w + ': page scrolls sideways');
        if (!look.release) bad.push(w + ': no Release button');
        // A coded station has no Back, Home or Sign out, except for an Administrator (#537: the station keeps its menus).
        if (look.nav.length && !(await auditIsAdmin())) bad.push(w + ': a coded station shows ' + look.nav.join(', '));
        await shot(g, 'garage-station-' + w);
      }
      // 6.70 (#528): each card lists at most 15 work orders (write-ups first); a service work order's checklist keeps Complete
      // locked until every line is marked (tread depth: all 8 tires), the hours (and a truck's miles) and the day are in, and the
      // whole work order was scrolled through. Marks and depths stay on the tablet until a step sends them; the test sends
      // nothing: it stops at "Who completed it?" (a mechanic's own login ID, never typed by the test) and cancels.
      for (const [w, h] of [[1024, 768], [390, 844]]) {
        await g.setViewportSize({ width: w, height: h });
        const per = [];
        for (let c = 0; c < 3; c++) {
          await g.evaluate(() => { const b = document.getElementById('to-home'); if (b && b.offsetParent) b.click(); });
          await g.waitForSelector('#view-home:not([hidden])', { timeout: 10000 }).catch(() => {});
          const cards = await g.$$('#cards .gs-bigcard');
          if (!cards[c]) break;
          await cards[c].click({ timeout: 10000 }).catch(async e => { await shot(g, 'garage-card-click'); throw new Error(w + ': could not press card ' + (c + 1) + ': ' + String(e.message).split('\n').filter(l => /intercepts|visible|stable|enabled|detached/i.test(l)).slice(-1)); });
          if (!(await g.waitForSelector('#view-jobs:not([hidden])', { timeout: 15000 }).then(() => true).catch(() => false))) { bad.push(w + ': card ' + (c + 1) + ' did not open its work orders'); continue; }
          const j = await g.evaluate(() => ({ title: document.getElementById('jobs-title').textContent, n: document.querySelectorAll('#jobs .gs-job').length, flash: document.querySelectorAll('#jobs .gs-job.gs-new').length, side: document.documentElement.scrollWidth > innerWidth + 1,
            out: [...document.querySelectorAll('#view-jobs *')].filter(x => x.offsetParent && x.getBoundingClientRect().right > innerWidth + 1).map(x => x.tagName.toLowerCase() + (x.className ? '.' + String(x.className).split(' ').join('.') : '') + ' "' + x.textContent.trim().slice(0, 30) + '" ' + Math.round(x.getBoundingClientRect().right) + 'px').slice(0, 4) }));
          per.push(j);
          if (j.n > 15) bad.push(w + ': ' + j.title + ' lists ' + j.n + ' work orders (15 at most)');
          if (j.side) bad.push(w + ': ' + j.title + ' scrolls sideways (' + j.out.join(', ') + ')');
          if (w === 1024 && !rec.service) {
            // A service work order (one with a checklist), looked at on the tablet only.
            for (let i = 0; i < j.n && !rec.service; i++) {
              await g.evaluate(k => document.querySelectorAll('#jobs .gs-job')[k].click(), i);
              await g.waitForSelector('#view-job:not([hidden])', { timeout: 10000 }).catch(() => {});
              const has = await g.evaluate(() => !document.getElementById('job-checks').hidden && document.querySelectorAll('#job-checks [data-ck]').length > 0);
              if (has) {
                const sv = { unit: await g.$eval('#job-unit', x => x.textContent.trim()) };
                // 6.71 (#533): the day finished starts on the work day (after midnight, still the day the shift began).
                sv.dayFinished = await g.$eval('#job-reading input[data-read="~on"]', x => x.value).catch(() => '');
                if (sv.dayFinished !== operatingDay()) bad.push('the day finished starts on ' + sv.dayFinished + ', not the work day ' + operatingDay());
                rec.service = sv;
                await g.click('#job-done', { timeout: 10000 }).catch(e => { throw new Error('could not press Complete: ' + String(e.message).split('\n').filter(l => /intercepts|visible|stable|enabled|detached/i.test(l)).slice(-1)); });
                await g.waitForTimeout(800);
                sv.early = await g.evaluate(() => ({ msg: (document.getElementById('gs-message') || {}).textContent || '', locked: document.getElementById('job-done').classList.contains('locked'), red: document.querySelectorAll('#job-checks .gs-ck.need').length, view: !document.getElementById('view-job').hidden }));
                if (!sv.early.locked || !/before Complete/.test(sv.early.msg) || !sv.early.view) bad.push('Complete was not locked on an unfinished checklist (' + JSON.stringify(sv.early).slice(0, 160) + ')');
                // Every line OK, every tire 8, the hours/miles, then scroll to the bottom.
                const ids = await g.$$eval('#job-checks [data-ck][data-r="OK"]', b => [...new Set(b.map(x => x.dataset.ck))]);
                for (const id of ids) await g.click('#job-checks [data-ck="' + id + '"][data-r="OK"]', { timeout: 10000 }).catch(e => { throw new Error('could not press OK on checklist line ' + id + ': ' + String(e.message).split('\n').filter(l => /intercepts|visible|stable|enabled|detached/i.test(l)).slice(-1)); });
                sv.lines = ids.length;
                sv.tires = await g.$$eval('#job-checks [data-tire]', t => [...new Set(t.map(x => x.dataset.tire.split('~')[0]))].map(id => t.filter(x => x.dataset.tire.split('~')[0] === id).length));
                if (sv.tires.some(n => n !== 8)) bad.push('a tread depth line has ' + sv.tires.join('/') + ' tires (8 each)');
                for (const t of await g.$$('#job-checks [data-tire]')) await t.fill('8');
                for (const r of await g.$$('#job-reading input[data-read="~hours"], #job-reading input[data-read="~miles"]')) if (!(await r.inputValue())) await r.fill('1');
                sv.reading = await g.$$eval('#job-reading label > span', x => x.map(y => y.textContent.trim()));
                await g.evaluate(() => { const s = document.querySelector('#view-job .gs-scroll'); s.scrollTop = s.scrollHeight; s.dispatchEvent(new Event('scroll')); });
                await g.waitForTimeout(800);
                sv.count = await g.$eval('#ck-count', x => x.textContent.trim()).catch(() => '');
                sv.unlocked = await g.evaluate(() => !document.getElementById('job-done').classList.contains('locked'));
                if (!sv.unlocked) bad.push('Complete stayed locked with every line, tire and reading filled in (' + sv.count + ')');
                await shot(g, 'garage-service-checklist');
                await g.click('#job-done', { timeout: 10000 }).catch(e => { throw new Error('could not press Complete: ' + String(e.message).split('\n').filter(l => /intercepts|visible|stable|enabled|detached/i.test(l)).slice(-1)); });
                sv.asks = await g.waitForSelector('#view-sign:not([hidden])', { timeout: 10000 }).then(() => true).catch(() => false);
                if (!sv.asks) bad.push('Complete with the checklist done did not ask who completed it');
                else { await shot(g, 'garage-service-who'); await g.click('#sign-cancel', { timeout: 10000 }).catch(e => { throw new Error('could not press Cancel on Who completed it: ' + String(e.message).split('\n').filter(l => /intercepts|visible|stable|enabled|detached/i.test(l)).slice(-1)); }); }
                rec.service = sv;
              }
              await g.evaluate(() => { const b = [...document.querySelectorAll('#view-job [data-go="jobs"], #view-job button')].find(x => /back|work orders/i.test(x.textContent) && x.offsetParent); if (b) b.click(); });
              await g.waitForSelector('#view-jobs:not([hidden])', { timeout: 10000 }).catch(() => {});
            }
          }
          await shot(g, 'garage-jobs-' + w + '-' + (c + 1));
        }
        rec['jobs' + w] = per;
      }
      if (!rec.service) bad.push('no service work order with a checklist on the practice copy to look at');
      rec.awake = await g.evaluate(() => { const v = document.getElementById('keep-awake'); return { how: document.documentElement.dataset.awake || '', video: v ? (v.paused ? 'paused' : 'playing') : '' }; });
      if (!(rec.awake.how === 'lock' || (rec.awake.how === 'video' && rec.awake.video === 'playing'))) bad.push('the Garage Station does not keep its screen on (' + JSON.stringify(rec.awake) + ')');
      await g.setViewportSize({ width: 1024, height: 768 });
      // #518: the tablet is kept on the Garage Station.
      await g.goto(SITE + '/loadout.html', { waitUntil: 'domcontentloaded' }).catch(() => {});
      await g.waitForTimeout(4000);
      rec.lockedTo = new URL(g.url()).pathname;
      rec.auditAdmin = await auditIsAdmin();
      if (rec.auditAdmin) {
        if (rec.lockedTo !== '/loadout.html') bad.push('an Administrator was kept on the Garage Station (loadout.html went to ' + rec.lockedTo + ')');
        await open(g, 'garage-station.html');
        rec.adminHome = await g.waitForSelector('#admin-home', { timeout: 15000 }).then(() => true).catch(() => false);
        if (!rec.adminHome) bad.push('no Operations button for an Administrator on the Garage Station');
      } else if (rec.lockedTo !== '/garage-station.html') bad.push('the Garage tablet is not locked: loadout.html stayed on ' + rec.lockedTo);
      if (g.w.errors.length) bad.push('page errors: ' + g.w.errors.slice(0, 3).join(' | '));
      const failed = g.w.calls.filter(c => c.status !== 200 || c.error);
      if (failed.length) bad.push('a call answered ' + failed[0].fn + ' ' + failed[0].status + ' ' + String(failed[0].error).slice(0, 150));
    } finally {
      await g.evaluate(() => { try { localStorage.clear(); } catch (e) { /* none */ } }).catch(() => {});
      await g.done();
      await adm('stationRemove', { key: st.key }).catch(e => bad.push('the test station was not removed: ' + String(e.message).slice(0, 80)));
      if (madeSvc) await fdb.collection('workOrders').doc(madeSvc).delete().catch(e => bad.push('the test service work order was not deleted: ' + String(e.message).slice(0, 80)));
    }
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.69 (#526, look only): trailers 533, 824, 876 and 950 are Uniontown's on the trailer pick lists (Case Loadout, Daily
  // Dispatch); one marked down is left off while it is down (Joe 10/11), so its status is read too.
  await write('Trailers 533, 824, 876, 950 on Uniontown pick lists (look only)', async (p, rec) => {
    const want = ['T-533', 'T-824', 'T-876', 'T-950'], bad = [];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const eq = (await db.collection('equipment').get()).docs.map(d => d.data()).filter(e => want.includes(String(e.unit || '').toUpperCase()));
    rec.equipment = eq.map(e => ({ unit: e.unit, type: e.type, facilityId: e.facilityId, location: e.location, status: e.status }));
    const down = (u) => eq.some(e => String(e.unit).toUpperCase() === u && e.status && String(e.status).toUpperCase() !== 'ACTIVE');
    await open(p, 'loadout.html');
    await p.waitForSelector('#rows tr[data-row]', { timeout: 20000 });
    await p.waitForFunction(() => document.querySelectorAll('#lo-trailers option').length > 1, null, { timeout: 20000 }).catch(() => {});
    const lo = await p.$$eval('#lo-trailers option', o => o.map(x => x.value.toUpperCase()));
    rec.loadout = want.map(u => u + (lo.includes(u) ? ' listed' : down(u) ? ' down' : ' MISSING'));
    for (const u of want) if (!lo.includes(u) && !down(u)) bad.push('Case Loadout trailer list has no ' + u);
    // Daily Dispatch's trailer picker (edit.js lists.allTrailers: Uniontown's trailers before the down ones are left out).
    await open(p, 'daily.html');
    await p.waitForFunction(() => import('./js/edit.js').then(m => m.lists.allTrailers.length > 0), null, { timeout: 30000, polling: 1000 }).catch(() => {});
    const dl = await p.evaluate(() => import('./js/edit.js').then(m => m.lists.allTrailers.map(e => String(e.unit).toUpperCase())));
    rec.daily = want.map(u => u + (dl.includes(u) ? ' listed' : ' MISSING'));
    if (!dl.length) bad.push('Daily Dispatch trailer list did not load');
    else for (const u of want) if (!dl.includes(u)) bad.push('Daily Dispatch trailer list has no ' + u);
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.70 (#524): Jug Trailers. The test adds a typed trailer (PT-99..), makes it Loaded with an item and notes, then Left the Lot
  // takes it off the list (the clean-up takes off any one a stopped run left). Look at 1536, 1024 and 390.
  await write('Jug Trailers add, fill and Left the Lot', async (p, rec) => {
    const bad = [];
    for (const [w, h] of [[1536, 790], [1024, 768], [390, 844]]) {
      await p.setViewportSize({ width: w, height: h });
      await open(p, 'jug-trailers.html');
      await p.waitForFunction(() => !/Reading the trailers/.test((document.getElementById('rows') || {}).textContent || ''), null, { timeout: 30000 }).catch(() => {});
      const look = await p.evaluate(() => ({ side: document.documentElement.scrollWidth > innerWidth + 1, sum: (document.getElementById('sum') || {}).textContent || '', rows: document.querySelectorAll('#rows tr[data-id]').length,
        small: [...document.querySelectorAll('#rows td, #card button, #card input, #sum span')].filter(x => x.offsetParent && parseFloat(getComputedStyle(x).fontSize) < 16).length }));
      rec['look' + w] = look;
      if (look.side) bad.push(w + ': page scrolls sideways');
      if (look.small) bad.push(w + ': ' + look.small + ' words under 16px');
      await shot(p, 'jug-trailers-' + w);
    }
    await p.setViewportSize({ width: 1536, height: 790 });
    await open(p, 'jug-trailers.html');
    await p.waitForSelector('#add:not([disabled])', { timeout: 30000 });
    // 6.71 (#534): the screen is Plant Material Trailers, in Debag / Labeling Room.
    rec.title = await p.evaluate(() => [(document.querySelector('.head h1') || {}).textContent, (document.querySelector('.head .eyebrow') || {}).textContent].join(' · '));
    if (!/Plant Material Trailers/.test(rec.title)) bad.push('the screen is called ' + rec.title + ' (Plant Material Trailers)');
    const num = 'PT-99' + String(Math.floor(Math.random() * 90) + 10);
    rec.trailer = num;
    await p.click('#add');
    await p.fill('#add-number', num);
    await timed(p, rec, 'Add to the Lot', () => p.click('#add-go'), { fn: (n) => [...document.querySelectorAll('#rows tr[data-id]')].some(r => r.textContent.includes(n)), arg: num }, 20000);
    try {
      await p.waitForSelector('#card [data-status="LOADED"]', { timeout: 10000 });
      await timed(p, rec, 'Loaded', () => p.click('#card [data-status="LOADED"]'), { fn: (n) => [...document.querySelectorAll('#rows tr[data-id]')].some(r => r.textContent.includes(n) && /Loaded/.test(r.textContent)), arg: num }, 20000);
      await p.fill('#lines [data-line="item"] >> nth=0', 'Practice test item');
      await p.fill('#lines [data-line="pallets"] >> nth=0', '2');
      await p.keyboard.press('Tab');
      await p.waitForFunction((n) => [...document.querySelectorAll('#rows tr[data-id]')].some(r => r.textContent.includes(n) && /Practice test item, 2 pallets/.test(r.textContent)), num, { timeout: 20000 })
        .catch(() => bad.push('the item and pallets did not show on the list'));
      await p.fill('#card [data-notes]', 'Practice copy test (taken off by the test)');
      await p.keyboard.press('Tab');
      await p.waitForTimeout(1500);
      rec.history = await p.$$eval('#card .jt-hist li', l => l.map(x => x.textContent.trim()).slice(0, 4));
      if (!rec.history.length) bad.push('no history on the trailer');
      await shot(p, 'jug-trailer-filled');
    } finally {
      await p.click('#card #left').catch(() => {});
      await p.waitForFunction((n) => ![...document.querySelectorAll('#rows tr[data-id]')].some(r => r.textContent.includes(n)), num, { timeout: 20000 }).then(() => { rec.left = true; }, () => bad.push('Left the Lot did not take ' + num + ' off the list'));
    }
    const failed = p.w.calls.filter(c => c.status !== 200 || c.error);
    if (failed.length) bad.push('a save answered ' + failed[0].status + ' ' + String(failed[0].error).slice(0, 150));
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.70 (#530, look only): Weekly Dispatch's Route Run Days opens the normal week's Route Days with Normal Week / Holiday Week
  // tabs, Holiday Week opens Route Week Override at the same week and its Normal Week tab comes back; a day that does not run
  // offers a plain NEEDS DRIVER (nothing is picked; the list is closed again).
  await write('Route Run Days tabs and Weekly NEEDS DRIVER (look only)', async (p, rec) => {
    const bad = [];
    await p.setViewportSize({ width: 1536, height: 790 });
    await open(p, 'weekly.html');
    await p.waitForSelector('#run-days', { timeout: 20000 });
    await p.waitForSelector('tr td.day.editable', { timeout: 30000 }).catch(() => {});
    // A day that does not run: its driver list.
    const cell = await p.evaluate(() => { const td = [...document.querySelectorAll('tr td.day.editable')].find(t => /not running|does not run/i.test(t.textContent)); if (!td) return ''; const tr = td.closest('tr'); return tr.dataset.index !== undefined ? 'tr[data-index="' + tr.dataset.index + '"] td[data-day="' + td.dataset.day + '"]' : ''; });
    rec.cell = cell;
    if (!cell) bad.push('no day that does not run on Weekly to look at');
    else {
      await p.click(cell);
      await p.waitForSelector('.popover select[data-kind="driver"]', { timeout: 8000 }).catch(() => {});
      rec.options = await p.$$eval('.popover select[data-kind="driver"] option', o => o.map(x => x.value + '=' + x.textContent.trim()).slice(0, 8)).catch(() => []);
      if (!rec.options.some(o => o.startsWith('__NEEDS__='))) bad.push('a day that does not run has no NEEDS DRIVER choice (' + rec.options.join(', ') + ')');
      if (rec.options.some(o => /PLANT LOAD\W+NEEDS DRIVER/i.test(o))) bad.push('the old "PLANT LOAD — NEEDS DRIVER" choice is still there');
      await p.keyboard.press('Escape');
      await p.mouse.click(5, 5);
      await p.waitForTimeout(500);
      if (p.w.calls.some(c => /setRuns|saveDriver|setDriver/.test(c.op || ''))) bad.push('looking at the list saved something');
    }
    const week = new URL(p.url()).searchParams.get('week') || '';
    await p.click('#run-days');
    await p.waitForURL(/routes\.html/, { timeout: 15000 }).catch(() => {});
    rec.runDays = new URL(p.url()).pathname + new URL(p.url()).search;
    if (!/\/routes\.html/.test(rec.runDays)) bad.push('Route Run Days opened ' + rec.runDays + ' (should be Route Days)');
    else {
      await p.waitForSelector('#week-tabs:not([hidden])', { timeout: 15000 }).catch(() => {});
      rec.tabs = await p.evaluate(() => { const t = document.getElementById('week-tabs'); return t ? { shown: !t.hidden, normal: document.getElementById('tab-normal').getAttribute('aria-selected'), side: document.documentElement.scrollWidth > innerWidth + 1 } : null; });
      if (!rec.tabs || !rec.tabs.shown) bad.push('Route Days has no Normal Week / Holiday Week tabs');
      else if (rec.tabs.normal !== 'true') bad.push('Normal Week is not the tab picked on Route Days');
      await shot(p, 'route-run-days');
      await p.click('#tab-holiday');
      await p.waitForURL(/routeweek\.html/, { timeout: 15000 }).catch(() => {});
      rec.holiday = new URL(p.url()).pathname + new URL(p.url()).search;
      if (!/\/routeweek\.html/.test(rec.holiday)) bad.push('Holiday Week opened ' + rec.holiday);
      else {
        if (week && !rec.holiday.includes(week)) bad.push('Holiday Week did not keep the week ' + week + ' (' + rec.holiday + ')');
        await p.waitForSelector('#tab-normal', { timeout: 15000 });
        rec.holidayTab = await p.$eval('#tab-holiday', b => b.getAttribute('aria-selected'));
        if (rec.holidayTab !== 'true') bad.push('Holiday Week is not the tab picked on Route Week Override');
        await shot(p, 'route-holiday-week');
        await p.click('#tab-normal');
        await p.waitForURL(/routes\.html/, { timeout: 15000 }).catch(() => {});
        if (!/\/routes\.html/.test(p.url())) bad.push('Normal Week did not go back to Route Days');
      }
    }
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.71 (#535, look only): Weekly Dispatch Template (weekly.html, the week got ready and published) and Weekly Dispatch
  // (weekly.html?view=live, the live week Daily Dispatch runs): each names itself, links to the other, and the live one has no
  // Route Run Days, Reset, Publish or week arrows; the title and buttons fit (they wrap) at 1536 and 1024.
  await write('Weekly Dispatch and Weekly Dispatch Template (look only)', async (p, rec) => {
    const bad = [];
    for (const [w, h] of [[1536, 790], [1024, 768]]) {
      await p.setViewportSize({ width: w, height: h });
      for (const [name, url, other] of [['Weekly Dispatch Template', 'weekly.html', 'Weekly Dispatch'], ['Weekly Dispatch', 'weekly.html?view=live', 'Weekly Dispatch Template']]) {
        await open(p, url);
        await p.waitForSelector('#page-name', { timeout: 20000 }).catch(() => {});
        await p.waitForTimeout(1500);
        const l = await p.evaluate(() => {
          const shown = (id) => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none' && !!e.offsetParent; };
          const head = document.querySelector('#screen .head');
          return { h1: (document.getElementById('page-name') || {}).textContent, title: document.title, other: (document.getElementById('go-other') || {}).textContent, href: (document.getElementById('go-other') || {}).getAttribute('href'),
            week: (document.getElementById('week-date') || {}).value, weekOff: !!(document.getElementById('week-date') || {}).disabled, published: (document.getElementById('published') || {}).textContent,
            btns: ['run-days', 'reset', 'publish', 'prev', 'next'].filter(shown), side: document.documentElement.scrollWidth > innerWidth + 1,
            out: head ? [...head.querySelectorAll('button, a, h1')].filter(x => x.offsetParent && x.getBoundingClientRect().right > innerWidth + 1).map(x => x.textContent.trim().slice(0, 20)) : [] };
        });
        rec[name + ' ' + w] = l;
        if (l.h1 !== name) bad.push(w + ' ' + url + ': called "' + l.h1 + '"');
        if (l.other !== other) bad.push(w + ' ' + url + ': its other-screen button says "' + l.other + '"');
        if (l.side || l.out.length) bad.push(w + ' ' + url + ': runs off the screen (' + l.out.join(', ') + ')');
        if (url.includes('view=live')) { if (l.btns.length) bad.push(w + ' Weekly Dispatch shows ' + l.btns.join(', ')); if (!l.weekOff) bad.push(w + ' Weekly Dispatch lets the week be changed'); }
        else if (!l.btns.includes('publish')) bad.push(w + ' Weekly Dispatch Template has no Publish');
        await shot(p, 'weekly-' + (url.includes('live') ? 'live' : 'template') + '-' + w);
      }
    }
    // The live week is the one Daily Dispatch runs.
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const lw = await r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit')).collection('config').doc('app').get().catch(() => null);
    rec.liveWeeks = lw && lw.exists ? { current: (lw.data().liveWeeks || {}).current, next: (lw.data().liveWeeks || {}).next } : null;
    if (rec.liveWeeks && rec.liveWeeks.current && rec['Weekly Dispatch 1536'].week && rec['Weekly Dispatch 1536'].week !== rec.liveWeeks.current) bad.push('Weekly Dispatch shows ' + rec['Weekly Dispatch 1536'].week + ', the live week is ' + rec.liveWeeks.current);
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // Cooler temperature: a reading on the first cooler.
  await write('Cooler temperature reading', async (p, rec) => {
    await open(p, 'temps.html');
    // The coolers drawn first (a page still blank read as no coolers once).
    await p.waitForSelector('.tp-manual', { timeout: 30000 }).catch(() => {});
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
    // The page drawn first (a page still blank read as no box once).
    await p.waitForSelector('.sn-entry', { timeout: 30000 }).catch(() => {});
    const box = await p.$('.sn-entry');
    if (!box) throw new Error('no shift note box');
    await box.fill('Practice copy test note');
    const t = Date.now();
    await p.keyboard.press('Tab');
    for (let i = 0; i < 40 && !p.w.calls.some(c => c.at >= t); i++) await p.waitForTimeout(250);
    rec.steps.push({ what: 'note saved', ms: Date.now() - t });
  });
}

/*
 * Click speed (Joe 10/29: "I'd also want to do a click speed test"): presses that only change what is shown (day and week
 * arrows, tabs, a screen's view picker) and moving from one screen to the next through the menu, each timed from the press
 * until the screen first changes ("answered") and until it stops changing ("done"). Nothing is saved.
 */
const CLICK_SCREENS = ['distribution.html', 'daily.html', 'weekly.html', 'routes.html', 'routeweek.html', 'loadout.html', 'loadout.html?area=BOXING', 'unloading.html',
  'returns.html', 'washing.html', 'scheduler.html', 'checkins.html', 'scorecard.html', 'otr.html', 'fleet.html', 'quality.html', 'reports.html', 'shiftreports.html',
  'plant-station.html', 'uploads.html', 'administration.html'];
// From one screen to the next by the link a person presses (the left menu, or a screen's own button).
const CLICK_PATH = ['index.html', 'distribution.html', 'daily.html', 'weekly.html', 'routes.html', 'drivers.html', 'plant.html', 'loadout.html', 'unloading.html', 'manager.html', 'yard.html', 'maint.html', 'issues.html', 'fleet.html', 'administration.html'];
async function pressTimed(page, el, label) {
  await page.evaluate(() => { window.__clickAt = performance.now(); });
  const t = Date.now();
  await el.click({ timeout: 5000 });
  let first = -1;
  while (Date.now() - t < 15000) {
    await page.waitForTimeout(50);
    const s = await page.evaluate(() => { const m = (window.__muts || []).filter(x => x >= window.__clickAt); return { first: m.length ? m[0] - window.__clickAt : -1, last: m.length ? m[m.length - 1] - window.__clickAt : -1, now: performance.now() - window.__clickAt }; }).catch(() => null);
    if (!s) continue;
    if (s.first >= 0 && first < 0) first = Math.round(s.first);
    if (s.now - Math.max(0, s.last) > 600) return { label, answeredMs: first, doneMs: s.last >= 0 ? Math.round(s.last) : -1 };
  }
  return { label, answeredMs: first, doneMs: -1, slow: true };
}
async function clicks() {
  report.clicks = [];
  for (const url of CLICK_SCREENS) {
    const page = await newPage();
    const row = { url, presses: [] };
    try {
      await open(page, url);
      const marks = await page.evaluate(() => {
        const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.disabled; };
        const out = [];
        const tag = (el, label) => { if (!el || !vis(el) || out.length >= 8) return; el.dataset.clickTest = String(out.length); out.push(label); };
        ['next', 'prev', 'week-next', 'week-prev'].forEach(id => tag(document.getElementById(id), id.replace('-', ' ') + ' arrow'));
        document.querySelectorAll('.tabs button, .tabs a[href^="#"], #tabs button, [role="tab"]').forEach(b => { if (!b.classList.contains('on') && !b.classList.contains('active')) tag(b, 'tab "' + b.textContent.trim().slice(0, 30) + '"'); });
        return out;
      });
      for (let i = 0; i < marks.length; i++) {
        const el = await page.$('[data-click-test="' + i + '"]');
        if (!el) continue;
        try { row.presses.push(await pressTimed(page, el, marks[i])); } catch (e) { row.presses.push({ label: marks[i], error: String(e.message).split('\n')[0].slice(0, 120) }); }
      }
      // The view picker (Route Editor and others): each choice once.
      const sel = await page.$('#view-select');
      if (sel) {
        for (const v of await page.$$eval('#view-select option', o => o.map(x => x.value).slice(0, 4))) {
          await page.evaluate(() => { window.__clickAt = performance.now(); });
          const t = Date.now();
          await page.selectOption('#view-select', v);
          await page.waitForTimeout(700);
          const s = await page.evaluate(() => { const m = (window.__muts || []).filter(x => x >= window.__clickAt); return m.length ? [m[0] - window.__clickAt, m[m.length - 1] - window.__clickAt] : [-1, -1]; });
          row.presses.push({ label: 'view "' + v + '"', answeredMs: Math.round(s[0]), doneMs: Math.round(s[1]), waitedMs: Date.now() - t });
        }
      }
    } catch (e) { row.error = String(e.message).split('\n')[0].slice(0, 200); }
    row.errors = page.w.errors.slice(0, 4);
    report.clicks.push(row);
    console.log('CLICK ' + url.padEnd(26) + ' ' + row.presses.map(p => p.label + ' ' + (p.error ? 'ERR' : p.answeredMs + '/' + p.doneMs + 'ms')).join(', ') + (row.error ? ' ERROR ' + row.error : ''));
    await page.done();
    save();
  }
  // Screen to screen: one browser tab, each next screen opened by pressing its link on the screen before.
  const page = await newPage();
  report.moves = [];
  await open(page, CLICK_PATH[0]);
  for (let i = 1; i < CLICK_PATH.length; i++) {
    const to = CLICK_PATH[i];
    const link = await page.evaluate((want) => {
      const a = [...document.querySelectorAll('a[href]')].find(x => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 && x.getAttribute('href').split(/[?#]/)[0].replace(/^\.?\//, '') === want; });
      if (!a) return false;
      a.dataset.clickMove = '1';
      return true;
    }, to);
    const t0 = Date.now();
    let how = 'menu link';
    try {
      if (link) await page.click('[data-click-move="1"]', { timeout: 5000 });
      else { how = 'typed address (no link on the screen before)'; await page.goto(SITE + '/' + withWho(to), { waitUntil: 'domcontentloaded' }); }
      await page.waitForURL(u => u.pathname.endsWith('/' + to), { timeout: 15000 });
      let shown = -1;
      while (Date.now() - t0 < 20000) {
        await page.waitForTimeout(100);
        const s = await page.evaluate(() => { const m = window.__muts || []; return { drawing: document.body.classList.contains('ud-drawing'), quiet: !m.length || performance.now() - m[m.length - 1] > 1000, origin: performance.timeOrigin, last: m.length ? m[m.length - 1] : 0 }; }).catch(() => null);
        if (!s) continue;
        if (!s.drawing && shown < 0) shown = Date.now() - t0;
        if (!s.drawing && s.quiet) { report.moves.push({ from: CLICK_PATH[i - 1], to, how, shownMs: shown, doneMs: Math.round(s.origin + s.last - t0) }); break; }
      }
    } catch (e) { report.moves.push({ from: CLICK_PATH[i - 1], to, how, error: String(e.message).split('\n')[0].slice(0, 120) }); }
    const m = report.moves[report.moves.length - 1] || {};
    console.log('MOVE ' + (CLICK_PATH[i - 1] + ' -> ' + to).padEnd(40) + ' ' + (m.error ? 'ERROR ' + m.error : m.shownMs + ' shown, ' + m.doneMs + ' done') + ' (' + how + ')');
    save();
  }
  await page.done();
}

(async () => {
  browser = await chromium.launch();
  try {
    if (process.env.CLICKS_ONLY === '1') { await clicks(); return; }
    const only = (process.env.ONLY || '').split(',').filter(Boolean);
    const pick = (list) => list.filter(([, u]) => !only.length || only.includes(u));
    if (ONLY_STEPS.length) { await writes(); return; }
    await captureAfter('before any write');
    await readPass(pick(SCREENS), { viewport: { width: 1536, height: 790 } }, report.screens, 'r1536');
    await readPass(pick(SCREENS.filter(([, u]) => WIDE.includes(u))), { viewport: { width: 1920, height: 950 } }, report.wide, 'r1920');
    await readPass(pick(SCREENS.filter(([, u]) => PHONE.includes(u))), { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, report.phone, 'r390');
    await readPass(pick(SCREENS.filter(([, u]) => TABLET.includes(u))), { viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true }, report.tablet, 'r1024');
    // Second open of the busiest screens, to see the spread (single runs swing by as much as 2x).
    const again = [];
    await readPass(pick(SCREENS.filter(([, u]) => ['distribution.html', 'daily.html', 'weekly.html', 'loadout.html', 'forecast.html', 'manager.html', 'plant.html'].includes(u))), { viewport: { width: 1536, height: 790 } }, again, 'r1536b');
    report.again = again.map(r => ({ url: r.url, shownMs: r.shownMs, settledMs: r.settledMs }));
    if (process.env.NO_CLICKS !== '1') await clicks();
    if (process.env.NO_WRITES !== '1') await writes();
  } finally {
    report.endedAt = new Date().toISOString();
    save();
    await browser.close();
  }
})().catch(e => { console.error(e); save(); process.exit(1); });
