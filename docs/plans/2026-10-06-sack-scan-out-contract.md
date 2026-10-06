# Sack scan-out — build contract

The fixed interface between the three parallel build tracks. Design and
reasoning: `2026-10-06-sack-scan-out-design.md`. If something here turns out to
be wrong or impossible, STOP and report it — do not quietly deviate, because
another agent is building against the same words.

Worktree: `C:\Users\Koasm\Desktop\Dev\roa-scan-out` (branch `feat/sack-scan-out`).
**Never** touch `C:\Users\Koasm\Desktop\Dev\rogue-origin-apps` — that is a
different, stale checkout holding someone else's uncommitted work.

## Ground rules for every agent

- Edit only the files in your scope. Other agents are editing the rest right now.
- No `git commit`, `git push`, `git stash`, `git checkout`, branch changes.
- No `wrangler deploy`, no D1 `--remote` commands, no POSTs to the live API
  (`rogue-origin-api.roguefamilyfarms.workers.dev`). Read-only GETs are fine.
- Test-first with `node --test tests/<your file>.test.mjs`. Follow the harness
  in `tests/harvest-inventory-honesty.test.mjs` (node:sqlite, real migrations,
  stubbed `globalThis.fetch` for the pool API).
- Baseline before this work: `npm test` = 848 tests, 3 failing, all
  pre-existing: two fail on a missing `@playwright/test` package
  (`harvest-one-crew`, `harvest-practice`), one in `harvest-racks`
  ("a real tag carries no example band"). Do not fix or touch those. You must
  not add a fourth.
- Match the codebase's voice: comments explain WHY, crew text is Spanish first
  with English, all crew strings go through `ui.t()` / the i18n tables.
- Report back: files changed, the exact test command and its tail output, every
  deviation from this contract, and anything you could not verify.

## Data — migration `workers/migrations/0045-harvest-sacks-scan-out.sql`

```sql
ALTER TABLE harvest_sacks ADD COLUMN out_order_id TEXT;      -- orders.id, NULL = stock
ALTER TABLE harvest_sacks ADD COLUMN out_order_source TEXT;  -- 'queue' | 'manual' | NULL
ALTER TABLE harvest_sacks ADD COLUMN out_by TEXT;            -- 'scan' | 'typed' | 'page'
```

`opened_at` remains THE timestamp for "left inventory". `out_by = 'page'` is the
existing ABRIR BOLSA button on `/s/<id>`.

## API — all on `/api/harvest?action=…`, JSON in, JSON out

Responses use the existing `successResponse` wrapper. Errors that are ordinary
floor outcomes (already out, not found) are **200 with a `state`**, not HTTP
errors — the page shows them as coloured feedback, not as faults.

### `POST sack_out`

Body:
```json
{ "q": "<scanned text or typed id>", "code": "SLIFT", "number": 151,
  "by": "scan" | "typed", "order_id": "<orders.id>" | "stock" | null }
```
- `q` may be a full tag URL (`https://…/s/26-SLIFT-151`), a bare id
  (`26-SLIFT-151`), or shorthand the existing `normalizeSackId` accepts.
- `code` + `number` is the typed path: cultivar code chip plus bag number.
- `order_id` omitted/null → the server proposes from the queue.

Response:
```json
{ "success": true,
  "state": "out" | "already_out" | "voided" | "not_found" | "ambiguous" | "not_a_tag",
  "sack": { "sack_id": "26-SLIFT-151", "serial": 151, "season": 2026,
            "cultivar": "Sour Lifter", "cultivar_code": "SLIFT",
            "zone": "Z16", "cut_number": 1, "opened_at": "2026-10-06 16:42:10",
            "out_by": "scan" },
  "order": { "id": "…", "nickname": "Miami", "shopify_order_name": "#35188",
             "source": "queue" | "manual" } | null,
  "order_options": [ { "id": "…", "nickname": "…", "shopify_order_name": "…",
                       "sacks_needed": 14 } ],
  "candidates": [ { "sack_id": "…", "cultivar": "…", "serial": 151 } ],
  "undo_until": "2026-10-06T16:43:10Z" }
```
- `sack` is null for `not_found` / `not_a_tag` / `ambiguous`.
- `candidates` only for `ambiguous` (a bare number matching several cultivars).
- `order_options` = every open order still wanting this cultivar, queue order,
  so the page can offer the one-tap change. Always present (may be empty).
- **Idempotent.** A repeat for a sack already out returns `already_out` with the
  sack and its stamped order, and changes nothing — no second Shopify subtract.
  This is what makes the page's offline retry safe.

