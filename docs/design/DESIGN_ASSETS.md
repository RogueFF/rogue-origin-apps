# Design Assets Reference

**Version**: 2.2
**Last Updated**: 2026-01-28
**Purpose**: Single source of truth for all UI colors, themes, logos, and design assets

---

## 1. Brand Identity

### Primary Brand Colors
| Color Name | Hex Code | CSS Variable | Usage |
|------------|----------|--------------|-------|
| **Rogue Green** | `#668971` | `--ro-green` | Primary brand color, success states, CTA backgrounds |
| **Rogue Gold** | `#e4aa4f` | `--ro-gold` | Accent color, highlights, important numbers |

### Logo Assets
| Asset | File Path | Format | Dimensions | Usage |
|-------|-----------|--------|------------|-------|
| Square Logo | `/src/assets/ro-logo-square.png` | PNG | 512x512 | App icons, favicons, social media |
| Horizontal Logo | `/src/assets/ro-logo-horizontal.png` | PNG | Variable | Headers, email signatures |
| Horizontal Logo (Print) | `RO_HORIZONTALOGO.eps` | EPS | Vector | Print materials, design work |
| Stacked Logo (Print) | `RO_STACKEDLOGO.eps` | EPS | Vector | Print materials, vertical layouts |
| Icon Only (Print) | `RO-Icon.eps` | EPS | Vector | Icon-only applications |
| Brand Style Sheet | `RO-Style-Sheet.ai` | AI | - | Adobe Illustrator brand guide |
| Hemp Leaf Pattern | `/src/assets/icons/hemp-leaf-pattern.svg` | SVG | Tileable | Background pattern overlay |
| Hemp Fiber Texture | `/src/assets/icons/hemp-fiber-texture-preview.svg` | SVG | Tileable | Subtle background texture |
| Pattern Preview | `/src/assets/icons/ro-pattern-preview.svg` | SVG | Variable | Design mockups |

### Bag Icons
| Asset | File Path | Format | Dimensions | Usage |
|-------|-----------|--------|------------|-------|
| Bag Icon 01 | `/src/assets/icons/Bag-Icon-01.png` | PNG | Small | Product selection UI |
| Bag Icon 02 | `/src/assets/icons/Bag-Icon-02.png` | PNG | Small | Product selection UI |
| Bag Icon 03 | `/src/assets/icons/Bag-Icon-03.png` | PNG | Small | Product selection UI |
| Bag Icon 04 | `/src/assets/icons/Bag-Icon-04.png` | PNG | Small | Product selection UI |
| Bag Icon 05 | `/src/assets/icons/Bag-Icon-05.png` | PNG | Small | Product selection UI |

### Brand Fonts
| Font Name | File Name | Format | Weights | Usage |
|-----------|-----------|--------|---------|-------|
| Flood Std | `Flood Std Regular.otf` | OTF | Regular | Primary brand headlines, packaging |
| NeutraText | `NeutraText-Bold.otf`, `NeutraText-Book.otf` | OTF | Bold, Book | Brand emphasis and body copy |
| Trebuchet MS | `Trebuchet MS.ttf` (+ variants) | TTF | Regular, Bold, Italic, Bold Italic | Web fallback font |
| Helvetica | `Helvetica.ttc` | TTC | Multiple | Universal fallback

---

## 2. Color System

