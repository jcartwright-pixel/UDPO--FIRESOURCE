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

// Joe 11-6-26 ("provisions"): the numbers follow Pallet Rules (crates 54 a pallet, dispensers 45, a box in a crate) unless the
// Product Sheet has the product's own; going out still adds dispensers and boxes into the one crate count.
function rulesBox(sheet) {
  const src = fs.readFileSync(PB.SRC, 'utf8'), vm = require('vm');
  const at = src.indexOf('const RULES0'), end = src.indexOf("const WD = ['SUN'");
  const code = src.match(/^const P = .*$/m)[0] + '\n' + src.match(/^const IN_CRATE = .*$/m)[0] + '\n' + src.match(/^const BY = .*$/m)[0] + '\n' +
    src.slice(at, end) + '\nthis.BY = BY; this.applyRules = applyRules; this.caseStats = caseStats; this.heldOf = heldOf; this.ruleMax = ruleMax; this.set = (r) => { RULES = Object.assign({}, RULES0, r); applyRules(); };';
  const box = { window: { parent: { udProducts: sheet || {} } } }; box.window.parent.parent = box.window.parent; vm.runInNewContext(code, box);
  return box;
}
test('Pallet Rules set the pallets (Joe 11-6-26): crates 54, dispensers 45, a box goes in a crate; one crate count going out', () => {
  const src = fs.readFileSync(PB.SRC, 'utf8');
  const box = rulesBox();
  const kinds = new Set();
  box.BY.forEach(p => { if (p.type === 'Box' || p.type === 'Dispenser' || p.type === 'Crate') { kinds.add(p.type); assert.equal(p.cpp, p.type === 'Dispenser' ? 45 : 54, p.desc); } });
  assert.deepEqual([...kinds].sort(), ['Box', 'Crate', 'Dispenser']);
  box.set({ cratesPerPallet: 56, dispensersPerPallet: 40, boxIsCrate: false });
  const one = (t) => [...box.BY.values()].find(p => p.type === t);
  assert.equal(one('Crate').cpp, 56); assert.equal(one('Dispenser').cpp, 40); assert.equal(one('Box').cpp, one('Box').cpp0, 'a box on its own keeps its own number');
  assert.match(src, /out\.Crate \+ out\.Box \+ out\.Dispenser\)\}<\/b> crates/, 'Going out adds dispensers and boxes into the crates');
  assert.ok(!/<\/b> boxes · /.test(src) && !/<\/b> dispensers\$\{/.test(src), 'no separate boxes and dispensers counts going out');
});

test('the Product Sheet wins by SKU: units in a case, cases to a pallet and the weight of a full case', () => {
  const box = rulesBox({ 255203: { unitsPerCase: 3, casesPerPallet: 40, caseNetLbs: 60 } });
  const p = box.BY.get('255203');
  assert.equal(p.upc, 3); assert.equal(p.cpp, 40); assert.equal(p.uw, 20);
  const other = [...box.BY.values()].find(x => x.type === 'Crate');
  assert.equal(other.cpp, 54, 'a product the Product Sheet leaves blank follows Pallet Rules');
});

test('each customer\'s space is held for the HIGHEST CASES AVERAGE unless PALLET USES picks another (Joe 11-9-26)', () => {
  const box = rulesBox();
  const weeks = [['2026-10-03', 46], ['2026-10-10', 9], ['2026-10-17', 21], ['2026-10-24', 25], ['2026-10-31', 25.5]];
  const st = box.caseStats(weeks, 5);
  assert.deepEqual([st.LOW, st.MIDDLE, st.AVERAGE, st.HIGH, st.LAST, st.weeks], [9, 25, 25.3, 46, 25.3, 5]);
  // 46, 25.5, 25, 21, 9: drop the 46, (25.5 + 25 + 21 + 9) / 4 = 20.1, rounded up to 21.
  assert.equal(st.HCA, 21, 'the highest cases average');
  assert.equal(box.heldOf(st, ''), 21, 'the standard is the highest cases average');
  assert.equal(box.heldOf(st, 'HIGH'), 46, 'PALLET USES can still pick HIGH');
  assert.equal(box.caseStats([['2026-08-01', 90]].concat(weeks), 5).HCA, 21, 'a week older than 8 weeks is left out');
  assert.equal(box.heldOf(st, 'AVERAGE'), 26, 'rounded up to whole cases');
  assert.equal(box.heldOf(null, ''), 0, 'no weeks, no space held');
});

