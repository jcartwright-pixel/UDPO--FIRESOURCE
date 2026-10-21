'use strict';
/*
 * What each screen draws while it opens, and whether anything sits on top of a button (Joe 10/21: "the older screens are
 * loading and then it's refreshing on the new ones ... I do not want any overlays ... we seem to hide action buttons").
 * Opens every main screen at Joe's window size (1536x790) against the local test database and notes:
 *  - replaced: things that were on the screen (had a size, and the screen was showing) and were taken off again while it
 *    opened, with their words,
 *  - shift: how far the page jumped while it opened (the browser's layout-shift score),
 *  - covered: buttons, links and boxes in view whose middle is under something else, and what that is,
 *  - drawn over: anything the code lays on top of the page (absolute or fixed) over a button or box.
 * Not part of npm run test:browser (it measures, it does not pass or fail). Usage, inside the emulators:
 *   node test/browser/screen-paint.cjs [out.json]      ONLY=a.html,b.html to pick screens
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');
const L = require('../../src/logic');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const OUT = process.argv[2] || '';
const WHO = 'testEmail=admin.test@uniteddairy.com';
const SCREENS = fs.readFileSync(path.join(__dirname, 'screen-timings.cjs'), 'utf8').match(/const SCREENS = \[([\s\S]*?)\n\];/)[1]
  .match(/\['[^']+', '[^']+'\]/g).map(s => s.match(/'([^']+)', '([^']+)'/).slice(1));

function init() {
  const out = window.__paint = { replaced: [], shiftTotal: 0, shifts: [] };
  const shown = () => { const s = document.getElementById('screen'); return (!s || !s.hidden) && !document.body.classList.contains('ud-drawing'); };
  // A node keeps its last size while it is on the page; when one is taken off, its size from just before says whether it showed.
  const seen = new WeakMap();
  const note = () => { document.querySelectorAll('#screen *').forEach(el => { if (el.children.length > 40) return; const r = el.getBoundingClientRect(); if (r.width && r.height) seen.set(el, 1); }); };
  let frame = 0;
  const tick = () => { if (shown()) note(); if (++frame < 600) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  new MutationObserver(ms => {
    if (!shown()) return;
    ms.forEach(m => m.removedNodes.forEach(n => {
      if (n.nodeType !== 1 || !seen.has(n)) return;
      const text = (n.innerText || n.textContent || '').trim().replace(/\s+/g, ' ');
      if (!text || /^[-–—0-9.,:%\s]*$/.test(text)) return;
      out.replaced.push({ at: Math.round(performance.now()), tag: n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).join('.') : ''), text: text.slice(0, 80) });
    }));
  }).observe(document, { childList: true, subtree: true });
  try {
    new PerformanceObserver(l => l.getEntries().forEach(e => { if (!e.hadRecentInput) { out.shiftTotal += e.value; if (e.value > 0.01) out.shifts.push({ at: Math.round(e.startTime), value: +e.value.toFixed(3), what: (e.sources || []).map(s => s.node && s.node.nodeType === 1 ? s.node.tagName.toLowerCase() + (s.node.id ? '#' + s.node.id : '') + (typeof s.node.className === 'string' && s.node.className ? '.' + s.node.className.trim().split(/\s+/)[0] : '') : '').filter(Boolean).slice(0, 3) }); } })).observe({ type: 'layout-shift', buffered: true });
  } catch (e) { /* not supported */ }
}

// In the page, once it has settled: what is covered, and what is drawn over the page.
function look() {
  const name = (el) => el ? el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '') : 'nothing';
  const vw = innerWidth, vh = innerHeight, covered = [], over = new Map();
  const controls = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [data-open], .dc-metric')];
  controls.forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.opacity === '0' || el.closest('[hidden], .side-flyouts')) return;
    const x = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
    // Scrolled out of its own box (a long list below the fold) is not covered: it is simply not in view.
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).overflow === 'visible') continue;
      const q = p.getBoundingClientRect();
      if (x < q.left || x > q.right || y < q.top || y > q.bottom) return;
    }
    const hit = document.elementFromPoint(x, y);
    if (!hit || el.contains(hit) || hit.contains(el) || (el.tagName === 'LABEL' && el.control === hit) || (hit.tagName === 'LABEL' && hit.control === el)) return;
    // Something else is at the middle of this control.
    let top = hit;
    for (let p = hit; p && p !== document.body; p = p.parentElement) { const ps = getComputedStyle(p).position; if (ps === 'fixed' || ps === 'absolute' || ps === 'sticky') { top = p; break; } }
    covered.push({ control: name(el), words: (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').trim().slice(0, 40), under: name(top), position: getComputedStyle(top).position });
  });
  // Anything absolute or fixed with a size, over the screen (not the menu strip and its fly-outs), that lies on a control.
  document.querySelectorAll('#screen *, body > *').forEach(el => {
    const cs = getComputedStyle(el);
    if (cs.position !== 'absolute' && cs.position !== 'fixed') return;
    if (el.closest('[hidden]') || cs.display === 'none' || cs.visibility === 'hidden' || el.closest('.sidemenu, .side-flyouts')) return;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom <= 0 || r.top >= vh) return;
    const on = controls.filter(c => c !== el && !el.contains(c) && !c.contains(el) && !c.closest('[hidden]')).filter(c => { const q = c.getBoundingClientRect(); return q.width && q.height && q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top; });
    if (!on.length) return;
    const k = name(el);
    if (!over.has(k)) over.set(k, { el: k, position: cs.position, size: Math.round(r.width) + 'x' + Math.round(r.height), on: on.slice(0, 3).map(name), n: 0 });
    over.get(k).n++;
  });
  return { covered, over: [...over.values()], prerender: (performance.getEntriesByType('navigation')[0] || {}).activationStart > 0 };
}

