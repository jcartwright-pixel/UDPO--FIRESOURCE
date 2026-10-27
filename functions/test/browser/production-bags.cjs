'use strict';
/*
 * Browser check of the 5-gallon bag fillers and a packing line fed by the fillers (Joe 10/14), end to end:
 *   - Line Targets, Boxing: Fed by: the fillers whose jugs it boxes and the jugs in each box (Joe 10/26: no fill weight check on
 *     Boxing, the product was weighed before it gets there);
 *   - the Raypak tablet: the fill weight check in bags against the product's Target Fill Weight g; the Boxing tablet has none;
 *   - the Boxing tablet and Production Lines: jugs in from the fillers against boxes out × jugs in each box.
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
const GALLON = 'ut_prod_gallon_filler', NEW_HALF = 'ut_prod_new_half_gallon', RAYPAK = 'ut_prod_raypak', BOXING = 'ut_prod_boxing';

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
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); }
async function fits(page, what) {
  const size = await page.evaluate(() => ({ scroll: document.scrollingElement.scrollWidth, inner: window.innerWidth }));
  assert.ok(size.scroll <= size.inner, what + ' has no sideways scrolling: ' + JSON.stringify(size));
}
async function bigText(page, sel, what) {
  const small = await page.$$eval(sel, els => els.flatMap(e => [e, ...e.querySelectorAll('*')]).filter(e => e.offsetParent && e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
    .map(e => [e.tagName + '.' + e.className, parseFloat(getComputedStyle(e).fontSize)]).filter(x => x[1] < 16));
  assert.deepEqual(small, [], what + ': text 16px or larger');
}
const lineDoc = async (id) => (await db().collection('productionLines').doc(id).get()).data() || {};
const runsOf = async (id) => (await db().collection('productionRuns').where('operationId', '==', id).get()).docs.map(d => d.data());
async function until(what, fn) {
  for (let i = 0; i < 150; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 200)); }
  throw new Error('Timed out waiting for ' + what);
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date() });
  // The demo plant has no Raypak or half gallon filler: as Plant Operations keeps them.
  for (const [id, name, seq] of [[RAYPAK, 'RAYPAK', 15], [NEW_HALF, 'NEW 1/2 GALLON', 60]]) {
    await db().collection('plantSetup').doc(id).set({ operationId: id, type: 'PRODUCTION_AREA', status: 'ACTIVE', name, area: name, facilityId: 'fac_uniontown', viewSequence: seq });
  }
  let n = 0;
  const save = (action, fields) => applyAction(db(), { email: 'admin.test@uniteddairy.com' }, Object.assign({ action, requestId: 'bags-' + (++n) + '-' + Date.now() }, fields));
  for (const id of [RAYPAK, BOXING]) await save('saveMachineProducts', { operationId: id, products: [{ name: '5 Gal 2% Dispenser', sku: '90305', fillGrams: 19500, ratePerMin: 10 }] });
  await save('saveMachineProducts', { operationId: GALLON, products: [{ name: 'Broughton 2% Gallon', sku: '50305', fillGrams: 3800, ratePerMin: 74 }] });
  await save('saveMachineProducts', { operationId: NEW_HALF, products: [{ name: 'Broughton 2% Half Gallon', sku: '40305', fillGrams: 1900, ratePerMin: 100 }] });
  // This shift: the Gallon Filler made 300 jugs and the new half gallon filler 150; Boxing boxed 100 boxes.
  const shift = RD.plantShift(null, Date.now());
  const entry = (operationId, fields) => save('saveLineEntry', Object.assign({ operationId, shift }, fields));
  await entry(GALLON, { op: 'product', product: 'Broughton 2% Gallon', sku: '50305' });
  await entry(GALLON, { op: 'count', count: 300 });
  await entry(NEW_HALF, { op: 'product', product: 'Broughton 2% Half Gallon', sku: '40305' });
  await entry(NEW_HALF, { op: 'count', count: 150 });
  for (const id of [RAYPAK, BOXING]) await entry(id, { op: 'product', product: '5 Gal 2% Dispenser', sku: '90305' });
  await entry(BOXING, { op: 'count', count: 100 });
  await save('saveLineSetup', { operationId: RAYPAK, tareGrams: '450', capGrams: '20', fillUnder: '50' });
  const browser = await chromium.launch();
  const results = [];
  try {
    // Line Targets, Boxing: Fed by, and no fill weight check (Joe 10/26).
    const lt = await openPage(browser, 1536, 960, '/linetargets.html?line=' + BOXING + '&' + ADMIN);
    await lt.waitForFunction(() => document.getElementById('form-title').textContent === 'BOXING');
    await lt.waitForSelector('#setup [data-fedby]');
    const setup = await lt.textContent('#setup');
    assert.doesNotMatch(setup, /filled bags weighed in grams|Product in each bag/, 'Boxing has no fill weight check');
    assert.deepEqual(await lt.$$eval('#setup [data-fedby]', b => b.map(x => x.parentElement.textContent.trim())), ['NEW 1/2 GALLON', 'GALLON FILLER'], 'the fillers, not the packing lines or HTST');
    await lt.check('#setup [data-fedby="' + GALLON + '"]');
    await until('Gallon Filler feeds Boxing', async () => String((await lineDoc(BOXING)).fedBy) === GALLON);
    await lt.check('#setup [data-fedby="' + NEW_HALF + '"]');
    await until('both feed Boxing', async () => ((await lineDoc(BOXING)).fedBy || []).length === 2);
    await lt.fill('#setup-perBox', '4');
    await lt.press('#setup-perBox', 'Tab');
    await until('perBox saved', async () => (await lineDoc(BOXING)).perBox === 4);
    await fits(lt, 'Line Targets');
    await bigText(lt, '#setup', 'Line Targets setup');
    await lt.$eval('#setup [data-fedby]', e => e.scrollIntoView({ block: 'center' }));
    await shot(lt, 'bags-line-targets-boxing-1536');
    assert.deepEqual(lt.errors, []);
    await lt.close();
    results.push('Line Targets, Boxing: no fill weight check; Fed by GALLON FILLER and NEW 1/2 GALLON, 4 jugs in each box');

    // The Raypak tablet: bags weighed in grams.
    {
      const tb = await openPage(browser, 1024, 1400, '/line.html?line=' + RAYPAK + '&' + ADMIN);
      await tb.waitForSelector('#fill-box:not([hidden]) input[data-field="jug1"]');
      // Joe 10/26: the Raypak is a bag filler like the fillers: one bag a check with the countdown.
      assert.match(await tb.textContent('#fill-box'), /Bag weight g/);
      await tb.fill('#fill-box input[data-field="jug1"]', '19900');
      await tb.press('#fill-box input[data-field="jug1"]', 'Enter');
      await until('raypak bag saved', async () => (await runsOf(RAYPAK)).some(r => (r.fills || []).length === 1 && r.fills[0].jug1 === 19900));
      await tb.waitForFunction(() => /Last 19,900 g at/.test(document.getElementById('fill-box').textContent));
      assert.match(await tb.textContent('#fill-box'), /−70 g under target, LIGHT/, '19900 - 450 - 20 = 19430, LIGHT under 19,450');
      assert.match(await tb.textContent('#actions'), /CIP/, 'the Raypak keeps CIP / Sanitation');
      await fits(tb, 'raypak tablet');
      await bigText(tb, '#fill-box', 'raypak fill weight check');
      await tb.$eval('#fill-box', e => e.scrollIntoView({ block: 'start' }));
      await shot(tb, 'bags-tablet-raypak-1024');
      assert.deepEqual(tb.errors, []);
      await tb.close();
    }
    // Joe 10/26: the Boxing tablet has no fill weight check and no CIP button; jugs in against boxes stays.
    {
      const tb = await openPage(browser, 1024, 1400, '/line.html?line=' + BOXING + '&' + ADMIN);
      await tb.waitForFunction(() => !document.getElementById('box-strip').hidden && /BOXES MATCH|JUGS NOT BOXED/.test(document.getElementById('box-strip').textContent));
      assert.equal(await tb.$eval('#fill-box', e => e.hidden), true, 'Boxing has no fill weight check');
      assert.deepEqual(await tb.$$eval('#actions button', b => b.map(x => x.dataset.act)), ['board', 'changeover', 'waste', 'check', 'crew', 'notes'], 'no CIP on Boxing');
      const strip = await tb.textContent('#box-strip');
      assert.match(strip, /450 jugs in · 100 boxes × 4 = 400 boxed/);
      assert.match(strip, /50 jugs not boxed yet/);
      assert.match(strip, /From NEW 1\/2 GALLON 150 · GALLON FILLER 300/);
      await bigText(tb, '#box-strip', 'jugs in against boxes');
      await fits(tb, 'boxing tablet');
      await shot(tb, 'bags-tablet-boxing-1024');
      assert.deepEqual(tb.errors, []);
      await tb.close();
    }
    results.push('RAYPAK tablet: bags weighed in grams (19,900 g filled = 19,430 g product, LIGHT); BOXING: no fill weight check or CIP, 450 jugs in · 100 boxes × 4 = 400 boxed, 50 not boxed yet');

    // Production Lines: the card and the shift view.
    const pl = await openPage(browser, 1536, 960, '/production.html?' + ADMIN);
    await pl.waitForFunction(id => /Jugs in 450\s+Boxed 400\s+Not boxed 50/.test(((document.querySelector('.pd-tile[data-line="' + id + '"]') || {}).textContent || '').replace(/ /g, ' ')), BOXING);
    await shot(pl, 'bags-production-lines-1536');
    assert.deepEqual(pl.errors, []);
    await pl.close();
    for (const w of [1536, 1920]) {
      // Joe 10/26: the Boxing page's Jugs and boxes tab; no Fill weight tab (Boxing has no fill weight check).
      const dv = await openPage(browser, w, w === 1536 ? 960 : 1080, '/production.html?line=' + BOXING + '&tab=boxing&' + ADMIN);
      await dv.waitForFunction(() => /Jugs in/.test((document.querySelector('#detail .pm-tabbody') || {}).textContent || '') && !!document.querySelector('#pmtabs [data-pmtab="boxing"]'));
      assert.equal(await dv.$('#pmtabs [data-pmtab="fill"]'), null, 'no Fill weight tab on Boxing');
      const d = (await dv.textContent('#detail .pm-tabbody')).replace(/ /g, ' ');
      assert.match(d, /Jugs in 450\s+Boxes 100 × 4 = 400 jugs boxed\s+Not boxed 50/);
      await fits(dv, 'the Boxing shift view at ' + w);
      await dv.$eval('#detail', e => e.scrollIntoView({ block: 'start' }));
      await shot(dv, 'bags-boxing-shift-' + w);
      assert.deepEqual(dv.errors, []);
      await dv.close();
    }
    results.push('Production Lines: Jugs in 450 · Boxed 400 · Not boxed 50 on the Boxing card; the shift view has the feeding fillers and no fill weight tab');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok -', r));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
