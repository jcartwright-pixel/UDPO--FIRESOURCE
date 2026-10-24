/*
 * Walkthrough pictures (Joe 10/23): a manager takes a picture on the walkthrough (phone or tablet camera, or a picture file on
 * a computer). The next Send Current Report emails every picture not sent yet; once the Plant Managers group has a picture it
 * is never sent again. Pictures are kept 30 days, then deleted (cleanup.js).
 *
 * Each picture is two documents, so a screen listing the pictures never downloads the pictures themselves:
 *   walkPhotos/{id}     who took it, when, the area, a small copy for the screens, and when it was sent (sentAt) and in which report
 *   walkPhotoData/{id}  the picture itself (a JPEG the phone has already made smaller), read only by the server for the email
 * Send Test to Me attaches the pictures but does not count as sending them.
 */
'use strict';

const L = require('./logic');

const KEEP_DAYS = 30;
// A Firestore document holds up to 1 MiB; the phone shrinks a picture well below this before it is sent.
const MAX_IMAGE = 900000, MAX_THUMB = 60000;
// One email carries at most this many pictures (and this many bytes of them); the rest wait for the next report.
const MAX_PER_EMAIL = 20, MAX_EMAIL_BYTES = 18 * 1024 * 1024;
const AREAS = ['', 'Yard', 'Coolers', 'Production'];
const JPEG = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/;

const text = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, n || 200);
const photoId = (requestId) => 'PHOTO_' + String(requestId).replace(/[^A-Za-z0-9]/g, '').slice(0, 40);

function validatePhoto(action, input, SaveError) {
  if (action === 'removeWalkPhoto' || action === 'captionWalkPhoto') {
    const photo = text(input.photoId, 80);
    if (!/^PHOTO_[A-Za-z0-9]{4,40}$/.test(photo)) throw new SaveError('BAD_REQUEST', 'Pick the picture');
    return action === 'captionWalkPhoto' ? { photoId: photo, note: text(input.note, 300) } : { photoId: photo };
  }
  const image = String(input.image || ''), thumb = String(input.thumb || '');
  if (!JPEG.test(image)) throw new SaveError('BAD_REQUEST', 'The picture did not come through. Take it again.');
  if (image.length > MAX_IMAGE) throw new SaveError('BAD_REQUEST', 'The picture is too big. Take it again.');
  if (thumb && (!JPEG.test(thumb) || thumb.length > MAX_THUMB)) throw new SaveError('BAD_REQUEST', 'The picture did not come through. Take it again.');
  const area = AREAS.indexOf(text(input.area, 20)) >= 0 ? text(input.area, 20) : '';
  return { image, thumb, area, note: text(input.note, 300), facilityId: text(input.facilityId, 60) || 'fac_uniontown',
    width: Math.max(0, Math.round(Number(input.width) || 0)), height: Math.max(0, Math.round(Number(input.height) || 0)) };
}

async function savePhoto(tx, db, req, email, stamp, logRef, mode, SaveError) {
  // Joe 10/23 (later): each picture's caption ("Cleaned the dock 4 area"), shown under it in the email; it saves as it is typed.
  if (req.action === 'captionWalkPhoto') {
    const ref = db.collection('walkPhotos').doc(req.photoId), had = await tx.get(ref);
    if (!had.exists) throw new SaveError('NOT_FOUND', 'That picture was removed.');
    if (had.data().sentAt) throw new SaveError('NOT_ALLOWED', 'That picture was already emailed, so its caption can no longer change.');
    tx.update(ref, { note: req.note, noteBy: email, noteAt: stamp });
    const result = { ok: true, requestId: req.requestId, photoId: req.photoId };
    tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, photoId: req.photoId, after: { note: req.note }, result });
    return result;
  }
  if (req.action === 'removeWalkPhoto') {
    const ref = db.collection('walkPhotos').doc(req.photoId), had = await tx.get(ref);
    if (!had.exists) throw new SaveError('NOT_FOUND', 'That picture was already removed.');
    if (had.data().sentAt) throw new SaveError('NOT_ALLOWED', 'That picture was already emailed, so it stays until it is 30 days old.');
    tx.delete(ref);
    tx.delete(db.collection('walkPhotoData').doc(req.photoId));
    const result = { ok: true, requestId: req.requestId, photoId: req.photoId, message: 'Picture removed.' };
    tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, photoId: req.photoId, result });
    return result;
  }
  const id = photoId(req.requestId), bytes = Math.floor(req.image.length * 3 / 4);
  tx.set(db.collection('walkPhotos').doc(id), { photoId: id, facilityId: req.facilityId, date: L.operatingDay(new Date(stamp)), takenAt: stamp, by: email, area: req.area, note: req.note,
    thumb: req.thumb, width: req.width, height: req.height, bytes, sentAt: '', sentReportId: '', mode: mode.mode });
  tx.set(db.collection('walkPhotoData').doc(id), { photoId: id, takenAt: stamp, image: req.image });
  const result = { ok: true, requestId: req.requestId, photoId: id, takenAt: stamp, message: 'Picture saved. It goes with the next report.' };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, photoId: id, after: { area: req.area, bytes }, result });
  return result;
}

/* ---------- The email ---------- */

// The plant's pictures not yet sent to the group, oldest first, taken before the report was saved.
async function pendingPhotos(db, facilityId, before) {
  const snap = await db.collection('walkPhotos').where('sentAt', '==', '').get();
  return snap.docs.map(d => d.data()).filter(p => (p.facilityId || 'fac_uniontown') === (facilityId || 'fac_uniontown') && (!before || String(p.takenAt) <= String(before)))
    .sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt)));
}

const fileName = (p, i) => 'Picture ' + (i + 1) + (p.area ? ' ' + p.area : '') + ' ' + String(p.takenAt || '').slice(0, 16).replace(/[T:]/g, '-') + '.jpg';

// The pictures as email attachments, up to the email's limits. Returns { attachments, used: [photoId], left }.
async function photoAttachments(db, facilityId, before) {
  const pending = await pendingPhotos(db, facilityId, before), attachments = [], used = [];
  let total = 0;
  for (const p of pending) {
    if (used.length >= MAX_PER_EMAIL) break;
    const d = await db.collection('walkPhotoData').doc(p.photoId).get();
    const m = d.exists ? JPEG.exec(String(d.data().image || '')) : null;
    if (!m) continue;
    const size = Math.floor(m[1].length * 3 / 4);
    if (used.length && total + size > MAX_EMAIL_BYTES) break;
    total += size;
    attachments.push({ filename: fileName(p, used.length), contentType: 'image/jpeg', base64: m[1], contentId: 'pic' + used.length + '_' + p.photoId + '@uniteddairy', area: p.area || '', by: p.by || '', takenAt: p.takenAt || '', note: p.note || '' });
    used.push(p.photoId);
  }
  return { attachments, used, left: pending.length - used.length };
}

// After the group gets the email, its pictures are marked sent so no later report sends them again.
async function markSent(db, ids, reportId, at) {
  for (let i = 0; i < ids.length; i += 400) {
    const batch = db.batch();
    ids.slice(i, i + 400).forEach(id => batch.update(db.collection('walkPhotos').doc(id), { sentAt: at, sentReportId: reportId || '' }));
    await batch.commit();
  }
}

module.exports = { KEEP_DAYS, MAX_IMAGE, MAX_THUMB, MAX_PER_EMAIL, MAX_EMAIL_BYTES, AREAS, validatePhoto, savePhoto, pendingPhotos, photoAttachments, markSent, photoId };
