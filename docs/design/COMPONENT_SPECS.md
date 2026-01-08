# Component Specifications

**Version**: 1.0
**References**: VISUAL_DESIGN_SYSTEM.md, ICON_SET.md
**Aesthetic**: Botanical Luxury (Confident - 10-15% visibility)

---

## 1. Hero Section (The Unforgettable Thing)

### Layout Structure
```
+------------------------------------------------------------------+
|                         HERO SECTION                              |
|  +---------------------------+  +-----------------------------+   |
|  |                           |  |      MINI KPI CARDS         |   |
|  |    MASSIVE PRODUCTION     |  |  +--------+  +--------+     |   |
|  |         NUMBER            |  |  | Crew   |  | Rate   |     |   |
|  |                           |  |  | Count  |  | lbs/hr |     |   |
|  |        "127.4"            |  |  +--------+  +--------+     |   |
|  |          lbs              |  |  +--------+  +--------+     |   |
|  |                           |  |  | Target |  | Bags   |     |   |
|  |    [Progress Bar]         |  |  | %      |  | Done   |     |   |
|  |                           |  |  +--------+  +--------+     |   |
|  +---------------------------+  +-----------------------------+   |
+------------------------------------------------------------------+
```

### Dimensions

| Element | Desktop | Tablet | Mobile |
|---------|---------|--------|--------|
| Hero container | 100% width, 280px height | 100%, 320px | 100%, auto |
| Left column | 60% | 55% | 100% |
| Right column | 40% | 45% | 100% |
| Padding | 40px | 32px | 24px |
| Gap between columns | 32px | 24px | 0 (stacked) |

### Production Number (The Star)

```css
.hero-production-number {
  font-family: var(--font-display);
  font-size: 96px;
  font-weight: 400;
  line-height: 1;
  letter-spacing: -0.02em;
  color: var(--gold-400);
  text-shadow:
    0 0 40px rgba(228, 170, 79, 0.4),
    0 0 80px rgba(228, 170, 79, 0.2);

  /* Animate on load */
  animation: heroNumberReveal 1.2s var(--ease-spring) forwards;
}

.hero-production-unit {
  font-family: var(--font-ui);
  font-size: 24px;
  font-weight: 300;
  color: var(--text-muted);
  margin-left: 8px;
  letter-spacing: 0.05em;
  text-transform: lowercase;
}

/* Mobile scaling */
@media (max-width: 768px) {
  .hero-production-number {
    font-size: 64px;
  }
  .hero-production-unit {
    font-size: 18px;
  }
}
```

### Botanical Frame (Around Production Number)

```css
.hero-botanical-frame {
  position: relative;
  padding: 32px 48px;

  /* Organic border */
  border: 2px solid rgba(228, 170, 79, 0.3);
  border-radius: 20px 24px 22px 26px; /* Organic asymmetric */

  /* Subtle gradient background */
  background: linear-gradient(
    135deg,
    rgba(228, 170, 79, 0.05) 0%,
    transparent 50%,
    rgba(102, 137, 113, 0.03) 100%
  );
}

/* Corner decorations */
.hero-botanical-frame::before,
.hero-botanical-frame::after {
  content: '';
  position: absolute;
  width: 24px;
  height: 24px;
  background-image: url("data:image/svg+xml,..."); /* Hemp leaf corner */
  background-size: contain;
  opacity: 0.4;
}

.hero-botanical-frame::before {
  top: -8px;
  left: -8px;
}

.hero-botanical-frame::after {
  bottom: -8px;
  right: -8px;
  transform: rotate(180deg);
}
```

### Progress Bar (Below Number)

```css
.hero-progress-bar {
  width: 100%;
  height: 8px;
  background: var(--border);
  border-radius: 4px;
  margin-top: 24px;
  overflow: hidden;
}

.hero-progress-fill {
  height: 100%;
  background: linear-gradient(
    90deg,
    var(--gold-400) 0%,
    var(--gold-300) 100%
  );
  border-radius: 4px;
  transition: width 800ms var(--ease-out-expo);
  box-shadow: 0 0 16px rgba(228, 170, 79, 0.4);
}

/* Animated shimmer */
.hero-progress-fill::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.3),
    transparent
  );
  animation: shimmer 2s ease-in-out infinite;
}

@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
```

### Mini KPI Cards (Right Side)

