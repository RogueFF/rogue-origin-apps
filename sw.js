// Service Worker for Rogue Origin Operations Hub
// Version 2.0 - Offline-first caching strategy

const CACHE_VERSION = 'ro-ops-v2.0';
const STATIC_CACHE = CACHE_VERSION + '-static';
const DYNAMIC_CACHE = CACHE_VERSION + '-dynamic';
const API_CACHE = CACHE_VERSION + '-api';

// Static assets to cache on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/dashboard.css',
  '/js/dashboard.js',
  // External dependencies (CDN)
  'https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=JetBrains+Mono:wght@400;500;600;700&family=Outfit:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0',
  'https://cdn.jsdelivr.net/npm/muuri@0.9.5/dist/muuri.min.js',
  'https://cdn.jsdelivr.net/npm/web-animations-js@2.3.2/web-animations.min.js',
  'https://unpkg.com/@phosphor-icons/web',
  'https://js.puter.com/v2/'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .catch((err) => {
        console.error('[SW] Failed to cache static assets:', err);
      })
  );
  // Activate immediately
  self.skipWaiting();
});

// Activate event - cleanup old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName.startsWith('ro-ops-') && cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE && cacheName !== API_CACHE) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // Take control immediately
  return self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API requests (Google Apps Script)
  if (url.hostname === 'script.google.com') {
    event.respondWith(
      caches.open(API_CACHE).then((cache) => {
        return fetch(request)
          .then((response) => {
            // Cache successful API responses for 2 minutes
            if (response.ok) {
              const clonedResponse = response.clone();
              cache.put(request, clonedResponse);
              // Expire cache after 2 minutes
              setTimeout(() => {
                cache.delete(request);
              }, 120000);
            }
            return response;
          })
          .catch(() => {
            // Fallback to cache if offline
            return cache.match(request);
          });
      })
    );
    return;
  }

  // Static assets - cache first, then network
  if (STATIC_ASSETS.includes(request.url) || request.destination === 'style' || request.destination === 'script' || request.destination === 'font') {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((response) => {
          if (response.ok) {
            return caches.open(STATIC_CACHE).then((cache) => {
              cache.put(request, response.clone());
              return response;
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // Dynamic content - network first, fallback to cache
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          return caches.open(DYNAMIC_CACHE).then((cache) => {
            cache.put(request, response.clone());
            return response;
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(request);
      })
  );
});

// Background sync for offline actions (future enhancement)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-data') {
    event.waitUntil(
      // Sync any queued data when back online
      console.log('[SW] Background sync triggered')
    );
  }
});

// Push notifications (future enhancement)
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const options = {
    body: data.body || 'New update available',
    icon: 'https://i.imgur.com/UYEbNiI.png',
    badge: 'https://i.imgur.com/UYEbNiI.png'
  };
  event.waitUntil(
    self.registration.showNotification(data.title || 'Rogue Origin', options)
  );
});
