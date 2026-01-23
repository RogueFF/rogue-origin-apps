# Live Scale Weight Display

> Real-time weight display for 5kg bag packing station

**Date:** 2026-01-22
**Status:** Approved
**Hardware:** Brecknell GP100 scale (USB/serial)

---

## Overview

Display live scale weight during bag packing:
- **Station PC**: Instant feedback (100-200ms updates) with circular progress ring
- **Scoreboard TV**: Near real-time (1-2 second delay) in timer panel

Bag completion stays with barcode scan (webhook) for accountability. Scale is visual feedback only.

---

## Architecture

```
Pack Station                          Cloud                    Floor TV
┌─────────────┐                  ┌─────────────┐          ┌─────────────┐
│ Scale Reader│──POST 500ms────▶│  Cloudflare │◀──GET────│  Scoreboard │
│   App       │                  │   Worker    │  1s poll │             │
│ (instant UI)│                  │   + D1      │          │ (1-2s delay)│
└─────────────┘                  └─────────────┘          └─────────────┘
```

**Upgrade path:** Cloudflare Durable Objects ($5/mo) for true WebSocket real-time on all displays.

---

## Workflow

1. Empty bag placed on scale (0 kg)
2. Worker fills bag → weight climbs → hits ~5kg
3. Worker removes bag from scale → weight drops to ~0
4. Worker applies barcode label
5. Worker scans barcode → webhook fires → timer resets

Weight resets naturally when bag removed. Webhook confirms completion for tracking.

---

## Component 1: Scale Reader App (Station PC)

**Technology:** Node.js + Express + serialport

**Location:** `scale-reader/` folder

**Features:**
- Reads Brecknell GP100 via serial port (9600 baud, 8N1)
- Serves local webpage at `http://localhost:3000`
- Circular progress ring fills as weight increases
- Large font readable from 3-4 feet
- Color changes: white → green (near target) → gold (at target)
- Pushes weight to Cloudflare API every 500ms
- Works offline (local display continues if internet down)
- Bilingual (EN/ES toggle)
- Full-screen mode

**Local display UI:**
```
        ┌─────────────────────────────────┐
        │                                 │
        │         ╭───────────╮           │
        │       ╱╱             ╲╲         │
        │      ▐█               ░▌        │
        │      ▐█    4.72 kg    ░▌        │
        │      ▐█               ░▌        │
        │       ╲╲             ╱╱         │
        │         ╰───────────╯           │
        │                                 │
        │        Target: 5.00 kg          │
        │                                 │
        └─────────────────────────────────┘
```

**Ring behavior:**
- Empty (0kg): Gray/dim ring outline
- Filling: Ring fills clockwise, color shifts white → green
- Near target (4.8-5.0kg): Bright green
- At/over target (5.0kg+): Gold ring, "✓" appears
- Bag removed (drops to ~0): Quick fade, ready for next

**Brecknell GP100 serial settings:**
- Baud rate: 9600
- Data bits: 8
- Stop bits: 1
- Parity: None
- Output format: `"  4.72 kg\r\n"` (weight as text)

---

## Component 2: Cloudflare Worker API

**Endpoints in `workers/src/handlers/production.js`:**

### POST `/api/production?action=scaleWeight`

Station PC pushes current weight.

```javascript
// Request body:
{
  "weight": 4.72,
  "stationId": "line1"
}

// Response:
{ "success": true }
```

### GET `/api/production?action=scaleWeight`

Scoreboard fetches latest weight.

```javascript
// Response:
{
  "success": true,
  "data": {
    "weight": 4.72,
    "targetWeight": 5.0,
    "percentComplete": 94,
    "stationId": "line1",
    "updatedAt": "2026-01-22T14:35:22.456Z",
    "isStale": false
  }
}
```

**Stale detection:** If `updatedAt` older than 3 seconds, `isStale: true`.

### D1 Table

```sql
CREATE TABLE scale_readings (
  station_id TEXT PRIMARY KEY DEFAULT 'line1',
  weight REAL NOT NULL,
  target_weight REAL DEFAULT 5.0,
  updated_at TEXT NOT NULL
);
```

---

## Component 3: Scoreboard UI Integration

**Location:** Inside timer panel (compact option)

