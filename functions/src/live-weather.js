/*
 * The Driver Room TV's live weather (Joe 10/28: "not showing weather"). The TV asked YouTube for "the channel's live stream"
 * by a channel number that was never checked, so YouTube had nothing to play. Every 15 minutes the server now opens FOX
 * Weather's own live page (youtube.com/@Foxweather/live), reads which video is live right now and whether YouTube lets other
 * sites show it, and keeps that with the TV's scores (scorecard/kiosk: live). The TV plays that video; with none, it shows
 * the local weather.
 * 10/28 (6.70 full test: "No live video on the FOX Weather page"): YouTube writes its pages more than one way, so the video
 * is looked for in every place the page can name it, then on the channel's Live list (@Foxweather/streams), and the real
 * channel number is kept so the TV can still ask for "the channel's live stream". What the server got back (the page's
 * title and address, a sign-in or cookie page) is kept in live.page so the next look starts from facts.
 */
'use strict';

const CHANNEL = 'https://www.youtube.com/@Foxweather';
const LIVE_PAGE = CHANNEL + '/live';
const STREAMS_PAGE = CHANNEL + '/streams';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' };

const first = (s, res) => { for (const re of res) { const m = s.match(re); if (m) return m[1]; } return null; };

// What the live page says: {video, channel, live, embed} (null where the page does not say).
function parseLivePage(html) {
  const s = String(html || '');
  const video = first(s, [
    /<link[^>]*rel="canonical"[^>]*href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})/,
    /<link[^>]*href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})[^>]*rel="canonical"/,
    /<meta[^>]*property="og:url"[^>]*content="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})/,
    /"videoDetails":\{"videoId":"([\w-]{11})"/,
    /"liveStreamabilityRenderer":\{"videoId":"([\w-]{11})"/
  ]);
  const channel = first(s, [/<meta itemprop="(?:identifier|channelId)" content="(UC[\w-]{22})"/, /"externalId":"(UC[\w-]{22})"/,
    /"channelId":"(UC[\w-]{22})"/, /"browseId":"(UC[\w-]{22})"/, /youtube\.com\/channel\/(UC[\w-]{22})/]);
  // A video on the live page is the live one unless the page says it has not started yet.
  const live = !!video && !/"isUpcoming":true/.test(s);
  const embed = /"playableInEmbed":false/.test(s) ? false : /"playableInEmbed":true/.test(s) ? true : null;
  return { video, channel, live, embed };
}

// The channel's Live list: the first video marked LIVE now.
function parseStreamsPage(html) {
  const s = String(html || '');
  for (let i = s.indexOf('LIVE_NOW'); i >= 0; i = s.indexOf('LIVE_NOW', i + 8)) {
    const at = s.lastIndexOf('"videoId":"', i);
    if (at >= 0) { const m = s.slice(at).match(/^"videoId":"([\w-]{11})"/); if (m) return m[1]; }
  }
  return null;
}

// What came back, in a few words: the page's title and address, and whether YouTube sent a sign-in or cookie page instead.
function describePage(res, html) {
  const s = String(html || ''), title = (s.match(/<title>([^<]{0,120})/) || [])[1] || '';
  const note = /consent\.youtube\.com|Before you continue/i.test((res.url || '') + s.slice(0, 20000)) ? 'cookie page' :
    /not a bot|unusual traffic/i.test(s) ? 'sign-in check' : '';
  return [title.trim(), res.url || '', s.length + ' letters', note].filter(Boolean).join(' · ');
}

async function findLiveWeather({ fetch: f = fetch, now = new Date() } = {}) {
  const out = (o) => Object.assign({ video: null, channel: null, live: false, embed: null, page: '', problem: '' }, o, { at: now.toISOString() });
  try {
    const res = await f(LIVE_PAGE, { headers: HEADERS });
    if (!res.ok) return out({ problem: 'YouTube answered ' + res.status });
    const html = await res.text(), p = parseLivePage(html), page = describePage(res, html);
    if (!p.video) {
      try {
        const sr = await f(STREAMS_PAGE, { headers: HEADERS });
        const v = sr.ok ? parseStreamsPage(await sr.text()) : null;
        if (v) return out(Object.assign(p, { video: v, live: true, page }));
      } catch (e) { /* the live page's answer stands */ }
    }
    return out(Object.assign(p, { page, problem: !p.video ? 'No live video on the FOX Weather page' : p.embed === false ? 'FOX Weather does not let other sites show this video' : '' }));
  } catch (err) {
    return out({ problem: String(err.message || err) });
  }
}

module.exports = { LIVE_PAGE, STREAMS_PAGE, parseLivePage, parseStreamsPage, findLiveWeather };
