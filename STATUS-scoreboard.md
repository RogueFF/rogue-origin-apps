# STATUS — Rogue Origin Scoreboard

_Last updated: 2026-02-12_

## Overview
Real-time production scoreboard displayed on a 75" 4K TV on the hemp processing floor. Shows live production data, bag timer, crew stats, order queue, and hourly performance. Bilingual (EN/ES). Has TV mode (65% scale for 4K).

## Architecture
- **Frontend:** Vanilla JS (IIFE modules), no build step. `src/pages/scoreboard.html` + 16 JS modules in `src/js/scoreboard/` + `src/css/scoreboard.css`
- **Backend:** Cloudflare Worker D1 handler (`workers/src/handlers/production-d1.js`, ~2800 lines)
- **Data flow:** Shopify Flow webhook → Worker → D1 (bag scans). Google Sheets still used for pause log, shift adjustments, some legacy reads.
- **Polling:** Smart polling — checks `/api/production?action=version` every 3s, full data fetch only on version change
- **Scale:** USB scale reader (`scale-reader-deployment/`) feeds live weight to scoreboard via local network

## Key Features
- Hourly rate tracking with break-adjusted targets
- 5KG bag timer with cycle history (5 visualization modes)
- Pause system with reasons, syncs across devices
- Morning report (weekday summaries)
- Historical date view
- Order queue (current + next order progress)
- Comparison pills (vs yesterday, vs 7-day avg, streak)
- Shift start adjustment
- Live scale weight display
- Debug panel (press D)
- Confetti celebrations on bag completion

## File Map
| File | Lines | Purpose |
|------|-------|---------|
| main.js | 587 | Entry point, init, polling loop |
| timer.js | 941 | Bag timer, pause, break subtraction |
| cycle-history.js | 664 | 5 cycle visualization modes |
| render.js | 526 | Main UI rendering |
| morning-report.js | 529 | Morning report display |
| api.js | 475 | Data fetching, version check |
| shift-start.js | 431 | Shift start adjustment |
| fab-menu.js | 413 | FAB menu (unused in current HTML?) |
| state.js | 391 | State management |
| events.js | 284 | Event listeners |
| i18n.js | 247 | EN/ES translations |
| debug.js | 246 | Debug panel |
| scale.js | 221 | Live scale polling |
| dom.js | 180 | DOM element cache |
| chart.js | 170 | Hourly rate chart |
| config.js | 106 | Constants, thresholds |
| scoreboard.css | 3421 | All styles |
| production-d1.js | 2781 | Backend handler |

## V2 — "Cockpit" Redesign

V2 is a major visual overhaul built on top of V1's logic. Same backend, same API, divergent frontend.

**Entry:** `src/pages/scoreboard-v2.html` → `src/js/scoreboard-v2/` + `src/css/scoreboard-v2.css`

**Design direction:** "Fighter jet HUD × luxury chronograph × mission control × ambient theater"
- Dark theme (near-black `#141918` with green undertone)
- Fonts: Bebas Neue (hero numbers), JetBrains Mono (data), Manrope (labels/UI)
- Design tokens via CSS custom properties
- "Cockpit" layout: hero center stage, instrument panels left/right, bottom strip
- Ambient particle layer + background animation
- FAB menu (floating action button) replaces scattered toolbar buttons

**JS changes from V1** (most modules identical):
- `config.js` — 3 new cycle modes: Timeline, Pace, Race (8 total vs V1's 5)
- `cycle-history.js` — +210 lines: Timeline strip (colored blocks per cycle with break gaps), Pace chart (horizontal bar comparison), Race view
- `render.js` — +31 lines: Momentum arrow (↗→↘ based on cycle acceleration), Race mode overlay (activates when <90% of target)
- `events.js` — +25 lines: FAB menu event wiring
- `debug.js` — +127 lines: expanded debug controls
- `fab-menu.js` — included in HTML (V1 has it but doesn't load it)
- `main.js` — 1 line diff (likely version bump)

**CSS:** 3,898 lines (vs V1's 3,421). Complete rewrite — not a patch on V1. Full design token system, cockpit layout, ambient layers, race mode overlay with red vignette, TV mode scaling, responsive breakpoints.

**HTML structure changes:**
- `<div class="cockpit">` replaces `<div class="main-panel">`
- Hero section with spotlight effect, floating status badge
- Ambient particle canvas layer
- FAB menu with all controls (start day, morning report, past data, orders, chart, help, language, TV mode, complaints)
- Inline critical CSS to prevent FOUC on dark background

**Status:** Built through Pass 7 iterations. Not yet deployed as the primary scoreboard. Accessible at `/src/pages/scoreboard-v2.html`.

## Integration Points
- **Dashboard:** Scoreboard can embed in dashboard via iframe
- **Orders API:** Fetches order queue from `/api/orders`
- **Shopify:** Webhook writes bag data to D1
- **Google Sheets:** Still reads pause log, shift adjustments
- **Scale Reader:** Local Node.js app on processing floor PC, serves weight data

## Current State
Working and deployed. Last significant changes: Jan 2026 (webhook migration to D1, smart polling, break-adjusted cycles, pause sync, morning report).
