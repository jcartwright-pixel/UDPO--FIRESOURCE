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
 *   jobKey, jobLine, jobHead, jobLabel, problem, officeSource, downWord, unitClass, emptyJobs, noTechs, hideEmptyStrip,
 *   completeName, safeQ, safeWord, safeYes   the words and looks that differ
 */
import { escapeHtml, goBack } from './app.js';

const $ = (id) => document.getElementById(id);
const READY_MS = 2 * 60000;
export const names = (list) => list.length > 2 ? list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1] : list.join(' and ');
const mins = (iso) => { const m = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000)); return isFinite(m) ? m : 0; };
const hm = (m) => m >= 60 ? Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' m' : m + ' m';
const clock = (iso) => { const m = mins(iso); return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'); };
export const age = (iso) => { const m = mins(iso); if (!iso || !isFinite(Date.parse(iso))) return ''; return m < 60 ? m + ' min ago' : m < 1440 ? Math.floor(m / 60) + ' h ago' : Math.floor(m / 1440) + (m < 2880 ? ' day ago' : ' days ago'); };
export const first = (name) => { const p = String(name || '').split(/\s+/); return p.length > 1 && p[0] === p[0].toUpperCase() ? p.slice(1).join(' ') : p[0]; };
export const rid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/[^A-Za-z0-9_-]/g, '');

// The shared screens, put in after the work orders: one work order, Who are you?, and Complete's two steps.
function sharedScreens(safeYes) {
  return `
        <!-- One work order: who is on it, each mechanic's clock, Start / Add another mechanic / Need Parts / Complete. -->
        <section id="view-job" class="gs-stack" hidden>
          <div class="gs-bar"><button type="button" class="gs-btn dark" data-go="jobs">&larr; Work Orders</button><h2 id="job-unit"></h2></div>
          <div class="gs-card"><div class="gs-label" id="job-label"></div><div class="gs-problem" id="job-problem"></div><div class="gs-now" id="job-now"></div></div>
          <div class="gs-card gs-crew"><div class="gs-label">On this job</div><div id="crew"></div><div class="gs-label" id="crew-done"></div></div>
          <div class="gs-two">
            <button type="button" class="gs-btn" id="job-start">&#9654; Start work</button>
            <button type="button" class="gs-btn gray" id="job-parts">&#9203; Need Parts</button>
          </div>
          <button type="button" class="gs-btn green gs-done" id="job-done">&#10004; Complete</button>
        </section>

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

        <!-- Complete, step 1: what was fixed -->
        <section id="view-fix" class="gs-stack" hidden>
          <div class="gs-bar"><button type="button" class="gs-btn dark" data-go="job">&larr; Back</button><h2 id="fix-unit"></h2><span class="gs-progress"><i class="on"></i><i></i></span></div>
          <p class="gs-q">What did you fix?</p>
          <input class="gs-note" id="fix-note" maxlength="300" placeholder="Anything to add? (you can leave this empty)">
          <div class="gs-fixes" id="fixes"></div>
        </section>

        <!-- Complete, step 2: safe to drive (or run) + finger signature -->
        <section id="view-safe" class="gs-stack" hidden>
          <div class="gs-bar"><button type="button" class="gs-btn dark" data-go="fix">&larr; Back</button><h2 id="safe-unit"></h2><span class="gs-progress"><i class="on"></i><i class="on"></i></span></div>
          <p class="gs-q" id="safe-q"></p>
          <div class="gs-yesno"><button type="button" class="gs-btn green" data-safe="yes">${escapeHtml(safeYes)}</button><button type="button" class="gs-btn line" data-safe="no">No, still down</button></div>
          <div class="gs-label" id="sign-line">Sign with your finger</div>
          <div class="gs-sigbox"><button type="button" class="gs-btn dark" id="sig-clear">Clear</button><canvas id="sig"></canvas></div>
          <button type="button" class="gs-btn green" id="finish">&#10004; Complete Work Order</button>
        </section>
`;
}

