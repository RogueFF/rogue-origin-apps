-- Hourly takedown report (?action=bajada) — Koa, 2026-10-05.
--
-- The phone version of the paper "Bajada por hora" sheet. Takedown is its own
-- crew, so it gets its own table rather than sharing harvest_hourly (which the
-- hanging crew page, the Capataz bot and the dashboard all read, keyed by barn).
--
-- One row per Pacific day x hour. The six role counts and the sticks taken
-- down are typed by the crew; sacks are NOT stored here — they are counted
-- from harvest_sacks.printed_at when the page loads, so there is one answer to
-- "how many sacks at 10 AM" and it is the tags.
--
-- Apply before deploying the worker that reads it:
--   npx wrangler d1 execute rogue-origin-db --remote --file migrations/0044-harvest-takedown-hourly.sql

CREATE TABLE IF NOT EXISTS harvest_takedown_hourly (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season INTEGER NOT NULL,
  harvest_date TEXT NOT NULL,            -- Pacific calendar day, YYYY-MM-DD
  hour_start TEXT NOT NULL,              -- 'HH:00' Pacific
  takedown INTEGER,                      -- Bajada
  drivers INTEGER,                       -- Choferes
  water_spiders INTEGER,                 -- WS
  weight_checkers INTEGER,               -- Pesador
  stick_removers INTEGER,                -- Quita palos
  hangers INTEGER,                       -- Colgadores
  sticks_down INTEGER,                   -- Palos bajados this hour
  notes TEXT,
  reported_by TEXT,
  answered_at TEXT,
  is_test INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (harvest_date, hour_start, is_test)
);

CREATE INDEX IF NOT EXISTS idx_takedown_hourly_day ON harvest_takedown_hourly (harvest_date, is_test);
