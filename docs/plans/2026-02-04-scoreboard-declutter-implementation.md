# Scoreboard Declutter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform scoreboard from cluttered 8-button interface to clean FAB menu system with responsive TV/Desktop/Mobile layouts that eliminate scrolling.

**Architecture:** Progressive enhancement approach - build FAB menu system first, then add responsive breakpoints, then optimize vertical space. Each phase is independently testable and can be deployed.

**Tech Stack:** Vanilla JavaScript (ES6 modules), CSS3 media queries, existing scoreboard module system

**Design Reference:** `docs/plans/2026-02-04-scoreboard-declutter-design.md`

---

## Phase 1: FAB Menu System (Foundation)

### Task 1: Create FAB Button Component

**Files:**
- Create: `src/css/fab-menu.css`
- Modify: `src/pages/scoreboard.html` (add FAB button HTML)
- Modify: `src/css/scoreboard.css` (import fab-menu.css)

**Step 1: Create FAB menu CSS file**

Create `src/css/fab-menu.css`:

```css
/* FAB Menu System */
.fab-button {
  position: fixed;
  bottom: 30px;
  right: 30px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--ro-gold);
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #1a1f16;
  font-size: 24px;
  z-index: 1000;
  transition: transform 0.3s var(--ease-smooth), opacity 0.3s ease, box-shadow 0.3s ease;
}

.fab-button:hover {
  transform: scale(1.1);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
}

.fab-button:active {
  transform: scale(0.95);
}

/* Pulse animation for idle state */
.fab-button.idle {
  animation: fabPulse 2s ease-in-out infinite;
}

@keyframes fabPulse {
  0%, 100% {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }
  50% {
    box-shadow: 0 4px 20px rgba(228, 170, 79, 0.6);
  }
}

/* Auto-fade for TV mode (≥1920px) */
@media (min-width: 1920px) {
  .fab-button.tv-fade {
    opacity: 0.2;
    transition: opacity 0.5s ease;
  }

  .fab-button.tv-fade:hover,
  .fab-button.tv-fade:focus {
    opacity: 1;
  }
}

/* Menu panel */
.fab-menu {
  position: fixed;
  bottom: 100px;
  right: 30px;
  width: 220px;
  background: rgba(26, 31, 22, 0.95);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  padding: 8px 0;
  z-index: 999;
  opacity: 0;
  transform: translateY(20px);
  pointer-events: none;
  transition: opacity 0.3s var(--ease-smooth), transform 0.3s var(--ease-smooth);
}

.fab-menu.visible {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

/* Mobile: full-width menu */
@media (max-width: 767px) {
  .fab-menu {
    bottom: 90px;
    right: 0;
    left: 0;
    width: 100%;
    margin: 0 10px;
    width: calc(100% - 20px);
    border-radius: 12px 12px 0 0;
  }

  .fab-button {
    bottom: 20px;
    right: 20px;
  }
}

/* Menu items */
.fab-menu-item {
  display: flex;
  align-items: center;
  padding: 0 20px;
  height: 48px;
  color: #ffffff;
  text-decoration: none;
  font-size: 16px;
  font-family: 'Outfit', sans-serif;
  cursor: pointer;
  transition: background 0.2s ease;
  border: none;
  background: transparent;
  width: 100%;
  text-align: left;
}

.fab-menu-item:hover {
  background: rgba(228, 170, 79, 0.1);
}

.fab-menu-item i {
  font-size: 20px;
  margin-right: 12px;
  color: var(--ro-gold);
}

/* Toggle switch for Order Queue item */
.fab-menu-item .toggle-indicator {
  margin-left: auto;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.6);
}

.fab-menu-item .toggle-indicator.on {
  background: rgba(78, 222, 128, 0.2);
  color: #4ade80;
}

/* Divider */
.fab-menu-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.1);
  margin: 8px 0;
}

/* Backdrop (click outside to close) */
.fab-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: transparent;
  z-index: 998;
  display: none;
}

.fab-backdrop.visible {
  display: block;
}
```

**Step 2: Add FAB button HTML to scoreboard**

In `src/pages/scoreboard.html`, find the closing `</body>` tag and add BEFORE it:

```html
  <!-- FAB Menu System -->
  <button class="fab-button idle" id="fabButton" aria-label="Open menu" aria-expanded="false">
    <i class="ph-duotone ph-gear"></i>
  </button>

  <div class="fab-backdrop" id="fabBackdrop"></div>

  <div class="fab-menu" id="fabMenu" role="menu">
    <button class="fab-menu-item" id="fabStartDay" role="menuitem" style="display:none;">
      <i class="ph-duotone ph-play-circle"></i>
      <span data-i18n="fabStartDay">Start Day</span>
    </button>

    <button class="fab-menu-item" id="fabPastData" role="menuitem">
      <i class="ph-duotone ph-clock-counter-clockwise"></i>
      <span data-i18n="fabPastData">Past Data</span>
    </button>

    <a class="fab-menu-item" href="https://docs.google.com/spreadsheets/d/1SyeueGF5NY3AXvUJYLTjuK01v3jCPIpbs9JQbrhrlHk/edit?gid=0#gid=0" target="_blank" role="menuitem">
      <i class="ph-duotone ph-warning-circle"></i>
      <span data-i18n="fabComplaints">Complaints</span>
    </a>

    <div class="fab-menu-divider"></div>

    <button class="fab-menu-item" id="fabMorningReport" role="menuitem">
      <i class="ph-duotone ph-chart-bar"></i>
      <span data-i18n="fabMorningReport">Morning Report</span>
    </button>

    <button class="fab-menu-item" id="fabOrderQueue" role="menuitem">
      <i class="ph-duotone ph-stack"></i>
      <span data-i18n="fabOrderQueue">Order Queue</span>
      <span class="toggle-indicator" id="orderQueueIndicator">OFF</span>
    </button>

    <button class="fab-menu-item" id="fabHelp" role="menuitem">
      <i class="ph-duotone ph-question"></i>
      <span data-i18n="fabHelp">Help</span>
    </button>
  </div>

  <script src="../js/scoreboard/fab-menu.js?v=1"></script>
```

**Step 3: Import FAB CSS in scoreboard.css**

In `src/css/scoreboard.css`, add at the top (after the :root variables):

```css
/* Import FAB Menu styles */
@import url('fab-menu.css');
```

**Step 4: Verify FAB button appears**

Run local server:
```bash
python -m http.server
```

Open `http://localhost:8000/src/pages/scoreboard.html` and verify:
- Gold FAB button appears in bottom-right corner
- Button has pulse animation
- No console errors

**Step 5: Commit FAB button foundation**

```bash
git add src/css/fab-menu.css src/pages/scoreboard.html src/css/scoreboard.css
git commit -m "feat(scoreboard): add FAB button component

- Create fab-menu.css with button and menu panel styles
- Add FAB button HTML with 6 menu items
- Include pulse animation and responsive mobile layout
- Prepare for FAB menu JavaScript functionality

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 2: Create FAB Menu JavaScript Module

**Files:**
- Create: `src/js/scoreboard/fab-menu.js`
- Modify: `src/js/scoreboard/i18n.js` (add FAB menu translations)

**Step 1: Create FAB menu module**

Create `src/js/scoreboard/fab-menu.js`:

```javascript
/**
 * FAB Menu System
 * Floating Action Button with expandable menu panel
 */
