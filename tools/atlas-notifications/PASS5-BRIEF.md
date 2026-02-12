# Pass 5 Brief — Terrain/Topo Theme + Theme Switcher

## Context
The app currently has a "Glass Console" / "Hologram Glitch" theme (dark, cyan/gold, transmission aesthetic). This pass adds a completely different alternative theme: **"Terrain"** — inspired by topographic maps, land surveys, and the agricultural nature of Rogue Origin (a hemp farm in Southern Oregon).

ALSO: add a theme switcher in settings so the user can flip between "Relay" (current theme) and "Terrain" (new theme).

## Location
All files in: `src/renderer/`
Modify: `panel.html`, `panel.css`, `panel.js`, `popup.html`, `popup.css`, `popup.js`, `card-renderer.js`
You may also need to modify: `src/main/main.js` (to store theme preference in electron-store) and `src/main/preload.js` (to expose theme IPC)

## Theme Architecture

### How It Works
- ALL theme-specific styles go in CSS using a `[data-theme="relay"]` and `[data-theme="terrain"]` attribute on the `<body>` tag
- The theme preference is stored in electron-store (like other settings)
- On app load, the saved theme is applied to `<body>`
- Theme switch in settings immediately updates `<body>` attribute — instant preview
- Both themes share the same HTML structure and JS logic — only CSS changes
- CSS variables (`:root` level) get overridden per theme

### IPC Additions Needed
Add to preload.js:
- `window.atlas.getTheme()` → returns string ('relay' | 'terrain')
- `window.atlas.setTheme(theme)` → saves to electron-store

Add to main.js:
- IPC handlers for get-theme / set-theme
- Store default: `theme: 'relay'`

## The Terrain Theme

### Aesthetic Direction
Think: USGS topographic maps meets modern data visualization. Contour lines. Earth tones. The feeling of surveying land from above. Paper texture. Hand-drawn quality mixed with precision data. This is for a farming operation — the land IS the business.

### Color Palette
```css
[data-theme="terrain"] {
  --bg-void: #1a1812;          /* Dark warm earth */
  --bg-primary: #211f17;       /* Slightly lighter earth */
  --bg-card: #2a2720;          /* Card background — warm dark */
  --bg-card-hover: #332f26;    /* Hover state */
  --bg-elevated: #3a352b;      /* Elevated surfaces */
  --border: rgba(196, 164, 106, 0.12);  /* Warm gold border */
  --border-hover: rgba(196, 164, 106, 0.25);
  
  --text-primary: #e8dcc8;     /* Warm cream */
  --text-secondary: #b8a88c;   /* Muted warm */
  --text-muted: #7a6e58;       /* Dim earth */
  
  --accent-primary: #c4a46a;   /* Warm gold / parchment */
  --accent-green: #6b9e5a;     /* Forest green (natural, not electric) */
  --accent-red: #c45a3e;       /* Terra cotta red */
  --accent-blue: #5a8a9e;      /* Slate blue / river */
  
  --topo-line: rgba(196, 164, 106, 0.08);  /* Contour line color */
}
```

### Typography
- Display: 'DM Serif Display' (elegant serif — feels cartographic)
- Data: 'IBM Plex Mono' (technical but warm)
- Body: 'Source Sans 3' (clean, readable)
- Import these fonts in panel.html (conditionally or always loaded)
- Add: `https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=IBM+Plex+Mono:wght@400;500;600&family=Source+Sans+3:wght@300;400;500;600&display=swap`

### Background Treatment
Instead of the dark void + particles:
- **Contour lines**: CSS-generated topographic contour pattern as the panel background
- Use repeating SVG or CSS gradients to create concentric contour-like lines
- Very subtle, warm gold on dark earth
- They should feel like a topo map you're looking at from above
- NO animation on the contour lines — they're static like a printed map

