// Timeless Strips - service worker (offline mode)
// * App files + built-in templates are precached so the booth opens with no internet.
// * Same-origin files: network first (always fresh when online), cache as fallback.
// * Face-AI library/model from CDNs: cached the first time they are used, then cache first.
// * Cloud sync (Supabase) requests are never cached - the app queues changes while offline.
const VERSION = 'v19';
const CACHE = 'timeless-strips-' + VERSION;
const CDN_HOSTS = ['cdn.jsdelivr.net', 'storage.googleapis.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];   // fonts are cached too, so the title font also works offline

const PRECACHE = [
  './', 'index.html', 'admin.html',
  'style.css', 'admin.css',
  'script.js', 'admin.js', 'admin-auth.js', 'cloud-config.js', 'i18n.js', 'fx.js', 'share-ui.js', 'ui.css', 'get.html', 'templates-store.js', 'icons.js', 'face-engine.js',
  'gif-encoder.js', 'qr.js',
  'templates/template1.png', 'templates/template2.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      // add one by one so a missing file doesn't break the whole install
      Promise.all(PRECACHE.map((u) => c.add(u).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('timeless-strips-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // CDN assets (MediaPipe code, wasm, model): cache first
  if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

  if (url.origin !== location.origin) return;          // Supabase etc: straight to network

  // Same origin: network first, fall back to cache (offline)
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() =>
      caches.match(req, { ignoreSearch: true }).then((hit) =>
        hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))
    )
  );
});