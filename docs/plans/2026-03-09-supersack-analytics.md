# Supersack Analytics Dashboard — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a standalone analytics page (`supersack-analytics.html`) with historical KPIs, material yield breakdowns, strain efficiency, remaining inventory projections, and production rate/cost metrics — backed by a new D1 table + API endpoints, backfilled from existing data.

**Architecture:** New `supersack_entries` D1 table stores per-date-per-strain supersack data. New handler at `/api/supersack` provides submit (upsert), history (date range), and backfill endpoints. The analytics page fetches history + production data and renders charts (Chart.js) + KPI cards. Backfill pulls from pool API change logs + `monthly_production` table.

**Tech Stack:** Cloudflare Workers (D1), Chart.js (CDN), pure HTML/CSS/JS (no build system)

---

## Task 1: D1 Schema — `supersack_entries` Table

**Files:**
- Modify: `workers/schema.sql` (append new table)

**Step 1: Add table definition to schema.sql**

Append to `workers/schema.sql`:

```sql
-- ============================================
-- SUPERSACK TRACKING
-- ============================================

CREATE TABLE IF NOT EXISTS supersack_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  strain TEXT NOT NULL,
  sacks_opened INTEGER NOT NULL DEFAULT 0,
  tops_lbs REAL NOT NULL DEFAULT 0,
  smalls_lbs REAL NOT NULL DEFAULT 0,
  biomass_lbs REAL NOT NULL DEFAULT 0,
  trim_lbs REAL NOT NULL DEFAULT 0,
  waste_lbs REAL NOT NULL DEFAULT 0,
  raw_lbs REAL NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(date, strain)
);

CREATE INDEX IF NOT EXISTS idx_supersack_date ON supersack_entries(date);
CREATE INDEX IF NOT EXISTS idx_supersack_strain ON supersack_entries(strain);
```

**Step 2: Apply schema to D1**

```bash
cd workers
npx wrangler d1 execute rogue-origin-db --remote --command "CREATE TABLE IF NOT EXISTS supersack_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, strain TEXT NOT NULL, sacks_opened INTEGER NOT NULL DEFAULT 0, tops_lbs REAL NOT NULL DEFAULT 0, smalls_lbs REAL NOT NULL DEFAULT 0, biomass_lbs REAL NOT NULL DEFAULT 0, trim_lbs REAL NOT NULL DEFAULT 0, waste_lbs REAL NOT NULL DEFAULT 0, raw_lbs REAL NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), UNIQUE(date, strain));"
npx wrangler d1 execute rogue-origin-db --remote --command "CREATE INDEX IF NOT EXISTS idx_supersack_date ON supersack_entries(date);"
npx wrangler d1 execute rogue-origin-db --remote --command "CREATE INDEX IF NOT EXISTS idx_supersack_strain ON supersack_entries(strain);"
```

**Step 3: Commit**

```bash
git add workers/schema.sql
git commit -m "feat: add supersack_entries table schema for analytics tracking"
```

---

## Task 2: Worker Handler — `/api/supersack`

**Files:**
- Create: `workers/src/handlers/supersack-d1.js`
- Modify: `workers/src/index.js` (add route)

**Step 1: Create the handler**

Create `workers/src/handlers/supersack-d1.js` with these actions:

- `submit` (POST) — upsert a supersack entry per date+strain
- `history` (GET) — query date range, returns daily entries
- `summary` (GET) — aggregated KPIs for a date range
- `backfill` (POST) — one-time backfill from pool API + production data

