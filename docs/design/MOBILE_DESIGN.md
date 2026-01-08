# Mobile Design Specifications

**Version**: 1.0
**Priority**: Mobile-First (boss uses phone daily)
**Goal**: Answer "How are we doing?" in 3 seconds
**References**: All other design documents

---

## Design Philosophy

**Mobile-First, Not Mobile-Afterthought**: The phone experience should feel intentionally designed, not a cramped version of desktop. The boss checks production status on their phone multiple times daily - this is the PRIMARY use case.

**Touch-Native**: Every interaction should feel natural on touch. Generous tap targets, swipe gestures, and feedback designed for fingers, not cursors.

**Scannable**: Critical information visible immediately without scrolling. Production number dominates. Status at a glance.

---

## 1. Responsive Breakpoints

### Breakpoint System

| Name | Range | Primary Device |
|------|-------|----------------|
| **Desktop** | > 1200px | Desktop monitors |
| **Tablet** | 768px - 1200px | iPad, tablets |
| **Mobile** | < 768px | Phones |
| **Small Mobile** | < 375px | Small phones |

### CSS Media Queries

```css
/* Mobile First: Base styles are for mobile */

/* Tablet and up */
@media (min-width: 768px) {
  /* Tablet styles */
}

/* Desktop and up */
@media (min-width: 1200px) {
  /* Desktop styles */
}

/* Small mobile adjustments */
@media (max-width: 375px) {
  /* Small phone fixes */
}

/* Landscape mobile */
@media (max-width: 768px) and (orientation: landscape) {
  /* Landscape phone adjustments */
}
```

### Layout Grid

| Breakpoint | Columns | Gutter | Margin |
|------------|---------|--------|--------|
| Desktop | 12 | 24px | 40px |
| Tablet | 8 | 20px | 32px |
| Mobile | 4 | 16px | 16px |
| Small Mobile | 4 | 12px | 12px |

---

## 2. Touch Targets

### Minimum Sizes

| Element | Minimum Size | Recommended |
|---------|--------------|-------------|
| Primary buttons | 44px | 48px |
| Icon buttons | 44px | 48px |
| Nav items | 44px height | 48px |
| List items | 44px height | 56px |
| Form inputs | 44px height | 48px |
| Checkboxes/Toggles | 44px tap area | 48px |
| FABs | 56px | 56px |

### Implementation

```css
/* Ensure minimum tap targets */
.btn,
.icon-btn,
.toggle,
.nav-item,
.tap-target {
  min-height: 44px;
  min-width: 44px;
}

/* Expand tap area without changing visual size */
.small-icon-btn {
  position: relative;
}

.small-icon-btn::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 44px;
  height: 44px;
  /* Invisible tap area expansion */
}
```

### Spacing Between Targets

```css
/* Minimum 8px between tappable elements */
.btn-group {
  gap: 8px;
}

.nav-list {
  gap: 4px; /* Items have internal padding */
}

/* Generous spacing on mobile */
@media (max-width: 768px) {
  .btn-group {
    gap: 12px;
  }

  .action-bar {
    gap: 16px;
  }
}
```

---

## 3. Mobile Layout

### Overall Structure (Mobile)

```
+------------------+
|      HEADER      |  Fixed, 56px
+------------------+
|                  |
|   HERO SECTION   |  40% of viewport
|                  |
|    "127.4 lbs"   |
|                  |
+------------------+
|                  |
|   SCROLLABLE     |
|    CONTENT       |
|                  |
|  [Widget Cards]  |
|                  |
|  [Widget Cards]  |
|                  |
+------------------+
|   ⚙️        🌿   |  FABs
+------------------+
```

### Hero Section (Mobile)

