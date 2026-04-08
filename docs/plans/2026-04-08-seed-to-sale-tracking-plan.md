# Seed-to-Sale Tracking — Implementation Plan (Phase 1: Germination → Planting)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a tracking system for hemp lots from seed through transplant/establishment, with mobile forms for greenhouse workers and field crew, weather auto-pull, and data stored in Cloudflare D1.

**Architecture:** New `/api/tracking` route on the existing Cloudflare Worker, using the same D1 database (`rogue-origin-db`). New mobile-friendly HTML pages in `src/pages/tracking/`. Follows existing patterns: action-based routing, `jsonResponse`/`errorResponse` helpers, `shared-base.css` variables. No build step.

**Tech Stack:** Cloudflare Workers (JS), D1 (SQLite), R2 (photos), vanilla HTML/CSS/JS with ES6 modules.

**Deadline:** May 1, 2026

---

## Task 1: D1 Schema — Tracking Tables

**Files:**
- Create: `workers/migrations/0004-tracking-tables.sql`
- Modify: `workers/src/lib/db.js` (add new table names to VALID_TABLES)

**Step 1: Write the migration SQL**

```sql
-- Seed-to-Sale Tracking Tables
-- Phase 1: Germination through Planting/Establishment

-- Locations: physical places (greenhouse, fields, barns, etc.)
CREATE TABLE IF NOT EXISTS tracking_locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- greenhouse, field, zone, barn, barn_room, cure_room, processing
  capacity REAL,
  capacity_unit TEXT,
  drying_method TEXT,
  parent_id TEXT REFERENCES tracking_locations(id),
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tracking_locations_type ON tracking_locations(type);
CREATE INDEX IF NOT EXISTS idx_tracking_locations_parent ON tracking_locations(parent_id);

-- Lots: a batch of plants moving through the pipeline
CREATE TABLE IF NOT EXISTS tracking_lots (
  id TEXT PRIMARY KEY,
  cultivar TEXT NOT NULL,
  seed_source TEXT,
  seed_lot_number TEXT,
  quantity REAL NOT NULL,
  unit TEXT NOT NULL, -- seeds, plants, lbs_wet, lbs_dry
  germ_method TEXT, -- plant_tape, plugs
  current_stage TEXT NOT NULL DEFAULT 'germination',
  current_location_id TEXT REFERENCES tracking_locations(id),
  is_replant INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracking_lots_stage ON tracking_lots(current_stage);
CREATE INDEX IF NOT EXISTS idx_tracking_lots_cultivar ON tracking_lots(cultivar);

-- Lot lineage: tracks splits, merges, re-plants
CREATE TABLE IF NOT EXISTS tracking_lot_lineage (
  id TEXT PRIMARY KEY,
  parent_lot_id TEXT NOT NULL REFERENCES tracking_lots(id),
  child_lot_id TEXT NOT NULL REFERENCES tracking_lots(id),
  quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  reason TEXT NOT NULL, -- split, merge, replant, harvest_to_room
  created_at TEXT DEFAULT (datetime('now')),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracking_lineage_parent ON tracking_lot_lineage(parent_lot_id);
CREATE INDEX IF NOT EXISTS idx_tracking_lineage_child ON tracking_lot_lineage(child_lot_id);

-- Stage transitions: lot moves from one stage to the next
CREATE TABLE IF NOT EXISTS tracking_stage_transitions (
  id TEXT PRIMARY KEY,
  lot_id TEXT NOT NULL REFERENCES tracking_lots(id),
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  quantity_in REAL,
  quantity_out REAL,
  unit TEXT,
  location_id TEXT REFERENCES tracking_locations(id),
  transitioned_at TEXT DEFAULT (datetime('now')),
  logged_by TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracking_transitions_lot ON tracking_stage_transitions(lot_id);
CREATE INDEX IF NOT EXISTS idx_tracking_transitions_stage ON tracking_stage_transitions(to_stage);

-- Observations: journal entries tied to a lot and/or location
CREATE TABLE IF NOT EXISTS tracking_observations (
  id TEXT PRIMARY KEY,
  lot_id TEXT REFERENCES tracking_lots(id),
  location_id TEXT REFERENCES tracking_locations(id),
  stage TEXT,
  observation_type TEXT NOT NULL, -- health, pest, growth, general, photo, watering, weekly_check
  content TEXT,
  photo_urls TEXT, -- JSON array of R2 keys
  severity TEXT DEFAULT 'info', -- info, warning, critical
  observed_at TEXT DEFAULT (datetime('now')),
  logged_by TEXT,
  metadata TEXT -- JSON: structured data (weight, height, ratings, etc.)
);

CREATE INDEX IF NOT EXISTS idx_tracking_observations_lot ON tracking_observations(lot_id);
CREATE INDEX IF NOT EXISTS idx_tracking_observations_location ON tracking_observations(location_id);
CREATE INDEX IF NOT EXISTS idx_tracking_observations_type ON tracking_observations(observation_type);
CREATE INDEX IF NOT EXISTS idx_tracking_observations_date ON tracking_observations(observed_at);

-- Environmental: greenhouse readings + auto-pulled weather
CREATE TABLE IF NOT EXISTS tracking_environmental (
  id TEXT PRIMARY KEY,
  location_id TEXT REFERENCES tracking_locations(id),
  source TEXT NOT NULL, -- manual, weather_api
  temp_f REAL,
  humidity_pct REAL,
  precip_in REAL,
  wind_mph REAL,
  recorded_at TEXT DEFAULT (datetime('now')),
  logged_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracking_environmental_location ON tracking_environmental(location_id);
CREATE INDEX IF NOT EXISTS idx_tracking_environmental_date ON tracking_environmental(recorded_at);

-- Inputs: water, nutrients, amendments applied
CREATE TABLE IF NOT EXISTS tracking_inputs (
  id TEXT PRIMARY KEY,
  lot_id TEXT REFERENCES tracking_lots(id),
  location_id TEXT REFERENCES tracking_locations(id),
  stage TEXT,
  input_type TEXT NOT NULL, -- water, nutrient, amendment, pesticide, other
  product_name TEXT,
  amount REAL,
  unit TEXT,
  applied_at TEXT DEFAULT (datetime('now')),
  logged_by TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracking_inputs_lot ON tracking_inputs(lot_id);
CREATE INDEX IF NOT EXISTS idx_tracking_inputs_date ON tracking_inputs(applied_at);

-- Planting passes: per-pass replacement counts during transplant
CREATE TABLE IF NOT EXISTS tracking_planting_passes (
  id TEXT PRIMARY KEY,
  lot_id TEXT NOT NULL REFERENCES tracking_lots(id),
  location_id TEXT NOT NULL REFERENCES tracking_locations(id),
  pass_number INTEGER NOT NULL,
  row_1_replacements INTEGER DEFAULT 0,
  row_2_replacements INTEGER DEFAULT 0,
  row_3_replacements INTEGER DEFAULT 0,
  reason TEXT, -- crickets, ungerminated, depth, other
  logged_by TEXT,
  logged_at TEXT DEFAULT (datetime('now')),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracking_planting_lot ON tracking_planting_passes(lot_id);

-- Re-plant events: per-row mortality counts
CREATE TABLE IF NOT EXISTS tracking_replants (
  id TEXT PRIMARY KEY,
  lot_id TEXT NOT NULL REFERENCES tracking_lots(id),
  location_id TEXT NOT NULL REFERENCES tracking_locations(id),
  row_data TEXT NOT NULL, -- JSON array: [{row: 1, count: 12, reason: "crickets"}, ...]
  trays_used REAL,
  source_lot_id TEXT REFERENCES tracking_lots(id),
  logged_by TEXT,
  logged_at TEXT DEFAULT (datetime('now')),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracking_replants_lot ON tracking_replants(lot_id);
```

