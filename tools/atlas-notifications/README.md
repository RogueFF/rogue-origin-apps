# Atlas Notifications

Desktop tray app for receiving briefings, alerts, and notifications from Atlas.

Built with Electron. Runs on Windows as a system tray application.

## Features

- **System tray icon** — always running in the Windows taskbar
- **Toast notifications** — native Windows notifications for alerts and milestones
- **Briefing panel** — click the tray icon to view recent briefings (morning/midday/evening)
- **TTS playback** — briefings with audio auto-play when received
- **HTTP API** — local server accepts POST requests from Atlas
- **History** — stores and displays the last 50 notifications
- **Auto-start** — optionally launch on Windows startup
- **Connection status** — shows whether Atlas is reachable via Tailscale

## Setup

```bash
cd tools/atlas-notifications
npm install
npm start
```

## Build for Windows

```bash
npm run build
```

Output installer will be in `dist/`.

## API

The app runs a local HTTP server (default port `9400`).

### Send a notification

```bash
curl -X POST http://localhost:9400/notify \
  -H "Content-Type: application/json" \
  -d '{
    "type": "briefing",
    "title": "Morning Briefing",
    "body": "Production is on track. Line 1 at 92% efficiency.",
    "audio_url": "https://example.com/briefing.mp3",
    "priority": "normal",
    "data": {}
  }'
```

### Payload format

```json
{
  "type": "toast|briefing|alert",
  "title": "string (required)",
  "body": "string",
  "audio_url": "optional URL to audio file",
  "priority": "low|normal|high",
  "data": {}
}
```

### Types

| Type | Behavior |
|------|----------|
| `toast` | Shows native Windows toast notification |
| `briefing` | Toast + card in panel. Auto-plays audio if provided |
| `alert` | Toast + card with high-visibility styling |

### Health check

```
GET http://localhost:9400/health
```

## Configuration

Right-click the tray icon to access settings:

- **Auto-start with Windows** — toggle on/off
- **API Port** — shown in context menu (change in electron-store config)

Config is stored via `electron-store` at:
```
%APPDATA%/atlas-notifications/config.json
```

### Default config

| Setting | Default | Description |
|---------|---------|-------------|
| `port` | `9400` | Local API server port |
| `autoStart` | `true` | Launch on Windows startup |
| `atlasHost` | `100.64.0.1` | Atlas server IP (Tailscale) |
| `maxHistory` | `50` | Max stored notifications |

## Architecture

```
src/
├── main/
│   ├── main.js          Electron main process (tray, windows, IPC)
│   ├── api-server.js    Express HTTP server for receiving notifications
│   └── preload.js       Secure bridge between main and renderer
├── renderer/
│   ├── panel.html       Briefing panel UI
│   ├── panel.css        Dark theme styles
│   └── panel.js         Panel logic and rendering
└── assets/
    ├── tray-icon.png    16x16 tray icon
    └── icon.png         256x256 app icon
```

## Sending from Atlas

Atlas sends notifications via HTTP POST to Koa's machine over Tailscale:

```python
import requests

requests.post("http://100.x.x.x:9400/notify", json={
    "type": "briefing",
    "title": "Morning Briefing — Jan 15",
    "body": "Line 1: 45 bags (target 50)\nLine 2: 38 bags (target 42)\nWeather: 52°F, clear",
    "audio_url": "https://storage.example.com/briefings/2026-01-15-morning.mp3",
    "priority": "normal"
})
```
