# Design Handoff: Opus → Sonnet Workflow

**Date**: January 4, 2026
**Project**: Rogue Origin Botanical Luxury Dashboard Redesign
**Workflow**: Opus for design planning → Sonnet 4.5 for implementation

---

## Handoff Protocol

### Phase 1: Design with Opus (Creative Planning)
**Model**: Claude Opus 4.5
**Role**: Creative director, design strategist

**Tasks**:
1. Refine the Botanical Luxury design direction
2. Create detailed component specifications
3. Design custom icon set (SVG specifications)
4. Define animation choreography
5. Create visual design system documentation
6. Specify typography scale and usage
7. Design asymmetric hero layout (exact measurements)
8. Chart styling specifications
9. Micro-interaction details
10. Mobile gesture patterns

**Output**: Detailed design specs that Sonnet can implement

---

### Phase 2: Execute with Sonnet 4.5 (Implementation)
**Model**: Claude Sonnet 4.5
**Role**: Developer, implementer

**Tasks**:
1. Implement HTML/CSS/JS from Opus specs
2. Integrate with existing Muuri.js system
3. Preserve all functionality (AI chat, widgets, navigation)
4. Test across devices
5. Optimize performance
6. Debug and refine

**Input**: Design specs from Opus
**Output**: Production-ready code

---

## Current Context (for Opus)

### Project Overview
- **Company**: Rogue Origin - Hemp processing in Southern Oregon
- **Current Dashboard**: Hybrid design with Muuri.js drag-drop, dual themes, AI chat
- **Tech Stack**: Vanilla HTML/CSS/JS, Chart.js, Muuri.js, Google Apps Script backend
- **Deployment**: GitHub Pages (static hosting)

### Design Direction (User Approved)
**Vision**: "Botanical Luxury" - upscale hemp aesthetic with smooth animations and sophisticated design

**Key Attributes**:
- Botanical elegance meets precision data
- Things "pop" without being over-the-top
- Smooth, sophisticated, memorable
- Mobile-first (boss uses phone daily)
- Quick data scanning (3 seconds to answer "How are we doing?")

**The One Unforgettable Thing**: Massive gold production number in botanical frame with atmospheric hemp patterns and luxury animations

### Design Requirements

**Revolutionary Changes (70%)**:
- ❌ Generic grid layout → Asymmetric botanical luxury
- ❌ Generic icons → Custom botanical icon set
- ❌ Safe typography → Bold hierarchy with DM Serif Display
- ❌ Even color distribution → 80/20 green/gold dominant strategy
- ❌ Basic animations → Smooth spring-based system
- ❌ Standard charts → Organic data visualization

