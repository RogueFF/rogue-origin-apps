# Grove Bins Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop running out of Grove bags: a Shopify-fed usage ledger that estimates on-hand per size and emails Damon by an order-by date, plus one red ORDER card per rack lane as the physical trigger.

**Architecture:** The worker (`workers/`, Cloudflare + D1) gains a per-size config, a usage ledger written by a Shopify Flow HTTP call, a baseline set at Receive/Recount, and a pure math module that turns those into on-hand, reorder point, order-by date and red-tape depth. One short route `/k/<token>` serves the red-card scan page. The Tag & Desk Grove tab (`src/js/tag-desk/`) reads one `getBinStatus` action and drives Receive, Recount, Settings and the once-only lane-kit print. Design: `docs/plans/2026-10-14-grove-bins-design.md`.

**Tech Stack:** Cloudflare Workers (ES modules), D1/SQLite, `node --test` unit tests in `tests/*.test.mjs`, Playwright for the Desk, vanilla JS front end (no framework), Gmail relay via `workers/src/lib/mailer.js`.

**Branch:** `feat/grove-packs` (already holds the design). Work in a worktree off it; master is stale (Sep 28) and other harvest branches own migrations 0040–0045, so **this migration is 0046**. Before Task 1 run `git log --all --name-only --format= -- workers/migrations | sort -u | tail -1` and bump if anything higher appeared.

**Conventions you must follow:**
- Run unit tests from the repo root: `npm test` (= `node --test tests/*.test.mjs`).
- D1 helpers: `query / queryOne / insert / update / execute` from `workers/src/lib/db.js`. `insert(db, table, obj)` returns the new id.
- Responses: `successResponse(obj)` and `createError('VALIDATION_ERROR' | 'NOT_FOUND' | 'UNAUTHORIZED', msg)` from `workers/src/lib/response.js` / `errors.js`.
- Migrations are applied by hand: `cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0046-kanban-bins.sql`.
- Deploy the API from `workers/`: `cd workers && npx wrangler deploy` (root `npm run deploy` ships the wrong thing). Never deploy during active tagging hours; check `wrangler tail` after.
- Commit after every task. Commit **only the files you touched** (`git add <paths>`, never `git add -A` — the repo has stray untracked files and a stamp hook).
- Card ids: 21 = Custom 1 oz, 56 = Custom 1/4 & 1/2, 54 = Custom 1 LB, 69 = 1 LB blank, 99 = 10 LB. All have `supplier = 'Grove'`.

---

## Step 1 — the ledger (ships alone; starts collecting data before any card exists)

### Task 1: Migration 0046

**Files:**
- Create: `workers/migrations/0046-kanban-bins.sql`

**Step 1: Write the migration**

```sql
-- Grove bins: per-size config, usage ledger, baselines, red cards.
-- Design: docs/plans/2026-10-14-grove-bins-design.md
--
-- Nothing is added to kanban_cards: updateCard is a full-row overwrite and
-- would blank any new column on the next edit.

CREATE TABLE IF NOT EXISTS kanban_bin_config (
  card_id         INTEGER PRIMARY KEY,
  bags_per_box    INTEGER NOT NULL DEFAULT 100,   -- as Grove ships it
  bags_per_bin    INTEGER NOT NULL DEFAULT 50,    -- as the crew splits it
  lead_days       INTEGER NOT NULL DEFAULT 75,
  safety_days     INTEGER NOT NULL DEFAULT 30,
  moq             INTEGER NOT NULL DEFAULT 2500,
  seed_per_month  REAL    NOT NULL,               -- used until the ledger has 14 days
  colour          TEXT,                           -- lane colour token
  updated_at      TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (card_id) REFERENCES kanban_cards(id) ON DELETE CASCADE
);

-- One red ORDER card per lane (kind='red'). kind='bin' is reserved for a size
-- that later needs per-bin scanning; nothing creates those in v1.
CREATE TABLE IF NOT EXISTS kanban_bin_cards (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id   INTEGER NOT NULL,
  slot_no   INTEGER NOT NULL DEFAULT 0,
  kind      TEXT NOT NULL DEFAULT 'red',          -- red | bin
  token     TEXT NOT NULL,                        -- 10 chars base32, in the QR
  retired   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (card_id) REFERENCES kanban_cards(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kbc_token ON kanban_bin_cards(token);

-- Per-lane event log: receive | recount | red | void (open reserved for v2).
CREATE TABLE IF NOT EXISTS kanban_bin_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id   INTEGER NOT NULL,
  kind      TEXT NOT NULL,
  bins      INTEGER NOT NULL DEFAULT 0,           -- +N receive, absolute recount, 0 red, -N void
  bag_count INTEGER NOT NULL DEFAULT 0,           -- bags per bin at the time
  bin_card  INTEGER,                              -- kanban_bin_cards.id for 'red'
  lot       TEXT, by TEXT, note TEXT,
  at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kbe_card_at ON kanban_bin_events(card_id, at);

-- Recipe: what one sold unit of a Shopify variant consumes.
CREATE TABLE IF NOT EXISTS kanban_recipes (
  variant_id  TEXT NOT NULL,                      -- Shopify numeric variant id as text
  card_id     INTEGER NOT NULL,
  qty         REAL NOT NULL DEFAULT 1,
  PRIMARY KEY (variant_id, card_id)
);

-- Usage ledger: every bag consumed, by source. card_id 0 = unmapped variant.
CREATE TABLE IF NOT EXISTS kanban_usage (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id   INTEGER NOT NULL,
  qty       REAL NOT NULL,
  source    TEXT NOT NULL,                        -- shopify | shopify:seed | shopify:unmapped | wholesale | consignment
  ref       TEXT,                                 -- order name (#1234) or seed label
  variant_id TEXT,                                -- kept for unmapped rows so the Desk can list them
  at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ku_ref ON kanban_usage(source, ref, card_id, variant_id);
CREATE INDEX IF NOT EXISTS idx_ku_card_at ON kanban_usage(card_id, at);

-- Baseline: written by Receive and Recount. Usage after `at` counts down from `bags`.
CREATE TABLE IF NOT EXISTS kanban_baselines (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id   INTEGER NOT NULL,
  bags      INTEGER NOT NULL,
  at        TEXT NOT NULL DEFAULT (datetime('now')),
  reason    TEXT                                  -- receive | recount
);
CREATE INDEX IF NOT EXISTS idx_kbl_card_at ON kanban_baselines(card_id, at);

-- Seed config for the five Grove cards (seed rates from the 2025-11 → 2026-02 export).
INSERT OR IGNORE INTO kanban_bin_config (card_id, bags_per_box, bags_per_bin, lead_days, safety_days, moq, seed_per_month, colour) VALUES
  (21, 100, 50, 75, 30, 2500, 600, 'orange'),
  (56, 100, 50, 75, 30, 2500, 350, 'teal'),
  (54, 100, 50, 75, 30, 2500, 450, 'violet'),
  (69, 100, 50,  7,  7,    0, 100, 'olive'),
  (99, 100, 50,  7,  7,    0,  90, 'slate');
```

**Step 2: Apply locally and check the tables exist**

Run: `cd workers && npx wrangler d1 execute rogue-origin-db --local --file=migrations/0046-kanban-bins.sql && npx wrangler d1 execute rogue-origin-db --local --command "SELECT card_id, seed_per_month FROM kanban_bin_config"`
Expected: five rows, 21/56/54/69/99.

**Step 3: Commit**

```bash
git add workers/migrations/0046-kanban-bins.sql
git commit -m "feat(grove): migration 0046 — bin config, usage ledger, baselines, red cards"
```

---

### Task 2: Pure math — `bin-math.js`

**Files:**
- Create: `workers/src/lib/bin-math.js`
- Test: `tests/grove-bin-math.test.mjs`

**Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneStatus, DAY } from '../workers/src/lib/bin-math.js';

const T = new Date('2026-10-14T12:00:00Z');
const base = {
  per: 50, lead: 75, safety: 30, moq: 2500, seedPerMonth: 600,
  baseline: { bags: 2000, at: '2026-10-01T00:00:00Z' },
  usageSince: 200, usage56: 1120, usageDays: 56, seasonUsage: null,
  redScanned: false, today: T,
};

test('on hand = baseline minus usage since', () => {
  assert.equal(laneStatus(base).onHand, 1800);
});

test('rate uses the ledger once it has 14 days, else the seed', () => {
  assert.equal(laneStatus(base).rate, 20);                       // 1120 / 56
  assert.equal(laneStatus(base).rateSource, 'ledger');
  const s = laneStatus({ ...base, usageDays: 3 });
  assert.ok(Math.abs(s.rate - 600 / 30.4) < 0.01);
  assert.equal(s.rateSource, 'seed');
});

