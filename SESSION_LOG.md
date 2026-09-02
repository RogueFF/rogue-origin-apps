# Session Log

History of significant changes to this repo, written by `/close`. Companion to the second brain at github.com/RogueFF/rogue-farm-wiki — decisions and context live there; this is the apps-repo timeline.

> **Updated by `/close` only.** Direct commits to this repo (without `/close`) will not appear here — see `git log` for the full commit history.

---

## 2026-09-02 — try pounds inside the ledger bars, then revert

- `src/js/hub/ledger.js`, `src/css/hub.css` — figures printed inside each tops/smalls bar (rotated, above-the-cap fallback for short bars); reverted the same hour because the rows beneath already carry the numbers and two copies read as noise. `02914d5d` → `da7c5c65`. Nothing changes for the reader.
- Wiki context: wiki/seasons/2026/journal/2026-09-02.md

---

## 2026-09-02 — attribute supersacks by title, add the 2026 greenhouse cultivars, polish the hub

- `workers/src/lib/coverage.js`, `workers/src/handlers/wholesale-d1.js` — raw supersacks resolve through `cultivar_aliases` on the variant title, falling back to the SKU prefix. Shopify's sack SKUs were coded by hand (SCOOK, SSHAKER) and did not match the catalogue prefixes (SUGCOOK, SUGSHAKE), so Sugar Cookez (186 sacks) and Sugar Shaker (50) read as zero on the coverage card. Finished goods still resolve by SKU, where `parseSku` needs it. Two tests; suite 385/385. Worker `c4fbd192`.
- `workers/migrations/0026-greenhouse-2026-cultivars.sql` — Gravy Train (GT) and Legendary Banana Mac (LBM) enter the cultivars dimension with their sack titles as aliases. Applied to rogue-origin-db statement by statement. `MIX-SG-SUPRSAK-2025` remains skipped on purpose: a mixed sack is not a cultivar.
- `src/js/hub/sections.js`, `src/css/hub.css`, `src/pages/index.html` — hero says ahead/behind pace against the hours-adjusted target alongside pounds to the goal; unit no longer clips; rail and loader use the round badge. Note the asset names are swapped: `ro-logo-horizontal.png` is the circle, `ro-logo-square.png` the wordmark.
- `assets/screenshots/dashboard.png` — the Today view at the end of the Sep 1 shift (real data, clock frozen), no cost tiles.
- Wiki context: wiki/seasons/2026/journal/2026-09-02.md

---

## 2026-09-02 — rebuild the dashboard as Ops Hub v3 and retire the v2 shell

- `src/pages/index.html`, `src/css/hub.css`, `src/js/hub/` — the Ops Hub rewrite: Right now (pace against target, rate, crew, last bag), the Shift Ledger (one column per hour with tops, smalls, rate vs target, crew, note flags), In the pipe (order queue, committed-vs-finished coverage, finished tops on hand), Watchlist (open complaints, reorder requests, cart, supersack QA), 30-day trend, cultivars, cost and labor, daily table with CSV export. Every period figure carries its change against the equivalent prior period, which replaces Compare mode.
- Charts are hand-drawn SVG (`svg.js`, `ledger.js`) — no Chart.js, Muuri or Phosphor. Series colours were run through the CVD validator; smalls is gray because green-vs-gold fails.
- `src/js/hub/auth.js`, `chat.js` — the assistant gets its own unlock dialog on the shared password; chat and TTS both send `Authorization: Bearer`. Model dropdown and feedback thumbs removed (neither reached the worker).
- Deleted: `src/js/modules/` (25 files, including the never-imported briefing engine), `dashboard.css`, `ai-chat.css`, `shared/api-cache.js`, and nine Playwright specs that asserted on the v2 widget DOM. `test:dashboard*` scripts and their `testIgnore` entries went with them.
- `sw.js` → v3.42; README, CLAUDE.md, CODEBASE_MAP.md, docs/README.md describe `src/js/hub/`. README screenshot recaptured.
- Design: `docs/plans/2026-09-01-ops-hub-v3-design.md`. Commits 18b11e43, 22d00c83, 1cdb173b; live on Pages.
- Wiki context: wiki/seasons/2026/journal/2026-09-02.md

