# Hourly Entry Timeline View - Design

## Overview

Redesign the hourly-entry app with a Timeline View that shows all time slots vertically, with tap-to-expand editing and full-screen focus on the current entry.

## User Workflow

1. **Start of hour**: Enter crew count for this hour
2. **End of hour**: Enter production (tops/smalls) + crew count for next hour
3. **Mid-hour changes**: Crew or cultivar can change mid-hour, needs logging

## Design

### Timeline Overview (Default View)

```
┌─────────────────────────────┐
│ ← Hourly Entry    [ES] [📅]│
├─────────────────────────────┤
│ TODAY: 74.4 lbs             │
│ ████████████░░░░ 109%       │
│ Target: 68 lbs  |  8 hrs    │
├─────────────────────────────┤
│ 7-8 AM         5.2 lbs  ✓  │
│ 8-9 AM         8.1 lbs  ✓  │
│ 9-10 AM        9.0 lbs  ✓  │
│ ...                         │
│ 4-4:30 PM      3.2 lbs  ●  │ ← current hour highlighted
└─────────────────────────────┘
```

- Sticky header with progress bar
- Vertical list of all time slots
- ✓ = has data, ● = current hour
- Tap any row to open full-screen editor

### Entry Editor (Full-Screen Focus)

```
┌─────────────────────────────┐
│ ← Back         74.4 lbs 109%│
├─────────────────────────────┤
│      9:00 AM – 10:00 AM     │
├─────────────────────────────┤
│ CREW                        │
│ Buckers    [-] 5 [+]        │
│ Trimmers   [-] 8 [+]  [↻]   │
│ T-Zero     [-] 1 [+]        │
├─────────────────────────────┤
│ CULTIVAR                    │
│ [2025 - Lifter / Sungrown▼] │
│                        [↻]  │
├─────────────────────────────┤
│ PRODUCTION                  │
│ Tops (lbs)    [    9.0    ] │
│ Smalls (lbs)  [    8.2    ] │
├─────────────────────────────┤
│ QC Notes (optional)         │
│ [                         ] │
│                             │
│     [ ← Prev ]  [ Next → ]  │
└─────────────────────────────┘
```

- Full-screen focus on current slot
- Prev/Next buttons to navigate hours
- [↻] Change buttons for mid-hour changes
- Auto-save on blur

### Mid-Hour Change Flow

When user taps [↻] Change button:

```
┌─────────────────────────────┐
│ Change Trimmers             │
│                             │
│ New count:  [-] 6 [+]       │
│                             │
│ Logged at 9:32 AM           │
│                             │
│ [Cancel]         [Confirm]  │
└─────────────────────────────┘
```

- Simple modal with +/- controls
- Timestamp auto-captured
- Saved to change log for weighted calculations

## Technical Notes

- Two-view architecture: Timeline (list) and Editor (full-screen)
- State tracks: currentView ('timeline' | 'editor'), selectedSlot
- Mid-hour changes stored in separate array per slot
- Backend calculates weighted targets based on change timestamps

## Scope for V1

**Include:**
- Timeline overview with progress bar
- Full-screen editor with Prev/Next navigation
- Auto-save behavior
- 2025 cultivar filter

**Defer to V2:**
- Mid-hour change logging (use QC notes for now)
- Weighted target calculations
- Change history display