```css
.mini-kpi-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.mini-kpi-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px 14px 13px 15px; /* Organic */
  padding: 16px;

  /* Subtle hover lift */
  transition: all 300ms var(--ease-spring);
}

.mini-kpi-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
  border-color: var(--gold-400);
}

.mini-kpi-label {
  font-family: var(--font-ui);
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.mini-kpi-value {
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 400;
  color: var(--text);
  line-height: 1.1;
}

.mini-kpi-unit {
  font-family: var(--font-ui);
  font-size: 12px;
  font-weight: 400;
  color: var(--text-muted);
}

/* Icon accent */
.mini-kpi-icon {
  width: 20px;
  height: 20px;
  color: var(--gold-400);
  margin-bottom: 8px;
}
```

---

## 2. Widget Cards

### Base Card Structure

```css
.widget-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 16px 18px 17px 19px; /* Organic asymmetric */
  padding: 20px;
  position: relative;
  overflow: hidden;

  /* Shadow */
  box-shadow: var(--shadow-sm);

  /* Transitions */
  transition: all 300ms var(--ease-spring);
}

/* Hover state */
.widget-card:hover {
  transform: translateY(-2px) scale(1.005);
  box-shadow: var(--shadow-lg);
  border-color: rgba(228, 170, 79, 0.3);
}

/* Dark mode enhancement */
:root[data-theme="dark"] .widget-card {
  background: rgba(26, 31, 22, 0.8);
  backdrop-filter: blur(8px);
  box-shadow: var(--shadow-dark-md);
}

:root[data-theme="dark"] .widget-card:hover {
  box-shadow: var(--shadow-dark-lg),
              0 0 32px rgba(228, 170, 79, 0.1);
}
```

### Hemp Fiber Texture Overlay

```css
.widget-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: url("data:image/svg+xml,..."); /* Hemp fiber pattern */
  background-size: 20px;
  opacity: 0.04;
  pointer-events: none;
  border-radius: inherit;
}

/* Slightly more visible on hover */
.widget-card:hover::before {
  opacity: 0.06;
}

/* More visible in dark mode */
:root[data-theme="dark"] .widget-card::before {
  opacity: 0.08;
}
```

### Card Header

```css
.widget-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}

.widget-title {
  font-family: var(--font-ui);
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 8px;
}

.widget-title-icon {
  width: 18px;
  height: 18px;
  color: var(--gold-400);
}

.widget-actions {
  display: flex;
  gap: 4px;
}
```

### Widget Action Buttons

```css
.widget-action-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 200ms var(--ease-spring);
}

.widget-action-btn:hover {
  background: var(--gold-dim);
  color: var(--gold-400);
}

.widget-action-btn:active {
  transform: scale(0.95);
}

/* Drag handle special styling */
.widget-drag-handle {
  cursor: grab;
}

.widget-drag-handle:active {
  cursor: grabbing;
}
```

### Card Size Variants

```css
/* Size classes for Muuri */
.widget-card[data-size="small"] {
  width: calc(25% - 12px);
}

.widget-card[data-size="medium"] {
  width: calc(33.333% - 12px);
}

.widget-card[data-size="large"] {
  width: calc(50% - 12px);
}

.widget-card[data-size="xl"] {
  width: calc(66.666% - 12px);
}

.widget-card[data-size="full"] {
  width: 100%;
}

/* Tablet */
@media (max-width: 1200px) {
  .widget-card[data-size="small"],
  .widget-card[data-size="medium"] {
    width: calc(50% - 8px);
  }

  .widget-card[data-size="large"],
  .widget-card[data-size="xl"],
  .widget-card[data-size="full"] {
    width: 100%;
  }
}

/* Mobile */
@media (max-width: 768px) {
  .widget-card {
    width: 100% !important;
  }
}
```

### Collapsed State

```css
.widget-card.collapsed {
  min-height: auto;
}

.widget-card.collapsed .widget-body {
  height: 0;
  padding: 0;
  overflow: hidden;
  opacity: 0;
  transition: all 300ms var(--ease-out);
}

.widget-card.collapsed .widget-header {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}
```

---

## 3. KPI Displays

### Standard KPI Card

