'use strict';
/*
 * Browser check of the Inventory mix (Joe 11-4-26, mock-ups A to F: "I want to do a mix of everything", and "internal inventory on
 * all my milk products ... a separate type"), on the made-up plant week (test/fixtures/plant-demo.js) with made-up products:
 *   A  TAKE OUT on Inventory: how many used and what for; Used goes up, Should have goes down.
 *   E  open to everyone in the plant (a supervisor opens it); LOW AT on each product, a low product is red; Low only; ALL CAPS.
 *      Milk Products is its own type: Bring in our milk products adds the plant's Products list (not Raw Milk), once.
 *   C  USES: what each milk product made uses; what the Production Lines count goes in as Made and takes its uses out by itself,
 *      and a lower count (a typing fix) takes the difference back.
 *   F  LABEL: our own barcode, printed one to a 4 x 6 inch label (window.print is caught here).
 *   B  the Boxing tablet's TAKE OUT tab: a scan of our label takes one out; a new barcode is named once; − puts one back.
 *   D  RECEIVED on the Boxing tablet puts what was scanned on the delivery into Inventory, once.
 *   Joe 11-10-26 (four inventories, its own window): Raw Milk, Cooler, Plant Supplies and Maintenance; Add product with its area;
 *      Area on a line; a scan (or a typed code) finds a product and opens its Count; a barcode not known is tied once in a pop-up;
 *      the Count Walk (type or scan, the difference in red, Save counts, Reset asks first); Low stock comes up in a pop-up by
 *      itself; Inventory opens in its own window from Shipping & Receiving's menu, with only its own menu.
 * Text 16px and up, no sideways scroll at 1536 and 1920 (and the tablet at 1024). Pictures go to SHOTS.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');
const R = require('../../src/plant-rules');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const ADMIN = 'testEmail=admin.test@uniteddairy.com';
const MANAGER = 'testEmail=manager.test@uniteddairy.com';
const SUPER = 'testEmail=super.test@uniteddairy.com';
const SHOTS = process.env.SHOTS || '';
const CLOCK = '2026-10-08T14:00:00Z';
const JUG_UPC = '036000291452';

async function openPage(browser, width, height, url, touch) {
  const page = await browser.newPage(Object.assign({ viewport: { width, height }, serviceWorkers: 'block' }, touch ? { hasTouch: true, isMobile: true } : {}));
  await page.clock.setFixedTime(new Date(CLOCK));
  await page.addInitScript(() => { window.printed = 0; window.print = () => { window.printed++; window.printedLabels = document.querySelectorAll('#labels .lbl').length; }; });
  await localCalls(page);
  // The local server's clock is set to the same made-up day for each save (index.js reads testNow on the emulator only).
  await page.route(/127\.0\.0\.1:5001\/.*\/save$/, (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fallback();
    const body = JSON.parse(req.postData() || '{}');
    body.data = Object.assign({}, body.data, { testNow: CLOCK });
    route.fallback({ postData: JSON.stringify(body) });
  });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (/^small text/.test(m.text())) console.log(m.text()); });
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) }); };
const fits = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
const smallest = (page, sel) => page.$$eval(sel, els => { const t = els.filter(e => e.offsetParent && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())); const m = Math.min(...t.map(e => parseFloat(getComputedStyle(e).fontSize))); if (m < 16) console.log('small text:', t.filter(e => parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.tagName + '.' + e.className + ' ' + getComputedStyle(e).fontSize + ' ' + e.textContent.slice(0, 20)).join(' / ')); return m; });
async function until(fn, what) {
  for (let i = 0; i < 150; i++) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('not saved: ' + what);
}
const items = async () => (await db().collection('receivingItems').get()).docs.map(d => Object.assign({ id: d.id }, d.data()));
const item = async (name) => (await items()).find(i => i.name === name && i.status === 'ACTIVE');
const moves = async () => (await db().collection('inventoryMoves').get()).docs.map(d => d.data());
async function wasp(page, code) {
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.type(code, { delay: 3 });
  await page.keyboard.press('Enter');
}
// A line's cells as read, without the area under the name (checked on its own).
const rowOf = (page, name) => page.$$eval('#oh-rows tr', (r, n) => { const x = r.find(t => t.cells[0] && t.cells[0].textContent.toUpperCase().indexOf(n.toUpperCase()) === 0); return x ? [...x.cells].slice(0, 8).map(c => { const pl = c.querySelector('.inv-place'); return (pl ? c.innerText.replace('\n' + pl.innerText, '') : c.innerText).replace(/\n/g, ' '); }).join(' | ') : ''; }, name);
const placeOf = (page, id) => page.$eval('#oh-rows [data-row="' + id + '"] .inv-place', e => e.innerText);

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date(CLOCK) });
  // Made-up supplies, a made-up Products list and the Gallon Filler.
  const sup = (await db().collection('plantJournal').where('type', '==', R.SUPPLIER_TYPE).get()).docs.map(d => d.data())[0];
  const base = { status: 'ACTIVE', kind: 'Packaging', supplierId: sup.routeId, countQty: null, countAt: '', receivedSince: 0, usedSince: 0, barcodes: [], low: null };
  await db().collection('receivingItems').doc('ITEM-jugs').set(Object.assign({}, base, { name: 'Gallon jugs', unit: 'Each', countQty: 500, countAt: CLOCK, low: 100, barcodes: ['00' + JUG_UPC] }));
  await db().collection('receivingItems').doc('ITEM-caps').set(Object.assign({}, base, { name: 'Gallon caps, blue', unit: 'Each', countQty: 400, countAt: CLOCK }));
  await db().collection('receivingItems').doc('ITEM-bags').set(Object.assign({}, base, { name: 'Dispenser bags, 5 gallon', unit: 'Each', countQty: 2640, countAt: CLOCK }));
  await db().collection('plantProducts').doc('ut_prod_gallon_filler').set({ operationId: 'ut_prod_gallon_filler', line: 'GALLON FILLER', facilityId: 'fac_uniontown',
    products: [{ name: 'Gallon Whole Milk', sku: '1001' }, { name: 'Gallon 2% Milk', sku: '1002' }] });
  await db().collection('plantProducts').doc('ut_prod_htst_1').set({ operationId: 'ut_prod_htst_1', line: 'HTST #1', facilityId: 'fac_uniontown', products: [{ name: 'Raw Milk' }, { name: 'Gallon Whole Milk', sku: '1001' }] });
  await db().collection('productionLines').doc('ut_prod_gallon_filler').set({ operationId: 'ut_prod_gallon_filler', name: 'GALLON FILLER', line: 'GALLON FILLER', facilityId: 'fac_uniontown' });
  // Joe 11-11-26: a jug trailer in the lot with just jugs on it (Plant Material Trailers).
  await db().collection('jugTrailers').doc('fac_uniontown_T-980').set({ facilityId: 'fac_uniontown', company: 'United Dairy', unit: 'T-980', number: 'T-980', inLot: true, location: 'UPPER LOT',
    items: [{ item: 'Gallon jugs', pallets: '1,200', unit: 'Each' }] });
  await db().collection('users').doc('super.test@uniteddairy.com').set({ name: 'Test Supervisor', status: 'ACTIVE', roles: ['SUPERVISOR'], facilities: ['fac_uniontown'] });
  const browser = await chromium.launch();
  const results = [];
  try {
    // ---------- E: a supervisor opens Inventory ----------
    const sv = await openPage(browser, 1536, 790, '/inventory.html?tab=onhand&' + SUPER);
    await sv.waitForFunction(() => /GALLON JUGS/i.test(document.getElementById('oh-rows').innerText));
    assert.equal(!!(await sv.$('#uc-refused')), false, 'Inventory is open to everyone in the plant');
    await sv.close();

    const inv = await openPage(browser, 1536, 790, '/inventory.html?' + ADMIN);
    // Joe 11-12-26 ("action buttons that run across top then be able to click for the categories to see what we want to see
    // below"): one row of buttons across the top, the categories under it with their counts, the picked one's products below.
    await inv.waitForFunction(() => /GALLON JUGS/.test(document.getElementById('oh-rows').innerText));
    assert.equal(await inv.getAttribute('[data-tab="onhand"]', 'aria-selected'), 'true');
    assert.deepEqual(await inv.$$eval('.inv-topbar > *:not([hidden])', b => b.map(x => x.id || x.className)), ['tabs', 'spacer', 'products-open', 'print'], 'the buttons in one row across the top');
    assert.deepEqual(await inv.$$eval('#types button', b => b.map(x => x.dataset.type + ':' + x.getAttribute('aria-selected'))), ['raw:false', 'milk:false', 'supplies:true', 'maint:false', 'own:false']);
    assert.match(await inv.innerText('[data-type="supplies"]'), /^PLANT SUPPLIES\s*\d+$/, 'each category says how many products');
    assert.equal(await inv.innerText('#subs .inv-sub.on'), await inv.innerText('#subs .inv-sub:first-child'), 'All Plant Supplies picked');
    assert.match(await inv.innerText('#subs'), /ALL PLANT SUPPLIES/);
    await inv.click('[data-type="own"]');
    await inv.waitForFunction(() => /NO LISTS OF YOUR OWN YET/.test(document.getElementById('subs').innerText));
    assert.match(inv.url(), /type=own/);
    assert.ok(await smallest(inv, '.inv-topbar *, #types-bar *') >= 16, 'text 16px and up');
    assert.ok(await fits(inv), 'no sideways scroll with the categories');
    await inv.click('[data-type="supplies"]');
    await inv.waitForFunction(() => /GALLON JUGS/.test(document.getElementById('oh-rows').innerText));
    await shot(inv, 'inventory-categories-1536.png');
    assert.equal(await placeOf(inv, 'ITEM-jugs'), 'NO AREA YET');
    await inv.waitForSelector('#oh-rows [data-row="ITEM-jugs"] .inv-trail');
    assert.equal(await inv.innerText('#oh-rows [data-row="ITEM-jugs"] .inv-trail'), 'ON TRAILERS: 1,200 EACH · T-980', 'what the jug trailer in the lot carries');
    assert.ok((await inv.$$eval('#oh-area option', o => o.map(x => x.textContent))).includes('Jug Trailers'));
    // Its own window: the header names Inventory and the menu lists only Inventory's screens.
    assert.match(await inv.innerText('#screen > .topbar .brand small'), /INVENTORY$/);
    // (Read as written: the menu may be folded, which hides its words.)
    assert.deepEqual((await inv.$$eval('.sidemenu a', a => a.map(x => x.textContent.trim()).filter(Boolean))).slice(0, 3), ['Inventory', 'Plant Supplies', 'Raw Milk']);
    assert.equal(await inv.$eval('#tabs', t => getComputedStyle(t).textTransform), 'uppercase', 'ALL CAPS');

    // ---------- A: TAKE OUT by hand ----------
    await inv.click('[data-use="ITEM-bags"]');
    await inv.waitForSelector('#ed-qty');
    assert.deepEqual(await inv.$$eval('#ed-for option', o => o.map(x => x.textContent)), ['', 'GALLON FILLER', 'OTHER'], 'FOR starts blank');
    await inv.fill('#ed-qty', '500');
    await inv.selectOption('#ed-for', 'GALLON FILLER');
    await shot(inv, 'A-take-out-by-hand-1536.png');
    await inv.click('#ed-save');
    await until(async () => (await item('Dispenser bags, 5 gallon')).usedSince === 500, 'the take out');
    await inv.waitForFunction(() => !document.getElementById('ed-qty'));
    assert.match(await rowOf(inv, 'Dispenser bags'), /^DISPENSER BAGS, 5 GALLON \| [A-Z ]+ \| EACH \| 2,640 ON 10-8-26 \| 0 \| −500 \| 2,140 \| SET$/);
    const m1 = (await moves()).find(m => m.itemId === 'ITEM-bags');
    assert.deepEqual([m1.kind, m1.qty, m1.change, m1.forWhat, m1.how, m1.after], ['USED', 500, -500, 'GALLON FILLER', 'HAND', 2140]);
    results.push('A: TAKE OUT 500 dispenser bags for the Gallon Filler: Used −500, Should have 2,140, one History line');

    // ---------- E: LOW AT and Low only ----------
    await inv.click('[data-low="ITEM-caps"]');
    await inv.fill('#ed-qty', '450');
    await inv.press('#ed-qty', 'Enter');
    await until(async () => (await item('Gallon caps, blue')).low === 450, 'the low mark');
    await inv.waitForFunction(() => [...document.querySelectorAll('#oh-rows tr.low')].some(r => /GALLON CAPS/.test(r.innerText)));
    // Joe 11-9-26: a new low product brings up the Low stock pop-up by itself, listed by supplier; Close puts it away until
    // something new goes low, and the red Low stock button opens it again.
    await inv.waitForSelector('#pop:not([hidden])');
    assert.equal(await inv.innerText('#pop-title'), 'LOW STOCK');
    assert.match(await inv.innerText('#pop'), /GALLON CAPS, BLUE[\s\S]*PLANT SUPPLIES[\s\S]*400 EACH[\s\S]*450/);
    assert.ok(await smallest(inv, '#pop *') >= 16, 'text 16px and up');
    await shot(inv, 'G-low-stock-pop-up-1536.png');
    await inv.click('#pop [data-pop="2"]');
    await inv.waitForSelector('#pop', { state: 'hidden' });
    assert.equal(await inv.innerText('#low-pop'), 'LOW STOCK (1)');
    await inv.reload();
    await inv.waitForFunction(() => /GALLON CAPS/.test(document.getElementById('oh-rows').innerText));
    await inv.waitForTimeout(500);
    assert.equal(await inv.isVisible('#pop'), false, 'not again until something new goes low');
    assert.equal(await inv.innerText('#oh-low'), 'LOW ONLY (1)');
    await inv.click('#oh-low');
    await inv.waitForFunction(() => document.querySelectorAll('#oh-rows tr').length === 1);
    assert.equal(await inv.getAttribute('#oh-low', 'aria-pressed'), 'true');
    await shot(inv, 'E-low-only-1536.png');
    await inv.click('#oh-low');
    results.push('E: LOW AT 450 on the caps turns the row red; Low only shows just it');

    // ---------- The plant's own lists (Joe 11-12-26) ----------
    await inv.click('[data-lists="ITEM-caps"]');
    await inv.fill('#ed-qty', 'caps, Gallon  line');
    await inv.click('#ed-save');
    await until(async () => JSON.stringify((await item('Gallon caps, blue')).lists) === JSON.stringify(['caps', 'Gallon line']), 'the lists');
    await inv.waitForFunction(() => !document.getElementById('ed-qty'));
    await inv.click('[data-type="own"]');
    await inv.waitForSelector('[data-sub-list="caps"]');
    assert.match(await inv.innerText('[data-sub-list="caps"]'), /^CAPS\s*1\s*1 LOW$/);
    await inv.click('[data-sub-list="caps"]');
    await inv.waitForFunction(() => document.querySelectorAll('#oh-rows tr').length === 1 && /GALLON CAPS/.test(document.getElementById('oh-rows').innerText));
    assert.equal(await inv.getAttribute('[data-sub-list="caps"]', 'aria-pressed'), 'true');
    assert.match(inv.url(), /list=caps/);
    await inv.click('[data-type="supplies"]');
    await inv.waitForFunction(() => /GALLON JUGS/.test(document.getElementById('oh-rows').innerText));
    assert.doesNotMatch(inv.url(), /list=/);
    results.push('Categories: buttons across the top, categories under them; CAPS typed on the blue caps makes a list under My Lists showing only them');

    // ---------- Milk Products: its own type ----------
    await inv.click('[data-type="milk"]');
    await inv.waitForFunction(() => /NO MILK PRODUCTS YET/.test(document.getElementById('oh-rows').innerText));
    assert.match(inv.url(), /type=milk/);
    assert.equal(await inv.isVisible('#oh-supplier'), false, 'no supplier filter on milk products');
    await inv.click('#milk-add');
    await until(async () => (await items()).filter(R.isMilk).length === 2, 'the milk products');
    assert.deepEqual((await items()).filter(R.isMilk).map(i => i.name + ':' + i.unit).sort(), ['Gallon 2% Milk:Cases', 'Gallon Whole Milk:Cases'], 'every product once, not Raw Milk');
    await inv.waitForFunction(() => document.querySelectorAll('#oh-rows tr').length === 2);
    assert.deepEqual(await inv.$$eval('#oh-rows tr', r => r.map(x => x.cells[0].innerText.split('\n')[0])), ['GALLON 2% MILK', 'GALLON WHOLE MILK']);
    assert.equal(await inv.innerText('#oh-col5'), 'MADE');
    results.push('Cooler: Bring in our milk products adds the 2 on the Products list (not Raw Milk), counted in cases');

    // ---------- C: USES, then the line's count takes them out by itself ----------
    const whole = await item('Gallon Whole Milk');
    await inv.click('[data-uses="' + whole.id + '"]');
    await inv.waitForSelector('#oh-panel:not([hidden]) #u-add');
    assert.equal(await inv.isVisible('#oh-sheet'), false, 'USES opens in the page in place of the list');
    await inv.click('#u-add');
    await inv.selectOption('[data-urow="0"][data-uf="itemId"]', 'ITEM-jugs');
    await inv.fill('[data-urow="0"][data-uf="qty"]', '1');
    await inv.click('#u-add');
    await inv.selectOption('[data-urow="1"][data-uf="itemId"]', 'ITEM-caps');
    await inv.fill('[data-urow="1"][data-uf="qty"]', '1');
    assert.ok(await smallest(inv, '#oh-panel *') >= 16, 'text 16px and up');
    await shot(inv, 'C-uses-1536.png');
    await inv.click('#u-save');
    await until(async () => ((await item('Gallon Whole Milk')).uses || []).length === 2, 'the uses');
    await inv.waitForSelector('#oh-sheet:not([hidden])');
    assert.match(await rowOf(inv, 'Gallon Whole Milk'), /^GALLON WHOLE MILK \| 2 THINGS \| CASES/);
    // The Gallon Filler counts 120, then 150, then a typing fix to 140.
    const run = db().collection('productionRuns').doc('ut_prod_gallon_filler__2026-10-08_1');
    const from = '2026-10-08T12:00:00Z';
    await run.set({ operationId: 'ut_prod_gallon_filler', line: 'GALLON FILLER', facilityId: 'fac_uniontown', shiftKey: '2026-10-08_1', shiftName: 'First', date: '2026-10-08',
      product: 'Gallon Whole Milk', runs: [{ product: 'Gallon Whole Milk', from }], count: 120, counts: [{ at: '2026-10-08T13:00:00Z', count: 120 }] });
    await until(async () => (await item('Gallon Whole Milk')).madeSince === 120, 'the cases made going in');
    await until(async () => (await item('Gallon jugs')).usedSince === 120 && (await item('Gallon caps, blue')).usedSince === 120, 'the uses coming out');
    await run.set({ count: 150, counts: [{ at: '2026-10-08T13:00:00Z', count: 120 }, { at: '2026-10-08T13:30:00Z', count: 150 }] }, { merge: true });
    await until(async () => (await item('Gallon Whole Milk')).madeSince === 150 && (await item('Gallon jugs')).usedSince === 150, 'the next count');
    await run.set({ count: 140, counts: [{ at: '2026-10-08T13:00:00Z', count: 120 }, { at: '2026-10-08T13:30:00Z', count: 140 }] }, { merge: true });
    await until(async () => (await item('Gallon Whole Milk')).madeSince === 140 && (await item('Gallon jugs')).usedSince === 140, 'the typing fix');
    await inv.waitForFunction(() => [...document.querySelectorAll('#oh-rows tr')].some(r => /^GALLON WHOLE MILK/.test(r.innerText) && r.cells[4].innerText === '+140'));
    await shot(inv, 'milk-products-1536.png');
    const prodMoves = (await moves()).filter(m => m.how === 'PRODUCTION');
    assert.deepEqual(prodMoves.filter(m => m.itemName === 'Gallon jugs').map(m => m.change).sort((a, b) => a - b), [-120, -30, 10]);
    assert.deepEqual(prodMoves.filter(m => m.kind === 'MADE').map(m => m.change).sort((a, b) => a - b), [-10, 30, 120]);
    results.push('C: Gallon Whole Milk uses 1 jug and 1 cap; the Gallon Filler counting 120, 150, then 140 puts 140 in as Made and takes 140 jugs and caps out');

    // ---------- F: LABEL on the Zebra ----------
    await inv.click('[data-type="supplies"]');
    await inv.waitForSelector('[data-label="ITEM-jugs"]');
    await inv.click('[data-label="ITEM-jugs"]');
    await inv.waitForSelector('#oh-panel:not([hidden]) #l-print');
    await inv.fill('#l-count', '3');
    await inv.fill('#l-lot', 'c2610a');
    await shot(inv, 'F-labels-1536.png');
    await inv.click('#l-print');
    await inv.waitForFunction(() => window.printed === 1);
    assert.equal(await inv.evaluate(() => window.printedLabels), 3, 'one label each');
    const code = (await item('Gallon jugs')).labelCode;
    assert.match(code, /^UD[A-Z2-9]{6}$/);
    assert.ok((await item('Gallon jugs')).barcodes.includes('TEXT:' + code), 'a scan of the label finds the product');
    results.push('F: Print labels gives Gallon jugs its own code ' + code + ' and prints 3 labels (4 x 6, one each)');

    // ---------- Joe 11-10-26: Area, Add product, scan or type, the Count Walk ----------
    await inv.click('#p-back');   // the labels screen back to the list
    await inv.waitForSelector('#oh-sheet:not([hidden])');
    await inv.click('[data-place="ITEM-jugs"]');
    await inv.waitForSelector('#ed-spot');
    assert.ok((await inv.$$eval('#area-list option', o => o.map(x => x.value))).includes('Dry Storage'));
    await inv.fill('#ed-qty', 'Packaging');
    await inv.fill('#ed-spot', 'Aisle 3');
    await inv.press('#ed-spot', 'Enter');
    await until(async () => (await item('Gallon jugs')).area === 'Packaging', 'the area');
    await inv.waitForFunction(() => /AISLE 3/.test((document.querySelector('[data-row="ITEM-jugs"] .inv-place') || {}).innerText || ''));
    assert.equal(await placeOf(inv, 'ITEM-jugs'), 'PACKAGING · AISLE 3');
    // Maintenance: a part with no supplier, added here with its area.
    await inv.click('[data-type="maint"]');
    await inv.waitForFunction(() => /NOTHING IN MAINTENANCE YET/.test(document.getElementById('oh-rows').innerText));
    assert.match(inv.url(), /type=maint/);
    await inv.click('#item-add');
    await inv.waitForSelector('[data-af="name"]');
    await inv.fill('[data-af="name"]', 'Bearing 6204');
    await inv.selectOption('[data-af="kind"]', 'Maintenance Part');
    await inv.selectOption('[data-af="unit"]', 'Each');
    await inv.fill('[data-af="area"]', 'Parts Room');
    await inv.fill('[data-af="spot"]', 'Bin 12');
    await inv.fill('[data-af="low"]', '4');
    assert.ok(await smallest(inv, '#oh-panel *') >= 16, 'text 16px and up');
    await shot(inv, 'H-add-maintenance-part-1536.png');
    await inv.click('#a-save');
    await until(async () => !!(await item('Bearing 6204')), 'the part');
    const part = await item('Bearing 6204');
    assert.deepEqual([part.kind, part.unit, part.area, part.spot, part.low, part.supplierId], ['Maintenance Part', 'Each', 'Parts Room', 'Bin 12', 4, '']);
    await inv.waitForFunction(() => /BEARING 6204/.test(document.getElementById('oh-rows').innerText));
    // It has a Low at and nothing counted yet, so it is low: the pop-up comes up by itself, under No supplier.
    await inv.waitForSelector('#pop:not([hidden])');
    assert.match(await inv.innerText('#pop'), /NO SUPPLIER[\s\S]*BEARING 6204[\s\S]*MAINTENANCE/);
    await inv.click('#pop [data-pop="2"]');
    assert.equal(await inv.innerText('#low-pop'), 'LOW STOCK (2)');
    // A scan with nothing being typed finds the jugs, opens Plant Supplies and its Count.
    await wasp(inv, JUG_UPC);
    await inv.waitForFunction(() => !!document.querySelector('#oh-rows tr.counting[data-row="ITEM-jugs"]'));
    assert.doesNotMatch(inv.url(), /type=/, 'back on Plant Supplies');
    assert.equal(await inv.getAttribute('[data-type="supplies"]', 'aria-selected'), 'true');
    await inv.click('#ed-cancel');
    // A barcode not known yet: the pop-up ties it to a product, once. (Another barcode than the tablet's below, which must still
    // be unknown there.)
    await inv.fill('#oh-search', '5901234123457');
    await inv.press('#oh-search', 'Enter');
    await inv.waitForTimeout(300);
    assert.equal(await inv.isVisible('#pop'), false, 'a typed number that no product has just finds by name');
    await inv.fill('#oh-search', '');
    await wasp(inv, '5901234123457');
    await inv.waitForSelector('#pop:not([hidden]) #tie-item');
    assert.equal(await inv.innerText('#pop-title'), 'BARCODE NOT KNOWN YET');
    await inv.selectOption('#tie-item', 'ITEM-bags');
    await inv.click('#pop [data-pop="0"]');
    await until(async () => (await item('Dispenser bags, 5 gallon')).barcodes.length === 1, 'the tied barcode');
    await inv.waitForFunction(() => !!document.querySelector('#oh-rows tr.counting[data-row="ITEM-bags"]'));
    await inv.click('#ed-cancel');
    results.push('Joe 11-10-26: Area on the jugs (Packaging, Aisle 3); Add product puts Bearing 6204 in Maintenance with no supplier; a scan opens the jugs\' Count; an unknown barcode is tied to the bags in a pop-up');

    // The Count Walk: Plant Supplies, every area; type two counts, scan the third.
    await inv.click('[data-tab="walk"]');
    await inv.waitForFunction(() => document.querySelectorAll('#w-rows [data-walk]').length === 3);
    assert.equal(await inv.isVisible('#types-bar'), true);
    assert.equal(await inv.isDisabled('#w-save'), true, 'nothing to save yet');
    const caps = await item('Gallon caps, blue'), bags = await item('Dispenser bags, 5 gallon');
    await inv.fill('[data-walk="ITEM-caps"]', String(R.shouldHave(caps)));
    await inv.fill('[data-walk="ITEM-bags"]', String(R.shouldHave(bags) - 15));
    await inv.waitForFunction(() => document.querySelector('[data-diff="ITEM-bags"]').innerText === '−15');
    assert.equal(await inv.innerText('[data-diff="ITEM-caps"]'), 'SAME');
    assert.equal(await inv.$eval('[data-diff="ITEM-bags"]', e => getComputedStyle(e).color), 'rgb(180, 35, 24)', 'a difference is red');
    await inv.evaluate(() => document.activeElement.blur());
    await wasp(inv, JUG_UPC);
    await inv.waitForFunction(() => document.activeElement && document.activeElement.dataset.walk === 'ITEM-jugs');
    await inv.keyboard.type('300');
    await inv.keyboard.press('Enter');
    assert.equal(await inv.innerText('#w-save'), 'SAVE COUNTS (3)');
    // The counts survive a reload (kept until they are sent); Reset asks first, Cancel keeps them.
    await inv.reload();
    await inv.waitForFunction(() => document.querySelectorAll('#w-rows [data-walk]').length === 3);
    assert.equal(await inv.inputValue('[data-walk="ITEM-jugs"]'), '300');
    await inv.click('#w-reset');
    await inv.waitForSelector('#pop:not([hidden])');
    assert.match(await inv.innerText('#pop'), /CLEAR EVERYTHING NOT SENT YET\?/);
    await inv.click('#pop [data-pop="1"]');
    assert.equal(await inv.inputValue('[data-walk="ITEM-jugs"]'), '300', 'Cancel keeps them');
    assert.ok(await smallest(inv, '#tab-walk *') >= 16, 'text 16px and up');
    await shot(inv, 'I-count-walk-1536.png');
    const jugsWas = R.shouldHave(await item('Gallon jugs'));
    await inv.click('#w-save');
    await until(async () => (await item('Gallon jugs')).countQty === 300 && (await item('Dispenser bags, 5 gallon')).countQty === R.shouldHave(bags) - 15, 'the walk');
    const walked = (await moves()).filter(m => m.how === 'WALK');
    assert.deepEqual(walked.map(m => m.itemId + ':' + m.change).sort(), ['ITEM-bags:-15', 'ITEM-caps:0', 'ITEM-jugs:' + (300 - jugsWas)].sort());
    await inv.waitForSelector('#pop:not([hidden])');
    assert.equal(await inv.innerText('#pop-title'), 'COUNTS SAVED');
    await inv.click('#pop [data-pop="0"]');
    await inv.waitForFunction(() => document.getElementById('w-save').disabled);
    // Reset clears counts not sent.
    await inv.fill('[data-walk="ITEM-caps"]', '1');
    await inv.click('#w-reset');
    await inv.click('#pop [data-pop="0"]');
    await inv.waitForFunction(() => document.querySelector('[data-walk="ITEM-caps"]').value === '');
    assert.equal(await inv.evaluate(() => Object.keys(localStorage).filter(k => /^udInvWalk_/.test(k)).length), 0, 'nothing kept');
    results.push('Count Walk: caps the same, bags 15 short (red), jugs scanned and typed; kept through a reload; Reset asks first; Save counts saves all 3 as counts');

    // History: every way in and out.
    await inv.click('[data-tab="history"]');
    await inv.waitForFunction(() => document.querySelectorAll('#h-rows tr').length >= 8);
    const hist = await inv.$$eval('#h-rows tr', r => r.map(x => [2, 3, 4].map(i => x.cells[i].innerText.replace(/\n/g, ' ')).join(' | ')));
    assert.ok(hist.includes('DISPENSER BAGS, 5 GALLON | USED TYPED IN | −500'), hist.join('\n'));
    assert.ok(hist.includes('GALLON WHOLE MILK | MADE BY THE PRODUCTION LINES | +120'), hist.join('\n'));
    assert.ok(hist.includes('GALLON JUGS | PUT BACK BY THE PRODUCTION LINES | +10'), hist.join('\n'));
    for (const [w, h] of [[1536, 790], [1920, 1080]]) {
      await inv.setViewportSize({ width: w, height: h });
      for (const t of ['onhand', 'walk', 'history']) {
        await inv.click('[data-tab="' + t + '"]');
        await inv.waitForTimeout(200);
        assert.ok(await smallest(inv, '#tab-' + t + ' *, .inv-tabs *') >= 16, 'text 16px and up');
        assert.ok(await fits(inv), 'no sideways scroll at ' + w + ' on ' + t);
      }
      await shot(inv, 'inventory-on-hand-' + w + '.png');
    }
    assert.deepEqual(inv.errors, []);
    await inv.close();

    // ---------- Its own window (Joe 11-10-26) ----------
    const sr = await openPage(browser, 1536, 790, '/scheduler.html?lane=receiving&' + ADMIN);
    await sr.waitForSelector('.side-flyouts a[href="inventory.html"]', { state: 'attached' });
    const [own] = await Promise.all([sr.waitForEvent('popup'), sr.evaluate(() => document.querySelector('.side-flyouts a[href="inventory.html"]').click())]);
    await own.waitForLoadState();
    assert.match(own.url(), /\/inventory\.html\?.*plant=fac_uniontown/);
    assert.match(sr.url(), /scheduler\.html/, 'Shipping & Receiving stays where it was');
    await own.close();
    await sr.close();
    results.push('Its own window: Inventory in Shipping & Receiving\'s menu opens a new tab on the same plant');

    // ---------- B: the Boxing tablet's TAKE OUT tab ----------
    const tab = await openPage(browser, 1024, 768, '/plant-station.html?' + MANAGER, true);
    await tab.waitForSelector('[data-station="BOXING"]');
    await tab.click('[data-station="BOXING"]');
    await tab.waitForSelector('[data-view="takeout"]');
    await tab.click('[data-view="takeout"]');
    await tab.waitForSelector('.to-panel [data-scan-box]');
    await tab.selectOption('[data-to="for"]', 'GALLON FILLER');
    await wasp(tab, code);
    await until(async () => (await moves()).some(m => m.itemId === 'ITEM-jugs' && m.how === 'SCAN' && m.qty === 1), 'the scan out');
    await tab.waitForFunction(() => /GALLON JUGS/.test(document.querySelector('.to-table').innerText));
    // A barcode the app does not know: which product is it? once.
    await wasp(tab, '4006381333931');
    await tab.waitForSelector('[data-to="name"]');
    await tab.selectOption('[data-to="name"]', 'ITEM-caps');
    await until(async () => (await moves()).some(m => m.itemId === 'ITEM-caps' && m.how === 'SCAN'), 'the named scan');
    assert.ok((await item('Gallon caps, blue')).barcodes.length === 1, 'the barcode is known from now on');
    await wasp(tab, '4006381333931');
    await until(async () => (await moves()).filter(m => m.itemId === 'ITEM-caps' && m.how === 'SCAN').length === 2, 'the second scan');
    await tab.waitForFunction(() => [...document.querySelectorAll('.to-table tr')].some(r => /GALLON CAPS/.test(r.innerText) && /\b2\b/.test(r.cells[1].innerText)));
    assert.ok(await smallest(tab, '.to-panel *') >= 16, 'text 16px and up');
    assert.ok(await fits(tab), 'no sideways scroll on the tablet');
    await shot(tab, 'B-tablet-take-out-1024.png');
    // − puts one back.
    await tab.click('.to-table tr:has-text("GALLON CAPS") [data-to="back"]');
    await until(async () => (await moves()).some(m => m.itemId === 'ITEM-caps' && m.qty === -1), 'the put back');
    await tab.waitForFunction(() => [...document.querySelectorAll('.to-table tr')].some(r => /GALLON CAPS/.test(r.innerText) && r.cells[1].innerText.trim().indexOf('1 ') === 0));
    // By hand on the tablet.
    const bagsUsed = (await item('Dispenser bags, 5 gallon')).usedSince || 0;   // the Count Walk above started it over
    await tab.selectOption('[data-to="pick"]', 'ITEM-bags');
    await tab.fill('[data-to="qty"]', '25');
    await tab.click('[data-to="take"]');
    await until(async () => (await item('Dispenser bags, 5 gallon')).usedSince === bagsUsed + 25, 'the hand take out');
    results.push('B: the tablet\'s TAKE OUT: our label scanned takes 1 jug out; a new barcode named once then counted; − puts one back; 25 bags by hand');

    // ---------- D: RECEIVED on the tablet goes into Inventory ----------
    await tab.click('[data-view="receiving"]');
    const card = '#work .sw-card[data-sw="sch:RECV-v1"]';
    await tab.waitForSelector(card);
    await tab.click(card + ' [data-act="sstart"]');
    await tab.waitForSelector(card + '.run.open .rv-box input[data-scan-box]', { timeout: 10000 });
    await wasp(tab, JUG_UPC);
    await wasp(tab, JUG_UPC);
    await until(async () => (await db().collection('receivingScans').get()).docs.some(d => d.data().count === 2), 'the receiving scans');
    const jugsBefore = await item('Gallon jugs');
    await tab.click(card + ' [data-act="sdone"]');
    await until(async () => (await item('Gallon jugs')).receivedSince === (jugsBefore.receivedSince || 0) + 2, 'RECEIVED into Inventory');
    await tab.waitForFunction((c) => /IN INVENTORY/.test(document.querySelector(c + ' .sw-title small').textContent), card);
    await tab.click(card + ' [data-toggle]');
    await tab.waitForSelector(card + ' .rv-inv');
    const recv = (await moves()).filter(m => m.how === 'TABLET');
    assert.deepEqual(recv.map(m => m.itemName + ':' + m.qty), ['Gallon jugs:2']);
    const load = (await db().collection('plantJournal').where('recordId', '==', 'RECV-v1').get()).docs.map(d => d.data()).sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)))[0];
    assert.equal(load.payload.received.from, 'TABLET');
    await shot(tab, 'D-tablet-received-1024.png');
    assert.deepEqual(tab.errors, []);
    await tab.close();
    results.push('D: two jugs scanned on the Boxing tablet and RECEIVED put +2 into Inventory, once');
  } finally { await browser.close(); }
  console.log(results.join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
