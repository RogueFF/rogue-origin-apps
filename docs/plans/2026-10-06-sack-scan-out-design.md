# Sack Scan-Out — design and build plan

**Date:** 2026-10-06
**Status:** Design agreed with Koa; build not started
**Branch:** `feat/sack-scan-out` (from `origin/master` at `aa979dc9`)
**Builds on:** the 2026 sack tags (`harvest_sacks`, `/s/<id>`, `sack_open`), the
nightly allocation (`handleAllocate`), the wholesale queue (`computeQueue`), and
the end-of-day form (`src/pages/supersack-entry.html`).

---

## 1. What this is for

Every 2026 supersack carries a tag with a unique QR code. When 2026 processing
starts, the water spider needs one fast way to take a sack **out of supersack
inventory and into processing**, so that the end-of-day numbers show yield for
exactly the sacks that went to the line.

As of today 332 sacks are tagged and none has been opened. 2026 processing has
not started, so nothing below changes a habit anyone already has.

## 2. Decisions locked (Koa, 2026-10-06)

| # | Decision |
|---|---|
| 1 | **One scan per sack.** It means "this sack left inventory for the line." It takes one off the Shopify Super Sack count. There is no second scan at opening. |
| 2 | **A typed bag number is a first-class way in**, not a fallback of last resort. It may be faster than scanning. |
| 3 | **Ease of use for the water spider outranks everything else on this screen.** Fewer taps wins every tie. |
| 4 | **A scanned sack is usually assigned to an existing order.** The screen proposes the order; the water spider can change it or choose stock. |
| 5 | Untagged 2025 sacks keep working exactly as they do today. |

## 3. What exists and what is missing

**Exists.** Scanning a tag opens `/s/<id>`. The ABRIR BOLSA button sets
`opened_at` and subtracts one from Shopify through `adjustSupersackCount`. The
nightly cron shares each day's floor output per (season, cultivar) across the
tagged sacks opened that day, by weight.

**Missing.**

1. Scan-out is one sack at a time: camera app, page load, button. There is no
   continuous scanner and no list of today's sacks.
2. The end-of-day form subtracts its typed sack count from Shopify and knows
   nothing about scans. A 2026 sack would come off twice.
3. Per-sack yield lands overnight and shows only on each sack's own page. A
   mismatch between sacks scanned and sacks the floor counted goes to a log.
4. A sack carries no record of the order it was pulled for.

## 4. The scan-out screen

One page, rendered by the harvest worker like every other crew screen. Short
path **`/salida`** (and `/out`), added to `SHORT_SCREENS`. Spanish first, with
the existing language toggle. No login, same as the other crew screens.

### 4.1 Two ways in, one result

**Scan.** The camera opens when the page opens and stays open. The water spider
points at a tag; the sack is taken out; the camera keeps running for the next
one. No button between sacks.

- Uses the browser's built-in `BarcodeDetector` where it exists.
- iPhone Safari does not have it, and the crew phones are iPhones, so a small QR
  decoder is vendored into the page as the fallback. No CDN.
- The tag's QR is the `/s/<id>` URL. The page reads the id out of it and ignores
  any QR that is not a sack tag.
- The same sack seen again within a few seconds is ignored, so holding the phone
  on a tag does not fire twice.

**Type.** Below the camera: one chip per cultivar that has sacks in inventory,
then a large number pad. Tap the cultivar, type the bag number printed big on
the tag, press the one large button.

- The last cultivar stays selected, because sacks are pulled in runs of one
  cultivar. After the first sack the water spider types only a number.
- A bare number is ambiguous across cultivars, which is why the chip comes
  first. This never guesses a cultivar.
- If the camera is refused or unavailable, the page opens straight in type mode
  and says nothing about an error.

### 4.2 What the water spider gets back

Built to be read at arm's length, with gloves on, in a barn:

- **Good scan:** the whole screen flashes green, the phone buzzes once and
  beeps, and a large line reads the cultivar, bag number and order nickname.
- **Already out:** amber, a double buzz, "ya salió" with when. Nothing changes.
- **Not a real tag, voided, or not found:** red, a long buzz, one plain line.
- **Undo:** the last sack shows a large DESHACER button for 60 seconds. It puts
  the sack back in inventory and adds the one back to Shopify.
- The screen stays awake while the page is open.
- Every touch target is at least 56 px. Nothing needs a second hand.

### 4.3 Today's list

Under the scanner, grouped by cultivar and order:

```
Sour Lifter · Pedido "Miami"          6 de 14 sacos
  #151  Z16 corte 1   9:42            [deshacer]
  #150  Z16 corte 1   9:41
Lifter · Inventario                   2 sacos
```

"6 de 14" is sacks scanned today against the sacks the queue says that order
still needs for that cultivar. It is the "how much to pull" number, on the same
screen as the scanning. It uses the queue's existing `sacksNeeded`; nothing new
is computed.

### 4.4 Working without signal

A scan that cannot reach the server is kept on the phone, shown in the list as
pending, and sent when the connection returns. The server treats a repeat of the
same sack as "already out", so a retry can never subtract twice.

## 5. Which order a sack is for

