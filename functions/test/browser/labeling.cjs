'use strict';
/*
 * Browser check of Joe's 10/31 Labeling Room (mock-up 3, "United Dairy End Zone"), end to end:
 *   - Line Targets: a filler's Labeling Room tick, belt minutes and bottles on the belt;
 *   - the Labeling Room screen: a panel for each of the three fillers (Old and New Half Gallon, Gallon Filler), the label going on now
 *     and what is next as drop-downs, the code dates, labels still to put on (left to run - the belt), SWITCH LABELS NOW and
 *     "I switched to ... labels";
 *   - the filler's tablet: the Labeling Room box, the countdown to the first new bottle, Hold labels, which turns the Labeling Room's
 *     panel red, and Filler running again.
 * Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');
const RD = require('../../src/reader');
const { applyAction } = require('../../src/actions');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const ADMIN = 'testEmail=admin.test@uniteddairy.com';
const GALLON = 'ut_prod_gallon_filler', NEW_HALF = 'ut_prod_new_half_gallon', OLD_HALF = 'ut_prod_old_half_gallon', BOXING = 'ut_prod_boxing';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, timezoneId: 'America/New_York' });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
async function shot(page, name) { if (SHOTS) { await page.waitForTimeout(1200); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } }
async function fits(page, what) {
  const size = await page.evaluate(() => ({ scroll: document.scrollingElement.scrollWidth, inner: window.innerWidth }));
  assert.ok(size.scroll <= size.inner, what + ' has no sideways scrolling: ' + JSON.stringify(size));
}
const lineDoc = async (id) => (await db().collection('productionLines').doc(id).get()).data() || {};
async function until(what, fn) {
  for (let i = 0; i < 150; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 200)); }
  throw new Error('Timed out waiting for ' + what);
}
const laneText = (page, id) => page.$eval('[data-lane="' + id + '"]', e => e.innerText.replace(/\s+/g, ' '));

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date() });
  // Joe 10/31: the Old Half Gallon filler (also quarts and pints), the New Half Gallon filler and the Gallon Filler.
  for (const [id, name, seq] of [[OLD_HALF, 'OLD 1/2 GALLON', 60], [NEW_HALF, 'NEW 1/2 GALLON', 70]]) {
    await db().collection('plantSetup').doc(id).set({ operationId: id, type: 'PRODUCTION_AREA', status: 'ACTIVE', name, area: name, facilityId: 'fac_uniontown', viewSequence: seq });
  }
  let n = 0;
  const save = (action, fields) => applyAction(db(), { email: 'admin.test@uniteddairy.com' }, Object.assign({ action, requestId: 'label-' + (++n) + '-' + Date.now() }, fields));
  await save('saveMachineProducts', { operationId: OLD_HALF, products: [{ name: 'Chocolate Quart', ratePerMin: 110, shelfLifeDays: 12 }, { name: '1% Pint', ratePerMin: 120, shelfLifeDays: 13 }, { name: '2% Half Gallon', ratePerMin: 100, shelfLifeDays: 14 }] });
  await save('saveMachineProducts', { operationId: NEW_HALF, products: [{ name: '2% Half Gallon', ratePerMin: 100, shelfLifeDays: 14 }, { name: 'Whole Milk Half Gallon', ratePerMin: 100, shelfLifeDays: 14 }] });
  await save('saveMachineProducts', { operationId: GALLON, products: [{ name: 'Skim Gallon', ratePerMin: 74, shelfLifeDays: 15 }, { name: '1% Gallon', ratePerMin: 74, shelfLifeDays: 15 }] });
  const shift = RD.plantShift(null, Date.now());
  const entry = (operationId, op, f) => save('saveLineEntry', Object.assign({ operationId, shift, op }, f));
  for (const [id, prod, qty, count, next, nqty] of [[OLD_HALF, 'Chocolate Quart', 4000, 1140, '1% Pint', 1800], [NEW_HALF, '2% Half Gallon', 4000, 2470, 'Whole Milk Half Gallon', 3000], [GALLON, 'Skim Gallon', 2400, 2100, '1% Gallon', 2400]]) {
    await entry(id, 'product', { product: prod, sku: '' });
    await entry(id, 'qty', { qty: String(qty) });
    await entry(id, 'count', { count: String(count) });
    await entry(id, 'next', { product: next, qty: String(nqty) });
  }
  const browser = await chromium.launch();
  const results = [];
  try {
    // Line Targets: the New Half Gallon filler's Labeling Room box.
    const lt = await openPage(browser, 1536, 960, '/linetargets.html?line=' + NEW_HALF + '&' + ADMIN);
    await lt.waitForSelector('#setup-labelRoom');
    assert.equal(await lt.isChecked('#setup-labelRoom'), true, 'a half gallon filler starts in the Labeling Room');
    for (const [id, k, v] of [[NEW_HALF, 'beltMin', '4'], [NEW_HALF, 'beltHolds', '380']]) {
      await lt.fill('#setup-' + k, v);
      await lt.press('#setup-' + k, 'Tab');
      await until(k + ' saved', async () => String((await lineDoc(id))[k]) === v);
    }
    await lt.locator('#setup-labelRoom').scrollIntoViewIfNeeded();
    await shot(lt, 'labeling-1-line-targets-1536');
    assert.deepEqual(lt.errors, []);
    await lt.close();
    await save('saveLineSetup', { operationId: OLD_HALF, beltMin: '6', beltHolds: '220' });
    await save('saveLineSetup', { operationId: GALLON, beltMin: '4', beltHolds: '410' });
    // Boxing never gets a panel, even ticked by hand (it is not a filler).
    await assert.rejects(save('saveLabelRoom', { operationId: BOXING, op: 'hold' }), /does not get its bottles/);
    results.push('Line Targets keeps each filler\'s Labeling Room tick, belt minutes and bottles on the belt');

    // The Labeling Room: one panel for each filler, in the plant's order.
    const lr = await openPage(browser, 1536, 790, '/labeling.html?' + ADMIN);
    await lr.waitForFunction(() => document.querySelectorAll('[data-lane]').length === 3 && /\d/.test(document.querySelector('[data-lane] .lr-big') ? document.querySelector('[data-lane] .lr-big').textContent : ''));
    assert.deepEqual(await lr.$$eval('[data-lane] h2 span:first-child', e => e.map(x => x.textContent)), ['OLD 1/2 GALLON', 'NEW 1/2 GALLON', 'GALLON FILLER']);
    // New Half Gallon: 4,000 - 2,470 = 1,530 left, 380 on the belt, 1,150 labels still to put on.
    await until('New Half Gallon counts', async () => /Labels still to put on 1,150/i.test(await laneText(lr, NEW_HALF)));
    const nh = await laneText(lr, NEW_HALF);
    assert.match(nh, /380 bottles/i);
    assert.match(nh, /Switch labels in 1,150 bottles/i);
    assert.match(nh, /Code date ?[A-Z]{3} \d\d/i, 'the code date shows');
    assert.equal(await lr.$eval('[data-lane="' + NEW_HALF + '"] [data-pick="labeling"]', s => s.value), '2% Half Gallon');
    assert.equal(await lr.$eval('[data-lane="' + NEW_HALF + '"] [data-pick="next"]', s => s.value), 'Whole Milk Half Gallon');
    // Gallon Filler: 300 left, 410 on the belt: switch labels now.
    assert.match(await laneText(lr, GALLON), /SWITCH LABELS NOW/i);
    const big = await lr.$eval('[data-lane] .lr-code b', e => [parseFloat(getComputedStyle(e).fontSize), getComputedStyle(e).fontWeight]);
    assert.ok(big[0] >= 28 && Number(big[1]) >= 800, 'the code dates are big and bold: ' + big);
    await fits(lr, 'Labeling Room at 1536');
    await shot(lr, 'labeling-2-labeling-room-1536');
    results.push('The Labeling Room shows the three fillers: the label now and next (drop-downs), big bold code dates, labels still to put on and SWITCH LABELS NOW');

    // The Up next drop-down changes the filler's Up next.
    await lr.selectOption('[data-lane="' + OLD_HALF + '"] [data-pick="next"]', '2% Half Gallon');
    await until('Old Half Gallon next', async () => ((await lineDoc(OLD_HALF)).next || {}).product === '2% Half Gallon');
    await entry(OLD_HALF, 'next', { product: '1% Pint', qty: '1800' });
    results.push('Up next at this filler, picked in the Labeling Room, is the filler\'s Up next');

    // I switched: the Gallon Filler's tablet counts down to the first 1% Gallon.
    await lr.click('[data-switch="' + GALLON + '"]');
    await until('switched', async () => ((await lineDoc(GALLON)).labeling || {}).product === '1% Gallon');
    await lr.waitForFunction(id => /First 1% Gallon reaches the filler in/i.test(document.querySelector('[data-lane="' + id + '"]').innerText), GALLON);
    const tab = await openPage(browser, 1536, 790, '/line.html?line=' + GALLON + '&' + ADMIN);
    await tab.waitForSelector('#label-box:not([hidden]) #lr-time');
    const t1 = await tab.textContent('#lr-time');
    assert.match(t1, /^[34]:\d\d$/, 'about 4 minutes: ' + t1);
    assert.match((await tab.innerText('#label-box')).replace(/\s+/g, ' '), /Skim Gallon left, all on the belt 300/i);
    await tab.waitForTimeout(2100);
    assert.notEqual(await tab.textContent('#lr-time'), t1, 'it counts down');
    await fits(tab, 'Gallon Filler tablet at 1536');
    await shot(tab, 'labeling-3-filler-tablet-countdown-1536');
    results.push('I switched starts the filler tablet\'s countdown to the first bottle with the new label');

    // Hold labels on the New Half Gallon tablet: its panel turns red in the Labeling Room.
    const nt = await openPage(browser, 1536, 790, '/line.html?line=' + NEW_HALF + '&' + ADMIN);
    await nt.waitForSelector('#label-box:not([hidden]) [data-lr="hold"]');
    assert.match((await nt.innerText('#label-box')).replace(/\s+/g, ' '), /2% Half Gallon still coming 1,530/i);
    assert.match((await nt.innerText('#label-box')).replace(/\s+/g, ' '), /380 on the belt \+ 1,150 still to label/i);
    await shot(nt, 'labeling-4-filler-tablet-1536');
    await nt.click('[data-lr="hold"]');
    await until('hold', async () => !!(await lineDoc(NEW_HALF)).labelHold);
    await lr.waitForFunction(id => /Filler says: HOLD LABELS/i.test(document.querySelector('[data-lane="' + id + '"]').innerText), NEW_HALF);
    assert.equal(await lr.$eval('[data-lane="' + NEW_HALF + '"]', e => e.classList.contains('red')), true);
    await shot(lr, 'labeling-5-labeling-room-hold-1536');
    await nt.waitForSelector('#label-box [data-lr="resume"]');
    await nt.click('[data-lr="resume"]');
    await until('resume', async () => (await lineDoc(NEW_HALF)).labelHold === null);
    await lr.waitForFunction(id => !/HOLD LABELS/.test(document.querySelector('[data-lane="' + id + '"]').textContent), NEW_HALF);
    results.push('Hold labels on the filler\'s tablet turns its Labeling Room panel red; Filler running again clears it');

    // Laptop and tablet widths: no sideways scrolling.
    for (const [w, h] of [[1920, 1080], [1024, 768], [390, 844]]) {
      const p = await openPage(browser, w, h, '/labeling.html?' + ADMIN);
      await p.waitForFunction(() => document.querySelectorAll('[data-lane]').length === 3);
      await fits(p, 'Labeling Room at ' + w);
      await shot(p, 'labeling-6-labeling-room-' + w);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
    for (const p of [lr, tab, nt]) assert.deepEqual(p.errors, []);
    results.push('The Labeling Room fits at 1920, 1024 and 390 wide');
  } finally {
    await browser.close();
  }
  console.log('Labeling Room browser check passed:\n- ' + results.join('\n- '));
})().catch(e => { console.error(e); process.exit(1); });
