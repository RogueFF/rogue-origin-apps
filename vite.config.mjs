/**
 * The build.
 *
 * GitHub Pages publishes this repository's root as-is today, so the site's
 * URLs are the repo's own paths: /rogue-origin-apps/src/pages/<app>.html. The
 * barn TV, the crew's phone bookmarks, the Worker's SMS links and a
 * self-updating userscript all name those paths, so the build's first duty is
 * to emit the same URLs rather than a tidier set. Every page is an entry at
 * the path it already has; nothing moves.
 *
 * What the build adds is what the pre-commit stamp hook used to do by hand:
 * content hashes on assets, computed from what is actually being published.
 * tools/vite-legacy-scripts.mjs does the same for the pages that still load
 * classic scripts, which a bundler will not touch.
 *
 * Deploying the output needs one change nobody should make quietly: the Pages
 * source has to move from the master branch to an Actions workflow. That is
 * Koa's to do, at the same moment as the first push.
 */
import { readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import { copyStatic } from './tools/vite-copy-static.mjs';
import { legacyScripts } from './tools/vite-legacy-scripts.mjs';

const root = resolve(import.meta.dirname);
const outDir = resolve(root, 'dist');

/** Every page, keyed by the path it is published at. */
function pages() {
  const entries = {
    // The root redirect, the offline fallback, and the messaging policy page
    // Twilio requires for the Capataz SMS bot.
    index: resolve(root, 'index.html'),
    offline: resolve(root, 'offline.html'),
    'sms-policy': resolve(root, 'sms-policy.html'),
  };
  for (const file of readdirSync(resolve(root, 'src/pages'))) {
    if (!file.endsWith('.html')) continue;
    entries[`pages/${file.replace(/\.html$/, '')}`] = resolve(root, 'src/pages', file);
  }
  return entries;
}

export default defineConfig({
  root,
  base: '/rogue-origin-apps/',
  appType: 'mpa',
  publicDir: false,
  build: {
    outDir,
    emptyOutDir: true,
    // The pages are hand-written and read in the browser's dev tools by the
    // people who maintain them; only the bundled JavaScript is minified.
    minify: 'esbuild',
    rollupOptions: { input: pages() },
  },
  plugins: [
    copyStatic({ root, outDir }),
    legacyScripts({ root, outDir }),
    // The worker is written from src/sw.js with the build's own file list
    // injected, replacing the hand-maintained sw.js and its CACHE_VERSION.
    // The pages already register /rogue-origin-apps/sw.js through
    // src/js/sw-register.js, which also reloads the page when a new worker
    // takes control, so nothing is injected into the HTML here.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectRegister: false,
      registerType: 'autoUpdate',
      // manifest.json is hand-written and copied verbatim; the icons and
      // start_url in it are what the crew's installed apps already use.
      manifest: false,
      injectManifest: {
        // A worker registered without { type: 'module' } cannot evaluate an ES
        // module, and the crew's iPhones are the reason not to switch the
        // registration over: module workers are still uneven on iOS Safari.
        rollupFormat: 'iife',
        globDirectory: 'dist',
        globPatterns: ['**/*.{html,css,js,woff2,json}', 'favicon.png', 'assets/icon-*.png'],
        // README screenshots are a megabyte nobody opens from the barn.
        globIgnores: ['**/assets/screenshots/**', '**/sw.js'],
      },
    }),
    // vite-plugin-pwa bundles the worker source to sw.mjs and then writes the
    // real sw.js beside it with the manifest injected. The intermediate is not
    // part of the site.
    {
      name: 'ro-tidy',
      apply: 'build',
      closeBundle() {
        rmSync(resolve(outDir, 'sw.mjs'), { force: true });
      },
    },
  ],
});
