'use strict';
/*
 * Browser check of Fleet Service Setup's changes (Joe 10/11, review items 24, 25, 26 and 31): the rules page saves and the
 * due dates follow, Edit on a unit saves its dates, the Technicians page adds a mechanic, and a truck with no miles yet
 * has Send to Garage. With SHOTS=<folder> it saves a picture of each.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const F = require('../fixtures/fake-sheets');
const G = require('../fixtures/garage-demo');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS || process.env.SHOTS_DIR || '';
const EMAIL = 'manager.test@uniteddairy.com', AS = '?testEmail=' + EMAIL;

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height } });
  // The save callable answers straight from the server code when no functions emulator runs (LOCAL_CALLS=1).
  if (process.env.LOCAL_CALLS) {
    await page.route(/:5001\/[^/]+\/[^/]+\/save$/, async (route) => {
      const data = (route.request().postDataJSON() || {}).data;
      try { route.fulfill({ contentType: 'application/json', body: JSON.stringify({ result: await applyAction(db(), { email: EMAIL }, data) }) }); }
      catch (e) { route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { status: 'FAILED_PRECONDITION', message: e.message } }) }); }
    });
  }
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) }); };

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(G.sheets()), sources: G.SOURCES, now: () => new Date() });
  const browser = await chromium.launch();
  const results = [];
  try {
    // 1. The rules page (item 24): Change the rules opens it; saved rules show on Fleet Service Setup.
    const fs1 = await openPage(browser, 1920, 1080, '/fleet.html' + AS + '&view=setup');
    await fs1.waitForSelector('a[href="fleet-rules.html"]', { timeout: 10000 });
    await Promise.all([fs1.waitForURL(/fleet-rules\.html/), fs1.click('a[href="fleet-rules.html"]')]);
    await fs1.waitForSelector('#save:not([hidden])', { timeout: 10000 });
    assert.equal(await fs1.inputValue('[data-rule="truckMiles"]'), '15000');
    await fs1.fill('[data-rule="truckMiles"]', '12000');
    await fs1.fill('[data-rule="dotMonths"]', '6');
    await fs1.click('#save');
    await fs1.waitForFunction(() => /Saved/.test(document.getElementById('saved').textContent), null, { timeout: 10000 });
    await shot(fs1, '1-rules-1920.png');
    assert.equal((await db().collection('config').doc('fleetRules').get()).data().rules.truckMiles, 12000);
    results.push('Change the rules opens the rules page; PM 12,000 miles and DOT 6 months saved');

    // 2. Edit a unit (item 25).
    const fs2 = await openPage(browser, 1920, 1080, '/fleet.html' + AS + '&view=setup');
    await fs2.waitForFunction(() => /PM every 12,000 mi/.test(document.getElementById('bar').textContent), null, { timeout: 10000 });
    await fs2.click('[data-edit="900001"]');
    await fs2.waitForSelector('#fs-edit');
    await fs2.fill('#e-date', '2026-09-01');
    await fs2.fill('#e-miles', '400000');
    await fs2.fill('#e-dot', '2027-01-31');
    await fs2.fill('#e-plate', '2027-03-31');
    await fs2.fill('#e-notes', 'New steer tires');
    await shot(fs2, '2-unit-edit-1920.png');
    await fs2.click('#fs-edit [type=submit]');
    await fs2.waitForFunction(() => !document.getElementById('fs-edit') && /New steer tires/.test(document.getElementById('sheet').textContent), null, { timeout: 10000 });
    await shot(fs2, '3-unit-saved-1920.png');
    assert.equal((await db().collection('fleetSetup').doc('900001').get()).data().dot_due, '2027-01-31');
    results.push('Edit on 900001 saves last service, DOT due, plate and notes');

    // 3. Technicians (item 26).
    const tp = await openPage(browser, 1920, 1080, '/fleet-techs.html' + AS);
    await tp.waitForSelector('#add:not([hidden])', { timeout: 10000 });
    await tp.click('#add');
    await tp.fill('#t-name', 'NEW Mechanic');
    await tp.fill('#t-login', '012345');
    await tp.click('#tech-form [type=submit]');
    await tp.waitForFunction(() => /NEW Mechanic/.test(document.getElementById('rows').textContent), null, { timeout: 10000 });
    await tp.click('[data-tech="TECH-JN"]');
    await tp.selectOption('#t-active', 'NO');
    await shot(tp, '4-technicians-1920.png');
    await tp.click('#tech-form [type=submit]');
    await tp.waitForFunction(() => document.querySelectorAll('#rows tr.off').length === 2, null, { timeout: 10000 });
    await shot(tp, '5-technicians-saved-1920.png');
    results.push('Technicians: NEW Mechanic added with login ID 012345, NARD Jaxon turned off');

    // 4. No miles yet gets Send to Garage (item 31).
    const due = await openPage(browser, 1920, 1080, '/fleet.html' + AS);
    await due.waitForSelector('tr[data-unit="900001"]', { timeout: 10000 });
    assert.match(await due.textContent('tr[data-unit="900001"]'), /No miles yet/);
    assert.ok(await due.$('tr[data-unit="900001"] [data-send]'), 'Send to Garage on a truck with no miles yet');
    await shot(due, '6-due-no-miles-send-1920.png');
    results.push('Due: 900001 with no miles yet has Send to Garage');
    assert.deepEqual(fs1.errors.concat(fs2.errors, tp.errors, due.errors), []);
  } finally {
    await browser.close();
  }
  console.log(results.map(r => 'ok - ' + r).join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
