'use strict';
/*
 * Joe 10/23 ("this week I have an extra Ventura, so I actually have two on the same day ... a temporary, one-time thing"; picked
 * mock-up ca): on Weekly Dispatch, clicking a run's name shows "+ Extra this week", which puts a second line right under it for this
 * week only, every day off. Clicking a day picks its driver (the day turns on), the Driver Assignment Board shows it, and Daily
 * Dispatch has the load. The extra line reads THIS WEEK ONLY; clicking its name shows Remove, and a second click takes it off.
 * Pictures at 1536 and 1920 go to SHOTS_DIR when it is set.
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

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  await page.clock.setFixedTime(new Date('2026-10-09T12:00:00Z'));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const WEEKLY = '/weekly.html?week=2026-10-04&testEmail=dispatch.test@uniteddairy.com';
const line = (route, name) => 'xpath=//tbody[@id="rows"]/tr[td[1][text()="' + route + '"] and td[2][starts-with(normalize-space(.), "' + name + '")]]';
const extras = async () => (await db().collection('runs').where('extraRun', '==', true).get()).docs;

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  for (const id of ['run_t801', 'run_t802', 'run_t810']) await db().collection('routes').doc(id).update({ displayDaily: true, displayWeekly: true });
  const browser = await chromium.launch();
  try {
    for (const [w, h] of [[1920, 950], [1536, 790]]) {
      const page = await openPage(browser, w, h, WEEKLY);
      await page.waitForSelector('#rows td.run-name.pickable');
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'before-' + w + '.png') });
      // The button shows only once the name is clicked, and goes away on a click elsewhere.
      assert.equal(await page.$$eval('#rows .xr-plus', b => b.length), 0);
      await page.click(line('801', 'UT DSD MILK') + '/td[2]');
      await page.waitForSelector('#rows .xr-plus');
      const btn = await page.$eval('#rows .xr-plus', b => ({ text: b.textContent, size: parseFloat(getComputedStyle(b).fontSize) }));
      assert.equal(btn.text, '+ Extra this week');
      assert.ok(btn.size >= 16, 'text at least 16px');
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'after-1-button-' + w + '.png') });
      await page.click('#count');
      await page.waitForFunction(() => !document.querySelector('#rows .xr-plus'));
      await page.click(line('801', 'UT DSD MILK') + '/td[2]');
      await page.click('#rows .xr-plus');
      // The new line: right under 801, THIS WEEK ONLY, every day off.
      await page.waitForSelector('#rows tr.extra-run');
      const look = await page.$$eval('#rows tr', trs => {
        const i = trs.findIndex(t => t.classList.contains('extra-run'));
        return { above: trs[i - 1].children[1].textContent, name: trs[i].children[1].textContent, route: trs[i].children[0].textContent, off: [...trs[i].querySelectorAll('td.day')].every(td => td.classList.contains('off')) };
      });
      assert.equal(look.above, 'UT DSD MILK');
      assert.equal(look.name, 'UT DSD MILK 2THIS WEEK ONLY');
      assert.equal(look.route, '801');
      assert.ok(look.off, 'every day starts off');
      assert.equal((await extras()).length, 1);
      // Thursday: pick a driver, the day turns on.
      await page.click('#rows tr.extra-run td[data-day="thu"]');
      await page.waitForSelector('.popover select[data-kind="driver"]');
      await page.selectOption('.popover select[data-kind="driver"]', 'drv_test_casey');
      await page.waitForFunction(() => { const td = document.querySelector('#rows tr.extra-run td[data-day="thu"]'); return td && td.textContent.includes('CASEY, LEE'); }, null, { timeout: 8000 });
      let thu = null;
      for (let i = 0; i < 50 && !(thu && thu.runs && thu.driverId === 'drv_test_casey'); i++) { await page.waitForTimeout(200); thu = (await extras())[0].data().days.thu; }
      assert.equal(thu.runs, true);
      assert.equal(thu.driverId, 'drv_test_casey');
      // The Driver Assignment Board shows it on CASEY's Thursday.
      await page.waitForFunction(() => { const td = document.querySelector('#board-rows tr[data-driver="drv_test_casey"] td:nth-child(6)'); return td && td.textContent.includes('UT DSD MILK 2'); }, null, { timeout: 8000 });
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'after-2-new-line-' + w + '.png') });
      // Remove: its name shows Remove; the first click asks again, the second takes it off.
      await page.click('#rows tr.extra-run td.run-name');
      await page.waitForSelector('#rows .xr-remove');
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'after-3-remove-' + w + '.png') });
      await page.click('#rows .xr-remove');
      await page.waitForFunction(() => document.querySelector('#rows .xr-remove').textContent === 'Click again');
      assert.equal((await extras()).length, 1, 'not gone on the first click');
      await page.click('#rows .xr-remove');
      await page.waitForFunction(() => !document.querySelector('#rows tr.extra-run'), null, { timeout: 8000 });
      for (let i = 0; i < 50 && (await extras()).length; i++) await page.waitForTimeout(200);
      assert.equal((await extras()).length, 0);
      assert.deepEqual(page.errors, []);
      await page.close();
    }
    // Daily Dispatch: an extra line's load shows for its load day (Thursday's delivery loads Wednesday).
    let page = await openPage(browser, 1536, 790, WEEKLY);
    await page.click(line('801', 'UT DSD MILK') + '/td[2]');
    await page.click('#rows .xr-plus');
    await page.waitForSelector('#rows tr.extra-run');
    await page.click('#rows tr.extra-run td[data-day="thu"]');
    await page.selectOption('.popover select[data-kind="driver"]', 'drv_test_casey');
    await page.waitForFunction(() => document.querySelector('#rows tr.extra-run td[data-day="thu"]').textContent.includes('CASEY, LEE'), null, { timeout: 8000 });
    for (let i = 0; i < 50 && !((await extras())[0].data().days.thu.driverId); i++) await page.waitForTimeout(200);
    await page.close();
    page = await openPage(browser, 1536, 790, '/daily.html?date=2026-10-07&testEmail=dispatch.test@uniteddairy.com');
    const shown = 'xpath=//tbody[@id="rows"]/tr[contains(., "UT DSD MILK 2")]';
    await page.waitForSelector(shown, { state: 'visible', timeout: 15000 });
    assert.match(await page.textContent(shown), /CASEY, LEE/);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'after-4-daily-1536.png') });
    assert.deepEqual(page.errors, []);
    // A viewer sees the line but no button.
    const viewer = await openPage(browser, 1536, 790, '/weekly.html?week=2026-10-04&testEmail=viewer.test@uniteddairy.com');
    await viewer.waitForSelector('#rows tr.extra-run');
    assert.equal(await viewer.$$eval('#rows td.run-name.pickable', x => x.length), 0);
    console.log('weekly-extra-run: OK');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
