const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Joe, 10/10: the installed app showed a plain letter. Every screen points Chrome at the app's name and the United Dairy
// icon, so installing from any screen gives "UD Operations" with the Q check (tools/make-icons.py makes the sizes).
const PUBLIC = path.join(__dirname, '../../../public');
const pages = fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html'));

test('the app has a name and a 192 and 512 icon Chrome can install and mask', () => {
  const m = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.short_name, 'UD Operations');
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, '/');
  for (const sizes of ['192x192', '512x512']) {
    for (const purpose of ['any', 'maskable']) {
      const icon = m.icons.find(i => i.sizes === sizes && i.purpose === purpose);
      assert.ok(icon, sizes + ' ' + purpose);
      assert.ok(fs.existsSync(path.join(PUBLIC, icon.src)), icon.src);
    }
  }
  assert.ok(fs.existsSync(path.join(PUBLIC, 'favicon.ico')));
});

test('every screen links the icon, and every signed-in screen links the app', () => {
  const bad = [];
  pages.forEach(f => {
    const html = fs.readFileSync(path.join(PUBLIC, f), 'utf8');
    if (!html.includes('href="img/app-icon/favicon-32.png"')) bad.push(f + ': favicon');
    if (!html.includes('href="img/app-icon/apple-touch-icon.png"')) bad.push(f + ': phone icon');
    // The public driver Check-In stays its own page: installing it opens Check-In, not the signed-in launcher.
    if (f !== 'route.html' && !html.includes('<link rel="manifest" href="manifest.webmanifest">')) bad.push(f + ': manifest');
  });
  assert.deepEqual(bad, []);
});
