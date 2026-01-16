# Morning Meeting Report - Design Document

**Date:** January 16, 2026
**Status:** Approved
**Location:** Scoreboard TV (`scoreboard.html`)

---

## Overview

A Traffic Light Scorecard for daily morning meetings at 7 AM. Shows yesterday's production compared to the day before, weekly totals vs last week, and current order progress. Designed for bilingual team (EN/ES side-by-side labels) with "explain like I'm five" simplicity.

---

## Access Method

- **Button on scoreboard header**: "Morning Report / Reporte Matutino"
- **Click to toggle** between live scoreboard and report view
- **Back button** on report to return to live view
- **Data snapshot**: Calculated at 6:00 AM daily, numbers don't change during meeting

---

## Layout Structure

```
┌─────────────────────────────────────────────────────────────┐
│  MORNING REPORT / REPORTE MATUTINO     [← Back/Volver]     │
│      Thursday, Jan 16 • Data as of 6:00 AM                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   SECTION 1: YESTERDAY vs DAY BEFORE                       │
│              AYER vs ANTEAYER                              │
│   (7 metric cards in grid)                                 │
│                                                             │
│   SECTION 2: THIS WEEK vs LAST WEEK                        │
│              ESTA SEMANA vs SEMANA PASADA                  │
│   (Weekly summary comparison)                              │
│                                                             │
│   SECTION 3: ORDER PROGRESS                                │
│              PROGRESO DEL PEDIDO                           │
│   (Current order status bar)                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Section 1: Yesterday vs Day Before (7 Metric Cards)

### Card Template

```
┌────────────────────────────────────────┐
│  LABEL EN / LABEL ES              🟢   │
│                                        │
│   Yesterday/Ayer    Day Before/Anteayer│
│       XX                XX             │
│                                        │
│            ⬆️ +X / ⬇️ -X              │
└────────────────────────────────────────┘
```

### Metrics

| # | Metric | Label EN | Label ES | Green When |
|---|--------|----------|----------|------------|
| 1 | Tops (lbs) | Tops | Puntas | Higher than day before |
| 2 | Smalls (lbs) | Smalls | Pequeños | Higher than day before |
| 3 | Bags completed | Bags | Bolsas | Higher than day before |
| 4 | Rate (lbs/trimmer/hr) | Rate | Ritmo | Higher than day before |
| 5 | Average crew size | Crew | Equipo | Neutral (no color) |
| 6 | Best hour | Best Hour | Mejor Hora | Special celebration card |
| 7 | Avg cycle time | Cycle Time | Tiempo de Ciclo | Lower is better (faster) |

### Traffic Light Colors

- 🟢 **Green**: Improved from day before (or hit target)
- 🟡 **Yellow**: About the same (within 5%)
- 🔴 **Red**: Declined from day before (or missed target)

### Best Hour Card (Special)

```
┌────────────────────────────────────────┐
│  🏆 BEST HOUR / MEJOR HORA        🔥   │
│                                        │
│         10:00 AM                       │
│         14.2 lbs                       │
│                                        │
│     "Keep it up! / ¡Sigan así!"       │
└────────────────────────────────────────┘
```

---

## Section 2: This Week vs Last Week

### Comparison Logic

- **This Week**: Monday through current day (partial week)
- **Last Week**: Full previous week total (Mon-Fri)

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  THIS WEEK SO FAR / ESTA SEMANA               vs    LAST WEEK   │
│  (Mon-Thu)                                          SEMANA PASADA│
│                                                     (Full week)  │
│                                                                  │
│   Tops: 180 lbs        ⬆️ +22 lbs                   158 lbs     │
│   Smalls: 45 lbs       ⬇️ -8 lbs                    53 lbs      │
│   Bags: 45             ⬆️ +5                        40          │
│   Avg Rate: 1.12       ⬆️ +0.08                     1.04        │
│                                                                  │
│   ════════════════════════════════════════════                  │
│   TOTAL: 225 lbs  🟢  ⬆️ +14 lbs vs last week                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Section 3: Order Progress

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  🎯 ORDER / PEDIDO: MO-2026-003 — Lifter (Customer Name)        │
│                                                                  │
│   ████████████████░░░░░░░░░░░░░░░░  35 / 120 kg                 │
│                                      29% complete               │
│                                                                  │
│   85 kg remaining • ~2.3 days at current rate                   │
│   Faltan 85 kg • ~2.3 días al ritmo actual                      │
└──────────────────────────────────────────────────────────────────┘
```

### Data Points

- Order ID and strain name
- Customer name
- Progress bar (visual)
- kg completed / kg total
- Percentage complete
- kg remaining
- Estimated days to complete (based on recent avg production)

---

## Button Placement

### Scoreboard Header (New Button)

```
┌─────────────────────────────────────────────────────────────────┐
│  ROGUE ORIGIN SCOREBOARD                                        │
│                                                                  │
│  [📊 Morning Report / Reporte Matutino]    [⚙️]    [🌙/☀️]      │
└─────────────────────────────────────────────────────────────────┘
```

### Report Header (Back Button)

```
┌─────────────────────────────────────────────────────────────────┐
│  MORNING REPORT / REPORTE MATUTINO                              │
│                                                                  │
│                              [← Back to Live / Volver en Vivo]  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Technical Implementation

### Files to Modify

1. **`src/pages/scoreboard.html`** - Add morning report view container and button
2. **`src/css/scoreboard.css`** - Styles for report cards and layout
3. **`src/js/scoreboard/morning-report.js`** - New module for report logic
4. **`apps-script/production-tracking/Code.gs`** - New `getMorningReportData()` function

### Backend Data Structure

```javascript
{
  generatedAt: "2026-01-16T06:00:00",

  yesterday: {
    date: "2026-01-15",
    tops: 52,
    smalls: 18,
    bags: 14,
    rate: 1.08,
    crew: 5,
    bestHour: { time: "10:00 AM", lbs: 14.2 },
    avgCycleTime: 42  // minutes
  },

  dayBefore: {
    date: "2026-01-14",
    tops: 48,
    smalls: 20,
    bags: 13,
    rate: 1.02,
    crew: 5,
    bestHour: { time: "11:00 AM", lbs: 12.8 },
    avgCycleTime: 45
  },

  thisWeek: {
    days: ["Mon", "Tue", "Wed", "Thu"],
    tops: 180,
    smalls: 45,
    bags: 45,
    avgRate: 1.12
  },

  lastWeek: {
    tops: 158,
    smalls: 53,
    bags: 40,
    avgRate: 1.04
  },

  currentOrder: {
    id: "MO-2026-003",
    strain: "Lifter",
    customer: "Customer Name",
    targetKg: 120,
    completedKg: 35,
    estimatedDaysRemaining: 2.3
  }
}
```

### API Endpoint

```
GET ?action=morningReport
```

Returns the data structure above, calculated fresh at 6 AM and cached until next day.

---

## Design Principles

1. **ELI5 (Explain Like I'm 5)** - Big numbers, simple comparisons, clear colors
2. **Bilingual** - EN/ES labels side-by-side, no toggle needed
3. **Traffic Light** - Green/Yellow/Red instantly understood across languages
4. **TV-Optimized** - Large text readable from across the room
5. **Frozen Data** - Snapshot doesn't change during meeting, no confusion

---

## Future Enhancements (Not in V1)

- Print-friendly version for handouts
- Email/SMS summary sent at 6 AM
- Historical report archive (view past days)
- Customizable metrics per user preference
