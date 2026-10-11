#!/usr/bin/env node
'use strict';
/*
 * Joe 10/11: "how can I tell what version this is? And if this is sandbox or not." Run by the deploy (deploy.yml) just
 * before Firebase uploads public/: writes public/version.json from the commit being deployed, so the line at the bottom
 * of the menu (and in Diagnostics) can never go stale. Usage: node tools/stamp-version.cjs <sandbox|production> [public]
 *   production: "Release 5 · 10-11-26 · Live"            (the newest "Release N:" commit on main, deploy date)
 *   sandbox:    "Release 5 + new work · 10-11-26 · Test copy"   (newer than the last release on main)
 * The repository keeps a placeholder version.json for a local copy ("Test copy on this computer").
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const target = process.argv[2] === 'production' ? 'production' : 'sandbox';
const dir = path.resolve(process.argv[3] || path.join(__dirname, '..', 'public'));
const git = (cmd) => { try { return execSync('git ' + cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { return ''; } };

// The release number is the newest "Release N:" commit subject on main (the deploy fetches main first), else on HEAD.
function release() {
  for (const ref of ['origin/main', 'HEAD']) {
    const m = /^Release (\d+)\b/m.exec(git('log ' + ref + ' --format=%s -n 400'));
    if (m) return Number(m[1]);
  }
  return null;
}
// Short dates like the rest of the app (10-8-26), on the plant's clock.
function today(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: '2-digit', month: 'numeric', day: 'numeric' })
    .formatToParts(now).map(x => [x.type, x.value]));
  return p.month + '-' + p.day + '-' + p.year;
}
function label(n, date, live) {
  const name = n == null ? 'Version' : live ? 'Release ' + n : 'Release ' + n + ' + new work';
  return name + ' · ' + date + ' · ' + (live ? 'Live' : 'Test copy');
}

if (require.main === module) {
  const n = release(), date = today(), live = target === 'production';
  const commit = (process.env.GITHUB_SHA || git('rev-parse HEAD')).slice(0, 7);
  const out = { label: label(n, date, live), release: n, date, copy: live ? 'Live' : 'Test copy', commit };
  fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify(out) + '\n');
  console.log('Version: ' + out.label + ' (' + commit + ')');
}
module.exports = { label, today };
