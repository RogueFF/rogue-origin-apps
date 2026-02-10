-- Rogue Origin D1 Database Schema
-- Migration from Google Sheets

-- ============================================
-- BARCODE SYSTEM (Pilot)
-- ============================================

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  header TEXT NOT NULL,
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);

-- ============================================
-- KANBAN SYSTEM
-- ============================================

CREATE TABLE IF NOT EXISTS kanban_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item TEXT NOT NULL,
  supplier TEXT,
  order_qty TEXT,
  delivery_time TEXT,
  price TEXT,
  crumbtrail TEXT,
  url TEXT,
  picture TEXT,
  order_when TEXT,
  image_file TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kanban_supplier ON kanban_cards(supplier);

-- ============================================
-- SOP SYSTEM
-- ============================================

CREATE TABLE IF NOT EXISTS sops (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  title_es TEXT,
  dept TEXT,
  doc_num TEXT,
  revision TEXT DEFAULT '1',
  status TEXT DEFAULT 'draft',
  description TEXT,
  desc_es TEXT,
  tags TEXT,
  steps TEXT,
  linked_sops TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sops_dept ON sops(dept);
CREATE INDEX IF NOT EXISTS idx_sops_status ON sops(status);

CREATE TABLE IF NOT EXISTS sop_requests (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  dept TEXT,
  priority TEXT DEFAULT 'medium',
  assignee TEXT,
  due_date TEXT,
  notes TEXT,
  completed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_requests_completed ON sop_requests(completed);

CREATE TABLE IF NOT EXISTS sop_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- ============================================
-- ORDERS SYSTEM
-- ============================================

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  order_date TEXT,
  status TEXT DEFAULT 'pending',
  strain TEXT,
  type TEXT,
  commitment_kg REAL DEFAULT 0,
  commitment_price REAL DEFAULT 0,
  fulfilled_kg REAL DEFAULT 0,
  fulfilled_value REAL DEFAULT 0,
  paid_amount REAL DEFAULT 0,
  balance_due REAL DEFAULT 0,
  ship_date TEXT,
  tracking_number TEXT,
  notes TEXT,
  source TEXT,
  shopify_order_id TEXT,
  shopify_order_name TEXT,
  payment_terms TEXT,
  priority INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_strain ON orders(strain);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date);

CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  invoice_number TEXT,
  ship_date TEXT,
  strain TEXT,
  type TEXT,
  quantity_kg REAL DEFAULT 0,
  unit_price REAL DEFAULT 0,
  total_value REAL DEFAULT 0,
  tracking_number TEXT,
  carrier TEXT,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_date ON shipments(ship_date);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  payment_date TEXT,
  amount REAL NOT NULL,
  method TEXT,
  reference TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);

