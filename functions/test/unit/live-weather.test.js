'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseLivePage, parseStreamsPage, findLiveWeather, LIVE_PAGE, STREAMS_PAGE } = require('../../src/live-weather');

// Joe 10/28 ("not showing weather"): the server reads FOX Weather's YouTube live page for the video the TV plays.
const LIVE_HTML = '<html><head><link rel="canonical" href="https://www.youtube.com/watch?v=AbCdEfGhI_1"><meta itemprop="identifier" content="UCbbbbbbbbbbbbbbbbbbbbbb"></head>' +
  '<script>var ytInitialPlayerResponse = {"playabilityStatus":{"status":"OK","playableInEmbed":true},"videoDetails":{"videoId":"AbCdEfGhI_1","isLive":true},"microformat":{"isLiveNow":true}};</script></html>';

test('a live FOX Weather page gives its video, channel and that other sites may show it', () => {
  assert.deepEqual(parseLivePage(LIVE_HTML), { video: 'AbCdEfGhI_1', channel: 'UCbbbbbbbbbbbbbbbbbbbbbb', live: true, embed: true });
});

test('a video other sites may not show, and a page with nothing live', () => {
  assert.equal(parseLivePage(LIVE_HTML.replace('"playableInEmbed":true', '"playableInEmbed":false')).embed, false);
  const off = parseLivePage('<link rel="canonical" href="https://www.youtube.com/channel/UCbbbbbbbbbbbbbbbbbbbbbb"><script>{"externalId":"UCbbbbbbbbbbbbbbbbbbbbbb"}</script>');
  assert.deepEqual(off, { video: null, channel: 'UCbbbbbbbbbbbbbbbbbbbbbb', live: false, embed: null });
});

test('findLiveWeather asks FOX Weather\'s live page and never throws', async () => {
  const now = new Date('2026-10-28T21:00:00Z');
  let asked = '';
  const ok = await findLiveWeather({ now, fetch: async (u) => { asked = u; return { ok: true, text: async () => LIVE_HTML }; } });
  assert.equal(asked, LIVE_PAGE);
  assert.deepEqual(Object.assign({}, ok, { page: '' }), { video: 'AbCdEfGhI_1', channel: 'UCbbbbbbbbbbbbbbbbbbbbbb', live: true, embed: true, page: '', at: now.toISOString(), problem: '' });
  assert.equal((await findLiveWeather({ now, fetch: async () => ({ ok: false, status: 429 }) })).problem, 'YouTube answered 429');
  assert.equal((await findLiveWeather({ now, fetch: async () => { throw new Error('no internet'); } })).problem, 'no internet');
  assert.match((await findLiveWeather({ now, fetch: async () => ({ ok: true, text: async () => '<html></html>' }) })).problem, /No live video/);
});

// 6.70 full test: "No live video on the FOX Weather page". The page can name the video other ways, and the channel's Live list
// has it too; what came back is kept so the next look starts from facts.
test('the video is found in the other places a page can name it', () => {
  assert.equal(parseLivePage('<meta property="og:url" content="https://www.youtube.com/watch?v=OgUrlVideo1">').video, 'OgUrlVideo1');
  assert.equal(parseLivePage('<link href="https://www.youtube.com/watch?v=HrefFirst01" rel="canonical">').video, 'HrefFirst01');
  assert.equal(parseLivePage('{"liveStreamabilityRenderer":{"videoId":"Streamable1"}}').video, 'Streamable1');
  assert.equal(parseLivePage('{"videoDetails":{"videoId":"NotYetLive1"},"isUpcoming":true}').live, false);
  assert.equal(parseLivePage('{"browseId":"UCcccccccccccccccccccccc"}').channel, 'UCcccccccccccccccccccccc');
  assert.equal(parseStreamsPage('{"videoId":"OldVideo001","x":1},{"videoId":"LiveNow0001","badges":[{"style":"BADGE_STYLE_TYPE_LIVE_NOW"}]}'), 'LiveNow0001');
  assert.equal(parseStreamsPage('{"videoId":"OldVideo001"}'), null);
});

test('with nothing on the live page, the Live list is asked; what came back is described', async () => {
  const now = new Date('2026-10-28T23:00:00Z'), asked = [];
  const f = async (u) => { asked.push(u); return { ok: true, url: u, text: async () => u === LIVE_PAGE ? '<title>FOX Weather - YouTube</title>{"externalId":"UCdddddddddddddddddddddd"}' : '{"videoId":"LiveNow0001","style":"BADGE_STYLE_TYPE_LIVE_NOW"}' }; };
  const r = await findLiveWeather({ now, fetch: f });
  assert.deepEqual(asked, [LIVE_PAGE, STREAMS_PAGE]);
  assert.deepEqual([r.video, r.channel, r.live, r.problem], ['LiveNow0001', 'UCdddddddddddddddddddddd', true, '']);
  assert.match(r.page, /FOX Weather - YouTube · https:\/\/www\.youtube\.com\/@Foxweather\/live/);
  const none = await findLiveWeather({ now, fetch: async (u) => ({ ok: true, url: 'https://consent.youtube.com/m?x', text: async () => '<title>Before you continue to YouTube</title>' }) });
  assert.match(none.problem, /No live video/);
  assert.match(none.page, /cookie page/);
});