**Step 2: Add table names to VALID_TABLES in db.js**

Add these to the `VALID_TABLES` Set in `workers/src/lib/db.js`:
```
'tracking_locations', 'tracking_lots', 'tracking_lot_lineage',
'tracking_stage_transitions', 'tracking_observations',
'tracking_environmental', 'tracking_inputs',
'tracking_planting_passes', 'tracking_replants'
```

**Step 3: Apply migration**

Run:
```bash
cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0004-tracking-tables.sql
```
Expected: Tables created successfully.

**Step 4: Commit**

```bash
git add workers/migrations/0004-tracking-tables.sql workers/src/lib/db.js
git commit -m "feat(tracking): add seed-to-sale tracking D1 schema"
```

---

## Task 2: Backend — Tracking API Handler (Lots + Locations)

**Files:**
- Create: `workers/src/handlers/tracking/index.js` — main router
- Create: `workers/src/handlers/tracking/lots.js` — lot CRUD
- Create: `workers/src/handlers/tracking/locations.js` — location CRUD
- Create: `workers/src/handlers/tracking/id.js` — ULID generator
- Modify: `workers/src/index.js` — add `/api/tracking` route

**Step 1: Create ULID generator**

File: `workers/src/handlers/tracking/id.js`
```javascript
/**
 * Simple ULID-like ID generator for tracking records.
 * Timestamp prefix (ms) + random suffix. Sortable by creation time.
 */
export function generateId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `${ts}-${rand}`;
}
```

