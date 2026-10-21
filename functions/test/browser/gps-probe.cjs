'use strict';
/*
 * Joe 10/20 ("try to ask for everything and see what it returns. No matter what."): GPS Setup's "Ask Verizon for everything"
 * box shows each answer Fleet sent, errors included, with the rows in a table that scrolls inside the box. Joe 10/21: every field
 * Verizon offers, searchable, and one table of every reading Verizon sent. The last answer is
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
  const fields = [{ table: 'Point-2.0', name: 'CargoAirTemp', type: 'Temperature', description: 'Air temperature inside the cargo container', reading: true },
    { table: 'Point-2.0', name: 'ReeferTemp', type: 'Temperature', description: 'Refrigeration Temperature', reading: true }]
    .concat(Array.from({ length: 1135 }, (x, i) => ({ table: i % 3 ? 'Point-2.0' : 'Unit-1.0', name: 'Field' + (i + 1), type: 'Number', description: i === 7 ? 'A long description that wraps onto more than one line so that every word of it can be read without anything being cut off at the edge' : '', reading: !!(i % 3) })));
  await db().collection('private').doc('gpsProbe').set({ at, by: 'admin.test@uniteddairy.com', tag: 'T-933', steps: [
    { label: 'Every field Verizon offers (search the list below)', ok: true, note: '1137 fields in all, 2 with temperature, refrigeration, reefer, cargo or sensor in the name or description (listed first).', fields },
    { label: 'Custom fields in the account with one of those words', ok: true, note: '14 custom fields in all; 1 with one of those words.', rows: [{ Id: '1', Name: 'Reefer Temp', Type: 'Number', IsGlobal: 'False' }] },
    { label: 'Unit T-933 as Fleet keeps it (all units asked, no unit list)', ok: true, note: '520 units; T-933 is one of them.', rows: [{ UnitId: '4410', Tag: 'T-933', LastReport: '2026-10-20 20:49:00', LastDiagnostic: '2026-10-20 20:49:00', EngineHours: '812', AssetType: 'Trailer', DeviceType: 'TrailerTracker' }] },
    { label: 'Unit T-933 asked with a unit list (to compare)', ok: false, note: 'Verizon Fleet answered 500 when running UDPO_ProbeUnitList (Verizon reference bb05c771-3dc1-4c32-93e0-e2a428e00000). { "errorInfo":[{ "errorCode":"5","errorText":"Internal server error."',
      error: 'Verizon Fleet answered 500 when running UDPO_ProbeUnitList (Verizon reference bb05c771-3dc1-4c32-93e0-e2a428e00000). { "errorInfo":[{ "errorCode":"5","errorText":"Internal server error.","errorParameters":[{ "parameter":"ExecutionId","value":"bb05c771-3dc1-4c32-93e0-e2a428e00000"}]}]}' },
    { label: 'GPS points for every unit, last 10 minutes (no unit list), plain', ok: true, note: '310 GPS points from 298 units; 1 from T-933.', rows: [{ UnitId: '4410', Time: '2026-10-20 20:45:00', Tag: 'T-933', Address: 'Route 8' }] },
    { label: 'Readings 1 to 40 of 760, every unit, last 15 minutes', ok: true, quiet: true, note: '412 GPS points; 6 of these 40 fields have a value.' },
    { label: 'Readings 41 to 80 of 760, every unit, last 15 minutes', ok: false, quiet: true, note: 'Verizon Fleet answered 500 when running UDPO_ProbeTemps (Verizon reference cc05c771-3dc1-4c32-93e0-e2a428e00000).' },
    { label: 'Every reading Verizon sent in the last 15 minutes (T-933\'s first)', ok: true, summary: true, note: '2 of 760 reading fields have a value from some unit; 1 from T-933. Not read (Verizon error): 40 fields.',
      rows: [{ Field: 'ReeferTemp', Description: 'Refrigeration Temperature', 'Latest from T-933': '1.4 C', At: '2026-10-20 20:45:00', 'Units sending it': '31' },
        { Field: 'Altitude', Description: 'Height above sea level', 'Latest from T-933': '', At: '', 'Units sending it': '290' }] }
  ] });

  const browser = await chromium.launch();
  try {
    for (const [w, h] of [[1536, 864], [1920, 1080], [1024, 768], [390, 844]]) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, serviceWorkers: 'block' });
      await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, r.request().url().split('/').pop())) }));
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(HOSTING + '/gps.html?testEmail=admin.test@uniteddairy.com');
      await page.waitForFunction(() => document.querySelectorAll('.gps-probe').length === 7, null, { timeout: 20000 });
      assert.deepEqual(errors, []);
      assert.equal(await page.$eval('#p-tag', i => i.value), '', 'the unit box starts blank');
      // The date the probe was asked, on the plant's clock (it is asked 3 minutes before the check runs, so it follows the calendar).
      const asked = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric', year: '2-digit' }).format(new Date(at)).replace(/\//g, '-');
      assert.match(await page.$eval('#probe-when', e => e.textContent), new RegExp('^Last asked ' + asked + ' .* for T-933 by admin\\.test@uniteddairy\\.com\\.$'));
      const steps = await page.$$eval('.gps-probe', a => a.map(x => [x.querySelector('.gps-mark').textContent, x.querySelector('b').textContent]));
      assert.deepEqual(steps.map(x => x[0]), ['✓', '✓', '✓', '✗', '✓', '✗', '✓'], 'a reading batch that came back fine is summed up in the last step, not shown on its own');
      assert.match(steps[5][1], /^Readings 41 to 80/);
      assert.match(await page.$eval('.gps-probe:nth-of-type(6) p', e => e.textContent), /Verizon reference cc05c771/);
      // Joe 10/21 ("can you ask for all 1,037 fields? ... Or can you show me the list"): every field, searchable, inside a box that scrolls.
      assert.equal(await page.$$eval('.gps-probe:nth-of-type(1) tr[data-find]', a => a.length), 1137);
      assert.equal(await page.$eval('#probe-found', e => e.textContent), '1137 fields');
      const box = await page.$eval('.gps-probe:nth-of-type(1) .gps-probe-rows', e => [e.clientHeight, e.scrollHeight]);
      assert.ok(box[0] <= 320 && box[1] > box[0], 'the list scrolls inside its box');
      await page.fill('#probe-find', 'refrigeration');
      assert.deepEqual(await page.$$eval('.gps-probe:nth-of-type(1) tr[data-find]:not([hidden]) td:nth-child(2)', a => a.map(x => x.textContent)), ['ReeferTemp']);
      assert.equal(await page.$eval('#probe-found', e => e.textContent), '1 of 1137 fields');
      await page.fill('#probe-find', 'cut off');
      const wrap = await page.$eval('.gps-probe:nth-of-type(1) tr[data-find]:not([hidden]) td.desc', e => [e.scrollWidth <= e.clientWidth + 1, e.getBoundingClientRect().height > 30]);
      assert.deepEqual(wrap, [true, true], 'a long description wraps instead of being cut off');
      await page.fill('#probe-find', 'refrigeration');
      assert.deepEqual(await page.$$eval('.gps-probe:nth-of-type(7) td:first-child', a => a.map(x => x.textContent)), ['ReeferTemp', 'Altitude']);
      assert.match(await page.$eval('.gps-probe:nth-of-type(4) pre', e => e.textContent), /"ExecutionId","value":"bb05c771-3dc1-4c32-93e0-e2a428e00000"/, 'the whole error, reference and all');
      assert.deepEqual(await page.$$eval('.gps-probe:nth-of-type(2) td', a => a.map(x => x.textContent)), ['1', 'Reefer Temp', 'Number', 'False']);
      const hdr = await page.$eval('.gps-probe:nth-of-type(1) th', e => getComputedStyle(e).position);
      assert.equal(hdr, 'sticky', 'the list keeps its headings in view');
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
