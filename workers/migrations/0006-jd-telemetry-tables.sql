-- Migration 0006: JD Operations Center telemetry tables
-- Companion to docs/plans/2026-05-13-field-ops-tracking-design.md (in wiki repo)

-- ------------------------------------------------------------------
-- Raw 5-min telemetry samples
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jd_position_breadcrumb (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,                  -- ISO8601 UTC
  machine_id TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  speed_kmh REAL,                    -- nullable; sandbox may not include
  heading_deg REAL,                  -- nullable
  raw_json TEXT                      -- full JD response for forensic debugging
);
CREATE INDEX IF NOT EXISTS idx_breadcrumb_machine_ts
  ON jd_position_breadcrumb(machine_id, ts);

CREATE TABLE IF NOT EXISTS jd_machine_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  engine_hours REAL,
  fuel_level_pct REAL,
  fuel_rate_lph REAL,                -- liters/hr (JD native); convert when reporting
  state TEXT,                        -- working | idle | transport | off | unknown
  raw_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_machine_states_machine_ts
  ON jd_machine_states(machine_id, ts);

-- ------------------------------------------------------------------
-- Equipment alerts (DTC fault codes)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jd_machine_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jd_alert_id TEXT UNIQUE,           -- JD's own alert ID — for de-dup on re-poll
  ts TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  spn INTEGER,
  fmi INTEGER,
  severity TEXT,                     -- low | medium | high | critical
  description TEXT,
  raw_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_machine_alerts_machine_ts
  ON jd_machine_alerts(machine_id, ts);

-- ------------------------------------------------------------------
-- Derived: completed zone-op records
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zone_op_actuals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id TEXT NOT NULL,
  op_name TEXT NOT NULL,             -- Rip | PH 1 | Nutes | PH 2 | 3-Row | Plant | Other
  machine_id TEXT,                   -- nullable for synthetic CASE rows
  start_ts TEXT NOT NULL,
  end_ts TEXT,                       -- NULL while in-progress
  duration_min REAL,
  fuel_gal REAL,
  area_acres_est REAL,
  planned_min REAL,
  variance_pct REAL,
  is_synthetic INTEGER DEFAULT 0,    -- 1 for inferred Nutes rows; 0 for measured
  plan_commit_hash TEXT,             -- which planner JSON commit was used at time of derivation
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_zone_op_actuals_zone
  ON zone_op_actuals(zone_id, start_ts);
CREATE INDEX IF NOT EXISTS idx_zone_op_actuals_machine
  ON zone_op_actuals(machine_id, start_ts);

CREATE TABLE IF NOT EXISTS zone_op_idle_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_op_actual_id INTEGER NOT NULL REFERENCES zone_op_actuals(id),
  ts_start TEXT NOT NULL,
  ts_end TEXT NOT NULL,
  duration_min REAL,
  subcategory TEXT,                  -- cleanout | break | fuel | unknown
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_idle_periods_actual
  ON zone_op_idle_periods(zone_op_actual_id);

-- ------------------------------------------------------------------
-- Alert dispatch dedup
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alerts_sent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule TEXT NOT NULL,                -- long_idle | dtc | low_fuel | engine_off_in_zone | zone_op_complete
  dedup_key TEXT NOT NULL,           -- composite per-rule (e.g. machine_id+rule for long_idle; jd_alert_id for dtc)
  last_sent_ts TEXT NOT NULL,
  metadata_json TEXT,
  UNIQUE(rule, dedup_key)
);
CREATE INDEX IF NOT EXISTS idx_alerts_sent_lookup
  ON alerts_sent(rule, dedup_key);

-- ------------------------------------------------------------------
-- Field boundaries cache (rare-refresh; populated by one-shot script)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS field_boundaries_cache (
  zone_id TEXT PRIMARY KEY,
  jd_field_id TEXT,
  jd_org_id TEXT,
  geojson_polygon TEXT NOT NULL,     -- full GeoJSON polygon (well-known format)
  acres REAL,
  refreshed_at TEXT NOT NULL
);