```javascript
/**
 * Supersack Analytics API Handler
 * Manages supersack_entries table for historical tracking + analytics.
 */

import { successResponse, errorResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';

export async function handleSupersackD1(request, env, ctx) {
  const body = request.method === 'POST' ? await parseBody(request) : {};
  const action = getAction(request, body);
  const params = getQueryParams(request);

  switch (action) {
    case 'test':
      return successResponse({ ok: true, service: 'Supersack Analytics' });

    case 'submit':
      return await submit(body, env);

    case 'history':
      return await history(params, env);

    case 'summary':
      return await summary(params, env);

    case 'backfill':
      return await backfill(body, env);

    default:
      return errorResponse(`Unknown action: ${action}`, 'VALIDATION_ERROR', 400);
  }
}

/** Upsert supersack entry per date+strain */
async function submit(body, env) {
  const { date, strains, biomass_lbs = 0, trim_lbs = 0, tops_lbs = 0, smalls_lbs = 0, supersack_count = 0, waste_lbs = 0 } = body;

  if (!date) return errorResponse('date is required', 'VALIDATION_ERROR', 400);

  const db = env.DB;
  const SACK_WEIGHT = 37;

  // If strains object provided (per-strain sack counts), upsert each
  if (strains && typeof strains === 'object') {
    const strainEntries = Object.entries(strains).filter(([, count]) => count > 0);
    const totalSacks = strainEntries.reduce((sum, [, count]) => sum + count, 0);

    for (const [strain, sacks] of strainEntries) {
      const ratio = sacks / totalSacks;
      const raw = sacks * SACK_WEIGHT;
      const strainTops = tops_lbs * ratio;
      const strainSmalls = smalls_lbs * ratio;
      const strainBio = biomass_lbs * ratio;
      const strainTrim = trim_lbs * ratio;
      const strainWaste = Math.max(0, raw - strainTops - strainSmalls - strainBio - strainTrim);

      await db.prepare(`
        INSERT INTO supersack_entries (date, strain, sacks_opened, tops_lbs, smalls_lbs, biomass_lbs, trim_lbs, waste_lbs, raw_lbs)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date, strain) DO UPDATE SET
          sacks_opened = excluded.sacks_opened,
          tops_lbs = excluded.tops_lbs,
          smalls_lbs = excluded.smalls_lbs,
          biomass_lbs = excluded.biomass_lbs,
          trim_lbs = excluded.trim_lbs,
          waste_lbs = excluded.waste_lbs,
          raw_lbs = excluded.raw_lbs,
          updated_at = datetime('now')
      `).bind(date, strain, sacks, strainTops, strainSmalls, strainBio, strainTrim, strainWaste, raw).run();
    }

    return successResponse({ success: true, entries: strainEntries.length });
  }

  // Single-strain fallback
  const raw = supersack_count * SACK_WEIGHT;
  const strain = body.strain || 'Unknown';
  const computedWaste = waste_lbs || Math.max(0, raw - tops_lbs - smalls_lbs - biomass_lbs - trim_lbs);

  await db.prepare(`
    INSERT INTO supersack_entries (date, strain, sacks_opened, tops_lbs, smalls_lbs, biomass_lbs, trim_lbs, waste_lbs, raw_lbs)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, strain) DO UPDATE SET
      sacks_opened = excluded.sacks_opened,
      tops_lbs = excluded.tops_lbs,
      smalls_lbs = excluded.smalls_lbs,
      biomass_lbs = excluded.biomass_lbs,
      trim_lbs = excluded.trim_lbs,
      waste_lbs = excluded.waste_lbs,
      raw_lbs = excluded.raw_lbs,
      updated_at = datetime('now')
  `).bind(date, strain, supersack_count, tops_lbs, smalls_lbs, biomass_lbs, trim_lbs, computedWaste, raw).run();

  return successResponse({ success: true });
}

/** Query history for date range */
async function history(params, env) {
  const { start, end, strain } = params;
  const db = env.DB;

  let sql = 'SELECT * FROM supersack_entries WHERE 1=1';
  const binds = [];

  if (start) { sql += ' AND date >= ?'; binds.push(start); }
  if (end) { sql += ' AND date <= ?'; binds.push(end); }
  if (strain) { sql += ' AND strain = ?'; binds.push(strain); }

  sql += ' ORDER BY date DESC, strain';

  const result = await db.prepare(sql).bind(...binds).all();
  return successResponse({ entries: result.results });
}

/** Aggregated summary for date range */
async function summary(params, env) {
  const { start, end, strain, group_by = 'day' } = params;
  const db = env.DB;

  // Date grouping expression
  const groupExpr = group_by === 'month' ? "strftime('%Y-%m', date)"
    : group_by === 'week' ? "strftime('%Y-W%W', date)"
    : 'date';

  let sql = `
    SELECT ${groupExpr} as period,
      SUM(sacks_opened) as total_sacks,
      SUM(raw_lbs) as total_raw,
      SUM(tops_lbs) as total_tops,
      SUM(smalls_lbs) as total_smalls,
      SUM(biomass_lbs) as total_biomass,
      SUM(trim_lbs) as total_trim,
      SUM(waste_lbs) as total_waste,
      COUNT(DISTINCT date) as days_worked,
      COUNT(DISTINCT strain) as strain_count
    FROM supersack_entries WHERE 1=1`;
  const binds = [];

  if (start) { sql += ' AND date >= ?'; binds.push(start); }
  if (end) { sql += ' AND date <= ?'; binds.push(end); }
  if (strain) { sql += ' AND strain = ?'; binds.push(strain); }

  sql += ` GROUP BY ${groupExpr} ORDER BY period DESC`;

  const result = await db.prepare(sql).bind(...binds).all();

  // Also get per-strain totals
  let strainSql = `
    SELECT strain,
      SUM(sacks_opened) as total_sacks,
      SUM(raw_lbs) as total_raw,
      SUM(tops_lbs) as total_tops,
      SUM(smalls_lbs) as total_smalls,
      SUM(biomass_lbs) as total_biomass,
      SUM(trim_lbs) as total_trim,
      SUM(waste_lbs) as total_waste,
      COUNT(DISTINCT date) as days_worked
    FROM supersack_entries WHERE 1=1`;
  const strainBinds = [];

  if (start) { strainSql += ' AND date >= ?'; strainBinds.push(start); }
  if (end) { strainSql += ' AND date <= ?'; strainBinds.push(end); }

  strainSql += ' GROUP BY strain ORDER BY total_sacks DESC';

  const strainResult = await db.prepare(strainSql).bind(...strainBinds).all();

  return successResponse({
    periods: result.results,
    strains: strainResult.results,
  });
}

/** One-time backfill from pool API change logs + monthly_production */
async function backfill(body, env) {
  const db = env.DB;
  const results = { supersack_entries: 0, errors: [] };

  // 1. Backfill from pool API recent changes (supersack + biomass/trim)
  // Caller passes these arrays from the frontend (fetched from pool API)
  const { supersack_changes = [], pool_changes = [], production_data = [] } = body;

  // Group supersack changes by date + strain
  const dateStrainMap = {}; // { 'date|strain': { sacks, biomass, trim } }

  for (const entry of supersack_changes) {
    const d = new Date(entry.timestamp);
    const dateStr = d.toISOString().slice(0, 10);
    const strain = entry.variantTitle || 'Unknown';
    const key = `${dateStr}|${strain}`;

    if (!dateStrainMap[key]) {
      dateStrainMap[key] = { date: dateStr, strain, sacks: 0, biomass: 0, trim: 0 };
    }
    // Subtract actions = sacks opened
    if (entry.action === 'subtract') {
      dateStrainMap[key].sacks += Math.abs(entry.changeAmount || 0);
    }
  }

  // Parse biomass/trim from pool changes (notes contain date)
  for (const entry of pool_changes) {
    const note = entry.note || '';
    const match = note.match(/\[Supersack Tracker\]\s*(Biomass|Trim)\s*\+?([\d.]+)\s*lbs\s*\((\d{4}-\d{2}-\d{2})\)/i);
    if (!match) continue;

    const type = match[1].toLowerCase(); // 'biomass' or 'trim'
    const amount = parseFloat(match[2]);
    const dateStr = match[3];

    // Find matching date entries and distribute proportionally
    const dateEntries = Object.values(dateStrainMap).filter(e => e.date === dateStr);
    const totalSacks = dateEntries.reduce((sum, e) => sum + e.sacks, 0);

    if (totalSacks > 0) {
      for (const e of dateEntries) {
        const ratio = e.sacks / totalSacks;
        e[type] += amount * ratio;
      }
    }
  }

  // Match production data (tops/smalls) to dates
  const prodByDate = {};
  for (const entry of production_data) {
    const dateStr = entry.date || entry.production_date;
    if (!dateStr) continue;
    if (!prodByDate[dateStr]) prodByDate[dateStr] = { tops: 0, smalls: 0 };
    prodByDate[dateStr].tops += entry.tops_lbs || entry.tops || 0;
    prodByDate[dateStr].smalls += entry.smalls_lbs || entry.smalls || 0;
  }

  // Upsert all entries
  const SACK_WEIGHT = 37;
  for (const entry of Object.values(dateStrainMap)) {
    if (entry.sacks === 0) continue;

    const raw = entry.sacks * SACK_WEIGHT;
    const prod = prodByDate[entry.date] || { tops: 0, smalls: 0 };

    // Distribute production proportionally if multiple strains on same day
    const sameDayEntries = Object.values(dateStrainMap).filter(e => e.date === entry.date);
    const totalDaySacks = sameDayEntries.reduce((sum, e) => sum + e.sacks, 0);
    const ratio = entry.sacks / totalDaySacks;

    const tops = prod.tops * ratio;
    const smalls = prod.smalls * ratio;
    const waste = Math.max(0, raw - tops - smalls - entry.biomass - entry.trim);

    try {
      await db.prepare(`
        INSERT INTO supersack_entries (date, strain, sacks_opened, tops_lbs, smalls_lbs, biomass_lbs, trim_lbs, waste_lbs, raw_lbs)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date, strain) DO UPDATE SET
          sacks_opened = excluded.sacks_opened,
          tops_lbs = excluded.tops_lbs,
          smalls_lbs = excluded.smalls_lbs,
          biomass_lbs = excluded.biomass_lbs,
          trim_lbs = excluded.trim_lbs,
          waste_lbs = excluded.waste_lbs,
          raw_lbs = excluded.raw_lbs,
          updated_at = datetime('now')
      `).bind(entry.date, entry.strain, entry.sacks, tops, smalls, entry.biomass, entry.trim, waste, raw).run();
      results.supersack_entries++;
    } catch (e) {
      results.errors.push(`${entry.date}|${entry.strain}: ${e.message}`);
    }
  }

  return successResponse({ success: true, ...results });
}
```

