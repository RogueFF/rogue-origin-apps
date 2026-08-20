# Order Blocks — Wholesale Order Board with Production Queue

**Date:** 2026-08-19
**Status:** Migrations 0014 + 0017 applied; handlers and UI not yet built
**Supersedes:** the Wholesale Orders app, retired in `611da09e` (see §2a)
**Mockups:** concepts https://claude.ai/code/artifact/25458f4e-2d62-4a37-8822-e88772e7e057 · chosen design https://claude.ai/code/artifact/f863924c-e79e-4c9e-a913-79f34fa986d0

---

## 1. The problem

> **File references in this section are to the pre-`611da09e` tree.** The
> Wholesale Orders app was retired hours after this was written (§2a); the
> paths below no longer exist. The reasoning still holds — it is why the
> replacement is shaped the way it is — but do not go hunting for the files.

The wholesale Orders app cannot express "N lbs of cultivar X."

`orders` has a single `strain` column and a `commitment_kg` scalar. Real multi-cultivar
orders are recorded in prose — the one live order, `MO-2026-001`, carries its structure in
a notes field:

> `"Main wholesale order - 140kg pallets + extras. Total 1,850kg."`

Line items *do* exist in the UI (`src/js/orders/features/shipments.js` — `createLineItemRow`,
`collectLineItems`), but they hang off a **shipment**, not an order, and are persisted as a
`JSON.stringify` blob inside `shipments.notes` (`workers/src/handlers/orders/shipments.js:79`).
That column is not queryable, not joinable, not indexable — and writing line items into it
destroys whatever shipment note was there.

Consequences today:

- You cannot ask "how many lbs of Sour Lifter are on order" in SQL.
- Nothing decrements on-hand as orders are promised. Two orders can be sold the same pounds
  and nothing notices.
- Editing an existing shipment is broken outright: the client sends `action='updateShipment'`
  (`src/js/orders/features/shipments.js:274`); the worker registers only `getShipments`,
  `saveShipment`, `deleteShipment` (`workers/src/handlers/orders/index.js:91-93`). The router
  returns `VALIDATION_ERROR: Unknown action` and `core/api.js` does not retry 4xx.
- `orders.status` is frozen at `'pending'`. The frontend never sends it; nothing advances it.

## 2. Decisions locked

| # | Decision | Rationale |
|---|---|---|
| 1 | **Manual entry now; Shopify sync later.** | No Shopify order ingestion exists anywhere in the repo. `orders.shopify_order_id` / `shopify_order_name` already exist and stay reserved; `order_items.external_line_id` is added so a future sync is idempotent without a second migration. |
| 2 | ~~Cultivar picker sourced from the product/SKU table.~~ **Superseded same day — see §2a.** Picker now reads a canonical `cultivars` table (42 entries, migration 0017). | The `products` table and `/api/barcode` were retired hours after this decision (commits `611da09e`, `56a4730e`). The reasoning that picked products over the hourly-entry list still holds and is preserved in §2a. |
| 3 | **Over-commitment is a soft warning**, never a block. | Advisory flag on the card. No allocation table, no available-to-promise math in v1. |
| 4 | **Board layout: Production Queue.** | A ranked list in the order the floor will actually run it, with a timeline. Chosen over Sorted Grid and Status Lanes. The grid falls out nearly free as a later view toggle; lanes do not, because they require a status vocabulary first. |
| 5 | **Trimming is sequenced by cultivar lot, with per-order override. Tops and smalls are joint products of one lot, not separate runs.** | See §3 — this is the load-bearing decision. Verified against 45 days of `monthly_production`. |
| 6 | **Crew size and hours/day are derived from live + trailing-7-day data**, with manual override. | Not typed per quote. See §5. |
| 7 | **"Awaiting COA" is not a status.** | Inferred from `coa_index` during design; confirmed not a real stage. Dropped from the model and the mockups. |
| 8 | **Quantities are entered in lb or kg and stored canonically in lb.** | Existing schema is kg (`commitment_kg`, `quantity_kg`); production, harvest and supersacks are all lb; two different conversion constants are already in the tree (`2.205` in `api/orders`, `2.20462` in the GAS estimator). One shared constant, one canonical unit, and the human's original entry preserved verbatim. |

## 2a. Addendum, same day: the cultivar source was retired mid-design

Between the recon that informed this document and its first commit, a parallel
session retired most of this repo's dead surface area and deployed it. Three of
those changes land directly on this design:

