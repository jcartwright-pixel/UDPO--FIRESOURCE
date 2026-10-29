'use strict';
// Joe 10/28: "I do not want the date to change unless I change it. Whenever I change it, I publish to the new week, and then it
// brings in the following next week." The weeks move only on Publish: the scheduled job never publishes by the calendar, and
// Weekly Dispatch never picks its week from today's date.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('the scheduled job never publishes a week by the calendar', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../index.js'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /autoPublish\s*\(/);
});

test('Weekly Dispatch opens on the kept week or the Live Next week, never on the calendar week', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../../public/weekly.html'), 'utf8');
  assert.match(src, /localStorage\.getItem\('ud\.weekly\.next\.' \+ who\)/);
  assert.match(src, /week = L\.isDateKey\(kept\) && !published \? L\.weekStart\(kept\) : L\.isDateKey\(first\.next\) \? first\.next : week;/);
});
