-- Order flow, slice 1: Shopify orders in a FIFO queue for bag/tag (design doc
-- §2e, wiki operations/plans/2026-11-02-cell-software-design.md; Koa 2026-11-10:
-- "Approve, start slice 1").
--
-- The Worker polls Shopify (lib/shopify.js, lib/order-sync.js) and keeps one row
-- per open order and per line. NO buyer fields and NO prices are stored or even
-- asked for: order number, cultivar, form, bag size and counts only. The wholesale
-- Production Queue (orders / order_items) is a different thing and is untouched.
--
-- New tables only, IF NOT EXISTS: running this twice is harmless.
-- Apply by hand:
--   cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0058-order-queue.sql

CREATE TABLE IF NOT EXISTS shop_orders (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_gid         TEXT NOT NULL UNIQUE,             -- gid://shopify/Order/123: the dedup key
  name             TEXT NOT NULL,                    -- "#1234", display only
  placed_at        TEXT NOT NULL,                    -- UTC ISO, from Shopify createdAt
  intake_tag       TEXT,                             -- 'm2o' | 'wholesale' | NULL (in by the go-live date)
  rush             INTEGER NOT NULL DEFAULT 0,       -- 1 = expedited shipping (or set by hand, later)
  rush_why         TEXT,                             -- the shipping method title that made it rush
  state            TEXT NOT NULL DEFAULT 'queued'
                   CHECK (state IN ('queued', 'assigned', 'trimming', 'ready', 'checked', 'fulfilled', 'cancelled', 'hold')),
  shop_status      TEXT,                             -- Shopify displayFulfillmentStatus, as last seen
  fulfilled_at     TEXT,                             -- when the poll first saw it fulfilled in Shopify
  cancelled_at     TEXT,
  shop_changed_at  TEXT,                             -- lines changed in Shopify after it left 'queued' (slice 2+)
  first_seen_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at     TEXT NOT NULL DEFAULT (datetime('now'))   -- last poll that returned it open
);
CREATE INDEX IF NOT EXISTS idx_shop_orders_state ON shop_orders (state, rush, placed_at);

CREATE TABLE IF NOT EXISTS shop_order_lines (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id         INTEGER NOT NULL REFERENCES shop_orders (id),
  shop_line_gid    TEXT NOT NULL UNIQUE,             -- gid://shopify/LineItem/456
  title            TEXT,                             -- product title (no buyer data in it)
  variant_title    TEXT,
  cultivar         TEXT,                             -- "Sour Lifter" (Payton's = Peyton's)
  floor_cultivar   TEXT,                             -- "2026 - Sour Lifter / Sungrown" for cell lines: the floor's spelling
  form             TEXT,                             -- 'tops' | 'smalls' | 'trim' | NULL
  bag              TEXT,                             -- qOz hOz oz1 qLb hLb lb1 lb10 kg1 kg5 pallet | NULL
  qty              INTEGER NOT NULL DEFAULT 0,
  qty_open         INTEGER NOT NULL DEFAULT 0,       -- unfulfilled quantity, as last seen
  route            TEXT NOT NULL CHECK (route IN ('cell', 'bagging', 'pack', 'wholesale', 'ask')),
  route_why        TEXT,
  sort             INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_shop_order_lines_order ON shop_order_lines (order_id);

-- One row: how the last poll went, for the page's "Synced 2 min ago" and errors.
CREATE TABLE IF NOT EXISTS shop_sync (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  last_try_at      TEXT,
  last_ok_at       TEXT,
  last_error       TEXT,
  last_count       INTEGER
);
