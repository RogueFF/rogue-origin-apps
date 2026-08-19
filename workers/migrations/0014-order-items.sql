-- Real line items for wholesale orders, plus the production-run queue that
-- schedules them.
-- Design: docs/plans/2026-08-19-order-blocks-design.md
--
-- WHY order_items exists:
-- `orders` can only say "one strain, N kg" (orders.strain + orders.commitment_kg).
-- Multi-cultivar orders were therefore recorded in prose — the single live
-- order, MO-2026-001, carries its real structure in a notes field:
--   "Main wholesale order - 140kg pallets + extras. Total 1,850kg."
-- Line items did exist, but hung off a SHIPMENT and were JSON.stringify'd into
-- shipments.notes (destroying whatever note was there). Not queryable, not
-- joinable, not indexable — so "how many lbs of Sour Lifter are on order" was
-- not a question this database could answer. That is what this table fixes.
--
-- WHY production_runs has no `form` column:
-- The floor does not trim an order, and it does not trim a form. 45 days of
-- monthly_production (2026-07-06..2026-08-19, 35 production days) show
-- tops_lbs1 and smalls_lbs1 recorded against the SAME cultivar1 and the SAME
-- trimmers_line1 — both forms come off one pass on one lot. Measured 1.67 lb
-- per trimmer-hour combined at 53.9% tops, with per-cultivar rates spanning
-- 1.25-2.34 and tops share spanning 45%-61%.
-- So a run is per CULTIVAR, and its lot size is set by whichever form binds:
--   lot_lbs = max(tops_needed / tops_frac, smalls_needed / (1 - tops_frac))
-- The surplus of the non-binding form is real future inventory, not waste.
--
-- Demand stays per (cultivar, form) — that is what a customer buys — even
-- though production is not. Hence `form` on order_items but not on runs.
--
-- Rollback is a plain DROP of both tables; nothing outside them is touched.

CREATE TABLE IF NOT EXISTS order_items (
  id               TEXT PRIMARY KEY,           -- 'OI-<13-digit ms>'
  order_id         TEXT NOT NULL,
  cultivar         TEXT NOT NULL,              -- from products, not free text
  form             TEXT NOT NULL CHECK (form IN ('tops','smalls')),

  -- qty_lbs is canonical and is what every sum, rate and schedule reads.
  -- entered_qty/entered_unit preserve what the human actually typed, so a kg
  -- order redisplays in kg forever instead of drifting through repeated
  -- round-trip conversion. Existing schema is kg (orders.commitment_kg,
  -- shipments.quantity_kg) while production/harvest/supersacks are all lbs,
  -- and the tree already carries two different constants (2.205 and 2.20462).
  -- One canonical unit, one constant, original entry retained.
  qty_lbs          REAL NOT NULL,
  entered_qty      REAL,
  entered_unit     TEXT CHECK (entered_unit IN ('lb','kg')),

  unit_price       REAL DEFAULT 0,             -- per entered_unit, not per lb
  sku              TEXT,                       -- products.sku when known

  -- Reserved so a future Shopify order sync is idempotent without a second
  -- migration; orders.shopify_order_id / shopify_order_name already exist for
  -- the header. Nothing writes this yet.
  external_line_id TEXT,

  sort_order       INTEGER NOT NULL DEFAULT 0, -- display order within an order
  notes            TEXT,
  created_at       TEXT DEFAULT (datetime('now')),
  updated_at       TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order    ON order_items(order_id);

-- The over-commit warning and the run-pooling query both aggregate on
-- (cultivar, form) across every open order; this is the index they need.
CREATE INDEX IF NOT EXISTS idx_order_items_cultivar ON order_items(cultivar, form);

-- Makes a double-sync of the same Shopify line fail loudly rather than
-- silently duplicating demand. NULLs do not collide in SQLite, so the 100% of
-- rows that are hand-entered are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_items_external
  ON order_items(external_line_id) WHERE external_line_id IS NOT NULL;


CREATE TABLE IF NOT EXISTS production_runs (
  id                 TEXT PRIMARY KEY,         -- 'PR-<13-digit ms>'
  cultivar           TEXT NOT NULL,            -- no form: a run yields both

  -- Fractional index ('a0', 'a1', 'a0V'), NOT an integer. The existing
  -- orders.priority INTEGER cannot express "between these two" without
  -- renumbering every row, which is exactly what drag-to-rank does constantly.
  rank               TEXT NOT NULL,

  -- NULL = pooled: this run serves every open order needing the cultivar.
  -- Set = the "pull forward" override, where one order's demand is split out
  -- into its own run and ranked independently. Trimming is usually sequenced
  -- by cultivar lot, but a big order sometimes gets pulled forward as a unit.
  dedicated_order_id TEXT,

  status             TEXT NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued','running','done')),
  created_at         TEXT DEFAULT (datetime('now')),
  updated_at         TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (dedicated_order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_production_runs_rank      ON production_runs(rank);
CREATE INDEX IF NOT EXISTS idx_production_runs_cultivar  ON production_runs(cultivar);

-- At most one POOLED run per cultivar. A second one would silently split the
-- same demand across two schedule positions and double-count the lot.
-- Dedicated runs (dedicated_order_id NOT NULL) are deliberately exempt.
CREATE UNIQUE INDEX IF NOT EXISTS idx_production_runs_pooled
  ON production_runs(cultivar) WHERE dedicated_order_id IS NULL;
