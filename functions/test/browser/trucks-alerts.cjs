'use strict';
/*
 * Joe 10/14: Time out (in place of the route) runs from the yard leave until back, or now; a sleeper counts from yesterday.
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

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;
const AT = '2026-10-05T18:00:00.000Z', DAY = '2026-10-05';
const t = (min) => new Date(Date.parse(AT) - min * 60000).toISOString();

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  // Joe 10/14: only the runs that leave today, with one of our drivers. The 10/5 loads leave 10/6 (a day early on Daily
  // Dispatch), so David is not working 10/5; CARRIER is not our driver.
  const set = (run, day, v) => db().collection('runs').doc('2026-10-04__run_' + run).set({ days: { [day]: v } }, { merge: true });
  await set('t801', 'mon', { driver: 'Pat Smith', truck: '900001' });
  await set('t802', 'mon', { driver: 'CARRIER', truck: '' });
  await set('t801', 'tue', { driver: 'ALESANTRINO, DAVID', truck: '900002' });
  await set('t802', 'tue', { driver: 'Lee Jones', truck: '900003' });
  await db().collection('runs').doc('2026-10-04__run_t802').set({ days: { tue: { departureDate: DAY } } }, { merge: true }); // leaves the night before
  // Joe 10/14: a sleeper route (Route Master "Sleeper") left yesterday and is still out: it shows, counting from yesterday.
  await set('t802', 'sun', { runs: true, driver: 'Sam Hill', truck: '900004' });
  // Joe 10/14 (RUGG, DONALD): a second run today for Pat on the same truck is the same line, counted once.
  await set('t801', 'sun', { runs: true, driver: 'Pat Smith', truck: '900001', departureDate: DAY, dispatchTime: 900 });
  await db().collection('routes').doc('run_t802').set({ sleeper: true }, { merge: true });
  const b = db().batch();
  [['900001', 52, ''], ['900002', 0, 'Uniontown Branch'], ['900003', 0, 'Uniontown Branch'], ['900004', 60, '']].forEach(([tag, mph, place]) => b.set(db().collection('gpsTrucks').doc(tag),
    { tag, lastReport: t(2), place, address: 'US|15401|Pennsylvania|Uniontown|Union St', speedMph: mph, ignitionOn: mph > 0, active: true, updatedAt: AT }));
  b.set(db().collection('gpsDays').doc(DAY + '_900001'), { tag: '900001', date: DAY, yardOut: t(560), miles: 5, firstMove: t(500), lastMove: AT, since: t(600), updatedAt: AT });
  b.set(db().collection('gpsDays').doc(DAY + '_900003'), { tag: '900003', date: DAY, yardOut: t(300), yardIn: t(60), updatedAt: AT });
  b.set(db().collection('gpsDays').doc('2026-10-04_900004'), { tag: '900004', date: '2026-10-04', yardOut: '2026-10-04T22:00:00.000Z', updatedAt: AT });
  const A = (id, min, o) => b.set(db().collection('gpsAlerts').doc(id), Object.assign({ date: DAY, tag: '900001', unitId: '1', at: t(min), speedMph: null, limitMph: null, minutes: null, place: '', address: '', condition: '', updatedAt: AT }, o));
  A('A1', 120, { type: 'SPEEDING', speedMph: 82, limitMph: 70, condition: 'Speeding over 80', address: 'US|21795|Maryland|Williamsport|I-81 N' });
  A('A2', 400, { type: 'SPEEDING', speedMph: 71, limitMph: 55, condition: 'Speeding', address: 'US|21502|Maryland|Cumberland|I-68 W' });
  A('A3', 300, { type: 'HARSH_BRAKING', condition: 'Harsh Braking' });
  A('A4', 200, { type: 'FAULT', code: '791:2', fmiText: 'Erratic or wrong data', condition: 'DTC CODE' });
  A('A5', 50, { tag: '900003', type: 'IDLE', minutes: 42, condition: 'Excessive Idling', place: 'Uniontown Branch' });
  A('A6', 50, { tag: '900001', date: '2026-10-04', type: 'SEATBELT', condition: 'Seatbelt' }); // yesterday: not counted
  A('A7', 30, { tag: '900002', type: 'SPEEDING', speedMph: 70, limitMph: 55, condition: 'Speeding' }); // David's truck: he is not out today
  await b.commit();

  const results = [];
  const browser = await chromium.launch();
  try {
    for (const [w, h] of [[1536, 864], [1920, 1080]]) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, serviceWorkers: 'block' });
      await page.clock.install({ time: new Date(AT) });
      await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, r.request().url().split('/').pop())) }));
      const errors = []; page.on('pageerror', e => { errors.push(e.message); console.log('PAGEERR', e.message); }); page.on('console', m => console.log('CONSOLE', m.text()));
      await page.goto(HOSTING + '/trucks.html?testEmail=dispatch.test@uniteddairy.com');
      await page.waitForFunction(() => document.querySelectorAll('.tt-board .tt-alerts').length >= 3 && Array.from(document.querySelectorAll('.tt-alerts')).some(b => /4/.test(b.textContent)), null, { timeout: 15000 });
      assert.deepEqual(await page.$$eval('.tt-board > thead th', a => a.map(x => x.textContent)), ['Driver', 'Truck', 'Status', 'Where now', 'Miles today', 'First move', 'Dispatch', 'Last report', 'Time out', 'Alerts']);
      const counts = await page.$$eval('.tt-board > tbody > tr', a => a.map(r => [r.cells[0].textContent, r.querySelector('.tt-alerts').textContent.trim()]));
      assert.deepEqual(counts.find(c => c[0] === 'Pat Smith')[1], '4 ▾', 'Pat\'s truck: 4 alerts today, not yesterday\'s');
      assert.deepEqual(counts.find(c => c[0] === 'Lee Jones')[1], '1 ▾', 'a run leaving today by its Live departure date shows');
      assert.deepEqual(counts.map(c => c[0]).sort(), ['Lee Jones', 'Pat Smith', 'Sam Hill'], 'no line for a driver whose run leaves tomorrow, none for CARRIER');
      const out = Object.fromEntries(await page.$$eval('.tt-board > tbody > tr', a => a.map(r => [r.cells[0].textContent, r.cells[8].textContent])));
      assert.equal(out['Pat Smith'], '9 h 20 mstill out', 'still out: from the yard leave until now');
      assert.equal(counts.filter(c => c[0] === 'Pat Smith').length, 1, 'two runs on one truck: one line');
      // Both dispatch times, one per line: read the <br>-separated lines from the cell's markup, since innerText
      // reads joined whenever the row is not laid out at that instant (seen on the CI runner).
      assert.deepEqual(await page.$$eval('.tt-board > tbody > tr', a => a.find(r => r.cells[0].textContent === 'Pat Smith').cells[6].innerHTML.split(/<br\s*\/?>/i)), ['4:00 AM', '3:00 PM'], 'both dispatch times');
      assert.equal(await page.$eval('#kpis div b', b => b.textContent), '3', 'Dispatched today counts Pat once');
      assert.equal(out['Lee Jones'], '4 h 0 mback 1:00 PM', 'back: from the yard leave until the return');
      assert.equal(out['Sam Hill'], '20 h 0 msince yesterday', 'sleeper: counts from yesterday\'s yard leave, across midnight');
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
      results.push('Alerts and Time out columns at ' + w + ': time out from the yard leave (a sleeper across midnight), counts today\'s alerts per truck, drop-down in time order with the yard leave, closes again');
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(results.map(r => 'ok - ' + r).join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
