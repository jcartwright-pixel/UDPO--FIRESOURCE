'use strict';
/*
 * Browser check of the machine product drop-downs (Joe 10/10): Quality's Product is picked from the machine's own RedZone
 * products, blank to start, with the size following the product and "Other (type it)" for anything not listed; a product saved
 * before that is not on the list stays as its own choice. Administration > Product Sheet (Joe 10/11: plant, area and group drop-downs, Areas & Groups, template download and upload; Joe 10/12: rows for reading, the ⋮ opens an Edit panel with Type and Group drop-downs
 * with a preview) changes a machine's list and Quality follows. Joe 10/13: the Product Sheet is one list with a check for each
 * machine, Download Product List / Upload use that shape, and Machine Setup sets one machine's products. Pictures go to SHOTS_DIR.
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
    await page.waitForFunction(() => /Checked/.test(document.querySelector("[data-note=\"prod-product\"]").textContent));
    assert.equal(await page.inputValue('select.prod-size'), 'Gallon', 'the size follows the product');
    let saved = await lastQuality('ut_prod_gallon_filler');
    assert.deepEqual([saved.length, saved[0].payload.product, saved[0].payload.productSize], [1, 'GV 2% Gallon', 'Gallon']);
    await page.focus('select.prod-product'); // as a person does: the box is in use while it is picked
    await page.selectOption('select.prod-product', '__other__');
    await page.waitForSelector('.prod-other:not([hidden])');
    await page.fill('.prod-other', 'Test run eggnog');
    await page.click('#form-title');
    await page.waitForFunction(async () => /Checked/.test(document.querySelector('[data-note="prod-product"]').textContent));
    await page.waitForFunction(() => document.querySelector('select.prod-product') && document.querySelector('select.prod-product').value === 'Test run eggnog');
    for (let i = 0; i < 40 && (saved = await lastQuality('ut_prod_gallon_filler'))[0].payload.product !== 'Test run eggnog'; i++) await page.waitForTimeout(250);
    assert.equal(saved[0].payload.product, 'Test run eggnog', 'Other saves what was typed and shows as its own choice');
    await page.focus('select.prod-product'); // as a person does: the box is in use while it is picked
    await page.selectOption('select.prod-product', 'GV 2% Gallon');
    await page.waitForFunction(() => /Checked/.test(document.querySelector('[data-note="prod-product"]').textContent));
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

    // Joe 10/13 (mock-up A): the Product Sheet is one list of the plant's products, one line each, with a column for each machine
    // and a check where the product runs on it. (Before 10/13 it showed one area at a time from an area drop-down; that drop-down
    // is now the machine filter, and the Starting List button is gone: Joe did not need it.)
    const admin = await openPage(browser, 1920, 950, '/products.html?plant=fac_uniontown&' + AS);
    if (process.env.XLSX_LOCAL) await admin.route(XLSX_URL, r => r.fulfill({ path: process.env.XLSX_LOCAL, contentType: 'application/javascript' }));
    const MACHINES = ['ut_prod_boxing', 'ut_prod_totes', 'ut_prod_htst_1', 'ut_prod_gallon_filler', 'ut_prod_blow_mold'];
    const names = new Set();
    MACHINES.forEach(id => startOf(id).forEach(p => names.add(p.name.toUpperCase())));
    await admin.waitForFunction((n) => document.querySelectorAll('#rows tr[data-key]').length === n, names.size);
    const areaCount = (id) => admin.$eval('#area option[value="' + id + '"]', o => (/\((\d+)\)$/.exec(o.textContent) || [])[1]);
    const rowOf = (name) => '#rows tr[data-key="' + name.toUpperCase() + '"]';
    const checksOf = (name) => admin.$$eval(rowOf(name) + ' [data-ck].on', b => b.map(x => x.dataset.ck));
    const docOf = async (c, id) => ((await db().collection(c).doc(id).get()).data() || {});
    const waitDoc = async (c, id, ok) => { let d = null; for (let i = 0; i < 60 && !ok(d = await docOf(c, id)); i++) await admin.waitForTimeout(250); return d; };
    // Review item 31 (Joe 10/13): no plant drop-down inside a plant; the title names the plant.
    assert.equal(await admin.$('#plant'), null, 'no plant drop-down');
    assert.equal(await admin.$('#reset'), null, 'no Starting List button');
    assert.equal(await admin.textContent('#page-title'), 'Uniontown Product Sheet');
    assert.equal(await admin.textContent('#template'), 'Download Product List');
    assert.deepEqual(await admin.$$eval('#sheet thead tr:last-child th.pm-m', t => t.map(x => x.textContent)), ['BOXING', 'TOTES', 'HTST #1', 'GALLON FILLER', 'BLOW MOLD', 'CASES', 'TANKER'], 'a column for each machine, then the plant\'s own areas');
    assert.deepEqual(await admin.$$eval('#area option', o => o.map(x => x.textContent.replace(/ \(\d+\)$/, ''))), ['All machines', 'BOXING', 'TOTES', 'HTST #1', 'GALLON FILLER', 'BLOW MOLD', 'CASES', 'TANKER', 'No machine'], 'the area drop-down is now a machine filter');
    assert.deepEqual(await checksOf('GV 2% Gallon'), ['ut_prod_htst_1', 'ut_prod_gallon_filler'], 'one line for GV 2% Gallon, checked on the two machines it runs on');
    // Joe 10/12: "We have mix, milk, tea, juice": added to the plant's groups (TEA is Tea).
    assert.deepEqual(await admin.$$eval('#group option', o => o.map(x => x.textContent)), ['All groups', 'Milk', 'Drinks', 'TEA', 'Mix', 'Juice']);
    assert.ok(!(await admin.textContent('body')).includes('RedZone'), 'no RedZone name on the screen');
    // Review item 32: the Edit word button before the name, no ⋮ dots; the rows are for reading.
    assert.deepEqual(await admin.$$eval('#rows tr:first-child td:first-child .pm-editbtn', x => x.map(b => b.textContent)), ['Edit']);
    assert.ok(!(await admin.textContent('#rows')).includes('⋮'), 'no ⋮ dots');
    assert.equal(await admin.$$eval('#rows input, #rows select', x => x.length), 0, 'no boxes in the rows');
    const speedLines = await admin.$eval('#sheet thead th[title="Full speed per minute"]', th => { const r = document.createRange(); r.selectNodeContents(th); return new Set([...r.getClientRects()].map(x => Math.round(x.top))).size; });
    assert.ok(speedLines <= 2, 'Full Speed /Min is on two lines at most: ' + speedLines);
    const fontOf = (n) => admin.$eval('#rows ' + n, e => parseFloat(getComputedStyle(e).fontSize));
    assert.ok((await fontOf('.pm-name')) >= 16 && (await fontOf('td[data-k="sku"]')) >= 16, 'text is 16px');
    // The sheet slides sideways inside its box; the Product column stays put and the headings stay at the top.
    const slid = await admin.evaluate(() => { const sc = document.querySelector('.pm-sheet-scroll'); sc.scrollLeft = 600; sc.scrollTop = 400; const n = document.querySelector('#rows tr:nth-child(12) .pm-pin').getBoundingClientRect(), b = sc.getBoundingClientRect(), h = document.querySelector('#sheet thead tr:last-child th.pm-pin').getBoundingClientRect(); const out = { wide: sc.scrollWidth > sc.clientWidth, nameLeft: Math.round(n.left - b.left), headTop: Math.round(h.top - b.top) }; sc.scrollLeft = 0; sc.scrollTop = 0; return out; });
    assert.ok(slid.nameLeft <= 2 && slid.headTop <= 32, 'the product name and the headings stay put: ' + JSON.stringify(slid));
    await fits(admin, 'Product Sheet 1920');
    await shots(admin, 'products', 1920);

    // A check puts the product on that machine's list (with its speeds from its other machines); taking it off takes it off.
    await admin.click(rowOf('GV 2% Gallon') + ' [data-ck="ut_prod_boxing"]');
    let box = await waitDoc('plantProducts', 'ut_prod_boxing', d => d.products && d.products.some(p => p.name === 'GV 2% Gallon'));
    const gvBox = box.products.find(p => p.name === 'GV 2% Gallon'), gvFill = startOf('ut_prod_gallon_filler').find(p => p.name === 'GV 2% Gallon');
    assert.deepEqual([gvBox.sku, gvBox.ratePerMin, gvBox.targetPct], [gvFill.sku, gvFill.ratePerMin, gvFill.targetPct], 'the numbers come with it');
    assert.equal(box.products[box.products.length - 1].name, 'GV 2% Gallon', 'it goes on the end of the machine\'s list');
    // Audit batch 4 (Joe's rule: no save messages): the sheet says nothing once the check is saved.
    assert.doesNotMatch(await admin.textContent('#foot'), /Saved|Saving/);
    assert.deepEqual(await checksOf('GV 2% Gallon'), ['ut_prod_boxing', 'ut_prod_htst_1', 'ut_prod_gallon_filler']);
    // BLOW MOLD's one product (the jug runs on nothing else) taken off its only machine stays on the sheet, on no machine.
    const jug = startOf('ut_prod_blow_mold')[0].name;
    await admin.click(rowOf(jug) + ' [data-ck="ut_prod_blow_mold"]');
    const loose = await waitDoc('productSheet', 'fac_uniontown', d => d.products && d.products.some(p => p.name === jug));
    assert.equal(loose.products.length, 1);
    assert.deepEqual((await docOf('plantProducts', 'ut_prod_blow_mold')).products, [], 'BLOW MOLD\'s Quality drop-down has no products');
    await admin.selectOption('#area', '-');
    await admin.waitForFunction((t) => document.querySelectorAll('#rows tr[data-key]').length === 1 && document.querySelector('#rows .pm-name').textContent === t, jug);
    await admin.click(rowOf(jug) + ' [data-ck="ut_prod_blow_mold"]');
    await waitDoc('plantProducts', 'ut_prod_blow_mold', d => d.products && d.products.length === 1);
    assert.deepEqual((await waitDoc('productSheet', 'fac_uniontown', d => d.products && !d.products.length)).products, [], 'back on BLOW MOLD, it is no longer on no machine');
    assert.deepEqual((await docOf('plantProducts', 'ut_prod_blow_mold')).products[0], startOf('ut_prod_blow_mold')[0], 'it keeps everything while on no machine');
    await admin.selectOption('#area', '');

    // The Edit panel: the shared details (Type and Group drop-downs), a box for each machine, and each machine's own speeds.
    await admin.click(rowOf('GV 2% Gallon') + ' .pm-editbtn');
    await admin.waitForSelector('#edit-back:not([hidden])');
    assert.deepEqual(await admin.$$eval('#edit-fields [data-k]:not(.pm-other)', x => x.map(e => e.dataset.k + ':' + e.tagName)), ['name:INPUT', 'sku:INPUT', 'upc:INPUT', 'mfgType:SELECT', 'productGroup:SELECT', 'shelfLifeDays:INPUT', 'fillGrams:INPUT']);
    assert.deepEqual(await admin.$$eval('#edit-machines .pm-mbox.on', b => b.map(x => x.textContent)), ['✓BOXING', '✓HTST #1', '✓GALLON FILLER']);
    assert.deepEqual(await admin.$$eval('#edit-machines .pm-speeds tbody th', t => t.map(x => x.textContent)), ['BOXING', 'HTST #1', 'GALLON FILLER'], 'a speeds line for each machine it runs on');
    const types = await admin.$$eval('#edit-fields select[data-k="mfgType"] option', o => o.map(x => x.textContent));
    assert.ok(['Gallon', 'Half Gallon', '2.5 Gallon', '5 Gallon', 'TOTE', 'Other (type it)'].every(t => types.includes(t)), 'Type choices: ' + types);
    assert.deepEqual(await admin.$$eval('#edit-fields select[data-k="productGroup"] option', o => o.map(x => x.textContent)), ['', 'Milk', 'Drinks', 'TEA', 'Mix', 'Juice']);
    // Target % on BOXING only: the other machines keep theirs, and the sheet shows the spread in orange.
    await admin.fill('#edit-machines input[data-n="targetPct"][data-area="ut_prod_boxing"]', '60');
    await admin.click('#edit-title');
    box = await waitDoc('plantProducts', 'ut_prod_boxing', d => d.products.find(p => p.name === 'GV 2% Gallon').targetPct === 60);
    assert.equal(((await docOf('plantProducts', 'ut_prod_gallon_filler')).products || startOf('ut_prod_gallon_filler')).find(p => p.name === 'GV 2% Gallon').targetPct, gvFill.targetPct, 'GALLON FILLER keeps its Target % (still its starting list)');
    // A shared detail changes on every machine the product is on.
    await admin.fill('#edit-fields input[data-k="upc"]', '0 70852 99900 1');
    await admin.fill('#edit-fields input[data-k="shelfLifeDays"]', '14');
    await admin.click('#edit-title');
    await waitDoc('plantProducts', 'ut_prod_htst_1', d => (d.products || []).some(p => p.name === 'GV 2% Gallon' && p.shelfLifeDays === 14 && p.upc === '070852999001'));
    for (const id of ['ut_prod_boxing', 'ut_prod_gallon_filler']) assert.equal((await waitDoc('plantProducts', id, d => d.products.find(p => p.name === 'GV 2% Gallon').shelfLifeDays === 14)).products.find(p => p.name === 'GV 2% Gallon').upc, '070852999001');
    assert.doesNotMatch(await admin.textContent('#edit-note'), /Saved|Saving/, 'no save message in the Edit panel');
    await fits(admin, 'Edit panel 1920');
    await shots(admin, 'products-edit', 1920);
    // A machine box in the panel works like the check on the sheet.
    await admin.click('#edit-machines [data-eck="ut_prod_boxing"]');
    await waitDoc('plantProducts', 'ut_prod_boxing', d => !d.products.some(p => p.name === 'GV 2% Gallon'));
    await admin.waitForFunction(() => document.querySelectorAll('#edit-machines .pm-speeds tbody th').length === 2);
    await admin.click('#edit-machines [data-eck="ut_prod_boxing"]');
    await waitDoc('plantProducts', 'ut_prod_boxing', d => (d.products || []).some(p => p.name === 'GV 2% Gallon'));
    await admin.fill('#edit-machines input[data-n="targetPct"][data-area="ut_prod_boxing"]', '60');
    await admin.click('#edit-title');
    await waitDoc('plantProducts', 'ut_prod_boxing', d => d.products.find(p => p.name === 'GV 2% Gallon').targetPct === 60);
    await admin.keyboard.press('Escape');
    await admin.waitForSelector('#edit-back', { state: 'hidden' });
    await admin.waitForFunction((r) => { const t = document.querySelector(r + ' td[data-k="targetPct"]'); return t && t.classList.contains('pm-vary') && /^60 – 64\.37$/.test(t.textContent); }, rowOf('GV 2% Gallon'));
    // Add Product: saved once it has a name, on no machine; Done with no name adds nothing.
    await admin.click('#add');
    await admin.waitForSelector('#edit-back:not([hidden])');
    assert.equal(await admin.textContent('#edit-title'), 'New Product');
    await admin.click('#edit-close');
    await admin.waitForSelector('#edit-back', { state: 'hidden' });
    await admin.click('#add');
    await admin.waitForSelector('#edit-back:not([hidden])');
    await admin.fill('#edit-fields input[data-k="name"]', 'UD Whole Milk Tote');
    await admin.click('#edit-title');
    await waitDoc('productSheet', 'fac_uniontown', d => (d.products || []).some(p => p.name === 'UD Whole Milk Tote'));
    await admin.fill('#edit-fields input[data-k="sku"]', '999001');
    await admin.selectOption('#edit-fields select[data-k="mfgType"]', '__other__');
    await admin.fill('#edit-fields input.pm-other', 'Bag in Box');
    await admin.click('#edit-title');
    let added = (await waitDoc('productSheet', 'fac_uniontown', d => (d.products || []).some(p => p.name === 'UD Whole Milk Tote' && p.mfgType === 'Bag in Box' && p.sku === '999001'))).products;
    await admin.click('#edit-machines [data-eck="ut_prod_totes"]');
    await waitDoc('plantProducts', 'ut_prod_totes', d => (d.products || []).some(p => p.name === 'UD Whole Milk Tote'));
    await admin.click('#edit-close');
    await admin.waitForFunction(() => document.querySelector('#area option[value="ut_prod_totes"]').textContent === 'TOTES (2)');
    // Group filter, find, and a SKU on two products marked to check.
    await admin.selectOption('#group', 'TEA');
    await admin.waitForFunction(() => { const g = [...document.querySelectorAll('#rows td[data-k="productGroup"]')]; return g.length > 5 && g.every(i => /TEA/i.test(i.textContent)); });
    await admin.selectOption('#group', '');
    await admin.fill('#find', 'jersey 2%');
    await admin.waitForFunction(() => document.querySelectorAll('#rows .pm-name').length >= 2 && [...document.querySelectorAll('#rows .pm-name')].every(i => /JERSEY 2%/i.test(i.textContent)));
    assert.match(await admin.textContent('#rows tr:first-child td.pm-check'), /Check SKU · also GV 2% Gallon/, 'a SKU on two products is marked to check');
    await admin.fill('#find', '');
    // Remove (press twice) takes the product off every machine and the sheet.
    await admin.click(rowOf('UD Whole Milk Tote') + ' [data-remove]');
    await admin.click(rowOf('UD Whole Milk Tote') + ' [data-remove]');
    await waitDoc('plantProducts', 'ut_prod_totes', d => d.products.length === 1);
    // Audit batch 4 (Joe's rule: no save messages): the row going away is the answer.
    await admin.waitForFunction(() => !document.querySelector('#rows tr[data-key="UD WHOLE MILK TOTE"]'));

    // Download Product List (Joe 10/13): the whole list, a tab per plant, an X under each machine, then the numbers.
    const [dl] = await Promise.all([admin.waitForEvent('download'), admin.click('#template')]);
    assert.match(dl.suggestedFilename(), /^Uniontown-Product-List-\d{1,2}-\d{1,2}-\d\d\.xlsx$/);
    const readBook = (b64) => admin.evaluate((s) => { const wb = window.XLSX.read(s, { type: 'base64' }); return wb.SheetNames.map(n => [n, window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' })]); }, b64);
    const book = await readBook(fs.readFileSync(await dl.path()).toString('base64'));
    assert.deepEqual(book.map(b => b[0]), ['Uniontown'], 'a tab for each plant the person sees');
    const tab = book[0][1];
    assert.deepEqual(tab[0], ['Product', 'SKU', 'UPC', 'Type', 'Group', 'BOXING', 'TOTES', 'HTST #1', 'GALLON FILLER', 'BLOW MOLD', 'CASES', 'TANKER', 'Full Speed Per Min', 'Target %', 'Lowest Speed', 'Highest Speed', 'Shelf Life Days', 'Target Fill Weight g']);
    assert.equal(tab.length - 1, names.size, 'every product, one line each');
    const gvLine = tab.find(r => r[0] === 'GV 2% Gallon');
    assert.deepEqual(gvLine.slice(0, 14), ['GV 2% Gallon', '280305', '070852999001', 'Gallon', 'Milk', 'X', '', 'X', 'X', '', '', '', '74', '60'], 'an X under each machine; the first machine\'s numbers');
    // Upload the same file changed: GV off BOXING and on CASES, a SKU changed, a new product on no machine, one product left out.
    const gone = tab[1][0], skuRow = tab.find(r => r[0] === 'Jersey 2% Gallon');
    const changedBook = await admin.evaluate(({ rows, gone }) => {
      const X = window.XLSX, out = rows.filter(r => r[0] !== gone).map(r => r.slice());
      const gv = out.find(r => r[0] === 'GV 2% Gallon'); gv[5] = ''; gv[10] = 'x';
      out.find(r => r[0] === 'Jersey 2% Gallon')[1] = '280399';
      out.push(['Eggnog Quart', '777', '', 'Quart', 'Seasonal', '', '', '', '', '', '', '', '', '', '', '', '21']);
      const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(out), 'Uniontown');
      return X.write(wb, { type: 'base64', bookType: 'xlsx' });
    }, { rows: tab, gone });
    const wasBoxing = (await docOf('plantProducts', 'ut_prod_boxing')).products;
    await admin.setInputFiles('#upload-file', { name: 'product-list.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(changedBook, 'base64') });
    await admin.waitForSelector('#preview-pane:not([hidden])');
    assert.deepEqual(await admin.$$eval('#preview-stats div', d => d.map(x => x.textContent)), ['1Added', '2Changed', '1Removed', String(names.size - 3) + 'Same']);
    const prev = await admin.textContent('#preview-rows');
    assert.match(prev, /On CASES · Off BOXING/);
    assert.match(prev, /SKU 280305 → 280399/);
    assert.equal(skuRow[1], '280305');
    assert.deepEqual((await docOf('plantProducts', 'ut_prod_boxing')).products, wasBoxing, 'nothing saved before Save Upload');
    await fits(admin, 'Upload preview 1920');
    await shots(admin, 'products-upload', 1920);
    await admin.click('#preview-save');
    await admin.waitForFunction(() => document.getElementById('preview-pane').hidden && /Upload saved/.test(document.getElementById('foot').textContent));
    assert.ok(!(await docOf('plantProducts', 'ut_prod_boxing')).products.some(p => p.name === 'GV 2% Gallon'));
    assert.deepEqual((await docOf('plantProducts', 'fac_uniontown_area_cases')).products.map(p => [p.name, p.targetPct]), [['GV 2% Gallon', 60]], 'on CASES with the Target % in the file');
    assert.equal((await docOf('plantProducts', 'ut_prod_htst_1')).products.find(p => p.name === 'Jersey 2% Gallon').sku, '280399');
    assert.deepEqual((await docOf('productSheet', 'fac_uniontown')).products.map(p => [p.name, p.shelfLifeDays]), [['Eggnog Quart', 21]]);
    for (const id of MACHINES) assert.ok(!((await docOf('plantProducts', id)).products || []).some(p => p.name === gone), gone + ' is off ' + id);
    await admin.waitForFunction(() => [...document.querySelectorAll('#group option')].some(o => o.value === 'Seasonal'));
    assert.equal((await docOf('plantProducts', 'ut_prod_htst_1')).products.find(p => p.name === 'GV 2% Gallon').targetPct, gvFill.targetPct, 'a number the same as downloaded keeps each machine\'s own');

    // A file in the layout before 10/13 (a line per product per area) still loads: a changed TOTES list, a product in CASES, a new group.
    const file = ['Plant,Area,Product,SKU,Type,Group', 'Uniontown,TOTES,"Tote, whole",401904,TOTE,Milk', 'Uniontown,CASES,UD 2% Gallon,305,Gallon,"Milk, Case"', 'Charleston,CASES,Not here,1,Gallon,Milk'].join('\r\n');
    const toteWas = (await docOf('plantProducts', 'ut_prod_totes')).products;
    await admin.setInputFiles('#upload-file', { name: 'uniontown.csv', mimeType: 'text/csv', buffer: Buffer.from(file) });
    await admin.waitForSelector('#preview-pane:not([hidden])');
    assert.deepEqual(await admin.$$eval('#preview-stats div', d => d.map(x => x.textContent)), ['2Added', '0Changed', String(toteWas.length + 1) + 'Removed', '0Same']);
    assert.match(await admin.textContent('#preview-note'), /New groups: Case\. 1 row for other plants left out\./);
    await admin.click('#preview-save');
    await admin.waitForFunction(() => document.getElementById('preview-pane').hidden && /2 products loaded in 2 areas/.test(document.getElementById('foot').textContent));
    assert.deepEqual((await docOf('plantProducts', 'ut_prod_totes')).products.map(p => p.name), ['Tote, whole']);
    assert.deepEqual((await docOf('plantProducts', 'fac_uniontown_area_cases')).products.map(p => p.name), ['UD 2% Gallon']);
    await admin.waitForFunction(() => [...document.querySelectorAll('#group option')].some(o => o.value === 'Case'));
    // An old-layout workbook with no UPC or speed columns changes the SKU and keeps the UPC, Target % and shelf life already saved.
    await db().collection('plantProducts').doc('ut_prod_totes').set({ operationId: 'ut_prod_totes', facilityId: 'fac_uniontown', products: [{ name: 'Tote, whole', sku: '401904', mfgType: 'TOTE', productGroup: 'Milk', upc: '070852401904', targetPct: 60, shelfLifeDays: 10 }] }, { merge: true });
    await admin.waitForFunction(() => /\(1\)$/.test(document.querySelector('#area option[value="ut_prod_totes"]').textContent) && document.querySelector('#rows tr[data-key="TOTE, WHOLE"] td[data-k="upc"]').textContent === '070852401904');
    const oldBook = await admin.evaluate(() => { const X = window.XLSX, wb = X.utils.book_new(); X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Area', 'Product', 'SKU', 'Type', 'Group'], ['TOTES', 'Tote, whole', '401999', 'TOTE', 'Milk']]), 'Uniontown'); return X.write(wb, { type: 'base64', bookType: 'xlsx' }); });
    await admin.setInputFiles('#upload-file', { name: 'old-layout.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(oldBook, 'base64') });
    await admin.waitForSelector('#preview-pane:not([hidden])');
    assert.match(await admin.textContent('#preview-rows'), /SKU 401904 → 401999/);
    assert.doesNotMatch(await admin.textContent('#preview-rows'), /UPC|Target %|Shelf Life/, 'nothing about the kept fields changes');
    await admin.click('#preview-save');
    await admin.waitForFunction(() => document.getElementById('preview-pane').hidden);
    const kept = (await waitDoc('plantProducts', 'ut_prod_totes', d => d.products && d.products[0].sku === '401999')).products[0];
    assert.deepEqual([kept.sku, kept.upc, kept.targetPct, kept.shelfLifeDays], ['401999', '070852401904', 60, 10]);
    // Areas & Groups: an added area is a new column and a choice in the machine filter.
    await admin.click('#edit-setup');
    await admin.waitForSelector('#setup-pane:not([hidden])');
    await admin.click('#add-area');
    await admin.fill('#setup-areas input:last-of-type >> nth=-1', 'DOCK');
    await shots(admin, 'products-areas-groups', 1920);
    // Batch 5: no Save Areas & Groups button; the box saves when it is left, and Close goes back to the list.
    assert.equal(await admin.$('#setup-save'), null, 'no Save Areas & Groups button');
    await admin.press('#setup-areas input:last-of-type >> nth=-1', 'Tab');
    await admin.waitForFunction(() => [...document.querySelectorAll('#area option')].some(o => /^DOCK/.test(o.textContent)));
    await admin.click('#setup-close');
    await admin.waitForFunction(() => [...document.querySelectorAll('#area option')].some(o => /^DOCK/.test(o.textContent)) && !document.getElementById('list-pane').hidden && [...document.querySelectorAll('#sheet th.pm-m')].some(t => t.textContent === 'DOCK'));
    assert.deepEqual(admin.errors, []);
    for (const w of [1536]) {
      const narrow = await openPage(browser, w, 760, '/products.html?plant=fac_uniontown&' + AS);
      await narrow.waitForFunction(() => document.querySelectorAll('#rows tr').length > 10 && document.querySelector('#rows .pm-editbtn'));
      await fits(narrow, 'Product Sheet ' + w);
      const tops = await narrow.$$eval('[data-top]', els => els.map(e => Math.round(e.getBoundingClientRect().bottom)));
      assert.ok(Math.max(...tops) - Math.min(...tops) <= 2, 'buttons and filters on one line at ' + w + ': ' + tops);
      const edge = await narrow.$$eval('[data-top]', els => Math.max(...els.map(e => e.getBoundingClientRect().right)) - document.documentElement.clientWidth);
      assert.ok(edge <= 0, 'the last filter is not cut off at ' + w + ': ' + edge);
      await shots(narrow, 'products', w);
      if (SHOTS) { await narrow.evaluate(() => { document.querySelector('.pm-sheet-scroll').scrollLeft = 700; }); await narrow.screenshot({ path: path.join(SHOTS, 'products-slid-sideways-' + w + '.png'), scale: 'css' }); await narrow.evaluate(() => { document.querySelector('.pm-sheet-scroll').scrollLeft = 0; }); }
      // The Edit panel fits Joe's screen too (a product on three machines).
      await narrow.click(rowOf('GV 2% Gallon') + ' .pm-editbtn');
      await narrow.waitForSelector('#edit-back:not([hidden])');
      const pane = await narrow.$eval('#edit-pane', e => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, scroll: e.scrollHeight - e.clientHeight }; });
      assert.ok(pane.top >= 0 && pane.bottom <= 760 && pane.scroll <= 0, 'the Edit panel fits with no scrolling at ' + w + ': ' + JSON.stringify(pane));
      await shots(narrow, 'products-edit', w);
      await narrow.click('#edit-close');
      assert.deepEqual(narrow.errors, []);
    }

    // Machine Setup (Joe 10/13, mock-up MB): pick a machine; its products on the left, the rest on the right; the same lists as the Product Sheet's checks.
    for (const w of [1920, 1536]) {
      const ms = await openPage(browser, w, w === 1920 ? 950 : 760, '/machine-setup.html?plant=fac_uniontown&line=ut_prod_gallon_filler&' + AS);
      await ms.waitForFunction(() => document.getElementById('form-title').textContent === 'GALLON FILLER Products' && document.querySelectorAll('#rows tr[data-drag]').length > 10);
      assert.equal(await ms.textContent('#page-title'), 'Uniontown Machine Setup');
      assert.deepEqual(await ms.$$eval('#machines .ms-mach', b => b.map(x => x.dataset.line)), ['ut_prod_boxing', 'ut_prod_totes', 'ut_prod_htst_1', 'ut_prod_gallon_filler', 'ut_prod_blow_mold', 'fac_uniontown_area_cases', 'fac_uniontown_area_tanker', 'fac_uniontown_area_dock']);
      await fits(ms, 'Machine Setup ' + w);
      const sides = await ms.$$eval('.ms-side', e => e.map(x => { const r = x.getBoundingClientRect(); return [r.left, r.right, r.width]; }));
      assert.ok(sides.length === 2 && sides[0][1] <= sides[1][0] && sides[1][2] > 300, 'the two lists sit side by side at ' + w + ': ' + JSON.stringify(sides));
      await shots(ms, 'machine-setup', w);
      assert.deepEqual(ms.errors, []);
      if (w !== 1920) { await ms.close(); continue; }
      // ← Add (mock-up MB): the right list is the plant's products not on the machine; Add puts one on the end of the left list.
      await ms.click('#machines [data-line="ut_prod_boxing"]');
      await ms.waitForFunction(() => document.getElementById('form-title').textContent === 'BOXING Products');
      const before = (await docOf('plantProducts', 'ut_prod_boxing')).products.map(p => p.name);
      const offNames = await ms.$$eval('#offrows .pm-namecell', n => n.map(x => x.textContent));
      assert.ok(offNames.length && !offNames.some(n => before.includes(n)), 'only products not on BOXING are on the right');
      assert.equal(await ms.textContent('#on-title'), 'On BOXING (' + before.length + ')');
      await ms.fill('#find', 'eggnog');
      await ms.click('#offrows [data-add="EGGNOG QUART"]');
      await waitDoc('plantProducts', 'ut_prod_boxing', d => d.products.length === before.length + 1);
      await ms.fill('#find', 'gv 2%');
      await ms.click('#offrows [data-add="GV 2% GALLON"]');
      await ms.fill('#find', '');
      const after = (await waitDoc('plantProducts', 'ut_prod_boxing', d => d.products.length === before.length + 2)).products;
      assert.deepEqual(after.slice(-2).map(p => p.name), ['Eggnog Quart', 'GV 2% Gallon']);
      assert.deepEqual((await waitDoc('productSheet', 'fac_uniontown', d => !d.products.length)).products, [], 'Eggnog Quart is no longer on no machine');
      // Drag (here with Alt and the up arrow) sets the order of the machine's Quality Check drop-down.
      await ms.waitForFunction(() => document.querySelector('#rows tr:last-child').dataset.drag === 'GV 2% GALLON');
      await ms.focus('#rows tr:last-child');
      await ms.keyboard.press('Alt+ArrowUp');
      await waitDoc('plantProducts', 'ut_prod_boxing', d => d.products.slice(-2).map(p => p.name).join('|') === 'GV 2% Gallon|Eggnog Quart');
      await shots(ms, 'machine-setup-add', 1920);
      // Take off moves it to the right: off this machine only; off its last machine it stays on the Product Sheet.
      await ms.click('#rows tr[data-drag="EGGNOG QUART"] [data-remove]');
      await waitDoc('plantProducts', 'ut_prod_boxing', d => !d.products.some(p => p.name === 'Eggnog Quart'));
      await ms.waitForSelector('#offrows [data-add="EGGNOG QUART"]');
      assert.deepEqual((await waitDoc('productSheet', 'fac_uniontown', d => d.products.length === 1)).products.map(p => p.name), ['Eggnog Quart']);
      // The Product Sheet shows the same checks.
      await admin.waitForFunction(() => document.querySelector('#rows tr[data-key="GV 2% GALLON"] [data-ck="ut_prod_boxing"].on') && !document.querySelector('#rows tr[data-key="EGGNOG QUART"] [data-ck].on'));
      assert.deepEqual(ms.errors, []);
      await ms.close();
    }
    // Joe 10/13: a file with only some machine columns (his HTST list) sets just those machines. A product it leaves out comes off
    // them but stays on the sheet while another machine still runs it (Changed, Off HTST #1), not Removed.
    const htstBook = await admin.evaluate(() => { const X = window.XLSX, wb = X.utils.book_new(); X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Product', 'SKU', 'HTST #1'], ['1% MILK PASTEURIZED', '997520', 'X']]), 'Uniontown'); return X.write(wb, { type: 'base64', bookType: 'xlsx' }); });
    await admin.setInputFiles('#upload-file', { name: 'htst.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(htstBook, 'base64') });
    await admin.waitForSelector('#preview-pane:not([hidden])');
    const gvRow = await admin.$$eval('#preview-rows tr', (trs) => { const tr = trs.find(t => t.children[1] && t.children[1].textContent === 'GV 2% Gallon'); return tr ? [tr.className, tr.lastElementChild.textContent] : null; });
    assert.deepEqual(gvRow, ['pm-change', 'ChangedOff HTST #1'], 'GV 2% Gallon still runs on other machines, so it only comes off HTST #1');
    assert.equal((await admin.$$eval('#preview-stats div', d => d.map(x => x.textContent)))[0], '1Added');
    await admin.click('#preview-save');
    await waitDoc('plantProducts', 'ut_prod_htst_1', d => d.products.map(p => p.name).join('|') === '1% MILK PASTEURIZED');
    await admin.waitForFunction(() => document.querySelector('#rows tr[data-key="GV 2% GALLON"] [data-ck="ut_prod_gallon_filler"].on') && !document.querySelector('#rows tr[data-key="GV 2% GALLON"] [data-ck="ut_prod_htst_1"].on'));
    // Quality follows the changed list at once.
    await page.click('[data-line="ut_prod_totes"]');
    await page.waitForFunction(() => document.getElementById('form-title').textContent === 'TOTES Quality Check');
    assert.equal(await page.$$eval('select.prod-product option', o => o.length), 3, 'blank, the one tote product, Other');
    const phone = await openPage(browser, 412, 860, '/quality.html?line=ut_prod_gallon_filler&' + AS);
    await phone.waitForFunction(() => document.querySelector('select.prod-product'));
    if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, 'quality-product-phone-412.png'), scale: 'css' });
    assert.deepEqual(phone.errors, []);
    console.log('PRODUCTS Quality drop-down per machine, size follows, Other kept; Product Sheet with machine checks, Edit panel per machine, Product List download and upload (old layout too), Machine Setup; Quality follows');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