**Step 2: Create locations handler**

File: `workers/src/handlers/tracking/locations.js`

Actions:
- `listLocations` — GET, optional filter by `type` and `parent_id`
- `getLocation` — GET by `id`
- `createLocation` — POST `{name, type, capacity, capacity_unit, drying_method, parent_id, notes}`
- `updateLocation` — POST `{id, ...fields}`
- `deleteLocation` — POST `{id}`
- `seedLocations` — POST — bulk-create the initial location hierarchy (greenhouse, fields A-N with zones, barns)

Follows same pattern as `pool-d1.js`: direct `env.DB.prepare()` calls, returns `jsonResponse()`.

**Step 3: Create lots handler**

File: `workers/src/handlers/tracking/lots.js`

Actions:
- `listLots` — GET, filter by `current_stage`, `cultivar`, `current_location_id`
- `getLot` — GET by `id`, includes lineage (parents + children) and recent transitions
- `createLot` — POST `{cultivar, seed_source, seed_lot_number, quantity, unit, germ_method, current_location_id, notes}`
- `updateLot` — POST `{id, ...fields}`
- `transitionStage` — POST `{lot_id, to_stage, quantity_in, quantity_out, unit, location_id, logged_by, notes}` — creates stage_transition record + updates lot.current_stage and lot.current_location_id
- `splitLot` — POST `{parent_lot_id, splits: [{quantity, unit, location_id, reason, notes}]}` — creates child lots + lineage records
- `mergeLots` — POST `{child_lot_id, parent_lot_ids: [{lot_id, quantity}], reason, notes}` — merges quantities into existing or new lot + lineage records
- `getLotHistory` — GET by `lot_id` — full timeline: transitions + observations + inputs + lineage, ordered by date

**Step 4: Create main tracking router**

File: `workers/src/handlers/tracking/index.js`
```javascript
import { jsonResponse, errorResponse } from '../../lib/response.js';
import { ApiError } from '../../lib/errors.js';
import * as lots from './lots.js';
import * as locations from './locations.js';

export async function handleTrackingD1(request, env, ctx) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  // Location actions
  if (action?.startsWith('location')) {
    return locations.handle(action, request, env);
  }

  // Lot actions
  return lots.handle(action, request, env);
}
```

**Step 5: Wire into main router**

