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
  ['Loadout Center', 'loadout.html'], ['Daily Boxing Loadout', 'loadout.html?area=BOXING'], ['Late Forecast', 'forecast.html'], ['Unloading & Washing', 'unloading.html'],
  ['Product Returns', 'returns.html'], ['Truck Washing', 'washing.html'], ['Trailer Assignments', 'trailers.html'], ['Shipping & Receiving', 'scheduler.html'],
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
    let ask = false;
    try { const dt = JSON.parse(r.request().postData() || '{}').data || {}; op = dt.action || dt.op || ''; ask = !op && !!(dt.checkSaves || dt.plantNames); } catch (e) { /* not json */ }
    // A save call that only asks (which saves this person may make, the plant names) saves nothing: kept apart from the saves.
    w.calls.push({ fn: (m[1] || m[2]) === 'save' && ask ? 'save-ask' : m[1] || m[2], op, status: r.status(), ms: Math.round(t.responseEnd > 0 ? t.responseEnd : -1), at: Date.now(), error: /"error"/.test(body) ? body : '' });
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
  // Names and email addresses are never in a picture: a step that ends on Administration's people lists has them blanked first.
  await page.evaluate(() => { if (!/administration\.html/.test(location.href) || /item=(?!people|employees|role)/.test(location.href) && /item=/.test(location.href)) return;
    document.querySelectorAll('table td, .adm-frame').forEach(td => { if (td.tagName === 'IFRAME') td.style.visibility = 'hidden'; else if (!td.querySelector('select, button')) td.textContent = '\u2588\u2588\u2588'; }); }).catch(() => {});
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
let yardLoad = null, yardOwn = null;
// 6.85 (#620): one red, one green and one yellow everywhere (logic.js COLORS, app.css --red/--green/--yellow). On a page, every
// status mark (late, behind, caution, done, good, a pill or tile...) that is red, green or yellow must be one of the set; its
// words must be readable on their background (contrast 3 or more) and 16px or larger. Only class names and colours are written
// down, never the words (they can be names).
const COLOR_SET = ['#1f7a4d', '#e2f4ea', '#f5c518', '#1c2733', '#9a5b00', '#fff4d6', '#b42318', '#fde8e6', '#0b4f8a', '#e8f0f8', '#5b6775', '#eef2f5'];
const colorCheck = async (pg, label, bad, rec) => {
  const r = await pg.evaluate((SET) => {
    const rgb = s => { const m = String(s).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/); return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null; };
    const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
    const hsl = c => { const r = c.r / 255, g = c.g / 255, b = c.b / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn; if (!d) return { h: 0, s: 0, l };
      const s = d / (1 - Math.abs(2 * l - 1)); let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; return { h, s, l }; };
    const family = c => { const x = hsl(c); if (x.s < 0.45 || x.l < 0.2 || x.l > 0.65) return ''; if (x.h < 15 || x.h >= 340) return 'red'; if (x.h >= 90 && x.h < 170) return 'green'; if (x.h >= 40 && x.h < 62) return 'yellow'; if (x.h >= 15 && x.h < 40) return 'orange'; return ''; };
    const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const bgOf = el => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c && c.a > 0.5) return c; } return { r: 255, g: 255, b: 255, a: 1 }; };
    const STATUS = /late|behind|bad|\bred\b|green|\bok\b|good|caution|warn|\bdue\b|done|k-|amber|yellow|ontime|on-time|early|pill|tile|LOADED|EMPTY|HALF|dep-|alert|flag|stat|sn-r/i;
    const name = el => '.' + String(el.className).split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    const off = new Set(), unread = new Set(), small = new Set(), seen = new Set();
    let n = 0;
    for (const el of document.querySelectorAll('body *')) {
      const cls = typeof el.className === 'string' ? el.className : '';
      // The TEST COPY badge shows only on the practice copy (never on live), in its own ink.
      if (!cls || !STATUS.test(cls) || /badge-test|test-copy-badge/.test(cls)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || !el.getClientRects().length) continue;
      n++;
      const cols = [['color', 'text'], ['backgroundColor', 'background'], ['borderLeftColor', 'edge'], ['borderTopColor', 'edge']];
      for (const [prop, what] of cols) {
        const c = rgb(cs[prop]);
        if (!c || c.a < 0.5) continue;
        if (what === 'edge' && parseFloat(cs[prop.replace('Color', 'Width')]) < 1) continue;
        const f = family(c);
        if (f) { seen.add(f + ' ' + hex(c)); if (!SET.includes(hex(c))) off.add(f + ' ' + hex(c) + ' (' + what + ' of ' + name(el) + ')'); }
      }
      if ([...el.childNodes].some(x => x.nodeType === 3 && x.textContent.trim())) {
        const fg = rgb(cs.color), bg = bgOf(el);
        if (fg) { const a = lum(fg), b = lum(bg), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); if (ratio < 3) unread.add(name(el) + ' ' + hex(fg) + ' on ' + hex(bg) + ' (' + ratio.toFixed(1) + ')'); }
        if (parseFloat(cs.fontSize) < 16) small.add(name(el) + ' ' + cs.fontSize);
      }
    }
    return { n, seen: [...seen].slice(0, 8), off: [...off].slice(0, 6), unread: [...unread].slice(0, 6), small: [...small].slice(0, 6) };
  }, COLOR_SET).catch(e => ({ error: String(e.message).slice(0, 120) }));
  rec.colors = rec.colors || {};
  rec.colors[label] = r;
  if (r.error) { bad.push(label + ': the colour check could not run (' + r.error + ')'); return r; }
  if (r.off.length) bad.push(label + ': colours outside the one set: ' + r.off.join(', '));
  if (r.unread.length) bad.push(label + ': words hard to read: ' + r.unread.join(', '));
  if (r.small.length) bad.push(label + ': words under 16px: ' + r.small.join(', '));
  return r;
};

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
const carryExpected = async (day) => {
  const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
  const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
  const L = require(path.join(__dirname, '..', '..', 'src', 'logic.js')), B = require(path.join(__dirname, '..', '..', 'src', 'board-rules.js'));
  const date = day || operatingDay(), week = L.weekStart(date);
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
// 6.77 (#562): with loads left over from yesterday, a "Yesterday's loads" line sits above them and a "Today's loads" line
// above today's; with none, no line. seq = the list's lines and rows in order ('P' / 'T' line text, 'R' a load row).
const splitCompare = (exp, seq) => {
  const n = exp.prior.length, total = exp.rows.length, bad = [], got = [];
  let rows = 0;
  for (const x of seq) { if (rows >= total) break; if (x === 'R') rows++; got.push(x); }
  const want = n ? ['P'].concat(Array(n).fill('R'), total > n ? ['T'] : [], Array(total - n).fill('R')) : Array(total).fill('R');
  const short = (a) => a.map(x => x === 'R' ? 'R' : x[0]).join('').replace(/R{3,}/g, m => 'R×' + m.length);
  if (short(got) !== short(want)) bad.push('the lines between yesterday\'s and today\'s loads read ' + short(got) + ', expected ' + short(want) + ' (P = Yesterday\'s loads line, T = Today\'s loads line, R = a load)');
  got.filter(x => x !== 'R').forEach(x => { if (x[0] === 'P' && !/^Yesterday's loads/.test(x.slice(2))) bad.push('the yesterday line reads ' + x.slice(2)); if (x[0] === 'T' && !/^Today's loads/.test(x.slice(2))) bad.push('the today line reads ' + x.slice(2)); });
  return { got: short(got), want: short(want), lines: got.filter(x => x !== 'R').map(x => x.slice(2)), bad };
};
// 6.77: the day the load steps work on. Today when today has loads; on a day with none (a Saturday on the practice copy) the
// last day before it that has loads, opened on its own day (?date=), so Start, Skip, depart time and Ended Up Not Running
// still really press on a load. '' = today.
let workDayKept = null;
const workDay = async () => {
  if (workDayKept !== null) return workDayKept;
  const L = require(path.join(__dirname, '..', '..', 'src', 'logic.js')), today = operatingDay();
  workDayKept = '';
  if (!(await carryExpected(today)).rows.some(x => !x.prior)) {
    for (let n = 1; n <= 21; n++) { const d = L.addDays(today, -n); if ((await carryExpected(d)).rows.some(x => !x.prior)) { workDayKept = d; break; } }
    note('Load steps: no loads on the practice copy today (' + today + '), so Start, Skip, depart time, Ended Up Not Running and same-loads ran on ' + (workDayKept || 'no day: none in the last 21 days either') + ', opened on its own day');
  }
  return workDayKept;
};
const wdQ = async () => { const d = await workDay(); return d ? '?date=' + d : ''; };
// 6.77 (#562): the line between yesterday's and today's loads needs both on the list. On a day with yesterday's loads left
// but none of today's (a Saturday on the practice copy), the test adds one load of its own for today, a copy of one of
// yesterday's (practice copy only, marked splitTest and by the test account), and takes it off again after the look.
const splitTestLoad = async () => {
  const today = operatingDay(), exp = await carryExpected(today);
  if (!exp.prior.length || exp.rows.some(x => !x.prior)) return { made: '', remove: async () => {} };
  return todayTestLoads(1);
};
// n loads of the test's own for today (copies of one of the last days' loads, practice copy only, marked splitTest), for a step
// that needs today's loads on a day with none. remove() takes them off again.
// 6.91: drivers' and people's names (LAST, FIRST) are blanked before a picture.
const blankPeople = (pg) => pg.evaluate(() => { const re = /^[A-Z][A-Z'.\- ]+, [A-Z][A-Z'.\- ]+$/;
  document.querySelectorAll('td, td *, option, button, span, b').forEach(e => { if (e.children.length === 0 && re.test(e.textContent.trim())) e.textContent = 'DRIVER'; });
  document.querySelectorAll('option').forEach(o => { const m = /^([A-Z][A-Z'.\- ]+, [A-Z][A-Z'.\- ]+)( .*)?$/.exec(o.textContent.trim()); if (m) o.textContent = 'DRIVER' + (m[2] || ''); }); }).catch(() => {});
const todayTestLoads = async (n, opt) => {
  opt = opt || {};
  const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
  const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
  const L = require(path.join(__dirname, '..', '..', 'src', 'logic.js'));
  for (const d of (await db.collection('runs').where('addedBy', '==', EMAIL).get()).docs.filter(x => x.data().splitTest === true)) await d.ref.delete();
  const today = operatingDay(), runs = (await db.collection('runs').where('weekStart', 'in', [L.weekStart(L.addDays(today, -14)), L.weekStart(L.addDays(today, -7)), L.weekStart(today)]).get()).docs.map(d => Object.assign({}, d.data(), { id: d.id }));
  let base = null, from = '';
  // 11-7-26: the practice copy's weeks stop at 10-25-26, so on a Saturday the last 7 days hold none of its loads; look back 3 weeks.
  for (let k = 1; k <= 21 && !base; k++) { from = L.addDays(today, -k); base = runs.find(x => !x.extraRun && !x.splitTest && L.loadBlocksFor(x, from).length && L.liveFlagShown(x, 'displayMobileRoute', 'mobile') && L.liveFlagShown(x, 'displayDaily', 'daily')); }
  if (!base) return { made: '', ids: [], remove: async () => {} };
  const off = opt.offset || 0, delivery = L.addDays(today, -off);
  const b = L.loadBlocksFor(base, from)[0], p = L.dayPrefix(delivery), was = (base.days || {})[b.prefix] || {}, ids = [];
  for (let i = 1; i <= n; i++) {
    const day = Object.assign({}, was, { runs: true, loadDayOffset: off, deliveryDate: delivery, loadDate: today, departureDate: delivery, loadStatus: '', completeTime: null, loadedComplete: false, trailer: '', casesOut: null, driverNotes: '', moveMark: null, loadSequenceOverride: null, loadSequence: 900 + i }, opt.day || {});
    const days = {}; L.DAYS.forEach(x => { days[x] = x === p ? day : { runs: false }; });
    const id = L.weekStart(delivery) + '__practice_split_' + Date.now().toString(36) + i;
    const run = Object.assign({}, base, { weekStart: L.weekStart(delivery), runId: String(base.runId || '') + '__practicesplit' + i, run: 'PRACTICE TEST ' + i, days, sheetRow: null, extraOf: null, splitTest: true, addedBy: EMAIL, addedAt: new Date().toISOString(), testEdited: true }, opt.leavesOn ? { masterShow: Object.assign({}, base.masterShow || {}, { leavesOn: opt.leavesOn }) } : {});
    delete run.id;
    await db.collection('runs').doc(id).set(run);
    ids.push(id);
  }
  return { made: ids.join(', ') + ' (copies of ' + base.id + ', loaded ' + today + ', delivered ' + delivery + ')', ids, remove: async () => { for (const id of ids) await db.collection('runs').doc(id).delete(); } };
};
// 6.79: a step that needs a load on today's list, on a day with none at all (a Sunday on the practice copy): one load of the
// test's own for today (todayTestLoads), taken off again by remove(). Nothing is made when today already has a load.
const needTodayLoad = async (what) => {
  const exp = await carryExpected(operatingDay());
  if (exp.rows.length) return { made: '', remove: async () => {} };
  const t = await todayTestLoads(1);
  note(what + ': no loads on the practice copy today (' + operatingDay() + '), so the test put one of its own on today\'s list and took it off after: ' + (t.made || 'none could be made'));
  if (t.made) await new Promise(res => setTimeout(res, 6000));
  return t;
};
// 6.84: the test's own shift notes (the Shift note step's "Practice copy test note" and the Shift Notes step's "PRACTICE TEST SHIFT
// NOTE ..."), and the review notes under them, taken off the practice copy. Only entries the test account wrote.
const clearTestShiftNotes = async () => {
  const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
  const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
  const docs = (await db.collection('plantJournal').where('recordedBy', '==', EMAIL).get()).docs.filter(d => d.data().type === 'SHIFT_REPORT');
  const v = (d) => ((d.data().payload || {}).values || {});
  const mine = docs.filter(d => /^(Practice copy test note|PRACTICE TEST SHIFT NOTE)/.test(String(v(d).Entry || '')) && !v(d).ParentId);
  const ids = new Set(mine.map(d => d.data().recordId));
  const kids = docs.filter(d => ids.has(String(v(d).ParentId || '')));
  for (const d of mine.concat(kids)) await d.ref.delete();
  return mine.length + ' notes, ' + kids.length + ' review notes';
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
    // 6.84: the test's own shift notes left by earlier runs.
    rec.shiftNotes = await clearTestShiftNotes().catch(e => 'could not: ' + String(e.message).slice(0, 120));
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
    const jugs = (await db.collection('jugTrailers').where('inLot', '==', true).get()).docs.map(d => Object.assign({ id: d.id }, d.data())).filter(t => /^PT-99\d\d$/.test(String(t.unit || t.number || '')) || /(^|\s)PT-99\d\d$/.test(String(t.number || '')));
    for (const t of jugs) await save('saveJugTrailer', { facilityId: t.facilityId, op: 'left', trailerId: t.id });
    rec.jugTrailers = jugs.map(t => t.number);
    // 6.79 (#582): unit numbers PT-99.., the Practice Test Co and the Practice test item a stopped run left on the plant's lists.
    { const jl = db.collection('jugTrailerLists').doc('fac_uniontown'), jd = (await jl.get()).data();
      if (jd && Array.isArray(jd.companies)) {
        const was = JSON.stringify(jd);
        jd.companies = jd.companies.filter(c => !/^Practice Test Co$/i.test(c.name)).map(c => Object.assign({}, c, { units: (c.units || []).filter(u => !/^PT-99\d\d$/.test(u)) }));
        if (Array.isArray(jd.items)) jd.items = jd.items.filter(x => !/^Practice test item$/i.test(x));
        if (JSON.stringify(jd) !== was) { await jl.set(jd); rec.jugListsCleaned = true; }
      } }
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
    await open(p, 'loadout.html' + await wdQ());
    await p.waitForSelector('#rows tr[data-row]', { timeout: 20000 }).catch(() => {});
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
    await open(p, 'loadout.html' + await wdQ());
    await p.waitForSelector('#rows tr[data-row]', { timeout: 20000 }).catch(() => {});
    const r = report.writes[report.writes.length - 1].load;
    if (!r) throw new Error('nothing to put back');
    const row = 'tr[data-row="' + r.row + '"]';
    await p.click(row + ' button.state');
    await timed(p, rec, 'Not started', () => p.click('#state-pop [data-s="NOT_STARTED"]'), { fn: (s) => { const t = document.querySelector(s); return t && !t.classList.contains('done') && !t.classList.contains('loading'); }, arg: row });
  });

  // Skip on the next load not started.
  await write('Loadout Skip', async (p, rec) => {
    // Then today's loadout (the loadout day kept in this browser goes back to today).
    // Skip moves a load in today's order only: on a day with no loads of its own, two loads of the test's own for today.
    const own = (await workDay()) ? await todayTestLoads(3) : null;
    if (own) { rec.ownLoads = own.made; if (!own.ids.length) throw new Error('no loads today and none to copy for the test'); }
    try {
    await open(p, 'loadout.html' + (own ? '?date=' + operatingDay() : ''));
    await p.waitForSelector('#rows tr[data-row]', { timeout: 20000 }).catch(() => {});
    if (own) await p.waitForFunction((n) => document.querySelectorAll('#rows button.skip').length >= n, 2, { timeout: 20000 }).catch(() => {});
    // Tags already on the list before this Skip (who and when), so a tag left from earlier can be told apart.
    rec.tagsBefore = await p.evaluate(() => [...document.querySelectorAll('#rows tr[data-row] .moved-tag')].map(t => t.closest('tr').children[0].textContent.trim() + ' ' + t.closest('tr').children[1].textContent.trim().slice(0, 30) + ' | ' + t.title));
    if (!own && await p.isVisible('#go-today')) { await p.click('#go-today'); await p.waitForTimeout(2500); }
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
    } finally { if (own) await own.remove(); }
  });
  await captureAfter('after Loadout Skip');

  // Daily Dispatch: a depart time 5 minutes later, then back.
  for (const [label, add] of [['Daily depart time +5 min', 5], ['Daily depart time put back', -5]]) {
    await write(label, async (p, rec) => {
      await open(p, 'daily.html' + await wdQ());
      await p.waitForSelector('#rows tr[data-id]', { timeout: 20000 }).catch(() => {});
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

  // Daily Boxing Loadout: Start / End times on the first box load, then back.
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
    // 6.77 (#556): Add Load's Route / Run fills in by itself once the routes arrive (it stayed empty when opened early).
    rec.routesFilled = await p.waitForFunction(() => [...document.querySelectorAll('#s-route option')].some(o => o.value !== ''), null, { timeout: 20000 }).then(() => true).catch(() => false);
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
    await open(p, 'loadout.html' + await wdQ());
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sel.date)) sel.date = (await workDay()) || operatingDay();
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
      let picks = (await yardCandidates(p)).slice(0, 5);
      // No load still to leave (a Saturday night on the practice copy): one load of the test's own, loaded today for tomorrow
      // at 10:00 AM (Delivery Day), taken off after the next step.
      if (!picks.length) {
        yardOwn = await todayTestLoads(1, { offset: -1, leavesOn: 'Delivery Day', day: { dispatchTime: 600, startTime: 600 } });
        rec.ownLoad = yardOwn.made;
        await p.waitForTimeout(8000);
        picks = (await yardCandidates(p)).filter(x => yardOwn.ids.some(id => x.row.indexOf(id) === 0)).slice(0, 1);
      }
      if (!picks.length) throw new Error('no trailer due, and no load of today or yesterday not started to load a trailer on' + (yardOwn ? ' (the test\'s own load did not show either)' : ''));
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
  if (yardOwn) { await yardOwn.remove().catch(() => {}); yardOwn = null; }

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
    for (const want of ['Plant Operations', 'Route Distribution', 'Reports & Safety']) if (!rec.home.includes(want)) throw new Error('Home has no ' + want + ' card: ' + rec.home.join(', '));
    const cut = await p.$$eval('.hq-main, .hq-sub, .hq-card a.open-text', a => a.filter(x => x.offsetParent && x.scrollWidth > x.clientWidth + 1).map(x => x.textContent.trim()));
    if (cut.length) throw new Error('Home buttons cut: ' + cut.join(', '));
    await open(p, 'group.html?g=plantops');
    await p.waitForSelector('.launch-card', { timeout: 20000 });
    rec.plantops = await p.$$eval('.launch-card', c => c.map(x => x.dataset.side));
    // 6.78 (#569): Plant Maintenance has its own Home card and left Plant Operations; Debag / Labeling Room is in it.
    if (rec.plantops.includes('pmaint')) throw new Error('Plant Maintenance is still a Plant Operations card: ' + rec.plantops.join(', '));
    for (const want of ['plant', 'production', 'shipping', 'debag']) if (!rec.plantops.includes(want)) throw new Error('Plant Operations has no ' + want + ' card: ' + rec.plantops.join(', '));
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
    // A new week (Sunday) has no grades yet: the week before has.
    if (!(await p.$('.sc-go')) && await p.$('#prev')) { rec.weekBefore = true; note('Driver Scorecard: no grades yet this week (it starts today), so the week before was opened'); await p.click('#prev'); await p.waitForSelector('.sc-go', { timeout: 20000 }).catch(() => {}); }
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
    // 6.77 (#556): Add Load's Route / Run fills in by itself once the routes arrive (it stayed empty when opened early).
    rec.routesFilled = await p.waitForFunction(() => [...document.querySelectorAll('#s-route option')].some(o => o.value !== ''), null, { timeout: 20000 }).then(() => true).catch(() => false);
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
    // 6.77 (#556): the load saved with the Route / Run picked.
    rec.picked = pick.t;
    if (String(pick.t).split(' · ')[0].replace(/_\d+$/, '') !== rec.route.replace(/\s.*$/, '')) throw new Error('the added load shows route ' + rec.route + ', but ' + pick.t + ' was picked');
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
    // 6.77 (#556): Add Load's Route / Run fills in by itself once the routes arrive (it stayed empty when opened early).
    rec.routesFilled = await p.waitForFunction(() => [...document.querySelectorAll('#s-route option')].some(o => o.value !== ''), null, { timeout: 20000 }).then(() => true).catch(() => false);
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
    // 6.77 (#556): the load saved with the Route / Run picked.
    rec.picked = pick.t;
    if (String(pick.t).split(' · ')[0].replace(/_\d+$/, '') !== rec.route.replace(/\s.*$/, '')) throw new Error('the added load shows route ' + rec.route + ', but ' + pick.t + ' was picked');
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
          // 6.79 (#577): the menu's groups fold, so a closed group's items are on the page but not shown; read them all.
          await p.waitForFunction(() => /Machine Connections/.test(document.body.textContent), null, { timeout: 15000 }).catch(() => {});
          const a = await p.evaluate(() => document.body.textContent);
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
        // 6.77 (95f458b): no schedule texts switch any more; publishing never sends them, only the Send schedule texts button does.
        if (!/^Off/.test(s[0]) && !/Publishing never sends texts/.test(s[0]) && !/^No week is posted yet/.test(s[0])) bad.push(w + ' Texts: schedule texts line reads: ' + s[0].slice(0, 80));
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
    const own = await needTodayLoad('Case Unloading order');
    rec.ownLoad = own.made;
    try {
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
    } finally { await own.remove(); }
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
      const tvSeq = () => tvp.evaluate(() => [...document.querySelectorAll('#ds-grid .ds-split, #ds-grid .ds-row')].filter(r => r.classList.contains('ds-split') || r.querySelector('.rt'))
        .map(r => r.classList.contains('ds-split') ? (r.classList.contains('prior') ? 'P' : 'T') + ':' + r.textContent.replace(/\s+/g, ' ').trim() : 'R'));
      let sp = splitCompare(exp, await tvSeq());
      if (sp.bad.length) { await tvp.waitForTimeout(5000); exp = await carryExpected(); sp = splitCompare(exp, await tvSeq()); }
      rec.split = sp; sp.bad.forEach(b => bad.push('TV: ' + b));
      // Both lines: with one of today's loads too (the test's own when there is none).
      const tl = await splitTestLoad();
      if (tl.made) {
        rec.splitLoad = tl.made;
        try {
          await tvp.waitForTimeout(4000);
          exp = await carryExpected(); let sp2 = splitCompare(exp, await tvSeq());
          for (let i = 0; i < 6 && sp2.bad.length; i++) { await tvp.waitForTimeout(5000); exp = await carryExpected(); sp2 = splitCompare(exp, await tvSeq()); }
          rec.splitBoth = sp2; sp2.bad.forEach(b => bad.push('TV (with a load today): ' + b));
          await shot(tvp, 'tv-yesterday-today-lines');
        } finally { await tl.remove(); }
      } else await shot(tvp, 'tv-yesterday-today-lines');
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
    const own = await needTodayLoad('Driver Room View Loadout');
    rec.ownLoad = own.made;
    try {
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
      const vlSeq = () => t.evaluate(() => [...document.querySelectorAll('#board-track > div:first-child .drv-split, #board-track > div:first-child .drv-row')]
        .map(r => r.classList.contains('drv-split') ? (r.classList.contains('prior') ? 'P' : 'T') + ':' + r.textContent.replace(/\s+/g, ' ').trim() : 'R'));
      let sp = splitCompare(exp, await vlSeq());
      if (sp.bad.length) { await t.waitForTimeout(5000); exp = await carryExpected(); sp = splitCompare(exp, await vlSeq()); }
      rec.split = sp; sp.bad.forEach(b => bad.push('View Loadout: ' + b));
      const tl = await splitTestLoad();
      if (tl.made) {
        rec.splitLoad = tl.made;
        try {
          await t.waitForTimeout(4000);
          exp = await carryExpected(); let sp2 = splitCompare(exp, await vlSeq());
          for (let i = 0; i < 6 && sp2.bad.length; i++) { await t.waitForTimeout(5000); exp = await carryExpected(); sp2 = splitCompare(exp, await vlSeq()); }
          rec.splitBoth = sp2; sp2.bad.forEach(b => bad.push('View Loadout (with a load today): ' + b));
          await shot(t, 'room-yesterday-today-lines');
        } finally { await tl.remove(); }
      }
      if (!exp.prior.length) note('Yesterday/today lines: no load from yesterday is still unfinished on the practice copy right now, so only "no line" was checked');
      if (c.shownCount !== c.expectedCount) bad.push('View Loadout lists ' + c.shownCount + ' loads, the board rules give ' + c.expectedCount);
      await shot(t, 'room-view-loadout');
      if (t.w.errors.length) bad.push('page errors: ' + t.w.errors.slice(0, 3).join(' | '));
    } finally {
      await t.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* none */ } }).catch(() => {});
      await t.done();
      await adm('stationRemove', { key: st.key }).catch(e => bad.push('the test station was not removed: ' + String(e.message).slice(0, 80)));
    }
    } finally { await own.remove(); }
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
    // No driver off on the days the arrow reaches: the same cell the screen draws for one (daily.html), put into its own table
    // for a moment, so the look (the style rules #553 changed) is still read; nothing is saved.
    if (!rec.count) {
      rec.madeCell = await p.evaluate(() => { const tb = document.querySelector('table.daily tbody'); if (!tb) return null;
        const tr = document.createElement('tr'); tr.innerHTML = '<td class="missing offcover" data-cover="TEST" data-off-who="PRACTICE, TEST" data-off-why="VACATION"></td>'; tb.prepend(tr);
        const td = tr.firstChild, c = getComputedStyle(td), b = getComputedStyle(td, '::before'), a = getComputedStyle(td, '::after');
        const out = { bg: c.backgroundColor, color: c.color, weight: c.fontWeight, before: b.content, beforeSize: b.fontSize, beforeWeight: b.fontWeight, beforeColor: b.color, after: a.content.slice(0, 60), afterSize: a.fontSize, who: td.dataset.offWho };
        tr.remove(); return out; });
      if (rec.madeCell) rec.cells.push(rec.madeCell);
      note('Daily Dispatch red cells: no driver off on the practice copy on the days shown; the screen\'s own cell was looked at in place');
    }
    for (const x of rec.madeCell ? [rec.madeCell] : []) {
      const why = [];
      if (x.bg !== 'rgb(200, 30, 30)') why.push('background ' + x.bg);
      if (x.color !== 'rgb(255, 255, 255)' || x.beforeColor !== 'rgb(255, 255, 255)') why.push('words ' + x.color + '/' + x.beforeColor);
      if (x.before !== '"NEEDS DRIVER"') why.push('says ' + x.before);
      if (!/PRACTICE, TEST/.test(x.after)) why.push('who/why line ' + x.after);
      if (parseFloat(x.beforeSize) < 16 || parseFloat(x.afterSize) < 16) why.push('text ' + x.beforeSize + '/' + x.afterSize);
      if (Number(x.beforeWeight) < 700) why.push('NEEDS DRIVER not bold (' + x.beforeWeight + ')');
      if (why.length) bad.push('driver-off cell: ' + why.join(', '));
    }
    await shot(p, 'daily-red-cells');
    rec.bad = bad;
    if (bad.length) throw new Error(bad.slice(0, 4).join('; '));
  });
  // 6.77 (#559, look only): every screen reads through the one list index, so Daily Dispatch (today's loadout day), Case
  // Loadout and the Driver Room board (the board's own rules over the loads) list the same loads.
  await write('Same loads on Daily Dispatch, Case Loadout and the Driver Room (look only)', async (p, rec) => {
    const bad = [], norm = (k) => String(k || '').toUpperCase().replace(/\s+/g, ' ').trim();
    const wd = await workDay();
    rec.day = wd || operatingDay();
    await open(p, 'daily.html' + await wdQ());
    await p.waitForSelector('table.daily tbody tr[data-id]', { timeout: 30000 });
    await p.waitForTimeout(2000);
    rec.daily = await p.evaluate(() => [...document.querySelectorAll('table.daily tbody tr[data-id]')].filter(t => !t.classList.contains('off') && !t.classList.contains('already') && !t.classList.contains('plant-only'))
      .map(t => (t.children[0].textContent.trim().replace(/\s.*$/, '')) + '|' + t.children[1].textContent.trim()));
    await open(p, 'loadout.html' + await wdQ());
    await p.waitForSelector('#rows tr[data-row]', { timeout: 30000 });
    await p.waitForTimeout(2000);
    rec.loadout = await p.evaluate(() => { const out = []; let prior = false;
      for (const t of document.querySelectorAll('#rows tr')) { if (t.classList.contains('divider')) { prior = t.classList.contains('prior'); continue; } if (!t.dataset.row || prior) continue;
        out.push(t.children[0].textContent.trim().replace(/\s.*$/, '') + '|' + (t.children[1] ? t.children[1].textContent.trim() : '')); }
      return out; });
    rec.loadoutLines = await p.evaluate(() => [...document.querySelectorAll('#rows tr.divider')].map(t => (t.classList.contains('prior') ? 'P:' : 'T:') + t.textContent.replace(/\s+/g, ' ').trim().slice(0, 80)));
    const exp = await carryExpected(wd || undefined);
    rec.board = exp.rows.filter(x => !x.prior).map(x => x.key);
    rec.counts = { daily: rec.daily.length, caseLoadout: rec.loadout.length, board: rec.board.length };
    const routeOf = (k) => norm(k).split('|')[0];
    const dR = new Set(rec.daily.map(routeOf)), lR = new Set(rec.loadout.map(routeOf));
    rec.dailyNotOnLoadout = [...dR].filter(r => !lR.has(r));
    rec.loadoutNotOnDaily = [...lR].filter(r => !dR.has(r));
    if (!rec.daily.length) bad.push('Daily Dispatch shows no loads for today\'s loadout day');
    if (!rec.loadout.length) bad.push('Case Loadout shows no loads today');
    if (rec.dailyNotOnLoadout.length) bad.push('on Daily Dispatch but not Case Loadout: ' + rec.dailyNotOnLoadout.slice(0, 8).join(', '));
    if (rec.loadoutNotOnDaily.length) note('on Case Loadout but not Daily Dispatch today (Scheduler loads and specials live only on Case Loadout): ' + rec.loadoutNotOnDaily.slice(0, 12).join(', '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.77 (#557): Driver Check-ins' New phone code goes through the one server path: the new code opens the drivers' phone
  // screen. The code is never written down; the practice copy's phones need the new code after this (a manager presses New
  // phone code again to see one).
  await write('New phone code opens the drivers\' phone screen', async (p, rec) => {
    await open(p, 'checkins.html');
    await p.waitForSelector('#new-code:not([hidden])', { timeout: 30000 });
    await p.click('#new-code');
    await timed(p, rec, 'New phone code', () => p.click('#new-code'), { fn: () => !!document.getElementById('phone-code') }, 20000);
    const code = await p.$eval('#phone-code', b => b.textContent.trim());
    if (!code) throw new Error('no new phone code shown');
    // Take the code off the screen before any picture is taken.
    await p.evaluate(() => { const b = document.getElementById('phone-code'); if (b) b.textContent = '(shown)'; });
    const own = await needTodayLoad('New phone code');
    rec.ownLoad = own.made;
    const ph = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, phoneCodeLook: true });
    try {
      await open(ph, 'route.html');
      await ph.waitForSelector('#step-code:not([hidden]) #code', { timeout: 30000 });
      await ph.fill('#code', code);
      await timed(ph, rec, 'Continue with the code', () => ph.click('#step-code button[type="submit"]'), { fn: () => !document.getElementById('step-menu').hidden }, 20000);
      // 6.79 (#584): the drivers' screen has the Route Book card (from the Customer List app) beside View Loadout and DVIR.
      rec.routeBook = await ph.evaluate(() => { const b = document.getElementById('to-book'); return b ? b.textContent.replace(/\s+/g, ' ').trim() : ''; });
      if (!/^Route Book/.test(rec.routeBook)) throw new Error('the drivers\' screen (route.html) has no Route Book card');
      await ph.click('#m-board');
      rec.board = await ph.waitForSelector('#board-track .drv-row', { timeout: 30000 }).then(() => true).catch(() => false);
      if (!rec.board) throw new Error('the phone opened with the new code but View Loadout showed no loads');
      await shot(ph, 'phone-new-code');
      if (ph.w.errors.length) throw new Error('page errors: ' + ph.w.errors.slice(0, 3).join(' | '));
    } finally {
      await ph.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* none */ } }).catch(() => {});
      await ph.done();
      await own.remove();
    }
  });
  // 6.77 (#557): Pause writing to the sheets (Administration > Go-Live Switches) also holds the fleet list sync into Equipment
  // Master: with it on, Sync fleet list writes nothing and says why. Turned on for the check, then back as it was.
  await write('Pause writing to the sheets holds the fleet list sync', async (p, rec) => {
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const cfg = async () => (await db.collection('config').doc('app').get()).data() || {};
    const before = await cfg();
    rec.pausedBefore = !!(before.sheetWrites && before.sheetWrites.paused === true);
    rec.writeBack = !!(before.writeBack && before.writeBack.enabled === true);
    await open(p, 'administration.html');
    const call = (fn, f) => p.evaluate(([n, x]) => import('./js/app.js').then(m => m.callServer(n, x)).then(v => ({ ok: true, v }), e => ({ ok: false, message: String(e.message || e) })), [fn, f]);
    const rid = () => 'practice-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8);
    const stampOf = (c) => JSON.stringify(c.fleetSync || c.fleetSyncLast || null);
    const lastBefore = stampOf(before);
    let err = '';
    try {
      if (!rec.pausedBefore) { const s1 = await call('setSwitch', { requestId: rid(), sheetsPaused: true }); rec.pauseOn = s1; if (!s1.ok) throw new Error('could not turn Pause on: ' + s1.message); }
      rec.pausedNow = !!(((await cfg()).sheetWrites || {}).paused);
      if (!rec.pausedNow) throw new Error('Pause did not turn on');
      const sync = await call('fleetSyncNow', {});
      rec.sync = sync.ok ? { ok: true } : sync;
      if (sync.ok) throw new Error('Sync fleet list ran while writing to the sheets was paused');
      if (!/paused/i.test(sync.message)) throw new Error('Sync fleet list was refused, but not for the pause: ' + sync.message);
      if (stampOf(await cfg()) !== lastBefore) throw new Error('the fleet sync record changed while paused');
      await open(p, 'equipment.html');
      await p.waitForTimeout(3000);
      rec.equipmentNote = await p.evaluate(() => document.body.innerText.split('\n').filter(l => /paused|fleet list/i.test(l)).slice(0, 3).join(' | '));
      await shot(p, 'equipment-paused');
    } catch (e) { err = e.message; }
    // Back as it was.
    if (!rec.pausedBefore) { await open(p, 'administration.html'); const s2 = await call('setSwitch', { requestId: rid(), sheetsPaused: false }); rec.pauseOff = s2; }
    rec.pausedAfter = !!(((await cfg()).sheetWrites || {}).paused);
    if (rec.pausedAfter !== rec.pausedBefore) err = (err ? err + '; ' : '') + 'Pause was not put back (' + rec.pausedAfter + ')';
    if (err) throw new Error(err);
  });
  // 6.77 (#557, #559): Texts. The practice copy never texts anyone (the server's LIVE_TEXTS is not set there), so: Driver replies
  // to your cell takes a phone and shows On and the text that phone would get, then is put back; Send schedule texts (two taps)
  // writes each posted-week driver to the list as "Test copy, not sent", then the list rows and the last-sent line are put back.
  await write('Texts: replies to your cell and Send schedule texts', async (p, rec) => {
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const sms = db.collection('private').doc('sms');
    const keep = (await sms.get()).data() || {};
    const was = { forwardTo: keep.forwardTo || '', forwardSince: keep.forwardSince || '', forwardBy: keep.forwardBy || '', lastSend: keep.lastSend || null, sendingAt: keep.sendingAt || '' };
    rec.hasAccount = !!(keep.accountSid && keep.authToken && keep.fromNumber);
    const started = new Date().toISOString(), bad = [];
    await open(p, 'texts.html');
    await p.waitForSelector('#fwd-phone', { timeout: 30000 });
    await p.waitForFunction(() => document.getElementById('mode') && document.getElementById('state').textContent !== '-', null, { timeout: 30000 }).catch(() => {});
    rec.status = await p.evaluate(() => import('./js/app.js').then(m => m.callServer('sms', { op: 'status' })).then(s => ({ live: s.live, on: s.on, doneOn: s.doneOn, hasSid: s.hasSid })));
    if (rec.status.live !== false) throw new Error('the practice copy says it texts for real (live ' + rec.status.live + '): nothing pressed');
    try {
      // 5. Driver replies to your cell: a made-up number, then back as it was.
      await p.fill('#fwd-phone', '330-555-0142');
      await p.press('#fwd-phone', 'Enter');
      await p.waitForFunction(() => /On:/.test(document.getElementById('fwd-text').textContent), null, { timeout: 15000 }).catch(() => {});
      rec.forward = await p.evaluate(() => ({ pill: document.getElementById('fwd-state').textContent, text: document.getElementById('fwd-text').textContent, sample: document.getElementById('fwd-sample').textContent }));
      if (!/330-555-0142/.test(rec.forward.text)) bad.push('the reply phone did not save (' + rec.forward.text + ')');
      if (!/United Dairy: reply from/.test(rec.forward.sample)) bad.push('no sample of the forwarded reply (' + rec.forward.sample + ')');
      rec.forwardLiveNote = 'replies are only read from Twilio and sent on by the live app; the practice copy cannot show one arriving';
      // 3. Send schedule texts: two taps.
      rec.sendBefore = await p.evaluate(() => ({ text: document.getElementById('send').textContent, disabled: document.getElementById('send').disabled, state: document.getElementById('state').textContent, last: document.getElementById('last').textContent, who: document.getElementById('preview-count').textContent }));
      // The practice copy has no Twilio account saved (the test never types one): then the button is greyed with the line saying
      // so, and the server refuses the send and writes nothing. With an account it is pressed for real (two taps).
      rec.stateText = await p.$eval('#state-text', b => b.textContent);
      if (!rec.hasAccount) {
        if (!rec.sendBefore.disabled) bad.push('with no Twilio account saved, Send schedule texts is not greyed out');
        if (!/Save the Twilio account first/.test(rec.stateText)) bad.push('with no Twilio account saved, the line does not say to save it first: ' + rec.stateText);
        rec.serverSend = await p.evaluate(() => import('./js/app.js').then(m => m.callServer('sms', { op: 'sendSchedule' })).then(() => 'sent', e => String(e.message || e)));
        if (!/Save the Twilio account first/.test(rec.serverSend)) bad.push('with no Twilio account the server send answered: ' + rec.serverSend.slice(0, 120));
        const rows = (await db.collection('textLog').where('at', '>=', started).get()).docs.filter(d => d.data().direction === 'out' && d.data().week);
        rec.logRows = rows.length;
        if (rows.length) bad.push('the refused send still wrote ' + rows.length + ' list rows');
        note('Texts: the practice copy has no Twilio account saved, so Send schedule texts is greyed out there and the send is refused with "Save the Twilio account first" (checked); the two-tap send itself can only be pressed where an account is saved');
        await shot(p, 'texts-no-account');
      } else if (rec.sendBefore.disabled) bad.push('Send schedule texts is greyed out (' + JSON.stringify(rec.sendBefore) + ')');
      else {
        await p.click('#send');
        rec.armed = await p.$eval('#send', b => b.textContent);
        if (!/Tap again/.test(rec.armed)) bad.push('the first tap did not ask for a second (' + rec.armed + ')');
        await timed(p, rec, 'Send schedule texts', () => p.click('#send'), { fn: () => /Last sent/.test(document.getElementById('last').textContent) && /written to the list|sent/.test(document.getElementById('last').textContent) }, 30000);
        rec.sendAfter = await p.evaluate(() => ({ text: document.getElementById('send').textContent, state: document.getElementById('state').textContent, last: document.getElementById('last').textContent }));
        if (!/test copy/i.test(rec.sendAfter.last)) bad.push('the last-sent line does not say test copy: ' + rec.sendAfter.last);
        const rows = (await db.collection('textLog').where('at', '>=', started).get()).docs.filter(d => d.data().direction === 'out' && d.data().week);
        rec.logRows = rows.length;
        rec.logStatuses = [...new Set(rows.map(d => d.data().status))];
        if (rows.some(d => d.data().status === 'SENT')) bad.push('a schedule text shows as SENT on the practice copy');
        await shot(p, 'texts-sent');
      }
    } catch (e) { bad.push(e.message); }
    // Back as it was: the reply phone, the last-sent line, and the list rows the test made.
    const put = { forwardTo: was.forwardTo, forwardSince: was.forwardSince, forwardBy: was.forwardBy, lastSend: was.lastSend, sendingAt: was.sendingAt };
    await sms.set(put, { merge: true });
    const mine = (await db.collection('textLog').where('at', '>=', started).get()).docs.filter(d => d.data().direction === 'out' && d.data().week && d.data().by === EMAIL);
    for (const d of mine) await d.ref.delete();
    rec.putBack = { logRowsDeleted: mine.length, forwardTo: was.forwardTo ? 'kept as before' : 'blank as before' };
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.78 (#561, look only): the phone and tablet apps, and any screen on a phone, show only "Last refreshed <date time>" in
  // the header, never the version; desk screens at 1536 still show the version.
  await write('Phone apps show Last refreshed, desk screens the version (look only)', async (p, rec) => {
    const bad = [];
    const head = (pg) => pg.evaluate(() => { const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
      const box = document.querySelector('.hdr-version'); if (!box) return { box: false };
      const v = box.querySelector('.hv-ver'), f = box.querySelector('.hv-fresh');
      return { box: true, ver: vis(v), verText: v ? v.textContent.trim() : '', fresh: vis(f), freshText: f ? f.textContent.trim() : '', phoneApp: document.body.classList.contains('ud-phone-app') }; });
    const ph = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, freshLook: true });
    try {
      for (const url of ['route.html', 'daily.html', 'walkthrough.html?view=home&app=1']) {
        await open(ph, url);
        await ph.waitForTimeout(2500);
        const h = rec['390 ' + url] = await head(ph);
        if (!h.box) { if (url === 'route.html') note('Last refreshed: route.html at 390 has no header line before its code is typed'); continue; }
        if (h.ver) bad.push('390 ' + url + ': the version shows (' + h.verText + ')');
        if (!h.fresh || !/^Last refreshed \d{1,2}-\d{1,2}-\d{2} \d{1,2}:\d{2} [AP]M$/.test(h.freshText)) bad.push('390 ' + url + ': no "Last refreshed" line (' + h.freshText + ')');
      }
      await shot(ph, 'last-refreshed-390');
    } finally { await ph.done(); }
    for (const url of ['daily.html', 'loadout.html']) {
      await open(p, url);
      await p.waitForTimeout(2000);
      const h = rec['1536 ' + url] = await head(p);
      if (!h.box || !h.ver || !/^Version \d/.test(h.verText)) bad.push('1536 ' + url + ': the version does not show (' + JSON.stringify(h) + ')');
      if (h.fresh) bad.push('1536 ' + url + ': the desk screen shows "Last refreshed" too');
    }
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.78 (#566): a Load Day route loaded early (two days before its delivery) leaves the day before its delivery, so the
  // Late Forecast does not call it late on its load day. The test adds one such load of its own for today (practice copy,
  // marked splitTest, taken off after); the deployed rules are also asked about the 10-31 Saturday-for-Monday case. (#570) A
  // load already past its dispatch puts the plant behind only by the time until it is loaded.
  await write('Load Day loads not late too early; hours behind (6.78)', async (p, rec) => {
    const bad = [];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const L = require(path.join(__dirname, '..', '..', 'src', 'logic.js'));
    for (const d of (await db.collection('runs').where('addedBy', '==', EMAIL).get()).docs.filter(x => x.data().splitTest === true)) await d.ref.delete();
    const today = operatingDay(), delivery = L.addDays(today, 2), week = L.weekStart(delivery), dp = L.dayPrefix(delivery);
    const runs = (await db.collection('runs').where('weekStart', 'in', [L.weekStart(L.addDays(today, -7)), L.weekStart(today)]).get()).docs.map(d => Object.assign({}, d.data(), { id: d.id }));
    const base = runs.find(x => !x.extraRun && !x.splitTest && /^852/.test(String(x.route))) || runs.find(x => !x.extraRun && !x.splitTest);
    if (!base) throw new Error('no run on the practice copy to copy for the test load');
    const id = week + '__practice_loadday_' + Date.now().toString(36);
    const days = {}; L.DAYS.forEach(x => { days[x] = { runs: false }; });
    days[dp] = { runs: true, loadType: 'CASE', loadDayOffset: -2, deliveryDate: delivery, loadDate: today, departureDate: delivery, dispatchTime: 780, driver: '', trailer: '', truck: '', casesOut: null, loadStatus: '', completeTime: null, loadedComplete: false, loadSequence: 999 };
    const run = Object.assign({}, base, { weekStart: week, runId: String(base.runId || 'x') + '__practiceloadday', run: 'PRACTICE LOAD DAY', days, cells: {}, sheetRow: null, extraOf: null,
      masterShow: Object.assign({}, base.masterShow || {}, { leavesOn: 'Load Day', daily: true }), splitTest: true, addedBy: EMAIL, addedAt: new Date().toISOString(), testEdited: true });
    delete run.id;
    rec.testLoad = id + ' (copy of ' + base.id + ': loaded ' + today + ', delivered ' + delivery + ', Load Day 1:00 PM)';
    await db.collection('runs').doc(id).set(run);
    try {
      await open(p, 'forecast.html');
      const row = () => p.evaluate(() => { const r = [...document.querySelectorAll('#loads .fc-row')].find(x => /PRACTICE/i.test(x.textContent)); return r ? { late: r.classList.contains('late'), depart: r.children[3].textContent.trim(), est: r.children[4].textContent.trim(), why: (r.querySelector('.fc-why') || {}).textContent || '', text: r.innerText.replace(/\s+/g, ' ').slice(0, 160) } : null; });
      let fr = null;
      for (let i = 0; i < 20 && !fr; i++) { fr = await row(); if (!fr) await p.waitForTimeout(1000); }
      rec.forecastRow = fr;
      if (!fr) bad.push('the test Load Day load does not show on the Late Forecast');
      else {
        // It leaves the day before its delivery at 1:00 PM, never on its early load day (today). Late is then only the plant's
        // own backlog (its Est. Done after that time), which the practice copy's left-over loads can make true.
        const L2 = require(path.join(__dirname, '..', '..', 'src', 'logic.js')), leaveDay = L2.addDays(delivery, -1);
        const dn = L2.DAY_NAMES[L2.DAYS.indexOf(L2.dayPrefix(leaveDay))], wallDay = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }), want = (leaveDay === wallDay ? '' : dn.charAt(0) + dn.slice(1, 3).toLowerCase() + ' ') + '1:00 PM';
        rec.wantDepart = want;
        if (fr.depart !== want) bad.push('the Load Day load leaves ' + fr.depart + ' on the Late Forecast, not ' + want + ' (the day before its delivery)');
        if (fr.late) note('Load Day test load: leaves ' + fr.depart + ' as it should; the forecast still has it late (est. ' + fr.est + ') because of the practice copy\'s ' + 'left-over loads ahead of it');
      }
      await shot(p, 'forecast-load-day');
    } finally { await db.collection('runs').doc(id).delete(); }
    // The deployed rules (forecast.html's own UDPlant), with Joe's 10-31 numbers.
    rec.rules = await p.evaluate(() => {
      const U = window.UDPlant, day = (k) => Math.round(Date.UTC(...k.split('-').map((v, i) => i === 1 ? v - 1 : +v)) / 86400000) * 1440;
      const mon = (route, time) => ({ route, run: 'X', area: 'CASE', state: 'WAITING', loadDate: '2026-10-31', deliveryDate: '2026-11-02', departureDate: '2026-11-02', dispatchTime: time, leavesOn: 'Load Day', prior: false });
      const jersey = U.departWall(mon('852', 780)) === day('2026-11-01') + 780;
      const now = Date.UTC(2026, 10, 1, 0, 10);
      const loads = [{ id: 'p', area: 'CASE', route: '845', run: 'I/W BALTIMORE', quantity: '', state: 'NOT_STARTED', loadDate: '2026-10-30', deliveryDate: '2026-10-31', dispatchTime: '4:00 AM', leavesOn: 'Load Day', prior: true },
        { id: 'j', area: 'CASE', route: '852', run: 'JERSEY L2', quantity: '', state: 'NOT_STARTED', loadDate: '2026-10-31', deliveryDate: '2026-11-02', dispatchTime: '1:00 PM', leavesOn: 'Load Day' }];
      const f = U.loadForecast({ date: '2026-10-31', loads }, now), b = U.forecastBehind(f), pl = f.loads.find(x => x.id === 'p');
      return { jerseyLeavesSunday: jersey, late: f.loads.filter(x => x.late).map(x => x.route), behind: b, ownLoading: pl ? Math.ceil(pl.minutes / 5) * 5 : null, text: U.forecastSummary(f).behindText };
    });
    if (!rec.rules.jerseyLeavesSunday) bad.push('Monday\'s Jersey loaded Saturday does not leave Sunday 1:00 PM');
    if (rec.rules.late.join() !== '845') bad.push('late on 10-31 8:10 PM: ' + rec.rules.late.join(', ') + ' (only 845 should be)');
    if (!(rec.rules.behind <= rec.rules.ownLoading && rec.rules.behind < 120)) bad.push('hours behind reads ' + rec.rules.text + ' (more than 845\'s own loading time)');
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.78 (#558): Administration > Employees lists the plant's people (from UDMS); + Add Driver and the Plant Schedule's + Add
  // Person pick from it. Nothing is added: each picker is opened, one employee picked to see the boxes fill, then cancelled.
  // Names are never written down, and are blanked on the screen before its picture.
  await write('Employees list, Add Driver and Add Person pick from it (look only)', async (p, rec) => {
    const bad = [];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const emps = (await db.collection('employees').get()).docs.map(d => d.data());
    const mine = emps.filter(e => e.active && (e.facilityId || 'fac_uniontown') === 'fac_uniontown');
    rec.employees = { all: emps.length, activeHere: mine.length };
    const blank = (pg) => pg.evaluate(() => document.querySelectorAll('#rows td, .emp-picks button, .crew-picker button[data-emp], #d-name, #d-emp, #d-phone, #d-hire').forEach(el => { if ('value' in el && el.tagName === 'INPUT') el.value = '•••'; else el.textContent = '•••'; }));
    await open(p, 'administration.html?item=employees');
    await p.waitForTimeout(2000);
    rec.adminItem = await p.evaluate(() => location.pathname.split('/').pop() + location.search + ' | ' + ((document.querySelector('h1') || {}).textContent || ''));
    await open(p, 'employees.html');
    await p.waitForFunction(() => !/Reading/.test((document.getElementById('rows') || {}).textContent || 'Reading'), null, { timeout: 30000 }).catch(() => {});
    rec.list = await p.evaluate(() => ({ rows: [...document.querySelectorAll('#rows tr')].filter(t => !t.querySelector('.empty')).length, sync: (document.getElementById('sync') || {}).textContent || '', plant: (document.getElementById('plant-name') || {}).textContent || '', sideways: document.scrollingElement.scrollWidth > innerWidth + 1 }));
    if (!rec.list.rows) bad.push('Administration > Employees lists no one');
    if (mine.length && rec.list.rows !== mine.length) bad.push('Employees lists ' + rec.list.rows + ' active, the list has ' + mine.length + ' active at Uniontown');
    if (rec.list.sideways) bad.push('Employees scrolls sideways at 1536');
    await blank(p);
    await shot(p, 'employees-list');
    // + Add Driver: the employee picker.
    await open(p, 'drivers.html');
    await p.waitForSelector('#add', { timeout: 30000 });
    await p.click('#add');
    const pick = await p.waitForSelector('#d-pick', { timeout: 10000 }).then(() => true).catch(() => false);
    rec.addDriver = { picker: pick };
    if (!pick) bad.push('+ Add Driver has no employee picker');
    else {
      await p.click('#d-pick');
      await p.waitForTimeout(500);
      rec.addDriver.choices = await p.$$eval('#d-picks [data-emp]', x => x.length);
      if (!rec.addDriver.choices) note('Add Driver: every Uniontown employee is already a driver, so the picker lists none (checked it opens)');
      else {
        await p.click('#d-picks [data-emp]');
        rec.addDriver.filled = await p.evaluate(() => ({ name: !!document.getElementById('d-name').value, id: !!document.getElementById('d-emp').value, gray: document.getElementById('d-name').readOnly }));
        if (!rec.addDriver.filled.name || !rec.addDriver.filled.id) bad.push('picking an employee on Add Driver did not fill the name and employee ID');
      }
      await blank(p);
      await shot(p, 'employees-add-driver');
      await p.click('#d-cancel');
    }
    // Plant Schedule + Add Person: the employee picker (Close, nothing saved).
    await open(p, 'crew.html?view=setup&tab=people');
    await p.waitForSelector('#add-row', { timeout: 30000 });
    const calls0 = p.w.calls.length;
    await p.click('#add-row');
    const cp = await p.waitForSelector('#emp-q', { timeout: 10000 }).then(() => true).catch(() => false);
    rec.addPerson = { picker: cp, choices: cp ? await p.$$eval('.crew-picker [data-emp]', x => x.length) : 0 };
    if (!cp) bad.push('Plant Schedule + Add Person has no employee picker');
    else if (!rec.addPerson.choices) note('Add Person: every Uniontown employee is already on the plant schedule, so the picker lists none');
    await blank(p);
    await shot(p, 'employees-add-person');
    if (cp) await p.click('#emp-close').catch(() => {});
    if (p.w.calls.slice(calls0).some(c => c.op === 'saveCrewSetup')) bad.push('opening + Add Person saved something');
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.78 (#565): the Send Schedule Texts strip on Weekly Dispatch (live) and Daily Dispatch; never on the template. On the
  // practice copy (no Twilio account) its button is greyed and the words say to save the account first (the server's refusal
  // is checked on the Texts step).
  await write('Send Schedule Texts strip on Weekly and Daily Dispatch (look only)', async (p, rec) => {
    const bad = [];
    const strip = () => p.evaluate(() => { const s = document.getElementById('send-texts'); if (!s) return { el: false };
      const b = s.querySelector('button'); return { el: true, shown: !s.hidden && s.getBoundingClientRect().height > 0, words: ((s.querySelector('.send-words') || {}).innerText || '').replace(/\s+/g, ' ').trim(), button: b ? b.textContent : '', disabled: b ? b.disabled : null, title: s.title || '' }; });
    for (const [url, want] of [['weekly.html?view=live', true], ['daily.html', true], ['weekly.html', false]]) {
      await open(p, url);
      let s = await strip();
      for (let i = 0; i < 10 && want && !s.shown; i++) { await p.waitForTimeout(1000); s = await strip(); }
      rec[url] = s;
      if (want && !s.shown) bad.push(url + ': no Send Schedule Texts strip');
      if (!want && s.shown) bad.push(url + ': the template shows the Send Schedule Texts strip');
      if (want && s.shown) {
        // 6.91 (#672): Daily Dispatch has the short line (Texts sent / not sent, Send Texts / Send Again), the dates on its hover.
        const short = url === 'daily.html';
        if (short ? !/^Texts (sent|not sent)/.test(s.words) : !/Schedule texts for the posted week/.test(s.words)) bad.push(url + ': the strip reads ' + s.words.slice(0, 80));
        if (short ? !/^Send (Texts|Again)$/.test(s.button.trim()) : !/^Send (Schedule Texts|Again): Week of /.test(s.button)) bad.push(url + ': the button reads ' + s.button);
        if (short && !/^Schedule texts for the posted week/.test(s.title || '')) bad.push(url + ': the short strip\'s hover reads ' + (s.title || 'nothing'));
        const noKeys = /Save the Twilio|Set up Administration > Texts first|Not set up yet/.test(s.words);
        // 6.91 (#687): on Daily Dispatch with no texting account the short line reads exactly "Texts not sent. Not set up yet".
        if (short && s.disabled && /^Texts not sent/.test(s.words) && s.words !== 'Texts not sent. Not set up yet') bad.push(url + ': the short line reads "' + s.words + '" (should be "Texts not sent. Not set up yet")');
        if (short && noKeys && !/Set up Administration > Texts first/.test(s.title || '')) bad.push(url + ': the short line\'s hover does not say to set up Administration > Texts (' + (s.title || 'nothing') + ')');
        if (!s.disabled && !noKeys) note(url + ': the strip\'s button is not greyed (a Twilio account is saved); not pressed');
        if (noKeys && !s.disabled) bad.push(url + ': with no Twilio account the button is not greyed');
        // 6.91 (#696): after this week's send, a green N OF N SENT or red N OF N SENT · N MISSING and Text the Missing (never pressed).
        const cnt = await p.evaluate(() => { const c = document.querySelector('#send-texts .send-count'); return c ? { text: c.textContent.trim(), good: c.classList.contains('good') } : null; });
        rec[url].count = cnt;
        if (cnt && !/^\d+ OF \d+ SENT( · \d+ MISSING)?$/.test(cnt.text)) bad.push(url + ': the sent check reads ' + cnt.text);
        if (!cnt && /sent/i.test(s.words) && !/not sent/i.test(s.words)) bad.push(url + ': the week is sent but there is no sent check');
        if (!cnt) note(url + ': this week is not sent on the practice copy, so the N OF N SENT check and Text the Missing do not show');
        await shot(p, 'send-texts-' + url.replace(/\W+/g, '-'));
      }
    }
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.78 (#564): Administration > Sales Route Email keeps who gets the 6:00 AM email: a made-up address saves, then the list is
  // put back as it was. On / Off and Send a test are not pressed.
  await write('Sales Route Email recipients save', async (p, rec) => {
    const bad = [], fake = 'practice.sales.test@example.com';
    await open(p, 'administration.html?item=sales-email');
    await p.waitForSelector('#se-to', { timeout: 30000 });
    await p.waitForFunction(() => /The sales email is (ON|OFF)/.test(document.body.innerText), null, { timeout: 20000 }).catch(() => {});
    const was = await p.inputValue('#se-to');
    rec.wasCount = was ? was.split(',').filter(x => x.trim()).length : 0;
    rec.switch = await p.evaluate(() => (document.querySelector('#se-switch .ap-chip') || {}).textContent || '');
    const set = async (v) => { await p.fill('#se-to', v); await p.press('#se-to', 'Tab'); await p.waitForTimeout(2500); };
    try {
      await set(was ? was + ', ' + fake : fake);
      await open(p, 'administration.html?item=sales-email');
      await p.waitForSelector('#se-to', { timeout: 30000 });
      await p.waitForFunction((f) => document.getElementById('se-to').value.indexOf(f) >= 0, fake, { timeout: 15000 }).catch(() => {});
      rec.saved = (await p.inputValue('#se-to')).indexOf(fake) >= 0;
      if (!rec.saved) bad.push('the made-up address did not save');
      rec.changed = await p.evaluate(() => (document.getElementById('se-changed') || {}).textContent || '');
      await shot(p, 'sales-email-saved');
    } finally {
      await set(was);
      await open(p, 'administration.html?item=sales-email');
      await p.waitForSelector('#se-to', { timeout: 30000 });
      await p.waitForTimeout(2000);
      const now = await p.inputValue('#se-to');
      rec.putBack = now === was;
      if (!rec.putBack) bad.push('the recipients were not put back (' + (now.indexOf(fake) >= 0 ? 'the made-up address is still there' : 'the list changed') + ')');
    }
    rec.switchAfter = await p.evaluate(() => (document.querySelector('#se-switch .ap-chip') || {}).textContent || '');
    if (rec.switchAfter !== rec.switch) bad.push('the On/Off switch changed: ' + rec.switch + ' -> ' + rec.switchAfter);
    const refused = p.w.calls.filter(c => c.status !== 200 || c.error);
    if (refused.length) bad.push('a save answered ' + refused[0].status + ' ' + String(refused[0].error).slice(0, 120));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.78 (#569): the Home screen's five cards open their own screens (Plant Operations, Plant Maintenance, Shipping &
  // Receiving with its dock icon, Debag / Labeling Room, Route Distribution, Reports & Safety).
  await write('Home screen cards open the right screens (look only)', async (p, rec) => {
    const bad = [];
    // An administrator lands on the Operations Overview first: Uniontown opens its own Home.
    const home = async () => { await open(p, 'index.html'); const plant = '.co-plant[data-plant="fac_uniontown"] header strong';
      await p.waitForSelector('#sides .launch-card, ' + plant, { timeout: 30000 }); if (!(await p.$('#sides .launch-card'))) { await p.click(plant); await p.waitForSelector('#sides .launch-card', { timeout: 20000 }); } };
    await home();
    rec.cards = await p.$$eval('#sides .launch-card', cs => cs.map(c => ({ name: (c.querySelector('strong') || {}).textContent || '', href: (c.querySelector('a.open-text') || {}).getAttribute ? c.querySelector('a.open-text').getAttribute('href') : '', key: c.dataset.cardSide || c.dataset.group || '', icon: !!c.querySelector('.launch-art svg.launch-icon'), img: !!c.querySelector('.launch-art img') })));
    rec.fit = await p.evaluate(() => { const g = document.getElementById('sides'); return { cols: getComputedStyle(g).gridTemplateColumns.split(' ').length, sideways: document.scrollingElement.scrollWidth > innerWidth + 1,
      out: [...g.querySelectorAll('.launch-card a.open-text, .launch-card strong')].filter(a => { const c = a.closest('.launch-card').getBoundingClientRect(), r = a.getBoundingClientRect(); return r.right > c.right + 1 || r.left < c.left - 1; }).map(a => a.textContent.trim()) }; });
    const want = ['Plant Operations', 'Plant Maintenance', 'Shipping & Receiving', 'Route Distribution', 'Reports & Safety'];
    want.forEach(w => { if (!rec.cards.some(c => c.name === w)) bad.push('no ' + w + ' card'); });
    const ship = rec.cards.find(c => c.name === 'Shipping & Receiving');
    if (ship && !ship.icon) bad.push('Shipping & Receiving has no icon of its own');
    if (rec.fit.sideways) bad.push('Home scrolls sideways at 1536');
    if (rec.fit.out.length) bad.push('words run out of their card: ' + rec.fit.out.join(', '));
    await shot(p, 'home-cards');
    rec.opened = [];
    for (let i = 0; i < rec.cards.length; i++) {
      const c = rec.cards[i];
      await home();
      await Promise.all([p.waitForNavigation({ timeout: 20000 }).catch(() => {}), p.locator('#sides .launch-card').nth(i).locator('a.open-text').click()]);
      await p.waitForTimeout(1500);
      const landed = new URL(p.url()).pathname.split('/').pop();
      const page = String(c.href).split('?')[0];
      rec.opened.push(c.name + ' -> ' + landed);
      if (landed !== page) bad.push(c.name + ' opened ' + landed + ', not ' + page);
    }
    // The Shipping & Receiving card's own lines: Shipping, Receiving, Inventory, Plant Material Trailers.
    await home();
    rec.shipLines = await p.$$eval('#sides [data-card-side="shipping"] .hq-list a', a => a.map(x => x.textContent.trim() + '=' + x.getAttribute('href')));
    if (!rec.shipLines.some(x => /^Plant Material Trailers=jug-trailers\.html/.test(x))) bad.push('Shipping & Receiving has no Plant Material Trailers line');
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.78 (#567): the Sales app on a phone: the routes of the division, a tap puts that route on the map (read only).
  await write('Sales app opens and a route goes on the map', async (p, rec) => {
    const bad = [], ph = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, salesLook: true });
    try {
      await ph.goto(SITE + '/sales.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      // 6.79 (#576): the app opens on two cards; Where the routes are opens the routes.
      await ph.waitForSelector('.sa-card, #error:not([hidden]), #signin:not([hidden])', { timeout: 40000 });
      rec.cards = await ph.$$eval('.sa-card b', b => b.map(x => x.textContent));
      if (rec.cards.join('|') !== 'Where the routes are|Customers by route') bad.push('the Sales app cards read ' + rec.cards.join(', '));
      await shot(ph, 'sales-cards-390');
      if (rec.cards.length) await ph.click('[data-go="routes"]');
      await ph.waitForSelector('.sa-row, .sa-empty, #error:not([hidden]), #signin:not([hidden])', { timeout: 40000 });
      // 6.79 (#580): every route on two lines: route and status, then driver · where now, the driver under the route number.
      rec.twoLines = await ph.$$eval('.sa-row', x => x.map(r => { const one = r.querySelector('.sa-l1'), two = r.querySelector('.sa-l2'), lh = (e) => parseFloat(getComputedStyle(e).fontSize) * 1.6;
        return !!(one && two) && one.getBoundingClientRect().height <= lh(one) + 8 && two.getBoundingClientRect().height <= lh(two) && Math.abs(two.getBoundingClientRect().left - r.querySelector('.sa-route').getBoundingClientRect().left) < 2; }).filter(ok => !ok).length);
      if (rec.twoLines) bad.push(rec.twoLines + ' routes not on two lines');
      rec.state = await ph.evaluate(() => ({ signin: !document.getElementById('signin').hidden, error: document.getElementById('error').hidden ? '' : document.getElementById('error').textContent,
        division: (document.getElementById('sa-division').selectedOptions[0] || {}).text || '', day: document.getElementById('sa-day').textContent, refreshed: document.getElementById('sa-refreshed').textContent,
        groups: [...document.querySelectorAll('.sa-group')].map(g => g.textContent), rows: document.querySelectorAll('.sa-row').length }));
      // 6.81 (#598): Route Status lists what is delivered today, plus leftovers that have not left; routes on the road are not "Not loaded".
      rec.routeGroups = await ph.$$eval('#sa-list .sa-group', g => g.map(x => x.textContent.trim().slice(0, 60)));
      if (rec.routeGroups.some(g => !/^(Delivering today, |Left over from )/.test(g))) bad.push('Route Status groups read ' + rec.routeGroups.join(' / '));
      rec.statusWords = await ph.$$eval('.sa-row', x => { const c = {}; x.forEach(r => { const w = ((r.querySelector('.sa-l1') || r).textContent.match(/Not loaded|On time|Left|Not departed|Dropped|Loading|Loaded|late|behind/i) || ['other'])[0]; c[w] = (c[w] || 0) + 1; }); return c; });
      if (rec.state.signin) bad.push('the Sales app asked to sign in with a United Dairy account already signed in');
      if (rec.state.error) bad.push('the Sales app says: ' + rec.state.error.slice(0, 120));
      if (!rec.state.division) bad.push('no division picked');
      if (rec.state.rows) {
        const first = await ph.$eval('.sa-row', b => ({ id: b.dataset.id, route: b.querySelector('.sa-route').textContent }));
        await ph.click('.sa-row');
        await ph.waitForTimeout(1000);
        rec.tapped = await ph.evaluate(() => ({ title: document.getElementById('sa-map-title').textContent, where: document.getElementById('sa-map-where').textContent, map: !document.getElementById('sa-map').hidden ? (document.getElementById('sa-map').getAttribute('src') || '').replace(/q=[^&]*/, 'q=…') : '', none: document.getElementById('sa-map-none').hidden ? '' : document.getElementById('sa-map-none').textContent, on: (document.querySelector('.sa-row.on') || {}).dataset ? document.querySelector('.sa-row.on').dataset.id : '' }));
        if (rec.tapped.on !== first.id) bad.push('tapping route ' + first.route + ' did not pick it');
        if (rec.tapped.title.indexOf(first.route) !== 0) bad.push('the map title reads ' + rec.tapped.title + ' after tapping ' + first.route);
        if (!rec.tapped.map && !rec.tapped.none) bad.push('after the tap, no map and no line saying why');
        // Scrolled down, the map stays on top.
        await ph.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        rec.mapTop = await ph.$eval('.sa-map-box', e => Math.round(e.getBoundingClientRect().top));
        if (!(rec.mapTop >= 0 && rec.mapTop < 220)) bad.push('the map does not stay on top when the list scrolls (' + rec.mapTop + ')');
        await ph.evaluate(() => window.scrollTo(0, 0));
      } else note('Sales app: no routes today or yesterday for ' + rec.state.division + ' on the practice copy');
      rec.small = await ph.$$eval('.sa-row *, .sa-map-title, .sa-map-where', x => x.filter(e => e.textContent.trim() && !e.children.length && parseFloat(getComputedStyle(e).fontSize) < 16).length);
      if (rec.small) bad.push(rec.small + ' bits of text under 16px');
      if (await ph.evaluate(() => document.scrollingElement.scrollWidth > innerWidth + 1)) bad.push('the Sales app scrolls sideways at 390');
      await shot(ph, 'sales-app-390');
      // 6.79 (#576): Customers by route: by route (a route, then a day), by customer, by group. Counts only are written down.
      if (await ph.$('#sa-back:not([hidden])')) {
        await ph.click('#sa-back');
        await ph.waitForSelector('[data-go="customers"]', { timeout: 15000 });
        await ph.click('[data-go="customers"]');
        await ph.waitForSelector('#v-customers:not([hidden])', { timeout: 20000 });
        await ph.waitForTimeout(2500);
        const cu = rec.customers = await ph.evaluate(() => ({ title: document.getElementById('sa-title').textContent, routes: [...document.querySelectorAll('#cu-route option')].map(o => o.value).filter(Boolean).length,
          tabs: [...document.querySelectorAll('[data-tab]')].map(b => b.textContent), foot: document.getElementById('cu-foot').textContent.slice(0, 120), list: document.getElementById('cu-list').innerText.slice(0, 120) }));
        if (cu.title !== 'Customers') bad.push('the Customers card opens "' + cu.title + '"');
        if (cu.tabs.join('|') !== 'By route|By customer|By group') bad.push('Customers tabs read ' + cu.tabs.join(', '));
        // 6.79 (#584, #579): the customers come only from the Customer List app; with none for the division, a plain line says so.
        if (!cu.routes) {
          if (!/no customers in the Customer List app yet/.test(cu.list)) bad.push('Customers with no customers shows: ' + cu.list.slice(0, 100));
          note('Sales app Customers: the Customer List app has no customers for ' + rec.state.division + ' on the practice copy; it shows: ' + cu.list.slice(0, 100));
        } else if (!/^From the Customer List app/.test(cu.foot)) bad.push('Customers says where its list is from as: ' + cu.foot);
        if (cu.routes) {
          await ph.selectOption('#cu-route', { index: 1 });
          await ph.waitForTimeout(800);
          const day = await ph.$('#cu-days .sa-day.has');
          if (day) { await day.click(); await ph.waitForTimeout(800); }
          cu.byRoute = await ph.evaluate(() => ({ head: (document.querySelector('#cu-list .sa-group') || {}).textContent || '', rows: document.querySelectorAll('#cu-list .cu-row').length }));
          if (!/^Route .+: \d+ customers?$/.test(cu.byRoute.head) || !cu.byRoute.rows) bad.push('By route shows no customers for the first route (' + cu.byRoute.head + ')');
          await shot(ph, 'sales-customers-by-route');
          await ph.click('[data-tab="customer"]');
          const first = await ph.$eval('#cu-list .cu-row', r => r.textContent.replace(/#.*$/, '').trim().slice(0, 12)).catch(() => '');
          if (first) { await ph.fill('#cu-find', first); await ph.waitForTimeout(800); cu.byCustomer = await ph.$$eval('.cu-res', r => r.length); if (!cu.byCustomer) bad.push('By customer finds nothing for a customer on the route'); }
          await ph.click('[data-tab="group"]');
          await ph.waitForTimeout(800);
          cu.groups = await ph.$$eval('.cu-grp', g => g.length);
          // 6.80 (#590): a Group picked on the Customer List wins; chain 0 is no chain (Independents), never a group of its own.
          cu.groupNames = await ph.$$eval('.cu-grp b', g => g.map(x => x.textContent.trim()));
          if (cu.groupNames.some(n => /^(0|Chain 0|Chain #?0)$/i.test(n))) bad.push('By group has a group for chain 0');
          if (cu.groupNames.length && !cu.groupNames.includes('Independents')) bad.push('By group has no Independents (' + cu.groupNames.slice(0, 8).join(', ') + ')');
          if (cu.groupNames.length) {
            await ph.click('.cu-grp >> nth=0');
            await ph.waitForTimeout(800);
            cu.firstGroup = await ph.evaluate(() => { const t = document.getElementById('cu-list').innerText || ''; const m = t.match(/^(.+): (\d+) customers?/); return { head: m ? m[0] : '', count: m ? +m[2] : 0, lines: (t.match(/#\d+/g) || []).length, text: t.slice(0, 80) }; });
            if (!cu.firstGroup.count || !cu.firstGroup.lines || cu.firstGroup.head.indexOf(cu.groupNames[0] + ':') !== 0) bad.push('opening the group ' + cu.groupNames[0] + ' shows no customers');
            await ph.click('#sa-back');
            await ph.waitForTimeout(600);
            cu.backToGroups = await ph.$$eval('.cu-grp', g => g.length);
            if (!cu.backToGroups) bad.push('Back from a group does not come back to the groups');
          }
          await shot(ph, 'sales-customers-groups');
        }
        if (await ph.evaluate(() => document.scrollingElement.scrollWidth > innerWidth + 1)) bad.push('Customers scrolls sideways at 390');
      }
      // 6.79 (#586): the ? opens the Sales app's own Help inside the app (never the Operations Help page); nothing on it leads
      // out of the app; Back comes back to the screen the ? was pressed on. Back is the bigger one (18px words).
      const fromView = new URL(ph.url()).searchParams.get('view') || 'home';
      rec.help = { from: fromView };
      await ph.click('#sa-help');
      await ph.waitForSelector('#v-help:not([hidden]) #sa-help-read h2', { timeout: 20000 }).catch(() => {});
      await ph.waitForTimeout(800);
      Object.assign(rec.help, await ph.evaluate(() => ({ url: location.pathname + location.search, title: document.getElementById('sa-title').textContent, part: ((document.querySelector('#sa-help-read h2') || {}).textContent || ''),
        links: [...document.querySelectorAll('#v-help a[href]')].map(a => a.getAttribute('href')), more: [...document.querySelectorAll('.sa-helpgo')].map(b => b.textContent),
        back: (() => { const b = document.getElementById('sa-back'); return b.hidden ? null : { size: getComputedStyle(b).fontSize, h: Math.round(b.getBoundingClientRect().height) }; })(), words: (document.getElementById('sa-help-read').innerText || '').length })));
      if (!/^\/sales\.html\?view=help/.test(rec.help.url)) bad.push('the Sales app ? went to ' + rec.help.url + ' (should stay in the Sales app)');
      if (rec.help.title !== 'Help' || !rec.help.part || rec.help.words < 40) bad.push('the Sales app Help shows no help (' + rec.help.title + ' / ' + rec.help.part + ')');
      if (rec.help.links.length) bad.push('the Sales app Help has links: ' + rec.help.links.slice(0, 3).join(', '));
      if (!rec.help.back || parseFloat(rec.help.back.size) < 18 || rec.help.back.h < 36) bad.push('the Back button is not the bigger one (' + JSON.stringify(rec.help.back) + ')');
      await shot(ph, 'sales-help-390');
      if (rec.help.more.length) { await ph.click('.sa-helpgo >> nth=0'); await ph.waitForTimeout(800); rec.help.moreOpened = await ph.$eval('#sa-help-read h2', h => h.textContent).catch(() => ''); if (!/\/sales\.html/.test(ph.url())) bad.push('More help left the Sales app'); }
      await ph.click('#sa-back');
      await ph.waitForTimeout(1200);
      rec.help.backTo = new URL(ph.url()).searchParams.get('view') || 'home';
      if (rec.help.backTo !== fromView) bad.push('Back from Help went to ' + rec.help.backTo + ' (the ? was pressed on ' + fromView + ')');
      // 6.79 (#585): a Save-A-Lot drop and hook route reads "Dropped <time>, ..." and Where now follows the truck.
      await ph.click('#sa-back').catch(() => {});
      await ph.waitForSelector('[data-go="routes"]', { timeout: 15000 }).catch(() => {});
      if (await ph.$('[data-go="routes"]')) {
        await ph.click('[data-go="routes"]');
        await ph.waitForSelector('.sa-row, .sa-empty', { timeout: 30000 }).catch(() => {});
        rec.dropped = await ph.$$eval('.sa-row', x => x.filter(r => /Dropped /.test(r.textContent)).map(r => r.textContent.replace(/\s+/g, ' ').trim().slice(0, 100)));
        if (rec.dropped.length) { await ph.click('.sa-row:has-text("Dropped ")'); await ph.waitForTimeout(800); rec.droppedWhere = await ph.$eval('#sa-map-where', e => e.textContent.slice(0, 120)); if (!rec.droppedWhere) bad.push('a dropped Save-A-Lot route has no where line'); }
        else note('Sales app: no Save-A-Lot drop and hook route on the practice copy right now (' + (rec.state.rows ? rec.state.rows + ' routes' : 'no routes on ' + rec.state.day) + '), so its Dropped line could not be looked at');
      }
      if (ph.w.errors.length) bad.push('page errors: ' + ph.w.errors.slice(0, 3).join(' | '));
    } finally { await ph.done(); }
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.79 (#584, #579, look only): Administration > Sales App keeps the link, QR and Launch; this app's own customer list and its
  // Route Menu upload are gone (the Customer List app owns the customers).
  await write('Administration Sales App has no customer list upload (look only)', async (p, rec) => {
    const bad = [];
    await open(p, 'administration.html?item=sales-app');
    await p.waitForSelector('#panel h2', { timeout: 30000 });
    await p.waitForTimeout(2500);
    rec.look = await p.evaluate(() => { const t = document.getElementById('panel').innerText; return { title: document.querySelector('#panel h2').textContent, upload: !!document.querySelector('#sc-save, #panel input[type=file]'), words: /Route Menu workbook|Save Customer List|Customer By Route/.test(t),
      link: /Copy Link/.test(t) && /Launch/.test(t), fromApp: /from the Customer List app/.test(t) }; });
    if (rec.look.title !== 'Sales App') bad.push('the item opens ' + rec.look.title);
    if (rec.look.upload || rec.look.words) bad.push('Administration > Sales App still has the customer list upload');
    if (!rec.look.link) bad.push('Administration > Sales App has no Sales app link');
    if (!rec.look.fromApp) bad.push('Administration > Sales App does not say the customers come from the Customer List app');
    if (p.w.calls.some(c => c.fn === 'save')) bad.push('a look-only step saved');
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.80 (#589, look only): GPS Setup's Trip check reads one truck's trips for one day from Verizon (left and back with places,
  // miles, fuel counter, fuel used, MPG) and saves nothing; the trip fuel the server keeps every 30 minutes is in the app's own
  // database (gpsTripFuel), never the sheets. The truck is one the stored trips already name, on a weekday they cover.
  await write('GPS Setup Trip check (look only)', async (p, rec) => {
    const bad = [];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const kept = (await db.collection('private').doc('gpsTripFuel').get()).data() || null;
    rec.stored = kept ? { lastDate: kept.lastDate || '', lastTrips: kept.lastTrips, at: kept.at || '', error: kept.error || '' } : null;
    const some = (await db.collection('gpsTripFuel').limit(400).get()).docs.map(d => d.data());
    rec.storedTrips = some.length;
    if (!kept) note('GPS trip fuel: the every-30-minutes job has not stored anything on the practice copy yet');
    else if (kept.error) note('GPS trip fuel: the last stored run says: ' + String(kept.error).slice(0, 160));
    // A truck with fuel on a weekday: the stored trips first, else the first tractor on the fleet list.
    const pick = some.filter(t => t.tag && t.fuelUsed !== null && new Date(t.day + 'T12:00:00Z').getUTCDay() % 6 !== 0)[0] || some.filter(t => t.tag)[0];
    let tag = pick ? pick.tag : '', day = pick ? pick.day : '';
    if (!tag) {
      const tr = (await db.collection('equipment').get()).docs.map(d => d.data()).filter(e => /^(TRUCK|TRACTOR)$/.test(String(e.type || '').toUpperCase()) && e.facilityId === 'fac_uniontown' && e.unit).sort((a, b) => (String(a.status || 'ACTIVE').toUpperCase() === 'ACTIVE' ? 0 : 1) - (String(b.status || 'ACTIVE').toUpperCase() === 'ACTIVE' ? 0 : 1))[0];
      tag = tr ? String(tr.unit) : '';
      const L = require(path.join(__dirname, '..', '..', 'src', 'logic.js'));
      for (let k = 1; k <= 7 && !day; k++) { const d = L.addDays(operatingDay(), -k); if (new Date(d + 'T12:00:00Z').getUTCDay() % 6 !== 0) day = d; }
    }
    // 6.80 (#592): the case that ran out of time before: truck 123885 on Fri 10-30-26 (a Verizon read, up to about 190 s).
    if (some.length || tag) { tag = '123885'; day = '2026-10-30'; }
    rec.asked = { tag, day };
    if (!tag) throw new Error('no truck to ask about on the practice copy');
    await open(p, 'gps.html');
    await p.waitForSelector('#trips', { timeout: 30000 });
    rec.card = await p.evaluate(() => { const h = [...document.querySelectorAll('.gps-card h2')].map(x => x.textContent.trim()); return { heads: h, dayFilled: document.getElementById('t-date').value }; });
    if (!rec.card.heads.includes('5. Trip check')) bad.push('no "5. Trip check" card (' + rec.card.heads.join(', ') + ')');
    // The cards are numbered 1, 2, 3... in order, and one is What the app reads from Fleet (6, or 7 with Driver usernames).
    if (!rec.card.heads.some(h => /^\d+\. What the app reads from Fleet$/.test(h))) bad.push('no "What the app reads from Fleet" card');
    if (rec.card.heads.some((h, i) => !h.startsWith((i + 1) + '. '))) bad.push('the cards are not numbered in order: ' + rec.card.heads.join(', '));
    if (!rec.card.dayFilled) bad.push('the Day box does not start on yesterday');
    // Check trips with no truck says so.
    await p.fill('#t-tag', '');
    await p.click('#trips');
    await p.waitForTimeout(800);
    rec.noTruck = await p.evaluate(() => { const e = document.querySelector('#error, .error, [role=alert]'); return e && !e.hidden ? e.textContent.trim().slice(0, 80) : ''; });
    if (!/Type a truck first/.test(rec.noTruck)) bad.push('Check trips with no truck says: ' + (rec.noTruck || 'nothing'));
    const calls0 = p.w.calls.length;
    await p.fill('#t-tag', tag);
    await p.fill('#t-date', day);
    const t0 = Date.now();
    await p.click('#trips');
    await p.waitForFunction(() => !!document.querySelector('#trips-out p') || (() => { const e = document.querySelector('#error, .error, [role=alert]'); return e && !e.hidden && e.textContent.trim(); })(), null, { timeout: 200000 }).catch(() => {});
    rec.ms = Date.now() - t0;
    rec.result = await p.evaluate(() => { const o = document.getElementById('trips-out'), e = document.querySelector('#error, .error, [role=alert]');
      return { line: ((o.querySelector('p') || {}).textContent || '').slice(0, 160), heads: [...o.querySelectorAll('th')].map(x => x.textContent), rows: o.querySelectorAll('tbody tr').length,
        mpg: [...o.querySelectorAll('tbody tr')].map(tr => (tr.children[8] || {}).textContent).filter(Boolean).slice(0, 5), error: e && !e.hidden ? e.textContent.trim().slice(0, 200) : '', side: document.documentElement.scrollWidth > innerWidth + 1 }; });
    // A weekday read that runs out of time: the same truck on a quiet day (a Sunday), to see whether the check works at all.
    if (/deadline-exceeded/.test(rec.result.error)) {
      const L2 = require(path.join(__dirname, '..', '..', 'src', 'logic.js'));
      let sun = day; for (let k = 1; k <= 7; k++) { sun = L2.addDays(day, -k); if (new Date(sun + 'T12:00:00Z').getUTCDay() === 0) break; }
      await p.fill('#t-date', sun);
      const t1 = Date.now();
      await p.click('#trips');
      await p.waitForFunction(() => !document.getElementById('trips').disabled, null, { timeout: 150000 }).catch(() => {});
      rec.quietDay = { day: sun, ms: Date.now() - t1, line: await p.$eval('#trips-out', o => ((o.querySelector('p') || {}).textContent || '').slice(0, 160)), rows: await p.$$eval('#trips-out tbody tr', r => r.length),
        error: await p.$eval('#error', e => e.hidden ? '' : e.textContent.trim().slice(0, 120)) };
      await shot(p, 'gps-trip-check-quiet-day');
    }
    if (rec.result.error && !rec.result.line) {
      if (/login|Verizon|Fleet|credential|not set/i.test(rec.result.error)) note('GPS Trip check: the practice copy could not read Verizon: ' + rec.result.error);
      else bad.push('Check trips says: ' + rec.result.error);
    } else if (!rec.result.line) bad.push('Check trips showed nothing after ' + Math.round(rec.ms / 1000) + ' s');
    else {
      if (!new RegExp('^' + tag.replace(/[^\w]/g, '.') + ': (\\d+ GPS readings on |the trips the app saved for )').test(rec.result.line)) bad.push('the Trip check line reads: ' + rec.result.line);
      if (rec.result.rows && rec.result.heads.join('|') !== 'Left yard|From|Back|To|Miles|Fuel counter start (gal)|Fuel counter end (gal)|Fuel used (gal)|MPG|Note') bad.push('the trip columns read ' + rec.result.heads.join(', '));
      if (rec.result.side) bad.push('GPS Setup scrolls sideways with the trips shown');
    }
    // 6.80 (#592): the line under the Trip check says how far every truck's trips are saved; a saved day answers at once.
    rec.savedLine = await p.$eval('#trips-saved', e => e.textContent.trim()).catch(() => '');
    if (!/saved through \d{1,2}-\d{1,2}-\d{2}|not saved yet|failed/.test(rec.savedLine)) bad.push('the saved line under Trip check reads: ' + (rec.savedLine || 'nothing'));
    const m = rec.savedLine.match(/saved through (\d{1,2})-(\d{1,2})-(\d{2})/);
    if (m) {
      const savedDay = '20' + m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
      const ask = savedDay >= '2026-10-01' ? '2026-10-01' : savedDay;
      await p.fill('#t-date', ask);
      const t2 = Date.now();
      await p.click('#trips');
      await p.waitForFunction(() => !document.getElementById('trips').disabled && !!document.querySelector('#trips-out p'), null, { timeout: 200000 }).catch(() => {});
      rec.savedDay = { day: ask, ms: Date.now() - t2, line: await p.$eval('#trips-out', o => ((o.querySelector('p') || {}).textContent || '').slice(0, 160)), rows: await p.$$eval('#trips-out tbody tr', r => r.length),
        hint: await p.$$eval('#trips-out p.hint', h => h.map(x => x.textContent).join(' ').slice(0, 160)) };
      if (!/the trips the app saved for/.test(rec.savedDay.line)) bad.push('a saved day (' + ask + ') was read from Verizon again: ' + rec.savedDay.line);
      else if (rec.savedDay.ms > 20000) bad.push('a saved day took ' + Math.round(rec.savedDay.ms / 1000) + ' s');
      await shot(p, 'gps-trip-check-saved-day');
    }
    // Read only: the check saves nothing (no save call), and the sheets queue gets nothing from it.
    rec.calls = p.w.calls.slice(calls0).map(c => c.fn + (c.op ? ':' + c.op : ''));
    if (p.w.calls.slice(calls0).some(c => c.fn === 'save')) bad.push('the Trip check saved something');
    await shot(p, 'gps-trip-check');
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.80 (#593, look only): Go-Live Switches lists the Google sheets moving into Operations; People (who can sign in) is the
  // first, with its one-way Move into Operations button. Nothing is pressed (moving is one way and stops the sheet writes).
  await write('Go-Live Switches People list move button (look only)', async (p, rec) => {
    const bad = [];
    await open(p, 'administration.html?item=switch');
    await p.waitForSelector('tr[data-row="sheet-users"]', { timeout: 30000 }).catch(() => {});
    rec.rows = await p.$$eval('tr[data-row^="sheet-"]', t => t.map(r => ({ key: r.dataset.row.slice(6), name: (r.querySelector('.gl-name') || {}).textContent, cells: [...r.children].map(c => c.textContent.trim().slice(0, 60)),
      button: (() => { const b = r.querySelector('button[data-sheet]'); return b ? (b.disabled ? 'greyed' : 'on') + ': ' + b.textContent.trim() : ''; })() })));
    rec.group = await p.$eval('tr.gl-grp:last-of-type', t => t.textContent.trim()).catch(() => '');
    const u = rec.rows.find(x => x.key === 'users');
    if (!u) bad.push('no People list row on Go-Live Switches');
    else {
      if (u.name !== 'People (who can sign in)') bad.push('the row is called ' + u.name);
      if (!(u.button === 'on: Move into Operations' || /Moved /.test(u.cells.join(' ')))) bad.push('People has no Move into Operations button (' + u.button + ' / ' + u.cells.join(' | ') + ')');
    }
    const early = rec.rows.filter(x => x.key !== 'users' && /^on:/.test(x.button)).map(x => x.name);
    if (early.length) bad.push('lists not ready can be moved: ' + early.join(', '));
    if (rec.rows.length !== 7) bad.push(rec.rows.length + ' sheets listed (7 expected)');
    await p.$eval('tr[data-row="sheet-users"]', r => r.scrollIntoView({ block: 'center' })).catch(() => {});
    await shot(p, 'golive-people-list');
    if (p.w.calls.some(c => c.fn === 'switch' || c.fn === 'save')) bad.push('looking pressed a switch');
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.80 (#591, look only): how soon the buttons work after a screen opens: Loadout Center (Case Loadout, a load's Start) and the
  // Plant Station (its first button). Timed from the page starting to load; nothing is pressed.
  await write('Buttons ready after opening: Loadout Center and Plant Station (look only)', async (p, rec) => {
    const bad = [];
    const timeTo = async (url, sel) => { const t0 = Date.now(); await p.goto(SITE + '/' + url, { waitUntil: 'commit', timeout: 45000 }); const ok = await p.waitForSelector(sel, { timeout: 45000 }).then(() => true).catch(() => false); return ok ? Date.now() - t0 : null; };
    rec.loadout = [];
    for (let i = 0; i < 2; i++) rec.loadout.push(await timeTo('loadout.html' + (await wdQ()), '#rows tr[data-row] button:not([disabled])'));
    // The Plant Station: a test Case Unloading station of its own on its own tablet; timed from the code going in, then from the
    // tablet opening again (it remembers its station), until its Case Unloading / Trailer Assignments buttons work.
    rec.station = [];
    const adm = (op, f) => p.evaluate(([o, x]) => import('./js/app.js').then(m => m.callServer('admin', Object.assign({ op: o }, x))), [op, f]);
    await open(p, 'administration.html');
    const stName = 'Practice test Button timing';
    for (const o of ((await adm('stations', { kind: 'PLANT' })).stations || []).filter(x => x.name === stName)) await adm('stationRemove', { key: o.key });
    const st = ((await adm('stationAdd', { kind: 'PLANT', type: 'CASE_UNLOADING', facilityId: 'fac_uniontown', name: stName })).stations || []).find(x => x.name === stName);
    if (!st) throw new Error('could not add the test station');
    const t = await newPage({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, timingLook: true });
    try {
      const code = (await adm('stationCode', { key: st.key })).code;
      await open(t, 'plant-station.html');
      await t.waitForSelector('#code-box input[name="code"]', { timeout: 30000 });
      await t.fill('#code-box input[name="code"]', code);
      let t0 = Date.now();
      await t.click('#code-box button[type="submit"]');
      rec.station.push(await t.waitForSelector('#tabs [data-part="unload"]:not([disabled])', { timeout: 45000 }).then(() => Date.now() - t0, () => null));
      for (let i = 0; i < 2; i++) { t0 = Date.now(); await t.goto(SITE + '/plant-station.html', { waitUntil: 'commit', timeout: 45000 }); rec.station.push(await t.waitForSelector('#tabs [data-part="unload"]:not([disabled])', { timeout: 45000 }).then(() => Date.now() - t0, () => null)); }
      await shot(t, 'plant-station-ready');
      await t.evaluate(k => { try { localStorage.removeItem(k); } catch (e) { /* none */ } }, 'udStationDevice').catch(() => {});
    } finally {
      await t.done();
      await adm('stationRemove', { key: st.key }).catch(e => bad.push('the test station was not removed: ' + String(e.message).slice(0, 80)));
    }
    note('Buttons ready after opening (ms): Loadout Center ' + rec.loadout.join(', ') + ' (opened twice); Plant Station ' + rec.station.join(', ') + ' (after its code, then opened again twice)');
    if (rec.loadout.some(x => x === null)) bad.push('Loadout Center buttons did not come on within 45 s');
    if (rec.station.some(x => x === null)) bad.push('Plant Station buttons did not come on within 45 s');
    if ([...rec.loadout, ...rec.station].some(x => x > 15000)) bad.push('a screen took more than 15 s before its buttons worked');
    rec.pageSaves = p.w.calls.filter(c => c.fn === 'save').length; // the screens' own saves on opening (nothing was pressed)
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.81 (#597): Delete on the Driver Roster asks twice, marks the driver deleted (record kept), writes nothing to the Driver
  // Master sheet (no masterOutbox row), and the driver leaves the roster and every driver drop-down; an inactive driver is never
  // in a driver drop-down either. Two made-up drivers of the test's own (copies of a real record's shape, no phone), removed after.
  await write('Driver Roster Delete asks twice; inactive drivers never in a drop-down', async (p, rec) => {
    const bad = [];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const IDS = ['PRACTICE-TEST-DRIVER-A', 'PRACTICE-TEST-DRIVER-B'], NAMES = ['PRACTICE TEST DRIVER A', 'PRACTICE TEST DRIVER B'];
    const cleanup = async () => { for (const id of IDS) { await db.collection('drivers').doc(id).delete(); await db.collection('deletedDrivers').doc(id).delete(); await db.collection('driverPhones').doc(id).delete(); } };
    await cleanup();
    const model = (await db.collection('drivers').limit(50).get()).docs.map(d => d.data()).find(d => String(d.status || '').toUpperCase() === 'ACTIVE' && d.facilityId === 'fac_uniontown') ||
      (await db.collection('drivers').limit(1).get()).docs[0].data();
    const KEEP = ['facilityId', 'type', 'driverType', 'reliefDriver', 'seniority', 'seniorityDate', 'hireDate', 'homeTerminal', 'plant'];
    const base = {}; KEEP.forEach(k => { if (model[k] !== undefined) base[k] = model[k]; });
    const startedAt = new Date().toISOString();
    try {
      await db.collection('drivers').doc(IDS[0]).set(Object.assign({}, base, { id: IDS[0], name: NAMES[0], employeeId: '', status: 'ACTIVE', unavailableReason: '', testEdited: true, addedBy: EMAIL }));
      await db.collection('drivers').doc(IDS[1]).set(Object.assign({}, base, { id: IDS[1], name: NAMES[1], employeeId: '', status: 'INACTIVE', unavailableReason: 'Practice test', testEdited: true, addedBy: EMAIL }));
      // The drop-downs (Daily's driver list, as the Edit box and type-to-pick use it), OVR ticked too.
      await open(p, 'daily.html');
      await p.waitForFunction((ids) => import('./js/edit.js').then(m => ids.every(id => m.lists.allDrivers.some(d => d.id === id))), IDS, { timeout: 30000, polling: 1000 }).catch(() => {});
      const pick = () => p.evaluate((ids) => import('./js/edit.js').then(m => ({ plain: m.driverChoices('', {}, {}).map(c => c.value).filter(v => ids.includes(v)), ovr: m.driverChoices('', {}, { override: true }).map(c => c.value).filter(v => ids.includes(v)),
        html: ids.filter(id => m.driverOptionsHtml('', {}, { override: true }).includes('value="' + id + '"')) })), IDS);
      rec.before = await pick();
      if (!rec.before.plain.includes(IDS[0])) bad.push('the active test driver is not in the driver drop-down');
      if (rec.before.plain.includes(IDS[1]) || rec.before.ovr.includes(IDS[1]) || rec.before.html.includes(IDS[1])) bad.push('an inactive driver is in a driver drop-down (' + JSON.stringify(rec.before) + ')');
      // Delete A on the Driver Roster: the first press asks, Close keeps the driver, the second press deletes.
      await open(p, 'drivers.html');
      const row = 'tr[data-id="' + IDS[0] + '"] td.name';
      await p.waitForSelector(row, { timeout: 30000 });
      await p.click(row);
      await p.waitForSelector('#d-delete', { timeout: 10000 });
      rec.buttons = await p.$$eval('.panel-actions button', b => b.map(x => x.textContent.trim()));
      if (!rec.buttons.includes('Make Inactive') || !rec.buttons.includes('Delete')) bad.push('the driver panel buttons read ' + rec.buttons.join(', '));
      await p.click('#d-delete');
      rec.ask = { button: await p.$eval('#d-delete', b => b.textContent.trim()), line: await p.$eval('#d-delete-ask', a => a.hidden ? '' : a.textContent.trim()) };
      if (rec.ask.button !== 'Yes, delete ' + NAMES[0] || !/for good\?/.test(rec.ask.line)) bad.push('the first Delete press reads ' + JSON.stringify(rec.ask));
      await shot(p, 'driver-delete-ask');
      if ((await db.collection('drivers').doc(IDS[0]).get()).data().status !== 'ACTIVE') bad.push('the first Delete press already deleted');
      await p.click('#d-cancel');
      await p.waitForTimeout(500);
      await p.click(row);
      await p.waitForSelector('#d-delete', { timeout: 10000 });
      if ((await p.$eval('#d-delete', b => b.textContent.trim())) !== 'Delete') bad.push('Close did not reset Delete');
      await p.click('#d-delete');
      await timed(p, rec, 'Yes, delete', () => p.click('#d-delete'), { fn: (id) => !document.querySelector('tr[data-id="' + id + '"]'), arg: IDS[0] }, 20000);
      let d = null; for (let i = 0; i < 20; i++) { d = (await db.collection('drivers').doc(IDS[0]).get()).data(); if (d && d.status === 'DELETED') break; await p.waitForTimeout(500); }
      rec.after = { status: d && d.status, deleted: d && d.deleted, kept: !!d, remembered: (await db.collection('deletedDrivers').doc(IDS[0]).get()).exists };
      if (!rec.after.kept || rec.after.status !== 'DELETED' || !rec.after.deleted) bad.push('the deleted driver record reads ' + JSON.stringify(rec.after));
      if (!rec.after.remembered) bad.push('no deletedDrivers record (the sheet copy would bring the driver back)');
      // Nothing for the Driver Master sheet.
      const ob = (await db.collection('masterOutbox').where('createdAt', '>=', startedAt).get().catch(() => ({ docs: [] }))).docs.map(x => x.data()).filter(x => JSON.stringify(x).includes('PRACTICE-TEST-DRIVER') || JSON.stringify(x).includes('PRACTICE TEST DRIVER'));
      const ob2 = (await db.collection('masterOutbox').get()).docs.map(x => x.data()).filter(x => JSON.stringify(x).includes('PRACTICE-TEST-DRIVER') || JSON.stringify(x).includes('PRACTICE TEST DRIVER'));
      rec.sheetRows = ob.length + ob2.length;
      if (rec.sheetRows) bad.push('Delete queued ' + rec.sheetRows + ' row(s) for the Driver Master sheet');
      await shot(p, 'driver-deleted');
      // The deleted driver is in no drop-down any more.
      await open(p, 'daily.html');
      await p.waitForFunction((id) => import('./js/edit.js').then(m => m.lists.allDrivers.some(d => d.id === id && String(d.status).toUpperCase() === 'DELETED')), IDS[0], { timeout: 30000, polling: 1000 }).catch(() => {});
      rec.afterPick = await pick();
      if (rec.afterPick.plain.length || rec.afterPick.ovr.length || rec.afterPick.html.length) bad.push('after Delete a test driver is still in a drop-down (' + JSON.stringify(rec.afterPick) + ')');
      if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    } finally {
      await cleanup();
      rec.removed = true;
    }
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.81 (#596): Resend on a schedule text in Texts part 6 texts that one driver again. The practice copy has no Twilio account
  // and never texts anyone: the test puts one made-up schedule text of the posted week (a test driver, a 555 number) on the log,
  // checks Resend asks twice ("Tap again"), and that the second tap is refused for want of the Twilio account with nothing added
  // to the log. The made-up text and driver are removed after.
  await write('Texts Resend one driver\'s schedule text (practice: no Twilio, nothing sent)', async (p, rec) => {
    const bad = [];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const ID = 'PRACTICE-TEST-DRIVER-T', NAME = 'PRACTICE TEST DRIVER T';
    const week = (((await db.collection('config').doc('app').get()).data() || {}).liveWeeks || {}).current || '';
    rec.week = week;
    if (!week) throw new Error('no posted week on the practice copy');
    const LOG = week + '_' + ID + '_practice';
    const sms = (await db.collection('private').doc('sms').get()).data() || {};
    rec.twilioSaved = !!(sms.accountSid && sms.authToken && sms.fromNumber);
    if (rec.twilioSaved) throw new Error('the practice copy has a Twilio account saved: the test does not press Resend there');
    const cleanup = async () => { await db.collection('textLog').doc(LOG).delete(); await db.collection('drivers').doc(ID).delete(); await db.collection('driverPhones').doc(ID).delete();
      for (const x of (await db.collection('textLog').where('driverId', '==', ID).get()).docs) await x.ref.delete(); };
    await cleanup();
    try {
      await db.collection('drivers').doc(ID).set({ id: ID, name: NAME, employeeId: '', status: 'ACTIVE', facilityId: 'fac_uniontown', testEdited: true, addedBy: EMAIL });
      await db.collection('driverPhones').doc(ID).set({ driverId: ID, phone: '+15555550123', scheduleText: true, loadText: false, testEdited: true });
      await db.collection('textLog').doc(LOG).set({ direction: 'out', week, driverId: ID, name: NAME, to: '+15555550123', body: 'Practice test schedule text (made up by the test)', at: new Date().toISOString(), status: 'NOT SENT', reason: 'Practice test', by: EMAIL });
      await open(p, 'texts.html');
      const btn = '[data-resend="' + LOG + '"]';
      await p.waitForSelector(btn, { timeout: 30000 }).catch(() => {});
      rec.button = await p.$eval(btn, b => b.textContent.trim()).catch(() => '');
      if (rec.button !== 'Resend') bad.push('no Resend button on the posted week\'s schedule text (' + (rec.button || 'none') + ')');
      else {
        rec.otherResends = await p.$$eval('[data-resend]', b => b.length);
        await p.click(btn);
        await p.waitForTimeout(400);
        rec.armed = await p.$eval(btn, b => b.textContent.trim());
        if (rec.armed !== 'Tap again: text ' + NAME) bad.push('the first tap reads ' + rec.armed);
        await shot(p, 'texts-resend-armed');
        const c0 = p.w.calls.length;
        await p.click(btn);
        await p.waitForFunction(() => { const e = document.getElementById('error'); return e && !e.hidden && e.textContent.trim(); }, null, { timeout: 20000 }).catch(() => {});
        rec.answer = await p.$eval('#error', e => e.hidden ? '' : e.textContent.trim()).catch(() => '');
        rec.call = p.w.calls.slice(c0).map(c => c.fn + ':' + (c.op || '') + ' ' + c.status).join(', ');
        if (!/Save the Twilio account first/.test(rec.answer)) bad.push('the second tap answered: ' + (rec.answer || 'nothing') + ' (' + rec.call + ')');
        await shot(p, 'texts-resend-refused');
      }
      rec.logRows = (await db.collection('textLog').where('driverId', '==', ID).get()).size;
      if (rec.logRows !== 1) bad.push('the text log has ' + rec.logRows + ' rows for the test driver after Resend (1 expected: nothing sent)');
    } finally { await cleanup(); rec.removed = true; }
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.81 (#602, look only): the Sales app header Joe picked: the United Dairy logo, "UD SALES" over the screen's name (Welcome on
  // the cards), all on one row at 390, 1024 and 1536; on Route Status and Customers the gold-edged arrow Back and the ? too.
  await write('Sales app header at 390, 1024 and 1536 (look only)', async (p, rec) => {
    const bad = [];
    for (const [w, h] of [[390, 844], [1024, 768], [1536, 790]]) {
      const ph = await newPage(Object.assign({ viewport: { width: w, height: h } }, w < 1024 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}, { ['salesHdr' + w + 'Look']: true }));
      try {
        await ph.goto(SITE + '/sales.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await ph.waitForSelector('.sa-card', { timeout: 40000 });
        const look = async (view) => ph.evaluate((v) => { const hd = document.querySelector('.sa-hdr'), kids = [...hd.children].filter(e => !e.hidden && e.getClientRects().length), top = (e) => e.getBoundingClientRect().top, mid = (e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; };
          const logo = document.querySelector('.sa-logo'), back = document.getElementById('sa-back');
          return { view: v, h1: document.querySelector('.sa-hdr h1').textContent, logo: !!(logo && logo.complete && logo.naturalWidth > 0), oneRow: kids.every(e => Math.abs(mid(e) - mid(kids[0])) < 30), fits: hd.scrollWidth <= hd.clientWidth && document.documentElement.scrollWidth <= innerWidth + 1,
            height: Math.round(hd.getBoundingClientRect().height), back: back.hidden ? null : { text: back.textContent.trim(), font: getComputedStyle(back).fontSize, h: Math.round(back.getBoundingClientRect().height), w: Math.round(back.getBoundingClientRect().width) },
            help: !document.getElementById('sa-help').hidden, gold: getComputedStyle(document.querySelector('.sa-hdr h1 small')).color }; }, view);
        const out = [await look('home')];
        await shot(ph, 'sales-header-home-' + w);
        await ph.click('[data-go="routes"]');
        await ph.waitForSelector('.sa-row, .sa-empty', { timeout: 30000 }).catch(() => {});
        out.push(await look('routes'));
        await shot(ph, 'sales-header-routes-' + w);
        await ph.click('#sa-back');
        await ph.waitForSelector('[data-go="customers"]', { timeout: 15000 });
        await ph.click('[data-go="customers"]');
        await ph.waitForSelector('#v-customers:not([hidden])', { timeout: 20000 });
        out.push(await look('customers'));
        rec['w' + w] = out;
        const want = { home: 'UD SALESWelcome', routes: 'UD SALESRoute Status', customers: 'UD SALESCustomers' };
        out.forEach(o => {
          if (o.h1 !== want[o.view]) bad.push(w + ' ' + o.view + ': the header reads ' + o.h1);
          if (!o.logo) bad.push(w + ' ' + o.view + ': the logo does not load');
          if (!o.oneRow) bad.push(w + ' ' + o.view + ': the header is not on one row');
          if (!o.fits) bad.push(w + ' ' + o.view + ': the header does not fit the width');
          if (!o.help) bad.push(w + ' ' + o.view + ': no ? in the header');
          if (o.view !== 'home' && (!o.back || o.back.h < 38 || o.back.w < 38)) bad.push(w + ' ' + o.view + ': Back is small or missing (' + JSON.stringify(o.back) + ')');
          if (o.view === 'home' && o.back) bad.push(w + ' home: Back shows on the first screen');
        });
        if (ph.w.errors.length) bad.push(w + ' page errors: ' + ph.w.errors.slice(0, 3).join(' | '));
      } finally { await ph.done(); }
    }
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.82 (#606, look only): the Sales app's Division drop-down has every division plus All. A division lists only the routes
  // it runs (Uniontown never shows 901 Martins Ferry or the Fairmont 907 / Marietta 909 branch routes); All lists every
  // division's routes. Every Where now reads a place, the plant, or "Unknown: GPS not reporting" when no GPS unit reports.
  // Route numbers and counts only are written down.
  await write('Sales app divisions, All and Where now (look only)', async (p, rec) => {
    const bad = [], ph = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, salesDivLook: true });
    try {
      await ph.goto(SITE + '/sales.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await ph.waitForSelector('[data-go="routes"]', { timeout: 40000 });
      await ph.click('[data-go="routes"]');
      await ph.waitForSelector('.sa-row, .sa-empty, #error:not([hidden])', { timeout: 40000 });
      await ph.waitForFunction(() => document.getElementById('sa-division').options.length > 0, null, { timeout: 20000 }).catch(() => {});
      const opts = rec.divisions = await ph.$$eval('#sa-division option', o => o.map(x => ({ id: x.value, name: x.textContent.trim() })));
      if (!opts.length) bad.push('the Division drop-down is empty');
      if (opts.length > 1 && opts[opts.length - 1].name !== 'All') bad.push('the Division drop-down has no All choice at the end (' + opts.map(o => o.name).join(', ') + ')');
      const WHERE = /^(At .+|On the road(: .+)?|Stopped(: .+)?|At the plant|Back at the plant|Unknown: GPS not reporting|No GPS( on the truck)?)$/;
      rec.lists = {};
      for (const o of opts) {
        await ph.selectOption('#sa-division', o.id);
        await ph.waitForTimeout(500);
        await ph.waitForSelector('.sa-row, .sa-empty, #error:not([hidden])', { timeout: 40000 }).catch(() => {});
        await ph.waitForTimeout(1500);
        const l = await ph.evaluate(() => ({ picked: (document.getElementById('sa-division').selectedOptions[0] || {}).textContent || '', error: document.getElementById('error').hidden ? '' : document.getElementById('error').textContent.slice(0, 120),
          empty: (document.querySelector('.sa-empty') || {}).textContent || '', rows: [...document.querySelectorAll('.sa-row')].map(r => ({ route: r.querySelector('.sa-route').textContent.trim(), where: ((r.querySelector('.sa-where') || {}).textContent || '').trim() })) }));
        rec.lists[o.name] = { routes: l.rows.map(x => x.route), unknown: l.rows.filter(x => /^Unknown/.test(x.where)).length, empty: l.empty };
        if (l.picked !== o.name) bad.push('picking ' + o.name + ' shows ' + l.picked);
        if (l.error) bad.push(o.name + ': the Sales app says ' + l.error);
        const odd = l.rows.filter(x => !WHERE.test(x.where));
        if (odd.length) bad.push(o.name + ': Where now reads ' + odd.slice(0, 3).map(x => x.route + ' "' + x.where.slice(0, 50) + '"').join(', '));
        if (/uniontown/i.test(o.name)) { const not = l.rows.map(x => x.route.replace(/\D.*$/, '')).filter(n => ['901', '907', '909'].includes(n)); if (not.length) bad.push('Uniontown still lists ' + [...new Set(not)].join(', ') + ' (run by Martins Ferry or a branch)'); }
        if (l.rows.length) {
          await ph.click('.sa-row');
          await ph.waitForTimeout(900);
          rec.lists[o.name].tapWhere = await ph.$eval('#sa-map-where', e => e.textContent.trim().slice(0, 30).replace(/[0-9]{3,}.*$/, '…')).catch(() => '');
          if (!rec.lists[o.name].tapWhere) bad.push(o.name + ': tapping route ' + l.rows[0].route + ' shows no Where now under the map');
        }
        await shot(ph, 'sales-division-' + o.name.toLowerCase().replace(/[^a-z]+/g, '-'));
      }
      const all = rec.lists.All;
      if (all) {
        const own = opts.filter(o => o.name !== 'All').map(o => rec.lists[o.name].routes);
        const count = (a) => a.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {});
        const ac = count(all.routes), missing = [];
        own.forEach(list => Object.entries(count(list)).forEach(([r, n]) => { if ((ac[r] || 0) < n) missing.push(r); }));
        if (missing.length) bad.push('All does not list ' + [...new Set(missing)].slice(0, 6).join(', ') + ' that a division lists');
        if (all.routes.length < own.reduce((n, l) => n + l.length, 0)) bad.push('All lists ' + all.routes.length + ' routes, fewer than the divisions together');
      }
      const unknown = Object.values(rec.lists).reduce((n, l) => n + l.unknown, 0);
      note('Sales app divisions: ' + Object.entries(rec.lists).map(([k, l]) => k + ' ' + l.routes.length + ' routes' + (l.unknown ? ' (' + l.unknown + ' Unknown: GPS not reporting)' : '')).join(', ') + '. A changed-out trailer cannot be made on the practice copy, so Where now following the truck was not seen.');
      if (!unknown) note('Sales app: no route on the practice copy has both its GPS units silent, so "Unknown: GPS not reporting" was not seen.');
      // Put the phone's kept division back to the first one.
      if (opts.length) await ph.selectOption('#sa-division', opts[0].id).catch(() => {});
      if (ph.w.errors.length) bad.push('page errors: ' + ph.w.errors.slice(0, 3).join(' | '));
    } finally { await ph.done(); }
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.82 (#604, #605): a load an outside carrier hauls is listed and counted but never marked late or behind. The test puts
  // four loads of its own on today's Case Loadout, all leaving at 6:00 AM today: OUTSIDEPT 1 (outside carrier, not loaded),
  // UNITEDPT 2 (United Dairy, not loaded), OUTSIDEPT 3 (outside carrier, loaded after its dispatch time) and UNITEDPT 4
  // (United Dairy, loaded after its dispatch time). The forecast, Case Loadout's Behind count, the full shift report (the
  // pop-up and the email's own per-type tables, read from Print with printing stopped; nothing is sent) and the Reports must
  // never mark the outside ones; the United Dairy ones are still late / loaded late. All four are removed after.
  await write('Outside carrier loads listed, never late; United Dairy loads still are (6.82)', async (p, rec) => {
    const bad = [];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const behindCount = async () => { await open(p, 'loadout.html?area=CASE'); await p.waitForTimeout(4000); return p.evaluate(() => { const s = [...document.querySelectorAll('span')].find(x => /^Behind\s*\d+$/.test(x.textContent.trim())); return s ? Number(s.textContent.replace(/\D/g, '')) : null; }); };
    rec.behindBefore = await behindCount();
    const t = await todayTestLoads(4, { offset: 0, leavesOn: 'Delivery Day', day: { loadType: 'CASE', dispatchTime: 360, startTime: 360 } });
    if (!t.made) throw new Error('no load on the practice copy to copy for the test');
    rec.made = t.made;
    const OUT = 'OUTSIDEPT 1', UD = 'UNITEDPT 2', OUTDONE = 'OUTSIDEPT 3', UDDONE = 'UNITEDPT 4', NAMES = [OUT, UD, OUTDONE, UDDONE];
    try {
      const doneAt = new Date().toISOString();
      for (let i = 0; i < 4; i++) {
        const ref = db.collection('runs').doc(t.ids[i]), d = (await ref.get()).data(), pre = Object.keys(d.days || {}).find(k => d.days[k] && d.days[k].runs);
        const set = { run: NAMES[i], coverageType: i % 2 ? 'UNITED DAIRY' : 'OUTSIDE CARRIER', movementType: '' };
        if (i >= 2 && pre) set.days = { [pre]: Object.assign({}, d.days[pre], { completeTime: doneAt, loadedComplete: true, loadStatus: 'COMPLETE', plantStartedAt: doneAt }) };
        await ref.set(set, { merge: true });
      }
      await p.waitForTimeout(6000);
      const has = (s, n) => s.toUpperCase().includes(n);
      const rowOf = (name) => (list) => list.find(x => has(x.text, name));
      // Forecast (Case): the two not loaded are listed; only the United Dairy one is late.
      await open(p, 'forecast.html?area=CASE');
      await p.waitForFunction((n) => [...document.querySelectorAll('.fc-row')].some(x => x.textContent.toUpperCase().includes(n)), UD, { timeout: 30000 }).catch(() => {});
      const fc = await p.$$eval('.fc-row:not(.fc-head)', x => x.map(r => ({ text: r.textContent.replace(/\s+/g, ' ').trim().slice(0, 160), late: r.classList.contains('late'), pill: /Outside carrier, not counted late/.test(r.textContent) })));
      rec.forecast = { out: rowOf(OUT)(fc) || null, ud: rowOf(UD)(fc) || null };
      if (!rec.forecast.ud) bad.push('Forecast: the United Dairy test load is not listed');
      else if (!rec.forecast.ud.late) bad.push('Forecast: the United Dairy test load (6:00 AM, not loaded) is not late: ' + rec.forecast.ud.text);
      if (!rec.forecast.out) bad.push('Forecast: the outside carrier test load is not listed (it still takes loading time)');
      else { if (rec.forecast.out.late) bad.push('Forecast: the outside carrier load is marked late: ' + rec.forecast.out.text); if (!rec.forecast.out.pill) bad.push('Forecast: the outside carrier load has no "Outside carrier, not counted late" mark'); }
      await shot(p, 'outside-carrier-forecast');
      // Case Loadout: all four listed; Behind counts only the United Dairy one not loaded.
      rec.behindAfter = await behindCount();
      rec.loadoutRows = await p.$$eval('#rows tr[data-row]', (x, names) => x.filter(r => names.some(n => r.textContent.toUpperCase().includes(n))).map(r => r.textContent.replace(/\s+/g, ' ').trim().slice(0, 80)), NAMES);
      if (rec.loadoutRows.length < 2) bad.push('Case Loadout lists ' + rec.loadoutRows.length + ' of the 2 test loads not loaded');
      if (rec.behindBefore !== null && rec.behindAfter !== rec.behindBefore + 1) bad.push('Case Loadout Behind went from ' + rec.behindBefore + ' to ' + rec.behindAfter + ' (only the United Dairy load not loaded should add 1)');
      await shot(p, 'outside-carrier-loadout');
      // The full shift report (Send Current Report's pop-up; nothing sent).
      await open(p, 'manager.html?report=1');
      await p.waitForSelector('#rp-body .mc-banner', { timeout: 30000 }).catch(() => {});
      await p.waitForTimeout(2500);
      const pop = await p.evaluate(() => {
        const b = document.getElementById('rp-body') || document.body, sec = [...b.querySelectorAll('section')];
        const secOf = (h) => { const s = sec.find(x => (x.querySelector('h3') || {}).textContent && x.querySelector('h3').textContent.indexOf(h) === 0); return s ? [...s.querySelectorAll('li')].map(li => ({ text: li.textContent.replace(/\s+/g, ' ').trim(), bad: li.classList.contains('bad') || li.classList.contains('warn') })) : []; };
        const tiles = [...b.querySelectorAll('.mc-routes span')].map(s => ({ text: s.textContent.replace(/\s+/g, ' ').trim(), k: s.className, word: ((s.querySelector('i') || {}).textContent || '') }));
        return { banner: (b.querySelector('.mc-banner') || {}).textContent || '', routesHead: ((sec.find(x => /^Routes\d/.test((x.querySelector('h3') || {}).textContent || '')) || {}).querySelector ? sec.find(x => /^Routes\d/.test((x.querySelector('h3') || {}).textContent || '')).querySelector('h3').textContent : ''),
          forecast: sec.filter(x => /^Forecast/.test((x.querySelector('h3') || {}).textContent || '')).map(x => x.innerText).join('\n'), lateBehind: secOf('Routes late or behind'), still: secOf('Still to load'), tiles, all: b.innerText };
      });
      rec.report = { banner: pop.banner.slice(0, 120), routesHead: pop.routesHead };
      // The tiles carry the route number and a short run name; the test's run names are short enough to show whole.
      const nameLike = (n) => (s) => has(s, n);
      rec.report.tiles = pop.tiles.filter(x => /OUTSIDEPT|UNITEDPT/i.test(x.text));
      rec.report.lateBehind = pop.lateBehind.filter(x => /OUTSIDEPT|UNITEDPT/i.test(x.text)).map(x => x.text.slice(0, 90));
      rec.report.still = pop.still.filter(x => /OUTSIDEPT|UNITEDPT/i.test(x.text)).map(x => (x.bad ? 'RED ' : '') + x.text.slice(0, 90));
      rec.report.forecast = pop.forecast.split('\n').filter(l => /OUTSIDEPT|UNITEDPT/i.test(l)).slice(0, 6);
      for (const n of NAMES) if (!rec.report.tiles.some(x => nameLike(n)(x.text))) bad.push('the shift report Routes list does not show ' + n + ' (outside loads are listed now)');
      for (const n of [OUT, OUTDONE]) {
        const tl = rec.report.tiles.filter(x => nameLike(n)(x.text));
        if (tl.some(x => x.word)) bad.push('the shift report Routes list marks the outside load ' + n + ' ' + tl.map(x => x.word).join(', '));
        if (pop.lateBehind.some(x => nameLike(n)(x.text))) bad.push('the shift report lists the outside load ' + n + ' under Routes late or behind');
        if (pop.still.some(x => nameLike(n)(x.text) && x.bad)) bad.push('the shift report Still to load marks the outside load ' + n + ' red');
        if (pop.forecast.split('\n').some(l => nameLike(n)(l))) bad.push('the shift report forecast box names the outside load ' + n);
      }
      if (!rec.report.tiles.some(x => nameLike(UD)(x.text) && /LATE|BEHIND/.test(x.word))) bad.push('the shift report Routes list does not mark the United Dairy load ' + UD + ' late');
      if (!pop.lateBehind.some(x => nameLike(UD)(x.text)) && !/Late now:[^\n]*UNITEDPT 2/i.test(pop.forecast)) bad.push('the shift report does not show the United Dairy load ' + UD + ' late or behind');
      if (!rec.report.tiles.some(x => nameLike(UDDONE)(x.text) && /LATE/.test(x.word))) bad.push('the shift report Routes list does not mark ' + UDDONE + ' (United Dairy, loaded after its dispatch) loaded late');
      await shot(p, 'outside-carrier-report');
      // The email's own per-type tables (Case, Box, ...): Print builds the email in a frame; printing is stopped and the frame read.
      await p.evaluate(() => { window.__mail = ''; new MutationObserver((ms) => ms.forEach(m => m.addedNodes.forEach(n => { if (n.tagName === 'IFRAME') { try { n.contentWindow.print = () => {}; } catch (e) { /* */ } setTimeout(() => { try { window.__mail = n.contentDocument.documentElement.outerHTML; } catch (e) { /* */ } }, 200); } }))).observe(document.body, { childList: true }); });
      await p.click('#print-report');
      await p.waitForFunction(() => window.__mail, null, { timeout: 10000 }).catch(() => {});
      const mail = await p.evaluate(() => window.__mail || '');
      if (!mail) bad.push('the shift report email could not be read from Print');
      else {
        const mp = await newPage({ viewport: { width: 600, height: 900 }, mailLook: true });
        try {
          await mp.setContent(mail.replace(/<script[\s\S]*?<\/script>/gi, ''));
          const grid = await mp.evaluate(() => [...document.querySelectorAll('tr')].filter(tr => tr.children.length === 4 && !tr.querySelector('table')).map(tr => { const c = [...tr.children]; return { cells: c.map(td => td.textContent.replace(/\s+/g, ' ').trim()), red: c.some(td => /rgb\(180, 35, 24\)|#b42318/i.test(td.style.background + td.style.backgroundColor + td.innerHTML)) }; }));
          const mine = grid.filter(g => /OUTSIDEPT|UNITEDPT|Outsidept|Unitedpt/i.test(g.cells[1] || ''));
          rec.mailRows = mine.map(g => (g.red ? 'RED ' : '') + g.cells.join(' | '));
          const mrow = (n) => mine.filter(g => (g.cells[1] || '').toUpperCase() === n);
          for (const n of NAMES) if (!mrow(n).length) bad.push('the shift report email per-type table does not list ' + n);
          for (const n of [OUT, OUTDONE]) if (mrow(n).some(g => g.red || /LATE|BEHIND|⚠/.test(g.cells.join(' ')))) bad.push('the shift report email marks the outside load ' + n + ': ' + mrow(n).map(g => g.cells.join(' | ')).join(' / '));
          if (!mrow(UD).some(g => g.red && /LATE|BEHIND/.test(g.cells.join(' ')))) bad.push('the shift report email does not mark ' + UD + ' late: ' + mrow(UD).map(g => g.cells.join(' | ')).join(' / '));
          if (!mrow(UDDONE).some(g => g.red)) bad.push('the shift report email does not mark ' + UDDONE + ' (United Dairy, loaded after its dispatch) loaded late: ' + mrow(UDDONE).map(g => g.cells.join(' | ')).join(' / '));
          rec.mailHeads = await mp.evaluate(() => [...document.querySelectorAll('td div')].map(d => d.textContent.trim()).filter(x => /^(Case|Box|Tote|Tanker) \(\d+\)$/.test(x)));
          await shot(mp, 'outside-carrier-email');
        } finally { await mp.done(); }
      }
      if (p.w.calls.some(c => /send/i.test((c.op || '') + c.fn))) bad.push('looking at the report sent something');
      // Reports (the day's loadout report).
      await open(p, 'reports.html');
      await p.waitForTimeout(5000);
      const rows = await p.$$eval('tr', (x) => x.filter(r => /OUTSIDEPT|UNITEDPT/i.test(r.textContent)).map(r => ({ text: r.textContent.replace(/\s+/g, ' ').trim().slice(0, 140), bad: !!r.querySelector('.bad, .warn') })));
      rec.reports = rows;
      const outRows = rows.filter(x => /OUTSIDEPT/i.test(x.text));
      if (outRows.some(x => x.bad || /NOT LOADED|LATE|Never started/i.test(x.text))) bad.push('Reports marks the outside carrier load: ' + outRows.map(x => x.text).join(' | '));
      await shot(p, 'outside-carrier-reports');
      if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    } finally { await t.remove(); rec.removed = true; }
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.78 (#568): the Labeling Room opens with the fillers, and the "Labeling now" drop-down saves (to the filler's record);
  // then the filler's label is put back as it was.
  await write('Labeling Room opens and saves', async (p, rec) => {
    const bad = [];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const fs2 = r('firebase-admin/firestore'), db = fs2.getFirestore(r('firebase-admin').app('audit'));
    await open(p, 'labeling.html');
    await p.waitForSelector('[data-lane]', { timeout: 30000 }).catch(() => {});
    rec.lanes = await p.$$eval('[data-lane]', ls => ls.map(l => ({ id: l.dataset.lane, name: ((l.querySelector('h2 span') || {}).textContent || '').trim(), now: (l.querySelector('[data-pick="labeling"]') || {}).value || '', options: l.querySelector('[data-pick="labeling"]') ? [...l.querySelector('[data-pick="labeling"]').options].map(o => o.value).filter(Boolean) : [], disabled: !!(l.querySelector('[data-pick="labeling"]') || {}).disabled })));
    if (!rec.lanes.length) bad.push('the Labeling Room shows no fillers');
    rec.fit = await p.evaluate(() => document.scrollingElement.scrollWidth > innerWidth + 1);
    if (rec.fit) bad.push('the Labeling Room scrolls sideways at 1536');
    const lane = rec.lanes.find(l => !l.disabled && l.options.filter(o => o !== l.now).length);
    if (!lane) { if (rec.lanes.length) bad.push('no filler has a label to pick (' + rec.lanes.map(l => l.name + ':' + l.options.length).join(', ') + ')'); }
    else {
      const ref = db.collection('productionLines').doc(lane.id), before = ((await ref.get()).data() || {});
      rec.lane = lane.name;
      const to = lane.options.find(o => o !== lane.now);
      try {
        await p.selectOption('[data-lane="' + lane.id + '"] [data-pick="labeling"]', to);
        let saved = '';
        for (let i = 0; i < 20 && saved !== to; i++) { await p.waitForTimeout(500); saved = (((await ref.get()).data() || {}).labeling || {}).product || ''; }
        rec.saved = saved === to;
        if (!rec.saved) bad.push('picking ' + to + ' on ' + lane.name + ' did not save (' + saved + ')');
        await shot(p, 'labeling-room-saved');
        // The filler's tablet: its Labeling Room box. It names the new label once the filler has a product running (a label
        // different from what runs is "switched"); with nothing running it asks for the product first.
        if (rec.saved) {
          await open(p, 'line.html?line=' + encodeURIComponent(lane.id));
          await p.waitForSelector('#label-box:not([hidden])', { timeout: 30000 }).catch(() => {});
          await p.waitForTimeout(1500);
          rec.tablet = await p.evaluate(() => { const b = document.getElementById('label-box'); return b ? { shown: !b.hidden, text: b.innerText.replace(/\s+/g, ' ').slice(0, 220) } : { shown: false, text: '' }; });
          if (!rec.tablet.shown) bad.push('the filler\'s tablet shows no Labeling Room box');
          else if (rec.tablet.text.indexOf(to) >= 0) rec.tabletShowsLabel = true;
          else if (/Pick the product running first/.test(rec.tablet.text)) note('Labeling Room: ' + lane.name + ' has no product running on the practice copy, so its tablet asks for the product first instead of naming the new label (' + rec.tablet.text.slice(0, 120) + ')');
          else bad.push('the filler\'s tablet does not show ' + to + ': ' + rec.tablet.text);
          await shot(p, 'labeling-filler-tablet');
        }
      } finally {
        await ref.set({ labeling: before.labeling === undefined ? fs2.FieldValue.delete() : before.labeling, updatedAt: before.updatedAt === undefined ? fs2.FieldValue.delete() : before.updatedAt, updatedBy: before.updatedBy === undefined ? fs2.FieldValue.delete() : before.updatedBy }, { merge: true });
        rec.putBack = JSON.stringify(((await ref.get()).data() || {}).labeling || null) === JSON.stringify(before.labeling || null);
        if (!rec.putBack) bad.push('the filler\'s label was not put back');
      }
    }
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });

  // 6.79 (#577, look only): Administration's menu is eight groups that fold (red bars, white words), one open at a time, blue
  // items with the open one solid blue; Hide menu gives the item the full width, Show menu brings the menu back.
  await write('Administration menu: nine folding groups and Hide menu (look only)', async (p, rec) => {
    const bad = [];
    await open(p, 'administration.html');
    await p.waitForSelector('.adm-gh', { timeout: 30000 });
    if (await p.isVisible('#show-menu')) await p.click('#show-menu');
    const openGroups = () => p.$$eval('.adm-nav-group', g => g.filter(x => x.querySelector('.adm-items:not([hidden])')).map(x => x.querySelector('.adm-gh').dataset.group));
    // People & Roles opens first: its names and emails are blanked before any picture.
    await p.waitForSelector('.people-table td', { timeout: 15000 }).catch(() => {});
    await p.evaluate(() => document.querySelectorAll('.people-table td').forEach(td => { td.textContent = '•••'; }));
    rec.groups = await p.$$eval('.adm-gh', b => b.map(x => x.textContent));
    const want = ['People & Access', 'Links & Codes', 'Email & Texts', 'Dispatch & Fleet', 'Plant Setup', 'Products & Machines', 'Plant Maintenance Setup', 'Fleet Maintenance Setup', 'Checks & Repairs'];
    if (rec.groups.join('|') !== want.join('|')) bad.push('the groups read ' + rec.groups.join(', '));
    // 6.91 (#684): Fleet Service Setup sits under Fleet Maintenance Setup, no longer under Dispatch & Fleet.
    rec.fleetGroup = await p.$$eval('.adm-nav-group', g => Object.fromEntries(g.filter(x => x.querySelector('.adm-gh')).map(x => [x.querySelector('.adm-gh').textContent.replace(/\s*\d+$/, '').trim(), [...x.querySelectorAll('.adm-item')].map(i => i.textContent.trim())]).filter(([k]) => /Fleet/.test(k))));
    if (!(rec.fleetGroup['Fleet Maintenance Setup'] || []).some(t => /^Fleet Service Setup/.test(t)) || (rec.fleetGroup['Dispatch & Fleet'] || []).some(t => /^Fleet Service Setup/.test(t))) bad.push('Fleet Service Setup is not under Fleet Maintenance Setup (' + JSON.stringify(rec.fleetGroup) + ')');
    // 6.91 (#689): Garage Technicians is its own item under Fleet Maintenance Setup.
    if (!(rec.fleetGroup['Fleet Maintenance Setup'] || []).some(t => /^Garage Technicians/.test(t))) bad.push('Garage Technicians is not an item under Fleet Maintenance Setup (' + JSON.stringify(rec.fleetGroup) + ')');
    rec.open = await openGroups();
    if (rec.open.length !== 1) bad.push(rec.open.length + ' groups open at the start');
    rec.colors = await p.evaluate(() => { const c = (sel, k) => { const e = document.querySelector(sel); return e ? getComputedStyle(e)[k] : ''; };
      return { bar: c('.adm-gh', 'backgroundColor'), barText: c('.adm-gh', 'color'), item: c('.adm-item:not(.on)', 'color'), on: c('.adm-item.on', 'backgroundColor'), fits: (() => { const n = document.getElementById('nav'), g = [...document.querySelectorAll('.adm-gh')].pop(); return g.getBoundingClientRect().bottom <= n.getBoundingClientRect().bottom - (n.offsetHeight - n.clientHeight) + 1; })(),
        practiceExtra: (() => { const g = [...document.querySelectorAll('.adm-gh')].pop(), n = document.getElementById('nav'); return Math.max(0, Math.round(n.scrollHeight - (g.getBoundingClientRect().bottom - n.getBoundingClientRect().top + n.scrollTop))); })(),
        small: [...document.querySelectorAll('.adm-nav .adm-gh, .adm-nav .adm-item, #hide-menu')].filter(x => x.offsetParent && parseFloat(getComputedStyle(x).fontSize) < 16).length }; });
    if (rec.colors.bar !== 'rgb(200, 16, 46)' || rec.colors.barText !== 'rgb(255, 255, 255)') bad.push('the group bars are not red with white words (' + rec.colors.bar + ' / ' + rec.colors.barText + ')');
    if (rec.colors.item !== 'rgb(21, 101, 192)' || rec.colors.on !== 'rgb(21, 101, 192)') bad.push('the items are not blue (' + rec.colors.item + ' / open ' + rec.colors.on + ')');
    if (rec.colors.fits && rec.colors.practiceExtra > 2) note('Administration menu: all nine group bars fit at 1536 x 790; below them the practice copy\'s own Sandbox tools (not on the live app) scroll ' + rec.colors.practiceExtra + ' px');
    if (!rec.colors.fits) {
      rec.fitDetail = await p.evaluate(() => { const n = document.getElementById('nav'), r = n.getBoundingClientRect(), last = [...document.querySelectorAll('.adm-gh')].pop().getBoundingClientRect(), hd = document.querySelector('header, .app-header, .hdr');
        return { navTop: Math.round(r.top), navHeight: n.clientHeight, menuHeight: n.scrollHeight, lastBarBottom: Math.round(last.bottom), screenHeight: innerHeight, headerHeight: hd ? Math.round(hd.getBoundingClientRect().height) : null }; });
      await shot(p, 'admin-menu-start-1536');
      bad.push('the folded menu does not fit at 1536 x 790 (menu ' + rec.fitDetail.menuHeight + ' px tall in a ' + rec.fitDetail.navHeight + ' px box; the last group bar ends at ' + rec.fitDetail.lastBarBottom + ' of ' + rec.fitDetail.screenHeight + ')');
    }
    if (rec.colors.small) bad.push(rec.colors.small + ' menu words under 16px');
    await p.click('.adm-gh[data-group="Email & Texts"]');
    rec.afterPress = await openGroups();
    if (rec.afterPress.join() !== 'Email & Texts') bad.push('pressing Email & Texts opened ' + rec.afterPress.join(', '));
    await p.click('.adm-item[data-key="sales-email"]');
    await p.waitForSelector('.adm-item.on[data-key="sales-email"]', { timeout: 10000 }).catch(() => bad.push('Sales Route Email did not open from its group'));
    await shot(p, 'admin-menu-email-open');
    const before = await p.$eval('#panel', x => x.getBoundingClientRect().width);
    await p.click('#hide-menu');
    await p.waitForTimeout(500);
    const after = await p.$eval('#panel', x => x.getBoundingClientRect().width);
    rec.width = [Math.round(before), Math.round(after)];
    if (!(after > before + 200)) bad.push('Hide menu did not widen the item (' + rec.width.join(' -> ') + ')');
    if (!(await p.isVisible('#show-menu'))) bad.push('no Show menu after Hide menu');
    await shot(p, 'admin-menu-hidden');
    await p.click('#show-menu');
    await p.waitForSelector('#find', { state: 'visible', timeout: 5000 }).catch(() => bad.push('Show menu did not bring the menu back'));
    if (await p.evaluate(() => document.scrollingElement.scrollWidth > innerWidth + 1)) bad.push('Administration scrolls sideways at 1536');
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.84 (#609): one timing rule: on time within 30 minutes of the truck's leaving time, yellow 30 to 60 minutes, red past 60;
  // every time written 4:30 PM and every length 35 min / 1 hr 12 min. The test puts five Case loads of its own on today's list,
  // timed from now: TIMEPT A15 (left 15 min ago, not loaded: on time), TIMEPT B45 (45 min, not loaded: yellow), TIMEPT C90
  // (90 min, not loaded: red), TIMEPT D20 (20 min, loaded now: on time) and TIMEPT E50 (50 min, loaded now: loaded late). Read
  // on Case Loadout, the Late Forecast, the plant report pop-up and the email (Print, nothing sent), the Loading Rundown and
  // the sales app route list. All removed after.
  await write('Timing rule: on time, yellow, red and the time format (6.84)', async (p, rec) => {
    const bad = [];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    // Times or lengths not written the one way.
    const ODD = /\b\d{1,2}:\d\d ?(am|pm|a\.m\.|p\.m\.)(?![a-z])|\b\d{1,2}:\d\d(AM|PM)\b|\b\d+ ?h \d+ ?m(in)?\b|\b\d+h\b|\b\d+m\b|\b\d+ (hrs|mins|h)\b|\b([01]?\d|2[0-3]):[0-5]\d\b(?!\s?[AP]M)/g;
    // Each odd one with the words around it ("…Done 11:55 Not…"), so the screen's own wording can be told from the test's.
    const oddTimes = (s) => { const out = []; let m; ODD.lastIndex = 0; while ((m = ODD.exec(s)) && out.length < 6) { const c = s.slice(Math.max(0, m.index - 25), m.index + m[0].length + 15).replace(/\s+/g, ' '); if (/Back up at \d/.test(c)) { note('Timing: saved words on an older shift note read "' + c.trim() + '" (typed before the time format, not drawn by the screen)'); continue; } if (!out.some(x => x.indexOf(m[0]) >= 0)) out.push(c); } return out; };
    const behindOf = async () => { await open(p, 'loadout.html?area=CASE'); await p.waitForTimeout(4000); return p.evaluate(() => { const s = [...document.querySelectorAll('span')].find(x => /^Behind\s*\d+$/.test(x.textContent.trim())); return s ? { n: Number(s.textContent.replace(/\D/g, '')), cls: s.className } : null; }); };
    rec.behindBefore = await behindOf();
    const wallNow = () => { const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })); return d.getHours() * 60 + d.getMinutes(); };
    const m0 = wallNow();
    if (m0 < 6 * 60 + 100) throw new Error('too close to the 6:00 AM day change to time loads 90 minutes back (' + m0 + ')');
    const t = await todayTestLoads(5, { offset: 0, leavesOn: 'Delivery Day', day: { loadType: 'CASE', dispatchTime: 360, startTime: 360 } });
    if (!t.made) throw new Error('no load on the practice copy to copy for the test');
    rec.made = t.made;
    const SET = [['TIMEPT A15', 15, false], ['TIMEPT B45', 45, false], ['TIMEPT C90', 90, false], ['TIMEPT D20', 20, true], ['TIMEPT E50', 50, true]];
    const idOf = {};
    try {
      const doneAt = new Date().toISOString(), m = wallNow();
      for (let i = 0; i < 5; i++) {
        const [name, ago, done] = SET[i], ref = db.collection('runs').doc(t.ids[i]), d = (await ref.get()).data(), pre = Object.keys(d.days || {}).find(k => d.days[k] && d.days[k].runs);
        const day = Object.assign({}, d.days[pre], { dispatchTime: m - ago, startTime: m - ago }, done ? { completeTime: doneAt, loadedComplete: true, loadStatus: 'COMPLETE', plantStartedAt: new Date(Date.now() - 25 * 60000).toISOString() } : {});
        await ref.set({ run: name, coverageType: 'UNITED DAIRY', movementType: '', days: { [pre]: day } }, { merge: true });
        idOf[name] = t.ids[i] + '|' + pre;
      }
      await p.waitForTimeout(6000);
      const key = (s) => (String(s).toUpperCase().match(/TIMEPT ([A-E]\d\d)/) || [])[1] || '';
      // Case Loadout: the dispatch time colours and Behind.
      rec.behindAfter = await behindOf();
      const lo = rec.loadout = await p.$$eval('#rows tr[data-row]', x => x.filter(r => /TIMEPT/i.test(r.textContent)).map(r => ({ t: r.textContent, dep: [...r.querySelectorAll('td')].map(td => td.className).filter(c => /dep-/.test(c)).join(' ') })).map(x => ({ k: (x.t.toUpperCase().match(/TIMEPT ([A-E]\d\d)/) || [])[1], dep: x.dep })));
      const depOf = (k) => (lo.find(x => x.k === k) || { dep: 'missing' }).dep;
      rec.dep = { A15: depOf('A15'), B45: depOf('B45'), C90: depOf('C90'), D20: depOf('D20'), E50: depOf('E50') };
      if (rec.dep.A15 !== '') bad.push('Case Loadout colours the dispatch time of a load 15 min past it: "' + rec.dep.A15 + '"');
      if (rec.dep.B45 !== 'dep-caution') bad.push('Case Loadout: 45 min past its dispatch time is "' + rec.dep.B45 + '" (should be yellow)');
      if (rec.dep.C90 !== 'dep-late') bad.push('Case Loadout: 90 min past its dispatch time is "' + rec.dep.C90 + '" (should be red)');
      if (rec.dep.D20 || rec.dep.E50) bad.push('Case Loadout colours a loaded load\'s dispatch time');
      if (rec.behindBefore && rec.behindAfter && (rec.behindAfter.n !== rec.behindBefore.n + 2 || !/red/.test(rec.behindAfter.cls))) bad.push('Case Loadout Behind went from ' + rec.behindBefore.n + ' to ' + rec.behindAfter.n + ' (' + rec.behindAfter.cls + '); the 45 and 90 min loads should add 2, red');
      rec.loadoutOdd = oddTimes(await p.evaluate(() => document.getElementById('rows').innerText));
      if (rec.loadoutOdd.length) bad.push('Case Loadout writes times as ' + rec.loadoutOdd.join(', '));
      await colorCheck(p, 'Case Loadout (late, yellow, on time)', bad, rec);
      await shot(p, 'timing-loadout');
      // The Late Forecast: words and times.
      await open(p, 'forecast.html?area=CASE');
      await p.waitForFunction(() => [...document.querySelectorAll('.fc-row')].some(x => /TIMEPT/i.test(x.textContent)), null, { timeout: 30000 }).catch(() => {});
      await p.waitForTimeout(1000);
      const fcText = await p.evaluate(() => document.body.innerText);
      rec.forecast = (await p.$$eval('.fc-row:not(.fc-head)', x => x.filter(r => /TIMEPT/i.test(r.textContent)).map(r => r.textContent.replace(/\s+/g, ' ').trim().slice(0, 110))));
      rec.forecastOdd = oddTimes(fcText);
      if (rec.forecastOdd.length) bad.push('the Late Forecast writes times as ' + rec.forecastOdd.join(', '));
      // The plant report pop-up and the email.
      await open(p, 'manager.html?report=1');
      await p.waitForSelector('#rp-body .mc-banner', { timeout: 30000 }).catch(() => {});
      await p.waitForTimeout(3000);
      const pop = await p.evaluate(() => ({ tiles: [...document.querySelectorAll('#rp-body .mc-routes span')].filter(s => /TIMEPT/i.test(s.textContent)).map(s => ({ t: s.textContent.replace(/\s+/g, ' ').trim(), k: s.className, w: ((s.querySelector('i') || {}).textContent || '') })), all: (document.getElementById('rp-body') || {}).innerText || '' }));
      rec.tiles = pop.tiles.map(x => key(x.t) + ' ' + x.k + ' ' + x.w);
      const tile = (k) => pop.tiles.find(x => key(x.t) === k) || { k: 'missing', w: '' };
      if (tile('A15').w) bad.push('the report marks the load 15 min past its time ' + tile('A15').w);
      if (tile('B45').k !== 'caution' || tile('B45').w !== 'LATE') bad.push('the report tile for 45 min past is ' + tile('B45').k + ' ' + tile('B45').w + ' (should be yellow LATE)');
      if (tile('C90').k !== 'behind' || tile('C90').w !== 'LATE') bad.push('the report tile for 90 min past is ' + tile('C90').k + ' ' + tile('C90').w + ' (should be red LATE)');
      if (tile('D20').w) bad.push('the report marks the load loaded 20 min after its time ' + tile('D20').w + ' (on time within 30)');
      if (tile('E50').w !== 'LATE') bad.push('the report does not mark the load loaded 50 min after its time loaded late (' + tile('E50').w + ')');
      rec.reportOdd = oddTimes(pop.all);
      if (rec.reportOdd.length) bad.push('the plant report writes times as ' + rec.reportOdd.join(', '));
      await colorCheck(p, 'Plant report tiles', bad, rec);
      await shot(p, 'timing-report');
      await p.evaluate(() => { window.__mail = ''; new MutationObserver((ms) => ms.forEach(m => m.addedNodes.forEach(n => { if (n.tagName === 'IFRAME') { try { n.contentWindow.print = () => {}; } catch (e) { /* */ } setTimeout(() => { try { window.__mail = n.contentDocument.documentElement.outerHTML; } catch (e) { /* */ } }, 200); } }))).observe(document.body, { childList: true }); });
      await p.click('#print-report');
      await p.waitForFunction(() => window.__mail, null, { timeout: 10000 }).catch(() => {});
      const mail = await p.evaluate(() => window.__mail || '');
      if (!mail) bad.push('the shift report email could not be read from Print');
      else {
        const mp = await newPage({ viewport: { width: 600, height: 900 }, timingMailLook: true });
        try {
          await mp.setContent(mail.replace(/<script[\s\S]*?<\/script>/gi, ''));
          const grid = await mp.evaluate(() => [...document.querySelectorAll('tr')].filter(tr => tr.children.length === 4 && !tr.querySelector('table')).map(tr => { const c = [...tr.children]; return { cells: c.map(td => td.textContent.replace(/\s+/g, ' ').trim()), bg: c[0].style.backgroundColor || c[0].style.background, red: /180, 35, 24|#b42318/i.test(c.map(td => td.innerHTML + td.style.cssText).join('')) }; }));
          const mine = grid.filter(g => /Timept/i.test(g.cells[1] || ''));
          rec.mailRows = mine.map(g => g.cells.join(' | ') + ' · ' + g.bg);
          const row = (k) => mine.find(g => key(g.cells[1]) === k) || { cells: [], bg: 'missing' };
          if (/LATE/.test(row('A15').cells.join(' '))) bad.push('the email marks the load 15 min past its time LATE: ' + row('A15').cells.join(' | '));
          if (!/LATE/.test(row('B45').cells.join(' ')) || !/LATE/.test(row('C90').cells.join(' '))) bad.push('the email does not mark the 45 and 90 min loads LATE: ' + rec.mailRows.join(' / '));
          if (row('B45').bg === row('C90').bg) bad.push('the email shows the 45 min load (yellow) and the 90 min load (red) in the same colour ' + row('B45').bg);
          if (/late/i.test(row('D20').cells.join(' '))) bad.push('the email says the load loaded 20 min after its time was late');
          if (!/late/.test(row('E50').cells.join(' '))) bad.push('the email does not say the load loaded 50 min after its time was late: ' + row('E50').cells.join(' | '));
          const mt = await mp.evaluate(() => document.body.innerText);
          rec.mailOdd = oddTimes(mt);
          if (rec.mailOdd.length) bad.push('the email writes times as ' + rec.mailOdd.join(', '));
          await shot(mp, 'timing-email');
        } finally { await mp.done(); }
      }
      if (p.w.calls.some(c => /send/i.test((c.op || '') + c.fn))) bad.push('looking at the report sent something');
      // The Loading Rundown (Case, today).
      await open(p, 'reports.html?view=rundown&date=' + operatingDay() + '&area=CASE');
      await p.waitForFunction(() => /Loading Rundown/.test(document.getElementById('title').textContent) && !/Reading/.test(document.getElementById('body').textContent), null, { timeout: 40000 }).catch(() => {});
      await p.waitForTimeout(1500);
      const rd = await p.evaluate(() => ({ rows: [...document.querySelectorAll('#body tr')].filter(r => /TIMEPT/i.test(r.textContent)).map(r => r.textContent.replace(/\s+/g, ' ').trim().slice(0, 140)), all: document.getElementById('body').innerText }));
      rec.rundown = rd.rows;
      if (rd.rows.filter(x => /D20|E50/.test(x)).length < 2) bad.push('the Loading Rundown does not list the two test loads loaded today (' + rd.rows.length + ' rows)');
      await colorCheck(p, 'Loading Rundown', bad, rec);
      rec.rundownOdd = oddTimes(rd.all);
      if (rec.rundownOdd.length) bad.push('the Loading Rundown writes times as ' + rec.rundownOdd.join(', '));
      // The sales app route list (statuses only; no driver names written down).
      const ph = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, timingSalesLook: true });
      try {
        await ph.goto(SITE + '/sales.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await ph.waitForSelector('[data-go="routes"]', { timeout: 40000 });
        await ph.click('[data-go="routes"]');
        await ph.waitForSelector('.sa-row, .sa-empty', { timeout: 40000 }).catch(() => {});
        await ph.waitForTimeout(1500);
        const sa = await ph.evaluate((ids) => [...document.querySelectorAll('.sa-row')].map(r => ({ id: r.dataset.id, st: ((r.querySelector('.sa-l1') || r).textContent || '').replace((r.querySelector('.sa-route') || {}).textContent || '', '').replace(/\s+/g, ' ').trim(), cls: r.className })), Object.values(idOf));
        const st = (k) => (sa.find(x => x.id === idOf[k]) || { st: 'missing' }).st;
        rec.sales = Object.fromEntries(Object.keys(idOf).map(k => [k.slice(7), st(k)]));
        const want = { 'TIMEPT A15': /^Not loaded$/, 'TIMEPT B45': /^Not loaded, 4\d min behind$/, 'TIMEPT C90': /^Not loaded, 1 hr( \d+ min)? behind$/, 'TIMEPT D20': /^Loaded$/, 'TIMEPT E50': /^Not departed, 5\d min behind$/ };
        Object.keys(want).forEach(k => { if (!want[k].test(st(k))) bad.push('the sales app says "' + st(k) + '" for ' + k.slice(7)); });
        await colorCheck(ph, 'Sales app route list', bad, rec);
        rec.salesOdd = oddTimes(sa.map(x => x.st).join(' \n '));
        if (rec.salesOdd.length) bad.push('the sales app writes times as ' + rec.salesOdd.join(', '));
        if (ph.w.errors.length) bad.push('sales app page errors: ' + ph.w.errors.slice(0, 2).join(' | '));
      } finally { await ph.done(); }
      if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    } finally { await t.remove(); rec.removed = true; }
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.84 (#621): a trailer typed on the Scheduler's Save Load (Daily Boxing Loadout > + Add Load) goes through the one
  // trailer rule: 014 saves and shows as T-14. The test's own box load (its notes say it is the test's), deleted after.
  await write('Scheduler Save Load trailer 014 shows T-14 (6.84)', async (p, rec) => {
    const bad = [];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const NOTE = 'Practice copy test load (deleted by the test)';
    await open(p, 'loadout.html?area=BOXING');
    await p.waitForSelector('#rows tr[data-row], .empty, #rows', { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(2000);
    const edits = () => p.evaluate(() => [...document.querySelectorAll('#rows tr[data-row] [data-sedit]')].map(b => b.closest('tr').dataset.row));
    const had = await edits();
    let row = '';
    try {
      await p.click('#add-load');
      await p.waitForSelector('#sched-modal:not([hidden]) #s-route');
      await p.waitForFunction(() => [...document.querySelectorAll('#s-route option')].some(o => o.value !== ''), null, { timeout: 20000 }).catch(() => {});
      const pick = await p.$$eval('#s-route option', o => (o.find(x => x.value !== '') || {}).value);
      if (pick === undefined) throw new Error('Add Load offers no route / run');
      await p.selectOption('#s-route', pick);
      await p.selectOption('#s-kind', 'BOXING');
      await p.selectOption('#s-type', 'ROUTE');
      if (!(await p.inputValue('#s-time'))) await p.fill('#s-time', '1130p');
      await p.fill('#s-trailer', '014');
      await p.fill('#s-notes', NOTE);
      await p.click('#s-save');
      await p.waitForSelector('#sched-confirm-modal:not([hidden]) #sc-confirm', { timeout: 8000 }).catch(() => {});
      if (await p.$('#sched-confirm-modal:not([hidden]) #sc-confirm')) await p.click('#sc-confirm');
      for (let i = 0; i < 40 && !row; i++) { await p.waitForTimeout(500); row = (await edits()).find(x => !had.includes(x)) || ''; }
      if (!row) throw new Error('the added box load did not show');
      rec.row = row;
      await p.waitForTimeout(1500);
      // The row's trailer sits in a box you can type in, so read the boxes too.
      rec.shown = await p.evaluate(s => { const tr = document.querySelector(s); return (tr.innerText + ' ' + [...tr.querySelectorAll('input')].map(i => i.value).join(' ')).replace(/\s+/g, ' ').slice(0, 160); }, 'tr[data-row="' + row + '"]');
      const docs = (await db.collection('plantJournal').where('notes', '==', NOTE).get()).docs.map(d => d.data()).filter(x => String(x.status || '').toUpperCase() !== 'DELETED');
      rec.saved = docs.map(x => (x.payload || {}).trailer || x.trailer || '');
      // Which Equipment Master trailer a typed 14 matches (a matched unit keeps Equipment Master's own spelling).
      rec.equipment14 = (await db.collection('equipment').where('type', '==', 'TRAILER').get()).docs.map(d => d.data()).filter(e => /^T?\s*-?\s*0*14$/i.test(String(e.unit || '').trim())).map(e => e.unit + ' (' + (e.status || '') + ')');
      if (!rec.saved.includes('T-14')) bad.push('Save Load with trailer 014 saved "' + rec.saved.join(', ') + '" (should be T-14)');
      if (!/\bT-14\b/.test(rec.shown)) bad.push('the Boxing Loadout row shows ' + rec.shown);
      // The Edit Load box shows it as T-14 too.
      await p.click('tr[data-row="' + row + '"] [data-sedit]');
      await p.waitForSelector('#sched-modal:not([hidden])');
      rec.box = await p.inputValue('#s-trailer');
      if (rec.box !== 'T-14') bad.push('Edit Load shows the trailer as "' + rec.box + '"');
      await shot(p, 'scheduler-trailer');
    } finally {
      if (row) {
        if (!(await p.$('#sched-modal:not([hidden]) #s-delete:not([hidden])'))) { await p.click('tr[data-row="' + row + '"] [data-sedit]').catch(() => {}); await p.waitForSelector('#sched-modal:not([hidden]) #s-delete:not([hidden])', { timeout: 8000 }).catch(() => {}); }
        await p.click('#s-delete').catch(() => {});
        await p.waitForTimeout(400);
        await p.click('#s-delete').catch(() => {});
        await p.waitForTimeout(3000);
      }
      // Anything still left (a stopped step) goes the way the clean-up step takes it off.
      const left = (await db.collection('plantJournal').where('notes', '==', NOTE).get()).docs.map(d => Object.assign({ doc: d.id }, d.data())).filter(x => String(x.status || '').toUpperCase() !== 'DELETED');
      for (const x of left) await p.evaluate(([a, f]) => import('./js/app.js').then(m => m.save(a, f)), ['savePlantSchedule', { lane: 'SHIPPING', op: 'remove', id: x.recordId || x.doc, date: x.date }]).catch(() => {});
      rec.removed = left.length ? 'removed ' + left.length + ' left over' : 'deleted';
    }
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.84 (#621): the Route Editor's Default Trailer box shows a typed trailer by the one rule: 014 is T-14, TBA stays TBA. One
  // blank cell of the first route, put back to blank after.
  await write('Route Editor Default Trailer 014 and TBA (6.84)', async (p, rec) => {
    const bad = [];
    await open(p, 'routes.html');
    await p.selectOption('#view-select', 'trailer');
    await p.waitForTimeout(1200);
    // A cell an earlier run could not put back (its results are kept next to this run's): blank again first.
    try {
      const parent = path.dirname(path.resolve(OUT)), runs = fs.readdirSync(parent).filter(n => /^\d{8}-\d{4}$/.test(n) && path.join(parent, n) !== path.resolve(OUT)).sort();
      const last = runs.length ? JSON.parse(fs.readFileSync(path.join(parent, runs[runs.length - 1], 'results.json'), 'utf8')) : null;
      const was = last && (last.writes || []).find(x => x.name === 'Route Editor Default Trailer 014 and TBA (6.84)');
      if (was && /^still /.test(was.putBack || '') && was.cell) {
        const left = was.putBack.slice(6), day = was.cell.split(' ').pop(), route = was.cell.slice(0, -day.length - 1);
        const id = await p.evaluate(([rt, d, v]) => { const tr = [...document.querySelectorAll('table.routes tbody tr[data-id]')].find(x => x.children[0].textContent.trim() === rt); const i = tr && tr.querySelector('input.cell[data-day="' + d + '"]'); return i && i.value === v ? tr.dataset.id : ''; }, [route, day, left]);
        if (id) {
          const ls = 'tr[data-id="' + id + '"] input.cell[data-day="' + day + '"]';
          await p.click(ls); await p.keyboard.press('Control+A'); await p.keyboard.press('Delete');
          const t0 = Date.now(); await p.keyboard.press('Tab');
          for (let i = 0; i < 60 && !p.w.calls.some(c => c.fn === 'save' && c.at >= t0 && c.status); i++) await p.waitForTimeout(250);
          await open(p, 'routes.html'); await p.selectOption('#view-select', 'trailer'); await p.waitForTimeout(1500);
          rec.leftoverCleared = was.cell + ' (' + left + '): ' + ((await p.inputValue(ls)) === '' ? 'blank again' : 'still ' + (await p.inputValue(ls)));
          note('Route Editor: the cell an earlier run left at ' + left + ' (' + was.cell + ') was put back: ' + rec.leftoverCleared);
        }
      }
    } catch (e) { rec.leftoverCleared = 'could not: ' + String(e.message || e).slice(0, 120); }
    const cell = await p.evaluate(() => { const i = [...document.querySelectorAll('table.routes tbody tr[data-id] input.cell[data-day]')].find(x => !x.value && !x.disabled); return i ? { id: i.closest('tr').dataset.id, day: i.dataset.day, route: i.closest('tr').children[0].textContent.trim() } : null; });
    if (!cell) throw new Error('no blank Default Trailer cell on the Route Editor');
    rec.cell = cell.route + ' ' + cell.day;
    const sel = 'tr[data-id="' + cell.id + '"] input.cell[data-day="' + cell.day + '"]';
    const typeIn = async (v) => {
      await p.click(sel); await p.keyboard.press('Control+A'); if (v) await p.keyboard.type(v); else await p.keyboard.press('Delete');
      const t0 = Date.now(); await p.keyboard.press('Tab');
      for (let i = 0; i < 60 && !p.w.calls.some(c => c.fn === 'save' && c.at >= t0 && c.status); i++) await p.waitForTimeout(250);
      await p.waitForTimeout(800);
      const now = await p.inputValue(sel);
      await open(p, 'routes.html'); await p.selectOption('#view-select', 'trailer'); await p.waitForTimeout(1500);
      return { now, after: await p.inputValue(sel) };
    };
    rec.steps2 = [];
    try {
      for (const [typed, want] of [['014', 'T-14'], ['TBA', 'TBA']]) {
        const s = await typeIn(typed);
        rec.steps2.push(Object.assign({ typed }, s));
        if (s.now !== want) bad.push('the Route Editor shows a trailer typed "' + typed + '" as "' + s.now + '" (should be ' + want + ')');
        if (s.after !== want) bad.push('after a reload the Route Editor shows "' + s.after + '" for a trailer typed "' + typed + '"');
      }
    } finally {
      // Put back: tried up to three times (a save can be slow to land).
      let s = await typeIn('');
      for (let i = 0; i < 2 && s.after !== ''; i++) { await p.waitForTimeout(2000); s = await typeIn(''); }
      rec.putBack = s.after === '' ? 'blank again' : 'still ' + s.after;
      if (s.after !== '') bad.push('the Route Editor cell was not put back to blank (' + s.after + ')');
    }
    const failed = p.w.calls.filter(c => c.fn === 'save' && (c.status !== 200 || c.error));
    if (failed.length) bad.push('a save answered ' + failed[0].status + ' ' + String(failed[0].error).slice(0, 120));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.84 (#618): on a Plant Station (a test Case Loadout station of the test's own), START LOADING and COMPLETE each register
  // once, even when the list redraws while the finger is down (another test load is changed in the middle of the tap). Two test
  // loads and the station are removed after.
  await write('Plant Station START LOADING and COMPLETE register once (6.84)', async (p, rec) => {
    const bad = [];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const adm = (op, f) => p.evaluate(([o, x]) => import('./js/app.js').then(m => m.callServer('admin', Object.assign({ op: o }, x))), [op, f]);
    await open(p, 'administration.html');
    const stName = 'Practice test Tap once';
    for (const o of ((await adm('stations', { kind: 'PLANT' })).stations || []).filter(x => x.name === stName)) await adm('stationRemove', { key: o.key });
    const t = await todayTestLoads(2, { offset: 0, leavesOn: 'Delivery Day', day: { loadType: 'CASE', dispatchTime: 1380, startTime: 1380 } });
    if (!t.made) throw new Error('no load on the practice copy to copy for the test');
    rec.made = t.made;
    const st = ((await adm('stationAdd', { kind: 'PLANT', type: 'CASE', facilityId: 'fac_uniontown', name: stName })).stations || []).find(x => x.name === stName);
    const tab = st ? await newPage({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, tapOnceLook: true }) : null;
    try {
      if (!st) throw new Error('could not add the test station');
      for (let i = 0; i < 2; i++) await db.collection('runs').doc(t.ids[i]).set({ run: 'TAPPT ' + (i + 1), coverageType: 'UNITED DAIRY' }, { merge: true });
      const code = (await adm('stationCode', { key: st.key })).code;
      await open(tab, 'plant-station.html');
      await tab.waitForSelector('#code-box input[name="code"]', { timeout: 30000 });
      await tab.fill('#code-box input[name="code"]', code);
      await tab.click('#code-box button[type="submit"]');
      await tab.waitForFunction(() => [...document.querySelectorAll('.sw-card')].some(c => /TAPPT 1/i.test(c.textContent)), null, { timeout: 45000 }).catch(() => {});
      const cardId = await tab.evaluate(() => { const c = [...document.querySelectorAll('.sw-card')].find(x => /TAPPT 1/i.test(x.textContent)); return c ? c.dataset.sw : ''; });
      if (!cardId) throw new Error('the test load is not on the Plant Station');
      const other = db.collection('runs').doc(t.ids[1]);
      const stateOf = async () => { const d = (await db.collection('runs').doc(t.ids[0]).get()).data() || {}; const k = Object.keys(d.days || {}).find(x => d.days[x] && d.days[x].runs); const day = k ? d.days[k] : {}; return { started: day.plantStartedAt || '', done: day.completeTime || '' }; };
      // One tap, held while the other test load changes (the list redraws under the finger).
      const tapHeld = async (act) => {
        const b = await tab.$('.sw-card[data-sw="' + cardId + '"] [data-act="' + act + '"]');
        if (!b) return { error: 'no ' + act + ' button' };
        const box = await b.boundingBox(), t0 = Date.now();
        await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await tab.mouse.down();
        await other.set({ plantTestNote: 'redraw ' + act + ' ' + t0 }, { merge: true });
        await tab.waitForTimeout(1200);
        await tab.mouse.up();
        for (let i = 0; i < 40 && !tab.w.calls.some(c => c.at >= t0 && c.op === 'savePlantLoad'); i++) await tab.waitForTimeout(250);
        await tab.waitForTimeout(2500);
        return { saves: tab.w.calls.filter(c => c.at >= t0 && c.op === 'savePlantLoad').length, state: await stateOf() };
      };
      rec.start = await tapHeld('start');
      if (rec.start.saves !== 1 || !rec.start.state.started) bad.push('START LOADING held through a redraw: ' + JSON.stringify(rec.start));
      await tab.waitForSelector('.sw-card[data-sw="' + cardId + '"] [data-act="complete"]', { timeout: 15000 }).catch(() => {});
      rec.complete = await tapHeld('complete');
      if (rec.complete.saves !== 1 || !rec.complete.state.done) bad.push('COMPLETE held through a redraw: ' + JSON.stringify(rec.complete));
      rec.shown = await tab.evaluate((id) => { const c = document.querySelector('.sw-card[data-sw="' + CSS.escape(id) + '"]'); return c ? (c.querySelector('.sw-state') || c).textContent.trim().slice(0, 40) : ''; }, cardId);
      if (!/COMPLETE/.test(rec.shown)) bad.push('the station card reads ' + rec.shown + ' after COMPLETE');
      await colorCheck(tab, 'Plant Station', bad, rec);
      await shot(tab, 'plant-station-tap-once');
      if (tab.w.errors.length) bad.push('page errors: ' + tab.w.errors.slice(0, 2).join(' | '));
      await tab.evaluate(k => { try { localStorage.removeItem(k); } catch (e) { /* none */ } }, 'udStationDevice').catch(() => {});
    } finally {
      if (tab) await tab.done();
      if (st) await adm('stationRemove', { key: st.key }).catch(e => bad.push('the test station was not removed: ' + String(e.message).slice(0, 80)));
      await t.remove(); rec.removed = true;
    }
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.88 (#645): the Case Loadout & Yard Services tablet. Its starter station is on Administration > Plant Station Codes. A
  // test station of the test's own (the starter is never removed) opens on the choice of Case Loadout or Yard Services, with
  // Back to the choice. Case Loadout: START LOADING and COMPLETE on a test load; the 2-at-a-time case limit counts it (one
  // started on the tablet, one on the office screen, a third refused). Yard Services: trailer 9999 on a test load, then blank
  // again. The help ? for the Plant Station opens its part, which tells about this tablet. Three test loads, removed after.
  await write('Plant Station Case Loadout & Yard Services tablet (6.88)', async (p, rec) => {
    const bad = [], NAMES = ['CYPT 1', 'CYPT 2', 'CYPT 3'];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const L = require(path.join(__dirname, '..', '..', 'src', 'logic.js'));
    const adm = (op, f) => p.evaluate(([o, x]) => import('./js/app.js').then(m => m.callServer('admin', Object.assign({ op: o }, x))), [op, f]);
    const save = (action, f) => p.evaluate(([a, x]) => import('./js/app.js').then(m => m.save(a, x)), [action, f]);
    // Plant Station Codes lists the starter.
    await open(p, 'administration.html?item=station-codes');
    await p.waitForSelector('#st-list .ap-item', { timeout: 30000 }).catch(() => {});
    rec.codes = await p.$$eval('#st-list .ap-item b', b => b.map(x => x.textContent.trim()));
    if (!rec.codes.includes('Case Loadout & Yard Services')) bad.push('Plant Station Codes lists ' + rec.codes.join(', ') + ' (no Case Loadout & Yard Services)');
    rec.types = await p.$$eval('#st-type option', o => o.map(x => x.textContent.trim())).catch(() => []);
    if (rec.types.length && !rec.types.includes('Case Loadout & Yard Services')) bad.push('+ Add Station has no Case Loadout & Yard Services type (' + rec.types.join(', ') + ')');
    await p.evaluate(() => document.querySelectorAll('#st-list .ap-item code, #st-list .ap-item .code, #st-list input').forEach(el => { if (el.tagName === 'INPUT') el.value = '•••'; else el.textContent = '•••'; }));
    await shot(p, 'case-yard-station-codes');
    const starters = ((await adm('stations', { kind: 'PLANT' })).stations || []).filter(x => x.type === 'CASE_YARD');
    rec.starters = starters.map(x => x.facilityId + ': ' + x.name);
    if (!starters.some(x => x.facilityId === 'fac_uniontown')) bad.push('no Case Loadout & Yard Services station for Uniontown');
    const stName = 'Practice test Case and Yard';
    for (const o of ((await adm('stations', { kind: 'PLANT' })).stations || []).filter(x => x.name === stName)) await adm('stationRemove', { key: o.key });
    const t = await todayTestLoads(3, { offset: 0, leavesOn: 'Delivery Day', day: { loadType: 'CASE', dispatchTime: 1380, startTime: 1380 } });
    if (!t.made) throw new Error('no load on the practice copy to copy for the test');
    rec.made = t.made;
    const st = ((await adm('stationAdd', { kind: 'PLANT', type: 'CASE_YARD', facilityId: 'fac_uniontown', name: stName })).stations || []).find(x => x.name === stName);
    const tab = st ? await newPage({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }) : null;
    try {
      if (!st) throw new Error('could not add the test station');
      for (let i = 0; i < 3; i++) await db.collection('runs').doc(t.ids[i]).set({ run: NAMES[i], coverageType: 'UNITED DAIRY' }, { merge: true });
      const dayOf = async (i) => { const d = (await db.collection('runs').doc(t.ids[i]).get()).data() || {}; const k = Object.keys(d.days || {}).find(x => d.days[x] && d.days[x].runs); return { prefix: k, day: k ? d.days[k] : {} }; };
      const code = (await adm('stationCode', { key: st.key })).code;
      await open(tab, 'plant-station.html');
      await tab.waitForSelector('#code-box input[name="code"]', { timeout: 30000 });
      await tab.fill('#code-box input[name="code"]', code);
      await tab.click('#code-box button[type="submit"]');
      await tab.waitForSelector('#tabs [data-part]', { timeout: 45000 }).catch(() => {});
      const choice = async () => ({ parts: await tab.$$eval('#tabs [data-part] b', b => b.map(x => x.textContent.trim())), back: await tab.isVisible('#ps-back') });
      rec.choice = await choice();
      if (rec.choice.parts.join('|') !== 'Case Loadout|Yard Services') bad.push('the tablet opens on ' + (rec.choice.parts.join(', ') || 'no choice') + ' (Case Loadout, Yard Services)');
      if (rec.choice.back) bad.push('Back shows on the choice itself');
      await shot(tab, 'case-yard-choice');
      // Case Loadout.
      await tab.click('[data-part="case"]');
      // All three test loads on the list (polled: the page draws the choice, then the part, then the loads).
      for (let i = 0; i < 90; i++) {
        const n = await tab.evaluate(() => ['CYPT 1', 'CYPT 2', 'CYPT 3'].filter(nm => [...document.querySelectorAll('.sw-card')].some(c => new RegExp(nm + '(?!\\d)').test(c.textContent))).length).catch(() => 0);
        if (n === 3) break;
        await tab.waitForTimeout(500);
      }
      rec.caseTitle = await tab.textContent('#title').catch(() => '');
      if (!/Case Loadout/.test(rec.caseTitle)) bad.push('Case Loadout opens titled ' + rec.caseTitle);
      if (!(await tab.isVisible('#ps-back'))) bad.push('no Back on Case Loadout');
      const card = (n) => tab.evaluate((nm) => { const c = [...document.querySelectorAll('.sw-card')].find(x => new RegExp(nm + '(?!\\d)').test(x.textContent)); return c ? c.dataset.sw : ''; }, n);
      const ids = [await card(NAMES[0]), await card(NAMES[1]), await card(NAMES[2])];
      if (ids.some(x => !x)) { rec.cards = await tab.$$eval('.sw-card', c => c.length); rec.tabText = await tab.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 300)); await shot(tab, 'case-yard-no-loads'); }
      if (ids.some(x => !x)) throw new Error('the test loads are not all on the tablet\'s Case Loadout (' + ids.map((x, i) => NAMES[i] + (x ? '' : ' missing')).join(', ') + ')');
      const loadingCards = () => tab.$$eval('.sw-card .sw-state', b => b.filter(x => /^LOADING/.test(x.textContent.trim())).length);
      rec.loadingBefore = await loadingCards();
      const tap = async (id, act) => { const b = await tab.$('.sw-card[data-sw="' + id + '"] [data-act="' + act + '"]'); if (!b) return false; await b.click(); return true; };
      const until = async (fn, ms) => { for (let i = 0; i < ms / 500; i++) { if (await fn()) return true; await tab.waitForTimeout(500); } return false; };
      if (!(await tap(ids[0], 'start'))) bad.push('no START LOADING on ' + NAMES[0]);
      rec.started1 = await until(async () => !!(await dayOf(0)).day.plantStartedAt, 15000);
      if (!rec.started1) bad.push('START LOADING on the tablet did not save');
      // 6.90 (#655): the tablet refreshes by itself each minute with no reload, and what is typed (not yet saved) stays.
      await tab.waitForSelector('.sw-card[data-sw="' + ids[0] + '"] [data-k="notes"]', { timeout: 15000 }).catch(() => {});
      const noteBox = '.sw-card[data-sw="' + ids[0] + '"] [data-k="notes"]';
      if (await tab.$(noteBox)) {
        await tab.fill(noteBox, 'PRACTICE TEST NOTE TYPED');
        await tab.click('#title');
        await tab.evaluate(() => { window.__sameLoad = 1; });
        const f0 = await tab.evaluate(() => (window.UDReads || {}).freshAt || 0);
        rec.freshMoved = await tab.waitForFunction((t) => ((window.UDReads || {}).freshAt || 0) > t + 30000, f0, { timeout: 80000 }).then(() => true, () => false);
        if (!rec.freshMoved) bad.push('Last refreshed did not move by itself within a minute on the tablet');
        await tab.waitForTimeout(2000);
        rec.sameLoad = await tab.evaluate(() => window.__sameLoad === 1);
        if (!rec.sameLoad) bad.push('the tablet reloaded the page (it should refresh without a reload)');
        rec.typedKept = await tab.$eval(noteBox, e => e.value).catch(() => '');
        if (rec.typedKept !== 'PRACTICE TEST NOTE TYPED') bad.push('the note typed on the tablet was lost after the refresh (' + rec.typedKept + ')');
      } else bad.push('no Notes box on the started load to type in');
      // The limit: one more started on the office screen, then a third on the tablet is refused.
      if (rec.loadingBefore) note('Case Loadout & Yard Services: ' + rec.loadingBefore + ' case loads were already loading on the practice copy, so the 2-at-a-time limit was not tried');
      else {
        const d2 = await dayOf(1);
        rec.office = await save('savePlantLoad', { runDocId: t.ids[1], day: d2.prefix, fields: { startedAt: new Date().toISOString(), completedAt: '' } }).then(() => 'saved', e => 'refused: ' + String(e.message || e).slice(0, 120));
        if (rec.office !== 'saved') bad.push('starting the second case load on the office screen: ' + rec.office);
        const tOffice = Date.now();
        await tab.waitForFunction((id) => { const c = document.querySelector('.sw-card[data-sw="' + CSS.escape(id) + '"] .sw-state'); return c && /^LOADING/.test(c.textContent.trim()); }, ids[1], { timeout: 75000 }).then(() => { rec.officeShownMs = Date.now() - tOffice; }, () => bad.push('the load started on the office screen did not show LOADING on the tablet within a minute'));
        const c0 = tab.w.calls.length;
        await tap(ids[2], 'start');
        await tab.waitForTimeout(2500);
        rec.limit = await tab.evaluate(() => document.body.innerText.match(/\d+ loads are already loading[^\n]*/) ? document.body.innerText.match(/\d+ loads are already loading[^\n]*/)[0] : '');
        rec.third = !!(await dayOf(2)).day.plantStartedAt;
        if (rec.third) bad.push('a third case load started with two loading (the limit did not count the Case Loadout & Yard Services tablet)');
        if (!/^2 loads are already loading/.test(rec.limit)) bad.push('the third START LOADING says "' + rec.limit + '" (2 loads are already loading...)');
        rec.thirdSaves = tab.w.calls.slice(c0).filter(c => c.op === 'savePlantLoad').length;
        await shot(tab, 'case-yard-limit');
        // The server refuses it too (not only the tablet).
        const d3 = await dayOf(2);
        rec.server = await save('savePlantLoad', { runDocId: t.ids[2], day: d3.prefix, fields: { startedAt: new Date().toISOString(), completedAt: '' } }).then(() => 'saved', e => String(e.message || e).slice(0, 120));
        if (!/already loading/.test(rec.server)) bad.push('the server let a third case load start: ' + rec.server);
        if (rec.server === 'saved') await save('savePlantLoad', { runDocId: t.ids[2], day: d3.prefix, fields: { startedAt: '', completedAt: '' } }).catch(() => {});
      }
      await tab.waitForSelector('.sw-card[data-sw="' + ids[0] + '"] [data-act="complete"]', { timeout: 15000 }).catch(() => {});
      if (!(await tap(ids[0], 'complete'))) bad.push('no COMPLETE on ' + NAMES[0]);
      else {
        rec.done1 = await until(async () => !!(await dayOf(0)).day.completeTime, 15000);
        if (!rec.done1) bad.push('COMPLETE on the tablet did not save');
      }
      await colorCheck(tab, 'Case Loadout & Yard Services', bad, rec);
      await shot(tab, 'case-yard-case-loadout');
      await tab.click('#ps-back');
      rec.back1 = await tab.waitForSelector('#tabs [data-part]', { timeout: 10000 }).then(() => true, () => false);
      if (!rec.back1) bad.push('Back on Case Loadout did not come back to the choice');
      // Yard Services: Assign Trailer 9999 on CYPT 3, then blank again.
      await tab.click('[data-part="yard"]');
      await tab.waitForSelector('#tabs [data-view="trailers"]', { timeout: 15000 }).catch(() => {});
      rec.yardTabs = await tab.$$eval('#tabs [data-view]', b => b.map(x => x.dataset.view));
      if (rec.yardTabs.join('|') !== 'trailers|yardchecks') bad.push('Yard Services has the tabs ' + rec.yardTabs.join(', '));
      rec.yardTitle = await tab.textContent('#title').catch(() => '');
      if (rec.yardTitle !== 'Yard Services') bad.push('Yard Services opens titled ' + rec.yardTitle);
      await tab.click('#tabs [data-view="trailers"]').catch(() => {});
      await tab.waitForSelector('#work iframe.sw-frame', { timeout: 20000 });
      const fr = await (await tab.$('#work iframe.sw-frame')).contentFrame();
      const boxOf = '[data-trailer="' + await fr.waitForFunction(() => { const r = [...document.querySelectorAll('.ta-row')].find(x => /CYPT 3/.test(x.textContent)); return r ? r.dataset.row : ''; }, null, { timeout: 30000 }).then(h => h.jsonValue()).catch(() => '') + '"]';
      if (boxOf === '[data-trailer=""]') bad.push('CYPT 3 is not on the tablet\'s Assign Trailer');
      else {
        const typeT = async (v) => { await fr.click(boxOf); await fr.fill(boxOf, v); await fr.press(boxOf, 'Tab'); };
        await typeT('9999');
        rec.trailerSaved = await until(async () => /^T?-?9999$/.test(String((await dayOf(2)).day.trailer || '')), 15000) ? (await dayOf(2)).day.trailer : (await dayOf(2)).day.trailer || '';
        if (!/9999/.test(rec.trailerSaved)) bad.push('trailer 9999 typed on Yard Services did not save (' + rec.trailerSaved + ')');
        await tab.waitForTimeout(1200);
        await shot(tab, 'case-yard-assign-trailer');
        await typeT('');
        rec.trailerBack = await until(async () => !(await dayOf(2)).day.trailer, 15000);
        if (!rec.trailerBack) bad.push('the trailer was not put back to blank');
      }
      await tab.click('#tabs [data-view="yardchecks"]').catch(() => {});
      await tab.waitForTimeout(2500);
      rec.yardChecks = await tab.$eval('#work iframe.sw-frame', f => f.dataset.src).catch(() => '');
      if (!/^yard\.html/.test(rec.yardChecks)) bad.push('Check Temperatures opens ' + rec.yardChecks);
      await tab.click('#ps-back');
      rec.back2 = await choice().catch(() => ({}));
      if ((rec.back2.parts || []).join('|') !== 'Case Loadout|Yard Services') bad.push('Back on Yard Services did not come back to the choice');
      for (const gone of ['#go-back', '#go-home', '#go-admin', '#go-help', '.sidemenu']) if (await tab.isVisible(gone)) bad.push(gone + ' shows on the station');
      if (tab.w.errors.length) bad.push('tablet page errors: ' + tab.w.errors.slice(0, 2).join(' | '));
      await tab.evaluate(k => { try { localStorage.removeItem(k); } catch (e) { /* none */ } }, 'udStationDevice').catch(() => {});
    } finally {
      if (tab) await tab.done();
      if (st) await adm('stationRemove', { key: st.key }).catch(e => bad.push('the test station was not removed: ' + String(e.message).slice(0, 80)));
      await t.remove(); rec.removed = true;
    }
    // The help ? for the Plant Station opens its part, with this tablet in it.
    await open(p, 'plant-station.html');
    const href = await p.evaluate(() => import('./js/help.js').then(m => m.helpHref({ pathname: '/plant-station.html', search: '' })));
    rec.helpHref = href;
    await open(p, href.replace(/^\//, ''));
    await p.waitForSelector('#help-read .help-title', { timeout: 20000 }).catch(() => {});
    rec.help = await p.evaluate(() => ({ title: ((document.querySelector('#help-read .help-title') || {}).textContent || '').trim(), words: /Case Loadout & Yard Services tablet/.test((document.getElementById('help-read') || {}).textContent || '') }));
    if (!/Plant Station/i.test(rec.help.title)) bad.push('the Plant Station help opens on ' + rec.help.title);
    if (!rec.help.words) bad.push('the Plant Station help has no Case Loadout & Yard Services tablet part');
    await shot(p, 'case-yard-help');
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.89 (#652, look only): the shift report email has a DOWNTIME line right under the recap box: one short red line per
  // breakdown open or fixed since the last report (DOWN ...: what broke, then STILL DOWN SINCE / BACK UP / RUNNING, BEING
  // WATCHED), or a green NO DOWNTIME; Plant breakdowns reads NONE OPEN in green when none is open. Read from Print (printing
  // stopped); nothing is sent. The practice copy's own breakdowns on Shift Notes are what it shows.
  await write('Shift report email DOWNTIME line (6.89, look only)', async (p, rec) => {
    const bad = [];
    await open(p, 'manager.html?report=1');
    await p.waitForFunction(() => /\d/.test((document.getElementById('rp-body') || {}).textContent || ''), null, { timeout: 30000 });
    await p.waitForTimeout(1500);
    const c0 = p.w.calls.length;
    await p.evaluate(() => { window.__mail = ''; new MutationObserver((ms) => ms.forEach(m => m.addedNodes.forEach(n => { if (n.tagName === 'IFRAME') { try { n.contentWindow.print = () => {}; } catch (e) { /* */ } setTimeout(() => { try { window.__mail = n.contentDocument.documentElement.outerHTML; } catch (e) { /* */ } }, 200); } }))).observe(document.body, { childList: true }); });
    await p.click('#print-report');
    await p.waitForFunction(() => window.__mail, null, { timeout: 10000 }).catch(() => {});
    const mail = await p.evaluate(() => window.__mail || '');
    if (!mail) throw new Error('the shift report email could not be read from Print');
    const mp = await newPage({ viewport: { width: 600, height: 900 }, mailLook: true });
    try {
      await mp.setContent(mail.replace(/<script[\s\S]*?<\/script>/gi, ''));
      rec.mail = await mp.evaluate(() => {
        const rgb = (c) => { const m = String(c).match(/\d+/g); return m ? '#' + m.slice(0, 3).map(x => (+x).toString(16).padStart(2, '0')).join('') : c; };
        const divs = [...document.querySelectorAll('div')].filter(d => /^(DOWN\b|✓ NO DOWNTIME)/.test(d.textContent.trim()) && !d.parentElement.closest('div[style*="border-left"]'));
        const text = document.body.innerText;
        const at = (re) => { const m = text.search(re); return m; };
        return { lines: divs.map(d => ({ text: d.firstChild.textContent.trim(), state: d.querySelector('div') ? d.querySelector('div').textContent.trim() : '', color: rgb(getComputedStyle(d).color), stateColor: d.querySelector('div') ? rgb(getComputedStyle(d.querySelector('div')).color) : '', size: parseFloat(getComputedStyle(d).fontSize) })),
          recapAt: at(/\d+ of \d+ loaded/i), downAt: at(/DOWN\b|NO DOWNTIME/), breakAt: at(/PLANT BREAKDOWNS/i), noneOpen: /✓ NONE OPEN/.test(text), breakdowns: (text.match(/PLANT BREAKDOWNS\s*(\d+)/i) || [])[1] || '' };
      });
      const m = rec.mail;
      if (!m.lines.length) bad.push('the email has no DOWNTIME line (no DOWN ... lines and no NO DOWNTIME)');
      // Right under the loadout status box ("0 of 3 loaded"): after it, before Routes and Plant breakdowns.
      rec.routesAt = await mp.evaluate(() => document.body.innerText.search(/(^|\n)\s*ROUTES\s*(\n|$)/i));
      if (m.lines.length && !(m.recapAt >= 0 && m.downAt > m.recapAt && (rec.routesAt < 0 || m.downAt < rec.routesAt) && (m.breakAt < 0 || m.downAt < m.breakAt))) bad.push('the DOWNTIME line is not right under the loadout status box (status at ' + m.recapAt + ', downtime at ' + m.downAt + ', routes at ' + rec.routesAt + ', breakdowns at ' + m.breakAt + ')');
      const none = m.lines.filter(x => /NO DOWNTIME/.test(x.text)), down = m.lines.filter(x => /^DOWN\b/.test(x.text));
      if (none.length && down.length) bad.push('the email says both NO DOWNTIME and DOWN');
      if (none.some(x => x.color !== '#1f7a4d')) bad.push('NO DOWNTIME is not green (' + none.map(x => x.color).join(', ') + ')');
      for (const x of down) {
        if (x.color !== '#b42318') bad.push('a DOWNTIME line is not red: ' + x.color);
        if (x.text !== x.text.toUpperCase()) bad.push('a DOWNTIME line is not in capitals');
        if (!/^(STILL DOWN( SINCE \d{1,2}:\d\d [AP]M)?|BACK UP( \d{1,2}:\d\d [AP]M)?|RUNNING, BEING WATCHED)$/.test(x.state)) bad.push('a DOWNTIME line ends "' + x.state + '"');
        if (x.size < 16) bad.push('a DOWNTIME line is ' + x.size + 'px');
        if (/\d{1,2}:\d\d(?! [AP]M)/.test(x.text + ' ' + x.state)) bad.push('a DOWNTIME time is not written like 4:30 PM: ' + x.text + ' ' + x.state);
      }
      rec.downtime = m.lines.map(x => x.text.replace(/:.*/, ': …') + ' (' + x.state + ')');
      if (m.breakdowns === '0' && !m.noneOpen) bad.push('Plant breakdowns 0 does not read NONE OPEN in green');
      if (m.breakdowns !== '0' && m.noneOpen) bad.push('Plant breakdowns says NONE OPEN with ' + m.breakdowns + ' open');
      if (/\b(DOWN|BACK UP)\b/.test((m.lines[0] || {}).text || '') === false && !none.length) bad.push('the DOWNTIME lines read ' + JSON.stringify(m.lines).slice(0, 200));
      await mp.evaluate(() => window.scrollTo(0, 0));
      await shot(mp, 'shift-report-downtime-email');
    } finally { await mp.done(); }
    if (p.w.calls.slice(c0).some(c => c.fn === 'save' || /send|mail/i.test(c.op || '') || c.fn === 'mail')) bad.push('Print sent or saved something: ' + p.w.calls.slice(c0).map(c => c.fn + ':' + c.op).join(', '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.89 (#648, look only; 6.91 #657: 14 columns, License number and License state at the end): GPS Setup's Download driver usernames: the card, then the download (read only: the practice copy's
  // Fleet login asks Verizon). Only the file's name, its column names and how many lines are kept; no names, usernames or
  // numbers are written down, and the file is deleted.
  await write('GPS Setup Download driver usernames (6.89, look only)', async (p, rec) => {
    const bad = [];
    await open(p, 'gps.html');
    await p.waitForSelector('#drivers', { timeout: 30000 });
    rec.card = await p.evaluate(() => { const b = document.getElementById('drivers'), c = b.closest('.gps-card'); return { head: (c.querySelector('h2') || {}).textContent || '', button: b.textContent.trim(), disabled: b.disabled, title: b.title || '' }; });
    if (!/Driver usernames/.test(rec.card.head)) bad.push('the card is called ' + rec.card.head);
    if (rec.card.button !== 'Download driver usernames') bad.push('the button reads ' + rec.card.button);
    const c0 = p.w.calls.length, t0 = Date.now();
    if (rec.card.disabled) bad.push('Download driver usernames is greyed' + (rec.card.title ? ' (' + rec.card.title + ')' : ' and does not say why'));
    else {
      const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 200000 }).catch(() => null), p.click('#drivers')]);
      rec.ms = Date.now() - t0;
      rec.words = await p.textContent('#drivers-when').catch(() => '');
      rec.words = rec.words.replace(/\d+/g, 'N');
      const err = await p.evaluate(() => { const e = document.getElementById('error'); return e && !e.hidden ? e.textContent.slice(0, 200) : ''; });
      if (!dl) bad.push('no file came down within 200 s' + (err ? ': ' + err : '') + ' (' + rec.words + ')');
      else {
        rec.file = dl.suggestedFilename();
        if (!/^verizon-driver-usernames-\d{4}-\d{2}-\d{2}\.csv$/.test(rec.file)) bad.push('the file is called ' + rec.file);
        const fp = await dl.path();
        const text = fp ? fs.readFileSync(fp, 'utf8') : '';
        const lines = text.replace(/^﻿/, '').split(/\r\n/).filter(Boolean);
        rec.columns = (lines[0] || '').split(',');
        rec.rows = lines.length - 1;
        if (rec.columns.join('|') !== 'Employee number|Last name|First name|Middle name|Nickname|Depot|Verizon username|Login name|Login disabled|Last login|Hire date|Leave date|License number|License state') bad.push('the columns read ' + rec.columns.join(', '));
        if (!rec.rows) bad.push('the file has no drivers');
        if (!/^Downloaded N drivers, N with a Verizon username\.$/.test(rec.words)) bad.push('the card says "' + rec.words + '"');
        await dl.delete().catch(() => {});
        rec.deleted = true;
      }
    }
    const calls = p.w.calls.slice(c0);
    rec.calls = calls.map(c => c.fn + ':' + c.op);
    if (calls.some(c => c.fn === 'save' || (c.fn === 'gps' && c.op && c.op !== 'drivers' && c.op !== 'status'))) bad.push('the download made other calls: ' + rec.calls.join(', '));
    // A refused call (its answer is an error); the status it sends back can carry the trip history's own last error, kept as a note.
    const failed = calls.filter(c => c.status !== 200 || /^\{"error"/.test(c.error || ''));
    if (failed.length) bad.push('a call answered ' + failed[0].status + ' ' + String(failed[0].error).slice(0, 150));
    const hist = calls.map(c => (String(c.error || '').match(/"history":\{[^}]*"error":"([^"]{1,120})/) || [])[1]).filter(Boolean)[0];
    if (hist) note('GPS Setup: the trip history reports its own last error: ' + hist);
    await shot(p, 'gps-driver-usernames');
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.89 (#649): Pallet Builder (Plant Distribution Departments in the menu) opens with the builder in its frame and no Truck
  // pallet spots step; a test route of its own (in this browser only) with Joe's case counts: 8 of the 46 oz ricotta (4 a case),
  // 30 butter quarters (15 a case) and 16 Mini Moo 6-packs (8 a case) make 2 cases each, 6 in all; it builds a pallet; then the
  // test route is deleted. The help ? opens the Pallet Builder part. Phone width does not scroll sideways.
  // 11-7-26: the practice copy now has a Hub Daily BOL (Friday 11-6-26) whose routes have no built-in route lists, so this step
  // runs on a page of its own that is told there is no Hub BOL: the builder uses its built-in BOL (as on a computer with no Hub
  // BOL). The Hub BOL itself is checked on the Pallet Builder BOL step.
  await write('Pallet Builder case counts and a pallet (6.89)', async (p0, rec) => {
    const p = await newPage({ viewport: { width: 1536, height: 790 } });
    await p.addInitScript(() => { Object.defineProperty(window, 'udBol', { configurable: true, get: () => null, set: () => {} }); Object.defineProperty(window, 'udBolDays', { configurable: true, get: () => [], set: () => {} }); });
    try {
    const bad = [];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    await open(p, 'pallet-builder.html');
    await p.waitForSelector('#screen:not([hidden]) #builder', { timeout: 30000 });
    const fr = p.frameLocator('#builder');
    await fr.locator('#dayTable tr').first().waitFor({ timeout: 30000 });
    rec.h1 = (await p.textContent('.head h1').catch(() => '')).trim();
    if (rec.h1 !== 'Pallet Builder') bad.push('the screen is called ' + rec.h1);
    rec.menu = await p.$$eval('a[href^="pallet-builder.html"]', a => a.length);
    if (!rec.menu) bad.push('Pallet Builder is not in the menu');
    rec.spots = (await fr.locator('label[for="spots"]').count()) + (await fr.getByText('Truck pallet spots').count());
    if (rec.spots) bad.push('the Truck pallet spots step is still there');
    const before = await fr.locator('#routePick option').count();
    await fr.locator('details.more').evaluate(d => { d.open = true; }); await fr.locator('#newRoute').click();
    await fr.locator('#route').fill('PRACTICE TEST PALLET');
    await fr.locator('#route').dispatchEvent('input');
    await fr.locator('#route').dispatchEvent('change');
    if (!(await fr.locator('#stops .stop').count())) await fr.locator('#addStop').click();
    await fr.locator('#pasteWrap summary').click();
    await fr.locator('#pasteStop').selectOption('0');
    await fr.locator('#pasteBox').fill('2624 8\n41822 30\n1216 16');
    await fr.locator('#pasteGo').click();
    await p.waitForTimeout(800);
    rec.paste = (await fr.locator('#pasteMsg').textContent()).trim();
    // The order's items start hidden: read the words, not what shows.
    rec.sizes = await fr.locator('#stops .stop').first().locator('.sizes .row').evaluateAll(els => els.map(e => [...e.children].map(c => c.textContent).join(' ').replace(/\s+/g, ' ').trim()));
    const tot = rec.sizes.find(x => /case count/.test(x)) || '';
    if (!/\b6 cases$/.test(tot)) bad.push('8 ricotta 46 oz, 30 butter quarters and 16 Mini Moo 6-packs make "' + tot + '" (6 cases: 2 each)');
    // Joe's case counts: 46 oz ricotta 4 a case, butter quarters 15, Mini Moo 6-packs 8.
    for (const [w, upc] of [['46 oz', 4], ['1 lb', 15], ['Half Pint 6-pack', 8]]) { const r = rec.sizes.find(x => x.indexOf(w + ' · ') === 0); if (!r || !new RegExp(' of ' + upc + '\\b').test(r) || !/→ 2 cases/.test(r)) bad.push(w + ' reads ' + (r || 'nothing') + ' (should be ' + upc + ' a case, 2 cases)'); }
    rec.tiles = await fr.locator('#tiles .tile').allInnerTexts().then(a => a.map(x => x.replace(/\s+/g, ' ').trim()));
    if (!rec.tiles.length) bad.push('no route totals');
    rec.pallets = await fr.locator('#stopTable').textContent().then(t => t.replace(/\s+/g, ' ').slice(0, 200)).catch(() => '');
    if (!/pallet/i.test(rec.tiles.join(' ') + ' ' + rec.pallets)) bad.push('no pallets in the load plan');
    await shot(p, 'pallet-builder-test-route');
    // The test route is deleted (it lives only in this browser).
    await fr.locator('details.more').evaluate(d => { d.open = true; }); await fr.locator('#delRoute').click();
    await fr.locator('#delYes').click({ timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(500);
    rec.routesAfter = await fr.locator('#routePick option').allInnerTexts();
    if (rec.routesAfter.some(x => /PRACTICE TEST PALLET/.test(x))) bad.push('Delete route did not remove the test route');
    if (rec.routesAfter.length !== before) note('Pallet Builder: ' + before + ' routes before, ' + rec.routesAfter.length + ' after deleting the test route');
    // 6.91 (#661, #662, #664): the Truck load map on a copy of a BOL route that has load sequences with more than one customer.
    const fh = await (await p.$('#builder')).contentFrame();
    const pickAt = await fh.evaluate(() => DB.routes.findIndex(r => { const k = routeKey(r); return /11\/05(\/26)?\b/.test(r.route) && k && k.list.length && r.stops.some(st => st.sub) && r.stops.filter(st => !st.sub).length >= 3; }));
    rec.mapRoute = pickAt >= 0 ? await fh.evaluate(i => DB.routes[i].route, pickAt) : '';
    if (pickAt < 0) bad.push('no BOL route with a load sequence of more than one customer to test the Truck load map on');
    else {
      await fr.locator('#routePick').selectOption(String(pickAt));
      await p.waitForTimeout(400);
      const nBefore = await fh.evaluate(() => DB.routes.length);
      await fr.locator('details.more').evaluate(d => { d.open = true; }); await fr.locator('#dupRoute').click();
      await p.waitForTimeout(600);
      const cp = await fh.evaluate(() => ({ n: DB.routes.length, cur: DB.cur, name: S.route }));
      rec.copy = cp.name;
      if (cp.n !== nBefore + 1 || !/ copy$/.test(cp.name)) bad.push('Copy route did not make a test copy (' + cp.name + ')');
      else {
        // The map draws front to back door with a label under each pallet.
        const readMap = () => fh.evaluate(() => {
          const t = document.getElementById('truck'), labs = [...t.querySelectorAll('.plab')].map(x => x.textContent.trim());
          const side = { L: [], R: [] }; labs.forEach((l, i) => { const m = /Seq (\d+|–)/.exec(l); if (m) side[i % 2 ? 'R' : 'L'].push(m[1] === '–' ? null : +m[1]); });
          return { ends: [...t.querySelectorAll('.tend')].map(x => x.textContent.trim()), labs: labs.filter(Boolean), side,
            sides: S.stops.map(st => st.side || '') };
        });
        const sideRule = (m, why) => {
          if (m.sides.some(Boolean)) return;
          const L = m.side.L.filter(n => n), R = m.side.R.filter(n => n);
          if (L.some(n => n % 2 === 0) || R.some(n => n % 2)) bad.push(why + ': odd load sequences must load on the left and even on the right (left ' + L.join(',') + '; right ' + R.join(',') + ')');
          if (L.some((n, i) => i && n < L[i - 1]) || R.some((n, i) => i && n < R[i - 1])) bad.push(why + ': a side does not go front to back by load sequence (left ' + L.join(',') + '; right ' + R.join(',') + ')');
          if ([...L, ...R].includes(1) && L[0] !== 1) bad.push(why + ': load sequence 1 is not at the nose on the left (left starts ' + L[0] + ')');
        };
        let m = await readMap();
        rec.mapEnds = m.ends; rec.mapLabels = m.labs.length;
        if (m.ends[0] !== 'Front' || m.ends[m.ends.length - 1] !== 'Back door') bad.push('the Truck load map does not run Front to Back door (' + m.ends.join(', ') + ')');
        if (!m.labs.length || !m.labs.every(l => /^Pallet \d+ · Seq (\d+|–) · (\d+ cs|tote)$/.test(l))) bad.push('the Truck load map pallet labels read ' + m.labs.slice(0, 3).join(' | '));
        sideRule(m, 'BOL load sequence');
        // Every customer the route list has in each load sequence on this route shows in the table.
        const miss = await fh.evaluate(() => {
          const rk = routeKey(S), shown = [...document.querySelectorAll('#lmTable td.cn')].map(td => td.childNodes[0].textContent.trim());
          const seqs = new Set(S.stops.filter(st => !st.sub).map(stopSeq).filter(n => n));
          return { seqs: seqs.size, list: rk.list.filter(x => seqs.has(x[0])).length, sub: document.querySelectorAll('#lmTable tr.sub').length,
            miss: rk.list.filter(x => seqs.has(x[0]) && !shown.some(c => sameCust(c, x[2]))).map(x => 'seq ' + x[0]) };
        });
        rec.seqCustomers = { seqs: miss.seqs, list: miss.list, sub: miss.sub, missing: miss.miss.length };
        if (miss.miss.length) bad.push(miss.miss.length + ' route list customers do not show in their load sequence (' + miss.miss.slice(0, 5).join(', ') + ')');
        if (!miss.sub) bad.push('no plain customer rows under the BOL customers');
        // 6.91 (#665): pallets beside cases; a shared customer has a load sequence box but no Side or Note; pointing at a stop
        // lights up its pallets on the truck; the truck stays in view while the stop list scrolls.
        rec.look665 = await fh.evaluate(() => {
          const main = [...document.querySelectorAll('#lmTable tbody tr.main')], kids = [...document.querySelectorAll('#lmTable tbody tr.kid')];
          const cs = main.map(tr => (tr.querySelector('td.cs') || {}).textContent || '');
          const lm = document.querySelector('.lm-left');
          return { mains: main.length, csOk: cs.filter(t => /^\d[\d,]* cs · \d+ pallets?$/.test(t.trim())).length, csBad: cs.filter(t => !/^\d[\d,]* cs · \d+ pallets?$/.test(t.trim())).slice(0, 2),
            kids: kids.length, kidSeq: kids.filter(tr => tr.querySelector('input.lseq')).length, kidSideNote: kids.filter(tr => tr.querySelector('select.lside, input.lnote')).length,
            sticky: lm ? getComputedStyle(lm).position : '' };
        });
        const L5 = rec.look665;
        if (!L5.mains || L5.csOk !== L5.mains) bad.push('the stop list does not show pallets beside cases on every stop (' + L5.csBad.join(' | ') + ')');
        if (!L5.kids) bad.push('no shared customers indented under a BOL stop');
        else { if (L5.kidSeq !== L5.kids) bad.push((L5.kids - L5.kidSeq) + ' shared customers have no load sequence box'); if (L5.kidSideNote) bad.push(L5.kidSideNote + ' shared customers still have a Side or Note box'); }
        if (L5.sticky !== 'sticky') bad.push('the truck does not stay in view (' + L5.sticky + ')');
        // Point at the first stop with pallets.
        const lit = await fh.evaluate(() => { const tr = [...document.querySelectorAll('#lmTable tbody tr.main')].find(t => /· [1-9]\d* pallet/.test((t.querySelector('td.cs') || {}).textContent || '')); return tr ? tr.dataset.i : null; });
        if (lit == null) bad.push('no stop with a pallet to point at');
        else {
          await fr.locator('#lmTable tbody tr[data-i="' + lit + '"] td.cn').hover();
          await p.waitForTimeout(300);
          rec.lit = await fh.evaluate((i) => { const tr = document.querySelector('#lmTable tbody tr[data-i="' + i + '"]'), g = tr.dataset.g, t = document.getElementById('truck');
            const want = +(/· (\d+) pallet/.exec(tr.querySelector('td.cs').textContent) || [])[1];
            const hl = [...t.querySelectorAll('.hl')];
            return { on: t.classList.contains('lit'), rowLit: tr.classList.contains('hl'), cells: hl.filter(x => x.tagName === 'I').length, labels: hl.filter(x => x.tagName === 'SPAN').length, other: hl.filter(x => x.dataset.g !== g).length, want }; }, lit);
          if (!rec.lit.on || !rec.lit.cells || rec.lit.other || rec.lit.labels !== rec.lit.want) bad.push('pointing at a stop does not light up its pallets (' + JSON.stringify(rec.lit) + ')');
          await shot(p, 'pallet-builder-stop-lit');
          // Scroll the stop list to its end: the truck is still in view.
          rec.inView = await fh.evaluate(() => { const rows = document.querySelectorAll('#lmTable tbody tr'); rows[rows.length - 1].scrollIntoView({ block: 'end' });
            const t = document.getElementById('truck').getBoundingClientRect(); return { top: Math.round(t.top), h: innerHeight, scrolled: Math.round(scrollY) }; });
          if (rec.inView.top < 0 || rec.inView.top > rec.inView.h - 60) bad.push('the truck is out of view after scrolling the stop list (' + JSON.stringify(rec.inView) + ')');
          await p.mouse.move(2, 2);
        }
        // Merge: tick two BOL stops with different load sequences and press Merge checked stops.
        const two = await fh.evaluate(() => { const out = []; S.stops.forEach((st, i) => { if (!st.sub && stopSeq(st) && out.length < 2 && !out.some(j => stopSeq(S.stops[j]) === stopSeq(st))) out.push(i); }); return out; });
        if (two.length < 2) bad.push('fewer than two load sequences to merge');
        else {
          for (const i of two) await fr.locator('#lmTable input.lmPick[data-i="' + i + '"]').check();
          await fr.locator('#lmMerge').click();
          await p.waitForTimeout(400);
          rec.merge = (await fr.locator('#lmMsg').textContent()).trim();
          const seqs = await fh.evaluate(t => t.map(i => stopSeq(S.stops[i])), two);
          rec.mergeSeqs = seqs;
          if (!/^Merged 2 stops into load sequence \d+\.$/.test(rec.merge) || seqs[0] !== seqs[1]) bad.push('Merge checked stops: "' + rec.merge + '", load sequences now ' + seqs.join(' and '));
          const boxes = await fr.locator('#lmTable input.lseq').evaluateAll((els, t) => t.map(i => els.find(e => e.dataset.i === String(i)).value), two);
          if (boxes[0] !== boxes[1]) bad.push('after Merge the Load seq boxes read ' + boxes.join(' and '));
        }
        // Resequence: type 0 in the first BOL stop's box (across the front), then Load seq = run order, then Back to BOL.
        const first = two[0] != null ? two[0] : 0;
        const box = fr.locator('#lmTable input.lseq[data-i="' + first + '"]');
        await box.fill('0'); await box.dispatchEvent('change');
        await p.waitForTimeout(400);
        rec.typed0 = await fh.evaluate(i => stopSeq(S.stops[i]), first);
        m = await readMap();
        if (rec.typed0 !== 0) bad.push('typing 0 in Load seq left it at ' + rec.typed0);
        else if (!m.labs.some(l => /Seq 0 ·/.test(l))) bad.push('a stop typed to load sequence 0 has no pallet across the front');
        await fr.locator('#lmFromRun').click();
        await p.waitForTimeout(400);
        rec.fromRun = (await fr.locator('#lmMsg').textContent()).trim();
        const runOk = await fh.evaluate(() => S.stops.every((st, i) => stopSeq(st) === i + 1));
        if (rec.fromRun !== 'Load sequence now follows the run order.' || !runOk) bad.push('Load seq = run order: "' + rec.fromRun + '"' + (runOk ? '' : ', load sequences do not follow the run order'));
        m = await readMap();
        sideRule(m, 'run order');
        await shot(p, 'pallet-builder-load-map');
        await fr.locator('#lmFromBol').click();
        await p.waitForTimeout(400);
        rec.fromBol = (await fr.locator('#lmMsg').textContent()).trim();
        if (rec.fromBol !== 'Back to the load sequence from the BOL.') bad.push('Back to BOL load seq: "' + rec.fromBol + '"');
        // The test copy is deleted.
        await fr.locator('details.more').evaluate(d => { d.open = true; }); await fr.locator('#delRoute').click();
        await fr.locator('#delYes').click({ timeout: 5000 }).catch(() => {});
        await p.waitForTimeout(500);
        const left = await fh.evaluate(c => ({ n: DB.routes.length, has: DB.routes.some(r => r.route === c) }), cp.name);
        if (left.has || left.n !== nBefore) bad.push('Delete route did not remove the test copy');
      }
    }
    // 6.91 (#665): Save to route map, only on a route day of the test's own: route 9990, a copy of a real route day's stops
    // (the Customer List's udclRouteDays). The real route day is read before and after and must not change. The test route
    // day, its log rows and the builder copy are removed after. Print sequence changes fills its page; the printer is never used.
    const plant = await p.evaluate(() => import('./js/app.js').then(m => m.currentPlant()));
    const keys = await fh.evaluate(() => DB.routes.map((r, i) => { const k = routeKey(r); return k ? { i, name: r.route, route: k.route, day: k.day, seq: k.list.length, bol: r.stops.filter(st => !st.sub).length } : null; }).filter(Boolean));
    let real = null, use = null;
    for (const k of keys) { if (k.bol < 3 || !k.seq || !/11\/05(\/26)?\b/.test(k.name) || / copy$/.test(k.name)) continue; const d = await db.collection('udclRouteDays').doc(plant + '__' + k.route + '__' + k.day).get(); if (d.exists && (d.data().stops || []).length >= 3) { real = d; use = k; break; } }
    rec.routeMap = { plant, routeDays: keys.length, real: use ? use.route + ' ' + use.day : 'none' };
    if (!real) bad.push('no builder route has a route map in the Customer List to copy for the Save to route map test');
    else {
      const TEST = plant + '__9990__' + use.day, testRef = db.collection('udclRouteDays').doc(TEST);
      const realBefore = JSON.stringify(real.data());
      const testName = use.name.replace(use.route, '9990');
      const logs = async () => { const out = new Map(); for (const [f, v] of [['route', '9990'], ['routeDay', TEST], ['docId', TEST], ['id', TEST], ['route', 9990]]) {
        for (const x of (await db.collection('udclLog').where(f, '==', v).get().catch(() => ({ docs: [] }))).docs) out.set(x.id, x.ref); } return [...out.values()]; };
      const custBefore = new Set((await db.collection('udclCustomers').where('plant', '==', plant).get()).docs.map(d => d.id));
      try {
        const td = JSON.parse(realBefore); Object.keys(td).forEach(k => { if (td[k] === real.data().route) td[k] = '9990'; });
        Object.assign(td, { route: '9990', rev: 9990, updatedAt: '', updatedBy: '', testEdited: true, practiceTest: true });
        await testRef.set(td);
        await open(p, 'pallet-builder.html');
        await p.waitForSelector('#screen:not([hidden]) #builder', { timeout: 30000 });
        await fr.locator('#dayTable tr').first().waitFor({ timeout: 30000 });
        const fm = await (await p.$('#builder')).contentFrame();
        await fr.locator('#routePick').selectOption(String(use.i));
        await p.waitForTimeout(400);
        await fr.locator('details.more').evaluate(d => { d.open = true; }); await fr.locator('#dupRoute').click();
        await p.waitForTimeout(500);
        await fr.locator('#route').fill(testName);
        await fr.locator('#route').dispatchEvent('input');
        await fm.waitForFunction(() => !/^Getting/.test(document.getElementById('mapMsg').textContent), null, { timeout: 30000 }).catch(() => {});
        await p.waitForTimeout(500);
        const line = async () => (await fr.locator('#mapMsg').textContent()).trim();
        rec.mapOpen = { msg: (await line()).replace(/\d+-\d+-\d+ \d+:\d+ [AP]M/, 'DATE TIME'), disabled: await fr.locator('#lmSave').isDisabled(), route: await fm.evaluate(() => S.route) };
        if (rec.mapOpen.route !== testName) bad.push('the builder copy is named ' + rec.mapOpen.route);
        // 6.91 (#693): one SAVE sends it all: the line names what differs from the route map (load sequences, customers to add,
        // run order, truck load map), or SAME AS THE ROUTE MAP with SAVE greyed.
        else if (/^SAME AS THE ROUTE MAP\./.test(rec.mapOpen.msg) ? !rec.mapOpen.disabled : (!/PRESS SAVE TO SEND IT ALL TO THE CUSTOMER LIST\.$/.test(rec.mapOpen.msg) || rec.mapOpen.disabled)) bad.push('the test route opens with "' + rec.mapOpen.msg + '"' + (rec.mapOpen.disabled ? ' and SAVE greyed' : ''));
        else {
          const num = (m, re) => +((re.exec(m) || [])[1] || 0);
          const seq0 = num(rec.mapOpen.msg, /(\d+) LOAD SEQUENCES? CHANGED/), add0 = num(rec.mapOpen.msg, /(\d+) CUSTOMERS? TO ADD/);
          // Change one BOL customer's load sequence to one the route does not use.
          const ch = await fm.evaluate(() => { const c = seqChanges(), r = c.rows.find(x => !x.st.sub && x.e && x.n && !x.changed); if (!r) return null; const n = Math.max(...c.rows.map(x => x.n || 0)) + 1; return { i: r.i, n, key: r.e.key }; });
          if (!ch) bad.push('no BOL customer on the route map to change');
          else {
            const box = fr.locator('#lmTable input.lseq[data-i="' + ch.i + '"]');
            await box.fill(String(ch.n)); await box.dispatchEvent('change');
            await p.waitForTimeout(500);
            rec.mapChanged = { msg: (await line()).replace(/\d+-\d+-\d+ \d+:\d+ [AP]M/, 'DATE TIME'), disabled: await fr.locator('#lmSave').isDisabled() };
            if (num(rec.mapChanged.msg, /(\d+) LOAD SEQUENCES? CHANGED/) !== seq0 + 1 || num(rec.mapChanged.msg, /(\d+) CUSTOMERS? TO ADD/) !== add0 || rec.mapChanged.disabled) bad.push('after changing one load sequence the line reads "' + rec.mapChanged.msg + '"');
            // Print sequence changes: the page is filled; the printer is never used.
            await fm.evaluate(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
            await fr.locator('#lmPrint').click();
            await p.waitForTimeout(300);
            rec.print = await fm.evaluate((n) => { const s = document.getElementById('printSheet'); return { printed: window.__printed || 0, route: /Route:\s*9990/.test(s.textContent), day: /Day:\s*[A-Z][a-z]+day/.test(s.textContent),
              heads: [...s.querySelectorAll('th')].map(t => t.textContent.trim()).join('|'), chg: s.querySelectorAll('tr.chg').length, seq: [...s.querySelectorAll('td.n')].some(t => t.textContent.trim() === String(n)), rows: s.querySelectorAll('tbody tr').length,
              sign: /Changed by:/.test(s.textContent) && /Entered in office:/.test(s.textContent) }; }, ch.n);
            if (rec.print.printed !== 1 || !rec.print.route || !rec.print.day || rec.print.heads !== 'Chain|Account #|Customer|New sequence' || rec.print.chg < 1 || !rec.print.seq || !rec.print.sign) bad.push('Print sequence changes: ' + JSON.stringify(rec.print));
            // SAVE: only the test route day changes: every customer it had stays with its note, the changed one has its new load
            // sequence, the customers to add are added; a customer the Customer List did not have at all is added to it first
            // (removed again after the test).
            const tBefore = (await testRef.get()).data();
            await fr.locator('#lmSave').click();
            await fm.waitForFunction(() => /^Saved|could not|Try again|someone/i.test(document.getElementById('mapMsg').textContent), null, { timeout: 30000 }).catch(() => {});
            rec.mapSaved = (await line()).replace(/\d+-\d+-\d+ \d+:\d+ [AP]M/, 'DATE TIME');
            const tAfter = (await testRef.get()).data();
            const st0 = tBefore.stops || [], st1 = (tAfter && tAfter.stops) || [];
            rec.mapDoc = { rev: [tBefore.rev, tAfter && tAfter.rev], kept: st0.every(x => st1.some(y => y.key === x.key && (y.note || '') === (x.note || ''))), added: st1.length - st0.length, toAdd: add0,
              newSeq: (st1.find(x => x.key === ch.key) || {}).loadSeq, othersSame: seq0 ? 'not compared (' + seq0 + ' changed before)' : st0.every(x => x.key === ch.key || (+(st1.find(y => y.key === x.key) || {}).loadSeq || 0) === (+x.loadSeq || 0)), map: !!(tAfter && tAfter.map) };
            if (!/^SAVED: \d+ CUSTOMERS?, THEIR LOAD SEQUENCES AND RUN ORDER/.test(rec.mapSaved)) bad.push('SAVE TO ROUTE MAP answered "' + rec.mapSaved + '"');
            if (+rec.mapDoc.newSeq !== ch.n || !rec.mapDoc.kept || rec.mapDoc.othersSame === false || rec.mapDoc.added !== add0) bad.push('the test route day after SAVE reads ' + JSON.stringify(rec.mapDoc));
            if (/TRUCK LOAD MAP CHANGED/.test(rec.mapChanged.msg) && !rec.mapDoc.map) bad.push('SAVE did not keep the truck load map on the route day');
            await p.waitForTimeout(800);
            rec.afterSave = (await line()).replace(/\d+-\d+-\d+ \d+:\d+ [AP]M/, 'DATE TIME');
            await shot(p, 'pallet-builder-saved-to-route-map');
          }
        }
        // Delete the builder copy.
        if (await fm.evaluate((n) => S.route === n, testName)) { await fr.locator('details.more').evaluate(d => { d.open = true; }); await fr.locator('#delRoute').click(); await fr.locator('#delYes').click({ timeout: 5000 }).catch(() => {}); await p.waitForTimeout(500); }
        if (await fm.evaluate((n) => DB.routes.some(r => r.route === n), testName)) bad.push('the builder copy of the test route was not deleted');
      } finally {
        const lg = await logs(); rec.mapLogRows = lg.length; for (const ref of lg) await ref.delete();
        await testRef.delete();
        // A customer SAVE added to the Customer List for the test route only (it was on no list): taken off again.
        const madeCust = (await db.collection('udclCustomers').where('plant', '==', plant).get()).docs.filter(d => !custBefore.has(d.id));
        rec.customersAddedAndRemoved = madeCust.length;
        for (const d of madeCust) { for (const x of (await db.collection('udclLog').where('record', '==', d.id).get().catch(() => ({ docs: [] }))).docs) await x.ref.delete(); await d.ref.delete(); }
        rec.realUnchanged = JSON.stringify((await real.ref.get()).data()) === realBefore;
        if (!rec.realUnchanged) bad.push('the real route day ' + use.route + ' ' + use.day + ' changed during the test');
      }
    }
    // Help.
    await p.click('#go-help');
    await p.waitForSelector('#help-read .help-title', { timeout: 20000 }).catch(() => {});
    rec.help = (await p.textContent('#help-read .help-title').catch(() => '')).trim();
    if (rec.help !== 'Pallet Builder') bad.push('the help ? opens on ' + rec.help);
    rec.helpSpots = await p.evaluate(() => /Truck pallet spots/i.test((document.getElementById('help-read') || {}).textContent || ''));
    if (rec.helpSpots) bad.push('the help still has Truck pallet spots');
    // Phone.
    const ph = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    try {
      await open(ph, 'pallet-builder.html');
      await ph.waitForSelector('#screen:not([hidden]) #builder', { timeout: 30000 });
      await ph.frameLocator('#builder').locator('#dayTable tr').first().waitFor({ timeout: 30000 });
      rec.phoneSideways = await ph.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      if (rec.phoneSideways) bad.push('Pallet Builder scrolls sideways at 390');
      await shot(ph, 'pallet-builder-390');
    } finally { await ph.done(); }
    if (p.w.calls.some(c => c.fn === 'save')) bad.push('the Pallet Builder saved something on the server');
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
    } finally { await p.done(); }
  });
  // 6.91 (#669): Over the Road: no total row under Fuel Cost By Gallon (Avg stays); the one-time load otr-costing-2026-09 put
  // Joe's September 2026 numbers in otrMonthly/2026-09 and the Recap shows them; no other month was written by it. Recap
  // Import From Accounting reads a made-up accounting zip and shows what it found; Cancel, never Use These Numbers.
  await write('Over the Road September 2026 numbers and Fuel Cost By Gallon (6.91)', async (p, rec) => {
    const bad = [];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const WANT = { gallons_sold: 2509342, distribution_cost: 761362.15, employee_cost: 375996.13, fuel_cost: 177131 };
    const mark = (await db.collection('dataLoads').doc('otr-costing-2026-09').get()).data() || null;
    rec.load = mark ? { status: mark.status, doneAt: mark.doneAt, hadBefore: !!mark.before } : 'none';
    if (!mark || mark.status !== 'DONE') bad.push('the one-time load otr-costing-2026-09 has not run on the practice copy (' + JSON.stringify(rec.load) + ')');
    const sept = (await db.collection('otrMonthly').doc('2026-09').get()).data() || {};
    rec.sept = Object.fromEntries(Object.keys(WANT).map(k => [k, sept[k]]));
    Object.keys(WANT).forEach(k => { if (Math.abs((+sept[k] || 0) - WANT[k]) > 0.005) bad.push('otrMonthly 2026-09 ' + k + ' is ' + sept[k] + ' (should be ' + WANT[k] + ')'); });
    const all = (await db.collection('otrMonthly').get()).docs;
    rec.otherByLoad = all.filter(d => d.id !== '2026-09' && d.data().updatedBy === 'data-load@uniteddairy.com').map(d => d.id);
    if (rec.otherByLoad.length) bad.push('the one-time load also wrote ' + rec.otherByLoad.join(', '));
    const isoOf = (v) => (v && typeof v.toDate === 'function' ? v.toDate().toISOString() : String(v || ''));
    rec.otherSince = mark && mark.doneAt ? all.filter(d => d.id !== '2026-09' && isoOf(d.data().updatedAt) >= mark.doneAt).map(d => d.id) : [];
    if (rec.otherSince.length) {
      const ch = all.filter(d => rec.otherSince.includes(d.id)).map(d => d.data());
      rec.otherSinceWho = { months: ch.length, first: rec.otherSince[0], last: rec.otherSince[rec.otherSince.length - 1], times: [...new Set(ch.map(x => isoOf(x.updatedAt).slice(0, 16)))].slice(0, 5),
        sources: [...new Set(ch.map(x => String(x.source || '')))], by: [...new Set(ch.map(x => (String(x.updatedBy || '').split('@')[0] === 'data-load' ? 'data-load' : /@/.test(String(x.updatedBy || '')) ? 'a person or the app' : String(x.updatedBy || ''))))],
        fields: [...new Set(ch.flatMap(x => Object.keys(x)))].sort() };
      note('Over the Road: ' + ch.length + ' other months (' + rec.otherSince[0] + ' to ' + rec.otherSince[rec.otherSince.length - 1] + ') have an updatedAt after the September load: ' + JSON.stringify(rec.otherSinceWho));
    }
    const hub = (await db.collection('accountingMonthly').get().catch(() => ({ docs: [] }))).docs.map(d => d.data()).find(a => +a.year === 2026 && +a.month === 9) || null;
    rec.hubSept = hub ? Object.fromEntries(Object.keys(WANT).map(k => [k, hub[k]])) : null;
    const allBefore = JSON.stringify(all.map(d => [d.id, d.data()]));
    await open(p, 'otr.html');
    // Cost Per Gallon: Fuel Cost By Gallon ends with Avg, no total row.
    await p.click('[data-view="cpg"]');
    await p.waitForSelector('table.otr-fuel tbody tr', { timeout: 30000 });
    rec.fuel = await p.$$eval('table.otr-fuel tbody tr', t => t.map(x => (x.querySelector('td') || {}).textContent.trim()).slice(-3));
    if (rec.fuel[rec.fuel.length - 1] !== 'Avg') bad.push('Fuel Cost By Gallon ends with ' + rec.fuel.join(', '));
    if (rec.fuel.some(x => /^total$/i.test(x))) bad.push('Fuel Cost By Gallon still has a total row');
    await shot(p, 'otr-fuel-cost-by-gallon');
    // Recap: September 2026 shows the numbers.
    await p.click('[data-view="figures"]');
    await p.waitForSelector('input[data-fk="f|2026|9|gallons_sold"]', { timeout: 30000 }).catch(() => {});
    await p.waitForFunction(() => { const e = document.querySelector('input[data-fk="f|2026|9|gallons_sold"]'); return e && e.value; }, null, { timeout: 20000 }).catch(() => {});
    rec.recap = await p.evaluate((ks) => Object.fromEntries(ks.map(k => { const e = document.querySelector('input[data-fk="f|2026|9|' + k + '"]'); return [k, e ? e.value : null]; })), Object.keys(WANT));
    const shown = (v) => +String(v || '').replace(/[$,\s]/g, '');
    const want = hub || WANT;
    Object.keys(WANT).forEach(k => { if (want[k] != null && Math.abs(shown(rec.recap[k]) - +want[k]) > 0.5) bad.push('Recap September 2026 ' + k + ' shows ' + rec.recap[k] + ' (should be ' + want[k] + (hub ? ', the Hub\'s' : '') + ')'); });
    if (hub && Object.keys(WANT).some(k => hub[k] != null && Math.abs(+hub[k] - WANT[k]) > 0.005)) note('Over the Road: the Hub\'s Accounting Numbers has its own September 2026 (' + JSON.stringify(rec.hubSept) + '), which the Recap shows over the loaded numbers');
    // Import From Accounting with a made-up zip: it shows what it found; Cancel.
    const zip = await require(path.join(__dirname, '..', 'fixtures', 'accounting-zip.js')).septemberZip();
    await p.waitForSelector('#imp-pick', { timeout: 10000 });
    rec.importButton = (await p.textContent('#imp-pick')).trim();
    if (rec.importButton !== 'Import From Accounting') bad.push('the Recap import button reads ' + rec.importButton);
    await p.setInputFiles('#imp-file', { name: 'practice-test-accounting.zip', mimeType: 'application/zip', buffer: zip });
    await p.waitForSelector('#imp-use, #error:not([hidden])', { timeout: 60000 }).catch(() => {});
    rec.preview = await p.evaluate(() => ({ found: ((document.querySelector('.otr-import b') || {}).textContent || '').trim(), rows: document.querySelectorAll('.otr-import tr').length,
      use: !!document.getElementById('imp-use'), err: (document.getElementById('error') || {}).hidden === false ? document.getElementById('error').textContent.trim().slice(0, 200) : '' }));
    if (rec.preview.found !== 'Found in practice-test-accounting.zip' || !rec.preview.rows || !rec.preview.use) bad.push('Import From Accounting did not show what it found (' + JSON.stringify(rec.preview) + ')');
    await shot(p, 'otr-import-from-accounting-preview');
    if (await p.$('#imp-cancel')) await p.click('#imp-cancel');
    await p.waitForTimeout(1500);
    rec.cancelled = !(await p.$('#imp-use'));
    if (!rec.cancelled) bad.push('Cancel did not close the import');
    const allAfter = JSON.stringify((await db.collection('otrMonthly').get()).docs.map(d => [d.id, d.data()]));
    if (allAfter !== allBefore) bad.push('the Over the Road months changed during the test');
    if (p.w.calls.some(c => c.fn === 'save')) bad.push('the test saved something on Over the Road');
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.91 (#667, look only): the sales route email lists the routes delivering that day as of 6:00 AM and takes the leave time
  // from the dispatch tractor's GPS (the trailer's only when the tractor has none). Nothing is sent: Send a test to me is not
  // pressed. The Sales app (same status) is read for its Left times; a trailer trip's leave time is the unit's own report.
  await write('Sales route email departure times from the dispatch tractor (6.91, look only)', async (p, rec) => {
    const bad = [];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    await open(p, 'administration.html?item=sales-email');
    await p.waitForSelector('#se-test', { timeout: 30000 });
    rec.words = await p.evaluate(() => { const t = document.body.innerText; return { day: /routes delivering that day, as of 6:00 AM/.test(t), truck: /dispatch truck's GPS, or the trailer's when the truck has none/.test(t), old: /shift that just ended|Saturday's\)/.test(t) }; });
    if (!rec.words.day || !rec.words.truck || rec.words.old) bad.push('the Sales Route Email page reads ' + JSON.stringify(rec.words));
    await shot(p, 'sales-email-departure-words');
    // The Sales app: Left times (no names).
    await open(p, 'sales.html');
    await p.waitForSelector('.sa-card', { timeout: 40000 }).catch(() => {});
    await p.waitForTimeout(3000);
    const left = await p.evaluate(() => (document.body.innerText.match(/Left \d{1,2}:\d{2} [AP]M/g) || []));
    const counts = {}; left.forEach(x => { counts[x] = (counts[x] || 0) + 1; });
    rec.sales = { left: left.length, distinct: Object.keys(counts).length, mostShared: Math.max(0, ...Object.values(counts)) };
    if (rec.sales.mostShared >= 3) note('Sales app: ' + rec.sales.mostShared + ' routes show the same leave time (' + Object.keys(counts).find(k => counts[k] === rec.sales.mostShared) + ')');
    // Trailer trips: the leave time is the unit's own report time (at or before our read, after the trip began).
    const trips = (await db.collection('gpsReefer').get().catch(() => ({ docs: [] }))).docs.map(d => d.data()).filter(t => t && t.out && t.startedAt);
    rec.trailerTrips = { withOut: trips.length, beforeStart: trips.filter(t => String(t.out) < String(t.startedAt)).length, onFiveMin: trips.filter(t => /:\d[05]:00(\.000)?Z$/.test(String(t.out))).length };
    if (rec.trailerTrips.beforeStart) bad.push(rec.trailerTrips.beforeStart + ' trailer trips left before the trip began');
    if (!trips.length) note('Sales email: no trailer trip with a leave time on the practice copy, so the trailer leave time could not be checked');
    if (p.w.calls.some(c => /test|send/i.test(String(c.op || '')))) bad.push('something was sent: ' + p.w.calls.map(c => c.fn + ':' + c.op).join(', '));
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.91 (#672, #682, look only): Daily Dispatch: Print Daily Schedule and Print Weekly Schedule on the title line (not
  // pressed), the week and day information on one line, and the week locked to the published week (a link to another week
  // opens a day inside this one). Weekly Dispatch Template's button reads PUBLISH TO WEEKLY DISPATCH (not pressed).
  await write('Daily Dispatch title line, one info line, week locked (6.91, look only)', async (p, rec) => {
    const bad = [];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const L = require(path.join(__dirname, '..', '..', 'src', 'logic.js'));
    const cur = (((await db.collection('config').doc('app').get()).data() || {}).liveWeeks || {}).current || '';
    rec.week = cur;
    await p.setViewportSize({ width: 1536, height: 790 });
    const look = async () => p.evaluate(() => {
      const h1 = document.querySelector('.head h1'), hr = h1 ? h1.getBoundingClientRect() : null, b = (id) => { const e = document.getElementById(id); if (!e) return null; const r = e.getBoundingClientRect(); return { text: e.textContent.trim(), inHead: !!e.closest('.head'), top: Math.round(r.top), bottom: Math.round(r.bottom), shown: !!e.getClientRects().length }; };
      const shownKids = [...document.getElementById('day-info').children].filter(e => !e.hidden && e.getClientRects().length);
      const kids = shownKids.map(e => { const r = e.getBoundingClientRect(); return Math.round(r.top + r.height / 2); });
      // Words or buttons inside the line that run into each other.
      const bits = [...document.querySelectorAll('#day-info .week-of, #day-info .coverage, #day-info #send-texts .send-words, #day-info #send-texts button, #day-info .day-pick label, #day-info .day-pick .stepper, #day-info .delivers')].filter(e => e.getClientRects().length && e.textContent.trim() || e.matches('.stepper'));
      const name = (e) => e.matches('.send-words') ? 'the texts words' : e.matches('button') ? 'the ' + e.textContent.trim() + ' button' : e.matches('label') ? 'Loadout day' : e.matches('.stepper') ? 'the day picker' : e.matches('.delivers') ? 'Delivers' : e.matches('.coverage') ? 'Drivers covered' : 'Week of';
      const overlaps = [];
      for (let i = 0; i < bits.length; i++) for (let j = i + 1; j < bits.length; j++) { if (bits[i].contains(bits[j]) || bits[j].contains(bits[i])) continue; const x = bits[i].getBoundingClientRect(), y = bits[j].getBoundingClientRect();
        const w = Math.min(x.right, y.right) - Math.max(x.left, y.left), h = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top); if (w > 2 && h > 2) overlaps.push(name(bits[i]) + ' runs into ' + name(bits[j]) + ' by ' + Math.round(w) + ' px'); }
      const prev = document.getElementById('prev'), next = document.getElementById('next');
      return { h1: hr ? [Math.round(hr.top), Math.round(hr.bottom)] : null, daily: b('print-sheet'), weekly: b('print-week'), weekOf: (document.getElementById('week-of') || {}).textContent || '',
        oldWeek: !!document.getElementById('week-prev') || !!document.getElementById('week-next') || !!document.getElementById('week-begin'), mids: kids, day: document.getElementById('load-day').value,
        prev: { disabled: prev.disabled, title: prev.title }, next: { disabled: next.disabled, title: next.title }, side: document.documentElement.scrollWidth > innerWidth + 1, overlaps,
        // 6.91 (#687): each title-line button's place and width, and how many lines the texts words take inside their strip.
        btns: [...document.querySelectorAll('.head .actions.in-head :is(button, a.button)')].filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim(), w: Math.round(r.width), top: Math.round(r.top), bottom: Math.round(r.bottom), right: Math.round(r.right) }; }),
        words: (() => { const w = document.querySelector('#send-texts .send-words'), st = document.getElementById('send-texts'); if (!w || !w.getClientRects().length) return null; const r = w.getBoundingClientRect(), q = st.getBoundingClientRect(), lh = parseFloat(getComputedStyle(w).lineHeight) || 18;
          return { text: w.innerText.replace(/\s+/g, ' ').trim(), lines: Math.round(r.height / lh), inStrip: r.left >= q.left - 1 && r.right <= q.right + 1 && r.top >= q.top - 1 && r.bottom <= q.bottom + 1 }; })(),
        rightEdge: innerWidth };
    });
    const onTitle = (a) => a.h1 && a.btns.length && a.btns.every(x => x.bottom >= a.h1[0] - 4 && x.top <= a.h1[1] + 4);
    const rows = (a) => new Set(a.btns.map(x => Math.round(x.top / 6))).size;
    await open(p, 'daily.html');
    await p.waitForFunction(() => (document.getElementById('week-of') || {}).textContent, null, { timeout: 30000 }).catch(() => {});
    // The texts strip comes in a moment after the week (it reads the texting state).
    await p.waitForFunction(() => { const w = document.querySelector('#send-texts .send-words'); return w && w.getClientRects().length; }, null, { timeout: 15000 }).catch(() => {});
    const a = await look();
    rec.look = Object.assign({}, a, { day: undefined });
    if (!a.daily || a.daily.text !== 'Print Daily Schedule' || !a.daily.inHead) bad.push('no Print Daily Schedule on the title line (' + JSON.stringify(a.daily) + ')');
    if (!a.weekly || a.weekly.text !== 'Print Weekly Schedule' || !a.weekly.inHead) bad.push('no Print Weekly Schedule on the title line (' + JSON.stringify(a.weekly) + ')');
    if (a.h1 && a.daily && (a.daily.bottom < a.h1[0] - 4 || a.daily.top > a.h1[1] + 4)) bad.push('the buttons are not on the title line (title ' + a.h1 + ', button ' + a.daily.top + '-' + a.daily.bottom + ')');
    if (a.oldWeek) bad.push('the Week beginning arrows are still there');
    if (a.mids.length < 3 || Math.max(...a.mids) - Math.min(...a.mids) > 14) bad.push('the week and day information is not on one line (' + a.mids.join(', ') + ')');
    if (a.overlaps.length) bad.push('on the information line at 1536 ' + a.overlaps.join('; '));
    if (a.side) bad.push('Daily Dispatch scrolls sideways at 1536');
    // 6.91 (#687): at 1536 all six buttons on the title line, each its own width; the texts words stay inside their strip.
    rec.at1536 = { buttons: a.btns.map(x => x.t + ' ' + x.w), onTitleLine: onTitle(a), words: a.words };
    if (a.btns.length !== 6) bad.push('the title line has ' + a.btns.length + ' buttons (' + a.btns.map(x => x.t).join(', ') + '), not six');
    if (!onTitle(a)) bad.push('at 1536 not every button is on the title line (' + a.btns.map(x => x.t + ' ' + x.top + '-' + x.bottom).join(', ') + '; title ' + a.h1 + ')');
    if (a.btns.length > 1 && Math.max(...a.btns.map(x => x.w)) - Math.min(...a.btns.map(x => x.w)) <= 1) bad.push('at 1536 the buttons are all one width (' + a.btns[0].w + ' px), not each its own');
    if (!a.words) bad.push('at 1536 no texts words on the information line');
    else {
      if (!a.words.inStrip) bad.push('at 1536 the texts words run outside their strip');
      if (!/^Texts (not sent|sent)/.test(a.words.text)) bad.push('at 1536 the texts words read ' + a.words.text);
      if (a.words.lines < 2) note('Daily Dispatch at 1536: the texts words fit on ' + a.words.lines + ' line ("' + a.words.text + '"), so they did not need to wrap');
    }
    if (cur) {
      const sd = (k) => { const [y, m, d] = k.split('-').map(Number); return m + '-' + d + '-' + String(y).slice(2); };
      const wantOf = sd(cur) + ' to ' + sd(L.addDays(cur, 6));
      rec.wantOf = wantOf;
      if (a.weekOf.replace(/\s+/g, ' ').trim() !== wantOf) bad.push('Week of reads ' + a.weekOf + ' (the published week is ' + wantOf + ')');
      const begin = L.addDays(cur, -1), end = L.addDays(cur, 5);
      if (a.day < begin || a.day > end) bad.push('the loadout day ' + a.day + ' is not in the published week');
      // A link to a day two weeks on opens a day in this week.
      await open(p, 'daily.html?date=' + L.addDays(cur, 14));
      await p.waitForFunction(() => (document.getElementById('week-of') || {}).textContent, null, { timeout: 30000 }).catch(() => {});
      await p.waitForTimeout(1500);
      const b2 = await look();
      rec.otherWeekLink = { weekOf: b2.weekOf, inWeek: b2.day >= begin && b2.day <= end };
      if (b2.weekOf.replace(/\s+/g, ' ').trim() !== wantOf || !rec.otherWeekLink.inWeek) bad.push('a link to another week moved Daily Dispatch (' + JSON.stringify(rec.otherWeekLink) + ')');
      // The arrows stop at the ends of the week and say why.
      await p.selectOption('#load-day', begin).catch(() => {});
      await p.waitForTimeout(800);
      const c = await look();
      rec.atStart = { day: c.day === begin, prev: c.prev };
      if (c.day === begin && (!c.prev.disabled || c.prev.title !== 'Daily Dispatch shows only this week')) bad.push('at the first day of the week the back arrow reads ' + JSON.stringify(c.prev));
      if (c.day !== begin) note('Daily Dispatch: could not pick the first day of the week (' + c.day + ') to look at the back arrow');
    } else bad.push('the practice copy has no published week');
    await blankPeople(p); await shot(p, 'daily-title-line-1536');
    await p.setViewportSize({ width: 1920, height: 1080 });
    await open(p, 'daily.html');
    await p.waitForFunction(() => (document.getElementById('week-of') || {}).textContent, null, { timeout: 30000 }).catch(() => {});
    const w19 = await look();
    // 6.91 (#687): at 1920 the buttons are all one width, on one line on the title line, and nothing overlaps.
    rec.at1920 = { onTitleLine: onTitle(w19), widths: w19.btns.map(x => x.w), lines: rows(w19), overlaps: w19.overlaps, side: w19.side, words: w19.words };
    if (!rec.at1920.onTitleLine) bad.push('at 1920 the buttons are not on the title line');
    if (w19.btns.length && Math.max(...rec.at1920.widths) - Math.min(...rec.at1920.widths) > 1) bad.push('at 1920 the buttons are not one width (' + rec.at1920.widths.join(', ') + ')');
    if (rec.at1920.lines !== 1) bad.push('at 1920 the buttons are on ' + rec.at1920.lines + ' lines');
    if (w19.overlaps.length) bad.push('at 1920 ' + w19.overlaps.join('; '));
    if (w19.side) bad.push('Daily Dispatch scrolls sideways at 1920');
    await blankPeople(p); await shot(p, 'daily-title-line-1920');
    // 6.91 (#687): under 1280 the buttons and the information line wrap; no sideways scroll, nothing overlaps, nothing off the right edge.
    rec.small = {};
    for (const wd of [1200, 1024]) {
      await p.setViewportSize({ width: wd, height: 790 });
      await open(p, 'daily.html');
      await p.waitForFunction(() => (document.getElementById('week-of') || {}).textContent, null, { timeout: 30000 }).catch(() => {});
      await p.waitForTimeout(800);
      const sm = await look();
      const off = sm.btns.filter(x => x.right > sm.rightEdge + 1).map(x => x.t);
      rec.small[wd] = { buttonLines: rows(sm), infoSpread: sm.mids.length ? Math.max(...sm.mids) - Math.min(...sm.mids) : 0, side: sm.side, overlaps: sm.overlaps, off };
      if (sm.side) bad.push('Daily Dispatch scrolls sideways at ' + wd);
      if (sm.overlaps.length) bad.push('at ' + wd + ' ' + sm.overlaps.join('; '));
      if (off.length) bad.push('at ' + wd + ' buttons run off the right edge: ' + off.join(', '));
      note('Daily Dispatch at ' + wd + ': buttons on ' + rec.small[wd].buttonLines + ' line(s), information line ' + (rec.small[wd].infoSpread > 14 ? 'wrapped' : 'on one line'));
      await blankPeople(p); await shot(p, 'daily-title-line-' + wd);
    }
    await p.setViewportSize({ width: 1536, height: 790 });
    // The Template's publish button (never pressed).
    await open(p, 'weekly.html');
    await p.waitForSelector('#publish', { timeout: 30000 });
    await p.waitForFunction(() => /PUBLISH/i.test(document.getElementById('publish').textContent), null, { timeout: 15000 }).catch(() => {});
    rec.publish = (await p.textContent('#publish')).trim();
    if (rec.publish !== 'PUBLISH TO WEEKLY DISPATCH' && rec.publish !== 'Publish Stored Next Week First') bad.push('the Template\'s publish button reads ' + rec.publish);
    rec.publishFits = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    if (!rec.publishFits) bad.push('the Weekly Dispatch Template scrolls sideways at 1536');
    await blankPeople(p); await shot(p, 'weekly-template-publish-button');
    if (p.w.calls.some(c => c.fn === 'save')) bad.push('the test saved something');
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.91 (#673, look only): Weekly Dispatch: the legend has Driver Times Overlap; a driver already on another run that day is
  // blocked in a day's driver drop-down only with "ON <route> UNTIL <time>" (or times not known), never the old "on <route>".
  // Nothing is picked; the list is closed again.
  await write('Weekly Dispatch driver times overlap (6.91, look only)', async (p, rec) => {
    const bad = [];
    await p.setViewportSize({ width: 1536, height: 790 });
    await open(p, 'weekly.html?view=live');
    await p.waitForSelector('tr td.day.editable', { timeout: 30000 }).catch(() => {});
    rec.legend = await p.evaluate(() => [...document.querySelectorAll('.legend span')].map(x => x.textContent.trim()));
    if (!rec.legend.includes('Driver Times Overlap')) bad.push('the legend has no Driver Times Overlap (' + rec.legend.join(', ') + ')');
    const cells = await p.evaluate(() => [...document.querySelectorAll('tr td.day.editable')].filter(t => !/not running|does not run/i.test(t.textContent)).slice(0, 40).map(td => { const tr = td.closest('tr'); return tr.dataset.index !== undefined ? 'tr[data-index="' + tr.dataset.index + '"] td.day[data-day="' + td.dataset.day + '"]' : ''; }).filter(Boolean));
    const seen = { looked: 0, blocked: 0, overlap: 0, old: [] };
    for (const cell of cells.slice(0, 6)) {
      if (!(await p.$(cell))) continue;
      await p.click(cell).catch(() => {});
      const ok = await p.waitForSelector('.popover select[data-kind="driver"]', { timeout: 6000 }).then(() => true).catch(() => false);
      if (!ok) { await p.keyboard.press('Escape'); continue; }
      seen.looked++;
      const why = await p.$$eval('.popover select[data-kind="driver"] option', o => o.map(x => (/ — (.+)$/.exec(x.textContent) || [])[1] || '').filter(Boolean));
      why.forEach(w => { if (/^ON \S+ (UNTIL \d{1,2}:\d\d [AP]M|— TIMES NOT KNOWN)$/.test(w)) seen.overlap++; else if (/^ON \d/i.test(w)) seen.old.push(w); if (w) seen.blocked++; });
      await p.keyboard.press('Escape');
      await p.mouse.click(5, 5);
      await p.waitForTimeout(400);
    }
    rec.dropdowns = { looked: seen.looked, blocked: seen.blocked, overlap: seen.overlap, old: seen.old.slice(0, 3) };
    if (!seen.looked) bad.push('no day\'s driver drop-down could be opened on Weekly Dispatch');
    if (seen.old.length) bad.push('a busy driver reads the old way: ' + seen.old.slice(0, 3).join(', '));
    if (!seen.overlap) note('Weekly Dispatch: no driver in the ' + seen.looked + ' drop-downs looked at was on an overlapping run, so "ON … UNTIL …" was not seen');
    rec.pink = await p.evaluate(() => document.querySelectorAll('.booked').length);
    await blankPeople(p); await shot(p, 'weekly-times-overlap');
    if (p.w.calls.some(c => c.fn === 'save')) bad.push('the test saved something');
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.91 (#674, #684): the Garage tablet signs a made-up technician in with 4 digits when the login ID was saved with zeros
  // (001234 -> 1234), and with their employee ID (a made-up employee of the same name, 005678 -> 5678); a wrong number is
  // refused. The signature is never drawn (the "sign once" screen is left with Back). Fleet Service Setup's Add Technician
  // fills the login ID from the picked person (not pressed). The technician, employee, station and sign-ins are removed after.
  await write('Garage tablet sign-in with 4 digits and employee ID (6.91)', async (p, rec) => {
    const bad = [];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const adm = (op, f) => p.evaluate(([o, x]) => import('./js/app.js').then(m => m.callServer('admin', Object.assign({ op: o }, x))), [op, f]);
    const NAME = 'PRACTICE TEST TECH', EMP = 'emp_UDMS_PRACTICE_TEST_TECH', STN = 'Practice test Garage login';
    // 6.91 (#689): a second made-up employee, added as a technician from Garage Technicians' own Add Technician.
    const NAME2 = 'PRACTICE TEST TECHTWO', EMP2 = 'emp_UDMS_PRACTICE_TEST_TECHTWO';
    rec.startedAt = new Date().toISOString();
    const techIds = async () => (await db.collection('garageTechs').where('name', 'in', [NAME, NAME2]).get()).docs.map(d => d.id);
    const cleanup = async () => {
      for (const id of await techIds()) {
        // The login and its "number taken" marker (id_<number>) both carry the technician's id.
        for (const x of (await db.collection('garageLogins').where('techId', '==', id).get()).docs) await x.ref.delete();
        for (const c of ['garageLogins', 'garageLocks', 'garageClocks', 'garageSignatures']) await db.collection(c).doc(id).delete();
        for (const c of ['garageSessions', 'garageClocks']) for (const x of (await db.collection(c).where('techId', '==', id).get().catch(() => ({ docs: [] }))).docs) await x.ref.delete();
        await db.collection('garageTechs').doc(id).delete();
      }
      await db.collection('employees').doc(EMP).delete();
      await db.collection('employees').doc(EMP2).delete();
    };
    await cleanup();
    // A "number taken" marker an earlier run of this test left behind (its technician is gone; 11-7-26 on).
    const techSet = new Set((await db.collection('garageTechs').get()).docs.map(d => d.id).concat((await db.collection('garageTechs').get()).docs.map(d => String(d.data().tech_id || ''))));
    const orphans = (await db.collection('garageLogins').get()).docs.filter(d => /^id_/.test(d.id) && d.data().techId && !techSet.has(String(d.data().techId)) && String(d.data().setAt || '') >= '2026-11-07');
    rec.orphanMarkers = orphans.length;
    for (const d of orphans) await d.ref.delete();
    await open(p, 'administration.html');
    for (const o of ((await adm('stations', { kind: 'GARAGE' })).stations || []).filter(x => x.name === STN)) await adm('stationRemove', { key: o.key });
    const g = await newPage({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true });
    let st = null;
    try {
      await db.collection('employees').doc(EMP).set({ employeeId: '005678', name: 'TECH, PRACTICE TEST', active: true, status: 'ACTIVE', facilityId: 'fac_uniontown', department: 'GARAGE', testEdited: true, addedBy: EMAIL });
      // Made-up numbers; one that another technician's login already matches (zeros or not) is skipped for the next.
      let LOGIN = '', added = '';
      for (const n of ['9173', '8461', '7352', '6829', '5917']) {
        added = await p.evaluate((x) => import('./js/app.js').then(m => m.save('saveGarageTech', { op: 'ADD', name: 'PRACTICE TEST TECH', loginId: '00' + x, employeeId: '005678', facilityId: 'fac_uniontown' })).then(() => 'ok', e => String(e.message || e)), n);
        if (added === 'ok') { LOGIN = n; break; }
        if (!/already uses that login ID/.test(added)) break;
      }
      if (added !== 'ok') throw new Error('the made-up technician could not be added: ' + added);
      rec.triedNumbers = ['9173', '8461', '7352', '6829', '5917'].indexOf(LOGIN) + 1;
      st = ((await adm('stationAdd', { kind: 'GARAGE', type: 'GARAGE', facilityId: 'fac_uniontown', name: STN })).stations || []).find(x => x.name === STN);
      if (!st) throw new Error('could not add the test Garage station');
      const code = (await adm('stationCode', { key: st.key })).code;
      await open(g, 'garage-station.html');
      await g.waitForSelector('#view-code input[name="code"]', { timeout: 30000 });
      await g.fill('#view-code input[name="code"]', code);
      await g.click('#view-code button[type="submit"]');
      await g.waitForSelector('#cards .gs-bigcard', { timeout: 30000 });
      // The garage tablet asks for the login ID only inside a work order step (Start, Parts, Done), which the test does not
      // press: it makes the tablet's own sign-in call (the same server check, with this tablet's station), job untouched.
      const techId = ((await db.collection('garageTechs').where('name', '==', NAME).get()).docs[0] || { data: () => ({}) }).data().tech_id || (await techIds())[0];
      const stationNow = await g.evaluate(() => { try { const v = localStorage.getItem('udGarageStationCode'); const o = JSON.parse(v); return o && o.key ? { key: o.key, version: o.version } : null; } catch (e) { return null; } });
      if (!stationNow) bad.push('the tablet kept no station after its code');
      const signIn = async (digits) => g.evaluate(([t, id, stn]) => import('./js/app.js').then(m => m.callServer('garage', { op: 'signIn', techId: t, loginId: id, tokens: [], udPlant: 'fac_uniontown', station: stn }))
        .then(r => (r && (r.name || r.id || r.token) ? 'signed in' : 'answered ' + JSON.stringify(r).slice(0, 60)), e => 'refused: ' + String(e.message || e).slice(0, 120)), [techId, digits, stationNow]);
      rec.wrong = (await signIn('9999')).split(NAME).join('the test technician');
      if (!/^refused/.test(rec.wrong)) bad.push('a wrong 4-digit number was not refused (' + rec.wrong + ')');
      rec.four = (await signIn(LOGIN)).split(NAME).join('the test technician');
      if (rec.four !== 'signed in') bad.push('the 4 digits did not sign in the technician whose login ID was saved with two zeros in front (' + rec.four + ')');
      rec.employee = (await signIn('5678')).split(NAME).join('the test technician');
      if (rec.employee !== 'signed in') bad.push('the employee ID 5678 (005678) did not sign the technician in (' + rec.employee + ')');
      rec.signatures = (await Promise.all((await techIds()).map(id => db.collection('garageSignatures').doc(id).get()))).filter(d => d.exists).length;
      if (rec.signatures) bad.push('a signature was saved for the test technician');
      // Fleet Service Setup: Fleet Maintenance Setup's item; picking a person fills the login ID (Add Technician not pressed).
      await open(p, 'fleet.html?view=setup');
      await p.waitForSelector('#tech-name', { timeout: 30000 }).catch(() => {});
      await p.waitForFunction(() => document.querySelectorAll('#tech-people option').length > 0, null, { timeout: 20000 }).catch(() => {});
      const pick = await p.evaluate(() => { const o = [...document.querySelectorAll('#tech-people option')]; return { n: o.length, first: o[0] ? o[0].value : '' }; });
      rec.techPeople = pick.n;
      if (!pick.n) bad.push('Add Technician offers no names from the Employees list');
      else {
        await p.fill('#tech-name', pick.first); await p.dispatchEvent('#tech-name', 'input');
        const filled = await p.inputValue('#tech-login');
        rec.loginFilled = /^\d{1,6}$/.test(filled);
        if (!rec.loginFilled) bad.push('picking a person did not fill in the login ID');
        await p.fill('#tech-name', ''); await p.fill('#tech-login', '');
      }
      rec.empLine = await p.evaluate(() => document.querySelectorAll('.fs-emp').length);
      await p.evaluate(() => document.querySelectorAll('table td.strong').forEach(td => { td.childNodes[0] && (td.childNodes[0].textContent = 'Technician'); }));
      await p.evaluate(() => { const t = document.getElementById('tech-name'); if (t) t.scrollIntoView({ block: 'center' }); });
      await blankPeople(p); await shot(p, 'fleet-service-setup-technicians');
      if (p.w.calls.some(c => c.fn === 'save' && /GarageTech/.test(String(c.op)) && c.at > Date.now() - 60000 && !/ADD/.test(JSON.stringify(c)))) note('Fleet Service Setup: a technician save was seen');
      // 6.91 (#689): Administration > Fleet Maintenance Setup > Garage Technicians (fleet.html?view=techs). The made-up technician
      // above signs in with its employee ID. A second made-up employee is picked by name: its employee ID fills in the login,
      // Add Technician saves it with that employee ID; it is removed after (cleanup).
      await open(p, 'fleet.html?view=techs');
      await p.waitForSelector('.fs-techs h2', { timeout: 30000 }).catch(() => {});
      rec.techs = await p.evaluate((nm) => { const h = document.querySelector('.fs-techs h2'), row = [...document.querySelectorAll('.fs-techs td.strong')].find(td => td.textContent.indexOf(nm) === 0);
        return { title: h ? h.textContent.trim() : '', rules: !!document.querySelector('a.button[href="fleet.html?view=setup"]'), own: row ? (row.querySelector('.fs-emp') || {}).textContent || 'no line' : 'not listed', add: !!document.getElementById('tech-add'),
          scrollTop: Math.round((document.getElementById('tech-name') || { getBoundingClientRect: () => ({ top: -1 }) }).getBoundingClientRect().top) }; }, NAME);
      if (!/^Garage Technicians · /.test(rec.techs.title)) bad.push('Garage Technicians opens with ' + (rec.techs.title || 'no title'));
      if (!rec.techs.rules) bad.push('Garage Technicians has no Service Rules and Units button');
      if (rec.techs.own !== 'On the Employees list') bad.push('the made-up technician\'s line reads ' + rec.techs.own);
      // 6.91 (#694): each row shows its LOGIN ID in a box, the employee ID filled in by itself.
      rec.loginBox = await p.evaluate((nm) => { const row = [...document.querySelectorAll('.fs-techs tr')].find(tr => ((tr.querySelector('td.strong') || {}).textContent || '').indexOf(nm) === 0); const b = row && row.querySelector('input[data-login-tech]'); return b ? b.value : 'no box'; }, NAME);
      // Its login ID was set by hand (not its employee ID), so the box is empty and says SET BY HAND.
      rec.loginBox = rec.loginBox === 'no box' ? rec.loginBox : await p.evaluate((nm) => { const row = [...document.querySelectorAll('.fs-techs tr')].find(tr => ((tr.querySelector('td.strong') || {}).textContent || '').indexOf(nm) === 0); const b = row.querySelector('input[data-login-tech]'); return b.value ? 'a number' : b.placeholder; }, NAME);
      if (rec.loginBox !== 'SET BY HAND') bad.push('the made-up technician\'s LOGIN ID box (set by hand) reads ' + rec.loginBox);
      if (!rec.techs.add) bad.push('Garage Technicians has no Add Technician for the administrator');
      else {
        let ok2 = '';
        for (const id2 of ['008352', '007419', '006283', '004871']) {
          await db.collection('employees').doc(EMP2).set({ employeeId: id2, name: 'TECHTWO, PRACTICE TEST', active: true, status: 'ACTIVE', facilityId: 'fac_uniontown', department: 'GARAGE', testEdited: true, addedBy: EMAIL });
          await p.waitForFunction((nm) => [...document.querySelectorAll('#tech-people option')].some(o => o.value === nm), NAME2, { timeout: 30000 }).catch(() => {});
          await p.fill('#tech-name', NAME2); await p.dispatchEvent('#tech-name', 'input');
          const filled = await p.inputValue('#tech-login');
          rec.pickFills = filled === id2;
          if (!rec.pickFills) { bad.push('picking the made-up employee filled the login with ' + (filled ? 'another number' : 'nothing') + ', not its employee ID'); break; }
          await p.click('#tech-add');
          await p.waitForFunction((nm) => [...document.querySelectorAll('.fs-techs td.strong')].some(td => td.textContent.indexOf(nm) === 0) || /\S/.test((document.getElementById('error') || {}).textContent || ''), NAME2, { timeout: 20000 }).catch(() => {});
          const t2 = (await db.collection('garageTechs').where('name', '==', NAME2).get()).docs[0];
          if (t2) { ok2 = String(t2.data().employee_id || t2.data().employeeId || ''); break; }
          const err = await p.evaluate(() => ((document.getElementById('error') || {}).textContent || '').trim());
          if (!/already uses that login ID/.test(err)) { bad.push('Add Technician did not add the made-up employee (' + (err || 'no answer') + ')'); break; }
          await p.fill('#tech-name', ''); await p.fill('#tech-login', '');
        }
        rec.added2 = ok2 ? ok2.replace(/^0+/, '') === (await db.collection('employees').doc(EMP2).get()).data().employeeId.replace(/^0+/, '') : false;
        if (ok2 && !rec.added2) bad.push('the added technician was saved with another employee ID');
        if (ok2) {
          const line2 = await p.evaluate((nm) => { const row = [...document.querySelectorAll('.fs-techs td.strong')].find(td => td.textContent.indexOf(nm) === 0); return row ? (row.querySelector('.fs-emp') || {}).textContent || 'no line' : 'not listed'; }, NAME2);
          rec.line2 = line2;
          if (line2 !== 'On the Employees list') bad.push('the added technician\'s line reads ' + line2);
          const box2 = await p.evaluate((nm) => { const row = [...document.querySelectorAll('.fs-techs tr')].find(tr => ((tr.querySelector('td.strong') || {}).textContent || '').indexOf(nm) === 0); const b = row && row.querySelector('input[data-login-tech]'); return b ? b.value : 'no box'; }, NAME2);
          if (box2.replace(/^0+/, '') !== ok2.replace(/^0+/, '')) bad.push('the added technician\'s LOGIN ID box does not show its employee ID');
          rec.boxesCleared = (await p.inputValue('#tech-name')) === '' && (await p.inputValue('#tech-login')) === '';
          if (!rec.boxesCleared) bad.push('the Add Technician boxes were not cleared after the add');
        }
      }
      await p.evaluate(() => document.querySelectorAll('.fs-techs td.strong').forEach(td => { td.childNodes[0] && (td.childNodes[0].textContent = 'Technician'); }));
      await blankPeople(p); await shot(p, 'garage-technicians');
    } finally {
      await g.done();
      if (st) await adm('stationRemove', { key: st.key }).catch(() => {});
      await cleanup();
      rec.removed = !(await techIds()).length && !(await db.collection('employees').doc(EMP).get()).exists && !(await db.collection('garageLogins').get()).docs.some(d => d.data().setBy === EMAIL && d.data().setAt >= rec.startedAt);
      if (!rec.removed) bad.push('the made-up technician or employee was not removed');
    }
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.91 (#675, #676, #678, #680, #683, #685, look only): Texts part 3 "See a driver's text" (a driver picked shows their own
  // week; nothing texted); the Sales app has no "Left over from" part; the Pallet Builder opens with the Hub's newest BOL when
  // there is one; Unloading puts trailers in the lot (green) above ones not back yet; issue lists' Garage ticks; the Driver
  // Weekly Template says where a change goes. And every changed screen's ? opens its own Help part.
  await write('Texts, Sales, Pallet Builder BOL, Unloading, Issues, Template and their Help (6.91, look only)', async (p, rec) => {
    const bad = [];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    await p.setViewportSize({ width: 1536, height: 790 });
    // Texts.
    await open(p, 'texts.html');
    await p.waitForSelector('h3.texts-new', { timeout: 30000 });
    rec.textsHead = (await p.textContent('h3.texts-new')).trim();
    if (rec.textsHead !== 'See a driver\'s text') bad.push('Texts part 3 reads ' + rec.textsHead);
    await p.waitForFunction(() => document.querySelectorAll('#sample-for option').length > 1, null, { timeout: 20000 }).catch(() => {});
    const opt = await p.$$eval('#sample-for option', o => o.map(x => x.value).filter(Boolean));
    if (!opt.length) bad.push('See a driver\'s text has no drivers to pick');
    else {
      const seenWeeks = [];
      for (const v of opt.slice(0, 2)) {
        await p.selectOption('#sample-for', v);
        await p.waitForTimeout(800);
        const t = await p.evaluate(() => (document.getElementById('preview-text') || {}).textContent || (document.getElementById('sample-hint') || {}).textContent || '');
        seenWeeks.push(t.length);
      }
      rec.sampleLengths = seenWeeks;
      if (!seenWeeks.some(n => n > 20)) bad.push('picking a driver shows no text');
      rec.sampleSendGreyed = await p.$eval('#sample-send', b => b.disabled).catch(() => null);
    }
    await p.evaluate(() => { document.querySelectorAll('#sample-for option').forEach(o => { if (o.value) o.textContent = 'Driver'; }); const t = document.getElementById('preview-text'); if (t) t.textContent = '(the driver\'s text)'; });
    await shot(p, 'texts-see-a-drivers-text');
    // Sales app.
    await open(p, 'sales.html');
    await p.waitForSelector('.sa-card', { timeout: 40000 }).catch(() => {});
    await p.waitForTimeout(2500);
    rec.salesLeftOver = await p.evaluate(() => /Left over from/i.test(document.body.innerText));
    if (rec.salesLeftOver) bad.push('the Sales app still shows a Left over from part');
    // Pallet Builder: the Hub's newest BOL.
    await open(p, 'pallet-builder.html');
    await p.waitForSelector('#screen:not([hidden]) #builder', { timeout: 30000 });
    await p.frameLocator('#builder').locator('#dayTable tr').first().waitFor({ timeout: 30000 }).catch(() => {});
    rec.bol = await p.evaluate(() => window.udBol ? { date: window.udBol.date, routes: window.udBol.routes.length } : null);
    if (rec.bol) {
      const fh = await (await p.$('#builder')).contentFrame();
      const tag = rec.bol.date.slice(5).replace('-', '/') + '/' + rec.bol.date.slice(2, 4);
      rec.bolInBuilder = await fh.evaluate((t) => DB.routes.filter(x => String(x.route).endsWith(t)).length, tag);
      if (!rec.bolInBuilder) bad.push('the Pallet Builder did not open with the Hub\'s newest BOL (' + rec.bol.date + ')');
    } else note('Pallet Builder: the Hub has no Daily BOL on the practice copy, so the builder opened with its own BOL');
    // Unloading & Washing.
    await open(p, 'unloading.html');
    await p.waitForSelector('table tbody tr', { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(2000);
    rec.unload = await p.evaluate(() => { const rows = [...document.querySelectorAll('table tbody tr[class]')]; const cls = rows.map(tr => tr.classList.contains('done') ? 'done' : tr.classList.contains('lot') ? 'lot' : tr.classList.contains('road') ? 'road' : 'other');
      const lot = rows.find(tr => tr.classList.contains('lot')); return { rows: rows.length, lot: cls.filter(c => c === 'lot').length, road: cls.filter(c => c === 'road').length, done: cls.filter(c => c === 'done').length,
        lotAfterRoad: cls.indexOf('road') >= 0 && cls.lastIndexOf('lot') > cls.indexOf('road'), doneNotLast: cls.indexOf('done') >= 0 && cls.slice(cls.indexOf('done')).some(c => c !== 'done'),
        lotGreen: lot ? getComputedStyle(lot.querySelector('td')).backgroundColor : '', words: { lot: document.querySelectorAll('small.where.lot').length, road: document.querySelectorAll('small.where.road').length } }; });
    if (rec.unload.lotAfterRoad) bad.push('Unloading has a trailer in the lot below one not back yet');
    if (rec.unload.doneNotLast) bad.push('Unloading has an unloaded trailer above one still to do');
    if (rec.unload.lot && /^rgba?\(255, 255, 255/.test(rec.unload.lotGreen)) bad.push('a trailer in the lot is not green');
    if (!rec.unload.lot && !rec.unload.road) note('Unloading: no trailer in the lot or on the road on the practice copy right now (' + rec.unload.rows + ' rows), so the GPS order could not be seen');
    await blankPeople(p); await shot(p, 'unloading-order');
    // Issue lists: Garage ticks.
    await open(p, 'issues.html');
    await p.waitForSelector('table tbody tr', { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(2000);
    rec.issues = await p.evaluate(() => { const t = [...document.querySelectorAll('[title]')].map(x => x.title).filter(x => /garage/i.test(x)); return { ticks: t.length, orderWords: t.filter(x => /work order|In the garage|Was in the garage|On the garage list/.test(x)).length }; });
    if (!rec.issues.orderWords) note('Issue lists: no write-up whose unit has been to the garage on the practice copy, so the new Garage tick words were not seen (' + rec.issues.ticks + ' garage ticks)');
    // Driver Weekly Template.
    await open(p, 'template.html');
    await p.waitForSelector('.tpl-about', { timeout: 30000 });
    rec.tpl = (await p.textContent('.tpl-about')).replace(/\s+/g, ' ').trim().slice(0, 220);
    if (!/A change here also changes Driver Master, this week on Weekly Dispatch and next week on the Weekly Dispatch Template/.test(rec.tpl)) bad.push('the Driver Weekly Template does not say where a change goes (' + rec.tpl.slice(0, 120) + ')');
    // Help: each changed screen's ? opens its own part.
    const parts = {}; let curPart = null;
    fs.readFileSync(path.join(__dirname, '..', '..', '..', 'public', 'help.md'), 'utf8').split('\n').forEach(l => { const h = /^## (.+)$/.exec(l); if (h) curPart = h[1].trim(); const sc = /^screens: (.+)$/.exec(l); if (sc && curPart) sc[1].split(',').forEach(x => { parts[x.trim()] = curPart; }); });
    rec.help = {};
    for (let [pg, want] of [['daily.html', 'daily.html'], ['weekly.html?view=live', 'weekly.html?view=live'], ['weekly.html', 'weekly.html'], ['template.html', 'template.html'], ['texts.html', 'texts.html'], ['sales.html', 'sales.html'],
      ['pallet-builder.html', 'pallet-builder.html'], ['unloading.html', 'unloading.html'], ['issues.html', 'issues.html'], ['fleet.html?view=setup', 'fleet.html'], ['maint.html', 'maint.html'], ['products.html', 'products.html']]) {
      await open(p, pg);
      await p.waitForTimeout(1500);
      const href = await p.evaluate(() => import('./js/help.js').then(m => m.helpHref()).catch(() => ''));
      if (!href) { rec.help[pg] = 'no help link'; bad.push(pg + ': no Help link'); continue; }
      await open(p, href.replace(/^\//, ''));
      await p.waitForSelector('#help-read .help-title', { timeout: 20000 }).catch(() => {});
      const title = (await p.textContent('#help-read .help-title').catch(() => '')).trim();
      rec.help[pg] = title;
      want = parts[pg] ? pg : want;
      if (parts[want] && title !== parts[want]) bad.push(pg + ': the ? opens ' + (title || 'nothing') + ' (should be ' + parts[want] + ')');
      if (!parts[want] && !title) bad.push(pg + ': the ? opens nothing');
    }
    rec.textCalls = p.w.calls.filter(c => c.fn === 'sms').map(c => c.op).join(', ');
    if (p.w.calls.some(c => c.fn === 'save' || /send/i.test(String(c.op || '')))) bad.push('the test saved or sent something: ' + p.w.calls.filter(c => c.fn === 'save' || /send/i.test(String(c.op || ''))).map(c => c.fn + ':' + c.op).join(', '));
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.91 (#686, look only): case counts per customer. Pallet Builder: a route with a route map shows CUSTOMERS ON ROUTE <n> · <DAY>
  // with LOW / MIDDLE / AVERAGE / HIGH / LAST n WEEKS, PALLET USES, HELD FOR, TODAY'S BOL and SPACE; PALLET RULES opens the rules
  // (standard rule, weeks in the average, 54 crates and 45 dispensers to a pallet). Nothing is picked or changed. Product Sheet:
  // the blue Cases and Pallets columns and the same five boxes in the Edit panel, closed with Done (nothing typed). The ? on each
  // opens its own part, and the part has the new words.
  await write('Pallet Builder held space, PALLET RULES and Product Sheet case columns (6.91, look only)', async (p, rec) => {
    const bad = [];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    await p.setViewportSize({ width: 1536, height: 790 });
    await open(p, 'pallet-builder.html');
    await p.waitForSelector('#screen:not([hidden]) #builder', { timeout: 30000 });
    const fr = p.frameLocator('#builder');
    await fr.locator('#dayTable tr').first().waitFor({ timeout: 30000 });
    const fm = await (await p.$('#builder')).contentFrame();
    // 6.91 (#693): BOL DAY at the top opens on the newest BOL; DAY BEFORE brings an older day's routes in and DAY AFTER goes back;
    // the green SAVE TO ROUTE MAP is at the top; New/Copy/Delete route are under MORE ROUTE TOOLS. Nothing is saved here.
    const dayLook = () => fm.evaluate(() => { const q = (id) => document.getElementById(id); const sv = q('lmSave'), more = document.querySelector('details.more');
      return { days: [...q('dayPick').options].map(o => o.value), picked: q('dayPick').value, line: q('dayLine').textContent.trim(), prev: { off: q('dayPrev').disabled, title: q('dayPrev').title, text: q('dayPrev').textContent.trim() },
        next: { off: q('dayNext').disabled, title: q('dayNext').title, text: q('dayNext').textContent.trim() }, route: S.route, save: sv ? sv.textContent.trim() : '', saveTop: sv ? Math.round(sv.getBoundingClientRect().top) : -1,
        more: more ? (more.querySelector('summary') || {}).textContent.trim() : '', bad: q('dayBad') ? { hidden: q('dayBad').hidden, text: q('dayBad').textContent.trim() } : null, inMore: !!(more && more.querySelector('#newRoute') && more.querySelector('#dupRoute') && more.querySelector('#delRoute') && more.querySelector('#route')) }; });
    let d0 = await dayLook();
    // The builder reopens the day of the route that was open last (an earlier step worked on the built-in 11-5-26 day); a
    // new BOL opens on the newest. Go to the newest with DAY AFTER first.
    rec.reopenedOn = d0.picked;
    for (let k = 0; k < 5 && d0.days.length && d0.picked !== d0.days[0] && !d0.next.off; k++) { await fr.locator('#dayNext').click(); await p.waitForTimeout(800); d0 = await dayLook(); }
    rec.bolDay = { days: d0.days.length, line: d0.line, prev: d0.prev, next: d0.next, save: d0.save, saveTop: d0.saveTop, more: d0.more, inMore: d0.inMore };
    // 6.91 (#698): the days come from the Hub's BOL (Friday 11-6-26 on practice), not only the built-in one, with no red reason line.
    rec.bolDay.hubDays = d0.days.filter(d => d !== '2026-11-05');
    rec.bolDay.redLine = d0.bad;
    if (!rec.bolDay.hubDays.length) bad.push('BOL DAY has only the BOL built into Pallet Builder, none from the Hub' + (d0.bad && !d0.bad.hidden ? ' ("' + d0.bad.text + '")' : ''));
    if (d0.bad && !d0.bad.hidden) bad.push('the red BOL day line shows: ' + d0.bad.text);
    if (!d0.days.length || d0.picked !== d0.days[0]) bad.push('BOL DAY does not open on the newest day (' + d0.picked + ' of ' + d0.days.join(', ') + ')');
    if (!/^BOL FOR [A-Z]+DAY \d{1,2}-\d{1,2}-\d\d · \d+ ROUTES? (· RECEIVED .+ )?· NEWEST BOL$/.test(d0.line)) bad.push('the BOL DAY line reads "' + d0.line + '"');
    if (d0.prev.text !== '◀ DAY BEFORE' || d0.next.text !== 'DAY AFTER ▶') bad.push('the day buttons read ' + d0.prev.text + ' / ' + d0.next.text);
    if (!d0.next.off || d0.next.title !== 'This is the newest BOL.') bad.push('DAY AFTER on the newest BOL is ' + (d0.next.off ? 'greyed, saying "' + d0.next.title + '"' : 'not greyed'));
    if (d0.save !== 'SAVE TO ROUTE MAP') bad.push('the save button reads ' + (d0.save || 'nothing'));
    if (d0.more !== 'MORE ROUTE TOOLS' || !d0.inMore) bad.push('New, Copy and Delete route and the route name are not under MORE ROUTE TOOLS');
    if (d0.days.length > 1) {
      if (d0.prev.off) bad.push('DAY BEFORE is greyed with ' + d0.days.length + ' BOL days');
      await fr.locator('#dayPrev').click(); await p.waitForTimeout(800);
      const d1 = await dayLook();
      rec.bolDay.before = { picked: d1.picked, line: d1.line, route: d1.route };
      if (d1.picked !== d0.days[1] || /NEWEST BOL/.test(d1.line) || !/^BOL FOR /.test(d1.line)) bad.push('DAY BEFORE went to ' + d1.picked + ' ("' + d1.line + '")');
      const dd = d0.days[1].split('-'), want = '/' + dd[1] + '/' + dd[2].slice(-2);
      if (d1.route === d0.route || !String(d1.route).replace(/\b0/g, '').includes(want.replace(/\b0/g, '').slice(0, 3))) note('Pallet Builder: after DAY BEFORE the open route is ' + d1.route);
      await shot(p, 'pallet-builder-bol-day-before');
      await fr.locator('#dayNext').click(); await p.waitForTimeout(800);
      const d2 = await dayLook();
      if (d2.picked !== d0.days[0] || !/NEWEST BOL$/.test(d2.line)) bad.push('DAY AFTER did not come back to the newest BOL (' + d2.picked + ')');
    } else {
      if (!d0.prev.off || d0.prev.title !== 'There is no BOL before this day.') bad.push('DAY BEFORE with one BOL day is ' + (d0.prev.off ? 'greyed, saying "' + d0.prev.title + '"' : 'not greyed'));
      note('Pallet Builder: only one BOL day on the practice copy, so DAY BEFORE was checked greyed only');
    }
    await fr.locator('#dayPick').scrollIntoViewIfNeeded().catch(() => {});
    await shot(p, 'pallet-builder-bol-day');
    const plant = await p.evaluate(() => import('./js/app.js').then(m => m.currentPlant()));
    const keys = await fm.evaluate(() => DB.routes.map((x, i) => { const k = routeKey(x); return k ? { i, route: k.route, day: k.day, n: x.stops.filter(st => !st.sub).length } : null; }).filter(Boolean));
    let use = null;
    for (const k of keys) { if (k.n < 2) continue; const d = await db.collection('udclRouteDays').doc(plant + '__' + k.route + '__' + k.day).get(); if (d.exists && (d.data().stops || []).length >= 2) { use = k; break; } }
    rec.route = use ? use.route + ' ' + use.day : 'none (' + keys.length + ' builder routes with a route number)';
    if (!use) bad.push('no builder route has a route map in the Customer List to show its customers');
    else {
      await fr.locator('#routePick').selectOption(String(use.i));
      await fm.waitForFunction(() => /^CUSTOMERS ON ROUTE /.test(document.getElementById('custTitle').textContent) && !/^GETTING/.test((document.getElementById('custHint') || {}).textContent || ''), null, { timeout: 30000 }).catch(() => {});
      await p.waitForTimeout(800);
      rec.cust = await fm.evaluate(() => { const t = document.getElementById('custTable'); return { title: document.getElementById('custTitle').textContent.trim(), hint: (document.getElementById('custHint') || {}).textContent || '',
        heads: [...t.querySelectorAll('thead th')].map(x => x.textContent.trim()), rows: t.querySelectorAll('tbody tr').length, chosen: t.querySelectorAll('td.chosen').length, uses: t.querySelectorAll('select.cuses').length,
        usesOff: t.querySelectorAll('select.cuses:disabled').length, held: document.querySelectorAll('#truck i.held').length, words: [...new Set([...t.querySelectorAll('tbody td:last-child')].map(x => x.textContent.replace(/\d[\d,]*/g, 'N').trim()).filter(Boolean))],
        top: Math.round(document.getElementById('custPanel').getBoundingClientRect().top), firstPanel: [...document.querySelectorAll('section.panel')].filter(x => x.getClientRects().length)[0] === document.getElementById('custPanel') }; });
      rec.cust.hint = rec.cust.hint.slice(0, 160);
      const wantDay = { MON: 'MONDAY', TUE: 'TUESDAY', WED: 'WEDNESDAY', THU: 'THURSDAY', FRI: 'FRIDAY', SAT: 'SATURDAY', SUN: 'SUNDAY' }[use.day] || use.day;
      if (rec.cust.title !== 'CUSTOMERS ON ROUTE ' + use.route + ' · ' + wantDay) bad.push('the customers panel is titled ' + rec.cust.title);
      const W = rec.cust.heads[7] || '';
      if (JSON.stringify(rec.cust.heads.slice(0, 7).concat(rec.cust.heads.slice(8))) !== JSON.stringify(['RUN', 'LOAD SEQ', 'CUSTOMER', 'LOW', 'MIDDLE', 'AVERAGE', 'HIGH', 'PALLET USES', 'HELD FOR', "TODAY'S BOL", 'SPACE']) || !/^LAST \d+ WEEKS$/.test(W)) bad.push('the customers table columns are ' + rec.cust.heads.join(', '));
      if (!rec.cust.rows) bad.push('the customers table has no customers');
      if (rec.cust.uses && rec.cust.usesOff === rec.cust.uses) bad.push('PALLET USES is greyed for the administrator');
      const weeks = !/^NO WEEKS OF THE WEEKLY ROUTE REPORT YET/.test(rec.cust.hint);
      rec.cust.weeks = weeks;
      if (weeks && !rec.cust.chosen) bad.push('the route has weeks of cases but no number is marked in yellow');
      if (!weeks) note('Pallet Builder: route ' + use.route + ' ' + use.day + ' has no weeks of the Weekly Route Report on the practice copy, so no space is held (the table and words were checked; held shading was not seen)');
      if (!rec.cust.firstPanel) note('Pallet Builder: the customers panel is not the first panel on the page (top ' + rec.cust.top + ')');
      await fr.locator('#custPanel').scrollIntoViewIfNeeded();
      await shot(p, 'pallet-builder-customers-on-route');
      // PALLET RULES: open, read, close. Nothing is changed.
      await fr.locator('#rulesBtn').click();
      await p.waitForTimeout(400);
      rec.rules = await fm.evaluate(() => { const b = document.getElementById('rulesBox'), v = (k) => { const e = b.querySelector('[data-k="' + k + '"]'); return e ? (e.type === 'checkbox' ? e.checked : e.value) : null; };
        return { open: !b.hidden, standard: v('standard'), weeks: v('weeks'), crates: v('cratesPerPallet'), stack: v('cratesPerStack'), dispensers: v('dispensersPerPallet'), boxIsCrate: v('boxIsCrate'), newEach: v('newPalletEachSeq'), under: v('under'),
          off: b.querySelectorAll('.rule:disabled').length, all: b.querySelectorAll('.rule').length, msg: (document.getElementById('rulesMsg') || {}).textContent || '', legend: document.getElementById('palLegend').textContent.replace(/\s+/g, ' ').trim().slice(0, 200) }; });
      if (!rec.rules.open) bad.push('PALLET RULES did not open');
      else {
        if (rec.rules.standard !== 'HIGH') bad.push('the standard rule is ' + rec.rules.standard + ' (should start at HIGH)');
        if (!(+rec.rules.weeks >= 1)) bad.push('weeks in the average reads ' + rec.rules.weeks);
        if (rec.rules.crates !== '54') bad.push('crates to a pallet reads ' + rec.rules.crates + ' (should be 54)');
        if (rec.rules.dispensers !== '45') bad.push('dispensers to a pallet reads ' + rec.rules.dispensers + ' (should be 45)');
        if (rec.rules.off === rec.rules.all) bad.push('PALLET RULES is greyed for the administrator (' + rec.rules.msg.slice(0, 80) + ')');
        if (!/54 per pallet/.test(rec.rules.legend)) bad.push('the pallet legend reads ' + rec.rules.legend.slice(0, 120));
      }
      await shot(p, 'pallet-builder-pallet-rules');
      await fr.locator('#rulesBtn').click();
      await p.waitForTimeout(300);
      if (await fm.evaluate(() => !document.getElementById('rulesBox').hidden)) bad.push('PALLET RULES did not close on a second press');
    }
    // Product Sheet.
    await open(p, 'products.html');
    await p.waitForSelector('#rows tr', { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(1000);
    rec.sheet = await p.evaluate(() => { const band = [...document.querySelectorAll('#sheet thead tr.pm-band th.pm-pal')].map(x => [x.textContent.trim(), x.colSpan]);
      const heads = [...document.querySelectorAll('#sheet thead tr:not(.pm-band) th.pm-pal')].map(x => x.textContent.trim());
      const row = document.querySelector('#rows tr[data-key]'); const tds = row ? [...row.querySelectorAll('td[data-k]')].map(x => x.dataset.k) : [];
      return { band, heads, rows: document.querySelectorAll('#rows tr[data-key]').length, cells: ['unitsPerCase', 'casesPerPallet', 'stackHeight', 'caseNetLbs', 'caseGrossLbs'].every(k => tds.indexOf(k) >= 0),
        blue: (() => { const t = document.querySelector('#sheet thead th.pm-pal'); return t ? getComputedStyle(t).backgroundColor : ''; })(), side: document.documentElement.scrollWidth > innerWidth + 1 }; });
    if (JSON.stringify(rec.sheet.band) !== JSON.stringify([['Cases and Pallets', 5]])) bad.push('the Product Sheet has no Cases and Pallets band over five columns (' + JSON.stringify(rec.sheet.band) + ')');
    if (rec.sheet.heads.length !== 5 || !/Units In A Case/.test(rec.sheet.heads[0]) || !/Cases To A Pallet/.test(rec.sheet.heads[1]) || !/Stack Height/.test(rec.sheet.heads[2]) || !/Net/.test(rec.sheet.heads[3]) || !/Gross/.test(rec.sheet.heads[4])) bad.push('the Cases and Pallets columns read ' + rec.sheet.heads.join(', '));
    if (!rec.sheet.rows) bad.push('the Product Sheet shows no products');
    else if (!rec.sheet.cells) bad.push('a product line has no Cases and Pallets boxes');
    if (rec.sheet.blue !== 'rgb(31, 78, 121)') bad.push('the Cases and Pallets headings are not blue (' + rec.sheet.blue + ')');
    if (rec.sheet.side) bad.push('the Product Sheet page itself scrolls sideways at 1536');
    await p.evaluate(() => { const s = document.querySelector('.pm-sheet-scroll'), t = document.querySelector('#sheet thead th.pm-pal'); if (s && t) s.scrollLeft = t.offsetLeft - 200; });
    await shot(p, 'product-sheet-cases-and-pallets');
    if (await p.$('#rows .pm-editbtn')) {
      await p.click('#rows .pm-editbtn');
      await p.waitForSelector('#edit-back:not([hidden])', { timeout: 10000 }).catch(() => {});
      rec.edit = await p.evaluate(() => { const ks = [...document.querySelectorAll('#edit-fields [data-k]:not(.pm-other)')].map(e => e.dataset.k), r = document.getElementById('edit-pane').getBoundingClientRect();
        return { tail: ks.slice(-5), fits: Math.round(r.bottom) <= innerHeight && r.top >= 0, height: Math.round(r.height), labels: [...document.querySelectorAll('#edit-fields .pm-field.pm-n > span')].map(x => x.textContent.trim()).slice(-5) }; });
      if (JSON.stringify(rec.edit.tail) !== JSON.stringify(['unitsPerCase', 'casesPerPallet', 'stackHeight', 'caseNetLbs', 'caseGrossLbs'])) bad.push('the Edit panel boxes end with ' + rec.edit.tail.join(', '));
      if (!rec.edit.fits) note('Product Sheet: the Edit panel is ' + rec.edit.height + ' px tall and does not fit 1536 x 790 without scrolling');
      await shot(p, 'product-sheet-edit-cases');
      await p.click('#edit-close');
      await p.waitForTimeout(300);
      if (await p.$('#edit-back:not([hidden])')) bad.push('Done did not close the Edit panel');
    } else bad.push('no Edit button on the Product Sheet for the administrator');
    // Help: the ? on each opens its own part, and the part has the new words.
    rec.help = {};
    for (const [pg, title, words] of [['pallet-builder.html', 'Pallet Builder', /BOL DAY[\s\S]*PALLET USES/], ['manager.html?report=1', 'Send Current Report', /Case Loadout forecast/], ['products.html', 'Product Sheet', /Cases and Pallets/], ['daily.html', 'Daily Dispatch', /Not set up yet/]]) {
      await open(p, pg);
      await p.waitForTimeout(1500);
      const href = await p.evaluate(() => import('./js/help.js').then(m => m.helpHref()).catch(() => ''));
      if (!href) { bad.push(pg + ': no Help link'); continue; }
      await open(p, href.replace(/^\//, ''));
      await p.waitForSelector('#help-read .help-title', { timeout: 20000 }).catch(() => {});
      const got = (await p.textContent('#help-read .help-title').catch(() => '')).trim(), txt = await p.evaluate(() => (document.getElementById('help-read') || {}).textContent || '');
      rec.help[pg] = { title: got, words: words.test(txt) };
      if (got !== title) bad.push(pg + ': the ? opens ' + (got || 'nothing') + ' (should be ' + title + ')');
      else if (!rec.help[pg].words) bad.push(pg + ': the ' + title + ' help part does not have ' + words.source);
    }
    const wrote = p.w.calls.filter(c => c.fn === 'save' || /setPalletUses|savePalletRules|saveRouteDay/.test(String(c.op || '')));
    if (wrote.length) bad.push('the test saved something: ' + wrote.map(c => c.fn + ':' + c.op).join(', '));
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.91 (#677, #688, #691, look only): % OF RUNS COVERED beside both Weekly Dispatch titles (red under 100%, green at 100%, its
  // hover says how many run days have a driver); Administration > Texts' red Text these drivers yourself list; Late Forecast keeps
  // every night of the last 4 weeks for the speed by hour; and the ? on each (and on Garage Technicians) opens its own part.
  await write('Weekly % of runs covered, Texts list to text yourself, Late Forecast by hour and their Help (6.91, look only)', async (p, rec) => {
    const bad = [];
    await p.setViewportSize({ width: 1536, height: 790 });
    for (const pg of ['weekly.html?view=live', 'weekly.html']) {
      await open(p, pg);
      await p.waitForSelector('tr td.day', { timeout: 30000 }).catch(() => {});
      await p.waitForFunction(() => { const c = document.getElementById('covered'); return c && !c.hidden && /%/.test(c.textContent); }, null, { timeout: 20000 }).catch(() => {});
      const c = await p.evaluate(() => { const e = document.getElementById('covered'), h = document.querySelector('.head h1'); if (!e) return null; const r = e.getBoundingClientRect(), q = h.getBoundingClientRect(), bg = getComputedStyle(e).backgroundColor.match(/\d+/g).map(Number);
        const btn = [...document.querySelectorAll('.head .actions.in-head :is(button, a.button)')].filter(b => b.getClientRects().length).map(b => b.getBoundingClientRect());
        return { shown: !e.hidden && r.width > 0, text: e.textContent.trim(), full: e.classList.contains('full'), bg, title: e.title, h1: h.textContent.trim(), sameLine: r.top < q.bottom && r.bottom > q.top && r.left >= q.right - 1,
          btnsOnTitle: btn.every(b => b.bottom >= q.top - 4 && b.top <= q.bottom + 4), overBtn: btn.some(b => r.left < b.right && b.left < r.right && r.top < b.bottom && b.top < r.bottom), side: document.documentElement.scrollWidth > innerWidth + 1, size: getComputedStyle(e).fontSize }; });
      rec[pg] = c;
      if (!c || !c.shown) { bad.push(pg + ': no % OF RUNS COVERED beside the title'); continue; }
      const m = /^(\d+)% OF RUNS COVERED$/.exec(c.text), t = /^(\d+) of (\d+) run days this week have a driver$/.exec(c.title);
      if (!m) bad.push(pg + ': the box reads ' + c.text);
      if (!t) bad.push(pg + ': the box\'s hover reads ' + (c.title || 'nothing'));
      if (m && t) { const pc = +m[1], exact = 100 * t[1] / t[2]; if (Math.abs(pc - exact) >= 1) bad.push(pg + ': ' + pc + '% does not match ' + t[1] + ' of ' + t[2]);
        if (pc === 100 ? !(c.full && c.bg[1] > c.bg[0]) : (c.full || !(c.bg[0] > c.bg[1]))) bad.push(pg + ': at ' + pc + '% the box is ' + (c.bg[0] > c.bg[1] ? 'red' : 'green') + ' (' + c.bg.join(',') + ')'); }
      if (!c.sameLine) bad.push(pg + ': the box is not beside the title ' + c.h1);
      if (c.overBtn) bad.push(pg + ': the box runs into a title-line button');
      if (!c.btnsOnTitle) bad.push(pg + ': the buttons are no longer on the title line at 1536');
      if (c.side) bad.push(pg + ': scrolls sideways at 1536');
      await blankPeople(p); await shot(p, 'weekly-covered-' + pg.replace(/\W+/g, '-'));
    }
    // 6.91 (#697): at 390, 768 and 1024 the box is whole inside the screen on both Weekly screens (under the title, words wrap).
    rec.narrow = {};
    for (const wd of [390, 768, 1024]) {
      const np = await newPage(wd === 390 ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: wd, height: 900 } });
      try {
        for (const pg of ['weekly.html?view=live', 'weekly.html']) {
          await open(np, pg);
          await np.waitForFunction(() => { const c = document.getElementById('covered'); return c && !c.hidden && /%/.test(c.textContent); }, null, { timeout: 30000 }).catch(() => {});
          const c = await np.evaluate(() => { const e = document.getElementById('covered'); if (!e || e.hidden) return null; const r = e.getBoundingClientRect();
            return { text: e.textContent.trim(), left: Math.round(r.left), right: Math.round(r.right), w: innerWidth, cut: e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1, lines: Math.round(r.height / (parseFloat(getComputedStyle(e).lineHeight) || 20)) }; });
          rec.narrow[wd + ' ' + pg] = c;
          if (!c) bad.push(pg + ' at ' + wd + ': no % OF RUNS COVERED box');
          else if (c.left < 0 || c.right > c.w + 1 || c.cut) bad.push(pg + ' at ' + wd + ': the box is not whole inside the screen (' + c.left + '-' + c.right + ' of ' + c.w + (c.cut ? ', words cut' : '') + ')');
          if (wd === 390) { await blankPeople(np); await shot(np, 'weekly-covered-390-' + pg.replace(/\W+/g, '-')); }
        }
      } finally { await np.done(); }
    }
    // Texts: the red Text these drivers yourself list (look only; nothing sent).
    await open(p, 'texts.html');
    await p.waitForSelector('#preview-count', { timeout: 30000 }).catch(() => {});
    await p.waitForFunction(() => /\d/.test((document.getElementById('preview-count') || {}).textContent || ''), null, { timeout: 20000 }).catch(() => {});
    rec.hand = await p.evaluate(() => { const h = document.getElementById('hand'); if (!h) return null; const rows = [...document.querySelectorAll('#hand-rows tr')];
      return { el: true, shown: !h.hidden, head: (h.querySelector('h3') || {}).textContent || '', red: (() => { const c = getComputedStyle(h.querySelector('h3')).color.match(/\d+/g).map(Number); return c[0] > c[1] && c[0] > c[2]; })(),
        heads: [...h.querySelectorAll('thead th')].map(x => x.textContent.trim()), rows: rows.length, cells: rows.every(r => r.children.length === 3), why: [...new Set(rows.map(r => (r.children[1] || {}).textContent || ''))].slice(0, 3),
        send: (document.getElementById('send') || {}).disabled }; });
    if (!rec.hand || !rec.hand.el) bad.push('Administration > Texts has no Text these drivers yourself part');
    else {
      if (!/^Text these drivers yourself/.test(rec.hand.head)) bad.push('the list is headed ' + rec.hand.head);
      if (!rec.hand.red) bad.push('the Text these drivers yourself heading is not red');
      if (rec.hand.heads.join('|') !== 'Driver|Why|Days changed') bad.push('the list columns read ' + rec.hand.heads.join(', '));
      if (rec.hand.shown && (!rec.hand.rows || !rec.hand.cells)) bad.push('the list shows but its lines are not Driver, Why, Days changed');
      if (!rec.hand.shown) note('Texts: no driver on the practice copy is both not signed up and on a changed week, so the red Text these drivers yourself list stays hidden (checked it is there, hidden)');
      else note('Texts: ' + rec.hand.rows + ' driver(s) to text yourself on the practice copy');
    }
    await p.evaluate(() => { document.querySelectorAll('#hand-rows td:first-child, #preview td').forEach(td => { td.textContent = 'Driver'; }); });
    await blankPeople(p); await shot(p, 'texts-text-these-drivers-yourself');
    // Daily and Weekly Dispatch strips: the red "N to text yourself" matches the list.
    for (const pg of ['daily.html', 'weekly.html?view=live']) {
      await open(p, pg);
      await p.waitForFunction(() => { const s = document.getElementById('send-texts'); return s && !s.hidden && s.querySelector('button'); }, null, { timeout: 20000 }).catch(() => {});
      const st = await p.evaluate(() => { const s = document.getElementById('send-texts'); if (!s) return null; const h = s.querySelector('.send-hand-short, .send-hand'); return { hand: h ? h.textContent.trim().slice(0, 60) : '' }; });
      rec['strip ' + pg] = st && st.hand ? st.hand.replace(/:.*$/, '') : 'none';
      if (rec.hand && rec.hand.shown && st && !st.hand) bad.push(pg + ': the texts strip does not say there are drivers to text yourself');
      if (rec.hand && !rec.hand.shown && st && st.hand && /text yourself|yourself/i.test(st.hand)) bad.push(pg + ': the strip names drivers to text yourself but the Texts list is empty');
    }
    // Late Forecast: it opens, and keeps every night of the last 4 weeks (allNights) for the speed by hour of the night.
    await open(p, 'forecast.html');
    await p.waitForFunction(() => /\S/.test((document.getElementById('dayname') || {}).textContent || ''), null, { timeout: 30000 }).catch(() => {});
    await p.waitForFunction(() => { try { const k = JSON.parse(localStorage.getItem('udForecastNights') || 'null'); return k && Array.isArray(k.allNights); } catch (e) { return false; } }, null, { timeout: 30000 }).catch(() => {});
    rec.forecast = await p.evaluate(() => { let k = null; try { k = JSON.parse(localStorage.getItem('udForecastNights') || 'null'); } catch (e) {} const all = k && k.allNights;
      return { day: ((document.getElementById('dayname') || {}).textContent || '').trim(), allNights: Array.isArray(all) ? all.length : 'none', slim: Array.isArray(all) && all.every(n => (n.loads || []).every(r => r.area === 'CASE' && r.state === 'DONE' && !r.customer && !r.driver)),
        sameDay: k && Array.isArray(k.nights) ? k.nights.length : 'none', side: document.documentElement.scrollWidth > innerWidth + 1 }; });
    if (!rec.forecast.day) bad.push('Late Forecast did not open');
    if (rec.forecast.allNights === 'none') bad.push('Late Forecast did not keep the last 4 weeks of nights for the speed by hour');
    else if (!rec.forecast.slim) bad.push('Late Forecast keeps more than the finished case loads\' counts and times');
    if (rec.forecast.side) bad.push('Late Forecast scrolls sideways at 1536');
    await blankPeople(p); await shot(p, 'late-forecast');
    // Help.
    rec.help = {};
    for (const [pg, title, words] of [['weekly.html?view=live', 'Weekly Dispatch', /OF RUNS COVERED/], ['weekly.html', 'Weekly Dispatch Template', /OF RUNS COVERED/], ['fleet.html?view=techs', 'Garage Technicians', /LOGIN ID/],
      ['administration.html?item=garage-techs', 'Garage Technicians', /LOGIN ID/], ['texts.html', 'Texts', /Text these drivers yourself/], ['forecast.html', 'Late Forecast', /hour of the night/]]) {
      await open(p, pg);
      await p.waitForTimeout(1500);
      const href = await p.evaluate(() => import('./js/help.js').then(m => m.helpHref()).catch(() => ''));
      if (!href) { bad.push(pg + ': no Help link'); continue; }
      await open(p, href.replace(/^\//, ''));
      await p.waitForSelector('#help-read .help-title', { timeout: 20000 }).catch(() => {});
      const got = (await p.textContent('#help-read .help-title').catch(() => '')).trim(), txt = await p.evaluate(() => (document.getElementById('help-read') || {}).textContent || '');
      rec.help[pg] = { title: got, words: words.test(txt) };
      if (!got) bad.push(pg + ': the ? opens nothing');
      else if (title && got !== title) bad.push(pg + ': the ? opens ' + got + ' (should be ' + title + ')');
      else if (!rec.help[pg].words) bad.push(pg + ': its help part (' + got + ') does not have ' + words.source);
    }
    if (p.w.calls.some(c => c.fn === 'save' || /send/i.test(String(c.op || '')))) bad.push('the test saved or sent something: ' + p.w.calls.filter(c => c.fn === 'save' || /send/i.test(String(c.op || ''))).map(c => c.fn + ':' + c.op).join(', '));
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.91 (#693, look only, the practice copy's data): the customer-list October load ran here: every October customer is on the
  // Uniontown Customer List and on its route day, and Helds is account 811496 (811495 is on no route day and is not active).
  await write('Customer List October customers and Helds 811496 on practice (6.91, look only)', async (p, rec) => {
    const bad = [];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const LOAD = require(path.join(__dirname, '..', '..', 'src', 'loads', 'customer-list-october-2026-11-07.json'));
    const mark = (await db.collection('dataLoads').doc(LOAD.id).get()).data();
    rec.mark = mark ? { status: mark.status, doneAt: mark.doneAt, counts: mark.counts } : 'none';
    if (!mark || mark.status !== 'DONE') bad.push('the October load has not run on the practice copy (' + JSON.stringify(rec.mark) + ')');
    const cust = (await db.collection('udclCustomers').where('plant', '==', LOAD.plant).get()).docs.map(d => d.data());
    const days = (await db.collection('udclRouteDays').where('plant', '==', LOAD.plant).get()).docs.map(d => d.data());
    const letters = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const miss = [], off = [], noDay = [];
    for (const [route, day, account, , name] of LOAD.lines) {
      const c = cust.find(x => account && String(x.account) === String(account)) || cust.find(x => letters(x.name) === letters(name));
      if (!c) { miss.push(name); continue; }
      if (c.active === false) off.push(name);
      const rd = days.find(x => String(x.route) === String(route) && String(x.day) === String(day));
      if (!rd || !(rd.stops || []).some(st => st.key === c.key)) noDay.push(route + ' ' + day + ' ' + name);
    }
    rec.october = { lines: LOAD.lines.length, missing: miss.length, notActive: off.length, notOnRouteDay: noDay.length };
    if (miss.length) bad.push(miss.length + ' October customers are not on the Customer List (' + miss.slice(0, 3).join(', ') + ')');
    if (off.length) bad.push(off.length + ' October customers are not active (' + off.slice(0, 3).join(', ') + ')');
    if (noDay.length) bad.push(noDay.length + ' October stops are not on their route day (' + noDay.slice(0, 3).join('; ') + ')');
    const helds = cust.filter(x => String(x.account) === '811496'), old = cust.filter(x => String(x.account) === '811495');
    const oldOn = days.filter(d => (d.stops || []).some(st => old.some(o => o.key === st.key) || String(st.account) === '811495')).map(d => d.route + ' ' + d.day);
    const newOn = days.filter(d => (d.stops || []).some(st => helds.some(o => o.key === st.key))).map(d => d.route + ' ' + d.day);
    rec.helds = { name: helds.map(x => x.name).join(', '), active: helds.every(x => x.active !== false), oldActive: old.filter(x => x.active !== false).length, oldOn, newOn };
    if (!helds.length) bad.push('no customer has account 811496');
    else if (!/^HELDS/.test(helds[0].name) || !rec.helds.active) bad.push('account 811496 reads ' + rec.helds.name + (rec.helds.active ? '' : ' (not active)'));
    if (oldOn.length) bad.push('the old Helds account 811495 is still on ' + oldOn.join(', '));
    if (rec.helds.oldActive) bad.push('the old Helds account 811495 is still active');
    if (helds.length && !newOn.length) bad.push('Helds 811496 is on no route day');
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.91 (#663): Vacation Schedule Calendar tab: + Add Vacation next to Print opens the same form under the buttons, with the
  // first and last day on the 1st of the month shown (not this month). A made-up test driver's vacation is added from the
  // Calendar, shows on that day, and is then removed with its Dispatch day off (vsched_) and any sheet row; the driver too.
  await write('Vacation Schedule Calendar + Add Vacation (6.91)', async (p, rec) => {
    const bad = [];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const ID = 'PRACTICE-TEST-DRIVER-VAC', NAME = 'PRACTICE TEST DRIVER VAC';
    const testRuns = [];
    const cleanup = async () => {
      for (const x of (await db.collection('vacations').where('driverId', '==', ID).get()).docs) {
        await db.collection('exceptions').doc('vsched_' + x.id).delete();
        for (const o of (await db.collection('masterOutbox').where('docId', 'in', [x.id, 'vsched_' + x.id]).get().catch(() => ({ docs: [] }))).docs) await o.ref.delete();
        await x.ref.delete();
      }
      for (const x of (await db.collection('exceptions').where('driverId', '==', ID).get()).docs) await x.ref.delete();
      await db.collection('drivers').doc(ID).delete(); await db.collection('driverPhones').doc(ID).delete();
    };
    await cleanup();
    const model = (await db.collection('drivers').limit(50).get()).docs.map(d => d.data()).find(d => String(d.status || '').toUpperCase() === 'ACTIVE' && d.facilityId === 'fac_uniontown') || {};
    const base = {}; ['facilityId', 'type', 'driverType', 'reliefDriver', 'seniority', 'seniorityDate', 'hireDate', 'homeTerminal', 'plant'].forEach(k => { if (model[k] !== undefined) base[k] = model[k]; });
    // Other drivers' names never go in a picture.
    const blank = (pg) => pg.evaluate((nm) => {
      document.querySelectorAll('.cday [data-vac-id]').forEach(e => { if (!String(e.title || '').startsWith(nm)) { e.textContent = '·'; e.title = ''; } });
      document.querySelectorAll('#print-who option, #form select[name="driverId"] option').forEach(o => { if (o.value && o.textContent !== nm) o.textContent = 'Driver'; });
    }, NAME);
    try {
      await db.collection('drivers').doc(ID).set(Object.assign({}, base, { id: ID, name: NAME, employeeId: '', status: 'ACTIVE', unavailableReason: '', testEdited: true, addedBy: EMAIL }));
      await open(p, 'vacations.html');
      await p.click('[data-view="calendar"]');
      await p.waitForSelector('#view-calendar:not([hidden]) .cday[data-day]', { timeout: 30000 });
      rec.button = await p.$eval('#cal-add', b => ({ text: b.textContent.trim(), disabled: b.disabled, title: b.title, nextToPrint: !!b.parentElement.querySelector('#print-year'), vis: !!b.getClientRects().length }));
      if (rec.button.text !== '+ Add Vacation' || !rec.button.vis) bad.push('the Calendar has no + Add Vacation button (' + rec.button.text + ')');
      if (!rec.button.nextToPrint) bad.push('+ Add Vacation is not next to Print');
      if (rec.button.disabled) bad.push('+ Add Vacation is greyed for a manager');
      if (rec.button.title !== 'Type in a vacation or day off') bad.push('+ Add Vacation says ' + rec.button.title);
      note('Vacation Schedule: the greyed + Add Vacation for read-only people needs a read-only login; the test checked the manager\'s.');
      // Next month: the form opens with the 1st of that month.
      const m0 = await p.$eval('#cal-month', e => e.value);
      await p.click('#cal-next');
      await p.waitForFunction((m) => document.getElementById('cal-month').value !== m, m0, { timeout: 10000 });
      const mon = await p.$eval('#cal-month', e => e.value);
      rec.month = mon;
      await p.waitForFunction((id) => [...document.querySelectorAll('#form select[name="driverId"] option, #print-who option')].length > 0, ID, { timeout: 10000 }).catch(() => {});
      await p.click('#cal-add');
      await p.waitForSelector('#form:not([hidden])', { timeout: 10000 });
      rec.form = await p.evaluate(() => { const f = document.getElementById('form'), cal = document.querySelector('#view-calendar .calendar');
        return { inCal: !!f.closest('#view-calendar'), beforeCal: !!(cal && (f.compareDocumentPosition(cal) & Node.DOCUMENT_POSITION_FOLLOWING)), driver: f.driverId.value, start: f.startDate.value, end: f.endDate.value,
          status: f.status.value, hasTest: [...f.driverId.options].some(o => o.value === 'PRACTICE-TEST-DRIVER-VAC'),
          top: Math.round(f.getBoundingClientRect().top), calTop: cal ? Math.round(cal.getBoundingClientRect().top) : null }; });
      if (!rec.form.inCal || !rec.form.beforeCal) bad.push('the form does not open on the Calendar tab above the month');
      if (rec.form.driver) bad.push('the Driver drop-down does not start blank');
      if (rec.form.start !== mon + '-01' || rec.form.end !== mon + '-01') bad.push('on ' + mon + ' the form opens on ' + rec.form.start + ' to ' + rec.form.end + ' (should be the 1st)');
      if (!rec.form.hasTest) bad.push('the test driver is not in the Driver drop-down');
      await blank(p);
      await shot(p, 'vacation-calendar-add-form');
      // Save a two-day vacation for the test driver; a full day is refused, so try other days.
      let saved = null;
      for (const d of ['10', '17', '24', '03', '06']) {
        if (!(await p.$('#form:not([hidden])'))) { await p.click('#cal-add'); await p.waitForSelector('#form:not([hidden])', { timeout: 10000 }); }
        await p.selectOption('#form select[name="driverId"]', ID);
        const a = mon + '-' + d, b = mon + '-' + String(+d + 1).padStart(2, '0');
        await p.fill('#form input[name="startDate"]', a); await p.fill('#form input[name="endDate"]', b);
        await p.selectOption('#form select[name="type"]', 'VACATION'); await p.selectOption('#form select[name="status"]', 'APPROVED');
        await p.fill('#form input[name="email"]', ''); await p.fill('#form input[name="notes"]', 'Practice test');
        await p.click('#save');
        let doc = null;
        for (let i = 0; i < 30 && !doc; i++) {
          await p.waitForTimeout(500);
          const q = (await db.collection('vacations').where('driverId', '==', ID).get()).docs; if (q.length) doc = Object.assign({ docId: q[0].id }, q[0].data());
          if (!doc) { const err = await p.$eval('#error', e => e.hidden ? '' : e.textContent.trim()).catch(() => ''); if (err) { note('Vacation Schedule: ' + a + ' refused: ' + err.replace(NAME, 'the test driver').slice(0, 120)); break; } }
        }
        if (doc) { saved = { a, b, doc }; break; }
      }
      if (!saved) bad.push('the test vacation could not be saved from the Calendar');
      else {
        rec.saved = { start: saved.doc.startDate, end: saved.doc.endDate, status: saved.doc.status, type: saved.doc.vacationType, email: saved.doc.notificationEmail || '' };
        if (saved.doc.startDate !== saved.a || saved.doc.endDate !== saved.b || saved.doc.status !== 'APPROVED') bad.push('the saved vacation reads ' + JSON.stringify(rec.saved));
        const ex = (await db.collection('exceptions').doc('vsched_' + saved.doc.docId).get()).data();
        rec.dispatch = ex ? ex.status : 'none';
        if (!ex || ex.status !== 'APPROVED') bad.push('the vacation is not on Dispatch (' + rec.dispatch + ')');
        // It shows on both days on the calendar, without a reload and after one.
        const onCal = () => p.evaluate(([nm, a, b]) => [a, b].map(d => [...document.querySelectorAll('.cday[data-day="' + d + '"] [data-vac-id]')].some(e => String(e.title || '').startsWith(nm))), [NAME, saved.a, saved.b]);
        await p.waitForFunction(([nm, a]) => [...document.querySelectorAll('.cday[data-day="' + a + '"] [data-vac-id]')].some(e => String(e.title || '').startsWith(nm)), [NAME, saved.a], { timeout: 15000 }).catch(() => {});
        rec.shown = await onCal();
        if (!rec.shown.every(Boolean)) bad.push('the calendar does not show the test vacation on ' + saved.a + ' and ' + saved.b + ' (' + rec.shown + ')');
        rec.formClosed = await p.$eval('#form', f => f.hidden);
        if (!rec.formClosed) bad.push('the form stays open after Save Vacation');
        await blank(p);
        await shot(p, 'vacation-calendar-added');
        await p.reload({ waitUntil: 'domcontentloaded' });
        await p.click('[data-view="calendar"]');
        await p.waitForSelector('#view-calendar:not([hidden]) .cday[data-day]', { timeout: 30000 });
        if ((await p.$eval('#cal-month', e => e.value)) !== mon) await p.click('#cal-next');
        await p.waitForFunction(([nm, a]) => [...document.querySelectorAll('.cday[data-day="' + a + '"] [data-vac-id]')].some(e => String(e.title || '').startsWith(nm)), [NAME, saved.a], { timeout: 20000 }).catch(() => {});
        rec.shownAfterReload = await onCal();
        if (!rec.shownAfterReload.every(Boolean)) bad.push('after a reload the calendar does not show the test vacation');
      }
      // 6.91 (#673): an approved vacation takes the driver off a week already built: a test load of the test's own in a built
      // week with the test driver on it reads NEEDS DRIVER (who is off: the test driver, VACATION) after the vacation is saved.
      {
        const L = require(path.join(__dirname, '..', '..', 'src', 'logic.js'));
        const lw = (((await db.collection('config').doc('app').get()).data() || {}).liveWeeks || {});
        const tries = [lw.next, lw.current].filter(L.isDateKey).flatMap(w => [3, 4, 2, 5, 1].map(k => L.addDays(w, k)));
        let made = null;
        for (const D of tries) {
          if (made) break;
          const wk = L.weekStart(D);
          const base = (await db.collection('runs').where('weekStart', '==', wk).limit(40).get()).docs.map(d => d.data()).find(x => !x.extraRun && !x.splitTest && x.days);
          if (!base) continue;
          const pp = L.dayPrefix(D), days = {}; L.DAYS.forEach(x => { days[x] = { runs: false }; });
          days[pp] = Object.assign({}, (base.days || {})[pp] || {}, { runs: true, driverId: ID, driver: NAME, intendedDriverId: '', intendedDriver: '', driverExceptionStatus: '', loadedComplete: false, loadStatus: '', completeTime: null });
          const id = wk + '__practice_vac_' + Date.now().toString(36);
          await db.collection('runs').doc(id).set(Object.assign({}, base, { weekStart: wk, runId: String(base.runId || '') + '__practicevac', run: 'PRACTICE TEST VAC', days, sheetRow: null, extraOf: null, splitTest: true, addedBy: EMAIL, addedAt: new Date().toISOString(), rev: 1 }));
          testRuns.push(id);
          const out = await p.evaluate((x) => import('./js/app.js').then(m => m.save('saveVacation', x)).then(() => 'ok', e => String(e.message || e)), { vacationId: '', driverId: ID, startDate: D, endDate: D, type: 'VACATION', status: 'APPROVED', email: '', notes: 'Practice test' });
          if (out !== 'ok') { note('Vacation Schedule: the built-week test day ' + D + ' was refused: ' + out.replace(NAME, 'the test driver').slice(0, 120)); continue; }
          made = { D, pp, id };
        }
        if (!made) bad.push('no built week day to test that an approved vacation takes the driver off');
        else {
          let d = null; for (let i = 0; i < 20; i++) { d = ((await db.collection('runs').doc(made.id).get()).data().days || {})[made.pp] || {}; if (!d.driverId) break; await p.waitForTimeout(500); }
          rec.builtWeek = { day: made.D, driverOff: !d.driverId, intended: d.intendedDriverId === ID, why: d.driverExceptionStatus };
          if (d.driverId || d.intendedDriverId !== ID || !/VACATION/.test(String(d.driverExceptionStatus))) bad.push('the approved vacation did not take the test driver off the built week (' + JSON.stringify(rec.builtWeek) + ')');
        }
      }
      if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    } finally {
      for (const id of testRuns) { for (const o of (await db.collection('masterOutbox').where('docId', '==', id).get().catch(() => ({ docs: [] }))).docs) await o.ref.delete(); await db.collection('runs').doc(id).delete(); }
      await cleanup();
      rec.removed = (await db.collection('vacations').where('driverId', '==', ID).get()).size === 0 && !(await db.collection('drivers').doc(ID).get()).exists;
      if (!rec.removed) bad.push('the test vacation or driver was not removed');
    }
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.90 (#655): a Boxing station tablet refreshes by itself: a test box load started on the office screen shows LOADING on
  // the tablet within about a minute with no reload, and Last refreshed moves by itself. Station and load removed after.
  await write('Plant Station Boxing refreshes by itself (6.90)', async (p, rec) => {
    const bad = [];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const adm = (op, f) => p.evaluate(([o, x]) => import('./js/app.js').then(m => m.callServer('admin', Object.assign({ op: o }, x))), [op, f]);
    const save = (action, f) => p.evaluate(([a, x]) => import('./js/app.js').then(m => m.save(a, x)), [action, f]);
    await open(p, 'administration.html');
    const stName = 'Practice test Boxing refresh';
    for (const o of ((await adm('stations', { kind: 'PLANT' })).stations || []).filter(x => x.name === stName)) await adm('stationRemove', { key: o.key });
    const t = await todayTestLoads(1, { offset: 0, leavesOn: 'Delivery Day', day: { loadType: 'BOXING', dispatchTime: 1380, startTime: 1380 } });
    if (!t.made) throw new Error('no load on the practice copy to copy for the test');
    rec.made = t.made;
    const st = ((await adm('stationAdd', { kind: 'PLANT', type: 'BOXING', facilityId: 'fac_uniontown', name: stName })).stations || []).find(x => x.name === stName);
    const tab = st ? await newPage({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }) : null;
    try {
      if (!st) throw new Error('could not add the test station');
      await db.collection('runs').doc(t.ids[0]).set({ run: 'BXPT 1', coverageType: 'UNITED DAIRY' }, { merge: true });
      const dayOf = async () => { const d = (await db.collection('runs').doc(t.ids[0]).get()).data() || {}; const k = Object.keys(d.days || {}).find(x => d.days[x] && d.days[x].runs); return { prefix: k, day: k ? d.days[k] : {} }; };
      const code = (await adm('stationCode', { key: st.key })).code;
      await open(tab, 'plant-station.html');
      await tab.waitForSelector('#code-box input[name="code"]', { timeout: 30000 });
      await tab.fill('#code-box input[name="code"]', code);
      await tab.click('#code-box button[type="submit"]');
      let id = '';
      for (let i = 0; i < 90 && !id; i++) { id = await tab.evaluate(() => { const c = [...document.querySelectorAll('.sw-card')].find(x => /BXPT 1(?!\d)/.test(x.textContent)); return c ? c.dataset.sw : ''; }).catch(() => ''); if (!id) await tab.waitForTimeout(500); }
      if (!id) { await shot(tab, 'boxing-refresh-no-load'); throw new Error('the test box load is not on the Boxing tablet'); }
      await tab.evaluate(() => { window.__sameLoad = 1; });
      const f0 = await tab.evaluate(() => (window.UDReads || {}).freshAt || 0);
      const d = await dayOf();
      rec.office = await save('savePlantLoad', { runDocId: t.ids[0], day: d.prefix, fields: { startedAt: new Date().toISOString(), completedAt: '' } }).then(() => 'saved', e => 'refused: ' + String(e.message || e).slice(0, 120));
      if (rec.office !== 'saved') bad.push('starting the box load on the office screen: ' + rec.office);
      const t0 = Date.now();
      await tab.waitForFunction((x) => { const c = document.querySelector('.sw-card[data-sw="' + CSS.escape(x) + '"] .sw-state'); return c && /^LOADING/.test(c.textContent.trim()); }, id, { timeout: 75000 })
        .then(() => { rec.shownMs = Date.now() - t0; }, () => bad.push('the box load started on the office screen did not show LOADING on the tablet within a minute'));
      rec.freshMoved = await tab.waitForFunction((x) => ((window.UDReads || {}).freshAt || 0) > x + 30000, f0, { timeout: 80000 }).then(() => true, () => false);
      if (!rec.freshMoved) bad.push('Last refreshed did not move by itself within a minute on the Boxing tablet');
      rec.sameLoad = await tab.evaluate(() => window.__sameLoad === 1);
      if (!rec.sameLoad) bad.push('the Boxing tablet reloaded the page');
      await shot(tab, 'boxing-refresh');
      if (tab.w.errors.length) bad.push('tablet page errors: ' + tab.w.errors.slice(0, 2).join(' | '));
      await tab.evaluate(k => { try { localStorage.removeItem(k); } catch (e) { /* none */ } }, 'udStationDevice').catch(() => {});
    } finally {
      if (tab) await tab.done();
      if (st) await adm('stationRemove', { key: st.key }).catch(e => bad.push('the test station was not removed: ' + String(e.message).slice(0, 80)));
      await t.remove(); rec.removed = true;
    }
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.90 (#656, look only): GPS Setup's Remove drivers from Verizon. It deletes drivers in the REAL Verizon account, so only
  // Check is pressed, with a made-up username: it says the name is not a Verizon driver and Delete stays greyed. Delete is
  // never pressed, and as a guard any call that would delete (confirm: true) is stopped before it leaves this browser.
  await write('GPS Setup Remove drivers: Check a made-up name only (6.90, look only)', async (p, rec) => {
    const bad = [], FAKE = 'not-a-real-user-practice-test';
    let blocked = 0;
    const guard = (route) => { const b = route.request().postData() || ''; if (/removeDrivers/.test(b) && /"confirm"\s*:\s*true/.test(b)) { blocked++; return route.abort(); } return route.continue(); };
    await p.route(/cloudfunctions\.net\/gps|\/gps$/, guard);
    try {
      await open(p, 'gps.html');
      await p.waitForSelector('#r-check', { timeout: 30000 });
      rec.card = await p.evaluate(() => { const c = document.getElementById('r-check').closest('.gps-card'); return { head: (c.querySelector('h2') || {}).textContent.trim(), del: document.getElementById('r-delete').disabled, heads: [...document.querySelectorAll('.gps-card h2')].map(h => h.textContent.trim()) }; });
      if (!/^7\. Remove drivers from Verizon$/.test(rec.card.head)) bad.push('the card is called ' + rec.card.head);
      if (!rec.card.del) bad.push('Delete from Verizon is not greyed before Check');
      await p.fill('#r-names', FAKE);
      const c0 = p.w.calls.length;
      await p.click('#r-check');
      await p.waitForFunction(() => /Not a driver in Verizon|None of those|no Verizon driver/i.test((document.getElementById('r-out') || {}).textContent || '') || !!(document.getElementById('error') && !document.getElementById('error').hidden), null, { timeout: 200000 }).catch(() => {});
      rec.out = await p.evaluate(() => ({ out: (document.getElementById('r-out') || {}).textContent.trim().slice(0, 200), err: document.getElementById('error') && !document.getElementById('error').hidden ? document.getElementById('error').textContent.slice(0, 200) : '', del: document.getElementById('r-delete').disabled, rows: document.querySelectorAll('#r-out tbody tr').length }));
      if (!new RegExp('Not a driver in Verizon \\(left alone\\): ' + FAKE).test(rec.out.out)) bad.push('Check with a made-up name says "' + (rec.out.out || rec.out.err) + '"');
      if (rec.out.rows) bad.push('Check with a made-up name lists ' + rec.out.rows + ' drivers');
      if (!rec.out.del) bad.push('Delete from Verizon came on after a Check that found nobody');
      rec.calls = p.w.calls.slice(c0).map(c => c.fn + ':' + c.op);
      if (p.w.calls.slice(c0).some(c => c.fn === 'save')) bad.push('Check saved something');
      await p.evaluate(() => document.getElementById('r-out').scrollIntoView());
      await shot(p, 'gps-remove-drivers-check');
      await p.fill('#r-names', '');
    } finally {
      await p.unroute(/cloudfunctions\.net\/gps|\/gps$/, guard);
    }
    if (blocked) bad.push(blocked + ' delete calls were stopped by the guard (nothing should have asked to delete)');
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.84 (#608, rules audit): one rule each for load rules, plants, trailer numbers, loadout names, loading order and dates. A
  // smoke test of the screens that use them, with three Case loads of the test's own: RULEPT EARLY and RULEPT LATE leave 6:00 AM
  // today and are not loaded (behind), RULEPT LATER leaves tomorrow 11:00 PM. A trailer typed as 014 on Case Loadout must save
  // and show as T-14; every trailer number on the screens reads T- and the number, no zeros in front; the four loadouts carry
  // their names; Daily Case Loadout, the Late Forecast and the report's Still to load list the loads in the same order (the
  // truck that leaves first, first, when behind); Darden and Gordon Food (outside carriers) are never marked late.
  await write('Rules: loadouts, trailer numbers, loading order, reports (6.84)', async (p, rec) => {
    const bad = [];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const L = require(path.join(__dirname, '..', '..', 'src', 'logic.js'));
    // Trailer-like words on a page that do not read T-<number> with no zeros in front ("T-014", "T014", "T 14").
    const oddTrailers = (pg) => pg.evaluate(() => { const t = document.body.innerText + ' ' + [...document.querySelectorAll('input')].map(i => i.value).join(' ');
      return [...new Set((t.match(/\bT[- ]?0\d+\b|\bT\d+\b|\bT \d+\b/g) || []))].slice(0, 6); });
    rec.areas = {};
    const TITLE = { CASE: 'Case', TOTES: 'Tote', BOXING: 'Boxing', TANKER: 'Tanker' };
    for (const a of ['CASE', 'TOTES', 'BOXING', 'TANKER']) {
      await open(p, 'loadout.html?area=' + a);
      await p.waitForSelector('#rows tr, .empty', { timeout: 30000 }).catch(() => {});
      await p.waitForTimeout(2500);
      const s = await p.evaluate(() => ({ h1: (document.getElementById('title') || {}).textContent || '', rows: document.querySelectorAll('#rows tr[data-row]').length, err: document.getElementById('error') && !document.getElementById('error').hidden ? document.getElementById('error').textContent.slice(0, 120) : '' }));
      s.odd = await oddTrailers(p);
      rec.areas[a] = s;
      if (!new RegExp('\\b' + TITLE[a] + '\\b').test(s.h1)) bad.push('loadout.html?area=' + a + ' is titled "' + s.h1 + '"');
      if (s.err) bad.push(TITLE[a] + ' Loadout says ' + s.err);
      if (s.odd.length) bad.push(TITLE[a] + ' Loadout shows trailers ' + s.odd.join(', '));
      if (p.w.errors.length) { bad.push(TITLE[a] + ' Loadout page errors: ' + p.w.errors.slice(0, 2).join(' | ')); p.w.errors.length = 0; }
    }
    const t = await todayTestLoads(3, { offset: 0, leavesOn: 'Delivery Day', day: { loadType: 'CASE', dispatchTime: 360, startTime: 360 } });
    if (!t.made) throw new Error('no load on the practice copy to copy for the test');
    rec.made = t.made;
    const NAMES = ['RULEPT EARLY', 'RULEPT LATE', 'RULEPT LATER'];
    try {
      const today = operatingDay(), tomorrow = L.addDays(today, 1);
      for (let i = 0; i < 3; i++) {
        const ref = db.collection('runs').doc(t.ids[i]), d = (await ref.get()).data(), pre = Object.keys(d.days || {}).find(k => d.days[k] && d.days[k].runs), day = Object.assign({}, d.days[pre]);
        const set = { run: NAMES[i], coverageType: 'UNITED DAIRY', movementType: '' };
        if (i === 2) {
          // On a Saturday tomorrow is in the next week: the load moves to that week (its weekStart), as a real one would.
          if (L.weekStart(tomorrow) !== d.weekStart) set.weekStart = L.weekStart(tomorrow);
          const days = {}; L.DAYS.forEach(x => { days[x] = { runs: false }; });
          days[L.dayPrefix(tomorrow)] = Object.assign(day, { deliveryDate: tomorrow, departureDate: tomorrow, loadDate: today, loadDayOffset: -1, dispatchTime: 1380, startTime: 1380 });
          set.days = days;
          await ref.update(set);
        } else await ref.set(set, { merge: true });
      }
      await p.waitForTimeout(6000);
      const mineOf = (list) => list.map(s => (s.toUpperCase().match(/RULEPT (EARLY|LATER|LATE)/) || [])[1]).filter(Boolean);
      // Case Loadout: a trailer typed 014 saves as T-14.
      await open(p, 'loadout.html?area=CASE');
      await p.waitForFunction(() => /RULEPT/i.test(document.getElementById('rows').innerText), null, { timeout: 30000 }).catch(() => {});
      await p.waitForTimeout(2000);
      const rowId = await p.evaluate(() => { const tr = [...document.querySelectorAll('#rows tr[data-row]')].find(x => /RULEPT EARLY/i.test(x.textContent)); return tr ? tr.dataset.row : ''; });
      if (!rowId) bad.push('Case Loadout does not list the test loads');
      else {
        const box = 'tr[data-row="' + rowId + '"] input[data-k="trailer"]';
        const savedNow = async () => { const d = (await db.collection('runs').doc(t.ids[0]).get()).data() || {}; const k = Object.keys(d.days || {}).find(x => d.days[x] && d.days[x].runs); return k ? String(d.days[k].trailer || '') : ''; };
        // 6.84 (#621): TBA stays TBA; T014 and 014 both save and show as T-14 (014 last, so the report and Trailers show it too).
        rec.trailers = [];
        for (const [typed, want] of [['TBA', 'TBA'], ['T014', 'T-14'], ['', ''], ['014', 'T-14']]) {
          await p.fill(box, typed);
          await p.press(box, 'Enter');
          let saved = null;
          for (let i = 0; i < 30; i++) { await p.waitForTimeout(500); saved = await savedNow(); if (saved === want) break; }
          await open(p, 'loadout.html?area=CASE');
          await p.waitForSelector(box, { timeout: 30000 }).catch(() => {});
          await p.waitForTimeout(1500);
          const shown = await p.inputValue(box).catch(() => '');
          rec.trailers.push({ typed, saved, shown });
          if (saved !== want) bad.push('a trailer typed "' + typed + '" on Case Loadout saved as "' + saved + '" (should be ' + (want || 'blank') + ')');
          if (shown !== want) bad.push('after a reload Case Loadout shows a trailer typed "' + typed + '" as "' + shown + '"');
        }
      }
      rec.loadoutOrder = mineOf(await p.$$eval('#rows tr[data-row]', x => x.map(r => r.textContent)));
      rec.leaveFirst = await p.evaluate(() => { const e = document.getElementById('leave-first'); return e && !e.hidden ? e.textContent : ''; });
      // The "leaves first" line shows only when a truck that has not left yet will be late (the test's later load is on time).
      if (rec.leaveFirst) note('Rules: Case Loadout shows "' + rec.leaveFirst.slice(0, 80) + '"');
      if (rec.loadoutOrder.indexOf('LATER') >= 0 && rec.loadoutOrder.indexOf('LATER') < Math.max(rec.loadoutOrder.indexOf('EARLY'), rec.loadoutOrder.indexOf('LATE'))) bad.push('Case Loadout lists the load leaving tomorrow before the ones already past their time: ' + rec.loadoutOrder.join(', '));
      await shot(p, 'rules-case-loadout');
      // The Late Forecast: the same order.
      await open(p, 'forecast.html?area=CASE');
      await p.waitForFunction(() => [...document.querySelectorAll('.fc-row')].some(x => /RULEPT/i.test(x.textContent)), null, { timeout: 30000 }).catch(() => {});
      rec.forecastOrder = mineOf(await p.$$eval('.fc-row:not(.fc-head)', x => x.map(r => r.textContent)));
      if (rec.forecastOrder.join() !== rec.loadoutOrder.join()) bad.push('Late Forecast order ' + rec.forecastOrder.join(', ') + ' is not Case Loadout\'s ' + rec.loadoutOrder.join(', '));
      rec.forecastOdd = await oddTrailers(p);
      if (rec.forecastOdd.length) bad.push('the Late Forecast shows trailers ' + rec.forecastOdd.join(', '));
      // The plant report: Still to load in the same order; the trailer as T-14; Darden / Gordon Food never late.
      await open(p, 'manager.html?report=1');
      await p.waitForSelector('#rp-body .mc-banner', { timeout: 30000 }).catch(() => {});
      await p.waitForTimeout(2500);
      const rp = await p.evaluate(() => { const s = [...document.querySelectorAll('#rp-body section')].find(x => /^Still to load/.test((x.querySelector('h3') || {}).textContent || ''));
        return { still: s ? [...s.querySelectorAll('li')].map(li => li.textContent) : [], all: (document.getElementById('rp-body') || {}).innerText || '', lateRows: [...document.querySelectorAll('#rp-body li.bad, #rp-body .mc-routes .behind')].map(x => x.textContent.replace(/\s+/g, ' ').trim()) }; });
      rec.reportOrder = mineOf(rp.still);
      if (rec.reportOrder.join() !== rec.loadoutOrder.join()) bad.push('the plant report Still to load order ' + rec.reportOrder.join(', ') + ' is not Case Loadout\'s ' + rec.loadoutOrder.join(', '));
      if (!/T-14\b/.test(rp.still.join(' '))) bad.push('the plant report does not show the test trailer as T-14: ' + rp.still.filter(x => /RULEPT EARLY/i.test(x)).join(' ').slice(0, 120));
      rec.outsideLate = rp.lateRows.filter(x => /DARDEN|GORDON|GFS|\b(838|878)\b/i.test(x));
      if (rec.outsideLate.length) bad.push('the plant report marks an outside carrier late: ' + rec.outsideLate.join(' | ').slice(0, 160));
      rec.darden = /DARDEN|GORDON|\b878\b|\b838\b/i.test(rp.all);
      if (!rec.darden) note('Rules: no Darden or Gordon Food load on the practice copy today, so the outside carrier rule was checked with the test\'s own loads (the outside carrier steps)');
      await shot(p, 'rules-report');
      // Reports: the rundown and the plant report; Trailers; Shipping & Receiving; Manager Center.
      for (const [label, url] of [['Reports rundown', 'reports.html?view=rundown'], ['Reports', 'reports.html'], ['Trailers', 'trailers.html'], ['Shipping & Receiving', 'scheduler.html'], ['Manager Center', 'manager.html']]) {
        await open(p, url);
        await p.waitForTimeout(4500);
        const s = await p.evaluate(() => ({ err: document.getElementById('error') && !document.getElementById('error').hidden ? document.getElementById('error').textContent.slice(0, 120) : '', words: document.body.innerText.length, wide: document.scrollingElement.scrollWidth > innerWidth + 1,
          late: [...document.querySelectorAll('.bad, .late, .behind, .red')].map(x => x.textContent.replace(/\s+/g, ' ').trim()).filter(x => /DARDEN|GORDON|GFS/i.test(x)).slice(0, 3) }));
        s.odd = await oddTrailers(p);
        // 6.84 (#621): Trailer Assignments shows the test load's trailer as T-14.
        if (label === 'Trailers') { s.hasT14 = await p.evaluate(() => /\bT-14\b/.test(document.body.innerText + ' ' + [...document.querySelectorAll('input')].map(i => i.value).join(' '))); if (!s.hasT14) bad.push('Trailer Assignments does not show the test load\'s trailer as T-14'); }
        rec[label] = s;
        if (s.err) bad.push(label + ' says ' + s.err);
        if (s.words < 60) bad.push(label + ' shows almost nothing');
        if (s.wide) bad.push(label + ' scrolls sideways at 1536');
        if (s.odd.length) bad.push(label + ' shows trailers ' + s.odd.join(', '));
        if (s.late.length) bad.push(label + ' marks an outside carrier late: ' + s.late.join(' | '));
        if (p.w.errors.length) { bad.push(label + ' page errors: ' + p.w.errors.slice(0, 2).join(' | ')); p.w.errors.length = 0; }
      }
      await shot(p, 'rules-manager');
      if (p.w.calls.some(c => /send/i.test((c.op || '') + c.fn))) bad.push('looking at the screens sent something');
    } finally { await t.remove(); rec.removed = true; }
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.85 (#630, look only): Administration marks what the United Dairy Hub changes now: an In the Hub pill in the menu and a
  // note at the top of the item with Change this in the Hub (the practice hub on the practice copy). Every item still opens.
  // Nothing pressed inside an item. Home opens too.
  await write('Administration In the Hub marks; every item opens (6.85, look only)', async (p, rec) => {
    const bad = [];
    await open(p, 'index.html');
    await p.waitForTimeout(3000);
    rec.home = await p.evaluate(() => ({ links: document.querySelectorAll('a[href]').length, words: document.body.innerText.length, err: document.getElementById('error') && !document.getElementById('error').hidden }));
    if (rec.home.links < 5 || rec.home.words < 100 || rec.home.err) bad.push('Home shows ' + JSON.stringify(rec.home));
    await open(p, 'administration.html');
    await p.waitForSelector('.adm-item[data-key]', { timeout: 30000 });
    const calls0 = p.w.calls.length;
    const m = await p.evaluate(async () => { const a = await import('./js/admin-items.js'); return { hub: a.IN_HUB || {}, items: a.ADMIN_GROUPS.flatMap(g => g[2].map(it => ({ key: it[0], title: it[1] }))) }; });
    rec.hubKeys = Object.keys(m.hub);
    if (!rec.hubKeys.length) bad.push('no items are marked as changed in the Hub (admin-items.js IN_HUB)');
    const menu = await p.$$eval('.adm-item[data-key]', b => b.map(x => ({ key: x.dataset.key, hub: !!x.querySelector('em.hub'), pill: (x.querySelector('em') || {}).textContent || '' })));
    rec.menu = menu.length;
    const wrongMark = menu.filter(x => x.hub !== !!m.hub[x.key] && !/Being built/.test(x.pill)).map(x => x.key);
    if (wrongMark.length) bad.push('In the Hub marks wrong on ' + wrongMark.join(', '));
    const missing = rec.hubKeys.filter(k => !menu.some(x => x.key === k));
    if (missing.length) note('Administration: Hub items not in this menu: ' + missing.join(', '));
    rec.opened = 0; rec.failed = [];
    for (const it of menu) {
      // The menu groups fold, so each item is opened by its own address.
      await open(p, 'administration.html?item=' + encodeURIComponent(it.key));
      const ok = await p.waitForFunction((t) => { const h = document.querySelector('#panel h2'); return h && h.textContent.trim() === t; }, (m.items.find(x => x.key === it.key) || {}).title || '', { timeout: 10000 }).then(() => true).catch(() => false);
      if (!ok) { rec.failed.push(it.key + ' (no title)'); continue; }
      // An item on its own page: the page inside loads with words on it.
      const inner = await p.waitForFunction(() => { const f = document.getElementById('frame'); if (!f) { const v = document.querySelector('#panel .adm-view'); return v && !/Loading/.test(v.textContent) ? 'view' : false; }
        try { const d = f.contentDocument; return d && d.readyState === 'complete' && d.body && d.body.innerText.trim().length > 20 ? 'frame' : false; } catch (e) { return 'other'; } }, null, { timeout: 20000 }).then(h => h.jsonValue()).catch(() => '');
      if (!inner) {
        // What the item shows instead (only sizes and whether it still says Loading: these items can hold codes).
        await p.waitForTimeout(8000);
        rec.diag = rec.diag || {};
        rec.diag[it.key] = await p.evaluate(() => { const v = document.querySelector('#panel .adm-view'), f = document.getElementById('frame'); return { view: !!v, frame: !!f, words: v ? v.innerText.trim().length : 0, loading: v ? (v.innerText.match(/Loading[^\n]{0,40}/) || [''])[0] : '', buttons: v ? v.querySelectorAll('button, a').length : 0, err: (document.getElementById('error') || {}).hidden === false }; });
        const d = rec.diag[it.key];
        if ((d.view || d.frame) && d.words > 20 && !d.loading && !d.err) note('Administration: ' + it.key + ' took more than 20 seconds to finish opening');
        else rec.failed.push(it.key + ' (did not load)');
      }
      const hub = await p.evaluate(() => { const n = document.querySelector('#panel .adm-hubnote'); return n ? { words: n.textContent.trim().slice(0, 80), href: (n.querySelector('#to-hub') || {}).href || '' } : null; });
      if (m.hub[it.key]) {
        if (!hub) bad.push(it.key + ' has no Changed in the Hub note');
        else if (!/^https:\/\/ud-distribution-sandbox-hub\.web\.app\/[a-z-]+\.html/.test(hub.href)) bad.push(it.key + ' Change this in the Hub goes to ' + hub.href);
        if (it.key === 'role-templates') { rec.hubNote = hub; await shot(p, 'admin-hub-note'); }
      } else if (hub) bad.push(it.key + ' says it is changed in the Hub but is not on the Hub list');
      rec.opened++;
    }
    if (rec.failed.length) bad.push('Administration items that did not open: ' + rec.failed.join(', '));
    if (p.w.calls.slice(calls0).some(c => c.fn === 'save' || /^(save|send|set|delete|add)/i.test(c.op || ''))) bad.push('looking saved something: ' + p.w.calls.slice(calls0).map(c => c.op).filter(Boolean).join(', '));
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.85 (#631, look only): on Truck Issues a lessor in red says why its email did not go (its own line under it and in the
  // pop-up words); one waiting for the lessor's once-a-day email is amber. The rule itself is checked with made-up notes.
  // Nothing pressed, nothing sent.
  await write('Truck Issues red lessor says why the email did not go (6.85, look only)', async (p, rec) => {
    const bad = [];
    const L = require(path.join(__dirname, '..', '..', 'src', 'logic.js'));
    const row = (notes) => (L.issueRows([{ id: 'x', record_id: 'x', kind: 'TRUCK', truck_number: '999', issue_details: 'Practice test brakes squeak', status: 'OPEN', notes, opened_at: '2026-11-03T09:00:00.000Z' }], 'TRUCK', Date.now())[0] || {});
    const lessor = 'Sent to lessor Idealease 2026-11-03T10:00:00.000Z by practice.audit\n';
    rec.rule = {
      notSent: row(lessor + 'Repair email not sent 2026-11-03T10:01:00.000Z: No email address for Idealease.').emailWhy,
      sentAfter: row(lessor + 'Repair email not sent 2026-11-03T10:01:00.000Z: No email address.\nRepair email sent 2026-11-03T11:00:00.000Z').emailWhy,
      queued: row(lessor + 'Repair email queued for the daily digest 2026-11-03T10:01:00.000Z').emailQueued
    };
    if (rec.rule.notSent !== 'No email address for Idealease.') bad.push('the reason read from the notes is "' + rec.rule.notSent + '"');
    if (rec.rule.sentAfter) bad.push('a reason still shows after the email went: ' + rec.rule.sentAfter);
    if (rec.rule.queued !== true) bad.push('an email waiting for the once-a-day email is not read as waiting');
    await open(p, 'issues.html?kind=TRUCK');
    await p.waitForSelector('#rows tr[data-id], .empty', { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(3000);
    const calls0 = p.w.calls.length;
    const pills = await p.evaluate(() => [...document.querySelectorAll('#rows .pill.bad, #rows .pill.warn, #rows .pill.yes')].filter(x => x.title && /lessor|Emailed to|Marked for|Waiting for|went out blank/i.test(x.title + ' ' + x.className))
      .map(x => ({ cls: x.className.replace('pill', '').trim(), title: x.title, why: ((x.nextElementSibling && x.nextElementSibling.matches('small.why')) ? x.nextElementSibling.textContent : '') })));
    const red = pills.filter(x => x.cls === 'bad'), amber = pills.filter(x => x.cls === 'warn');
    rec.pills = { green: pills.filter(x => x.cls === 'yes').length, red: red.length, amber: amber.length, withWhy: red.filter(x => x.why).length };
    // Only the wording is written down (who marked it is left out).
    rec.redWords = red.slice(0, 4).map(x => x.title.replace(/ by [^,]+, but/, ' by ..., but'));
    red.forEach(x => {
      if (!/^(Marked for .+, but the email has not gone(: .+)?\. Press Lessor to send it again\.|The email to .+ went out blank\. Press Lessor to send it again\.)$/.test(x.title)) bad.push('a red lessor says "' + x.title.slice(0, 120) + '"');
      if (x.why && !x.title.includes(x.why.replace(/\.$/, ''))) bad.push('the line under a red lessor ("' + x.why + '") is not in its pop-up words');
    });
    amber.forEach(x => { if (!/^Waiting for .+'s once-a-day repair email \(Administration > Repair Email\)\.$/.test(x.title)) bad.push('an amber lessor says "' + x.title.slice(0, 120) + '"'); });
    if (!red.length) note('Truck Issues: no red lessor on the practice copy, so the reason words were checked with made-up notes only');
    else if (!rec.pills.withWhy) note('Truck Issues: the red lessors on the practice copy have no saved reason (marked before 6.85), so they say the email has not gone without a why');
    await shot(p, 'truck-issues-lessor');
    if (p.w.calls.slice(calls0).some(c => c.fn === 'save' || /send|lessor|email/i.test(c.op || ''))) bad.push('looking sent or saved something');
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.85 (#635): Truck Issues' Lessor button emails right away, even when the lessor is set to Once a day; a green or red box
  // at the top says what happened; a pale button says why under the buttons. The test writes a test write-up of its own on an
  // Idealease truck, sets Idealease to Once a day on the practice copy (put back after), and presses Lessor. On the practice copy
  // the email can only go to the person who pressed it (the test account's own inbox), never to Idealease: the test checks the
  // email log says exactly that and stops with a failure if it went anywhere else. The write-up is deleted after.
  await write('Truck Issues Lessor emails now with Once a day; the box says what happened (6.85)', async (p, rec) => {
    const bad = [];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const unit = ((report.writes.find(w => w.name === 'Truck Issues Idealease leased and route number (look only)') || {}).idealease || [])[0];
    if (!unit) throw new Error('no Idealease truck found to use');
    rec.unit = unit;
    const id = 'MAIL_PRACTICE_TEST_lessor_press_tractor', TEXT = 'Practice test: Lessor button (deleted by the test)';
    const ref = db.collection('maintenance').doc(id), setRef = db.collection('private').doc('repairEmail');
    const setBefore = await setRef.get();
    const t0 = new Date().toISOString();
    try {
      // Idealease set to Once a day (only its mode; addresses untouched and never written down).
      const s = setBefore.exists ? setBefore.data() : {};
      rec.modeBefore = ((s.routes || {}).IDEALEASE || {}).mode || '(default)';
      rec.hasAddress = !!(((s.routes || {}).IDEALEASE || {}).emails || []).length;
      const mail = (await db.collection('private').doc('emailSettings').get()).data() || {};
      rec.sending = mail.sending !== false;
      // With the practice copy's sending OFF nothing can go out, so Idealease gets the test account as its address for the test:
      // the press then goes all the way to sending (and is stopped by Sending OFF) instead of stopping at "no address". With
      // sending ON the address is left as it is.
      rec.testAddress = !rec.sending && !rec.hasAddress;
      await setRef.set({ routes: { IDEALEASE: Object.assign({ mode: 'DAILY' }, rec.testAddress ? { emails: [EMAIL] } : {}) } }, { merge: true });
      await ref.set({ record_id: 'MAIL|PRACTICE_TEST_lessor_press|tractor', kind: 'TRUCK', truck_number: unit, driver: 'PRACTICE TEST', route_id: '', issue_details: TEXT, status: 'OPEN',
        opened_at: new Date(Date.now() - 1800000).toISOString(), source_type: 'PRACTICE_TEST', source_id: id, notes: '' });
      await open(p, 'issues.html?kind=TRUCK');
      await p.waitForFunction((t) => [...document.querySelectorAll('#rows tr[data-id]')].some(x => x.textContent.includes(t)), TEXT, { timeout: 30000 });
      await p.waitForTimeout(1000);
      const look = () => p.evaluate((t) => { const tr = [...document.querySelectorAll('#rows tr[data-id]')].find(x => x.textContent.includes(t)); if (!tr) return null;
        const b = (s) => { const x = tr.querySelector(s); return x ? { on: !x.disabled, title: x.title } : null; };
        const head = [...document.querySelectorAll('#head th')].map(h => h.textContent.trim()), td = tr.children[head.indexOf('Emailed')];
        return { lessor: b('[data-step="lessor"]'), garage: b('[data-step="garage"]'), why: (tr.querySelector('small.acts-why') || {}).textContent || '', emailed: td ? { text: td.textContent.trim(), cls: (td.querySelector('.pill') || {}).className || '' } : null }; }, TEXT);
      rec.before = await look();
      if (!rec.before || !rec.before.lessor || !rec.before.lessor.on) bad.push('the Lessor button on the test write-up is not pressable: ' + JSON.stringify(rec.before));
      // Pale buttons say why, on every row of the list.
      rec.pale = await p.evaluate(() => [...document.querySelectorAll('#rows tr[data-id]')].map(tr => ({ off: [...tr.querySelectorAll('[data-step="lessor"], [data-step="garage"]')].some(x => x.disabled), why: (tr.querySelector('small.acts-why') || {}).textContent || '', edit: !!tr.querySelector('[data-step="repaired"]:not([disabled])') }))
        .filter(x => x.off && x.edit));
      rec.paleNoWhy = rec.pale.filter(x => !x.why).length;
      rec.paleWords = [...new Set(rec.pale.map(x => x.why.replace(/^[^:,]*?(, so|:)/, '…$1')))].slice(0, 6);
      if (rec.paleNoWhy) bad.push(rec.paleNoWhy + ' of ' + rec.pale.length + ' rows with a pale Lessor or Garage button say no reason under the buttons');
      await shot(p, 'lessor-before');
      // Press Lessor.
      const t = Date.now();
      await p.locator('#rows tr[data-id]', { hasText: TEXT }).locator('[data-step="lessor"]').click();
      await p.waitForSelector('#info:not([hidden])', { timeout: 30000 }).catch(() => {});
      await p.waitForTimeout(1500);
      rec.box = await p.evaluate(() => { const i = document.getElementById('info'); return i && !i.hidden ? { cls: i.className, text: i.textContent.trim() } : null; });
      rec.ms = Date.now() - t;
      const notes = String(((await ref.get()).data() || {}).notes || '');
      rec.notes = notes.split('\n').map(x => x.replace(/ by \S+@\S+/, ' by …').replace(/ to [^;\n]*@[^;\n]*/g, ' to …')).filter(Boolean);
      // The email log: what happened to the email, and where it went (only whether it went to the test account).
      const logs = (await db.collection('sentEmails').where('at', '>=', t0).get()).docs.map(d => d.data()).filter(x => x.kind === 'Repair email' && String(x.label || '').includes(unit));
      rec.log = logs.map(x => ({ status: x.status, testCopy: x.testCopy, toTest: (x.sentTo || []).every(a => String(a).toLowerCase() === EMAIL), sentTo: (x.sentTo || []).length, reason: String(x.reason || '').replace(/\S+@\S+/g, '…').slice(0, 120) }));
      if (logs.some(x => (x.sentTo || []).some(a => String(a).toLowerCase() !== EMAIL))) bad.push('THE EMAIL WENT TO SOMEONE OTHER THAN THE TEST ACCOUNT');
      if (!rec.box) bad.push('no box at the top after pressing Lessor');
      else {
        const sent = logs.some(x => x.status === 'SENT');
        if (/queued|daily digest|once-a-day|daily repair email/i.test(rec.box.text)) bad.push('with Once a day the box says ' + rec.box.text);
        if (sent && !/\bdone\b/.test(rec.box.cls)) bad.push('the email went but the box is ' + rec.box.cls);
        if (!sent && !/\berror\b/.test(rec.box.cls)) bad.push('the email did not go but the box is ' + rec.box.cls + ': ' + rec.box.text);
        if (!sent && !/Press Lessor to try again/.test(rec.box.text)) bad.push('the red box does not say to press Lessor again: ' + rec.box.text);
        if (!logs.length && !/Repair email not sent/.test(notes)) bad.push('pressing Lessor wrote nothing to the email log and no reason on the write-up');
      }
      if (/Repair email queued for the daily digest/.test(notes)) bad.push('the write-up says queued for the daily digest');
      await p.waitForTimeout(1500);
      rec.after = await look();
      if (rec.after && rec.after.emailed && /yes/.test(rec.after.emailed.cls) && !/Already emailed/.test(rec.after.why)) bad.push('after the email went the pale buttons say "' + rec.after.why + '"');
      await shot(p, 'lessor-after');
      if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    } finally {
      await ref.delete().catch(() => {});
      rec.removed = !(await ref.get()).exists;
      if (setBefore.exists) await setRef.set(setBefore.data()); else await setRef.delete();
      rec.settingsPutBack = true;
    }
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.86 (#638): Inventory. The test makes two products of its own (a supply counted at 20 and a milk product), and on Inventory:
  // takes 3 out by hand (Should have 17, a History line), sets LOW AT 18 (the line turns red, in the one red), gives the milk
  // product a Uses list (2 of the supply each), and prints labels for the supply with print stopped (nothing reaches a printer):
  // the label has its own UD code and a Code 128 barcode. Bring in our milk products is looked at, not pressed (it would add
  // every product on the Products list). Everything the test made is deleted after, its History lines too.
  const invTest = async () => {
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const R = require(path.join(__dirname, '..', '..', 'src', 'plant-rules.js'));
    const NAMES = { supply: 'PRACTICE TEST INV SUPPLY', milk: 'PRACTICE TEST INV MILK' };
    const clear = async () => {
      const its = (await db.collection('receivingItems').get()).docs.filter(d => /^PRACTICE TEST INV /.test(d.data().name || ''));
      for (const d of its) {
        for (const m of (await db.collection('inventoryMoves').where('itemId', '==', d.id).get()).docs) await m.ref.delete();
        await d.ref.delete();
      }
      return its.length;
    };
    const make = async () => {
      await clear();
      const stamp = new Date().toISOString(), base = { sku: '', supplierId: '', unit: 'Cases', low: null, barcodes: [], uses: [], status: 'ACTIVE', countAt: stamp, countBy: EMAIL, receivedSince: 0, madeSince: 0, usedSince: 0, createdAt: stamp, createdBy: EMAIL, editedAt: stamp, editedBy: EMAIL };
      const s = db.collection('receivingItems').doc('PRACTICE_TEST_INV_SUPPLY'), m = db.collection('receivingItems').doc('PRACTICE_TEST_INV_MILK');
      await s.set(Object.assign({}, base, { name: NAMES.supply, kind: R.INVENTORY_KINDS[0], countQty: 20 }));
      await m.set(Object.assign({}, base, { name: NAMES.milk, kind: R.MILK_KIND, countQty: null, countAt: '' }));
      return { s, m };
    };
    return { db, R, NAMES, clear, make };
  };
  await write('Inventory take out, low at, uses and labels (6.86)', async (p, rec) => {
    const bad = [];
    const T = await invTest();
    rec.cleared = await T.clear();
    const { s, m } = await T.make();
    const data = async (ref) => (await ref.get()).data() || {};
    const until = async (fn, ms) => { for (let i = 0; i < ms / 500; i++) { if (await fn()) return true; await p.waitForTimeout(500); } return false; };
    try {
      await open(p, 'inventory.html');
      await p.waitForSelector('#oh-rows tr', { timeout: 30000 });
      await p.waitForFunction((n) => [...document.querySelectorAll('#oh-rows tr[data-row]')].some(x => x.textContent.includes(n)), T.NAMES.supply, { timeout: 30000 });
      const row = '#oh-rows tr[data-row="' + s.id + '"]';
      rec.heads = await p.$$eval('#tab-onhand thead th', h => h.map(x => x.textContent.trim()));
      rec.acts = await p.$$eval(row + ' .inv-acts button', b => b.map(x => x.textContent.trim()));
      if (rec.acts.join('|') !== 'Take out|Count|Label|History') bad.push('the supply line buttons read ' + rec.acts.join(', '));
      // (A) Take out by hand.
      await p.click(row + ' [data-use]');
      await p.waitForSelector('#ed-qty', { timeout: 8000 });
      await p.fill('#ed-qty', '3');
      const forOpt = await p.$$eval('#ed-for option', o => o.map(x => x.value || x.textContent).filter(Boolean));
      rec.forOptions = forOpt.length;
      if (forOpt.length) await p.selectOption('#ed-for', forOpt[0]);
      await p.click('#ed-save');
      rec.usedSaved = await until(async () => Number((await data(s)).usedSince) === 3, 15000);
      if (!rec.usedSaved) bad.push('Take out 3 saved used ' + (await data(s)).usedSince);
      await p.waitForTimeout(1500);
      rec.should = await p.$eval(row + ' td.big', e => e.textContent.trim()).catch(() => '');
      if (rec.should !== '17') bad.push('after taking 3 of 20 out, Should have reads ' + rec.should);
      const moves = (await T.db.collection('inventoryMoves').where('itemId', '==', s.id).get()).docs.map(d => d.data());
      rec.moves = moves.map(x => x.kind + ' ' + x.qty + ' ' + (x.how || ''));
      if (!moves.some(x => x.kind === 'USED' && x.qty === 3 && x.how === 'HAND')) bad.push('no USED 3 by hand History line (' + rec.moves.join(', ') + ')');
      // (E) LOW AT 18: the line is red.
      await p.click(row + ' [data-low]');
      await p.waitForSelector('#ed-qty', { timeout: 8000 });
      await p.fill('#ed-qty', '18');
      await p.click('#ed-save');
      rec.lowSaved = await until(async () => Number((await data(s)).low) === 18, 15000);
      if (!rec.lowSaved) bad.push('LOW AT 18 saved ' + (await data(s)).low);
      await p.waitForTimeout(1500);
      rec.low = await p.evaluate((sel) => { const tr = document.querySelector(sel); if (!tr) return null; const td = tr.querySelector('td.strong'), cs = getComputedStyle(td), rs = getComputedStyle(tr);
        return { cls: tr.className, word: (td.querySelector('small') || {}).textContent || '', color: cs.color, bg: rs.backgroundColor, lowBtn: (document.getElementById('oh-low') || {}).textContent || '' }; }, row);
      if (!rec.low || !/\blow\b/.test(rec.low.cls) || !/Low/.test(rec.low.word)) bad.push('with 17 and LOW AT 18 the line is not marked low: ' + JSON.stringify(rec.low));
      await colorCheck(p, 'Inventory (a low line)', bad, rec);
      await shot(p, 'inventory-low');
      // (C) Milk Products: the tab, Bring in our milk products (looked at only) and a Uses list.
      await p.click('[data-type="milk"]');
      await p.waitForFunction((n) => [...document.querySelectorAll('#oh-rows tr[data-row]')].some(x => x.textContent.includes(n)), T.NAMES.milk, { timeout: 20000 }).catch(() => bad.push('the test milk product is not on the Milk Products tab'));
      rec.milkAdd = await p.evaluate(() => { const b = document.getElementById('milk-add'); return b ? { shown: !b.hidden, text: b.textContent.trim() } : null; });
      if (!rec.milkAdd || !rec.milkAdd.shown) bad.push('no Bring in our milk products button on the Milk Products tab');
      const mrow = '#oh-rows tr[data-row="' + m.id + '"]';
      await p.click(mrow + ' [data-uses]').catch(() => bad.push('the milk product has no Uses button'));
      await p.waitForSelector('#u-add', { timeout: 8000 }).catch(() => {});
      if (await p.$('#u-add')) {
        await p.click('#u-add');
        await p.selectOption('[data-urow="0"][data-uf="itemId"]', s.id);
        await p.fill('[data-urow="0"][data-uf="qty"]', '2');
        await p.click('#u-save');
        rec.uses = await until(async () => { const u = (await data(m)).uses || []; return u.length === 1 && u[0].itemId === s.id && u[0].qty === 2; }, 15000);
        if (!rec.uses) bad.push('the Uses list saved ' + JSON.stringify((await data(m)).uses));
      }
      await shot(p, 'inventory-milk');
      // (F) Labels: the print window is stopped before it opens (nothing reaches a printer).
      await p.click('[data-type="supplies"]');
      await p.waitForSelector(row + ' [data-label]', { timeout: 15000 });
      await p.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; window.__labels = { n: document.querySelectorAll('#labels .lbl').length, svg: document.querySelectorAll('#labels .lbl svg').length, code: ((document.querySelector('#labels .lbl-code') || {}).textContent || ''), page: ((document.getElementById('label-page') || {}).textContent || '') }; }; });
      await p.click(row + ' [data-label]');
      await p.waitForSelector('#l-count', { timeout: 8000 });
      await p.fill('#l-count', '2');
      await p.fill('#l-lot', 'PT1');
      await p.click('#l-print');
      await until(async () => p.evaluate(() => window.__printed > 0), 15000);
      rec.labels = await p.evaluate(() => ({ printed: window.__printed, out: window.__labels || null }));
      rec.labelCode = (await data(s)).labelCode || '';
      if (!rec.labels.printed) bad.push('Print labels did not get to the print window');
      else {
        const o = rec.labels.out || {};
        if (o.n !== 2 || o.svg !== 2) bad.push('2 labels asked for, ' + o.n + ' made (' + o.svg + ' barcodes)');
        if (!/^UD[A-Z0-9]{6}$/.test(rec.labelCode) || o.code !== rec.labelCode) bad.push('the label code is "' + o.code + '" (saved "' + rec.labelCode + '")');
        if (!/size:\s*4in 6in/.test(o.page || '')) bad.push('the labels are not 4 x 6 (' + o.page + ')');
      }
      await shot(p, 'inventory-labels');
      if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
      rec.forTablet = { id: s.id, code: rec.labelCode };
    } finally {
      rec.removed = await T.clear();
    }
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.86 (#638 B): the Plant Station's Boxing Loadout has a TAKE OUT tab. The test makes its own Boxing station and supply
  // (counted at 20, with a label code), picks it and takes 2 out, scans its label once (1 more out), and presses − (one back).
  // Station, product and its History lines are removed after.
  await write('Plant Station Boxing TAKE OUT: pick, scan and put back (6.86)', async (p, rec) => {
    const bad = [];
    const T = await invTest();
    const { s } = await T.make();
    const SR = require(path.join(__dirname, '..', '..', 'src', 'scan-rules.js'));
    await s.set({ labelCode: 'UDPTTEST', barcodes: [SR.barcodeKey(SR.parseScan('UDPTTEST', new Date()))].filter(Boolean) }, { merge: true });
    const adm = (op, f) => p.evaluate(([o, x]) => import('./js/app.js').then(m => m.callServer('admin', Object.assign({ op: o }, x))), [op, f]);
    await open(p, 'index.html');
    const stName = 'Practice test Boxing Take Out';
    for (const o of ((await adm('stations', { kind: 'PLANT' })).stations || []).filter(x => x.name === stName)) await adm('stationRemove', { key: o.key });
    const st = ((await adm('stationAdd', { kind: 'PLANT', type: 'BOXING', facilityId: 'fac_uniontown', name: stName })).stations || []).find(x => x.name === stName);
    const tab = st ? await newPage({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, takeOutLook: true }) : null;
    const used = async () => Number(((await s.get()).data() || {}).usedSince) || 0;
    const until = async (fn, ms) => { for (let i = 0; i < ms / 500; i++) { if (await fn()) return true; await tab.waitForTimeout(500); } return false; };
    try {
      if (!st) throw new Error('could not add the test station');
      const code = (await adm('stationCode', { key: st.key })).code;
      await open(tab, 'plant-station.html');
      await tab.waitForSelector('#code-box input[name="code"]', { timeout: 30000 });
      await tab.fill('#code-box input[name="code"]', code);
      await tab.click('#code-box button[type="submit"]');
      await tab.waitForSelector('#tabs [data-view="takeout"]', { timeout: 45000 });
      rec.tabs = await tab.$$eval('#tabs [data-view]', b => b.map(x => x.dataset.view));
      await tab.click('#tabs [data-view="takeout"]');
      await tab.waitForSelector('[data-to="pick"]', { timeout: 20000 });
      await tab.waitForFunction((id) => [...document.querySelectorAll('[data-to="pick"] option')].some(o => o.value === id), s.id, { timeout: 20000 });
      await tab.selectOption('[data-to="pick"]', s.id);
      await tab.fill('[data-to="qty"]', '2');
      await tab.click('[data-to="take"]');
      rec.pick = await until(async () => (await used()) === 2, 15000);
      if (!rec.pick) bad.push('Take out 2 on the tablet left used at ' + (await used()));
      // A scan of its label (typed into the scan box as the scanner does, then Enter).
      await tab.waitForTimeout(1000);
      await tab.focus('[data-scan-box]').catch(() => {});
      await tab.keyboard.type('UDPTTEST', { delay: 15 });
      await tab.keyboard.press('Enter');
      rec.scan = await until(async () => (await used()) === 3, 12000);
      if (!rec.scan) note('Plant Station TAKE OUT: a typed scan of the label did not take one out (used ' + (await used()) + '); a real scanner may type differently');
      await tab.waitForTimeout(1500);
      rec.list = await tab.$$eval('.to-table tbody tr', t => t.map(x => x.textContent.replace(/\s+/g, ' ').trim()).filter(x => /PRACTICE TEST INV/.test(x)));
      if (!rec.list.length) bad.push('the take-out is not in the Taken out today list');
      const before = await used();
      await tab.click('.to-table tbody tr:has-text("PRACTICE TEST INV SUPPLY") [data-to="back"]');
      rec.back = await until(async () => (await used()) === before - 1, 12000);
      if (!rec.back) bad.push('− did not put one back (used ' + (await used()) + ', was ' + before + ')');
      await colorCheck(tab, 'Plant Station TAKE OUT', bad, rec);
      await shot(tab, 'plant-station-takeout');
      if (tab.w.errors.length) bad.push('page errors: ' + tab.w.errors.slice(0, 3).join(' | '));
    } finally {
      if (tab) await tab.done().catch(() => {});
      if (st) await adm('stationRemove', { key: st.key }).catch(e => bad.push('the test station was not removed: ' + String(e.message).slice(0, 80)));
      rec.removed = await T.clear();
    }
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.86 (#634): the rights each role has by itself. Every role but Viewer can still open the app and its screens as before;
  // the new Sales role sees routes; a Manager may edit customers; nobody but an administrator gets the admin rights.
  await write('Role rights after the Hub change (6.86, look only)', async (p, rec) => {
    const bad = [];
    const RT = require(path.join(__dirname, '..', '..', 'src', 'rights.js'));
    rec.roles = RT.ROLES.slice();
    RT.ROLES.filter(r => r !== 'ADMINISTRATOR').forEach(role => {
      const list = RT.DEFAULTS[role] || [];
      if (!list.includes('dashboard.read')) bad.push(role + ' cannot open the app (no dashboard.read)');
      if (list.some(c => RT.RESTRICTED(c))) bad.push(role + ' has an administrator right');
    });
    const need = { PLANT_EMPLOYEE: ['plant.read', 'plant.write', 'plant.loading.write'], DRIVER: ['self.checkin.write'], DISPATCHER: ['dispatch.read'], MANAGER: ['customers.edit'], SALES: ['routes.read', 'customerPickup.read'] };
    Object.keys(need).forEach(role => need[role].forEach(c => { if (!(RT.DEFAULTS[role] || []).includes(c)) bad.push(role + ' is missing ' + c); }));
    rec.withNew = RT.withNewRights({ MANAGER: ['dashboard.read'] }, { MANAGER: { updatedAt: '2026-10-01T00:00:00.000Z' } }).MANAGER;
    if (!rec.withNew.includes('customers.edit')) bad.push('a Manager template saved before 11-4 does not get customers.edit');
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.85 (#624, look only): the Blow Mold has no CIP washes and no changeovers. Its tablet has no Mold Change or CIP tab, no
  // CHANGEOVER button and no CIP clock; its Plant Production page has no Changeovers or CIP washes box and none in the timeline
  // key; Line Targets has no changeover standard or CIP hours boxes for it (another line still has them). Nothing pressed.
  await write('Blow Mold: no CIP washes and no changeovers (6.85, look only)', async (p, rec) => {
    const bad = [];
    const calls0 = p.w.calls.length;
    // The tablet opens the line it remembers first, so forget it before opening the Blow Mold.
    await open(p, 'line.html?line=ut_prod_blow_mold');
    await p.evaluate(() => { try { localStorage.removeItem('udProductionLine'); } catch (e) { /* none */ } }).catch(() => {});
    await open(p, 'line.html?line=ut_prod_blow_mold');
    const up = await p.waitForFunction(() => { const s = document.getElementById('state-name'); return s && s.offsetParent && s.textContent.trim() && document.querySelectorAll('#actions button').length; }, null, { timeout: 30000 }).then(() => true).catch(() => false);
    if (!up) bad.push('the Blow Mold tablet did not show its bar and tabs');
    else {
      rec.tablet = await p.evaluate(() => ({ line: (document.getElementById('line-name') || {}).textContent || '', tabs: [...document.querySelectorAll('#actions button')].map(b => b.dataset.act + ':' + b.firstChild.textContent.trim()), co: !document.getElementById('go-co').hidden && !!document.getElementById('go-co').offsetParent,
        state: document.getElementById('state-name').textContent.trim(), cip: !document.getElementById('cip-strip').hidden }));
      if (!/BLOW/i.test(rec.tablet.line)) bad.push('the tablet opened ' + rec.tablet.line + ', not the Blow Mold');
      if (rec.tablet.tabs.some(t => /^(changeover|cip):/.test(t) || /mold change|cip/i.test(t))) bad.push('the Blow Mold tablet tabs read ' + rec.tablet.tabs.join(', '));
      if (rec.tablet.co && !/changeover/i.test(rec.tablet.state)) bad.push('the Blow Mold tablet shows a CHANGEOVER button');
      if (rec.tablet.cip) bad.push('the Blow Mold tablet shows the CIP clock');
      await shot(p, 'blow-mold-tablet');
    }
    await open(p, 'production.html?line=ut_prod_blow_mold');
    await p.waitForFunction(() => /BLOW MOLD/i.test((document.getElementById('page-title') || {}).textContent || '') && (document.getElementById('detail') || {}).children && document.getElementById('detail').children.length, null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(2000);
    rec.page = await p.evaluate(() => ({ boxes: [...document.querySelectorAll('#detail h2, #detail h3')].map(x => x.textContent.trim()), key: [...document.querySelectorAll('#detail .pd-key span')].map(x => x.textContent.trim()), words: (document.getElementById('detail') || {}).innerText || '' }));
    const boxes = rec.page.boxes.filter(x => /changeover|cip/i.test(x));
    if (boxes.length) bad.push('the Blow Mold page has the boxes ' + boxes.join(', '));
    const key = rec.page.key.filter(x => /changeover|cip/i.test(x));
    if (key.length) bad.push('the Blow Mold timeline key has ' + key.join(', '));
    if (/Since CIP|CIP wash/i.test(rec.page.words)) bad.push('the Blow Mold page talks about CIP washes');
    rec.page.words = rec.page.words.length;
    await shot(p, 'blow-mold-page');
    await open(p, 'linetargets.html?line=ut_prod_blow_mold');
    await p.waitForFunction(() => (document.getElementById('setup') || {}).innerHTML, null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(1500);
    rec.targets = await p.evaluate(() => ({ co: !!document.getElementById('setup-co'), cip: !!document.getElementById('setup-cip'), weight: !!document.getElementById('setup-jugWeightTarget'), words: (document.getElementById('setup') || {}).innerText || '' }));
    if (rec.targets.co || rec.targets.cip) bad.push('Line Targets for the Blow Mold still has the ' + [rec.targets.co ? 'changeover standard' : '', rec.targets.cip ? 'CIP hours' : ''].filter(Boolean).join(' and ') + ' box');
    if (!rec.targets.weight) bad.push('Line Targets for the Blow Mold lost its jug weight boxes');
    if (/changeover|CIP/i.test(rec.targets.words)) bad.push('Line Targets for the Blow Mold talks about changeovers or CIP');
    rec.targets.words = rec.targets.words.length;
    await shot(p, 'blow-mold-targets');
    // Another line still has both boxes.
    const other = await p.$$eval('[data-line]', b => (b.map(x => x.dataset.line).find(x => x && x !== 'ut_prod_blow_mold')) || '');
    if (other) {
      await open(p, 'linetargets.html?line=' + encodeURIComponent(other));
      await p.waitForFunction(() => (document.getElementById('setup') || {}).innerHTML, null, { timeout: 30000 }).catch(() => {});
      await p.waitForTimeout(1500);
      rec.otherLine = await p.evaluate(() => ({ co: !!document.getElementById('setup-co'), cip: !!document.getElementById('setup-cip') }));
      if (!rec.otherLine.co) bad.push('Line Targets for another line lost its changeover standard box');
    }
    if (p.w.calls.slice(calls0).some(c => c.fn === 'save' || /save|start|set/i.test(c.op || ''))) bad.push('looking saved something: ' + p.w.calls.slice(calls0).map(c => c.op).join(', '));
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.85 (#620, look only): the one color set on the other screens: every loadout area, Trailer Assignments, Plant Material
  // Trailers, Reports, Manager Center, Shift Notes and the Late Forecast.
  await write('One color set: loadouts, Trailers, Reports, Shift Notes (6.85, look only)', async (p, rec) => {
    const bad = [];
    for (const [label, url] of [['Daily Case Loadout', 'loadout.html?area=CASE'], ['Daily Tote Loadout', 'loadout.html?area=TOTES'], ['Daily Boxing Loadout', 'loadout.html?area=BOXING'], ['Daily Tanker Loadout', 'loadout.html?area=TANKER'],
      ['Late Forecast', 'forecast.html?area=CASE'], ['Trailer Assignments', 'trailers.html'], ['Plant Material Trailers', 'jug-trailers.html'], ['Reports', 'reports.html'], ['Plant report', 'manager.html?report=1'], ['Manager Center', 'manager.html'], ['Shift Notes', 'shiftnotes.html'], ['Home', 'index.html']]) {
      await open(p, url);
      await p.waitForTimeout(4000);
      await colorCheck(p, label, bad, rec);
    }
    await shot(p, 'colors-home');
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.83 (#611): the short recap at the top of the shift report: a line for each loadout with how many are loaded and left,
  // and On time or about how far behind. The test puts loads of its own on today's list: on Case Loadout one on time (leaves
  // tomorrow 11:00 PM), one behind (left 6:00 AM today, not loaded), one loaded late, and one outside carrier load past its
  // time and not loaded; on a second loadout (Boxing or Tanker, one with nothing late of its own) only an outside carrier load
  // past its time, so that loadout must still say On time. Read in Manager Center's full report and in the email itself
  // (Print, printing stopped, nothing sent); the forecast and the Manager screen are looked at too. All removed after.
  await write('Shift recap: a line per loadout, outside carrier never late (6.83)', async (p, rec) => {
    const bad = [];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const L = require(path.join(__dirname, '..', '..', 'src', 'logic.js'));
    const NAME = { CASE: 'Case Loadout', BOXING: 'Boxing Loadout', TOTES: 'Tote Loadout', TANKER: 'Tanker Loadout' };
    // The full report pop-up's recap: { 'Case Loadout': { loaded, total, left, status, bad }, ... }.
    const readPop = async () => {
      await open(p, 'manager.html?report=1');
      await p.waitForSelector('#rp-body .mc-banner', { timeout: 30000 }).catch(() => {});
      await p.waitForTimeout(3000);
      return p.evaluate(() => {
        const s = [...document.querySelectorAll('#rp-body section')].find(x => /^Recap \(estimated\) at /.test((x.querySelector('h3') || {}).textContent || ''));
        const out = { banner: (document.querySelector('#rp-body .mc-banner b') || {}).textContent || '', bannerClass: (document.querySelector('#rp-body .mc-banner') || {}).className || '', found: !!s, head: '', areas: {}, all: s ? s.innerText.replace(/\s+/g, ' ').slice(0, 400) : '' };
        if (s) [...s.querySelectorAll('li')].forEach((li, i) => { const a = (li.querySelector('b') || {}).textContent || '', b = (li.querySelector('span') || {}).textContent || '';
          if (i === 0) out.head = a + ' · ' + b; else { const m = b.match(/^(\d+) of (\d+) loaded(?: · (\d+) left)? · ([^·]+)/); out.areas[a] = m ? { loaded: +m[1], total: +m[2], left: m[3] ? +m[3] : 0, status: m[4].trim(), red: li.classList.contains('bad') } : { text: b }; } });
        return out;
      });
    };
    const before = rec.before = await readPop();
    const other = ['BOXING', 'TANKER', 'TOTES'].find(a => !before.areas[NAME[a]]) || ['BOXING', 'TANKER', 'TOTES'].find(a => before.areas[NAME[a]] && before.areas[NAME[a]].status === 'On time');
    if (!other) throw new Error('every loadout but Case is already behind on the practice copy, so an outside carrier load could not be tried on its own: ' + JSON.stringify(before.areas));
    rec.other = NAME[other];
    const t = await todayTestLoads(5, { offset: 0, leavesOn: 'Delivery Day', day: { loadType: 'CASE', dispatchTime: 360, startTime: 360 } });
    if (!t.made) throw new Error('no load on the practice copy to copy for the test');
    rec.made = t.made;
    const NAMES = ['RECAPPT ONTIME', 'RECAPPT BEHIND', 'RECAPPT DONELATE', 'RECAPPT OUTSIDE', 'RECAPPT OUTSIDE2'];
    try {
      const doneAt = new Date().toISOString(), today = operatingDay(), tomorrow = L.addDays(today, 1);
      for (let i = 0; i < 5; i++) {
        const ref = db.collection('runs').doc(t.ids[i]), d = (await ref.get()).data(), pre = Object.keys(d.days || {}).find(k => d.days[k] && d.days[k].runs), day = Object.assign({}, d.days[pre]);
        const set = { run: NAMES[i], coverageType: i >= 3 ? 'OUTSIDE CARRIER' : 'UNITED DAIRY', movementType: '' };
        if (i === 0) {
          // On time: loaded today for tomorrow, leaving tomorrow at 11:00 PM.
          const p2 = L.dayPrefix(tomorrow), days = {};
          L.DAYS.forEach(x => { days[x] = { runs: false }; });
          days[p2] = Object.assign(day, { deliveryDate: tomorrow, departureDate: tomorrow, loadDate: today, loadDayOffset: -1, dispatchTime: 1380, startTime: 1380 });
          if (L.weekStart(tomorrow) !== d.weekStart) set.weekStart = L.weekStart(tomorrow);
          set.days = days;
          await ref.update(set);
          continue;
        }
        if (i === 2) set.days = { [pre]: Object.assign(day, { completeTime: doneAt, loadedComplete: true, loadStatus: 'COMPLETE', plantStartedAt: doneAt }) };
        if (i === 4) set.days = { [pre]: Object.assign(day, { loadType: other }) };
        await ref.set(set, { merge: true });
      }
      await p.waitForTimeout(6000);
      // The forecast (Case): the on-time load is not late, the behind one is, the outside one carries its pill.
      await open(p, 'forecast.html?area=CASE');
      await p.waitForFunction(() => [...document.querySelectorAll('.fc-row')].some(x => /RECAPPT/i.test(x.textContent)), null, { timeout: 30000 }).catch(() => {});
      const fc = rec.forecast = await p.$$eval('.fc-row:not(.fc-head)', x => x.filter(r => /RECAPPT/i.test(r.textContent)).map(r => ({ text: r.textContent.replace(/\s+/g, ' ').trim().slice(0, 120), late: r.classList.contains('late') })));
      const fr = (n) => fc.find(x => x.text.toUpperCase().includes(n.split(' ')[1]));
      if (!fr(NAMES[0])) bad.push('Forecast: the on-time test load is not listed'); else if (fr(NAMES[0]).late) bad.push('Forecast: the on-time test load (leaves tomorrow 11:00 PM) is late: ' + fr(NAMES[0]).text);
      if (!fr(NAMES[1]) || !fr(NAMES[1]).late) bad.push('Forecast: the behind test load is not late: ' + (fr(NAMES[1]) || {}).text);
      if (fr(NAMES[3]) && fr(NAMES[3]).late) bad.push('Forecast: the outside carrier load is late: ' + fr(NAMES[3]).text);
      if (p.w.errors.length) bad.push('Forecast page errors: ' + p.w.errors.slice(0, 2).join(' | '));
      await shot(p, 'recap-forecast');
      // The Manager screen itself still draws its report card.
      await open(p, 'manager.html');
      await p.waitForSelector('#pv-list .mc-pvh', { timeout: 30000 }).catch(() => {});
      await p.waitForTimeout(2000);
      rec.manager = await p.evaluate(() => ({ preview: ((document.getElementById('pv-list') || {}).innerText || '').replace(/\s+/g, ' ').slice(0, 160), wide: document.scrollingElement.scrollWidth > innerWidth + 1 }));
      if (!/Routes\s*\d+ of \d+ loaded/i.test(rec.manager.preview)) bad.push('Manager Center report card reads: ' + rec.manager.preview.slice(0, 120));
      if (rec.manager.wide) bad.push('Manager Center scrolls sideways at 1536');
      await shot(p, 'recap-manager');
      // The full report pop-up.
      const after = rec.after = await readPop();
      if (!after.found) bad.push('the full shift report has no recap box (' + after.banner + ')');
      const cb = before.areas[NAME.CASE] || { loaded: 0, total: 0, left: 0 }, ca = after.areas[NAME.CASE];
      if (!ca || ca.total === undefined) bad.push('the recap has no Case Loadout line: ' + after.all.slice(0, 160));
      else {
        if (ca.total !== cb.total + 4 || ca.loaded !== cb.loaded + 1 || ca.left !== cb.left + 3) bad.push('Case Loadout recap reads ' + ca.loaded + ' of ' + ca.total + ', ' + ca.left + ' left (before the test loads ' + cb.loaded + ' of ' + cb.total + ', ' + cb.left + ' left; 4 added, 1 loaded)');
        if (!/^About .+ behind$/.test(ca.status)) bad.push('Case Loadout recap says "' + ca.status + '" with a load past its time and not loaded');
      }
      const ob = before.areas[NAME[other]] || { loaded: 0, total: 0, left: 0 }, oa = after.areas[NAME[other]];
      if (!oa || oa.total === undefined) bad.push('the recap has no ' + NAME[other] + ' line for the outside carrier load: ' + after.all.slice(0, 160));
      else {
        if (oa.total !== ob.total + 1 || oa.left !== ob.left + 1) bad.push(NAME[other] + ' recap reads ' + oa.loaded + ' of ' + oa.total + ', ' + oa.left + ' left (the outside carrier load should be counted)');
        if (oa.status !== 'On time' || oa.red) bad.push(NAME[other] + ' recap says "' + oa.status + '" with only an outside carrier load past its time (never late)');
      }
      Object.keys(after.areas).forEach(k => { if (!/ Loadout$/.test(k)) bad.push('a recap line is named ' + k); });
      if (/\bcases?\b(?! loadout)/i.test(after.all)) bad.push('the recap shows cases');
      if (/RECAPPT/i.test(after.all)) bad.push('the recap names routes');
      await shot(p, 'recap-report');
      // The email itself (Print builds it in a frame; printing is stopped and the frame read).
      await p.evaluate(() => { window.__mail = ''; new MutationObserver((ms) => ms.forEach(m => m.addedNodes.forEach(n => { if (n.tagName === 'IFRAME') { try { n.contentWindow.print = () => {}; } catch (e) { /* */ } setTimeout(() => { try { window.__mail = n.contentDocument.documentElement.outerHTML; } catch (e) { /* */ } }, 200); } }))).observe(document.body, { childList: true }); });
      await p.click('#print-report');
      await p.waitForFunction(() => window.__mail, null, { timeout: 10000 }).catch(() => {});
      const mail = await p.evaluate(() => window.__mail || '');
      if (!mail) bad.push('the shift report email could not be read from Print');
      else {
        const mp = await newPage({ viewport: { width: 600, height: 900 }, recapMailLook: true });
        try {
          await mp.setContent(mail.replace(/<script[\s\S]*?<\/script>/gi, ''));
          const lines = (await mp.evaluate(() => document.body.innerText)).split('\n').map(s => s.trim()).filter(Boolean);
          rec.mailTop = lines.slice(0, 22);
          const recapOf = (name) => { const i = lines.findIndex(l => l.indexOf(name) === 0); if (i < 0) return null; const both = (lines[i] + ' ' + (lines[i + 1] || '')).replace(name, '').trim(), m = both.match(/^(\d+) of (\d+)(?: · (\d+) left)?/), st = lines.slice(i + 1, i + 4).find(l => /^(✓|⚠)\s*(On time|All loaded|About .+ behind)/.test(l)) || ''; return m ? { loaded: +m[1], total: +m[2], left: m[3] ? +m[3] : 0, status: st.replace(/^(✓|⚠)\s*/, '') } : { text: both }; };
          const mc = rec.mailCase = recapOf(NAME.CASE), mo = rec.mailOther = recapOf(NAME[other]);
          if (!mc || mc.total === undefined) bad.push('the email recap has no Case Loadout line'); else {
            if (ca && (mc.total !== ca.total || mc.loaded !== ca.loaded || mc.left !== ca.left)) bad.push('the email recap Case Loadout reads ' + mc.loaded + ' of ' + mc.total + ', ' + mc.left + ' left; the report ' + ca.loaded + ' of ' + ca.total);
            if (!/^About .+ behind$/.test(mc.status)) bad.push('the email recap Case Loadout says "' + mc.status + '"');
          }
          if (!mo || mo.total === undefined) bad.push('the email recap has no ' + NAME[other] + ' line'); else if (mo.status !== 'On time') bad.push('the email recap ' + NAME[other] + ' says "' + mo.status + '" with only an outside carrier load past its time');
          if (!lines.some(l => /^\d+ of \d+ loaded$/.test(l))) bad.push('the email recap has no "N of M loaded" line');
          // The outside carrier loads in the email's tables: never red or marked.
          const grid = await mp.evaluate(() => [...document.querySelectorAll('tr')].filter(tr => tr.children.length === 4 && !tr.querySelector('table')).map(tr => { const c = [...tr.children]; return { cells: c.map(td => td.textContent.replace(/\s+/g, ' ').trim()), red: c.some(td => /rgb\(180, 35, 24\)|#b42318/i.test(td.style.background + td.style.backgroundColor + td.innerHTML)) }; }));
          rec.mailRows = grid.filter(g => /RECAPPT|Recappt/i.test(g.cells[1] || '')).map(g => (g.red ? 'RED ' : '') + g.cells.join(' | '));
          if (grid.some(g => /Recappt Outside/i.test(g.cells[1] || '') && (g.red || /LATE|BEHIND|⚠/.test(g.cells.join(' '))))) bad.push('the email marks an outside carrier load: ' + rec.mailRows.filter(x => /Outside/i.test(x)).join(' / '));
          await shot(mp, 'recap-email');
        } finally { await mp.done(); }
      }
      if (p.w.calls.some(c => /send/i.test((c.op || '') + c.fn))) bad.push('looking at the report sent something');
      if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    } finally { await t.remove(); rec.removed = true; }
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.83 (#607, look only): on the practice copy, Administration > People has a link to the Hub's People & Access; the link
  // is only drawn on the practice site (the page checks the site name), so it never shows on live.
  await write('Administration People Hub link, practice only (look only)', async (p, rec) => {
    const bad = [];
    await open(p, 'administration.html?item=people');
    await p.waitForSelector('#p-add', { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(1500);
    rec.link = await p.evaluate(() => { const a = document.querySelector('.hub-link a'); return a ? { href: a.getAttribute('href'), text: a.textContent, line: a.parentElement.textContent.slice(0, 120) } : null; });
    if (!rec.link) bad.push('Administration > People on the practice copy has no Hub link');
    else if (!/^https:\/\/ud-distribution-sandbox-hub\.web\.app\/people\.html$/.test(rec.link.href)) bad.push('the Hub link goes to ' + rec.link.href);
    // The live guard: the served page script draws it only when the site name says sandbox.
    const src = await p.evaluate(async () => (await fetch('/js/admin-pages.js', { cache: 'no-store' })).text());
    rec.guarded = /\/sandbox\/\.test\(location\.hostname\)\s*\?\s*'<p class="ap-note hub-link">/.test(src);
    if (!rec.guarded) bad.push('the Hub link is not limited to the practice site in the page script');
    if (p.w.calls.some(c => c.fn === 'save')) bad.push('a look-only step saved');
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    // Names and emails are blanked before the step's picture.
    await p.evaluate(() => document.querySelectorAll('#panel td, #panel tbody *').forEach(el => { if (el.tagName === 'INPUT') el.value = ''; else if (!el.children.length) el.textContent = '•••'; }));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.79 (#575, look only): Manager Center's report (the shift report email's words): no cases in the forecast; it says which
  // trucks are late now and which will miss their truck, and every other truck.
  await write('Shift report forecast names the late trucks, no cases (look only)', async (p, rec) => {
    const bad = [];
    // The full report (Send Current Report's preview, opened by manager.html?report=1) as the email reads; nothing is sent.
    // On a day with no loads the test puts one of its own on today's list so the forecast has a truck to name.
    const own = await needTodayLoad('Shift report forecast');
    rec.ownLoad = own.made;
    try {
    await open(p, 'manager.html?report=1');
    await p.waitForSelector('#rp-body .mc-banner', { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(2000);
    rec.report = await p.evaluate(() => { const secs = [...document.querySelectorAll('section')].filter(s => /^Recap \(estimated\) at /.test((s.querySelector('h3') || {}).textContent || ''));
      const f = secs[0];
      return { banner: (document.querySelector('.mc-banner b') || {}).textContent || '', forecast: f ? f.innerText.replace(/\s+/g, ' ').slice(0, 400) : '', oldForecast: [...document.querySelectorAll('section h3')].some(h => /^Late forecast/.test(h.textContent)) }; });
    if (!rec.report.banner) bad.push('Manager Center shows no report');
    if (rec.report.oldForecast) bad.push('the old Late forecast section is still there');
    if (rec.report.forecast) {
      if (/\bcases?\b(?! loadout)/i.test(rec.report.forecast)) bad.push('the forecast still shows cases: ' + rec.report.forecast.slice(0, 160));
      // 6.83 (#611): the recap says how many are loaded, then a line per loadout.
      if (!/\d+ of \d+ loaded/.test(rec.report.forecast) || !/(Case|Boxing|Tote|Tanker) Loadout/.test(rec.report.forecast)) bad.push('the recap does not say how many are loaded per loadout: ' + rec.report.forecast.slice(0, 160));
    } else note('Shift report: no forecast section on Manager Center right now (' + rec.report.banner + ')');
    if (!/ROUTES? LATE|ROUTES? BEHIND|WILL MISS|WILL BE LATE|LOADED LATE|ALL ROUTES ON TIME/.test(rec.report.banner)) bad.push('the banner reads ' + rec.report.banner);
    // 6.91 (#692): in the email, under the recap, the CASE LOADOUT FORECAST box: one finish time for every case load, then one
    // line per truck time still ahead with its loads, DONE ABOUT and the TIME TO SPARE (or LATE); above the Downtime line. Two
    // case loads of the test's own (leaving 6:00 AM today) so there is a truck time; the email is read from Print with printing
    // stopped (nothing sent); the loads are removed after.
    const cases = await todayTestLoads(2, { offset: 0, leavesOn: 'Delivery Day', day: { loadType: 'CASE', dispatchTime: 360, startTime: 360 } });
    try {
      if (!cases.made) bad.push('no load on the practice copy to copy for the forecast box');
      else {
        await new Promise(res => setTimeout(res, 6000));
        await open(p, 'manager.html?report=1');
        await p.waitForSelector('#rp-body .mc-banner', { timeout: 30000 }).catch(() => {});
        await p.waitForTimeout(2000);
        await p.evaluate(() => { window.__mail = ''; new MutationObserver((ms) => ms.forEach(m => m.addedNodes.forEach(n => { if (n.tagName === 'IFRAME') { try { n.contentWindow.print = () => {}; } catch (e) { /* */ } setTimeout(() => { try { window.__mail = n.contentDocument.documentElement.outerHTML; } catch (e) { /* */ } }, 200); } }))).observe(document.body, { childList: true, subtree: true }); });
        await p.click('#print-report');
        await p.waitForFunction(() => window.__mail, null, { timeout: 10000 }).catch(() => {});
        const mail = await p.evaluate(() => window.__mail || '');
        if (!mail) bad.push('the shift report email could not be read from Print');
        else {
          const mp = await newPage({ viewport: { width: 600, height: 900 }, mailLook: true });
          try {
            await mp.setContent(mail.replace(/<script[\s\S]*?<\/script>/gi, ''));
            rec.box = await mp.evaluate(() => { const t = document.body.innerText.replace(/[ \t]+/g, ' '); const at = t.indexOf('CASE LOADOUT FORECAST');
              const head = [...document.querySelectorAll('div')].find(d => /^CASE LOADOUT FORECAST/.test(d.textContent.trim()) && !d.querySelector('div')), box = head ? head.parentElement : null;
              const rows = box ? [...box.querySelectorAll('table tr')].map(tr => [...tr.children].map(td => td.textContent.trim())) : [];
              return { at, down: Math.max(t.indexOf('NO DOWNTIME'), t.search(/\bDOWN \d/)), text: box ? box.innerText.replace(/\s+/g, ' ').slice(0, 400) : '', rows }; });
            if (rec.box.at < 0) bad.push('the shift report email has no CASE LOADOUT FORECAST box with two case loads still to load');
            else {
              if (!/ALL CASE LOADS DONE ABOUT ([A-Z]{3} )?\d{1,2}:\d\d [AP]M/.test(rec.box.text)) bad.push('the forecast box does not give one finish time: ' + rec.box.text.slice(0, 120));
              if (!rec.box.rows.length) bad.push('the forecast box has no truck time lines: ' + rec.box.text.slice(0, 160));
              else {
                if (rec.box.rows[0].join('|') !== 'TRUCK LEAVES|LOADS|DONE ABOUT|TIME TO SPARE') bad.push('the truck time columns read ' + rec.box.rows[0].join(', '));
                const odd = rec.box.rows.slice(1).filter(r => r.length !== 4 || !/^\d+ LOADS?$/.test(r[1]) || !/\d:\d\d [AP]M/.test(r[2]) || !/^(JUST IN TIME|LATE .+|\d.*(HR|MIN).*)$/.test(r[3]));
                if (rec.box.rows.length < 2 || odd.length) bad.push('truck time lines read ' + JSON.stringify(rec.box.rows.slice(1, 3)));
                if (!/EVERY TRUCK READY IN TIME|\d+ TRUCK TIMES? WILL BE LATE/.test(rec.box.text)) bad.push('the forecast box does not say whether every truck is ready');
              }
              if (rec.box.down >= 0 && rec.box.down < rec.box.at) bad.push('the Downtime line is above the forecast box');
            }
            await shot(mp, 'shift-email-forecast-box');
          } finally { await mp.done(); }
        }
      }
    } finally { await cases.remove(); }
    await shot(p, 'manager-forecast');
    if (p.w.calls.some(c => /send/i.test((c.op || '') + c.fn))) bad.push('looking at the report sent something');
    } finally { await own.remove(); }
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.85 (#623, look only): Plant Material Trailers. Supplier and Unit columns and an Edit on every line; every United Dairy dry
  // box trailer at the plant is listed (NOT HERE when it is not in the lot), its number written T-<n>; the place is one of
  // UPPER LOT, LOWER LOT, DEBAG, HOLD, NOT HERE; everything shows in capitals; the All trailers drop-down is gone and a Suppliers
  // & Products button opens Receiving's list; + Add Trailer starts with a blank Supplier and, for United Dairy, a number box that
  // brings up our trailers. Nothing saved.
  // 6.87 (#642, #640): a made-up person with no employee ID in UDMS stays under Active ("No ID in UDMS"), search finds them,
  // and Add Driver does not offer them; the one DEPARTMENT drop-down (DOCK its own department) saves a pick, which is put
  // back. The made-up person is deleted afterwards. Names and IDs are blanked before every picture.
  await write('Employees: a person with no ID stays Active; one DEPARTMENT list with DOCK (6.87)', async (p, rec) => {
    const bad = [], KEY = 'UDMS_PRACTICE_TEST_NOID', NAME = 'PRACTICE TEST NOID PERSON';
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const D = require(path.join(__dirname, '..', '..', '..', 'public', 'js', 'departments.js'));
    const LIST = (D.DEPARTMENTS || (global.UDDepartments || {}).DEPARTMENTS || []).slice();
    const ref = db.collection('employees').doc('emp_' + KEY);
    const blank = (pg) => pg.evaluate(() => document.querySelectorAll('#rows td b, #rows td:nth-child(2), #rows td:nth-child(6), .emp-picks button, #d-name, #d-emp, #d-phone').forEach(el => { if (el.tagName === 'INPUT') el.value = '•••'; else el.textContent = '•••'; }));
    await ref.delete();
    try {
      if (!LIST.length) throw new Error('could not read the department list from departments.js');
      if (!LIST.includes('DOCK')) bad.push('the department list has no DOCK: ' + LIST.join(', '));
      await ref.set({ key: KEY, idKey: '', employeeId: '', udmsId: 'PRACTICE_TEST_NOID', name: NAME, facilityId: 'fac_uniontown', active: true, status: 'ACTIVE', position: '', department: '', phone: '', testEdited: true });
      await open(p, 'employees.html?plant=fac_uniontown');
      await p.waitForFunction(() => !/Reading/.test((document.getElementById('rows') || {}).textContent || 'Reading'), null, { timeout: 30000 }).catch(() => {});
      await p.waitForSelector('select.dept-pick', { timeout: 20000 }).catch(() => {});
      const row = () => p.evaluate((n) => { const tr = [...document.querySelectorAll('#rows tr')].find(t => (t.querySelector('td b') || {}).textContent === n); if (!tr) return null;
        const sel = tr.querySelector('select.dept-pick'); return { id: tr.children[1].textContent.trim(), status: tr.children[7].textContent.trim(), left: tr.classList.contains('left-row'), sel: !!sel, value: sel ? sel.value : (tr.children[3].textContent.trim()), options: sel ? [...sel.options].map(o => o.value).filter(Boolean) : [] }; }, NAME);
      rec.filters = await p.evaluate(() => ({ status: (document.getElementById('status') || {}).value, dept: [...document.querySelectorAll('#dept option')].map(o => o.textContent.trim()) }));
      if (rec.filters.status !== 'ACTIVE') note('Employees: the list opened on ' + rec.filters.status + ', not Active');
      if (!rec.filters.dept.includes('DEPARTMENT: DOCK')) bad.push('the DEPARTMENT filter has no DOCK (' + rec.filters.dept.join(', ') + ')');
      rec.active = await row();
      if (!rec.active) bad.push('a person with no employee ID is not under Active');
      else {
        if (!/No ID in UDMS/i.test(rec.active.id)) bad.push('the no-ID person\'s Employee ID reads "' + rec.active.id + '" (No ID in UDMS)');
        if (!/Active/i.test(rec.active.status) || rec.active.left) bad.push('the no-ID person reads ' + rec.active.status);
        if (!rec.active.sel) bad.push('no DEPARTMENT drop-down on the no-ID person (signed in as an administrator)');
        else if (rec.active.options.join('|') !== LIST.join('|')) bad.push('the DEPARTMENT drop-down reads ' + rec.active.options.join(', ') + ' (should be ' + LIST.join(', ') + ')');
        if (rec.active.value) bad.push('the DEPARTMENT drop-down does not start blank (' + rec.active.value + ')');
      }
      // Search finds them.
      await p.fill('#search', 'PRACTICE TEST NOID');
      await p.dispatchEvent('#search', 'input');
      await p.waitForTimeout(500);
      rec.search = await p.evaluate(() => [...document.querySelectorAll('#rows tr')].filter(t => t.querySelector('td b')).length);
      if (rec.search !== 1 || !(await row())) bad.push('search for the no-ID person shows ' + rec.search + ' lines');
      // DOCK saves; put back.
      if (rec.active && rec.active.sel) {
        await p.selectOption('#rows select.dept-pick[data-emp="' + KEY + '"]', 'DOCK');
        let saved = '';
        for (let i = 0; i < 30 && saved !== 'DOCK'; i++) { await p.waitForTimeout(500); saved = ((await ref.get()).data() || {}).department || ''; }
        rec.saved = saved;
        if (saved !== 'DOCK') bad.push('picking DOCK did not save (' + saved + ')');
        await p.waitForTimeout(800);
        rec.shown = (await row() || {}).value;
        if (rec.shown !== 'DOCK') bad.push('after the pick the drop-down reads ' + rec.shown);
        await p.selectOption('#dept', 'DOCK');
        await p.dispatchEvent('#dept', 'input');
        await p.waitForTimeout(500);
        rec.dockFilter = !!(await row());
        for (let i = 0; i < 30 && !rec.dockFilter; i++) { await p.waitForTimeout(500); rec.dockFilter = !!(await row()); rec.dockWaitMs = (i + 1) * 500; }
        if (!rec.dockFilter) {
          rec.dockPage = await p.evaluate((n) => ({ rows: document.querySelectorAll('#rows tr').length, empty: (document.querySelector('#rows td.empty') || {}).textContent || '', search: document.getElementById('search').value === n, dept: document.getElementById('dept').value, status: document.getElementById('status').value }), NAME);
          await p.selectOption('#dept', ''); await p.dispatchEvent('#dept', 'input'); await p.waitForTimeout(500);
          rec.dockPage.allDeptCell = (await row() || {}).value;
        }
        if (!rec.dockFilter) bad.push('DEPARTMENT: DOCK does not show the person set to DOCK');
        await blank(p);
        await shot(p, 'employees-no-id-dock');
        await open(p, 'employees.html?plant=fac_uniontown');
        await p.waitForSelector('#rows select.dept-pick[data-emp="' + KEY + '"]', { timeout: 20000 });
        await p.selectOption('#rows select.dept-pick[data-emp="' + KEY + '"]', '');
        let back = 'x';
        for (let i = 0; i < 30 && back; i++) { await p.waitForTimeout(500); back = ((await ref.get()).data() || {}).department || ''; }
        if (back) bad.push('picking the blank line did not take DOCK off (' + back + ')');
      }
      // Add Driver does not offer them (no employee ID yet).
      await open(p, 'drivers.html');
      await p.waitForSelector('#add', { timeout: 30000 });
      await p.click('#add');
      if (await p.waitForSelector('#d-pick', { timeout: 10000 }).then(() => true).catch(() => false)) {
        await p.fill('#d-pick', 'PRACTICE TEST NOID');
        await p.dispatchEvent('#d-pick', 'input');
        await p.waitForTimeout(600);
        rec.addDriver = await p.$$eval('#d-picks [data-emp]', b => b.map(x => x.textContent).filter(t => /PRACTICE TEST NOID/i.test(t)).length);
        if (rec.addDriver) bad.push('Add Driver offers the person with no employee ID');
        await blank(p);
        await shot(p, 'employees-no-id-add-driver');
        await p.click('#d-cancel').catch(() => {});
      } else note('Add Driver: no employee picker to check the no-ID person against');
      // Plant Schedule + Add Person does not offer them either.
      await open(p, 'crew.html?view=setup&tab=people');
      if (await p.waitForSelector('#add-row', { timeout: 30000 }).then(() => true).catch(() => false)) {
        const c0 = p.w.calls.length;
        await p.click('#add-row');
        if (await p.waitForSelector('#emp-q', { timeout: 10000 }).then(() => true).catch(() => false)) {
          await p.fill('#emp-q', 'PRACTICE TEST NOID');
          await p.dispatchEvent('#emp-q', 'input');
          await p.waitForTimeout(600);
          rec.addPerson = await p.$$eval('.crew-picker [data-emp]', b => b.filter(x => /PRACTICE TEST NOID/i.test(x.textContent)).length);
          if (rec.addPerson) bad.push('Plant Schedule + Add Person offers the person with no employee ID');
          await p.click('#emp-close').catch(() => {});
        }
        if (p.w.calls.slice(c0).some(c => c.op === 'saveCrewSetup')) bad.push('opening + Add Person saved something');
      }
    } finally {
      await ref.delete();
      rec.deleted = !(await ref.get()).exists;
    }
    const failed = p.w.calls.filter(c => c.status !== 200 || c.error);
    if (failed.length) bad.push('a save answered ' + failed[0].status + ' ' + String(failed[0].error).slice(0, 150));
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.87 (#644): on Shipping & Receiving, pointing at Receiving in the left menu shows Receiving Schedule and Suppliers &
  // Products; clicking Receiving opens the Receiving Schedule (it used to only fold). Look only.
  await write('Left menu: Receiving opens the Receiving Schedule (6.87, look only)', async (p, rec) => {
    const bad = [];
    await open(p, 'scheduler.html');
    await p.waitForSelector('.sidemenu .side-sec-btn', { timeout: 30000 });
    const sel = '.sidemenu .side-sec:has(.side-sec-btn[title="Receiving"])';
    rec.home = await p.$eval(sel, s => s.dataset.home).catch(() => '');
    if (!/^scheduler\.html\?lane=receiving$/.test(rec.home)) bad.push('Receiving in the menu goes to "' + rec.home + '" (the Receiving Schedule)');
    await p.hover('.sidemenu');
    await p.waitForTimeout(400);
    await p.hover(sel + ' .side-sec-btn');
    await p.waitForTimeout(800);
    rec.flyout = await p.evaluate(() => [...document.querySelectorAll('.flyout.open a, .side-flyouts .open a')].map(a => a.textContent.trim()));
    if (!rec.flyout.includes('Receiving Schedule') || !rec.flyout.includes('Suppliers & Products')) bad.push('pointing at Receiving shows ' + (rec.flyout.join(', ') || 'nothing'));
    await shot(p, 'menu-receiving-hover');
    await Promise.all([p.waitForURL(/scheduler\.html\?lane=receiving/, { timeout: 15000 }).catch(() => {}), p.click(sel + ' .side-sec-btn')]);
    rec.after = await p.evaluate(() => location.pathname.split('/').pop() + location.search);
    if (!/scheduler\.html\?lane=receiving/.test(rec.after)) bad.push('clicking Receiving left the page on ' + rec.after);
    else {
      await p.waitForSelector('[data-rtab="products"]', { timeout: 30000 }).catch(() => bad.push('the Receiving Schedule did not open its tabs'));
      await shot(p, 'menu-receiving-opened');
    }
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.87 (#643): no United Dairy trailers loaded onto the list from the fleet list and no NOT HERE counter; only the ones
  // someone added show (each has its own record), with no heading line over them.
  await write('Plant Material Trailers suppliers, added UD trailers only, Edit and drop-downs (look only)', async (p, rec) => {
    const bad = [];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const L = require(path.join(__dirname, '..', '..', 'src', 'logic.js'));
    await open(p, 'jug-trailers.html');
    await p.waitForSelector('.pm-table th', { timeout: 30000 });
    await p.waitForFunction(() => !/Reading the trailers/.test((document.getElementById('rows') || {}).textContent || ''), null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(2500);
    const calls0 = p.w.calls.length;
    rec.heads = await p.$$eval('.pm-table th', a => a.map(x => x.textContent.trim().toUpperCase()));
    // 6.86 (#633): the heading bar reads as on Inventory.
    if (rec.heads.slice(0, 7).join('|') !== 'SUPPLIER|UNIT|STATUS|PRODUCT|HOW MANY|COUNTED IN|LOCATION') bad.push('the columns read ' + rec.heads.join(', '));
    rec.headBar = await p.$eval('.pm-table thead th', th => getComputedStyle(th).backgroundColor).catch(() => '');
    rec.top = await p.evaluate(() => ({ show: !!document.getElementById('show'), products: (document.getElementById('products') || {}).getAttribute ? document.getElementById('products').getAttribute('href') : '' }));
    if (rec.top.show) bad.push('the All trailers drop-down is still there');
    if (!/scheduler\.html\?lane=receiving&view=products/.test(rec.top.products || '')) bad.push('no Suppliers & Products button (' + rec.top.products + ')');
    rec.groups = await p.$$eval('#rows tr.jt-grp', a => a.map(x => x.textContent.trim()));
    if (rec.groups.some(g => /United Dairy|NOT HERE/i.test(g))) bad.push('a heading line over the United Dairy trailers: ' + rec.groups.join(', '));
    rec.sum = await p.$eval('#sum', e => e.textContent).catch(() => '');
    if (/not here/i.test(rec.sum)) bad.push('the counts at the top still have NOT HERE: ' + rec.sum);
    const rows = await p.evaluate(() => { const out = [];
      document.querySelectorAll('#rows tr').forEach(tr => { if (!tr.dataset.id || tr.classList.contains('jt-grp')) return;
        const grp = tr.children[0].classList.contains('jt-ud') ? 'UD' : 'OTHER';
        out.push({ grp, id: tr.dataset.id, unit: (tr.children[1].querySelector('b') || {}).textContent || '', loc: tr.querySelector('td.jt-editcell').previousElementSibling.textContent.trim(), edit: !!tr.querySelector('[data-edit]'), caps: tr.innerText === tr.innerText.toUpperCase(), out: tr.classList.contains('jt-out') }); });
      return out; });
    const ud = rows.filter(x => x.grp === 'UD'), other = rows.filter(x => x.grp === 'OTHER');
    rec.counts = { ud: ud.length, udHere: ud.filter(x => !x.out).length, other: other.length };
    if (!ud.length) note('Plant Material Trailers: no United Dairy trailers added on the practice copy (the fleet list is no longer loaded onto it)');
    const badUnits = ud.filter(x => !/^T-[1-9]\d*$/.test(x.unit)).map(x => x.unit);
    if (badUnits.length) bad.push('United Dairy trailers written ' + badUnits.slice(0, 5).join(', '));
    const PLACES = ['UPPER LOT', 'LOWER LOT', 'DEBAG', 'HOLD', 'NOT HERE'];
    const odd = rows.filter(x => !PLACES.includes(x.loc.toUpperCase())).map(x => x.loc);
    if (odd.length) note('Plant Material Trailers: lines at places the plant added: ' + [...new Set(odd)].slice(0, 5).join(', '));
    if (ud.some(x => x.out && x.loc.toUpperCase() !== 'NOT HERE')) bad.push('a United Dairy trailer not in the lot does not say NOT HERE');
    const noEdit = rows.filter(x => !x.edit).length;
    if (noEdit) bad.push(noEdit + ' lines have no Edit button');
    const lower = rows.filter(x => !x.caps).length;
    if (lower) bad.push(lower + ' lines are not in capitals');
    // Only added United Dairy trailers: every UD line is one of the plant's own trailer records, none from the fleet list.
    const plant = await p.evaluate(() => new URLSearchParams(location.search).get('plant') || '');
    rec.plant = plant;
    const J = require(path.join(__dirname, '..', '..', '..', 'public', 'js', 'jug-rules.js'));
    const recs = (await db.collection('jugTrailers').where('facilityId', '==', plant).get()).docs.filter(d => d.data().unitedDairy).map(d => d.id);
    const loaded = ud.filter(x => !recs.includes(x.id)).map(x => x.unit);
    if (loaded.length) bad.push(loaded.length + ' United Dairy trailers on the list nobody added: ' + loaded.slice(0, 6).join(', '));
    const fleet = (await db.collection('equipment').where('type', '==', 'TRAILER').get()).docs.map(d => d.data())
      .filter(u => u.status !== 'INACTIVE' && u.unit && (L.plantOfLocation(u.location) || u.facilityId) === plant && J.dryBox(u));
    rec.fleet = fleet.length;
    const away = fleet.map(u => L.trailerNumber(u.unit)).find(u => !ud.some(x => x.unit === u && !x.out));
    await shot(p, 'jug-trailers-list');
    // + Add Trailer: Supplier first, blank; United Dairy asks for the number and brings up our trailers.
    await p.click('#add');
    await p.waitForSelector('#add-company', { timeout: 10000 });
    rec.add = await p.evaluate(() => ({ blank: document.getElementById('add-company').value === '', options: [...document.querySelectorAll('#add-company option')].map(o => o.textContent), numberOff: !!(document.getElementById('add-number') || {}).disabled }));
    if (!rec.add.blank) bad.push('the Supplier drop-down does not start blank');
    if (!rec.add.options.includes('United Dairy') || !rec.add.options.some(o => /New supplier/i.test(o))) bad.push('the Supplier drop-down reads ' + rec.add.options.join(', '));
    if (!rec.add.numberOff) bad.push('the unit number can be typed before the supplier is picked');
    await p.selectOption('#add-company', 'United Dairy');
    await p.waitForSelector('#add-number:not([disabled])', { timeout: 10000 }).catch(() => {});
    if (away) {
      await p.fill('#add-number', away.replace(/^T-/, ''));
      await p.waitForTimeout(600);
      rec.match = await p.$$eval('#add-match .jt-matchbtn', b => b.map(x => x.textContent.trim()).slice(0, 12));
      if (!rec.match.includes(away)) bad.push('typing ' + away.replace(/^T-/, '') + ' on + Add Trailer brings up ' + (rec.match.join(', ') || 'nothing') + ' (should offer ' + away + ')');
    } else note('Plant Material Trailers: every United Dairy dry box trailer is in the lot, so the number match was not tried');
    rec.item = await p.$$eval('#add-item optgroup', g => g.map(x => x.label));
    await shot(p, 'jug-trailers-add');
    await p.click('#add-cancel');
    await p.click('#edit-lists');
    rec.lists = await p.waitForSelector('#lists-done', { timeout: 10000 }).then(() => p.evaluate(() => ({ kept: [...document.querySelectorAll('#card .jt-chip')].filter(c => /Kept/.test(c.textContent)).map(c => c.firstChild.textContent) }))).catch(() => null);
    if (!rec.lists) bad.push('Edit Lists does not open');
    else { await shot(p, 'jug-trailers-edit-lists'); await p.click('#lists-done'); }
    if (p.w.calls.slice(calls0).some(c => c.fn === 'save' || /save/i.test(c.op || ''))) bad.push('looking saved something: ' + p.w.calls.slice(calls0).map(c => c.op).join(', '));
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
  });
  // 6.79 (#583): Receiving: Suppliers & Products (a test product added, then removed), a load with a PO and two products
  // (saved, opened again for its scanner check-in box, then deleted; nothing marked received), and Inventory opens.
  await write('Receiving products, a load with a PO and two products, Inventory', async (p, rec) => {
    const bad = [], PO = 'PRACTICE TEST PO', NAMES = ['PRACTICE TEST PRODUCT A', 'PRACTICE TEST PRODUCT B'];
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const cleanup = async () => {
      const items = (await db.collection('receivingItems').get()).docs.filter(d => /^PRACTICE TEST/.test(d.data().name || ''));
      for (const d of items) await d.ref.delete();
      const loads = (await db.collection('plantJournal').get()).docs.filter(d => { const x = d.data(); return (x.payload && x.payload.poNumber === PO) || x.poNumber === PO; });
      for (const d of loads) await d.ref.delete();
      return items.length + loads.length;
    };
    rec.clearedBefore = await cleanup();
    try {
      await open(p, 'scheduler.html?lane=receiving');
      await p.waitForSelector('[data-rtab="products"]', { timeout: 30000 });
      await p.click('[data-rtab="products"]');
      await p.waitForSelector('.sc-prodsplit', { timeout: 15000 });
      const sup = await p.$$eval('.sc-suppick button', b => b.map(x => x.textContent.trim()));
      rec.suppliers = sup.length;
      if (!sup.length) throw new Error('Receiving has no suppliers on the practice copy to add a product to');
      await p.click('.sc-suppick button >> nth=0');
      await p.waitForSelector('#prod-add', { timeout: 10000 });
      for (const name of NAMES) {
        await p.click('#prod-add');
        await p.waitForSelector('#pedit #p-name', { timeout: 10000 });
        const blank = await p.evaluate(() => document.getElementById('p-kind').value === '' && document.getElementById('p-unit').value === '');
        if (!blank) bad.push('+ Add Product does not start with blank drop-downs');
        await p.fill('#p-name', name);
        await p.selectOption('#p-kind', { index: 1 });
        await p.selectOption('#p-unit', { index: 1 });
        await p.click('#p-save');
        const seen = await p.waitForFunction((n) => [...document.querySelectorAll('tr')].some(x => x.querySelector('[data-prod]') && x.textContent.toUpperCase().indexOf(n) >= 0) || !!document.querySelector('#p-error:not([hidden])'), name, { timeout: 15000 }).then(() => true, () => false);
        if (!seen) {
          // What happened: the save's answer, whether it is in the database, and whether a reload shows it.
          rec.liveMissed = { product: name, calls: p.w.calls.filter(c => c.fn === 'save').slice(-2).map(c => (c.op || '') + ' ' + c.status + ' ' + String(c.error || '').slice(0, 120)) };
          await p.reload({ waitUntil: 'domcontentloaded' });
          await p.waitForSelector('[data-rtab="products"]', { timeout: 30000 }); await p.click('[data-rtab="products"]');
          await p.waitForSelector('.sc-suppick button', { timeout: 15000 }); await p.click('.sc-suppick button >> nth=0');
          rec.liveMissed.afterReload = await p.waitForFunction((n) => [...document.querySelectorAll('tr')].some(x => x.querySelector('[data-prod]') && x.textContent.toUpperCase().indexOf(n) >= 0), name, { timeout: 15000 }).then(() => true, () => false);
          throw new Error('the new product ' + name + ' did not show after Save' + (rec.liveMissed.afterReload ? ' (a reload shows it)' : ' (not after a reload either)') + ': ' + rec.liveMissed.calls.join(' | '));
        }
      }
      const err = await p.$eval('#p-error', e => e.hidden ? '' : e.textContent).catch(() => '');
      if (err) throw new Error('adding a product: ' + err);
      rec.products = await p.$$eval('tr', x => x.filter(e => e.querySelector('[data-prod]') && /PRACTICE TEST PRODUCT/i.test(e.textContent)).length);
      if (rec.products !== 2) bad.push(rec.products + ' of the 2 test products on the supplier\'s list');
      await shot(p, 'receiving-products');
      // A load: the supplier, Carrier, a PO and the two test products.
      await p.click('[data-rtab="calendar"]');
      await p.waitForSelector('#add', { timeout: 15000 });
      await p.click('#add');
      await p.waitForSelector('#modal:not([hidden]) #f-lines', { timeout: 15000 });
      await p.selectOption('#f-route', { label: (await p.$$eval('#f-route option', o => o.map(x => x.textContent))).find(t => t && t !== 'Pick one…' && sup[0].split(/\s+/)[0] && t.toUpperCase().indexOf(sup[0].split(/\s+/)[0].toUpperCase()) >= 0) || (await p.$$eval('#f-route option', o => o.map(x => x.textContent).filter(t => t !== 'Pick one…')))[0] });
      await p.selectOption('#f-type', 'CARRIER');
      await p.fill('#f-time', '10:00');
      await p.fill('#f-po', PO);
      const pickLine = async (n, name) => { const v = await p.$eval('#f-lines tr:nth-child(' + n + ') select', (s, nm) => ([...s.options].find(o => o.textContent.indexOf(nm) >= 0) || {}).value || '', name); if (!v) throw new Error('the load\'s product list has no ' + name); await p.selectOption('#f-lines tr:nth-child(' + n + ') select', v); await p.fill('#f-lines tr:nth-child(' + n + ') [data-f="ordered"]', String(n + 1)); };
      await pickLine(1, NAMES[0]);
      await p.click('#f-addline');
      await pickLine(2, NAMES[1]);
      await p.click('#f-save');
      await p.waitForSelector('#f-confirm', { timeout: 10000 }).then(() => p.click('#f-confirm')).catch(() => {});
      await p.waitForSelector('#modal[hidden]', { state: 'attached', timeout: 15000 }).catch(() => {});
      const ferr = await p.$eval('#f-error', e => e.hidden ? '' : e.textContent).catch(() => '');
      if (ferr) throw new Error('saving the load: ' + ferr);
      let load = null;
      for (let i = 0; i < 20 && !load; i++) { load = (await db.collection('plantJournal').get()).docs.map(d => Object.assign({ id: d.id }, d.data())).find(x => (x.payload && x.payload.poNumber === PO) || x.poNumber === PO); if (!load) await p.waitForTimeout(500); }
      if (!load) throw new Error('the load with the PO did not save');
      const pl = load.payload || load;
      rec.load = { lines: (pl.lines || []).length, product: pl.product || '', date: pl.date || load.date || '' };
      if (rec.load.lines !== 2) bad.push('the saved load has ' + rec.load.lines + ' products, not 2');
      // Open it again: the scanner check-in box. Nothing scanned, nothing marked received.
      const day = rec.load.date;
      if (day) {
        await p.click('[data-day="' + day + '"]').catch(() => {});
        await p.waitForSelector('#modal .sc-daylist', { timeout: 10000 }).catch(() => {});
        const edit = await p.$('#modal .sc-dayrow:has-text("' + PO + '") [data-edit], #modal .sc-dayrow:has-text("PRACTICE TEST") [data-edit]');
        if (edit) {
          await edit.click();
          rec.scan = await p.waitForSelector('#f-scan', { timeout: 10000 }).then(() => true).catch(() => false);
          if (!rec.scan) bad.push('the load has no scanner check-in box');
          rec.receiveButton = !!(await p.$('#f-receive'));
          await shot(p, 'receiving-load-checkin');
          const del = await p.$('#f-delete');
          if (del) { await del.click(); await p.waitForTimeout(400); if (await p.$('#f-delete')) await p.click('#f-delete').catch(() => {}); await p.waitForTimeout(1500); }
        } else bad.push('the saved load is not on its day\'s list');
      }
    } finally {
      rec.clearedAfter = await cleanup();
    }
    // Inventory opens and lists products.
    await open(p, 'inventory.html');
    await p.waitForTimeout(2500);
    rec.inventory = await p.evaluate(() => ({ title: (document.querySelector('h1') || {}).textContent || '', rows: document.querySelectorAll('#rows tr').length, tabs: [...document.querySelectorAll('[data-tab]')].map(b => b.textContent.trim()), sideways: document.scrollingElement.scrollWidth > innerWidth + 1 }));
    if (rec.inventory.sideways) bad.push('Inventory scrolls sideways at 1536');
    await shot(p, 'inventory');
    if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
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
    const own = await needTodayLoad('Trailer pick lists');
    rec.ownLoad = own.made;
    try {
    await open(p, 'loadout.html');
    await p.waitForSelector('#rows tr[data-row]', { timeout: 20000 });
    await p.waitForFunction(() => document.querySelectorAll('#lo-trailers option').length > 1, null, { timeout: 20000 }).catch(() => {});
    var lo = await p.$$eval('#lo-trailers option', o => o.map(x => x.value.toUpperCase()));
    rec.lo = lo.length;
    } finally { await own.remove(); }
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
  // 6.70 (#524), 6.85 (#623): Plant Material Trailers. The test adds a trailer of its own (an outside supplier, unit PT-99..),
  // which goes in at UPPER LOT; makes it Loaded with a product and how many, and notes; Edit on its line moves it to LOWER LOT;
  // then Left the Lot takes it off the list and the test deletes its record. One United Dairy trailer that is NOT HERE is brought
  // in with Edit (UPPER LOT) and put back to NOT HERE the same way, and its record put back as it was. The plant's drop-down lists
  // are put back after. Look at 1536, 1024 and 390.
  await write('Jug Trailers add, fill, a UD trailer stays, Left the Lot (6.87)', async (p, rec) => {
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
    await p.waitForFunction(() => !/Reading the trailers/.test((document.getElementById('rows') || {}).textContent || ''), null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(2000);
    rec.title = await p.evaluate(() => [(document.querySelector('.head h1') || {}).textContent, (document.querySelector('.head .eyebrow') || {}).textContent].join(' · '));
    if (!/Plant Material Trailers/i.test(rec.title)) bad.push('the screen is called ' + rec.title + ' (Plant Material Trailers)');
    const num = 'PT-99' + String(Math.floor(Math.random() * 90) + 10);
    rec.trailer = num;
    const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
    const db = r('firebase-admin/firestore').getFirestore(r('firebase-admin').app('audit'));
    const plant = await p.evaluate(() => new URLSearchParams(location.search).get('plant') || 'fac_uniontown');
    const listRef = db.collection('jugTrailerLists').doc(plant);
    const listsBefore = await listRef.get();
    const until = async (fn, ms) => { for (let i = 0; i < ms / 500; i++) { if (await fn()) return true; await p.waitForTimeout(500); } return false; };
    const jugDoc = async () => ((await db.collection('jugTrailers').where('unit', '==', num).get()).docs[0] || { data: () => ({}) }).data();
    const rowText = (key) => p.evaluate((k) => { const tr = [...document.querySelectorAll('#rows tr[data-id]')].find(x => x.dataset.id === k || x.textContent.includes(k)); return tr ? tr.textContent : ''; }, key);
    // Edit on a line: pick the place, Save.
    const moveRow = async (id, place) => {
      await p.click('#rows tr[data-id="' + id + '"] [data-edit]');
      await p.waitForSelector('#rows select[data-loc]', { timeout: 8000 });
      await p.selectOption('#rows select[data-loc]', place);
      await p.click('#rows [data-save]');
    };
    let udRef = null, udBefore = null;
    try {
      await p.click('#add');
      await p.waitForSelector('#add-company', { timeout: 15000 });
      const co = await p.$eval('#add-company', s => { const o = [...s.options].find(x => x.value && x.value !== '__new' && !/^United Dairy$/i.test(x.value)); return o ? o.value : ''; });
      rec.company = co;
      if (co) await p.selectOption('#add-company', co);
      else { await p.selectOption('#add-company', '__new'); await p.fill('#add-company-new', 'Practice Test Co'); }
      await p.waitForSelector('#add-number:not([disabled])', { timeout: 8000 });
      await p.fill('#add-number', num);
      await timed(p, rec, 'Add to the Lot', () => p.click('#add-go'), { fn: (n) => [...document.querySelectorAll('#rows tr[data-id]')].some(r => r.textContent.includes(n)), arg: num }, 20000);
      rec.addedAt = (await jugDoc()).location || '';
      if (rec.addedAt !== 'UPPER LOT') bad.push('the added trailer went in at "' + rec.addedAt + '" (UPPER LOT)');
      await p.waitForSelector('#card [data-status="LOADED"]', { timeout: 10000 });
      await timed(p, rec, 'Loaded', () => p.click('#card [data-status="LOADED"]'), { fn: (n) => [...document.querySelectorAll('#rows tr[data-id]')].some(r => r.textContent.includes(n) && /Loaded/i.test(r.textContent)), arg: num }, 20000);
      // What is on it: a product from Suppliers & Products (or one of the plant's own items), and how many.
      const item = await p.$eval('#lines select[data-line="item"]', s => { const o = [...s.options].find(x => x.value); return o ? o.value : ''; }).catch(() => '');
      rec.item = item;
      if (!item) bad.push('the What is on it drop-down is empty (no products on Suppliers & Products and no items)');
      else {
        rec.itemGroup = await p.$eval('#lines select[data-line="item"]', (s, v) => { const o = [...s.options].find(x => x.value === v); return o && o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : ''; }, item);
        await p.selectOption('#lines select[data-line="item"] >> nth=0', item);
        rec.itemSaved = await until(async () => ((await jugDoc()).items || []).some(x => x.item === item), 15000);
        if (!rec.itemSaved) bad.push('the picked item was not saved (' + JSON.stringify((await jugDoc()).items || []) + ')');
        await p.fill('#lines [data-line="pallets"] >> nth=0', '2');
        await p.keyboard.press('Tab');
        rec.countSaved = await until(async () => { const it = (await jugDoc()).items || []; return it.length === 1 && it[0].item === item && it[0].pallets === '2'; }, 15000);
        if (!rec.countSaved) bad.push('after typing 2 the trailer has ' + JSON.stringify((await jugDoc()).items || []));
        rec.unitWord = await p.$eval('#lines .jt-unit', e => e.textContent).catch(() => '');
        // 6.86 (#633): Product, How Many and Counted In in their own columns.
        await p.waitForFunction(([n, it]) => [...document.querySelectorAll('#rows tr[data-id]')].some(r => r.textContent.includes(n) && r.children[3].textContent.toLowerCase().includes(it.toLowerCase()) && r.children[4].textContent.trim() === '2' && r.children[5].textContent.trim()), [num, item], { timeout: 20000 })
          .catch(() => bad.push('the item and how many did not show on the list'));
      }
      await p.fill('#card [data-notes]', 'Practice copy test (taken off by the test)');
      await p.keyboard.press('Tab');
      await p.waitForTimeout(1500);
      // Edit on its line: UPPER LOT to LOWER LOT.
      const id = await p.evaluate((n) => { const tr = [...document.querySelectorAll('#rows tr[data-id]')].find(x => x.textContent.includes(n)); return tr ? tr.dataset.id : ''; }, num);
      await moveRow(id, 'LOWER LOT');
      rec.moved = await until(async () => (await jugDoc()).location === 'LOWER LOT', 15000);
      if (!rec.moved) bad.push('Edit on the line did not move the trailer to LOWER LOT (' + (await jugDoc()).location + ')');
      await p.waitForTimeout(1200);
      if (!/LOWER LOT/i.test(await rowText(num))) bad.push('the line does not say LOWER LOT after Edit');
      rec.history = await p.$$eval('#card .jt-hist li', l => l.length);
      if (!rec.history) bad.push('no history on the trailer');
      await shot(p, 'jug-trailer-filled');
      // 6.87 (#643): a United Dairy trailer added with + Add Trailer (number typed, the match tapped) stays on the list after
      // the page is opened again; Left the Lot keeps it on the list as NOT HERE. Its record is put back as it was afterwards.
      const J = require(path.join(__dirname, '..', '..', '..', 'public', 'js', 'jug-rules.js'));
      const L = require(path.join(__dirname, '..', '..', 'src', 'logic.js'));
      const onList = await p.evaluate(() => [...document.querySelectorAll('#rows tr[data-id]')].filter(tr => tr.children[0].classList.contains('jt-ud') && !tr.classList.contains('jt-out')).map(tr => (tr.children[1].querySelector('b') || {}).textContent || ''));
      const fleet = (await db.collection('equipment').where('type', '==', 'TRAILER').get()).docs.map(d => d.data())
        .filter(u => u.status !== 'INACTIVE' && u.unit && (L.plantOfLocation(u.location) || u.facilityId) === plant && J.dryBox(u))
        .map(u => L.trailerNumber(u.unit)).filter(u => !onList.includes(u));
      const refOf = (u) => db.collection('jugTrailers').doc(String(plant + '_' + J.number(J.UD, u)).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 200));
      // A trailer with no record yet if there is one (so nothing of the plant's is changed), else one that left the lot.
      let udUnit = '';
      for (const u of fleet) { if (!(await refOf(u).get()).exists) { udUnit = u; break; } }
      if (!udUnit) udUnit = fleet[0] || '';
      if (!udUnit) note('Plant Material Trailers: no United Dairy dry box trailer at the plant is out of the lot, so + Add Trailer for United Dairy was not tried');
      else {
        rec.ud = udUnit;
        udRef = refOf(udUnit);
        const ex = await udRef.get();
        udBefore = ex.exists ? ex.data() : null;
        if (udBefore && udBefore.inLot) throw new Error(udUnit + ' is not on the list but its record is in the lot');
        const udRow = () => p.evaluate((u) => { const tr = [...document.querySelectorAll('#rows tr[data-id]')].find(x => (x.children[1].querySelector('b') || {}).textContent === u); return tr ? { id: tr.dataset.id, ud: tr.children[0].classList.contains('jt-ud'), out: tr.classList.contains('jt-out'), loc: tr.querySelector('td.jt-editcell').previousElementSibling.textContent.trim() } : null; }, udUnit);
        await p.click('#add');
        await p.waitForSelector('#add-company', { timeout: 15000 });
        await p.selectOption('#add-company', J.UD);
        await p.waitForSelector('#add-number:not([disabled])', { timeout: 8000 });
        await p.fill('#add-number', udUnit.replace(/^T-/, ''));
        await p.waitForTimeout(600);
        const tap = await p.$('#add-match .jt-matchbtn:text-is("' + udUnit + '")');
        if (!tap) throw new Error('typing ' + udUnit.replace(/^T-/, '') + ' on + Add Trailer does not offer ' + udUnit + ' (' + (await p.$$eval('#add-match .jt-matchbtn', b => b.map(x => x.textContent.trim()).join(', '))) + ')');
        await tap.click();
        await timed(p, rec, 'Add to the Lot (United Dairy)', () => p.click('#add-go'), { fn: (u) => [...document.querySelectorAll('#rows tr[data-id]')].some(r => (r.children[1].querySelector('b') || {}).textContent === u && !r.classList.contains('jt-out')), arg: udUnit }, 20000);
        rec.udAdded = await udRow();
        if (!rec.udAdded || !rec.udAdded.ud || rec.udAdded.out || !/UPPER LOT/i.test(rec.udAdded.loc)) bad.push(udUnit + ' added reads ' + JSON.stringify(rec.udAdded));
        rec.udRecord = !!((await udRef.get()).data() || {}).inLot;
        if (!rec.udRecord) bad.push(udUnit + ' added has no record in the lot');
        // It stays: open the page again.
        await open(p, 'jug-trailers.html');
        await p.waitForFunction((u) => [...document.querySelectorAll('#rows tr[data-id]')].some(r => (r.children[1].querySelector('b') || {}).textContent === u), udUnit, { timeout: 30000 }).catch(() => {});
        rec.udAfterOpen = await udRow();
        if (!rec.udAfterOpen || rec.udAfterOpen.out) bad.push(udUnit + ' is not in the lot after the page is opened again (' + JSON.stringify(rec.udAfterOpen) + ')');
        await shot(p, 'jug-trailer-ud-added');
        // Left the Lot: still on the list, as NOT HERE, and still there after opening the page again.
        if (rec.udAfterOpen) {
          await p.click('#rows tr[data-id="' + rec.udAfterOpen.id + '"]');
          await p.waitForSelector('#card #left', { timeout: 8000 });
          await p.click('#card #left');
          rec.udLeft = await until(async () => !((await udRef.get()).data() || {}).inLot, 15000);
          if (!rec.udLeft) bad.push('Left the Lot did not take ' + udUnit + ' out of the lot');
          await open(p, 'jug-trailers.html');
          await p.waitForFunction((u) => [...document.querySelectorAll('#rows tr[data-id]')].some(r => (r.children[1].querySelector('b') || {}).textContent === u), udUnit, { timeout: 30000 }).catch(() => {});
          rec.udGone = await udRow();
          if (!rec.udGone || !rec.udGone.out || !/NOT HERE/i.test(rec.udGone.loc)) bad.push(udUnit + ' after Left the Lot reads ' + JSON.stringify(rec.udGone) + ' (should stay on the list as NOT HERE)');
          rec.sum = await p.$eval('#sum', e => e.textContent).catch(() => '');
          if (/not here/i.test(rec.sum)) bad.push('the counts at the top have NOT HERE: ' + rec.sum);
          await shot(p, 'jug-trailer-ud-left');
        }
      }
    } finally {
      const tid = await p.evaluate((n) => { const tr = [...document.querySelectorAll('#rows tr[data-id]')].find(x => x.textContent.includes(n)); return tr ? tr.dataset.id : ''; }, num).catch(() => '');
      if (tid) {
        await p.click('#rows tr[data-id="' + tid + '"]').catch(() => {});
        await p.waitForSelector('#card #left', { timeout: 8000 }).catch(() => {});
        await p.click('#card #left').catch(() => {});
        await p.waitForFunction((n) => ![...document.querySelectorAll('#rows tr[data-id]')].some(r => r.textContent.includes(n)), num, { timeout: 20000 }).then(() => { rec.left = true; }, () => bad.push('Left the Lot did not take ' + num + ' off the list'));
      }
      // The test trailer's record goes; the United Dairy trailer's record is put back as it was (or taken off when it had none).
      for (const d of (await db.collection('jugTrailers').where('unit', '==', num).get()).docs) await d.ref.delete();
      if (udRef) { if (udBefore) await udRef.set(udBefore); else await udRef.delete(); rec.udPutBack = true; }
      // Any other record the add made for that trailer (a different record name) goes too.
      if (rec.ud) for (const d of (await db.collection('jugTrailers').where('facilityId', '==', plant).where('unit', '==', rec.ud).get()).docs) if (!udRef || d.id !== udRef.id) { await d.ref.delete(); rec.udExtra = (rec.udExtra || 0) + 1; }
      if (listsBefore.exists) await listRef.set(listsBefore.data()); else await listRef.delete();
      rec.listsPutBack = true;
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
      rec.options = await p.$$eval('.popover select[data-kind="driver"] option', o => o.map(x => x.value + '=' + (/^drv_/.test(x.value) ? 'a driver' : x.textContent.trim())).slice(0, 8)).catch(() => []);
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
  // 6.84 (#612): Shift Notes. The kinds down the left are buttons (red while one is open, green when all are resolved), the boxes
  // start empty, each kind has its history under the boxes, and the tiles at the top open their entries. The test adds a
  // Handoff note of its own, finds it under Still open, in the Handoff history and behind the Needs attention tile, marks it
  // Resolved, and then takes every test shift note off the practice copy (this one, and the "Practice copy test note" ones the
  // Shift note step leaves).
  await write('Shift Notes kinds, tiles and history: add, view and clear a test note (6.84)', async (p, rec) => {
    const bad = [], WORDS = 'PRACTICE TEST SHIFT NOTE ' + Date.now().toString(36).toUpperCase();
    try {
      await open(p, 'shiftnotes.html');
      await p.waitForSelector('#lines [data-kind="Handoff"]', { timeout: 30000 });
      await p.click('#lines [data-kind="Handoff"]');
      await p.waitForTimeout(800);
      const look = async () => p.evaluate(() => { const b = document.querySelector('#lines [data-kind="Handoff"]'); return { cls: b.className, words: (b.querySelector('small') || {}).textContent || '', count: (b.querySelector('b') || {}).textContent || '' }; });
      rec.kinds = await p.$$eval('#lines [data-kind]', b => b.map(x => x.dataset.kind));
      if (rec.kinds.join('|') !== 'Handoff|Breakdown|Maintenance Request|Incident|Safety|Quality|Other') bad.push('the kinds on the left read ' + rec.kinds.join(', '));
      rec.title = await p.$eval('#kind-title', e => e.textContent);
      if (rec.title !== 'Handoff') bad.push('pressing Handoff shows ' + rec.title);
      // The boxes start empty (the drop-downs keep their choices).
      rec.filled = await p.$$eval('#fields input, #fields textarea', x => x.filter(e => e.value).map(e => e.className || e.type));
      if (rec.filled.length) bad.push('boxes not empty at the start: ' + rec.filled.join(', '));
      rec.before = await look();
      rec.tiles = await p.$$eval('#hstats [data-filter]', b => b.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
      if (rec.tiles.length !== 4) bad.push('the tiles at the top read ' + rec.tiles.join(' / '));
      // Add.
      await p.fill('#fields .sn-entry', WORDS);
      const t = Date.now();
      await p.keyboard.press('Tab');
      for (let i = 0; i < 60 && !p.w.calls.some(c => c.at >= t && c.op === 'saveShiftNote'); i++) await p.waitForTimeout(250);
      const call = p.w.calls.find(c => c.at >= t && c.op === 'saveShiftNote');
      if (!call || call.status !== 200 || call.error) throw new Error('the test note was not saved: ' + (call ? call.error || call.status : 'no save'));
      rec.savedMs = Date.now() - t;
      await p.waitForTimeout(2500);
      rec.added = await look();
      if (!/k-red/.test(rec.added.cls) || !/open/.test(rec.added.words)) bad.push('with the test note open, the Handoff button is ' + rec.added.cls + ' "' + rec.added.words + '"');
      // View: the Handoff history under the boxes.
      rec.history = await p.evaluate((w) => { const h = document.getElementById('kind-history'); return { head: ((h.querySelector('.sn-sec') || {}).textContent || '').replace(/\s+/g, ' ').slice(0, 80), has: h.innerText.toUpperCase().includes(w), rows: h.querySelectorAll('tbody tr').length }; }, WORDS);
      if (!rec.history.has) bad.push('the test note is not in the Handoff history under the boxes (' + rec.history.head + ')');
      // Start Another Entry: the boxes empty again and the note moves to Still open.
      if (await p.$('#another:not([hidden])')) { await p.click('#another'); await p.waitForTimeout(1200); }
      rec.emptyAgain = await p.$$eval('#fields input, #fields textarea', x => x.filter(e => e.value).length);
      if (rec.emptyAgain) bad.push('Start Another Entry left ' + rec.emptyAgain + ' boxes filled');
      const id = await p.evaluate((w) => { const c = [...document.querySelectorAll('#open-box .sn-card')].find(x => x.textContent.toUpperCase().includes(w)); return c ? c.dataset.entry : ''; }, WORDS);
      if (!id) bad.push('the test note is not under Still open');
      // The Needs attention tile shows it on the 24-Hour History tab; pressing the tile again goes back.
      await p.click('#hstats [data-filter="OPEN"]');
      await p.waitForTimeout(800);
      rec.tile = await p.evaluate((w) => ({ history: !document.getElementById('pane-history').hidden, title: document.getElementById('history-title').textContent, has: document.getElementById('history').innerText.toUpperCase().includes(w), all: !document.getElementById('show-all').hidden }), WORDS);
      if (!rec.tile.history || !/^Needs attention \(\d+\)$/.test(rec.tile.title) || !rec.tile.has) bad.push('the Needs attention tile shows ' + JSON.stringify(rec.tile));
      if (!rec.tile.all) bad.push('no Show everything button with a tile picked');
      await colorCheck(p, 'Shift Notes (a kind open, red)', bad, rec);
      await shot(p, 'shiftnotes-needs-attention');
      await p.click('#hstats [data-filter="OPEN"]');
      await p.waitForTimeout(600);
      rec.tileAgain = await p.evaluate(() => ({ title: document.getElementById('history-title').textContent, all: !document.getElementById('show-all').hidden }));
      if (rec.tileAgain.title !== 'Last 24 Hours' || rec.tileAgain.all) bad.push('pressing the tile again shows ' + JSON.stringify(rec.tileAgain));
      // Clear: mark it Resolved under Still open.
      await p.click('[data-pane="current"]');
      await p.waitForTimeout(600);
      if (id) {
        const t2 = Date.now();
        await p.selectOption('#open-box [data-status="' + id + '"]', 'RESOLVED');
        for (let i = 0; i < 60 && !p.w.calls.some(c => c.at >= t2 && c.op === 'saveShiftNote'); i++) await p.waitForTimeout(250);
        await p.waitForTimeout(3000);
        rec.cleared = await p.evaluate((w) => ({ open: [...document.querySelectorAll('#open-box .sn-card')].some(x => x.textContent.toUpperCase().includes(w)), row: ([...document.querySelectorAll('#kind-history tbody tr')].find(x => x.textContent.toUpperCase().includes(w)) || {}).className || '' }), WORDS);
        rec.after = await look();
        if (rec.cleared.open) bad.push('the resolved test note is still under Still open');
        if (!/sn-r-done/.test(rec.cleared.row)) bad.push('the history row of the resolved note is ' + rec.cleared.row);
        if (!/k-(red|amber)/.test(rec.before.cls)) { if (!/k-green/.test(rec.after.cls)) bad.push('with every handoff resolved the Handoff button is ' + rec.after.cls + ' "' + rec.after.words + '"'); }
        else note('Shift Notes: the practice copy already had open handoff notes, so the Handoff button stays ' + rec.after.cls + ' after the test note was resolved');
        await shot(p, 'shiftnotes-resolved');
      }
      if (p.w.errors.length) bad.push('page errors: ' + p.w.errors.slice(0, 3).join(' | '));
    } finally { rec.removed = await clearTestShiftNotes(); }
    rec.bad = bad;
    if (bad.length) throw new Error(bad.join('; '));
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