// Joe 11-8-26 RULE SET: the 5 highest weeks in 8 weeks (Joe 11-9-26; it was 6 months), the top one thrown out, the other 4 averaged and rounded up;
// it never comes down until it is a year old (seasonal customers). For sequence changes only, not the day's pallets.
test('RULE SET MAX: top 5 weeks of the last 8 weeks, drop the top one, average 4, rounded up (Joe 11-8-26)', () => {
  const box = rulesBox();
  const weeks = [['2026-09-05', 62], ['2026-09-12', 55], ['2026-09-19', 54], ['2026-09-26', 52], ['2026-10-03', 51], ['2026-10-10', 20], ['2026-10-17', 30]];
  const r = box.ruleMax(weeks);
  assert.equal(r.MAX, 53); assert.equal(r.now, 53); assert.equal(r.held, false);
  assert.equal(box.ruleMax([['2026-07-04', 99]].concat(weeks)).now, 53, 'a week more than 8 weeks back does not count');
  assert.equal(box.ruleMax([['2026-10-03', 10], ['2026-10-10', 11]]).MAX, 10, 'two weeks: drop the top, keep the other');
  assert.equal(box.ruleMax([['2026-10-03', 9]]).MAX, 9, 'one week: that week');
  assert.equal(box.ruleMax([]), null);
  assert.equal(box.ruleMax([['2026-01-03', 1], ['2026-01-10', 2], ['2026-01-17', 3], ['2026-01-24', 4], ['2026-01-31', 5]].map(x => x)).MAX, 3, '(4+3+2+1)/4 = 2.5 rounds up to 3');
});

test('RULE SET seasonal hold: the maximum stays up until it is a year old, then comes down (Joe 11-8-26)', () => {
  const box = rulesBox();
  const busy = [['2026-06-06', 40], ['2026-06-13', 40], ['2026-06-20', 40], ['2026-06-27', 40], ['2026-07-04', 40]];
  const slow = []; for (let d = new Date('2026-07-11'); d <= new Date('2027-05-01'); d.setDate(d.getDate() + 7)) slow.push([d.toISOString().slice(0, 10), 5]);
  const held = box.ruleMax(busy.concat(slow));
  assert.equal(held.MAX, 40, 'still the busy-season number in the winter'); assert.equal(held.now, 5); assert.equal(held.held, true);
  assert.equal(held.at, '2026-07-25', 'the last week all 5 busy weeks were still in its 8 weeks');
  const later = slow.slice(); for (let d = new Date('2027-05-08'); d <= new Date('2028-01-15'); d.setDate(d.getDate() + 7)) later.push([d.toISOString().slice(0, 10), 5]);
  assert.equal(box.ruleMax(busy.concat(later)).MAX, 5, 'a year later it comes down');
  const src = fs.readFileSync(PB.SRC, 'utf8');
  assert.match(src, /<button id="ruleSetBtn" aria-expanded="false">RULE SET<\/button>/);
  assert.match(src, /The pallets the builder makes each day hold space at the highest cases average\./);
  assert.match(src, /<span>HIGHEST CASES AVERAGE, 8 WEEKS<\/span>/, 'the standard is not a choice in Pallet Rules');
  assert.match(src, /title="Rule Set maximum: for sequence changes">Max<\/th>/, 'the truck load map shows the maximum for sequence changes');
  assert.ok(!/ruleMax|\.max\b/.test(src.slice(src.indexOf('function plan(){'), src.indexOf('function plan(){') + 3000)), 'the day\'s pallets do not use it');
});

