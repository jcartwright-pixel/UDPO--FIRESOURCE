'use strict';
// Joe 10/19 (Plant Distribution and Yard Checks slow to open): the one-day load records (src/rundays.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../src/rundays');

const run = { weekStart: '2026-10-18', route: '845', run: 'SUN VALLEY', rev: 4, cells: { route: '845' }, fingerprint: 'abc', transferredAt: 'x', sourceTab: 'LIVE CURRENT WEEK',
  days: { mon: { runs: true, trailer: 'T-845' }, wed: { runs: true, loadDayOffset: -2, departureDate: '2026-10-22' }, sat: { runs: false, loadDayOffset: 0 } } };

test('each day touches its load, carry, delivery and departure dates', () => {
  assert.deepEqual(R.dayDates(run, 'mon', run.days.mon), ['2026-10-18', '2026-10-19'], 'loaded the day before (a blank offset is -1)');
  assert.deepEqual(R.dayDates(run, 'wed', run.days.wed), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'], 'loaded two days before, leaves the day after');
  assert.deepEqual(R.dayDates(run, 'sat', run.days.sat), ['2026-10-24'], 'loaded the same day');
});

test('a load date far from the delivery (1-1-70 on the Live sheet) does not push the delivery day out (Joe 10/20, Save-A-Lot)', () => {
  const day = { runs: true, loadDate: '1970-01-01', loadDayOffset: 0.7916666667, deliveryDate: '2026-10-20', departureDate: '2026-10-20' };
  assert.deepEqual(R.dayDates({ weekStart: '2026-10-18' }, 'tue', day), ['2026-10-20']);
});

test('one record per day with the route facts and that day only; none for the archive', () => {
  const docs = R.docsFor('2026-10-18__845', run);
  assert.deepEqual(Object.keys(docs), ['2026-10-18__845__mon', '2026-10-18__845__wed', '2026-10-18__845__sat']);
  const mon = docs['2026-10-18__845__mon'];
  assert.deepEqual(mon.days, { mon: run.days.mon });
  assert.equal(mon.route, '845');
  assert.equal(mon.rev, 4, 'the run\'s rev stays, as the screens read it');
  assert.equal(mon.runDocId, '2026-10-18__845');
  ['cells', 'fingerprint', 'transferredAt'].forEach(k => assert.equal(mon[k], undefined, k + ' is left out'));
  assert.deepEqual(R.docsFor('x', Object.assign({}, run, { sourceTab: 'DISPATCH WEEK HISTORY' })), {});
  assert.deepEqual(R.docsFor('x', null), {});
});
