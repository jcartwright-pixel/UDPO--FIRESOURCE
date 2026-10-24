'use strict';
// Walkthrough pictures (Joe 10/23): a manager's picture goes with the next Send Current Report, never again after it reaches
// the group, and is deleted after 30 days.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const { mailReport } = require('../../src/reportmail');
const { runCleanup } = require('../../src/cleanup');
const D = require('../../src/demo-sheets');
const PD = require('../fixtures/plant-demo');

const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
let n = 0;
const rid = () => 'photo-request-' + (++n) + '-' + Date.now();
// A real (tiny) JPEG, as the phone sends it.
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const take = (extra) => applyAction(db(), DISPATCHER, Object.assign({ action: 'saveWalkPhoto', requestId: rid(), image: JPEG, thumb: JPEG, width: 1, height: 1 }, extra || {}));
const sends = () => { const sent = []; return { sent, deps: { env: { MAIL_FROM: 'joe@uniteddairy.com' }, sendMail: async (m) => { sent.push(m); return { to: m.to }; } } }; };
const report = async (id, extra) => {
  const ref = db().collection('plantReports').doc(id), r = Object.assign({ status: 'SENDING', subject: 'Plant Update', text: 'ROUTES BEHIND (0)', by: 'boss@uniteddairy.com', mode: 'test', at: new Date(Date.now() + 1000).toISOString() }, extra || {});
  await ref.set(r);
  return { ref, r };
};

test.beforeEach(async () => { await clear(); await runTransfer({ db: db(), reader: D.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T16:00:00Z') }); });

test('a picture is saved as a list entry with a small copy, and the picture itself on its own', async () => {
  const res = await take({ facilityId: 'fac_uniontown' });
  assert.match(res.photoId, /^PHOTO_/);
  const list = (await db().collection('walkPhotos').doc(res.photoId).get()).data();
  assert.deepEqual([list.by, list.sentAt, list.facilityId, list.thumb === JPEG, 'image' in list], ['dispatch.test@uniteddairy.com', '', 'fac_uniontown', true, false]);
  assert.equal((await db().collection('walkPhotoData').doc(res.photoId).get()).data().image, JPEG);
  // The save log does not carry the picture.
  assert.equal(JSON.stringify((await db().collection('actions').doc(res.requestId).get()).data()).indexOf('base64'), -1);
  await assert.rejects(take({ image: 'data:image/png;base64,AAAA' }), /did not come through/);
  await assert.rejects(take({ image: 'data:image/jpeg;base64,' + 'A'.repeat(950000) }), /too big/);
});

test('the next report carries every picture not sent yet; once sent they never go again; Send Test to Me does not count', async () => {
  await take(); await take();
  const { sent, deps } = sends();
  const t = await report('r-test', { testOnly: true });
  assert.equal(await mailReport(t.ref, t.r, deps), 'SENT');
  assert.equal(sent[0].attachments.length, 2);
  assert.match(sent[0].attachments[0].filename, /^Picture 1 .*\.jpg$/);
  assert.match(sent[0].text, /2 walkthrough pictures attached\.$/);
  assert.equal((await db().collection('walkPhotos').where('sentAt', '==', '').get()).size, 2, 'a test keeps them waiting');
  const a = await report('r-a');
  await mailReport(a.ref, a.r, deps);
  assert.equal(sent[1].attachments.length, 2);
  assert.equal((await a.ref.get()).data().pictures, 2);
  assert.equal((await db().collection('walkPhotos').where('sentReportId', '==', 'r-a').get()).size, 2);
  // A new picture after that: only it goes with the next report.
  await take();
  const b = await report('r-b');
  await mailReport(b.ref, b.r, deps);
  assert.equal(sent[2].attachments.length, 1);
  const c = await report('r-c');
  await mailReport(c.ref, c.r, deps);
  assert.deepEqual([sent[3].attachments.length, /picture/.test(sent[3].text)], [0, false]);
});

test('each picture caption shows under it in the email (Joe 10/23); a sent picture caption no longer changes', async () => {
  const one = await take();
  await applyAction(db(), DISPATCHER, { action: 'captionWalkPhoto', requestId: rid(), photoId: one.photoId, note: 'Cleaned the <dock 4> area' });
  const { sent, deps } = sends(), r = await report('r-cap');
  await mailReport(r.ref, r.r, deps);
  const pic = sent[0].attachments[0];
  assert.equal(pic.note, 'Cleaned the <dock 4> area');
  assert.ok(sent[0].html.indexOf('<img src="cid:' + pic.contentId + '"') > 0, 'the picture shows in the email');
  assert.ok(sent[0].html.indexOf('1. Cleaned the &lt;dock 4&gt; area') > 0, 'with its caption under it');
  assert.match(sent[0].text, /WALKTHROUGH PICTURES\n1\. Cleaned the <dock 4> area/);
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'captionWalkPhoto', requestId: rid(), photoId: one.photoId, note: 'x' }), /already emailed/);
});

test('a picture not sent yet can be removed; a sent one stays', async () => {
  const one = await take(), two = await take();
  await applyAction(db(), DISPATCHER, { action: 'removeWalkPhoto', requestId: rid(), photoId: one.photoId });
  assert.equal((await db().collection('walkPhotos').doc(one.photoId).get()).exists, false);
  assert.equal((await db().collection('walkPhotoData').doc(one.photoId).get()).exists, false);
  const { deps } = sends(), r = await report('r-x');
  await mailReport(r.ref, r.r, deps);
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'removeWalkPhoto', requestId: rid(), photoId: two.photoId }), /already emailed/);
});

test('pictures are deleted after 30 days, sent or not', async () => {
  const NOW = new Date('2026-11-30T08:00:00Z'), ago = (d) => new Date(NOW.getTime() - d * 86400000).toISOString();
  const put = (c, id, data) => db().collection(c).doc(id).set(data);
  await Promise.all([put('walkPhotos', 'PHOTO_old', { takenAt: ago(31), sentAt: ago(30) }), put('walkPhotoData', 'PHOTO_old', { takenAt: ago(31) }),
    put('walkPhotos', 'PHOTO_oldwait', { takenAt: ago(31), sentAt: '' }), put('walkPhotos', 'PHOTO_new', { takenAt: ago(29), sentAt: '' }), put('walkPhotoData', 'PHOTO_new', { takenAt: ago(29) })]);
  const out = await runCleanup({ db: db(), now: () => NOW });
  assert.deepEqual([out.walkPhotos.deleted, out.walkPhotoData.deleted], [2, 1]);
  assert.deepEqual((await db().collection('walkPhotos').get()).docs.map(d => d.id), ['PHOTO_new']);
  assert.deepEqual((await db().collection('walkPhotoData').get()).docs.map(d => d.id), ['PHOTO_new']);
});
