# Order blocks, take two — a block is an order, and the queue burns down

Supersedes the load-bearing decision (§3) of
`docs/plans/2026-08-19-order-blocks-design.md`. That document is still the
reference for everything it decided that this one does not touch.

## 1. What changed, and why

The queue shipped ranking **cultivar runs**: one pooled lot per cultivar serving
every order that needed it. The reasoning was physical — the floor trims a lot,
not an order, and tops and smalls come off the same pass.

The operator's correction, 2026-08-20: **a block is an order.** Two consequences
were stated plainly and are accepted as decisions, not open questions:

- If two orders both want Berry Bliss, Berry Bliss is trimmed **twice**, once per
  order. Cross-order pooling is gone. The floor runs order by order; pooling was
  an abstraction the floor does not perform.
- Inside an order, **line items are trimmed in the order they were typed**.
  `order_items.sort_order` already stores exactly that and the editor already
  writes it; the scheduler simply ignored it.

## 2. The second, larger change: the board burns down

The queue was a forecast. It becomes a **progress tracker**:

> "On the hourly entry, tops/smalls per cultivar get marked in separately so we
> should be able to see how far an order is completed. If an order is put in the
> day before and it's first in line, any hourly entries with that cultivar
> should count towards that order."

`monthly_production` is the hourly entry table — one row per
`(production_date, time_slot)` carrying `cultivar1`, `tops_lbs1`, `smalls_lbs1`.
Those pounds get allocated to orders, so the front of the queue drains as the
floor works and every block shows how far along it is.

## 3. Decisions locked

| # | Decision | Source |
|---|---|---|
| 1 | A block is an order; segments inside it are line items in `sort_order`. | Operator |
| 2 | Tops and smalls of one cultivar stay **separate line items**, each with its own progress, because hourly entry records them separately. | Operator |
| 3 | Default block rank is **insertion order**. Drag overrides. | Operator |
| 4 | An order accrues from **the moment it was saved**, overridable by Damon through his Telegram bot. | Operator |
| 5 | Status is **fully automatic**: first pound flips `in_queue` to `in_production`; 100% flips to `finished`. | Operator |
| 6 | Status vocabulary is `in_queue`, `in_production`, `finished`. | Operator |

## 4. The one place decision 2 needs care

Decision 2 is about **counting progress**, and it is right: the floor records
tops and smalls separately, so an order's two lines fill at different speeds and
must be shown separately.

It is *not* a claim about **scheduling hours**, and read that way it would break
the dates. If an order holds Berry Bliss tops 900 lb and Berry Bliss smalls
400 lb as two lines, scheduling them independently costs:

```
tops   900 / 0.53 = 1,698 lb lot -> 102.6 h
smalls 400 / 0.47 =   851 lb lot ->  51.4 h
                                    154.0 h
```

But one pass of a 1,698 lb lot yields 900 lb of tops **and ~798 lb of smalls** —
it covers both lines in 102.6 hours. Scheduling them apart over-promises by
half again, on the one number the board exists to produce. The 45 days of
`monthly_production` behind the original §3 have not stopped being true; they
just do not govern how progress is *displayed*.

**Resolution, confirmed with the operator as a consequence rather than as
physics** — *"one span, two progress bars"*. Segments are per line item and each
keeps its own burn-down bar. When two segments in the same order share a
cultivar, they are scheduled as **one lot pass**, sized by whichever form binds,
and the board draws them as one time span carrying two progress bars: the two
lines finish together. Nothing is merged away and no hour is counted twice.

## 5. The allocation engine

New pure module `workers/src/lib/burndown.js`.

**Source.** `monthly_production` joined to `cultivar_aliases` on
`a.alias = mp.cultivar1` — the same exact-match join `rateTable` already uses, so
"2025 - Berry Bliss / Sungrown" resolves to `berry-bliss` and the substring
matching that silently counted Sour Lifter toward Lifter never appears.

**Chronology.** `time_slot` is free text like `"9:00 AM – 10:00 AM"` with an
en-dash, and **it does not sort chronologically as a string** — `"12:30 PM"`
sorts before `"7:21 AM"`. Entries must be ordered by a parsed slot-start minute.
`production-helpers.js` has exactly this parser, private inside
`sortSlotsChronologically`; it gets exported rather than copied.

