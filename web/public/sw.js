/**
 * Service worker — makes the web app installable and start instantly, like a
 * native app. Registered in production builds only (src/main.tsx).
 *
 * What it caches:
 *   - the app shell (index.html), network-first, so updates arrive on the next load
 *     and the app still opens when offline;
 *   - same-origin static files (/assets/* are content-hashed, so cache-first is safe).
 *
 * What it NEVER touches: anything on another origin — the Apps Script API,
 * Firebase / Google sign-in — and any non-GET request. Gym data is therefore
 * never stored by the service worker.
 */
const VERSION = 'v1'
const SHELL_CACHE = `shell-${VERSION}`
const ASSET_CACHE = `assets-${VERSION}`
const SHELL_URL = '/index.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll([SHELL_URL, '/manifest.webmanifest', '/favicon.svg']))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return // API, Firebase, fonts: straight to network

  // App navigation: network first, fall back to the cached shell (offline / flaky network).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(SHELL_CACHE).then((c) => c.put(SHELL_URL, copy))
          }
          return response
        })
        .catch(() => caches.match(SHELL_URL)),
    )
    return
  }

  // Hashed build assets and icons: cache first, then network (and remember it).
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone()
              caches.open(ASSET_CACHE).then((c) => c.put(request, copy))
            }
            return response
          }),
      ),
    )
  }
})
