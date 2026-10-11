'use strict';
// Load notes that ask for a pickup ("pickup", "pick up", "P/U", "PU") count as open pickups (Joe 10/11, review item 35).
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../../src/board-rules');

const run = (note) => ({ id: 'wk__run_801', runId: 'run_801', route: '801', run: 'UT DSD MILK', days: { fri: { plantNotes: note, updatedBy: 'loader@uniteddairy.com' } } });

test('the words that ask for a pickup, in any case', () => {
  ['Pickup 10 cases mix', 'pick up 2 gal', 'PICK-UP choc', 'p/u 4 cases', 'P / U half gallons', 'PU 6 qts', 'needs pu', 'pickups at dock'].forEach(n => {
    assert.ok(B.notePickup(run(n), 'fri', '2026-10-08', []), n);
  });
  ['loaded late', 'pump broke', 'upup', 'PUMPKIN', 'spud', ''].forEach(n => assert.equal(B.notePickup(run(n), 'fri', '2026-10-08', []), null, n));
});

test('listed as an open pickup with the note as the item; none when a pickup was entered for the load', () => {
  const p = B.notePickup(run('P/U 10 cases 14.5% mix'), 'fri', '2026-10-08', []);
  assert.equal(p.pickupId, 'note:wk__run_801|fri|2026-10-08');
  assert.equal(p.item, 'P/U 10 cases 14.5% mix');
  assert.equal(p.date, '2026-10-08');
  assert.ok(B.pickupOpen(p));
  assert.equal(B.notePickup(run('P/U 10 cases'), 'fri', '2026-10-08', [{ status: 'COMPLETE' }]), null);
});

test('the drivers\' board shows the note\'s pickup in red, but not twice', () => {
  const r = Object.assign(run('PU 6 qts chocolate'), { weekStart: '2026-10-04' });
  r.days.fri = Object.assign(r.days.fri, { runs: true, loadDayOffset: -1 });
  const shown = B.boardRows([r], [], '2026-10-09')[0];
  assert.equal(shown.pickup, true);
  assert.match(shown.pickupText, /PU 6 qts chocolate/);
  const entered = B.boardRows([r], [{ runDocId: r.id, day: 'fri', date: '2026-10-08', item: 'Choc qts', quantity: '6', status: 'PENDING' }], '2026-10-09')[0];
  assert.equal(entered.pickupText, '6 Choc qts');
});