---

## 2026-08-28 — surface the wholesale queue on the floor, and credit what was not trimmed

- `workers/src/handlers/media-r2.js` — the four write actions now require the operator password. `/api/media` was the only handler that never imported `requireAuth`: an anonymous caller could enumerate the bucket and upload 250 MB to it. Reads deliberately left open (142 SOP images render from them). `tests/media-auth.test.mjs`.
- `workers/src/lib/queue-brief.js` — one projection of the board, feeding the Ops Hub widget, the hourly-entry header strip and the Order Queue tab. Grew `passes` then `lines` as the screens needed them, rather than a second caller running the same expensive queue computation.
- `workers/migrations/0021-order-items-credited.sql` + `workers/src/lib/burndown.js` — `credited_lbs`: pounds the trim line will never produce because they were already in stock. Demand-side only; nothing writes to `monthly_production`, so crew rate and floor output are untouched. The cultivar trimmed next runs past the satisfied line to the order behind it.
- `workers/src/handlers/wholesale-d1.js` — `setLineCredit`, a targeted UPDATE. Deliberately not `saveOrder`, which replaces every line and would make a second client round-trip fields it does not hold.
- `workers/src/lib/sack-rates.js` — measured tops-per-sack, extracted from `projectFinishedTops` so the forward projection and the board's inverse ("this line needs N lb, how much raw is that") cannot drift. Its six existing tests pass unchanged.
- `src/js/hourly-entry/index.js`, `src/pages/hourly-entry.html` — header strip (now/next) and an Order Queue tab beside Pools, with pounds-done editable per line.
- `src/js/wholesale/queue.js` — raw needed vs raw on hand in the pass detail, flagged when short; open-in-Shopify link per order.
- `workers/src/lib/telegram.js` — the sender reports whether it delivered, and names the bot id on failure. Undelivered notifications are no longer recorded as sent.
- `tests/table-references.test.mjs` — the guard was reading a UI label beginning "Update" as SQL. Suite 383/383.
- Wiki context: wiki/seasons/2026/journal/2026-08-28.md

---

## 2026-08-21 — Log the wholesale board's glass, bell, and review pass

Twenty-eight commits (`b5c9cc03` → `995b0a81`) across the evening of 08-20 and the
morning of 08-21, continuing the order-blocks build logged the day before.

- `src/css/wholesale.css`, `src/js/wholesale/queue.js` — the board gets a liquid-glass
  treatment, then a quieter near-monochrome palette, then a motion pass so state changes
  ease rather than snap. A pass row states only its burn-down and its lead time; the rest
  moved to hover. Quantity, trim order and line removal became inline edits **on the
  block** rather than a modal.
- `src/css/shared-base.css` — `.btn { display: inline-flex }` was overriding the `hidden`
  attribute across every app; `hidden` now means hidden. The skip link hides itself.
- `workers/migrations/0020-drop-customers.sql` — customers dropped entirely. An order is a
  Shopify order number plus a nickname, both editable in place. Applied to prod D1.
- `workers/src/lib/wholesale-notify.js` (new) — pure derivation of six queue events
  (order started, next strain, strain finished, order finished, running behind, queue
  clear), deduped through an `alerts_sent` ledger keyed `UNIQUE(rule, dedup_key)`.
  `TELEGRAM_CASEY_CHAT_ID` is not yet set, so nothing sends.
- `workers/src/lib/queue-schedule.js` — crew derives from five weighted days with today's
  live count shown alongside; the empty-input trap that always read 1 is gone. Lot sizing
  no longer throws when an all-tops cultivar is asked for smalls.
- `workers/src/handlers/wholesale-d1.js` — nine fixes from a review. The load-bearing
  ones: finished orders stay in the allocation replay (bounded on `updated_at`, not
  `accrual_start`) so a completed order no longer hands its pounds to the next in line;
  `queue_rank` carries a letter prefix because SQLite sorts digits before letters, which
  had every new order jumping ahead of hand-dragged ones; Telegram events are recorded
  per-send rather than per-batch; free text is stripped of Markdown markers before
  interpolation; empty item sets are refused; an absent status means "no opinion".
