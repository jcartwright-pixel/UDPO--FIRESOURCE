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

test('Schedule Texts: administrators only, nothing sent by default, keys never sent back, Send needs the account', async () => {
  await assert.rejects(SMS.smsCall(db(), DISPATCHER, { op: 'status' }), /Only an administrator/);
  let s = await SMS.smsCall(db(), ADMIN, { op: 'status' }, { env: {} });
  assert.equal(s.lastSend, null);
  assert.equal(s.live, false);
  await assert.rejects(SMS.smsCall(db(), ADMIN, { op: 'sendSchedule' }), /Save the Twilio/);
  await assert.rejects(SMS.smsCall(db(), ADMIN, { op: 'save', accountSid: 'nope' }), /starts with AC/);
  s = await SMS.smsCall(db(), ADMIN, { op: 'save', accountSid: SID, authToken: 'secret-token', fromNumber: '330-555-0000' }, { env: {} });
  assert.deepEqual([s.hasSid, s.hasToken, s.from], [true, true, '330-555-0000']);
  assert.ok(!JSON.stringify(s).includes('secret-token') && !JSON.stringify(s).includes(SID), 'the account is never sent back');
  // The posted week's drivers ticked Schedule under Texts on the Driver Roster (Joe 10/26: the roster controls who gets them).
  await post();
  let p = await SMS.smsCall(db(), ADMIN, { op: 'preview' });
  assert.deepEqual([p.week, p.drivers, p.ticked], [WEEK, [], 0]);
  await applyAction(db(), ADMIN, { action: 'setDriverText', requestId: 'req-text-sched-0001', driverId: 'drv_test_casey', kind: 'SCHEDULE', on: true });
  await applyAction(db(), ADMIN, { action: 'setDriverText', requestId: 'req-text-sched-0002', driverId: 'drv_test_adams', kind: 'SCHEDULE', on: true });
  p = await SMS.smsCall(db(), ADMIN, { op: 'preview' });
  assert.deepEqual([p.drivers.map(d => d.name), p.ticked], [['CASEY, LEE'], 2], 'ticked and on the posted week');
  await assert.rejects(applyAction(db(), ADMIN, { action: 'setDriverText', requestId: 'req-text-bad-0001', driverId: 'drv_test_casey', kind: 'OTHER', on: true }), /SCHEDULE or LOAD/);
});

test('Joe 10/31: publishing never texts; Send schedule texts texts the posted week once, Send again a second time', async () => {
  await SMS.smsCall(db(), ADMIN, { op: 'save', accountSid: SID, authToken: 'tok', fromNumber: '3305550000' });
  await applyAction(db(), ADMIN, { action: 'setDriverPhone', requestId: 'req-phone-good-0002', driverId: 'drv_test_casey', phone: '3305551234' });
  for (const id of ['drv_test_casey', 'drv_test_brook']) await applyAction(db(), ADMIN, { action: 'setDriverText', requestId: 'req-text-' + id, driverId: id, kind: 'SCHEDULE', on: true });
  const calls = [], fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 201, json: async () => ({}) }; };
  const live = (t) => ({ env: { LIVE_TEXTS: '1' }, fetch, now: () => new Date(t) });
  await post();
  assert.equal(SMS.postedCheck, undefined, 'nothing sends by itself when a week is posted');
  let r = await SMS.smsCall(db(), ADMIN, { op: 'sendSchedule' }, live('2026-10-17T23:00:00Z'));
  assert.deepEqual([r.lastSend.week, r.lastSend.drivers, r.lastSend.sent, r.lastSend.noPhone, r.lastSend.by], [WEEK, 2, 1, 1, ADMIN.email]);
  // Joe 11/7: a driver with no mobile phone is named as not texted too.
  assert.deepEqual(r.lastSend.notSent, ['BROOK, SAM (no mobile phone)']);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, new RegExp('/Accounts/' + SID + '/Messages\\.json$'));
  assert.equal(calls[0].init.headers.Authorization, 'Basic ' + Buffer.from(SID + ':tok').toString('base64'));
  assert.match(calls[0].init.body, /To=%2B13305551234&From=%2B13305550000&Body=United\+Dairy/);
  // Joe 11/6 (ik): each driver gets their own week, the way My Schedule reads.
  assert.equal(new URLSearchParams(calls[0].init.body).get('Body'), await SMS.weekText(db(), 'drv_test_casey', WEEK));
  assert.match(new URLSearchParams(calls[0].init.body).get('Body'), /^United Dairy schedule for Lee Casey\nWeek of 10-18-26 to 10-24-26\n\nSUNDAY 10-18-26\n/);
  const logs = (await db().collection('textLog').get()).docs.map(x => x.data()).filter(x => x.week === WEEK);
  assert.deepEqual(logs.map(x => x.name + ' ' + x.status).sort(), ['BROOK, SAM NO PHONE', 'CASEY, LEE SENT']);
  await assert.rejects(SMS.smsCall(db(), ADMIN, { op: 'sendSchedule' }, live('2026-10-17T23:05:00Z')), /already sent\. Press Send again/);
  assert.equal(calls.length, 1, 'never twice by accident');
  await assert.rejects(SMS.smsCall(db(), DISPATCHER, { op: 'sendSchedule', again: true }, live('2026-10-17T23:06:00Z')), /Only an administrator/);
  r = await SMS.smsCall(db(), ADMIN, { op: 'sendSchedule', again: true }, live('2026-10-17T23:10:00Z'));
  assert.deepEqual([r.lastSend.sent, calls.length], [1, 2], 'Send again sends it a second time');
  assert.equal((await db().collection('textLog').get()).docs.filter(x => x.data().week === WEEK).length, 4, 'each send is kept in the list');
});

