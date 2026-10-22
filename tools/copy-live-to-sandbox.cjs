'use strict';
/*
 * Joe 10/22 ("copy the live data that we have now into the sandbox version"): copies the live app's database into the
 * practice copy, so the full practice test runs on today's real data.
 *
 * - Live is only READ (list collections, read documents). Nothing on live is written, deleted or changed.
 * - Writes go to the practice copy only; the script stops unless the target is ud-distribution-sandbox.
 * - Before anything is written, the practice copy's email Sending switch is turned OFF, and it is turned OFF again at the end
 *   (the live email settings are not copied over it). Texts never go out from the practice copy (no LIVE_TEXTS there).
 * - The practice copy's own secrets (Twilio, GPS, MOCREO, RedZone logins) and locks are kept, not replaced by live's.
 * - Practice-copy documents that live does not have are removed, so the screens match live; everything removed is in the
 *   backup file first (BACKUP, one JSON line per document), which `node copy-live-to-sandbox.cjs restore <file>` puts back.
 * - The practice copy keeps its own one-time markers (dataLoads, otrSeed) and its own write-back queues (outbox, masterOutbox).
 *
 * Env: SRC_KEY / DST_KEY = service-account key files (live / practice copy), BACKUP = backup file path.
 */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const fnRequire = require('module').createRequire(path.join(__dirname, '..', 'functions', 'package.json'));
const admin = fnRequire('firebase-admin');
const { getFirestore, Timestamp, GeoPoint, DocumentReference, FieldPath } = fnRequire('firebase-admin/firestore');

const SANDBOX = 'ud-distribution-sandbox';
const KEEP_SANDBOX_COLLECTIONS = new Set(['dataLoads', 'otrSeed', 'outbox', 'masterOutbox']);
const KEEP_SANDBOX_PRIVATE = new Set(['sms', 'gps', 'gpsProbe', 'mocreo', 'redzone', 'readDevices', 'uploadsLive', 'publishLock', 'archiveLock', 'repairSweepLock']);
const PAGE = 1000;

function app(keyFile, name) {
  const key = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  const a = admin.initializeApp({ credential: admin.credential.cert(key), projectId: key.project_id }, name);
  return { db: getFirestore(a), project: key.project_id };
}

// A document's fields, with references pointed at the practice copy.
function forTarget(v, dst) {
  if (v instanceof DocumentReference) return dst.doc(v.path);
  if (v instanceof Timestamp || v instanceof GeoPoint || Buffer.isBuffer(v) || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(x => forTarget(x, dst));
  const o = {};
  Object.keys(v).forEach(k => { o[k] = forTarget(v[k], dst); });
  return o;
}

// One JSON line per document for the backup, with Firestore types tagged so restore can rebuild them.
function enc(v) {
  if (v instanceof DocumentReference) return { __ref: v.path };
  if (v instanceof Timestamp) return { __ts: [v.seconds, v.nanoseconds] };
  if (v instanceof GeoPoint) return { __geo: [v.latitude, v.longitude] };
  if (Buffer.isBuffer(v)) return { __bytes: v.toString('base64') };
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(enc);
  const o = {};
  Object.keys(v).forEach(k => { o[k] = enc(v[k]); });
  return o;
}
function dec(v, db) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(x => dec(x, db));
  if (v.__ref) return db.doc(v.__ref);
  if (v.__ts) return new Timestamp(v.__ts[0], v.__ts[1]);
  if (v.__geo) return new GeoPoint(v.__geo[0], v.__geo[1]);
  if (v.__bytes) return Buffer.from(v.__bytes, 'base64');
  const o = {};
  Object.keys(v).forEach(k => { o[k] = dec(v[k], db); });
  return o;
}

// Every document of a collection, a page at a time (live: reads only).
async function eachDoc(col, fn) {
  let last = null, n = 0;
  for (;;) {
    let q = col.orderBy(FieldPath.documentId()).limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await again(() => q.get());
    for (const d of snap.docs) { await fn(d); n++; }
    if (snap.size < PAGE) return n;
    last = snap.docs[snap.docs.length - 1];
  }
}

// A read tried again a few times when Google refuses it for a moment (new access can take minutes to reach every part).
// The collections the app's code names, for when Google will not list them (listing needs more than reading).
function namedCollections() {
  const names = new Set(Object.values(require(path.join(__dirname, '..', 'functions', 'src', 'model.js')).COLLECTIONS || {}));
  const scan = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules|vendor|test/.test(e.name)) scan(f); return; }
    if (!/\.(js|html)$/.test(e.name)) return;
    const t = fs.readFileSync(f, 'utf8');
    for (const m of t.matchAll(/collection(?:Group)?\(\s*(?:db\s*,\s*)?'([A-Za-z][A-Za-z0-9_]*)'/g)) names.add(m[1]);
  });
  ['functions/src', 'functions/index.js', 'public'].forEach(d => { const f = path.join(__dirname, '..', d); if (fs.statSync(f).isDirectory()) scan(f); else { const t = fs.readFileSync(f, 'utf8'); for (const m of t.matchAll(/collection\(\s*'([A-Za-z][A-Za-z0-9_]*)'/g)) names.add(m[1]); } });
  return [...names].sort();
}
async function collectionsOf(db) {
  try { return await again(() => db.listCollections(), 3); } catch (e) {
    console.log('Google would not list the collections; using the ' + namedCollections().length + ' the code names');
    return namedCollections().map(n => db.collection(n));
  }
}
async function again(fn, tries) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= (tries || 8) || !/PERMISSION_DENIED|UNAVAILABLE|DEADLINE/.test(String(e.message))) throw e;
      console.log('Read refused for a moment (' + String(e.message).slice(0, 60) + '), trying again in 30 seconds');
      await new Promise(r => setTimeout(r, 30000));
    }
  }
}

