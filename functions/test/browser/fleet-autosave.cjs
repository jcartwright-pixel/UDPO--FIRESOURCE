'use strict';
/*
 * Batch 5 (10/23, Joe: "do whatever you feel needs"): Fleet Service Setup has no Save Rules or Save Unit button. A service
 * rule saves when its box is left, and each box of a unit's Edit window saves on its own; Close just closes. At 1536x790.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const G = require('../../src/garage');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const until = async (fn, what) => { for (let i = 0; i < 60; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 250)); } assert.fail(what); };

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date() });
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage({ viewport: { width: 1536, height: 790 }, serviceWorkers: 'block' });
    await p.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, r.request().url().split('/').pop())) }));
    await localCalls(p);
    const errors = [];
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(HOSTING + '/fleet.html?view=setup&testEmail=manager.test@uniteddairy.com');
    await p.waitForSelector('[data-rule="truckMiles"]');
    assert.equal(await p.$('#rules-save'), null, 'no Save Rules button');
    await p.fill('[data-rule="truckMiles"]', '21000');
    await p.press('[data-rule="truckMiles"]', 'Tab');
    const rules = async () => ((await db().collection('config').doc(G.rulesDocFor('fac_uniontown')).get()).data() || {});
    await until(async () => Number((await rules()).truckMiles || ((await rules()).rules || {}).truckMiles) === 21000, 'the rule saved when its box was left');

    const unit = await p.getAttribute('#sheet [data-edit]', 'data-edit');
    await p.click('#sheet [data-edit="' + unit + '"]');
    await p.waitForSelector('#unit-modal:not([hidden]) #u-notes');
    assert.deepEqual(await p.$$eval('#unit-modal .modal-actions button', b => b.map(x => x.textContent)), ['Close'], 'no Save Unit button');
    await p.fill('#u-notes', 'Reefer checked by vendor');
    await p.press('#u-notes', 'Tab');
    const setup = async () => ((await db().collection('fleetSetup').doc(unit.replace(/[^A-Za-z0-9_-]+/g, '_')).get()).data() || {});
    await until(async () => (await setup()).notes === 'Reefer checked by vendor', 'the note saved when its box was left');
    await p.click('#unit-modal [data-close]');
    assert.equal(await p.isHidden('#unit-modal'), true);
    assert.deepEqual(errors, []);
    console.log('fleet-autosave: ok');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
