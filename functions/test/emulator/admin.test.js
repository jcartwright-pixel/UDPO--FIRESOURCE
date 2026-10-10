'use strict';
// Administration's own pages (src/admin.js): People & Roles, Add Role, Role Templates, personal access links, the Route
// Distribution code, the manager release code, report groups, the Sending switch and Sent Email Log, repair items.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const A = require('../../src/admin');
const { appMail } = require('../../src/adminmail');
const { applyAction } = require('../../src/actions');

const ADMIN = { email: 'boss@uniteddairy.com' };
const call = (input, user, deps) => A.adminCall(db(), user || ADMIN, input, deps);
async function seed() {
  await clear();
  const u = db().collection('users');
  await u.doc('boss@uniteddairy.com').set({ name: 'Boss', status: 'ACTIVE', roles: ['ADMINISTRATOR'], facilities: ['*'], cells: { id: 'usr_boss', version: '1' } });
  await u.doc('jcartwright@uniteddairy.com').set({ name: 'Joe', status: 'ACTIVE', roles: ['ADMINISTRATOR'], facilities: ['*'], cells: { id: 'usr_joe', version: '2' } });
  await u.doc('sup@uniteddairy.com').set({ name: 'Sup', status: 'ACTIVE', roles: ['SUPERVISOR'], facilities: ['fac_uniontown'], cells: { id: 'usr_sup', version: '1' } });
  await db().collection('config').doc('app').set({ writeBack: { enabled: true } });
}
const person = async (email) => (await call({ op: 'people' })).people.find(p => p.email === email);

test.beforeEach(seed);

test('only an administrator gets in', async () => {
  await assert.rejects(call({ op: 'people' }, { email: 'sup@uniteddairy.com' }), /Only an administrator/);
  assert.deepEqual(await call({ op: 'repairCount' }, { email: 'sup@uniteddairy.com' }), { count: 0 });
});

test('People & Roles: change a person, queue the Users sheet copy, keep the primary admin and yourself safe', async () => {
  const sup = await person('sup@uniteddairy.com');
  const out = await call({ op: 'savePerson', email: sup.email, name: 'Sup Visor', roles: ['MANAGER'], status: 'ACTIVE', facilities: ['*'], grants: [], denials: ['otr.write'], revision: sup.revision });
  assert.equal(out.ok, true);
  const u = (await db().collection('users').doc('sup@uniteddairy.com').get()).data();
  assert.deepEqual([u.name, u.roles, u.facilities], ['Sup Visor', ['MANAGER'], ['*']]);
  const q = (await db().collection('masterOutbox').get()).docs.map(d => d.data());
  assert.equal(q.length, 1);
  assert.equal(q[0].list, 'users');
  assert.equal(q[0].rowId, 'sup@uniteddairy.com');
  assert.deepEqual([q[0].cells.display_name, q[0].cells.roles_json, q[0].cells.facility_ids_json, q[0].cells.version], ['Sup Visor', '["MANAGER"]', '["*"]', '2']);
  assert.deepEqual((await person('sup@uniteddairy.com')).denials, ['otr.write']);
  // An old screen cannot overwrite it.
  await assert.rejects(call({ op: 'savePerson', email: sup.email, name: 'X', roles: ['MANAGER'], status: 'ACTIVE', facilities: [], revision: sup.revision }), /Reload this person/);
  const joe = await person('jcartwright@uniteddairy.com');
  await assert.rejects(call({ op: 'savePerson', email: joe.email, name: 'Joe', roles: ['MANAGER'], status: 'ACTIVE', facilities: ['*'], revision: joe.revision }), /primary administrator/);
  const me = await person('boss@uniteddairy.com');
  await assert.rejects(call({ op: 'savePerson', email: me.email, name: 'Boss', roles: ['ADMINISTRATOR'], status: 'INACTIVE', facilities: ['*'], revision: me.revision }), /cannot remove your own/);
  await assert.rejects(call({ op: 'savePerson', email: 'x@gmail.com', name: 'X', roles: ['EMPLOYEE'], status: 'ACTIVE', facilities: [], isNew: true, revision: (await call({ op: 'people' })).newRevision }), /United Dairy/);
});

test('Add Person makes a new Users row; with the write-back off nothing is saved', async () => {
  const newRev = (await call({ op: 'people' })).newRevision;
  await call({ op: 'savePerson', email: 'new@uniteddairy.com', name: 'New Person', roles: ['PLANT_EMPLOYEE'], status: 'ACTIVE', facilities: ['fac_uniontown'], isNew: true, revision: newRev });
  const q = (await db().collection('masterOutbox').get()).docs.map(d => d.data());
  assert.equal(q[0].create, true);
  assert.match(q[0].cells.id, /^usr_[0-9a-f]{20}$/);
  await db().collection('config').doc('app').set({ writeBack: { enabled: false } });
  await assert.rejects(call({ op: 'savePerson', email: 'two@uniteddairy.com', name: 'Two', roles: ['EMPLOYEE'], status: 'ACTIVE', facilities: [], isNew: true, revision: newRev }), /write-back on/);
});

test('Add Role and Role Templates change what a person may save', async () => {
  await call({ op: 'addRole', name: 'Yard Lead', rights: ['plant.read', 'plant.write'] });
  const t = await call({ op: 'roleTemplates' });
  assert.ok(t.roles.indexOf('YARD_LEAD') >= 0);
  assert.deepEqual(t.templates.YARD_LEAD, ['plant.read', 'plant.write']);
  await assert.rejects(call({ op: 'addRole', name: 'yard lead' }), /already a role/);
  // Supervisors may not publish a week once the template takes it away.
  const sup = t.templates.SUPERVISOR || t.defaults.SUPERVISOR;
  await call({ op: 'saveRoleTemplate', role: 'SUPERVISOR', rights: sup.filter(c => c !== 'dispatch.publish'), expected: sup });
  await assert.rejects(applyAction(db(), { email: 'sup@uniteddairy.com' }, { requestId: 'req-rights-1', action: 'publishWeek', weekStart: '2026-10-04' }), /not allowed this save/);
  await assert.rejects(call({ op: 'saveRoleTemplate', role: 'ADMINISTRATOR', rights: [], expected: [] }), /protected/);
});

