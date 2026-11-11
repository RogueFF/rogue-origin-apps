-- Order flow, slice 2: automatic assignment of Shopify orders to cells, with
-- NOW / NEXT per cell (design doc §2e; Koa 2026-11-11: "automatic order
-- assignment, 1 click printing, order queue, and flow").
--
-- A cell job is one basket of one cultivar for one order (lib/order-assign.js
-- splits a line into baskets of at most one 1 lb fill). A cell's NOW is its
-- first queued job by seq, NEXT the second. A cell holds at most two orders.
--
-- Run ONCE: the ALTER TABLE lines are not idempotent in SQLite. Needs 0058 and
-- 0060 (0060-pickup-spot adds scale_marks.job_id and collected_at: the pickup
-- mark is the one store for "waiting at the pickup spot").
-- Apply by hand:
--   cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0061-order-assign.sql

CREATE TABLE IF NOT EXISTS cell_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL REFERENCES shop_orders (id),
  line_id       INTEGER REFERENCES shop_order_lines (id),
  station_id    TEXT NOT NULL,
  seq           INTEGER NOT NULL,                 -- work order at the cell (rising)
  cultivar      TEXT NOT NULL,                    -- the floor's spelling: "2026 - Sour Lifter / Sungrown"
  bag           TEXT NOT NULL,                    -- qOz hOz oz1 qLb hLb lb1 (the cell screen's keys)
  bags          INTEGER NOT NULL,                 -- bags this basket fills
  target_g      REAL NOT NULL,                    -- bags x fill standard
  basket_no     INTEGER NOT NULL DEFAULT 1,       -- "basket 1 of 2" within its line
  baskets       INTEGER NOT NULL DEFAULT 1,
  state         TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'done', 'cancelled')),
  assigned_by   TEXT NOT NULL DEFAULT 'auto',     -- auto | moved (bag/tag moved it)
  why           TEXT,                             -- why this cell (same cultivar, frees up soonest...)
  assigned_at   TEXT NOT NULL DEFAULT (datetime('now')),
  started_at    TEXT,                             -- the cell screen started trimming it
  done_at       TEXT,                             -- basket lifted to the pickup spot (or tapped done)
  done_by       TEXT,                             -- scale | tap
  net_g         REAL,                             -- what the basket held at the pickup
  cycle_s       INTEGER,
  collected_at  TEXT                              -- bag/tag took it from the pickup spot
);
CREATE INDEX IF NOT EXISTS idx_cell_jobs_station ON cell_jobs (station_id, state, seq);
CREATE INDEX IF NOT EXISTS idx_cell_jobs_order ON cell_jobs (order_id);

-- Which cells take orders (Koa 2026-11-10/11: table1 and the retail cells 12-14 now).
ALTER TABLE cell_roster ADD COLUMN takes_orders INTEGER NOT NULL DEFAULT 0;
UPDATE cell_roster SET takes_orders = 1 WHERE station_id IN ('table1', 'table12', 'table13', 'table14');

-- Bag/tag's one click (confirm; slice 4 adds the printing to it), and the pickup spot.
ALTER TABLE shop_orders ADD COLUMN confirmed_at TEXT;
ALTER TABLE shop_orders ADD COLUMN assigned_at TEXT;
ALTER TABLE shop_orders ADD COLUMN ready_at TEXT;       -- every basket at its cell's pickup spot
ALTER TABLE shop_orders ADD COLUMN collected_at TEXT;   -- bag/tag took them: on to check-weigh
ALTER TABLE shop_order_lines ADD COLUMN route_set_by TEXT;   -- NULL = the route module; 'bagtag' = picked by hand
