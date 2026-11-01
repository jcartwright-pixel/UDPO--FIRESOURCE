'use strict';
/*
 * Joe 11/1 (mock-up 1, "jd"): the Administration menu is regrouped into eight groups (nothing removed). Each group is a red
 * bar that folds open and shut, one open at a time; its items are blue, the open item solid blue. "Hide menu" folds the whole
 * menu to a thin strip ("Show menu") so the item gets the full width, and this computer remembers it. Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;
const ADMIN = 'testEmail=admin.test@uniteddairy.com';
const GROUPS = ['People & Access', 'Links & Codes', 'Email & Texts', 'Dispatch & Fleet', 'Plant Setup', 'Products & Machines', 'Plant Maintenance Setup', 'Checks & Repairs'];

async function openPage(context, url) {
  const page = await context.newPage();
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  await localCalls(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const shot = async (p, name) => { if (SHOTS) { await p.waitForTimeout(600); await p.screenshot({ path: path.join(SHOTS, name) }); } };
const openGroups = (p) => p.$$eval('.adm-nav-group', g => g.filter(x => x.querySelector('.adm-items:not([hidden])')).map(x => x.querySelector('.adm-gh').dataset.group));
const color = (p, sel, prop) => p.$eval(sel, (e, k) => getComputedStyle(e)[k], prop);

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1536, 790], [1920, 1080]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block' });
      const p = await openPage(ctx, '/administration.html?' + ADMIN);
      await p.waitForSelector('.adm-item.on[data-key="people"]');
      assert.deepEqual(await p.$$eval('.adm-gh', b => b.map(x => x.textContent)), GROUPS);
      // Only the open item's group is open; the whole menu fits without scrolling.
      assert.deepEqual(await openGroups(p), ['People & Access']);
      assert.equal(await p.$eval('#nav', n => n.scrollHeight <= n.clientHeight + 1), true, 'the folded menu fits at ' + w);
      // Red group bars with white words; blue items; the open item solid blue. Every word 16px or more.
      assert.equal(await color(p, '.adm-gh', 'backgroundColor'), 'rgb(200, 16, 46)');
      assert.equal(await color(p, '.adm-gh', 'color'), 'rgb(255, 255, 255)');
      assert.equal(await color(p, '.adm-item:not(.on)', 'color'), 'rgb(21, 101, 192)');
      assert.equal(await color(p, '.adm-item.on', 'backgroundColor'), 'rgb(21, 101, 192)');
      assert.equal(await p.$$eval('.adm-nav .adm-gh, .adm-nav .adm-item, #hide-menu', e => e.every(x => parseFloat(getComputedStyle(x).fontSize) >= 16)), true);
      await shot(p, 'after-1-people-' + w + '.png');
      // Pressing another bar opens it and closes the other; pressing it again closes it.
      await p.click('.adm-gh[data-group="Email & Texts"]');
      assert.deepEqual(await openGroups(p), ['Email & Texts']);
      await p.click('.adm-item[data-key="sales-email"]');
      await p.waitForSelector('.adm-item.on[data-key="sales-email"]');
      assert.match(await p.textContent('.adm-panel-head small'), /^Email & Texts/);
      await shot(p, 'after-2-email-open-' + w + '.png');
      await p.click('.adm-gh[data-group="Email & Texts"]');
      assert.deepEqual(await openGroups(p), []);
      // Find a setting opens every group with a match.
      await p.fill('#find', 'key');
      assert.ok((await openGroups(p)).includes('Products & Machines'));
      await p.fill('#find', '');
      // Hide menu: the item gets the full width; Show menu brings it back. Remembered after a reload.
      const before = await p.$eval('#panel', x => x.getBoundingClientRect().width);
      await p.click('#hide-menu');
      const after = await p.$eval('#panel', x => x.getBoundingClientRect().width);
      assert.ok(after > before + 200, 'the item is wider with the menu hidden: ' + before + ' -> ' + after);
      assert.equal(await p.isVisible('#show-menu'), true);
      assert.equal(await p.isVisible('#find'), false);
      await shot(p, 'after-3-menu-hidden-' + w + '.png');
      await p.reload();
      await p.waitForSelector('#show-menu', { state: 'visible' });
      await p.click('#show-menu');
      await p.waitForSelector('#find', { state: 'visible' });
      assert.equal(await p.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(p.errors, []);
      await ctx.close();
    }
    results.push('Administration: eight red group bars (white words), one open at a time, blue items with the open one solid blue; the folded menu fits at 1536x790 and 1920; Find a setting opens the groups it matches; Hide menu gives the item the full width, Show menu brings it back and the choice is remembered');

    // A phone or narrow window: the menu sits above the item and still folds.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const s = await openPage(ctx, '/administration.html?' + ADMIN);
    await s.waitForSelector('.adm-item.on[data-key="people"]');
    assert.equal(await s.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), true);
    await s.click('#hide-menu');
    assert.equal(await s.isVisible('#show-menu'), true);
    await shot(s, 'after-4-phone-hidden-390.png');
    assert.deepEqual(s.errors, []);
    await ctx.close();
    results.push('Administration at 390: no side scroll; Hide menu and Show menu work');
  } finally {
    await browser.close();
  }
  for (const r of results) console.log('ok - ' + r);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
