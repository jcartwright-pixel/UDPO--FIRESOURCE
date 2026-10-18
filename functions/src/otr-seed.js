'use strict';
/*
 * Sandbox only, once: the Over the Road history from Joe's own files (uploaded 10/8: "OTR Trips 2026.xlsx" and the August
 * accounting package plcomparisonsaugust.zip), read with the same rules as Import From Accounting (otrParseImport_) and kept in
 * seed/otr-import-2026-10.json, with the By Date Comment column. Monthly figures fill their months; a day count or comment typed
 * by hand is never replaced. The marker doc otrSeed/<SEED_ID> makes it run one time; production never runs it (Joe imports there
 * with the Import Workbook button).
 *
 * OTR Routes Setup (seedOtrRoutesOnce, Joe 10/13: "I thought I've gave you data twice"): which Route Master runs are his OTR runs and
 * their By Date column, read from his workbook's columns against Route Master (Save-A-Lot 1-3 are SAL, Jersey Load 1 and 2 are
 * Jersey, Pals Shake Mix on 847 is Reinhart...). A run someone already set by hand is left as it is.
 */
const { safeIdPart } = require('./model');

// -b: the same history plus the By Date comments (the first run had no comments).
const SEED_ID = 'otr-import-2026-10b';

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
  const typedNotes = new Set();
  (await db.collection('otrComments').where('source', '==', 'MANUAL').get()).forEach(d => typedNotes.add(d.id));
  const months = {};
  data.figures.forEach(f => { const k = f.year + '-' + f.month; (months[k] = months[k] || { year: f.year, month: f.month })[f.key] = f.value; });
  const meta = { source: 'IMPORT', updatedAt: now, updatedBy: 'otr-history-import', testEdited: o.testEdited !== false };
  const w = db.bulkWriter();
  let nm = 0, nd = 0, nc = 0;
  Object.values(months).forEach(m => { nm++; w.set(db.collection('otrMonthly').doc(m.year + '-' + String(m.month).padStart(2, '0')), Object.assign({}, m, meta), { merge: true }); });
  data.daily.forEach(d => {
    const id = d.date + '__' + safeIdPart(d.destination);
    if (typed.has(id)) return;
    nd++;
    w.set(db.collection('otrDaily').doc(id), Object.assign({ date: d.date, destination: d.destination, runs: d.runs }, meta), { merge: true });
  });
  (data.comments || []).forEach(c => {
    if (typedNotes.has(c.date)) return;
    nc++;
    w.set(db.collection('otrComments').doc(c.date), Object.assign({ date: c.date, text: c.text }, meta), { merge: true });
  });
  await w.close();
  await mark.set({ status: 'DONE', startedAt: now, doneAt: new Date(), months: nm, days: nd, comments: nc, keptTyped: typed.size + typedNotes.size });
  return { months: nm, days: nd, comments: nc };
}

// Route Master run ids -> By Date column. All are United Dairy routes (Route Master movement_type COMPANY_ROUTE). Left out on purpose:
// Ferry Jug (Ferry counts follow Product 1 and 2: two on Tuesdays), Katies Corner and Chill Solutions (stops on the 845 Baltimore
// trip, counted once as I/W), the Charleston ALDI loads and the Fairmont, Charleston and other branch transfers (daily runs his
// workbook does not count).
const OTR_ROUTES = [
  ['run_6b2007de2c62a8ca0018', 'SAL'], ['run_b33d03ac982e86561416', 'SAL'], ['run_5dce9546e1d7f4bdc9d7', 'SAL'],
  ['run_74ae54278592ceab2fba', 'Jersey'], ['run_0a6507d00b3fdcbefa24', 'Jersey'],
  ['run_295585a5f3a73003e214', 'Reinhart'], ['run_a5f814344970134f6532', 'J&J Snacks'], ['run_ae63621bea9dfa9ec0bd', 'Garber'],
  ['run_fb834e9c39644d5e5750', 'Cream-O-Land'], ['run_734eaaabd7df6f678dcf', 'Lancaster'],
  ['run_6fcf556e3a5172752ddb', 'Ferry'], ['run_bf527bd4da07a400b326', 'Ferry'], ['run_4ebab0bd8a1aa00ce0b7', 'Peck'],
  ['run_e8a8c8eb161f9d02efa6', 'CostCo'], ['run_dbb0d7c7f574708d3488', 'CostCo'], ['run_a6474eb8518ac1427e7c', 'I/W Columbus'],
  ['run_8ba43705c52934827f8e', 'I/W'], ['run_800d9412f5665980418b', 'OH Processors'], ['run_f1d571d5ae46c6115035', 'Totally Cool'],
  ['run_3b3a5965b0be191b9118', 'Ventura Foods'], ['run_66629c86dd54bcb6f21f', 'USDA'], ['run_ef7218709a61305958e3', 'Sun Valley']
];
const ROUTES_SEED_ID = 'otr-routes-2026-10-13';

async function seedOtrRoutesOnce(db, opts) {
  const o = opts || {}, now = o.now ? o.now() : new Date(), list = o.routes || OTR_ROUTES;
  const mark = db.collection('otrSeed').doc(ROUTES_SEED_ID);
  if ((await mark.get()).exists) return { skipped: true };
  const refs = list.map(r => db.collection('otrRoutes').doc(safeIdPart(r[0])));
  const snaps = await db.getAll(...refs);
  const batch = db.batch();
  let set = 0, kept = 0;
  list.forEach((r, i) => {
    const old = snaps[i].exists ? snaps[i].data() : null;
    if (old && (old.include || old.deliveredBy)) { kept++; return; }
    set++;
    batch.set(refs[i], { runId: r[0], include: true, destination: r[1], deliveredBy: 'United Dairy Delivered', updatedAt: now.toISOString(), updatedBy: 'otr-routes-from-workbook' }, { merge: true });
  });
  batch.set(mark, { status: 'DONE', doneAt: now, set, kept });
  await batch.commit();
  return { set, kept };
}

module.exports = { seedOtrOnce, SEED_ID, seedOtrRoutesOnce, ROUTES_SEED_ID, OTR_ROUTES };
