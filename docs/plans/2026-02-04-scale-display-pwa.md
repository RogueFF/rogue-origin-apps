# Scale Display PWA Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a dedicated PWA for small Samsung tablets that displays live scale weight and bag timer side-by-side in landscape mode.

**Architecture:** Reuse proven scoreboard modules (scale.js, timer.js, i18n.js, api.js) with new minimal HTML/CSS layout optimized for tablet landscape orientation. Read-only display with EN/ES toggle.

**Tech Stack:** Vanilla JavaScript (IIFE modules), CSS Grid, Service Worker, PWA Manifest

---

## Task 1: Create HTML Structure

**Files:**
- Create: `src/pages/scale-display.html`

**Step 1: Create base HTML with PWA metadata**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="screen-orientation" content="landscape">
  <link rel="icon" type="image/png" href="/rogue-origin-apps/favicon.png">
  <link rel="manifest" href="/rogue-origin-apps/manifest.json">
  <meta name="theme-color" content="#1a1a1a">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Scale Display">
  <link rel="apple-touch-icon" href="/rogue-origin-apps/assets/icon-apple-touch.png">
  <title>Scale Display | Rogue Origin</title>

  <!-- Preconnect -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>

  <!-- Fonts -->
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Outfit:wght@400;600;700&display=swap" rel="stylesheet">

  <!-- Scoreboard Modules (reused) -->
  <script defer src="../js/scoreboard/config.js?v=2"></script>
  <script defer src="../js/scoreboard/state.js?v=2"></script>
  <script defer src="../js/scoreboard/dom.js?v=2"></script>
  <script defer src="../js/scoreboard/i18n.js?v=3"></script>
  <script defer src="../js/scoreboard/api.js?v=3"></script>
  <script defer src="../js/scoreboard/timer.js?v=10"></script>
  <script defer src="../js/scoreboard/scale.js?v=3"></script>

  <!-- Scale Display Modules (new) -->
  <script defer src="../js/scale-display/layout.js?v=1"></script>
  <script defer src="../js/scale-display/main.js?v=1"></script>

  <!-- CSS -->
  <link rel="stylesheet" href="../css/shared-base.css">
  <link rel="preload" href="../css/scale-display.css?v=1" as="style" onload="this.onload=null;this.rel='stylesheet'">
  <noscript><link rel="stylesheet" href="../css/scale-display.css?v=1"></noscript>
</head>
<body class="timer-neutral">
  <a href="#scale-panel" class="skip-link">Skip to scale display</a>

  <!-- Header -->
  <header class="scale-header">
    <h1 class="scale-title" data-i18n="scaleDisplay">Scale Display</h1>
    <button id="langToggle" class="lang-toggle" aria-label="Toggle language">EN</button>
  </header>

  <!-- Main Display Grid -->
  <main class="display-grid">
    <!-- Scale Panel -->
    <section id="scale-panel" class="display-panel scale-panel">
      <h2 class="panel-label" id="scaleHeader" data-i18n="scaleWeight">Live Scale</h2>
      <div class="scale-display" id="scaleDisplay">
        <svg class="scale-ring" viewBox="0 0 220 220">
          <circle class="scale-ring-bg" cx="110" cy="110" r="95"/>
          <circle class="scale-ring-progress" id="scaleRing" cx="110" cy="110" r="95"
                  stroke-dasharray="597" stroke-dashoffset="597"/>
        </svg>
        <div class="scale-center">
          <div class="scale-value" id="scaleWeight">—</div>
          <div class="scale-label" id="scaleWeightLabel">of 5.0 kg</div>
        </div>
        <div class="scale-status-dot" id="scaleStatusDot"></div>
      </div>
    </section>

    <!-- Timer Panel -->
    <section class="display-panel timer-panel">
      <h2 class="panel-label" data-i18n="bagTimer">Bag Timer</h2>
      <div class="timer-ring-container" id="timerPanel">
        <svg class="timer-ring" viewBox="0 0 220 220">
          <circle class="timer-ring-bg" cx="110" cy="110" r="95"/>
          <circle class="timer-ring-progress green" id="timerRing" cx="110" cy="110" r="95"/>
        </svg>
        <div class="timer-center">
          <div class="timer-value green" id="bag-timer-value">--:--</div>
          <div class="timer-label" id="timerLabel" data-i18n="remaining">remaining</div>
        </div>
      </div>
      <div class="timer-target">
        <span data-i18n="target">Target</span>: <span id="timer-target-time">--:--</span>
      </div>
    </section>
  </main>

  <!-- Loading Overlay -->
  <div id="loading-overlay" class="loading-overlay" style="display: none;">
    <div class="spinner"></div>
  </div>
