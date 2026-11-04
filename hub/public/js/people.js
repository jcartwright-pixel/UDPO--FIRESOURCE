/*
 * People & Access in the hub (Joe 11-2-26: "all the managers access ... laid out a little bit better ... one change all").
 * The same Users list and the same saves as Operations' Administration, People & Roles: the hub calls Operations' own server
 * call (admin: people, savePerson, setHomeScreen), so nothing about how people are kept is redone and a change here is a
 * change everywhere. Each person's line also says which apps they can open from the hub, by the same rules as the hub's tiles.
 * Everything People & Roles has is here too (11-3-26): which Plant & Distribution screens they see at each plant, their
 * Home screen there, and single rights (use the role's, allow, deny), so People & Roles can become a link to this page.
 * Joe 11-3-26: each app is a tick box on every person's line, ticked for what they can open now; a tick saves at once (the
 * hub's own call, setApps). Plant & Distribution stays ticked for everyone Enabled; nobody can untick their own apps.
 */
import { callServer, escapeHtml as e, showError, serverText, shortDate, setAdmin, myEmail } from './shell.js';
import { APPS, LOOK, appKeysFor, isAdminRole, roleKey } from './apps.js';
import { plantsFor, screenKeys, homeChoices, rightAllowed, adminOnly } from './access.js';

const prettyRole = (r) => String(r).charAt(0) + String(r).slice(1).toLowerCase().replace(/_/g, ' ');
let data = null, picked = null, draft = null;
const $ = (s) => document.querySelector(s);
const plantName = (id) => id === '*' ? 'All plants' : ((data.plants || []).find(p => p.id === id) || {}).name || id;
const plantsText = (p) => (p.facilities || []).length ? p.facilities.map(plantName).join(', ') : (isAdminRole(p.roles) ? 'All plants' : 'Uniontown');
const areas = () => data.screenAreas || [];
// The apps the draft will open: their ticks once changed, or what their role and account give.
const draftApps = () => draft.status !== 'ACTIVE' ? [] : draft.appsChanged ? appKeysFor(draft, draft.apps) : appKeysFor(draft, draft.isNew ? null : (data.saved || {})[draft.email] || null);
const asPerson = () => Object.assign({}, draft, { status: 'ACTIVE' });
const draftPlants = () => plantsFor(asPerson(), data.plants || []);
const allTicks = () => { const out = {}; draftPlants().forEach(id => { out[id] = screenKeys(areas()); }); return out; };
const ticks = () => draft.screens || allTicks();
const ticked = (plant, key) => (ticks()[plant] || []).indexOf(key) >= 0;

function setTicks(plant, keys, on) {
  const t = draft.screens || allTicks();
  const have = new Set(t[plant] || []);
  keys.forEach(k => { if (on) have.add(k); else have.delete(k); });
  t[plant] = screenKeys(areas()).filter(k => have.has(k));
  draft.screens = t; draft.screensChanged = true;
}

