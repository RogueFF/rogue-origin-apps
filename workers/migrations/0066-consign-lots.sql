-- Consignment lot ledger (stage 1). Sits beside the old consignment_* tables.

CREATE TABLE IF NOT EXISTS cl_farms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  contact TEXT,
  default_term TEXT NOT NULL DEFAULT 'dropoff' CHECK (default_term IN ('dropoff', 'sold')),
  lang TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'es')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cl_price_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES cl_farms(id),
  cultivar TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('tops', 'smalls')),
  price_per_lb REAL NOT NULL CHECK (price_per_lb > 0),
  effective_from TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cl_price_lookup ON cl_price_points (farm_id, cultivar, type, effective_from);

CREATE TABLE IF NOT EXISTS cl_dropoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES cl_farms(id),
  dropped_at TEXT NOT NULL DEFAULT (datetime('now')),
  dropped_by TEXT,
  note TEXT,
  source TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'paper', 'telegram')),
  client_key TEXT UNIQUE,
  voided_at TEXT,
  void_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_cl_dropoffs_farm ON cl_dropoffs (farm_id, dropped_at);

CREATE TABLE IF NOT EXISTS cl_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dropoff_id INTEGER NOT NULL REFERENCES cl_dropoffs(id),
  farm_id INTEGER NOT NULL REFERENCES cl_farms(id),
  cultivar TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('tops', 'smalls')),
  term TEXT NOT NULL CHECK (term IN ('dropoff', 'sold')),
  intake_lbs REAL CHECK (intake_lbs IS NULL OR intake_lbs > 0),
  weighed_at TEXT,
  price_per_lb REAL,
  smalls_price_per_lb REAL,
  closed_at TEXT,
  note TEXT,
  note_visible INTEGER NOT NULL DEFAULT 0,
  voided_at TEXT,
  void_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_cl_lots_farm ON cl_lots (farm_id);
CREATE INDEX IF NOT EXISTS idx_cl_lots_dropoff ON cl_lots (dropoff_id);

CREATE TABLE IF NOT EXISTS cl_screen_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id INTEGER NOT NULL REFERENCES cl_lots(id),
  run_at TEXT NOT NULL DEFAULT (datetime('now')),
  pulled_lbs REAL NOT NULL CHECK (pulled_lbs > 0),
  final_lbs REAL NOT NULL DEFAULT 0 CHECK (final_lbs >= 0),
  to_smalls_lbs REAL NOT NULL DEFAULT 0 CHECK (to_smalls_lbs >= 0),
  biomass_lbs REAL NOT NULL DEFAULT 0 CHECK (biomass_lbs >= 0),
  mold_lbs REAL NOT NULL DEFAULT 0 CHECK (mold_lbs >= 0),
  diff_lbs REAL NOT NULL DEFAULT 0,
  note TEXT,
  client_key TEXT UNIQUE,
  voided_at TEXT,
  void_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_cl_runs_lot ON cl_screen_runs (lot_id);

CREATE TABLE IF NOT EXISTS cl_sold (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id INTEGER NOT NULL REFERENCES cl_lots(id),
  sold_on TEXT NOT NULL,
  lbs REAL NOT NULL CHECK (lbs > 0),
  kind TEXT NOT NULL DEFAULT 'main' CHECK (kind IN ('main', 'smalls')),
  note TEXT,
  client_key TEXT UNIQUE,
  voided_at TEXT,
  void_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_cl_sold_lot ON cl_sold (lot_id);

CREATE TABLE IF NOT EXISTS cl_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES cl_farms(id),
  paid_on TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  method TEXT,
  reference TEXT,
  note TEXT,
  client_key TEXT UNIQUE,
  voided_at TEXT,
  void_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_cl_payments_farm ON cl_payments (farm_id);

CREATE TABLE IF NOT EXISTS cl_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tbl TEXT NOT NULL,
  row_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  actor TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cl_history_row ON cl_history (tbl, row_id);
