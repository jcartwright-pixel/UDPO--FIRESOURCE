'use strict';
/*
 * Pallet Builder (Joe 11-4-26: in Operations, not the hub): a manager opens it from Plant Distribution Departments in the menu,
 * the builder shows under the Operations header after sign-in, its saved routes stay after a reload, and it fits a phone.
 * Made-up people only. Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { clear, db } = require('../emulator/helpers');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';

async function openPage(ctx, url) {
  const page = await ctx.newPage();
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  await localCalls(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.errors = errors;
  await page.goto(HOSTING + url);
  return page;
}

(async () => {
  await clear();
  const { runTransfer } = require('../../src/transfer');
  const F = require('../fixtures/fake-sheets');
  const PD = require('../fixtures/plant-demo');
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  try {
    const ctx = await browser.newContext({ viewport: { width: 1536, height: 860 }, serviceWorkers: 'block' });
    // Joe 11-5-26: its own card on Home and its own menu option, right under Debag / Labeling Room.
    let p = await openPage(ctx, '/index.html?testEmail=manager.test@uniteddairy.com');
    await p.waitForSelector('#screen:not([hidden]) .hq-main[data-side="pallets"]');
    const lines = await p.$$eval('.hq-main', c => c.map(x => x.dataset.side));
    assert.equal(lines.indexOf('pallets'), lines.indexOf('debag') + 1, 'Home: right under Debag / Labeling Room ' + JSON.stringify(lines));
    assert.ok(!(await p.$eval('.hq-main[data-side="pallets"]', x => x.classList.contains('building'))), 'open to everyone, not Under Construction');
    const [deb, pal] = await Promise.all(['debag', 'pallets'].map(k => p.$eval('.hq-main[data-side="' + k + '"]', x => { const r = x.getBoundingClientRect(); return [r.left, r.top, r.bottom]; })));
    assert.ok(pal[1] >= deb[2] - 1 && Math.abs(pal[0] - deb[0]) <= 2, 'on its own line under Debag / Labeling Room ' + JSON.stringify([deb, pal]));
    await p.waitForTimeout(800);
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'pallet-builder-home-1536.png') });
    await p.close();
    p = await openPage(ctx, '/pallet-builder.html?testEmail=manager.test@uniteddairy.com');
    await p.waitForSelector('#screen:not([hidden]) #builder');
    const frame = () => p.frameLocator('#builder');
    await frame().locator('#dayTable tr').first().waitFor();
    assert.equal(await p.textContent('.head h1'), 'Pallet Builder');
    assert.ok(await p.isHidden('#signin'), 'signed in: no sign-in box');
    assert.ok(await frame().locator('h1').textContent().then(t => /Pallet Builder/.test(t)), 'the builder shows in the frame');
    const menu = await p.$$eval('a[href^="pallet-builder.html"]', as => as.length);
    assert.ok(menu >= 1, 'Pallet Builder is in the menu');
    await frame().locator('#loadSample').click();
    await frame().locator('#tiles .tile').first().waitFor();
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'pallet-builder-1536.png') });
    // Its saved routes stay in this browser after a reload.
    await frame().locator('#route').fill('Test route 1');
    await frame().locator('#route').dispatchEvent('input');
    await frame().locator('#route').dispatchEvent('change');
    await p.reload();
    await p.waitForSelector('#screen:not([hidden]) #builder');
    await frame().locator('#dayTable tr').first().waitFor();
    assert.ok(/Test route 1/.test(await frame().locator('#dayTable').textContent()), 'the route saved before the reload is there');
    assert.deepEqual(p.errors, []);
    await ctx.close();

    // Joe 11-6-26: the route opens sequenced like the route map (the Customer List's route day, answered here by a stand-in for
    // its customerList call), Save to route map sends only the changed load sequences, and Print sequence changes fills one page.
    const map = await browser.newContext({ viewport: { width: 1536, height: 860 }, serviceWorkers: 'block' });
    const src = fs.readFileSync(path.join(__dirname, '../../../tools/pallet-builder/builder.html'), 'utf8');
    const list = JSON.parse(/const SEQS = (\{.*?\}); \/\//.exec(src)[1])['813|THU'];
    const stops = list.map((x, i) => ({ key: x[1] || 'name' + i, account: x[1], name: x[2], chain: /^DQ /.test(x[2]) ? 'DAIRY QUEEN' : '', loadSeq: /RALPH/.test(x[2]) ? 9 : x[0], note: i === 0 ? 'Back door' : '' }));
    const sent = [];
    const answer = (d) => d.op === 'view'
      ? { plant: 'fac_uniontown', customers: {}, canEdit: true, routeDays: [{ plant: 'fac_uniontown', route: '813', day: 'THU', rev: 2, updatedAt: '2026-11-05T20:46:00.000Z', stops }] }
      : (sent.push(d), { ok: true, routeDay: { plant: 'fac_uniontown', route: '813', day: 'THU', rev: 3, updatedAt: '2026-11-06T14:15:00.000Z', stops: d.stops.map(s => Object.assign({}, stops.find(x => x.key === s.key), s)) } });
    p = await map.newPage();
    await p.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) }));
    await localCalls(p);
    await p.route(/\/customerList$/, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ result: answer((route.request().postDataJSON() || {}).data || {}) }) }));
    p.errors = []; p.on('pageerror', e => p.errors.push(e.message));
    await p.goto(HOSTING + '/pallet-builder.html?testEmail=manager.test@uniteddairy.com');
    await p.waitForSelector('#screen:not([hidden]) #builder');
    const f = p.frameLocator('#builder');
    await f.locator('#dayTable tr').first().waitFor();
    const open813 = f.locator('#dayTable tr', { hasText: 'RT 813' }).locator('button.openR');
    if (await open813.count()) await open813.click(); // (the route already open has no Open button)
    await f.locator('#mapMsg', { hasText: 'Same as the route map' }).waitFor();
    assert.match(await f.locator('#mapMsg').textContent(), /Last saved to the route map 11-5-26/);
    assert.ok(await f.locator('#lmSave').isDisabled(), 'nothing to save yet');
    const ralph = f.locator('#lmTable tr', { hasText: 'RALPH' }).locator('input.lseq');
    assert.equal(await ralph.inputValue(), '9', 'the load sequence comes from the route map');
    await ralph.fill('8'); await ralph.dispatchEvent('change');
    await f.locator('#mapMsg', { hasText: '1 sequence changed since the route map (1 customer)' }).waitFor();
    const fr = p.frame({ url: /about:srcdoc/ }) || p.frames().find(x => x !== p.mainFrame());
    await fr.evaluate(() => { window.print = () => { window.printedAt = Date.now(); }; });
    await f.locator('#lmPrint').click();
    const sheet = await f.locator('#printSheet').textContent();
    assert.match(sheet, /Route: 813/); assert.match(sheet, /Day: Thursday/); assert.match(sheet, /DAIRY QUEEN/);
    assert.ok(/DQ JEANNETTE/.test(sheet) && /DQ RALPH/.test(sheet), 'every customer on the changed sequence is on the sheet');
    assert.ok(await fr.evaluate(() => !!window.printedAt), 'it prints');
    assert.equal(await f.locator('#printSheet tr.chg').count(), 1, 'the changed one is bold');
    await f.locator('#lmSave').click();
    await f.locator('#mapMsg', { hasText: 'Saved 1 customer to the route map' }).waitFor();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].op, 'saveRouteDay'); assert.equal(sent[0].route, '813'); assert.equal(sent[0].day, 'THU'); assert.equal(sent[0].rev, 2);
    assert.deepEqual(sent[0].stops.map(s => s.key), stops.map(s => s.key), 'the same stops in the same order');
    assert.equal(sent[0].stops.find(s => s.key === '40496').loadSeq, 8, 'the new load sequence');
    assert.equal(sent[0].stops[0].note, 'Back door', 'stop notes stay');
    assert.ok(sent[0].stops.every((s, i) => s.key === '40496' || s.loadSeq === stops[i].loadSeq), 'nothing else changes');
    if (SHOTS) { await f.locator('section[aria-label="Truck load map"]').scrollIntoViewIfNeeded(); await p.screenshot({ path: path.join(SHOTS, 'pallet-builder-route-map-1536.png') }); }
    assert.deepEqual(p.errors, []);
    await map.close();

    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    p = await openPage(phone, '/pallet-builder.html?testEmail=manager.test@uniteddairy.com');
    await p.waitForSelector('#screen:not([hidden]) #builder');
    await p.frameLocator('#builder').locator('#dayTable tr').first().waitFor();
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll on a phone');
    await p.waitForTimeout(500);
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'pallet-builder-390.png') });
    assert.deepEqual(p.errors, []);

    // Joe 11-6-26 (lb): the builder opens with the newest BOL the Hub picked up (bolDays, here a made-up one read the way Hub >
    // Daily BOL reads the office's PDF); the routes are added with their customers' account numbers and BOL load sequences.
    const B = require('../../src/bol');
    const bolDay = B.readBol(require('../fixtures/bol-pdf').samplePdf(), 'Daily Load UT.pdf').days[0];
    await db().collection('bolDays').doc('2026-11-08').set(Object.assign({}, bolDay, { date: '2026-11-08', received: '2026-11-08T21:00:00.000Z' }));
    await db().collection('bolDays').doc(bolDay.date).set(Object.assign({}, bolDay, { file: 'Daily Load UT.pdf', source: 'EMAIL', received: '2026-11-09T21:00:00.000Z' }));
    const hubCtx = await browser.newContext({ viewport: { width: 1536, height: 860 }, serviceWorkers: 'block' });
    p = await openPage(hubCtx, '/pallet-builder.html?testEmail=manager.test@uniteddairy.com');
    await p.waitForSelector('#screen:not([hidden]) #builder');
    const hb = p.frameLocator('#builder');
    await hb.locator('#dayTable tr').first().waitFor();
    assert.match(await hb.locator('#dayHint').textContent(), /The 11-9-26 BOL from the Hub is loaded: 2 routes/, 'the newest load day, not the older one');
    const dayText = await hb.locator('#dayTable').textContent();
    assert.ok(/RT 805 · 11\/09\/26/.test(dayText) && /RT 6301 · 11\/09\/26/.test(dayText), 'both BOL routes are listed: ' + dayText.slice(0, 300));
    assert.ok(!/11\/08\/26/.test(dayText), 'the older BOL is not added');
    assert.equal(await hb.locator('#route').inputValue(), 'RT 805 · 11/09/26', 'the first BOL route opens');
    assert.ok(/MADEUP GOLF CENTER/.test(await hb.locator('#lmTable').textContent()), 'its customers are on the truck load map');
    await p.waitForTimeout(500);
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'pallet-builder-hub-bol-1536.png') });
    assert.deepEqual(p.errors, []);
    await hubCtx.close();
    console.log('pallet builder browser test passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
