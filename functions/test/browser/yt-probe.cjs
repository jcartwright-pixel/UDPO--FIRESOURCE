'use strict';
// Throwaway probe (Driver Room TV, 10/29): which free weather live streams are live now and play on another site.
const { chromium } = require('playwright');
const ORIGIN = 'https://ud-distribution.web.app';
const UA = 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const HANDLES = ['accuweather', 'Foxweather', 'WeatherNationTV', 'weatherchannel', 'NWSWPC', 'RyanHallYall', 'MaxVelocityWX', 'LiveStormChasers', 'WPXI', 'KDKA', 'WTAE'];
const page = (vid, ch) => `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="p"></div><script>
window.out = [];
window.onYouTubeIframeAPIReady = () => {
  const o = { width: 640, height: 360, playerVars: { autoplay: 1, mute: 1, playsinline: 1, origin: location.origin },
    events: { onReady: e => { out.push('ready'); e.target.mute(); e.target.playVideo(); }, onStateChange: e => out.push('state ' + e.data), onError: e => out.push('error ' + e.data) } };
  if (${JSON.stringify(ch)}) { o.videoId = 'live_stream'; o.playerVars.channel = ${JSON.stringify(ch)}; } else o.videoId = ${JSON.stringify(vid)};
  new YT.Player('p', o);
};
</script><script src="https://www.youtube.com/iframe_api"></script></body></html>`;
async function tryEmbed(browser, vid, ch) {
  const ctx = await browser.newContext({ userAgent: UA }), p = await ctx.newPage();
  await p.route(ORIGIN + '/probe.html', r => r.fulfill({ contentType: 'text/html', body: page(vid, ch) }));
  let out = null, text = '';
  try { await p.goto(ORIGIN + '/probe.html'); await p.waitForTimeout(12000); out = await p.evaluate(() => window.out); const f = p.frames().find(x => /youtube/.test(x.url())); if (f) text = (await f.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 120); } catch (e) { text = 'failed ' + e.message.slice(0, 80); }
  await ctx.close();
  return JSON.stringify(out) + ' ' + text;
}
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const h of HANDLES) {
    const ctx = await browser.newContext({ userAgent: UA, locale: 'en-US' }), p = await ctx.newPage();
    let info = {};
    try {
      await p.goto('https://www.youtube.com/@' + h + '/live', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await p.waitForTimeout(3000);
      info = await p.evaluate(() => { const h = document.documentElement.innerHTML; const m = (re) => (h.match(re) || [])[1] || '';
        return { url: location.href, title: document.title, vid: m(/"videoDetails":\{"videoId":"([\w-]{11})"/) || (location.href.match(/v=([\w-]{11})/) || [])[1] || '', ch: m(/"channelId":"(UC[\w-]{22})"/) || m(/"externalId":"(UC[\w-]{22})"/),
          live: /"isLive":true/.test(h), liveContent: /"isLiveContent":true/.test(h), embed: m(/"playableInEmbed":(true|false)/), bot: /not a bot/i.test(h) }; });
    } catch (e) { info = { err: e.message.slice(0, 100) }; }
    await ctx.close();
    console.log('PROBE', h, JSON.stringify(info));
    if (info.vid) console.log('PROBE', h, 'video', info.vid, await tryEmbed(browser, info.vid, null));
    if (info.ch) console.log('PROBE', h, 'channel', info.ch, await tryEmbed(browser, null, info.ch));
  }
  await browser.close();
  // Stop the run here so the results are the last lines of the log.
  process.exit(1);
})();
