const CACHE_NAME = "schoolforest-v18-shell-20260715";
const APP_SHELL = "/";

self.addEventListener("install", event=>{
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache=>cache.add(APP_SHELL))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener("activate", event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(
        keys.filter(key=>key !== CACHE_NAME).map(key=>caches.delete(key))
      ))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch", event=>{
  if(event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin) return;

  if(event.request.mode === "navigate"){
    event.respondWith(
      fetch(event.request)
        .then(response=>{
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache=>cache.put(APP_SHELL,copy));
          return response;
        })
        .catch(()=>caches.match(APP_SHELL))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached=>cached || fetch(event.request))
  );
});
