'use strict';
/*
 * Browser check of Joe's 10/14 pick (mock-up B): Trucks Today's Alerts column counts today's Verizon Fleet alerts for each
 * driver's truck, and clicking the number drops down what Verizon sent, in time order, with the yard leave. The rest of the
 * table is unchanged. At 1536 and 1920. With SHOTS_DIR=<folder> it saves pictures.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const L = require('../../src/logic');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;
const AT = '2026-10-05T18:00:00.000Z', DAY = '2026-10-05';
const t = (min) => new Date(Date.parse(AT) - min * 60000).toISOString();

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  const runs = (await db().collection('runs').get()).docs.map(d => Object.assign({ id: d.id }, d.data()));
  const rows = L.dailyRows(runs, DAY);
  assert.ok(rows.length >= 2, 'the sample week has two loads on ' + DAY);
  const people = [['Pat Smith', '900001'], ['Lee Jones', '900002']];
  for (let i = 0; i < rows.length; i++) {
    await db().collection('runs').doc(rows[i].runDocId).set({ days: { [rows[i].day]: { driver: people[i % 2][0], truck: people[i % 2][1] } } }, { merge: true });
  }
  const b = db().batch();
  [['900001', 52, ''], ['900002', 0, 'Uniontown Branch']].forEach(([tag, mph, place]) => b.set(db().collection('gpsTrucks').doc(tag),
    { tag, lastReport: t(2), place, address: 'US|15401|Pennsylvania|Uniontown|Union St', speedMph: mph, ignitionOn: mph > 0, active: true, updatedAt: AT }));
  b.set(db().collection('gpsDays').doc(DAY + '_900001'), { tag: '900001', date: DAY, yardOut: t(560), miles: 5, firstMove: t(500), lastMove: AT, since: t(600), updatedAt: AT });
  const A = (id, min, o) => b.set(db().collection('gpsAlerts').doc(id), Object.assign({ date: DAY, tag: '900001', unitId: '1', at: t(min), speedMph: null, limitMph: null, minutes: null, place: '', address: '', condition: '', updatedAt: AT }, o));
  A('A1', 120, { type: 'SPEEDING', speedMph: 82, limitMph: 70, condition: 'Speeding over 80', address: 'US|21795|Maryland|Williamsport|I-81 N' });
  A('A2', 400, { type: 'SPEEDING', speedMph: 71, limitMph: 55, condition: 'Speeding', address: 'US|21502|Maryland|Cumberland|I-68 W' });
  A('A3', 300, { type: 'HARSH_BRAKING', condition: 'Harsh Braking' });
  A('A4', 200, { type: 'FAULT', code: '791:2', fmiText: 'Erratic or wrong data', condition: 'DTC CODE' });
  A('A5', 50, { tag: '900002', type: 'IDLE', minutes: 42, condition: 'Excessive Idling', place: 'Uniontown Branch' });
  A('A6', 50, { tag: '900001', date: '2026-10-04', type: 'SEATBELT', condition: 'Seatbelt' }); // yesterday: not counted
  await b.commit();

  const results = [];
  const browser = await chromium.launch();
  try {
    for (const [w, h] of [[1536, 864], [1920, 1080]]) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, serviceWorkers: 'block' });
      await page.clock.install({ time: new Date(AT) });
      await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, r.request().url().split('/').pop())) }));
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(HOSTING + '/trucks.html?testEmail=dispatch.test@uniteddairy.com');
      await page.waitForFunction(() => document.querySelectorAll('.tt-board .tt-alerts').length >= 2 && /4/.test(document.querySelector('.tt-alerts').textContent), null, { timeout: 15000 });
      assert.deepEqual(await page.$$eval('.tt-board > thead th', a => a.map(x => x.textContent)), ['Driver', 'Truck', 'Status', 'Where now', 'Miles today', 'First move', 'Dispatch', 'Last report', 'Route', 'Alerts']);
      const counts = await page.$$eval('.tt-board > tbody > tr', a => a.map(r => [r.cells[0].textContent, r.querySelector('.tt-alerts').textContent.trim()]));
      assert.deepEqual(counts.find(c => c[0] === 'Pat Smith')[1], '4 ▾', 'Pat\'s truck: 4 alerts today, not yesterday\'s');
      assert.deepEqual(counts.find(c => c[0] === 'Lee Jones')[1], '1 ▾');
      await page.click('.tt-alerts.has');
      await page.waitForSelector('tr.tt-events');
      const ev = await page.$$eval('tr.tt-events tbody tr', a => a.map(r => Array.from(r.cells).map(c => c.textContent)));
      assert.deepEqual(ev.map(e => e[1]), ['Left the yard', 'Speeding', 'Harsh braking', 'Engine code', 'Speeding over 80'], 'time order, yard leave first');
      assert.equal(ev[1][2], '71 in a 55 mph');
      assert.equal(ev[1][3], 'I-68 W, Cumberland, MD 21502');
      assert.equal(ev[3][2], '791:2 · Erratic or wrong data');
      assert.equal(await page.$$eval('tr.tt-events', a => a.length), 1, 'only the clicked line opens');
      assert.ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth + 1), 'no sideways scroll at ' + w);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'trucks-alerts-' + w + '.png') });
      await page.click('.tt-alerts[aria-expanded="true"]');
      await page.waitForFunction(() => !document.querySelector('tr.tt-events'));
      assert.deepEqual(errors, []);
      results.push('Alerts column at ' + w + ': counts today\'s alerts per truck, drop-down in time order with the yard leave, closes again');
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(results.map(r => 'ok - ' + r).join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
