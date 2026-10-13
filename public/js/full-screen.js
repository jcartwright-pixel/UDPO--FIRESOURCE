// Joe 10/13 "filling the whole screen, that's the whole point": IT does not let the tablets install apps, so every
// tablet and phone screen (stations, TV, drivers' phones) goes full screen, with no tabs or address bar, on the first
// tap in a plain Chrome tab. Any later tap does it again if it was left (after a reload, the idle board or Done).
// A computer with a mouse is left alone; an installed copy already opens full screen by itself.
export function fullScreenOnTap() {
  const touch = () => navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
  const installed = () => matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
  document.addEventListener('click', () => {
    const el = document.documentElement;
    if (!touch() || installed() || document.fullscreenElement || !el.requestFullscreen) return;
    el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  }, true);
}
