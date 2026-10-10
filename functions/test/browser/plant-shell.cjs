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
  // Joe 10/10 (typed): Shipping and Receiving sit beside the date on the title line; the buttons stay on the button line.
  ['scheduler.html', '.head', ['#add', '[data-view="week"]']],
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
    // The Plant Operations side (Joe 10/10): its name opens the Manager Center cards; the menu lists the cards in the same
    // order, a card with more than one area opens its screens beside it, and together they reach all 11 plant screens.
    const side = await openPage(browser, 1920, 950, '/manager.html' + MANAGER);
    await side.waitForSelector('#screen:not([hidden])');
    assert.equal(await side.getAttribute('.sidemenu a.side-name', 'href'), 'manager.html', 'Plant Operations opens Manager Center');
    assert.ok(await side.$('.sidemenu a.side-name.on'), 'Manager Center is the Plant Operations screen');
    assert.deepEqual(await side.$$eval('.sidemenu > a:not(.side-name):not(#go-home), .sidemenu > .side-sec > .side-sec-btn', x => x.map(e => e.textContent.replace(/[\u25b8]/g, '').trim())),
      ['Send Report', 'Yard Checks', 'Plant Operations Scheduler', 'Plant Distribution Departments', 'Quality Checks', 'Cooler Temperature', 'Shift Notes']);
    const hrefs = await side.$$eval('.sidemenu a[href], .side-flyouts a[href]', a => a.map(x => x.getAttribute('href').split(/[?#]/)[0]));
    for (const [page] of SCREENS) assert.ok(hrefs.indexOf(page) >= 0, page + ' is reachable from the Plant Operations side menu: ' + JSON.stringify(hrefs));
    assert.equal(await side.$('.mc-menu, aside'), null, 'Manager Center has no menu of its own');
    const grid = await side.$eval('#grid', g => g.getBoundingClientRect().left - document.querySelector('.sidemenu').getBoundingClientRect().right);
    assert.ok(grid < 40, 'the Manager Center cards start right beside the side menu: ' + grid);
    // The report card runs the full height of the left column; the other six cards share the two columns on the right.
    const boxes = await side.$$eval('#grid > .mc-card', c => c.map(x => { const r = x.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.bottom)]; }));
    assert.ok(boxes.slice(1).every(b => b[0] > boxes[0][0]), 'every other card is right of the report card ' + JSON.stringify(boxes));
    assert.ok(Math.abs(boxes[0][2] - Math.max(...boxes.map(b => b[2]))) <= 2 && Math.abs(boxes[0][1] - boxes[1][1]) <= 2, 'the report card is as tall as the three rows ' + JSON.stringify(boxes));
    await side.hover('.sidemenu .side-sec-btn[title="Plant Distribution Departments"]');
    await side.waitForSelector('.side-flyouts .flyout.open');
    assert.deepEqual(await side.$$eval('.side-flyouts .flyout.open a', a => a.map(x => x.textContent.trim())), ['Plant Departments', 'Loadout Center', 'Unloading & Washing', 'Product Returns', 'Truck Washing', 'Trailer Assignments', 'Plant Station']);
    await side.mouse.move(1500, 900);
    await Promise.all([side.waitForURL(/report=1/), side.click('.sidemenu a[href="manager.html?report=1"]')]);
    await side.waitForSelector('#modal:not([hidden])');
    assert.ok(await side.isVisible('#rp-subject'), 'Send Report in the menu opens the full report');
    // Joe 10/10: a menu click always opens the screen's default view (Scheduler = Shipping, the month, today), never the
    // last tab or mode used; the switches inside the screen stay.
    const menuHrefs = await side.$$eval('.sidemenu a[href], .side-flyouts a[href]', a => a.map(x => x.getAttribute('href')));
    assert.deepEqual(menuHrefs.filter(h => /\?/.test(h)), ['manager.html?report=1'], 'no plant menu link opens a remembered or side view');
    await side.close();
    const sch = await openPage(browser, 1920, 950, '/scheduler.html' + MANAGER);
    await sch.waitForSelector('.sc-day');
    await sch.click('[data-lane="RECEIVING"]');
    await sch.click('[data-view="week"]');
    await sch.click('#next');
    await sch.waitForURL(/lane=receiving/);
    await Promise.all([sch.waitForURL(u => /scheduler\.html$/.test(u.pathname) && !/lane=/.test(u.search)), sch.click('.sidemenu a[href="scheduler.html"]')]);
    await sch.waitForSelector('.sc-day');
    assert.equal(await sch.getAttribute('[data-lane="SHIPPING"]', 'aria-selected'), 'true', 'the Scheduler menu link opens Shipping');
    assert.equal(await sch.getAttribute('[data-view="month"]', 'aria-selected'), 'true', 'the Scheduler menu link opens the month');
    assert.equal(await sch.textContent('#lane-name'), 'Shipping');
    await sch.close();
    const unl = await openPage(browser, 1920, 950, '/unloading.html' + MANAGER);
    await unl.waitForSelector('#screen:not([hidden])');
    await unl.click('[data-mode="view"]');
    await unl.waitForSelector('[data-mode="view"][aria-selected="true"]');
    await unl.goto(HOSTING + '/unloading.html' + MANAGER);
    await unl.waitForSelector('[data-mode="check"][aria-selected="true"]', { timeout: 8000 }); // Check Off again, not the mode last used
    await unl.close();
    results.push('Plant Operations side reaches all 11 plant screens, Manager Center included; a menu click opens each screen\'s default view');

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
        if (page === 'scheduler.html') {
          const t = await p.evaluate(() => { const r = (s) => document.querySelector('.sc-titleline ' + s).getBoundingClientRect(); const d = r('#pick'), sh = r('[data-lane="SHIPPING"]'), rc = r('[data-lane="RECEIVING"]');
            return { mids: [d, sh, rc].map(x => Math.round(x.top + x.height / 2)), gap: Math.round(rc.left - sh.right), beside: Math.round(sh.left - d.right) }; });
          assert.ok(Math.max(...t.mids) - Math.min(...t.mids) <= 6 && t.beside >= 0 && t.beside < 60 && t.gap > 0, 'scheduler.html ' + w + ': Shipping and Receiving sit beside the date with a little space between them ' + JSON.stringify(t));
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
      results.push(w + ' wide: every plant screen has Back and Home; Unloading, Returns, Scheduler, Yard Checks and Temperatures keep their buttons and filters on one line; the Scheduler\'s Shipping and Receiving sit beside the date');
    }
    console.log(results.map(r => 'SHELL ' + r).join('\n'));
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
