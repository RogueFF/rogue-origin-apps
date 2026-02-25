-- Pool Inventory Management — Supersack Tracker
-- Migration 0005: bins, pool_transactions, bin_balances

-- Bin registry
CREATE TABLE IF NOT EXISTS bins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bin_number TEXT NOT NULL UNIQUE,
  cultivar TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('tops', 'smalls')),
  source TEXT NOT NULL CHECK(source IN ('in-house', 'consignment')),
  capacity_lbs REAL DEFAULT 12.5,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'empty')),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Pool transactions (intakes + dispenses)
CREATE TABLE IF NOT EXISTS pool_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bin_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('intake', 'dispense', 'adjustment', 'waste')),
  weight_lbs REAL NOT NULL,
  package_size TEXT,
  package_count INTEGER,
  source_ref TEXT,
  notes TEXT,
  created_by TEXT DEFAULT 'system',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (bin_id) REFERENCES bins(id) ON DELETE CASCADE
);

-- Bin balances (materialized)
CREATE TABLE IF NOT EXISTS bin_balances (
  bin_id INTEGER PRIMARY KEY,
  current_lbs REAL DEFAULT 0,
  last_intake_at TEXT,
  last_dispense_at TEXT,
  last_updated TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (bin_id) REFERENCES bins(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bins_source ON bins(source);
CREATE INDEX IF NOT EXISTS idx_bins_type ON bins(type);
CREATE INDEX IF NOT EXISTS idx_bins_cultivar ON bins(cultivar);
CREATE INDEX IF NOT EXISTS idx_pool_tx_bin ON pool_transactions(bin_id);
CREATE INDEX IF NOT EXISTS idx_pool_tx_type ON pool_transactions(type);
CREATE INDEX IF NOT EXISTS idx_pool_tx_date ON pool_transactions(created_at);
