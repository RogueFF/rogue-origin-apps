# Animation System

**Version**: 1.0
**Performance Target**: 60fps, CSS-only where possible
**References**: VISUAL_DESIGN_SYSTEM.md, COMPONENT_SPECS.md

---

## Animation Philosophy

**Smooth, Not Slow**: Animations should feel luxurious and intentional, but never delay the user. Every animation serves a purpose - either to provide feedback, create continuity, or draw attention to important changes.

**Organic Motion**: Use spring easing (`cubic-bezier(0.34, 1.56, 0.64, 1)`) as the default. This creates a natural, slightly bouncy feel that matches the botanical aesthetic.

**Staggered Reveals**: When multiple elements appear, stagger their entry to create a flowing, choreographed experience rather than everything appearing at once.

---

## 1. Page Load Sequence

### Timeline Overview

| Time | Element | Animation | Duration |
|------|---------|-----------|----------|
| 0ms | Background layers | Fade in | 800ms |
| 0ms | Hemp pattern | Start drift | Continuous |
| 200ms | Header | Slide down + fade | 400ms |
| 300ms | Sidebar | Slide in from left | 500ms |
| 400ms | Hero section | Scale up + fade | 600ms |
| 500ms | Hero number | Count up + glow | 1200ms |
| 600ms | Mini KPI cards | Stagger in (100ms each) | 400ms each |
| 800ms | First widget row | Stagger in (80ms each) | 400ms each |
| 1000ms | Remaining widgets | Continue stagger | 400ms each |
| 1200ms | FABs | Bounce in | 500ms |

### Background Fade In

```css
@keyframes backgroundFadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

body {
  animation: backgroundFadeIn 800ms ease-out forwards;
}
```

### Header Slide Down

```css
@keyframes headerSlideDown {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.header {
  animation: headerSlideDown 400ms var(--ease-spring) 200ms backwards;
}
```

### Sidebar Slide In

```css
@keyframes sidebarSlideIn {
  from {
    opacity: 0;
    transform: translateX(-40px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.sidebar {
  animation: sidebarSlideIn 500ms var(--ease-spring) 300ms backwards;
}
```

### Hero Section Reveal

```css
@keyframes heroReveal {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.hero-section {
  animation: heroReveal 600ms var(--ease-spring) 400ms backwards;
}
```

### Hero Number Count Up

```javascript
// Count up animation for hero production number
function animateHeroNumber(element, targetValue, duration = 1200) {
  const startTime = performance.now();
  const startValue = 0;

  // Easing function (ease-out-expo)
  const easeOutExpo = (t) => t === 1 ? 1 : 1 - Math.pow(2, -10 * t);

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easedProgress = easeOutExpo(progress);

    const currentValue = startValue + (targetValue - startValue) * easedProgress;
    element.textContent = currentValue.toFixed(1);

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }

  // Start after delay
  setTimeout(() => requestAnimationFrame(update), 500);
}
```

```css
@keyframes heroNumberGlow {
  from {
    text-shadow: 0 0 0 rgba(228, 170, 79, 0);
  }
  to {
    text-shadow:
      0 0 40px rgba(228, 170, 79, 0.4),
      0 0 80px rgba(228, 170, 79, 0.2);
  }
}

.hero-production-number {
  animation: heroNumberGlow 1200ms var(--ease-out) 500ms forwards;
}
```

### Widget Stagger Reveal

```css
@keyframes widgetPopIn {
  from {
    opacity: 0;
    transform: translateY(20px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* Apply stagger via JavaScript or nth-child */
.widget-card {
  animation: widgetPopIn 400ms var(--ease-spring) backwards;
}

/* CSS stagger pattern */
.widget-card:nth-child(1) { animation-delay: 800ms; }
.widget-card:nth-child(2) { animation-delay: 880ms; }
.widget-card:nth-child(3) { animation-delay: 960ms; }
.widget-card:nth-child(4) { animation-delay: 1040ms; }
.widget-card:nth-child(5) { animation-delay: 1120ms; }
.widget-card:nth-child(6) { animation-delay: 1200ms; }
/* Continue pattern... */
```

```javascript
// JavaScript stagger helper
function staggerWidgets() {
  const widgets = document.querySelectorAll('.widget-card');
  widgets.forEach((widget, index) => {
    const delay = 800 + (index * 80); // 80ms stagger
    widget.style.animationDelay = `${delay}ms`;
  });
}
```