| Commit | What it removed | Effect here |
|---|---|---|
| `611da09e` | The Wholesale Orders UI — `src/pages/orders.html`, all of `src/js/orders/`, and every order CRUD action except `validatePassword` | §8's "add a view to the existing Orders app" is void. There is no app. This becomes a new page. |
| `f05dae17` | `getScoreboardOrderQueue` and the scoreboard panel that called it | The `estimatedHoursRemaining: 0` stub this design planned to fill no longer exists. Drop that from scope. |
| `56a4730e` | The `products` table (362 rows) and `/api/barcode` | Decision 2's source is gone. |

**None of this is a setback.** The order, customer and shipment rows all
survive — verified 1 / 2 / 23 after the cleanup — and building on a clean page
is simpler than grafting a view onto a half-finished app. Two things change:

**The picker now reads a canonical `cultivars` dimension** (migration 0017),
seeded from the `products` export in
`~/Desktop/rogue-scrub-backup/dropped-tables-2026-08-19/ops-products.json`
unioned with the distinct names in `monthly_production`. 42 canonical
cultivars, 78 aliases. This is what §11 called a required normalizer and what
§2 called "the right eventual answer, out of v1 scope" — losing `products`
simply moved it forward, and it is strictly better than the endpoint it
replaces. Resurrecting a table that was just deliberately dropped, after its
rows were exported and its readers deleted, would have been the wrong move.

**The alias map is now load-bearing, and it pays for itself immediately.**
Joining `monthly_production.cultivar1` through `cultivar_aliases` resolves 28
cultivars to real trim history. Two results worth recording:

- **Lifter** pools **7,110 trimmer-hours** across `2023 - Lifter / Sungrown`,
  `2024 - …`, `2025 - …` and `2025 - Lifter (Early Harvest) / …`. Exact-string
  matching — what `getEffectiveTargetRate` does today — sees only one of those.
- **Bubba Kush** gains **233 trimmer-hours** where it had none. The catalogue
  sells "Bubba Kush"; production only ever recorded numbered phenotypes
  (18, 59 (HT), 66, 66 (HT)). Before the merge, a sellable cultivar with real
  history would have priced off the farm-average fallback.

All six merges are listed in the migration header so they can be argued with.
Cultivars under 20 trimmer-hours are excluded from producing a rate — that
threshold currently catches Sapphire Kush, Fruity Pebbles, Golden Berries and
Critical Berries, the last of which reports an implausible 0.0% tops share on
7 hours.

A replacement `getCultivars` endpoint reading this table is now on the v1 list.


## 3. The load-bearing decision: runs, not orders

The obvious model — rank orders, chain their durations — is **wrong for this operation**, and
would have produced confident incorrect dates.

The floor does not trim an order. It trims a cultivar lot. `monthly_production` keys throughput
to `cultivar1` / `cultivar2` (one cultivar per line); `harvest_sacks.cultivar` and `bins.cultivar`
are likewise cultivar-keyed. Meanwhile a single order spans several cultivars — `MO-2026-001`
needs Sour Lifter Tops, Lifter Tops and Lifter Smalls.

So "drag order #3 above order #1 and everything below recalculates" is false as stated: an
order is not the unit that queues. Two orders sit in sequence only insofar as the *lots* they
draw on do — and an order needing three cultivars is spread across three points in that queue.

But the answer is not purely lot-based either — big orders sometimes get pulled forward as a
unit. The model must support both.

### Tops and smalls are joint products, not separate runs

A second correction, found by querying 45 days of `monthly_production` (2026-07-06 → 2026-08-19,
35 production days):

**Every row records `tops_lbs1` and `smalls_lbs1` for the same `cultivar1` and the same
`trimmers_line1`.** Tops and smalls fall out of the same trimming pass on the same material.
You do not schedule a "smalls run" — you run a cultivar lot and both forms come off it.

Measured across the window: **1.67 lb per trimmer-hour combined, 53.9% tops.** Both figures
vary by cultivar:

