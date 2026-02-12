# Pass 3 Brief — Hologram Glitch Aesthetic

## Context
Passes 1-2 built the Glass Console foundation. It works and looks decent but feels too safe. This pass adds a BOLD new identity layer: **Hologram Glitch** — cards feel like intercepted transmissions from a satellite. The frosted glass stays as the base, but everything on top gets the hologram treatment.

## Location
All files in: `src/renderer/`
Modify: `panel.html`, `panel.css`, `panel.js`, `popup.html`, `popup.css`, `popup.js`, `card-renderer.js`
DO NOT touch: `src/main/`

## The Hologram Glitch Aesthetic

### Visual Language
- **Scan lines**: Subtle horizontal lines across cards (CSS repeating-linear-gradient, 1px lines every 3-4px, very low opacity ~0.03-0.05). Always present on all cards.
- **RGB color separation (chromatic aberration)**: Text has a very subtle red/blue shift on load. CSS text-shadow with offset red and cyan shadows (0.5px offset, low opacity). Only on titles and hero numbers — not body text.
- **Flicker-in effect**: Numbers and titles don't just appear — they flicker. CSS animation: opacity jumps between 0 and 1 rapidly 3-4 times over 0.3s, then settles. Like a signal locking on.
- **Transmission noise**: Occasional single-line horizontal glitch that sweeps across a card (a thin bright line, translateY animation, happens once on card load, 0.5s).
- **CRT glow**: Text has a subtle bloom — text-shadow with the text's own color at low opacity and slight blur. Makes text feel like it's emitting light.
- **Vignette**: Cards have a subtle darkening at edges (radial gradient overlay, very subtle).

### Color Palette Update
Keep the existing glass console colors but add:
- **Cyan accent**: #00f0ff (for data readouts, secondary accent alongside gold)
- **Hologram green**: #00ff88 (for "signal locked" / positive states — replaces the electric green)
- **Signal red**: #ff3344 (for alerts, warnings)
- Use cyan for timestamps, data labels, secondary info
- Gold stays for primary accents, titles
- The chromatic aberration uses red (#ff3344) and cyan (#00f0ff) offset shadows

### Typography Additions
- Add 'Space Mono' for a more terminal/transmission feel on data readouts (replace JetBrains Mono usage on stat values). Keep JetBrains Mono for timestamps.
- Import: `https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap`

## Card Redesigns

### Production Card — "Pulse Monitor"
COMPLETELY redesign. No more circular gauges. Instead:
- **Hero area chart**: The sparkline becomes a large SVG area chart (not tiny bars). Hourly data rendered as a smooth path with gradient fill below (green→transparent for ahead, red→transparent for behind). This is the visual centerpiece — takes up 60% of the card.
- **Floating stat overlays**: Key stats appear as small holographic labels floating above the chart:
  - Top-left: "93.3 LBS" (large, with flicker-in)
  - Top-right: "108.6%" (with pace color)
  - Bottom-left: "12 CREW" (smaller, cyan)
  - Bottom-right: "1.07 RATE" (smaller, cyan)
- **Pace indicator**: Instead of text "ahead" — a thin horizontal line at the target level on the chart. Hours above it glow green, below glow red.
- **Transmission timestamp**: "SIGNAL LOCKED • {time}" at the bottom in tiny cyan mono text

### Briefing Card — "Decoded Transmission"  
Redesign the layout:
- **Header**: "▶ INCOMING BRIEFING" with a pulsing dot (like recording). Title below in Outfit.
- **NO timeline dots or hero stat extraction**. Instead:
- **Segment layout**: Each segment is a "decoded message block":
  - Thin top border in segment color
  - Icon (SVG) + label in small caps, cyan
  - Body text appears with a subtle typewriter effect (CSS animation with steps)
  - Key numbers within the text get highlighted with the gold color and slight glow
- **Between segments**: A thin dashed line separator (like morse code: `– – – –`)
- **Footer**: "TRANSMISSION COMPLETE • 3 SEGMENTS" in tiny muted text

### Alert Card — "Red Alert"
- **Pulsing red border** (not just tint — the border itself pulses between red and dark)
- **"⚠ ALERT" header** in red with chromatic aberration cranked up (more offset)
- **Glitch effect on arrival**: The entire card briefly shifts left/right 2px with color separation (like a VHS tracking error), then stabilizes. 0.4s total.
- **Acknowledge button**: Styled as a terminal command: `[ ACKNOWLEDGE ]` with monospace font, border, on click it briefly flashes and changes to `[ CONFIRMED ]`

### Toast Card — "Signal"
- Clean and minimal — the lightest touch of hologram
- Small SVG icon + title + body
- Subtle scan lines
- Flicker-in on the title only
- "SIGNAL • {time}" timestamp format

## Popup Enhancements
- **On card materialize**: Add a brief horizontal scan line sweep (thin bright line moves top to bottom, 0.3s)
- **Progress bar**: Replace with a "signal strength" bar — instead of shrinking left to right, it's a series of small vertical bars (like cell signal) that turn off one by one. Or keep the glowing edge but add scan lines over it.
- **Popup heights**:
  - Toast: 140px
  - Briefing: 320px (for 3 segments — calculate dynamically if possible)
  - Alert: 170px
  - Production: 320px (area chart needs space)

## Panel Updates
- **Scan lines overlay on the entire panel** (full-height repeating gradient, very subtle)
- **Title change**: "ATLAS COMMAND" → "ATLAS RELAY" (feels more like a signal receiver)
- **Mission Control widgets**: Keep them but add the hologram treatment (scan lines, flicker-in on values)
- **Production HUD widget**: Should update when a production-card notification arrives (store last production data)

## Sound Design
Keep the Web Audio API sounds from Pass 2 but upgrade:
- Add a subtle "static crackle" layer under each sound (white noise burst, very short, very quiet)
- Alert sound: Add a low rumble undertone (60Hz sine, quiet, under the pings)
- Briefing: Add a "connection established" beep-boop before the chime

## TTS
- Keep ElevenLabs integration from Pass 2
- Add support for `tts_text` field in payload — if present, use that for TTS instead of stitching segments
- Fallback chain: tts_text → audio_url → segment stitching → body text → Web Speech

## Important
- ALL existing functionality must keep working (IPC, settings, tabs, filtering, acknowledge, audio playback)
- The hologram effects should be SUBTLE enough to not be distracting during daily use, but noticeable enough to make someone say "whoa" the first time they see it
- Performance matters — CSS-only effects where possible, minimize JS animation overhead
- Write COMPLETE files. No placeholders. Full file contents for every file you modify.

## Quality Bar
This should look like nothing else. When someone sees this notification app, they should immediately ask "what is that?" It's a conversation piece AND a functional tool. The hologram glitch layer is what makes it unforgettable.
