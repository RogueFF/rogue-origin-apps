# Hourly Production Entry App Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a mobile-friendly web app for hourly production data entry, replacing manual Google Sheets entry and enabling full D1 migration.

**Architecture:** HTML/CSS/JS page → Cloudflare Workers API → D1 database (with optional Sheets dual-write during transition)

**Tech Stack:** Vanilla JS, existing CSS patterns from scoreboard/dashboard, D1 SQLite

---

## Current State Analysis

### Google Sheets Structure (YYYY-MM tabs)
```
Row N:   | Date:        | January 19, 2026  |           |           |
Row N+1: | Time Slot    | Buckers 1 | Trimmers 1 | T-Zero 1 | Cultivar 1 | Tops 1 | Smalls 1 | Buckers 2 | ...
Row N+2: | 7:00-8:00 AM |     2     |     8      |    0     | Lifter     |  6.5   |   2.1    |    0      | ...
Row N+3: | 8:00-9:00 AM |     2     |     8      |    0     | Lifter     |  8.2   |   3.0    |    0      | ...
```

### Columns Tracked
| Column | Line 1 | Line 2 | Notes |
|--------|--------|--------|-------|
| Time Slot | Col 0 | - | e.g., "7:00 AM – 8:00 AM" |
| Buckers | Buckers 1 | Buckers 2 | Integer count |
| Trimmers | Trimmers 1 | Trimmers 2 | Integer count |
| T-Zero | T-Zero 1 | T-Zero 2 | Integer (unclear purpose) |
| Cultivar | Cultivar 1 | Cultivar 2 | Strain name |
| Tops (lbs) | Tops 1 | Tops 2 | Decimal |
| Smalls (lbs) | Smalls 1 | Smalls 2 | Decimal |
| QC | QC | - | Optional notes |

### Time Slots (with break multipliers)
```javascript
const TIME_SLOTS = [
  { slot: '7:00 AM – 8:00 AM', multiplier: 1.0 },
  { slot: '8:00 AM – 9:00 AM', multiplier: 1.0 },
  { slot: '9:00 AM – 10:00 AM', multiplier: 0.83 },  // 10-min break
  { slot: '10:00 AM – 11:00 AM', multiplier: 1.0 },
  { slot: '11:00 AM – 12:00 PM', multiplier: 1.0 },
  { slot: '12:30 PM – 1:00 PM', multiplier: 0.5 },   // Post-lunch half hour
  { slot: '1:00 PM – 2:00 PM', multiplier: 1.0 },
  { slot: '2:00 PM – 3:00 PM', multiplier: 1.0 },
  { slot: '3:00 PM – 4:00 PM', multiplier: 0.83 },   // 10-min break
  { slot: '4:00 PM – 4:30 PM', multiplier: 0.33 },   // Cleanup
];
```

### D1 Schema (existing)
```sql
CREATE TABLE monthly_production (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  production_date TEXT NOT NULL,
  time_slot TEXT NOT NULL,
  buckers_line1 INTEGER DEFAULT 0,
  trimmers_line1 INTEGER DEFAULT 0,
  buckers_line2 INTEGER DEFAULT 0,
  trimmers_line2 INTEGER DEFAULT 0,
  cultivar1 TEXT,
  cultivar2 TEXT,
  tops_lbs1 REAL DEFAULT 0,
  smalls_lbs1 REAL DEFAULT 0,
  tops_lbs2 REAL DEFAULT 0,
  smalls_lbs2 REAL DEFAULT 0,
  wage_rate REAL,
  notes TEXT,
  UNIQUE(production_date, time_slot)
);
```

### Existing API Endpoints (production-d1.js)
- `GET ?action=getProduction&date=YYYY-MM-DD` - Get day's entries
- `POST ?action=addProduction` - Upsert hourly entry

---

## Implementation Tasks

### Task 1: Update D1 Schema (add missing columns)

**Files:**
- Modify: `workers/schema.sql`
- Run: D1 migration commands

**Step 1: Add missing columns to schema**
```sql
-- Add T-Zero and QC columns
ALTER TABLE monthly_production ADD COLUMN tzero_line1 INTEGER DEFAULT 0;
ALTER TABLE monthly_production ADD COLUMN tzero_line2 INTEGER DEFAULT 0;
ALTER TABLE monthly_production ADD COLUMN qc TEXT;
```

**Step 2: Apply to D1**
```bash
cd workers
npx wrangler d1 execute rogue-origin-db --remote --command="ALTER TABLE monthly_production ADD COLUMN tzero_line1 INTEGER DEFAULT 0;"
npx wrangler d1 execute rogue-origin-db --remote --command="ALTER TABLE monthly_production ADD COLUMN tzero_line2 INTEGER DEFAULT 0;"
npx wrangler d1 execute rogue-origin-db --remote --command="ALTER TABLE monthly_production ADD COLUMN qc TEXT;"
```

**Step 3: Update schema.sql for future reference**

---

### Task 2: Update API Endpoints

**Files:**
- Modify: `workers/src/handlers/production-d1.js`

**Step 1: Update addProduction to include new columns**
```javascript
async function addProduction(body, env) {
  const {
    date, timeSlot,
    trimmers1, buckers1, tzero1, cultivar1, tops1, smalls1,
    trimmers2, buckers2, tzero2, cultivar2, tops2, smalls2,
    qc
  } = body;
  // ... update INSERT and UPDATE to include tzero_line1, tzero_line2, qc
}
```

