/* REPS service worker — cache-first app shell. */
const CACHE = "reps-v1";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./styles/tokens.css",
  "./styles/base.css",
  "./styles/components.css",
  "./src/app.js",
  "./src/router.js",
  "./src/db/schema.js",
  "./src/db/repo.js",
  "./src/data/starter-exercises.js",
  "./src/data/strength-standards.js",
  "./src/domain/scoring.js",
  "./src/domain/volume.js",
  "./src/domain/rest-rule.js",
  "./src/domain/week.js",
  "./src/ui/timer.js",
  "./src/ui/tap-counter.js",
  "./src/ui/components.js",
  "./src/views/home.js",
  "./src/views/exercises.js",
  "./src/views/session.js",
  "./src/views/exercise-detail.js",
  "./src/views/history.js",
  "./src/views/profile.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Cache-first for same-origin and Google Fonts.
  if (url.origin === self.location.origin || url.host.includes("fonts.g")) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok && (res.type === "basic" || res.type === "cors")) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => cached);
      })
    );
  }
});
