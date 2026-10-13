'use strict';
/*
 * Browser check of the Safety Walkthrough (Joe 10/12, mock-ups A, B, D, E and F):
 *   - while it is being built only an administrator opens it; a manager sees the Under Construction note;
 *   - the plant home shows it as a seventh card next to Reports (four a row, all seven on one screen);
 *   - the weekly walk: Good and Not good, a note and Send to Plant Maintenance that save as they are left; the counts follow;
 *     every item starts Not checked; the month's first walk has the monthly items;
 *   - the Not good shows on Open Issues and at the top of the next walk to review;
 *   - Fire Extinguishers: the empty row adds one; Check opens the big-button check; all Good makes the month GOOD;
 *   - Joe 10/13: Fire Alarm, Fire Suppression and Escape Plan, a monthly big-button check of each with its dates;
 *   - every screen fits 1536 and 1920 with no sideways scrolling and 16px text; the walk works on a tablet (one column).
 *   - Joe 10/12: photos on any item (up to three) from the tablet camera; they show on the item, Open Issues and Past Walks.
 *   - Joe 10/12: iPad (Safari) and Android (Chrome) tablets in both directions and an Android phone: every safety screen
 *     fits with big buttons and 16px text; with no internet, taps, notes and photos are held on the device (also across a
 *     reload with no signal, the screens coming from the device) and sent by themselves when the connection is back.
 * Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');
const S = require('../../src/safety-rules');
const L = require('../../src/logic');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const ADMIN = 'testEmail=admin.test@uniteddairy.com', MANAGER = 'testEmail=manager.test@uniteddairy.com';
const UT = 'fac_uniontown';

async function openPage(browser, width, height, url) {
  // The offline screen cache (sw.js) is checked on its own below, on tablets and a phone.
  const page = await browser.newPage({ viewport: { width, height }, timezoneId: 'America/New_York', serviceWorkers: 'block' });
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
  // The screen's own area ends inside the window; its list scrolls inside it. On a phone the whole page scrolls instead.
  if (page.viewportSize().width <= 600) {
    const w = await page.evaluate(() => ({ scroll: document.scrollingElement.scrollWidth, inner: window.innerWidth, wide: [...document.querySelectorAll('#screen *')].filter(e => e.offsetParent && e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('.sw-areas')).map(e => e.tagName + '.' + e.className).slice(0, 5) }));
    assert.ok(w.scroll <= w.inner && !w.wide.length, what + ' has no sideways scrolling: ' + JSON.stringify(w));
    return;
  }
  const size = await page.evaluate(() => ({ scroll: document.scrollingElement.scrollWidth, inner: window.innerWidth, bottom: Math.max(...[...document.querySelectorAll('#screen .view:not([hidden])')].map(v => v.getBoundingClientRect().bottom)), height: window.innerHeight }));
  assert.ok(size.scroll <= size.inner, what + ' has no sideways scrolling: ' + JSON.stringify(size));
  assert.ok(size.bottom <= size.height, what + ' fits one page (its list scrolls inside): ' + JSON.stringify(size));
}
async function smallest(page, sel) { return page.$$eval(sel, e => Math.min(...e.filter(x => x.offsetParent && x.textContent.trim()).map(x => parseFloat(getComputedStyle(x).fontSize)))); }
// The text below 16px, to name it when a check fails.
async function tiny(page, sel) { return page.$$eval(sel, e => e.filter(x => x.offsetParent && x.textContent.trim() && parseFloat(getComputedStyle(x).fontSize) < 16).map(x => x.tagName + '.' + x.className + ' ' + getComputedStyle(x).fontSize + ' "' + x.textContent.trim().slice(0, 30) + '"').slice(0, 6)); }
const row = (id) => '#list tr[data-row="' + id + '"]';
// + Photo on a row opens the device camera (one camera box for the whole list); the test hands it a picture.
async function takePhoto(page, itemId, color) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#list [data-cam="' + itemId + '"]')]);
  await chooser.setFiles(await cameraShot(page, color));
}
// A device the way Joe carries it round the plant (Playwright's iPad Safari / Android Chrome viewport and user agent), with
// the offline screen cache on. Routing on the context also serves the Firebase code to the service worker.
async function openDevice(browser, name, url) {
  const ctx = await browser.newContext(Object.assign({}, devices[name], { timezoneId: 'America/New_York', serviceWorkers: 'allow' }));
  await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    // gstatic allows any site to read the Firebase code (the screen cache keeps a copy), so the stand-in does too.
    route.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  // The first visit keeps the screens and the Firebase code on the device; later screens and visits with no signal use them.
  await page.waitForFunction(async () => { if (!navigator.serviceWorker.controller) return false; const c = await caches.open('ud-offline-v1'); return !!(await c.match('safety-issues.html')) && !!(await c.match('js/offline-saves.js')) && !!(await c.match('js/firebase.js')) && (await Promise.all((await import('/js/firebase.js')).FIREBASE_FILES.map(u => c.match(u)))).every(Boolean); }, null, { timeout: 20000 });
  page.errors = errors;
  page.ctx = ctx;
  return page;
}
// A small real JPEG, as the camera would give.
async function cameraShot(page, color) {
  const data = await page.evaluate((c) => { const k = document.createElement('canvas'); k.width = 320; k.height = 240; const g = k.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, 320, 240); g.fillStyle = '#fff'; g.fillRect(40, 40, 120, 80); return k.toDataURL('image/jpeg', 0.8); }, color);
  return { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(data.split(',')[1], 'base64') };
}


(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date() });
  const today = L.localDay(new Date().toISOString()), lastWeek = L.addDays(today, -7);
  // An issue from an earlier walk to review, and one extinguisher already on the list.
  await db().collection('safetyIssues').doc('old_issue').set({ facilityId: UT, itemId: 'floors', area: 'Housekeeping & Floors', item: 'Floors free of standing water, milk and oil; drains open', note: 'Drain by the gallon filler backing up',
    status: 'OPEN', foundOn: lastWeek, foundWalk: S.walkId(UT, lastWeek), foundByName: 'Test Manager', walks: [S.walkId(UT, lastWeek)], sendToMaint: false, photo: false });
  await db().collection('extinguishers').doc(S.extId(UT, '01')).set({ facilityId: UT, tag: '01', location: 'Front office hallway', type: 'ABC', size: '10 lb', annualDue: L.addDays(today, 20), status: 'ACTIVE', checks: {} });
  const browser = await chromium.launch();
  const results = [];
  try {
    // Being built: administrators only.
    const mg = await openPage(browser, 1536, 864, '/safety.html?' + MANAGER);
    for (const page of ['safety.html', 'safety-issues.html', 'extinguishers.html', 'safety-walks.html', 'safety-setup.html']) {
      await mg.goto(HOSTING + '/' + page + '?' + MANAGER);
      await mg.waitForSelector('#uc-refused');
      assert.equal(await mg.textContent('#uc-refused h1'), 'Safety Walkthrough is under construction', page);
      assert.equal(await mg.$$eval('#list tr, .sw-grid tbody tr', x => x.filter(e => e.offsetParent).length), 0, page + ' shows nothing');
    }
    assert.deepEqual(mg.errors, []);
    await mg.close();
    results.push('Safety Walkthrough is administrators only while it is being built (a manager is refused every screen)');

    // The plant home: seven cards, Safety Walkthrough next to Reports, all on one screen at 1536 and 1920.
    for (const [w, h] of [[1536, 864], [1920, 1080]]) {
      const home = await openPage(browser, w, h, '/index.html?' + ADMIN);
      await home.evaluate(() => sessionStorage.setItem('udPlant', 'fac_uniontown'));
      await home.goto(HOSTING + '/index.html?' + ADMIN);
      await home.waitForSelector('.launch-card[data-side="safety"]');
      await home.waitForTimeout(400);
      assert.deepEqual(await home.$$eval('.launch-card', c => c.map(x => x.dataset.side)), ['plant', 'production', 'pmaint', 'distribution', 'fleet', 'reports', 'safety']);
      assert.equal(await home.$eval('.launch-card[data-side="safety"]', c => c.classList.contains('building') && !!c.querySelector('.uc-banner') && !!c.querySelector('svg.launch-icon')), true, 'the card has its icon and the Under Construction banner');
      const box = await home.evaluate(() => ({ bottom: Math.max(...[...document.querySelectorAll('.launch-card')].map(c => c.getBoundingClientRect().bottom)), inner: innerHeight, tops: [...new Set([...document.querySelectorAll('.launch-card')].map(c => Math.round(c.getBoundingClientRect().top)))].length }));
      assert.ok(box.bottom <= box.inner, 'the seven cards fit ' + w + ': ' + JSON.stringify(box));
      assert.equal(box.tops, 2, 'two rows');
      await shot(home, 'safety-home-' + w);
      assert.deepEqual(home.errors, []);
      await home.close();
    }
    results.push('The plant home shows Safety Walkthrough as a seventh card next to Reports, under construction, all seven on one screen at 1536 and 1920');

    // The walk.
    const wk = await openPage(browser, 1920, 1080, '/safety.html?' + ADMIN);
    // Joe 10/12 (mock-up A): Plant, Garage and Office fold open like folders; the walk starts at the first sub-area.
    await wk.waitForSelector(row('dock_chocks'));
    const tree = () => wk.$$eval('#areas button', b => b.map(x => x.firstChild.textContent));
    const P = S.places(S.checklist(null));
    assert.deepEqual(await tree(), ['Open issues from earlier walks', 'Plant'].concat(P[0].areas.map(a => a.name), ['Garage', 'Office', 'Yard', 'Walk notes']), 'Plant is open with its sub-areas; Garage, Office and Yard are folded');
    assert.match(await wk.textContent('#areas [data-place="Garage"] small'), /^0 of \d+ · Show$/);
    assert.equal(await wk.textContent('#list section h2'), 'Plant \u203a Receiving & Docks');
    await wk.click('#areas [data-place="Garage"]');
    assert.deepEqual((await tree()).slice(-9), ['Garage'].concat(P[1].areas.map(a => a.name), ['Office', 'Yard', 'Walk notes']), 'Show opens Garage');
    await wk.click('#areas [data-place="Garage"]');
    // The earlier issue (floors) shows in the sub-area where it was found; Next goes on in walking order.
    await wk.click('#areas [data-area="processing"]');
    await wk.waitForSelector('#list .sw-here + table tr[data-issue-row="old_issue"]');
    assert.equal(await wk.textContent('#list .sw-next'), 'Next: Plant \u203a Ammonia Room \u2192');
    await wk.click('#list .sw-next');
    assert.equal(await wk.textContent('#list section h2'), 'Plant \u203a Ammonia Room');
    await shot(wk, 'safety-walk-subarea-1920');
    // All in order: every sub-area in one long list (kept on this device).
    await wk.click('#list [data-mode="all"]');
    await wk.waitForSelector(row('exit_routes'));
    await wk.waitForSelector('#list section[data-sec="issues"] tr[data-issue-row="old_issue"]');
    assert.equal(await wk.textContent('#title'), 'Weekly Walk ' + Number(today.slice(5, 7)) + '-' + Number(today.slice(8)) + '-' + today.slice(2, 4));
    assert.ok(await wk.$(row('ext_monthly')), 'the month\'s first walk has the monthly items');
    assert.equal(await wk.textContent(row('exit_routes') + ' .sw-state'), 'Not checked');
    // Joe 10/12: every row has a note box, marked or not.
    assert.equal(await wk.$$eval('#list tr[data-row]', r => r.filter(x => !x.querySelector('input[data-note]')).length), 0, 'every row has a note box');
    await wk.click(row('exit_routes') + ' .sw-btn.good');
    await wk.waitForFunction(() => document.querySelector('#save-pill') && /Saved/.test(document.querySelector('#save-pill').textContent));
    await wk.click(row('panel_labels') + ' .sw-btn.bad');
    await wk.waitForSelector('#list tr[data-more="panel_labels"]');
    assert.equal(await wk.getAttribute('#list input[data-note="panel_labels"]', 'placeholder'), 'What is wrong');
    await wk.fill('#list input[data-note="panel_labels"]', 'LP-3 missing breaker labels');
    await wk.click('#title');
    await wk.fill('#list input[data-note="exit_routes"]', 'Door 4 sticks but opens');
    await wk.click('#title');
    await wk.fill('#list input[data-rnote="old_issue"]', 'Drain cleaned, still slow');
    await wk.click('#title');
    await wk.click('#areas button[data-area="notes"]');
    await wk.fill('#walk-note', 'Walked with the new second-shift lead.');
    await wk.click('#title');
    // Joe 10/12: photos on any item from the camera: a Good item and a Not good item.
    assert.equal(await wk.$$eval('#list tr[data-row]', r => r.filter(x => !x.querySelector('button[data-cam]')).length), 0, 'every row has + Photo');
    assert.equal(await wk.getAttribute('#camera', 'capture'), 'environment', '+ Photo opens the back camera');
    await takePhoto(wk, 'exit_routes', '#1d7a3e');
    await wk.waitForSelector(row('exit_routes') + ' .sw-thumbs img');
    await takePhoto(wk, 'panel_labels', '#c62828');
    await wk.waitForSelector(row('panel_labels') + ' .sw-thumbs img');
    await wk.check('#list input[data-maint="panel_labels"]');
    await wk.click('#list section[data-sec="issues"] tr[data-issue-row="old_issue"] .sw-btn.open');
    const saved = async () => (await db().collection('safetyWalks').doc(S.walkId(UT, today)).get()).data();
    for (let i = 0; i < 40; i++) { const w = await saved(); if (w && w.items.panel_labels && w.items.panel_labels.maint && w.reviews && w.reviews.old_issue && w.reviews.old_issue.status && w.note && (w.items.exit_routes.photoIds || []).length && (w.items.panel_labels.photoIds || []).length) break; await wk.waitForTimeout(250); }
    const w = await saved();
    assert.deepEqual([w.items.exit_routes.status, w.items.panel_labels.status, w.items.panel_labels.note, w.items.panel_labels.maint, w.reviews.old_issue.status], ['GOOD', 'NOT_GOOD', 'LP-3 missing breaker labels', true, 'OPEN']);
    assert.deepEqual([w.items.exit_routes.note, w.reviews.old_issue.note, w.note], ['Door 4 sticks but opens', 'Drain cleaned, still slow', 'Walked with the new second-shift lead.'], 'the row, review and walk notes saved');
    assert.deepEqual([w.items.exit_routes.photoIds.length, w.items.panel_labels.photoIds.length], [1, 1], 'a photo on a Good item and on a Not good item');
    assert.match((await db().collection('safetyPhotos').doc(w.items.exit_routes.photoIds[0]).get()).data().data, /^data:image\/jpeg;base64,/);
    assert.match(await wk.textContent('#counts'), /^1 Good · 1 Not good · \d+ Not checked/);
    assert.equal(await wk.getAttribute('#list section[data-sec="issues"] tr[data-issue-row="old_issue"] .sw-btn.open', 'aria-pressed'), 'true');
    await fits(wk, 'The walk at 1920');
    assert.ok(await smallest(wk, '#list td, #list .sw-btn, #areas button, #list textarea, #list input[type="text"]') >= 15, 'walk text stays readable');
    await shot(wk, 'safety-walk-1920');
    await wk.setViewportSize({ width: 1536, height: 864 });
    await wk.waitForTimeout(300);
    await fits(wk, 'The walk at 1536');
    await shot(wk, 'safety-walk-1536');
    // A tablet: one column, the areas a row of buttons, the buttons big.
    await wk.setViewportSize({ width: 1024, height: 768 });
    await wk.waitForTimeout(300);
    await fits(wk, 'The walk on a tablet');
    const tb = await wk.$eval(row('floors') + ' .sw-btn.good', b => b.getBoundingClientRect().height);
    assert.ok(tb >= 44, 'tablet buttons are big enough for a finger: ' + tb);
    await shot(wk, 'safety-walk-tablet-1024');
    assert.deepEqual(wk.errors, []);
    await wk.close();
    results.push('The walk: Good and Not good save on a tap, every row has a note box (a Good row, a Not good row and an earlier issue each got one), Walk notes saves for the whole walk, Send to Plant Maintenance saves as it is left, an earlier issue is reviewed Still open; counts follow; fits 1536, 1920 and a tablet');

    // Open Issues lists the new Not good and the older one.
    const oi = await openPage(browser, 1536, 864, '/safety-issues.html?' + ADMIN);
    await oi.waitForFunction(() => document.querySelectorAll('#rows tr[data-id]').length === 2);
    assert.match(await oi.textContent('#rows'), /Breakers labeled, no open holes in panels/);
    assert.match(await oi.textContent('#rows'), /Waiting for Plant Maintenance/);
    assert.match(await oi.textContent('#rows'), /7 DAYS/);
    await oi.waitForSelector('#rows tr[data-id$="panel_labels"] .sw-thumbs img');
    assert.match(await oi.textContent('#rows tr[data-id="old_issue"]'), /Latest note \d+-\d+-\d+, Test Admin: Drain cleaned, still slow/);
    await fits(oi, 'Open Issues at 1536');
    await shot(oi, 'safety-issues-1536');
    const fixBtn = '#rows tr[data-id="old_issue"] [data-op="fixed"]';
    await oi.click(fixBtn);
    assert.equal(await oi.textContent(fixBtn), 'Press again');
    await oi.click(fixBtn);
    await oi.waitForFunction(() => document.querySelectorAll('#rows tr[data-id]').length === 1);
    // The screen shows it Fixed at once (it is also held on the device with no signal); the server has it a moment later.
    const fixedNow = async () => (await db().collection('safetyIssues').doc('old_issue').get()).data().status;
    for (let i = 0; i < 40 && await fixedNow() !== 'FIXED'; i++) await oi.waitForTimeout(250);
    assert.equal(await fixedNow(), 'FIXED');
    assert.deepEqual(oi.errors, []);
    await oi.close();
    results.push('Open Issues: the walk\'s Not good shows with Waiting for Plant Maintenance and the older one with its days open; Mark Fixed (pressed twice) takes it off the open list');

    // Fire Extinguishers: add one, check it, all Good.
    const ex = await openPage(browser, 1920, 1080, '/extinguishers.html?' + ADMIN);
    await ex.waitForSelector('#rows tr[data-id]');
    // Review item 60 (Joe 10/13): the title's month reads like Oct 26.
    assert.match(await ex.textContent('#title'), /^Fire Extinguishers · [A-Z][a-z]{2} \d\d$/);
    assert.match(await ex.textContent('#rows tr[data-id] td:nth-child(7)'), /DUE SOON/, 'annual service within 30 days is due soon');
    await ex.fill('#rows tr[data-new] input[data-k="tag"]', '02');
    await ex.fill('#rows tr[data-new] input[data-k="location"]', 'Break room');
    await ex.press('#rows tr[data-new] input[data-k="location"]', 'Tab');
    await ex.waitForFunction(() => document.querySelectorAll('#rows tr[data-id]').length === 2);
    // Joe 10/13: + Add Extinguisher goes to the new row; Location is a pick list of the plant's Location Areas; Add saves it.
    assert.equal(await ex.isVisible('#add-ext'), true);
    assert.match(await ex.getAttribute('#locs-link', 'href'), /^location-areas\.html\?plant=fac_uniontown$/);
    await ex.click('#add-ext');
    assert.equal(await ex.evaluate(() => document.activeElement.dataset.k), 'tag', '+ Add Extinguisher puts the cursor in the new row');
    const picks = await ex.$$eval('#ext-locs option', o => o.map(x => x.value));
    assert.ok(picks.includes('Plant \u203a Coolers') && picks.includes('Yard \u203a Truck Yard') && picks.includes('Front office hallway'), 'the Location pick list: ' + JSON.stringify(picks.slice(0, 5)));
    assert.equal(await ex.getAttribute('#rows tr[data-new] input[data-k="location"]', 'list'), 'ext-locs');
    await ex.click('#rows tr[data-new] [data-add]');
    assert.match(await ex.textContent('#error'), /Type the tag number and where it hangs/, 'Add with nothing typed says what is missing');
    await ex.fill('#rows tr[data-new] input[data-k="tag"]', '03');
    await ex.fill('#rows tr[data-new] input[data-k="location"]', 'Plant \u203a Coolers');
    await ex.click('#rows tr[data-new] [data-add]');
    await ex.waitForFunction(() => document.querySelectorAll('#rows tr[data-id]').length === 3);
    assert.equal((await db().collection('extinguishers').doc(S.extId(UT, '03')).get()).data().location, 'Plant \u203a Coolers');
    assert.ok(await ex.$eval('#rows tr[data-new] td:nth-child(5)', td => getComputedStyle(td).display === 'table-cell'), 'the new row lines up with its columns');
    assert.equal(await ex.$eval('table.sw-ext-grid th:nth-child(7)', th => th.scrollWidth <= th.clientWidth), true, 'ANNUAL SERVICE is not cut off');
    await fits(ex, 'Fire Extinguishers at 1920');
    await shot(ex, 'safety-extinguishers-1920');
    await ex.click('#rows tr[data-id="' + S.extId(UT, '01') + '"] [data-check]');
    await ex.waitForSelector('#check .sw-bi');
    for (const [k] of S.EXT_ITEMS) { await ex.click('#check .sw-btn.good[data-item="' + k + '"]'); await ex.waitForTimeout(100); }
    const done = async () => S.extMonth((await db().collection('extinguishers').doc(S.extId(UT, '01')).get()).data(), today.slice(0, 7)).state;
    for (let i = 0; i < 40 && await done() !== 'GOOD'; i++) await ex.waitForTimeout(250);
    assert.equal(await done(), 'GOOD');
    assert.match(await ex.textContent('#check .sw-nav'), /Next: Tag 02 Break room/);
    await ex.setViewportSize({ width: 1536, height: 864 });
    await fits(ex, 'The extinguisher check at 1536');
    await shot(ex, 'safety-extinguisher-check-1536');
    assert.ok(await smallest(ex, '#check .sw-bi span, #check .sw-btn') >= 16, 'check text is 16px or more');
    assert.deepEqual(ex.errors, []);
    await ex.close();
    results.push('Fire Extinguishers: + Add Extinguisher, a Location pick list from Location Areas, and Add; the empty row adds one; annual service due within 30 days shows DUE SOON; the big-button check marks the month GOOD and Next goes to the next tag');

    // Joe 10/13 (mock-up B): Fire Alarm, Fire Suppression and Escape Plan, each a monthly big-button check of the whole system
    // with its dates, reached from a line of buttons under the top one (Fire Extinguishers shows it too).
    const fe = await openPage(browser, 1536, 864, '/extinguishers.html?' + ADMIN);
    await fe.waitForSelector('#fire-nav a');
    assert.deepEqual(await fe.$$eval('#fire-nav a', a => a.map(x => x.textContent)), ['Fire Extinguishers', 'Fire Alarm', 'Fire Suppression', 'Escape Plan']);
    assert.equal(await fe.getAttribute('#fire-nav a[aria-current="page"]', 'href'), 'extinguishers.html?plant=fac_uniontown');
    { const tops = await fe.$$eval('.head .top-row > *', b => b.filter(x => x.offsetParent).map(x => [x.textContent.trim().slice(0,20), Math.round(x.getBoundingClientRect().top), Math.round(x.getBoundingClientRect().width)])); assert.ok(Math.max(...tops.map(t => t[1])) - Math.min(...tops.map(t => t[1])) <= 4, 'Fire Extinguishers keeps its top buttons on one line: ' + JSON.stringify(tops)); }
    await fits(fe, 'Fire Extinguishers with the fire buttons at 1536');
    await shot(fe, 'safety-extinguishers-fire-nav-1536');
    await fe.click('#fire-nav a:has-text("Fire Alarm")');
    await fe.waitForSelector('#check .sw-bi .sw-btn');
    assert.match(await fe.textContent('#title'), /^Fire Alarm · /);
    assert.equal(await fe.$$eval('#check .sw-bi .sw-btn.good', b => b.length), S.fireSystem('alarm').items.length);
    await fe.fill('#check input[data-date="vendorDue"]', '3-1-27');
    await fe.press('#check input[data-date="vendorDue"]', 'Tab');
    const fireRec = async (k) => ((await db().collection('fireSystems').doc(S.fireId(UT, k)).get()).data() || {});
    for (let i = 0; i < 40 && (await fireRec('alarm')).vendorDue !== '2027-03-01'; i++) await fe.waitForTimeout(250);
    assert.equal((await fireRec('alarm')).vendorDue, '2027-03-01', 'the vendor date saves as it is left');
    await fe.click('#check .sw-btn.bad[data-item="pulls"]');
    await fe.waitForSelector('#check textarea[data-note]');
    await fe.fill('#check textarea[data-note]', 'Pull station by dock 3 blocked by pallets');
    await fe.press('#check textarea[data-note]', 'Tab');
    const fireIssue = async () => (await db().collection('safetyIssues').where('facilityId', '==', UT).where('source', '==', 'FIRE_SYSTEM').get()).docs.map(x => x.data());
    for (let i = 0; i < 40 && !((await fireIssue())[0] || {}).note; i++) await fe.waitForTimeout(250);
    assert.deepEqual([(await fireIssue())[0].area, (await fireIssue())[0].note], ['Fire Alarm', 'Pull station by dock 3 blocked by pallets'], 'a Not good is an open issue with what is wrong');
    { const tops = await fe.$$eval('.head .top-row > *', b => b.filter(x => x.offsetParent).map(x => x.getBoundingClientRect().top)); assert.ok(Math.max(...tops) - Math.min(...tops) <= 4, 'top buttons on one line: ' + JSON.stringify(tops)); }
    await fits(fe, 'Fire Alarm at 1536');
    assert.ok(await smallest(fe, '#check .sw-bi span, #check .sw-btn, #check label, #fire-nav a') >= 16, 'Fire Alarm text is 16px or more: ' + JSON.stringify(await tiny(fe, '#check .sw-bi span, #check .sw-btn, #check label, #fire-nav a')));
    await shot(fe, 'safety-fire-alarm-1536');
    await fe.goto(HOSTING + '/safety-fire.html?sys=escape&' + ADMIN);
    await fe.waitForSelector('#check .sw-bi .sw-btn');
    assert.deepEqual(await fe.$$eval('#check .sw-fire-dates .sw-label', l => l.map(x => x.textContent)), ['Last fire drill', 'Next fire drill', 'Maps updated']);
    for (const [k] of S.fireSystem('escape').items) { await fe.click('#check .sw-btn.good[data-item="' + k + '"]'); await fe.waitForTimeout(100); }
    const escDone = async () => S.fireMonth('escape', await fireRec('escape'), today.slice(0, 7)).state;
    for (let i = 0; i < 40 && await escDone() !== 'GOOD'; i++) await fe.waitForTimeout(250);
    assert.equal(await escDone(), 'GOOD');
    await fe.waitForFunction(() => /Good/.test(document.getElementById('counts').textContent));
    await fits(fe, 'Escape Plan at 1536');
    await shot(fe, 'safety-escape-plan-1536');
    await fe.setViewportSize({ width: 1920, height: 1080 });
    await fits(fe, 'Escape Plan at 1920');
    await shot(fe, 'safety-escape-plan-1920');
    await fe.goto(HOSTING + '/safety-fire.html?sys=suppression&' + ADMIN);
    await fe.waitForSelector('#check .sw-bi .sw-btn');
    assert.match(await fe.textContent('#check'), /Kitchen hood system/);
    await shot(fe, 'safety-fire-suppression-1920');
    assert.deepEqual(fe.errors, []);
    await fe.close();
    results.push('Fire Alarm, Fire Suppression and Escape Plan (Joe 10/13, mock-up B): a line of buttons under the top one on all four fire screens (top buttons stay on one line); each has a monthly big-button check and its dates; the vendor date saves as it is left; a Not good with what is wrong is an open issue; Escape Plan all Good marks the month Good; fits 1536 and 1920');

    // Past Walks and Checklist Setup open and fit.
    for (const page of ['safety-walks.html', 'safety-setup.html']) {
      const p = await openPage(browser, 1536, 864, '/' + page + '?' + ADMIN);
      await p.waitForSelector('#rows tr td:not(.sw-empty)');
      if (page === 'safety-walks.html') assert.match(await p.textContent('#rows'), /Walked with the new second-shift lead\.\s*3 row notes · 2 photos/, 'Past Walks shows the walk notes and how many rows have notes and photos');
      await fits(p, page + ' at 1536');
      await shot(p, page.replace('.html', '') + '-1536');
      assert.deepEqual(p.errors, []);
      await p.close();
    }
    results.push('Past Walks lists today\'s walk with its notes and photos; Checklist Setup shows the starting list; both fit 1536');

    // Joe 10/12 (Location Areas, Administration > Plant Setup): rename a sub-area, add one, turn one off, put it in order.
    const la = await openPage(browser, 1536, 864, '/location-areas.html?' + ADMIN);
    await la.waitForSelector('#rows tr.sw-place-row');
    assert.deepEqual(await la.$$eval('#rows tr.sw-place-row input[data-k="name"]', i => i.map(x => x.value)), ['Plant', 'Garage', 'Office', 'Yard']);
    assert.match(await la.textContent('#counts'), /4 areas · 21 sub-areas · the starting list/);
    // Joe 10/13 (A): a location picker at the top right (his own exception to review item 31 for this screen); it starts on
    // the plant he came in from, named in the heading too.
    assert.deepEqual(await la.$$eval('#plant option', o => o.map(x => x.textContent)), ['Uniontown', 'Charleston', 'Martins Ferry']);
    assert.equal(await la.$eval('#plant', s => s.value), UT);
    assert.equal(await la.textContent('#plant-name'), 'Uniontown');
    const locsNow = async () => S.locations((await db().collection('locationAreas').doc(UT).get()).data() || null);
    const laUntil = async (ok, what) => { for (let i = 0; i < 40; i++) { if (ok(await locsNow())) return; await la.waitForTimeout(250); } assert.fail(what); };
    await la.fill('#rows tr.sw-sub-row input[value="Wash Bay"]', 'Truck Wash');
    await la.press('#rows tr.sw-sub-row input[value="Wash Bay"]', 'Tab');
    await laUntil(l => l[1].subs.some(x => x.key === 'g_wash' && x.name === 'Truck Wash'), 'the sub-area is renamed');
    await la.fill('#rows tr[data-newsub][data-a="2"] input', 'Conference Room');
    await la.press('#rows tr[data-newsub][data-a="2"] input', 'Tab');
    await laUntil(l => l[2].subs[l[2].subs.length - 1].name === 'Conference Room', 'a sub-area is added at the end of Office');
    // Joe 10/12: the order changes by grabbing the line and dragging it; no Move up / Move down, no arrows, no dots.
    assert.equal(await la.$('[data-la-up], [data-la-down], .lo-grip, [data-grip]'), null, 'no Move up / Move down buttons and no grab dots');
    const conf = '#rows tr.sw-sub-row[data-drag]:has(input[value="Conference Room"])';
    await la.waitForSelector(conf);
    assert.equal(await la.$eval(conf + ' td.la-order', td => getComputedStyle(td).cursor), 'grab', 'the hand shows over a line');
    // Keyboard: Alt+Up on the line moves it one place, and the line keeps the focus.
    await la.focus(conf);
    await la.keyboard.press('Alt+ArrowUp');
    await laUntil(l => { const o = l[2].subs.map(x => x.name); return o[o.length - 1] === 'Stairs & Exits' && o[o.length - 2] === 'Conference Room'; }, 'Alt+Up changes the walking order');
    await la.waitForFunction(() => document.activeElement && /Conference Room/.test(document.activeElement.getAttribute('aria-label') || ''));
    // Mouse: grab Conference Room by its line and drag it above Office's first sub-area. Review item 59 (Joe 10/13, "grab the
    // whole line"): it is grabbed by its Used count, not the Order cell; the hand shows there too.
    assert.equal(await la.$eval(conf + ' td:nth-child(4)', td => getComputedStyle(td).cursor), 'grab', 'the hand shows over the Used count');
    const firstOffice = '#rows tr.sw-sub-row[data-a="2"][data-s="0"]', firstName = await la.$eval(firstOffice + ' input[data-k="name"]', i => i.value);
    const fromBox = await la.locator(conf + ' td:nth-child(4)').boundingBox(), toBox = await la.locator(firstOffice + ' td.la-order').boundingBox();
    await la.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
    await la.mouse.down();
    for (let i = 1; i <= 8; i++) await la.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2 + (toBox.y + toBox.height * 0.25 - fromBox.y - fromBox.height / 2) * i / 8);
    await la.mouse.up();
    await laUntil(l => l[2].subs[0].name === 'Conference Room' && l[2].subs[1].name === firstName, 'dragging the line puts Conference Room first in Office');
    await laUntil(l => l.map(a => a.name).join(',') === 'Plant,Garage,Office,Yard', 'a sub-area stays in its own area and the areas keep their order');
    await la.waitForSelector('#rows tr.sw-sub-row:has(input[value="Ammonia Room"]) input[data-k="on"]');
    await la.uncheck('#rows tr.sw-sub-row:has(input[value="Ammonia Room"]) input[data-k="on"]');
    await laUntil(l => l[0].subs.find(x => x.key === 'ammonia').off, 'a sub-area is turned off');
    await la.waitForFunction(() => !/the starting list/.test(document.getElementById('counts').textContent));
    await fits(la, 'Location Areas at 1536');
    await shot(la, 'location-areas-1536');
    await la.setViewportSize({ width: 1920, height: 1080 });
    await fits(la, 'Location Areas at 1920');
    await shot(la, 'location-areas-1920');
    // Joe 10/13 (A): each location has its own areas. Charleston starts empty with + Add area; adding one saves to
    // Charleston only, and Uniontown's areas are as they were.
    await la.setViewportSize({ width: 1536, height: 864 });
    const utBefore = JSON.stringify(await locsNow());
    await la.selectOption('#plant', 'fac_charleston');
    await la.waitForFunction(() => /No areas for Charleston yet/.test(document.getElementById('rows').textContent));
    assert.equal(await la.textContent('#plant-name'), 'Charleston');
    assert.match(await la.textContent('#counts'), /^0 areas · 0 sub-areas$/);
    assert.match(la.url(), /plant=fac_charleston/);
    await shot(la, 'location-areas-charleston-empty-1536');
    await la.fill('#rows tr[data-newarea] input', 'Plant');
    await la.press('#rows tr[data-newarea] input', 'Tab');
    await la.waitForSelector('#rows tr[data-newsub][data-a="0"] input');
    await la.fill('#rows tr[data-newsub][data-a="0"] input', 'Receiving');
    await la.press('#rows tr[data-newsub][data-a="0"] input', 'Tab');
    const chLocs = async () => S.locations((await db().collection('locationAreas').doc('fac_charleston').get()).data() || null, 'fac_charleston');
    for (let i = 0; i < 40 && JSON.stringify((await chLocs()).map(a => [a.name, a.subs.map(x => x.name)])) !== '[["Plant",["Receiving"]]]'; i++) await la.waitForTimeout(250);
    assert.deepEqual((await chLocs()).map(a => [a.name, a.subs.map(x => x.name), a.off]), [['Plant', ['Receiving'], false]], 'Charleston has only its own area, nothing from Uniontown');
    assert.equal(JSON.stringify(await locsNow()), utBefore, 'Uniontown\'s areas are unchanged');
    await la.waitForSelector('#rows tr.sw-sub-row[data-drag] input[value="Receiving"]');
    assert.match(await la.textContent('#counts'), /^1 area · 1 sub-area$/, 'one area and one sub-area are counted in the singular');
    await fits(la, 'Location Areas for Charleston at 1536');
    await shot(la, 'location-areas-charleston-1536');
    await la.selectOption('#plant', UT);
    await la.waitForFunction(() => document.querySelectorAll('#rows tr.sw-place-row').length === 4);
    assert.equal(await la.evaluate(() => sessionStorage.getItem('udPlant')), UT, 'picking a location here does not change the plant the app is working in');
    assert.deepEqual(la.errors, []);
    await la.close();
    results.push('Location Areas (Plant, Garage, Office, Yard): a sub-area renamed by typing over it, + Add sub-area, dragging a line (mouse and Alt+Up) and turning one off all save; it fits 1536 and 1920');
    results.push('Location Areas location picker (Joe 10/13, A): Uniontown, Charleston, Martins Ferry; Charleston starts empty, its first area and sub-area save to Charleston only, Uniontown is unchanged, and the plant the app works in stays Uniontown');

    // Checklist Setup follows Location Areas (names, order, turned off) and Move to puts an item in another sub-area.
    const cs = await openPage(browser, 1536, 864, '/safety-setup.html?' + ADMIN);
    await cs.waitForSelector('#rows tr.sw-place-row');
    assert.deepEqual(await cs.$$eval('#rows tr.sw-place-row b', i => i.map(x => x.textContent)), ['Plant', 'Garage', 'Office', 'Yard']);
    assert.equal(await cs.$$eval('#rows input[data-k="place"], #rows [data-sub-up]', i => i.length), 0, 'areas are changed on Location Areas, not here');
    await cs.waitForSelector('#rows tr.sw-sub-row b:text-is("Truck Wash")');
    assert.match(await cs.textContent('#rows tr.sw-sub-row:has(b:text-is("Ammonia Room"))'), /Turned off in Location Areas/);
    assert.match(await cs.getAttribute('#areas-link', 'href'), /^location-areas\.html\?plant=/);
    const setupNow = async () => S.checklist(Object.assign({}, (await db().collection('safetySetup').doc(UT).get()).data() || {}, { locations: (await db().collection('locationAreas').doc(UT).get()).data() }), true);
    const until = async (ok, what) => { for (let i = 0; i < 40; i++) { if (ok(await setupNow())) return; await cs.waitForTimeout(250); } assert.fail(what); };
    const cleanRow = '#rows tr:has(input[value="Microwave and fridge area clean"])';
    await cs.selectOption(cleanRow + ' select[data-k="move"]', { label: 'Conference Room' });
    await until(l => (l.find(a => a.name === 'Conference Room') || { items: [] }).items.some(i => i.id === 'o_clean') && !l.find(a => a.key === 'o_break').items.some(i => i.id === 'o_clean'), 'Move to moves the item');
    await fits(cs, 'Checklist Setup at 1536');
    await shot(cs, 'safety-setup-areas-1536');
    assert.deepEqual(cs.errors, []);
    await cs.close();
    results.push('Checklist Setup follows Location Areas: renamed and added sub-areas show, a turned-off one says so, and Move to puts an item in another sub-area');

    // The walk follows Location Areas: the new sub-area with its item, the renamed one, and no Ammonia Room.
    const lw = await openPage(browser, 1536, 864, '/safety.html?' + ADMIN);
    await lw.waitForSelector('#areas [data-place="Office"]');
    for (const place of ['Plant', 'Garage', 'Office', 'Yard']) {
      if (await lw.getAttribute('#areas [data-place="' + place + '"]', 'aria-expanded') !== 'true') await lw.click('#areas [data-place="' + place + '"]');
      await lw.waitForSelector('#areas [data-place="' + place + '"][aria-expanded="true"]');
    }
    await lw.waitForFunction(() => /Truck Wash/.test(document.getElementById('areas').textContent));
    const subs = await lw.$$eval('#areas [data-area].sub', b => b.map(x => x.textContent));
    assert.ok(subs.some(t => /Conference Room/.test(t)) && subs.some(t => /Truck Wash/.test(t)) && !subs.some(t => /Ammonia Room/.test(t)), 'the walk follows Location Areas: ' + JSON.stringify(subs));
    assert.deepEqual(await lw.$$eval('#areas [data-place]', b => [...new Set(b.map(x => x.dataset.place))]), ['Plant', 'Garage', 'Office', 'Yard']);
    await shot(lw, 'safety-walk-location-areas-1536');
    assert.deepEqual(lw.errors, []);
    await lw.close();
    results.push('The walk follows Location Areas: renamed and added sub-areas show in order, a turned-off one is left off');

    // Joe 10/12: iPad and Android, tablets both ways and a phone. Every safety screen fits the device with big buttons.
    const DEVICES = [['iPad (gen 7)', 'ipad-portrait'], ['iPad (gen 7) landscape', 'ipad-landscape'], ['Galaxy Tab S4', 'android-tablet-portrait'], ['Galaxy Tab S4 landscape', 'android-tablet-landscape'], ['Pixel 7', 'android-phone']];
    for (const [name, tag] of DEVICES) {
      const d = await openDevice(browser, name, '/safety.html?' + ADMIN);
      await d.waitForSelector('#areas [data-place="Plant"]');
      await shot(d, 'safety-walk-tree-' + tag);
      await d.click('#list [data-mode="all"]');
      await d.waitForSelector(row('floors'));
      await d.waitForFunction(() => document.querySelector('#list .sw-btn.good').getBoundingClientRect().height > 0);
      await fits(d, 'The walk on ' + name);
      const tall = (sel) => d.evaluate(q => document.querySelector(q).getBoundingClientRect().height, sel); // read at once, never a row just redrawn
      const big = await tall(row('floors') + ' .sw-btn.good');
      assert.ok(big >= 44, name + ': Good / Not good are big enough for a finger: ' + big);
      assert.ok(await tall(row('floors') + ' .sw-cam') >= 44, name + ': + Photo is big enough for a finger');
      const WALK_TEXT = '#list td, #list .sw-btn, #list .sw-cam, #areas button, #list input[type="text"], .head a, .head button';
      assert.ok(await smallest(d, WALK_TEXT) >= 16, name + ': walk text is 16px or more: ' + JSON.stringify(await tiny(d, WALK_TEXT)));
      await shot(d, 'safety-walk-' + tag);
      for (const page of ['safety-issues.html', 'extinguishers.html', 'safety-walks.html', 'safety-setup.html']) {
        await d.goto(HOSTING + '/' + page + '?' + ADMIN);
        await d.waitForSelector('#rows tr td:not(.sw-empty)');
        await fits(d, page + ' on ' + name);
        assert.ok(await smallest(d, '#rows td, .head a, .head button') >= 16, name + ': ' + page + ' text is 16px or more: ' + JSON.stringify(await tiny(d, '#rows td, .head a, .head button')));
        await shot(d, page.replace('.html', '') + '-' + tag);
      }
      await d.goto(HOSTING + '/safety-fire.html?sys=escape&' + ADMIN);
      await d.waitForSelector('#check .sw-bi .sw-btn');
      await fits(d, 'Escape Plan on ' + name);
      assert.ok(await tall('#check .sw-btn') >= 44, name + ': Escape Plan buttons are big');
      assert.ok(await tall('#fire-nav a') >= 44, name + ': the fire buttons are big');
      await shot(d, 'safety-escape-plan-' + tag);
      await d.goto(HOSTING + '/extinguishers.html?' + ADMIN);
      await d.click('#rows tr[data-id="' + S.extId(UT, '02') + '"] [data-check]');
      await d.waitForSelector('#check .sw-bi');
      await fits(d, 'The extinguisher check on ' + name);
      assert.ok(await tall('#check .sw-btn') >= 44, name + ': check buttons are big');
      await shot(d, 'safety-extinguisher-check-' + tag);
      assert.deepEqual(d.errors, []);
      await d.ctx.close();
    }
    results.push('iPad (Safari) and Android (Chrome) tablets, portrait and landscape, and an Android phone: the walk, Open Issues, Fire Extinguishers and its check, Past Walks and Checklist Setup each fit with no sideways scrolling, 16px text and finger-sized buttons');

    // Joe 10/12: no internet on the walk. An iPad and an Android tablet each: taps, a note and a camera photo are held on the
    // device, survive a reload with no signal (the screens come from the device), and are sent once the connection is back.
    const items = S.checklist(null).flatMap(a => a.items.map(i => i.id)).filter(id => ['exit_routes', 'panel_labels', 'floors', 'ext_monthly'].indexOf(id) < 0);
    for (const [name, tag, [tapId, noteId, photoId]] of [['iPad (gen 7)', 'ipad', items.slice(0, 3)], ['Galaxy Tab S4', 'android', items.slice(3, 6)]]) {
      const d = await openDevice(browser, name, '/safety.html?' + ADMIN);
      await d.click('#list [data-mode="all"]');
      await d.waitForSelector(row(tapId));
      // The screens and the Firebase code are kept on the device, and the screen cache is in charge of the page.
      await d.waitForFunction(async () => { if (!navigator.serviceWorker.controller) return false; const c = await caches.open('ud-offline-v1'); return !!(await c.match('safety.html')) && !!(await c.match('js/offline-saves.js')) && !!(await c.match('js/firebase.js')) && !!(await c.match((await import('/js/firebase.js')).FIREBASE_FILES.find(u => u.endsWith('/firebase-firestore.js')))); }, null, { timeout: 20000 });
      // The walk has been read once with signal (it is then kept on the device too).
      await d.waitForFunction(() => /^1 Good|Good · 1 Not good/.test(document.getElementById('counts').textContent) && !/Reading/.test(document.getElementById('foot').textContent));
      const wasGood = await d.evaluate(() => (document.getElementById('counts').textContent.match(/^(\d+) Good/) || [])[1]);
      await d.ctx.setOffline(true);
      await d.waitForFunction(() => /No internet/.test(document.getElementById('offline-line').textContent));
      await d.click(row(tapId) + ' .sw-btn.good');
      await d.fill('#list input[data-note="' + noteId + '"]', 'Held on the ' + tag);
      await d.click('#title');
      await takePhoto(d, photoId, '#0b5394');
      await d.waitForFunction(() => document.getElementById('offline-line').textContent === 'Saved on this device, sends when online: 3');
      assert.equal(await d.$eval('#offline-line', b => getComputedStyle(b).display !== 'none' && !b.hidden), true, 'the line shows');
      await shot(d, 'safety-offline-held-' + tag);
      // Closed and opened again with no signal: the page comes from the device and still shows what was done.
      await d.reload();
      await d.waitForSelector(row(tapId) + ' .sw-btn.good[aria-pressed="true"]', { timeout: 20000 });
      assert.equal(await d.inputValue('#list input[data-note="' + noteId + '"]'), 'Held on the ' + tag);
      await d.waitForSelector(row(photoId) + ' .sw-thumbs img');
      await d.waitForFunction(() => document.getElementById('offline-line').textContent === 'Saved on this device, sends when online: 3');
      assert.match(await d.textContent('#counts'), new RegExp('^' + (Number(wasGood) + 1) + ' Good · 1 Not good'), 'after the reload with no signal the walk shows what was saved before and what is held');
      const before = (await db().collection('safetyWalks').doc(S.walkId(UT, today)).get()).data();
      assert.ok(!before.items[tapId] && !(before.items[noteId] || {}).note, 'nothing reached the server with no signal');
      // Signal back: the held saves send by themselves and the line goes away.
      await d.ctx.setOffline(false);
      let after = null;
      for (let i = 0; i < 80; i++) { after = (await db().collection('safetyWalks').doc(S.walkId(UT, today)).get()).data(); if (after.items[tapId] && after.items[noteId] && after.items[photoId] && (after.items[photoId].photoIds || []).length) break; await d.waitForTimeout(250); }
      assert.deepEqual([after.items[tapId].status, after.items[noteId].note, after.items[photoId].photoIds.length], ['GOOD', 'Held on the ' + tag, 1], name + ': the held tap, note and photo reached the server');
      await d.waitForFunction(() => document.getElementById('offline-line').hidden, null, { timeout: 20000 });
      await shot(d, 'safety-offline-sent-' + tag);
      assert.deepEqual(d.errors, []);
      await d.ctx.close();
    }
    results.push('No internet on an iPad and an Android tablet: a tap, a note and a camera photo show "Saved on this device, sends when online: 3", are still there after a reload with no signal (the screen comes from the device), reach the server by themselves when the signal is back, and the line goes away');

    // Joe 10/12: inside a plant there is no plant drop-down; every page uses the plant he came in through and names it in the header.
    const cp = await openPage(browser, 1536, 864, '/index.html?' + ADMIN);
    await cp.evaluate(() => sessionStorage.setItem('udPlant', 'fac_charleston'));
    for (const page of ['safety.html', 'safety-issues.html', 'extinguishers.html', 'safety-walks.html', 'safety-setup.html']) {
      await cp.goto(HOSTING + '/' + page + '?' + ADMIN);
      await cp.waitForFunction(() => /Charleston/.test(document.getElementById('eyebrow').textContent));
      assert.equal(await cp.$$eval('#screen select', s => s.filter(x => /plant/i.test(x.id + ' ' + (x.getAttribute('aria-label') || ''))).length), 0, page + ' has no plant drop-down');
    }
    assert.deepEqual(cp.errors, []);
    await cp.close();
    results.push('No plant drop-down: coming in through Charleston, all five screens use Charleston and name it in the header');
    console.log('Safety Walkthrough browser check passed:\n - ' + results.join('\n - '));
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
