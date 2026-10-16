'use strict';
/*
 * Browser check of Send to TV (Joe 10/16: "send to the TV my driver's kiosk station" with nothing typed on the TV; his
 * Vizio has Chromecast built in but no browser). Administration > Driver Station Codes keeps the Cast App ID and puts a
 * Send to TV button on each Driver's Kiosk Station. The TV runs driver-station.html?tv=1&cast=1 (our Cast receiver): a big
 * "Waiting for Send to TV" screen until Send to TV signs it in as that station, then the board with no code, Release or
 * Exit. A new code on the station shuts the TV out. Google's Cast libraries are stood in for (no TV here). Pictures to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const G = require('../fixtures/garage-demo');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;
const ADMIN = '?testEmail=admin.test@uniteddairy.com';
// Chrome's Cast sender, standing in: Chrome's TV list picks "VIZIO TV" and the message to the TV is kept for the check.
const FAKE_SENDER = `window.chrome = window.chrome || {}; chrome.cast = { AutoJoinPolicy: { ORIGIN_SCOPED: 'origin_scoped' } };
  window.cast = { framework: { CastContext: { getInstance: () => ({ setOptions: (o) => { window.__castOptions = o; },
    requestSession: async () => undefined,
    getCurrentSession: () => ({ sendMessage: async (ns, m) => { window.__castSent = { ns, m }; }, getCastDevice: () => ({ friendlyName: 'VIZIO TV' }) }) }) } } };
  setTimeout(() => window.__onGCastApiAvailable(true), 0);`;
// The TV's Cast receiver library, standing in: the message from Send to TV is handed in by the check.
const FAKE_RECEIVER = `window.cast = { framework: { system: { MessageType: { JSON: 'JSON' } }, CastReceiverContext: { getInstance: () => ({
  addCustomMessageListener: (ns, fn) => { window.__castNs = ns; window.__castMsg = fn; }, start: (o) => { window.__castStart = o; } }) } } };`;

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block' });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  await page.route(/https:\/\/www\.gstatic\.com\/cv\/js\/sender\//, route => route.fulfill({ contentType: 'text/javascript', body: FAKE_SENDER }));
  await page.route(/https:\/\/www\.gstatic\.com\/cast\/sdk\/libs\/caf_receiver\//, route => route.fulfill({ contentType: 'text/javascript', body: FAKE_RECEIVER }));
  await page.route(/api\.open-meteo\.com/, route => route.abort());
  await localCalls(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name) }); };

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(G.sheets()), sources: G.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  const browser = await chromium.launch();
  const results = [];
  try {
    // The TV first: turned on and sent our receiver, it waits on a big screen readable across the room.
    const tv = await openPage(browser, 1920, 1080, '/driver-station.html?tv=1&cast=1');
    await tv.waitForSelector('#signin:not([hidden]) :text("Waiting for Send to TV")');
    await tv.waitForFunction(() => !!window.__castStart);
    assert.equal(await tv.evaluate(() => window.__castStart.disableIdleTimeout), true, 'the board stays open with no sender connected');
    assert.equal(await tv.isVisible('#signin-button'), false, 'no Google sign-in on the TV');
    const big = await tv.$eval('#signin p', el => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(big >= 36, 'the waiting screen reads across a room (' + big + 'px)');
    await shot(tv, 'tv-1-waiting-1920.png');
    results.push('TV: our Cast receiver waits on a big "Waiting for Send to TV" screen, no Google sign-in, kept open with no sender');

    // Administration > Driver Station Codes: Send to TV waits for the Cast App ID, then sends to the TV picked in Chrome.
    const p = await openPage(browser, 1536, 864, '/administration.html' + ADMIN);
    await p.waitForSelector('.adm-item.on[data-key="people"]');
    await p.click('.adm-item[data-key="driver-codes"]');
    await p.waitForSelector('#st-list [data-st-tv]');
    assert.equal(await p.isDisabled('#st-list [data-st-tv]'), true, 'Send to TV waits for the Cast App ID');
    await p.fill('#cast-id', '1a2b3c');
    await p.click('#cast-save');
    // The refusal shows in the page's message bar (the SANDBOX banner is a message bar too, so wait for the words).
    await p.waitForSelector('#view .ap-msg.bad:not([hidden]):has-text("8 letters and numbers")');
    await p.fill('#cast-id', '1a2b3c4d');
    await p.click('#cast-save');
    await p.waitForSelector('#cast-note:text("Cast App ID saved")');
    assert.equal(await p.inputValue('#cast-id'), '1A2B3C4D');
    await p.waitForSelector('#st-list [data-st-tv]:not([disabled])');
    await p.$eval('#cast-row', el => el.scrollIntoView({ block: 'center' }));
    await p.click('#st-list [data-st-tv]');
    await p.waitForSelector('#cast-note:text("Sent. VIZIO TV is showing")');
    const sent = await p.evaluate(() => ({ app: window.__castOptions.receiverApplicationId, ns: window.__castSent.ns, m: window.__castSent.m }));
    assert.equal(sent.app, '1A2B3C4D');
    assert.equal(sent.ns, 'urn:x-cast:com.uniteddairy.tv');
    assert.ok(sent.m.token && sent.m.station.type === 'TV', 'the TV gets its sign-in for the Driver\'s Kiosk Station');
    await p.$eval('#cast-note', el => el.scrollIntoView({ block: 'end' }));
    await shot(p, 'pc-send-to-tv-1536.png');
    assert.deepEqual(p.errors, []);
    results.push('Driver Station Codes: Cast App ID checked and saved; Send to TV on the Driver\'s Kiosk Station sends to the TV picked in Chrome');

    // The TV gets the message: the board opens as that Driver's Kiosk Station, with no code screen, Release, Exit or scorecard.
    await tv.evaluate((m) => window.__castMsg({ data: m }), sent.m);
    await tv.waitForSelector('#screen:not([hidden]) #eyebrow:text("Driver\'s Kiosk Station · Uniontown")');
    // The weekly schedule fills from the drivers list, which only a signed-in reader may see.
    await tv.waitForFunction(() => document.querySelectorAll('#week-rows tr').length > 0 || !document.getElementById('error').hidden, null, { timeout: 15000 });
    await tv.waitForTimeout(1000);
    for (const gone of ['#code-box', '#change', '#tv-exit', '#signout', '.topbar', '#ds-score iframe']) assert.equal(await tv.isVisible(gone), false, gone + ' is not on a sent TV');
    assert.equal(await tv.isVisible('#error'), false, 'the TV reads the board (database rules let a sent TV read it): ' + await tv.textContent('#error'));
    await shot(tv, 'tv-2-board-after-send-1920.png');
    // A Chromecast built into a TV draws web pages at 1280 x 720 whatever the screen: the board fits there too.
    await tv.setViewportSize({ width: 1280, height: 720 });
    await tv.waitForTimeout(500);
    assert.ok(await tv.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), 'the board fits the TV\'s 1280 x 720 Cast screen');
    await shot(tv, 'tv-3-board-cast-size-1280.png');
    await tv.setViewportSize({ width: 1920, height: 1080 });
    assert.deepEqual(tv.errors, []);
    results.push('TV: Send to TV opens the Driver\'s Kiosk Station board by itself: no code typed, no Release, Exit or Sign out');

    // A new code on the TV's station shuts out a TV on the old sign-in: it asks for Send to TV again.
    const key = sent.m.station.key;
    await require('../../src/admin').adminCall(db(), { email: 'admin.test@uniteddairy.com' }, { op: 'stationCode', key });
    const old = await openPage(browser, 1920, 1080, '/driver-station.html?tv=1&cast=1');
    await old.waitForFunction(() => !!window.__castMsg);
    await old.evaluate((m) => window.__castMsg({ data: m }), sent.m);
    await old.waitForSelector('#error:not([hidden])', { timeout: 15000 });
    assert.match(await old.textContent('#error'), /Press Send to TV again/);
    results.push('TV: a new code on its station shuts out the old Send to TV; the TV says to press Send to TV again');
    console.log('Send to TV browser check passed:\n- ' + results.join('\n- '));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
