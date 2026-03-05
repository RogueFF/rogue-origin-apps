# Consignment App Overhaul — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Overhaul the consignment app so it replaces the paper/whiteboard workflow for tracking farm product intake, sales reconciliation, and payouts.

**Architecture:** Existing Cloudflare Workers + D1 backend with vanilla JS frontend. We're fixing half-delivered features and adding missing ones — not rewriting. Schema migration for default pricing + batch_id on intakes schema. Fresh data reset first.

**Tech Stack:** Cloudflare Workers (JS), D1 (SQLite), vanilla HTML/CSS/JS (no build system), ES6 modules

---

## Task 0: Fresh Data Reset

**Why:** User wants to re-add farms from scratch with clean data.

**Files:**
- Create: `workers/migrations/0003-consignment-reset.sql`

**Step 1: Write the migration**

```sql
-- Reset all consignment data for fresh start
DELETE FROM consignment_sales;
DELETE FROM consignment_intakes;
DELETE FROM consignment_payments;
DELETE FROM consignment_partners;

-- Clear old strains and re-seed with actual cultivar names used by farms
DELETE FROM consignment_strains;
INSERT INTO consignment_strains (name) VALUES
  ('Alium OG'),
  ('Bubba Kush'),
  ('Cake Berry Brulee'),
  ('Critical Berries'),
  ('Lemon Octane'),
  ('Orange Fritter'),
  ('Puff Pastries'),
  ('Royal OG'),
  ('Sour Brulee'),
  ('Sour Lifter'),
  ('Sour Special Sauce'),
  ('Sour Suver Haze'),
  ('Super Sour Space'),
  ('White CBG');
```

Note: Renamed "Super Sour Space Candy" -> "Super Sour Space" to match actual usage. Removed "Sour Suver Haze" duplication concern — keep full name, farms can clarify. Added "Cake Berry Brulee" which was missing.

**Step 2: Run the migration against remote D1**

Run:
```bash
cd workers
npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0003-consignment-reset.sql
```

Expected: Success, 0 rows in all consignment tables.

**Step 3: Commit**

```bash
git add workers/migrations/0003-consignment-reset.sql
git commit -m "chore: reset consignment data for fresh start"
```

---

## Task 1: Schema — Default Pricing by Grade + Partner Pricing Overrides

**Why:** Users have standard rates ($150/lb tops, $50/lb smalls). Currently price_per_lb is required on every intake line — tedious and error-prone. Add a pricing_defaults table and make intake price_per_lb nullable (falls back to default).

**Files:**
- Create: `workers/migrations/0004-consignment-pricing.sql`
- Modify: `workers/schema.sql` (add new table + update seed data)

**Step 1: Write the migration**

```sql
-- Default pricing by grade (and optionally per-partner override)
CREATE TABLE IF NOT EXISTS consignment_pricing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER REFERENCES consignment_partners(id),
  grade TEXT NOT NULL CHECK(grade IN ('tops', 'smalls')),
  price_per_lb REAL NOT NULL,
  effective_date TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(partner_id, grade, effective_date)
);

-- Global defaults (partner_id = NULL means applies to all)
INSERT INTO consignment_pricing (partner_id, grade, price_per_lb, effective_date) VALUES
  (NULL, 'tops', 150.00, '2026-01-01'),
  (NULL, 'smalls', 50.00, '2026-01-01');

-- Make price_per_lb on intakes nullable (SQLite doesn't support ALTER COLUMN,
-- but the column already exists as REAL NOT NULL — we need to work around this.
-- For new intakes, the backend will look up pricing if price is not provided.)
-- NOTE: SQLite can't drop NOT NULL, so we handle this in the backend by always
-- providing a price (looked up from consignment_pricing if not supplied).
```

**Step 2: Run migration**

Run:
```bash
cd workers
npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0004-consignment-pricing.sql
```

**Step 3: Update schema.sql with the new table definition**

Add after the consignment_payments table in `workers/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS consignment_pricing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER REFERENCES consignment_partners(id),
  grade TEXT NOT NULL CHECK(grade IN ('tops', 'smalls')),
  price_per_lb REAL NOT NULL,
  effective_date TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(partner_id, grade, effective_date)
);

-- Global default pricing
INSERT OR IGNORE INTO consignment_pricing (partner_id, grade, price_per_lb, effective_date) VALUES
  (NULL, 'tops', 150.00, '2026-01-01'),
  (NULL, 'smalls', 50.00, '2026-01-01');
```

Also update the strain seed list to include Cake Berry Brulee and rename Super Sour Space Candy -> Super Sour Space.

**Step 4: Add `consignment_pricing` to VALID_TABLES in `workers/src/lib/db.js`**

Add `'consignment_pricing'` to the VALID_TABLES set.

**Step 5: Commit**

```bash
git add workers/migrations/0004-consignment-pricing.sql workers/schema.sql workers/src/lib/db.js
git commit -m "feat: add consignment pricing defaults table"
```

---

## Task 2: Backend — Price Lookup Helper + Update Intake/Sale Handlers

**Why:** Intake and inventory count need to auto-resolve pricing. The backend should look up price from: (1) explicit value in request, (2) partner-specific override, (3) global default.

