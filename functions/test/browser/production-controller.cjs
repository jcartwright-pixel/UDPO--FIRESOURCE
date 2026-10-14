'use strict';
/*
 * Browser check of the Blow Mold's machine readings (Joe 10/14): the jug count, speed and temperature read from the machine's
 * own controller, READ-ONLY, end to end:
 *   - Line Targets: Counted by Machine controller; brand, IP address and where each reading is, each box saved as it is left;
 *     the line key; Test read shows the number the line PC read;
 *   - the line PC program (tools/device-bridge, --controller) reading a pretend Modbus controller on this computer;
 *   - the Blow Mold tablet: From the machine with the jug count, speed and temperature, red outside the range;
 *   - Production Lines: the readings on the card, and the line's shift view with the hour by hour.
 * Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');

const HOSTING = 'http://127.0.0.1:5000';
const DOOR = 'http://127.0.0.1:5001/demo-ud-distribution/us-east4/deviceReads';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const ADMIN = 'testEmail=admin.test@uniteddairy.com';
const BLOW = 'ut_prod_blow_mold';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, timezoneId: 'America/New_York' });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); }
async function fits(page, what) {
  const size = await page.evaluate(() => ({ scroll: document.scrollingElement.scrollWidth, inner: window.innerWidth }));
  assert.ok(size.scroll <= size.inner, what + ' has no sideways scrolling: ' + JSON.stringify(size));
}
async function bigText(page, sel, what) {
  const small = await page.$$eval(sel, els => els.flatMap(e => [e, ...e.querySelectorAll('*')]).filter(e => e.offsetParent && e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
    .map(e => [e.tagName + '.' + e.className, parseFloat(getComputedStyle(e).fontSize)]).filter(x => x[1] < 16));
  assert.deepEqual(small, [], what + ': text 16px or larger');
}
const lineDoc = async () => (await db().collection('productionLines').doc(BLOW).get()).data() || {};
async function until(what, fn) {
  for (let i = 0; i < 150; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 200)); }
  throw new Error('Timed out waiting for ' + what);
}

// A pretend Modbus controller: holding registers 0-1 the jug count (32 bits), 10 the speed, 11 the temperature in tenths.
// It answers read requests only; anything else is refused and remembered, so the test can show nothing was ever written.
function controller() {
  const regs = { 0: 19, 1: 39978, 10: 70, 11: 4312 }, writes = [];
  const server = net.createServer(sock => {
    let buf = Buffer.alloc(0);
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 12) {
        const id = buf.readUInt16BE(0), unit = buf[6], fc = buf[7], addr = buf.readUInt16BE(8), qty = buf.readUInt16BE(10);
        buf = buf.subarray(12);
        if (fc !== 3 && fc !== 4) { writes.push(fc); sock.write(Buffer.from([id >> 8, id & 255, 0, 0, 0, 3, unit, fc | 0x80, 1])); continue; }
        const out = Buffer.alloc(9 + qty * 2);
        out.writeUInt16BE(id, 0); out.writeUInt16BE(3 + qty * 2, 4); out[6] = unit; out[7] = fc; out[8] = qty * 2;
        for (let i = 0; i < qty; i++) out.writeUInt16BE(regs[addr + i] || 0, 9 + i * 2);
        sock.write(out);
      }
    });
    sock.on('error', () => {});
  });
  // The machine makes about 40 jugs every 5 seconds.
  const jugs = setInterval(() => { let n = regs[0] * 65536 + regs[1] + 8; regs[0] = Math.floor(n / 65536); regs[1] = n % 65536; }, 1000);
  return new Promise(res => server.listen(0, '127.0.0.1', () => res({ port: server.address().port, regs, writes, close: () => { clearInterval(jugs); server.close(); } })));
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date() });
  const plc = await controller();
  const browser = await chromium.launch();
  const results = [];
  let bridge = null;
  try {
    // Line Targets: Counted by Machine controller, then the setup one box at a time.
    const lt = await openPage(browser, 1536, 960, '/linetargets.html?line=' + BLOW + '&' + ADMIN);
    await lt.waitForFunction(() => document.getElementById('form-title').textContent === 'BLOW MOLD');
    assert.equal(await lt.isVisible('#controller'), false, 'no controller box on a typed line');
    await lt.selectOption('#counter', 'CONTROLLER');
    await until('Counted by saved', async () => (await lineDoc()).counter === 'CONTROLLER');
    await lt.waitForSelector('#controller:not([hidden]) [data-c="brand"]');
    assert.equal(await lt.inputValue('#controller [data-c="brand"]'), '', 'the brand starts blank');
    assert.equal(await lt.textContent('#counter-pill'), 'Counts from the machine');
    assert.match(await lt.textContent('#controller'), /Speed is called \(empty = Annealer speed\)/, 'Joe 10/14: the Blow Mold\'s speed is the annealer speed');
    await lt.selectOption('#controller [data-c="brand"]', 'MODBUS');
    await until('brand saved', async () => ((await lineDoc()).controller || {}).brand === 'MODBUS');
    const type = async (k, v) => {
      await lt.waitForSelector('#controller [data-c="' + k + '"]');
      await lt.fill('#controller [data-c="' + k + '"]', v);
      await lt.press('#controller [data-c="' + k + '"]', 'Tab');
      await until(k + ' saved', async () => String(((await lineDoc()).controller || {})[k]) === v);
    };
    for (const [k, v] of [['ip', '127.0.0.1'], ['port', String(plc.port)], ['countTag', '40001'], ['speedTag', '40011'], ['speedLow', '65'], ['speedHigh', '75'],
      ['tempTag', '40012'], ['tempDivide', '10'], ['tempLow', '395'], ['tempHigh', '425']]) await type(k, v);
    // A box typed wrong is refused with what to type.
    await lt.fill('#controller [data-c="ip"]', '127.0.0.300');
    await lt.press('#controller [data-c="ip"]', 'Tab');
    await lt.waitForFunction(() => /IP address like 192\.168\.1\.20/.test(document.getElementById('error').textContent));
    assert.equal((await lineDoc()).controller.ip, '127.0.0.1', 'the wrong address was not saved');
    await lt.waitForFunction(() => document.querySelector('#controller [data-c="ip"]').value === '127.0.0.1');
    // The line key and the line PC's command.
    await lt.click('#ctrl-key-btn');
    await lt.waitForSelector('#ctrl-key');
    const key = (await lt.textContent('#ctrl-key')).trim();
    assert.match(await lt.textContent('#controller'), /--controller/);
    results.push('Line Targets: Counted by Machine controller; brand, IP address, port and where the jug count, speed and temperature are, saved box by box; a wrong IP address refused; the line key and the line PC command');

    // The line PC program, reading the pretend controller every second.
    bridge = spawn(process.execPath, [path.join(__dirname, '../../../tools/device-bridge/bridge.cjs'), '--address', DOOR, '--device', BLOW, '--key', key, '--controller', '--every', '1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    bridge.stdout.on('data', d => { log += d; });
    bridge.stderr.on('data', d => { log += d; });
    await until('the machine counted on the shift (line PC said: ' + log + ')', async () => {
      const runs = await db().collection('productionRuns').where('operationId', '==', BLOW).get();
      return runs.docs.some(d => (d.data().count || 0) > 0);
    });

    // Test read: the line PC reads the temperature now and the number shows.
    await lt.click('#controller [data-test="temp"]');
    await lt.waitForFunction(() => /4,312 ÷ 10 = 431\.2/.test(document.getElementById('controller').textContent));
    await lt.click('#controller [data-test="count"]');
    await lt.waitForFunction(() => /on the machine's counter · read/.test(document.getElementById('controller').textContent));
    await lt.waitForFunction(() => /The line PC last sent readings/.test(document.getElementById('controller').textContent));
    await fits(lt, 'Line Targets with the controller box at 1536');
    await bigText(lt, '#controller', 'the controller box');
    await lt.$eval('#controller', e => e.scrollIntoView({ block: 'end' }));
    await shot(lt, 'controller-line-targets-1536');
    await lt.setViewportSize({ width: 1920, height: 1080 });
    await lt.$eval('#controller', e => e.scrollIntoView({ block: 'end' }));
    await fits(lt, 'Line Targets with the controller box at 1920');
    await shot(lt, 'controller-line-targets-1920');
    assert.deepEqual(lt.errors, []);
    await lt.close();
    results.push('Test read: the line PC read the temperature (4,312 ÷ 10 = 431.2°F) and the jug counter from the pretend controller, shown on Line Targets');

    // The Blow Mold tablet: From the machine; the temperature is over its range and flashes red; the speed is in range.
    for (const [w, h] of [[1024, 900], [800, 1180]]) {
      const bm = await openPage(browser, w, h, '/line.html?line=' + BLOW + '&' + ADMIN);
      await bm.waitForSelector('#machine:not([hidden])');
      await bm.waitForFunction(() => /TOO HOT/.test(document.getElementById('machine').textContent) && /IN RANGE/.test(document.getElementById('machine').textContent));
      const tiles = await bm.$$eval('#machine .lb-card', cs => cs.map(c => [c.querySelector('.eyebrow').textContent, c.classList.contains('lb-flash')]));
      assert.deepEqual(tiles, [['Jug count', false], ['Annealer speed', false], ['Temperature', true]]);
      assert.match(await bm.textContent('#machine'), /431\.2°F/);
      await bm.waitForFunction(() => /COUNTING/.test(document.getElementById('machine').textContent), null, { timeout: 15000 });
      assert.match(await bm.textContent('#machine'), /Range 395°F to 425°F/);
      assert.match(await bm.textContent('#kind-cards'), /FROM THE MACHINE/);
      assert.equal(await bm.$('#kind-cards [data-act="count"]'), null, 'no Enter Count: the machine counts');
      assert.match(await bm.textContent('#live'), /Counts from the machine/);
      await fits(bm, 'the Blow Mold tablet at ' + w);
      await bigText(bm, '#machine', 'From the machine');
      await bm.evaluate(() => document.querySelectorAll('.lb-flash').forEach(c => { c.style.animation = 'none'; c.style.background = '#fde1e1'; }));
      await shot(bm, 'controller-tablet-blow-mold-' + w);
      assert.deepEqual(bm.errors, []);
      await bm.close();
    }
    results.push('Blow Mold tablet (1024 and 800): From the machine with the jug count, annealer speed in range and the temperature flashing TOO HOT; Jugs this shift FROM THE MACHINE with no Enter Count');

    // Production Lines: the card and the line's shift view.
    const pl = await openPage(browser, 1536, 960, '/production.html?' + ADMIN);
    await pl.waitForFunction(id => /Temp 431\.2°F TOO HOT/.test((document.querySelector('.pd-tile[data-line="' + id + '"]') || {}).textContent || ''), BLOW);
    await pl.click('#filters [data-kind="ATTN"]');
    await pl.waitForSelector('.pd-tile[data-line="' + BLOW + '"]');
    await pl.close();
    for (const w of [1536, 1920]) {
      const dv = await openPage(browser, w, w === 1536 ? 960 : 1080, '/production.html?line=' + BLOW + '&' + ADMIN);
      await dv.waitForFunction(() => /From the machine/.test(document.getElementById('detail').textContent) && /Machine counter/.test(document.getElementById('detail').textContent));
      assert.match(await dv.textContent('#detail'), /Temperature: 431\.2°F now/);
      assert.deepEqual(await dv.$$eval('#detail .pd-box h3', h => h.map(x => x.textContent).filter(t => /Hour by hour|From the machine/.test(t))), ['Hour by hour', 'From the machine']);
      assert.ok((await dv.$$eval('#detail table.pd-t thead th', t => t.map(x => x.textContent))).includes('Temp'), 'the hour by hour has the hour\'s temperature');
      await fits(dv, 'the line shift view at ' + w);
      await shot(dv, 'controller-line-shift-' + w);
      assert.deepEqual(dv.errors, []);
      await dv.close();
    }
    results.push('Production Lines: Temp 431.2°F TOO HOT on the Blow Mold card, which is under Needs attention; the shift view has From the machine and the hour\'s speed and temperature');
    assert.deepEqual(plc.writes, [], 'nothing but reads was ever sent to the controller');
    results.push('Read-only: the pretend controller got only read requests');
  } finally {
    if (bridge) bridge.kill();
    plc.close();
    await browser.close();
  }
  results.forEach(r => console.log('ok -', r));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
