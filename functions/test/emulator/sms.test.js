'use strict';
// Joe 10/15: Schedule Texts, built ready and kept Off. When a new week becomes the Live Current week and the switch is On,
// each driver on it with a mobile phone gets one text; the test copy only writes them to the log.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const SMS = require('../../src/sms');
const L = require('../../src/logic');
const F = require('../fixtures/fake-sheets');

const ADMIN = { email: 'admin.test@uniteddairy.com' };
const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
const SID = 'AC' + '0123456789abcdef'.repeat(2);
const WEEK = '2026-10-18';

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES });
  const b = db().batch();
  b.set(db().collection('runs').doc(WEEK + '__run_t905'), { weekStart: WEEK, route: '905', run: 'UT DSD MILK', runId: 'run_t905', rev: 0, days: { mon: { runs: true, driverId: 'drv_test_casey', driver: 'CASEY, LEE' } } });
  b.set(db().collection('runs').doc(WEEK + '__run_t836'), { weekStart: WEEK, route: '836', run: 'PECK', runId: 'run_t836', rev: 0, days: { tue: { runs: true, driverId: 'drv_test_brook', driver: 'BROOK' } } });
  b.set(db().collection('config').doc('app'), { liveWeeks: { previous: L.addDays(WEEK, -14), current: L.addDays(WEEK, -7), next: WEEK } }, { merge: true });
  await b.commit();
});
const post = () => db().collection('config').doc('app').set({ liveWeeks: { previous: L.addDays(WEEK, -7), current: WEEK, next: L.addDays(WEEK, 7) } }, { merge: true });

test('phone numbers: 10 digits, with or without a leading 1, written like 330-555-1234', () => {
  assert.equal(SMS.phoneE164('(330) 555-1234'), '+13305551234');
  assert.equal(SMS.phoneE164('1-330-555-1234'), '+13305551234');
  assert.equal(SMS.phoneE164('555-1234'), '');
  assert.equal(SMS.phoneText('+13305551234'), '330-555-1234');
  assert.match(SMS.messageFor(WEEK), /week of 10-18-26 to 10-24-26 is posted\. Open UD Routes > My Schedule/);
});

test('the Driver Roster keeps the mobile phone apart from the driver record; a bad number is refused', async () => {
  await assert.rejects(applyAction(db(), ADMIN, { action: 'setDriverPhone', requestId: 'req-phone-bad-0001', driverId: 'drv_test_casey', phone: '555-1234' }), /10 digits/);
  await applyAction(db(), ADMIN, { action: 'setDriverPhone', requestId: 'req-phone-good-0001', driverId: 'drv_test_casey', phone: '330 555 1234' });
  assert.equal((await db().collection('driverPhones').doc('drv_test_casey').get()).data().phone, '+13305551234');
  assert.notEqual((await db().collection('drivers').doc('drv_test_casey').get()).data().phone, '+13305551234', 'not on the driver record');
  // The sheet copy rewriting the driver leaves the number alone.
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES });
  assert.equal((await db().collection('driverPhones').doc('drv_test_casey').get()).data().phone, '+13305551234');
});

test('Schedule Texts: administrators only, Off by default, keys never sent back, On needs the account', async () => {
  await assert.rejects(SMS.smsCall(db(), DISPATCHER, { op: 'status' }), /Only an administrator/);
  let s = await SMS.smsCall(db(), ADMIN, { op: 'status' }, { env: {} });
  assert.equal(s.on, false);
  assert.equal(s.live, false);
  await assert.rejects(SMS.smsCall(db(), ADMIN, { op: 'setOn', on: true }), /Save the Twilio/);
  await assert.rejects(SMS.smsCall(db(), ADMIN, { op: 'save', accountSid: 'nope' }), /starts with AC/);
  s = await SMS.smsCall(db(), ADMIN, { op: 'save', accountSid: SID, authToken: 'secret-token', fromNumber: '330-555-0000' }, { env: {} });
  assert.deepEqual([s.hasSid, s.hasToken, s.from], [true, true, '330-555-0000']);
  assert.ok(!JSON.stringify(s).includes('secret-token') && !JSON.stringify(s).includes(SID), 'the account is never sent back');
  const p = await SMS.smsCall(db(), ADMIN, { op: 'preview' });
  assert.equal(p.week, WEEK);
  assert.deepEqual(p.drivers.map(d => d.name).length, 2);
});

test('Off: a posted week sends nothing; On: the week already posted is not texted, the next one is, once', async () => {
  await SMS.smsCall(db(), ADMIN, { op: 'save', accountSid: SID, authToken: 'tok', fromNumber: '3305550000' });
  await applyAction(db(), ADMIN, { action: 'setDriverPhone', requestId: 'req-phone-good-0002', driverId: 'drv_test_casey', phone: '3305551234' });
  const calls = [], fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 201, json: async () => ({}) }; };
  const live = { env: { LIVE_TEXTS: '1' }, fetch };
  await post();
  assert.equal(await SMS.postedCheck(db(), live), null, 'Off: nothing');
  await SMS.smsCall(db(), ADMIN, { op: 'setOn', on: true });
  assert.equal(await SMS.postedCheck(db(), live), null, 'the week already posted when it was turned On is not texted');
  // The next week is posted.
  const next = L.addDays(WEEK, 7);
  await db().collection('runs').doc(next + '__run_t905').set({ weekStart: next, route: '905', run: 'UT DSD MILK', runId: 'run_t905', rev: 0, days: { mon: { runs: true, driverId: 'drv_test_casey', driver: 'CASEY, LEE' }, wed: { runs: true, driverId: 'drv_test_brook', driver: 'BROOK' } } });
  await db().collection('config').doc('app').set({ liveWeeks: { previous: WEEK, current: next, next: L.addDays(next, 7) } }, { merge: true });
  const r = await SMS.postedCheck(db(), live);
  assert.deepEqual([r.week, r.drivers, r.sent, r.noPhone], [next, 2, 1, 1]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, new RegExp('/Accounts/' + SID + '/Messages\\.json$'));
  assert.equal(calls[0].init.headers.Authorization, 'Basic ' + Buffer.from(SID + ':tok').toString('base64'));
  assert.match(calls[0].init.body, /To=%2B13305551234&From=%2B13305550000&Body=United\+Dairy/);
  assert.equal((await db().collection('textLog').doc(next + '_drv_test_casey').get()).data().status, 'SENT');
  assert.equal((await db().collection('textLog').doc(next + '_drv_test_brook').get()).data().status, 'NO PHONE');
  assert.equal(await SMS.postedCheck(db(), live), null, 'never twice');
  assert.equal(calls.length, 1);
});

test('the test copy (no LIVE_TEXTS) never sends: the texts go to the log as not sent', async () => {
  await SMS.smsCall(db(), ADMIN, { op: 'save', accountSid: SID, authToken: 'tok', fromNumber: '3305550000' });
  await applyAction(db(), ADMIN, { action: 'setDriverPhone', requestId: 'req-phone-good-0003', driverId: 'drv_test_casey', phone: '3305551234' });
  await SMS.smsCall(db(), ADMIN, { op: 'setOn', on: true });
  await post();
  const calls = [];
  const r = await SMS.postedCheck(db(), { env: {}, fetch: async () => { calls.push(1); return { ok: true }; } });
  assert.deepEqual([r.week, r.live, r.sent], [WEEK, false, 0]);
  assert.equal(calls.length, 0);
  assert.match((await db().collection('textLog').doc(WEEK + '_drv_test_casey').get()).data().reason, /Test copy: not sent/);
});
