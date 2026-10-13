'use strict';
/*
 * Browser check of review items 56-58 (Joe 10/13):
 *  56. no text on the screen under 16px (the header line, the Test copy badge, the initials and the page's base text included),
 *      and no sideways page scroll at Joe's 1536 and at 1920 (Weekly Dispatch's day boxes still shrink a long name to fit);
 *  57. the buttons on Daily, Drivers, Manager Center, Issues, Reports and the stations are words only, and the side menu has
 *      no ▸ or ↗ (the ◀ ▶ date arrows stay);
 *  58. Operational Assignments, Latest write-ups, MOCREO Thermometers, the Down Trucks / Route Run Days lists and the
 *      Dispatch Settings tables keep their header row in place while they scroll.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const ADMIN = 'testEmail=admin.test@uniteddairy.com';
const D = PD.PLANT_DATE;
const ICONS = /[⎙↻✎✉⧉🚛▣📊✔⏳▸↗]/u;

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block' });
  await page.clock.setFixedTime(new Date('2026-10-08T14:00:00Z'));
  await localCalls(page);
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + '/' + url + (url.includes('?') ? '&' : '?') + ADMIN);
  await page.waitForSelector('#screen:not([hidden])');
  await page.waitForTimeout(1500);
  page.errors = errors;
  return page;
}

// Visible words under 16px (Weekly's day boxes may shrink a name to fit, item 3).
const smallText = (page) => page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => {
  if (!el.offsetWidth || !el.offsetHeight || el.closest('.weekly-page td.day')) return false;
  if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return false;
  return parseFloat(getComputedStyle(el).fontSize) < 15.9;
}).map(el => el.tagName + '.' + el.className + ' ' + getComputedStyle(el).fontSize + ' "' + el.textContent.trim().slice(0, 30) + '"').slice(0, 10));

const PAGES = [
  ['daily.html?date=' + D, true], ['weekly.html?week=2026-10-04', false], ['drivers.html', true], ['manager.html', true],
  ['issues.html', true], ['reports.html', true], ['ops.html', false], ['mocreo.html', false], ['settings.html', false],
];

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1536, 864], [1920, 1080]]) {
      for (const [url, words] of PAGES) {
        const page = await openPage(browser, w, h, url);
        const name = url.split('.')[0];
        assert.deepEqual(await smallText(page), [], name + ' ' + w + ': no text under 16px');
        const sizes = await page.evaluate(() => ['.brand small', '.test-copy-badge', '.topbar .who'].map(s => document.querySelector(s))
          .filter(e => e && e.offsetWidth).map(e => parseFloat(getComputedStyle(e).fontSize)));
        assert.ok(sizes.length >= 2 && sizes.every(s => s >= 16), name + ': header line, Test copy badge and initials are 16px: ' + sizes);
        assert.ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth + 1), name + ' ' + w + ': no sideways scroll');
        // The top line's controls stay inside the screen (nothing hidden past the right edge).
        const past = await page.evaluate(() => [...document.querySelectorAll('.head *')].filter(e => e.offsetWidth && !e.closest('[hidden], .modal'))
          .filter(e => e.getBoundingClientRect().right > innerWidth + 1).map(e => e.id || e.className));
        assert.deepEqual(past, [], name + ' ' + w + ': the top line fits');
        if (words) {
          const icons = await page.$$eval('button, a.button, .mc-bar', b => b.filter(x => x.offsetWidth).map(x => x.textContent.trim()));
          assert.deepEqual(icons.filter(t => ICONS.test(t)), [], name + ': buttons are words only');
        }
        const menu = await page.evaluate(() => { const m = document.querySelector('.sidemenu'); return m ? [m.querySelectorAll('i').length, m.textContent] : [0, '']; });
        assert.equal(menu[0], 0, name + ': no icon marks in the side menu');
        assert.ok(!/[▸↗]/.test(menu[1]), name + ': no ▸ or ↗ in the side menu');
        assert.deepEqual(page.errors, [], name + ' has no page errors');
        if (w === 1536) {
          // Item 58: the header rows stick.
          const sticky = { ops: 'table.ops thead th', settings: 'table.set thead th', mocreo: '.mc-table thead th', daily: '.down-list thead th', weekly: '.down-list thead th' }[name];
          // Weekly's Route Run Days list draws its day headings when it opens; one is put in to read its style.
          if (name === 'weekly') await page.evaluate(() => { const tr = document.getElementById('days-heads'); if (!tr.querySelector('th')) tr.insertAdjacentHTML('beforeend', '<th>Sun</th>'); });
          if (sticky) assert.equal(await page.$eval(sticky, th => getComputedStyle(th).position), 'sticky', name + ': ' + sticky + ' stays put');
        }
        await page.close();
      }
    }
    results.push('Daily, Weekly, Drivers, Manager Center, Issues, Reports, Operational Assignments, MOCREO and Dispatch Settings at 1536 and 1920: no text under 16px, header line 16px, no sideways scroll, top line fits');
    results.push('Daily, Drivers, Manager Center, Issues and Reports: buttons are words only; the side menu has no ▸ or ↗');

    // Item 58 in use: the Down Trucks list and Operational Assignments keep the heading row on top after scrolling.
    const daily = await openPage(browser, 1536, 500, 'daily.html?date=' + D);
    await daily.click('#open-down');
    const stuck = await daily.evaluate(() => {
      const list = document.querySelector('#down-panel .down-list'), body = document.getElementById('down-rows');
      for (let i = 0; i < 30; i++) body.insertAdjacentHTML('beforeend', '<tr><td>9' + i + '</td><td>Truck</td><td>Test</td><td>-</td><td></td></tr>');
      list.scrollTop = 400;
      return Math.abs(list.querySelector('thead th').getBoundingClientRect().top - list.getBoundingClientRect().top) <= 2;
    });
    assert.ok(stuck, 'the Down Trucks heading row stays at the top of its list');
    await daily.close();
    const ops = await openPage(browser, 1536, 500, 'ops.html');
    const opsStuck = await ops.evaluate(() => {
      const body = document.getElementById('rows');
      for (let i = 0; i < 30; i++) body.insertAdjacentHTML('beforeend', '<tr><td>Test ' + i + '</td><td></td><td></td><td></td></tr>');
      const scroller = document.querySelector('.side-main') || document.scrollingElement;
      scroller.scrollTop = 600;
      const th = document.querySelector('table.ops thead th').getBoundingClientRect().top;
      return [Math.round(th), Math.round(scroller.getBoundingClientRect ? scroller.getBoundingClientRect().top : 0), scroller.scrollTop];
    });
    assert.ok(opsStuck[2] > 0 && Math.abs(opsStuck[0] - opsStuck[1]) <= 2, 'Operational Assignments keeps its heading row on top: ' + opsStuck);
    await ops.close();
    results.push('Down Trucks / Trailers and Operational Assignments keep their heading row in place while scrolled');

    // Stations at a phone and a tablet: 16px text, words-only buttons, no sideways scroll.
    for (const [w, h] of [[390, 844], [1024, 768]]) {
      for (const url of ['driver-station.html', 'plant-station.html']) {
        const page = await openPage(browser, w, h, url);
        assert.deepEqual(await smallText(page), [], url + ' ' + w + ': no text under 16px');
        assert.ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth + 1), url + ' ' + w + ': no sideways scroll');
        const icons = await page.$$eval('button, a.button', b => b.filter(x => x.offsetWidth).map(x => x.textContent.trim()));
        assert.deepEqual(icons.filter(t => ICONS.test(t)), [], url + ': buttons are words only');
        await page.close();
      }
    }
    results.push('Driver Station and Plant Station at 390 and 1024: no text under 16px, words-only buttons, no sideways scroll');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('UI FLOOR ' + r));
})().catch(e => { console.error(e); process.exit(1); });
