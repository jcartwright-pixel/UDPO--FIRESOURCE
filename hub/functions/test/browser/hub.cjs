'use strict';
/*
 * The hub's Home screen on the local emulators: an administrator sees all four tiles, a salesperson two, someone not on the
 * Users list a plain message. Made-up people only. Pictures at 1920 and 390 go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear, localCalls, localAdmin } = require('../helpers.cjs');

const HOSTING = process.argv[2] || 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;

async function open(browser, email, size, page) {
  const ctx = await browser.newContext({ viewport: size || { width: 1920, height: 950 } });
  await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, r.request().url().split('/').pop())) }));
  await localCalls(ctx);
  await localAdmin(ctx);
  const p = await ctx.newPage();
  p.on('pageerror', e => { throw e; });
  await p.goto(HOSTING + '/' + (page || 'index.html') + '?testEmail=' + email);
  return p;
}
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); };

(async () => {
  await clear();
  await db().collection('users').doc('pat.admin@uniteddairy.com').set({ status: 'ACTIVE', roles: ['Administrator'], name: 'Pat Admin' });
  await db().collection('users').doc('sam.sales@uniteddairy.com').set({ status: 'ACTIVE', roles: ['Sales'], name: 'Sam Sales' });
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  try {
    let p = await open(browser, 'pat.admin@uniteddairy.com');
    await p.waitForSelector('#tiles a');
    assert.deepEqual(await p.$$eval('#tiles a', as => as.map(a => a.dataset.app)), ['operations', 'customers', 'fuel', 'udms']);
    assert.equal(await p.textContent('#hello'), 'Your apps, Pat');
    assert.equal(await p.getAttribute('#tiles a[data-app="operations"]', 'target'), '_blank');
    assert.deepEqual(await p.$$eval('#tiles a strong', s => s.map(x => x.textContent)), ['Plant & Distribution', 'Customers & Routes', 'Fuel Tracking', 'Employees & Compliance']);
    assert.equal(await p.$$eval('#tiles a .app-icon svg', s => s.length), 4, 'every card has its picture');
    await shot(p, 'hub-admin-1920');
    p = await open(browser, 'pat.admin@uniteddairy.com', { width: 390, height: 844 });
    await p.waitForSelector('#tiles a');
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll on a phone');
    await shot(p, 'hub-admin-390');

    assert.ok(await p.isVisible('a[data-admin="people"]'), 'an administrator sees People & Access on Home');

    // People & Access: the list with each person's apps; make Sam a Manager at all plants, then disable and enable again.
    p = await open(browser, 'pat.admin@uniteddairy.com', null, 'people.html');
    await p.waitForSelector('#rows tr[data-email]');
    assert.equal(await p.$$eval('#rows tr[data-email]', r => r.length), 2);
    assert.match(await p.textContent('#rows tr[data-email="sam.sales@uniteddairy.com"]'), /Plant & Distribution.*Customers & Routes/);
    await p.click('#rows tr[data-email="sam.sales@uniteddairy.com"]');
    await p.selectOption('#f-role', 'ADMINISTRATOR');
    assert.match(await p.textContent('#f-apps'), /Fuel Tracking.*Employees & Compliance/, 'the apps change before saving');
    await p.selectOption('#f-role', 'MANAGER');
    await p.check('#f-all');
    await shot(p, 'hub-people-1920');
    await p.click('#f-save');
    await p.waitForSelector('#f-msg.good');
    const sam = (await db().collection('users').doc('sam.sales@uniteddairy.com').get()).data();
    assert.deepEqual([sam.roles, sam.facilities, sam.status], [['MANAGER'], ['*'], 'ACTIVE']);
    // Add a person.
    await p.click('#add');
    await p.fill('#f-name', 'Robin Driver');
    await p.fill('#f-email', 'robin.driver@uniteddairy.com');
    await p.selectOption('#f-role', 'DRIVER');
    await p.click('#f-save');
    await p.waitForSelector('#f-msg.good');
    assert.equal((await db().collection('users').doc('robin.driver@uniteddairy.com').get()).data().roles[0], 'DRIVER');
    p = await open(browser, 'pat.admin@uniteddairy.com', { width: 390, height: 844 }, 'people.html');
    await p.waitForSelector('#rows tr[data-email]');
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'People & Access: no sideways scroll on a phone');
    await shot(p, 'hub-people-390');

    p = await open(browser, 'sam.sales@uniteddairy.com');
    await p.waitForSelector('#tiles a');
    assert.deepEqual(await p.$$eval('#tiles a', as => as.map(a => a.dataset.app)), ['operations', 'customers']);
    assert.ok(!(await p.isVisible('a[data-admin="people"]')), 'someone who is not an administrator does not see Administration');
    p = await open(browser, 'sam.sales@uniteddairy.com', null, 'people.html');
    await p.waitForSelector('#error:not([hidden])');
    assert.match(await p.textContent('#error'), /Only an administrator/);

    p = await open(browser, 'nobody@uniteddairy.com');
    await p.waitForSelector('#error:not([hidden])');
    assert.match(await p.textContent('#error'), /not on the Users list/);
    await shot(p, 'hub-not-on-list');
    console.log('hub browser test passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
