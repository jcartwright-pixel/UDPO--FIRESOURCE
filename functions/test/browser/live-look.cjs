/*
 * Opens the deployed home page the way a visitor's browser does and reports whether its styles applied.
 * Sign-in cannot be scripted, so it shows the signed-in layout (with no numbers) by un-hiding it.
 * Prints the measurements, and a small JPEG of the page as base64 between LIVE-PICTURE markers.
 * Usage: node test/browser/live-look.cjs https://<project>.web.app
 */
'use strict';
const { chromium } = require('playwright');

(async () => {
  const url = process.argv[2];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 950 }, deviceScaleFactor: 0.5 });
  const problems = [];
  page.on('pageerror', e => problems.push('page error: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('response', r => { if (r.status() >= 400) problems.push('HTTP ' + r.status() + ' ' + r.url()); });
  await page.goto(url + '/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => { document.querySelectorAll('[hidden]').forEach(el => { if (el.id === 'screen') el.hidden = false; }); const s = document.getElementById('signin'); if (s) s.hidden = true; });
  await page.waitForTimeout(500);
  const look = await page.evaluate(() => {
    const size = (sel) => { const el = document.querySelector(sel); if (!el) return 'missing'; const b = el.getBoundingClientRect(); return Math.round(b.width) + 'x' + Math.round(b.height); };
    return {
      stylesheets: [...document.styleSheets].map(s => { let n = -1; try { n = s.cssRules.length; } catch (e) { n = 'blocked'; } return s.href + ' rules=' + n; }),
      titleIcon: size('.dtitle-icon svg'),
      logo: size('.brand img'),
      header: size('.topbar'),
      cards: document.querySelectorAll('.card.dc').length,
      firstCard: size('.card.dc'),
      pageHeight: document.scrollingElement.scrollHeight
    };
  });
  const jpg = await page.screenshot({ type: 'jpeg', quality: 50 });
  console.log('LIVE-PICTURE-START');
  const b64 = jpg.toString('base64');
  for (let i = 0; i < b64.length; i += 4000) console.log(b64.slice(i, i + 4000));
  console.log('LIVE-PICTURE-END');
  console.log('LIVE-LOOK ' + JSON.stringify(look, null, 1));
  console.log('LIVE-PROBLEMS ' + JSON.stringify(problems));
  await browser.close();
  const ok = look.titleIcon !== 'missing' && parseInt(look.titleIcon, 10) <= 40 && (look.logo === 'missing' || parseInt(look.logo.split('x')[1], 10) <= 60) && look.cards === 4; // Joe 10/9: the home is four cards (Dispatch, Drivers & Vacations, Equipment, Check-ins & Overall)
  if (!ok) { console.log('::error::The live home page styles did not apply: ' + JSON.stringify(look)); process.exit(1); }
  console.log('Live home page styles applied');
})().catch(e => { console.error(e); process.exit(1); });
