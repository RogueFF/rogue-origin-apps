# Visual Design System

**Version**: 1.0
**Aesthetic**: Botanical Luxury (Confident - 10-15% visibility)
**Created for**: Sonnet implementation

---

## 1. Color Palette

### Brand Colors (Immutable)
```css
--ro-green: #668971;        /* Primary brand green */
--ro-gold: #e4aa4f;         /* Primary brand gold */
```

### Extended Color System

#### Green Family (Foundation - 80% of UI)
```css
/* Light Mode Greens */
--green-50: #f4f7f5;        /* Lightest tint, backgrounds */
--green-100: #e8efe9;       /* Subtle backgrounds */
--green-200: #d1dfd4;       /* Borders, dividers */
--green-300: #a8c4ad;       /* Secondary elements */
--green-400: #8ba896;       /* Muted text, icons */
--green-500: #668971;       /* PRIMARY - Brand green */
--green-600: #4a6b54;       /* Hover states */
--green-700: #3d5243;       /* Active states */
--green-800: #2d3a32;       /* Dark text */
--green-900: #1a1f16;       /* Near black */

/* Dark Mode Earth Tones */
--earth-900: #0f110e;       /* Deepest background */
--earth-800: #12150f;       /* Sidebar background */
--earth-700: #1a1f16;       /* Card backgrounds */
--earth-600: #252b22;       /* Elevated surfaces */
--earth-500: #2d3a32;       /* Borders */
--earth-400: #4a5a4e;       /* Muted elements */
--earth-300: #6b7a6f;       /* Secondary text */
--earth-200: #8a9a8e;       /* Body text */
--earth-100: #b8c4ba;       /* Primary text */
--earth-50: #f5f2ed;        /* Brightest text */
```

#### Gold Family (Accent - 15% of UI)
```css
--gold-50: #fef9f0;         /* Lightest tint */
--gold-100: #fdf0d8;        /* Subtle highlights */
--gold-200: #f8ddb0;        /* Light backgrounds */
--gold-300: #f0cb60;        /* Bright gold - CTAs */
--gold-400: #e4aa4f;        /* PRIMARY - Brand gold */
--gold-500: #d4993f;        /* Hover state */
--gold-600: #c08832;        /* Active state */
--gold-700: #a67428;        /* Dark gold */
--gold-800: #8c5f1f;        /* Deep gold */
--gold-warm: #e8b05d;       /* Warmer gold for dark mode */
```

#### Semantic Colors
```css
--success: #668971;         /* Green (matches brand) */
--success-light: rgba(102, 137, 113, 0.15);
--warning: #e4aa4f;         /* Gold (matches brand) */
--warning-light: rgba(228, 170, 79, 0.15);
--danger: #c45c4a;          /* Muted red (botanical) */
--danger-light: rgba(196, 92, 74, 0.15);
--info: #62758d;            /* Steel blue */
--info-light: rgba(98, 117, 141, 0.15);
```

#### Cultivation Type Colors
```css
--sungrown: #bf8e4e;        /* Warm amber */
--sungrown-light: rgba(191, 142, 78, 0.15);
--greenhouse: #8f9263;      /* Sage olive */
--greenhouse-light: rgba(143, 146, 99, 0.15);
--indoor: #62758d;          /* Cool steel */
--indoor-light: rgba(98, 117, 141, 0.15);
```

#### Special Colors
```css
--hemp-fiber: #b8a88a;      /* Hemp rope/fiber color */
--parchment: #faf8f5;       /* Light mode background */
--candlelight: rgba(228, 170, 79, 0.08);  /* Warm glow overlay */
```

### Color Distribution Strategy

| Zone | Light Mode | Dark Mode | Usage |
|------|------------|-----------|-------|
| **Backgrounds (60%)** | `--parchment` #faf8f5 | `--earth-900` #0f110e | Page backgrounds |
| **Surfaces (20%)** | White #ffffff | `--earth-700` #1a1f16 | Cards, panels |
| **Borders (10%)** | `--green-200` | `--earth-500` | Dividers, outlines |
| **Gold Accents (8%)** | `--gold-400` | `--gold-warm` | Numbers, buttons, highlights |
| **Bright Gold (2%)** | `--gold-300` | `--gold-300` | CTAs, critical alerts |

