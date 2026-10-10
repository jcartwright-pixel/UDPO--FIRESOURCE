'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Joe 10/10: every table and week view runs Sunday to Saturday. A day list or week header that starts on
// Monday anywhere in the screens fails the build.
const PUB = path.join(__dirname, '../../../public');
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === 'img' ? [] : files(path.join(dir, e.name)))
    : /\.(html|js)$/.test(e.name) ? [path.join(dir, e.name)] : []);
}
const MONDAY_FIRST = [
  /\[\s*['"]mon['"]\s*,\s*['"]tue['"][^\]]*['"]sun['"]/i,                       // ['mon', 'tue', ... 'sun']
  /\[\s*['"]Monday['"]\s*,\s*['"]Tuesday['"][^\]]*['"]Sunday['"]/,               // ['Monday', ... 'Sunday']
  /<th[^>]*>\s*Mon(day)?\s*<\/th>\s*<th[^>]*>\s*Tue(sday)?\s*<\/th>(?:\s*<th[^>]*>[^<]*<\/th>){4}/i // a header row starting Mon
];

test('every week view in the screens starts on Sunday', () => {
  const bad = [];
  files(PUB).forEach(f => {
    const text = fs.readFileSync(f, 'utf8');
    MONDAY_FIRST.forEach(re => { const m = text.match(re); if (m && !/<th[^>]*>\s*Sun/i.test(text.slice(Math.max(0, m.index - 60), m.index))) bad.push(path.relative(PUB, f) + ': ' + m[0].slice(0, 60)); });
  });
  assert.deepEqual(bad, []);
});