export function mountJobStation(cfg) {
  const forms = cfg.forms || ['report'];
  const VIEWS = ['sign', 'jobs', 'job', 'fix', 'safe', 'report'].concat(cfg.views || []);
  $('view-jobs').insertAdjacentHTML('afterend', sharedScreens(cfg.safeYes));
  let techs = [], jobs = [], fixes = [];
  let open = null, want = null, picked = null, typed = '', ready = null, finisher = null;
  let fixPick = '', safePick = null, inked = false, lastTouch = Date.now();
  // busy: a step is being sent; the page's own steps set it too.
  const S = { busy: false };

  const signOut = (token) => { if (token) cfg.call('signOut', { tokens: [token] }).catch(() => {}); };
  function message(text, ok) { const m = $('gs-message'); m.textContent = text || ''; m.hidden = !text; m.classList.toggle('ok', !!ok); }
  function view(v) { VIEWS.forEach(k => { $('view-' + k).hidden = k !== v; }); if (v === 'safe') sizeCanvas(); }
  const shownView = () => VIEWS.find(k => !$('view-' + k).hidden);

  async function load() {
    const r = await cfg.board();
    techs = r.techs; fixes = r.fixes; jobs = r.jobs;
    if (cfg.onBoard) cfg.onBoard(r);
    if (open) open = jobs.find(j => cfg.jobKey(j) === cfg.jobKey(open) || (open.id && j.id === open.id)) || null;
    draw();
    if (!open && shownView() === 'job') view('jobs');
  }
  function draw() {
    const on = techs.filter(t => t.on);
    $('people').innerHTML = on.length ? '<span class="gs-onclock">On the clock:</span>' + on.map(t => '<span class="p"><i>' + escapeHtml(t.name.slice(0, 1)) + '</i>' + escapeHtml(first(t.name)) + ' <small>' + escapeHtml(t.on.unit) + '</small></span>').join('') : '';
    drawJobs(); drawSign();
    if (open) drawJob();
  }

  /* ---------- work orders ---------- */
  function rowClass(j) { return j.status === 'PARTS' ? 'parts' : j.onNow.length ? 'working' : !j.canRun ? 'down' : j.source === cfg.officeSource ? 'office' : ''; }
  function drawJobs() {
    $('jobs-title').textContent = 'Work Orders' + (jobs.length ? ' · ' + jobs.length + ' open' : '');
    // Review item 48 (Joe 10/13, Maintenance Station): no "Mechanics:" with nothing after it; the line shows once there are mechanics.
    if (cfg.hideEmptyStrip) $('strip').hidden = !techs.length;
    $('strip').innerHTML = '<span class="gs-label">Mechanics:</span>' + techs.map(t => '<button type="button" class="gs-chip' + (t.on ? ' on' : '') + '" data-tech="' + escapeHtml(t.id) + '">' + escapeHtml(t.name) +
      '<small>' + (t.on ? escapeHtml(t.on.unit) + ' · ' + clock(t.on.since) : 'free') + '</small></button>').join('');
    $('jobs').innerHTML = jobs.map((j, i) => {
      const subs = ['<small>' + escapeHtml(cfg.jobLine(j)) + (j.createdAt ? ' · ' + age(j.createdAt) : '') + '</small>'];
      if (j.onNow.length) subs.push('<small class="green">On it now: ' + escapeHtml(names(j.onNow.map(p => first(p.name) + ' ' + clock(p.since)))) + '</small>');
      else if (j.status === 'WORKING') subs.push('<small>Started · nobody on it now</small>');
      if (j.status === 'PARTS') subs.push('<small>WAITING ON PARTS</small>');
      if (!j.canRun && j.status !== 'PARTS') subs.push('<small class="red">' + escapeHtml(cfg.downWord) + '</small>');
      return '<div class="gs-job ' + rowClass(j) + '" data-i="' + i + '"><span class="' + cfg.unitClass + '">' + escapeHtml(j.unit) + '</span><span class="what">' + escapeHtml(cfg.problem(j)) + subs.join('') + '</span>' +
        '<button type="button" class="gs-btn ' + (j.onNow.length ? 'green' : j.status === 'PARTS' ? 'gray' : '') + '" data-i="' + i + '">Open</button></div>';
    }).join('') || '<p class="gs-empty">' + escapeHtml(cfg.emptyJobs) + '</p>';
  }
  $('jobs').addEventListener('click', e => { const row = e.target.closest('[data-i]'); if (!row) return; open = jobs[Number(row.dataset.i)]; message(''); drawJob(); view('job'); });
  // A mechanic's own name: their job, or ready to tap one.
  $('strip').addEventListener('click', e => { const b = e.target.closest('[data-tech]'); if (b) ask('me', null, b.dataset.tech); });

  function drawJob() {
    const j = open;
    $('job-unit').textContent = cfg.jobHead(j);
    $('job-label').textContent = cfg.jobLabel(j) + (j.createdAt ? ' · ' + age(j.createdAt) : '') + (j.canRun ? '' : ' · ' + cfg.downWord);
    $('job-problem').textContent = cfg.problem(j);
    $('job-now').textContent = j.status === 'PARTS' ? 'Waiting on parts' : '';
    $('crew').innerHTML = j.onNow.map(p => '<div class="gs-clock"><i>' + escapeHtml(p.name.slice(0, 1)) + '</i><b>' + escapeHtml(p.name) + '</b><span class="t">' + clock(p.since) + '</span>' +
      '<button type="button" class="gs-btn dark" data-stop="' + escapeHtml(p.id) + '">&#9632; Stop</button></div>').join('') || '<p class="gs-hint">Nobody is on this job right now.</p>';
    const done = {}; (j.labor || []).forEach(s => { done[s.name] = (done[s.name] || 0) + s.minutes; });
    const list = Object.keys(done);
    $('crew-done').textContent = list.length ? 'Time so far: ' + list.map(n => first(n) + ' ' + hm(done[n])).join(', ') + (list.length > 1 ? ' · total ' + hm(j.laborMinutes) : '') : '';
    $('job-start').innerHTML = j.onNow.length ? '&#128101; Add another mechanic' : '&#9654; Start work';
    $('job-start').hidden = j.status === 'PARTS';
    $('job-parts').innerHTML = j.status === 'PARTS' ? '&#9203; Parts are here' : '&#9203; Need Parts';
  }
  $('job-start').addEventListener('click', () => ask(open.onNow.length ? 'helper' : 'start', open));
  $('job-parts').addEventListener('click', () => ask(open.status === 'PARTS' ? 'resume' : 'parts', open));
  $('job-done').addEventListener('click', () => ask('complete', open));
  $('crew').addEventListener('click', e => { const b = e.target.closest('[data-stop]'); if (b) ask('stop', open, b.dataset.stop); });
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => { const v = b.dataset.go; if (v === 'jobs') { open = null; drawJobs(); } view(v); }));

  /* ---------- who are you? (name + login ID for every step) ---------- */
  const ASK = Object.assign({
    start: (j) => ['Start work on ' + j.unit, 'Tap your name, then your login ID. Your clock starts.'],
    helper: (j) => ['Add another mechanic to ' + j.unit, 'The mechanic joining taps their name, then their login ID.'],
    stop: (j) => ['Stop your clock on ' + j.unit, 'The job stays open. Enter your login ID.'],
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
    await run(w.purpose, w.job, who);
    drawSign();
  });
  function cancelSign() { const w = want; want = null; picked = null; typed = ''; drawSign(); view(w && w.job ? 'job' : w && forms.indexOf(w.purpose) >= 0 ? w.purpose : 'jobs'); }
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
      const r = await cfg.step(who, job, op);
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
  function startComplete() { fixPick = ''; $('fix-note').value = ''; $('fix-unit').textContent = cfg.completeName(open) + ' · Complete'; drawFixes(); view('fix'); }
  function drawFixes() { $('fixes').innerHTML = fixes.map(f => '<button type="button" class="gs-btn' + (f === fixPick ? ' pick-on' : '') + '" data-fix="' + escapeHtml(f) + '">' + escapeHtml(f) + '</button>').join(''); }
  $('fixes').addEventListener('click', e => {
    const b = e.target.closest('[data-fix]'); if (!b) return;
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
    if (!inked) { message('Sign with your finger in the box.'); return; }
    if (S.busy) return;
    const j = open, who = finisher;
    S.busy = true; message('Saving…', true);
    try {
      const r = await cfg.complete(j, who, { fixed: fixPick, note: $('fix-note').value.trim(), safe: safePick, signature: smallSignature() });
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
    if (v === 'fix') { view('job'); return true; }
    if (v === 'sign') { cancelSign(); return true; }
    if (v === 'job' || forms.indexOf(v) >= 0) { open = null; view('jobs'); drawJobs(); return true; }
    return false;
  };
  $('go-back').addEventListener('click', goBack);
  $('go-home').addEventListener('click', () => { location.href = 'index.html'; });
  ['pointerdown', 'keydown'].forEach(t => document.addEventListener(t, () => { lastTouch = Date.now(); }, true));
  // The clocks tick every 30 seconds; the list comes back fresh every 30 seconds while nobody is typing a login ID.
  setInterval(() => {
    if (ready && Date.now() > ready.until) { signOut(ready.token); ready = null; }
    const v = shownView();
    if (v === 'jobs' || v === 'job') {
      if (Date.now() - lastTouch > 5000 && !S.busy) load().catch(() => {}); else { drawJobs(); if (open && v === 'job') drawJob(); }
    }
  }, 30000);

  return Object.assign(S, { message, view, shownView, load, ask, signOut, closeJob: () => { open = null; } });
}
