# Atlas Notifications — Panel UI Overhaul + Settings

## Philosophy
This isn't a notification center. It's a **command bridge**. Atlas is Koa's AI operations partner — the panel should feel like looking into the mind of something alive. Dark, premium, atmospheric. Think: a luxury car's instrument cluster meets a sci-fi ship's comm panel.

## Design System

### Tokens
```css
:root {
  --bg-void: #060807;
  --bg-primary: #0a0c0b;
  --bg-card: #111413;
  --bg-card-hover: #171b19;
  --bg-card-unread: #12150f;
  --bg-elevated: #1a1e1c;
  --border: rgba(228, 170, 79, 0.08);
  --border-hover: rgba(228, 170, 79, 0.15);
  --cream: #e8e4dc;
  --cream-secondary: #a8a49c;
  --cream-muted: #6a665e;
  --gold: #e4aa4f;
  --gold-dim: rgba(228, 170, 79, 0.6);
  --gold-glow: rgba(228, 170, 79, 0.12);
  --green: #4a9e6b;
  --green-glow: rgba(74, 158, 107, 0.12);
  --red: #c45c4a;
  --red-glow: rgba(196, 92, 74, 0.12);
  --yellow: #d4a843;
  --font-display: 'Playfair Display', serif;
  --font-data: 'JetBrains Mono', monospace;
  --font-ui: 'Manrope', sans-serif;
  --radius: 12px;
  --radius-sm: 8px;
  --radius-xs: 4px;
}
```

### Fonts
```html
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=JetBrains+Mono:wght@400;500;600&family=Manrope:wght@300;400;500;600;700&display=swap" rel="stylesheet">
```

## Panel Layout (panel.html)

```
┌─────────────────────────────────────────────────┐
│ ▋ ATLAS                     ⚡connected  ⚙  ─  │  ← Titlebar: draggable, glass effect
│─────────────────────────────────────────────────│
│ ┌─────┬──────────┬────────┬──────┬────────────┐ │
│ │ All │ Briefings│ Alerts │ Prod │   Updates  │ │  ← Tabs: pill-shaped, gold active
│ └─────┴──────────┴────────┴──────┴────────────┘ │
│                                                  │
│ ┌──────────────────────────────────────────────┐ │
│ │ ▋ Late Night News Brief              2m ago  │ │  ← Briefing card
│ │                                              │ │
│ │  ⚖️ Politics                                 │ │     Segments as stacked blocks
│ │  Grand jury rebuffs DOJ attempt...           │ │
│ │                                              │ │
│ │  🗳️ Elections                                │ │
│ │  FBI cited debunked claims...                │ │
│ │                                              │ │
│ │  🔧 Atlas Update                             │ │
│ │  Scoreboard V2 Pass 7 shipped...             │ │
│ │                                              │ │
│ │  [🔊 Replay]  [🔇 Mute]              ▋green │ │  ← Audio controls + type accent
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ ┌──────────────────────────────────────────────┐ │
│ │ ▋ Hourly Production                  15m ago │ │  ← Production card
│ │ ┌──────────┬──────────┬──────────┬─────────┐ │ │
│ │ │  45.6    │   87%    │    8     │  3.42   │ │ │     Stat grid (2×2)
│ │ │  lbs     │  target  │   crew   │  rate   │ │ │
│ │ └──────────┴──────────┴──────────┴─────────┘ │ │
│ │  ▁▃▅▇▆▅▇█  on pace                   ▋gold  │ │  ← Mini sparkline + status
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ ┌──────────────────────────────────────────────┐ │
│ │ ▋ ⚠️ Low Rate Alert                  1h ago │ │  ← Alert card (red accent, pulse)
│ │  Rate dropped below target threshold         │ │
│ │                          [Acknowledge]   ▋red│ │  ← Gold ack button
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ ┌──────────────────────────────────────────────┐ │
│ │ ▋ Scoreboard V2 Pass 7 shipped       5m ago │ │  ← Toast card (simple)
│ │  Momentum arrows, race mode, 3 new views     │ │
│ │                                       ▋gold  │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ [Clear All]                     3 notifications  │  ← Bottom bar
└─────────────────────────────────────────────────┘
```

## Settings Panel (slide-in overlay)

When ⚙ is clicked, a panel slides in from the right over the notification list:

```
┌─────────────────────────────────────────────────┐
│ ← Settings                                      │
│─────────────────────────────────────────────────│
│                                                  │
│ CONNECTION                                       │
│ ┌──────────────────────────────────────────────┐ │
│ │ Atlas Host     [100.117.199.40            ]  │ │
│ │ Port           [9400                      ]  │ │
│ │ API Token      [••••••••••••••            ]  │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ TEXT-TO-SPEECH                                    │
│ ┌──────────────────────────────────────────────┐ │
│ │ ElevenLabs Key [••••••••••••••            ]  │ │
│ │ Voice          [▼ Select voice...         ]  │ │
│ │ Volume         [━━━━━━━●━━━━ 80%         ]  │ │
│ │ TTS Enabled    [●━━━ ON                  ]  │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ NOTIFICATIONS                                    │
│ ┌──────────────────────────────────────────────┐ │
│ │ Sound          [●━━━ ON                  ]  │ │
│ │ Auto-start     [●━━━ ON                  ]  │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ [Save & Close]                                   │
└─────────────────────────────────────────────────┘
```

## Card Design Details

### Common Card Structure
- Left accent bar (3px, full height, type-colored)
- Header: icon + title (Manrope 600, 13px) + timestamp (JetBrains Mono 400, 11px, muted)
- Body: Manrope 400, 13px, cream-secondary
- Subtle border (1px, gold 8% opacity)
- Hover: border brightens to 15%, card bg shifts
- Unread: slightly warmer background tint
- Click to mark as read

