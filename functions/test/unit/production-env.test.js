'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const P = require('../../../tools/production-env.cjs');

// The production server's settings: the real sheets, dispatch changes written to the real Live sheet only (Joe 10/12),
// no sandbox copies, no made-up data.
const ROOT = path.join(__dirname, '../../..');
const settings = require(path.join(ROOT, 'production-settings.json'));
const sandbox = P.sandboxIds(path.join(ROOT, 'sandbox-sources.json'));

const REAL_LIVE = '11beWtlO848OyZI_Bom9y2WCZn2vnw4mLm24pf-rO1Cg';

test('the production settings in the repository pass, read the real sheets and write only the real Live sheet', () => {
  const { env, problems } = P.productionEnv(settings, '', sandbox);
  assert.deepEqual(problems, []);
  assert.equal(env.READ_UNIONTOWN_SHEETS, '1');
  // Joe 10/14: live email goes to the people it is meant for.
  assert.equal(env.LIVE_EMAIL, '1');
  assert.deepEqual(JSON.parse(env.WRITEBACK_JSON), { spreadsheetId: REAL_LIVE });
  assert.match(P.envText(env), new RegExp('^WRITEBACK_JSON=\\{"spreadsheetId":"' + REAL_LIVE + '"\\}$', 'm'));
});

test('production refuses a write-back to any other sheet, the made-up sheets and the sandbox copies', () => {
  const firstCopy = [...sandbox][0];
  assert.ok(firstCopy, 'sandbox-sources.json names its copies');
  const bad = [
    'WRITEBACK_JSON={"spreadsheetId":"1rDZpcOABjGtSqobkIQPPNWyWmanfjyHeidGmTK67PvU"}', // Driver Master
    'WRITEBACK_JSON={"spreadsheetId":"1UrAzrPIe4x6jcNBCjCJUIE8mjvJAniZMoONRGK8GJmw"}', // Charleston Live
    'WRITEBACK_JSON={"spreadsheetId":"' + REAL_LIVE + '","masters":{"drivers":{"spreadsheetId":"1rDZpcOABjGtSqobkIQPPNWyWmanfjyHeidGmTK67PvU","tab":"DRIVERS_MASTER"}}}',
    'WRITEBACK_JSON={"spreadsheetId":"' + firstCopy + '"}',
    'WRITEBACK_JSON=not json',
    'DEMO_DATA=1',
    'SOURCES_JSON={"live":{"spreadsheetId":"' + firstCopy + '"}}',
    'READ_UNIONTOWN_SHEETS=0',
    'MAIL_FROM=someone@gmail.com',
    'REPORT_TO=a@uniteddairy.com, b@example.com',
    'LIVE_EMAIL=yes',
    'SOMETHING_ELSE=1'
  ];
  bad.forEach(line => assert.ok(P.productionEnv(settings, line, sandbox).problems.length > 0, line + ' is refused'));
});

test('the plant managers can be added without a commit', () => {
  const { env, problems } = P.productionEnv(settings, 'REPORT_TO=a@uniteddairy.com,b@uniteddairy.com', sandbox);
  assert.deepEqual(problems, []);
  assert.match(P.envText(env), /^REPORT_TO=a@uniteddairy\.com,b@uniteddairy\.com$/m);
});
