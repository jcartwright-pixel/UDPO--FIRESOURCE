'use strict';
/*
 * Browser check of the machine product drop-downs (Joe 10/10): Quality's Product is picked from the machine's own RedZone
 * products, blank to start, with the size following the product and "Other (type it)" for anything not listed; a product saved
 * before that is not on the list stays as its own choice. Administration > Products (Joe 10/11: plant, area and group drop-downs, Areas & Groups, template download and upload
 * with a preview) changes a machine's list and Quality follows. Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const AS = 'testEmail=manager.test@uniteddairy.com';
const START = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../public/data/plant-products.json'), 'utf8'));
const startOf = (id) => START.lines.find(l => l.operationId === id).products;
// The Excel reader the page loads from cdnjs; a local copy stands in where the test machine cannot reach cdnjs (XLSX_LOCAL).
const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: SHOTS && width === 1920 ? 2 : 1 });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    const file = route.request().url().split('/').pop();
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, file)) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
async function fits(page, what) {
  const size = await page.evaluate(() => ({ scroll: document.scrollingElement.scrollHeight, inner: window.innerHeight, width: document.scrollingElement.scrollWidth, innerWidth: window.innerWidth }));
  assert.ok(size.scroll <= size.inner && size.width <= size.innerWidth, what + ' fits with no page scrolling: ' + JSON.stringify(size));
}
async function shots(page, name, w) {
  if (!SHOTS) return;
  await page.screenshot({ path: path.join(SHOTS, name + '-' + w + '.png'), scale: 'css' });
  if (w === 1920) await page.screenshot({ path: path.join(SHOTS, name + '-top-2x.png'), clip: { x: 0, y: 0, width: 1920, height: 475 }, scale: 'device' });
}
const lastQuality = async (id) => (await db().collection('plantJournal').where('type', '==', 'PRODUCTION_QUALITY').get()).docs.map(d => d.data()).filter(d => d.payload.operationId === id && d.createdInApp);

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  const browser = await chromium.launch();
  try {
    const page = await openPage(browser, 1920, 950, '/quality.html?line=ut_prod_gallon_filler&' + AS);
    await page.waitForFunction(() => document.getElementById('form-title').textContent === 'GALLON FILLER Quality Check' && document.querySelector('select.prod-product'));
    const opts = await page.$$eval('select.prod-product option', o => o.map(x => [x.value, x.textContent]));
    const gallon = startOf('ut_prod_gallon_filler');
    assert.equal(opts.length, gallon.length + 2, 'blank, the machine\'s products, Other');
    assert.deepEqual(opts[0], ['', '']);
    assert.equal(opts[opts.length - 1][1], 'Other (type it)');
    assert.ok(opts.some(o => o[0] === 'GV 2% Gallon') && opts.some(o => o[0] === 'Jersey 2% Gallon'), 'GV and Jersey are separate choices');
    assert.equal(await page.inputValue('select.prod-product'), '', 'starts blank');
    await page.focus('select.prod-product'); // as a person does: the box is in use while it is picked
    await page.selectOption('select.prod-product', 'GV 2% Gallon');
    await page.waitForFunction(() => /Saved/.test(document.querySelector("[data-note=\"prod-product\"]").textContent));
    assert.equal(await page.inputValue('select.prod-size'), 'Gallon', 'the size follows the product');
    let saved = await lastQuality('ut_prod_gallon_filler');
    assert.deepEqual([saved.length, saved[0].payload.product, saved[0].payload.productSize], [1, 'GV 2% Gallon', 'Gallon']);
    await page.focus('select.prod-product'); // as a person does: the box is in use while it is picked
    await page.selectOption('select.prod-product', '__other__');
    await page.waitForSelector('.prod-other:not([hidden])');
    await page.fill('.prod-other', 'Test run eggnog');
    await page.click('#form-title');
    await page.waitForFunction(async () => /Saved/.test(document.querySelector('[data-note="prod-product"]').textContent));
    await page.waitForFunction(() => document.querySelector('select.prod-product') && document.querySelector('select.prod-product').value === 'Test run eggnog');
    for (let i = 0; i < 40 && (saved = await lastQuality('ut_prod_gallon_filler'))[0].payload.product !== 'Test run eggnog'; i++) await page.waitForTimeout(250);
    assert.equal(saved[0].payload.product, 'Test run eggnog', 'Other saves what was typed and shows as its own choice');
    await page.focus('select.prod-product'); // as a person does: the box is in use while it is picked
    await page.selectOption('select.prod-product', 'GV 2% Gallon');
    await page.waitForFunction(() => /Saved/.test(document.querySelector('[data-note="prod-product"]').textContent));
    await fits(page, 'Quality 1920');
    await shots(page, 'quality-product-dropdown', 1920);
    if (SHOTS) {
      await page.evaluate(() => { const s = document.querySelector('select.prod-product'); s.size = 14; s.style.height = 'auto'; s.style.position = 'relative'; s.style.zIndex = 5; });
      await page.screenshot({ path: path.join(SHOTS, 'quality-product-list-1920.png'), scale: 'css' });
    }
    // Boxing's last check was typed before the list: it stays as its own choice.
    await page.click('[data-line="ut_prod_boxing"]');
    await page.waitForFunction(() => document.getElementById('form-title').textContent === 'BOXING Quality Check');
    assert.deepEqual(page.errors, []);

    const admin = await openPage(browser, 1920, 950, '/products.html?plant=fac_uniontown&line=ut_prod_totes&' + AS);
    if (process.env.XLSX_LOCAL) await admin.route(XLSX_URL, r => r.fulfill({ path: process.env.XLSX_LOCAL, contentType: 'application/javascript' }));
    const areaCount = (id) => admin.$eval('#area option[value="' + id + '"]', o => (/\((\d+)\)$/.exec(o.textContent) || [])[1]);
    await admin.waitForFunction(() => document.getElementById('form-title').textContent === 'TOTES Products' && document.querySelectorAll('#rows input[data-k="name"]').length === 1);
    assert.equal(await admin.inputValue('#plant'), 'fac_uniontown');
    assert.equal(await admin.inputValue('#area'), 'ut_prod_totes', 'the area drop-down shows the machine');
    const areaNames = await admin.$$eval('#area option', o => o.map(x => x.textContent.replace(/ \(\d+\)$/, '')));
    assert.deepEqual(areaNames.slice(-2), ['CASES', 'TANKER'], 'Uniontown\'s own areas follow its machines');
    assert.deepEqual(await admin.$$eval('#group option', o => o.map(x => x.textContent)), ['All groups', 'Milk', 'Drinks', 'TEA']);
    // Joe 10/11: "It's just products": RedZone is named only on the Get from RedZone button (Joe 10/11, tap into RedZone).
    assert.ok(!(await admin.$eval('#screen', el => { const c = el.cloneNode(true); c.querySelector('#redzone').remove(); return c.innerText; })).includes('RedZone'), 'no RedZone name on the screen');
    assert.equal(await admin.inputValue('#rows input[data-k="name"]'), startOf('ut_prod_totes')[0].name);
    await admin.click('#add');
    await admin.fill('#rows tr:first-child input[data-k="name"]', 'UD Whole Milk Tote');
    await admin.fill('#rows tr:first-child input[data-k="sku"]', '999001');
    await admin.click('#form-title');
    await admin.waitForFunction(() => /Saved/.test(document.getElementById('foot').textContent) && /\(2\)$/.test(document.querySelector('#area option[value="ut_prod_totes"]').textContent));
    let doc = null;
    for (let i = 0; i < 40 && !((doc = (await db().collection('plantProducts').doc('ut_prod_totes').get()).data()) && doc.products[0].sku); i++) await admin.waitForTimeout(250);
    assert.deepEqual(doc.products.map(p => [p.name, p.sku]), [['UD Whole Milk Tote', '999001'], [startOf('ut_prod_totes')[0].name, startOf('ut_prod_totes')[0].sku]]);
    // Joe 10/11: UPC, speeds, Target % and shelf life on the same row; numbers are kept as numbers, blanks left off.
    assert.equal(await admin.inputValue('#rows tr:last-child input[data-k="ratePerMin"]'), String(startOf('ut_prod_totes')[0].ratePerMin), 'RedZone\'s Rate/Min is in the starting list');
    await admin.fill('#rows tr:first-child input[data-k="upc"]', '0 70852 99900 1');
    await admin.fill('#rows tr:first-child input[data-k="targetPct"]', '62.5');
    await admin.fill('#rows tr:first-child input[data-k="shelfLifeDays"]', '14');
    await admin.click('#form-title');
    for (let i = 0; i < 40 && !((doc = (await db().collection('plantProducts').doc('ut_prod_totes').get()).data()) && doc.products[0].shelfLifeDays); i++) await admin.waitForTimeout(250);
    assert.deepEqual([doc.products[0].upc, doc.products[0].targetPct, doc.products[0].shelfLifeDays, doc.products[0].ratePerMin], ['070852999001', 62.5, 14, undefined]);
    await admin.selectOption('#area', 'ut_prod_htst_1');
    await admin.waitForFunction(() => document.querySelectorAll('#rows tr').length > 100);
    // Group filter: only the products in that group.
    await admin.selectOption('#group', 'TEA');
    await admin.waitForFunction(() => { const g = [...document.querySelectorAll('#rows input[data-k="productGroup"]')]; return g.length > 5 && g.every(i => /TEA/i.test(i.value)); });
    await admin.selectOption('#group', '');
    await admin.fill('#find', 'jersey 2%');
    await admin.waitForFunction(() => document.querySelectorAll('#rows input[data-k="name"]').length >= 2 && [...document.querySelectorAll('#rows input[data-k="name"]')].every(i => /JERSEY 2%/i.test(i.value)));
    assert.match(await admin.textContent('#rows tr:first-child td.pm-check'), /Check SKU · also GV 2% Gallon/, 'a SKU on two products is marked to check');
    await fits(admin, 'Products 1920');
    await shots(admin, 'products', 1920);
    await admin.fill('#find', '');
    await admin.selectOption('#area', 'ut_prod_totes');
    await admin.waitForFunction(() => document.getElementById('form-title').textContent === 'TOTES Products');
    await admin.click('#rows tr:first-child [data-remove]');
    await admin.click('#rows tr:first-child [data-remove]');
    await admin.waitForFunction(() => /removed/.test(document.getElementById('foot').textContent) && /\(1\)$/.test(document.querySelector('#area option[value="ut_prod_totes"]').textContent));

    // Download Template (Joe 10/11): one workbook, a tab per plant, every column.
    const [dl] = await Promise.all([admin.waitForEvent('download'), admin.click('#template')]);
    assert.equal(dl.suggestedFilename(), 'Products-Template.xlsx');
    const book = await admin.evaluate((b64) => { const wb = window.XLSX.read(b64, { type: 'base64' }); return wb.SheetNames.map(n => [n, window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' })]); }, fs.readFileSync(await dl.path()).toString('base64'));
    assert.deepEqual(book.map(b => b[0]), ['Uniontown'], 'a tab for each plant the person sees');
    const tab = book[0][1];
    assert.deepEqual(tab[0], ['Area', 'Product', 'SKU', 'UPC', 'Type', 'Group', 'Full Speed Per Min', 'Target %', 'Lowest Speed', 'Highest Speed', 'Shelf Life Days']);
    assert.ok(tab.some(r => r[0] === 'TOTES' && r[1] === startOf('ut_prod_totes')[0].name), 'every area is in the template');
    assert.ok(tab.some(r => r.slice(0, 8).join('|') === 'GALLON FILLER|GV 2% Gallon|280305||Gallon|Milk|74|64.37'), 'RedZone speeds are in the template');
    // Upload: a changed TOTES list, a product in CASES, a new group; the preview shows it before anything is saved.
    const file = ['Plant,Area,Product,SKU,Type,Group', 'Uniontown,TOTES,"Tote, whole",401904,TOTE,Milk', 'Uniontown,CASES,UD 2% Gallon,305,Gallon,"Milk, Case"', 'Charleston,CASES,Not here,1,Gallon,Milk'].join('\r\n');
    const toteWas = (await db().collection('plantProducts').doc('ut_prod_totes').get()).data().products;
    await admin.setInputFiles('#upload-file', { name: 'uniontown.csv', mimeType: 'text/csv', buffer: Buffer.from(file) });
    await admin.waitForSelector('#preview-pane:not([hidden])');
    const stats = await admin.$$eval('#preview-stats div', d => d.map(x => x.textContent));
    assert.deepEqual(stats, ['2Added', '0Changed', String(toteWas.length) + 'Removed', '0Same']);
    assert.match(await admin.textContent('#preview-note'), /New groups: Case\. 1 row for other plants left out\./);
    assert.deepEqual((await db().collection('plantProducts').doc('ut_prod_totes').get()).data().products, toteWas, 'nothing saved before Save Upload');
    await fits(admin, 'Upload preview 1920');
    await shots(admin, 'products-upload', 1920);
    await admin.click('#preview-save');
    await admin.waitForFunction(() => document.getElementById('preview-pane').hidden && /2 products loaded in 2 areas/.test(document.getElementById('foot').textContent));
    assert.deepEqual((await db().collection('plantProducts').doc('ut_prod_totes').get()).data().products.map(p => p.name), ['Tote, whole']);
    assert.deepEqual((await db().collection('plantProducts').doc('fac_uniontown_area_cases').get()).data().products.map(p => p.name), ['UD 2% Gallon']);
    await admin.waitForFunction(() => [...document.querySelectorAll('#group option')].some(o => o.value === 'Case'));
    // A workbook in the old layout (no UPC or speed columns) changes the SKU and keeps the UPC, Target % and shelf life already saved.
    await db().collection('plantProducts').doc('ut_prod_totes').set({ operationId: 'ut_prod_totes', facilityId: 'fac_uniontown', products: [{ name: 'Tote, whole', sku: '401904', mfgType: 'TOTE', productGroup: 'Milk', upc: '070852401904', targetPct: 60, shelfLifeDays: 10 }] }, { merge: true });
    await admin.waitForFunction(() => /\(1\)$/.test(document.querySelector('#area option[value="ut_prod_totes"]').textContent));
    const oldBook = await admin.evaluate(() => { const X = window.XLSX, wb = X.utils.book_new(); X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Area', 'Product', 'SKU', 'Type', 'Group'], ['TOTES', 'Tote, whole', '401999', 'TOTE', 'Milk']]), 'Uniontown'); return X.write(wb, { type: 'base64', bookType: 'xlsx' }); });
    await admin.setInputFiles('#upload-file', { name: 'old-layout.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(oldBook, 'base64') });
    await admin.waitForSelector('#preview-pane:not([hidden])');
    assert.match(await admin.textContent('#preview-rows'), /SKU 401904 → 401999/);
    assert.doesNotMatch(await admin.textContent('#preview-rows'), /UPC|Target %|Shelf Life/, 'nothing about the kept fields changes');
    await admin.click('#preview-save');
    await admin.waitForFunction(() => document.getElementById('preview-pane').hidden);
    let tote = null;
    for (let i = 0; i < 40 && !((tote = (await db().collection('plantProducts').doc('ut_prod_totes').get()).data().products[0]) && tote.sku === '401999'); i++) await admin.waitForTimeout(250);
    assert.deepEqual([tote.sku, tote.upc, tote.targetPct, tote.shelfLifeDays], ['401999', '070852401904', 60, 10]);
    // Areas & Groups: add an area, and it is in the drop-down.
    await admin.click('#edit-setup');
    await admin.waitForSelector('#setup-pane:not([hidden])');
    await admin.click('#add-area');
    await admin.fill('#setup-areas input:last-of-type >> nth=-1', 'DOCK');
    await shots(admin, 'products-areas-groups', 1920);
    await admin.click('#setup-save');
    await admin.waitForFunction(() => [...document.querySelectorAll('#area option')].some(o => /^DOCK/.test(o.textContent)) && !document.getElementById('list-pane').hidden);
    // Get from RedZone before RedZone is connected says where to connect it, and changes nothing.
    await admin.click('#redzone');
    await admin.waitForFunction(() => /RedZone is not connected yet/.test(document.getElementById('foot').textContent) && !document.getElementById('list-pane').hidden);
    // Administration > Connections & Keys > RedZone: the token is saved and never shown back; only its last 4 characters.
    const rz = await openPage(browser, 1536, 760, '/redzone.html?testEmail=admin.test@uniteddairy.com');
    await rz.waitForFunction(() => /Not saved/.test(document.getElementById('state').textContent));
    await rz.fill('#f-address', 'https://api.redzone.example/v1');
    await rz.fill('#f-token', 'rz_browser_token_4321');
    await rz.click('#save');
    await rz.waitForFunction(() => /Saved/.test(document.getElementById('state').textContent) && /ends 4321/.test(document.getElementById('f-token').placeholder) && document.getElementById('f-token').value === '');
    assert.ok(!(await rz.content()).includes('rz_browser_token_4321'), 'the token is not on the page');
    await fits(rz, 'RedZone 1536');
    await shots(rz, 'redzone', 1536);
    assert.deepEqual(rz.errors, []);
    assert.deepEqual(admin.errors, []);
    for (const w of [1536]) {
      const narrow = await openPage(browser, w, 760, '/products.html?plant=fac_uniontown&line=ut_prod_gallon_filler&' + AS);
      await narrow.waitForFunction(() => document.getElementById('form-title').textContent === 'GALLON FILLER Products' && document.querySelectorAll('#rows tr').length > 10);
      await fits(narrow, 'Products ' + w);
      const tops = await narrow.$$eval('[data-top]', els => els.map(e => Math.round(e.getBoundingClientRect().bottom)));
      assert.ok(Math.max(...tops) - Math.min(...tops) <= 2, 'buttons and filters on one line at ' + w + ': ' + tops);
      const edge = await narrow.$$eval('[data-top]', els => Math.max(...els.map(e => e.getBoundingClientRect().right)) - document.documentElement.clientWidth);
      assert.ok(edge <= 0, 'the plant drop-down is not cut off at ' + w + ': ' + edge);
      await shots(narrow, 'products', w);
      assert.deepEqual(narrow.errors, []);
    }

    // Quality follows the changed list at once.
    await page.click('[data-line="ut_prod_totes"]');
    await page.waitForFunction(() => document.getElementById('form-title').textContent === 'TOTES Quality Check');
    assert.equal(await page.$$eval('select.prod-product option', o => o.length), 3, 'blank, the one tote product, Other');
    const phone = await openPage(browser, 412, 860, '/quality.html?line=ut_prod_gallon_filler&' + AS);
    await phone.waitForFunction(() => document.querySelector('select.prod-product'));
    if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, 'quality-product-phone-412.png'), scale: 'css' });
    assert.deepEqual(phone.errors, []);
    console.log('PRODUCTS Quality drop-down per machine, size follows, Other kept; Products by plant/area/group, template and upload, areas; Quality follows');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
