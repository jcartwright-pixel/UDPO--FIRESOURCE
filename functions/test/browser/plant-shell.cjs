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
  ['unloading.html', '.head', ['[data-mode="check"]', '[data-mode="view"]', '#tabs']],
  ['returns.html', '.head', ['[data-mode="check"]', '[data-mode="view"]']],
  ['washing.html', null],
  ['scheduler.html', '.head', ['#add', '[data-lane="SHIPPING"]', '[data-view="week"]', '#pick']],
  ['yard.html', '.head', ['[data-pane="current"]', '#refresh']],
  ['quality.html', null],
  ['shiftnotes.html', null],
  ['temps.html', '.head', ['[data-pane="current"]', '#refresh', '[data-filter="ALL"]']],
  ['manager.html', null]
];

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  const browser = await chromium.launch();
  const results = [];
  try {
    // The Plant Operations side (Joe 10/10): only section names in the menu, like Dispatch and Drivers on the Distribution
    // side; each section's screens open beside it, and together they reach all 11 plant screens. No screen keeps a menu of its own.
    const side = await openPage(browser, 1920, 950, '/manager.html' + MANAGER);
    await side.waitForSelector('#screen:not([hidden])');
    assert.deepEqual(await side.$$eval('.side-flyouts .flyout-title', t => t.map(x => x.textContent)),
      ['Departments', 'Scheduler', 'Yard Checks', 'Quality', 'Coolers', 'Shift Notes', 'Manager Center']);
    const hrefs = await side.$$eval('.sidemenu a[href], .side-flyouts a[href]', a => a.map(x => x.getAttribute('href').split(/[?#]/)[0]));
    for (const [page] of SCREENS) assert.ok(hrefs.indexOf(page) >= 0, page + ' is reachable from the Plant Operations side menu: ' + JSON.stringify(hrefs));
    assert.equal(await side.$('.mc-menu, aside'), null, 'Manager Center has no menu of its own');
    const grid = await side.$eval('#grid', g => g.getBoundingClientRect().left - document.querySelector('.sidemenu').getBoundingClientRect().right);
    assert.ok(grid < 40, 'the Manager Center cards start right beside the side menu: ' + grid);
    await side.hover('.sidemenu .side-sec.on .side-sec-btn');
    await side.waitForSelector('.side-flyouts .flyout.open');
    assert.deepEqual(await side.$$eval('.side-flyouts .flyout.open a', a => a.map(x => x.textContent.trim())), ['Manager Center', 'Send Current Report']);
    if (process.env.SHOTS_DIR) await side.screenshot({ path: path.join(process.env.SHOTS_DIR, 'plant-menu-shell-check-1920.png') });
    await Promise.all([side.waitForURL(/report=1/), side.click('.side-flyouts .flyout.open a[href="manager.html?report=1"]')]);
    await side.waitForSelector('#modal:not([hidden])');
    assert.ok(await side.isVisible('#rp-subject'), 'Send Current Report in the menu opens the full report');
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
        // The shared top line (data-top): the action buttons are one even row and none is left down in the screen.
        const tiles = await p.evaluate(() => {
          const vis = e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
          const head = document.querySelector('#screen .head');
          if (!head) return { stray: [], tiles: [] };
          const stray = [...document.querySelectorAll('#screen [data-top]')].filter(e => vis(e) && !head.contains(e)).map(e => e.id || e.className);
          const t = [...head.querySelectorAll('.actions button, .actions a.button')].filter(b => vis(b) && !b.closest('.chips, .seg, .stepper') && !/^(prev|next)$/.test(b.id)).map(b => b.getBoundingClientRect());
          return { stray, tiles: t.map(r => [Math.round(r.top), Math.round(r.width), Math.round(r.height)]) };
        });
        assert.deepEqual(tiles.stray, [], page + ': nothing marked for the top line is left in the screen');
        assert.ok(tiles.tiles.every(t => Math.abs(t[0] - tiles.tiles[0][0]) <= 4 && t[1] === tiles.tiles[0][1] && t[2] === tiles.tiles[0][2]), page + ' ' + w + ': the action buttons are one even row ' + JSON.stringify(tiles.tiles));
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