In `workers/src/index.js`, add:
```javascript
import { handleTrackingD1 } from './handlers/tracking/index.js';
```
And in the routing block:
```javascript
} else if (path.startsWith('/api/tracking')) {
  response = await handleTrackingD1(request, env, ctx);
}
```
Also add to the health check endpoints array.

**Step 6: Test locally**

Run: `cd workers && npx wrangler dev`

Test:
```bash
# Create a location
curl -X POST "http://localhost:8787/api/tracking?action=createLocation" \
  -H "Content-Type: application/json" \
  -d '{"name":"Greenhouse 1","type":"greenhouse"}'

# Create a lot
curl -X POST "http://localhost:8787/api/tracking?action=createLot" \
  -H "Content-Type: application/json" \
  -d '{"cultivar":"Cherry Blossom","seed_source":"Oregon CBD","quantity":840,"unit":"seeds","germ_method":"plant_tape"}'

# List lots
curl "http://localhost:8787/api/tracking?action=listLots"
```

**Step 7: Commit**

```bash
git add workers/src/handlers/tracking/ workers/src/index.js
git commit -m "feat(tracking): add tracking API — lots, locations, transitions, lineage"
```

---

## Task 3: Backend — Observations, Environmental, Inputs, Planting

**Files:**
- Create: `workers/src/handlers/tracking/observations.js`
- Create: `workers/src/handlers/tracking/environmental.js`
- Create: `workers/src/handlers/tracking/inputs.js`
- Create: `workers/src/handlers/tracking/planting.js`
- Modify: `workers/src/handlers/tracking/index.js` — add routes

**Step 1: Create observations handler**

Actions:
- `createObservation` — POST `{lot_id, location_id, stage, observation_type, content, photo_urls, severity, logged_by, metadata}`
- `listObservations` — GET, filter by `lot_id`, `location_id`, `observation_type`, `date_from`, `date_to`
- `getObservation` — GET by `id`
- `logWatering` — POST `{lot_id, weight_lbs, action, logged_by}` — convenience action for greenhouse watering (creates observation with type=watering + structured metadata)
- `logWeeklyCheck` — POST `{location_id, height_inches, growth_rating, pest_pressure, pest_type, moisture_rating, photo_urls, notes, logged_by}` — weekly Monday zone check
- `logSapAnalysis` — POST `{farm_name, photo_urls, notes, logged_by}` — per-farm sap analysis upload

**Step 2: Create environmental handler**

Actions:
- `recordReading` — POST `{location_id, source, temp_f, humidity_pct, logged_by}`
- `listReadings` — GET, filter by `location_id`, `source`, `date_from`, `date_to`
- `getLatestReading` — GET by `location_id`

**Step 3: Create inputs handler**

Actions:
- `recordInput` — POST `{lot_id, location_id, stage, input_type, product_name, amount, unit, logged_by, notes}`
- `listInputs` — GET, filter by `lot_id`, `location_id`, `input_type`, `date_from`, `date_to`

**Step 4: Create planting handler**

Actions:
- `logPlantingPass` — POST `{lot_id, location_id, pass_number, row_1_replacements, row_2_replacements, row_3_replacements, reason, logged_by, notes}`
- `getPlantingPasses` — GET by `lot_id`
- `logReplant` — POST `{lot_id, location_id, row_data, trays_used, source_lot_id, logged_by, notes}` — also creates lineage record from source_lot to target lot
- `getReplants` — GET by `lot_id`
- `getPlantingSummary` — GET by `lot_id` — total replacements during planting + replants, per-row breakdown, reasons

**Step 5: Update router**

Add observation/environmental/input/planting action prefixes to `workers/src/handlers/tracking/index.js`.

**Step 6: Test locally**

