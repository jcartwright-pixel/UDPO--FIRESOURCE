'use strict';
/*
 * Browser check of the Plant Station's Boxing and Yard Services stations (Joe 10/12). Boxing: Shipping / Loadout lists the
 * box loads and the Scheduler's shipments on one list, colored by who takes the load, and Receiving receives the suppliers'
 * deliveries. Yard Services: the plant's own Trailer Assignments and Yard Checks screens inside the station, without their
 * header and menu. With SHOTS=<folder> it also saves a picture of each.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const { phoneCall } = require('../../src/phone');
const { garageCall } = require('../../src/garage');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const MANAGER = '?testEmail=manager.test@uniteddairy.com';
const SHOTS = process.env.SHOTS || '';

async function openPage(browser, width, height, url, clock, touch) {
  const page = await browser.newPage(Object.assign(touch ? { viewport: { width, height }, hasTouch: true, isMobile: true } : { viewport: { width, height } }, { serviceWorkers: 'block' }));
  if (clock) await page.clock.setFixedTime(new Date(clock));
  await localCalls(page);
  // The public callables answer straight from the server code when no functions emulator runs (LOCAL_CALLS=1).
  if (process.env.LOCAL_CALLS) {
    await page.route(/:5001\/[^/]+\/[^/]+\/(garage|phone)$/, async (route) => {
      const name = route.request().url().split('/').pop(), data = (route.request().postDataJSON() || {}).data;
      try {
        const result = await (name === 'garage' ? garageCall(db(), data) : phoneCall(db(), data));
        route.fulfill({ contentType: 'application/json', body: JSON.stringify({ result }) });
      } catch (e) {
        route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { status: 'FAILED_PRECONDITION', message: e.message } }) });
      }
    });
  }
  // The Driver Room weather window reads Open-Meteo; the check answers with a fixed forecast.
  await page.route(/api\.open-meteo\.com/, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    current: { temperature_2m: 54.4, weather_code: 2, wind_speed_10m: 7.6 },
    daily: { weather_code: [2, 61], temperature_2m_max: [61.2, 58], temperature_2m_min: [43.8, 47.1], precipitation_probability_max: [20, 70] } }) }));
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const shot = async (page, name, full) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), fullPage: !!full }); };
const fits = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
// The station shows a step at once; this waits for the server to have it (the load's app copy marked COMPLETE).
async function saved(id) {
  for (let i = 0; i < 100; i++) {
    const rec = (await db().collection('plantJournal').where('recordId', '==', id).get()).docs.map(d => d.data()).find(d => d.createdInApp);
    if (rec && rec.payload && rec.payload.work && rec.payload.work.state === 'COMPLETE') return rec;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(id + ' was not saved as complete');
}
const tabs = (page) => page.$$eval('.ps-tab b', b => b.map(x => x.textContent));
const sizes = (page, sel) => page.$$eval(sel, els => els.map(e => parseFloat(getComputedStyle(e).fontSize)));

(async () => {
  await clear();
  const clock = '2026-10-08T14:00:00Z';
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date(clock) });
  const browser = await chromium.launch();
  const results = [];
  try {
    const page = await openPage(browser, 1024, 768, '/plant-station.html' + MANAGER, clock, true);
    await page.waitForSelector('[data-station="BOXING"]');
    await page.click('[data-station="BOXING"]');
    await page.waitForSelector('#work .sw-card');
    assert.deepEqual(await tabs(page), ['Shipping / Loadout', 'Receiving']);
    // Shipping / Loadout: the box loads and the Scheduler's shipments for today on one list. Sun Valley (849) is a box load
    // and on the Scheduler as a carrier pickup: one card, purple. Aldi (Route Master BRANCH) is a scheduled shipment: green.
    // Fairmont 907_1 (BRANCH) is a box load: green.
    const card = (id) => '#work .sw-card[data-sw="' + id + '"]';
    await page.waitForSelector(card('sch:SCHED-a1') + '.by-branch', { timeout: 15000 });
    await page.waitForSelector('#work .sw-card.by-branch .route:text-is("907_1")');
    assert.equal(await page.$(card('sch:SCHED-s1')), null, 'the Scheduler\'s Sun Valley pickup is worked on the 849 box load card');
    assert.equal(await page.textContent('#work .sw-card.by-carrier .route'), '849');
    assert.deepEqual(await page.$$eval('.sw-legend span', s => s.map(x => x.textContent)), ['Uniontown truck', 'Branch', 'Carrier']);
    assert.ok((await sizes(page, '.sw-legend span, .sw-who, .ps-count')).every(n => n >= 16), 'legend, labels and counts are 16px or more');
    assert.deepEqual(await page.$$eval('.ps-count', c => c.map(x => x.textContent)), ['3 remaining of 3 loads', '1 remaining of 1 delivery']);
    assert.ok(await fits(page), 'Shipping / Loadout fits a 1024 tablet');
    await shot(page, 'boxing-shipping-1024.png');
    // Load the Aldi shipment: start, type the boxes and the temperature, complete.
    await page.click(card('sch:SCHED-a1') + ' [data-act="sstart"]');
    await page.waitForSelector(card('sch:SCHED-a1') + '.run.open .sw-badge:text-is("LOADING")', { timeout: 10000 });
    await page.fill(card('sch:SCHED-a1') + ' [data-k="count"]', '1200');
    await page.fill(card('sch:SCHED-a1') + ' [data-k="temperature"]', '34');
    await shot(page, 'boxing-shipping-open-1024.png');
    await page.click(card('sch:SCHED-a1') + ' [data-act="sdone"]');
    await page.waitForSelector(card('sch:SCHED-a1') + '.done .sw-badge:text-is("COMPLETE")', { timeout: 10000 });
    await page.waitForFunction(() => document.querySelector('.ps-count').textContent === '2 remaining of 3 loads');
    await saved('SCHED-a1');
    await page.click(card('sch:SCHED-a1') + ' .sw-head');
    assert.equal(await page.inputValue(card('sch:SCHED-a1') + ' [data-k="count"]'), '1200', 'the boxes are kept');
    assert.equal(await page.isDisabled(card('sch:SCHED-a1') + ' [data-k="count"]'), true, 'a finished shipment is read only');
    results.push('Boxing: Shipping / Loadout lists box loads and scheduled shipments on one list, colored by Uniontown, branch or carrier; a shipment is loaded and completed');

    // Receiving: the suppliers delivering today.
    await page.click('[data-view="receiving"]');
    await page.waitForSelector('#work .sw-panel-head h2:text-is("Receiving")');
    await page.waitForSelector(card('sch:RECV-v1'));
    assert.match(await page.textContent(card('sch:RECV-v1') + ' .sw-title'), /S01 · VALLEY FARMS MILK CO-OP.*8:00 AM/);
    await shot(page, 'boxing-receiving-1024.png');
    await page.click(card('sch:RECV-v1') + ' [data-act="sstart"]');
    await page.waitForSelector(card('sch:RECV-v1') + '.run.open .sw-badge:text-is("RECEIVING")', { timeout: 10000 });
    await page.fill(card('sch:RECV-v1') + ' [data-k="count"]', '38');
    await page.fill(card('sch:RECV-v1') + ' [data-k="notes"]', 'Two pallets short');
    await page.click(card('sch:RECV-v1') + ' [data-act="sdone"]');
    await page.waitForSelector(card('sch:RECV-v1') + '.done .sw-badge:text-is("RECEIVED")', { timeout: 10000 });
    const got = await saved('RECV-v1');
    assert.deepEqual([got.payload.work.state, got.payload.work.count, got.payload.work.notes], ['COMPLETE', '38', 'Two pallets short']);
    assert.deepEqual(page.errors, []);
    results.push('Boxing: Receiving starts and receives a supplier\'s delivery with the cases in and a note');

    // Yard Services: Trailer Assignments and Yard Checks inside the station, without the app's header and menu.
    await page.click('#change');
    await page.click('[data-station="YARD_SERVICES"]');
    await page.waitForSelector('iframe.sw-frame');
    assert.deepEqual(await tabs(page), ['Trailer Assignments', 'Yard Checks']);
    const ta = page.frameLocator('iframe.sw-frame');
    await ta.locator('[data-trailer]').first().waitFor({ timeout: 15000 });
    assert.equal(await ta.locator('.topbar').isVisible(), false, 'no app header inside the station');
    assert.equal(await ta.locator('.sidemenu').count() ? await ta.locator('.sidemenu').isVisible() : false, false, 'no app menu inside the station');
    assert.equal(await ta.locator('#yard').isVisible(), true, 'the trailer yard shows on a 1024 tablet');
    // Joe 10/12: on a 1024 tablet Run and Driver had shrunk to a letter or two. Every run and driver shows in full.
    const cut = await ta.locator('#rows .ta-row').evaluateAll(rows => rows.flatMap(r => [r.children[1], r.children[2]]).filter(e => e && e.scrollWidth > e.clientWidth + 1).map(e => e.textContent));
    assert.deepEqual(cut, [], 'no run or driver is cut off at 1024');
    assert.ok((await ta.locator('#rows .ta-row').first().evaluate(r => r.children[1].getBoundingClientRect().width)) >= 120, 'the Run column is wide enough to read');
    assert.ok((await ta.locator('.ta-chip').evaluateAll(c => c.map(x => parseFloat(getComputedStyle(x).fontSize)))).every(n => n >= 16), 'the yard\'s trailers are 16px or more');
    await shot(page, 'yard-trailers-1024.png');
    await page.click('[data-view="yardchecks"]');
    await page.waitForSelector('iframe.sw-frame[data-src^="yard.html"]');
    const yc = page.frameLocator('iframe.sw-frame');
    await yc.locator('#bar-current').waitFor({ timeout: 15000 });
    assert.equal(await yc.locator('.topbar').isVisible(), false, 'no app header on Yard Checks inside the station');
    await page.waitForTimeout(800);
    await shot(page, 'yard-checks-1024.png');
    assert.deepEqual(page.errors, []);
    results.push('Yard Services: Trailer Assignments (Run and Driver readable at 1024) and Yard Checks inside the station, without the app header and menu');

    // Joe 10/12: "we do not need to display the depart [time] on this ... this will probably be on a mobile maybe a tablet".
    // Phone, upright tablets and a wide screen: no Depart Time, every word 16px or more, nothing cut off or wider than the
    // screen; on the phone a trailer typed and Enter saves it and moves to the next route, as the old phone version did.
    for (const [w, h] of [[390, 844], [600, 960], [800, 1280], [1536, 864]]) {
      const p2 = await openPage(browser, w, h, '/plant-station.html' + MANAGER + '&station=YARD_SERVICES', clock, w < 1200);
      await p2.waitForSelector('iframe.sw-frame[data-src^="trailers.html"]', { timeout: 15000 });
      const fr = p2.frameLocator('iframe.sw-frame');
      await fr.locator('[data-trailer]').first().waitFor({ timeout: 15000 });
      assert.equal(await fr.locator('.ta-depart').first().isVisible(), false, 'no Depart Time in the station at ' + w);
      const small = await fr.locator('#rows .ta-row > span, .ta-headrow > span, #rows input').evaluateAll(els => els.filter(e => e.offsetParent && e.textContent.trim() || e.tagName === 'INPUT').map(e => parseFloat(getComputedStyle(e).fontSize)).filter(n => n < 16));
      assert.deepEqual(small, [], 'every word is 16px or more at ' + w);
      const over = await fr.locator('#rows .ta-row').evaluateAll(rows => rows.flatMap(r => [...r.children]).filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 1 && !e.querySelector('input')).map(e => e.textContent));
      assert.deepEqual(over, [], 'nothing cut off at ' + w);
      assert.ok(await fits(p2), 'Yard Services fits ' + w);
      if (w === 390) {
        const boxes = fr.locator('#rows [data-trailer]');
        await boxes.nth(1).fill('T-977');
        await boxes.nth(1).press('Enter');
        await p2.waitForFunction(() => { const d = document.querySelector('iframe.sw-frame').contentDocument, a = d.activeElement, all = [...d.querySelectorAll('#rows [data-trailer]')]; return all.indexOf(a) === 2; });
        for (let i = 0; i < 100 && !(await db().collection('runs').get()).docs.some(d => JSON.stringify(d.data()).includes('T-977')); i++) await new Promise(r => setTimeout(r, 100));
        assert.ok((await db().collection('runs').get()).docs.some(d => JSON.stringify(d.data()).includes('T-977')), 'Enter saved the trailer on the phone');
        await shot(p2, 'yard-trailers-390-typed.png');
      }
      await shot(p2, 'yard-trailers-' + w + '.png');
      assert.deepEqual(p2.errors, []);
      await p2.close();
    }
  } finally { await browser.close(); }
  console.log(results.join('\n'));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
