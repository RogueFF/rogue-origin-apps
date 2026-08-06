-- Per-supersack identity for the 2026 harvest — one row per PHYSICAL sack,
-- distinct from harvest_scan_log's event grain (0009).
-- Design: docs/plans/2026-08-06-supersack-tag-design.md
--
-- Each sack gets a printed 4x2 thermal tag carrying its sack_id ('26-0847')
-- both human-readable and as a QR resolving to /s/<sack_id>. Scanning it when
-- the sack is opened for bucking records tops/smalls against its FIELD LOT --
-- the join the aggregate supersack_entries table cannot express, and the fix
-- for the 1st-cut vs 2nd-cut blind spot in supersack-analytics.
--
-- The existing supersack_entries table is deliberately NOT dual-written.
-- 2026 harvest forward only; pre-existing untagged sacks are left alone.
--
-- is_test=1 rows are safe to bulk-delete before the real Oct 2026 harvest:
--   DELETE FROM harvest_sacks WHERE is_test = 1;

CREATE TABLE IF NOT EXISTS harvest_sacks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sack_id TEXT NOT NULL UNIQUE,                -- printed ID, e.g. '26-0847'
  season INTEGER NOT NULL,                     -- 2026
  serial INTEGER NOT NULL,                     -- 847; next = MAX(serial)+1 per season
  zone TEXT NOT NULL,                          -- canonical zone: Z1-Z21, R1, GH1, GH2
  cultivar TEXT,                               -- entered at print time (see design doc)
  cut_number INTEGER,
  harvest_date TEXT,                           -- cut date of the source lot
  zone_session_id INTEGER,                     -- FK -> harvest_scan_log 'enter' row = the lot
  printed_at TEXT DEFAULT (datetime('now')),
  opened_at TEXT,                              -- set at bucking, when weights are recorded
  tops_lbs REAL,
  smalls_lbs REAL,
  is_test INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Makes a concurrent-print serial collision fail loudly rather than silently
-- issuing two physical tags with the same number.
CREATE UNIQUE INDEX IF NOT EXISTS idx_harvest_sacks_season_serial
  ON harvest_sacks(season, serial);

CREATE INDEX IF NOT EXISTS idx_harvest_sacks_zone_session
  ON harvest_sacks(zone_session_id);
CREATE INDEX IF NOT EXISTS idx_harvest_sacks_zone ON harvest_sacks(zone);
CREATE INDEX IF NOT EXISTS idx_harvest_sacks_opened ON harvest_sacks(opened_at);
