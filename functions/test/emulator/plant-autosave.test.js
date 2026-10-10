'use strict';
// Auto-save on the plant side (Joe 10/10, no Record buttons): the first box saved is the check, the boxes left after it fill in
// the same check (checkId), and a report takes only what was checked since the last report was sent.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const R = require('../../src/plant-rules');
const D = require('../../src/demo-sheets');
const PD = require('../fixtures/plant-demo');

const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
let n = 0;
const rid = () => 'autosave-request-' + (++n) + '-' + Date.now();
const act = (action, fields) => applyAction(db(), DISPATCHER, Object.assign({ action, requestId: rid() }, fields));
const of = async (type) => (await db().collection('plantJournal').where('type', '==', type).get()).docs.map(d => Object.assign({ _id: d.id }, d.data()));

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: D.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T16:00:00Z') });
});

test('Quality: the first box makes the check; the next boxes fill in the same check; a blank drop-down saves as blank', async () => {
  const first = await act('saveQualityCheck', { operationId: 'ut_prod_totes', product: 'Orange drink' });
  assert.match(first.checkId, /^PRODUCTION_QUALITY_app_/);
  const again = await act('saveQualityCheck', { operationId: 'ut_prod_totes', product: 'Orange drink', tipTest: 'PASS', status: 'REVIEW', notes: 'Cap torque low', checkId: first.checkId });
  assert.equal(again.checkId, first.checkId);
  const all = await of('PRODUCTION_QUALITY');
  assert.equal(all.length, 1, 'one check, filled in');
  assert.deepEqual([all[0].payload.product, all[0].payload.tipTest, all[0].payload.qualityCheck, all[0].status, all[0].payload.notes], ['Orange drink', 'PASS', '', 'REVIEW', 'Cap torque low']);
  await assert.rejects(act('saveQualityCheck', { operationId: 'ut_prod_boxing', product: 'x', checkId: first.checkId }), /no longer open/);
  await assert.rejects(act('saveQualityCheck', { operationId: 'ut_prod_totes', checkId: 'SHIFT_REPORT_app_x' }), /not a quality check/);
});

test('Temperatures: the notes box fills in the reading just made, inside its 2-hour lock; a new reading is still refused', async () => {
  const first = await act('saveTemperatureCheck', { locationId: 'ut_temp_cooler_north', manualTemperature: '38' });
  assert.match(first.checkId, /^PLANT_TEMPERATURE_CHECK_app_/);
  const fixed = await act('saveTemperatureCheck', { locationId: 'ut_temp_cooler_north', manualTemperature: '44.5', notes: 'Door left open', checkId: first.checkId });
  assert.equal(fixed.status, 'HIGH');
  await assert.rejects(act('saveTemperatureCheck', { locationId: 'ut_temp_cooler_north', manualTemperature: '38' }), /already checked/);
  await assert.rejects(act('saveTemperatureCheck', { locationId: 'ut_temp_cooler_middle', manualTemperature: '38', checkId: first.checkId }), /no longer open/);
  const all = await of('PLANT_TEMPERATURE_CHECK');
  assert.equal(all.length, 1);
  assert.deepEqual([all[0].payload.manualTemperature, all[0].payload.notes, all[0].status], [44.5, 'Door left open', 'HIGH']);
});

test('Shift Notes: the entry goes on the log at the first box and is filled in by the next ones', async () => {
  const first = await act('saveShiftNote', { values: { Entry: 'Palletizer jammed', Type: 'Breakdown', Equipment: '' }, followUpStatus: 'OPEN' });
  assert.match(first.checkId, /^SHIFT_REPORT_app_/);
  await act('saveShiftNote', { values: { Entry: 'Palletizer jammed', Type: 'Breakdown', Equipment: 'Palletizer' }, notes: 'Look at the infeed', followUpStatus: 'MONITOR', checkId: first.checkId });
  const log = R.shiftLog(await of('SHIFT_REPORT'), Date.now());
  assert.equal(log.length, 1);
  assert.deepEqual([log[0].entryId, log[0].equipment, log[0].notes, log[0].status], [first.entryId, 'Palletizer', 'Look at the infeed', 'MONITOR']);
});