### Green Color Family (Foundation - 80% of UI)
| Shade | Light Mode | Dark Mode (Earth Tones) | CSS Variable | Usage |
|-------|------------|-------------------------|--------------|-------|
| **50** | `#f4f7f5` | `#f5f2ed` | `--green-50` / `--earth-50` | Lightest tint, subtle backgrounds |
| **100** | `#e8efe9` | `#b8c4ba` | `--green-100` / `--earth-100` | Background highlights |
| **200** | `#d1dfd4` | `#8a9a8e` | `--green-200` / `--earth-200` | Borders, dividers |
| **300** | `#a8c4ad` | `#6b7a6f` | `--green-300` / `--earth-300` | Secondary elements |
| **400** | `#8ba896` | `#4a5a4e` | `--green-400` / `--earth-400` | Muted text, icons |
| **500** | `#668971` | `#2d3a32` | `--green-500` / `--earth-500` | PRIMARY brand green |
| **600** | `#4a6b54` | `#252b22` | `--green-600` / `--earth-600` | Hover states |
| **700** | `#3d5243` | `#1a1f16` | `--green-700` / `--earth-700` | Active states |
| **800** | `#2d3a32` | `#12150f` | `--green-800` / `--earth-800` | Dark text |
| **900** | `#1a1f16` | `#0f110e` | `--green-900` / `--earth-900` | Near black |

### Gold Color Family (Accent - 15% of UI)
| Shade | Hex Code | CSS Variable | Usage |
|-------|----------|--------------|-------|
| **50** | `#fef9f0` | `--gold-50` | Lightest tint |
| **100** | `#fdf0d8` | `--gold-100` | Subtle highlights |
| **200** | `#f8ddb0` | `--gold-200` | Light backgrounds |
| **300** | `#f0cb60` | `--gold-300` | Bright gold - CTAs |
| **400** | `#e4aa4f` | `--gold-400` | PRIMARY brand gold |
| **500** | `#d4993f` | `--gold-500` | Hover state |
| **600** | `#c08832` | `--gold-600` | Active state |
| **700** | `#a67428` | `--gold-700` | Dark gold |
| **800** | `#8c5f1f` | `--gold-800` | Deep gold |
| **Warm** | `#e8b05d` | `--gold-warm` | Gold for dark mode |
| **Light** | `#f0cb60` | `--gold-light` | Bright accent |
| **Dim** | `rgba(228, 170, 79, 0.12)` | `--gold-dim` | Subtle highlight (light mode) |
| **Dim Dark** | `rgba(228, 170, 79, 0.18)` | `--gold-dim` | Subtle highlight (dark mode) |

### Semantic Colors
| Name | Hex Code | CSS Variable | Usage |
|------|----------|--------------|-------|
| **Success** | `#668971` | `--success` | Success messages, completed states |
| **Warning** | `#e4aa4f` | `--warning` | Warning messages, caution states |
| **Danger** | `#c45c4a` | `--danger` | Error messages, destructive actions |
| **Info** | `#62758d` | `--info` | Informational messages, neutral states |

### Cultivation Type Colors
| Type | Hex Code | CSS Variable | Dim Variable | Usage |
|------|----------|--------------|--------------|-------|
| **Sungrown** | `#bf8e4e` | `--sungrown` | `--sungrown-dim` | Sungrown product badges |
| **Greenhouse** | `#8f9263` | `--greenhouse` | `--greenhouse-dim` | Greenhouse product badges |
| **Indoor** | `#62758d` | `--indoor` | `--indoor-dim` | Indoor product badges |

### Special Colors
| Name | Hex Code | CSS Variable | Usage |
|------|----------|--------------|-------|
| **Hemp Fiber** | `#b8a88a` | `--hemp-fiber` | Hemp rope/fiber texture color |
| **Parchment** | `#faf8f5` | `--parchment` | Light mode background |

---

## 3. Theme Definitions

### Light Theme (Default)
```css
--bg: #faf8f5;              /* Parchment cream background */
--bg-warm: #f3efe7;         /* Warmer background variant */
--bg-card: #ffffff;         /* Card/panel backgrounds */
--bg-dark: #2d3a2e;         /* Dark header background */
--glass: rgba(255, 255, 255, 0.6);
--glass-border: rgba(102, 137, 113, 0.15);
--border: rgba(102, 137, 113, 0.2);
--border-strong: rgba(102, 137, 113, 0.2);
--border-light: rgba(102, 137, 113, 0.1);
--text: #2d3a32;            /* Primary text */
--text-secondary: #5a6b5f;  /* Secondary text */
--text-muted: #8a9a8e;      /* Muted text */
--text-light: #94a397;      /* Light text */
--header-bg: #2d3a2e;       /* Header background */
--header-text: #faf8f4;     /* Header text */
```

