# Google Sheets to Cloudflare D1 Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate all API data storage from Google Sheets to Cloudflare D1 SQL database to eliminate rate limiting, reduce latency, and improve reliability.

**Architecture:** Replace `lib/sheets.js` REST calls with D1 SQL queries. Keep Workers handlers, update data layer only.

**Tech Stack:** Cloudflare D1 (SQLite), Cloudflare Workers, existing frontend (no changes)

---

## Why Migrate?

| Issue | Google Sheets | Cloudflare D1 |
|-------|---------------|---------------|
| Rate Limits | ~300 requests/min (429 errors) | Unlimited within Workers |
| Latency | 200-500ms per request | <10ms (co-located with Worker) |
| Cold Starts | 10-15s on Apps Script | None |
| Query Complexity | Read entire sheet, filter in JS | SQL WHERE, JOIN, indexes |
| Data Integrity | No transactions, no FK constraints | Full SQL transactions |
| Cost | Free tier sufficient | 5M reads/day free, $0.001/M after |

## Current Data Model

### 1. Orders System (`orders.js`)

**Customers** - 11 columns
```
ID, Name, Company, Email, Phone, Address, City, State, Zip, Notes, CreatedAt
```

**MasterOrders** - 22 columns
```
OrderID, CustomerID, OrderDate, Status, Strain, Type, CommitmentKg, CommitmentPrice,
FulfilledKg, FulfilledValue, PaidAmount, BalanceDue, ShipDate, TrackingNumber,
Notes, CreatedAt, UpdatedAt, Source, ShopifyOrderID, ShopifyOrderName, PaymentTerms, Priority
```

**Shipments** - 15 columns
```
ShipmentID, OrderID, InvoiceNumber, ShipDate, Strain, Type, QuantityKg, UnitPrice,
TotalValue, TrackingNumber, Carrier, Status, Notes, CreatedAt, UpdatedAt
```

**Payments** - 9 columns
```
PaymentID, OrderID, PaymentDate, Amount, Method, Reference, Notes, CreatedAt, UpdatedAt
```

**PriceHistory** - 5 columns
```
Strain, Type, Price, EffectiveDate, Notes
```

**COA_Index** - 6 columns
```
Strain, LabName, TestDate, THCA, CBD, FileURL
```

### 2. Production System (`production.js`)

**ProductionTracking** - bag completion logs
```
Timestamp, BagType, Weight, SKU, Source, Notes
```

**PauseLog** - timer pause records
```
PauseID, StartTime, EndTime, Duration, Reason, Line, CreatedBy
```

**ShiftAdjustments** - shift timing changes
```
AdjustmentID, Date, OriginalStart, NewStart, Reason, CreatedAt
```

**MonthlyProduction** - hourly production data (YYYY-MM sheets)
```
Date, TimeSlot, BuckersLine1, TrimmersLine1, BuckersLine2, TrimmersLine2,
Cultivar1, Cultivar2, TopsLbs1, SmallsLbs1, TopsLbs2, SmallsLbs2, WageRate, Notes
```

### 3. SOP System (`sop.js`)

**SOPs** - 13 columns
```
ID, Title, Title_ES, Dept, DocNum, Revision, Status, Description, Desc_ES,
Tags (JSON), Steps (JSON), CreatedAt, UpdatedAt
```

**SOP_Requests** - 9 columns
```
ID, Title, Dept, Priority, Assignee, DueDate, Notes, Completed, CreatedAt
```

**SOP_Settings** - key-value pairs
```
Key, Value
```

### 4. Kanban System (`kanban.js`)

**KanbanCards** - 10 columns
```
ID, Item, Supplier, OrderQty, DeliveryTime, Price, Crumbtrail, URL, Picture, OrderWhen, ImageFile
```

### 5. Barcode System (`barcode.js`)

**Products** - 3 columns
```
Header, SKU, Barcode
```

---

## D1 Schema Design

