/*
 * Administration's own pages (Joe 10/10: "complete this"): each opens inside Administration's right-hand panel, with its
 * buttons on one line at the top. Everything goes through the server's `admin` call (functions/src/admin.js), for
 * Administrators only. A change that cannot be undone asks for a second press first.
 */
import { escapeHtml, callServer, dateTimeText } from './app.js';

const L = window.UDLogic;
const e = escapeHtml;
const call = (op, fields) => callServer('admin', Object.assign({ op }, fields || {}));

export function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return dateTimeText(d);
}
const prettyRole = (r) => String(r).charAt(0) + String(r).slice(1).toLowerCase().replace(/_/g, ' ');
const plantName = (id) => id === '*' ? 'All locations' : ((L.PLANTS.find(p => p.id === id) || {}).name || id);

// The message line under the buttons.
export function say(box, text, kind) {
  const open = [...box.querySelectorAll('.ap-modal:not([hidden]) .ap-msg')][0];
  const m = open || box.querySelector('.ap-msg');
  if (!m) return;
  m.textContent = text || '';
  m.className = 'ap-msg' + (kind ? ' ' + kind : '');
  m.hidden = !text;
}
// Plain words only: no "FirebaseError:", no [403] or (functions/...) codes.
export const errText = (err) => String(err && err.message || err).replace(/^FirebaseError:\s*/, '').replace(/\s*[\[(](?:\d{3}|[a-z]+\/[a-z-]+)[\])]\s*$/i, '');
// The locations a person really has, ticked (Joe 10/10): "*" is All locations; with none saved, an Administrator has
// every plant and anyone else Uniontown (logic.js plantsFor), so the boxes show that instead of nothing.
function shownPlants(p) {
  const list = (p.facilities || []).map(String);
  if (list.indexOf('*') >= 0) return ['*'];
  const known = list.filter(f => L.PLANTS.some(x => x.id === f));
  if (known.length) return known;
  return (p.roles || []).some(r => /^ADMIN/.test(String(r).toUpperCase())) ? ['*'] : ['fac_uniontown'];
}

// Press twice: the first press arms the button (new label); the second runs it. Any other press disarms.
export function twice(btn, armedLabel, run) {
  if (btn.dataset.armed === '1') {
    btn.dataset.armed = '';
    btn.classList.remove('armed');
    btn.textContent = btn.dataset.label;
    return run();
  }
  btn.dataset.label = btn.textContent;
  btn.dataset.armed = '1';
  btn.classList.add('armed');
  btn.textContent = armedLabel;
  return null;
}

export async function busy(box, btn, work) {
  const buttons = [...box.querySelectorAll('button')];
  buttons.forEach(b => { b.dataset.wasDisabled = b.disabled ? '1' : ''; b.disabled = true; });
  try { return await work(); } catch (err) { say(box, errText(err), 'bad'); return null; } finally {
    buttons.forEach(b => { if (b.isConnected) b.disabled = b.dataset.wasDisabled === '1'; });
  }
}

/* ---------- QR codes: drawn in the browser (js/vendor/qrcode.js, MIT), never by an outside service ---------- */

export function qrSvg(textValue) {
  const q = window.qrcode(0, 'M');
  q.addData(String(textValue));
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}

// Print one QR sheet from a hidden frame (same window; no new tab).
export function printQr(title, label, url, codeLine) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const sandbox = /sandbox/.test(location.hostname) ? '<p style="color:#b42318;font-weight:800">SANDBOX &mdash; TEST ONLY</p>' : '';
  frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><title>' + e(title) + '</title><style>body{font-family:Segoe UI,Arial,sans-serif;text-align:center;padding:40px}' +
    'h1{color:#0b3d6b;font-size:30px;margin:0 0 6px}h2{font-size:22px;margin:0 0 18px;color:#34495e}.qr{width:360px;height:360px;margin:10px auto}.qr svg{width:100%;height:100%}' +
    'p{font-size:18px}.url{font-size:12px;color:#5a6b7d;word-break:break-all}</style></head><body><h1>United Dairy ' + e(title) + '</h1><h2>' + e(label) + '</h2><p>Scan to open.</p>' +
    '<div class="qr">' + qrSvg(url) + '</div><p>' + codeLine + '</p><p class="url">' + e(url) + '</p>' + sandbox + '</body></html>';
  frame.onload = () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (err) { /* printing refused */ } setTimeout(() => frame.remove(), 60000); };
}

async function copyText(btn, value) {
  try { await navigator.clipboard.writeText(value); } catch (err) {
    const t = document.createElement('textarea'); t.value = value; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (x) { /* none */ } t.remove();
  }
  const was = btn.textContent;
  btn.textContent = 'Copied';
  setTimeout(() => { if (btn.isConnected) btn.textContent = was; }, 1400);
}

/* ---------- People & Roles ---------- */