**Step 2: Add route to `workers/src/index.js`**

Add import at top:
```javascript
import { handleSupersackD1 } from './handlers/supersack-d1.js';
```

Add route before the pool-bins route:
```javascript
} else if (path.startsWith('/api/supersack')) {
  response = await handleSupersackD1(request, env, ctx);
}
```

Add to health check endpoints array:
```javascript
endpoints: [..., '/api/supersack']
```

**Step 3: Commit**

```bash
git add workers/src/handlers/supersack-d1.js workers/src/index.js
git commit -m "feat: add /api/supersack handler with submit, history, summary, backfill"
```

---

## Task 3: Update Supersack Entry Page — Wire Up Submit to D1

**Files:**
- Modify: `src/pages/supersack-entry.html` (~line 1195)

**Step 1: Update the D1 submit call**

Change the MC_API endpoint reference and the submit payload to use the main API:

Replace the `MC_API` constant:
```javascript
const MC_API = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/supersack';
```

Replace the D1 save block (inside submit handler, around line 1193-1205) with:
```javascript
// 4. Save to D1 supersack_entries table
try {
  await fetch(`${MC_API}?action=submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date, supersack_count: sackCount, biomass_lbs: biomass,
      trim_lbs: trim, tops_lbs: topsLbs, smalls_lbs: smallsLbs,
      waste_lbs: Math.max(0, (sackCount * SACK_WEIGHT) - topsLbs - smallsLbs - biomass - trim),
      strains: Object.fromEntries(Object.entries(strainData).map(([k, v]) => [k, v.sacks])),
    }),
  });
} catch (e) {
  console.warn('[Supersack] D1 save failed:', e.message);
}
```

**Step 2: Commit**

```bash
git add src/pages/supersack-entry.html
git commit -m "feat: wire supersack entry submit to D1 /api/supersack endpoint"
```

---

## Task 4: Deploy Worker + Apply Schema

**Step 1: Deploy**

```bash
cd workers
npx wrangler deploy
```

**Step 2: Verify endpoints**

```bash
curl "https://rogue-origin-api.roguefamilyfarms.workers.dev/api/supersack?action=test"
# Expected: {"ok":true,"service":"Supersack Analytics"}