test('the test copy (no LIVE_TEXTS) never sends: the texts go to the log as not sent', async () => {
  await SMS.smsCall(db(), ADMIN, { op: 'save', accountSid: SID, authToken: 'tok', fromNumber: '3305550000' });
  await applyAction(db(), ADMIN, { action: 'setDriverPhone', requestId: 'req-phone-good-0003', driverId: 'drv_test_casey', phone: '3305551234' });
  await applyAction(db(), ADMIN, { action: 'setDriverText', requestId: 'req-text-sched-0003', driverId: 'drv_test_casey', kind: 'SCHEDULE', on: true });
  await post();
  const calls = [];
  const r = await SMS.smsCall(db(), ADMIN, { op: 'sendSchedule' }, { env: {}, fetch: async () => { calls.push(1); return { ok: true }; } });
  assert.deepEqual([r.lastSend.week, r.lastSend.live, r.lastSend.sent], [WEEK, false, 0]);
  assert.equal(calls.length, 0);
  const log = (await db().collection('textLog').get()).docs.map(x => x.data()).find(x => x.week === WEEK);
  assert.match(log.reason, /Test copy: not sent/);
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

// Joe 10/26: Load Done Texts. The drivers ticked Load Text on the Driver Roster get one text when the plant finishes their load, with its open pickups;
// its own switch, Off by default; the test copy writes the text to the log only.
test('Load Done Texts: only drivers ticked on the Roster, once per load, with the pickups, never a load done before', async () => {
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
  assert.deepEqual(list.drivers, [], 'nobody ticked yet');
  assert.match(list.sample, /^United Dairy: your load is done\. Route 801 UT DSD MILK, trailer T-901, 1,200 cases\. Pickups: 2 crates chocolate milk\.$/);
  // The tick on the Driver Roster (Joe 10/26), kept with the phone; the number stays.
  await applyAction(db(), ADMIN, { action: 'setDriverText', requestId: 'req-loadtext-on-0001', driverId: 'drv_test_casey', kind: 'LOAD', on: true });
  assert.equal((await db().collection('driverPhones').doc('drv_test_casey').get()).data().phone, '+13305551234');
  assert.deepEqual((await SMS.smsCall(db(), ADMIN, { op: 'doneList' }, { env: {} })).drivers, [{ driverId: 'drv_test_casey', name: 'CASEY, LEE', phone: '330-555-1234' }]);
  // Typing the phone again keeps the tick.
  await applyAction(db(), ADMIN, { action: 'setDriverPhone', requestId: 'req-phone-done-0002', driverId: 'drv_test_casey', phone: '330 555 1234' });
  assert.equal((await db().collection('driverPhones').doc('drv_test_casey').get()).data().loadText, true);
  await db().collection('driverPhones').doc('drv_test_casey').update({ loadTextAt: '2026-10-18T15:00:00.000Z' });
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
  // Un-ticking stops the texts; a dispatcher cannot tick (Driver Roster rights).
  await applyAction(db(), ADMIN, { action: 'setDriverText', requestId: 'req-loadtext-off-0001', driverId: 'drv_test_casey', kind: 'LOAD', on: false });
  await run.set({ days: { mon: { completeTime: '2026-10-18T17:55:00.000Z' } } }, { merge: true });
  await db().collection('textLog').doc('done_2026-10-18_' + WEEK + '__run_t905_mon').delete();
  assert.equal(await SMS.loadDoneCheck(db(), at('2026-10-18T18:02:00Z')), null, 'not ticked: no text');
  await assert.rejects(applyAction(db(), ADMIN, { action: 'setDriverText', requestId: 'req-loadtext-bad-0001', driverId: 'drv_nobody', kind: 'LOAD', on: true }), /not in Driver Master/);
});

test('Load Done Texts: on the live app it sends through Twilio, and a load with no pickups says so', async () => {
  const sent = [];
  const fakeFetch = async (url, init) => { sent.push({ url, body: String(init.body) }); return { ok: true, json: async () => ({}) }; };
  await db().collection('runs').doc(WEEK + '__run_t905').set({ days: { mon: { runs: true, driverId: 'drv_test_casey', driver: 'CASEY, LEE', trailer: '901', casesOut: 40 } } }, { merge: true });
  await db().collection('driverPhones').doc('drv_test_casey').set({ driverId: 'drv_test_casey', phone: '+13305551234', loadText: true, loadTextAt: '2026-10-18T15:00:00.000Z' });
  await SMS.smsCall(db(), ADMIN, { op: 'save', accountSid: SID, authToken: 'secret-token', fromNumber: '330-555-0000' }, { env: {} });
  await SMS.smsCall(db(), ADMIN, { op: 'setDoneOn', on: true }, { now: () => new Date('2026-10-18T15:00:00Z') });
  await db().collection('runs').doc(WEEK + '__run_t905').set({ days: { mon: { completeTime: '2026-10-18T17:50:00.000Z' } } }, { merge: true });
  const r = await SMS.loadDoneCheck(db(), { now: () => new Date('2026-10-18T18:00:00Z'), env: { LIVE_TEXTS: '1' }, fetch: fakeFetch });
  assert.deepEqual([r.sent, r.failed], [1, 0]);
  assert.equal(sent.length, 1);
  const p = new URLSearchParams(sent[0].body);
  assert.deepEqual([p.get('To'), p.get('From'), p.get('Body')], ['+13305551234', '+13305550000', 'United Dairy: your load is done. Route 905 UT DSD MILK, trailer T-901, 40 cases. No pickups.']);
});

test('Texts: a test text goes to the one number typed, even with every switch Off', async () => {
  const sent = [];
  const fakeFetch = async (url, init) => { sent.push(String(init.body)); return { ok: true, json: async () => ({}) }; };
  await assert.rejects(SMS.smsCall(db(), ADMIN, { op: 'test', phone: '330-555-9999' }), /Save the Twilio account/);
  await SMS.smsCall(db(), ADMIN, { op: 'save', accountSid: SID, authToken: 'secret-token', fromNumber: '330-555-0000' }, { env: {} });
  await assert.rejects(SMS.smsCall(db(), DISPATCHER, { op: 'test', phone: '330-555-9999' }), /Only an administrator/);
  await assert.rejects(SMS.smsCall(db(), ADMIN, { op: 'test', phone: '555-9999' }), /10 digits/);
  // The test copy: written to the log only.
  let r = await SMS.smsCall(db(), ADMIN, { op: 'test', phone: '330-555-9999' }, { env: {}, fetch: fakeFetch });
  assert.deepEqual([r.doneOn, r.test.status, sent.length], [false, 'NOT SENT', 0]);
  // The live app: one text, to that number only.
  r = await SMS.smsCall(db(), ADMIN, { op: 'test', phone: '330-555-9999' }, { env: { LIVE_TEXTS: '1' }, fetch: fakeFetch, now: () => new Date('2026-10-18T18:00:00Z') });
  assert.equal(r.test.status, 'SENT');
  assert.equal(sent.length, 1);
  assert.equal(new URLSearchParams(sent[0]).get('To'), '+13305559999');
  assert.equal(new URLSearchParams(sent[0]).get('Body'), SMS.TEST_TEXT);
  const logs = (await db().collection('textLog').get()).docs.map(x => x.data()).filter(x => x.name === 'Test text');
  assert.equal(logs.length, 2);
});

test('Load Done Texts: a driver who replied STOP is unticked and marked, and is not texted again', async () => {
  const refuse = async () => ({ ok: false, status: 400, json: async () => ({ code: 21610, message: 'Attempt to send to unsubscribed recipient' }) });
  await db().collection('runs').doc(WEEK + '__run_t905').set({ days: { mon: { runs: true, driverId: 'drv_test_casey', driver: 'CASEY, LEE', trailer: '901', casesOut: 40, completeTime: '2026-10-18T17:50:00.000Z' } } }, { merge: true });
  await db().collection('driverPhones').doc('drv_test_casey').set({ driverId: 'drv_test_casey', phone: '+13305551234', loadText: true, loadTextAt: '2026-10-18T15:00:00.000Z' });
  await SMS.smsCall(db(), ADMIN, { op: 'save', accountSid: SID, authToken: 'secret-token', fromNumber: '330-555-0000' }, { env: {} });
  await SMS.smsCall(db(), ADMIN, { op: 'setDoneOn', on: true }, { now: () => new Date('2026-10-18T15:00:00Z') });
  const r = await SMS.loadDoneCheck(db(), { now: () => new Date('2026-10-18T18:00:00Z'), env: { LIVE_TEXTS: '1' }, fetch: refuse });
  assert.equal(r.failed, 1);
  const p = (await db().collection('driverPhones').doc('drv_test_casey').get()).data();
  assert.deepEqual([p.loadText, p.stoppedAt, p.phone], [false, '2026-10-18T18:00:00.000Z', '+13305551234']);
  assert.equal((await db().collection('textLog').doc('done_2026-10-18_' + WEEK + '__run_t905_mon').get()).data().status, 'STOPPED');
});

test('Texts: Ask drivers texts the ones not ticked; a YES reply ticks Schedule and Load, STOP unticks both', async () => {
  const sent = [];
  let inbox = [];
  const fakeFetch = async (url, init) => {
    if (init && init.method === 'POST') { sent.push(new URLSearchParams(String(init.body)).get('To')); return { ok: true, json: async () => ({}) }; }
    return { ok: true, json: async () => ({ messages: inbox }) };
  };
  const live = (t) => ({ env: { LIVE_TEXTS: '1' }, fetch: fakeFetch, now: () => new Date(t) });
  await SMS.smsCall(db(), ADMIN, { op: 'save', accountSid: SID, authToken: 'secret-token', fromNumber: '330-555-0000' }, { env: {} });
  await db().collection('driverPhones').doc('drv_test_casey').set({ driverId: 'drv_test_casey', phone: '+13305551234' });
  await db().collection('driverPhones').doc('drv_test_adams').set({ driverId: 'drv_test_adams', phone: '+13305552222', scheduleText: true, loadText: true });
  assert.equal(await SMS.replyCheck(db(), live('2026-10-18T14:00:00Z')), null, 'nothing to read before anyone was asked');
  const r = await SMS.smsCall(db(), ADMIN, { op: 'doneAsk' }, live('2026-10-18T14:00:00Z'));
  assert.deepEqual(sent, ['+13305551234'], 'only the driver with a phone who is not ticked for both');
  assert.equal(r.asked.sent, 1);
  inbox = [
    { sid: 'SM1', direction: 'inbound', from: '+13305551234', body: 'Yes', date_created: 'Sun, 18 Oct 2026 14:05:00 +0000' },
    { sid: 'SM2', direction: 'inbound', from: '+13305552222', body: 'STOP', date_created: 'Sun, 18 Oct 2026 14:06:00 +0000' },
    { sid: 'SM0', direction: 'inbound', from: '+13305551234', body: 'STOP', date_created: 'Sun, 18 Oct 2026 13:00:00 +0000' },
    { sid: 'SM3', direction: 'inbound', from: '+17245559999', body: 'YES', date_created: 'Sun, 18 Oct 2026 14:07:00 +0000' }];
  assert.deepEqual(await SMS.replyCheck(db(), live('2026-10-18T14:10:00Z')), { yes: 1, stop: 1, forwarded: 0 });
  const casey = (await db().collection('driverPhones').doc('drv_test_casey').get()).data(), adams = (await db().collection('driverPhones').doc('drv_test_adams').get()).data();
  assert.deepEqual([casey.scheduleText, casey.loadText, casey.loadTextAt, casey.phone], [true, true, '2026-10-18T14:05:00.000Z', '+13305551234']);
  assert.deepEqual([adams.scheduleText, adams.loadText, adams.stoppedAt], [false, false, '2026-10-18T14:06:00.000Z']);
  assert.deepEqual(await SMS.replyCheck(db(), live('2026-10-18T14:11:00Z')), { yes: 0, stop: 0, forwarded: 0 }, 'each reply counts once');
  // The test copy never reads Twilio.
  assert.equal(await SMS.replyCheck(db(), { env: {}, fetch: fakeFetch }), null);
});

test('Texts: driver replies are texted on to the phone saved under Driver replies, once each, drivers only', async () => {
  const sent = [];
  let inbox = [];
  const fakeFetch = async (url, init) => {
    if (init && init.method === 'POST') { const p = new URLSearchParams(String(init.body)); sent.push([p.get('To'), p.get('Body')]); return { ok: true, json: async () => ({}) }; }
    return { ok: true, json: async () => ({ messages: inbox }) };
  };
  const live = (t) => ({ env: { LIVE_TEXTS: '1' }, fetch: fakeFetch, now: () => new Date(t) });
  await SMS.smsCall(db(), ADMIN, { op: 'save', accountSid: SID, authToken: 'secret-token', fromNumber: '330-555-0000' }, { env: {} });
  await db().collection('driverPhones').doc('drv_test_casey').set({ driverId: 'drv_test_casey', phone: '+13305551234', scheduleText: true });
  assert.equal(await SMS.replyCheck(db(), live('2026-10-18T14:00:00Z')), null, 'nothing to read before a phone is saved');
  await assert.rejects(SMS.smsCall(db(), DISPATCHER, { op: 'setForward', phone: '330-555-7777' }), /Only an administrator/);
  await assert.rejects(SMS.smsCall(db(), ADMIN, { op: 'setForward', phone: '555-7777' }), /10 digits/);
  let r = await SMS.smsCall(db(), ADMIN, { op: 'setForward', phone: '330-555-7777' }, live('2026-10-18T14:00:00Z'));
  assert.deepEqual([r.forwardTo, r.forwardSince], ['330-555-7777', '2026-10-18T14:00:00.000Z']);
  inbox = [
    { sid: 'SM0', direction: 'inbound', from: '+13305551234', body: 'Before it was saved', date_created: 'Sun, 18 Oct 2026 13:59:00 +0000' },
    { sid: 'SM1', direction: 'inbound', from: '+13305551234', body: 'No problem, see you Monday', date_created: 'Sun, 18 Oct 2026 14:05:00 +0000' },
    { sid: 'SM2', direction: 'inbound', from: '+17245559999', body: 'Is the job still open?', date_created: 'Sun, 18 Oct 2026 14:06:00 +0000' },
    { sid: 'SM3', direction: 'outbound-api', from: '+13305550000', body: 'United Dairy: your schedule', date_created: 'Sun, 18 Oct 2026 14:06:30 +0000' }];
  assert.deepEqual(await SMS.replyCheck(db(), live('2026-10-18T14:10:00Z')), { yes: 0, stop: 0, forwarded: 1 });
  assert.deepEqual(sent, [['+13305557777', 'United Dairy: reply from Lee Casey (330-555-1234): No problem, see you Monday']], 'only the driver\'s reply after the phone was saved; not the other app\'s texts');
  const casey = (await db().collection('driverPhones').doc('drv_test_casey').get()).data();
  assert.deepEqual([casey.scheduleText, casey.stoppedAt], [true, undefined], '"No problem" does not untick him');
  const log = (await db().collection('textLog').doc('doneReply_SM1').get()).data();
  assert.deepEqual([log.kind, log.direction, log.status, log.forwardStatus, log.forwardTo], ['REPLY', 'in', 'RECEIVED', 'SENT', '+13305557777']);
  assert.deepEqual(await SMS.replyCheck(db(), live('2026-10-18T14:11:00Z')), { yes: 0, stop: 0, forwarded: 0 }, 'each reply is sent on once');
  // A STOP still unticks, and is sent on too.
  inbox.push({ sid: 'SM4', direction: 'inbound', from: '+13305551234', body: 'STOP', date_created: 'Sun, 18 Oct 2026 14:12:00 +0000' });
  assert.deepEqual(await SMS.replyCheck(db(), live('2026-10-18T14:13:00Z')), { yes: 0, stop: 1, forwarded: 1 });
  assert.equal((await db().collection('driverPhones').doc('drv_test_casey').get()).data().scheduleText, false);
  // Blank turns it off.
  r = await SMS.smsCall(db(), ADMIN, { op: 'setForward', phone: '' }, live('2026-10-18T14:14:00Z'));
  assert.deepEqual([r.forwardTo, r.forwardSince], ['', '']);
  assert.equal(await SMS.replyCheck(db(), live('2026-10-18T14:15:00Z')), null);
});

test('Joe 11/6 (ik): the schedule text is the driver\'s own week, read like My Schedule with the notes; a sample goes only to the part 5 cell', async () => {
  const sent = [], fetch = async (url, init) => { sent.push(String(init.body)); return { ok: true, status: 201, json: async () => ({}) }; };
  const live = { env: { LIVE_TEXTS: '1' }, fetch, now: () => new Date('2026-10-17T23:00:00Z') };
  await post();
  await db().collection('exceptions').doc('ex_casey_thu').set({ driverId: 'drv_test_casey', startDate: L.addDays(WEEK, 4), endDate: L.addDays(WEEK, 4), type: 'VACATION', status: 'APPROVED' });
  await applyAction(db(), ADMIN, { action: 'saveDriverException', requestId: 'req-daynote-casey-sat', driverId: 'drv_test_casey', startDate: L.addDays(WEEK, 6), endDate: L.addDays(WEEK, 6), status: 'DAYNOTE', note: 'Riding with Brook' });
  await db().collection('runs').doc(WEEK + '__run_t905').set({ days: { mon: { truck: '512', trailer: '901' } } }, { merge: true });
  // The list to pick from, then one driver's week: a block a day, Sunday to Saturday, as My Schedule shows it.
  let r = await SMS.smsCall(db(), ADMIN, { op: 'sample' });
  assert.ok(r.sampleDrivers.some(x => x.driverId === 'drv_test_casey' && x.name === 'CASEY, LEE'));
  assert.equal(r.sample, undefined);
  r = await SMS.smsCall(db(), ADMIN, { op: 'sample', driverId: 'drv_test_casey' });
  const blocks = r.sample.text.split('\n\n');
  assert.equal(blocks[0], 'United Dairy schedule for Lee Casey\nWeek of 10-18-26 to 10-24-26');
  assert.equal(blocks.length, 9, r.sample.text);
  assert.deepEqual(blocks.slice(1, 8).map(b => b.split('\n')[0]), ['SUNDAY 10-18-26', 'MONDAY 10-19-26', 'TUESDAY 10-20-26', 'WEDNESDAY 10-21-26', 'THURSDAY 10-22-26', 'FRIDAY 10-23-26', 'SATURDAY 10-24-26']);
  assert.match(blocks[2], /^MONDAY 10-19-26\n905 UT DSD MILK\nTruck 512 · Trailer 901( · Leaves \d+:\d\d [AP]M)?$/);
  assert.equal(blocks[5], 'THURSDAY 10-22-26\nOff: Vacation');
  assert.equal(blocks[7], 'SATURDAY 10-24-26\nRiding with Brook', 'the Day Note, as My Schedule shows it');
  assert.equal(blocks[8], 'Also on UD Routes > My Schedule.');
  assert.equal(r.sample.text, await SMS.weekText(db(), 'drv_test_casey', WEEK));
  // Needs the account and the part 5 cell; only administrators.
  await assert.rejects(SMS.smsCall(db(), ADMIN, { op: 'sendSample', driverId: 'drv_test_casey' }, live), /Save the Twilio account/);
  await SMS.smsCall(db(), ADMIN, { op: 'save', accountSid: SID, authToken: 'tok', fromNumber: '3305550000' });
  await assert.rejects(SMS.smsCall(db(), ADMIN, { op: 'sendSample', driverId: 'drv_test_casey' }, live), /part 5/);
  await SMS.smsCall(db(), ADMIN, { op: 'setForward', phone: '330-555-7777' });
  await assert.rejects(SMS.smsCall(db(), DISPATCHER, { op: 'sendSample', driverId: 'drv_test_casey' }, live), /Only an administrator/);
  await assert.rejects(SMS.smsCall(db(), ADMIN, { op: 'sendSample', driverId: 'drv_nobody' }, live), /not on the Driver Roster/);
  r = await SMS.smsCall(db(), ADMIN, { op: 'sendSample', driverId: 'drv_test_casey', phone: '330-555-1234' }, live);
  assert.deepEqual([r.sampleSend.to, r.sampleSend.status, sent.length], ['330-555-7777', 'SENT', 1]);
  const body = new URLSearchParams(sent[0]);
  assert.deepEqual([body.get('To'), body.get('Body')], ['+13305557777', r.sample.text], 'only the part 5 cell, never a typed or driver number');
  // Nothing was sent to a driver.
  assert.equal((await db().collection('private').doc('sms').get()).data().lastSend, undefined);
  assert.match((await SMS.smsCall(db(), ADMIN, { op: 'preview' })).message, /Each driver gets their own posted week/);
  // The test copy only writes it to the list.
  r = await SMS.smsCall(db(), ADMIN, { op: 'sendSample', driverId: 'drv_test_casey' }, { env: {}, fetch });
  assert.deepEqual([r.sampleSend.status, sent.length], ['NOT SENT', 1]);
  const logs = (await db().collection('textLog').get()).docs.map(x => x.data()).filter(x => x.kind === 'SAMPLE');
  assert.deepEqual(logs.map(x => x.name + ' ' + x.status).sort(), ['Sample: CASEY, LEE NOT SENT', 'Sample: CASEY, LEE SENT']);
});

test('Joe 11/2: a wrong number fixed on the Driver Roster, then Resend texts only that driver, at the new number', async () => {
  await SMS.smsCall(db(), ADMIN, { op: 'save', accountSid: SID, authToken: 'tok', fromNumber: '3305550000' });
  await applyAction(db(), ADMIN, { action: 'setDriverPhone', requestId: 'req-phone-resend-0001', driverId: 'drv_test_casey', phone: '3305559999' });
  await applyAction(db(), ADMIN, { action: 'setDriverPhone', requestId: 'req-phone-resend-0002', driverId: 'drv_test_brook', phone: '3305558888' });
  for (const id of ['drv_test_casey', 'drv_test_brook']) await applyAction(db(), ADMIN, { action: 'setDriverText', requestId: 'req-text-resend-' + id, driverId: id, kind: 'SCHEDULE', on: true });
  const calls = [], fetch = async (url, init) => { calls.push(new URLSearchParams(String(init.body))); return { ok: true, status: 201, json: async () => ({}) }; };
  const live = (t) => ({ env: { LIVE_TEXTS: '1' }, fetch, now: () => new Date(t) });
  await post();
  await SMS.smsCall(db(), ADMIN, { op: 'sendSchedule' }, live('2026-10-17T23:00:00Z'));
  assert.equal(calls.length, 2);
  const caseyLog = (await db().collection('textLog').get()).docs.find(x => x.data().driverId === 'drv_test_casey');
  // The number was wrong: fixed on the Driver Roster, then Resend on Casey's text.
  await applyAction(db(), ADMIN, { action: 'setDriverPhone', requestId: 'req-phone-resend-0003', driverId: 'drv_test_casey', phone: '3305551234' });
  await assert.rejects(SMS.smsCall(db(), DISPATCHER, { op: 'resend', logId: caseyLog.id }, live('2026-10-17T23:20:00Z')), /Only an administrator/);
  const r = await SMS.smsCall(db(), ADMIN, { op: 'resend', logId: caseyLog.id }, live('2026-10-17T23:20:00Z'));
  assert.deepEqual(r.resend, { name: 'CASEY, LEE', to: '330-555-1234', status: 'SENT', reason: '' });
  assert.equal(calls.length, 3, 'one more text, to one driver');
  assert.deepEqual([calls[2].get('To'), calls[2].get('Body')], ['+13305551234', await SMS.weekText(db(), 'drv_test_casey', WEEK)]);
  const again = (await db().collection('textLog').get()).docs.map(x => Object.assign({ id: x.id }, x.data())).find(x => x.kind === 'RESEND');
  assert.deepEqual([again.week, again.driverId, again.to, again.status, again.by], [WEEK, 'drv_test_casey', '+13305551234', 'SENT', ADMIN.email]);
  assert.equal((await SMS.smsCall(db(), ADMIN, { op: 'status' })).lastSend.drivers, 2, 'the week\'s Send record is left alone');
  // A resent text can be resent again.
  await SMS.smsCall(db(), ADMIN, { op: 'resend', logId: again.id }, live('2026-10-17T23:25:00Z'));
  assert.equal(calls.length, 4);
  // Not a schedule text, an old week, an unticked driver, or no such row: refused, nothing sent.
  await SMS.smsCall(db(), ADMIN, { op: 'test', phone: '3305557777' }, live('2026-10-17T23:30:00Z'));
  const testLog = (await db().collection('textLog').get()).docs.find(x => x.data().kind === 'TEST');
  await assert.rejects(SMS.smsCall(db(), ADMIN, { op: 'resend', logId: testLog.id }, live('2026-10-17T23:31:00Z')), /Only a schedule text/);
  await assert.rejects(SMS.smsCall(db(), ADMIN, { op: 'resend', logId: 'nope' }, live('2026-10-17T23:31:00Z')), /Only a schedule text/);
  await applyAction(db(), ADMIN, { action: 'setDriverText', requestId: 'req-text-resend-off', driverId: 'drv_test_casey', kind: 'SCHEDULE', on: false });
  await assert.rejects(SMS.smsCall(db(), ADMIN, { op: 'resend', logId: caseyLog.id }, live('2026-10-17T23:32:00Z')), /CASEY, LEE is not ticked for schedule texts/);
  await db().collection('config').doc('app').set({ liveWeeks: { current: L.addDays(WEEK, 7) } }, { merge: true });
  await assert.rejects(SMS.smsCall(db(), ADMIN, { op: 'resend', logId: caseyLog.id }, live('2026-10-17T23:33:00Z')), /Only the posted week/);
  assert.equal(calls.length, 5, 'only the test text went out');
});

test('Joe 11/2: on the test copy Resend only writes the text to the list', async () => {
  await SMS.smsCall(db(), ADMIN, { op: 'save', accountSid: SID, authToken: 'tok', fromNumber: '3305550000' });
  await applyAction(db(), ADMIN, { action: 'setDriverPhone', requestId: 'req-phone-resend-0004', driverId: 'drv_test_casey', phone: '3305551234' });
  await applyAction(db(), ADMIN, { action: 'setDriverText', requestId: 'req-text-resend-0004', driverId: 'drv_test_casey', kind: 'SCHEDULE', on: true });
  await post();
  const calls = [], opts = { env: {}, fetch: async () => { calls.push(1); return { ok: true }; } };
  await SMS.smsCall(db(), ADMIN, { op: 'sendSchedule' }, opts);
  const first = (await db().collection('textLog').get()).docs.find(x => x.data().driverId === 'drv_test_casey');
  const r = await SMS.smsCall(db(), ADMIN, { op: 'resend', logId: first.id }, Object.assign({ now: () => new Date('2026-10-18T12:00:00Z') }, opts));
  assert.equal(r.resend.status, 'NOT SENT');
  assert.equal(calls.length, 0);
});

test('Joe 11/7: drivers Send will not reach whose posted week is not their normal week are listed to text by hand', async () => {
  await post();
  let p = await SMS.smsCall(db(), ADMIN, { op: 'preview' });
  // Casey normally runs 802 Mon and Tue, this week 905 Monday; Brook (no normal week) is on 836 Tuesday; Adams normally runs
  // 801 Mon and Tue and is not on the week. None is signed up.
  assert.deepEqual(p.byHand.map(x => [x.name, x.why, x.days.join(' ')]), [['ADAMS, PAT', 'Not signed up', 'Mon Tue'], ['BROOK, SAM', 'Not signed up', 'Tue'], ['CASEY, LEE', 'Not signed up', 'Mon Tue']]);
  // Adams's week back to normal: off the list. Casey signed up with a phone: Send reaches him, off the list.
  await db().collection('runs').doc(WEEK + '__run_t801').set({ weekStart: WEEK, route: '801', run: 'UT DSD MILK', runId: 'run_t801', rev: 0, days: { mon: { runs: true, driverId: 'drv_test_adams', driver: 'ADAMS, PAT' }, tue: { runs: true, driverId: 'drv_test_adams', driver: 'ADAMS, PAT' } } });
  await applyAction(db(), ADMIN, { action: 'setDriverPhone', requestId: 'req-phone-hand-0001', driverId: 'drv_test_casey', phone: '3305551234' });
  await applyAction(db(), ADMIN, { action: 'setDriverText', requestId: 'req-text-hand-0001', driverId: 'drv_test_casey', kind: 'SCHEDULE', on: true });
  p = await SMS.smsCall(db(), ADMIN, { op: 'preview' });
  assert.deepEqual(p.byHand.map(x => x.name), ['BROOK, SAM']);
  // Signed up with no phone, or a Day Note on a normal day, still needs a hand text.
  await applyAction(db(), ADMIN, { action: 'setDriverText', requestId: 'req-text-hand-0002', driverId: 'drv_test_adams', kind: 'SCHEDULE', on: true });
  await applyAction(db(), ADMIN, { action: 'saveDriverException', requestId: 'req-daynote-hand-0001', driverId: 'drv_test_adams', startDate: L.addDays(WEEK, 1), endDate: L.addDays(WEEK, 1), status: 'DAYNOTE', note: 'Start at 2' });
  p = await SMS.smsCall(db(), ADMIN, { op: 'preview' });
  assert.deepEqual(p.byHand.map(x => [x.name, x.why, x.days.join(' ')]), [['ADAMS, PAT', 'No mobile phone', 'Mon'], ['BROOK, SAM', 'Not signed up', 'Tue']]);
});

test('Joe 11/7: one driver whose text cannot be made no longer stops Send; the others are texted, he is named, and a send that stopped never texts anyone twice', async () => {
  const P = require('../../src/phone'), was = P.scheduleDays;
  await SMS.smsCall(db(), ADMIN, { op: 'save', accountSid: SID, authToken: 'tok', fromNumber: '3305550000' });
  await applyAction(db(), ADMIN, { action: 'setDriverPhone', requestId: 'req-phone-stop-0001', driverId: 'drv_test_casey', phone: '3305551234' });
  await applyAction(db(), ADMIN, { action: 'setDriverPhone', requestId: 'req-phone-stop-0002', driverId: 'drv_test_brook', phone: '3305554321' });
  for (const id of ['drv_test_casey', 'drv_test_brook']) await applyAction(db(), ADMIN, { action: 'setDriverText', requestId: 'req-text-stop-' + id, driverId: id, kind: 'SCHEDULE', on: true });
  const calls = [], fetch = async (url, init) => { calls.push(new URLSearchParams(init.body).get('To')); return { ok: true, status: 201, json: async () => ({}) }; };
  const live = (t) => ({ env: { LIVE_TEXTS: '1' }, fetch, now: () => new Date(t) });
  await post();
  // A send that stopped part way had already texted Brook: the first Send skips him and texts Casey only.
  await db().collection('textLog').doc('stopped_brook').set({ direction: 'out', week: WEEK, driverId: 'drv_test_brook', name: 'BROOK, SAM', to: '+13305554321', body: 'x', at: '2026-10-17T22:00:00.000Z', status: 'SENT' });
  let r = await SMS.smsCall(db(), ADMIN, { op: 'sendSchedule' }, live('2026-10-17T23:00:00Z'));
  assert.deepEqual([r.lastSend.sent, r.lastSend.already, r.lastSend.failed, calls], [1, 1, 0, ['+13305551234']]);
  // Casey's text cannot be made: Brook is still texted, Casey is written to the list as not texted, with why, and named.
  await db().collection('textLog').doc('stopped_brook').delete();
  P.scheduleDays = (driver, ...rest) => { if (driver.id === 'drv_test_casey') throw new Error('broken day'); return was(driver, ...rest); };
  try { r = await SMS.smsCall(db(), ADMIN, { op: 'sendSchedule', again: true }, live('2026-10-17T23:10:00Z')); } finally { P.scheduleDays = was; }
  assert.deepEqual([r.lastSend.week, r.lastSend.sent, r.lastSend.failed, r.lastSend.notSent, calls.slice(1)], [WEEK, 1, 1, ['CASEY, LEE'], ['+13305554321']]);
  const bad = (await db().collection('textLog').get()).docs.map(x => Object.assign({ id: x.id }, x.data())).find(x => x.driverId === 'drv_test_casey' && x.status === 'FAILED');
  assert.match(bad.reason, /^Could not make this driver's text: broken day/);
  // Resend on his line texts only him.
  r = await SMS.smsCall(db(), ADMIN, { op: 'resend', logId: bad.id }, live('2026-10-17T23:20:00Z'));
  assert.deepEqual(calls.slice(2), ['+13305551234']);
});

test('Joe 11/9: a truck, trailer or route changed after the schedule text went out is listed with what changed; Send Updated Schedule texts only that driver', async () => {
  await SMS.smsCall(db(), ADMIN, { op: 'save', accountSid: SID, authToken: 'tok', fromNumber: '3305550000' });
  await applyAction(db(), ADMIN, { action: 'setDriverPhone', requestId: 'req-phone-changed-0001', driverId: 'drv_test_casey', phone: '3305551234' });
  await applyAction(db(), ADMIN, { action: 'setDriverPhone', requestId: 'req-phone-changed-0002', driverId: 'drv_test_brook', phone: '3305558888' });
  for (const id of ['drv_test_casey', 'drv_test_brook']) await applyAction(db(), ADMIN, { action: 'setDriverText', requestId: 'req-text-changed-' + id, driverId: id, kind: 'SCHEDULE', on: true });
  await db().collection('runs').doc(WEEK + '__run_t905').set({ days: { mon: { truck: '512', trailer: '901' } } }, { merge: true });
  const calls = [], fetch = async (url, init) => { calls.push(new URLSearchParams(String(init.body))); return { ok: true, status: 201, json: async () => ({}) }; };
  const live = (t) => ({ env: { LIVE_TEXTS: '1' }, fetch, now: () => new Date(t) });
  await post();
  // Before any text, and right after the send: nothing to warn about.
  assert.deepEqual((await SMS.smsCall(db(), ADMIN, { op: 'preview' }, live('2026-10-17T22:00:00Z'))).changed, []);
  await SMS.smsCall(db(), ADMIN, { op: 'sendSchedule' }, live('2026-10-17T23:00:00Z'));
  assert.equal(calls.length, 2);
  assert.deepEqual((await SMS.smsCall(db(), ADMIN, { op: 'preview' }, live('2026-10-17T23:01:00Z'))).changed, []);
  // Dispatch swaps Casey's truck on Monday: Casey is listed, Brook is not, and nothing is texted by itself.
  await db().collection('runs').doc(WEEK + '__run_t905').set({ days: { mon: { truck: '518' } } }, { merge: true });
  let p = await SMS.smsCall(db(), ADMIN, { op: 'preview' }, live('2026-10-17T23:05:00Z'));
  assert.deepEqual(p.changed.map(x => [x.name, x.changes]), [['CASEY, LEE', ['MONDAY: TRUCK 512 IS NOW 518']]]);
  assert.equal(calls.length, 2, 'the warning never texts');
  // Then Brook's route moves from Tuesday to Wednesday: Brook is listed too.
  await db().collection('runs').doc(WEEK + '__run_t836').set({ days: { tue: { runs: false, driverId: '', driver: '' }, wed: { runs: true, driverId: 'drv_test_brook', driver: 'BROOK' } } }, { merge: true });
  p = await SMS.smsCall(db(), ADMIN, { op: 'preview' }, live('2026-10-17T23:06:00Z'));
  const brook = p.changed.find(x => x.driverId === 'drv_test_brook');
  assert.ok(brook && brook.changes.some(c => /^TUESDAY: 836 PECK TAKEN OFF|^TUESDAY: WAS 836 PECK/.test(c)) && brook.changes.some(c => /^WEDNESDAY: .*836 PECK/.test(c)), JSON.stringify(brook));
  // Send Updated Schedule on Casey: one text, to Casey, with the new truck; Casey drops off, Brook stays.
  const casey = p.changed.find(x => x.driverId === 'drv_test_casey');
  const r = await SMS.smsCall(db(), ADMIN, { op: 'resend', logId: casey.logId }, live('2026-10-17T23:10:00Z'));
  assert.equal(r.resend.status, 'SENT');
  assert.equal(calls.length, 3);
  assert.equal(calls[2].get('To'), '+13305551234');
  assert.match(calls[2].get('Body'), /Truck 518/);
  p = await SMS.smsCall(db(), ADMIN, { op: 'preview' }, live('2026-10-17T23:11:00Z'));
  assert.deepEqual(p.changed.map(x => x.name), ['BROOK, SAM']);
});