test('seasonal window wins when it is higher', () => {
  const s = laneStatus({ ...base, seasonUsage: 105 * 30 });     // 30/day last fall
  assert.equal(s.rate, 30);
  assert.equal(s.rateSource, 'season');
});

test('reorder point, order-by, red tape depth', () => {
  const s = laneStatus(base);                                   // rate 20
  assert.equal(s.reorderPoint, 2100);                           // 20 × 105
  assert.equal(s.redTapeAtBins, 42);                            // ceil(2100 / 50)
  // orderBy = today + (onHand − rate×lead)/rate = today + (1800 − 1500)/20 = +15 d
  assert.equal(s.orderBy, '2026-10-29');
  assert.equal(s.runOut, '2026-12-13');                         // +90 d
});

test('status: order when under the point, soon within 14 days, else ok', () => {
  assert.equal(laneStatus(base).status, 'order');               // 1800 ≤ 2100
  assert.equal(laneStatus({ ...base, usageSince: 0, usage56: 280 }).status, 'soon');  // rate 5, onHand 2000, RP 525, orderBy +25d → ok? no: orderBy = (2000-375)/5 = 325 d → ok
});

test('suggested qty is the MOQ or four months, whichever is larger', () => {
  assert.equal(laneStatus(base).suggestedQty, 2500);            // 20×120 = 2400 < MOQ
  assert.equal(laneStatus({ ...base, moq: 0 }).suggestedQty, 2400);
});

test('a red card scan forces order regardless of the estimate', () => {
  assert.equal(laneStatus({ ...base, usageSince: 0, redScanned: true }).status, 'order');
});

test('recount flag when the counted leftover disagrees by more than a bin', () => {
  assert.equal(laneStatus({ ...base, leftoverBins: 36 }).recount, false);   // 1800 bags = 36 bins
  assert.equal(laneStatus({ ...base, leftoverBins: 33 }).recount, true);    // 1650 vs 1800 → 3 bins off
});

test('rate never divides by zero', () => {
  const s = laneStatus({ ...base, usage56: 0, usageDays: 56, seedPerMonth: 0 });
  assert.equal(s.rate, 0);
  assert.equal(s.runOut, null);
  assert.equal(s.orderBy, null);
  assert.equal(s.status, 'ok');
});
```

Fix the `soon` case before running: replace that test with one that lands inside the 14-day window, e.g. `usageSince: 0, usage56: 1120` → onHand 2000, rate 20, RP 2100 → `order`; and `{ usageSince: 0, usage56: 1120, baseline: { bags: 2400, at } }` → onHand 2400, orderBy = (2400−1500)/20 = +45 d → `ok`; and `baseline.bags: 1760` → onHand 1760 < 2100 → order. For `soon` use `baseline.bags: 2300`: orderBy = (2300−1500)/20 = 40 d → ok. So `soon` needs onHand between RP (2100) and RP + 14×rate (2380): use `baseline.bags: 2250` → onHand 2250 > 2100, orderBy = 750/20 = 37.5 d. That is not within 14 d either — `soon` is defined on orderBy, so soon ⇔ onHand − rate×lead ≤ 14×rate ⇔ onHand ≤ rate×(lead+14) = 1780, which is below RP. **Conclusion: with safety 30 > 14, `soon` can never fire before `order`.** Define `soon` instead as `onHand ≤ reorderPoint + 14 × rate` (within two weeks of the point). Test: `baseline.bags: 2300, usageSince: 0` → onHand 2300 ≤ 2380 → `soon`; `baseline.bags: 2600` → `ok`.

**Step 2: Run to verify it fails**

Run: `node --test tests/grove-bin-math.test.mjs`
Expected: FAIL — cannot find module `bin-math.js`.

**Step 3: Implement**

```js
/**
 * Grove bin math. Pure — no D1, no Date.now(). Design §5.
 *
 * Inputs (all numbers in bags unless noted):
 *   per            bags per bin
 *   lead, safety   days
 *   moq            0 = none
 *   seedPerMonth   fallback rate until the ledger has 14 days
 *   baseline       { bags, at } — latest Receive/Recount
 *   usageSince     bags used after baseline.at
 *   usage56        bags used in the last 56 days
 *   usageDays      how many days of ledger exist (caps the trailing window)
 *   seasonUsage    bags used last year in [today+lead, today+lead+safety], or null
 *   redScanned     a red-card scan after baseline.at
 *   leftoverBins   optional physical count (Receive) for the recount flag
 *   today          Date
 */
export const DAY = 86400000;

const iso = d => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * DAY);

export function laneStatus(i) {
  const per = Math.max(1, i.per | 0);
  const lead = i.lead | 0, safety = i.safety | 0, moq = i.moq | 0;
  const onHand = Math.max(0, (i.baseline?.bags ?? 0) - (i.usageSince || 0));

  const window = Math.min(56, Math.max(1, i.usageDays | 0));
  let rate, rateSource;
  if ((i.usageDays | 0) >= 14) { rate = (i.usage56 || 0) / window; rateSource = 'ledger'; }
  else { rate = (i.seedPerMonth || 0) / 30.4; rateSource = 'seed'; }
  if (i.seasonUsage != null && lead + safety > 0) {
    const s = i.seasonUsage / (lead + safety);
    if (s > rate) { rate = s; rateSource = 'season'; }
  }

  const reorderPoint = Math.round(rate * (lead + safety));
  const redTapeAtBins = Math.ceil(reorderPoint / per);
  const suggestedQty = Math.max(moq, Math.ceil((rate * 120) / 100) * 100);

  let runOut = null, orderBy = null;
  if (rate > 0) {
    runOut = iso(addDays(i.today, onHand / rate));
    orderBy = iso(addDays(i.today, (onHand - rate * lead) / rate));
  }

  let status = 'ok';
  if (i.redScanned || (rate > 0 && onHand <= reorderPoint)) status = 'order';
  else if (rate > 0 && onHand <= reorderPoint + 14 * rate) status = 'soon';

  const recount = i.leftoverBins != null && Math.abs(i.leftoverBins * per - onHand) > per;

  return { onHand, bins: Math.floor(onHand / per), rate, rateSource, reorderPoint, redTapeAtBins,
           suggestedQty, runOut, orderBy, status, recount };
}
```

**Step 4: Run tests, make them pass**

Run: `node --test tests/grove-bin-math.test.mjs`
Expected: all PASS. Adjust the numeric expectations in the tests only if your arithmetic above was wrong, never by loosening them.

**Step 5: Commit**

```bash
git add workers/src/lib/bin-math.js tests/grove-bin-math.test.mjs
git commit -m "feat(grove): pure lane math — on hand, rate (ledger/seed/season), order-by, red tape depth"
```

---

### Task 3: Flow payload → usage rows (pure) and `orderUsage` action

**Files:**
- Create: `workers/src/lib/bin-usage.js`
- Modify: `workers/src/handlers/kanban-d1.js` (imports at top; new function; router map at the bottom)
- Test: `tests/grove-usage.test.mjs`

**Step 1: Failing tests for the pure part**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlowOrder, usageRowsFor } from '../workers/src/lib/bin-usage.js';

const RECIPES = [{ variant_id: '111', card_id: 21, qty: 1 }, { variant_id: '222', card_id: 54, qty: 1 }, { variant_id: '222', card_id: 99, qty: 0 }];

test('parseFlowOrder accepts the Flow body and ignores junk', () => {
  const o = parseFlowOrder({ order: '#1001', at: '2026-10-14T01:02:03Z', items: [{ variant_id: 'gid://shopify/ProductVariant/111', qty: 2 }, { variant_id: '', qty: 1 }] });
  assert.deepEqual(o, { ref: '#1001', at: '2026-10-14T01:02:03Z', items: [{ variantId: '111', qty: 2 }] });
});

test('parseFlowOrder rejects a body with no order name', () => {
  assert.throws(() => parseFlowOrder({ items: [] }), /order/);
});

test('usageRowsFor multiplies qty by recipe qty and skips zero recipes', () => {
  const rows = usageRowsFor({ ref: '#1001', at: 'T', items: [{ variantId: '111', qty: 2 }, { variantId: '222', qty: 1 }] }, RECIPES);
  assert.deepEqual(rows, [
    { card_id: 21, qty: 2, source: 'shopify', ref: '#1001', variant_id: '111', at: 'T' },
    { card_id: 54, qty: 1, source: 'shopify', ref: '#1001', variant_id: '222', at: 'T' },
  ]);
});

test('an unmapped variant becomes a loud card_id 0 row, never silence', () => {
  const rows = usageRowsFor({ ref: '#1002', at: 'T', items: [{ variantId: '999', qty: 3 }] }, RECIPES);
  assert.deepEqual(rows, [{ card_id: 0, qty: 3, source: 'shopify:unmapped', ref: '#1002', variant_id: '999', at: 'T' }]);
});
```

