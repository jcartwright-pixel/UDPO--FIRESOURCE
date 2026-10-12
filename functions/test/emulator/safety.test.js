'use strict';
// Safety Walkthrough (Joe 10/12): the weekly walk, its open issues carried over until fixed, each extinguisher's monthly
// check and the plant's own checklist. Plant people walk; a manager or administrator keeps the list and the checklist.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const D = require('../../src/demo-sheets');
const PD = require('../fixtures/plant-demo');
const S = require('../../src/safety-rules');

let n = 0;
const rid = () => 'safety-request-' + (++n) + '-' + Date.now();
const MANAGER = 'manager.test@uniteddairy.com', PLANT_PERSON = 'viewer.test@uniteddairy.com', DISPATCHER = 'dispatch.test@uniteddairy.com';
const UT = 'fac_uniontown';
const at = (iso) => () => new Date(iso);
const MON = '2026-10-05T14:00:00Z', NEXT = '2026-10-12T14:00:00Z';
const walkTap = (date, op, fields, when, email) => applyAction(db(), { email: email || MANAGER }, Object.assign({ action: 'saveSafetyWalk', requestId: rid(), facilityId: UT, date, op }, fields || {}), at(when));
const walk = async (date) => (await db().collection('safetyWalks').doc(S.walkId(UT, date)).get()).data();
const issues = async () => (await db().collection('safetyIssues').where('facilityId', '==', UT).get()).docs.map(d => Object.assign({ id: d.id }, d.data()));

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: D.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date(MON) });
});

test('A walk: Good and Not good, a note and a photo, the next walk reviews it, a repeat, and Fixed', async () => {
  await walkTap('2026-10-05', 'item', { itemId: 'exit_routes', status: 'GOOD' }, MON, PLANT_PERSON);
  await walkTap('2026-10-05', 'item', { itemId: 'panel_labels', status: 'NOT_GOOD' }, MON, PLANT_PERSON);
  await walkTap('2026-10-05', 'note', { itemId: 'panel_labels', note: 'LP-3 missing labels' }, MON, PLANT_PERSON);
  await walkTap('2026-10-05', 'photo', { itemId: 'panel_labels', photo: 'data:image/jpeg;base64,AAAA' }, MON, PLANT_PERSON);
  await walkTap('2026-10-05', 'maint', { itemId: 'panel_labels', maint: true }, MON, PLANT_PERSON);
  const w1 = await walk('2026-10-05');
  assert.equal(w1.monthly, true, 'the month\'s first walk has the monthly items');
  assert.equal(w1.startedByName, 'Test Viewer');
  assert.equal(w1.items.exit_routes.status, 'GOOD');
  let list = await issues();
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].item, list[0].area, list[0].note, list[0].photo, list[0].sendToMaint, list[0].maintStatus, list[0].status, list[0].foundOn, list[0].foundByName],
    ['Breakers labeled, no open holes in panels', 'Electrical', 'LP-3 missing labels', true, true, 'WAITING', 'OPEN', '2026-10-05', 'Test Viewer']);
  assert.equal((await db().collection('safetyPhotos').doc(list[0].id).get()).data().data, 'data:image/jpeg;base64,AAAA');
  // Next week: not the month's first walk; the same item Not good again joins the open issue (a repeat), then it is fixed.
  await walkTap('2026-10-12', 'review', { issueId: list[0].id, status: 'OPEN' }, NEXT);
  await walkTap('2026-10-12', 'item', { itemId: 'panel_labels', status: 'NOT_GOOD' }, NEXT);
  const w2 = await walk('2026-10-12');
  assert.equal(w2.monthly, false);
  assert.equal(w2.items.panel_labels.repeat, true);
  list = await issues();
  assert.equal(list.length, 1, 'a repeat is not a second issue');
  assert.deepEqual(list[0].walks, [S.walkId(UT, '2026-10-05'), S.walkId(UT, '2026-10-12')]);
  await walkTap('2026-10-12', 'review', { issueId: list[0].id, status: 'FIXED' }, NEXT);
  list = await issues();
  assert.deepEqual([list[0].status, list[0].fixedOn, list[0].fixedByName], ['FIXED', '2026-10-12', 'Test Manager']);
  // Still open on the same walk takes the Fixed back.
  await walkTap('2026-10-12', 'review', { issueId: list[0].id, status: 'OPEN' }, NEXT);
  assert.equal((await issues())[0].status, 'OPEN');
  await walkTap('2026-10-12', 'finish', {}, NEXT);
  assert.equal((await walk('2026-10-12')).finishedByName, 'Test Manager');
});

