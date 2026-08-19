var CACHE='aidova-v41';
self.addEventListener('install',function(e){
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(c){
      // Cache each file independently — with addAll, ONE failed/slow file
      // (e.g. a larger sound file) silently blocks every other file from
      // being precached at all, since addAll is all-or-nothing.
      var files=[
        '/app','/app.html',
        '/sounds/rain.mp3','/sounds/ocean.mp3','/sounds/forest.mp3',
        '/sounds/fire.mp3','/sounds/piano.mp3','/sounds/guitar.mp3',
        '/sounds/forestmelody.mp3'
      ];
      return Promise.all(files.map(function(f){
        return c.add(f).catch(function(err){console.log('Precache failed for',f,err);});
      }));
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
    }).then(function(){return self.clients.claim();})
  );
});
self.addEventListener('fetch',function(e){
  var url=new URL(e.request.url);
  // Never cache landing page, privacy, terms, accessibility, schools, api, screenshots
  if(url.pathname==='/'||
     url.pathname==='/index.html'||
     url.pathname==='/privacy'||
     url.pathname==='/privacy.html'||
     url.pathname==='/terms'||
     url.pathname==='/terms.html'||
     url.pathname==='/accessibility'||
     url.pathname==='/accessibility.html'||
     url.pathname==='/schools'||
     url.pathname==='/schools.html'||
     url.pathname.startsWith('/api/')||
     url.pathname.startsWith('/screenshots/')||
     url.pathname.startsWith('/.well-known/')){
    e.respondWith(fetch(e.request));
    return;
  }
  // Cache first for app routes
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
      return caches.match('/app.html');
    })
  );
});
