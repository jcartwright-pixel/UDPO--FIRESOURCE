/*
 * Daily Dispatch keys, like the current app's sheet (7.0.267-7.0.275, Joe 10/6 and 10/8: "like Excel whenever I hit return
 * it just goes down to the next cell it doesn't bring up the list until I double click; if I start to type it comes up with
 * the close matches and when I hit enter it enters that value and goes to the next cell").
 *
 * A Driver, Truck or Trailer cell is only selected by a click, Enter, Tab or the arrows. Enter / Down go down, Up goes up,
 * Tab / Right go across (Shift+Tab / Left back). Double-click, F2 or Alt+Down open the whole list; typing opens a box over
 * the cell listing the close matches with the best one highlighted (893 finds 223893). Enter takes it and moves down,
 * Tab takes it and moves across, Esc keeps the old value. Time, Jack and Notes open on a click as before; typing on a
 * selected one starts over with what is typed, and Enter / Tab / Up / Down save and move.
 */
const LISTS = { driver: true, truck: true, trailer: true };
let want = null; // the cell to select after the next render: {id, kind}

const rowSel = (id) => 'tr[data-id="' + String(id).replace(/["\\]/g, '\\$&') + '"]';
const cellAt = (tbody, at) => at && tbody.querySelector(rowSel(at.id) + ' td[data-edit="' + at.kind + '"]');
const where = (td) => ({ id: td.parentNode.dataset.id, kind: td.dataset.edit });

function select(td) {
  if (!td) return false;
  td.focus({ preventScroll: true });
  try { td.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (ignore) { /* old browsers */ }
  return true;
}

// The next cell down (step 1) or up (-1) in the same column, or across (Tab order: Driver, Truck, Trailer, Time, Jack, Notes, next row).
function next(tbody, td, step, across) {
  const list = Array.from(tbody.querySelectorAll(across ? 'td[data-edit]' : 'td[data-edit="' + td.dataset.edit + '"]'));
  return list[list.indexOf(td) + step] || null;
}

// Re-draws the table keeping the selected cell (the live update re-draws it whenever anyone saves).
export function keepCursor(tbody, rebuild) {
  const a = document.activeElement, had = a && tbody.contains(a) && a.matches('td[data-edit]') ? where(a) : null;
  rebuild();
  const go = want || had;
  want = null;
  if (go) select(cellAt(tbody, go) || (had && go !== had ? cellAt(tbody, had) : null));
}

// Best match first: the same text, then (units) a number ending in what is typed, then starting with it, then a word starting with it, then anywhere.
export function rankChoices(choices, typed, unit) {
  const q = String(typed || '').trim().toUpperCase();
  if (!q) return choices.slice();
  return choices.map((c, i) => {
    const k = String(c.key || c.label).toUpperCase(), l = String(c.label).toUpperCase();
    let rank = k === q ? 0 : unit && k.slice(-q.length) === q ? 1 : k.indexOf(q) === 0 ? 2 : (' ' + k.replace(/[,.\-]/g, ' ')).indexOf(' ' + q) >= 0 ? 3 : k.indexOf(q) >= 0 ? 4 : l.indexOf(q) >= 0 ? 5 : 9;
    if (!c.value) rank = 9; // "(none)" only by Delete / Backspace
    return { c, i, rank };
  }).filter(x => x.rank < 9).sort((a, b) => a.rank - b.rank || a.i - b.i).map(x => x.c);
}

/*
 * h = { rowOf(td), current(row, kind), text(row, kind), choices(kind, row) -> [{value, label, key, group, blocked, reason}],
 *       pick(row, kind, value or {unit}), editText(td, row, kind, typed), setEditing(on), render() }
 */
export function bindDailyKeys(tbody, h) {
  injectStyle();
  // A click selects a Driver / Truck / Trailer cell; a double-click opens its list.
  tbody.addEventListener('mousedown', e => {
    want = null;
    const td = e.target.closest('td[data-edit]');
    if (td && LISTS[td.dataset.edit] && e.button === 0 && !e.target.closest('input')) { e.preventDefault(); select(td); }
  });
  tbody.addEventListener('dblclick', e => {
    const td = e.target.closest('td[data-edit]');
    if (td && LISTS[td.dataset.edit]) { e.preventDefault(); openList(td, '', true); }
  });

  tbody.addEventListener('keydown', e => {
    const td = e.target;
    if (!td.matches || !td.matches('td[data-edit]')) return;
    const kind = td.dataset.edit, list = !!LISTS[kind];
    if (e.ctrlKey || e.metaKey) return;
    if (e.altKey) { if (e.key === 'ArrowDown') { e.preventDefault(); open(td, list, null, true); } return; }
    const go = (cell) => { e.preventDefault(); select(cell); };
    if (e.key === 'Enter') return go(next(tbody, td, e.shiftKey ? -1 : 1) || td);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') return go(next(tbody, td, e.key === 'ArrowDown' ? 1 : -1) || td);
    if (e.key === 'Tab') { const n = next(tbody, td, e.shiftKey ? -1 : 1, true); if (n) go(n); return; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') return go(next(tbody, td, e.key === 'ArrowRight' ? 1 : -1, true) || td);
    if (e.key === 'F2') { e.preventDefault(); return open(td, list, null, true); }
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); return open(td, list, '', false); }
    if (e.key === ' ' && list) { e.preventDefault(); return; }
    if (e.key.length === 1) { e.preventDefault(); open(td, list, e.key, false); }
  });

  // Inside the Time / Jack / Notes box: Enter saves and goes down, Tab across, Up / Down save and move, Esc keeps the old value.
  tbody.addEventListener('keydown', e => {
    const input = e.target, td = input.closest && input.closest('td[data-edit]');
    if (!td || LISTS[td.dataset.edit] || !input.matches('input.picker')) return;
    const stay = where(td);
    if (e.key === 'Escape') { want = stay; return; }
    if (e.key === 'Enter') { const n = next(tbody, td, e.shiftKey ? -1 : 1); want = n ? where(n) : stay; return; }
    let n = null;
    if (e.key === 'Tab') n = next(tbody, td, e.shiftKey ? -1 : 1, true);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') n = next(tbody, td, e.key === 'ArrowDown' ? 1 : -1);
    else return;
    e.preventDefault();
    want = n ? where(n) : stay;
    input.blur();
  }, true);

  function open(td, list, typed, all) {
    if (list) return openList(td, typed || '', all);
    want = null;
    h.editText(td, h.rowOf(td), td.dataset.edit, typed);
  }

  function openList(td, typed, all) {
    const row = h.rowOf(td), kind = td.dataset.edit, unit = kind !== 'driver';
    if (!row) return;
    const current = h.current(row, kind) || '', choices = h.choices(kind, row);
    const here = where(td);
    h.setEditing(true);
    const input = document.createElement('input');
    input.className = 'picker';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', (kind === 'driver' ? 'Driver' : kind === 'truck' ? 'Truck' : 'Trailer') + ': type to pick');
    td.textContent = '';
    td.appendChild(input);
    input.value = typed;
    const pop = document.createElement('div');
    pop.className = 'cell-pop';
    pop.setAttribute('role', 'listbox');
    document.body.appendChild(pop);
    let shown = [], active = -1, done = false;
    const pickable = (c) => c && !c.blocked;

    function paint() {
      const q = input.value.trim();
      shown = q ? rankChoices(choices, q, unit) : choices.slice();
      const best = q ? shown.find(pickable) : null;
      // The best match stays highlighted wherever it sits; the list keeps its groups (Relief, Regular, ... Unavailable last).
      if (q) shown = shown.map((c, i) => ({ c, i, g: choices.indexOf(choices.find(x => x.group === c.group)) })).sort((a, b) => a.g - b.g || a.i - b.i).map(x => x.c);
      active = q ? shown.indexOf(best) : shown.findIndex(c => c.value === current);
      let html = '', last = null;
      shown.forEach((c, i) => {
        if (c.head && c.head !== last) html += '<h6' + (c.blocked ? ' class="off"' : '') + '>' + esc(c.head) + '</h6>';
        last = c.head;
        html += '<div role="option" data-i="' + i + '" class="' + (i === active ? 'active ' : '') + (c.blocked ? 'off' : '') + '">' + esc(c.label) + (c.reason ? '<em>' + esc(c.reason) + '</em>' : c.note ? '<em class="note">' + esc(c.note) + '</em>' : '') + '</div>';
      });
      pop.innerHTML = html + (shown.length ? '' : unit ? '<p>Not on Equipment Master. Enter keeps it as typed.</p>' : '<p>No match. Esc keeps the old one.</p>') + '<small>Enter takes it and moves down · Tab next cell · Esc keeps the old one</small>';
      place();
      const a = pop.querySelector('.active');
      if (a) a.scrollIntoView({ block: 'nearest' });
    }
    function place() {
      const r = td.getBoundingClientRect(), room = window.innerHeight - r.bottom - 8;
      pop.style.minWidth = Math.max(unit ? 220 : 320, Math.round(r.width)) + 'px';
      pop.style.left = Math.max(4, Math.min(r.left, window.innerWidth - pop.offsetWidth - 6)) + 'px';
      const hgt = Math.min(pop.scrollHeight, 420);
      if (room < hgt && r.top > room) { pop.style.maxHeight = Math.min(420, r.top - 12) + 'px'; pop.style.top = Math.max(4, r.top - Math.min(hgt, r.top - 12) - 4) + 'px'; }
      else { pop.style.maxHeight = Math.min(420, Math.max(120, room)) + 'px'; pop.style.top = (r.bottom + 4) + 'px'; }
    }
    function step(d) {
      if (!shown.some(pickable)) return;
      let i = active;
      do { i = (i + d + shown.length) % shown.length; } while (!pickable(shown[i]));
      active = i;
      pop.querySelectorAll('[data-i]').forEach(n => n.classList.toggle('active', Number(n.dataset.i) === active));
      const a = pop.querySelector('.active');
      if (a) a.scrollIntoView({ block: 'nearest' });
    }
    function finish(take, to) {
      if (done) return;
      done = true;
      window.removeEventListener('scroll', place, true);
      pop.remove();
      let value = null;
      if (take) {
        if (pickable(shown[active]) && (input.value.trim() || all)) value = shown[active].value;
        else if (!input.value.trim() && !all) value = ''; // Delete / Backspace then Enter clears the cell
        // A truck or trailer number with no match is kept as typed, like the current app (trailers as T-###).
        else if (unit && input.value.trim()) { const t = input.value.trim().toUpperCase().replace(/\s+/g, ''); value = { unit: kind === 'trailer' ? 'T-' + t.replace(/^T-?/, '') : t }; }
      }
      want = to;
      h.setEditing(false);
      if (value !== null && value !== current && !(value.unit && value.unit === h.text(row, kind))) h.pick(row, kind, value);
      else h.render();
    }

    input.addEventListener('input', paint);
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); step(e.key === 'ArrowDown' ? 1 : -1); }
      else if (e.key === 'Enter') { e.preventDefault(); const n = next(tbody, td, e.shiftKey ? -1 : 1); finish(true, n ? where(n) : here); }
      else if (e.key === 'Tab') { e.preventDefault(); const n = next(tbody, td, e.shiftKey ? -1 : 1, true); finish(true, n ? where(n) : here); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false, here); }
    });
    input.addEventListener('blur', () => setTimeout(() => finish(false, null), 0));
    pop.addEventListener('mousedown', e => {
      e.preventDefault();
      const n = e.target.closest('[data-i]');
      if (!n || !pickable(shown[Number(n.dataset.i)])) return;
      active = Number(n.dataset.i);
      all = true;
      finish(true, here);
    });
    window.addEventListener('scroll', place, true);
    input.focus();
    paint();
  }
}

