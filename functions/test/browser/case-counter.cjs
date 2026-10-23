'use strict';
/*
 * Browser check of the case counters (Joe 10/22, the case counter hookup guide; Joe 10/23: "the cases need to be put in prior
 * to loading. And then the case counter counts and does a comparison"), on the made-up plant day:
 *   - Daily Case Loadout: with the Palletizer counter set up, a Counted column beside Cases Out: the load loading counts up
 *     ("486 of 612 · counting"), a done load matches (green) or is short / over (red); the top line has the counted total,
 *     the loads that match and the loads that are off. Totes has no Counted column. Fits at 1536, 1920, the 1280 tablet and phones.
 *   - Unloading & Washing: with the Case Returns counter set up, the same beside Cases In.
 *   - Administration > Case Counters: both counters, the boxes, Test read and the counter key.
 * Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');
const RD = require('../../src/reader');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const DATE = PD.PLANT_DATE;
const NOON = new Date(DATE + 'T16:00:00Z');
const tick = () => NOON;
const MANAGER = 'testEmail=manager.test@uniteddairy.com', ADMIN = 'testEmail=admin.test@uniteddairy.com';
let n = 0;

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, timezoneId: 'America/New_York' });
  await localCalls(page);
  await page.clock.setFixedTime(NOON);
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
async function shot(page, name) {
  if (!SHOTS) return;
  await page.waitForSelector('#screen:not([hidden])');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}
async function fits(page, what) {
  const size = await page.evaluate(() => ({ scroll: document.scrollingElement.scrollWidth, inner: window.innerWidth }));
  assert.ok(size.scroll <= size.inner, what + ' has no sideways scrolling: ' + JSON.stringify(size));
}
async function bigText(page, sel, what) {
  const small = await page.$$eval(sel, els => els.flatMap(e => [e, ...e.querySelectorAll('*')]).filter(e => e.offsetParent && [...e.childNodes].some(x => x.nodeType === 3 && x.textContent.trim()))
    .map(e => [e.tagName + '.' + e.className, parseFloat(getComputedStyle(e).fontSize)]).filter(x => x[1] < 16));
  assert.deepEqual(small, [], what + ': text 16px or larger');
}
// Every Counted cell shows its whole wording (Joe: nothing cut off).
async function whole(page, what) {
  const cut = await page.$$eval('td.lo-counted', tds => tds.filter(td => td.offsetParent && [...td.children].some(c => c.scrollWidth > td.clientWidth + 1)).map(td => td.textContent));
  assert.deepEqual(cut, [], what + ': every Counted cell shows whole');
}
const admin = (fields) => RD.readerAll(db(), { email: 'admin.test@uniteddairy.com' }, fields, { now: tick, key: () => 'key-' + fields.counter });
const send = (key, device, count) => RD.handleReads(db(), { authorization: 'Bearer ' + key }, { device, controller: { count } }, { now: tick });
async function setUp(id) {
  const { key } = await admin({ counter: id, op: 'makeKey' });
  for (const [field, value] of [['brand', 'MODBUS'], ['ip', '192.168.1.40'], ['countTag', '40001']]) await admin({ counter: id, op: 'saveCounter', field, value });
  return key;
}
// The cell's look (run, ok, bad, plain or none) and its words.
const kindOf = (td) => [['run', 'ok', 'bad', 'plain'].find(k => td.classList.contains(k)) || '', td.textContent];
const cell = (page, route) => page.$eval('#rows tr[data-row^="' + (route === '6303' ? '2026-10-04__run_p6303|thu' : '2026-10-04__run_p' + route + '|fri') + '"] td.lo-counted', kindOf);

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  const browser = await chromium.launch();
  const results = [];
  try {
    // Before the counter is set up: no Counted column.
    const plain = await openPage(browser, 1280, 800, '/loadout.html?date=' + DATE + '&area=CASE&' + MANAGER);
    await plain.waitForSelector('#rows tr[data-row]');
    // Found on the way (Joe 10/23 "fix any of the bugs you found"): "Completed" on the P/U button was cut off on the 1280 tablet.
    const cutPu = (p) => p.$$eval('#rows button.pu', bs => bs.filter(b => b.scrollWidth > b.clientWidth + 1 || b.getBoundingClientRect().right > b.parentElement.getBoundingClientRect().right + 1).map(b => b.textContent));
    assert.deepEqual(await cutPu(plain), [], 'every P/U button shows whole at 1280');
    assert.doesNotMatch(await plain.textContent('#head-row'), /Counted/, 'no Counted column until a counter is set up');
    await plain.close();

    // The Palletizer counter: Cases Out typed before loading (808 612, 811 604), the counter counting on 808.
    const key = await setUp('palletizer');
    for (const [route, qty] of [['808', '612'], ['811', '604']]) {
      await applyAction(db(), { email: 'dispatch.test@uniteddairy.com' }, { action: 'savePlantLoad', requestId: 'case-counter-' + (++n) + '-' + Date.now(), runDocId: '2026-10-04__run_p' + route, day: 'fri', fields: { quantity: qty } }, tick);
    }
    await send(key, 'palletizer', 90000);
    await send(key, 'palletizer', 90486);
    // Two loads done before the counter came on line, as the counter would have left them: 801 matches, 802 is 12 short.
    for (const [route, counted] of [['801', 612], ['802', 576]]) {
      await db().collection('caseCounts').doc('LOAD_2026-10-04__run_p' + route + '_fri').set({ kind: 'LOAD', counterId: 'palletizer', date: DATE, runDocId: '2026-10-04__run_p' + route, day: 'fri', route, run: 'UT DSD MILK', counted, lastAt: '2026-10-08T06:00:00Z' });
    }
    for (const [w, h] of [[1536, 790], [1920, 1080]]) {
      const lo = await openPage(browser, w, h, '/loadout.html?date=' + DATE + '&area=CASE&' + MANAGER);
      await lo.waitForFunction(() => /Counted/.test(document.getElementById('head-row').textContent) && document.querySelector('#rows td.lo-counted.run'));
      assert.deepEqual(await lo.$$eval('#head-row th', t => t.map(x => x.textContent).slice(4, 8)), ['Trailer', 'Cases Out', 'Counted', 'Depart']);
      assert.deepEqual(await cell(lo, '808'), ['run', '486 of 612counting']);
      assert.deepEqual(await cell(lo, '801'), ['ok', '612matches']);
      assert.deepEqual(await cell(lo, '802'), ['bad', '576short 12']);
      assert.deepEqual(await cell(lo, '805'), ['', ''], 'a load done with no count shows nothing');
      assert.deepEqual(await cell(lo, '811'), ['', ''], 'a load waiting shows nothing');
      assert.deepEqual(await cell(lo, '6303'), ['run', '0counting'], 'the load left over from yesterday, still loading, no Cases Out typed');
      assert.match(await lo.textContent('#strip'), /Counted 1,674 · matches 1/);
      assert.match(await lo.textContent('#strip'), /Off 1 load/);
      assert.doesNotMatch(await lo.textContent('#strip'), /not sending/);
      assert.equal(await lo.inputValue('#rows tr[data-row^="2026-10-04__run_p808|fri"] input[data-k="quantity"]'), '612', 'Cases Out stays what was typed');
      await fits(lo, 'Daily Case Loadout at ' + w);
      await bigText(lo, '#rows td.lo-counted, #strip', 'the Counted column and the top line');
      await whole(lo, 'Daily Case Loadout at ' + w);
      await shot(lo, 'after-case-loadout-' + w);
      assert.deepEqual(lo.errors, []);
      // Totes: no counter there.
      if (w === 1536) {
        await lo.goto(HOSTING + '/loadout.html?date=' + DATE + '&area=TOTES&' + MANAGER);
        await lo.waitForSelector('#rows tr[data-row]');
        assert.doesNotMatch(await lo.textContent('#head-row'), /Counted/);
        assert.doesNotMatch(await lo.textContent('#strip'), /Counted/);
      }
      await lo.close();
    }
    // The Plant Station tablet and a phone.
    for (const [w, h, name] of [[1280, 800, 'tablet-1280'], [390, 844, 'phone-390']]) {
      const lo = await openPage(browser, w, h, '/loadout.html?date=' + DATE + '&area=CASE&' + MANAGER);
      await lo.waitForSelector('#rows td.lo-counted.run');
      await fits(lo, 'Daily Case Loadout at ' + w);
      await whole(lo, 'Daily Case Loadout at ' + w);
      if (w === 1280) assert.deepEqual(await cutPu(lo), [], 'every P/U button shows whole at 1280 with the Counted column');
      if (w === 390) assert.equal(await lo.$eval('#rows tr[data-row^="2026-10-04__run_p802|fri"] td.lo-counted', td => td.dataset.l), 'Counted', 'the phone card names the box');
      await shot(lo, 'after-case-loadout-' + name);
      assert.deepEqual(lo.errors, []);
      await lo.close();
    }
    results.push('Daily Case Loadout: Counted beside Cases Out (486 of 612 counting, 612 matches, 576 short 12 in red); Counted 1,674 · matches 1 and Off 1 load on the top line; Cases Out stays typed; none on Totes; fits 1536, 1920, 1280 and 390');

    // A counter that stops sending while a load is loading: red on the top line.
    await db().collection('caseCounters').doc('palletizer').set({ heardAt: '2026-10-08T15:50:00Z' }, { merge: true });
    {
      const lo = await openPage(browser, 1536, 790, '/loadout.html?date=' + DATE + '&area=CASE&' + MANAGER);
      await lo.waitForFunction(() => /Case counter not sending/.test(document.getElementById('strip').textContent));
      await lo.close();
    }
    results.push('Case counter not sending shows red when the plant PC has been quiet 2 minutes while a load is loading');

    // Unloading & Washing: the Case Returns counter on 805's trailer (being unloaded); 802 was unloaded with 12 typed and counted.
    const rkey = await setUp('case_returns');
    await send(rkey, 'case_returns', 500);
    await send(rkey, 'case_returns', 523);
    await db().collection('caseCounts').doc('UNLOAD_802').set({ kind: 'UNLOAD', counterId: 'case_returns', date: DATE, unloadKey: DATE + '|802|UT DSD MILK', route: '802', run: 'UT DSD MILK', counted: 12 });
    for (const [w, h] of [[1536, 790], [1920, 1080], [390, 844]]) {
      const un = await openPage(browser, w, h, '/unloading.html?date=' + DATE + '&' + MANAGER);
      await un.waitForSelector('#rows td.lo-counted.run');
      if (w !== 390) assert.equal(await un.isVisible('#counted-head'), true);
      const row = (k) => un.$eval('#rows tr[data-key="' + DATE + '|' + k + '|UT DSD MILK"] td.lo-counted', kindOf);
      assert.deepEqual(await row('805'), ['run', '23counting']);
      if (w === 1536) {
        await un.click('[data-tab="all"]');
        await un.waitForSelector('#rows td.lo-counted.ok');
        assert.deepEqual(await row('802'), ['ok', '12matches']);
      }
      await fits(un, 'Unloading & Washing at ' + w);
      await whole(un, 'Unloading & Washing at ' + w);
      await bigText(un, '#rows td.lo-counted', 'the Counted column');
      await shot(un, 'after-unloading-' + w);
      assert.deepEqual(un.errors, []);
      await un.close();
    }
    results.push('Unloading & Washing: Counted beside Cases In (23 counting on the trailer being unloaded, 12 matches); fits 1536, 1920 and 390');

    // Administration > Case Counters.
    for (const [w, h] of [[1536, 790], [1920, 1080]]) {
      const ad = await openPage(browser, w, h, '/administration.html?item=case-counters&' + ADMIN);
      await ad.waitForSelector('[data-counter="case_returns"]');
      assert.deepEqual(await ad.$$eval('[data-counter] h3', t => t.map(x => x.textContent)), ['Palletizer', 'Case Returns']);
      assert.equal(await ad.inputValue('[data-counter="palletizer"] [data-f="ip"]'), '192.168.1.40');
      assert.match(await ad.textContent('[data-counter="palletizer"]'), /the case total read 90,486/);
      if (w === 1536) {
        await ad.fill('[data-counter="palletizer"] [data-f="port"]', '502');
        await ad.press('[data-counter="palletizer"] [data-f="port"]', 'Tab');
        await ad.waitForFunction(() => document.querySelector('[data-counter="palletizer"] [data-f="port"]') && document.querySelector('[data-counter="palletizer"] [data-f="port"]').value === '502' && !document.activeElement.matches('input'));
        await ad.click('[data-counter="palletizer"] [data-test]');
        await ad.waitForFunction(() => /Asking the plant PC/.test(document.querySelector('[data-counter="palletizer"]').textContent));
        await ad.click('[data-counter="palletizer"] [data-key]');
        await ad.waitForSelector('#cc-key-palletizer');
        assert.match(await ad.textContent('[data-counter="palletizer"]'), /--device palletizer --key \S+ --controller/);
      }
      await fits(ad, 'Case Counters at ' + w);
      await bigText(ad, '#cc-list', 'Case Counters');
      await shot(ad, 'after-case-counters-' + w);
      assert.deepEqual(ad.errors, []);
      await ad.close();
    }
    assert.equal(((await db().collection('caseCounters').doc('palletizer').get()).data().controller || {}).port, 502);
    results.push('Administration > Case Counters: both counters, each box saves as it is left, Test read asks the plant PC, a new counter key with the plant PC command');
  } finally {
    await browser.close();
  }
  console.log('Case counter browser check passed:\n- ' + results.join('\n- '));
})().catch(e => { console.error(e); process.exit(1); });
