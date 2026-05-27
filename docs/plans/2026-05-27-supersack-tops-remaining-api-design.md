# Supersack — Finished Tops Remaining API

> **Goal:** A single public endpoint the company website can poll to show
> *projected finished tops (lbs) still locked in raw supersack inventory.*
> No Google Sheet — the web developer consumes the JSON directly.

**Date:** 2026-05-27
**Status:** Designed, approved (3 decision points confirmed with owner)

---

## What it answers

> "Given the raw supersacks we have on hand right now, how many pounds of
> finished **tops** will they produce?"

`projected tops = Σ over cultivars ( inventory_sacks × tops_per_sack )`

## Endpoint

```
GET /api/supersack?action=tops_remaining
```

Added as a new `action` in the existing `workers/src/handlers/supersack-d1.js`.
No new handler file, no new table, no new infrastructure.

### Response

```json
{
  "finished_tops_lbs": 6578,
  "as_of": "2026-05-27T18:22:00.000Z",
  "inventory_sacks": 1943
}
```

Minimal by request. `inventory_sacks` is the denominator the consumer will
inevitably want; `as_of` lets the site show freshness / detect a stale cache.

## Data flow (single request)

1. **D1** — compute each cultivar's measured `tops_per_sack` from
   `supersack_entries`, reusing the *same* "clean data" filter the `summary`
   action already runs in production:
   `biomass_lbs > 0 AND trim_lbs > 0 AND (tops+smalls+biomass+trim) <= raw_lbs * 1.3`.
   Rates use **all clean history** (most data = most stable rate), not a window.
2. **GAS proxy** — internal POST to `POOL_INVENTORY_API_URL` with
   `action=get_supersack_variants` for current inventory `{title, quantity}`.
   Inventory titles match D1 strain names exactly (`"2025 - Lifter / Sungrown"`),
   so the join is exact — no fuzzy matching.
3. **Compute** — pick a rate per cultivar (rules below), multiply by sacks, sum.
4. **Cache** — wrap result in the Cloudflare Cache API, **5-minute TTL** (hot
   key). Inventory changes ~1–2×/day; the cache protects the GAS/Shopify quota
   from public page-view traffic. Caching is mandatory for a public-site hook.
5. **Outage fallback** — every successful compute also stashes a 24-hour
   "last-good" copy under a separate key. If a later D1/GAS fetch fails, the
   endpoint serves that stale-but-real number (HTTP 200, `X-Stale: true` header,
   original `as_of`) instead of a 502, so a brief upstream hiccup never breaks
   the website. Only a cold first-ever request during an outage returns 502.

## Rate selection (the core logic)

For each cultivar in inventory:

| Condition | Rate used |
|---|---|
| Has ≥1 clean sack of history **and** rate is not a high anomaly | its **own** measured tops/sack |
| No clean history | the **floor** |
| Rate is a **high** anomaly (too good to be true) | the **floor** |

- **Floor** = the *lowest* tops/sack among cultivars whose rate we trust.
  Today that is **~2.24** (Berry Bliss, n=24).
- **Anomaly test** = robust outlier detection: median ± `3 × scaled MAD`
  (median absolute deviation × 1.4826) across all cultivar rates.
  **Conservative / high-only lean:** only rates *above* the upper fence are
  distrusted (→ floor). A surprisingly *low* rate is trusted as-is, so the
  estimate never gets bumped upward — matches "use the lowest yield until more
  data is collected."
- With today's data the test flags **nothing** (all 11 tracked cultivars sit in
  2.24–4.83). The rule only activates for future garbage (e.g. a 1-sack strain
  reading 9 tops/sack).

### Confirmed decisions

1. **Anomaly lean:** Conservative (high-only). Low outliers trusted.
2. **Thin samples:** Trusted. Any cultivar with ≥1 clean sack uses its own rate,
   including Passion Fruit OG (n=8) which alone drives ~1,600 lbs / ~24% of the
   total. Owner accepts the volatility; a bad future PFO batch could swing the
   headline number 500+ lbs.
3. **Payload:** Minimal (`finished_tops_lbs`, `as_of`, `inventory_sacks`).

## Today's expected output

`~6,578 lbs` = 5,989 (tracked cultivars at own rates) + 589 (263 uncharacterized
sacks × 2.24 floor). Used as the implementation acceptance check.

## Testability

Extract the math into a pure function
`projectFinishedTops(strainStats, inventory)` (no I/O) so the rate-selection,
floor, and anomaly logic can be unit-tested with fixtures independent of D1 and
the GAS proxy.

## Revisit later

- **Rolling window for rates (≥~1000 sacks/strain).** Rates use *all* clean
  history — correct today (maximize data). Once a major strain has heavy history,
  old 2025 batches will dominate by sack count even if newer batches yield
  differently; at that point switch to a rolling window (e.g. last 90 days) as
  the better predictor.

## Out of scope (YAGNI)

- Google Sheet (removed — data already flows through D1 + Shopify).
- Per-cultivar breakdown array in the response.
- Smalls / biomass / trim projections (tops only).
- Front-end widget (the website developer builds it).