### Dark Theme
```css
--bg: #1a1a1a;              /* Deep black background */
--bg-warm: #22291e;         /* Warm earth tone */
--bg-card: #2d2d2d;         /* Card backgrounds */
--bg-dark: #12160f;         /* Darkest backgrounds */
--glass: rgba(45, 45, 45, 0.6);
--glass-border: rgba(102, 137, 113, 0.25);
--border: rgba(255, 255, 255, 0.2);
--border-strong: rgba(255, 255, 255, 0.2);
--border-light: rgba(255, 255, 255, 0.1);
--text: #e0e0e0;            /* Primary text */
--text-secondary: #b8b8b8;  /* Secondary text */
--text-muted: #888888;      /* Muted text */
--text-light: #6b7a6f;      /* Light text */
--header-bg: #12160f;       /* Header background */
```

---

## 4. Typography System

### Font Families
| Name | Font Stack | CSS Variable | Usage |
|------|------------|--------------|-------|
| **Display** | 'DM Serif Display', Georgia, serif | `--font-display` | Hero numbers, large KPIs, emphasis |
| **Monospace** | 'JetBrains Mono', 'Fira Code', monospace | `--font-mono` | Data tables, precise numbers, code |
| **UI** | 'Outfit', 'Inter', system-ui, sans-serif | `--font-ui` | Body text, headings, buttons, UI |

### Type Scale
| Name | Size | CSS Variable | Line Height | Usage |
|------|------|--------------|-------------|-------|
| **Hero** | 96px | `--text-hero` | 1.1 | Daily production number |
| **Hero Mobile** | 64px | `--text-hero-mobile` | 1.1 | Hero on mobile devices |
| **Display** | 48px | `--text-display` | 1.1 | Large KPIs |
| **Display Small** | 36px | `--text-display-sm` | 1.1 | Medium KPIs |
| **H1** | 28px | `--text-h1` | 1.25 | Page titles |
| **H2** | 22px | `--text-h2` | 1.25 | Section headers |
| **H3** | 18px | `--text-h3` | 1.25 | Card titles |
| **H4** | 16px | `--text-h4` | 1.25 | Subsection titles |
| **Body** | 14px | `--text-body` | 1.5 | Body text |
| **Small** | 13px | `--text-sm` | 1.5 | Secondary text |
| **Extra Small** | 11px | `--text-xs` | 1.5 | Labels, captions |
| **Tiny** | 10px | `--text-xxs` | 1.5 | Tiny labels (min 12px on mobile) |

### Font Weights
| Name | Weight | Usage |
|------|--------|-------|
| **Normal** | 400 | Body text, display numbers |
| **Medium** | 500 | Labels, data values |
| **Semibold** | 600 | Buttons, headings |
| **Bold** | 700 | Emphasis |

### Letter Spacing
| Name | Value | CSS Variable | Usage |
|------|-------|--------------|-------|
| **Tight** | -0.02em | `--tracking-tight` | Large display text |
| **Normal** | 0 | `--tracking-normal` | Body text |
| **Wide** | 0.05em | `--tracking-wide` | Uppercase labels |
| **Wider** | 0.08em | `--tracking-wider` | Small caps |
| **Widest** | 0.1em | `--tracking-widest` | Tiny labels |

---

## 5. Spacing System (8px Grid)

