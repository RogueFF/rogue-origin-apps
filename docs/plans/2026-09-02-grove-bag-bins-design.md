# Grove Bag Bins — Design

**Date:** 2026-09-02
**Status:** Design approved by Koa (2026-09-02), not yet built.
**Builds on:** `2026-08-10-grove-reorder-alert-design.md` (the scan → email → "mark as ordered" loop, live since 2026-08-11).

Grove custom-printed bags carry a **2,500 MOQ per size** and a **2–2.5 month lead**.
The supply kanban today has no count for them at all: the three custom cards read
`orderQty: CUSTOM` / `orderWhen: Green Card Signal`, so the reorder alert fires
when someone *notices* the rack is low — which, against a 75-day lead, is already
too late. This design gives each Grove size an on-hand count, a burn rate, and a
computed order-by date, with the count kept by the crew scanning a card each time
they open a bin of bags.

## 1. Decisions

| Question | Decision | Why |
|---|---|---|
| Where does the count come from | **Scan a card when a bin is opened** | Every channel consumes bags (Shopify, wholesale, consignment, waste); sales-driven counting only sees Shopify. The crew already scans kanban QRs. Scan timestamps give the burn rate for free. |
| Bin size | **~200 bags, hand-split on receipt** | ±1 bin of accuracy is fine against a 2,500 MOQ. Per-card config, not a constant. |
| MOQ scope | **Per size** (confirmed by Koa) | Sizes reorder independently; no cross-size batching logic. |
| Card stock | **Full-sheet 8.5×11 cards**, same as today's kanban cards | Koa's call. Readable across the room. 13 pages per order is acceptable. |
| Trigger | **On scan**, reusing `raiseReorderRequest` | One dedup rule (the partial unique index), one email path, one "mark as ordered" link. |
| Visibility | Grove panel on `kanban.html`, Ops Hub tile, the trigger email | All three read one new `getBagStatus` action. |
| Seed usage rate | **Shopify winter run rate** until 3 bins have been scanned | Computed 2026-09-02 from the 2025-11-12 → 2026-02-04 daily export (see §4). |
| Scan target | **Short worker route `/k/<token>`** | Same lesson as `/s/`, `/b`, `/z/`: short URL → low-version QR. No `kanban.html` load on the phone. |
| Corrections | **Void a bin / receive bins**, no free-text count | A count field drifts; bins are physical and auditable. |

## 2. Flow

```
RECEIVE   panel → Receive {cardId, bags, bagsPerBin, lot}
            → INSERT N bins (last one partial), status='sealed', token each
            → print N full-sheet cards (one per bin) from kanban.html

OPEN      crew scans card → GET /k/<token> → tiny page → POST ?action=openBin {token}
            → bin.status 'sealed' → 'opened' (idempotent: re-scan reports "opened <date>")
            → recompute status for that card
            → if onHand <= reorderPoint AND no open request → raiseReorderRequest(card, extras)
            → phone shows: "1 oz · 9 bins left · ~7 wk cover"

VOID      panel → Void {binId, reason}   (damaged / lost / miscount)

ORDERED   Damon taps "Mark as ordered" (unchanged) → status 'ordered'
            → NEW: also INSERT kanban_orders row {vendor:'Grove', items:[{cardId,item,qty}]}
              so Grove cards stop reading orderCount: 0 in analytics
```

The opened bin counts as **zero** on-hand. Conservative by up to one bin, and it
means the number on the screen never overstates what is sealed on the rack.

## 3. Data model — migration `0027-kanban-bins.sql`

Nothing is added to `kanban_cards`: `updateCard` is a full-row overwrite
(every column defaulted to empty) and would blank any new column on the next edit.

