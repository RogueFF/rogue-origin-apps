# Atlas Notifications — Status

_Living doc. Updated as work progresses in this topic._

## What It Is
Electron desktop tray app for Windows. Receives push notifications from Atlas over Tailscale (POST to `100.65.60.42:9400/notify`). Shows toasts, briefings, production updates, and alerts.

## Current State (as of 2026-02-12)

### ✅ Done
- **Core Electron app** — tray icon, toast popups, notification panel, HTTP API server
- **Notification types** — toast, briefing, alert, production, production-live all working
- **Panel UI** — full notification history with tabs (All, Briefings, Alerts, Production)
- **Toast popups** — floating cards with auto-dismiss, type-specific styling
- **API server** — Bearer auth, accepts typed payloads per contract
- **TTS** — Web Speech API baseline (ElevenLabs specced but status unclear)
- **"Relay" theme** — dark/cyan hologram glitch aesthetic (Pass 1-4)
- **"Terrain" theme** — topo map/earth tones aesthetic (Pass 5)
- **Theme switcher** — in settings, instant preview between Relay and Terrain
- **Connection status** — Atlas reachability indicator
- **Auto-start** — optional Windows startup launch
- **Production cards** — stat grid, sparkline/terrain viz, progress bar, pace coloring
- **Briefing cards** — structured segments with icons
- **Alert cards** — acknowledge button, visual emphasis

### ✅ Recently Completed (2026-02-12)
- **ElevenLabs TTS** — fully wired and working. Client-side in popup.js, falls back to Web Speech.
- **API contract doc** — `docs/api-contract.md` with full field schemas per type
- **Sender utility** — `tools/notify.js` CLI for sending notifications with correct fields
- **`production-live` type** — added to API server, auto-replaces previous production card in history
- **Production notify script** — `../../tools/production-notify.js` updated for dev mode (no auth required)

### 🔲 Not Started
- **Testing on Windows** — app is built in WSL, needs actual Windows testing as packaged exe
- **Heartbeat integration** — heartbeat checks need to call production-notify.js / notify.js
- **Auto-deploy / packaging** — `npm run build` for Windows exe

### 📋 Decisions Made
- Two themes: Relay (cold/technical) and Terrain (warm/earth). User toggles in settings.
- Max 5 visible popups. Alerts never bumped by overflow.
- `production-live` type auto-replaces previous production card in history.
- API contract: see `docs/api-contract.md`
- TTS: ElevenLabs primary, Web Speech fallback. Controlled per-notification via `tts` field.

## Architecture
```
Atlas (Fern/WSL) → POST /notify → Electron API server (Windows, port 9400)
                                   ├── Toast window (popup notifications)
                                   └── Panel window (click tray icon, full history)
```

## Key Files
- `src/main/main.js` — Electron main process, tray, windows, IPC, settings
- `src/main/api-server.js` — HTTP server receiving notifications
- `src/main/preload.js` — IPC bridge to renderer
- `src/renderer/panel.*` — Main panel (HTML/CSS/JS)
- `src/renderer/popup.*` — Toast popup (HTML/CSS/JS)
- `src/renderer/card-renderer.js` — Shared card rendering logic
- `docs/atlas-notifications-contract.md` — API contract
- `PASS{1-5}-BRIEF.md` — Historical build pass instructions

## Pass History
1. **Pass 1** — Core app foundation
2. **Pass 2** — Refinements
3. **Pass 3** — Polish
4. **Pass 4** — Further iteration
5. **Pass 5** — Terrain theme + theme switcher

---
_Updated by Atlas during topic work sessions._