**Step 2: Run** `node --test tests/grove-usage.test.mjs` → FAIL (module missing).

**Step 3: Implement `bin-usage.js`**

```js
/** Shopify Flow → usage rows. Pure. Design §4. */
export function parseFlowOrder(body) {
  const ref = String(body?.order || '').trim();
  if (!ref) throw new Error('order (name) is required');
  const at = body.at ? String(body.at) : new Date().toISOString();
  const items = [];
  for (const it of Array.isArray(body.items) ? body.items : []) {
    const variantId = String(it?.variant_id || '').replace(/^gid:\/\/shopify\/ProductVariant\//, '').trim();
    const qty = Number(it?.qty);
    if (!variantId || !(qty > 0)) continue;
    items.push({ variantId, qty });
  }
  return { ref, at, items };
}

export function usageRowsFor(order, recipes) {
  const byVariant = new Map();
  for (const r of recipes) {
    if (!byVariant.has(r.variant_id)) byVariant.set(r.variant_id, []);
    byVariant.get(r.variant_id).push(r);
  }
  const rows = [];
  for (const it of order.items) {
    const rs = byVariant.get(it.variantId);
    if (!rs) { rows.push({ card_id: 0, qty: it.qty, source: 'shopify:unmapped', ref: order.ref, variant_id: it.variantId, at: order.at }); continue; }
    for (const r of rs) {
      const q = it.qty * Number(r.qty);
      if (q > 0) rows.push({ card_id: r.card_id, qty: q, source: 'shopify', ref: order.ref, variant_id: it.variantId, at: order.at });
    }
  }
  return rows;
}
```

**Step 4: Run** → PASS.

**Step 5: Add the action to `kanban-d1.js`**

Imports at the top:
```js
import { parseFlowOrder, usageRowsFor } from '../lib/bin-usage.js';
```

New function (place after `getOrderHistory`):
```js
/**
 * POST ?action=orderUsage&secret=<WEBHOOK_SECRET>  — Shopify Flow "Order created".
 * Writes one kanban_usage row per (line item × recipe). Idempotent on
 * (source, ref, card_id, variant_id), so Flow retries are harmless.
 */
async function orderUsage(body, request, env, ctx) {
  const secret = env.WEBHOOK_SECRET;
  const given = request.headers.get('X-Webhook-Secret') || new URL(request.url).searchParams.get('secret');
  if (secret && given !== secret) throw createError('UNAUTHORIZED', 'bad secret');

  let order;
  try { order = parseFlowOrder(body); } catch (e) { throw createError('VALIDATION_ERROR', e.message); }
  const recipes = await query(env.DB, 'SELECT variant_id, card_id, qty FROM kanban_recipes');
  const rows = usageRowsFor(order, recipes);
  if (rows.length === 0) return successResponse({ success: true, written: 0, unmapped: 0 });

  await env.DB.batch(rows.map(r => env.DB.prepare(
    'INSERT OR IGNORE INTO kanban_usage (card_id, qty, source, ref, variant_id, at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(r.card_id, r.qty, r.source, r.ref, r.variant_id, r.at)));

  const touched = [...new Set(rows.filter(r => r.card_id > 0).map(r => r.card_id))];
  // Task 10 adds: ctx.waitUntil(checkLedgerTriggers(touched, env, ctx))
  return successResponse({ success: true, written: rows.length, unmapped: rows.filter(r => !r.card_id).length, touched });
}
```

Router entry (in the `actions` map):
```js
    // Grove bins — design doc 2026-10-14
    orderUsage: () => orderUsage(body, request, env, ctx),
```

**Step 6: Smoke it locally**

Run: `cd workers && npx wrangler dev` (separate terminal), then
`curl -s -X POST "http://localhost:8787/api/kanban?action=orderUsage&secret=$WEBHOOK_SECRET" -H "content-type: application/json" -d '{"order":"#test1","items":[{"variant_id":"999","qty":1}]}'`
Expected: `{"success":true,"written":1,"unmapped":1,"touched":[]}`. Run it twice; the second returns the same and the table still has one row (`SELECT COUNT(*) FROM kanban_usage`).

**Step 7: Commit**

```bash
git add workers/src/lib/bin-usage.js workers/src/handlers/kanban-d1.js tests/grove-usage.test.mjs
git commit -m "feat(grove): orderUsage — Shopify Flow line items → usage ledger via recipes"
```

---

### Task 4: Recipes — actions and seed

**Files:**
- Modify: `workers/src/handlers/kanban-d1.js`
- Create: `scripts/grove-seed-recipes.mjs`

**Step 1: Actions**

```js
/** GET ?action=getRecipes → { recipes:[{variant_id, card_id, qty, item}], unmapped:[{variant_id, qty, lastSeen}] } */
async function getRecipes(env) {
  const recipes = await query(env.DB, `
    SELECT r.variant_id, r.card_id, r.qty, k.item
      FROM kanban_recipes r LEFT JOIN kanban_cards k ON k.id = r.card_id
     ORDER BY k.item, r.variant_id`);
  const unmapped = await query(env.DB, `
    SELECT variant_id, SUM(qty) AS qty, MAX(at) AS lastSeen
      FROM kanban_usage WHERE source = 'shopify:unmapped' AND at >= datetime('now', '-30 days')
     GROUP BY variant_id ORDER BY qty DESC`);
  return successResponse({ success: true, recipes, unmapped });
}

/** POST ?action=setRecipe {variant_id, card_id, qty}. qty 0 deletes. */
async function setRecipe(body, env) {
  const variantId = String(body.variant_id || '').trim();
  const cardId = Number(body.card_id), qty = Number(body.qty ?? 1);
  if (!variantId || !(cardId > 0) || !(qty >= 0)) throw createError('VALIDATION_ERROR', 'variant_id, card_id, qty required');
  if (qty === 0) await execute(env.DB, 'DELETE FROM kanban_recipes WHERE variant_id = ? AND card_id = ?', [variantId, cardId]);
  else await execute(env.DB, 'INSERT OR REPLACE INTO kanban_recipes (variant_id, card_id, qty) VALUES (?, ?, ?)', [variantId, cardId, qty]);
  return successResponse({ success: true });
}
```
Router: `getRecipes: () => getRecipes(env), setRecipe: () => setRecipe(body, env),`

**Step 2: Seed script**

Input: Nathan's Shopify **products export** CSV (Products → Export → "all products", CSV; it has `Variant SKU`, `Option1 Value`, `Variant Inventory Qty`, and `Handle`; the numeric variant id is NOT in that export — use the **Sales by product variant SKU** report instead, which has `Product variant ID`). The script reads the report CSV, groups by variant id, infers the bag card from the variant title / SKU, and prints SQL:

```js
#!/usr/bin/env node
// Usage: node scripts/grove-seed-recipes.mjs path/to/sales-by-variant.csv > /tmp/recipes.sql
// Infers card id from the variant title; prints INSERT OR IGNORE lines. Review before applying.
import fs from 'node:fs';
const [,, file] = process.argv;
const text = fs.readFileSync(file, 'utf8');
const [head, ...lines] = text.split(/\r?\n/).filter(Boolean);
const cols = head.split(',').map(s => s.replace(/^"|"$/g, '').trim());
const idx = n => cols.findIndex(c => c.toLowerCase() === n.toLowerCase());
const iId = idx('Product variant ID'), iTitle = idx('Product variant title'), iSku = idx('Product variant SKU');
if (iId < 0) { console.error('need a "Product variant ID" column'); process.exit(1); }
const cardFor = t => {
  const s = t.toLowerCase().replace(/\s+/g, '');
  if (/10lb|10lbs/.test(s)) return 99;
  if (/(^|[^\d])1lb|1lbs|1pound|16oz/.test(s)) return 54;
  if (/1\/4lb|1\/2lb|4oz|8oz|quarterpound|halfpound/.test(s)) return 54;   // 1/4 & 1/2 lb use the 1 LB bag — CONFIRM with Koa
  if (/1\/4oz|1\/2oz|7g|14g|quarter|half/.test(s)) return 56;
  if (/(^|[^\d])1oz|28g|ounce/.test(s)) return 21;
  return 0;
};
const seen = new Map();
for (const line of lines) {
  const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
  const id = cells[iId]?.trim(); if (!id || seen.has(id)) continue;
  const title = `${cells[iTitle] || ''} ${cells[iSku] || ''}`;
  seen.set(id, { title, card: cardFor(title) });
}
for (const [id, v] of seen) {
  const sql = v.card ? `INSERT OR IGNORE INTO kanban_recipes (variant_id, card_id, qty) VALUES ('${id}', ${v.card}, 1);` : `-- UNMAPPED ${id}`;
  console.log(`${sql}  -- ${v.title.replace(/\n/g, ' ')}`);
}
```

