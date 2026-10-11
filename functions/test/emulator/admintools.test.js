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

test('Email Senders: the Lessor email comes from the plant mailbox, or from the manager who pressed it (Joe 10/11)', async () => {
  await applyAction(db(), DISPATCHER, { action: 'saveCheckIn', requestId: rid(), runDocId: RUN, day: 'mon', tractorIssues: 'Mirror cracked' });
  const truck = L.issueRows(await records(), 'TRUCK')[0];
  await call({ op: 'saveRepairEmail', routes: { PENSKE: { emails: 'repairs@penske.com', mode: 'SEND' } } });
  const sent = [];
  assert.equal((await T.sendOneRepair(db(), truck.recordId, DISPATCHER.email, '', mailDeps(sent))).status, 'SENT');
  assert.equal(sent[0].from, 'joe@uniteddairy.com', 'nothing set: the standard sender');
  await call({ op: 'saveEmailSenders', senders: { fac_uniontown: { address: 'Uniontown.Operations@uniteddairy.com', name: 'United Dairy Uniontown Operations' } }, repairFrom: 'PLANT' });
  await T.sendOneRepair(db(), truck.recordId, DISPATCHER.email, '', mailDeps(sent));
  assert.deepEqual([sent[1].from, sent[1].fromName], ['uniontown.operations@uniteddairy.com', 'United Dairy Uniontown Operations']);
  await db().collection('users').doc(DISPATCHER.email).set({ name: 'Dee Spatch', status: 'ACTIVE', roles: ['DISPATCHER'] }, { merge: true });
  await call({ op: 'saveEmailSenders', senders: { fac_uniontown: { address: 'uniontown.operations@uniteddairy.com', name: 'United Dairy Uniontown Operations' } }, repairFrom: 'PERSON' });
  await T.sendOneRepair(db(), truck.recordId, DISPATCHER.email, '', mailDeps(sent));
  assert.deepEqual([sent[2].from, sent[2].fromName], [DISPATCHER.email, 'Dee Spatch']);
  assert.equal((await call({ op: 'sentLog' })).emails[0].from, DISPATCHER.email);
});

test('Email Senders: automatic repair emails come from the plant mailbox even when the Lessor button sends as the person', async () => {
  await call({ op: 'saveEmailSenders', senders: { fac_uniontown: { address: 'uniontown.operations@uniteddairy.com', name: 'United Dairy Uniontown Operations' } }, repairFrom: 'PERSON' });
  await call({ op: 'saveRepairEmail', routes: { PENSKE: { emails: 'repairs@penske.com', mode: 'IMMEDIATE' } } });
  await applyAction(db(), DISPATCHER, { action: 'saveCheckIn', requestId: rid(), runDocId: RUN, day: 'mon', tractorIssues: 'Horn out' }, () => new Date(Date.now() + 60000));
  const auto = [];
  assert.match((await T.repairSweep(db(), { force: true, by: ADMIN.email, mailDeps: mailDeps(auto) })).message, /Sent 1 repair/);
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
