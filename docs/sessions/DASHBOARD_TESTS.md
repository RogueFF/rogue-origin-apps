# Hybrid Dashboard Test Plan

## 1. Initial Load & Default State
- [ ] Dashboard loads without errors
- [ ] Only 3 default widgets visible:
  - [ ] Current Production card
  - [ ] Hourly Production Chart
  - [ ] Scoreboard Integration
- [ ] Light theme is default
- [ ] Sidebar is expanded by default
- [ ] No overlapping widgets
- [ ] Widgets arranged in clean grid

## 2. Theme System
- [ ] Theme toggle button visible in header (🌙/☀️)
- [ ] Click toggle - switches to dark theme
  - [ ] Background changes to dark
  - [ ] Text colors invert
  - [ ] Widget cards update styling
  - [ ] Hemp leaf pattern visible in background
- [ ] Click toggle again - switches back to light theme
- [ ] Theme persists after page reload

## 3. Sidebar Navigation
- [ ] Sidebar toggle button works
- [ ] Sidebar collapses to icon-only mode (68px)
- [ ] Main content expands to fill space
- [ ] Sidebar expands back to full width (240px)
- [ ] Navigation items clickable
- [ ] Active state shows on Dashboard

## 4. Settings Panel (⚙️ FAB)
- [ ] Settings FAB visible in bottom-right
- [ ] Click FAB - panel slides in from right
- [ ] Panel shows all widget checkboxes
- [ ] Default widgets are checked
- [ ] Other widgets are unchecked
- [ ] Theme toggle in settings works
- [ ] Close settings by clicking FAB again
- [ ] Close settings by clicking outside panel

## 5. Widget Visibility Controls
- [ ] Enable a hidden widget via checkbox
  - [ ] Widget appears in grid
  - [ ] Grid reflows to accommodate new widget
- [ ] Disable a visible widget via checkbox
  - [ ] Widget disappears
  - [ ] Grid reflows to fill gap
- [ ] Enable 3-4 more widgets
  - [ ] All widgets visible
  - [ ] No overlapping
  - [ ] Clean grid layout

## 6. Widget Resize (⤢ Button)
- [ ] Click resize on Current Production widget
  - [ ] Cycles through: medium → large → xl → full → small → medium
  - [ ] Grid reflows with each size change
  - [ ] Other widgets adjust positions
- [ ] Test resize on chart widget
  - [ ] Same size cycling behavior
  - [ ] Grid stays organized

## 7. Widget Collapse (− Button)
- [ ] Click collapse on any widget
  - [ ] Content hides
  - [ ] Header remains visible
  - [ ] Button changes to (+)
  - [ ] Grid reflows (widget height reduces)
- [ ] Click expand (+)
  - [ ] Content shows
  - [ ] Button changes back to (−)
  - [ ] Grid reflows

## 8. Widget Drag & Drop
- [ ] Hover over drag handle (⋮⋮)
  - [ ] Cursor changes to grab
  - [ ] Handle highlights
- [ ] Click and hold drag handle
  - [ ] Cursor changes to grabbing
  - [ ] Widget scales up (1.05x)
  - [ ] Shadow appears
  - [ ] Widget becomes semi-transparent
- [ ] Drag widget to new position
  - [ ] Other widgets move out of the way in real-time
  - [ ] Grid reflows smoothly
  - [ ] No jittering or chaos
- [ ] Release mouse
  - [ ] Widget snaps to grid position
  - [ ] Grid stabilizes
  - [ ] No double-click needed
- [ ] Drag multiple widgets
  - [ ] Each drag works consistently
  - [ ] Grid stays organized

## 9. Widget Hide (× Button)
- [ ] Click hide on any widget
  - [ ] Widget disappears
  - [ ] Grid reflows to fill space
  - [ ] Widget unchecked in settings
- [ ] Open settings panel
  - [ ] Hidden widget checkbox is unchecked
  - [ ] Re-enable widget
  - [ ] Widget reappears in grid

## 10. AI Chat Panel (🌿 FAB)
- [ ] AI Chat FAB visible in bottom-right
- [ ] Click FAB - panel slides in from right
- [ ] Welcome message visible
- [ ] Input field focused
- [ ] Settings panel closes if open (mutually exclusive)
- [ ] Type message and press Enter
  - [ ] User message appears
  - [ ] Typing indicator shows (3 dots)
  - [ ] (Note: May error if backend not connected - expected)
- [ ] Click FAB again - panel closes

## 11. Layout Persistence
- [ ] Arrange widgets in custom order
- [ ] Resize 2-3 widgets to different sizes
- [ ] Collapse 1 widget
- [ ] Hide 1 widget
- [ ] Switch to dark theme
- [ ] Refresh page (Ctrl+R)
  - [ ] Widget positions maintained
  - [ ] Widget sizes maintained
  - [ ] Collapsed state maintained
  - [ ] Hidden widgets stay hidden
  - [ ] Dark theme persists

## 12. Reset Layout
- [ ] Open settings panel
- [ ] Scroll to bottom
- [ ] Click "Reset to Default" button
  - [ ] Layout resets to default 3 widgets
  - [ ] Widget sizes reset
  - [ ] All collapsed states reset
  - [ ] Confirm this works

## 13. Responsive Design
- [ ] Resize browser to ~1400px width
  - [ ] Grid adjusts to fewer columns
  - [ ] Widgets resize proportionally
  - [ ] No horizontal scrolling
- [ ] Resize to ~1000px (tablet)
  - [ ] Grid becomes 2 columns
  - [ ] Widgets stack properly
- [ ] Resize to ~768px (mobile)
  - [ ] All widgets full width
  - [ ] Drag handles hidden
  - [ ] Settings/AI panels full width
  - [ ] Mobile menu button appears

## 14. Header Controls
- [ ] Clock updates in real-time
- [ ] Date displays correctly
- [ ] Refresh button visible
- [ ] Compare dropdown visible
- [ ] Date picker visible
- [ ] Mobile menu button works on small screens

## 15. Visual Polish
- [ ] Light theme:
  - [ ] Clean cream background
  - [ ] Professional appearance
  - [ ] Subtle shadows
- [ ] Dark theme:
  - [ ] Dark organic background
  - [ ] Hemp leaf pattern visible
  - [ ] Dramatic 4-layer shadows on widgets
  - [ ] Good contrast/readability
- [ ] Animations smooth:
  - [ ] Widget drag has spring easing
  - [ ] Theme transitions smooth
  - [ ] Panel slides smooth
  - [ ] FAB bounce on load

## 16. Browser Compatibility
- [ ] Test in Chrome/Edge
- [ ] Test in Firefox
- [ ] No console errors
- [ ] All features work

## 17. Performance
- [ ] With 10+ widgets enabled:
  - [ ] Drag remains smooth
  - [ ] No lag or stuttering
  - [ ] Grid reflows quickly
- [ ] Page loads in < 3 seconds

## Summary Checklist
- [ ] All features functional
- [ ] No overlapping widgets
- [ ] Grid stays organized when dragging
- [ ] Single-click drag works (no double-click)
- [ ] Layout persists across refreshes
- [ ] Both themes work perfectly
- [ ] Mobile responsive
- [ ] No console errors

---

**Test Environment:**
- Browser: Chrome/Edge
- Screen: 1920x1080
- File: `index.html`
- Date: 2026-01-03
