/*
 * Safety Walkthrough (Joe 10/12, mock-ups A-F): the weekly walk, its open issues, and each plant's fire extinguishers.
 * The checklist, how often each item is checked and the extinguisher items are in safety-rules.js.
 *
 * saveSafetyWalk: one tap on today's walk (safetyWalks/{facilityId}__{date}); the walk is made by its first tap.
 *   op item    an item is GOOD, NOT_GOOD or '' (Not checked again). NOT_GOOD opens an issue, or adds this walk to the item's
 *              issue that is still open (a repeat); taking a Not good back removes what it added.
 *   op note    what is wrong (a Not good item);  op photo  its photo (a small JPEG, or '' to remove);
 *   op maint   send it to Plant Maintenance (true/false);
 *   op review  an earlier walk's open issue is Still open (OPEN) or FIXED;   op finish  the walk is done.
 * saveSafetyIssue: Open Issues' Mark Fixed, Reopen, what is wrong and Send to Plant Maintenance.
 * saveExtinguisher: add or change a plant's extinguisher (tag, location, type, size, service dates) or take it off the list.
 * saveExtinguisherCheck: one item of this month's check of an extinguisher; a Not good opens (or updates) an issue.
 * saveSafetyChecklist: a plant's own checklist (Checklist Setup).
 *
 * Plant Maintenance (being built in its own thread) picks up issues with sendToMaint true and no workOrderId, and fills in
 * workOrderId and maintStatus; until then they show "Waiting for Plant Maintenance". Nothing here writes Google Sheets.
 */
'use strict';

const L = require('./logic');
const S = require('./safety-rules');

const text = (v, max) => String(v === null || v === undefined ? '' : v).trim().slice(0, max || 200);
const docId = (id) => String(id).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 300);
const WALK_OPS = ['item', 'note', 'photo', 'maint', 'review', 'reviewnote', 'walknote', 'finish'];
const ISSUE_OPS = ['fixed', 'reopen', 'note', 'maint'];
const PHOTO_LIMIT = 700000;
const PLANT_IDS = () => L.PLANTS.map(p => p.id);

function plantOf(v, SaveError) {
  const id = text(v, 60);
  if (PLANT_IDS().indexOf(id) < 0) throw new SaveError('BAD_REQUEST', 'Pick the plant.');
  return id;
}
function statusOf(v, SaveError) {
  const s = text(v, 20).toUpperCase();
  if (s && S.STATUSES.indexOf(s) < 0) throw new SaveError('BAD_REQUEST', 'Pick Good or Not good.');
  return s;
}
// A walk is for today (New York), or yesterday for a walk that ran past midnight.
function walkDay(date, stamp, SaveError) {
  const today = L.localDay(stamp);
  if (date !== today && date !== L.addDays(today, -1)) throw new SaveError('BAD_REQUEST', 'A walk is saved on the day it is walked. Reload the page.');
}
async function setupOf(tx, db, facilityId) {
  const s = await tx.get(db.collection('safetySetup').doc(facilityId));
  return s.exists ? s.data() : null;
}
// The saver's name from the Users list, so the screens show "Joe Cartwright", not an email.
async function whoIs(tx, db, email) {
  const u = await tx.get(db.collection('users').doc(email));
  return (u.exists && text(u.data().name, 80)) || email.split('@')[0];
}
const photoOk = (v) => v === '' || (/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= PHOTO_LIMIT);