export async function renderPeople(box) {
  let data = null, sel = null, draft = null, find = '', filter = 'all', dirty = false;
  box.innerHTML = '<div class="ap"><div class="ap-bar"><button type="button" class="ap-btn main" id="p-add">+ Add Person</button><button type="button" class="ap-btn main" id="p-add-role">+ Add Role</button>' +
    '<button type="button" class="ap-btn" id="p-reload">Refresh</button>' +
    '<div class="ap-right"><input type="search" id="p-find" placeholder="Search name or email" aria-label="Search name or email"><select id="p-filter" aria-label="Show"><option value="all">All people</option><option value="ACTIVE">Enabled</option><option value="INACTIVE">Disabled</option></select></div></div>' +
    '<div class="ap-msg" hidden></div>' +
    '<div class="ap-tiles"><div><b>Company sign-in</b><span>A verified United Dairy email can enter. Account roles determine access.</span></div><div><b>Administrator is assigned</b><span>A company email alone never grants administrator rights.</span></div>' +
    '<div><b>Supplied codes are separate</b><span>Route Distribution phone and Garage Station codes do not require company email.</span></div></div>' +
    '<div class="ap-scroll"><table class="issues adm-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Plants</th><th>Status</th></tr></thead><tbody id="people"></tbody></table></div>' +
    '<p class="ap-note">Click a person to change or disable them. Disabled people stay visible; no account is deleted. Changes are written to the sandbox copy of the Users sheet.</p>' +
    '<div class="ap-modal" id="p-modal" hidden><div class="ap-modal-box" role="dialog" aria-modal="true" aria-label="Person"><div class="ap-msg" id="p-modal-msg" hidden></div><div class="ap-card" id="p-edit"></div></div></div>' +
    '<div class="ap-modal" id="r-modal" hidden><div class="ap-modal-box" role="dialog" aria-modal="true" aria-label="Add Role"><div class="ap-card" id="r-edit"></div></div></div></div>';
  const $ = (s) => box.querySelector(s);
  const plantsText = (p) => { const ids = L.plantsFor(Object.assign({}, p, { status: 'ACTIVE' })); return ids.length === L.PLANTS.length ? 'All plants' : ids.map(plantName).join(', ') || 'No plants'; };
  const roleText = (r) => (r || []).map(prettyRole).join(' + ') || 'None';
  const restricted = (c) => /^admin\./.test(c) || c === 'audit.full';

  function rightsResult(d) {
    const admin = d.roles.indexOf('ADMINISTRATOR') >= 0, on = d.status === 'ACTIVE';
    const fromRole = new Set();
    d.roles.forEach(r => (data.templates[r] || data.defaults[r] || []).forEach(c => fromRole.add(c)));
    return (code) => on && (admin || (!restricted(code) && (d.grants.indexOf(code) >= 0 || (fromRole.has(code) && d.denials.indexOf(code) < 0))));
  }

  function renderList() {
    const q = find.trim().toLowerCase();
    const rows = data.people.filter(p => (filter === 'all' || p.status === filter) && (!q || (p.name + ' ' + p.email).toLowerCase().indexOf(q) >= 0))
      .sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email)));
    $('#people').innerHTML = rows.map(p => '<tr data-email="' + e(p.email) + '"' + (sel && sel.email === p.email ? ' class="on"' : '') + '><td class="strong">' + e(p.name || p.email) + '</td><td>' + e(p.email) + '</td><td>' +
      e(roleText(p.roles)) + '</td><td>' + e(plantsText(p)) + '</td><td><span class="pill ' + (p.status === 'ACTIVE' ? 'good' : 'muted') + '">' + (p.status === 'ACTIVE' ? 'Active' : p.status === 'INACTIVE' ? 'Disabled' : e(p.status || 'Unknown')) + '</span></td></tr>').join('') ||
      '<tr><td colspan="5" class="ap-empty">No matching people.</td></tr>';
  }

  function renderEdit() {
    const c = $('#p-edit');
    $('#p-modal').hidden = !draft;
    if (!draft) { c.innerHTML = ''; return; }
    const isNew = !sel, primary = sel && sel.primary, admin = draft.roles.indexOf('ADMINISTRATOR') >= 0;
    const roleOpts = data.roles.map(r => '<option value="' + r + '"' + (draft.roles.length === 1 && draft.roles[0] === r ? ' selected' : '') + '>' + e(prettyRole(r)) + '</option>').join('') +
      (draft.roles.length > 1 ? '<option value="__multiple__" selected>' + e(roleText(draft.roles)) + ' (existing)</option>' : '');
    const ok = rightsResult(draft);
    let group = '';
    const rights = data.catalog.map(r => {
      const g = r.group !== group ? '<tr class="ap-group"><td colspan="3">' + e(group = r.group) + '</td></tr>' : '';
      const lock = admin || restricted(r.code);
      const v = draft.grants.indexOf(r.code) >= 0 ? 'allow' : draft.denials.indexOf(r.code) >= 0 ? 'deny' : 'role';
      return g + '<tr><td>' + e(r.label) + '</td><td><select data-right="' + r.code + '"' + (lock ? ' disabled' : '') + '><option value="role"' + (v === 'role' ? ' selected' : '') + '>Use Role</option>' +
        '<option value="allow"' + (v === 'allow' ? ' selected' : '') + '>Allow</option><option value="deny"' + (v === 'deny' ? ' selected' : '') + '>Deny</option></select></td><td>' +
        (ok(r.code) ? '<span class="ap-chip good">Allowed</span>' : '<span class="ap-chip bad">Blocked</span>') + '</td></tr>';
    }).join('');
    c.innerHTML = '<div class="ap-bar"><h3 style="flex:1">' + (isNew ? 'New Person' : e(sel.name || sel.email)) + '</h3><button type="button" class="ap-btn" id="p-defaults">Use Role Defaults</button>' +
      '<button type="button" class="ap-btn main" id="p-save">Save Person Access</button><button type="button" class="ap-btn" id="p-cancel">Cancel</button></div>' +
      '<div class="ap-id">' + (isNew ? 'A new person will be created only after Save.' : primary ? e(sel.email) + ' &middot; Primary administrator &mdash; protected recovery account' : e(sel.email)) +
      ' &middot; <span class="ap-chip ' + (draft.status === 'ACTIVE' ? 'good' : '') + '">' + (draft.status === 'ACTIVE' ? 'Enabled' : 'Disabled') + '</span></div>' +
      '<div class="ap-grid2"><label class="ap-field">Display name<input id="p-name" maxlength="120" value="' + e(draft.name) + '"></label>' +
      '<label class="ap-field">Email identity<input type="email" id="p-email" maxlength="254" value="' + e(draft.email) + '"' + (isNew ? '' : ' readonly') + '></label>' +
      '<label class="ap-field">Assigned role<select id="p-role"' + (primary ? ' disabled' : '') + '>' + roleOpts + '</select></label>' +
      '<label class="ap-field">Account status<select id="p-status"' + (primary ? ' disabled' : '') + '><option value="ACTIVE"' + (draft.status === 'ACTIVE' ? ' selected' : '') + '>Enabled</option><option value="INACTIVE"' + (draft.status !== 'ACTIVE' ? ' selected' : '') + '>Disabled</option></select></label></div>' +
      '<div class="ap-field"><b style="color:#0b3d6b;font-size:14px">Allowed locations</b><div class="ap-checks" id="p-plants"><label><input type="checkbox" value="*"' + (draft.facilities.indexOf('*') >= 0 ? ' checked' : '') + '> All locations</label>' +
      L.PLANTS.map(p => '<label><input type="checkbox" value="' + p.id + '"' + (draft.facilities.indexOf(p.id) >= 0 ? ' checked' : '') + '> ' + e(p.name) + (p.status !== 'ACTIVE' ? ' (being built)' : '') + '</label>').join('') +
      '</div><span class="ap-help">All locations covers every plant, including ones added later. With none ticked, an Administrator sees every plant and anyone else sees Uniontown.</span></div>' +
      '<div><b style="color:#0b3d6b">Effective Rights</b>' + (dirty ? ' <span class="ap-chip warn">Unsaved preview</span>' : '') +
      '<p class="ap-help" style="margin:4px 0">Use Role inherits the role template. Deny overrides Allow. Changes take effect only after Save.</p>' +
      '<table class="ap-t"><thead><tr><th>Action</th><th>Person exception</th><th>Result</th></tr></thead><tbody>' + rights + '</tbody></table></div>' +
      '<p class="ap-note">' + (sel && sel.updatedAt ? 'Last saved ' + e(when(sel.updatedAt)) + ' by ' + e(sel.updatedBy) : 'No saved changes for this entry.') + '</p>';
  }

  function pick(person, open) {
    sel = person;
    if (!person && !open) { draft = null; dirty = false; renderList(); renderEdit(); return; }
    draft = person ? { email: person.email, name: person.name, roles: person.roles.map(r => String(r).toUpperCase()), status: person.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE', facilities: shownPlants(person),
      grants: person.grants.slice(), denials: person.denials.slice() } : { email: '', name: '', roles: ['EMPLOYEE'], status: 'ACTIVE', facilities: [], grants: [], denials: [] };
    dirty = false;
    renderList(); renderEdit();
  }
  // Add Role (Joe 10/10): a new role with its standard rights; it then shows in each person's role list and in Role Templates.
  function openRole() {
    let group = '';
    $('#r-edit').innerHTML = '<div class="ap-bar"><h3 style="flex:1">New Role</h3><button type="button" class="ap-btn main" id="r-save">Save Role</button><button type="button" class="ap-btn" id="r-cancel">Cancel</button></div>' +
      '<div class="ap-msg bad" id="r-msg" hidden></div><label class="ap-field">Role name<small>For example Yard Lead or Office Clerk</small><input id="r-name" maxlength="40"></label>' +
      '<p class="ap-help">Tick what people with this role may do. You can change it later in Role Templates; one person\'s exceptions stay on the person.</p>' +
      '<table class="ap-t"><thead><tr><th>Action</th><th>Role access</th></tr></thead><tbody>' + data.catalog.filter(r => !restricted(r.code)).map(r =>
        (r.group !== group ? '<tr class="ap-group"><td colspan="2">' + e(group = r.group) + '</td></tr>' : '') + '<tr><td>' + e(r.label) + '</td><td><span class="ap-checks"><label><input type="checkbox" data-code="' + r.code + '"> Allowed</label></span></td></tr>').join('') +
      '</tbody></table>';
    $('#r-modal').hidden = false;
    $('#r-name').focus();
  }
  box.addEventListener('keydown', ev => { if (ev.key === 'Escape') { if (!$('#r-modal').hidden) $('#r-modal').hidden = true; else if (draft) pick(null); } });

  let guard = '';
  const leaving = (what) => {
    if (!dirty || guard === what) { guard = ''; return true; }
    guard = what;
    say(box, 'Unsaved edits will be discarded. Select the same action again to continue.', 'bad');
    return false;
  };

  async function load(keep) {
    try {
      data = await call('people');
      if (!box.isConnected) return;
      say(box, '');
      renderList();
      pick(keep ? data.people.find(p => p.email === keep) || null : null);
    } catch (err) {
      if (box.isConnected) box.innerHTML = '<div class="notice error">Could not read the Users list: ' + e(errText(err)) + '</div>';
    }
  }

  box.addEventListener('click', ev => {
    const row = ev.target.closest('#people tr[data-email]');
    if (row) { if (!leaving('row:' + row.dataset.email)) return; pick(data.people.find(p => p.email === row.dataset.email)); return; }
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'p-add') { if (!leaving('add')) return; pick(null, true); }
    if (b.id === 'p-cancel') { pick(null); say(box, ''); }
    if (b.id === 'p-add-role') openRole();
    if (b.id === 'r-cancel') { $('#r-modal').hidden = true; }
    if (b.id === 'r-save') {
      const name = $('#r-name').value.trim();
      const rights = [...box.querySelectorAll('#r-edit [data-code]:checked')].map(x => x.dataset.code);
      if (!name) { $('#r-msg').textContent = 'Type the new role\'s name.'; $('#r-msg').hidden = false; return; }
      busy(box, b, async () => {
        try {
          const out = await call('addRole', { name, rights });
          $('#r-modal').hidden = true;
          await load(sel && sel.email);
          say(box, out.message, 'good');
        } catch (err) { $('#r-msg').textContent = errText(err); $('#r-msg').hidden = false; }
      });
    }
    if (b.id === 'p-reload') { if (!leaving('reload')) return; load(sel && sel.email); }
    if (b.id === 'p-defaults') { draft.grants = []; draft.denials = []; dirty = true; renderEdit(); say(box, 'This person\'s draft exceptions are cleared. Click Save to apply; no one else is changed.'); }
    if (b.id === 'p-save') {
      draft.name = $('#p-name').value.trim();
      draft.email = $('#p-email').value.trim().toLowerCase();
      if (!draft.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email)) { say(box, 'Enter a display name and valid email.', 'bad'); return; }
      const wasAdmin = sel && sel.roles.some(r => /^ADMIN/.test(String(r).toUpperCase())), nowAdmin = draft.roles.indexOf('ADMINISTRATOR') >= 0;
      const sensitive = sel && ((sel.status === 'ACTIVE' && draft.status !== 'ACTIVE') || wasAdmin !== nowAdmin) || (!sel && nowAdmin);
      const go = () => busy(box, b, async () => {
        const out = await call('savePerson', { email: draft.email, name: draft.name, roles: draft.roles, status: draft.status, facilities: draft.facilities, grants: draft.grants, denials: draft.denials,
          isNew: !sel, revision: sel ? sel.revision : data.newRevision });
        await load();
        say(box, 'Saved ' + out.email + '. The Users sheet copy gets it within a minute.', 'good');
      });
      if (!sensitive) { go(); return; }
      if (b.dataset.armed !== '1') say(box, 'This changes enabled status or administrator access. Click Save Person Access again to confirm.');
      twice(b, 'Click Again to Confirm', go);
    }
  });
  box.addEventListener('change', ev => {
    const t = ev.target;
    if (t.id === 'p-filter') { filter = t.value; renderList(); return; }
    // Typing boxes keep their own value (redrawing on leaving one would lose the next box's focus).
    if (!draft || t.id === 'p-name' || t.id === 'p-email' || t.id === 'p-find') return;
    if (t.id === 'p-role' && t.value !== '__multiple__') draft.roles = [t.value];
    if (t.id === 'p-status') draft.status = t.value;
    if (t.closest('#p-plants')) {
      if (t.value === '*' && t.checked) draft.facilities = ['*'];
      else if (t.checked) draft.facilities = draft.facilities.filter(f => f !== '*').concat([t.value]);
      else draft.facilities = draft.facilities.filter(f => f !== t.value);
    }
    if (t.dataset.right) {
      const c = t.dataset.right;
      draft.grants = draft.grants.filter(x => x !== c); draft.denials = draft.denials.filter(x => x !== c);
      if (t.value === 'allow') draft.grants.push(c);
      if (t.value === 'deny') draft.denials.push(c);
    }
    if (t.id === 'p-role' && draft.roles.indexOf('ADMINISTRATOR') >= 0) { draft.grants = []; draft.denials = []; }
    draft.name = $('#p-name').value; draft.email = $('#p-email').value;
    dirty = true; guard = '';
    renderEdit();
  });
  box.addEventListener('input', ev => { if (ev.target.id === 'p-find') { find = ev.target.value; renderList(); } else if (ev.target.id === 'p-name' || ev.target.id === 'p-email') dirty = true; });
  await load();
}

