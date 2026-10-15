# Grove Bags — Bins, Usage Ledger, and the Visual Rack

**Date:** 2026-10-14
**Status:** Design approved in conversation with Koa (2026-10-14). Supersedes
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
| Count of record | **Sealed bins on the rack**, recorded by scanning a bin card when the bin is opened | Catches every channel. Crew already scans kanban QRs. Scan timestamps give the burn rate for free. |
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
2. When you open a bin, scan its card, then drop the card in the box.
3. If you uncover the red card, scan it. (That raises the Damon request even
   if no bin scan ever did.)

**Red tape = the reorder point you can see from the door.** Bins are uniform,
so height is count. The Desk prints a small label whenever the reorder point
changes ("Red tape at 15 bins · move the red card"), and Receive ends with
"move the red card to bin N".

**Receive station** (laminated one-pager at the rack): count boxes → Desk →
Receive (boxes × bags per box, bin size) → print one card per bin → break the
boxes down into bins, one card in each → restock behind EN USO → move the red
card and tape. Twenty minutes, no judgement calls.

**Confirmed 2026-10-14:** Grove boxes are broken down into smaller bins on
receipt (10 lb: box of 100 → 2 bins of 50). The bin is the unit that gets a
card; the box is just what Receive counts. Still open: whether the open bin
lives at the rack or goes to the bench (default: bench).

## 3. Data model — migration `0045-kanban-bins.sql`

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
  seed_per_month  REAL    NOT NULL,              -- used until >= 3 bins opened
  colour          TEXT,                          -- lane colour token
  updated_at      TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (card_id) REFERENCES kanban_cards(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS kanban_bins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id       INTEGER NOT NULL,
  bin_no       INTEGER NOT NULL,                -- 1..N within a lot
  lot           TEXT,                            -- Grove order ref / receipt label
  bag_count     INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'sealed',  -- sealed | opened | void | red
  token         TEXT NOT NULL,                   -- 10 chars base32, in the QR
  received_at   TEXT DEFAULT (datetime('now')),
  opened_at     TEXT, opened_by TEXT, void_reason TEXT,
  FOREIGN KEY (card_id) REFERENCES kanban_cards(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_token ON kanban_bins(token);
CREATE INDEX IF NOT EXISTS idx_kb_card_status ON kanban_bins(card_id, status);

-- Red ORDER card per lane: one token, scanning it raises the request.
-- Stored as a bin row with status 'red' (bag_count 0) so /k/<token> is one route.

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
`/api/kanban?action=orderUsage&secret=<WEBHOOK_SECRET>` with a Liquid body:

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
countOnHand    = sealed bins × per                            (count signal)
baseline       = latest kanban_baselines row
usageSince     = Σ kanban_usage.qty WHERE at > baseline.at
usageOnHand    = baseline.bags − usageSince                    (usage signal)
onHand         = min(countOnHand, usageOnHand)                 (alarm uses the lower)
recount        = |countOnHand − usageOnHand| > per             (Desk flag)

rateScans      = opened bins ≥ 3 in 56 d ? Σ bag_count(opened, 56 d) / 56 : seed_per_month / 30.4
rateUsage      = Σ usage(56 d) / 56
rateSeason     = Σ usage(same window last year: today+lead … today+lead+safety) / (lead+safety)
rate           = max(rateScans, rateUsage, rateSeason)

reorderPoint   = rate × (lead + safety)
runOut         = today + onHand / rate
orderBy        = today + (onHand − rate × lead) / rate         (may be in the past)
suggestedQty   = max(moq, ceil(rate × 120 / 100) × 100)        (MOQ or ~4 months)
status         = onHand ≤ reorderPoint ? 'order' : orderBy ≤ today+14 ? 'soon' : 'ok'
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
`?action=openBin {token}` on load (mutate on POST, not GET, same as
`kanban.html?flag=`). Big type, lane colour background, Spanish first:

| Case | Screen |
|---|---|
| sealed → opened | **1 oz** · contenedor 7 abierto · **quedan 9 contenedores** · ▓▓▓▓▓▓▓▓▓ (one square per sealed bin, red ones below the tape line) · ~7 semanas |
| already opened | Este contenedor ya se abrió el 14 sep · quedan 9 |
| red card | **PEDIR** · solicitud enviada a Damon · (or "ya está pedido" if a request is open) |
| crossed reorder point on this scan | as opened + "Solicitud enviada a Damon" |
| void / unknown | Paquete anulado / Tarjeta no reconocida |

A bin opens once, so double scans are harmless. QR data is the ~62-char `/k/`
URL, version 4 at level M.

## 7. Cards

Printed from the Desk at Receive, one per bin, 6×4 in card stock (the bins
are small; full sheet only for the lane kit):

- lane colour band · **1 oz** · BIN 7 de 50 · 50 bolsas · lot / date
- QR · **ESCANEA AL ABRIR** / *scan when you open*

Header card (full sheet, laminated, once per lane) and the red ORDER card (full
sheet, red, once per lane) print from the same view under "Lane kit".

## 8. Desk — Grove tab (`src/js/tag-desk/`)

Replaces the current localStorage-only Grove tab. One **lane tile per size**,
same colour as the rack, in this order of information:

1. **Order by Sep 15** (or "OK until Feb", or "ORDER NOW · 3 days late")
2. Bin squares: sealed bins as filled squares, red tape drawn at
   `redTapeAtBins`, the open bin hatched
3. Small line: `9 sealed · ~140/wk · usage says 8 · recount?` — the recount
   badge only when the two signals disagree by more than a bin
4. Buttons: **Receive** · **Print** (cards for a lot / lane kit) · **Void** ·
   **Recount** (sets a baseline from the current sealed count) · **Settings**

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
| `receiveBins` | POST | `{cardId, boxes, bagsPerBox?, bagsPerBin?, lot?, by?}` | creates bins (tokens), writes a baseline, returns red-tape depth |
| `openBin` | POST | `{token, by?}` | sealed → opened; red card → raise request; recompute; may raise request |
| `voidBin` | POST | `{binId, reason}` | status → void |
| `recount` | POST | `{cardId, sealed}` | writes a baseline from a physical count |
| `setBinConfig` | POST | `{cardId, ...}` | upsert config |
| `orderUsage` | POST (secret) | Flow body (§4) | writes usage rows |
| `setRecipe` / `getRecipes` | POST / GET | `{variant_id, card_id, qty}` | recipe maintenance |

Desk writes carry the shared password like the rest of Phase A.

## 11. Build order (each step ships alone and is useful alone)

1. **Ledger first:** migration, `orderUsage`, recipes seeded from the Shopify
   product export, Flow pointed at the worker. The backstop starts collecting
   on day one, before any card exists. Run beside the old Flow; compare.
2. **Bins:** `receiveBins` / `openBin` / `/k/` page / cards / lane kit print.
   Koa counts bins per size → Recount → print cards → one card per bin → scan one to prove the loop.
3. **Desk tab + email + red card.** Retire localStorage Grove memory.
4. **Seasonal seed** from last year's orders; `rateSeason` goes live.
5. **Phase 2:** wholesale/consignment usage hooks; more materials as recipe rows.

## 12. Still to confirm (defaults in place; none blocks step 1)

- Bags per bin as shipped by Grove (default 100 — read the next bining slip).
- Bin to bench vs single bags at the rack (default: bin to bench).
- Lane colours: reuse the Desk's Grove badge colours unless Koa picks others.