**Must Preserve**:
- ✅ AI Chat agent (functional)
- ✅ Widget drag/organize/resize/hide (Muuri.js)
- ✅ Navigation to other web apps
- ✅ Rogue Origin colors (#668971 green, #e4aa4f gold)
- ✅ Rogue Origin logo
- ✅ Dual theme system (light/dark)
- ✅ Mobile responsiveness

### Current Files

**Main Dashboard**: `index.html` (4,500+ lines)
- Muuri.js integration for drag-drop widgets
- 25+ widgets (KPIs, charts, tables)
- AI chat panel with Claude integration
- Settings panel for widget visibility
- Dual theme system (light/dark)
- Spring animations with cubic-bezier(0.34, 1.56, 0.64, 1)

**Fonts**:
- DM Serif Display (display/numbers)
- JetBrains Mono (monospace data)
- Outfit (UI/body)

**Colors**:
- Primary Green: #668971
- Gold: #e4aa4f
- Gold Light: #f0cb60

**Current Audit**: `docs/BOTANICAL_LUXURY_AUDIT.md` (complete analysis)

---

## Questions for Opus to Answer

### 1. Hero Section Design
**Specification Needed**:
- Exact layout dimensions (desktop, tablet, mobile)
- Production number styling (size, weight, glow effects)
- Botanical frame design (SVG? CSS borders? Decorative elements?)
- Mini KPI card designs (shapes, shadows, spacing)
- How does it respond on mobile?

### 2. Custom Icon Set
**Specification Needed**:
- List of all icons needed (20+ icons for navigation, widgets, actions)
- SVG design style (stroke width, organic curves, level of detail)
- Icon sizes (16px, 24px, 32px variants?)
- Color variations (solid, outline, filled?)
- Hemp/botanical motifs for each icon

### 3. Typography Scale
**Specification Needed**:
- Complete type scale (h1, h2, h3, body, small, etc.)
- Font weights for each use case
- Line heights and letter spacing
- Responsive scaling rules
- Where to use each font family

### 4. Color System Refinement
**Specification Needed**:
- Exact 80/20 distribution strategy
- When to use gold vs green
- Hover state colors
- Focus state colors
- Error/success/warning states in botanical palette
- Chart color palette (5-10 colors)

### 5. Animation Choreography
**Specification Needed**:
- Page load sequence (exact timing, delays)
- Widget reveal pattern (stagger delays)
- Hover animations (scale, shadow, glow values)
- Transition durations for each interaction type
- Chart draw-in animations
- Theme toggle animation

### 6. Widget Card Design
**Specification Needed**:
- Border radius values (organic variation?)
- Shadow system (light mode vs dark mode)
- Botanical border decorations (corners? edges?)
- Hemp fiber texture overlay (opacity, blend mode)
- Hover and active states
- Collapsed state styling

### 7. Chart Styling
**Specification Needed**:
- Line chart curve tension and style
- Color gradients for each chart type
- Grid line styling (hemp fiber dashed?)
- Tooltip design (shape, shadow, animation)
- Data point hover effects
- Legend styling

### 8. Mobile Optimization
**Specification Needed**:
- Touch target sizes (buttons, cards)
- Swipe gesture patterns (which directions, what actions)
- Hero section mobile layout (how big is the number?)
- FAB positioning (AI chat, settings)
- Card stacking pattern
- Navigation behavior on mobile

### 9. Background Atmosphere
**Specification Needed**:
- Layer stack (exact order, opacities)
- Hemp pattern SVG design
- Gradient mesh values (colors, positions, blur)
- Texture overlays (hemp fiber, linen, noise)
- Dark mode vs light mode differences
- Animation parameters (drift speed, direction)

### 10. AI Chat Redesign
**Specification Needed**:
- Message bubble shapes (organic rounded corners?)
- Botanical border design
- Typing indicator (hemp seeds? what animation?)
- Input field styling (focus states, glow)
- Send button icon (hemp leaf design?)
- Panel slide animation

---

## Design Deliverables (for Opus to Create)

### Document 1: Visual Design System
**File**: `docs/design/VISUAL_DESIGN_SYSTEM.md`

**Contents**:
- Complete color palette with usage rules
- Typography scale with examples
- Spacing system (8px grid? custom?)
- Border radius scale
- Shadow system (elevation levels)
- Animation timing scale

### Document 2: Component Specifications
**File**: `docs/design/COMPONENT_SPECS.md`

**Contents**:
- Hero section (layout, measurements, responsive)
- Widget cards (all variants)
- KPI displays
- Charts (all types)
- Buttons (all states)
- Inputs and forms
- Navigation elements
- Panels (AI chat, settings)

### Document 3: Icon Set Design
**File**: `docs/design/ICON_SET.md`

**Contents**:
- List of all 20+ icons needed
- SVG specifications for each
- Design principles (stroke, curves, detail level)
- Usage guidelines

### Document 4: Animation Choreography
**File**: `docs/design/ANIMATION_SYSTEM.md`

**Contents**:
- Page load sequence (exact timing)
- Interaction animations (hover, click, focus)
- Transition timings
- Easing functions
- Performance guidelines

### Document 5: Mobile Specifications
**File**: `docs/design/MOBILE_DESIGN.md`

**Contents**:
- Breakpoints and responsive rules
- Touch gesture patterns
- Mobile-specific layouts
- FAB positioning and behavior
- Swipe interactions

---

## Implementation Checklist (for Sonnet)

When Sonnet receives the design specs from Opus:

### Phase 1: Setup
- [ ] Create new development branch
- [ ] Backup current index.html to archive
- [ ] Set up CSS variable system from design specs
- [ ] Implement typography scale

### Phase 2: Hero Section
- [ ] Build asymmetric hero layout (HTML structure)
- [ ] Style production number display
- [ ] Create botanical frame elements
- [ ] Add mini KPI cards
- [ ] Implement responsive behavior

### Phase 3: Custom Icons
- [ ] Create SVG icon components
- [ ] Replace Phosphor icons throughout
- [ ] Test icon rendering across browsers

### Phase 4: Widget Cards
- [ ] Redesign card styling
- [ ] Add botanical border elements
- [ ] Implement new hover states
- [ ] Test Muuri.js compatibility

### Phase 5: Charts
- [ ] Restyle Chart.js instances
- [ ] Apply organic gradients and curves
- [ ] Update tooltips and legends
- [ ] Test all chart types

### Phase 6: Animations
- [ ] Implement page load sequence
- [ ] Add widget reveal stagger
- [ ] Refine hover/click interactions
- [ ] Add theme toggle animation

### Phase 7: Backgrounds
- [ ] Create layered background system
- [ ] Add hemp patterns and textures
- [ ] Implement gradient meshes
- [ ] Test performance

### Phase 8: AI Chat
- [ ] Redesign message bubbles
- [ ] Update typing indicator
- [ ] Style input and send button
- [ ] Animate panel transitions

### Phase 9: Mobile
- [ ] Implement mobile-specific layouts
- [ ] Add swipe gestures
- [ ] Optimize touch targets
- [ ] Test on actual devices

### Phase 10: Polish
- [ ] Cross-browser testing
- [ ] Performance optimization
- [ ] Accessibility audit
- [ ] Final refinements

---

## How to Switch Models

### Start with Opus (Design Phase)
```bash
# Exit current session
exit

# Start new session with Opus
claude --model opus

# Then say:
"I'm working on the Rogue Origin dashboard redesign. Please read:
1. docs/BOTANICAL_LUXURY_AUDIT.md
2. docs/DESIGN_HANDOFF.md
3. index.html (current state)

Create detailed design specifications for the Botanical Luxury redesign based on the questions in DESIGN_HANDOFF.md."
```

### Switch to Sonnet (Implementation Phase)
```bash
# Exit Opus session
exit

# Start new session with Sonnet 4.5 (default)
claude

# Then say:
"I have design specs from Opus for the Botanical Luxury dashboard redesign. Please read:
1. docs/design/*.md (all design specs)
2. index.html (current dashboard)

Implement the design specifications while preserving all functionality (AI chat, Muuri.js widgets, navigation)."
```

---

## Success Criteria

**Design Phase (Opus)**:
- [ ] All 10 questions answered with exact specifications
- [ ] 5 design documents created with implementation details
- [ ] Custom icon set fully specified (SVG code or detailed descriptions)
- [ ] No ambiguity - Sonnet can implement without creative decisions

**Implementation Phase (Sonnet)**:
- [ ] All design specs implemented accurately
- [ ] All existing functionality preserved
- [ ] 60fps animations, no performance issues
- [ ] Mobile-optimized for boss's daily use
- [ ] Cross-browser compatible
- [ ] Production-ready code

---

## Notes for Opus

**Your Role**: You are the creative director and design strategist. Be bold, specific, and visionary.

**Output Format**: Create markdown files with exact specifications. Include:
- Precise measurements (px, rem, %)
- Exact colors (hex codes)
- Specific font sizes and weights
- Animation timings in milliseconds
- SVG code or detailed descriptions
- CSS snippets where helpful

**Think Like**: A senior design director handing off to a skilled developer who will implement exactly what you specify.

**Remember**: This dashboard is the boss's daily tool on mobile. Every decision should serve quick data scanning while creating an unforgettable botanical luxury experience.

---

## Notes for Sonnet

**Your Role**: You are the implementer. Follow Opus's design specs precisely.

**If Unclear**: Ask clarifying questions, but try to infer reasonable defaults when minor details are missing.

**Preserve**: All existing functionality is sacred. The redesign is visual/UX only, not functional changes.

**Test**: After each major change, verify:
- Muuri.js widgets still drag/resize/hide
- AI chat still works
- Theme toggle still works
- Mobile layout is responsive

**Optimize**: Keep animations at 60fps. Use CSS-only where possible.

---

## Current Status

- [x] Git repository initialized
- [x] Project organized and documented
- [x] Initial audit complete (BOTANICAL_LUXURY_AUDIT.md)
- [x] Handoff document created (this file)
- [ ] **NEXT**: Opus creates detailed design specifications
- [ ] **THEN**: Sonnet implements specifications

---

**Ready for Opus to begin design work!** 🎨
