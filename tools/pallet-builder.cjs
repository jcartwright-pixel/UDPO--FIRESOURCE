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
      <div class="title"><span class="eyebrow">Plant Operations</span><h1>Pallet Builder</h1></div>
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
    import { requireSignIn, callServer, currentPlant, serverText, start } from './js/app.js';
    import { collection, getDocs, query, orderBy, limit } from './js/firebase.js';
    import { PALLET_FIELDS } from './js/products.js';
    // Joe 11-6-26: the route map is the Customer List's route day (udclRouteDays, through its own server call, customerList,
    // which checks who may change it, checks nobody saved the same route day in between and logs every save). The builder in
    // the frame asks for it through window.udRouteMap: load(route, day) when a route opens, save(...) for Save to route map.
    let view = null; // this plant's Customer List, read once per visit
    const what = 'the Customer List';
    const plain = (e) => { const c = String(e && e.code || '').replace('functions/', ''); return c === 'not-found' ? 'Could not reach ' + what + '. Try again later.' : serverText(e, what); };
    const num = (v) => (/[0-9]{3,}/.exec(String(v || '')) || [])[0] || String(v || '');
    const routeDayOf = (d, route, day) => (d.routeDays || []).find(r => r.day === day && (String(r.route) === String(route) || num(r.route) === String(route)));
    function shape(d, rd) {
      if (!rd) return { found: false, canEdit: !!d.canEdit, rules: d.palletRules || null };
      const cs = d.customers || {};
      // Joe 11-6-26: each customer's cases on this route day (weeks = [[week ending, cases]], kept in the Customer List from the Hub's
      // Weekly Route Report), its PALLET USES, how many weeks there are, and the plant's Pallet Rules.
      const cases = rd.cases || {}, uses = rd.palletUses || {};
      return { found: true, route: rd.route, rev: rd.rev || 0, updatedAt: rd.updatedAt || '', updatedBy: rd.updatedBy || '', canEdit: !!d.canEdit, map: rd.map || null,
        rules: d.palletRules || null, caseWeeks: rd.caseWeeks || 0,
        stops: (rd.stops || []).map(s => { const c = cs[s.key] || {}; return { key: s.key, account: c.account || s.account || '', name: c.name || s.name || '', chain: c.chain || s.chain || '', loadSeq: +s.loadSeq || 0, note: s.note || '', weeks: cases[s.key] || [], uses: uses[s.key] || '' }; }) };
    }
    const read = () => (view = view || callServer('customerList', { op: 'view', plant: currentPlant(), cases: true }).catch(e => { view = null; throw e; }));
    window.udRouteMap = {
      async load(route, day) {
        try { const d = await read(); return shape(d, routeDayOf(d, route, day)); } catch (e) { throw new Error(plain(e)); }
      },
      // seqs = { customer key: new load sequence }. Only the load sequences change; the stops, their order and notes stay.
      async save(route, day, rev, seqs) {
        let d;
        try { d = await read(); } catch (e) { throw new Error(plain(e)); }
        const rd = routeDayOf(d, route, day);
        if (!rd) throw new Error('Route ' + route + ' is not on the route map for that day. Add it in the Customer List first.');
        const stops = (rd.stops || []).map(s => ({ key: s.key, loadSeq: seqs[s.key] != null ? seqs[s.key] : (s.loadSeq || 0), note: s.note || '' }));
        try {
          const out = await callServer('customerList', { op: 'saveRouteDay', plant: currentPlant(), route: rd.route, day, rev, stops });
          Object.assign(rd, out.routeDay || {});
          return shape(d, rd);
        } catch (e) {
          const err = new Error(plain(e));
          if (/aborted/.test(String(e && e.code || ''))) { view = null; err.changed = true; }
          throw err;
        }
      },
      // Joe 11-7-26: SAVE sends it all. stops = [{key, acct, name, chain, loadSeq}] in run order (key '' = a customer the route
      // day does not have: found on the Customer List by account number or name, else added to it first); map = {rows, cells}
      // (the truck drawing, or null to keep the one there). A customer on the route day but not in stops stays, after the stop
      // with the next higher load sequence; every stop keeps its stop note. A route day the Customer List lacks is started.
      async saveAll(route, day, rev, what) {
        let d;
        try { d = await read(); } catch (e) { throw new Error(plain(e)); }
        const rd = routeDayOf(d, route, day), cs = d.customers || {};
        const digits = (v) => String(v || '').split('').filter(ch => ch >= '0' && ch <= '9').join('');
        const letters = (v) => String(v || '').toUpperCase().split('').filter(ch => (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')).join('');
        const byAcct = {}, byName = {};
        const know = (k, c) => { if (digits(c.account)) byAcct[digits(c.account)] = byAcct[digits(c.account)] || k; if (letters(c.name)) byName[letters(c.name)] = byName[letters(c.name)] || k; };
        (d.routeDays || []).forEach(r => (r.stops || []).forEach(s => know(s.key, s)));
        Object.keys(cs).forEach(k => know(k, cs[k] || {}));
        const list = [];
        try {
          for (const st of (what && what.stops) || []) {
            let key = st.key || (digits(st.acct) && byAcct[digits(st.acct)]) || byName[letters(st.name)] || '';
            if (!key) {
              const out = await callServer('customerList', { op: 'saveCustomer', plant: currentPlant(), add: true, account: digits(st.acct), fields: { name: st.name, chain: st.chain || '' } });
              const c = out.customer || {}; key = c.key;
              if (!key) throw new Error('The Customer List did not add ' + (st.name || 'the customer') + '. Try again.');
              cs[key] = c; if (digits(c.account)) byAcct[digits(c.account)] = key; byName[letters(c.name)] = key;
            }
            if (key && !list.some(x => x.key === key)) list.push({ key, loadSeq: +st.loadSeq > 0 ? +st.loadSeq : 0 });
          }
        } catch (e) { throw new Error(plain(e)); }
        const before = rd ? (rd.stops || []) : [];
        before.forEach(s => { const x = list.find(y => y.key === s.key); if (x) x.note = s.note || ''; });
        // A customer on the route day but not on this BOL (closed for now, or no order today) keeps its place: right after the
        // stop it came after on the route day (the start of the route when none of those is on the list).
        before.forEach((s, at) => {
          if (list.some(y => y.key === s.key)) return;
          let i = 0;
          for (let j = at - 1; j >= 0; j--) { const k = list.findIndex(y => y.key === before[j].key); if (k >= 0) { i = k + 1; break; } }
          list.splice(i, 0, { key: s.key, loadSeq: +s.loadSeq || 0, note: s.note || '' });
        });
        const call = { op: 'saveRouteDay', plant: currentPlant(), route: rd ? rd.route : String(route), day, stops: list.map(x => ({ key: x.key, loadSeq: x.loadSeq, note: x.note || '' })) };
        if (rd) call.rev = rev;
        if (what && what.map) call.map = what.map;
        try {
          const out = await callServer('customerList', call);
          let r = rd;
          if (!r) { r = { route: call.route, day, stops: [] }; (d.routeDays = d.routeDays || []).push(r); }
          Object.assign(r, out.routeDay || {});
          return shape(d, r);
        } catch (e) {
          const err = new Error(plain(e));
          if (/aborted/.test(String(e && e.code || ''))) { view = null; err.changed = true; }
          throw err;
        }
      },
      // Joe 11-6-26: PALLET USES for one customer on one route day ('' = the standard on Pallet Rules).
      async setUses(route, day, key, rule) {
        let d;
        try { d = await read(); } catch (e) { throw new Error(plain(e)); }
        const rd = routeDayOf(d, route, day);
        if (!rd) throw new Error('Route ' + route + ' is not on the route map for that day. Add it in the Customer List first.');
        try {
          const out = await callServer('customerList', { op: 'setPalletUses', plant: currentPlant(), route: rd.route, day, key, rule });
          rd.palletUses = out.palletUses || {};
          return out;
        } catch (e) { throw new Error(plain(e)); }
      },
      // Pallet Rules: only the boxes changed are sent; the Customer List puts anything wrong back to the standard.
      async saveRules(change) {
        let d;
        try { d = await read(); } catch (e) { throw new Error(plain(e)); }
        try {
          const out = await callServer('customerList', { op: 'savePalletRules', plant: currentPlant(), rules: change });
          d.palletRules = out.palletRules;
          return out.palletRules;
        } catch (e) { throw new Error(plain(e)); }
      }
    };
    // Joe 11-6-26: the Product Sheet's case and pallet numbers by SKU (the plant's products on each machine and on no machine),
    // read once; the builder uses them in place of its own where a box is filled in.
    async function sheetProducts() {
      const { db } = await start(), out = {};
      const take = (p) => { const k = String(p && p.sku || '').trim(); if (!k) return; const o = out[k] || (out[k] = {});
        PALLET_FIELDS.forEach(f => { if (o[f] == null && Number(p[f]) > 0) o[f] = Number(p[f]); }); };
      for (const name of ['plantProducts', 'productSheet']) {
        const snap = await getDocs(collection(db, name));
        snap.docs.forEach(d => ((d.data() || {}).products || []).forEach(take));
      }
      Object.keys(out).forEach(k => { if (!Object.keys(out[k]).length) delete out[k]; });
      return out;
    }
    // The builder keeps its saved routes in this browser (as it always has); the frame is this site's own page, so they stay.
    // Joe 11-6-26 (lb): the builder opens with the newest BOL the Hub picked up (bolDays, kept by Hub > Daily BOL in the company
    // database), shaped like the BOL built into the builder. No BOL there, or it can't be read: the builder's own one stays.
    const two = (n) => String(n).padStart(2, '0');
    window.udBolShape = (d) => {
      if (!d || !d.date || !(d.routes || []).length) return null;
      const y = d.date.slice(0, 4);
      // The builder's own route-name key (MM/DD/YY, read back by its routeKey to find the weekday), not a date for people.
      const tag = d.date.slice(5).replace('-', '/') + '/' + y.slice(2);
      return { key: 'udpb-hub-' + d.date, label: window.UDLogic.dateText(d.date), date: d.date,
        routes: d.routes.map(r => ({ route: 'RT ' + r.route + ' \u00b7 ' + tag, bolAt: d.received || d.savedAt || '',
          stops: (r.stops || []).map(st => ({ name: st.name + (st.seq != null ? ' (sub-rt ' + two(st.seq) + ')' : ''), acct: st.custNo || '',
            lines: (st.lines || []).map(l => [String(l.item), Number(l.qty) || 0]) })) })) };
    };
    // Joe 11-7-26: every BOL day the Hub has, newest first (the newest 14), for the BOL DAY picker.
    async function bolDays() {
      const { homeDb } = await start();
      const snap = await getDocs(query(collection(homeDb, 'bolDays'), orderBy('date', 'desc'), limit(14)));
      return snap.docs.map(x => window.udBolShape(x.data())).filter(Boolean);
    }
    requireSignIn(async () => {
      const frame = document.getElementById('builder');
      if (frame.srcdoc) return;
      // Joe 11-7-26: a read that fails says why on the screen (window.udBolError), instead of quietly showing the built-in BOL.
      try { window.udBolDays = await bolDays(); window.udBol = window.udBolDays[0] || null; window.udBolError = ''; }
      catch (e) { window.udBolDays = []; window.udBol = null; window.udBolError = String((e && (e.code || e.message)) || 'unknown').replace('firestore/', ''); }
      try { window.udProducts = await sheetProducts(); } catch (e) { window.udProducts = {}; }
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