test('Taking a Not good back removes the issue it opened; a repeat taken back leaves the older issue', async () => {
  await walkTap('2026-10-05', 'item', { itemId: 'floors', status: 'NOT_GOOD' }, MON);
  await walkTap('2026-10-05', 'item', { itemId: 'floors', status: 'GOOD' }, MON);
  assert.equal((await issues()).length, 0);
  await walkTap('2026-10-05', 'item', { itemId: 'floors', status: 'NOT_GOOD' }, MON);
  await walkTap('2026-10-12', 'item', { itemId: 'floors', status: 'NOT_GOOD' }, NEXT);
  await walkTap('2026-10-12', 'item', { itemId: 'floors', status: '' }, NEXT);
  const list = await issues();
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].walks, [S.walkId(UT, '2026-10-05')]);
  assert.equal((await walk('2026-10-12')).items.floors.status, '');
});

test('Refused: another day, an item not on the checklist, a photo before Not good, a big photo, a made-up status', async () => {
  await assert.rejects(walkTap('2026-10-01', 'item', { itemId: 'floors', status: 'GOOD' }, MON), /on the day it is walked/);
  await assert.rejects(walkTap('2026-10-05', 'item', { itemId: 'nope', status: 'GOOD' }, MON), /not on this plant's checklist/);
  // Joe 10/12: a note is fine on any row now; a photo and Send to Plant Maintenance still need Not good first.
  await assert.rejects(walkTap('2026-10-05', 'photo', { itemId: 'floors', photo: 'data:image/jpeg;base64,AAAA' }, MON), /Not good first/);
  await assert.rejects(walkTap('2026-10-05', 'maint', { itemId: 'floors', maint: true }, MON), /Not good first/);
  await assert.rejects(walkTap('2026-10-05', 'photo', { itemId: 'floors', photo: 'data:image/png;base64,AAAA' }, MON), /too big or not a picture/);
  await assert.rejects(walkTap('2026-10-05', 'item', { itemId: 'floors', status: 'MAYBE' }, MON), /Good or Not good/);
});

test('Open Issues: Mark Fixed, Reopen and Send to Plant Maintenance', async () => {
  await walkTap('2026-10-05', 'item', { itemId: 'guards', status: 'NOT_GOOD' }, MON);
  const id = (await issues())[0].id;
  const fix = (op, extra) => applyAction(db(), { email: MANAGER }, Object.assign({ action: 'saveSafetyIssue', requestId: rid(), issueId: id, op }, extra || {}), at(NEXT));
  await fix('maint', { maint: true });
  assert.equal((await issues())[0].maintStatus, 'WAITING');
  await fix('fixed');
  await assert.rejects(fix('fixed'), /already marked Fixed/);
  assert.deepEqual([(await issues())[0].status, (await issues())[0].fixedOn], ['FIXED', '2026-10-12']);
  await fix('reopen');
  assert.equal((await issues())[0].status, 'OPEN');
});

test('Extinguishers: a manager adds one; the monthly check; a Not good opens an issue and clearing it removes it', async () => {
  const add = (fields, email) => applyAction(db(), { email: email || MANAGER }, Object.assign({ action: 'saveExtinguisher', requestId: rid(), facilityId: UT, tag: '04', location: 'Half gallon room door', type: 'ABC', size: '20 lb', annualDue: '3-15-27', isNew: true }, fields || {}), at(MON));
  await assert.rejects(add({}, PLANT_PERSON), /permission|not allowed|role/i);
  await add();
  await assert.rejects(add(), /already on the list/);
  const id = S.extId(UT, '04'), ext = (await db().collection('extinguishers').doc(id).get()).data();
  assert.deepEqual([ext.location, ext.type, ext.annualDue, ext.status], ['Half gallon room door', 'ABC', '2027-03-15', 'ACTIVE']);
  const check = (item, status, when) => applyAction(db(), { email: PLANT_PERSON }, { action: 'saveExtinguisherCheck', requestId: rid(), extinguisherId: id, month: '2026-10', item, status }, at(when || MON));
  for (const [k] of S.EXT_ITEMS) await check(k, 'GOOD');
  let e = (await db().collection('extinguishers').doc(id).get()).data();
  assert.equal(S.extMonth(e, '2026-10').state, 'GOOD');
  await check('gauge', 'NOT_GOOD');
  let list = await issues();
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].area, list[0].item, list[0].source], ['Fire Extinguishers', 'Extinguisher tag 04 (Half gallon room door): Gauge needle in the green', 'EXTINGUISHER']);
  await check('gauge', 'GOOD');
  assert.equal((await issues()).length, 0, 'taken back before anyone fixed it');
  await assert.rejects(applyAction(db(), { email: PLANT_PERSON }, { action: 'saveExtinguisherCheck', requestId: rid(), extinguisherId: id, month: '2026-09', item: 'gauge', status: 'GOOD' }, at(MON)), /month it is done/);
  await add({ isNew: false, retired: true });
  e = (await db().collection('extinguishers').doc(id).get()).data();
  assert.equal(e.status, 'RETIRED');
});