/* ---------- Role Templates ---------- */

export async function renderRoleTemplates(box) {
  let data = null, role = 'SUPERVISOR', draft = [], dirty = false;
  box.innerHTML = '<div class="ap"><div class="ap-bar"><label class="ap-field" style="flex-direction:row;align-items:center;gap:8px">Role <select id="rt-role"></select></label>' +
    '<button type="button" class="ap-btn main" id="rt-save">Save Role Template</button><button type="button" class="ap-btn" id="rt-reload">Reload Templates</button></div>' +
    '<div class="ap-msg" hidden></div><p class="ap-note">Define each role once. Individual exceptions stay on the person (People &amp; Roles). A role\'s template changes what its people may save in the new app.</p><div class="ap-scroll" id="rt-body"></div></div>';
  const $ = (s) => box.querySelector(s);
  const current = () => (data.templates[role] || data.defaults[role] || []).slice();
  function render() {
    $('#rt-role').innerHTML = data.roles.map(r => '<option value="' + r + '"' + (r === role ? ' selected' : '') + '>' + e(prettyRole(r)) + '</option>').join('');
    $('#rt-save').disabled = role === 'ADMINISTRATOR';
    if (role === 'ADMINISTRATOR') {
      $('#rt-body').innerHTML = '<div class="ap-empty">Administrator has unrestricted access. Use People &amp; Roles to change the person\'s assignment.<br><small>Administrator has protected full access. Assign or remove that role on a person, not here.</small></div>';
      return;
    }
    let group = '';
    const meta = data.meta[role];
    $('#rt-body').innerHTML = '<table class="ap-t"><thead><tr><th>Action</th><th>Role access</th></tr></thead><tbody>' + data.catalog.filter(r => !/^admin\./.test(r.code) && r.code !== 'audit.full').map(r =>
      (r.group !== group ? '<tr class="ap-group"><td colspan="2">' + e(group = r.group) + '</td></tr>' : '') + '<tr><td>' + e(r.label) + '</td><td><label class="ap-checks"><label><input type="checkbox" data-code="' + r.code + '"' +
      (draft.indexOf(r.code) >= 0 ? ' checked' : '') + '> Allowed</label></label></td></tr>').join('') + '</tbody></table>';
    say(box, dirty ? 'Unsaved role-template changes.' : meta ? 'Last saved ' + when(meta.updatedAt) + ' by ' + meta.updatedBy + (data.templates[role] ? '' : ' (back to the standard rights).') : data.templates[role] ? '' : 'Standard rights for this role (never changed).');
  }
  async function load() {
    try { data = await call('roleTemplates'); if (!box.isConnected) return; draft = current(); dirty = false; render(); } catch (err) { say(box, errText(err), 'bad'); }
  }
  box.addEventListener('change', ev => {
    if (ev.target.id === 'rt-role') { role = ev.target.value; draft = current(); dirty = false; render(); return; }
    const c = ev.target.dataset.code;
    if (!c) return;
    draft = draft.filter(x => x !== c);
    if (ev.target.checked) draft.push(c);
    dirty = true; say(box, 'Unsaved role-template changes.');
  });
  box.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'rt-reload') load();
    if (b.id === 'rt-save') busy(box, b, async () => { await call('saveRoleTemplate', { role, rights: draft, expected: current() }); await load(); say(box, 'Role template saved.', 'good'); });
  });
  await load();
}