At scan time the server looks up the top-ranked open order that still wants that
cultivar, using the queue as it stands, and stamps the sack with it.

- The confirmation shows the order's nickname. One tap changes it to another
  open order wanting that cultivar, or to **Inventario** (no order).
- If no open order wants the cultivar, the sack is stamped as stock and the
  screen says so. This is normal, not an error.

**The stamp is a traceability record, not a ledger.** It answers "which sacks
went into this order." It does not credit pounds. Pounds keep reaching orders
through the existing replay of floor production by rank, so "how far along is
this order" still has exactly one answer.

## 6. Data

One migration, `0045-harvest-sacks-scan-out.sql`:

| Column | Meaning |
|---|---|
| `out_order_id` | The order the sack was pulled for, or null for stock. |
| `out_order_source` | `queue` when the screen proposed it, `manual` when the water spider chose. |
| `out_by` | `scan` or `typed`, so the two ways in can be compared after a few weeks. |

`opened_at` stays the one timestamp for "left inventory." Everything that
already reads it — allocation, the reconcile screen, the sack page — keeps
working without a change. The sack page's ABRIR BOLSA button stays and goes
through the same code, so there is one way a sack leaves inventory.

## 7. API

Three new actions on `/api/harvest`, JSON, alongside the HTML ones:

| Action | Does |
|---|---|
| `sack_out` | Takes `sack_id` (or cultivar code + number), optional `order_id`. Marks the sack out, lays down the in-flight marker, subtracts one from Shopify, stamps the order. Returns the sack, the order, and the state: `out`, `already_out`, `voided`, `not_found`. |
| `sack_out_undo` | Reverses one `sack_out`: clears `opened_at` and the stamp, adds one back to Shopify. Refused once the sack has allocated weights. |
| `sack_out_today` | Today's sacks grouped by cultivar and order, the per-order sacks needed, and the cultivar chips. |

`handleSackOpen` is refactored so the page button and `sack_out` share one
function. The Shopify subtract uses the same in-flight marker and debt
accounting the add side now has, so a subtract that never answers shows up on
the reconcile screen instead of vanishing.

## 8. End of day

**The form (`supersack-entry.html`).** For a strain whose year is 2026 or later:

- The sack count is filled from the day's scans and is not typed.
- Submit skips the form's own Shopify subtract for that strain. The scans
  already took those sacks out.
- If floor output is entered for a 2026 strain with no scans that day, the form
  says so before submit, because that output would reach no sack.

2025 strains behave as they do today.

**The yield.** Submit runs the allocation for that day immediately, then shows:

- Yield for the scanned sacks by cultivar, zone, cut and order: tops, smalls,
  biomass, trim, waste.
- Any disagreement between sacks scanned and floor output, on screen.

The nightly cron stays as the safety net and replays the same days.

## 9. What this deliberately leaves out

- Supermarket par levels, triggers and refill projections.
- A second scan at opening.
- A minus button for untagged 2025 sacks on the scan-out screen. The end-of-day
  form already handles them. It is a small addition if the floor asks for it.

## 10. Risks worth naming

- **Day attribution.** Yield goes to the day a sack was scanned out. A sack
  scanned out late and trimmed the next morning takes the wrong day's output.
  Accepted with decision 1; the scan belongs at the moment the sack goes to the
  line.
- **Shopify counts on the way in.** On 2026-10-06 the live check showed 52 sacks
  whose add had failed or never confirmed. That was being fixed in a separate
  session. Scan-out should not go live until the reconcile screen shows no debt.
- **Cuts.** Shopify variants are per cut; floor rows and allocation are per
  (season, cultivar). Two cuts of one cultivar trimmed the same day share one
  pool of output. Not changed here; called out so nobody is surprised by it.

## 11. Build plan

Each step is test-first with `node --test`, in the style of the existing
`tests/harvest-*.test.mjs`.

- [ ] **1. Migration 0045** and `schema.sql`.
- [ ] **2. One way out.** Extract the shared open function from
      `handleSackOpen`; add the in-flight marker to the subtract. Existing
      open tests still pass.
- [ ] **3. Order proposal.** A pure function over the computed queue: given a
      cultivar, return the top-ranked open order still wanting it, or none.
- [ ] **4. `sack_out`, `sack_out_undo`, `sack_out_today`.** Tests for: good
      scan, repeat scan, voided, not found, typed cultivar + number, ambiguous
      number refused, undo, undo refused after allocation, test-mode refusing
      real sacks.
- [ ] **5. The `/salida` page.** Camera loop, vendored decoder, type mode,
      feedback, undo, today's list, offline queue. Routing test for the short
      path.
- [ ] **6. End-of-day form.** Scan-filled counts, skipped subtract, the
      no-scans warning. Playwright spec alongside the existing one.
- [ ] **7. Allocate on submit** and the yield view.
- [ ] **8. Verify on a phone** against the example sacks in test mode: scan,
      type, repeat, undo, airplane mode. Both languages, both themes.
- [ ] **9. Docs:** the harvest SOP in the wiki and the hub's tool list.

Steps 1 to 5 are the scan-out itself and can ship alone. Steps 6 and 7 must be
live before the first real 2026 sack is trimmed, or the form double-subtracts.
