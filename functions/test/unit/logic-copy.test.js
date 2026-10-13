'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SHARED_FILES, SRC, DEST } = require('../../../tools/sync-logic.cjs');

test('the screens use the same dispatch rules as the server (run npm run sync-logic after changing them)', () => {
  const server = fs.readFileSync(path.join(__dirname, '../../src/logic.js'), 'utf8');
  const screens = fs.readFileSync(path.join(__dirname, '../../../public/js/logic.js'), 'utf8');
  assert.equal(screens, server);
});

// Review item 78 (Joe 10/13): the sync tool copies all eight shared rule files, and every copy must match the server's.
test('npm run sync-logic copies all eight shared rule files', () => {
  assert.deepEqual([...SHARED_FILES].sort(), ['board-rules.js', 'logic.js', 'otr-core.js', 'plant-rules.js',
    'pmaint-rules.js', 'production-rules.js', 'safety-rules.js', 'sc-core.js']);
});

for (const name of SHARED_FILES) {
  test(`public/js/${name} is the same as functions/src/${name} (run npm run sync-logic after changing it)`, () => {
    assert.equal(fs.readFileSync(path.join(DEST, name), 'utf8'), fs.readFileSync(path.join(SRC, name), 'utf8'));
  });
}
