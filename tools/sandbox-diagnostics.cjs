#!/usr/bin/env node
'use strict';
/*
 * Diagnostics are for the SANDBOX only (Joe 10/10): the real app's code carries no checks or tracing.
 * They live in sandbox-only/, outside public/, so nothing in public/ (what production deploys) has any of it.
 *
 *   node tools/sandbox-diagnostics.cjs add <dir>    the sandbox deploy: copies the Diagnostics screen and its probe into
 *                                                   <dir> and puts the probe at the top of every screen there
 *   node tools/sandbox-diagnostics.cjs check <dir>  the production deploy: fails if <dir> holds any of it
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'sandbox-only');
const TAG = '<script src="js/diag-probe.js"></script>';
// Anything that shows Diagnostics got into a build.
const MARKS = [/diag-probe/, /udDiag/, /diagnostics\.html/, /__DIAG_PAGES__/, /SANDBOX ONLY/];

function htmlFiles(dir) { return fs.readdirSync(dir).filter(f => f.endsWith('.html')); }

function leftovers(dir) {
  const found = [];
  ['diagnostics.html', 'js/diag-probe.js'].forEach(f => { if (fs.existsSync(path.join(dir, f))) found.push(f + ' is there'); });
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'img') walk(p); return; }
    if (!/\.(html|js|css|json)$/.test(e.name)) return;
    const text = fs.readFileSync(p, 'utf8');
    MARKS.forEach(re => { if (re.test(text)) found.push(path.relative(dir, p) + ' has ' + re); });
  });
  walk(dir);
  return found;
}

function add(dir) {
  const appJs = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  const version = (/firebasejs\/(\d+\.\d+\.\d+)\//.exec(appJs) || [])[1];
  if (!version) throw new Error('Could not find the Firebase version in js/app.js');
  // The drivers' public phone page (route.html) stays exactly as it is.
  const pages = htmlFiles(dir).filter(f => f !== 'diagnostics.html' && f !== 'route.html' && fs.readFileSync(path.join(dir, f), 'utf8').includes('js/app.js'));
  // The check opens Home, then every screen in menu order (as js/app.js lists them).
  const order = ['index.html'];
  for (const m of appJs.matchAll(/'([a-z][a-z0-9-]*\.html)/g)) if (order.indexOf(m[1]) < 0) order.push(m[1]);
  const queue = order.filter(p => pages.indexOf(p) >= 0);
  fs.writeFileSync(path.join(dir, 'js', 'diag-probe.js'), fs.readFileSync(path.join(SRC, 'js', 'diag-probe.js'), 'utf8').split('__FIREBASE_VERSION__').join(version));
  fs.writeFileSync(path.join(dir, 'diagnostics.html'), fs.readFileSync(path.join(SRC, 'diagnostics.html'), 'utf8')
    .split('__DIAG_PAGES__').join(JSON.stringify(queue)).split('firebasejs/12.18.0/').join('firebasejs/' + version + '/'));
  let fitted = 0;
  pages.concat('diagnostics.html').forEach(f => {
    const p = path.join(dir, f), html = fs.readFileSync(p, 'utf8');
    if (html.includes(TAG)) return;
    const at = /<meta charset="utf-8">/i.test(html) ? /(<meta charset="utf-8">)/i : /(<head[^>]*>)/i;
    if (!at.test(html)) throw new Error(f + ' has no <head>');
    fs.writeFileSync(p, html.replace(at, '$1\n  ' + TAG));
    fitted++;
  });
  console.log('Diagnostics added for the sandbox: ' + fitted + ' pages fitted, the check opens ' + queue.length + ' screens');
  return queue;
}

if (require.main === module) {
  const [cmd, dir] = process.argv.slice(2);
  if (!dir || !fs.existsSync(dir)) { console.error('usage: sandbox-diagnostics.cjs add|check <dir>'); process.exit(2); }
  if (cmd === 'add') add(dir);
  else if (cmd === 'check') {
    const found = leftovers(dir);
    if (found.length) { console.error('Diagnostics are sandbox only, but this build has them:\n  ' + found.join('\n  ')); process.exit(1); }
    console.log('No diagnostics in ' + dir + ': clean for production');
  } else { console.error('usage: sandbox-diagnostics.cjs add|check <dir>'); process.exit(2); }
}

module.exports = { add, leftovers, TAG };
