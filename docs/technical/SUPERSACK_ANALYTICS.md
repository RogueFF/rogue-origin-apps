# Supersack Analytics — Architecture & Formulas

> How every number on the Supersack dashboard is produced — from a sack of raw
> material on the floor to the percentages, rates, and projections on screen.
>
> **Layered doc:** each section opens in plain English, then drops into the exact
> SQL / formulas for engineers. Skim the bold summaries; dig into the tables when
> you need the math.
>
> **Companion doc:** [`SUPERSACK_TOPS_REMAINING.md`](./SUPERSACK_TOPS_REMAINING.md)
> covers the public "finished tops remaining" API endpoint in depth.

---

## 1. What this system tracks

Rogue Origin buys hemp biomass packed in **supersacks** and processes each sack
into graded outputs: **tops** (premium flower), **smalls** (lower-grade flower),
**biomass**, **trim**, and **waste**. The analytics system answers questions like:

- How many sacks are we opening per day, and is the pace steady?
- What fraction of raw material becomes salable flower, by strain?
- How fast do we produce (lbs/hour, lbs/trimmer)?
- How much raw inventory is left, and how long will it last?

**Pages & endpoints involved:**

| Piece | File | Role |
|---|---|---|
| Analytics dashboard | `src/pages/supersack-analytics.html` | Charts, KPIs, projections |
| Data-entry tracker | `src/pages/supersack-entry.html` | Logs each day's sacks + weights |
| Analytics API | `workers/src/handlers/supersack-d1.js` | `summary`, `history`, `tops_remaining` |
| Inventory proxy | `workers/src/handlers/pool.js` | Current Shopify sack counts |
| Data-quality cron | `workers/src/handlers/supersack-qa.js` | Weekly anomaly check (Telegram) |

---

## 2. The core unit and data model

**Plain English:** Everything is anchored to one assumption — **a supersack holds
~37 lbs of raw material.** Raw input is never weighed directly; it's inferred as
`sacks × 37`. Tops and smalls are weighed per strain; biomass and trim are weighed
per day (and sometimes per strain). Waste is whatever's left over to balance.

**Table:** `supersack_entries` (Cloudflare D1) — one row per `(date, strain)`:

| Column | Meaning |
|---|---|
| `date`, `strain` | Composite key (one row per strain per day) |
| `sacks_opened` | Sacks opened that day for that strain |
| `raw_lbs` | **Derived:** `sacks_opened × 37` |
| `tops_lbs`, `smalls_lbs` | Weighed finished flower (entered per strain) |
| `biomass_lbs`, `trim_lbs` | Weighed by-products |
| `waste_lbs` | **Derived:** `max(0, raw − tops − smalls − biomass − trim)` |

```js
const SACK_WEIGHT = 37;            // workers/src/handlers/supersack-d1.js
raw_lbs   = sacks_opened * SACK_WEIGHT;
waste_lbs = Math.max(0, raw_lbs - tops_lbs - smalls_lbs - biomass_lbs - trim_lbs);
```

**Per-strain vs. day-total entry.** The tracker can submit tops/smalls/biomass/trim
**per strain** (exact), or submit day-totals that get **split across strains by
sack-count ratio** (`strainShare = sacks / totalDaySacks`). Tops and smalls are
normally exact; biomass and trim are often ratio-split, so per-strain biomass/trim
are approximations on multi-strain days.

---

## 3. Data flow

```
                 ┌─────────────────────────┐
  Floor crew  →  │ supersack-entry.html    │
                 └───────────┬─────────────┘
                             │ POST submit (per-strain weights)
                             ▼
   POST update_* ┌─────────────────────────┐   reads/writes counts
  (decrement     │ Cloudflare Worker API   │ ───────────────────────►  Shopify
   Shopify) ◄────│ /api/supersack /api/pool│   (via GAS proxy)         (sack inventory)
                 └───────────┬─────────────┘
                             │ INSERT/UPDATE
                             ▼
                 ┌─────────────────────────┐
                 │ D1: supersack_entries   │  (history + yield rates)
                 └───────────┬─────────────┘
                             │ summary / history
                             ▼
                 ┌─────────────────────────┐
                 │ supersack-analytics.html│  ← also reads /api/production
                 └─────────────────────────┘     (crew, labor, cost)
```

- **Writing:** the tracker logs weights to D1 **and** decrements the matching
  Shopify supersack variant (so "raw inventory" stays current).
- **Reading:** the dashboard pulls yield/history from D1 (`/api/supersack`), live
  inventory from Shopify (`/api/pool`), and crew/labor from `/api/production`.
- *GAS (in the diagram above) = Google Apps Script — the existing proxy that fronts Shopify.*

---

## 4. The "clean data" rule (`complete=true`)

**Plain English:** A row is only trustworthy if both by-product weights were
entered **and** the outputs roughly balance against raw input. Rows that fail are
**silently excluded** from analytics so a missed weight doesn't distort rates.

**The filter** (applied by `summary` and `history` when `complete=true`):

```sql
biomass_lbs > 0
AND trim_lbs  > 0
AND (tops_lbs + smalls_lbs + biomass_lbs + trim_lbs) <= raw_lbs * 1.3
```

- `biomass=0 OR trim=0` → a weight was missed → drop the row.
- outputs `> 1.3 × raw` → impossible material balance (usually a multi-strain day
  where day-total biomass/trim got over-attributed to a low-sack strain) → drop.

The dashboard always requests `complete=true`. The weekly QA cron
(`supersack-qa.js`) reports rows caught by these two checks to Telegram so the
water spider (the floor materials runner) can re-enter them on the tracker
(`supersack-entry.html`).

> ⚠️ The filter does **not** catch a row with `tops=0 AND smalls=0` (a flower-less
> run). Those still pass and slightly drag down per-sack yield averages.

