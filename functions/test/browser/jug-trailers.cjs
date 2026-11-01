'use strict';
/*
 * Browser check of Joe's 10/28 Jug Trailers (mock-up 2) on the new Debag / Labeling Room area (one card on Plant
 * Operations, Joe 10/28); + Add Trailer puts a United Dairy trailer (picked from the main trailer list, dry boxes first) or a typed number on
 * the plant's own list; Empty / Half Full / Loaded, what is on it and notes save on their own; Left the Lot takes it off and
 * a trailer coming back keeps its history. Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;
const ADMIN = 'admin.test@uniteddairy.com';
const SAM = 'sam.ortiz@uniteddairy.com';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  global.lastPage = page;
  return page;
}
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name) }); };
const jug = (id) => db().collection('jugTrailers').doc(id).get().then(d => (d.exists ? d.data() : null));
async function until(check, what) {
  for (let i = 0; i < 75; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 200)); }
  if (global.lastPage) console.log('screen says:', await global.lastPage.$eval('#error', e => e.textContent).catch(() => ''), global.lastPage.errors);
  assert.fail('timed out: ' + what);
}
const unit = (id, number, location, notes, facilityId) => db().collection('equipment').doc(id).set({ type: 'TRAILER', unit: number, status: 'ACTIVE', location, facilityId: facilityId || 'fac_uniontown', notes });

(async () => {
  await clear();
  await db().collection('users').doc(ADMIN).set({ name: 'Admin Test', status: 'ACTIVE', roles: ['ADMINISTRATOR'], facilities: ['fac_uniontown'] });
  await db().collection('users').doc(SAM).set({ name: 'Sam Ortiz', status: 'ACTIVE', roles: ['PLANT_EMPLOYEE'], facilities: ['fac_uniontown'] });
  await db().collection('config').doc('app').set({ writeBack: { enabled: true } }, { merge: true });
  await unit('veh_trailer_t_601', 'T-601', 'Uniontown PA Branch', 'External Fleet: 2016 | UTILITY | 53 Ft');
  await unit('veh_trailer_t_602', 'T-602', 'Uniontown PA Branch', 'External Fleet: 2014 | GREAT DANE | Refrigerated');
  await unit('veh_trailer_t_900', 'T-900', 'Charleston WV Branch', 'External Fleet: 2016 | UTILITY | 53 Ft', 'fac_charleston');
  const browser = await chromium.launch();
  const results = [];
  try {
    // Joe 10/31: Plant Material Trailers is in Inventory, under Shipping & Receiving (its own card on the Home screen); Debag /
    // Labeling Room stays a Plant Operations department (Under Construction) whose button opens the Labeling Room.
    const h = await openPage(browser, 1536, 790, '/index.html?testEmail=' + ADMIN);
    await h.waitForSelector('#sides .hq-card[data-card-side="shipping"] .hq-sub');
    assert.deepEqual(await h.$$eval('#sides .hq-card[data-card-side="shipping"] .hq-sub', a => a.map(x => x.textContent + ':' + x.getAttribute('href'))),
      ['Shipping:scheduler.html', 'Receiving:scheduler.html?lane=receiving', 'Receiving Log:inventory.html', 'Plant Material Trailers:jug-trailers.html', 'Off-site Inventory:soon.html?what=offsite-inventory', 'Inventory Room:soon.html?what=inventory-room']);
    assert.equal(await h.$eval('#sides .hq-card[data-group="plantops"] .hq-main[data-side="debag"]', a => a.getAttribute('href')), 'labeling.html');
    await h.waitForTimeout(1200);
    await shot(h, '1-home-1536.png');
    assert.deepEqual(h.errors, []);
    await h.close();
    const g = await openPage(browser, 1536, 790, '/group.html?g=plantops&testEmail=' + ADMIN);
    await g.waitForSelector('#sides a[data-side="debag"]');
    assert.equal(await g.$eval('#sides a[data-side="debag"]', a => a.getAttribute('href')), 'labeling.html');
    assert.equal(await g.$eval('#sides a[data-side="debag"] strong', a => a.textContent), 'Debag / Labeling Room');
    await Promise.all([g.waitForURL(/labeling\.html/), g.click('#sides a[data-side="debag"]')]);
    await g.waitForSelector('#lanes', { state: 'attached' });
    assert.equal(await g.$eval('main h1, h1', e => e.textContent), 'Labeling Room');
    assert.deepEqual(g.errors, []);
    await g.close();
    results.push('Plant Material Trailers is under Inventory on the Home screen\'s Shipping & Receiving card; Debag / Labeling Room is a Plant Operations department being built that opens the Labeling Room');

    // Sam, on the plant floor, adds the trailers and fills them in.
    const p = await openPage(browser, 1536, 790, '/jug-trailers.html?testEmail=' + SAM);
    await p.waitForSelector('#rows td.empty');
    await p.waitForFunction(() => /No trailers in the lot yet/.test(document.querySelector('#rows').textContent));
    await p.click('#add');
    await p.waitForSelector('#add-unit');
    assert.equal(await p.$eval('#add-unit', s => s.value), '', 'the drop-down starts blank');
    const groups = await p.$$eval('#add-unit optgroup', gs => gs.map(x => [x.label, [...x.querySelectorAll('option')].map(o => o.textContent)]));
    assert.deepEqual(groups, [['Dry box trailers', ['T-601']], ['Other United Dairy trailers', ['T-602']]], 'this plant\'s trailers only, dry boxes first');
    await shot(p, '2-add-trailer-1536.png');
    await p.selectOption('#add-unit', 'veh_trailer_t_601');
    await p.click('#add-go');
    await until(async () => { const t = await jug('fac_uniontown_T-601'); return t && t.inLot; }, 'T-601 added');
    let t = await jug('fac_uniontown_T-601');
    assert.equal(t.status, 'EMPTY');
    assert.equal(t.unitedDairy, true);
    assert.equal(t.history[0].what, 'Came into the lot');
    assert.equal(t.history[0].by, 'Sam Ortiz');
    assert.equal(await db().collection('equipment').doc('veh_trailer_t_601').get().then(d => Object.keys(d.data()).length), 6, 'the main trailer list is not changed');
    // A trailer not on the main list, by its number.
    await p.click('#add');
    await p.waitForSelector('#add-number');
    await p.fill('#add-number', '5307');
    await p.click('#add-go');
    await until(async () => !!(await jug('fac_uniontown_5307')), '5307 added');
    assert.equal((await db().collection('equipment').where('unit', '==', '5307').get()).size, 0, 'a typed number stays off the main trailer list');
    await p.waitForSelector('#card h2');
    assert.equal(await p.$eval('#card h2', h => h.textContent), 'Trailer 5307');
    results.push('+ Add Trailer: a United Dairy trailer from the main list (dry boxes first, drop-down starts blank) or a typed number; kept on the plant list only');

    // Loaded, what is on it, notes: each saves on its own and nothing moves.
    const before = await p.evaluate(() => scrollY);
    await p.click('#card button[data-status="LOADED"]');
    await until(async () => (await jug('fac_uniontown_5307')).status === 'LOADED', 'Loaded saved');
    const items = await p.$$('#lines [data-line="item"]');
    await items[0].fill('Gallon jugs');
    await (await p.$$('#lines [data-line="pallets"]'))[0].fill('22');
    await p.click('#card [data-notes]');
    await until(async () => JSON.stringify((await jug('fac_uniontown_5307')).items) === JSON.stringify([{ item: 'Gallon jugs', pallets: '22' }]), 'items saved');
    await p.waitForFunction(() => document.querySelectorAll('#lines [data-line="item"]').length === 2);
    await (await p.$$('#lines [data-line="item"]'))[1].fill('Caps');
    await (await p.$$('#lines [data-line="pallets"]'))[1].fill('2');
    await p.fill('#card [data-notes]', 'Back row by the fence');
    await p.keyboard.press('Tab');
    await until(async () => { const x = await jug('fac_uniontown_5307'); return x.items.length === 2 && x.notes === 'Back row by the fence'; }, 'second item and notes saved');
    t = await jug('fac_uniontown_5307');
    assert.deepEqual(t.history.map(h => h.what), ['What is on it changed', 'Loaded', 'Came into the lot'], 'typing several items is one line in the history');
    assert.equal(await p.evaluate(() => scrollY), before, 'saving never moves the page');
    await p.waitForFunction(() => /Gallon jugs, 22 pallets; Caps, 2 pallets/.test(document.querySelector('#rows').textContent));
    await p.click('#rows tr[data-id="fac_uniontown_T-601"]');
    await p.click('#card button[data-status="HALF"]');
    await until(async () => (await jug('fac_uniontown_T-601')).status === 'HALF', 'Half Full saved');
    await p.waitForFunction(() => /2\s*trailers in the lot/.test(document.querySelector('#sum').textContent) && /1\s*Loaded/.test(document.querySelector('#sum').textContent) && /1\s*Half Full/.test(document.querySelector('#sum').textContent));
    await p.click('#rows tr[data-id="fac_uniontown_5307"]');
    await p.waitForTimeout(600);
    assert.equal(await p.$eval('.notice.error', n => n.hidden), true, 'no error');
    assert.equal(await p.$('.mach-saved, .saved-msg'), null, 'no saved message');
    const font = await p.$$eval('#rows td, #card input, #card button, #card li, .jt-sum span', els => Math.min(...els.map(x => parseFloat(getComputedStyle(x).fontSize))));
    assert.ok(font >= 16, 'text at least 16px, was ' + font);
    await shot(p, '3-jug-trailers-1536.png');
    results.push('Empty / Half Full / Loaded, what is on it (item and pallets) and notes save on their own; the list and the counts follow');

    // The filter on the right.
    await p.selectOption('#show', 'LOADED');
    assert.deepEqual(await p.$$eval('#rows tr[data-id]', r => r.map(x => x.dataset.id)), ['fac_uniontown_5307']);
    await p.selectOption('#show', '');

    // Left the Lot, then the trailer comes back with its history; the same trailer twice is refused.
    await p.click('#left');
    await until(async () => (await jug('fac_uniontown_5307')).inLot === false, 'left the lot');
    await p.waitForFunction(() => !document.querySelector('#rows tr[data-id="fac_uniontown_5307"]'));
    await p.click('#add');
    await p.fill('#add-number', '5307');
    await p.click('#add-go');
    await until(async () => (await jug('fac_uniontown_5307')).inLot === true, 'came back');
    t = await jug('fac_uniontown_5307');
    assert.equal(t.status, 'EMPTY');
    assert.deepEqual(t.items, []);
    assert.deepEqual(t.history.slice(0, 2).map(h => h.what), ['Came into the lot', 'Left the lot']);
    await p.click('#add');
    await p.fill('#add-number', '5307');
    await p.click('#add-go');
    await p.waitForFunction(() => /already on the list/.test(document.querySelector('#error').textContent));
    await p.click('#add-cancel');
    results.push('Left the Lot takes a trailer off the list; it comes back with its history; the same trailer twice is refused');
    assert.deepEqual(p.errors, []);
    await p.close();

    // Each window size: nothing cut off, no sideways scroll.
    for (const [w, h] of [[1920, 1080], [1024, 768], [390, 844]]) {
      const v = await openPage(browser, w, h, '/jug-trailers.html?testEmail=' + SAM);
      await v.waitForSelector('#rows tr[data-id]');
      await v.waitForSelector('#card h2');
      await v.waitForTimeout(800);
      assert.ok(await v.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll at ' + w);
      await shot(v, '4-jug-trailers-' + w + '.png');
      assert.deepEqual(v.errors, []);
      await v.close();
    }
    results.push('Fits at 1920, 1024 and 390 wide');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok - ' + r));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
