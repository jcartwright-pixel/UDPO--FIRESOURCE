'use strict';
/*
 * Browser check of Receiving scan-in (Joe 10/13: mock-up A on the tablet, mock-up E in the office).
 *   - Boxing station, Receiving tab: START RECEIVING on a delivery, then the Wasp scanner (a keyboard-type scanner, typed fast
 *     with nothing focused) adds a line; the same barcode again adds a case; a supplier's pallet label (GS1-128) is its own line
 *     with its lot, best-by date and count; a barcode never seen asks "Which item is it?" (a blank drop-down, or type a new one);
 *     − and + fix a count; the tablet camera (Use camera) reads a barcode too. Every scan saves itself.
 *   - Inventory > Receiving Log: every scan, newest first, with the supplier, lot, dates, cases and who received it; a lot search
 *     finds one line; Received Items renames an item when its box is left.
 * Text 16px and up, no sideways scroll at 800 and 1024 (tablet) and 1536 and 1920 (office). Pictures go to SHOTS.
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
const MANAGER = '?testEmail=manager.test@uniteddairy.com';
const ADMIN = '?testEmail=admin.test@uniteddairy.com';
const SHOTS = process.env.SHOTS || '';
const CLOCK = '2026-10-08T14:00:00Z';

async function openPage(browser, width, height, url, touch) {
  const page = await browser.newPage(Object.assign(touch ? { viewport: { width, height }, hasTouch: true, isMobile: true } : { viewport: { width, height } }, { serviceWorkers: 'block' }));
  await page.clock.setFixedTime(new Date(CLOCK));
  await page.addInitScript(() => {
    // A stand-in camera and barcode reader (Chrome on the Galaxy tablets has both; the test browser has neither).
    window.BarcodeDetector = class { static async getSupportedFormats() { return ['code_128', 'upc_a', 'ean_13']; } async detect() { return window.cameraSees ? [{ rawValue: window.cameraSees }] : []; } };
    navigator.mediaDevices.getUserMedia = async () => { const c = document.createElement('canvas'); c.getContext('2d').fillRect(0, 0, 1, 1); return c.captureStream(1); };
  });
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
async function scanned(pred, what) {
  for (let i = 0; i < 100; i++) {
    const docs = (await db().collection('receivingScans').get()).docs.map(d => d.data());
    if (pred(docs)) return docs;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('not saved: ' + what);
}
// The Wasp: the code typed fast and Enter, with nothing focused (the person never taps the scan box).
async function wasp(page, parts) {
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  for (const p of parts) {
    if (p === 'GS') await page.keyboard.press('Control+BracketRight');
    else await page.keyboard.type(p, { delay: 3 });
  }
  await page.keyboard.press('Enter');
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date(CLOCK) });
  const browser = await chromium.launch();
  const results = [];
  try {
    const page = await openPage(browser, 1024, 768, '/plant-station.html' + MANAGER, true);
    await page.waitForSelector('[data-station="BOXING"]');
    await page.click('[data-station="BOXING"]');
    await page.waitForSelector('#work .sw-card');
    // A scan on the Shipping / Loadout tab is not taken.
    await wasp(page, ['036000291452']);
    await page.waitForFunction(() => /Open the Receiving tab/.test(document.getElementById('error').textContent));
    await page.click('[data-view="receiving"]');
    const card = '#work .sw-card[data-sw="sch:RECV-v1"]';
    await page.waitForSelector(card);
    // Before START RECEIVING, a scan says what to do.
    await wasp(page, ['036000291452']);
    await page.waitForFunction(() => /Tap START RECEIVING on the delivery/.test(document.getElementById('error').textContent));
    await page.click(card + ' [data-act="sstart"]');
    await page.waitForSelector(card + '.run.open .rv-box input[data-scan-box]', { timeout: 10000 });
    assert.equal(await page.getAttribute(card + ' .rv-box input', 'inputmode'), 'none', 'no on-screen keyboard over the list');
    // 1. A UPC the plant has never seen: a line, then the same again adds a case.
    await wasp(page, ['036000291452']);
    await page.waitForSelector(card + ' .rv-table tr.rv-new');
    assert.match(await page.textContent(card + ' tr.rv-new'), /New barcode 036000291452/);
    await scanned(d => d.length === 1, 'the first scan');
    await wasp(page, ['036000291452']);
    await page.waitForFunction((c) => document.querySelector(c + ' tr.rv-new .rv-qty b').textContent === '2', card);
    await scanned(d => d.length === 1 && d[0].count === 2, 'the second case');
    // 2. A pallet label (GS1-128): its own line, with the lot, best-by date and count from the label.
    await wasp(page, ['0110614141000415', '17270401', '3712', 'GS', '10C2610A']);
    await page.waitForFunction((c) => document.querySelectorAll(c + ' .rv-table tbody tr').length === 2, card);
    const pallet = await scanned(d => d.length === 2, 'the pallet label').then(d => d.find(x => x.lot === 'C2610A'));
    assert.deepEqual([pallet.count, pallet.bestBy, pallet.gtin, pallet.deliveryId], [12, '2027-04-01', '10614141000415', 'RECV-v1']);
    assert.match(await page.textContent(card + ' .rv-table tbody tr:first-child'), /C2610A.*4-1-27.*12/);
    if (SHOTS) { await page.$eval(card, e => e.scrollIntoView({ block: 'start' })); await shot(page, '2-tablet-new-barcode-1024.png'); }
    // 3. "Which item is it?": the drop-down starts blank; a new item is typed and saved when Enter is pressed.
    const upcRow = card + ' tr.rv-new:has-text("036000291452")';
    assert.equal(await page.$eval(upcRow + ' select[data-rvitem]', s => s.value), '', 'the drop-down starts blank');
    await page.selectOption(upcRow + ' select[data-rvitem]', '__new');
    await page.fill(card + ' [data-k="rvnew"]', 'Gallon caps, white 38mm');
    await page.press(card + ' [data-k="rvnew"]', 'Enter');
    await page.waitForSelector(card + ' .rv-table td b:text-is("Gallon caps, white 38mm")');
    await scanned(d => d.some(x => x.itemName === 'Gallon caps, white 38mm'), 'the item name');
    const palletRow = card + ' tr.rv-new:has-text("10614141000415")';
    await page.selectOption(palletRow + ' select[data-rvitem]', '__new');
    await page.fill(card + ' [data-k="rvnew"]', 'Half-gallon cartons, Whole');
    await page.press(card + ' [data-k="rvnew"]', 'Enter');
    await page.waitForSelector(card + ' .rv-table td b:text-is("Half-gallon cartons, Whole")');
    await scanned(d => d.every(x => x.itemId), 'both items named');
    // A known barcode now comes in with its name. A second item from the drop-down.
    await wasp(page, ['4006381333931']);
    await page.waitForSelector(card + ' tr.rv-new:has-text("4006381333931")');
    await page.waitForFunction((c) => [...document.querySelectorAll(c + ' tr.rv-new select[data-rvitem] option')].some(o => o.textContent === 'Gallon caps, white 38mm'), card);
    const capId = (await db().collection('receivingItems').get()).docs.find(d => d.data().name === 'Gallon caps, white 38mm').id;
    await page.selectOption(card + ' tr.rv-new select[data-rvitem]', capId);
    await page.waitForFunction((c) => !document.querySelector(c + ' tr.rv-new'), card);
    await scanned(d => d.filter(x => x.itemId === capId).length === 2, 'picked from the list');
    // 4. − and +.
    const palletLine = card + ' .rv-table tbody tr:has-text("C2610A")';
    await page.click(palletLine + ' [data-act="rvplus"]');
    await page.click(palletLine + ' [data-act="rvplus"]');
    await page.click(palletLine + ' [data-act="rvminus"]');
    await page.waitForSelector(palletLine + ' .rv-qty b:text-is("13")');
    await scanned(d => d.some(x => x.lot === 'C2610A' && x.count === 13), '− and +');
    // 5. The camera.
    await page.click(card + ' [data-act="rvcam"]');
    await page.waitForSelector('.scan-camera video');
    await page.evaluate(() => { window.cameraSees = '96385074'; });
    await page.waitForSelector(card + ' tr.rv-new:has-text("96385074")', { timeout: 10000 });
    assert.equal(await page.$('.scan-camera'), null, 'the camera closes after a read');
    await scanned(d => d.length === 4, 'the camera scan');
    // The sum line, text sizes and fit.
    assert.match(await page.textContent(card + ' .rv-sum'), /^17 cases · 3 items · each scan saves itself$/);
    assert.ok(await smallest(page, card + ' .rv-block *') >= 16, 'text 16px and up on the scan list');
    assert.ok(await fits(page), 'no sideways scroll at 1024');
    if (SHOTS) { await page.$eval(card, e => e.scrollIntoView({ block: 'start' })); await shot(page, '1-tablet-scan-list-1024.png'); }
    assert.deepEqual(page.errors, []);
    await page.close();
    results.push('Boxing Receiving: START RECEIVING, then the Wasp (fast typing, nothing focused) and the camera add lines; the same barcode adds a case; a pallet label gives lot, best-by and 12 cases; a new barcode is named once from a blank drop-down; − and + save');

    // The tablet standing up (800 wide).
    const tall = await openPage(browser, 800, 1280, '/plant-station.html' + MANAGER, true);
    await tall.waitForSelector('[data-station="BOXING"]');
    await tall.click('[data-station="BOXING"]');
    await tall.waitForSelector('#work .sw-card');
    await tall.click('[data-view="receiving"]');
    await tall.waitForSelector(card + ' .rv-table tbody tr');
    assert.ok(await fits(tall), 'no sideways scroll at 800');
    assert.ok(await smallest(tall, card + ' .rv-block *') >= 16, 'text 16px and up at 800');
    if (SHOTS) { await tall.$eval(card, e => e.scrollIntoView({ block: 'start' })); await shot(tall, '3-tablet-scan-list-800.png'); }
    assert.deepEqual(tall.errors, []);
    await tall.close();
    results.push('Boxing Receiving at 800 wide: the scan list fits, text 16px and up');

    // The plant home: Inventory (Under Construction: administrators only while it is built).
    // Joe 10/26 (ej): Inventory sits inside Shipping & Receiving: a light blue button under it on the home's Plant Operations card,
    // and an item in the Shipping & Receiving menu; no sideways scroll. Joe 10/31: Shipping & Receiving is its own Home card, with
    // Inventory as a dark blue line with its places under it: Receiving Log, Plant Material Trailers (open to everyone, it is in use),
    // and Off-site Inventory and Inventory Room (being built).
    for (const [w, h] of [[1536, 864], [1920, 1080]]) {
      const home = await openPage(browser, w, h, '/index.html' + ADMIN);
      await home.evaluate(() => sessionStorage.setItem('udPlant', 'fac_uniontown'));
      await home.goto(HOSTING + '/index.html' + ADMIN);
      await home.waitForSelector('.hq-sub[data-side="shipping"][href="inventory.html"].building');
      await home.waitForTimeout(400);
      assert.deepEqual(await home.$$eval('.hq-sub[data-side="shipping"]', a => a.map(x => x.textContent + ':' + x.classList.contains('building'))), ['Shipping:false', 'Receiving:false', 'Receiving Log:true', 'Plant Material Trailers:false', 'Off-site Inventory:true', 'Inventory Room:true']);
      assert.deepEqual(await home.$$eval('.hq-main[data-side="shipping"]', a => a.map(x => x.textContent + ':' + x.getAttribute('href') + ':' + x.classList.contains('building'))), ['Inventory:inventory.html:true']);
      assert.ok(await fits(home), 'home fits at ' + w);
      await shot(home, '0-home-inventory-card-' + w + '.png');
      await home.close();
    }
    // The office: Inventory > Receiving Log.
    for (const [w, h] of [[1536, 864], [1920, 1080]]) {
      const log = await openPage(browser, w, h, '/inventory.html' + ADMIN);
      await log.waitForSelector('#rows tr td.strong');
      assert.equal(await log.$$eval('#rows tr', r => r.length), 4);
      const rows = await log.$$eval('#rows tr', r => r.map(x => [...x.cells].map(c => c.innerText.replace(/\n/g, ' ')).join(' | ')));
      assert.ok(rows.some(r => /Half-gallon cartons, Whole \| C2610A \| — \| 4-1-27 \| 13 \| /.test(r)), rows.join('\n'));
      assert.ok(rows.every(r => /^10-8-26 \| /.test(r)), 'dates as 10-8-26');
      assert.ok(await smallest(log, '#rows *, thead th, .inv-filters *') >= 16, 'text 16px and up');
      assert.ok(await fits(log), 'no sideways scroll at ' + w);
      await shot(log, '4-office-receiving-log-' + w + '.png');
      await log.fill('#search', 'C2610A');
      await log.waitForFunction(() => document.querySelectorAll('#rows tr').length === 1);
      if (w === 1920) {
        await log.fill('#search', '');
        await log.click('#items-open');
        await log.waitForSelector('#items:not([hidden]) [data-item]');
        await shot(log, '5-office-received-items-1920.png');
        const box = '#items [data-item="' + capId + '"]';
        await log.fill(box, 'Gallon caps, white 38 mm');
        await log.press(box, 'Enter');
        for (let i = 0; i < 100 && (await db().collection('receivingItems').doc(capId).get()).data().name !== 'Gallon caps, white 38 mm'; i++) await new Promise(r => setTimeout(r, 100));
        assert.equal((await db().collection('receivingItems').doc(capId).get()).data().name, 'Gallon caps, white 38 mm');
        await log.click('#items [data-close]');
        await log.waitForFunction(() => [...document.querySelectorAll('#rows td.strong')].filter(t => /Gallon caps, white 38 mm/.test(t.textContent)).length === 2);
      }
      assert.deepEqual(log.errors, []);
      await log.close();
    }
    results.push('Receiving Log at 1536 and 1920: every scan with supplier, lot, dates, cases and who; a lot search finds its line; Received Items renames an item when its box is left');
  } finally { await browser.close(); }
  console.log(results.join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