curl "https://rogue-origin-api.roguefamilyfarms.workers.dev/api/supersack?action=history&start=2026-01-01&end=2026-03-09"
# Expected: {"entries":[]}
```

**Step 3: Commit (if any deploy config changes)**

---

## Task 5: Backfill Script Page (Temporary)

**Files:**
- Create: `src/pages/supersack-backfill.html` (temporary utility page)

**Purpose:** Fetches historical data from pool API + production API, then POSTs to the backfill endpoint. Run once, then delete.

This page will:
1. Fetch `get_supersack_recent_changes` (all supersack subtract transactions)
2. Fetch `get_recent_changes` (pool changes for biomass/trim with `[Supersack Tracker]` notes)
3. Fetch production data from `monthly_production` via `/api/production?action=getProduction` for each date found
4. POST everything to `/api/supersack?action=backfill`
5. Display results

```html
<!-- Simple utility page — delete after use -->
<!DOCTYPE html>
<html><head><title>Supersack Backfill</title></head>
<body style="font-family:monospace;background:#141816;color:#e8e4dc;padding:20px">
<h2>Supersack Data Backfill</h2>
<button id="run" style="padding:12px 24px;font-size:16px;cursor:pointer">Run Backfill</button>
<pre id="log" style="margin-top:20px;white-space:pre-wrap"></pre>
<script>
const POOL_API = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/pool';
const PROD_API = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production';
const SS_API = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/supersack';
const log = (msg) => { document.getElementById('log').textContent += msg + '\n'; };

