'use strict';
// Throwaway probe (Driver Room TV, 10/29): does the weather radar loop load in a real browser.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch(), p = await browser.newPage();
  for (const u of ['https://radar.weather.gov/ridge/standard/KPBZ_loop.gif', 'https://radar.weather.gov/ridge/standard/KPBZ_0.gif', 'https://radar.weather.gov/ridge/standard/NORTHEAST_loop.gif']) {
    try { const r = await p.goto(u, { timeout: 30000 }); const b = await r.body(); console.log('PROBE', u, r.status(), r.headers()['content-type'], b.length, r.headers()['access-control-allow-origin'] || '', r.headers()['cache-control'] || ''); } catch (e) { console.log('PROBE', u, 'failed', e.message.slice(0, 100)); }
  }
  await p.setContent('<img id="r" src="https://radar.weather.gov/ridge/standard/KPBZ_loop.gif?t=' + Date.now() + '">');
  await p.waitForTimeout(8000);
  console.log('PROBE img', JSON.stringify(await p.evaluate(() => { const i = document.getElementById('r'); return { complete: i.complete, w: i.naturalWidth, h: i.naturalHeight }; })));
  await browser.close();
  process.exit(1);
})();