**Step 3: Run it on the CSV, read the output, fix any wrong guesses by hand, apply**

Run: `node scripts/grove-seed-recipes.mjs ~/Downloads/sales-by-variant.csv > /tmp/recipes.sql` then review, then
`cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=/tmp/recipes.sql`.
Expected: every active flower variant mapped; the `-- UNMAPPED` lines are non-bag products (stickers, merch) or need a manual line.

**Step 4: Commit**

```bash
git add workers/src/handlers/kanban-d1.js scripts/grove-seed-recipes.mjs
git commit -m "feat(grove): recipe actions + seed script from the Shopify variant report"
```

---

### Task 5: Deploy step 1 and point the Flow at it

**Files:**
- Create: `docs/guides/grove-shopify-flow.md`

**Step 1: Apply the migration remotely, deploy**

Run: `cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0046-kanban-bins.sql && npx wrangler deploy`
Expected: deploy prints a new version id. `npx wrangler tail --format pretty` in another terminal for the next step.

**Step 2: Write the Flow guide (for Nathan or Koa to click through)**

```markdown
# Shopify Flow → Grove usage ledger

Flow: **Grove bag usage** · Trigger: *Order created* · Action: *Send HTTP request*
- Method: POST
- URL: https://rogue-origin-api.roguefamilyfarms.workers.dev/api/kanban?action=orderUsage
- Headers: `Content-Type: application/json` · `X-Webhook-Secret: <WEBHOOK_SECRET from 1Password>`
- Body:
{"order":"{{ order.name }}","at":"{{ order.createdAt }}","items":[{% for li in order.lineItems %}{"variant_id":"{{ li.variant.id }}","sku":"{{ li.sku }}","qty":{{ li.quantity }}}{% unless forloop.last %},{% endunless %}{% endfor %}]}

Turn it on. Leave the old "Grove Bags" decrement Flow running for two weeks; compare
`SELECT card_id, SUM(qty) FROM kanban_usage WHERE source='shopify' AND at >= date('now','-14 days') GROUP BY card_id`
against the Shopify counters' drop over the same period. When they match, turn the old Flow off and archive the product.
```

**Step 3: Prove it with one real order**

Place or wait for one order. In the tail, expect a POST to `orderUsage` returning 200. Then
`npx wrangler d1 execute rogue-origin-db --remote --command "SELECT * FROM kanban_usage ORDER BY id DESC LIMIT 5"` shows the rows with the order name.

**Step 4: Commit**

```bash
git add docs/guides/grove-shopify-flow.md
git commit -m "docs(grove): Shopify Flow setup for the usage ledger"
```

---

## Step 2 — lanes: status, Receive, red card, scan page

### Task 6: `getBinStatus`

**Files:**
- Modify: `workers/src/handlers/kanban-d1.js`
- Test: `tests/grove-bin-status.test.mjs` (pure helper only)

**Step 1: Pure helper + test** — the only logic worth unit-testing here is the season window and the 10 lb source switch. Put in `bin-math.js`:

```js
/** Last year's [today+lead, today+lead+safety] as ISO dates. */
export function seasonWindow(today, lead, safety) {
  const a = addDays(today, lead), b = addDays(today, lead + safety);
  const back = d => { const x = new Date(d); x.setUTCFullYear(x.getUTCFullYear() - 1); return iso(x); };
  return { from: back(a), to: back(b) };
}
```
Test:
```js
import { seasonWindow } from '../workers/src/lib/bin-math.js';
test('season window is last year, lead days ahead, safety days long', () => {
  assert.deepEqual(seasonWindow(new Date('2026-10-14T00:00:00Z'), 75, 30), { from: '2025-12-28', to: '2026-01-27' });
});
```
Run → FAIL → add → PASS.

**Step 2: The action**

```js
import { laneStatus, seasonWindow } from '../lib/bin-math.js';

async function laneRows(env, cardId) {
  const where = cardId ? 'WHERE c.card_id = ?' : '';
  return query(env.DB, `
    SELECT c.*, k.item, k.crumbtrail, k.supplier,
      (SELECT id FROM kanban_bin_cards b WHERE b.card_id = c.card_id AND b.kind='red' AND b.retired=0 ORDER BY id DESC LIMIT 1) AS redCardId,
      (SELECT token FROM kanban_bin_cards b WHERE b.card_id = c.card_id AND b.kind='red' AND b.retired=0 ORDER BY id DESC LIMIT 1) AS redToken
    FROM kanban_bin_config c JOIN kanban_cards k ON k.id = c.card_id ${where} ORDER BY k.item`, cardId ? [cardId] : []);
}

async function usageSum(env, cardId, fromIso, toIso = null) {
  if (cardId === 99) {   // 10 lb bags: production already logs every tagged bag
    const r = await queryOne(env.DB, `SELECT COUNT(*) AS n FROM inventory_adjustments
      WHERE size = '10lb' AND quantity_adjusted > 0 AND timestamp > ? ${toIso ? 'AND timestamp <= ?' : ''}`, toIso ? [fromIso, toIso] : [fromIso]);
    return Number(r?.n || 0);
  }
  const r = await queryOne(env.DB, `SELECT COALESCE(SUM(qty),0) AS n FROM kanban_usage
    WHERE card_id = ? AND source NOT LIKE '%unmapped' AND at > ? ${toIso ? 'AND at <= ?' : ''}`, toIso ? [cardId, fromIso, toIso] : [cardId, fromIso]);
  return Number(r?.n || 0);
}

async function computeLane(env, row, today = new Date()) {
  const cardId = row.card_id;
  const baseline = await queryOne(env.DB, 'SELECT bags, at, reason FROM kanban_baselines WHERE card_id = ? ORDER BY at DESC, id DESC LIMIT 1', [cardId]);
  const first = await queryOne(env.DB, cardId === 99
    ? `SELECT MIN(timestamp) AS t FROM inventory_adjustments WHERE size='10lb'`
    : `SELECT MIN(at) AS t FROM kanban_usage WHERE card_id = ? AND source = 'shopify'`, cardId === 99 ? [] : [cardId]);
  const usageDays = first?.t ? Math.floor((today - new Date(first.t)) / 86400000) : 0;
  const since56 = new Date(today.getTime() - 56 * 86400000).toISOString();
  const win = seasonWindow(today, row.lead_days, row.safety_days);
  const seasonRaw = await usageSum(env, cardId, win.from, win.to);
  const red = baseline ? await queryOne(env.DB, `SELECT id FROM kanban_bin_events WHERE card_id = ? AND kind='red' AND at > ? LIMIT 1`, [cardId, baseline.at]) : null;
  const openReq = await queryOne(env.DB, `SELECT id, requested_at AS requestedAt, notify_state AS notifyState FROM kanban_reorder_requests WHERE card_id = ? AND status='open'`, [cardId]);

  const s = laneStatus({
    per: row.bags_per_bin, lead: row.lead_days, safety: row.safety_days, moq: row.moq, seedPerMonth: row.seed_per_month,
    baseline: baseline ? { bags: baseline.bags, at: baseline.at } : { bags: 0, at: '1970-01-01' },
    usageSince: baseline ? await usageSum(env, cardId, baseline.at) : 0,
    usage56: await usageSum(env, cardId, since56), usageDays,
    seasonUsage: seasonRaw > 0 ? seasonRaw : null,
    redScanned: !!red, today,
  });
  return { cardId, item: row.item, crumbtrail: row.crumbtrail, colour: row.colour,
    config: { bagsPerBox: row.bags_per_box, bagsPerBin: row.bags_per_bin, leadDays: row.lead_days, safetyDays: row.safety_days, moq: row.moq, seedPerMonth: row.seed_per_month },
    baseline, redCard: row.redToken ? { id: row.redCardId, token: row.redToken } : null, openRequest: openReq || null, ...s };
}

/** GET ?action=getBinStatus[&cardId=] */
async function getBinStatus(request, env) {
  const { cardId } = getQueryParams(request);
  const rows = await laneRows(env, cardId ? Number(cardId) : null);
  const lanes = [];
  for (const r of rows) lanes.push(await computeLane(env, r));
  const unmapped = await query(env.DB, `SELECT variant_id, SUM(qty) AS qty, MAX(at) AS lastSeen FROM kanban_usage
    WHERE source='shopify:unmapped' AND at >= datetime('now','-30 days') GROUP BY variant_id ORDER BY qty DESC`);
  return successResponse({ success: true, lanes, unmapped });
}
```
Router: `getBinStatus: () => getBinStatus(request, env),`

**Step 3: Local check**

With `wrangler dev` running and the local migration applied: `curl -s "http://localhost:8787/api/kanban?action=getBinStatus" | jq '.lanes[] | {cardId, item, onHand, rate, rateSource, status, redTapeAtBins}'`
Expected: five lanes, `onHand 0`, `rateSource 'seed'`, status `order` (no baseline yet — correct).

