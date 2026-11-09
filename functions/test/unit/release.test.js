'use strict';
// Joe 11-9-26: "This needs to be pushed and deployed automatically. I shouldn't have to do anything anymore."
// The automatic release goes practice copy first, then live, and only from green tests on main.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const wf = name => fs.readFileSync(path.join(__dirname, '../../../.github/workflows', name), 'utf8');

test('automatic release: starts only from the full tests passing on main', () => {
  const r = wf('release.yml');
  assert.match(r, /workflow_run:\s*\n\s*workflows: \[Distribution app tests\]\s*\n\s*types: \[completed\]\s*\n\s*branches: \[main\]/);
  assert.match(r, /github\.event\.workflow_run\.conclusion == 'success'/, 'a red or cancelled test run releases nothing');
  assert.match(r, /git ls-remote .* refs\/heads\/main/, 'only while the tested code is still the newest main');
  assert.match(wf('tests.yml'), /^name: Distribution app tests$/m, 'the name it waits for is the tests workflow');
});

test('automatic release: practice copy first, live only after it passes', () => {
  const r = wf('release.yml');
  const practice = r.indexOf('practice-copy:'), live = r.indexOf('\n  live:');
  assert.ok(practice > 0 && live > practice);
  assert.match(r.slice(practice, live), /uses: \.\/\.github\/workflows\/deploy\.yml\s*\n\s*with:\s*\n\s*target: sandbox/);
  assert.match(r.slice(live), /needs: practice-copy\s*\n\s*uses: \.\/\.github\/workflows\/deploy\.yml\s*\n\s*with:\s*\n\s*target: production\s*\n\s*confirm: DEPLOY PRODUCTION/);
});

test('deploy: production still only from main, by hand or the automatic release', () => {
  const d = wf('deploy.yml');
  assert.match(d, /workflow_call:/);
  assert.match(d, /"\$EVENT" != workflow_dispatch \] && \[ "\$EVENT" != workflow_run \]/);
  assert.match(d, /"\$REF" != refs\/heads\/main/);
  assert.match(d, /"\$CONFIRM" != 'DEPLOY PRODUCTION'/);
});

test('screen tests in parts: every test once, in the same order, each part with fresh emulators', () => {
  const { parts } = require('../../../tools/browser-parts.cjs');
  const script = require('../../package.json').scripts['test:browser'];
  const p = parts(script, 3);
  assert.equal(p.parts.length, 3);
  assert.deepEqual(p.parts.flat(), p.cmds, 'nothing skipped, nothing moved');
  assert.ok(p.cmds.length > 100);
  assert.match(p.flags, /--only firestore,auth,functions,hosting --project demo-ud-distribution/);
  assert.match(p.env, /UD_FAKE_LIVE_ROLL=1/);
  assert.match(wf('tests.yml'), /node \.\.\/tools\/browser-parts\.cjs 3/);
});
