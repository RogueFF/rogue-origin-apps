# Floor Manager overhaul — design

Date: 2026-09-02. Replaces `src/pages/hourly-entry.html` (the "Floor Manager"
hourly production entry page) with `src/pages/floor.html`, `src/css/floor.css`
and `src/js/floor/`.

## Subject and job

This page is the pen, not the dashboard. The Ops Hub answers "how is the line
doing"; this page is where the number comes from. It is touched at two moments
per hour — the top of the hour (who is on each line, what strain) and the end
of the hour (what the scale said) — and sits ambient in between. The existing
step guide already encodes that rhythm (`src/js/hourly-entry/index.js:1307`).

Audience: the floor manager, on a desktop or laptop by the line, all shift,
bilingual EN/ES. Its one job: **the current hour, entered in fifteen seconds
from the keyboard, and never lost.**

## What is wrong with the page today

Verified in the files, not assumed.

- **Saves are not durable.** Autosave is a 1s debounce; a failure lives in a JS
  variable behind "Tap to retry" (`index.js:1551`). Close the tab, lose the
  hour. Worse, `saveEntry` returns silently when a save is in flight
  (`index.js:1553`), so an edit typed during a save is dropped until the next
  blur fires another autosave.
- **A view swap stands between the manager and the form.** `showView`
  (`index.js:859`) trades the day list for the editor, so entering the current
  hour always costs a click first.
- **The page is the last one off the design system.** It never loads
  `shared-base.css`; it redefines the brand tokens locally and aliases four
  more just so the shared toast renders (`src/css/hourly-entry.css:3-33`), and
  forces `color-scheme: dark` (line 42).
- **Polling is extravagant.** Scale every 1s (`index.js:3937`), bag-timer
  version every 3s (4403), production version every 10s (682) — roughly 4,300
  requests an hour per open tab, none of it gated on tab visibility.
- **Cross-computer sync stops in the evening.** `checkProductionVersion`
  compares the date picker against `new Date().toISOString().split('T')[0]`
  (`index.js:4449`), which is the UTC date. After 5pm Pacific that is
  tomorrow, so the reload never fires.
- **Mobile collapses.** `body{overflow:hidden}` (css:49) plus a viewport-locked
  grid (69-77) plus `grid-template-rows: 1fr auto` set at ≤1200px (2106) and
  never reset at ≤768px (2119) computes `.card-hourly` to 1.3px tall. Desktop
  is the only supported device, so this is a byproduct fix, not a driver.
- **Dead weight.** The printer tab is hidden behind `display:none` and its
  endpoint 404s (`index.js:2612`); the tutorial overlay and inline tooltips run
  ~400 lines for a page with one form; two 220px instrument SVGs carry bezels,
  tick rings and glow filters (`hourly-entry.html:466-582`); two near-identical
  custom-dropdown implementations exist (`index.js:2700` and `3259`);
  `updateEditorSummary` (2074) does nothing; there are two home buttons.
- **The e2e safety net is dormant.** `tests/hourly-entry.spec.js` targets
  `localhost:3456`, `tests/hourly-entry-goals.spec.js` targets `:8080`, and
  `playwright.config.js` declares no `webServer` — neither runs unless someone
  had started a server by hand.

## Decisions

1. **The current hour's editor is always open.** No view swap. The day strip
   retargets the same editor; the editor never disappears.
2. **The ten slots become one strip**, the Shift Ledger idiom reduced to what a
   floor tool needs: hour, lbs, target tick, met/missed glyph, note flag,
   unsaved badge. It is a navigation control that happens to be a chart.
3. **Keyboard first.** Digits into the crew fields, Enter and Tab advance and
   save, arrows walk the strip, the save state is a sentence not an icon
   ("saved 9:58"). `handleEnterKey` already does the advance; the rebuild makes
   it the headline rather than a hidden convenience.
4. **Dark-first, retokenized.** The hub v3 surface/ink/status tokens move out of
   `hub.css` into a shared layer both pages import; this page loads
   `shared-base.css` and drops its local token block. Light mode works through
   the shared `data-theme` key; dark stays the default here.