| Cultivar (as stored) | trimmer-hrs | lb/hr combined | tops % |
|---|---:|---:|---:|
| 2025 - Berry Bliss / Sungrown | 695 | 1.68 | 53.9% |
| 2025 - Sugar Shaker / Sungrown | 594 | 1.64 | 52.3% |
| 2025 - Skunk Candez / Sungrown | 375 | 1.88 | 52.3% |
| 2025 - Purple Frosty / Sungrown | 335 | 1.71 | 56.0% |
| 2025 - Passion Fruit OG / Sungrown | 282 | 1.53 | 53.7% |
| 2025 - Sugar Cookez (Cookies) / Sungrown | 228 | 1.25 | 50.7% |
| 2025 - Lifter / Sungrown | 110 | 1.81 | 54.6% |
| 2025 - Godfather OG / Sungrown | 98 | 1.58 | 61.4% |
| 2025 - Sour Lifter / Sungrown | 65 | 2.34 | 60.2% |
| 2025 - Strawberry Cookies / Sungrown | 34 | 2.16 | 45.4% |

Rate spans 1.25–2.34 and tops share spans 45%–61%. Neither is safe to hardcode. (Small-sample
rows under 20 trimmer-hours are excluded above and should be excluded by the engine too.)

### Model

The queue ranks **production runs**, one per **cultivar**. A run yields both forms.

- A **run** is `(cultivar, rank, scope)`. **No `form` dimension** — that was the error.
- Default state: **one pooled run per distinct cultivar** appearing in open order items,
  serving every open order needing it.
- **Lot size is driven by whichever form is binding:**
  ```
  lot_lbs = max( tops_needed / tops_fraction , smalls_needed / (1 - tops_fraction) )
  ```
  An order for 220 lb of Lifter smalls at 54.6% tops requires processing 485 lb of lot — which
  also yields 265 lb of tops against only 231 lb ordered.
- **Surplus is a real output.** The Sour Lifter run below produces 320 lb of smalls nobody
  ordered. The queue should show it: it is future inventory, and it is what makes the
  over-commit warning tractable next season.
- Override for the mixed case: **"pull forward for order X"** splits that order's demand out of
  the pooled run into a **dedicated run**, ranked independently.
- **An order's estimated finish is the max of the finish dates of every run supplying it**, and
  the card names the cultivar holding it up.

Over-commitment stays keyed on `(cultivar, form)` — demand is per form even though production
is not.

Dragging a run re-ranks it, and every downstream run plus every order fed by those runs
recalculates. That is a true statement, unlike the order-chaining version.

### Only one line is running

Checked the same 45-day window for line-2 activity: **zero rows** carry any `cultivar2`,
`trimmers_line2`, `tops_lbs2` or `smalls_lbs2` signal. All 35 production days are line 1 only.

Consequences:

- **A strictly sequential scheduler is correct today.** This resolves what was open question 2.
- The line-1-only regression in `getEffectiveTargetRate` (§5) is therefore **latent, not live** —
  it is not currently corrupting any rate. It should still be fixed, because the schema, the
  GAS original and the hourly-entry UI all support a second line, and the failure mode is a
  silent fallback to a constant rather than an error.
- If a second line is ever brought up, the scheduler needs a line dimension and the derived
  crew figure must be split per line rather than summed. Flag this before that happens.

One caveat worth recording: session notes from 2026-07-30 describe a "cell vs line" comparison
with cultivars running on both sides. No line-2 rows exist in `monthly_production` for that
date, so the cell is evidently tracked somewhere other than the `*_line2` columns. Worth
confirming before assuming line 2 is genuinely idle capacity.

## 4. Data model

> **Implemented.** `0014-order-items.sql` created these tables; `0017-cultivars.sql`
> then added the `cultivars` / `cultivar_aliases` dimension and repointed both
> tables at it, replacing the free-text `cultivar TEXT` below with
> `cultivar_id TEXT NOT NULL REFERENCES cultivars(id)`. Both are applied to
> `rogue-origin-db`. **The migration files are authoritative** — the SQL in this
> section is the original sketch, kept for the reasoning around it.

New migration `workers/migrations/0014-order-items.sql`.
(Note: `0013` is already used twice — `0013-harvest-crew-roster.sql` and
`0013-kanban-reorder-requests.sql`. `0014` is the next free number.)