### Type-Specific Accents
- **toast** → gold accent bar
- **briefing** → green accent bar, segment blocks with icon+label+text
- **alert** → red accent bar, pulse glow animation (box-shadow breathe, 2s), Acknowledge button
- **production/production-live** → dynamic color based on paceStatus: green (ahead), gold (on-pace), red (behind). Stat grid with big numbers.

### Briefing Card Extras
- Segments rendered as stacked blocks with subtle separator lines
- Each segment: icon (16px) + label (Manrope 600, 11px, uppercase, gold) + text (13px, cream-secondary)
- Audio controls at bottom: Replay button, Mute button (both small, ghost-style)
- If TTS is playing, show animated sound wave indicator

### Production Card Extras
- 2×2 stat grid: big number (JetBrains Mono 600, 20px) + label below (Manrope 300, 10px, uppercase)
- Stats: lbs, target %, crew count, rate
- Mini sparkline bar (CSS, 8px tall, colored segments)
- Pace status text: "ahead" / "on pace" / "behind"

### Alert Card Extras
- Subtle red glow pulse animation on the card border
- "Acknowledge" button: gold outline, small, bottom-right
- Once acknowledged: glow stops, card dims slightly

## Animations
- Cards slide in from right on arrival (translateX(20px) → 0, 300ms ease-out)
- Card removal: fade + slide left (opacity 0, translateX(-20px), 200ms)
- Settings panel: slide from right (translateX(100%) → 0, 250ms ease-out)
- Alert pulse: box-shadow breathe with red-glow, 2s infinite
- Tab switch: smooth indicator slide
- Scroll: custom thin scrollbar (6px, gold-dim track)

## Atmospheric Effects
- Subtle noise texture overlay on background (same as scoreboard)
- Very faint radial gradient from center (dark green tint, 3% opacity)
- Glass-morphism on titlebar (backdrop-filter: blur(20px), semi-transparent bg)

## IPC Integration

### Existing IPC (from preload.js)
```javascript
window.atlas = {
  getNotifications: () => ipcRenderer.invoke('get-notifications'),
  clearNotifications: () => ipcRenderer.invoke('clear-notifications'),
  markRead: (id) => ipcRenderer.invoke('mark-read', id),
  getStatus: () => ipcRenderer.invoke('get-status'),
  onNotification: (cb) => ipcRenderer.on('new-notification', (_, data) => cb(data)),
  closePanel: () => ipcRenderer.send('close-panel')
}
```

### New IPC Needed (add to preload.js + main.js)
```javascript
// Settings
getSettings: () => ipcRenderer.invoke('get-settings'),
setSettings: (settings) => ipcRenderer.invoke('set-settings', settings),

// TTS
getTtsConfig: () => ipcRenderer.invoke('get-tts-config'),
setTtsConfig: (config) => ipcRenderer.invoke('set-tts-config', config),
getVoices: () => ipcRenderer.invoke('get-voices'), // proxy to ElevenLabs API

// Acknowledge alert
acknowledgeAlert: (id) => ipcRenderer.invoke('acknowledge-alert', id),
```

### main.js IPC Handlers to Add
```javascript
ipcMain.handle('get-settings', () => ({
  atlasHost: store.get('atlasHost'),
  port: store.get('port'),
  apiToken: store.get('apiToken', ''),
  soundEnabled: store.get('soundEnabled'),
  autoStart: store.get('autoStart')
}));

ipcMain.handle('set-settings', (_, settings) => {
  Object.entries(settings).forEach(([k, v]) => store.set(k, v));
  return true;
});

ipcMain.handle('get-tts-config', () => ({
  elevenLabsKey: store.get('elevenLabsKey', ''),
  elevenLabsVoice: store.get('elevenLabsVoice', ''),
  ttsEnabled: store.get('ttsEnabled', true),
  ttsVolume: store.get('ttsVolume', 0.8)
}));

ipcMain.handle('set-tts-config', (_, config) => {
  Object.entries(config).forEach(([k, v]) => store.set(k, v));
  return true;
});

ipcMain.handle('get-voices', async () => {
  const key = store.get('elevenLabsKey', '');
  if (!key) return [];
  const resp = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': key }
  });
  const data = await resp.json();
  return data.voices || [];
});

ipcMain.handle('acknowledge-alert', (_, id) => {
  const notifs = store.get('notifications', []);
  const idx = notifs.findIndex(n => n.id === id);
  if (idx >= 0) {
    notifs[idx].acknowledged = true;
    notifs[idx].read = true;
    store.set('notifications', notifs);
  }
  return true;
});
```

## Files to Modify
1. **src/renderer/panel.html** — New structure with settings overlay, updated fonts/CSP
2. **src/renderer/panel.css** — Complete restyle with new design tokens
3. **src/renderer/panel.js** — New card renderers, settings panel logic, tab filtering, animations
4. **src/main/preload.js** — Add settings/TTS/acknowledge IPC bridges
5. **src/main/main.js** — Add IPC handlers for settings, TTS config, voice list, acknowledge

## CSP Update (panel.html)
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src https://api.elevenlabs.io; media-src https: http:; img-src 'self' data:;">
```

## DO NOT
- Add any npm dependencies (no React, no frameworks — vanilla JS only)
- Change the API server (api-server.js) 
- Change the toast system (that's separate)
- Break the existing notification data structure
- Remove any existing IPC channels

## The Bar
This panel should look like it belongs in a luxury EV's dashboard. Premium. Atmospheric. Alive.