const icon = (k, size) => LOOK[k].icon.replace('width="32" height="32"', 'width="' + size + '" height="' + size + '"');
const initials = (p) => String(p.name || p.email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
const appsOf = (p) => appKeysFor(p, (data.saved || {})[p.email] || null);
// One app's tick box. Plant & Distribution is always on for an Enabled person; a Disabled person and yourself are locked.
function appTick(p, k, on, attr) {
  const locked = p.status !== 'ACTIVE' || k === 'operations' || p.email === myEmail();
  const why = p.status !== 'ACTIVE' ? 'Disabled: no apps' : k === 'operations' ? 'Everyone Enabled opens Plant & Distribution; choose their screens below' : p.email === myEmail() ? 'You cannot take apps away from yourself' : '';
  const name = APPS.find(a => a.key === k).name;
  return '<label class="app-tick" style="--app:' + LOOK[k].color + '" title="' + e(why || name) + '"><input type="checkbox" ' + attr + '="' + k + '"' + (on ? ' checked' : '') + (locked ? ' disabled' : '') +
    ' aria-label="' + e(name + ' for ' + (p.name || p.email)) + '"><span class="box" aria-hidden="true"></span></label>';
}

function drawList() {
  const find = $('#find').value.trim().toLowerCase(), show = $('#show').value, role = $('#role-filter').value;
  const rows = data.people.filter(p => (show === 'all' || p.status === show) && (!role || (p.roles || []).map(roleKey).indexOf(role) >= 0) &&
    (!find || (p.name + ' ' + p.email).toLowerCase().indexOf(find) >= 0))
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  $('#count').textContent = rows.length + ' of ' + data.people.length + ' people';
  $('#head').innerHTML = '<tr><th class="l">Person</th><th class="l c-role">Role</th><th class="l c-plants">Plants</th>' +
    APPS.map(a => '<th class="c-app" title="' + e(a.name) + '"><span class="app-ico" style="--app:' + LOOK[a.key].color + '">' + icon(a.key, 18) + '</span><small>' + e(a.name) + '</small></th>').join('') + '<th>Account</th></tr>';
  $('#rows').innerHTML = rows.map(p => {
    const mine = appsOf(p);
    return '<tr class="pick' + (picked === p.email ? ' on' : '') + (p.status === 'ACTIVE' ? '' : ' inactive') + '" data-email="' + e(p.email) + '">' +
      '<td class="l who"><div class="who-in"><span class="avatar' + (isAdminRole(p.roles) ? ' admin' : '') + '" aria-hidden="true">' + e(initials(p)) + '</span><span><b>' + e(p.name || '(no name)') + '</b><small>' + e(p.email).replace('@', '@<wbr>') + '</small></span></div></td>' +
      '<td class="l c-role"><span class="role-tag' + (isAdminRole(p.roles) ? ' admin' : '') + '">' + e((p.roles || []).map(prettyRole).join(' + ') || 'None') + '</span></td>' +
      '<td class="l c-plants">' + e(plantsText(p)) + '</td>' +
      APPS.map(a => '<td class="c-app">' + appTick(p, a.key, mine.indexOf(a.key) >= 0, 'data-app') + '</td>').join('') +
      '<td><span class="pill ' + (p.status === 'ACTIVE' ? 'good' : 'muted') + '">' + (p.status === 'ACTIVE' ? 'Enabled' : 'Disabled') + '</span></td></tr>';
  }).join('') || '<tr><td colspan="' + (4 + APPS.length) + '" class="muted">Nobody matches.</td></tr>';
}

// A tick on a person's line saves at once.
async function tickApp(box) {
  const tr = box.closest('tr[data-email]'), p = data.people.find(x => x.email === tr.dataset.email);
  const want = [...tr.querySelectorAll('input[data-app]:checked')].map(x => x.dataset.app);
  const name = APPS.find(a => a.key === box.dataset.app).name, who = p.name || p.email;
  tr.querySelectorAll('input[data-app]').forEach(x => { x.disabled = true; });
  say('');
  try {
    const r = await callServer('hub', { op: 'setApps', email: p.email, apps: want });
    data.saved[p.email] = r.apps;
    if (draft && draft.email === p.email && !draft.appsChanged) draft.apps = r.apps.slice();
    say(who + (box.checked ? ' can now open ' : ' can no longer open ') + name + '.', 'good');
  } catch (err) {
    say(name + ' for ' + who + ' was not saved: ' + serverText(err, 'the hub'), 'bad');
  }
  drawList();
  if (draft && draft.email === p.email) drawEdit();
}
function say(text, kind) {
  const m = $('#list-msg');
  m.hidden = !text; m.textContent = text || ''; m.className = 'list-msg ' + (kind || '');
}

// Which Plant & Distribution screens they see: one plant at a time, each area ticked whole or opened to tick single screens.
function screensBlock(admin) {
  if (admin) return '<p class="note">An Administrator sees every screen at every plant.</p>';
  const mine = draftPlants();
  if (draft.status !== 'ACTIVE') return '<p class="note">A Disabled person sees nothing. Enable them to choose their screens.</p>';
  if (mine.indexOf(draft.plantTab) < 0) draft.plantTab = mine[0];
  const plant = draft.plantTab;
  const jobs = '<option value="">Pick a job to tick its screens</option>' + (data.screenJobs || []).map(j => '<option value="' + e(j.key) + '">' + e(j.name) + '</option>').join('') +
    '<option value="__all__">Every screen their role allows</option>';
  const rows = areas().filter(a => a.screens.length).map(a => {
    const keys = a.screens.map(s => s[0]), n = keys.filter(k => ticked(plant, k)).length, open = draft.openAreas.indexOf(a.key) >= 0;
    return '<li><div class="area-line"><label class="tick"><input type="checkbox" data-keys="' + keys.join(' ') + '"' + (n === keys.length ? ' checked' : '') + (n && n < keys.length ? ' data-part="1"' : '') + '> <b>' + e(a.name) + '</b></label>' +
      '<span class="muted small">' + n + ' of ' + keys.length + '</span><button type="button" class="link" data-open="' + e(a.key) + '" aria-expanded="' + open + '">' + (open ? 'Hide screens' : 'Show screens') + '</button></div>' +
      (open ? '<ul>' + a.screens.map(s => '<li><label class="tick"><input type="checkbox" data-keys="' + e(s[0]) + '"' + (ticked(plant, s[0]) ? ' checked' : '') + '> ' + e(s[1]) + '</label></li>').join('') + '</ul>' : '') + '</li>';
  }).join('');
  return '<p class="muted small">' + (draft.screens ? 'Only the ticked screens show on their Home and menu, and the rest are refused.' :
    'Nothing is limited yet: they see every screen their role allows. Untick what they should not see, or start from a job.') + (draft.screensChanged ? ' <span class="pill warn">Not saved yet</span>' : '') + '</p>' +
    '<div class="prow">' + (mine.length > 1 ? '<label class="pfield">Plant<select id="f-plant">' + mine.map(id => '<option value="' + id + '"' + (id === plant ? ' selected' : '') + '>' + e(plantName(id)) + '</option>').join('') + '</select></label>' :
      '<span class="pfield">Plant<b class="plain">' + e(plantName(plant)) + '</b></span>') +
    '<label class="pfield">Start from a job<select id="f-job">' + jobs + '</select></label></div>' +
    '<ul class="areas">' + rows + '</ul>';
}

function homeBlock() {
  const list = homeChoices(asPerson(), draft.screens, areas(), data.plants || []), have = draft.home || '';
  let html = '<option value="">The normal Home</option>', group = '';
  list.forEach(c => {
    if (c.group !== group) html += (group ? '</optgroup>' : '') + '<optgroup label="' + e(group = c.group) + '">';
    html += '<option value="' + e(c.page) + '"' + (c.page === have ? ' selected' : '') + '>' + e(c.name) + '</option>';
  });
  if (group) html += '</optgroup>';
  if (have && !list.some(c => c.page === have)) html += '<option value="' + e(have) + '" selected>' + e(have.replace(/\.html$/, '')) + ' (no longer ticked)</option>';
  return '<label class="pfield">Home screen<select id="f-home">' + html + '</select><small class="muted">The page they land on when they open Plant &amp; Distribution.</small></label>';
}

function rightsBlock(admin) {
  let group = '';
  const changed = draft.grants.length + draft.denials.length;
  const rows = (data.catalog || []).map(r => {
    const g = r.group !== group ? '<tr class="group"><td colspan="3">' + e(group = r.group) + '</td></tr>' : '';
    const lock = admin || adminOnly(r.code);
    const v = draft.grants.indexOf(r.code) >= 0 ? 'allow' : draft.denials.indexOf(r.code) >= 0 ? 'deny' : 'role';
    const ok = rightAllowed(draft, r.code, data.templates, data.defaults);
    return g + '<tr><td class="l">' + e(r.label) + '</td><td><select data-right="' + e(r.code) + '" aria-label="' + e(r.label) + '"' + (lock ? ' disabled' : '') + '>' +
      [['role', 'Use role'], ['allow', 'Allow'], ['deny', 'Deny']].map(o => '<option value="' + o[0] + '"' + (v === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></td>' +
      '<td>' + (ok ? '<span class="pill good">Allowed</span>' : '<span class="pill muted">Blocked</span>') + '</td></tr>';
  }).join('');
  return '<details class="pblock" id="f-rights"' + (draft.rightsOpen ? ' open' : '') + '><summary>Single rights' + (changed ? ' (' + changed + ' changed from the role)' : '') + '</summary>' +
    (admin ? '<p class="note">An Administrator has every right.</p>' : '<p class="muted small">Use role gives what their role gives. Allow or Deny changes one right for this person only. Deny wins over Allow.</p>') +
    '<table class="rights"><tbody>' + rows + '</tbody></table></details>';
}

function drawEdit() {
  const box = $('#edit');
  if (!draft) { box.innerHTML = '<p class="muted">Pick a person on the list to change them, or press <b>+ Add Person</b>.</p>'; return; }
  const primary = !draft.isNew && (data.people.find(p => p.email === draft.email) || {}).primary;
  const plants = (data.plants || []).filter(p => p.status !== 'RETIRED');
  const all = draft.facilities.indexOf('*') >= 0, admin = isAdminRole(draft.roles);
  box.innerHTML = '<h2>' + (draft.isNew ? 'Add Person' : e(draft.name || draft.email)) + '</h2>' +
    '<label class="pfield">Name<input id="f-name" maxlength="120" value="' + e(draft.name) + '"></label>' +
    '<label class="pfield">United Dairy email<input id="f-email" type="email" maxlength="254" value="' + e(draft.email) + '"' + (draft.isNew ? '' : ' disabled') + '></label>' +
    '<label class="pfield">Role<select id="f-role"' + (primary ? ' disabled' : '') + '>' + data.roles.map(r => '<option value="' + r + '"' + (draft.roles[0] === r ? ' selected' : '') + '>' + e(prettyRole(r)) + '</option>').join('') + '</select></label>' +
    '<fieldset class="pfield"><legend>Plants</legend><label class="tick"><input type="checkbox" id="f-all"' + (all ? ' checked' : '') + '> All plants</label>' +
    plants.map(p => '<label class="tick"><input type="checkbox" data-plant="' + p.id + '"' + (!all && draft.facilities.indexOf(p.id) >= 0 ? ' checked' : '') + (all ? ' disabled' : '') + '> ' + e(p.name) + (p.status === 'ACTIVE' ? '' : ' <small>(not open yet)</small>') + '</label>').join('') + '</fieldset>' +
    '<fieldset class="pfield"><legend>Account</legend><label class="tick"><input type="radio" name="f-status" value="ACTIVE"' + (draft.status === 'ACTIVE' ? ' checked' : '') + (primary ? ' disabled' : '') + '> Enabled</label>' +
    '<label class="tick"><input type="radio" name="f-status" value="INACTIVE"' + (draft.status !== 'ACTIVE' ? ' checked' : '') + (primary ? ' disabled' : '') + '> Disabled</label></fieldset>' +
    '<div class="pfield"><span>Apps they can open' + (draft.appsChanged ? ' <span class="pill warn">Not saved yet</span>' : '') + '</span><div id="f-apps" class="app-ticks">' +
      APPS.map(a => '<span class="app-pick">' + appTick(Object.assign({}, draft, { email: draft.isNew ? '' : draft.email }), a.key, draftApps().indexOf(a.key) >= 0, 'data-dapp') + '<span>' + e(a.name) + '</span></span>').join('') + '</div></div>' +
    (primary ? '<p class="note">The primary administrator always stays an Enabled Administrator.</p>' : '') +
    '<section class="pblock" aria-label="Plant and Distribution screens"><h3>What they see in Plant &amp; Distribution</h3>' + screensBlock(admin) + (draft.isNew ? '' : homeBlock()) + '</section>' +
    rightsBlock(admin) +
    '<div class="msg" id="f-msg" hidden></div>' +
    '<div class="actions"><button type="button" class="primary" id="f-save">' + (draft.isNew ? 'Add Person' : 'Save') + '</button><button type="button" id="f-cancel">Cancel</button></div>' +
    (draft.updatedAt ? '<p class="muted small">Last changed ' + e(shortDate(draft.updatedAt)) + (draft.updatedBy ? ' by ' + e(draft.updatedBy) : '') + '</p>' : '');
  box.querySelectorAll('input[data-part]').forEach(x => { x.indeterminate = true; });
  $('#f-save').onclick = save;
  $('#f-cancel').onclick = () => { picked = null; draft = null; drawList(); drawEdit(); };
}

// Every change is kept in the draft and the panel drawn again, so what it shows always matches what Save sends.
function changed(ev) {
  const t = ev.target;
  if (!draft || !t.closest('#edit')) return;
  if (t.id === 'f-name' || t.id === 'f-email') return;
  if (t.dataset.dapp) { draft.apps = [...$('#edit').querySelectorAll('input[data-dapp]:checked')].map(x => x.dataset.dapp); draft.appsChanged = true; }
  if (t.id === 'f-role') { draft.roles = [t.value]; if (isAdminRole(draft.roles)) { draft.grants = []; draft.denials = []; } }
  if (t.name === 'f-status') draft.status = t.value;
  if (t.id === 'f-all') draft.facilities = t.checked ? ['*'] : [];
  if (t.dataset.plant) draft.facilities = [...$('#edit').querySelectorAll('[data-plant]:checked')].map(c => c.dataset.plant);
  if (t.id === 'f-plant') draft.plantTab = t.value;
  if (t.dataset.keys) setTicks(draft.plantTab, t.dataset.keys.split(' '), t.checked);
  if (t.id === 'f-job' && t.value) {
    if (t.value === '__all__') { draft.screens = null; draft.screensChanged = true; } else {
      const job = data.screenJobs.find(j => j.key === t.value), next = {};
      draftPlants().forEach(id => { next[id] = screenKeys(areas()).filter(k => job.screens.indexOf(k) >= 0); });
      draft.screens = next; draft.screensChanged = true;
      draft.openAreas = areas().filter(a => a.screens.some(s => job.screens.indexOf(s[0]) >= 0)).map(a => a.key);
    }
  }
  if (t.id === 'f-home') draft.home = t.value;
  if (t.dataset.right) {
    const c = t.dataset.right;
    draft.grants = draft.grants.filter(x => x !== c); draft.denials = draft.denials.filter(x => x !== c);
    if (t.value === 'allow') draft.grants.push(c);
    if (t.value === 'deny') draft.denials.push(c);
  }
  redraw(t);
}
function redraw(focus) {
  draft.name = $('#f-name').value; draft.email = $('#f-email').value;
  draft.rightsOpen = !!$('#f-rights[open]');
  const key = focus && (focus.id ? '#' + focus.id : focus.dataset.keys ? '[data-keys="' + focus.dataset.keys + '"]' : focus.dataset.right ? '[data-right="' + focus.dataset.right + '"]' : focus.dataset.open ? '[data-open="' + focus.dataset.open + '"]' : focus.dataset.plant ? '[data-plant="' + focus.dataset.plant + '"]' : focus.dataset.dapp ? '[data-dapp="' + focus.dataset.dapp + '"]' : focus.name ? '[name="' + focus.name + '"][value="' + focus.value + '"]' : '');
  drawEdit();
  const again = key && $('#edit').querySelector(key);
  if (again) again.focus();
}

async function save() {
  const btn = $('#f-save'), msg = $('#f-msg');
  draft.name = $('#f-name').value.trim(); draft.email = $('#f-email').value.trim().toLowerCase();
  btn.disabled = true; msg.hidden = true;
  let saved = false;
  try {
    // The same save as Operations' People & Roles; the screens are sent only when they were changed here.
    const r = await callServer('admin', Object.assign({ op: 'savePerson', isNew: !!draft.isNew, revision: draft.revision, name: draft.name, email: draft.email, roles: draft.roles,
      facilities: draft.facilities, status: draft.status, grants: draft.grants, denials: draft.denials }, draft.screensChanged ? { screenAccess: draft.screens } : {}));
    saved = true;
    picked = r.email || draft.email;
    if (draft.appsChanged) await callServer('hub', { op: 'setApps', email: picked, apps: draft.apps });
    if (!draft.isNew && (draft.home || '') !== (draft.homeScreen || '')) await callServer('admin', { op: 'setHomeScreen', email: picked, page: draft.home || '' });
    await load();
    // The person is drawn again from the saved list; the message goes in the new box.
    const done = $('#f-msg');
    if (done) { done.hidden = false; done.className = 'msg good'; done.textContent = r.message || 'Saved.'; }
  } catch (err) {
    if (saved) {
      await load().catch(() => {});
      const box = $('#f-msg');
      if (box) { box.hidden = false; box.className = 'msg bad'; box.textContent = 'The person was saved, but not everything: ' + serverText(err, 'the Users list'); }
      return;
    }
    msg.hidden = false; msg.className = 'msg bad'; msg.textContent = serverText(err, 'the Users list');
    btn.disabled = false;
  }
}

function pick(email) {
  const p = data.people.find(x => x.email === email);
  picked = email;
  const screens = p.screenAccess ? JSON.parse(JSON.stringify(p.screenAccess)) : null;
  draft = { isNew: false, email: p.email, name: p.name, roles: (p.roles || []).slice(0, 1).map(r => String(r).toUpperCase()), facilities: (p.facilities || []).slice(), status: p.status,
    grants: (p.grants || []).slice(), denials: (p.denials || []).slice(), revision: p.revision, updatedAt: p.updatedAt, updatedBy: p.updatedBy,
    screens, screensChanged: false, apps: null, appsChanged: false, homeScreen: p.homeScreen || '', home: p.homeScreen || '', plantTab: '', rightsOpen: false,
    // Areas with only some screens ticked start open, so what is limited shows.
    openAreas: screens ? areas().filter(a => Object.keys(screens).some(pl => { const n = a.screens.filter(s => (screens[pl] || []).indexOf(s[0]) >= 0).length; return n && n < a.screens.length; })).map(a => a.key) : [] };
  drawList(); drawEdit();
}

export async function load() {
  const [people, access] = await Promise.all([callServer('admin', { op: 'people' }), callServer('hub', { op: 'appAccess' })]);
  data = Object.assign(people, { saved: access.saved || {} });
  setAdmin(true);
  $('#role-filter').innerHTML = '<option value="">Every role</option>' + data.roles.map(r => '<option value="' + r + '">' + e(prettyRole(r)) + '</option>').join('');
  drawList();
  if (picked && data.people.some(p => p.email === picked)) pick(picked); else drawEdit();
}

export function start() {
  ['#find', '#show', '#role-filter'].forEach(s => $(s).addEventListener('input', drawList));
  $('#rows').addEventListener('click', (ev) => { if (ev.target.closest('.app-tick')) return; const tr = ev.target.closest('tr[data-email]'); if (tr) pick(tr.dataset.email); });
  $('#rows').addEventListener('change', (ev) => { if (ev.target.dataset.app) tickApp(ev.target); });
  $('#edit').addEventListener('change', changed);
  $('#edit').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-open]');
    if (!b || !draft) return;
    const k = b.dataset.open, i = draft.openAreas.indexOf(k);
    if (i >= 0) draft.openAreas.splice(i, 1); else draft.openAreas.push(k);
    redraw(b);
  });
  $('#add').onclick = () => {
    picked = null;
    draft = { isNew: true, email: '', name: '', roles: ['EMPLOYEE'], facilities: ['fac_uniontown'], status: 'ACTIVE', grants: [], denials: [], revision: data.newRevision,
      screens: null, screensChanged: false, apps: null, appsChanged: false, homeScreen: '', home: '', plantTab: '', openAreas: [], rightsOpen: false };
    drawList(); drawEdit(); $('#f-name').focus();
  };
  return load().catch(err => showError(serverText(err, 'the Users list')));
}