document.getElementById('run').onclick = async () => {
  document.getElementById('run').disabled = true;
  log('Fetching supersack changes...');

  const ssRes = await fetch(`${POOL_API}?action=get_supersack_recent_changes`, {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}'
  }).then(r => r.json());
  const supersack_changes = ssRes.entries || [];
  log(`  Found ${supersack_changes.length} supersack entries`);

  log('Fetching pool changes (biomass/trim)...');
  const poolRes = await fetch(`${POOL_API}?action=get_recent_changes`, {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}'
  }).then(r => r.json());
  const pool_changes = (poolRes.entries || []).filter(e => (e.note || '').includes('[Supersack Tracker]'));
  log(`  Found ${pool_changes.length} tracker pool entries`);

  // Get unique dates from supersack changes
  const dates = [...new Set(supersack_changes.map(e => new Date(e.timestamp).toISOString().slice(0,10)))];
  log(`  Dates found: ${dates.join(', ')}`);

  log('Fetching production data...');
  const start = dates.length ? dates.sort()[0] : '2026-01-01';
  const end = dates.length ? dates.sort().pop() : '2026-03-09';
  const prodRes = await fetch(`${PROD_API}?action=getProduction&start=${start}&end=${end}`).then(r => r.json());
  const production_data = prodRes.entries || prodRes.data || [];
  log(`  Found ${production_data.length} production entries`);

  log('Sending backfill...');
  const result = await fetch(`${SS_API}?action=backfill`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ supersack_changes, pool_changes, production_data })
  }).then(r => r.json());

  log('\\nResult: ' + JSON.stringify(result, null, 2));
  log('\\nDone! You can delete this page now.');
};
</script>
</body></html>
```

**Step 2: Run the backfill**

Open `http://localhost:8000/src/pages/supersack-backfill.html`, click "Run Backfill", verify results.

**Step 3: Verify data**

```bash
curl "https://rogue-origin-api.roguefamilyfarms.workers.dev/api/supersack?action=history&start=2026-01-01&end=2026-03-09"
```

**Step 4: Commit (include backfill page for reference, or delete)**

```bash
git add src/pages/supersack-backfill.html
git commit -m "feat: add temporary backfill utility for supersack historical data"
```

---

## Task 6: Analytics Page — Layout + KPI Cards

