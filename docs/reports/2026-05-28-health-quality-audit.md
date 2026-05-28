# Health & Quality Audit — 2026-05-28

Read-only audit of `rogue-origin-apps` (public GitHub repo, GitHub Pages + Cloudflare Workers + D1). Four parallel agents: frontend, backend, secret-sweep, repo-hygiene. **No files were modified.**

> **Independently re-verified (static reads, not live-tested):** the Worker router (`index.js:111-155`) dispatches purely by path prefix with **no auth at the router layer** — confirming each handler must gate itself, so C1/C2/H1 stand. The global catch (`:177-181`) does return raw `error.message` (H2 confirmed). `handleSopD1` (`sop-d1.js:591-617`) was read directly: zero `requireAuth` calls (C1 confirmed). `index.html:651` was read: the dashboard iframe loads `scoreboard.html` v1 (the embed finding stands). Claims are stated as "unauthenticated and publicly reachable in code" — they were **not** exercised against production.

---

## Status (2026-05-28 session)

| Item | State |
|------|-------|
| `wrangler.toml` real D1 id | ✅ **Committed** (`e066fc7b`, not pushed) — closes the SESSION_LOG inconsistency |
| H2 error-message leak | ✅ **Fixed & deployed** (worker `b900315d`, then `28db2637`) — `index.js` global catch routes through `formatError()` (covers exceptions propagating to the global catch), and `sop-d1.js:586` (the SOP-gen internal catch) now logs detail server-side + returns a generic client message. Lint-clean; API healthy post-deploy. **Known follow-up (LOW):** the same `err.message`-to-client pattern exists in ~7 other handler-internal catches — `sop-d1.js:338`, `kanban-d1.js:282`, `production/{hourly-entry.js:234, strain.js:250, bag-tracking.js:445}`, `orders/scoreboard-queue.js:110`, `pool.js:76`. Error strings (not secrets) on an internal tool; left in place since the specific messages are often useful for debugging. Sweep on request. |
| H5 Atlas token | ✅ **Scrubbed** — token removed from `atlas-notifications-contract.md` (owner confirms it's dead/unused, so no rotation needed). Still present in git history; not worth a history rewrite for a dead token. |
| H3 strain-name XSS | ✅ **Fixed** — `hourly-entry/index.js:2276,2279` wrapped in `escapeHtml()`. Takes effect on push. |
| H4 product-name XSS | ✅ **Fixed** — `hourly-entry/index.js:2830,2833` wrapped in `escapeHtml()`. Takes effect on push. |
| C2 AI key-burn | 🟡 **Accepted/mitigated** — the Anthropic key has a **$5 hard spend cap**, so financial blast radius is $5. Rate-limiting infra judged disproportionate. Residual risk = temporary AI-feature DoS if someone exhausts $5. |
| C1 / H1 write-endpoint auth | ⏸️ **Deferred** — real fix requires adding a login to no-login floor tools (multi-app frontend project + UX change). Tracked as follow-up, not rushed. |

## TL;DR

The data layer and frontend are above-average for a no-build app (parameterized SQL with table allow-listing, an XSS-escaping culture, a real event-cleanup registry). The one genuinely urgent theme is **backend authentication coverage**: `requireAuth` exists and is wired correctly in a few handlers, but most mutating endpoints — and several *billable* Anthropic/TTS proxies — are wide open. On a public repo with a published API URL, that's directly exploitable.

**Fix-first order:** (1) gate the open AI proxies + SOP writes, (2) rotate the Atlas token, (3) escape the two hourly-entry XSS sinks, (4) stop leaking `error.message`, then hygiene.

---

## CRITICAL — Backend auth (do first)

| # | Issue | Evidence | Fix |
|---|-------|----------|-----|
| C1 | **SOP handler imports `requireAuth` but never calls it.** Every write (`createSOP`/`updateSOP`/`deleteSOP`/`saveSettings`) + the `anthropic` AI proxy dispatch with no auth gate, and the router adds none → these are **unauthenticated and publicly reachable in code**. (Verified statically; not exercised against prod.) | `workers/src/handlers/sop-d1.js:10` (import), dispatch `:591-617` (0 auth calls) | Gate writes with `requireAuth(...)` per the `orders/index.js:78-80` pattern. |
| C2 | **Unauthenticated Anthropic / TTS proxies burn `ANTHROPIC_API_KEY`.** SOP `anthropic`, three TPM AI calls, `analyzeStrain` are all open → financial abuse / key-burn by anyone. Only `production/chat.js` is correctly gated. | `sop-d1.js:302-303`, `tpm-d1.js:152/183/250`, `production/strain.js` via `production/index.js:93` | Require auth (or server-side rate-limit + allow-list) on every action that calls Anthropic/Google TTS. |

## HIGH

| # | Issue | Evidence | Fix |
|---|-------|----------|-----|
| H1 | **No auth on most write surfaces** (`barcode-d1`, `kanban-d1`, `tpm-d1`, `supersack-d1`, `pool-d1`, `media-r2`). Destructive endpoints reachable; R2 `upload` accepts public writes. | `requireAuth` count = 0 in those handlers; `kanban-d1.js:108`, `barcode-d1.js:104`, `tpm-d1.js:125`, `media-r2.js:32` | Decide the intended auth model; add `requireAuth` to all mutating actions. |
| H2 | **Error handlers leak internals.** `handleOrdersD1` and `handleSopD1` have no top-level try/catch → raw `error.message` reaches clients via the global catch. | leak at `index.js:177-181`; contrast `production/index.js:108-111` (uses `formatError()`) | Route all handler errors through `formatError()` (`errors.js:47`). |
| H3 | **Stored XSS — strain name.** `cultivar` from the Sheet/API interpolated raw into `data-value="${cultivar}"` (attr breakout) + option text. Escape helper sits unused in the same file. | `src/js/hourly-entry/index.js:2272-2283` (helper at `:3484`) | `escapeHtml()` the attribute and text. |
| H4 | **Stored XSS — product name.** `displayName` (Shopify title) interpolated raw into `data-title` + `<span>`. | `src/js/hourly-entry/index.js:2828-2833` | `escapeHtml(displayName)`; escape `product.id` too. |
| H5 | **Hardcoded Atlas Bearer token** (48-char hex) committed since 2026-02-11. Endpoint is `100.65.60.42` (RFC 6598 / non-internet-routable, hence High not Critical). | `docs/atlas-notifications-contract.md:4` | Rotate the token; scrub from git history (BFG / `git filter-repo`). |
| H6 | **Broken iframe path** — `ops-hub.html` embeds `rogue-origin-apps/scoreboard.html` (missing `/src/pages/`) → 404. | `src/pages/ops-hub.html:318,375` | Fix path or retire ops-hub embed. |
| H8 | **Dashboard embeds the OLD v1 scoreboard.** `index.html`'s scoreboard iframe `data-src` points at `scoreboard.html` (v1), not `scoreboard-v2.html` — so the main hub shows the deprecated board. (Verified by reading `:651`.) Combined with `scale-display.html` also using v1, the v1 tree is the *actively-used* one — v2 is barely wired in. | `src/pages/index.html:651` | Decide canonical scoreboard; repoint the iframe (and migrate scale-display) before retiring either tree. |
| H7 | **Orders module skipped bilingual** — ~25+ English-only toast/error strings (project requires EN+ES). | `orders/features/{orders,payments,customers,shipments}.js` | Route user-facing strings through `t()`. |

## MEDIUM

| # | Issue | Evidence | Fix |
|---|-------|----------|-----|
| M1 | Inventory webhook is **open when `WEBHOOK_SECRET` is unset**, uses non-constant-time `!==`, and accepts secret via `?secret=` (leaks into logs). | `production/inventory.js:11-21` | Fail closed if unset; constant-time compare; drop query-param path. |
| M2 | Latent attribute-injection XSS — inline `onclick="...('${id}')"`; safe only because IDs are server-generated. | `orders/ui/table.js:55,111-117`; `shipments.js:368-382`; `payments.js:271-284` | Use `addEventListener` + `dataset`, or escape. |
| M3 | `renderStatusBadge` outputs raw `status` on enum-miss. | `orders/ui/table.js:100-102` | `escapeHtml(displayStatus)`. |

## LOW / hygiene

| # | Issue | Evidence | Fix |
|---|-------|----------|-----|
| L1 | CORS reflects any origin when `ALLOWED_ORIGINS` unset + always allows localhost (dead in prod since `wrangler.toml:47` sets it). | `cors.js:29,39` | Remove localhost-in-prod + reflect-any fallback. |
| L2 | Cron UTC offset only correct for PST; fires an hour off during PDT. | `wrangler.toml:51-56` | Cosmetic; accept drift or split summer/winter. |
| L3 | `.gitignore` has a duplicated worktree block + a pasted stray timestamp line; **`worktrees/` is NOT actually ignored** (patterns use leading dot `.worktrees/`). | `.gitignore:71-72,77-80` | Dedupe, drop timestamp line, add `worktrees/`. |
| L4 | Windows artifacts: `C:tmp/` (empty), `nul`, `workers/nul`, empty `worktrees/scaleweight-tracking/`. | repo root | Safe delete (`nul` via `\\?\` long-path). |
| L5 | Two `escapeHtml` defs diverge (shared vs `orders/ui/table.js:127`); missing `alt` on many imgs (kanban/sop/index). | — | Import shared `escapeHtml`; add alt text. |
| L6 | Stale "Vercel" comments in orders.html; backend is Workers. | `src/pages/orders.html:36,793,795,862` | Update/remove. |

---

## Deploy state (resolved during audit)

- ✅ **Worker is deployed & live** — `GET /api/supersack?action=tops_remaining` returns real data (the SESSION_LOG "not yet deployed" caveat was stale, dated 5/27).
- ✅ **Real D1 UUID is already public** in committed docs (`1583c2ee`) — and a `database_id` is an identifier, not a secret. The placeholder caution was unnecessary.
- ⏳ **Loose end:** `workers/wrangler.toml` working-tree edit (placeholder → real UUID) is uncommitted. Clean resolution = commit it; that closes the inconsistency the SESSION_LOG flagged.

## Owner-decision cleanup (not auto-removable)

- `supersack-yield-analysis-2026-05-11.pdf` at root (untracked, not ignored) — likely belongs in the wiki repo.
- Two untracked `docs/plans/*.md` (supersack-inline-edit, metrc-bot-design) — commit or discard.
- `api/` + `vercel.json` — legacy Vercel backend; retire together if Vercel is dead.
- Root `wrangler.jsonc` (Cloudflare Pages config, separate from `workers/wrangler.toml`) — confirm active vs orphaned.
- `archive/` — esp. the nested `archive/rogue-origin-apps-master/` self-copy.
- **v1 scoreboard (`scoreboard.html` + `src/js/scoreboard/`) is NOT dead** — `scale-display.html` still imports the v1 modules. Can't delete until scale-display migrates to v2.
- `.git` is ~119M — large historical blobs; `git gc` / `filter-repo` if size matters.

## Verified clean

- No `.env` / `.dev.vars` / service-account JSON ever committed (full-history check). `.gitignore` covers them correctly.
- All real secrets externalized (wrangler secrets / `process.env` / Script Properties). No AWS/GitHub/Anthropic/Shopify/Telegram keys hardcoded.
- `node_modules` (the 154MB `workers/` bloat) never committed — local only.
- SQL layer: fully parameterized, `VALID_TABLES` allow-list, identifier regex validation. No string-interpolated SQL.
- `auth.js` constant-time compare is correct.
