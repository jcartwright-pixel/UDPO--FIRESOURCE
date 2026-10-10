/*
 * SANDBOX ONLY. Never part of the production app: public/ does not contain this file. The sandbox deploy copies it in and
 * adds it to the top of every screen (tools/sandbox-diagnostics.cjs); the production deploy refuses to go out if any of it
 * is there.
 *
 * Diagnostics, the new app's version of the old app's Full Diagnostics (Joe 10/10). On every sandbox screen it notes:
 *  - how long the screen took to show and to finish loading,
 *  - every server call (saves) with its time and whether it failed,
 *  - every error the screen hit (script errors, database refusals, the red error box).
 * It only keeps anything while a check is running (Diagnostics > Run check) or while "Record while I work" is on.
 * Both switch themselves off: the check when it reaches the last screen, recording after 8 hours at most, and the log
 * is trimmed (one check kept, recording capped), so it can never grow the way the old app's trace did (10/7).
 */
(function () {
  'use strict';
  if (window.udDiag) return;
  var FIREBASE = '__FIREBASE_VERSION__';
  var KEY_RUN = 'udDiagRun', KEY_REC = 'udDiagRecord', KEY_LOG = 'udDiagLog';
  var LOG_MAX = 400, STEP_LIMIT = 20000, QUIET = 1200, SIGNIN_WAIT = 8000;
  var page = location.pathname.split('/').pop() || 'index.html';
  function read(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function write(k, v) { try { if (v === null || v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* no storage */ } }
  // Times count from when the screen was asked for. A screen Chrome got ready early (pointer resting on its menu link) counts
  // from the click that showed it.
  var nav0 = performance.getEntriesByType('navigation')[0], base = 0;
  function ms(t) { return Math.max(0, Math.round(t - base)); }

  var run = read(KEY_RUN), rec = read(KEY_REC), at = Date.now();
  if (run && !(at < run.until)) { write(KEY_RUN, null); run = null; }
  if (rec && !(at < rec.until)) { write(KEY_REC, null); rec = null; }
  // The step is this page, or the page the step's screen sent us on to straight away (a screen that opens another).
  var asked = run && run.queue && run.queue[0], stepping = !!asked && (asked === page || (run.navAt && at - run.navAt < 10000 && page !== 'diagnostics.html'));
  var errors = [], calls = [];
  function noteError(kind, text) {
    text = String(text || '').slice(0, 300);
    if (!text || errors.length >= 30 || errors.some(function (e) { return e.text === text; })) return;
    errors.push({ kind: kind, text: text, at: ms(performance.now()) });
  }

  // Errors: script errors, promises nobody caught, and what the database and the app write to the console as errors.
  window.addEventListener('error', function (e) { noteError('script', (e.message || 'error') + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : '')); });
  window.addEventListener('unhandledrejection', function (e) { var r = e.reason; noteError('promise', r && (r.code ? r.code + ': ' : '') + (r && r.message || r)); });
  var consoleError = console.error;
  console.error = function () {
    try { noteError('console', [].map.call(arguments, function (a) { return a && a.message ? a.message : typeof a === 'string' ? a : JSON.stringify(a); }).join(' ')); } catch (x) { /* keep going */ }
    return consoleError.apply(console, arguments);
  };

  // Server calls (every save is one): time each, and keep its name, its save action and whether it failed.
  var realFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = String(input && input.url || input), m = /cloudfunctions\.net\/([A-Za-z0-9_-]+)|:5001\/[^/]+\/[^/]+\/([A-Za-z0-9_-]+)/.exec(url);
    if (!m) return realFetch.apply(this, arguments);
    var name = m[1] || m[2], action = '', start = performance.now();
    try { action = (JSON.parse(init && init.body || '{}').data || {}).action || ''; } catch (e) { /* not JSON */ }
    var call = { name: name, action: action, at: ms(start), ms: null, ok: null, error: '' };
    calls.push(call);
    if (calls.length > 50) calls.shift();
    return realFetch.apply(this, arguments).then(function (res) {
      call.ms = Math.round(performance.now() - start);
      call.ok = res.ok;
      if (!res.ok) res.clone().json().then(function (b) { call.error = String(b && b.error && (b.error.status + ': ' + b.error.message) || res.status).slice(0, 200); keep(); }).catch(function () { call.error = 'HTTP ' + res.status; keep(); });
      keep();
      return res;
    }, function (e) { call.ms = Math.round(performance.now() - start); call.ok = false; call.error = String(e && e.message || e).slice(0, 200); keep(); throw e; });
  };

  // When the screen showed (sign-in passed) and when it finished loading: the last time rows or cards were added, once
  // nothing more arrived for a little over a second. A live clock changing a number does not count as loading.
  var shownAt = null, lastBig = null, signedOut = false, done = false;
  function watch() {
    var screen = document.getElementById('screen'), gate = document.getElementById('signin'), box = document.getElementById('error');
    if (box) new MutationObserver(function () { if (!box.hidden && box.textContent.trim()) noteError('screen', box.textContent.trim()); }).observe(box, { attributes: true, childList: true, characterData: true, subtree: true });
    if (!screen) { shownAt = performance.now(); lastBig = shownAt; return; }
    var check = function () { if (shownAt === null && !screen.hidden) { shownAt = performance.now(); lastBig = shownAt; } };
    check();
    new MutationObserver(function (list) {
      check();
      if (shownAt === null) return;
      var added = 0;
      list.forEach(function (r) { r.addedNodes.forEach(function (n) { if (n.nodeType === 1) added += 1 + (n.getElementsByTagName ? n.getElementsByTagName('*').length : 0); }); });
      if (added >= 5) lastBig = performance.now();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true });
    setTimeout(function () { if (shownAt === null && gate && !gate.hidden) signedOut = true; }, SIGNIN_WAIT);
  }

  function result(capped) {
    var nav = performance.getEntriesByType('navigation')[0];
    return {
      page: page, title: (document.querySelector('#screen h1') || document.querySelector('h1') || {}).textContent || page,
      when: new Date().toISOString(),
      pageMs: nav ? ms(Math.max(nav.domContentLoadedEventEnd || nav.responseEnd, base)) : null,
      shownMs: shownAt === null ? null : ms(shownAt), loadedMs: lastBig === null ? null : ms(lastBig),
      stillChanging: !!capped, signedOut: signedOut,
      errors: errors.slice(), calls: calls.slice()
    };
  }

  // Record while I work: one line per screen opened, replaced as its calls finish; capped at LOG_MAX lines.
  var logLine = null;
  function keep() {
    if (!rec || stepping || page === 'diagnostics.html' || !done) return;
    var log = read(KEY_LOG) || [], line = result(false);
    line.id = logLine || (logLine = Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    var i = log.findIndex(function (x) { return x.id === line.id; });
    if (i >= 0) log[i] = line; else log.push(line);
    write(KEY_LOG, log.slice(-LOG_MAX));
  }

  function settle(then) {
    var began = performance.now();
    (function tick() {
      var now = performance.now();
      if (signedOut) return then(true);
      if (shownAt !== null && now - lastBig >= QUIET) return then(false);
      if (now - began > STEP_LIMIT) return then(true);
      setTimeout(tick, 200);
    })();
  }

  // A running check: note this screen, then open the next one in the same window. The last step goes back to Diagnostics.
  function banner(text) {
    var b = document.createElement('div');
    b.id = 'diag-banner';
    b.setAttribute('role', 'status');
    b.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;background:#fff4cc;color:#7a5600;border:1px solid #e8cf73;border-radius:10px;padding:10px 14px;font:600 14px system-ui,sans-serif;box-shadow:0 4px 14px #0002;display:flex;gap:12px;align-items:center';
    b.innerHTML = '<span></span><button type="button" style="height:30px;padding:0 12px;border:1px solid #e8cf73;border-radius:8px;background:#fff;color:#7a5600;font:inherit;cursor:pointer">Stop check</button>';
    b.firstChild.textContent = text;
    b.lastChild.onclick = function () { var r = read(KEY_RUN); if (r) { r.stopped = true; r.queue = []; write(KEY_RUN, r); } location.replace('diagnostics.html'); };
    document.body.appendChild(b);
  }
  function step() {
    var total = run.total || run.queue.length;
    banner('Diagnostics: checking ' + (total - run.queue.length + 1) + ' of ' + total + ' screens');
    settle(function (capped) {
      var r = read(KEY_RUN);
      if (!r || r.id !== run.id || r.queue[0] !== asked) return;
      var res = result(capped);
      res.asked = asked; // a screen that opens another (Home sends an administrator to the all-plants page) is noted, not an error
      r.results.push(res);
      r.queue.shift();
      r.navAt = Date.now();
      write(KEY_RUN, r);
      location.replace(r.queue.length ? r.queue[0] : 'diagnostics.html');
    });
  }

  // Administrators get Diagnostics in the Administration menu (and on a page that leaves a [data-sandbox-tools] slot).
  // Waits for the sign-in check to pass (it remembers the person for this tab).
  function addLink(tries) {
    var email = '';
    try { email = sessionStorage.getItem('udActive') || ''; } catch (e) { /* no storage */ }
    if (!email) { if ((tries || 0) < 60) setTimeout(function () { addLink((tries || 0) + 1); }, 500); return; }
    Promise.all([
      import('https://www.gstatic.com/firebasejs/' + FIREBASE + '/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/' + FIREBASE + '/firebase-firestore.js')
    ]).then(function (mods) {
      var tries = 0;
      (function wait() {
        var apps = mods[0].getApps();
        if (!apps.length) { if (++tries < 50) setTimeout(wait, 200); return; }
        var fs = mods[1];
        fs.getDoc(fs.doc(fs.getFirestore(apps[0]), 'users', email)).then(function (snap) {
          var u = snap.exists() ? snap.data() : null;
          var L = window.UDLogic;
          if (!(L && L.isAdmin ? L.isAdmin(u) : (u && u.status === 'ACTIVE' && (u.roles || []).indexOf('ADMINISTRATOR') >= 0))) return;
          var icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>';
          document.querySelectorAll('.side-flyouts .flyout').forEach(function (fly) {
            var t = fly.querySelector('.flyout-title');
            if (!t || t.textContent.trim() !== 'Administration' || fly.querySelector('a[href="diagnostics.html"]')) return;
            var a = document.createElement('a');
            a.href = 'diagnostics.html'; a.title = 'Diagnostics (sandbox only)'; a.className = 'diag-link' + (page === 'diagnostics.html' ? ' on' : '');
            a.innerHTML = icon + '<span>Diagnostics (sandbox)</span>';
            fly.appendChild(a);
          });
          // The Administration page (its tiles are drawn again on every filter): a Sandbox tools group at the end.
          var body = page === 'administration.html' && document.getElementById('body');
          if (body) {
            var addGroup = function () {
              if (!body.children.length || body.querySelector('.diag-group')) return;
              var g = document.createElement('section');
              g.className = 'adm-group diag-group';
              g.innerHTML = '<header><h2>Sandbox tools</h2><span>Only on the sandbox; the real app has none of this</span></header><div class="adm-tiles">' +
                '<a class="adm-tile" href="diagnostics.html" title="Check every screen and time loads and saves"><span class="adm-ic">' + icon + '</span><strong>Diagnostics</strong>' +
                '<small>Check every screen, time loads and saves, list slow and failed items</small><em>Open &rsaquo;</em></a></div>';
              body.appendChild(g);
            };
            addGroup();
            new MutationObserver(addGroup).observe(body, { childList: true });
          }
          document.querySelectorAll('[data-sandbox-tools]').forEach(function (slot) {
            if (slot.querySelector('a[href="diagnostics.html"]')) return;
            var a = document.createElement('a');
            a.href = 'diagnostics.html'; a.className = 'button'; a.textContent = 'Diagnostics (sandbox)';
            slot.appendChild(a); slot.hidden = false;
          });
        }).catch(function () { /* not allowed to read: no link */ });
      })();
    }).catch(function () { /* SDK not reachable: no link */ });
  }

  window.udDiag = { result: function () { return result(false); }, calls: calls, errors: errors };
  function begin() {
    watch();
    if (stepping) step();
    else settle(function () { done = true; keep(); });
    setTimeout(function () { addLink(0); }, 300);
  }
  function go() { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin); else begin(); }
  // A page Chrome got ready ahead of a click: nothing is noted until it is really shown.
  if (document.prerendering) document.addEventListener('prerenderingchange', function () { base = (nav0 && nav0.activationStart) || performance.now(); at = Date.now(); go(); }, { once: true });
  else go();
})();
