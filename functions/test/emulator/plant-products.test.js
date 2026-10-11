'use strict';
// Machine Products (Joe 10/10): a manager or administrator replaces one machine's product list (the Quality check's Product
// drop-down); a dispatcher may not, a product name may not be on the list twice, and the machine must be set up.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const D = require('../../src/demo-sheets');
const PD = require('../fixtures/plant-demo');

let n = 0;
const rid = () => 'products-request-' + (++n) + '-' + Date.now();
const act = (email, fields) => applyAction(db(), { email }, Object.assign({ action: 'saveMachineProducts', requestId: rid() }, fields));
const MANAGER = 'manager.test@uniteddairy.com', DISPATCHER = 'dispatch.test@uniteddairy.com';

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: D.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T16:00:00Z') });
});

test('A manager saves a machine\'s products; blank rows drop out and the change is logged', async () => {
  const list = [{ name: 'GV 2% Gallon', sku: '280305', mfgType: 'Gallon', productGroup: 'Milk' }, { name: 'Jersey 2% Gallon', sku: '280305', mfgType: 'Gallon', productGroup: 'Milk' }, { name: '  ', sku: '1' }];
  const done = await act(MANAGER, { operationId: 'ut_prod_gallon_filler', products: list });
  assert.equal(done.count, 2);
  const saved = (await db().collection('plantProducts').doc('ut_prod_gallon_filler').get()).data();
  assert.deepEqual(saved.products.map(p => p.name), ['GV 2% Gallon', 'Jersey 2% Gallon'], 'GV and Jersey stay two products even with one SKU');
  assert.equal(saved.line, 'GALLON FILLER');
  assert.equal(saved.updatedBy, MANAGER);
  const log = (await db().collection('actions').where('action', '==', 'saveMachineProducts').get()).docs.map(d => d.data());
  assert.equal(log.length, 1);
});

test('Refused: a dispatcher, a name twice, a machine not set up', async () => {
  await assert.rejects(act(DISPATCHER, { operationId: 'ut_prod_totes', products: [] }), /does not have a role/);
  await assert.rejects(act(MANAGER, { operationId: 'ut_prod_totes', products: [{ name: 'Tote milk' }, { name: 'TOTE MILK' }] }), /on the list twice/);
  await assert.rejects(act(MANAGER, { operationId: 'ut_prod_nowhere', products: [] }), /not set up/);
});

// Joe 10/11: products are plant by plant, by area (the plant's machines and its own areas) and group, and load from the template.
const set = (email, fields) => applyAction(db(), { email }, Object.assign({ action: 'saveProductSetup', requestId: rid() }, fields));
const up = (email, fields) => applyAction(db(), { email }, Object.assign({ action: 'saveProductUpload', requestId: rid() }, fields));

test('A plant\'s own areas and groups: Uniontown starts with CASES and TANKER; one with products is not removed', async () => {
  const cases = 'fac_uniontown_area_cases';
  await act(MANAGER, { operationId: cases, products: [{ name: 'UD 2% Gallon case', sku: '305', mfgType: 'Gallon', productGroup: 'Milk' }] });
  const saved = (await db().collection('plantProducts').doc(cases).get()).data();
  assert.deepEqual([saved.line, saved.facilityId, saved.products.length], ['CASES', 'fac_uniontown', 1], 'a starting area takes products before anything is saved');
  await set(MANAGER, { facilityId: 'fac_uniontown', areas: [{ id: cases, name: 'CASES' }, { id: 'fac_uniontown_area_tanker', name: 'BULK TANKER' }, { name: 'Dock' }], groups: ['Milk', 'Drinks', 'TEA', 'Creams'] });
  const ps = (await db().collection('productSetup').doc('fac_uniontown').get()).data();
  assert.deepEqual(ps.areas, [{ id: cases, name: 'CASES' }, { id: 'fac_uniontown_area_tanker', name: 'BULK TANKER' }, { id: 'fac_uniontown_area_dock', name: 'Dock' }], 'a rename keeps the area');
  assert.deepEqual(ps.groups, ['Milk', 'Drinks', 'TEA', 'Creams']);
  await assert.rejects(set(MANAGER, { facilityId: 'fac_uniontown', areas: [{ id: 'fac_uniontown_area_dock', name: 'Dock' }], groups: [] }), /CASES still has 1 products/);
  await assert.rejects(set(MANAGER, { facilityId: 'fac_uniontown', areas: [{ name: 'TOTES' }], groups: [] }), /already a machine/);
  await assert.rejects(set(MANAGER, { facilityId: 'fac_nowhere', areas: [], groups: [] }), /Pick a plant/);
  await assert.rejects(set(DISPATCHER, { facilityId: 'fac_uniontown', areas: [], groups: [] }), /does not have a role/);
  await assert.rejects(act(MANAGER, { operationId: 'fac_charleston_area_cases', products: [] }), /not set up/, 'an area is its own plant\'s');
});

test('Upload: each area in the file gets the file\'s list, other areas stay, new areas and groups are added', async () => {
  await act(MANAGER, { operationId: 'ut_prod_boxing', products: [{ name: 'Box keep', sku: '1' }] });
  await act(MANAGER, { operationId: 'ut_prod_totes', products: [{ name: 'Tote old', sku: '2' }] });
  const done = await up(MANAGER, { facilityId: 'fac_uniontown', areas: [
    { areaId: 'ut_prod_totes', name: 'TOTES', products: [{ name: 'Tote new', sku: '3', mfgType: 'TOTE', productGroup: 'Milk' }] },
    { name: 'Gallon filler', products: [{ name: 'UD 1% Gallon', sku: '405', mfgType: 'Gallon', productGroup: 'Milk' }] },
    { name: 'Cooler', products: [{ name: 'Lemonade', sku: '9', mfgType: 'Gallon', productGroup: 'Drinks, Juice' }] }] });
  assert.equal(done.count, 3);
  assert.deepEqual(done.addedAreas, ['Cooler']);
  assert.deepEqual(done.addedGroups, ['Juice']);
  const get = async (id) => (await db().collection('plantProducts').doc(id).get()).data();
  assert.deepEqual((await get('ut_prod_totes')).products.map(p => p.name), ['Tote new']);
  assert.deepEqual((await get('ut_prod_gallon_filler')).products.map(p => p.name), ['UD 1% Gallon'], 'a machine is found by its name');
  assert.deepEqual((await get('ut_prod_boxing')).products.map(p => p.name), ['Box keep'], 'an area not in the file stays');
  assert.deepEqual((await get('fac_uniontown_area_cooler')).products.map(p => p.name), ['Lemonade']);
  const ps = (await db().collection('productSetup').doc('fac_uniontown').get()).data();
  assert.deepEqual(ps.areas.map(a => a.name), ['CASES', 'TANKER', 'Cooler']);
  assert.deepEqual(ps.groups, ['Milk', 'Drinks', 'TEA', 'Juice']);
  await assert.rejects(up(MANAGER, { facilityId: 'fac_uniontown', areas: [{ name: 'X', products: [{ name: 'A' }, { name: 'a' }] }] }), /on the list twice/);
  await assert.rejects(up(MANAGER, { facilityId: 'fac_uniontown', areas: [] }), /no areas/);
});