/* ---------- Access & QR Codes ---------- */

const linkFor = (workspace, token) => location.origin + '/' + (workspace === 'route' ? 'route.html' : 'index.html') + '?access=' + encodeURIComponent(token);

export async function renderAccessCodes(box) {
  let data = null, reveal = null, find = '';
  box.innerHTML = '<div class="ap"><div class="ap-bar"><button type="button" class="ap-btn" id="ac-reload">Refresh</button><div class="ap-right"><input type="search" id="ac-find" placeholder="Search name or email" aria-label="Search name or email"></div></div>' +
    '<div class="ap-msg" hidden></div><p class="ap-note">Generate a revocable mobile link for an employee. The link never contains roles, passwords, or permanent credentials.</p><div id="ac-reveal"></div>' +
    '<div class="ap-scroll"><table class="ap-t"><thead><tr><th>Person</th><th>Role &middot; Plants</th><th>Link</th><th>Issued</th><th></th></tr></thead><tbody id="ac-rows"></tbody></table></div>' +
    '<p class="ap-note">Text delivery: texting stays off until an approved text provider is set up. Email, Copy Link, the QR on screen and Print QR work without it.</p></div>';
  const $ = (s) => box.querySelector(s);
  function render() {
    const q = find.trim().toLowerCase();
    $('#ac-rows').innerHTML = data.people.filter(p => !q || (p.name + ' ' + p.email).toLowerCase().indexOf(q) >= 0).map(p => '<tr><td><b>' + e(p.name) + '</b><small>' + e(p.email) + '</small></td><td>' +
      e(p.roles.join(', ') || 'No role') + '<small>' + e(p.facilities.join(', ') || 'No facility') + '</small></td><td><span class="ap-chip ' + (p.state === 'ACTIVE' ? 'good' : p.state === 'REVOKED' ? 'bad' : '') + '">' + p.state + '</span></td><td>' +
      (p.issuedAt ? e(when(p.issuedAt)) + '<small>' + e(p.issuedBy) + '</small>' : 'Never issued') + '</td><td>' +
      (p.state === 'NOT SET' ? '<button type="button" class="ap-btn small main" data-gen="' + e(p.email) + '">Generate</button>' : '<button type="button" class="ap-btn small warn" data-gen="' + e(p.email) + '" data-again="1">Regenerate</button>') +
      (p.state === 'ACTIVE' ? ' <button type="button" class="ap-btn small" data-revoke="' + e(p.email) + '">Revoke</button>' : '') + '</td></tr>').join('') || '<tr><td colspan="5" class="ap-empty">No matching people.</td></tr>';
    const r = reveal;
    $('#ac-reveal').innerHTML = r ? '<div class="ap-reveal"><div class="ap-qr">' + qrSvg(r.link) + '</div><div style="flex:1;min-width:0"><h3 style="margin:0;color:#0b3d6b">' + e(r.name) + ' Mobile Access</h3><p class="ap-id">' + e(r.email) + '</p>' +
      '<p class="ap-url">' + e(r.link) + '</p><div class="ap-bar"><button type="button" class="ap-btn" id="ac-copy">Copy Link</button><button type="button" class="ap-btn" id="ac-email">Email</button>' +
      '<button type="button" class="ap-btn" id="ac-print">Print QR</button><button type="button" class="ap-btn" id="ac-revoke-shown">Revoke</button></div>' +
      '<p class="ap-note">The QR and link are revocable. The link opens the person\'s phone screens; they still sign in with their United Dairy account, and their role and plants are still checked. Shown once: copy, email or print it now.</p></div></div>' : '';
  }
  async function load() { try { data = await call('accessLinks'); if (box.isConnected) render(); } catch (err) { say(box, errText(err), 'bad'); } }
  box.addEventListener('input', ev => { if (ev.target.id === 'ac-find') { find = ev.target.value; render(); } });
  box.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'ac-reload') { reveal = null; load(); }
    if (b.dataset.gen) {
      const go = () => busy(box, b, async () => {
        const out = await call('accessGenerate', { email: b.dataset.gen });
        const p = data.people.find(x => x.email === b.dataset.gen);
        reveal = { email: b.dataset.gen, name: p ? p.name : b.dataset.gen, link: linkFor(out.workspace, out.token) };
        await load();
        say(box, out.message, 'good');
      });
      if (b.dataset.again) twice(b, 'Click Again to Confirm', go); else go();
    }
    const revokeEmail = b.dataset.revoke || (b.id === 'ac-revoke-shown' && reveal ? reveal.email : '');
    if (revokeEmail) busy(box, b, async () => { const out = await call('accessRevoke', { email: revokeEmail }); if (reveal && reveal.email === revokeEmail) reveal = null; await load(); say(box, out.message, 'good'); });
    if (b.id === 'ac-copy') copyText(b, reveal.link);
    if (b.id === 'ac-print') printQr(reveal.name + ' Mobile Access', 'Personal phone link', reveal.link, 'Sign in with your United Dairy Google account.');
    if (b.id === 'ac-email') busy(box, b, async () => { const out = await call('accessEmail', { email: reveal.email, link: reveal.link }); say(box, out.message, out.ok ? 'good' : 'bad'); });
  });
  await load();
}

/* ---------- Manager Links, Plant Station Codes, Driver Station Codes (Joe 10/11: each link where it belongs) ---------- */

