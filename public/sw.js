// public/sw.js
const CACHE = 'medlex-cache-v2';   // <- bump v1 -> v2
const ASSETS = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.json'];


self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