- `tests/` — 288 → 321. New suites for burn-down allocation, notification derivation,
  the status vocabulary (a drift guard across migration, worker and browser), and a check
  that no handler references a dropped table.

- Wiki context: wiki/seasons/2026/journal/2026-08-21.md

---

## 2026-08-20 — Replace the retired wholesale app with a production queue

The Wholesale Orders app could only express one strain and one kg total per order, so
multi-cultivar orders lived in a notes field. It was retired mid-design by a parallel
session; this is its replacement, built around what the floor actually does.

- `workers/migrations/0014-order-items.sql`, `0017-cultivars.sql`, `0018-orders-reset.sql` —
  real line items, a canonical cultivar dimension with an alias map, and `orders` rebuilt
  around them with a CHECK on status. All applied to prod D1.
- `workers/src/lib/wholesale.js`, `work-calendar.js`, `queue-schedule.js` — the pure core.
  Runs are per CULTIVAR, not per (cultivar, form): 45 days of `monthly_production` show
  tops and smalls recorded against the same cultivar and the same trimmer count, so a lot
  is sized by whichever form binds and the other falls out as surplus. The work calendar is
  a port of the Apps Script `addWorkHours` rewritten as civil-date arithmetic — the original
  reads `Date.getHours()`, which is Pacific under Sheets but UTC in a Worker.
- `workers/src/lib/sku.js`, `coverage.js` — SKU parsing for Shopify import (validated against
  all 362 catalogue rows) and committed-vs-packed coverage.
- `workers/src/handlers/wholesale-d1.js` — `/api/wholesale`. Deliberately not `/api/orders`,
  which is now Consignment's login endpoint.
- `src/pages/wholesale.html`, `src/js/wholesale/*`, `src/css/wholesale.css` — the page. One
  view: the production queue. Orders are reached from the runs that feed them.
- `tests/` — 82 new tests, 155 → 237.
- Wiki context: wiki/seasons/2026/journal/2026-08-20.md

---

## 2026-08-11 — Route Grove kanban scans to a reorder alert instead of the Friday cart

Grove supplies are reordered by Damon on a separate track, so a Grove QR scan now
raises a logged reorder request and emails him, never touching `kanban_cart`.

- `workers/src/handlers/kanban-d1.js` — Grove branch in `addToCart` (routes on
  `supplier === 'Grove'`), discriminated `{mode: 'cart' | 'reorder_request'}`
  response, GET-renders / POST-commits close endpoints, alert body with order
  quantity + location
- `workers/migrations/0013-kanban-reorder-requests.sql` — request table; a
  partial unique index (`WHERE status='open'`) is the dedup rule, and
  `notify_state` keeps a failed send visible and retryable. Applied to prod D1.
- `workers/src/lib/mailer.js` + `mail-relay.js` + `gmail.js` — one entry point,
  two transports. The Apps Script relay is live; the Gmail API path is wired but
  needs a super-admin domain-wide delegation grant (the service account has
  credentials but no mailbox).
- `apps-script/mail-relay/Code.gs` + `README.md` — the relay, deployed
- `src/pages/kanban.html` — `reorder()` switches on `mode`; it previously
  dereferenced `r.cartItem.qty` unguarded, which would have thrown for Grove
  even when the email sent fine
- `tests/mail-transport.test.mjs`, `tests/reorder-email-body.test.mjs` — 20 new
  tests (262 total)
- Wiki context: wiki/seasons/2026/journal/2026-08-11.md

---

## 2026-06-09 — Build the supply-reorder kanban (Min/Max cards + cart logic)

Lean supply-reorder kanban for the Uline boxes + consumables. 4 feat commits (`4ee67df4..fd2c98bc`); SW cache `v3.20→v3.24`. Card data (Par/Min levels, crumbtrail fixes) was set in D1 via the API, not in this repo.

