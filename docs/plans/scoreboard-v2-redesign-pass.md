# Scoreboard V2 Redesign Pass — "Make It Pop"

## Problem
The scoreboard looks one-dimensional. Data doesn't pop. From the production floor at distance, you can't quickly read what matters. The visual hierarchy is flat — every section competes equally for attention.

## Goals
1. **Hero center dominance** — the daily lbs total should command 60% of visual attention
2. **Color-as-communication** — the whole screen mood shifts aggressively with status (green/yellow/red)
3. **Floor readability** — key numbers doubled in size, half the labels killed

## Changes (CSS-only where possible, minimal HTML tweaks)

### 1. Hero Number — Make It THE Page
- Add a stronger radial glow/spotlight behind the hero number (not a card — just light)
- Make the delta pill (↑ Up 5.2) bigger and bolder — this is the #2 most important element
- Progress bar: 3px → 10px, add color stages, round caps, percentage label ON the bar
- Projection row: bump font size, make it more visible

### 2. Ambient Color System — Turn It Up
- Increase the radial gradient intensity for ahead/behind/on-target body states (currently too subtle)
- Add colored border-top accent to the header based on status (green/yellow/red strip)
- Edge glow elements: actually use them — subtle colored glow on screen edges matching status
- Timer panel color bleeding should be stronger

### 3. Left Panel — Simplify & Enlarge
- Last Hour card: make actual-lbs font bigger (56px → 72px), kill the "LBS" label (it's obvious)
- Reduce the timeslot text — it's secondary info
- Info bar: increase crew count and target rate font sizes
- Kill the AVG/BEST toggle — show them inline, always visible

### 4. Right Panel (Timer/Scale)
- Already good. Minor: make the timer-value font larger in green/red states
- Bag stats row: slightly larger values

### 5. Bottom Strip — Make It Useful
- When no cycles: show a motivational/waiting state, not "No cycles yet" text
- Ensure the hourly chart is visible by default (display:block, not none)

### 6. General Polish
- Increase overall contrast — muted colors are too muted on a production floor display
- Labels: bump from 10-11px to 12-13px minimum for TV readability
- Gold accents: make slightly brighter/warmer

## Files to Edit
- `src/css/scoreboard-v2.css` — primary changes (80% of work)
- `src/pages/scoreboard-v2.html` — minor HTML tweaks (edge glow activation, label removal)
- `src/js/scoreboard-v2/render.js` — minor (chart visibility default)

## Constraints
- NO layout restructuring — keep the cockpit grid as-is
- NO new dependencies
- CSS changes only where possible
- Must work on 1080p and 4K TV displays
- Must not break existing JS module references