const APP_LINKS = [
  { key: 'company', title: 'United Dairy Operations', label: 'Company link', path: 'index.html', who: 'ud', opens: 'Every screen their role allows', guard: 'UD Google account and their role', shut: 'Remove them in People & Roles' },
  { key: 'phone', title: 'Phone link', label: 'Phone link', path: 'index.html', who: 'ud', opens: 'The phone screens (managers, supervisors, plant staff)', guard: 'UD Google account and their role', shut: 'Remove them in People & Roles' },
  { key: 'manager', title: 'Manager Web App', label: 'Manager link', path: 'manager.html', who: 'ud', opens: 'Managers only. Company Google sign-in, no code.', guard: 'UD Google account (Manager role)', shut: 'Change their role in People & Roles' },
  { key: 'plant', title: 'Plant Station (tablet)', label: 'Tablet link', path: 'plant-station.html', who: 'ud', opens: 'Every plant station from one link. The tablet types its station\'s code (Stations, below) and opens that station.', guard: 'The tablet\'s United Dairy Google account, then the station code. Moving the tablet to another station needs the plant\'s manager release code.', shut: 'New code or Remove on the station, below', extra: { label: 'Tablet icon page', url: 'https://ud-plant-tablet.web.app/' } },
  { key: 'public', title: 'Plant Station without a UD account (phone app)', label: '', path: '', who: 'code', opens: 'A plant station on a tablet or phone with no United Dairy account, by its station code. On or off for every plant station.', guard: 'Being built: it needs a Google sign-in permission IT turns on. Until then, plant tablets sign in with a UD account.', shut: 'On / Off here, once it is built', soon: true },
  { key: 'driver', title: 'Driver Station and TV', label: 'Tablet page', path: 'driver-station.html', who: 'ud', opens: 'Every Driver Room kiosk and TV from one link. Once a kiosk has a code (Kiosks, below), the tablet types it.', guard: 'UD sign-in, then the kiosk code', shut: 'Remove the account in People & Roles' },
  { key: 'garage', title: 'Garage Station', label: 'Garage tablet', path: 'garage-station.html', who: 'code', opens: 'Every garage station from one link. Once a garage station has a code (Stations, below), the tablet types it.', guard: 'The station code, then the technician\'s name and login ID', shut: 'Turn the technician off in Fleet Service' },
  { key: 'route', title: 'Route Distribution (drivers\' phones)', label: 'Browser link', path: 'route.html', who: 'code', opens: 'Drivers on their own phones: View Loadout, Check-In. No company account needed.', guard: 'Anyone with the Route Distribution code', shut: 'Turn the link off or make a new code below', code: true },
  { key: 'personal', title: 'Personal phone links', label: '', path: '', who: 'ud', opens: 'One person\'s phone screens', guard: 'Their own link, plus UD sign-in', shut: 'Revoke in Access & QR Codes', goto: 'access-codes' }
];

const MANAGER_LINKS = ['company', 'phone', 'manager', 'personal'];
const PLANT_LINKS = ['plant', 'public'];
const GARAGE_LINKS = ['garage'];
const DRIVER_LINKS = ['driver', 'route'];

// The link cards for the given keys; tail is more of the page under the cards (Plant Station Codes' release codes).
export async function renderAppLinks(box, ctx, keys = MANAGER_LINKS, tail = '') {
  let data = null;
  const links = APP_LINKS.filter(l => keys.indexOf(l.key) >= 0);
  const sandbox = /sandbox|localhost|127\.0\.0\.1/.test(location.hostname);
  box.innerHTML = '<div class="ap"><div class="ap-bar"><button type="button" class="ap-btn" id="al-reload">Refresh</button><div class="ap-right"><span class="ap-chip blue">Blue: UD Google sign-in</span><span class="ap-chip orange">Orange: anyone with the code</span></div></div>' +
    '<div class="ap-msg" hidden></div>' + (sandbox ? '<div class="ap-msg bad">SANDBOX &mdash; TEST ONLY. Do not give these to drivers or plant staff.</div>' : '') + '<div class="ap-scroll" style="padding:10px"><div class="ap-links" id="al-list"></div>' + tail + '</div></div>';
  const $ = (s) => box.querySelector(s);
  const url = (l) => location.origin + '/' + l.path;
  function codeRow() {
    const c = data.routeCode;
    const codeText = c.code ? '<code>' + e(c.code) + '</code> <button type="button" class="ap-btn small" id="al-copy-code">Copy Code</button>' : c.state === 'NOT SET' ? 'No code yet' : 'Make a new code once to show it here';
    return '<div class="ap-code-row"><b>Route Distribution code:</b> ' + codeText + ' <span class="ap-chip ' + (c.state === 'ACTIVE' ? 'good' : c.state === 'DISABLED' ? 'bad' : '') + '">' + (c.state === 'ACTIVE' ? 'ON' : c.state === 'DISABLED' ? 'OFF' : 'NOT SET') + '</span>' +
      (c.setAt ? '<small class="ap-help">changed ' + e(when(c.setAt)) + ' by ' + e(c.setBy) + '</small>' : '') +
      '<span style="margin-left:auto;display:flex;gap:6px"><button type="button" class="ap-btn small warn" id="al-new-code">' + (c.state === 'NOT SET' ? 'Generate Code' : 'Rotate Code') + '</button>' +
      (c.state === 'ACTIVE' ? '<button type="button" class="ap-btn small" id="al-off">Turn Off</button>' : c.state === 'DISABLED' ? '<button type="button" class="ap-btn small main" id="al-on">Turn On</button>' : '') + '</span>' +
      '<p class="ap-note" style="flex-basis:100%">Off stops the drivers\' phone link. UD sign-in links keep working. A new code makes every phone ask for it again.</p></div>';
  }
  function render() {
    $('#al-list').innerHTML = links.map(l => '<div class="ap-link" data-link="' + l.key + '"><div><h4>' + e(l.title) + ' <span class="ap-chip ' + (l.who === 'ud' ? 'blue' : 'orange') + '">' + (l.who === 'ud' ? 'UD sign-in only' : 'Anyone with the code') + '</span></h4>' +
      '<p>' + e(l.opens) + '</p></div><div><p><b>Who can open it:</b> ' + e(l.guard) + '</p><p><b>Turn off or change:</b> ' + e(l.shut) + '</p>' + (l.path ? '<p class="ap-url">' + e(url(l)) + '</p>' : '') +
      (l.extra ? '<p>' + e(l.extra.label) + ': <span class="ap-url">' + e(l.extra.url) + '</span></p>' : '') + '</div><div class="ap-acts">' +
      (l.soon ? '<span class="ap-chip">Being built</span>' : l.goto ? '<button type="button" class="ap-btn small main" data-goto="' + l.goto + '">Details</button>' : '<button type="button" class="ap-btn small" data-copy="' + l.key + '">Copy Link</button><button type="button" class="ap-btn small" data-qr="' + l.key + '">Print QR</button>' +
        '<a class="ap-btn small main" href="' + e(l.path) + '">Launch</a>') + '</div>' + (l.code ? codeRow() : '') + '</div>').join('');
  }
  async function load() { try { data = await call('appLinks'); if (box.isConnected) render(); } catch (err) { say(box, errText(err), 'bad'); } }
  box.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b) return;
    const l = links.find(x => x.key === (b.dataset.copy || b.dataset.qr));
    if (b.id === 'al-reload') load();
    if (b.dataset.goto && ctx && ctx.open) ctx.open(b.dataset.goto);
    if (b.dataset.copy) copyText(b, url(l));
    if (b.dataset.qr) printQr(l.title, l.label, url(l), l.code ? (data.routeCode.code ? 'Code: <b>' + e(data.routeCode.code) + '</b>' : 'Enter the code your supervisor gives you.') : l.who === 'code' ? e(l.guard) + '.' : 'Sign in with your United Dairy Google account.');
    if (b.id === 'al-copy-code') copyText(b, data.routeCode.code);
    if (b.id === 'al-new-code') twice(b, 'Click Again to Confirm', () => busy(box, b, async () => { const out = await call('routeCodeNew'); await load(); say(box, out.message, 'good'); }));
    if (b.id === 'al-off') twice(b, 'Click Again to Turn Off', () => busy(box, b, async () => { const out = await call('routeCodeOnOff', { open: false }); await load(); say(box, out.message, 'good'); }));
    if (b.id === 'al-on') busy(box, b, async () => { const out = await call('routeCodeOnOff', { open: true }); await load(); say(box, out.message, 'good'); });
  });
  await load();
}

