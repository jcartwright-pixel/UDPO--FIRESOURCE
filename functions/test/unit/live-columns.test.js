'use strict';
// Joe 10/13 (Sheet conflicts, route 906 "the sheet has no column coverage_owner"): every column the app writes on a Live week row
// must be a column the real Live week tabs have (demo-sheets.js LIVE_HEADERS is their layout, read from the Uniontown sheets).
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../src/model');
const { LIVE_HEADERS } = require('../../src/demo-sheets');

test('every run column the app writes to the Live sheet is a real Live column; coverage_owner stays in the app', () => {
  const written = M.RUN_FIELDS.filter(([f]) => M.APP_ONLY_RUN_FIELDS.indexOf(f) < 0).map(([, col]) => col);
  assert.deepEqual(written.filter(c => LIVE_HEADERS.indexOf(c) < 0), []);
  assert.equal(LIVE_HEADERS.indexOf('coverage_owner'), -1, 'the Live tabs have no coverage_owner column');
  assert.ok(M.APP_ONLY_RUN_FIELDS.indexOf('coverageOwner') >= 0);
});

test('every day column the app writes to the Live sheet is a real Live column', () => {
  const missing = [];
  M.DAY_FIELDS.filter(([f]) => M.APP_ONLY_DAY_FIELDS.indexOf(f) < 0).forEach(([, suffix]) => {
    ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].forEach(p => { if (LIVE_HEADERS.indexOf(p + '_' + suffix) < 0) missing.push(p + '_' + suffix); });
  });
  assert.deepEqual(missing, []);
});