**Step 4: Commit**

```bash
git add workers/src/lib/bin-math.js workers/src/handlers/kanban-d1.js tests/grove-bin-math.test.mjs
git commit -m "feat(grove): getBinStatus — lane status from baseline + ledger (+10 lb from production)"
```

---

### Task 7: `receiveBins`, `recount`, `setBinConfig`

**Files:**
- Modify: `workers/src/handlers/kanban-d1.js`

**Step 1: Implement**

```js
/** POST ?action=receiveBins {cardId, leftoverBins, boxes, bagsPerBox?, bagsPerBin?, lot?, by?} */
async function receiveBins(body, env) {
  const cardId = Number(body.cardId); if (!(cardId > 0)) throw createError('VALIDATION_ERROR', 'cardId required');
  const cfg = await queryOne(env.DB, 'SELECT * FROM kanban_bin_config WHERE card_id = ?', [cardId]);
  if (!cfg) throw createError('NOT_FOUND', 'no bin config for this card');
  const boxes = Number(body.boxes || 0), leftover = Number(body.leftoverBins || 0);
  const perBox = Number(body.bagsPerBox || cfg.bags_per_box), per = Number(body.bagsPerBin || cfg.bags_per_bin);
  if (!(boxes >= 0) || !(leftover >= 0) || !(perBox > 0) || !(per > 0)) throw createError('VALIDATION_ERROR', 'bad numbers');

  // Recount check happens against the estimate BEFORE the new baseline is written.
  const before = await computeLane(env, (await laneRows(env, cardId))[0]);
  const recount = Math.abs(leftover * per - before.onHand) > per;

  const bags = leftover * per + boxes * perBox;
  const at = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO kanban_bin_events (card_id, kind, bins, bag_count, lot, by, note, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(cardId, 'receive', Math.ceil(bags / per), per, body.lot || null, body.by || null, `leftover ${leftover} bins + ${boxes} boxes × ${perBox}`, at),
    env.DB.prepare('INSERT INTO kanban_baselines (card_id, bags, at, reason) VALUES (?, ?, ?, ?)').bind(cardId, bags, at, 'receive'),
    env.DB.prepare('UPDATE kanban_bin_config SET bags_per_box = ?, bags_per_bin = ?, updated_at = ? WHERE card_id = ?').bind(perBox, per, at, cardId),
    // A delivery closes any open request for this size.
    env.DB.prepare(`UPDATE kanban_reorder_requests SET status='ordered', closed_at=?, closed_by='receive' WHERE card_id = ? AND status='open'`).bind(at, cardId),
  ]);
  const lane = await computeLane(env, (await laneRows(env, cardId))[0]);
  return successResponse({ success: true, lane, recount, estimateBefore: before.onHand });
}

/** POST ?action=recount {cardId, sealedBins, by?} — physical count sets the baseline. */
async function recount(body, env) {
  const cardId = Number(body.cardId), sealed = Number(body.sealedBins);
  if (!(cardId > 0) || !(sealed >= 0)) throw createError('VALIDATION_ERROR', 'cardId and sealedBins required');
  const cfg = await queryOne(env.DB, 'SELECT bags_per_bin FROM kanban_bin_config WHERE card_id = ?', [cardId]);
  if (!cfg) throw createError('NOT_FOUND', 'no bin config for this card');
  const at = new Date().toISOString(), bags = sealed * cfg.bags_per_bin;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO kanban_bin_events (card_id, kind, bins, bag_count, by, at) VALUES (?, ?, ?, ?, ?, ?)').bind(cardId, 'recount', sealed, cfg.bags_per_bin, body.by || null, at),
    env.DB.prepare('INSERT INTO kanban_baselines (card_id, bags, at, reason) VALUES (?, ?, ?, ?)').bind(cardId, bags, at, 'recount'),
  ]);
  const lane = await computeLane(env, (await laneRows(env, cardId))[0]);
  return successResponse({ success: true, lane });
}

/** POST ?action=setBinConfig {cardId, bagsPerBox?, bagsPerBin?, leadDays?, safetyDays?, moq?, seedPerMonth?, colour?} */
async function setBinConfig(body, env) {
  const cardId = Number(body.cardId); if (!(cardId > 0)) throw createError('VALIDATION_ERROR', 'cardId required');
  const map = { bagsPerBox: 'bags_per_box', bagsPerBin: 'bags_per_bin', leadDays: 'lead_days', safetyDays: 'safety_days', moq: 'moq', seedPerMonth: 'seed_per_month', colour: 'colour' };
  const data = {};
  for (const [k, col] of Object.entries(map)) if (body[k] !== undefined) data[col] = col === 'colour' ? String(body[k]).slice(0, 20) : Number(body[k]);
  if (!Object.keys(data).length) throw createError('VALIDATION_ERROR', 'nothing to set');
  data.updated_at = new Date().toISOString();
  const exists = await queryOne(env.DB, 'SELECT card_id FROM kanban_bin_config WHERE card_id = ?', [cardId]);
  if (exists) await update(env.DB, 'kanban_bin_config', data, 'card_id = ?', [cardId]);
  else await insert(env.DB, 'kanban_bin_config', { card_id: cardId, seed_per_month: 0, ...data });
  const lane = await computeLane(env, (await laneRows(env, cardId))[0]);
  return successResponse({ success: true, lane });
}
```
Router: `receiveBins: () => receiveBins(body, env), recount: () => recount(body, env), setBinConfig: () => setBinConfig(body, env),`

**Step 2: Local check**

`curl -s -X POST "http://localhost:8787/api/kanban?action=recount" -H "content-type: application/json" -d '{"cardId":21,"sealedBins":40}' | jq '.lane | {onHand, status, redTapeAtBins, orderBy}'`
Expected: `onHand 2000`, `redTapeAtBins 42` (seed 600/mo → 19.7/day × 105 = 2072 → ceil(2072/50) = 42), status `order` (2000 ≤ 2072).
Then `receiveBins {"cardId":21,"leftoverBins":38,"boxes":25}` → `onHand 1900+2500 = 4400`, `recount: false` (38×50=1900 vs 2000, diff 100 > per 50 → actually **true**; that is the flag working. Use leftoverBins 39 → 1950, diff 50, not > 50 → false).

**Step 3: Commit**

```bash
git add workers/src/handlers/kanban-d1.js
git commit -m "feat(grove): receiveBins / recount / setBinConfig write baselines and events"
```

---

### Task 8: Red card — `makeLaneKit`, `scanCard`, and the `/k/<token>` page

**Files:**
- Create: `workers/src/handlers/bin-scan.js`
- Modify: `workers/src/handlers/kanban-d1.js`, `workers/src/index.js:31-32` (import) and the short-route block near `:221`
- Test: `tests/grove-scan-page.test.mjs`

**Step 1: Token + actions in `kanban-d1.js`**

```js
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
function newToken() { const a = crypto.getRandomValues(new Uint8Array(10)); return [...a].map(b => B32[b & 31]).join(''); }

/** POST ?action=makeLaneKit {cardId} — (re)creates the lane's red card; retires the old one. */
async function makeLaneKit(body, env) {
  const cardId = Number(body.cardId); if (!(cardId > 0)) throw createError('VALIDATION_ERROR', 'cardId required');
  const card = await queryOne(env.DB, 'SELECT id, item, supplier, crumbtrail FROM kanban_cards WHERE id = ?', [cardId]);
  if (!card) throw createError('NOT_FOUND', 'card not found');
  await execute(env.DB, `UPDATE kanban_bin_cards SET retired = 1 WHERE card_id = ? AND kind='red' AND retired = 0`, [cardId]);
  const token = newToken();
  const id = await insert(env.DB, 'kanban_bin_cards', { card_id: cardId, kind: 'red', token });
  const base = env.PUBLIC_API_BASE || 'https://rogue-origin-api.roguefamilyfarms.workers.dev';
  return successResponse({ success: true, redCard: { id, token, url: `${base}/k/${token}` }, card });
}

/** POST ?action=scanCard {token, by?} — the red card. Raises (or re-sends) the Damon request. */
async function scanCard(body, env, ctx) {
  const token = String(body.token || '').trim();
  const bc = await queryOne(env.DB, 'SELECT id, card_id, kind, retired FROM kanban_bin_cards WHERE token = ?', [token]);
  if (!bc) throw createError('NOT_FOUND', 'Card not recognised');
  if (bc.retired) throw createError('VALIDATION_ERROR', 'This card was replaced — use the new one');
  if (bc.kind !== 'red') throw createError('VALIDATION_ERROR', 'Per-bin cards are not in use yet');
  const card = await queryOne(env.DB, 'SELECT * FROM kanban_cards WHERE id = ?', [bc.card_id]);
  await insert(env.DB, 'kanban_bin_events', { card_id: bc.card_id, kind: 'red', bin_card: bc.id, by: body.by || null });
  const lane = await computeLane(env, (await laneRows(env, bc.card_id))[0]);
  const res = await raiseReorderRequest(card, env, ctx, lane);   // Task 9 adds the 4th arg
  const payload = await res.json();
  return successResponse({ success: true, lane, request: payload.request });
}
```
Router: `makeLaneKit: () => makeLaneKit(body, env), scanCard: () => scanCard(body, env, ctx),`

