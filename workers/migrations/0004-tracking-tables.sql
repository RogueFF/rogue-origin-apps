-- Seed-to-Sale Tracking Tables
-- Phase 1: Germination through Planting/Establishment

-- Locations: physical places (greenhouse, fields, barns, etc.)
CREATE TABLE IF NOT EXISTS tracking_locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  capacity REAL,
  capacity_unit TEXT,
  drying_method TEXT,
  parent_id TEXT REFERENCES tracking_locations(id),
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tracking_locations_type ON tracking_locations(type);
CREATE INDEX IF NOT EXISTS idx_tracking_locations_parent ON tracking_locations(parent_id);

-- Lots: a batch of plants moving through the pipeline
CREATE TABLE IF NOT EXISTS tracking_lots (
  id TEXT PRIMARY KEY,
  cultivar TEXT NOT NULL,
  seed_source TEXT,
  seed_lot_number TEXT,
  quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  germ_method TEXT,
  current_stage TEXT NOT NULL DEFAULT 'germination',
  current_location_id TEXT REFERENCES tracking_locations(id),
  is_replant INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracking_lots_stage ON tracking_lots(current_stage);
CREATE INDEX IF NOT EXISTS idx_tracking_lots_cultivar ON tracking_lots(cultivar);

-- Lot lineage: tracks splits, merges, re-plants
CREATE TABLE IF NOT EXISTS tracking_lot_lineage (
  id TEXT PRIMARY KEY,
  parent_lot_id TEXT NOT NULL REFERENCES tracking_lots(id),
  child_lot_id TEXT NOT NULL REFERENCES tracking_lots(id),
  quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracking_lineage_parent ON tracking_lot_lineage(parent_lot_id);
CREATE INDEX IF NOT EXISTS idx_tracking_lineage_child ON tracking_lot_lineage(child_lot_id);

-- Stage transitions: lot moves from one stage to the next
CREATE TABLE IF NOT EXISTS tracking_stage_transitions (
  id TEXT PRIMARY KEY,
  lot_id TEXT NOT NULL REFERENCES tracking_lots(id),
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  quantity_in REAL,
  quantity_out REAL,
  unit TEXT,
  location_id TEXT REFERENCES tracking_locations(id),
  transitioned_at TEXT DEFAULT (datetime('now')),
  logged_by TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracking_transitions_lot ON tracking_stage_transitions(lot_id);
CREATE INDEX IF NOT EXISTS idx_tracking_transitions_stage ON tracking_stage_transitions(to_stage);

-- Observations: journal entries tied to a lot and/or location
CREATE TABLE IF NOT EXISTS tracking_observations (
  id TEXT PRIMARY KEY,
  lot_id TEXT REFERENCES tracking_lots(id),
  location_id TEXT REFERENCES tracking_locations(id),
  stage TEXT,
  observation_type TEXT NOT NULL,
  content TEXT,
  photo_urls TEXT,
  severity TEXT DEFAULT 'info',
  observed_at TEXT DEFAULT (datetime('now')),
  logged_by TEXT,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracking_observations_lot ON tracking_observations(lot_id);
CREATE INDEX IF NOT EXISTS idx_tracking_observations_location ON tracking_observations(location_id);
CREATE INDEX IF NOT EXISTS idx_tracking_observations_type ON tracking_observations(observation_type);
CREATE INDEX IF NOT EXISTS idx_tracking_observations_date ON tracking_observations(observed_at);

-- Environmental: greenhouse readings + auto-pulled weather
CREATE TABLE IF NOT EXISTS tracking_environmental (
  id TEXT PRIMARY KEY,
  location_id TEXT REFERENCES tracking_locations(id),
  source TEXT NOT NULL,
  temp_f REAL,
  humidity_pct REAL,
  precip_in REAL,
  wind_mph REAL,
  recorded_at TEXT DEFAULT (datetime('now')),
  logged_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracking_environmental_location ON tracking_environmental(location_id);
CREATE INDEX IF NOT EXISTS idx_tracking_environmental_date ON tracking_environmental(recorded_at);

-- Inputs: water, nutrients, amendments applied
CREATE TABLE IF NOT EXISTS tracking_inputs (
  id TEXT PRIMARY KEY,
  lot_id TEXT REFERENCES tracking_lots(id),
  location_id TEXT REFERENCES tracking_locations(id),
  stage TEXT,
  input_type TEXT NOT NULL,
  product_name TEXT,
  amount REAL,
  unit TEXT,
  applied_at TEXT DEFAULT (datetime('now')),
  logged_by TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracking_inputs_lot ON tracking_inputs(lot_id);
CREATE INDEX IF NOT EXISTS idx_tracking_inputs_date ON tracking_inputs(applied_at);

-- Planting passes: per-pass replacement counts during transplant
CREATE TABLE IF NOT EXISTS tracking_planting_passes (
  id TEXT PRIMARY KEY,
  lot_id TEXT NOT NULL REFERENCES tracking_lots(id),
  location_id TEXT NOT NULL REFERENCES tracking_locations(id),
  pass_number INTEGER NOT NULL,
  row_1_replacements INTEGER DEFAULT 0,
  row_2_replacements INTEGER DEFAULT 0,
  row_3_replacements INTEGER DEFAULT 0,
  reason TEXT,
  logged_by TEXT,
  logged_at TEXT DEFAULT (datetime('now')),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracking_planting_lot ON tracking_planting_passes(lot_id);

-- Re-plant events: per-row mortality counts
CREATE TABLE IF NOT EXISTS tracking_replants (
  id TEXT PRIMARY KEY,
  lot_id TEXT NOT NULL REFERENCES tracking_lots(id),
  location_id TEXT NOT NULL REFERENCES tracking_locations(id),
  row_data TEXT NOT NULL,
  trays_used REAL,
  source_lot_id TEXT REFERENCES tracking_lots(id),
  logged_by TEXT,
  logged_at TEXT DEFAULT (datetime('now')),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracking_replants_lot ON tracking_replants(lot_id);
