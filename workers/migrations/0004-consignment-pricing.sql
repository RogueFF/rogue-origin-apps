-- Default pricing by grade (and optionally per-partner override)
CREATE TABLE IF NOT EXISTS consignment_pricing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER REFERENCES consignment_partners(id),
  grade TEXT NOT NULL CHECK(grade IN ('tops', 'smalls')),
  price_per_lb REAL NOT NULL,
  effective_date TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(partner_id, grade, effective_date)
);

-- Global defaults (partner_id = NULL means applies to all)
INSERT INTO consignment_pricing (partner_id, grade, price_per_lb, effective_date) VALUES
  (NULL, 'tops', 150.00, '2026-01-01'),
  (NULL, 'smalls', 50.00, '2026-01-01');