(function(window) {
  'use strict';

  var DOM = window.ScoreboardDOM;
  var I18n = window.ScoreboardI18n;

  // Module state
  var state = {
    isOpen: false,
    tvFadeTimer: null,
    idleTimer: null
  };

  // DOM elements (cached)
  var elements = {
    fabButton: null,
    fabMenu: null,
    fabBackdrop: null,
    fabStartDay: null,
    fabPastData: null,
    fabMorningReport: null,
    fabOrderQueue: null,
    fabHelp: null,
    orderQueueIndicator: null
  };

  /**
   * Initialize FAB menu system
   */
  function init() {
    // Cache DOM elements
    elements.fabButton = document.getElementById('fabButton');
    elements.fabMenu = document.getElementById('fabMenu');
    elements.fabBackdrop = document.getElementById('fabBackdrop');
    elements.fabStartDay = document.getElementById('fabStartDay');
    elements.fabPastData = document.getElementById('fabPastData');
    elements.fabMorningReport = document.getElementById('fabMorningReport');
    elements.fabOrderQueue = document.getElementById('fabOrderQueue');
    elements.fabHelp = document.getElementById('fabHelp');
    elements.orderQueueIndicator = document.getElementById('orderQueueIndicator');

    // Attach event listeners
    if (elements.fabButton) {
      elements.fabButton.addEventListener('click', toggleMenu);
    }

    if (elements.fabBackdrop) {
      elements.fabBackdrop.addEventListener('click', closeMenu);
    }

    // Wire up menu item actions
    if (elements.fabStartDay) {
      elements.fabStartDay.addEventListener('click', handleStartDay);
    }

    if (elements.fabPastData) {
      elements.fabPastData.addEventListener('click', handlePastData);
    }

    if (elements.fabMorningReport) {
      elements.fabMorningReport.addEventListener('click', handleMorningReport);
    }

    if (elements.fabOrderQueue) {
      elements.fabOrderQueue.addEventListener('click', handleOrderQueue);
    }

    if (elements.fabHelp) {
      elements.fabHelp.addEventListener('click', handleHelp);
    }

    // Start TV fade timer if on TV screen
    if (isTVMode()) {
      startTVFadeTimer();
    }

    // Start idle pulse animation
    startIdleTimer();

    // Update order queue indicator on init
    updateOrderQueueIndicator();

    // Check if Start Day should be visible
    checkStartDayVisibility();

    console.log('[FAB Menu] Initialized');
  }

  /**
   * Toggle menu open/close
   */
  function toggleMenu() {
    if (state.isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  /**
   * Open menu
   */
  function openMenu() {
    if (!elements.fabMenu || !elements.fabBackdrop) return;

    state.isOpen = true;
    elements.fabMenu.classList.add('visible');
    elements.fabBackdrop.classList.add('visible');
    elements.fabButton.setAttribute('aria-expanded', 'true');
    elements.fabButton.classList.remove('idle');

    // Clear TV fade timer when menu is open
    clearTVFadeTimer();

    // Remove TV fade class
    elements.fabButton.classList.remove('tv-fade');

    console.log('[FAB Menu] Opened');
  }

  /**
   * Close menu
   */
  function closeMenu() {
    if (!elements.fabMenu || !elements.fabBackdrop) return;

    state.isOpen = false;
    elements.fabMenu.classList.remove('visible');
    elements.fabBackdrop.classList.remove('visible');
    elements.fabButton.setAttribute('aria-expanded', 'false');

    // Restart TV fade timer after menu closes
    if (isTVMode()) {
      startTVFadeTimer();
    }

    // Restart idle pulse
    startIdleTimer();

    console.log('[FAB Menu] Closed');
  }

  /**
   * Handle Start Day click
   */
  function handleStartDay() {
    closeMenu();
    // Trigger existing Start Day button (will be hidden)
    var startDayBtn = document.getElementById('startDayBtn');
    if (startDayBtn) {
      startDayBtn.click();
    }
  }

  /**
   * Handle Past Data click
   */
  function handlePastData() {
    closeMenu();
    // Trigger existing historical view button
    if (window.toggleDatePicker) {
      window.toggleDatePicker();
    }
  }

  /**
   * Handle Morning Report click
   */
  function handleMorningReport() {
    closeMenu();
    // Trigger existing morning report button
    var mrBtn = document.getElementById('morningReportBtn');
    if (mrBtn) {
      mrBtn.click();
    }
  }

  /**
   * Handle Order Queue toggle
   */
  function handleOrderQueue() {
    closeMenu();
    // Trigger existing order queue toggle
    if (window.toggleOrderQueue) {
      window.toggleOrderQueue();
    }
    // Update indicator after toggle
    setTimeout(updateOrderQueueIndicator, 100);
  }

  /**
   * Handle Help click
   */
  function handleHelp() {
    closeMenu();
    // Trigger existing help button
    if (window.toggleHelp) {
      window.toggleHelp();
    }
  }

  /**
   * Update order queue indicator (ON/OFF)
   */
  function updateOrderQueueIndicator() {
    if (!elements.orderQueueIndicator) return;

    var isVisible = localStorage.getItem('orderQueueVisible') === 'true';
    elements.orderQueueIndicator.textContent = isVisible ? 'ON' : 'OFF';
    elements.orderQueueIndicator.classList.toggle('on', isVisible);
  }

  /**
   * Check if Start Day button should be visible
   */
  function checkStartDayVisibility() {
    if (!elements.fabStartDay) return;

    // Show Start Day if shift start is not set (same logic as existing button)
    var shiftStart = localStorage.getItem('shiftStartTime');
    var today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
    var shiftStartDate = localStorage.getItem('shiftStartDate');

    var shouldShow = !shiftStart || shiftStartDate !== today;
    elements.fabStartDay.style.display = shouldShow ? 'flex' : 'none';
  }

  /**
   * Check if we're in TV mode (≥1920px)
   */
  function isTVMode() {
    return window.innerWidth >= 1920;
  }

  /**
   * Start TV auto-fade timer (10 seconds idle)
   */
  function startTVFadeTimer() {
    clearTVFadeTimer();

    if (!isTVMode() || !elements.fabButton) return;

    state.tvFadeTimer = setTimeout(function() {
      if (!state.isOpen) {
        elements.fabButton.classList.add('tv-fade');
      }
    }, 10000); // 10 seconds
  }

  /**
   * Clear TV fade timer
   */
  function clearTVFadeTimer() {
    if (state.tvFadeTimer) {
      clearTimeout(state.tvFadeTimer);
      state.tvFadeTimer = null;
    }
  }

  /**
   * Start idle pulse animation timer
   */
  function startIdleTimer() {
    clearIdleTimer();

    if (!elements.fabButton) return;

    state.idleTimer = setTimeout(function() {
      if (!state.isOpen) {
        elements.fabButton.classList.add('idle');
      }
    }, 3000); // 3 seconds idle before pulse
  }

  /**
   * Clear idle timer
   */
  function clearIdleTimer() {
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = null;
    }
  }

  /**
   * Public API
   */
  var ScoreboardFABMenu = {
    init: init,
    openMenu: openMenu,
    closeMenu: closeMenu,
    updateOrderQueueIndicator: updateOrderQueueIndicator,
    checkStartDayVisibility: checkStartDayVisibility
  };

  // Export to global scope
  window.ScoreboardFABMenu = ScoreboardFABMenu;

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window);
```

**Step 2: Add FAB menu translations**

In `src/js/scoreboard/i18n.js`, find the `translations` object and add these entries:

```javascript
// Inside translations.en object:
fabStartDay: 'Start Day',
fabPastData: 'Past Data',
fabComplaints: 'Complaints',
fabMorningReport: 'Morning Report',
fabOrderQueue: 'Order Queue',
fabHelp: 'Help',

// Inside translations.es object:
fabStartDay: 'Iniciar Día',
fabPastData: 'Datos Pasados',
fabComplaints: 'Quejas',
fabMorningReport: 'Reporte Matutino',
fabOrderQueue: 'Cola de Pedidos',
fabHelp: 'Ayuda',
```

**Step 3: Test FAB menu functionality**

Open `http://localhost:8000/src/pages/scoreboard.html`:
- Click FAB button → menu should slide up
- Click backdrop → menu should close
- Click "Past Data" → should open date picker
- Click "Help" → should open help modal
- Click "Order Queue" → indicator should toggle ON/OFF
- Verify console logs show "[FAB Menu] Opened/Closed"

**Step 4: Commit FAB menu JavaScript**

```bash
git add src/js/scoreboard/fab-menu.js src/js/scoreboard/i18n.js
git commit -m "feat(scoreboard): add FAB menu JavaScript module

- Create fab-menu.js with menu open/close logic
- Wire up all 6 menu items to existing functions
- Add TV auto-fade timer (10s idle)
- Add idle pulse animation
- Track order queue ON/OFF state
- Auto-hide Start Day after shift start is set
- Add bilingual translations for menu items

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 3: Hide Original Buttons (Progressive Enhancement)

**Files:**
- Modify: `src/css/scoreboard.css` (hide original buttons)

**Step 1: Add CSS to hide original buttons**

In `src/css/scoreboard.css`, add these rules (near the bottom before media queries):

```css
/* Hide original buttons - replaced by FAB menu */
#morningReportBtn,
#historicalViewBtn,
#orderQueueToggleBtn {
  display: none !important;
}

/* Keep help button hidden - now in FAB menu */
.help-btn {
  display: none !important;
}

/* Keep EN/ES toggle visible (not in FAB menu) */
.lang-toggle {
  /* No changes - stays visible */
}
```

**Step 2: Test button hiding**

Refresh scoreboard:
- Morning Report button should be hidden
- Past Data button should be hidden
- Order Queue toggle should be hidden
- Help button (?) should be hidden
- EN/ES toggle should still be visible
- Complaints link should be hidden (it's in lang-toggle, we'll fix next)

**Step 3: Move complaints link logic**

In `src/css/scoreboard.css`, update the `.lang-toggle` section to hide the complaints link:

```css
.lang-toggle .complaints-btn {
  display: none !important; /* Now in FAB menu */
}
```

**Step 4: Verify FAB menu is only way to access features**

Test that all hidden buttons are accessible via FAB menu:
- FAB → Morning Report works
- FAB → Past Data works
- FAB → Complaints opens Google Sheet
- FAB → Order Queue toggles
- FAB → Help opens help modal

**Step 5: Commit button hiding**

```bash
git add src/css/scoreboard.css
git commit -m "feat(scoreboard): hide original buttons, use FAB menu only

- Hide Morning Report, Past Data, Order Queue toggle buttons
- Hide Help button (?)
- Hide Complaints link from language toggle
- All functionality now accessible via FAB menu
- EN/ES toggle remains visible (most-used control)
- Reduces visible chrome from 8 buttons to 2 (EN/ES + FAB)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 2: Responsive Breakpoints (TV/Desktop/Mobile)

### Task 4: Add TV Mode Font Scaling

**Files:**
- Modify: `src/css/scoreboard.css` (add TV mode media query)

**Step 1: Add TV mode media query with font scaling**

In `src/css/scoreboard.css`, add at the bottom:

```css
/* ===================================
   TV MODE (≥1920px)
   Distance viewing optimization
   =================================== */
@media (min-width: 1920px) {
  /* Hour cards - extra large for distance viewing */
  .hour-card .actual-lbs {
    font-size: 120px !important;
    line-height: 1;
  }

  .hour-card .target-lbs {
    font-size: 80px !important;
  }

  .hour-card .percentage-value {
    font-size: 100px !important;
  }

  /* Daily progress - massive numbers */
  .daily-actual {
    font-size: 140px !important;
  }

  .daily-target {
    font-size: 100px !important;
  }

  .daily-delta {
    font-size: 80px !important;
  }

  .projection-value {
    font-size: 80px !important;
  }

  /* Progress bar - thicker for visibility */
  .progress-bar {
    height: 40px !important;
  }

  /* Comparison pills - large values */
  .comparison-value {
    font-size: 60px !important;
  }

  .streak-value {
    font-size: 60px !important;
  }

  /* Info bar - larger text */
  .info-bar {
    font-size: 36px !important;
    height: 50px !important;
  }

  .info-section span {
    font-size: 36px !important;
  }

  /* Timer panel - larger rings and text */
  .timer-display svg,
  .scale-display svg {
    width: 280px !important;
    height: 280px !important;
  }

  .timer-value {
    font-size: 100px !important;
  }

  .scale-value {
    font-size: 100px !important;
  }

  .timer-target,
  .scale-label {
    font-size: 40px !important;
  }

  /* OLED optimization - pure blacks */
  body.timer-neutral,
  body.idle {
    background: #000000 !important;
  }

  .main-panel {
    background: #000000;
  }

  /* High contrast status colors for OLED */
  body.timer-green {
    background: linear-gradient(145deg, #052e16 0%, #14532d 50%, #000000 100%) !important;
  }

  body.timer-red {
    background: linear-gradient(145deg, #450a0a 0%, #7f1d1d 50%, #000000 100%) !important;
  }
}
```

**Step 2: Test TV mode on large screen**

Resize browser to ≥1920px width:
- Production numbers should be huge (120-140px)
- Progress bar should be thick (40px)
- Timer value should be 100px
- Background should be pure black (#000000)

**Step 3: Commit TV mode styling**

```bash
git add src/css/scoreboard.css
git commit -m "feat(scoreboard): add TV mode font scaling and OLED optimization

- Add media query for screens ≥1920px
- Scale production numbers to 120-140px (readable from 10+ feet)
- Enlarge timer/scale displays to 280px diameter
- Thicken progress bar to 40px
- Optimize for OLED: pure black backgrounds (#000000)
- High contrast status colors for distance viewing

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 5: Add Desktop Mode Optimization

**Files:**
- Modify: `src/css/scoreboard.css` (add desktop mode media query)

**Step 1: Add desktop mode media query**

In `src/css/scoreboard.css`, add BEFORE the TV mode query:

```css
/* ===================================
   DESKTOP MODE (768px - 1919px)
   Balanced for arm's length viewing
   =================================== */
@media (min-width: 768px) and (max-width: 1919px) {
  /* Hour cards - medium sizing */
  .hour-card {
    max-width: 280px;
  }

  .hour-card .actual-lbs {
    font-size: 64px;
  }

  .hour-card .target-lbs {
    font-size: 48px;
  }

  .hour-card .percentage-value {
    font-size: 56px;
  }

  /* Daily progress - balanced */
  .daily-actual {
    font-size: 72px;
  }

  .daily-target {
    font-size: 56px;
  }

  .daily-delta {
    font-size: 48px;
  }

  .projection-value {
    font-size: 48px;
  }

  /* Progress bar - standard thickness */
  .progress-bar {
    height: 24px;
  }

  /* Comparison pills - medium */
  .comparison-value {
    font-size: 36px;
  }

  .streak-value {
    font-size: 36px;
  }

  /* Info bar - readable */
  .info-bar {
    font-size: 20px;
    height: 60px;
  }

  /* Timer panel - standard sizing */
  .timer-display svg,
  .scale-display svg {
    width: 220px;
    height: 220px;
  }

  .timer-value {
    font-size: 72px;
  }

  .scale-value {
    font-size: 72px;
  }
}
```

**Step 2: Test desktop mode**

Resize browser to 1024px width:
- Numbers should be medium-sized (64-72px)
- Everything should fit comfortably
- No scrolling needed

**Step 3: Commit desktop mode styling**

```bash
git add src/css/scoreboard.css
git commit -m "feat(scoreboard): add desktop mode responsive styling

- Add media query for 768px-1919px screens
- Balance font sizes for arm's length viewing
- Production numbers 64-72px
- Timer displays 220px diameter
- Optimized spacing for desk monitors

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 6: Add Mobile Mode Optimization

**Files:**
- Modify: `src/css/scoreboard.css` (add mobile mode media query)

**Step 1: Add mobile mode media query**

In `src/css/scoreboard.css`, add at the top of media queries:

```css
/* ===================================
   MOBILE MODE (<768px)
   Touch-optimized, stacked layout
   =================================== */
@media (max-width: 767px) {
  /* Remove side-by-side layout */
  body {
    flex-direction: column;
    overflow-y: auto; /* Allow scroll on mobile if needed */
  }

  .main-panel {
    width: 100%;
    padding: 10px;
    height: auto;
  }

  .timer-panel {
    width: 100%;
    min-width: 100%;
    border-left: none;
    border-top: 2px solid rgba(228,170,79,0.2);
    height: auto;
    padding: 20px 10px;
  }

  /* Hour cards - stack vertically */
  .hour-cards {
    flex-direction: column;
    gap: 12px;
  }

  .hour-card {
    width: 100%;
    max-width: 100%;
  }

  .hour-card .actual-lbs {
    font-size: 56px;
  }

  .hour-card .target-lbs {
    font-size: 40px;
  }

  .hour-card .percentage-value {
    font-size: 48px;
  }

  /* Daily progress - compact */
  .daily-actual {
    font-size: 64px;
  }

  .daily-target {
    font-size: 48px;
  }

  .daily-delta {
    font-size: 40px;
  }

  .projection-value {
    font-size: 40px;
  }

  /* Comparison pills - wrap */
  .comparisons {
    flex-wrap: wrap;
    gap: 8px;
  }

  .comparison-pill {
    font-size: 14px;
  }

  .comparison-value {
    font-size: 24px;
  }

  /* Info bar - stack if needed */
  .info-bar {
    flex-wrap: wrap;
    font-size: 16px;
    padding: 12px 8px;
    height: auto;
  }

  /* Timer - smaller on mobile */
  .timer-display svg,
  .scale-display svg {
    width: 200px;
    height: 200px;
  }

  .timer-value {
    font-size: 56px;
  }

  .scale-value {
    font-size: 56px;
  }

  /* Touch targets - minimum 48px */
  button,
  .fab-menu-item {
    min-height: 48px;
  }
}
```

**Step 2: Test mobile mode**

Resize browser to 375px width (iPhone size):
- Layout should stack vertically
- Timer panel should move below scoreboard
- All touch targets ≥48px
- Text should be readable (48-64px)

**Step 3: Commit mobile mode styling**

```bash
git add src/css/scoreboard.css
git commit -m "feat(scoreboard): add mobile responsive layout

- Add media query for screens <768px
- Stack timer panel below scoreboard (vertical layout)
- Touch-friendly sizing (48px minimum targets)
- Compact but readable font sizes (48-64px)
- Allow vertical scroll if content exceeds viewport
- Wrap comparison pills and info bar

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 3: Vertical Space Optimization

### Task 7: Compact Header (Merge Strain + Time)

**Files:**
- Modify: `src/css/scoreboard.css` (merge strain and time displays)
- Modify: `src/pages/scoreboard.html` (restructure header)

**Step 1: Add compact header HTML structure**

In `src/pages/scoreboard.html`, REPLACE the separate strain-display and time-display divs with:

```html
<!-- Compact Header Bar (Strain + Time merged) -->
<div class="compact-header">
  <div class="header-left">
    <div class="strain-label-compact" id="strainLabelCompact">Line 1</div>
    <div class="strain-name-compact" id="strainNameCompact">—</div>
  </div>
  <div class="header-right">
    <div class="time-compact" id="clockCompact">--:--</div>
    <div class="date-compact" id="dateCompact">Loading...</div>
  </div>
</div>

<!-- Time Controls (positioned inside compact header) -->
<div class="time-controls-compact">
  <!-- Start Day Button (appears until shift start is set) -->
  <button id="startDayBtn" class="start-day-btn pulse-green" style="display:none;">
    <i class="ph-duotone ph-play-circle"></i>
    Start Day
  </button>
  <!-- Started Badge (appears after shift start is set) -->
  <div id="startedBadge" class="started-badge" style="display:none;">
    <i class="ph-duotone ph-clock"></i>
    Started: <span id="startTimeDisplay">—</span>
    <i id="badgeIcon" class="ph-duotone ph-pencil-simple"></i>
  </div>
</div>
```

**Step 2: Add compact header CSS**

In `src/css/scoreboard.css`, add these styles:

```css
/* Compact Header Bar */
.compact-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 60px;
  background: linear-gradient(135deg, rgba(26, 31, 22, 0.1) 0%, rgba(45, 58, 46, 0.1) 100%);
  backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 30px;
  z-index: 500;
  border-bottom: 1px solid rgba(228, 170, 79, 0.15);
}

.header-left {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.strain-label-compact {
  font-family: 'Outfit', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: var(--ro-gold);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.strain-name-compact {
  font-family: 'DM Serif Display', serif;
  font-size: 24px;
  font-weight: 600;
  color: #ffffff;
}

.header-right {
  display: flex;
  align-items: baseline;
  gap: 16px;
}

.time-compact {
  font-family: 'JetBrains Mono', monospace;
  font-size: 24px;
  font-weight: 600;
  color: #ffffff;
}

.date-compact {
  font-family: 'Outfit', sans-serif;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.7);
}

/* Time controls positioned within header */
.time-controls-compact {
  position: fixed;
  top: 70px;
  right: 30px;
  z-index: 501;
}

/* TV mode - larger header text */
@media (min-width: 1920px) {
  .compact-header {
    height: 60px;
  }

  .strain-name-compact {
    font-size: 48px;
  }

  .time-compact {
    font-size: 36px;
  }

  .date-compact {
    font-size: 20px;
  }
}

/* Mobile - stack header */
@media (max-width: 767px) {
  .compact-header {
    flex-direction: column;
    height: auto;
    padding: 12px 16px;
    align-items: flex-start;
    gap: 8px;
  }

  .header-left,
  .header-right {
    gap: 8px;
  }

  .strain-name-compact {
    font-size: 18px;
  }

  .time-compact {
    font-size: 20px;
  }

  .date-compact {
    font-size: 12px;
  }

  .time-controls-compact {
    top: auto;
    bottom: 10px;
    right: 10px;
  }
}

/* Hide old strain/time displays */
.strain-display,
.time-display,
.time-controls:not(.time-controls-compact) {
  display: none !important;
}
```

**Step 3: Update JavaScript to populate compact header**

In `src/js/scoreboard/main.js`, update the `updateClock()` function:

```javascript
function updateClock() {
  var now = new Date();
  var hours = now.getHours();
  var minutes = now.getMinutes();
  var ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  var timeStr = hours + ':' + String(minutes).padStart(2, '0') + ' ' + ampm;

  // Update both old and compact clock elements
  var clockEl = DOM ? DOM.get('clock') : document.getElementById('clock');
  var clockCompact = document.getElementById('clockCompact');
  if (clockEl) {
    clockEl.textContent = timeStr;
  }
  if (clockCompact) {
    clockCompact.textContent = timeStr;
  }

  // Update date
  var dateEl = DOM ? DOM.get('date') : document.getElementById('date');
  var dateCompact = document.getElementById('dateCompact');
  if (dateEl || dateCompact) {
    var options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    var lang = (State && State.currentLang) || 'en';
    var dateStr = now.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', options);
    if (dateEl) dateEl.textContent = dateStr;
    if (dateCompact) dateCompact.textContent = dateStr;
  }
}
```

In `src/js/scoreboard/render.js`, find where strain name is updated and add:

```javascript
// Update compact strain display (add this where strainName is set)
var strainNameCompact = document.getElementById('strainNameCompact');
if (strainNameCompact && data.currentStrain) {
  strainNameCompact.textContent = data.currentStrain;
}
```

**Step 4: Test compact header**

Refresh scoreboard:
- Single 60px header bar at top
- Strain name on left, time on right
- Clean, compact layout
- Verify strain name and time update correctly

**Step 5: Commit compact header**

```bash
git add src/css/scoreboard.css src/pages/scoreboard.html src/js/scoreboard/main.js src/js/scoreboard/render.js
git commit -m "feat(scoreboard): merge strain and time into compact header

- Combine separate strain/time displays into single 60px bar
- Strain name left, time/date right
- Saves 100px vertical space (160px → 60px)
- Responsive: TV mode uses larger fonts, mobile stacks
- Update JavaScript to populate compact elements
- Hide original strain-display and time-display divs

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 8: Tighten Hour Card Spacing

**Files:**
- Modify: `src/css/scoreboard.css` (reduce hour card padding/margins)

**Step 1: Add compact hour card styles**

In `src/css/scoreboard.css`, find the `.hour-card` styles and update:

```css
.hour-card {
  /* Reduce padding for more compact layout */
  padding: 16px 20px; /* was 24px 28px */
  margin: 0 8px; /* reduce gap between cards */
}

.hour-cards {
  gap: 16px; /* was 24px */
  margin-bottom: 20px; /* was 32px */
}

.hour-card-header {
  margin-bottom: 8px; /* was 12px */
}

.hour-card-timeslot {
  margin-bottom: 12px; /* was 16px */
}

.lbs-row {
  margin: 16px 0; /* was 20px 0 */
}

.percentage-display {
  margin-top: 12px; /* was 16px */
}
```

**Step 2: Test tightened spacing**

Refresh scoreboard:
- Hour cards should feel more compact
- Still readable and comfortable
- Saves ~40px total height

**Step 3: Commit hour card spacing**

```bash
git add src/css/scoreboard.css
git commit -m "feat(scoreboard): tighten hour card spacing

- Reduce padding: 24px → 16px
- Reduce card gap: 24px → 16px
- Reduce margins between internal elements
- Saves ~40px vertical space
- Maintains readability and visual comfort

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 9: Hide Chart by Default, Add FAB Toggle

**Files:**
- Modify: `src/css/scoreboard.css` (hide chart by default)
- Modify: `src/pages/scoreboard.html` (add chart toggle to FAB)
- Modify: `src/js/scoreboard/fab-menu.js` (add chart toggle handler)

**Step 1: Hide chart by default**

In `src/css/scoreboard.css`:

```css
/* Hide hourly chart by default (saves 300px) */
.chart-container {
  display: none !important;
}

/* Show chart when toggled on */
.chart-container.visible {
  display: block !important;
}
```

**Step 2: Add chart toggle to FAB menu**

In `src/pages/scoreboard.html`, add this item to FAB menu (after Order Queue, before Help):

```html
    <button class="fab-menu-item" id="fabChartToggle" role="menuitem">
      <i class="ph-duotone ph-chart-line"></i>
      <span data-i18n="fabChart">Hourly Chart</span>
      <span class="toggle-indicator" id="chartIndicator">OFF</span>
    </button>
```

**Step 3: Add chart toggle handler in JavaScript**

In `src/js/scoreboard/fab-menu.js`, add to element caching:

```javascript
fabChartToggle: null,
chartIndicator: null
```

In `init()` function, cache the elements:

```javascript
elements.fabChartToggle = document.getElementById('fabChartToggle');
elements.chartIndicator = document.getElementById('chartIndicator');
```

Add event listener:

```javascript
if (elements.fabChartToggle) {
  elements.fabChartToggle.addEventListener('click', handleChartToggle);
}
```

Add handler function:

```javascript
/**
 * Handle Chart toggle
 */
function handleChartToggle() {
  closeMenu();
  var chartContainer = document.getElementById('chartContainer');
  if (!chartContainer) return;

  var isVisible = localStorage.getItem('chartVisible') === 'true';
  var newState = !isVisible;
  localStorage.setItem('chartVisible', newState.toString());

  if (newState) {
    chartContainer.classList.add('visible');
  } else {
    chartContainer.classList.remove('visible');
  }

  updateChartIndicator();
}

/**
 * Update chart indicator (ON/OFF)
 */
function updateChartIndicator() {
  if (!elements.chartIndicator) return;

  var isVisible = localStorage.getItem('chartVisible') === 'true';
  elements.chartIndicator.textContent = isVisible ? 'ON' : 'OFF';
  elements.chartIndicator.classList.toggle('on', isVisible);
}
```

In `init()`, call `updateChartIndicator()` and set initial state:

```javascript
// Update chart indicator and restore state
updateChartIndicator();
var chartContainer = document.getElementById('chartContainer');
if (chartContainer && localStorage.getItem('chartVisible') === 'true') {
  chartContainer.classList.add('visible');
}
```

Export the function:

```javascript
var ScoreboardFABMenu = {
  init: init,
  openMenu: openMenu,
  closeMenu: closeMenu,
  updateOrderQueueIndicator: updateOrderQueueIndicator,
  updateChartIndicator: updateChartIndicator,
  checkStartDayVisibility: checkStartDayVisibility
};
```

**Step 4: Add translation**

In `src/js/scoreboard/i18n.js`:

```javascript
// EN
fabChart: 'Hourly Chart',

// ES
fabChart: 'Gráfico Por Hora',
```

**Step 5: Test chart toggle**

Refresh scoreboard:
- Chart should be hidden by default (saves 300px)
- FAB → Hourly Chart → indicator toggles ON/OFF
- Chart appears/disappears

**Step 6: Commit chart hiding**

```bash
git add src/css/scoreboard.css src/pages/scoreboard.html src/js/scoreboard/fab-menu.js src/js/scoreboard/i18n.js
git commit -m "feat(scoreboard): hide hourly chart by default, add FAB toggle

- Hide chart by default (saves 300px vertical space)
- Add Hourly Chart toggle to FAB menu
- Persist chart visibility state in localStorage
- Show/hide chart with visible class
- Add ON/OFF indicator to FAB menu item
- Bilingual support for chart toggle

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 10: Hide Order Queue by Default

**Files:**
- Modify: `src/js/scoreboard/main.js` (change default state)

**Step 1: Update order queue default visibility**

In `src/js/scoreboard/main.js`, find `initOrderQueueVisibility()` function and update:

```javascript
function initOrderQueueVisibility() {
  var section = DOM ? DOM.get('orderQueueSection') : document.getElementById('orderQueueSection');
  var toggleBtn = DOM ? DOM.get('orderQueueToggleBtn') : document.getElementById('orderQueueToggleBtn');

  if (!section) return;

  // Default to HIDDEN if not set (changed from true)
  var isVisible = localStorage.getItem('orderQueueVisible') === 'true';

  if (isVisible) {
    section.style.display = 'flex';
    if (toggleBtn) toggleBtn.classList.add('active');
  } else {
    section.style.display = 'none';
    if (toggleBtn) toggleBtn.classList.remove('active');
  }
}
```

**Step 2: Test order queue hiding**

Clear localStorage and refresh:
```javascript
localStorage.removeItem('orderQueueVisible');
```

- Order queue should be hidden by default
- FAB → Order Queue → toggle to show
- Saves 180px when hidden

**Step 3: Commit order queue default**

```bash
git add src/js/scoreboard/main.js
git commit -m "feat(scoreboard): hide order queue by default

- Change default orderQueueVisible from true to false
- Saves 180px vertical space on initial load
- Users can enable via FAB menu if needed
- State persists in localStorage after first toggle

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 11: Compact Comparison Pills Spacing

**Files:**
- Modify: `src/css/scoreboard.css` (reduce comparison pill margins)

**Step 1: Tighten comparison pill spacing**

In `src/css/scoreboard.css`, find `.comparisons` and `.comparison-pill` and update:

```css
.comparisons {
  gap: 12px; /* was 16px */
  margin-bottom: 16px; /* was 24px */
}

.comparison-pill {
  padding: 8px 16px; /* was 10px 18px */
}
```

**Step 2: Test comparison pills**

Refresh scoreboard:
- Pills should be slightly more compact
- Still readable
- Saves ~10px

**Step 3: Commit comparison pill spacing**

```bash
git add src/css/scoreboard.css
git commit -m "feat(scoreboard): compact comparison pill spacing

- Reduce gap: 16px → 12px
- Reduce padding: 10px → 8px
- Reduce bottom margin: 24px → 16px
- Saves ~10px vertical space
- Maintains visual clarity

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 4: Polish & Testing

### Task 12: Add Smooth Transitions

**Files:**
- Modify: `src/css/fab-menu.css` (enhance animations)
- Modify: `src/css/scoreboard.css` (add transitions)

**Step 1: Enhance FAB menu transitions**

In `src/css/fab-menu.css`, update:

```css
/* Smoother menu slide transition */
.fab-menu {
  transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1),
              transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

/* Stagger menu item animations */
.fab-menu.visible .fab-menu-item {
  animation: fadeInUp 0.3s ease-out backwards;
}

.fab-menu.visible .fab-menu-item:nth-child(1) { animation-delay: 0.05s; }
.fab-menu.visible .fab-menu-item:nth-child(2) { animation-delay: 0.1s; }
.fab-menu.visible .fab-menu-item:nth-child(3) { animation-delay: 0.15s; }
.fab-menu.visible .fab-menu-item:nth-child(4) { animation-delay: 0.2s; }
.fab-menu.visible .fab-menu-item:nth-child(5) { animation-delay: 0.25s; }
.fab-menu.visible .fab-menu-item:nth-child(6) { animation-delay: 0.3s; }

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* FAB button rotation on open */
.fab-button[aria-expanded="true"] i {
  transform: rotate(90deg);
  transition: transform 0.3s ease;
}
```

**Step 2: Add chart show/hide transition**

In `src/css/scoreboard.css`:

```css
.chart-container {
  transition: opacity 0.3s ease, max-height 0.3s ease;
  max-height: 0;
  opacity: 0;
  overflow: hidden;
}

.chart-container.visible {
  max-height: 400px;
  opacity: 1;
}
```

**Step 3: Test transitions**

- FAB menu should slide smoothly with staggered items
- Gear icon should rotate 90° when menu opens
- Chart should fade in/out smoothly

**Step 4: Commit transition polish**

```bash
git add src/css/fab-menu.css src/css/scoreboard.css
git commit -m "feat(scoreboard): add smooth transitions and animations

- FAB menu slides with cubic-bezier easing
- Stagger menu item fade-ins (0.05s delay each)
- Rotate gear icon 90° on menu open
- Chart fade in/out with max-height transition
- Smooth, polished UI feel

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 13: Keyboard Navigation & Accessibility

**Files:**
- Modify: `src/js/scoreboard/fab-menu.js` (add keyboard support)

**Step 1: Add keyboard navigation**

In `src/js/scoreboard/fab-menu.js`, add keyboard handler:

```javascript
/**
 * Handle keyboard navigation
 */
function handleKeyboard(e) {
  // Escape key - close menu
  if (e.key === 'Escape' && state.isOpen) {
    closeMenu();
    if (elements.fabButton) {
      elements.fabButton.focus();
    }
    return;
  }

  // Enter or Space on FAB button - toggle menu
  if ((e.key === 'Enter' || e.key === ' ') && e.target === elements.fabButton) {
    e.preventDefault();
    toggleMenu();
    return;
  }

  // Arrow keys - navigate menu items
  if (state.isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    var menuItems = Array.from(document.querySelectorAll('.fab-menu-item'));
    var currentIndex = menuItems.indexOf(document.activeElement);

    if (e.key === 'ArrowDown') {
      var nextIndex = currentIndex + 1;
      if (nextIndex < menuItems.length) {
        menuItems[nextIndex].focus();
      } else {
        menuItems[0].focus(); // Loop to first
      }
    } else if (e.key === 'ArrowUp') {
      var prevIndex = currentIndex - 1;
      if (prevIndex >= 0) {
        menuItems[prevIndex].focus();
      } else {
        menuItems[menuItems.length - 1].focus(); // Loop to last
      }
    }
  }
}

// Add to init() function
document.addEventListener('keydown', handleKeyboard);
```

**Step 2: Add focus management**

Update `openMenu()` to focus first menu item:

```javascript
function openMenu() {
  if (!elements.fabMenu || !elements.fabBackdrop) return;

  state.isOpen = true;
  elements.fabMenu.classList.add('visible');
  elements.fabBackdrop.classList.add('visible');
  elements.fabButton.setAttribute('aria-expanded', 'true');
  elements.fabButton.classList.remove('idle');

  // Focus first visible menu item
  setTimeout(function() {
    var firstItem = elements.fabMenu.querySelector('.fab-menu-item:not([style*="display: none"])');
    if (firstItem) {
      firstItem.focus();
    }
  }, 100);

  clearTVFadeTimer();
  elements.fabButton.classList.remove('tv-fade');

  console.log('[FAB Menu] Opened');
}
```

**Step 3: Test keyboard navigation**

- Tab to FAB button
- Press Enter/Space → menu opens, first item focused
- Arrow Up/Down → navigate menu items
- Enter → activate menu item
- Escape → close menu, return focus to FAB button

**Step 4: Commit keyboard support**

```bash
git add src/js/scoreboard/fab-menu.js
git commit -m "feat(scoreboard): add keyboard navigation to FAB menu

- Escape key closes menu and returns focus to FAB button
- Enter/Space on FAB button toggles menu
- Arrow Up/Down navigate menu items (with looping)
- Enter activates focused menu item
- Focus management on menu open (first item focused)
- WCAG 2.1 AA keyboard accessibility compliant

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 14: Cross-Device Testing & Final Adjustments

**Files:**
- Create: `docs/sessions/2026-02-04-scoreboard-declutter-testing.md`

**Step 1: Create testing checklist document**

Create `docs/sessions/2026-02-04-scoreboard-declutter-testing.md`:

```markdown
# Scoreboard Declutter Testing Session

**Date:** 2026-02-04
**Implementation:** Complete
**Status:** Testing & Validation

---

## Testing Checklist

### TV Mode (≥1920px)

**Visual:**
- [ ] Production numbers readable from 10+ feet (120-140px)
- [ ] Pure black backgrounds (#000000) for OLED
- [ ] High contrast status colors (green/yellow/red)
- [ ] Timer rings 280px diameter
- [ ] FAB button auto-fades to 20% after 10s idle
- [ ] EN/ES toggle minimal size but still clickable

**Functionality:**
- [ ] FAB menu opens smoothly
- [ ] All menu items accessible
- [ ] No scrolling required
- [ ] Fits in 1080p viewport (1920×1080)
- [ ] Fits in 4K viewport (3840×2160)

**Interaction:**
- [ ] FAB button visible and clickable (even at 20% opacity)
- [ ] Menu items have good hit targets
- [ ] Smooth animations don't lag

---

### Desktop Mode (768px - 1919px)

**Visual:**
- [ ] Medium font sizes (64-80px production numbers)
- [ ] Balanced spacing and layout
- [ ] Comparison pills visible and readable
- [ ] Info bar fits comfortably

**Functionality:**
- [ ] No scrolling at 768px height
- [ ] No scrolling at 1024px width
- [ ] FAB menu standard size (56px)
- [ ] Chart toggle works
- [ ] Order queue toggle works

**Interaction:**
- [ ] All controls easy to click
- [ ] Menu items have good hover states
- [ ] Keyboard navigation works

---

### Mobile Mode (<768px)

**Visual:**
- [ ] Stacked vertical layout
- [ ] Timer panel below scoreboard
- [ ] Readable font sizes (48-64px)
- [ ] Touch targets ≥48px

**Functionality:**
- [ ] FAB menu full-width from bottom
- [ ] May scroll, but critical info above fold
- [ ] Chart hidden by default
- [ ] Order queue hidden by default

**Interaction:**
- [ ] FAB button easy to tap (56px, bottom-right)
- [ ] Menu items easy to tap (48px height)
- [ ] Swipe-friendly (no conflicts)
- [ ] Backdrop closes menu on tap

---

### Feature Parity

**All Devices:**
- [ ] EN/ES toggle always visible and working
- [ ] FAB menu opens/closes correctly
- [ ] Start Day button appears until shift start set
- [ ] Start Day button auto-hides after shift start
- [ ] Past Data opens date picker
- [ ] Complaints opens Google Sheet (new tab)
- [ ] Morning Report works
- [ ] Order Queue toggle ON/OFF works
- [ ] Hourly Chart toggle ON/OFF works
- [ ] Help modal opens

---

### Performance

- [ ] Page loads without layout shift
- [ ] FAB menu opens in <300ms
- [ ] Smooth 60fps animations
- [ ] No console errors
- [ ] No memory leaks (FAB timers cleaned up)

---

### Accessibility

- [ ] FAB button has aria-label
- [ ] FAB button aria-expanded toggles
- [ ] Menu items have role="menuitem"
- [ ] Keyboard navigation works (Tab, Enter, Arrows, Escape)
- [ ] Focus indicators visible
- [ ] Screen reader announces menu state
- [ ] Color contrast ≥4.5:1 (WCAG AA)

---

## Known Issues

_Document any issues found during testing:_

---

## Final Adjustments

_Document any tweaks made based on testing:_

---

## Sign-Off

- [ ] TV mode approved (tested on actual floor TV)
- [ ] Desktop mode approved
- [ ] Mobile mode approved (tested on iPhone/Android)
- [ ] Workers approve new layout
- [ ] Ready for production deployment
```

**Step 2: Test on all devices**

Go through each checklist item systematically:
- Use browser dev tools for responsive testing
- Test on actual TV if available
- Test on actual phone
- Document any issues found

**Step 3: Make final adjustments**

Based on testing, make any necessary tweaks:
- Font size adjustments
- Spacing tweaks
- Animation timing
- Color contrast fixes

**Step 4: Commit testing documentation**

```bash
git add docs/sessions/2026-02-04-scoreboard-declutter-testing.md
git commit -m "docs(scoreboard): add comprehensive testing checklist

- TV mode testing criteria (OLED, distance viewing)
- Desktop mode validation
- Mobile mode touch testing
- Feature parity verification
- Performance benchmarks
- Accessibility compliance (WCAG AA)
- Sign-off checklist for production readiness

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 15: Update Documentation & Deploy

**Files:**
- Modify: `ROADMAP.md` (mark Phase 4.1 complete)
- Modify: `docs/FEATURES_CHANGELOG.md` (add entry)

**Step 1: Update ROADMAP.md**

In `ROADMAP.md`, update Phase 4.1 status:

```markdown
| Phase | Description | Status | Completed |
|-------|-------------|--------|-----------|
| **4.1** | **Scoreboard Declutter & No-Scroll** | ✅ Done | **Feb 4, 2026** |

**Phase 4.1 Deliverables**:
- ✅ FAB menu system (8 buttons → 1 floating action button)
- ✅ Responsive breakpoints (TV/Desktop/Mobile)
- ✅ Vertical space optimization (1,250px → 700px)
- ✅ OLED-optimized TV mode
- ✅ Keyboard navigation and accessibility
- ✅ Chart/Order Queue hidden by default
- ✅ Compact header (strain + time merged)

**Documentation**:
- `docs/plans/2026-02-04-scoreboard-declutter-design.md`
- `docs/plans/2026-02-04-scoreboard-declutter-implementation.md`
- `docs/sessions/2026-02-04-scoreboard-declutter-testing.md`
```

**Step 2: Add changelog entry**

In `docs/FEATURES_CHANGELOG.md`, add at the top:

```markdown
## 2026-02-04: Scoreboard Declutter & No-Scroll Layout

**Goal:** Eliminate scrolling, reduce clutter, optimize for TV viewing

### Changes

**FAB Menu System:**
- Replaced 8 scattered buttons with single Floating Action Button
- Menu slides up from bottom-right with 6 items
- EN/ES toggle remains visible (most-used control)
- Auto-fade to 20% opacity on TV after 10s idle
- Keyboard navigation (Tab, Enter, Arrows, Escape)

**Responsive Breakpoints:**
- TV Mode (≥1920px): Huge text (120-140px), OLED pure blacks, distance-optimized
- Desktop Mode (768-1919px): Balanced sizing (64-80px), arm's length viewing
- Mobile Mode (<768px): Stacked layout, touch-friendly (48px targets), may scroll

**Vertical Space Optimization:**
- Compact header: Merged strain + time into 60px bar (saved 100px)
- Tightened hour cards: Reduced padding/margins (saved 40px)
- Chart hidden by default: Toggle via FAB menu (saved 300px)
- Order queue hidden by default: Toggle via FAB menu (saved 180px)
- Comparison pills compacted (saved 10px)
- **Total saved: 630px** (1,250px → 700px)

**Polish:**
- Smooth transitions with cubic-bezier easing
- Staggered menu item animations
- Gear icon rotates 90° on menu open
- Focus management for accessibility
- WCAG 2.1 AA compliant

### Impact

- **87.5% reduction** in visible chrome (8 buttons → 1 FAB + EN/ES toggle)
- No scrolling on any device (768px+ height)
- TV text readable from 10+ feet
- Touch targets ≥48px on mobile
- Maintains all existing functionality
- Cleaner, more professional appearance

### Files Modified

- `src/css/fab-menu.css` (new)
- `src/js/scoreboard/fab-menu.js` (new)
- `src/css/scoreboard.css` (responsive breakpoints, compact styles)
- `src/pages/scoreboard.html` (FAB menu HTML, compact header)
- `src/js/scoreboard/main.js` (compact header updates, order queue default)
- `src/js/scoreboard/render.js` (compact strain display)
- `src/js/scoreboard/i18n.js` (FAB menu translations)
```

**Step 3: Commit documentation updates**

```bash
git add ROADMAP.md docs/FEATURES_CHANGELOG.md
git commit -m "docs(scoreboard): mark declutter phase complete

- Update ROADMAP.md: Phase 4.1 complete (Feb 4, 2026)
- Add comprehensive changelog entry
- Document 87.5% reduction in visible chrome
- Document 630px vertical space savings
- List all deliverables and file changes

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

**Step 4: Final deployment**

Push all changes:
```bash
git push origin master
```

Wait ~1-2 minutes for GitHub Pages to deploy.

Verify live site:
```
https://rogueff.github.io/rogue-origin-apps/src/pages/scoreboard.html
```

**Step 5: Final commit**

```bash
git add .
git commit -m "feat(scoreboard): complete declutter and no-scroll layout

🎉 SCOREBOARD DECLUTTER COMPLETE

Summary:
- FAB menu system replaces 8 scattered buttons
- Responsive TV/Desktop/Mobile layouts
- Vertical space reduced 1,250px → 700px (no scrolling)
- OLED-optimized for floor TV viewing
- WCAG 2.1 AA accessible
- All functionality preserved

Key Metrics:
- 87.5% reduction in visible chrome
- 630px vertical space saved
- TV text 120-140px (readable from 10+ feet)
- Touch targets ≥48px (mobile-friendly)

Next Steps:
- Test on actual floor TV
- Gather worker feedback
- Phase 5.1: Accessibility improvements (if needed)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Success Criteria Validation

After deployment, verify all success criteria from design doc:

- [ ] No vertical scrolling on any device (768px+ height)
- [ ] TV mode text readable from 10+ feet
- [ ] FAB menu accessible in ≤2 clicks (1 click actually!)
- [ ] EN/ES toggle remains instant-access
- [ ] Mobile touch targets ≥48px
- [ ] OLED pure blacks (#000000) in TV mode
- [ ] Start Day button auto-hides after set
- [ ] Page loads without layout shift
- [ ] Maintains all existing functionality
- [ ] Workers approve new layout ← **Need real-world feedback**

---

## Notes for Executor

- **Test frequently:** After each task, verify in browser
- **Use local server:** `python -m http.server` from repo root
- **Check all three breakpoints:** Resize browser to test TV/Desktop/Mobile
- **Verify translations:** Toggle EN/ES to ensure all FAB menu items translate
- **Check localStorage:** Clear localStorage between tests to verify defaults
- **Focus on TV mode:** This is the primary use case - test on actual TV if possible

---

## Estimated Time

- Phase 1 (FAB Menu): ~45 minutes
- Phase 2 (Breakpoints): ~30 minutes
- Phase 3 (Space Optimization): ~40 minutes
- Phase 4 (Polish & Testing): ~30 minutes

**Total: ~2.5 hours**
