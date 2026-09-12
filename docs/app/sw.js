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
const CACHE_VERSION = "bejirond-v2";
// Resolved relative to this file's own location so the same service worker
// works whether it's served from a domain root (native/Capacitor origin,
// or a custom domain) or a subpath (a GitHub Pages project URL, etc.).
const SHELL_URL = new URL("./", self.location).href;
const APP_SHELL = [
  SHELL_URL,
  new URL("./manifest.json", self.location).href,
  new URL("./icon-192.png", self.location).href,
  new URL("./icon-512.png", self.location).href,
];

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
          caches.open(CACHE_VERSION).then((cache) => cache.put(SHELL_URL, res.clone()));
          return res;
        })
        .catch(() => caches.match(SHELL_URL))
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
