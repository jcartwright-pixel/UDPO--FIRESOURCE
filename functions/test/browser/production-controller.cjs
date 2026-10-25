'use strict';
/*
 * Browser check of the Blow Mold's machine readings (Joe 10/14): the jug count, speed and temperature read from the machine's
 * own controller, READ-ONLY, end to end:
 *   - Line Targets: Counted by Machine controller; brand, IP address and where each reading is, each box saved as it is left;
 *     the line key; Test read shows the number the line PC read;
 *   - the line PC program (tools/device-bridge, --controller) reading a pretend Modbus controller on this computer;
 *   - the Blow Mold tablet: From the sensors with the annealer temperature and the belt's RPM counted from its turns (Joe 10/23),
 *     the room's MOCREO sensor, red outside the range; jugs molded from the shot counter (6 a shot), jugs on the Alpine
 *     and the kick-outs; the resin lot scanned and White or Clear, each a run on Runs this shift; the bottle check weighs a
 *     jug from each of the six heads in grams, flagged outside the range on Line Targets;
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
const P = require('../../src/production-rules');
const RD = require('../../src/reader');
const { applyAction } = require('../../src/actions');

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

// A pretend Modbus controller: holding registers 0-1 the jug count (32 bits), 10 the speed, 11 the temperature in tenths,
// 30-31 the lever's shots and 40-41 the annealer belt's turns (32 bits each).
// It answers read requests only; anything else is refused and remembered, so the test can show nothing was ever written.
function controller() {
  const regs = { 0: 19, 1: 39978, 10: 70, 11: 4312, 30: 3, 31: 1000, 40: 0, 41: 5000 }, writes = [];
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
  // The machine makes about 40 jugs every 5 seconds, with about 4% more molded (the tester's kick-outs); the belt turns 70 a minute.
  const add = (hi, by) => { const n = regs[hi] * 65536 + regs[hi + 1] + by; regs[hi] = Math.floor(n / 65536); regs[hi + 1] = n % 65536; };
  let shots = 0, turns = 0;
  const jugs = setInterval(() => {
    add(0, 8);
    shots += 8 * 1.04 / 6; add(30, Math.floor(shots)); shots -= Math.floor(shots);
    turns += 70 / 60; add(40, Math.floor(turns)); turns -= Math.floor(turns);
  }, 1000);
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
    // Joe 10/23: the Blow Mold's belt speed is counted from its turns, not read from the speed control.
    assert.deepEqual(await lt.$$eval('#controller .lt-ctable tbody th', t => t.map(x => x.textContent)), ['Jugs on the Alpine', 'Shots (lever switch)', 'Belt turns (shaft switch)', 'Annealer temperature (°F)']);
    await db().collection('sensors').doc('blow-room').set({ sensorId: 'blow-room', name: 'Blow Mold Room', temperatureF: 96, lastReadingAt: new Date().toISOString() });
    await lt.selectOption('#controller [data-c="brand"]', 'MODBUS');
    await until('brand saved', async () => ((await lineDoc()).controller || {}).brand === 'MODBUS');
    const type = async (k, v) => {
      await lt.waitForSelector('#controller [data-c="' + k + '"]');
      await lt.fill('#controller [data-c="' + k + '"]', v);
      await lt.press('#controller [data-c="' + k + '"]', 'Tab');
      await until(k + ' saved', async () => String(((await lineDoc()).controller || {})[k]) === v);
    };
    for (const [k, v] of [['ip', '127.0.0.1'], ['port', String(plc.port)], ['countTag', '40001'], ['shotsTag', '40031'], ['turnsTag', '40041'], ['pulsesPerTurn', '1'], ['speedLow', '65'], ['speedHigh', '75'],
      ['tempTag', '40012'], ['tempDivide', '10'], ['tempLow', '395'], ['tempHigh', '425'], ['jugsPerShot', '6'], ['roomHigh', '95']]) await type(k, v);
    await lt.waitForFunction(() => !!document.querySelector('#controller [data-c="roomSensor"] option[value="blow-room"]'));
    await lt.selectOption('#controller [data-c="roomSensor"]', 'blow-room');
    await until('room sensor saved', async () => ((await lineDoc()).controller || {}).roomSensor === 'blow-room');
    // The Blow Mold's jug weight range (Joe 10/14: six heads, in grams), with the changeover and CIP boxes.
    for (const [k, v] of [['jugWeightTarget', '57'], ['jugWeightLow', '55'], ['jugWeightHigh', '59']]) {
      await lt.fill('#setup-' + k, v);
      await lt.press('#setup-' + k, 'Tab');
      await until(k + ' saved', async () => String((await lineDoc())[k]) === v);
    }
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

    // The belt's last turn count 40 seconds ago (so its first RPM shows without waiting the half minute).
    await db().collection('productionLines').doc(BLOW).set({ turnsLast: { value: plc.regs[40] * 65536 + plc.regs[41] - 47, at: new Date(Date.now() - 40000).toISOString() } }, { merge: true });
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

    // The Blow Mold tablet: From the sensors; the temperature and the room are over their ranges and flash red; the belt RPM is in range.
    for (const [w, h] of [[1024, 1180], [800, 1180]]) {
      const bm = await openPage(browser, w, h, '/line.html?line=' + BLOW + '&' + ADMIN);
      await bm.waitForSelector('#machine:not([hidden])');
      await bm.waitForFunction(() => /TOO HOT/.test(document.getElementById('machine').textContent) && /IN RANGE/.test(document.getElementById('machine').textContent) && /RPM/.test(document.getElementById('machine').textContent));
      const tiles = await bm.$$eval('#machine .lb-card', cs => cs.map(c => [c.querySelector('.eyebrow').textContent, c.classList.contains('lb-flash')]));
      assert.deepEqual(tiles, [['Annealer temperature', true], ['Annealer belt speed', false], ['Room temperature', true], ['Jugs ahead of filler', false]]);
      assert.match(await bm.textContent('#machine'), /431\.2°F/);
      assert.match(await bm.textContent('#machine'), /Range 395°F to 425°F/);
      assert.match(await bm.textContent('#machine'), /\d+(\.\d)? RPM\s*Range 65 to 75 · counted from the belt/);
      assert.match(await bm.textContent('#machine'), /96°F\s*Range up to 95°F/);
      // Joe 10/23: jugs molded = shots x 6; jugs on the Alpine after the annealer; the difference is the kick-outs, red over 2%.
      await bm.waitForFunction(() => /FROM THE SHOT COUNTER/.test(document.getElementById('kind-cards').textContent) && /% OF JUGS MOLDED/.test(document.getElementById('kind-cards').textContent));
      assert.deepEqual(await bm.$$eval('#kind-cards .lb-card .eyebrow', e => e.map(x => x.textContent)), ['Making now', 'Jugs molded', 'Jugs on the Alpine', 'Tester kick-outs']);
      assert.match(await bm.textContent('#kind-cards'), /shots × 6 jugs/);
      assert.equal(await bm.$('#kind-cards [data-act="count"]'), null, 'no Enter Count: the machine counts');
      assert.match(await bm.textContent('#live'), /Counts from the machine/);
      // Joe 10/14: the Blow Mold makes only gallon jugs, so its one product is running with nothing to pick.
      assert.match(await bm.textContent('#kind-cards'), /Making now\s*Gallon Jug/);
      assert.equal(await bm.$('#kind-cards [data-act="product"]'), null, 'no Pick Product on the Blow Mold');
      assert.doesNotMatch(await bm.textContent('#status-text'), /pick the product/);
      // The bottle check: one jug from each of the six heads, in grams; a head outside 55 to 59 g is flagged.
      assert.deepEqual(await bm.$$eval('#check-inline .lb-field', f => f.map(x => x.firstChild.textContent.trim())), ['Head 1 g', 'Head 2 g', 'Head 3 g', 'Head 4 g', 'Head 5 g', 'Head 6 g', 'Top load']);
      if (w === 1024) {
        for (const [h, g] of [[1, '57.1'], [2, '60.2'], [3, '56.8'], [4, '57.4'], [5, '54.6'], [6, '57.0']]) {
          await bm.fill('#check-inline input[data-field="head' + h + '"]', g);
          await bm.press('#check-inline input[data-field="head' + h + '"]', 'Tab');
          await until('head ' + h + ' saved', async () => { const runs = await db().collection('productionRuns').where('operationId', '==', BLOW).get(); return runs.docs.some(d => Object.values(d.data().checks || {}).some(c => c['head' + h] === g)); });
        }
      }
      await bm.waitForFunction(() => /HEAVY/.test(document.getElementById('check-inline').textContent) && /LIGHT/.test(document.getElementById('check-inline').textContent));
      assert.deepEqual(await bm.$$eval('#check-inline .lb-field.lb-off', f => f.map(x => x.firstChild.textContent.trim())), ['Head 2 g', 'Head 5 g']);
      assert.match(await bm.textContent('#check-inline'), /Target 57 g\. Range 55 to 59 g\./);
      await fits(bm, 'the Blow Mold tablet at ' + w);
      await bigText(bm, '#machine', 'From the machine');
      if (w === 1024) {
        // Joe 10/23 (mock-up 2): the scanner types the resin lot and presses Enter; White or Clear; each change is a new run.
        await bm.fill('#lot-scan', 'R-24097');
        await bm.press('#lot-scan', 'Enter');
        await bm.waitForFunction(() => /Resin lot R-24097/.test(document.getElementById('kind-cards').textContent));
        assert.equal(await bm.inputValue('#lot-scan'), '', 'the scan box clears for the next bag');
        await bm.click('#kind-cards [data-color="WHITE"]');
        await bm.waitForFunction(() => /Gallon Jug · WHITE/.test(document.getElementById('kind-cards').textContent));
        await bm.fill('#lot-scan', 'R-24118');
        await bm.press('#lot-scan', 'Enter');
        await bm.waitForFunction(() => document.querySelectorAll('#lot-runs tbody tr').length === 3 && /R-24118/.test(document.querySelector('#lot-runs tr.now').textContent));
        assert.deepEqual(await bm.$$eval('#lot-runs tbody tr', r => r.map(x => [x.children[1].textContent, x.children[2].textContent])), [['R-24097', '—'], ['R-24097', 'White'], ['R-24118', 'White']]);
        assert.deepEqual(await bm.$$eval('#lot-runs thead th', t => t.map(x => x.textContent)), ['Started', 'Resin lot', 'Color', 'Jugs molded', 'On the Alpine', 'Kick-outs', 'Annealer temp', 'Belt RPM', 'Room temp']);
        const r = (await db().collection('productionRuns').where('operationId', '==', BLOW).get()).docs[0].data();
        assert.deepEqual([r.lot, r.color, r.lotLog.length], ['R-24118', 'WHITE', 3]);
        assert.deepEqual([(await lineDoc()).lot, (await lineDoc()).color], ['R-24118', 'WHITE'], 'the next shift starts on them');
        await bigText(bm, '#kind-cards, #lot-runs', 'Making now and Runs this shift');
      }
      await bm.evaluate(() => document.querySelectorAll('.lb-flash').forEach(c => { c.style.animation = 'none'; c.style.background = '#fde1e1'; }));
      await shot(bm, 'controller-tablet-blow-mold-' + w);
      assert.deepEqual(bm.errors, []);
      await bm.close();
    }
    // Joe 10/15: the last box records the check: no numbers left in boxes, the result is one read-only line until the next is due.
    const rec = await openPage(browser, 1024, 1300, '/line.html?line=' + BLOW + '&' + ADMIN);
    await rec.waitForSelector('#check-inline:not([hidden]) select[data-field="topLoad"]');
    assert.equal(await rec.$eval('#check-inline .lb-box', e => e.classList.contains('lb-flashbox')), true, 'the check due now flashes');
    await rec.selectOption('#check-inline select[data-field="topLoad"]', 'OK');
    await rec.waitForFunction(() => /Last check/.test(document.getElementById('check-inline').textContent));
    assert.match(await rec.textContent('#check-inline'), /Last check \d+:\d\d [AP]M by admin\.test: Head 2, Head 5 OUT · next check due \d+:\d\d [AP]M/);
    assert.equal(await rec.$('#check-inline input[data-save="check"]'), null, 'no boxes with the old numbers');
    assert.equal(await rec.$eval('#check-inline .lb-box', e => e.classList.contains('lb-flashbox')), false);
    assert.match(await rec.textContent('#check-inline'), /60\.2 HEAVY/, 'the numbers are in Earlier this shift');
    await bigText(rec, '#check-inline', 'the recorded check');
    await rec.$eval('#check-inline', e => e.scrollIntoView({ block: 'center' }));
    await shot(rec, 'check-recorded-blow-mold-1024');
    assert.deepEqual(rec.errors, []);
    await rec.close();
    results.push('Blow Mold check recorded: Last check · Head 2, Head 5 OUT · next check due, read-only; the numbers only in Earlier this shift');
    results.push('Blow Mold tablet (1024 and 800): From the sensors with the annealer temperature and the room flashing TOO HOT and the belt RPM counted from its turns in range; jugs molded from the shot counter, on the Alpine and the kick-outs, with no Enter Count; the resin lot scanned and White picked, each a run on Runs this shift; Gallon Jug running with no Pick Product; the bottle check has Head 1 to Head 6 in grams with 60.2 HEAVY and 54.6 LIGHT against 55 to 59 g');

    // Production Lines: the card and the line's shift view.
    const pl = await openPage(browser, 1536, 960, '/production.html?' + ADMIN);
    await pl.waitForFunction(id => /Temp 431\.2°F TOO HOT/.test((document.querySelector('.pd-tile[data-line="' + id + '"]') || {}).textContent || ''), BLOW);
    await pl.click('#filters [data-kind="ATTN"]');
    await pl.waitForSelector('.pd-tile[data-line="' + BLOW + '"]');
    await pl.close();
    for (const w of [1536, 1920]) {
      const dv = await openPage(browser, w, w === 1536 ? 960 : 1080, '/production.html?line=' + BLOW + '&' + ADMIN);
      // Joe 10/25 (desk mock-up 2): the Blow Mold's own page: its numbers up top, Making now and the sensors, Runs this shift and every reading by the hour.
      await dv.waitForFunction(() => /Making now and the sensors/i.test(document.getElementById('detail').textContent) && (document.querySelector('#detail .pd-bm table.pd-t') || { rows: [] }).rows.length === 4);
      assert.deepEqual(await dv.$$eval('#hstats span', s => s.map(x => x.textContent.replace(/ [\d.]+%$/, ''))), ['Jugs molded', 'On the Alpine', 'Kick-outs', 'Target so far', 'Efficiency', 'Stopped']);
      assert.deepEqual(await dv.$$eval('#detail .pd-box h3', h => h.map(x => x.childNodes[0].textContent.trim()).slice(0, 4)), ['BLOW MOLD · this shift', 'Making now and the sensors', 'Runs this shift', 'Hour by hour']);
      assert.deepEqual(await dv.$$eval('#detail .pd-bm-tile', t => t.map(x => [x.querySelector('.pd-bm-eb').textContent, x.classList.contains('bad')])), [['Annealer temperature', true], ['Annealer belt speed', false], ['Room temperature', true], ['Jugs ahead of filler', false]]);
      assert.match(await dv.textContent('#detail'), /431\.2°F/);
      assert.match(await dv.textContent('#detail'), /White/);
      assert.match(await dv.textContent('#detail'), /60\.2 HEAVY/, 'the quality checks show the heavy head');
      const tables = await dv.$$eval('#detail .pd-bm table.pd-t', ts => ts.map(t => ({ heads: [...t.querySelectorAll('thead th')].map(x => x.textContent), rows: t.querySelectorAll('tbody tr').length })));
      assert.deepEqual(tables[0], { heads: ['Started', 'Resin lot', 'Color', 'Jugs molded', 'On the Alpine', 'Kick-outs', 'Annealer temp', 'Belt RPM', 'Room temp'], rows: 3 });
      assert.deepEqual(tables[1].heads, ['Hour', 'Resin lot · color', 'Jugs molded', 'On the Alpine', 'Target', '%', 'Kick-outs', 'Annealer temp', 'Belt RPM', 'Room temp', 'Stopped']);
      assert.equal(await dv.$('#detail .pd-pill.n'), null, 'every sensor is reading: nothing says WAITING FOR SENSOR');
      await fits(dv, 'the line shift view at ' + w);
      await shot(dv, 'controller-line-shift-' + w);
      assert.deepEqual(dv.errors, []);
      await dv.close();
    }
    results.push('Production Lines: Temp 431.2°F TOO HOT on the Blow Mold card, which is under Needs attention; the Blow Mold page has jugs molded, on the Alpine and kick-outs up top, Making now and the sensors (temperature and room TOO HOT), Runs this shift and every reading by the hour');
    assert.deepEqual(plc.writes, [], 'nothing but reads was ever sent to the controller');

    // The Gallon Filler (Joe 10/14: a counter and a UPC scanner): the label confirms the product running, a wrong label is flagged.
    const FILLER = 'ut_prod_gallon_filler';
    let n = 0;
    const save = (action, fields) => applyAction(db(), { email: 'admin.test@uniteddairy.com' }, Object.assign({ action, requestId: 'filler-' + (++n) + '-' + Date.now() }, fields));
    await save('saveMachineProducts', { operationId: FILLER, products: [{ name: 'Broughton 2% Gallon', sku: '50305', upc: '070852503050', shelfLifeDays: 17, ratePerMin: 74, targetPct: 57.3 }] });
    await save('saveLineCounter', { operationId: FILLER, counter: 'READER' });
    const code = P.codeDate(RD.plantShift(null, Date.now()).date, 17);
    await RD.applyReads(db(), FILLER, Array.from({ length: 40 }, () => ({ upc: '070852503050', date: code })));
    const gf = await openPage(browser, 1024, 900, '/line.html?line=' + FILLER + '&' + ADMIN);
    await gf.waitForFunction(() => /LABEL MATCHES/.test(document.getElementById('date-check').textContent) && /CODE DATE OK/.test(document.getElementById('date-check').textContent));
    await shot(gf, 'gallon-filler-label-matches-1024');
    await RD.applyReads(db(), FILLER, [{ upc: '070852599999', date: code }, { upc: '070852599999', date: code }]);
    await gf.waitForFunction(() => /WRONG LABEL\s*UPC 070852599999/.test(document.getElementById('date-check').textContent));
    assert.match(await gf.textContent('#date-check'), /2 jugs this shift/);
    await fits(gf, 'the Gallon Filler tablet');
    await shot(gf, 'gallon-filler-wrong-label-1024');
    assert.deepEqual(gf.errors, []);
    await gf.close();
    const pl2 = await openPage(browser, 1536, 960, '/production.html?' + ADMIN);
    await pl2.waitForFunction(id => /WRONG LABEL UPC 070852599999/.test((document.querySelector('.pd-tile[data-line="' + id + '"]') || {}).textContent || ''), FILLER);
    await pl2.click('#filters [data-kind="ATTN"]');
    await pl2.waitForSelector('.pd-tile[data-line="' + FILLER + '"]');
    await pl2.close();
    results.push('Gallon Filler label reader: LABEL MATCHES the product running; a UPC not on its products is WRONG LABEL on the tablet and on Production Lines, under Needs attention');
    results.push('Read-only: the pretend controller got only read requests');
  } finally {
    if (bridge) bridge.kill();
    plc.close();
    await browser.close();
  }
  results.forEach(r => console.log('ok -', r));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
