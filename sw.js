// Service Worker for Rogue Origin Operations Hub
// Version 3.38 - Drop the dead .css/.js precache entries
//
// Asset URLs in the HTML are content-hashed (see tools/stamp-modules.mjs), so
// .css and .js are NOT precached — a request for dashboard.css?h=2dde7146 can
// never match an entry stored under the bare path. STATIC_ASSETS holds only
// what is still requested bare: HTML pages, the manifest, the offline
// fallback, and images.
//
// Offline for scripts and styles therefore rests entirely on the runtime
// handlers, which is why their cache writes are awaited inside respondWith
// rather than fired and forgotten. As fire-and-forget promises they were being
// dropped, and that went unnoticed only because the bare URLs happened to be
// precached. Measured live before the fix: 15 bare entries cached, 0 hashed.
//
// Note this means a brand-new visitor who goes offline before their second
// page load has no cached CSS/JS. That was already true — on a first visit the
// worker is not yet in control when the page's own assets are requested — and
// precaching bare paths never fixed it, it only looked like it did.

const CACHE_VERSION = 'ro-ops-v3.41';
const STATIC_CACHE = CACHE_VERSION + '-static';
const DYNAMIC_CACHE = CACHE_VERSION + '-dynamic';
const API_CACHE = CACHE_VERSION + '-api';
const IMAGE_CACHE = CACHE_VERSION + '-images';
const FONT_CACHE = CACHE_VERSION + '-fonts';

// Comprehensive list of static assets to cache on install
const STATIC_ASSETS = [
  // HTML pages
  '/rogue-origin-apps/',
  '/rogue-origin-apps/src/pages/index.html',
  '/rogue-origin-apps/src/pages/scoreboard-v2.html',
  '/rogue-origin-apps/src/pages/sop-manager.html',
  '/rogue-origin-apps/src/pages/kanban.html',
  '/rogue-origin-apps/src/pages/wholesale.html',
  '/rogue-origin-apps/src/pages/scale-display.html',

  // NO .css / .js HERE — those are content-hashed in the HTML now, so a
  // request for dashboard.css?h=2dde7146 can never match an entry precached
  // under the bare path. Listing them only cost fetches on install. They are
  // cached at runtime instead, by Strategy 4 below, keyed on the hashed URL.
  // Everything still listed here IS requested bare and so still benefits.

  // PWA manifest
  '/rogue-origin-apps/manifest.json',

  // Offline fallback
  '/rogue-origin-apps/offline.html',

  // SVG assets
  '/rogue-origin-apps/src/assets/icons/hemp-fiber-texture-preview.svg',
  '/rogue-origin-apps/src/assets/icons/hemp-leaf-pattern.svg',
  '/rogue-origin-apps/src/assets/icons/ro-pattern-preview.svg',

  // Logo images (now local)
  '/rogue-origin-apps/src/assets/ro-logo-square.png',
  '/rogue-origin-apps/src/assets/ro-logo-horizontal.png',

  // PWA Icons
  '/rogue-origin-apps/assets/icon-192.png',
  '/rogue-origin-apps/assets/icon-512.png',
  '/rogue-origin-apps/assets/icon-apple-touch.png',

  // Favicon
  '/rogue-origin-apps/favicon.png'
];

// External CDN assets to cache
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1',
  'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0',
  'https://cdn.jsdelivr.net/npm/muuri@0.9.5/dist/muuri.min.js',
  'https://cdn.jsdelivr.net/npm/web-animations-js@2.3.2/web-animations.min.js',
  'https://unpkg.com/@phosphor-icons/web',
  'https://js.puter.com/v2/'
];

// Install event - cache static assets with resilient error handling
self.addEventListener('install', (event) => {
  console.log('[SW v3.15] Installing service worker...');

  event.waitUntil(
    Promise.allSettled([
      // Cache static assets
      caches.open(STATIC_CACHE).then((cache) => {
        console.log('[SW] Caching static assets');
        return Promise.allSettled(
          STATIC_ASSETS.map(url =>
            // Bypass the HTTP cache when seeding a NEW cache version, or the
            // fresh cache gets populated with the previous deploy's files.
            cache.add(new Request(url, { cache: 'reload' }))
              .catch(err => console.warn('[SW] Failed to cache:', url, err))
          )
        );
      }),

      // Cache CDN assets
      caches.open(STATIC_CACHE).then((cache) => {
        console.log('[SW] Caching CDN assets');
        return Promise.allSettled(
          CDN_ASSETS.map(url =>
            cache.add(url).catch(err => console.warn('[SW] Failed to cache CDN:', url, err))
          )
        );
      })
    ]).then(() => {
      console.log('[SW] Installation complete');
    })
  );

  // Activate immediately
  self.skipWaiting();
});