---

## 5. How each number is computed

The `summary` endpoint returns two arrays — `periods` (grouped by day/week/month)
and `strains` (per-strain totals across the range). Each `total_*` is a `SUM`;
`days_worked = COUNT(DISTINCT date)`. One per-strain field needs explaining:

**`effective_days_worked`** — weights each day by that strain's share of the day's
sacks, so a strain that only ran half a day counts as 0.5, not 1.0:

```sql
SUM( CAST(sacks_opened AS REAL) / day_total )   -- day_total = all strains' sacks that day
```

This is the basis for "if we ran this strain full-time, how fast would we burn it?"

### 5a. KPI cards

| KPI | Formula |
|---|---|
| Total Sacks | `Σ period.total_sacks` |
| Avg / Day | `totalSacks ÷ daysWorked` (days with sacks > 0) |
| Raw Processed | `Σ period.total_raw` (= total sacks × 37) |
| Avg Tops Yield % | `Σ total_tops ÷ Σ total_raw × 100` |

### 5b. Yield composition (stacked-to-100% bar)

Per day, each category as a percent of that day's raw:
`category_pct = category_lbs ÷ total_raw × 100` (tops + smalls + biomass + trim +
waste). Tooltips also show the raw lbs.

### 5c. Strain comparison (horizontal bars)

Per strain, across the whole range:
`tops% = total_tops ÷ total_raw × 100` (and the same for smalls %, waste %).

### 5d. Production rate (lbs/hr)

**Assumes a 7.5-hour effective workday** (`HOURS_PER_DAY = 7.5`):
`tops_per_hr = day_tops_lbs ÷ 7.5` (and smalls likewise), plotted per day.

### 5e. Supersacks per operator

Combines supersack sacks/day with crew counts from `/api/production`:

```
crewPerDay  = avg over active hour-slots of
              (effTrimmers1 + effTrimmers2 + buckers1 + buckers2)
sacksPerOp  = sacksThatDay ÷ crewPerDay
```
`effTrimmers*` uses time-weighted crew counts (`effectiveTrimmers1/2`) when a
crew size changed mid-hour, falling back to the raw count.

### 5f. Inventory & depletion projections

Combines live Shopify counts with per-strain rates from D1:

| Number | Formula |
|---|---|
| Per-strain daily burn | `strainUsage = total_sacks ÷ effective_days_worked` |
| Days supply (per strain) | `round(inventory_qty ÷ strainUsage)` |
| Total daily throughput | `Σ all-strain sacks ÷ daysWorked` (shared line time — **not** the sum of per-strain rates, which would double-count) |
| Total days left | `round(totalInventory ÷ totalDailyThroughput)` |
| Projected tops (per strain) | `inventory_qty × (total_tops ÷ total_sacks)` |
| Projected smalls (per strain) | `inventory_qty × (total_smalls ÷ total_sacks)` |
| Depletion date | `today + daysLeft` |

- **Thin-sample badge** appears when a strain has `< 10` sacks of clean data
  (`MIN_SACKS_FOR_PREDICTION`) — projection is directional, not predictive.
- Depletion bar color: `< 7 days` red, `< 21` gold, else green.

### 5g. Labor & cost metrics

Inputs come from `/api/production` (the production-tracking subsystem), **not** from
`supersack_entries`. Summed across the range:

| Metric | Formula |
|---|---|
| Tops / Hr | `totalTops ÷ totalOperatorHours` |
| Smalls / Hr | `totalSmalls ÷ totalOperatorHours` |
| Avg trimmers | `(totalTrimmerHours ÷ 7.5) ÷ daysWorked` |
| Tops / Trimmer | `totalTops ÷ avgTrimmers ÷ daysWorked` |
| Cost / Tops Lb | `totalTopsLaborCost ÷ totalTops` |
| Tops Labor $ | `Σ (day.topsCostPerLb × day.totalTops)` |

---

## 6. Finished tops remaining (public endpoint)

`GET /api/supersack?action=tops_remaining` projects how many pounds of finished
**tops** the *current raw inventory* will yield — for a public website widget. It
multiplies each cultivar's live Shopify sack count by its measured tops/sack
(from clean D1 history), using a conservative floor for cultivars without
trustworthy data.

**Full details:** [`SUPERSACK_TOPS_REMAINING.md`](./SUPERSACK_TOPS_REMAINING.md).

---

## 7. Caveats & data quality

- **37 lbs/sack is an assumption.** Real sacks vary; that's why per-strain output
  percentages rarely sum to exactly 100%. A sum of **95–115%** looks healthy; the
  analytics exclusion filter (§4) is deliberately looser, dropping rows only above
  **130%**, so it removes clearly-broken rows without discarding normal drift.
  Large drift may signal real sack-weight variation worth investigating.
- **Multi-strain attribution.** Day-total biomass/trim split by sack ratio makes
  per-strain biomass/trim approximate; tops and smalls are exact.
- **Thin samples.** Strains under 10 clean sacks carry real sampling noise.
- **Silent exclusions.** Missing-weight and over-attributed rows are dropped from
  analytics (see §4) and reported weekly by the QA cron.
- **Flower-less rows** (`tops=0 AND smalls=0`) currently pass the clean filter.

---

## 8. Source of truth

| Topic | Location |
|---|---|
| Table schema | `workers/schema.sql` (`supersack_entries`) |
| Submit / summary / history logic | `workers/src/handlers/supersack-d1.js` |
| Clean filter + QA | `supersack-d1.js`, `supersack-qa.js` |
| Dashboard formulas | `src/pages/supersack-analytics.html` |
| Inventory proxy | `workers/src/handlers/pool.js` |
| Endpoint design rationale | `docs/plans/2026-05-27-supersack-tops-remaining-api-design.md` |
