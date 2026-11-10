'use strict';
// A browser check that fails while holding a page element runs the whole test out of memory (11-10-26: Node builds the
// failure message from the element, which reaches all of Playwright, and grew past 13 GB on GitHub). So checks compare
// yes / no (`!!(await page.$(...))`), never the element itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'browser');

test('no browser check compares a page element itself (a failure would run out of memory)', () => {
  const bad = [];
  for (const f of fs.readdirSync(dir).filter(n => /\.c?js$/.test(n))) {
    fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((line, i) => {
      if (/assert\.(equal|strictEqual|notEqual|notStrictEqual|deepEqual|deepStrictEqual)\(\[?\s*await [A-Za-z_]+\.\$\(/.test(line) &&
          !/assert\.\w+\(await [A-Za-z_]+\.\$\([^)]*\)\s*!==?\s*null/.test(line)) bad.push(f + ':' + (i + 1));
    });
  }
  assert.deepEqual(bad, [], 'use !!(await page.$(...)) and compare to true / false');
});