test('Checklist Setup: a manager changes the plant\'s list; an item left out stays on as off; a dispatcher may walk', async () => {
  const areas = S.checklist(null, true).slice(0, 1).map(a => Object.assign({}, a, { items: a.items.slice(0, 2).concat([{ id: 'fire_new', text: 'Hot work permits posted', freq: 'MONTHLY' }]) }));
  await applyAction(db(), { email: MANAGER }, { action: 'saveSafetyChecklist', requestId: rid(), facilityId: UT, areas }, at(MON));
  const setup = (await db().collection('safetySetup').doc(UT).get()).data();
  const on = S.walkList(setup, true).flatMap(a => a.items.map(i => i.id));
  assert.deepEqual(on, ['exit_routes', 'exit_signs', 'fire_new']);
  assert.equal(S.findItem(setup, 'floors').text, 'Floors free of standing water, milk and oil; drains open', 'items left out are kept, turned off');
  await assert.rejects(walkTap('2026-10-05', 'item', { itemId: 'floors', status: 'GOOD' }, MON), /not on this plant's checklist/, 'an item turned off is not walked');
  await walkTap('2026-10-05', 'item', { itemId: 'fire_new', status: 'GOOD' }, MON, DISPATCHER);
  await assert.rejects(applyAction(db(), { email: PLANT_PERSON }, { action: 'saveSafetyChecklist', requestId: rid(), facilityId: UT, areas }, at(MON)), /permission|not allowed|role/i);
});

test('Notes (Joe 10/12): a note on any row, kept when the row changes; a note on an earlier issue; notes for the whole walk', async () => {
  await walkTap('2026-10-05', 'note', { itemId: 'exit_signs', note: 'Bulb dim by dock 3' }, MON, PLANT_PERSON);
  let w = await walk('2026-10-05');
  assert.deepEqual([w.items.exit_signs.note, w.items.exit_signs.status], ['Bulb dim by dock 3', ''], 'a note before the row is marked');
  await walkTap('2026-10-05', 'item', { itemId: 'exit_signs', status: 'GOOD' }, MON, PLANT_PERSON);
  await walkTap('2026-10-05', 'item', { itemId: 'exit_signs', status: 'NOT_GOOD' }, MON, PLANT_PERSON);
  let list = await issues();
  assert.equal(list[0].note, 'Bulb dim by dock 3', 'the row note becomes the issue note');
  await walkTap('2026-10-05', 'item', { itemId: 'exit_signs', status: 'GOOD' }, MON, PLANT_PERSON);
  w = await walk('2026-10-05');
  assert.deepEqual([w.items.exit_signs.status, w.items.exit_signs.note], ['GOOD', 'Bulb dim by dock 3'], 'the note stays when Not good is taken back');
  assert.equal((await issues()).length, 0);
  await walkTap('2026-10-05', 'item', { itemId: 'guards', status: 'NOT_GOOD' }, MON, PLANT_PERSON);
  await walkTap('2026-10-05', 'walknote', { note: 'Walked with the new supervisor.' }, MON, PLANT_PERSON);
  w = await walk('2026-10-05');
  assert.deepEqual([w.note, w.noteByName], ['Walked with the new supervisor.', 'Test Viewer']);
  // Next week: a note on the earlier issue while reviewing it shows on the issue as its latest note; it is not a review by itself.
  const id = (await issues())[0].id;
  await walkTap('2026-10-12', 'reviewnote', { issueId: id, note: 'Guard ordered, due Friday' }, NEXT);
  w = await walk('2026-10-12');
  assert.deepEqual(w.reviews[id], { note: 'Guard ordered, due Friday' });
  list = await issues();
  assert.deepEqual([list[0].lastNote, list[0].lastNoteOn, list[0].lastNoteByName, list[0].status], ['Guard ordered, due Friday', '2026-10-12', 'Test Manager', 'OPEN']);
  await walkTap('2026-10-12', 'review', { issueId: id, status: 'OPEN' }, NEXT);
  w = await walk('2026-10-12');
  assert.deepEqual([w.reviews[id].status, w.reviews[id].note], ['OPEN', 'Guard ordered, due Friday'], 'the review keeps its note');
  await assert.rejects(walkTap('2026-10-12', 'reviewnote', { issueId: 'nope', note: 'x' }, NEXT), /not on this plant's list/);
});
