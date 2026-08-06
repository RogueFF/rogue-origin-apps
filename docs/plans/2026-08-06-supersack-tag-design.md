# Supersack Tag & Label Printing — Design

**Date:** 2026-08-06
**Status:** Design agreed; Phase B (software) in progress
**Related:** `wiki/operations/plans/2026-07-06-seed-to-sale-harvest-tracking.md` · `workers/src/handlers/harvest-d1.js`

## Context

The harvest-tracking test build (deployed 2026-08-06) captures cutter zone-entry
and barn-intake loads, but stops at the barn door. Nothing ties a **physical
supersack** back to the field lot it came from.

Today `supersack_entries` tracks sacks only in aggregate — `UNIQUE(date, strain)`
with a `sacks_opened` count. There is no per-sack identifier anywhere in the
system. That aggregate grain is why `supersack-analytics` cannot distinguish
1st-cut (whole plant) from 2nd-cut (side branch) material, which is known to
skew tops/smalls ratios.

This design adds a printed tag carrying a unique per-sack ID, so that scanning a
sack when it is opened for bucking resolves to its exact field lot.

## Decisions

**Unique ID per sack, not per zone-lot.** Hand-writing a bag number is manual
friction, error-prone, and machine-invisible — and a label is printing anyway, so
printing the number is free. Unique IDs also make a physical recount a
scan-and-tally with duplicate detection, addressing the standing
system-count-vs-whiteboard reconciliation gap.

**Print-on-demand, one label per sack as it is filled.** Not batch-printed ahead.
Batch printing leaves orphan serials when a rack yields fewer sacks than
estimated; under harvest stress those either need a void step (easy to skip) or
get used on the next rack's sacks — silently misattributing lot, the exact
failure this system exists to prevent. Print-on-demand makes that structurally
impossible: a serial exists only because a sack exists.

**The QR encodes a short ID, not the lineage.** The source design doc specified
encoding "the lot's full seed-to-harvest lineage" in the code. Encoding a key and
resolving server-side is better: a shorter payload means a lower QR version,
bigger modules and more reliable scanning on a scuffed label; and lineage can be
corrected or enriched after printing (weights recorded at opening, a cultivar
typo fixed) without the tag going stale. The human-readable fields on the tag are
the offline fallback.

**Label stuck to the existing Uline shipping tag.** The ZP-450 cannot feed
cardstock tags, and adhesive labels peel off woven polypropylene. Sticking a
thermal label onto the paperboard tag already in use keeps the proven wire-tie
mounting, changes nothing about how crews physically tag a sack, and leaves the
colored stock available as an at-a-glance cultivar signal.

**2026 harvest forward only.** The ~1,318 existing untagged sacks are left alone;
their lot cannot be reconstructed anyway. The existing aggregate
`supersack_entries` table is not dual-written — deriving the aggregate from
per-sack rows later is easy, double-counting during a transition is not.

## The tag

4" × 2" direct-thermal label on a Uline colored shipping tag, wire-tied to the
sack.

```
┌──────────────────────────────────────────┐
│ SOUR LIFTER                              │   cultivar, large
│                              ┌────────┐  │
│ # 26-0847                    │   QR   │  │   bag #, large
│                              │        │  │
│ Oct 3, 2026 · Z4 · Cut 1     └────────┘  │   secondary line
└──────────────────────────────────────────┘
```

Bag # and cultivar are the dominant elements — those are what gets read across a
stack. Zone and cut print small: they belong in the code, but they are nearly
free in ink and save a scan during a manual audit.

**Media:** 4×2 direct-thermal rolls, **synthetic/poly rather than paper**. Direct
thermal has no ribbon; print fades with heat, UV and abrasion, and sacks may sit
months before opening. Paper stock in a barn is a real risk to the lot join.

## ID scheme

`26-0847` — season prefix + global running serial, zero-padded to four digits.

Global rather than per-lot: it matches how sacks are already counted (one running
total) and makes "how many do we have" a `MAX()` rather than a sum across lots.
Four digits covers ~9,999/season against a ~3,965 projection for 2026. The season
prefix prevents collisions across years once multi-season history accumulates.

QR payload: `https://rogue-origin-api.roguefamilyfarms.workers.dev/s/26-0847`

