'use strict';
/*
 * Joe 10/19 ("whenever I went to the plant distribution center, it took a while"; Yard Checks "really slow"): one small record
 * per run and day (runDays/{runDocId}__{day}), so Manager Center and Yard Checks read only the loads around today instead of
 * three whole weeks of runs. A run holds all seven days (about 9 KB with its sheet cells); these screens show one or two days.
 *
 * Each record is the run's route facts (everything but the seven days and the sheet cells) with that one day in days, plus
 * dates: every date from the day's load date (worked out from its offset, as L.loadBlocksFor does, and the Live sheet's own
 * load_date) through its delivery and departure dates. A screen asks for the records whose dates hold yesterday or today and
 * puts each run back together from them (public/js/recent-records.js watchLoads); every load, yard trailer, unload and return
 * those screens show for today comes from a day in that window, so what they show is the same.
 *
 * Kept up to date by a trigger on every write to a run (index.js runDaysOnRunWrite, re-reading the run so the newest wins) and
 * filled in for the three Live weeks by the copy (ensureWeeks: once, and again when the weeks move). Runs kept from the
 * DISPATCH WEEK HISTORY archive get none: no screen asks for those dates. Nothing in runs is changed or removed.
 */
const L = require('./logic');
const M = require('./model');

const COLLECTION = 'runDays';
const HISTORY_TAB = 'DISPATCH WEEK HISTORY';
const VERSION = 1;
// Left out: the seven days, the sheet's cells, and the copy's own stamps (they change on every copy, and no screen shows them).
const SKIP = ['days', 'cells', 'fingerprint', 'transferredAt'];

const docIdFor = (runDocId, prefix) => runDocId + '__' + prefix;

// The dates one day block is loaded, carried and delivered on.
function dayDates(run, prefix, day) {
  const i = L.DAYS.indexOf(prefix);
  if (i < 0 || !L.isDateKey(run.weekStart)) return [];
  const delivery = L.addDays(run.weekStart, i);
  const offset = day.loadDayOffset === null || day.loadDayOffset === undefined ? -1 : Number(day.loadDayOffset);
  const keys = [delivery, L.dateKey(day.deliveryDate), L.dateKey(day.departureDate), L.dateKey(day.loadDate), isFinite(offset) ? L.addDays(delivery, offset) : null]
    .filter(k => k && L.isDateKey(k)).sort();
  const out = [];
  // A load is never more than a week ahead of its delivery; a typo in a date is not allowed to fill the list.
  for (let k = keys[0]; k && k <= keys[keys.length - 1] && out.length < 10; k = L.addDays(k, 1)) out.push(k);
  return out;
}

// The records one run should have: {docId: data}. None for a run that is gone or comes from the archive.
function docsFor(runDocId, run) {
  const out = {};
  if (!run || run.sourceTab === HISTORY_TAB || !run.days) return out;
  const top = {};
  Object.keys(run).forEach(k => { if (SKIP.indexOf(k) < 0) top[k] = run[k]; });
  L.DAYS.forEach(prefix => {
    const day = run.days[prefix];
    if (!day) return;
    out[docIdFor(runDocId, prefix)] = Object.assign({}, top, { runDocId, day: prefix, dates: dayDates(run, prefix, day), days: { [prefix]: day } });
  });
  return out;
}

// Compared with keys in order: the database hands a record's fields back sorted, not in the order they were written.
const stable = (v) => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' && v.constructor === Object ? Object.keys(v).sort().reduce((o, k) => { o[k] = stable(v[k]); return o; }, {}) : v;
const same = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

// Brings one run's records in step with the run as it is now (read in the transaction, so the newest write always wins).
async function syncRun(db, runDocId) {
  const col = db.collection(COLLECTION);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(db.collection(M.COLLECTIONS.runs).doc(runDocId));
    const want = docsFor(runDocId, snap.exists ? snap.data() : null);
    const refs = L.DAYS.map(p => col.doc(docIdFor(runDocId, p)));
    const have = await tx.getAll(...refs);
    let written = 0;
    have.forEach((h, i) => {
      const id = refs[i].id, w = want[id];
      if (!w) { if (h.exists) { tx.delete(refs[i]); written++; } return; }
      if (!h.exists || !same(h.data(), w)) { tx.set(refs[i], w); written++; }
    });
    return written;
  });
}

// The three Live weeks: every run's records, once per set of weeks (meta/runDays says which weeks were done).
async function ensureWeeks(db, weeks) {
  const list = [...new Set((weeks || []).filter(L.isDateKey))].sort();
  if (!list.length) return { skipped: true };
  const markRef = db.collection('meta').doc(COLLECTION), mark = (await markRef.get()).data() || {};
  if (mark.version === VERSION && same(mark.weeks, list)) return { skipped: true };
  let runs = 0, written = 0;
  for (const w of list) {
    const [r, d] = await Promise.all([db.collection(M.COLLECTIONS.runs).where('weekStart', '==', w).get(), db.collection(COLLECTION).where('weekStart', '==', w).get()]);
    const have = {};
    d.docs.forEach(x => { have[x.id] = x.data(); });
    const ids = new Set(r.docs.map(x => x.id));
    for (const x of r.docs) {
      runs++;
      const want = docsFor(x.id, x.data());
      const ok = L.DAYS.every(p => { const id = docIdFor(x.id, p); return want[id] ? have[id] && same(have[id], want[id]) : !have[id]; });
      if (!ok) written += await syncRun(db, x.id);
    }
    // Records of a run no longer in that week (the run was removed): synced too, which removes them.
    for (const id of [...new Set(d.docs.map(x => x.data().runDocId))]) if (id && !ids.has(id)) written += await syncRun(db, id);
  }
  await markRef.set({ version: VERSION, weeks: list, at: new Date().toISOString(), runs, written });
  return { runs, written };
}

module.exports = { COLLECTION, VERSION, dayDates, docsFor, syncRun, ensureWeeks, docIdFor };
