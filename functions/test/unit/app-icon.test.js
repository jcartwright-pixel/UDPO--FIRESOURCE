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
    // The public driver Check-In and the plant tablets' Plant Station are their own installs: each opens its own page, not
    // the signed-in launcher.
    if (f !== 'route.html' && f !== 'plant-station.html' && !html.includes('<link rel="manifest" href="manifest.webmanifest">')) bad.push(f + ': manifest');
  });
  assert.deepEqual(bad, []);
});

// Joe, 10/12: the plant tablets (Android and iPad) install the Plant Station as its own icon, full screen, straight to the
// station. The no-account link installs an icon that keeps ?noaccount=1 (an iPad's home-screen icon does not share Safari's
// memory), and neither points at the old app.
test('installed from the Plant Station, "Plant Station" opens full screen to the station', () => {
  const html = fs.readFileSync(path.join(PUBLIC, 'plant-station.html'), 'utf8');
  assert.match(html, /<link rel="manifest" id="manifest" href="plant-station.webmanifest">/);
  assert.match(html, /'plant-station-noaccount.webmanifest'/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  const starts = { 'plant-station.webmanifest': '/plant-station.html', 'plant-station-noaccount.webmanifest': '/plant-station.html?noaccount=1' };
  for (const [file, start] of Object.entries(starts)) {
    const raw = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
    const m = JSON.parse(raw);
    assert.equal(m.short_name, 'Plant Station', file);
    assert.equal(m.start_url, start, file);
    assert.equal(m.id, start, file);
    assert.equal(m.display, 'fullscreen', file);
    // Its screens (Loadout, Unloading, Washing, Returns) stay inside the installed app.
    assert.equal(m.scope, '/', file);
    assert.doesNotMatch(raw, /script\.google|ud-plant-tablet|ud-plant-station/, file);
    for (const sizes of ['192x192', '512x512']) {
      for (const purpose of ['any', 'maskable']) {
        const icon = m.icons.find(i => i.sizes === sizes && i.purpose === purpose);
        assert.ok(icon && fs.existsSync(path.join(PUBLIC, icon.src)), file + ' ' + sizes + ' ' + purpose);
      }
    }
  }
});
