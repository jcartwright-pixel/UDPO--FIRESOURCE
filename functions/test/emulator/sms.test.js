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

test('replies: kept in the log with the driver only when Twilio signed them with the saved Auth Token', async () => {
  await SMS.smsCall(db(), ADMIN, { op: 'save', accountSid: SID, authToken: 'tok', fromNumber: '3305550000' });
  await applyAction(db(), ADMIN, { action: 'setDriverPhone', requestId: 'req-phone-good-0004', driverId: 'drv_test_casey', phone: '3305551234' });
  const url = SMS.replyAddress('demo-ud-distribution');
  assert.equal(url, 'https://us-east4-demo-ud-distribution.cloudfunctions.net/smsReply');
  const params = { AccountSid: SID, MessageSid: 'SM' + 'a'.repeat(32), From: '+13305551234', To: '+13305550000', Body: 'Got it, thanks' };
  const signed = { 'x-twilio-signature': SMS.twilioSignature('tok', url, params) };
  // Not signed, or signed with another token: refused, nothing kept.
  assert.equal((await SMS.handleReply(db(), url, {}, params))[0], 403);
  assert.equal((await SMS.handleReply(db(), url, { 'x-twilio-signature': SMS.twilioSignature('other', url, params) }, params))[0], 403);
  assert.equal((await SMS.handleReply(db(), url, signed, Object.assign({}, params, { Body: 'changed' })))[0], 403, 'a changed message fails the signature');
  assert.equal((await db().collection('textLog').get()).size, 0);
  const [code, body] = await SMS.handleReply(db(), url, signed, params, { now: () => new Date('2026-10-18T12:00:00Z') });
  assert.equal(code, 200);
  assert.match(body, /<Response><\/Response>/, 'no text back to the driver');
  const m = (await db().collection('textLog').doc('in_' + params.MessageSid).get()).data();
  assert.deepEqual([m.direction, m.driverId, m.name, m.body, m.status, m.from], ['in', 'drv_test_casey', 'CASEY, LEE', 'Got it, thanks', 'RECEIVED', '+13305551234']);
  // A number nobody has is still kept, with no driver.
  const stranger = Object.assign({}, params, { MessageSid: 'SM' + 'b'.repeat(32), From: '+12165550000' });
  await SMS.handleReply(db(), url, { 'x-twilio-signature': SMS.twilioSignature('tok', url, stranger) }, stranger);
  assert.equal((await db().collection('textLog').doc('in_' + stranger.MessageSid).get()).data().driverId, '');
});