### FAB Bounce In

```css
@keyframes fabBounceIn {
  0% {
    opacity: 0;
    transform: scale(0) translateY(20px);
  }
  60% {
    opacity: 1;
    transform: scale(1.15) translateY(-5px);
  }
  100% {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.fab-main {
  animation: fabBounceIn 500ms var(--ease-spring) 1200ms backwards;
}

/* Settings FAB slightly delayed */
.fab-settings .fab-main {
  animation-delay: 1350ms;
}
```

---

## 2. Interaction Animations

### Hover Effects

#### Widget Card Hover

```css
.widget-card {
  transition:
    transform 300ms var(--ease-spring),
    box-shadow 300ms ease,
    border-color 200ms ease;
}

.widget-card:hover {
  transform: translateY(-4px) scale(1.01);
  box-shadow: var(--shadow-lg);
  border-color: rgba(228, 170, 79, 0.3);
}

/* Dark mode adds glow */
:root[data-theme="dark"] .widget-card:hover {
  box-shadow:
    var(--shadow-dark-lg),
    0 0 32px rgba(228, 170, 79, 0.08);
}
```

#### Button Hover

```css
.btn-primary {
  transition:
    transform 200ms var(--ease-spring),
    box-shadow 200ms ease;
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow:
    0 4px 16px rgba(228, 170, 79, 0.4),
    0 0 16px rgba(228, 170, 79, 0.2);
}
```

#### Icon Hover

```css
.icon-interactive {
  transition:
    transform 200ms var(--ease-spring),
    color 150ms ease;
}

.icon-interactive:hover {
  transform: scale(1.15);
  color: var(--gold-400);
}
```

#### Nav Item Hover

```css
.nav-item {
  transition:
    background 200ms ease,
    color 150ms ease,
    padding-left 200ms var(--ease-spring);
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.05);
  color: white;
  padding-left: 20px; /* Subtle slide */
}

.nav-item:hover .nav-icon {
  transform: scale(1.1);
  color: var(--gold-400);
}
```

### Click/Active Effects

#### Button Click

```css
.btn-primary:active {
  transform: translateY(0) scale(0.97);
  transition-duration: 100ms;
}

/* Bounce back */
.btn-primary {
  transition:
    transform 200ms var(--ease-spring),
    box-shadow 200ms ease;
}
```

#### Card Click (when dragging)

```css
.widget-card.is-dragging {
  transform: scale(1.03);
  box-shadow:
    0 16px 48px rgba(0, 0, 0, 0.15),
    0 0 32px rgba(228, 170, 79, 0.1);
  cursor: grabbing;
  z-index: 100;
}
```

#### Toggle Click

```css
.toggle-knob {
  transition: transform 300ms var(--ease-spring);
}

.toggle.active .toggle-knob {
  transform: translateX(22px);
}

/* Satisfying bounce on click */
@keyframes toggleBounce {
  0% { transform: translateX(0) scale(1); }
  50% { transform: translateX(11px) scale(1.1); }
  100% { transform: translateX(22px) scale(1); }
}

.toggle:active .toggle-knob {
  animation: toggleBounce 300ms var(--ease-spring) forwards;
}
```

### Focus Effects

#### Input Focus

```css
.input {
  transition:
    border-color 200ms ease,
    box-shadow 200ms ease;
}

.input:focus {
  border-color: var(--gold-400);
  box-shadow:
    0 0 0 3px rgba(228, 170, 79, 0.15),
    0 0 16px rgba(228, 170, 79, 0.1);
}
```

#### Button Focus

```css
.btn:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 2px var(--bg),
    0 0 0 4px var(--gold-400);
}
```

---

## 3. Widget Animations

### Resize Animation

```css
.widget-card {
  transition:
    width 400ms var(--ease-spring),
    height 400ms var(--ease-spring);
}

/* Muuri handles positioning, we add smoothness */
.muuri-item {
  transition:
    transform 400ms var(--ease-spring);
}
```

### Collapse/Expand

```css
.widget-body {
  transition:
    height 300ms var(--ease-out),
    opacity 200ms ease,
    padding 300ms var(--ease-out);
  overflow: hidden;
}

.widget-card.collapsed .widget-body {
  height: 0;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
}

/* Collapse icon rotation */
.widget-collapse-icon {
  transition: transform 300ms var(--ease-spring);
}

.widget-card.collapsed .widget-collapse-icon {
  transform: rotate(-90deg);
}
```

