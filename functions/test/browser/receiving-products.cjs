'use strict';
/*
 * Browser check of Receiving's Suppliers & Products, a load with several products, checking it in with the scanner, and
 * Inventory (Joe 11/1, mock-up 2), on the made-up plant week (test/fixtures/plant-demo.js).
 *   - Receiving has no Shipping | Receiving switch; its Calendar and Suppliers & Products are tabs.
 *   - Suppliers & Products: ＋ Supplier opens in the page (no overlay); ＋ Add Product puts a new line at the top of the list with
 *     its drop-downs blank; Edit changes a product; Remove takes it off with a second press.
 *   - Add Load: a PO number and two products, each with what was ordered; the calendar reads its products.
 *   - Check-in: a barcode the app does not know asks which product it is once, then counts; the same barcode again adds one.
 *     Mark Received puts each product's received count into Inventory, once.
 *   - Inventory: On Hand shows Should have; Count is the manual override; History lists each change.
 * Text 16px and up, no sideways scroll at 1536 and 1920. Pictures go to SHOTS.
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
const MANAGER = 'testEmail=manager.test@uniteddairy.com';
const ADMIN = 'testEmail=admin.test@uniteddairy.com';
const SHOTS = process.env.SHOTS || '';
const CLOCK = '2026-10-08T14:00:00Z';
const CAP_BARCODE = '4006381333931';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block' });
  await page.clock.setFixedTime(new Date(CLOCK));
  await localCalls(page);
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
const itemNamed = async (name) => (await items()).find(i => i.name === name && i.status === 'ACTIVE');
const receivingLoads = async () => (await db().collection('plantJournal').where('type', '==', 'PLANT_RECEIVING').get()).docs.map(d => d.data());

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date(CLOCK) });
  const browser = await chromium.launch();
  const results = [];
  try {
    // ---------- Receiving: no switch; Calendar | Suppliers & Products ----------
    const page = await openPage(browser, 1536, 790, '/scheduler.html?lane=receiving&view=month&date=2026-10-08&' + MANAGER);
    await page.waitForFunction(() => /Valley Farms/i.test(document.getElementById('body').textContent));
    assert.equal(await page.$('[data-lane]'), null, 'Joe 11/1: no Shipping | Receiving switch (the left menu has each)');
    assert.deepEqual(await page.$$eval('#rtabs:not([hidden]) [data-rtab]', b => b.map(x => x.textContent + ':' + x.getAttribute('aria-selected'))), ['Calendar:true', 'Suppliers & Products:false']);
    await shot(page, '1-receiving-calendar-1536.png');
    await page.click('[data-rtab="products"]');
    await page.waitForSelector('.sc-prodsplit');
    assert.match(page.url(), /view=products/);
    assert.equal(await page.textContent('#range'), 'Suppliers & Products');
    assert.deepEqual(await page.$$eval('.sc-suppick button strong', b => b.map(x => x.textContent)), ['Mountain Sugar']);

    // ＋ Supplier opens in the page, not over it.
    await page.click('#supplier-add');
    await page.waitForSelector('#modal.sc-pagebox:not([hidden]) #s-name');
    assert.equal(await page.isVisible('#modal-back'), false, 'no overlay behind the box');
    assert.equal(await page.isVisible('.sc-prodsplit'), false, 'the box takes the place of the screen');
    await page.fill('#s-name', 'Silgan Closures');
    await page.fill('#s-label', 'Silgan Closures');
    await page.click('#s-save');
    await page.waitForFunction(() => [...document.querySelectorAll('.sc-suppick button strong')].some(b => b.textContent === 'Silgan Closures'));
    await page.click('.sc-suppick button:has-text("Silgan Closures")');
    await page.waitForSelector('#prod-add');
    await until(() => page.$eval('#prod-add', b => !/Saving/.test(b.textContent)), 'the new supplier');

    // ＋ Add Product: a line at the top with the drop-downs blank.
    for (const [name, kind, unit, low] of [['38mm white caps', 'Packaging', 'Cases', '20'], ['38mm red caps', 'Packaging', 'Cases', ''], ['Old lids', 'Other', 'Each', '']]) {
      await page.click('#prod-add');
      await page.waitForSelector('#pedit #p-name');
      assert.deepEqual(await page.$$eval('#pedit select', s => s.map(x => x.value)), ['', ''], 'drop-downs start blank');
      await page.fill('#p-name', name);
      await page.selectOption('#p-kind', kind);
      await page.selectOption('#p-unit', unit);
      if (low) await page.fill('#p-low', low);
      await page.click('#p-save');
      await until(() => itemNamed(name), name);
      await page.waitForFunction((n) => !document.getElementById('pedit') && [...document.querySelectorAll('.sc-prodtable td.strong')].some(t => t.textContent === n), name);
    }
    const white = await itemNamed('38mm white caps'), red = await itemNamed('38mm red caps');
    assert.equal(white.kind, 'Packaging'); assert.equal(white.unit, 'Cases'); assert.equal(white.low, 20); assert.ok(white.supplierId);
    assert.equal(await page.textContent('.sc-suppick button[aria-selected="true"] small'), '3 products');
    // Edit, then Remove (a second press).
    const lids = await itemNamed('Old lids');
    await page.click('[data-prod="' + lids.id + '"]');
    await page.fill('#p-name', 'Old lids, white');
    await page.click('#p-save');
    await until(async () => (await itemNamed('Old lids, white')), 'the edit');
    await page.waitForSelector('[data-prod="' + lids.id + '"]');
    await page.click('[data-prod="' + lids.id + '"]');
    await page.click('#p-remove');
    assert.equal(await page.textContent('#p-remove'), 'Press again to remove');
    await page.click('#p-remove');
    await until(async () => (await items()).find(i => i.id === lids.id).status === 'REMOVED', 'the remove');
    await page.waitForFunction(() => document.querySelector('.sc-suppick button[aria-selected="true"] small').textContent === '2 products');
    // Red: below its low mark (nothing counted yet, so 0 < 20).
    assert.deepEqual(await page.$$eval('.sc-prodtable tbody tr', r => r.map(x => x.cells[0].textContent + ':' + x.className)), ['38mm red caps:', '38mm white caps:low']);
    assert.ok(await smallest(page, '.sc-prodsplit *') >= 16, 'text 16px and up');
    assert.ok(await fits(page), 'no sideways scroll');
    await shot(page, '2-suppliers-and-products-1536.png');
    results.push('Suppliers & Products: a supplier added in the page; products added (blank drop-downs), edited and removed; low mark shows red');

    // ---------- Add Load: PO number and two products ----------
    await page.click('[data-rtab="calendar"]');
    await page.waitForSelector('.sc-month');
    await page.click('#add');
    await page.waitForSelector('#modal.sc-pagebox:not([hidden]) #f-lines');
    assert.equal(await page.$('#f-cases'), null, 'Receiving: products on lines, not one Cases box');
    const opt = await page.$$eval('#f-route option', o => o.map(x => [x.value, x.textContent]));
    await page.selectOption('#f-route', opt.find(o => /SILGAN/.test(o[1]))[0]);
    await page.selectOption('#f-type', 'CARRIER');
    await page.fill('#f-time', '10:00');
    await page.fill('#f-po', 'PO 55120');
    assert.deepEqual(await page.$$eval('#f-lines tr:first-child select optgroup', g => g.map(x => x.label)), ['Silgan Closures'], 'the supplier\'s products first');
    await page.selectOption('#f-lines tr:nth-child(1) select', white.id);
    await page.fill('#f-lines tr:nth-child(1) [data-f="ordered"]', '40');
    await page.click('#f-addline');
    await page.selectOption('#f-lines tr:nth-child(2) select', red.id);
    await page.fill('#f-lines tr:nth-child(2) [data-f="ordered"]', '12');
    assert.match(await page.textContent('#f-linetot'), /2 products · 52 ordered/);
    await shot(page, '3-add-load-products-1536.png');
    await page.click('#f-save');
    await page.click('#f-confirm');
    const load = await until(async () => (await receivingLoads()).find(l => l.run === 'SILGAN CLOSURES' && l.createdInApp), 'the load');
    assert.deepEqual(load.payload.lines.map(l => [l.name, l.ordered]), [['38mm white caps', 40], ['38mm red caps', 12]]);
    assert.equal(load.payload.poNumber, 'PO 55120');
    assert.equal(load.payload.product, '38mm white caps, 38mm red caps');
    assert.equal(load.payload.cases, '52');
    results.push('Add Load: one PO number and two products with what was ordered (52 in all)');

    // ---------- Check in: scan, a new barcode named once, Mark Received ----------
    await page.waitForFunction(() => /Silgan Closures/.test(document.getElementById('body').textContent));
    await page.click('[data-day="2026-10-08"]');
    await page.waitForSelector('#modal .sc-daylist');
    await page.click('#modal .sc-dayrow:has-text("Silgan") [data-edit]');
    await page.waitForSelector('#f-scan');
    await page.fill('#f-scan', CAP_BARCODE);
    await page.press('#f-scan', 'Enter');
    await page.waitForSelector('#f-unknown:not([hidden])');
    await page.selectOption('#f-unknown-pick', white.id);
    await page.click('#f-unknown-save');
    await until(async () => ((await itemNamed('38mm white caps')).barcodes || []).length === 1, 'the barcode');
    await page.waitForFunction(() => document.querySelector('#f-lines tr:nth-child(1) [data-f="received"]').value === '1');
    await page.fill('#f-scan', CAP_BARCODE);
    await page.press('#f-scan', 'Enter');
    await page.waitForFunction(() => document.querySelector('#f-lines tr:nth-child(1) [data-f="received"]').value === '2');
    assert.match(await page.textContent('#f-scan-note'), /\+1 38mm white caps · now 2 of 40/);
    // Mark Received needs every product's count.
    await page.click('#f-receive');
    assert.match(await page.textContent('#f-error'), /Type what came in for 38mm red caps/);
    await page.fill('#f-lines tr:nth-child(1) [data-f="received"]', '40');
    await page.fill('#f-lines tr:nth-child(2) [data-f="received"]', '10');
    assert.match(await page.textContent('#f-linetot'), /50 received · short 2 on 38mm red caps/);
    assert.ok(await smallest(page, '#modal *') >= 16, 'text 16px and up');
    await shot(page, '4-check-in-scan-1536.png');
    await page.click('#f-receive');
    const got = await until(async () => (await receivingLoads()).find(l => l.run === 'SILGAN CLOSURES' && l.payload.received), 'Mark Received');
    assert.deepEqual(got.payload.lines.map(l => [l.name, l.ordered, l.received]), [['38mm white caps', 40, 40], ['38mm red caps', 12, 10]]);
    assert.equal((await itemNamed('38mm white caps')).receivedSince, 40);
    assert.equal((await itemNamed('38mm red caps')).receivedSince, 10);
    const moves = (await db().collection('inventoryMoves').get()).docs.map(d => d.data());
    assert.deepEqual(moves.map(m => m.kind + ':' + m.itemName + ':' + m.qty + ':' + m.poNumber).sort(), ['RECEIVED:38mm red caps:10:PO 55120', 'RECEIVED:38mm white caps:40:PO 55120']);
    await page.waitForSelector('#modal[hidden]', { state: 'attached' });
    // A received load shows it was received, and cannot go into Inventory twice.
    await page.click('[data-day="2026-10-08"]');
    await page.click('#modal .sc-dayrow:has-text("Silgan") [data-edit]');
    await page.waitForSelector('#modal .sc-gotnote');
    assert.equal(await page.$('#f-receive'), null);
    assert.equal(await page.$('#f-scan'), null);
    await page.click('#modal [data-close]');
    assert.deepEqual(page.errors, []);
    await page.close();
    results.push('Check-in: a new barcode named once then counted; Mark Received puts 40 and 10 into Inventory once');

    // ---------- Inventory: On Hand, Count, History ----------
    let countDay = '';
    for (const [w, h] of [[1536, 790], [1920, 1080]]) {
      const inv = await openPage(browser, w, h, '/inventory.html?' + ADMIN);
      await inv.waitForFunction(() => (document.getElementById('oh-rows').textContent.match(/Silgan Closures/g) || []).length === 2);
      const rows = await inv.$$eval('#oh-rows tr', r => r.map(x => [...x.cells].slice(0, 7).map(c => c.innerText.replace(/\n/g, ' ')).join(' | ')));
      // 1536 first (before the Count), then 1920 (after it: the count is the new starting point).
      assert.ok(rows.includes(w === 1536 ? '38mm white caps | Silgan Closures | Cases | Not counted yet | +40 | 0 | 40' : '38mm white caps | Silgan Closures | Cases | 38 on ' + countDay + ' | 0 | 0 | 38'), rows.join('\n'));
      assert.ok(rows.includes('38mm red caps | Silgan Closures | Cases | Not counted yet | +10 | 0 | 10'), rows.join('\n'));
      assert.ok(await smallest(inv, '#tab-onhand *, .inv-tabs *') >= 16, 'text 16px and up');
      assert.ok(await fits(inv), 'no sideways scroll at ' + w);
      await shot(inv, '5-inventory-on-hand-' + w + '.png');
      if (w === 1536) {
        const whiteNow = await itemNamed('38mm white caps');
        await inv.click('[data-count="' + whiteNow.id + '"]');
        await inv.fill('#count-qty', '38');
        await shot(inv, '6-inventory-count-1536.png');
        await inv.press('#count-qty', 'Enter');
        const counted = await until(async () => { const i = await itemNamed('38mm white caps'); return i.countQty === 38 && i; }, 'the count');
        countDay = require('../../src/logic').operatingDay(new Date(counted.countAt)).replace(/^20(\d\d)-0?(\d+)-0?(\d+)$/, '$2-$3-$1');
        await inv.waitForFunction(() => [...document.querySelectorAll('#oh-rows tr')].some(r => /38mm white caps/.test(r.textContent) && r.cells[6].textContent === '38'));
        await inv.click('[data-history="' + whiteNow.id + '"]');
        await inv.waitForFunction(() => document.querySelectorAll('#h-rows tr').length === 2 && !document.querySelector('#h-rows .empty'));
        const hist = await inv.$$eval('#h-rows tr', r => r.map(x => [2, 3, 4, 5, 6].map(i => x.cells[i].innerText.replace(/\n/g, ' ')).join(' | ')));
        assert.deepEqual(hist, ['38mm white caps | Counted 38 on the shelf | −2 | 38 | —', '38mm white caps | Received | +40 | 40 | SILGAN CLOSURES · PO 55120']);
        await shot(inv, '7-inventory-history-1536.png');
        await inv.click('[data-tab="log"]');
        await inv.waitForSelector('#tab-log:not([hidden]) #rows tr');
      }
      assert.deepEqual(inv.errors, []);
      await inv.close();
    }
    results.push('Inventory: On Hand reads Should have 40 and 10; Count 38 is the new starting point; History shows Received and Counted');
  } finally { await browser.close(); }
  console.log(results.join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
