'use strict';
// Joe 11-14-26 ("route 12 on Tuesday ... leaves at 1:30 in the morning, it's not putting those values in there ... it hasn't
// kicked over to the new day, which is 6 a.m."): the DVIR goes by when the run leaves, not by the 6 AM day change.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { dvirPick, dvirOpen, leaveText, DVIR_AHEAD_HOURS } = require('../../src/phone');
const T = require('../../src/timing-rules');

const wall = (day, clock) => T.dayNum(day) * T.DAY + T.clockMinutes(clock);

test('a run leaving after midnight is open for its DVIR the evening before; one leaving more than 12 hours out is not', () => {
  assert.equal(DVIR_AHEAD_HOURS, 12);
  // Monday 11-16-26 at 11:30 PM (the operating day is still Monday): Tuesday's route 12 leaves at 1:30 AM.
  const now = wall('2026-11-16', '11:30 PM');
  assert.equal(dvirOpen('2026-11-17', '2026-11-16', wall('2026-11-17', '1:30 AM'), now), true);
  // Tuesday's 4:00 PM run is more than 12 hours away: not yet.
  assert.equal(dvirOpen('2026-11-17', '2026-11-16', wall('2026-11-17', '4:00 PM'), now), false);
  // Tomorrow's run with no dispatch time is not guessed at.
  assert.equal(dvirOpen('2026-11-17', '2026-11-16', null, now), false);
  // Yesterday's and today's runs stay open (a post-trip after a late return).
  assert.equal(dvirOpen('2026-11-15', '2026-11-16', null, now), true);
  assert.equal(dvirOpen('2026-11-16', '2026-11-16', wall('2026-11-16', '1:30 AM'), now), true);
});

test('the route list says the day and time each run leaves', () => {
  assert.equal(leaveText(wall('2026-11-17', '1:30 AM')), 'Tue 1:30 AM');
  assert.equal(leaveText(wall('2026-11-15', '1:00 PM')), 'Sun 1:00 PM');
  assert.equal(leaveText(null), '');
});

test('a pre-trip starts on the next run to leave, a post-trip on the run that left last', () => {
  // Monday's 1:30 AM run left 22 hours ago; Tuesday's 1:30 AM run leaves in 2 hours.
  assert.deepEqual(dvirPick([{ leavesIn: -22 * 60 }, { leavesIn: 120 }]), { pre: 1, post: 0 });
  // Tuesday at 11 AM: the 1:30 AM run left 9.5 hours ago, Wednesday's leaves in 14.5 hours: both start on the run that left.
  assert.deepEqual(dvirPick([{ leavesIn: -570 }, { leavesIn: 870 }]), { pre: 1, post: 0 });
  // A pre-trip a little late (the run left 20 minutes ago) still starts on that run.
  assert.deepEqual(dvirPick([{ leavesIn: -1460 }, { leavesIn: -20 }]), { pre: 1, post: 1 });
  // No leaving times: the first run.
  assert.deepEqual(dvirPick([{ leavesIn: null }, { leavesIn: null }]), { pre: 0, post: 0 });
  assert.deepEqual(dvirPick([]), { pre: 0, post: 0 });
});

test('the phone asks for the DVIR runs by leaving time and starts on the server\'s pick', () => {
  const route = fs.readFileSync(path.join(__dirname, '../../../public/route.html'), 'utf8');
  assert.match(route, /call\('loads', \{ driverId, dvir: true \}\)/);
  assert.match(route, /dvPick\.post : dvPick\.pre/);
  assert.match(route, /' · leaves ' \+ l\.leaves/);
});
