'use strict';
/*
 * Browser check of Case Unloading's + Add a Trailer and yesterday's trailers (Joe 10/27, hd mock-up 2: "there may be trailers
 * here that wasn't unloaded the day before. Or we might need more. So we need to add add a unload or we can wash it"):
 *   - a load from yesterday nobody pressed End on comes over to today by itself, at the top, in red ("From 10-7"), with a
 *     banner on the office screen and "1 trailer from yesterday" on the tablet; Take Off the List takes it off;
 *   - the tablet's "A trailer that is not on the list" box: UNLOAD IT puts the trailer at the top, marked Added;
 *   - the office's + Add a Trailer: Unload it (Start, like any load) or Wash only (a Wash button and no Start; done once washed).
 * With SHOTS_DIR=<folder> it also saves pictures.
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
const MANAGER = 'testEmail=manager.test@uniteddairy.com';
const NOW = '2026-10-08T14:00:00Z';

async function openPage(browser, width, height, url, touch) {
  const page = await browser.newPage(Object.assign(touch ? { viewport: { width, height }, hasTouch: true, isMobile: true } : { viewport: { width, height } }, { serviceWorkers: 'block' }));
  await page.clock.setFixedTime(new Date(NOW));
  await localCalls(page);
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date(NOW) });
  const d = db();
  // Route 850 delivered yesterday (Wednesday 10-7) on T-888 and nobody pressed End on it.
  const base = (await d.collection('runs').doc('2026-10-04__run_p801').get()).data();
  await d.collection('runs').doc('2026-10-04__run_p850').set(Object.assign({}, base, { route: '850', run: 'UT DSD MILK', routeId: 'rte_p850', runId: 'run_p850',
    days: { wed: Object.assign({}, base.days.thu, { trailer: 'T-888', casesOut: 600 }) } }));

  const browser = await chromium.launch();
  const results = [];
  try {
    // The tablet: yesterday's trailer first, in red; a trailer typed in the box goes on the list.
    const t = await openPage(browser, 1024, 768, '/plant-station.html?' + MANAGER + '&station=CASE_UNLOADING', true);
    // Joe 10/27: the Case Unloading tablet opens on the choice of Case Unloading or Trailer Assignments.
    await t.click('[data-part="unload"]');
    await t.waitForSelector('#work .sw-card.prior', { timeout: 15000 });
    // Joe 10/27: the trailers today's loadout needs come first, in loading order; T-888 is not needed today, so it leads the rest.
    const first = await t.$eval('#work .sw-card.prior', c => ({ prior: c.classList.contains('prior'), trailer: (c.querySelector('.sw-trailer') || {}).textContent || '', chips: c.querySelector('.sw-chips').textContent }));
    assert.ok(first.prior, 'yesterday\'s trailer is on the list');
    assert.equal(first.trailer, 'T-888');
    assert.match(first.chips, /From 10-7 · not unloaded/);
    assert.match(await t.textContent('#work .sw-panel-head span'), /1 trailer from yesterday/);
    // Read the tag's color in one step once it is drawn and styled (a tag caught mid-redraw is detached and has no style).
    const red = await (await t.waitForFunction(() => { const i = document.querySelector('#work .sw-card.prior .sw-chips i.from'); return i && i.isConnected && getComputedStyle(i).color ? getComputedStyle(i).color : null; }, null, { timeout: 8000 })).jsonValue();
    assert.equal(red, 'rgb(180, 35, 24)', 'red');
    await t.fill('[data-form="unl"] input[data-k="trailer"]', '640');
    await t.click('[data-form="unl"] button[data-kind="UNLOAD"]');
    await t.waitForFunction(() => [...document.querySelectorAll('#work .sw-card[data-sw]')].some(c => /ADDED\|640$/.test(c.dataset.sw) && /Added/.test(c.textContent)));
    const keys = await t.$$eval('#work .sw-card[data-sw]', cs => cs.map(c => c.dataset.sw));
    const i850 = keys.findIndex(k => /850/.test(k));
    assert.ok(i850 >= 0 && /ADDED\|640$/.test(keys[i850 + 1]), 'yesterday\'s trailer, then the one just added, ahead of the rest not needed today: ' + keys.join(', '));
    assert.ok(await t.$('#work .sw-card[data-sw$="ADDED|640"] .sw-quick [data-act="ustart"]'), 'an added trailer to unload has Start Unloading');
    if (SHOTS) await t.screenshot({ path: path.join(SHOTS, 'tablet-1024.png') });
    assert.deepEqual(t.errors, []);
    results.push('tablet: T-888 from 10-7 in red, T-640 added under it');
    await t.close();

    // The office: the banner, + Add a Trailer (Unload it / Wash only), Wash, and Take Off the List.
    const o = await openPage(browser, 1536, 790, '/unloading.html?' + MANAGER + '&area=CASE&date=2026-10-08');
    await o.waitForSelector('#rows tr.prior', { timeout: 15000 });
    assert.match(await o.textContent('#banner'), /1 trailer from yesterday was not unloaded/);
    assert.match(await o.textContent('#rows tr.prior td.rr'), /^850From 10-7$/);
    await o.click('#add-open');
    await o.fill('#add-trailer', 'T-902');
    await o.click('#add-save');
    assert.match(await o.textContent('#error'), /Pick what the trailer needs/);
    assert.equal(await o.$eval('#add-kind', s => s.value), '', 'What it needs starts blank');
    await o.selectOption('#add-kind', 'WASH');
    await o.click('#add-save');
    assert.ok(await o.$eval('#addbox', b => b.hidden), 'the box closes once added');
    await o.waitForSelector('#rows tr[data-key$="ADDED|902"]');
    const wash = await o.$('#rows tr[data-key$="ADDED|902"]');
    assert.match(await wash.$eval('td.rr', c => c.textContent), /Wash only/);
    assert.ok(await wash.$('button[data-do="wash"]'), 'a wash-only trailer has a Wash button');
    assert.equal(await wash.$('button[data-do="start"]'), null, 'and no Start');
    const order = await o.$$eval('#rows tr[data-key]', rs => rs.map(r => r.dataset.key));
    const o850 = order.findIndex(k => /850/.test(k));
    assert.ok(o850 >= 0 && order.slice(o850 + 1, o850 + 3).some(k => /ADDED\|640$/.test(k)) && order.slice(o850 + 1, o850 + 3).some(k => /ADDED\|902$/.test(k)), 'yesterday\'s, then the added trailers: ' + order.join(', '));
    if (SHOTS) {
      await o.click('#add-open');
      await o.screenshot({ path: path.join(SHOTS, 'office-1536.png') });
      await o.click('#add-cancel');
      for (const [w, h] of [[1366, 768], [1920, 950], [390, 844]]) {
        const x = await openPage(browser, w, h, '/unloading.html?' + MANAGER + '&area=CASE&date=2026-10-08', w < 500);
        await x.waitForSelector('#rows tr[data-key$="ADDED|902"]', { timeout: 15000 });
        await x.click('#add-open');
        await x.screenshot({ path: path.join(SHOTS, 'office-' + w + '.png'), fullPage: w < 500 });
        assert.ok(await x.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no page scroll sideways at ' + w);
        await x.close();
      }
    }
    await o.click('#rows tr[data-key$="ADDED|902"] button[data-do="wash"]');
    await o.waitForSelector('#rows tr[data-key$="ADDED|902"]', { state: 'detached' });
    await o.click('[data-tab="all"]');
    await o.waitForFunction(() => /Done/.test((document.querySelector('#rows tr[data-key$="ADDED|902"]') || {}).textContent || ''));
    await o.click('[data-tab="needs"]');
    // Yesterday's trailer was in fact unloaded: Edit > Take Off the List.
    await o.click('#rows tr.prior button[data-do="edit"]');
    await o.click('#rows button[data-do="drop"]');
    await o.waitForSelector('#rows tr.prior', { state: 'detached' });
    await o.waitForFunction(() => !/from yesterday/.test(document.getElementById('banner').textContent));
    await o.reload();
    await o.waitForSelector('#rows tr[data-key]', { timeout: 15000 });
    assert.equal(await o.$('#rows tr.prior'), null, 'still off the list after a refresh');
    assert.deepEqual(o.errors, []);
    results.push('office: banner, T-902 wash only (Wash, no Start) then done, T-888 taken off the list');
    await o.close();
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('UNLOAD ADD ' + r));
})().catch(e => { console.error(e); process.exit(1); });