```sql
CREATE TABLE IF NOT EXISTS order_items (
  id               TEXT PRIMARY KEY,
  order_id         TEXT NOT NULL,
  cultivar         TEXT NOT NULL,
  form             TEXT NOT NULL CHECK (form IN ('tops','smalls')),
  qty_lbs          REAL NOT NULL,              -- canonical
  entered_qty      REAL,                       -- what the human typed
  entered_unit     TEXT CHECK (entered_unit IN ('lb','kg')),
  unit_price       REAL DEFAULT 0,             -- per entered_unit
  sku              TEXT,                       -- from the product table, nullable
  external_line_id TEXT,                       -- reserved for Shopify sync idempotency
  sort_order       INTEGER DEFAULT 0,
  notes            TEXT,
  created_at       TEXT DEFAULT (datetime('now')),
  updated_at       TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order    ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_cultivar ON order_items(cultivar, form);

CREATE TABLE IF NOT EXISTS production_runs (
  id                 TEXT PRIMARY KEY,
  cultivar           TEXT NOT NULL,            -- no form: a run yields both
  rank               TEXT NOT NULL,            -- fractional index, not INTEGER
  dedicated_order_id TEXT,                     -- NULL = pooled run
  status             TEXT NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued','running','done')),
  created_at         TEXT DEFAULT (datetime('now')),
  updated_at         TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (dedicated_order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_runs_rank ON production_runs(rank);
```

**`order_items.sku` is reserved for Shopify, not a catalogue reference.** It
originally meant `products.sku`; that table is gone (§2a) and there is no FK to
restore. `cultivars.sku_prefix` carries the useful fragment. Treat the column as
free text a future sync may populate.

**Storing both `qty_lbs` and `entered_qty`/`entered_unit`** is deliberate. A kg order displays
in kg forever and never drifts through repeated round-trip conversion, while every query,
sum and rate calculation uses one unit.

**`rank` is TEXT, not INTEGER.** The existing `orders.priority INTEGER DEFAULT 0` cannot express
"between these two" without renumbering. Use the same fractional-indexing scheme the Kanban
tickets use (`"a0"`, `"a1"`, …).

### Required side-effects

- **Add `'order_items'` and `'production_runs'` to `VALID_TABLES` in `workers/src/lib/db.js:7`**
  or every helper query throws. This is the single easiest step to forget.
- Migrations are applied by hand — there is no `migrations_dir` in `wrangler.toml`:
  ```
  cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0014-order-items.sql
  ```

### Status vocabulary

Four vocabularies currently coexist (DB `pending`; UI badge map `Open|Partial|Fulfilled|Paid|Closed`;
scoreboard filter `completed|cancelled`; optimistic client `Open`). Proposed single set,
COA removed:

`draft` → `open` → `in_production` → `shipped` → `closed`

Written by the client on save; reconciling the other three consumers is **not** in v1 scope
beyond making the badge map read these values.

## 5. Lead-time engine

Ported from `apps-script/production-tracking/Code.gs` — `addWorkHours` (:2230) and
`calculateLeadTimeEstimator` (:2346). `addWorkHours` is pure JS with no `SpreadsheetApp`
dependency and encodes the real calendar: Sunday off, Saturday ends 12:00, weekdays
07:00–16:30, four break windows. It ports verbatim.

```
lot_lbs      = max( tops_needed / tops_frac , smalls_needed / (1 - tops_frac) )
run_hours    = lot_lbs / (combined_rate × crew)
run_finish   = addWorkHours(previous_run_finish, run_hours)
order_finish = max(run_finish) over all runs supplying the order
```

### Rate — two changes to `getEffectiveTargetRate`

`getEffectiveTargetRate` (`workers/src/lib/production-utils.js:142`) needs to return **two**
numbers per cultivar, not one:

1. **Combined throughput** — `(tops_lbs + smalls_lbs) / trimmer_hours`. It currently divides
   `tops_lbs1` alone by trimmer-hours, which understates real throughput by roughly the smalls
   share (~46%) and cannot size a lot at all.
2. **Tops fraction** — `tops_lbs / (tops_lbs + smalls_lbs)`. New; nothing computes this today,
   and without it the binding-form calculation above is impossible.

Prefer `effective_trimmers_line1` (already weighted for mid-hour crew changes) over the raw
count. Exclude cultivars under ~20 trimmer-hours of history from producing a rate — the
thinnest rows in the table are the noisiest.

Two existing defects in the same function:

- **Line 1 only** (`tops_lbs1`, `trimmers_line1`, `WHERE cultivar1 = ?`). Currently latent —
  no line-2 data exists — but the GAS original reads both lines and the failure mode is a
  silent fallback rather than an error. Fix while in there.
- **The `days = 7` parameter is dead.** The query has no date cutoff despite the signature, so
  callers passing `2` or `7` get the full history regardless. Either honor it or remove it;
  leaving a lying parameter in the signature of the function every date depends on is not
  acceptable.

