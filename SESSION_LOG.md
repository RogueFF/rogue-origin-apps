# Session Log

History of significant changes to this repo, written by `/close`. Companion to the second brain at github.com/RogueFF/rogue-farm-wiki — decisions and context live there; this is the apps-repo timeline.

> **Updated by `/close` only.** Direct commits to this repo (without `/close`) will not appear here — see `git log` for the full commit history.

---

## 2026-04-28 — Rescue uncommitted work from stale Desktop/ clone

- `.gitignore`: add wrangler dev-vars patterns (`.dev.vars*`, `!.dev.vars.example`, `!.env.example`)
- `package.json`: add `deploy` (wrangler deploy) + `preview` (wrangler dev) scripts; add `wrangler ^4.81.1` to devDependencies
- New: `wrangler.jsonc` — base Cloudflare Workers config
- New: `scripts/make_overfill_sheet.py` — generates blank packaging-overfill xlsx template (output path needs update — see todo)
- Wiki context: wiki/seasons/2026/journal/2026-04-28.md

---
