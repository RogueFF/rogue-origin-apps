-- Pool Inventory Management Schema
-- Version: 1.0
-- Created: 2026-02-05

-- Bin registry
CREATE TABLE IF NOT EXISTS bins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bin_number TEXT NOT NULL UNIQUE, -- e.g. "IH-01", "CN-T-01"
  cultivar TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('tops', 'smalls')),
  source TEXT NOT NULL CHECK(source IN ('in-house', 'consignment')),
  capacity_lbs REAL DEFAULT 12.5,
  active INTEGER DEFAULT 1, -- 0 = retired/archived
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Pool transactions (intakes + dispenses)
CREATE TABLE IF NOT EXISTS pool_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bin_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('intake', 'dispense', 'adjustment', 'waste')),
  weight_lbs REAL NOT NULL,
  source_ref TEXT, -- consignment_intake_id, production_batch_id, order_id, etc
  package_size TEXT, -- '1oz', '1/4lb', '1/2lb', '1lb' (for dispenses)
  package_count INTEGER, -- how many packages made (for dispenses)
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (bin_id) REFERENCES bins(id) ON DELETE CASCADE
);

-- Bin balances (materialized for performance)
CREATE TABLE IF NOT EXISTS bin_balances (
  bin_id INTEGER PRIMARY KEY,
  current_lbs REAL DEFAULT 0,
  total_intakes_lbs REAL DEFAULT 0,
  total_dispenses_lbs REAL DEFAULT 0,
  last_intake_at TEXT,
  last_dispense_at TEXT,
  last_updated TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (bin_id) REFERENCES bins(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_bins_source ON bins(source);
CREATE INDEX IF NOT EXISTS idx_bins_cultivar ON bins(cultivar);
CREATE INDEX IF NOT EXISTS idx_bins_active ON bins(active);
CREATE INDEX IF NOT EXISTS idx_pool_transactions_bin_id ON pool_transactions(bin_id);
CREATE INDEX IF NOT EXISTS idx_pool_transactions_type ON pool_transactions(type);
CREATE INDEX IF NOT EXISTS idx_pool_transactions_created_at ON pool_transactions(created_at);

-- Seed 32 bins based on yesterday's analysis
-- In-house smalls bins (16)
INSERT OR IGNORE INTO bins (bin_number, cultivar, type, source) VALUES
  ('IH-S-01', 'Lifter', 'smalls', 'in-house'),
  ('IH-S-02', 'Godfather OG', 'smalls', 'in-house'),
  ('IH-S-03', 'Cherry Diesel', 'smalls', 'in-house'),
  ('IH-S-04', 'Cherry Frosting', 'smalls', 'in-house'),
  ('IH-S-05', 'Frosted Lime', 'smalls', 'in-house'),
  ('IH-S-06', 'Frosted Fruit', 'smalls', 'in-house'),
  ('IH-S-07', 'Pink Panther', 'smalls', 'in-house'),
  ('IH-S-08', 'Sweet Diesel', 'smalls', 'in-house'),
  ('IH-S-09', 'Strawberry Lifter', 'smalls', 'in-house'),
  ('IH-S-10', 'Cherry Punch', 'smalls', 'in-house'),
  ('IH-S-11', 'Cherry Chocolate Chip', 'smalls', 'in-house'),
  ('IH-S-12', 'Blueberry Muffin', 'smalls', 'in-house'),
  ('IH-S-13', 'Banana OG', 'smalls', 'in-house'),
  ('IH-S-14', 'Kush Mints', 'smalls', 'in-house'),
  ('IH-S-15', 'Tropical Burst', 'smalls', 'in-house'),
  ('IH-S-16', 'Strawberry Soda', 'smalls', 'in-house');

-- Consignment tops bins (8)
INSERT OR IGNORE INTO bins (bin_number, cultivar, type, source) VALUES
  ('CN-T-01', 'Critical Berries', 'tops', 'consignment'),
  ('CN-T-02', 'Super Sour Space Candy', 'tops', 'consignment'),
  ('CN-T-03', 'Sour Brûlée', 'tops', 'consignment'),
  ('CN-T-04', 'Sour Special Sauce', 'tops', 'consignment'),
  ('CN-T-05', 'Sour Lifter', 'tops', 'consignment'),
  ('CN-T-06', 'Royal OG', 'tops', 'consignment'),
  ('CN-T-07', 'Sour Space Candy', 'tops', 'consignment'),
  ('CN-T-08', 'Lemon Octane', 'tops', 'consignment');

-- Consignment smalls bins (8)
INSERT OR IGNORE INTO bins (bin_number, cultivar, type, source) VALUES
  ('CN-S-01', 'Critical Berries', 'smalls', 'consignment'),
  ('CN-S-02', 'Royal OG', 'smalls', 'consignment'),
  ('CN-S-03', 'Lemon Octane', 'smalls', 'consignment'),
  ('CN-S-04', 'Sour Lifter', 'smalls', 'consignment'),
  ('CN-S-05', 'Sour Space Candy', 'smalls', 'consignment'),
  ('CN-S-06', 'Bubba Kush', 'smalls', 'consignment'),
  ('CN-S-07', 'Sour Brûlée', 'smalls', 'consignment'),
  ('CN-S-08', 'Bubba Kush 66', 'smalls', 'consignment');

-- Initialize bin balances for all bins
INSERT OR IGNORE INTO bin_balances (bin_id, current_lbs, total_intakes_lbs, total_dispenses_lbs)
SELECT id, 0, 0, 0 FROM bins;
