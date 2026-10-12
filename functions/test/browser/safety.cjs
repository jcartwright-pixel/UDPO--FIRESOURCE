'use strict';
/*
 * Browser check of the Safety Walkthrough (Joe 10/12, mock-ups A, B, D, E and F):
 *   - while it is being built only an administrator opens it; a manager sees the Under Construction note;
 *   - the plant home shows it as a seventh card next to Reports (four a row, all seven on one screen);
 *   - the weekly walk: Good and Not good, a note and Send to Plant Maintenance that save as they are left; the counts follow;
 *     every item starts Not checked; the month's first walk has the monthly items;
 *   - the Not good shows on Open Issues and at the top of the next walk to review;
 *   - Fire Extinguishers: the empty row adds one; Check opens the big-button check; all Good makes the month GOOD;
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
  await page.waitForFunction(async () => { if (!navigator.serviceWorker.controller) return false; const c = await caches.open('ud-offline-v1'); return !!(await c.match('safety-issues.html')) && !!(await c.match('js/offline-saves.js')) && (await Promise.all(['app', 'auth', 'firestore', 'functions'].map(n => c.match('https://www.gstatic.com/firebasejs/12.18.0/firebase-' + n + '.js')))).every(Boolean); }, null, { timeout: 20000 });
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
    await wk.waitForSelector(row('exit_routes'));
    await wk.waitForSelector('#list tr[data-issue-row="old_issue"]');
    assert.equal(await wk.textContent('#title'), 'Weekly Walk ' + Number(today.slice(5, 7)) + '-' + Number(today.slice(8)) + '-' + today.slice(2, 4));
    assert.ok(await wk.$(row('ext_monthly')), 'the month\'s first walk has the monthly items');
    assert.equal(await wk.textContent(row('exit_routes') + ' .sw-state'), 'Not checked');
    assert.deepEqual(await wk.$$eval('#areas button', b => b.map(x => x.firstChild.textContent)), ['Open issues from earlier walks'].concat(S.checklist(null).map(a => a.name), ['Walk notes']));
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
    await wk.click('#list tr[data-issue-row="old_issue"] .sw-btn.open');
    const saved = async () => (await db().collection('safetyWalks').doc(S.walkId(UT, today)).get()).data();
    for (let i = 0; i < 40; i++) { const w = await saved(); if (w && w.items.panel_labels && w.items.panel_labels.maint && w.reviews && w.reviews.old_issue && w.reviews.old_issue.status && w.note && (w.items.exit_routes.photoIds || []).length && (w.items.panel_labels.photoIds || []).length) break; await wk.waitForTimeout(250); }
    const w = await saved();
    assert.deepEqual([w.items.exit_routes.status, w.items.panel_labels.status, w.items.panel_labels.note, w.items.panel_labels.maint, w.reviews.old_issue.status], ['GOOD', 'NOT_GOOD', 'LP-3 missing breaker labels', true, 'OPEN']);
    assert.deepEqual([w.items.exit_routes.note, w.reviews.old_issue.note, w.note], ['Door 4 sticks but opens', 'Drain cleaned, still slow', 'Walked with the new second-shift lead.'], 'the row, review and walk notes saved');
    assert.deepEqual([w.items.exit_routes.photoIds.length, w.items.panel_labels.photoIds.length], [1, 1], 'a photo on a Good item and on a Not good item');
    assert.match((await db().collection('safetyPhotos').doc(w.items.exit_routes.photoIds[0]).get()).data().data, /^data:image\/jpeg;base64,/);
    assert.match(await wk.textContent('#counts'), /^1 Good · 1 Not good · \d+ Not checked/);
    assert.equal(await wk.getAttribute('#list tr[data-issue-row="old_issue"] .sw-btn.open', 'aria-pressed'), 'true');
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
    assert.match(await ex.textContent('#rows tr[data-id] td:nth-child(7)'), /DUE SOON/, 'annual service within 30 days is due soon');
    await ex.fill('#rows tr[data-new] input[data-k="tag"]', '02');
    await ex.fill('#rows tr[data-new] input[data-k="location"]', 'Break room');
    await ex.press('#rows tr[data-new] input[data-k="location"]', 'Tab');
    await ex.waitForFunction(() => document.querySelectorAll('#rows tr[data-id]').length === 2);
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
    results.push('Fire Extinguishers: the empty row adds one; annual service due within 30 days shows DUE SOON; the big-button check marks the month GOOD and Next goes to the next tag');

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

    // Joe 10/12: iPad and Android, tablets both ways and a phone. Every safety screen fits the device with big buttons.
    const DEVICES = [['iPad (gen 7)', 'ipad-portrait'], ['iPad (gen 7) landscape', 'ipad-landscape'], ['Galaxy Tab S4', 'android-tablet-portrait'], ['Galaxy Tab S4 landscape', 'android-tablet-landscape'], ['Pixel 7', 'android-phone']];
    for (const [name, tag] of DEVICES) {
      const d = await openDevice(browser, name, '/safety.html?' + ADMIN);
      await d.waitForSelector(row('floors'));
      await fits(d, 'The walk on ' + name);
      const big = await d.$eval(row('floors') + ' .sw-btn.good', b => b.getBoundingClientRect().height);
      assert.ok(big >= 44, name + ': Good / Not good are big enough for a finger: ' + big);
      assert.ok(await d.$eval(row('floors') + ' .sw-cam', b => b.getBoundingClientRect().height) >= 44, name + ': + Photo is big enough for a finger');
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
      await d.goto(HOSTING + '/extinguishers.html?' + ADMIN);
      await d.click('#rows tr[data-id="' + S.extId(UT, '02') + '"] [data-check]');
      await d.waitForSelector('#check .sw-bi');
      await fits(d, 'The extinguisher check on ' + name);
      assert.ok(await d.$eval('#check .sw-btn', b => b.getBoundingClientRect().height) >= 44, name + ': check buttons are big');
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
      await d.waitForSelector(row(tapId));
      // The screens and the Firebase code are kept on the device, and the screen cache is in charge of the page.
      await d.waitForFunction(async () => { if (!navigator.serviceWorker.controller) return false; const c = await caches.open('ud-offline-v1'); return !!(await c.match('safety.html')) && !!(await c.match('js/offline-saves.js')) && !!(await c.match('https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js')); }, null, { timeout: 20000 });
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
