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

// Joe 10/11: one product list holds everything: UPC, full speed (RedZone Rate/Min), Target %, lowest and highest speed, shelf life.
test('Product details: kept as numbers, checked, and an upload that leaves them blank or out keeps them', async () => {
  await act(MANAGER, { operationId: 'ut_prod_gallon_filler', products: [{ name: 'GV 2% Gallon', sku: '280305', upc: '0 78742 37112 6', ratePerMin: '74', targetPct: '64.37', minSpeed: '40', maxSpeed: '80', shelfLifeDays: '14.2' }, { name: 'Plain', ratePerMin: '' }] });
  const get = async (id) => (await db().collection('plantProducts').doc(id).get()).data();
  const gv = (await get('ut_prod_gallon_filler')).products;
  assert.deepEqual(gv[0], { name: 'GV 2% Gallon', sku: '280305', mfgType: '', productGroup: '', upc: '078742371126', ratePerMin: 74, targetPct: 64.37, minSpeed: 40, maxSpeed: 80, shelfLifeDays: 14 });
  assert.deepEqual(gv[1], { name: 'Plain', sku: '', mfgType: '', productGroup: '' }, 'blank details are left off');
  await assert.rejects(act(MANAGER, { operationId: 'ut_prod_totes', products: [{ name: 'T', upc: 'abc' }] }), /UPC is 6 to 14 digits/);
  await assert.rejects(act(MANAGER, { operationId: 'ut_prod_totes', products: [{ name: 'T', targetPct: '120' }] }), /Target % must be a number from 0 to 100/);
  await assert.rejects(act(MANAGER, { operationId: 'ut_prod_totes', products: [{ name: 'T', minSpeed: '90', maxSpeed: '80' }] }), /Lowest Speed is above Highest Speed/);
  // An old-layout file: the SKU changes, the details stay.
  await up(MANAGER, { facilityId: 'fac_uniontown', areas: [{ areaId: 'ut_prod_gallon_filler', name: 'GALLON FILLER', products: [{ name: 'GV 2% Gallon', sku: '280399', mfgType: 'Gallon', productGroup: 'Milk' }, { name: 'New one', sku: '5' }] }] });
  const after = (await get('ut_prod_gallon_filler')).products;
  assert.deepEqual([after[0].sku, after[0].upc, after[0].ratePerMin, after[0].targetPct, after[0].shelfLifeDays], ['280399', '078742371126', 74, 64.37, 14]);
  assert.deepEqual(after.map(p => p.name), ['GV 2% Gallon', 'New one']);
});

// Joe 10/13: the Product Sheet is one list with a check for each machine, and Machine Setup sets one machine's products. One save
// writes every machine list it changes and the plant's products that run on no machine yet; a new group is added to the plant.
const sheet = (email, fields) => applyAction(db(), { email }, Object.assign({ action: 'saveProductSheet', requestId: rid() }, fields));
test('Product Sheet: the machine lists and the products on no machine save together', async () => {
  const done = await sheet(MANAGER, { facilityId: 'fac_uniontown', areas: [
    { areaId: 'ut_prod_boxing', products: [{ name: 'DQ Choc 5 Gal Mix', sku: '255202', mfgType: '5 Gallon', productGroup: 'Mix', ratePerMin: '8', targetPct: '66.75' }] },
    { areaId: 'ut_prod_htst_1', products: [{ name: 'DQ Choc 5 Gal Mix', sku: '255202', mfgType: '5 Gallon', productGroup: 'Mix', ratePerMin: '8', targetPct: '70' }] }],
  loose: [{ name: 'Eggnog Quart', sku: '777', mfgType: 'Quart', productGroup: 'Seasonal' }] });
  assert.deepEqual(done.addedGroups, ['Mix', 'Seasonal'], 'groups the plant has not saved yet are added (Mix is only on the screen\'s list)');
  const get = async (c, id) => (await db().collection(c).doc(id).get()).data();
  assert.deepEqual((await get('plantProducts', 'ut_prod_boxing')).products[0].targetPct, 66.75, 'each machine keeps its own Target %');
  assert.deepEqual((await get('plantProducts', 'ut_prod_htst_1')).products[0].targetPct, 70);
  assert.equal((await get('plantProducts', 'ut_prod_htst_1')).line, 'HTST #1');
  assert.deepEqual((await get('productSheet', 'fac_uniontown')).products.map(p => p.name), ['Eggnog Quart']);
  assert.ok((await get('productSetup', 'fac_uniontown')).groups.includes('Seasonal'));
  // One machine alone (Machine Setup) leaves the products on no machine as they are.
  await sheet(MANAGER, { facilityId: 'fac_uniontown', areas: [{ areaId: 'fac_uniontown_area_cases', products: [{ name: 'UD 2% Gallon case' }] }] });
  assert.deepEqual((await get('productSheet', 'fac_uniontown')).products.map(p => p.name), ['Eggnog Quart']);
  assert.deepEqual((await get('plantProducts', 'fac_uniontown_area_cases')).products.map(p => p.name), ['UD 2% Gallon case']);
  await assert.rejects(sheet(DISPATCHER, { facilityId: 'fac_uniontown', areas: [], loose: [] }), /does not have a role/);
  await assert.rejects(sheet(MANAGER, { facilityId: 'fac_uniontown', areas: [{ areaId: 'fac_charleston_area_cases', products: [] }] }), /not set up for this plant/);
  await assert.rejects(sheet(MANAGER, { facilityId: 'fac_uniontown', areas: [{ areaId: 'ut_prod_totes', products: [{ name: 'A' }, { name: 'a' }] }] }), /on the list twice/);
  await assert.rejects(sheet(MANAGER, { facilityId: 'fac_uniontown', areas: [] }), /Nothing to save/);
});