function validateWalk(input, SaveError) {
  const op = text(input.op, 20).toLowerCase();
  if (WALK_OPS.indexOf(op) < 0) throw new SaveError('BAD_REQUEST', 'Unknown walk entry.');
  const out = { op, facilityId: plantOf(input.facilityId, SaveError), date: text(input.date, 10) };
  if (!S.isKey(out.date)) throw new SaveError('BAD_REQUEST', 'The walk has no date. Reload the page.');
  if (['item', 'note', 'photo', 'maint'].indexOf(op) >= 0) {
    out.itemId = text(input.itemId, 60);
    if (!/^[A-Za-z0-9_-]+$/.test(out.itemId)) throw new SaveError('BAD_REQUEST', 'Pick the item.');
  }
  if (op === 'item') out.status = statusOf(input.status, SaveError);
  if (op === 'note') out.note = text(input.note, 500);
  if (op === 'photo') {
    out.photo = String(input.photo || '');
    if (!photoOk(out.photo)) throw new SaveError('BAD_REQUEST', 'The photo is too big or not a picture. Take it again.');
  }
  if (op === 'maint') out.maint = input.maint === true;
  if (op === 'walknote') out.note = text(input.note, 1000);
  if (op === 'reviewnote') {
    out.issueId = text(input.issueId, 300);
    out.note = text(input.note, 500);
    if (!out.issueId) throw new SaveError('BAD_REQUEST', 'Pick the issue.');
  }
  if (op === 'review') {
    out.issueId = text(input.issueId, 300);
    out.status = text(input.status, 10).toUpperCase();
    if (!out.issueId) throw new SaveError('BAD_REQUEST', 'Pick the issue.');
    if (['OPEN', 'FIXED'].indexOf(out.status) < 0) throw new SaveError('BAD_REQUEST', 'Pick Still open or Fixed.');
  }
  return out;
}

// The issue this walk's Not good belongs to: one still open for the same item, else a new one.
async function openIssueFor(tx, db, facilityId, itemId) {
  const q = await tx.get(db.collection('safetyIssues').where('facilityId', '==', facilityId).where('itemId', '==', itemId).where('status', '==', 'OPEN'));
  return q.docs.length ? q.docs[0] : null;
}