</body>
</html>
```

**Step 2: Verify HTML structure**

Open in browser (via `python -m http.server`):
- Navigate to: `http://localhost:8000/src/pages/scale-display.html`
- Expected: Blank page with header (modules not loaded yet)
- Check console for 404s on missing JS/CSS files (expected at this stage)

**Step 3: Commit HTML structure**

```bash
git add src/pages/scale-display.html
git commit -m "feat(scale-display): add HTML structure with PWA metadata

- Reuses scoreboard modules (scale, timer, i18n, api, state, dom, config)
- 50/50 grid layout for scale and timer panels
- Landscape orientation optimized for tablet
- EN/ES language toggle in header

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Create CSS Styling

**Files:**
- Create: `src/css/scale-display.css`

**Step 1: Create CSS with dark theme and responsive layout**

```css
/**
 * Scale Display PWA
 * Dedicated tablet display for live scale weight and bag timer
 * Optimized for small Samsung tablets (7-10") in landscape orientation
 */

/* ===== CSS VARIABLES ===== */
:root {
  /* Layout */
  --header-height: 50px;
  --scale-circle-size: clamp(180px, 35vw, 300px);
  --timer-circle-size: clamp(180px, 35vw, 300px);

  /* Dark Theme Colors (from shared-base.css) */
  --bg-dark: #1a1a1a;
  --text-light: #f5f5f5;
  --text-muted: #a0a0a0;

  /* Spacing */
  --grid-gap: 2rem;
  --panel-padding: 1rem;
}

/* ===== GLOBAL STYLES ===== */
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  font-family: 'Outfit', sans-serif;
  background: var(--bg-dark);
  color: var(--text-light);
}

/* Skip link for accessibility */
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  background: var(--ro-green);
  color: white;
  padding: 8px;
  text-decoration: none;
  z-index: 100;
}

.skip-link:focus {
  top: 0;
}

/* ===== HEADER ===== */
.scale-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: var(--header-height);
  padding: 0 1.5rem;
  background: rgba(0, 0, 0, 0.3);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.scale-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-light);
}

.lang-toggle {
  min-width: 44px;
  min-height: 44px;
  padding: 0.5rem 1rem;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: var(--text-light);
  font-family: 'Outfit', sans-serif;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.lang-toggle:hover {
  background: rgba(255, 255, 255, 0.15);
}

.lang-toggle:active {
  transform: scale(0.95);
}

/* ===== MAIN GRID LAYOUT ===== */
.display-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  flex: 1;
  align-items: center;
  justify-items: center;
  gap: var(--grid-gap);
  padding: var(--panel-padding);
}

.display-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.panel-label {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 1rem;
}

/* ===== SCALE DISPLAY ===== */
.scale-display {
  position: relative;
  width: var(--scale-circle-size);
  height: var(--scale-circle-size);
}

