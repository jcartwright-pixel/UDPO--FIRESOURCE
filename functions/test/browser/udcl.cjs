'use strict';
/*
 * Joe 11/1: the United Dairy Customer List. Customers (by customer, route and day; a customer's card), Route Sequence (move a stop,
 * change a load number), Truck Load Map (paint a spot) and the Load Map Kiosk, each with its Print menu. Made-up customers only.
 * Pictures at 1920, 1366 and 390 go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const U = require('../../src/udcl-rules');
const S = require('../../src/udcl');
const localCalls = require('./local-calls.cjs');

const HOSTING = process.argv[2] || 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;
const EMAIL = 'cl.admin@uniteddairy.com', VIEWER = 'cl.viewer@uniteddairy.com', PLANT = 'fac_uniontown';
const MENU = [['DAY', 'ROUTE', 'Chain', 'Account', 'Name', null, null]].concat([
  ['TUE', 803, 0, 1196, 'ACORN CORNER MARKET', 4, 4], ['TUE', 803, 0, 40463, 'DQ HILLVIEW', 8, 8], ['TUE', 803, 415, 1526, 'KUHNS OAK HILL', 3, 3],
  ['TUE', 803, 0, 1984, 'QUICK STOP *COD*', 4, 4], ['TUE', 803, 0, 40221, 'DQ RIVERSIDE', 8, 8], ['FRI', 803, 0, 1196, 'ACORN CORNER MARKET', 5, 5],
  ['FRI', 803, 0, 40463, 'DQ HILLVIEW', 8, 8], ['THU', 805, 0, 13590, 'DQ BETHEL KNOLL', 6, 6], ['THU', 805, 411, 40121, 'A PLUS MAPLE #7517', 1, 1],
  ['THU', 805, 0, 1707, 'CASH N SAVE - COD', 2, 2], ['SAT', 805, 0, 13590, 'DQ BETHEL KNOLL', 7, 7], ['MON', 808, 990, 2603, 'WAL-MART #2603 MAPLETON', 10, 10]
]);
const today = U.DAYS[new Date().getDay()];

async function page(browser, email, size) {
  const ctx = await browser.newContext({ viewport: size || { width: 1920, height: 950 } });
  await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, r.request().url().split('/').pop())) }));
  await localCalls(ctx);
  const p = await ctx.newPage();
  p.on('pageerror', e => { throw e; });
  p.emailFor = (url) => HOSTING + '/' + url + (url.includes('?') ? '&' : '?') + 'testEmail=' + email;
  return p;
}
// The screen shows once its first data is drawn (app.js holdUntilDrawn); a picture waits for that.
const shot = async (p, name) => { if (!SHOTS) return; await p.waitForFunction(() => !document.body.classList.contains('ud-drawing')); await p.screenshot({ path: path.join(SHOTS, name + '.png') }); };

(async () => {
  await clear();
  await db().collection('users').doc(EMAIL).set({ name: 'Test Admin', status: 'ACTIVE', roles: ['ADMIN'], facilities: ['*'], cells: { id: 'usr_cla', version: '1' } });
  await db().collection('users').doc(VIEWER).set({ name: 'Test Dispatcher', status: 'ACTIVE', roles: ['DISPATCHER'], facilities: [PLANT], cells: { id: 'usr_clv', version: '1' } });
  const m = U.menuStops(MENU);
  // The 805 Thursday made-up Route Book: run order, a key and instructions.
  const book = { '805|THU': { startTime: '2:30 AM', instructions: ['Call the DQ before 6 AM'], stops: [{ account: '40121', name: 'A PLUS MAPLE #7517', run: 1, keys: 'Ring 4' }, { account: '1707', name: 'CASH N SAVE - COD', run: 2 }, { account: '13590', name: 'DQ BETHEL KNOLL', run: 3 }], grid: [] } };
  await S.udclCall(db(), { email: EMAIL }, PLANT, { op: 'importMenu', stops: m.stops, unrouted: m.unrouted, addresses: { 1196: { address: '12 ELM ST', city: 'MAPLETON', state: 'PA', zip: '15401' } }, book, fileName: 'Made Up Route Menu.xlsb' });

  // CHROME_PATH: a Chromium already on the computer (a test machine without Playwright's own download).
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  try {
    // Customers: by customer, by route, by day; a card; the Print menu.
    const p = await page(browser, EMAIL);
    await p.goto(p.emailFor('customers.html'));
    await p.waitForSelector('#rows tr[data-key="1196"]');
    assert.equal(await p.textContent('#count'), '9 customers');
    assert.match(await p.textContent('#rows tr[data-key="1196"]'), /12 ELM ST, MAPLETON, PA 15401.*- - T - - F -.*TUE 803 #\d, FRI 803 #\d/);
    await shot(p, 'udcl-1920-customers');
    await p.click('#views [data-view="route"]');
    await p.selectOption('#route', '805');
    assert.equal(await p.textContent('#count'), '4 deliveries');
    assert.match(await p.textContent('#rows tr.group'), /Route 805 · Thursday/);
    await shot(p, 'udcl-1920-by-route');
    await p.click('#views [data-view="day"]');
    await p.selectOption('#route', '');
    await p.selectOption('#day', 'TUE');
    assert.equal(await p.textContent('#count'), '5 deliveries');
    await p.click('#rows tr[data-key="40463"]');
    await p.waitForSelector('#panel');
    await p.fill('#c-phone', '555-0100');
    await p.press('#c-phone', 'Tab');
    await p.waitForSelector('#c-msg .good');
    assert.equal((await db().collection('udclCustomers').doc('fac_uniontown__40463').get()).data().phone, '555-0100');
    await shot(p, 'udcl-1920-customer-card');
    await p.click('#p-close');
    await p.click('#udcl-print-menu > button');
    const items = await p.$$eval('#udcl-print-menu .pm-list button', b => b.map(x => x.childNodes[0].textContent));
    assert.deepEqual(items, ['This list, as shown', 'Route sequence sheets for the office', 'Driver route book pages', 'Customer list by route', 'Customer list by day', 'Customer addresses and phones']);
    await shot(p, 'udcl-1920-print-menu');
    await p.click('#udcl-print-menu .pm-list button[data-i="2"]');
    const frame = await (await p.waitForSelector('#udcl-print', { state: 'attached' })).contentFrame();
    await frame.waitForSelector('.lm-truck');
    assert.match(await frame.textContent('body'), /Route 803 · Tuesday/);

    // Route Sequence: 805 Thursday has the Route Book's run order, start time and instructions; move a stop, change a load.
    const s = await page(browser, EMAIL, { width: 1366, height: 650 });
    await s.goto(s.emailFor('route-sequence.html?route=805&day=THU'));
    await s.waitForSelector('#rows tr[data-drag]');
    assert.deepEqual(await s.$$eval('#rows tr[data-drag]', r => r.map(x => x.dataset.drag)), ['40121', '1707', '13590']);
    assert.equal(await s.inputValue('#start'), '2:30 AM');
    assert.equal(await s.inputValue('#notes'), 'Call the DQ before 6 AM');
    await shot(s, 'udcl-1366-sequence');
    await s.click('#rows button[data-down="0"]');
    await s.waitForFunction(() => document.querySelector('#rows tr[data-drag]').dataset.drag === '1707');
    const ref = db().collection('udclRouteDays').doc('fac_uniontown__805__THU');
    for (let i = 0; i < 50 && (await ref.get()).data().stops[0].key !== '1707'; i++) await new Promise(r => setTimeout(r, 100));
    assert.deepEqual((await ref.get()).data().stops.map(x => x.key), ['1707', '40121', '13590']);
    await s.fill('#rows input.seq[data-i="2"]', '9');
    await s.press('#rows input.seq[data-i="2"]', 'Tab');
    for (let i = 0; i < 50 && (await ref.get()).data().stops[2].loadSeq !== 9; i++) await new Promise(r => setTimeout(r, 100));
    assert.equal((await ref.get()).data().stops[2].loadSeq, 9);
    await s.click('#udcl-print-menu > button');
    assert.equal(await s.textContent('#udcl-print-menu .pm-list button[data-i="0"]'), 'Route 805 Thursday for the officeStops in order with load sequence, address and notes');

    // A dispatcher sees and prints but cannot change.
    const v = await page(browser, VIEWER, { width: 1366, height: 650 });
    await v.goto(v.emailFor('route-sequence.html?route=805&day=THU'));
    await v.waitForSelector('#rows tr[data-drag]');
    assert.equal(await v.$$eval('#rows input', x => x.length), 0);
    assert.match(await v.textContent('#hint'), /Only an Administrator or Manager/);

    // Truck Load Map: paint a spot with load 9.
    const l = await page(browser, EMAIL);
    await l.goto(l.emailFor('load-map.html?route=805&day=THU'));
    await l.waitForSelector('.lm-cell.edit');
    await l.click('#brush button[data-seq="9"]');
    await l.click('.lm-cell[data-r="0"][data-c="0"]');
    const spot = async () => U.cleanMap((await ref.get()).data().map).cells[0][0];
    for (let i = 0; i < 60 && (await spot()) !== 9; i++) await new Promise(r => setTimeout(r, 100));
    assert.equal(await spot(), 9);
    await l.selectOption('#door', '6');
    await l.waitForSelector('.lm-door');
    await shot(l, 'udcl-1920-load-map');

    // The kiosk: today's routes as buttons, the truck and its customers, nothing to change.
    const k = await page(browser, EMAIL, { width: 1920, height: 1080 });
    await k.goto(k.emailFor('load-map.html?kiosk=1&day=THU'));
    await k.waitForSelector('#kiosk-routes button[data-route="805"]');
    assert.equal(await k.$$eval('.lm-cell.edit', x => x.length), 0);
    assert.equal(await k.isHidden('#editor'), true);
    assert.match(await k.textContent('#rows'), /CASH N SAVE/);
    await shot(k, 'udcl-1920-kiosk');

    // A phone width.
    const ph = await page(browser, EMAIL, { width: 390, height: 844 });
    await ph.goto(ph.emailFor('customers.html'));
    await ph.waitForSelector('#rows tr[data-key]');
    await shot(ph, 'udcl-390-customers');
    void today;
    console.log('udcl: ok');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
