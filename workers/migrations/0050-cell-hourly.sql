-- Manual hour-by-hour cell log, until every table has a live scale.
-- Koa 2026-11-09: ~21 cells working today, add more with a button; rename a cell
-- (person or label) over a stable station id; per cell per hour: tops, notes,
-- quality pass/fail; smalls is one number for the whole room each hour.
-- Design: wiki operations/plans/2026-11-02-cell-software-design.md §3 (cell_hourly).
--
-- Read and written by workers/src/handlers/production/cell-hourly.js
-- (?action=cellHourly / setCellHourly / setRoomSmalls / saveCellRoster).
-- Keys match what the scale rollup will write later (station_id = table1..tableN,
-- the canonical hourly-entry time slots), so scales replace typing with no data
-- migration: a scale row is the same row with source = 'scale'.
-- Nothing here writes to monthly_production (cell pounds stay out of line totals).
--
-- Safe to re-run: every statement is IF NOT EXISTS / OR IGNORE.
-- Apply by hand: cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0050-cell-hourly.sql

CREATE TABLE IF NOT EXISTS cell_roster (
  station_id TEXT PRIMARY KEY,                 -- table1..tableN, never reused
  label      TEXT NOT NULL,                    -- shown over the id: a person or a label
  lane       TEXT NOT NULL DEFAULT 'wholesale' CHECK (lane IN ('wholesale', 'retail')),
  sort       INTEGER NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,       -- a removed cell is 0, never deleted
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cell_hourly (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  production_date TEXT NOT NULL,               -- YYYY-MM-DD, Pacific
  time_slot       TEXT NOT NULL,               -- canonical hourly-entry slot (en dash)
  station_id      TEXT NOT NULL,
  cultivar        TEXT,
  tops_lbs        REAL,
  quality         TEXT CHECK (quality IN ('pass', 'fail')),   -- NULL = not checked
  notes           TEXT,
  source          TEXT NOT NULL DEFAULT 'manual',             -- 'manual' | 'scale'
  updated_at      TEXT DEFAULT (datetime('now')),
  UNIQUE (production_date, time_slot, station_id)
);
CREATE INDEX IF NOT EXISTS idx_cell_hourly_date ON cell_hourly (production_date);

CREATE TABLE IF NOT EXISTS cell_room_hourly (
  production_date TEXT NOT NULL,
  time_slot       TEXT NOT NULL,
  smalls_lbs      REAL,                        -- one shared number for the room
  cultivar        TEXT,                        -- the room's cultivar this hour (cells default to it)
  updated_at      TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (production_date, time_slot)
);

-- The 21 cells working on 2026-11-09. 12-14 sit above retail fulfillment.
INSERT OR IGNORE INTO cell_roster (station_id, label, lane, sort) VALUES
  ('table1', 'Cell 1', 'wholesale', 1),   ('table2', 'Cell 2', 'wholesale', 2),
  ('table3', 'Cell 3', 'wholesale', 3),   ('table4', 'Cell 4', 'wholesale', 4),
  ('table5', 'Cell 5', 'wholesale', 5),   ('table6', 'Cell 6', 'wholesale', 6),
  ('table7', 'Cell 7', 'wholesale', 7),   ('table8', 'Cell 8', 'wholesale', 8),
  ('table9', 'Cell 9', 'wholesale', 9),   ('table10', 'Cell 10', 'wholesale', 10),
  ('table11', 'Cell 11', 'wholesale', 11), ('table12', 'Cell 12', 'retail', 12),
  ('table13', 'Cell 13', 'retail', 13),   ('table14', 'Cell 14', 'retail', 14),
  ('table15', 'Cell 15', 'wholesale', 15), ('table16', 'Cell 16', 'wholesale', 16),
  ('table17', 'Cell 17', 'wholesale', 17), ('table18', 'Cell 18', 'wholesale', 18),
  ('table19', 'Cell 19', 'wholesale', 19), ('table20', 'Cell 20', 'wholesale', 20),
  ('table21', 'Cell 21', 'wholesale', 21);