| Name | Size | CSS Variable | Usage |
|------|------|--------------|-------|
| **XS** | 4px | `--space-1` | Tight spacing |
| **SM** | 8px | `--space-2` / `--space-xs` | Default small |
| **Between** | 12px | `--space-3` | Related items |
| **MD** | 16px | `--space-4` / `--space-sm` | Standard spacing |
| **Comfortable** | 20px | `--space-5` | Comfortable spacing |
| **LG** | 24px | `--space-6` / `--space-md` | Section padding |
| **Large Gap** | 32px | `--space-7` | Large gaps |
| **Section** | 40px | `--space-8` / `--space-lg` | Section breaks |
| **Major** | 48px | `--space-9` | Major sections |
| **XL** | 64px | `--space-10` / `--space-xl` | Page-level spacing |
| **Hero** | 80px | `--space-11` | Hero spacing |
| **Max** | 96px | `--space-12` | Maximum spacing |

---

## 6. Border Radius System

### Standard (Symmetric)
| Name | Size | CSS Variable | Usage |
|------|------|--------------|-------|
| **XS** | 4px | `--radius-xs` | Tiny elements, chips |
| **SM** | 8px | `--radius-sm` | Buttons, inputs |
| **MD** | 12px | `--radius-md` | Small cards |
| **LG** | 16px | `--radius-lg` | Cards, panels |
| **XL** | 20px | `--radius-xl` | Large cards |
| **2XL** | 24px | `--radius-2xl` | Hero sections |
| **Full** | 9999px | `--radius-full` | Pills, avatars, FABs |

### Organic (Asymmetric - Botanical Feel)
| Name | Value | CSS Variable | Usage |
|------|-------|--------------|-------|
| **Small** | 8px 12px 10px 14px | `--radius-organic-sm` | Organic buttons |
| **Medium** | 12px 16px 14px 18px | `--radius-organic-md` | Organic cards |
| **Large** | 16px 20px 18px 22px | `--radius-organic-lg` | Featured elements |
| **XL** | 20px 24px 22px 26px | `--radius-organic-xl` | Hero elements |

---

## 7. Shadow System

### Light Mode Shadows
| Name | Value | CSS Variable | Usage |
|------|-------|--------------|-------|
| **XS** | 0 1px 2px rgba(0, 0, 0, 0.04) | `--shadow-xs` | Minimal depth |
| **SM** | 0 2px 4px rgba(0, 0, 0, 0.06) | `--shadow-sm` | Cards at rest |
| **MD** | 0 4px 8px rgba(0, 0, 0, 0.08) | `--shadow-md` | Hover states |
| **LG** | 0 8px 16px rgba(0, 0, 0, 0.1) | `--shadow-lg` | Elevated elements |
| **XL** | 0 16px 32px rgba(0, 0, 0, 0.12) | `--shadow-xl` | Modals, dropdowns |
| **Elevated** | Multi-layer | `--shadow-elevated` | Hero sections with glow |

### Dark Mode Shadows
Dark mode shadows automatically adjust with stronger opacity (0.3-0.5) and include subtle gold/green glows.

### Glow Effects
| Name | Value | CSS Variable | Usage |
|------|-------|--------------|-------|
| **Gold SM** | 0 0 8px rgba(228, 170, 79, 0.3) | `--glow-gold-sm` | Subtle gold glow |
| **Gold MD** | 0 0 16px rgba(228, 170, 79, 0.4) | `--glow-gold-md` | Medium gold glow |
| **Gold LG** | 0 0 32px rgba(228, 170, 79, 0.5) | `--glow-gold-lg` | Strong gold glow |
| **Gold XL** | 0 0 48px rgba(228, 170, 79, 0.6) | `--glow-gold-xl` | Maximum gold glow |
| **Green SM** | 0 0 8px rgba(102, 137, 113, 0.3) | `--glow-green-sm` | Subtle green glow |
| **Green MD** | 0 0 16px rgba(102, 137, 113, 0.4) | `--glow-green-md` | Medium green glow |
| **Green LG** | 0 0 32px rgba(102, 137, 113, 0.5) | `--glow-green-lg` | Strong green glow |

---

## 8. Animation System

