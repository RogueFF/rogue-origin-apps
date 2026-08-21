-- Order blocks: a block is an order, the queue burns down, and status is
-- the three words the floor actually says.
-- Design: docs/plans/2026-08-20-order-blocks-restructure.md §6
--
-- THREE CHANGES, ONE MIGRATION. `orders` has to be rebuilt to swap its status
-- CHECK constraint, and rebuilding it twice would be two windows of risk for
-- no gain, so the two new columns ride along.
--
--   1. STATUS VOCABULARY. 0018 locked in five words it had guessed at. Asked
--      directly, the operator's answer was three: "In queue, In production,
--      Finished".
--        draft   -> in_queue   Never created by anything. The board was built
--                              around "an order is entered once it is ready to
--                              queue", so the drafting stage was already gone
--                              from the UI; this removes it from the database.
--        open    -> in_queue   Same state, the name the floor says.
--        shipped -> finished   A distinction nothing downstream branched on:
--        closed  -> finished   both are off-queue, and the off-queue list is
--                              defined as the complement of the queue.
--
--   2. queue_rank. Ranking moved from cultivars to ORDERS. Stamped at insert
--      with the save timestamp so "insertion order" is the real default —
--      ORDER BY on a column that is NULL for every row is arbitrary order, not
--      insertion order.
--
--   3. accrual_start. Pacific wall-clock 'YYYY-MM-DD HH:MM'. The moment from
--      which an order collects recorded production. Wall-clock, not an instant,
--      because hourly entries are Pacific by construction and comparing the two
--      should not require a timezone conversion that a DST change gets wrong.
--
-- production_runs IS DROPPED. Its jobs were the pooled cultivar rank (now
-- queue_rank) and dedicated_order_id, which was the never-built "pull-forward
-- override" of the prior design's decision 5. Under order blocks every pass
-- belongs to exactly one order by construction, so that feature is not built —
-- it is subsumed.
--
-- THE FK TRAP, HIT ONCE ALREADY.
-- D1 runs with foreign_keys=1 and rolled back a first attempt at this rebuild:
-- "FOREIGN KEY constraint failed". DROP TABLE orders orphans
-- order_items.order_id, and PRAGMA defer_foreign_keys does NOT survive
-- wrangler's statement batching — the pragma applies to a transaction that has
-- already ended by the time the DROP runs. So the children are parked in a temp
-- table and emptied first, leaving nothing pointing at orders when it goes.
-- Order matters throughout and every step is inside one file so a failure rolls
-- the whole thing back.
--
-- Data at time of writing: 2 test orders, 3 items, 3 runs. Backed up to
-- ~/Desktop/rogue-scrub-backup/status-vocab-2026-08-20/.

-- 1. Park the children. CREATE TABLE AS copies columns in order, so the restore
--    below can SELECT * without naming them.
DROP TABLE IF EXISTS _park_order_items;
CREATE TABLE _park_order_items AS SELECT * FROM order_items;

-- 2. Empty them, so nothing references orders any more.
DELETE FROM order_items;

-- 3. production_runs also references orders, and is going away entirely.
DROP TABLE IF EXISTS production_runs;

-- 4. Park the orders themselves, then rebuild.
DROP TABLE IF EXISTS _park_orders;
CREATE TABLE _park_orders AS SELECT * FROM orders;
DROP TABLE orders;

CREATE TABLE orders (
  id                 TEXT PRIMARY KEY,          -- 'MO-2026-001'
  customer_id        TEXT NOT NULL,
  order_date         TEXT,
  status             TEXT NOT NULL DEFAULT 'in_queue'
                       CHECK (status IN ('in_queue','in_production','finished')),
  queue_rank         TEXT,                      -- block order; stamped at insert
  accrual_start      TEXT,                      -- PT 'YYYY-MM-DD HH:MM'
  payment_terms      TEXT,
  notes              TEXT,
  source             TEXT NOT NULL DEFAULT 'manual'
                       CHECK (source IN ('manual','shopify')),
  shopify_order_id   TEXT,                      -- reserved; nothing writes it yet
  shopify_order_name TEXT,
  created_at         TEXT DEFAULT (datetime('now')),
  updated_at         TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- 5. Restore the orders, mapping the retired vocabulary.
--    queue_rank falls back to created_at so existing rows keep insertion order.
--    accrual_start falls back to the order date at 00:00: for a row that predates
--    this column there is no better information, and starting earlier only risks
--    over-crediting an order that is already on the board, never losing work.
INSERT INTO orders (id, customer_id, order_date, status, queue_rank, accrual_start,
                    payment_terms, notes, source, shopify_order_id, shopify_order_name,
                    created_at, updated_at)
SELECT id, customer_id, order_date,
       CASE status
         WHEN 'draft'   THEN 'in_queue'
         WHEN 'open'    THEN 'in_queue'
         WHEN 'shipped' THEN 'finished'
         WHEN 'closed'  THEN 'finished'
         ELSE status
       END,
       COALESCE(created_at, order_date),
       COALESCE(order_date, '1970-01-01') || ' 00:00',
       payment_terms, notes, source, shopify_order_id, shopify_order_name,
       created_at, updated_at
FROM _park_orders;

-- 6. Restore the children now that their parent exists again.
INSERT INTO order_items SELECT * FROM _park_order_items;

DROP TABLE _park_orders;
DROP TABLE _park_order_items;

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_date     ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_orders_rank     ON orders(queue_rank);

-- Recreated with the table: a re-run of a future Shopify import must collide
-- rather than duplicate. NULLs do not collide in SQLite, so hand-entered orders
-- are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_shopify
  ON orders(shopify_order_id) WHERE shopify_order_id IS NOT NULL;

-- The burn-down scans monthly_production by date on every queue read.
CREATE INDEX IF NOT EXISTS idx_mp_date_cultivar
  ON monthly_production(production_date, cultivar1);
