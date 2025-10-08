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
