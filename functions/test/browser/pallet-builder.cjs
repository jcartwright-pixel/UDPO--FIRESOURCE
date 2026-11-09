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
    assert.ok(await frame().locator('h1').textContent().then(t => /PALLET BUILDER/.test(t)), 'the builder shows in the frame');
    const menu = await p.$$eval('a[href^="pallet-builder.html"]', as => as.length);
    assert.ok(menu >= 1, 'Pallet Builder is in the menu');
    // Joe 11-7-26: with no BOL days in the Hub it says so in red, so the built-in BOL is not taken for the newest.
    assert.match(await frame().locator('#dayBad').textContent(), /^THE HUB HAS NO BOL DAYS YET/);
    assert.ok(await frame().locator('#dayBad').isVisible());
    // Joe 11-8-26: and what this app's Hub says about its email, so the line says what to press.
    assert.match(await frame().locator('#dayBad').textContent(), /THIS APP'S HUB HAS NO MAILBOX SET: TYPE IT ON DAILY BOL, TICK CHECK EVERY HOUR AND PRESS CHECK EMAIL NOW\.$/);
    // Joe 11-8-26: "That should say load sequences, not stop. Do a word wrap too", in capitals.
    assert.equal(await frame().locator('#dayTable th').nth(1).innerText(), 'LOAD SEQUENCES');
    assert.equal(await frame().locator('#dayTable th').nth(1).evaluate(e => getComputedStyle(e).whiteSpace), 'normal');
    assert.ok(/^THE 11\/05 BOL IS LOADED/.test(await frame().locator('#dayHint').innerText()), 'the All routes line in capitals');
    assert.ok(/^BOLD CUSTOMERS ARE ON THE BOL/.test(await frame().locator('section[aria-label="Truck load map"] .hint').first().innerText()), 'the Truck load map note in capitals');
    assert.match(await frame().locator('#dayLine').textContent(), /THE BOL BUILT INTO PALLET BUILDER$/);
    await frame().locator('#loadSample').click();
    await frame().locator('#tiles .tile').first().waitFor();
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'pallet-builder-1536.png') });
    // Its saved routes stay in this browser after a reload (the route name is under MORE ROUTE TOOLS, Joe 11-7-26).
    await frame().locator('details.more summary').click();
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
    const sent = [], caseCalls = [];
    // Joe 11-6-26: two made-up weeks of cases for each customer (the Customer List keeps them from the Hub's Weekly Route Report).
    const cases = {}; stops.forEach((x, i) => { cases[x.key] = [['2026-10-31', 40 + i], ['2026-10-24', 10]]; });
    let rules = { standard: 'HIGH', weeks: 5, cratesPerPallet: 54, cratesPerStack: 6, dispensersPerPallet: 45, boxIsCrate: true, toteSpots: 1, newPalletEachSeq: true, under: 'KEEP', over: 'ADD' };
    const answer = (d) => d.op === 'view'
      ? { plant: 'fac_uniontown', customers: {}, canEdit: true, palletRules: rules, routeDays: [{ plant: 'fac_uniontown', route: '813', day: 'THU', rev: 2, updatedAt: '2026-11-05T20:46:00.000Z', stops, cases, palletUses: {}, caseWeeks: 2 }] }
      : d.op === 'setPalletUses' ? (caseCalls.push(d), { ok: true, palletUses: { [d.key]: d.rule } })
      : d.op === 'savePalletRules' ? (caseCalls.push(d), rules = Object.assign({}, rules, d.rules), { ok: true, palletRules: rules })
      : (sent.push(d), { ok: true, routeDay: { plant: 'fac_uniontown', route: '813', day: 'THU', rev: 3, updatedAt: '2026-11-06T14:15:00.000Z', stops: d.stops.map(s => Object.assign({}, stops.find(x => x.key === s.key), s)), map: d.map } });
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
    // Joe 11-7-26: the route map has no truck drawing yet and its run order is not the BOL's, so SAVE is ready to send them.
    await f.locator('#mapMsg', { hasText: 'TRUCK LOAD MAP CHANGED' }).waitFor();
    assert.ok(!/LOAD SEQUENCE/.test(await f.locator('#mapMsg').textContent()), 'the load sequences are the route map\'s');
    assert.ok(await f.locator('#lmSave').isEnabled());
    assert.equal(await f.locator('#lmSave').textContent(), 'SAVE TO ROUTE MAP');
    const ralph = f.locator('#lmTable tr', { hasText: 'RALPH' }).locator('input.lseq');
    assert.equal(await ralph.inputValue(), '9', 'the load sequence comes from the route map');
    await ralph.fill('8'); await ralph.dispatchEvent('change');
    await f.locator('#mapMsg', { hasText: '1 LOAD SEQUENCE CHANGED' }).waitFor();
    if (SHOTS) { await f.locator('section.pick').scrollIntoViewIfNeeded(); await p.screenshot({ path: path.join(SHOTS, 'pallet-builder-save-ready-1536.png') }); }
    const fr = p.frame({ url: /about:srcdoc/ }) || p.frames().find(x => x !== p.mainFrame());
    await fr.evaluate(() => { window.print = () => { window.printedAt = Date.now(); }; });
    await f.locator('#lmPrint').click();
    const sheet = await f.locator('#printSheet').textContent();
    assert.match(sheet, /Route: 813/); assert.match(sheet, /Day: Thursday/); assert.match(sheet, /DAIRY QUEEN/);
    assert.ok(/DQ JEANNETTE/.test(sheet) && /DQ RALPH/.test(sheet), 'every customer on the changed sequence is on the sheet');
    assert.ok(await fr.evaluate(() => !!window.printedAt), 'it prints');
    assert.equal(await f.locator('#printSheet tr.chg').count(), 1, 'the changed one is bold');
    await f.locator('#lmSave').click();
    await f.locator('#mapMsg', { hasText: 'SAVED: 11 CUSTOMERS, THEIR LOAD SEQUENCES AND RUN ORDER AND THE TRUCK LOAD MAP' }).waitFor();
    assert.equal(sent.length, 1);
    // Joe 11-8-26: "I want to save and print new sequence too": PRINT NEW SEQUENCE beside SAVE prints what the save changed.
    assert.match(await f.locator('#mapMsg').textContent(), /PRESS PRINT NEW SEQUENCE TO PRINT THE CHANGES\.$/);
    await fr.evaluate(() => { window.printedAt = 0; document.getElementById('printSheet').innerHTML = ''; });
    await f.locator('#lmPrintTop').click();
    assert.ok(await fr.evaluate(() => !!window.printedAt), 'it prints after the save');
    assert.ok(/DQ RALPH/.test(await f.locator('#printSheet').textContent()), 'the saved change is on the sheet');
    assert.equal(await f.locator('#printSheet tr.chg').count(), 1, 'the saved change is bold');
    assert.equal(sent[0].op, 'saveRouteDay'); assert.equal(sent[0].route, '813'); assert.equal(sent[0].day, 'THU'); assert.equal(sent[0].rev, 2);
    assert.deepEqual(sent[0].stops.map(s => s.key).sort(), stops.map(s => s.key).sort(), 'the same stops, none added or lost');
    const keys = sent[0].stops.map(s => s.key);
    assert.equal(keys.indexOf('211567'), keys.indexOf('811496') + 1, 'a customer not on this BOL keeps its place on the route');
    assert.ok(sent[0].map && sent[0].map.cells.length >= 1 && sent[0].map.cells.every(r => r.length === 6), 'the truck drawing goes too, 6 spots a row');
    assert.ok(sent[0].map.cells.some(r => r.includes(8)), 'the pallets carry their load sequences');
    assert.equal(sent[0].stops.find(s => s.key === '40496').loadSeq, 8, 'the new load sequence');
    assert.equal(sent[0].stops[0].note, 'Back door', 'stop notes stay');
    assert.ok(sent[0].stops.every(s => s.key === '40496' || s.loadSeq === stops.find(x => x.key === s.key).loadSeq), 'no other load sequence changes');
    if (SHOTS) { await f.locator('section[aria-label="Truck load map"]').scrollIntoViewIfNeeded(); await p.screenshot({ path: path.join(SHOTS, 'pallet-builder-route-map-1536.png') }); }

    // Joe 11-6-26: at the very top, the customers on the route with their cases; each one's space is held at the highest cases average (shaded on the
    // truck when the BOL has fewer cases); PALLET USES and Pallet Rules save through the Customer List's own call.
    assert.equal(await f.locator('#custTitle').textContent(), 'CUSTOMERS ON ROUTE 813 · THURSDAY');
    const heads = await f.locator('#custTable thead th').allTextContents();
    assert.deepEqual(heads, ['RUN', 'LOAD SEQ', 'CUSTOMER', 'LOW', 'MIDDLE', 'AVERAGE', 'HIGH', 'LAST 5 WEEKS', 'HIGHEST CASES AVERAGE', 'RULE SET MAX', 'PALLET USES', 'HELD FOR', "TODAY'S BOL", 'SPACE']);
    const row1 = f.locator('#custTable tbody tr').first();
    assert.deepEqual((await row1.locator('td').allTextContents()).slice(3, 8), ['10', '25', '25', '40', '25']);
    // Joe 11-9-26: the standard is the highest cases average (40 and 10: the top one thrown out, so 10), in yellow.
    assert.equal(await row1.locator('td.chosen').textContent(), '10', 'the highest cases average is the standard, in yellow');
    // Joe 11-8-26 RULE SET: two weeks (40 and 10), the top one thrown out, so the maximum is 10; it is not the held number.
    assert.equal((await row1.locator('td').nth(9).textContent()).trim(), '10', 'RULE SET MAX');
    assert.equal(await f.locator('#lmTable thead th').nth(7).textContent(), 'Max', 'the truck load map shows it for sequence changes');
    assert.ok(await f.locator('#truck i.held').count() > 0, 'space held for the customers is shaded on the truck');
    assert.match(await f.locator('#custTable').textContent(), /CS HELD, SHADED/);
    const pallets0 = await f.locator('#tiles .tile').nth(1).locator('.v').textContent();
    if (SHOTS) { await f.locator('#custPanel').scrollIntoViewIfNeeded(); await p.screenshot({ path: path.join(SHOTS, 'pallet-builder-customers-1536.png') }); await f.locator('section[aria-label="Truck load map"]').scrollIntoViewIfNeeded(); await p.screenshot({ path: path.join(SHOTS, 'pallet-builder-held-space-1536.png') }); }
    await row1.locator('select.cuses').selectOption('LOW');
    await f.locator('#custTable tbody tr').first().locator('td.chosen', { hasText: '10' }).waitFor();
    const bare = (d) => { const o = Object.assign({}, d); delete o.requestId; delete o.udPlant; return o; };
    assert.deepEqual(bare(caseCalls[0]), { op: 'setPalletUses', plant: 'fac_uniontown', route: '813', day: 'THU', key: stops[0].key, rule: 'LOW' });
    await f.locator('#rulesBtn').click();
    const crates = f.locator('#rulesBox input[data-k="cratesPerPallet"]');
    assert.equal(await crates.inputValue(), '54');
    await crates.fill('27'); await crates.dispatchEvent('change');
    await f.locator('#palLegend', { hasText: '27 per pallet' }).waitFor();
    assert.deepEqual(bare(caseCalls[1]), { op: 'savePalletRules', plant: 'fac_uniontown', rules: { cratesPerPallet: 27 } });
    assert.ok(+(await f.locator('#tiles .tile').nth(1).locator('.v').textContent()) > +pallets0, 'half as many crates to a pallet takes more pallets');
    if (SHOTS) { await f.locator('#custPanel').scrollIntoViewIfNeeded(); await p.screenshot({ path: path.join(SHOTS, 'pallet-builder-pallet-rules-1536.png') }); }
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
    // Joe 11-7-26: BOL DAY says which day is open; DAY BEFORE goes back one BOL day and brings that day's routes in.
    assert.match(await hb.locator('#dayLine').textContent(), /^BOL FOR MONDAY 11-9-26 · 2 ROUTES · RECEIVED 11-9-26 .* · NEWEST BOL$/);
    assert.deepEqual(await hb.locator('#dayPick option').allTextContents(), ['MONDAY 11-9-26', 'SUNDAY 11-8-26', 'THURSDAY 11-5-26']);
    assert.ok(await hb.locator('#dayNext').isDisabled(), 'nothing newer');
    // Joe 11-7-26: the older days are faded, the newest is not.
    assert.deepEqual(await hb.locator('#dayPick option').evaluateAll(o => o.map(x => x.className)), ['', 'old', 'old']);
    assert.ok(!(await hb.locator('#dayPick').evaluate(e => e.classList.contains('old'))), 'the newest day open: not faded');
    assert.ok(await hb.locator('#dayBad').isHidden(), 'the Hub BOL days came: no red line');
    assert.deepEqual(await hb.locator('#routePick optgroup').evaluateAll(g => g.map(x => x.label)), ['ON THE MONDAY 11-9-26 BOL'], 'the routes on the open day, grouped under it');
    const fs16 = await hb.locator('#dayPick, #routePick, #dayLine, #lmSave').evaluateAll(els => els.map(e => parseFloat(getComputedStyle(e).fontSize)));
    assert.ok(fs16.every(n => n >= 16), 'big letters at the top ' + JSON.stringify(fs16));
    await p.waitForTimeout(500);
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'pallet-builder-hub-bol-1536.png') });
    await hb.locator('#dayPrev').click();
    await hb.locator('#dayLine', { hasText: 'BOL FOR SUNDAY 11-8-26' }).waitFor();
    assert.equal(await hb.locator('#route').inputValue(), 'RT 805 · 11/08/26', 'the day before opens on its first route');
    assert.ok(/RT 805 · 11\/08\/26/.test(await hb.locator('#dayTable').textContent()), 'and its routes are brought in');
    assert.ok(await hb.locator('#dayNext').isEnabled());
    assert.ok(await hb.locator('#dayPick').evaluate(e => e.classList.contains('old')), 'an older day open: the day box is faded');
    assert.equal(await hb.locator('#dayLine').evaluate(e => getComputedStyle(e).color), 'rgb(107, 120, 132)', 'and its line');
    await p.waitForTimeout(300);
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'pallet-builder-day-before-1536.png') });
    // Joe 11-8-26: "whenever you're switching the days, it didn't reload the routes": All routes shows only the open day's
    // routes, Open keeps the day, and changing the day opens that day's first route.
    const only = async (tag) => { const names = await hb.locator('#dayTable tbody tr td:first-child').allTextContents();
      return names.filter(n => !/^All routes$/i.test(n) && /\d\/\d/.test(n)).every(n => n.includes(tag)); };
    assert.ok(await only('11/08/26'), 'Sunday open: only Sunday\'s routes are listed');
    // Joe 11-8-26: All routes folds up and opens again, and stays as he left it.
    await hb.locator('#dayToggle').click();
    assert.ok(await hb.locator('#dayWrap').isHidden()); assert.equal(await hb.locator('#dayToggle').textContent(), 'SHOW ROUTES');
    await hb.locator('#dayToggle').click();
    assert.ok(await hb.locator('#dayWrap').isVisible()); assert.equal(await hb.locator('#dayToggle').textContent(), 'HIDE ROUTES');
    await hb.locator('#dayPick').selectOption('2026-11-05');
    await hb.locator('#dayLine', { hasText: 'BOL FOR THURSDAY 11-5-26' }).waitFor();
    assert.ok(await only('11/05'), 'Thursday open: only Thursday\'s routes are listed');
    assert.ok(/ · 11\/05$/.test(await hb.locator('#route').inputValue()), 'and a Thursday route opens');
    await hb.locator('#dayPick').selectOption('2026-11-09');
    await hb.locator('#dayLine', { hasText: 'BOL FOR MONDAY 11-9-26' }).waitFor();
    assert.ok(await only('11/09/26'), 'back on Monday: none of Thursday\'s routes are listed');
    assert.equal(await hb.locator('#route').inputValue(), 'RT 805 · 11/09/26', 'the route box goes to the new day\'s first route');
    await hb.locator('#dayTable button.openR').first().click();
    await p.waitForTimeout(300);
    assert.match(await hb.locator('#dayLine').textContent(), /^BOL FOR MONDAY 11-9-26/, 'Open keeps the day');
    assert.equal(await hb.locator('#route').inputValue(), 'RT 6301 · 11/09/26');
    // A route that does not run on the BOL's day but runs the next day is the next day's load (805 runs Tuesday, not Monday).
    await hb.locator('#routePick').selectOption(await hb.locator('#routePick optgroup').first().locator('option', { hasText: '805' }).getAttribute('value'));
    await hb.locator('#custTitle', { hasText: 'ROUTE 805 · TUESDAY' }).waitFor();
    assert.deepEqual(p.errors, []);
    await hubCtx.close();
    console.log('pallet builder browser test passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