### Task 1: Create D1 Database

**Step 1: Create the D1 database**

Run:
```bash
cd workers
npx wrangler d1 create rogue-origin-db
```

Expected: Returns database_id to add to wrangler.toml

**Step 2: Update wrangler.toml**

File: `workers/wrangler.toml`

Add after existing config:
```toml
[[d1_databases]]
binding = "DB"
database_name = "rogue-origin-db"
database_id = "<paste-id-from-step-1>"
```

**Step 3: Commit**

```bash
git add workers/wrangler.toml
git commit -m "chore: add D1 database binding"
```

---

### Task 2: Create Schema File

**Step 1: Create schema file**

File: `workers/schema.sql`

```sql
-- ============================================
-- ORDERS SYSTEM
-- ============================================

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_customers_name ON customers(name);
CREATE INDEX idx_customers_company ON customers(company);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  order_date TEXT,
  status TEXT DEFAULT 'pending',
  strain TEXT,
  type TEXT,
  commitment_kg REAL DEFAULT 0,
  commitment_price REAL DEFAULT 0,
  fulfilled_kg REAL DEFAULT 0,
  fulfilled_value REAL DEFAULT 0,
  paid_amount REAL DEFAULT 0,
  balance_due REAL DEFAULT 0,
  ship_date TEXT,
  tracking_number TEXT,
  notes TEXT,
  source TEXT,
  shopify_order_id TEXT,
  shopify_order_name TEXT,
  payment_terms TEXT,
  priority INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_strain ON orders(strain);
CREATE INDEX idx_orders_date ON orders(order_date);

CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  invoice_number TEXT,
  ship_date TEXT,
  strain TEXT,
  type TEXT,
  quantity_kg REAL DEFAULT 0,
  unit_price REAL DEFAULT 0,
  total_value REAL DEFAULT 0,
  tracking_number TEXT,
  carrier TEXT,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE INDEX idx_shipments_order ON shipments(order_id);
CREATE INDEX idx_shipments_date ON shipments(ship_date);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  payment_date TEXT,
  amount REAL NOT NULL,
  method TEXT,
  reference TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE INDEX idx_payments_order ON payments(order_id);
CREATE INDEX idx_payments_date ON payments(payment_date);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strain TEXT NOT NULL,
  type TEXT NOT NULL,
  price REAL NOT NULL,
  effective_date TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_price_strain ON price_history(strain, type);

CREATE TABLE IF NOT EXISTS coa_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strain TEXT NOT NULL,
  lab_name TEXT,
  test_date TEXT,
  thca REAL,
  cbd REAL,
  file_url TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_coa_strain ON coa_index(strain);

-- ============================================
-- PRODUCTION SYSTEM
-- ============================================

CREATE TABLE IF NOT EXISTS production_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  bag_type TEXT,
  weight REAL,
  sku TEXT,
  source TEXT,
  cultivar TEXT,
  notes TEXT
);

CREATE INDEX idx_tracking_timestamp ON production_tracking(timestamp);
CREATE INDEX idx_tracking_cultivar ON production_tracking(cultivar);

CREATE TABLE IF NOT EXISTS pause_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_time TEXT NOT NULL,
  end_time TEXT,
  duration_min REAL,
  reason TEXT,
  line INTEGER,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_pause_date ON pause_log(start_time);

CREATE TABLE IF NOT EXISTS shift_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adjustment_date TEXT NOT NULL,
  original_start TEXT,
  new_start TEXT,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_shift_date ON shift_adjustments(adjustment_date);

CREATE TABLE IF NOT EXISTS monthly_production (
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

CREATE INDEX idx_production_date ON monthly_production(production_date);

-- ============================================
-- SOP SYSTEM
-- ============================================

CREATE TABLE IF NOT EXISTS sops (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  title_es TEXT,
  dept TEXT,
  doc_num TEXT,
  revision TEXT DEFAULT '1',
  status TEXT DEFAULT 'draft',
  description TEXT,
  desc_es TEXT,
  tags TEXT, -- JSON array
  steps TEXT, -- JSON array
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_sops_dept ON sops(dept);
CREATE INDEX idx_sops_status ON sops(status);

CREATE TABLE IF NOT EXISTS sop_requests (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  dept TEXT,
  priority TEXT DEFAULT 'medium',
  assignee TEXT,
  due_date TEXT,
  notes TEXT,
  completed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_requests_completed ON sop_requests(completed);

CREATE TABLE IF NOT EXISTS sop_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- ============================================
-- KANBAN SYSTEM
-- ============================================

CREATE TABLE IF NOT EXISTS kanban_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item TEXT NOT NULL,
  supplier TEXT,
  order_qty TEXT,
  delivery_time TEXT,
  price TEXT,
  crumbtrail TEXT,
  url TEXT,
  picture TEXT,
  order_when TEXT,
  image_file TEXT
);

CREATE INDEX idx_kanban_supplier ON kanban_cards(supplier);

-- ============================================
-- BARCODE SYSTEM
-- ============================================

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  header TEXT NOT NULL,
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT
);

CREATE INDEX idx_products_sku ON products(sku);
```

