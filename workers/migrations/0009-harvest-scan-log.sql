-- Harvest zone-entry / headcount / barn-intake scan log — TEST/PROTOTYPE build.
-- One row per zone-entry session (event_type='enter') plus one row per barn
-- trailer load (event_type='barn_load'). Headcount taps UPDATE the parent
-- 'enter' row (idempotent re-taps — no duplicate rows from a repeat tap).
-- Design: wiki/operations/plans/2026-07-06-seed-to-sale-harvest-tracking.md
-- is_test=1 rows are safe to bulk-delete before the real Oct 2026 harvest:
--   DELETE FROM harvest_scan_log WHERE is_test = 1;

CREATE TABLE IF NOT EXISTS harvest_scan_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,                    -- 'enter' | 'barn_load'
  zone TEXT NOT NULL,                          -- canonical zone: Z1-Z21, R1, GH1, GH2
  season INTEGER NOT NULL DEFAULT 2026,
  cut_number INTEGER,                          -- 'enter' rows only
  occurred_at TEXT DEFAULT (datetime('now')),  -- when this event happened (UTC)
  closed_at TEXT,                              -- 'enter' rows only — set when the NEXT enter auto-closes this one
  headcount INTEGER,                           -- 'enter' rows only
  headcount_at TEXT,                           -- last headcount-tap time for this session
  bins INTEGER,                                -- 'barn_load' rows only
  attributed_zone_session_id INTEGER,          -- 'barn_load' rows only — the 'enter' row active at scan time
  is_test INTEGER NOT NULL DEFAULT 1,          -- 1 = test/prototype data
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_harvest_scan_log_zone ON harvest_scan_log(zone);
CREATE INDEX IF NOT EXISTS idx_harvest_scan_log_event_type ON harvest_scan_log(event_type);
CREATE INDEX IF NOT EXISTS idx_harvest_scan_log_active ON harvest_scan_log(event_type, closed_at, occurred_at);
