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
