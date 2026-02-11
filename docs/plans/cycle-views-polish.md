# Cycle Views Polish — Replace Rings, Polish Timeline + Bar Race

## Context
Scoreboard V2 has 8 cycle history views. The 3 new ones (Timeline, Rings, Bar Race) need work:
- **Rings view is confusing** — all gold, no visual differentiation, crew can't read it. REPLACE IT.
- **Timeline Strip** — works but needs polish
- **Bar Race** — works but needs polish

## Task 1: Replace Rings with "Pace Chart"
Replace mode index 6 ("Rings") with a **horizontal pace comparison chart**:
- Each cycle is a horizontal bar
- Bar length = cycle time
- Target time shown as a vertical dashed line
- Bars extending left of target = EARLY (green)
- Bars extending right of target = LATE (red)
- Most recent cycle at top
- Cycle number labels on left (#1, #2...)
- Dead simple: green = fast, red = slow, line = target

Update config.js: rename 'Rings' to 'Pace' in cycleModes array.

## Task 2: Polish Timeline Strip (mode 5)
- Make blocks taller (current 40px → 56px)
- Add subtle inner shadow/gradient to blocks for depth
- Tooltips: show "Bag #N · 4:32 (target 5:00) · 110%" on hover
- Break gap spacers should be wider (8px) and have a label ("break")
- Time labels at bottom should include total count: "9 bags · 8:19 AM → 4:08 PM"

## Task 3: Polish Bar Race (mode 7)
- Make bars thicker (min-width 12px)
- Add value label on top of each bar (the time, e.g. "4:32")
- Target line needs a label ("TARGET" text aligned to the line)
- Current/last cycle bar should glow slightly
- Green bars = under target time (fast), Red = over target (slow)
- Verify the color logic: time <= target = green (fast/good), time > target = red (slow/bad)

## Files to Modify
1. **src/js/scoreboard-v2/cycle-history.js** — replace renderCycleRings with renderCyclePace, polish renderCycleTimeline and renderCycleBars
2. **src/js/scoreboard-v2/config.js** — rename 'Rings' to 'Pace'  
3. **src/css/scoreboard-v2.css** — replace .cycle-rings styles with .cycle-pace, polish timeline and bars CSS

## DO NOT
- Touch any files outside the 3 listed above
- Remove or modify existing cycle modes (0-4)
- Break the mode navigation (modes array index must stay: 5=Timeline, 6=Pace, 7=Race)

## Color Logic Reminder
- cycle.time = actual seconds for the bag
- cycle.target = target seconds for the bag
- time < target = FAST = GREEN (good)
- time > target = SLOW = RED (bad)
- time ≈ target (within 5%) = GOLD (on pace)
