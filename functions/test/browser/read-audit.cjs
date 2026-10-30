'use strict';
/*
 * Read audit (Joe 10/29: "I want to check for writes and reads. Make sure we're not doing any double work").
 * Opens every screen of screen-timings.cjs against the local test database, signed in as the test administrator, and notes
 * every database read the screen starts: what it reads (the record or the list and its filters), how many records each answer
 * held, how often a live read answered, and every server call. It then lists the double work:
 *   twice   the same record or the same list read more than once by one screen while it opens;
 *   whole   a list read with no filter and no limit (it grows with the database);
 *   chatty  a live read that answered more than 5 times while nothing was being changed.
 * Not part of npm run test:browser (it measures, it does not pass or fail). Usage, inside the emulators:
 *   node test/browser/read-audit.cjs [out.json]      Env: ONLY=page.html,... to pick screens; REAL=1 for real-size weeks.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');
const L = require('../../src/logic');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const OUT = process.argv[2] || '';
const WHO = 'testEmail=admin.test@uniteddairy.com';
const SETTLE = Number(process.env.SETTLE || 6000);
// The screens screen-timings.cjs times, read from that file so the two lists never differ.
const SCREENS = eval(fs.readFileSync(path.join(__dirname, 'screen-timings.cjs'), 'utf8').match(/const SCREENS = (\[[\s\S]*?\]);\n/)[1]);

// firebase.js with each read noted in window.__aud (what, filters, answers, records per answer).
const FIREBASE_JS = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'public', 'js', 'firebase.js'), 'utf8') + `
const __A = window.__aud = window.__aud || { reads: [] };
function __desc(ref) {
  try {
    if (ref.type === 'document') return { kind: 'doc', path: ref.path };
    const q = ref._query || {};
    const path = (q.path && q.path.segments || []).join('/') + (q.collectionGroup ? '{group:' + q.collectionGroup + '}' : '');
    const val = (v) => { if (!v) return v; if ('stringValue' in v) return v.stringValue; if ('integerValue' in v) return v.integerValue; if ('booleanValue' in v) return v.booleanValue; if ('arrayValue' in v) return (v.arrayValue.values || []).map(val); if ('timestampValue' in v) return v.timestampValue; if ('nullValue' in v) return null; if ('doubleValue' in v) return v.doubleValue; return JSON.stringify(v); };
    const flat = (f) => f.filters ? f.filters.map(flat).join(' ' + (f.op || 'and') + ' ') : (f.field ? f.field.segments.join('.') : '?') + f.op + JSON.stringify(val(f.value));
    const filters = (q.filters || []).map(flat);
    const order = (q.explicitOrderBy || []).map(o => o.field.segments.join('.') + ' ' + o.dir);
    return { kind: 'list', path, filters, order, limit: q.limit === null || q.limit === undefined ? null : q.limit };
  } catch (e) { return { kind: '?', path: '?' }; }
}
function __note(how, ref) { const r = Object.assign({ how, at: Math.round(performance.now()), answers: 0, sizes: [], stopped: null }, __desc(ref)); __A.reads.push(r); return r; }
const __size = (s) => (s && typeof s.size === 'number') ? s.size : (s && typeof s.exists === 'function' ? (s.exists() ? 1 : 0) : 0);
const __on = onSnapshot;
const __gd = getDoc, __gds = getDocs, __gdl = getDocsLater;
export { __on as __onSnapshotUnused };
`;
// The exported functions are replaced in the text (the module's own exports must stay its own names).
function auditedFirebase() {
  let t = FIREBASE_JS;
  t = t.replace('export function onSnapshot(ref, ...rest) {\n  const end = begin(ref);', 'export function onSnapshot(ref, ...rest) {\n  const end = begin(ref); const __r = __note("live", ref);');
  t = t.replace("rest[at] = (s) => { try { next(s); } finally { end(); } };", "rest[at] = (s) => { __r.answers++; if (__r.sizes.length < 40) __r.sizes.push(__size(s)); try { next(s); } finally { end(); } };");
  t = t.replace("next: (s) => { try { if (obs.next) obs.next(s); } finally { end(); } },", "next: (s) => { __r.answers++; if (__r.sizes.length < 40) __r.sizes.push(__size(s)); try { if (obs.next) obs.next(s); } finally { end(); } },");
  t = t.replace('return () => { end(); stop(); };', 'return () => { __r.stopped = Math.round(performance.now()); end(); stop(); };');
  t = t.replace('export function getDoc(ref) { const end = begin(ref); return fsGetDoc(ref).finally(end); }', 'export function getDoc(ref) { const end = begin(ref); const __r = __note("once", ref); return fsGetDoc(ref).then(s => { __r.answers++; __r.sizes.push(__size(s)); return s; }).finally(end); }');
  t = t.replace('export function getDocs(q) { const end = begin(q); return fsGetDocs(q).finally(end); }', 'export function getDocs(q) { const end = begin(q); const __r = __note("once", q); return fsGetDocs(q).then(s => { __r.answers++; __r.sizes.push(__size(s)); return s; }).finally(end); }');
  t = t.replace('export function getDocsLater(q) { return fsGetDocs(q); }', 'export function getDocsLater(q) { const __r = __note("later", q); return fsGetDocs(q).then(s => { __r.answers++; __r.sizes.push(__size(s)); return s; }); }');
  if ((t.match(/__note\(/g) || []).length < 5) throw new Error('firebase.js changed: the read audit could not hook its reads');
  return t;
}

async function seed() {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  if (!process.env.REAL) return;
  const d = db(), runs = (await d.collection('runs').where('weekStart', '==', '2026-10-04').get()).docs.map(x => x.data());
  const today = L.operatingDay(new Date()), wk = L.weekStart(today);
  let batch = d.batch(), n = 0;
  for (const target of [L.addDays(wk, -7), wk, L.addDays(wk, 7)]) {
    const shift = L.daysBetween('2026-10-04', target);
    for (let i = 0; i < 80; i++) {
      const run = JSON.parse(JSON.stringify(runs[i % runs.length]).replace(/"(\d{4}-\d{2}-\d{2})/g, (m, k) => '"' + L.addDays(k, shift)));
      Object.assign(run, { weekStart: target, route: String(1000 + i), runId: 'run_real' + i, routeId: 'rte_real' + i, sheetRow: 10 + i });
      batch.set(d.collection('runs').doc(target + '__run_real' + i), run);
      if (++n % 400 === 0) { await batch.commit(); batch = d.batch(); }
    }
  }
  await batch.commit();
}

const keyOf = (r) => r.kind + ' ' + r.path + (r.filters && r.filters.length ? ' where ' + r.filters.join(', ') : '') + (r.order && r.order.length ? ' order ' + r.order.join(',') : '') + (r.limit ? ' limit ' + r.limit : '');

(async () => {
  await seed();
  const browser = await chromium.launch();
  const firebase = auditedFirebase();
  const rows = [];
  const only = (process.env.ONLY || '').split(',').filter(Boolean);
  for (const [name, url] of SCREENS.filter(([, u]) => !only.length || only.includes(u.split(/[?#]/)[0]))) {
    const ctx = await browser.newContext({ viewport: { width: 1536, height: 730 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
      route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
    });
    await page.route(/\/js\/firebase\.js(\?.*)?$/, (route) => route.fulfill({ contentType: 'text/javascript', body: firebase }));
    const calls = [];
    page.on('request', r => { const m = r.url().match(/:5001\/[^/]+\/[^/]+\/([A-Za-z0-9]+)/); if (m) { let op = ''; try { const b = JSON.parse(r.postData() || '{}'); op = (b.data && (b.data.op || b.data.action || b.data.kind)) || ''; } catch (e) { /* not JSON */ } calls.push(m[1] + (op ? ':' + op : '')); if (process.env.SHOW_CALLS) console.log('CALL', m[1], (r.postData() || '').slice(0, 400)); } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const [bare, hash] = url.split('#');
    let reads = [];
    try {
      await page.goto(HOSTING + '/' + bare + (bare.includes('?') ? '&' : '?') + WHO + (hash ? '#' + hash : ''), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(SETTLE);
      // Reads of every frame (Administration opens its items inside a frame).
      for (const f of page.frames()) { try { reads = reads.concat(await f.evaluate(() => (window.__aud && window.__aud.reads || []).map(r => Object.assign({ frame: location.pathname.split('/').pop() }, r)))); } catch (e) { /* gone */ } }
    } catch (e) { errors.push('open: ' + e.message); }
    await ctx.close();
    const byKey = {};
    reads.forEach(r => { const k = r.frame + ' ' + keyOf(r); (byKey[k] = byKey[k] || []).push(r); });
    const twice = Object.entries(byKey).filter(([, a]) => a.length > 1).map(([k, a]) => ({ what: k, times: a.length, live: a.filter(x => x.how === 'live').length, overlapping: a.filter(x => x.how === 'live' && x.stopped === null).length }));
    const whole = reads.filter(r => r.kind === 'list' && !(r.filters || []).length && !r.limit).map(r => ({ what: r.frame + ' ' + keyOf(r), records: Math.max(0, ...r.sizes) }));
    const chatty = reads.filter(r => r.how === 'live' && r.answers > 5).map(r => ({ what: r.frame + ' ' + keyOf(r), answers: r.answers }));
    const records = reads.reduce((n, r) => n + r.sizes.reduce((a, b) => a + b, 0), 0);
    const callCount = {}; calls.forEach(c => { callCount[c] = (callCount[c] || 0) + 1; });
    const row = { name, url, reads: reads.length, records, calls, twiceCalls: Object.entries(callCount).filter(([, n]) => n > 1), twice, whole, chatty, errors, all: reads.map(r => ({ how: r.how, what: r.frame + ' ' + keyOf(r), answers: r.answers, sizes: r.sizes.slice(0, 6) })) };
    rows.push(row);
    console.log(name.padEnd(28), 'reads', String(row.reads).padStart(3), 'records', String(records).padStart(5), 'twice', twice.length, 'whole', whole.length, 'chatty', chatty.length, 'calls', calls.join(' ') || '-', errors.length ? 'ERR ' + errors[0].slice(0, 60) : '');
  }
  await browser.close();
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
