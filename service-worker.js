const CACHE = 'rabochee-vremya-v34-driver-20261030';
const PREFIX = 'rabochee-vremya-v';
const SHELL = ['./', './index.html', './manifest.json', './icon.svg'];
const RAIL = ['./track-profile.html', './rail/core.js', './rail/map.js', './rail/app.js', './rail/corridor.json', './rail/gps.js', './rail/regime-core.js', './rail/regime.js', './rail/regime-catalog.json', './rail/driver-profile.js', './rail/driver-profile.css'];
const INDEX = './index.html';

async function fetchFresh(input, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(new Request(input, {cache: 'no-store', signal: controller.signal})); }
  finally { clearTimeout(timer); }
}

async function cachedIndex() {
  const current = await caches.open(CACHE);
  const hit = await current.match(INDEX);
  if (hit) return hit;
  const keys = await caches.keys();
  for (const key of keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).reverse()) {
    const old = await caches.open(key);
    const fallback = await old.match(INDEX);
    if (fallback) return fallback;
  }
  return null;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    let page;
    try {
      const response = await fetchFresh(INDEX);
      if (response.ok && response.type === 'basic') page = response;
    } catch (_) {}
    if (!page) page = await cachedIndex();
    if (!page) throw new Error('No offline app shell; keep the previous worker');
    await cache.put(INDEX, page);
    await Promise.all(SHELL.filter(path => path !== INDEX).map(async path => {
      try {
        const response = await fetchFresh(path, 2500);
        if (response.ok && response.type === 'basic') await cache.put(path, response);
      } catch (_) {}
    }));
    // Require a complete module cache before activating; leave the old worker on failure.
    await Promise.all(RAIL.map(async path => {
      const response = await fetchFresh(path);
      if (!response.ok || response.type !== 'basic') throw new Error('Rail asset unavailable');
      await cache.put(path, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const page = await cachedIndex();
    if (!page) return;
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin && url.pathname.startsWith(new URL('./rail/regimes/', self.registration.scope).pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open('rabochee-regime-documents-v1');
      const hit = await cache.match(request);
      return hit || fetch(request);
    })());
    return;
  }
  if (url.origin === self.location.origin && RAIL.some(p => new URL(p, self.registration.scope).pathname === url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(url.pathname);
      if (hit) return hit;
      return fetch(request);
    })());
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await cachedIndex();
      if (cached) {
        event.waitUntil((async () => {
          try {
            const response = await fetchFresh(request);
            if (response.ok && response.type === 'basic') {
              const cache = await caches.open(CACHE);
              await cache.put(INDEX, response);
            }
          } catch (_) {}
        })());
        return cached;
      }
      try {
        const response = await fetchFresh(request);
        if (response.ok && response.type === 'basic') {
          const cache = await caches.open(CACHE);
          event.waitUntil(cache.put(INDEX, response.clone()));
        }
        return response;
      } catch (_) {
        return Response.error();
      }
    })());
    return;
  }
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic')
      event.waitUntil(cache.put(request, response.clone()));
    return response;
  })());
});
