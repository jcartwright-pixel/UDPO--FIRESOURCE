/*
 * How long data is kept (Joe 10/18). Behind-the-scenes logs are kept 90 days and Shift Notes 6 months, then deleted once a
 * day. Everything else people enter (loads, check-ins, inspections, work orders, the Sent Email Log, the Text Log, ...) is
 * kept. Each list is cleaned on its own, so one that cannot be read or deleted does not stop the others; the next day picks
 * up whatever is left. Each read is bounded (oldest past the cut-off, a page at a time), never the whole list.
 *
 * config/cleanup holds the last run: when, and for each list how many were deleted or the error in plain words.
 */
'use strict';

const RULES = [
  // The sheet copy's log (one record per copy that changed something; the standing "no-changes" record is kept current).
  { key: 'transfers', label: 'Sheet copy log', collection: 'transfers', field: 'at', days: 90 },
  // Saves already written to the sheets (or set aside as a conflict). Waiting ones have no doneAt and are never touched.
  { key: 'outbox', label: 'Sheet save queue (sent)', collection: 'outbox', field: 'doneAt', days: 90 },
  { key: 'masterOutbox', label: 'Master sheet save queue (sent)', collection: 'masterOutbox', field: 'doneAt', days: 90 },
  // Driver Check-In Email: the copy of each email and the list of emails already handled.
  { key: 'mailCopies', label: 'Check-in email copies', collection: 'mailCopies', field: 'savedAt', days: 90 },
  { key: 'mailSeen', label: 'Check-in emails handled', collection: 'mailSeen', field: 'at', days: 90 },
  // Shift Notes entries and the review notes under them, by their plant day.
  { key: 'shiftNotes', label: 'Shift Notes', collection: 'plantJournal', where: ['type', '==', 'SHIFT_REPORT'], field: 'date', months: 6, day: true }
];
const PAGE = 400, MAX_PER_LIST = 20000;

// The cut-off for a rule: an ISO time, or a plant day (YYYY-MM-DD) for day-keyed lists.
function cutoff(rule, now) {
  const d = new Date(now.getTime());
  if (rule.months) d.setUTCMonth(d.getUTCMonth() - rule.months);
  else d.setTime(d.getTime() - rule.days * 86400000);
  const iso = d.toISOString();
  return rule.day ? iso.slice(0, 10) : iso;
}

async function cleanOne(db, rule, now) {
  const before = cutoff(rule, now);
  let q = db.collection(rule.collection);
  if (rule.where) q = q.where(rule.where[0], rule.where[1], rule.where[2]);
  q = q.where(rule.field, '<', before).orderBy(rule.field).limit(PAGE);
  let deleted = 0;
  while (deleted < MAX_PER_LIST) {
    const snap = await q.get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;
    if (snap.size < PAGE) break;
  }
  return { deleted, before, more: deleted >= MAX_PER_LIST };
}

async function runCleanup({ db, now }) {
  const at = now ? now() : new Date(), result = {};
  for (const rule of RULES) {
    try { result[rule.key] = Object.assign({ label: rule.label }, await cleanOne(db, rule, at)); }
    catch (e) { result[rule.key] = { label: rule.label, deleted: 0, error: 'Could not clean ' + rule.label + ': ' + String(e && e.message || e).slice(0, 300) }; }
  }
  await db.collection('config').doc('cleanup').set({ at: at.toISOString(), lists: result }).catch(() => {});
  return result;
}

module.exports = { RULES, cutoff, runCleanup };