### `POST sack_out_assign`
Body `{ "sack_id": "…", "order_id": "<id>" | "stock" }`. Re-stamps the order
(`out_order_source = 'manual'`). Only for a sack that is out. Returns the same
`sack` + `order` shape. No Shopify call.

### `POST sack_out_undo`
Body `{ "sack_id": "…" }`. Puts the sack back: clears `opened_at`, `out_*`, and
returns the one to Shopify. Response `{ success, state: "undone" | "not_out" |
"too_late", sack }`. `too_late` once the sack carries allocated or measured
weights. The Shopify reversal must be honest about the three states the
subtract can be in (counted / failed / in flight) — see
`workers/src/lib/inventory-debt.js` — and never add back a one that was never
taken off.

### `GET sack_out_today` (optional `?date=YYYY-MM-DD`, Pacific day)
```json
{ "success": true, "date": "2026-10-06", "is_test": false,
  "total": 8,
  "groups": [ { "season": 2026, "cultivar": "Sour Lifter", "cultivar_code": "SLIFT",
                "order": { "id": "…", "nickname": "Miami", "shopify_order_name": "#35188" } | null,
                "sacks_today": 6, "sacks_needed": 14,
                "sacks": [ { "sack_id": "26-SLIFT-151", "serial": 151, "zone": "Z16",
                             "cut_number": 1, "opened_at": "…", "out_by": "scan" } ] } ],
  "chips": [ { "code": "SLIFT", "cultivar": "Sour Lifter", "in_inventory": 148 } ],
  "by_strain": [ { "season": 2026, "cultivar": "Sour Lifter", "sacks": 6,
                   "strain_titles": ["2026 - Sour Lifter / Sungrown / 1st Cut"] } ] }
```
- `sacks_needed` is the queue's existing `sacksNeeded` for that order's pass of
  that cultivar; null when there is no order or no usable rate.
- `chips` = cultivars with tagged, unopened, un-voided sacks this season.
- `by_strain` is for the end-of-day form: scanned sack counts per
  (season, cultivar) with the floor strain titles that alias to it.

### `GET salida` (HTML) — short paths `/salida` and `/out`
Rendered through the existing `renderPage`, body from
`salidaPageBody(ui, boot)` exported by
`workers/src/handlers/harvest-salida-page.js`.

`boot` = `{ api: "/api/harvest", lang: "es"|"en", is_test: bool,
today: <the sack_out_today payload> }`.

## End-of-day — on `/api/supersack?action=…`

### `GET scanned_day&date=YYYY-MM-DD`
Returns the `by_strain` array above for that day (same shape), so the form can
fill 2026 sack counts.

### `POST day_yield` body `{ "date": "YYYY-MM-DD" }`
Runs the allocation for that day (`handleAllocate`, exported from
`harvest-d1.js`) and returns the per-sack result grouped for display:
```json
{ "success": true, "date": "…",
  "groups": [ { "season": 2026, "cultivar": "Sour Lifter", "zone": "Z16", "cut_number": 1,
                "order": { "id": "…", "nickname": "Miami" } | null,
                "sacks": 6, "tops": 0, "smalls": 0, "biomass": 0, "trim": 0, "waste": 0 } ],
  "mismatches": [ … handleAllocate's sack_count_mismatches … ],
  "unallocated": [ … floor output with no scanned sacks, and scanned sacks with no floor output … ] }
```

## File ownership

| Track | Owns |
|---|---|
| **A — scan-out core** | `workers/migrations/0045-*.sql`, `workers/schema.sql`, `workers/src/handlers/harvest-d1.js`, `workers/src/handlers/harvest-sack-out.js` (new), `workers/src/lib/sack-out.js` (new), `workers/src/lib/supersack-inventory.js`, `workers/src/lib/inventory-debt.js`, `workers/src/handlers/wholesale-d1.js` (exports only), `workers/src/index.js`, `workers/src/lib/i18n.js` server strings for its own messages, `tests/harvest-sack-out*.test.mjs` |
| **B — the /salida page** | `workers/src/handlers/harvest-salida-page.js`, `workers/src/handlers/harvest-salida-*.js` (new), `workers/src/vendor/**` (new), `tests/harvest-salida*.test.mjs` |
| **C — end of day** | `src/pages/supersack-entry.html`, `workers/src/handlers/supersack-d1.js`, `workers/src/handlers/supersack-day-yield.js` (new), `tests/supersack-day*.test.mjs`, `tests/supersack-entry*.spec.js` |

Track B needs page strings: keep them in a table inside its own files rather
than editing the shared i18n module.

Track C reads `harvest_sacks` directly for `scanned_day` (it must not wait for
Track A's endpoint), using the same definition: `opened_at` inside the Pacific
day, `is_test` matching the mode, `voided_at IS NULL`.
