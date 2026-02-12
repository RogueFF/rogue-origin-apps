# Pass 4 Brief — Atlas's Vision

## Context
Passes 1-3 built the Glass Console + Hologram Glitch foundation. The production pulse monitor card is the standout. The transmission language (ATLAS RELAY, SIGNAL LOCKED, INCOMING BRIEFING) gives the app identity. This pass is about making it FEEL alive and fixing what's broken.

## Location
All files in: `src/renderer/`
Modify: `panel.html`, `panel.css`, `panel.js`, `popup.html`, `popup.css`, `popup.js`, `card-renderer.js`
DO NOT touch: `src/main/`

## Priority Fixes

### 1. Briefing Card — Compact & Expandable
The briefing popup gets cut off with 3 segments. REDESIGN the briefing to be compact:
- **Collapsed state (default in popup):** Title + one-line summary per segment. Like: `📊 Production: 93.3 lbs, 108.6% ✓` / `🌤 Weather: 45°F, clear` / `🚚 Shipment: SF → Switzerland, Feb 25`
- Each segment is ONE LINE with icon + label + condensed info
- NO big headers, NO dashed separators, NO multi-line body text in popup
- **Expanded state (in panel on click):** Full segment details expand below each line
- This way 5+ segments fit in a popup easily
- Keep "▶ INCOMING BRIEFING" header and recording dot — that works
- Footer: "TRANSMISSION COMPLETE • 3 SEGMENTS"
- The popup height for briefings can now be 200px (compact lines fit)

### 2. Toast — Give It Character
Toast is the most common notification and it's boring. Add:
- A subtle horizontal gradient sweep on load (like a scanner beam passing over the card, left to right, 0.5s, translucent white line)
- The "SIGNAL • timestamp" footer already works — keep it
- Add a very subtle left-border pulse on arrival (gold, fades over 2s)

### 3. Scan Lines — Crank It or Cut It
The hologram scan lines are invisible at screen resolution. Options:
- Increase scan line opacity to 0.06-0.08 (from 0.03)
- Make scan lines thicker (2px lines every 4px gap)
- OR add a scan line ANIMATION — lines slowly scroll upward (like a CRT), 20s loop. This makes them noticeable without being harsh.
- Pick whichever looks best. The effect should be visible but not distracting.

## New Features

### 4. Breathing Cards
All cards in the panel have a slow ambient background animation:
- CSS: background gradient that shifts hue very slightly over 10 seconds
- Or: a subtle opacity oscillation on the card's inner glow (0.03 → 0.06 → 0.03, 8s cycle)
- Should be barely perceptible — you notice the panel feels "alive" without knowing why
- Use CSS animation, no JS needed

### 5. Ghost Trail Dismiss
When a popup dismisses, instead of just sliding out:
- Create a brief afterimage effect
- The card drops to 30% opacity with a slight blur increase
- Then a clone/pseudo-element stays for 0.4s at 15% opacity before fading
- Like a hologram powering down
- CSS only — use the `.popup-dismissing` class that already exists

### 6. Contextual Card Expansion (Panel)
In the panel notification list, cards start COMPACT:
- Production card collapsed: One line: `93.3 lbs • 108.6% • 12 crew • 1.07 rate — ahead` with pace color
- On click/hover: expands to show the full area chart + sparkline
- Briefing collapsed: Title + segment count (`Evening Briefing — Feb 11 • 3 segments`)
- On click: expands to show all segment details
- Alert and toast stay as-is (they're already compact)
- Use CSS max-height transition for smooth expand/collapse
- This makes the panel MUCH more scannable — you see 8-10 notifications at a glance instead of 3

### 7. Particle Dust Background
In the panel (not popups), add floating particles:
- 15-20 tiny dots (1-2px), very low opacity (0.1-0.15)
- Drift slowly upward at slightly different speeds
- CSS animation with different animation-duration per particle (15-30s range)
- Particles are absolute-positioned spans in a container behind the notification list
- Creates depth, makes the void feel like space
- Panel only — don't add to popups

### 8. Ambient Sound (Panel)
When the panel is opened (shown):
- Start playing a very quiet ambient hum
- Use Web Audio API: low sine wave (55Hz) + filtered white noise, combined volume ~0.02
- Fade in over 1s, fade out over 0.5s when panel hides
- Respect the soundEnabled setting
- Add this to panel.js
- Should feel like standing on a ship bridge — subconscious atmosphere

## Sound Design Upgrade
The current Web Audio API synth beeps are too simple. Layer them:
- **Toast:** Short sine click (800Hz, 30ms) + a quieter high harmonic (1600Hz, 20ms) + tiny noise burst (10ms)
- **Briefing:** Two-note ascending (C5→E5) with each note having a subtle reverb tail (use delay node, 100ms delay, 0.3 feedback)
- **Alert:** Keep the urgency but add body. Low undertone (80Hz, 200ms) under the pings. The pings themselves should use triangle wave instead of sine (harsher, more attention-grabbing).
- **Production:** Warm chord instead of single hum. 200Hz + 250Hz + 300Hz, each at 1/3 volume, 200ms, gentle fade. Like a system coming online.

## Design Continuity
- Keep ALL the hologram glitch aesthetic from Pass 3
- Keep the transmission language (SIGNAL LOCKED, INCOMING BRIEFING, ATLAS RELAY)
- Keep the cyan/gold/green color system
- Keep the production pulse monitor area chart (it's the best thing we've built)
- Keep Mission Control widgets
- Keep SVG icons (no stock emojis)
- Keep ElevenLabs TTS integration (now using eleven_multilingual_v2)

## IPC API (unchanged)
Same as previous passes — don't modify the preload bridge.

## Notification Payloads
Same shapes as Pass 3. The briefing compact view needs to extract a summary from each segment text. Parse intelligently:
- Look for numbers, percentages, temperatures
- If segment text has a number, feature it prominently in the compact line
- Example: "93.3 lbs tops — 108.6% of target. Best hour: 7-8 AM at 1.25 rate." → "93.3 lbs, 108.6%"
- Example: "Grants Pass: 45°F, clear skies. Low tonight: 32°F." → "45°F, clear"
- Example: "TIVE AWB 724-87055931 in San Francisco. ETA Switzerland Feb 25." → "San Francisco → Switzerland, Feb 25"

## Write COMPLETE files. No placeholders. Full contents for every file you touch.

## Quality Bar
When you open this panel, it should feel like stepping onto the bridge of a starship. Quiet hum. Particles floating. Cards breathing. Data glowing. It's not just an app — it's an experience.
