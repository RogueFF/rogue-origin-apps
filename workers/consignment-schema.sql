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
