var CACHE='aidova-v4';

self.addEventListener('install',function(e){
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(c){
      return c.addAll([
        '/app',
        '/index.html',
        '/manifest.json',
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
  if(url.pathname.startsWith('/api/')||
     url.pathname.startsWith('/screenshots/')||
     url.pathname.startsWith('/.well-known/')){
    e.respondWith(fetch(e.request));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(function(cached){
      return cached||fetch(e.request).then(function(response){
        if(response&&response.status===200&&response.type==='basic'){
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
