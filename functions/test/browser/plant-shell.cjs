'use strict';
/*
 * Browser check of the plant screens in the new shell (Joe 10/10): the Plant Operations side reaches all 11 plant screens,
 * every plant screen has Back and Home, and each screen's buttons and filters sit on one line at the top (the buttons the same
 * height). Runs on the made-up plant at 1920 and 1366 wide.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const MANAGER = '?testEmail=manager.test@uniteddairy.com';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}

// Each screen's control line: the selector that holds it, and what must be on it.
const SCREENS = [
  ['plant.html', null],
  ['loadout.html', null],
  ['unloading.html', '.uw-tabrow', ['[data-mode="check"]', '[data-mode="view"]', '#tabs']],
  ['returns.html', '.head', ['[data-mode="check"]', '[data-mode="view"]']],
  ['washing.html', null],
  ['scheduler.html', '.sc-ctrl', ['#add', '[data-lane="SHIPPING"]', '[data-view="week"]', '#pick']],
  ['yard.html', '.head', ['[data-pane="current"]', '#refresh']],
  ['quality.html', null],
  ['shiftnotes.html', null],
  ['temps.html', '#bar', ['[data-pane="current"]', '#refresh', '[data-filter="ALL"]']],
  ['manager.html', null]
];

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  const browser = await chromium.launch();
  const results = [];
  try {
    // The Plant Operations side: its name opens Plant Departments, and its menu lists the other ten plant screens.
    const side = await openPage(browser, 1920, 950, '/plant.html' + MANAGER);
    await side.waitForSelector('#screen:not([hidden])');
    const hrefs = await side.$$eval('.sidemenu a[href]', a => a.map(x => x.getAttribute('href')));
    for (const [page] of SCREENS) assert.ok(hrefs.indexOf(page) >= 0, page + ' is reachable from the Plant Operations side menu: ' + JSON.stringify(hrefs));
    await side.close();
    results.push('Plant Operations side reaches all 11 plant screens, Manager Center included');

    for (const [w, h] of [[1920, 950], [1366, 650]]) {
      for (const [page, line, parts] of SCREENS) {
        const p = await openPage(browser, w, h, '/' + page + MANAGER);
        await p.waitForSelector('#screen:not([hidden])');
        await p.waitForTimeout(300);
        assert.ok(await p.isVisible('#go-back'), page + ' has Back');
        assert.ok(await p.isVisible('#go-home'), page + ' has Home');
        if (line) {
          const boxes = await p.evaluate(([line, parts]) => parts.map(s => { const el = document.querySelector(line + ' ' + s) || document.querySelector(s); const r = el && el.getBoundingClientRect(); return r ? [s, Math.round(r.top + r.height / 2), Math.round(r.height), !!el.closest(line)] : [s, null]; }), [line, parts]);
          boxes.forEach(b => assert.ok(b[1] !== null && b[3], page + ': ' + b[0] + ' is on the control line ' + JSON.stringify(boxes)));
          const mids = boxes.map(b => b[1]);
          assert.ok(Math.max(...mids) - Math.min(...mids) <= 6, page + ' ' + w + ': the buttons and filters are on one line ' + JSON.stringify(boxes));
        }
        assert.deepEqual(p.errors, [], page + ' has no page errors');
        await p.close();
      }
      results.push(w + ' wide: every plant screen has Back and Home; Unloading, Returns, Scheduler, Yard Checks and Temperatures keep their buttons and filters on one line');
    }
    console.log(results.map(r => 'SHELL ' + r).join('\n'));
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
