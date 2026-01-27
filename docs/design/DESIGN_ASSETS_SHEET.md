# Rogue Origin Design Assets - Google Sheets Format

**Instructions**: Copy each section below into separate tabs in Google Sheets

---

## TAB 1: Brand Colors

| Color Name | Hex Code | CSS Variable | RGB | Usage |
|------------|----------|--------------|-----|-------|
| Rogue Green | #668971 | --ro-green | rgb(102, 137, 113) | Primary brand, success, CTAs |
| Rogue Gold | #e4aa4f | --ro-gold | rgb(228, 170, 79) | Accent, highlights, important numbers |
| Gold Light | #f0cb60 | --gold-light | rgb(240, 203, 96) | Bright accent |
| Green Dark | #4a6b54 | --green-dark | rgb(74, 107, 84) | Hover states |
| Success | #668971 | --success | rgb(102, 137, 113) | Success messages |
| Warning | #e4aa4f | --warning | rgb(228, 170, 79) | Warning messages |
| Danger | #c45c4a | --danger | rgb(196, 92, 74) | Error messages |
| Info | #62758d | --info | rgb(98, 117, 141) | Info messages |
| Sungrown | #bf8e4e | --sungrown | rgb(191, 142, 78) | Sungrown product badges |
| Greenhouse | #8f9263 | --greenhouse | rgb(143, 146, 99) | Greenhouse product badges |
| Indoor | #62758d | --indoor | rgb(98, 117, 141) | Indoor product badges |

---

## TAB 2: Light Theme Colors

| Element | Hex Code | CSS Variable | Notes |
|---------|----------|--------------|-------|
| Background | #faf8f5 | --bg | Parchment cream |
| Background Warm | #f3efe7 | --bg-warm | Warmer variant |
| Card Background | #ffffff | --bg-card | White cards |
| Header Background | #2d3a2e | --bg-dark | Dark header |
| Primary Text | #2d3a32 | --text | Main text color |
| Secondary Text | #5a6b5f | --text-secondary | Less important text |
| Muted Text | #8a9a8e | --text-muted | Very subtle text |
| Light Text | #94a397 | --text-light | Lightest text |
| Border | rgba(102, 137, 113, 0.2) | --border | Standard borders |
| Border Light | rgba(102, 137, 113, 0.1) | --border-light | Subtle borders |
| Glass | rgba(255, 255, 255, 0.6) | --glass | Frosted glass effect |

---

## TAB 3: Dark Theme Colors

| Element | Hex Code | CSS Variable | Notes |
|---------|----------|--------------|-------|
| Background | #1a1a1a | --bg | Deep black |
| Background Warm | #22291e | --bg-warm | Warm earth tone |
| Card Background | #2d2d2d | --bg-card | Card surfaces |
| Darkest Background | #12160f | --bg-dark | Darkest areas |
| Primary Text | #e0e0e0 | --text | Main text |
| Secondary Text | #b8b8b8 | --text-secondary | Less important |
| Muted Text | #888888 | --text-muted | Subtle text |
| Light Text | #6b7a6f | --text-light | Accent text |
| Border | rgba(255, 255, 255, 0.2) | --border | Standard borders |
| Border Light | rgba(255, 255, 255, 0.1) | --border-light | Subtle borders |
| Glass | rgba(45, 45, 45, 0.6) | --glass | Frosted glass |

---

## TAB 4: Typography

| Element | Font Family | Size | Weight | CSS Variable | Usage |
|---------|-------------|------|--------|--------------|-------|
| Hero Number | DM Serif Display | 96px | 400 | --text-hero | Daily production |
| Hero Mobile | DM Serif Display | 64px | 400 | --text-hero-mobile | Mobile hero |
| Large KPI | DM Serif Display | 48px | 400 | --text-display | Big metrics |
| Medium KPI | DM Serif Display | 36px | 400 | --text-display-sm | Medium metrics |
| Page Title | Outfit | 28px | 600 | --text-h1 | Main headings |
| Section Header | Outfit | 22px | 600 | --text-h2 | Section titles |
| Card Title | Outfit | 18px | 600 | --text-h3 | Card headers |
| Subsection | Outfit | 16px | 600 | --text-h4 | Small headers |
| Body Text | Outfit | 14px | 400 | --text-body | Paragraphs |
| Small Text | Outfit | 13px | 400 | --text-sm | Secondary info |
| Label | Outfit | 11px | 500 | --text-xs | Labels |
| Tiny Label | Outfit | 10px | 500 | --text-xxs | Smallest text |
| Data Value | JetBrains Mono | 14px | 500 | --text-mono-md | Tables, numbers |
| Timestamp | JetBrains Mono | 12px | 400 | --text-mono-sm | Time/date |