- **Full-sheet card → single-sided portrait kanban card** (`src/pages/kanban.html`): centered title, big photo, 3 fields, front QR + price; 1 page per card (was front+back). Dropped `full` from the on-screen preview dropdown (preview has no per-size CSS, so it was never size-accurate).
- **Min/Max model on the cards:** `orderQty` = Fill To (par), `orderWhen` = Reorder At (min) — no schema migration. The full card **and a new `shop-letter` (11×8.5 landscape) branch** show **Reorder At / Fill To / Supplier + scan QR**. Added bilingual `reorderAt`/`fillTo` i18n keys.
- **Cart suggests one cycle (`cartQtyFor`):** scanning / adding to cart now defaults qty to Fill − Reorder (`orderQty − orderWhen`), not full par; legacy cards with a non-numeric `orderWhen` ("Green Card Signal") keep their full `orderQty`.
- **Bugfix:** the edit form hardcoded `orderWhen: 'Green Card Signal'` on every save (would silently wipe the reorder point) — now preserves the existing value.
- Wiki context: wiki/seasons/2026/journal/2026-06-09.md

---

## 2026-05-28 — Health/quality audit + security fixes + scoreboard v1→v2 migration

Full read-only audit of the repo (4 parallel agents), then a batch of fixes and three follow-up loops closed. 10 commits (`86cf69e7..e7c8bbc3`); two worker deploys (`bcb1efdd` final).

- **Audit:** `docs/reports/2026-05-28-health-quality-audit.md` — frontend, backend, secret-sweep, hygiene. Backend auth gap (most write/AI endpoints unauthenticated) documented; AI key-burn accepted (covered by a $5 spend cap); write-endpoint login deferred then dropped by owner.
- **Security fixes (deployed):** escaped two stored-XSS sinks in `src/js/hourly-entry/index.js`; routed the worker global catch through `formatError()` and fixed 8 handler-internal catches that leaked raw `err.message` (`workers/src/handlers/{sop-d1,kanban-d1,pool,production/hourly-entry,production/strain,production/bag-tracking,orders/scoreboard-queue}.js`); scrubbed the dead Atlas Bearer token from `docs/atlas-notifications-contract.md`.
- **D1 id:** committed the real `database_id` to `workers/wrangler.toml` (`e066fc7b`) — closes the long-standing placeholder/real-ID inconsistency.
- **ops-hub retired:** deleted `src/pages/ops-hub.html` + `src/css/ops-hub.css`; repointed all 14 app home buttons → `index.html`; cleaned SW precache.
- **Dead-path repairs:** `pool.html` + `scale-display.html` favicon/logo/icon paths; `scoreboard{,-v2}/api.js` stale `vercel.app` fallback → `workers.dev`; dropped a nonexistent `legacy/dashboard.js` from SW precache.
- **Scoreboard v1→v2 migration:** made `scoreboard-v2` canonical everywhere (index iframe + `appUrls`, `scale-display` 7 modules, sibling nav, SW precache → v3.18, eslint/package lint refs); **deleted v1** `src/pages/scoreboard.html` + `src/js/scoreboard/`. scale-display verified byte-level drop-in on v2 modules.
- **Repo hygiene:** `.gitignore` — added `worktrees/` (never actually ignored), removed a duplicate block + a stray pasted timestamp; deleted Windows `nul`/`C:tmp` artifacts + stale empty worktree dir.
- **Deploy note:** API deploys must use `npx wrangler deploy -c workers/wrangler.toml --env=""` — a bare `cd workers && wrangler deploy` can pick up the root `wrangler.jsonc` (a different, assets worker) and fail.
- Wiki context: wiki/seasons/2026/journal/2026-05-28.md

---

## 2026-05-27 — D1 placeholder cleanup in docs + delete obsolete overfill script

