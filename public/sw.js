// Minimal service worker for the PWA build of በጅሮንድ.
//
// Strategy:
// - App shell (/, manifest, icons) is precached on install so the app can
//   open offline even on a cold start.
// - Navigation requests (loading the page itself) go network-first, falling
//   back to the cached shell when offline — this way a returning-online user
//   always gets the latest build instead of being stuck on a stale shell.
// - Everything else (the hashed JS/CSS bundles Vite produces, fonts, etc.)
//   uses stale-while-revalidate: serve from cache instantly if we have it,
//   and refresh the cache in the background for next time.
//
// Bump CACHE_VERSION whenever this file or the precache list changes, so
// old caches get cleaned up on the next activate.
const CACHE_VERSION = "bejirond-v1";
const APP_SHELL = ["/", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never intercept POST/etc.

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // only handle same-origin requests

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(CACHE_VERSION).then((cache) => cache.put("/", res.clone()));
          return res;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => { if (res && res.status === 200) cache.put(req, res.clone()); return res; })
          .catch(() => cached);
        return cached || network;
      })
    )
  );
});