### Drag and Drop

```css
/* Lift on drag start */
.widget-card.is-dragging {
  transform: scale(1.02) rotate(1deg);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
  opacity: 0.95;
}

/* Placeholder styling */
.muuri-item-placeholder {
  background: var(--gold-dim);
  border: 2px dashed var(--gold-400);
  border-radius: 16px;
  opacity: 0.5;
}

/* Drop animation */
@keyframes widgetDrop {
  0% { transform: scale(1.02); }
  50% { transform: scale(0.98); }
  100% { transform: scale(1); }
}

.widget-card.just-dropped {
  animation: widgetDrop 300ms var(--ease-spring);
}
```

---

## 4. Panel Animations

### Panel Slide In/Out

```css
.panel {
  transform: translateX(100%);
  transition: transform 500ms var(--ease-spring);
}

.panel.open {
  transform: translateX(0);
}

/* Backdrop fade */
.panel-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 300ms ease,
    visibility 300ms ease;
}

.panel-backdrop.visible {
  opacity: 1;
  visibility: visible;
}
```

### Chat Message Animation

```css
@keyframes messageSlideIn {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.chat-message {
  animation: messageSlideIn 300ms var(--ease-spring) forwards;
}

/* User messages slide from right */
.chat-message.user {
  animation-name: messageSlideInRight;
}

@keyframes messageSlideInRight {
  from {
    opacity: 0;
    transform: translateX(16px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
}
```

### Typing Indicator

```css
@keyframes typingBounce {
  0%, 80%, 100% {
    transform: scale(1) translateY(0);
    opacity: 0.4;
  }
  40% {
    transform: scale(1.3) translateY(-8px);
    opacity: 1;
  }
}

.typing-dot {
  animation: typingBounce 1.4s ease-in-out infinite;
}

.typing-dot:nth-child(1) { animation-delay: 0s; }
.typing-dot:nth-child(2) { animation-delay: 0.15s; }
.typing-dot:nth-child(3) { animation-delay: 0.3s; }
```

---

## 5. Chart Animations

### Line Chart Draw-In

```javascript
// Chart.js animation config
const chartAnimationConfig = {
  animation: {
    duration: 800,
    easing: 'easeOutQuart',

    // Delayed animation for stagger effect
    delay: (context) => {
      if (context.type === 'data' && context.mode === 'default') {
        return context.dataIndex * 50; // 50ms stagger per point
      }
      return 0;
    },
  },

  // Draw from left to right
  transitions: {
    active: {
      animation: {
        duration: 300,
      },
    },
  },
};
```

### Bar Chart Rise Up

```javascript
const barChartAnimation = {
  animation: {
    duration: 600,
    easing: 'easeOutQuart',

    // Stagger bars
    delay: (context) => {
      return context.dataIndex * 80;
    },
  },
};
```

### Doughnut Chart Spin In

```javascript
const doughnutAnimation = {
  animation: {
    animateRotate: true,
    animateScale: true,
    duration: 800,
    easing: 'easeOutQuart',
  },
};
```

### Data Point Hover

```javascript
const hoverConfig = {
  interaction: {
    mode: 'nearest',
    intersect: false,
  },

  // Point grows on hover
  elements: {
    point: {
      radius: 4,
      hoverRadius: 8,
      hoverBorderWidth: 3,
    },
  },
};
```

```css
/* Glow effect on chart canvas hover */
.chart-container:hover canvas {
  filter: drop-shadow(0 0 8px rgba(228, 170, 79, 0.2));
}
```

---

## 6. Theme Toggle Animation

### Cross-Fade Transition

```css
/* CSS custom property transitions */
:root {
  transition:
    --bg 600ms ease,
    --text 600ms ease,
    --border 600ms ease;
}

/* Flash overlay for dramatic effect */
.theme-flash {
  position: fixed;
  inset: 0;
  background: white;
  opacity: 0;
  pointer-events: none;
  z-index: 9999;
}

.theme-flash.active {
  animation: themeFlash 600ms ease forwards;
}

@keyframes themeFlash {
  0% { opacity: 0; }
  20% { opacity: 0.3; }
  100% { opacity: 0; }
}
```