// Activate event - cleanup old caches
self.addEventListener('activate', (event) => {
  console.log('[SW v3.15] Activating service worker...');

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Delete all old cache versions
          if (cacheName.startsWith('ro-ops-') &&
              cacheName !== STATIC_CACHE &&
              cacheName !== DYNAMIC_CACHE &&
              cacheName !== API_CACHE &&
              cacheName !== IMAGE_CACHE &&
              cacheName !== FONT_CACHE) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[SW] Old caches cleaned up');
    })
  );

  // Take control of all pages immediately
  return self.clients.claim();
});

// Fetch event - intelligent routing based on resource type
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Strategy 1: Network-First for Google Apps Script API
  if (url.hostname === 'script.google.com') {
    // Use longer timeouts for operations that need processing time
    const action = url.searchParams.get('action');
    let timeout = 5000; // Default 5 seconds

    if (action === 'chat') {
      timeout = 30000; // 30 seconds for AI chat (Anthropic API call)
    } else if (action === 'saveShipment' || action === 'savePayment' || action === 'saveMasterOrder') {
      timeout = 15000; // 15 seconds for save operations (database writes)
    } else if (action === 'getShipments' || action === 'getPayments' || action === 'getOrderFinancials') {
      timeout = 10000; // 10 seconds for complex data fetching
    }

    event.respondWith(networkFirstWithTimeout(request, API_CACHE, timeout));
    return;
  }

  // Strategy 2: Cache-First for fonts
  if (url.hostname === 'fonts.gstatic.com' || request.destination === 'font') {
    event.respondWith(cacheFirst(request, FONT_CACHE, event));
    return;
  }

  // Strategy 3: Cache-First for images
  if (request.destination === 'image' || url.pathname.match(/\.(png|jpg|jpeg|svg|gif|webp)$/)) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE, event));
    return;
  }

  // Strategy 4: Stale-While-Revalidate for app assets (CSS/JS/HTML)
  // Serves cached version instantly, fetches fresh copy in background
  if (request.destination === 'style' || request.destination === 'script' ||
      url.pathname.match(/\.(css|js)$/) || STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE, event));
    return;
  }

  // Strategy 5: Stale-While-Revalidate for CDN resources
  if (url.hostname.includes('cdn.jsdelivr.net') ||
      url.hostname.includes('unpkg.com') ||
      url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('js.puter.com')) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE, event));
    return;
  }

  // Strategy 6: Network-First with cache fallback (default)
  // Increased timeout to 20000ms (20s) for slow API calls (Apps Script cold starts + order queue calculation)
  event.respondWith(networkFirstWithTimeout(request, DYNAMIC_CACHE, 20000));
});

// Cache Strategy: Network-First with Timeout
async function networkFirstWithTimeout(request, cacheName, timeout) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Network timeout')), timeout)
  );

  try {
    const response = await Promise.race([
      fetch(request),
      timeoutPromise
    ]);

    // Handle rate limiting (429) - serve cached data instead
    if (response.status === 429) {
      console.warn('[SW] Rate limited (429), checking cache:', request.url);
      const cachedResponse = await caches.match(request);
      if (cachedResponse) {
        console.log('[SW] Serving cached data due to rate limit:', request.url);
        return cachedResponse;
      }
      // No cached data available - return the 429 response
      console.warn('[SW] No cached data available, returning 429:', request.url);
      return response;
    }

    // Only cache GET requests - POST requests cannot be cached
    if (response.ok && request.method === 'GET') {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('[SW] Serving from cache (network failed):', request.url);
      return cachedResponse;
    }

    // For POST requests that fail, return a helpful error response
    if (request.method === 'POST') {
      console.error('[SW] POST request failed (no cache available):', request.url, error.message);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Network timeout or connection failed. Please check your internet connection and try again.'
        }),
        {
          status: 408, // Request Timeout
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // If this is a navigation request and no cache, show offline page
    if (request.mode === 'navigate') {
      const offlinePage = await caches.match('/rogue-origin-apps/offline.html');
      if (offlinePage) {
        console.log('[SW] Serving offline fallback page');
        return offlinePage;
      }
    }

    throw error;
  }
}

