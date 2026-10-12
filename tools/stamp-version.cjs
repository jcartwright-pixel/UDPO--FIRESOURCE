#!/usr/bin/env node
'use strict';
/*
 * Joe 10/11: "how can I tell what version this is? And if this is sandbox or not." Run by the deploy (deploy.yml) just
 * before Firebase uploads public/: writes public/version.json from the commit being deployed, so the line at the bottom
 * of the menu (and in Diagnostics) can never go stale. Usage: node tools/stamp-version.cjs <sandbox|production> [public]
 *   production: "Version 6.3 · 10-12-26"              (the newest "Release 6.3:" commit on main, deploy date)
 *   sandbox:    "Version 6.4 · 10-12-26 · Test copy"  (the next number: what the sandbox will be released as)
 * Joe 10/12: "should we have a version number". Production Prep names each release commit "Release X.Y: ...", so the
 * number goes up with every release by itself.
 * The repository keeps a placeholder version.json for a local copy ("Test copy on this computer").
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const target = process.argv[2] === 'production' ? 'production' : 'sandbox';
const dir = path.resolve(process.argv[3] || path.join(__dirname, '..', 'public'));
const git = (cmd) => { try { return execSync('git ' + cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { return ''; } };

// The release number is the newest "Release N:" or "Release N.M:" commit subject on main (the deploy fetches main first),
// else on HEAD. Kept as text so 6.10 stays 6.10.
function parseRelease(subjects) {
  const m = /^Release (\d+(?:\.\d+)?)\b/m.exec(subjects || '');
  return m ? m[1] : null;
}
function release() {
  for (const ref of ['origin/main', 'HEAD']) {
    const n = parseRelease(git('log ' + ref + ' --format=%s -n 400'));
    if (n) return n;
  }
  return null;
}
// The number the test copy will be released as: 6.3 -> 6.4, 6 -> 6.1.
function nextRelease(n) {
  if (n == null) return null;
  const [major, minor] = String(n).split('.');
  return major + '.' + (minor == null ? 1 : Number(minor) + 1);
}
// Short dates like the rest of the app (10-8-26), on the plant's clock.
function today(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: '2-digit', month: 'numeric', day: 'numeric' })
    .formatToParts(now).map(x => [x.type, x.value]));
  return p.month + '-' + p.day + '-' + p.year;
}
// Live: "Version 6.3 · 10-12-26". Test copy: "Version 6.4 · 10-12-26 · Test copy" (n is the last release on main).
function label(n, date, live) {
  const v = live ? n : nextRelease(n);
  return (v == null ? 'Version' : 'Version ' + v) + ' · ' + date + (live ? '' : ' · Test copy');
}

if (require.main === module) {
  const n = release(), date = today(), live = target === 'production';
  const commit = (process.env.GITHUB_SHA || git('rev-parse HEAD')).slice(0, 7);
  const out = { label: label(n, date, live), release: live ? n : nextRelease(n), lastRelease: n, date, copy: live ? 'Live' : 'Test copy', commit };
  fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify(out) + '\n');
  console.log('Version: ' + out.label + ' (' + commit + ')');
}
module.exports = { label, today, parseRelease, nextRelease };
