const VERSION = '1.0.0';
const CACHE_NAME = `kennokatachi-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg',
  './data/japan.topojson',
  'https://cdn.jsdelivr.net/npm/d3@7',
  'https://cdn.jsdelivr.net/npm/topojson-client@3'
];

self.addEventListener('install', evt => {
  evt.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(ASSETS.map(async url => {
      try {
        const resp = await fetch(url, { cache: 'reload' });
        if (resp.ok || resp.type === 'opaque') {
          await cache.put(url, resp);
        }
      } catch (_) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', evt => {
  evt.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', evt => {
  const req = evt.request;
  if (req.method !== 'GET') return;

  evt.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) {
      fetchAndUpdate(req).catch(() => {});
      return cached;
    }
    try {
      const resp = await fetch(req);
      if (resp.ok && req.url.startsWith('http')) {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, clone)).catch(() => {});
      }
      return resp;
    } catch (err) {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
      throw err;
    }
  })());
});

async function fetchAndUpdate(req) {
  try {
    const resp = await fetch(req);
    if (resp.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(req, resp);
    }
  } catch (_) {}
}
