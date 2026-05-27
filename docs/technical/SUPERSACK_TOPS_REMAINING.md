# Finished Tops Remaining — Endpoint Reference

> A public, read-only API that answers one question: **given the raw supersacks
> on hand right now, how many pounds of finished tops will they produce?**
> Built for a widget on the company website.
>
> **Layered doc:** plain-English first, exact formula and code below it.
> For the broader system see [`SUPERSACK_ANALYTICS.md`](./SUPERSACK_ANALYTICS.md);
> for the *why* behind these choices see
> [`docs/plans/2026-05-27-supersack-tops-remaining-api-design.md`](../plans/2026-05-27-supersack-tops-remaining-api-design.md).

---

## 1. What it returns

**Plain English:** Take every cultivar we have raw supersacks of, look up how many
pounds of tops each sack of that cultivar has historically produced, multiply, and
add it all up. For cultivars we've never run (or whose history looks untrustworthy),
use the **lowest** trustworthy rate we have — so the number never over-promises.

```
GET https://rogue-origin-api.roguefamilyfarms.workers.dev/api/supersack?action=tops_remaining

200 OK
{
  "finished_tops_lbs": 6578,    // projected finished tops in current raw inventory
  "as_of": "2026-05-27T18:22:00.000Z",
  "inventory_sacks": 1943       // total raw supersacks the projection is based on
}
```

| Field | Meaning |
|---|---|
| `finished_tops_lbs` | Projected lbs of finished **tops** (rounded to whole lbs) |
| `as_of` | When the figure was computed (UTC). Reflects cache age — see §5 |
| `inventory_sacks` | Total raw supersacks summed into the projection |

---

## 2. The formula

**Plain English:** For each cultivar in inventory, pick the right tops-per-sack
rate, multiply by how many sacks we have, and total it.

```
finished_tops_lbs = Σ over cultivars ( inventory_sacks × tops_per_sack )
```

### Choosing `tops_per_sack` for each cultivar

| Situation | Rate used |
|---|---|
| Has clean history **and** rate is *in-family* (at or below the high-anomaly fence, below) | the cultivar's **own** measured rate |
| No clean history | the **floor** |
| Rate is a **high** anomaly (too good to be true) | the **floor** |

- **Measured rate** (lbs of tops per sack) = `Σ tops_lbs ÷ Σ sacks_opened` over
  that cultivar's clean history (clean = the `complete=true` filter; see system
  doc §4). Uses **all** history, not a window — maximize data while volumes are
  still small.
- **Floor** = the **lowest** rate among cultivars we *trust* — i.e. the lowest
  rate at or below the fence (the conservative default for unknowns). Today
  ≈ **2.24** lbs of tops per sack (Berry Bliss).
- **Anomaly test** = robust, high-side outlier detection. A rate is distrusted
  only if it sits **above** the upper fence:

  ```
  fence = median(rates) + 3 × (MAD × 1.4826)   // MAD = median absolute deviation;
                                               // 1.4826 scales it to ~std-dev units
  ```

  Applied only when there are **≥ 5** cultivar rates and `MAD > 0`; otherwise no
  rate is flagged.

### Why "high-only" (conservative)

A suspiciously **high** rate (e.g. a 1-sack cultivar showing 9 tops/sack) is
distrusted and dropped to the floor — so a thin fluke can't inflate the headline.
A suspiciously **low** rate is **kept as-is** — lower is always the safe direction
for a "how much do we have" number. The estimate is never revised upward by the
rule.

### Worked example (2026-05-27)

- 11 tracked cultivars, rates spanning **2.24 – 4.83** tops/sack → no high
  anomalies, so each tracked cultivar uses its own rate.
- ~263 of 1,943 sacks are cultivars with **no** clean history → priced at the
  **2.24** floor.
- Result: **5,989** (tracked, own rates) **+ 589** (uncharacterized × floor)
  = **6,578 lbs** across **1,943 sacks**.