```css
.kpi-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  position: relative;
  transition: all 300ms var(--ease-spring);
}

/* Color accent stripe */
.kpi-card::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  border-radius: 12px 12px 0 0;
}

.kpi-card.gold::after { background: var(--gold-400); }
.kpi-card.green::after { background: var(--green-500); }
.kpi-card.sungrown::after { background: var(--sungrown); }
.kpi-card.greenhouse::after { background: var(--greenhouse); }
.kpi-card.indoor::after { background: var(--indoor); }
```

### KPI Value Display

```css
.kpi-value {
  font-family: var(--font-display);
  font-size: 32px;
  font-weight: 400;
  color: var(--text);
  line-height: 1.1;
  margin-bottom: 4px;
}

/* Gold highlight for important KPIs */
.kpi-value.highlight {
  color: var(--gold-400);
  text-shadow: 0 0 16px rgba(228, 170, 79, 0.3);
}

.kpi-label {
  font-family: var(--font-ui);
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-muted);
}

.kpi-sublabel {
  font-family: var(--font-ui);
  font-size: 11px;
  color: var(--text-light);
  margin-top: 8px;
}
```

### Delta/Change Indicator

```css
.kpi-delta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 12px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
}

.kpi-delta.up {
  background: rgba(102, 137, 113, 0.15);
  color: var(--green-500);
}

.kpi-delta.down {
  background: rgba(196, 92, 74, 0.15);
  color: var(--danger);
}

.kpi-delta.neutral {
  background: var(--border);
  color: var(--text-muted);
}

/* Arrow icons */
.kpi-delta .icon {
  width: 12px;
  height: 12px;
}
```

### Progress Ring KPI

```css
.kpi-ring-container {
  position: relative;
  width: 80px;
  height: 80px;
}

.kpi-ring {
  transform: rotate(-90deg);
}

.kpi-ring-bg {
  fill: none;
  stroke: var(--border);
  stroke-width: 8;
}

.kpi-ring-fill {
  fill: none;
  stroke: var(--gold-400);
  stroke-width: 8;
  stroke-linecap: round;
  transition: stroke-dashoffset 800ms var(--ease-out-expo);
}

/* Complete state */
.kpi-ring-fill.complete {
  stroke: var(--green-500);
}

/* Center percentage */
.kpi-ring-value {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: 20px;
  color: var(--text);
}
```

---

## 4. Charts

### Chart Container

```css
.chart-container {
  position: relative;
  width: 100%;
  min-height: 200px;
}

/* Loading state */
.chart-container.loading::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(228, 170, 79, 0.1),
    transparent
  );
  animation: shimmer 1.5s infinite;
}
```

### Chart.js Global Configuration

```javascript
// Chart.js defaults for Botanical Luxury
Chart.defaults.font.family = "'Outfit', 'Inter', sans-serif";
Chart.defaults.color = getComputedStyle(document.documentElement)
  .getPropertyValue('--text-muted').trim();

const botanicalChartConfig = {
  // Line charts: organic curves
  elements: {
    line: {
      tension: 0.4, // Smooth organic curves
      borderWidth: 3,
      borderCapStyle: 'round',
      borderJoinStyle: 'round',
    },
    point: {
      radius: 4,
      hoverRadius: 8,
      hitRadius: 12,
      borderWidth: 2,
      backgroundColor: 'white',
    },
    bar: {
      borderRadius: 6,
      borderSkipped: false,
    },
  },

  // Grid styling
  scales: {
    x: {
      grid: {
        display: false,
      },
      ticks: {
        font: { size: 11 },
        padding: 8,
      },
    },
    y: {
      grid: {
        color: 'rgba(102, 137, 113, 0.1)',
        drawBorder: false,
        lineWidth: 1,
        // Hemp fiber dashed line
        borderDash: [4, 4],
      },
      ticks: {
        font: { size: 11 },
        padding: 12,
      },
    },
  },

  // Plugin config
  plugins: {
    legend: {
      display: true,
      position: 'bottom',
      labels: {
        padding: 20,
        usePointStyle: true,
        pointStyle: 'circle',
        font: { size: 12 },
      },
    },
    tooltip: {
      backgroundColor: 'rgba(26, 31, 22, 0.95)',
      titleFont: { size: 13, weight: '600' },
      bodyFont: { size: 12 },
      padding: 12,
      cornerRadius: 8,
      borderColor: 'rgba(228, 170, 79, 0.3)',
      borderWidth: 1,
      displayColors: true,
      boxPadding: 6,
    },
  },
};
```

### Chart Color Palettes

