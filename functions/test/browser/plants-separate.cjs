'use strict';
/*
 * Browser check (Joe 10/26: "All three locations have completely separate... technically, no shared information in between
 * plants"): each plant's screens read and save in that plant's own database. On Daily Dispatch at 1536 and 1920 wide:
 * Uniontown shows its own loads under a yellow UNIONTOWN in the header; Charleston (?plant=fac_charleston, an Administrator)
 * shows only Charleston's load under CHARLESTON, and a change there is saved in Charleston's database, not Uniontown's;
 * a person who has only Uniontown cannot open Charleston (the link keeps them on Uniontown). Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { clear, db, plantDb } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;
const DATE = '2026-10-05', CH = 'fac_charleston';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block' });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const until = async (what, fn, ms) => {
  const end = Date.now() + (ms || 30000);
  for (;;) { if (await fn()) return; if (Date.now() > end) throw new Error('waited too long for ' + what); await new Promise(r => setTimeout(r, 250)); }
};

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  // One Charleston load, in Charleston's own database (as its own sheets' copy would put it): route 412.
  const ut = (await db().collection('runs').get()).docs.map(d => Object.assign({ id: d.id }, d.data()));
  const pick = ut.find(r => r.days && Object.values(r.days).some(d => d && d.loadDate === DATE && d.runs !== false)) || ut[0];
  const chId = pick.id.replace(/__.*/, '__run_ch412');
  const chRun = Object.assign({}, pick, { route: '412', routeName: 'KROGER', run: 'KROGER', runId: 'run_ch412', facilityId: CH });
  delete chRun.id;
  await plantDb(CH).collection('runs').doc(chId).set(chRun);
  // Charleston's own Go-Live Switches, set the same as Uniontown's here (each plant keeps its own).
  await plantDb(CH).collection('config').doc('app').set((await db().collection('config').doc('app').get()).data() || {});
  // The server copies the people given Charleston into its database (src/plants.js), and fills its load records.
  await until('the Administrator copied to Charleston', async () => (await plantDb(CH).collection('plantAccess').get()).size > 0);
  await until("Charleston's load records", async () => (await plantDb(CH).collection('runDays').get()).size > 0);
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const results = [];
  try {
    for (const [w, h] of [[1536, 790], [1920, 1080]]) {
      const u = await openPage(browser, w, h, '/daily.html?date=' + DATE + '&testEmail=admin.test@uniteddairy.com');
      await u.waitForSelector('#rows tr[data-id]', { timeout: 20000 });
      assert.equal((await u.textContent('.brand small .plant-name')).trim(), 'UNIONTOWN');
      const utRoutes = await u.$$eval('#rows tr[data-id] td:first-child', t => t.map(x => x.textContent.trim()));
      assert.ok(utRoutes.length > 1 && utRoutes.indexOf('412') < 0, "Uniontown's own loads, none of Charleston's");
      if (SHOTS) await u.screenshot({ path: path.join(SHOTS, 'uniontown-daily-' + w + '.png') });
      assert.deepEqual(u.errors, []);
      await u.close();

      const c = await openPage(browser, w, h, '/daily.html?date=' + DATE + '&plant=' + CH + '&testEmail=admin.test@uniteddairy.com');
      await c.waitForSelector('#rows tr[data-id]', { timeout: 20000 });
      assert.equal((await c.textContent('.brand small .plant-name')).trim(), 'CHARLESTON');
      const chRoutes = await c.$$eval('#rows tr[data-id] td:first-child', t => t.map(x => x.textContent.trim()));
      assert.deepEqual([...new Set(chRoutes)], ['412'], "Charleston shows only Charleston's load");
      if (SHOTS) await c.screenshot({ path: path.join(SHOTS, 'charleston-daily-' + w + '.png') });
      if (w === 1920) {
        // A change on Charleston's screen is saved in Charleston's database; Uniontown's database is not touched.
        const before = JSON.stringify((await db().collection('runs').get()).docs.map(d => d.data().days));
        const day = Object.keys(pick.days).find(k => pick.days[k] && pick.days[k].loadDate === DATE);
        const was = (await plantDb(CH).collection('runs').doc(chId).get()).data().days[day].runs;
        await c.click('#rows tr[data-id] [data-runs]');
        await until('the save in Charleston', async () => (await plantDb(CH).collection('runs').doc(chId).get()).data().days[day].runs !== was);
        assert.equal(JSON.stringify((await db().collection('runs').get()).docs.map(d => d.data().days)), before, "Uniontown's loads unchanged");
        assert.equal((await db().collection('runs').doc(chId).get()).exists, false, "no Charleston load in Uniontown's database");
      }
      assert.deepEqual(c.errors, []);
      await c.close();

      // Someone with Uniontown only: a Charleston link keeps them on Uniontown, with Uniontown's loads.
      const m = await openPage(browser, w, h, '/daily.html?date=' + DATE + '&plant=' + CH + '&testEmail=dispatch.test@uniteddairy.com');
      await m.waitForSelector('#rows tr[data-id]', { timeout: 20000 });
      await until('the header', async () => ((await m.textContent('.brand small .plant-name').catch(() => '')) || '').trim() === 'UNIONTOWN', 10000);
      const mRoutes = await m.$$eval('#rows tr[data-id] td:first-child', t => t.map(x => x.textContent.trim()));
      assert.ok(mRoutes.length > 1 && mRoutes.indexOf('412') < 0, 'no Charleston load for a Uniontown-only person');
      assert.deepEqual(m.errors, []);
      await m.close();
      results.push(w + ': Uniontown ' + utRoutes.length + ' loads, Charleston ' + chRoutes.length);
    }
  } finally { await browser.close(); }
  console.log('plants-separate: ' + results.join('; '));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