**Step 2: Apply schema to D1**

Run:
```bash
cd workers
npx wrangler d1 execute rogue-origin-db --file=schema.sql
```

Expected: "Executed X commands successfully"

**Step 3: Commit**

```bash
git add workers/schema.sql
git commit -m "feat: add D1 database schema"
```

---

### Task 3: Create D1 Data Access Layer

**Step 1: Create db.js utility**

File: `workers/src/lib/db.js`

```javascript
/**
 * D1 Database utilities
 * Replaces sheets.js for database operations
 */

/**
 * Execute a SELECT query
 * @param {D1Database} db
 * @param {string} sql
 * @param {any[]} params
 * @returns {Promise<any[]>}
 */
export async function query(db, sql, params = []) {
  const result = await db.prepare(sql).bind(...params).all();
  return result.results || [];
}

/**
 * Execute a SELECT query returning first row only
 * @param {D1Database} db
 * @param {string} sql
 * @param {any[]} params
 * @returns {Promise<any|null>}
 */
export async function queryOne(db, sql, params = []) {
  const result = await db.prepare(sql).bind(...params).first();
  return result || null;
}

/**
 * Execute INSERT/UPDATE/DELETE
 * @param {D1Database} db
 * @param {string} sql
 * @param {any[]} params
 * @returns {Promise<{changes: number, lastRowId: number}>}
 */
export async function execute(db, sql, params = []) {
  const result = await db.prepare(sql).bind(...params).run();
  return {
    changes: result.changes || 0,
    lastRowId: result.lastRowId || 0,
  };
}

/**
 * Execute multiple statements in a transaction
 * @param {D1Database} db
 * @param {Array<{sql: string, params: any[]}>} statements
 * @returns {Promise<any[]>}
 */
export async function transaction(db, statements) {
  const prepared = statements.map(s => db.prepare(s.sql).bind(...(s.params || [])));
  return db.batch(prepared);
}

/**
 * Insert a row and return the ID
 * @param {D1Database} db
 * @param {string} table
 * @param {object} data
 * @returns {Promise<number|string>}
 */
export async function insert(db, table, data) {
  const keys = Object.keys(data);
  const placeholders = keys.map(() => '?').join(', ');
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;
  const result = await execute(db, sql, Object.values(data));
  return result.lastRowId;
}

/**
 * Update rows
 * @param {D1Database} db
 * @param {string} table
 * @param {object} data
 * @param {string} whereClause
 * @param {any[]} whereParams
 * @returns {Promise<number>} rows affected
 */
export async function update(db, table, data, whereClause, whereParams = []) {
  const sets = Object.keys(data).map(k => `${k} = ?`).join(', ');
  const sql = `UPDATE ${table} SET ${sets} WHERE ${whereClause}`;
  const result = await execute(db, sql, [...Object.values(data), ...whereParams]);
  return result.changes;
}

/**
 * Delete rows
 * @param {D1Database} db
 * @param {string} table
 * @param {string} whereClause
 * @param {any[]} whereParams
 * @returns {Promise<number>} rows affected
 */
export async function deleteRows(db, table, whereClause, whereParams = []) {
  const sql = `DELETE FROM ${table} WHERE ${whereClause}`;
  const result = await execute(db, sql, whereParams);
  return result.changes;
}
```

