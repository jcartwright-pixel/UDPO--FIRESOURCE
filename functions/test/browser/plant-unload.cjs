'use strict';
/*
 * Browser check of Unloading & Washing, Product Returns and Truck Washing against the local test database
 * (npm run test:browser), on the made-up plant day (test/fixtures/plant-demo.js): Thursday's trailers back.
 * A plant employee starts, counts and ends an unload, puts returns back in the cooler (RTA), washes trailers and
 * fixes a trailer number; a second open screen follows each change without reloading. Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const DATE = PD.PLANT_DATE;
const WORKER = '&testEmail=viewer.test@uniteddairy.com', MANAGER = '&testEmail=manager.test@uniteddairy.com';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: SHOTS && width === 1920 ? 2 : 1 });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    const file = route.request().url().split('/').pop();
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, file)) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const row = (route) => 'tr[data-key="' + DATE + '|' + route + '|UT DSD MILK"]';
async function fits(page, what) {
  const size = await page.evaluate(() => ({ scroll: document.scrollingElement.scrollHeight, inner: window.innerHeight, width: document.scrollingElement.scrollWidth, innerWidth: window.innerWidth }));
  assert.ok(size.scroll <= size.inner && size.width <= size.innerWidth, what + ' fits with no page scrolling: ' + JSON.stringify(size));
}
async function shots(page, name, w) {
  if (!SHOTS) return;
  await page.screenshot({ path: path.join(SHOTS, name + '-' + w + '.png'), scale: 'css' });
  if (w === 1920) await page.screenshot({ path: path.join(SHOTS, name + '-top-2x.png'), clip: { x: 0, y: 0, width: 1920, height: 475 }, scale: 'device' });
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1920, 950], [1366, 650]]) {
      const page = await openPage(browser, w, h, '/unloading.html?date=' + DATE + WORKER);
      await page.waitForSelector(row('805'));
      const keys = await page.$$eval('#rows tr[data-key]', trs => trs.map(t => t.dataset.key.split('|')[1]));
      assert.equal(keys[0], '805', 'the load being unloaded is on top');
      assert.equal(keys.length, 10, 'Needs Unloading: 12 case trailers back, 802 and 6303 already unloaded');
      assert.match(await page.textContent('#banner'), /Product returns need attention · 2 loads/);
      // Joe 10/18: no "Next:" line under the trailer and only the route in the Route · Run cell (no run line under it).
      assert.doesNotMatch(await page.textContent(row('808')), /Next:/, 'no "Next:" line under the trailer');
      assert.equal(await page.textContent(row('808') + ' td.rr'), '808', 'the Route · Run cell shows only the route');
      assert.equal(await page.textContent(row('808') + ' td.trlcell'), 'T-953', 'the trailer cell shows only the trailer');
      await fits(page, 'Unloading & Washing ' + w + 'x' + h);
      await shots(page, 'unloading', w);
      await page.click('[data-tab="all"]');
      await page.waitForSelector(row('802'));
      assert.match(await page.textContent(row('802') + ' td:nth-child(9)'), /Wash/, 'T-951 asked for a wash: 802 (unloaded) shows the Wash button');
      await fits(page, 'Unloading & Washing (All Loads) ' + w + 'x' + h);
      assert.deepEqual(page.errors, []);
      await page.close();
    }

    // Review items 23 and 27 (Joe 10/13): on a phone and an 800 tablet each load is a card with every box named; nothing is cut
    // (count tiles, switches, department tiles, the trailer), nothing slides sideways, and there is no side-menu strip.
    for (const [w, h] of [[390, 844], [800, 1280]]) {
      const page = await openPage(browser, w, h, '/unloading.html?date=' + DATE + WORKER);
      await page.waitForSelector(row('808'));
      const look = await page.evaluate(() => {
        const cut = (el) => el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().right > window.innerWidth + 1;
        const tr = document.querySelector('#rows tr[data-key*="|808|"]');
        return {
          card: getComputedStyle(tr).display,
          labels: [...tr.children].map(td => getComputedStyle(td, '::before')).filter(b => b.display !== 'none' && b.content !== 'none' && b.content !== 'normal').map(b => b.content),
          next: cut(tr.querySelector('td.trlcell .trl')),
          stats: [...document.querySelectorAll('#hstats span')].filter(cut).map(s => s.textContent),
          switches: [...document.querySelectorAll('[data-mode], [data-tab]')].filter(cut).map(b => b.textContent),
          tiles: [...document.querySelectorAll('#areas .area')].filter(cut).map(a => a.textContent.slice(0, 12)),
          sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
          menu: !!document.querySelector('.sidemenu') && getComputedStyle(document.querySelector('.sidemenu')).display !== 'none'
        };
      });
      assert.equal(look.card, 'grid', 'a load is a card at ' + w);
      assert.deepEqual(look.labels, ['"Trailer"', '"Status"', '"Cases Out"', '"Driver Said"', '"Cases Returned"', '"Lost"', '"RTA"', '"Washed"', '"Start / End"', '"Total Time"'], 'every box is named on the card at ' + w);
      assert.deepEqual([look.next, look.stats, look.switches, look.tiles, look.sideways, look.menu], [false, [], [], [], false, false], 'nothing cut, no sideways scroll, no side-menu strip at ' + w + ' ' + JSON.stringify(look));
      await shots(page, 'unloading-cards', w);
      assert.deepEqual(page.errors, []);
      await page.close();
    }
    results.push('Unloading & Washing at 390 and 800: each load is a card with every box named; tiles, switches and trailer not cut; no side-menu strip');

    // Two open screens: the dock works the list, the manager's screen follows.
    const watcher = await openPage(browser, 1920, 950, '/unloading.html?date=' + DATE + MANAGER);
    const dock = await openPage(browser, 1920, 950, '/unloading.html?date=' + DATE + WORKER);
    await watcher.waitForSelector(row('805'));
    await dock.waitForSelector(row('811') + ' button.clock');
    await dock.click(row('811') + ' button.clock');
    await dock.waitForFunction(() => /Stop unloading 805/.test(document.getElementById('error').textContent));
    results.push('Start on 811 while 805 is unloading: "Stop unloading 805 · UT DSD MILK before starting another."');
    await dock.click(row('805') + ' button.clock.end');
    await dock.waitForFunction(() => /Enter the quantity before ending/.test(document.getElementById('error').textContent));
    await dock.fill(row('805') + ' input[data-f="casesIn"]', '25');
    const t0 = Date.now();
    await dock.click(row('805') + ' button.clock.end');
    await watcher.waitForFunction(k => !document.querySelector('tr[data-key="' + k + '"]'), DATE + '|805|UT DSD MILK', { timeout: 8000 }).catch(async e => {
      console.error('DEBUG', await dock.textContent('#error'), await dock.innerHTML(row('805')).catch(() => 'gone'), await watcher.innerHTML(row('805')).catch(() => 'gone'));
      throw e;
    });
    results.push('805: 25 cases typed, End pressed; it left the other screen\'s Needs Unloading list in ' + (Date.now() - t0) + ' ms');
    // The End is two saves (the count, then the end); Start 811 only once this screen too has 805 off its list, or the
    // one-at-a-time rule rightly refuses it. Then this screen shows 811 unloading at once and the other screen follows.
    await dock.waitForFunction(k => !document.querySelector('tr[data-key="' + k + '"]'), DATE + '|805|UT DSD MILK', { timeout: 8000 });
    await dock.click(row('811') + ' button.clock');
    await dock.waitForSelector(row('811') + '.loading', { timeout: 8000 });
    await watcher.waitForSelector(row('811') + '.loading', { timeout: 8000 }).catch(async e => {
      console.error('DEBUG3', await dock.textContent('#error'), await dock.innerHTML(row('811')).catch(() => 'gone'), await watcher.innerHTML(row('811')).catch(() => 'gone'));
      throw e;
    });

    // Edit: trailer back typed as 977 is stored as T-977.
    await dock.click(row('811') + ' button.edit-row');
    await dock.fill('#rows [data-e="trailer"]', '977');
    if (SHOTS) await dock.screenshot({ path: path.join(SHOTS, 'unloading-edit-1920.png'), scale: 'css' });
    // Review item 38 (Joe 10/13): no Save button on the edit line; leaving the box saves it.
    assert.equal(await dock.$('#rows [data-do="editsave"]'), null, 'no Save button on the edit line');
    await dock.press('#rows [data-e="trailer"]', 'Tab');
    await watcher.waitForFunction(() => /T-977/.test(document.querySelector('tr[data-key$="|811|UT DSD MILK"]').textContent), null, { timeout: 8000 }).catch(async e => {
      console.error('DEBUG2', await dock.textContent('#error'), await dock.innerHTML(row('811')).catch(() => 'gone'), await watcher.innerHTML(row('811')).catch(() => 'gone'));
      throw e;
    });
    await dock.click('#rows [data-do="editclose"]');
    await dock.waitForFunction(() => !document.querySelector('#rows tr.editrow'));
    results.push('811 trailer back typed 977 and the box left (no Save button): the other screen shows T-977');

    // RTA on 811 (the driver's check-in return); the banner drops to the one left (805, now on All Loads).
    await dock.click(row('811') + ' button.rta');
    await watcher.waitForFunction(() => /· 1 load(?!s)/.test(document.getElementById('banner').textContent), null, { timeout: 8000 });
    await watcher.waitForFunction(k => /Returned/.test(document.querySelector('tr[data-key="' + k + '"]').textContent), DATE + '|811|UT DSD MILK', { timeout: 8000 });
    results.push('RTA on 811: the other screen shows Returned and the banner counts 1 load');

    // Wash on 802 (T-951): Washed on the other screen.
    await dock.click('[data-tab="all"]');
    await watcher.click('[data-tab="all"]');
    await dock.click(row('802') + ' button.wash');
    await watcher.waitForFunction(k => /Washed/.test(document.querySelector('tr[data-key="' + k + '"] td:nth-child(9)').textContent), DATE + '|802|UT DSD MILK', { timeout: 8000 });
    results.push('Wash on 802: T-951 shows Washed on the other screen');
    assert.deepEqual(dock.errors, []);
    assert.deepEqual(watcher.errors, []);
    await watcher.close(); await dock.close();

    // Joe 10/12: 808's driver checked in "Cases Delivered 659, Cases Returned 566" (empty cases) and refused nothing: not a return.
    {
      const snap = (await db().collection('runs').where('weekStart', '==', '2026-10-04').get()).docs.find(d => d.data().route === '808');
      await snap.ref.update({ 'days.thu.casesDelivered': 659, 'days.thu.driverCaseReturn': 566, 'days.thu.checkinCompletedAt': '2026-10-08T17:40:00Z' });
    }
    // Product Returns: 811's check-in refusal (RTA'd above), 805's dock return still pending, and 802's refusal called in by
    // email (REFUSALS / RETURNS LIVE, no RTA here). 811's 4 cases back are empty cases, so no cases count.
    for (const [w, h] of [[1920, 950], [1536, 730], [1366, 650]]) {
      const page = await openPage(browser, w, h, '/returns.html?date=' + DATE + WORKER);
      await page.waitForFunction(() => document.querySelectorAll('#rows tr[data-ret]').length === 3 && /Pending/.test(document.getElementById('rows').textContent));
      assert.match(await page.textContent('#hstats'), /3Returns3Cases2Refused2Pending/);
      const text = await page.textContent('#rows');
      assert.match(text, /Driver call-in.*3 cases chocolate refused/s);
      assert.doesNotMatch(text, /808|566/, 'empty cases brought back are not a product return');
      assert.equal(await page.$$eval('#rows tr', trs => trs.filter(t => /Driver call-in/.test(t.textContent) && t.querySelector('button.rta')).length), 0, 'a call-in has no RTA here');
      await fits(page, 'Product Returns ' + w + 'x' + h);
      await shots(page, 'returns', w);
      // Press a return: its whole write-up opens in the same window, and Close puts it away.
      await page.click('#rows tr[data-ret^="CHECKIN|"] td.detail');
      await page.waitForSelector('#rt-modal:not([hidden])');
      const box = await page.textContent('#rt-modal');
      assert.match(box, /Driver check-in/);
      assert.match(box, /2 gallons 2% refused/);
      assert.match(box, /StoreKroger Uniontown/);
      assert.match(box, /Empty cases brought back4 \(empty cases, not product\)/);
      assert.match(box, /Trailer.*T-/s);
      await shots(page, 'returns-details', w);
      await page.click('#rt-close');
      assert.ok(await page.isHidden('#rt-modal'));
      await page.click('#rows tr[data-ret^="QUEUE|"] button.see');
      await page.waitForSelector('#rt-modal:not([hidden])');
      assert.match(await page.textContent('#rt-modal'), /call-in email.*3 cases chocolate refused.*Pending until it is closed on that sheet/s);
      await shots(page, 'returns-details-callin', w);
      await page.keyboard.press('Escape');
      assert.ok(await page.isHidden('#rt-modal'));
      if (w === 1366) {
        await page.click('button.rta');
        await page.waitForFunction(() => /1Pending/.test(document.getElementById('hstats').textContent), null, { timeout: 8000 });
        results.push('Product Returns: RTA on 805 leaves only the call-in pending');
      }
      assert.deepEqual(page.errors, []);
      await page.close();
    }

    // Review item 26 (Joe 10/13): on a phone "What came back" has its label above the words, which read across the card.
    {
      const page = await openPage(browser, 390, 844, '/returns.html?date=' + DATE + WORKER);
      await page.waitForSelector('#rows tr[data-ret^="CHECKIN|"] td.detail');
      const what = await page.$eval('#rows tr[data-ret^="CHECKIN|"] td.detail', td => {
        const b = getComputedStyle(td, '::before'), r = td.getBoundingClientRect(), words = document.createRange();
        words.selectNodeContents(td);
        return { label: b.content, column: getComputedStyle(td).flexDirection, align: getComputedStyle(td).textAlign, lines: Math.round(words.getBoundingClientRect().height / parseFloat(getComputedStyle(td).fontSize) / 1.2), width: r.width };
      });
      assert.equal(what.label, '"What came back"');
      assert.deepEqual([what.column, what.align], ['column', 'left'], 'the label sits above the words, which read left to right ' + JSON.stringify(what));
      assert.ok(what.lines <= 4, 'the words use the card\'s width (not five narrow lines) ' + JSON.stringify(what));
      await shots(page, 'returns-phone', 390);
      assert.deepEqual(page.errors, []);
      await page.close();
      results.push('Product Returns on a phone: "What came back" has its label above the words');
    }

    // + Add Return on the Plant Station tablet: a return nobody noted, on 811 (RedZone product, cases), then RTA.
    {
      const page = await openPage(browser, 1280, 800, '/returns.html?date=' + DATE + WORKER);
      await page.waitForFunction(() => /1Pending/.test(document.getElementById('hstats').textContent) && !document.getElementById('add-open').hidden);
      await page.click('#add-open');
      await page.waitForFunction(() => document.querySelectorAll('#add-product option').length > 10);
      const load = await page.$$eval('#add-load option', os => os.find(o => /^811 · UT DSD MILK/.test(o.textContent)).value);
      await page.selectOption('#add-load', load);
      const product = await page.$$eval('#add-product option', os => os[1].value);
      await page.selectOption('#add-product', product);
      await page.fill('#add-cases', '4');
      await shots(page, 'returns-add-tablet', 1280);
      await page.click('#add-save');
      await page.waitForFunction(() => /4Returns7Cases2Refused2Pending/.test(document.getElementById('hstats').textContent), null, { timeout: 8000 });
      assert.match(await page.textContent('#rows'), /Added at plant/);
      // The counts come from the live update, which can land before the save call returns and closes the form.
      assert.ok(await page.waitForFunction(() => document.getElementById('add-bar').hidden, null, { timeout: 8000 }).then(() => true, () => false), 'the form closes once the return is added');
      await fits(page, 'Product Returns with + Add Return 1280x800');
      await shots(page, 'returns-added-tablet', 1280);
      await page.click('button.rta');
      await page.waitForFunction(() => /1Pending/.test(document.getElementById('hstats').textContent), null, { timeout: 8000 });
      results.push('Product Returns: + Add Return records a return nobody noted on 811 (4 cases), and RTA clears it');
      assert.deepEqual(page.errors, []);
      await page.close();
    }

    // Truck Washing: T-960 asked for a wash and T-993 was unloaded (T-951 is washed). + Add Wash T-960.
    for (const [w, h] of [[1920, 950], [1366, 650]]) {
      const page = await openPage(browser, w, h, '/washing.html?date=' + DATE + WORKER);
      await page.waitForFunction(() => document.querySelectorAll('#rows tr button.wash').length === 2);
      const units = await page.$$eval('#rows td.rr b', bs => bs.map(b => b.textContent).sort());
      assert.deepEqual(units, ['T-960', 'T-993']);
      assert.match(await page.textContent('#side'), /Washes this week2/);
      await fits(page, 'Truck Washing ' + w + 'x' + h);
      await shots(page, 'washing', w);
      if (w === 1366) {
        await page.click('#add-open');
        await page.fill('#add-trailer', '960');
        await page.click('#add-bar button.wash');
        await page.waitForFunction(() => document.querySelectorAll('#rows tr button.wash').length === 1 && /Washes this week3/.test(document.getElementById('side').textContent), null, { timeout: 8000 });
        results.push('Truck Washing: + Add Wash 960 cleared T-960\'s request; 3 washes this week');
      }
      assert.deepEqual(page.errors, []);
      await page.close();
    }
    const log = await db().collection('actions').where('action', 'in', ['saveUnloading', 'completeWash']).get();
    assert.ok(log.size >= 7, 'each press is one save in the save log');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('UNLOAD ' + r));
})().catch(e => { console.error(e); process.exit(1); });
