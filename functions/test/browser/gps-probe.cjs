'use strict';
/*
 * Joe 10/20 ("try to ask for everything and see what it returns. No matter what."): GPS Setup's "Ask Verizon for everything"
 * box shows each answer Fleet sent, errors included, with the rows in a table that scrolls inside the box. The last answer is
 * still there after the page is opened again. At 1536 and 1920, and on phones and tablets. With SHOTS_DIR=<folder> it saves
 * pictures.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES });
  const at = new Date(Date.now() - 3 * 60000).toISOString();
  await db().collection('private').doc('gpsProbe').set({ at, by: 'admin.test@uniteddairy.com', tag: 'T-933', steps: [
    { label: 'Fields Fleet has for GPS points and units, with temperature, reefer, cargo or sensor in the name', ok: true, note: '612 fields in all; 214 for GPS points and units; 2 with one of those words; 1 custom unit fields.',
      rows: [{ TableId: 'Point-2.0', Name: 'CargoAirTemp', Description: 'Air temperature inside the cargo container', DataType: 'Temperature', IsDiagnostic: 'True', IsReadable: 'True' },
        { TableId: 'Unit-1.0', Name: 'Custom.ReeferTemp', Description: '', DataType: 'Text', IsDiagnostic: 'False', IsReadable: 'True' }] },
    { label: 'Custom fields in the account with one of those words', ok: true, note: '14 custom fields in all; 1 with one of those words.', rows: [{ Id: '1', Name: 'Reefer Temp', Type: 'Number', IsGlobal: 'False' }] },
    { label: 'Unit T-933 as Fleet keeps it', ok: true, note: 'Fleet answered.', rows: [{ UnitId: '4410', Tag: 'T-933', DeviceType: 'TrailerTracker', AssetType: 'Trailer', LastReport: '2026-10-20 20:49:00', LastDiagnostic: '2026-10-20 20:49:00', EngineHours: '812', Notes: '', F_Custom_ReeferTemp: '34' }] },
    { label: 'GPS points for T-933, last 6 hours, plain', ok: false, note: 'Verizon Fleet answered 500 when running UDPO_ProbePoints (Verizon reference bb05c771-3dc1-4c32-93e0-e2a428e00000). { "errorInfo":[{ "errorCode":"5","errorText":"Internal server error."',
      error: 'Verizon Fleet answered 500 when running UDPO_ProbePoints (Verizon reference bb05c771-3dc1-4c32-93e0-e2a428e00000). { "errorInfo":[{ "errorCode":"5","errorText":"Internal server error.","errorParameters":[{ "parameter":"ExecutionId","value":"bb05c771-3dc1-4c32-93e0-e2a428e00000"}]}]}' },
    { label: 'GPS points for T-933 with every temperature field: CargoAirTemp', ok: true, note: '24 GPS points; 1 with a value in one of these fields.', rows: [{ UnitId: '4410', Time: '2026-10-20 20:45:00', F_CargoAirTemp: '1.4' }] }
  ] });

  const browser = await chromium.launch();
  try {
    for (const [w, h] of [[1536, 864], [1920, 1080], [1024, 768], [390, 844]]) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, serviceWorkers: 'block' });
      await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, r.request().url().split('/').pop())) }));
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(HOSTING + '/gps.html?testEmail=admin.test@uniteddairy.com');
      await page.waitForFunction(() => document.querySelectorAll('.gps-probe').length === 5, null, { timeout: 20000 });
      assert.deepEqual(errors, []);
      assert.equal(await page.$eval('#p-tag', i => i.value), '', 'the unit box starts blank');
      assert.match(await page.$eval('#probe-when', e => e.textContent), /^Last asked 10-20-26 .* for T-933 by admin\.test@uniteddairy\.com\.$/);
      const steps = await page.$$eval('.gps-probe', a => a.map(x => [x.querySelector('.gps-mark').textContent, x.querySelector('b').textContent]));
      assert.deepEqual(steps.map(x => x[0]), ['✓', '✓', '✓', '✗', '✓']);
      assert.match(await page.$eval('.gps-probe:nth-of-type(4) pre', e => e.textContent), /"ExecutionId","value":"bb05c771-3dc1-4c32-93e0-e2a428e00000"/, 'the whole error, reference and all');
      assert.deepEqual(await page.$$eval('.gps-probe:nth-of-type(2) td', a => a.map(x => x.textContent)), ['1', 'Reefer Temp', 'Number', 'False']);
      const small = await page.$$eval('.gps-probe *', a => a.filter(x => x.childElementCount === 0 && x.textContent.trim() && parseFloat(getComputedStyle(x).fontSize) < 16).length);
      assert.equal(small, 0, 'text at least 16px');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'no sideways page scroll at ' + w);
      if (SHOTS) {
        await page.$eval('#probe-out', e => e.closest('section').scrollIntoView());
        await page.screenshot({ path: path.join(SHOTS, 'gps-ask-verizon-' + w + '.png') });
      }
      // Pressing with no unit says what to type, and asks nothing.
      await page.click('#probe');
      await page.waitForFunction(() => /Type a Fleet unit first/.test(document.getElementById('error').textContent));
      await page.close();
    }
  } finally { await browser.close(); }
  console.log('ok - GPS Setup: Ask Verizon for everything shows every answer as Fleet sent it, errors in full, at every width');
})().catch(e => { console.error(e); process.exit(1); });
