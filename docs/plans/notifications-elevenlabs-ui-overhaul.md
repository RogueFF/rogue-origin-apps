# Atlas Notifications — ElevenLabs TTS + UI Overhaul

## Overview
Replace Web Speech API with ElevenLabs for premium TTS on briefing notifications, and overhaul the panel UI to match Rogue Origin's dark luxury aesthetic.

## Part 1: ElevenLabs TTS

### API Details
- **Endpoint:** `https://api.elevenlabs.io/v1/text-to-speech/{voice_id}`
- **API Key:** Store in electron-store settings as `elevenLabsKey`
- **Method:** POST with `Content-Type: application/json`
- **Body:** `{"text": "...", "model_id": "eleven_turbo_v2_5", "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}}`
- **Response:** Audio stream (mp3). Pipe to a temp file or use as ArrayBuffer → Blob → Audio element.

### Voice Selection
- Use a good default voice. Hit `GET https://api.elevenlabs.io/v1/voices` with the API key to list available voices.
- Pick a clear, professional male or female voice. Store voice_id in settings.
- Add a voice picker dropdown in the settings panel (fetch voice list on open).

### Implementation (in toast.js)
```javascript
async function speakElevenLabs(text) {
  const settings = window.electronAPI.getSettings(); // or pass via IPC
  const apiKey = settings.elevenLabsKey;
  const voiceId = settings.elevenLabsVoice || 'default_voice_id';
  
  if (!apiKey) {
    // Fallback to Web Speech API
    return speakWebSpeech(text);
  }
  
  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 }
    })
  });
  
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.play();
  return audio; // for pause/stop control
}
```

### Briefing TTS Flow
When a briefing toast arrives with segments:
1. Concatenate segment texts with brief pauses: `"Production: 112.4 lbs, 120% of target. ... Weather: 45 degrees, clear skies."`
2. Call ElevenLabs once with the full concatenated text (cheaper than per-segment)
3. Play audio. Mute button pauses/resumes. Replay button re-fetches and plays.

### Settings Panel Additions
- `elevenLabsKey` — text input (masked)
- `elevenLabsVoice` — dropdown populated from API
- `ttsEnabled` — toggle (default: on for briefings, off for others)
- `ttsVolume` — slider

### Fallback
If no API key configured or request fails, fall back to Web Speech API silently. Log the error but don't break the notification.

---

## Part 2: UI Overhaul — Panel

The notification panel (panel.html + panel.css) needs to match the Rogue Origin premium aesthetic.

### Design Tokens
```css
:root {
  --bg-primary: #0a0c0b;
  --bg-card: #141816;
  --bg-card-hover: #1a1e1c;
  --border: #2a2e2c;
  --text-primary: #e8e4dc;
  --text-secondary: #8a8580;
  --text-muted: #5a5750;
  --gold: #e4aa4f;
  --green: #4a9e6b;
  --red: #c45c4a;
  --yellow: #d4a843;
  --font-display: 'Playfair Display', serif;
  --font-data: 'JetBrains Mono', monospace;
  --font-ui: 'Manrope', sans-serif;
  --radius: 12px;
  --radius-sm: 8px;
}
```

### Panel Layout
```
┌─────────────────────────────────────┐
│ ATLAS NOTIFICATIONS        [⚙] [×] │  ← Header: title left, settings + close right
│                                     │
│ ┌─────┬────────────┬──────┬───────┐ │
│ │ All │ Briefings  │Alerts│ Prod  │ │  ← Tab bar with unread counts
│ └─────┴────────────┴──────┴───────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ 🔔 Morning Brief          2m   │ │  ← Notification card
│ │ Production: 45.6 lbs, 87%...   │ │
│ │ Weather: 48°F, sunny            │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ 📊 Hourly Update          15m  │ │  ← Production card (expandable)
│ │ ┌──────┬──────┬──────┬───────┐  │ │
│ │ │45.6  │ 87%  │  8   │ 3.42  │  │ │  ← Stat grid
│ │ │lbs   │target│ crew │ rate  │  │ │
│ │ └──────┴──────┴──────┴───────┘  │ │
│ │ ▁▃▅▇▆▅▇█                       │ │  ← Mini sparkline
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ ⚠️ Low Rate Alert        1h    │ │  ← Alert (red accent, pulse)
│ │ Rate dropped below target       │ │
│ │                    [Acknowledge] │ │
│ └─────────────────────────────────┘ │
│                                     │
│ [Clear All]                         │  ← Bottom action
└─────────────────────────────────────┘
```

### Card Styles
- **Toast cards:** Simple — icon + title + body + timestamp. Subtle left border (2px gold).
- **Briefing cards:** Segments as stacked blocks with icon + label + text. Left border green.
- **Alert cards:** Red left border. Subtle pulse glow animation. Acknowledge button (gold).
- **Production cards:** Stat grid (2×2), mini CSS sparkline, progress bar. Green/gold/red based on paceStatus. Click to expand for full hourly breakdown.

### Animations
- Cards slide in from right on arrival
- Smooth height transition when expanding/collapsing production cards
- Gentle fade for card removal
- Alert pulse: `box-shadow` breathe animation, 2s cycle

### Typography
- Card titles: Manrope 600, 14px
- Card body: Manrope 400, 13px, --text-secondary
- Stat numbers: JetBrains Mono 600, 18px
- Stat labels: Manrope 300, 10px, uppercase, letterspaced
- Timestamps: JetBrains Mono 400, 11px, --text-muted

### Toast Window Styles (toast.css)
Same design tokens. Each toast type gets a distinct left-border color:
- toast: gold
- briefing: green
- alert: red (+ pulse glow)
- production/production-live: green if ahead, red if behind, gold if on-pace

Background: `--bg-card` with `backdrop-filter: blur(20px)` and subtle border.
Rounded corners (12px), drop shadow for floating effect.

### Settings Panel
Slide-in from right or modal overlay. Sections:
- **Connection:** Atlas host, port, API token
- **TTS:** ElevenLabs key, voice picker, volume, enable/disable
- **Notifications:** Sound on/off, auto-dismiss durations per type
- **Startup:** Launch on Windows boot toggle

### Fonts
Load from Google Fonts in both panel.html and toast.html:
```html
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=JetBrains+Mono:wght@400;500;600&family=Manrope:wght@300;400;500;600;700&display=swap" rel="stylesheet">
```

---

## Build Order
1. Add ElevenLabs TTS to toast.js (with Web Speech fallback)
2. Add settings fields for ElevenLabs (key, voice, volume, toggle) to main.js + panel
3. Overhaul panel.css with new design tokens
4. Overhaul panel.html structure (header, tabs, card templates)
5. Update panel.js rendering for new card layouts
6. Overhaul toast.css for premium floating cards
7. Test all notification types
8. Test TTS with ElevenLabs voice

## Files to Modify
- `src/renderer/panel.html` — new structure
- `src/renderer/panel.css` — complete restyle
- `src/renderer/panel.js` — new card renderers
- `src/renderer/toast.html` — add Google Fonts
- `src/renderer/toast.css` — premium card styles
- `src/renderer/toast.js` — ElevenLabs TTS integration
- `src/main/main.js` — settings fields for ElevenLabs
- `src/main/api-server.js` — add voice list proxy endpoint (avoid CORS)
