# Atlas Notifications API Contract

**Version:** 1.0  
**Base URL:** `http://{host}:9400` (default: `http://100.65.60.42:9400`)

## Authentication

**Development mode:** No authentication required when `apiToken` is not configured in settings.  
**Production mode:** Bearer token required via `Authorization: Bearer {token}` header or `?token={token}` query parameter.

---

## Endpoints

### `GET /health`

Health check endpoint.

**Auth:** None required

**Response:**
```json
{
  "status": "ok",
  "app": "atlas-notifications",
  "uptime": 12345.67
}
```

---

### `POST /notify`

Send a notification to the Atlas Survey app.

**Auth:** Bearer token (if configured)

**Content-Type:** `application/json`

**Request Body:**

```json
{
  "type": "toast|briefing|alert|production-card",
  "title": "Notification Title",
  "body": "Notification body text",
  "priority": "low|normal|high",
  "category": "optional-category-string",
  "tts": true|false,
  "tts_text": "Optional custom text to speak",
  "audio_url": "https://path/to/audio.mp3",
  "data": {}
}
```

**Response (Success):**
```json
{
  "success": true,
  "id": "unique-notification-id"
}
```

**Response (Error):**
```json
{
  "error": "Error message"
}
```

---

## Base Notification Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `type` | string | No | `"toast"` | Notification type: `toast`, `briefing`, `alert`, `production-card` |
| `title` | string | **Yes** | — | Primary heading |
| `body` | string | No | `""` | Body text (used by toast/alert/fallback) |
| `priority` | string | No | `"normal"` | Priority level: `low`, `normal`, `high` |
| `category` | string | No | `null` | Optional category label |
| `tts` | boolean | No | `false` | Enable text-to-speech |
| `tts_text` | string | No | `null` | Custom text for TTS (overrides auto-generated) |
| `audio_url` | string | No | `null` | Pre-generated audio file URL (takes precedence over live TTS) |
| `data` | object | No | `{}` | Type-specific data (see below) |

---

## Notification Types & Data Schemas

### `toast`

Simple notification with title and body. No special `data` fields required.

**Example:**
```json
{
  "type": "toast",
  "title": "System Update",
  "body": "All systems operational",
  "priority": "low"
}
```

**Card Fields Used:**
- `title`
- `body`
- `timestamp` (auto-generated)

---

### `briefing`

Structured briefing with multiple segments. Designed for multi-topic status updates (production, weather, shipments, etc.).

**Data Schema:**
```json
{
  "data": {
    "segments": [
      {
        "label": "Production",
        "text": "Full segment text",
        "summary": "Optional condensed summary",
        "icon": "chart|weather|shipment|briefing|alert",
        "category": "optional-category"
      }
    ]
  }
}
```

**Segment Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `label` | string | **Yes** | Segment heading (e.g., "Production", "Weather") |
| `text` | string | **Yes** | Full segment content (used in expanded view) |
| `summary` | string | No | Condensed version (auto-extracted if missing) |
| `icon` | string | No | Icon key: `chart`, `weather`, `shipment`, `briefing`, `alert`, `pin` |
| `category` | string | No | Additional categorization |

**Example:**
```json
{
  "type": "briefing",
  "title": "Morning Briefing",
  "tts": true,
  "data": {
    "segments": [
      {
        "label": "Production",
        "text": "Daily total: 93.3 lbs (108.6% of target). Crew of 12 trimmers at 1.15 rate. Ahead of pace.",
        "icon": "chart"
      },
      {
        "label": "Weather",
        "text": "Clear skies, 58°F. Light wind from NW at 8 mph. Good conditions for harvest.",
        "icon": "weather"
      },
      {
        "label": "Shipment",
        "text": "Route: Portland → Seattle. ETA Wednesday 2pm. 45 lbs Smalls in transit.",
        "icon": "shipment"
      }
    ]
  }
}
```

**Card Rendering:**
- **Popup:** Compact view (emoji + label + summary per segment)
- **Panel:** Collapsible card — compact by default, expands to show full `text` for each segment