```css
/* Mobile hero dominates the viewport */
@media (max-width: 768px) {
  .hero-section {
    min-height: 40vh;
    max-height: 50vh;
    padding: 24px 16px;

    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;

    text-align: center;
  }

  .hero-production-number {
    font-size: 64px;
    margin-bottom: 8px;
  }

  .hero-production-unit {
    font-size: 18px;
  }

  /* Mini KPIs stack below number */
  .mini-kpi-grid {
    width: 100%;
    margin-top: 24px;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }

  .mini-kpi-card {
    padding: 12px;
  }

  .mini-kpi-value {
    font-size: 22px;
  }
}

/* Small phones */
@media (max-width: 375px) {
  .hero-production-number {
    font-size: 52px;
  }

  .mini-kpi-grid {
    gap: 8px;
  }
}
```

### Widget Cards (Mobile)

```css
@media (max-width: 768px) {
  /* Full width cards, stacked */
  .widget-card {
    width: 100% !important;
    margin-bottom: 16px;
  }

  /* No drag on mobile - tap to interact */
  .widget-drag-handle {
    display: none;
  }

  /* Larger touch targets for actions */
  .widget-action-btn {
    width: 36px;
    height: 36px;
  }

  /* Slightly more padding */
  .widget-card {
    padding: 16px;
    border-radius: 12px;
  }
}
```

### Header (Mobile)

```css
@media (max-width: 768px) {
  .header {
    height: 56px;
    padding: 8px 16px;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 50;
  }

  /* Account for fixed header */
  .main-content {
    padding-top: 56px;
  }

  /* Hide non-essential header items */
  .header-time .date,
  .header-btn-label {
    display: none;
  }

  /* Stack date picker */
  .date-picker-trigger {
    padding: 8px;
    min-width: auto;
  }
}
```

### Sidebar (Mobile)

```css
@media (max-width: 768px) {
  /* Sidebar becomes overlay drawer */
  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: 280px;
    transform: translateX(-100%);
    transition: transform 400ms var(--ease-spring);
    z-index: 100;
  }

  .sidebar.open {
    transform: translateX(0);
  }

  /* Main content is full width */
  .main-content {
    margin-left: 0;
  }

  /* Backdrop when sidebar open */
  .sidebar-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    opacity: 0;
    visibility: hidden;
    transition: all 300ms ease;
    z-index: 99;
  }

  .sidebar-backdrop.visible {
    opacity: 1;
    visibility: visible;
  }
}
```

---

## 4. Touch Gestures

### Swipe Patterns

| Gesture | Action | Where |
|---------|--------|-------|
| Swipe left on widget | Reveal actions (hide, resize) | Widget cards |
| Swipe right on widget | Collapse/expand | Widget cards |
| Swipe down on hero | Refresh data | Hero section |
| Swipe left on panel | Close panel | Settings, AI Chat |
| Swipe between widgets | Navigate (future) | Widget carousel mode |

### Pull-to-Refresh (Hero)

```css
.hero-section {
  /* Enable overscroll for pull */
  touch-action: pan-y;
  overscroll-behavior-y: contain;
}

.refresh-indicator {
  position: absolute;
  top: -50px;
  left: 50%;
  transform: translateX(-50%);
  opacity: 0;
  transition: all 300ms ease;
}

.hero-section.pulling .refresh-indicator {
  opacity: 1;
  transform: translateX(-50%) translateY(50px);
}

.refresh-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border);
  border-top-color: var(--gold-400);
  border-radius: 50%;
}

.hero-section.refreshing .refresh-spinner {
  animation: spin 1s linear infinite;
}
```

```javascript
// Pull-to-refresh implementation
let startY = 0;
let pulling = false;

const hero = document.querySelector('.hero-section');

hero.addEventListener('touchstart', (e) => {
  if (window.scrollY === 0) {
    startY = e.touches[0].clientY;
  }
});

hero.addEventListener('touchmove', (e) => {
  const currentY = e.touches[0].clientY;
  const diff = currentY - startY;

  if (diff > 0 && window.scrollY === 0) {
    pulling = true;
    hero.classList.add('pulling');

    // Resistance effect
    const resistance = Math.min(diff * 0.4, 80);
    hero.style.transform = `translateY(${resistance}px)`;
  }
});

hero.addEventListener('touchend', () => {
  if (pulling) {
    hero.classList.remove('pulling');
    hero.style.transform = '';

    if (parseFloat(hero.style.transform) > 50) {
      refreshData();
    }

    pulling = false;
  }
});
```