**Step 2: Verify db.js compiles**

Run:
```bash
cd workers && npm run build
```

Expected: No errors

**Step 3: Commit**

```bash
git add workers/src/lib/db.js
git commit -m "feat: add D1 database utility layer"
```

---

### Task 4: Migrate Barcode Handler (Simplest First)

**Step 1: Create new barcode-d1.js handler**

File: `workers/src/handlers/barcode-d1.js`

```javascript
/**
 * Barcode/Label Manager API Handler - D1 Version
 */

import { query, queryOne, insert, update, deleteRows } from '../lib/db.js';
import { successResponse, parseBody, getAction } from '../lib/response.js';
import { createError } from '../lib/errors.js';
import { sanitizeForSheets } from '../lib/validate.js';

function validateProduct(data) {
  if (!data.header || typeof data.header !== 'string') {
    throw createError('VALIDATION_ERROR', 'Header is required');
  }
  if (!data.sku || typeof data.sku !== 'string') {
    throw createError('VALIDATION_ERROR', 'SKU is required');
  }
  if (data.header.length > 200) {
    throw createError('VALIDATION_ERROR', 'Header must be 200 characters or less');
  }
  if (data.sku.length > 100) {
    throw createError('VALIDATION_ERROR', 'SKU must be 100 characters or less');
  }
  if (data.barcode && !/^[A-Za-z0-9\-_. ]*$/.test(data.barcode)) {
    throw createError('VALIDATION_ERROR', 'Barcode contains invalid characters');
  }
  return data;
}

async function getProducts(env) {
  const products = await query(env.DB, `
    SELECT id, header, sku, barcode
    FROM products
    ORDER BY id
  `);

  return successResponse({
    success: true,
    products: products.map(p => ({
      row: p.id,  // Keep 'row' for backward compatibility
      header: p.header || '',
      sku: p.sku || '',
      barcode: p.barcode || '',
    }))
  });
}

async function test() {
  return successResponse({
    ok: true,
    message: 'Barcode API is working (Cloudflare D1)',
    timestamp: new Date().toISOString(),
  });
}

async function addProduct(body, env) {
  const data = validateProduct(body);

  // Check for duplicate SKU
  const existing = await queryOne(env.DB,
    'SELECT id FROM products WHERE sku = ?',
    [data.sku]
  );
  if (existing) {
    throw createError('VALIDATION_ERROR', 'SKU already exists');
  }

  await insert(env.DB, 'products', {
    header: sanitizeForSheets(data.header),
    sku: sanitizeForSheets(data.sku),
    barcode: sanitizeForSheets(data.barcode || ''),
  });

  return successResponse({ success: true, message: 'Product added successfully' });
}

async function updateProduct(body, env) {
  if (!body.row || typeof body.row !== 'number' || body.row < 1) {
    throw createError('VALIDATION_ERROR', 'Valid row number is required');
  }

  const data = validateProduct(body);

  const changes = await update(env.DB, 'products', {
    header: sanitizeForSheets(data.header),
    sku: sanitizeForSheets(data.sku),
    barcode: sanitizeForSheets(data.barcode || ''),
  }, 'id = ?', [body.row]);

  if (changes === 0) {
    throw createError('NOT_FOUND', 'Product not found');
  }

  return successResponse({ success: true, message: 'Product updated' });
}

async function deleteProduct(body, env) {
  if (!body.row || typeof body.row !== 'number' || body.row < 1) {
    throw createError('VALIDATION_ERROR', 'Valid row number is required');
  }

  const changes = await deleteRows(env.DB, 'products', 'id = ?', [body.row]);

  if (changes === 0) {
    throw createError('NOT_FOUND', 'Product not found');
  }

  return successResponse({ success: true, message: 'Product deleted' });
}

async function importCSV(body, env) {
  if (!body.csv || typeof body.csv !== 'string') {
    throw createError('VALIDATION_ERROR', 'CSV data is required');
  }

  if (body.csv.length > 1000000) {
    throw createError('VALIDATION_ERROR', 'CSV data exceeds 1MB limit');
  }

  const lines = body.csv.split('\n');
  let added = 0;
  let skipped = 0;
  let rejected = 0;

  // Get existing SKUs
  const existing = await query(env.DB, 'SELECT sku FROM products');
  const existingSKUs = new Set(existing.map(p => p.sku));

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.includes('\t') ? line.split('\t') : line.split(',');

    if (parts.length >= 3) {
      const headerRaw = parts[0].trim().replace(/^["']|["']$/g, '');
      const skuRaw = parts[1].trim().replace(/^["']|["']$/g, '');
      const barcodeRaw = parts[2].trim().replace(/^["']|["']$/g, '');

      if (barcodeRaw && !/^[A-Za-z0-9\-_. ]*$/.test(barcodeRaw)) {
        rejected++;
        continue;
      }

      if (headerRaw && skuRaw && barcodeRaw && !existingSKUs.has(skuRaw)) {
        await insert(env.DB, 'products', {
          header: sanitizeForSheets(headerRaw),
          sku: sanitizeForSheets(skuRaw),
          barcode: sanitizeForSheets(barcodeRaw),
        });
        existingSKUs.add(skuRaw);
        added++;
      } else {
        skipped++;
      }
    }
  }

  let message = `Imported ${added} products. Skipped ${skipped} items.`;
  if (rejected > 0) {
    message += ` Rejected ${rejected} items due to invalid data.`;
  }

  return successResponse({ success: true, message });
}

export async function handleBarcodeD1(request, env) {
  const action = getAction(request);
  const body = request.method === 'POST' ? await parseBody(request) : {};

  const actions = {
    products: () => getProducts(env),
    test: () => test(),
    add: () => addProduct(body, env),
    update: () => updateProduct(body, env),
    delete: () => deleteProduct(body, env),
    import: () => importCSV(body, env),
  };

  if (!action || !actions[action]) {
    throw createError('VALIDATION_ERROR', `Unknown action: ${action}`);
  }

  return actions[action]();
}
```