---

## TAB 5: Spacing (8px Grid)

| Name | Size | CSS Variable | Common Usage |
|------|------|--------------|--------------|
| XS | 4px | --space-1 | Tight spacing |
| SM | 8px | --space-2, --space-xs | Icon gaps |
| Between | 12px | --space-3 | Related items |
| MD | 16px | --space-4, --space-sm | Button padding |
| Comfortable | 20px | --space-5 | Card padding |
| LG | 24px | --space-6, --space-md | Section padding |
| Large Gap | 32px | --space-7 | Between sections |
| Section | 40px | --space-8, --space-lg | Major breaks |
| Major | 48px | --space-9 | Page sections |
| XL | 64px | --space-10, --space-xl | Hero spacing |
| Hero | 80px | --space-11 | Extra large |
| Max | 96px | --space-12 | Maximum |

---

## TAB 6: Border Radius

| Name | Size | CSS Variable | Usage |
|------|------|--------------|-------|
| XS | 4px | --radius-xs | Chips, badges |
| SM | 8px | --radius-sm | Buttons, inputs |
| MD | 12px | --radius-md | Small cards |
| LG | 16px | --radius-lg | Cards, panels |
| XL | 20px | --radius-xl | Large cards |
| 2XL | 24px | --radius-2xl | Hero sections |
| Full | 9999px | --radius-full | Pills, avatars |
| Organic SM | 8px 12px 10px 14px | --radius-organic-sm | Botanical feel |
| Organic MD | 12px 16px 14px 18px | --radius-organic-md | Featured cards |
| Organic LG | 16px 20px 18px 22px | --radius-organic-lg | Special elements |

---

## TAB 7: Shadows

| Name | CSS Variable | Light Mode | Dark Mode |
|------|--------------|------------|-----------|
| XS | --shadow-xs | 0 1px 2px rgba(0,0,0,0.04) | Stronger |
| SM | --shadow-sm | 0 2px 4px rgba(0,0,0,0.06) | Stronger |
| MD | --shadow-md | 0 4px 8px rgba(0,0,0,0.08) | Stronger |
| LG | --shadow-lg | 0 8px 16px rgba(0,0,0,0.1) | Stronger |
| XL | --shadow-xl | 0 16px 32px rgba(0,0,0,0.12) | Stronger |
| Gold Glow SM | --glow-gold-sm | 0 0 8px rgba(228,170,79,0.3) | Same |
| Gold Glow MD | --glow-gold-md | 0 0 16px rgba(228,170,79,0.4) | Same |
| Gold Glow LG | --glow-gold-lg | 0 0 32px rgba(228,170,79,0.5) | Same |
| Green Glow SM | --glow-green-sm | 0 0 8px rgba(102,137,113,0.3) | Same |
| Green Glow MD | --glow-green-md | 0 0 16px rgba(102,137,113,0.4) | Same |

---

## TAB 8: Animation Timing

| Name | Duration | CSS Variable | Usage |
|------|----------|--------------|-------|
| Instant | 0ms | --duration-instant | No animation |
| Fast | 150ms | --duration-fast | Quick interactions |
| Normal | 300ms | --duration-normal | Standard |
| Slow | 500ms | --duration-slow | Emphasized |
| Slower | 800ms | --duration-slower | Complex |
| Slowest | 1200ms | --duration-slowest | Hero reveals |

---

## TAB 9: Easing Functions

| Name | Bezier Curve | CSS Variable | Feel |
|------|--------------|--------------|------|
| Spring | cubic-bezier(0.34, 1.56, 0.64, 1) | --ease-spring | Bouncy |
| Out Expo | cubic-bezier(0.16, 1, 0.3, 1) | --ease-out-expo | Smooth |
| Out | cubic-bezier(0.33, 1, 0.68, 1) | --ease-out | Standard |
| Bounce | cubic-bezier(0.34, 1.56, 0.64, 1) | --ease-bounce | Satisfying |

---

## TAB 10: Assets & Files

