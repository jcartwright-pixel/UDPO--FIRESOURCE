'use strict';
// Joe 11-4-26: the Pallet Builder in Operations. The screen is the builder as made, shown after the usual sign-in.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const L = require('../../src/logic');
const PB = require('../../../tools/pallet-builder.cjs');

test('the Pallet Builder screen is made from builder.html, unchanged', () => {
  const src = fs.readFileSync(PB.SRC, 'utf8');
  const page = fs.readFileSync(PB.OUT, 'utf8');
  assert.equal(page, PB.build(src), 'public/pallet-builder.html is out of date: run node tools/pallet-builder.cjs');
  const inside = JSON.parse(page.match(/<script type="application\/json" id="builder-page">([\s\S]*?)<\/script>/)[1]);
  assert.equal(inside, src.replace(/\s+$/, ''));
  assert.match(page, /import \{ requireSignIn \} from '\.\/js\/app\.js'/);
  assert.ok(!/\b(alert|confirm|prompt)\(/.test(src), 'no pop-ups');
});

test('the Pallet Builder is a Plant Distribution screen, so People & Roles can tick it', () => {
  const plant = L.SCREEN_AREAS.find(a => a.key === 'plant');
  assert.ok(plant.screens.some(s => s[0] === 'palletBuilder' && s[2].indexOf('pallet-builder.html') >= 0));
  assert.equal(L.pageGated('pallet-builder.html'), true);
});