### Widget Swipe Actions

```css
.widget-card {
  touch-action: pan-y;
  position: relative;
  overflow: hidden;
}

.widget-swipe-actions {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 120px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-right: 16px;
  background: linear-gradient(90deg, transparent, var(--bg-card));
  transform: translateX(100%);
  transition: transform 300ms var(--ease-spring);
}

.widget-card.swiped-left .widget-swipe-actions {
  transform: translateX(0);
}

.swipe-action-btn {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.swipe-action-btn.hide {
  background: var(--danger-light);
  color: var(--danger);
}

.swipe-action-btn.resize {
  background: var(--gold-dim);
  color: var(--gold-400);
}
```

```javascript
// Horizontal swipe detection
let touchStartX = 0;
let touchStartY = 0;

document.querySelectorAll('.widget-card').forEach(card => {
  card.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  });

  card.addEventListener('touchmove', (e) => {
    const diffX = touchStartX - e.touches[0].clientX;
    const diffY = touchStartY - e.touches[0].clientY;

    // Horizontal swipe detected
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 30) {
      e.preventDefault();

      if (diffX > 0) {
        card.classList.add('swiped-left');
      } else {
        card.classList.remove('swiped-left');
      }
    }
  });

  card.addEventListener('touchend', () => {
    // Optional: auto-reset after delay
  });
});
```

### Panel Swipe-to-Close

```css
.panel {
  touch-action: pan-x;
}
```

```javascript
// Swipe to close panel
let panelStartX = 0;

const panel = document.querySelector('.panel');

panel.addEventListener('touchstart', (e) => {
  panelStartX = e.touches[0].clientX;
});

panel.addEventListener('touchmove', (e) => {
  const diff = e.touches[0].clientX - panelStartX;

  if (diff > 0) {
    panel.style.transform = `translateX(${diff}px)`;
    panel.style.transition = 'none';
  }
});

panel.addEventListener('touchend', (e) => {
  const diff = e.changedTouches[0].clientX - panelStartX;
  panel.style.transition = '';

  if (diff > 100) {
    closePanel();
  } else {
    panel.style.transform = 'translateX(0)';
  }
});
```

---

## 5. FAB Positioning

### Fixed Position

```css
/* AI Chat FAB - Primary */
.fab-ai {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 90;
}

/* Settings FAB - Secondary */
.fab-settings {
  position: fixed;
  bottom: 88px; /* 24 + 56 + 8 gap */
  right: 24px;
  z-index: 89;
}

/* Mobile adjustments */
@media (max-width: 768px) {
  .fab-ai {
    bottom: 20px;
    right: 20px;
  }

  .fab-settings {
    bottom: 84px;
    right: 20px;
  }

  /* Smaller secondary FAB on mobile */
  .fab-settings .fab-main {
    width: 44px;
    height: 44px;
  }
}

/* Safe area for notched phones */
@supports (padding-bottom: env(safe-area-inset-bottom)) {
  .fab-ai,
  .fab-settings {
    bottom: calc(24px + env(safe-area-inset-bottom));
  }
}
```

### FAB Behavior

```css
/* Hide FABs when keyboard is open */
.keyboard-open .fab-ai,
.keyboard-open .fab-settings {
  transform: translateY(100px);
  opacity: 0;
}

/* Hide when panel is open */
.panel-open .fab-ai,
.panel-open .fab-settings {
  transform: scale(0);
  opacity: 0;
}
```

---

## 6. Panels (Mobile)

### Full-Width Panels

```css
@media (max-width: 768px) {
  .panel {
    width: 100%;
    max-width: none;
    border-left: none;
    border-radius: 24px 24px 0 0;

    /* Slide up from bottom on mobile */
    transform: translateY(100%);
    top: auto;
    bottom: 0;
    height: 85vh;
    max-height: 85vh;
  }

  .panel.open {
    transform: translateY(0);
  }

  /* Drag handle for sheets */
  .panel-drag-handle {
    display: block;
    width: 40px;
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    margin: 8px auto;
  }
}
```