**Files:**
- Create: `src/pages/supersack-analytics.html`

**Step 1: Create page with header, date controls, KPI cards**

Full page with:
- Header matching supersack-entry style (dark theme, glassmorphism)
- Date range: preset buttons (Today, This Week, This Month, Last 30d, All Time) + custom start/end pickers
- Top KPI cards row: Total Sacks Opened, Avg Sacks/Day, Total Raw Processed, Avg Yield %
- Material breakdown card (tops/smalls/biomass/trim/waste weighted averages)
- Chart.js via CDN: `<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>`
- Bilingual support (EN/ES)
- Link back to supersack-entry.html

_(Full HTML in implementation — follows existing supersack-entry.html patterns exactly)_

**Step 2: Commit**

```bash
git add src/pages/supersack-analytics.html
git commit -m "feat: supersack analytics page — layout, date controls, KPI cards"
```

---

## Task 7: Analytics Page — Charts

**Files:**
- Modify: `src/pages/supersack-analytics.html`

**Step 1: Add charts**

1. **Supersacks/Day line chart** — daily sack count + 7-day moving average line
2. **Material Yield stacked bar** — daily/weekly/monthly breakdown (tops/smalls/biomass/trim/waste)
3. **Strain Comparison horizontal bar** — tops % vs smalls % vs waste % per strain
4. **Production Rate trend** — lbs/hr over time (from monthly_production data)

All charts use Chart.js with the brand color palette:
- Tops: `#668971` (green)
- Smalls: `#e4aa4f` (gold)
- Biomass: `#62758d` (blue)
- Trim: `#8b7355` (brown)
- Waste: `#c45c4a` (red)

**Step 2: Commit**

```bash
git add src/pages/supersack-analytics.html
git commit -m "feat: add Chart.js visualizations — throughput, yield, strain comparison"
```

---

## Task 8: Analytics Page — Remaining Inventory + Projections

**Files:**
- Modify: `src/pages/supersack-analytics.html`

**Step 1: Add inventory section**

- Current inventory per strain (from pool API `get_supersack_variants`)
- Days of supply estimate (remaining sacks ÷ avg daily usage)
- Projected yield breakdown (remaining × per-sack averages)
- Depletion timeline (simple projection of when each strain runs out)

**Step 2: Commit**

```bash
git add src/pages/supersack-analytics.html
git commit -m "feat: add remaining inventory projections and depletion timeline"
```

---

## Task 9: Analytics Page — Production Rate + Cost Metrics

**Files:**
- Modify: `src/pages/supersack-analytics.html`

**Step 1: Add production/cost section**

Fetch from `/api/production?action=dashboard` for the selected date range:
- Lbs/hour trend (line chart)
- Crew efficiency (lbs per effective trimmer)
- Cost per lb (wage_rate × hours ÷ total output)
- Labor cost breakdown card

**Step 2: Commit**

```bash
git add src/pages/supersack-analytics.html
git commit -m "feat: add production rate and cost metrics to analytics"
```

---

## Task 10: Cross-Link Pages

**Files:**
- Modify: `src/pages/supersack-entry.html` (add analytics link)
- Modify: `src/pages/supersack-analytics.html` (add entry link)

**Step 1: Add navigation links**

In supersack-entry.html header, add a small chart icon link to analytics page.
In supersack-analytics.html header, add a link back to entry page.

**Step 2: Commit**

```bash
git add src/pages/supersack-entry.html src/pages/supersack-analytics.html
git commit -m "feat: cross-link supersack entry and analytics pages"
```

---

## Task 11: Final Verification

**Step 1: Test end-to-end**

1. Open supersack-entry.html, enter sacks + biomass/trim, submit → verify D1 write
2. Open supersack-analytics.html → verify data appears in KPIs and charts
3. Test date range presets and custom picker
4. Test strain filter
5. Test both EN/ES languages
6. Test mobile layout (< 480px)

**Step 2: Clean up backfill page (optional)**

Delete `src/pages/supersack-backfill.html` if no longer needed, or keep for re-runs.

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete supersack analytics dashboard with historical data"
```
