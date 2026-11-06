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
  assert.match(page, /import \{ requireSignIn[^}]*\} from '\.\/js\/app\.js'/);
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

test('route totals sit right under the stop list beside the truck, without the no-weight and case-count notes (Joe 11-5-26)', () => {
  const src = fs.readFileSync(PB.SRC, 'utf8');
  const right = src.indexOf('<div class="lm-right">'), list = src.indexOf('id="lmTable"'), totals = src.indexOf('aria-label="Load plan"'), orders = src.indexOf('aria-label="Orders"');
  assert.ok(right > 0 && right < list && list < totals && totals < orders, 'Route totals and load plan comes right after the stop list, in the same column, before Orders');
  assert.ok(!/has no weight, so it's left out/.test(src), 'no "has no weight" notes');
  assert.ok(!/Each unit is counted as its own case\./.test(src), 'no "case count not set" notes');
  assert.match(src, /isn't in the product list, so it isn't counted/, 'a product missing from the list is still named');
});

test('no separate Load sequences section: the truck load map stop list already shows it (Joe 11-5-26)', () => {
  const src = fs.readFileSync(PB.SRC, 'utf8');
  assert.ok(!/Load sequences on this route/.test(src) && !/id="seqTable"/.test(src));
  assert.match(src, /id="lmTable"/, 'the truck load map stop list stays');
});

test('grouped stops (Joe 11-5-26, mock-up 3): a colored bar per load sequence and shared customers indented under the BOL one', () => {
  const src = fs.readFileSync(PB.SRC, 'utf8');
  assert.match(src, /<td class="grp" style="background:\$\{seqColor\(/, 'each stop row has a bar in its sequence color');
  assert.match(src, /#lmTable tr\.kid td\.cn\{padding-left:34px\}/, 'a shared customer is indented');
  assert.match(src, /\.lm-plan\{[^}]*background:var\(--accent-soft\)/, 'route totals sit in the light blue box');
});

test('Joe 11-5-26 tweaks: pallets beside cases, the truck stays in view, a stop lights up its pallets, shared customers have no Side or Note box', () => {
  const src = fs.readFileSync(PB.SRC, 'utf8');
  assert.match(src, /cs<span class="pals"> · \$\{pals\} pallet/, 'pallets beside cases');
  assert.match(src, /\.lm-left\{position:sticky/, 'the truck stays in view');
  assert.match(src, /function lightUp\(g\)/, 'pointing at a stop lights up its pallets');
  assert.match(src, /\$\{kid \? `<td><\/td>/, 'no Side or Note box on a shared customer');
});

// The Pallet Builder screen's bridge to the Customer List's route map, run with a stand-in for its server call.
function bridgeWith(answer) {
  const page = fs.readFileSync(PB.OUT, 'utf8');
  const code = page.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/import \{[^}]*\} from '\.\/js\/(app|firebase)\.js';/g, '');
  const calls = [], window = {};
  const callServer = async (name, data) => { calls.push([name, JSON.parse(JSON.stringify(data))]); return answer(data); };
  new Function('window', 'document', 'requireSignIn', 'callServer', 'currentPlant', 'serverText', code)(window, {}, () => {}, callServer, () => 'fac_uniontown', (e) => e.message);
  return { map: window.udRouteMap, calls };
}
const DAY = () => ({ customers: { 40496: { account: '40496', name: 'SAMPLE CONE SHOP', chain: 'SAMPLE CHAIN' } }, canEdit: true,
  routeDays: [{ route: '813', day: 'THU', rev: 4, updatedAt: '2026-11-05T20:46:00.000Z', stops: [{ key: '16175', account: '16175', name: 'SAMPLE MARKET', loadSeq: 2, note: 'Back door' }, { key: '40496', account: '40496', name: 'SAMPLE CONE', loadSeq: 9, note: '' }] }] });

test('Save to route map (Joe 11-6-26): the route map comes from the Customer List, with chains, and a save sends only the new load sequences', async () => {
  const day = DAY();
  const { map, calls } = bridgeWith(d => d.op === 'view' ? day : { ok: true, routeDay: Object.assign({}, day.routeDays[0], { rev: 5, stops: d.stops }) });
  const m = await map.load('813', 'THU');
  assert.equal(m.found, true); assert.equal(m.rev, 4); assert.equal(m.canEdit, true);
  assert.deepEqual(m.stops.map(s => [s.account, s.chain, s.loadSeq]), [['16175', '', 2], ['40496', 'SAMPLE CHAIN', 9]]);
  assert.equal((await map.load('813', 'MON')).found, false, 'a day not on the route map');
  const n = await map.save('813', 'THU', 4, { 40496: 8 });
  const [name, sent] = calls[calls.length - 1];
  assert.equal(name, 'customerList');
  assert.equal(sent.op, 'saveRouteDay'); assert.equal(sent.plant, 'fac_uniontown'); assert.equal(sent.rev, 4);
  assert.deepEqual(sent.stops, [{ key: '16175', loadSeq: 2, note: 'Back door' }, { key: '40496', loadSeq: 8, note: '' }], 'same stops, same order, notes kept, one new sequence');
  assert.equal(n.rev, 5);
  assert.equal(calls.filter(c => c[1].op === 'view').length, 1, 'the Customer List is read once');
});

test('Save to route map: someone else saved first, so it says so and reads the route map again', async () => {
  let views = 0;
  const { map } = bridgeWith(d => { if (d.op === 'view') { views++; return DAY(); } const e = new Error('Someone else changed route 813 Thursday a moment ago.'); e.code = 'functions/aborted'; throw e; });
  await map.load('813', 'THU');
  await assert.rejects(map.save('813', 'THU', 4, { 40496: 8 }), e => e.changed === true && /Someone else changed route 813/.test(e.message));
  await map.load('813', 'THU');
  assert.equal(views, 2);
});

test('Print sequence changes and Save to route map are on the truck load map; only the sheet prints', () => {
  const src = fs.readFileSync(PB.SRC, 'utf8');
  assert.match(src, /<button id="lmPrint">Print sequence changes<\/button>/);
  assert.match(src, /<button class="primary" id="lmSave">Save to route map<\/button>/);
  assert.match(src, /@media print\{[^\n]*\.wrap,\.toast\{display:none!important\}#printSheet\{display:block/);
  assert.match(src, /<th>Chain<\/th><th>Account #<\/th><th>Customer<\/th><th class="n">New sequence<\/th>/);
});

test('Pallet Builder opens with the newest BOL from the Hub (Joe 11-6-26, lb), shaped like the BOL built in', () => {
  const { window } = (() => { const page = fs.readFileSync(PB.OUT, 'utf8');
    const code = page.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/import \{[^}]*\} from '\.\/js\/(app|firebase)\.js';/g, '');
    const window = { UDLogic: L }; new Function('window', 'document', 'requireSignIn', 'callServer', 'currentPlant', 'serverText', code)(window, {}, () => {}, async () => ({}), () => 'fac_uniontown', (e) => e.message);
    return { window }; })();
  const day = { date: '2026-11-09', received: '2026-11-09T20:00:00.000Z', routes: [
    { route: '805', stops: [{ seq: 0, custNo: '1001', name: 'MADEUP GOLF CENTER', lines: [{ item: '908', desc: 'UD 3.25 BMILK PLS HGL', qty: 6 }] }, { seq: 2, custNo: '1002', name: 'SAMPLE FOOD MART', lines: [{ item: '305', desc: 'UD 2% GAL', qty: 20 }] }] }] };
  const b = window.udBolShape(day);
  assert.equal(b.key, 'udpb-hub-2026-11-09'); assert.equal(b.label, '11-9-26');
  assert.deepEqual(b.routes, [{ route: 'RT 805 \u00b7 11/09/26', bolAt: '2026-11-09T20:00:00.000Z', stops: [
    { name: 'MADEUP GOLF CENTER (sub-rt 00)', acct: '1001', lines: [['908', 6]] }, { name: 'SAMPLE FOOD MART (sub-rt 02)', acct: '1002', lines: [['305', 20]] }] }]);
  assert.equal(window.udBolShape({ date: '2026-11-09', routes: [] }), null, 'an empty BOL leaves the built-in one');
  const src = fs.readFileSync(PB.SRC, 'utf8');
  assert.match(src, /window\.parent\.udBol/, 'the builder takes the BOL the screen hands it');
  assert.match(src, /const key = HUBBOL \? HUBBOL\.key : DAYKEY, day = HUBBOL \? HUBBOL\.routes : BOLDAY;/, 'and keeps its own BOL when there is none');
});