**Files:**
- Modify: `workers/src/handlers/consignment-d1.js`

**Step 1: Add price resolution helper**

Add this function near the top of `consignment-d1.js` (after imports):

```javascript
/**
 * Resolve price per lb: explicit > partner override > global default
 */
async function resolvePrice(db, partnerId, grade, explicitPrice) {
  if (explicitPrice && explicitPrice > 0) return explicitPrice;

  // Check partner-specific pricing first
  const partnerPrice = await queryOne(db, `
    SELECT price_per_lb FROM consignment_pricing
    WHERE partner_id = ? AND grade = ?
    ORDER BY effective_date DESC LIMIT 1
  `, [partnerId, grade]);
  if (partnerPrice) return partnerPrice.price_per_lb;

  // Fall back to global default
  const globalPrice = await queryOne(db, `
    SELECT price_per_lb FROM consignment_pricing
    WHERE partner_id IS NULL AND grade = ?
    ORDER BY effective_date DESC LIMIT 1
  `, [grade]);
  if (globalPrice) return globalPrice.price_per_lb;

  return 0;
}
```

**Step 2: Update `saveIntake` to use price resolution**

Change the validation — remove the price_per_lb required check, resolve it:

```javascript
async function saveIntake(db, body) {
  const { partner_id, date, strain, type, weight_lbs, price_per_lb, notes } = body;

  if (!partner_id) throw createError('VALIDATION_ERROR', 'Partner is required');
  if (!date) throw createError('VALIDATION_ERROR', 'Date is required');
  if (!strain) throw createError('VALIDATION_ERROR', 'Strain is required');
  if (!type || !['tops', 'smalls'].includes(type)) throw createError('VALIDATION_ERROR', 'Type must be tops or smalls');
  if (!weight_lbs || weight_lbs <= 0) throw createError('VALIDATION_ERROR', 'Weight must be positive');

  const resolvedPrice = await resolvePrice(db, partner_id, type, price_per_lb);

  const result = await execute(db, `
    INSERT INTO consignment_intakes (partner_id, date, strain, type, weight_lbs, price_per_lb, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [partner_id, date, strain.trim(), type, weight_lbs, resolvedPrice, notes || null]);

  return successResponse({ success: true, id: result.lastRowId });
}
```

**Step 3: Update `saveBatchIntake` to use price resolution**

Same pattern — resolve price per line item if not explicitly provided:

```javascript
for (const item of items) {
  const { strain, type, weight_lbs, price_per_lb } = item;
  if (!strain) throw createError('VALIDATION_ERROR', 'Strain is required for all items');
  if (!type || !['tops', 'smalls'].includes(type)) throw createError('VALIDATION_ERROR', 'Type must be tops or smalls');
  if (!weight_lbs || weight_lbs <= 0) throw createError('VALIDATION_ERROR', 'Weight must be positive');

  const resolvedPrice = await resolvePrice(db, partner_id, type, price_per_lb);

  const result = await execute(db, `
    INSERT INTO consignment_intakes (partner_id, date, strain, type, weight_lbs, price_per_lb, notes, batch_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [partner_id, date, strain.trim(), type, weight_lbs, resolvedPrice, notes || null, batchId]);

  results.push({ id: result.lastRowId, strain, type, weight_lbs, price_per_lb: resolvedPrice });
}
```

**Step 4: Add `getConsignmentPricing` action + `saveConsignmentPricing` action**

Add to the switch statement:

```javascript
case 'getConsignmentPricing':
  return getPricing(db, params);
case 'saveConsignmentPricing':
  return savePricing(db, body);
```

Add `'saveConsignmentPricing'` to `CONSIGNMENT_WRITE_ACTIONS`.

Implement:

```javascript
async function getPricing(db, params) {
  const rows = await query(db, `
    SELECT cp.*, p.name as partner_name
    FROM consignment_pricing cp
    LEFT JOIN consignment_partners p ON p.id = cp.partner_id
    ORDER BY cp.partner_id IS NULL DESC, p.name, cp.grade
  `);
  return successResponse({ success: true, data: rows });
}

async function savePricing(db, body) {
  const { partner_id, grade, price_per_lb } = body;
  if (!grade || !['tops', 'smalls'].includes(grade)) throw createError('VALIDATION_ERROR', 'Grade must be tops or smalls');
  if (!price_per_lb || price_per_lb <= 0) throw createError('VALIDATION_ERROR', 'Price must be positive');

  const today = new Date().toISOString().split('T')[0];
  const result = await execute(db, `
    INSERT OR REPLACE INTO consignment_pricing (partner_id, grade, price_per_lb, effective_date)
    VALUES (?, ?, ?, ?)
  `, [partner_id || null, grade, price_per_lb, today]);

  return successResponse({ success: true, id: result.lastRowId });
}
```

**Step 5: Commit**

```bash
git add workers/src/handlers/consignment-d1.js
git commit -m "feat: auto-resolve pricing from defaults, add pricing API"
```

---

## Task 3: Backend — Batch Inventory Count + Reconciliation Endpoint

**Why:** This is the P0 feature. Replace single-item count with batch count that takes an array of {strain, type, counted_lbs} and returns a full reconciliation.

**Files:**
- Modify: `workers/src/handlers/consignment-d1.js`

**Step 1: Add `saveConsignmentBatchCount` action to switch**

```javascript
case 'saveConsignmentBatchCount':
  return saveBatchCount(db, body);
case 'getConsignmentReconciliation':
  return getReconciliation(db, params);
```

Add `'saveConsignmentBatchCount'` to `CONSIGNMENT_WRITE_ACTIONS`.

**Step 2: Implement `saveBatchCount`**

```javascript
async function saveBatchCount(db, body) {
  const { partner_id, date, items, notes } = body;

  if (!partner_id) throw createError('VALIDATION_ERROR', 'Partner is required');
  if (!date) throw createError('VALIDATION_ERROR', 'Date is required');
  if (!items || !Array.isArray(items) || items.length === 0) throw createError('VALIDATION_ERROR', 'At least one item is required');

  // Get all current inventory for this partner
  const inventory = await query(db, `
    SELECT strain, type,
      COALESCE(SUM(intake_lbs), 0) - COALESCE(SUM(sale_lbs), 0) as expected
    FROM (
      SELECT strain, type, weight_lbs as intake_lbs, 0 as sale_lbs FROM consignment_intakes WHERE partner_id = ?
      UNION ALL
      SELECT strain, type, 0 as intake_lbs, weight_lbs as sale_lbs FROM consignment_sales WHERE partner_id = ?
    )
    GROUP BY strain, type
    HAVING expected > 0
  `, [partner_id, partner_id]);

  const invMap = new Map();
  inventory.forEach(i => invMap.set(`${i.strain}|${i.type}`, i.expected));

  const results = [];

  for (const item of items) {
    const { strain, type, counted_lbs } = item;
    if (!strain || !type) continue;

    const key = `${strain}|${type}`;
    const expected = invMap.get(key) || 0;
    const sold = Math.max(0, expected - (counted_lbs || 0));

    if (sold > 0) {
      const price = await resolvePrice(db, partner_id, type, null);

      await execute(db, `
        INSERT INTO consignment_sales (partner_id, date, strain, type, weight_lbs, sale_price_per_lb, channel, notes)
        VALUES (?, ?, ?, ?, ?, ?, 'inventory_count', ?)
      `, [partner_id, date, strain, type, sold, price,
          notes || `Batch count: ${counted_lbs} lbs on hand (expected ${expected.toFixed(1)} lbs)`]);
    }

    results.push({
      strain,
      type,
      expected_lbs: expected,
      counted_lbs: counted_lbs || 0,
      sold_lbs: sold,
      price_per_lb: await resolvePrice(db, partner_id, type, null),
      revenue: sold * (await resolvePrice(db, partner_id, type, null)),
    });

    // Remove from map so we can detect items with 0 remaining (fully sold)
    invMap.delete(key);
  }

  // Any inventory items NOT in the count list — flag them (still on hand, not counted)
  const uncounted = [];
  invMap.forEach((expected, key) => {
    const [strain, type] = key.split('|');
    uncounted.push({ strain, type, expected_lbs: expected, status: 'not_counted' });
  });

  const totalSold = results.reduce((s, r) => s + r.sold_lbs, 0);
  const totalRevenue = results.reduce((s, r) => s + r.revenue, 0);

  return successResponse({
    success: true,
    data: {
      items: results,
      uncounted,
      summary: {
        total_sold_lbs: totalSold,
        total_revenue: totalRevenue,
        items_counted: results.length,
        items_uncounted: uncounted.length,
      }
    }
  });
}
```

**Step 3: Implement `getReconciliation`**

This gives a partner's full reconciliation view — all inventory with intake totals, sold totals, remaining, and revenue.

```javascript
async function getReconciliation(db, params) {
  const partnerId = params.partner_id;
  if (!partnerId) throw createError('VALIDATION_ERROR', 'Partner ID required');

  // All inventory lines with totals
  const lines = await query(db, `
    SELECT strain, type,
      COALESCE(SUM(intake_lbs), 0) as total_intake,
      COALESCE(SUM(sale_lbs), 0) as total_sold,
      COALESCE(SUM(intake_lbs), 0) - COALESCE(SUM(sale_lbs), 0) as remaining
    FROM (
      SELECT strain, type, weight_lbs as intake_lbs, 0 as sale_lbs FROM consignment_intakes WHERE partner_id = ?
      UNION ALL
      SELECT strain, type, 0 as intake_lbs, weight_lbs as sale_lbs FROM consignment_sales WHERE partner_id = ?
    )
    GROUP BY strain, type
    ORDER BY type, strain
  `, [partnerId, partnerId]);

  // Enrich with pricing
  const enriched = await Promise.all(lines.map(async (line) => {
    const price = await resolvePrice(db, partnerId, line.type, null);
    return {
      ...line,
      price_per_lb: price,
      sold_revenue: line.total_sold * price,
      remaining_value: line.remaining * price,
    };
  }));

  // Summaries by grade
  const topLines = enriched.filter(l => l.type === 'tops');
  const smallLines = enriched.filter(l => l.type === 'smalls');

  const topsSold = topLines.reduce((s, l) => s + l.total_sold, 0);
  const smallsSold = smallLines.reduce((s, l) => s + l.total_sold, 0);
  const topsRevenue = topLines.reduce((s, l) => s + l.sold_revenue, 0);
  const smallsRevenue = smallLines.reduce((s, l) => s + l.sold_revenue, 0);

  const totalPaid = await queryOne(db, `
    SELECT COALESCE(SUM(amount), 0) as total FROM consignment_payments WHERE partner_id = ?
  `, [partnerId]);

  return successResponse({
    success: true,
    data: {
      lines: enriched,
      summary: {
        tops: { sold_lbs: topsSold, revenue: topsRevenue },
        smalls: { sold_lbs: smallsSold, revenue: smallsRevenue },
        total_revenue: topsRevenue + smallsRevenue,
        total_paid: totalPaid?.total || 0,
        balance_owed: Math.max(0, (topsRevenue + smallsRevenue) - (totalPaid?.total || 0)),
      }
    }
  });
}
```

**Step 4: Commit**

```bash
git add workers/src/handlers/consignment-d1.js
git commit -m "feat: batch inventory count + reconciliation endpoint"
```

---

## Task 4: Backend — Add Strain from API (UI support)

**Why:** The `saveConsignmentStrain` action already exists but there's no way to add strains from the intake form. We need the frontend API wrapper.

**Files:**
- Modify: `src/js/consignment/api.js`

**Step 1: Add missing API methods**

Add to `api.js`:

```javascript
export function saveStrain(name) {
  return queueablePost('saveConsignmentStrain', { name });
}

export function getPricing() {
  return apiGet('getConsignmentPricing');
}

export function savePricing(data) {
  return queueablePost('saveConsignmentPricing', data);
}

export function saveBatchCount(data) {
  return queueablePost('saveConsignmentBatchCount', data);
}

export function getReconciliation(partnerId) {
  return apiGet('getConsignmentReconciliation', { partner_id: partnerId });
}
```

**Step 2: Fix `saveInventoryCount` to use consistent `queueablePost`**

Replace the current `saveInventoryCount` function (which uses raw fetch with wrong content-type):

```javascript
export function saveInventoryCount(data) {
  return queueablePost('saveConsignmentInventoryCount', data);
}
```

**Step 3: Commit**

```bash
git add src/js/consignment/api.js
git commit -m "feat: add API methods for strains, pricing, batch count, reconciliation"
```

---

## Task 5: Frontend — Batch Inventory Count Modal

**Why:** Replace the single-item count modal with a batch count that pre-populates all current inventory for a partner. This is the feature that makes the app faster than the whiteboard.

**Files:**
- Modify: `src/pages/consignment.html` (replace count modal)
- Modify: `src/js/consignment/main.js` (new handler)
- Modify: `src/js/consignment/ui.js` (render helper)

**Step 1: Replace the count modal in `consignment.html`**

Replace the `count-modal` div (lines 236-276) with:

```html
<!-- Batch Inventory Count Modal -->
<div id="count-modal" class="modal-overlay" role="dialog" aria-label="Inventory Count">
  <div class="modal modal-wide">
    <h2><i class="ph-duotone ph-clipboard-text"></i> Inventory Count</h2>
    <button class="modal-close" aria-label="Close">&times;</button>
    <form id="count-form">
      <div class="form-row">
        <div class="form-group flex-1">
          <label for="count-partner">Partner</label>
          <select id="count-partner" class="partner-select" required></select>
        </div>
        <div class="form-group">
          <label for="count-date">Date</label>
          <input type="date" id="count-date" required>
        </div>
      </div>

      <div id="count-inventory-loading" class="empty-state" style="display:none;">
        <p>Select a partner to load their inventory...</p>
      </div>

      <div id="count-lines-wrapper" style="display:none;">
        <div class="line-items-header">
          <span class="li-col-strain">Strain</span>
          <span class="li-col-type">Type</span>
          <span class="li-col-weight">Expected</span>
          <span class="li-col-price">Actual (lbs)</span>
          <span class="li-col-remove">Diff</span>
        </div>
        <div id="count-lines" class="line-items">
          <!-- Pre-populated by JS when partner selected -->
        </div>
        <div id="count-summary" class="count-summary" style="display:none;">
          <div class="count-summary-row">
            <span>Total sold:</span>
            <strong id="count-total-sold">0 lbs</strong>
          </div>
          <div class="count-summary-row">
            <span>Estimated revenue:</span>
            <strong id="count-total-revenue">$0.00</strong>
          </div>
        </div>
      </div>

      <div class="form-group">
        <label for="count-notes">Notes (optional)</label>
        <textarea id="count-notes" rows="2"></textarea>
      </div>
      <button type="submit" class="submit-btn sale" id="count-submit-btn" disabled>Submit Count</button>
    </form>
  </div>
</div>
```

**Step 2: Add batch count handler in `main.js`**

Replace the old count form handler and partner-change logic with:

```javascript
// In setupEventListeners, replace the count-partner change listener with:
const countPartner = el('count-partner');
if (countPartner) {
  countPartner.addEventListener('change', loadCountInventory);
}

// New function:
async function loadCountInventory() {
  const partnerId = el('count-partner')?.value;
  const linesWrapper = el('count-lines-wrapper');
  const linesContainer = el('count-lines');
  const loading = el('count-inventory-loading');
  const submitBtn = el('count-submit-btn');

  if (!partnerId) {
    if (linesWrapper) linesWrapper.style.display = 'none';
    if (loading) { loading.style.display = 'block'; loading.innerHTML = '<p>Select a partner to load their inventory...</p>'; }
    if (submitBtn) submitBtn.disabled = true;
    return;
  }

  if (loading) { loading.style.display = 'block'; loading.innerHTML = '<p>Loading inventory...</p>'; }
  if (linesWrapper) linesWrapper.style.display = 'none';

  try {
    const result = await api.getInventory(partnerId);
    const inventory = result.data || [];

    if (inventory.length === 0) {
      if (loading) { loading.style.display = 'block'; loading.innerHTML = '<p>No inventory on hand for this partner.</p>'; }
      if (submitBtn) submitBtn.disabled = true;
      return;
    }

    if (loading) loading.style.display = 'none';
    if (linesWrapper) linesWrapper.style.display = 'block';
    if (submitBtn) submitBtn.disabled = false;

    linesContainer.innerHTML = inventory.map(inv => `
      <div class="line-item count-line" data-strain="${inv.strain}" data-type="${inv.type}">
        <div class="li-col-strain">
          <span class="count-strain-name">${inv.strain}</span>
        </div>
        <div class="li-col-type">
          <span class="inv-type type-${inv.type}">${inv.type}</span>
        </div>
        <div class="li-col-weight">
          <span class="count-expected">${inv.on_hand_lbs.toFixed(1)}</span>
        </div>
        <div class="li-col-price">
          <input type="number" class="count-actual" step="0.1" min="0" value="" placeholder="${inv.on_hand_lbs.toFixed(1)}">
        </div>
        <div class="li-col-remove">
          <span class="count-diff">--</span>
        </div>
      </div>
    `).join('');

    // Live diff calculation
    linesContainer.querySelectorAll('.count-actual').forEach(input => {
      input.addEventListener('input', updateCountSummary);
    });
  } catch (err) {
    if (loading) { loading.style.display = 'block'; loading.innerHTML = '<p>Failed to load inventory.</p>'; }
  }
}

function updateCountSummary() {
  const lines = el('count-lines')?.querySelectorAll('.count-line') || [];
  let totalSold = 0;
  let totalRevenue = 0;

  lines.forEach(line => {
    const expected = parseFloat(line.querySelector('.count-expected').textContent) || 0;
    const actualInput = line.querySelector('.count-actual');
    const diffEl = line.querySelector('.count-diff');
    const actual = actualInput.value !== '' ? parseFloat(actualInput.value) : null;

    if (actual !== null) {
      const sold = Math.max(0, expected - actual);
      diffEl.textContent = sold > 0 ? `-${sold.toFixed(1)}` : '0';
      diffEl.className = 'count-diff' + (sold > 0 ? ' count-diff-sold' : '');
      // Use grade-based estimate: tops=$150, smalls=$50
      const type = line.dataset.type;
      const price = type === 'tops' ? 150 : 50;
      totalSold += sold;
      totalRevenue += sold * price;
    } else {
      diffEl.textContent = '--';
      diffEl.className = 'count-diff';
    }
  });

  const summary = el('count-summary');
  if (summary) {
    summary.style.display = totalSold > 0 ? 'block' : 'none';
    el('count-total-sold').textContent = totalSold.toFixed(1) + ' lbs';
    el('count-total-revenue').textContent = '$' + totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 });
  }
}
```

**Step 3: Replace `handleCountSubmit` in `main.js`**

```javascript
async function handleCountSubmit(e) {
  e.preventDefault();
  const partnerId = el('count-partner').value;
  const date = el('count-date').value;
  const notes = el('count-notes')?.value || '';
  const lines = el('count-lines')?.querySelectorAll('.count-line') || [];

  const items = [];
  lines.forEach(line => {
    const actualInput = line.querySelector('.count-actual');
    if (actualInput.value !== '') {
      items.push({
        strain: line.dataset.strain,
        type: line.dataset.type,
        counted_lbs: parseFloat(actualInput.value),
      });
    }
  });

  if (items.length === 0) {
    ui.showToast('Enter at least one actual weight', 'error');
    return;
  }

  ui.closeModal('count-modal');
  ui.showToast(`Counting ${items.length} items...`);
  trackUserAction();

  try {
    const result = await api.saveBatchCount({ partner_id: partnerId, date, items, notes });
    const data = result.data;
    if (data?.summary) {
      ui.showToast(`${data.summary.total_sold_lbs.toFixed(1)} lbs sold — $${data.summary.total_revenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    }
    detailCache.delete(parseInt(partnerId));
    refreshAll();
  } catch (err) {
    ui.showToast(err.message || 'Failed to save count', 'error');
    refreshAll();
  }
}
```

**Step 4: Commit**

```bash
git add src/pages/consignment.html src/js/consignment/main.js
git commit -m "feat: batch inventory count with pre-populated partner inventory"
```

---

## Task 6: Frontend — Add Strain Inline from Intake Form

**Why:** Can't add new strains from UI. Farms bring new cultivars regularly.

**Files:**
- Modify: `src/js/consignment/ui.js` (update strain dropdown rendering)
- Modify: `src/js/consignment/main.js` (handle "add new" option)

**Step 1: Update `populateStrainDropdown` in `ui.js`**

```javascript
export function populateStrainDropdown(strains, selectEl) {
  selectEl.innerHTML = '<option value="">Select strain...</option>';
  strains.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.name;
    opt.textContent = s.name;
    selectEl.appendChild(opt);
  });
  // Add "new strain" option
  const addOpt = document.createElement('option');
  addOpt.value = '__add_new__';
  addOpt.textContent = '+ Add new strain...';
  addOpt.style.fontStyle = 'italic';
  selectEl.appendChild(addOpt);
}
```

**Step 2: Handle the "add new" selection in `main.js`**

Add a delegated listener in `setupEventListeners`:

```javascript
// Handle "add new strain" in any strain dropdown
document.addEventListener('change', async (e) => {
  if (!e.target.classList.contains('strain-select') && !e.target.classList.contains('line-strain')) return;
  if (e.target.value !== '__add_new__') return;

  const name = prompt('New strain name:');
  if (!name || !name.trim()) {
    e.target.value = '';
    return;
  }

  try {
    await api.saveStrain(name.trim());
    // Reload strains and re-populate all dropdowns
    const result = await api.getStrains();
    strains = result.data || [];
    document.querySelectorAll('.strain-select, .line-strain').forEach(sel => {
      const currentVal = sel === e.target ? name.trim() : sel.value;
      ui.populateStrainDropdown(strains, sel);
      if (currentVal) sel.value = currentVal;
    });
    e.target.value = name.trim();
    ui.showToast(`Added "${name.trim()}"`);
  } catch (err) {
    ui.showToast('Failed to add strain', 'error');
    e.target.value = '';
  }
});
```

**Step 3: Commit**

```bash
git add src/js/consignment/ui.js src/js/consignment/main.js
git commit -m "feat: add new strains inline from intake form"
```

---

## Task 7: Frontend — Reconciliation View in Partner Detail

**Why:** Partner detail currently shows raw lists. Need a clear "what was intaked, what sold, what's left, what's owed" view like the whiteboard analysis.

**Files:**
- Modify: `src/js/consignment/ui.js` (update `renderPartnerDetail`)
- Modify: `src/js/consignment/main.js` (fetch reconciliation data)

**Step 1: Update `showPartnerDetail` in `main.js` to also fetch reconciliation**

```javascript
async function showPartnerDetail(partnerId) {
  try {
    selectedPartnerId = partnerId;
    ui.showDetailSkeleton(el('partner-detail'));

    const [detailResult, reconResult] = await Promise.all([
      api.getPartnerDetail(partnerId),
      api.getReconciliation(partnerId),
    ]);

    const detail = detailResult.data;
    detail.reconciliation = reconResult.data;

    detailCache.set(partnerId, { data: detail, ts: Date.now() });
    ui.renderPartnerDetail(detail, el('partner-detail'), () => { selectedPartnerId = null; });
  } catch (err) {
    console.error('Failed to load partner detail:', err);
    ui.showToast('Failed to load partner details', 'error');
  }
}
```

**Step 2: Add reconciliation section to `renderPartnerDetail` in `ui.js`**

After the detail-stats div, before the inventory section, add:

```javascript
${d.reconciliation ? `
  <div class="detail-section">
    <h3><i class="ph-duotone ph-chart-bar"></i> Sales Reconciliation</h3>
    <div class="recon-grade-section">
      <h4>Tops — $${fmt(d.reconciliation.summary.tops.revenue)}</h4>
      <div class="recon-table">
        <div class="recon-table-header">
          <span>Strain</span>
          <span>Intaked</span>
          <span>Sold</span>
          <span>Remaining</span>
          <span>Revenue</span>
        </div>
        ${d.reconciliation.lines.filter(l => l.type === 'tops').map(l => `
          <div class="recon-table-row">
            <span class="recon-strain">${esc(l.strain)}</span>
            <span>${l.total_intake.toFixed(1)}</span>
            <span class="recon-sold">${l.total_sold.toFixed(1)}</span>
            <span>${l.remaining.toFixed(1)}</span>
            <span class="recon-revenue">\$${fmt(l.sold_revenue)}</span>
          </div>
        `).join('') || '<div class="empty-hint">No tops</div>'}
      </div>
    </div>
    <div class="recon-grade-section">
      <h4>Smalls — $${fmt(d.reconciliation.summary.smalls.revenue)}</h4>
      <div class="recon-table">
        <div class="recon-table-header">
          <span>Strain</span>
          <span>Intaked</span>
          <span>Sold</span>
          <span>Remaining</span>
          <span>Revenue</span>
        </div>
        ${d.reconciliation.lines.filter(l => l.type === 'smalls').map(l => `
          <div class="recon-table-row">
            <span class="recon-strain">${esc(l.strain)}</span>
            <span>${l.total_intake.toFixed(1)}</span>
            <span class="recon-sold">${l.total_sold.toFixed(1)}</span>
            <span>${l.remaining.toFixed(1)}</span>
            <span class="recon-revenue">\$${fmt(l.sold_revenue)}</span>
          </div>
        `).join('') || '<div class="empty-hint">No smalls</div>'}
      </div>
    </div>
    <div class="recon-totals">
      <div class="recon-total-row">
        <span>Total Revenue</span>
        <strong>\$${fmt(d.reconciliation.summary.total_revenue)}</strong>
      </div>
      <div class="recon-total-row">
        <span>Total Paid</span>
        <strong class="positive">\$${fmt(d.reconciliation.summary.total_paid)}</strong>
      </div>
      <div class="recon-total-row recon-balance">
        <span>Balance Owed</span>
        <strong class="${d.reconciliation.summary.balance_owed > 0 ? 'warning' : ''}">\$${fmt(d.reconciliation.summary.balance_owed)}</strong>
      </div>
    </div>
  </div>
` : ''}
```

**Step 3: Commit**

```bash
git add src/js/consignment/ui.js src/js/consignment/main.js
git commit -m "feat: reconciliation view in partner detail"
```

---

## Task 8: Frontend — Intake Form UX (Price Defaults + Grade on Partner Card)

**Why:** Price field should pre-fill from defaults. Partner cards should show tops/smalls breakdown.

**Files:**
- Modify: `src/js/consignment/main.js` (price pre-fill on type toggle)
- Modify: `src/js/consignment/ui.js` (partner card grade split)

**Step 1: Pre-fill price in intake lines based on grade toggle**

In the `addIntakeLine` function, update the toggle click handler:

```javascript
// Toggle click for this line — also update price
row.querySelectorAll('.toggle-option').forEach(btn => {
  btn.addEventListener('click', () => {
    const group = btn.closest('.toggle-group');
    group.querySelectorAll('.toggle-option').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    // Auto-fill price based on grade
    const priceInput = row.querySelector('.line-price');
    const type = btn.dataset.value;
    if (priceInput && !priceInput.dataset.userEdited) {
      priceInput.value = type === 'tops' ? '150' : '50';
    }
  });
});

