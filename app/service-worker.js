// Tayla Workforce Service Worker
const CACHE_NAME = 'tayla-workforce-v4';

// Core assets to cache on install
const PRECACHE_ASSETS = [
  '/app/',
  '/app/index.html',
  '/app/style.css',
  '/app/app.js',
  '/app/awards.js',
  '/app/custom-awards.js',
  '/app/employees.js',
  '/app/roster.js',
  '/app/timesheets.js',
  '/app/sales.js',
  '/app/payg.js',
  '/app/payslip.js',
  '/app/icon-192.png',
  '/app/icon-512.png',
  '/app/manifest.json',
];

// Install — cache core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate — clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch — network first, fall back to cache
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip Supabase API calls — always need fresh data
  if (url.hostname.includes('supabase.co') || url.hostname.includes('stripe.com')) return;

  // Skip chrome-extension requests
  if (url.protocol === 'chrome-extension:') return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful responses for app assets
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Network failed — try cache
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // For navigation requests, return the app shell
          if (event.request.mode === 'navigate') {
            return caches.match('/app/index.html');
          }
        });
      })
  );
});