-- Payment-Shipment Links (many-to-many)
-- Allows tracking which shipments a payment covers
CREATE TABLE IF NOT EXISTS payment_shipment_links (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  shipment_id TEXT NOT NULL,
  amount REAL,  -- portion of payment applied to this shipment
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
  FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_psl_payment ON payment_shipment_links(payment_id);
CREATE INDEX IF NOT EXISTS idx_psl_shipment ON payment_shipment_links(shipment_id);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strain TEXT NOT NULL,
  type TEXT NOT NULL,
  price REAL NOT NULL,
  effective_date TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_price_strain ON price_history(strain, type);

CREATE TABLE IF NOT EXISTS coa_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strain TEXT NOT NULL,
  lab_name TEXT,
  test_date TEXT,
  thca REAL,
  cbd REAL,
  file_url TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_coa_strain ON coa_index(strain);

-- ============================================
-- PRODUCTION SYSTEM
-- ============================================

-- Legacy table (kept for compatibility)
CREATE TABLE IF NOT EXISTS production_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  bag_type TEXT,
  weight REAL,
  sku TEXT,
  source TEXT,
  cultivar TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracking_timestamp ON production_tracking(timestamp);
CREATE INDEX IF NOT EXISTS idx_tracking_cultivar ON production_tracking(cultivar);

-- New table for Shopify inventory webhooks (full data)
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  sku TEXT,
  product_name TEXT,
  variant_title TEXT,
  strain_name TEXT,
  size TEXT,
  quantity_adjusted INTEGER,
  new_total_available INTEGER,
  previous_available INTEGER,
  location TEXT,
  product_type TEXT,
  barcode TEXT,
  price REAL,
  flow_run_id TEXT UNIQUE,
  event_type TEXT,
  adjustment_source TEXT,
  normalized_strain TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inv_adj_timestamp ON inventory_adjustments(timestamp);
CREATE INDEX IF NOT EXISTS idx_inv_adj_sku ON inventory_adjustments(sku);
CREATE INDEX IF NOT EXISTS idx_inv_adj_strain ON inventory_adjustments(normalized_strain);
CREATE INDEX IF NOT EXISTS idx_inv_adj_flow_run ON inventory_adjustments(flow_run_id);

CREATE TABLE IF NOT EXISTS pause_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_time TEXT NOT NULL,
  end_time TEXT,
  duration_min REAL,
  reason TEXT,
  line INTEGER,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pause_date ON pause_log(start_time);

CREATE TABLE IF NOT EXISTS shift_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adjustment_date TEXT NOT NULL,
  original_start TEXT,
  new_start TEXT,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_shift_date ON shift_adjustments(adjustment_date);

CREATE TABLE IF NOT EXISTS monthly_production (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  production_date TEXT NOT NULL,
  time_slot TEXT NOT NULL,
  buckers_line1 INTEGER DEFAULT 0,
  trimmers_line1 INTEGER DEFAULT 0,
  tzero_line1 INTEGER DEFAULT 0,
  buckers_line2 INTEGER DEFAULT 0,
  trimmers_line2 INTEGER DEFAULT 0,
  tzero_line2 INTEGER DEFAULT 0,
  cultivar1 TEXT,
  cultivar2 TEXT,
  tops_lbs1 REAL DEFAULT 0,
  smalls_lbs1 REAL DEFAULT 0,
  tops_lbs2 REAL DEFAULT 0,
  smalls_lbs2 REAL DEFAULT 0,
  wage_rate REAL,
  qc TEXT,
  notes TEXT,
  effective_trimmers_line1 REAL,
  effective_trimmers_line2 REAL,
  UNIQUE(production_date, time_slot)
);

CREATE INDEX IF NOT EXISTS idx_production_date ON monthly_production(production_date);

-- ============================================
-- DATA VERSION TRACKING (for smart polling)
-- ============================================

CREATE TABLE IF NOT EXISTS data_version (
  key TEXT PRIMARY KEY,
  version INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Initialize scoreboard version
INSERT OR IGNORE INTO data_version (key, version, updated_at) VALUES ('scoreboard', 0, datetime('now'));

-- ============================================
-- LIVE SCALE WEIGHT TRACKING
-- ============================================

CREATE TABLE IF NOT EXISTS scale_readings (
  station_id TEXT PRIMARY KEY DEFAULT 'line1',
  weight REAL NOT NULL DEFAULT 0,
  target_weight REAL DEFAULT 5.0,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Initialize default station
INSERT OR IGNORE INTO scale_readings (station_id, weight, target_weight, updated_at)
VALUES ('line1', 0, 5.0, datetime('now'));

-- ============================================
-- SYSTEM CONFIGURATION
-- ============================================

CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK(value_type IN ('string', 'number', 'boolean', 'json')),
  category TEXT NOT NULL,
  description TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_config_category ON system_config(category);

-- Initialize with current hardcoded values
INSERT OR IGNORE INTO system_config (key, value, value_type, category, description) VALUES
('labor.base_wage_rate', '23.00', 'number', 'labor', 'Base wage rate in $/hour before taxes'),
('labor.employer_tax_rate', '0.14', 'number', 'labor', 'Oregon employer tax rate (FICA, FUTA, SUI, Workers Comp)'),
('production.baseline_daily_goal', '200', 'number', 'production', 'Baseline daily production goal in lbs'),
('production.fallback_daily_goal', '66', 'number', 'production', 'Fallback daily goal when calculation fails'),
('production.bag_weight_lbs', '11.0231', 'number', 'production', '5kg bag weight converted to lbs'),
('production.target_bag_weight_kg', '5.0', 'number', 'production', 'Target bag weight in kg for scale'),
('schedule.time_slot_multipliers', '{"7:00 AM – 8:00 AM":1.0,"8:00 AM – 9:00 AM":1.0,"9:00 AM – 10:00 AM":0.83,"10:00 AM – 11:00 AM":1.0,"11:00 AM – 12:00 PM":1.0,"12:30 PM – 1:00 PM":0.5,"1:00 PM – 2:00 PM":1.0,"2:00 PM – 3:00 PM":1.0,"2:30 PM – 3:00 PM":0.5,"3:00 PM – 4:00 PM":0.83,"4:00 PM – 4:30 PM":0.33,"3:00 PM – 3:30 PM":0.5}', 'json', 'schedule', 'Time slot multipliers for break-adjusted targets'),
('schedule.normal_hours', '8.5', 'number', 'schedule', 'Normal productive work hours per day'),
('schedule.shift_start', '07:00', 'string', 'schedule', 'Shift start time (HH:MM)'),
('schedule.shift_end', '16:30', 'string', 'schedule', 'Shift end time (HH:MM)'),
('schedule.breaks', '[{"hour":9,"min":0,"duration":10},{"hour":12,"min":0,"duration":30},{"hour":14,"min":30,"duration":10},{"hour":16,"min":20,"duration":10}]', 'json', 'schedule', 'Break times and durations'),
('api.ai_model', 'claude-sonnet-4-20250514', 'string', 'api', 'Anthropic AI model version for chat'),
('polling.dashboard_refresh_ms', '30000', 'number', 'polling', 'Dashboard auto-refresh interval'),
('polling.scale_stale_threshold_ms', '3000', 'number', 'polling', 'Scale reading stale threshold'),
('validation.max_lbs_per_entry', '200', 'number', 'validation', 'Maximum lbs allowed per hourly entry');

-- ============================================
-- CONSIGNMENT SYSTEM
-- ============================================

CREATE TABLE IF NOT EXISTS consignment_partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_consignment_partners_name ON consignment_partners(name);

CREATE TABLE IF NOT EXISTS consignment_strains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS consignment_intakes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER NOT NULL REFERENCES consignment_partners(id),
  date TEXT NOT NULL,
  strain TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('tops', 'smalls')),
  weight_lbs REAL NOT NULL,
  price_per_lb REAL NOT NULL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_consignment_intakes_partner ON consignment_intakes(partner_id);
CREATE INDEX IF NOT EXISTS idx_consignment_intakes_date ON consignment_intakes(date);
CREATE INDEX IF NOT EXISTS idx_consignment_intakes_strain ON consignment_intakes(strain);

CREATE TABLE IF NOT EXISTS consignment_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER NOT NULL REFERENCES consignment_partners(id),
  date TEXT NOT NULL,
  strain TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('tops', 'smalls')),
  weight_lbs REAL NOT NULL,
  sale_price_per_lb REAL,
  channel TEXT DEFAULT 'retail',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_consignment_sales_partner ON consignment_sales(partner_id);
CREATE INDEX IF NOT EXISTS idx_consignment_sales_date ON consignment_sales(date);

CREATE TABLE IF NOT EXISTS consignment_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER NOT NULL REFERENCES consignment_partners(id),
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT DEFAULT 'check',
  reference_number TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_consignment_payments_partner ON consignment_payments(partner_id);
CREATE INDEX IF NOT EXISTS idx_consignment_payments_date ON consignment_payments(date);

-- Seed initial strains
INSERT OR IGNORE INTO consignment_strains (name) VALUES
  ('Alium OG'),
  ('Bubba Kush'),
  ('Critical Berries'),
  ('Lemon Octane'),
  ('Orange Fritter'),
  ('Puff Pastries'),
  ('Royal OG'),
  ('Sour Brulee'),
  ('Sour Lifter'),
  ('Sour Special Sauce'),
  ('Sour Suver Haze'),
  ('Super Sour Space Candy'),
  ('White CBG');

-- ============================================
-- CUSTOMER COMPLAINTS
-- ============================================

CREATE TABLE IF NOT EXISTS complaints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  complaint_date TEXT NOT NULL,
  customer TEXT NOT NULL,
  invoice_number TEXT,
  complaint TEXT NOT NULL,
  resolution TEXT DEFAULT '',
  status TEXT DEFAULT 'Open' CHECK(status IN ('Open','Resolved','In Progress')),
  reported_by TEXT DEFAULT '',
  resolved_date TEXT,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_complaints_date ON complaints(complaint_date);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_customer ON complaints(customer);
