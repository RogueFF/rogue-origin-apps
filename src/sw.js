/**
 * The service worker, as a source file.
 *
 * What it replaces: a 400-line hand-written worker with a CACHE_VERSION string
 * that someone had to remember to bump, and a STATIC_ASSETS list that could
 * only name unhashed URLs — so the CSS and JavaScript every page actually
 * loads were never precached at all. Here the precache list is the build
 * manifest, written by the build from what it just emitted, so it cannot drift
 * from what is published.
 *
 * The hand-over matters more than the caching. Barn screens and the crew's
 * phones are running the old worker right now, and it claims clients and
 * serves HTML from its own caches. When this worker installs at the same URL
 * it takes over, deletes every cache the old one made, and the page reloads
 * itself (src/js/sw-register.js listens for controllerchange). Without that
 * sweep a device would keep serving an old page shell that names hashed assets
 * this build no longer contains.
 *
 * Two deliberate choices carried over from the old worker:
 *   · API responses are network-first with a short timeout, not network-only.
 *     The barn keeps showing the last numbers when the line's wifi drops.
 *   · Pages are precached, so they open instantly and update on the next
 *     worker, which the registration checks for every five minutes.
 */
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { clientsClaim } from 'workbox-core';

const OFFLINE_URL = '/rogue-origin-apps/offline.html';

/** Cache names this worker owns, so the sweep below can tell them apart. */
const API_CACHE = 'ro-api';
const IMAGE_CACHE = 'ro-images';
const PAGE_CACHE = 'ro-pages';

/**
 * `?h=` is a cache key the build writes onto the classic scripts the TV boards
 * load; the file behind it is precached under its bare path. Ignoring the
 * parameter when matching is what lets those requests hit the precache instead
 * of falling through to the network on every load.
 */
precacheAndRoute(self.__WB_MANIFEST, {
  ignoreURLParametersMatching: [/^h$/, /^utm_/, /^fbclid$/],
});
cleanupOutdatedCaches();

self.addEventListener('install', () => self.skipWaiting());
clientsClaim();

// The hand-over: every cache the hand-written worker made is named ro-ops-*.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith('ro-ops-'))
      .map((name) => caches.delete(name)));
  })());
});

// The API. A page that is already open keeps working on the last response when
// the network is slow or gone; nothing here is ever served as if it were live,
// because every screen shows its own connection status.
registerRoute(
  ({ url }) => url.hostname.endsWith('workers.dev') || url.hostname === 'script.google.com',
  new NetworkFirst({ cacheName: API_CACHE, networkTimeoutSeconds: 10 }),
);

registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({ cacheName: IMAGE_CACHE }),
);

/**
 * Navigations the precache cannot answer — a page opened with a query string,
 * such as the Kanban page's ?flag= links from the Worker's texts. Try the
 * network, fall back to the precached page without its query, then to the
 * offline page.
 */
const pages = new NetworkFirst({ cacheName: PAGE_CACHE, networkTimeoutSeconds: 6 });
registerRoute(new NavigationRoute(async (options) => {
  try {
    const response = await pages.handle(options);
    if (response) return response;
  } catch {
    // Offline, or the page 404s: fall through to what is already stored.
  }
  const bare = new URL(options.request.url);
  bare.search = '';
  return (await matchPrecache(bare.href))
    || (await matchPrecache(OFFLINE_URL))
    || Response.error();
}));