/* ---------- Stations and their codes (Joe 10/12: one link, then a list of stations, each with its own code) ---------- */

const STATION_PAGES = {
  PLANT: { title: 'Stations', add: '+ Add Station', what: 'station', help: 'Each station has its own code. On the tablet, open the Plant Station link and type the station\'s code: the tablet opens that station and keeps it. To move a tablet, a manager taps Change Station and types the plant\'s manager release code (below). Until a plant has a station code, its tablets pick their station from the list.' },
  GARAGE: { title: 'Stations', add: '+ Add Station', what: 'station', help: 'Each garage station has its own code. On the garage tablet, open the Garage Station link and type the code. To move a tablet, a manager taps Change Station and types the plant\'s manager release code (Plant Station Codes). Until a plant has a garage code, its garage tablet opens straight away.' },
  KIOSK: { title: 'Kiosks', add: '+ Add Kiosk', what: 'kiosk', help: 'A kiosk is a Driver Room tablet or a TV, and a plant can have more than one (for example a kiosk in the plant too). Open the Driver Station link on it and type its code; a TV display opens the scrolling board. To move it, a manager taps Change and types the plant\'s manager release code (Plant Station Codes). Until a plant has a kiosk code, its kiosks open straight away.' }
};

// The station list for one kind under a page's link cards: name, type, plant, code; New code, Remove, and Add.
function stationSection(kind) {
  const p = STATION_PAGES[kind];
  return '<div class="ap-section" style="margin-top:10px" data-kind="' + kind + '"><h3>' + p.title + '</h3><p class="ap-note">' + e(p.help) + '</p><div class="ap-list" id="st-list"></div>' +
    '<div class="ap-form" style="margin-top:8px"><label class="ap-field">New ' + p.what + ' name<input id="st-name" maxlength="60" placeholder="For example ' + (kind === 'KIOSK' ? 'Plant kiosk' : kind === 'GARAGE' ? 'Garage bay 2' : 'Case Loadout dock 2') + '"></label>' +
    '<label class="ap-field">Type<select id="st-type"></select></label><label class="ap-field">Plant<select id="st-plant"></select></label>' +
    '<div><button type="button" class="ap-btn main" id="st-add">' + p.add + '</button></div></div></div>';
}
function bindStations(box, kind) {
  const $ = (s) => box.querySelector(s), what = STATION_PAGES[kind].what;
  async function load(out) {
    try {
      const data = out && out.stations ? out : await call('stations', { kind });
      if (!box.isConnected) return;
      if (!$('#st-type').options.length) {
        $('#st-type').innerHTML = data.types.map(t => '<option value="' + t.id + '">' + e(t.name) + '</option>').join('');
        $('#st-plant').innerHTML = data.plants.map(t => '<option value="' + t.id + '">' + e(t.name) + '</option>').join('');
        $('#st-plant').disabled = data.plants.length < 2;
      }
      $('#st-list').innerHTML = data.stations.map(s => '<div class="ap-item" data-station-key="' + e(s.key) + '"><div><b>' + e(s.name) + '</b><small>' + e(s.typeName) + ' &middot; ' + e(s.plant) +
        (s.changedAt ? ' &middot; code changed ' + e(when(s.changedAt)) + ' by ' + e(s.changedBy) : '') + '</small></div>' +
        (s.code ? '<code>' + e(s.code) + '</code><button type="button" class="ap-btn small" data-st-copy="' + e(s.code) + '">Copy Code</button>' : '<span class="ap-chip">' + (s.set ? 'Code is set' : 'No code yet') + '</span>') +
        '<button type="button" class="ap-btn ' + (s.set ? 'warn' : 'main') + '" data-st-code="' + e(s.key) + '"' + (s.set ? ' data-again="1"' : '') + '>' + (s.set ? 'New code' : 'Create code') + '</button>' +
        '<button type="button" class="ap-btn" data-st-remove="' + e(s.key) + '">Remove</button></div>').join('') || '<div class="ap-empty">No ' + what + ' yet. Add one below.</div>';
    } catch (err) { say(box, errText(err), 'bad'); }
  }
  box.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'al-reload') load();
    if (b.dataset.stCopy) copyText(b, b.dataset.stCopy);
    if (b.dataset.stCode) {
      const go = () => busy(box, b, async () => { const out = await call('stationCode', { key: b.dataset.stCode }); await load(out); say(box, out.message, 'good'); });
      if (b.dataset.again) twice(b, 'Press again to replace', go); else go();
    }
    if (b.dataset.stRemove) twice(b, 'Press again to remove', () => busy(box, b, async () => { const out = await call('stationRemove', { key: b.dataset.stRemove }); await load(out); say(box, out.message, 'good'); }));
    if (b.id === 'st-add') busy(box, b, async () => {
      const out = await call('stationAdd', { kind, type: $('#st-type').value, facilityId: $('#st-plant').value, name: $('#st-name').value });
      $('#st-name').value = '';
      await load(out); say(box, out.message, 'good');
    });
  });
  return load();
}

/* ---------- Plant Station Codes: the link, the stations, and each plant's manager release code ---------- */

export async function renderStationCodes(box, ctx) {
  const tail = stationSection('PLANT') + '<div class="ap-section" style="margin-top:10px"><h3>Manager release codes</h3>' +
    '<p class="ap-note">A tablet keeps its station. To move it (Plant Station, Garage Station or a kiosk), a manager taps Change Station on the tablet and types the release code for that plant. With no release code set, anyone signed in on the tablet can move it.</p>' +
    '<div class="ap-list" id="sc-list"></div><p class="ap-note">Five wrong release codes lock the release for ten minutes.</p></div>';
  const links = renderAppLinks(box, ctx, PLANT_LINKS, tail);
  const $ = (s) => box.querySelector(s);
  async function load() {
    try {
      const data = await call('releaseCodes');
      if (!box.isConnected) return;
      $('#sc-list').innerHTML = data.plants.map(p => '<div class="ap-item"><div><b>' + e(p.name) + '</b><small>Manager release code' + (p.changedAt ? ' &middot; changed ' + e(when(p.changedAt)) + ' by ' + e(p.changedBy) : '') + '</small></div>' +
        (p.code ? '<code>' + e(p.code) + '</code>' : '<span class="ap-chip">' + (p.set ? 'Code is set' : 'No code yet') + '</span>') +
        '<button type="button" class="ap-btn ' + (p.set ? 'warn' : 'main') + '" data-plant="' + p.id + '"' + (p.set ? ' data-again="1"' : '') + '>' + (p.set ? 'New code' : 'Create code') + '</button></div>').join('');
    } catch (err) { say(box, errText(err), 'bad'); }
  }
  box.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'al-reload') load();
    if (b.dataset.plant) {
      const go = () => busy(box, b, async () => { const out = await call('releaseCodeNew', { facilityId: b.dataset.plant }); await load(); say(box, out.message, 'good'); });
      if (b.dataset.again) twice(b, 'Press again to replace', go); else go();
    }
  });
  await Promise.all([links, load(), bindStations(box, 'PLANT')]);
}