### Card Design
- Cards have a subtle **paper texture** feel (very light noise overlay, warm-toned)
- Borders: thin, warm gold, slightly more visible than the relay theme
- Left accent bar: thicker (4px), uses earth tones:
  - Toast: warm gold (#c4a46a)
  - Briefing: forest green (#6b9e5a)  
  - Alert: terra cotta (#c45a3e)
  - Production: slate blue (#5a8a9e)
- Card hover: warm background shift, no glow effects
- NO scan lines, NO chromatic aberration, NO flicker effects
- Cards fade in simply (opacity 0→1, 0.3s) — no blur/scale materialize

### Production Card — Terrain View
THIS IS THE SIGNATURE PIECE. Instead of the pulse monitor area chart:
- **Topographic elevation visualization**: The hourly data is rendered as a terrain cross-section
- Imagine looking at a mountain range from the side — each hour's output creates a "peak"
- The fill below uses gradient layers like topo map elevation bands:
  - Below target: brown/earth tones
  - At target: green band
  - Above target: gold/summit tone
- **Contour lines** overlaid on the terrain at regular intervals (every 2 lbs or so)
- Target line shown as a **dashed "trail" line** — like a hiking path across the terrain
- Stats overlaid in the corners like map legend annotations:
  - "ELEVATION: 93.3 lbs" (top-left, serif font)
  - "SUMMIT: 108.6%" (top-right)
  - "PARTY: 12" (bottom-left, as in hiking party = crew)
  - "PACE: 1.07" (bottom-right)
- Footer: "SURVEY COMPLETE • {time}" in small mono text (instead of SIGNAL LOCKED)

### Briefing Card — Field Report
Instead of "INCOMING BRIEFING":
- Header: "📋 FIELD REPORT" in serif display font
- Segments styled as report entries with a left margin line (like a lined notebook)
- Each segment: small caps label in gold, body text in warm cream
- Separator: thin horizontal rule (not dashed morse code)
- Footer: "END OF REPORT • 3 ENTRIES"

### Alert Card — Warning Post
- Left bar: thick terra cotta
- Header: "⚡ WARNING" in serif, terra cotta color
- Body text on slightly warmer background
- Acknowledge button: outlined, warm gold, serif font: `[ ACKNOWLEDGED ]`
- NO pulse animation — alerts are calm but clearly colored

### Toast Card — Trail Marker
- Simple, warm, minimal
- Small warm gold dot before the title (like a trail marker on a map)
- Footer: "MARKER • {time}"

### Mission Control — "Base Camp"
- Header changes to "BASE CAMP" with a compass/mountain icon
- Same widget layout but with terrain styling
- Atlas Link → "COMMS LINK"
- Production widget → "YIELD MONITOR"  
- Weather → "CONDITIONS"
- Shipments → "SUPPLY CHAIN"

### Panel Header
- "ATLAS" stays but subtitle changes from "RELAY" to "SURVEY"
- The hexagonal icon could shift to a mountain/terrain icon for this theme

## Theme Switcher in Settings

Add a new section at the TOP of settings (before Connection):

```
APPEARANCE
┌────────────────────────────┐
│  Theme                     │
│  [Relay ◉] [Terrain ○]    │
└────────────────────────────┘
```

- Two radio-style buttons, side by side
- Selecting one immediately switches the theme (no save required — instant preview)
- Theme choice is still saved with the rest of settings on "Save & Close"
- The settings panel itself should also respect the current theme

## Important Rules
1. ALL existing functionality must keep working in BOTH themes
2. The relay theme should look EXACTLY the same as it does now — don't break it
3. Theme CSS should be cleanly separated — use `[data-theme="terrain"]` selectors
4. Both popup.html and panel.html need theme support
5. The production terrain visualization should use SVG (like the pulse monitor does)
6. Keep the existing IPC API — only ADD new handlers for theme
7. Sounds stay the same regardless of theme (for now)
8. TTS stays the same regardless of theme

## Write COMPLETE files. No placeholders. Every file you touch, write in full.

## Quality Bar
The Terrain theme should feel like opening a beautifully designed field survey tool. Warm. Grounded. Connected to the land. The polar opposite of the cold, technical Relay theme — but equally premium. When you switch between them, it should feel like two completely different $50M apps.