**Fallback behaviour matters more than usual here.** Cultivars with no history fall back to a
baseline — and that is not a rare edge case: `Alium OG` and `Sour Brulee` both have live SKUs,
both are sellable, and neither appears in `monthly_production` at all. The baseline must be
restated in combined terms (measured farm-wide average: **1.67 lb/trimmer-hour, 53.9% tops**),
not the current tops-only `0.85`, and **the UI must mark any run priced off the fallback**, so
nobody reads an estimate for a never-trimmed cultivar as carrying the same weight as one for
Berry Bliss.

### Crew — derived, not typed

Crew size and hours/day come from live plus trailing-7-production-day data, with a manual
override on the board. Measured for 2026-08-19: **8.7 trimmers, 9.3 h/day** — note this is well
above the GAS estimator's `6` / `8.5` defaults, and day-to-day crew ranged 3.8 to 12.3 across
that week, which is exactly why it should be derived rather than typed once.

- Prefer `effective_trimmers_line1` / `_line2` over the raw `trimmers_line*` counts.
- Average across the trailing 7 **production** days (skip days with no rows), not 7 calendar days.
- If a shift is open today, weight today's live crew into the figure.
- Surface the derived number in the board header as an editable control, so the assumption every
  date rests on is visible and overridable.

### Honesty constraints

The engine models **trim time only**. It cannot see:

- **Forward capacity** — `shift_adjustments` rejects any date but today by explicit validation,
  and encodes hours into a free-text `reason` string by regex. There is no planned-staffing or
  holiday table. A trailing average is not a forward commitment.
- **Drying** — `DRY_DAYS_TYPICAL = 10` in `harvest-d1.js` is commented as advisory. Field-to-finished
  cannot be computed; only raw-sack-to-finished-bag can.
- **Packaging, COA turnaround, freight.**

The UI must therefore label output as an estimate, and the caption on the board says so
explicitly. Do not render these as ship dates.

## 6. Over-commit warning

```
committed(cultivar, form) = Σ qty_lbs over order_items on orders with status IN ('open','in_production')
on_hand(cultivar, form)   = finished inventory from inventory_adjustments (latest per (sku, location))
                            + bin_balances where applicable
```

Flag when `committed > on_hand`. The label must say what it actually means — *committed exceeds
finished inventory on hand* — not "cannot fill", because unharvested and undried material is
deliberately not counted.

Note for whoever implements the read: `inventory_adjustments` must be read as
**latest-per-`(sku, location)`**, not latest-per-`sku`.

## 7. API surface

One new module `workers/src/handlers/orders/items.js`, plus `queue.js`. No new routes — these
are actions on the existing `/api/orders` router. Each needs an entry in the action map
(`workers/src/handlers/orders/index.js:91`) and every write action must also be added to the
`ORDERS_WRITE_ACTIONS` set (line 66) or it will not be auth-gated.

| Action | Purpose |
|---|---|
| `getOrderItems` | Items for one order, or all open orders |
| `saveOrderItems` | Upsert the full item set for an order (replace-in-transaction) |
| `deleteOrderItem` | Remove one line |
| `getProductionQueue` | Runs in rank order, with computed hours, finish dates, and the orders each feeds |
| `reorderRun` | Set a run's fractional rank |
| `splitRunForOrder` | Pull an order's demand out of a pooled run into a dedicated one |
| `getOverCommitment` | `(cultivar, form)` rows where committed exceeds on-hand |

**Also fix:** register `updateShipment`, or change `src/js/orders/features/shipments.js:274`
to always send `saveShipment` (which already upserts on optional `id`). One line either way.
"Editable" is the core ask and this path is currently dead.

## 8. Front end

New view inside the existing Orders app — **not** a new page. A new page would need nav edits
across every sidebar, a `commandPaletteItems` entry (`src/js/modules/index.js` ~:664), and a
`STATIC_ASSETS` addition plus `CACHE_VERSION` bump in `sw.js`. A view needs none of that, and
avoids creating a second source of truth for orders alongside customers, payments, shipments,
COAs and the scoreboard queue.

- `src/js/orders/ui/queue.js` — ranked run rows with the timeline bars.
- `src/js/orders/ui/blocks.js` — the order card (also reusable as the later grid view).
- Cultivar `<select>` fed from `GET /api/barcode?action=products`, replacing the free-text
  `<input list="strains-list">` at `src/pages/orders.html:771` — 8 hardcoded names, 4 of which
  exist in neither live cultivar list.
