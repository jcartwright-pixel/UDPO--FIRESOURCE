'use strict';
/*
 * The hub's Home screen on the local emulators: an administrator sees all four tiles, a salesperson two, someone not on the
 * Users list a plain message. Made-up people only. Pictures at 1920 and 390 go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear, localCalls, localAdmin, localKeys, localEstimator, estimatorAsked } = require('../helpers.cjs');
const R = require('../../../../functions/src/rights');

const HOSTING = process.argv[2] || 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;

async function open(browser, email, size, page) {
  const ctx = await browser.newContext({ viewport: size || { width: 1920, height: 950 } });
  await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, r.request().url().split('/').pop())) }));
  await localCalls(ctx);
  await localAdmin(ctx);
  await localKeys(ctx);
  await localEstimator(ctx);
  const p = await ctx.newPage();
  p.on('pageerror', e => { throw e; });
  await p.goto(HOSTING + '/' + (page || 'index.html') + ((page || '').indexOf('?') >= 0 ? '&' : '?') + 'testEmail=' + email);
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
    // Home by area (11-5-26): the cards sit under their area, in the area's order.
    assert.deepEqual(await p.$$eval('#tiles a', as => as.map(a => a.dataset.app)), ['plant', 'inventory', 'distribution', 'customers', 'mapmaker', 'routes', 'sales', 'customerlist', 'fuel', 'routecost', 'maint', 'statements', 'udms', 'accident']);
    assert.deepEqual(await p.$$eval('#tiles section.area', s => s.map(x => x.dataset.area + ':' + x.querySelectorAll('a').length)), ['plant:2', 'distribution:4', 'sales:2', 'fleet:3', 'office:1', 'people:2']);
    assert.equal(await p.textContent('#hello'), 'Good to see you, Pat');
    assert.deepEqual(await p.$$eval('#area-menu a', as => as.map(a => a.dataset.area + ' ' + a.querySelector('.area-n').textContent)), ['all 22', 'plant 2', 'distribution 4', 'sales 2', 'fleet 3', 'office 1', 'people 2', 'admin 8']);
    assert.equal(await p.getAttribute('#area-menu a[data-area="all"]', 'aria-current'), 'true', 'Everything shows first');
    assert.ok(!(await p.isVisible('#practice-band')), 'the live hub has no practice band');
    // Joe 11-9-26: the practice hub opens only when picked; administrators pick it at the bottom of Administration.
    assert.equal(await p.getAttribute('#practice-pick a', 'href'), 'https://ud-distribution-sandbox-hub.web.app/?practice=1');
    assert.equal(await p.getAttribute('#tiles a[data-app="plant"]', 'target'), '_blank');
    assert.match(await p.getAttribute('#tiles a[data-app="plant"]', 'href'), /group\.html\?g=plantops$/, 'Plant Operations opens the plant side');
    assert.match(await p.getAttribute('#tiles a[data-app="distribution"]', 'href'), /group\.html\?g=routeops$/, 'Route Distribution opens the distribution side');
    // Joe 11-10-26: Plant Operations asks which plant, with each plant's day beside it, and opens the one picked.
    assert.match(await p.textContent('#tiles a[data-app="plant"] .app-open'), /Pick a plant/);
    await p.click('#tiles a[data-app="plant"]');
    await p.waitForSelector('#plant-box:not([hidden])');
    await p.waitForFunction(() => !/Getting/.test(document.getElementById('plant-list').textContent));
    assert.deepEqual(await p.$$eval('#plant-list .plant-row b', b => b.map(x => x.textContent)), ['Uniontown', 'Charleston', 'Martins Ferry']);
    assert.deepEqual(await p.$$eval('#plant-list .plant-recap', s => s.map(x => x.textContent)), ['No loads today', 'Not running in the app yet', 'Not running in the app yet']);
    assert.match(await p.getAttribute('#plant-list a[data-plant="fac_charleston"]', 'href'), /group\.html\?g=plantops&plant=fac_charleston$/);
    assert.equal(await p.getAttribute('#plant-list a[data-plant="fac_uniontown"]', 'target'), '_blank');
    assert.equal(p.context().pages().length, 1, 'the card itself opened nothing');
    await shot(p, 'hub-plant-pick-1920');
    await p.click('#plant-close');
    assert.ok(await p.isHidden('#plant-box'));
    assert.match(await p.getAttribute('#tiles a[data-app="sales"]', 'href'), /\/sales\.html$/, 'Sales App opens the salespeople\'s own app');
    assert.match(await p.getAttribute('#tiles a[data-app="inventory"]', 'href'), /\/inventory\.html$/, 'Inventory opens the Inventory screen');
    // Joe 11-12-26: the MapMaker's card is under Distribution and opens the map in a new tab.
    assert.match(await p.getAttribute('#tiles a[data-app="mapmaker"]', 'href'), /-map\.web\.app\/$/, 'MapMaker opens the map');
    assert.equal(await p.getAttribute('#tiles a[data-app="mapmaker"]', 'target'), '_blank');
    assert.deepEqual(await p.$$eval('#tiles a strong', s => s.map(x => x.textContent)), ['Plant Operations', 'Inventory', 'Route Distribution', 'Customers & Routes', 'MapMaker', 'Route & Trip Costs', 'Sales App', 'Customer List', 'Fuel Tracking', 'Route Cost Analysis', 'Fleet & Maintenance', 'Customer Statements', 'Employees & Compliance', 'Accident & Injury Reporting']);
    assert.equal(await p.$$eval('#tiles a .app-icon svg', s => s.length), 14, 'every card has its picture');
    await shot(p, 'hub-admin-1920');
    // Pick an area: only its cards show, the address keeps it, and Back goes to Everything.
    await p.click('#area-menu a[data-area="fleet"]');
    await p.waitForSelector('#area-menu a[data-area="fleet"][aria-current]');
    assert.match(p.url(), /#area=fleet$/);
    assert.equal(await p.getAttribute('#area-menu a[data-area="fleet"]', 'aria-current'), 'true');
    assert.ok(await p.isVisible('#tiles a[data-app="fuel"]') && !(await p.isVisible('#tiles a[data-app="routes"]')), 'Route & Trip Costs is under Distribution now');
    assert.ok(!(await p.isVisible('#tiles a[data-app="plant"]')) && !(await p.isVisible('a[data-admin="people"]')), 'other areas are hidden');
    await shot(p, 'hub-area-fleet-1920');
    await p.click('#area-menu a[data-area="admin"]');
    await p.waitForSelector('#area-menu a[data-area="admin"][aria-current]');
    assert.ok(await p.isVisible('a[data-admin="keys"]') && !(await p.isVisible('#tiles a[data-app="fuel"]')));
    assert.deepEqual(await p.$$eval('#admin-tiles .area-group', h => h.map(x => x.textContent)), ['Who gets in', 'Messages and links', 'Plants and connections', 'Numbers from the office']);
    assert.equal(await p.$$eval('a[data-admin="changes"]', a => a.length), 0, 'Customer Changes is in the menu, not on Home');
    await p.click('#area-menu a[data-area="sales"]');
    await p.waitForSelector('#area-menu a[data-area="sales"][aria-current]');
    assert.deepEqual(await p.$$eval('section.area[data-area="sales"] a strong', s => s.map(x => x.textContent)), ['Sales App', 'Customer List']);
    assert.equal(await p.getAttribute('#tiles a[data-app="customerlist"]', 'href'), await p.getAttribute('#tiles a[data-app="customers"]', 'href'), 'Customer List opens Customers & Routes');
    await p.goBack();
    await p.goBack();
    await p.goBack();
    await p.waitForSelector('#area-menu a[data-area="all"][aria-current]');
    assert.ok(await p.isVisible('#tiles a[data-app="plant"]') && await p.isVisible('a[data-admin="people"]'), 'Back to Everything');
    // The practice hub says so at the top, with a link to the live hub.
    p = await open(browser, 'pat.admin@uniteddairy.com', null, 'index.html?practicetest=1');
    await p.waitForSelector('#tiles a');
    assert.match(await p.textContent('#practice-band'), /Practice copy/);
    assert.equal(await p.getAttribute('#practice-band a', 'href'), 'https://ud-distribution-hub.web.app/');
    p = await open(browser, 'pat.admin@uniteddairy.com', { width: 390, height: 844 });
    await p.waitForSelector('#tiles a');
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll on a phone');
    await shot(p, 'hub-admin-390');
    // Joe 11-6-26: All app links lists every phone and tablet link, grouped, and fits a phone.
    await p.click('#all-links');
    await p.waitForSelector('#links-box:not([hidden]) .hub-link');
    assert.deepEqual(await p.$$eval('.hub-link-group h3', h => h.map(x => x.textContent)), ['Everyone', 'Managers', 'Sales', 'Drivers', 'Plant floor', 'Garage & Maintenance', 'Hiring']);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'All app links: no sideways scroll on a phone');
    await shot(p, 'hub-all-links-390');
    await p.click('#links-close');
    assert.ok(await p.isHidden('#links-box'), 'Close shuts All app links');

    assert.ok(await p.isVisible('a[data-admin="people"]'), 'an administrator sees People & Access on Home');
    assert.ok(await p.isVisible('a[data-admin="roles"]'), 'and Roles & Rights');
    assert.ok(await p.isVisible('a[data-admin="links"]'), 'and Links & Codes');
    assert.ok(await p.isVisible('a[data-admin="keys"]'), 'and Keys & Connections');
    assert.ok(await p.isVisible('a[data-admin="email"]'), 'and Email & Texts');
    assert.ok(await p.isVisible('a[data-admin="plant-setup"]'), 'and Plant Setup');
    assert.ok(await p.isVisible('a[data-admin="accounting"]'), 'and Accounting Numbers');
    assert.ok(await p.isVisible('a[data-admin="bol"]'), 'and Daily BOL');

    // People & Access: the list with each person's apps; make Sam a Manager at all plants, then disable and enable again.
    p = await open(browser, 'pat.admin@uniteddairy.com', null, 'people.html');
    await p.waitForSelector('#rows tr[data-email]');
    assert.equal(await p.$$eval('#rows tr[data-email]', r => r.length), 2);
    // Each app is a tick box, ticked for what each person can open now.
    const ticks = (email) => p.$$eval('#rows tr[data-email="' + email + '"] input[data-app]', b => b.map(x => x.dataset.app + (x.checked ? '+' : '-')).join(' '));
    assert.equal(await ticks('sam.sales@uniteddairy.com'), 'operations+ customers+ fuel- udms- routes- routecost- statements- accident+ mapmaker-');
    assert.equal(await ticks('pat.admin@uniteddairy.com'), 'operations+ customers+ fuel+ udms+ routes+ routecost+ statements+ accident+ mapmaker+');
    assert.ok(await p.isDisabled('#rows tr[data-email="pat.admin@uniteddairy.com"] input[data-app="fuel"]'), 'nobody unticks their own apps');
    assert.ok(await p.isDisabled('#rows tr[data-email="sam.sales@uniteddairy.com"] input[data-app="operations"]'), 'Plant & Distribution stays on');
    // Tick Fuel Tracking for Sam: it saves at once, and Sam's Home gets the Fuel card.
    await p.click('#rows tr[data-email="sam.sales@uniteddairy.com"] input[data-app="fuel"]');
    await p.waitForSelector('#list-msg.good');
    assert.match(await p.textContent('#list-msg'), /Sam Sales can now open Fuel Tracking/);
    assert.deepEqual((await db().collection('appAccess').doc('sam.sales@uniteddairy.com').get()).data().apps, ['operations', 'customers', 'fuel', 'accident']);
    assert.equal(await ticks('sam.sales@uniteddairy.com'), 'operations+ customers+ fuel+ udms- routes- routecost- statements- accident+ mapmaker-');
    assert.equal(await p.$eval('#edit', b => b.querySelector('.pblock') === null), true, 'ticking does not open the person');
    // The page scrolls (Joe 11-3-26: "You can't scroll on this screen").
    await p.setViewportSize({ width: 1280, height: 400 });
    await p.evaluate(() => window.scrollTo(0, 300));
    assert.ok(await p.evaluate(() => window.scrollY > 0), 'People & Access scrolls');
    await p.setViewportSize({ width: 1920, height: 1080 });
    await p.click('#rows tr[data-email="sam.sales@uniteddairy.com"] td.who');
    // Joe 11-4-26: the person opens on the whole page; the list is out of the way and the address names them.
    await p.waitForSelector('.people.full #f-role');
    assert.ok(await p.isHidden('#rows'), 'the list steps aside while a person is open');
    assert.match(p.url(), /people\.html\?person=sam\.sales%40uniteddairy\.com/);
    assert.ok(await p.$$eval('#f-role option', o => o.some(x => x.value === 'SALES' && x.textContent === 'Sales')), 'Sales is a role');
    assert.match(await p.textContent('.papps'), /Customers & Routes.*Edit customers and route days/s);
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
    assert.deepEqual((await db().collection('appAccess').doc('sam.sales@uniteddairy.com').get()).data().apps, ['operations', 'customers', 'fuel', 'udms', 'accident'], 'the apps ticked on the person save with Save');
    // What Sam sees in Plant & Distribution: start from the Dispatcher job (it opens Route Distribution), take Sheet
    // Conflicts off, deny one right, then pick the Home screen.
    await p.waitForSelector('#f-job');
    assert.match(await p.textContent('.pblock'), /Nothing is limited yet/);
    await p.selectOption('#f-plant', 'fac_uniontown');
    await p.selectOption('#f-job', 'dispatcher');
    assert.match(await p.textContent('.pblock'), /Not saved yet/);
    assert.ok(await p.isVisible('input[data-keys="conflicts"]'), 'the job opens the areas it ticks');
    await p.uncheck('input[data-keys="conflicts"]');
    assert.ok(await p.isVisible('select[data-right="dispatch.publish"]'), 'single rights are open on the person page');
    assert.ok(await p.isVisible('select[data-right="customers.edit"]'), 'Customers & Routes rights are on the person page');
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
    // Back to everyone (the browser's Back does the same), then add a person.
    await p.click('#f-back');
    await p.waitForSelector('#rows tr[data-email]');
    assert.ok(!/person=/.test(p.url()), 'Back returns to the list');
    await p.goForward();
    await p.waitForSelector('.people.full #f-role');
    assert.equal(await p.textContent('#edit h2'), 'Sam Sales', 'the browser Forward opens Sam again');
    await p.click('#f-back');
    await p.waitForSelector('#rows tr[data-email]');
    await p.click('#add');
    await p.fill('#f-name', 'Robin Driver');
    await p.fill('#f-email', 'robin.driver@uniteddairy.com');
    await p.selectOption('#f-role', 'DRIVER');
    await p.click('#f-save');
    await p.waitForSelector('#f-msg.good');
    assert.equal((await db().collection('users').doc('robin.driver@uniteddairy.com').get()).data().roles[0], 'DRIVER');
    // Joe 11/4: nothing overlaps: a long email stays left of the Role badge, and "Manager + Administrator" left of Plants.
    await db().collection('users').doc('jordan.longaddress-sample@uniteddairy.com').set({ status: 'ACTIVE', roles: ['Manager', 'Administrator'], name: '' });
    for (const width of [1920, 1366, 1100]) {
      p = await open(browser, 'pat.admin@uniteddairy.com', { width, height: 950 }, 'people.html');
      await p.waitForSelector('#rows tr[data-email="jordan.longaddress-sample@uniteddairy.com"]');
      const bad = await p.$$eval('#rows tr[data-email]', rows => rows.flatMap(tr => {
        const r = (sel) => tr.querySelector(sel).getBoundingClientRect(), who = r('td.who .who-in'), roleTd = r('td.c-role'), tag = r('td.c-role .role-tag'), plants = r('td.c-plants');
        const out = [];
        if (who.right > roleTd.left + 1) out.push(tr.dataset.email + ': name or email runs into Role');
        if (tag.right > plants.left + 1 || tag.left < roleTd.left - 1) out.push(tr.dataset.email + ': role runs out of its column');
        return out;
      }));
      assert.deepEqual(bad, [], 'People & Access at ' + width + ': nothing overlaps');
      if (width === 1366) await shot(p, 'hub-people-1366');
    }
    await db().collection('users').doc('jordan.longaddress-sample@uniteddairy.com').delete();
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

    // Links & Codes: Operations' own calls. A release code, the drivers' phone code, a Driver Room station, the no-account switch.
    p = await open(browser, 'pat.admin@uniteddairy.com', null, 'links.html');
    await p.waitForSelector('#part .lc-card');
    assert.equal(await p.$$eval('#parts a', a => a.length), 6);
    assert.equal(await p.textContent('#part h2'), 'Manager links');
    assert.ok(await p.isVisible('#practice'), 'the practice copy says so');
    assert.match(await p.textContent('.lc-card[data-link="company"] .lc-url'), /\/index\.html$/);
    await p.click('button[data-release="fac_uniontown"]');
    await p.waitForSelector('#msg.good');
    const first = await p.textContent('.lc-block code');
    assert.match(first, /^[A-Z0-9]{4,}$/);
    assert.ok((await db().collection('private').doc('releaseCodes').get()).data().fac_uniontown.hash, 'saved where Operations keeps it');
    await p.click('button[data-release="fac_uniontown"]');
    assert.match(await p.textContent('button[data-release="fac_uniontown"]'), /Press again to replace/);
    assert.equal(await p.textContent('.lc-block code'), first, 'one press changes nothing');
    await p.click('button[data-release="fac_uniontown"]');
    await p.waitForFunction((c) => document.querySelector('.lc-block code') && document.querySelector('.lc-block code').textContent !== c, first);
    await shot(p, 'hub-links-1920');
    // The Driver Room and the drivers' phones.
    await p.click('#parts a[data-part="drivers"]');
    await p.waitForFunction(() => document.querySelector('#part h2').textContent === 'Driver Room & phones');
    assert.match(p.url(), /part=drivers/);
    assert.match(await p.textContent('#part [data-kind="KIOSK"]'), /Driver Room Check-In Station/);
    await p.click('button[data-route="new"]');
    await p.waitForSelector('.lc-card[data-link="route"] .pill.good');
    assert.equal((await db().collection('config').doc('routePhone').get()).data().enabled, true);
    await p.click('button[data-route="off"]');
    await p.click('button[data-route="off"]');
    await p.waitForSelector('.lc-card[data-link="route"] .pill.bad');
    assert.equal((await db().collection('config').doc('routePhone').get()).data().enabled, false);
    await p.fill('[data-kind="KIOSK"] [data-new-name]', 'Driver Room TV 2');
    await p.selectOption('[data-kind="KIOSK"] [data-new-type]', 'TV');
    await p.click('button[data-add="KIOSK"]');
    await p.waitForFunction(() => /Driver Room TV 2/.test(document.querySelector('[data-kind="KIOSK"]').textContent));
    const tv = await p.$$eval('[data-kind="KIOSK"] .lc-row', rows => rows.find(r => /Driver Room TV 2/.test(r.textContent)).querySelector('button[data-code]').dataset.code);
    await p.click('button[data-code="' + tv + '"]');
    await p.waitForFunction((k) => /New code for Driver Room TV 2/.test(document.querySelector('#msg').textContent), tv);
    await shot(p, 'hub-links-drivers-1920');
    await p.click('button[data-remove="' + tv + '"]');
    await p.click('button[data-remove="' + tv + '"]');
    await p.waitForFunction(() => !/Driver Room TV 2/.test(document.querySelector('[data-kind="KIOSK"]').textContent));
    // The Plant Station with no United Dairy account: Off until turned On.
    await p.click('#parts a[data-part="plant"]');
    await p.waitForSelector('.lc-card[data-link="public"] .pill.bad');
    await p.click('button[data-noaccount="on"]');
    await p.waitForSelector('.lc-card[data-link="public"] .pill.good');
    assert.equal((await db().collection('private').doc('stations').get()).data().noAccount.fac_uniontown, true);
    p = await open(browser, 'pat.admin@uniteddairy.com', { width: 390, height: 844 }, 'links.html?part=garage');
    await p.waitForSelector('#part [data-kind="GARAGE"]');
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Links & Codes: no sideways page scroll on a phone');
    await shot(p, 'hub-links-390');

    // Keys & Connections: Operations' own calls; a key is saved where it always was and never comes back to the page.
    await db().collection('private').doc('mocreo').set({ apiKey: 'made-up-key-0000-1234', assetId: 'asset-77', savedAt: '2026-10-01T12:00:00Z', savedBy: 'pat.admin@uniteddairy.com' });
    p = await open(browser, 'pat.admin@uniteddairy.com', null, 'keys.html');
    await p.waitForSelector('.key-card[data-key="mocreo"]');
    assert.equal(await p.$$eval('.key-card', c => c.length), 6);
    // HERE has its own card, asked through the Route Estimator's call with provider here (PC Miler's asks with none).
    await p.waitForSelector('.key-card[data-key="here"] .pill');
    assert.match(await p.textContent('.key-card[data-key="here"]'), /HERE \(Route & Trip: miles, drive time, tolls and addresses\)[\s\S]*Not set up/);
    assert.ok(estimatorAsked.some(d => d.area === 'key' && d.provider === 'here' && d.op === 'status'), 'the HERE card asks for provider here');
    assert.ok(estimatorAsked.some(d => d.area === 'key' && !d.provider && d.op === 'status'), 'the PC Miler card still asks as before');
    const mocreo = await p.textContent('.key-card[data-key="mocreo"]');
    assert.match(mocreo, /ends in 1234/);
    assert.ok(mocreo.indexOf('made-up-key') < 0 && (await p.content()).indexOf('made-up-key') < 0, 'the saved key never reaches the page');
    assert.match(await p.textContent('.key-card[data-key="gps"]'), /Not set up/);
    // Save a Verizon Connect sign-in: it lands in private/gpsFleet, as Operations' GPS Setup saves it.
    await p.click('.key-card[data-key="gps"] summary');
    await p.fill('.key-card[data-key="gps"] [data-field="fleet"]', 'madeupfleet');
    await p.fill('.key-card[data-key="gps"] [data-field="user"]', 'made.up.user');
    await p.fill('.key-card[data-key="gps"] [data-field="password"]', 'made-up-password');
    await p.click('.key-card[data-key="gps"] [data-act="save"]');
    await p.waitForSelector('#msg.good');
    const fleet = (await db().collection('private').doc('gpsFleet').get()).data();
    assert.deepEqual([fleet.user, fleet.password, fleet.savedBy], ['made.up.user', 'made-up-password', 'pat.admin@uniteddairy.com']);
    assert.ok((await p.content()).indexOf('made-up-password') < 0, 'the password box is emptied once saved');
    // Test Connection answers in plain words (nothing reaches the outside in the tests).
    await p.click('.key-card[data-key="mocreo"] [data-act="test"]');
    await p.waitForSelector('#msg.bad');
    assert.match(await p.textContent('#msg'), /MOCREO/);
    assert.match(await p.textContent('.key-card[data-key="mocreo"] .key-test'), /Test failed/);
    await shot(p, 'hub-keys-1920');
    // Remove key needs a second press.
    await p.click('.key-card[data-key="mocreo"] [data-act="clear"]');
    assert.ok((await db().collection('private').doc('mocreo').get()).data().apiKey, 'one press removes nothing');
    await p.click('.key-card[data-key="mocreo"] [data-act="clear"]');
    await p.waitForFunction(() => /key removed/.test(document.querySelector('#msg').textContent));
    assert.equal((await db().collection('private').doc('mocreo').get()).data().apiKey, undefined);
    p = await open(browser, 'pat.admin@uniteddairy.com', { width: 390, height: 844 }, 'keys.html');
    await p.waitForSelector('.key-card[data-key="sms"]');
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Keys: no sideways page scroll on a phone');
    await shot(p, 'hub-keys-390');

    // Accounting Numbers (Joe 11-6-26): a made-up accounting zip added by hand lands in accountingMonthly, the email box saves
    // by itself, and Check Email Now answers in plain words (Gmail is never reached in the tests).
    const zipPath = path.join(require('os').tmpdir(), 'plcomparisonsmadeup.zip');
    fs.writeFileSync(zipPath, await require('../../../../functions/test/fixtures/accounting-zip').septemberZip());
    p = await open(browser, 'pat.admin@uniteddairy.com', null, 'accounting.html');
    await p.waitForSelector('#pick');
    assert.match(await p.textContent('#months'), /No months yet/);
    assert.ok(await p.isDisabled('#check'), 'no mailbox yet, so Check Email Now is gray');
    await p.setInputFiles('#file', zipPath);
    await p.waitForSelector('#msg.good');
    assert.match(await p.textContent('#msg'), /2 months read from plcomparisonsmadeup\.zip \(newest Sep 2026\)/);
    assert.deepEqual(await p.$$eval('.acc-table tbody tr td:first-child', t => t.map(x => x.textContent)), ['Sep 2026', 'Aug 2026']);
    assert.match(await p.textContent('.acc-table tbody tr'), /\$600,000\.00/);
    assert.equal((await db().collection('accountingMonthly').doc('2026-09').get()).data().gallons_sold, 2100000);
    await p.fill('#mailbox', 'pat.sample@uniteddairy.com');
    await p.check('#enabled');
    await p.waitForFunction(() => /every morning at 6:00 AM/.test(document.querySelector('#mail').textContent));
    assert.deepEqual(((await db().collection('config').doc('accountingMail').get()).data() || {}).mailbox, 'pat.sample@uniteddairy.com');
    await p.click('#check');
    await p.waitForFunction(() => /Last checked/.test(document.querySelector('#mail').textContent) && !/CHECKING/.test(document.querySelector('#mail').textContent));
    assert.match(await p.textContent('#mail .acc-bad'), /Gmail is not reached/);
    // Weekly route report (Joe 11-6-26): a made-up report added by hand lands in routeWeekly for Route Cost Analysis; the label
    // starts as Joe's, and the mailbox and tick save by themselves.
    const weekPath = path.join(require('os').tmpdir(), 'Weekly Daily Avg Cases By Route.xls');
    fs.writeFileSync(weekPath, require('../../../../functions/test/fixtures/route-report').routeReport());
    await p.waitForSelector('#wk-pick');
    assert.match(await p.textContent('#weeks'), /No weeks yet/);
    assert.equal(await p.inputValue('#wk-label'), 'ROUTES/SALE BY ROUTE');
    assert.ok(await p.isDisabled('#wk-check'), 'no mailbox yet, so Check Email Now is gray');
    await p.setInputFiles('#wk-file', weekPath);
    await p.waitForSelector('#wk-msg.good');
    assert.match(await p.textContent('#wk-msg'), /Week ending 10-31-26 read from Weekly Daily Avg Cases By Route\.xls: 2 routes, 4 stops/);
    assert.match(await p.textContent('#wk-table tbody tr'), /10-31-26.*146.*\$3,895\.75/);
    assert.equal((await db().collection('routeWeekly').doc('2026-10-31').get()).data().stops.length, 4);
    await p.fill('#wk-mailbox', 'pat.sample@uniteddairy.com');
    await p.check('#wk-enabled');
    await p.waitForFunction(() => /every day at 2:00 PM/.test(document.querySelector('#weeks').textContent));
    assert.equal(((await db().collection('config').doc('routeReportMail').get()).data() || {}).enabled, true);
    await shot(p, 'hub-accounting-1920');
    p = await open(browser, 'pat.admin@uniteddairy.com', { width: 1536, height: 790 }, 'accounting.html');
    await p.waitForSelector('.acc-table');
    await shot(p, 'hub-accounting-1536');
    p = await open(browser, 'pat.admin@uniteddairy.com', { width: 390, height: 844 }, 'accounting.html');
    await p.waitForSelector('.acc-table');
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Accounting: no sideways page scroll on a phone');
    await shot(p, 'hub-accounting-390');
    p = await open(browser, 'sam.sales@uniteddairy.com', null, 'accounting.html');
    await p.waitForSelector('#error:not([hidden])');

    // Daily BOL (Joe 11-6-26): a made-up Daily Load By Route PDF added by hand lands in bolDays, the label starts as
    // ROUTES/BOL, the mailbox saves by itself, and Check Email Now answers in plain words (Gmail is never reached in the tests).
    const bolPath = path.join(require('os').tmpdir(), 'Daily Load UT.pdf');
    fs.writeFileSync(bolPath, require('../../../../functions/test/fixtures/bol-pdf').samplePdf());
    p = await open(browser, 'pat.admin@uniteddairy.com', null, 'bol.html');
    await p.waitForSelector('#pick');
    assert.match(await p.textContent('#days'), /NO BOL YET/);
    assert.equal(await p.inputValue('#label'), 'ROUTES/BOL');
    assert.ok(await p.isDisabled('#check'), 'no mailbox yet, so Check Email Now is gray');
    await p.setInputFiles('#file', bolPath);
    await p.waitForSelector('#msg.good');
    assert.match(await p.textContent('#msg'), /LOAD DAY 11-9-26: 2 ROUTES, 3 CUSTOMERS READ FROM Daily Load UT\.pdf/);
    // Joe 11-8-26: one line per load day (its date, routes, customers, quantity, file), no routes or customers list.
    assert.deepEqual(await p.$$eval('.bol-days tbody tr', t => t.map(r => [...r.cells].slice(0, 4).map(c => c.textContent))), [['MONDAY 11-9-26', '2', '3', '606']]);
    assert.equal(await p.$$eval('.bol-routes, .bol-route, .bol-stops', t => t.length), 0, 'no routes list');
    assert.ok(!/ROUTES ON/.test(await p.textContent('#days')), 'no ROUTES ON section');
    assert.equal((await db().collection('bolDays').doc('2026-11-09').get()).data().totals.qty, 606);
    await p.fill('#mailbox', 'pat.sample@uniteddairy.com');
    await p.check('#enabled');
    await p.waitForFunction(() => /EVERY HOUR FOR A NEW BOL/.test(document.querySelector('#mail').textContent));
    assert.equal(((await db().collection('config').doc('bolMail').get()).data() || {}).mailbox, 'pat.sample@uniteddairy.com');
    await p.click('#check');
    await p.waitForFunction(() => /LAST CHECKED/.test(document.querySelector('#mail').textContent) && !/CHECKING/.test(document.querySelector('#mail').textContent));
    assert.match(await p.textContent('#mail .acc-bad'), /Gmail is not reached/);
    await shot(p, 'hub-bol-1920');
    p = await open(browser, 'pat.admin@uniteddairy.com', { width: 1536, height: 790 }, 'bol.html');
    await p.waitForSelector('.bol-days');
    await shot(p, 'hub-bol-1536');
    p = await open(browser, 'pat.admin@uniteddairy.com', { width: 390, height: 844 }, 'bol.html');
    await p.waitForSelector('.bol-days');
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Daily BOL: no sideways page scroll on a phone');
    await shot(p, 'hub-bol-390');
    p = await open(browser, 'sam.sales@uniteddairy.com', null, 'bol.html');
    await p.waitForSelector('#error:not([hidden])');

    // Email & Texts: Operations' own email settings, saved where Administration saves them. Sending stays Off in the tests.
    await db().collection('private').doc('emailSettings').set({ sending: false });
    p = await open(browser, 'pat.admin@uniteddairy.com', null, 'email.html');
    await p.waitForSelector('#part .em-log');
    assert.equal(await p.$$eval('#parts a', a => a.length), 7);
    assert.match(await p.textContent('#part'), /Sending is Off/);
    assert.match(await p.textContent('#part'), /No email has been sent/);
    // Turning Sending on needs a second press; turn it back off the same way.
    await p.click('[data-act="sending-on"]');
    assert.ok(!(((await db().collection('private').doc('emailSettings').get()).data() || {}).sending), 'one press changes nothing');
    await p.click('[data-act="sending-on"]');
    await p.waitForSelector('[data-act="sending-off"]');
    assert.equal((await db().collection('private').doc('emailSettings').get()).data().sending, true);
    await p.click('[data-act="sending-off"]');
    await p.click('[data-act="sending-off"]');
    await p.waitForSelector('[data-act="sending-on"]');
    assert.equal((await db().collection('private').doc('emailSettings').get()).data().sending, false);
    await shot(p, 'hub-email-1920');
    // Plant Report: add a group, change it by leaving its box, then remove it (two presses).
    await p.click('#parts a[data-part="reports"]');
    await p.waitForSelector('#plant-pick:not([hidden]) #plant:has(option)');
    assert.match(p.url(), /part=reports/);
    await p.fill('#new-name', 'Plant Management');
    await p.fill('#new-to', 'lee.example@uniteddairy.com');
    await p.click('[data-act="group-add"]');
    await p.waitForSelector('input[data-group="Plant Management"]');
    await p.fill('input[data-group="Plant Management"]', 'lee.example@uniteddairy.com, kim.example@uniteddairy.com');
    await p.press('input[data-group="Plant Management"]', 'Tab');
    await p.waitForFunction(() => document.querySelector('#msg').textContent === 'Saved.');
    const group = (await db().collection('reportGroups').where('name', '==', 'Plant Management').get()).docs[0].data();
    assert.deepEqual([group.facilityId, group.recipients, group.updatedBy], ['fac_uniontown', ['lee.example@uniteddairy.com', 'kim.example@uniteddairy.com'], 'pat.admin@uniteddairy.com']);
    await p.fill('input[data-group="Plant Management"]', 'not an address');
    await p.press('input[data-group="Plant Management"]', 'Tab');
    await p.waitForSelector('#msg.bad');
    assert.match(await p.textContent('#msg'), /Not an email address/);
    await p.click('[data-remove="Plant Management"]');
    await p.click('[data-remove="Plant Management"]');
    await p.waitForFunction(() => !document.querySelector('input[data-group]'));
    // Repair Email: an address and how often save when they are left or picked.
    await p.click('#parts a[data-part="repairs"]');
    await p.waitForSelector('[data-lessor="PENSKE"] [data-emails]');
    assert.ok(await p.isHidden('#plant-pick'), 'repair email is for every plant');
    await p.fill('[data-lessor="PENSKE"] [data-emails]', 'service@penske.example.com');
    await p.press('[data-lessor="PENSKE"] [data-emails]', 'Tab');
    await p.waitForFunction(() => document.querySelector('#msg').textContent === 'Saved.');
    await p.selectOption('[data-lessor="PENSKE"] [data-mode]', 'DAILY');
    const repairMode = async () => (((await db().collection('private').doc('repairEmail').get()).data() || {}).routes || {}).PENSKE;
    for (let i = 0; i < 50 && ((await repairMode()) || {}).mode !== 'DAILY'; i++) await new Promise(r => setTimeout(r, 100));
    // Who Email Comes From: a plant's address must be a United Dairy one; the red line says why.
    await p.click('#parts a[data-part="senders"]');
    await p.waitForSelector('[data-plant="fac_uniontown"] [data-addr]');
    await p.fill('[data-plant="fac_uniontown"] [data-addr]', 'someone@example.com');
    await p.press('[data-plant="fac_uniontown"] [data-addr]', 'Tab');
    await p.waitForSelector('#msg.bad');
    assert.match(await p.textContent('#msg'), /not a United Dairy email address/);
    await p.fill('[data-plant="fac_uniontown"] [data-addr]', 'uniontown.plant@uniteddairy.com');
    await p.press('[data-plant="fac_uniontown"] [data-addr]', 'Tab');
    await p.waitForSelector('#msg.good');
    assert.equal((await db().collection('private').doc('emailSettings').get()).data().senders.fac_uniontown.address, 'uniontown.plant@uniteddairy.com');
    // Texts to Drivers: no Twilio account yet, so Turn On waits for one and says where to set it up.
    await p.click('#parts a[data-part="texts"]');
    await p.waitForSelector('[data-act="done-on"]');
    assert.ok(await p.isDisabled('[data-act="done-on"]'));
    assert.match(await p.textContent('#part'), /Keys & Connections/);
    p = await open(browser, 'pat.admin@uniteddairy.com', null, 'email.html?part=repairs');
    await p.waitForSelector('[data-lessor="PENSKE"] [data-emails]');
    assert.equal(await p.inputValue('[data-lessor="PENSKE"] [data-emails]'), 'service@penske.example.com');
    assert.equal(await p.inputValue('[data-lessor="PENSKE"] [data-mode]'), 'DAILY');
    p = await open(browser, 'pat.admin@uniteddairy.com', { width: 390, height: 844 }, 'email.html?part=senders');
    await p.waitForSelector('[data-plant] [data-addr]');
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Email & Texts: no sideways page scroll on a phone');
    await shot(p, 'hub-email-390');
    // Plant Setup: each set-up screen opens in Plant & Distribution on the plant picked.
    p = await open(browser, 'pat.admin@uniteddairy.com', null, 'plant-setup.html');
    await p.waitForSelector('.lc-card[data-page="shifts.html"] a');
    assert.equal(await p.$$eval('.lc-card', c => c.length), 7);
    assert.match(await p.getAttribute('.lc-card[data-page="shifts.html"] a', 'href'), /\/shifts\.html$/);
    await p.selectOption('#plant', 'fac_charleston');
    assert.match(await p.getAttribute('.lc-card[data-page="crew.html?view=setup"] a', 'href'), /\/crew\.html\?view=setup&plant=fac_charleston$/);
    assert.match(await p.textContent('.lc-card[data-page="uploads.html"] a'), /Open for Charleston/);
    assert.equal(await p.getAttribute('.lc-card[data-page="uploads.html"] a', 'target'), '_blank');
    await shot(p, 'hub-plant-setup-1920');
    p = await open(browser, 'pat.admin@uniteddairy.com', { width: 390, height: 844 }, 'plant-setup.html');
    await p.waitForSelector('.lc-card a');
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Plant Setup: no sideways page scroll on a phone');
    await shot(p, 'hub-plant-setup-390');
    // Customer Changes (Joe 11-9-26): a change sent from an app waits here; approve one, turn one down with a reason.
    const H = require('../../src/hub');
    const sent = (summary) => H.hubCall(db(), { email: 'sam.sales@uniteddairy.com' }, { op: 'sendChange', plant: 'fac_uniontown', from: 'pallet-builder', kind: 'routeDay',
      route: '844', day: 'TUE', input: { op: 'saveRouteDay', route: '844', day: 'TUE', stops: [] }, summary });
    const one = await sent('Route 844 Tuesday: Maple Market loads second'), two = await sent('Route 844 Tuesday: Oak Corner first');
    p = await open(browser, 'pat.admin@uniteddairy.com', null, 'changes.html');
    await p.waitForSelector('#open .lc-card[data-change="' + one.id + '"]');
    assert.equal(await p.$$eval('#open .lc-card', c => c.length), 2);
    assert.match(await p.textContent('#open .lc-card[data-change="' + one.id + '"]'), /Pallet Builder.*sam\.sales@uniteddairy\.com/s);
    await shot(p, 'hub-changes-1920');
    await p.click('[data-approve="' + one.id + '"]');
    await p.waitForSelector('#done .lc-card[data-change="' + one.id + '"]');
    assert.match(await p.textContent('#done .lc-card[data-change="' + one.id + '"]'), /Approved by pat\.admin@uniteddairy\.com/);
    await p.click('[data-down="' + two.id + '"]');
    await p.waitForSelector('#error:not([hidden])');
    assert.match(await p.textContent('#error'), /Say why/);
    await p.fill('#why-' + two.id, 'Oak Corner moved to 803');
    await p.click('[data-down="' + two.id + '"]');
    await p.waitForSelector('#done .lc-card[data-change="' + two.id + '"]');
    assert.match(await p.textContent('#open'), /Nothing is waiting/);
    p = await open(browser, 'pat.admin@uniteddairy.com', { width: 390, height: 844 }, 'changes.html');
    await p.waitForSelector('#done .lc-card');
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Customer Changes: no sideways page scroll on a phone');
    await shot(p, 'hub-changes-390');
    p = await open(browser, 'sam.sales@uniteddairy.com', null, 'changes.html');
    await p.waitForSelector('#error:not([hidden])');
    assert.match(await p.textContent('#error'), /Only an administrator/);
    p = await open(browser, 'sam.sales@uniteddairy.com', null, 'plant-setup.html');
    await p.waitForSelector('#error:not([hidden])');
    assert.match(await p.textContent('#error'), /Only an administrator/);
    assert.equal(await p.$$eval('.lc-card', c => c.length), 0);
    p = await open(browser, 'sam.sales@uniteddairy.com', null, 'email.html');
    await p.waitForSelector('#error:not([hidden])');
    assert.match(await p.textContent('#error'), /Only an administrator/);

    p = await open(browser, 'sam.sales@uniteddairy.com');
    await p.waitForSelector('#tiles a');
    assert.deepEqual(await p.$$eval('#tiles a', as => as.map(a => a.dataset.app)), ['plant', 'inventory', 'distribution', 'customers', 'sales', 'customerlist', 'fuel', 'maint', 'udms', 'accident'], 'Sam\'s Home shows the apps ticked for Sam');
    assert.deepEqual(await p.$$eval('#area-menu a', as => as.map(a => a.dataset.area)), ['all', 'plant', 'distribution', 'sales', 'fleet', 'people'], 'no Administration area for Sam');
    assert.ok(!(await p.isVisible('a[data-admin="people"]')), 'someone who is not an administrator does not see Administration');
    p = await open(browser, 'sam.sales@uniteddairy.com', null, 'keys.html');
    await p.waitForSelector('#error:not([hidden])');
    assert.equal(await p.$$eval('.key-card', c => c.length), 0, 'someone else is not shown even which keys are saved');
    p = await open(browser, 'sam.sales@uniteddairy.com', null, 'links.html');
    await p.waitForSelector('#error:not([hidden])');
    assert.match(await p.textContent('#error'), /Only an administrator/);
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