### Glow Effects
```css
/* Gold glow for important elements */
--glow-gold-sm: 0 0 8px rgba(228, 170, 79, 0.3);
--glow-gold-md: 0 0 16px rgba(228, 170, 79, 0.4);
--glow-gold-lg: 0 0 32px rgba(228, 170, 79, 0.5);
--glow-gold-xl: 0 0 48px rgba(228, 170, 79, 0.6);

/* Green glow for success states */
--glow-green-sm: 0 0 8px rgba(102, 137, 113, 0.3);
--glow-green-md: 0 0 16px rgba(102, 137, 113, 0.4);
--glow-green-lg: 0 0 32px rgba(102, 137, 113, 0.5);
```

---

## 2. Typography Scale

### Font Families
```css
--font-display: 'DM Serif Display', Georgia, serif;
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;
--font-ui: 'Outfit', 'Inter', system-ui, sans-serif;
```

### Font Usage Rules

| Element | Font | Weight | Purpose |
|---------|------|--------|---------|
| Hero numbers | `--font-display` | 400 | Daily production, big KPIs |
| KPI values | `--font-display` | 400 | Important metrics |
| Data/tables | `--font-mono` | 400-500 | Precise numbers, timestamps |
| Headings | `--font-ui` | 600-700 | Section titles |
| Body text | `--font-ui` | 400 | Descriptions, labels |
| Labels | `--font-ui` | 500 | Small uppercase labels |
| Buttons | `--font-ui` | 600 | Interactive elements |

### Type Scale
```css
/* Display Scale (DM Serif Display) */
--text-hero: 96px;          /* Daily production number */
--text-hero-mobile: 64px;   /* Mobile hero */
--text-display: 48px;       /* Large KPIs */
--text-display-sm: 36px;    /* Medium KPIs */

/* UI Scale (Outfit) */
--text-h1: 28px;            /* Page titles */
--text-h2: 22px;            /* Section headers */
--text-h3: 18px;            /* Card titles */
--text-h4: 16px;            /* Subsection titles */
--text-body: 14px;          /* Body text */
--text-sm: 13px;            /* Secondary text */
--text-xs: 11px;            /* Labels, captions */
--text-xxs: 10px;           /* Tiny labels */

/* Mono Scale (JetBrains Mono) */
--text-mono-lg: 18px;       /* Large data values */
--text-mono-md: 14px;       /* Table data */
--text-mono-sm: 12px;       /* Timestamps, IDs */
```

### Line Heights
```css
--leading-tight: 1.1;       /* Display text */
--leading-snug: 1.25;       /* Headings */
--leading-normal: 1.5;      /* Body text */
--leading-relaxed: 1.625;   /* Long-form text */
```

### Letter Spacing
```css
--tracking-tight: -0.02em;  /* Large display text */
--tracking-normal: 0;       /* Body text */
--tracking-wide: 0.05em;    /* Uppercase labels */
--tracking-wider: 0.08em;   /* Small caps */
--tracking-widest: 0.1em;   /* Tiny labels */
```

### Typography Examples

**Hero Production Number**
```css
.hero-number {
  font-family: var(--font-display);
  font-size: var(--text-hero);
  font-weight: 400;
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
  color: var(--gold-400);
  text-shadow: var(--glow-gold-lg);
}
```

**KPI Label**
```css
.kpi-label {
  font-family: var(--font-ui);
  font-size: var(--text-xxs);
  font-weight: 500;
  line-height: var(--leading-snug);
  letter-spacing: var(--tracking-widest);
  text-transform: uppercase;
  color: var(--text-muted);
}
```

**Data Value**
```css
.data-value {
  font-family: var(--font-mono);
  font-size: var(--text-mono-md);
  font-weight: 500;
  line-height: var(--leading-snug);
  font-feature-settings: 'tnum' 1; /* Tabular numbers */
}
```

---

## 3. Spacing System

