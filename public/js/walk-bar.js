// Joe 10/15 (Manager Walkthrough, option 2): Yard, Coolers and Quality opened from the walkthrough (?walk=1) show a bar at the
// top with the way back to the walkthrough, which stop this is, and the next stop (Yard, Coolers, Quality, then back).
const STEPS = { yard: ['1 · Yard', 'temps.html?walk=1', 'Next: Coolers ›'], coolers: ['2 · Coolers', 'quality.html?walk=1', 'Next: Quality ›'], quality: ['3 · Quality', 'walkthrough.html', 'Done ✓'] };
// Joe 10/15: the manager's phone screens are for managers only (an administrator counts as one).
export const WALK_ROLES = ['ADMINISTRATOR', 'ADMIN', 'MANAGER'];
export function walkBar(step) {
  if (new URLSearchParams(location.search).get('walk') !== '1' || !STEPS[step]) return;
  const [name, next, label] = STEPS[step], view = document.querySelector('#screen .view');
  if (!view || document.getElementById('walk-bar')) return;
  const bar = document.createElement('nav');
  bar.id = 'walk-bar';
  bar.className = 'wk-bar';
  bar.setAttribute('aria-label', 'Manager Walkthrough');
  bar.innerHTML = '<a href="walkthrough.html">‹ Walkthrough</a><b>' + name + '</b><a class="next" href="' + next + '">' + label + '</a>';
  view.before(bar);
}