### Bottom Sheet Behavior

```javascript
// Drag to dismiss bottom sheet
let sheetStartY = 0;
let sheetCurrentY = 0;

const panel = document.querySelector('.panel');
const dragHandle = panel.querySelector('.panel-drag-handle');

dragHandle.addEventListener('touchstart', (e) => {
  sheetStartY = e.touches[0].clientY;
});

dragHandle.addEventListener('touchmove', (e) => {
  const diff = e.touches[0].clientY - sheetStartY;

  if (diff > 0) {
    panel.style.transform = `translateY(${diff}px)`;
    panel.style.transition = 'none';
  }
});

dragHandle.addEventListener('touchend', (e) => {
  const diff = e.changedTouches[0].clientY - sheetStartY;
  panel.style.transition = '';

  if (diff > 150) {
    closePanel();
  } else {
    panel.style.transform = 'translateY(0)';
  }
});
```

---

## 7. Typography Scaling

### Mobile Type Scale

```css
@media (max-width: 768px) {
  :root {
    /* Slightly larger for mobile readability */
    --text-body: 15px;
    --text-sm: 14px;
    --text-xs: 12px;
    --text-xxs: 11px;

    /* Headings scale down less */
    --text-h1: 24px;
    --text-h2: 20px;
    --text-h3: 17px;
    --text-h4: 15px;
  }
}

/* Small phones */
@media (max-width: 375px) {
  :root {
    --text-hero: 48px;
    --text-display: 36px;
  }
}
```

### Line Length Control

```css
/* Prevent overly long lines on mobile landscape */
@media (max-width: 768px) and (orientation: landscape) {
  .widget-card p,
  .widget-card li {
    max-width: 60ch;
  }
}
```

---

## 8. Mobile-Specific Components

### Compact KPI Row

```css
@media (max-width: 768px) {
  .kpi-row {
    display: flex;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    gap: 12px;
    padding: 0 16px;
    margin: 0 -16px;

    /* Hide scrollbar but keep functionality */
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .kpi-row::-webkit-scrollbar {
    display: none;
  }

  .kpi-card {
    flex: 0 0 auto;
    width: 140px;
    scroll-snap-align: start;
  }
}
```

### Compact Table (Horizontal Scroll)

```css
@media (max-width: 768px) {
  .table-wrapper {
    overflow-x: auto;
    margin: 0 -16px;
    padding: 0 16px;
  }

  .data-table {
    min-width: 500px; /* Force horizontal scroll */
  }

  /* Sticky first column */
  .data-table th:first-child,
  .data-table td:first-child {
    position: sticky;
    left: 0;
    background: var(--bg-card);
    z-index: 1;
  }
}
```

### Mobile Navigation

```css
@media (max-width: 768px) {
  /* Bottom navigation alternative */
  .bottom-nav {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 64px;
    padding-bottom: env(safe-area-inset-bottom);

    display: flex;
    justify-content: space-around;
    align-items: center;

    background: var(--bg-card);
    border-top: 1px solid var(--border);
    z-index: 50;
  }

  .bottom-nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 8px 16px;
    color: var(--text-muted);
    text-decoration: none;
  }

  .bottom-nav-item.active {
    color: var(--gold-400);
  }

  .bottom-nav-icon {
    width: 24px;
    height: 24px;
  }

  .bottom-nav-label {
    font-size: 10px;
    font-weight: 500;
  }

  /* Adjust content for bottom nav */
  .main-content {
    padding-bottom: calc(64px + env(safe-area-inset-bottom) + 16px);
  }
}
```

---

## 9. Performance Optimizations

### Reduce Animations on Mobile