**Step 2: Run tests to verify D1 handler compiles**

Run:
```bash
cd workers && npm run build
```

Expected: No errors

**Step 3: Commit**

```bash
git add workers/src/handlers/barcode-d1.js
git commit -m "feat: add D1 version of barcode handler"
```

---

### Task 5: Data Migration Script for Barcode

**Step 1: Create migration script**

File: `workers/migrations/migrate-barcode.js`

```javascript
/**
 * One-time migration script: Google Sheets -> D1 for barcode/products
 *
 * Run with: node migrations/migrate-barcode.js
 *
 * Requires:
 * - BARCODE_SHEET_ID env var
 * - Google service account credentials
 * - D1 database already created
 */

import { readSheet } from '../src/lib/sheets.js';

async function migrateBarcode(env) {
  console.log('Starting barcode data migration...');

  // Read from Google Sheets
  const sheetId = env.BARCODE_SHEET_ID;
  const data = await readSheet(sheetId, 'Sheet1!A:C', env);

  if (data.length <= 1) {
    console.log('No data to migrate');
    return;
  }

  console.log(`Found ${data.length - 1} products to migrate`);

  // Prepare INSERT statements
  const products = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[0] || row[1]) {
      products.push({
        header: String(row[0] || ''),
        sku: String(row[1] || ''),
        barcode: String(row[2] || ''),
      });
    }
  }

  // Batch insert into D1
  const batchSize = 100;
  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);
    const placeholders = batch.map(() => '(?, ?, ?)').join(', ');
    const values = batch.flatMap(p => [p.header, p.sku, p.barcode]);

    await env.DB.prepare(`
      INSERT OR IGNORE INTO products (header, sku, barcode)
      VALUES ${placeholders}
    `).bind(...values).run();

    console.log(`Migrated ${Math.min(i + batchSize, products.length)}/${products.length} products`);
  }

  console.log('Barcode migration complete!');
}

export { migrateBarcode };
```