| Asset Type | File Name | Location | Format | Usage |
|------------|-----------|----------|--------|-------|
| Square Logo | ro-logo-square.png | /src/assets/ | PNG 512x512 | App icons, favicons |
| Horizontal Logo | ro-logo-horizontal.png | /src/assets/ | PNG | Headers, signatures |
| Hemp Leaf Pattern | hemp-leaf-pattern.svg | /src/assets/icons/ | SVG | Background pattern |
| Hemp Fiber Texture | hemp-fiber-texture-preview.svg | /src/assets/icons/ | SVG | Background texture |
| Pattern Preview | ro-pattern-preview.svg | /src/assets/icons/ | SVG | Design mockups |

---

## TAB 11: Mobile Rules

| Rule | Value | Notes |
|------|-------|-------|
| Minimum Touch Target | 44x44px | WCAG AAA standard |
| Minimum Font Size | 12px | On mobile devices |
| Body Font Size | 14px | Mobile default |
| Mobile Breakpoint | 768px | Below = mobile |
| Tablet Breakpoint | 768px | Above = tablet |
| Desktop Breakpoint | 1200px | Above = desktop |
| Header Height | 52px | Same on all devices |

---

## TAB 12: Accessibility

| Standard | Requirement | Value |
|----------|-------------|-------|
| Text Contrast | WCAG AA | Minimum 4.5:1 |
| Touch Target | WCAG AAA | Minimum 44x44px |
| Font Size Minimum | WCAG AA | 12px mobile, 14px desktop |
| Focus Indicators | WCAG AA | Visible on all interactive |
| Color Alone | WCAG AA | Never use color only |

---

## TAB 13: Component Examples

| Component | Padding | Border Radius | Shadow | Font |
|-----------|---------|---------------|--------|------|
| Button | 8px 16px | 8px (--radius-sm) | --shadow-sm | Outfit 600 |
| Input | 12px 16px | 8px | --shadow-xs | Outfit 400 |
| Card | 20px | 16px (--radius-lg) | --shadow-sm | Outfit 400 |
| KPI Card | 16px | 12px | --shadow-md | DM Serif Display |
| Modal | 24px | 20px | --shadow-xl | Outfit 400 |
| Badge | 4px 12px | 9999px (pill) | None | Outfit 500 |
| Chip | 6px 12px | 8px | --shadow-xs | Outfit 500 |

---

## TAB 14: Usage Guidelines

| Do | Don't |
|----|-------|
| Use CSS variables for colors | Hard-code hex values |
| Test both light and dark themes | Only test one theme |
| Check 44px touch targets on mobile | Ignore mobile testing |
| Use --font-display for big numbers | Use display font for body text |
| Use --font-mono for data tables | Use mono font everywhere |
| Apply --radius-organic to featured items | Mix organic and standard randomly |
| Check contrast ratios | Assume colors are accessible |
| Use 8px grid spacing | Use random spacing values |

---

## TAB 15: Quick Reference

| What | Value/Location |
|------|----------------|
| Master CSS File | /src/css/shared-base.css |
| Full Design Doc | /docs/design/VISUAL_DESIGN_SYSTEM.md |
| Assets Folder | /src/assets/ |
| Icons Folder | /src/assets/icons/ |
| Primary Brand Green | #668971 |
| Primary Brand Gold | #e4aa4f |
| Light Background | #faf8f5 |
| Dark Background | #1a1a1a |
| Display Font | DM Serif Display |
| UI Font | Outfit |
| Mono Font | JetBrains Mono |
| Base Spacing Unit | 8px |
| Min Touch Target | 44px |
| Min Font Size Mobile | 12px |

---

## HOW TO IMPORT TO GOOGLE SHEETS

**Method 1: Copy-Paste**
1. Select a section (including headers)
2. Copy (Ctrl+C)
3. Paste into new Google Sheet tab (Ctrl+V)
4. Format as table

**Method 2: CSV Import**
1. Copy section to text editor
2. Replace | with commas
3. Save as .csv
4. Import to Google Sheets

**Recommended Tab Names:**
1. Brand Colors
2. Light Theme
3. Dark Theme
4. Typography
5. Spacing
6. Borders & Radius
7. Shadows & Glows
8. Animation
9. Easing
10. Assets
11. Mobile Rules
12. Accessibility
13. Components
14. Guidelines
15. Quick Ref

---

**Share this sheet with helpers for easy reference during development and design work!**