async function saveWalk(tx, db, req, email, stamp, logRef, mode, SaveError) {
  walkDay(req.date, stamp, SaveError);
  const name = await whoIs(tx, db, email);
  const id = S.walkId(req.facilityId, req.date), ref = db.collection('safetyWalks').doc(docId(id));
  const had = await tx.get(ref), before = had.exists ? had.data() : null;
  const setup = await setupOf(tx, db, req.facilityId);
  // The month's first walk carries the monthly items.
  let monthly = before ? before.monthly === true : true;
  if (!before) {
    const same = await tx.get(db.collection('safetyWalks').where('facilityId', '==', req.facilityId).where('month', '==', S.monthOf(req.date)));
    monthly = !same.docs.some(d => d.id !== docId(id));
  }
  const walk = before ? JSON.parse(JSON.stringify(before)) : { facilityId: req.facilityId, date: req.date, month: S.monthOf(req.date), monthly, items: {}, reviews: {}, startedAt: stamp, startedBy: email, startedByName: name };
  if (!walk.items) walk.items = {};
  if (!walk.reviews) walk.reviews = {};
  const writes = [];
  let message = 'Saved.', item = null, cur = null;
  if (req.itemId) {
    item = S.findItem(setup, req.itemId);
    cur = walk.items[req.itemId] || null;
    if (!item || (item.off && !cur)) throw new SaveError('NOT_FOUND', 'That item is not on this plant\'s checklist.');
  }
  if (req.op === 'item') {
    const was = cur ? cur.status : '';
    const next = Object.assign({}, cur || {}, { status: req.status, by: email, byName: name, at: stamp });
    if (req.status === 'NOT_GOOD' && was !== 'NOT_GOOD') {
      const open = await openIssueFor(tx, db, req.facilityId, req.itemId);
      if (open) {
        const iss = open.data(), walks = (iss.walks || []).filter(w => w !== id).concat([id]);
        writes.push(() => tx.update(open.ref, Object.assign({ walks, lastSeenOn: req.date, updatedAt: stamp, updatedBy: email }, next.note ? { lastNote: text(next.note, 500), lastNoteOn: req.date, lastNoteByName: name } : {})));
        next.issueId = open.id;
        next.repeat = true;
        message = item.text + ': Not good again (still open from ' + iss.foundOn + ').';
      } else {
        const issueRef = db.collection('safetyIssues').doc(docId(id + '__' + req.itemId));
        writes.push(() => tx.set(issueRef, { facilityId: req.facilityId, itemId: req.itemId, area: item.area, item: item.text, note: text(next.note, 500), photo: !!next.photo,
          sendToMaint: next.maint === true, maintStatus: next.maint === true ? 'WAITING' : '', workOrderId: '', status: 'OPEN', foundOn: req.date, foundWalk: id, foundBy: email, foundByName: name, foundAt: stamp,
          walks: [id], lastSeenOn: req.date, source: 'WALK', updatedAt: stamp, updatedBy: email }));
        next.issueId = issueRef.id;
        next.repeat = false;
        message = item.text + ': Not good. It stays open until it is fixed.';
      }
    } else if (req.status !== 'NOT_GOOD' && was === 'NOT_GOOD' && cur.issueId) {
      // Taken back: an issue this walk opened goes away; a repeat is taken off the older issue.
      const iref = db.collection('safetyIssues').doc(cur.issueId), is = await tx.get(iref);
      if (is.exists) {
        const iss = is.data();
        if (iss.foundWalk === id && iss.status === 'OPEN') {
          writes.push(() => tx.delete(iref));
          writes.push(() => tx.delete(db.collection('safetyPhotos').doc(cur.issueId)));
        } else writes.push(() => tx.update(iref, { walks: (iss.walks || []).filter(w => w !== id), updatedAt: stamp, updatedBy: email }));
      }
      delete next.issueId; delete next.repeat; delete next.photo; delete next.maint;
      message = item.text + ': ' + (req.status === 'GOOD' ? 'Good.' : 'Not checked.');
    } else message = item.text + ': ' + (req.status === 'GOOD' ? 'Good.' : req.status === 'NOT_GOOD' ? 'Not good.' : 'Not checked.');
    if (!req.status) { delete next.by; delete next.byName; delete next.at; next.status = ''; }
    walk.items[req.itemId] = next;
  } else if (req.op === 'note' && !(cur && cur.status === 'NOT_GOOD' && cur.issueId)) {
    // Joe 10/12: every item has a note, whatever it was marked (or not marked yet).
    cur = Object.assign({ status: '' }, cur || {}, { note: req.note });
    walk.items[req.itemId] = cur;
    message = req.note ? 'Note saved.' : 'Note cleared.';
  } else if (['note', 'photo', 'maint'].indexOf(req.op) >= 0) {
    if (!cur || cur.status !== 'NOT_GOOD' || !cur.issueId) throw new SaveError('BAD_REQUEST', 'Mark the item Not good first.');
    const iref = db.collection('safetyIssues').doc(cur.issueId), is = await tx.get(iref);
    const own = is.exists && is.data().foundWalk === id;
    if (req.op === 'note') {
      cur.note = req.note;
      if (is.exists) writes.push(() => tx.update(iref, own ? { note: req.note, updatedAt: stamp, updatedBy: email } : { lastNote: req.note, lastNoteOn: req.date, lastNoteByName: name, updatedAt: stamp, updatedBy: email }));
      message = 'Note saved.';
    } else if (req.op === 'photo') {
      cur.photo = !!req.photo;
      // An older issue keeps its own photo; this walk's photo of a repeat is kept on the walk's own photo record.
      const pid = own ? cur.issueId : docId(id + '__' + req.itemId);
      cur.photoId = req.photo ? pid : '';
      writes.push(() => req.photo ? tx.set(db.collection('safetyPhotos').doc(pid), { facilityId: req.facilityId, data: req.photo, at: stamp, by: email }) : tx.delete(db.collection('safetyPhotos').doc(pid)));
      if (own && is.exists) writes.push(() => tx.update(iref, { photo: !!req.photo, updatedAt: stamp, updatedBy: email }));
      message = req.photo ? 'Photo saved.' : 'Photo removed.';
    } else {
      cur.maint = req.maint;
      if (is.exists) {
        const iss = is.data();
        writes.push(() => tx.update(iref, { sendToMaint: req.maint, maintStatus: req.maint ? (iss.workOrderId ? iss.maintStatus || 'SENT' : 'WAITING') : (iss.workOrderId ? iss.maintStatus : ''), updatedAt: stamp, updatedBy: email }));
      }
      message = req.maint ? 'Marked to go to Plant Maintenance.' : 'Not sent to Plant Maintenance.';
    }
    walk.items[req.itemId] = cur;
  } else if (req.op === 'review') {
    const iref = db.collection('safetyIssues').doc(docId(req.issueId)), is = await tx.get(iref);
    if (!is.exists || is.data().facilityId !== req.facilityId) throw new SaveError('NOT_FOUND', 'That issue is not on this plant\'s list.');
    const iss = is.data();
    if (iss.foundWalk === id) throw new SaveError('BAD_REQUEST', 'That issue was found on this walk.');
    if (req.status === 'FIXED') {
      writes.push(() => tx.update(iref, { status: 'FIXED', fixedOn: req.date, fixedAt: stamp, fixedBy: email, fixedByName: name, fixedWalk: id, updatedAt: stamp, updatedBy: email }));
      message = iss.item + ': Fixed.';
    } else {
      // Still open (and, if this walk had marked it Fixed, open again).
      const reopen = iss.status === 'FIXED' && iss.fixedWalk === id;
      if (iss.status === 'FIXED' && !reopen) throw new SaveError('CONFLICT', iss.item + ' was already marked Fixed. Open Issues can reopen it.');
      writes.push(() => tx.update(iref, Object.assign({ lastReviewedOn: req.date, lastReviewedBy: email, lastReviewedByName: name, updatedAt: stamp, updatedBy: email }, reopen ? { status: 'OPEN', fixedOn: '', fixedAt: '', fixedBy: '', fixedByName: '', fixedWalk: '' } : {})));
      message = iss.item + ': Still open.';
    }
    walk.reviews[docId(req.issueId)] = Object.assign({}, walk.reviews[docId(req.issueId)] || {}, { status: req.status, by: email, byName: name, at: stamp });
  } else if (req.op === 'reviewnote') {
    // A note on an earlier issue while reviewing it ("waiting on parts"): kept on this walk and shown on the issue as its latest note.
    const iref = db.collection('safetyIssues').doc(docId(req.issueId)), is = await tx.get(iref);
    if (!is.exists || is.data().facilityId !== req.facilityId) throw new SaveError('NOT_FOUND', 'That issue is not on this plant\'s list.');
    walk.reviews[docId(req.issueId)] = Object.assign({}, walk.reviews[docId(req.issueId)] || {}, { note: req.note });
    writes.push(() => tx.update(iref, { lastNote: req.note, lastNoteOn: req.note ? req.date : '', lastNoteByName: req.note ? name : '', updatedAt: stamp, updatedBy: email }));
    message = req.note ? 'Note saved.' : 'Note cleared.';
  } else if (req.op === 'walknote') {
    walk.note = req.note; walk.noteByName = name; walk.noteAt = stamp;
    message = req.note ? 'Walk notes saved.' : 'Walk notes cleared.';
  } else {
    walk.finishedAt = stamp; walk.finishedBy = email; walk.finishedByName = name;
    message = 'Walk finished.';
  }
  walk.updatedAt = stamp; walk.updatedBy = email;
  tx.set(ref, walk);
  writes.forEach(w => w());
  const result = { ok: true, requestId: req.requestId, walkId: ref.id, op: req.op, message, issueId: req.itemId && walk.items[req.itemId] ? walk.items[req.itemId].issueId || '' : req.issueId || '' };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, walkId: ref.id, op: req.op, itemId: req.itemId || '', issueId: req.issueId || '',
    before: cur ? { status: cur.status || '' } : null, after: req.itemId ? { status: (walk.items[req.itemId] || {}).status || '' } : null, result });
  return result;
}

