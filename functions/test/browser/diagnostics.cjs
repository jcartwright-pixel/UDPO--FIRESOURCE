'use strict';
/*
 * Browser check of the sandbox-only Diagnostics (Joe 10/10). Builds the sandbox version of the screens into a scratch folder
 * (tools/sandbox-diagnostics.cjs add), serves it, and on the made-up data:
 *  - an administrator finds Diagnostics under Administration, runs the check, every screen opens in the same window and
 *    the results page lists each with its load time, the server round trip and nothing failed;
 *  - Record while I work times a screen and a save, and says when it switches off;
 *  - a manager is turned away.
 * The real build (public/) is never changed.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');
const D = require('../../../tools/sandbox-diagnostics.cjs');

const SDK = path.dirname(require.resolve('firebase/package.json'));
const PORT = 5057, HOST = 'http://127.0.0.1:' + PORT;
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'ud-shots');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json' };

function serve(dir) {
  return new Promise(ok => {
    const server = http.createServer((req, res) => {
      const file = path.join(dir, decodeURIComponent(req.url.split(/[?#]/)[0]).replace(/^\/+/, '') || 'index.html');
      if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    }).listen(PORT, '127.0.0.1', () => ok(server));
  });
}

async function newPage(context) {
  const page = await context.newPage();
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  return page;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ud-sandbox-build-'));
  fs.cpSync(path.join(__dirname, '../../../public'), dir, { recursive: true });
  const queue = D.add(dir);
  const server = await serve(dir);
  fs.mkdirSync(SHOTS, { recursive: true });
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  const browser = await chromium.launch();
  try {
    // An administrator: Diagnostics is in the Administration menu.
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await newPage(ctx);
    await page.goto(HOST + '/distribution.html?testEmail=admin.test@uniteddairy.com');
    await page.waitForSelector('#screen:not([hidden])');
    await page.waitForSelector('.side-flyouts a[href="diagnostics.html"]', { state: 'attached', timeout: 15000 });
    await page.hover('.sidemenu .side-sec-btn[title="Administration"]');
    await page.waitForSelector('.side-flyouts .flyout.open a[href="diagnostics.html"]');
    await Promise.all([page.waitForURL(/diagnostics\.html/), page.click('.side-flyouts .flyout.open a[href="diagnostics.html"]')]);
    await page.waitForSelector('#controls:not([hidden])');
    assert.ok(await page.isVisible('#go-back') && await page.isVisible('.sidemenu'), 'Diagnostics keeps the menu, Back and Home');
    // One line of controls at the top.
    const tops = await page.$$eval('#controls > button, #controls .tabs', x => x.map(e => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2)));
    assert.ok(Math.max(...tops) - Math.min(...tops) <= 3, 'the controls sit on one line ' + JSON.stringify(tops));

    // The Administration page has a Sandbox tools group with Diagnostics, kept when its filters redraw the tiles.
    await page.goto(HOST + '/administration.html');
    await page.waitForSelector('.diag-group a.adm-tile[href="diagnostics.html"]', { timeout: 15000 });
    await page.fill('#find', 'diag');
    await page.waitForSelector('.diag-group a.adm-tile[href="diagnostics.html"]');
    await page.fill('#find', '');
    await page.screenshot({ path: path.join(SHOTS, 'administration-sandbox-tools-1920.png'), fullPage: true });
    await Promise.all([page.waitForURL(/diagnostics\.html/), page.click('.diag-group a.adm-tile')]);
    await page.waitForSelector('#controls:not([hidden])');

    // Run the check: every screen opens in this window, one after another, and it comes back here.
    const started = Date.now();
    await page.click('#run');
    await page.waitForURL(/diagnostics\.html/, { timeout: 15 * 60 * 1000 });
    await page.waitForFunction(() => { try { const r = JSON.parse(localStorage.getItem('udDiagLastRun') || 'null'); return r && r.server && document.querySelectorAll('#sheet tbody tr').length > 5; } catch (e) { return false; } }, null, { timeout: 60000 });
    const run = await page.evaluate(() => JSON.parse(localStorage.getItem('udDiagLastRun')));
    console.log('Check took ' + Math.round((Date.now() - started) / 1000) + ' s for ' + run.results.length + ' screens');
    assert.deepEqual(run.results.map(r => r.asked), queue, 'every screen was checked, in menu order');
    assert.equal(await page.evaluate(() => localStorage.getItem('udDiagRun')), null, 'the check switched itself off at the end');
    run.results.forEach(r => {
      assert.ok(r.shownMs != null && r.loadedMs != null && r.loadedMs >= r.shownMs, r.page + ' has its times ' + JSON.stringify(r));
      console.log('  ' + r.page.padEnd(18) + ' shown ' + r.shownMs + ' ms, loaded ' + r.loadedMs + ' ms' + (r.stillChanging ? ' (still changing)' : '') + (r.errors.length ? '  ERRORS ' + JSON.stringify(r.errors) : ''));
    });
    assert.equal(run.server.length, 3);
    assert.ok(run.server.every(t => t.answered), 'the server answered the round trip ' + JSON.stringify(run.server));
    assert.equal(await page.$$eval('#sheet tbody tr', r => r.length), queue.length);
    const summary = await page.evaluate(() => window.udDiagSummary());
    assert.match(summary, /^SUMMARY/);
    assert.match(summary, /SLOW_CALLS/);
    assert.match(summary, new RegExp('Screens checked: ' + queue.length));
    fs.writeFileSync(path.join(SHOTS, 'diagnostics-summary.txt'), summary);
    await page.mouse.move(1500, 900);
    await page.screenshot({ path: path.join(SHOTS, 'diagnostics-1920.png') });
    const hi = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
    await hi.addInitScript(([last, active]) => { try { localStorage.setItem('udDiagLastRun', last); sessionStorage.setItem('udActive', active); } catch (e) { /* none */ } }, [JSON.stringify(run), 'admin.test@uniteddairy.com']);
    const zoom = await newPage(hi);
    await zoom.goto(HOST + '/diagnostics.html?testEmail=admin.test@uniteddairy.com');
    await zoom.waitForSelector('#controls:not([hidden])');
    await zoom.waitForTimeout(800);
    await zoom.screenshot({ path: path.join(SHOTS, 'diagnostics-top-2x.png'), clip: { x: 0, y: 0, width: 1920, height: 540 } });
    await hi.close();
    // A laptop: the controls still fit on one line, nothing runs off the side.
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.waitForTimeout(400);
    const lap = await page.evaluate(() => { const c = document.getElementById('controls').getBoundingClientRect(), b = [...document.querySelectorAll('#controls > button, #controls .tabs button')].map(e => e.getBoundingClientRect()); return { right: c.right, width: innerWidth, scroll: document.scrollingElement.scrollWidth, tops: b.map(x => Math.round(x.top)) }; });
    assert.ok(lap.right <= lap.width && lap.scroll <= lap.width, 'nothing runs off the side at 1366 ' + JSON.stringify(lap));
    assert.ok(Math.max(...lap.tops) - Math.min(...lap.tops) <= 3, 'the controls stay on one line at 1366 (laptop-size buttons, as on every screen) ' + JSON.stringify(lap));
    await page.screenshot({ path: path.join(SHOTS, 'diagnostics-1366.png') });
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Record while I work: a screen opened and a save are timed; it says when it switches itself off.
    await page.click('#record');
    assert.match(await page.textContent('#rec-state'), /Recording until/);
    const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('udDiagRecord')));
    assert.ok(Math.abs(rec.until - rec.since - 8 * 3600e3) < 1000, 'recording stops itself after 8 hours');
    await page.goto(HOST + '/routes.html');
    await page.waitForSelector('#screen:not([hidden])');
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem('udDiagLog') || '[]')).some(l => l.page === 'routes.html'), null, { timeout: 30000 });
    await page.evaluate(() => import('./js/app.js').then(m => m.save('diagnosticsRoundTrip', {}).catch(() => null)));
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem('udDiagLog') || '[]')).some(l => (l.calls || []).some(c => c.name === 'save' && c.ms != null)), null, { timeout: 30000 });
    await page.goto(HOST + '/diagnostics.html');
    await page.waitForSelector('#controls:not([hidden])');
    await page.click('[role="tab"][data-view="work"]');
    assert.match(await page.textContent('#sheet tbody'), /routes\.html/);
    assert.match(await page.textContent('#sheet tbody'), /server save diagnosticsRoundTrip failed/);
    await page.screenshot({ path: path.join(SHOTS, 'diagnostics-while-i-work-1920.png') });
    await page.click('#record');
    assert.equal(await page.evaluate(() => localStorage.getItem('udDiagRecord')), null, 'Stop recording switches it off');
    assert.deepEqual(page.errors, []);
    await ctx.close();

    // A manager is not an administrator: no menu entry, and the page turns them away.
    const mctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const mgr = await newPage(mctx);
    await mgr.goto(HOST + '/distribution.html?testEmail=manager.test@uniteddairy.com');
    await mgr.waitForSelector('#screen:not([hidden])');
    await mgr.waitForTimeout(2500);
    assert.equal(await mgr.$('a[href="diagnostics.html"]'), null, 'no Diagnostics link for a manager');
    await mgr.goto(HOST + '/diagnostics.html');
    await mgr.waitForSelector('#error:not([hidden])');
    assert.match(await mgr.textContent('#error'), /administrators only/);
    assert.ok(await mgr.isHidden('#controls'));
    await mctx.close();
    console.log('Diagnostics: menu entry, full check of ' + queue.length + ' screens, round trip, recording and admin-only all OK');
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
