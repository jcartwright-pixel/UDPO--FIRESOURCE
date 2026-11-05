// Builds public/pallet-builder.html, the Pallet Builder screen (Joe 11-4-26: "I'd rather have it in the UDOP, not the hub").
// The builder itself is tools/pallet-builder/builder.html, kept exactly as the Pallet Builder project makes it (its own
// styles, script and built-in product list). The screen is an ordinary Operations page (sign-in, header, menu, ? Help) and,
// once signed in, shows the builder in a frame below the header, so the builder's look and the app's look never mix.
//
//   node tools/pallet-builder.cjs            write public/pallet-builder.html from tools/pallet-builder/builder.html
//   node tools/pallet-builder.cjs <file>     copy a new builder.html in first, then write the page
//   node tools/pallet-builder.cjs --check    stop with an error if the page is not up to date (a unit test checks this too)
'use strict';
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, 'pallet-builder', 'builder.html');
const OUT = path.join(__dirname, '..', 'public', 'pallet-builder.html');

const HEAD = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="manifest" href="manifest.webmanifest">
  <meta name="theme-color" content="#074c84">
  <link rel="icon" href="img/app-icon/favicon-32.png" sizes="32x32" type="image/png">
  <link rel="apple-touch-icon" href="img/app-icon/apple-touch-icon.png">
  <title>Pallet Builder · Operations</title>
  <!-- Made by tools/pallet-builder.cjs from tools/pallet-builder/builder.html. Do not edit here: change builder.html and run the tool. -->
  <link rel="stylesheet" href="css/app.css">
  <link rel="stylesheet" href="css/plant.css">
  <script src="js/timing-rules.js"></script>
  <script src="js/logic.js"></script>
  <script src="js/plant-rules.js"></script>
  <style>
    .pallet-builder-page .view { padding: 0; }
    .pallet-builder-page #builder { flex: 1; min-height: 70vh; width: 100%; border: 0; display: block; background: #f3f6f8; }
  </style>
</head>
<body class="fill plant-page pallet-builder-page">
  <div class="signin" id="signin" hidden>
    <h1>Pallet Builder</h1>
    <p>Sign in with your United Dairy Google account.</p>
    <button id="signin-button" type="button">Sign in with Google</button>
    <div class="notice error" id="signin-error" hidden></div>
  </div>

  <div id="screen" hidden>
    <div class="topbar">
      <span class="who" id="who"></span>
      <button id="signout" type="button">Sign out</button>
    </div>
    <div class="head">
      <div class="title"><span class="eyebrow">Plant Distribution</span><h1>Pallet Builder</h1></div>
    </div>
    <div class="notice error" id="error" hidden></div>
    <div class="view">
      <iframe id="builder" title="Pallet Builder"></iframe>
    </div>
  </div>

  <!-- The builder as made (tools/pallet-builder/builder.html), shown in the frame above once someone is signed in. -->
  <script type="application/json" id="builder-page">`;

const TAIL = `</script>
  <script type="module">
    import { requireSignIn } from './js/app.js';
    // The builder keeps its saved routes in this browser (as it always has); the frame is this site's own page, so they stay.
    requireSignIn(() => {
      const frame = document.getElementById('builder');
      if (frame.srcdoc) return;
      const builder = JSON.parse(document.getElementById('builder-page').textContent);
      frame.srcdoc = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>' + builder + '</body></html>';
    });
  </script>
</body>
</html>
`;

// The builder as a JSON string, safe inside a <script> (no "</script" or "<!--" can end or bend it).
const asJson = (text) => JSON.stringify(text).replace(/</g, '\\u003c');

function build(fragment) {
  if (/<\/?(html|body|head)\b/i.test(fragment)) throw new Error('builder.html should be the builder page as made (no <html>, <head> or <body>)');
  return HEAD + asJson(fragment.replace(/\s+$/, '')) + TAIL;
}

if (require.main === module) {
  const arg = process.argv[2];
  if (arg === '--check') {
    const want = build(fs.readFileSync(SRC, 'utf8'));
    if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== want) { console.error('public/pallet-builder.html is out of date: run node tools/pallet-builder.cjs'); process.exit(1); }
    console.log('pallet-builder.html is up to date');
  } else {
    if (arg) fs.copyFileSync(path.resolve(arg), SRC);
    fs.writeFileSync(OUT, build(fs.readFileSync(SRC, 'utf8')));
    console.log('wrote public/pallet-builder.html');
  }
}
module.exports = { build, SRC, OUT };
