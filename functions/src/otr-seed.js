'use strict';
/*
 * Sandbox only, once: the Over the Road history from Joe's own files (uploaded 10/8: "OTR Trips 2026.xlsx" and the August
 * accounting package plcomparisonsaugust.zip), read with the same rules as Import From Accounting (otrParseImport_) and kept in
 * seed/otr-import-2026-10.json. Monthly figures fill their months; a day count typed by hand is never replaced. The marker doc
 * otrSeed/<SEED_ID> makes it run one time; production never runs it (Joe imports there with the button).
 */
const { safeIdPart } = require('./model');

const SEED_ID = 'otr-import-2026-10';

async function seedOtrOnce(db, opts) {
  const o = opts || {}, now = o.now ? o.now() : new Date();
  const mark = db.collection('otrSeed').doc(SEED_ID);
  const go = await db.runTransaction(async tx => {
    const s = await tx.get(mark), d = s.exists ? s.data() : null;
    if (d && (d.status === 'DONE' || (d.status === 'RUNNING' && now - d.startedAt.toDate() < 10 * 60 * 1000))) return false;
    tx.set(mark, { status: 'RUNNING', startedAt: now });
    return true;
  });
  if (!go) return { skipped: true };
  const data = o.data || require('../seed/otr-import-2026-10.json');
  const typed = new Set();
  (await db.collection('otrDaily').where('source', '==', 'MANUAL').get()).forEach(d => typed.add(d.id));
  const months = {};
  data.figures.forEach(f => { const k = f.year + '-' + f.month; (months[k] = months[k] || { year: f.year, month: f.month })[f.key] = f.value; });
  const meta = { source: 'IMPORT', updatedAt: now, updatedBy: 'otr-history-import', testEdited: true };
  const w = db.bulkWriter();
  let nm = 0, nd = 0;
  Object.values(months).forEach(m => { nm++; w.set(db.collection('otrMonthly').doc(m.year + '-' + String(m.month).padStart(2, '0')), Object.assign({}, m, meta), { merge: true }); });
  data.daily.forEach(d => {
    const id = d.date + '__' + safeIdPart(d.destination);
    if (typed.has(id)) return;
    nd++;
    w.set(db.collection('otrDaily').doc(id), Object.assign({ date: d.date, destination: d.destination, runs: d.runs }, meta), { merge: true });
  });
  await w.close();
  await mark.set({ status: 'DONE', startedAt: now, doneAt: new Date(), months: nm, days: nd, keptTyped: typed.size });
  return { months: nm, days: nd };
}

module.exports = { seedOtrOnce, SEED_ID };
