-- Rebuild `orders` around line items, and give status a real vocabulary.
-- Design: docs/plans/2026-08-19-order-blocks-design.md
--
-- WHY NOW, AND WHY THIS IS SAFE:
-- The old wholesale data was exported and cleared at the operator's request
-- (69 rows -> ~/Desktop/rogue-scrub-backup/orders-reset-2026-08-19/). orders,
-- shipments, payments, payment_shipment_links, customers, order_items and
-- production_runs are all empty. Nothing in workers/src or src/js reads any
-- column of `orders` — the app that did was retired in 611da09e, and a grep for
-- `orders.` returns zero live hits. So this is a recreate with no data to
-- migrate and no reader to break. Once real orders exist, the same change costs
-- a backfill and a coordinated deploy; today it costs nothing.
--
-- STATUS GETS A CHECK CONSTRAINT.
-- Four vocabularies used to coexist: the DB only ever held 'pending', the UI
-- badge map said Open|Partial|Fulfilled|Paid|Closed, the scoreboard filtered on
-- completed|cancelled, and the optimistic client wrote 'Open'. Nothing ever
-- advanced the value, because the frontend never sent it. One vocabulary now,
-- enforced by the database:
--   draft         -- being built, not yet promised to the customer
--   open          -- committed; counts toward demand and the over-commit warning
--   in_production -- has at least one run on the floor
--   shipped       -- left the building
--   closed        -- done, or abandoned; hidden from the board by default
-- The over-commit query in the design (§6) aggregates status IN ('open',
-- 'in_production'), which is now a constraint-guaranteed set rather than a hope.
--
-- COLUMNS REMOVED, and what replaces each:
--   strain, type              -> order_items.cultivar_id + order_items.form.
--                                A single strain per order was the original
--                                defect this whole feature exists to fix.
--   commitment_kg,            -> SUM over order_items. Storing a total beside
--   commitment_price             the lines it is derived from invites drift,
--                                and the kg/lb split is handled per line.
--   fulfilled_kg,             -> Declared in the original schema and NEVER
--   fulfilled_value              written by anything. Fulfilment tracking is a
--                                real feature; it should be designed, not
--                                inherited as dead columns.
--   paid_amount, balance_due  -> Same: never written. The payments table is the
--                                record; a cached balance on the order would be
--                                a second source of truth.
--   ship_date,                -> Belong to a shipment, not an order. An order
--   tracking_number              with three shipments cannot hold one of each.
--   priority (INTEGER)        -> production_runs.rank, a fractional index.
--                                An integer cannot express "between these two"
--                                without renumbering every row, which is what
--                                drag-to-rank does constantly.
--
-- KEPT: shopify_order_id / shopify_order_name stay reserved for the sync that
-- is deliberately out of v1 scope, and now carry a partial unique index so a
-- double-import fails loudly instead of silently duplicating an order.

DROP TABLE IF EXISTS orders;

CREATE TABLE orders (
  id                 TEXT PRIMARY KEY,          -- 'MO-2026-001'
  customer_id        TEXT NOT NULL,
  order_date         TEXT,
  status             TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','open','in_production','shipped','closed')),
  payment_terms      TEXT,                      -- 'DAP', 'Net 30', ...
  notes              TEXT,
  source             TEXT NOT NULL DEFAULT 'manual'
                       CHECK (source IN ('manual','shopify')),
  shopify_order_id   TEXT,                      -- reserved; nothing writes it yet
  shopify_order_name TEXT,
  created_at         TEXT DEFAULT (datetime('now')),
  updated_at         TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_date     ON orders(order_date);

-- A re-run of a future Shopify import must collide rather than duplicate.
-- NULLs do not collide in SQLite, so hand-entered orders are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_shopify
  ON orders(shopify_order_id) WHERE shopify_order_id IS NOT NULL;
