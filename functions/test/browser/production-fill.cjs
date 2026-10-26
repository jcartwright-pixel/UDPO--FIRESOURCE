'use strict';
/*
 * Browser check of the fillers' fill weight check and the Gallon Filler's add-on sensors (Joe 10/14), end to end:
 *   - Line Targets: how often the fill weight check is due, the empty jug, the cap and the light / heavy allowances; on the Gallon
 *     Filler (counted by its label reader) the add-on sensors box: the motor current switch and the infeed eye on a small I/O
 *     module, read-only, with Test read;
 *   - the line PC program (tools/device-bridge, --controller) reading a pretend Modbus I/O module on this computer;
 *   - the Gallon Filler tablet: the fill weight check (five jugs in grams), the product in each jug against the product's Target
 *     Fill Weight g with the empty jug from the Blow Mold's heads, LIGHT and HEAVY; the motor and the rejects;
 *   - both half gallon fillers' tablets (the empty jug typed on Line Targets);
 *   - the Quality screen: the same check's jugs and the Blow Mold's heads typed on the station;
 *   - Production Lines: the fill weight and giveaway on the card and the shift view; the Product Sheet's Target Fill g.
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
const RD = require('../../src/reader');
const { applyAction } = require('../../src/actions');

const HOSTING = 'http://127.0.0.1:5000';
const DOOR = 'http://127.0.0.1:5001/demo-ud-distribution/us-east4/deviceReads';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const ADMIN = 'testEmail=admin.test@uniteddairy.com';
const BLOW = 'ut_prod_blow_mold', GALLON = 'ut_prod_gallon_filler', NEW_HALF = 'ut_prod_new_half_gallon', OLD_HALF = 'ut_prod_old_half_gallon';

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
const lineDoc = async (id) => (await db().collection('productionLines').doc(id).get()).data() || {};
const runsOf = async (id) => (await db().collection('productionRuns').where('operationId', '==', id).get()).docs.map(d => d.data());
async function until(what, fn) {
  for (let i = 0; i < 150; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 200)); }
  throw new Error('Timed out waiting for ' + what);
}
const still = (page) => page.evaluate(() => document.querySelectorAll('.lb-flash').forEach(c => { c.style.animation = 'none'; c.style.background = '#fde1e1'; }));

// A pretend Modbus I/O module: discrete input 0 the motor current switch, input registers 0-1 the infeed eye's count (32 bits).
// It answers read requests only; anything else is refused and remembered.
function ioModule() {
  const io = { motor: 1, infeed: 5000 }, writes = [];
  const server = net.createServer(sock => {
    let buf = Buffer.alloc(0);
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 12) {
        const id = buf.readUInt16BE(0), unit = buf[6], fc = buf[7], addr = buf.readUInt16BE(8);
        buf = buf.subarray(12);
        const head = (len) => { const b = Buffer.alloc(9 + len); b.writeUInt16BE(id, 0); b.writeUInt16BE(3 + len, 4); b[6] = unit; b[7] = fc; b[8] = len; return b; };
        if (fc === 2 && addr === 0) { const b = head(1); b[9] = io.motor ? 1 : 0; sock.write(b); continue; }
        if (fc === 4 && addr === 0) { const b = head(4); b.writeUInt16BE(Math.floor(io.infeed / 65536), 9); b.writeUInt16BE(io.infeed % 65536, 11); sock.write(b); continue; }
        if (fc > 4) writes.push(fc);
        sock.write(Buffer.from([id >> 8, id & 255, 0, 0, 0, 3, unit, fc | 0x80, 2]));
      }
    });
    sock.on('error', () => {});
  });
  return new Promise(res => server.listen(0, '127.0.0.1', () => res({ port: server.address().port, io, writes, close: () => server.close() })));
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date() });
  // The demo plant has no half gallon fillers: NEW 1/2 GALLON and OLD 1/2 GALLON, as Plant Operations keeps them.
  for (const [id, name, seq] of [[NEW_HALF, 'NEW 1/2 GALLON', 60], [OLD_HALF, 'OLD 1/2 GALLON', 70]]) {
    await db().collection('plantSetup').doc(id).set({ operationId: id, type: 'PRODUCTION_AREA', status: 'ACTIVE', name, area: name, facilityId: 'fac_uniontown', viewSequence: seq });
  }
  let n = 0;
  const save = (action, fields) => applyAction(db(), { email: 'admin.test@uniteddairy.com' }, Object.assign({ action, requestId: 'fill-' + (++n) + '-' + Date.now() }, fields));
  await save('saveMachineProducts', { operationId: BLOW, products: [{ name: 'Gallon Jug', sku: 'Gallon Jug', ratePerMin: 50 }] });
  await save('saveMachineProducts', { operationId: GALLON, products: [{ name: 'Broughton 2% Gallon', sku: '50305', upc: '070852503050', shelfLifeDays: 17, fillGrams: 3800, ratePerMin: 74 }, { name: 'Broughton Skim Gallon', sku: '50105', ratePerMin: 74 }] });
  for (const id of [NEW_HALF, OLD_HALF]) await save('saveMachineProducts', { operationId: id, products: [{ name: 'Broughton 2% Half Gallon', sku: '40305', fillGrams: 1900, ratePerMin: 100 }, { name: 'Broughton Chocolate Half Gallon', sku: '40405', ratePerMin: 100 }] });
  await save('saveLineCounter', { operationId: GALLON, counter: 'READER' });
  const mod = await ioModule();
  const browser = await chromium.launch();
  const results = [];
  let bridge = null;
  try {
    // The Blow Mold's heads typed on its station: the Quality screen's Blow Mold check, and the Gallon Filler's empty jug.
    const shift = RD.plantShift(null, Date.now());
    for (const [h, g] of [[1, '57.1'], [2, '57.3'], [3, '56.8'], [4, '57.4'], [5, '57.2'], [6, '57.0']]) await save('saveLineEntry', { operationId: BLOW, shift, op: 'check', slot: Math.max(0, Math.floor((Date.now() - Date.parse(shift.start)) / 3600000)), field: 'head' + h, value: g });
    assert.equal((await lineDoc(BLOW)).headsLast.avg, 57.1);
    const qa = await openPage(browser, 1536, 960, '/quality.html?line=' + BLOW + '&' + ADMIN);
    await qa.waitForFunction(() => [...document.querySelectorAll('.prod-head')].map(x => x.value).join(',') === '57.1,57.3,56.8,57.4,57.2,57.0');
    await shot(qa, 'join-quality-blow-mold-heads-1536');
    assert.deepEqual(qa.errors, []);
    await qa.close();
    results.push('One weight record: the Blow Mold heads typed on the station show in the Quality screen\'s Blow Mold check (the same check)');

    // Line Targets, Gallon Filler: the fill weight check's setup, and the add-on sensors box (counted by its label reader).
    const lt = await openPage(browser, 1536, 960, '/linetargets.html?line=' + GALLON + '&' + ADMIN);
    await lt.waitForFunction(() => document.getElementById('form-title').textContent === 'GALLON FILLER');
    await lt.waitForSelector('#setup-fillEvery');
    assert.equal(await lt.inputValue('#setup-fillEvery'), '', 'the drop-down starts blank');
    assert.match(await lt.textContent('#setup'), /Empty jug now: 57\.1 g \(Blow Mold heads\)/);
    await lt.selectOption('#setup-fillEvery', 'MINUTES');
    await until('fillEvery saved', async () => (await lineDoc(GALLON)).fillEvery === 'MINUTES');
    await lt.waitForSelector('#setup-fillEveryN');
    for (const [k, v] of [['fillEveryN', '30'], ['capGrams', '3'], ['tareGrams', '60'], ['fillUnder', '5'], ['fillOver', '15']]) {
      await lt.fill('#setup-' + k, v);
      await lt.press('#setup-' + k, 'Tab');
      await until(k + ' saved', async () => String((await lineDoc(GALLON))[k]) === v);
    }
    await lt.waitForSelector('#controller:not([hidden]) [data-c="brand"]');
    assert.match(await lt.textContent('#controller'), /Add-on sensors · read-only/);
    assert.deepEqual(await lt.$$eval('#controller .lt-ctable tbody th', t => t.map(x => x.textContent)), ['Motor running', 'Jugs in (infeed eye)']);
    assert.equal(await lt.$('#ctrl-key-btn'), null, 'the add-on sensors use the label reader\'s key');
    await lt.selectOption('#controller [data-c="brand"]', 'MODBUS');
    await until('brand saved', async () => ((await lineDoc(GALLON)).controller || {}).brand === 'MODBUS');
    for (const [k, v] of [['ip', '127.0.0.1'], ['port', String(mod.port)], ['runningTag', '10001'], ['infeedTag', '30001']]) {
      await lt.waitForSelector('#controller [data-c="' + k + '"]');
      await lt.fill('#controller [data-c="' + k + '"]', v);
      await lt.press('#controller [data-c="' + k + '"]', 'Tab');
      await until(k + ' saved', async () => String(((await lineDoc(GALLON)).controller || {})[k]) === v);
    }
    // The line's key (made with the label reader) and the line PC's second program, --controller.
    const key = (await RD.readerCall(db(), { email: 'admin.test@uniteddairy.com' }, { op: 'makeKey', operationId: GALLON }, { key: () => 'gallon-key-1234567890' })).key;
    bridge = spawn(process.execPath, [path.join(__dirname, '../../../tools/device-bridge/bridge.cjs'), '--address', DOOR, '--device', GALLON, '--key', key, '--controller', '--every', '1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    bridge.stdout.on('data', d => { log += d; });
    bridge.stderr.on('data', d => { log += d; });
    await until('the motor switch read (line PC said: ' + log + ')', async () => (await runsOf(GALLON)).some(r => r.machine && r.machine.running === true));
    await lt.click('#controller [data-test="running"]');
    await lt.waitForFunction(() => /ON: running/.test(document.getElementById('controller').textContent));
    await fits(lt, 'Line Targets with the fill weight setup at 1536');
    await bigText(lt, '#setup', 'the fill weight setup');
    await lt.$eval('#setup', e => e.scrollIntoView({ block: 'start' }));
    await shot(lt, 'fill-line-targets-setup-1536');
    await lt.$eval('#controller', e => e.scrollIntoView({ block: 'end' }));
    await shot(lt, 'sensors-line-targets-1536');
    await lt.setViewportSize({ width: 1920, height: 1080 });
    await fits(lt, 'Line Targets at 1920');
    assert.deepEqual(lt.errors, []);
    await lt.close();
    results.push('Line Targets: the fill weight check every 30 minutes, cap 3 g, light under 5 g, heavy over 15 g; empty jug from the Blow Mold heads (57.1 g); the add-on sensors box (motor switch at 10001, infeed eye at 30001) with Test read ON: running');

    // The label reader: 100 jugs of Broughton 2% Gallon out; the infeed eye counted 104 in.
    await RD.applyReads(db(), GALLON, Array.from({ length: 100 }, () => ({ upc: '070852503050' })));
    mod.io.infeed = 5104;
    await until('jugs in counted', async () => (await runsOf(GALLON)).some(r => r.infeed === 104));

    // The Gallon Filler tablet: the fill weight check, then the motor stopping.
    for (const w of [1024, 800]) {
      const gf = await openPage(browser, w, 1400, '/line.html?line=' + GALLON + '&' + ADMIN);
      await gf.waitForSelector('#fill-box:not([hidden]) input[data-field="jug1"]');
      if (w === 1024) {
        assert.match(await gf.textContent('#fill-box'), /Due now: first check of the run/);
        assert.equal(await gf.$eval('#fill-box .lb-box', e => e.classList.contains('lb-flashbox')), true, 'a check that is due flashes');
        for (const [j, g] of [[1, '3870'], [2, '3852'], [3, '3880'], [4, '3866']]) {
          await gf.fill('#fill-box input[data-field="jug' + j + '"]', g);
          await gf.press('#fill-box input[data-field="jug' + j + '"]', 'Tab');
        }
        await until('four jugs saved on one check', async () => (await runsOf(GALLON)).some(r => (r.fills || []).length === 1 && r.fills[0].jug4 === 3866));
        // While the check is being typed: each jug's product and its flag.
        await gf.waitForFunction(() => /3,791\.9 g product/.test(document.getElementById('fill-box').textContent) && document.querySelectorAll('#fill-box .lb-field.lb-off').length === 2);
        const typing = await gf.textContent('#fill-box');
        assert.match(typing, /3,791\.9 g product · −8\.1 g/, 'jug 2: 3852 - 57.1 - 3 = 3791.9');
        assert.match(typing, /empty jug 57\.1 g \(Blow Mold heads average\) − cap 3 g\. Target 3,800 g for Broughton 2% Gallon/);
        assert.deepEqual(await gf.$$eval('#fill-box .lb-field.lb-off', f => f.map(x => x.firstChild.textContent.trim())), ['Jug 2 g', 'Jug 3 g']);
        await gf.$eval('#fill-box', e => e.scrollIntoView({ block: 'center' }));
        await shot(gf, 'fill-tablet-gallon-filler-typing-1024');
        await gf.fill('#fill-box input[data-field="jug5"]', '3861');
        await gf.press('#fill-box input[data-field="jug5"]', 'Tab');
        await until('five jugs saved on one check', async () => (await runsOf(GALLON)).some(r => (r.fills || []).length === 1 && r.fills[0].jug5 === 3861));
      }
      // Joe 10/15: the fifth weight records the check: the boxes empty for the next one, the result is one read-only line.
      await gf.waitForFunction(() => /Last check/.test(document.getElementById('fill-box').textContent) && /Next due/.test(document.getElementById('fill-box').textContent));
      const box = await gf.textContent('#fill-box');
      assert.match(box, /Last check \d+:\d\d [AP]M by admin\.test: \+5\.7 g over target · 1 LIGHT · 1 HEAVY/);
      assert.deepEqual(await gf.$$eval('#fill-box input[data-save="fill"]', i => i.map(x => x.value + '|' + x.dataset.index)), ['|', '|', '|', '|', '|'], 'the boxes are empty for the next check');
      assert.equal(await gf.$eval('#fill-box .lb-box', e => e.classList.contains('lb-flashbox')), false, 'not due: no flashing');
      assert.match(box, /Broughton 2% Gallon3,805\.7 g\+5\.7 g LIGHT5 of 5/, 'the check is in Earlier this shift');
      await gf.waitForFunction(() => /Rejects and spills/.test(document.getElementById('machine').textContent) && /RUNNING/.test(document.getElementById('machine').textContent));
      assert.match(await gf.textContent('#machine'), /104 jugs in · 100 counted out/);
      assert.equal(await gf.$eval('#std-cards', e => e.hidden), false, 'the filler\'s own cards stay');
      await fits(gf, 'the Gallon Filler tablet at ' + w);
      await bigText(gf, '#fill-box', 'the fill weight check');
      await bigText(gf, '#machine', 'the add-on sensors');
      await gf.$eval('#machine', e => e.scrollIntoView({ block: 'start' }));
      await shot(gf, 'fill-tablet-gallon-filler-' + w);
      assert.deepEqual(gf.errors, []);
      await gf.close();
    }
    mod.io.motor = 0;
    await until('the motor switch stopped the line', async () => (await runsOf(GALLON)).some(r => (r.stops || []).some(s => !s.end && s.by === RD.BY_SWITCH)));
    const off = await openPage(browser, 1024, 1400, '/line.html?line=' + GALLON + '&' + ADMIN);
    await off.waitForFunction(() => /MOTOR OFF/.test(document.getElementById('machine').textContent));
    assert.equal(await off.textContent('#state-name'), 'DOWN');
    await still(off);
    await shot(off, 'sensors-tablet-motor-off-1024');
    assert.deepEqual(off.errors, []);
    await off.close();
    mod.io.motor = 1;
    await until('the motor running again ended its stop', async () => (await runsOf(GALLON)).some(r => (r.stops || []).length === 1 && r.stops[0].end));
    results.push('Gallon Filler tablet (1024 and 800): the fill weight check flashes when due; five jugs in grams, the product in each (filled - 57.1 g Blow Mold jug - 3 g cap) against 3,800 g, jug 2 LIGHT and jug 3 HEAVY while typing; the fifth records it: boxes empty, Last check +5.7 g over target · 1 LIGHT · 1 HEAVY, next due; Motor RUNNING and 4 rejects of 104 jugs in; the motor switch off stopped the line (MOTOR OFF) and on again ended the stop');

    // The two half gallon fillers (Joe 10/14: "We have two"): the same check, the empty jug typed on Line Targets.
    await save('saveLineSetup', { operationId: NEW_HALF, tareGrams: '38', capGrams: '2', fillEvery: 'JUGS', fillEveryN: '2000' });
    for (const [id, name] of [[NEW_HALF, 'NEW'], [OLD_HALF, 'OLD']]) {
      await save('saveLineEntry', { operationId: id, shift, op: 'product', product: 'Broughton 2% Half Gallon', sku: '40305' });
      const hf = await openPage(browser, 1024, 1300, '/line.html?line=' + id + '&' + ADMIN);
      await hf.waitForSelector('#fill-box:not([hidden]) input[data-field="jug1"]');
      if (id === NEW_HALF) {
        for (const [j, g] of [[1, '1945'], [2, '1938'], [3, '1941']]) {
          await hf.fill('#fill-box input[data-field="jug' + j + '"]', g);
          await hf.press('#fill-box input[data-field="jug' + j + '"]', 'Tab');
        }
        await hf.waitForFunction(() => /1,905 g product/.test(document.getElementById('fill-box').textContent) && /Next due in/.test(document.getElementById('fill-box').textContent)).catch(async e => { console.error('FILLBOX', await hf.textContent('#fill-box'), JSON.stringify((await runsOf(NEW_HALF)).map(r => r.fills))); throw e; });
        assert.match(await hf.textContent('#fill-box'), /empty jug 38 g − cap 2 g\. Target 1,900 g/);
      } else {
        assert.match(await hf.textContent('#fill-box'), /set empty jug on Line Targets/);
        assert.match(await hf.textContent('#fill-box'), /Due now: first check of the run/);
      }
      await fits(hf, name + ' 1/2 GALLON tablet');
      await bigText(hf, '#fill-box', name + ' 1/2 GALLON fill weight check');
      await hf.$eval('#fill-box', e => e.scrollIntoView({ block: 'center' }));
      await shot(hf, 'fill-tablet-' + name.toLowerCase() + '-half-gallon-1024');
      assert.deepEqual(hf.errors, []);
      await hf.close();
    }
    results.push('NEW 1/2 GALLON and OLD 1/2 GALLON tablets: their own fill weight check; NEW with 38 g jug and 2 g cap typed on Line Targets (1945 g filled = 1,905 g product, due every 2,000 jugs), OLD asking for its empty jug weight');

    // The Quality screen: the Gallon Filler's package weight is the same check's jugs.
    const qf = await openPage(browser, 1536, 960, '/quality.html?line=' + GALLON + '&' + ADMIN);
    // The Quality screen loads every line's checks and products first: on a busy CI runner that can take longer than the default.
    await qf.waitForFunction(() => (document.querySelector('.prod-weights') || {}).value === '3870, 3852, 3880, 3866, 3861 g', null, { timeout: 90000 })
      .catch(async e => {
        const q = (await db().collection('plantJournal').where('type', '==', 'PRODUCTION_QUALITY').get()).docs.map(d => d.data()).filter(d => (d.payload || {}).operationId === GALLON)
          .map(d => [d.recordedAt, d.status, JSON.stringify((d.payload || {}).weights)]);
        console.error('QUALITY', await qf.textContent('#form-title').catch(() => 'none'), await qf.$eval('.prod-weights', x => x.value).catch(() => 'no box'), JSON.stringify(q), new Date().toISOString());
        throw e;
      });
    assert.equal(await qf.getAttribute('.prod-weights', 'placeholder'), 'filled jugs in grams, like 3861, 3863');
    await shot(qf, 'join-quality-gallon-filler-1536');
    assert.deepEqual(qf.errors, []);
    await qf.close();
    results.push('Quality screen: the Gallon Filler\'s package weight is the tablet\'s fill weight check (3870, 3852, 3880, 3866, 3861 g), one record');

    // Production Lines: the card and the line's shift view.
    const pl = await openPage(browser, 1536, 960, '/production.html?' + ADMIN);
    await pl.waitForFunction(id => /Fill weight \+5\.7 g vs target · 1 LIGHT · 1 HEAVY at/.test((document.querySelector('.pd-tile[data-line="' + id + '"]') || {}).textContent || ''), GALLON).catch(async e => { console.error('CARD', await pl.$eval('.pd-tile[data-line="' + GALLON + '"]', x => x.textContent).catch(() => 'none')); throw e; });
    await pl.close();
    for (const w of [1536, 1920]) {
      // Joe 10/26: the machine page's Fill weight and From the machine tabs.
      const dv = await openPage(browser, w, w === 1536 ? 960 : 1080, '/production.html?line=' + GALLON + '&tab=fill&' + ADMIN);
      await dv.waitForFunction(() => /Giveaway/.test((document.querySelector('#detail .pm-tabbody[data-tab="fill"]') || {}).textContent || ''));
      const d = await dv.textContent('#detail .pm-tabbody');
      assert.match(d, /Average \+5\.7 g over target/);
      assert.match(d, /Giveaway 1\.3 lb \(570 g\) on 100 jugs/);
      await dv.click('#pmtabs [data-pmtab="machine"]');
      await dv.waitForSelector('#detail .pm-tabbody[data-tab="machine"]');
      assert.match(await dv.textContent('#detail .pm-tabbody'), /Rejects and spills: 4/);
      await fits(dv, 'the Gallon Filler shift view at ' + w);
      await dv.$eval('#detail', e => e.scrollIntoView({ block: 'start' }));
      await shot(dv, 'fill-line-shift-' + w);
      assert.deepEqual(dv.errors, []);
      await dv.close();
    }
    results.push('Production Lines: Fill weight +5.7 g vs target · 1 LIGHT · 1 HEAVY on the Gallon Filler card; the shift view has the fill weight checks, the giveaway (1.3 lb on 100 jugs) and the rejects');

    // The Product Sheet: Target Fill g for each product.
    const ps = await openPage(browser, 1536, 960, '/products.html?line=' + GALLON + '&' + ADMIN);
    await ps.waitForFunction(() => [...document.querySelectorAll('#rows td[data-k="fillGrams"]')].some(td => td.textContent === '3,800' || td.textContent === '3800')).catch(async e => { console.error('SHEET', JSON.stringify(await ps.$$eval('#rows tr', r => r.slice(0, 5).map(x => x.textContent))), JSON.stringify(ps.errors)); throw e; });
    await fits(ps, 'the Product Sheet');
    await shot(ps, 'fill-product-sheet-1536');
    assert.deepEqual(ps.errors, []);
    await ps.close();
    results.push('Product Sheet: Target Fill g column (3,800 for Broughton 2% Gallon, blank for Skim: the tablet says set target)');
    assert.deepEqual(mod.writes, [], 'nothing but reads was ever sent to the I/O module');
    results.push('Read-only: the pretend I/O module got only read requests');
  } finally {
    if (bridge) bridge.kill();
    mod.close();
    await browser.close();
  }
  results.forEach(r => console.log('ok -', r));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