test('held space is shaded on the truck, more cases add space, and the customers on the route sit at the very top', () => {
  const src = fs.readFileSync(PB.SRC, 'utf8');
  const top = src.indexOf('aria-label="Customers on this route"'), routes = src.indexOf('aria-label="All routes"');
  assert.ok(top > 0 && top < routes, 'CUSTOMERS ON THIS ROUTE is above All routes');
  assert.match(src, /<th>LOW<\/th><th>MIDDLE<\/th><th>AVERAGE<\/th><th>HIGH<\/th><th>LAST \$\{RULES\.weeks\} WEEKS<\/th><th>HIGHEST CASES AVERAGE<\/th><th>RULE SET MAX<\/th><th>PALLET USES<\/th><th>HELD FOR<\/th><th>TODAY'S BOL<\/th><th>SPACE<\/th>/);
  assert.match(src, /class="held" data-g=/, 'held stacks are drawn shaded');
  assert.match(src, /OVER BY \$\{fmt\(h\.cases - h\.held\)\} · SPACE ADDED/);
  assert.match(src, /if \(!h \|\| RULES\.under !== 'KEEP'\) return;/, 'space is held only while Pallet Rules keep it');
  assert.match(src, /<button id="rulesBtn" aria-expanded="false">PALLET RULES<\/button>/);
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
  assert.match(src, /<td class="grp" style="background:\$\{stopColor\(/, 'each stop row has a bar in its sequence color');
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
  const code = page.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/import \{[^}]*\} from '\.\/js\/(app|firebase|products)\.js';/g, '');
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
  assert.match(src, /<button class="save" id="lmSave" type="button">SAVE TO ROUTE MAP<\/button>/, 'one big SAVE at the top (Joe 11-7-26)');
  assert.match(src, /@media print\{[^\n]*\.wrap,\.toast\{display:none!important\}#printSheet\{display:block/);
  assert.match(src, /<th>Chain<\/th><th>Account #<\/th><th>Customer<\/th><th class="n">New sequence<\/th>/);
});

test('SAVE TO ROUTE MAP sends it all in one press (Joe 11-7-26): sequences, run order, truck drawing, and a missing customer added first', async () => {
  const day = DAY();
  day.routeDays[0].stops.push({ key: '50001', account: '50001', name: 'MADEUP DELI', loadSeq: 5, note: 'Closed for winter' });
  day.customers[50001] = { account: '50001', name: 'MADEUP DELI' };
  const { map, calls } = bridgeWith(d => d.op === 'view' ? day : d.op === 'saveCustomer' ? { ok: true, customer: { key: '77001', account: '77001', name: d.fields.name, chain: d.fields.chain } }
    : { ok: true, routeDay: { rev: 5, stops: d.stops, map: d.map } });
  const out = await map.saveAll('813', 'THU', 4, { stops: [
    { key: '', acct: '40496', name: 'SAMPLE CONE', loadSeq: 9 },
    { key: '', acct: '', name: 'Sample Market', loadSeq: 3 },
    { key: '', acct: '77001', name: 'TASTY MADEUP STAND', chain: '12', loadSeq: 1 }],
    map: { rows: 2, cells: [[9, 9, 9, 3, 3, 3], [1, 1, 1, null, null, null]] } });
  const add = calls.find(c => c[1].op === 'saveCustomer');
  assert.ok(add, 'the customer not on the list is added first');
  assert.deepEqual([add[1].add, add[1].account, add[1].fields], [true, '77001', { name: 'TASTY MADEUP STAND', chain: '12' }]);
  const [, sent] = calls[calls.length - 1];
  assert.equal(sent.op, 'saveRouteDay'); assert.equal(sent.rev, 4);
  assert.deepEqual(sent.stops, [{ key: '40496', loadSeq: 9, note: '' }, { key: '50001', loadSeq: 5, note: 'Closed for winter' },
    { key: '16175', loadSeq: 3, note: 'Back door' }, { key: '77001', loadSeq: 1, note: '' }],
    'found by account, then by name; notes kept; a closed customer not on this BOL stays, right after the stop it came after');
  assert.deepEqual(sent.map.cells[1], [1, 1, 1, null, null, null], 'the truck drawing goes too');
  assert.equal(out.rev, 5);
  // A route day the Customer List does not have yet is started (no rev to check).
  const second = bridgeWith(d => d.op === 'view' ? DAY() : { ok: true, routeDay: { rev: 1, stops: d.stops } });
  await second.map.saveAll('813', 'MON', null, { stops: [{ key: '', acct: '16175', name: 'SAMPLE MARKET', loadSeq: 2 }] });
  const [, made] = second.calls[second.calls.length - 1];
  assert.equal(made.day, 'MON'); assert.equal('rev' in made, false); assert.equal('map' in made, false);
  assert.deepEqual(made.stops, [{ key: '16175', loadSeq: 2, note: '' }]);
});

test('Pallet Builder BOL DAY (Joe 11-7-26): opens on the newest BOL, steps back a day at a time, big ALL CAPS top', () => {
  const src = fs.readFileSync(PB.SRC, 'utf8');
  assert.match(src, /<button id="dayPrev"[^>]*>&#9664; DAY BEFORE<\/button>/);
  assert.match(src, /<select id="dayPick"/);
  assert.match(src, /<button id="dayNext"[^>]*>DAY AFTER &#9654;<\/button>/);
  assert.match(src, /<p class="dayline" id="dayLine"/);
  assert.match(src, /p\.udBolDays \|\| \(p\.udBol \? \[p\.udBol\] : null\)/, 'every BOL day the Hub has');
  assert.match(src, /optgroup label="ON THE /, 'the routes on the picked day come first');
  const page = fs.readFileSync(PB.OUT, 'utf8');
  assert.match(page, /collection\(homeDb, 'bolDays'\), orderBy\('date', 'desc'\), limit\(14\)/, 'the last two weeks of BOLs');
  const css = src.match(/<style>([\s\S]*?)<\/style>/)[1];
  const small = (css.match(/font-size:\s*([\d.]+)(px|rem)/g) || []).map(x => x.match(/([\d.]+)(px|rem)/)).filter(m => (m[2] === 'px' ? +m[1] : +m[1] * 16) < 16);
  assert.ok(small.length <= 1, 'letters 16 or bigger: ' + small.map(m => m[0]).join(', '));
});

test('Pallet Builder opens with the newest BOL from the Hub (Joe 11-6-26, lb), shaped like the BOL built in', () => {
  const { window } = (() => { const page = fs.readFileSync(PB.OUT, 'utf8');
    const code = page.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/import \{[^}]*\} from '\.\/js\/(app|firebase|products)\.js';/g, '');
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
  assert.match(src, /const p = window\.parent && window\.parent !== window \? window\.parent : null; const list = p && \(p\.udBolDays \|\| \(p\.udBol/, 'the builder takes the BOL the screen hands it');
  assert.match(src, /const BUILTIN_DAY = \{key: DAYKEY, date: '2026-11-05', routes: BOLDAY, builtIn: true\};/, 'and keeps its own BOL when there is none');
  assert.match(src, /const BOLDAYS = HUBDAYS\.concat\(/, 'the Hub BOL days and the built-in one, newest first');
});

test('the Hub BOL days come from the server when the screen cannot read them itself (Joe 11-7-26: only Thursday showed)', async () => {
  const page = fs.readFileSync(PB.OUT, 'utf8');
  const code = page.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/import \{[^}]*\} from '\.\/js\/(app|firebase|products)\.js';/g, '');
  const calls = [], window = { UDLogic: L };
  const day = { date: '2026-11-06', received: '2026-11-06T15:59:00.000Z', routes: [{ route: '805', stops: [{ seq: 3, custNo: '1001', name: 'MADEUP MARKET', lines: [{ item: '305', qty: 4 }] }] }] };
  const callServer = async (name, data) => { calls.push([name, data]); return { days: [day] }; };
  // start() is not there (as when the direct read fails), so it asks the server.
  new Function('window', 'document', 'requireSignIn', 'callServer', 'currentPlant', 'serverText', code)(window, {}, () => {}, callServer, () => 'fac_uniontown', (e) => e.message);
  const days = await window.udReadBolDays();
  assert.deepEqual(calls.map(c => [c[0], c[1].bolDays]), [['save', true]]);
  assert.equal(days.length, 1); assert.equal(days[0].date, '2026-11-06'); assert.equal(days[0].routes[0].route, 'RT 805 · 11/06/26');
  // Both fail: the reason comes back, for the red line.
  new Function('window', 'document', 'requireSignIn', 'callServer', 'currentPlant', 'serverText', code)(window, {}, () => {}, async () => { const e = new Error('no'); e.code = 'functions/permission-denied'; throw e; }, () => 'fac_uniontown', (e) => e.message);
  await assert.rejects(window.udReadBolDays(), e => /permission-denied/.test(e.message));
  // Joe 11-8-26: the list was read and was empty, and the server fails: its reason still comes back (it used to be hidden).
  const w2 = { UDLogic: L };
  const fakeStart = 'const start = async () => ({ homeDb: {} }); const getDocs = async () => ({ docs: [] }); const collection = () => 0, query = () => 0, orderBy = () => 0, limit = () => 0;';
  new Function('window', 'document', 'requireSignIn', 'callServer', 'currentPlant', 'serverText', fakeStart + code)(w2, {}, () => {}, async () => { const e = new Error('no'); e.code = 'functions/internal'; throw e; }, () => 'fac_uniontown', (e) => e.message);
  await assert.rejects(w2.udReadBolDays(), e => /internal/.test(e.message));
  // The server finds none: what it says about this app's Hub comes along for the red line.
  const w3 = { UDLogic: L }, hub = { mailbox: false, enabled: false, last: null };
  new Function('window', 'document', 'requireSignIn', 'callServer', 'currentPlant', 'serverText', fakeStart + code)(w3, {}, () => {}, async () => ({ days: [], hub }), () => 'fac_uniontown', (e) => e.message);
  assert.deepEqual(await w3.udReadBolDays(), []); assert.deepEqual(w3.udBolHub, hub);
});

test('with no BOL days the server says when this app\'s Hub last checked the email (Joe 11-8-26)', async () => {
  const B = require('../../src/bol');
  const docs = { bolMail: { mailbox: 'someone@uniteddairy.com', enabled: false }, bolMailLast: { at: '2026-11-07T13:32:00.000Z', status: 'OK', message: 'Read Daily Load UT.pdf: load day 11-6-26, 16 routes.', files: [] } };
  const db = (have) => ({ collection: () => ({ doc: (id) => ({ get: async () => ({ exists: have && !!docs[id], data: () => docs[id] }) }) }) });
  assert.deepEqual(await B.hubCheck(db(true)), { mailbox: true, enabled: false, last: { at: '2026-11-07T13:32:00.000Z', status: 'OK', message: 'Read Daily Load UT.pdf: load day 11-6-26, 16 routes.' } });
  assert.deepEqual(await B.hubCheck(db(false)), { mailbox: false, enabled: false, last: null });
  const src = fs.readFileSync(PB.SRC, 'utf8');
  assert.match(src, /THIS APP\\'S HUB HAS NEVER CHECKED THE EMAIL: PRESS CHECK EMAIL NOW ON DAILY BOL\./);
  assert.match(src, /CHECK EVERY HOUR IS NOT TICKED\./);
});

test('the server reads the newest BOL days for the screens, newest first, only what they use', async () => {
  const B = require('../../src/bol');
  const docs = [{ date: '2026-11-06', received: { toDate: () => new Date('2026-11-06T15:59:00Z') }, file: 'x.pdf', totals: {}, routes: [{ route: 805, lines: 9, stops: [{ seq: 3, custNo: '1001', name: 'MADEUP MARKET', lines: [{ item: 305, desc: 'GAL', qty: '4' }], qty: 4 }] }] },
    { date: '2026-11-05', received: '2026-11-05T20:00:00.000Z', routes: [] }, { routes: [] }];
  let asked = null;
  const db = { collection: (c) => ({ orderBy: (f, d) => ({ limit: (n) => ({ get: async () => { asked = [c, f, d, n]; return { docs: docs.map(x => ({ data: () => x })) }; } }) }) }) };
  const out = await B.recentDays(db, 14);
  assert.deepEqual(asked, ['bolDays', 'date', 'desc', 14]);
  assert.deepEqual(out[0], { date: '2026-11-06', received: '2026-11-06T15:59:00.000Z', savedAt: '', routes: [{ route: '805', stops: [{ seq: 3, custNo: '1001', name: 'MADEUP MARKET', lines: [{ item: '305', qty: 4 }] }] }] });
  assert.equal(out.length, 2, 'a day with no date is left out');
  const src = fs.readFileSync(require('path').join(__dirname, '../../index.js'), 'utf8');
  assert.match(src, /request\.data\.bolDays === true\) \{\s*const BOL = require\('\.\/src\/bol'\), cdb = PLANTS\.companyDb\(db\);\s*const days = await BOL\.recentDays\(cdb, request\.data\.max\);\s*return \{ days, hub: days\.length \? null : await BOL\.hubCheck\(cdb\) \};/);
});

test('Pallet Rules and PALLET USES go to the Customer List through its own server call; the cases come with the route map', async () => {
  const day = DAY();
  day.palletRules = { standard: 'HIGH', weeks: 5, cratesPerPallet: 54, cratesPerStack: 6, dispensersPerPallet: 45 };
  day.routeDays[0].cases = { 40496: [['2026-10-31', 12], ['2026-10-24', 20]] }; day.routeDays[0].palletUses = { 40496: 'LOW' }; day.routeDays[0].caseWeeks = 2;
  const { map, calls } = bridgeWith(d => d.op === 'view' ? day : d.op === 'setPalletUses' ? { ok: true, palletUses: { 40496: d.rule } } : { ok: true, palletRules: Object.assign({}, day.palletRules, d.rules) });
  const m = await map.load('813', 'THU');
  assert.equal(calls[0][1].cases, true, 'the route map is read with the cases');
  assert.deepEqual(m.stops[1].weeks, [['2026-10-31', 12], ['2026-10-24', 20]]); assert.equal(m.stops[1].uses, 'LOW'); assert.equal(m.stops[0].uses, '');
  assert.equal(m.caseWeeks, 2); assert.equal(m.rules.dispensersPerPallet, 45);
  await map.setUses('813', 'THU', '40496', 'AVERAGE');
  assert.deepEqual(calls[calls.length - 1], ['customerList', { op: 'setPalletUses', plant: 'fac_uniontown', route: '813', day: 'THU', key: '40496', rule: 'AVERAGE' }]);
  const r = await map.saveRules({ cratesPerPallet: 56 });
  assert.deepEqual(calls[calls.length - 1], ['customerList', { op: 'savePalletRules', plant: 'fac_uniontown', rules: { cratesPerPallet: 56 } }]);
  assert.equal(r.cratesPerPallet, 56);
});

test('the Product Sheet keeps units in a case, cases to a pallet, stack height and full-case weights (Joe 11-6-26)', async () => {
  const PL = require('../../src/plant');
  class SaveError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
  const one = PL.validateMachineProducts({ areaId: 'ut_prod_gallon_filler', products: [{ name: 'SAMPLE 2% GAL', sku: '305', unitsPerCase: '4', casesPerPallet: '54.4', stackHeight: '6', caseNetLbs: '34.4', caseGrossLbs: '36.55' }] }, SaveError).products[0];
  assert.deepEqual([one.unitsPerCase, one.casesPerPallet, one.stackHeight, one.caseNetLbs, one.caseGrossLbs], [4, 54, 6, 34.4, 36.55]);
  assert.throws(() => PL.validateMachineProducts({ areaId: 'x', products: [{ name: 'SAMPLE', caseGrossLbs: '-1' }] }, SaveError), /Gross Weight Full Case lb must be a number from 0 to 2000/);
  const src = fs.readFileSync(require('path').join(__dirname, '../../../public/js/products.js'), 'utf8');
  assert.match(src, /export const PALLET_FIELDS = \['unitsPerCase', 'casesPerPallet', 'stackHeight', 'caseNetLbs', 'caseGrossLbs'\];/);
  assert.match(src, /export const KEEP_FIELDS = \[[^\]]*\]\.concat\(PALLET_FIELDS\);/, 'an upload never wipes them');
  assert.match(src, /export const SHARED_FIELDS = \[[^\]]*\]\.concat\(PALLET_FIELDS\);/, 'one per product, on every machine');
  assert.match(src, /export const SHEET_TAIL = \[[^\]]*\]\.concat\(PALLET_FIELDS\.map/, 'in the downloaded list');
  const html = fs.readFileSync(require('path').join(__dirname, '../../../public/products.html'), 'utf8');
  assert.match(html, /<th class="pm-pal" colspan="' \+ PALLET_FIELDS\.length \+ '">Cases and Pallets<\/th>/);
});

// Joe 11-9-26: "why aren't you using 0? ... Every single color should be different."
test('load sequence 0 is labeled 0 on the truck, and every load sequence 0 to 15 has its own color (Joe 11-9-26)', () => {
  const src = fs.readFileSync(PB.SRC, 'utf8');
  const colors = JSON.parse(src.match(/^const SEQ_COLORS = (\[.*\]);$/m)[1].replace(/'/g, '"'));
  assert.equal(colors.length, 16); assert.equal(new Set(colors).size, 16, 'no two sequences share a color');
  const vm = require('vm'), box = {};
  vm.runInNewContext(src.match(/^const SEQ_COLORS = .*$/m)[0] + '\n' + src.match(/^const seqColor = .*$/m)[0] + '\n' + src.match(/^const NOSEQ_COLOR = .*$/m)[0] + '\nthis.seqColor = seqColor; this.stopColor = stopColor;', box);
  assert.equal(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(box.seqColor)).size, 16);
  assert.notEqual(box.stopColor(null, 3), box.seqColor(0), 'no sequence is grey, not sequence 0\'s color');
  assert.match(src, /const lmLabel = i => \{ const n = stopSeq\(S\.stops\[i\]\); return n != null \? String\(n\) : '#' \+ \(i \+ 1\); \};/, 'sequence 0 shows 0, not #run');
});

test('soft margarine 41823 is 18 to a case (Joe 11-11-26)', () => {
  const box = rulesBox();
  assert.equal(box.BY.get('41823').upc, 18);
});