```javascript
// Primary palette
const chartColors = {
  gold: {
    solid: '#e4aa4f',
    gradient: ['#e4aa4f', '#f0cb60'],
    dim: 'rgba(228, 170, 79, 0.2)',
  },
  green: {
    solid: '#668971',
    gradient: ['#668971', '#8ba896'],
    dim: 'rgba(102, 137, 113, 0.2)',
  },
  sungrown: {
    solid: '#bf8e4e',
    gradient: ['#bf8e4e', '#d4a86a'],
    dim: 'rgba(191, 142, 78, 0.2)',
  },
  greenhouse: {
    solid: '#8f9263',
    gradient: ['#8f9263', '#a8ab7e'],
    dim: 'rgba(143, 146, 99, 0.2)',
  },
  indoor: {
    solid: '#62758d',
    gradient: ['#62758d', '#7d90a8'],
    dim: 'rgba(98, 117, 141, 0.2)',
  },
};

// Create gradient fills
function createGradient(ctx, color1, color2) {
  const gradient = ctx.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, color1);
  gradient.addColorStop(1, color2 + '00'); // Fade to transparent
  return gradient;
}
```

### Line Chart Styling

```javascript
const lineChartOptions = {
  ...botanicalChartConfig,
  elements: {
    line: {
      tension: 0.4,
      borderWidth: 3,
      fill: true,
    },
  },
};

// Dataset template
{
  label: 'Production',
  data: [...],
  borderColor: chartColors.gold.solid,
  backgroundColor: (ctx) => createGradient(
    ctx.chart.ctx,
    'rgba(228, 170, 79, 0.3)',
    'rgba(228, 170, 79, 0)'
  ),
  pointBackgroundColor: '#fff',
  pointBorderColor: chartColors.gold.solid,
  pointBorderWidth: 2,
  pointRadius: 4,
  pointHoverRadius: 8,
}
```

### Bar Chart Styling

```javascript
const barChartOptions = {
  ...botanicalChartConfig,
  elements: {
    bar: {
      borderRadius: 6,
      borderSkipped: false,
    },
  },
};

// Dataset with gradient bars
{
  label: 'Daily Output',
  data: [...],
  backgroundColor: (ctx) => {
    const gradient = ctx.chart.ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, chartColors.gold.solid);
    gradient.addColorStop(1, chartColors.gold.gradient[1]);
    return gradient;
  },
  borderRadius: 6,
}
```

### Doughnut/Pie Chart Styling

```javascript
const doughnutOptions = {
  cutout: '70%',
  plugins: {
    legend: {
      position: 'bottom',
    },
  },
};

// Botanical palette for segments
{
  data: [...],
  backgroundColor: [
    chartColors.gold.solid,
    chartColors.green.solid,
    chartColors.sungrown.solid,
    chartColors.greenhouse.solid,
    chartColors.indoor.solid,
  ],
  borderWidth: 0,
  hoverOffset: 8,
}
```

---

## 5. Buttons

### Primary Button (Gold)

```css
.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;

  padding: 10px 20px;
  min-height: 40px;

  font-family: var(--font-ui);
  font-size: 14px;
  font-weight: 600;

  background: linear-gradient(135deg, var(--gold-400) 0%, var(--gold-300) 100%);
  color: var(--earth-900);
  border: none;
  border-radius: 8px;

  cursor: pointer;
  transition: all 200ms var(--ease-spring);
}

.btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(228, 170, 79, 0.4),
              var(--glow-gold-sm);
}

.btn-primary:active {
  transform: translateY(0) scale(0.98);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

/* Icon inside button */
.btn-primary .icon {
  width: 16px;
  height: 16px;
}
```

### Secondary Button (Outlined)

```css
.btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;

  padding: 10px 20px;
  min-height: 40px;

  font-family: var(--font-ui);
  font-size: 14px;
  font-weight: 500;

  background: transparent;
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;

  cursor: pointer;
  transition: all 200ms var(--ease-spring);
}

.btn-secondary:hover {
  background: var(--gold-dim);
  border-color: var(--gold-400);
  color: var(--gold-400);
}

.btn-secondary:active {
  transform: scale(0.98);
}
```

### Ghost Button