```js
// workers/src/handlers/supersack-d1.js
export function projectFinishedTops(strainStats, inventory) { ... }
```
The math lives in the pure, I/O-free `projectFinishedTops(strainStats, inventory)`
so it can be unit-tested with fixtures.

---

## 3. Data sources

| Input | Source |
|---|---|
| Per-cultivar tops/sack | D1 `supersack_entries`, clean rows, all history |
| Current sack counts | Shopify, via the Google Apps Script (GAS) pool proxy (`get_supersack_variants`) |

Cultivar names match exactly between the two (`"2025 - Lifter / Sungrown"`), so the
join is exact — no fuzzy matching. A Shopify variant whose name doesn't match any
D1 strain is treated as having no history and priced at the **floor** — so a name
mismatch *understates* the projection rather than inflating it.

```
tops_remaining  ──①──►  D1 (yield rates)
                ──②──►  Worker → GAS proxy → Shopify (live sack counts)
                ──③──►  project → cache → respond
```

---

## 4. Request notes (for the web developer)

- **Method:** `GET`. No authentication (public by design).
- **CORS:** allowed for `rogueff.github.io`, `rogueorigin.com`, `www.rogueorigin.com`,
  and `localhost`. A browser call from any other origin is blocked. Server-side
  calls (curl, server fetch) are unrestricted — CORS only governs browsers.
  *(To add another site, append it to `ALLOWED_ORIGINS` in `workers/wrangler.toml`.)*
- **Polling:** safe to call on page load; the result is edge-cached (§5), so you
  won't hit Shopify on every view. Use `as_of` to display freshness.

---

## 5. Caching & failure behavior

| Layer | Behavior |
|---|---|
| **Fresh cache** | Successful result cached **5 minutes** (Cloudflare Cache API). Inventory changes ~1–2×/day, so this is plenty fresh and shields the GAS/Shopify quota. |
| **Stale fallback** | Every success also stores a **24-hour** "last-good" copy. If D1 or Shopify hiccups, the endpoint serves that stale-but-real number with `200` + header **`X-Stale: true`** instead of failing. |
| **Hard failure** | Only if the very first request during an outage finds no cached copy: `502` with a generic `"Inventory temporarily unavailable"` (detail logged server-side, never leaked to the client). |

A consumer should treat `X-Stale: true` as "show it, maybe note it's catching up."

---

## 6. Caveats

- **Thin-sample dominance.** Cultivars use their own rate at **≥ 1** clean sack —
  this endpoint intentionally does **not** apply the dashboard's 10-sack
  thin-sample gate (`MIN_SACKS_FOR_PREDICTION`). Today **Passion Fruit OG**
  (8 sacks of history, 386 sacks in inventory) drives ~24% of the total off a thin
  rate — a bad future batch could swing the headline 500+ lbs. Accepted trade-off;
  the next real batch sharpens it.
- **Flower-less rows nudge rates down.** Rows with `tops=0 AND smalls=0` pass the
  clean filter (system doc §4) and lower the affected cultivar's measured
  tops/sack — which only makes the projection *more* conservative, never higher.
- **37 lbs/sack assumption** flows through from the data model (see system doc §7).
- **Tops only.** Smalls/biomass/trim are intentionally not projected here.
- **All-history rates.** Fine while volumes are small. Revisit a rolling window
  (e.g. last 90 days) once a major cultivar exceeds ~1,000 sacks of history — by
  then old batches dominate by sheer count even if newer batches yield differently.

---

## 7. Source of truth

| Topic | Location |
|---|---|
| Endpoint + `projectFinishedTops` | `workers/src/handlers/supersack-d1.js` |
| CORS logic / allowlist | Logic lives in `workers/src/lib/cors.js`; the editable origin list is `ALLOWED_ORIGINS` in `workers/wrangler.toml` — **edit there** to add a site |
| Design rationale & decisions | `docs/plans/2026-05-27-supersack-tops-remaining-api-design.md` |
| Broader system | `docs/technical/SUPERSACK_ANALYTICS.md` |
