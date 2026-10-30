'use strict';
/*
 * Click check (Joe 10/30: "a real in-depth doing a click check ... Make sure the HTMLs are not overlaying over top of other
 * ones"). Opens every screen of screen-timings.cjs against the local test database, signed in as the test administrator, and:
 *   covered   lists each button, link, box and drop-down that something else sits on top of (a press would land on the other
 *             thing), at the office window size and on a phone;
 *   left open lists anything that covers a quarter of the window or more when the screen opens (a pop-up or layer left showing);
 *   presses   presses every button, tab and drop-down once (only the local test database changes) and notes each press that
 *             shows an error, cannot be pressed, or opens a page that does not exist.
 * Not part of npm run test:browser (it checks every screen and takes a while). Usage, inside the emulators:
 *   node test/browser/click-check.cjs [out.json]      Env: ONLY=page.html,... to pick screens; NO_PRESS=1 to skip the presses.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');

const HOSTING = 'http://127.0.0.1:5000';
const PUBLIC = path.join(__dirname, '..', '..', '..', 'public');
const SDK = path.dirname(require.resolve('firebase/package.json'));
const OUT = process.argv[2] || '';
const WHO = 'testEmail=admin.test@uniteddairy.com';
const SETTLE = Number(process.env.SETTLE || 3500);
const SIZES = [{ name: 'office', width: 1536, height: 790 }, { name: 'phone', width: 390, height: 844, mobile: true }];
const MAX_PRESSES = Number(process.env.MAX_PRESSES || 60);
const SCREENS = eval(fs.readFileSync(path.join(__dirname, 'screen-timings.cjs'), 'utf8').match(/const SCREENS = (\[[\s\S]*?\]);\n/)[1]);
// Presses that leave the app or the test (each is checked as a link instead).
const SKIP = /^(sign out|log out|sign in with google)$/i;

// In the page: what each visible control is, and what (if anything) sits on top of it.
function look() {
  const vw = innerWidth, vh = innerHeight;
  const name = (el) => {
    if (!el || el.nodeType !== 1) return String(el);
    const t = (el.getAttribute('aria-label') || el.innerText || el.value || el.title || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : '') + (t ? ' "' + t + '"' : '');
  };
  const shown = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05; };
  const controls = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=tab], [onclick]')].filter(shown);
  const covered = [];
  for (const el of controls) {
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.left < 0 || r.bottom > vh || r.right > vw) continue;
    // A control is covered when the middle and both ends of it are under something else (not itself, its own parts or its label).
    const spots = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + Math.min(6, r.width / 3), r.top + r.height / 2], [r.right - Math.min(6, r.width / 3), r.top + r.height / 2]];
    const over = spots.map(([x, y]) => document.elementFromPoint(x, y)).filter(hit => hit && hit !== el && !el.contains(hit) && !(hit.contains(el) && hit.tagName === 'LABEL') && !(hit.tagName === 'LABEL' && hit.control === el));
    if (over.length === spots.length) covered.push({ control: name(el), under: name(over[0]) });
  }
  // Layers on top of the screen: fixed or absolute boxes that cover a quarter of the window and can be seen.
  const layers = [...document.querySelectorAll('body *')].filter(el => {
    const s = getComputedStyle(el);
    if (s.position !== 'fixed' || !shown(el) || s.pointerEvents === 'none') return false;
    const r = el.getBoundingClientRect(), area = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    return area >= vw * vh / 4;
  }).map(name);
  const sideways = document.documentElement.scrollWidth > vw + 2;
  return { covered, layers, sideways, controls: controls.length };
}

async function seed() {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
}

async function open(browser, size, url) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: !!size.mobile, hasTouch: !!size.mobile, serviceWorkers: 'block', acceptDownloads: true });
  const page = await ctx.newPage();
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  // Outside pages (weather, video) are not part of the check.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|www\.gstatic\.com)/, (route) => route.abort());
  page.on('dialog', d => d.dismiss().catch(() => {}));
  const errors = [], missing = [];
  page.on('pageerror', e => errors.push(e.message.replace(/\s+/g, ' ').slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text().replace(/\s+/g, ' ').slice(0, 300)); });
  page.on('response', r => { if (r.status() === 404 && r.url().startsWith(HOSTING)) missing.push(r.url().replace(HOSTING, '')); });
  const [bare, hash] = url.split('#');
  const full = HOSTING + '/' + bare + (bare.includes('?') ? '&' : '?') + WHO + (hash ? '#' + hash : '');
  await page.goto(full, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(SETTLE);
  return { ctx, page, errors, missing, full };
}

// Every same-site page a link names must exist.
function brokenLinks(hrefs) {
  return [...new Set(hrefs)].filter(h => {
    const m = h.match(/^(?:https?:\/\/127\.0\.0\.1:5000\/)?([a-z0-9-]+\.html)/i);
    return m && !fs.existsSync(path.join(PUBLIC, m[1]));
  });
}

// Numbers each control that can be pressed (data-cc), the same way each time the screen opens.
function mark(page) {
  return page.evaluate((skip) => {
    const re = new RegExp(skip, 'i');
    const shown = (el) => { const r = el.getBoundingClientRect(), st = getComputedStyle(el); return r.width > 2 && r.height > 2 && st.visibility !== 'hidden' && st.display !== 'none'; };
    return [...document.querySelectorAll('button, [role=tab], select')].filter(shown).filter(el => !el.disabled && !re.test((el.innerText || '').trim()))
      .map((el, i) => { el.setAttribute('data-cc', String(i)); return { i, tag: el.tagName.toLowerCase(), text: (el.getAttribute('aria-label') || (el.tagName === 'SELECT' ? (el.id || el.name || 'drop-down') : el.innerText) || el.id || '').replace(/\s+/g, ' ').trim().slice(0, 40) }; });
  }, SKIP.source);
}

async function presses(browser, url) {
  let s = await open(browser, SIZES[0], url);
  const list = await mark(s.page);
  const out = [];
  for (const item of list.slice(0, MAX_PRESSES)) {
    const before = s.errors.length;
    // A screen that drew itself again since it was numbered is numbered again.
    if (!(await s.page.locator('[data-cc="' + item.i + '"]').count())) await mark(s.page);
    const el = s.page.locator('[data-cc="' + item.i + '"]');
    let problem = '';
    const t0 = Date.now();
    try {
      if (item.tag === 'select') {
        const values = await el.evaluate(x => [...x.options].map(o => o.value).filter(v => v !== x.value), null, { timeout: 1500 });
        if (values.length) await el.selectOption(values[0], { timeout: 1500 });
      } else await el.click({ timeout: 1500 });
    } catch (e) { problem = /intercepts pointer events/.test(e.message) ? 'covered: ' + ((e.message.match(/<([^>]+)>[^<]*intercepts pointer/) || [])[1] || '?').slice(0, 80) : 'could not press: ' + e.message.split('\n')[0].slice(0, 100); }
    await s.page.waitForTimeout(450);
    const errs = s.errors.slice(before);
    if (errs.length) problem = (problem ? problem + '; ' : '') + 'error: ' + errs[0].slice(0, 160);
    const now = s.page.url();
    const left = !now.startsWith(s.full.split('#')[0]);
    if (left && /\.html/.test(now) && brokenLinks([now]).length) problem = (problem ? problem + '; ' : '') + 'opens a missing page ' + now;
    if (problem) out.push({ press: item.tag + ' "' + item.text + '"', problem, ms: Date.now() - t0 });
    // Start fresh after a press that opened another page or left a layer up, so the next press finds the screen as it opens.
    const layer = left ? true : await s.page.evaluate(() => [...document.querySelectorAll('body *')].some(x => { const st = getComputedStyle(x); if (st.position !== 'fixed' || st.display === 'none' || st.visibility === 'hidden' || st.pointerEvents === 'none') return false; const r = x.getBoundingClientRect(); return r.width * r.height >= innerWidth * innerHeight / 4; })).catch(() => true);
    if (layer) { await s.ctx.close(); s = await open(browser, SIZES[0], url); await mark(s.page); }
  }
  await s.ctx.close();
  return { pressed: Math.min(list.length, MAX_PRESSES), of: list.length, problems: out };
}

(async () => {
  await seed();
  const browser = await chromium.launch();
  const rows = [];
  const only = (process.env.ONLY || '').split(',').filter(Boolean);
  for (const [name, url] of SCREENS.filter(([, u]) => !only.length || only.includes(u.split(/[?#]/)[0]))) {
    const row = { name, url, sizes: {}, errors: [], missing: [], links: [] };
    for (const size of SIZES) {
      let s;
      try {
        s = await open(browser, size, url);
        row.sizes[size.name] = await s.page.evaluate(look);
        if (size === SIZES[0]) row.links = brokenLinks(await s.page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href'))));
        row.errors.push(...s.errors.map(e => size.name + ': ' + e));
        row.missing.push(...s.missing);
      } catch (e) { row.errors.push(size.name + ' open: ' + e.message.split('\n')[0]); }
      if (s) await s.ctx.close();
    }
    if (!process.env.NO_PRESS) { try { row.presses = await presses(browser, url); } catch (e) { row.presses = { error: e.message.split('\n')[0] }; } }
    row.errors = [...new Set(row.errors)]; row.missing = [...new Set(row.missing)];
    rows.push(row);
    const o = row.sizes.office || {}, p = row.sizes.phone || {};
    console.log(name.padEnd(28), 'covered', String((o.covered || []).length) + '/' + (p.covered || []).length, 'layers', ((o.layers || []).length + (p.layers || []).length), p.sideways ? 'SIDEWAYS' : '',
      'presses', row.presses ? (row.presses.pressed + ' problems ' + (row.presses.problems || []).length) : '-', row.errors.length ? 'ERR ' + row.errors[0].slice(0, 70) : '', row.missing.length ? 'MISSING ' + row.missing[0] : '', row.links.length ? 'BROKEN ' + row.links[0] : '');
    if (OUT) fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
