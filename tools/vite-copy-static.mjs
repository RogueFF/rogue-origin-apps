/**
 * Copy the files GitHub Pages serves today that Vite never sees.
 *
 * Pages publishes the repository root as-is, so the site is more than its HTML
 * entries: the manifest and favicon that every page names by absolute URL, the
 * PWA icons, the fonts and images under src/assets, and the Tampermonkey
 * userscript whose own @updateURL points back at its published path. None of
 * those is imported by a page, so a build that only emits what it can see
 * would quietly delete them from the site.
 *
 * Anything listed here is copied verbatim, keeping its path. Vite writes its
 * own output afterwards, so an emitted file always wins over a copied one.
 */
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Source paths, relative to the repo root. A directory copies recursively. */
export const STATIC_PATHS = [
  'favicon.png',
  'manifest.json',
  'assets',
  'src/assets',
  'src/tools',
];

export function copyStatic({ root, outDir }) {
  return {
    name: 'ro-copy-static',
    apply: 'build',
    // closeBundle runs after Vite has written its own output, so a copied file
    // can never overwrite an emitted one.
    closeBundle() {
      const copied = [];
      for (const path of STATIC_PATHS) {
        const from = resolve(root, path);
        if (!existsSync(from)) {
          throw new Error(`ro-copy-static: ${path} is listed but missing from the repo`);
        }
        cpSync(from, resolve(outDir, path), { recursive: true, force: false, errorOnExist: false });
        copied.push(path);
      }
      this.info(`copied ${copied.length} static paths: ${copied.join(', ')}`);
    },
  };
}
