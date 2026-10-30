// Joe 10/29 (Galaxy tablet): "even though I have the screensaver to never shut off, it shuts off." A station tablet's screen
// stays on while its screen is open: the browser's own keep-the-screen-on (Screen Wake Lock), asked for again every time the
// screen comes back (the browser lets it go whenever the tab is hidden or the screen was off), and checked every minute.
// A browser that has none, or says no (battery saver), plays a tiny silent video over and over instead, the way the Driver
// Room TV does. What is in use shows on <html data-awake="lock|video"> for the checks.
export function keepScreenAwake() {
  if (window.udKeepAwake) return;
  window.udKeepAwake = true;
  const root = document.documentElement;
  let lock = null, video = null, asking = false;
  const mark = (how) => { root.dataset.awake = how; };
  function playVideo() {
    // The Driver Room TV already plays its own full-screen video.
    video = video || document.getElementById('ds-awake');
    if (!video) {
      video = document.createElement('video');
      video.id = 'keep-awake';
      Object.assign(video, { muted: true, loop: true, autoplay: true, playsInline: true });
      video.setAttribute('muted', ''); video.setAttribute('playsinline', ''); video.setAttribute('aria-hidden', 'true');
      // Joe 10/30 (the Garage tablet still went dark): Android keeps the screen on for a playing video only when it is big enough
      // to watch, so a tiny one did nothing. It fills the screen behind everything, almost see-through, and never takes a tap
      // (the Driver Room TV's video works the same way).
      Object.assign(video.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', objectFit: 'cover', opacity: '0.01', pointerEvents: 'none', zIndex: '-1' });
      video.innerHTML = '<source src="img/keep-awake.mp4" type="video/mp4"><source src="img/keep-awake.webm" type="video/webm">';
      document.body.appendChild(video);
      video.addEventListener('pause', () => setTimeout(() => { if (root.dataset.awake === 'video') video.play().catch(() => {}); }, 1000));
    }
    if (video.paused) video.play().catch(() => {});
    mark('video');
  }
  async function ask() {
    if (document.visibilityState !== 'visible' || asking) return;
    if (lock && !lock.released) return;
    if (navigator.wakeLock && navigator.wakeLock.request) {
      asking = true;
      try {
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => { if (document.visibilityState === 'visible') setTimeout(ask, 1000); });
        if (video && video.id === 'keep-awake') video.pause();
        mark('lock');
        return;
      } catch (e) { lock = null; /* not allowed here: the video below */ } finally { asking = false; }
    }
    playVideo();
  }
  ask();
  document.addEventListener('visibilitychange', ask);
  // A tap counts as the person using the tablet, which some browsers need before they keep the screen on or play a video.
  document.addEventListener('click', ask, true);
  window.addEventListener('focus', ask);
  setInterval(ask, 60000);
}
