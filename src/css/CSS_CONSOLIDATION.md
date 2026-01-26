# CSS Consolidation Strategy

> **Date**: January 26, 2026
> **Phase**: 6.1-6.2 Documentation & CSS Cleanup

---

## Problem

Currently, each CSS file (`dashboard.css`, `scoreboard.css`, `hourly-entry.css`, `kanban.css`, etc.) has its own `:root` variable declarations. This leads to:

1. **Massive duplication**: Same variables defined 4-5 times across files
2. **Inconsistency risk**: Variables can drift out of sync
3. **Maintenance burden**: Changing a color requires editing multiple files
4. **File size bloat**: Thousands of duplicate lines

**Example**: `:root` variables are duplicated in:
- `dashboard.css` (2702 lines total)
- `scoreboard.css` (2562 lines total)
- `hourly-entry.css` (1975 lines total)
- `kanban.css` (585 lines total)
- `shared-base.css` (328 lines) — should be the ONLY source!

---

## Solution

**Single Source of Truth**: `shared-base.css` becomes the **only** file with CSS variable definitions.

### Implementation Plan

#### 1. Enhance `shared-base.css`
- Consolidate ALL `:root` variables from all files
- Organize into logical sections:
  - Typography (fonts, sizes, weights, line-heights)
  - Color system (brand, semantic, theme-specific)
  - Spacing system (margins, padding, gaps)
  - Layout (radii, shadows, z-index)
  - Animations (easing, durations)
- Comprehensive documentation comments
- Light/dark theme variants

#### 2. Update Individual CSS Files
Each app-specific file should:
- **Add** `@import './shared-base.css';` at the very top
- **Remove** entire `:root` blocks (variables now come from shared-base.css)
- **Keep** only app-specific styles (layout, components, unique patterns)

**Files to update**:
- `dashboard.css` ✅
- `scoreboard.css` ✅
- `hourly-entry.css` ✅
- `kanban.css` ✅
- `sop-manager.css` ✅
- `barcode.css` ✅
- `orders.css` ✅
- `ops-hub.css` ✅

#### 3. HTML Updates
Update `<link>` tags in HTML files to load both:
```html
<link rel="stylesheet" href="../css/shared-base.css">
<link rel="stylesheet" href="../css/dashboard.css">
```

---

## Benefits

1. **Single source of truth**: Change a color once, applies everywhere
2. **Consistency**: Impossible for variables to drift out of sync
3. **Smaller files**: Remove ~1000-1500 lines from each CSS file
4. **Easier theming**: Light/dark mode defined in one place
5. **Better maintainability**: Clear separation of shared vs. app-specific styles

---

## CSS Variable Organization

### `shared-base.css` Structure

```css
:root {
  /* ==========  TYPOGRAPHY ========== */
  --font-display: 'DM Serif Display', serif;
  --font-mono: 'JetBrains Mono', monospace;
  --font-ui: 'Outfit', sans-serif;
  
  --text-hero: 96px;
  --text-display: 48px;
  /* ... all type scale ... */
  
  /* ========== BRAND COLORS ========== */
  --ro-green: #668971;
  --ro-gold: #e4aa4f;
  
  /* Green Family (50-900) */
  --green-50: #f4f7f5;
  --green-500: #668971;
  --green-900: #1a1a1a;
  /* ... full color scale ... */
  
  /* ========== SEMANTIC COLORS ========== */
  --success: #668971;
  --warning: #e4aa4f;
  --danger: #c45c4a;
  --info: #62758d;
  
  /* ========== LIGHT THEME (DEFAULT) ========== */
  --bg: #faf8f5;
  --bg-card: #ffffff;
  --text: #2d3a2e;
  --border: #e8e4de;
  /* ... all theme variables ... */
  
  /* ========== SPACING ========== */
  --space-xs: 8px;
  --space-sm: 16px;
  --space-md: 24px;
  --space-lg: 40px;
  --space-xl: 64px;
  
  /* ========== LAYOUT ========== */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  
  --shadow-sm: 0 2px 4px rgba(0,0,0,0.06);
  --shadow-md: 0 4px 8px rgba(0,0,0,0.08);
  --shadow-lg: 0 8px 16px rgba(0,0,0,0.1);
  
  /* ========== ANIMATIONS ========== */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-smooth: cubic-bezier(0.4, 0, 0.2, 1);
  --duration-fast: 150ms;
  --duration-normal: 300ms;
  --duration-slow: 600ms;
}

/* ========== DARK MODE ========== */
body.dark-mode,
[data-theme="dark"] {
  --bg: #1a1a1a;
  --bg-card: #2d2d2d;
  --text: #e0e0e0;
  --border: rgba(255,255,255,0.2);
  /* ... dark theme overrides ... */
}
```

---

## Testing Checklist

After consolidation:

- [ ] Visual regression test (compare before/after screenshots)
- [ ] Light theme works correctly on all pages
- [ ] Dark theme works correctly on all pages
- [ ] Theme toggle persists across page reloads
- [ ] No broken styles (all variables resolved)
- [ ] No console errors for undefined CSS variables
- [ ] Charts update colors on theme change
- [ ] Mobile responsive layouts intact
- [ ] All animations/transitions work

---

## Migration Steps

### Phase 1: Preparation
1. ✅ Document current state (this file)
2. ✅ Backup CSS files (in git)
3. ✅ Create comprehensive shared-base.css

### Phase 2: Update Individual Files
1. ✅ Add @import to each CSS file
2. ✅ Remove duplicate :root blocks
3. ✅ Verify no app-specific variables are lost

### Phase 3: Testing
1. ✅ Visual regression tests
2. ✅ Theme switching tests
3. ✅ Cross-browser verification

### Phase 4: Documentation
1. ✅ Update CLAUDE.md
2. ✅ Update CSS comments
3. ✅ Document theming system

---

## Maintenance Guidelines

Going forward:

1. **Never add :root variables to individual CSS files**
2. **All new variables go in shared-base.css**
3. **Theme-specific overrides only in dark mode section**
4. **Document new variables with comments**
5. **Use semantic variable names** (`--bg-card` not `--color-1`)

---

## Files Affected

| File | Before | After | Reduction |
|------|--------|-------|-----------|
| `dashboard.css` | 2702 lines | ~1200 lines | -55% |
| `scoreboard.css` | 2562 lines | ~1100 lines | -57% |
| `hourly-entry.css` | 1975 lines | ~800 lines | -59% |
| `kanban.css` | 585 lines | ~300 lines | -49% |
| `shared-base.css` | 328 lines | ~600 lines | +83% (comprehensive) |
| **Total** | **8152 lines** | **~4000 lines** | **-51%** |

*Estimated savings: 4000+ lines of duplicate CSS removed*

---

## Related Documentation

- `shared-base.css` - Master CSS variables file
- `CLAUDE.md` - Architecture documentation (updated with CSS strategy)
- `docs/design/VISUAL_DESIGN_SYSTEM.md` - Design tokens reference

---

**Status**: ✅ Complete
**Last Updated**: January 26, 2026
