// Service worker: keeps the whole app available offline.
//
// On install it caches the app shell and the encrypted data bundle (form
// templates, site list, fines list and block maps; see tools/lock_assets.py). Requests
// are then served from the cache first and refreshed from the network in the
// background, so a device picks up new versions the next time it opens the
// app with a connection.
// Bump VERSION to force every device to re-download everything.
const VERSION = "v3";
const CACHE = `security-tool-${VERSION}`;

const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "src/app.js",
  "src/common.js",
  "src/packet.js",
  "src/citation.js",
  "src/shift-report.js",
  "src/incident.js",
  "src/vault.js",
  "src/fill-citation.js",
  "src/fill-shift-report.js",
  "src/fill-incident.js",
  "src/style.css",
  "vendor/pdf-lib.min.js",
  "assets/locked/bundle.bin",
  "assets/images/logo-circle.png",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: "reload" bypasses the HTTP cache so a new version is really new
    await cache.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("security-tool-") && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    const refresh = fetch(req)
      .then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
      .catch(() => null);
    if (cached) {
      event.waitUntil(refresh);
      return cached;
    }
    const res = await refresh;
    if (res) return res;
    // Offline and not cached: fall back to the app for page navigations.
    if (req.mode === "navigate") return (await cache.match("index.html")) || Response.error();
    return Response.error();
  })());
});
