/*
 * Click wait (Joe 11/2: "Every time I click an action button" it takes a long time): how long the practice copy's server
 * takes to answer the calls the screens' buttons make, the first time after it has been idle (a "cold start", when Google
 * has to start the server again) and straight after (warm). Nothing is saved: the calls only ask (which saves the person
 * may make), or are refused before anything is read.
 *
 *   KEY=<practice deploy key> node test/browser/click-wait.cjs <out.json>      (GitHub Actions, sandbox-audit.yml [click wait])
 *   IDLE_MIN=16  minutes to wait idle before the second cold try (0 = skip)
 *
 * It also reads the practice copy's own request log for the last 14 days (every press anyone made there), when the deploy key
 * may read it, so the times include real presses and not only this test's.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const OUT = process.argv[2] || 'click-wait.json';
const KEY = JSON.parse(fs.readFileSync(process.env.KEY, 'utf8'));
if (KEY.project_id !== 'ud-distribution-sandbox') { console.error('Practice copy only'); process.exit(1); }
const PROJECT = KEY.project_id, REGION = 'us-east4';
const EMAIL = process.env.AUDIT_EMAIL || 'practice.audit@uniteddairy.com';
const IDLE_MIN = Number(process.env.IDLE_MIN === undefined ? 16 : process.env.IDLE_MIN);
const FNS = ['save', 'admin', 'phone', 'garage', 'sales', 'people', 'sms', 'gps', 'setSwitch', 'stationSignIn'];
const report = { at: new Date().toISOString(), project: PROJECT, calls: [], log: null, notes: [] };
const write = () => fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
const note = (s) => { report.notes.push(s); console.log('NOTE ' + s); };

async function idToken() {
  const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
  const admin = r('firebase-admin');
  const a = admin.apps.find(x => x && x.name === 'click-wait') || admin.initializeApp({ credential: admin.credential.cert(KEY), projectId: PROJECT }, 'click-wait');
  const custom = await r('firebase-admin/auth').getAuth(a).createCustomToken('practice-audit', { email: EMAIL, email_verified: true });
  const init = await (await fetch('https://' + PROJECT + '.web.app/__/firebase/init.json')).json();
  const res = await (await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=' + init.apiKey, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true })
  })).json();
  if (!res.idToken) throw new Error('No sign-in: ' + JSON.stringify(res).slice(0, 200));
  return res.idToken;
}

let TOKEN = '';
async function call(fn, data, label) {
  const t = Date.now();
  let status = 0, text = '';
  try {
    const r = await fetch('https://' + REGION + '-' + PROJECT + '.cloudfunctions.net/' + fn, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify({ data })
    });
    status = r.status; text = (await r.text()).slice(0, 160);
  } catch (e) { text = String(e.message).slice(0, 160); }
  const row = { fn, label, ms: Date.now() - t, status, answer: text };
  report.calls.push(row);
  console.log((label + ' ' + fn).padEnd(40) + String(row.ms).padStart(6) + ' ms  ' + status);
  write();
  return row;
}

const ASK = { checkSaves: ['savePlantLoad', 'savePlantSchedule', 'saveUnloading', 'completeWash', 'addReturn', 'saveShiftNote', 'saveTemperatureCheck', 'saveYardCheck'], udPlant: 'fac_uniontown' };

async function round(label) {
  // The ask (which saves this person may make): the whole save path up to the save itself.
  await call('save', ASK, label + ' first');
  for (let i = 0; i < 5; i++) await call('save', ASK, label + ' again');
  // One save action only (one rights check): the time a single press's checks take.
  for (let i = 0; i < 3; i++) await call('save', { checkSaves: ['saveShiftNote'], udPlant: 'fac_uniontown' }, label + ' one ask');
  // A save that is refused before anything is read (a made-up action): the server's own answer time with no database work.
  for (let i = 0; i < 3; i++) await call('save', { action: 'noSuchSave', udPlant: 'fac_uniontown' }, label + ' refused');
}

function logs() {
  // Every request to the practice copy's servers in the last 14 days (Cloud Run's own log), when the key may read it.
  try {
    const keyFile = process.env.KEY;
    execFileSync('gcloud', ['auth', 'activate-service-account', '--key-file=' + keyFile, '--quiet'], { stdio: 'pipe' });
    const where = execFileSync('gcloud', ['firestore', 'databases', 'describe', '--database=(default)', '--project=' + PROJECT, '--format=value(locationId)'], { stdio: 'pipe' }).toString().trim();
    note('Practice database location: ' + (where || 'unknown') + '; server region ' + REGION);
  } catch (e) { note('Database location not readable: ' + String(e.stderr || e.message).split('\n')[0].slice(0, 160)); }
  try {
    const q = 'resource.type="cloud_run_revision" AND httpRequest.requestMethod="POST" AND timestamp>="' + new Date(Date.now() - 14 * 86400000).toISOString() + '"';
    const raw = execFileSync('gcloud', ['logging', 'read', q, '--project=' + PROJECT, '--limit=20000', '--format=json(timestamp,resource.labels.service_name,httpRequest.latency,httpRequest.status)'], { stdio: 'pipe', maxBuffer: 512 * 1024 * 1024 }).toString();
    const rows = JSON.parse(raw || '[]').map(e => ({ at: e.timestamp, fn: e.resource && e.resource.labels && e.resource.labels.service_name, ms: Math.round(parseFloat(String((e.httpRequest || {}).latency || '0').replace('s', '')) * 1000), status: (e.httpRequest || {}).status }));
    const starts = JSON.parse(execFileSync('gcloud', ['logging', 'read', 'resource.type="cloud_run_revision" AND textPayload:"Starting new instance" AND timestamp>="' + new Date(Date.now() - 14 * 86400000).toISOString() + '"', '--project=' + PROJECT, '--limit=5000', '--format=json(timestamp,resource.labels.service_name)'], { stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 }).toString() || '[]');
    const by = {};
    rows.forEach(r => { (by[r.fn] = by[r.fn] || []).push(r.ms); });
    const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
    report.log = { requests: rows.length, starts: starts.length, byFunction: Object.fromEntries(Object.entries(by).map(([k, a]) => { a.sort((x, y) => x - y); return [k, { n: a.length, median: pct(a, 0.5), p90: pct(a, 0.9), p99: pct(a, 0.99), max: a[a.length - 1], over2s: a.filter(x => x > 2000).length }]; })), startsByFunction: starts.reduce((o, s) => { const k = s.resource && s.resource.labels && s.resource.labels.service_name; o[k] = (o[k] || 0) + 1; return o; }, {}) };
    console.log(JSON.stringify(report.log, null, 1));
  } catch (e) { note('Request log not readable: ' + String(e.stderr || e.message).split('\n')[0].slice(0, 200)); }
  write();
}

(async () => {
  logs();
  TOKEN = await idToken();
  // Each server is its own service at Google: the first call to each shows its start-up time.
  for (const fn of FNS) { await call(fn, {}, 'cold?'); await call(fn, {}, 'warm'); }
  await round('A');
  if (IDLE_MIN > 0) {
    console.log('Waiting ' + IDLE_MIN + ' minutes idle...');
    await new Promise(r => setTimeout(r, IDLE_MIN * 60000));
    TOKEN = await idToken();
    await round('B after ' + IDLE_MIN + ' min idle');
  }
  report.endedAt = new Date().toISOString();
  write();
})().catch(e => { console.error(e); note(String(e.message)); write(); process.exit(1); });
