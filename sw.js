const CACHE = 'aidova-v3';
const CORE = ['./index.html', './'];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(CORE).catch(function(){});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k){ return k !== CACHE; })
            .map(function(k){ return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  // Only handle GET requests
  if(e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(function(res) {
        // Cache successful same-origin responses
        if(res && res.status === 200) {
          var clone = res.clone();
          caches.open(CACHE).then(function(cache){
            cache.put(e.request, clone);
          });
        }
        return res;
      })
      .catch(function() {
        // Offline fallback
        return caches.match(e.request)
          .then(function(cached){
            return cached || caches.match('./index.html');
          });
      })
  );
});