**TTS Behavior:**
- If `tts_text` provided, uses that
- Otherwise builds from segments: `"{label}. {text}. "`
- Falls back to `body` if no segments

---

### `alert`

High-priority alert requiring user acknowledgment.

**Data Schema:**
```json
{
  "data": {}
}
```

No special `data` fields required. Acknowledgment state is tracked internally by the app.

**Example:**
```json
{
  "type": "alert",
  "title": "Security Alert",
  "body": "Unauthorized access detected on Farm Office network. Change Wi-Fi password immediately.",
  "priority": "high",
  "tts": true
}
```

**Card Fields Used:**
- `title` (displayed as alert heading)
- `body` (alert details)
- Internal `acknowledged` flag (managed by app)

**User Interaction:**
- Card displays `[ ACKNOWLEDGE ]` button until clicked
- After acknowledgment, button changes to `[ CONFIRMED ]` / `[ ACKNOWLEDGED ]` (theme-dependent)
- Acknowledged alerts are marked read and auto-dismiss after 2 seconds

---

### `production-card`

Real-time production monitoring with pace tracking and hourly trend chart.

**Data Schema:**
```json
{
  "data": {
    "dailyTotal": 47.2,
    "percentOfTarget": 55.3,
    "targetRate": 0.85,
    "rate": 1.05,
    "trimmers": 8,
    "crew": 8,
    "paceStatus": "ahead|on-pace|behind",
    "hourly": [
      { "actual": 4.2, "target": 3.5 },
      { "actual": 5.1, "target": 3.5 }
    ]
  }
}
```

**Production Data Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `dailyTotal` | number | **Yes** | Total pounds produced today |
| `percentOfTarget` | number | **Yes** | Percentage of daily target (e.g., 108.6) |
| `rate` | number | **Yes** | Current production rate (lbs/hour/trimmer) |
| `targetRate` | number | No | Target rate for comparison |
| `trimmers` | number | No | Number of trimmers on crew |
| `crew` | number | No | Total crew size (alias for `trimmers`) |
| `paceStatus` | string | No | Pace indicator: `ahead`, `on-pace`, `behind` |
| `hourly` | array | No | Hourly production data points |

**Hourly Data Point Schema:**
```json
{ "actual": 5.1, "target": 3.5 }
```

**Example:**
```json
{
  "type": "production-card",
  "title": "Production Update",
  "priority": "normal",
  "data": {
    "dailyTotal": 93.3,
    "percentOfTarget": 108.6,
    "rate": 1.15,
    "targetRate": 0.85,
    "crew": 12,
    "paceStatus": "ahead",
    "hourly": [
      { "actual": 4.2, "target": 3.5 },
      { "actual": 5.8, "target": 3.5 },
      { "actual": 6.1, "target": 3.5 },
      { "actual": 5.3, "target": 3.5 }
    ]
  }
}
```

**Card Rendering:**
- **Popup:** Full chart view with stats overlay
- **Panel:** Collapsible — compact stats line by default, expands to show chart

**TTS Behavior:**
- Reads: `"{dailyTotal} pounds. {percentOfTarget} percent. {crew} crew. {rate} rate. {paceStatus}."`
- Example: _"93.3 pounds. 108.6 percent. 12 crew. 1.15 rate. Ahead."_

---

## Text-to-Speech (TTS)

Atlas Notifications supports two TTS modes:

### 1. Pre-generated Audio
Set `audio_url` to a hosted MP3 file. The app will play it directly (takes precedence over live TTS).

### 2. Live TTS (Client-Side)
**ElevenLabs (Primary):**
- Requires API key and voice ID configured in app settings
- Uses `eleven_multilingual_v2` model
- Voice settings: `stability=0.3`, `similarity_boost=0.85`, `style=0.4`, `use_speaker_boost=true`

**Web Speech API (Fallback):**
- Used if ElevenLabs fails or is not configured
- Browser-native TTS (quality varies by platform)