```bash
# Log a watering event
curl -X POST "http://localhost:8787/api/tracking?action=logWatering" \
  -H "Content-Type: application/json" \
  -d '{"lot_id":"<lot_id>","weight_lbs":12.1,"action":"watered","logged_by":"Greenhouse Worker"}'

# Log a planting pass
curl -X POST "http://localhost:8787/api/tracking?action=logPlantingPass" \
  -H "Content-Type: application/json" \
  -d '{"lot_id":"<lot_id>","location_id":"<zone_id>","pass_number":1,"row_1_replacements":8,"row_2_replacements":12,"row_3_replacements":5,"reason":"crickets","logged_by":"Field Crew"}'
```

**Step 7: Commit**

```bash
git add workers/src/handlers/tracking/
git commit -m "feat(tracking): add observations, environmental, inputs, planting handlers"
```

---

## Task 4: Backend — Weather Auto-Pull (Cron)

**Files:**
- Create: `workers/src/handlers/tracking/weather.js`
- Modify: `workers/src/index.js` — add to cron trigger
- Modify: `workers/wrangler.toml` — add cron schedule if needed

**Step 1: Create weather handler**

File: `workers/src/handlers/tracking/weather.js`

Uses Open-Meteo API (free, no key needed):
```
https://api.open-meteo.com/v1/forecast?latitude=42.3956&longitude=-122.7286&daily=temperature_2m_max,temperature_2m_min,relative_humidity_2m_mean,precipitation_sum,wind_speed_10m_max&temperature_unit=fahrenheit&precipitation_unit=inch&wind_speed_unit=mph&timezone=America/Los_Angeles
```

Coordinates: White City, OR (42.3956, -122.7286)

Function: `pullDailyWeather(env)`:
1. Fetch from Open-Meteo
2. Extract today's values
3. Insert into `tracking_environmental` with source='weather_api'
4. Use a "farm" location_id (top-level farm location)

**Step 2: Add to cron trigger**

In `workers/src/index.js` `scheduled()` handler, add weather pull after complaints sync:
```javascript
try {
  const { pullDailyWeather } = await import('./handlers/tracking/weather.js');
  await pullDailyWeather(env);
  console.log('[Cron] Weather data pulled');
} catch (e) {
  console.error(`[Cron] Weather pull failed: ${e.message}`);
}
```

Existing cron runs at 14:00 UTC (6 AM PST) — fine for daily weather.

**Step 3: Test manually**

```bash
# Test the Open-Meteo endpoint directly
curl "https://api.open-meteo.com/v1/forecast?latitude=42.3956&longitude=-122.7286&daily=temperature_2m_max,temperature_2m_min,relative_humidity_2m_mean,precipitation_sum,wind_speed_10m_max&temperature_unit=fahrenheit&precipitation_unit=inch&wind_speed_unit=mph&timezone=America/Los_Angeles&forecast_days=1"

# Test via worker (add a manual trigger action)
curl -X POST "http://localhost:8787/api/tracking?action=pullWeather"
```

**Step 4: Commit**

```bash
git add workers/src/handlers/tracking/weather.js workers/src/index.js
git commit -m "feat(tracking): add daily weather auto-pull via Open-Meteo cron"
```

---

## Task 5: Frontend — Seed Location Setup Page

**Files:**
- Create: `src/pages/tracking/setup.html` — one-time setup page to seed initial locations

**Step 1: Build setup page**

Simple admin page that:
1. Shows current locations (tree view: parent → children)
2. Has a "Seed Default Locations" button that creates:
   - Mcloughlin Farm (top-level)
   - Greenhouse 1 (child of farm)
   - Fields A-N (children of farm), each with zones based on field acreage / 1 acre per zone
   - Upper Barn → 4 zones
   - Bottom Barn → 6 zones (3 per side × 2 sides)
3. Allows adding/editing individual locations

Style: Uses `shared-base.css` variables. Mobile-friendly. Bilingual labels (EN/ES).

**Step 2: Test in browser**

Run: `python -m http.server` from project root.
Navigate to: `http://localhost:8000/src/pages/tracking/setup.html`
Expected: Can seed locations and see them in tree view.

**Step 3: Commit**