test('Send Current Report: lines and coolers not checked since the last report read "Not checked", with when they last were', () => {
  const lines = [{ name: 'TOTES', last: { status: 'RUNNING', product: 'Orange drink', qualityCheck: 'PASS', recordedAt: '2026-10-08T13:00:00Z' } },
    { name: 'BOXING', last: { status: 'DOWN', product: 'Milk', qualityCheck: 'FAIL', recordedAt: '2026-10-08T15:30:00Z' } }];
  const temps = [{ location: 'Cooler North', status: 'MANUAL ONLY', sensorTemp: '', lastManualTemperature: 36, lastStatus: 'RECORDED', lastCheckedAt: '2026-10-08T13:00:00Z', lowLimit: '', highLimit: 40, locked: false },
    { location: 'Cooler Middle', status: 'MANUAL ONLY', sensorTemp: '', lastManualTemperature: 45, lastStatus: 'HIGH', lastCheckedAt: '2026-10-08T15:30:00Z', lowLimit: '', highLimit: 40, locked: true }];
  const r = R.plantReport({ loads: [], lines, temps, roundStart: '2026-10-08T14:00:00Z' }, Date.parse('2026-10-08T16:00:00Z'));
  assert.deepEqual(r.lines.map(l => [l.line, l.status, l.product, !!l.notChecked]), [['TOTES', 'NOT CHECKED', '', true], ['BOXING', 'DOWN', 'Milk', false]]);
  assert.deepEqual(r.temperatures.map(t => [t.location, t.status, t.reading]), [['Cooler North', 'NOT CHECKED', ''], ['Cooler Middle', 'HIGH', '45']]);
  assert.match(r.text, /TOTES {2}NOT CHECKED {2}last check 9:00 AM/);
  assert.match(r.text, /Cooler North {2}- {2}NOT CHECKED \(last 9:00 AM\)/);
  assert.match(R.reportHtml(r, ''), /TOTES<\/td>[\s\S]*NOT CHECKED/);
  // No report sent yet: everything counts, as before.
  assert.equal(R.plantReport({ loads: [], lines, temps }, Date.parse('2026-10-08T16:00:00Z')).lines[0].status, 'RUNNING');
});

test('Shift Notes option A in the report: open breakdowns carry over until resolved; fixed, handoff and the rest since the last report', () => {
  const rec = (id, at, type, entry, status, parent) => ({ type: 'SHIFT_REPORT', recordedAt: at, recordedBy: 'm@uniteddairy.com', payload: { entryId: id, section: 'HANDOFF', shift: 'FIRST SHIFT', values: { Entry: entry, Type: type, Equipment: parent ? '' : 'Filler', ParentId: parent || '' }, followUpStatus: status } });
  const journal = [rec('a', '2026-10-07T20:00:00Z', 'Breakdown', 'Valve leaking', 'OPEN'), rec('ar', '2026-10-08T10:20:00Z', 'REVIEW', 'slow drip only', 'MONITOR', 'a'),
    rec('b', '2026-10-08T08:00:00Z', 'Breakdown', 'Belt off', 'OPEN'), rec('br', '2026-10-08T15:00:00Z', 'REVIEW', 'Belt replaced', 'RESOLVED', 'b'),
    rec('c', '2026-10-08T15:10:00Z', 'Handoff', 'Run 2% next', 'OPEN'), rec('d', '2026-10-08T15:20:00Z', 'Safety', 'Wet floor', 'OPEN'), rec('e', '2026-10-08T12:00:00Z', 'Safety', 'Old one', 'OPEN')];
  const now = Date.parse('2026-10-08T16:00:00Z'), round = '2026-10-08T14:00:00Z';
  assert.equal(R.shiftLog(journal, now, 168).length, 5, 'five entries, the reviews under them');
  const s = R.shiftReport(R.shiftLog(journal, now, 168), round);
  assert.deepEqual(s.down.map(d => [d.entry, d.status, d.carried, d.review]), [['Valve leaking', 'MONITOR', true, 'slow drip only']]);
  assert.deepEqual(s.fixed.map(d => [d.entry, d.review]), [['Belt off', 'Belt replaced']]);
  assert.deepEqual(s.handoff.map(d => d.entry), ['Run 2% next']);
  assert.deepEqual(s.others.map(d => d.entry), ['Wet floor']);
  const r = R.plantReport({ loads: [], shiftLog: R.shiftLog(journal, now, 168), roundStart: round }, now);
  assert.match(r.text, /Valve leaking.*MONITOR {2}\(carried over\)/);
  assert.match(r.text, /FIXED SINCE LAST REPORT \(1\)\n {2}Filler {2}Belt off {2}RESOLVED/);
  assert.match(r.text, /SHIFT HANDOFF \(1\)/);
  assert.match(r.text, /INCIDENTS · SAFETY · QUALITY \(1\)/);
  assert.match(R.reportHtml(r, ''), /CARRIED OVER[\s\S]*MONITOR[\s\S]*Fixed since last report/);
});
