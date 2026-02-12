# Pass 1 Brief — Glass Console Redesign

## What This Is
Atlas Notifications is an Electron tray app for Windows. It receives notifications from Atlas (an AI assistant) and displays them as popup toast cards + a panel with history.

## The Ask
Complete visual overhaul with a "Glass Console" aesthetic + Mission Control widgets. Everything in one pass — UI, animations, sounds, widgets, TTS integration.

## Files You Can Modify
All in `src/renderer/`:
- `panel.html` — Main panel structure
- `panel.css` — All styles
- `panel.js` — Panel logic
- `popup.html` — Popup window
- `popup.css` — Popup styles  
- `popup.js` — Popup logic + TTS
- `card-renderer.js` — Shared card rendering

DO NOT touch: `src/main/` (main.js, api-server.js, preload.js)

## Design Direction: Glass Console

**Vibe:** Frosted glass panels floating over a dark void. Sci-fi command console, not generic glassmorphism. Premium. Surprising. Something that makes you go "holy shit."

**Typography:**
- Display: 'Outfit' (add to font imports) — titles, widget headers
- Data: 'JetBrains Mono' (already loaded) — numbers, timestamps
- Body: 'Manrope' (already loaded) — descriptions

**Colors (CSS vars):**
- Void: #030504
- Glass: rgba(255,255,255, 0.03-0.06)
- Glass border: rgba(255,255,255, 0.06-0.08)
- Gold: #e4aa4f
- Green: #3dd68c (electric)
- Red: #ef4444 (vivid)
- Text: #f0ece4
- Muted: #7a776f

**Card Animations — materialize (NOT slide-in):**
Cards blur-in from nothing — opacity 0 + blur(12px) + scale(0.95) → full clarity. 0.4s ease.

**Alert cards:** Red glass tint + breathing red glow pulse + subtle shake on arrival.

**Production cards:** Replace static number grid with animated SVG ring gauges. Each stat (lbs, target%, crew, rate) is a small circular gauge with the number centered. Rings animate fill on load. Color by pace status.

**Briefing cards:** Typewriter CSS effect on body text.

**Popup progress bar:** Replace the bottom bar with a glowing edge that fades from gold → transparent.

**Sound design (Web Audio API, no files):**
- Toast: soft click (800Hz sine, 50ms)
- Briefing: warm chime (C5+E5, 100ms each)
- Alert: urgent double-ping (1200Hz, two pings, 60ms gap)
- Production: low hum (200Hz, 150ms)
- Respect soundEnabled setting from electron-store

**Mission Control Widgets:**
Add a collapsible widget area ABOVE the notification feed in the panel. Glass card grid. Toggleable widgets:
1. **Atlas Status** — connection dot, uptime, last message time
2. **Production HUD** — live stats from last production-card notification (lbs, rate, pace)
3. **Weather** — placeholder that accepts weather data via API
4. **Shipment Tracker** — placeholder for active shipment status

Each widget is a small frosted glass card. The widget area has a thin header with "MISSION CONTROL" label and a collapse/expand toggle. Widgets should be reorderable later but don't need drag-drop now.

**TTS:**
- The TTS plumbing already exists in popup.js (speakNotification, audio_url, Web Speech fallback)
- ElevenLabs settings are in the panel settings
- Make sure `tts: true` flag in notification payload triggers speech
- Add: when a notification has `tts: true` but no `audio_url`, use Web Speech API to read the body
- The countdown timer pauses during TTS playback (already coded, verify it works)

## Existing IPC API (don't change these)
```
window.atlas.onShowPopup(callback)
window.atlas.onDismissPopup(callback)
window.atlas.popupDismiss()
window.atlas.popupClicked(id)
window.atlas.popupAcknowledge(id)
window.atlas.getNotifications()
window.atlas.markRead(id)
window.atlas.markAllRead()
window.atlas.clearAll()
window.atlas.closePanel()
window.atlas.checkAtlasStatus()
window.atlas.onNewNotification(callback)
window.atlas.onRefresh(callback)
window.atlas.getSettings() / setSettings()
window.atlas.getTtsConfig() / setTtsConfig()
window.atlas.getVoices()
window.atlas.acknowledgeAlert(id)
window.atlas.getUnreadCount()
```

## Notification Types & Data Shapes
```json
// Toast
{ "type": "toast", "title": "...", "body": "..." }

// Briefing
{ "type": "briefing", "title": "...", "body": "...", "tts": true,
  "data": { "segments": [{ "icon": "🌤️", "label": "Weather", "text": "..." }] } }

// Alert
{ "type": "alert", "title": "...", "body": "...", "priority": "high" }

// Production Card
{ "type": "production-card", "title": "...",
  "data": { "dailyTotal": 93.3, "percentOfTarget": 108.6, "trimmers": 12, "rate": 1.07,
            "paceStatus": "ahead", "hourly": [{ "actual": 14.3, "target": 0.98 }] } }
```

## Quality Bar
This is for a company founder. It should feel like a $50M startup's internal tool. Not a side project. Not generic. Genuinely surprising and beautiful.

Write COMPLETE files — no placeholders, no "...rest unchanged". Every file you touch, write in full.
