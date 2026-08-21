-- Orders are tracked by their Shopify order number and a nickname. There are no
-- customers.
--
-- WHY: "We don't need to save customers in here or have customers at all. This
-- is just to track orders by order # and/or nicknames."
--
-- The board inherited a customer dimension from the retired wholesale app, and
-- it never earned its place here: two rows existed in it, one called "test" and
-- one the Shopify importer creates for itself. Every order had to be attached to
-- one before it could be saved, which is a required field standing between the
-- operator and a queue entry, guarding nothing.
--
-- WHAT REPLACES IT: `nickname`, free text on the order. Together with the
-- Shopify order number already on `shopify_order_name`, that is how an order is
-- identified — a number for the paperwork and a name for the floor.
--
-- SAFE TO DROP THE TABLE. `orders` is the only thing that ever referenced
-- `customers`: the sole `REFERENCES customers` in the schema and every
-- migration is the one removed below, and no handler outside wholesale reads
-- `orders.customer_id`. The table-reference guard in tests/ fails the build if
-- anything still queries it after this.
--
-- Same park-and-restore as 0019: D1 enforces foreign keys, `order_items` points
-- at `orders`, and `PRAGMA defer_foreign_keys` does not survive wrangler's
-- statement batching. Children are emptied before the parent is rebuilt.

DROP TABLE IF EXISTS _park_order_items;
CREATE TABLE _park_order_items AS SELECT * FROM order_items;
DELETE FROM order_items;

DROP TABLE IF EXISTS _park_orders;
CREATE TABLE _park_orders AS SELECT * FROM orders;
DROP TABLE orders;

CREATE TABLE orders (
  id                 TEXT PRIMARY KEY,          -- internal key; the operator never sees it
  nickname           TEXT,                      -- what the floor calls this order
  order_date         TEXT,
  status             TEXT NOT NULL DEFAULT 'in_queue'
                       CHECK (status IN ('in_queue','in_production','finished')),
  queue_rank         TEXT,
  accrual_start      TEXT,                      -- PT 'YYYY-MM-DD HH:MM'
  payment_terms      TEXT,
  notes              TEXT,
  source             TEXT NOT NULL DEFAULT 'manual'
                       CHECK (source IN ('manual','shopify')),
  shopify_order_id   TEXT,
  shopify_order_name TEXT,                      -- the number the operator uses
  created_at         TEXT DEFAULT (datetime('now')),
  updated_at         TEXT DEFAULT (datetime('now'))
);

-- The customer's name becomes the order's nickname where one was set, so no
-- order comes out of this unlabelled. 'test' and the importer's own placeholder
-- are not names anybody chose, so they are dropped rather than carried forward.
INSERT INTO orders (id, nickname, order_date, status, queue_rank, accrual_start,
                    payment_terms, notes, source, shopify_order_id,
                    shopify_order_name, created_at, updated_at)
SELECT o.id,
       NULLIF(NULLIF(COALESCE(NULLIF(c.company, ''), c.name, ''), 'test'), 'Shopify import'),
       o.order_date, o.status, o.queue_rank, o.accrual_start,
       o.payment_terms, o.notes, o.source, o.shopify_order_id,
       o.shopify_order_name, o.created_at, o.updated_at
FROM _park_orders o
LEFT JOIN customers c ON c.id = o.customer_id;

INSERT INTO order_items SELECT * FROM _park_order_items;

DROP TABLE _park_orders;
DROP TABLE _park_order_items;
DROP TABLE customers;

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_date   ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_orders_rank   ON orders(queue_rank);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_shopify
  ON orders(shopify_order_id) WHERE shopify_order_id IS NOT NULL;