- `CLAUDE.md`, `CODEBASE_MAP.md`, `docs/FEATURES_CHANGELOG.md`, `.planning/codebase/INTEGRATIONS.md` — replaced `REDACTED-D1-OPS-ID` placeholder with real D1 UUID `31397aa4-aa8c-47c4-965d-d51d36be8b13` (commit `1583c2ee`)
- `scripts/make_overfill_sheet.py` — deleted; one-shot tool no longer needed, recoverable from git history (commit `d1531841`)
- `SESSION_LOG.md` — this entry
- **Caveat:** the docs commit (`1583c2ee`) conflicts with the morning session's "kept real D1 ID out of git" decision. HEAD of `workers/wrangler.toml` still has the placeholder; the real UUID I saw was a working-tree edit from the parallel deploy session. Inconsistency resolves cleanly once the parallel session commits `wrangler.toml`'s real ID.
- Not pushed by this /close — parallel deploy session controls the push order (see todo: Deploy supersack + security work)
- Wiki context: wiki/seasons/2026/journal/2026-05-27.md

---

## 2026-05-27 — add supersack tops_remaining API + security hardening + analytics docs

- `workers/src/handlers/supersack-d1.js` — new `tops_remaining` action + pure `projectFinishedTops()` (projects finished tops from raw inventory; 5-min cache + 24h stale fallback)
- Security: login password moved from URL query → POST body (`orders/index.js`, `lib/auth.js`, 4 frontend sites); CORS `|| '*'` fallback fixed + `rogueorigin.com` allow-listed (`lib/cors.js`, `wrangler.toml`); generic client error on the endpoint
- Architecture/formula + design docs (`SUPERSACK_ANALYTICS.md`, `SUPERSACK_TOPS_REMAINING.md`, `2026-05-27-supersack-tops-remaining-api-design.md`) — **relocated to the wiki repo's `docs/` (technical/ + plans/)** the same day; they live in the second brain, not this repo
- Note: not yet deployed — `wrangler deploy` must precede the frontend push (login depends on it)
- Wiki context: wiki/seasons/2026/journal/2026-05-27.md

---

## 2026-05-13 — Field Ops Tracking Phase 1: JD Operations Center ingest plumbing

- `workers/migrations/0006-jd-telemetry-tables.sql` (new): 7 D1 tables for the field-ops tracking system — `jd_position_breadcrumb`, `jd_machine_states`, `jd_machine_alerts` (raw 5-min telemetry), `zone_op_actuals`, `zone_op_idle_periods` (derived), `alerts_sent` (dedup), `field_boundaries_cache` (zone polygons). Applied to local + remote D1 via direct `--file` execution because the remote `d1_migrations` tracker is out of sync with the actual schema state (pre-existing condition — production tables exist but were never tracked by wrangler migrations).
- `workers/src/lib/jd-api.js` (new): JDApi client wrapping OAuth 2.0 refresh-token flow + Bearer-authed REST calls. Env-var-based sandbox/production switching via `JD_ENV`. Auto-refreshes access tokens with 60s safety margin; respects refresh-token rotation.
- `workers/src/lib/jd-endpoints.js` (new): functional wrappers around JD endpoints — `listOrganizations`, `listMachines`, `getMachineState`, `getMachineLocationHistory`, `listMachineAlerts`, `listBoundaries`. Each returns shape-normalized snake_case objects ready for D1 binding; raw JD response preserved as `raw` for forensic inspection.
- `workers/src/handlers/jd-ingest.js` (new): 5-min cron handler that polls each machine in `JD_ORG_ID` for current state, recent location breadcrumbs (6-min window), and any new DTC alerts. Per-machine, per-endpoint try/catch — a transient failure on one machine doesn't abort the run. Uses `INSERT OR IGNORE` on alerts (UNIQUE on `jd_alert_id`) for re-poll dedup.
- `workers/src/index.js`: wired JD ingest into `scheduled()` via lazy import (matches existing handler-import pattern). Tightened `isDailyCron` from `dow === '*'` to `dow === '*' && minute === '0'` so the new `*/5 * * * *` cron doesn't accidentally trigger the daily complaints-sync + weather-pull blocks. New `isFiveMinCron = minute === '*/5'`.
- `workers/wrangler.toml`: added `*/5 * * * *` cron trigger + `JD_CLIENT_ID`/`JD_CLIENT_SECRET`/`JD_REFRESH_TOKEN`/`JD_ORG_ID`/`JD_ENV` to the required-secrets comment block.
- `workers/scripts/jd-oauth-helper.mjs` (new): standalone Node helper to run the one-time OAuth code → refresh-token exchange. Listens on `http://localhost:9090/callback`, prints refresh_token to stdout. Operator stashes via `wrangler secret put JD_REFRESH_TOKEN`.
- `workers/scripts/jd-list-orgs.mjs` (new): one-shot discovery to print accessible orgs after OAuth completes (find `JD_ORG_ID`).
- `workers/scripts/jd-cache-boundaries.mjs` (new): emits SQL upsert file (gitignored, written to `scripts/_generated/`) with all current zone polygons from JD; operator applies via wrangler whenever convenient. Decoupling fetch from apply lets the operator handle wrangler-config concerns (the `REDACTED-D1-OPS-ID` placeholder workflow) however they normally do.
- `.gitignore`: exclude `workers/scripts/_generated/*.sql`.
- Phase 1 done at the code level. Operator still needs to run the OAuth flow (Phase 0 prereq), stash 5 secrets, deploy, and watch the first live ingest before Task 11 closes. Phase 2 (zone-op derivation engine + daily report Routine + MCP `field_prep_daily_data` tool + alert rules) is next.
- Wiki context: wiki/seasons/2026/journal/2026-05-13.md