```sql
CREATE TABLE IF NOT EXISTS kanban_bin_config (
  card_id          INTEGER PRIMARY KEY,
  bags_per_bin     INTEGER NOT NULL DEFAULT 200,
  lead_days        INTEGER NOT NULL DEFAULT 75,
  safety_days      INTEGER NOT NULL DEFAULT 30,
  moq              INTEGER NOT NULL DEFAULT 2500,
  seed_per_month   REAL    NOT NULL,            -- used until >= 3 bins opened
  updated_at       TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (card_id) REFERENCES kanban_cards(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS kanban_bins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id       INTEGER NOT NULL,
  bin_no        INTEGER NOT NULL,                -- 1..N within a lot
  lot           TEXT,                            -- Grove order ref / received batch label
  bag_count     INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'sealed',  -- sealed | opened | void
  token         TEXT NOT NULL,                   -- 10 chars, base32, in the QR
  received_at   TEXT DEFAULT (datetime('now')),
  opened_at     TEXT,
  opened_by     TEXT,
  void_reason   TEXT,
  FOREIGN KEY (card_id) REFERENCES kanban_cards(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_token ON kanban_bins(token);
CREATE INDEX IF NOT EXISTS idx_kb_card_status ON kanban_bins(card_id, status);
CREATE INDEX IF NOT EXISTS idx_kb_opened ON kanban_bins(card_id, opened_at);
```

Migration numbering collides across parallel tracks (three 0017s); 0027 is the
next free number as of this date. Apply by hand with
`npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0027-kanban-bins.sql`
(no `migrations_dir` in wrangler.toml).

## 4. The math (pure, unit-tested: `workers/src/lib/bag-math.js`)

```
onHand        = sum of bag_count WHERE status='sealed'
ratePerDay    = openedBins(last 56 days) >= 3
                  ? sum of bag_count(opened, last 56 d) / 56
                  : seed_per_month / 30.4
leadDemand    = ratePerDay * lead_days
reorderPoint  = ratePerDay * (lead_days + safety_days)
runOutDate    = today + onHand / ratePerDay
orderByDate   = today + (onHand - leadDemand) / ratePerDay     (may be in the past)
suggestedQty  = max(moq, ceil(ratePerDay * 120 / 100) * 100)   — MOQ or ~4 months, whichever is larger
status        = onHand <= reorderPoint ? 'order' : orderBy within 14 d ? 'soon' : 'ok'
```

`getBagStatus` returns this per card, plus `binsSealed`, `binsOpened`, the open
reorder request if any, and `rateSource: 'scans' | 'seed'`.

**Seed rates** (units sold per month, Shopify daily export 2025-11-12 → 2026-02-04,
flower SKUs only; November includes Black Friday and ran ~1,000 one-ounce):

| Card | Size | seed/mo | lead | reorder point | ≈ bins | MOQ covers |
|---|---|--:|--:|--:|--:|--:|
| 21 | Custom 1 oz | 600 | 75 d | 2,100 | 11 | ~4 mo |
| 56 | Custom 1/4 & 1/2 | 350 | 75 d | 1,225 | 7 | ~7 mo |
| 54 | Custom 1 LB | 450 | 75 d | 1,575 | 8 | ~5.5 mo |
| 99 | 10 LB (stock) | 90 | 7 d | ~50 | 1 | n/a (no MOQ) |
| 69 | 1 LB blank (stock) | set at first count | 7 d | | | n/a |

Cards 69 and 99 get `moq = 0` and `lead_days = 7`; the same machinery works, the
suggested qty just falls back to the 4-month cover.

## 5. Scan target

`GET /k/<token>` (worker, `handlers/bin-scan.js`) serves a self-contained page
that immediately POSTs `?action=openBin {token}` and renders the result:

| Case | Screen |
|---|---|
| sealed → opened | **1 oz bags** — bin 7 opened. **9 bins left** (~1,800 bags), ~7 weeks of cover. |
| already opened | Bin 7 was already opened Sep 14. 9 bins left. |
| opened and trigger fired | as above + "Reorder request sent to Damon." |
| void / unknown token | This bin was voided / Card not recognised. |

The page mutates via JS POST, not on GET, matching `kanban.html?flag=` today.
Camera apps do not prefetch, and a bin can only be opened once, so a double scan
is harmless by construction.

QR data: `https://rogue-origin-api.roguefamilyfarms.workers.dev/k/<10 chars>` —
about 62 chars, QR version 4 at level M. Fine on a full-sheet card.

## 6. Cards

`cardHtml(c, color, 'front', 'bin')` — a new size branch in `kanban.html` reusing
the `full-card` CSS. Face:

- **Size name** (card item), large — e.g. `Custom 1 oz Bags`
- **BIN 7 of 13 · 200 bags** · lot / received date
- QR (400×400 via the same qrserver call, encoding the `/k/` URL)
- **SCAN WHEN YOU OPEN THIS BIN** / *ESCANEA AL ABRIR ESTE CONTENEDOR*
- Location (`crumbtrail`)

Printed from the Grove panel: **Print cards** for a lot opens the same
`window.open` print doc as `printOneCard`, one page per sealed bin. Neutral colour,
front only.

## 7. Grove panel (`kanban.html`)

Rendered above the card grid when the `Grove` supplier tab is active (and
reachable via `?panel=grove`). Per bin-tracked card, one row:

`1 oz · 9 sealed / 4 opened · 1,800 on hand · ~140/wk (scans) · cover 12.9 wk · order by Oct 3 · [OK]`

Buttons: **Receive** (bags, bags/bin, lot → creates bins → offers Print),
**Print cards** (per lot), **Void bin** (pick from sealed bins + reason),
**Settings** (edits `kanban_bin_config`). Open reorder request shown inline with
its requested date and notify state.

## 8. Ops Hub tile

`sections.js → renderGrove()` on the 5-minute `loadSide()` cycle, one
`tile()` per custom size: value = weeks of cover, sub = `statusDot` (ok / soon /
order) + "order by <date>". Links to `kanban.html?panel=grove`. Add
`getBagStatus` to `hub/api.js` and a `sec-grove` section to `index.html`.
No new module file, so no `npm run stamp` needed unless one is added.

## 9. Email

`buildReorderEmailBody(card, confirmUrl, bag?)` gains an optional third argument.
When present the body leads with the numbers Damon needs against an MOQ:

```
Custom 1 oz Bags — reorder point reached.

On hand:      1,800 bags (9 sealed bins)
Using:        ~140 / week (from bin scans)
Runs out:     ~Nov 20
Lead time:    75 days  →  order by Sep 15
Suggest:      2,500 (MOQ) ≈ 4 months of cover

Location: Grove Rack > A-1
Supplier: Grove

Once you've placed the order, mark it done here:
<confirmUrl>
```

Existing tests on the two-argument form keep passing; new tests cover the
three-argument form.

## 10. Actions added to the kanban router

| Action | Method | Body / params | Does |
|---|---|---|---|
| `getBagStatus` | GET | `?cardId=` optional | status per bin-tracked card |
| `receiveBins` | POST | `{cardId, bags, bagsPerBin?, lot?, receivedBy?}` | creates bins, returns them (with tokens) |
| `openBin` | POST | `{token, openedBy?}` | opens, recomputes, may raise request |
| `voidBin` | POST | `{binId, reason}` | status → void |
| `getBins` | GET | `?cardId=&status=` | list for the panel / print |
| `setBinConfig` | POST | `{cardId, ...fields}` | upsert config |

`closeReorderRequest` additionally writes the `kanban_orders` row (§2).

## 11. Bootstrapping (day one)

1. Apply migration 0027; seed `kanban_bin_config` for cards 21, 54, 56, 69, 99 (§4).
2. Physically count sealed bags per size. The bin currently in use is not counted.
3. `receiveBins` per size with `lot = 'count 2026-09'`; split the rack into
   200-bag bins as the cards are printed and taped on.
4. Scan one bin on purpose to prove the loop end-to-end (row flips, panel updates,
   no email unless it is actually below the point).
5. Card 99's open request (#9 from 2026-08-11) stays as-is until Damon closes it.

## 12. Testing

- **Unit** (`tests/bag-math.test.mjs`, `tests/reorder-email-body.test.mjs`):
  on-hand, rate source switch at 3 bins, reorder point, order-by in the past,
  suggested qty rounds up to MOQ, email body with and without bag facts, token
  shape.
- **Integration**: one real scan on production after bootstrapping (§11.4).
- `npm test` only runs `tests/*.test.mjs` — new tests must use that suffix.

## 13. Out of scope (deliberately)

- Cross-size batching of Grove orders (MOQ is per size).
- A daily cron re-check. The trigger is on scan; the hub tile going red covers the
  case where nobody scans for weeks (which itself means nobody is using bags).
- Shopify sales as a live cross-check. Available later via the same export rules.
- Auth on the new actions. Consistent with the rest of `/api/kanban` (tracked
  deferral, see `index.js` client logging).
