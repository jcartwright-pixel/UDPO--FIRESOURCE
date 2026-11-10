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
  const p = parts(script, 4);
  assert.equal(p.parts.length, 4);
  assert.deepEqual(p.parts.flat(), p.cmds, 'nothing skipped, nothing moved');
  assert.ok(p.cmds.length > 100);
  assert.match(p.flags, /--only firestore,auth,functions,hosting --project demo-ud-distribution/);
  assert.match(p.env, /UD_FAKE_LIVE_ROLL=1/);
  assert.match(wf('tests.yml'), /node \.\.\/tools\/browser-parts\.cjs 4/);
});

test('merge by itself: only a green, non-draft pull request from this repository, then the main tests start', () => {
  const a = wf('auto-merge.yml');
  assert.match(a, /workflows: \[Distribution app tests\]/);
  assert.match(a, /"\$draft" = true \]; then echo "Pull request \$pr is a draft: held, not merged\."; exit 0/, 'a draft is held');
  assert.match(a, /"\$head" != "\$SHA"/, 'only the exact code that was tested');
  assert.match(a, /completed\\t\(success\|skipped\|neutral\)\$/, 'every check finished green');
  assert.match(a, /-f sha="\$SHA"/);
  assert.match(a, /gh workflow run tests\.yml --repo "\$REPO" --ref main/, 'the main tests start after the merge');
  assert.match(wf('release.yml'), /github\.event\.workflow_run\.event == 'workflow_dispatch'/, 'and the release takes that run');
});

test('a branch is tested once, through its pull request; main on every push', () => {
  const t = wf('tests.yml');
  assert.match(t, /^on:\n(?:#.*\n)*  push:\n    branches: \[main\]\n/m, 'a push tests main only');
  assert.match(t, /^  pull_request:\n/m, 'a pull request is tested');
});

test('a merge made by auto-merge.yml still releases: its green main run starts the release itself', () => {
  const t = wf('tests.yml');
  const job = t.slice(t.indexOf('\n  release:'));
  assert.match(job, /needs: test/, 'only after every test passed');
  assert.match(job, /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main' && github\.actor == 'github-actions\[bot\]'/);
  assert.match(job, /actions: write/);
  assert.match(job, /gh workflow run release\.yml --repo "\$\{\{ github\.repository \}\}" --ref main/);
});