.scale-ring {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.scale-ring-bg {
  fill: none;
  stroke: rgba(255, 255, 255, 0.1);
  stroke-width: 12;
}

.scale-ring-progress {
  fill: none;
  stroke-width: 12;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.5s ease, stroke 0.3s ease;
}

/* Scale color states */
.scale-ring-progress.filling {
  stroke: var(--info, #62758d);
}

.scale-ring-progress.near-target {
  stroke: var(--ro-gold, #e4aa4f);
}

.scale-ring-progress.at-target {
  stroke: var(--ro-green, #668971);
}

.scale-ring-progress.stale {
  stroke: var(--danger, #c45c4a);
}

.scale-center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
}

.scale-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: clamp(2.5rem, 6vw, 4rem);
  font-weight: 700;
  line-height: 1;
  margin-bottom: 0.25rem;
  transition: color 0.3s ease;
}

.scale-value.filling {
  color: var(--info, #62758d);
}

.scale-value.near-target {
  color: var(--ro-gold, #e4aa4f);
}

.scale-value.at-target {
  color: var(--ro-green, #668971);
}

.scale-value.stale {
  color: var(--danger, #c45c4a);
}

.scale-label {
  font-size: clamp(0.875rem, 2vw, 1.125rem);
  color: var(--text-muted);
}

/* Status dot (connection indicator) */
.scale-status-dot {
  position: absolute;
  top: 8%;
  right: 8%;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--danger);
  border: 2px solid var(--bg-dark);
  transition: background 0.3s ease;
}

.scale-status-dot.connected {
  background: var(--ro-green);
}

.scale-status-dot.stale {
  background: var(--danger);
  animation: pulse-red 2s ease-in-out infinite;
}

@keyframes pulse-red {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* ===== TIMER DISPLAY ===== */
.timer-ring-container {
  position: relative;
  width: var(--timer-circle-size);
  height: var(--timer-circle-size);
  margin-bottom: 1rem;
}

.timer-ring {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.timer-ring-bg {
  fill: none;
  stroke: rgba(255, 255, 255, 0.1);
  stroke-width: 12;
}

.timer-ring-progress {
  fill: none;
  stroke-width: 12;
  stroke-linecap: round;
  stroke-dasharray: 597;
  stroke-dashoffset: 0;
  transition: stroke-dashoffset 1s linear, stroke 0.3s ease;
}

/* Timer color states */
.timer-ring-progress.green {
  stroke: var(--ro-green, #668971);
}

.timer-ring-progress.blue {
  stroke: var(--info, #62758d);
}

.timer-ring-progress.red {
  stroke: var(--danger, #c45c4a);
}

.timer-ring-progress.neutral {
  stroke: rgba(255, 255, 255, 0.3);
}

.timer-center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
}

.timer-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: clamp(3rem, 7vw, 5rem);
  font-weight: 700;
  line-height: 1;
  margin-bottom: 0.25rem;
  transition: color 0.3s ease;
}

.timer-value.green {
  color: var(--ro-green, #668971);
}

.timer-value.blue {
  color: var(--info, #62758d);
}

.timer-value.red {
  color: var(--danger, #c45c4a);
}

.timer-value.neutral {
  color: var(--text-muted);
}

.timer-label {
  font-size: clamp(0.875rem, 2vw, 1.125rem);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.timer-target {
  font-size: clamp(0.875rem, 2vw, 1rem);
  color: var(--text-muted);
  text-align: center;
}

/* ===== LOADING OVERLAY ===== */
.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.spinner {
  width: 48px;
  height: 48px;
  border: 4px solid rgba(255, 255, 255, 0.1);
  border-top-color: var(--ro-green);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ===== RESPONSIVE BREAKPOINTS ===== */

/* Small tablets (7-8", ≤800px) */
@media (max-width: 800px) and (orientation: landscape) {
  :root {
    --scale-circle-size: 180px;
    --timer-circle-size: 180px;
    --grid-gap: 1rem;
  }

  .scale-value {
    font-size: 2.5rem;
  }

  .timer-value {
    font-size: 3rem;
  }

  .panel-label {
    font-size: 0.875rem;
  }
}

/* Large tablets (10"+, ≥1024px) */
@media (min-width: 1024px) and (orientation: landscape) {
  :root {
    --scale-circle-size: 300px;
    --timer-circle-size: 300px;
    --grid-gap: 3rem;
  }

  .scale-value {
    font-size: 4rem;
  }

  .timer-value {
    font-size: 5rem;
  }

  .panel-label {
    font-size: 1.125rem;
  }
}

/* ===== BODY CLASS MODIFIERS (from timer.js) ===== */

/* Timer states affect body background */
body.timer-green {
  background: linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%);
}

body.timer-blue {
  background: linear-gradient(135deg, #1a2a3a 0%, #2a3a4a 100%);
  animation: pulse-blue 3s ease-in-out infinite;
}

@keyframes pulse-blue {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}

body.timer-red {
  background: linear-gradient(135deg, #3a1a1a 0%, #4a2a2a 100%);
  animation: pulse-red-bg 2s ease-in-out infinite;
}

@keyframes pulse-red-bg {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.8; }
}

body.timer-neutral {
  background: var(--bg-dark);
}
```

**Step 2: Verify CSS loads**

Refresh browser:
- Expected: Dark background, header visible with title and EN button
- Expected: Two panels side-by-side (empty circles, no data yet)
- Check responsive sizing by resizing window

**Step 3: Commit CSS styling**

```bash
git add src/css/scale-display.css
git commit -m "feat(scale-display): add responsive CSS for tablet layout

- Dark theme matching scoreboard aesthetic
- 50/50 grid layout with responsive circle sizing
- Breakpoints for small (7-8\"), medium (8-10\"), large (10\"+) tablets
- Scale and timer ring styles with color states
- Body class modifiers for timer states (green/blue/red/neutral)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Create Layout Module (Language Toggle)

**Files:**
- Create: `src/js/scale-display/layout.js`

**Step 1: Create layout module with language toggle**

```javascript
/**
 * Scale Display Layout Module
 * Handles language toggle and UI interactions
 */
(function(window) {
  'use strict';

  var I18n = window.ScoreboardI18n;
  var currentLang = 'en';

  /**
   * Initialize language from localStorage
   */
  function initLanguage() {
    var saved = localStorage.getItem('scaleDisplayLang');
    if (saved && (saved === 'en' || saved === 'es')) {
      currentLang = saved;
    }

    // Update button text
    updateLangButton();

    // Apply translations if i18n module loaded
    if (I18n && I18n.setLanguage) {
      I18n.setLanguage(currentLang);
    }

    console.log('[Layout] Language initialized:', currentLang);
  }

  /**
   * Toggle language between EN and ES
   */
  function toggleLanguage() {
    currentLang = (currentLang === 'en') ? 'es' : 'en';
    localStorage.setItem('scaleDisplayLang', currentLang);

    // Update button
    updateLangButton();

    // Apply translations
    if (I18n && I18n.setLanguage) {
      I18n.setLanguage(currentLang);
    }

    console.log('[Layout] Language changed to:', currentLang);
  }

  /**
   * Update language toggle button text
   */
  function updateLangButton() {
    var btn = document.getElementById('langToggle');
    if (btn) {
      btn.textContent = currentLang === 'en' ? 'ES' : 'EN';
      btn.setAttribute('aria-label', currentLang === 'en'
        ? 'Switch to Spanish'
        : 'Cambiar a inglés');
    }
  }

  /**
   * Initialize layout and event listeners
   */
  function init() {
    console.log('[Layout] Initializing...');

    // Set up language toggle
    initLanguage();

    var langBtn = document.getElementById('langToggle');
    if (langBtn) {
      langBtn.addEventListener('click', toggleLanguage);
    }

    console.log('[Layout] Initialized');
  }

  /**
   * Get current language
   */
  function getLanguage() {
    return currentLang;
  }

  // Expose module
  window.ScaleDisplayLayout = {
    init: init,
    toggleLanguage: toggleLanguage,
    getLanguage: getLanguage
  };

})(window);
```

**Step 2: Verify layout module loads**

Check browser console:
- Expected: "[Layout] Initializing..." message
- Expected: Language button shows "ES" (default EN)
- Click language button → should toggle to "EN" (switched to ES)

**Step 3: Commit layout module**

```bash
git add src/js/scale-display/layout.js
git commit -m "feat(scale-display): add layout module with language toggle

- Saves language preference to localStorage
- Integrates with ScoreboardI18n module
- Updates button text and aria-label on toggle
- Exposes getLanguage() for other modules

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Create Main Module (Orchestration)

**Files:**
- Create: `src/js/scale-display/main.js`

**Step 1: Create main orchestration module**

```javascript
/**
 * Scale Display Main Module
 * Orchestrates initialization and polling for scale and timer
 */
(function(window) {
  'use strict';

  var Config = window.ScoreboardConfig;
  var State = window.ScoreboardState;
  var DOM = window.ScoreboardDOM;
  var I18n = window.ScoreboardI18n;
  var API = window.ScoreboardAPI;
  var Scale = window.ScoreboardScale;
  var Timer = window.ScoreboardTimer;
  var Layout = window.ScaleDisplayLayout;

  var isInitialized = false;

  /**
   * Initialize all modules
   */
  function init() {
    if (isInitialized) {
      console.warn('[Main] Already initialized');
      return;
    }

    console.log('[Scale Display] Initializing...');

    // Show loading overlay
    showLoading();

    // Initialize in sequence
    initializeModules();

    isInitialized = true;
    console.log('[Scale Display] Initialized');
  }

  /**
   * Initialize modules in order
   */
  function initializeModules() {
    // 1. DOM element caching
    if (DOM && DOM.init) {
      DOM.init();
    }

    // 2. State management
    if (State && State.init) {
      State.init();
    }

    // 3. I18n translations
    if (I18n && I18n.init) {
      I18n.init();
    }

    // 4. Layout (language toggle)
    if (Layout && Layout.init) {
      Layout.init();
    }

    // 5. Scale module (starts 1s polling)
    if (Scale && Scale.init) {
      Scale.init();
    }

    // 6. Timer module (starts 1s polling)
    if (Timer && Timer.init) {
      Timer.init();
    }

    // 7. API smart polling (version check every 5s)
    if (API && API.startPolling) {
      API.startPolling();
    }

    // Hide loading after short delay
    setTimeout(hideLoading, 1000);
  }

  /**
   * Show loading overlay
   */
  function showLoading() {
    var overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.style.display = 'flex';
    }
  }

  /**
   * Hide loading overlay
   */
  function hideLoading() {
    var overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  /**
   * Handle page visibility changes (pause/resume polling)
   */
  function handleVisibilityChange() {
    if (document.hidden) {
      console.log('[Main] Page hidden - polling continues in background');
      // Keep polling - we want live updates even when backgrounded
    } else {
      console.log('[Main] Page visible - forcing data refresh');
      // Force immediate refresh when page becomes visible
      if (Scale && Scale.pollScale) {
        Scale.pollScale();
      }
      if (API && API.checkVersion) {
        API.checkVersion();
      }
    }
  }

  // Auto-initialize when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOM already loaded
    init();
  }

  // Handle visibility changes
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // Expose module
  window.ScaleDisplayMain = {
    init: init,
    showLoading: showLoading,
    hideLoading: hideLoading
  };

})(window);
```

**Step 2: Test full initialization**

Refresh browser:
- Expected: Loading spinner appears briefly
- Expected: Scale circle shows "—" with stale state (red dot)
- Expected: Timer shows "--:--"
- Expected: Console shows initialization sequence
- Expected: Language toggle works (changes button text)

**Step 3: Verify polling starts**

Wait 5 seconds and check Network tab:
- Expected: Request to `?action=scaleWeight` every 1 second
- Expected: Request to `?action=version` every 5 seconds
- Expected: Scale updates when API returns data

**Step 4: Commit main module**

```bash
git add src/js/scale-display/main.js
git commit -m "feat(scale-display): add main orchestration module

- Initializes all scoreboard modules in sequence
- Starts scale polling (1s) and timer polling (1s)
- Starts API smart polling (version check 5s)
- Shows loading overlay during initialization
- Handles visibility changes for background/foreground

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Update Service Worker

**Files:**
- Modify: `sw.js:12-64`

**Step 1: Add scale-display files to cache**

Find the `STATIC_ASSETS` array and add these entries after line 22:

```javascript
  '/rogue-origin-apps/src/pages/hourly-entry.html',
  '/rogue-origin-apps/src/pages/scale-display.html',  // ADD THIS
```

Find line 33 and add:

```javascript
  '/rogue-origin-apps/src/css/scoreboard.css',
  '/rogue-origin-apps/src/css/scale-display.css',  // ADD THIS
  '/rogue-origin-apps/src/css/sop-manager.css',
```

**Step 2: Update cache version**

Change line 4:

```javascript
const CACHE_VERSION = 'ro-ops-v3.15';  // Increment from v3.14
```

**Step 3: Verify service worker update**

Hard refresh browser (Ctrl+Shift+R):
- Open DevTools → Application → Service Workers
- Expected: New version activating
- Expected: scale-display.html and scale-display.css cached
- Go offline (Network tab → Offline checkbox)
- Refresh page → should still load (from cache)

**Step 4: Commit service worker update**

```bash
git add sw.js
git commit -m "feat(scale-display): add PWA offline support

- Add scale-display.html to static cache
- Add scale-display.css to static cache
- Increment cache version to v3.15
- Enables offline viewing after first load

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Update PWA Manifest (Optional)

**Files:**
- Modify: `manifest.json`

**Step 1: Add scale display as related application**

This step is optional since the existing manifest already works. However, we can add it to the `related_applications` if desired, or leave as-is since both apps share the same manifest.

**Decision**: Skip this step - the existing manifest at `/rogue-origin-apps/manifest.json` already provides PWA capabilities for all pages in the `/rogue-origin-apps/` scope.

**Verify manifest works**:
- Open scale-display.html on tablet
- Tap browser menu → "Add to Home Screen"
- Expected: Install prompt appears
- Expected: Uses existing icons and theme color

---

## Task 7: Add I18n Translations for Scale Display

**Files:**
- Modify: `src/js/scoreboard/i18n.js:8-150`

**Step 1: Add missing translations**

The scale display uses these i18n keys that may need to be added/verified:
- `scaleDisplay` (page title)
- `scaleWeight` (panel label)
- `bagTimer` (panel label)
- `target` (timer target label)
- `remaining` (timer label)

Check if these exist in i18n.js (they likely do from scoreboard). If missing, add them:

```javascript
// Around line 58-65, verify these exist:
scaleWeight: 'Live Scale',
scaleDisplay: 'Scale Display',
bagTimer: '5KG BAG TIMER',
remaining: 'remaining',
target: 'Target:',
```

And Spanish:

```javascript
// Around line 180+, verify Spanish translations:
scaleWeight: 'Báscula en Vivo',
scaleDisplay: 'Pantalla de Báscula',
bagTimer: 'TEMPORIZADOR DE BOLSA 5KG',
remaining: 'restante',
target: 'Meta:',
```

**Step 2: Verify translations apply**

Refresh page:
- Default: Shows "Scale Display" header
- Click "ES" button → header changes to "Pantalla de Báscula"
- Panel labels change to Spanish
- Click "EN" → back to English

**Step 3: Commit i18n updates (if changes made)**

```bash
git add src/js/scoreboard/i18n.js
git commit -m "feat(scale-display): verify i18n translations exist

- Verified scaleDisplay, scaleWeight, bagTimer translations
- Added missing Spanish translations if needed
- Ensures language toggle works correctly

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

Note: Only commit if changes were actually made. If all translations already exist, skip this commit.

---

## Task 8: Manual Testing & Verification

**Files:**
- None (testing only)

**Step 1: Test on desktop**

Start local server:
```bash
python -m http.server
```

Navigate to: `http://localhost:8000/src/pages/scale-display.html`

**Desktop Testing Checklist:**
- [ ] Page loads without errors
- [ ] Dark theme applied
- [ ] Header shows "Scale Display" and "ES" button
- [ ] Two panels side-by-side (scale left, timer right)
- [ ] Scale shows "—" initially (stale state)
- [ ] Timer shows "--:--" initially
- [ ] Language toggle works (EN ↔ ES)
- [ ] Translations apply to all labels
- [ ] Scale updates every 1 second (check Network tab)
- [ ] Timer updates when data available
- [ ] Circles resize responsively (resize window)
- [ ] No scrolling at any viewport size

**Step 2: Test tablet simulation**

In Chrome DevTools:
1. Toggle device toolbar (Ctrl+Shift+M)
2. Select "iPad Mini" or custom 1024x600 landscape
3. Verify responsive sizing
4. Test touch targets (language button minimum 44x44px)

**Step 3: Test PWA installation (desktop)**

1. Click install icon in address bar (or menu → "Install Scale Display")
2. App opens in standalone window
3. Verify fullscreen mode (no browser chrome)
4. Test offline: DevTools → Network → Offline → Refresh
5. Expected: Page loads from cache

**Step 4: Document testing results**

Create a test report in console or notes documenting:
- ✅ All features working
- ⚠️ Any issues found
- 📝 Notes for tablet testing

---

## Task 9: Deploy to Production

**Files:**
- All changed files

**Step 1: Verify all changes staged**

```bash
git status
```

Expected output:
```
On branch scaleweight-tracking
nothing to commit, working tree clean
```

All changes should already be committed from previous tasks.

**Step 2: Push to GitHub**

```bash
git push origin scaleweight-tracking
```

**Step 3: Wait for deployment**

- GitHub Pages auto-deploys in ~1-2 minutes
- Monitor: https://github.com/rogueff/rogue-origin-apps/actions

**Step 4: Verify production deployment**

Navigate to:
```
https://rogueff.github.io/rogue-origin-apps/src/pages/scale-display.html
```

Test:
- [ ] Page loads
- [ ] Scale and timer display
- [ ] Data updates from production API
- [ ] Language toggle works
- [ ] PWA install prompt appears

**Step 5: Create merge request (if using branches)**

If working in a branch:
```bash
# Switch to main branch
git checkout main

# Merge scaleweight-tracking
git merge scaleweight-tracking

# Push to main
git push origin main
```

Or if pushing directly to main:
```bash
# Already deployed, nothing more needed
```

---

## Task 10: Tablet Installation & Final Testing

**Files:**
- None (physical device testing)

**Step 1: Install on Samsung tablet**

1. Open Chrome or Samsung Internet browser on tablet
2. Navigate to: `https://rogueff.github.io/rogue-origin-apps/src/pages/scale-display.html`
3. Tap menu (⋮) → "Add to Home Screen" or "Install App"
4. Confirm installation
5. App icon appears on home screen with "Scale Display" label

**Step 2: Configure tablet settings**

1. Settings → Display → Screen timeout → "Never" or "30 minutes"
2. Settings → Display → Adaptive brightness → Off (optional)
3. Launch app from home screen
4. Rotate to landscape orientation
5. App should lock to landscape automatically

**Step 3: Real-world testing**

**Tablet Testing Checklist:**
- [ ] Opens in fullscreen (no browser chrome)
- [ ] Locks to landscape orientation
- [ ] Scale circle readable from 2-3 feet away
- [ ] Timer circle readable from 2-3 feet away
- [ ] Language button easy to tap (44x44px minimum)
- [ ] Scale weight updates every 1 second
- [ ] Timer counts down smoothly
- [ ] Colors change correctly (scale: gray→yellow→green, timer: green→blue→red)
- [ ] No scrolling needed
- [ ] Works when tablet sleeps and wakes
- [ ] Works offline (after initial load)
- [ ] Screen stays awake during use (if "Keep screen on" enabled)

**Step 4: Production validation**

Mount tablet near scale and verify:
- [ ] Weight updates in real-time
- [ ] Timer syncs with production floor
- [ ] Readable at working distance
- [ ] Pause state syncs across devices
- [ ] Language toggle accessible if needed

**Step 5: Document completion**

Create completion note:
```
✅ Scale Display PWA deployed and tested
- Production URL: https://rogueff.github.io/rogue-origin-apps/src/pages/scale-display.html
- Installed on [tablet model]
- Tested features: scale polling, timer sync, language toggle, offline mode
- Status: Ready for production use
```

---

## Post-Implementation Notes

### Known Limitations
- Screen orientation lock is CSS-only (no JavaScript Screen Orientation API)
- Wake Lock API not implemented (tablet may sleep if inactive)
- No haptic feedback on state changes (could add Vibration API later)

### Future Enhancements (Out of Scope)
- Wake Lock API to prevent screen sleep
- Screen Orientation Lock API (better than CSS)
- Haptic/vibration feedback when bag reaches target
- Configurable target weight (currently hardcoded 5.0 kg)
- Historical scale weight graph
- Connection status banner when API unreachable

### Maintenance
- Service worker cache version must increment on any CSS/JS changes
- I18n translations shared with scoreboard (update both if needed)
- API changes in scoreboard modules affect scale display

---

**Plan Complete**: 2026-02-04
**Estimated Time**: 2-3 hours (mostly testing)
**Dependencies**: Cloudflare Workers API, Google Sheets (production data)