// Garage Station Codes and Driver Station Codes: the links, then the stations (kiosks) with their codes.
export async function renderGarageCodes(box, ctx) { await Promise.all([renderAppLinks(box, ctx, GARAGE_LINKS, stationSection('GARAGE')), bindStations(box, 'GARAGE')]); }
export async function renderDriverCodes(box, ctx) { await Promise.all([renderAppLinks(box, ctx, DRIVER_LINKS, stationSection('KIOSK')), bindStations(box, 'KIOSK')]); }

/* ---------- Manager Report Recipients ---------- */

export async function renderReportRecipients(box) {
  let data = null, fac = 'fac_uniontown';
  box.innerHTML = '<div class="ap"><div class="ap-bar"><button type="button" class="ap-btn main" id="rr-save">Save</button><button type="button" class="ap-btn" id="rr-reload">Refresh</button>' +
    '<div class="ap-right"><label class="ap-field" style="flex-direction:row;align-items:center;gap:8px">Location <select id="rr-loc"></select></label></div></div><div class="ap-msg" hidden></div>' +
    '<p class="ap-note">The Send Current Report card in Manager Center emails one of these groups. Type the addresses separated by commas, then Save. Each location has its own groups.</p>' +
    '<div id="rr-sending"></div><div class="ap-scroll" style="padding:10px"><div class="ap-list" id="rr-list"></div>' +
    '<div class="ap-section" style="margin-top:10px"><h3>New group</h3><div class="ap-grid2"><label class="ap-field">Group name<small>Name it, e.g. Plant Management</small><input id="rr-new-name" maxlength="100"></label>' +
    '<label class="ap-field">Addresses<small>Separated by commas</small><input id="rr-new-to" placeholder="name@uniteddairy.com, second@uniteddairy.com"></label></div></div></div></div>';
  const $ = (s) => box.querySelector(s);
  function render() {
    $('#rr-loc').innerHTML = data.locations.map(l => '<option value="' + l.id + '"' + (l.id === fac ? ' selected' : '') + '>' + e(l.name) + '</option>').join('');
    $('#rr-loc').disabled = data.locations.length < 2;
    $('#rr-sending').innerHTML = data.sending ? '<div class="ap-msg good">Email sending is ON.</div>' : '<div class="ap-msg bad">Email sending is OFF, so the report will not go out. Turn it on in Sent Email Log.</div>';
    $('#rr-list').innerHTML = data.groups.map(g => '<div class="ap-item"><div><label class="ap-field">' + e(g.name) + '<input data-group="' + e(g.name) + '" data-was="' + e(g.recipients.join(', ')) + '" value="' + e(g.recipients.join(', ')) + '"></label>' +
      '<small>Changed ' + e(when(g.updatedAt)) + ' by ' + e(g.updatedBy) + '</small></div><button type="button" class="ap-btn" data-remove="' + e(g.name) + '">Remove</button></div>').join('') ||
      '<div class="ap-empty">No group yet. Add one below so the report card has someone to send to.</div>';
  }
  async function load() { try { data = await call('reportGroups', { facilityId: fac }); if (box.isConnected) render(); } catch (err) { say(box, errText(err), 'bad'); } }
  box.addEventListener('change', ev => { if (ev.target.id === 'rr-loc') { fac = ev.target.value; load(); } });
  box.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'rr-reload') load();
    if (b.dataset.remove) {
      const g = data.groups.find(x => x.name === b.dataset.remove);
      twice(b, 'Press again to remove', () => busy(box, b, async () => { const out = await call('saveReportGroup', { facilityId: fac, name: g.name, recipients: g.recipients.join(','), active: false }); await load(); say(box, out.message, 'good'); }));
    }
    if (b.id === 'rr-save') {
      const changed = [...box.querySelectorAll('[data-group]')].filter(i => i.value.trim() !== i.dataset.was);
      const name = $('#rr-new-name').value.trim(), to = $('#rr-new-to').value.trim();
      if ((name && !to) || (!name && to)) { say(box, 'A new group needs a name and at least one address.', 'bad'); return; }
      if (!changed.length && !name) { say(box, 'Nothing changed.'); return; }
      busy(box, b, async () => {
        for (const i of changed) await call('saveReportGroup', { facilityId: fac, name: i.dataset.group, recipients: i.value });
        if (name) await call('saveReportGroup', { facilityId: fac, name, recipients: to });
        await load();
        say(box, 'Saved.', 'good');
      });
    }
  });
  await load();
}

/* ---------- Sent Email Log and the Sending switch ---------- */

const STATUS = { SENT: ['Sent', 'good'], BLOCKED: ['Stopped (off)', 'bad'], FAILED: ['Failed', 'bad'], HELD: ['Held', 'warn'] };
export async function renderSentLog(box) {
  box.innerHTML = '<div class="ap"><div class="ap-bar"><button type="button" class="ap-btn" id="sl-reload">Refresh</button><span id="sl-switch-wrap" style="display:flex;gap:8px;align-items:center"></span></div>' +
    '<div class="ap-msg" hidden></div><p class="ap-note">Every email the new app sent, stopped, held, or failed. Newest first. On the sandbox an email goes only to the person who pressed the button.</p>' +
    '<div class="ap-scroll"><table class="ap-t"><thead><tr><th>When</th><th>Status</th><th>What</th><th>To</th><th>Subject</th></tr></thead><tbody id="sl-rows"></tbody></table></div></div>';
  const $ = (s) => box.querySelector(s);
  async function load() {
    try {
      const data = await call('sentLog');
      if (!box.isConnected) return;
      const s = data.settings;
      $('#sl-switch-wrap').innerHTML = (s.sending ? '<button type="button" class="ap-btn warn" id="sl-off">Turn off</button>' : '<button type="button" class="ap-btn main" id="sl-on">Turn on</button>') +
        '<span class="' + (s.sending ? 'ap-chip good' : 'ap-chip bad') + '">' + (s.sending ? 'Sending is ON' : 'Sending is OFF') + '</span><span class="ap-help">' +
        (s.sending ? (s.changedBy ? 'Turned on by ' + e(s.changedBy) + ' ' + e(when(s.changedAt)) : '') : 'Nothing is emailed, and each attempt is logged as stopped.') + '</span>';
      $('#sl-rows').innerHTML = data.emails.map(m => {
        const st = STATUS[m.status] || [m.status, ''];
        return '<tr><td>' + e(when(m.at)) + '</td><td><span class="ap-chip ' + st[1] + '">' + e(st[0]) + '</span></td><td><b>' + e(m.label || m.kind) + '</b><small>' + e([m.kind, m.detail, m.by, m.from ? 'from ' + m.from : ''].filter(Boolean).join(' · ')) + '</small></td>' +
          '<td>' + e((m.sentTo && m.sentTo.length ? m.sentTo : m.meantFor || []).join('; ')) + (m.testCopy && m.meantFor && m.meantFor.length ? '<small>meant for ' + e(m.meantFor.join('; ')) + '</small>' : '') + '</td>' +
          '<td>' + e(m.subject) + (m.reason ? '<small>' + e(m.reason) + '</small>' : '') + '</td></tr>';
      }).join('') || '<tr><td colspan="5" class="ap-empty">No email has been sent or stopped yet.</td></tr>';
    } catch (err) { say(box, errText(err), 'bad'); }
  }
  box.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'sl-reload') load();
    if (b.id === 'sl-off') busy(box, b, async () => { const out = await call('setSending', { on: false }); await load(); say(box, out.message, 'good'); });
    if (b.id === 'sl-on') twice(b, 'Press again to turn on', () => busy(box, b, async () => { const out = await call('setSending', { on: true }); await load(); say(box, out.message, 'good'); }));
  });
  await load();
}

