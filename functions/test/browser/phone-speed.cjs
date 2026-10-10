/*
 * Times the deployed app the way a phone meets it (Joe 10/10: is the phone side faster than the old ~4.6 s per call?).
 * Opens phone pages at phone size and times server round trips. Sign-in cannot be scripted, so signed-in pages are
 * timed up to their sign-in screen (the page, styles and Firebase are all loaded by then).
 * Usage: node test/browser/phone-speed.cjs https://<project>.web.app <project>
 */
'use strict';
const { chromium } = require('playwright');

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

async function post(url, body) {
  const t = Date.now();
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: body }) });
  await r.text();
  return Date.now() - t;
}

(async () => {
  const [site, project] = process.argv.slice(2);
  const fn = (name) => 'https://us-east4-' + project + '.cloudfunctions.net/' + name;
  const lines = [];
  // Server round trips. The first call can wake a sleeping server, so it is shown on its own.
  const saves = [];
  for (let i = 0; i < 6; i++) saves.push(await post(fn('save'), {}));
  lines.push('Server call (save, refused for no sign-in): first ' + saves[0] + ' ms, then median ' + median(saves.slice(1)) + ' ms');
  // A phone call with a wrong code reads and writes the database once (two only, so the wrong-code limit is never reached).
  const phone = [];
  for (let i = 0; i < 2; i++) phone.push(await post(fn('phone'), { code: 'speed-check', op: 'roster' }));
  lines.push('Phone call with one database step (wrong code): ' + phone.join(' ms, ') + ' ms');

  const browser = await chromium.launch();
  for (const p of ['route.html', 'index.html', 'yard.html', 'quality.html']) {
    const times = [];
    for (let i = 0; i < 3; i++) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      const t = Date.now();
      await page.goto(site + '/' + p, { waitUntil: 'load' });
      await page.waitForFunction(() => [...document.querySelectorAll('#signin, #screen, .phone-card, main, section')].some(e => !e.hidden && e.getBoundingClientRect().height > 0), null, { timeout: 15000 }).catch(() => {});
      times.push(Date.now() - t);
      await ctx.close();
    }
    lines.push('Phone page ' + p + ' ready to use: first ' + times[0] + ' ms, then ' + times.slice(1).join(' ms, ') + ' ms');
  }
  await browser.close();
  console.log(lines.join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