---

## 2026-05-12 — Weekly supersack QA cron, silent when clean

- `workers/src/handlers/supersack-qa.js` (new): hard SQL anomaly checks against `supersack_entries` for the last 7 days — rows missing biomass or trim (silent-drop case), rows over-attributed >1.3× raw. Returns `{hasAnomalies: false}` when clean, markdown body when issues exist.
- `workers/src/index.js`: Monday cron dispatch (`isMondayCron`) + `sendSupersackQAAlert()` that pings Telegram only when anomalies exist + new `/api/supersack-qa` GET route returning the same report as JSON for manual spot-checks.
- `workers/wrangler.toml`: third cron entry `0 14 * * 1` (Monday 6 AM PT during PST, 7 AM PDT).
- First live run surfaced 3 missing-weight rows from 5/7 (Godfather OG / Passion Fruit OG / Purple Frosty — 11 sacks total) that had been silently excluded from analytics since entry.
- Wiki context: wiki/seasons/2026/journal/2026-05-12.md

---

## 2026-05-11 — Supersack analytics cleanup + per-strain bio/trim entry

- `workers/src/handlers/supersack-d1.js`: tighten analytics `complete=true` filter to `bio>0 AND trim>0 AND outputs ≤ 1.3× raw`; extend submit() to accept per-strain `biomass`/`trim` alongside per-strain `tops`/`smalls`, fall back to ratio-split when not supplied
- `src/pages/supersack-entry.html`: replace global biomass/trim card with per-strain inputs that reveal under each strain row when sacks>0; day-totals derived from sum; edit mode pre-fills per-strain values from history; submit payload includes new fields; existing zero-weights failsafe still applies on the day-total
- `src/pages/supersack-analytics.html`: thin-sample badge (⚠ thin) on inventory projection row when strain has fewer than 10 sacks of clean data
- `tools/build-supersack-report.py` (new): reusable PDF report generator pulling live D1 analytics
- `tools/verify-supersack-entry.py` (new): Playwright e2e verifier against live GH Pages page — 7/7 assertions pass
- Wiki context: wiki/seasons/2026/journal/2026-05-11.md

---

## 2026-04-28 — Rescue uncommitted work from stale Desktop/ clone

- `.gitignore`: add wrangler dev-vars patterns (`.dev.vars*`, `!.dev.vars.example`, `!.env.example`)
- `package.json`: add `deploy` (wrangler deploy) + `preview` (wrangler dev) scripts; add `wrangler ^4.81.1` to devDependencies
- New: `wrangler.jsonc` — base Cloudflare Workers config
- New: `scripts/make_overfill_sheet.py` — generates blank packaging-overfill xlsx template (output path needs update — see todo)
- Wiki context: wiki/seasons/2026/journal/2026-04-28.md

---
