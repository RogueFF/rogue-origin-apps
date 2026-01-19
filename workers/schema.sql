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
  buckers_line2 INTEGER DEFAULT 0,
  trimmers_line2 INTEGER DEFAULT 0,
  cultivar1 TEXT,
  cultivar2 TEXT,
  tops_lbs1 REAL DEFAULT 0,
  smalls_lbs1 REAL DEFAULT 0,
  tops_lbs2 REAL DEFAULT 0,
  smalls_lbs2 REAL DEFAULT 0,
  wage_rate REAL,
  notes TEXT,
  UNIQUE(production_date, time_slot)
);

CREATE INDEX IF NOT EXISTS idx_production_date ON monthly_production(production_date);
