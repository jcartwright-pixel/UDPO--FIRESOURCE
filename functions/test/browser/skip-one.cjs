'use strict';
/*
 * Browser check of Skip (Joe 10/16: "whenever they hit skip, it only can move down one position every time they hit skip", and
 * "that also has to be noted, just like we did manually moving the sequence, that it was moved, and then who did it"). On the
 * made-up plant day: the Plant Station's Case tablet and the Daily Case Loadout at desk sizes. Each Skip moves the load down
 * one place (past the next load still to load) and saves the loading order every screen follows; the load is marked SKIPPED
 * with who pressed it; the last load to load has no Skip. With SHOTS_DIR=<folder> it saves pictures.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const DATE = PD.PLANT_DATE;
const NOON = new Date(DATE + 'T16:00:00Z');
const MANAGER = 'testEmail=manager.test@uniteddairy.com';

async function openPage(browser, opts, url) {
  const page = await browser.newPage(Object.assign({ serviceWorkers: 'block' }, opts));
  await page.clock.setFixedTime(NOON);
  await localCalls(page);
  // The local server's clock is set to the same made-up day for each save (index.js reads testNow on the emulator only).
  await page.route(/127\.0\.0\.1:5001\/.*\/save$/, (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fallback();
    const body = JSON.parse(req.postData() || '{}');
    body.data = Object.assign({}, body.data, { testNow: NOON.toISOString() });
    route.fallback({ postData: JSON.stringify(body) });
  });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, r.request().url().split('/').pop())) }));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const fresh = async () => { await clear(); await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date(DATE + 'T14:00:00Z') }); };
const day = async (r) => (await db().collection('runs').doc('2026-10-04__run_p' + r).get()).data().days.fri;
const card = (r) => '#work .sw-card[data-sw="2026-10-04__run_p' + r + '|fri"]';
const cards = (page) => page.$$eval('#work .sw-card[data-sw]', c => c.map(x => x.dataset.sw.replace(/^2026-10-04__run_p|\|.*$/g, '')));
const row = (r) => 'tr[data-row^="2026-10-04__run_p' + r + '|"]';
const rows = (page) => page.$$eval('#rows tr[data-row]', t => t.map(x => x.children[0].textContent));
const after = (list, a, b) => list.indexOf(a) === list.indexOf(b) + 1;

(async () => {
  const browser = await chromium.launch();
  const results = [];
  try {
    // The Plant Station's Case tablet at each phone and tablet size: 811 (waiting, next after the loading 808) is skipped
    // twice; each press moves it one place.
    for (const [w, h] of [[1024, 768], [800, 1280], [600, 960], [412, 915], [390, 844]]) {
      await fresh();
      const t = await openPage(browser, { viewport: { width: w, height: h }, hasTouch: true, isMobile: true }, '/plant-station.html?' + MANAGER + '&station=CASE');
      await t.waitForSelector(card('811') + ' [data-act="skip"]');
      const start = await cards(t);
      assert.ok(after(start, '812', '811'), 'the made-up day starts 811, 812 ' + start);
      if (SHOTS && w === 1024) { await t.$eval(card('811'), el => el.scrollIntoView({ block: 'center' })); await t.screenshot({ path: path.join(SHOTS, 'station-before-skip-1024.png') }); }
      await t.click(card('811') + ' [data-act="skip"]');
      await t.waitForFunction(() => { const c = [...document.querySelectorAll('#work .sw-card[data-sw]')].map(x => x.dataset.sw.replace(/^2026-10-04__run_p|\|.*$/g, '')); return c.indexOf('811') === c.indexOf('812') + 1; }, null, { timeout: 8000 });
      await t.waitForFunction(s => / by \S/.test((document.querySelector(s + ' .sw-flag.skip') || {}).title || ''), card('811'), { timeout: 8000 });
      const flag = await t.$eval(card('811') + ' .sw-flag.skip', f => ({ text: f.textContent, size: parseFloat(getComputedStyle(f).fontSize), title: f.title, bg: getComputedStyle(f).backgroundColor, fits: f.getBoundingClientRect().right <= window.innerWidth }));
      // Joe 10/19: the same green one-word tag as the Daily Loadout; who pressed it shows on hover.
      assert.ok(flag.text === 'SKIPPED' && flag.bg === 'rgb(46, 125, 67)' && flag.size >= 16 && flag.fits && /Skipped down one place by .*Case Loadout tablet/.test(flag.title), 'a green SKIPPED flag, who on hover, 16px, on screen ' + JSON.stringify(flag));
      assert.ok(await t.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1), 'nothing slides sideways at ' + w);
      if (SHOTS && w === 1024) { await t.$eval(card('811'), el => el.scrollIntoView({ block: 'center' })); await t.screenshot({ path: path.join(SHOTS, 'station-after-skip-1024.png') }); }
      if (SHOTS && w === 390) { await t.$eval(card('811'), el => el.scrollIntoView({ block: 'center' })); await t.screenshot({ path: path.join(SHOTS, 'station-after-skip-phone-390.png') }); }
      if (w === 1024) {
        const m = (await day('811')).moveMark;
        assert.equal(m.how, 'SKIP');
        assert.equal(m.via, 'TABLET');
        assert.equal(m.by, 'manager.test@uniteddairy.com');
        assert.ok(m.station && m.savedAt, 'the station and the time are kept ' + JSON.stringify(m));
        assert.ok((await day('811')).loadSequenceOverride > (await day('812')).loadSequenceOverride, 'saved as the loading order (load_sequence_override)');
        // A second press: one more place (past 815).
        await t.click(card('811') + ' [data-act="skip"]');
        await t.waitForFunction(() => { const c = [...document.querySelectorAll('#work .sw-card[data-sw]')].map(x => x.dataset.sw.replace(/^2026-10-04__run_p|\|.*$/g, '')); return c.indexOf('811') === c.indexOf('815') + 1; }, null, { timeout: 8000 });
        // The last load to load has no Skip: it stays where it is.
        const last = (await cards(t)).filter(r => /^[0-9_]+$/.test(r)).pop();
        assert.equal(await t.$(card(last) + ' [data-act="skip"]'), null, 'the last load (' + last + ') has no SKIP');
        results.push('Plant Station Case tablet: each SKIP moved 811 down one place (past 812, then past 815), saved as the loading order, marked SKIPPED (who and the tablet on hover); the last load has no SKIP');
      }
      assert.deepEqual(t.errors, []);
      await t.close();
    }
    results.push('Plant Station Case tablet at 1024, 800, 600, 412 and 390: the SKIPPED flag is 16px and on screen; nothing slides sideways');

    // Daily Case Loadout at Joe's 1536 and at 1920: Skip on 811 moves it one place; the other open screen follows; the tag says
    // SKIPPED on one line, who on hover (Joe 10/19).
    for (const [w, h] of [[1920, 1000], [1536, 760]]) {
      await fresh();
      const p = await openPage(browser, { viewport: { width: w, height: h } }, '/loadout.html?date=' + DATE + '&' + MANAGER);
      const other = await openPage(browser, { viewport: { width: 1280, height: 800 } }, '/loadout.html?date=' + DATE + '&testEmail=viewer.test@uniteddairy.com');
      await p.waitForSelector(row('811') + ' button.skip');
      await other.waitForSelector(row('811'));
      const high = await p.$eval(row('811'), tr => tr.getBoundingClientRect().height);
      await p.click(row('811') + ' button.skip');
      await p.waitForFunction(() => { const r = [...document.querySelectorAll('#rows tr[data-row] td:first-child')].map(td => td.textContent); return r.indexOf('811') === r.indexOf('812') + 1; }, null, { timeout: 8000 });
      await other.waitForFunction(() => { const r = [...document.querySelectorAll('#rows tr[data-row] td:first-child')].map(td => td.textContent); return r.indexOf('811') === r.indexOf('812') + 1; }, null, { timeout: 8000 });
      await p.waitForFunction(s => / by \S/.test((document.querySelector(s + ' .moved-tag') || {}).title || ''), row('811'), { timeout: 8000 });
      const tag = await p.$eval(row('811') + ' .moved-tag', t => ({ text: t.textContent, title: t.title, size: parseFloat(getComputedStyle(t).fontSize) }));
      assert.ok(tag.text === 'SKIPPED' && /^Skipped down one place by Test M.* at /.test(tag.title) && tag.size >= 16, 'SKIPPED, the full name and time on hover ' + JSON.stringify(tag));
      assert.ok(await p.$eval(row('811'), (tr, hi) => tr.getBoundingClientRect().height <= hi + 1, high), 'the line stays one line high at ' + w);
      assert.ok(await other.$(row('811') + ' .moved-tag'), 'the other open screen marks it too');
      const list = await rows(p), last = list[list.length - 1];
      assert.equal(await p.$(row(last) + ' button.skip'), null, 'the last load to load has no Skip');
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'loadout-after-skip-' + w + '.png') });
      assert.deepEqual(p.errors, []);
      await p.close();
      await other.close();
    }
    // The Daily Case Loadout on a tablet and a phone (each load a card): Skip moves 811 one place too, the tag on screen.
    for (const [w, h] of [[1024, 768], [800, 1280], [600, 960], [412, 915], [390, 844]]) {
      await fresh();
      const p = await openPage(browser, { viewport: { width: w, height: h }, hasTouch: true, isMobile: w < 800 }, '/loadout.html?date=' + DATE + '&' + MANAGER);
      await p.waitForSelector(row('811') + ' button.skip');
      await p.click(row('811') + ' button.skip');
      await p.waitForFunction(() => { const r = [...document.querySelectorAll('#rows tr[data-row] td:first-child')].map(td => td.textContent); return r.indexOf('811') === r.indexOf('812') + 1; }, null, { timeout: 8000 });
      await p.waitForFunction(s => /^SKIPPED$/.test((document.querySelector(s + ' .moved-tag') || {}).textContent || ''), row('811'), { timeout: 8000 });
      const tag = await p.$eval(row('811') + ' .moved-tag', t => ({ size: parseFloat(getComputedStyle(t).fontSize), right: t.getBoundingClientRect().right, w: window.innerWidth }));
      assert.ok(tag.size >= 16 && tag.right <= tag.w, 'the SKIPPED tag is 16px and on screen at ' + w + ' ' + JSON.stringify(tag));
      assert.ok(await p.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1), 'nothing slides sideways at ' + w);
      if (SHOTS && (w === 800 || w === 390)) { await p.$eval(row('811'), el => el.scrollIntoView({ block: 'center' })); await p.screenshot({ path: path.join(SHOTS, 'loadout-after-skip-' + w + '.png') }); }
      assert.deepEqual(p.errors, []);
      await p.close();
    }
    results.push('Daily Case Loadout at 1024, 800, 600, 412 and 390: Skip moved 811 down one place; the SKIPPED tag is 16px and on screen');
    results.push('Daily Case Loadout at 1920 and 1536: Skip moved 811 down one place on both open screens, tagged "SKIPPED" on one line (who and when on hover); the last load has no Skip');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('SKIP ' + r));
})().catch(e => { console.error(e); process.exit(1); });
