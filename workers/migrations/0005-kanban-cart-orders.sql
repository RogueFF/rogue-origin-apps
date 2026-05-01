-- Kanban Supply Reorder Cart — Phase 2 schema
-- Adds the Friday cart and order history on top of the existing kanban_cards table.
-- See RogueFamilyFarms/docs/plans/2026-05-01-kanban-cart-design.md

-- Friday queue: one row per card currently waiting to be ordered.
-- UNIQUE(card_id) means re-queueing the same item bumps qty (UPSERT) instead of duplicating.
CREATE TABLE IF NOT EXISTS kanban_cart (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  added_at TEXT DEFAULT (datetime('now')),
  added_by TEXT,
  note TEXT,
  UNIQUE(card_id),
  FOREIGN KEY (card_id) REFERENCES kanban_cards(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kanban_cart_added_at ON kanban_cart(added_at);

-- Historical record: one row per placed order. items_json is a snapshot of the
-- vendor's cart contents at the moment Mark Ordered was clicked, so the order
-- record survives later card edits/deletions without dangling references.
CREATE TABLE IF NOT EXISTS kanban_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor TEXT NOT NULL,
  ordered_at TEXT DEFAULT (datetime('now')),
  placed_by TEXT,
  items_json TEXT NOT NULL  -- JSON: [{cardId, item, qty}]
);

CREATE INDEX IF NOT EXISTS idx_kanban_orders_vendor_date
  ON kanban_orders(vendor, ordered_at);
