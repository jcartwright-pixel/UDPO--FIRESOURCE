'use strict';
// Administration's email, schedule and diagnostics items (src/admintools.js): Repair Email, Driver Check-In Email, Refresh
// Rates and Archive now, Pre-Flight, Update Live Sheets, Start Plant Fresh, Date Inventory and Date Convert.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const A = require('../../src/admin');
const T = require('../../src/admintools');
const L = require('../../src/logic');
const F = require('../fixtures/fake-sheets');

const ADMIN = { email: 'admin.test@uniteddairy.com' };
const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
const RUN = '2026-10-04__run_t801';
const tick = () => new Date('2026-10-09T12:00:00Z');
let n = 0;
const rid = () => 'tools-' + (++n) + '-' + Date.now();
const call = (input, deps) => A.adminCall(db(), ADMIN, input, Object.assign({ now: tick }, deps || {}));
const mailDeps = (sent) => ({ env: { MAIL_FROM: 'joe@uniteddairy.com' }, sendMail: async (m) => { sent.push(m); return { to: m.to }; } });
const records = async () => (await db().collection('maintenance').get()).docs.map(d => d.data());

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: tick });
  // The Fleet List's Lease, as the fleet sync keeps it in Equipment Master notes.
  await db().collection('equipment').doc('veh_truck_900001').set({ notes: 'Lease: PENSKE' }, { merge: true });
});

test('Repair Email: settings are checked; Immediately sends new repairs to the lessor (a test copy to the presser) and notes it; an unknown unit is held', async () => {
  await assert.rejects(call({ op: 'saveRepairEmail', routes: { PENSKE: { emails: '', mode: 'IMMEDIATE' } } }), /needs an email address/);
  await assert.rejects(call({ op: 'saveRepairEmail', routes: { PENSKE: { emails: 'not-an-email', mode: 'SEND' } } }), /not an email address/);
  const saved = await call({ op: 'saveRepairEmail', routes: { PENSKE: { emails: 'repairs@penske.com; Repairs@penske.com', mode: 'IMMEDIATE' } }, digestHour: 6 });
  assert.deepEqual(saved.settings.routes.PENSKE.emails, ['repairs@penske.com']);
  assert.ok(saved.settings.routes.PENSKE.since);
  assert.equal(saved.settings.routes.OWNED.mode, 'NONE');
  // Repairs reported before the switch-on are never swept up: this one is reported after.
  await applyAction(db(), DISPATCHER, { action: 'saveCheckIn', requestId: rid(), runDocId: RUN, day: 'mon', tractorIssues: 'Air leak' }, () => new Date(Date.now() + 60000));
  const sent = [];
  const out = await T.repairSweep(db(), { force: true, by: ADMIN.email, mailDeps: mailDeps(sent) });
  assert.match(out.message, /Sent 1 repair/);
  assert.deepEqual(sent[0].to, [ADMIN.email], 'the sandbox sends only to the person who pressed Send now');
  assert.match(sent[0].subject, /United Dairy Truck Repair Request - 900001/);
  const truck = (await records()).find(r => r.kind === 'TRUCK');
  assert.match(truck.notes, /Repair email sent .* to repairs@penske.com \(automatic\); test copy to admin.test@uniteddairy.com/);
  // Once sent, never again.
  assert.match((await T.repairSweep(db(), { force: true, by: ADMIN.email, mailDeps: mailDeps(sent) })).message, /Sent 0 repairs/);
  const log = await call({ op: 'sentLog' });
  assert.equal(log.emails[0].status, 'SENT');
  // A unit the Fleet List cannot place is held, not guessed.
  assert.equal(T.lessorOf([{ type: 'TRUCK', unit: '900001', notes: 'Lease: Ryder' }], 'TRUCK', '900001').held, 'LESSOR_NOT_SET_UP');
  assert.equal(T.lessorOf([], 'TRUCK', '555').held, 'UNIT_NOT_IN_FLEET_LIST');
  assert.equal(T.lessorOf([{ type: 'TRUCK', unit: '900001', notes: '' }], 'TRUCK', '900001').route, 'OWNED');
  // Joe 10/25: the fleet list's LEASE column (config/fleetOwnership) decides a truck's lessor; trailers stay ours.
  const own = { units: { 223876: { own: false, lease: 'Idealease', facilityId: 'fac_uniontown' }, 'T-77': { own: false, lease: 'First', facilityId: 'fac_uniontown' } } };
  assert.equal(T.lessorOf([{ type: 'TRUCK', unit: '223876', notes: 'External Fleet: 2023' }], 'TRUCK', '223876', own).route, 'IDEALEASE');
  assert.equal(T.lessorOf([{ type: 'TRAILER', unit: 'T-77', notes: '' }], 'TRAILER', 'T-77', own).route, 'OWNED');
});