### Timing Scale
| Name | Duration | CSS Variable | Usage |
|------|----------|--------------|-------|
| **Instant** | 0ms | `--duration-instant` | No animation |
| **Fast** | 150ms | `--duration-fast` | Micro-interactions |
| **Normal** | 300ms | `--duration-normal` | Standard transitions |
| **Slow** | 500ms | `--duration-slow` | Emphasized transitions |
| **Slower** | 800ms | `--duration-slower` | Complex animations |
| **Slowest** | 1200ms | `--duration-slowest` | Hero animations |

### Easing Functions
| Name | Bezier | CSS Variable | Feel |
|------|--------|--------------|------|
| **Spring** | cubic-bezier(0.34, 1.56, 0.64, 1) | `--ease-spring` | Bouncy, playful |
| **Out Expo** | cubic-bezier(0.16, 1, 0.3, 1) | `--ease-out-expo` | Smooth exit |
| **In-Out Expo** | cubic-bezier(0.87, 0, 0.13, 1) | `--ease-in-out-expo` | Dramatic |
| **Out** | cubic-bezier(0.33, 1, 0.68, 1) | `--ease-out` | Standard exit |
| **In-Out** | cubic-bezier(0.65, 0, 0.35, 1) | `--ease-in-out` | Standard both |
| **Bounce** | cubic-bezier(0.34, 1.56, 0.64, 1) | `--ease-bounce` | Satisfying clicks |

### Keyframe Animations
| Name | Keyframes | Usage |
|------|-----------|-------|
| **fadeInUp** | Opacity 0→1, translateY 10px→0 | Widget reveals |
| **fadeIn** | Opacity 0→1 | Simple fades |
| **spin** | Rotate 0→360deg | Loading spinners |
| **pulse** | Opacity 1→0.5→1 | Attention pulses |
| **popIn** | Scale + translateY | Widget reveals with bounce |
| **countUp** | translateY + opacity | Number reveals |
| **pulseGlow** | Box-shadow pulse | Attention on important elements |
| **float** | translateY subtle movement | Floating elements |
| **driftPattern** | Background-position | Slow pattern drift |

---

## 9. Component Sizing

### Touch Targets (WCAG Compliance)
| Element Type | Minimum Size | CSS |
|--------------|--------------|-----|
| **Buttons** | 44x44px | `min-height: 44px; min-width: 44px;` |
| **Links** | 44x44px | Touch area padding |
| **Form inputs** | 44px height | Input fields |
| **Checkboxes** | 44x44px | Touch area |
| **Radio buttons** | 44x44px | Touch area |

### Header Sizing
| Element | Size | CSS Variable |
|---------|------|--------------|
| **Header Height** | 52px | `--header-height` |
| **Mobile Header** | 52px | Same on mobile |

### Viewport Heights
| Name | Value | CSS Variable |
|------|-------|--------------|
| **App Height** | 100vh | `--app-height` |

---

## 10. Background Patterns

### Available Patterns
| Name | File | Format | Opacity (Light) | Opacity (Dark) | Animation |
|------|------|--------|-----------------|----------------|-----------|
| **Hemp Leaf Pattern** | `/src/assets/icons/hemp-leaf-pattern.svg` | SVG | 6% | 12% | Drift (60s) |
| **Hemp Fiber Texture** | `/src/assets/icons/hemp-fiber-texture-preview.svg` | SVG | 3% | 8% | Static |

### Pattern Implementation
```css
/* Light Mode Background Stack */
background: linear-gradient(135deg, #faf8f5 0%, #ffffff 100%);
background-image:
  radial-gradient(ellipse at 70% 20%, rgba(228, 170, 79, 0.03) 0%, transparent 50%),
  url('/src/assets/icons/hemp-leaf-pattern.svg');
background-size: 100%, 120px;
```

---

## 11. Utility Classes

