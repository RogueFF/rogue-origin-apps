-- Line trimmer scales (Koa 2026-11-24): the cells are over and the room is back
-- on the buckers, T-Zero, trimmers line, but every trimmer seat keeps a scale and
-- a screen (cell.html, re-tailored). The trimmer taps their name, trims 1 lb
-- baskets, and the screen measures the tops they make in each clock hour.
--
-- line_scale_hours: grams gained per day, hour, seat, person and cultivar, plus
--   the minutes the person sat at that seat in that hour. Written by the seat's
--   screen as absolute totals, so a resend never counts twice. Every key column
--   is NOT NULL (person 0 = weight trimmed before anyone tapped a name, cultivar
--   empty = Hourly entry had none yet): a NULL in a key would never conflict.
--   Slots use the crew_hours keys (7-8 .. 4-4:30).
-- line_seats: who is on each seat now. A tap moves the person off any other seat.
-- line_scale_fill_days: the per-day switch that lets the scales fill the hour's
--   tops on Hourly entry. OFF unless a row says enabled = 1 (only some seats have
--   scales so far).
-- monthly_production.tops_source: NULL = tops typed by hand (every row before
--   this); 'scales' = tops filled from line_scale_hours. Only the tops (and the
--   part after a cultivar change) are filled, never crew or cultivar.
-- scale_marks.person_id: who the pickup was for.

CREATE TABLE IF NOT EXISTS line_scale_hours (
  work_date TEXT NOT NULL,
  slot TEXT NOT NULL,
  station_id TEXT NOT NULL,
  person_id INTEGER NOT NULL DEFAULT 0,
  cultivar TEXT NOT NULL DEFAULT '',
  g REAL NOT NULL DEFAULT 0,
  min REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (work_date, slot, station_id, person_id, cultivar)
);

CREATE INDEX IF NOT EXISTS idx_line_scale_hours_person ON line_scale_hours (work_date, person_id);

CREATE TABLE IF NOT EXISTS line_seats (
  station_id TEXT PRIMARY KEY,
  person_id INTEGER NOT NULL,
  since TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS line_scale_fill_days (
  production_date TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE monthly_production ADD COLUMN tops_source TEXT;

ALTER TABLE scale_marks ADD COLUMN person_id INTEGER;
