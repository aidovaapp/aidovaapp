var CACHE='aidova-v3';

// Pages that should NEVER be served from cache — always fetch fresh from network
var BYPASS_URLS=['/home','/privacy','/landing.html','/privacy.html'];

self.addEventListener('install',function(e){
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(c){
      return c.addAll([
        '/',
        '/index.html',
        '/manifest.json',
        '/sw.js',
        '/icon-192.png',
        '/icon-512.png'
      ]).catch(function(){});
    })
  );
});

self.addEventListener('activate',function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(k){return k!==CACHE;})
            .map(function(k){return caches.delete(k);})
      );
    }).then(function(){
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch',function(e){
  var url=new URL(e.request.url);

  // Always bypass cache for landing page, privacy, and API calls
  if(BYPASS_URLS.indexOf(url.pathname)>-1 ||
     url.pathname.startsWith('/api/') ||
     url.pathname.startsWith('/screenshots/') ||
     url.pathname.startsWith('/.well-known/')){
    e.respondWith(fetch(e.request));
    return;
  }

  // For everything else: cache first, then network
  e.respondWith(
    caches.match(e.request).then(function(cached){
      return cached || fetch(e.request).then(function(response){
        if(response && response.status===200 && response.type==='basic'){
          var clone=response.clone();
          caches.open(CACHE).then(function(c){c.put(e.request,clone);});
        }
        return response;
      });
    }).catch(function(){
      return caches.match('/index.html');
    })
  );
});
