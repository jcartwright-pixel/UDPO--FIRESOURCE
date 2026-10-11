const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Joe, 10/9 (standing rule for this app and every later one): every screen and link opens in the same window, never a new
// tab, and moving between screens keeps the header and menu in place without a blank flash.
const PUBLIC = path.join(__dirname, '../../../public');
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]);

test('no screen or link opens a new tab or window', () => {
  const bad = [];
  files(PUBLIC).filter(f => /\.(html|js)$/.test(f)).forEach(f => {
    const text = fs.readFileSync(f, 'utf8');
    if (/target\s*=\s*["']?_blank/i.test(text) || /\.target\s*=\s*['"]_blank/.test(text)) bad.push(path.relative(PUBLIC, f) + ': target _blank');
    if (/window\.open\s*\(/.test(text)) bad.push(path.relative(PUBLIC, f) + ': window.open');
  });
  assert.deepEqual(bad, []);
});

test('moving between screens is set up to look like one app', () => {
  const css = fs.readFileSync(path.join(PUBLIC, 'css/app.css'), 'utf8');
  assert.match(css, /@view-transition\s*\{\s*navigation:\s*auto/);
  assert.match(css, /\.topbar\s*\{\s*view-transition-name/);
  assert.match(css, /\.sidemenu\s*\{\s*view-transition-name/);
  const app = fs.readFileSync(path.join(PUBLIC, 'js/app.js'), 'utf8');
  assert.match(app, /speculationrules/);
  assert.match(app, /sessionStorage\.getItem\('udActive'\)/);
});
