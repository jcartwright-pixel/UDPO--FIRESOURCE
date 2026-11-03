/*
 * Roles & Rights in the hub (Joe 11-3-26, managers' access: "one change all"). What each role may do in Plant & Distribution,
 * laid out as one table: rights down the side, roles across. It reads and saves through Operations' own server call (admin:
 * roleTemplates, saveRoleTemplate, addRole), the same saves as Administration, Role Templates there, so nothing is redone and a
 * change here is a change everywhere. A tick saves at once. Administrator is locked: it always has everything.
 */
import { callServer, escapeHtml as e, showError, serverText, setAdmin } from './shell.js';
import { roleKey } from './apps.js';
import { adminOnly } from './access.js';

const prettyRole = (r) => String(r).charAt(0) + String(r).slice(1).toLowerCase().replace(/_/g, ' ');
const $ = (s) => document.querySelector(s);
let data = null, counts = {}, busy = Promise.resolve();

// The rights a role has now, as Operations works it out (rights.js templateFor): its saved list, or the standard one.
export const roleRights = (role, templates, defaults) => ((templates || {})[role] || (defaults || {})[role] || []).filter(c => !adminOnly(c));
const rightsOf = (role) => roleRights(role, data.templates, data.defaults);
const isChanged = (role) => !!(data.templates || {})[role] && (data.defaults || {})[role] !== undefined;
const label = (code) => (data.catalog.find(c => c.code === code) || { label: code }).label;

function say(text, kind) {
  const m = $('#msg');
  m.hidden = !text; m.textContent = text || ''; m.className = 'list-msg ' + (kind || '');
}

function draw() {
  const find = $('#find').value.trim().toLowerCase();
  const roles = data.roles;
  $('#head').innerHTML = '<tr><th class="l right-col">What they may do</th>' + roles.map(r => {
    const n = counts[r] || 0, admin = r === 'ADMINISTRATOR';
    return '<th class="role-col' + (admin ? ' admin' : '') + '" data-role="' + e(r) + '"><b>' + e(prettyRole(r)) + '</b><small>' + n + (n === 1 ? ' person' : ' people') + '</small>' +
      (admin ? '<small class="lock">Everything</small>' : isChanged(r) ? '<button type="button" class="link" data-standard="' + e(r) + '">Use standard</button>' : '') + '</th>';
  }).join('') + '</tr>';
  const rows = [];
  let group = '';
  data.catalog.filter(c => !adminOnly(c.code) && (!find || (c.label + ' ' + c.group).toLowerCase().indexOf(find) >= 0)).forEach(c => {
    if (c.group !== group) { group = c.group; rows.push('<tr class="group"><th class="l" colspan="' + (roles.length + 1) + '">' + e(group) + '</th></tr>'); }
    rows.push('<tr><th class="l right-col" scope="row">' + e(c.label) + '</th>' + roles.map(r => {
      const admin = r === 'ADMINISTRATOR', on = admin || rightsOf(r).indexOf(c.code) >= 0;
      return '<td><label class="app-tick" style="--app:var(--ud-blue)" title="' + e(admin ? 'Administrators can do everything' : prettyRole(r) + ': ' + c.label) + '"><input type="checkbox" data-role="' + e(r) + '" data-right="' + e(c.code) + '"' +
        (on ? ' checked' : '') + (admin ? ' disabled' : '') + ' aria-label="' + e(prettyRole(r) + ': ' + c.label) + '"><span class="box" aria-hidden="true"></span></label></td>';
    }).join('') + '</tr>');
  });
  $('#rows').innerHTML = rows.join('') || '<tr><td class="l muted" colspan="' + (roles.length + 1) + '">No right matches that.</td></tr>';
  $('#new-from').innerHTML = '<option value="">Nothing ticked</option>' + roles.filter(r => r !== 'ADMINISTRATOR').map(r => '<option value="' + e(r) + '">' + e(prettyRole(r)) + '</option>').join('');
}

// One save at a time, each from what the server last said, so quick ticks never undo each other.
function queue(job) { busy = busy.then(job, job); return busy; }

// rights() is worked out when the save runs, from the role as the last save left it, not from the boxes as they were drawn.
function saveRole(role, rights, done) {
  return queue(async () => {
    document.querySelectorAll('input[data-role="' + CSS.escape(role) + '"]').forEach(x => { x.disabled = true; });
    try {
      await callServer('admin', { op: 'saveRoleTemplate', role, rights: rights(), expected: rightsOf(role).slice() });
      say(done, 'good');
    } catch (err) {
      say(prettyRole(role) + ' was not saved: ' + serverText(err, 'Plant & Distribution'), 'bad');
    }
    try { Object.assign(data, await callServer('admin', { op: 'roleTemplates' })); } catch (err) { /* keep what is shown */ }
    draw();
  });
}

function tick(box) {
  const role = box.dataset.role, code = box.dataset.right, on = box.checked;
  const done = prettyRole(role) + (on ? ' can now: ' : ' can no longer: ') + label(code) + '. Everyone with that role gets the change.';
  return saveRole(role, () => { const now = rightsOf(role).filter(c => c !== code); return on ? now.concat([code]) : now; }, done);
}

async function addRole(ev) {
  ev.preventDefault();
  const name = $('#new-name').value.trim(), from = $('#new-from').value;
  if (name.length < 3) { say('Type the new role\'s name (at least 3 letters).', 'bad'); $('#new-name').focus(); return; }
  $('#new-save').disabled = true;
  try {
    const out = await callServer('admin', { op: 'addRole', name, rights: from ? rightsOf(from) : [] });
    Object.assign(data, await callServer('admin', { op: 'roleTemplates' }));
    $('#add-form').hidden = true; $('#new-name').value = '';
    draw();
    say(out.message || (name + ' added.'), 'good');
  } catch (err) {
    say('The role was not added: ' + serverText(err, 'Plant & Distribution'), 'bad');
  }
  $('#new-save').disabled = false;
}

export async function load() {
  const [tpl, people] = await Promise.all([callServer('admin', { op: 'roleTemplates' }), callServer('admin', { op: 'people' })]);
  data = tpl;
  counts = {};
  (people.people || []).filter(p => p.status === 'ACTIVE').forEach(p => (p.roles || []).forEach(r => {
    const k = roleKey(r) === 'ADMIN' ? 'ADMINISTRATOR' : roleKey(r);
    counts[k] = (counts[k] || 0) + 1;
  }));
  setAdmin(true);
  draw();
}

export function start() {
  $('#find').addEventListener('input', draw);
  $('#rows').addEventListener('change', (ev) => { if (ev.target.dataset.right) tick(ev.target); });
  $('#head').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-standard]');
    if (!b) return;
    const role = b.dataset.standard;
    saveRole(role, () => roleRights(role, {}, data.defaults), prettyRole(role) + ' is back to its standard rights.');
  });
  $('#add').onclick = () => { $('#add-form').hidden = false; $('#new-name').focus(); };
  $('#new-cancel').onclick = () => { $('#add-form').hidden = true; $('#new-name').value = ''; };
  $('#add-form').addEventListener('submit', addRole);
  return load().catch(err => showError(serverText(err, 'the roles')));
}
