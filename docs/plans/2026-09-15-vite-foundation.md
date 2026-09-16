# Step 3: the build

Date: 2026-09-15. Step 3 of `2026-09-15-apps-ui-overhaul-design.md`, after the
shell and the Floor Manager.

## What the site is, and why that shaped the build

GitHub Pages publishes this repository's root as it stands, so the site's URLs
are the repository's own paths. Outside systems name them: the barn TV opens
the scoreboard, the crew's phones have bookmarks, the Worker texts links to the
Kanban board and the supersack tracker, Twilio needs the messaging policy page
for the Capataz SMS bot, and a Tampermonkey userscript updates itself from its
own published path. Every one of those resolves today, checked against the live
site.

So the build's first duty is to emit the same URLs, not a tidier set. Every
page is an entry at the path it already has, and nothing moves.

## In this step

- [x] `vite.config.mjs`: Vite in multi-page mode, base `/rogue-origin-apps/`,
      all eighteen pages as entries, output at today's paths.
- [x] `tools/vite-copy-static.mjs` carries the files no page imports and a
      bundler therefore never sees: the manifest, the favicon, the PWA icons,
      the fonts and images under `src/assets`, and the userscript.
- [x] `tools/vite-legacy-scripts.mjs` carries what Vite declines. The
      scoreboard, the scale display, the Kanban page and Tag Desk load their
      JavaScript as ordered classic scripts that talk through `window`, which a
      bundler leaves pointing at files it never emits. The plugin copies them,
      content-hashes them the way the stamp hook did, strips the generated
      import map, and fails the build on a reference with no file behind it.
- [x] `tools/check-urls.mjs` is the parity guard: every page and every
      externally-named file exists in the output, and every link inside the
      built pages resolves. Proven by hiding a carried script and an external
      page, which fails it.
- [x] `src/sw.js` replaces the hand-written worker. The precache list is the
      build's own file list (85 files), not a hand-maintained array that could
      only name unhashed URLs.
- [x] The stamp tool, its pre-commit hook, the `?h=` query strings and the
      generated import maps are gone from all fifteen pages. CI runs the build
      and the parity check in their place.
- [x] `tests/pages-smoke.spec.js`: every page opens, nothing it asks the site
      for is missing, and nothing throws on load. Run against a served copy via
      `SMOKE_BASE`. This is the smoke test the deploy workflow gates on.
- [x] `.github/workflows/deploy.yml`, dormant until the Pages source moves.

## The service-worker hand-over

The risk the design called out is real: barn screens and phones are running the
old worker now, it claims clients and serves HTML from its own caches, and a
device left on an old page shell would name hashed assets this build no longer
contains.

Tested rather than argued. With the old worker installed and its four
`ro-ops-v3.48` caches present, the new worker installed at the same URL, took
control, deleted every `ro-ops-*` cache and the page reloaded itself. The
precache then answered the pages, the fonts, the offline page, the manifest and
the TV boards' classic scripts, including their `?h=` URLs.

One thing that would have broken the barn TV and did not reach it: the
generated worker is built as a classic script, not an ES module. The pages
register it without `type: "module"`, which cannot evaluate a module worker,
and module workers are still uneven on the iPhones the crew uses.

## What Koa has to do, and why it was not done here

The Pages source is still `master` at root, served the legacy way. Actions
cannot publish to a branch-served site, and switching it redirects the live
deployment. The steps are written at the top of `deploy.yml`: switch the source
to GitHub Actions, set the repository variable `PAGES_FROM_ACTIONS` to `true`,
push, then open the scoreboard on the TV, a phone bookmark and the SMS policy
page.

Both jobs are gated on that variable, so until it is set the workflow shows as
skipped and master never goes red.

## The fallback

The source tree is still a working site on its own. With the hashes and import
maps removed, the Hub, the Floor Manager and the scoreboard were served raw and
loaded with no failed requests. So a push before the switch does not break the
site, and going back is a settings change, not a rebuild.

## A live bug the smoke test found

`src/pages/complaints.html` threw `Identifier 't' has already been declared` on
load, and had been doing so in production: the pre-paint theme snippet declares
`var t` at global scope and a later inline block declares `const t`, which is a
SyntaxError that kills the whole block rather than one line. It failed the same
way on the untouched source, so the build did not cause it.

Fixed at the source of the class rather than the one collision: the theme
snippet is wrapped in an IIFE on all eight pages that carry it, so none of its
variables reach global scope.

## Verified

Build and parity check pass, lint passes, and `npm test` passes exactly as CI
runs it: 778 tests, harvest included.

All eighteen pages open with nothing missing and nothing thrown, in both ways
the site can be served: the built output, and the source tree under its
published path prefix. The Floor Manager's own suite passes against both as
well, five of five.