test('personal access link: generated once, revoked, emailed only to the sender outside production', async () => {
  const out = await call({ op: 'accessGenerate', email: 'sup@uniteddairy.com' });
  assert.match(out.token, /^[A-Za-z0-9_-]{20,}$/);
  const stored = (await db().collection('personAccess').doc('sup@uniteddairy.com').get()).data();
  assert.equal(JSON.stringify(stored).indexOf(out.token), -1, 'only a hash is kept');
  let sent = null;
  const mail = await A.OPS.accessEmail(db(), 'boss@uniteddairy.com', { email: 'sup@uniteddairy.com', link: 'https://x/index.html?access=' + out.token });
  assert.ok(mail.message);
  const r = await appMail(db(), { kind: 'Access link', by: 'boss@uniteddairy.com', to: ['sup@uniteddairy.com'], subject: 's', text: 't' },
    { env: { MAIL_FROM: 'joe@uniteddairy.com' }, sendMail: async (m) => { sent = m; return { to: m.to }; } });
  assert.deepEqual([r.status, sent.to], ['SENT', ['boss@uniteddairy.com']]);
  assert.equal((await call({ op: 'accessRevoke', email: 'sup@uniteddairy.com' })).message, 'Mobile access revoked.');
  assert.equal((await call({ op: 'accessLinks' })).people.find(p => p.email === 'sup@uniteddairy.com').state, 'REVOKED');
});

test('Sending OFF stops every email and the log says so', async () => {
  await call({ op: 'setSending', on: false });
  const r = await appMail(db(), { kind: 'Test', by: 'boss@uniteddairy.com', to: ['a@uniteddairy.com'], subject: 'Hi', text: 'x' }, { env: { MAIL_FROM: 'joe@uniteddairy.com' }, sendMail: async () => { throw new Error('must not send'); } });
  assert.equal(r.status, 'BLOCKED');
  const log = await call({ op: 'sentLog' });
  assert.equal(log.settings.sending, false);
  assert.equal(log.emails[0].status, 'BLOCKED');
});

test('Route Distribution code: new code shown to administrators, turned off and on', async () => {
  const out = await call({ op: 'routeCodeNew' });
  assert.match(out.code, /^[A-Z2-9]{6}$/);
  assert.equal((await call({ op: 'appLinks' })).routeCode.code, out.code);
  await call({ op: 'routeCodeOnOff', open: false });
  assert.equal((await call({ op: 'appLinks' })).routeCode.state, 'DISABLED');
  await call({ op: 'routeCodeOnOff', open: true });
  assert.equal((await db().collection('config').doc('routePhone').get()).data().enabled, true);
});

test('manager release code: needed once set, five wrong tries lock it', async () => {
  const sup = { email: 'sup@uniteddairy.com' };
  assert.deepEqual(await A.stationRelease(db(), sup, { op: 'status' }), { required: false });
  const { code } = await call({ op: 'releaseCodeNew', facilityId: 'fac_uniontown' });
  assert.match(code, /^[0-9A-F]{8}$/);
  assert.deepEqual(await A.stationRelease(db(), sup, { op: 'status' }), { required: true });
  assert.equal((await A.stationRelease(db(), sup, { op: 'release', code: code.toLowerCase() })).ok, true);
  for (let i = 0; i < 4; i++) assert.equal((await A.stationRelease(db(), sup, { op: 'release', code: 'WRONG123' })).ok, false);
  assert.match((await A.stationRelease(db(), sup, { op: 'release', code: 'WRONG123' })).message, /Too many/);
  await assert.rejects(A.stationRelease(db(), sup, { op: 'release', code }), /Wait 10 minutes/);
});

test('report groups per location; remove keeps the row', async () => {
  await call({ op: 'saveReportGroup', facilityId: 'fac_uniontown', name: 'Plant Management', recipients: 'A@uniteddairy.com; b@uniteddairy.com, a@uniteddairy.com' });
  let g = await call({ op: 'reportGroups', facilityId: 'fac_uniontown' });
  assert.deepEqual(g.groups.map(x => [x.name, x.recipients]), [['Plant Management', ['a@uniteddairy.com', 'b@uniteddairy.com']]]);
  await assert.rejects(call({ op: 'saveReportGroup', facilityId: 'fac_uniontown', name: 'Bad', recipients: 'not-an-email' }), /Not an email/);
  await call({ op: 'saveReportGroup', facilityId: 'fac_uniontown', name: 'Plant Management', recipients: 'a@uniteddairy.com', active: false });
  g = await call({ op: 'reportGroups', facilityId: 'fac_uniontown' });
  assert.equal(g.groups.length, 0);
  assert.equal((await db().collection('reportGroups').get()).size, 1);
});

test('Remaining Repair Items: add, count, complete', async () => {
  const a = await call({ op: 'saveRepairItem', title: 'Fix the dock door', notes: 'check sensor', priority: 'high' });
  assert.equal(a.count, 1);
  assert.match(a.open[0].id, /^FIX-[0-9A-F]{8}$/);
  assert.equal((await call({ op: 'repairCount' })).count, 1);
  const c = await call({ op: 'completeRepairItem', itemId: a.open[0].id });
  assert.deepEqual([c.count, c.complete[0].status], [0, 'COMPLETE']);
});