- Reuse `openDetailPanel` (`src/js/orders/features/detail-panel.js`) verbatim for click-in.
- Use `makeApi('orders')` from `src/js/shared/api.js`, not the legacy `src/js/orders/core/api.js`.
- Repo requirements: bilingual EN/ES via `src/js/shared/i18n.js`; 44 px touch targets; tokens
  from `src/css/shared-base.css`.

Drag: the repo has two incompatible idioms — Muuri on the dashboard (localStorage only) and
native HTML5 DnD in `mc-v2/src/views/Tasks.tsx` (server-persisted). Use the native HTML5
approach; it already persists to a server and carries no library weight.

## 9. Scope

**In v1**
- `order_items` + `production_runs` migration, `VALID_TABLES` update
- Item CRUD actions and the queue actions above
- ~~Fix the `updateShipment` action mismatch~~ — moot, that handler was deleted (`611da09e`)
- Rework `getEffectiveTargetRate` to return combined throughput + tops fraction per cultivar;
  fix the line-1-only read and the dead `days` parameter; restate the fallback in combined terms
  and mark fallback-priced runs in the UI
- Port `addWorkHours` + the estimator into the worker
- Derived crew with visible override
- Queue view with drag-to-rank and recalculating finish dates; surplus byproduct shown per run
- Order cards with real line items and per-order estimated finish
- Cultivar picker from the `cultivars` table, plus a replacement `getCultivars` endpoint
  (the old `/api/barcode?action=products` is gone)
- Soft over-commit flag
- Migrate `MO-2026-001` (one record) from its notes field into real line items

**Explicitly not in v1**
- Backfilling `shipments.notes` JSON into `order_items` — hoisting shipment items up to the
  order is lossy. Let both coexist; shipments keep their own items.
- Allocation / available-to-promise / hard blocking
- Retail (1 oz) orders and any Shopify order ingestion
- Status lanes and the sorted-grid view (both cheap to add later on this foundation)
- Reconciling the scoreboard and payment status vocabularies
- Drying, packaging, COA and freight in the lead-time model
- The unauthenticated `get*` reads and the `payment_shipment_links.amount` bug

## 10. Open questions

1. **Which statuses does the floor actually use, and what happens to `'pending'`?** *Blocks the
   first handler.* §4 proposes `draft → open → in_production → shipped → closed`, and §6's
   over-commit query filters `status IN ('open','in_production')`. But the one live row,
   `MO-2026-001`, is still `'pending'` — the only value the retired frontend ever wrote — and
   `orders.status` carries no CHECK constraint. So the first `getProductionQueue` and
   `getOverCommitment` will return **zero rows against real data and look correct doing it**.
   Pick one before writing either handler:
   (a) migration 0018 backfills `pending → open` and adds the CHECK — note this means recreating
   `orders`, which has FK dependents in `shipments`, `payments`, `order_items` and
   `production_runs`;
   (b) handlers treat `'pending'` as a synonym for `'open'` and the CHECK waits.
   Having neither is the trap.
2. ~~Do the two lines run in parallel?~~ **Resolved** — zero line-2 activity in 45 days;
   sequential is correct. Re-open if a second line is brought up. See §3.
3. **Should `getScoreboardOrderQueue`'s `estimatedHoursRemaining`** (currently hardcoded `0` in
   `workers/src/handlers/orders/scoreboard-queue.js`) be filled from the same engine? No API
   shape change required — it looks like a stub left for exactly this.

## 11. Risks

- **Cultivar join keys do not match across tables.** `monthly_production.cultivar1` holds
  `"2025 - Sour Lifter / Sungrown"`; `harvest_sacks.cultivar` and `bins.cultivar` hold bare
  names; `products.sku` holds `SLIFT-…`. There is no dimension table and no shared normalizer.
  Today's workaround is bidirectional substring matching (`workers/src/handlers/orders/coa.js:98`),
  which silently counts "Sour Lifter" toward "Lifter". **A shared normalizer is required for the
  rate lookup to be correct** — without it, rates attach to the wrong cultivar. A full canonical
  cultivar table is the right eventual answer and is out of v1 scope, but the normalizer is not
  optional.
- **Deploy drift.** Check `git rev-list --left-right --count master...origin/master` before
  deploying. The API worker ships from `workers/` via `npx wrangler deploy`; the root
  `npm run deploy` ships the wrong thing. Front end is GitHub Pages from `master` — two separate
  deploys, ordered so the front end tolerates both worker versions.
- **Estimates read as promises.** The largest non-technical risk. If a number on this board gets
  quoted to a buyer as a ship date, the feature has done harm. The caption is load-bearing.
