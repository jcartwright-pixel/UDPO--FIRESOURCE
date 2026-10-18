'use strict';
/*
 * Browser check of Yard Checks against the local test database (npm run test:browser). Four loaded trailers wait on the
 * yard today (dated from the real clock, since the yard list follows the time of day): T-701 never checked, T-702 checked
 * 3 hours ago (due again), T-703 checked 30 minutes ago (locked for 2 hours), T-704 never checked. A plant employee records
 * a check and a Left Yard; a second open screen follows without reloading. Joe 10/18: one more column, GPS Temp (gpsReefer),
 * red when far from the set point; everything typed stays as it was. Pictures go to SHOTS_DIR.
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
  // Only these four loads: the made-up plant's own runs fall in some weeks of the real calendar (on 10/12/26 its T-902 load
  // showed on the yard too and the check failed), as plant-manager.cjs does.
  for (const r of (await d.collection('runs').get()).docs) await r.ref.delete();
  const loads = [['701', '849', 'SUN VALLEY'], ['702', '852', 'JERSEY 1'], ['703', '855', 'SUNSHINE'], ['704', '907_1', 'FAIRMONT TRANSFER']];
  for (const [i, [t, route, run]] of loads.entries()) {
    // Loaded today for two days from now, leaving at 10 AM tomorrow: on the yard all of today's operating day.
    await d.collection('runs').doc(week + '__yard' + t).set({ weekStart: week, sheetRow: 900 + i, route, run, routeId: 'rte_y' + t, runId: 'run_y' + t, active: true,
      days: { [p]: { runs: true, loadDate: date, deliveryDate: L.addDays(date, 2), dispatchTime: 600, trailer: 'T-' + t, loadStatus: 'COMPLETE' } } });
  }
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  await d.collection('plantJournal').doc('YARD_CHECK_seed_702').set({ recordId: 'OP-y702', type: 'YARD_CHECK', date, status: 'COMPLETE', trailer: 'T-702', recordedAt: ago(180), recordedBy: 'yard.hand@uniteddairy.com',
    payload: { trailer: 'T-702', temperature: '36', setPoint: '34', fuelLevel: 'FULL', notes: 'Reefer cycling', status: 'COMPLETE', run: 'JERSEY 1' } });
  await d.collection('plantJournal').doc('YARD_CHECK_seed_703').set({ recordId: 'OP-y703', type: 'YARD_CHECK', date, status: 'COMPLETE', trailer: 'T-703', recordedAt: ago(30), recordedBy: 'yard.hand@uniteddairy.com',
    payload: { trailer: 'T-703', temperature: '34', fuelLevel: '3/4', notes: '', status: 'COMPLETE', run: 'SUNSHINE' } });
  // The GPS readings the 5-minute Fleet read writes (fleetgps.js pullReefer): T-701 fine, T-702 10.6° over its set point of 34,
  // T-704 has no GPS unit.
  const trip = (t, extra) => d.collection('gpsReefer').doc(t).set(Object.assign({ trailer: t, id: 'x|' + t, routeRun: '', unitId: 'u' + t, tag: t, startedAt: ago(120), recording: true, out: '', back: '',
    stoppedAt: '', stopReason: '', tempF: null, readingAt: '', updatedAt: ago(3) }, extra));
  await trip('T-701', { routeRun: 'SUN VALLEY', tempF: 35.4, readingAt: ago(3) });
  await trip('T-702', { routeRun: 'JERSEY 1', tempF: 44.6, readingAt: ago(4) });
  await trip('T-704', { routeRun: 'FAIRMONT TRANSFER', unitId: '', tag: '' });
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  await seed();
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1920, 950], [1536, 864], [1366, 650], [1024, 768]]) {
      const page = await openPage(browser, w, h, '/yard.html' + MANAGER);
      await page.waitForFunction(() => document.querySelectorAll('#rows tr[data-trailer]').length === 3);
      assert.deepEqual(await trailers(page), ['T-701', 'T-702', 'T-704']);
      assert.match(await page.textContent('#hstats'), /^4Active3Due1Checked/);
      assert.match(await page.textContent('#rows tr[data-trailer="T-702"]'), /Due now[\s\S]*JERSEY 1/);
      // Joe 10/10: a trailer due again starts with empty boxes; its last check is in Last Check.
      assert.equal(await page.inputValue('#rows tr[data-trailer="T-702"] .yd-temp'), '', 'the boxes start empty');
      assert.notEqual((await page.textContent('#rows tr[data-trailer="T-702"] .yd-last')).trim(), '—', 'the last check shows in Last Check');
      // Joe 10/18: one more column, GPS Temp, after the typed temperature, set point and fuel; red when more than 5° from the set point.
      assert.deepEqual(await page.$$eval('#pane-current thead th', t => t.map(x => (x.querySelector('.l') || x).textContent)),
        ['Trailer #', 'Actual Temp (°F)', 'Temp Set Point (°F)', 'Fuel Level', 'GPS Temp (°F)', 'Notes', 'Last Check', 'Next Recheck', 'Action']);
      await page.waitForFunction(() => /35\.4°/.test((document.querySelector('#rows tr[data-trailer="T-701"] .yd-gps') || {}).textContent || ''));
      assert.equal((await page.textContent('#rows tr[data-trailer="T-701"] .yd-gps')).trim(), '35.4°');
      assert.equal(await page.$eval('#rows tr[data-trailer="T-701"] .yd-gps', x => x.classList.contains('bad')), false);
      assert.equal(await page.$eval('#rows tr[data-trailer="T-702"] .yd-gps', x => x.classList.contains('bad')), true, '44.6° against a set point of 34 is red');
      assert.match(await page.getAttribute('#rows tr[data-trailer="T-702"] .yd-gps', 'title'), /10\.6° above the set point/);
      assert.equal((await page.textContent('#rows tr[data-trailer="T-704"] .yd-gps')).trim(), '—');
      assert.deepEqual(await page.$$eval('[data-pane]', b => b.map(x => x.textContent)), ['Active Yard Queue', '24-Hour History'], 'no new tab');
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
    // No Record button: each box saves as it is left, and T-701 stays on this screen while it is filled in.
    assert.equal(await desk.$('[data-record]'), null, 'Yard Checks has no Record button');
    await desk.fill(row('T-701') + ' .yd-temp', '35');
    const t0 = Date.now();
    await desk.press(row('T-701') + ' .yd-temp', 'Tab');
    await desk.waitForFunction(() => /Saved|\d/.test((document.querySelector('#rows tr[data-trailer="T-701"] .yd-tick') || {}).textContent || ''));
    const shown = Date.now() - t0;
    await watcher.waitForFunction(() => !document.querySelector('#rows tr[data-trailer="T-701"]') && /^4Active2Due2Checked/.test(document.getElementById('hstats').textContent), null, { timeout: 8000 });
    await desk.selectOption(row('T-701') + ' select', '1/2');
    await desk.fill(row('T-701') + ' .yd-notes', 'Reefer on, doors sealed');
    await desk.press(row('T-701') + ' .yd-notes', 'Tab');
    // Joe 10/15 ("unable to enter the temperature setting"): the set point box takes a typed number and saves with the check.
    assert.equal(await desk.$eval(row('T-701') + ' .yd-set', x => x.readOnly), false, 'the set point box can be typed in');
    await desk.fill(row('T-701') + ' .yd-set', '34');
    await desk.press(row('T-701') + ' .yd-set', 'Tab');
    for (let i = 0; i < 40; i++) {
      const c = (await db().collection('plantJournal').where('type', '==', 'YARD_CHECK').get()).docs.map(x => x.data()).find(x => x.createdInApp && x.payload.trailer === 'T-701');
      if (c && c.payload.fuelLevel === '1/2' && c.payload.notes === 'Reefer on, doors sealed' && c.payload.setPoint === '34') break;
      await desk.waitForTimeout(250);
    }
    const gpsKept = (await db().collection('plantJournal').where('type', '==', 'YARD_CHECK').get()).docs.map(x => x.data()).find(x => x.createdInApp && x.payload.trailer === 'T-701');
    assert.equal(gpsKept.payload.gpsTempF, 35.4, 'the check keeps the GPS temperature at that time (not shown)');
    results.push('T-701 (35°F, set point 34, 1/2, notes) saved box by box: saved on screen in ' + shown + ' ms, off the other screen in ' + (Date.now() - t0) + ' ms; locked for 2 hours');
    // Left Yard asks once more. (The check's redraw 1.5 seconds after it is saved is let through first, so it cannot land
    // between the press and the release of the click.)
    await desk.waitForTimeout(1600);
    await desk.click(row('T-704') + ' [data-left]');
    assert.equal(await desk.textContent(row('T-704') + ' [data-left]'), 'Confirm Left');
    await desk.click(row('T-704') + ' [data-left]');
    await watcher.waitForFunction(() => !document.querySelector('#rows tr[data-trailer="T-704"]') && /^3Active1Due2Checked/.test(document.getElementById('hstats').textContent), null, { timeout: 8000 });
    results.push('Left Yard T-704 after "Confirm Left": gone from the other screen');
    await watcher.click('[data-pane="history"]');
    await watcher.waitForFunction(() => document.querySelectorAll('#history tr').length === 4);
    const top = await watcher.$$eval('#history tr', r => r.slice(0, 2).map(x => x.textContent));
    assert.match(top[0], /T-704[\s\S]*Left the yard[\s\S]*Left Yard/);
    assert.match(top[1], /T-701[\s\S]*35[\s\S]*34[\s\S]*1\/2[\s\S]*Reefer on, doors sealed[\s\S]*Recorded/);
    results.push('24-Hour History: the Left Yard and the check on top, newest first');
    const saved = (await db().collection('plantJournal').where('type', '==', 'YARD_CHECK').get()).docs.map(x => x.data()).filter(x => x.createdInApp);
    assert.deepEqual(saved.map(x => x.payload.trailer + ' ' + x.payload.status).sort(), ['T-701 COMPLETE', 'T-704 DEPARTED']);
    // The phone view (yard hands): Trailer, Temp, Set, Fuel, Notes, Action.
    // The phone (yard hands): one card per trailer, no Record button and no history; each box saves as it is left.
    const phone = await openPage(browser, 390, 844, '/yard.html' + MANAGER);
    const card = '.yd-card[data-trailer="T-702"]';
    await phone.waitForSelector(card);
    assert.equal(await phone.isVisible('#panes'), false, 'no 24-hour history on the phone');
    assert.equal(await phone.$$eval('[data-record]', b => b.filter(x => x.offsetParent).length), 0, 'no Record button on the phone');
    assert.match(await phone.textContent(card + ' .yd-gpsf'), /GPS °F\s*44\.6°/);
    assert.equal(await phone.$eval(card + ' .yd-gpsf', x => x.classList.contains('bad')), true, 'the phone card shows the GPS temperature in red too');
    if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, 'yard-phone-390.png'), scale: 'css' });
    await phone.fill(card + ' [data-k="temperature"]', '37');
    await phone.press(card + ' [data-k="temperature"]', 'Enter');
    await phone.waitForFunction((c) => /Saved/.test((document.querySelector(c + ' .yd-tick') || {}).textContent || ''), card);
    await phone.fill(card + ' [data-k="setPoint"]', '33');
    await phone.press(card + ' [data-k="setPoint"]', 'Enter');
    await phone.click(card + ' [data-fuel="3/4"]');
    await phone.fill(card + ' [data-k="notes"]', 'Doors sealed');
    await phone.press(card + ' [data-k="notes"]', 'Enter');
    await new Promise(r => setTimeout(r, 1500));
    await phone.waitForFunction((c) => /Saved/.test((document.querySelector(c + ' .yd-tick') || {}).textContent || ''), card);
    const one = (await db().collection('plantJournal').where('type', '==', 'YARD_CHECK').get()).docs.map(x => x.data()).filter(x => x.createdInApp && x.payload.trailer === 'T-702');
    assert.equal(one.length, 1, 'the three boxes fill in one check');
    assert.deepEqual([one[0].payload.temperature, one[0].payload.setPoint, one[0].payload.fuelLevel, one[0].payload.notes], ['37', '33', '3/4', 'Doors sealed']);
    results.push('Phone: T-702 temp, set point, fuel and notes each saved as they were left, into one check; the card stays with "Saved"');
    if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, 'yard-phone-saved-390.png'), scale: 'css' });
    await phone.click(card + ' [data-left]');
    assert.match(await phone.textContent(card + ' [data-left]'), /Tap again to confirm/);
    if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, 'yard-phone-confirm-390.png'), scale: 'css' });
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
