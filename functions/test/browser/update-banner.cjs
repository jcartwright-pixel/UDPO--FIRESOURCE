'use strict';
/*
 * Browser check of the Update ready banner (Joe 10/15: "Anytime we do an update and somebody has not refreshed ... a banner").
 * A screen opened on one version, with a newer one published, shows a yellow line under the header with a big Refresh button,
 * on the desk (1536, Joe's screen), a tablet (800) and a phone (390). Nothing reloads by itself: what is typed stays until
 * Refresh is pressed, and Refresh reloads the screen. The same version, or a local copy with no commit, shows nothing.
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
const SHOTS = process.env.SHOTS_DIR;
const ADMIN = 'testEmail=admin.test@uniteddairy.com';

async function openPage(browser, width, height, url, version) {
  // No offline helper (sw.js) in this check, so every version.json read reaches the route below.
  const page = await (await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' })).newPage();
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  // The published version, as the deploy writes it (tools/stamp-version.cjs); the check changes it to a newer one.
  page.published = version;
  await page.route(/\/version\.json$/, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(page.published) }));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name) }); };
const V1 = { label: 'Version 6.16 · 10-15-26', release: '6.16', date: '10-15-26', copy: 'Live', commit: '1111111' };
const V2 = { label: 'Version 6.17 · 10-15-26', release: '6.17', date: '10-15-26', copy: 'Live', commit: '2222222' };

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h, url, ready, name] of [
      [1536, 864, '/index.html?' + ADMIN, '#screen:not([hidden]) .topbar .brand', 'home-1536'],
      [1536, 864, '/administration.html?' + ADMIN, '.adm-item', 'administration-1536'],
      [800, 1280, '/index.html?' + ADMIN, '#screen:not([hidden]) .topbar .brand', 'home-tablet-800'],
      [390, 844, '/route.html', '.phone-top', 'route-phone-390']
    ]) {
      const p = await openPage(browser, w, h, url, V1);
      await p.waitForSelector(ready);
      await p.evaluate(() => window.UD_checkForUpdate());
      assert.equal(await p.$('#update-ready'), null, name + ': the same version shows no banner');
      await shot(p, 'update-before-' + name + '.png');

      // A newer version is published while the screen is open: the banner shows under the header, and nothing reloads.
      await p.evaluate(() => { window.udStillHere = 1; });
      p.published = V2;
      await p.evaluate(() => window.UD_checkForUpdate());
      await p.waitForSelector('#update-ready button#update-refresh', { timeout: 5000 }).catch(async e => { throw new Error(name + ': no banner (' + await p.evaluate(async () => JSON.stringify(await fetch('version.json', { cache: 'no-store' }).then(r => r.json()))) + ')'); });
      const look = await p.$eval('#update-ready', el => {
        const head = document.querySelector('.topbar, .phone-top'), r = el.getBoundingClientRect(), b = el.querySelector('button').getBoundingClientRect();
        return { text: el.textContent, under: !head || Math.abs(head.getBoundingClientRect().bottom - r.top) <= 2, font: parseFloat(getComputedStyle(el).fontSize),
          button: b.height, onScreen: r.top >= 0 && r.bottom <= innerHeight, wide: document.scrollingElement.scrollWidth <= innerWidth };
      });
      assert.match(look.text, /Update ready/);
      assert.match(look.text, /Refresh/);
      assert.ok(look.under, name + ': the banner sits right under the header');
      assert.ok(look.font >= 16, name + ': banner text is 16px or bigger');
      assert.ok(look.button >= 44, name + ': the Refresh button is big enough to tap');
      assert.ok(look.onScreen, name + ': the banner is on screen');
      assert.ok(look.wide, name + ': no sideways scrolling');
      await p.waitForTimeout(500);
      assert.equal(await p.evaluate(() => window.udStillHere), 1, name + ': the screen did not reload by itself');
      await shot(p, 'update-after-' + name + '.png');

      // A second check does not add a second banner.
      await p.evaluate(() => window.UD_checkForUpdate());
      assert.equal((await p.$$('#update-ready')).length, 1);

      // Refresh reloads the screen, which then opens on the new version with no banner.
      await Promise.all([p.waitForEvent('load'), p.click('#update-refresh')]);
      await p.waitForSelector(ready);
      assert.equal(await p.evaluate(() => window.udStillHere), undefined, name + ': Refresh reloaded the screen');
      await p.evaluate(() => window.UD_checkForUpdate());
      assert.equal(await p.$('#update-ready'), null, name + ': after Refresh the screen is on the new version');
      assert.deepEqual(p.errors, []);
      await p.close();
      results.push(name + ': a newer version shows "Update ready" under the header with a Refresh button; it reloads only when pressed');
    }

    // Joe 10/22: "in the upper banner is where I want the version and the last time it was updated." Every screen's header
    // shows the version and when it was put up, in white 16px words, wholly on screen and clear of the header's buttons.
    const V3 = { ...V1, banner: 'Version 6.48 · Updated 10-22-26 1:30 PM' };
    for (const [w, h, url, ready] of [
      [1920, 1080, '/daily.html?' + ADMIN, '#screen:not([hidden]) .topbar .brand'], [1536, 790, '/daily.html?' + ADMIN, '#screen:not([hidden]) .topbar .brand'],
      [1536, 790, '/index.html?' + ADMIN, '#screen:not([hidden]) .topbar .brand'], [1536, 790, '/administration.html?' + ADMIN, '.adm-item'],
      [1024, 768, '/weekly.html?' + ADMIN, '#screen:not([hidden]) .topbar .brand'], [800, 1280, '/index.html?' + ADMIN, '#screen:not([hidden]) .topbar .brand'],
      [390, 844, '/drivers.html?' + ADMIN, '#screen:not([hidden]) .topbar .brand'], [390, 844, '/route.html', '.phone-top'],
      [1024, 768, '/route.html', '.phone-top']
    ]) {
      // Joe 10/31: "Do not put the date that the app was updated ... All I need to know is the last time it refreshed ...
      // Phone apps." The phone and tablet apps, and any screen on a phone, show only "Last refreshed <date time>".
      const phone = w <= 700 || /route/.test(url);
      const p = await openPage(browser, w, h, url, V3);
      await p.waitForSelector(ready);
      await p.waitForFunction(() => [...document.querySelectorAll('.hdr-version')].some(e => e.offsetWidth && /Updated/.test(e.textContent)));
      const name = url.split(/[/.]/)[1] + ' ' + w;
      const look = await p.evaluate(() => {
        const el = [...document.querySelectorAll('.hdr-version')].find(e => e.offsetWidth), head = el.parentNode, r = el.getBoundingClientRect();
        const hit = [...head.children].filter(c => c !== el && c.offsetWidth).filter(c => { const o = c.getBoundingClientRect(); return o.left < r.right - 1 && o.right > r.left + 1 && o.top < r.bottom - 1 && o.bottom > r.top + 1; });
        const seen = [el, ...el.querySelectorAll('*')].filter(e => e.offsetWidth && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
        return { text: seen.map(e => [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('')).join(' ').replace(/\s+/g, ' ').trim(), fonts: [el, ...el.children].map(e => parseFloat(getComputedStyle(e).fontSize)), color: getComputedStyle(el).color,
          inHead: r.top >= head.getBoundingClientRect().top - 1 && r.bottom <= head.getBoundingClientRect().bottom + 1, onScreen: r.left >= 0 && r.right <= innerWidth + 1,
          hit: hit.map(c => c.id || c.className), count: document.querySelectorAll('.hdr-version').length, wide: document.scrollingElement.scrollWidth <= innerWidth + 1 };
      });
      if (phone) {
        assert.match(look.text, /^Last refreshed \d{1,2}-\d{1,2}-\d\d \d{1,2}:\d\d [AP]M$/, name + ': a phone shows only when the screen last refreshed (' + look.text + ')');
        // A fresh answer from the server moves the time on.
        await p.evaluate(() => { window.UDReads.freshAt = Date.now() + 3 * 60000; window.dispatchEvent(new CustomEvent('ud-refreshed')); });
        const later = await p.evaluate(() => [...document.querySelectorAll('.hdr-version .hv-fresh')].find(e => e.offsetWidth).textContent);
        assert.notEqual(later, look.text, name + ': the time moves when the screen refreshes');
      } else assert.equal(look.text, 'Version 6.48 Updated 10-22-26 1:30 PM', name + ': the header names the version and when it was updated');
      assert.ok(look.fonts.every(f => f >= 16), name + ': 16px words ' + look.fonts);
      assert.equal(look.color, 'rgb(255, 255, 255)', name + ': white on the blue header');
      assert.ok(look.inHead && look.onScreen, name + ': inside the header and on screen');
      assert.deepEqual(look.hit, [], name + ': clear of the header buttons');
      assert.ok(look.wide, name + ': no sideways scrolling');
      await shot(p, 'header-version-' + name.replace(' ', '-') + '.png');
      assert.deepEqual(p.errors, []);
      await p.close();
    }
    // The line at the bottom of the menu stays as it was.
    const m = await openPage(browser, 1536, 790, '/daily.html?' + ADMIN, V3);
    await m.waitForFunction(() => /Version 6\.16/.test((document.querySelector('.sidemenu .side-version') || {}).textContent || ''));
    await m.close();
    results.push('header: desk screens show "Version 6.48 · Updated 10-22-26 1:30 PM" in the top banner at 1920, 1536, 1024 and 800; phones (390) and the phone and tablet apps show only "Last refreshed"; the menu line stays');

    // Typing is never interrupted: the banner shows while a box has text in it, the box keeps its text and focus.
    const t = await openPage(browser, 1536, 864, '/administration.html?' + ADMIN, V1);
    await t.waitForSelector('.adm-item');
    await t.evaluate(() => { const i = document.createElement('input'); i.id = 'typing-check'; document.querySelector('.topbar').after(i); });
    await t.fill('#typing-check', 'half typed');
    await t.focus('#typing-check');
    t.published = V2;
    await t.evaluate(() => window.UD_checkForUpdate());
    await t.waitForSelector('#update-ready');
    assert.equal(await t.$eval('#typing-check', i => i.value + '|' + (document.activeElement === i)), 'half typed|true');
    await t.close();
    results.push('typing: the banner leaves the box being typed in alone (text and cursor stay)');

    // A local copy has no commit: no banner, whatever is published.
    const l = await openPage(browser, 1536, 864, '/index.html?' + ADMIN, { label: 'Test copy on this computer', commit: '' });
    await l.waitForSelector('#screen:not([hidden]) .topbar .brand');
    l.published = V2;
    await l.evaluate(() => window.UD_checkForUpdate());
    assert.equal(await l.$('#update-ready'), null);
    await l.close();
    results.push('a local copy (no commit) never shows the banner');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok - ' + r));
})().catch(err => { console.error(err); process.exit(1); });
