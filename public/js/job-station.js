/*
 * Review item 74 (Joe 10/13): the page code the Garage Station (garage-station.html) and the Maintenance Station
 * (maint-station.html) share. The current app's Garage Station (GarageStation.html, 7.0.276), reworked the way Joe asked
 * (10/10 evening): the open work orders come up first, with no sign-in. A mechanic taps a work order, then their name and
 * login ID, and Starts their own clock; Add another mechanic puts a second one on the same job with their own clock. One job
 * at a time: starting another stops the clock on the first, which stays open. Only Complete (name + login ID, what was fixed,
 * safe to drive or run, signature) closes it.
 *
 * mountJobStation(cfg) draws the work orders, one work order, Who are you? (name + login ID for every step) and the two
 * Complete screens, and returns what the page's own screens use (message, view, load, ask, signOut, busy ...). cfg says what
 * is the page's own:
 *   call(op, fields)     the station's server call; board() reads the work orders (onBoard(r) keeps the page's own lists)
 *   views                the page's own screens besides the shared ones (forms: those Cancel on Who are you? goes back to)
 *   purposes             { purpose: (who) => ... } the page's own steps after Who are you? (Report a Problem ...)
 *   asks                 the page's own Who are you? titles; signIn(tech, loginId) when the page signs in its own way
 *   step(who, job, op)   one clock step; complete(job, who, fields) the Complete step and doneText(job, who, safe, r)
 *   jobKey, jobLine, jobHead, jobLabel, problem, officeSource, downWord, unitClass, emptyJobs, noTechs, hideEmptyStrip, emptyStrip,
 *   completeName, safeQ, safeWord, safeYes   the words and looks that differ
 *   simple               Joe 10/28 (Garage Station, "mechanics that are not too technologically advanced"): one work order has a
 *                        big Back and three big buttons, Start Work, Pause and Complete (no Need Parts, no Stop per mechanic)
 *   filter, jobsTitle    the work orders the list shows (the Garage Station's card: trucks, trailers or fork trucks) and its title
 *   serviceFix(job)      a service's Complete skips "What did you fix?" (what it returns is the answer); its checklist
 *                        (job.checklist names one of the board's checklists) is answered on the work order first
 */
import { escapeHtml, goBack, hoursMinutesText } from './app.js';

const $ = (id) => document.getElementById(id);
const READY_MS = 2 * 60000;
export const names = (list) => list.length > 2 ? list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1] : list.join(' and ');
const mins = (iso) => { const m = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000)); return isFinite(m) ? m : 0; };
const hm = (m) => hoursMinutesText(m, { unit: 'm', pad: true });
const clock = (iso) => { const m = mins(iso); return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'); };
export const age = (iso) => { const m = mins(iso); if (!iso || !isFinite(Date.parse(iso))) return ''; return m < 60 ? m + ' min ago' : m < 1440 ? Math.floor(m / 60) + ' h ago' : Math.floor(m / 1440) + (m < 2880 ? ' day ago' : ' days ago'); };
export const first = (name) => { const p = String(name || '').split(/\s+/); return p.length > 1 && p[0] === p[0].toUpperCase() ? p.slice(1).join(' ') : p[0]; };
export const rid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/[^A-Za-z0-9_-]/g, '');

