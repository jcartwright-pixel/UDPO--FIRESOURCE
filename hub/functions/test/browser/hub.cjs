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
const R = require('../../../../functions/src/rights');

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
    assert.ok(await p.isVisible('a[data-admin="roles"]'), 'and Roles & Rights');

    // People & Access: the list with each person's apps; make Sam a Manager at all plants, then disable and enable again.
    p = await open(browser, 'pat.admin@uniteddairy.com', null, 'people.html');
    await p.waitForSelector('#rows tr[data-email]');
    assert.equal(await p.$$eval('#rows tr[data-email]', r => r.length), 2);
    // Each app is a tick box, ticked for what each person can open now.
    const ticks = (email) => p.$$eval('#rows tr[data-email="' + email + '"] input[data-app]', b => b.map(x => x.dataset.app + (x.checked ? '+' : '-')).join(' '));
    assert.equal(await ticks('sam.sales@uniteddairy.com'), 'operations+ customers+ fuel- udms-');
    assert.equal(await ticks('pat.admin@uniteddairy.com'), 'operations+ customers+ fuel+ udms+');
    assert.ok(await p.isDisabled('#rows tr[data-email="pat.admin@uniteddairy.com"] input[data-app="fuel"]'), 'nobody unticks their own apps');
    assert.ok(await p.isDisabled('#rows tr[data-email="sam.sales@uniteddairy.com"] input[data-app="operations"]'), 'Plant & Distribution stays on');
    // Tick Fuel Tracking for Sam: it saves at once, and Sam's Home gets the Fuel card.
    await p.click('#rows tr[data-email="sam.sales@uniteddairy.com"] input[data-app="fuel"]');
    await p.waitForSelector('#list-msg.good');
    assert.match(await p.textContent('#list-msg'), /Sam Sales can now open Fuel Tracking/);
    assert.deepEqual((await db().collection('appAccess').doc('sam.sales@uniteddairy.com').get()).data().apps, ['operations', 'customers', 'fuel']);
    assert.equal(await ticks('sam.sales@uniteddairy.com'), 'operations+ customers+ fuel+ udms-');
    assert.equal(await p.$eval('#edit', b => b.querySelector('.pblock') === null), true, 'ticking does not open the person');
    // The page scrolls (Joe 11-3-26: "You can't scroll on this screen").
    await p.setViewportSize({ width: 1280, height: 400 });
    await p.evaluate(() => window.scrollTo(0, 300));
    assert.ok(await p.evaluate(() => window.scrollY > 0), 'People & Access scrolls');
    await p.setViewportSize({ width: 1920, height: 1080 });
    await p.click('#rows tr[data-email="sam.sales@uniteddairy.com"]');
    await p.selectOption('#f-role', 'ADMINISTRATOR');
    assert.equal(await p.isChecked('#f-apps input[data-dapp="udms"]'), false, 'Sam\'s own ticks are saved, so a role change keeps them');
    await p.check('#f-apps input[data-dapp="udms"]');
    assert.match(await p.textContent('#edit'), /Apps they can open Not saved yet/);
    await p.selectOption('#f-role', 'MANAGER');
    await p.check('#f-all');
    await shot(p, 'hub-people-1920');
    await p.click('#f-save');
    await p.waitForSelector('#f-msg.good');
    const sam = (await db().collection('users').doc('sam.sales@uniteddairy.com').get()).data();
    assert.deepEqual([sam.roles, sam.facilities, sam.status], [['MANAGER'], ['*'], 'ACTIVE']);
    assert.deepEqual((await db().collection('appAccess').doc('sam.sales@uniteddairy.com').get()).data().apps, ['operations', 'customers', 'fuel', 'udms'], 'the apps ticked on the person save with Save');
    // What Sam sees in Plant & Distribution: start from the Dispatcher job (it opens Route Distribution), take Sheet
    // Conflicts off, deny one right, then pick the Home screen.
    await p.waitForSelector('#f-job');
    assert.match(await p.textContent('.pblock'), /Nothing is limited yet/);
    await p.selectOption('#f-plant', 'fac_uniontown');
    await p.selectOption('#f-job', 'dispatcher');
    assert.match(await p.textContent('.pblock'), /Not saved yet/);
    assert.ok(await p.isVisible('input[data-keys="conflicts"]'), 'the job opens the areas it ticks');
    await p.uncheck('input[data-keys="conflicts"]');
    await p.click('#f-rights summary');
    await p.selectOption('select[data-right="dispatch.publish"]', 'deny');
    assert.match(await p.textContent('#f-rights summary'), /1 changed/);
    await shot(p, 'hub-people-screens-1920');
    await p.click('#f-save');
    await p.waitForSelector('#f-msg.good');
    let samNow = (await db().collection('users').doc('sam.sales@uniteddairy.com').get()).data();
    assert.ok(samNow.screenAccess.fac_uniontown.indexOf('daily') >= 0 && samNow.screenAccess.fac_uniontown.indexOf('conflicts') < 0, JSON.stringify(samNow.screenAccess));
    assert.ok(samNow.screenAccess.fac_uniontown.indexOf('manager') < 0, 'a screen the job does not have is off');
    assert.deepEqual(samNow.denials, ['dispatch.publish']);
    await p.selectOption('#f-home', 'daily.html');
    await p.click('#f-save');
    await p.waitForSelector('#f-msg.good');
    samNow = (await db().collection('users').doc('sam.sales@uniteddairy.com').get()).data();
    assert.equal(samNow.homeScreen, 'daily.html');
    assert.equal(await p.inputValue('#f-home'), 'daily.html');
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

    // Roles & Rights: tick Approve vacations for Supervisor, untick it again, then add a role copied from Dispatcher.
    p = await open(browser, 'pat.admin@uniteddairy.com', null, 'roles.html');
    await p.waitForSelector('#rows input[data-role]');
    const box = (role, code) => '#rows input[data-role="' + role + '"][data-right="' + code + '"]';
    assert.ok(await p.isDisabled(box('ADMINISTRATOR', 'dispatch.read')) && await p.isChecked(box('ADMINISTRATOR', 'dispatch.read')), 'Administrator is locked with everything');
    assert.equal(await p.$$eval('#rows input[data-right^="admin."]', b => b.length), 0, 'Administrator-only rights are not offered');
    assert.match(await p.textContent('#head th[data-role="MANAGER"]'), /1 person/);
    const supervisorHad = await p.isChecked(box('SUPERVISOR', 'vacations.approve'));
    await p.click(box('SUPERVISOR', 'vacations.approve'));
    await p.waitForSelector('#msg.good');
    assert.match(await p.textContent('#msg'), supervisorHad ? /Supervisor can no longer: Approve vacations/ : /Supervisor can now: Approve vacations/);
    let tpl = (await db().collection('private').doc('roleTemplates').get()).data();
    assert.equal(tpl.templates.SUPERVISOR.indexOf('vacations.approve') >= 0, !supervisorHad);
    assert.ok(await p.isVisible('#head button[data-standard="SUPERVISOR"]'), 'a changed role can go back to standard');
    // Two quick ticks in a row both save (each from what the last one left).
    await p.click(box('SUPERVISOR', 'otr.read'));
    await p.click(box('SUPERVISOR', 'gps.read'));
    await p.waitForFunction(() => /GPS/.test(document.querySelector('#msg').textContent));
    tpl = (await db().collection('private').doc('roleTemplates').get()).data();
    const had = (c) => (R.DEFAULTS.SUPERVISOR || []).indexOf(c) >= 0;
    assert.equal(tpl.templates.SUPERVISOR.indexOf('otr.read') >= 0, !had('otr.read'), 'first quick tick kept');
    assert.equal(tpl.templates.SUPERVISOR.indexOf('gps.read') >= 0, !had('gps.read'), 'second quick tick saved');
    await shot(p, 'hub-roles-1920');
    await p.click('#head button[data-standard="SUPERVISOR"]');
    await p.waitForFunction(() => /back to its standard/.test(document.querySelector('#msg').textContent));
    tpl = (await db().collection('private').doc('roleTemplates').get()).data();
    assert.equal(tpl.templates.SUPERVISOR, undefined, 'Use standard drops the saved list');
    await p.click('#add');
    await p.fill('#new-name', 'Route Planner');
    await p.selectOption('#new-from', 'DISPATCHER');
    await p.click('#new-save');
    await p.waitForSelector('#head th[data-role="ROUTE_PLANNER"]');
    assert.ok(await p.isChecked(box('ROUTE_PLANNER', 'dispatch.write')), 'the new role starts with Dispatcher\'s ticks');
    assert.ok(await p.isHidden('#add-form'));
    p = await open(browser, 'pat.admin@uniteddairy.com', { width: 390, height: 844 }, 'roles.html');
    await p.waitForSelector('#rows input[data-role]');
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Roles & Rights: no sideways page scroll on a phone');
    await shot(p, 'hub-roles-390');

    p = await open(browser, 'sam.sales@uniteddairy.com');
    await p.waitForSelector('#tiles a');
    assert.deepEqual(await p.$$eval('#tiles a', as => as.map(a => a.dataset.app)), ['operations', 'customers', 'fuel', 'udms'], 'Sam\'s Home shows the apps ticked for Sam');
    assert.ok(!(await p.isVisible('a[data-admin="people"]')), 'someone who is not an administrator does not see Administration');
    p = await open(browser, 'sam.sales@uniteddairy.com', null, 'roles.html');
    await p.waitForSelector('#error:not([hidden])');
    assert.match(await p.textContent('#error'), /Only an administrator/);
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
