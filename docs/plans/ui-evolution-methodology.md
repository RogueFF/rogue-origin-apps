# UI Evolution Methodology — Rogue Origin Apps

## The Process

### Phase 1: Foundation (Passes 1-2)
**Goal:** Establish the design language and layout hierarchy.

1. **Read everything** — HTML, CSS, JS, understand data flow and user actions
2. **Identify what matters most** — What does the user look at first? What do they click most? Put that at the top.
3. **Establish the palette** — Design tokens, fonts, spacing grid. No inline styles. Everything through CSS custom properties.
4. **Layout restructure** — Reorder sections by usage priority, not by how they were originally built
5. **Typography identity** — DM Serif Display italic for headings, JetBrains Mono for data, Outfit for UI. Editorial section numbering ("01 / Section Name")
6. **Background texture** — Subtle topographic contour lines (SVG data URI). Whisper-level opacity.

**Anti-patterns to kill immediately:**
- Colored left-edge accent cards (the "Claude Look")
- Pill-shaped buttons
- Material Design shadows
- Purple/blue gradients
- Inter/Roboto fonts
- Generic "card with icon + title + description" layouts

### Phase 2: Polish & Theming (Passes 3-4)
**Goal:** Light mode, accessibility, visual refinement.

1. **Light mode** — Full theme support via `data-theme` attribute. Warm #faf8f5 base, white cards, dark text.
2. **Custom icons** — No system emojis. SVG icons that match the aesthetic.
3. **Skip links & focus states** — Keyboard navigation, screen reader support
4. **Theme toggle** — Custom SVG sun/moon icons, localStorage persistence
5. **Color coding** — Data-driven colors (green=good, gold=warning, red=danger) applied consistently
6. **Micro-refinements** — Border widths, opacity tuning, spacing consistency on 8px grid

### Phase 3: Creative Differentiation (Passes 5-6)
**Goal:** Make it look like nothing else. Think outside the box.

1. **Asymmetric layouts** — Break the grid. Dominant elements get more space. Visual hierarchy by data importance, not uniformity.
2. **Data visualization inline** — Inventory bars, fill indicators, proportional sizing. Information at a glance without reading numbers.
3. **Editorial typography** — Section numbers with slash separators, italic display font, uppercase mono dates with letter-spacing
4. **Micro-interactions** — Hover animations (spring cubic-bezier), click feedback (scale 0.98), staggered entrance animations
5. **3D depth** — Subtle perspective tilt on hover for physical feel
6. **Bottom-border accents** — Color-coded by action type, thinner and more refined than left-edge bars

### Phase 4: UX & Features (Passes 7-8)
**Goal:** Make it fast to use, not just good to look at.

1. **Command palette** — Press `/` to open. Natural language commands: `intake pedro 10 tops lifter 100`. Keyboard-first power user mode.
2. **Contextual data on cards** — Strain breakdowns, type indicators (tops/smalls), last activity dates. No clicking required to get basic info.
3. **Login screen** — Matches the app aesthetic. Topo background, editorial typography, centered dramatic elements.
4. **Modal redesign** — Color-coded headers per action type, mono uppercase form labels, italic headings
5. **Detail panel** — Italic headings, refined stat cards, visual bars for stock vs owed
6. **Empty states** — Helpful CTAs instead of dead "0" displays

### Phase 5: Hardening (Passes 9-10+)
**Goal:** Bulletproof it. Every edge case, every screen size.

1. **Mobile testing** — Every breakpoint (640px, 900px). Stack layouts, hide non-essential elements, ensure touch targets are 44px+
2. **Loading states** — Skeleton screens for async data. No layout shift.
3. **Error handling** — Toast notifications, graceful degradation, retry logic
4. **Performance** — Lazy load what's below the fold. Cache API responses. Debounce renders.
5. **Accessibility audit** — Tab order, ARIA labels, color contrast ratios (4.5:1 minimum)
6. **Cross-browser** — Test in Chrome, Firefox, Safari. CSS fallbacks for unsupported features.

## Design Principles

- **Inventory-first, balance-second** — Show what you HAVE before what you OWE
- **Actions at the top** — The things you click most get hero position
- **Data density over whitespace** — More information per pixel. No padding tourism.
- **The 8px grid** — All spacing in multiples of 8. No exceptions.
- **Transitions: 0.15s ease** — Fast enough to feel instant, slow enough to feel smooth
- **Border-radius: 8px cards, 6px inputs, 0 for nothing else**
- **Colors tell stories** — Green (#668971) = intake/positive, Gold (#e4aa4f) = inventory/warning, Blue (#62758d) = payment/info, Red = danger

## Atlas as Design Lead

The AI coding agent (Claude Code) does the implementation. Atlas provides:
- **Pixel-level specs** — Exact sizes, colors, spacing, font weights
- **Anti-pattern enforcement** — Reviews output for AI slop before pushing
- **Creative direction** — Layout decisions, feature ideas, interaction design
- **Quality gate** — Screenshots every pass, identifies issues, iterates until satisfied
- **UX thinking** — Not just "does it look good" but "is it fast to use"

## Tools

- **Claude Code CLI** (`claude --dangerously-skip-permissions`) for implementation
- **Puppeteer** for automated screenshots (dark + light mode)
- **Local dev server** for preview before push
- **Git push** to GitHub Pages for live deployment
- **Cache busting** via `?v=N` query params on CSS/JS links

## The Rule

If it looks like every other AI-generated dashboard, it's wrong. Start over.
