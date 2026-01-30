/**
 * Service Worker Registration
 * Auto-updates without user interaction — checks every 5 minutes
 */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/rogue-origin-apps/sw.js')
      .then(registration => {
        console.log('[SW] Registered:', registration.scope);

        // Check for updates on page load
        registration.update();

        // Check for updates every 5 minutes so open tabs stay current
        setInterval(() => {
          registration.update();
          console.log('[SW] Checking for updates...');
        }, 5 * 60 * 1000);

        // When a new SW is found, it auto-activates (skipWaiting in sw.js)
        registration.addEventListener('updatefound', () => {
          console.log('[SW] Update found, installing...');
        });
      })
      .catch(error => {
        console.error('[SW] Registration failed:', error);
      });

    // Auto-reload when new SW takes control — no user action needed
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        console.log('[SW] New version active, reloading...');
        window.location.reload();
      }
    });
  });
} else {
  console.warn('[SW] Service Workers not supported');
}
