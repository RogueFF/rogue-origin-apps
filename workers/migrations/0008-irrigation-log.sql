-- Irrigation reporting — log of crew irrigation reports captured by the "Riego"
-- Telegram/WhatsApp agent (via the farm-bridge `log_irrigation` MCP tool →
-- /api/irrigation?action=log). One row per confirmed report.
-- Design: wiki/operations/plans/2026-06-16-irrigation-whatsapp-agent-design.md

CREATE TABLE IF NOT EXISTS irrigation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reported_at TEXT DEFAULT (datetime('now')),   -- when logged (UTC ISO8601)
  irrigator TEXT,                               -- crew member who reported
  zone TEXT NOT NULL,                           -- canonical zone: Z1–Z21, R1, GH1, GH2
  duration_min INTEGER NOT NULL,                -- minutes watered
  ppm INTEGER NOT NULL,                         -- nutrient concentration (parts per million)
  method TEXT,                                  -- 'drip' | 'flood' | NULL (optional)
  channel TEXT DEFAULT 'telegram',             -- telegram | whatsapp
  raw_message TEXT,                             -- original text/transcript, for audit
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_irrigation_log_zone ON irrigation_log(zone);
CREATE INDEX IF NOT EXISTS idx_irrigation_log_reported_at ON irrigation_log(reported_at);
