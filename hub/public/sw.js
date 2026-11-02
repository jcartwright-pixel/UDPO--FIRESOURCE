// Joe 11/1: "want to downloadable app": the hub installs as its own app (manifest.webmanifest). This worker only
// makes it installable; every screen still comes from the server as it is now (nothing is kept on the device).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
