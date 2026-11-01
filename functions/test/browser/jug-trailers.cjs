'use strict';
/*
 * Browser check of Joe's 10/28 Jug Trailers (mock-up 2) on the new Debag / Labeling Room area (one card on Plant
 * Operations, Joe 10/28); + Add Trailer puts a United Dairy trailer (picked from the main trailer list, dry boxes first) or a typed number on
 * the plant's own list; Empty / Half Full / Loaded, what is on it and notes save on their own; Left the Lot takes it off and
 * a trailer coming back keeps its history. Pictures go to SHOTS_DIR.
 * Joe 11/1 (mock-up 2): Trailer Company then Unit; What is on it and Location drop-downs; Edit Lists with United Dairy protected.
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
    // Joe 11/1 (mock-up 2): + Add Trailer asks for the Trailer Company first (a drop-down that starts blank), then the unit:
    // United Dairy's from the fleet list, any other company's picked from its list or typed new.
    const p = await openPage(browser, 1536, 790, '/jug-trailers.html?testEmail=' + SAM);
    await p.waitForSelector('#rows td.empty');
    await p.waitForFunction(() => /No trailers in the lot yet/.test(document.querySelector('#rows').textContent));
    assert.deepEqual(await p.$$eval('.pm-table th', a => a.map(x => x.textContent)), ['Trailer Company', 'Unit', 'Status', 'What Is on It', 'Location']);
    await p.click('#add');
    await p.waitForSelector('#add-company');
    assert.equal(await p.$eval('#add-company', s => s.value), '', 'the company drop-down starts blank');
    assert.deepEqual(await p.$$eval('#add-company option', o => o.map(x => x.textContent)), ['', 'United Dairy', 'BW', 'CKS', 'Compass', 'Duval', 'JD', 'Metro', '+ New trailer company…']);
    assert.equal(await p.$('#add-unit, #add-pick, #add-number'), null, 'the unit number comes after the company');
    await p.selectOption('#add-company', 'United Dairy');
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
    assert.equal(t.company, 'United Dairy');
    assert.equal(t.unit, 'T-601');
    assert.equal(t.history[0].what, 'Came into the lot');
    assert.equal(t.history[0].by, 'Sam Ortiz');
    assert.equal(await db().collection('equipment').doc('veh_trailer_t_601').get().then(d => Object.keys(d.data()).length), 6, 'the main trailer list is not changed');
    // Another company's trailer: Metro, a new unit number typed.
    await p.click('#add');
    await p.selectOption('#add-company', 'Metro');
    await p.waitForSelector('#add-pick');
    assert.deepEqual(await p.$$eval('#add-pick option', o => o.map(x => x.textContent)), ['', '+ New Metro unit number…']);
    await p.selectOption('#add-pick', '__new');
    await p.waitForSelector('#add-number');
    await p.fill('#add-number', '5307');
    await p.click('#add-go');
    await until(async () => !!(await jug('fac_uniontown_METRO_5307')), 'Metro 5307 added');
    t = await jug('fac_uniontown_METRO_5307');
    assert.deepEqual([t.company, t.unit, t.number, t.unitedDairy], ['Metro', '5307', 'METRO 5307', false]);
    assert.equal((await db().collection('equipment').where('unit', '==', '5307').get()).size, 0, 'another company\'s trailer stays off the main trailer list');
    const lists = () => db().collection('jugTrailerLists').doc('fac_uniontown').get().then(d => d.data());
    assert.deepEqual((await lists()).companies.find(c => c.name === 'Metro').units, ['5307'], 'the new unit number is saved on Metro\'s list');
    await p.waitForSelector('#card h2');
    assert.equal(await p.$eval('#card h2', h => h.textContent), 'Metro 5307');
    // A new company, typed.
    await p.click('#add');
    await p.selectOption('#add-company', '__new');
    await p.fill('#add-company-new', 'Penske');
    await p.waitForSelector('#add-number');
    await p.fill('#add-number', '88');
    await p.click('#add-go');
    await until(async () => !!(await jug('fac_uniontown_PENSKE_88')), 'Penske 88 added');
    assert.deepEqual((await lists()).companies.find(c => c.name === 'Penske').units, ['88']);
    await p.waitForFunction(() => [...document.querySelectorAll('#rows tr[data-id]')].map(r => r.cells[0].textContent + ' ' + r.cells[1].querySelector('b').textContent).join(',') === 'United Dairy T-601,Metro 5307,Penske 88', null, { timeout: 15000 });
    results.push('+ Add Trailer: Trailer Company first (blank drop-down), then the unit: United Dairy from the fleet list, others picked or typed; new companies and units go on their lists; the list shows United Dairy first');

    // Loaded, what is on it (a drop-down; a new item typed goes on its list), location, notes: each saves on its own.
    await p.click('#rows tr[data-id="fac_uniontown_METRO_5307"]');
    await p.waitForFunction(() => document.querySelector('#card h2').textContent === 'Metro 5307');
    const before = await p.evaluate(() => scrollY);
    await p.click('#card button[data-status="LOADED"]');
    await until(async () => (await jug('fac_uniontown_METRO_5307')).status === 'LOADED', 'Loaded saved');
    assert.equal(await p.$eval('#lines select[data-line="item"]', s => s.value), '', 'the item drop-down starts blank');
    assert.deepEqual(await p.$$eval('#lines select[data-line="item"] option', o => o.map(x => x.textContent)), ['', 'Clear 1/2', 'Clear Qt', 'Ferry White 1/2', 'White 1/2', 'White Qt', '+ New item…']);
    await p.selectOption('#lines select[data-line="item"]', 'Ferry White 1/2');
    await until(async () => JSON.stringify((await jug('fac_uniontown_METRO_5307')).items) === JSON.stringify([{ item: 'Ferry White 1/2', pallets: '' }]), 'item saved');
    await p.fill('#lines [data-line="pallets"]', '22');
    await p.keyboard.press('Tab');
    await until(async () => JSON.stringify((await jug('fac_uniontown_METRO_5307')).items) === JSON.stringify([{ item: 'Ferry White 1/2', pallets: '22' }]), 'pallets saved');
    await p.waitForFunction(() => document.querySelectorAll('#lines [data-line="item"]').length === 2);
    await p.selectOption('#lines select[data-line="item"] >> nth=1', '__new');
    await p.waitForSelector('#lines input[data-new]');
    await p.fill('#lines input[data-new]', 'Gallon jugs');
    await p.keyboard.press('Tab');
    await until(async () => (await jug('fac_uniontown_METRO_5307')).items.length === 2, 'new item saved');
    assert.ok((await lists()).items.includes('Gallon jugs'), 'a new item goes on the list');
    await p.waitForFunction(() => document.querySelectorAll('#lines select[data-line="item"]').length === 3);
    await p.fill('#card [data-notes]', 'Back row by the fence');
    await p.keyboard.press('Tab');
    await until(async () => (await jug('fac_uniontown_METRO_5307')).notes === 'Back row by the fence', 'notes saved');
    t = await jug('fac_uniontown_METRO_5307');
    assert.deepEqual(t.history.map(h => h.what), ['What is on it changed', 'Loaded', 'Came into the lot'], 'choosing several items is one line in the history');
    await p.selectOption('#loc', 'In Dock');
    await until(async () => (await jug('fac_uniontown_METRO_5307')).location === 'In Dock', 'location saved');
    assert.equal((await jug('fac_uniontown_METRO_5307')).history[0].what, 'Moved to In Dock');
    assert.equal(await p.evaluate(() => scrollY), before, 'saving never moves the page');
    await p.waitForFunction(() => /Ferry White 1\/2, 22 pallets; Gallon jugs/.test(document.querySelector('#rows').textContent) && /In Dock/.test(document.querySelector('#rows tr[data-id="fac_uniontown_METRO_5307"]').textContent));
    await p.click('#rows tr[data-id="fac_uniontown_T-601"]');
    await p.click('#card button[data-status="HALF"]');
    await until(async () => (await jug('fac_uniontown_T-601')).status === 'HALF', 'Half Full saved');
    await p.waitForFunction(() => /3\s*trailers in the lot/.test(document.querySelector('#sum').textContent) && /1\s*Loaded/.test(document.querySelector('#sum').textContent) && /1\s*Half Full/.test(document.querySelector('#sum').textContent));
    await p.click('#rows tr[data-id="fac_uniontown_METRO_5307"]');
    await p.waitForTimeout(600);
    assert.equal(await p.$eval('.notice.error', n => n.hidden), true, 'no error');
    assert.equal(await p.$('.mach-saved, .saved-msg'), null, 'no saved message');
    const font = await p.$$eval('#rows td, #card input, #card select, #card button, #card li, .jt-sum span', els => Math.min(...els.map(x => parseFloat(getComputedStyle(x).fontSize))));
    assert.ok(font >= 16, 'text at least 16px, was ' + font);
    await shot(p, '3-jug-trailers-1536.png');
    results.push('Empty / Half Full / Loaded, what is on it (a drop-down; a new item typed goes on the list), location and notes save on their own; the list and the counts follow');

    // A trailer saved before 11/1 ("CKS 4737", "White Qt IN DOCK") reads as CKS / 4737, White Qt, In Dock.
    await db().collection('jugTrailers').doc('fac_uniontown_CKS_4737').set({ facilityId: 'fac_uniontown', number: 'CKS 4737', status: 'HALF', inLot: true, unitedDairy: false, items: [{ item: 'White Qt IN DOCK', pallets: '' }], notes: '', history: [] });
    await p.waitForSelector('#rows tr[data-id="fac_uniontown_CKS_4737"]');
    assert.deepEqual(await p.$eval('#rows tr[data-id="fac_uniontown_CKS_4737"]', r => [...r.cells].map(c => c.textContent)), ['CKS', 'CKS4737Half Full', 'Half Full', 'White Qt', 'In Dock']);
    results.push('Trailers saved before: "CKS 4737" reads as CKS / 4737, and IN DOCK moves to the Location');

    // Edit Lists: United Dairy is protected; a company or unit with a trailer in the lot waits until it leaves.
    await p.click('#edit-lists');
    await p.waitForSelector('#card .jt-co');
    const row = (name) => p.$eval('#card .jt-co:has(> b:text-is("' + name + '"))', r => ({ text: r.textContent, dels: [...r.querySelectorAll('.jt-del')].map(b => b.textContent) }));
    const ud = await row('United Dairy');
    assert.deepEqual(ud.dels, [], 'United Dairy has no Delete');
    assert.match(ud.text, /Protected/);
    assert.deepEqual((await row('CKS')).dels, [], 'CKS 4737 is in the lot, so neither it nor CKS can be deleted yet');
    assert.deepEqual((await row('Duval')).dels, ['Delete Duval']);
    await shot(p, '5-edit-lists-1536.png');
    await p.click('#card .jt-del[data-list="company"][data-value="Duval"]');
    await until(async () => !(await lists()).companies.some(c => c.name === 'Duval'), 'Duval deleted');
    await p.fill('#card [data-add-list="unit"][data-company="Compass"]', '3113');
    await p.press('#card [data-add-list="unit"][data-company="Compass"]', 'Enter');
    await until(async () => JSON.stringify((await lists()).companies.find(c => c.name === 'Compass').units) === '["3113"]', 'Compass 3113 added');
    await p.waitForSelector('#card .jt-del[data-list="unit"][data-value="3113"]');
    await p.click('#card .jt-del[data-list="unit"][data-value="3113"]');
    await until(async () => (await lists()).companies.find(c => c.name === 'Compass').units.length === 0, 'Compass 3113 deleted');
    assert.equal(await p.$('#card .jt-del[data-list="item"][data-value="Ferry White 1/2"]'), null, 'an item on a trailer in the lot waits');
    await p.click('#card .jt-del[data-list="item"][data-value="Clear Qt"]');
    await until(async () => !(await lists()).items.includes('Clear Qt'), 'Clear Qt deleted');
    await p.fill('#card [data-add-list="location"]', 'Back Fence');
    await p.click('#card [data-add-go="location"]');
    await until(async () => (await lists()).locations.includes('Back Fence'), 'location added');
    await p.click('#lists-done');
    await p.waitForSelector('#card .jt-big');
    results.push('Edit Lists: add and delete companies, units, items and locations; United Dairy is protected; anything a trailer in the lot uses waits until it leaves');

    // Left the Lot, then the trailer comes back with its history; the same trailer twice is refused.
    await p.click('#rows tr[data-id="fac_uniontown_METRO_5307"]');
    await p.click('#left');
    await until(async () => (await jug('fac_uniontown_METRO_5307')).inLot === false, 'left the lot');
    await p.waitForFunction(() => !document.querySelector('#rows tr[data-id="fac_uniontown_METRO_5307"]'));
    await p.click('#add');
    await p.selectOption('#add-company', 'Metro');
    await p.selectOption('#add-pick', '5307');
    await p.click('#add-go');
    await until(async () => (await jug('fac_uniontown_METRO_5307')).inLot === true, 'came back');
    t = await jug('fac_uniontown_METRO_5307');
    assert.equal(t.status, 'EMPTY');
    assert.deepEqual(t.items, []);
    assert.equal(t.location, '');
    assert.deepEqual(t.history.slice(0, 2).map(h => h.what), ['Came into the lot', 'Left the lot']);
    await p.click('#add');
    await p.selectOption('#add-company', 'Metro');
    assert.deepEqual(await p.$$eval('#add-pick option', o => o.map(x => x.textContent)), ['', '+ New Metro unit number…'], 'a trailer in the lot is left off');
    await p.selectOption('#add-pick', '__new');
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
      if (w === 1920) { await v.click('#edit-lists'); await v.waitForSelector('#card .jt-co'); assert.ok(await v.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await shot(v, '5-edit-lists-1920.png'); await v.click('#lists-done'); }
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