function esc(v) { return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

function injectStyle() {
  if (document.getElementById('daily-keys-style')) return;
  const s = document.createElement('style');
  s.id = 'daily-keys-style';
  s.textContent = [
    'body.daily-look table.daily tbody tr.group.loaded td{background:#e3eeff!important;color:#0b4fb3!important;letter-spacing:.06em}',
    'table.daily td[data-edit]:focus{outline:3px solid #1f6feb;outline-offset:-3px;background:#eaf3ff!important}',
    '.cell-pop{position:fixed;z-index:80;overflow:auto;background:#fff;border:1px solid #9fb9cf;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.28);font:700 16px Arial,sans-serif;color:#123f70}',
    '.cell-pop [data-i]{display:flex;align-items:baseline;gap:10px;padding:8px 12px;border-bottom:1px solid #edf2f6;cursor:pointer;white-space:nowrap}',
    '.cell-pop [data-i].active,.cell-pop [data-i]:hover{background:#dcecff}',
    '.cell-pop [data-i].off{color:#8a97a3;cursor:not-allowed;background:#f4f6f8}',
    '.cell-pop em{margin-left:auto;font-style:normal;font-size:14px;color:#b3261e}',
    '.cell-pop em.note{color:#60798f;font-weight:700}',
    '.cell-pop h6{margin:0;padding:6px 12px;background:#eef4fa;color:#0e3a62;font-size:13px;letter-spacing:.06em;position:sticky;top:0}',
    '.cell-pop h6.off{color:#8a5a00;background:#fff4e0}',
    '.cell-pop p{margin:0;padding:10px 12px;color:#60798f}',
    '.cell-pop small{display:block;padding:6px 12px;color:#60798f;font-size:13px;font-weight:700;border-top:1px solid #dfe6ee;white-space:nowrap}'
  ].join('');
  document.head.appendChild(s);
}
