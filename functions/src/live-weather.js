/*
 * The Driver Room TV's live weather (Joe 10/28: "not showing weather"). The TV asked YouTube for "the channel's live stream"
 * by a channel number that was never checked, so YouTube had nothing to play. Every 15 minutes the server now opens FOX
 * Weather's own live page (youtube.com/@Foxweather/live), reads which video is live right now and whether YouTube lets other
 * sites show it, and keeps that with the TV's scores (scorecard/kiosk: live). The TV plays that video; with none, it shows
 * the local weather.
 */
'use strict';

const LIVE_PAGE = 'https://www.youtube.com/@Foxweather/live';

// What the live page says: {video, channel, live, embed} (null where the page does not say).
function parseLivePage(html) {
  const s = String(html || '');
  const pick = (re) => { const m = s.match(re); return m ? m[1] : null; };
  const video = pick(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/) ||
    pick(/"videoDetails":\{"videoId":"([\w-]{11})"/);
  const channel = pick(/<meta itemprop="(?:identifier|channelId)" content="(UC[\w-]{22})"/) || pick(/"externalId":"(UC[\w-]{22})"/) ||
    pick(/"channelId":"(UC[\w-]{22})"/);
  const live = /"isLiveNow":true/.test(s) || /"isLive":true/.test(s);
  const embed = /"playableInEmbed":false/.test(s) ? false : /"playableInEmbed":true/.test(s) ? true : null;
  return { video, channel, live: !!(video && live), embed };
}

async function findLiveWeather({ fetch: f = fetch, now = new Date() } = {}) {
  try {
    const res = await f(LIVE_PAGE, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1' } });
    if (!res.ok) return { video: null, channel: null, live: false, embed: null, at: now.toISOString(), problem: 'YouTube answered ' + res.status };
    const p = parseLivePage(await res.text());
    return Object.assign(p, { at: now.toISOString(), problem: !p.video ? 'No live video on the FOX Weather page' : p.embed === false ? 'FOX Weather does not let other sites show this video' : '' });
  } catch (err) {
    return { video: null, channel: null, live: false, embed: null, at: now.toISOString(), problem: String(err.message || err) };
  }
}

module.exports = { LIVE_PAGE, parseLivePage, findLiveWeather };