```css
@media (max-width: 768px) {
  /* Simpler shadows on mobile */
  .widget-card {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  /* Reduce animation complexity */
  .widget-card {
    transition: transform 200ms ease, box-shadow 200ms ease;
  }

  /* Disable non-essential animations */
  .background-drift {
    animation: none;
  }

  /* Simpler hover states (mostly for hybrid devices) */
  .widget-card:hover {
    transform: none;
  }

  .widget-card:active {
    transform: scale(0.98);
  }
}
```

### Image Optimization

```css
/* Lazy load below-fold images */
img[data-src] {
  opacity: 0;
  transition: opacity 300ms ease;
}

img.loaded {
  opacity: 1;
}
```

### Viewport Meta

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

---

## 10. Accessibility on Touch

### Focus Visible

```css
/* Only show focus ring on keyboard navigation */
:focus:not(:focus-visible) {
  outline: none;
}

:focus-visible {
  outline: 2px solid var(--gold-400);
  outline-offset: 2px;
}
```

### Touch Feedback

```css
/* Active states for touch feedback */
.btn:active,
.nav-item:active,
.widget-card:active {
  opacity: 0.8;
  transform: scale(0.98);
}

/* Ripple effect (optional) */
.ripple {
  position: relative;
  overflow: hidden;
}

.ripple::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 100%;
  padding-bottom: 100%;
  background: rgba(228, 170, 79, 0.3);
  border-radius: 50%;
  transform: translate(-50%, -50%) scale(0);
  opacity: 0;
}

.ripple:active::after {
  animation: rippleEffect 400ms ease-out;
}

@keyframes rippleEffect {
  to {
    transform: translate(-50%, -50%) scale(2);
    opacity: 0;
  }
}
```

---

## 11. Testing Checklist

### Devices to Test

- [ ] iPhone SE (375px) - Small phone
- [ ] iPhone 14/15 (390px) - Standard phone
- [ ] iPhone 14/15 Pro Max (428px) - Large phone
- [ ] iPad Mini (768px) - Small tablet
- [ ] iPad (820px) - Standard tablet
- [ ] iPad Pro 12.9" (1024px) - Large tablet

### Touch Testing

- [ ] All buttons/links meet 44px minimum
- [ ] No elements too close together
- [ ] Swipe gestures work consistently
- [ ] Pull-to-refresh triggers correctly
- [ ] Panels slide smoothly
- [ ] FABs are accessible

### Visual Testing

- [ ] Hero number is dominant and readable
- [ ] KPIs visible without scrolling
- [ ] Text is readable at arm's length
- [ ] Sufficient contrast in bright light
- [ ] Dark mode works in low light

### Performance Testing

- [ ] Page loads in < 3 seconds on 4G
- [ ] Smooth 60fps scrolling
- [ ] No jank during animations
- [ ] Responsive to touch immediately

---

## 12. Quick Reference

### Critical Mobile Rules

1. **Hero number**: 64px minimum, centered
2. **Touch targets**: 44px minimum
3. **Spacing**: 16px edge margins
4. **Cards**: Full width, stacked
5. **FABs**: Fixed bottom-right, safe area aware
6. **Panels**: Bottom sheets, 85vh max height
7. **Navigation**: Either sidebar drawer OR bottom nav

### CSS Mobile Reset

```css
@media (max-width: 768px) {
  /* Full-width cards */
  .widget-card { width: 100% !important; }

  /* Hide desktop-only elements */
  .desktop-only { display: none !important; }

  /* Show mobile-only elements */
  .mobile-only { display: block !important; }

  /* No hover effects */
  .widget-card:hover { transform: none; }

  /* Active state instead */
  .widget-card:active { transform: scale(0.98); }

  /* Larger touch targets */
  .btn, .icon-btn { min-height: 44px; min-width: 44px; }

  /* Hide drag handles */
  .widget-drag-handle { display: none; }

  /* Full-width inputs */
  .input, .select { width: 100%; }
}
```

---

**Implementation Note**: When implementing, start with mobile styles as the base and add complexity for larger screens. This ensures the phone experience (primary use case) is optimized first.
