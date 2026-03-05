/**
 * Auto-update checker for production floor devices.
 * Periodically re-fetches the current page, compares script version tags,
 * and silently reloads if a newer version is deployed.
 *
 * Usage: <script src="../js/shared/auto-update.js"></script>
 * (Must be a regular script, not type="module", so it runs on all pages simply)
 */
(function () {
  const CHECK_INTERVAL = 2 * 60 * 1000; // Check every 2 minutes
  const VERSION_REGEX = /\.js\?v=(\d+)/g;

  // Collect current version fingerprint from all script tags on the page
  function getCurrentVersions() {
    const versions = {};
    document.querySelectorAll('script[src*="?v="]').forEach((script) => {
      const match = script.src.match(/([^/]+\.js)\?v=(\d+)/);
      if (match) {
        versions[match[1]] = match[2];
      }
    });
    return versions;
  }

  const initialVersions = getCurrentVersions();
  const initialKeys = Object.keys(initialVersions);

  // Nothing to track
  if (initialKeys.length === 0) return;

  async function checkForUpdate() {
    try {
      const resp = await fetch(location.href, { cache: 'no-store' });
      if (!resp.ok) return;

      const html = await resp.text();
      let match;
      VERSION_REGEX.lastIndex = 0;

      while ((match = VERSION_REGEX.exec(html)) !== null) {
        // Extract the filename from the surrounding context
        const before = html.substring(Math.max(0, match.index - 60), match.index);
        const fileMatch = before.match(/([^/"]+\.js)$/);
        if (fileMatch && initialVersions[fileMatch[1]]) {
          const file = fileMatch[1];
          const remoteVersion = match[1];
          if (remoteVersion !== initialVersions[file]) {
            console.log(`[auto-update] ${file} v${initialVersions[file]} -> v${remoteVersion}, reloading...`);
            location.reload();
            return;
          }
        }
      }
    } catch (e) {
      // Network error — skip this check
    }
  }

  // Start checking after a short delay (don't interfere with page load)
  setTimeout(() => {
    setInterval(checkForUpdate, CHECK_INTERVAL);
  }, 10000);
})();