```css
.btn-ghost {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;

  padding: 8px 16px;
  min-height: 36px;

  font-family: var(--font-ui);
  font-size: 13px;
  font-weight: 500;

  background: transparent;
  color: var(--text-muted);
  border: none;
  border-radius: 6px;

  cursor: pointer;
  transition: all 200ms var(--ease-spring);
}

.btn-ghost:hover {
  background: var(--border);
  color: var(--text);
}
```

### Icon Button

```css
.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;

  width: 36px;
  height: 36px;

  background: transparent;
  color: var(--text-muted);
  border: 1px solid transparent;
  border-radius: 8px;

  cursor: pointer;
  transition: all 200ms var(--ease-spring);
}

.btn-icon:hover {
  background: var(--gold-dim);
  border-color: var(--gold-400);
  color: var(--gold-400);
}

.btn-icon .icon {
  width: 18px;
  height: 18px;
}
```

### Button Sizes

```css
.btn-sm {
  padding: 6px 12px;
  min-height: 32px;
  font-size: 12px;
}

.btn-lg {
  padding: 14px 28px;
  min-height: 48px;
  font-size: 16px;
}
```

---

## 6. Form Elements

### Input Field

```css
.input {
  width: 100%;
  padding: 12px 16px;

  font-family: var(--font-ui);
  font-size: 14px;
  color: var(--text);

  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;

  transition: all 200ms ease;
}

.input:focus {
  outline: none;
  border-color: var(--gold-400);
  box-shadow: 0 0 0 3px rgba(228, 170, 79, 0.15),
              var(--glow-gold-sm);
}

.input::placeholder {
  color: var(--text-light);
}

/* Dark mode */
:root[data-theme="dark"] .input {
  background: var(--earth-700);
}
```

### Input with Icon

```css
.input-wrapper {
  position: relative;
}

.input-wrapper .input {
  padding-left: 44px;
}

.input-wrapper .input-icon {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  color: var(--text-muted);
  pointer-events: none;
}

.input-wrapper:focus-within .input-icon {
  color: var(--gold-400);
}
```

### Select Dropdown

```css
.select {
  appearance: none;
  width: 100%;
  padding: 12px 40px 12px 16px;

  font-family: var(--font-ui);
  font-size: 14px;
  color: var(--text);

  background: var(--bg) url("data:image/svg+xml,...") no-repeat right 12px center;
  background-size: 16px;
  border: 1px solid var(--border);
  border-radius: 8px;

  cursor: pointer;
  transition: all 200ms ease;
}

.select:focus {
  outline: none;
  border-color: var(--gold-400);
  box-shadow: 0 0 0 3px rgba(228, 170, 79, 0.15);
}
```

### Toggle Switch (Botanical)

```css
.toggle {
  position: relative;
  width: 48px;
  height: 26px;

  background: var(--border);
  border-radius: 13px;

  cursor: pointer;
  transition: background 300ms ease;
}

.toggle.active {
  background: var(--gold-400);
}

/* Leaf-shaped knob */
.toggle-knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;

  background: white;
  border-radius: 10px 12px 11px 13px; /* Organic */
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);

  transition: transform 300ms var(--ease-spring);
}

.toggle.active .toggle-knob {
  transform: translateX(22px);
}
```

---

## 7. Navigation Elements

### Sidebar Navigation Item

```css
.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;

  padding: 12px 16px;
  margin-bottom: 4px;

  font-family: var(--font-ui);
  font-size: 14px;
  font-weight: 500;
  color: var(--text-muted);

  text-decoration: none;
  border-radius: 10px;

  cursor: pointer;
  transition: all 200ms var(--ease-spring);
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.05);
  color: white;
}

.nav-item:hover .nav-icon {
  transform: scale(1.1);
  color: var(--gold-400);
}

.nav-item.active {
  background: var(--gold-400);
  color: var(--earth-900);
}

.nav-item.active .nav-icon {
  color: var(--earth-900);
}

.nav-icon {
  width: 20px;
  height: 20px;
  transition: all 200ms var(--ease-spring);
}
```

### Section Divider (Hemp Fiber)

```css
.nav-divider {
  height: 1px;
  margin: 16px 16px;
  background: linear-gradient(
    90deg,
    transparent,
    var(--hemp-fiber),
    transparent
  );
  opacity: 0.3;
}

/* Alternate: dashed fiber line */
.nav-divider-dashed {
  height: 1px;
  margin: 16px 16px;
  background-image: repeating-linear-gradient(
    90deg,
    var(--hemp-fiber) 0,
    var(--hemp-fiber) 4px,
    transparent 4px,
    transparent 8px
  );
  opacity: 0.4;
}
```

