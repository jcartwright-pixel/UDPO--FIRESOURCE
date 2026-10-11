#!/usr/bin/env node
'use strict';
/*
 * The production server's settings (functions/.env), built from production-settings.json and checked before every
 * production deploy. The deploy stops if the settings would do anything Joe has not allowed:
 *   - production must read the real Uniontown sheets (READ_UNIONTOWN_SHEETS=1), never the made-up ones (DEMO_DATA) and
 *     never the sandbox copies (SOURCES_JSON or any sandbox copy ID);
 *   - production must not write to any sheet (WRITEBACK_JSON) until Joe types the sentence that allows it;
 *   - email only from and to United Dairy addresses.
 *
 *   node tools/production-env.cjs [settings.json]   prints the .env text; PRODUCTION_ENV (KEY=value lines, a GitHub
 *                                                   variable) may add or replace MAIL_FROM / REPORT_TO without a commit
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ALLOWED = ['READ_UNIONTOWN_SHEETS', 'MAIL_FROM', 'REPORT_TO'];
const WHY = {
  DEMO_DATA: 'production must show the real sheets, not the made-up ones',
  DEMO_ADMINS: 'production must take its administrators from the real Users Master',
  SOURCES_JSON: 'production reads the real sheets, never the sandbox copies',
  WRITEBACK_JSON: 'production may not write to any sheet until Joe types the sentence that allows it',
  UD_LOCAL_NO_TRIGGERS: 'that setting is for test machines only'
};
const UD = /^[^@\s,]+@uniteddairy\.com$/i;

// Every spreadsheet ID the sandbox uses (its copies), so none of them can end up in production.
function sandboxIds(file) {
  const ids = new Set();
  const walk = (v) => { if (v && typeof v === 'object') Object.keys(v).forEach(k => (k === 'spreadsheetId' ? ids.add(String(v[k])) : walk(v[k]))); };
  if (fs.existsSync(file)) walk(JSON.parse(fs.readFileSync(file, 'utf8')));
  return ids;
}

function parseLines(text) {
  const out = {};
  String(text || '').split(/\r?\n/).forEach(line => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const i = t.indexOf('=');
    if (i < 1) throw new Error('PRODUCTION_ENV line is not KEY=value: ' + t);
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  });
  return out;
}

// settings: {env: {...}}; extra: PRODUCTION_ENV text; sandbox: Set of sandbox copy IDs. Returns {env, problems}.
function productionEnv(settings, extra, sandbox) {
  const env = Object.assign({}, (settings && settings.env) || {}, parseLines(extra));
  const problems = [];
  Object.keys(env).forEach(k => {
    const v = String(env[k]);
    if (WHY[k]) problems.push(k + ' is not allowed: ' + WHY[k]);
    else if (ALLOWED.indexOf(k) < 0) problems.push(k + ' is not a production setting (allowed: ' + ALLOWED.join(', ') + ')');
    if (/[\r\n]/.test(v)) problems.push(k + ' must be one line');
    (sandbox || new Set()).forEach(id => { if (id && v.includes(id)) problems.push(k + ' names a sandbox sheet copy (' + id + ')'); });
  });
  if (String(env.READ_UNIONTOWN_SHEETS) !== '1') problems.push('READ_UNIONTOWN_SHEETS must be 1: production reads the real Uniontown sheets (read only)');
  if (env.MAIL_FROM && !UD.test(String(env.MAIL_FROM).trim())) problems.push('MAIL_FROM must be one @uniteddairy.com address');
  String(env.REPORT_TO || '').split(',').map(s => s.trim()).filter(Boolean).forEach(a => {
    if (!UD.test(a)) problems.push('REPORT_TO address is not @uniteddairy.com: ' + a);
  });
  return { env, problems };
}

function envText(env) {
  return Object.keys(env).filter(k => String(env[k]).trim() !== '').map(k => k + '=' + String(env[k]).trim()).join('\n') + '\n';
}

if (require.main === module) {
  const file = process.argv[2] || path.join(ROOT, 'production-settings.json');
  const { env, problems } = productionEnv(JSON.parse(fs.readFileSync(file, 'utf8')), process.env.PRODUCTION_ENV, sandboxIds(path.join(ROOT, 'sandbox-sources.json')));
  if (problems.length) {
    problems.forEach(p => console.error('::error::Production settings: ' + p));
    process.exit(1);
  }
  process.stdout.write(envText(env));
}

module.exports = { productionEnv, envText, parseLines, sandboxIds, ALLOWED };
