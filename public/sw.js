// Joe 10/12: keeps the Safety Walkthrough screens on the iPad so they open with no signal (js/offline-saves.js fills the
// cache and keeps the saves). Online, every screen comes from the server as before; the copy is used only when there is no
// connection. Screens not in the cache are not touched.
const CACHE = 'ud-offline-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const kept = await c.match(req, { ignoreSearch: true });
      if (!kept) return fetch(req);
      try {
        const res = await fetch(req);
        if (res.ok) c.put(req.url.split('?')[0], res.clone());
        return res;
      } catch (err) { return kept; }
    }));
  } else if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    // The Firebase code never changes for a version, so the kept copy is used first.
    e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(req)) || fetch(req)));
  }
});