**Step 2: Commit**

```bash
git add workers/migrations/migrate-barcode.js
git commit -m "feat: add barcode data migration script"
```

---

### Task 6: Switch Barcode Route to D1

**Step 1: Update index.js router**

File: `workers/src/index.js`

Add feature flag and import:

```javascript
// At top of file, add import
import { handleBarcodeD1 } from './handlers/barcode-d1.js';

// Add feature flag (set to true when ready to switch)
const USE_D1_BARCODE = false;

// In the router, update barcode route:
if (path === '/api/barcode') {
  return USE_D1_BARCODE
    ? handleBarcodeD1(request, env)
    : handleBarcode(request, env);
}
```

**Step 2: Test with flag off**

Run:
```bash
cd workers && npx wrangler dev
```

Test: `curl "http://localhost:8787/api/barcode?action=test"`

Expected: Returns "Barcode API is working (Cloudflare Workers)"

**Step 3: Flip flag to true, test D1**

Update `USE_D1_BARCODE = true` in index.js

Test: `curl "http://localhost:8787/api/barcode?action=test"`

Expected: Returns "Barcode API is working (Cloudflare D1)"

**Step 4: Commit**

```bash
git add workers/src/index.js
git commit -m "feat: add D1 feature flag for barcode handler"
```

---

### Task 7: Migrate Kanban Handler

**Step 1: Create kanban-d1.js**

File: `workers/src/handlers/kanban-d1.js`

(Similar pattern to barcode-d1.js - implement CRUD using db.js utilities)

Key queries:
- `SELECT * FROM kanban_cards ORDER BY id`
- `INSERT INTO kanban_cards (...) VALUES (...)`
- `UPDATE kanban_cards SET ... WHERE id = ?`
- `DELETE FROM kanban_cards WHERE id = ?`

**Step 2: Test and commit**

---

### Task 8: Migrate SOP Handler

**Step 1: Create sop-d1.js**

More complex due to:
- Three tables (sops, sop_requests, sop_settings)
- JSON columns (tags, steps)
- Anthropic AI integration (unchanged)

Key queries:
- `SELECT * FROM sops ORDER BY created_at DESC`
- `SELECT * FROM sop_requests WHERE completed = 0`
- `INSERT INTO sops (...) VALUES (...)`
- JSON stored as TEXT, parsed in JavaScript

**Step 2: Test and commit**

---

### Task 9: Migrate Orders Handler (Most Complex)

**Step 1: Create orders-d1.js**

Most complex due to:
- Six tables with relationships
- Order queue calculation with JOINs
- COA lookups
- Cross-reference with production tracking

Key queries:
```sql
-- Get order with related data
SELECT o.*, c.name as customer_name
FROM orders o
JOIN customers c ON o.customer_id = c.id
WHERE o.status = 'active'
ORDER BY o.priority DESC, o.order_date;

-- Calculate order totals
SELECT
  o.id,
  o.commitment_kg,
  COALESCE(SUM(s.quantity_kg), 0) as fulfilled_kg,
  COALESCE(SUM(p.amount), 0) as paid_amount
FROM orders o
LEFT JOIN shipments s ON o.id = s.order_id
LEFT JOIN payments p ON o.id = p.order_id
GROUP BY o.id;
```