5. **Numerals larger than the hub.** Tops and smalls inputs at 28px mono, slot
   pounds at 22px. Read from a step back, not from a laptop lap.
6. **Same API contract.** Same actions, same payload shape, same slot labels.
   The rebuild is a frontend rebuild; no worker or D1 change ships with it.
7. **Below 1100px the grid stops being viewport-locked** — `display:block`,
   `height:auto`, page scrolls. Enough that a phone is usable; not a design
   target.

## Layout — desktop, two columns, no page scroll

```
header: Floor Manager · date · started 7:30 · EN/ES · theme · drawer
queue strip: NOW Sugar Shaker #35110 42/120 lb  →  NEXT Lifter
┌──────────────────────────────────────────┬───────────────────────────┐
│ DAY STRIP  7 8 9 10 11 │ 12:30 1 2 3 4   │ PACE                      │
│  61.2 / 88.0 lb · 4 lb behind pace       │ 61.2 / 88.0 · proj 84     │
├──────────────────────────────────────────┼───────────────────────────┤
│ EDITOR — 9–10 AM  ‹ ›                    │ BAG TIMER   32:10         │
│  Line 1  Buckers 3  Trimmers 12  T0 1    │ 5kg 6 · avg 41:02         │
│  Cultivar [2025 Sugar Shaker ▾]   QC 1   │ [ Log 5 kg bag ]          │
│  + Line 2                                │ scale 4,812 g             │
│  Tops [17.1]  Smalls [8.4]  target 14.9  ├───────────────────────────┤
│  reason chips · notes                    │ drawer: Inventory · Queue │
│  saved 9:58 ✓                            │                           │
└──────────────────────────────────────────┴───────────────────────────┘
```

The bag timer and live scale collapse from two 220px instruments to one status
tile: numeral countdown, bags today, average, target, the Log Bag button and
the scale reading. The inventory pool adjuster and the order queue board move
into a drawer opened from the header — not used mid-shift today, but expected
to be used several times a week once other farms' product comes through intake,
so it is rebuilt once and deduplicated rather than deleted.

## Save durability

Chosen shape: **persist, then verify before replay.**

- Every autosave writes `{payload, baseline, queuedAt}` to `localStorage` under
  `floor:outbox:<date>:<slot>` *before* the POST, and clears it on success. The
  hour survives a closed tab, a reload, and a dead network.
- Replay fires on load, on `online`, and on a 30s timer — but never blind.
  Before replaying, the outbox re-reads `getProduction` for that date and
  compares the server row against the `baseline` the edit was made from. Match
  means replay. Mismatch means another computer changed that hour, and the
  manager is asked: keep mine, or keep theirs. This is optimistic concurrency
  built from the read endpoint that already exists — no schema change.
- Entries older than the current shift never auto-replay; they prompt.
- The strip badges every hour holding an unsaved entry, and the editor's save
  line states the count.

`monthly_production` has no `updated_at` and `addProduction` replaces the whole
row for `(date, time_slot)` (`workers/src/handlers/production/hourly-entry.js`),
so last-write-wins is the standing behavior on two computers today. The
baseline comparison closes the window the outbox would otherwise widen. Adding
`updated_at` plus a 409 path is the stronger fix and stays on the table as
later hardening — it is a D1 migration against the table feeding pay and rate
analysis, so it ships on its own approval, not inside a frontend rebuild.

## Features, in build order

1. **Durable save state** (above), plus the in-flight-edit drop fixed.
2. **Pace line** — "61.2 / 88.0 · projected 84 · 4 lb behind". `scoreboard`
   already returns `projectedTotal`; the page fetches it and discards it.
   Turns "did we hit this hour" into "will we hit today", which is the question
   the manager can still act on.
3. **Crew carry-forward as a draft** — an empty hour pre-fills crew and cultivar
   from the last hour with data, drawn in placeholder ink, committed on first
   touch. Replaces the Copy Prev button. Strictly client-side: a saved row with
   trimmers and no tops is what the scoreboard reads as the live hour.