// REAL=1: last, this and next week with 80 loads each, the real Live sheet's size (as screen-timings.cjs REAL=1).
async function realWeeks() {
  const d = db(), runs = (await d.collection('runs').where('weekStart', '==', '2026-10-04').get()).docs.map(x => x.data());
  const wk = L.weekStart(L.operatingDay(new Date()));
  let batch = d.batch(), n = 0;
  for (const target of [L.addDays(wk, -7), wk, L.addDays(wk, 7)]) {
    const shift = L.daysBetween('2026-10-04', target);
    for (let i = 0; i < 80; i++) {
      const run = JSON.parse(JSON.stringify(runs[i % runs.length]).replace(/"(\d{4}-\d{2}-\d{2})/g, (m, k) => '"' + L.addDays(k, shift)));
      Object.assign(run, { weekStart: target, route: String(1000 + i), runId: 'run_real' + i, routeId: 'rte_real' + i, sheetRow: 10 + i });
      batch.set(d.collection('runs').doc(target + '__run_real' + i), run);
      if (++n % 400 === 0) { await batch.commit(); batch = d.batch(); }
    }
  }
  await batch.commit();
  await new Promise(r => setTimeout(r, 8000)); // the one-day load records catch up
}

// The browser's own count of the work the page did (milliseconds of script, layout and style, and how many layouts).
async function work(cdp) {
  const m = {};
  (await cdp.send('Performance.getMetrics')).metrics.forEach(x => { m[x.name] = x.value; });
  return { script: m.ScriptDuration * 1000, layout: m.LayoutDuration * 1000, style: m.RecalcStyleDuration * 1000, task: m.TaskDuration * 1000, layouts: m.LayoutCount };
}
const less = (a, b) => Object.fromEntries(Object.keys(a).map(k => [k, Math.round(a[k] - b[k])]));

(async () => {
  if (!process.env.NOSEED) {
    await clear();
    await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
    if (process.env.REAL) await realWeeks();
  }
  const browser = await chromium.launch();
  const only = (process.env.ONLY || '').split(',').filter(Boolean), rows = [];
  for (const [label, url] of SCREENS.filter(([, u]) => !only.length || only.includes(u.split(/[?#]/)[0]))) {
    const ctx = await browser.newContext({ viewport: { width: 1536, height: 790 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) }));
    await page.addInitScript(init);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const [bare, hash] = url.split('#');
    let row;
    try {
      await page.goto(HOSTING + '/' + bare + (bare.includes('?') ? '&' : '?') + WHO + (hash ? '#' + hash : ''), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const opening = await work(cdp);
      // Sitting on the screen for 10 seconds with nobody touching it: what it keeps doing.
      await page.waitForTimeout(10000);
      const idle = less(await work(cdp), opening);
      const seen = await page.evaluate(look);
      const p = await page.evaluate(() => window.__paint || { replaced: [], shiftTotal: 0, shifts: [] });
      row = { label, url, landed: page.url().split('/').pop().split('?')[0], replaced: p.replaced, shift: +p.shiftTotal.toFixed(3), shifts: p.shifts, covered: seen.covered, over: seen.over, errors, opening: less(opening, { script: 0, layout: 0, style: 0, task: 0, layouts: 0 }), idle };
    } catch (e) { row = { label, url, error: e.message }; }
    rows.push(row);
    console.log(label.padEnd(28), 'replaced', String((row.replaced || []).length).padStart(3), 'shift', String(row.shift).padStart(6), 'covered', String((row.covered || []).length).padStart(3), 'open ms', row.opening ? row.opening.task + ' (script ' + row.opening.script + ', layout ' + row.opening.layout + 'x' + row.opening.layouts + ')' : '-', 'idle10s', row.idle ? row.idle.task : '-', 'over', (row.over || []).map(o => o.el + '(' + o.n + ')').join(' ').slice(0, 120));
    await ctx.close();
  }
  await browser.close();
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
