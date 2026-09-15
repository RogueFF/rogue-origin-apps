/**
 * URL parity: does the build still serve everything the site serves today?
 *
 * GitHub Pages publishes this repository's root as-is, so any file in it is a
 * live URL and people have kept the ones they need: the barn TV's scoreboard,
 * the crew's phone bookmarks, the Worker's SMS links, Twilio's messaging
 * policy page, and a Tampermonkey userscript that updates itself from its own
 * published path. A build that emits a tidier set of URLs would take those
 * away silently, which is the one failure this step cannot have.
 *
 * Two checks, both against dist/:
 *   1. Every page and every externally-named file still exists.
 *   2. Every local URL a built page references resolves inside the output, so
 *      the build cannot ship a page pointing at a file it forgot to emit.
 *
 * Run as: node tools/check-urls.mjs [dist]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, process.argv[2] || 'dist');

/**
 * Files named from outside this repo, which no page links to. Losing one of
 * these breaks something that cannot be fixed by re-linking a page.
 */
const EXTERNAL = [
  'sms-policy.html',                    // Twilio messaging policy for the Capataz SMS bot
  'src/tools/uline-one-click.user.js',  // the userscript's own @updateURL
  'offline.html',                       // the service worker's offline fallback
  'sw.js',
  'manifest.json',
  'favicon.png',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-apple-touch.png',
];

/** Every file under dir, recursively, as repo-relative POSIX paths. */
function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path, base));
    else out.push(relative(base, path).replace(/\\/g, '/'));
  }
  return out;
}

const problems = [];

// 1. Every page the repo publishes, at the path it publishes it.
const sourcePages = [
  ...readdirSync(root).filter((f) => f.endsWith('.html')),
  ...readdirSync(resolve(root, 'src/pages'))
    .filter((f) => f.endsWith('.html'))
    .map((f) => `src/pages/${f}`),
];
for (const page of new Set([...sourcePages, ...EXTERNAL])) {
  if (!existsSync(resolve(outDir, page))) problems.push(`missing from the build: ${page}`);
}

// 2. Every local URL the built pages name.
const builtPages = walk(outDir).filter((f) => f.endsWith('.html'));
for (const page of builtPages) {
  // Inline scripts build markup by hand (the Kanban page's card templates are
  // src="' + url + '" concatenations), so a naive attribute scan reads their
  // JavaScript as links. Only the markup outside <script> is a link.
  const html = readFileSync(resolve(outDir, page), 'utf8')
    .replace(/<script([^>]*)>[\s\S]*?<\/script>/gi, '<script$1></script>')
    .replace(/<!--[\s\S]*?-->/g, '');
  for (const [, url] of html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)) {
    if (/^(https?:|data:|mailto:|tel:|\/\/)/.test(url)) continue;
    const [path] = url.split(/[?#]/);
    if (!path) continue;
    // An absolute URL is published under the Pages base, not the server root.
    const target = path.startsWith('/')
      ? resolve(outDir, path.replace(/^\/rogue-origin-apps\//, ''))
      : resolve(outDir, dirname(page), path);
    if (!existsSync(target)) problems.push(`${page} -> ${url}`);
  }
}

if (problems.length) {
  console.error(`check-urls: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`check-urls: ${sourcePages.length} pages and ${EXTERNAL.length} external files present; every link in ${builtPages.length} built pages resolves.`);