function validateIssue(input, SaveError) {
  const op = text(input.op, 20).toLowerCase();
  if (ISSUE_OPS.indexOf(op) < 0) throw new SaveError('BAD_REQUEST', 'Unknown issue change.');
  const out = { op, issueId: text(input.issueId, 300), date: text(input.date, 10) };
  if (!out.issueId) throw new SaveError('BAD_REQUEST', 'Pick the issue.');
  if (op === 'note') out.note = text(input.note, 500);
  if (op === 'maint') out.maint = input.maint === true;
  return out;
}
async function saveIssue(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const ref = db.collection('safetyIssues').doc(docId(req.issueId)), had = await tx.get(ref);
  if (!had.exists) throw new SaveError('NOT_FOUND', 'That issue is no longer on the list.');
  const iss = had.data(), today = L.localDay(stamp), name = await whoIs(tx, db, email);
  let change, message;
  if (req.op === 'fixed') {
    if (iss.status === 'FIXED') throw new SaveError('CONFLICT', iss.item + ' is already marked Fixed.');
    change = { status: 'FIXED', fixedOn: today, fixedAt: stamp, fixedBy: email, fixedByName: name, fixedWalk: '' };
    message = iss.item + ': Fixed.';
  } else if (req.op === 'reopen') {
    if (iss.status !== 'FIXED') throw new SaveError('CONFLICT', iss.item + ' is already open.');
    change = { status: 'OPEN', fixedOn: '', fixedAt: '', fixedBy: '', fixedByName: '', fixedWalk: '', reopenedAt: stamp, reopenedBy: email };
    message = iss.item + ': open again.';
  } else if (req.op === 'note') {
    change = { note: req.note };
    message = 'Note saved.';
  } else {
    change = { sendToMaint: req.maint, maintStatus: req.maint ? (iss.workOrderId ? iss.maintStatus || 'SENT' : 'WAITING') : (iss.workOrderId ? iss.maintStatus : '') };
    message = req.maint ? 'Marked to go to Plant Maintenance.' : 'Not sent to Plant Maintenance.';
  }
  Object.assign(change, { updatedAt: stamp, updatedBy: email });
  tx.update(ref, change);
  const result = { ok: true, requestId: req.requestId, issueId: ref.id, op: req.op, message };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, issueId: ref.id, op: req.op, before: { status: iss.status, note: iss.note || '', sendToMaint: !!iss.sendToMaint }, after: change, result });
  return result;
}

