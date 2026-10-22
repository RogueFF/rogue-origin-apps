# Grove Bags — Bins, Usage Ledger, and the Visual Rack

**Date:** 2026-10-14
**Status:** Design approved in conversation with Koa (2026-10-14; reusable cards, then red-card-only, the same evening). Supersedes
`2026-09-02-grove-bag-bins-design.md` (never built).
**Builds on:** `2026-08-10-grove-reorder-alert-design.md` (scan → email → "mark as
ordered" loop, live since 2026-08-11) and the Tag & Desk page
(`2026-09-03-tag-desk-design.md`), which already has a Grove tab.

## 0. Why we keep running out

Grove custom bags carry a **2,500 MOQ per size** and a **~75-day lead**. Today
there are two half-systems and no count:

- The supply kanban has Grove cards (21, 54, 56, 69, 99) that read
  `orderQty: CUSTOM / orderWhen: Green Card Signal`. The alert fires when someone
  *notices* the rack is low — against a 75-day lead, that is already too late.
- A Shopify Flow decrements a fake "Grove Bags" product (5 variants) on every
  flower sale. Nothing ever adds stock back, so it drifts negative (−448 on
  2026-10-14, reset to 0). It only sees Shopify retail; wholesale, consignment
  and waste are invisible to it. It is a usage meter, not a count.

Koa's framing: **the manual count is the system; Shopify is the backstop.**
"If the manual doesn't catch it, the Shopify will." And the boss's requirement:
**the in-person system must be visual** — a worker should understand the rack
from across the room without reading a number.

## 1. Decisions

| Question | Decision | Why |
|---|---|---|
| Count of record | **Receive count + the ledger.** Receive sets the baseline (leftover bins × bags per bin + boxes × bags per box); Shopify usage counts down from it. The crew does not scan bins. | One scan per 75 days (the red card) beats fifty. Compliance over precision. |
| Unit | **The bin as Koa splits it.** Grove ships sealed boxes of a fixed count (10 lb: 100); the crew breaks each box into smaller bins (10 lb: 2 × 50). Receive takes boxes × bags per box and the bin size, and prints one card per bin. | ±1 bin of accuracy is fine against a 2,500 MOQ. Bin size is per card config, not a constant. |
| Shopify's role | **Usage signal only**, never the count | A counter that nobody restocks is always wrong. Usage since the last count, subtracted from that count, is an independent on-hand estimate. |
| How usage reaches us | **Shopify Flow → HTTP → worker ledger** (`kanban_usage`), via a per-variant recipe table | Same transport the production webhook already uses. Replaces the fake "Grove Bags" product. One row per material per line item; adding a material later is a recipe row, not a new Flow. |
| 10 lb bags | **From `inventory_adjustments`** (production already logs every tagged 10 lb bag) | Zero new plumbing. |
| Alarm rule | Fires when **either** estimate crosses the reorder point; **recount flag** when the two disagree by more than a bin | The backstop is only a backstop if it can fire on its own. |
| Reorder point | `rate × (lead + safety)` where rate is **the larger of** trailing scans, trailing usage, and **last year's same lead window** (seasonal) | A flat trailing rate orders too late every fall (1 oz ran ~1,000 in Nov vs ~600 normal). |
| Headline number | **Order-by date** + suggested qty | A date is a task. A stock count is trivia. |
| Surfaces | **Tag & Desk Grove tab** + the Damon email + the phone scan page. No Ops Hub tile, no `kanban.html` panel. | One home. YAGNI on a second surface. |
| In-person system | Colour lane per size, header card, one **EN USO** slot, bin cards, **red tape line** + **red ORDER card** at the reorder depth | Every state is a colour and a position. Three independent triggers: eyes (tape), hands (red card), automation (usage). |
| Boxes vs bins | Receive records boxes; cards go on bins | The box is the receipt unit, the bin is the consumption unit. |
| Cards | **One red ORDER card per lane**, laminated, printed once. No per-bin cards. | Koa 2026-10-14: fewer worker actions. The ledger already counts; per-bin scans would duplicate it. If a size drifts (sells outside Shopify), that size can get per-bin cards later — the model allows it. |
| Scope now | **Grove bags only.** The recipe table is general; only bag recipes are seeded. | "Start with Grove, we keep running out." Labels, boxes, humidity bins come later as rows. |

## 2. The rack (in-person system)

One **lane per size**, five lanes, five colours. The colours are the Desk's
existing Grove badge colours and carry through header card → bin card → scan
screen → Desk tile.

```
┌──────────── 1 oz ────────────┐   header card (full sheet, laminated):
│  [photo]  1 oz · NARANJA      │   bag photo · size huge · lane colour ·
│  Abre un contenedor →            │   "Abre un contenedor → escanea la tarjeta"
│  escanea la tarjeta           │
├──────────────────────────────┤
│ EN USO  │ ▓▓ ▓▓ ▓▓ ▓▓ ▓▓ ▓▓  │   front slot = the ONE open bin
│ (1 bin)│ sealed bins, each  │   behind it = sealed bins with cards
│         │ with its card       │
│         │ ──── red tape ────  │   red tape on the lane wall at the
│         │ ▓▓ ▓▓ [RED CARD] ▓▓ │   reorder depth; red ORDER card sits
└──────────────────────────────┘   in the stack at that same depth
```

**Rules (the whole SOP, printed on the header card):**
1. Only one open bin per lane. Open the next one when EN USO is empty.
2. **If you uncover the red card, scan it.** That is the only scan a worker
   ever does on this rack.

**Red tape = the reorder point you can see from the door.** Bins are uniform,
so height is count. The Desk prints a small label whenever the reorder point
changes ("Red tape at 15 bins · move the red card"), and Receive ends with
"move the red card to bin N".

**Receive station** (laminated one-pager at the rack): count the bins still
sealed → Desk → Receive (leftover bins, boxes arrived, bags per box, bin
size) → break the boxes down into bins → restock behind EN USO → put the red
card and tape at the depth the Desk shows. Nothing to print. The leftover
count is also the recount that checks the ledger.

**Confirmed 2026-10-14:** Grove boxes are broken down into smaller bins on
receipt (10 lb: box of 100 → 2 bins of 50). The bin is the unit that gets a
card; the box is just what Receive counts. Still open: whether the open bin
lives at the rack or goes to the bench (default: bench).

## 3. Data model — migration `0046-kanban-bins.sql`

(0044 is the latest applied; renumber if that changes before build. Nothing is
added to `kanban_cards` — `updateCard` is a full-row overwrite.)

```sql
CREATE TABLE IF NOT EXISTS kanban_bin_config (
  card_id         INTEGER PRIMARY KEY,
  bags_per_box    INTEGER NOT NULL DEFAULT 100,   -- as Grove ships it
  bags_per_bin    INTEGER NOT NULL DEFAULT 50,    -- as the crew splits it
  lead_days       INTEGER NOT NULL DEFAULT 75,
  safety_days     INTEGER NOT NULL DEFAULT 30,
  moq             INTEGER NOT NULL DEFAULT 2500,
  seed_per_month  REAL    NOT NULL,              -- used until the ledger has 14 days
  colour          TEXT,                          -- lane colour token
  updated_at      TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (card_id) REFERENCES kanban_cards(id) ON DELETE CASCADE
);

-- One red card per lane (kind='red'). kind='bin' is reserved for a size that
-- later needs per-bin scanning; nothing creates them in v1.
CREATE TABLE IF NOT EXISTS kanban_bin_cards (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id   INTEGER NOT NULL,                    -- the kanban card (size)
  slot_no   INTEGER NOT NULL DEFAULT 0,
  kind      TEXT NOT NULL DEFAULT 'red',         -- red | bin
  token     TEXT NOT NULL,                       -- 10 chars base32, in the QR
  retired   INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (card_id) REFERENCES kanban_cards(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kbc_token ON kanban_bin_cards(token);

-- Per-lane tally. received adds, scans subtract, recount sets.
CREATE TABLE IF NOT EXISTS kanban_bin_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id   INTEGER NOT NULL,
  kind      TEXT NOT NULL,                       -- receive | recount | red | void | open (v2)
  bins      INTEGER NOT NULL,                    -- +N receive, absolute for recount, 0 red, -N void
  bag_count INTEGER NOT NULL,                    -- bags per bin at the time
  bin_card  INTEGER,                             -- kanban_bin_cards.id for 'red' / 'open'
  lot       TEXT, by TEXT, note TEXT,
  at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kbe_card_at ON kanban_bin_events(card_id, at);


-- Recipe: what one sold unit of a variant consumes.
CREATE TABLE IF NOT EXISTS kanban_recipes (
  variant_id    TEXT NOT NULL,                   -- Shopify variant gid or numeric id
  card_id       INTEGER NOT NULL,                -- material (kanban card)
  qty           REAL NOT NULL DEFAULT 1,
  PRIMARY KEY (variant_id, card_id)
);

-- Usage ledger: every bag consumed, by source.
CREATE TABLE IF NOT EXISTS kanban_usage (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id     INTEGER NOT NULL,                  -- 0 = unmapped variant
  qty         REAL NOT NULL,
  source      TEXT NOT NULL,                     -- shopify | wholesale | consignment | production | shopify:unmapped
  ref         TEXT,                              -- order name / flow run id
  at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ku_ref ON kanban_usage(source, ref, card_id);  -- idempotent Flow retries
CREATE INDEX IF NOT EXISTS idx_ku_card_at ON kanban_usage(card_id, at);

-- Baseline: set at Receive and at Recount. Usage after this moment counts down from it.
CREATE TABLE IF NOT EXISTS kanban_baselines (
  card_id   INTEGER NOT NULL,
  bags      INTEGER NOT NULL,                    -- sealed × per + the open bin
  at        TEXT NOT NULL DEFAULT (datetime('now')),
  reason    TEXT                                 -- receive | recount
);
```

Unmatched variants (a Shopify line item with no recipe) are written to
`kanban_usage` with `card_id = 0` and `source='shopify:unmapped'` so the Desk can
show "no recipe" loudly instead of silently consuming nothing.

## 4. Usage ingest

**Shopify Flow:** trigger *Order created* → action *Send HTTP request*, POST
`/api/kanban?action=orderUsage` with the secret in the `X-Webhook-Secret` header
(`?secret=<WEBHOOK_SECRET>` is also accepted) and a Liquid body:

```
{ "order": "{{ order.name }}", "at": "{{ order.createdAt }}",
  "items": [ {% for li in order.lineItems %}
    { "variant_id": "{{ li.variant.id }}", "sku": "{{ li.sku }}", "qty": {{ li.quantity }} }{% unless forloop.last %},{% endunless %}
  {% endfor %} ] }
```

Worker `orderUsage`: for each item, look up `kanban_recipes` by `variant_id`,
insert `kanban_usage` rows (`source='shopify'`, `ref=order name`). The unique
index makes Flow retries harmless. No recipe → unmapped row.

**Wholesale / consignment:** the worker already handles those orders
(`wholesale-d1.js`, `consignment-d1.js`). Each gets a one-line hook that calls
the same `recordUsage(items, source, ref)` helper. Phase 2; not needed for the
first deploy.

**10 lb:** `getBinStatus` reads `inventory_adjustments WHERE size='10lb'`
directly for card 99. No Flow, no recipe.

The Shopify "Grove Bags" product stays until the ledger has run alongside it for
two weeks and matches; then it is archived.

## 5. The math — `workers/src/lib/bin-math.js` (pure, unit-tested)

```
per            = bags_per_bin
baseline       = latest kanban_baselines row (written by Receive / Recount)
usageSince     = Σ kanban_usage.qty WHERE at > baseline.at
onHand         = baseline.bags − usageSince                    (the ledger estimate)
redScanned     = a 'red' event after baseline.at → status 'order' regardless of onHand
recount        = at Receive: |counted leftover × per − onHand| > per  (Desk flag)

rateUsage      = usage rows ≥ 14 d ? Σ usage(56 d) / 56 : seed_per_month / 30.4
rateSeason     = Σ usage(same window last year: today … today+lead+safety) / (lead+safety)
rate           = max(rateUsage, rateSeason)

reorderPoint   = rate × (lead + safety)
runOut         = today + onHand / rate
orderBy        = today + (onHand − rate × lead) / rate         (may be in the past)
suggestedQty   = max(moq, ceil(rate × 120 / 100) × 100)        (MOQ or ~4 months)
status         = redScanned || onHand ≤ reorderPoint ? 'order' : orderBy ≤ today+14 ? 'soon' : 'ok'
redTapeAtBins = ceil(reorderPoint / per)
```

`rateSeason` needs last year's `kanban_usage`, which does not exist yet. Seed it
once from the Shopify order export (2025-10 → 2026-02, flower SKUs mapped to
bag size) so the first fall forecast is real. Until seeded, `rateSeason = 0`
and the max falls through to the other two.

**Seed rates** (bags/month from the 2025-11-12 → 2026-02-04 export):
1 oz 600 · 1/4&1/2 oz 350 · 1 lb 450 · 10 lb 90 · 1 lb blank: set at first count.

## 6. Scan page — `GET /k/<token>`

Self-contained worker page (`handlers/bin-scan.js`), JS POSTs
`?action=scanCard {token}` on load (mutate on POST, not GET, same as
`kanban.html?flag=`). Big type, lane colour background, Spanish first:

| Case | Screen |
|---|---|
| red card | **PEDIR 1 oz** · solicitud enviada a Damon · lane colour · (or "ya está pedido" if a request is open) |
| void / unknown | Paquete anulado / Tarjeta no reconocida |

A second scan of the red card while a request is open just re-sends the
email (same as today's `already_open` path). QR data is the ~62-char `/k/`
URL, version 4 at level M.

## 7. Cards

Printed **once** per lane from the Desk ("Lane kit"), laminated:

- **Header card** (full sheet): bag photo · size huge · lane colour · the two
  rules in Spanish and English.
- **Red ORDER card** (full sheet): the old supply-closet kanban card template
  (kanban.html, 8.5×11 "full" size) in red — double gold border, bag name
  header, rack location + lane colour swatch, bag photo, Supplier / Order qty /
  Delivery, QR (`/k/<token>`) + *ESCANEA PARA PEDIR* / *SCAN TO ORDER* (the Desk's language first, the other small underneath — the header card and tape label follow it too), gold
  price pill, round logo, "Leave it here until the next delivery". Koa
  2026-10-19: closer to the old template (`src/js/tag-desk/red-card.js`).
- **Red tape label** (small, reprinted when the depth changes): "Red tape at
  bin 15".

No per-bin cards. A lost red card is retired and reprinted from the kit.

## 8. Desk — Grove tab (`src/js/tag-desk/`)

Replaces the current localStorage-only Grove tab. One **lane tile per size**,
same colour as the rack, in this order of information:

1. **Order by Sep 15** (or "OK until Feb", or "ORDER NOW · 3 days late")
2. Bin squares from the ledger estimate (`onHand / per`), red tape drawn at
   `redTapeAtBins`; a RED CARD SCANNED banner when one has been
3. Small line: `~9 bins · ~140/wk (fall: 230) · last count Sep 2` — the
   recount badge only when the last Receive count disagreed with the ledger
4. Buttons: **Receive** (leftover + boxes → new baseline, shows red-tape depth)
   · **Lane kit** (print once; reprint a lost card) · **Recount** (baseline
   from a physical count) · **Settings**

An open Damon request shows inline with its date; "Mark as ordered" is unchanged.
A "no recipe" strip lists unmapped Shopify variants seen in the last 30 days.

Desk memory in `localStorage` goes away for Grove; everything reads
`getBinStatus`.

## 9. Email

`buildReorderEmailBody(card, confirmUrl, bin?)` gains an optional third
argument. The body leads with the date:

```
Custom 1 oz Bags — order by Sep 15.

Suggest:      2,500 (MOQ) ≈ 4 months of cover
On hand:      900 bags (9 sealed bins)  · usage ledger agrees
Using:        ~140 / week (fall forecast: ~230 / week from Nov)
Runs out:     ~Nov 20 · lead 75 days

Location: Grove Rack > A-1
Once you've placed the order, mark it done here: <confirmUrl>
```

`closeReorderRequest` also writes the `kanban_orders` row so Grove stops
reading zero orders in analytics.

## 10. Actions added to the kanban router

| Action | Method | Body / params | Does |
|---|---|---|---|
| `getBinStatus` | GET | `?cardId=` optional | §5 per bag-tracked card + bins + open request + unmapped variants |
| `receiveBins` | POST | `{cardId, leftoverBins, boxes, bagsPerBox?, bagsPerBin?, lot?, by?}` | receive event, new baseline, `needsRecount` flag, returns red-tape depth |
| `scanCard` | POST | `{token, by?}` | red card → 'red' event + raise request (re-sends if open); kind='bin' reserved for v2 |
| `voidBin` | POST | `{binId, reason}` | status → void |
| `recount` | POST | `{cardId, sealedBins, by?}` | absolute tally event + baseline |
| `makeLaneKit` | POST | `{cardId}` | creates the lane's red card token for printing |
| `setBinConfig` | POST | `{cardId, ...}` | upsert config |
| `orderUsage` | POST (secret) | Flow body (§4) | writes usage rows |
| `setRecipe` / `getRecipes` | POST / GET | `{variant_id, card_id, qty}` | recipe maintenance |

Desk writes carry the shared password like the rest of Phase A.

## 11. Build order (each step ships alone and is useful alone)

1. **Ledger first:** migration, `orderUsage`, recipes seeded from the Shopify
   product export, Flow pointed at the worker. The backstop starts collecting
   on day one, before any card exists. Run beside the old Flow; compare.
2. **Lanes:** `receiveBins` / `scanCard` / `/k/` page / lane kit print (once).
   Koa counts bins per size → Recount → print + laminate the five kits →
   red tape + red card at the depth shown → scan one red card to prove the loop.
3. **Desk tab + email + red card.** Retire localStorage Grove memory.
4. **Seasonal seed** from last year's orders; `rateSeason` goes live.
5. **Phase 2:** wholesale/consignment usage hooks; more materials as recipe rows.

## 12. Still to confirm (defaults in place; none blocks step 1)

- Bags per bin as shipped by Grove (default 100 — read the next bining slip).
- Bin to bench vs single bags at the rack (default: bin to bench).
- Lane colours: reuse the Desk's Grove badge colours unless Koa picks others.
- Per-bin cards (kind='bin') only if a size's Receive count keeps disagreeing with the ledger.

## Addendum 2026-10-20 — planned use per lane

Koa: "I think ~1500/month is a good start just because we are intaking product too. Please set it for me. We can update next time we order based off of the updated burn rate." Background: the 10 lb lane's ledger counts 10 lb scan-outs (sales side, ~27/wk), but the bags are consumed at bagging on the trim line (~110/wk in a full trim week, ~345/wk under the 50-person plan), and purchased flower adds ~100 bags per 1,000 lb.

- `kanban_bin_config.plan_per_month` (migration 0047, default 0). `laneStatus` takes `planPerMonth`: > 0 overrides ledger, seed and season (`rateSource: 'plan'`), one month becomes the suggested order (floored at MOQ), and the rate the data would have given still comes back as `measured: {rate, source}`.
- Desk: lane Settings gets "Planned use per month · overrides the ledger · 0 = off"; the tile's rate line reads "~345/wk (plan · ledger ~27/wk)" so the next order can compare plan and measured.
- Card 99 set to 1,500/month on 2026-10-20 → reorder point 691 bags, red tape at bin 14, suggested order 1,500. Custom-bag lanes keep the ledger.

## Addendum 2026-10-21 — order cycle per lane

Koa: "I'd like to hold enough stock to order every 2 weeks." `kanban_bin_config.order_days` (migration 0048, default 0): one order covers that many days of use (rounded up to 100, floored at MOQ). 0 keeps the defaults — 30 days with a plan, 120 without. The red line (lead + safety) does not move with the cycle. Card 99 set to 14 → at 1,500/month: order 700 (7 cases) every two weeks, red tape stays at bin 14, stock swings between ~350 just before a delivery and ~1,050 just after. Desk: lane Settings "Order every (days)".

## Addendum 2026-10-21 — 10 lb lane on hand from Shopify

Koa: "make sure this follows current inventory … we can get shopify hooked into the system to read live numbers after."

**What Shopify holds.** There is no Shopify item with SKU `MANUAL-10LB-BAG`; that is the pseudo-SKU the barn bag scan (`logBag`) writes into `inventory_adjustments` locally. The 10 lb bags in Shopify are the "Grove Bags" product's **"10 lbs."** variant (no SKU, location Eagle Point) — the fake product §0 describes. Shopify Flow already posts every inventory change on it to the worker (`inventory_adjustments`, `adjustment_source='shopify_flow'`, `product_name='Grove Bags'`, `variant_title='10 lbs.'`), hand edits included: reset −448 → 0 on 10-14, set to 300 on 10-20 20:14 UTC, then 299 … 294 as 10 lb flower sold. `new_total_available` is Shopify's level after each change (`quantity_adjusted` and `previous_available` arrive as 0).

**Where the level is read.** From that echo: the newest Grove Bags / 10 lbs. row is Shopify's last word (`available`, `at`), read in the same D1 round trip as the rest of the lane. No Admin API call, no new credentials, no cache: the worker has no Shopify client (Super Sack counts go through the Pool Inventory Apps Script), and Shopify pushes the number within seconds of each change. `SHOPIFY_COUNTED` in kanban-d1.js maps card 99 → that product/variant; another lane is a row there, not a migration. The `*/5` cron is not involved: a poll adds nothing while the Flow is on (see write-back below for when it would).

**Rule: the freshest word wins** (`laneStatus({ shopify: { available, at } })`, pure):

- Shopify's word newer than the last count (baseline) → `onHand = max(0, available)`, `onHandSource: 'shopify'`.
- Count newer than Shopify's word (a Receive/Recount Shopify has not been told about) → `onHand = baseline − scans since`, `onHandSource: 'ledger'`.
- No Shopify row → ledger, as before. Other lanes are untouched (`shopify: null`).
- `shopify.agrees`: Shopify is within a bin of the ledger estimate (`ledgerOnHand`). False → the tile shows a badge and the Receive/Recount toast says what to set in Shopify.

Rate, reorder point, red tape depth, order qty and the dates are unchanged; they only read `onHand`. `recount` compares a physical count to the on hand the tile shows, whichever source that is.

**Why not "always Shopify".** On 2026-10-21 that would have put the lane at 294 bags (5 bins), under the 296 red line → ORDER NOW on a rack holding 10 bins after the day's Receive (baseline 500 at 21:31 UTC, Shopify's last word 294 at 17:48 UTC). The count is the fresher fact until Shopify is told.

**Receive / Recount ↔ Shopify.** The worker cannot write to that variant yet: the Pool proxy's write actions are for Super Sack and `[VENDOR]` products. So the lane carries `shopify: { available, at, bins, agrees }` and `ledgerOnHand`; the Desk toast appends "Shopify says 294 (~5 bins) · set it to 500 in Shopify" and the tile keeps the badge until Shopify agrees. **Write-back is the next step:** the proxy's `get_vendor_variants { productId }` returns any product's variants with `inventoryItemId`, `locationId` and live `quantity` (verified 2026-10-21 on a `[VENDOR]` product). With the Grove Bags product id from its admin URL, a 5-minute poll can write a synthetic echo row when the level changed (insurance against the Flow being off) and Receive/Recount can set the quantity through the same proxy. Until then Koa sets it by hand after each count.

**Tile text** (`model.js` `laneOnHandLine`, pure, Pacific time): `~10 bins · from Shopify · as of 2:41 pm` (the date instead of the time when not today); from the count: `~10 bins · from the count · Shopify says ~5 (as of 10:48 am)`; lanes without Shopify: `~9 bins` as before. ES: `de Shopify · a las 2:41 pm` / `del conteo · Shopify dice ~5 (10:48 am)`.

**Runbook consequence.** The "Grove Bags" product and its order-decrement Flow stay for the **10 lbs.** variant: the lane now depends on them. When the two-week ledger comparison passes, archive the other four variants, not this one.

**Rollout.** Merge → `npm run deploy` from `workers/` (no migration) → Pages serves the Desk (CACHE_VERSION bumped) → Koa sets Grove Bags › 10 lbs. to the rack count (500 on 2026-10-21) → the tile reads "from Shopify" and counts down with each 10 lb sale.

## Addendum 2026-10-22 — re-scanning the ORDERED card records the delivery

Koa: "when they re-scan the ordered card, it triggers an inventory add … the option to add in how many cases arrived." The /k/<token> page now asks `GET ?action=cardState&token=` first (read-only: lane + openRequest). No open request → `POST scanCard` as before (order). Request open (the card is in the ORDERED box) → the page shows "¿Llegaron las cajas?" with two numbers, cases that arrived (prefilled from the lane's suggested order ÷ bags per box) and full bins already on the rack (prefilled from the lane), and `POST ?action=receiveFromCard {token, boxes, leftoverBins?}` runs the same receive as the Desk (baseline, receive event by `card`, closes the request, logs the order); `leftoverBins` omitted = the lane's current bins. A "re-send the email" link still reaches scanCard. A delivery scan can never raise a stray order. Tests: `tests/grove-card-receive.test.mjs`, `tests/grove-scan-page.test.mjs`. SOP-024 step 6 moves receiving to the rack: re-scan the card, enter the cases, fill the empties, card under the green bins.