test('Repair Email: the Lessor button emails after the save, and says why not when email is off for that lessor', async () => {
  await applyAction(db(), DISPATCHER, { action: 'saveCheckIn', requestId: rid(), runDocId: RUN, day: 'mon', tractorIssues: 'Brake light' });
  const truck = L.issueRows(await records(), 'TRUCK')[0];
  await call({ op: 'saveRepairEmail', routes: { PENSKE: { emails: '', mode: 'NONE' } } });
  const input = { action: 'updateIssue', requestId: rid(), recordId: truck.recordId, step: 'lessor', note: 'PENSKE' };
  const res = await T.afterSave(db(), DISPATCHER, input, await applyAction(db(), DISPATCHER, input), mailDeps([]));
  assert.match(res.message, /Email is turned off for Penske/);
  await call({ op: 'saveRepairEmail', routes: { PENSKE: { emails: 'repairs@penske.com', mode: 'SEND' } } });
  const sent = [];
  const again = await T.sendOneRepair(db(), truck.recordId, DISPATCHER.email, 'Please call', mailDeps(sent));
  assert.equal(again.status, 'SENT');
  assert.match(sent[0].text, /Manager note:\nPlease call/);
});

test('Email Senders: the Lessor email comes from the person who pressed it, or the plant address when set so (Joe 10/11)', async () => {
  await applyAction(db(), DISPATCHER, { action: 'saveCheckIn', requestId: rid(), runDocId: RUN, day: 'mon', tractorIssues: 'Mirror cracked' });
  const truck = L.issueRows(await records(), 'TRUCK')[0];
  await call({ op: 'saveRepairEmail', routes: { PENSKE: { emails: 'repairs@penske.com', mode: 'SEND' } } });
  await db().collection('users').doc(DISPATCHER.email).set({ name: 'Dee Spatch', status: 'ACTIVE', roles: ['DISPATCHER'] }, { merge: true });
  const sent = [];
  assert.equal((await T.sendOneRepair(db(), truck.recordId, DISPATCHER.email, '', mailDeps(sent))).status, 'SENT');
  assert.deepEqual([sent[0].from, sent[0].fromName], [DISPATCHER.email, 'Dee Spatch'], 'the standard: from the person who pressed it');
  assert.equal((await call({ op: 'sentLog' })).emails[0].from, DISPATCHER.email);
  await call({ op: 'saveEmailSenders', senders: { fac_uniontown: { address: 'Uniontown.Operations@uniteddairy.com', name: 'United Dairy Uniontown Operations' } }, fromWho: 'PLANT' });
  await T.sendOneRepair(db(), truck.recordId, DISPATCHER.email, '', mailDeps(sent));
  assert.deepEqual([sent[1].from, sent[1].fromName], ['uniontown.operations@uniteddairy.com', 'United Dairy Uniontown Operations']);
});

test('Email Senders: automatic repair emails (no one pressed Send) come from the plant address', async () => {
  await call({ op: 'saveEmailSenders', senders: { fac_uniontown: { address: 'uniontown.operations@uniteddairy.com', name: 'United Dairy Uniontown Operations' } } });
  await call({ op: 'saveRepairEmail', routes: { PENSKE: { emails: 'repairs@penske.com', mode: 'IMMEDIATE' } } });
  await applyAction(db(), DISPATCHER, { action: 'saveCheckIn', requestId: rid(), runDocId: RUN, day: 'mon', tractorIssues: 'Horn out' }, () => new Date(Date.now() + 60000));
  const auto = [];
  assert.match((await T.repairSweep(db(), { force: true, mailDeps: mailDeps(auto) })).message, /Sent 1 repair/);
  assert.equal(auto[0].from, 'uniontown.operations@uniteddairy.com');
});

