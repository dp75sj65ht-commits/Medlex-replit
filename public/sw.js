// public/sw.js
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Network-first for HTML; cache-first for small assets if you want.
// Keep it minimal to avoid caching stale app.js during dev.
self.addEventListener('fetch', (event) => {
  // passthrough by default
});

self.addEventListener('install', e=>self.skipWaiting());
self.addEventListener('activate', e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e=>{}); // no caching in dev
