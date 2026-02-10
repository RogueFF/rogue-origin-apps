# Consignment Page — Pass 5 Brainstorm

## What's currently "safe" about this design

The page works. It's clean. But it looks like a well-made admin panel. Nothing about it says "this was built for a hemp operation in Southern Oregon." It could be a consignment page for auto parts.

## What would make it genuinely different

### 1. **Kill the symmetry** — Asymmetric grid for partner cards
Instead of equal cards in a grid, make the partner with the most inventory the DOMINANT card — takes up 2 columns, bigger number, shows a mini sparkline of their inventory over time. Other partners are smaller. Visual hierarchy by importance, not alphabetical order.

### 2. **Ambient data** — Background reacts to state
- If total consignment inventory is high (lots of product on shelves), the noise grain could be slightly warmer/green-tinted
- If balances owed are high, a subtle warm amber shift
- This is subliminal — nobody notices it consciously, but the page "feels" different based on the state of the operation

### 3. **Contextual Quick Actions** — Don't show all 3 equally
If the biggest partner has a high balance and you haven't paid them in 30+ days, the "Record Payment" card gets a subtle pulse/highlight. If a new partner was just added with 0 inventory, "New Intake" gets emphasized. Make the actions context-aware.

### 4. **Inventory visualization** — Not just numbers
Replace the boring "690.0 lbs" text with a minimal proportional bar/block visualization. Each partner's card shows their inventory as a horizontal fill — you can instantly compare partners at a glance without reading numbers. The number is still there, but the visual comparison is instant.

### 5. **Activity feed → River** — Full-width bottom section
Instead of a contained box, the activity feed becomes a full-width "river" at the bottom of the page with more visual weight. Each activity type gets a distinct visual treatment:
- Intakes: left-aligned, green accent
- Sales: center-aligned, gold accent  
- Payments: right-aligned, blue accent
This creates a visual rhythm where you can scan the flow of product in → sold → paid without reading.

### 6. **Micro-interactions that matter**
- When you hover a partner card, show a subtle "ghost" of their last activity
- Quick action cards: icon animates on hover (not rotation — a subtle scale/bounce that feels physical)
- Activity items slide in from the left when the feed loads (staggered)
- Partner cards have a very subtle parallax tilt on hover (like a physical card being picked up)

### 7. **Typography as identity**
- Section numbers: "01 / Quick Actions", "02 / Partners", "03 / Activity" — editorial magazine numbering
- Use DM Serif Display ITALIC for the section labels, not regular — gives it a distinct editorial feel
- Dates in the activity feed use a condensed format with heavy letter-spacing: "FEB 06" not "Feb 6"

### 8. **The "Command Line" — keyboard-first power user mode**
A hidden feature: press `/` anywhere on the page to open a command palette.
Type: `intake valley view 10 tops lifter 100` and it fills the intake form.
Type: `pay pedro 5000 check` and it opens payment modal pre-filled.
This is for Koa — he types faster than he clicks.

## What to build (prioritized for impact)

**Pass 5 focus:**
1. Asymmetric partner cards (dominant card for highest inventory)
2. Inventory fill bars on partner cards
3. Editorial typography treatment (section numbering, italic DM Serif)
4. Quick action icon micro-animations
5. Activity feed staggered entrance animation
6. Command palette (stretch — only if time permits)

**Save for later:**
- Ambient data color shifting
- Context-aware quick action emphasis
- Activity river layout