```javascript
// Theme toggle with flash effect
function toggleTheme() {
  const flash = document.querySelector('.theme-flash');
  flash.classList.add('active');

  setTimeout(() => {
    document.documentElement.dataset.theme =
      document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';

    // Play sound
    SoundManager.play('toggle');
  }, 100);

  setTimeout(() => {
    flash.classList.remove('active');
  }, 600);
}
```

### Toggle Button Animation

```css
.theme-toggle-icon {
  transition: transform 500ms var(--ease-spring);
}

.theme-toggle:hover .theme-toggle-icon {
  transform: rotate(20deg);
}

/* Sun to moon morph */
@keyframes sunToMoon {
  0% { transform: rotate(0deg) scale(1); }
  50% { transform: rotate(180deg) scale(0.8); }
  100% { transform: rotate(360deg) scale(1); }
}

.theme-toggle.switching .theme-toggle-icon {
  animation: sunToMoon 500ms var(--ease-spring);
}
```

---

## 7. Loading Animations

### Page Loader (Hemp Seed Growth)

```css
.page-loader {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  z-index: 10000;
}

.loader-seed {
  width: 40px;
  height: 40px;
  background: var(--gold-400);
  border-radius: 50% 60% 50% 60%;
  animation: seedGrow 1.5s ease-in-out infinite;
}

@keyframes seedGrow {
  0%, 100% {
    transform: scale(1) rotate(0deg);
    opacity: 0.8;
  }
  50% {
    transform: scale(1.2) rotate(180deg);
    opacity: 1;
    box-shadow: 0 0 32px rgba(228, 170, 79, 0.5);
  }
}

/* Fade out when loaded */
.page-loader.loaded {
  animation: loaderFadeOut 500ms ease forwards;
}

@keyframes loaderFadeOut {
  to {
    opacity: 0;
    visibility: hidden;
  }
}
```

### Skeleton Shimmer

```css
@keyframes skeletonShimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

.skeleton {
  background: linear-gradient(
    90deg,
    var(--border) 25%,
    var(--bg) 50%,
    var(--border) 75%
  );
  background-size: 200% 100%;
  animation: skeletonShimmer 1.5s infinite;
}
```

### Data Refresh Indicator

```css
@keyframes pulseRefresh {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(0.98);
  }
}

.widget-card.refreshing {
  animation: pulseRefresh 1s ease-in-out infinite;
}

/* Subtle shimmer overlay */
.widget-card.refreshing::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(228, 170, 79, 0.1),
    transparent
  );
  animation: shimmerPass 1s infinite;
}

@keyframes shimmerPass {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
```

---

## 8. Attention & Notification Animations

### Pulse Glow (New Data)

```css
@keyframes pulseGlow {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(228, 170, 79, 0);
  }
  50% {
    box-shadow: 0 0 24px 4px rgba(228, 170, 79, 0.4);
  }
}

.kpi-card.updated {
  animation: pulseGlow 2s ease-in-out;
}
```

### Success Checkmark

```css
@keyframes checkmarkDraw {
  0% {
    stroke-dashoffset: 24;
  }
  100% {
    stroke-dashoffset: 0;
  }
}

.checkmark-icon path {
  stroke-dasharray: 24;
  stroke-dashoffset: 24;
  animation: checkmarkDraw 400ms var(--ease-out) forwards;
}

/* Circle pop */
@keyframes successPop {
  0% { transform: scale(0); }
  60% { transform: scale(1.2); }
  100% { transform: scale(1); }
}

.success-circle {
  animation: successPop 400ms var(--ease-spring);
}
```

### Error Shake

```css
@keyframes errorShake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-8px); }
  40%, 80% { transform: translateX(8px); }
}

.input.error {
  animation: errorShake 400ms ease;
  border-color: var(--danger);
}
```

---

## 9. Sound Triggers

### Sound Effect Mapping

| Action | Sound ID | Duration | Trigger |
|--------|----------|----------|---------|
| Button click | `click` | 80ms | `mousedown` |
| Toggle switch | `toggle` | 60ms | State change |
| Widget drag start | `lift` | 100ms | Drag start |
| Widget drop | `drop` | 120ms | Drag end |
| Success action | `success` | 200ms | Completion |
| Error | `error` | 100ms | Failure |
| AI message received | `message` | 150ms | New message |
| Panel open | `whooshIn` | 150ms | Panel opens |
| Panel close | `whooshOut` | 120ms | Panel closes |
| Theme toggle | `toggle` | 60ms | Theme change |

