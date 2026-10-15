'use strict';
/*
 * Browser check of the half gallon fillers' label scanners (Joe 10/15, "b": both have a UPC label scanner like the Gallon
 * Filler): the tablets before (counts typed) and after the half-gallon-label-readers load sets Counted by = Label reader, with
 * scans read the way the line PC sends them: each scan counts, the UPC picks the product, the code date is checked, and a
 * label not on the line shows WRONG LABEL. Pictures go to SHOTS_DIR.
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
const P = require('../../src/production-rules');
const DL = require('../../src/data-loads');
const { applyAction } = require('../../src/actions');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const ADMIN = 'testEmail=admin.test@uniteddairy.com';
const NEW_HALF = 'ut_prod_new_half_gallon', OLD_HALF = 'ut_prod_old_half_gallon';

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
  for (const [id, name, seq] of [[NEW_HALF, 'NEW 1/2 GALLON', 60], [OLD_HALF, 'OLD 1/2 GALLON', 70]]) {
    await db().collection('plantSetup').doc(id).set({ operationId: id, type: 'PRODUCTION_AREA', status: 'ACTIVE', name, area: name, facilityId: 'fac_uniontown', viewSequence: seq });
  }
  let n = 0;
  const save = (action, fields) => applyAction(db(), { email: 'admin.test@uniteddairy.com' }, Object.assign({ action, requestId: 'half-' + (++n) + '-' + Date.now() }, fields));
  const PRODUCTS = [{ name: 'Broughton 2% Half Gallon', sku: '40305', upc: '070852403053', shelfLifeDays: 17, fillGrams: 1900, ratePerMin: 100 },
    { name: 'Broughton Chocolate Half Gallon', sku: '40405', upc: '070852404050', shelfLifeDays: 17, ratePerMin: 100 }];
  for (const id of [NEW_HALF, OLD_HALF]) await save('saveMachineProducts', { operationId: id, products: PRODUCTS });
  const shift = RD.plantShift(null, Date.now()), code = P.codeDate(shift.date, 17);
  const browser = await chromium.launch();
  const results = [];
  const tablet = async (id, name, check) => {
    const tb = await openPage(browser, 1024, 1300, '/line.html?line=' + id + '&' + ADMIN);
    await tb.waitForFunction(check);
    await fits(tb, name);
    await bigText(tb, '#date-check', name + ' label strip');
    await shot(tb, name);
    assert.deepEqual(tb.errors, []);
    return tb;
  };
  try {
    // Before: counts typed on the tablet.
    for (const id of [NEW_HALF, OLD_HALF]) await save('saveLineEntry', { operationId: id, shift, op: 'product', product: 'Broughton 2% Half Gallon', sku: '40305' });
    const before = await tablet(NEW_HALF, 'half-reader-before-new-1024', () => /Counts typed on this tablet/.test(document.body.innerText) && /Broughton 2% Half Gallon/.test(document.body.innerText));
    assert.ok(await before.$('[data-act="count"], #count-btn, button'), 'typed counting has its buttons');
    await before.close();
    results.push('Before: NEW 1/2 GALLON counted by typing');

    // The load: both half gallon fillers counted by their label scanner (test copy only).
    assert.match((await DL.runDataLoads(db(), {}))[DL.HALF_READERS_ID].skipped, /test copy only/);
    assert.deepEqual((await DL.runDataLoads(db(), { project: 'ud-distribution-sandbox' }))[DL.HALF_READERS_ID], { set: ['NEW 1/2 GALLON', 'OLD 1/2 GALLON'], kept: [] });
    for (const id of [NEW_HALF, OLD_HALF]) assert.equal((await lineDoc(id)).counter, 'READER');

    // After: scans from the line PC. NEW: 120 chocolate cartons (the UPC switches the product), right code date.
    await RD.applyReads(db(), NEW_HALF, Array.from({ length: 120 }, () => ({ upc: '070852404050', date: code })));
    const nw = await tablet(NEW_HALF, 'half-reader-after-new-1024', () => /LABEL MATCHES/.test(document.getElementById('date-check').textContent) && /CODE DATE OK/.test(document.getElementById('date-check').textContent));
    const strip = await nw.textContent('#date-check');
    assert.match(strip, /Broughton Chocolate Half Gallon/, 'the UPC picked the product');
    assert.match(await nw.textContent('#prod-pill'), /READ FROM JUG LABEL \(UPC\)/);
    assert.equal(await nw.$('#fill-box[hidden]'), null, 'the fill weight check stays');
    await nw.close();
    const runNew = (await runsOf(NEW_HALF))[0];
    assert.deepEqual([runNew.product, runNew.count], ['Broughton Chocolate Half Gallon', 120]);
    // OLD: 80 good, then a label that is not on the line.
    await RD.applyReads(db(), OLD_HALF, Array.from({ length: 80 }, () => ({ upc: '070852403053', date: code })).concat([{ upc: '070852999990', date: code }]));
    const od = await tablet(OLD_HALF, 'half-reader-after-old-wrong-label-1024', () => /WRONG LABEL/.test(document.getElementById('date-check').textContent));
    assert.match(await od.textContent('#date-check'), /UPC 070852999990.*is not one of this line's products/);
    await od.close();
    const runOld = (await runsOf(OLD_HALF))[0];
    assert.deepEqual([runOld.count, runOld.reader.unknown, runOld.product], [81, 1, 'Broughton 2% Half Gallon'], 'every carton through counts; the wrong label is flagged and does not change the product');
    results.push('After the load: both half gallon fillers counted by their label scanner; NEW 1/2 GALLON 120 chocolate cartons, the UPC switched the product, code date OK; OLD 1/2 GALLON shows WRONG LABEL for a UPC not on its list');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok -', r));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
