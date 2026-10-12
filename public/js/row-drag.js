// Drag a table row up or down to change the order (Joe 10/12: "grab the line with the hand and drag it", no dots, no arrows).
//
// mountRowDrag({ box, canDrag, onMove }) on a <tbody>: every row with data-drag="<id>" can be picked up anywhere except on a
// box, button or link. A mouse picks it up after it moves a few pixels; a finger on the Route or Run box at once (as on Weekly
// Dispatch), and anywhere else after holding it still for a moment (a quick swipe there still scrolls the page). While it moves, the row is lifted and a blue line shows where it will land. Letting go calls
// onMove(id, toIndex), toIndex being its new place among the data-drag rows. Keyboard: the row takes focus (Tab) and
// Alt+Up / Alt+Down move it one place. Rows without data-drag (loaded, skipped) stay where they are and take no drop.

const SKIP = 'input, button, select, textarea, a, label, [contenteditable]';
const HOLD_MS = 350, MOUSE_PX = 6;

export function mountRowDrag({ box, canDrag, onMove }) {
  let press = null, drag = null;
  const rows = () => [...box.querySelectorAll('tr[data-drag]')];

  const line = document.createElement('div');
  line.className = 'row-drop-line';
  line.hidden = true;
  document.body.appendChild(line);

  function slotAt(y, from) {
    // The place among the other movable rows the pointer is over: above a row's middle lands before it. Rows are matched by
    // id, not by element: the list can be drawn again mid-drag (another screen's save lands), and the dragged load's new
    // line must not count as one of the others.
    const list = rows().filter(r => r.dataset.drag !== from);
    let i = 0;
    for (; i < list.length; i++) { const b = list[i].getBoundingClientRect(); if (y < b.top + b.height / 2) break; }
    return { i, list };
  }
  function showLine(y) {
    const { i, list } = slotAt(y, drag.id);
    const ref = list[i] || list[list.length - 1];
    if (!ref) { line.hidden = true; return i; }
    const b = ref.getBoundingClientRect(), t = box.closest('table').getBoundingClientRect();
    line.style.left = (t.left + window.scrollX) + 'px';
    line.style.width = t.width + 'px';
    line.style.top = ((list[i] ? b.top : b.bottom) + window.scrollY - 2) + 'px';
    line.hidden = false;
    return i;
  }
  function begin() {
    drag = { row: press.row, id: press.row.dataset.drag, from: rows().indexOf(press.row), to: rows().indexOf(press.row) };
    drag.row.classList.add('row-dragging');
    document.body.classList.add('row-drag-on');
    try { box.setPointerCapture(press.pointerId); } catch (e) { /* the pointer is gone */ }
    if (navigator.vibrate && press.touch) { try { navigator.vibrate(15); } catch (e) { /* not allowed */ } }
  }
  function end(drop) {
    clearTimeout(press && press.timer);
    if (drag) {
      drag.row.classList.remove('row-dragging');
      document.body.classList.remove('row-drag-on');
      line.hidden = true;
      if (drop && drag.to !== drag.from) onMove(drag.id, drag.to);
    }
    press = null; drag = null;
  }

  box.addEventListener('pointerdown', e => {
    if (e.button > 0 || !canDrag()) return;
    const row = e.target.closest('tr[data-drag]');
    if (!row || !box.contains(row) || e.target.closest(SKIP)) return;
    const touch = e.pointerType !== 'mouse';
    // The Route and Run boxes (the first two) are the handle for a finger, as on Weekly Dispatch: it drags straight away.
    const handle = !!e.target.closest('td') && e.target.closest('td').cellIndex < 2;
    press = { row, x: e.clientX, y: e.clientY, pointerId: e.pointerId, touch: touch && !handle };
    // Elsewhere on the line a finger holds still to pick the row up; moving first is a scroll.
    if (press.touch) press.timer = setTimeout(() => { if (press && !drag) begin(); }, HOLD_MS);
  });
  box.addEventListener('pointermove', e => {
    if (!press) return;
    if (!drag) {
      const moved = Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y);
      if (press.touch) { if (moved > 10) end(false); return; }
      if (moved < MOUSE_PX) return;
      begin();
    }
    e.preventDefault();
    drag.to = showLine(e.clientY);
  });
  box.addEventListener('pointerup', () => end(true));
  box.addEventListener('pointercancel', () => end(false));
  // A finger holding a row: the page does not scroll under it.
  box.addEventListener('touchmove', e => { if (drag) e.preventDefault(); }, { passive: false });
  // The row's own text is not selected while it is dragged with the mouse.
  box.addEventListener('selectstart', e => { if (drag) e.preventDefault(); });
  box.addEventListener('contextmenu', e => { if (drag || (press && press.touch)) e.preventDefault(); });

  box.addEventListener('keydown', e => {
    const row = e.target.closest && e.target.closest('tr[data-drag]');
    if (!row || e.target !== row || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !canDrag()) return;
    e.preventDefault();
    const list = rows(), i = list.indexOf(row), to = i + (e.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= list.length) return;
    onMove(row.dataset.drag, to, true);
  });

  return { stop: () => { line.remove(); } };
}
