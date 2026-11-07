'use strict';
/*
 * Joe 11/6: "percentage of all routes covered" right beside the Weekly Dispatch Template title. The box reads
 * "37% OF RUNS COVERED" in red while any run that goes out has no driver, goes up as soon as a driver is picked, and every
 * button still fits on the title line at 1536 and 1920. Pictures go to SHOTS_DIR when it is set.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const sdk = (route) => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, sdk);
  await page.clock.setFixedTime(new Date('2026-10-09T12:00:00Z'));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
// The figure settles once every list has loaded (plant loads can add a day a moment later).
async function covered(page) {
  let last = await page.textContent('#covered'), same = 0;
  for (let i = 0; i < 40 && same < 4; i++) { await page.waitForTimeout(250); const now = await page.textContent('#covered'); same = now === last ? same + 1 : 0; last = now; }
  return last;
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  for (const id of ['run_t801', 'run_t802', 'run_t810']) await db().collection('routes').doc(id).update({ displayDaily: true, displayWeekly: true });
  const browser = await chromium.launch();
  try {
    for (const [w, h] of [[1536, 790], [1920, 950]]) {
      const page = await openPage(browser, w, h, '/weekly.html?week=2026-10-04&testEmail=dispatch.test@uniteddairy.com');
      await page.waitForSelector('#covered:not([hidden])');
      // 3 of the 8 days that go out have a driver (two NEEDS DRIVER, a PLANT LOAD and more are open).
      assert.equal(await covered(page), '37% OF RUNS COVERED');
      assert.match(await page.getAttribute('#covered', 'title'), /^3 of 8 run days this week have a driver$/);
      const look = await page.evaluate(() => {
        const c = document.getElementById('covered').getBoundingClientRect(), h1 = document.getElementById('page-name').getBoundingClientRect();
        const btns = [...document.querySelectorAll('.head .actions.in-head :is(button, a.button)')].filter(b => b.offsetParent).map(b => b.getBoundingClientRect());
        return { bg: getComputedStyle(document.getElementById('covered')).backgroundColor, besideTitle: Math.abs((c.top + c.bottom) - (h1.top + h1.bottom)) < 12 && c.left > h1.right,
          clear: btns.every(b => b.left >= c.right), cut: [...document.querySelectorAll('.head .actions.in-head :is(button, a.button)')].filter(b => b.offsetParent && b.scrollHeight > b.clientHeight + 1).map(b => b.textContent), fits: btns.every(b => b.right <= innerWidth) && document.documentElement.scrollWidth <= innerWidth, oneRow: new Set(btns.map(b => Math.round(b.top / 10))).size === 1 };
      });
      assert.equal(look.bg, 'rgb(180, 35, 24)', 'red until every run has a driver');
      assert.ok(look.besideTitle, 'right beside the title');
      assert.deepEqual(look.cut, [], 'no button has its words cut off at ' + w);
      assert.ok(look.clear && look.fits && look.oneRow, 'every button still fits on the title line at ' + w + ': ' + JSON.stringify(look));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'weekly-covered-' + w + '.png') });
      assert.deepEqual(page.errors, []);
      await page.close();
    }
    // Joe 11/7 ("it was supposed to be right beside the weekly dispatch"): the live Weekly Dispatch week shows it beside its title too.
    for (const [w, h] of [[1536, 790], [1920, 950]]) {
      const live = await openPage(browser, w, h, '/weekly.html?view=live&testEmail=dispatch.test@uniteddairy.com');
      await live.waitForSelector('#covered:not([hidden])');
      assert.match(await covered(live), /^\d+% OF RUNS COVERED$/);
      assert.equal(await live.textContent('#page-name'), 'Weekly Dispatch');
      const at = await live.evaluate(() => { const c = document.getElementById('covered').getBoundingClientRect(), h1 = document.getElementById('page-name').getBoundingClientRect();
        const cut = [...document.querySelectorAll('.head .actions.in-head :is(button, a.button)')].some(b => b.offsetParent && b.scrollHeight > b.clientHeight + 1);
        return Math.abs((c.top + c.bottom) - (h1.top + h1.bottom)) < 12 && c.left > h1.right && document.documentElement.scrollWidth <= innerWidth && !cut; });
      assert.ok(at, 'beside the Weekly Dispatch title, no button words cut, at ' + w);
      if (SHOTS) await live.screenshot({ path: path.join(SHOTS, 'weekly-dispatch-covered-' + w + '.png') });
      assert.deepEqual(live.errors, []);
      await live.close();
    }
    // Picking a driver for 802 Tuesday (NEEDS DRIVER) moves it to 4 of 8 straight away.
    const page = await openPage(browser, 1536, 790, '/weekly.html?week=2026-10-04&testEmail=dispatch.test@uniteddairy.com');
    await page.waitForSelector('#covered:not([hidden])');
    assert.equal(await covered(page), '37% OF RUNS COVERED');
    const tue = await page.evaluateHandle(() => [...document.querySelectorAll('#rows tr')].find(tr => tr.children[0].textContent === '802').querySelector('td[data-day="tue"]'));
    await tue.click();
    await page.waitForSelector('.popover select[data-kind="driver"]');
    await page.selectOption('.popover select[data-kind="driver"]', 'drv_test_casey');
    await page.waitForFunction(() => document.getElementById('covered').textContent === '50% OF RUNS COVERED', null, { timeout: 8000 });
    assert.deepEqual(page.errors, []);
    console.log('weekly-covered: 37% red beside the title, buttons fit at 1536 and 1920, 50% after a driver is picked');
  } finally {
    await browser.close();
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
