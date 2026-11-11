'use strict';
// Joe 11-9-26: "the live copy ... that's the only thing it should open unless I want to open the test."
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '../../../public/js/practice-gate.js')).href);
const store = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; };
const at = (url) => { const u = new URL(url); return { hostname: u.hostname, pathname: u.pathname, search: u.search, hash: u.hash }; };

test('the live hub never moves', async () => {
  const { practiceGate } = await load();
  assert.equal(practiceGate(at('https://ud-distribution-hub.web.app/people.html'), store()), '');
  assert.equal(practiceGate(at('http://localhost:5000/index.html?practicetest=1'), store()), '', 'the local tests stay put');
});

test('the practice hub goes to the same screen on the live hub unless it was chosen', async () => {
  const { practiceGate, LIVE_HUB } = await load();
  assert.equal(practiceGate(at('https://ud-distribution-sandbox-hub.web.app/'), store()), LIVE_HUB + '/');
  assert.equal(practiceGate(at('https://ud-distribution-sandbox-hub.web.app/people.html?x=2#area=fleet'), store()), LIVE_HUB + '/people.html?x=2#area=fleet');
});

test('picking the practice hub keeps it for that tab', async () => {
  const { practiceGate, PRACTICE_HUB } = await load();
  const s = store();
  assert.equal(practiceGate(at(PRACTICE_HUB), s), '', 'the ?practice=1 address opens the practice hub');
  assert.equal(practiceGate(at('https://ud-distribution-sandbox-hub.web.app/keys.html'), s), '', 'and the next screen in that tab stays on it');
  assert.notEqual(practiceGate(at('https://ud-distribution-sandbox-hub.web.app/keys.html'), store()), '', 'a new window that did not pick it goes live');
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(practiceGate(at(PRACTICE_HUB), broken), '', 'no storage: the ?practice=1 address still opens it');
});