### Spacing Utilities
```css
.mt-sm { margin-top: var(--space-sm); }
.mt-md { margin-top: var(--space-md); }
.mt-lg { margin-top: var(--space-lg); }
.mb-sm { margin-bottom: var(--space-sm); }
.mb-md { margin-bottom: var(--space-md); }
.mb-lg { margin-bottom: var(--space-lg); }
.p-sm { padding: var(--space-sm); }
.p-md { padding: var(--space-md); }
.p-lg { padding: var(--space-lg); }
```

### Text Utilities
```css
.text-center { text-align: center; }
.text-muted { color: var(--text-muted); }
.text-secondary { color: var(--text-secondary); }
```

### Display Utilities
```css
.hidden { display: none !important; }
.flex { display: flex; }
.flex-center { display: flex; align-items: center; justify-content: center; }
.flex-column { flex-direction: column; }
.gap-sm { gap: var(--space-sm); }
.gap-md { gap: var(--space-md); }
```

### Transition Utilities
```css
.transition-all { transition: all 0.3s ease; }
.transition-colors { transition: background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease; }
```

---

## 12. Mobile Responsiveness

### Breakpoints
| Name | Min Width | Usage |
|------|-----------|-------|
| **Mobile** | 0-767px | Default, mobile-first |
| **Tablet** | 768px+ | Medium screens |
| **Desktop** | 1200px+ | Large screens |

### Mobile Typography Enforcement
```css
@media (max-width: 768px) {
  body { font-size: 14px; }
  .text-xs, .text-sm { font-size: 12px !important; } /* WCAG minimum */
}
```

### Safe Area Insets (iOS Notch)
```css
padding-top: env(safe-area-inset-top);
padding-left: env(safe-area-inset-left);
padding-right: env(safe-area-inset-right);
padding-bottom: env(safe-area-inset-bottom);
```

---

## 13. Quick Reference Links

### Documentation
- **Full Design System**: `/docs/design/VISUAL_DESIGN_SYSTEM.md`
- **Master CSS Variables**: `/src/css/shared-base.css`
- **Icon Set**: `/docs/design/ICON_SET.md` (if exists)

### Asset Locations
- **Logos**: `/src/assets/`
- **Icons**: `/src/assets/icons/`
- **Fonts**: Google Fonts (external CDN)

### Implementation Files
- **Base Styles**: `/src/css/shared-base.css`
- **Page Styles**: `/src/css/[page-name].css`
- **Modules**: `/src/js/modules/`

---

## 14. Design Principles

### Color Distribution (Target)
- **Backgrounds**: 60% (cream/earth tones)
- **Surfaces**: 20% (white/dark cards)
- **Borders**: 10% (subtle green)
- **Gold Accents**: 8% (important numbers, highlights)
- **Bright Gold**: 2% (CTAs, critical elements)

### Visual Hierarchy
1. **Primary**: Gold numbers with glow (production metrics)
2. **Secondary**: Green elements (navigation, success states)
3. **Tertiary**: Muted text and borders
4. **Background**: Subtle patterns at 6-12% opacity

### Accessibility Standards
- **Contrast Ratio**: Minimum 4.5:1 for body text (WCAG AA)
- **Touch Targets**: Minimum 44x44px (WCAG AAA)
- **Font Size**: Minimum 12px on mobile, 14px on desktop
- **Focus Indicators**: Visible keyboard focus for all interactive elements

---

## 15. Usage Guidelines

### Do's ✅
- Use CSS variables for all colors and spacing
- Test both light and dark themes
- Verify 44px minimum touch targets on mobile
- Check contrast ratios for accessibility
- Use appropriate font families (Display for numbers, UI for text)
- Apply organic radius to featured elements for botanical feel

### Don'ts ❌
- Hard-code color values
- Use font sizes below 12px on mobile
- Mix symmetric and organic radii randomly
- Ignore dark mode implementation
- Skip mobile testing
- Bypass CSS variables with inline styles

---

**End of Design Assets Reference**
For implementation details, see `/docs/design/VISUAL_DESIGN_SYSTEM.md` and `/src/css/shared-base.css`