function validateExtinguisher(input, SaveError) {
  const out = { facilityId: plantOf(input.facilityId, SaveError), tag: text(input.tag, 12), location: text(input.location, 80), type: text(input.type, 20), size: text(input.size, 20), retired: input.retired === true };
  if (!/^[A-Za-z0-9-]{1,12}$/.test(out.tag)) throw new SaveError('BAD_REQUEST', 'Type the tag number (letters, numbers or -).');
  if (!out.retired && !out.location) throw new SaveError('BAD_REQUEST', 'Type where tag ' + out.tag + ' hangs.');
  if (out.type && S.EXT_TYPES.indexOf(out.type) < 0) throw new SaveError('BAD_REQUEST', 'Pick the extinguisher type.');
  [['annualDue', 'Annual service'], ['sixYearDue', '6-year'], ['hydroDue', 'Hydro test']].forEach(([k, label]) => {
    const v = text(input[k], 20);
    const key = v ? (/^\d{1,2}[-/]\d{1,2}[-/](\d{2}|\d{4})$/.test(v) ? L.dateKey(v.replace(/-/g, '/')) : S.isKey(v) ? v : '') : '';
    if (v && !key) throw new SaveError('BAD_REQUEST', label + ' must be a date like 3-15-27.');
    out[k] = key;
  });
  out.isNew = input.isNew === true;
  return out;
}
async function saveExtinguisher(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const ref = db.collection('extinguishers').doc(docId(S.extId(req.facilityId, req.tag))), had = await tx.get(ref);
  if (req.isNew && had.exists && had.data().status !== 'RETIRED') throw new SaveError('CONFLICT', 'Tag ' + req.tag + ' is already on the list.');
  if (!req.isNew && !had.exists) throw new SaveError('NOT_FOUND', 'Tag ' + req.tag + ' is not on the list.');
  const before = had.exists ? had.data() : null;
  const doc = { facilityId: req.facilityId, tag: req.tag, location: req.location || (before && before.location) || '', type: req.type, size: req.size, annualDue: req.annualDue, sixYearDue: req.sixYearDue, hydroDue: req.hydroDue,
    status: req.retired ? 'RETIRED' : 'ACTIVE', updatedAt: stamp, updatedBy: email };
  if (!before) Object.assign(doc, { checks: {}, createdAt: stamp, createdBy: email });
  tx.set(ref, doc, { merge: true });
  const message = req.retired ? 'Tag ' + req.tag + ' taken off the list.' : before ? 'Tag ' + req.tag + ' saved.' : 'Tag ' + req.tag + ' added.';
  const result = { ok: true, requestId: req.requestId, extinguisherId: ref.id, message };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, extinguisherId: ref.id, before: before ? { location: before.location, status: before.status } : null, after: { location: doc.location, status: doc.status }, result });
  return result;
}

