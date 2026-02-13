# Scoreboard V2 — Pass 2: Bottom Strip & Cycle History

## Problem
The bottom strip wastes space. The cycle history donut chart takes up 40% of the bottom to show one number ("7 BAGS"). The hourly chart area is underutilized. Overall the bottom feels disconnected from the data-dense cockpit above.

## Goals
1. Compress cycle history — kill the fat donut, replace with a tight horizontal chip/sparkline row
2. Rebalance bottom strip — hourly chart gets 75-80%, cycle summary gets 20-25%
3. Right panel grouping — add a subtle glass container around the timer/scale section
4. Fix "= On pace" delta — show actual lbs delta when ahead/behind instead of generic text

## Changes

### 1. Bottom Strip Rebalance
**Files:** `src/css/scoreboard-v2.css`
- Change `.chart-container` flex from 6 to 8
- Change `.cycle-history` flex from 4 to 2
- The chart should be the star of the bottom strip

### 2. Cycle History Default Mode → Chips or Sparkline
**Files:** `src/js/scoreboard-v2/cycle-history.js`
- Change the default display mode from "donut" to "sparkline" (the bar view) or "chips" (colored pills)
- Sparkline is better for the compressed space — vertical bars showing each bag's time, colored green/yellow/red
- The donut can still be accessed via the nav arrows, just don't default to it

### 3. Right Panel Glass Container
**Files:** `src/css/scoreboard-v2.css`
- Add a subtle background + border to `.timer-panel` — something like:
  - `background: rgba(28, 34, 32, 0.5)`
  - `border: 1px solid var(--border-subtle)`
  - `border-radius: var(--r-xl)`
  - `padding: var(--sp-4)`
  - `backdrop-filter: blur(12px)`
- This groups the scale ring, timer ring, bag stats, and button as one cohesive instrument cluster

### 4. Fix Delta Pill Logic
**Files:** `src/js/scoreboard-v2/render.js`
- In the `renderScoreboard` function, the `dailyDelta` section has a threshold of ±0.1 for showing "On pace"
- Problem: When todayDelta is between -0.1 and 0.1 it shows "= On pace" even when they might be slightly ahead
- This is actually fine for small deltas. BUT: check if todayDelta is being calculated correctly in the API response
- Also: make sure the delta shows absolute lbs difference, not just "On pace" — the team wants to see "+4.3 lbs" not "On pace"
- The threshold should be much tighter: ±0.05 instead of ±0.1

## Constraints
- NO new dependencies
- Keep all 5 cycle view modes (list, donut, sparkline, chips, cards) — just change the DEFAULT
- Don't break the cycle-history navigation (‹ › buttons)
- Must work on 1080p and 4K TV displays
- Don't change the HTML structure of the bottom strip

## Files to Edit
- `src/css/scoreboard-v2.css` — flex ratios, timer-panel glass container
- `src/js/scoreboard-v2/cycle-history.js` — default mode change
- `src/js/scoreboard-v2/render.js` — delta threshold fix
