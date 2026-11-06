/*
 * Accounting Numbers (Joe 11-6-26: "a centralized app ... our main hub ... will draw the data in and store it in our Fire
 * Source. Then UDOP, that's where it will gather its information from that source. I have another cost analysis source that
 * needs information also").
 *
 * The monthly accounting package (a zip: P&L Expenses by Dept, Gallon Comparison, Dept Comparison, ...) is read ONCE, here,
 * with the same reader Over the Road's Import From Accounting uses (otr-core.js otrParseImport_), and each month's numbers are
 * kept in accountingMonthly/<yyyy-mm> in the company (Uniontown) database:
 *   {year, month, gallons_sold, distribution_cost, employee_cost, fuel_cost, file, source: 'EMAIL' | 'BY HAND', savedAt, savedBy}
 * Over the Road reads them from there (public/otr.html), and so does Joe's separate cost analysis app. Nothing else writes them.
 *
 * Two ways in, both on the Hub's Accounting Numbers screen (Administrators):
 *   - Add a file by hand: the screen sends the zip (or one workbook) and it is read here.
 *   - From email: once a day (accountingMailMornings, 6:00 AM) the mailbox set on the screen is read, read only
 *     (gmail.readonly, the same Google Workspace permission as Driver Check-In Email), for messages with a zip attached; each
 *     message is read once (accountingMail/<message id> remembers it).
 * Settings: config/accountingMail {enabled, mailbox, sender}. Last run: config/accountingMailLast.
 */
'use strict';

const OTR = require('./otr-core');
// The Excel and zip readers are big: loaded only when a file is read, so every other Administration step stays as quick.
let XLSX = null, JSZip = null;
const readers = () => { if (!XLSX) { XLSX = require('@e965/xlsx'); JSZip = require('jszip'); } };