### Base Unit: 8px Grid
```css
--space-0: 0;
--space-1: 4px;             /* Tight spacing */
--space-2: 8px;             /* Default small */
--space-3: 12px;            /* Between related items */
--space-4: 16px;            /* Standard spacing */
--space-5: 20px;            /* Comfortable */
--space-6: 24px;            /* Section padding */
--space-7: 32px;            /* Large gaps */
--space-8: 40px;            /* Section breaks */
--space-9: 48px;            /* Major sections */
--space-10: 64px;           /* Page-level spacing */
--space-11: 80px;           /* Hero spacing */
--space-12: 96px;           /* Maximum spacing */
```

### Component Spacing

| Component | Padding | Gap |
|-----------|---------|-----|
| Page | `--space-6` (24px) | - |
| Hero section | `--space-8` (40px) | `--space-7` (32px) |
| Widget card | `--space-5` (20px) | `--space-4` (16px) |
| KPI card | `--space-4` (16px) | `--space-3` (12px) |
| Button | `--space-2` `--space-4` (8px 16px) | `--space-2` (8px) |
| Input | `--space-3` `--space-4` (12px 16px) | - |
| Table cell | `--space-3` `--space-4` (12px 16px) | - |
| Icon + label | - | `--space-2` (8px) |

---

## 4. Border Radius System

### Organic Radius Scale
```css
/* Standard (symmetric) */
--radius-xs: 4px;           /* Tiny elements, chips */
--radius-sm: 8px;           /* Buttons, inputs */
--radius-md: 12px;          /* Small cards */
--radius-lg: 16px;          /* Cards, panels */
--radius-xl: 20px;          /* Large cards */
--radius-2xl: 24px;         /* Hero sections */
--radius-full: 9999px;      /* Pills, avatars */

/* Organic (asymmetric for botanical feel) */
--radius-organic-sm: 8px 12px 10px 14px;
--radius-organic-md: 12px 16px 14px 18px;
--radius-organic-lg: 16px 20px 18px 22px;
--radius-organic-xl: 20px 24px 22px 26px;
```

### Usage Rules
- **Standard radius**: Use for most UI elements
- **Organic radius**: Use for featured elements (hero cards, AI chat bubbles, botanical accents)
- **Full radius**: Use for pills, tags, avatars, FABs

---

## 5. Shadow System

### Light Mode Shadows
```css
--shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.04);
--shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.06);
--shadow-md: 0 4px 8px rgba(0, 0, 0, 0.08);
--shadow-lg: 0 8px 16px rgba(0, 0, 0, 0.1);
--shadow-xl: 0 16px 32px rgba(0, 0, 0, 0.12);

/* Elevated with subtle glow */
--shadow-elevated:
  0 2px 4px rgba(0, 0, 0, 0.04),
  0 8px 16px rgba(0, 0, 0, 0.08),
  0 0 0 1px rgba(102, 137, 113, 0.05);
```

### Dark Mode Shadows (4-Layer Dramatic)
```css
--shadow-dark-sm:
  0 2px 4px rgba(0, 0, 0, 0.2),
  0 4px 8px rgba(0, 0, 0, 0.15);

--shadow-dark-md:
  0 2px 4px rgba(0, 0, 0, 0.1),
  0 8px 16px rgba(0, 0, 0, 0.15),
  0 16px 32px rgba(0, 0, 0, 0.2),
  0 0 24px rgba(228, 170, 79, 0.05);

--shadow-dark-lg:
  0 2px 4px rgba(0, 0, 0, 0.1),
  0 8px 16px rgba(0, 0, 0, 0.15),
  0 16px 32px rgba(0, 0, 0, 0.2),
  0 32px 64px rgba(0, 0, 0, 0.25);

--shadow-dark-xl:
  0 4px 8px rgba(0, 0, 0, 0.1),
  0 16px 32px rgba(0, 0, 0, 0.2),
  0 32px 64px rgba(0, 0, 0, 0.25),
  0 48px 96px rgba(0, 0, 0, 0.3),
  0 0 40px rgba(102, 137, 113, 0.1);

/* Gold glow shadow for important elements */
--shadow-gold:
  0 4px 8px rgba(0, 0, 0, 0.1),
  0 8px 16px rgba(0, 0, 0, 0.1),
  0 0 32px rgba(228, 170, 79, 0.3);
```

### Shadow Usage

