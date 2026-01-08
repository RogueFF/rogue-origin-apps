// Service Worker for Rogue Origin Operations Hub
// Version 3.0 - Comprehensive offline-first caching with multiple strategies

const CACHE_VERSION = 'ro-ops-v3.5';
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
  '/rogue-origin-apps/src/pages/scoreboard.html',
  '/rogue-origin-apps/src/pages/sop-manager.html',
  '/rogue-origin-apps/src/pages/kanban.html',
  '/rogue-origin-apps/src/pages/barcode.html',
  '/rogue-origin-apps/src/pages/orders.html',
  '/rogue-origin-apps/src/pages/order.html',
  '/rogue-origin-apps/src/pages/ops-hub.html',

  // CSS files
  '/rogue-origin-apps/src/css/dashboard.css',
  '/rogue-origin-apps/src/css/ai-chat.css',
  '/rogue-origin-apps/src/css/barcode.css',
  '/rogue-origin-apps/src/css/kanban.css',
  '/rogue-origin-apps/src/css/ops-hub.css',
  '/rogue-origin-apps/src/css/order.css',
  '/rogue-origin-apps/src/css/orders.css',
  '/rogue-origin-apps/src/css/scoreboard.css',
  '/rogue-origin-apps/src/css/sop-manager.css',

  // JavaScript files
  '/rogue-origin-apps/src/js/modules/index.js',
  '/rogue-origin-apps/src/js/shared/api-cache.js',
  '/rogue-origin-apps/src/js/legacy/dashboard.js',

  // SVG assets
  '/rogue-origin-apps/src/assets/icons/hemp-fiber-texture-preview.svg',
  '/rogue-origin-apps/src/assets/icons/hemp-leaf-pattern.svg',
  '/rogue-origin-apps/src/assets/icons/ro-pattern-preview.svg'
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

// Images from external sources
const EXTERNAL_IMAGES = [
  'https://i.imgur.com/UYEbNiI.png',
  'https://i.imgur.com/PvrTPb2.png'
];

// Install event - cache static assets with resilient error handling
self.addEventListener('install', (event) => {
  console.log('[SW v3.0] Installing service worker...');

  event.waitUntil(
    Promise.allSettled([
      // Cache static assets
      caches.open(STATIC_CACHE).then((cache) => {
        console.log('[SW] Caching static assets');
        return Promise.allSettled(
          STATIC_ASSETS.map(url =>
            cache.add(url).catch(err => console.warn('[SW] Failed to cache:', url, err))
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
      }),

      // Cache external images
      caches.open(IMAGE_CACHE).then((cache) => {
        console.log('[SW] Caching external images');
        return Promise.allSettled(
          EXTERNAL_IMAGES.map(url =>
            cache.add(url).catch(err => console.warn('[SW] Failed to cache image:', url, err))
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
  console.log('[SW v3.0] Activating service worker...');

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
    event.respondWith(networkFirstWithTimeout(request, API_CACHE, 5000));
    return;
  }

  // Strategy 2: Cache-First for fonts
  if (url.hostname === 'fonts.gstatic.com' || request.destination === 'font') {
    event.respondWith(cacheFirst(request, FONT_CACHE));
    return;
  }

  // Strategy 3: Cache-First for images
  if (request.destination === 'image' || url.pathname.match(/\.(png|jpg|jpeg|svg|gif|webp)$/)) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE));
    return;
  }

  // Strategy 4: Cache-First for static assets
  if (request.destination === 'style' || request.destination === 'script' ||
      url.pathname.match(/\.(css|js)$/) || STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Strategy 5: Stale-While-Revalidate for CDN resources
  if (url.hostname.includes('cdn.jsdelivr.net') ||
      url.hostname.includes('unpkg.com') ||
      url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('js.puter.com')) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }

  // Strategy 6: Network-First with cache fallback (default)
  event.respondWith(networkFirstWithTimeout(request, DYNAMIC_CACHE, 3000));
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
    throw error;
  }
}

// Cache Strategy: Cache-First
async function cacheFirst(request, cacheName) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const response = await fetch(request);
    // Only cache GET requests - POST requests cannot be cached
    if (response.ok && request.method === 'GET') {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.error('[SW] Fetch failed for:', request.url, error);
    throw error;
  }
}

// Cache Strategy: Stale-While-Revalidate
async function staleWhileRevalidate(request, cacheName) {
  const cachedResponse = await caches.match(request);

  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      const cache = caches.open(cacheName);
      cache.then(c => c.put(request, response.clone()));
    }
    return response;
  }).catch(() => null);

  return cachedResponse || fetchPromise;
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
    icon: 'https://i.imgur.com/UYEbNiI.png',
    badge: 'https://i.imgur.com/UYEbNiI.png',
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

console.log('[SW v3.0] Service Worker loaded');