async function emailOff(dst, note) {
  await dst.collection('private').doc('emailSettings').set({ sending: false, changedAt: new Date().toISOString(), changedBy: note }, { merge: true });
}

async function copy() {
  const src = app(process.env.SRC_KEY, 'live');
  const dst = app(process.env.DST_KEY, 'practice');
  if (dst.project !== SANDBOX) throw new Error('The target must be the practice copy (' + SANDBOX + '), not ' + dst.project);
  if (src.project === dst.project) throw new Error('Live and the practice copy are the same project');
  console.log('Copying ' + src.project + ' (read only) into ' + dst.project);

  await emailOff(dst.db, 'Practice copy test: Sending OFF before copying live data');
  console.log('Practice copy email Sending: OFF');

  // 1. Back up the practice copy as it is now.
  const out = zlib.createGzip();
  out.pipe(fs.createWriteStream(process.env.BACKUP));
  const before = {};
  const backupCol = async (col) => {
    before[col.path] = new Set();
    await eachDoc(col, async d => { before[col.path].add(d.id); out.write(JSON.stringify({ p: d.ref.path, d: enc(d.data()) }) + '\n'); });
  };
  // Top-level collections only: the app keeps no collections under documents.
  const dstCols = await collectionsOf(dst.db);
  for (const c of dstCols) await backupCol(c);
  await new Promise(r => out.end(r));
  console.log('Practice copy backed up: ' + Object.values(before).reduce((a, s) => a + s.size, 0) + ' documents in ' + Object.keys(before).length + ' collections');

  // 2. Copy every live document over.
  const writer = dst.db.bulkWriter();
  writer.onWriteError(e => e.failedAttempts < 5);
  const seen = {};
  const counts = {};
  const copyCol = async (col) => {
    const name = col.path;
    if (KEEP_SANDBOX_COLLECTIONS.has(name)) { counts[name] = 'kept practice copy own'; return; }
    seen[name] = new Set();
    let n = 0, skipped = 0;
    await eachDoc(col, async d => {
      seen[name].add(d.id);
      if (name === 'private' && (KEEP_SANDBOX_PRIVATE.has(d.id) || d.id === 'emailSettings')) { skipped++; return; }
      writer.set(dst.db.doc(d.ref.path), forTarget(d.data(), dst.db));
      n++;
    });
    counts[name] = n + (skipped ? ' (' + skipped + ' practice-copy settings kept)' : '');
  };
  const srcCols = await collectionsOf(src.db);
  for (const c of srcCols) await copyCol(c);
  await writer.flush();

  // Live's email senders (who email comes from) without its Sending switch.
  const liveMail = (await again(() => src.db.collection('private').doc('emailSettings').get())).data() || {};
  const mail = Object.assign({}, liveMail);
  delete mail.sending;
  await dst.db.collection('private').doc('emailSettings').set(forTarget(mail, dst.db), { merge: true });

  // 3. Take off practice-copy documents live does not have (they are in the backup).
  let removed = 0;
  for (const name of Object.keys(before)) {
    const top = name.split('/')[0];
    if (KEEP_SANDBOX_COLLECTIONS.has(top)) continue;
    const keep = seen[name] || new Set();
    for (const id of before[name]) {
      if (keep.has(id)) continue;
      if (name === 'private') continue;
      writer.delete(dst.db.doc(name + '/' + id));
      removed++;
    }
  }
  await writer.close();
  await emailOff(dst.db, 'Practice copy test: Sending OFF after copying live data');

  console.log('Copied from live, by collection:');
  Object.keys(counts).sort().forEach(k => console.log('  ' + k + ': ' + counts[k]));
  console.log('Practice-copy documents live does not have, taken off: ' + removed);
  console.log('Practice copy email Sending: OFF');
}

async function restore(file) {
  const dst = app(process.env.DST_KEY, 'practice');
  if (dst.project !== SANDBOX) throw new Error('Restore only into the practice copy');
  const lines = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').split('\n').filter(Boolean);
  const writer = dst.db.bulkWriter();
  lines.forEach(l => { const x = JSON.parse(l); writer.set(dst.db.doc(x.p), dec(x.d, dst.db)); });
  await writer.close();
  console.log('Restored ' + lines.length + ' documents into the practice copy');
}

(process.argv[2] === 'restore' ? restore(process.argv[3]) : copy()).then(() => process.exit(0), e => { console.error(e); process.exit(1); });