QR rather than Code128 — consistent with the zone-entry codes, phone-scannable
with no hardware, and readable by a cheap USB 2D imager at the bucking station
for repetitive scanning.

## The takedown catch

The zone-entry system's "currently active zone" tracks **cutting**. Sacks are
filled at **takedown, ~10 days later**, while the crew is out cutting a different
zone that day. The print page must therefore **never** attribute a sack to the
currently-active zone — that would misattribute nearly every sack.

Instead the operator picks which lot is coming down, from a list of recent
zone-sessions with cut dates:

> `Z4 · Sour Lifter · Cut 1 · cut Oct 3 — 10 days drying`

Every label printed in that session inherits the selected lot. This works with
the physical hanger board already kept — the operator reads the rack's board
entry and picks the match. A fuller version would digitize rack→lot at hang time
so takedown just scans a rack code, but that requires the hanger board to be
built first.

**Cultivar** is entered at print time and stored on the sack row.
`harvest_scan_log` has no cultivar column (zones are the unit; the source design
treats multi-cultivar zones as separate logical zones). Sourcing cultivar from
planting records is a later improvement.

## Data model

New table `harvest_sacks` — one row per physical sack, distinct from
`harvest_scan_log`'s event grain:

```sql
sack_id TEXT UNIQUE            -- '26-0847'
season, serial                 -- 26, 847; next serial = MAX(serial)+1 per season
zone, cultivar, cut_number, harvest_date
zone_session_id                -- FK to the harvest_scan_log 'enter' row = the lot
printed_at
opened_at, tops_lbs, smalls_lbs -- filled in later, at bucking
is_test
```

A `UNIQUE(season, serial)` index makes a concurrent-print collision fail loudly
rather than silently duplicate.

## Routes

| Route | Purpose |
|---|---|
| `GET /api/harvest?action=sack_print` | Lot picker + cultivar + quantity |
| `POST /api/harvest?action=sack_print_run` | Allocate serials, render printable labels, auto-print |
| `GET /api/harvest?action=sack_label&id=` | Single label HTML (reprint path) |
| `GET /s/<sack_id>` | Scan-resolve page: lineage + Record weights |
| `POST /api/harvest?action=sack_weigh` | Record tops/smalls at bucking |
| `GET /api/harvest?action=sacks` | JSON list, for inspection while testing |

**Reprint** must reissue the *same* serial, never allocate a new one — easy to
overlook and painful to retrofit once duplicate physical tags exist.

## Build phases

**Phase A — printer & media (no code, testable immediately).** Order 4×2 poly
direct-thermal rolls. Load and run the ZP-450's media calibration (it must learn
the new label length). Print a test label to confirm the driver path. Measure the
output — thermal printers routinely render 4×2 as 3.9×1.95 until `@page` and the
driver's stock size agree. Set Chrome's `--kiosk-printing` flag on the barn PC so
`window.print()` fires with no dialog.

**Phase B — software.** Migration `0010-harvest-sacks.sql` plus the routes above,
added to `harvest-d1.js`. Label HTML uses `@page size: 4in 2in; margin: 0` and a
QR sized to ~203 px for 1:1 dot mapping at 203 dpi, following the existing print
pattern in `src/pages/barcode.html`.

**Phase C — the bucking join.** Record-weights write-back, and deriving the
existing aggregate from per-sack rows rather than dual-writing.

## Testing before October

1. **Durability, start now.** Print a label, stick it on a Uline tag, hang it in
   the barn, and try scanning weekly. This answers the direct-thermal fade
   question with real data months before it can hurt anything.
2. **Scan reality.** Test the QR at arm's length, at an angle, in barn lighting,
   on a scuffed label, with a gloved thumb. A QR that scans on a desk and fails
   on a dusty sack is the whole failure mode.
3. **Software.** Serial allocation under repeat clicks (no duplicates, no gaps —
   a gap reads as a lost sack). Reprint returns the *same* ID. The lot picker
   attributes to the selected lot, never the active cutting zone.

## Open items

- Uline tag size in use (assumed #5 4¾×2⅜" or #6 5¼×2⅝") — confirms label fit.
- Cultivar sourced from planting records instead of typed at print time.
- Rack→lot digitized at hang time, so takedown scans a rack code.
- Zebra Browser Print / raw ZPL, if browser-rendered print quality disappoints.
