# Session Log

History of significant changes to this repo, written by `/close`. Companion to the second brain at github.com/RogueFF/rogue-farm-wiki — decisions and context live there; this is the apps-repo timeline.

> **Updated by `/close` only.** Direct commits to this repo (without `/close`) will not appear here — see `git log` for the full commit history.

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
