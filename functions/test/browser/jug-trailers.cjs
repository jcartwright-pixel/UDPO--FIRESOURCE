'use strict';
/*
 * Browser check of Joe's 10/28 Jug Trailers (mock-up 2) on the new Debag / Labeling Room area (one card on Plant
 * Operations, Joe 10/28); + Add Trailer puts a United Dairy trailer (picked from the main trailer list, dry boxes first) or a typed number on
 * the plant's own list; Empty / Half Full / Loaded, what is on it and notes save on their own; Left the Lot takes it off and
 * a trailer coming back keeps its history. Pictures go to SHOTS_DIR.
 * Joe 11/1 (mock-up 2): Trailer Company then Unit; What is on it and Location drop-downs; Edit Lists with United Dairy protected.
 * Joe 11/3 (mock-up 2): Supplier; United Dairy trailers listed once added (Joe 11/4: not loaded from the fleet list); Edit for the location; our number typed;
 * products from Suppliers & Products with how many; no All trailers; capitals.
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
  await unit('veh_trailer_t_980', 'T-980', 'Uniontown PA Branch', 'External Fleet: 2018 | UTILITY | 53 Ft');
  await unit('veh_trailer_t_985', 'T-0985', 'Uniontown PA Branch', 'External Fleet: 2018 | UTILITY | 53 Ft');
  // Joe 11/3: what is on a trailer comes from Receiving's Suppliers & Products (made-up supplier and product).
  await db().collection('plantJournal').doc('sup_silgan').set({ type: 'PLANT_SUPPLIER', recordId: 'sup_silgan', routeId: 'sup_silgan', runId: 'sup_silgan', notes: 'Silgan', status: 'ACTIVE', createdAt: '2026-11-01T12:00:00.000Z', recordedAt: '2026-11-01T12:00:00.000Z' });
  await db().collection('receivingItems').doc('item_white_half').set({ name: 'WHITE 1/2 GAL JUG', supplierId: 'sup_silgan', kind: 'Packaging', unit: 'Bundles', status: 'ACTIVE' });
  await unit('veh_trailer_t_900', 'T-900', 'Charleston WV Branch', 'External Fleet: 2016 | UTILITY | 53 Ft', 'fac_charleston');
  const browser = await chromium.launch();
  const results = [];
  try {
    // Joe 10/31: Plant Material Trailers is in Inventory, under Shipping & Receiving (its own card on the Home screen); Debag /
    // Labeling Room stays a Plant Operations department (Under Construction) whose button opens the Labeling Room.
    const h = await openPage(browser, 1536, 790, '/index.html?testEmail=' + ADMIN);
    await h.waitForSelector('#sides .hq-card[data-card-side="shipping"] .hq-sub');
    assert.deepEqual(await h.$$eval('#sides .hq-card[data-card-side="shipping"] .hq-sub', a => a.map(x => x.textContent + ':' + x.getAttribute('href'))),
      ['Shipping:scheduler.html', 'Receiving:scheduler.html?lane=receiving', 'Receiving Log:inventory.html?tab=log', 'Plant Material Trailers:jug-trailers.html', 'Off-site Inventory:soon.html?what=offsite-inventory', 'Inventory Room:soon.html?what=inventory-room']);
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

    // Joe 11/3 (mock-up 2): a United Dairy trailer stays on the list once added (NOT HERE when it is not in the lot),
    // the company is the Supplier, Edit on each line changes where it is, + Add Trailer has the Supplier and Unit side by side
    // (our number typed, 014 is T-14) and what is on it is a product from Suppliers & Products with how many. No All trailers.
    const p = await openPage(browser, 1536, 790, '/jug-trailers.html?testEmail=' + SAM);
    // Joe 11/4: our trailers are not loaded from the fleet list; only ones put on with + Add Trailer show, and no heading line over them.
    await p.waitForFunction(() => /No trailers in the lot yet/.test(document.querySelector('#rows').textContent));
    assert.deepEqual(await p.$$eval('.pm-table th', a => a.map(x => x.textContent)), ['Supplier', 'Unit', 'Status', 'Product', 'How Many', 'Counted In', 'Location', ''], 'Joe 11/4: the heading names Inventory uses');
    assert.equal(await p.$eval('.pm-table th', th => getComputedStyle(th).color), 'rgb(255, 255, 255)', 'white words on the blue heading bar, like Inventory');
    assert.equal(await p.$('#show'), null, 'the All trailers drop-down is gone');
    assert.match(await p.$eval('#products', a => a.getAttribute('href')), /^scheduler\.html\?lane=receiving&view=products/);
    assert.equal(await p.$eval('.head h1', h => getComputedStyle(h).textTransform), 'uppercase', 'everything in capitals');
    const rowsText = () => p.$$eval('#rows tr[data-id]', rs => rs.map(r => r.cells[1].querySelector('b').textContent + ':' + r.cells[6].textContent));
    assert.deepEqual(await rowsText(), [], 'no United Dairy trailer is listed until someone adds it');
    assert.doesNotMatch(await p.$eval('#sum', e => e.textContent), /not here/i, 'no United Dairy Not Here box');
    await p.click('#add');
    await p.waitForSelector('#add-company');
    assert.equal(await p.$eval('#add-company', s => s.value), '', 'the supplier drop-down starts blank');
    assert.deepEqual(await p.$$eval('#add-company option', o => o.map(x => x.textContent)), ['', 'United Dairy', 'BW', 'CKS', 'Compass', 'Duval', 'JD', 'Metro', 'Silgan', '+ New supplier…'], 'Receiving\'s suppliers are on the list');
    assert.ok(await p.$eval('.jt-pair', d => { const [a, b] = d.querySelectorAll('label'); return a.getBoundingClientRect().top === b.getBoundingClientRect().top; }), 'Supplier and Unit side by side');
    await p.selectOption('#add-company', 'United Dairy');
    await p.type('#add-number', '98');
    // Only our dry box trailers at this plant come up (not the refrigerated one, not another plant's).
    await p.waitForFunction(() => [...document.querySelectorAll('#add-match button')].map(b => b.textContent).join(',') === 'T-980,T-985');
    await shot(p, '2-add-trailer-1536.png');
    await p.fill('#add-number', '0985');
    await p.waitForFunction(() => [...document.querySelectorAll('#add-match button')].map(b => b.textContent + (b.classList.contains('on') ? '*' : '')).join(',') === 'T-985*');
    await p.fill('#add-number', '14');
    await p.waitForFunction(() => /T-14 is not one of our/.test(document.querySelector('#add-match').textContent));
    await p.fill('#add-number', '98');
    await p.click('#add-match button:text-is("T-985")');
    assert.equal(await p.$eval('#add-number', i => i.value), 'T-985');
    assert.deepEqual(await p.$$eval('#add-item optgroup', g => g.map(x => x.label + ':' + [...x.querySelectorAll('option')].map(o => o.textContent).join('|'))),
      ['Silgan:WHITE 1/2 GAL JUG (Bundles)', 'Other items:Clear 1/2|Clear Qt|Ferry White 1/2|White 1/2|White Qt']);
    await p.selectOption('#add-item', 'WHITE 1/2 GAL JUG');
    await p.waitForFunction(() => /How many Bundles/.test(document.querySelector('.jt-prod').textContent));
    await p.fill('#add-count', '22');
    assert.match(await p.$eval('.jt-addprod', a => a.getAttribute('href')), /view=products/, '+ Add Product opens Suppliers & Products');
    await p.click('#add-go');
    await until(async () => { const t = await jug('fac_uniontown_T-985'); return t && t.inLot; }, 'T-985 added');
    let t = await jug('fac_uniontown_T-985');
    assert.deepEqual([t.status, t.location, t.company, t.unit, t.unitedDairy], ['LOADED', 'UPPER LOT', 'United Dairy', 'T-985', true]);
    assert.deepEqual(t.items, [{ item: 'WHITE 1/2 GAL JUG', pallets: '22', unit: 'Bundles' }]);
    assert.equal(t.history[0].what, 'Came into the lot at UPPER LOT');
    assert.equal(t.history[0].by, 'Sam Ortiz');
    assert.equal(await db().collection('equipment').doc('veh_trailer_t_985').get().then(d => Object.keys(d.data()).length), 6, 'the main trailer list is not changed');
    await p.waitForFunction(() => { const r = document.querySelector('#rows tr[data-id="fac_uniontown_T-985"]'); return r && [3, 4, 5].map(i => r.cells[i].textContent).join('|') === 'WHITE 1/2 GAL JUG|22|Bundles'; });
    assert.doesNotMatch(await p.$eval('#rows', e => e.textContent), /United Dairy trailers ·/, 'no heading line over our trailers');
    results.push('Only the United Dairy trailers someone added are listed; + Add Trailer: Supplier and Unit side by side, our number typed with matches to tap, a product from Suppliers & Products and how many');

    // Another of ours added with nothing on it; Edit on its line moves it.
    await p.click('#add');
    await p.selectOption('#add-company', 'United Dairy');
    await p.fill('#add-number', '601');
    await p.waitForFunction(() => [...document.querySelectorAll('#add-match button')].map(b => b.textContent + (b.classList.contains('on') ? '*' : '')).join(',') === 'T-601*');
    await p.click('#add-go');
    await until(async () => { const x = await jug('fac_uniontown_T-601'); return x && x.inLot; }, 'T-601 added');
    assert.equal((await jug('fac_uniontown_T-601')).status, 'EMPTY');
    await p.waitForSelector('#rows tr[data-id="fac_uniontown_T-601"]');
    await p.click('#rows tr[data-id="fac_uniontown_T-601"] button[data-edit]');
    await p.waitForSelector('#rows select[data-loc]');
    assert.deepEqual(await p.$$eval('#rows select[data-loc] option', o => o.map(x => x.textContent)), ['UPPER LOT', 'LOWER LOT', 'DEBAG', 'HOLD', 'NOT HERE']);
    await p.selectOption('#rows select[data-loc]', 'DEBAG');
    await shot(p, '3-edit-location-1536.png');
    await p.click('#rows button[data-save]');
    await until(async () => { const x = await jug('fac_uniontown_T-601'); return x && x.inLot && x.location === 'DEBAG'; }, 'T-601 moved to Debag');
    await p.waitForFunction(() => /DEBAG/i.test(document.querySelector('#rows tr[data-id="fac_uniontown_T-601"]').textContent));
    assert.deepEqual(await rowsText(), ['T-601:DEBAG', 'T-985:UPPER LOT'], 'only the two we added; T-980 is not listed');
    results.push('Edit on a line: a trailer moves to the place picked');

    // Another supplier's trailer: Metro, typed.
    await p.click('#add');
    await p.selectOption('#add-company', 'Metro');
    await p.fill('#add-number', '5307');
    await p.click('#add-go');
    await until(async () => !!(await jug('fac_uniontown_METRO_5307')), 'Metro 5307 added');
    t = await jug('fac_uniontown_METRO_5307');
    assert.deepEqual([t.company, t.unit, t.number, t.unitedDairy, t.status, t.location], ['Metro', '5307', 'METRO 5307', false, 'EMPTY', 'UPPER LOT']);
    assert.equal((await db().collection('equipment').where('unit', '==', '5307').get()).size, 0, 'another supplier\'s trailer stays off the main trailer list');
    const lists = () => db().collection('jugTrailerLists').doc('fac_uniontown').get().then(d => d.data());
    assert.deepEqual((await lists()).companies.find(c => c.name === 'Metro').units, ['5307'], 'the new unit number is saved on Metro\'s list');
    await p.waitForFunction(() => document.querySelector('#card h2') && document.querySelector('#card h2').textContent === 'Metro 5307');
    // A new supplier, typed.
    await p.click('#add');
    await p.selectOption('#add-company', '__new');
    await p.fill('#add-company-new', 'Penske');
    await p.fill('#add-number', '88');
    await p.click('#add-go');
    await until(async () => !!(await jug('fac_uniontown_PENSKE_88')), 'Penske 88 added');
    assert.deepEqual((await lists()).companies.find(c => c.name === 'Penske').units, ['88']);
    await p.waitForFunction(() => /Other suppliers · 2 in the lot/.test(document.querySelector('#rows').textContent));
    results.push('+ Add Trailer for other suppliers: typed; new suppliers and unit numbers go on their lists');

    // Loaded, what is on it (products), how many, location, notes: each saves on its own.
    await p.click('#rows tr[data-id="fac_uniontown_METRO_5307"] td:first-child');
    await p.waitForFunction(() => document.querySelector('#card h2').textContent === 'Metro 5307');
    const before = await p.evaluate(() => scrollY);
    await p.click('#card button[data-status="LOADED"]');
    await until(async () => (await jug('fac_uniontown_METRO_5307')).status === 'LOADED', 'Loaded saved');
    assert.equal(await p.$eval('#lines select[data-line="item"]', s => s.value), '', 'the item drop-down starts blank');
    await p.selectOption('#lines select[data-line="item"]', 'WHITE 1/2 GAL JUG');
    await until(async () => JSON.stringify((await jug('fac_uniontown_METRO_5307')).items) === JSON.stringify([{ item: 'WHITE 1/2 GAL JUG', pallets: '', unit: 'Bundles' }]), 'item saved');
    await p.fill('#lines [data-line="pallets"]', '30');
    await p.keyboard.press('Tab');
    await until(async () => JSON.stringify((await jug('fac_uniontown_METRO_5307')).items) === JSON.stringify([{ item: 'WHITE 1/2 GAL JUG', pallets: '30', unit: 'Bundles' }]), 'how many saved');
    await p.waitForFunction(() => document.querySelectorAll('#lines select[data-line="item"]').length === 2);
    await p.selectOption('#lines select[data-line="item"] >> nth=1', 'Clear Qt');
    await until(async () => (await jug('fac_uniontown_METRO_5307')).items.length === 2, 'second item saved');
    await p.fill('#card [data-notes]', 'Back row by the fence');
    await p.keyboard.press('Tab');
    await until(async () => (await jug('fac_uniontown_METRO_5307')).notes === 'Back row by the fence', 'notes saved');
    t = await jug('fac_uniontown_METRO_5307');
    assert.deepEqual(t.history.map(h => h.what), ['What is on it changed', 'Loaded', 'Came into the lot at UPPER LOT'], 'choosing several items is one line in the history');
    await p.selectOption('#loc', 'LOWER LOT');
    await until(async () => (await jug('fac_uniontown_METRO_5307')).location === 'LOWER LOT', 'location saved');
    assert.equal((await jug('fac_uniontown_METRO_5307')).history[0].what, 'Moved to LOWER LOT');
    assert.equal(await p.evaluate(() => scrollY), before, 'saving never moves the page');
    await p.waitForFunction(() => (() => { const r = document.querySelector('#rows tr[data-id="fac_uniontown_METRO_5307"]'); return r && [3, 4, 5].map(i => r.cells[i].innerHTML).join('|') === 'WHITE 1/2 GAL JUG<br>Clear Qt|30<br>|Bundles<br>'; })() && /LOWER LOT/.test(document.querySelector('#rows tr[data-id="fac_uniontown_METRO_5307"]').textContent));
    await p.click('#rows tr[data-id="fac_uniontown_T-601"] td:first-child');
    await p.click('#card button[data-status="HALF"]');
    await until(async () => (await jug('fac_uniontown_T-601')).status === 'HALF', 'Half Full saved');
    await p.waitForFunction(() => /4\s*trailers in the lot/.test(document.querySelector('#sum').textContent) && /2\s*Loaded/.test(document.querySelector('#sum').textContent) && /1\s*Half Full/.test(document.querySelector('#sum').textContent) && !/not here/i.test(document.querySelector('#sum').textContent));
    await p.click('#rows tr[data-id="fac_uniontown_METRO_5307"] td:first-child');
    await p.waitForTimeout(600);
    assert.equal(await p.$eval('.notice.error', n => n.hidden), true, 'no error');
    assert.equal(await p.$('.mach-saved, .saved-msg'), null, 'no saved message');
    const font = await p.$$eval('#rows td, #card input, #card select, #card button, #card li, .jt-sum span', els => Math.min(...els.map(x => parseFloat(getComputedStyle(x).fontSize))));
    assert.ok(font >= 16, 'text at least 16px, was ' + font);
    await shot(p, '4-jug-trailers-1536.png');
    results.push('Empty / Half Full / Loaded, what is on it (products with what they are counted in), how many, location and notes save on their own; the list and the counts follow');

    // Trailers saved before: "CKS 4737" with "White Qt IN DOCK" reads as CKS / 4737, White Qt, In Dock; our "822" is T-822.
    await db().collection('jugTrailers').doc('fac_uniontown_CKS_4737').set({ facilityId: 'fac_uniontown', number: 'CKS 4737', status: 'HALF', inLot: true, unitedDairy: false, items: [{ item: 'White Qt IN DOCK', pallets: '' }], notes: '', history: [] });
    await db().collection('jugTrailers').doc('fac_uniontown_822').set({ facilityId: 'fac_uniontown', number: '822', status: 'EMPTY', inLot: true, unitedDairy: true, items: [{ item: 'Ferry White 1/2', pallets: '' }], location: 'In the Lot', notes: '', history: [] });
    await p.waitForSelector('#rows tr[data-id="fac_uniontown_CKS_4737"]');
    assert.deepEqual(await p.$eval('#rows tr[data-id="fac_uniontown_CKS_4737"]', r => [...r.cells].map(c => c.textContent)), ['CKS', 'CKS4737Half FullWhite Qt', 'Half Full', 'White Qt', '', '', 'In Dock', 'Edit']);
    await p.waitForSelector('#rows tr[data-id="fac_uniontown_822"]');
    assert.equal(await p.$eval('#rows tr[data-id="fac_uniontown_822"] td:nth-child(2) b', b => b.textContent), 'T-822');
    results.push('Trailers saved before: "CKS 4737" reads as CKS / 4737 with IN DOCK as the Location; our "822" reads as T-822');

    // Edit Lists: United Dairy is protected; a company or unit with a trailer in the lot waits until it leaves; the four places stay.
    await p.click('#edit-lists');
    await p.waitForSelector('#card .jt-co');
    const row = (name) => p.$eval('#card .jt-co:has(> b:text-is("' + name + '"))', r => ({ text: r.textContent, dels: [...r.querySelectorAll('.jt-del')].map(b => b.textContent) }));
    const ud = await row('United Dairy');
    assert.deepEqual(ud.dels, [], 'United Dairy has no Delete');
    assert.match(ud.text, /Protected/);
    assert.deepEqual((await row('CKS')).dels, [], 'CKS 4737 is in the lot, so neither it nor CKS can be deleted yet');
    assert.deepEqual((await row('Duval')).dels, ['Delete Duval']);
    assert.equal(await p.$('#card .jt-del[data-list="location"][data-value="DEBAG"]'), null, 'the four places stay');
    await shot(p, '5-edit-lists-1536.png');
    await p.click('#card .jt-del[data-list="company"][data-value="Duval"]');
    await until(async () => !(await lists()).companies.some(c => c.name === 'Duval'), 'Duval deleted');
    await p.fill('#card [data-add-list="unit"][data-company="Compass"]', '3113');
    await p.press('#card [data-add-list="unit"][data-company="Compass"]', 'Enter');
    await until(async () => JSON.stringify((await lists()).companies.find(c => c.name === 'Compass').units) === '["3113"]', 'Compass 3113 added');
    await p.waitForSelector('#card .jt-del[data-list="unit"][data-value="3113"]');
    await p.click('#card .jt-del[data-list="unit"][data-value="3113"]');
    await until(async () => (await lists()).companies.find(c => c.name === 'Compass').units.length === 0, 'Compass 3113 deleted');
    assert.equal(await p.$('#card .jt-del[data-list="item"][data-value="Clear Qt"]'), null, 'an item on a trailer in the lot waits');
    await p.click('#card .jt-del[data-list="item"][data-value="White 1/2"]');
    await until(async () => !(await lists()).items.includes('White 1/2'), 'White 1/2 deleted');
    await p.fill('#card [data-add-list="location"]', 'Back Fence');
    await p.click('#card [data-add-go="location"]');
    await until(async () => (await lists()).locations.includes('Back Fence'), 'location added');
    await p.click('#lists-done');
    await p.waitForSelector('#card .jt-big');
    results.push('Edit Lists: add and delete suppliers, units, items and locations; United Dairy and the four places are protected; anything a trailer in the lot uses waits until it leaves');

    // Edit to NOT HERE: our trailer goes back to NOT HERE, another supplier's leaves the list; it comes back with its history.
    await p.click('#rows tr[data-id="fac_uniontown_T-985"] button[data-edit]');
    await p.selectOption('#rows select[data-loc]', 'NOT HERE');
    await p.click('#rows button[data-save]');
    await until(async () => (await jug('fac_uniontown_T-985')).inLot === false, 'T-985 left');
    // Once added, ours stays on the list as NOT HERE; Edit on its line brings it back in.
    await p.waitForFunction(() => /NOT HERE/.test(document.querySelector('#rows tr[data-id="fac_uniontown_T-985"]') ? document.querySelector('#rows tr[data-id="fac_uniontown_T-985"]').textContent : ''));
    await p.click('#rows tr[data-id="fac_uniontown_T-985"] button[data-edit]');
    await p.selectOption('#rows select[data-loc]', 'HOLD');
    await p.click('#rows button[data-save]');
    await until(async () => { const x = await jug('fac_uniontown_T-985'); return x.inLot && x.location === 'HOLD'; }, 'T-985 back at Hold');
    await p.waitForFunction(() => /HOLD/.test(document.querySelector('#rows tr[data-id="fac_uniontown_T-985"]').textContent));
    await p.click('#rows tr[data-id="fac_uniontown_METRO_5307"] button[data-edit]');
    await p.selectOption('#rows select[data-loc]', 'NOT HERE');
    await p.press('#rows select[data-loc]', 'Enter');
    await until(async () => (await jug('fac_uniontown_METRO_5307')).inLot === false, 'Metro left the lot');
    await p.waitForFunction(() => !document.querySelector('#rows tr[data-id="fac_uniontown_METRO_5307"]'));
    await p.click('#add');
    await p.selectOption('#add-company', 'Metro');
    assert.deepEqual(await p.$$eval('#add-units option', o => o.map(x => x.value)), ['5307'], 'Metro\'s unit numbers to pick from');
    await p.fill('#add-number', '5307');
    await p.click('#add-go');
    await until(async () => (await jug('fac_uniontown_METRO_5307')).inLot === true, 'came back');
    t = await jug('fac_uniontown_METRO_5307');
    assert.equal(t.status, 'EMPTY');
    assert.deepEqual(t.items, []);
    assert.deepEqual(t.history.slice(0, 2).map(h => h.what), ['Came into the lot at UPPER LOT', 'Left the lot']);
    await p.click('#add');
    await p.selectOption('#add-company', 'Metro');
    await p.fill('#add-number', '5307');
    await p.click('#add-go');
    await p.waitForFunction(() => /already on the list/.test(document.querySelector('#error').textContent));
    await p.click('#add-cancel');
    // Left the Lot on the card still works; our trailer goes back to NOT HERE.
    await p.click('#rows tr[data-id="fac_uniontown_T-601"] td:first-child');
    await p.click('#left');
    await until(async () => (await jug('fac_uniontown_T-601')).inLot === false, 'T-601 left');
    await p.waitForFunction(() => document.querySelector('#card h2').textContent === 'United Dairy T-601' && /NOT HERE/.test(document.querySelector('#card').textContent));
    results.push('Edit to NOT HERE (or Left the Lot) takes a trailer out; ours stays listed as NOT HERE; another supplier\'s comes back with its history; the same trailer twice is refused');
    assert.deepEqual(p.errors, []);
    await p.close();

    // Each window size: nothing cut off, no sideways scroll.
    for (const [w, h] of [[1920, 1080], [1536, 790], [1024, 768], [768, 1024], [390, 844]]) {
      const v = await openPage(browser, w, h, '/jug-trailers.html?testEmail=' + SAM);
      await v.waitForSelector('#rows tr[data-id]');
      await v.waitForSelector('#card h2');
      if (w === 1920) { await v.click('#edit-lists'); await v.waitForSelector('#card .jt-co'); assert.ok(await v.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await shot(v, '5-edit-lists-1920.png'); await v.click('#lists-done'); }
      await v.waitForSelector('#card h2');
      await v.waitForTimeout(800);
      assert.ok(await v.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll at ' + w);
      // The list itself shows every column (Location and Edit included) without sliding sideways.
      const fit = await v.evaluate(() => { const s = document.querySelector('#rows').closest('.pm-scroll'); return [s.scrollWidth, s.clientWidth]; });
      console.log('list width at ' + w + ': ' + fit.join(' in '));
      assert.ok(fit[0] <= fit[1] + 1, 'the list fits at ' + w + ' (' + fit.join(' > ') + ')');
      await shot(v, '4-jug-trailers-' + w + '.png');
      assert.deepEqual(v.errors, []);
      await v.close();
    }
    results.push('Fits at 1920, 1536, 1024, 768 and 390 wide, with every column of the list showing');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok - ' + r));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