// Joe 10/28 (Garage Station, "mechanics that are not too technologically advanced"): a talk button by each notes box types what is said.
const MIC = (target) => '<button type="button" class="gs-mic" data-mic="%s" title="Talk instead of typing"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1A7 7 0 0 0 19 12z"/></svg>Talk</button>'.replace('%s', target);
function simpleJob() {
  return `
        <!-- Joe 10/28 (Garage Station): one work order has a big Back, what is wrong, who is on it, the notes (what I did today and the
             parts put on, typed or spoken), the service checklist, and four buttons. -->
        <section id="view-job" class="gs-stack gs-simple" hidden>
          <div class="gs-bar"><button type="button" class="gs-btn gs-back" data-go="jobs">&larr; Back</button><h2 id="job-unit"></h2></div>
          <div class="gs-scroll">
            <div class="gs-card"><div class="gs-written" id="job-written"></div><div class="gs-label" id="job-label"></div><div class="gs-problem" id="job-problem"></div><div class="gs-label" id="job-more"></div><div class="gs-now" id="job-now"></div></div>
            <div class="gs-card gs-crew"><div class="gs-label">Working on it now</div><div id="crew"></div><div class="gs-label" id="crew-done"></div></div>
            <div class="gs-card gs-notes">
              <div class="gs-nl"><label for="job-did">Notes / what I did today</label>${MIC('job-did')}</div>
              <textarea id="job-did" maxlength="1000" rows="2"></textarea>
              <div class="gs-nl"><label for="job-used">Parts put on</label>${MIC('job-used')}</div>
              <textarea id="job-used" maxlength="600" rows="2"></textarea>
              <p class="gs-hint">These go on the work order with your name when you press Pause, Waiting on Parts or Complete.</p>
              <div class="gs-log" id="job-log"></div>
            </div>
            <div class="gs-card gs-reading" id="job-reading" hidden></div>
            <div class="gs-card gs-checks" id="job-checks" hidden></div>
          </div>
          <div class="gs-four">
            <button type="button" class="gs-btn" id="job-start">Start Work</button>
            <button type="button" class="gs-btn amber" id="job-pause">Pause</button>
            <button type="button" class="gs-btn gray" id="job-parts">Waiting on Parts</button>
            <button type="button" class="gs-btn green" id="job-done">Complete</button>
          </div>
        </section>

        <!-- Waiting on Parts: the parts in the mechanic's own words. -->
        <section id="view-parts" class="gs-stack gs-simple" hidden>
          <div class="gs-bar"><button type="button" class="gs-btn gs-back" data-go="job">&larr; Back</button><h2 id="parts-unit"></h2></div>
          <div class="gs-card gs-notes">
            <div class="gs-nl"><label for="parts-need">What parts do you need? Name them your own way.</label>${MIC('parts-need')}</div>
            <textarea id="parts-need" maxlength="600" rows="4"></textarea>
          </div>
          <button type="button" class="gs-btn gray gs-go" id="parts-send">Waiting on Parts</button>
        </section>

        <!-- Joe 10/28 evening: a mechanic's first time, they sign once; it is kept on file and goes on every work order they complete. -->
        <section id="view-mysig" class="gs-stack gs-simple" hidden>
          <div class="gs-bar"><button type="button" class="gs-btn gs-back" id="mysig-back">&larr; Back</button><h2 id="mysig-title"></h2></div>
          <p class="gs-hint">Sign once with your finger. Your signature is kept on file and goes on every work order you complete.</p>
          <div class="gs-sigbox"><button type="button" class="gs-btn dark" id="mysig-clear">Clear</button><canvas id="mysig-pad"></canvas></div>
          <button type="button" class="gs-btn green gs-go" id="mysig-save">Keep my signature</button>
        </section>

        <!-- Complete, step 1: what was fixed, what you did and the parts put on (filled in from the notes). -->
        <section id="view-fix" class="gs-stack gs-simple" hidden>
          <div class="gs-bar"><button type="button" class="gs-btn gs-back" data-go="job">&larr; Back</button><h2 id="fix-unit"></h2><span class="gs-progress"><i class="on"></i><i></i></span></div>
          <div class="gs-scroll">
            <div class="gs-card" id="fix-pick"><div class="gs-label">What did you fix?</div><div class="gs-fixes" id="fixes"></div></div>
            <div class="gs-card gs-notes">
              <div class="gs-nl"><label for="fix-note">What did you do?</label>${MIC('fix-note')}</div>
              <textarea id="fix-note" maxlength="1000" rows="3"></textarea>
              <div class="gs-nl"><label for="fix-used">Parts put on</label>${MIC('fix-used')}</div>
              <textarea id="fix-used" maxlength="600" rows="2"></textarea>
            </div>
          </div>
          <button type="button" class="gs-btn green gs-go" id="fix-next">Next</button>
        </section>
`;
}
// The shared screens, put in after the work orders: one work order, Who are you?, and Complete's two steps.
function sharedScreens(safeYes, simple) {
  return (simple ? simpleJob() : '') + `
        <!-- One work order: who is on it, each mechanic's clock, Start / Add another mechanic / Need Parts / Complete.
             Review item 57 (Joe 10/13): these buttons are words only (no ▶ ⏳ ✔ ■ icons). -->
        ${simple ? '' : `<section id="view-job" class="gs-stack" hidden>
          <div class="gs-bar"><button type="button" class="gs-btn dark" data-go="jobs">&larr; Work Orders</button><h2 id="job-unit"></h2></div>
          <div class="gs-card"><div class="gs-label" id="job-label"></div><div class="gs-problem" id="job-problem"></div><div class="gs-now" id="job-now"></div></div>
          <div class="gs-card gs-crew"><div class="gs-label">On this job</div><div id="crew"></div><div class="gs-label" id="crew-done"></div></div>
          <div class="gs-two">
            <button type="button" class="gs-btn" id="job-start">Start work</button>
            <button type="button" class="gs-btn gray" id="job-parts">Need Parts</button>
          </div>
          <button type="button" class="gs-btn green gs-done" id="job-done">Complete</button>
        </section>`}

        <!-- Who are you? Name, then the login ID, for every step. -->
        <section class="gs-sign" id="view-sign" hidden>
          <div class="gs-card">
            <h2 id="sign-title">Who are you?</h2>
            <p class="gs-hint" id="sign-hint">Tap your name, then your login ID.</p>
            <div class="gs-names" id="names"></div>
          </div>
          <div class="gs-card">
            <h2 id="pin-title">Tap your name</h2>
            <div class="gs-dots" id="dots"></div>
            <div class="gs-keys" id="keys"></div>
            <button type="button" class="gs-btn dark" id="sign-cancel">Cancel</button>
          </div>
        </section>

        ${simple ? '' : `<!-- Complete, step 1: what was fixed -->
        <section id="view-fix" class="gs-stack" hidden>
          <div class="gs-bar"><button type="button" class="gs-btn dark" data-go="job">&larr; Back</button><h2 id="fix-unit"></h2><span class="gs-progress"><i class="on"></i><i></i></span></div>
          <p class="gs-q">What did you fix?</p>
          <input class="gs-note" id="fix-note" maxlength="300" placeholder="Anything to add? (you can leave this empty)">
          <div class="gs-fixes" id="fixes"></div>
        </section>`}

        <!-- Complete, step 2: safe to drive (or run) + finger signature -->
        <section id="view-safe" class="gs-stack" hidden>
          <div class="gs-bar"><button type="button" class="gs-btn dark" data-go="fix">&larr; Back</button><h2 id="safe-unit"></h2><span class="gs-progress"><i class="on"></i><i class="on"></i></span></div>
          <p class="gs-q" id="safe-q"></p>
          <div class="gs-yesno"><button type="button" class="gs-btn green" data-safe="yes">${escapeHtml(safeYes)}</button><button type="button" class="gs-btn line" data-safe="no">No, still down</button></div>
          <div class="gs-label" id="sign-line">Sign with your finger</div>
          <div class="gs-sigbox"><button type="button" class="gs-btn dark" id="sig-clear">Clear</button><canvas id="sig"></canvas></div>
          <img id="sig-file" class="gs-sigfile" alt="Signature on file" hidden>
          <button type="button" class="gs-btn green" id="finish">Complete Work Order</button>
        </section>
`;
}

// A finger signature box: draw, clear, and a small PNG of it (kept under 29,000 characters).
function makePad(canvas) {
  const ctx = canvas.getContext('2d');
  let inked = false, drawing = false;
  const pt = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', e => { drawing = true; canvas.setPointerCapture(e.pointerId); const [x, y] = pt(e); ctx.beginPath(); ctx.moveTo(x, y); });
  canvas.addEventListener('pointermove', e => { if (!drawing) return; const [x, y] = pt(e); ctx.lineTo(x, y); ctx.stroke(); inked = true; });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => canvas.addEventListener(t, () => { drawing = false; }));
  const small = (scale) => {
    const w = Math.min(480, canvas.width) * (scale || 1), h = Math.round(canvas.height * w / canvas.width), c = document.createElement('canvas');
    c.width = Math.round(w); c.height = h;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(canvas, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/png');
    return url.length > 29000 && (scale || 1) > 0.2 ? small((scale || 1) / 2) : url;
  };
  return {
    size: () => requestAnimationFrame(() => {
      const r = canvas.getBoundingClientRect(); if (!r.width) return;
      canvas.width = Math.round(r.width); canvas.height = Math.round(r.height); inked = false;
      ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b4f86';
    }),
    clear: () => { inked = false; ctx.clearRect(0, 0, canvas.width, canvas.height); },
    inked: () => inked, small: () => small()
  };
}

