/**
 * Service worker ReasonUp.
 *
 * Задача: приложение должно открываться без интернета после ПЕРВОГО визита,
 * а не после второго. Поэтому при установке мы не просто кладём index.html,
 * а вытаскиваем из него список файлов сборки и кэшируем их явно.
 */

const CACHE_VERSION = 'reasonup-static-v6';
const SHELL = ['/', '/manifest.json', '/favicon.svg', '/icon-192x192.png', '/icon-512x512.png', '/privacy.html'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);

    const put = async (url) => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res && res.ok) await cache.put(url, res);
        return res;
      } catch {
        return null;
      }
    };

    // 1. Оболочка
    await Promise.allSettled(SHELL.map((u) => put(u)));

    // 2. Файлы сборки, на которые ссылается index.html
    try {
      const res = await fetch('/', { cache: 'reload' });
      if (res && res.ok) {
        const html = await res.clone().text();
        await cache.put('/', res);
        const urls = new Set();
        for (const m of html.matchAll(/(?:src|href)="(\/_next\/[^"#?]+)"/g)) urls.add(m[1]);
        await Promise.allSettled(Array.from(urls).map((u) => put(u)));
      }
    } catch {
      /* офлайн-установка невозможна — не страшно, попробуем при следующем визите */
    }
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('reasonup-') && n !== CACHE_VERSION).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Сам воркер не кэшируем, иначе он не обновится.
  if (req.url.includes('/sw.js')) {
    event.respondWith(fetch(req));
    return;
  }

  // Навигация: сначала сеть, при обрыве — оболочка из кэша.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch {
        const cache = await caches.open(CACHE_VERSION);
        return (await cache.match(req)) || (await cache.match('/')) || Response.error();
      }
    })());
    return;
  }

  // Остальное: кэш сразу, сеть — для обновления.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(req);
    if (cached) {
      fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()); }).catch(() => {});
      return cached;
    }
    try {
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return Response.error();
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