// Joe 10/26: Load Done Texts. The drivers picked get one text when the plant finishes their load, with its open pickups;
// its own switch, Off by default; the test copy writes the text to the log only.
test('Load Done Texts: only picked drivers, once per load, with the pickups, never a load done before', async () => {
  const at = (t) => ({ now: () => new Date(t), env: {} });
  const run = db().collection('runs').doc(WEEK + '__run_t905');
  await run.set({ days: { mon: { runs: true, driverId: 'drv_test_casey', driver: 'CASEY, LEE', trailer: '901', casesOut: 1200 } } }, { merge: true });
  await db().collection('pickups').doc('pu1').set({ date: '2026-10-19', runId: 'run_t905', route: '905', run: 'UT DSD MILK', item: 'crates chocolate milk', quantity: '2', status: 'PENDING' });
  await assert.rejects(SMS.smsCall(db(), DISPATCHER, { op: 'setDoneOn', on: true }), /Only an administrator/);
  await assert.rejects(SMS.smsCall(db(), ADMIN, { op: 'setDoneOn', on: true }), /Save the Twilio account/);
  await SMS.smsCall(db(), ADMIN, { op: 'save', accountSid: SID, authToken: 'secret-token', fromNumber: '330-555-0000' }, { env: {} });
  await applyAction(db(), ADMIN, { action: 'setDriverPhone', requestId: 'req-phone-done-0001', driverId: 'drv_test_casey', phone: '330 555 1234' });
  let list = await SMS.smsCall(db(), ADMIN, { op: 'doneList' }, { env: {} });
  assert.equal(list.doneOn, false, 'Off by default');
  assert.ok(list.drivers.some(d => d.driverId === 'drv_test_casey' && d.phone === '330-555-1234' && !d.picked));
  assert.match(list.sample, /^United Dairy: your load is done\. Route 801 UT DSD MILK, trailer T-901, 1,200 cases\. Pickups: 2 crates chocolate milk\.$/);
  await SMS.smsCall(db(), ADMIN, { op: 'setDoneDriver', driverId: 'drv_test_casey', on: true }, at('2026-10-18T15:00:00Z'));
  // Off: nothing, even with the load done.
  await run.set({ days: { mon: { completeTime: '2026-10-18T17:30:00.000Z', loadStatus: 'COMPLETE' } } }, { merge: true });
  assert.equal(await SMS.loadDoneCheck(db(), at('2026-10-18T18:00:00Z')), null);
  // On after the load was done: that load is never texted.
  await SMS.smsCall(db(), ADMIN, { op: 'setDoneOn', on: true }, at('2026-10-18T17:45:00Z'));
  assert.equal(await SMS.loadDoneCheck(db(), at('2026-10-18T18:00:00Z')), null);
  // Finished again after: one text, written to the log only on the test copy.
  await run.set({ days: { mon: { completeTime: '2026-10-18T17:50:00.000Z' } } }, { merge: true });
  const r = await SMS.loadDoneCheck(db(), at('2026-10-18T18:00:00Z'));
  assert.deepEqual([r.logged, r.sent, r.live], [1, 0, false]);
  const log = (await db().collection('textLog').doc('done_2026-10-18_' + WEEK + '__run_t905_mon').get()).data();
  assert.equal(log.kind, 'LOAD_DONE');
  assert.equal(log.status, 'NOT SENT');
  assert.equal(log.to, '+13305551234');
  assert.equal(log.body, 'United Dairy: your load is done. Route 905 UT DSD MILK, trailer T-901, 1,200 cases. Pickups: 2 crates chocolate milk.');
  assert.equal(await SMS.loadDoneCheck(db(), at('2026-10-18T18:01:00Z')), null, 'once per load');
  // A driver not picked is never texted; un-ticking stops the texts.
  await SMS.smsCall(db(), ADMIN, { op: 'setDoneDriver', driverId: 'drv_test_casey', on: false });
  assert.deepEqual((await SMS.smsCall(db(), ADMIN, { op: 'status' })).doneDrivers, []);
  await assert.rejects(SMS.smsCall(db(), ADMIN, { op: 'setDoneDriver', driverId: 'drv_nobody', on: true }), /not on the Driver Roster/);
});

test('Load Done Texts: on the live app it sends through Twilio, and a load with no pickups says so', async () => {
  const sent = [];
  const fakeFetch = async (url, init) => { sent.push({ url, body: String(init.body) }); return { ok: true, json: async () => ({}) }; };
  await db().collection('runs').doc(WEEK + '__run_t905').set({ days: { mon: { runs: true, driverId: 'drv_test_casey', driver: 'CASEY, LEE', trailer: '901', casesOut: 40 } } }, { merge: true });
  await db().collection('driverPhones').doc('drv_test_casey').set({ driverId: 'drv_test_casey', phone: '+13305551234' });
  await SMS.smsCall(db(), ADMIN, { op: 'save', accountSid: SID, authToken: 'secret-token', fromNumber: '330-555-0000' }, { env: {} });
  await SMS.smsCall(db(), ADMIN, { op: 'setDoneDriver', driverId: 'drv_test_casey', on: true }, { now: () => new Date('2026-10-18T15:00:00Z') });
  await SMS.smsCall(db(), ADMIN, { op: 'setDoneOn', on: true }, { now: () => new Date('2026-10-18T15:00:00Z') });
  await db().collection('runs').doc(WEEK + '__run_t905').set({ days: { mon: { completeTime: '2026-10-18T17:50:00.000Z' } } }, { merge: true });
  const r = await SMS.loadDoneCheck(db(), { now: () => new Date('2026-10-18T18:00:00Z'), env: { LIVE_TEXTS: '1' }, fetch: fakeFetch });
  assert.deepEqual([r.sent, r.failed], [1, 0]);
  assert.equal(sent.length, 1);
  const p = new URLSearchParams(sent[0].body);
  assert.deepEqual([p.get('To'), p.get('From'), p.get('Body')], ['+13305551234', '+13305550000', 'United Dairy: your load is done. Route 905 UT DSD MILK, trailer T-901, 40 cases. No pickups.']);
});
