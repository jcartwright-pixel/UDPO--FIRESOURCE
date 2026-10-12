'use strict';
/*
 * Browser check of the Loadout Center loading order (npm run test:browser): on the made-up plant day, with the clock set
 * to that day, a plant employee moves loads with the up / down arrows beside the route (Joe 10/12: arrows, no grab dots), on a
 * desk and on a tablet, and another open screen follows. A day already past shows no arrows. Pictures go to SHOTS_DIR.
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
const NOON = new Date(DATE + 'T16:00:00Z');

async function openPage(browser, opts, url) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOON);
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    const file = route.request().url().split('/').pop();
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, file)) });
  });
  // The local server's clock is set to the same made-up day for each save (index.js reads testNow on the emulator only).
  await page.route(/127\.0\.0\.1:5001\/.*\/save$/, (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.continue();
    const body = JSON.parse(req.postData() || '{}');
    body.data = Object.assign({}, body.data, { testNow: NOON.toISOString() });
    route.continue({ postData: JSON.stringify(body) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const row = (route) => 'tr[data-row^="2026-10-04__run_p' + route + '|"]';
const routes = (page) => page.$$eval('#rows tr[data-row] td:first-child', tds => tds.map(td => td.textContent));
const waitOrder = (page, list) => page.waitForFunction(want => [...document.querySelectorAll('#rows tr[data-row] td:first-child')].map(td => td.textContent).slice(1, 1 + want.length).join(',') === want.join(','), list, { timeout: 8000 })
  .catch(async e => { throw new Error('Wanted ' + list.join(',') + ' but the screen shows ' + (await routes(page)).join(',') + ' / ' + (await page.textContent('#error').catch(() => ''))); });

// Presses a load's up or down arrow once and waits for the screen to show it one place earlier or later.
async function press(page, route, dir) {
  const before = await routes(page), i = before.indexOf(route);
  await page.click(row(route) + ' .lo-move.' + dir);
  await page.waitForFunction(([r, at]) => [...document.querySelectorAll('#rows tr[data-row] td:first-child')].map(td => td.textContent).indexOf(r) === at, [route, i + (dir === 'up' ? -1 : 1)], { timeout: 8000 })
    .catch(async e => { throw new Error(route + ' ' + dir + ': the screen shows ' + (await routes(page)).join(',') + ' / ' + (await page.textContent('#error').catch(() => ''))); });
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date(DATE + 'T14:00:00Z') });
  const browser = await chromium.launch();
  const results = [];
  try {
    const desk = { viewport: { width: 1920, height: 950 }, deviceScaleFactor: SHOTS ? 2 : 1 };
    const loader = await openPage(browser, desk, '/loadout.html?date=' + DATE + '&testEmail=viewer.test@uniteddairy.com');
    const watcher = await openPage(browser, desk, '/loadout.html?date=' + DATE + '&testEmail=manager.test@uniteddairy.com');
    await loader.waitForSelector(row('811') + ' .lo-move.down');
    assert.deepEqual((await routes(loader)).slice(0, 7), ['6303', '801', '802', '805', '808', '811', '812'], 'the route cell still reads as the route; the left-over load stays on top');
    assert.equal(await loader.$(row('6303') + ' .lo-move'), null, 'a prior-day load has no arrows');
    assert.equal(await loader.$('.lo-grip, [data-grip]'), null, 'Joe 10/12: no grab dots, only the up / down arrows');
    // Joe 10/12 (as Daily Dispatch): a load already loaded (801, 802, 805 are Done in the test sheet) has no arrows; 808,
    // still loading, is then the first that can move.
    for (const r of ['801', '802', '805']) {
      assert.equal(await loader.$eval(row(r), t => t.classList.contains('done')), true, r + ' starts Done in the test sheet');
      assert.equal(await loader.$(row(r) + ' .lo-move'), null, r + ' is already loaded, so it has no arrows');
    }
    assert.equal(await loader.isDisabled(row('808') + ' .lo-move.up'), true, 'the first load not yet loaded cannot go up');
    if (SHOTS) {
      await loader.screenshot({ path: path.join(SHOTS, '1-loadout-order-1920.png'), scale: 'css' });
      await loader.screenshot({ path: path.join(SHOTS, '2-loadout-order-top-2x.png'), clip: { x: 0, y: 0, width: 1920, height: 475 }, scale: 'device' });
    }

    // Down on 811 moves it one place later, the arrow stays selected, and the other open screen shows it.
    await press(loader, '811', 'down');
    await waitOrder(loader, ['801', '802', '805', '808', '812', '811']);
    await waitOrder(watcher, ['801', '802', '805', '808', '812', '811']);
    await loader.waitForFunction(() => document.activeElement && /run_p811/.test(document.activeElement.dataset.idMove || ''));
    results.push('Loaded loads (801, 802, 805) show no arrows; 808 is the first that can move');
    results.push('Down arrow on 811 moved it after 812 and kept the arrow selected; the other open screen shows it');

    // Up three times on 815: before 808.
    for (let i = 0; i < 3; i++) await press(loader, '815', 'up');
    await waitOrder(loader, ['801', '802', '805', '815', '808', '812', '811']);
    await waitOrder(watcher, ['801', '802', '805', '815', '808', '812', '811']);
    results.push('Up arrow three times: 815 before 808');

    const run = async (r) => (await db().collection('runs').doc('2026-10-04__run_p' + r).get()).data().days.fri.loadSequenceOverride;
    assert.deepEqual(await Promise.all(['815', '808', '812', '811'].map(run)), [40, 50, 60, 70], 'saved as the day\'s load_sequence_override with the numbers the loads had');

    // A finger on a tablet: 6302 up as far as it goes, right after the loaded 805.
    const tablet = await openPage(browser, { viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: false }, '/loadout.html?date=' + DATE + '&testEmail=viewer.test@uniteddairy.com');
    await tablet.waitForSelector(row('6302') + ' .lo-move.up');
    await waitOrder(tablet, ['801', '802', '805', '815', '808', '812', '811']);
    while (!(await tablet.isDisabled(row('6302') + ' .lo-move.up'))) await press(tablet, '6302', 'up');
    await waitOrder(tablet, ['801', '802', '805', '6302', '815']);
    await waitOrder(watcher, ['801', '802', '805', '6302', '815']);
    results.push('Up arrow on a 1280 tablet: 6302 moved up to the first open place, right after the loaded 805');
    if (SHOTS) await tablet.screenshot({ path: path.join(SHOTS, '4-loadout-order-tablet-1280.png') });

    // Skip: 812 waits at the bottom with no arrows; Down on 808 steps over it.
    await tablet.click(row('812') + ' button.skip');
    await tablet.waitForSelector(row('812') + '.skipped');
    assert.equal(await tablet.$(row('812') + ' .lo-move'), null, 'a skipped load has no arrows');
    assert.ok(await tablet.$$eval('.clock-cell', cs => cs.every(c => c.parentElement.scrollWidth <= c.parentElement.clientWidth + 1)), 'Start and Skip fit their cell with the arrows shown');
    await press(tablet, '808', 'down');
    await waitOrder(tablet, ['801', '802', '805', '6302', '815', '811', '808']);
    assert.equal(await tablet.$eval('#rows tr[data-row]:last-child', t => t.dataset.row.split('|')[0]), '2026-10-04__run_p812', 'the skipped load stays at the bottom');
    results.push('Skip with the arrows: 812 waits at the bottom without arrows; 808 moved down past 811');
    if (SHOTS) await tablet.screenshot({ path: path.join(SHOTS, '5-loadout-order-skip-tablet-1280.png') });


    // The arrows are on every loadout (Case, Totes, Boxes, Tanker) at 1536 and 1920: visible, inside the Route column, before
    // the route number, with no grab dots. Today and the coming days have them; a past day does not.
    for (const [w, h] of [[1920, 1000], [1536, 760]]) {
      const pg = await openPage(browser, { viewport: { width: w, height: h } }, '/loadout.html?date=' + DATE + '&testEmail=viewer.test@uniteddairy.com');
      for (const a of ['CASE', 'TOTES', 'BOXING', 'TANKER']) {
        await pg.click('[data-area="' + a + '"]');
        await pg.waitForFunction(x => document.querySelector('[data-area="' + x + '"]').classList.contains('on') && document.querySelector('#rows .lo-move'), a);
        const cells = await pg.$$eval('#rows tr[data-row] .lo-order', g => g.map(x => { const r = x.getBoundingClientRect(), td = x.closest('td').getBoundingClientRect(), up = x.querySelector('.lo-move.up').getBoundingClientRect(), num = x.querySelector('.lo-num').getBoundingClientRect();
          return { route: x.textContent, seen: up.width > 0 && up.height > 0, inside: r.left >= td.left - 1 && r.right <= td.right + 1, before: up.right <= num.left + 1, dots: !!x.closest('tr').querySelector('.lo-grip') };
        }));
        assert.ok(cells.length >= 1 && cells.every(g => g.seen && g.inside && g.before && !g.dots), a + ' at ' + w + ': every load today has its arrows before its route ' + JSON.stringify(cells));
        if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, '6-loadout-arrows-' + a.toLowerCase() + '-' + w + '.png') });
      }
      assert.deepEqual(pg.errors, []);
      await pg.context().close();
    }
    results.push('Up / down arrows on Case, Totes, Boxes and Tanker at 1536 and 1920, inside the Route column before the route number, no grab dots');
    // Joe 10/12 ("mobile looks wrong and I can't edit"): on a phone each load is a card with its boxes named, big enough to type in,
    // the page scrolls as a whole (no strip a few rows high) and nothing slides sideways.
    const phone = await openPage(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, '/loadout.html?date=' + DATE + '&testEmail=viewer.test@uniteddairy.com');
    await phone.waitForSelector(row('811') + ' .lo-move.down');
    const card = await phone.$eval(row('811'), tr => {
      const box = tr.getBoundingClientRect(), input = tr.querySelector('input[data-k="truck"]').getBoundingClientRect();
      return { display: getComputedStyle(tr).display, width: box.width, height: box.height, input: input.height, label: getComputedStyle(tr.querySelector('input[data-k="truck"]').closest('td'), '::before').content };
    });
    assert.equal(card.display, 'grid', 'a load is a card on a phone ' + JSON.stringify(card));
    assert.ok(card.input >= 44 && card.label === '"Truck"', 'the truck box is named and big enough for a thumb ' + JSON.stringify(card));
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'nothing slides sideways on a phone');
    assert.ok(await phone.evaluate(() => document.scrollingElement.scrollHeight > window.innerHeight * 2), 'the whole page scrolls through the loads');
    if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, '7-loadout-phone-390.png'), fullPage: true });
    assert.deepEqual(phone.errors, []);
    await phone.context().close();
    results.push('Phone: each load is a card with named boxes big enough to type in; the page scrolls, nothing slides sideways');
    // A day already past has no arrows (a coming day's own loads get them by the same rule as today's, and the server takes a
    // coming day's order: test/emulator/plant-order.test.js).
    await loader.click('#prev');
    await loader.waitForFunction(() => document.querySelector('#load-date').value === '2026-10-07');
    await loader.waitForTimeout(300);
    assert.equal(await loader.$('.lo-move'), null, 'a past day shows no arrows');
    // Joe 10/12: the day picked stays picked after leaving and coming back (Go to today shows), and a move into another week
    // asks first: Cancel stays, Continue moves.
    assert.equal(await loader.isVisible('#go-today'), true, 'Go to today shows on a day that is not today');
    await loader.goto(HOSTING + '/loadout.html?testEmail=viewer.test@uniteddairy.com');
    await loader.waitForFunction(() => document.querySelector('#load-date').value === '2026-10-07');
    for (const d of ['2026-10-08', '2026-10-09', '2026-10-10']) { await loader.click('#next'); await loader.waitForFunction(x => document.querySelector('#load-date').value === x, d); }
    assert.equal(await loader.isVisible('#week-panel'), false, 'no warning inside the week');
    await loader.click('#next');
    await loader.waitForSelector('#week-panel:not([hidden])');
    assert.match(await loader.textContent('#week-text'), /week beginning 10-4-26 to the week beginning 10-11-26/);
    await loader.click('#week-panel [data-close]');
    assert.equal(await loader.inputValue('#load-date'), '2026-10-10', 'Cancel keeps the day');
    await loader.click('#next');
    await loader.click('#week-go');
    await loader.waitForFunction(() => document.querySelector('#load-date').value === '2026-10-11');
    await loader.click('#go-today');
    await loader.click('#week-go');
    await loader.waitForFunction(() => document.querySelector('#load-date').value === '2026-10-08');
    assert.equal(await loader.isVisible('#go-today'), false, 'no Go to today on today');
    results.push('The Loadout Day picked stays picked after coming back; a move into another week asks first (Cancel stays, Continue moves)');
    for (const p of [loader, watcher, tablet]) assert.deepEqual(p.errors, []);
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ORDER ' + r));
})().catch(e => { console.error(e); process.exit(1); });