**TTS Text Selection Priority:**
1. `tts_text` (if provided)
2. `data.tts_text` (if provided)
3. Auto-generated from `data.segments[]` (briefing type): `"{label}. {text}. "`
4. Fallback to `body` or `title`

**Enable TTS:**
Set `"tts": true` in the notification payload.

---

## Known Issues & Flags

### `production-live` Type Discrepancy

**STATUS.md** references a `production-live` notification type, but it is **NOT** included in the API server's `validTypes` array:

```javascript
// src/main/api-server.js:21
const validTypes = ['toast', 'briefing', 'alert', 'production-card'];
```

**Resolution Needed:**
- If `production-live` is a valid type, add it to `validTypes` and document its schema
- If it's deprecated, remove references from STATUS.md
- If it's an alias for `production-card`, clarify naming convention

---

## Error Responses

### 400 Bad Request

**Missing required field:**
```json
{
  "error": "Missing required field: title"
}
```

**Invalid type:**
```json
{
  "error": "Invalid type. Must be one of: toast, briefing, alert, production-card"
}
```

**Invalid priority:**
```json
{
  "error": "Invalid priority. Must be one of: low, normal, high"
}
```

### 401 Unauthorized

**Missing or invalid token (when auth is enabled):**
```json
{
  "error": "Unauthorized — invalid or missing token"
}
```

### 500 Internal Server Error

**Notification processing failed:**
```json
{
  "error": "Failed to process notification"
}
```

---

## Implementation Notes

### Notification Storage
- Notifications are stored in `electron-store` with a max history limit (default: 50)
- Each notification receives a unique ID: `{timestamp}.{random}`
- Schema includes:
  - `id`, `type`, `title`, `body`, `priority`, `category`
  - `timestamp` (ISO 8601)
  - `read` (boolean)
  - `acknowledged` (boolean, alerts only)
  - `tts`, `tts_text`, `audio_url`
  - `data` (type-specific)

### Popup Display Limits
- Maximum 5 simultaneous popups
- Oldest popups are force-dismissed when limit is exceeded
- Popups stack vertically from bottom-right of screen

### Theme Support
The renderer supports two themes:
- **`relay`** — Glass Console / Hologram Glitch (cyan/gold, transmission aesthetic)
- **`terrain`** — Topographic / Land Survey (earth tones, cartographic aesthetic)

Theme affects visual style only; API contract remains unchanged.

---

## Example cURL Commands

### Toast Notification
```bash
curl -X POST http://100.65.60.42:9400/notify \
  -H "Content-Type: application/json" \
  -d '{
    "type": "toast",
    "title": "System Status",
    "body": "All systems operational",
    "priority": "low"
  }'
```

### Briefing with TTS
```bash
curl -X POST http://100.65.60.42:9400/notify \
  -H "Content-Type: application/json" \
  -d '{
    "type": "briefing",
    "title": "Morning Brief",
    "tts": true,
    "data": {
      "segments": [
        {
          "label": "Production",
          "text": "93 lbs today at 108% of target",
          "icon": "chart"
        },
        {
          "label": "Weather",
          "text": "Clear skies, 58°F",
          "icon": "weather"
        }
      ]
    }
  }'
```

### Alert
```bash
curl -X POST http://100.65.60.42:9400/notify \
  -H "Content-Type: application/json" \
  -d '{
    "type": "alert",
    "title": "Security Alert",
    "body": "Unauthorized access detected",
    "priority": "high",
    "tts": true
  }'
```

### Production Card
```bash
curl -X POST http://100.65.60.42:9400/notify \
  -H "Content-Type: application/json" \
  -d '{
    "type": "production-card",
    "title": "Production Update",
    "data": {
      "dailyTotal": 47.2,
      "percentOfTarget": 55.3,
      "rate": 1.05,
      "crew": 12,
      "paceStatus": "ahead"
    }
  }'
```

---

## Changelog

### 1.0 (Current)
- Initial API contract documentation
- Supports: toast, briefing, alert, production-card
- TTS via ElevenLabs + Web Speech fallback
- Dual theme support (relay/terrain)
