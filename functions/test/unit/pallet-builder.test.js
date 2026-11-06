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

test('the Pallet Builder is its own area (Joe 11-5-26), so People & Roles can tick it', () => {
  const area = L.SCREEN_AREAS.find(a => a.key === 'pallets');
  assert.ok(area && area.screens.some(s => s[0] === 'palletBuilder' && s[2].indexOf('pallet-builder.html') >= 0));
  assert.ok(!L.SCREEN_AREAS.find(a => a.key === 'plant').screens.some(s => s[0] === 'palletBuilder'), 'no longer in Plant Distribution');
  const keys = L.SCREEN_AREAS.map(a => a.key);
  assert.equal(keys.indexOf('pallets'), keys.indexOf('debag') + 1, 'right under Debag / Labeling Room');
  assert.equal(L.pageGated('pallet-builder.html'), true);
});

test('dispensers and boxes ride inside crates (Joe 11-5-26): 54 to a pallet and one crate count going out', () => {
  const src = fs.readFileSync(PB.SRC, 'utf8');
  const vm = require('vm');
  const code = src.match(/^const P = .*$/m)[0] + '\n' + src.match(/^const IN_CRATE = .*$/m)[0] + '\n' + src.match(/^const BY = .*$/m)[0] + '\nthis.BY = BY;';
  const box = {}; vm.runInNewContext(code, box);
  const kinds = new Set();
  box.BY.forEach(p => { if (p.type === 'Box' || p.type === 'Dispenser' || p.type === 'Crate') { kinds.add(p.type); assert.equal(p.cpp, 54, p.desc + ' should go 54 to a pallet'); } });
  assert.deepEqual([...kinds].sort(), ['Box', 'Crate', 'Dispenser']);
  assert.match(src, /out\.Crate \+ out\.Box \+ out\.Dispenser\)\}<\/b> crates/, 'Going out adds dispensers and boxes into the crates');
  assert.ok(!/<\/b> boxes · /.test(src) && !/<\/b> dispensers\$\{/.test(src), 'no separate boxes and dispensers counts going out');
});
