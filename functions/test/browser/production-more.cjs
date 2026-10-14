'use strict';
/*
 * Browser check of Joe's 10/14 picks for Plant Production ("Let's go with all of your picks", mock-ups A to H):
 *   - the line tablet's six buttons for its kind of line: changeover with its checklist (timed against the standard), CIP wash,
 *     waste by reason, the quality check due now, crew sign-on, shift notes, Up next and each hour; no efficiency on the tablet;
 *   - the HTST tablet: temperature and flow from the hourly chart check, divert and forward flow, the CIP clock;
 *   - the Blow Mold tablet: leak tester rejects, jugs ahead of the filler, the resin lot;
 *   - Production Lines: kind filters, the plant's totals, more on every card, and one line's shift opened by clicking its card;
 *   - Line Targets: the changeover standard and hours between CIP washes save as each box is left.
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
const P = require('../../src/production-rules');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const ADMIN = 'testEmail=admin.test@uniteddairy.com';
const LINE = 'ut_prod_gallon_filler', HTST = 'ut_prod_htst_1', BLOW = 'ut_prod_blow_mold';

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
// Text is 16px or larger on the new pieces (standing UI rule).
async function bigText(page, sel, what) {
  const small = await page.$$eval(sel, els => els.flatMap(e => [e, ...e.querySelectorAll('*')]).filter(e => e.offsetParent && e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
    .map(e => [e.tagName + '.' + e.className, parseFloat(getComputedStyle(e).fontSize)]).filter(x => x[1] < 16));
  assert.deepEqual(small, [], what + ': text 16px or larger');
}
const runOf = async (id, key) => (await db().collection('productionRuns').doc(P.runId(id, key)).get()).data() || {};
const acts = (page) => page.$$eval('#actions button', b => b.map(x => x.firstChild.textContent.trim()));
async function pickFirstProduct(tb) {
  await tb.click(await tb.isVisible('#change-product') ? '#change-product' : '#kind-cards [data-act="product"]');
  await tb.click('#pp-list button[data-product]');
  await tb.waitForFunction(() => !document.getElementById('board').hidden && !/No product picked/.test(document.querySelector('#std-cards').hidden ? document.getElementById('kind-cards').textContent : document.getElementById('prod').textContent));
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date() });
  const browser = await chromium.launch();
  const results = [];
  try {
    // Line Targets: the changeover standard and CIP hours (the production manager sets them, Joe 10/14).
    const lt = await openPage(browser, 1536, 864, '/linetargets.html?line=' + LINE + '&' + ADMIN);
    await lt.waitForSelector('#setup-co');
    assert.equal(await lt.inputValue('#setup-co'), '', 'starts empty');
    await lt.fill('#setup-co', '20');
    await lt.press('#setup-co', 'Tab');
    await lt.waitForFunction(async () => true);
    for (let i = 0; i < 50 && ((await db().collection('productionLines').doc(LINE).get()).data() || {}).changeoverMin !== 20; i++) await new Promise(r => setTimeout(r, 200));
    assert.equal((await db().collection('productionLines').doc(LINE).get()).data().changeoverMin, 20, 'the changeover standard saved when the box was left');
    await lt.fill('#setup-cip', 'lots');
    await lt.press('#setup-cip', 'Tab');
    await lt.waitForFunction(() => /CIP wash every must be a number/.test(document.getElementById('error').textContent));
    await lt.click('#lines button[data-line="' + HTST + '"]');
    await lt.waitForFunction(() => document.getElementById('form-title').textContent === 'HTST #1');
    await lt.fill('#setup-cip', '10');
    await lt.press('#setup-cip', 'Tab');
    for (let i = 0; i < 50 && ((await db().collection('productionLines').doc(HTST).get()).data() || {}).cipHours !== 10; i++) await new Promise(r => setTimeout(r, 200));
    assert.equal((await db().collection('productionLines').doc(HTST).get()).data().cipHours, 10);
    await fits(lt, 'Line Targets at 1536');
    await shot(lt, 'more-line-targets-1536');
    assert.deepEqual(lt.errors, []);
    await lt.close();
    results.push('Line Targets: changeover standard and CIP wash hours save as each box is left; a word is refused');
    await db().collection('productionLines').doc(HTST).set({ lastCipAt: new Date(Date.now() - 6.5 * 3600000).toISOString() }, { merge: true });

    // The filler tablet (mock-ups C, D, E, F).
    const tb = await openPage(browser, 1024, 768, '/line.html?line=' + LINE + '&' + ADMIN);
    await tb.waitForFunction(() => document.getElementById('line-name').textContent === 'GALLON FILLER');
    const shiftKey = await tb.evaluate(() => window.UDProduction.shiftNow([], Date.now()).key);
    assert.deepEqual(await acts(tb), ['Changeover', 'CIP / Sanitation', 'Waste / Rejects', 'Quality Check', 'Crew', 'Shift Notes']);
    assert.equal(await tb.isVisible('#strip'), true, 'Up next and each hour');
    await pickFirstProduct(tb);
    const first = await tb.textContent('#prod');
    await shot(tb, 'more-tablet-filler-1024');
    await fits(tb, 'the filler tablet at 1024');
    await bigText(tb, '#strip, #actions', 'Up next, each hour and the buttons');
    assert.doesNotMatch(await tb.innerText('#screen'), /efficiency/i, 'efficiency is for managers only, not the tablet (Joe 10/14)');
    // Changeover: pick the new product, start, tick a checklist line, done.
    await tb.click('#actions [data-act="changeover"]');
    await tb.waitForSelector('#more-pane:not([hidden])');
    assert.match(await tb.textContent('#mp-badge'), /STANDARD 20 MIN/);
    const to = await tb.$$eval('#mp-body select[data-save="co-to"] option', (o, f) => o.map(x => x.value).filter(v => v && v !== f)[0], first);
    assert.equal(await tb.inputValue('#mp-body select[data-save="co-to"]'), '', 'the drop-down starts blank');
    await tb.selectOption('#mp-body select[data-save="co-to"]', to);
    await tb.click('#mp-body [data-click="co-start"]');
    await tb.waitForSelector('#mp-body [data-click="cocheck"][data-key="purge"]');
    await tb.click('#mp-body [data-click="cocheck"][data-key="purge"]');
    await tb.waitForSelector('#mp-body .lb-check.done[data-key="purge"]');
    await shot(tb, 'more-tablet-changeover-1024');
    await bigText(tb, '#more-pane', 'the changeover pane');
    await tb.click('#mp-close');
    await tb.waitForFunction(() => /CHANGEOVER RUNNING/.test(document.getElementById('status-text').textContent));
    assert.equal(await tb.textContent('#status-btn'), 'CHANGEOVER DONE');
    await tb.click('#status-btn');
    await tb.waitForFunction((p) => document.getElementById('prod').textContent === p && /LINE RUNNING/.test(document.getElementById('status-text').textContent), to);
    let r = await runOf(LINE, shiftKey);
    assert.deepEqual([r.changeovers.length, r.changeovers[0].from, r.changeovers[0].to, Object.keys(r.changeovers[0].checks)], [1, first, to, ['purge']]);
    // Waste by reason.
    await tb.click('#actions [data-act="waste"]');
    await tb.click('#mp-body [data-reason="Leaker"]');
    await tb.fill('#waste-box', '12');
    await tb.press('#waste-box', 'Tab');
    await tb.waitForFunction(() => /12 THIS SHIFT/.test(document.getElementById('mp-badge').textContent));
    await shot(tb, 'more-tablet-waste-1024');
    // The quality check due now.
    await tb.click('#mp-close');
    await tb.click('#actions [data-act="check"]');
    await tb.fill('#mp-body input[data-field="w1"]', '8.62');
    await tb.press('#mp-body input[data-field="w1"]', 'Tab');
    await tb.waitForFunction(() => /1 OF 8 DONE/.test(document.getElementById('mp-badge').textContent));
    assert.equal(await tb.inputValue('#mp-body select[data-field="capSeal"]'), '', 'OK / Not OK starts blank');
    await tb.fill('#mp-body input[data-field="w2"]', 'heavy');
    await tb.press('#mp-body input[data-field="w2"]', 'Tab');
    await tb.waitForFunction(() => /Type a number/.test(document.getElementById('error').textContent));
    await shot(tb, 'more-tablet-check-1024');
    // Crew and notes.
    await tb.click('#mp-close');
    await tb.click('#actions [data-act="crew"]');
    await tb.fill('#mp-body input[data-save="crew-add"]', 'J. Myers');
    await tb.press('#mp-body input[data-save="crew-add"]', 'Tab');
    await tb.waitForSelector('#mp-body .lb-crew button.on[data-name="J. Myers"]');
    await tb.click('#mp-close');
    await tb.click('#actions [data-act="notes"]');
    await tb.fill('#mp-body textarea', 'Valve 14 sticking.');
    await tb.press('#mp-body textarea', 'Tab');
    await tb.waitForFunction(() => /note written/.test(document.querySelector('#actions [data-act="notes"]') ? document.querySelector('#actions [data-act="notes"]').textContent : '') || !document.getElementById('more-pane').hidden);
    for (let i = 0; i < 50 && (await runOf(LINE, shiftKey)).note !== 'Valve 14 sticking.'; i++) await new Promise(r => setTimeout(r, 200));
    await shot(tb, 'more-tablet-notes-1024');
    // CIP wash: the line counts as CIP; the bar's button asks passed or failed.
    await tb.click('#mp-close');
    await tb.click('#actions [data-act="cip"]');
    await tb.click('#mp-body [data-click="cip-start"]');
    await tb.click('#mp-close');
    await tb.waitForFunction(() => /CIP WASH RUNNING/.test(document.getElementById('status-text').textContent));
    await tb.click('#status-btn');
    await tb.click('#mp-body [data-click="cip-pass"]');
    await tb.waitForFunction(() => /LINE RUNNING/.test(document.getElementById('status-text').textContent));
    // Up next.
    await tb.click('#strip [data-act="next"]');
    await tb.selectOption('#mp-body select[data-save="next"]', first);
    await tb.fill('#next-qty', '4000');
    await tb.press('#next-qty', 'Tab');
    for (let i = 0; i < 50 && !((await db().collection('productionLines').doc(LINE).get()).data() || {}).next; i++) await new Promise(r => setTimeout(r, 200));
    await tb.click('#mp-close');
    await tb.waitForFunction(() => /4,000/.test(document.getElementById('strip').textContent));
    r = await runOf(LINE, shiftKey);
    assert.deepEqual(r.waste, { Leaker: 12 });
    assert.equal(Object.values(r.checks)[0].w1, '8.62');
    assert.deepEqual(r.crew.map(c => c.name), ['J. Myers']);
    assert.equal(r.note, 'Valve 14 sticking.');
    assert.deepEqual(r.cips.map(c => c.result), ['PASS']);
    assert.match(await tb.textContent('#actions'), /12 this shift/);
    assert.match(await tb.textContent('#actions'), /1 signed on/);
    await shot(tb, 'more-tablet-filler-after-1024');
    await tb.setViewportSize({ width: 800, height: 1280 });
    await fits(tb, 'the filler tablet at 800');
    await shot(tb, 'more-tablet-filler-800');
    assert.deepEqual(tb.errors, []);
    await tb.close();
    results.push('Filler tablet: changeover timed against the 20-minute standard with its checklist (counts as changeover, not stopped), waste by reason, the quality check due now, crew, notes, CIP wash passed, Up next; no efficiency on the tablet');

    // The HTST tablet (mock-up G).
    const ht = await openPage(browser, 1024, 768, '/line.html?line=' + HTST + '&' + ADMIN);
    await ht.waitForFunction(() => document.getElementById('line-name').textContent === 'HTST #1');
    assert.deepEqual(await acts(ht), ['Divert', 'CIP Wash', 'Silo / Tank', 'Changeover', 'Crew', 'Shift Notes']);
    assert.equal(await ht.isVisible('#std-cards'), false);
    assert.match(await ht.textContent('#kind-cards'), /Pasteurizing temp/);
    assert.match(await ht.textContent('#cip-strip'), /SINCE CIP 6\.5 H/);
    assert.equal(await ht.isVisible('#date-check'), false, 'no code date on the HTST');
    await pickFirstProduct(ht);
    await ht.fill('#check-inline input[data-field="recorder"]', '163.4');
    await ht.press('#check-inline input[data-field="recorder"]', 'Tab');
    await ht.waitForFunction(() => /163\.4°F/.test(document.getElementById('kind-cards').textContent));
    await ht.click('#actions [data-act="divert"]');
    await ht.click('#mp-body [data-click="divert"][data-reason="Low temperature"]');
    await ht.click('#mp-close');
    await ht.waitForFunction(() => /IN DIVERT/.test(document.getElementById('status-text').textContent) && /IN DIVERT/.test(document.getElementById('kind-cards').textContent));
    await shot(ht, 'more-tablet-htst-divert-1024');
    await ht.click('#actions [data-act="divert"]');
    await ht.click('#mp-body [data-click="forward"]');
    await ht.click('#mp-close');
    await ht.waitForFunction(() => /PASTEURIZING/.test(document.getElementById('status-text').textContent));
    await ht.click('#actions [data-act="source"]');
    await ht.fill('#src-from', 'Silo 3');
    await ht.press('#src-from', 'Tab');
    await ht.click('#mp-close');
    await ht.waitForFunction(() => /From Silo 3/.test(document.getElementById('kind-cards').textContent));
    await fits(ht, 'the HTST tablet at 1024');
    await bigText(ht, '#kind-cards, #cip-strip, #check-inline, #actions', 'the HTST cards');
    await shot(ht, 'more-tablet-htst-1024');
    await ht.setViewportSize({ width: 800, height: 1280 });
    await fits(ht, 'the HTST tablet at 800');
    await shot(ht, 'more-tablet-htst-800');
    assert.deepEqual(ht.errors, []);
    await ht.close();
    results.push('HTST tablet: temperature from the hourly chart check, divert with why and back to forward flow, silo and tanks, hours since the last CIP wash of 10');

    // The Blow Mold tablet (mock-up H).
    const bm = await openPage(browser, 1024, 768, '/line.html?line=' + BLOW + '&' + ADMIN);
    await bm.waitForFunction(() => document.getElementById('line-name').textContent === 'BLOW MOLD');
    assert.deepEqual(await acts(bm), ['Mold Change', 'Resin Lot', 'Waste / Rejects', 'Quality Check', 'Crew', 'Shift Notes']);
    await bm.click('#kind-cards [data-act="waste"]');
    assert.equal(await bm.$eval('#mp-body [data-reason="Leak tester"]', e => e.className), 'on', 'Enter Rejects opens on the leak tester');
    await bm.fill('#waste-box', '46');
    await bm.press('#waste-box', 'Tab');
    await bm.waitForFunction(() => /46 THIS SHIFT/.test(document.getElementById('mp-badge').textContent));
    await bm.click('#mp-close');
    await bm.click('#kind-cards [data-act="stock"]');
    await bm.fill('#mp-body input[data-save="stock"]', '2300');
    await bm.press('#mp-body input[data-save="stock"]', 'Tab');
    await bm.click('#mp-close');
    await bm.click('#actions [data-act="lot"]');
    await bm.fill('#mp-body input[data-save="lot"]', 'R-2291');
    await bm.press('#mp-body input[data-save="lot"]', 'Tab');
    await bm.click('#mp-close');
    await bm.waitForFunction(() => /2,300/.test(document.getElementById('kind-cards').textContent) && /R-2291/.test(document.getElementById('kind-cards').textContent));
    await fits(bm, 'the Blow Mold tablet at 1024');
    await shot(bm, 'more-tablet-blow-mold-1024');
    assert.deepEqual(bm.errors, []);
    await bm.close();
    results.push('Blow Mold tablet: leak tester rejects, jugs ahead of the filler and the resin lot');

    // Production Lines (mock-ups A and B).
    for (const [w, h] of [[1536, 864], [1920, 1080]]) {
      const pl = await openPage(browser, w, h, '/production.html?' + ADMIN);
      await pl.waitForFunction(() => document.querySelectorAll('.pd-tile').length === 5);
      assert.deepEqual(await pl.$$eval('#filters button', b => b.map(x => x.firstChild.textContent)), ['All lines', 'Fillers', 'HTST', 'Boxing & Totes', 'Blow Mold', 'Needs attention']);
      assert.match(await pl.textContent('#totals'), /Plant made.*Target so far.*Efficiency.*Stopped.*Waste\s*58.*Next CIP/s);
      assert.match(await pl.textContent('.pd-tile[data-line="' + LINE + '"] .pd-more'), /Crew: J\. Myers/);
      assert.match(await pl.textContent('.pd-tile[data-line="' + LINE + '"] .pd-more'), /Next: .* · 4,000/);
      assert.match(await pl.textContent('#hstats'), /CHANGEOVER|Changeover/);
      await fits(pl, 'Production Lines at ' + w);
      await shot(pl, 'more-production-lines-' + w);
      await pl.click('#filters [data-kind="HTST"]');
      await pl.waitForFunction(() => document.querySelectorAll('.pd-tile').length === 1);
      await pl.click('#filters [data-kind="ALL"]');
      await pl.click('.pd-tile[data-line="' + LINE + '"]');
      await pl.waitForSelector('#detail:not([hidden]) .pd-tl');
      assert.equal(await pl.textContent('#page-title'), 'GALLON FILLER');
      assert.match(await pl.textContent('#detail'), /Hour by hour.*Stops and why.*Waste and rejects.*How the shift is going.*Changeovers.*CIP washes.*Crew and notes.*Quality checks/s);
      assert.match(await pl.textContent('#detail'), /Valve 14 sticking\./);
      assert.match(pl.url(), /line=ut_prod_gallon_filler/);
      await fits(pl, 'one line\'s shift at ' + w);
      await bigText(pl, '#detail, #totals, #filters', 'Production Lines');
      await shot(pl, 'more-line-shift-' + w);
      await pl.click('#tabs [data-tab="' + HTST + '"]');
      await pl.waitForFunction(() => document.getElementById('page-title').textContent === 'HTST #1');
      await pl.goBack();
      await pl.waitForFunction(() => !document.getElementById('tiles').hidden && document.querySelectorAll('.pd-tile').length === 5);
      assert.deepEqual(pl.errors, []);
      await pl.close();
    }
    const tv = await openPage(browser, 1920, 1080, '/production.html?tv=1&' + ADMIN);
    await tv.waitForFunction(() => document.querySelectorAll('.pd-tile').length === 5);
    assert.equal(await tv.$('.pd-more'), null, 'the TV stays as it was');
    assert.equal(await tv.isVisible('#filters'), false);
    assert.doesNotMatch(await tv.innerText('#screen'), /efficiency/i, 'efficiency is for managers only, not the TV (Joe 10/14)');
    await shot(tv, 'more-production-tv-1920');
    assert.deepEqual(tv.errors, []);
    await tv.close();
    results.push('Production Lines: kind filters, the plant\'s totals with efficiency for managers, crew and up next on each card, one line\'s shift from its card; the TV stays as it was, without efficiency');
    console.log('Plant Production picks browser check passed:\n - ' + results.join('\n - '));
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
