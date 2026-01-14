# Error Handling & Loading States Design

**Date:** 2026-01-13
**Phase:** 3.1
**Status:** Implementing

## Overview

Add comprehensive error handling and loading states to the dashboard without disrupting the professional appearance. Key principle: **transparency without alarm**.

## Design Decisions

### 1. Connection Status Bar (Subtle)

Location: Top of dashboard, below header. Auto-hides when connected.

**States:**
- **Loading:** `⟳ Connecting...` - subtle yellow/amber background
- **Connected:** `✓ Last updated: 2:34 PM [Refresh]` - fades after 3s, visible on hover
- **Error:** `⚠ Connection issue • Last data: 2:31 PM [Retry]` - amber, persists until resolved

**Behavior:**
- Shows during any fetch operation
- Displays timestamp of last successful data load
- Auto-retry once after 5s on failure
- Manual retry button always available

### 2. Per-Widget Error States (Bottom Accent Strip)

When widget data fails to load:
- Thin 3px amber strip at widget bottom
- Strip pulses subtly (CSS animation)
- Widget shows "—" for values (already existing behavior)
- Click strip to retry
- Tooltip on hover: "Couldn't load data. Click to retry."

**Why this approach:**
- Dashboard still looks complete and intentional
- Doesn't disrupt layout or scream "ERROR"
- Scales well with multiple widget failures
- Professional appearance maintained

### 3. Retry Mechanism

**Manual:**
- Status bar "Retry" button → calls `loadData()`
- Widget strip click → calls `loadData()`

**Auto:**
- On failure: single retry after 5 seconds
- If still failing: stop (no infinite loop)
- Show brief toast: "Retrying..." → "Connected" or "Still having trouble"

### 4. State Tracking

New state fields:
- `lastSuccessfulFetch: Date | null`
- `isConnecting: boolean`
- `connectionError: string | null`
- `widgetErrors: Map<string, string>`

## Files to Modify

1. **`src/js/modules/state.js`** - Add new state fields
2. **`src/js/modules/status.js`** (new) - Status bar component
3. **`src/js/modules/api.js`** - Integrate status updates, auto-retry
4. **`src/js/modules/index.js`** - Wire up status bar
5. **`src/pages/index.html`** - Add status bar HTML
6. **`src/css/dashboard.css`** - Status bar and widget strip styles

## Success Criteria

- [ ] Cold start shows clear "Connecting..." feedback
- [ ] Successful load shows timestamp briefly
- [ ] Failed load shows error state with retry option
- [ ] Widget errors display subtle amber strip
- [ ] Auto-retry happens once on failure
- [ ] No stale data displayed as fresh (timestamps visible)
