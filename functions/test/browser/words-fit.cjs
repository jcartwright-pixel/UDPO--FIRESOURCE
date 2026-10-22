'use strict';
/*
 * Joe 10/22 (practice test on live data, "fix any of the bugs you found"): words cut off with "…" at 1536 and 1920 wide
 * (Route Distribution tiles NEEDS DRI…, Daily Dispatch's day picker "Wednesd" and week box "10-18-2", Plant Departments'
 * "23 loads · 2 pic…" and "Behind schedule all departments · 3…", Late Forecast "Pa…", Cooler Temperature "Senso r").
 * On the made-up plant day, each of those screens is opened at 1536 x 790 and 1920 x 950 and every piece of text is
 * checked: none is cut short, none breaks inside a word, none spills out of its box, and none is under 16px.
 * With SHOTS_DIR=<folder> it saves pictures. Usage: firebase emulators:exec ... "node test/browser/words-fit.cjs"
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const NOON = new Date(PD.PLANT_DATE + 'T16:00:00Z');
const PAGES = [
  ['distribution.html', '[data-n="daily.loads"]'],
  ['daily.html', '#day-select, select'],
  ['plant.html', '[data-n="load.total"]'],
  ['manager.html', '.mc-tile'],
  ['forecast.html', '.forecast-page'],
  ['temps.html', '#rows tr[data-location]']
];

// Every element whose own text is cut short ("…" or clipped), broken inside a word, wider than its box, or under 16px.
const misfits = (page) => page.evaluate(() => {
  const out = [];
  const own = (el) => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
  document.querySelectorAll('body *').forEach(el => {
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return;
    if (el.closest('[hidden], .modal, svg, script, style, option, .sr-only, nav.sidemenu, .sidemenu')) return;
    const words = own(el);
    if (!words) return;
    const cs = getComputedStyle(el);
    const name = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '') + ' "' + words.slice(0, 40) + '"';
    if (parseFloat(cs.fontSize) < 15.5) out.push('small ' + cs.fontSize + ' ' + name);
    const cut = (cs.overflow !== 'visible' || cs.textOverflow === 'ellipsis') && (el.scrollWidth > el.clientWidth + 1 || (cs.webkitLineClamp === 'none' && el.scrollHeight > el.clientHeight + 2));
    if (cut) out.push('cut ' + name);
    if (el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
    // A word broken across two lines (one word's letters on two lines).
    const r = document.createRange();
    for (const n of el.childNodes) {
      if (n.nodeType !== 3) continue;
      const re = /\S+/g; let m;
      while ((m = re.exec(n.textContent))) {
        r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
        if (new Set([...r.getClientRects()].map(x => Math.round(x.top))).size > 1) out.push('word split ' + name + ' at "' + m[0] + '"');
      }
    }
  });
  // A picker or box whose value is cut (the day name, the week date).
  document.querySelectorAll('select, input[type="date"], input[type="text"]').forEach(el => {
    if (!el.offsetParent) return;
    // A picker is checked with its longest choice (Wednesday), a date box with a two-digit date.
    const v = el.tagName === 'SELECT' ? [...el.options].map(o => o.textContent).sort((a, b) => b.length - a.length)[0] || '' : el.value;
    if (!v) return;
    const probe = document.createElement('span'), cs = getComputedStyle(el);
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:' + cs.font + ';letter-spacing:' + cs.letterSpacing;
    probe.textContent = el.type === 'date' ? '10-18-26' : v;
    document.body.appendChild(probe);
    const need = probe.getBoundingClientRect().width, room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - (el.tagName === 'SELECT' || el.type === 'date' ? 22 : 0);
    probe.remove();
    if (need > room + 1) out.push('box cut ' + (el.id || el.tagName) + ' "' + v + '"');
  });
  return [...new Set(out)];
});

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date(PD.PLANT_DATE + 'T14:00:00Z') });
  const browser = await chromium.launch();
  const results = [], found = [];
  try {
    for (const [w, h] of [[1536, 790], [1920, 950]]) {
      for (const [url, ready] of PAGES) {
        const page = await browser.newPage({ viewport: { width: w, height: h }, serviceWorkers: 'block' });
        await page.clock.setFixedTime(NOON);
        await localCalls(page);
        await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, r.request().url().split('/').pop())) }));
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(HOSTING + '/' + url + (url.indexOf('?') < 0 ? '?' : '&') + 'date=' + PD.PLANT_DATE + '&testEmail=admin.test@uniteddairy.com');
        await page.waitForSelector(ready, { timeout: 20000 });
        await page.waitForTimeout(1500);
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'words-fit-' + url.replace(/\W+/g, '-') + w + '.png') });
        (await misfits(page)).forEach(m => found.push(w + ' ' + url + ': ' + m));
        assert.deepEqual(errors, [], url + ' errors');
        await page.close();
      }
    }
    if (process.env.LIST_ONLY) { found.forEach(f => console.log(f)); return; }
    assert.deepEqual(found, [], 'every word whole');
    results.push('Route Distribution, Daily Dispatch, Plant Departments, Manager Center, Late Forecast and Cooler Temperature at 1536 and 1920: every word whole, none cut off or split, 16px or larger');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok - ' + r));
})().catch((e) => { console.error(e); process.exit(1); });