**Step 2: Update getProduction to return new columns**

**Step 3: Add getCultivars endpoint for dropdown**
```javascript
async function getCultivars(env) {
  const cultivars = await query(env.DB, `
    SELECT DISTINCT cultivar1 as cultivar FROM monthly_production WHERE cultivar1 != ''
    UNION
    SELECT DISTINCT cultivar2 FROM monthly_production WHERE cultivar2 != ''
    ORDER BY cultivar
  `);
  return successResponse({ cultivars: cultivars.map(c => c.cultivar) });
}
```

---

### Task 3: Improve Migration Function

**Files:**
- Modify: `workers/src/handlers/production-d1.js`

**Step 1: Extend migration to include all months (not just 3)**
```javascript
// Change from: monthSheets.slice(0, 3)
// To: monthSheets (all available months)
```

**Step 2: Add T-Zero columns to migration mapping**

**Step 3: Add progress reporting**
```javascript
return successResponse({
  success: true,
  trackingMigrated,
  productionMigrated,
  pausesMigrated,
  shiftsMigrated,
  monthsProcessed: monthSheets.length,
  errors: errors.length > 0 ? errors : undefined,
});
```

---

### Task 4: Create Hourly Entry Page

**Files:**
- Create: `src/pages/hourly-entry.html`
- Create: `src/css/hourly-entry.css`

**UI Components:**

1. **Header**
   - Date picker (defaults to today)
   - "Today" quick button
   - Language toggle (EN/ES)

2. **Time Slot Navigator**
   - Horizontal scrollable tabs for time slots
   - Visual indicator for completed vs empty slots
   - Auto-scroll to current/next slot

3. **Entry Form (per time slot)**
   - Line 1 Section:
     - Buckers (number input, +/- buttons)
     - Trimmers (number input, +/- buttons)
     - Cultivar (dropdown with recent strains + custom)
     - Tops lbs (decimal input)
     - Smalls lbs (decimal input)
   - Line 2 Section (collapsible, same fields)
   - QC Notes (optional text)
   - Save button

4. **Day Summary Panel**
   - Total Tops / Smalls
   - Total trimmer-hours
   - Average rate
   - Comparison to target

**Mobile Optimizations:**
- Large touch targets (44px minimum)
- Number inputs with inputmode="decimal"
- Swipe between time slots
- Auto-save on blur

---

### Task 5: Implement JavaScript Logic

**Files:**
- Create: `src/js/hourly-entry/index.js`
- Create: `src/js/hourly-entry/api.js`
- Create: `src/js/hourly-entry/form.js`

**Key Functions:**

```javascript
// api.js
const API_URL = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production';

async function loadDayData(date) {
  const response = await fetch(`${API_URL}?action=getProduction&date=${date}`);
  return response.json();
}

async function saveEntry(data) {
  const response = await fetch(`${API_URL}?action=addProduction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return response.json();
}

async function loadCultivars() {
  const response = await fetch(`${API_URL}?action=getCultivars`);
  return response.json();
}
```

```javascript
// form.js
function populateForm(slotData) { ... }
function collectFormData() { ... }
function validateEntry(data) { ... }
function showSaveIndicator(success) { ... }
```

---

### Task 6: Add Dual-Write Option (Sheets backup)

**Files:**
- Modify: `workers/src/handlers/production-d1.js`

**Step 1: Add environment flag for dual-write**
```javascript
const DUAL_WRITE_TO_SHEETS = true; // Set false after transition complete
```

**Step 2: After D1 write, optionally write to Sheets**
```javascript
if (DUAL_WRITE_TO_SHEETS && env.PRODUCTION_SHEET_ID) {
  try {
    await writeToMonthlySheet(env, date, timeSlot, data);
  } catch (e) {
    console.error('Sheets dual-write failed:', e);
    // Don't fail the request - D1 is source of truth
  }
}
```

---

### Task 7: Enable D1 for Production

**Files:**
- Modify: `workers/src/index.js`

**Step 1: Run full migration**
```bash
curl "https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production?action=migrate"
```

**Step 2: Verify migration counts**

**Step 3: Enable D1**
```javascript
const USE_D1_PRODUCTION = true;
```

**Step 4: Deploy and test**

---

### Task 8: Testing

**Manual Tests:**
1. Load page, verify current date selected
2. Enter data for current time slot
3. Save and verify in D1
4. Navigate to different slots
5. Change date, verify data loads
6. Test on mobile (iOS Safari, Android Chrome)

**Automated Tests:**
- Add Playwright test for hourly entry flow

---

## Execution Order

1. Task 1: Update D1 Schema (5 min)
2. Task 2: Update API Endpoints (15 min)
3. Task 3: Improve Migration Function (10 min)
4. Task 4: Create Hourly Entry Page (30 min)
5. Task 5: Implement JavaScript Logic (20 min)
6. Task 6: Add Dual-Write Option (10 min)
7. Task 7: Enable D1 for Production (10 min)
8. Task 8: Testing (15 min)

**Total estimated: ~2 hours**

---

## Post-Implementation

After the app is working:
1. User enters hourly data via app instead of Sheets
2. Data goes to D1 (+ optional Sheets backup)
3. Production API reads from D1
4. Scoreboard/dashboard work unchanged
5. Can disable Sheets dual-write after confidence period