const KEYS = ['gallons_sold', 'distribution_cost', 'employee_cost', 'fuel_cost'];
const MAX_BYTES = 15 * 1024 * 1024;
const EMAIL = /^[^\s@<>(),;:"[\]\\]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

// Administration's own error, so the screens get the words (src/admin.js, loaded when needed: admin.js loads this file).
const fail = (code, message) => require('./admin').fail(code, message);
const monthId = (y, m) => y + '-' + String(m).padStart(2, '0');

// Dates as local midnight, the way the browser import (public/otr.html readImport) gives them.
function sheetValues(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', blankrows: true })
    .map(row => row.map(v => v instanceof Date ? new Date(v.getFullYear(), v.getMonth(), v.getDate() + (v.getHours() >= 12 ? 1 : 0)) : v));
}

/** Reads a zip (or one .xls / .xlsx) and returns {months: [{year, month, <keys>}], tabs: [...]} with only the four numbers. */
async function readPackage(buffer, fileName, yearNow) {
  if (!buffer || !buffer.length) fail('BAD_REQUEST', 'The file is empty');
  if (buffer.length > MAX_BYTES) fail('BAD_REQUEST', 'The file is too big (more than 15 MB)');
  const name = String(fileName || 'file');
  readers();
  let books = [{ name, data: buffer }];
  if (/\.zip$/i.test(name)) {
    const zip = await JSZip.loadAsync(buffer);
    const names = Object.keys(zip.files).filter(n => /\.xlsx?$/i.test(n) && !/^__MACOSX\//.test(n) && !zip.files[n].dir);
    if (names.length > 30) fail('BAD_REQUEST', 'The zip holds too many files');
    books = [];
    for (const n of names) books.push({ name: n, data: await zip.files[n].async('nodebuffer') });
  } else if (!/\.xlsx?$/i.test(name)) fail('BAD_REQUEST', 'Pick the accounting zip, or one Excel workbook');
  const parts = [];
  for (const b of books) {
    let wb;
    try { wb = XLSX.read(b.data, { type: 'buffer', cellDates: true }); } catch (e) { continue; }
    wb.SheetNames.forEach(tab => {
      const m = (tab + ' ' + b.name).match(/(20\d{2})/);
      const parsed = OTR.otrParseImport_(sheetValues(wb.Sheets[tab]), m ? Number(m[1]) : yearNow, tab);
      parsed.tab = b.name.replace(/^.*\//, '') + ' · ' + String(tab).trim();
      parts.push(parsed);
    });
  }
  const merged = OTR.otrMergeImport_(parts), byMonth = {};
  merged.figures.filter(f => KEYS.indexOf(f.key) >= 0).forEach(f => {
    const id = monthId(f.year, f.month);
    (byMonth[id] = byMonth[id] || { year: f.year, month: f.month })[f.key] = f.value;
  });
  const months = Object.keys(byMonth).sort().map(k => byMonth[k]);
  return { months, tabs: merged.tabs.filter(t => t.kind !== 'UNKNOWN').map(t => t.tab) };
}

/** Saves the months read from one file. A month's numbers are replaced only where the file has them. */
async function saveMonths(db, read, how) {
  const col = db.collection('accountingMonthly'), changed = [];
  const ids = read.months.map(m => monthId(m.year, m.month));
  const had = {};
  for (let i = 0; i < ids.length; i += 300) {
    const snaps = await db.getAll(...ids.slice(i, i + 300).map(id => col.doc(id)));
    snaps.forEach(s => { had[s.id] = s.exists ? s.data() : null; });
  }
  for (let i = 0; i < read.months.length; i += 400) {
    const batch = db.batch();
    read.months.slice(i, i + 400).forEach(m => {
      const id = monthId(m.year, m.month), old = had[id];
      const differs = KEYS.some(k => m[k] != null && (!old || old[k] == null || Math.abs(Number(old[k]) - m[k]) >= 0.005));
      if (!differs) return;
      changed.push(id);
      batch.set(col.doc(id), Object.assign({}, m, { file: String(how.file || '').slice(0, 120), source: how.source, savedAt: how.stamp, savedBy: how.by }), { merge: true });
    });
    await batch.commit();
  }
  const label = (id) => { const [y, m] = id.split('-'); return OTR.OTR_CORE.MONTHS[Number(m) - 1] + ' ' + y; };
  const newest = ids.length ? label(ids[ids.length - 1]) : '';
  return { months: ids.length, changed: changed.length, newest, changedMonths: changed.slice(-6).map(label) };
}

const settingsRef = (db) => db.collection('config').doc('accountingMail');
const lastRef = (db) => db.collection('config').doc('accountingMailLast');

async function status(db) {
  const [s, last, list] = await Promise.all([settingsRef(db).get(), lastRef(db).get(), db.collection('accountingMonthly').get()]);
  const settings = Object.assign({ enabled: false, mailbox: '', sender: '' }, s.exists ? s.data() : {});
  return { settings: { enabled: !!settings.enabled, mailbox: settings.mailbox || '', sender: settings.sender || '' },
    last: last.exists ? last.data() : null,
    months: list.docs.map(d => d.data()).sort((a, b) => b.year - a.year || b.month - a.month).slice(0, 36) };
}

async function saveSettings(db, email, input, stamp) {
  const mailbox = String(input.mailbox || '').trim().toLowerCase(), sender = String(input.sender || '').trim().toLowerCase();
  if (mailbox && !EMAIL.test(mailbox)) fail('BAD_REQUEST', 'The mailbox is not an email address');
  if (sender && !EMAIL.test(sender) && !/^@?[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(sender)) fail('BAD_REQUEST', 'The sender is not an email address');
  if (input.enabled && !mailbox) fail('BAD_REQUEST', 'Type the mailbox first');
  await settingsRef(db).set({ enabled: !!input.enabled, mailbox, sender, savedAt: stamp, savedBy: email });
  return status(db);
}

async function upload(db, email, input, stamp) {
  const name = String(input.fileName || '').slice(0, 120);
  const buf = Buffer.from(String(input.base64 || ''), 'base64');
  const read = await readPackage(buf, name, Number(stamp.slice(0, 4)));
  if (!read.months.length) fail('BAD_REQUEST', 'No accounting numbers were found in ' + name + '. Use the accounting package zip (P&L Expenses by Dept, Gallon Comparison).');
  const saved = await saveMonths(db, read, { file: name, source: 'BY HAND', stamp, by: email });
  return Object.assign({ saved, file: name }, await status(db));
}

/*
 * The email check. deps: readMail, readAttachment (src/mail.js), now. Reads the last 45 days of messages with a zip attached
 * (only from the sender, when one is set); a message already read is skipped.
 */
async function checkMail(db, by, deps) {
  const d = deps || {}, now = d.now ? d.now() : new Date(), stamp = now.toISOString();
  const s = (await status(db)).settings;
  const run = { at: stamp, by, status: 'OK', read: 0, saved: 0, skipped: 0, files: [] };
  if (!s.mailbox) { run.status = 'OFF'; run.message = 'No mailbox is set.'; await lastRef(db).set(run); return run; }
  const MAIL = require('./mail');
  const readMail = d.readMail || MAIL.readMail, readAttachment = d.readAttachment || MAIL.readAttachment;
  try {
    const query = 'has:attachment filename:zip newer_than:45d' + (s.sender ? ' from:' + s.sender.replace(/^@/, '') : '');
    const messages = await readMail({ owner: s.mailbox, query, max: 20 });
    for (const m of messages.sort((a, b) => a.internalDate - b.internalDate)) {
      const seen = db.collection('accountingMail').doc(String(m.id).replace(/[^A-Za-z0-9_-]/g, '_'));
      if ((await seen.get()).exists) { run.skipped++; continue; }
      const zips = (m.files || []).filter(f => /\.zip$/i.test(f.name) && f.size <= MAX_BYTES);
      const found = [];
      for (const f of zips) {
        run.read++;
        try {
          const buf = await readAttachment({ owner: s.mailbox, messageId: m.id, attachmentId: f.attachmentId });
          const read = await readPackage(buf, f.name, now.getFullYear());
          if (!read.months.length) { found.push({ name: f.name, months: 0 }); continue; }
          const saved = await saveMonths(db, read, { file: f.name, source: 'EMAIL', stamp, by: 'email:' + s.mailbox });
          run.saved += saved.changed;
          found.push({ name: f.name, months: saved.months, changed: saved.changed, newest: saved.newest });
        } catch (e) { found.push({ name: f.name, error: String(e.message || e).slice(0, 200) }); }
      }
      run.files.push(...found.map(x => Object.assign({ received: new Date(m.internalDate || now).toISOString() }, x)));
      // A file Gmail or the reader could not finish is tried again next time.
      if (found.some(x => x.error)) { run.status = 'FAIL'; continue; }
      await seen.set({ at: stamp, subject: String(m.subject || '').slice(0, 200), from: String(m.from || '').slice(0, 120), files: found });
    }
    const newest = run.files.filter(f => f.newest).pop();
    const bad = run.files.find(f => f.error);
    run.message = bad ? 'Could not read ' + bad.name + ': ' + bad.error : run.files.length ? run.files.length + ' new file' + (run.files.length === 1 ? '' : 's') + ' read' + (newest ? '; newest month ' + newest.newest : '') + '.' : 'No new accounting zip.';
  } catch (e) {
    run.status = 'FAIL';
    run.message = e.code === 'NOT_DELEGATED'
      ? 'Google Workspace has not yet let the app read this mailbox. IT adds the scope https://www.googleapis.com/auth/gmail.readonly to the app\'s domain-wide delegation (same Client ID as email sending).'
      : String(e.message || e).slice(0, 300);
  }
  await lastRef(db).set(run);
  return run;
}

// The scheduled check: only when it is switched on.
async function morningCheck(db, deps) {
  const s = (await status(db)).settings;
  if (!s.enabled) return { skipped: 'off' };
  return checkMail(db, 'every morning', deps);
}

// Administration steps (src/admin.js): Administrators only, checked there. Company-wide (Uniontown's database).
const OPS = {
  accountingStatus: (db) => status(db),
  accountingSaveSettings: (db, email, input, stamp) => saveSettings(db, email, input, stamp),
  accountingUpload: (db, email, input, stamp) => upload(db, email, input, stamp),
  accountingCheckNow: async (db, email, input, stamp, d) => Object.assign({ run: await checkMail(db, email, d) }, await status(db))
};

module.exports = { OPS, readPackage, saveMonths, status, checkMail, morningCheck, KEYS };
