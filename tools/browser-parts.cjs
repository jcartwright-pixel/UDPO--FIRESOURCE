#!/usr/bin/env node
'use strict';
/*
 * Runs the screen tests (functions/package.json "test:browser") in parts, each part with its own fresh emulators.
 * Why: on GitHub's test machines the one long emulator session kept growing until the machine ran out of memory and
 * killed the run (exit 137, "runner has received a shutdown signal", 11-9-26), so a green change never got its green
 * check and the automatic release (release.yml) could never start. Starting the emulators again for each part gives the
 * memory back. Same tests, same order; nothing is skipped.
 * Usage (from functions/): node ../tools/browser-parts.cjs <parts>     e.g. node ../tools/browser-parts.cjs 3
 *        node ../tools/browser-parts.cjs <parts> --list                 prints the parts without running them
 */
const path = require('path');
const { spawnSync } = require('child_process');

function parts(script, n) {
  const m = script.match(/^(.*?)firebase emulators:exec (.*?) "(.*)"$/s);
  if (!m) throw new Error('test:browser is not one "firebase emulators:exec ... \\"...\\"" line');
  const env = m[1].trim(), flags = m[2].trim();
  const cmds = m[3].split(' && ').map(s => s.trim()).filter(Boolean);
  const size = Math.ceil(cmds.length / n), out = [];
  for (let i = 0; i < cmds.length; i += size) out.push(cmds.slice(i, i + size));
  return { env, flags, cmds, parts: out };
}

if (require.main === module) {
  const n = Math.max(1, parseInt(process.argv[2], 10) || 1);
  const pkg = require(path.join(process.cwd(), 'package.json'));
  const p = parts(pkg.scripts['test:browser'], n);
  p.parts.forEach((list, i) => console.log(`Part ${i + 1} of ${p.parts.length}: ${list.length} screen tests, ${list[0]} to ${list[list.length - 1]}`));
  if (process.argv.includes('--list')) process.exit(0);
  const env = { ...process.env };
  for (const kv of p.env.split(/\s+/).filter(Boolean)) { const [k, ...v] = kv.split('='); env[k] = v.join('='); }
  const bin = path.join(process.cwd(), 'node_modules', '.bin', 'firebase');
  for (const [i, list] of p.parts.entries()) {
    console.log(`\n=== Screen tests part ${i + 1} of ${p.parts.length} (fresh emulators) ===`);
    const r = spawnSync(bin, ['emulators:exec', ...p.flags.split(/\s+/), list.join(' && ')], { stdio: 'inherit', env });
    if (r.status !== 0) { console.error(`Screen tests part ${i + 1} failed (exit ${r.status === null ? r.signal : r.status})`); process.exit(r.status || 1); }
  }
}

module.exports = { parts };
