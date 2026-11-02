#!/usr/bin/env node
/*
 * 6.80 practice test: the every-30-minutes trip saving (functions/src/tripfuel.js) wrote nothing on the practice copy and
 * Cloud Scheduler reports its runs failed. This runs the same step once against the PRACTICE copy, with the same memory
 * as the job (NODE_OPTIONS), and prints how long each part took and how much memory it used. It saves trips into the
 * practice copy's gpsTripFuel exactly as the job would; nothing goes to a sheet.
 */
'use strict';
const path = require('path');
const req = require('module').createRequire(path.join(__dirname, '..', 'functions', 'package.json'));
const admin = req('firebase-admin');
const { getFirestore } = req('firebase-admin/firestore');
const key = require(process.env.KEY);
if (key.project_id !== 'ud-distribution-sandbox') { console.error('Practice copy only.'); process.exit(1); }
const db = getFirestore(admin.initializeApp({ credential: admin.credential.cert(key) }));
const { dailyTripFuel } = require('../functions/src/tripfuel');
const began = Date.now();
const mem = () => Math.round(process.memoryUsage().rss / 1048576) + ' MB';
const timer = setInterval(() => console.log('still going', Math.round((Date.now() - began) / 1000) + ' s', mem()), 15000);
(async () => {
  const r = await dailyTripFuel({ db, budgetMs: 2 * 60000, options: { progress: (at, n) => console.log('read', at, n, 'points', mem()) } });
  clearInterval(timer);
  console.log('RESULT', JSON.stringify(r), Math.round((Date.now() - began) / 1000) + ' s', mem());
  process.exit(0);
})().catch(e => { clearInterval(timer); console.error('FAILED', e && e.stack || e, mem()); process.exit(1); });
