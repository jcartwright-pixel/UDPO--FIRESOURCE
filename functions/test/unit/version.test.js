'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const V = require('../../../tools/stamp-version.cjs');

// Joe 10/11: the line at the bottom of the menu says which release and which copy (live or the test copy).
// Joe 10/12 "should we have a version number": a real number that goes up each release; the test copy shows the next one.
test('version line: Live shows the release number, the test copy shows the next number', () => {
  assert.equal(V.label('6.3', '10-12-26', true), 'Version 6.3 · 10-12-26');
  assert.equal(V.label('6.3', '10-12-26', false), 'Version 6.4 · 10-12-26 · Test copy');
  assert.equal(V.label('6', '10-12-26', false), 'Version 6.1 · 10-12-26 · Test copy');
  assert.equal(V.label('6.9', '10-12-26', false), 'Version 6.10 · 10-12-26 · Test copy');
  assert.equal(V.label(null, '10-11-26', true), 'Version · 10-11-26');
});

test('version line: reads "Release 6.3:" commit subjects, newest first', () => {
  assert.equal(V.parseRelease('Release 6.3: plant tablet employee view (#213)\nRelease 6.2: x\nRelease 6: y'), '6.3');
  assert.equal(V.parseRelease('Fix a thing\nRelease 6: y'), '6');
  assert.equal(V.parseRelease('Released the hounds'), null);
});

test('version line: short dates on the plant clock, like 10-8-26', () => {
  assert.equal(V.today(new Date('2026-10-09T02:30:00Z')), '10-8-26', 'evening of 10/8 in Ohio');
  assert.equal(V.today(new Date('2026-01-05T15:00:00Z')), '1-5-26');
});

test('version line: the deploy stamps version.json before uploading the screens', () => {
  const wf = fs.readFileSync(path.join(__dirname, '../../../.github/workflows/deploy.yml'), 'utf8');
  assert.match(wf, /node tools\/stamp-version\.cjs "\$TARGET" public/);
  assert.ok(wf.indexOf('stamp-version.cjs') < wf.indexOf('firebase deploy'), 'stamped before the upload');
  const placeholder = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../public/version.json'), 'utf8'));
  assert.equal(placeholder.label, 'Test copy on this computer');
});
