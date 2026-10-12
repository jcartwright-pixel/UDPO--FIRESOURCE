'use strict';
/*
 * Browser check of the old Route Editor's tools in the new one (review item 14, RouteManagement.html bindGrid, sequenceView,
 * details, recap): arrow keys move between boxes, Shift+arrows mark a block, one value pasted fills the block, Ctrl+X cuts it,
 * Ctrl+D fills it down, Esc puts a box back; Load Order up / down buttons; Route Details for many runs at once; Recap totals.
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
const SHOTS = process.env.SHOTS_DIR || '';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const shot = async (p, name, clip) => { if (SHOTS) await p.screenshot(Object.assign({ path: path.join(SHOTS, name) }, clip ? { clip } : {})); };
const fits = (p) => p.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight && document.scrollingElement.scrollWidth <= innerWidth);
const cell = (run, d) => 'tr[data-id="' + run + '"] input.cell[data-day="' + d + '"]';
const focused = (p) => p.evaluate(() => [document.activeElement.closest('tr').dataset.id, document.activeElement.dataset.day]);
// The screen's own saves finish first (edit.js savesPending, the count behind "Saving..."): on a slow emulator a save can
// take well over 10 seconds, so the stored value is checked only once the screen says nothing is still saving.
let screen = null;
async function settled() {
  if (screen) await screen.evaluate(async () => { const m = await import('./js/edit.js'); while (m.savesPending()) await new Promise(r => setTimeout(r, 100)); });
}
async function stored(run, d, field, want) {
  await settled();
  for (let i = 0; i < 40; i++) {
    const v = ((await db().collection('routes').doc(run).get()).data().days[d] || {})[field];
    if (v === want) return v;
    await new Promise(r => setTimeout(r, 250));
  }
  return ((await db().collection('routes').doc(run).get()).data().days[d] || {})[field];
}
const clip = (p, type, text) => p.evaluate(([type, text]) => {
  const dt = new DataTransfer();
  if (text !== null) dt.setData('text/plain', text);
  document.activeElement.dispatchEvent(new ClipboardEvent(type, { clipboardData: dt, bubbles: true, cancelable: true }));
  return dt.getData('text/plain');
}, [type, text]);

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  const browser = await chromium.launch();
  const results = [];
  try {
    const p = await openPage(browser, 1920, 1080, '/routes.html?testEmail=manager.test@uniteddairy.com');
    screen = p;
    await p.waitForSelector('table.routes tr[data-id="run_t801"]');
    await p.selectOption('#view-select', 'times');
    await p.waitForSelector(cell('run_t801', 'mon'));
    const rows = await p.$$eval('table.routes tbody tr[data-id]', t => t.map(x => x.dataset.id));
    const [first, second] = rows;

    // Arrows: Down / Up a row, Right at the end of the text and Left at its start a day.
    await p.click(cell(first, 'mon'));
    await p.keyboard.press('ArrowDown');
    assert.deepEqual(await focused(p), [second, 'mon'], 'Down moves to the next run');
    await p.keyboard.press('ArrowUp');
    assert.deepEqual(await focused(p), [first, 'mon'], 'Up moves back');
    await p.keyboard.press('End');
    await p.keyboard.press('ArrowRight');
    assert.deepEqual(await focused(p), [first, 'tue'], 'Right at the end of the text moves a day');
    await p.keyboard.press('Home');
    await p.keyboard.press('ArrowLeft');
    assert.deepEqual(await focused(p), [first, 'mon'], 'Left at the start moves back a day');
    results.push('Arrow keys move up, down, left and right between the boxes');

    // Esc puts the box back.
    const was = await p.inputValue(cell(first, 'mon'));
    await p.keyboard.type('9:45 PM');
    await p.keyboard.press('Escape');
    assert.equal(await p.inputValue(cell(first, 'mon')), was, 'Esc puts the box back');

    // Shift+arrows mark a 2 x 2 block; one value pasted fills all four (block fill), one save per run.
    await p.keyboard.press('Shift+ArrowDown');
    await p.keyboard.press('Shift+ArrowRight');
    assert.equal(await p.$$eval('input.cell.picked', x => x.length), 4, 'Shift+arrows mark a two-by-two block');
    await shot(p, 'routes-block-marked-1920.png');
    await clip(p, 'paste', '6 AM');
    for (const [run, d] of [[first, 'mon'], [first, 'tue'], [second, 'mon'], [second, 'tue']]) {
      await p.waitForFunction((s) => document.querySelector(s).value === '6:00 AM', cell(run, d), { timeout: 5000 });
      assert.equal(await stored(run, d, 'dispatchTime', 360), 360, run + ' ' + d + ' saved 6:00 AM');
    }
    results.push('Shift+arrows marked a block and one pasted value filled all four boxes, saved');

    // Ctrl+Enter fills the block with what is typed in the box.
    await p.click(cell(first, 'wed'));
    await p.fill(cell(first, 'wed'), '7:30 AM');
    await p.click(cell(second, 'thu'), { modifiers: ['Shift'] });
    await p.keyboard.press('Control+Enter');
    for (const [run, d] of [[first, 'wed'], [first, 'thu'], [second, 'wed'], [second, 'thu']]) {
      await p.waitForFunction((s) => document.querySelector(s).value === '7:30 AM', cell(run, d), { timeout: 5000 });
    }
    assert.equal(await stored(second, 'thu', 'dispatchTime', 450), 450, 'Ctrl+Enter block fill saved');
    results.push('Ctrl+Enter filled a marked block with the typed time');

    // Ctrl+D fills the block down from its top row.
    await p.fill(cell(first, 'fri'), '4 AM');
    await p.keyboard.press('Tab');
    await p.waitForFunction((s) => document.querySelector(s).value === '4:00 AM', cell(first, 'fri'), { timeout: 5000 });
    await p.click(cell(first, 'fri'));
    await p.keyboard.press('Shift+ArrowDown');
    await p.keyboard.press('Control+d');
    await p.waitForFunction((s) => document.querySelector(s).value === '4:00 AM', cell(second, 'fri'), { timeout: 5000 });
    assert.equal(await stored(second, 'fri', 'dispatchTime', 240), 240, 'Ctrl+D fill down saved');
    results.push('Ctrl+D filled the block down from its top row');

    // Ctrl+X copies the block (rows and columns) and clears it.
    await p.click(cell(first, 'mon'));
    await p.keyboard.press('Shift+ArrowDown');
    await p.keyboard.press('Shift+ArrowRight');
    const cut = await clip(p, 'cut', null);
    assert.equal(cut, '6:00 AM\t6:00 AM\n6:00 AM\t6:00 AM', 'cut gives the block back as rows and columns');
    await p.waitForFunction((s) => document.querySelector(s).value === '', cell(second, 'tue'), { timeout: 5000 });
    assert.equal(await stored(second, 'tue', 'dispatchTime', null), null, 'the cut block is cleared and saved');
    results.push('Ctrl+X copied the block and cleared it');
    assert.equal(await p.$eval(cell(first, 'mon'), x => getComputedStyle(x).fontSize), '16px');
    assert.ok(await fits(p), 'Start Times fits 1920x1080');

    // Load Order: the down arrow on the first run moves it below the second; saved as one order.
    await p.selectOption('#view-select', 'seq');
    await p.waitForSelector('table.routes tr[data-i="1"] button[data-move="1"]');
    await p.waitForTimeout(500);
    const order = () => p.$$eval('table.routes tbody tr[data-i]', t => t.map(x => x.dataset.id));
    const before = await order();
    assert.equal(await p.isDisabled('table.routes tr[data-i="0"] button[data-move="-1"]'), true, 'the first run cannot go up');
    await shot(p, 'routes-load-order-before-1920.png');
    await p.click('table.routes tr[data-i="0"] button[data-move="1"]');
    await p.waitForFunction((b) => { const ids = [...document.querySelectorAll('table.routes tbody tr[data-i]')].map(x => x.dataset.id); return ids[0] === b[1] && ids[1] === b[0]; }, before, { timeout: 5000 });
    assert.equal(await stored(before[0], 'mon', 'loadOrder', 20), 20, 'moved down: order 20');
    assert.equal(await stored(before[1], 'mon', 'loadOrder', 10), 10, 'moved up: order 10');
    await p.click('table.routes tr[data-i="1"] button[data-move="-1"]');
    await p.waitForFunction((b) => [...document.querySelectorAll('table.routes tbody tr[data-i]')].map(x => x.dataset.id)[0] === b[0], before, { timeout: 5000 });
    assert.deepEqual(await order(), before, 'the up arrow moves it back');
    await shot(p, 'routes-load-order-1920.png');
    assert.ok(await fits(p), 'Load Order fits 1920x1080');
    results.push('Load Order up and down arrows moved a run and saved the day\'s order');

    // Route Details for many runs at once: every run on one page; a list and a box save on their own.
    await p.selectOption('#view-select', 'many');
    await p.waitForSelector('table.routes.many tr[data-id="run_t802"] select[data-many="loadType"]');
    assert.ok(await p.$$eval('table.routes.many tbody tr[data-id]', t => t.length) >= 4, 'every run shown on one page');
    assert.deepEqual(await p.$$eval('table.routes.many thead th', t => t.map(x => x.textContent)), ['Stream ID', 'Route', 'Route Name', 'Run', 'Run Type', 'Loadout', 'Run by', 'Plant', 'Weekly', 'Daily', 'Mobile route', 'Route list', 'Sleeper', 'Drop & hook', 'Active']);
    await p.selectOption('table.routes.many tr[data-id="run_t802"] select[data-many="loadType"]', 'Boxing');
    await p.selectOption('table.routes.many tr[data-id="run_t801"] select[data-many="coverageOwner"]', 'Fairmont');
    await p.click('table.routes.many tr[data-id="run_t801"] input[data-many="dropAndHook"]');
    await settled();
    for (let i = 0; i < 40; i++) {
      const a = (await db().collection('routes').doc('run_t801').get()).data(), b = (await db().collection('routes').doc('run_t802').get()).data();
      if (a.coverageOwner === 'Fairmont' && a.dropAndHook === true && b.loadType === 'Boxing') break;
      if (i === 39) assert.fail('Route Details saves: ' + JSON.stringify({ a: [a.coverageOwner, a.dropAndHook], b: b.loadType }));
      await new Promise(r => setTimeout(r, 250));
    }
    assert.equal(await p.$eval('table.routes.many td', x => getComputedStyle(x).fontSize), '16px');
    assert.ok(await fits(p), 'Route Details (many runs) fits 1920x1080');
    await shot(p, 'routes-many-1920.png');
    results.push('Route Details for many runs: 802 set to Boxing, 801 to Fairmont with drop and hook, each saved on its own');

    // Route names (Joe 10/12): Stream ID, Route, Route Name, Run and Run Type are typed over right in the list. Run and Run Type
    // save on that run; Route Name saves on every run of the route and no other; the run id never changes.
    assert.match(await p.textContent('#name-help'), /Route Name every run of the route/);
    const nm = (run, f) => 'table.routes tr[data-id="' + run + '"] input.nm[data-name="' + f + '"]';
    await p.fill(nm('run_t801', 'run'), 'Load 1');
    await p.press(nm('run_t801', 'run'), 'Enter');
    await p.fill(nm('run_t801', 'routeName'), 'DSD');
    await p.press(nm('run_t801', 'routeName'), 'Enter');
    await p.fill(nm('run_t801', 'routeRunType'), 'Load 2');
    await p.press(nm('run_t801', 'routeRunType'), 'Enter');
    await settled();
    for (let i = 0; i < 40; i++) {
      const a = (await db().collection('routes').doc('run_t801').get()).data(), b = (await db().collection('routes').doc('run_t802').get()).data();
      if (a.run === 'Load 1' && a.routeName === 'DSD' && a.routeRunType === 'Load 2' && b.routeName === 'UT DSD MILK') break;
      if (i === 39) assert.fail('Route names: ' + JSON.stringify({ a: [a.run, a.routeName, a.routeRunType], b: b.routeName }));
      await new Promise(r => setTimeout(r, 250));
    }
    await p.selectOption('#view-select', 'miles');
    await p.waitForSelector(nm('run_t801', 'run'));
    assert.equal(await p.inputValue(nm('run_t801', 'run')), 'Load 1');
    assert.equal(await p.inputValue(nm('run_t801', 'routeName')), 'DSD');
    assert.equal(await p.$eval(nm('run_t801', 'run'), x => getComputedStyle(x).fontSize), '16px');
    assert.ok(await fits(p), 'Mileage with the three name columns fits 1920x1080');
    await shot(p, 'routes-names-miles-1920.png');
    await p.selectOption('#view-select', 'many');
    await p.waitForSelector('table.routes.many tr[data-id="run_t802"] select[data-many="loadType"]');
    results.push('Route names: 801 Run typed to Load 1, Route Name to DSD and Run Type to Load 2, saved; 802 kept its own Route Name');

    // Recap: the old five totals above the list, and a totals line under each column.
    await p.selectOption('#view-select', 'recap');
    await p.waitForSelector('#recap-totals:not([hidden]) strong');
    const totals = await p.$$eval('#recap-totals > div', d => d.map(x => x.querySelector('span').textContent + '=' + x.querySelector('strong').textContent));
    const all = (await db().collection('routes').get()).docs.map(d => d.data());
    assert.deepEqual(totals.map(t => t.split('=')[0]), ['Routes', 'Runs / Destinations', 'Active Runs', 'Weekly Run Occurrences', 'Visible in Plant']);
    assert.equal(totals[0], 'Routes=' + new Set(all.map(r => r.route)).size);
    assert.equal(totals[1], 'Runs / Destinations=' + all.length);
    assert.ok(await p.$('table.routes.recap tfoot tr.recap-sum'), 'a totals line under the columns');
    assert.ok(await fits(p), 'Recap fits 1920x1080');
    await shot(p, 'routes-recap-1920.png');
    results.push('Recap shows Routes, Runs, Active Runs, Weekly Run Occurrences and Visible in Plant, and column totals');
    assert.deepEqual(p.errors, []);
    await p.close();

    // A laptop: the new views still fit.
    const lap = await openPage(browser, 1366, 768, '/routes.html?testEmail=manager.test@uniteddairy.com');
    await lap.waitForSelector('table.routes tr[data-id="run_t801"]');
    for (const v of ['seq', 'many', 'recap', 'times']) {
      await lap.selectOption('#view-select', v);
      await lap.waitForTimeout(150);
      assert.ok(await fits(lap), v + ' fits 1366x768');
    }
    assert.deepEqual(lap.errors, []);
    await lap.close();
    results.push('Load Order, Route Details, Recap and Start Times fit at 1366x768');

    // A dispatcher sees the tools read only: no up / down, no boxes to tick.
    const disp = await openPage(browser, 1366, 768, '/routes.html?testEmail=dispatch.test@uniteddairy.com');
    await disp.waitForSelector('table.routes tr[data-id="run_t801"]');
    await disp.selectOption('#view-select', 'many');
    await disp.waitForSelector('table.routes.many input[data-many="active"]');
    assert.equal(await disp.$$eval('table.routes.many input[data-many], table.routes.many select[data-many]', x => x.every(n => n.disabled)), true);
    await disp.selectOption('#view-select', 'seq');
    await disp.waitForSelector('table.routes tr[data-i="0"]');
    assert.equal(await disp.$$eval('button[data-move]', x => x.every(n => n.disabled)), true);
    await disp.close();
    results.push('A dispatcher sees Route Details and Load Order read only');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok - ' + r));
})().catch(err => { console.error(err); process.exit(1); });