### Implementation

```javascript
const SoundManager = {
  enabled: localStorage.getItem('soundEnabled') !== 'false',
  sounds: {},

  init() {
    // Preload sounds
    const soundNames = [
      'click', 'toggle', 'lift', 'drop',
      'success', 'error', 'message',
      'whooshIn', 'whooshOut'
    ];

    soundNames.forEach(name => {
      this.sounds[name] = new Audio(`/sounds/${name}.mp3`);
      this.sounds[name].volume = 0.3;
      this.sounds[name].preload = 'auto';
    });
  },

  play(name) {
    if (!this.enabled || !this.sounds[name]) return;

    // Clone for overlapping sounds
    const sound = this.sounds[name].cloneNode();
    sound.volume = 0.3;
    sound.play().catch(() => {}); // Ignore autoplay errors
  },

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('soundEnabled', this.enabled);
    if (this.enabled) this.play('toggle');
    return this.enabled;
  }
};

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  SoundManager.init();
});
```

### Trigger Integration

```javascript
// Button clicks
document.querySelectorAll('.btn').forEach(btn => {
  btn.addEventListener('mousedown', () => SoundManager.play('click'));
});

// Toggle switches
document.querySelectorAll('.toggle').forEach(toggle => {
  toggle.addEventListener('change', () => SoundManager.play('toggle'));
});

// Widget drag (Muuri integration)
grid.on('dragStart', () => SoundManager.play('lift'));
grid.on('dragEnd', () => SoundManager.play('drop'));

// Panel open/close
function openPanel(panel) {
  panel.classList.add('open');
  SoundManager.play('whooshIn');
}

function closePanel(panel) {
  panel.classList.remove('open');
  SoundManager.play('whooshOut');
}

// AI messages
function onNewMessage() {
  SoundManager.play('message');
}
```

---

## 10. Performance Guidelines

### CSS-Only Preference

Use CSS animations for:
- Hover effects
- State transitions
- Simple transforms
- Opacity changes

Use JavaScript for:
- Complex choreography
- Value interpolation (counting)
- Scroll-triggered animations
- Dynamic stagger calculations

### GPU Acceleration

```css
/* Force GPU layer for smooth animations */
.widget-card,
.panel,
.fab-main {
  will-change: transform;
  transform: translateZ(0);
}

/* Remove after animation */
.widget-card.animation-complete {
  will-change: auto;
}
```

### Reduce Motion Support

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }

  /* Keep essential transitions but faster */
  .panel,
  .widget-card {
    transition-duration: 100ms !important;
  }
}
```

### Animation Cleanup

```javascript
// Remove animation classes after completion
function cleanupAnimations() {
  document.querySelectorAll('[class*="animate"]').forEach(el => {
    el.addEventListener('animationend', () => {
      el.classList.remove('animate-in', 'just-dropped');
      el.style.willChange = 'auto';
    }, { once: true });
  });
}
```

### Frame Budget

| Animation Type | Target | Max Duration |
|----------------|--------|--------------|
| Hover/Active | 60fps | 200ms |
| State changes | 60fps | 300ms |
| Page transitions | 60fps | 500ms |
| Complex choreography | 60fps | 1200ms |

---

## 11. Animation Presets (Copy-Paste)

### Quick Reference

```css
/* Pop in */
.pop-in {
  animation: popIn 400ms var(--ease-spring) forwards;
}

/* Fade in */
.fade-in {
  animation: fadeIn 300ms ease forwards;
}

/* Slide up */
.slide-up {
  animation: slideUp 400ms var(--ease-spring) forwards;
}

/* Pulse */
.pulse {
  animation: pulse 2s ease-in-out infinite;
}

/* Shake */
.shake {
  animation: shake 400ms ease;
}

/* Spin */
.spin {
  animation: spin 1s linear infinite;
}
```

```css
/* Keyframe definitions */
@keyframes popIn {
  from { opacity: 0; transform: scale(0.9); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-5px); }
  75% { transform: translateX(5px); }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

---

**Next**: See `MOBILE_DESIGN.md` for mobile-specific animations and gestures.