**Step 2: Pure page renderer + test**

`tests/grove-scan-page.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanPageHtml } from '../workers/src/handlers/bin-scan.js';

test('the page POSTs scanCard with the token and never mutates on GET', () => {
  const html = scanPageHtml('abc123defg', 'https://api.example.com');
  assert.match(html, /action=scanCard/);
  assert.match(html, /"abc123defg"/);
  assert.match(html, /method:\s*'POST'/);
});
test('token is HTML-escaped', () => {
  assert.doesNotMatch(scanPageHtml('<script>', 'https://x'), /<script>/);
});
```

`workers/src/handlers/bin-scan.js`:
```js
/**
 * GET /k/<token> — the red ORDER card target. Short path = low-version QR.
 * The page mutates via JS POST, not on GET (camera apps and link scanners prefetch).
 */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function scanPageHtml(token, base) {
  const t = esc(token);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Grove · pedir</title><style>
body{margin:0;font-family:system-ui,sans-serif;background:#111;color:#fff;display:grid;place-items:center;min-height:100vh;text-align:center}
.card{padding:28px 20px;max-width:420px}h1{font-size:44px;margin:0 0 8px}p{font-size:22px;margin:8px 0}.sub{opacity:.75;font-size:17px}
.ok{background:#b91c1c}.wait{background:#333}.err{background:#7f1d1d}
.sq{display:inline-block;width:18px;height:18px;margin:2px;border-radius:3px;background:#fff}.sq.r{background:#f87171}
</style></head><body class="wait"><div class="card" id="c"><h1>…</h1><p>Enviando / Sending</p></div>
<script>
(async()=>{const c=document.getElementById('c');try{
const r=await fetch(${JSON.stringify(base)}+'/api/kanban?action=scanCard',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:${JSON.stringify(token)}})});
const j=await r.json();if(!j.success)throw new Error(j.error||'error');
const L=j.lane,q=j.request||{};document.body.className='ok';
const sq=Array.from({length:Math.max(L.bins,0)},(_, i)=>'<span class="sq'+(i<L.redTapeAtBins?' r':'')+'"></span>').join('');
c.innerHTML='<h1>PEDIR</h1><p><b>'+L.item+'</b></p><p>'+(q.outcome==='created'?'Solicitud enviada a Damon ✓':'Ya está pedido · correo reenviado')+'</p><p class="sub">'+(q.outcome==='created'?'Request sent to Damon':'Already requested · email re-sent')+'</p><p class="sub">~'+L.bins+' contenedores · pedir antes del '+(L.orderBy||'—')+'</p><p>'+sq+'</p><p class="sub">Deja la tarjeta aquí hasta la próxima entrega.</p>';
}catch(e){document.body.className='err';c.innerHTML='<h1>✗</h1><p>'+(e.message||'Error')+'</p><p class="sub">Avisa a Koa / Tell Koa</p>';}})();
</script></body></html>`;
}

