'use strict';
/*
 * Browser check of Shift Reports (Joe 10/11: the reports have their own place, not inside Shift Notes): a report sent from
 * Manager Center shows at the top of the list with its shift and who sent it, and opens as it was emailed; two older reports
 * (one a day earlier, one on another shift) filter by Report Date and Shift. The Plant menu has Reports > Shift Reports.
 * Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
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
const SHOTS = process.env.SHOTS_DIR || '';
const MANAGER = 'testEmail=manager.test@uniteddairy.com';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: SHOTS && width === 1920 ? 2 : 1 });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    const file = route.request().url().split('/').pop();
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, file)) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url + (url.indexOf('?') >= 0 ? '&' : '?') + MANAGER);
  page.errors = errors;
  return page;
}
async function shots(page, name, w) {
  if (!SHOTS) return;
  await page.screenshot({ path: path.join(SHOTS, name + '-' + w + '.png'), scale: 'css' });
  if (w === 1920) await page.screenshot({ path: path.join(SHOTS, name + '-top-2x.png'), clip: { x: 0, y: 0, width: 1920, height: 540 }, scale: 'device' });
}
const routes = (page) => page.$$eval('#rows tr[data-id]', t => t.map(r => [...r.children].slice(0, 3).map(td => td.textContent)));

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  const today = L.operatingDay(new Date()), yesterday = L.addDays(today, -1);
  // Two older reports: yesterday 7:30 AM New York (first shift), and yesterday 4:00 PM (second shift), text only.
  const ny = (d, h, m) => new Date(Date.parse(d + 'T00:00:00Z') + ((h + 4) * 60 + (m || 0)) * 60000).toISOString(); // EDT
  await db().collection('plantReports').doc('REPORT_old1').set({ subject: 'Uniontown plant report (morning)', text: 'ROUTES\n801 LOADED', note: '', status: 'SENT', sentTo: ['jcartwright@uniteddairy.com'], date: yesterday, at: ny(yesterday, 7, 30), by: 'supervisor.test@uniteddairy.com', mode: 'test' });
  await db().collection('plantReports').doc('REPORT_old2').set({ subject: 'Uniontown plant report (afternoon)', text: 'ROUTES\n805 BEHIND', note: '', status: 'HELD', date: yesterday, at: ny(yesterday, 16), by: 'manager.test@uniteddairy.com', mode: 'test' });
  const browser = await chromium.launch();
  const results = [];
  try {
    // Send one from Manager Center, as a manager does.
    const mgr = await openPage(browser, 1920, 950, '/manager.html');
    await mgr.waitForSelector('#screen:not([hidden])');
    await mgr.waitForFunction(() => !document.getElementById('send-card').disabled && !document.getElementById('send-card').hidden, null, { timeout: 15000 });
    await mgr.click('#send-card');
    await mgr.waitForFunction(() => /Report saved/.test(document.getElementById('saved').textContent), null, { timeout: 8000 });

    // The Plant menu: Reports opens Shift Reports and Plant Reports.
    const page = await openPage(browser, 1920, 950, '/shiftreports.html');
    await page.waitForFunction(() => document.querySelectorAll('#rows tr[data-id]').length === 3, null, { timeout: 8000 });
    const menu = await page.$$eval('.sidemenu a, .sidemenu button', a => a.map(x => x.textContent.trim()));
    assert.ok(menu.some(x => /^Reports/.test(x)), 'the Plant menu has Reports: ' + menu.join(' | '));
    const list = await routes(page);
    assert.match(list[0][0], /^\d{1,2}-\d{1,2}-\d{2} \d{1,2}:\d{2} [AP]M$/, 'short date and time');
    assert.match(list[0][1], /^(First|Second|Third) shift$/);
    assert.equal(list[0][2], 'manager.test');
    assert.deepEqual(list.slice(1).map(r => [r[1], r[2]]), [['Second shift', 'manager.test'], ['First shift', 'supervisor.test']], 'newest first, each with its shift and who sent it');
    // The newest opens on the right as it was emailed.
    await page.waitForFunction(() => /ROUTES|Routes|LOADED|loaded/i.test((document.getElementById('frame').contentDocument || {}).body ? ((document.getElementById('frame').contentDocument || {}).body || {}).textContent || '' : ''), null, { timeout: 8000 });
    assert.match(await page.textContent('#subject'), /\S/);
    await shots(page, 'shift-reports', 1920);
    results.push('Shift Reports: the report just sent is on top (' + list[0].join(' · ') + ') and opens as emailed; the older two follow, newest first');

    // Pick an older one: it opens.
    await page.click('#rows tr[data-id="REPORT_old2"]');
    await page.waitForFunction(() => /805 BEHIND/.test(((document.getElementById('frame').contentDocument || {}).body || {}).textContent || ''));
    assert.match(await page.textContent('#rows tr[data-id="REPORT_old2"]'), /Saved, not emailed/);
    // Report Date and Shift filter the list.
    await page.fill('#date', yesterday);
    await page.dispatchEvent('#date', 'change');
    await page.waitForFunction(() => document.querySelectorAll('#rows tr[data-id]').length === 2);
    await page.selectOption('#shift', 'First Shift');
    await page.waitForFunction(() => document.querySelectorAll('#rows tr[data-id]').length === 1 && /801 LOADED/.test(((document.getElementById('frame').contentDocument || {}).body || {}).textContent || ''));
    await page.click('#all');
    await page.selectOption('#shift', '');
    await page.waitForFunction(() => document.querySelectorAll('#rows tr[data-id]').length === 3);
    results.push('Report Date (' + yesterday + ') shows 2, Shift First shows 1 and opens it; All Dates shows 3 again');
    // One line of same-size controls at the top, 16px text, no page scroll sideways.
    const top = await page.$$eval('.rp-ctrl .rp-btn, .rp-ctrl select, .rp-ctrl .rp-step', b => b.map(x => Math.round(x.getBoundingClientRect().top + x.getBoundingClientRect().height)));
    assert.ok(Math.max(...top) - Math.min(...top) <= 2, 'controls on one line: ' + top.join(','));
    assert.equal(await page.$eval('#rows td', td => getComputedStyle(td).fontSize), '16px');
    for (const [w, h] of [[1366, 650]]) {
      await page.setViewportSize({ width: w, height: h });
      assert.ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth), 'no sideways scroll at ' + w);
      await shots(page, 'shift-reports', w);
    }
    for (const p of [mgr, page]) assert.deepEqual(p.errors, []);
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('SHIFTREPORTS ' + r));
})().catch(e => { console.error(e); process.exit(1); });
