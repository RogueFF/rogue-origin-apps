/**
 * Service Worker Registration
 * Registers the service worker for offline PWA functionality
 */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/rogue-origin-apps/sw.js')
      .then(registration => {
        console.log('✅ Service Worker registered successfully:', registration.scope);

        // Check for updates on page load
        registration.update();

        // Listen for updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          console.log('🔄 Service Worker update found');

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('✨ New Service Worker available! Refresh to update.');

              // Optional: Show update notification to user
              if (confirm('A new version is available! Reload to update?')) {
                newWorker.postMessage({ type: 'SKIP_WAITING' });
                window.location.reload();
              }
            }
          });
        });
      })
      .catch(error => {
        console.error('❌ Service Worker registration failed:', error);
      });

    // Handle service worker controller change (when new SW activates)
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  });
} else {
  console.warn('⚠️ Service Workers are not supported in this browser');
}
