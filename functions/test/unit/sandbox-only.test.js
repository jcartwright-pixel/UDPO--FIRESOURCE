'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const D = require('../../../tools/sandbox-diagnostics.cjs');

// Joe 10/10: debug tools on the sandbox only; the real app's code carries no checks or tracing. Diagnostics live in
// sandbox-only/ and the sandbox deploy adds them; public/ (what production deploys) must have none of it.
const PUB = path.join(__dirname, '../../../public');

test('the app production deploys has no diagnostics in it', () => {
  assert.deepEqual(D.leftovers(PUB), []);
});

test('the sandbox build gets Diagnostics on every screen, and the production check would refuse that build', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ud-sandbox-'));
  try {
    fs.cpSync(PUB, dir, { recursive: true, filter: (p) => !p.includes(path.sep + 'img' + path.sep) });
    const queue = D.add(dir);
    assert.ok(fs.existsSync(path.join(dir, 'diagnostics.html')) && fs.existsSync(path.join(dir, 'js', 'diag-probe.js')));
    const probe = fs.readFileSync(path.join(dir, 'js', 'diag-probe.js'), 'utf8'), app = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
    assert.ok(!probe.includes('__FIREBASE_VERSION__') && probe.includes('firebasejs/\' + FIREBASE') && app.includes('firebasejs/' + /FIREBASE = '([^']+)'/.exec(probe)[1] + '/'), 'the probe loads the same Firebase as the app');
    // Every screen that uses the shared app script is fitted, at the very top of its page; the drivers' phone page is not.
    fs.readdirSync(dir).filter(f => f.endsWith('.html')).forEach(f => {
      const html = fs.readFileSync(path.join(dir, f), 'utf8');
      if (f === 'route.html') assert.ok(!html.includes(D.TAG), 'the drivers\' phone page is left alone');
      else assert.ok(html.indexOf(D.TAG) > 0 && html.indexOf(D.TAG) < html.indexOf('<title>'), f + ' has the probe first');
    });
    // The check opens Home and every screen the menu lists, once each.
    const menu = [...new Set([...app.matchAll(/'([a-z][a-z0-9-]*\.html)/g)].map(m => m[1]))].filter(p => p !== 'route.html' && fs.existsSync(path.join(dir, p)));
    menu.forEach(p => assert.ok(queue.indexOf(p) >= 0, p + ' is in the check'));
    assert.equal(queue[0], 'index.html');
    assert.equal(new Set(queue).size, queue.length);
    assert.ok(!queue.includes('diagnostics.html') && !queue.includes('route.html'));
    assert.ok(fs.readFileSync(path.join(dir, 'diagnostics.html'), 'utf8').includes('const PAGES = ' + JSON.stringify(queue) + ';'));
    assert.ok(D.leftovers(dir).length > queue.length, 'the production check finds the sandbox build');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Diagnostics switches itself off and keeps its log short (the old app\'s stuck Debug Mode, 10/7)', () => {
  const probe = fs.readFileSync(path.join(__dirname, '../../../sandbox-only/js/diag-probe.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../../../sandbox-only/diagnostics.html'), 'utf8');
  assert.match(page, /RECORD_HOURS = 8\b/);
  assert.match(page, /RUN_HOURS = 1\b/);
  assert.match(probe, /LOG_MAX = 400\b/);
  assert.match(probe, /\.slice\(-LOG_MAX\)/);
  assert.match(probe, /if \(rec && !\(at < rec\.until\)\) \{ write\(KEY_REC, null\)/);
  assert.match(probe, /if \(run && !\(at < run\.until\)\) \{ write\(KEY_RUN, null\)/);
});
