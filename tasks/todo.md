# What's drying in what bay

Koa, 2026-09-06: *"can we use a similar layout to see what is being dried in what bay"*

## The gap

The bay is written **once**, at takedown, onto `harvest_sacks.bay`. Nothing
records what goes *into* a bay when it is hung — the scan log has exactly two
event types, `enter` and `barn_load`, and neither carries a bay. So the existing
"After the tag" grid shows what came **out** of each bay, not what is in it.

Koa confirmed (2026-09-06) the person logging a trailer at the barn door **does
know** which bay it is going onto. So the capture rides on a form that is
already being filled once per trailer — no new scan, nothing new for the
hangers, and SOP §4's "a screen tap per lot change for the crew under the most
pressure" is not what this asks for.

## Structural rule

The `barn_load` row is the many-to-many record, not the session. A bay takes
material from several lots; a lot spreads over several bays. A `bay` column on
the *session* would model one bay per lot and be wrong the first time a bay
takes two zones — in a way that passes tests.

## Capture

- [x] `0030-harvest-load-bay.sql` — `bay INTEGER` on `harvest_scan_log`, set on
      `barn_load` rows only. Nullable on purpose (see below).
- [x] `getLastFilledBay(db, isTest, crew)` — last load with a bay; this crew's
      first, then anyone's. Different question from `getLastBay()`, which reads
      the last bay *emptied*.
- [x] Bay select on the intake form, defaulted, reusing `bayOptions()`.
- [x] `handleBarnLog` parses the bay with `parseBay` (nullable). A bookmark that
      posts without one still logs the bins — losing bins is worse than an
      unknown bay.
- [x] Confirm screen names the bay.

## The rule for "still hanging" — fills, not pairings

First attempt was *"a `(lot, bay)` pairing is down once a sack exists for that
lot from that bay."* **Wrong**, and wrong in the case that matters: the code's
own comment at `getLastBay` says a bay sees several takedowns. Under that rule
the FIRST sack tagged marks the whole pairing down, so a bay still half full of
hanging material reads empty — the same "screen disagrees with the barn" failure
as the current grid, just inverted.

Checked for a real completion signal at takedown: there is none. The sack print
form picks a bay, `handleSackAlloc` writes it to the sack, and nothing anywhere
records *"bay emptied"*.

So group each bay's loads into **fills**, and describe only the current one:

- A fill ends at the first sack tagged from that bay after it started.
- A load arriving after that starts the **next** fill — you cannot hang fresh
  material in a full bay, so a load into bay 5 after bay 5 began coming down
  means bay 5 was emptied. That is the completion signal, and it is free.

States, judged on the current fill only:

- `hanging` — loads in this fill, nothing tagged from the bay since it started
- `coming_down` — tagging has started; **open-ended on purpose**, we never learn
  when it finished, only that the bay was refilled
- `empty` — nothing has ever been hung there

Age while hanging = now − the fill's first load, badged against the same
`DRY_DAYS` window the takedown picker uses. Once coming down, the age freezes at
first-load → first-tag: the days it actually got.

Deferred: an explicit "bay emptied" tick at takedown would make `coming_down`
close exactly. Not building it yet — the refill signal self-corrects within a
day or two at steady state, and an unproven capture step is the thing to defer.

## The default must be named across a day boundary

`bay` is nullable so a bookmark posting without one still logs the bins. But a
*defaulted* select plus a nullable column means the day the crew starts filling
bay 6 while the default still reads bay 5, three loads land in bay 5 silently. A
missing bay is recoverable; a wrong one is not.

Same treatment the borrowed zone default already gets: same Pacific day, silent
one tap. Previous day, **named** on the form so it is confirmed, not assumed.

## Read

- [x] `bay` on the loads query in `getMetrics`.
- [x] `racks` in `harvest-metrics.js` — 12 bays, always all 12, so an empty bay
      reads as empty rather than missing.
- [x] "On the racks right now" card on the dashboard, same two-barn grid.

## Then

- [x] Tests: the capture cascade, the down rule, the three states.
- [x] Regenerate the demo fixture.
- [x] SOP §4 — this is now a step at the barn door, and §4 must stop saying
      "nothing new to do".
