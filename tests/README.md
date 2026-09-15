# Tests

Two kinds of test live here, and each has its own runner.

## Unit tests: `*.test.mjs`

Pure logic under `node:test`, with no browser and no network. CI runs them on
every push and pull request.

```bash
npm test
```

`helpers/d1-mock.mjs` is an in-memory stand-in for Cloudflare D1, used by the
Worker handler tests.

`scale-gate.test.js` is a standalone node script for the bag-size weight gate.
Run it directly:

```bash
node tests/scale-gate.test.js
```

## End-to-end specs: `*.spec.js`

Playwright, configured in `playwright.config.js` to collect `*.spec.js` only.

```bash
npm run playwright:install   # once, to download browsers
npm run test:e2e
```

| Spec | Runs against |
|---|---|
| `kanban-tutorial.spec.js` | `kanban.html` over `file://` |
| `tag-desk.spec.js` | `tag-desk.html` with fixtures in `fixtures/tag-desk/` |
| `supersack-entry.spec.js` | `supersack-entry.html` with mocked API routes |
| `hourly-entry.spec.js`, `hourly-entry-goals.spec.js` | Floor Manager on a local server (each file sets its port) |
| `carryover-bags.spec.js` | the live Scoreboard on GitHub Pages |
| `verify-analyze-strain.spec.js`, `verify-strain-snapshot.spec.js` | the live production API |

The last three read production, so they are not part of CI.
