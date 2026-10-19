'use strict';
/*
 * Browser check of Joe's 10/18 ask ("I only want to see UD owned vehicles here ... only the Uniontown vehicles assigned is
 * what I'm responsible for. So no leased vehicles"): Fleet Service's Due list, its six cards, the "N of N" line, the footer
 * and the printed report count only United Dairy owned units at Uniontown. A tractor and a trailer the fleet list has as
 * leased, and a trailer it has at Martins Ferry, are left off (and stay in Equipment). At 1536 and 1920. SHOTS_DIR=<folder>
 * saves pictures; BEFORE=1 only takes the pictures (for the screen as it was).
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;
const BEFORE = !!process.env.BEFORE;
const EQ_HEADERS = ['equipment_id', 'equipment_type', 'unit_id', 'facility_id', 'location', 'status', 'assignment_class', 'source_present', 'last_source_sync_at', 'notes'];

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block' });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  await localCalls(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name) }); };
const rows = (p) => p.$$eval('#sheet tbody tr', trs => trs.map(t => t.querySelector('td').textContent.trim()));

(async () => {
  await clear();
  const equipment = F.EQUIPMENT.concat([
    { equipment_id: 'veh_truck_123885', equipment_type: 'TRUCK', unit_id: '123885', facility_id: 'fac_uniontown', location: 'Uniontown PA Branch', status: 'ACTIVE', source_present: 'TRUE' },
    { equipment_id: 'veh_trailer_t_10318', equipment_type: 'TRAILER', unit_id: 'T-10318', facility_id: 'fac_uniontown', location: 'Uniontown PA Branch', status: 'ACTIVE', source_present: 'TRUE' },
    { equipment_id: 'veh_truck_221810', equipment_type: 'TRUCK', unit_id: '221810', facility_id: 'fac_uniontown', location: 'Uniontown PA Branch', status: 'ACTIVE', source_present: 'TRUE' },
    { equipment_id: 'veh_trailer_t_10308', equipment_type: 'TRAILER', unit_id: 'T-10308', facility_id: 'fac_uniontown', location: '', status: 'ACTIVE', source_present: 'TRUE' },
    { equipment_id: 'veh_trailer_t_999', equipment_type: 'TRAILER', unit_id: 'T-999', facility_id: 'fac_uniontown', location: 'Martins Ferry OH Branch', status: 'ACTIVE', source_present: 'TRUE' }]);
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets({ "'EQUIPMENT_MASTER'": F.table(EQ_HEADERS, equipment) })), sources: F.SOURCES, now: () => new Date() });
  // The fleet list as the half-hourly read keeps it: the Idealease tractor and the First trailers are leased.
  await db().collection('config').doc('fleetOwnership').set({ ok: true, at: new Date().toISOString(), units: {
    '900001': { own: true, lease: 'OWN', facilityId: 'fac_uniontown' }, '900002': { own: true, lease: 'OWN', facilityId: 'fac_uniontown' },
    'T-901': { own: true, lease: 'OWN', facilityId: 'fac_uniontown' }, 'T-902': { own: true, lease: '', facilityId: 'fac_uniontown' },
    '123885': { own: false, lease: 'Idealease', facilityId: 'fac_uniontown' }, 'T-10318': { own: false, lease: 'First', facilityId: 'fac_uniontown' },
    '221810': { own: true, lease: '', facilityId: 'fac_uniontown' }, 'T-10308': { own: false, lease: 'First', facilityId: '' } } });
  // A job open on the leased tractor: the Garage still has it, the owned-units cards do not count it.
  await db().collection('workOrders').doc('wo-leased').set({ work_order_id: 'WO-LEASED1', unit: '123885', problem: 'Mirror cracked', status: 'NEW', created_at: new Date().toISOString() });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1536, 864], [1920, 1080]]) {
      const p = await openPage(browser, w, h, '/fleet.html?view=due&testEmail=manager.test@uniteddairy.com');
      await p.waitForFunction(() => /900001/.test(document.getElementById('sheet').textContent), null, { timeout: 15000 });
      await p.waitForTimeout(1200);
      if (BEFORE) { await shot(p, 'before-due-' + w + '.png'); await p.close(); continue; }
      assert.deepEqual(await rows(p), ['900001', '900002', 'T-901', 'T-902', 'T-999', 'T-10308', 'T-10318'], 'owned trucks and the Uniontown trailers (T-10308 is ours, Joe 10/19)');
      assert.match(await p.textContent('#sheet'), /7 of 7 units need something/);
      assert.match(await p.textContent('#foot'), /^7 trucks and trailers at Uniontown .*leased trucks are left off/);
      assert.match(await p.textContent('#kpis'), /0\s*At the garage/, 'the leased tractor\'s job is not counted');
      assert.ok(await p.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth + 1), 'no sideways scroll at ' + w);
      await shot(p, 'after-due-' + w + '.png');
      if (w === 1536) {
        // Searching a leased unit finds nothing here.
        await p.fill('#search', '123885');
        await p.waitForFunction(() => /No unit matches/.test(document.getElementById('sheet').textContent), null, { timeout: 5000 });
        await p.fill('#search', '');
        await p.evaluate(() => { window.print = () => {}; });
        await p.click('#fs-print');
        const report = await p.textContent('#print');
        assert.match(report, /7 trucks and trailers/);
        assert.match(report, /0 at the garage/);
        assert.doesNotMatch(report, /123885|221810/);
        // Work Orders still lists the leased tractor's job (only the Due screen is owned-only).
        await p.click('[role="tab"][data-view="work"]');
        await p.waitForFunction(() => /123885/.test(document.getElementById('sheet').textContent), null, { timeout: 15000 });
      }
      assert.deepEqual(p.errors, []);
      await p.close();
    }
    if (!BEFORE) {
      // Equipment still has every unit (nothing deleted).
      const units = (await db().collection('equipment').get()).docs.map(d => d.data().unit);
      ['123885', '221810', 'T-10308'].forEach(u => assert.ok(units.indexOf(u) >= 0, u + ' stays in Equipment'));
      results.push('Fleet Service Due: only owned Uniontown trucks and the Uniontown trailers (leased trailers too) in the list, the cards, the "N of N" line, the footer and the report, at 1536 and 1920');
      results.push('Leased units and units at another branch stay in Equipment, and their garage jobs stay on Work Orders');
    }
  } finally {
    await browser.close();
  }
  console.log(results.map(r => 'ok - ' + r).join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
