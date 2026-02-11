# Atlas Notifications — API Contract

**Endpoint:** POST http://100.65.60.42:9400/notify
**Auth:** Bearer 757cd37d70b823351787b9b03fbfd3da0f9b6024342e0d24
**Creds:** /home/fern/.credentials/atlas-notifications.json

## Types

| Type | Sound | Auto-dismiss | Behavior |
|------|-------|-------------|----------|
| toast | Silent | 8s | Basic notification |
| briefing | TTS auto-play | 30s | Structured segments with icons |
| alert | Chime | Never | Pulse glow, requires manual ack |
| production | Silent | 15s | Stat grid + progress bar + sparkline |
| production-live | Silent | 15s | Same but auto-replaces previous |

## Production Card
```json
{
  "type": "production",
  "title": "Hourly Update",
  "body": "Line 1 at 92%",
  "data": {
    "todayLbs": 45.6,
    "todayTarget": 52.0,
    "todayPercentage": 87.7,
    "currentRate": 3.42,
    "strain": "Cherry Blossom",
    "crew": 8,
    "bags": 142,
    "avgCycle": 4.2,
    "hourly": [3.1, 3.5, 3.8, 3.2, 3.6, 3.9, 3.4],
    "paceStatus": "ahead"
  }
}
```
paceStatus: "ahead" | "behind" | "on-pace" (drives color: green/red/gold)

## Briefing
```json
{
  "type": "briefing",
  "title": "Morning Brief",
  "data": {
    "segments": [
      {"icon": "factory", "label": "Production", "text": "112.4 lbs, 120% of target"},
      {"icon": "cloud-sun", "label": "Weather", "text": "45°F, clear skies"},
      {"icon": "users", "label": "Crew", "text": "8 on floor, 2 late"}
    ]
  }
}
```
Icons: factory, cloud-sun, clock, users, info (optional field)

## Rules
- Max 4 visible toasts
- Alerts never bumped by overflow
- production-live auto-replaces previous
- All fields except type and title are optional
