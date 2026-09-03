/* Payment Plans — service worker
 *
 * Registered from plans.html with an explicit { scope: '/plans' }. This file
 * sits at the site root, so its default scope would be '/' — which would put
 * the Sainsbury's splitter under its control too. A narrower scope than the
 * script's own directory is always permitted, so the explicit scope is what
 * keeps the two apps isolated. Never widen it.
 *
 * Two jobs: keep the app shell openable from the Home Screen, and receive
 * push. On iOS, push only works at all once the app has been added to the
 * Home Screen — a Safari tab cannot subscribe.
 */

const VERSION = 'pp-v1';
const SHELL   = `${VERSION}-shell`;
const ASSETS  = `${VERSION}-assets`;

// Version-pinned, immutable third-party code. Safe to keep indefinitely;
// a version bump changes the URL, so staleness is not possible.
const CDN = /^https:\/\/(unpkg\.com|cdn\.jsdelivr\.net)\//;

// Anything that must always hit the network: live data and config.
const NEVER_CACHE = /\/(\.netlify\/functions|rest\/v1|auth\/v1)\//;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // Best-effort: a cold install offline shouldn't fail the whole worker.
    await cache.addAll([
      '/plans',
      '/plans.webmanifest',
      '/plans-icon-192.png',
      '/plans-icon-512.png',
    ]).catch(() => {});
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith('pp-') && !k.startsWith(VERSION))
          .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (NEVER_CACHE.test(url.pathname)) return;

  // Navigations: network first, so a deploy is picked up immediately and the
  // no-cache header policy on HTML still means what it says. Cache is only a
  // fallback for genuinely being offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(SHELL);
        cache.put('/plans', fresh.clone());
        return fresh;
      } catch (err) {
        return (await caches.match('/plans')) || Response.error();
      }
    })());
    return;
  }

  // Pinned CDN libraries and our own icons: cache first, they never change.
  if (CDN.test(req.url) || /\/plans-icon-|\/plans\.webmanifest$/.test(url.pathname)) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      // Opaque cross-origin responses are cached as-is; they still replay fine.
      if (res && (res.ok || res.type === 'opaque')) {
        const cache = await caches.open(ASSETS);
        cache.put(req, res.clone());
      }
      return res;
    })());
  }
});

/* ── Push ────────────────────────────────────────────────────
 * Payload is JSON from plans-push-send / plans-reminders. Anything
 * unparseable still shows something: on iOS a push that resolves without
 * calling showNotification can cost the site its push permission.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { body: event.data ? event.data.text() : '' }; }

  const title = data.title || 'Payment Plans';
  const options = {
    body:  data.body || '',
    tag:   data.tag  || 'pp-general',
    icon:  '/plans-icon-192.png',
    badge: '/plans-icon-192.png',
    data:  { url: data.url || '/plans' },
    renotify: !!data.tag,
    timestamp: Date.now(),
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/plans';

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Reuse an open window rather than stacking duplicates.
    for (const client of all) {
      if (client.url.includes('/plans') && 'focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(target).catch(() => {});
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});

// Lets the page force an update without a reload race.
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
