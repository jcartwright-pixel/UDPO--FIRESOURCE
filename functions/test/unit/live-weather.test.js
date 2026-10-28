'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseLivePage, findLiveWeather, LIVE_PAGE } = require('../../src/live-weather');

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
  assert.deepEqual(ok, { video: 'AbCdEfGhI_1', channel: 'UCbbbbbbbbbbbbbbbbbbbbbb', live: true, embed: true, at: now.toISOString(), problem: '' });
  assert.equal((await findLiveWeather({ now, fetch: async () => ({ ok: false, status: 429 }) })).problem, 'YouTube answered 429');
  assert.equal((await findLiveWeather({ now, fetch: async () => { throw new Error('no internet'); } })).problem, 'no internet');
  assert.match((await findLiveWeather({ now, fetch: async () => ({ ok: true, text: async () => '<html></html>' }) })).problem, /No live video/);
});