```bash
git add src/pages/tracking/
git commit -m "feat(tracking): add location setup page"
```

---

## Task 6: Frontend — Lot Management Page

**Files:**
- Create: `src/pages/tracking/lots.html` — create/view/manage lots

**Step 1: Build lot management page**

Desktop-friendly page (Koa uses this) for:
1. **Create Lot** form: cultivar, seed source, lot #, quantity (default 840), unit (seeds), germ method (plant_tape/plugs), target location, notes
2. **Active Lots** table: shows all lots with current stage, location, quantity, age
3. **Lot Detail** view: click a lot to see full history timeline (transitions, observations, lineage graph)
4. **Stage Transition** button: advance a lot to next stage (with quantity in/out fields)
5. **Split/Merge** UI: select a lot, split into N child lots with quantities and destinations

Style: Consistent with existing app pages. Uses `shared-base.css`. Bilingual.

**Step 2: Test in browser**

Navigate to: `http://localhost:8000/src/pages/tracking/lots.html`
Expected: Can create a lot, see it in the table, view its detail.

**Step 3: Commit**

```bash
git add src/pages/tracking/lots.html
git commit -m "feat(tracking): add lot management page"
```

---

## Task 7: Frontend — Greenhouse Mobile Form

**Files:**
- Create: `src/pages/tracking/greenhouse.html` — mobile-first form for greenhouse worker

**Step 1: Build greenhouse form**

This is THE critical daily-use form. Must be dead simple on a phone.

**Tabs at top:**
1. **Water** — Log watering event
   - Batch # (dropdown of active germination lots)
   - Weight (lbs) — number input, large touch target
   - Action: Watered / No action needed
   - Submit button
   - Shows last 5 watering events for selected batch below form

2. **GH Reading** — Log greenhouse temp/humidity
   - Temp (°F) — number input
   - RH (%) — number input
   - Submit button
   - Shows today's readings below

3. **Note** — Quick observation
   - Batch # (dropdown, optional)
   - Note text
   - Photo button (camera capture)
   - Severity: info/warning/critical
   - Submit button

**Crew name selector** at top (persisted in localStorage). Dropdown of common names + "Other" with text input.

**Design requirements:**
- Large inputs (min 44px height)
- Minimal scrolling — form visible without scroll on most phones
- Auto-timestamp
- Success feedback (green flash / checkmark on submit)
- Works offline-ish (show last cached data if no connection, queue submissions)
- Bilingual toggle (EN/ES)

**Step 2: Test on mobile**

Run local server, access from phone on same network. Test watering flow end-to-end.

**Step 3: Commit**

```bash
git add src/pages/tracking/greenhouse.html
git commit -m "feat(tracking): add greenhouse mobile form — watering, readings, observations"
```

---

## Task 8: Frontend — Planting Mobile Form

**Files:**
- Create: `src/pages/tracking/planting.html` — mobile form for field crew during transplant

**Step 1: Build planting form**

**Two modes (tabs):**

1. **Planting Pass** — used during Plant Tape machine operation
   - Zone (dropdown of active field zones)
   - Pass # (auto-increments, editable)
   - Row 1 replacements (number)
   - Row 2 replacements (number)
   - Row 3 replacements (number)
   - Reason (dropdown: crickets, ungerminated, depth, other)
   - Notes (optional)
   - Submit
   - Shows running totals for this zone below

2. **Re-plant** — used during follow-up walks
   - Zone (dropdown)
   - Row-by-row entry (expandable: add rows as needed)
     - Row #, Count, Reason (dropdown)
   - Trays used (number)
   - Notes
   - Submit
   - Shows total re-plants for this zone below

**Same design principles as greenhouse form:** crew name selector, large touch targets, bilingual, success feedback.

**Step 2: Test on mobile**

Test planting pass flow — enter replacements for 3 rows, submit, verify totals update.

**Step 3: Commit**