function validateExtCheck(input, SaveError) {
  const out = { extinguisherId: text(input.extinguisherId, 120), month: text(input.month, 7), item: text(input.item, 20), status: statusOf(input.status, SaveError), note: input.note === undefined ? null : text(input.note, 300) };
  if (!out.extinguisherId) throw new SaveError('BAD_REQUEST', 'Pick the extinguisher.');
  if (!/^\d{4}-\d\d$/.test(out.month)) throw new SaveError('BAD_REQUEST', 'The check has no month. Reload the page.');
  if (out.note === null && !S.EXT_ITEMS.some(i => i[0] === out.item)) throw new SaveError('BAD_REQUEST', 'Pick the item.');
  return out;
}
async function saveExtCheck(tx, db, req, email, stamp, logRef, mode, SaveError) {
  if (req.month !== S.monthOf(L.localDay(stamp))) throw new SaveError('BAD_REQUEST', 'The monthly check is saved in the month it is done. Reload the page.');
  const ref = db.collection('extinguishers').doc(docId(req.extinguisherId)), had = await tx.get(ref);
  if (!had.exists || had.data().status === 'RETIRED') throw new SaveError('NOT_FOUND', 'That extinguisher is not on the list.');
  const name = await whoIs(tx, db, email);
  const ext = had.data(), checks = Object.assign({}, ext.checks || {}), month = Object.assign({ items: {} }, checks[req.month] || {});
  month.items = Object.assign({}, month.items || {});
  const beforeState = S.extMonth(ext, req.month).state;
  if (req.note !== null) month.note = req.note;
  else if (req.status) month.items[req.item] = req.status; else delete month.items[req.item];
  month.by = email; month.byName = name; month.at = stamp;
  checks[req.month] = month;
  const after = S.extMonth({ checks }, req.month);
  // A Not good on the check is an open issue (one per extinguisher and month), kept up to date as the check changes.
  const issueRef = db.collection('safetyIssues').doc(docId('ext__' + ref.id + '__' + req.month)), is = await tx.get(issueRef);
  const what = 'Extinguisher tag ' + ext.tag + ' (' + ext.location + '): ' + after.bad.join('; ');
  tx.update(ref, { checks, updatedAt: stamp, updatedBy: email });
  if (after.state === 'NOT_GOOD') {
    if (is.exists && is.data().status === 'OPEN') tx.update(issueRef, { item: what, note: month.note || '', updatedAt: stamp, updatedBy: email });
    else if (!is.exists) tx.set(issueRef, { facilityId: ext.facilityId, itemId: 'ext_' + ext.tag, area: 'Fire Extinguishers', item: what, note: month.note || '', photo: false, sendToMaint: false, maintStatus: '', workOrderId: '',
      status: 'OPEN', foundOn: L.localDay(stamp), foundWalk: '', foundBy: email, foundByName: name, foundAt: stamp, walks: [], lastSeenOn: L.localDay(stamp), source: 'EXTINGUISHER', extinguisherId: ref.id, updatedAt: stamp, updatedBy: email });
  } else if (is.exists && is.data().status === 'OPEN' && beforeState === 'NOT_GOOD') tx.delete(issueRef);
  const message = req.note !== null ? 'Note saved.' : after.state === 'GOOD' ? 'Tag ' + ext.tag + ' is done for the month.' : after.state === 'NOT_GOOD' ? 'Tag ' + ext.tag + ': Not good. It stays open until it is fixed.' : 'Saved.';
  const result = { ok: true, requestId: req.requestId, extinguisherId: ref.id, month: req.month, state: after.state, message };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, extinguisherId: ref.id, month: req.month, item: req.item, before: beforeState, after: after.state, result });
  return result;
}

