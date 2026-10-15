'use strict';
/*
 * Browser check of the Loadout Center loading order (npm run test:browser): on the made-up plant day, with the clock set
 * to that day, a plant employee drags loads up or down by their line (Joe 10/12: "grab the line with the hand and drag it", no
 * arrows, no grab dots) with a mouse, the keyboard and a finger on a tablet, and another open screen follows. A day already past
 * has nothing to drag. Pictures go to SHOTS_DIR.
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
const movedRoutes = (page) => page.$$eval('#rows tr.moved[data-row] td:first-child', tds => tds.map(td => td.textContent));
const routes = (page) => page.$$eval('#rows tr[data-row] td:first-child', tds => tds.map(td => td.textContent));
const waitOrder = (page, list) => page.waitForFunction(want => [...document.querySelectorAll('#rows tr[data-row] td:first-child')].map(td => td.textContent).slice(1, 1 + want.length).join(',') === want.join(','), list, { timeout: 8000 })
  .catch(async e => { throw new Error('Wanted ' + list.join(',') + ' but the screen shows ' + (await routes(page)).join(',') + ' / ' + (await page.textContent('#error').catch(() => ''))); });

// Where to let go: just above or just below the middle of another load's line.
async function spot(page, route, where, cell = 2) {
  // The list is drawn again when another screen's save lands: measure the line as it is now, again if it was just replaced.
  let b = null;
  for (let tries = 0; !b && tries < 10; tries++) {
    await page.locator(row(route)).scrollIntoViewIfNeeded().catch(() => {});
    b = await page.locator(row(route) + ' td:nth-child(' + cell + ')').boundingBox().catch(() => null);
    if (!b) await page.waitForTimeout(100);
  }
  if (!b) throw new Error('No line for ' + route + ': ' + (await routes(page)).join(','));
  return { x: b.x + b.width / 2, y: where === 'above' ? b.y + b.height * 0.25 : b.y + b.height * 0.75 };
}
// A mouse grabs a load's line (by its Run cell, or another cell: review item 59, the whole line) and lets go above or below
// another load.
async function mouseDrag(page, route, onto, where, picture, cell) {
  const from = await spot(page, route, 'mid', cell), to = await spot(page, onto, where);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x, from.y + (to.y - from.y) * i / 8);
  // The line lifted and the blue line where it will land, before letting go.
  if (SHOTS && picture) await page.screenshot({ path: path.join(SHOTS, picture), scale: 'css' });
  await page.mouse.up();
}
// A finger holds a load's line still for a moment (on its Run cell, or another cell), then slides it above or below another load.
async function touchDrag(page, route, onto, where, cell) {
  const from = await spot(page, route, 'mid', cell), to = await spot(page, onto, where), cdp = await page.context().newCDPSession(page);
  const at = (y) => [{ x: Math.round(from.x), y: Math.round(y) }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(from.y) });
  await page.waitForTimeout(500);
  for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(from.y + (to.y - from.y) * i / 10) }); await page.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
// Alt and the up or down arrow on a load's line (it has the keyboard focus) moves it one place.
async function keyMove(page, route, dir) {
  const before = await routes(page), i = before.indexOf(route);
  await page.focus(row(route));
  await page.keyboard.press(dir === 'up' ? 'Alt+ArrowUp' : 'Alt+ArrowDown');
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
    await loader.waitForSelector(row('811') + '[data-drag]');
    assert.deepEqual((await routes(loader)).slice(0, 7), ['6303', '801', '802', '805', '808', '811', '812'], 'the route cell reads as the route; the left-over load stays on top');
    assert.equal(await loader.$(row('6303') + '[data-drag]'), null, 'a prior-day load does not move');
    assert.equal(await loader.$('.lo-grip, [data-grip], .lo-move, [data-move]'), null, 'Joe 10/12: no grab dots and no arrows');
    assert.equal(await loader.$eval(row('811') + ' td:nth-child(2)', td => getComputedStyle(td).cursor), 'grab', 'the hand shows over a line that can be dragged');
    // Joe 10/12 (as Daily Dispatch): a load already loaded (801, 802, 805 are Done in the test sheet) does not move; 808,
    // still loading, is then the first that can.
    for (const r of ['801', '802', '805']) {
      assert.equal(await loader.$eval(row(r), t => t.classList.contains('done')), true, r + ' starts Done in the test sheet');
      assert.equal(await loader.$(row(r) + '[data-drag]'), null, r + ' is already loaded, so it does not move');
    }
    assert.equal(await loader.$eval('#rows tr[data-drag]', t => t.dataset.drag.split('|')[0]), '2026-10-04__run_p808', '808 is the first line that can be dragged');
    assert.deepEqual(await movedRoutes(loader), [], 'nothing is shaded as moved while the day follows the sheet\'s order');
    if (SHOTS) {
      await loader.screenshot({ path: path.join(SHOTS, '1-loadout-order-1920.png'), scale: 'css' });
      await loader.screenshot({ path: path.join(SHOTS, '2-loadout-order-top-2x.png'), clip: { x: 0, y: 0, width: 1920, height: 475 }, scale: 'device' });
    }

    // Review item 59 (Joe 10/13, "grab the whole line"): the hand shows over every cell that is not a box or button, and the
    // mouse drags 811 below 812 by its Driver cell (not Route or Run); no text is selected; the other open screen shows it.
    assert.deepEqual(await loader.$eval(row('811'), tr => [1, 3, 7, 10].map(i => getComputedStyle(tr.children[i - 1]).cursor)), ['grab', 'grab', 'grab', 'grab'], 'the hand shows over Route, Driver, Depart and Total Time');
    await mouseDrag(loader, '811', '812', 'below', '3-loadout-dragging-1920.png', 3);
    await waitOrder(loader, ['801', '802', '805', '808', '812', '811']);
    await waitOrder(watcher, ['801', '802', '805', '808', '812', '811']);
    assert.equal(await loader.evaluate(() => String(window.getSelection())), '', 'dragging a line by its words does not select them');
    // Joe 10/15: the load dragged out of the sheet's order (811, not 812 which it passed) is shaded light green with a MOVED tag,
    // on the other open screen too, and it looks different from a Done line.
    await loader.waitForFunction(() => [...document.querySelectorAll('#rows tr.moved td:first-child')].map(t => t.textContent).join() === '811');
    await watcher.waitForFunction(() => [...document.querySelectorAll('#rows tr.moved td:first-child')].map(t => t.textContent).join() === '811');
    const look = await loader.evaluate(() => {
      const bg = (sel) => getComputedStyle(document.querySelector(sel).children[1]).backgroundColor;
      const tag = document.querySelector('#rows tr.moved .moved-tag');
      return { moved: bg('#rows tr.moved'), done: bg('#rows tr.done:not(.moved)'), plain: bg('#rows tr[data-drag]:not(.moved):not(.done)'), tag: tag && tag.textContent, size: tag && parseFloat(getComputedStyle(tag).fontSize) };
    });
    assert.ok(look.moved !== look.done && look.moved !== look.plain && /^rgb\(\d+, \d+, \d+\)$/.test(look.moved), 'a moved line has its own green, not the Done one ' + JSON.stringify(look));
    assert.deepEqual([look.tag, look.size >= 16], ['MOVED', true], 'a MOVED tag at 16px or more ' + JSON.stringify(look));
    if (SHOTS) await loader.screenshot({ path: path.join(SHOTS, '3b-loadout-moved-1920.png'), scale: 'css' });
    results.push('Loaded loads (801, 802, 805) do not move; 808 is the first line that can be dragged; the hand shows over a line');
    results.push('Mouse: 811 dragged below 812 by its Driver cell (the whole line grabs); no text selected; the other open screen shows it');

    // The keyboard: Alt+Up three times on 815 puts it before 808, and its line keeps the focus.
    for (let i = 0; i < 3; i++) await keyMove(loader, '815', 'up');
    await waitOrder(loader, ['801', '802', '805', '815', '808', '812', '811']);
    await waitOrder(watcher, ['801', '802', '805', '815', '808', '812', '811']);
    await loader.waitForFunction(() => document.activeElement && /run_p815/.test(document.activeElement.dataset.drag || ''));
    assert.deepEqual((await movedRoutes(loader)).sort(), ['811', '815'], 'Joe 10/15: 815 is shaded as moved too; 808 and 812, which it passed, are not');
    results.push('Keyboard: Alt+Up three times put 815 before 808 and kept its line selected');

    const run = async (r) => (await db().collection('runs').doc('2026-10-04__run_p' + r).get()).data().days.fri.loadSequenceOverride;
    assert.deepEqual(await Promise.all(['815', '808', '812', '811'].map(run)), [40, 50, 60, 70], 'saved as the day\'s load_sequence_override with the numbers the loads had');

    // A finger on a tablet: hold 6302's line, slide it above 815, the first open place right after the loaded 805.
    const tablet = await openPage(browser, { viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: false }, '/loadout.html?date=' + DATE + '&testEmail=viewer.test@uniteddairy.com');
    await tablet.waitForSelector(row('6302') + '[data-drag]');
    await waitOrder(tablet, ['801', '802', '805', '815', '808', '812', '811']);
    await touchDrag(tablet, '6302', '815', 'above');
    await waitOrder(tablet, ['801', '802', '805', '6302', '815']);
    await waitOrder(watcher, ['801', '802', '805', '6302', '815']);
    results.push('Finger on a 1280 tablet: 6302 held and slid up to the first open place, right after the loaded 805');
    if (SHOTS) await tablet.screenshot({ path: path.join(SHOTS, '4-loadout-order-tablet-1280.png') });

    // Skip: 812 waits at the bottom and does not move; 808 slides down past 811.
    await tablet.click(row('812') + ' button.skip');
    await tablet.waitForSelector(row('812') + '.skipped');
    assert.equal(await tablet.$(row('812') + '[data-drag]'), null, 'a skipped load does not move');
    assert.ok(await tablet.$$eval('.clock-cell', cs => cs.every(c => c.parentElement.scrollWidth <= c.parentElement.clientWidth + 1)), 'Start and Skip fit their cell');
    // Review item 59: a finger holds 808 by its Depart cell (not Route or Run) and slides it.
    await touchDrag(tablet, '808', '811', 'below', 7);
    await waitOrder(tablet, ['801', '802', '805', '6302', '815', '811', '808']);
    assert.equal(await tablet.$eval('#rows tr[data-row]:last-child', t => t.dataset.row.split('|')[0]), '2026-10-04__run_p812', 'the skipped load stays at the bottom');
    results.push('Skip: 812 waits at the bottom and does not move; 808 held by its Depart cell slid down past 811');
    if (SHOTS) await tablet.screenshot({ path: path.join(SHOTS, '5-loadout-order-skip-tablet-1280.png') });


    // Every loadout (Case, Totes, Boxes, Tanker) at 1536 and 1920: each load not yet loaded can be dragged by its line (the hand
    // shows), with no arrows and no grab dots. Today and the coming days; a past day does not move.
    for (const [w, h] of [[1920, 1000], [1536, 760]]) {
      const pg = await openPage(browser, { viewport: { width: w, height: h } }, '/loadout.html?date=' + DATE + '&testEmail=viewer.test@uniteddairy.com');
      for (const a of ['CASE', 'TOTES', 'BOXING', 'TANKER']) {
        await pg.click('[data-area="' + a + '"]');
        await pg.waitForFunction(x => document.querySelector('[data-area="' + x + '"]').classList.contains('on') && document.querySelector('#rows tr[data-drag]'), a);
        const lines = await pg.$$eval('#rows tr[data-row]:not(.done):not(.skipped)', g => g.map(tr => ({
          drag: !!tr.dataset.drag, hand: getComputedStyle(tr.children[1]).cursor, extra: !!tr.querySelector('.lo-move, .lo-grip, [data-grip]'), route: tr.children[0].textContent })));
        const today = lines.filter(l => l.drag);
        assert.ok(today.length >= 1 && today.every(l => l.hand === 'grab' && !l.extra), a + ' at ' + w + ': every load today can be dragged by its line, no arrows, no dots ' + JSON.stringify(lines));
        if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, '6-loadout-drag-' + a.toLowerCase() + '-' + w + '.png') });
      }
      assert.deepEqual(pg.errors, []);
      await pg.context().close();
    }
    results.push('Case, Totes, Boxes and Tanker at 1536 and 1920: every load today is dragged by its line (the hand shows); no arrows, no grab dots');
    // As on Daily Dispatch: holding a dragged line near the bottom edge scrolls the list by itself, so a load can go past what
    // is on screen. (The page is closed without letting go, so nothing is saved.)
    const short = await openPage(browser, { viewport: { width: 1536, height: 420 } }, '/loadout.html?date=' + DATE + '&testEmail=viewer.test@uniteddairy.com');
    await short.waitForSelector(row('811') + '[data-drag]');
    const scrolled = () => short.evaluate(() => { let n = document.querySelector('#rows').parentElement; for (; n && n !== document.body; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n.scrollTop; } return document.scrollingElement.scrollTop; });
    const top0 = await scrolled(), grab = await spot(short, '811', 'mid');
    await short.mouse.move(grab.x, grab.y);
    await short.mouse.down();
    await short.mouse.move(grab.x, grab.y + 10);
    await short.mouse.move(grab.x, 412);
    await short.waitForTimeout(800);
    assert.ok(await scrolled() > top0, 'the list scrolls by itself while a line is held near the bottom edge');
    await short.context().close();
    results.push('Holding a dragged line near the bottom edge scrolls the list by itself (as on Daily Dispatch)');
    // Joe 10/12 ("mobile looks wrong and I can't edit"): on a phone each load is a card with its boxes named, big enough to type in,
    // the page scrolls as a whole (no strip a few rows high) and nothing slides sideways.
    const phone = await openPage(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, '/loadout.html?date=' + DATE + '&testEmail=viewer.test@uniteddairy.com');
    await phone.waitForSelector(row('811') + '[data-drag]');
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
    // Review items 21 and 27 (Joe 10/13): on an 800 tablet the loads are cards too (four boxes to a line), the truck box shows the
    // whole unit number, Status and Start / End are on the card (nothing runs off the edge), and there is no side-menu strip.
    const tab800 = await openPage(browser, { viewport: { width: 800, height: 1280 }, hasTouch: true }, '/loadout.html?date=' + DATE + '&testEmail=viewer.test@uniteddairy.com');
    await tab800.waitForSelector(row('811') + '[data-drag]');
    const c800 = await tab800.$eval(row('811'), tr => {
      const truck = tr.querySelector('input[data-k="truck"]');
      return { display: getComputedStyle(tr).display, cols: getComputedStyle(tr).gridTemplateColumns.split(' ').length, truck: truck.scrollWidth <= truck.clientWidth + 1 && truck.value.length >= 6,
        labels: [...tr.children].map(td => td.dataset.l || '').filter(Boolean), off: [...tr.children].filter(td => td.getBoundingClientRect().right > window.innerWidth + 1).length,
        menu: getComputedStyle(document.querySelector('.sidemenu')).display };
    });
    assert.deepEqual([c800.display, c800.cols, c800.truck, c800.off, c800.menu], ['grid', 4, true, 0, 'none'], 'a load is a four-across card at 800, the whole truck number shows, nothing off the edge, no menu strip ' + JSON.stringify(c800));
    assert.ok(c800.labels.includes('Status') && c800.labels.includes('Start / End'), 'Status and Start / End are named on the card ' + JSON.stringify(c800));
    assert.ok(await tab800.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'nothing slides sideways at 800');
    if (SHOTS) await tab800.screenshot({ path: path.join(SHOTS, '7-loadout-tablet-800.png') });
    assert.deepEqual(tab800.errors, []);
    await tab800.context().close();
    results.push('Loadout on an 800 tablet: four-across cards, the whole truck number, Status and Start / End on the card, no side-menu strip');
    results.push('Phone: each load is a card with named boxes big enough to type in; the page scrolls, nothing slides sideways');
    // A day already past has nothing to drag (a coming day's own loads move by the same rule as today's, and the server takes a
    // coming day's order: test/emulator/plant-order.test.js).
    await loader.click('#prev');
    await loader.waitForFunction(() => document.querySelector('#load-date').value === '2026-10-07');
    await loader.waitForTimeout(300);
    assert.equal(await loader.$('#rows tr[data-drag]'), null, 'a past day has nothing to drag');
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