4. **Reason chips** — machine down, wet material, break ran long, cultivar
   change, short crew, new trimmers. Multi-select, EN/ES, serialized into the
   existing `qc` column as `[Reason: …]` in the same bracket grammar
   `src/js/hub/format.js` already parses for `[Crew change …]`. Free text stays
   underneath. "Why did we miss" is the only field feeding rate analysis and
   free text does not aggregate.
5. **Spanish parity** — move the LABELS dictionary to `shared/i18n.js` and cover
   what was never translated: "Set Start Time", the notes placeholder,
   "Logging…", "Cumulative (Actual / Target)".
6. **End-of-shift close-out** — totals, hours with no data, hours with no
   cultivar, unsaved check. First thing to cut if the rebuild runs long.

Not building: filling Tops from logged bags. Bags carry size only, a 10lb bag
may be smalls, and with two lines running nothing attributes a bag to a line. A
confident wrong number is worse than typing the right one.

## Deleting

Printer tab and its ~270 lines (`index.js:2638-2905`); tutorial overlay and
inline tooltips (`hourly-entry.html:634-667`, `index.js:2200-2600`); the step
pill theatre, keeping its target arithmetic; both instrument SVGs; one of the
two custom dropdowns; the second home button; the Today FAB, which becomes a
header action; `updateEditorSummary` and the never-mutated time-picker state;
the local token block. Git is the rollback.

Also on the way out: the duplicate version polls collapse to one at 5s driving
both refreshes, the scale poll gates on `visibilitychange`, and the UTC date
comparison becomes `formatDateLocal`.

## Sequence

| Phase | Contents | Ships alone |
|---|---|---|
| 0 | `src/js/floor/slots.js` — `updateTimeSlots`, `normalizeFirstSlotKey`, the multiplier table, ported verbatim under `node --test` | yes, no UI change |
| 1 | New shell: `floor.html`, `floor.css`, `src/js/floor/{editor,strip,timer,queue,labels}.js` on shared tokens. Same API calls | yes, beside the old page |
| 2 | `save.js` — outbox, baseline comparison, save-state UI; polling diet; date fix | yes |
| 3 | Pace line, crew draft, reason chips, ES parity | each half a day |
| 4 | Close-out; `webServer` in `playwright.config.js`; `hourly-entry-goals.spec.js` ported to the new selectors | yes |
| 5 | Hub rail links to `floor.html`; old page redirects after a week of real shifts | — |

Every phase: bump `sw.js` `CACHE_VERSION`, run `npm run stamp`, screenshot dark
and light at 1280 and 1920 on the local server before committing.

## Risks

- **The slot labels are a backend contract.** `validateTimeSlot`
  (`workers/src/handlers/production/hourly-entry.js:33`) accepts the ten
  canonical strings plus a custom first slot matching `H:MM AM - 8:00 AM`.
  `updateTimeSlots` and `normalizeFirstSlotKey` exist because a renamed slot
  once lost data (`2f31c614`). Phase 0 pins them under tests before any UI moves.
- **Whole-row upsert, two computers.** Addressed by the baseline comparison
  above; the `updated_at` migration remains the stronger fix.
- **Target math is duplicated client-side.** Hourly target is
  `effective trimmers × targetRate × multiplier`, with a client copy of the
  multipliers (`index.js:470`) that the backend can override through
  `schedule.time_slot_multipliers`. If they drift, the floor reads "met" while
  the TV reads "missed". Consider returning per-slot targets from
  `getProduction` so the client stops doing rate math at all.
- **Notes are parsed by string.** `hub/format.js` and the weekly digest read
  `[Crew change …]` out of free text. Reason chips must serialize into the same
  grammar or ship with the parser change in the same commit.
- **A live tool with a trained user.** The old page stays live and linked until
  a full week of shifts has run on the new one. The muscle memory that changes
  is exactly "tap an hour, then type".
