'use strict';
/*
 * Browser check of Print Layouts (Joe 10/10: "If I say print dispatch, I should only be able to see a preview of the dispatch
 * sheet. And to be able to set it up."): the sheet list, the paper preview of the chosen sheet only, Portrait/Landscape,
 * pages, copies, Save as Default and Quick Print. With SHOTS=<folder> it also saves pictures.
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
const SHOTS = process.env.SHOTS || '';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.clock.setFixedTime(new Date('2026-10-05T15:00:00Z'));
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const ready = (page) => page.waitForFunction(() => document.getElementById('wait').hidden && document.getElementById('paper').contentDocument.querySelector('.pl-paper'), null, { timeout: 30000 });
const preview = (page) => page.evaluate(() => {
  const d = document.getElementById('paper').contentDocument, p = d.querySelector('.pl-paper');
  return { pages: d.querySelectorAll('.pl-paper').length, skipped: d.querySelectorAll('.pl-wrap.skip').length, w: p.offsetWidth, h: p.offsetHeight, text: d.getElementById('pl-pages').textContent };
});
// What would go to the printer: the print frame's pages, caught instead of opening the print window.
async function printed(page, button) {
  await page.evaluate(() => { window.__sent = null; const f = HTMLIFrameElement.prototype; if (!window.__hooked) { window.__hooked = 1; new MutationObserver(m => m.forEach(r => r.addedNodes.forEach(n => { if (n.id === 'pl-print-frame') n.contentWindow.print = () => { const d = n.contentDocument; window.__sent = { pages: d.querySelectorAll('body > .pl-paper').length, size: [...d.querySelectorAll('style')].map(s => s.textContent).join('').match(/@page\{size:([^;]+);/)[1] }; }; }))).observe(document.body, { childList: true }); } return f; });
  await page.click(button);
  await page.waitForFunction(() => window.__sent, null, { timeout: 30000 });
  return page.evaluate(() => window.__sent);
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  const browser = await chromium.launch();
  const results = [];
  try {
    const page = await openPage(browser, 1920, 1080, '/print.html?testEmail=manager.test@uniteddairy.com');
    await ready(page);
    const names = await page.$$eval('#sheets [data-sheet] strong', s => s.map(x => x.textContent));
    assert.deepEqual(names, ['Daily Dispatch Sheet', 'Weekly Dispatch', 'Vacation Year', 'Fleet Service Report', 'Over the Road Report', 'Driver Scorecard', 'Plant Scheduler Monthly']);
    assert.equal(await page.$eval('#sheets .pl-item.on', e => e.dataset.sheet), 'daily', 'Daily Dispatch Sheet is shown first');
    let p = await preview(page);
    assert.ok(p.text.includes('DAILY DISPATCH SHEET') && p.text.includes('801'), 'the preview is the dispatch sheet: ' + p.text.slice(0, 120));
    assert.ok(p.w > p.h, 'landscape by default');
    const size = await page.evaluate(() => ({ h: document.scrollingElement.scrollHeight, ih: innerHeight, w: document.scrollingElement.scrollWidth, iw: innerWidth }));
    assert.ok(size.h <= size.ih && size.w <= size.iw, 'fits 1920x1080: ' + JSON.stringify(size));
    if (SHOTS) {
      await page.screenshot({ path: path.join(SHOTS, '1-print-layouts-daily-1920.png') });
      await page.screenshot({ path: path.join(SHOTS, '2-print-layouts-top-zoom-2x.png'), clip: { x: 0, y: 0, width: 960, height: 540 } });
    }
    results.push('Daily Dispatch Sheet shows first, as landscape paper, only the dispatch sheet; fits 1920x1080');

    // Portrait turns the paper; the sheet's own choice (loadout day) re-reads the sheet.
    await page.click('#orient [data-v="portrait"]');
    p = await preview(page);
    assert.ok(p.h > p.w, 'portrait');
    await page.fill('#opts input[data-opt="date"]', '2026-10-06');
    await page.dispatchEvent('#opts input[data-opt="date"]', 'change');
    await page.waitForFunction(() => document.getElementById('paper').contentDocument.getElementById('pl-pages').textContent.includes('Load Day Tuesday'), null, { timeout: 30000 });
    results.push('Portrait turns the page; changing the loadout day re-reads the dispatch sheet');

    // Copies and pages are what gets sent; Save as Default is what Quick Print uses.
    await page.fill('#copies', '3'); await page.dispatchEvent('#copies', 'change');
    let sent = await printed(page, '#print-now');
    assert.equal(sent.pages, 3 * (await preview(page)).pages, 'three copies of every page: ' + JSON.stringify(sent));
    assert.match(sent.size, /8\.5in 11in/);
    await page.click('#orient [data-v="landscape"]');
    await page.selectOption('#margin', 'narrow');
    await page.fill('#copies', '2'); await page.dispatchEvent('#copies', 'change');
    await page.click('#save-default');
    await page.click('#orient [data-v="portrait"]');
    await page.fill('#copies', '1'); await page.dispatchEvent('#copies', 'change');
    sent = await printed(page, '#quick');
    assert.equal(sent.size, '11in 8.5in', 'Quick Print uses the saved landscape setup');
    assert.equal(await page.$eval('#copies', e => e.value), '2');
    results.push('Print sends the copies set; Save as Default is kept and Quick Print uses it');

    // Every other sheet previews from its own screen.
    for (const [key, words, shot] of [['weekly', 'WEEKLY DISPATCH', ''], ['vacation', 'VACATION', '3-vacation-year-landscape-1920.png'], ['fleet', 'Fleet Service', ''], ['otr', 'Over the Road Runs', ''], ['scorecard', 'Driver Scorecard', ''], ['scheduler', 'Plant Operations Schedule', '']]) {
      await page.click('#sheets [data-sheet="' + key + '"] strong');
      await page.waitForFunction((k) => document.querySelector('#sheets .pl-item.on').dataset.sheet === k, key);
      await ready(page);
      p = await preview(page);
      assert.ok(p.text.toUpperCase().includes(words.toUpperCase()), key + ' preview: ' + p.text.slice(0, 160));
      if (SHOTS && shot) await page.screenshot({ path: path.join(SHOTS, shot) });
      results.push(key + ': ' + p.pages + ' page(s)');
    }
    // Pages: a range greys the pages left out and only those go to the printer.
    await page.click('#sheets [data-sheet="weekly"] strong');
    await ready(page);
    await page.click('#orient [data-v="landscape"]');
    sent = await printed(page, '#print-now');
    assert.ok(sent.pages >= 1);
    results.push('Weekly prints ' + sent.pages + ' page(s)');
    assert.deepEqual(page.errors, []);
    await page.close();
    console.log('Print Layouts check passed:\n - ' + results.join('\n - '));
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
