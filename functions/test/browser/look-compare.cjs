'use strict';
/*
 * Proves a change kept every screen's look (Joe 10/21: "I like exactly everything that it looks like right now").
 * Opens each main screen twice at 1536x790 with the clock held still: once from the app as it was (BEFORE, a folder served on
 * port 5050, e.g. a git worktree of main) and once from this copy (port 5000), against the same test database. Once each has
 * settled it compares every shown element's place, size and look (computed style), and the pictures pixel by pixel.
 * Not part of npm run test:browser (it compares two copies). Usage, inside the emulators:
 *   BEFORE=/path/to/old/public node test/browser/look-compare.cjs <out dir>      ONLY=a.html,b.html to pick screens
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');

const SDK = path.dirname(require.resolve('firebase/package.json'));
const OUT = process.argv[2] || '.';
const WHO = 'testEmail=admin.test@uniteddairy.com';
const SCREENS = fs.readFileSync(path.join(__dirname, 'screen-timings.cjs'), 'utf8').match(/const SCREENS = \[([\s\S]*?)\n\];/)[1]
  .match(/\['[^']+', '[^']+'\]/g).map(s => s.match(/'([^']+)', '([^']+)'/).slice(1));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };

function serve(dir, port) {
  return new Promise(res => {
    const s = http.createServer((req, rsp) => {
      const p = path.join(dir, decodeURIComponent(req.url.split('?')[0].split('#')[0]).replace(/^\/+/, '') || 'index.html');
      fs.readFile(p, (e, body) => { if (e) { rsp.writeHead(404); rsp.end(); return; } rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); rsp.end(body); });
    });
    s.listen(port, '127.0.0.1', () => res(s));
  });
}

// Every shown element in the page: where it is, how big, and how it looks.
function shape() {
  const KEYS = ['color', 'backgroundColor', 'fontSize', 'fontWeight', 'fontFamily', 'borderTopColor', 'borderTopWidth', 'borderRadius', 'paddingTop', 'paddingLeft', 'display', 'opacity', 'textAlign', 'lineHeight', 'boxShadow'];
  const out = [];
  const walk = (el, at) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    if (r.width && r.height && r.bottom > 0 && r.top < innerHeight) {
      const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').slice(0, 40);
      out.push(at + ' ' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + ' ' + [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(',') + ' ' + KEYS.map(k => cs[k]).join('|') + ' "' + own + '"');
    }
    [...el.children].forEach((c, i) => walk(c, at + '.' + i));
  };
  walk(document.body, 'b');
  return out;
}

// The share of pixels that differ between two pictures (worked out in a blank browser page).
async function diffPng(page, a, b) {
  return page.evaluate(async ([a, b]) => {
    const load = (s) => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s; });
    const [A, B] = await Promise.all([load(a), load(b)]);
    if (A.width !== B.width || A.height !== B.height) return 1;
    const px = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
    const P = px(A), Q = px(B);
    let n = 0;
    for (let i = 0; i < P.length; i += 4) if (Math.abs(P[i] - Q[i]) + Math.abs(P[i + 1] - Q[i + 1]) + Math.abs(P[i + 2] - Q[i + 2]) > 30) n++;
    return n / (A.width * A.height);
  }, [a.toString('base64'), b.toString('base64')]);
}

(async () => {
  if (!process.env.NOSEED) {
    await clear();
    await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  }
  const server = await serve(process.env.BEFORE, 5050);
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const fixed = new Date();
  const open = async (base, url) => {
    const ctx = await browser.newContext({ viewport: { width: 1536, height: 790 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.clock.setFixedTime(fixed);
    await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, r.request().url().split('/').pop())) }));
    const [bare, hash] = url.split('#');
    await page.goto(base + '/' + bare + (bare.includes('?') ? '&' : '?') + WHO + (hash ? '#' + hash : ''), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    // The pointer away from the menu, and no blinking caret.
    await page.mouse.move(1500, 780);
    await page.addStyleTag({ content: '*{caret-color:transparent!important}' });
    await page.waitForTimeout(300);
    const pic = await page.screenshot();
    const s = await page.evaluate(shape);
    await ctx.close();
    return { pic, s };
  };
  const scratch = await browser.newPage();
  const only = (process.env.ONLY || '').split(',').filter(Boolean), rows = [];
  for (const [label, url] of SCREENS.filter(([, u]) => !only.length || only.includes(u.split(/[?#]/)[0]))) {
    const a = await open('http://127.0.0.1:5050', url), b = await open('http://127.0.0.1:5000', url);
    const sa = new Set(a.s), sb = new Set(b.s);
    const gone = a.s.filter(x => !sb.has(x)), added = b.s.filter(x => !sa.has(x));
    const px = await diffPng(scratch, a.pic, b.pic);
    const name = url.replace(/[^a-z0-9]+/gi, '_');
    if (gone.length || added.length || px > 0) { fs.writeFileSync(path.join(OUT, name + '_before.png'), a.pic); fs.writeFileSync(path.join(OUT, name + '_after.png'), b.pic); }
    rows.push({ label, url, elements: a.s.length, changed: Math.max(gone.length, added.length), pixels: +(px * 100).toFixed(3), gone: gone.slice(0, 8), added: added.slice(0, 8) });
    console.log(label.padEnd(28), 'elements', String(a.s.length).padStart(5), 'changed', String(Math.max(gone.length, added.length)).padStart(4), 'pixels', (px * 100).toFixed(3) + '%');
  }
  await browser.close();
  server.close();
  fs.writeFileSync(path.join(OUT, 'look.json'), JSON.stringify(rows, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
