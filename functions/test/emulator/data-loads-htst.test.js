'use strict';
// Joe 10/13 (src/data-loads.js, uniontown-htst-2026-10-13): his HTST product list goes onto HTST #1 and #2 once on each app.
// Products taken off the HTSTs stay on their other machines; one on no other machine stays on the sheet on no machine.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const D = require('../../src/demo-sheets');
const PD = require('../fixtures/plant-demo');
const { loadHtstOnce, HTST } = require('../../src/data-loads');
const at = (iso) => ({ now: () => new Date(iso) });
const get = async (col, id) => { const s = await db().collection(col).doc(id).get(); return s.exists ? s.data() : null; };

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: D.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T16:00:00Z') });
});

test('The load file matches the starting product list and Joe\'s 64 HTST products', () => {
  const start = require('../../../public/data/plant-products.json');
  start.lines.forEach(l => assert.deepEqual(HTST.start[l.operationId], l.products, l.operationId + ' is the same as the starting list'));
  assert.equal(HTST.machines.ut_prod_htst_1.length, 4);
  assert.equal(HTST.machines.ut_prod_htst_2.length, 60);
  assert.deepEqual(HTST.machines.ut_prod_htst_1.map(p => p.name), ['1% MILK PASTEURIZED', '2% MILK GAL PASTEURIZED', '3.25 MILK GAL PASTEURIZED', 'SKIM MILK PASTEURIZED']);
});

test('HTST list: loads once, keeps details, leaves other machines alone, deletes nothing', async () => {
  // Not yet: HTST #2 is not set up on this copy, so nothing is written and it is tried again next time.
  await assert.rejects(loadHtstOnce(db(), at('2026-10-14T12:00:00Z')), /ut_prod_htst_2 not set up/);
  assert.equal(await get('dataLoads', HTST.id), null);
  assert.equal(await get('plantProducts', 'ut_prod_htst_1'), null);
  const h1 = await get('plantSetup', 'ut_prod_htst_1');
  // Uniontown's other lines, as on the real Plant Operations sheet (the demo has five).
  for (const [id, name] of [['ut_prod_raypak', 'RAYPAK'], ['ut_prod_htst_2', 'HTST #2'], ['ut_prod_new_half_gallon', 'NEW 1/2 GALLON'], ['ut_prod_old_half_gallon', 'OLD 1/2 GALLON']]) {
    await db().collection('plantSetup').doc(id).set(Object.assign({}, h1, { operationId: id, name }));
  }
  // A product of Joe's already on the sheet (on no machine, with a shelf life) keeps its details and leaves the no-machine list.
  await db().collection('productSheet').doc('fac_uniontown').set({ facilityId: 'fac_uniontown', products: [{ name: 'DQ Choc Mix Gal', sku: '1', shelfLifeDays: 30 }, { name: 'Test Loose', sku: '9' }] });
  const r = await loadHtstOnce(db(), at('2026-10-14T12:05:00Z'));
  assert.deepEqual(r.counts, { ut_prod_htst_1: 4, ut_prod_htst_2: 60 });
  const one = await get('plantProducts', 'ut_prod_htst_1'), two = await get('plantProducts', 'ut_prod_htst_2');
  assert.deepEqual(one.products.map(p => p.name + '/' + (p.sku || '')), ['1% MILK PASTEURIZED/997520', '2% MILK GAL PASTEURIZED/997510', '3.25 MILK GAL PASTEURIZED/997500', 'SKIM MILK PASTEURIZED/997530']);
  assert.equal(two.products.length, 60);
  assert.equal(two.line, 'HTST #2');
  assert.deepEqual(two.products.find(p => p.name === 'DQ CHOC MIX GAL'), { name: 'DQ CHOC MIX GAL', sku: '997710', shelfLifeDays: 30 }, 'Joe\'s name and SKU, the shelf life kept');
  assert.equal(two.products.find(p => p.name === 'CREAM 18% GALLON').sku, undefined, 'a blank number stays blank');
  // Raw Milk ran only on the HTSTs: it stays on the Product Sheet on no machine. Products on other machines stay there (their
  // lists are not written), and the products already on no machine stay.
  const loose = await get('productSheet', 'fac_uniontown');
  assert.deepEqual(loose.products.map(p => p.name), ['Test Loose', 'Raw Milk']);
  assert.equal(await get('plantProducts', 'ut_prod_gallon_filler'), null, 'the Gallon Filler keeps its own list');
  const mark = await get('dataLoads', HTST.id);
  assert.equal(mark.status, 'DONE');
  assert.deepEqual(mark.counts, { ut_prod_htst_1: 4, ut_prod_htst_2: 60 });
  assert.deepEqual(mark.keptOnNoMachine, ['Raw Milk']);
  assert.ok(mark.before.find(b => b.area === 'loose').products.length === 2, 'the record keeps what was there for undoing');
  // A second run does nothing, even after someone changes the lists.
  await db().collection('plantProducts').doc('ut_prod_htst_1').update({ products: [{ name: 'Changed by hand' }] });
  assert.deepEqual(await loadHtstOnce(db(), at('2026-10-14T12:10:00Z')), { skipped: true });
  assert.deepEqual((await get('plantProducts', 'ut_prod_htst_1')).products, [{ name: 'Changed by hand' }]);
});
