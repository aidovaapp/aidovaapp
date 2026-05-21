// Aidova Service Worker v2 — CHEWAID®
const CACHE = 'aidova-v2';
const CORE = [
  '/aidovaapp/',
  '/aidovaapp/index.html',
  '/aidovaapp/manifest.json',
  '/aidovaapp/icons/icon-192.png',
  '/aidovaapp/icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request)
        .then(res => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match('/aidovaapp/index.html'));
    })
  );
});