// Cache Strategy: Cache-First
async function cacheFirst(request, cacheName, event) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const response = await fetch(request);
    // Only cache GET requests - POST requests cannot be cached
    if (response.ok && request.method === 'GET') {
      const cache = await caches.open(cacheName);
      // Same reason as staleWhileRevalidate: keep the write alive past the
      // handler, or the worker can be terminated before it lands.
      const write = cache.put(request, response.clone());
      if (event && typeof event.waitUntil === 'function') event.waitUntil(write);
    }
    return response;
  } catch (error) {
    console.error('[SW] Fetch failed for:', request.url, error);
    throw error;
  }
}

// Cache Strategy: Stale-While-Revalidate
async function staleWhileRevalidate(request, cacheName, event) {
  const cachedResponse = await caches.match(request);

  // Revalidate against the origin, not the browser's HTTP cache. Asset URLs
  // are content-hashed, so a hit here is already the right bytes; `no-cache`
  // still sends the ETag and takes a 304, costing a conditional request rather
  // than a download.
  const network = fetch(revalidatingRequest(request)).then(async (response) => {
    if (response.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  // On a MISS the write is awaited before responding. respondWith is still
  // pending at that point, so the worker is guaranteed to stay alive for it —
  // whereas a fire-and-forget write (or a waitUntil registered from inside a
  // late .then) can be dropped when the worker is terminated. That never
  // showed while bare URLs were precached; with content-hashed URLs, which are
  // never precached, a dropped write leaves nothing cached and no offline mode.
  if (!cachedResponse) {
    // Fall back to a plain fetch rather than resolving respondWith with null,
    // which would surface as a network error on the page.
    return (await network) || fetch(request);
  }

  // On a HIT, serve instantly and let the refresh finish in the background.
  if (event && typeof event.waitUntil === 'function') event.waitUntil(network);
  return cachedResponse;
}

/**
 * Same request, forced to revalidate with the origin. Falls back to the
 * original request if the Request cannot be reconstructed (opaque/no-cors).
 */
function revalidatingRequest(request) {
  try {
    return new Request(request, { cache: 'no-cache' });
  } catch (err) {
    return request;
  }
}

// Cache management - trim caches periodically
setInterval(() => {
  trimCache(DYNAMIC_CACHE, 50);
  trimCache(IMAGE_CACHE, 100);
  trimCache(API_CACHE, 30);
}, 5 * 60 * 1000); // Every 5 minutes

async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    const itemsToDelete = keys.slice(0, keys.length - maxItems);
    await Promise.all(itemsToDelete.map(key => cache.delete(key)));
    console.log('[SW] Trimmed', itemsToDelete.length, 'items from', cacheName);
  }
}

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-data') {
    event.waitUntil(
      console.log('[SW] Background sync triggered - sync queued data when online')
    );
  }
});

// Enhanced push notifications
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const options = {
    body: data.body || 'New update available',
    icon: '/rogue-origin-apps/src/assets/ro-logo-square.png',
    badge: '/rogue-origin-apps/src/assets/ro-logo-square.png',
    vibrate: [200, 100, 200],
    actions: [
      { action: 'view', title: 'View' },
      { action: 'close', title: 'Close' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Rogue Origin', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'view') {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

// Message handling for dynamic cache control
self.addEventListener('message', (event) => {
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(names => Promise.all(names.map(name => caches.delete(name))))
    );
  }

  if (event.data.type === 'CACHE_URLS') {
    event.waitUntil(
      caches.open(STATIC_CACHE).then(cache => cache.addAll(event.data.urls))
    );
  }
});

// Global error handling
self.addEventListener('error', (event) => {
  console.error('[SW] Error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('[SW] Unhandled rejection:', event.reason);
});

console.log('[SW v3.15] Service Worker loaded - auto-update enabled');

