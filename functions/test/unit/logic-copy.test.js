'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('the screens use the same dispatch rules as the server (run npm run sync-logic after changing them)', () => {
  const server = fs.readFileSync(path.join(__dirname, '../../src/logic.js'), 'utf8');
  const screens = fs.readFileSync(path.join(__dirname, '../../../public/js/logic.js'), 'utf8');
  assert.equal(screens, server);
});
