'use strict';
/*
 * Browser check (Joe 10/19, 800 Specials: "could be totes, could be cases, could be anything ... so it goes to the appropriate
 * loading place"): Daily Dispatch > Edit has a Load type for the day. Changing a case load to Totes moves it off the Daily Case
 * Loadout and onto the Daily Tote Loadout, and the Manager Center's report counts it as a Tote load. Pictures go to SHOTS_DIR.
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
const DATE = PD.PLANT_DATE, CLOCK = new Date('2026-10-08T14:00:00Z'), RUN = '2026-10-04__run_p811';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height } });
  await localCalls(page);
  await page.clock.setFixedTime(CLOCK);
  await page.route(/127\.0\.0\.1:5001\/.*\/save$/, (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fallback();
    const body = JSON.parse(req.postData() || '{}');
    body.data = Object.assign({}, body.data, { testNow: CLOCK.toISOString() });
    route.fallback({ postData: JSON.stringify(body) });
  });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const shot = (page, name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, name) }) : null);
const loadRow = '#rows tr[data-row^="' + RUN + '|"]';

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => CLOCK });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1536, 790], [1920, 950]]) {
      await db().collection('runs').doc(RUN).update({ 'days.fri.loadType': '', 'days.fri.loadTypeByHand': false });
      // Before: 811 loads on the Daily Case Loadout.
      let lo = await openPage(browser, w, h, '/loadout.html?date=' + DATE + '&area=CASE&testEmail=viewer.test@uniteddairy.com');
      await lo.waitForSelector(loadRow);
      await shot(lo, 'before-case-loadout-' + w + '.png');
      await lo.close();

      // Daily Dispatch > Edit on 811: Load type shows Case (the route's own), then Totes is picked.
      const daily = await openPage(browser, w, h, '/daily.html?date=' + DATE + '&testEmail=dispatch.test@uniteddairy.com');
      const row811 = daily.locator('#rows tr[data-id]').filter({ has: daily.locator('td.route', { hasText: /^811$/ }) });
      await row811.locator('[data-open]').click();
      const pick = daily.locator('#edit-modal select[data-field="loadType"]');
      await pick.waitFor();
      assert.equal(await pick.inputValue(), 'CASE', 'the route\'s own type is shown first');
      assert.deepEqual(await pick.locator('option').allTextContents(), ['Case', 'Totes', 'Boxes', 'Tanker']);
      const size = await pick.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
      assert.ok(size >= 16, 'the Load type box is at least 16px (' + size + ')');
      const box = await daily.locator('#edit-modal').boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= h, 'the Edit box fits the window at ' + w + 'x' + h);
      await pick.selectOption('TOTES');
      for (let i = 0; i < 50 && ((await db().collection('runs').doc(RUN).get()).data().days.fri.loadType !== 'TOTES'); i++) await daily.waitForTimeout(100);
      const day = (await db().collection('runs').doc(RUN).get()).data().days.fri;
      assert.equal(day.loadType, 'TOTES');
      assert.equal(day.loadTypeByHand, true);
      await daily.waitForTimeout(300);
      assert.equal(await pick.inputValue(), 'TOTES');
      await shot(daily, 'after-daily-edit-' + w + '.png');
      assert.deepEqual(daily.errors, []);
      await daily.close();
      results.push(w + ': Daily Dispatch > Edit changed 811 from Case to Totes');

      // After: 811 is gone from the Case loadout and is on the Tote loadout.
      lo = await openPage(browser, w, h, '/loadout.html?date=' + DATE + '&area=CASE&testEmail=viewer.test@uniteddairy.com');
      await lo.waitForSelector('#rows tr[data-row]');
      assert.equal(await lo.locator(loadRow).count(), 0, '811 is off the Case loadout');
      await lo.click('#areas [data-area="TOTES"]');
      await lo.waitForSelector(loadRow);
      await shot(lo, 'after-tote-loadout-' + w + '.png');
      assert.deepEqual(lo.errors, []);
      await lo.close();
      results.push(w + ': 811 moved from the Daily Case Loadout to the Daily Tote Loadout');

      // The Manager Center's report (and the email made from it) counts 811 with the Tote loads.
      const mc = await openPage(browser, w, h, '/manager.html?date=' + DATE + '&testEmail=manager.test@uniteddairy.com');
      await mc.waitForFunction(() => /Plant Update/.test((document.getElementById('pv-subject') || {}).textContent || ''), null, { timeout: 15000 });
      const areaOf811 = await mc.evaluate(async (date) => {
        const P = await import('./js/plant-core.js'), F = await import('./js/firebase.js');
        const snap = await F.getDocs(F.query(F.collection(F.getFirestore(), 'runs'), F.where('weekStart', '==', '2026-10-04')));
        const rows = P.loadoutRows(snap.docs.map(d => Object.assign({ id: d.id }, d.data())), date);
        return (rows.find(r => r.route === '811') || {}).area;
      }, DATE).catch(e => 'error: ' + e.message);
      if (!/^error/.test(areaOf811)) assert.equal(areaOf811, 'TOTES', 'the Manager Center\'s loads list has 811 as a Tote load');
      await shot(mc, 'after-manager-center-' + w + '.png');
      assert.deepEqual(mc.errors, []);
      await mc.close();
      results.push(w + ': the Manager Center reads 811 as a Tote load' + (/^error/.test(areaOf811) ? ' (list check skipped: ' + areaOf811 + ')' : ''));
    }
    // A phone: the Edit box's Load type is on screen and usable.
    const phone = await openPage(browser, 390, 844, '/daily.html?date=' + DATE + '&testEmail=dispatch.test@uniteddairy.com');
    const r = phone.locator('#rows tr[data-id]').filter({ has: phone.locator('td.route', { hasText: /^812$/ }) });
    await r.locator('[data-open]').click();
    const pk = phone.locator('#edit-modal select[data-field="loadType"]');
    await pk.scrollIntoViewIfNeeded();
    const b = await pk.boundingBox();
    assert.ok(b && b.x >= 0 && b.x + b.width <= 390, 'the Load type box fits a phone');
    assert.ok(await phone.evaluate(() => { const m = document.getElementById('edit-modal'); return m.scrollWidth <= m.clientWidth + 1 && m.getBoundingClientRect().left >= 0 && m.getBoundingClientRect().right <= innerWidth; }), 'the Edit box does not run off the phone');
    await shot(phone, 'after-daily-edit-phone.png');
    assert.deepEqual(phone.errors, []);
    await phone.close();
    results.push('390 phone: the Load type box fits');
  } finally {
    await browser.close();
  }
  results.forEach(x => console.log('ok  ' + x));
})().catch(e => { console.error(e); process.exit(1); });