| Element | Light Mode | Dark Mode |
|---------|------------|-----------|
| Cards (rest) | `--shadow-sm` | `--shadow-dark-sm` |
| Cards (hover) | `--shadow-lg` | `--shadow-dark-lg` |
| Hero section | `--shadow-elevated` | `--shadow-gold` |
| FABs | `--shadow-lg` | `--shadow-gold` |
| Dropdowns | `--shadow-xl` | `--shadow-dark-xl` |
| Modals | `--shadow-xl` | `--shadow-dark-xl` |

---

## 6. Animation System

### Timing Scale
```css
--duration-instant: 0ms;
--duration-fast: 150ms;     /* Micro-interactions */
--duration-normal: 300ms;   /* Standard transitions */
--duration-slow: 500ms;     /* Emphasized transitions */
--duration-slower: 800ms;   /* Complex animations */
--duration-slowest: 1200ms; /* Hero animations */
```

### Easing Functions
```css
/* Spring easing (primary) */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

/* Organic easing */
--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
--ease-in-out-expo: cubic-bezier(0.87, 0, 0.13, 1);

/* Standard easing */
--ease-out: cubic-bezier(0.33, 1, 0.68, 1);
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);

/* Bounce (satisfying clicks) */
--ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);
```

### Standard Transitions
```css
/* Quick state changes */
--transition-fast: 150ms var(--ease-out);

/* Standard interactions */
--transition-normal: 300ms var(--ease-spring);

/* Emphasized changes */
--transition-slow: 500ms var(--ease-spring);

/* Color/opacity only */
--transition-colors: 200ms ease;

/* Transform only */
--transition-transform: 300ms var(--ease-spring);

/* All properties */
--transition-all: 300ms var(--ease-spring);
```

### Animation Presets

**Pop In (widget reveal)**
```css
@keyframes popIn {
  0% {
    opacity: 0;
    transform: scale(0.9) translateY(20px);
  }
  100% {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
.pop-in {
  animation: popIn 500ms var(--ease-spring) forwards;
}
```

**Count Up (numbers)**
```css
@keyframes countUp {
  0% {
    opacity: 0;
    transform: translateY(8px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}
.count-up {
  animation: countUp 400ms var(--ease-out) forwards;
}
```

**Pulse Glow (attention)**
```css
@keyframes pulseGlow {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(228, 170, 79, 0);
  }
  50% {
    box-shadow: 0 0 24px 4px rgba(228, 170, 79, 0.4);
  }
}
.pulse-glow {
  animation: pulseGlow 2s ease-in-out infinite;
}
```

**Float (subtle movement)**
```css
@keyframes float {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-4px);
  }
}
.float {
  animation: float 3s ease-in-out infinite;
}
```

**Drift Pattern (background)**
```css
@keyframes driftPattern {
  0% {
    background-position: 0 0;
  }
  100% {
    background-position: 120px 120px;
  }
}
.drift {
  animation: driftPattern 60s linear infinite;
}
```

---

## 7. Background Layers

### Dark Mode Background Stack
```css
/* Layer 1: Base gradient */
background: linear-gradient(
  135deg,
  #0f110e 0%,
  #12150f 50%,
  #1a1f16 100%
);

/* Layer 2: Radial glow (corners) */
background-image:
  radial-gradient(ellipse at 0% 0%, rgba(102, 137, 113, 0.08) 0%, transparent 50%),
  radial-gradient(ellipse at 100% 100%, rgba(228, 170, 79, 0.05) 0%, transparent 50%);

/* Layer 3: Hemp leaf pattern (12% opacity for confident botanical) */
background-image: url("data:image/svg+xml,..."); /* See ICON_SET.md */
background-size: 120px;
opacity: 0.12;
animation: driftPattern 60s linear infinite;

/* Layer 4: Hemp fiber texture (8% opacity) */
background-image: url("data:image/svg+xml,..."); /* Woven pattern */
opacity: 0.08;

/* Layer 5: Film grain noise (4% opacity) */
background-image: url("data:image/svg+xml,..."); /* Noise texture */
opacity: 0.04;

/* Layer 6: Vignette */
box-shadow: inset 0 0 200px 50px rgba(0, 0, 0, 0.3);
```