test('Repair Email: the Lessor button follows the setting; Once a day puts an older write-up into that lessor\'s daily email (review item 32)', async () => {
  // Reported before Once a day was switched on, so only the Lessor button brings it in.
  await applyAction(db(), DISPATCHER, { action: 'saveCheckIn', requestId: rid(), runDocId: RUN, day: 'mon', tractorIssues: 'Oil leak' });
  await call({ op: 'saveRepairEmail', routes: { PENSKE: { emails: 'repairs@penske.com', mode: 'DAILY' } }, digestHour: 15 });
  const truck = L.issueRows(await records(), 'TRUCK')[0];
  const input = { action: 'updateIssue', requestId: rid(), recordId: truck.recordId, step: 'lessor', note: 'PENSKE' };
  const sent = [];
  const res = await T.afterSave(db(), DISPATCHER, input, await applyAction(db(), DISPATCHER, input), mailDeps(sent));
  assert.equal(res.email, 'QUEUED');
  assert.match(res.message, /Added to Penske's daily repair email, sent at 3 PM/);
  assert.equal(sent.length, 0, 'nothing goes out until the daily email');
  assert.match((await records()).find(r => r.kind === 'TRUCK').notes, /Repair email queued for the daily digest/);
  const out = await T.repairSweep(db(), { force: true, by: ADMIN.email, mailDeps: mailDeps(sent) });
  assert.match(out.message, /Sent 1 repair in 1 digest/);
  assert.match(sent[0].text, /Oil leak/);
  assert.match((await records()).find(r => r.kind === 'TRUCK').notes, /Repair email sent .* \(daily digest\)/);
  assert.equal((await call({ op: 'sentLog' })).emails[0].status, 'SENT');
  // Immediately: the Lessor button sends it right away.
  await call({ op: 'saveRepairEmail', routes: { PENSKE: { emails: 'repairs@penske.com', mode: 'IMMEDIATE' } } });
  const now = await T.sendOneRepair(db(), truck.recordId, DISPATCHER.email, '', mailDeps(sent));
  assert.equal(now.status, 'SENT');
});

test('Driver Check-In Email: the answering-service email becomes records once; a write-up with no truck or trailer word needs review', async () => {
  await call({ op: 'saveCheckinEmail', enabled: true, sender: 'callcenter@lauttamus.com', recipient: 'utdrivercheckin@uniteddairy.com', subject: 'UNIONTOWN DRIVER CHECK IN' });
  const body = ['Name (UT): ADAMS', 'Route Number: 801', 'Tractor Number: 900001', 'Trailor Number: 901', 'Cases Delivered: 410', 'Cases Returned: 3',
    'Write Up Defects: trailer door seal torn', 'Concerns / Issues: mirror cracked', 'Pallet Jack Issues: none', 'Need Cleaned: Y', 'Refused / Returned: no'].join('\n');
  const msg = { id: 'abc123', internalDate: Date.parse('2026-10-05T15:00:00Z'), from: 'Lauttamus Answering Service <CallCenter@lauttamus.com>', to: 'utdrivercheckin@uniteddairy.com', subject: 'UNIONTOWN DRIVER CHECK IN', body };
  const other = Object.assign({}, msg, { id: 'zzz', subject: 'Something else' });
  const readMail = async ({ owner, query }) => { assert.equal(owner, ADMIN.email); assert.match(query, /from:callcenter@lauttamus.com/); return [msg, other]; };
  const out = await T.checkinRun(db(), { by: ADMIN.email, readMail, now: () => new Date('2026-10-05T16:00:00Z') });
  assert.match(out.message, /1 check-in read, 3 records added, 1 need review/);
  const recs = await records();
  assert.deepEqual(recs.map(r => r.record_id).sort(), ['MAIL|abc123|cleaning', 'MAIL|abc123|tractor', 'MAIL|abc123|trailer']);
  assert.equal(recs.find(r => r.kind === 'TRUCK').status, 'NEEDS_REVIEW', '"mirror cracked" names neither truck nor trailer');
  assert.equal(recs.find(r => r.kind === 'TRAILER').status, 'OPEN');
  const run = (await db().collection('runs').doc(RUN).get()).data();
  assert.deepEqual([run.days.mon.casesDelivered, run.days.mon.driverCaseReturn], [410, 3]);
  // Read again: already seen.
  assert.match((await T.checkinRun(db(), { by: ADMIN.email, readMail })).message, /0 check-ins read|already seen/);
  // Google has not allowed the mailbox read yet: said plainly.
  const err = Object.assign(new Error('x'), { code: 'NOT_DELEGATED' });
  const failed = await T.checkinRun(db(), { by: ADMIN.email, readMail: async () => { throw err; } });
  assert.equal(failed.status, 'FAIL');
  assert.match(failed.message, /gmail.readonly/);
  assert.deepEqual(T.parseCheckinEmail('Name: A\nRoute: 1\nName: B\nRoute: 2'), { digest: true });
  // Joe 10/12: a report is dated by its TAKEN line (a resent Saturday report stays on Saturday), with the 6 a.m. day roll.
  const chad = T.parseCheckinEmail('Sat 10-Oct-26 02:38p TAKEN\nName +(UT): Chad Herman\nRoute Number: 812\nHow Many Returned: 566\nRefused/Returned: NO');
  assert.deepEqual([chad.driver, chad.route, chad.taken, chad.driverCaseReturn, chad.refusedReturned], ['Chad Herman', '812', '2026-10-10', 566, '']);
  assert.equal(T.parseCheckinEmail('Sun 11-Oct-26 03:10a TAKEN\nName: A\nRoute: 1').taken, '2026-10-10');
  assert.equal(T.parseCheckinEmail('Name: A\nRoute: 1').taken, '');
  // Joe 10/20: a check-in saying "Post Trip: YES - NO WRITE UPS" and no concerns makes no truck issue; an over/short is not one.
  const clean = T.parseCheckinEmail('Name +(UT): Sam Driver\nTractor #: 870\nRoute  #: 8300\nOverage/Shortage: SHORT - 54 1/2 GALS\nPallet Jack Issues: NO\nPre Trip: YES\nPost Trip: YES - NO WRITE UPS\nTrailer Condition: YES\nConcerns/Issues: NO');
  assert.deepEqual([clean.tractorIssues, clean.trailerIssues, clean.palletJackIssues], ['', '', '']);
  assert.equal(T.parseCheckinEmail('Name: A\nRoute: 1\nPost Trip: YES - AIR LEAK').tractorIssues, 'YES - AIR LEAK');
});

test('Driver Check-In Email per location (Joe 10/11): each plant keeps its own settings; Uniontown keeps the saved ones', async () => {
  await call({ op: 'saveCheckinEmail', enabled: true, sender: 'callcenter@lauttamus.com', recipient: 'utdrivercheckin@uniteddairy.com', subject: 'UNIONTOWN DRIVER CHECK IN' });
  const ch = await call({ op: 'checkinEmail', plant: 'fac_charleston' });
  assert.deepEqual([ch.settings.enabled, ch.settings.sender, ch.settings.recipient, ch.settings.subject], [false, '', '', '']);
  assert.equal(ch.standard.subject, 'CHARLESTON DRIVER CHECK IN');
  assert.deepEqual(ch.plants.map(p => p.name), ['Uniontown', 'Charleston', 'Martins Ferry']);
  // Blank and off saves; on needs the addresses.
  await call({ op: 'saveCheckinEmail', plant: 'fac_charleston', enabled: false, sender: '', recipient: '', subject: '' });
  await assert.rejects(call({ op: 'saveCheckinEmail', plant: 'fac_charleston', enabled: true, sender: '', recipient: '', subject: '' }), /sender/);
  const saved = await call({ op: 'saveCheckinEmail', plant: 'fac_charleston', enabled: true, sender: 'callcenter@lauttamus.com', recipient: 'chdrivercheckin@uniteddairy.com', subject: 'CHARLESTON DRIVER CHECK IN' });
  assert.match(saved.message, /Saved for Charleston/);
  assert.equal((await call({ op: 'checkinEmail' })).settings.recipient, 'utdrivercheckin@uniteddairy.com', 'Uniontown is unchanged');
  assert.equal((await call({ op: 'checkinEmail', plant: 'fac_charleston' })).settings.recipient, 'chdrivercheckin@uniteddairy.com');
  await assert.rejects(call({ op: 'checkinEmail', plant: 'nowhere' }), /Pick a location/);
  // The scheduled check reads each location's own mailbox; Check now reads only the one picked.
  const queries = [];
  const readMail = async ({ query }) => { queries.push(query); return []; };
  await T.checkinRun(db(), { readMail });
  assert.deepEqual(queries.map(q => /to:(\S+)/.exec(q)[1]).sort(), ['chdrivercheckin@uniteddairy.com', 'utdrivercheckin@uniteddairy.com']);
  queries.length = 0;
  const now = await call({ op: 'checkinEmailNow', plant: 'fac_charleston' }, { readMail });
  assert.equal(queries.length, 1);
  assert.match(queries[0], /to:chdrivercheckin/);
  assert.equal(now.plant, 'fac_charleston');
});

test('Driver Check-In Email keeps the original email; Maintenance marks those write-ups From email (review item 33)', async () => {
  await call({ op: 'saveCheckinEmail', enabled: true, sender: 'callcenter@lauttamus.com', recipient: 'utdrivercheckin@uniteddairy.com', subject: 'UNIONTOWN DRIVER CHECK IN' });
  const body = ['Name (UT): ADAMS', 'Route Number: 801', 'Tractor Number: 900001', 'Write Up Defects: truck horn weak'].join('\n');
  const msg = { id: 'mail77', internalDate: Date.parse('2026-10-05T15:00:00Z'), from: 'Lauttamus Answering Service <CallCenter@lauttamus.com>', to: 'utdrivercheckin@uniteddairy.com', subject: 'UNIONTOWN DRIVER CHECK IN', body };
  await T.checkinRun(db(), { plant: 'fac_uniontown', by: ADMIN.email, readMail: async () => [msg], now: () => new Date('2026-10-05T16:00:00Z') });
  const copy = (await db().collection('mailCopies').doc('mail77').get()).data();
  assert.deepEqual([copy.from, copy.subject, copy.receivedAt, copy.body], [msg.from, msg.subject, '2026-10-05T15:00:00.000Z', body]);
  const row = L.issueRows(await records(), 'TRUCK').find(r => r.recordId === 'MAIL|mail77|tractor');
  assert.deepEqual([row.fromEmail, row.emailId], [true, 'mail77']);
  const typed = L.issueRows([{ record_id: 'APP|x|mon|tractor', kind: 'TRUCK', issue_details: 'Flat', source_type: 'APP' }], 'TRUCK')[0];
  assert.deepEqual([typed.fromEmail, typed.emailId], [false, '']);
});

test('Driver Check-In Email (Joe 10/18): an email the old app already made a write-up for gets no second row', async () => {
  await call({ op: 'saveCheckinEmail', enabled: true, sender: 'callcenter@lauttamus.com', recipient: 'utdrivercheckin@uniteddairy.com', subject: 'UNIONTOWN DRIVER CHECK IN' });
  await db().collection('maintenance').doc('MAIL_mail88_posttrip').set({ record_id: 'MAIL|mail88|posttrip', kind: 'TRUCK', truck_number: '900001', issue_details: 'truck horn weak', status: 'OPEN', source_type: 'GMAIL', source_id: 'mail88' });
  const body = ['Name (UT): ADAMS', 'Route Number: 801', 'Tractor Number: 900001', 'Post Trip: truck horn weak', 'Trailor Number: 901', 'Concerns/Issues: trailer door seal torn'].join('\n');
  const msg = { id: 'mail88', internalDate: Date.parse('2026-10-05T15:00:00Z'), from: 'CallCenter@lauttamus.com', to: 'utdrivercheckin@uniteddairy.com', subject: 'UNIONTOWN DRIVER CHECK IN', body };
  await T.checkinRun(db(), { plant: 'fac_uniontown', by: ADMIN.email, readMail: async () => [msg], now: () => new Date('2026-10-05T16:00:00Z') });
  const mine = (await records()).filter(r => r.source_id === 'mail88').map(r => r.record_id).sort();
  // The truck already has the old app's row; the trailer problem it never made still gets one.
  assert.deepEqual(mine, ['MAIL|mail88|posttrip', 'MAIL|mail88|trailer']);
});

test('Driver Check-In Email (Joe 10/14): the driver\'s name finds the run when the route is said short, and old unmatched emails get their credit', async () => {
  await call({ op: 'saveCheckinEmail', enabled: true, sender: 'callcenter@lauttamus.com', recipient: 'utdrivercheckin@uniteddairy.com', subject: 'UNIONTOWN DRIVER CHECK IN' });
  const mail = (id, body) => ({ id, internalDate: Date.parse('2026-10-05T19:00:00Z'), from: 'Lauttamus Answering Service <CallCenter@lauttamus.com>', to: 'utdrivercheckin@uniteddairy.com', subject: 'UNIONTOWN DRIVER CHECK IN', body });
  // Lee Casey drives 802 on Monday and says "Route Number: 2".
  await T.checkinRun(db(), { by: ADMIN.email, readMail: async () => [mail('casey1', 'Name +(UT): Lee Casey\nRoute Number: 2\nHow Many Cases: 300\nHow Many Returned: 12')], now: () => new Date('2026-10-05T20:00:00Z') });
  const casey = (await db().collection('runs').doc('2026-10-04__run_t802').get()).data().days.mon;
  assert.ok(casey.checkinCompletedAt, 'Casey is checked in');
  assert.equal(casey.checkinVia, 'EMAIL', 'Joe 10/23: an emailed check-in is marked as one');
  assert.deepEqual([casey.casesDelivered, casey.driverCaseReturn], [300, 12]);
  // An email read before this change, kept with no run: the one-time load credits Pat Adams on 801.
  await db().collection('mailSeen').doc('adams1').set({ at: '2026-10-05T19:05:00.000Z', route: '1', driver: 'Pat Adams', run: '', made: [] });
  await db().collection('mailCopies').doc('adams1').set({ id: 'adams1', receivedAt: '2026-10-05T19:00:00.000Z', body: 'Name +(UT): Pat Adams\nRoute Number: 1' });
  const out = await T.recreditMailCheckins(db(), { now: () => new Date('2026-10-14T02:00:00Z') });
  assert.deepEqual(out, { credited: ['adams1 ' + RUN + '|mon'], still: [] });
  assert.equal((await db().collection('runs').doc(RUN).get()).data().days.mon.checkinCompletedAt, '2026-10-05T19:00:00.000Z');
  assert.equal((await db().collection('runs').doc(RUN).get()).data().days.mon.checkinVia, 'EMAIL');
  assert.equal((await db().collection('mailSeen').doc('adams1').get()).data().run, RUN + '|mon');
  assert.deepEqual(await T.recreditMailCheckins(db(), {}), { credited: [], still: [] }, 'once credited, never again');
});

test('Driver Check-In Email (Joe 10/14): every email in a conversation is read on its own, the morning list included, and nothing is made twice', async () => {
  await call({ op: 'saveCheckinEmail', enabled: true, sender: 'callcenter@lauttamus.com', recipient: 'utdrivercheckin@uniteddairy.com', subject: 'UNIONTOWN DRIVER CHECK IN' });
  const mail = (id, at, body) => ({ id, threadId: 'conv1', internalDate: Date.parse(at), from: 'CallCenter@lauttamus.com', to: 'utdrivercheckin@uniteddairy.com', subject: 'UNIONTOWN DRIVER CHECK IN', body });
  // One Gmail conversation: Pat Adams (801) and Lee Casey (802) each phone in Monday 10/5; Casey's own email never comes,
  // and the next morning's list names both.
  const adams = mail('m-adams', '2026-10-05T19:00:00Z', 'Name +(UT): Pat Adams\nRoute Number: 801\nHow Many Cases: 410\nHow Many Returned: 3\nWrite Updefects: trailer door seal torn');
  const list = mail('m-list', '2026-10-06T12:26:00Z', ['===========0000006405=================', 'Tue 06-Oct-26 08:26a', '======================================',
    'Mon 05-Oct-26 04:10p TAKEN', 'Mon 05-Oct-26 04:10p DELIVERED', 'Name +(UT): Lee Casey', 'Route #: 2', 'Cases Delivered: 300', 'Cases Returned: 12', 'Write Updefects: horn weak', '',
    '======================================', 'Mon 05-Oct-26 03:00p TAKEN', 'Mon 05-Oct-26 03:00p DELIVERED', 'Name +(UT): Pat Adams', 'Route Number: 801', 'How Many Cases: 999', '',
    '===========0000006405================='].join('\n'));
  const out = await T.checkinRun(db(), { by: ADMIN.email, readMail: async () => [list, adams], now: () => new Date('2026-10-06T13:00:00Z') });
  assert.match(out.message, /1 check-in read, 1 record added.*2 in the morning list \(1 newly credited\)/);
  const days = async (id) => (await db().collection('runs').doc(id).get()).data().days.mon;
  const pat = await days(RUN), lee = await days('2026-10-04__run_t802');
  assert.deepEqual([pat.casesDelivered, pat.driverCaseReturn], [410, 3], 'his own email wins over the list');
  assert.ok(pat.checkinCompletedAt);
  assert.equal(lee.checkinCompletedAt, '2026-10-05T20:10:00.000Z', 'Casey is credited from the list, at the time he phoned (4:10 p.m. New York)');
  assert.deepEqual([lee.casesDelivered, lee.driverCaseReturn], [300, 12]);
  assert.deepEqual((await records()).map(r => r.record_id), ['MAIL|m-adams|trailer'], 'write-ups come only from each check-in\'s own email');
  // Read again: everything already seen, nothing changes.
  const again = await T.checkinRun(db(), { by: ADMIN.email, readMail: async () => [list, adams], now: () => new Date('2026-10-06T13:10:00Z') });
  assert.match(again.message, /1 already seen.*\(0 newly credited\)/);
  assert.equal((await records()).length, 1);
});

test('Refresh Rates: a saved rate is used by the schedule; retired and fixed jobs cannot be changed; reload before saving', async () => {
  const r = await call({ op: 'refreshRates' });
  const job = r.jobs.find(j => j.key === 'checkinMail');
  assert.equal(job.minutes, 15);
  await assert.rejects(call({ op: 'saveRefreshRate', job: 'dailyShift', minutes: 5 }), /retired/);
  await assert.rejects(call({ op: 'saveRefreshRate', job: 'repairEmail', minutes: 1, revision: r.jobs.find(j => j.key === 'repairEmail').revision }), /at most/);
  const saved = await call({ op: 'saveRefreshRate', job: 'checkinMail', minutes: 30, revision: job.revision });
  assert.equal(saved.jobs.find(j => j.key === 'checkinMail').minutes, 30);
  await assert.rejects(call({ op: 'saveRefreshRate', job: 'checkinMail', minutes: 60, revision: job.revision }), /Reload/);
  const t0 = new Date('2026-10-09T12:00:00Z');
  assert.equal(await T.jobDue(db(), 'checkinMail', t0), true);
  assert.equal(await T.jobDue(db(), 'checkinMail', new Date(t0.getTime() + 15 * 60000)), false);
  assert.equal(await T.jobDue(db(), 'checkinMail', new Date(t0.getTime() + 30 * 60000)), true);
  // Archive: Sunday 6 PM New York by default.
  assert.equal(await T.jobDue(db(), 'archive', new Date('2026-10-11T22:10:00Z')), true);
  assert.equal(await T.jobDue(db(), 'archive', new Date('2026-10-12T22:10:00Z')), false);
});

// A sandbox Live workbook in memory: tabs, values, append and row deletes.
function fakeBook(tabs) {
  const titles = Object.keys(tabs);
  return {
    data: tabs, async tabs() { return titles.map((t, i) => ({ title: t, sheetId: i + 1 })); },
    async batchGet(id, ranges) { return ranges.map(r => JSON.parse(JSON.stringify(tabs[r.replace(/^'|'$/g, '')]))); },
    async append(id, range, values) { tabs[range.split('!')[0].replace(/^'|'$/g, '')].push(...values); },
    async structure(id, requests) {
      requests.forEach(q => {
        if (q.deleteDimension) { const r = q.deleteDimension.range; tabs[titles[r.sheetId - 1]].splice(r.startIndex, r.endIndex - r.startIndex); }
      });
    },
    async batchUpdate(id, data) {
      data.forEach(({ range, values }) => {
        const m = /^'(.*)'!([A-Z]+)(\d+)$/.exec(range), rows = tabs[m[1]], c = m[2].charCodeAt(0) - 65, r = Number(m[3]) - 1;
        while (rows[r].length <= c) rows[r].push('');
        rows[r][c] = values[0][0];
      });
    }
  };
}

test('Archive now: completed records move to HISTORY (checked), open ones stay; production is refused', async () => {
  const H = ['record_id', 'status', 'notes'];
  const book = fakeBook({ 'TRUCK LIVE': [H, ['R1', 'COMPLETE', 'done'], ['R2', 'OPEN', ''], ['R3', 'REPAIRED', '']], 'TRUCK HISTORY': [H.concat(['archived_at', 'archived_by', 'history_version'])],
    'TRAILER LIVE': [H], 'TRAILER HISTORY': [H], 'PLANT_OPERATIONS': [['record_id', 'business_date'], ['P1', '2026-09-01'], ['P2', '2026-10-08']], 'PLANT_OPERATIONS HISTORY': [['record_id', 'business_date', 'archived_at']] });
  const out = await T.archiveCompleted(db(), ADMIN.email, { sheets: book, liveId: 'fake-live-copy' }, tick());
  assert.match(out.message, /Archived 2 completed records and 1 old plant activity row/);
  const t = (await book.batchGet('', ["'TRUCK LIVE'", "'TRUCK HISTORY'", "'PLANT_OPERATIONS'"]));
  assert.deepEqual(t[0].slice(1).map(r => r[0]), ['R2']);
  assert.deepEqual(t[1].slice(1).map(r => [r[0], r[4]]), [['R1', ADMIN.email], ['R3', ADMIN.email]]);
  assert.deepEqual(t[2].slice(1).map(r => r[0]), ['P2']);
  await assert.rejects(T.archiveCompleted(db(), ADMIN.email, { sheets: book, liveId: '11beWtlO848OyZI_Bom9y2WCZn2vnw4mLm24pf-rO1Cg' }), /production/);
});

test('Pre-Flight, Update Live Sheets and Start Plant Fresh', async () => {
  const pf = await call({ op: 'preflight' }, { now: tick });
  assert.match(pf.summary, /^(PASS|FAIL) · \d+ \/ \d+ checks · \d+ passed · \d+ failed/);
  assert.ok(pf.checks.find(c => c.name === 'Live Week Lifecycle').status === 'PASS');
  // Monday's depart time changed by hand on Daily (no override) goes back to Route Master's on Update; Tuesday's override is kept.
  const dry = await call({ op: 'updateLive', apply: false }, { now: () => new Date('2026-10-04T12:00:00Z') });
  assert.match(dry.message, /^Dry run: /);
  assert.ok(!dry.changes.some(c => /run_t810/.test(c.runDocId) && 'runs' in c.after), 'a run on two rows keeps its days');
  assert.ok(dry.changes.some(c => c.after.dispatchTime === 330), 'depart time follows Route Master');
  const before = (await db().collection('runs').doc(RUN).get()).data();
  const done = await call({ op: 'updateLive', apply: true }, { now: () => new Date('2026-10-04T12:00:00Z') });
  assert.match(done.message, /^Live sheets updated: /);
  assert.equal(done.changes.length, dry.changes.length);
  const after = (await db().collection('runs').doc(RUN).get()).data();
  assert.equal(after.rev, dry.changes.some(c => c.runDocId === RUN) ? before.rev + 1 : before.rev);
  dry.changes.forEach(c => assert.ok(c.date >= '2026-10-04'));
  const fresh = await call({ op: 'plantFreshSet' }, { now: tick });
  assert.equal(fresh.plantStart.date, '2026-10-09');
  assert.equal((await db().collection('config').doc('app').get()).data().plantStart.date, '2026-10-09');
});

test('Pre-Flight: on live, names each real master sheet the server account cannot edit', async () => {
  const live = { READ_UNIONTOWN_SHEETS: '1' };
  const name = (pf) => pf.checks.find(c => c.name === 'Edit access to the master sheets');
  const asked = [];
  const access = (editable) => async (ids) => { asked.push(ids); const canEdit = {}; ids.forEach(id => { canEdit[id] = editable.indexOf(id) >= 0; }); return { account: 'runtime@example', canEdit }; };
  const S = require('../../src/sources').UNIONTOWN.masters;
  const sandbox = await call({ op: 'preflight' }, { sheetAccess: access([]) });
  assert.equal(name(sandbox).status, 'PASS');
  assert.equal(asked.length, 0, 'the sandbox does not ask about the real sheets');
  const some = await call({ op: 'preflight' }, { env: live, sheetAccess: access([S.routes.spreadsheetId, S.equipment.spreadsheetId, S.users.spreadsheetId, S.exceptions.spreadsheetId]) });
  assert.deepEqual(asked[0], ['routes', 'drivers', 'equipment', 'users', 'exceptions', 'vacations'].map(k => S[k].spreadsheetId));
  assert.equal(name(some).status, 'FAIL');
  assert.equal(name(some).detail, 'Share as Editor with runtime@example: Driver Master, Vacations.');
  const all = await call({ op: 'preflight' }, { env: live, sheetAccess: access(Object.values(S).map(x => x.spreadsheetId)) });
  assert.equal(name(all).status, 'PASS');
  assert.match(name(all).detail, /can edit Route Master, Driver Master, Equipment Master, Users, Exceptions, Vacations/);
});

test('Date Inventory, Dry Run and Convert (sandbox copy only, read back)', async () => {
  const tab = [['driver_id', 'hire_date', 'name'], ['d1', '10/9/2026', 'A'], ['d2', '2026-01-05', 'B'], ['d3', '', 'C']];
  const book = fakeBook({ DRIVERS_MASTER: tab });
  const sources = { masters: { drivers: { spreadsheetId: 'sandbox-drivers', tab: 'DRIVERS_MASTER' } } };
  const deps = { sheets: () => book, sources };
  const inv = await call({ op: 'dateInventory' }, deps);
  assert.match(inv.summary, /1 sheets · 1 date\/time columns · 0 already serial · 0 mixed · 1 stored as text/);
  const dry = await call({ op: 'dateDryRun', sheet: 'DRIVERS_MASTER', column: 'hire_date', kind: 'DATE' }, deps);
  assert.equal(dry.canConvert, true);
  assert.match(dry.message, /2 of 3 cells hold values · 0 cannot be read as DATE/);
  const out = await call({ op: 'dateConvert', sheet: 'DRIVERS_MASTER', column: 'hire_date', kind: 'DATE' }, deps);
  assert.match(out.message, /Converted 2 cells/);
  assert.equal(tab[1][1], 46304, '10/9/2026 is serial 46304');
  assert.match((await call({ op: 'dateDryRun', sheet: 'DRIVERS_MASTER', column: 'hire_date', kind: 'DATE' }, deps)).message, /already converted/);
  await assert.rejects(call({ op: 'dateConvert', sheet: 'DRIVERS_MASTER', column: 'name', kind: 'DATE' }, deps), /clean Dry Run/);
  const prod = { sheets: () => book, sources: { masters: { drivers: { spreadsheetId: '1VIGHkWdjSDkYVEu-wh3EMTjTg_vgJgD8Lqyapy1Pprw', tab: 'DRIVERS_MASTER' } } } };
  tab[1][1] = '10/9/2026';
  await db().collection('private').doc('dateColumns').delete();
  const anyProd = Object.keys(require('../../src/sources').UNIONTOWN.masters).map(k => require('../../src/sources').UNIONTOWN.masters[k].spreadsheetId)[0];
  prod.sources.masters.drivers.spreadsheetId = anyProd;
  await assert.rejects(call({ op: 'dateConvert', sheet: 'DRIVERS_MASTER', column: 'hire_date', kind: 'DATE' }, prod), /production/);
  assert.equal(T.toSerial('2026-10-09T16:30:00Z', 'DATETIME'), 46304 + 12.5 / 24);
  assert.equal(T.toSerial('4:30 AM', 'TIME'), 4.5 / 24);
});

// Review item 70 (Joe 10/13): the Lessor button's save happened before the email; an email that fails, or a fault while
// sending it, is reported as a saved write-up with a note that the email did not go, never as a failed save.
test('Repair Email: when the Lessor email fails, the save still answers ok with a note that the email did not go', async () => {
  await applyAction(db(), DISPATCHER, { action: 'saveCheckIn', requestId: rid(), runDocId: RUN, day: 'mon', tractorIssues: 'Wiper broken' });
  const truck = L.issueRows(await records(), 'TRUCK')[0];
  await call({ op: 'saveRepairEmail', routes: { PENSKE: { emails: 'repairs@penske.com', mode: 'SEND' } } });
  // The mail server refuses it.
  const refused = { env: { MAIL_FROM: 'joe@uniteddairy.com' }, sendMail: async () => { throw new Error('mail server down'); } };
  const input = { action: 'updateIssue', requestId: rid(), recordId: truck.recordId, step: 'lessor', note: 'PENSKE' };
  const saved = await applyAction(db(), DISPATCHER, input);
  const res = await T.afterSave(db(), DISPATCHER, input, saved, refused);
  assert.equal(res.ok, true);
  assert.equal(res.email, 'FAILED');
  assert.match(res.message, /^Saved\. The lessor email did not go: .*mail server down/);
  assert.match((await records()).find(r => r.kind === 'TRUCK').notes, /Sent to lessor PENSKE/, 'the save is kept');
  // A fault while sending (here the mail step's clock throws) does not fail the save either.
  const broken = { env: { MAIL_FROM: 'joe@uniteddairy.com' }, sendMail: async () => ({ to: [] }), now: () => { throw new Error('clock fault'); } };
  const res2 = await T.afterSave(db(), DISPATCHER, input, saved, broken);
  assert.equal(res2.ok, true);
  assert.equal(res2.email, 'FAILED');
  assert.equal(res2.message, 'Saved. The lessor email did not go: clock fault.');
});
