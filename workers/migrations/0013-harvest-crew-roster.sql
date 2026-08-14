-- Crew roster over time — the roles the zone scan doesn't capture.
--
-- Cutters get a headcount from the zone-entry scan. Everyone else is currently
-- invisible: drivers and water spiders appear nowhere, and hangers only exist
-- on the photographed board. The 2025 harvest logs tracked headcount by role,
-- which is what labor cost and TAKT-based staffing need.
--
-- WATER SPIDERS ARE TWO DISTINCT ROLES (Koa 2026-08-14):
--   cutter_water_spiders  — field side; walk finished bins from cutters to the trailer
--   hanging_water_spiders — barn side; keep hangers supplied with bins
-- The corrected TAKT worksheet listed a single "Water spiders: 7", which
-- conflates them. Tracked separately here so field-side and barn-side staffing
-- can be reasoned about independently.
--
-- NOT a once-per-day number. Driver count is usually steady but genuinely
-- changes mid-day (someone pulled to another task, a driver leaves early), so
-- this is a chain of periods in the same shape as harvest_scan_log's zone
-- entries: writing a new roster closes the previous one, and person-hours
-- accrue per interval. "Update on change, not on a timer" — the same rule the
-- hanger board already follows.
--
-- Cutters are deliberately absent: they come from the zone scans at finer
-- grain, and two sources for one number is the conflict the board-vs-digital
-- reconciliation rule exists to prevent.

CREATE TABLE IF NOT EXISTS harvest_crew_roster (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season INTEGER NOT NULL,
  drivers INTEGER,                             -- field <-> barn transport
  cutter_water_spiders INTEGER,                -- field side
  hangers INTEGER,                             -- barn side
  hanging_water_spiders INTEGER,               -- barn side
  effective_from TEXT DEFAULT (datetime('now')),
  effective_to TEXT,                           -- set when the NEXT roster supersedes this one
  note TEXT,
  is_test INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_harvest_crew_roster_open
  ON harvest_crew_roster(effective_to, effective_from);
CREATE INDEX IF NOT EXISTS idx_harvest_crew_roster_season
  ON harvest_crew_roster(season, is_test);
