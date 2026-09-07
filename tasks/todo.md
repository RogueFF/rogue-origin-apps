# End-of-day close

Koa, 2026-09-07: *"do the end-of-day close next"* — the #1 finding from the
Fable review.

## The problem

`buildLotRow` withholds `cutter_person_hours` for any session where
`pacificDay(opened) !== pacificDay(closed)`. That rule is right: the crew stops
in the last zone of the day and picks up there next morning, so nothing closes
the session and open-to-close contains a night.

But a zone is ~1 acre / 1,936 plants / ~88 trailers ≈ **1.5–2 days of cutting**.
So nearly every lot spans a night, `cutter_person_hours` is null on nearly every
lot, and the Crews card, bins-per-cutter-hour and time-in-zone read empty for the
whole season. Honest, and indistinguishable from broken.

## Part 1 — the scan (primary)

- [ ] `day_end` action. Closes THIS crew's open session (`crew IS ?`, NULL-safe,
      same scoping as everything else). Confirms which zone/cultivar closed and
      after how long. Says so plainly when nothing is open — not an error.
- [ ] One laminated card on the print sheet. One card serves both crews: the
      cookie on the lead's phone decides whose session closes.
- [ ] Spanish first, like every crew screen.

Cost: two scans a day per lead, and they already re-scan the zone sign every
morning — so one of the two is new.

## Part 2 — the fallback (because a forgotten scan is certain)

**The trap.** Clipping a spanning session to its observed capture events
(first→last barn load / headcount tap that Pacific day) gives a window that is
always **shorter** than the truth: the crew cut before the first trailer arrived
and after the last one left. Short hours ⇒ **inflated** bins/cutter-hour. That is
inventing optimism in the exact number the feature exists to produce, and it
would be invisible — an overstated rate looks like a good day.

So the fallback must not be presented as the same measurement as a clean
session. Decision needed on which of these:

- **(a) Clip, and label it.** `cutter_person_hours_basis` says
  `clipped to observed activity — a floor on hours, so the rate is a ceiling`.
  Rate figures must then keep clipped sessions in their own bucket rather than
  pooling them with measured ones (the `bins_rated` machinery already tracks
  which sessions are rated; extend it).
- **(b) Do not clip.** Ship the scan alone; a forgotten scan loses that lot's
  hours exactly as today. Fewer moving parts, no optimistic bias, but the review
  called a forgotten scan certain — so the metric stays patchy in the first
  weeks while the habit forms.

## Then

- [ ] Tests + mutation on both parts
- [ ] SOP §1 gains the end-of-day step; the review page item ticks
