# Scoreboard Declutter & No-Scroll Layout Design

**Date:** 2026-02-04
**Status:** Approved
**Goal:** Eliminate scrolling, reduce clutter, optimize for TV viewing while maintaining mobile/desktop usability

---

## Problem Statement

The current scoreboard is cluttered with too many buttons/controls at the top, requires vertical scrolling on smaller screens, and is not optimized for the primary use case (large OLED TV viewed from distance).

**Current Issues:**
- 8+ buttons scattered across top of page (Morning Report, Past Data, Order Queue, Language, Help, Complaints, etc.)
- Total vertical height ~1,250px (doesn't fit on 768px mobile screens)
- Not optimized for TV distance viewing (text too small, spacing too tight)
- Controls are always visible even though most are used rarely

**User Requirements:**
- Primary viewing: Large OLED TV (10+ feet viewing distance)
- Secondary: Phone/desktop for quick glances
- Daily-use buttons: EN/ES toggle, Start Day, Past Data, Complaints
- Rarely-used: Morning Report, Order Queue toggle, Help
- Must fit on screen without scrolling (all device sizes)

---

## Design Solution

### Core Strategy

**Floating Action Button (FAB) Menu System** with responsive breakpoints:
- Minimal persistent chrome (EN/ES toggle + FAB button only)
- All other controls tucked into expandable FAB menu
- Three distinct layouts optimized for TV, desktop, and mobile
- Vertical space optimization to eliminate scrolling

---

## Layout Components

### 1. Persistent Elements (Always Visible)

#### EN/ES Language Toggle
- **Position:** Top-right corner (fixed)
- **Size:** 80px × 32px total
- **Design:** Two pill buttons side-by-side
- **Active state:** Solid gold background (#e4aa4f)
- **Rationale:** Most frequently used control, needs instant access for bilingual workforce

#### FAB Menu Button
- **Position:** Bottom-right corner (fixed, floats above all content)
- **Size:** 56px diameter (touch-friendly, TV-visible)
- **Icon:** ⚙️ Gear icon
- **Color:** Rogue Origin gold (#e4aa4f)
- **Animation:** Subtle pulse on idle (hints interactivity)
- **TV Mode:** Auto-fades to 20% opacity after 10 seconds idle

### 2. FAB Menu Panel (Opens on Click)

**Appearance:**
- Slides up from FAB button
- Semi-transparent dark background (#1a1f16, 95% opacity)
- Width: 220px on desktop, full-width on mobile
- Backdrop blur for depth

**Menu Items (in order):**

1. **Start Day** 🕐
   - Shows until shift start time is set
   - Auto-hides after set (reduces menu clutter mid-day)

2. **Past Data** 📅
   - Opens date picker for historical view
   - Daily use for checking previous days

3. **Complaints** ⚠️
   - Links to customer complaints Google Sheet
   - Daily monitoring

4. **Morning Report** 📊
   - Weekly/monthly summary view
   - Occasional use

5. **Order Queue** 🔄
   - Toggle switch showing ON/OFF state
   - Set once, rarely changed

6. **Help** ❓
   - First-time users, troubleshooting
   - Rare use

**Interaction:**
- Each item: 48px tall (touch-friendly)
- Left-aligned icon + text
- Hover/tap feedback
- Click outside to close

---

## Responsive Breakpoints

### TV Mode (≥1920px width)

**Optimized for:** Distance viewing, ambient awareness, OLED displays

**Header Bar** (60px tall):
- Strain name (left): 48px semi-bold font
- Time + Date (right): 36px lighter font
- Subtle gradient background (10% opacity)

**Hour Cards Row:**
- Side-by-side layout, 400px each
- **Last Hour:**
  - Production: 120px font
  - Target: 80px font
  - Color-coded background (green/yellow/red)
- **Current Hour:**
  - Crew count: 100px font
  - Target: 60px font

**Daily Progress Section:**
- Actual lbs: 140px font
- Target: 100px font
- Delta (±XX lbs): 80px font with arrow
- Progress bar: 40px thick, vivid colors
- Projection: 80px font

**Comparison Pills:**
- Horizontal row, centered
- Values: 60px font (+5.2%, 3hr streak)
- Icon + number + label layout

**Info Bar** (bottom, 50px tall):
- Crew count, target rate, AVG/BEST
- 36px font, icon + text pairs

**Timer Panel** (right side):
- Scale ring: 280px diameter
- Bag timer ring: 280px diameter
- Timer value: 100px font
- Target info: 40px font

**Color Optimization for OLED:**
- Pure black backgrounds (#000000) for pixel-off deep blacks
- High contrast status: vivid green (#4ade80), yellow (#fde047), red (#f87171)
- Gold accents (#e4aa4f)
- Pure white text (#ffffff)

**Chrome Behavior:**
- FAB menu tiny, auto-fades to 20% after 10s idle
- EN/ES toggle minimal size
- No unnecessary elements visible

### Desktop Mode (768px - 1919px)

**Optimized for:** Desk work, detailed monitoring

**Sizing:**
- Medium text (balanced for arm's length)
- Hour cards: 280px each
- Production numbers: 60-80px
- Info text: 18-24px

**Layout:**
- Compact spacing for efficiency
- All comparison pills visible
- Standard FAB size (56px)
- Fits in viewport without scroll

**Features:**
- Full feature set available
- Order queue toggle accessible
- Chart can be shown via FAB menu

### Mobile Mode (<768px)

**Optimized for:** Quick glances, on-the-go, touch interaction

**Layout:**
- Single column, cards stack vertically
- Full-width components
- Large touch targets (48px minimum)

**Sizing:**
- Production numbers: 48-64px
- Info text: 16-20px
- FAB: 56px (thumb-friendly)

**Behavior:**
- FAB menu slides up from bottom (full-width)
- Collapsible sections (order queue, chart hidden by default)
- May scroll, but critical info (last hour, today) above fold
- Timer panel below main panel (not side-by-side)

---

## Vertical Space Optimization

**Current Height:** ~1,250px minimum
**Target Height:** ~700-750px (fits 768px screens with headroom)

### Space-Saving Strategies

1. **Compact Header** (saves 100px)
   - Merge strain + time displays into single 60px bar
   - Before: 160px (strain 80px + time 80px)
   - After: 60px

2. **Tighten Hour Cards** (saves 40px)
   - Reduce padding/margins
   - Before: ~280px
   - After: ~240px

3. **Hide Order Queue by Default** (saves 180px when hidden)
   - Controlled via FAB menu
   - Only shows when toggled on

4. **Compact Comparison Pills** (saves 10px)
   - Keep visible (valuable at-a-glance info)
   - Reduce margins only
   - Before: 60px
   - After: 50px

5. **Keep Info Bar As-Is** (0px saved)
   - Already compact
   - Critical information

6. **Hide Chart by Default** (saves 300px)
   - Add toggle to FAB menu
   - Optional expanded view
   - Before: 300px when visible
   - After: 0px (hidden by default)

**Total Saved:** ~630px
**New Height:** ~620-700px (comfortable fit on all screens)

---

## UI/UX Improvements

### Decluttering Benefits
- **87.5% reduction** in visible controls (8 buttons → 1 FAB)
- Maximum screen real estate for production metrics
- Cleaner visual hierarchy
- Less cognitive load for at-a-glance viewing

### Accessibility Maintained
- Touch targets ≥48px (WCAG AA compliant)
- High contrast ratios (4.5:1 minimum)
- Keyboard navigation for FAB menu
- Screen reader labels for all controls

### Progressive Disclosure
- Most-used control (EN/ES) always visible
- Daily controls: 1 click away (FAB → action)
- Rare controls: Same 1 click (in same menu)
- Smart hiding (Start Day auto-hides after set)

---

## Implementation Phases

### Phase 1: FAB Menu System
- Build FAB button component
- Create slide-up menu panel
- Wire up existing buttons to FAB menu
- Add auto-fade for TV mode
- Test keyboard navigation

### Phase 2: Responsive Breakpoints
- Add media queries for TV/Desktop/Mobile
- Implement font scaling per breakpoint
- Test on actual TV, desktop, phone
- Adjust sizes based on real viewing

### Phase 3: Vertical Space Optimization
- Compact header (strain + time merge)
- Tighten hour card spacing
- Hide chart by default (add FAB toggle)
- Hide order queue by default
- Verify no-scroll on 768px viewport

### Phase 4: Polish & Testing
- OLED color optimization (pure blacks)
- FAB auto-fade timing tuning
- Transition animations
- Cross-device testing
- Worker feedback loop

---

## Success Criteria

- [ ] No vertical scrolling on any device (768px+ height)
- [ ] TV mode text readable from 10+ feet
- [ ] FAB menu accessible in ≤2 clicks
- [ ] EN/ES toggle remains instant-access
- [ ] Mobile touch targets ≥48px
- [ ] OLED pure blacks (#000000) in TV mode
- [ ] Start Day button auto-hides after set
- [ ] Page loads without layout shift
- [ ] Maintains all existing functionality
- [ ] Workers approve new layout

---

## Open Questions

- **Exact OLED TV resolution?** (4K or 1080p) - affects final font sizes
- **FAB menu animation speed?** - needs testing on TV (may need slower for visibility)
- **Auto-fade timing for TV?** - 10 seconds idle, or different threshold?
- **Order queue default state?** - hidden or visible on page load?

---

## Future Enhancements (Out of Scope)

- Voice control for TV mode (hands-free operation)
- Customizable FAB menu item order (user preferences)
- Swipe gestures for mobile FAB menu
- FAB menu keyboard shortcuts (power users)
- Multi-language FAB menu labels (beyond EN/ES)
