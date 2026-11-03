/*
 * People & Access in the hub (Joe 11-2-26: "all the managers access ... laid out a little bit better ... one change all").
 * The same Users list and the same saves as Operations' Administration, People & Roles: the hub calls Operations' own server
 * call (admin: people, savePerson, setHomeScreen), so nothing about how people are kept is redone and a change here is a
 * change everywhere. Each person's line also says which apps they can open from the hub, by the same rules as the hub's tiles.
 * Everything People & Roles has is here too (11-3-26): which Plant & Distribution screens they see at each plant, their
 * Home screen there, and single rights (use the role's, allow, deny), so People & Roles can become a link to this page.
 */
import { callServer, escapeHtml as e, showError, serverText, shortDate, setAdmin } from './shell.js';
import { appsFor, isAdminRole, roleKey } from './apps.js';
import { plantsFor, screenKeys, homeChoices, rightAllowed, adminOnly } from './access.js';

const prettyRole = (r) => String(r).charAt(0) + String(r).slice(1).toLowerCase().replace(/_/g, ' ');
let data = null, picked = null, draft = null;
const $ = (s) => document.querySelector(s);
const plantName = (id) => id === '*' ? 'All plants' : ((data.plants || []).find(p => p.id === id) || {}).name || id;
const plantsText = (p) => (p.facilities || []).length ? p.facilities.map(plantName).join(', ') : (isAdminRole(p.roles) ? 'All plants' : 'Uniontown');
const areas = () => data.screenAreas || [];
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

function drawList() {
  const find = $('#find').value.trim().toLowerCase(), show = $('#show').value, role = $('#role-filter').value;
  const rows = data.people.filter(p => (show === 'all' || p.status === show) && (!role || (p.roles || []).map(roleKey).indexOf(role) >= 0) &&
    (!find || (p.name + ' ' + p.email).toLowerCase().indexOf(find) >= 0))
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  $('#count').textContent = rows.length + ' of ' + data.people.length + ' people';
  $('#rows').innerHTML = rows.map(p => '<tr class="pick' + (picked === p.email ? ' on' : '') + (p.status === 'ACTIVE' ? '' : ' inactive') + '" data-email="' + e(p.email) + '">' +
    '<td class="l"><b>' + e(p.name || '(no name)') + '</b><small>' + e(p.email) + '</small></td>' +
    '<td class="l">' + e((p.roles || []).map(prettyRole).join(' + ') || 'None') + '</td>' +
    '<td class="l">' + e(plantsText(p)) + '</td>' +
    '<td class="l">' + (appsFor(p).map(a => '<span class="app-chip">' + e(a) + '</span>').join(' ') || '<span class="muted">None</span>') + '</td>' +
    '<td><span class="pill ' + (p.status === 'ACTIVE' ? 'good' : 'muted') + '">' + (p.status === 'ACTIVE' ? 'Enabled' : 'Disabled') + '</span></td></tr>').join('') ||
    '<tr><td colspan="5" class="muted">Nobody matches.</td></tr>';
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
    '<div class="pfield"><span>Apps they can open</span><div id="f-apps">' + (appsFor(draft).map(a => '<span class="app-chip">' + e(a) + '</span>').join(' ') || '<span class="muted">None (Disabled)</span>') + '</div></div>' +
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
  const key = focus && (focus.id ? '#' + focus.id : focus.dataset.keys ? '[data-keys="' + focus.dataset.keys + '"]' : focus.dataset.right ? '[data-right="' + focus.dataset.right + '"]' : focus.dataset.open ? '[data-open="' + focus.dataset.open + '"]' : focus.dataset.plant ? '[data-plant="' + focus.dataset.plant + '"]' : focus.name ? '[name="' + focus.name + '"][value="' + focus.value + '"]' : '');
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
    if (!draft.isNew && (draft.home || '') !== (draft.homeScreen || '')) await callServer('admin', { op: 'setHomeScreen', email: picked, page: draft.home || '' });
    await load();
    // The person is drawn again from the saved list; the message goes in the new box.
    const done = $('#f-msg');
    if (done) { done.hidden = false; done.className = 'msg good'; done.textContent = r.message || 'Saved.'; }
  } catch (err) {
    if (saved) {
      await load().catch(() => {});
      const box = $('#f-msg');
      if (box) { box.hidden = false; box.className = 'msg bad'; box.textContent = 'Saved, but the Home screen was not: ' + serverText(err, 'the Users list'); }
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
    screens, screensChanged: false, homeScreen: p.homeScreen || '', home: p.homeScreen || '', plantTab: '', rightsOpen: false,
    // Areas with only some screens ticked start open, so what is limited shows.
    openAreas: screens ? areas().filter(a => Object.keys(screens).some(pl => { const n = a.screens.filter(s => (screens[pl] || []).indexOf(s[0]) >= 0).length; return n && n < a.screens.length; })).map(a => a.key) : [] };
  drawList(); drawEdit();
}

export async function load() {
  data = await callServer('admin', { op: 'people' });
  setAdmin(true);
  $('#role-filter').innerHTML = '<option value="">Every role</option>' + data.roles.map(r => '<option value="' + r + '">' + e(prettyRole(r)) + '</option>').join('');
  drawList();
  if (picked && data.people.some(p => p.email === picked)) pick(picked); else drawEdit();
}

export function start() {
  ['#find', '#show', '#role-filter'].forEach(s => $(s).addEventListener('input', drawList));
  $('#rows').addEventListener('click', (ev) => { const tr = ev.target.closest('tr[data-email]'); if (tr) pick(tr.dataset.email); });
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
      screens: null, screensChanged: false, homeScreen: '', home: '', plantTab: '', openAreas: [], rightsOpen: false };
    drawList(); drawEdit(); $('#f-name').focus();
  };
  return load().catch(err => showError(serverText(err, 'the Users list')));
}