```
┌─────────────────────────────────┐
│       5KG Bag Timer             │
│                                 │
│      ╭─────────────╮            │
│     ╱               ╲           │
│    █   02:45         █          │
│     ╲               ╱           │
│      ╰─────────────╯            │
│                                 │
│  Bags Today    Avg Today        │
│      7           3:12           │
│                                 │
│  vs Target    Scale Weight      │  ← NEW
│    -0:18      🟢 4.72 kg        │
│               ⚪━━━━━━━━━●       │  ← Mini progress bar
└─────────────────────────────────┘
```

**Status indicator:**
- 🟢 Green dot = live, updating normally
- ⚫ Gray dot = stale (no update in 3+ seconds)

**Polling:** Separate 1-second interval for scale weight (faster than main 5-second scoreboard poll).

---

## Edge Cases

| Situation | Station display | Scoreboard |
|-----------|-----------------|------------|
| Normal filling | Ring fills, weight climbs | Same, 1-2s behind |
| Hit 5kg target | Ring turns gold, "✓" | Same |
| Bag removed | Ring empties, back to 0 | Same |
| Scale unplugged | "Disconnected" message | Gray dot, "—" |
| App crashes | Screen blank | Gray dot after 3s |
| Internet down | Local works fine | Gray dot |
| Negative reading | Shows 0 | Shows 0 |
| Over 5kg | Shows actual, ring gold | Same |

---

## Files to Create

| File | Purpose |
|------|---------|
| `scale-reader/package.json` | Node.js dependencies |
| `scale-reader/index.js` | Main app: serial read, web server, API push |
| `scale-reader/public/index.html` | Local display HTML |
| `scale-reader/public/scale.css` | Local display styles |
| `scale-reader/public/scale.js` | Ring animation JS |
| `src/js/scoreboard/scale.js` | Scoreboard module |

## Files to Modify

| File | Change |
|------|--------|
| `workers/src/handlers/production.js` | Add scaleWeight actions |
| `workers/schema.sql` | Add scale_readings table |
| `src/pages/scoreboard.html` | Add scale stat to timer panel |
| `src/css/scoreboard.css` | Scale stat styles |
| `src/js/scoreboard/main.js` | Add 1s scale polling |
| `src/js/scoreboard/i18n.js` | EN/ES translations |

---

## Bilingual Labels

| English | Spanish |
|---------|---------|
| Scale Weight | Peso en Vivo |
| Target | Meta |
| Disconnected | Desconectado |
| Connected | Conectado |

---

## Deployment Steps

1. **Backend first:**
   - Add D1 table: `npx wrangler d1 execute rogue-origin-db --remote --command "CREATE TABLE..."`
   - Deploy Worker: `cd workers && npx wrangler deploy`

2. **Scale reader app:**
   - Copy `scale-reader/` folder to station PC
   - Install Node.js if needed
   - Run `npm install`
   - Configure COM port in config
   - Run `npm start`
   - Open `http://localhost:3000` in browser, full-screen

3. **Frontend (test locally first):**
   - Open `src/pages/scoreboard.html` directly in browser
   - Verify scale stat appears and updates
   - Test stale state (stop scale-reader, confirm gray dot)
   - Then push to GitHub Pages

---

## Testing Checklist

### Scale Reader App
- [ ] Reads weight from scale correctly
- [ ] Local display shows ring filling
- [ ] Color changes at 4.8kg (green) and 5.0kg (gold)
- [ ] Handles scale disconnect gracefully
- [ ] Pushes to API every 500ms
- [ ] Works offline (local display continues)
- [ ] Full-screen mode works
- [ ] EN/ES toggle works

### Cloudflare API
- [ ] POST accepts weight updates
- [ ] GET returns current weight
- [ ] Stale detection works (3+ seconds)
- [ ] Handles missing station gracefully

### Scoreboard
- [ ] Scale stat appears in timer panel
- [ ] Updates every 1 second
- [ ] Green dot when live
- [ ] Gray dot when stale
- [ ] Mini progress bar fills correctly
- [ ] Responsive on mobile/tablet

---

## Future Enhancements (Option B Upgrade)

- WebSocket via Cloudflare Durable Objects ($5/mo)
- True real-time on all displays (no polling)
- Multiple scales (Line 1, Line 2)
- Weight history/analytics