export async function handleBinScan(request, env) {
  const token = new URL(request.url).pathname.replace(/^\/k\//, '').trim();
  const base = env.PUBLIC_API_BASE || 'https://rogue-origin-api.roguefamilyfarms.workers.dev';
  return new Response(scanPageHtml(token, base), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
```
Run the test → FAIL → create → PASS.

**Step 3: Route it in `index.js`**

Add `import { handleBinScan } from './handlers/bin-scan.js';` next to the harvest imports, and in the short-route dispatcher add **before** the `/s/` block's `else if` chain a sibling branch at the same level as the harvest short routes:
```js
      } else if (path.startsWith('/k/')) {
        response = await handleBinScan(request, env);
```
(Place it as its own `else if` on the main `if (path.startsWith('/api/'))` chain, not inside the harvest branch.) Check CORS/headers are applied the same way the harvest pages get them (follow how `response` is post-processed below the chain).

**Step 4: Local check**

`curl -s http://localhost:8787/k/abc | head -3` → HTML. Then make a kit: `curl -s -X POST "http://localhost:8787/api/kanban?action=makeLaneKit" -d '{"cardId":21}' -H content-type:application/json` → token. Open `http://localhost:8787/k/<token>` in a browser → red page "PEDIR · Custom 1 oz…" and a `kanban_reorder_requests` row appears (email send will fail locally without Gmail creds; `notify_state='failed'` is expected locally).

**Step 5: Commit**

```bash
git add workers/src/handlers/bin-scan.js workers/src/handlers/kanban-d1.js workers/src/index.js tests/grove-scan-page.test.mjs
git commit -m "feat(grove): red ORDER card — makeLaneKit, scanCard, /k/<token> page"
```

---

### Task 9: Email leads with the order-by date; closing writes `kanban_orders`

**Files:**
- Modify: `workers/src/handlers/kanban-d1.js:472-610` (`raiseReorderRequest`, `buildReorderEmailBody`, `notifyReorderHandler`, `closeReorderRequest`)
- Test: `tests/reorder-email-body.test.mjs` (append)

**Step 1: Failing tests**

```js
const LANE = { onHand: 900, bins: 18, rate: 20, rateSource: 'ledger', orderBy: '2026-09-15', runOut: '2026-11-20', suggestedQty: 2500, config: { leadDays: 75, moq: 2500 } };

test('with lane status the first line is the order-by date', () => {
  const body = buildReorderEmailBody(CARD, URL, LANE);
  assert.match(body.split('\n')[0], /order by Sep 15/);
  assert.match(body, /Suggest: 2,500 \(MOQ\)/);
  assert.match(body, /On hand: 900 bags \(18 bins\)/);
  assert.match(body, /Using: ~140 \/ week/);
  assert.match(body, /Runs out: ~Nov 20/);
});
test('the two-argument form is unchanged', () => {
  assert.match(buildReorderEmailBody(CARD, URL), /was flagged for reorder/);
});
```
Run → FAIL.

**Step 2: Implement**

```js
const fmtMD = iso => iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—';
const n = x => Number(x).toLocaleString('en-US');

export function buildReorderEmailBody(card, confirmUrl, lane) {
  if (!lane) { /* existing body, unchanged */ }
  const perWeek = Math.round(lane.rate * 7);
  const isMoq = lane.config?.moq && lane.suggestedQty === lane.config.moq;
  const facts = [
    ['Suggest', `${n(lane.suggestedQty)}${isMoq ? ' (MOQ)' : ''} ≈ ${Math.round(lane.suggestedQty / Math.max(lane.rate, 0.01) / 30.4)} months of cover`],
    ['On hand', `${n(lane.onHand)} bags (${lane.bins} bins)`],
    ['Using', `~${n(perWeek)} / week (${lane.rateSource === 'season' ? 'last fall' : lane.rateSource})`],
    ['Runs out', `~${fmtMD(lane.runOut)} · lead ${lane.config?.leadDays ?? 75} days`],
    ['Location', card.crumbtrail], ['Supplier', card.supplier],
  ].filter(([, v]) => v && !/undefined/.test(v));
  return `${card.item} — order by ${fmtMD(lane.orderBy)}.\n\n` + facts.map(([k, v]) => `${k}: ${v}`).join('\n') +
    `\n\nOnce you've placed the order, mark it done here:\n${confirmUrl}\n\n— Rogue Origin supply kanban`;
}
```
Thread `lane` through: `raiseReorderRequest(card, env, ctx, lane = null)` → `notifyReorderHandler(env, card, id, closeToken, lane)` → `buildReorderEmailBody(card, confirmUrl, lane)`. Both call sites of `notifyReorderHandler` inside `raiseReorderRequest` pass `lane`. The existing cart-scan path (`addToCart` → Grove) should also compute the lane: in `addToCart`'s Grove branch, before calling `raiseReorderRequest`, do `const rows = await laneRows(env, card.id); const lane = rows[0] ? await computeLane(env, rows[0]) : null;`.

`closeReorderRequest`: after the `update`, add
```js
  const card = await queryOne(env.DB, 'SELECT k.id, k.item, k.supplier FROM kanban_reorder_requests r JOIN kanban_cards k ON k.id = r.card_id WHERE r.id = ?', [row.id]);
  const cfg = card ? await queryOne(env.DB, 'SELECT moq FROM kanban_bin_config WHERE card_id = ?', [card.id]) : null;
  if (card) await insert(env.DB, 'kanban_orders', { vendor: card.supplier || 'Grove', placed_by: body.closedBy ? String(body.closedBy).slice(0, 100) : 'email-link',
    items_json: JSON.stringify([{ cardId: card.id, item: card.item, qty: cfg?.moq || null }]) });
```

**Step 3: Run** `npm test` → all PASS (including the old two-argument tests).

**Step 4: Commit**

```bash
git add workers/src/handlers/kanban-d1.js tests/reorder-email-body.test.mjs
git commit -m "feat(grove): reorder email leads with the order-by date; closing logs a kanban_orders row"
```

---

### Task 10: The ledger trigger (the backstop fires on its own)

**Files:**
- Modify: `workers/src/handlers/kanban-d1.js` (`orderUsage`)

**Step 1: Implement**

```js
/** After usage is written: any touched Grove lane now at 'order' with no open request → raise it. Never throws. */
async function checkLedgerTriggers(cardIds, env, ctx) {
  for (const id of cardIds) {
    try {
      const rows = await laneRows(env, id); if (!rows[0]) continue;
      const lane = await computeLane(env, rows[0]);
      if (lane.status !== 'order' || lane.openRequest) continue;
      const card = await queryOne(env.DB, 'SELECT * FROM kanban_cards WHERE id = ?', [id]);
      await raiseReorderRequest(card, env, null, lane);   // null ctx → awaits the send
    } catch (e) { console.error('[grove][ledger-trigger]', id, e); }
  }
}
```
In `orderUsage`, replace the Task-3 comment with:
```js
  if (touched.length) { const job = checkLedgerTriggers(touched, env, ctx); if (ctx?.waitUntil) ctx.waitUntil(job); else await job; }
```

**Step 2: Local proof** — with card 21 at a recount of 42 bins (2100, just at the point) post an `orderUsage` for a mapped 1 oz variant with qty 1 → `kanban_reorder_requests` gets an open row for card 21. Post again → still one row (dedup via `raiseReorderRequest`).

**Step 3: Commit**

```bash
git add workers/src/handlers/kanban-d1.js
git commit -m "feat(grove): ledger crossing the reorder point raises the Damon request"
```

**Step 4: Deploy step 2** — `cd workers && npx wrangler deploy`; tail; `curl .../api/kanban?action=getBinStatus` against prod returns five lanes.

---

## Step 3 — the Desk Grove tab

### Task 11: API client + model helpers

**Files:**
- Modify: `src/js/tag-desk/api.js`, `src/js/tag-desk/model.js`, `src/js/tag-desk/labels.js`
- Test: `tests/tag-desk-model.test.mjs` (append)

**Step 1: api.js** (after the existing exports):
```js
export const getBinStatus = () => apiGet(EP, 'getBinStatus').then(r => ok(r));
export const receiveBins = b => apiPost(EP, 'receiveBins', b).then(ok);
export const recountBins = (cardId, sealedBins, by = 'desk') => apiPost(EP, 'recount', { cardId, sealedBins, by }).then(ok);
export const setBinConfig = b => apiPost(EP, 'setBinConfig', b).then(ok);
export const makeLaneKit = cardId => apiPost(EP, 'makeLaneKit', { cardId }).then(ok);
export const getRecipes = () => apiGet(EP, 'getRecipes').then(ok);
export const setRecipe = b => apiPost(EP, 'setRecipe', b).then(ok);
```
and add `bins: getBinStatus().catch(() => ({ lanes: [], unmapped: [] }))` to `loadAll` so a worker without the migration still loads the Desk.

**Step 2: Pure headline helper in `model.js` + failing tests**

```js
/** The one line a lane tile leads with. Pure. */
export function laneHeadline(lane, today, es = false) {
  const d = iso => iso ? fmtMD(iso, es) : '—';
  if (lane.status === 'order') {
    const late = lane.orderBy && lane.orderBy < today ? Math.round((new Date(today) - new Date(lane.orderBy)) / 86400000) : 0;
    return late > 0 ? (es ? `PEDIR YA · ${late} días tarde` : `ORDER NOW · ${late} days late`) : (es ? `PEDIR YA` : `ORDER NOW`);
  }
  if (lane.status === 'soon') return es ? `Pedir antes del ${d(lane.orderBy)}` : `Order by ${d(lane.orderBy)}`;
  return es ? `Bien hasta ${d(lane.runOut)}` : `OK until ${d(lane.runOut)}`;
}
```
(`fmtMD` already exists in model.js or render.js — import/move so model.js owns it; keep it pure.)
Tests:
```js
test('lane headline', () => {
  assert.equal(laneHeadline({ status: 'order', orderBy: '2026-09-15' }, '2026-10-14'), 'ORDER NOW · 29 days late');
  assert.equal(laneHeadline({ status: 'soon', orderBy: '2026-10-29' }, '2026-10-14'), 'Order by Oct 29');
  assert.equal(laneHeadline({ status: 'ok', runOut: '2027-02-10' }, '2026-10-14', true), 'Bien hasta 10 feb');
});
```
Run → FAIL → implement → PASS.

**Step 3: labels.js** — add keys: `receiveBins: ['Receive', 'Recibir']`, `recount: ['Recount', 'Recontar']`, `laneKit: ['Lane kit', 'Kit del carril']`, `settings: ['Settings', 'Ajustes']`, `redTape: ['Red tape at bin', 'Cinta roja en el bin']`, `noRecipe: ['Shopify items with no bag recipe', 'Productos de Shopify sin bolsa asignada']`.

**Step 4: Commit**
```bash
git add src/js/tag-desk/api.js src/js/tag-desk/model.js src/js/tag-desk/labels.js tests/tag-desk-model.test.mjs
git commit -m "feat(tag-desk): bin status API client + lane headline"
```

---

### Task 12: `renderGrove` — lane tiles, Receive, Recount, Settings, Lane kit print

**Files:**
- Modify: `src/js/tag-desk/render.js:394-397` (replace `renderGrove`), `:294-300` (replace `openReceive`), `src/js/tag-desk/store.js:29` (drop `groveOrdered`, `bins`), `src/js/tag-desk/main.js` (store `M.bins = loaded.bins`)
- Modify: `src/pages/tag-desk.html` (the `#recv` dialog gets Receive/Recount/Settings bodies; add a `#kit` print container)
- Test: `tests/tag-desk.spec.js` (add Grove cases to the in-memory API mock)

**Step 1: Playwright tests first** — extend the mock in `tests/tag-desk.spec.js` to answer `getBinStatus` with two lanes (one `order`, one `ok`), `receiveBins`, `recount`, `makeLaneKit`. Tests:
- Grove tab shows one tile per lane with the headline from `laneHeadline`, and the red-tape line `Red tape at bin 42`.
- Receive dialog: enter leftover 39 + boxes 25 → mock receives `{cardId, leftoverBins: 39, boxes: 25}` → toast shows the new red-tape depth.
- Lane kit opens a print window containing `PEDIR` and the `/k/` URL.
Run `npm run test:e2e -- tests/tag-desk.spec.js` → the new cases FAIL.

**Step 2: Implement `renderGrove`**

Shape (keep the existing `board`/`lanes`/`icard` CSS; one `.lane-tile` per lane):
```js
function renderGrove() {
  const es = ES(); const el = $('#view-grove'); const lanes = M.bins?.lanes || []; const unmapped = M.bins?.unmapped || [];
  const tile = L => {
    const sq = Array.from({ length: Math.max(L.bins, L.redTapeAtBins) }, (_, i) => `<i class="sq${i < L.bins ? ' on' : ''}${i < L.redTapeAtBins ? ' red' : ''}"></i>`).join('');
    const req = L.openRequest ? `<div class="req">${es ? 'Solicitado a Damon' : 'Requested from Damon'} · ${fmtMD(L.openRequest.requestedAt)}</div>` : '';
    return `<section class="lane-tile st-${L.status}" style="--lane:${laneColour(L.colour)}" data-lane="${L.cardId}">
      <header><span class="badge">${shortName(byId(L.cardId) || { item: L.item, vendor: 'Grove' })}</span><h3>${laneHeadline(L, M.today, es)}</h3></header>
      <div class="sqs">${sq}</div>
      <div class="meta">~${L.bins} ${es ? 'bins' : 'bins'} · ~${Math.round(L.rate * 7)}/${es ? 'sem' : 'wk'} (${L.rateSource}) · ${t('redTape')} <b>${L.redTapeAtBins}</b>${L.baseline ? ` · ${es ? 'último conteo' : 'last count'} ${fmtMD(L.baseline.at)}` : ''}</div>
      ${req}
      <div class="acts"><button data-rv="${L.cardId}">${t('receiveBins')}</button><button data-rc="${L.cardId}">${t('recount')}</button><button data-kit="${L.cardId}">${t('laneKit')}</button><button data-cfg="${L.cardId}" class="ghost">${t('settings')}</button></div>
    </section>`;
  };
  el.innerHTML = `<div class="board" style="margin-top:0"><div class="board-h"><h2>Grove</h2><span class="when">${es ? 'Plazo 75 días · mínimo 2,500 por tamaño · Damon pide por correo' : '75-day lead · minimum 2,500 per size · Damon orders by email'}</span></div>
    <div class="lane-grid">${lanes.map(tile).join('') || `<p class="muted">${es ? 'Sin configuración de bins todavía' : 'No bin config yet'}</p>`}</div></div>
    ${unmapped.length ? `<details class="tech" open><summary>${t('noRecipe')} (${unmapped.length})</summary><ul>${unmapped.map(u => `<li><code>${u.variant_id}</code> · ${u.qty} ${es ? 'vendidos' : 'sold'} · <button data-map="${u.variant_id}">${es ? 'Asignar' : 'Map'}</button></li>`).join('')}</ul></details>` : ''}`;
  $$('[data-rv]', el).forEach(b => b.onclick = () => openReceive(+b.dataset.rv));
  $$('[data-rc]', el).forEach(b => b.onclick = () => openRecount(+b.dataset.rc));
  $$('[data-kit]', el).forEach(b => b.onclick = () => printLaneKit(+b.dataset.kit));
  $$('[data-cfg]', el).forEach(b => b.onclick = () => openBinSettings(+b.dataset.cfg));
  $$('[data-map]', el).forEach(b => b.onclick = () => openMapRecipe(b.dataset.map));
}
```
`openReceive(id)`: two inputs — *Bins still sealed on the rack* and *Boxes arrived* — plus bags/box and bags/bin prefilled from the lane config and a lot field; live line `= N bins · red tape at bin X`; Save → `api.receiveBins(...)` → `M.bins = await api.getBinStatus()` → `render()` → toast `Red tape at bin X · move the red card` (and `Recount? The estimate said Y` when `needsRecount` is true).
`openRecount(id)`: one input, sealed bins → `api.recountBins`.
`openBinSettings(id)`: the six config numbers + colour → `api.setBinConfig`.
`openMapRecipe(variantId)`: pick a Grove card → `api.setRecipe({ variant_id, card_id, qty: 1 })`.
`printLaneKit(id)`: `api.makeLaneKit(id)` then `window.open('', '_blank')` with three pages (reuse the `printCards` print-doc CSS): header card (photo placeholder, size name huge, lane colour band, the two rules ES/EN), red ORDER card (red, `PEDIR · <size>`, QR via the same qrserver call as `printOneCard` encoding `redCard.url`, *ESCANEA ESTA TARJETA*, "Déjala aquí hasta la próxima entrega"), red-tape label (`Cinta roja en el bin N`).
`laneColour(token)`: map `orange/teal/violet/olive/slate` → the Desk's existing Grove badge colours (search render.js for the badge CSS vars) with a fallback.

`store.js`: delete `groveOrdered` and `bins` from the default slice and any reads (`Lslice`, `state()` in model.js checks `L.groveOrdered` — remove that branch; `on-order` for Grove now comes from `lane.openRequest`).

**Step 3: Styles** — in `src/css/tag-desk.css` (or wherever the Desk's CSS lives; find it via `tag-desk.html`'s `<link>`): `.lane-grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}` `.lane-tile{border:3px solid var(--lane);border-radius:16px;padding:16px}` `.lane-tile h3{font-size:26px;margin:4px 0}` `.sq{width:16px;height:16px;border-radius:3px;background:#ddd;display:inline-block;margin:2px}.sq.on{background:var(--lane)}.sq.red:not(.on){background:#fecaca}.sq.red.on{box-shadow:inset 0 0 0 2px #dc2626}` `.st-order{background:#fff1f1}.st-soon{background:#fffbea}`. Big and colour-coded is the brief (Koa: large visuals, distinct cards).

**Step 4: Run** `npm run test:e2e -- tests/tag-desk.spec.js` → PASS; `npm test` → PASS.

**Step 5: Look at it** — open `src/pages/tag-desk.html` via the Vite dev server (see `package.json` scripts) against the local worker, switch to Grove, screenshot in light + dark, phone width. Fix anything that reads as a dense table.

**Step 6: Commit**

```bash
git add src/js/tag-desk/render.js src/js/tag-desk/store.js src/js/tag-desk/main.js src/js/tag-desk/model.js src/pages/tag-desk.html src/css/tag-desk.css tests/tag-desk.spec.js
git commit -m "feat(tag-desk): Grove tab — lane tiles from getBinStatus, Receive/Recount/Settings, lane kit print"
```

---

## Step 4 — seasonal seed

### Task 13: Seed last year's usage from the Shopify report

**Files:**
- Create: `scripts/grove-seed-usage.mjs`

**Step 1: Script** — input: the *Sales by product variant SKU, by month* CSV (columns include `Month`, `Product variant ID`, `Net quantity` — check the header, the script prints it if a column is missing). For each row, look up the card via the same `cardFor` as Task 4 (export it from a tiny `scripts/lib/grove-card-for.mjs` and import in both scripts — DRY). Emit:
```
INSERT OR IGNORE INTO kanban_usage (card_id, qty, source, ref, variant_id, at) VALUES (21, 612, 'shopify:seed', '2025-11', '111', '2025-11-15T12:00:00Z');
```
one row per (month, variant), dated mid-month. `source='shopify:seed'` so `usageSum` counts it (it is not `%unmapped`) but `usageDays` (which looks at `source='shopify'`) ignores it — the seed must inform the seasonal window and must not make the trailing rate think it has live data.

**Step 2: Run, review, apply** — `node scripts/grove-seed-usage.mjs ~/Downloads/sales-by-variant-monthly.csv > /tmp/seed.sql`; eyeball totals per card per month against the design's seed table (1 oz ~600/mo, ~1,000 in Nov); apply with `wrangler d1 execute --remote --file`.

**Step 3: Check** — `getBinStatus` on prod: lanes whose season window overlaps a seeded month now show `rateSource: 'season'` when it is the larger.

**Step 4: Commit**
```bash
git add scripts/grove-seed-usage.mjs scripts/lib/grove-card-for.mjs scripts/grove-seed-recipes.mjs
git commit -m "feat(grove): seed last year's monthly usage for the seasonal reorder point"
```

---

## Step 5 — day one on the rack

### Task 14: Bootstrap runbook (no code)

**Files:**
- Create: `docs/guides/grove-rack-day-one.md`

Contents, as a checklist Koa walks through:
1. Nathan's items: Flow on (Task 5), recipes seeded (Task 4), monthly CSV seeded (Task 13).
2. Count sealed bins per size on the rack (do not count the open bin). Desk → Grove → each lane → **Recount** → enter bins.
3. For each lane: **Lane kit** → print 3 pages → laminate → header card on the lane, red ORDER card buried at bin N (the number on the tape label), red tape on the lane wall at that height. Lane colours: orange 1 oz · teal 1/4&1/2 oz · violet 1 lb · olive 1 lb blank · slate 10 lb.
4. Scan one red card with a phone → red PEDIR page → Damon gets the email → he taps "Mark as ordered" → the Desk shows the request closed. Then **Recount** that lane again so the test scan's request does not linger (or leave it if an order really is due).
5. Fill in each lane's **Settings**: bags per box from the packing slip, bin size as the crew splits it.
6. Two weeks later: compare ledger vs the Shopify counters (Task 5 SQL). If they match, Nathan turns off the old Flow and archives the "Grove Bags" product. Delete the old localStorage Grove memory key `ro-tagdesk-v1` → `bins/groveOrdered` is already ignored by the new code.
7. Wiki: log the go-live in `wiki/log.md` and close the todo item.

Commit: `git add docs/guides/grove-rack-day-one.md && git commit -m "docs(grove): day-one runbook"`.

---

### Task 15: PR

- Push `feat/grove-packs`, open a PR to `master` titled "Grove bins: usage ledger backstop, red ORDER cards, Desk Grove tab". Body: link the design doc, list the migration (0046, applied by hand), the Flow guide, the day-one runbook, and the two confirmations still open (bags per box for the custom sizes; open bin at rack vs bench). End the description with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- CI runs `npm test`. Playwright is not in CI; paste the local `test:e2e` summary into the PR.

---

## Phase 2 (not in this plan)
- `recordUsage(items, 'wholesale' | 'consignment', ref)` hooks in `wholesale-d1.js` / `consignment-d1.js`.
- More materials as recipe rows (labels, boxes, humidity packs) once Koa lists them.
- Per-bin cards (`kind='bin'`) only for a size whose Receive count keeps disagreeing with the ledger.