### Light Mode Background Stack
```css
/* Layer 1: Cream gradient */
background: linear-gradient(
  135deg,
  #faf8f5 0%,
  #ffffff 100%
);

/* Layer 2: Gold radial glow (subtle) */
background-image:
  radial-gradient(ellipse at 70% 20%, rgba(228, 170, 79, 0.03) 0%, transparent 50%);

/* Layer 3: Hemp leaf pattern (6% opacity for light mode) */
background-image: url("data:image/svg+xml,...");
background-size: 120px;
opacity: 0.06;

/* Layer 4: Linen texture (premium paper feel) */
background-image: url("data:image/svg+xml,...");
opacity: 0.03;
```

---

## 8. Sound Design (Toggle-able)

### Sound Files
All sounds should be:
- Format: MP3 or WAV
- Duration: 50-200ms
- Volume: -12dB to -6dB (subtle)
- Style: Organic, wooden, soft

### Sound Triggers

| Action | Sound | Duration | Notes |
|--------|-------|----------|-------|
| Button click | Soft wooden tap | 80ms | Satisfying, not sharp |
| Widget drag start | Gentle lift | 100ms | Airy, subtle whoosh |
| Widget drop | Soft thud | 120ms | Cushioned landing |
| Success action | Warm chime | 200ms | Two-note ascending |
| Error | Soft knock | 100ms | Gentle warning |
| Toggle on | Soft click | 60ms | Positive snap |
| Toggle off | Muted click | 60ms | Slightly lower pitch |
| AI message receive | Soft bell | 150ms | Single gentle tone |
| Panel open | Whoosh in | 150ms | Soft air movement |
| Panel close | Whoosh out | 120ms | Reverse of open |

### Implementation
```javascript
// Sound manager with toggle
const SoundManager = {
  enabled: localStorage.getItem('soundEnabled') !== 'false',

  sounds: {
    click: new Audio('/sounds/click.mp3'),
    lift: new Audio('/sounds/lift.mp3'),
    drop: new Audio('/sounds/drop.mp3'),
    success: new Audio('/sounds/success.mp3'),
    error: new Audio('/sounds/error.mp3'),
    toggle: new Audio('/sounds/toggle.mp3'),
    message: new Audio('/sounds/message.mp3'),
    whooshIn: new Audio('/sounds/whoosh-in.mp3'),
    whooshOut: new Audio('/sounds/whoosh-out.mp3'),
  },

  play(name) {
    if (!this.enabled || !this.sounds[name]) return;
    this.sounds[name].currentTime = 0;
    this.sounds[name].volume = 0.3;
    this.sounds[name].play().catch(() => {});
  },

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('soundEnabled', this.enabled);
    if (this.enabled) this.play('toggle');
  }
};
```

### Sound Toggle UI
- Location: Settings panel
- Label: "Sound Effects"
- Icon: Speaker/muted speaker
- Default: Enabled
- Persists in localStorage

---

## 9. CSS Variables Master List

