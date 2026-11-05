'use strict';
/*
 * Pallet Builder (Joe 11-4-26: in Operations, not the hub): a manager opens it from Plant Distribution Departments in the menu,
 * the builder shows under the Operations header after sign-in, its saved routes stay after a reload, and it fits a phone.
 * Made-up people only. Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { clear, db } = require('../emulator/helpers');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';

async function openPage(ctx, url) {
  const page = await ctx.newPage();
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  await localCalls(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.errors = errors;
  await page.goto(HOSTING + url);
  return page;
}

(async () => {
  await clear();
  const { runTransfer } = require('../../src/transfer');
  const F = require('../fixtures/fake-sheets');
  const PD = require('../fixtures/plant-demo');
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  try {
    const ctx = await browser.newContext({ viewport: { width: 1536, height: 860 }, serviceWorkers: 'block' });
    // Joe 11-5-26: its own card on Home and its own menu option, right under Debag / Labeling Room.
    let p = await openPage(ctx, '/index.html?testEmail=manager.test@uniteddairy.com');
    await p.waitForSelector('#screen:not([hidden]) .hq-main[data-side="pallets"]');
    const lines = await p.$$eval('.hq-main', c => c.map(x => x.dataset.side));
    assert.equal(lines.indexOf('pallets'), lines.indexOf('debag') + 1, 'Home: right under Debag / Labeling Room ' + JSON.stringify(lines));
    assert.ok(!(await p.$eval('.hq-main[data-side="pallets"]', x => x.classList.contains('building'))), 'open to everyone, not Under Construction');
    const [deb, pal] = await Promise.all(['debag', 'pallets'].map(k => p.$eval('.hq-main[data-side="' + k + '"]', x => { const r = x.getBoundingClientRect(); return [r.left, r.top, r.bottom]; })));
    assert.ok(pal[1] >= deb[2] - 1 && Math.abs(pal[0] - deb[0]) <= 2, 'on its own line under Debag / Labeling Room ' + JSON.stringify([deb, pal]));
    await p.waitForTimeout(800);
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'pallet-builder-home-1536.png') });
    await p.close();
    p = await openPage(ctx, '/pallet-builder.html?testEmail=manager.test@uniteddairy.com');
    await p.waitForSelector('#screen:not([hidden]) #builder');
    const frame = () => p.frameLocator('#builder');
    await frame().locator('#dayTable tr').first().waitFor();
    assert.equal(await p.textContent('.head h1'), 'Pallet Builder');
    assert.ok(await p.isHidden('#signin'), 'signed in: no sign-in box');
    assert.ok(await frame().locator('h1').textContent().then(t => /Pallet Builder/.test(t)), 'the builder shows in the frame');
    const menu = await p.$$eval('a[href^="pallet-builder.html"]', as => as.length);
    assert.ok(menu >= 1, 'Pallet Builder is in the menu');
    await frame().locator('#loadSample').click();
    await frame().locator('#tiles .tile').first().waitFor();
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'pallet-builder-1536.png') });
    // Its saved routes stay in this browser after a reload.
    await frame().locator('#route').fill('Test route 1');
    await frame().locator('#route').dispatchEvent('input');
    await frame().locator('#route').dispatchEvent('change');
    await p.reload();
    await p.waitForSelector('#screen:not([hidden]) #builder');
    await frame().locator('#dayTable tr').first().waitFor();
    assert.ok(/Test route 1/.test(await frame().locator('#dayTable').textContent()), 'the route saved before the reload is there');
    assert.deepEqual(p.errors, []);
    await ctx.close();

    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    p = await openPage(phone, '/pallet-builder.html?testEmail=manager.test@uniteddairy.com');
    await p.waitForSelector('#screen:not([hidden]) #builder');
    await p.frameLocator('#builder').locator('#dayTable tr').first().waitFor();
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll on a phone');
    await p.waitForTimeout(500);
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'pallet-builder-390.png') });
    assert.deepEqual(p.errors, []);
    console.log('pallet builder browser test passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
