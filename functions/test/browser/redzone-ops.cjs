'use strict';
/*
 * Joe 10/16: "build everything complete". What RedZone has, read into Operations (Administration > RedZone > Read RedZone into
 * Operations; the emulator tests cover the reading itself), on the screens:
 *   - Administration > RedZone: how many of each came back, and RedZone's lines with their sensor names and the line of ours
 *     each goes with ("The Dairy Queen machines are my Raypak machines");
 *   - Line Targets: the line's RedZone line and sensor names ("You already have the sensors already labeled that goes to the
 *     blow mold"), its Line Stopped choices, what RedZone ran there, Fill Empty Speeds from RedZone, a different RedZone line;
 *   - the Blow Mold's temperature range is 1,000 to 1,350°F until Line Targets sets one;
 *   - the Line Tablet: Line Stopped shows RedZone's problem types for the line.
 * Pictures at 1536 (and the tablet at 1024) go to SHOTS_DIR.
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
const ADMIN = 'testEmail=admin.test@uniteddairy.com';
const BLOW = 'ut_prod_blow_mold';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, timezoneId: 'America/New_York' });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(HOSTING + url);
  return page;
}
async function shot(page, name, full) { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: !!full }); }
const small = (p, sel) => p.evaluate((s) => [...document.querySelectorAll(s + ' *')].filter(el => el.offsetWidth && el.offsetHeight && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < 15.9).map(el => el.tagName + ' "' + el.textContent.trim().slice(0, 30) + '"'), sel);
const fits = (p) => p.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
async function until(what, fn, ms) {
  const end = Date.now() + (ms || 15000);
  while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 250)); }
  throw new Error('Timed out: ' + what);
}

// RedZone's Uniontown lists as Joe's download showed them (10/16), cut down.
const RZ = {
  facilityId: 'fac_uniontown', at: '2026-10-16T04:40:00.000Z', by: 'admin.test@uniteddairy.com',
  locations: [{ uuid: 'loc-bm', name: 'Blow Mold', sensors: ['Default'] }, { uuid: 'loc-bx', name: 'Box Maker', sensors: ['Default'] }, { uuid: 'loc-dq', name: 'Dairy Queen', sensors: ['Default'] },
    { uuid: 'loc-dqm', name: 'Dairy Queen Manual', sensors: ['In=out', 'Box'] }, { uuid: 'loc-g', name: 'Gallon', sensors: ['Default'] }, { uuid: 'loc-h', name: 'Half Gallon', sensors: ['Default'] }],
  assets: [{ uuid: 'a1', name: 'Blow Molder', locationUUID: 'loc-bm', assetTypeUUID: 'at-blow', type: 'Depositer /Extruder' }, { uuid: 'a2', name: 'Changeover and Cleaning', locationUUID: 'loc-bm', assetTypeUUID: 'at-qm', type: 'Quality and Materials' },
    { uuid: 'a3', name: 'Bag Sealer', locationUUID: 'loc-dq', assetTypeUUID: 'at-bag', type: 'Bag Sealer' }],
  products: [{ uuid: 'p1', name: 'Gallon Jug', sku: '', ratePerMin: 50, target: 85, crew: 2 }, { uuid: 'p2', name: 'Broughton 2% Gallon', sku: '50305', ratePerMin: 74, target: 57, crew: 4 }],
  runs: [{ locationUUID: 'loc-bm', productTypeUUID: 'p1', startTime: '2026-10-15T10:39:24.036Z', endTime: '', plannedQuantity: 20000, ratePerMin: 50, crew: 2 },
    { locationUUID: 'loc-bm', productTypeUUID: 'p1', startTime: '2026-10-14T10:30:00.000Z', endTime: '2026-10-14T18:30:00.000Z', plannedQuantity: 18000, ratePerMin: 50, crew: 2 },
    { locationUUID: 'loc-g', productTypeUUID: 'p2', startTime: '2026-10-15T23:25:16.130Z', endTime: '', plannedQuantity: 6000, ratePerMin: 74, crew: 4 }],
  problems: [{ name: 'Blow mold is down', category: 'AVAILABILITY', assetTypeUUID: 'at-blow' }, { name: 'Bottle Jam', category: 'AVAILABILITY', assetTypeUUID: 'at-blow' },
    { name: 'Adjusting weights', category: 'AVAILABILITY', assetTypeUUID: 'at-qm' }, { name: 'Bag Not Sealing', category: 'AVAILABILITY', assetTypeUUID: 'at-bag' }, { name: 'No Orders', category: 'AVAILABILITY', assetTypeUUID: '' }],
  checkSheets: [{ name: 'OPS - Weight Sheet', type: 'QUALITY_CHECK', ours: 'Fill weight check on the Line Tablet, and Quality Checks package weight' }, { name: 'GMP Audit', type: 'AUDIT', ours: 'Manager Walkthrough' }],
  failed: []
};
const SYNC = { at: RZ.at, by: RZ.by, lines: 6, sensors: 7, machines: 3, products: 2, runs: 3, problems: 5, checkSheets: 2, failed: [],
  matches: [{ redzone: 'Blow Mold', sensors: ['Default'], line: 'BLOW MOLD' }, { redzone: 'Box Maker', sensors: ['Default'], line: '' }, { redzone: 'Dairy Queen', sensors: ['Default'], line: 'RAYPAK' },
    { redzone: 'Dairy Queen Manual', sensors: ['In=out', 'Box'], line: 'BOXING' }, { redzone: 'Gallon', sensors: ['Default'], line: 'GALLON FILLER' }, { redzone: 'Half Gallon', sensors: ['Default'], line: 'NEW 1/2 GALLON' }] };

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date() });
  await db().collection('redzoneData').doc('fac_uniontown').set(RZ);
  // The Blow Mold's one product, with no speed typed yet (its SKU on the Product Sheet is its name).
  await db().collection('plantProducts').doc(BLOW).set({ operationId: BLOW, line: 'BLOW MOLD', facilityId: 'fac_uniontown', products: [{ name: 'Gallon Jug', sku: 'Gallon Jug' }] });
  await db().collection('private').doc('redzone').set({ lastSync: SYNC });
  const results = [];
  const browser = await chromium.launch();
  try {
    // Administration > RedZone: Read RedZone into Operations, and RedZone's lines against ours.
    const rz = await openPage(browser, 1536, 960, '/redzone.html?' + ADMIN);
    await rz.waitForSelector('#sync-list tbody tr');
    assert.match(await rz.textContent('#sync-list'), /6 lines, 7 sensors, 3 machines, 2 products, 3 runs, 5 problem types, 2 check sheets\./);
    assert.deepEqual(await rz.$$eval('#sync-list tbody tr', r => r.map(x => [...x.children].map(c => c.textContent))).then(r => r.slice(2, 4)),
      [['Dairy Queen', 'Default', 'RAYPAK'], ['Dairy Queen Manual', 'In=out, Box', 'BOXING']]);
    assert.equal(await rz.textContent('#sync'), 'Read RedZone into Operations');
    assert.deepEqual(await small(rz, '#ops-card'), [], 'text 16px or larger');
    assert.ok(await fits(rz) <= 0, 'no sideways scrolling');
    await rz.$eval('#ops-card', e => e.scrollIntoView({ block: 'start' }));
    await shot(rz, 'rz-read-into-ops-1536');
    assert.deepEqual(rz.errors, []);
    await rz.close();
    results.push('Administration > RedZone: Read RedZone into Operations, 6 lines with their sensors; Dairy Queen goes with RAYPAK and Dairy Queen Manual with BOXING (the 5-gallon filler that feeds the box)');

    // Line Targets, the Blow Mold: RedZone's Blow Mold with its sensor, Line Stopped choices, what ran, Fill Empty Speeds.
    for (const w of [1536, 1920, 800]) {
      const lt = await openPage(browser, w, w === 800 ? 1200 : w === 1536 ? 960 : 1080, '/linetargets.html?line=' + BLOW + '&' + ADMIN);
      await lt.waitForFunction(() => /RedZone · Blow Mold/.test((document.getElementById('rz') || {}).textContent || ''));
      const box = await lt.textContent('#rz');
      assert.match(box, /Sensors: Default/);
      assert.match(box, /Machines: Blow Molder, Changeover and Cleaning/);
      assert.match(box, /Line Stopped choices on the Line Tablet: Blow mold is down, Bottle Jam, Adjusting weights, No Orders, Mold change, Resin feed, Leak tester down, Trimmer jam, Conveyor \/ bottle jam, Heater \/ temperature, Maintenance called, Other/);
      assert.doesNotMatch(box, /Bag Not Sealing/, 'the bag sealer\'s problems are the Dairy Queen\'s');
      assert.deepEqual(await lt.$$eval('#rz table', t => [...t[0].querySelectorAll('tbody tr')].map(x => [...x.children].map(c => c.textContent))), [['Gallon Jug', '', '50', '85', '2']]);
      assert.equal(await lt.$$eval('#rz table', t => t[1].querySelectorAll('tbody tr').length), 2, 'the latest runs');
      assert.equal(await lt.$eval('#rz-loc', s => s.options[s.selectedIndex].textContent), 'Match by name (Blow Mold)');
      assert.deepEqual(await small(lt, '#rz'), [], 'text 16px or larger at ' + w);
      assert.ok(await fits(lt) <= 0, 'no sideways scrolling at ' + w);
      if (w === 1536) {
        await lt.$eval('#rz', e => e.scrollIntoView({ block: 'start' }));
        await shot(lt, 'rz-line-targets-blow-mold-1536');
        await lt.click('#rz-fill');
        await lt.waitForFunction(() => /Filled from RedZone: Gallon Jug: full speed 50, Target % 85\./.test(document.getElementById('rz').textContent));
        await until('the Blow Mold\'s Gallon Jug speed saved', async () => {
          const d = (await db().collection('plantProducts').doc(BLOW).get()).data() || {};
          return (d.products || []).some(p => p.name === 'Gallon Jug' && Number(p.ratePerMin) === 50 && Number(p.targetPct) === 85);
        });
        await lt.waitForFunction(() => [...document.querySelectorAll('#rows input[data-k="ratePerMin"]')].some(i => i.value === '50'));
        await lt.evaluate(() => window.scrollTo(0, 0));
        await shot(lt, 'rz-line-targets-filled-1536');
        // A different RedZone line, and None.
        await lt.selectOption('#rz-loc', 'loc-dqm');
        await until('the RedZone line saved', async () => ((await db().collection('productionLines').doc(BLOW).get()).data() || {}).redzoneLocation === 'loc-dqm');
        await lt.waitForFunction(() => /RedZone · Dairy Queen Manual/.test(document.getElementById('rz').textContent) && /Sensors: In=out, Box/.test(document.getElementById('rz').textContent));
        await lt.selectOption('#rz-loc', '');
        await until('back to the match by name', async () => !((await db().collection('productionLines').doc(BLOW).get()).data() || {}).redzoneLocation);
        await lt.waitForFunction(() => /RedZone · Blow Mold/.test(document.getElementById('rz').textContent));
        // The Blow Mold's temperature range with Low and High empty (Joe 10/16).
        await lt.selectOption('#counter', 'CONTROLLER');
        await lt.waitForSelector('#controller:not([hidden])');
        assert.match(await lt.textContent('#controller'), /Temperature with Low and High empty: 1,000°F to 1,350°F/);
      }
      assert.deepEqual(lt.errors, []);
      await lt.close();
    }
    results.push('Line Targets (1536, 1920, 800): RedZone · Blow Mold, Sensors: Default, its machines, the Line Stopped choices from RedZone, Gallon Jug ran at 50 a minute; Fill Empty Speeds from RedZone saved 50 and 85%; another RedZone line can be picked; temperature 1,000 to 1,350°F when empty');

    // The Line Tablet: Line Stopped shows RedZone's problem types for the Blow Mold.
    const tb = await openPage(browser, 1024, 1180, '/line.html?line=' + BLOW + '&' + ADMIN);
    await tb.waitForFunction(() => document.getElementById('line-name').textContent === 'BLOW MOLD');
    await tb.click('#status-btn');
    await tb.waitForFunction(() => document.querySelector('#reasons button') && document.querySelector('#reasons button').textContent === 'Blow mold is down');
    assert.deepEqual(await tb.$$eval('#reasons button', b => b.map(x => x.textContent)), ['Blow mold is down', 'Bottle Jam', 'Adjusting weights', 'No Orders', 'Mold change', 'Resin feed', 'Leak tester down', 'Trimmer jam',
      'Conveyor / bottle jam', 'Heater / temperature', 'Maintenance called', 'Other'], 'RedZone\'s first, then ours while there is room');
    await tb.$eval('#reasons', e => e.scrollIntoView({ block: 'center' }));
    await shot(tb, 'rz-line-tablet-stopped-1024');
    await tb.click('#reasons button[data-reason="Bottle Jam"]');
    await tb.waitForFunction(() => document.querySelector('#reasons button.on') && document.querySelector('#reasons button.on').textContent === 'Bottle Jam');
    assert.deepEqual(tb.errors, []);
    await tb.close();
    results.push('Line Tablet: Line Stopped on the Blow Mold shows RedZone\'s Blow mold is down, Bottle Jam, Adjusting weights, No Orders first, then the Blow Mold\'s own while there is room, Maintenance called and Other; Bottle Jam is kept');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok - ' + r));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
