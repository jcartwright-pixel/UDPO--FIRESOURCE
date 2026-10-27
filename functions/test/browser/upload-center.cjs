'use strict';
/*
 * Joe 10/18: the Upload Center (Administration > Plant Setup), his pick B: one workbook for a new plant, each person filling
 * their own tabs; no trucks or trailers (the Fleet List has them). Download the workbook, fill it, upload it: every row is
 * New, Changed, Same, a Problem (red, with why) or Taken off, and nothing saves while any problem is left. A save fills that
 * plant's own screens (its own database), so nothing shows on Uniontown's screens; on the live app saving waits for Joe's OK.
 * Pictures at 1536 and 1920 go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear, plantDb } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const U = require('../../src/upload-rules');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;
const localCalls = require('./local-calls.cjs');
const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const AS = '?testEmail=admin.test@uniteddairy.com';

async function openPage(browser, width, height, url) {
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', acceptDownloads: true });
  await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, r.request().url().split('/').pop())) }));
  if (process.env.XLSX_LOCAL) await ctx.route(XLSX_URL, r => r.fulfill({ path: process.env.XLSX_LOCAL, contentType: 'application/javascript' }));
  await localCalls(ctx);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(HOSTING + url);
  return page;
}
const small = (p) => p.evaluate(() => [...document.querySelectorAll('body *')].filter(el => el.offsetWidth && el.offsetHeight && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < 15.9).map(el => el.tagName + ' "' + el.textContent.trim().slice(0, 30) + '"'));
const fits = (p) => p.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
// The real workbook (public/templates), read and filled in the page with the Excel reader, as a person would fill it.
async function filled(page, tabs) {
  const b64 = await page.evaluate(async (fill) => {
    const X = window.XLSX, wb = X.read(await (await fetch('templates/Plant-Setup-Workbook.xlsx')).arrayBuffer(), { type: 'array' });
    Object.keys(fill).forEach(name => {
      const ws = wb.Sheets[name];
      if (fill[name].head) X.utils.sheet_add_aoa(ws, [fill[name].head], { origin: 'A1' });
      X.utils.sheet_add_aoa(ws, fill[name].rows, { origin: 'A2' });
    });
    return X.write(wb, { type: 'base64', bookType: 'xlsx' });
  }, tabs);
  return Buffer.from(b64, 'base64');
}
async function upload(page, name, buffer) {
  await page.setInputFiles('#upload-file', { name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
  await page.waitForSelector('#check:not([hidden]) #tiles .up-tile');
}
const tiles = (p) => p.$$eval('#tiles .up-tile', t => t.map(x => x.innerText.replace(/\s+/g, ' ').trim()));

const ROUTES = [
  ['901', 'Load 1', 'MARTINS FERRY PRODUCT', 'Product', '', '', 'Boxing', 'United Dairy', '', 'Charleston', 'Load Day', 'No', 'No', '10', 'Yes', 'Yes', 'Yes', 'Yes', 'Yes', 'Active', ''],
  ['905', '1', 'KROGER', '', 'KROGER 1', '', 'Case Loadout', 'United Dairy', '', 'Charleston', 'Delivery Day', 'No', 'No', '20', 'Yes', 'Yes', 'Yes', 'Yes', '', 'Active', '']
];
const DAYS = [['905', 'Load 1', 'Mon', 'Yes', '3:30 AM', '4', '212', '10:30', 'Day before', ''], ['905', 'Load 1', 'Wed', 'Yes', '3:30 AM', '4', '212', '10.5', 'Day before', '']];
const DRIVERS = [
  ['00731', 'Sam Porter', 'Active', '304-555-0131', 'No', '6-1-12', '', ''],
  ['744', 'Jo Rivers', 'Active', '', 'Yes', '9/9/2020', '', ''],
  ['', 'No Id Yet', 'Active', '', '', '', '', '']
];
const WEEK = [['731', 'Off', '', 'Yes', '905 Load 1', 'Yes', '', 'Yes', '905 Load 2', 'Yes', '', 'Yes', '', 'Off', '']];

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  const uniontownDrivers = (await db().collection('drivers').get()).size, uniontownRoutes = (await db().collection('routes').get()).size;
  assert.ok(uniontownDrivers > 0 && uniontownRoutes > 0);
  const browser = await chromium.launch();
  try {
    for (const w of [1536, 1920]) {
      const h = w === 1536 ? 864 : 1080;
      // Administration > Plant Setup lists the Upload Center first.
      if (w === 1920) {
        const adm = await openPage(browser, w, h, '/administration.html' + AS + '&item=upload-center');
        await adm.waitForSelector('.adm-item.on[data-key="upload-center"]');
        assert.equal(await adm.$eval('.adm-item.on .adm-name', x => x.textContent), 'Upload Center');
        assert.equal(await adm.getAttribute('#frame', 'src'), 'uploads.html?testEmail=admin.test%40uniteddairy.com');
        if (SHOTS) await adm.screenshot({ path: path.join(SHOTS, 'after-administration-1920.png') });
        await adm.context().close();
      }
      await db().recursiveDelete(db().collection('plantUploads')); await db().recursiveDelete(db().collection('plantUploadLog'));
      const page = await openPage(browser, w, h, '/uploads.html' + AS);
      await page.waitForSelector('#plants button.on');
      // Only the plants not live yet: Charleston and Martins Ferry (Uniontown is already in the app).
      assert.deepEqual(await page.$$eval('#plants button', b => b.map(x => x.textContent)), ['Charleston', 'Martins Ferry']);
      assert.equal(await page.textContent('#book-name'), 'Charleston Setup Workbook');
      assert.equal(await page.getAttribute('#download', 'download'), 'Charleston Setup Workbook.xlsx');
      assert.equal(await page.$$eval('#tabs tr:not(.up-group)', r => r.length), U.SPEC.length);
      assert.deepEqual(await page.$$eval('#tabs tr.up-group', r => r.map(x => x.textContent)), ['Routes', 'Drivers', 'Plant', 'People and Email']);
      assert.match(await page.textContent('#where'), /Practice version: a save fills Charleston's own screens only, never Uniontown's/);
      // The workbook the page hands out is the Upload Center's own: every tab, every heading, no trucks or trailers.
      await page.evaluate(() => new Promise((ok, bad) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = ok; s.onerror = bad; document.head.appendChild(s); }));
      const book = await page.evaluate(async () => { const X = window.XLSX, wb = X.read(await (await fetch('templates/Plant-Setup-Workbook.xlsx')).arrayBuffer(), { type: 'array' });
        return wb.SheetNames.map(n => ({ name: n, head: (X.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' })[0] || []).map(String) })); });
      assert.deepEqual(book.map(b => b.name), ['How to fill'].concat(U.SPEC.map(t => t.tab)));
      U.SPEC.forEach((t, i) => assert.deepEqual(book[i + 1].head.slice(0, t.cols.length), t.cols.map(c => c.h + (c.req ? ' *' : '')), t.tab));
      assert.ok(!book.some(b => /TRUCK|TRAILER/i.test(b.name + b.head.join(' '))));
      assert.ok(await fits(page) <= 0, 'no side scroll at ' + w);
      assert.deepEqual(await small(page), []);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'after-upload-center-' + w + '.png') });

      // 1. A filled workbook with problems: a driver with no Employee ID and a regular route not on Routes. Save stays off.
      await upload(page, 'Charleston Setup.xlsx', await filled(page, { Routes: { rows: ROUTES }, 'Route Days': { rows: DAYS }, Drivers: { rows: DRIVERS }, 'Regular Week': { rows: WEEK } }));
      assert.equal(await page.textContent('#title'), 'Check Charleston Setup.xlsx before saving');
      assert.deepEqual(await tiles(page), ['2 Problem', '0 Changed', '6 New', '0 Taken off', '0 Same as now']);
      assert.equal(await page.isDisabled('#save'), true);
      assert.equal(await page.textContent('#save'), 'Fix 2 Problems First');
      const bad = await page.$$eval('#rows tr.bad', r => r.map(x => [...x.children].map(td => td.textContent)));
      assert.deepEqual(bad.map(r => [r[1], r[4]]), [['Drivers', 'Employee ID is blank'], ['Regular Week', 'Wed: route 905 Load 2 is not on the Routes tab']]);
      assert.equal(await page.isVisible('#plants'), false, 'no plant switch while a file is being checked');
      assert.ok(await fits(page) <= 0);
      assert.deepEqual(await small(page), []);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'after-check-problems-' + w + '.png') });
      // The server checks again: the same file is refused while it has problems.
      await assert.rejects(require('../../src/uploads').OPS.uploadSave(db(), 'admin.test@uniteddairy.com', { plant: 'fac_charleston', fileName: 'x.xlsx', sheets: [{ name: 'Drivers', cells: [U.BY_KEY.drivers.cols.map(c => c.h), DRIVERS[2]] }] }, new Date().toISOString(), {}), /Fix the 1 problem first/);
      await page.click('#cancel');
      await page.waitForSelector('#home:not([hidden])');

      // 2. Fixed: everything New, Save saves for Charleston only.
      const fixed = DRIVERS.slice(0, 2), week = [WEEK[0].map((c, i) => i === 8 ? '905 Load 1' : c)];
      await upload(page, 'Charleston Setup.xlsx', await filled(page, { Routes: { rows: ROUTES }, 'Route Days': { rows: DAYS }, Drivers: { rows: fixed }, 'Regular Week': { rows: week } }));
      assert.deepEqual(await tiles(page), ['0 Problem', '0 Changed', '7 New', '0 Taken off', '0 Same as now']);
      assert.equal(await page.textContent('#save'), 'Save 4 Tabs');
      await page.click('#save');
      await page.waitForFunction(() => !document.getElementById('saved').hidden);
      assert.equal(await page.textContent('#saved'), 'Charleston: 4 tabs saved (7 new, 0 changed, 0 the same, 0 taken off). Charleston\'s screens now show them.');
      const saved = (await db().collection('plantUploads').doc('fac_charleston__drivers').get()).data();
      assert.equal(saved.facilityId, 'fac_charleston');
      assert.deepEqual(saved.rows.map(r => [r.employeeId, r.name, r.phone, r.hired]), [['00731', 'Sam Porter', '3045550131', '2012-06-01'], ['744', 'Jo Rivers', '', '2020-09-09']]);
      assert.equal((await db().collection('plantUploads').doc('fac_charleston__routeDays').get()).data().rows[0].time, '03:30');
      // Kept apart: Uniontown's drivers and routes are exactly as they were.
      assert.equal((await db().collection('drivers').get()).size, uniontownDrivers);
      assert.equal((await db().collection('routes').get()).size, uniontownRoutes);
      // Charleston's own screens have them, in Charleston's own database.
      assert.deepEqual((await plantDb('fac_charleston').collection('drivers').get()).docs.map(d => d.data().name).sort(), ['Jo Rivers', 'Sam Porter']);
      assert.equal((await db().collection('plantUploadLog').where('facilityId', '==', 'fac_charleston').get()).size, 1);
      assert.match(await page.textContent('#tabs'), /Drivers\s*Dispatch\s*2/);

      // 3. Again with a changed phone and one driver left out: Changed (with what changed) and Taken off; Routes not in the file stay.
      await upload(page, 'Charleston drivers.xlsx', await filled(page, { Drivers: { rows: [['731', 'Sam Porter', 'Active', '304-555-0199', 'No', '6-1-12', '', '']] } }));
      assert.deepEqual(await tiles(page), ['0 Problem', '1 Changed', '0 New', '1 Taken off', '0 Same as now']);
      const chg = await page.$$eval('#rows tr', r => r.map(x => [...x.children].map(td => td.textContent)));
      assert.deepEqual(chg.map(r => [r[0], r[3], r[4]]), [['Changed', 'Sam Porter (731)', 'Employee ID 00731 731 · Cell Phone 3045550131 3045550199'], ['Taken off', 'Jo Rivers (744)', 'Not in the file: taken off the Drivers list']]);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'after-check-changes-' + w + '.png') });
      await page.click('#save');
      await page.waitForFunction(() => /1 tab saved/.test(document.getElementById('saved').textContent));
      assert.equal((await db().collection('plantUploads').doc('fac_charleston__routes').get()).data().count, 2);

      // 4. Never Social Security numbers, birth dates or addresses: such a tab is refused.
      await upload(page, 'with ssn.xlsx', await filled(page, { Drivers: { head: U.BY_KEY.drivers.cols.map(c => c.h).concat(['SSN']), rows: [['731', 'Sam Porter', 'Active', '', '', '', '', '', '123-45-6789']] } }));
      assert.match(await page.textContent('#rows'), /Take out the SSN column\. This app never keeps Social Security numbers/);
      assert.equal(await page.isDisabled('#save'), true);
      await page.click('#cancel');

      // 5. Martins Ferry is its own: nothing loaded there.
      await page.click('#plants button[data-plant="fac_martins_ferry"]');
      await page.waitForFunction(() => document.getElementById('book-name').textContent === 'Martins Ferry Setup Workbook');
      assert.equal(await page.$$eval('#tabs .up-pill', p => p.length), U.SPEC.length);
      await page.click('#plants button[data-plant="fac_charleston"]');
      await page.waitForFunction(() => document.getElementById('book-name').textContent === 'Charleston Setup Workbook');
      assert.deepEqual(page.errors, []);
      await page.context().close();
    }
    // The live app: saving waits for Joe's OK for the load (nothing here turns it on).
    const UP = require('../../src/uploads');
    const ok = { plant: 'fac_charleston', fileName: 'x.xlsx', sheets: [{ name: 'Drivers', cells: [U.BY_KEY.drivers.cols.map(c => c.h), ['9', 'A B', 'Active', '', '', '', '', '']] }] };
    await assert.rejects(UP.OPS.uploadSave(db(), 'admin.test@uniteddairy.com', ok, new Date().toISOString(), { project: 'ud-distribution' }), /waits for Joe's OK/);
    const st = await UP.OPS.uploadStatus(db(), 'admin.test@uniteddairy.com', { plant: 'fac_charleston' }, '', { project: 'ud-distribution' });
    assert.equal(st.live, true); assert.equal(st.savingOn, false);
    // Uniontown is never a target.
    await assert.rejects(UP.OPS.uploadSave(db(), 'admin.test@uniteddairy.com', Object.assign({}, ok, { plant: 'fac_uniontown' }), '', {}), /Pick Charleston or Martins Ferry/);
    // Only an Administrator reaches it.
    await assert.rejects(require('../../src/admin').adminCall(db(), { email: 'manager.test@uniteddairy.com', email_verified: true }, { op: 'uploadStatus' }, {}));
    console.log('upload-center: ok');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