function validateChecklist(input, SaveError) {
  const facilityId = plantOf(input.facilityId, SaveError);
  if (!Array.isArray(input.areas) || !input.areas.length || input.areas.length > 30) throw new SaveError('BAD_REQUEST', 'The checklist needs at least one area.');
  const seen = {};
  const areas = input.areas.map((a, n) => {
    const name = text(a && a.name, 60), key = text(a && a.key, 40) || 'area' + (n + 1);
    if (!name) throw new SaveError('BAD_REQUEST', 'Every area needs a name.');
    if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new SaveError('BAD_REQUEST', 'Bad area.');
    const items = (Array.isArray(a.items) ? a.items : []).slice(0, 60).map(i => {
      const id = text(i && i.id, 60), t = text(i && i.text, 160), freq = text(i && i.freq, 10).toUpperCase() || 'WEEKLY';
      if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new SaveError('BAD_REQUEST', 'Bad item.');
      if (!t) throw new SaveError('BAD_REQUEST', 'Every item needs words (' + name + ').');
      if (S.FREQS.indexOf(freq) < 0) throw new SaveError('BAD_REQUEST', 'Pick Weekly or Monthly.');
      if (seen[id]) throw new SaveError('BAD_REQUEST', 'An item is listed twice.');
      seen[id] = true;
      return { id, text: t, freq, off: i.off === true };
    });
    return { key, name, items };
  });
  return { facilityId, areas };
}
async function saveChecklist(tx, db, req, email, stamp, logRef, mode) {
  const ref = db.collection('safetySetup').doc(req.facilityId), had = await tx.get(ref);
  // An item once used is never dropped, only turned off, so old walks and issues still read.
  const keep = had.exists ? S.checklist(had.data(), true) : S.checklist(null, true);
  const now = {};
  req.areas.forEach(a => a.items.forEach(i => { now[i.id] = true; }));
  const areas = req.areas.map(a => Object.assign({}, a, { items: a.items.slice() }));
  keep.forEach(a => a.items.forEach(i => {
    if (now[i.id]) return;
    let to = areas.find(x => x.key === a.key);
    if (!to) { to = { key: a.key, name: a.name, items: [] }; areas.push(to); }
    to.items.push({ id: i.id, text: i.text, freq: i.freq, off: true });
  }));
  tx.set(ref, { facilityId: req.facilityId, areas, updatedAt: stamp, updatedBy: email });
  const result = { ok: true, requestId: req.requestId, facilityId: req.facilityId, message: 'Checklist saved.' };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, facilityId: req.facilityId, before: had.exists ? { areas: (had.data().areas || []).length } : null, after: { areas: areas.length }, result });
  return result;
}

module.exports = { validateWalk, saveWalk, validateIssue, saveIssue, validateExtinguisher, saveExtinguisher, validateExtCheck, saveExtCheck, validateChecklist, saveChecklist };
