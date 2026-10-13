const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Joe, 10/10: the installed app showed a plain letter. Every screen points Chrome at the app's name and the United Dairy
// icon, so installing from any screen gives "UD Operations" with the Q check (tools/make-icons.py makes the sizes).
const PUBLIC = path.join(__dirname, '../../../public');
const pages = fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html'));
const STATION_ICON = { 'plant-station.html': 'plant-station', 'garage-station.html': 'garage-station', 'driver-station.html': 'driver-station', 'driver-room.html': 'driver-station' };

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
    // The station apps carry their own picture (Joe 10/13): the same icon with the station's picture in the band.
    const own = STATION_ICON[f] ? 'href="img/app-icon/' + STATION_ICON[f] + '/apple-touch-icon.png"' : 'href="img/app-icon/apple-touch-icon.png"';
    if (!html.includes(own)) bad.push(f + ': phone icon');
    // The public driver Check-In and the coded stations (Plant, Garage, Driver Station and the Driver Room Check-In tablet,
    // Joe 10/12) are their own installs: each opens its own page full screen, not the signed-in launcher.
    if (!['route.html', 'plant-station.html', 'driver-room.html', 'driver-station.html', 'garage-station.html'].includes(f) && !html.includes('<link rel="manifest" href="manifest.webmanifest">')) bad.push(f + ': manifest');
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

// Joe 10/12 "it needs to open up in the window shell only": installed from the Driver Station or Garage Station link (the
// Driver Room tablet too), the icon opens that station full screen in its own window, no browser bars.
test('installed from a station link, the station opens full screen in its own window', () => {
  const starts = { 'driver-station.html': ['driver-station.webmanifest', '/driver-station.html', 'Driver Station'], 'driver-room.html': ['driver-station.webmanifest', '/driver-station.html', 'Driver Station'],
    'garage-station.html': ['garage-station.webmanifest', '/garage-station.html', 'Garage Station'] };
  for (const [page, [file, start, name]] of Object.entries(starts)) {
    const html = fs.readFileSync(path.join(PUBLIC, page), 'utf8');
    assert.ok(html.includes('<link rel="manifest" href="' + file + '">'), page);
    assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/, page);
    const m = JSON.parse(fs.readFileSync(path.join(PUBLIC, file), 'utf8'));
    assert.equal(m.short_name, name, file);
    assert.equal(m.start_url, start, file);
    assert.equal(m.id, start, file);
    assert.equal(m.display, 'fullscreen', file);
    assert.equal(m.scope, '/', file);
    m.icons.forEach(i => assert.ok(fs.existsSync(path.join(PUBLIC, i.src)), i.src));
  }
  // The Driver Room tablet's phone screens (route.html?room=1) install the Driver Station link, not the drivers' UD Routes.
  const route = fs.readFileSync(path.join(PUBLIC, 'route.html'), 'utf8');
  assert.match(route, /get\('room'\) === '1'\) \{ document\.querySelector\('link\[rel="manifest"\]'\)\.href = 'driver-station\.webmanifest';/);
  assert.match(route, /document\.querySelector\('link\[rel="apple-touch-icon"\]'\)\.href = 'img\/app-icon\/driver-station\/apple-touch-icon\.png'/);
});

// Joe 10/13 "apps for the stations": each station app has its own icon (tools/make-station-icons.py), so a tablet's
// home screen shows which station it is: the plant for Plant Station, the tractor and trailer for Garage Station, the
// box truck for the Driver Station (Driver Room Check-In tablet and the TV). UD Routes keeps the United Dairy icon.
test('each station app has its own icon in every size, different from the others', () => {
  const sets = { 'plant-station.webmanifest': 'plant-station', 'plant-station-noaccount.webmanifest': 'plant-station',
    'garage-station.webmanifest': 'garage-station', 'driver-station.webmanifest': 'driver-station' };
  const seen = {};
  for (const [file, dir] of Object.entries(sets)) {
    const m = JSON.parse(fs.readFileSync(path.join(PUBLIC, file), 'utf8'));
    for (const sizes of ['192x192', '512x512']) {
      for (const purpose of ['any', 'maskable']) {
        const icon = m.icons.find(i => i.sizes === sizes && i.purpose === purpose);
        assert.ok(icon, file + ' ' + sizes + ' ' + purpose);
        assert.ok(icon.src.startsWith('/img/app-icon/' + dir + '/'), file + ': ' + icon.src);
        assert.ok(fs.existsSync(path.join(PUBLIC, icon.src)), icon.src);
      }
    }
    seen[dir] = fs.readFileSync(path.join(PUBLIC, 'img/app-icon', dir, 'icon-512.png')).toString('base64');
    assert.ok(fs.existsSync(path.join(PUBLIC, 'img/app-icon', dir, 'apple-touch-icon.png')), dir + ' iPad icon');
  }
  const main = fs.readFileSync(path.join(PUBLIC, 'img/app-icon/icon-512.png')).toString('base64');
  const all = Object.values(seen).concat(main);
  assert.equal(new Set(all).size, all.length, 'every station icon differs from the others and from UD Operations');
});
