# Session Log

History of significant changes to this repo, written by `/close`. Companion to the second brain at github.com/RogueFF/rogue-farm-wiki — decisions and context live there; this is the apps-repo timeline.

> **Updated by `/close` only.** Direct commits to this repo (without `/close`) will not appear here — see `git log` for the full commit history.

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
