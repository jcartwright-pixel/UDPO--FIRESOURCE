'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const P = require('../../../tools/production-env.cjs');

// The production server's settings: the real sheets read only, no write-back, no sandbox copies, no made-up data.
const ROOT = path.join(__dirname, '../../..');
const settings = require(path.join(ROOT, 'production-settings.json'));
const sandbox = P.sandboxIds(path.join(ROOT, 'sandbox-sources.json'));

test('the production settings in the repository pass and read the real sheets', () => {
  const { env, problems } = P.productionEnv(settings, '', sandbox);
  assert.deepEqual(problems, []);
  assert.equal(env.READ_UNIONTOWN_SHEETS, '1');
  assert.equal(P.envText(env).includes('WRITEBACK_JSON'), false);
});

test('production refuses the write-back, the made-up sheets and the sandbox copies', () => {
  const firstCopy = [...sandbox][0];
  assert.ok(firstCopy, 'sandbox-sources.json names its copies');
  const bad = [
    'WRITEBACK_JSON={"spreadsheetId":"11beWtlO848OyZI_Bom9y2WCZn2vnw4mLm24pf-rO1Cg"}',
    'DEMO_DATA=1',
    'SOURCES_JSON={"live":{"spreadsheetId":"' + firstCopy + '"}}',
    'READ_UNIONTOWN_SHEETS=0',
    'MAIL_FROM=someone@gmail.com',
    'REPORT_TO=a@uniteddairy.com, b@example.com',
    'SOMETHING_ELSE=1'
  ];
  bad.forEach(line => assert.ok(P.productionEnv(settings, line, sandbox).problems.length > 0, line + ' is refused'));
});

test('the plant managers can be added without a commit', () => {
  const { env, problems } = P.productionEnv(settings, 'REPORT_TO=a@uniteddairy.com,b@uniteddairy.com', sandbox);
  assert.deepEqual(problems, []);
  assert.match(P.envText(env), /^REPORT_TO=a@uniteddairy\.com,b@uniteddairy\.com$/m);
});
