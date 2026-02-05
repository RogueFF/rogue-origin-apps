# Scale Display PWA - Design Document

**Date**: 2026-02-04
**Status**: Approved for Implementation
**Target Device**: Small Samsung tablet (7-10", landscape orientation)

## Purpose

Create a dedicated PWA tablet app that displays live scale weight and bag timer side-by-side in fullscreen landscape mode. This serves as a replacement display for the physical scale screen which isn't visible from the production floor.

## Use Case

- **Read-only display** - No controls, just shows live data
- **Mounted near scale** - Workers can see weight without viewing scale screen
- **Context-aware** - Also shows bag timer since scale is used for bag weighing
- **Bilingual** - EN/ES language toggle
- **Always-on** - Installed as PWA, runs fullscreen

## Architecture

### File Structure

**New Files:**
```
src/pages/scale-display.html          # Main PWA page
src/css/scale-display.css             # Minimal styling
src/js/scale-display/
  ├── main.js                         # Initialization & polling
  └── layout.js                       # Language toggle logic
```

**Reused Modules** (from scoreboard):
- `config.js` - API URLs and constants
- `state.js` - Shared state management
- `dom.js` - DOM element caching
- `i18n.js` - Bilingual translations
- `api.js` - Smart polling with version checking
- `scale.js` - Scale weight polling and rendering
- `timer.js` - Bag timer logic and display

### Layout Design

```
┌─────────────────────────────────────────────────┐
│  [EN/ES]                           Scale Display │ ← 50px header
├────────────────┬────────────────────────────────┤
│                │                                 │
│   SCALE        │        BAG TIMER                │
│   (circular    │        (circular                │
│    display)    │         display)                │
│                │                                 │
│   4.23 kg      │         12:45                   │
│   of 5.0 kg    │         remaining               │
│                │                                 │
└────────────────┴────────────────────────────────┘
    50% width         50% width
```

**Grid Layout:**
- 50/50 split using CSS Grid
- Circles: clamp(200px, 35vw, 280px) - responsive sizing
- Flexbox centering within each cell
- 100vh height, no scrolling

## Data Flow

### Scale Weight
- Polls `?action=scaleWeight` every 1 second
- Returns: `{ weight, targetWeight, percentComplete, isStale }`
- Color states:
  - Gray: filling (0-89%)
  - Yellow: near target (90-99%)
  - Green: at target (100%+)
  - Red: stale/disconnected

### Bag Timer
- Uses smart polling (version check every 5s)
- Full data fetch only when version changes
- Client-side countdown calculation
- Auto-subtracts scheduled breaks
- Color states:
  - Green: normal operation
  - Blue: paused or on break
  - Red: overtime (past target)

### Smart Polling
- `?action=version` check every 5 seconds (~50 bytes)
- Reduces API load by ~90%
- Full scoreboard data fetch only when version increments

## Styling

### Theme
**Dark theme** (scoreboard style):
- Background: `#1a1a1a`
- Better for screen longevity
- Higher contrast for distance viewing
- Matches floor TV aesthetic

### Responsive Breakpoints

**Small tablets (7-8", ≤800px):**
```css
--scale-circle-size: 180px;
--timer-circle-size: 180px;
.scale-value { font-size: 2.5rem; }
```

**Medium tablets (8-10", 800-1024px):**
```css
--scale-circle-size: 240px;
--timer-circle-size: 240px;
.scale-value { font-size: 3.5rem; }
```

**Large tablets (10"+, ≥1024px):**
```css
--scale-circle-size: 300px;
--timer-circle-size: 300px;
.scale-value { font-size: 4rem; }
```

### CSS Variables
```css
:root {
  --scale-circle-size: clamp(200px, 35vw, 280px);
  --timer-circle-size: clamp(200px, 35vw, 280px);
  --header-height: 50px;
}
```

## PWA Configuration

### Manifest Updates
```json
{
  "name": "Scale Display",
  "short_name": "Scale",
  "start_url": "/rogue-origin-apps/src/pages/scale-display.html",
  "display": "fullscreen",
  "orientation": "landscape",
  "theme_color": "#1a1a1a",
  "background_color": "#1a1a1a"
}
```

### Service Worker
- Add `scale-display.html` and `scale-display.css` to cache list
- Enables offline capability
- Shows last known data if connection drops

## Installation (Samsung Tablet)

1. Open Chrome/Samsung Internet
2. Navigate to: `https://rogueff.github.io/rogue-origin-apps/src/pages/scale-display.html`
3. Menu (⋮) → "Add to Home Screen" or "Install App"
4. App icon appears on home screen
5. Launch → opens in fullscreen landscape
6. Optional: Settings → Display → Keep screen on

## Deployment

**Process:**
```bash
git add .
git commit -m "Add scale display PWA for tablet"
git push
# GitHub Pages auto-deploys in ~1-2 min
```

**Testing Checklist:**
- [ ] Scale weight updates every 1 second
- [ ] Timer counts down smoothly
- [ ] Colors change correctly (scale fill, timer states)
- [ ] Language toggle works (EN/ES)
- [ ] Landscape orientation maintained
- [ ] Readable from 2-3 feet away
- [ ] No scrolling needed
- [ ] Works offline after first load

## Module Integration

### Initialization Sequence (main.js)
```javascript
1. DOM ready
2. Initialize i18n (language toggle)
3. Initialize State (shared state manager)
4. Initialize DOM (element caching)
5. Initialize Scale module → starts 1s polling
6. Initialize Timer module → starts 1s polling
7. Start smart polling (version check every 5s)
```

### Language Toggle
- Click toggles between 'en' and 'es'
- Saves to localStorage
- Calls `i18n.applyTranslations()` to update all `[data-i18n]` elements
- No page reload needed

## Technical Constraints

- **No build system** - Pure HTML/CSS/JS
- **Module pattern** - IIFE modules, no ES6 imports (for consistency with scoreboard)
- **Performance** - Lightweight, optimized for lower-end tablet hardware
- **Offline-first** - Must work without internet after initial cache
- **Touch-friendly** - Language toggle minimum 44x44px

## Benefits

✅ **Reuses proven code** - Scale and timer modules are battle-tested
✅ **Minimal new code** - Just layout and initialization
✅ **Consistent UX** - Matches scoreboard visual language
✅ **Optimized polling** - Smart version checking reduces API load
✅ **Responsive** - Adapts to different tablet sizes
✅ **Installable** - PWA for easy access and fullscreen mode

## Future Enhancements (Out of Scope)

- [ ] Rotation lock enforcement (CSS only, not JS)
- [ ] Wake lock API (keep screen always on)
- [ ] Haptic feedback on state changes
- [ ] Historical scale weight graph
- [ ] Configurable target weight

---

**Design Approved**: 2026-02-04
**Ready for Implementation**: Yes
