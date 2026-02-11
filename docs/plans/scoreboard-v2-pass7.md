# Scoreboard V2 — Pass 7: The Industrial Evolution

## Philosophy
This scoreboard lives on a 75" 4K TV (3840×2160) on a hemp processing floor. Workers need to FEEL the pressure. Data should scream from 20 feet. Simple enough for crew, deep enough for supervisors.

## Changes from Pass 6

### 1. Font Swap — Hero Number
- **Replace** Playfair Display with **Bebas Neue** for `.daily-actual`
- Already loaded in the HTML `<link>` tag (check — add if missing)
- Bebas Neue is industrial, bold, speedometer energy. Not a wine label.
- Keep JetBrains Mono for all other data, Manrope for labels/UI

### 2. Information Density
- Reduce whitespace/gaps throughout. The TV has room, use it.
- Increase `.daily-actual` font-size in TV mode (currently likely around 12-14vw, push toward 16-18vw)
- Tighten padding on instrument panels, hour cards, info bar
- The cockpit should feel *packed with useful information*, not artfully sparse

### 3. Shift Momentum Indicator
- Add momentum arrow next to the rate display in the info bar
- Compare current cycle's rate vs rolling average of completed cycles
- ↗ = accelerating (current > avg * 1.05)
- → = steady (within ±5%)
- ↘ = decelerating (current < avg * 0.95)
- Arrow inherits ambient color (green/yellow/red)
- Add to `render.js` — calculate in the render cycle using cycle history data
- HTML: Add `<span class="momentum-arrow" id="momentumArrow"></span>` after target rate in info bar

### 4. Race Mode Overlay
- When pace is behind target (<90%), add subtle diagonal stripe pattern to background
- CSS: Create `.race-mode` class on body
  ```css
  body.race-mode::after {
    content: '';
    position: fixed;
    inset: 0;
    background: repeating-linear-gradient(
      -45deg,
      transparent,
      transparent 40px,
      rgba(196, 92, 74, 0.03) 40px,
      rgba(196, 92, 74, 0.03) 80px
    );
    pointer-events: none;
    z-index: 1;
    animation: race-drift 4s linear infinite;
  }
  @keyframes race-drift {
    from { transform: translateX(0); }
    to { transform: translateX(113px); } /* sqrt(2) * 80px ≈ 113 for seamless diagonal loop */
  }
  ```
- Toggle in render.js based on daily percentage < 90%
- Very subtle — subconscious caution tape, not alarm bells

### 5. Actionable Sparkline
- The sparkline in cycle history should tell a story
- Add break markers (vertical dashed lines at 9:00, 12:00, 2:30, 4:20)
- Color segments: green for cycles above target, red for below, gold for on-pace
- If using Chart.js canvas, use segment coloring plugin
- If CSS sparkline, use colored gradients per segment

### 6. Cycle History Views (3 cycleable views)
Users cycle through views via the existing nav buttons (‹ ›) in `.cycle-history-nav`.

**View 1: Timeline Strip** (`mode: 'timeline'`)
- Horizontal bar spanning full width
- Each cycle = colored block (green >105%, gold 90-105%, red <90%)
- Block width proportional to cycle duration
- On hover/tap: tooltip with lbs, rate, duration
- Break gaps shown as darker spacers
- Dead simple from 15 feet: lots of green = good day

**View 2: Stacked Rings** (`mode: 'rings'`)
- Concentric rings, most recent = outermost
- Each ring fill = % of target achieved (capped at 100% visual)
- Color = green/gold/red based on pace
- Render as SVG in the cycle content area
- Center text: total cycles count
- Minimal text, maximum visual impact — tree rings of productivity

**View 3: Bar Race** (`mode: 'bars'`)
- Vertical bars side by side, one per cycle
- Height = lbs produced (scaled to max)
- Horizontal target line drawn across
- Bars above line = green, below = red
- Current (active) cycle bar animates in real-time
- Labels: cycle number below each bar
- Classic factory chart, instantly readable

### Implementation in cycle-history.js
- Add these as modes alongside existing ones (list, compact, donut, sparkline, chips)
- Total modes: list, compact, donut, sparkline, chips, timeline, bars, rings
- The nav buttons already cycle through modes — just add to the array
- Each mode has a render function in cycle-history.js

## Files to Modify
1. **src/css/scoreboard-v2.css** — Font swap, density tightening, race mode, new cycle view styles
2. **src/js/scoreboard-v2/render.js** — Momentum arrow calculation + DOM update, race mode toggle
3. **src/js/scoreboard-v2/cycle-history.js** — Add 3 new view modes (timeline, rings, bars)
4. **src/pages/scoreboard-v2.html** — Add momentum arrow span, ensure Bebas Neue font loaded

## DO NOT
- Rewrite the entire CSS (additive changes only)
- Remove any existing functionality
- Change the cockpit layout structure
- Break the ambient color system (body.timer-green/yellow/red)
- Remove existing cycle history modes
- Touch main.js, api.js, timer.js, state.js, scale.js unless absolutely necessary

## Testing
- After changes, the scoreboard should still render correctly at both desktop and TV (3840×2160) sizes
- All existing cycle history modes should still work
- New views should be accessible via the ‹ › nav
- Momentum arrow should update on each render cycle
- Race mode should activate when daily % < 90 and deactivate above