### Section Label

```css
.nav-section-label {
  padding: 0 16px;
  margin: 20px 0 8px;

  font-family: var(--font-ui);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-light);
}
```

---

## 8. Panels (AI Chat & Settings)

### Panel Base

```css
.panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 400px;
  max-width: 100%;

  background: var(--bg-card);
  border-left: 1px solid var(--border);

  display: flex;
  flex-direction: column;

  transform: translateX(100%);
  transition: transform 500ms var(--ease-spring);

  z-index: 100;
}

.panel.open {
  transform: translateX(0);
}

/* Dark mode glassmorphic */
:root[data-theme="dark"] .panel {
  background: rgba(26, 31, 22, 0.95);
  backdrop-filter: blur(20px);
  border-color: rgba(228, 170, 79, 0.2);
}
```

### Panel Header

```css
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;

  padding: 20px 24px;
  border-bottom: 1px solid var(--border);
}

.panel-title {
  font-family: var(--font-ui);
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 10px;
}

.panel-title .icon {
  width: 20px;
  height: 20px;
  color: var(--gold-400);
}

.panel-close {
  width: 32px;
  height: 32px;

  display: flex;
  align-items: center;
  justify-content: center;

  background: transparent;
  border: none;
  border-radius: 8px;

  color: var(--text-muted);
  cursor: pointer;
  transition: all 200ms ease;
}

.panel-close:hover {
  background: var(--danger-light);
  color: var(--danger);
}
```

### AI Chat Panel Specifics

```css
.chat-panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;

  /* Hemp fiber background texture */
  background-image: url("data:image/svg+xml,...");
  background-size: 20px;
  opacity: 0.97; /* Slight texture show-through */
}

/* Message bubbles */
.chat-message {
  margin-bottom: 16px;
  max-width: 85%;
  animation: messageSlideIn 300ms var(--ease-spring);
}

@keyframes messageSlideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.chat-message.user {
  margin-left: auto;
}

.chat-message.assistant {
  margin-right: auto;
}

/* User message bubble */
.chat-bubble-user {
  background: linear-gradient(135deg, var(--gold-400), var(--gold-300));
  color: var(--earth-900);
  padding: 12px 16px;
  border-radius: 16px 16px 4px 16px; /* Organic tail */
  font-size: 14px;
  line-height: 1.5;
}

/* Assistant message bubble */
.chat-bubble-assistant {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 12px 16px;
  border-radius: 16px 16px 16px 4px; /* Organic tail */
  font-size: 14px;
  line-height: 1.5;
}

:root[data-theme="dark"] .chat-bubble-assistant {
  background: rgba(45, 58, 46, 0.5);
  backdrop-filter: blur(8px);
}
```

### Typing Indicator (Hemp Seeds)

```css
.typing-indicator {
  display: flex;
  gap: 6px;
  padding: 12px 16px;
}

.typing-dot {
  width: 8px;
  height: 8px;
  background: var(--gold-400);
  border-radius: 4px 5px 4px 5px; /* Seed shape */
  animation: typingBounce 1.4s infinite ease-in-out;
}

.typing-dot:nth-child(1) { animation-delay: 0s; }
.typing-dot:nth-child(2) { animation-delay: 0.2s; }
.typing-dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes typingBounce {
  0%, 80%, 100% {
    transform: scale(1) translateY(0);
    opacity: 0.4;
  }
  40% {
    transform: scale(1.2) translateY(-6px);
    opacity: 1;
  }
}
```

### Chat Input Area

```css
.chat-input-area {
  padding: 16px 20px;
  border-top: 1px solid var(--border);
  background: var(--bg-card);
}

.chat-input-wrapper {
  display: flex;
  gap: 12px;
  align-items: flex-end;
}

.chat-input {
  flex: 1;
  min-height: 44px;
  max-height: 120px;
  padding: 12px 16px;

  font-family: var(--font-ui);
  font-size: 14px;
  color: var(--text);

  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px 14px 13px 15px; /* Organic */

  resize: none;
  transition: all 200ms ease;
}

.chat-input:focus {
  outline: none;
  border-color: var(--gold-400);
  box-shadow: 0 0 0 3px rgba(228, 170, 79, 0.15),
              var(--glow-gold-sm);
}

.chat-send-btn {
  width: 44px;
  height: 44px;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  justify-content: center;

  background: var(--gold-400);
  border: none;
  border-radius: 12px;

  color: var(--earth-900);
  cursor: pointer;
  transition: all 200ms var(--ease-spring);
}

.chat-send-btn:hover {
  transform: scale(1.05);
  box-shadow: var(--glow-gold-md);
}

.chat-send-btn:active {
  transform: scale(0.95);
}

.chat-send-btn .icon {
  width: 20px;
  height: 20px;
}
```