```bash
git add src/pages/tracking/planting.html
git commit -m "feat(tracking): add planting/replant mobile form"
```

---

## Task 9: Frontend — Weekly Check Form

**Files:**
- Create: `src/pages/tracking/weekly-check.html` — structured Monday zone walk

**Step 1: Build weekly check form**

Used by Koa on Mondays. Can work on phone or tablet.

**Per-zone form:**
- Zone (dropdown)
- Week # (auto-calculated from season start)
- Height (avg inches)
- Growth rating (1-5, visual star/button selector)
- Pest pressure (none/low/moderate/heavy — button group)
- Pest type (dropdown, shown if pest pressure > none)
- Moisture rating (dry/good/saturated — button group)
- Photo (camera capture)
- Notes
- Submit

**Sap Analysis section (separate, per-farm):**
- Farm (dropdown)
- Upload PDF/image
- Notes
- Submit

**Shows previous weeks' data** for comparison (mini chart of height over time, last 4 weeks of readings per zone).

**Step 2: Commit**

```bash
git add src/pages/tracking/weekly-check.html
git commit -m "feat(tracking): add weekly zone check and sap analysis form"
```

---

## Task 10: Frontend — Tracking Dashboard / Hub

**Files:**
- Create: `src/pages/tracking/index.html` — main tracking hub page

**Step 1: Build tracking hub**

Landing page that links to all tracking forms + shows status overview.

**Sections:**
1. **Quick Links** — big buttons to: Greenhouse Form, Planting Form, Weekly Check, Lot Management, Setup
2. **Active Lots** — summary cards showing current lots, their stage, and age
3. **Today's Activity** — recent observations, watering events, weather
4. **Alerts** — any lots that haven't been checked in >24 hours during germination, critical observations

Style: Consistent with main ops hub. Mobile and desktop friendly.

**Step 2: Add navigation link from main dashboard**

Add "Field Tracking" to the sidebar nav in `src/pages/index.html` (in the "Coming Soon" section, move it to active).

**Step 3: Commit**

```bash
git add src/pages/tracking/ src/pages/index.html
git commit -m "feat(tracking): add tracking hub page and nav link"
```

---

## Task 11: Deploy + Seed Data + End-to-End Test

**Step 1: Deploy worker**

```bash
cd workers && npx wrangler deploy
```

**Step 2: Apply migration to production D1**

```bash
npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0004-tracking-tables.sql
```

**Step 3: Seed locations via setup page**

Navigate to live setup page. Click "Seed Default Locations". Verify tree renders correctly.

**Step 4: End-to-end walkthrough**

Simulate the full germination→planting flow:
1. Create a lot (Cherry Blossom, 840 seeds, plant_tape)
2. Log a watering event via greenhouse form
3. Log a GH reading
4. Transition lot to transplant stage
5. Log a planting pass with replacement counts
6. Log a replant event
7. Verify lot history shows complete timeline
8. Check weather data was auto-pulled

**Step 5: Push**

Confirm with user, then:
```bash
git push origin master
```

**Step 6: Verify live**

Check GitHub Pages deployment. Test mobile forms on phone.

---

## Task Summary

| Task | What | Priority |
|------|------|----------|
| 1 | D1 schema + migration | Must have |
| 2 | API: lots + locations | Must have |
| 3 | API: observations, environmental, inputs, planting | Must have |
| 4 | Weather cron | Must have |
| 5 | Setup page (locations) | Must have |
| 6 | Lot management page | Must have |
| 7 | Greenhouse mobile form | Must have (daily use) |
| 8 | Planting mobile form | Must have (planting days) |
| 9 | Weekly check form | Nice to have (can add week 2) |
| 10 | Tracking hub | Nice to have (can add week 2) |
| 11 | Deploy + seed + test | Must have |

**Critical path:** Tasks 1 → 2 → 3 → 4 can be done in parallel with 5 → 6 → 7 → 8 (backend vs frontend). Task 11 depends on all others.
