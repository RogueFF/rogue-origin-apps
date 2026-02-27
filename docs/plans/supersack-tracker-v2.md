# Supersack Tracker v2 — Daily Material Balance

## Overview

End-of-day entry tool for the water-spider to track supersack processing. Calculates full material balance: every pound in = every pound out.

## The Math

```
Supersacks × 37 lbs = Tops + Smalls + Biomass + Waste
```

- **Tops** — auto-pulled from hourly production data
- **Smalls** — auto-pulled from hourly production data
- **Biomass** (trim) — water-spider enters
- **Waste** (mold + sticks combined) — calculated as remainder

## Water-Spider Inputs (End of Day)

1. **Supersack count** — how many opened today
2. **Biomass (trim) weight** — lbs collected

## Auto-Pulled Data

- **Tops lbs** — from `monthly_production` table, sum for the day
- **Smalls lbs** — from `monthly_production` table, sum for the day
- **Strain breakdown** — which strains were processed (from hourly cultivar1 entries)

## Calculated

- **Waste** = (Supersacks × 37) - Tops - Smalls - Biomass
- **Yield percentages** — what % became tops, smalls, biomass, waste
- **Per-strain breakdown** — yield ratios by strain

## Dual Write — Pool Inventory API

When the water-spider submits, the tracker also pushes to the Shopify Pool Inventory API:
- Supersack count → pool update
- Biomass weight → pool update

**Pool API:** Google Apps Script (URL from env/secrets)
- `POST` with `action: "update_pool"`, `productId`, `operation: "add"`, `amount`
- Requires API key (stored as Cloudflare secret, never client-side)
- Proxy through our Worker to keep API key server-side

## Data Storage

### D1 Table: `supersack_daily`
```sql
CREATE TABLE IF NOT EXISTS supersack_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  production_date TEXT NOT NULL,
  supersack_count INTEGER NOT NULL DEFAULT 0,
  raw_weight_lbs REAL GENERATED ALWAYS AS (supersack_count * 37.0) STORED,
  biomass_lbs REAL NOT NULL DEFAULT 0,
  tops_lbs REAL NOT NULL DEFAULT 0,
  smalls_lbs REAL NOT NULL DEFAULT 0,
  waste_lbs REAL GENERATED ALWAYS AS (supersack_count * 37.0 - tops_lbs - smalls_lbs - biomass_lbs) STORED,
  submitted_by TEXT DEFAULT 'water-spider',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(production_date)
);
```

### Strain breakdown (optional, phase 2)
```sql
CREATE TABLE IF NOT EXISTS supersack_strain_breakdown (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  production_date TEXT NOT NULL,
  strain TEXT NOT NULL,
  tops_lbs REAL DEFAULT 0,
  smalls_lbs REAL DEFAULT 0,
  UNIQUE(production_date, strain)
);
```

## API Endpoints

Add to mission-control Worker:

- `POST /api/supersack/submit` — water-spider daily submission
  - Body: `{ date, supersack_count, biomass_lbs }`
  - Auto-pulls tops/smalls from production data for that date
  - Calculates waste
  - Saves to D1
  - Pushes to Pool Inventory API
  - Returns full breakdown

- `GET /api/supersack/history?days=30` — daily history for dashboard
- `GET /api/supersack/today` — current day status (pre-fill if already submitted)

## Frontend

**Standalone page** — mobile-friendly, similar to hourly-entry.html
- URL: `src/pages/supersack-tracker.html` (replace existing v1)
- Dark theme, simple form
- Shows today's production data (tops/smalls auto-filled)
- Water-spider enters supersack count + biomass
- Submit button calculates and saves
- Shows breakdown: pie/bar chart of yield percentages
- History view: last 7-30 days trend

**MC v2 integration** (phase 2):
- Yield analytics panel in dashboard
- Strain yield comparison
- Waste trending (are we getting better or worse?)

## Pool API Proxy

New Worker endpoint to proxy Pool Inventory API calls:
- `POST /api/pool-proxy/update` — forwards to Google Apps Script
- API key stored as Cloudflare secret (POOL_API_KEY, POOL_API_URL)
- Never exposed client-side

## Build Order

1. D1 migration (supersack_daily table)
2. API endpoints (submit, history, today)
3. Pool API proxy endpoint
4. Frontend page (water-spider entry form)
5. Testing with production data
6. Phase 2: MC v2 dashboard integration, strain breakdown
