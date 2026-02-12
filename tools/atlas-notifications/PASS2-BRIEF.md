# Pass 2 Brief — Glass Console Refinement + Premium Polish

## Context
Pass 1 built the Glass Console foundation. It's working but needs refinement. You have FULL creative freedom to improve, rethink, or rebuild any component. Don't just fix bugs — make it genuinely surprising and premium.

## Location
All files in: `src/renderer/`
Files to modify: `panel.html`, `panel.css`, `panel.js`, `popup.html`, `popup.css`, `popup.js`, `card-renderer.js`
DO NOT touch: `src/main/` (main.js, api-server.js, preload.js)

## Critical Fixes

### 1. Gauge Ring Fill Math (production card)
The SVG circular gauges have wrong fill calculations:
- TARGET shows 108.6% but ring is barely 1/4 filled. 100% should be full ring, >100% should overflow or show full+glow
- RATE shows 1.07 but ring barely filled. Rate max should be ~2.0 (so 1.07 ≈ 53% fill)
- LBS: max should be based on target (e.g., if target is 86 lbs, then 93.3/86 ≈ 108% fill)
- CREW: max should be ~20 (so 12/20 = 60% fill)

### 2. Briefing Popup Height
Briefing popups get cut off — the shipment segment wasn't visible. The popup height calculation needs to account for the number of segments. Either:
- Calculate dynamically based on content
- Set briefing popup taller (280px+ for 3 segments)

### 3. Replace ALL Stock Emojis with Custom SVG Icons
No more ⚠️ or 📊 or 🌤️ or 🚚. Replace every emoji in the card renderer with clean, monoline SVG icons that match the Glass Console aesthetic. Examples:
- Alert: triangular warning icon (monoline, matches red accent)
- Production segments: chart/bar icon
- Weather: sun/cloud icon
- Shipment: route/truck icon
- Briefing default: pin/dot icon

Use inline SVG in the card-renderer.js. Keep them small (14-16px), single color (currentColor or the accent color for that card type).

### 4. Sparkline Bar Gaps
Too much space between sparkline bars. Tighten the gap.

## Premium Briefing Card Redesign

The current briefing card is just stacked text blocks — functional but boring. Redesign it to be premium:

**"Intel Brief" concept:** Each segment is smarter than just a label + text block. The layout should feel like a command center intelligence report.

Ideas (pick the best approach or combine):
- **Hero stat extraction**: Pull the most important number/metric from each segment text and display it large. Supporting text stays small.
- **Timeline layout**: Thin vertical line connecting segments, each segment branches off with its icon as a node on the line. Gives visual flow and hierarchy.
- **Grid metrics**: Top section has 2-3 key metrics in big number boxes. Below: condensed supporting context.
- **Segment cards**: Each segment is its own mini glass card with subtle depth variation.

The briefing should feel like the most premium card type — it's the one Koa sees most often (morning/evening briefings from Atlas).

## TTS — Client-Side ElevenLabs Integration

Currently when `tts: true` is set without `audio_url`, it falls back to Windows Web Speech API (sounds bad). Fix:

In `popup.js` `speakNotification()`:
1. Check if ElevenLabs key + voice are configured (via IPC `getTtsConfig`)
2. If configured: call ElevenLabs API directly from renderer:
   - POST to `https://api.elevenlabs.io/v1/text-to-speech/{voice_id}`
   - Headers: `xi-api-key: {key}`, `Content-Type: application/json`
   - Body: `{ "text": "...", "model_id": "eleven_turbo_v2" }`
   - Response is audio/mpeg — create a Blob URL and play via Audio()
3. If not configured: fall back to Web Speech API as current
4. Build the text from segments if available, otherwise use body

NOTE: panel.html CSP already allows `connect-src https://api.elevenlabs.io` and `media-src https: http:`
For popup.html, add the same CSP: `connect-src https://api.elevenlabs.io; media-src https: http: blob:`

## Popup Duration Tuning
- Toast: 10s (was 8s, too short)  
- Briefing: 15s (was 10s — needs time to read segments)
- Alert: 20s (was 15s)
- Production: 12s (was 10s)

## Sound Design
Pass 1 added Web Audio API sounds. Review and improve if needed:
- Make sure they actually play (test the AudioContext creation)
- Sounds should feel premium, not cheap. Layered tones > single frequency beeps
- Alert sound should feel genuinely urgent

## Mission Control Widgets
Pass 1 added the structure. Make sure:
- The Atlas Status widget actually works (shows connected/offline, uptime)
- The collapse/expand toggle works
- Widget area has a clean "MISSION CONTROL" header with monoline icon

## Design Rules
- Glass Console aesthetic throughout — frosted glass, depth, translucency
- NO stock emojis anywhere — all custom SVG
- Typography: Outfit (display), JetBrains Mono (data), Manrope (body)
- Colors: dark void, glass layers, gold/green/red accents
- Animations: materialize (blur-in), not slide-in
- Quality bar: $50M startup internal tool

## IPC API (unchanged)
```
window.atlas.onShowPopup(callback)
window.atlas.onDismissPopup(callback)  
window.atlas.popupDismiss()
window.atlas.popupClicked(id)
window.atlas.popupAcknowledge(id)
window.atlas.getNotifications()
window.atlas.markRead(id)
window.atlas.clearAll()
window.atlas.closePanel()
window.atlas.checkAtlasStatus()
window.atlas.onNewNotification(callback)
window.atlas.onRefresh(callback)
window.atlas.getSettings() / setSettings()
window.atlas.getTtsConfig() / setTtsConfig()
window.atlas.getVoices()
window.atlas.acknowledgeAlert(id)
```

## Notification Payload Shapes
```json
{"type":"toast","title":"...","body":"..."}

{"type":"briefing","title":"...","tts":true,
 "data":{"segments":[{"icon":"chart","label":"Production","text":"93.3 lbs tops..."}]}}

{"type":"alert","title":"...","body":"...","priority":"high"}

{"type":"production-card","title":"...",
 "data":{"dailyTotal":93.3,"percentOfTarget":108.6,"trimmers":12,"rate":1.07,
          "paceStatus":"ahead","hourly":[{"actual":14.3,"target":0.98}]}}
```

Note: segment icons are now STRING KEYS (not emojis). Map them to SVG in the renderer:
- "chart" / "production" → bar chart icon
- "weather" / "sun" / "cloud" → weather icon  
- "shipment" / "truck" / "route" → shipment icon
- "pin" / "update" → default pin icon
- "alert" / "warning" → warning triangle icon

Write COMPLETE files. No placeholders. No "...rest stays the same". Full file contents for every file you touch.
