/*
 * The Upload Center (Administration > Plant Setup > Upload Center; Joe 10/18, his pick B: one workbook for the whole plant).
 * Administrators only (admin.js adminCall). The rules are upload-rules.js, the same file the screen checks with.
 *
 *   uploadStatus  {plant}: the plants that can be loaded (every plant not yet live: Charleston, Martins Ferry), what is saved
 *                 for the plant, tab by tab (rows, when, by whom, from which file), and whether saving is on here.
 *   uploadSave    {plant, fileName, sheets}: reads and checks the file again on the server (the screen's check is not trusted),
 *                 refuses it while any row has a problem, then saves each filled tab's rows for the plant. A tab left empty in
 *                 the file keeps what is saved. Every save is logged in plantUploadLog.
 *
 * Where it is kept: plantUploads/<plant>__<tab>, one document per tab, the plant on every one, read only by the server. Then
 * the saved tabs fill that plant's own lists in that plant's own database (upload-apply.js: routes, drivers, days off, lines,
 * machines and the rest), the records its screens read. Nothing goes into Uniontown's lists, so a new plant's data never shows
 * on Uniontown's screens.
 *
 * The live app: saving needs Joe's OK naming the load, so on the live app (project ud-distribution) uploadSave refuses until an
 * Administrator turns it on for that plant (private/uploadsLive {plants: {<plant>: true}}), which nothing here does.
 */
'use strict';

const L = require('./logic');
const U = require('./upload-rules');
const { applyUploads } = require('./upload-apply');

// Errors are Administration's own (AdminError), so the screen gets the plain words.
const { fail } = require('./admin');
const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
const projectId = () => process.env.GCLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId;
const MAX_SHEETS = 40, MAX_CELLS = 400000;

// Every plant that is not live yet can be loaded here.
function loadablePlants() { return (L.PLANTS || []).filter(p => p.status !== 'ACTIVE').map(p => ({ id: p.id, name: p.name })); }
function plantOf(id) {
  const p = loadablePlants().find(x => x.id === text(id));
  if (!p) fail('BAD_REQUEST', 'Pick Charleston or Martins Ferry. Uniontown is already in the app.');
  return p;
}
const docId = (plant, tab) => plant + '__' + tab;

async function savedFor(db, plant) {
  const snaps = await db.getAll(...U.SPEC.map(t => db.collection('plantUploads').doc(docId(plant, t.key))));
  const saved = {}, tabs = {};
  snaps.forEach((s, i) => {
    const t = U.SPEC[i];
    if (!s.exists) return;
    const d = s.data();
    saved[t.key] = Array.isArray(d.rows) ? d.rows : [];
    tabs[t.key] = { count: saved[t.key].length, savedAt: d.savedAt || '', savedBy: d.savedBy || '', fileName: d.fileName || '' };
  });
  return { saved, tabs };
}
async function savingOn(db, plant, opts) {
  const project = (opts && opts.project) || projectId();
  if (project !== 'ud-distribution') return { on: true, live: false };
  const s = await db.collection('private').doc('uploadsLive').get();
  return { on: !!(s.exists && s.data().plants && s.data().plants[plant] === true), live: true };
}

async function uploadStatus(db, email, input, stamp, d) {
  const plants = loadablePlants();
  const plant = plants.some(p => p.id === text(input.plant)) ? text(input.plant) : (plants[0] || {}).id;
  if (!plant) return { plants, plant: '', tabs: {}, saved: {} };
  const [{ saved, tabs }, mode] = await Promise.all([savedFor(db, plant), savingOn(db, plant, d)]);
  return { plants, plant, tabs, saved, savingOn: mode.on, live: mode.live };
}

function cleanSheets(sheets) {
  if (!Array.isArray(sheets) || !sheets.length) fail('BAD_REQUEST', 'The file has no tabs.');
  if (sheets.length > MAX_SHEETS) fail('BAD_REQUEST', 'The file has too many tabs.');
  let cells = 0;
  return sheets.map(s => {
    const rows = Array.isArray(s && s.cells) ? s.cells : [];
    return { name: text(s && s.name).slice(0, 60), cells: rows.map(r => Array.isArray(r) ? r.slice(0, 60).map(c => { cells++; return text(c).slice(0, 400); }) : []) };
  }).map(s => { if (cells > MAX_CELLS) fail('BAD_REQUEST', 'The file is too big.'); return s; });
}

async function uploadSave(db, email, input, stamp, d) {
  const p = plantOf(input.plant);
  const mode = await savingOn(db, p.id, d);
  if (!mode.on) fail('NOT_ALLOWED', 'Saving uploads on the live app waits for Joe\'s OK for this load. The check above is still right; nothing was saved.');
  const sheets = cleanSheets(input.sheets);
  const { saved } = await savedFor(db, p.id);
  const result = U.check(U.readBook(sheets), saved);
  if (!Object.keys(result.tabs).length) fail('BAD_REQUEST', 'Nothing to save: every tab in the file is empty.');
  if (!result.ok) fail('BAD_REQUEST', 'Fix the ' + result.totals.PROBLEM + ' problem' + (result.totals.PROBLEM === 1 ? '' : 's') + ' first. Nothing was saved.');
  const rows = U.toSave(result), fileName = text(input.fileName).slice(0, 120), batch = db.batch();
  Object.keys(rows).forEach(k => {
    batch.set(db.collection('plantUploads').doc(docId(p.id, k)), { facilityId: p.id, tab: k, rows: rows[k], count: rows[k].length, fileName, savedAt: stamp, savedBy: email });
  });
  const counts = {};
  Object.keys(result.tabs).forEach(k => { counts[k] = result.tabs[k].counts; });
  batch.set(db.collection('plantUploadLog').doc(), { facilityId: p.id, fileName, at: stamp, by: email, totals: result.totals, counts });
  await batch.commit();
  // The plant's own screens: the saved tabs fill that plant's lists in its own database.
  const pdb = d && d.plantDb ? d.plantDb(p.id) : require('./plants').dbFor(p.id, db);
  const applied = pdb ? await applyUploads(db, pdb, p.id, (await savedFor(db, p.id)).saved, Object.keys(rows), { stamp, email })
    : { written: {}, notes: [], waiting: true };
  const t = result.totals, n = Object.keys(rows).length;
  return Object.assign(await uploadStatus(db, email, { plant: p.id }, stamp, d), {
    ok: true, applied: applied.written,
    message: p.name + ': ' + n + ' tab' + (n === 1 ? '' : 's') + ' saved (' + t.NEW + ' new, ' + t.CHANGED + ' changed, ' + t.SAME + ' the same, ' + t.OFF + ' taken off). ' +
      (applied.waiting ? p.name + '\'s screens fill from it once its database is made.' : p.name + '\'s screens now show them.') + (applied.notes.length ? ' ' + applied.notes.join(' ') : '')
  });
}

const OPS = { uploadStatus, uploadSave };

module.exports = { OPS, loadablePlants, savingOn };
