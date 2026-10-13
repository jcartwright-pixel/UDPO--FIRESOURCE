/*
 * United Dairy Distribution app: Over the Road saves (split out of actions.js, review item 81 (Joe 10/13)).
 */
'use strict';

const M = require('./model');

/*
 * Over the Road: the module's own records (the current app keeps them in its "UDPO OTR Report" workbook, never in Route Master):
 * otrRoutes (which runs count and where they go), otrMonthly (a month's figures), otrDaily (a day's count typed by hand, which wins
 * over the count from the dispatch sheet).
 */
async function saveOtr(tx, db, req, email, stamp, logRef, mode) {
  if (req.op === 'import') {
    // Imported numbers fill their months (typed figures for other keys stay); imported day counts never replace a typed one.
    const monthRefs = req.months.map(m => db.collection('otrMonthly').doc(m.year + '-' + String(m.month).padStart(2, '0')));
    const dayRefs = req.daily.map(d => db.collection('otrDaily').doc(d.date + '__' + M.safeIdPart(d.destination)));
    const noteRefs = req.comments.map(c => db.collection('otrComments').doc(c.date));
    const daySnaps = dayRefs.length ? await tx.getAll(...dayRefs) : [];
    const noteSnaps = noteRefs.length ? await tx.getAll(...noteRefs) : [];
    const meta = { updatedAt: stamp, updatedBy: email, testEdited: mode.mode === 'test' };
    req.months.forEach((m, i) => tx.set(monthRefs[i], Object.assign({}, m, { source: 'IMPORT' }, meta), { merge: true }));
    let kept = 0;
    req.daily.forEach((d, i) => {
      const old = daySnaps[i].exists ? daySnaps[i].data() : null;
      if (old && String(old.source || '').toUpperCase() === 'MANUAL') { kept++; return; }
      tx.set(dayRefs[i], Object.assign({}, d, { source: 'IMPORT' }, meta), { merge: true });
    });
    let notesSaved = 0;
    req.comments.forEach((c, i) => {
      const old = noteSnaps[i].exists ? noteSnaps[i].data() : null;
      if (old && String(old.source || '').toUpperCase() === 'MANUAL') return;
      notesSaved++;
      tx.set(noteRefs[i], Object.assign({}, c, { source: 'IMPORT' }, meta), { merge: true });
    });
    const result = { ok: true, requestId: req.requestId, runs: [], months: req.months.length, days: req.daily.length - kept, keptTyped: kept };
    if (req.comments.length) result.comments = notesSaved;
    tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, op: 'import', months: req.months.length, days: req.daily.length, comments: req.comments.length, result });
    return result;
  }
  let ref, data;
  if (req.op === 'route') { ref = db.collection('otrRoutes').doc(M.safeIdPart(req.runId)); data = { runId: req.runId, include: req.include, destination: req.destination, deliveredBy: req.deliveredBy || '' }; }
  else if (req.op === 'comment') { ref = db.collection('otrComments').doc(req.date); data = { date: req.date, text: req.text, source: 'MANUAL' }; }
  else if (req.op === 'figure') { ref = db.collection('otrMonthly').doc(req.year + '-' + String(req.month).padStart(2, '0')); data = { year: req.year, month: req.month, [req.key]: req.value, source: 'TYPED' }; }
  else { ref = db.collection('otrDaily').doc(req.date + '__' + M.safeIdPart(req.destination)); data = { date: req.date, destination: req.destination, runs: req.runs, source: 'MANUAL' }; }
  const snap = await tx.get(ref), before = snap.exists ? snap.data() : null;
  tx.set(ref, Object.assign({}, data, { updatedAt: stamp, updatedBy: email, testEdited: mode.mode === 'test' }), { merge: true });
  const result = { ok: true, requestId: req.requestId, runs: [] };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, op: req.op, doc: ref.path, before, after: data, result });
  return result;
}

module.exports = { saveOtr };