---

## 9. Floating Action Buttons (FABs)

### Main FAB

```css
.fab {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 90;
}

.fab-main {
  width: 56px;
  height: 56px;

  display: flex;
  align-items: center;
  justify-content: center;

  background: linear-gradient(135deg, var(--gold-400) 0%, var(--gold-300) 100%);
  border: none;
  border-radius: 28px;

  color: var(--earth-900);
  font-size: 24px;

  cursor: pointer;
  box-shadow: 0 4px 16px rgba(228, 170, 79, 0.4);

  transition: all 300ms var(--ease-spring);

  /* Bounce entrance animation */
  animation: fabBounceIn 600ms var(--ease-spring) 1.2s backwards;
}

@keyframes fabBounceIn {
  from {
    opacity: 0;
    transform: scale(0) translateY(20px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.fab-main:hover {
  transform: scale(1.08);
  box-shadow: 0 6px 24px rgba(228, 170, 79, 0.5),
              var(--glow-gold-md);
}

.fab-main:active {
  transform: scale(0.95);
}

.fab-main .icon {
  width: 24px;
  height: 24px;
}
```

### Settings FAB (Green)

```css
.fab-settings {
  right: 24px;
  bottom: 96px; /* Above AI chat FAB */
}

.fab-settings .fab-main {
  width: 48px;
  height: 48px;
  background: var(--green-500);
  box-shadow: 0 4px 16px rgba(102, 137, 113, 0.4);
}

.fab-settings .fab-main:hover {
  box-shadow: 0 6px 24px rgba(102, 137, 113, 0.5),
              var(--glow-green-md);
}
```

---

## 10. Tables

### Data Table

```css
.data-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
}

.data-table th {
  font-family: var(--font-ui);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);

  padding: 12px 16px;
  text-align: left;

  border-bottom: 1px solid var(--border);
}

.data-table td {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text);

  padding: 12px 16px;

  border-bottom: 1px solid var(--border-light);
}

.data-table tr:last-child td {
  border-bottom: none;
}

.data-table tr:hover td {
  background: rgba(228, 170, 79, 0.05);
}

/* Highlight important values */
.data-table td.highlight {
  color: var(--gold-400);
  font-weight: 600;
}
```

---

## 11. Loading States

### Skeleton Loader

```css
.skeleton {
  background: linear-gradient(
    90deg,
    var(--border) 25%,
    var(--bg) 50%,
    var(--border) 75%
  );
  background-size: 200% 100%;
  animation: skeletonShimmer 1.5s infinite;
  border-radius: 4px;
}

@keyframes skeletonShimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Skeleton variants */
.skeleton-text {
  height: 14px;
  margin-bottom: 8px;
}

.skeleton-title {
  height: 24px;
  width: 60%;
  margin-bottom: 12px;
}

.skeleton-circle {
  border-radius: 50%;
}

/* Dark mode */
:root[data-theme="dark"] .skeleton {
  background: linear-gradient(
    90deg,
    var(--earth-600) 25%,
    var(--earth-500) 50%,
    var(--earth-600) 75%
  );
  background-size: 200% 100%;
}
```

### Loading Spinner (Hemp Seed)

```css
.loader-seed {
  width: 24px;
  height: 24px;

  background: var(--gold-400);
  border-radius: 50% 60% 50% 60%; /* Seed shape */

  animation: seedPulse 1.2s ease-in-out infinite;
}

@keyframes seedPulse {
  0%, 100% {
    transform: scale(1) rotate(0deg);
    opacity: 1;
  }
  50% {
    transform: scale(1.2) rotate(180deg);
    opacity: 0.6;
  }
}
```

---

**Next**: See `ANIMATION_SYSTEM.md` for detailed animation choreography.