```css
:root {
  /* ===== COLORS ===== */
  /* Brand */
  --ro-green: #668971;
  --ro-gold: #e4aa4f;

  /* Green Family */
  --green-50: #f4f7f5;
  --green-100: #e8efe9;
  --green-200: #d1dfd4;
  --green-300: #a8c4ad;
  --green-400: #8ba896;
  --green-500: #668971;
  --green-600: #4a6b54;
  --green-700: #3d5243;
  --green-800: #2d3a32;
  --green-900: #1a1f16;

  /* Gold Family */
  --gold-50: #fef9f0;
  --gold-100: #fdf0d8;
  --gold-200: #f8ddb0;
  --gold-300: #f0cb60;
  --gold-400: #e4aa4f;
  --gold-500: #d4993f;
  --gold-600: #c08832;
  --gold-700: #a67428;
  --gold-800: #8c5f1f;
  --gold-warm: #e8b05d;

  /* Earth Tones (Dark Mode) */
  --earth-900: #0f110e;
  --earth-800: #12150f;
  --earth-700: #1a1f16;
  --earth-600: #252b22;
  --earth-500: #2d3a32;
  --earth-400: #4a5a4e;
  --earth-300: #6b7a6f;
  --earth-200: #8a9a8e;
  --earth-100: #b8c4ba;
  --earth-50: #f5f2ed;

  /* Semantic */
  --success: #668971;
  --warning: #e4aa4f;
  --danger: #c45c4a;
  --info: #62758d;

  /* Special */
  --hemp-fiber: #b8a88a;
  --parchment: #faf8f5;
  --sungrown: #bf8e4e;
  --greenhouse: #8f9263;
  --indoor: #62758d;

  /* ===== TYPOGRAPHY ===== */
  --font-display: 'DM Serif Display', Georgia, serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  --font-ui: 'Outfit', 'Inter', system-ui, sans-serif;

  --text-hero: 96px;
  --text-hero-mobile: 64px;
  --text-display: 48px;
  --text-display-sm: 36px;
  --text-h1: 28px;
  --text-h2: 22px;
  --text-h3: 18px;
  --text-h4: 16px;
  --text-body: 14px;
  --text-sm: 13px;
  --text-xs: 11px;
  --text-xxs: 10px;

  --leading-tight: 1.1;
  --leading-snug: 1.25;
  --leading-normal: 1.5;
  --leading-relaxed: 1.625;

  --tracking-tight: -0.02em;
  --tracking-normal: 0;
  --tracking-wide: 0.05em;
  --tracking-wider: 0.08em;
  --tracking-widest: 0.1em;

  /* ===== SPACING ===== */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-7: 32px;
  --space-8: 40px;
  --space-9: 48px;
  --space-10: 64px;
  --space-11: 80px;
  --space-12: 96px;

  /* ===== BORDER RADIUS ===== */
  --radius-xs: 4px;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 20px;
  --radius-2xl: 24px;
  --radius-full: 9999px;
  --radius-organic-sm: 8px 12px 10px 14px;
  --radius-organic-md: 12px 16px 14px 18px;
  --radius-organic-lg: 16px 20px 18px 22px;

  /* ===== SHADOWS ===== */
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.06);
  --shadow-md: 0 4px 8px rgba(0, 0, 0, 0.08);
  --shadow-lg: 0 8px 16px rgba(0, 0, 0, 0.1);
  --shadow-xl: 0 16px 32px rgba(0, 0, 0, 0.12);

  --glow-gold-sm: 0 0 8px rgba(228, 170, 79, 0.3);
  --glow-gold-md: 0 0 16px rgba(228, 170, 79, 0.4);
  --glow-gold-lg: 0 0 32px rgba(228, 170, 79, 0.5);

  /* ===== ANIMATION ===== */
  --duration-fast: 150ms;
  --duration-normal: 300ms;
  --duration-slow: 500ms;
  --duration-slower: 800ms;
  --duration-slowest: 1200ms;

  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-out: cubic-bezier(0.33, 1, 0.68, 1);

  --transition-fast: 150ms var(--ease-out);
  --transition-normal: 300ms var(--ease-spring);
  --transition-slow: 500ms var(--ease-spring);
}
```

---

## 10. Theme Switching

### Light Mode (Default)
```css
:root {
  --bg: var(--parchment);
  --bg-card: #ffffff;
  --text: var(--green-800);
  --text-muted: var(--green-400);
  --border: var(--green-200);
  --shadow: var(--shadow-sm);
}
```

### Dark Mode
```css
:root[data-theme="dark"] {
  --bg: var(--earth-900);
  --bg-card: var(--earth-700);
  --text: var(--earth-50);
  --text-muted: var(--earth-300);
  --border: var(--earth-500);
  --shadow: var(--shadow-dark-md);
  --gold: var(--gold-warm);
}
```

### Theme Toggle Animation
```css
:root {
  transition:
    --bg 600ms var(--ease-out-expo),
    --text 600ms var(--ease-out-expo),
    --border 600ms var(--ease-out-expo);
}

/* Cross-fade effect */
body::after {
  content: '';
  position: fixed;
  inset: 0;
  background: var(--bg);
  opacity: 0;
  pointer-events: none;
  transition: opacity 300ms;
}

body.theme-transitioning::after {
  opacity: 1;
}
```

---

**Next**: See `ICON_SET.md` for complete botanical SVG icons.