/* ---------- Email Senders ---------- */

// Joe 10/11: an email someone sends comes from their own United Dairy email; one no one pressed comes from the plant's mailbox.
export async function renderEmailSenders(box, ctx) {
  let data = null;
  box.innerHTML = '<div class="ap"><div class="ap-bar"><button type="button" class="ap-btn main" id="es-save">Save</button><button type="button" class="ap-btn" id="es-reload">Refresh</button>' +
    '<div class="ap-right"><span id="es-sending"></span></div></div><div class="ap-msg" hidden></div>' +
    '<div class="ap-scroll"><div class="ap-section" style="margin:10px"><h3>Emails someone sends</h3><p class="ap-note">Send Current Report, the Lessor button on a truck write-up, Send now and access links.</p>' +
    '<label class="ap-field" style="max-width:620px">Come from<select id="es-who"><option value="PERSON">The person who presses Send (their own United Dairy email)</option><option value="PLANT">The plant\'s address below</option></select></label></div>' +
    '<div class="ap-section" style="margin:10px"><h3>Emails no one presses</h3><p class="ap-note">Automatic and once-a-day repair emails come from each plant\'s address. Leave a plant empty to keep the standard sender.</p></div>' +
    '<table class="ap-t"><thead><tr><th>Plant</th><th>Send emails from</th><th>Name people see</th><th>Changed</th></tr></thead><tbody id="es-rows"></tbody></table></div></div>';
  const $ = (s) => box.querySelector(s);
  function render() {
    $('#es-sending').innerHTML = data.sending ? '<span class="ap-chip good">Sending is ON</span>' : '<button type="button" class="ap-btn small" data-goto="sent-log">Sending is OFF: turn it on</button>';
    const std = data.standard, empty = std ? 'Empty: sends as the standard sender, ' + e(std) : 'Empty: no email goes out for this plant until an address is set';
    $('#es-rows').innerHTML = data.plants.map(p => '<tr><td><b>' + e(p.plant) + '</b></td>' +
      '<td><input data-addr="' + e(p.id) + '" value="' + e(p.address) + '" maxlength="120" placeholder="' + e(std || 'name@uniteddairy.com') + '" style="width:100%">' + (p.address ? '' : '<small>' + empty + '</small>') + '</td>' +
      '<td><input data-name="' + e(p.id) + '" value="' + e(p.senderName) + '" maxlength="80" placeholder="United Dairy ' + e(p.plant) + ' Operations" style="width:100%"></td>' +
      '<td>' + (p.changedAt ? e(when(p.changedAt)) + '<small>' + e(p.changedBy) + '</small>' : '') + '</td></tr>').join('');
    $('#es-who').value = data.fromWho;
  }
  async function load() { try { data = await call('emailSenders'); if (box.isConnected) render(); } catch (err) { say(box, errText(err), 'bad'); } }
  box.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.goto && ctx) { ctx.open(b.dataset.goto); return; }
    if (b.id === 'es-reload') load();
    if (b.id === 'es-save') {
      const senders = {};
      data.plants.forEach(p => { senders[p.id] = { address: box.querySelector('[data-addr="' + p.id + '"]').value, name: box.querySelector('[data-name="' + p.id + '"]').value }; });
      busy(box, b, async () => { await call('saveEmailSenders', { senders, fromWho: $('#es-who').value }); await load(); say(box, 'Saved.', 'good'); });
    }
  });
  await load();
}

/* ---------- Remaining Repair Items ---------- */

export async function renderRepairItems(box, ctx) {
  box.innerHTML = '<div class="ap"><div class="ap-bar"><button type="button" class="ap-btn main" id="ri-add">Add Item</button><button type="button" class="ap-btn" id="ri-reload">Refresh</button>' +
    '<div class="ap-right"><span class="ap-chip warn" id="ri-count"></span></div></div><div class="ap-msg" hidden></div>' +
    '<div class="ap-form"><label class="ap-field">Repair item<input id="ri-title" maxlength="200"></label><label class="ap-field">Notes / verification needed<input id="ri-notes" maxlength="1000"></label>' +
    '<label class="ap-field">Priority<select id="ri-priority"><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="BLOCKER">Blocker</option></select></label><span></span></div>' +
    '<div class="ap-scroll" style="padding:10px"><div class="ap-list" id="ri-list"></div></div></div>';
  const $ = (s) => box.querySelector(s);
  function render(data) {
    $('#ri-count').textContent = data.count + ' open';
    $('#ri-list').innerHTML = data.open.map(i => '<div class="ap-item"><div><b>' + e(i.title) + '</b><small>' + e(i.priority) + (i.notes ? ' &middot; ' + e(i.notes) : '') + ' &middot; added ' + e(when(i.createdAt)) + ' by ' + e(i.createdBy) + '</small></div>' +
      '<button type="button" class="ap-btn" data-complete="' + e(i.id) + '">Complete</button></div>').join('') || '<div class="ap-empty">All tracked repair items are complete.</div>';
    if (ctx && ctx.repairs) ctx.repairs(data.count);
  }
  async function load() { try { const data = await call('repairItems'); if (box.isConnected) render(data); } catch (err) { say(box, errText(err), 'bad'); } }
  box.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'ri-reload') load();
    if (b.id === 'ri-add') {
      const title = $('#ri-title').value.trim();
      if (!title) { say(box, 'Type the repair item.', 'bad'); return; }
      busy(box, b, async () => {
        const out = await call('saveRepairItem', { title, notes: $('#ri-notes').value, priority: $('#ri-priority').value });
        $('#ri-title').value = ''; $('#ri-notes').value = ''; $('#ri-priority').value = 'NORMAL';
        render(out); say(box, out.message, 'good');
      });
    }
    if (b.dataset.complete) busy(box, b, async () => { const out = await call('completeRepairItem', { itemId: b.dataset.complete }); render(out); say(box, out.message, 'good'); });
  });
  await load();
}

// Administration item key -> page.
export const PAGES = {
  people: renderPeople,
  'role-templates': renderRoleTemplates,
  'access-codes': renderAccessCodes,
  'app-links': renderAppLinks,
  'station-codes': renderStationCodes,
  'garage-codes': renderGarageCodes,
  'driver-codes': renderDriverCodes,
  'report-recipients': renderReportRecipients,
  'sent-log': renderSentLog,
  'email-senders': renderEmailSenders,
  'repair-items': renderRepairItems
};