// Set initial price default for tops
const priceInput = row.querySelector('.line-price');
if (priceInput) {
  priceInput.value = '150';
  priceInput.addEventListener('input', () => { priceInput.dataset.userEdited = 'true'; });
}
```

**Step 2: Update partner cards to show grade split**

In `ui.js`, update the `renderPartnerCards` function. Replace `card-hero-number` rendering:

The strain breakdown already loads async via `loadStrainBreakdowns()`. Instead, update `loadStrainBreakdowns` in `main.js` to show a tops/smalls summary:

```javascript
function loadStrainBreakdowns() {
  partners.filter(p => p.inventory_lbs > 0).forEach(async (p) => {
    try {
      const result = await api.getInventory(p.id);
      const inventory = result.data || [];
      const strainEl = document.getElementById('strains-' + p.id);
      if (!strainEl || inventory.length === 0) return;

      const topsLbs = inventory.filter(i => i.type === 'tops').reduce((s, i) => s + i.on_hand_lbs, 0);
      const smallsLbs = inventory.filter(i => i.type === 'smalls').reduce((s, i) => s + i.on_hand_lbs, 0);

      let summary = [];
      if (topsLbs > 0) summary.push(`${topsLbs.toFixed(1)} tops`);
      if (smallsLbs > 0) summary.push(`${smallsLbs.toFixed(1)} smalls`);

      const strainNames = inventory
        .filter(i => i.on_hand_lbs > 0)
        .map(i => i.strain)
        .filter((v, idx, arr) => arr.indexOf(v) === idx);

      strainEl.innerHTML = `
        <div class="card-grade-split">${summary.join(' · ')}</div>
        <div class="card-strain-list">${strainNames.join(' · ')}</div>
      `;
    } catch(e) { /* silent fail */ }
  });
}
```

**Step 3: Commit**

```bash
git add src/js/consignment/main.js src/js/consignment/ui.js
git commit -m "feat: auto-fill pricing defaults, show grade split on partner cards"
```

---

## Task 9: CSS — Styles for New Components

**Why:** Batch count lines, reconciliation tables, count diff indicators, and grade splits need styling.

**Files:**
- Modify: `src/css/consignment.css`

**Step 1: Add CSS for batch count, reconciliation, and grade splits**

Append to `consignment.css`:

```css
/* ═══ BATCH COUNT ═══ */

