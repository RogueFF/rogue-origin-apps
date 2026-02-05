# Scoreboard Declutter Testing Session

**Date:** 2026-02-04
**Implementation:** Complete
**Status:** Testing & Validation

---

## Testing Checklist

### TV Mode (≥1920px)

**Visual:**
- [ ] Production numbers readable from 10+ feet (120-140px)
- [ ] Pure black backgrounds (#000000) for OLED
- [ ] High contrast status colors (green/yellow/red)
- [ ] Timer rings 280px diameter
- [ ] FAB button auto-fades to 20% after 10s idle
- [ ] EN/ES toggle minimal size but still clickable

**Functionality:**
- [ ] FAB menu opens smoothly
- [ ] All menu items accessible
- [ ] No scrolling required
- [ ] Fits in 1080p viewport (1920×1080)
- [ ] Fits in 4K viewport (3840×2160)

**Interaction:**
- [ ] FAB button visible and clickable (even at 20% opacity)
- [ ] Menu items have good hit targets
- [ ] Smooth animations don't lag

---

### Desktop Mode (768px - 1919px)

**Visual:**
- [ ] Medium font sizes (64-80px production numbers)
- [ ] Balanced spacing and layout
- [ ] Comparison pills visible and readable
- [ ] Info bar fits comfortably

**Functionality:**
- [ ] No scrolling at 768px height
- [ ] No scrolling at 1024px width
- [ ] FAB menu standard size (56px)
- [ ] Chart toggle works
- [ ] Order queue toggle works

**Interaction:**
- [ ] All controls easy to click
- [ ] Menu items have good hover states
- [ ] Keyboard navigation works

---

### Mobile Mode (<768px)

**Visual:**
- [ ] Stacked vertical layout
- [ ] Timer panel below scoreboard
- [ ] Readable font sizes (48-64px)
- [ ] Touch targets ≥48px

**Functionality:**
- [ ] FAB menu full-width from bottom
- [ ] May scroll, but critical info above fold
- [ ] Chart hidden by default
- [ ] Order queue hidden by default

**Interaction:**
- [ ] FAB button easy to tap (56px, bottom-right)
- [ ] Menu items easy to tap (48px height)
- [ ] Swipe-friendly (no conflicts)
- [ ] Backdrop closes menu on tap

---

### Feature Parity

**All Devices:**
- [ ] EN/ES toggle always visible and working
- [ ] FAB menu opens/closes correctly
- [ ] Start Day button appears until shift start set
- [ ] Start Day button auto-hides after shift start
- [ ] Past Data opens date picker
- [ ] Complaints opens Google Sheet (new tab)
- [ ] Morning Report works
- [ ] Order Queue toggle ON/OFF works
- [ ] Hourly Chart toggle ON/OFF works
- [ ] Help modal opens

---

### Performance

- [ ] Page loads without layout shift
- [ ] FAB menu opens in <300ms
- [ ] Smooth 60fps animations
- [ ] No console errors
- [ ] No memory leaks (FAB timers cleaned up)

---

### Accessibility

- [ ] FAB button has aria-label
- [ ] FAB button aria-expanded toggles
- [ ] Menu items have role="menuitem"
- [ ] Keyboard navigation works (Tab, Enter, Arrows, Escape)
- [ ] Focus indicators visible
- [ ] Screen reader announces menu state
- [ ] Color contrast ≥4.5:1 (WCAG AA)

---

## Known Issues

_Document any issues found during testing:_

---

## Final Adjustments

_Document any tweaks made based on testing:_

---

## Sign-Off

- [ ] TV mode approved (tested on actual floor TV)
- [ ] Desktop mode approved
- [ ] Mobile mode approved (tested on iPhone/Android)
- [ ] Workers approve new layout
- [ ] Ready for production deployment
