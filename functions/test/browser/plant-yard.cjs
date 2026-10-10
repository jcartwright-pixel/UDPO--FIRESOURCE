'use strict';
/*
 * Browser check of Yard Checks against the local test database (npm run test:browser). Four loaded trailers wait on the
 * yard today (dated from the real clock, since the yard list follows the time of day): T-701 never checked, T-702 checked
 * 3 hours ago (due again), T-703 checked 30 minutes ago (locked for 2 hours), T-704 never checked. A plant employee records
 * a check and a Left Yard; a second open screen follows without reloading. Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const L = require('../../src/logic');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const MANAGER = '?testEmail=manager.test@uniteddairy.com';

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
async function fits(page, what) {
  const size = await page.evaluate(() => ({ scroll: document.scrollingElement.scrollHeight, inner: window.innerHeight, width: document.scrollingElement.scrollWidth, innerWidth: window.innerWidth }));
  assert.ok(size.scroll <= size.inner && size.width <= size.innerWidth, what + ' fits with no page scrolling: ' + JSON.stringify(size));
}
async function shots(page, name, w) {
  if (!SHOTS) return;
  await page.screenshot({ path: path.join(SHOTS, name + '-' + w + '.png'), scale: 'css' });
  if (w === 1920) await page.screenshot({ path: path.join(SHOTS, name + '-top-2x.png'), clip: { x: 0, y: 0, width: 1920, height: 475 }, scale: 'device' });
}
const trailers = (page) => page.$$eval('#rows tr[data-trailer]', r => r.map(x => x.dataset.trailer));

async function seed() {
  const date = L.operatingDay(new Date()), week = L.weekStart(date), p = L.dayPrefix(L.addDays(date, 2)), d = db();
  const loads = [['701', '849', 'SUN VALLEY'], ['702', '852', 'JERSEY 1'], ['703', '855', 'SUNSHINE'], ['704', '907_1', 'FAIRMONT TRANSFER']];
  for (const [i, [t, route, run]] of loads.entries()) {
    // Loaded today for two days from now, leaving at 10 AM tomorrow: on the yard all of today's operating day.
    await d.collection('runs').doc(week + '__yard' + t).set({ weekStart: week, sheetRow: 900 + i, route, run, routeId: 'rte_y' + t, runId: 'run_y' + t, active: true,
      days: { [p]: { runs: true, loadDate: date, deliveryDate: L.addDays(date, 2), dispatchTime: 600, trailer: 'T-' + t, loadStatus: 'COMPLETE' } } });
  }
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  await d.collection('plantJournal').doc('YARD_CHECK_seed_702').set({ recordId: 'OP-y702', type: 'YARD_CHECK', date, status: 'COMPLETE', trailer: 'T-702', recordedAt: ago(180), recordedBy: 'yard.hand@uniteddairy.com',
    payload: { trailer: 'T-702', temperature: '36', fuelLevel: 'FULL', notes: 'Reefer cycling', status: 'COMPLETE', run: 'JERSEY 1' } });
  await d.collection('plantJournal').doc('YARD_CHECK_seed_703').set({ recordId: 'OP-y703', type: 'YARD_CHECK', date, status: 'COMPLETE', trailer: 'T-703', recordedAt: ago(30), recordedBy: 'yard.hand@uniteddairy.com',
    payload: { trailer: 'T-703', temperature: '34', fuelLevel: '3/4', notes: '', status: 'COMPLETE', run: 'SUNSHINE' } });
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  await seed();
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1920, 950], [1366, 650]]) {
      const page = await openPage(browser, w, h, '/yard.html' + MANAGER);
      await page.waitForFunction(() => document.querySelectorAll('#rows tr[data-trailer]').length === 3);
      assert.deepEqual(await trailers(page), ['T-701', 'T-702', 'T-704']);
      assert.match(await page.textContent('#hstats'), /^4Active3Due1Checked/);
      assert.match(await page.textContent('#rows tr[data-trailer="T-702"]'), /Due now[\s\S]*JERSEY 1/);
      assert.equal(await page.inputValue('#rows tr[data-trailer="T-702"] .yd-temp'), '36', 'the last check\'s values show');
      await fits(page, 'Yard Checks ' + w + 'x' + h);
      await shots(page, 'yard-queue', w);
      await page.click('[data-pane="history"]');
      await page.waitForSelector('#pane-history:not([hidden])');
      assert.equal(await page.$$eval('#history tr', r => r.length), 2);
      await fits(page, 'Yard history ' + w + 'x' + h);
      await shots(page, 'yard-history', w);
      assert.deepEqual(page.errors, []);
      await page.close();
    }

    // Two open screens: one records, the other follows.
    const watcher = await openPage(browser, 1920, 950, '/yard.html' + MANAGER);
    const desk = await openPage(browser, 1920, 950, '/yard.html' + MANAGER);
    await watcher.waitForFunction(() => document.querySelectorAll('#rows tr[data-trailer]').length === 3);
    await desk.waitForFunction(() => document.querySelectorAll('#rows tr[data-trailer]').length === 3);
    const row = (t) => '#rows tr[data-trailer="' + t + '"]';
    await desk.fill(row('T-701') + ' .yd-temp', '35');
    await desk.selectOption(row('T-701') + ' select', '1/2');
    await desk.fill(row('T-701') + ' .yd-notes', 'Reefer on, doors sealed');
    const t0 = Date.now();
    await desk.click(row('T-701') + ' [data-record]');
    await desk.waitForFunction(() => !document.querySelector('#rows tr[data-trailer="T-701"]'));
    const shown = Date.now() - t0;
    await watcher.waitForFunction(() => !document.querySelector('#rows tr[data-trailer="T-701"]') && /^4Active2Due2Checked/.test(document.getElementById('hstats').textContent), null, { timeout: 8000 });
    results.push('Record T-701 (35°F, 1/2, notes): off the list in ' + shown + ' ms, on the other screen in ' + (Date.now() - t0) + ' ms; locked for 2 hours');
    // Left Yard asks once more.
    await desk.click(row('T-704') + ' [data-left]');
    assert.equal(await desk.textContent(row('T-704') + ' [data-left]'), 'Confirm Left');
    await desk.click(row('T-704') + ' [data-left]');
    await watcher.waitForFunction(() => !document.querySelector('#rows tr[data-trailer="T-704"]') && /^3Active1Due2Checked/.test(document.getElementById('hstats').textContent), null, { timeout: 8000 });
    results.push('Left Yard T-704 after "Confirm Left": gone from the other screen');
    await watcher.click('[data-pane="history"]');
    await watcher.waitForFunction(() => document.querySelectorAll('#history tr').length === 4);
    const top = await watcher.$$eval('#history tr', r => r.slice(0, 2).map(x => x.textContent));
    assert.match(top[0], /T-704[\s\S]*Left the yard[\s\S]*Left Yard/);
    assert.match(top[1], /T-701[\s\S]*35[\s\S]*1\/2[\s\S]*Reefer on, doors sealed[\s\S]*Recorded/);
    results.push('24-Hour History: the Left Yard and the check on top, newest first');
    const saved = (await db().collection('plantJournal').where('type', '==', 'YARD_CHECK').get()).docs.map(x => x.data()).filter(x => x.createdInApp);
    assert.deepEqual(saved.map(x => x.payload.trailer + ' ' + x.payload.status).sort(), ['T-701 COMPLETE', 'T-704 DEPARTED']);
    // The phone view (yard hands): Trailer, Temp, Set, Fuel, Notes, Action.
    // The phone (yard hands): one card per trailer, no Record button and no history; each box saves as it is left.
    const phone = await openPage(browser, 412, 860, '/yard.html' + MANAGER);
    const card = '.yd-card[data-trailer="T-702"]';
    await phone.waitForSelector(card);
    assert.equal(await phone.isVisible('#panes'), false, 'no 24-hour history on the phone');
    assert.equal(await phone.$$eval('[data-record]', b => b.filter(x => x.offsetParent).length), 0, 'no Record button on the phone');
    if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, 'yard-phone-412.png'), scale: 'css' });
    await phone.fill(card + ' [data-k="temperature"]', '37');
    await phone.press(card + ' [data-k="temperature"]', 'Enter');
    await phone.waitForFunction((c) => /Saved/.test((document.querySelector(c + ' .yd-tick') || {}).textContent || ''), card);
    await phone.click(card + ' [data-fuel="3/4"]');
    await phone.fill(card + ' [data-k="notes"]', 'Doors sealed');
    await phone.press(card + ' [data-k="notes"]', 'Enter');
    await new Promise(r => setTimeout(r, 1500));
    await phone.waitForFunction((c) => /Saved/.test((document.querySelector(c + ' .yd-tick') || {}).textContent || ''), card);
    const one = (await db().collection('plantJournal').where('type', '==', 'YARD_CHECK').get()).docs.map(x => x.data()).filter(x => x.createdInApp && x.payload.trailer === 'T-702');
    assert.equal(one.length, 1, 'the three boxes fill in one check');
    assert.deepEqual([one[0].payload.temperature, one[0].payload.fuelLevel, one[0].payload.notes], ['37', '3/4', 'Doors sealed']);
    results.push('Phone: T-702 temp, fuel and notes each saved as they were left, into one check; the card stays with "Saved"');
    if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, 'yard-phone-saved-412.png'), scale: 'css' });
    await phone.click(card + ' [data-left]');
    assert.match(await phone.textContent(card + ' [data-left]'), /Tap again to confirm/);
    if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, 'yard-phone-confirm-412.png'), scale: 'css' });
    await phone.click(card + ' [data-left]');
    await phone.waitForFunction((c) => !document.querySelector(c), card);
    results.push('Phone: Left Yard asks once more, then the card is gone');
    assert.deepEqual(phone.errors, []);
    assert.deepEqual(desk.errors, []);
    assert.deepEqual(watcher.errors, []);
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('YARD ' + r));
})().catch(e => { console.error(e); process.exit(1); });