**Step 2: Update count5kgBagsForStrain to use D1**

The production tracking data that calculates bag counts can also be migrated:

```sql
SELECT COUNT(*) as bag_count
FROM production_tracking
WHERE cultivar = ?
AND timestamp >= ?
AND timestamp <= ?
AND timestamp NOT BETWEEN '2026-01-19T20:34:14Z' AND '2026-01-19T20:38:05Z'
```

**Step 3: Test thoroughly with order queue display**

**Step 4: Commit**

---

### Task 10: Migrate Production Handler

**Step 1: Create production-d1.js**

Complex due to:
- Monthly production data (was separate sheets per month)
- Timer/pause calculations
- Bag counting with blacklist
- Historical data queries

Benefits of D1:
```sql
-- Get last 30 days of production (was 30 separate sheet reads!)
SELECT production_date, SUM(tops_lbs1 + tops_lbs2) as tops_total
FROM monthly_production
WHERE production_date >= date('now', '-30 days')
GROUP BY production_date
ORDER BY production_date;

-- Get cycle times with carryover detection
SELECT
  timestamp,
  LAG(timestamp) OVER (ORDER BY timestamp) as prev_timestamp
FROM production_tracking
WHERE DATE(timestamp) >= ?
ORDER BY timestamp;
```

**Step 2: Test scoreboard display**

**Step 3: Commit**

---

### Task 11: Cleanup and Deploy

**Step 1: Remove Google Sheets dependencies**

Once all handlers migrated and tested:
- Remove `lib/sheets.js`
- Remove `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY` secrets
- Remove `*_SHEET_ID` env vars
- Update wrangler.toml

**Step 2: Deploy to production**

```bash
cd workers
npx wrangler deploy
```

**Step 3: Verify all endpoints**

Test each endpoint:
```bash
curl "https://rogue-origin-api.roguefamilyfarms.workers.dev/api/barcode?action=test"
curl "https://rogue-origin-api.roguefamilyfarms.workers.dev/api/kanban?action=test"
curl "https://rogue-origin-api.roguefamilyfarms.workers.dev/api/sop?action=test"
curl "https://rogue-origin-api.roguefamilyfarms.workers.dev/api/orders?action=test"
curl "https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production?action=test"
```

**Step 4: Commit final cleanup**

```bash
git add -A
git commit -m "chore: complete D1 migration, remove Google Sheets dependencies"
git push
```

---

## Rollback Strategy

If issues arise after D1 migration:

1. **Feature flags**: Each handler has `USE_D1_*` flag - set to false to revert
2. **Keep Sheets data**: Don't delete Google Sheets until D1 proven stable (30 days)
3. **Dual-write option**: Can modify to write to both during transition

## Testing Checklist

For each migrated handler, verify:

- [ ] GET operations return same data format
- [ ] POST create operations work
- [ ] PUT/POST update operations work
- [ ] DELETE operations work
- [ ] Error messages match expected format
- [ ] Frontend continues to work without changes
- [ ] No rate limiting errors under load
- [ ] Response times < 50ms

## Estimated Migration Order

| Handler | Complexity | Tables | Priority |
|---------|------------|--------|----------|
| Barcode | Simple | 1 | 1st (pilot) |
| Kanban | Simple | 1 | 2nd |
| SOP | Medium | 3 | 3rd |
| Orders | Complex | 6 + joins | 4th |
| Production | Complex | 4 + aggregations | 5th |

## Notes

- D1 is in open beta but production-ready for this scale
- SQLite syntax (slight differences from MySQL/PostgreSQL)
- Maximum database size: 10GB (more than enough)
- Free tier: 5M reads/day, 100K writes/day
- Cold starts: None (D1 is always warm with Workers)