export function mountJobStation(cfg) {
  const forms = cfg.forms || ['report'];
  const VIEWS = ['sign', 'jobs', 'job', 'fix', 'safe'].concat(cfg.simple ? ['parts', 'mysig'] : ['report'], cfg.views || []);
  $('view-jobs').insertAdjacentHTML('afterend', sharedScreens(cfg.safeYes, cfg.simple));
  let techs = [], jobs = [], fixes = [], checklists = {};
  let open = null, want = null, picked = null, typed = '', ready = null, finisher = null;
  let fixPick = '', safePick = null, inked = false, lastTouch = Date.now();
  // busy: a step is being sent; the page's own steps set it too.
  const S = { busy: false };

  /* ---------- Joe 10/28 (simple): notes, checklist answers and talk-to-type, kept on the tablet until a step sends them ---------- */
  const keep = (kind, j) => 'udJob' + kind + ':' + cfg.jobKey(j);
  const kept = (kind, j) => { try { return JSON.parse(localStorage.getItem(keep(kind, j)) || 'null') || {}; } catch (e) { return {}; } };
  const putKept = (kind, j, v) => { try { if (v) localStorage.setItem(keep(kind, j), JSON.stringify(v)); else localStorage.removeItem(keep(kind, j)); } catch (e) { /* full */ } };
  // A job started from a write-up gets its work order number: what was kept under the write-up moves to it.
  const moveKept = (from, to) => ['Notes', 'Checks'].forEach(k => { const v = kept(k, from); if (Object.keys(v).length && !Object.keys(kept(k, to)).length) { putKept(k, to, v); putKept(k, from, null); } });
  const notesOf = (j) => { const n = kept('Notes', j); return { did: String(n.did || '').trim(), used: String(n.used || '').trim() }; };
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  document.querySelectorAll('[data-mic]').forEach(b => { b.hidden = !Rec; });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-mic]'); if (!b || !Rec) return;
    if (b.rec) { b.rec.stop(); return; }
    const box = $(b.dataset.mic), r = new Rec();
    r.lang = 'en-US'; r.interimResults = false; r.continuous = false;
    r.onresult = (ev) => {
      const said = Array.from(ev.results).map(x => x[0].transcript).join(' ').trim();
      if (said) { box.value = (box.value.trim() ? box.value.trim() + ' ' : '') + said; box.dispatchEvent(new Event('input', { bubbles: true })); }
    };
    r.onerror = (ev) => { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') message('The tablet did not let the app use the microphone. Type it instead.'); };
    r.onend = () => { b.rec = null; b.classList.remove('on'); };
    b.rec = r; b.classList.add('on');
    try { r.start(); } catch (err) { b.rec = null; b.classList.remove('on'); }
  });

  const signOut = (token) => { if (token) cfg.call('signOut', { tokens: [token] }).catch(() => {}); };
  function message(text, ok) { const m = $('gs-message'); m.textContent = text || ''; m.hidden = !text; m.classList.toggle('ok', !!ok); }
  function view(v) { VIEWS.forEach(k => { $('view-' + k).hidden = k !== v; }); if (v === 'safe') sizeCanvas(); if (v === 'mysig') myPad.size(); }
  const shownView = () => VIEWS.find(k => !$('view-' + k).hidden);

  async function load() {
    const r = await cfg.board();
    techs = r.techs; fixes = r.fixes; jobs = r.jobs; checklists = r.checklists || {};
    if (cfg.onBoard) cfg.onBoard(r);
    if (open) open = jobs.find(j => cfg.jobKey(j) === cfg.jobKey(open) || (open.id && j.id === open.id)) || null;
    draw();
    if (!open && shownView() === 'job') view('jobs');
  }
  function draw() {
    const on = techs.filter(t => t.on);
    if ($('people')) $('people').innerHTML = on.length ? '<span class="gs-onclock">On the clock:</span>' + on.map(t => '<span class="p"><i>' + escapeHtml(t.name.slice(0, 1)) + '</i>' + escapeHtml(first(t.name)) + ' <small>' + escapeHtml(t.on.unit) + '</small></span>').join('') : '';
    drawJobs(); drawSign();
    if (open) drawJob();
  }

  /* ---------- work orders ---------- */
  function rowClass(j) { return j.status === 'PARTS' ? 'parts' : j.onNow.length ? 'working' : !j.canRun ? 'down' : j.source === cfg.officeSource ? 'office' : ''; }
  const shown = () => { const list = cfg.filter ? jobs.filter(cfg.filter) : jobs; return cfg.arrange ? cfg.arrange(list) : list; };
  function drawJobs() {
    const list = shown();
    $('jobs-title').textContent = cfg.jobsTitle ? cfg.jobsTitle(list) : 'Work Orders' + (list.length ? ' · ' + list.length + ' open' : '');
    if ($('strip')) drawStrip();
    $('jobs').innerHTML = list.map((j, i) => {
      const subs = ['<small>' + escapeHtml(cfg.jobLine(j)) + (j.createdAt ? ' · ' + age(j.createdAt) : '') + '</small>'];
      if (cfg.written && cfg.written(j)) subs.unshift('<small class="gs-written">' + escapeHtml(cfg.written(j)) + '</small>');
      if (j.more && j.more.length) subs.push('<small>Also written: ' + escapeHtml(j.more.join(' · ')) + '</small>');
      if (j.onNow.length) subs.push('<small class="green">On it now: ' + escapeHtml(names(j.onNow.map(p => first(p.name) + ' ' + clock(p.since)))) + '</small>');
      else if (j.status === 'WORKING') subs.push('<small>Started · nobody on it now</small>');
      if (j.status === 'PARTS') subs.push('<small>WAITING ON PARTS</small>');
      if (!j.canRun && j.status !== 'PARTS') subs.push('<small class="red">' + escapeHtml(cfg.downWord) + '</small>');
      return '<div class="gs-job ' + rowClass(j) + (cfg.isNew && cfg.isNew(j) ? ' gs-new' : '') + '" data-i="' + i + '"><span class="' + cfg.unitClass + '">' + escapeHtml(j.unit) + '</span><span class="what">' + escapeHtml(cfg.problem(j)) + subs.join('') + '</span>' +
        '<button type="button" class="gs-btn ' + (j.onNow.length ? 'green' : j.status === 'PARTS' ? 'gray' : '') + '" data-i="' + i + '">Open</button></div>';
    }).join('') || '<p class="gs-empty">' + escapeHtml(typeof cfg.emptyJobs === 'function' ? cfg.emptyJobs() : cfg.emptyJobs) + '</p>';
  }
  function drawStrip() {
    // Review item 48 (Joe 10/13, Maintenance Station): no "Mechanics:" with nothing after it; the line shows once there are mechanics.
    // Joe 10/27 (Maintenance Station): with no mechanics yet, the line says where they are added (cfg.emptyStrip) instead.
    if (cfg.hideEmptyStrip) $('strip').hidden = !techs.length && !cfg.emptyStrip;
    if (!techs.length && cfg.emptyStrip) { $('strip').innerHTML = '<span class="gs-hint">' + escapeHtml(cfg.emptyStrip) + '</span>'; }
    else $('strip').innerHTML = '<span class="gs-label">Mechanics:</span>' + techs.map(t => '<button type="button" class="gs-chip' + (t.on ? ' on' : '') + '" data-tech="' + escapeHtml(t.id) + '">' + escapeHtml(t.name) +
      '<small>' + (t.on ? escapeHtml(t.on.unit) + ' · ' + clock(t.on.since) : 'free') + '</small></button>').join('');
  }
  $('jobs').addEventListener('click', e => { const row = e.target.closest('[data-i]'); if (!row) return; open = shown()[Number(row.dataset.i)]; if (cfg.onOpen) cfg.onOpen(open); message(''); drawJob(); view('job'); });
  // A mechanic's own name: their job, or ready to tap one.
  if ($('strip')) $('strip').addEventListener('click', e => { const b = e.target.closest('[data-tech]'); if (b) ask('me', null, b.dataset.tech); });

  function drawJob() {
    if (cfg.simple) { drawSimpleJob(); return; }
    const j = open;
    $('job-unit').textContent = cfg.jobHead(j);
    $('job-label').textContent = cfg.jobLabel(j) + (j.createdAt ? ' · ' + age(j.createdAt) : '') + (j.canRun ? '' : ' · ' + cfg.downWord);
    $('job-problem').textContent = cfg.problem(j);
    $('job-now').textContent = j.status === 'PARTS' ? 'Waiting on parts' : '';
    $('crew').innerHTML = j.onNow.map(p => '<div class="gs-clock"><i>' + escapeHtml(p.name.slice(0, 1)) + '</i><b>' + escapeHtml(p.name) + '</b><span class="t">' + clock(p.since) + '</span>' +
      '<button type="button" class="gs-btn dark" data-stop="' + escapeHtml(p.id) + '">Stop</button></div>').join('') || '<p class="gs-hint">Nobody is on this job right now.</p>';
    const done = {}; (j.labor || []).forEach(s => { done[s.name] = (done[s.name] || 0) + s.minutes; });
    const list = Object.keys(done);
    $('crew-done').textContent = list.length ? 'Time so far: ' + list.map(n => first(n) + ' ' + hm(done[n])).join(', ') + (list.length > 1 ? ' · total ' + hm(j.laborMinutes) : '') : '';
    $('job-start').innerHTML = j.onNow.length ? 'Add another mechanic' : 'Start work';
    $('job-start').hidden = j.status === 'PARTS';
    $('job-parts').innerHTML = j.status === 'PARTS' ? 'Parts are here' : 'Need Parts';
  }
  const when = (iso) => { const d = new Date(iso); return isFinite(d) ? (d.getMonth() + 1) + '-' + d.getDate() + '-' + String(d.getFullYear()).slice(2) : ''; };
  // Joe 10/28: Start Work, Pause, Waiting on Parts (Parts are here once it waits) and Complete; the notes boxes; the checklist.
  function drawSimpleJob() {
    const j = open;
    $('job-unit').textContent = cfg.jobHead(j);
    $('job-label').textContent = cfg.jobLabel(j) + (j.createdAt ? ' · ' + age(j.createdAt) : '') + (j.canRun ? '' : ' · ' + cfg.downWord);
    $('job-problem').textContent = cfg.problem(j);
    $('job-written').textContent = cfg.written ? cfg.written(j) : '';
    $('job-more').textContent = j.more && j.more.length ? 'Also written: ' + j.more.join(' · ') : '';
    $('job-now').textContent = j.status === 'PARTS' ? 'Waiting on parts' + (j.partsNeeded ? ': ' + j.partsNeeded : '') : '';
    $('crew').innerHTML = j.onNow.map(p => '<div class="gs-clock"><i>' + escapeHtml(p.name.slice(0, 1)) + '</i><b>' + escapeHtml(p.name) + '</b><span class="t">' + clock(p.since) + '</span></div>').join('') ||
      '<p class="gs-hint">Nobody is working on it right now.</p>';
    const done = {}; (j.labor || []).forEach(s => { done[s.name] = (done[s.name] || 0) + s.minutes; });
    const list = Object.keys(done);
    $('crew-done').textContent = list.length ? 'Time so far: ' + list.map(n => first(n) + ' ' + hm(done[n])).join(', ') + (list.length > 1 ? ' · total ' + hm(j.laborMinutes) : '') : '';
    const n = kept('Notes', j);
    if (document.activeElement !== $('job-did')) $('job-did').value = n.did || '';
    if (document.activeElement !== $('job-used')) $('job-used').value = n.used || '';
    $('job-log').innerHTML = (j.notesLog || []).slice().reverse().map(e => '<div><b>' + escapeHtml(when(e.at) + ' ' + first(e.by)) + ':</b> ' +
      escapeHtml([e.did, e.used ? 'Parts put on: ' + e.used : '', e.parts ? 'Waiting on parts: ' + e.parts : ''].filter(Boolean).join(' · ')) + '</div>').join('');
    $('job-start').textContent = j.status === 'PARTS' ? 'Parts are here' : 'Start Work';
    $('job-parts').hidden = j.status === 'PARTS';
    const key = cfg.jobKey ? cfg.jobKey(j) : j.id;
    if (key !== seenKey) { seenKey = key; seenBottom = false; showNeed = false; }
    drawChecks();
    requestAnimationFrame(() => { if (atBottom()) seenBottom = true; drawLock(); });
  }
  // Joe 10/28 evening: on a service, Complete stays locked until every checklist line is marked and the mechanic has scrolled to
  // the bottom of the work order. Pressed early, it says what is left and takes them to the first line not marked (red).
  let seenBottom = false, seenKey = '', showNeed = false;
  const scroller = () => document.querySelector('#view-job .gs-scroll');
  function atBottom() { const s = scroller(); return !s || s.scrollTop + s.clientHeight >= s.scrollHeight - 8; }
  function doneLocked(j) { return !!checkList(j) && (checksLeft(j) > 0 || readingLeft(j).length > 0 || !seenBottom); }
  // Joe 10/28 evening: a service's hours, a truck's miles (the GPS's filled in when it has them) and the day it was finished.
  // Today in New York (the plant's day), not the computer's own clock zone, so the day finished matches what the save allows.
  const todayKey = () => { const p = {}; new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).forEach(x => { p[x.type] = x.value; }); return p.year + '-' + p.month + '-' + p.day; };
  function readingOf(j) {
    const a = kept('Checks', j), r = j.reading || {}, pick = (k, v) => a[k] !== undefined ? a[k] : v == null ? '' : String(v);
    return { hours: pick('~hours', r.hours), miles: j.type === 'TRUCK' ? pick('~miles', r.miles) : null, on: pick('~on', todayKey()) };
  }
  function readingLeft(j) {
    const v = readingOf(j);
    return [['hours', 'the hours'], ['miles', 'the miles'], ['on', 'the day it was finished']].filter(([k]) => v[k] !== null && !String(v[k]).trim()).map(([, w]) => w);
  }
  function drawReading() {
    const j = open, box = $('job-reading');
    box.hidden = !checkList(j);
    if (box.hidden) { box.innerHTML = ''; return; }
    const v = readingOf(j), r = j.reading || {}, from = (k) => r[k] != null ? ' <small>(GPS' + (k === 'miles' && r.milesFrom === 'DVIR' ? ' / driver' : '') + ')</small>' : '';
    const need = (k) => showNeed && !String(v[k]).trim() ? ' need' : '';
    box.innerHTML = '<div class="gs-label">Hours, miles and the day it was finished</div><div class="gs-read">' +
      '<label class="' + need('hours') + '"><span>Hours' + from('hours') + '</span><input type="text" inputmode="decimal" maxlength="9" data-read="~hours" value="' + escapeHtml(v.hours) + '"></label>' +
      (v.miles !== null ? '<label class="' + need('miles') + '"><span>Miles' + from('miles') + '</span><input type="text" inputmode="numeric" maxlength="9" data-read="~miles" value="' + escapeHtml(v.miles) + '"></label>' : '') +
      '<label class="' + need('on') + '"><span>Day finished</span><input type="date" max="' + todayKey() + '" data-read="~on" value="' + escapeHtml(v.on) + '"></label></div>';
  }
  function drawLock() { if (cfg.simple && open) $('job-done').classList.toggle('locked', doneLocked(open)); }
  function checkList(j) { return j && j.checklist ? checklists[j.checklist] || null : null; }
  // A line is done once it is marked, and (tread depth) each of its 8 tires has a depth; the depths are kept as 'tread~lfo'.
  const lineDone = (i, a) => !!a[i.id] && (!i.tires || i.tires.every(t => String(a[i.id + '~' + t.key] || '').trim() !== ''));
  function checksLeft(j) { const list = checkList(j), a = kept('Checks', j); return list ? list.reduce((n, sec) => n + sec.items.filter(i => !lineDone(i, a)).length, 0) : 0; }
  function checkCount() {
    const list = checkList(open); if (!list || !$('ck-count')) return;
    const all = list.reduce((n, sec) => n + sec.items.length, 0); $('ck-count').textContent = 'Checklist · ' + (all - checksLeft(open)) + ' of ' + all + ' done';
  }
  function drawChecks() {
    const j = open, list = checkList(j), box = $('job-checks');
    box.hidden = !list;
    drawReading();
    if (!list) { box.innerHTML = ''; return; }
    const a = kept('Checks', j), all = list.reduce((n, sec) => n + sec.items.length, 0);
    const R = [['OK', 'OK'], ['FIX', 'Needs work'], ['NA', 'N/A']];
    box.innerHTML = '<div class="gs-label" id="ck-count"></div>' + list.map(sec => '<h3>' + escapeHtml(sec.section) + '</h3>' +
      sec.items.map(i => '<div class="gs-ck' + (a[i.id] ? ' ' + a[i.id].toLowerCase() : '') + (showNeed && !lineDone(i, a) ? ' need' : '') + '" data-row="' + escapeHtml(i.id) + '"><span>' + escapeHtml(i.text) + '</span>' +
        R.filter(([r]) => !(i.tires && r === 'NA')).map(([r, w]) => '<button type="button" class="gs-ckb' + (a[i.id] === r ? ' on' : '') + '" data-ck="' + escapeHtml(i.id) + '" data-r="' + r + '">' + w + '</button>').join('') +
        (i.tires ? '<div class="gs-tires">' + i.tires.map(t => '<label><span>' + escapeHtml(t.name) + '</span><input type="text" inputmode="decimal" maxlength="5" data-tire="' + escapeHtml(i.id + '~' + t.key) + '" value="' +
          escapeHtml(a[i.id + '~' + t.key] || '') + '"></label>').join('') + '</div>' : '') + '</div>').join('')).join('');
    checkCount();
    drawLock();
  }
  if (cfg.simple) {
    $('job-checks').addEventListener('click', e => {
      const b = e.target.closest('[data-ck]'); if (!b || !open) return;
      const a = kept('Checks', open); a[b.dataset.ck] = a[b.dataset.ck] === b.dataset.r ? undefined : b.dataset.r; putKept('Checks', open, a); drawChecks();
    });
    $('job-reading').addEventListener('input', e => {
      const t = e.target.closest('[data-read]'); if (!t || !open) return;
      const a = kept('Checks', open); a[t.dataset.read] = t.dataset.read === '~on' ? t.value : t.value.replace(/[^\d.,]/g, ''); putKept('Checks', open, a);
      if (showNeed) t.closest('label').classList.toggle('need', !t.value.trim());
      drawLock();
    });
    // A tire's depth: kept as it is typed (no redraw, so the box keeps the cursor); the count and Complete follow it.
    $('job-checks').addEventListener('input', e => {
      const t = e.target.closest('[data-tire]'); if (!t || !open) return;
      const a = kept('Checks', open); a[t.dataset.tire] = t.value.replace(/[^\d.]/g, ''); putKept('Checks', open, a);
      const id = t.dataset.tire.split('~')[0], i = checkList(open).flatMap(s => s.items).find(x => x.id === id), row = t.closest('.gs-ck');
      if (row && showNeed) row.classList.toggle('need', !lineDone(i, a));
      checkCount(); drawLock();
    });
    ['job-did', 'job-used'].forEach(id => $(id).addEventListener('input', () => { if (!open) return; const n = kept('Notes', open); n[id === 'job-did' ? 'did' : 'used'] = $(id).value; putKept('Notes', open, n); }));
    $('job-start').addEventListener('click', () => ask(open.status === 'PARTS' ? 'resume' : open.onNow.length ? 'helper' : 'start', open));
    $('job-pause').addEventListener('click', () => { if (!open.onNow.length) { message('Nobody is working on ' + open.unit + ' right now.'); return; } ask('stop', open); });
    $('job-parts').addEventListener('click', () => { $('parts-unit').textContent = 'Waiting on parts: ' + open.unit; $('parts-need').value = ''; message(''); view('parts'); });
    $('parts-send').addEventListener('click', () => { if (!$('parts-need').value.trim()) { message('Name the parts you need.'); return; } ask('parts', open); });
    scroller().addEventListener('scroll', () => { if (!seenBottom && open && atBottom()) { seenBottom = true; drawLock(); } }, { passive: true });
    $('job-done').addEventListener('click', () => {
      const left = checksLeft(open);
      if (left) {
        showNeed = true; drawChecks();
        message('Mark every line of the checklist before Complete: ' + left + ' left (in red).');
        const row = $('job-checks').querySelector('.gs-ck.need'); if (row) row.scrollIntoView({ block: 'center' });
        return;
      }
      const read = checkList(open) ? readingLeft(open) : [];
      if (read.length) {
        showNeed = true; drawReading();
        message('Fill in ' + read.join(' and ') + ' before Complete (in red).');
        $('job-reading').scrollIntoView({ block: 'center' });
        return;
      }
      if (doneLocked(open)) { message('Scroll down and look over the whole work order before Complete.'); return; }
      ask('complete', open);
    });
  } else {
    $('job-start').addEventListener('click', () => ask(open.onNow.length ? 'helper' : 'start', open));
    $('job-parts').addEventListener('click', () => ask(open.status === 'PARTS' ? 'resume' : 'parts', open));
    $('job-done').addEventListener('click', () => ask('complete', open));
  }
  $('crew').addEventListener('click', e => { const b = e.target.closest('[data-stop]'); if (b) ask('stop', open, b.dataset.stop); });
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => { const v = b.dataset.go; if (v === 'jobs') { open = null; drawJobs(); } view(v); }));

  /* ---------- who are you? (name + login ID for every step) ---------- */
  const ASK = Object.assign({
    start: (j) => ['Start work on ' + j.unit, 'Tap your name, then your login ID. Your clock starts.'],
    helper: (j) => ['Add another mechanic to ' + j.unit, 'The mechanic joining taps their name, then their login ID.'],
    stop: (j) => [(cfg.simple ? 'Pause ' : 'Stop your clock on ') + j.unit, (cfg.simple ? 'Your clock stops. ' : '') + 'The job stays open. Enter your login ID.'],
    parts: (j) => ['Need parts for ' + j.unit, 'Every clock on this job stops until the parts are here.'],
    resume: (j) => ['Parts are here: ' + j.unit, 'Tap your name, then your login ID. Your clock starts.'],
    complete: (j) => ['Complete ' + j.unit, 'Who completed it? Tap your name, then your login ID.'],
    report: () => ['Report a Problem', 'Who is reporting it? Tap your name, then your login ID.']
  }, cfg.asks || {}, { me: () => ['Who are you?', 'Tap your name, then your login ID.'] });
  function ask(purpose, job, techId) {
    message('');
    // A mechanic who just entered their login ID on their name goes straight on.
    if (ready && Date.now() < ready.until && job && ['start', 'helper', 'resume'].indexOf(purpose) >= 0) { const r = ready; ready = null; run(purpose, job, r); return; }
    want = { purpose, job }; picked = techId ? techs.find(t => t.id === techId) || null : null; typed = '';
    drawSign(); view('sign');
  }
  function drawSign() {
    const [title, hint] = want ? ASK[want.purpose](want.job || {}) : ASK.me();
    $('sign-title').textContent = title; $('sign-hint').textContent = hint;
    const busyHere = (t) => t.on && want && want.job && t.on.id === want.job.id;
    $('names').innerHTML = techs.map(t => {
      const on = picked && picked.id === t.id;
      return '<button type="button" class="gs-name' + (on ? ' on' : '') + '" data-who="' + escapeHtml(t.id) + '">' + escapeHtml(t.name) + '<small>' + (on ? 'enter login ID' : busyHere(t) ? 'on this job' : t.on ? 'on ' + escapeHtml(t.on.unit) : '&nbsp;') + '</small></button>';
    }).join('') || '<p class="gs-hint">' + escapeHtml(cfg.noTechs) + '</p>';
    $('pin-title').textContent = picked ? picked.name + ', your login ID' : 'Tap your name';
    $('dots').innerHTML = [0, 1, 2, 3, 4, 5].map(i => '<i class="' + (i < typed.length ? 'on' : '') + (i === 5 ? ' extra' : '') + '"></i>').join('');
    $('keys').innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'go'].map(k => k === 'go' ? '<button type="button" class="go" data-key="go"' + (typed.length >= 5 && !S.busy ? '' : ' disabled') + '>Enter</button>' :
      k === 'del' ? '<button type="button" class="small" data-key="del" title="Hold to clear">&#9003;</button>' : '<button type="button" data-key="' + k + '">' + k + '</button>').join('');
  }
  $('names').addEventListener('click', e => { const b = e.target.closest('[data-who]'); if (!b) return; picked = techs.find(t => t.id === b.dataset.who); typed = ''; message(''); drawSign(); });
  let holdTimer = null;
  $('keys').addEventListener('pointerdown', e => { if (e.target.closest('[data-key="del"]')) holdTimer = setTimeout(() => { holdTimer = 'held'; typed = ''; drawSign(); }, 600); });
  $('keys').addEventListener('click', async e => {
    const b = e.target.closest('[data-key]');
    if (!b || S.busy) return;
    if (!picked) { message('Tap your name first.'); return; }
    const k = b.dataset.key;
    if (k === 'del') { if (holdTimer === 'held') { holdTimer = null; return; } clearTimeout(holdTimer); typed = typed.slice(0, -1); drawSign(); return; }
    if (k !== 'go') { if (typed.length < 6) typed += k; drawSign(); return; }
    S.busy = true; drawSign();
    let who;
    try { who = await (cfg.signIn ? cfg.signIn(picked, typed) : cfg.call('signIn', { techId: picked.id, loginId: typed, tokens: [] })); }
    catch (err) { typed = ''; message(err.message); S.busy = false; drawSign(); return; }
    const w = want || { purpose: 'me' };
    want = null; picked = null; typed = ''; S.busy = false;
    // Joe 10/28 evening: no signature on file yet, so this mechanic signs once before the step.
    if (cfg.simple) {
      who.signature = who.signature || sigOnTablet(who.id);
      if (who.signature) keepSig(who.id, who.signature);
      else { signing = { w, who }; $('mysig-title').textContent = who.name + ', sign once'; myPad.clear(); view('mysig'); drawSign(); return; }
    }
    await run(w.purpose, w.job, who);
    drawSign();
  });
  // The signature on file: the server's (from sign-in), kept on the tablet too for when there is no signal.
  let signing = null;
  const sigOnTablet = (id) => { try { return localStorage.getItem('udGarageSig:' + id) || ''; } catch (e) { return ''; } };
  const keepSig = (id, url) => { try { localStorage.setItem('udGarageSig:' + id, url); } catch (e) { /* full */ } };
  const myPad = cfg.simple ? makePad($('mysig-pad')) : null;
  if (cfg.simple) {
    $('mysig-clear').addEventListener('click', () => myPad.clear());
    $('mysig-back').addEventListener('click', () => { const s = signing; signing = null; message(''); if (s && s.who.token) signOut(s.who.token); view(s && s.w.job ? 'job' : 'jobs'); });
    $('mysig-save').addEventListener('click', async () => {
      if (!signing || S.busy) return;
      if (!myPad.inked()) { message('Sign with your finger in the box.'); return; }
      const { w, who } = signing, url = myPad.small();
      S.busy = true; message('Saving…', true);
      try { await cfg.saveSignature(who, url); }
      catch (err) { S.busy = false; message(err.message); return; }
      S.busy = false; signing = null; who.signature = url; keepSig(who.id, url);
      await run(w.purpose, w.job, who);
    });
  }
  function cancelSign() { const w = want; want = null; picked = null; typed = ''; drawSign(); view(w && w.job ? (cfg.simple && w.purpose === 'parts' ? 'parts' : 'job') : w && forms.indexOf(w.purpose) >= 0 ? w.purpose : 'jobs'); }
  $('sign-cancel').addEventListener('click', cancelSign);

  // One step for the mechanic who just entered their login ID.
  async function run(purpose, job, who) {
    if (purpose === 'me') {
      const t = techs.find(x => x.id === who.id), mine = t && t.on && jobs.find(j => j.id === t.on.id);
      if (mine) { signOut(who.token); open = mine; drawJob(); view('job'); message(who.name + ': your clock is running on ' + mine.unit + '.', true); return; }
      ready = { token: who.token, id: who.id, name: who.name, loginId: who.loginId, offline: who.offline, until: Date.now() + READY_MS };
      open = null; drawJobs(); view('jobs'); message(who.name + ': tap the work order you are starting.', true); return;
    }
    if (purpose === 'complete') { finisher = who; startComplete(); return; }
    if (cfg.purposes && cfg.purposes[purpose]) { await cfg.purposes[purpose](who); return; }
    const op = { start: 'START', helper: 'HELPER', resume: 'RESUME', stop: 'STOP', parts: 'PARTS' }[purpose];
    S.busy = true; message('Saving…', true);
    try {
      // Joe 10/28 (simple): the notes typed on the work order (and the parts waited on) go with the step under this mechanic's name.
      const notes = cfg.simple && op !== 'HELPER' && op !== 'START' && op !== 'RESUME' ? notesOf(job) : null;
      const extra = notes ? Object.assign({ did: notes.did, used: notes.used }, op === 'PARTS' ? { partsNeeded: $('parts-need').value.trim() } : {}) : {};
      const r = await cfg.step(who, job, op, extra);
      if (notes) putKept('Notes', job, null);
      if (r.job && r.job.id && !job.id) moveKept(job, r.job);
      if (r.queued) { message(who.name + ': saved on this tablet. It will send when you have signal.', true); open = null; view('jobs'); return; }
      const moved = r.stoppedOn && r.stoppedOn.length ? ' Stopped ' + first(who.name) + '\'s clock on ' + r.stoppedOn.join(', ') + ' (still open).' : '';
      message({ START: who.name + ' started on ' + job.unit + '.', HELPER: who.name + ' joined ' + job.unit + '.', RESUME: who.name + ' started on ' + job.unit + ' again.',
        STOP: who.name + ' stopped. ' + job.unit + ' stays open.', PARTS: job.unit + ' is waiting on parts. Clocks stopped.' }[op] + moved, true);
      if (r.job) open = Object.assign({}, r.job);
      await load();
      if (op === 'PARTS' || op === 'STOP') { open = null; view('jobs'); } else { view('job'); if (open) drawJob(); }
    } catch (err) { message(err.message); view(open ? 'job' : 'jobs'); }
    finally { S.busy = false; signOut(who.token); }
  }

  /* ---------- Complete ---------- */
  function startComplete() {
    fixPick = ''; $('fix-note').value = ''; $('fix-unit').textContent = cfg.completeName(open) + ' · Complete'; drawFixes();
    if (cfg.simple) {
      // Joe 10/28: Complete asks what you did and the parts put on, filled in from the notes typed while working.
      const n = notesOf(open), service = cfg.serviceFix ? cfg.serviceFix(open) : '';
      $('fix-note').value = n.did; $('fix-used').value = n.used; $('fix-pick').hidden = !!service; fixPick = service || '';
    }
    view('fix');
  }
  if (cfg.simple) $('fix-next').addEventListener('click', () => {
    if (!fixPick) { message('Tap what you fixed.'); return; }
    message(''); safePick = null; clearSig();
    $('safe-unit').textContent = cfg.completeName(open) + ' · Complete';
    $('safe-q').textContent = cfg.safeQ(open);
    // Joe 10/28 evening: the mechanic's signature on file signs it; nothing to draw.
    $('sign-line').textContent = 'Signed by ' + (finisher ? finisher.name : '') + ' (signature on file)';
    document.querySelector('#view-safe .gs-sigbox').hidden = true;
    const img = $('sig-file'); img.src = finisher && finisher.signature || ''; img.hidden = !img.src;
    drawSafe(); view('safe');
  });
  function drawFixes() { $('fixes').innerHTML = fixes.map(f => '<button type="button" class="gs-btn' + (f === fixPick ? ' pick-on' : '') + '" data-fix="' + escapeHtml(f) + '">' + escapeHtml(f) + '</button>').join(''); }
  $('fixes').addEventListener('click', e => {
    const b = e.target.closest('[data-fix]'); if (!b) return;
    if (cfg.simple) { fixPick = b.dataset.fix; drawFixes(); return; }
    fixPick = b.dataset.fix; safePick = null; clearSig();
    $('safe-unit').textContent = cfg.completeName(open) + ' · Complete';
    $('safe-q').textContent = cfg.safeQ(open);
    $('sign-line').textContent = (finisher ? finisher.name + ', sign' : 'Sign') + ' with your finger';
    drawSafe(); view('safe');
  });
  function drawSafe() { document.querySelectorAll('[data-safe]').forEach(b => b.classList.toggle('pick-on', safePick !== null && (b.dataset.safe === 'yes') === safePick)); }
  document.querySelectorAll('[data-safe]').forEach(b => b.addEventListener('click', () => { safePick = b.dataset.safe === 'yes'; drawSafe(); }));

  const canvas = $('sig'), ctx = canvas.getContext('2d');
  function sizeCanvas() {
    requestAnimationFrame(() => {
      const r = canvas.getBoundingClientRect(); if (!r.width) return;
      const keep = inked ? canvas.toDataURL() : null;
      canvas.width = Math.round(r.width); canvas.height = Math.round(r.height);
      ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b4f86';
      if (keep) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0); img.src = keep; }
    });
  }
  function clearSig() { inked = false; ctx.clearRect(0, 0, canvas.width, canvas.height); }
  let drawing = false;
  const pt = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', e => { drawing = true; canvas.setPointerCapture(e.pointerId); const [x, y] = pt(e); ctx.beginPath(); ctx.moveTo(x, y); });
  canvas.addEventListener('pointermove', e => { if (!drawing) return; const [x, y] = pt(e); ctx.lineTo(x, y); ctx.stroke(); inked = true; });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => canvas.addEventListener(t, () => { drawing = false; }));
  $('sig-clear').addEventListener('click', clearSig);
  window.addEventListener('resize', () => { if (shownView() === 'safe') sizeCanvas(); });
  function smallSignature(scale) {
    const w = Math.min(480, canvas.width) * (scale || 1), h = Math.round(canvas.height * w / canvas.width), c = document.createElement('canvas');
    c.width = Math.round(w); c.height = h;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(canvas, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/png');
    return url.length > 29000 && (scale || 1) > 0.2 ? smallSignature((scale || 1) / 2) : url;
  }
  $('finish').addEventListener('click', async () => {
    if (safePick === null) { message('Tap Yes or No for "' + cfg.safeWord + '".'); return; }
    if (!cfg.simple && !inked) { message('Sign with your finger in the box.'); return; }
    if (cfg.simple && !(finisher && finisher.signature)) { message('No signature on file. Go back and sign in again.'); return; }
    if (S.busy) return;
    const j = open, who = finisher;
    S.busy = true; message('Saving…', true);
    try {
      const fields = { fixed: fixPick, note: $('fix-note').value.trim(), safe: safePick, signature: cfg.simple ? who.signature : smallSignature() };
      if (cfg.simple) {
        fields.used = $('fix-used').value.trim();
        const a = kept('Checks', j);
        if (checkList(j)) { const v = readingOf(j); Object.assign(fields, { hours: v.hours, miles: v.miles || '', completedOn: v.on }); }
        if (checkList(j)) fields.checklist = Object.keys(a).filter(k => a[k] && k.indexOf('~') < 0).map(k => {
          const tires = Object.keys(a).filter(t => t.indexOf(k + '~') === 0);
          return tires.length ? { id: k, r: a[k], depth: tires.reduce((o, t) => { o[t.slice(k.length + 1)] = a[t]; return o; }, {}) } : { id: k, r: a[k] };
        });
      }
      const r = await cfg.complete(j, who, fields);
      if (cfg.simple && !r.queued && safePick) { putKept('Notes', j, null); putKept('Checks', j, null); if (r.job) { putKept('Notes', r.job, null); putKept('Checks', r.job, null); } }
      if (cfg.simple && !r.queued && !safePick) putKept('Notes', j, null);
      if (r.queued) { message(j.unit + ': saved on this tablet. It will send when you have signal.', true); open = null; finisher = null; view('jobs'); return; }
      message(cfg.doneText(j, who, safePick, r), true);
      open = null; finisher = null; view('jobs');
      await load();
    } catch (err) { message(err.message); } finally { S.busy = false; signOut(who && who.token); }
  });

  // Back (menu): one step at a time on this screen first.
  window.udBack = () => {
    const v = shownView();
    if (v === 'safe') { view('fix'); return true; }
    if (v === 'fix' || v === 'parts') { view('job'); return true; }
    if (v === 'sign') { cancelSign(); return true; }
    if (v === 'mysig') { $('mysig-back').click(); return true; }
    if (v === 'job' || forms.indexOf(v) >= 0) { open = null; view('jobs'); drawJobs(); return true; }
    return false;
  };
  if ($('go-back')) $('go-back').addEventListener('click', goBack);
  if ($('go-home')) $('go-home').addEventListener('click', () => { location.href = 'index.html'; });
  ['pointerdown', 'keydown'].forEach(t => document.addEventListener(t, () => { lastTouch = Date.now(); }, true));
  // The clocks tick every 30 seconds; the list comes back fresh every 30 seconds while nobody is typing a login ID.
  setInterval(() => {
    if (ready && Date.now() > ready.until) { signOut(ready.token); ready = null; }
    const v = shownView();
    if (v === 'jobs' || v === 'job') {
      if (Date.now() - lastTouch > 5000 && !S.busy) load().catch(() => {}); else { drawJobs(); if (open && v === 'job') drawJob(); }
    }
  }, 30000);

  return Object.assign(S, { message, view, shownView, load, ask, signOut, closeJob: () => { open = null; }, redraw: () => drawJobs() });
}
