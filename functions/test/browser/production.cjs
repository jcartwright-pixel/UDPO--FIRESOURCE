'use strict';
/*
 * Browser check of Plant Production (Joe 10/11: our own RedZone, mock-ups Tablet A, Targets B and TV B):
 *   - while it is being built only an administrator opens it (Joe 10/11); a manager sees the being-built note;
 *   - Line Targets shows each line's products with RedZone's full speed and Target % and works out the target per hour; the
 *     UPC, shelf life and speed range boxes save on the plant's Products list (Joe: one list for everything about a product);
 *   - the line tablet: pick the product, type the count, Line Stopped, tap why, Running Again;
 *   - the speed flashes when the product runs over its highest speed (Joe 10/11), on the tablet and on the TV;
 *   - Production Lines and the TV show every line in green, yellow or red;
 *   - the label reader (Joe 10/11): an administrator makes the line key on Line Targets and starts the sandbox test feed, and the
 *     tablet and TV count the pretend jugs on their own with the code date check; Test Feed on Every Line does the same for
 *     every machine at its own products' speed (Joe 10/11: a test setup for every machine).
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
const RD = require('../../src/reader');
const IDS = ['ut_prod_boxing', 'ut_prod_totes', 'ut_prod_htst_1', 'ut_prod_gallon_filler', 'ut_prod_blow_mold'];

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const ADMIN = 'testEmail=admin.test@uniteddairy.com', MANAGER = 'testEmail=manager.test@uniteddairy.com';
const LINE = 'ut_prod_gallon_filler';

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
const gallon = async () => ((await db().collection('plantProducts').doc(LINE).get()).data() || {}).products || [];

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date() });
  const browser = await chromium.launch();
  const results = [];
  try {
    // Being built: administrators only (app.js's shared Under Construction check refuses every Plant Production screen).
    const mg = await openPage(browser, 1536, 864, '/production.html?' + MANAGER);
    for (const page of ['production.html', 'production.html?tv=1&', 'line.html', 'linetargets.html']) {
      await mg.goto(HOSTING + '/' + page + (page.indexOf('?') < 0 ? '?' : '') + MANAGER);
      await mg.waitForSelector('#uc-refused');
      assert.equal(await mg.textContent('#uc-refused h1'), 'Plant Production is under construction', page);
      assert.equal(await mg.$$eval('.pd-tile, .lt-table, .lb-card', x => x.filter(e => e.offsetParent).length), 0, page + ' shows nothing of the line');
    }
    assert.deepEqual(mg.errors, []);
    await mg.close();
    results.push('Plant Production is administrators only while it is being built (a manager is refused the board, the TV, the tablet and Line Targets)');

    // Line Targets: RedZone's numbers to start, target per hour worked out, boxes save on the Products list.
    for (const w of [1536, 1920]) {
      const h = w === 1536 ? 864 : 1080;
      const lt = await openPage(browser, w, h, '/linetargets.html?line=' + LINE + '&' + ADMIN);
      await lt.waitForFunction(() => document.querySelectorAll('#rows tr').length > 5 && document.getElementById('form-title').textContent === 'GALLON FILLER');
      // Review item 31 (Joe 10/13): no plant drop-down inside a plant.
      assert.equal(await lt.$('#plant'), null, 'no plant drop-down on Line Targets');
      assert.equal(await lt.textContent('#plant-name'), 'Uniontown');
      const first = await lt.$$eval('#rows tr:first-child td', t => t.map(x => x.querySelector('input') ? x.querySelector('input').value : x.textContent));
      assert.deepEqual([first[0], first[4], first[5], first[8]], ['Broughton 2% Gallon', '74', '57.3', '2,544'], 'RedZone\'s Rate/Min and Target % give 2,544 an hour');
      assert.deepEqual(await lt.$$eval('.qc-lines button span', b => b.map(x => x.firstChild.textContent)), ['BOXING', 'TOTES', 'HTST #1', 'GALLON FILLER', 'BLOW MOLD']);
      await fits(lt, 'Line Targets at ' + w);
      const fontMin = await lt.$$eval('#rows td, #rows input, thead th', e => Math.min(...e.map(x => parseFloat(getComputedStyle(x).fontSize))));
      assert.ok(fontMin >= 13, 'table text stays readable: ' + fontMin);
      if (w === 1920) {
        const box = (k) => '#rows tr:first-child input[data-k="' + k + '"]';
        await lt.fill(box('upc'), '070852503050');
        await lt.press(box('upc'), 'Tab');
        await lt.fill(box('shelfLifeDays'), '14');
        await lt.press(box('shelfLifeDays'), 'Tab');
        await lt.fill(box('minSpeed'), '60');
        await lt.press(box('minSpeed'), 'Tab');
        // The highest speed's save is held back, so the refusal below lands while it is still going.
        let release; const held = new Promise(r => { release = r; });
        const hold = async r => { if (/saveMachineProducts/.test(r.request().postData() || '')) await held; await r.continue(); };
        await lt.route('**/save', hold);
        await lt.fill(box('maxSpeed'), '70');
        await lt.press(box('maxSpeed'), 'Tab');
        // A lowest speed above the highest is refused before it is sent.
        await lt.fill(box('minSpeed'), '90');
        await lt.press(box('minSpeed'), 'Tab');
        await lt.waitForFunction(() => /lowest speed is higher/.test(document.getElementById('error').textContent));
        release();
        await lt.waitForFunction(() => /Saved/.test(document.getElementById('foot').textContent));
        await lt.unroute('**/save', hold);
        for (let i = 0; i < 40; i++) { const p = (await gallon())[0] || {}; if (p.maxSpeed === 70) break; await lt.waitForTimeout(250); }
        const p = (await gallon())[0];
        assert.deepEqual([p.name, p.upc, p.shelfLifeDays, p.minSpeed, p.maxSpeed, p.ratePerMin, p.targetPct], ['Broughton 2% Gallon', '070852503050', 14, 60, 70, 74, 57.3], 'saved on the Gallon Filler\'s Products list');
        // The earlier save finishing does not wipe the message.
        assert.match(await lt.textContent('#error'), /lowest speed is higher/, 'the refusal stays on screen after the earlier save finishes');
        await lt.reload();
        await lt.waitForFunction(() => document.querySelectorAll('#rows tr').length > 5);
        assert.equal(await lt.inputValue(box('minSpeed')), '60');
      }
      await shot(lt, 'line-targets-' + w);
      assert.deepEqual(lt.errors, []);
      await lt.close();
    }
    results.push('Line Targets: RedZone\'s speeds and Target % to start with target per hour worked out; UPC, shelf life and speed range save on the plant\'s Products list; no sideways scrolling at 1536 or 1920');

    // The line tablet: product, count, stopped, why, running again.
    const tb = await openPage(browser, 1280, 800, '/line.html?line=' + LINE + '&' + ADMIN);
    await tb.waitForFunction(() => document.getElementById('line-name').textContent === 'GALLON FILLER');
    assert.equal(await tb.textContent('#prod'), 'No product picked');
    await tb.click('#change-product');
    await tb.fill('#pp-find', 'Broughton 2%');
    await tb.click('#pp-list button[data-product="Broughton 2% Gallon"]');
    await tb.waitForFunction(() => document.getElementById('prod').textContent === 'Broughton 2% Gallon');
    assert.match(await tb.textContent('#prod-sub'), /SKU 50305 · target 2,544 an hour/);
    assert.match(await tb.textContent('#date-check'), /OCT|NOV/, 'today\'s code from the 14-day shelf life');
    await tb.click('#enter-count');
    await tb.fill('#count-box', '1250');
    // Review item 38 (Joe 10/13): no Save Count button; leaving the box saves the count, once.
    assert.equal(await tb.$('#count-save'), null, 'no Save Count button');
    await tb.press('#count-box', 'Tab');
    await tb.waitForFunction(() => document.getElementById('made').textContent === '1,250');
    await tb.click('#status-btn');
    await tb.waitForFunction(() => /LINE STOPPED/.test(document.getElementById('status-text').textContent) && document.querySelectorAll('#reasons button').length === 12);
    await shot(tb, 'line-tablet-stopped-1280');
    await tb.click('#reasons button[data-reason="Caser jam"]');
    await tb.waitForFunction(() => document.querySelector('#reasons button.on') && document.querySelector('#reasons button.on').textContent === 'Caser jam');
    await tb.click('#status-btn');
    await tb.waitForFunction(() => /LINE RUNNING/.test(document.getElementById('status-text').textContent) && document.getElementById('reasons').hidden);
    const shiftKey = await tb.evaluate(() => window.UDProduction.shiftNow([], Date.now()).key);
    const run = (await db().collection('productionRuns').doc(P.runId(LINE, shiftKey)).get()).data();
    assert.equal(run.product, 'Broughton 2% Gallon');
    assert.equal(run.count, 1250);
    assert.equal((run.counts || []).length, 1, 'leaving the box saved the count once, not twice');
    assert.equal(run.stops.length, 1);
    assert.equal(run.stops[0].reason, 'Caser jam');
    assert.ok(run.stops[0].end, 'running again ends the stop');
    // Enter saves the count too, and the box being left afterwards does not save it a second time.
    await tb.click('#enter-count');
    await tb.fill('#count-box', '1300');
    await tb.press('#count-box', 'Enter');
    await tb.evaluate(() => { const b = document.getElementById('count-box'); b.dispatchEvent(new Event('change', { bubbles: true })); b.blur(); });
    await tb.waitForFunction(() => document.getElementById('made').textContent === '1,300');
    await new Promise(r => setTimeout(r, 1000));
    assert.equal(((await db().collection('productionRuns').doc(P.runId(LINE, shiftKey)).get()).data().counts || []).length, 2, 'Enter then leaving the box is one save');
    assert.deepEqual(tb.errors, []);
    results.push('Line tablet: pick the product, type the count, Line Stopped shows the twelve reasons, tap why, Running Again; all saved on the line\'s shift');

    // Joe 10/11: the speed flashes when it is over the product's highest speed. A shift as the label reader would leave it.
    const t0 = Date.now(), iso = (min) => new Date(t0 - min * 60000).toISOString();
    await db().collection('productionRuns').doc(P.runId(LINE, shiftKey)).set(Object.assign({}, run, {
      count: 13480, counts: [{ at: iso(240), count: 2400 }, { at: iso(3), count: 13240 }, { at: iso(0), count: 13480 }],
      runs: [{ product: 'Broughton 2% Gallon', sku: '50305', from: iso(330) }], stops: run.stops.concat([{ start: iso(200), end: iso(188), reason: '' }]),
      reader: { dateOk: true, lastDate: '', read: 13471, unreadable: 9, lastMissingAt: iso(150) } }));
    await db().collection('productionLines').doc(LINE).set({ operationId: LINE, line: 'GALLON FILLER', facilityId: 'fac_uniontown', counter: 'READER' });
    const others = [['ut_prod_boxing', 'UD 2% 5 Gal Disp Bag', 420], ['ut_prod_totes', 'VENTURA .5% 06984 BML...', 6]];
    for (const [id, product, count] of others) {
      await db().collection('productionRuns').doc(P.runId(id, shiftKey)).set({ operationId: id, facilityId: 'fac_uniontown', shiftKey, date: run.date, shiftStart: run.shiftStart, shiftEnd: run.shiftEnd, product, count, counts: [], runs: [{ product, from: iso(330) }], stops: [] });
    }
    await tb.waitForFunction(() => document.getElementById('speed-card').classList.contains('lb-flash'));
    assert.equal(await tb.textContent('#speed'), '80 / min');
    assert.equal(await tb.textContent('#speed-flag'), 'TOO FAST');
    assert.match(await tb.textContent('#live'), /Label reader on/);
    assert.equal(await tb.$('#enter-count:not([hidden])'), null, 'no typed count when the reader counts');
    assert.match(await tb.textContent('#status-text'), /NEEDS A REASON/);
    await shot(tb, 'line-tablet-1280');
    await tb.setViewportSize({ width: 390, height: 844 });
    await fits(tb, 'the line tablet on a phone');
    await shot(tb, 'line-tablet-phone-390');
    await tb.close();
    results.push('Line tablet: the speed flashes TOO FAST over the product\'s highest speed; with a label reader the count is not typed; a stop with no reason asks for one');

    // Production Lines and the TV: every line in green, yellow or red; the speed flag shows there too.
    for (const [w, h] of [[1536, 864], [1920, 1080]]) {
      const pl = await openPage(browser, w, h, '/production.html?' + ADMIN);
      await pl.waitForFunction(() => document.querySelectorAll('.pd-tile').length === 5);
      assert.ok(await pl.$('.pd-tile.flash[data-line="' + LINE + '"]'), 'the Gallon Filler flashes');
      assert.match(await pl.textContent('.pd-tile[data-line="' + LINE + '"] .pd-speed'), /TOO FAST 80\/MIN/);
      assert.equal(await pl.$('#plant'), null, 'no plant drop-down on Production Lines (review item 31)');
      assert.deepEqual(await pl.$$eval('.sidemenu > a:not(.side-name)', a => a.map(x => x.textContent.trim())), ['Line Tablet', 'Line Targets', 'Production TV']);
      await fits(pl, 'Production Lines at ' + w);
      await shot(pl, 'production-lines-' + w);
      assert.deepEqual(pl.errors, []);
      await pl.close();
    }
    const tvp = await openPage(browser, 1920, 1080, '/production.html?tv=1&' + ADMIN);
    await tvp.waitForFunction(() => document.querySelectorAll('.pd-tile').length === 5);
    assert.equal(await tvp.$eval('.topbar', e => getComputedStyle(e).display), 'none', 'the TV has no app header');
    assert.equal(await tvp.$eval('.pd-tile[data-line="ut_prod_blow_mold"]', e => e.className), 'pd-tile x', 'a line with nothing this shift is grey');
    await shot(tvp, 'production-tv-1920');
    assert.deepEqual(tvp.errors, []);
    await tvp.close();
    results.push('Production Lines and the TV: every line green, yellow or red with made against target; the speed flag flashes there too; the TV has no app header');
    // The label reader: the line key and the test feed's pretend jugs (Joe 10/11: watch the Gallon Filler count on its own).
    await db().collection('productionRuns').doc(P.runId(LINE, shiftKey)).delete();
    const lt = await openPage(browser, 1536, 864, '/linetargets.html?line=' + LINE + '&' + ADMIN);
    await lt.waitForSelector('#reader:not([hidden]) #make-key');
    assert.match(await lt.textContent('#reader'), /cloudfunctions\.net\/deviceReads/);
    await lt.click('#make-key');
    await lt.waitForSelector('#reader-key');
    const key = await lt.textContent('#reader-key');
    assert.ok(key.length >= 24, 'a long key');
    assert.equal(((await db().collection('private').doc('readDevices').get()).data() || {})[LINE].hash, RD.hash(key), 'only its hash is kept');
    // Review item 33 (Joe 10/13): app buttons (the blue edge and words), not the browser's grey ones.
    assert.deepEqual(await lt.$$eval('#start-feed, #start-all', bs => bs.map(b => { const c = getComputedStyle(b); return [c.backgroundColor, c.borderTopColor === c.color]; })), [['rgb(255, 255, 255)', true], ['rgb(255, 255, 255)', true]]);
    await lt.click('#start-feed');
    await lt.waitForFunction(() => /Test feed running/.test(document.getElementById('reader').textContent));
    // Twenty minutes of the feed, as if it had started twenty minutes ago (so the target so far and the speed read as on the line).
    // The tablet shows only the current shift, so the feed never starts before the shift did: in a shift's first twenty minutes
    // part of it runs ahead of the clock, still on this shift (a shift lasts hours).
    const runFeed = async (ids, minutes) => {
      const feedStart = Math.max(Date.now() - minutes * 60000, Date.parse(RD.plantShift(null, Date.now()).start));
      for (const id of ids) await db().collection('productionLines').doc(id).set({ testFeed: { startedAt: new Date(feedStart).toISOString() } }, { merge: true });
      for (let m = 0; m < minutes; m++) await RD.readerMinute(db(), { now: () => new Date(feedStart + m * 60000), project: 'demo-ud-distribution' });
    };
    await runFeed([LINE], 20);
    await fits(lt, 'Line Targets with the reader panel');
    await shot(lt, 'line-targets-reader-1536');
    assert.deepEqual(lt.errors, []);
    const rt = await openPage(browser, 1280, 800, '/line.html?line=' + LINE + '&' + ADMIN);
    await rt.waitForFunction(() => Number((document.getElementById('made').textContent || '0').replace(/,/g, '')) > 1200);
    assert.match(await rt.textContent('#prod'), /Broughton 2% Gallon/, 'the reader picked the product by its UPC');
    assert.match(await rt.textContent('#date-check'), /CODE DATE|jugs read/);
    assert.match(await rt.textContent('#live'), /Label reader on/);
    await shot(rt, 'line-tablet-reader-1280');
    assert.deepEqual(rt.errors, []);
    await rt.close();
    const rtv = await openPage(browser, 1920, 1080, '/production.html?tv=1&' + ADMIN);
    await rtv.waitForFunction((l) => { const t = document.querySelector('.pd-tile[data-line="' + l + '"] .pd-made b'); return t && Number(t.textContent.replace(/,/g, '')) > 1200; }, LINE);
    await shot(rtv, 'production-tv-reader-1920');
    await rtv.close();
    await lt.click('#stop-feed');
    await lt.waitForFunction(() => /Start Test Feed/.test(document.getElementById('reader').textContent));
    results.push('Label reader: an administrator makes the line key (kept only as a hash) and starts the test feed; the tablet and the TV count the pretend jugs with the product from its UPC; Stop Test Feed stops it');
    // Joe 10/11: a test setup for every machine. Test Feed on Every Line counts each line at its own products' full speed; a line
    // counted by typing switches to Label reader for the test and back when it stops.
    for (const id of IDS) await db().collection('productionRuns').doc(P.runId(id, shiftKey)).delete();
    await lt.click('[data-line="ut_prod_boxing"]');
    await lt.waitForFunction(() => /counted by typing/.test(document.getElementById('reader').textContent));
    assert.equal(await lt.$('#make-key'), null, 'no line key until the line is counted by a label reader');
    await lt.click('#start-all');
    await lt.waitForFunction(() => /Test feed on 5 lines/.test(document.getElementById('reader').textContent));
    await lt.waitForSelector('#stop-all');
    for (const id of IDS) assert.equal((await db().collection('productionLines').doc(id).get()).data().counter, 'READER', id + ' counts by the reader for the test');
    await runFeed(IDS, 20);
    const made = {};
    for (const id of IDS) made[id] = (await db().collection('productionRuns').doc(P.runId(id, shiftKey)).get()).data().count;
    assert.ok(made.ut_prod_boxing > 100 && made.ut_prod_boxing < 400, 'Boxing at its own speed (8 to 12 a minute): ' + made.ut_prod_boxing);
    assert.ok(made.ut_prod_gallon_filler > 1200, 'the Gallon Filler at about 74 a minute: ' + made.ut_prod_gallon_filler);
    assert.ok(made.ut_prod_totes > 0 && made.ut_prod_totes < 60, 'Totes at about 1 a minute: ' + made.ut_prod_totes);
    await shot(lt, 'line-targets-every-line-1536');
    const etv = await openPage(browser, 1920, 1080, '/production.html?tv=1&' + ADMIN);
    await etv.waitForFunction((ids) => ids.every(l => { const t = document.querySelector('.pd-tile[data-line="' + l + '"] .pd-made b'); return t && Number(t.textContent.replace(/,/g, '')) > 0; }), IDS);
    await shot(etv, 'production-tv-every-line-1920');
    assert.deepEqual(etv.errors, []);
    await etv.close();
    await lt.click('#stop-all');
    await lt.waitForFunction(() => /Test feed stopped on 5 lines/.test(document.getElementById('reader').textContent));
    assert.equal((await db().collection('productionLines').doc('ut_prod_boxing').get()).data().counter, 'TABLET', 'Boxing is typed again');
    assert.equal((await db().collection('productionLines').doc(LINE).get()).data().counter, 'READER', 'the Gallon Filler stays on its reader');
    assert.deepEqual(lt.errors, []);
    await lt.close();
    results.push('Test Feed on Every Line: every machine counts on its own at its products\' full speed on the TV; Stop Every Test Feed puts typed lines back to typing');
    console.log('Plant Production browser check passed:\n - ' + results.join('\n - '));
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
