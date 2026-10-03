-- Three cutting crews, one row per crew per Pacific day (Koa, 2026-10-03).
--
-- Crew A (Nico), Crew B (Jose) and Crew C (Diego) each cut their own zone, and
-- each has its own trailers for the day. The lead fills this in on the crew's
-- FIRST zone scan of the day: which trailers run for the crew, and how many
-- cutters, drivers and water spiders it has.
--
-- The trailer list is what routes a load: a driver scans /t/3, T3 belongs to
-- Crew A today, so the load goes to Crew A's open lot. A trailer is on at most
-- one crew per day -- assigning it to another crew takes it off the first.
--
-- NOT harvest_crew_roster (0013): that one is farm-wide with no crew, and the
-- ledger's person-hours read it. Writing per-crew rows there would shift every
-- existing metric.
--
-- trailers is a comma list of decal numbers ('3,4'): at most six values, read
-- whole every time, never queried by element.
CREATE TABLE IF NOT EXISTS harvest_crew_day (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  harvest_date TEXT NOT NULL,
  crew TEXT NOT NULL,
  trailers TEXT NOT NULL DEFAULT '',
  cutters INTEGER,
  drivers INTEGER,
  water_spiders INTEGER,
  is_test INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (harvest_date, crew, is_test)
);
