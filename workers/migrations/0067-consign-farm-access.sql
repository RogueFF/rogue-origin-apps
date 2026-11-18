-- Consignment lot ledger (stage 4): a partner farm's private link and PIN.
-- Only sha256(link) and an HMAC of the PIN are stored; the raw link is shown to the owner once.

CREATE TABLE IF NOT EXISTS cl_farm_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES cl_farms(id),
  token_hash TEXT NOT NULL UNIQUE,
  pin_hash TEXT,
  failed_tries INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  pin_set_at TEXT,
  last_seen_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cl_farm_access_farm ON cl_farm_access (farm_id, revoked_at);
