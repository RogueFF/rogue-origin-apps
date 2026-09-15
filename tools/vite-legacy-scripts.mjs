/**
 * Carry the pages that still load classic scripts, and content-hash them.
 *
 * Vite only bundles a script tag that says type="module". The scoreboard, the
 * scale display, the Kanban page and Tag Desk load their JavaScript as ordered
 * classic scripts that talk to each other through window, which is why they
 * are not being redesigned in this overhaul — and why a build leaves their
 * tags pointing at files it never emitted. Published as-is, every one of those
 * URLs is a 404 on the barn TV.
 *
 * So this plugin finishes the job the bundler declines: for every local URL a
 * built page still names that Vite did not emit, copy the file to the same
 * path in the output and rewrite its ?h= to the hash of what was copied. That
 * is what tools/stamp-modules.mjs did at commit time, moved into the build
 * where it cannot go stale — and it fails the build on a reference with no
 * file behind it, which the old hook could not see.
 *
 * It also strips the stamp tool's generated import map out of the built pages.
 * Once Vite has bundled a page's modules, the map resolves specifiers that no
 * longer appear in the file.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const START_MARKER = '<!-- module-hashes:start -->';
const END_MARKER = '<!-- module-hashes:end -->';
const IMPORT_MAP = /<script type="importmap">[\s\S]*?<\/script>\s*/g;

/** Every file under dir, recursively. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

/**
 * Hash a file the way stamp-modules did: newlines normalised first, so the
 * same source checked out with CRLF and with LF hashes the same. A Windows
 * clone and CI must agree or the URL changes on every deploy.
 */
function hashFile(path) {
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(text).digest('hex').slice(0, 8);
}

export function legacyScripts({ root, outDir }) {
  return {
    name: 'ro-legacy-scripts',
    apply: 'build',
    closeBundle() {
      const missing = [];
      const carried = new Set();

      for (const page of walk(outDir).filter((file) => file.endsWith('.html'))) {
        let html = readFileSync(page, 'utf8');

        const start = html.indexOf(START_MARKER);
        const end = html.indexOf(END_MARKER);
        if (start !== -1 && end !== -1) {
          html = html.slice(0, start) + html.slice(end + END_MARKER.length);
        }
        // Vite hoists script tags into <head>, so the map itself is no longer
        // between those markers by the time this runs.
        html = html.replace(IMPORT_MAP, '');

        html = html.replace(/(src|href)="(\.\.?\/[^"]+)"/g, (tag, attr, url) => {
          const [path, query] = url.split('?');
          const emitted = resolve(dirname(page), path);
          // Vite rewrites what it bundles to an absolute /base/assets/ URL, so
          // anything still relative here is a file it passed over.
          if (existsSync(emitted)) return tag;

          const source = resolve(root, relative(outDir, emitted));
          if (!existsSync(source)) {
            missing.push(`${relative(outDir, page)} -> ${url}`);
            return tag;
          }

          mkdirSync(dirname(emitted), { recursive: true });
          copyFileSync(source, emitted);
          carried.add(relative(root, source).replace(/\\/g, '/'));
          // Only a hashable asset gets a cache key; a link to another page
          // keeps the URL people have bookmarked.
          if (/\.(js|mjs|css)$/i.test(path)) return `${attr}="${path}?h=${hashFile(source)}"`;
          return query ? `${attr}="${path}"` : tag;
        });

        writeFileSync(page, html);
      }

      if (missing.length) {
        throw new Error(
          'ro-legacy-scripts: these pages reference files that do not exist:\n  '
          + missing.join('\n  '),
        );
      }
      this.info(`carried ${carried.size} classic assets: ${[...carried].sort().join(', ')}`);
    },
  };
}
