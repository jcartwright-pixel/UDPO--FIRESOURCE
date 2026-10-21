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
    // Joe 10/12: the one exception is Launch on Administration > Links & Codes (marked data-launch), which tests a station,
    // phone, TV or kiosk screen in a new window so Administration stays where it was.
    const text = fs.readFileSync(f, 'utf8').split('\n').filter(l => !/data-launch/.test(l)).join('\n');
    if (/target\s*=\s*["']?_blank/i.test(text) || /\.target\s*=\s*['"]_blank/.test(text)) bad.push(path.relative(PUBLIC, f) + ': target _blank');
    if (/window\.open\s*\(/.test(text)) bad.push(path.relative(PUBLIC, f) + ': window.open');
  });
  assert.deepEqual(bad, []);
});

test('moving between screens is set up to look like one app', () => {
  const css = fs.readFileSync(path.join(PUBLIC, 'css/app.css'), 'utf8');
  // The page colour shows while a screen loads (no white flash).
  assert.match(css, /html\s*\{\s*background:\s*var\(--page\)/);
  const app = fs.readFileSync(path.join(PUBLIC, 'js/app.js'), 'utf8');
  assert.match(app, /sessionStorage\.getItem\('udActive'\)/);
  // Joe 10/21 ("the older screens are loading and then it's refreshing on the new ones ... I do not want any overlays"): no
  // picture of the old screen cross-faded over the new one, no screens opened in the background on a resting pointer, and each
  // screen's own part shows once, when its first data is drawn.
  const all = files(PUBLIC).filter(f => /\.(html|js|css)$/.test(f)).map(f => [path.relative(PUBLIC, f), fs.readFileSync(f, 'utf8')]);
  assert.deepEqual(all.filter(([, t]) => /@view-transition|view-transition-name/.test(t)).map(([f]) => f), [], 'no view transitions');
  assert.deepEqual(all.filter(([, t]) => /speculationrules/.test(t)).map(([f]) => f), [], 'no prerendering');
  assert.match(app, /function holdUntilDrawn\(\)/);
  assert.match(css, /body\.ud-drawing \.side-main/);
});
