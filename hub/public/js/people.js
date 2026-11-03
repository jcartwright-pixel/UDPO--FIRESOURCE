/*
 * People & Access in the hub (Joe 11-2-26: "all the managers access ... laid out a little bit better ... one change all").
 * The same Users list and the same save as Operations' Administration, People & Roles: the hub calls Operations' own server
 * call (admin: people, savePerson), so nothing about how people are kept is redone and a change here is a change everywhere.
 * Each person's line also says which apps they can open from the hub, by the same rules as the hub's tiles.
 * The finer rights (allow / deny one right, the screens ticked per plant) stay in Operations for now; a save here keeps them.
 */
import { callServer, escapeHtml as e, showError, serverText, shortDate, setAdmin } from './shell.js';
import { appsFor, isAdminRole, roleKey } from './apps.js';

const prettyRole = (r) => String(r).charAt(0) + String(r).slice(1).toLowerCase().replace(/_/g, ' ');
let data = null, picked = null, draft = null;
const $ = (s) => document.querySelector(s);
const plantName = (id) => id === '*' ? 'All plants' : ((data.plants || []).find(p => p.id === id) || {}).name || id;
const plantsText = (p) => (p.facilities || []).length ? p.facilities.map(plantName).join(', ') : (isAdminRole(p.roles) ? 'All plants' : 'Uniontown');

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

function drawEdit() {
  const box = $('#edit');
  if (!draft) { box.innerHTML = '<p class="muted">Pick a person on the list to change them, or press <b>+ Add Person</b>.</p>'; return; }
  const primary = !draft.isNew && (data.people.find(p => p.email === draft.email) || {}).primary;
  const plants = (data.plants || []).filter(p => p.status !== 'RETIRED');
  const all = draft.facilities.indexOf('*') >= 0;
  box.innerHTML = '<h2>' + (draft.isNew ? 'Add Person' : e(draft.name || draft.email)) + '</h2>' +
    '<label class="pfield">Name<input id="f-name" maxlength="120" value="' + e(draft.name) + '"></label>' +
    '<label class="pfield">United Dairy email<input id="f-email" type="email" maxlength="254" value="' + e(draft.email) + '"' + (draft.isNew ? '' : ' disabled') + '></label>' +
    '<label class="pfield">Role<select id="f-role"' + (primary ? ' disabled' : '') + '>' + data.roles.map(r => '<option value="' + r + '"' + (draft.roles[0] === r ? ' selected' : '') + '>' + e(prettyRole(r)) + '</option>').join('') + '</select></label>' +
    '<fieldset class="pfield"><legend>Plants</legend><label class="tick"><input type="checkbox" id="f-all"' + (all ? ' checked' : '') + '> All plants</label>' +
    plants.map(p => '<label class="tick"><input type="checkbox" data-plant="' + p.id + '"' + (!all && draft.facilities.indexOf(p.id) >= 0 ? ' checked' : '') + (all ? ' disabled' : '') + '> ' + e(p.name) + (p.status === 'ACTIVE' ? '' : ' <small>(not open yet)</small>') + '</label>').join('') + '</fieldset>' +
    '<fieldset class="pfield"><legend>Account</legend><label class="tick"><input type="radio" name="f-status" value="ACTIVE"' + (draft.status === 'ACTIVE' ? ' checked' : '') + (primary ? ' disabled' : '') + '> Enabled</label>' +
    '<label class="tick"><input type="radio" name="f-status" value="INACTIVE"' + (draft.status !== 'ACTIVE' ? ' checked' : '') + (primary ? ' disabled' : '') + '> Disabled</label></fieldset>' +
    '<div class="pfield"><span>Apps they can open</span><div id="f-apps"></div></div>' +
    (primary ? '<p class="note">The primary administrator always stays an Enabled Administrator.</p>' : '') +
    (draft.grants.length || draft.denials.length ? '<p class="note">This person also has ' + (draft.grants.length + draft.denials.length) + ' single-right change(s) set in Plant & Distribution. Saving here keeps them.</p>' : '') +
    '<div class="msg" id="f-msg" hidden></div>' +
    '<div class="actions"><button type="button" class="primary" id="f-save">' + (draft.isNew ? 'Add Person' : 'Save') + '</button><button type="button" id="f-cancel">Cancel</button></div>' +
    (draft.updatedAt ? '<p class="muted small">Last changed ' + e(shortDate(draft.updatedAt)) + (draft.updatedBy ? ' by ' + e(draft.updatedBy) : '') + '</p>' : '');
  const apps = () => { $('#f-apps').innerHTML = appsFor(read()).map(a => '<span class="app-chip">' + e(a) + '</span>').join(' ') || '<span class="muted">None (Disabled)</span>'; };
  box.querySelectorAll('input,select').forEach(i => i.addEventListener('change', () => {
    if (i.id === 'f-all') box.querySelectorAll('[data-plant]').forEach(c => { c.disabled = i.checked; if (i.checked) c.checked = false; });
    apps();
  }));
  apps();
  $('#f-save').onclick = save;
  $('#f-cancel').onclick = () => { picked = null; draft = null; drawList(); drawEdit(); };
}

function read() {
  const box = $('#edit');
  const status = (box.querySelector('input[name="f-status"]:checked') || {}).value || draft.status;
  const facilities = $('#f-all').checked ? ['*'] : [...box.querySelectorAll('[data-plant]:checked')].map(c => c.dataset.plant);
  return { name: $('#f-name').value.trim(), email: $('#f-email').value.trim().toLowerCase(), roles: [$('#f-role').value], facilities, status };
}

async function save() {
  const v = read(), btn = $('#f-save'), msg = $('#f-msg');
  btn.disabled = true; msg.hidden = true;
  try {
    // The same save as Operations' People & Roles; the single-right changes and screens are sent back as they were.
    const r = await callServer('admin', { op: 'savePerson', isNew: !!draft.isNew, revision: draft.revision, name: v.name, email: v.email, roles: v.roles,
      facilities: v.facilities, status: v.status, grants: draft.grants, denials: draft.denials });
    picked = r.email || v.email;
    await load();
    // The person is drawn again from the saved list; the message goes in the new box.
    const done = $('#f-msg');
    if (done) { done.hidden = false; done.className = 'msg good'; done.textContent = r.message || 'Saved.'; }
  } catch (err) {
    msg.hidden = false; msg.className = 'msg bad'; msg.textContent = serverText(err, 'the Users list');
    btn.disabled = false;
  }
}

function pick(email) {
  const p = data.people.find(x => x.email === email);
  picked = email;
  draft = { isNew: false, email: p.email, name: p.name, roles: (p.roles || []).slice(0, 1), facilities: (p.facilities || []).slice(), status: p.status,
    grants: p.grants || [], denials: p.denials || [], revision: p.revision, updatedAt: p.updatedAt, updatedBy: p.updatedBy };
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
  $('#add').onclick = () => {
    picked = null;
    draft = { isNew: true, email: '', name: '', roles: ['EMPLOYEE'], facilities: ['fac_uniontown'], status: 'ACTIVE', grants: [], denials: [], revision: data.newRevision };
    drawList(); drawEdit(); $('#f-name').focus();
  };
  return load().catch(err => showError(serverText(err, 'the Users list')));
}