.count-line { align-items: center; }
.count-strain-name { font-weight: 500; }
.count-expected { font-family: 'JetBrains Mono', monospace; opacity: 0.7; }
.count-actual {
  width: 100%;
  text-align: right;
  font-family: 'JetBrains Mono', monospace;
}
.count-diff {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.85rem;
  opacity: 0.5;
  text-align: center;
  min-width: 50px;
}
.count-diff-sold {
  color: var(--ro-gold, #e4aa4f);
  opacity: 1;
  font-weight: 600;
}

.count-summary {
  margin-top: 16px;
  padding: 12px 16px;
  background: rgba(102, 137, 113, 0.1);
  border: 1px solid rgba(102, 137, 113, 0.2);
  border-radius: 8px;
}
.count-summary-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 0.95rem;
}
.count-summary-row strong {
  font-family: 'JetBrains Mono', monospace;
  color: var(--ro-gold, #e4aa4f);
}

/* ═══ RECONCILIATION ═══ */

.recon-grade-section { margin-bottom: 20px; }
.recon-grade-section h4 {
  font-family: 'Outfit', sans-serif;
  font-size: 0.9rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
  color: rgba(255,255,255,0.7);
}

.recon-table { width: 100%; }
.recon-table-header,
.recon-table-row {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr 1.2fr;
  gap: 8px;
  padding: 6px 0;
  font-size: 0.85rem;
  align-items: center;
}
.recon-table-header {
  font-weight: 600;
  text-transform: uppercase;
  font-size: 0.75rem;
  letter-spacing: 0.05em;
  opacity: 0.6;
  border-bottom: 1px solid rgba(255,255,255,0.1);
  padding-bottom: 8px;
  margin-bottom: 4px;
}
.recon-table-row {
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.recon-strain { font-weight: 500; }
.recon-sold { color: var(--ro-gold, #e4aa4f); font-weight: 600; }
.recon-revenue {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 600;
}

.recon-totals {
  margin-top: 16px;
  padding: 12px 16px;
  background: rgba(255,255,255,0.03);
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.08);
}
.recon-total-row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  font-size: 0.95rem;
}
.recon-total-row strong {
  font-family: 'JetBrains Mono', monospace;
}
.recon-total-row strong.positive { color: var(--ro-green, #668971); }
.recon-total-row strong.warning { color: var(--ro-gold, #e4aa4f); }
.recon-balance {
  border-top: 1px solid rgba(255,255,255,0.1);
  margin-top: 4px;
  padding-top: 10px;
  font-size: 1.05rem;
}

/* ═══ PARTNER CARD GRADE SPLIT ═══ */

.card-grade-split {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
  color: var(--ro-gold, #e4aa4f);
  margin-bottom: 2px;
}
.card-strain-list {
  font-size: 0.75rem;
  opacity: 0.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ═══ LIGHT THEME OVERRIDES ═══ */

[data-theme="light"] .count-diff-sold { color: #b8860b; }
[data-theme="light"] .count-summary { background: rgba(102, 137, 113, 0.08); border-color: rgba(102, 137, 113, 0.15); }
[data-theme="light"] .count-summary-row strong { color: #b8860b; }
[data-theme="light"] .recon-grade-section h4 { color: rgba(0,0,0,0.6); }
[data-theme="light"] .recon-table-header { border-color: rgba(0,0,0,0.1); opacity: 0.5; }
[data-theme="light"] .recon-table-row { border-color: rgba(0,0,0,0.05); }
[data-theme="light"] .recon-sold { color: #b8860b; }
[data-theme="light"] .recon-totals { background: rgba(0,0,0,0.02); border-color: rgba(0,0,0,0.08); }
[data-theme="light"] .recon-balance { border-color: rgba(0,0,0,0.1); }
[data-theme="light"] .card-grade-split { color: #b8860b; }
```

**Step 2: Commit**

```bash
git add src/css/consignment.css
git commit -m "feat: styles for batch count, reconciliation, grade splits"
```

---

## Task 10: Deploy + Verify

**Files:** None (deployment only)

**Step 1: Deploy workers**

```bash
cd workers
npx wrangler deploy
```

Expected: Successful deployment with new endpoints.

**Step 2: Push frontend**

```bash
git push origin main
```

Expected: GitHub Pages auto-deploys in ~1-2 min.

**Step 3: Verify end-to-end**

1. Open consignment page, log in
2. Add a partner (e.g. "Jeff")
3. Record intake — verify price auto-fills ($150 for tops, $50 for smalls)
4. Add a new strain from dropdown — verify it persists
5. Do inventory count — verify it pre-populates Jeff's stock, calculates diff live
6. Submit count — verify sales auto-created, toast shows total
7. View partner detail — verify reconciliation table shows before/after/sold/revenue
8. Record payment — verify balance updates

---

## Summary

| Task | What | Files |
|------|------|-------|
| 0 | Fresh data reset | migration |
| 1 | Pricing defaults schema | migration + schema.sql + db.js |
| 2 | Price resolution + pricing API | consignment-d1.js |
| 3 | Batch count + reconciliation API | consignment-d1.js |
| 4 | Frontend API methods | api.js |
| 5 | Batch count modal UI | consignment.html + main.js |
| 6 | Inline strain add | ui.js + main.js |
| 7 | Reconciliation view | ui.js + main.js |
| 8 | Price defaults + grade split cards | main.js + ui.js |
| 9 | CSS for new components | consignment.css |
| 10 | Deploy + verify | deployment |