**Rule.** For each `(cultivar, form)`, walk entries oldest to newest. Credit each
pound to the highest-ranked order that:

1. needs that cultivar and form,
2. has `accrual_start` at or before the entry's timestamp, and
3. is not yet full.

Overflow runs to the next eligible order. Pounds matching no eligible order are
reported as unallocated rather than discarded — a silent drop here would look
exactly like an order running behind.

**Line 2 is ignored** (`cultivar2`, `tops_lbs2`, `smalls_lbs2`): zero activity in
45 days, per §3 of the prior design. If a line-2 row ever appears, the engine
reports it as unallocated rather than silently omitting it.

## 6. Schema — migration `0019`

One migration, because `orders` has to be rebuilt anyway and rebuilding it twice
would be two windows of risk for no gain.

- `orders.status` CHECK becomes `('in_queue','in_production','finished')`, mapping
  `draft` and `open` to `in_queue`, `shipped` and `closed` to `finished`.
- `orders.queue_rank TEXT` — the block ranking, moved off cultivars.
- `orders.accrual_start TEXT` — ISO datetime, **set to the moment the order was
  saved**, not to its order date. `order_date` is a bare date and the editor has
  no time field; defaulting to midnight would credit an order typed at 2pm with
  that whole morning's trim. Damon's override writes here when that is wrong.
- `orders.queue_rank` is likewise stamped at insert with the save timestamp, so
  decision 3's "insertion order" is the natural default rather than a NULL sort.
  `ORDER BY queue_rank` with every row NULL is arbitrary order, not insertion
  order — the column has to be written for the default to mean anything.
- **`production_runs` is dropped.** Its only jobs were holding the pooled
  cultivar rank (now `orders.queue_rank`) and `dedicated_order_id`, which was
  the unbuilt "pull-forward override" of decision 5. Under order blocks every
  segment is dedicated to its order by construction, so that open loop closes
  as a side effect rather than being built.

**The FK trap, already hit once.** D1 runs with `foreign_keys=1` and a first
attempt at this rebuild was rolled back by Cloudflare —
`FOREIGN KEY constraint failed` — because `DROP TABLE orders` orphans
`order_items.order_id`. `PRAGMA defer_foreign_keys` does not survive wrangler's
statement batching. The migration therefore parks `order_items` in a temp table,
empties it, rebuilds `orders`, and restores it. Two test orders
(`MO-2026-001/002`) and three items are live; they are backed up at
`~/Desktop/rogue-scrub-backup/status-vocab-2026-08-20/`.

## 7. API

- `getQueue` returns `blocks` (was `runs`), each with segments, progress and a
  promise date.
- `saveRunOrder` becomes `saveQueueOrder`, taking order ids and writing `queue_rank`.
- `setAccrualStart` — write action, Damon's bot; documented alongside
  `wholesale_import_order` in `wiki/operations/bot-data-access.md`.

**Status transitions are a write, and `getQueue` is a read.** Advancing status
from inside a GET would make an unauthenticated read mutate the order book. The
`*/5` cron in `workers/src/index.js` already exists; the transition runs there,
so the automation has one home, runs whether or not anyone has the page open,
and leaves the read path pure.

## 8. Front end

`src/js/wholesale/queue.js` — one draggable card per order. Header: id,
customer, promise date, overall percent. Body: a segment row per line item with
cultivar, form, `done / total lb`, and a bar. Segments sharing a cultivar are
bracketed as one pass. Coverage warnings move to the segment.

## 9. Tests

- `burndown.test.mjs` — allocation order, accrual cutoff, overflow, unallocated
  pounds, and the `time_slot` chronology trap specifically.
- `queue-schedule.test.mjs` — rewritten for blocks; the joint-pass case from §4
  gets an explicit test asserting hours are **not** doubled.
- `order-status-vocabulary.test.mjs` — the drift guard, already written, extended
  to cover the automatic transitions.

## 10. Open, and deliberately not decided here

- **What "finished" costs.** Status flips at 100% of *trim weight*. An order
  leaves the board before it is packed, COA'd or shipped. Accepted by the
  operator; recorded because the board's largest non-technical risk is a number
  on it being read as a promise.
- **Re-ranking rewrites history.** Allocation is computed from current rank, so
  dragging a block changes who got credited for last week's pounds. Fine while
  the queue is short; it will want a frozen ledger before it is long.
