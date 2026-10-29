'use strict';
// Throwaway probe (Driver Room TV, 10/29): how real YouTube answers each way of embedding the weather streams.
const { chromium } = require('playwright');
const ORIGIN = 'https://ud-distribution.web.app';
const UA = 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const TARGETS = [['accu', 'pSRlP1EZiS8', null], ['foxch', null, 'UC1FbPiXx59_ltnFVx7IxWow']];
const page = (mode, t, rp) => `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="box" style="width:640px;height:360px"><div id="p"></div></div><script>
window.out = { events: [] };
const vid = ${JSON.stringify(t[1])}, ch = ${JSON.stringify(t[2])};
function ready() {
  const ev = { onReady: e => { out.events.push('ready'); e.target.mute(); e.target.playVideo(); }, onStateChange: e => out.events.push('state ' + e.data), onError: e => out.events.push('error ' + e.data) };
  if (${JSON.stringify(mode)} === 'wrap') {
    document.getElementById('p').outerHTML = '<iframe id="p" width="640" height="360" allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" src="https://www.youtube.com/embed/' + (ch ? 'live_stream?channel=' + ch + '&' : vid + '?') + 'autoplay=1&mute=1&enablejsapi=1&origin=' + encodeURIComponent(location.origin) + '"></iframe>';
    new YT.Player('p', { events: ev });
  } else {
    const o = { width: 640, height: 360, playerVars: { autoplay: 1, mute: 1, playsinline: 1, origin: location.origin }, events: ev };
    if (${JSON.stringify(mode)} === 'nocookie') o.host = 'https://www.youtube-nocookie.com';
    if (ch) { o.playerVars.channel = ch; o.videoId = 'live_stream'; } else o.videoId = vid;
    new YT.Player('p', o);
  }
}
window.onYouTubeIframeAPIReady = ready;
</script><script src="https://www.youtube.com/iframe_api"></script></body></html>`;
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const rp of ['same-origin', '']) for (const mode of ['wrap', 'api', 'nocookie']) for (const t of TARGETS) {
    const ctx = await browser.newContext({ userAgent: UA });
    const p = await ctx.newPage();
    const reqs = [];
    p.on('request', r => { if (/youtube(-nocookie)?\.com\/embed/.test(r.url())) reqs.push(r.headers().referer || '(no referer)'); });
    await p.route(ORIGIN + '/probe.html', route => route.fulfill({ contentType: 'text/html', headers: rp ? { 'Referrer-Policy': rp } : {}, body: page(mode, t, rp) }));
    try { await p.goto(ORIGIN + '/probe.html'); await p.waitForTimeout(15000); } catch (e) { console.log('PROBE', rp, mode, t[0], 'goto failed', e.message); }
    const out = await p.evaluate(() => window.out).catch(() => null);
    let title = '';
    try { const f = p.frames().find(x => /youtube/.test(x.url())); if (f) title = (await f.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 200); } catch (e) { title = 'frame unreadable'; }
    console.log('PROBE', 'policy=' + (rp || 'none'), mode, t[0], JSON.stringify(out && out.events), 'referer=' + reqs.join(','), 'text=' + title);
    await ctx.close();
  }
  await browser.close();
  // Stop the run here so the results are the last lines of the log.
  process.exit(1);
})();
