'use strict';
/*
 * Browser check of Receiving's scanning (Joe 10/13: the Wasp scanner or the Galaxy tablet's camera, on the same screen):
 *   - a keyboard-type scanner typing fast into the scan box, or with nothing focused, gives one scan per Enter;
 *   - Ctrl+] (how some scanners type the GS1 separator) becomes the real separator, so the lot splits from what follows;
 *   - a person typing slowly in another box is never taken for a scan;
 *   - the camera button reads a barcode through Chrome's BarcodeDetector (faked here) and then closes the camera.
 * Needs no emulator: it serves public/ itself.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../../../public');
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' };

const PAGE = `<!doctype html><meta charset="utf-8"><input id="scan"><input id="note">
<script src="/js/scan-rules.js"></script>
<script type="module">
  import { listenForScans, scanWithCamera } from '/js/scan-input.js';
  window.scans = [];
  listenForScans({ box: document.getElementById('scan'), onScan: s => window.scans.push(UDScan.parseScan(s, new Date('2026-10-13T12:00:00Z'))) });
  window.camera = scanWithCamera;
  window.ready = true;
</script>`;

(async () => {
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/scan-test.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); return; }
    const file = path.join(ROOT, path.normalize(url));
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      // A stand-in camera and barcode reader (the test browser has neither).
      window.BarcodeDetector = class { static async getSupportedFormats() { return ['code_128', 'upc_a']; } async detect() { return window.cameraSees ? [{ rawValue: window.cameraSees }] : []; } };
      navigator.mediaDevices.getUserMedia = async () => { const c = document.createElement('canvas'); c.getContext('2d').fillRect(0, 0, 1, 1); return c.captureStream(1); };
    });
    await page.goto(base + '/scan-test.html');
    await page.waitForFunction(() => window.ready);

    // 1. The Wasp typing into the scan box: a GS1-128 label, with Ctrl+] as the separator after the lot.
    await page.focus('#scan');
    await page.keyboard.type('0110614141000415' + '10C2610A', { delay: 2 });
    await page.keyboard.press('Control+BracketRight');
    await page.keyboard.type('3712', { delay: 2 });
    await page.keyboard.press('Enter');
    let scans = await page.evaluate(() => window.scans);
    assert.equal(scans.length, 1);
    assert.equal(scans[0].kind, 'GS1');
    assert.equal(scans[0].lot, 'C2610A');
    assert.equal(scans[0].count, 12);
    assert.equal(await page.inputValue('#scan'), '', 'the scan box empties for the next scan');
    assert.equal(await page.getAttribute('#scan', 'inputmode'), 'none', 'no on-screen keyboard pops up');

    // 2. Nothing focused: a fast scan is still caught.
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.type('036000291452', { delay: 2 });
    await page.keyboard.press('Enter');
    scans = await page.evaluate(() => window.scans);
    assert.equal(scans.length, 2);
    assert.equal(scans[1].gtin, '00036000291452');

    // 3. A person typing in another box is not a scan.
    await page.focus('#note');
    await page.keyboard.type('036000291452', { delay: 2 });
    await page.keyboard.press('Enter');
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.type('0360', { delay: 150 });
    await page.keyboard.press('Enter');
    assert.equal((await page.evaluate(() => window.scans)).length, 2);

    // 4. The camera: opens full screen, reads, closes.
    const read = page.evaluate(() => window.camera());
    await page.waitForSelector('.scan-camera video');
    await page.evaluate(() => { window.cameraSees = '(01)10614141000415(10)HG-0930'; });
    assert.equal(await read, '(01)10614141000415(10)HG-0930');
    assert.equal(await page.$('.scan-camera'), null, 'the camera closes after a read');
    // Close without a read.
    const none = page.evaluate(() => { window.cameraSees = ''; return window.camera(); });
    await page.click('.scan-camera-close');
    assert.equal(await none, '');
    console.log('scan-input: all good');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
